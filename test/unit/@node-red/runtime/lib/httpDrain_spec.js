/**
 * Copyright OpenJS Foundation and other contributors, https://openjsf.org/
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
/*
 * Modified by Actuna Sp. z o.o.:
 *   #40: tests of the drain of the HTTP requests before the flows stop
 *   (deploy.drainHttpNodeRequests): settings, tracking, the window, deadlines, the
 *   wait, the answers and their codes
 *   #76: a failure whose code cannot be read does not make the report of the failure throw
 *   #82: tests of the node in the record of a drain 503 (S-1), the guard after the window (S-2: one timer,
 *   retries inside the window), isWaitedFor (S-P), the wait of the shutdown (S-3), the condition and the
 *   notice of the drain (S-4) and the warning of a very large timeout (S-6)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const assert = require("assert");
const sinon = require("sinon");
const EventEmitter = require("events");
const http = require("http");
const express = require("express");
const NR_TEST_UTILS = require("nr-test-utils");
const httpDrain = NR_TEST_UTILS.require("@node-red/runtime/lib/httpDrain");
const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
const httpRoutes = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/httpRoutes");
const { log, events } = NR_TEST_UTILS.require("@node-red/util");

const S = httpDrain.S;
const TIMEOUT = 1000;
const START = 1000000;

// The mark of a route that follows the contract (the handler of "http in")
function markedHandler() {
    const handler = function() {};
    handler[S] = true;
    return handler;
}

// A response with what the drain uses of ServerResponse
function fakeRes() {
    const res = new EventEmitter();
    const headers = {};
    Object.assign(res, { statusCode: 200, headersSent: false, writableEnded: false, destroyed: false, body: undefined, headers: headers, endThrows: null });
    res.getHeaderNames = () => Object.keys(headers);
    res.setHeader = (name, value) => { headers[name.toLowerCase()] = value };
    res.getHeader = name => headers[name.toLowerCase()];
    res.removeHeader = name => { delete headers[name.toLowerCase()] };
    res.end = function(body) {
        if (this.endThrows) {
            throw this.endThrows;
        }
        this.body = body;
        this.writableEnded = true;
        this.headersSent = true;
        this.emit("finish");
        return this;
    };
    res.destroy = function() {
        this.destroyed = true;
        this.emit("close");
    };
    return res;
}

function fakeReq(method, url) {
    const req = new EventEmitter();
    Object.assign(req, { method: method || "GET", url: url || "/x", complete: true, route: null, resumed: 0 });
    req.resume = function() { req.resumed++ };
    return req;
}

describe("runtime/httpDrain (#40)", function() {
    let clock;

    function init(options) {
        httpDrain.init({ deploy: { drainHttpNodeRequests: Object.assign({ enabled: true, timeout: TIMEOUT }, options) } });
    }

    // The ready state; deploying() starts a deployment
    function ready() {
        instanceState.reset();
        instanceState.markStarting();
        instanceState.report({ errors: [] });
    }
    function deploying() {
        return instanceState.begin("deploy");
    }

    // A request that entered the httpNode app
    function arrive(method, url) {
        const r = { req: fakeReq(method, url), res: fakeRes() };
        httpDrain.middleware(r.req, r.res, function() { r.next = true });
        r.entry = r.req[S];
        return r;
    }
    function route(r, handlers) {
        r.req.route = { stack: (handlers || [markedHandler()]).map(handle => ({ handle })) };
        return r;
    }
    function accept(r) {
        r.req[S].accepted = true;
        return r;
    }
    // beforeStop with the wait ended at once (abortWait): the window is open afterwards
    async function drainNow() {
        const promise = httpDrain.beforeStop();
        httpDrain.abortWait();
        await promise;
    }
    function flush() {
        return new Promise(resolve => setImmediate(resolve));
    }
    // Whether the promise has resolved by now
    async function settled(promise) {
        let done = false;
        promise.then(() => { done = true });
        await flush();
        return done;
    }
    function body(r) {
        return JSON.parse(r.res.body);
    }
    function logged() {
        const text = [log.info, log.warn, log.debug].map(stub => stub.args.map(args => args.join(" ")).join("\n")).join("\n");
        // the records (log.log) of a node are part of the output of the drain too (#82)
        return text + "\n" + log.log.args.map(args => JSON.stringify(args)).join("\n");
    }

    beforeEach(function() {
        clock = sinon.useFakeTimers({ now: START, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
        sinon.stub(log, "warn");
        sinon.stub(log, "info");
        sinon.stub(log, "debug");
        sinon.stub(log, "log");
        sinon.stub(log, "_").callsFake((key, v) => key + (v ? " " + JSON.stringify(v) : ""));
        ready();
    });
    afterEach(function() {
        httpDrain.dispose();
        instanceState.reset();
        const timers = clock.countTimers();
        clock.restore();
        sinon.restore();
        timers.should.equal(0);
    });

    describe("settings", function() {
        it("is disabled without the setting, with null and without deploy", function() {
            httpDrain.readConfig(undefined).should.eql({ enabled: false });
            httpDrain.readConfig({}).should.eql({ enabled: false });
            httpDrain.readConfig({ deploy: {} }).should.eql({ enabled: false });
            httpDrain.readConfig({ deploy: { drainHttpNodeRequests: null } }).should.eql({ enabled: false });
            log.warn.called.should.be.false();
        });
        it("a setting that is not an object disables the drain with a warning", function() {
            httpDrain.readConfig({ deploy: { drainHttpNodeRequests: true } }).should.eql({ enabled: false });
            httpDrain.readConfig({ deploy: { drainHttpNodeRequests: [] } }).should.eql({ enabled: false });
            log.warn.callCount.should.equal(2);
            log.warn.firstCall.args[0].should.match(/httpDrain.invalid-setting/);
        });
        it("only enabled: true enables, with the defaults 30000 ms and 1 s", function() {
            httpDrain.readConfig({ deploy: { drainHttpNodeRequests: {} } }).should.eql({ enabled: false, timeout: 30000, retryAfter: 1 });
            httpDrain.readConfig({ deploy: { drainHttpNodeRequests: { enabled: "true" } } }).enabled.should.be.false();
            httpDrain.readConfig({ deploy: { drainHttpNodeRequests: { enabled: 1 } } }).enabled.should.be.false();
            httpDrain.readConfig({ deploy: { drainHttpNodeRequests: { enabled: true } } }).should.eql({ enabled: true, timeout: 30000, retryAfter: 1 });
            log.warn.called.should.be.false();
        });
        it("accepts a valid timeout and retryAfter", function() {
            httpDrain.readConfig({ deploy: { drainHttpNodeRequests: { enabled: true, timeout: 2500.5, retryAfter: 7 } } })
                .should.eql({ enabled: true, timeout: 2500.5, retryAfter: 7 });
            httpDrain.readConfig({ deploy: { drainHttpNodeRequests: { enabled: true, timeout: 2147483647 } } }).timeout.should.equal(2147483647);
            log.warn.called.should.be.false();
        });
        it("warns and uses the defaults for an invalid timeout or retryAfter", function() {
            [0, -1, "5", NaN, Infinity, 2147483648, null].forEach(function(timeout) {
                httpDrain.readConfig({ deploy: { drainHttpNodeRequests: { enabled: true, timeout } } }).timeout.should.equal(30000);
            });
            [0, -1, 1.5, "1", NaN, null].forEach(function(retryAfter) {
                httpDrain.readConfig({ deploy: { drainHttpNodeRequests: { enabled: true, retryAfter } } }).retryAfter.should.equal(1);
            });
            log.warn.callCount.should.equal(13);
            log.warn.firstCall.args[0].should.match(/httpDrain.invalid-option.*timeout/);
        });
        it("init enables and dispose disables again", function() {
            httpDrain.isEnabled().should.be.false();
            init();
            httpDrain.isEnabled().should.be.true();
            httpDrain.dispose();
            httpDrain.isEnabled().should.be.false();
        });
    });

    describe("middleware", function() {
        it("creates the entry on req and res, passes the request on and removes the entry on finish", function() {
            init();
            const r = arrive();
            r.next.should.be.true();
            should.exist(r.req[S]);
            r.res[S].should.equal(r.req[S]);
            httpDrain.size().should.equal(1);
            r.res.end("ok");
            httpDrain.size().should.equal(0);
        });
        it("removes the entry when the client closes the connection", function() {
            init();
            const r = arrive();
            httpDrain.size().should.equal(1);
            r.res.destroy();
            httpDrain.size().should.equal(0);
        });
        it("does nothing when the drain is not enabled", function() {
            httpDrain.dispose();
            const r = arrive();
            r.next.should.be.true();
            should.not.exist(r.req[S]);
            should.not.exist(r.res[S]);
            httpDrain.size().should.equal(0);
        });
        it("does not touch the request stream (nothing is read before the authentication)", function() {
            init();
            const r = arrive();
            r.req.listenerCount("data").should.equal(0);
            r.req.listenerCount("readable").should.equal(0);
            r.req.eventNames().should.eql([]);
            r.req.resumed.should.equal(0);
            r.res.eventNames().sort().should.eql(["close", "finish"]);
        });
        it("the entries of 10000 aborted requests are all removed", function() {
            init();
            const all = [];
            for (let i = 0; i < 10000; i++) {
                all.push(arrive());
            }
            httpDrain.size().should.equal(10000);
            all.forEach(r => r.res.destroy());
            httpDrain.size().should.equal(0);
        });
    });

    describe("classification of the route", function() {
        it("answers a request whose matched route has a marked handler", async function() {
            init();
            const r = route(arrive(), [function cookieParser() {}, markedHandler(), function errorHandler() {}]);
            await httpDrain.beforeStop();
            httpDrain.afterStop("full");
            r.res.statusCode.should.equal(503);
        });
        it("leaves alone a request whose route has no marked handler", async function() {
            init();
            const r = route(arrive(), [function other() {}]);
            const unmarked = function() {};
            unmarked[S] = "yes";
            const r2 = route(arrive(), [unmarked]);
            await httpDrain.beforeStop();
            httpDrain.afterStop("full");
            httpDrain.finalize();
            r.res.writableEnded.should.be.false();
            r2.res.writableEnded.should.be.false();
        });
        it("leaves alone a request without a matched route (static files, 404, the upload before the route)", async function() {
            init();
            const r = arrive();
            await httpDrain.beforeStop();
            httpDrain.afterStop("full");
            httpDrain.finalize();
            r.res.writableEnded.should.be.false();
        });
    });

    describe("beforeStop", function() {
        it("resolves at once when no request is accepted", async function() {
            init();
            await httpDrain.beforeStop();
            log.info.called.should.be.false();
            httpDrain.afterStop("full");
        });
        it("resolves at once when the drain is not enabled", async function() {
            httpDrain.dispose();
            await httpDrain.beforeStop();
            clock.countTimers().should.equal(0);
        });
        it("waits for the accepted requests and resolves when they are answered", async function() {
            init();
            const a = accept(route(arrive()));
            const b = accept(route(arrive()));
            const promise = httpDrain.beforeStop();
            log.info.firstCall.args[0].should.match(/httpDrain.waiting/);
            (await settled(promise)).should.be.false();
            a.res.end("a");
            (await settled(promise)).should.be.false();
            b.res.end("b");
            (await settled(promise)).should.be.true();
            httpDrain.afterStop("full");
            a.res.body.should.equal("a");
            b.res.body.should.equal("b");
        });
        it("does not wait for a request that is not accepted (slow body, authentication in progress)", async function() {
            init();
            const slow = route(arrive("POST"));
            slow.req.complete = false;
            const unrouted = arrive();
            await httpDrain.beforeStop();
            clock.tick(0);
            // the request that is routed gets the answer after the stop, the other is left alone
            httpDrain.afterStop("full");
            slow.res.statusCode.should.equal(503);
            slow.res.writableEnded.should.be.true();
            unrouted.res.writableEnded.should.be.false();
        });
        it("a request that is not accepted does not extend the wait for the accepted ones", async function() {
            init();
            const accepted = accept(route(arrive()));
            const slow = route(arrive("POST"));
            const promise = httpDrain.beforeStop();
            accepted.res.end("ok");
            (await settled(promise)).should.be.true();
            slow.res.writableEnded.should.be.false();
            httpDrain.afterStop("full");
            slow.res.writableEnded.should.be.true();
        });
        it("waits only for the requests accepted when it starts (a new request does not extend it)", async function() {
            init();
            const old = accept(route(arrive()));
            const promise = httpDrain.beforeStop();
            const fresh = accept(route(arrive()));
            old.res.end("old");
            (await settled(promise)).should.be.true();
            fresh.res.writableEnded.should.be.false();
        });
        it("ends at the timeout with a warning; the request is then answered by afterStop", async function() {
            init();
            const r = accept(route(arrive("POST")));
            const promise = httpDrain.beforeStop();
            clock.tick(TIMEOUT - 1);
            (await settled(promise)).should.be.false();
            clock.tick(1);
            (await settled(promise)).should.be.true();
            log.warn.args.map(a => a[0]).join().should.match(/httpDrain.timeout/);
            httpDrain.afterStop("full");
            r.res.statusCode.should.equal(503);
            body(r).code.should.equal("http_drain_outcome_unknown");
        });
        it("is aborted by abortWait", async function() {
            init();
            accept(route(arrive()));
            const promise = httpDrain.beforeStop();
            (await settled(promise)).should.be.false();
            httpDrain.abortWait();
            (await settled(promise)).should.be.true();
            httpDrain.afterStop("full");
        });
        it("resolves only when the last of many accepted requests is answered", async function() {
            init();
            const all = [];
            for (let i = 0; i < 3000; i++) {
                all.push(accept(route(arrive())));
            }
            const promise = httpDrain.beforeStop();
            for (let i = 0; i < all.length - 1; i++) {
                all[i].res.end("ok");
            }
            (await settled(promise)).should.be.false();
            all[all.length - 1].res.end("ok");
            (await settled(promise)).should.be.true();
            httpDrain.afterStop("full");
        });
        it("abortWait without a wait does nothing", function() {
            init();
            httpDrain.abortWait();
        });
        it("ends at once when the client aborts the last accepted request, with no 503", async function() {
            init();
            const r = accept(route(arrive()));
            const promise = httpDrain.beforeStop();
            (await settled(promise)).should.be.false();
            r.res.destroy();
            (await settled(promise)).should.be.true();
            httpDrain.afterStop("full");
            r.res.statusCode.should.equal(200);
            log.warn.called.should.be.false();
        });
        it("notices by itself an accepted request whose response has ended (the guard looks every 250 ms)", async function() {
            init();
            const r = accept(route(arrive()));
            const promise = httpDrain.beforeStop();
            // ended, but 'finish' has not been emitted yet
            r.res.writableEnded = true;
            (await settled(promise)).should.be.false();
            clock.tick(250);
            (await settled(promise)).should.be.true();
        });
        it("does not wait in the state stopping (the runtime stops itself)", async function() {
            init();
            accept(route(arrive()));
            instanceState.markStopping("SIGTERM");
            await httpDrain.beforeStop();
            log.info.called.should.be.false();
            httpDrain.afterStop("full");
        });
        it("never rejects", async function() {
            init();
            sinon.stub(instanceState, "get").throws(new Error("boom"));
            await httpDrain.beforeStop();
            log.warn.args.map(a => a[0]).join().should.match(/httpDrain.drain-failed/);
        });
    });

    describe("codes and headers of the 503", function() {
        async function stopWith(r, scope) {
            await drainNow();
            httpDrain.afterStop(scope || "full");
            return r;
        }
        it("an accepted POST gets http_drain_outcome_unknown without Retry-After", async function() {
            init();
            const r = accept(route(arrive("POST")));
            await stopWith(r);
            r.res.statusCode.should.equal(503);
            body(r).code.should.equal("http_drain_outcome_unknown");
            r.res.headers.should.not.have.property("retry-after");
            r.res.headers["cache-control"].should.equal("no-store");
        });
        it("a POST that is not accepted gets http_drain_not_accepted with Retry-After", async function() {
            init({ retryAfter: 4 });
            const r = route(arrive("POST"));
            await stopWith(r);
            body(r).code.should.equal("http_drain_not_accepted");
            r.res.headers["retry-after"].should.equal("4");
        });
        it("an accepted GET, HEAD and OPTIONS get http_drain_outcome_unknown with Retry-After", async function() {
            init();
            const all = ["GET", "HEAD", "OPTIONS"].map(method => accept(route(arrive(method))));
            await stopWith(all[0]);
            all.forEach(function(r) {
                r.res.statusCode.should.equal(503);
                r.res.headers["retry-after"].should.equal("1");
            });
            body(all[0]).code.should.equal("http_drain_outcome_unknown");
            should.not.exist(all[1].res.body);
        });
        it("an accepted PUT, PATCH and DELETE get no Retry-After", async function() {
            init();
            const all = ["PUT", "PATCH", "DELETE"].map(method => accept(route(arrive(method))));
            await stopWith(all[0]);
            all.forEach(function(r) {
                r.res.statusCode.should.equal(503);
                r.res.headers.should.not.have.property("retry-after");
            });
        });
        it("Connection: close only when the request was not read to the end", async function() {
            init();
            const open = route(arrive("POST"));
            open.req.complete = false;
            const complete = route(arrive("POST"));
            await httpDrain.beforeStop();
            httpDrain.afterStop("full");
            open.res.headers.connection.should.equal("close");
            complete.res.headers.should.not.have.property("connection");
        });
        it("the headers that a handler set before are not in the 503, CORS and Vary stay", async function() {
            init();
            const r = accept(route(arrive("POST")));
            r.res.setHeader("Set-Cookie", "sid=1");
            r.res.setHeader("Content-Encoding", "gzip");
            r.res.setHeader("Content-Type", "text/html");
            r.res.setHeader("Access-Control-Allow-Origin", "*");
            r.res.setHeader("Vary", "Origin");
            await stopWith(r);
            r.res.headers.should.not.have.property("set-cookie");
            r.res.headers.should.not.have.property("content-encoding");
            r.res.headers["content-type"].should.match(/^application\/json/);
            r.res.headers["access-control-allow-origin"].should.equal("*");
            r.res.headers.vary.should.equal("Origin");
        });
        it("a HEAD request gets no body", async function() {
            init();
            const r = accept(route(arrive("HEAD")));
            await stopWith(r);
            r.res.statusCode.should.equal(503);
            should.not.exist(r.res.body);
        });
        it("a response that has started (a stream) is destroyed, not replaced", async function() {
            init();
            const r = accept(route(arrive()));
            r.res.headersSent = true;
            await stopWith(r);
            r.res.destroyed.should.be.true();
            r.res.statusCode.should.equal(200);
            r.entry.drained.should.be.true();
        });
        it("a response that has ended is left alone", async function() {
            init();
            const r = accept(route(arrive()));
            r.res.writableEnded = true;
            r.res.headersSent = true;
            await stopWith(r);
            r.res.destroyed.should.be.false();
            r.entry.drained.should.be.false();
        });
        it("drained is set after the answer", async function() {
            init();
            const r = accept(route(arrive()));
            r.entry.drained.should.be.false();
            await stopWith(r);
            r.entry.drained.should.be.true();
        });
        it("an error while answering leaves drained unset and does not stop the others", async function() {
            init();
            const bad = accept(route(arrive()));
            const error = new Error("secret detail of the failure");
            error.code = "EBOOM";
            bad.res.endThrows = error;
            const good = accept(route(arrive("POST")));
            await stopWith(good);
            bad.entry.drained.should.be.false();
            good.res.statusCode.should.equal(503);
            const text = logged();
            text.should.match(/httpDrain.answer-failed/);
            text.should.match(/EBOOM/);
            text.should.not.match(/secret detail/);
        });
        it("afterStop does not throw when a request cannot be answered", async function() {
            init();
            const bad = route(arrive());
            const worse = route(arrive());
            const error = new Error("x");
            bad.res.endThrows = error;
            worse.res.endThrows = error;
            const good = route(arrive());
            await httpDrain.beforeStop();
            httpDrain.afterStop("full");
            good.res.statusCode.should.equal(503);
        });
        it("the logs contain no URL, path or query", async function() {
            init();
            const r = accept(route(arrive("GET", "/private/path?token=abc123")));
            const bad = accept(route(arrive("GET", "/another/secret?x=1")));
            bad.res.endThrows = Object.assign(new Error("failed for /another/secret"), { code: "EFAIL" });
            const promise = httpDrain.beforeStop();
            clock.tick(TIMEOUT);
            await promise;
            httpDrain.afterStop("full");
            const text = logged();
            text.should.match(/httpDrain.answered/);
            text.should.not.match(/private|token|abc123|another|secret/);
        });
        it("one warning with the counters answers the requests of a stop", async function() {
            init();
            const accepted = accept(route(arrive("POST")));
            const notAccepted = route(arrive("POST"));
            const promise = httpDrain.beforeStop();
            clock.tick(TIMEOUT);
            await promise;
            httpDrain.afterStop("full");
            accepted.res.statusCode.should.equal(503);
            notAccepted.res.statusCode.should.equal(503);
            const warns = log.warn.args.map(a => a[0]).filter(m => /httpDrain.answered /.test(m));
            warns.length.should.equal(1);
            warns[0].should.match(/"notAccepted":1,"outcomeUnknown":1,"destroyed":0,"failed":0/);
        });
    });

    describe("deadlines in the window", function() {
        it("a request that is accepted in the window gets the deadline t0 + timeout and is answered after it by a partial stop", async function() {
            init();
            const token = deploying();
            const r = accept(route(arrive("POST")));
            const promise = httpDrain.beforeStop();
            clock.setSystemTime(START + TIMEOUT - 1);
            httpDrain.afterStop("partial");
            r.res.writableEnded.should.be.false();
            clock.setSystemTime(START + TIMEOUT);
            httpDrain.afterStop("partial");
            r.res.statusCode.should.equal(503);
            body(r).code.should.equal("http_drain_outcome_unknown");
            instanceState.end(token, { errors: [] });
            await promise;
        });
        it("a partial stop leaves the requests that have no deadline yet", async function() {
            init();
            const token = deploying();
            const r = accept(route(arrive()));
            const slow = arrive();
            const promise = httpDrain.beforeStop();
            r.res.end("done");
            await promise;
            httpDrain.afterStop("partial");
            slow.res.writableEnded.should.be.false();
            instanceState.end(token, { errors: [] });
        });
        it("a request that arrives in the window and is matched later gets a deadline from the guard (at most 250 ms late)", async function() {
            init();
            const token = deploying();
            await httpDrain.beforeStop();
            const r = arrive("POST");
            clock.tick(100);
            // the route is matched, the node has not accepted the request yet (it is reading the body)
            route(r);
            clock.tick(250);
            r.res.writableEnded.should.be.false();
            // the deadline: the moment the guard saw the route + timeout
            clock.tick(TIMEOUT + 250);
            r.res.statusCode.should.equal(503);
            body(r).code.should.equal("http_drain_not_accepted");
            instanceState.end(token, { errors: [] });
        });
        it("outside a window a request is accepted without a deadline and no stop answers it by the guard", async function() {
            init();
            const r = accept(route(arrive("POST")));
            clock.tick(10 * TIMEOUT);
            r.res.writableEnded.should.be.false();
            clock.countTimers().should.equal(0);
            r.res.end("ok");
        });
        it("a request accepted in the window is answered 503 after its deadline also when the window has closed: the limit is hard (A18)", async function() {
            init();
            const token = deploying();
            // the request of an old node that the deployment changes: its message is lost with the node
            const old = accept(route(arrive("POST")));
            const promise = httpDrain.beforeStop();
            old.res.end("answered by the flow");
            await promise;
            // arrives in the drain, goes to the node that is stopped
            clock.tick(100);
            const lost = accept(route(arrive("POST")));
            httpDrain.afterStop("partial");
            lost.res.writableEnded.should.be.false();
            // the deployment ends: the window is closed, the guard must stay for the deadline
            instanceState.end(token, { errors: [] });
            clock.tick(1);
            lost.res.writableEnded.should.be.false();
            clock.countTimers().should.equal(1);
            clock.tick(TIMEOUT + 250);
            lost.res.statusCode.should.equal(503);
            body(lost).code.should.equal("http_drain_outcome_unknown");
            lost.res.headers.should.not.have.property("retry-after");
            clock.countTimers().should.equal(0);
        });
        it("after the window has closed the guard answers a GET with Retry-After, a request that is not accepted as not_accepted", async function() {
            init();
            const token = deploying();
            await drainNow();
            const accepted = accept(route(arrive("GET")));
            const notAccepted = route(arrive("POST"));
            clock.tick(100);
            httpDrain.afterStop("partial");
            instanceState.end(token, { errors: [] });
            clock.tick(1);
            clock.tick(TIMEOUT + 250);
            body(accepted).code.should.equal("http_drain_outcome_unknown");
            accepted.res.headers["retry-after"].should.equal("1");
            body(notAccepted).code.should.equal("http_drain_not_accepted");
            notAccepted.res.headers["retry-after"].should.equal("1");
            clock.countTimers().should.equal(0);
        });
        it("the guard after the window does not answer a request that finished first and then stops", async function() {
            init();
            const token = deploying();
            await drainNow();
            const r = accept(route(arrive("POST")));
            httpDrain.afterStop("partial");
            instanceState.end(token, { errors: [] });
            r.res.end("late but in time");
            clock.countTimers().should.equal(0);
            clock.tick(10 * TIMEOUT);
            r.res.body.should.equal("late but in time");
        });
        it("a request that a handler passes on with next('route') to a route without the mark is not answered (the deadline stays)", async function() {
            init();
            const token = deploying();
            const r = accept(route(arrive("POST")));
            await drainNow();
            // the marked route passed the request on: Express now has another route
            r.req.route = { stack: [{ handle: function other() {} }] };
            httpDrain.afterStop("full");
            clock.tick(10 * TIMEOUT);
            httpDrain.finalize();
            r.res.writableEnded.should.be.false();
            instanceState.end(token, { errors: [] });
        });
        it("a request without a route in the window never gets a deadline", async function() {
            init();
            const token = deploying();
            await httpDrain.beforeStop();
            const r = arrive();
            clock.tick(10 * TIMEOUT);
            r.res.writableEnded.should.be.false();
            instanceState.end(token, { errors: [] });
            r.res.end("ok");
        });
        it("the new requests do not extend beforeStop but get a deadline", async function() {
            init();
            const token = deploying();
            const old = accept(route(arrive()));
            const promise = httpDrain.beforeStop();
            const fresh = accept(route(arrive("POST")));
            old.res.end("ok");
            await promise;
            // deadline = t0 + timeout, not (arrival + timeout) when the arrival was later; here the same instant
            clock.tick(TIMEOUT);
            fresh.res.statusCode.should.equal(503);
            instanceState.end(token, { errors: [] });
        });
        it("the deadline of a request accepted later than t0 is accepted moment + timeout", async function() {
            init();
            const token = deploying();
            await httpDrain.beforeStop();
            clock.tick(400);
            const r = accept(route(arrive("POST")));
            clock.tick(TIMEOUT - 1);
            r.res.writableEnded.should.be.false();
            clock.tick(1 + 250);
            r.res.statusCode.should.equal(503);
            instanceState.end(token, { errors: [] });
        });
        it("a deadline from an earlier window that passed outside of any window starts again in the next one", async function() {
            init();
            const request = accept(route(arrive("POST")));
            let token = deploying();
            await drainNow();
            clock.setSystemTime(START + 500);
            httpDrain.afterStop("partial");
            request.res.writableEnded.should.be.false();
            instanceState.end(token, { errors: [] });
            // the old deadline (START + TIMEOUT) passes with no window open
            clock.setSystemTime(START + 5 * TIMEOUT);
            token = deploying();
            await drainNow();
            httpDrain.afterStop("partial");
            request.res.writableEnded.should.be.false();
            clock.tick(TIMEOUT);
            request.res.statusCode.should.equal(503);
            instanceState.end(token, { errors: [] });
        });
    });

    describe("the window follows the instance state (D2)", function() {
        // An accepted request that arrives in the window has the deadline; one that arrives
        // outside it has not: the answer of the guard tells which it was
        function probe() {
            const r = accept(route(arrive("POST")));
            clock.tick(10 * TIMEOUT);
            const answered = r.res.writableEnded;
            if (!answered) {
                r.res.end("ok");
            }
            return answered;
        }
        it("is open until the deployment ends", async function() {
            init();
            const token = deploying();
            await httpDrain.beforeStop();
            probe().should.be.true();
            instanceState.end(token, { errors: [] });
        });
        it("is closed after the end of the deployment", async function() {
            init();
            const token = deploying();
            await httpDrain.beforeStop();
            instanceState.end(token, { errors: [] });
            clock.tick(1);
            probe().should.be.false();
        });
        it("is closed after a failed start, an aborted operation and a failure to stop", async function() {
            init();
            for (const result of [{ errors: [{ code: "flow_start_failed" }] }, { aborted: true }, { errors: [{ code: "deploy_stop_failed" }] }]) {
                ready();
                clock.tick(1);
                const token = deploying();
                await httpDrain.beforeStop();
                instanceState.end(token, result);
                clock.tick(1);
                probe().should.be.false();
            }
        });
        it("a request that the hold (#8) releases when the state leaves deploying has no deadline", async function() {
            init();
            const token = deploying();
            await httpDrain.beforeStop();
            let released;
            // a listener of the state, registered before and after the drain would see the same
            const unsubscribe = instanceState.onChange(function(info) {
                if (info.state !== "deploying") {
                    released = accept(route(arrive("POST")));
                }
            });
            instanceState.end(token, { errors: [] });
            unsubscribe();
            should.exist(released);
            clock.tick(10 * TIMEOUT);
            released.res.writableEnded.should.be.false();
        });
        it("clearReloadFailed and markReloadFailed in deploying do not close the window (R-47)", async function() {
            init();
            const token = deploying();
            await httpDrain.beforeStop();
            instanceState.markReloadFailed({ error: "storage_unreachable" });
            instanceState.clearReloadFailed();
            probe().should.be.true();
            instanceState.end(token, { errors: [] });
        });
        it("stays open when a later operation takes over under the same state (startTimeoutReleasesLock) and closes at the end of the last one", async function() {
            init();
            deploying();
            await httpDrain.beforeStop();
            const second = instanceState.begin("deploy", { supersede: true });
            probe().should.be.true();
            instanceState.end(second, { errors: [] });
            clock.tick(1);
            probe().should.be.false();
        });
        it("a new deployment does not inherit the window of the earlier one", async function() {
            init();
            const first = deploying();
            await httpDrain.beforeStop();
            instanceState.end(first, { errors: [] });
            clock.tick(5);
            const second = deploying();
            // no beforeStop of the second one yet
            probe().should.be.false();
            instanceState.end(second, { errors: [] });
        });
        it("a reload from storage (reloading) is a window", async function() {
            init();
            instanceState.markReloadPending();
            instanceState.markDraining();
            const token = instanceState.begin("reload");
            instanceState.get().state.should.equal("reloading");
            await httpDrain.beforeStop();
            probe().should.be.true();
            instanceState.end(token, { errors: [] });
            clock.tick(1);
            probe().should.be.false();
        });
        it("outside a deployment the window is the operation: it closes with afterStop", async function() {
            init();
            await httpDrain.beforeStop();
            httpDrain.afterStop("full");
            probe().should.be.false();
        });
        it("a window that never ends logs a warning once after twice the timeout", async function() {
            init();
            deploying();
            await httpDrain.beforeStop();
            const r = arrive();
            clock.tick(2 * TIMEOUT);
            log.warn.args.map(a => a[0]).filter(m => /httpDrain.window-long/.test(m)).length.should.equal(0);
            clock.tick(250);
            clock.tick(5 * TIMEOUT);
            log.warn.args.map(a => a[0]).filter(m => /httpDrain.window-long/.test(m)).length.should.equal(1);
            r.res.end("ok");
        });
    });

    describe("afterStop", function() {
        it("full: answers every open request with a matched route, accepted or not", async function() {
            init();
            const accepted = accept(route(arrive("POST")));
            const notAccepted = route(arrive("POST"));
            const unrouted = arrive();
            await drainNow();
            httpDrain.afterStop("full");
            accepted.res.statusCode.should.equal(503);
            notAccepted.res.statusCode.should.equal(503);
            unrouted.res.writableEnded.should.be.false();
        });
        it("partial: only the requests past their deadline", async function() {
            init();
            const token = deploying();
            const past = accept(route(arrive("POST")));
            const promise = httpDrain.beforeStop();
            clock.setSystemTime(START + TIMEOUT / 2);
            const young = accept(route(arrive("POST")));
            clock.setSystemTime(START + TIMEOUT);
            httpDrain.afterStop("partial");
            past.res.statusCode.should.equal(503);
            young.res.writableEnded.should.be.false();
            instanceState.end(token, { errors: [] });
            await promise;
        });
        it("does not answer a request twice", async function() {
            init();
            const r = accept(route(arrive("POST")));
            await drainNow();
            httpDrain.afterStop("full");
            const calls = sinon.spy(r.res, "end");
            httpDrain.afterStop("full");
            httpDrain.finalize();
            calls.called.should.be.false();
        });
        it("works without beforeStop", function() {
            init();
            const r = route(arrive());
            httpDrain.afterStop("full");
            r.res.statusCode.should.equal(503);
        });
        it("the guard stops when the window has closed and the requests are finished", async function() {
            init();
            const r = route(arrive());
            await httpDrain.beforeStop();
            httpDrain.afterStop("partial");
            // the request has a deadline: the guard stays for it
            clock.countTimers().should.equal(1);
            r.res.end("ok");
            clock.countTimers().should.equal(0);
        });
    });

    describe("finalize (RED.stop)", function() {
        it("answers the requests that are still open and routed, without a prior beforeStop", function() {
            init();
            const r = accept(route(arrive("POST")));
            const unrouted = arrive();
            httpDrain.finalize();
            r.res.statusCode.should.equal(503);
            body(r).code.should.equal("http_drain_outcome_unknown");
            unrouted.res.writableEnded.should.be.false();
        });
        it("is a no-op when the drain is not enabled", function() {
            httpDrain.dispose();
            httpDrain.finalize();
            clock.countTimers().should.equal(0);
        });
        it("ends a wait that is running and stops the guard", async function() {
            init();
            accept(route(arrive()));
            const promise = httpDrain.beforeStop();
            httpDrain.finalize();
            (await settled(promise)).should.be.true();
            clock.countTimers().should.equal(0);
        });
        it("does not throw when a request cannot be answered", function() {
            init();
            const bad = route(arrive());
            bad.res.endThrows = new Error("x");
            const good = route(arrive());
            (function() { httpDrain.finalize() }).should.not.throw();
            good.res.statusCode.should.equal(503);
        });
    });

    // #76: the report of a failure reads `err.code`; a failure with a value whose `code` cannot be read (a getter that
    // throws, a Proxy) must not make the report throw. Such a value reaches the drain from code that shares the request
    // and the response (a middleware or a node that replaces `res.end`, or defines a getter on `res`, or registers a
    // route handler as a Proxy): the drain says it never throws and never rejects
    describe("a failure whose code cannot be read (#76)", function() {
        const hostiles = [
            ["an Error whose code getter throws", () => Object.defineProperty(new Error("x"), "code", { get: function() { throw new Error("code getter") } })],
            ["a Proxy that throws on every get", () => new Proxy({}, { get: function() { throw new Error("p") } })]
        ];

        // runs the work and turns a failure into an ordinary Error, so that a hostile value never reaches the runner
        async function ok(what, work) {
            try {
                return await work();
            } catch (err) {
                let text;
                try { text = String(err) } catch (e) { text = "(the value cannot be printed)" }
                throw new Error(what + " must not throw but threw: " + text);
            }
        }
        // a request whose response cannot be read: isOpen() fails
        function unreadable(r, value) {
            Object.defineProperty(r.res, "writableEnded", { get: function() { throw value } });
            return r;
        }
        function driveFailedWith(text) {
            text.should.match(/httpDrain.drain-failed \{"code":"unknown"\}/);
        }

        hostiles.forEach(function(h) {
            it("beforeStop (drain-failed): " + h[0] + " - never throws, one warning with the code 'unknown'", async function() {
                init();
                unreadable(accept(route(arrive("POST"))), h[1]());
                const promise = ok("beforeStop()", () => httpDrain.beforeStop());
                await promise;
                driveFailedWith(logged());
            });

            it("afterStop (drain-failed): " + h[0] + " - never throws, one warning with the code 'unknown'", async function() {
                init();
                unreadable(route(arrive("POST")), h[1]());
                await ok("afterStop()", () => httpDrain.afterStop("full"));
                driveFailedWith(logged());
                clock.countTimers().should.equal(0);
            });

            it("finalize (drain-failed): " + h[0] + " on a second request - never throws, the first is answered, the wait ends, no timer is left", async function() {
                init();
                const good = accept(route(arrive("POST")));
                const waiting = httpDrain.beforeStop();
                unreadable(route(arrive("POST")), h[1]());
                await ok("finalize()", () => httpDrain.finalize());
                good.res.statusCode.should.equal(503);
                (await settled(waiting)).should.be.true();
                driveFailedWith(logged());
                clock.countTimers().should.equal(0);
            });

            it("the guard tick (drain-failed): " + h[0] + " - the timer callback does not throw, one warning with the code 'unknown'", async function() {
                init();
                deploying();
                const good = accept(route(arrive("POST")));
                const waiting = httpDrain.beforeStop();
                unreadable(route(arrive("POST")), h[1]());
                await ok("the guard tick", () => clock.tick(250));
                driveFailedWith(logged());
                httpDrain.abortWait();
                await waiting;
                good.res.writableEnded.should.be.false();
            });

            it("answer (answer-failed): a res.end that throws " + h[0] + " - never throws, the code is 'unknown', the other requests are answered", async function() {
                init();
                const bad = accept(route(arrive()));
                bad.res.endThrows = h[1]();
                const good = accept(route(arrive("POST")));
                await ok("finalize()", () => httpDrain.finalize());
                bad.entry.drained.should.be.false();
                good.res.statusCode.should.equal(503);
                logged().should.match(/httpDrain.answer-failed \{"code":"unknown"\}/);
            });
        });

        it("regression: an Error with a code is logged with that code, as before", async function() {
            init();
            const bad = accept(route(arrive()));
            const error = new Error("secret detail");
            error.code = "EBOOM";
            bad.res.endThrows = error;
            await ok("finalize()", () => httpDrain.finalize());
            logged().should.match(/httpDrain.answer-failed \{"code":"EBOOM"\}/);
            logged().should.not.match(/secret detail/);
        });
    });
    // #82 (S-1): the record of a drain 503 names the node of the route. "Owned" is a route that
    // `httpRoutes.register` created; the record is `log.log({level: DEBUG, id, type, z, msg})`
    describe("the node of the route in the record of the 503 (S-1, #82)", function() {
        const ANSWERED = "httpDrain.answered-request";

        function ownedRoute(node, method, path, handlers) {
            const app = express();
            httpRoutes.init(app);
            httpRoutes.register(node, method || "post", path || "/p", handlers || [markedHandler()]);
            return app._router.stack.find(layer => layer.route && layer.route.path === (path || "/p")).route;
        }
        function owned(r, node, handlers) {
            r.req.route = ownedRoute(node, r.req.method.toLowerCase(), "/p", handlers);
            return r;
        }
        function plainNode(extra) {
            return Object.assign({ id: "n1", type: "http in", z: "f1", name: "secret-name" }, extra);
        }
        // the records of the drain with a node
        function records() {
            return log.log.args.map(a => a[0]).filter(e => e && e.level === log.DEBUG && String(e.msg).indexOf(ANSWERED) !== -1);
        }
        // the answers that are logged without a node (log.debug)
        function plainRecords() {
            return log.debug.args.filter(a => String(a[0]).indexOf(ANSWERED) !== -1).map(a => a[0]);
        }
        function expectedMsg(method, code) {
            return log._(ANSWERED, { method: method, code: code });
        }
        afterEach(function() {
            httpRoutes.init(null);
        });

        it("AC-1: an accepted POST: 503 outcome unknown and one record with id, type and z, no name; log.debug is not used", async function() {
            init();
            const r = accept(owned(arrive("POST"), plainNode()));
            await drainNow();
            httpDrain.afterStop("full");
            r.res.statusCode.should.equal(503);
            body(r).code.should.equal("http_drain_outcome_unknown");
            records().should.eql([{ level: log.DEBUG, id: "n1", type: "http in", z: "f1", msg: expectedMsg("POST", "http_drain_outcome_unknown") }]);
            records()[0].should.not.have.property("name");
            plainRecords().should.eql([]);
        });
        it("AC-2: a request that is not accepted: 503 not accepted and a record with the same owner and that code", async function() {
            init();
            const r = owned(arrive("POST"), plainNode());
            await drainNow();
            httpDrain.afterStop("full");
            body(r).code.should.equal("http_drain_not_accepted");
            records().should.eql([{ level: log.DEBUG, id: "n1", type: "http in", z: "f1", msg: expectedMsg("POST", "http_drain_not_accepted") }]);
            plainRecords().should.eql([]);
        });
        it("AC-3a: the record has the owner when the answer comes from afterStop('partial') past the deadline", async function() {
            init();
            const token = deploying();
            const r = accept(owned(arrive("POST"), plainNode({ id: "pa" })));
            const promise = httpDrain.beforeStop();
            clock.setSystemTime(START + TIMEOUT);
            httpDrain.afterStop("partial");
            r.res.statusCode.should.equal(503);
            records().map(e => e.id).should.eql(["pa"]);
            instanceState.end(token, { errors: [] });
            await promise;
        });
        it("AC-3b: the record has the owner when the answer comes from the guard after the window", async function() {
            init();
            const token = deploying();
            const r = accept(owned(arrive("POST"), plainNode({ id: "pb" })));
            await drainNow();
            httpDrain.afterStop("partial");
            instanceState.end(token, { errors: [] });
            clock.tick(1);
            clock.tick(TIMEOUT + 250);
            r.res.statusCode.should.equal(503);
            records().map(e => e.id).should.eql(["pb"]);
            plainRecords().should.eql([]);
        });
        it("AC-3c: the record has the owner when the answer comes from finalize()", function() {
            init();
            const r = accept(owned(arrive("POST"), plainNode({ id: "pc" })));
            httpDrain.finalize();
            r.res.statusCode.should.equal(503);
            records().map(e => e.id).should.eql(["pc"]);
            plainRecords().should.eql([]);
        });
        it("AC-4: removeAll(node) before afterStop('full'): the owner is still reported", async function() {
            init();
            const node = plainNode({ id: "pd" });
            const r = accept(owned(arrive("POST"), node));
            httpRoutes.removeAll(node);
            await drainNow();
            httpDrain.afterStop("full");
            r.res.statusCode.should.equal(503);
            records().map(e => e.id).should.eql(["pd"]);
        });
        it("AC-5: a marked route that register did not create (a fake object, a real app.post) is logged by log.debug as before", async function() {
            init();
            const fake = accept(route(arrive("POST")));
            const app = express();
            app.post("/q", markedHandler());
            const real = accept(arrive("POST"));
            real.req.route = app._router.stack.find(layer => layer.route && layer.route.path === "/q").route;
            await drainNow();
            httpDrain.afterStop("full");
            fake.res.statusCode.should.equal(503);
            real.res.statusCode.should.equal(503);
            plainRecords().should.eql([expectedMsg("POST", "http_drain_outcome_unknown"), expectedMsg("POST", "http_drain_outcome_unknown")]);
            records().should.eql([]);
        });
        it("AC-8: an owner without z has no z key, a type that is not a string no type key, never a name key", async function() {
            init();
            const noZ = accept(owned(arrive("POST"), plainNode({ id: "z1", z: undefined })));
            const noType = accept(owned(arrive("POST"), plainNode({ id: "t1", type: 42 })));
            await drainNow();
            httpDrain.afterStop("full");
            const list = records();
            list.should.have.length(2);
            const byId = id => list.find(e => e.id === id);
            byId("z1").should.not.have.property("z");
            byId("z1").type.should.equal("http in");
            byId("t1").should.not.have.property("type");
            byId("t1").z.should.equal("f1");
            list.forEach(e => e.should.not.have.property("name"));
        });
        it("AC-8: an owner whose id is not a string or is empty gives the plain record, the request is answered", async function() {
            init();
            const numeric = accept(owned(arrive("POST"), plainNode({ id: 7 })));
            const empty = accept(owned(arrive("POST"), plainNode({ id: "" })));
            await drainNow();
            httpDrain.afterStop("full");
            numeric.res.statusCode.should.equal(503);
            empty.res.statusCode.should.equal(503);
            records().should.eql([]);
            plainRecords().should.have.length(2);
        });
        it("AC-9a: an owner whose id getter throws: the 503 is sent, the counters are not changed, the plain record", async function() {
            init();
            const node = plainNode();
            const r = accept(owned(arrive("POST"), node));
            Object.defineProperty(node, "id", { get: function() { throw new Error("id getter") }, configurable: true });
            await drainNow();
            httpDrain.afterStop("full");
            r.res.statusCode.should.equal(503);
            r.entry.drained.should.be.true();
            const text = logged();
            text.should.match(/"outcomeUnknown":1,"destroyed":0,"failed":0/);
            text.should.not.match(/answer-failed/);
            records().should.eql([]);
            plainRecords().should.eql([expectedMsg("POST", "http_drain_outcome_unknown")]);
        });
        it("AC-9b: a req.route getter that throws after the 503 was sent: counters unchanged, no answer-failed, the plain record", async function() {
            init();
            const r = accept(arrive("POST"));
            const theRoute = ownedRoute(plainNode());
            Object.defineProperty(r.req, "route", {
                get: function() {
                    if (r.res.statusCode !== 503) { return theRoute }
                    throw new Error("route getter");
                },
                configurable: true
            });
            await drainNow();
            httpDrain.afterStop("full");
            r.res.statusCode.should.equal(503);
            const text = logged();
            text.should.match(/"outcomeUnknown":1,"destroyed":0,"failed":0/);
            text.should.not.match(/answer-failed/);
            records().should.eql([]);
            plainRecords().should.eql([expectedMsg("POST", "http_drain_outcome_unknown")]);
        });
        it("AC-10: an ended response is left alone, a started one is destroyed (counted), a res.end that throws is counted as failed; none has a record", async function() {
            init();
            const ended = accept(owned(arrive("POST"), plainNode({ id: "e1" })));
            ended.res.writableEnded = true;
            ended.res.headersSent = true;
            const started = accept(owned(arrive("POST"), plainNode({ id: "e2" })));
            started.res.headersSent = true;
            const failing = accept(owned(arrive("POST"), plainNode({ id: "e3" })));
            failing.res.endThrows = Object.assign(new Error("x"), { code: "EBOOM" });
            await drainNow();
            httpDrain.afterStop("full");
            started.res.destroyed.should.be.true();
            ended.res.destroyed.should.be.false();
            const text = logged();
            text.should.match(/"destroyed":1,"failed":1/);
            text.should.match(/httpDrain.answer-failed \{"code":"EBOOM"\}/);
            records().should.eql([]);
            plainRecords().should.eql([]);
        });
        it("AC-11: no record or log line contains a URL, a path, a query or the name of the node", async function() {
            init();
            const a = accept(owned(arrive("GET", "/private/path?token=abc123"), plainNode({ id: "u1" })));
            const b = accept(owned(arrive("GET", "/another/secret?x=1"), plainNode({ id: "u2" })));
            b.res.endThrows = Object.assign(new Error("failed for /another/secret"), { code: "EFAIL" });
            const promise = httpDrain.beforeStop();
            clock.tick(TIMEOUT);
            await promise;
            httpDrain.afterStop("full");
            records().map(e => e.id).should.eql(["u1"]);
            const text = logged();
            text.should.match(/httpDrain.answered/);
            text.should.not.match(/private|token|abc123|another|secret/);
        });
        it("AC-13: with the drain off (absent, disabled, an empty object, a string) nothing is answered and no record is made", async function() {
            [undefined, { enabled: false }, {}, "yes"].forEach(function(setting) {
                httpDrain.init({ deploy: { drainHttpNodeRequests: setting } });
                const r = owned(arrive("POST"), plainNode());
                httpDrain.afterStop("full");
                httpDrain.finalize();
                r.res.writableEnded.should.be.false();
            });
            records().should.eql([]);
            plainRecords().should.eql([]);
        });
        it("AC-13: register() reads nothing of the node: the getters id, type and z are not called", function() {
            init();
            const calls = [];
            const node = {};
            ["id", "type", "z", "name"].forEach(key => Object.defineProperty(node, key, { get: function() { calls.push(key); return key }, configurable: true }));
            ownedRoute(node);
            calls.should.eql([]);
        });
    });
    // #82 (S-2): after the window one timer at the nearest deadline instead of an interval; `observe` skips
    // the entries that have a deadline; a failed answer is retried inside the window; an answered entry
    // leaves the guard at once
    describe("the guard (S-2, #82)", function() {
        // the pending fake timers; the periodic one has `interval`
        function pendingTimers() {
            return Object.keys(clock.timers || {}).map(id => clock.timers[id]);
        }
        function isPeriodic(t) {
            return typeof t.interval === "number";
        }
        // whenever a deadline is pending and no window is open: exactly one timer, a timeout
        function oneTimeout(message) {
            const list = pendingTimers();
            list.length.should.equal(1, (message || "") + " the number of the pending timers");
            isPeriodic(list[0]).should.equal(false, (message || "") + " the timer is periodic");
        }
        function answerFailed() {
            return log.warn.args.map(a => a[0]).filter(m => /httpDrain.answer-failed/.test(m));
        }
        function summaries() {
            return log.warn.args.map(a => a[0]).filter(m => /httpDrain.answered /.test(m));
        }
        // three accepted routed requests of an open window with the deadlines START + 1000, + 1300, + 1600;
        // the clock is at START + 700 when the window closes (the deadlines are 300, 600 and 900 ms ahead)
        async function threeDeadlines(close) {
            init();
            const token = close === "state" ? deploying() : null;
            await httpDrain.beforeStop();
            const a = accept(route(arrive("POST")));
            clock.tick(300);
            const b = accept(route(arrive("POST")));
            clock.tick(300);
            const c = accept(route(arrive("POST")));
            clock.tick(100);
            if (token) {
                instanceState.end(token, { errors: [] });
                // the guard sees the end of the window at its next period
                clock.tick(250);
            } else {
                httpDrain.afterStop("partial");
            }
            return [a, b, c];
        }
        const DEADLINES = [START + 1000, START + 1300, START + 1600];
        async function walkDeadlines(all) {
            for (let i = 0; i < all.length; i++) {
                clock.tick(DEADLINES[i] - 1 - Date.now());
                all[i].res.writableEnded.should.equal(false, "request " + i + " is answered before its deadline");
                oneTimeout("before the deadline " + i + ":");
                clock.tick(1 + 250);
                all[i].res.statusCode.should.equal(503, "request " + i + " is answered at its deadline, at most 250 ms late");
                if (i < all.length - 1) {
                    oneTimeout("after the answer " + i + ":");
                }
            }
            clock.countTimers().should.equal(0);
        }

        it("AC-20: after an operation window: exactly one timer, a timeout; each request is answered at its deadline; none is left", async function() {
            const all = await threeDeadlines("operation");
            oneTimeout("right after afterStop:");
            await walkDeadlines(all);
        });
        it("AC-20: the same after a state window that ends by a state change (one period later)", async function() {
            const all = await threeDeadlines("state");
            oneTimeout("after the next period:");
            await walkDeadlines(all);
        });
        it("AC-21 (as far as it can be reached): a request accepted after the window gets its own, later deadline; the planned one stays", async function() {
            // A deadline is `max(t0, moment) + timeout`, so a request that is accepted later never has an
            // earlier deadline than one that is planned (the clock does not run backwards): the test pins that
            // the planned deadline is not disturbed and the new one is served at its own
            init();
            await httpDrain.beforeStop();
            const early = accept(route(arrive("POST")));
            const late = route(arrive("POST"));
            clock.tick(100);
            httpDrain.afterStop("partial");
            oneTimeout("planned:");
            clock.tick(100);
            accept(late);
            oneTimeout("after the later acceptance:");
            clock.tick(START + TIMEOUT - 1 - Date.now());
            early.res.writableEnded.should.be.false();
            clock.tick(1 + 250);
            early.res.statusCode.should.equal(503);
            late.res.writableEnded.should.be.false();
            oneTimeout("after the first answer:");
            clock.tick(START + 200 + TIMEOUT - 1 - Date.now());
            late.res.writableEnded.should.be.false();
            clock.tick(1 + 250);
            late.res.statusCode.should.equal(503);
            clock.countTimers().should.equal(0);
        });
        it("AC-22: a new window while the timeout is pending makes the guard periodic again; a request routed in it gets a deadline and window-long still fires", async function() {
            init();
            await httpDrain.beforeStop();
            const old = accept(route(arrive("POST")));
            clock.tick(100);
            httpDrain.afterStop("partial");
            oneTimeout("the first window is closed:");
            const token = deploying();
            const second = httpDrain.beforeStop();
            httpDrain.abortWait();
            await second;
            pendingTimers().some(isPeriodic).should.equal(true, "the guard is periodic in the new window");
            // keeps the window busy (no route: never a deadline), like a request of a start that does not end
            const keeper = arrive();
            const routed = route(arrive("POST"));
            clock.tick(250);
            // a deadline was given to the routed request: it is answered after the timeout
            clock.tick(TIMEOUT + 250);
            routed.res.statusCode.should.equal(503);
            old.res.statusCode.should.equal(503);
            const before = log.warn.args.map(a => a[0]).filter(m => /httpDrain.window-long/.test(m)).length;
            clock.tick(2 * TIMEOUT);
            log.warn.args.map(a => a[0]).filter(m => /httpDrain.window-long/.test(m)).length.should.equal(1);
            before.should.equal(0);
            keeper.res.end("ok");
            instanceState.end(token, { errors: [] });
        });
        it("AC-23: requests that finish before their deadlines leave no timer and no 503", async function() {
            init();
            await httpDrain.beforeStop();
            const all = [accept(route(arrive("POST"))), accept(route(arrive("POST")))];
            clock.tick(100);
            httpDrain.afterStop("partial");
            oneTimeout("pending deadlines:");
            all.forEach(r => r.res.end("in time"));
            clock.countTimers().should.equal(0);
            clock.tick(10 * TIMEOUT);
            all.forEach(r => r.res.body.should.equal("in time"));
        });
        it("AC-23b: a timeout that fires 1 ms early answers nothing, one timer is pending again, the 503 is sent at the deadline", async function() {
            init();
            await httpDrain.beforeStop();
            const r = accept(route(arrive("POST")));
            clock.tick(400);
            httpDrain.afterStop("partial");
            oneTimeout("planned for t + 600:");
            // the clock is stepped back: the timeout (600 ms) now fires 1 ms before the deadline
            clock.setSystemTime(Date.now() - 1);
            clock.tick(600);
            Date.now().should.equal(START + TIMEOUT - 1);
            r.res.writableEnded.should.equal(false, "the 503 was sent before the deadline");
            oneTimeout("after the early timeout:");
            clock.tick(1 + 250);
            r.res.statusCode.should.equal(503);
            clock.countTimers().should.equal(0);
        });
        it("AC-24: in an open window one period reads the response of each request that has a deadline once; a request without one still gets it", async function() {
            init();
            const token = deploying();
            const all = [];
            const reads = [];
            for (let i = 0; i < 50; i++) {
                const r = route(arrive("POST"));
                let count = 0;
                reads.push(function() { return count });
                Object.defineProperty(r.res, "writableEnded", { get: function() { count++; return false }, configurable: true });
                all.push(r);
            }
            // every one has the deadline START + TIMEOUT from here on
            await httpDrain.beforeStop();
            const late = arrive("POST");
            clock.tick(100);
            route(late);
            const before = reads.map(read => read());
            clock.tick(150);
            // one period (at START + 250): the entry of `late` got its deadline by the guard
            reads.forEach(function(read, i) {
                (read() - before[i]).should.equal(1, "the reads of request " + i + " in one period");
            });
            // late: the guard saw its route at START + 250 -> the deadline is START + 250 + TIMEOUT
            clock.tick(START + 250 + TIMEOUT - 1 - Date.now());
            late.res.writableEnded.should.be.false();
            clock.tick(1 + 250);
            late.res.statusCode.should.equal(503);
            body(late).code.should.equal("http_drain_not_accepted");
            instanceState.end(token, { errors: [] });
        });
        it("AC-25: a due request whose answer fails twice in the window is answered at the third period; one warning, one count of failed", async function() {
            init();
            const token = deploying();
            const r = accept(route(arrive("POST")));
            let attempts = 0;
            const realEnd = r.res.end;
            r.res.end = function(text) {
                attempts++;
                if (attempts <= 2) {
                    throw Object.assign(new Error("secret detail"), { code: "EBOOM" });
                }
                return realEnd.call(this, text);
            };
            await drainNow();
            clock.tick(1000);
            attempts.should.equal(1);
            clock.tick(250);
            attempts.should.equal(2);
            r.res.writableEnded.should.be.false();
            clock.tick(250);
            attempts.should.equal(3);
            r.res.statusCode.should.equal(503);
            body(r).code.should.equal("http_drain_outcome_unknown");
            answerFailed().should.have.length(1);
            answerFailed()[0].should.match(/EBOOM/);
            summaries().filter(m => /"failed":1/.test(m)).should.have.length(1);
            summaries().filter(m => /"outcomeUnknown":1/.test(m)).should.have.length(1);
            summaries().should.have.length(2);
            instanceState.end(token, { errors: [] });
        });
        it("AC-26: a request that fails for ever is warned about once in 2 s of the window; its close ends the retries and the guard", async function() {
            init();
            const token = deploying();
            const r = accept(route(arrive("POST")));
            let attempts = 0;
            r.res.end = function() {
                attempts++;
                throw Object.assign(new Error("x"), { code: "EBOOM" });
            };
            await drainNow();
            clock.tick(2000 + 1000);
            // the deadline is at 1000: a retry at every period of 250 ms until 3000
            attempts.should.be.above(5);
            answerFailed().should.have.length(1);
            summaries().should.have.length(1);
            r.res.destroy();
            const after = attempts;
            clock.tick(5000);
            attempts.should.equal(after);
            clock.countTimers().should.equal(0);
            instanceState.end(token, { errors: [] });
        });
        it("AC-27: a failed request is removed from the guard when the window closes; afterStop('full') answers it then", async function() {
            init();
            const token = deploying();
            const r = accept(route(arrive("POST")));
            r.res.endThrows = Object.assign(new Error("x"), { code: "EBOOM" });
            await drainNow();
            clock.tick(1000);
            answerFailed().should.have.length(1);
            instanceState.end(token, { errors: [] });
            clock.tick(250);
            clock.countTimers().should.equal(0);
            r.res.endThrows = null;
            httpDrain.afterStop("full");
            r.res.statusCode.should.equal(503);
        });
        it("AC-27: a due request that fails after the window is removed from the guard; finalize() answers it then", async function() {
            init();
            await httpDrain.beforeStop();
            const r = accept(route(arrive("POST")));
            r.res.endThrows = Object.assign(new Error("x"), { code: "EBOOM" });
            clock.tick(400);
            httpDrain.afterStop("partial");
            clock.tick(600 + 250);
            answerFailed().should.have.length(1);
            clock.countTimers().should.equal(0);
            r.res.endThrows = null;
            httpDrain.finalize();
            r.res.statusCode.should.equal(503);
        });
        it("AC-28: a response whose end emits finish later, and a destroyed one: no timer is left right after afterStop('full'), no second answer later", async function() {
            init();
            await httpDrain.beforeStop();
            const slow = accept(route(arrive("POST")));
            slow.res.end = sinon.spy(function(text) {
                // ends the response, but 'finish' comes later (a slow client)
                this.body = text;
                this.writableEnded = true;
                this.headersSent = true;
                return this;
            });
            const destroyed = accept(route(arrive("POST")));
            destroyed.res.headersSent = true;
            // destroy() without a 'close' event yet
            destroyed.res.destroy = sinon.spy(function() { this.destroyed = true });
            httpDrain.afterStop("full");
            slow.res.end.calledOnce.should.be.true();
            destroyed.res.destroy.calledOnce.should.be.true();
            clock.countTimers().should.equal(0);
            clock.tick(10 * TIMEOUT);
            slow.res.end.calledOnce.should.be.true();
            destroyed.res.destroy.calledOnce.should.be.true();
            httpDrain.finalize();
            slow.res.end.calledOnce.should.be.true();
        });
    });
    // #82 (S-3): the wait of the shutdown (`health.shutdown`, the SIGTERM path): the requests that are
    // waited for at the moment of the call, at most `min(timeout, budget)` ms
    describe("waitForShutdown (S-3, #82)", function() {
        function needApi() {
            assert.strictEqual(typeof httpDrain.waitForShutdown, "function", "httpDrain.waitForShutdown is not defined");
        }
        function wait(budget) {
            needApi();
            const w = httpDrain.waitForShutdown(budget);
            w.should.have.property("promise");
            w.promise.should.be.a.Promise();
            w.cancel.should.be.a.Function();
            return w;
        }
        function infoLogs(key) {
            return log.info.args.map(a => a[0]).filter(m => m.indexOf(key) !== -1);
        }
        function warnLogs(key) {
            return log.warn.args.map(a => a[0]).filter(m => m.indexOf(key) !== -1);
        }
        function shutdownLogs() {
            return infoLogs("httpDrain.shutdown-").concat(warnLogs("httpDrain.shutdown-"));
        }

        it("AC-45: a budget that is 0, negative, not a number or not finite resolves at once, without a log and without a timer", async function() {
            init();
            accept(route(arrive("POST")));
            for (const budget of [0, -1, NaN, Infinity, -Infinity, "5000", undefined, null]) {
                const w = wait(budget);
                (await settled(w.promise)).should.equal(true, "budget " + String(budget));
            }
            shutdownLogs().should.eql([]);
            clock.countTimers().should.equal(0);
        });
        it("AC-45: with the drain off it resolves at once, without a log", async function() {
            httpDrain.dispose();
            const w = wait(5000);
            (await settled(w.promise)).should.be.true();
            shutdownLogs().should.eql([]);
            clock.countTimers().should.equal(0);
        });
        it("resolves at once, without a log, when no request is waited for", async function() {
            init();
            route(arrive("POST"));
            arrive("GET");
            const w = wait(5000);
            (await settled(w.promise)).should.be.true();
            shutdownLogs().should.eql([]);
            clock.countTimers().should.equal(0);
        });
        it("logs the count and the limit once, waits for all the requests of the snapshot and leaves no timer", async function() {
            init();
            const a = accept(route(arrive("POST")));
            const b = accept(route(arrive("POST")));
            const w = wait(5000);
            infoLogs("httpDrain.shutdown-waiting").should.eql(['httpDrain.shutdown-waiting {"count":2,"timeout":1000}']);
            a.res.end("a");
            (await settled(w.promise)).should.be.false();
            b.res.end("b");
            (await settled(w.promise)).should.be.true();
            warnLogs("httpDrain.shutdown-timeout").should.eql([]);
            clock.countTimers().should.equal(0);
        });
        it("the limit is the smaller of the timeout and the budget; at the limit it warns with the count of the open requests", async function() {
            init();
            const open = accept(route(arrive("POST")));
            const answered = accept(route(arrive("POST")));
            const w = wait(400);
            infoLogs("httpDrain.shutdown-waiting").should.eql(['httpDrain.shutdown-waiting {"count":2,"timeout":400}']);
            answered.res.end("ok");
            clock.tick(399);
            (await settled(w.promise)).should.be.false();
            clock.tick(1);
            (await settled(w.promise)).should.be.true();
            warnLogs("httpDrain.shutdown-timeout").should.eql(['httpDrain.shutdown-timeout {"count":1}']);
            open.res.writableEnded.should.be.false();
            clock.countTimers().should.equal(0);
        });
        it("with a budget above the timeout the limit is the timeout", async function() {
            init();
            accept(route(arrive("POST")));
            const w = wait(60000);
            infoLogs("httpDrain.shutdown-waiting").should.eql(['httpDrain.shutdown-waiting {"count":1,"timeout":1000}']);
            clock.tick(999);
            (await settled(w.promise)).should.be.false();
            clock.tick(1);
            (await settled(w.promise)).should.be.true();
            warnLogs("httpDrain.shutdown-timeout").should.have.length(1);
        });
        it("cancel() ends the wait at once, without a warning and without a timer; a second cancel() does nothing", async function() {
            init();
            accept(route(arrive("POST")));
            const w = wait(5000);
            (await settled(w.promise)).should.be.false();
            w.cancel();
            (await settled(w.promise)).should.be.true();
            w.cancel();
            warnLogs("httpDrain.shutdown-timeout").should.eql([]);
            clock.countTimers().should.equal(0);
        });
        it("finalize() ends the wait", async function() {
            init();
            accept(route(arrive("POST")));
            const w = wait(5000);
            httpDrain.finalize();
            (await settled(w.promise)).should.be.true();
            clock.countTimers().should.equal(0);
        });
        it("dispose() ends the wait", async function() {
            init();
            accept(route(arrive("POST")));
            const w = wait(5000);
            httpDrain.dispose();
            (await settled(w.promise)).should.be.true();
            clock.countTimers().should.equal(0);
        });
        it("AC-36: a request that is not accepted and one accepted after the snapshot are not waited for", async function() {
            init();
            const waited = accept(route(arrive("POST")));
            const notAccepted = route(arrive("POST"));
            const w = wait(5000);
            const later = accept(route(arrive("POST")));
            infoLogs("httpDrain.shutdown-waiting").should.eql(['httpDrain.shutdown-waiting {"count":1,"timeout":1000}']);
            waited.res.end("ok");
            (await settled(w.promise)).should.be.true();
            notAccepted.res.writableEnded.should.be.false();
            later.res.writableEnded.should.be.false();
        });
        it("AC-36: a waited request whose client aborts ends the wait at once, without a 503", async function() {
            init();
            const r = accept(route(arrive("POST")));
            const w = wait(5000);
            (await settled(w.promise)).should.be.false();
            r.res.destroy();
            (await settled(w.promise)).should.be.true();
            r.res.statusCode.should.equal(200);
            warnLogs("httpDrain").should.eql([]);
        });
        it("AC-43: a waited request whose response has ended without 'finish' no longer holds the wait: the guard sees it within 250 ms", async function() {
            init();
            const r = accept(route(arrive("POST")));
            const w = wait(5000);
            // no window is open: the guard runs for the wait
            clock.countTimers().should.be.above(0);
            r.res.writableEnded = true;
            (await settled(w.promise)).should.be.false();
            clock.tick(250);
            (await settled(w.promise)).should.be.true();
            warnLogs("httpDrain.shutdown-timeout").should.eql([]);
            clock.countTimers().should.equal(0);
        });
        it("a failure inside is logged as drain-failed and the promise resolves", async function() {
            init();
            const r = accept(route(arrive("POST")));
            Object.defineProperty(r.res, "writableEnded", { get: function() { throw new Error("hostile getter") } });
            const w = wait(5000);
            (await settled(w.promise)).should.be.true();
            warnLogs("httpDrain.drain-failed").should.eql(['httpDrain.drain-failed {"code":"unknown"}']);
            clock.countTimers().should.equal(0);
        });
        it("a failure inside the guard while it waits is logged and the wait still ends at its limit", async function() {
            init();
            const r = accept(route(arrive("POST")));
            const w = wait(5000);
            Object.defineProperty(r.res, "writableEnded", { get: function() { throw new Error("hostile getter") } });
            clock.tick(250);
            warnLogs("httpDrain.drain-failed").length.should.be.above(0);
            clock.tick(1000);
            (await settled(w.promise)).should.be.true();
            clock.countTimers().should.equal(0);
        });
        it("does not set the condition of the instance state and sends no notification (it belongs to the wait of beforeStop)", async function() {
            init();
            const seen = [];
            const onState = info => seen.push(info);
            const onEvent = e => seen.push(e);
            events.on("instance:state", onState);
            events.on("runtime-event", onEvent);
            try {
                accept(route(arrive("POST")));
                const w = wait(5000);
                should.not.exist(instanceState.get().httpDrain);
                w.cancel();
                await w.promise;
                seen.should.eql([]);
            } finally {
                events.removeListener("instance:state", onState);
                events.removeListener("runtime-event", onEvent);
            }
        });
        it("is possible in the state stopping, where beforeStop does not wait", async function() {
            init();
            const r = accept(route(arrive("POST")));
            instanceState.markStopping("SIGTERM");
            await httpDrain.beforeStop();
            infoLogs("httpDrain.waiting").should.eql([]);
            const w = wait(5000);
            infoLogs("httpDrain.shutdown-waiting").should.have.length(1);
            r.res.end("ok");
            (await settled(w.promise)).should.be.true();
        });
        it("AC-40: the wait of a deployment and the wait of the shutdown are independent: abortWait() ends only the first, cancel() only the second, finalize() both", async function() {
            init();
            const a = accept(route(arrive("POST")));
            const deployment = httpDrain.beforeStop();
            const shutdown = wait(5000);
            httpDrain.abortWait();
            (await settled(deployment)).should.be.true();
            (await settled(shutdown.promise)).should.equal(false, "abortWait() ended the wait of the shutdown");
            a.res.end("ok");
            (await settled(shutdown.promise)).should.be.true();

            const b = accept(route(arrive("POST")));
            const second = httpDrain.beforeStop();
            const secondShutdown = wait(5000);
            secondShutdown.cancel();
            (await settled(secondShutdown.promise)).should.be.true();
            (await settled(second)).should.equal(false, "cancel() ended the wait of the deployment");

            const third = wait(5000);
            httpDrain.finalize();
            (await settled(second)).should.be.true();
            (await settled(third.promise)).should.be.true();
            b.res.writableEnded.should.be.true();
        });
        it("AC-40: the answers of the requests end both waits; the limit of the shutdown does not end the wait of the deployment", async function() {
            init();
            const a = accept(route(arrive("POST")));
            const deployment = httpDrain.beforeStop();
            const shutdown = wait(400);
            clock.tick(400);
            (await settled(shutdown.promise)).should.be.true();
            (await settled(deployment)).should.equal(false, "the limit of the shutdown ended the wait of the deployment");
            a.res.end("ok");
            (await settled(deployment)).should.be.true();
            warnLogs("httpDrain.shutdown-timeout").should.have.length(1);
            warnLogs("httpDrain.timeout").should.eql([]);
        });
        it("AC-44: the wait of a deployment never logs the keys of the shutdown", async function() {
            init();
            accept(route(arrive("POST")));
            const promise = httpDrain.beforeStop();
            clock.tick(TIMEOUT);
            await promise;
            httpDrain.afterStop("full");
            httpDrain.finalize();
            shutdownLogs().should.eql([]);
            warnLogs("httpDrain.timeout").should.have.length(1);
        });
        it("AC-39: RED.stop() directly (the state stopping, no waitForShutdown): beforeStop does not wait and finalize() answers the request", async function() {
            init();
            const r = accept(route(arrive("POST")));
            instanceState.markStopping("stop");
            await httpDrain.beforeStop();
            httpDrain.afterStop("full");
            httpDrain.finalize();
            r.res.statusCode.should.equal(503);
            body(r).code.should.equal("http_drain_outcome_unknown");
            shutdownLogs().should.eql([]);
        });
    });
    // #82 (S-4): the condition `httpDrain` of the instance state and the retained notice of the editor, while a
    // stop waits for the requests (the wait of beforeStop, not the wait of the shutdown)
    describe("the condition httpDrain and the notice (S-4, #82)", function() {
        const health = NR_TEST_UTILS.require("@node-red/runtime/lib/health");
        const httpHold = NR_TEST_UTILS.require("@node-red/runtime/lib/httpHold");
        const fs = require("fs");
        let stateEvents;
        let noticeEvents;
        let listeners;

        function listen() {
            stateEvents = [];
            noticeEvents = [];
            const onState = info => stateEvents.push(info);
            const onNotice = event => { if (event && event.id === "http-drain") { noticeEvents.push(event) } };
            events.on("instance:state", onState);
            events.on("runtime-event", onNotice);
            listeners.push(() => {
                events.removeListener("instance:state", onState);
                events.removeListener("runtime-event", onNotice);
            });
        }
        function warningOf(count) {
            return { id: "http-drain", retain: true, payload: { type: "warning", text: "notification.warnings.http_drain", count: count, timeout: TIMEOUT } };
        }
        const CLEARED = { id: "http-drain", retain: false };

        beforeEach(function() {
            listeners = [];
        });
        afterEach(function() {
            listeners.forEach(remove => remove());
            httpHold.dispose();
            health.init({});
        });

        it("AC-50: a deployment that waits for two accepted requests: one event with the condition, the state unchanged, one notification", async function() {
            init();
            const token = deploying();
            accept(route(arrive("POST")));
            accept(route(arrive("POST")));
            listen();
            const t0 = Date.now();
            const promise = httpDrain.beforeStop();
            stateEvents.should.have.length(1);
            stateEvents[0].state.should.equal("deploying");
            stateEvents[0].httpDrain.should.eql({ requests: 2, since: t0, deadline: t0 + TIMEOUT });
            instanceState.get().httpDrain.should.eql({ requests: 2, since: t0, deadline: t0 + TIMEOUT });
            instanceState.get().state.should.equal("deploying");
            noticeEvents.should.eql([warningOf(2)]);
            httpDrain.abortWait();
            await promise;
            instanceState.end(token, { errors: [] });
        });
        it("AC-50: the same for a window of an operation (the state ready, a stop of the flows)", async function() {
            init();
            accept(route(arrive("POST")));
            accept(route(arrive("POST")));
            accept(route(arrive("POST")));
            listen();
            const t0 = Date.now();
            const promise = httpDrain.beforeStop();
            stateEvents.should.have.length(1);
            stateEvents[0].state.should.equal("ready");
            stateEvents[0].httpDrain.should.eql({ requests: 3, since: t0, deadline: t0 + TIMEOUT });
            instanceState.get().httpDrain.requests.should.equal(3);
            noticeEvents.should.eql([warningOf(3)]);
            httpDrain.abortWait();
            await promise;
        });
        it("AC-51: no accepted open request: no event and no notification", async function() {
            init();
            route(arrive("POST"));
            arrive("GET");
            listen();
            await httpDrain.beforeStop();
            stateEvents.should.eql([]);
            noticeEvents.should.eql([]);
            should.not.exist(instanceState.get().httpDrain);
        });
        // every end of the wait: one event without the condition and one clearing notification
        const ENDS = [
            ["(a) all the requests are answered", function(r) { r.forEach(x => x.res.end("ok")) }],
            ["(b) the timeout", function() { clock.tick(TIMEOUT) }],
            ["(c) abortWait()", function() { httpDrain.abortWait() }],
            ["(e) finalize()", function() { httpDrain.finalize() }],
            ["(f) dispose()", function() { httpDrain.dispose() }],
            ["(f) init()", function() { init() }]
        ];
        ENDS.forEach(function(end) {
            it("AC-52: the wait ends by " + end[0] + ": one event without httpDrain, one clearing notification, nothing left set", async function() {
                init();
                const r = [accept(route(arrive("POST"))), accept(route(arrive("POST")))];
                const promise = httpDrain.beforeStop();
                listen();
                end[1](r);
                await promise;
                stateEvents.should.have.length(1);
                stateEvents[0].should.not.have.property("httpDrain");
                noticeEvents.should.eql([CLEARED]);
                noticeEvents[0].should.not.have.property("payload");
                should.not.exist(instanceState.get().httpDrain);
                // nothing more later
                clock.tick(10 * TIMEOUT);
                stateEvents.should.have.length(1);
                noticeEvents.should.have.length(1);
            });
        });
        it("AC-52: (d) a new beforeStop() ends the wait (the condition is cleared) and, as it waits too, sets the new one", async function() {
            init();
            accept(route(arrive("POST")));
            const first = httpDrain.beforeStop();
            listen();
            clock.tick(100);
            const second = httpDrain.beforeStop();
            await first;
            stateEvents.should.have.length(2);
            stateEvents[0].should.not.have.property("httpDrain");
            stateEvents[1].httpDrain.requests.should.equal(1);
            stateEvents[1].httpDrain.since.should.equal(START + 100);
            noticeEvents.should.eql([CLEARED, warningOf(1)]);
            instanceState.get().httpDrain.since.should.equal(START + 100);
            httpDrain.abortWait();
            await second;
            noticeEvents.should.eql([CLEARED, warningOf(1), CLEARED]);
            should.not.exist(instanceState.get().httpDrain);
        });
        it("AC-52: a wait that is not the one of beforeStop (a second end, abortWait without a wait) sends nothing more", async function() {
            init();
            accept(route(arrive("POST")));
            const promise = httpDrain.beforeStop();
            listen();
            httpDrain.abortWait();
            await promise;
            httpDrain.abortWait();
            httpDrain.finalize();
            httpDrain.dispose();
            stateEvents.should.have.length(1);
            noticeEvents.should.eql([CLEARED]);
        });
        it("AC-53: in the state stopping the condition is never set; one that was set before markStopping is cleared when the wait ends", async function() {
            init();
            const token = deploying();
            accept(route(arrive("POST")));
            const promise = httpDrain.beforeStop();
            instanceState.get().httpDrain.requests.should.equal(1);
            listen();
            instanceState.markStopping("SIGTERM");
            stateEvents.filter(e => e.state === "stopping").should.have.length(1);
            httpDrain.abortWait();
            await promise;
            should.not.exist(instanceState.get().httpDrain);
            noticeEvents.should.eql([CLEARED]);
            // later waits in the final state do not set it
            accept(route(arrive("POST")));
            await httpDrain.beforeStop();
            const w = httpDrain.waitForShutdown ? httpDrain.waitForShutdown(5000) : null;
            should.not.exist(instanceState.get().httpDrain);
            noticeEvents.should.eql([CLEARED]);
            if (w) { w.cancel() }
            instanceState.end(token, { errors: [] });
        });
        it("AC-54: the condition reload and the condition httpDrain are independent, in ready and in a pending reload that drains", async function() {
            init();
            accept(route(arrive("POST")));
            instanceState.markReloadFailed({ error: "storage_error", attempts: 2, keepReady: true });
            const reload = instanceState.get().reload;
            const promise = httpDrain.beforeStop();
            instanceState.get().reload.should.eql(reload);
            instanceState.get().httpDrain.requests.should.equal(1);
            // vice versa: the reload condition changes while the drain condition is set
            instanceState.markReloadFailed({ error: "storage_error", attempts: 3, keepReady: true });
            instanceState.get().httpDrain.requests.should.equal(1);
            instanceState.clearReloadFailed();
            instanceState.get().httpDrain.requests.should.equal(1);
            should.not.exist(instanceState.get().reload);
            instanceState.markReloadFailed({ error: "storage_error", attempts: 2, keepReady: true });
            httpDrain.abortWait();
            await promise;
            instanceState.get().reload.should.eql(reload);
            should.not.exist(instanceState.get().httpDrain);
            instanceState.clearReloadFailed();

            ready();
            httpDrain.dispose();
            init();
            accept(route(arrive("POST")));
            instanceState.markReloadPending();
            instanceState.markDraining();
            const draining = instanceState.get();
            draining.state.should.equal("reloadPending");
            draining.draining.should.be.true();
            const second = httpDrain.beforeStop();
            const during = instanceState.get();
            during.state.should.equal("reloadPending");
            during.draining.should.be.true();
            during.since.should.equal(draining.since);
            during.reason.should.equal(draining.reason);
            during.httpDrain.requests.should.equal(1);
            httpDrain.abortWait();
            await second;
            const after = instanceState.get();
            after.draining.should.be.true();
            should.not.exist(after.httpDrain);
        });
        it("AC-55: the events of the condition leave state, previous, reason, since and draining as they were (a listener that compares them does not react)", async function() {
            init();
            const token = deploying();
            accept(route(arrive("POST")));
            const before = instanceState.get();
            listen();
            const promise = httpDrain.beforeStop();
            httpDrain.abortWait();
            await promise;
            stateEvents.should.have.length(2);
            stateEvents.forEach(function(e) {
                [e.state, e.previous, e.reason, e.since, e.draining].should.eql([before.state, before.previous, before.reason, before.since, before.draining]);
            });
            instanceState.end(token, { errors: [] });
        });
        it("AC-55: a request that the hold of the requests keeps is still kept while the condition is set and cleared", async function() {
            init();
            httpHold.init({ deploy: { holdHttpNodeRequests: { enabled: true } } });
            const token = deploying();
            // a request for which the app has no route yet is held
            const req = fakeReq("GET", "/not-yet");
            req.app = { _router: { stack: [] } };
            req.path = "/not-yet";
            const res = fakeRes();
            let passed = false;
            httpHold.middleware(req, res, function() { passed = true });
            httpHold.pending().should.equal(1);
            accept(route(arrive("POST")));
            const promise = httpDrain.beforeStop();
            httpHold.pending().should.equal(1);
            httpDrain.abortWait();
            await promise;
            httpHold.pending().should.equal(1);
            passed.should.be.false();
            instanceState.end(token, { errors: [] });
            passed.should.be.true();
        });
        function readyAnswer() {
            const res = { headers: {}, setHeader: function(k, v) { this.headers[k] = v }, end: function(b) { this.body = b } };
            health.handler({ method: "GET", url: "/ready" }, res);
            return { status: res.statusCode, body: res.body };
        }
        it("AC-56: /ready answers during the condition as it does without it, in ready, deploying and reloading", async function() {
            health.init({ health: { enabled: true } });
            init();
            // ready
            const inReady = readyAnswer();
            accept(route(arrive("POST")));
            const first = httpDrain.beforeStop();
            instanceState.get().httpDrain.should.be.ok();
            readyAnswer().should.eql(inReady);
            httpDrain.abortWait();
            await first;
            // deploying
            const token = deploying();
            const inDeploying = readyAnswer();
            const second = httpDrain.beforeStop();
            instanceState.get().httpDrain.should.be.ok();
            readyAnswer().should.eql(inDeploying);
            httpDrain.abortWait();
            await second;
            instanceState.end(token, { errors: [] });
            // reloading
            instanceState.markReloadPending();
            instanceState.markDraining();
            const reloading = instanceState.begin("reload");
            instanceState.get().state.should.equal("reloading");
            const inReloading = readyAnswer();
            const third = httpDrain.beforeStop();
            instanceState.get().httpDrain.should.be.ok();
            readyAnswer().should.eql(inReloading);
            httpDrain.abortWait();
            await third;
            instanceState.end(reloading, { errors: [] });
            inReady.status.should.equal(200);
            inDeploying.status.should.equal(503);
        });
        it("AC-57: the retained notice of the editor: sent when set, retained for a session that connects meanwhile, gone after the clear", async function() {
            const comms = NR_TEST_UTILS.require("@node-red/runtime/lib/api/comms");
            comms.init({ log: { trace: function() {}, debug: function() {} } });
            init();
            accept(route(arrive("POST")));
            accept(route(arrive("POST")));
            const sent = [];
            const first = { session: "s1", user: null, send: (topic, data) => sent.push([topic, data]) };
            await comms.addConnection({ client: first });
            const promise = httpDrain.beforeStop();
            sent.filter(m => m[0] === "notification/http-drain").should.eql([["notification/http-drain", warningOf(2).payload]]);
            const late = [];
            await comms.subscribe({ client: { session: "s2", send: (topic, data) => late.push([topic, data]) }, topic: "notification/#" });
            late.filter(m => m[0] === "notification/http-drain").should.eql([["notification/http-drain", warningOf(2).payload]]);
            httpDrain.abortWait();
            await promise;
            sent.filter(m => m[0] === "notification/http-drain")[1].should.eql(["notification/http-drain", {}]);
            const after = [];
            await comms.subscribe({ client: { session: "s3", send: (topic, data) => after.push([topic, data]) }, topic: "notification/#" });
            after.filter(m => m[0] === "notification/http-drain").should.eql([]);
            await comms.removeConnection({ client: first });
        });
        ["en-US", "pl"].forEach(function(lang) {
            it("AC-57: the text of the editor " + lang + " exists and names the count and the timeout", function() {
                const file = NR_TEST_UTILS.resolve("@node-red/editor-client/locales/" + lang + "/editor.json");
                const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
                const text = catalog.notification && catalog.notification.warnings && catalog.notification.warnings.http_drain;
                should.exist(text, "notification.warnings.http_drain is missing in " + lang);
                text.should.containEql("__count__");
                text.should.containEql("__timeout__");
            });
        });
        it("AC-58: the notice has only the count and the timeout: nothing of a URL, a path or a node", async function() {
            init();
            const secret = accept(route(arrive("POST", "/private/path?token=abc123")));
            secret.req.headers = { authorization: "Bearer abc123" };
            listen();
            const promise = httpDrain.beforeStop();
            httpDrain.abortWait();
            await promise;
            noticeEvents.should.have.length(2);
            noticeEvents[0].should.eql(warningOf(1));
            JSON.stringify(noticeEvents.concat(stateEvents)).should.not.match(/private|token|abc123|path|Bearer/);
        });
        it("AC-59: listeners that throw (instance:state, runtime-event) do not change the drain: it waits, ends and answers", async function() {
            init();
            const r = accept(route(arrive("POST")));
            const late = route(arrive("POST"));
            const boom = function() { throw new Error("listener failed") };
            events.on("instance:state", boom);
            events.on("runtime-event", boom);
            const unsubscribe = instanceState.onChange(boom);
            try {
                let promise;
                (function() { promise = httpDrain.beforeStop() }).should.not.throw();
                (await settled(promise)).should.be.false();
                clock.tick(100);
                r.res.end("ok");
                (await settled(promise)).should.be.true();
                should.not.exist(instanceState.get().httpDrain);
                httpDrain.afterStop("full");
                late.res.statusCode.should.equal(503);
                // the timeout ends a wait too
                const slow = accept(route(arrive("POST")));
                const second = httpDrain.beforeStop();
                clock.tick(TIMEOUT);
                (await settled(second)).should.be.true();
                httpDrain.finalize();
                slow.res.statusCode.should.equal(503);
                should.not.exist(instanceState.get().httpDrain);
            } finally {
                events.removeListener("instance:state", boom);
                events.removeListener("runtime-event", boom);
                unsubscribe();
            }
        });
        it("AC-60: with the drain off the events of the instance state and the notices of a deployment, a reload and a stop are as without the calls of the drain", async function() {
            httpDrain.dispose();
            function run(withDrain) {
                ready();
                listen();
                const all = [];
                const onNotice = e => all.push(e);
                events.on("runtime-event", onNotice);
                listeners.push(() => events.removeListener("runtime-event", onNotice));
                const call = name => { if (withDrain) { httpDrain[name]("full") } };
                call("beforeStop");
                const token = instanceState.begin("deploy");
                call("beforeStop");
                call("afterStop");
                instanceState.end(token, { errors: [] });
                instanceState.markReloadPending();
                instanceState.markDraining();
                const reload = instanceState.begin("reload");
                call("beforeStop");
                call("afterStop");
                instanceState.end(reload, { errors: [] });
                const stopToken = instanceState.begin("set-state");
                call("beforeStop");
                call("afterStop");
                instanceState.end(stopToken, { flowsRunning: false, reason: "set-state" });
                call("finalize");
                const result = { states: stateEvents.map(e => [e.state, e.previous, e.reason, e.httpDrain]), notices: all.map(e => e.id), http: noticeEvents };
                listeners.forEach(remove => remove());
                listeners = [];
                return result;
            }
            const without = run(false);
            const withCalls = run(true);
            withCalls.should.eql(without);
            withCalls.http.should.eql([]);
            JSON.stringify(withCalls).should.not.match(/httpDrain"/);
        });
        it("AC-61: state.reset() clears the condition; what get() and the events give is a copy", async function() {
            init();
            accept(route(arrive("POST")));
            listen();
            const promise = httpDrain.beforeStop();
            const copy = instanceState.get();
            copy.httpDrain.requests = 99;
            instanceState.get().httpDrain.requests.should.equal(1);
            stateEvents[0].httpDrain.requests = 77;
            instanceState.get().httpDrain.requests.should.equal(1);
            instanceState.reset();
            should.not.exist(instanceState.get().httpDrain);
            httpDrain.abortWait();
            await promise;
        });
        it("AC-62: a clear when nothing is set and an attempt in a final state send no notification", async function() {
            init();
            const token = deploying();
            accept(route(arrive("POST")));
            const promise = httpDrain.beforeStop();
            listen();
            instanceState.markStopping("SIGTERM");
            httpDrain.abortWait();
            await promise;
            noticeEvents.should.eql([CLEARED]);
            // the condition is not set: another end sends nothing
            httpDrain.abortWait();
            httpDrain.finalize();
            noticeEvents.should.eql([CLEARED]);
            // a wait in the final state does not set it and sends nothing
            accept(route(arrive("POST")));
            await httpDrain.beforeStop();
            noticeEvents.should.eql([CLEARED]);
            instanceState.end(token, { errors: [] });
        });
    });
    // #82 (S-6): one warning at start (init) when the drain is enabled with a timeout above 300000 ms
    describe("the warning of a very large timeout (S-6, #82)", function() {
        function longWarnings() {
            return log.warn.args.map(a => a[0]).filter(m => String(m).indexOf("httpDrain.long-timeout") !== -1);
        }
        function initWith(drain) {
            httpDrain.init({ deploy: { drainHttpNodeRequests: drain } });
        }

        it("AC-80: a timeout above 300000 (also the largest accepted one) gives one warning per init and the drain uses that timeout", async function() {
            [300001, 2147483647].forEach(function(timeout) {
                log.warn.resetHistory();
                initWith({ enabled: true, timeout: timeout });
                longWarnings().should.eql(['httpDrain.long-timeout {"timeout":' + timeout + ',"limit":300000}']);
                // the value is used as it is
                log.info.resetHistory();
                accept(route(arrive("POST")));
                httpDrain.beforeStop();
                log.info.args.map(a => a[0]).join("\n").should.containEql('"timeout":' + timeout);
                httpDrain.dispose();
            });
        });
        it("AC-81: no timeout, 30000 and 300000 give no warning", function() {
            [{ enabled: true }, { enabled: true, timeout: 30000 }, { enabled: true, timeout: 300000 }].forEach(function(drain) {
                initWith(drain);
                longWarnings().should.eql([]);
            });
        });
        it("AC-82: the drain disabled or absent and invalid timeouts give no warning of this kind; the other warnings are as before", function() {
            initWith({ enabled: false, timeout: 9999999 });
            httpDrain.init({});
            httpDrain.init(undefined);
            initWith("yes");
            longWarnings().should.eql([]);
            log.warn.resetHistory();
            [-1, "x", 2147483648].forEach(function(timeout) {
                initWith({ enabled: true, timeout: timeout });
            });
            longWarnings().should.eql([]);
            // as before: one warning of the invalid option per call
            log.warn.args.map(a => a[0]).filter(m => /httpDrain.invalid-option/.test(m)).should.have.length(3);
            log.warn.callCount.should.equal(3);
        });
        it("AC-83: two init calls give one warning each; the stops and the guard give none", async function() {
            initWith({ enabled: true, timeout: 600000 });
            initWith({ enabled: true, timeout: 600000 });
            longWarnings().should.have.length(2);
            const r = accept(route(arrive("POST")));
            const promise = httpDrain.beforeStop();
            clock.tick(1000);
            r.res.end("ok");
            await promise;
            httpDrain.afterStop("partial");
            httpDrain.afterStop("full");
            httpDrain.finalize();
            clock.tick(10 * 60 * 1000);
            longWarnings().should.have.length(2);
        });
    });
    // #82 (S-P): `isWaitedFor(entry)` = open, accepted and on a route with the mark: one definition for the wait of
    // beforeStop, the snapshot of the shutdown and the count of the condition
    describe("what is waited for (S-P, #82)", function() {
        // accepted on a marked route (waited for), a marked route that is not accepted, an unmarked route that is
        // not accepted (a request of a node in the mode "long") and an unmarked route whose handler accepted the
        // request (a node that follows the contract on a route it does not mark)
        function four() {
            const unmarked = [function other() {}];
            return {
                waited: accept(route(arrive("POST"))),
                notAccepted: route(arrive("POST")),
                long: route(arrive("POST"), unmarked),
                unmarkedAccepted: accept(route(arrive("POST"), unmarked))
            };
        }
        function infoCount(key) {
            const found = log.info.args.map(a => a[0]).filter(m => m.indexOf(key + " ") !== -1);
            found.should.have.length(1, key);
            return JSON.parse(found[0].slice(found[0].indexOf("{"))).count;
        }

        it("AC-46: the wait of beforeStop counts only the accepted request on a marked route", async function() {
            init();
            const r = four();
            const promise = httpDrain.beforeStop();
            infoCount("httpDrain.waiting").should.equal(1);
            (await settled(promise)).should.be.false();
            r.waited.res.end("ok");
            (await settled(promise)).should.equal(true, "the wait is held by a request that is not waited for");
        });
        it("AC-46: the snapshot of the shutdown counts only the accepted request on a marked route", async function() {
            init();
            const r = four();
            assert.strictEqual(typeof httpDrain.waitForShutdown, "function", "httpDrain.waitForShutdown is not defined");
            const w = httpDrain.waitForShutdown(5000);
            infoCount("httpDrain.shutdown-waiting").should.equal(1);
            (await settled(w.promise)).should.be.false();
            r.waited.res.end("ok");
            (await settled(w.promise)).should.equal(true, "the wait is held by a request that is not waited for");
        });
        it("AC-46: the condition of the instance state and the notice count only the accepted request on a marked route", async function() {
            init();
            const r = four();
            const notices = [];
            const onNotice = e => { if (e && e.id === "http-drain") { notices.push(e) } };
            events.on("runtime-event", onNotice);
            try {
                const promise = httpDrain.beforeStop();
                const condition = instanceState.get().httpDrain;
                should.exist(condition, "the condition is not set");
                condition.requests.should.equal(1);
                notices.should.have.length(1);
                notices[0].payload.count.should.equal(1);
                httpDrain.abortWait();
                await promise;
            } finally {
                events.removeListener("runtime-event", onNotice);
            }
            r.waited.res.end("ok");
        });
        it("AC-46: the three uses agree at the same time and a request that is not waited for never holds any of them", async function() {
            init();
            const r = four();
            assert.strictEqual(typeof httpDrain.waitForShutdown, "function", "httpDrain.waitForShutdown is not defined");
            const deployment = httpDrain.beforeStop();
            const shutdown = httpDrain.waitForShutdown(5000);
            infoCount("httpDrain.waiting").should.equal(1);
            infoCount("httpDrain.shutdown-waiting").should.equal(1);
            instanceState.get().httpDrain.requests.should.equal(1);
            r.waited.res.end("ok");
            (await settled(deployment)).should.be.true();
            (await settled(shutdown.promise)).should.be.true();
            r.notAccepted.res.writableEnded.should.be.false();
            r.long.res.writableEnded.should.be.false();
            r.unmarkedAccepted.res.writableEnded.should.be.false();
        });
        it("AC-46: only requests that are not waited for: beforeStop and the shutdown resolve at once, nothing is set", async function() {
            init();
            const unmarked = [function other() {}];
            route(arrive("POST"));
            route(arrive("POST"), unmarked);
            accept(route(arrive("POST"), unmarked));
            const deployment = httpDrain.beforeStop();
            (await settled(deployment)).should.be.true();
            should.not.exist(instanceState.get().httpDrain);
            assert.strictEqual(typeof httpDrain.waitForShutdown, "function", "httpDrain.waitForShutdown is not defined");
            (await settled(httpDrain.waitForShutdown(5000).promise)).should.be.true();
            log.info.args.map(a => a[0]).join("\n").should.not.match(/waiting/);
        });
        it("a request that is accepted and whose route getter throws is not waited for and nothing throws", async function() {
            init();
            const r = accept(arrive("POST"));
            Object.defineProperty(r.req, "route", { get: function() { throw new Error("route getter") }, configurable: true });
            const deployment = httpDrain.beforeStop();
            (await settled(deployment)).should.be.true();
            should.not.exist(instanceState.get().httpDrain);
            log.info.args.map(a => a[0]).join("\n").should.not.match(/httpDrain.waiting/);
            assert.strictEqual(typeof httpDrain.waitForShutdown, "function", "httpDrain.waitForShutdown is not defined");
            (await settled(httpDrain.waitForShutdown(5000).promise)).should.be.true();
            log.info.args.map(a => a[0]).join("\n").should.not.match(/shutdown-waiting/);
        });
    });
});

// #82 (S-1): the same with a real Express app, a real HTTP server and real clients (no fake timers: the
// requests are cut by afterStop("full"), no wait runs)
describe("runtime/httpDrain with a real Express app (S-1, #82)", function() {
    const ANSWERED = "httpDrain.answered-request";
    let app;
    let server;
    let port;
    let inFlight;

    function node(id) {
        return { id: id, type: "x in", z: "f" };
    }
    // a marked handler that accepts the request and never answers it
    function accepting() {
        const handler = function(req, res) { inFlight++; req[S].accepted = true };
        handler[S] = true;
        return handler;
    }
    function passing() {
        const handler = function(req, res, next) { next("route") };
        handler[S] = true;
        return handler;
    }
    function client(method, path) {
        return new Promise(function(resolve) {
            const req = http.request({ host: "127.0.0.1", port: port, method: method, path: path, agent: false, headers: { Connection: "close" } }, function(res) {
                const chunks = [];
                res.on("data", d => chunks.push(d));
                res.on("end", function() {
                    let json;
                    try { json = JSON.parse(Buffer.concat(chunks).toString()) } catch (err) { json = undefined }
                    resolve({ status: res.statusCode, body: json });
                });
            });
            req.on("error", err => resolve({ error: err.message }));
            req.end();
        });
    }
    async function until(condition, what) {
        const started = Date.now();
        while (!condition()) {
            if (Date.now() - started > 5000) {
                throw new Error("timeout waiting for " + what);
            }
            await new Promise(resolve => setTimeout(resolve, 5));
        }
    }
    function records() {
        return log.log.args.map(a => a[0]).filter(e => e && e.level === log.DEBUG && String(e.msg).indexOf(ANSWERED) !== -1);
    }
    function plainRecords() {
        return log.debug.args.filter(a => String(a[0]).indexOf(ANSWERED) !== -1);
    }

    beforeEach(async function() {
        sinon.stub(log, "warn");
        sinon.stub(log, "info");
        sinon.stub(log, "debug");
        sinon.stub(log, "log");
        sinon.stub(log, "_").callsFake((key, v) => key + (v ? " " + JSON.stringify(v) : ""));
        instanceState.reset();
        instanceState.markStarting();
        instanceState.report({ errors: [] });
        httpDrain.init({ deploy: { drainHttpNodeRequests: { enabled: true, timeout: 30000 } } });
        inFlight = 0;
        app = express();
        app.use(httpDrain.middleware);
        httpRoutes.init(app);
        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        port = server.address().port;
    });
    afterEach(async function() {
        httpDrain.dispose();
        httpRoutes.init(null);
        instanceState.reset();
        if (server.closeAllConnections) {
            server.closeAllConnections();
        }
        await new Promise(resolve => server.close(resolve));
        sinon.restore();
    });

    it("AC-6: owned A calls next('route') to owned B on the same method and path: the record names B", async function() {
        httpRoutes.register(node("a"), "post", "/dual", [passing()]);
        httpRoutes.register(node("b"), "post", "/dual", [accepting()]);
        const pending = client("POST", "/dual");
        await until(() => inFlight === 1, "the request in B");
        httpDrain.afterStop("full");
        (await pending).status.should.equal(503);
        records().map(e => e.id).should.eql(["b"]);
    });
    it("AC-7: owned A (registered first) and B: the request matched by A is reported with A", async function() {
        httpRoutes.register(node("a"), "post", "/dual", [accepting()]);
        httpRoutes.register(node("b"), "post", "/dual", [accepting()]);
        const pending = client("POST", "/dual");
        await until(() => inFlight === 1, "the request in A");
        httpDrain.afterStop("full");
        (await pending).status.should.equal(503);
        records().map(e => e.id).should.eql(["a"]);
    });
    it("AC-14: 200 requests of an owned route and one of a route of app.post: all get 503 outcome unknown, 200 records with the id, one in the plain form", async function() {
        this.timeout(20000);
        httpRoutes.register(node("r1"), "post", "/p", [accepting()]);
        app.post("/q", accepting());
        const all = [];
        // in batches: a burst of connections above the backlog of the listener (128) is delayed by the system
        for (let i = 0; i < 200; i++) {
            all.push(client("POST", "/p"));
            if ((i + 1) % 50 === 0) {
                await until(() => inFlight === i + 1, (i + 1) + " requests in the handlers");
            }
        }
        all.push(client("POST", "/q"));
        await until(() => inFlight === 201, "201 requests in the handlers");
        httpDrain.afterStop("full");
        const results = await Promise.all(all);
        results.forEach(function(result) {
            should.not.exist(result.error);
            result.status.should.equal(503);
            result.body.code.should.equal("http_drain_outcome_unknown");
        });
        const list = records();
        list.should.have.length(200);
        list.forEach(e => { e.id.should.equal("r1"); e.type.should.equal("x in"); e.z.should.equal("f") });
        plainRecords().should.have.length(1);
    });
});
