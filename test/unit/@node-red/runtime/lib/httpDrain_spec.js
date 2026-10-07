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
        for (let i = 0; i < 200; i++) {
            all.push(client("POST", "/p"));
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
