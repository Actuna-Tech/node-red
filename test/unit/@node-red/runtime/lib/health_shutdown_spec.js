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
 *   Z-08: tests of the drain on shutdown (shutdownTimeout, preShutdown hook)
 *   Z-16: tests of health.unreadyGrace on shutdown
 *   #61: test of a preShutdown handler that rejects without a value
 *   #76: a preShutdown handler that rejects with a value that cannot be printed
 *   #82: tests of the wait for the HTTP requests of the drain inside shutdownTimeout (S-3)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const NR_TEST_UTILS = require("nr-test-utils");
const health = NR_TEST_UTILS.require("@node-red/runtime/lib/health");
const state = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
const { log, hooks } = NR_TEST_UTILS.require("@node-red/util");

describe("runtime/health shutdown (Z-08, D-11)", function() {
    let order;
    let stop;
    let clock;

    beforeEach(function() {
        state.reset();
        state.markStarting();
        state.report({ errors: [] });
        hooks.clear();
        order = [];
        stop = sinon.spy(async function(reason) {
            order.push("stop:" + reason + ":" + state.get().state);
        });
        sinon.stub(log, "info");
        sinon.stub(log, "warn");
        sinon.stub(log, "_").callsFake(key => key);
        sinon.stub(log, "error");
    });
    afterEach(function() {
        if (clock) {
            clock.restore();
            clock = null;
        }
        hooks.clear();
        sinon.restore();
        state.reset();
    });

    function flush() {
        return new Promise(resolve => setImmediate(resolve));
    }

    it("shutdown sets stopping before preShutdown", async function() {
        health.init({ shutdownTimeout: 1000 });
        hooks.add("preShutdown", function(payload) {
            order.push("hook:" + state.get().state + ":" + state.isReady());
        });
        await health.shutdown({ reason: "SIGTERM", signal: "SIGTERM", stop: stop });
        order.should.eql(["hook:stopping:false", "stop:SIGTERM:stopping"]);
    });

    it("passes {reason, deadline, signal} to preShutdown", async function() {
        health.init({ shutdownTimeout: 1000 });
        let payload;
        hooks.add("preShutdown", function(p) { payload = p });
        const before = Date.now();
        await health.shutdown({ reason: "SIGTERM", signal: "SIGTERM", stop: stop });
        payload.should.have.property("reason", "SIGTERM");
        payload.should.have.property("signal", "SIGTERM");
        payload.deadline.should.be.within(before + 1000, Date.now() + 1000);
    });

    it("waits for preShutdown before RED.stop", async function() {
        health.init({ shutdownTimeout: 60000 });
        let finish;
        hooks.add("preShutdown", function(payload) { return new Promise(resolve => { finish = resolve }) });
        const done = health.shutdown({ reason: "SIGTERM", stop: stop });
        await flush();
        stop.called.should.be.false();
        state.get().state.should.equal("stopping");
        log.info.calledWithMatch("health.draining").should.be.true();
        finish();
        await done;
        stop.calledOnce.should.be.true();
    });

    it("shutdownTimeout proceeds with a warning", async function() {
        clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        health.init({ shutdownTimeout: 200 });
        hooks.add("preShutdown", function(payload) { return new Promise(() => {}) });
        const done = health.shutdown({ reason: "SIGTERM", stop: stop });
        await Promise.resolve();
        stop.called.should.be.false();
        await clock.tickAsync(199);
        stop.called.should.be.false();
        await clock.tickAsync(1);
        await done;
        stop.calledOnce.should.be.true();
        log.warn.calledWithMatch("health.shutdown-timeout").should.be.true();
    });

    it("preShutdown error proceeds with an error log", async function() {
        health.init({ shutdownTimeout: 1000 });
        hooks.add("preShutdown", function(payload) { return Promise.reject(new Error("boom")) });
        await health.shutdown({ reason: "SIGTERM", stop: stop });
        stop.calledOnce.should.be.true();
        log.error.calledWithMatch("health.shutdown-hook-failed").should.be.true();
    });

    it("AC-8: a preShutdown handler that rejects with undefined proceeds with an error log and is called once (#61)", async function() {
        health.init({ shutdownTimeout: 1000 });
        // rejects on the first call only: with the defect the second call shows up in the count
        // instead of an endless loop
        const hook = sinon.spy(function(payload) {
            return hook.callCount === 1 ? Promise.reject(undefined) : Promise.resolve();
        });
        log._.callsFake((key, params) => key + (params ? " " + params.message : ""));
        hooks.add("preShutdown", hook);
        await health.shutdown({ reason: "SIGTERM", stop: stop });
        stop.calledOnce.should.be.true();
        log.error.calledOnce.should.be.true();
        log.error.firstCall.args[0].should.startWith("health.shutdown-hook-failed");
        log.error.firstCall.args[0].should.containEql("Hook handler rejected without an error: undefined");
        hook.calledOnce.should.be.true();
    });

    [
        {name: "Object.create(null)", make: function() { return Object.create(null) }},
        {name: "a Proxy that throws on every get", make: function() { return new Proxy({}, {get: function() { throw new Error("p") }}) }},
        {name: "an Error with a throwing getter of message", make: function() {
            const err = new Error("x");
            Object.defineProperty(err, "message", {get: function() { throw new Error("getter of message") }});
            return err;
        }}
    ].forEach(function(v) {
        it("AC-22 (#76): a preShutdown handler that rejects with " + v.name + " proceeds at once with one error log and no unhandled rejection", async function() {
            const unhandled = [];
            const onUnhandled = function(reason) { unhandled.push(reason) };
            process.on("unhandledRejection", onUnhandled);
            clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
            try {
                health.init({ shutdownTimeout: 1000 });
                log._.callsFake((key, params) => key + (params ? " " + params.message : ""));
                hooks.add("preShutdown", function(payload) { return Promise.reject(v.make()) });
                const done = health.shutdown({ reason: "SIGTERM", stop: stop });
                await clock.tickAsync(0);
                await flush();
                await clock.tickAsync(0);
                stop.calledOnce.should.be.true("RED.stop was not called before shutdownTimeout");
                // lets a shutdown that waits for the limit end, so that nothing is left behind
                await clock.tickAsync(2000);
                await done;
                await flush();
                log.error.calledOnce.should.be.true();
                log.error.firstCall.args[0].should.equal("health.shutdown-hook-failed (the value cannot be printed)");
                log.warn.calledWithMatch("health.shutdown-timeout").should.be.false();
                unhandled.should.eql([]);
            } finally {
                process.removeListener("unhandledRejection", onUnhandled);
            }
        });
    });

    it("no hook - no wait", async function() {
        clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        health.init({ shutdownTimeout: 60000 });
        await health.shutdown({ reason: "SIGTERM", stop: stop });
        stop.calledOnce.should.be.true();
        log.info.calledWithMatch("health.draining").should.be.false();
    });

    it("no shutdownTimeout - no drain and preShutdown is not invoked (R-22, R-37)", async function() {
        health.init({});
        const hook = sinon.spy(function() { return new Promise(() => {}) });
        hooks.add("preShutdown", hook);
        await health.shutdown({ reason: "SIGTERM", stop: stop });
        hook.called.should.be.false();
        stop.calledOnce.should.be.true();
        order.should.eql(["stop:SIGTERM:stopping"]);
    });

    it("an invalid shutdownTimeout disables the drain", async function() {
        for (const value of [0, -1, "1000", null]) {
            state.reset();
            stop.resetHistory();
            health.init({ shutdownTimeout: value });
            const hook = sinon.spy();
            hooks.clear();
            hooks.add("preShutdown", hook);
            await health.shutdown({ reason: "SIGTERM", stop: stop });
            hook.called.should.be.false();
            stop.calledOnce.should.be.true();
        }
    });

    it("second signal stops immediately (R-22)", async function() {
        health.init({ shutdownTimeout: 60000 });
        hooks.add("preShutdown", function(payload) { return new Promise(() => {}) });
        const done = health.shutdown({ reason: "SIGTERM", signal: "SIGTERM", stop: stop });
        await flush();
        stop.called.should.be.false();
        const second = health.shutdown({ reason: "SIGTERM", signal: "SIGTERM", stop: stop });
        await done;
        await second;
        stop.calledOnce.should.be.true();
    });

    it("a call after the drain does not stop again", async function() {
        health.init({});
        await health.shutdown({ reason: "SIGTERM", stop: stop });
        await health.shutdown({ reason: "SIGINT", stop: stop });
        stop.calledOnce.should.be.true();
    });

    it("RED.stop receives the signal as reason (R-23) and the reason defaults to shutdown", async function() {
        health.init({});
        await health.shutdown({ reason: "SIGINT", stop: stop });
        stop.firstCall.args.should.eql(["SIGINT"]);
        state.get().reason.should.equal("SIGINT");
        health.init({});
        state.reset();
        stop.resetHistory();
        await health.shutdown({ stop: stop });
        stop.firstCall.args.should.eql(["shutdown"]);
    });

    it("a failing RED.stop rejects the shutdown", async function() {
        health.init({});
        await health.shutdown({ reason: "SIGTERM", stop: async () => { throw new Error("stop failed") } }).should.be.rejectedWith("stop failed");
    });

    describe("health.unreadyGrace (Z-16)", function() {
        function fakeTime() {
            clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        }
        function initWith(unreadyGrace, extra) {
            health.init(Object.assign({ health: { enabled: true, unreadyGrace: unreadyGrace } }, extra || {}));
        }

        it("not set - the flows stop at once (unchanged)", async function() {
            fakeTime();
            health.init({ health: { enabled: true } });
            const done = health.shutdown({ reason: "SIGTERM", stop: stop });
            await clock.tickAsync(0);
            await done;
            stop.calledOnce.should.be.true();
            log.info.calledWithMatch("health.unready-grace").should.be.false();
        });

        it("waits at least the grace after /ready turned 503 before the stop", async function() {
            fakeTime();
            initWith(500);
            const done = health.shutdown({ reason: "SIGTERM", stop: stop });
            state.isReady().should.be.false();
            await clock.tickAsync(499);
            stop.called.should.be.false();
            state.isReady().should.be.false();
            await clock.tickAsync(1);
            await done;
            stop.calledOnce.should.be.true();
            log.info.calledWithMatch("health.unready-grace").should.be.true();
        });

        it("runs in parallel with preShutdown: a longer hook adds no wait", async function() {
            fakeTime();
            initWith(500, { shutdownTimeout: 10000 });
            hooks.add("preShutdown", function(payload) { return new Promise(resolve => setTimeout(resolve, 800)) });
            const done = health.shutdown({ reason: "SIGTERM", stop: stop });
            await clock.tickAsync(799);
            stop.called.should.be.false();
            await clock.tickAsync(1);
            await done;
            stop.calledOnce.should.be.true();
            // not 800 + 500
            Date.now().should.equal(800);
        });

        it("a shorter hook still waits for the grace", async function() {
            fakeTime();
            initWith(500, { shutdownTimeout: 10000 });
            hooks.add("preShutdown", function(payload) { return new Promise(resolve => setTimeout(resolve, 100)) });
            const done = health.shutdown({ reason: "SIGTERM", stop: stop });
            await clock.tickAsync(499);
            stop.called.should.be.false();
            await clock.tickAsync(1);
            await done;
            stop.calledOnce.should.be.true();
        });

        it("a failing hook does not shorten the grace", async function() {
            fakeTime();
            initWith(500, { shutdownTimeout: 10000 });
            hooks.add("preShutdown", function(payload) { return Promise.reject(new Error("boom")) });
            const done = health.shutdown({ reason: "SIGTERM", stop: stop });
            await clock.tickAsync(499);
            stop.called.should.be.false();
            log.error.calledWithMatch("health.shutdown-hook-failed").should.be.true();
            await clock.tickAsync(1);
            await done;
            stop.calledOnce.should.be.true();
        });

        it("without shutdownTimeout the hook is not called (R-37) and the shutdown waits exactly the grace", async function() {
            fakeTime();
            initWith(500);
            const hook = sinon.spy(function() { return new Promise(() => {}) });
            hooks.add("preShutdown", hook);
            const done = health.shutdown({ reason: "SIGTERM", stop: stop });
            await clock.tickAsync(499);
            stop.called.should.be.false();
            await clock.tickAsync(1);
            await done;
            stop.calledOnce.should.be.true();
            hook.called.should.be.false();
            Date.now().should.equal(500);
            log.info.calledWithMatch("health.draining").should.be.false();
        });

        it("is counted inside shutdownTimeout: capped by it", async function() {
            fakeTime();
            initWith(5000, { shutdownTimeout: 300 });
            const done = health.shutdown({ reason: "SIGTERM", stop: stop });
            await clock.tickAsync(299);
            stop.called.should.be.false();
            await clock.tickAsync(1);
            await done;
            stop.calledOnce.should.be.true();
            Date.now().should.equal(300);
        });

        it("capped by shutdownTimeout also with a hook that never completes", async function() {
            fakeTime();
            initWith(5000, { shutdownTimeout: 300 });
            hooks.add("preShutdown", function(payload) { return new Promise(() => {}) });
            const done = health.shutdown({ reason: "SIGTERM", stop: stop });
            await clock.tickAsync(300);
            await done;
            stop.calledOnce.should.be.true();
            Date.now().should.equal(300);
            log.warn.calledWithMatch("health.shutdown-timeout").should.be.true();
        });

        it("a second signal ends the grace at once", async function() {
            fakeTime();
            initWith(60000);
            const done = health.shutdown({ reason: "SIGTERM", signal: "SIGTERM", stop: stop });
            await clock.tickAsync(100);
            stop.called.should.be.false();
            const second = health.shutdown({ reason: "SIGTERM", signal: "SIGTERM", stop: stop });
            await done;
            await second;
            stop.calledOnce.should.be.true();
            Date.now().should.equal(100);
            clock.countTimers().should.equal(0);
        });

        it("no timer is left after the grace", async function() {
            fakeTime();
            initWith(200);
            const done = health.shutdown({ reason: "SIGTERM", stop: stop });
            await clock.tickAsync(200);
            await done;
            clock.countTimers().should.equal(0);
        });

        it("invalid values: a warning and no grace", async function() {
            fakeTime();
            for (const value of [-1, "500", NaN, Infinity, {}, true]) {
                state.reset();
                state.markStarting();
                state.report({ errors: [] });
                stop.resetHistory();
                log.warn.resetHistory();
                initWith(value);
                log.warn.calledWithMatch("health.invalid-unready-grace").should.be.true();
                const done = health.shutdown({ reason: "SIGTERM", stop: stop });
                await clock.tickAsync(0);
                await done;
                stop.calledOnce.should.be.true();
            }
        });

        it("0 means off, without a warning", async function() {
            fakeTime();
            initWith(0);
            log.warn.called.should.be.false();
            const done = health.shutdown({ reason: "SIGTERM", stop: stop });
            await clock.tickAsync(0);
            await done;
            stop.calledOnce.should.be.true();
        });

        it("without health.enabled: a warning and no grace", async function() {
            fakeTime();
            health.init({ health: { unreadyGrace: 500 } });
            log.warn.calledWithMatch("health.unready-grace-without-probes").should.be.true();
            const done = health.shutdown({ reason: "SIGTERM", stop: stop });
            await clock.tickAsync(0);
            await done;
            stop.calledOnce.should.be.true();
        });

        it("resolveUnreadyGrace reads the setting without logging", function() {
            health.resolveUnreadyGrace({}).ms.should.equal(0);
            health.resolveUnreadyGrace({ health: { enabled: true, unreadyGrace: 250 } }).ms.should.equal(250);
            health.resolveUnreadyGrace({ health: { enabled: true, unreadyGrace: "x" } }).should.eql({ ms: 0, problem: "invalid" });
            health.resolveUnreadyGrace({ health: { unreadyGrace: 250 } }).should.eql({ ms: 0, problem: "no-probes" });
            log.warn.called.should.be.false();
        });
    });
    // #82 (S-3): the shutdown waits for the HTTP requests that are in progress (`httpDrain.waitForShutdown`),
    // inside shutdownTimeout. A fresh health.init per test; the real drain, fake time, a spy for stop
    describe("the wait for the HTTP requests (S-3, #82)", function() {
        const EventEmitter = require("events");
        const httpDrain = NR_TEST_UTILS.require("@node-red/runtime/lib/httpDrain");
        const S = httpDrain.S;
        let stopTimes;

        function fakeTime() {
            clock = sinon.useFakeTimers({ now: 1000, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
        }
        function markedRoute() {
            const handler = function() {};
            handler[S] = true;
            return { stack: [{ handle: handler }] };
        }
        function fakeRes() {
            const res = new EventEmitter();
            const headers = {};
            Object.assign(res, { statusCode: 200, headersSent: false, writableEnded: false, destroyed: false, body: undefined });
            res.getHeaderNames = () => Object.keys(headers);
            res.setHeader = (name, value) => { headers[name.toLowerCase()] = value };
            res.removeHeader = name => { delete headers[name.toLowerCase()] };
            res.end = function(body) {
                this.body = body;
                this.writableEnded = true;
                this.headersSent = true;
                this.emit("finish");
                return this;
            };
            res.destroy = function() { this.destroyed = true; this.emit("close") };
            return res;
        }
        // a request that entered the app; `accepted`, `routed`
        function request(options) {
            options = options || {};
            const req = new EventEmitter();
            Object.assign(req, { method: "POST", url: "/x", complete: true, route: options.routed === false ? null : markedRoute() });
            req.resume = function() {};
            const res = fakeRes();
            httpDrain.middleware(req, res, function() {});
            if (options.accepted !== false) {
                req[S].accepted = true;
            }
            return { req, res };
        }
        function enableDrain(timeout) {
            httpDrain.init({ deploy: { drainHttpNodeRequests: { enabled: true, timeout: timeout || 1000 } } });
        }
        function logsOf(stub, key) {
            return stub.args.map(a => a[0]).filter(m => String(m).indexOf(key) !== -1);
        }
        function shutdownLogs() {
            return logsOf(log.info, "httpDrain.shutdown-").concat(logsOf(log.warn, "httpDrain.shutdown-"));
        }
        function needWait() {
            if (typeof httpDrain.waitForShutdown !== "function") {
                throw new Error("httpDrain.waitForShutdown is not defined");
            }
        }
        function start(options) {
            return health.shutdown(Object.assign({ reason: "SIGTERM", signal: "SIGTERM", stop: stop }, options || {}));
        }

        beforeEach(function() {
            fakeTime();
            stopTimes = [];
            stop = sinon.spy(async function(reason) {
                stopTimes.push(Date.now() - 1000);
                order.push("stop:" + reason);
            });
            log._.callsFake((key, v) => key + (v ? " " + JSON.stringify(v) : ""));
        });
        afterEach(function() {
            httpDrain.dispose();
        });

        it("AC-30: waits for the accepted request, which the flow answers at +300 ms; stop is called after the answer; one info log", async function() {
            health.init({ shutdownTimeout: 5000 });
            enableDrain(1000);
            const r = request();
            const done = start();
            await clock.tickAsync(299);
            stop.called.should.be.false();
            r.res.statusCode = 200;
            await clock.tickAsync(1);
            r.res.end("answer of the flow");
            await clock.tickAsync(0);
            await done;
            stop.calledOnce.should.be.true();
            stopTimes[0].should.be.within(300, 300 + 250);
            r.res.body.should.equal("answer of the flow");
            r.res.statusCode.should.equal(200);
            logsOf(log.info, "httpDrain.shutdown-waiting").should.eql(['httpDrain.shutdown-waiting {"count":1,"timeout":1000}']);
            logsOf(log.warn, "httpDrain.shutdown-timeout").should.eql([]);
            clock.countTimers().should.equal(0);
        });
        it("AC-31: a request that is never answered: stop at +1000 ms with a warning; finalize then gives the client 503 outcome unknown", async function() {
            health.init({ shutdownTimeout: 5000 });
            enableDrain(1000);
            const r = request();
            const done = start();
            await clock.tickAsync(999);
            stop.called.should.be.false();
            await clock.tickAsync(1);
            await done;
            stopTimes.should.eql([1000]);
            logsOf(log.warn, "httpDrain.shutdown-timeout").should.eql(['httpDrain.shutdown-timeout {"count":1}']);
            httpDrain.finalize();
            r.res.statusCode.should.equal(503);
            JSON.parse(r.res.body).code.should.equal("http_drain_outcome_unknown");
        });
        it("AC-32: shutdownTimeout 800 with a drain timeout of 1000: stop at +800 ms", async function() {
            health.init({ shutdownTimeout: 800 });
            enableDrain(1000);
            request();
            const done = start();
            await clock.tickAsync(799);
            stop.called.should.be.false();
            await clock.tickAsync(1);
            await done;
            stopTimes.should.eql([800]);
            logsOf(log.info, "httpDrain.shutdown-waiting").should.eql(['httpDrain.shutdown-waiting {"count":1,"timeout":800}']);
        });
        it("AC-33: after the grace (500 ms) and a hook that ends at +200 ms the snapshot is taken: a request accepted at +400 ms is waited for", async function() {
            health.init({ shutdownTimeout: 5000, health: { enabled: true, unreadyGrace: 500 } });
            enableDrain(3000);
            hooks.add("preShutdown", function(payload) { return new Promise(resolve => setTimeout(resolve, 200)) });
            const done = start();
            await clock.tickAsync(400);
            const r = request();
            await clock.tickAsync(99);
            logsOf(log.info, "httpDrain.shutdown-waiting").should.eql([]);
            await clock.tickAsync(1);
            logsOf(log.info, "httpDrain.shutdown-waiting").should.eql(['httpDrain.shutdown-waiting {"count":1,"timeout":3000}']);
            await clock.tickAsync(200);
            stop.called.should.be.false();
            r.res.end("ok");
            await clock.tickAsync(0);
            await done;
            stopTimes.should.eql([700]);
            stopTimes[0].should.be.below(5000);
        });
        it("AC-34: a hook that does not end within shutdownTimeout: stop at the timeout with the warning of the hook, no wait of the requests", async function() {
            health.init({ shutdownTimeout: 300 });
            enableDrain(1000);
            hooks.add("preShutdown", function(payload) { return new Promise(() => {}) });
            request();
            const done = start();
            await clock.tickAsync(299);
            stop.called.should.be.false();
            await clock.tickAsync(1);
            await done;
            stopTimes.should.eql([300]);
            logsOf(log.warn, "health.shutdown-timeout").should.have.length(1);
            shutdownLogs().should.eql([]);
            clock.tick(5000);
            stopTimes.should.eql([300]);
        });
        it("AC-35: a second shutdown() during the wait of the requests (after the grace and the hook) calls stop at once, both return the same promise", async function() {
            health.init({ shutdownTimeout: 5000, health: { enabled: true, unreadyGrace: 200 } });
            enableDrain(3000);
            request();
            const first = start();
            await clock.tickAsync(250);
            logsOf(log.info, "httpDrain.shutdown-waiting").should.have.length(1);
            stop.called.should.be.false();
            const second = start();
            second.should.equal(first);
            await first;
            stopTimes.should.eql([250]);
            clock.countTimers().should.equal(0);
        });
        it("AC-42 (R-22): without grace and hook a second shutdown() ends the wait of the requests at once; the same promise", async function() {
            health.init({ shutdownTimeout: 5000 });
            enableDrain(3000);
            request();
            const first = start();
            await clock.tickAsync(100);
            stop.called.should.be.false();
            const second = start();
            second.should.equal(first);
            await first;
            stopTimes.should.eql([100]);
            stop.calledOnce.should.be.true();
            clock.countTimers().should.equal(0);
        });
        it("REV-002 (R-22): a second shutdown() during the grace, with the drain on and an accepted request, skips the wait for the requests", async function() {
            health.init({ shutdownTimeout: 5000, health: { enabled: true, unreadyGrace: 500 } });
            enableDrain(3000);
            request();
            const first = start();
            await clock.tickAsync(100);
            stop.called.should.be.false();
            const second = start();
            second.should.equal(first);
            await first;
            stopTimes.should.eql([100]);
            logsOf(log.info, "httpDrain.shutdown-waiting").should.eql([]);
            shutdownLogs().should.eql([]);
            clock.countTimers().should.equal(0);
        });
        it("REV-002 (R-22): the same during a hook that does not end", async function() {
            health.init({ shutdownTimeout: 5000 });
            enableDrain(3000);
            hooks.add("preShutdown", function(payload) { return new Promise(() => {}) });
            request();
            const first = start();
            await clock.tickAsync(100);
            const second = start();
            await first;
            second.should.equal(first);
            stopTimes.should.eql([100]);
            logsOf(log.info, "httpDrain.shutdown-waiting").should.eql([]);
            clock.countTimers().should.equal(0);
        });
        it("AC-36: a request that is not accepted is not waited for", async function() {
            health.init({ shutdownTimeout: 5000 });
            enableDrain(1000);
            request({ accepted: false });
            const done = start();
            await clock.tickAsync(0);
            await done;
            stopTimes.should.eql([0]);
            shutdownLogs().should.eql([]);
        });
        it("AC-36: a request accepted after the snapshot is not waited for; the one of the snapshot is", async function() {
            health.init({ shutdownTimeout: 5000 });
            enableDrain(3000);
            const first = request();
            const done = start();
            await clock.tickAsync(100);
            const late = request();
            first.res.end("ok");
            await clock.tickAsync(0);
            await done;
            stopTimes.should.eql([100]);
            late.res.writableEnded.should.be.false();
        });
        it("AC-36: the client of the waited request aborts: the wait ends at once and the request gets no 503", async function() {
            health.init({ shutdownTimeout: 5000 });
            enableDrain(3000);
            const r = request();
            const done = start();
            await clock.tickAsync(50);
            r.res.destroy();
            await clock.tickAsync(0);
            await done;
            stopTimes.should.eql([50]);
            r.res.statusCode.should.equal(200);
        });
        it("AC-43: a waited request whose response has ended without 'finish': stop at the next guard check, not at the limit", async function() {
            health.init({ shutdownTimeout: 5000 });
            enableDrain(3000);
            const r = request();
            const done = start();
            await clock.tickAsync(10);
            r.res.writableEnded = true;
            await clock.tickAsync(250);
            await done;
            stopTimes[0].should.be.within(10, 10 + 250);
            logsOf(log.warn, "httpDrain.shutdown-timeout").should.eql([]);
        });
        it("AC-37 and AC-44: the drain on and no shutdownTimeout: stop at once, waitForShutdown is not called, none of the new log keys", async function() {
            health.init({});
            enableDrain(1000);
            request();
            request();
            needWait();
            const wait = sinon.spy(httpDrain, "waitForShutdown");
            await start();
            stopTimes.should.eql([0]);
            wait.called.should.be.false();
            shutdownLogs().should.eql([]);
            clock.tick(10000);
            shutdownLogs().should.eql([]);
        });
        [0, -1, "1000", null].forEach(function(value) {
            it("AC-37: an invalid shutdownTimeout (" + JSON.stringify(value) + ") adds no wait of the requests", async function() {
                state.reset();
                state.markStarting();
                state.report({ errors: [] });
                health.init({ shutdownTimeout: value });
                enableDrain(1000);
                request();
                await start();
                stopTimes.should.eql([0]);
                shutdownLogs().should.eql([]);
            });
        });
        it("AC-38: the drain off, shutdownTimeout 5000: the timing and the logs of the grace and of the hook are unchanged", async function() {
            health.init({ shutdownTimeout: 5000, health: { enabled: true, unreadyGrace: 500 } });
            hooks.add("preShutdown", function(payload) { return new Promise(resolve => setTimeout(resolve, 200)) });
            const done = start();
            await clock.tickAsync(499);
            stop.called.should.be.false();
            await clock.tickAsync(1);
            await done;
            stopTimes.should.eql([500]);
            shutdownLogs().should.eql([]);
            logsOf(log.info, "health.draining").should.have.length(1);
            logsOf(log.info, "health.unready-grace").should.have.length(1);
        });
        it("AC-38: the drain off, shutdownTimeout 5000, no grace and no hook: stop at once, no log of the drain", async function() {
            health.init({ shutdownTimeout: 5000 });
            await start();
            stopTimes.should.eql([0]);
            shutdownLogs().should.eql([]);
            logsOf(log.info, "httpDrain").should.eql([]);
        });
        describe("AC-45: the budget given to waitForShutdown is deadline - now, in every branch", function() {
            let wait;
            beforeEach(function() {
                needWait();
                wait = sinon.stub(httpDrain, "waitForShutdown").callsFake(function() { return { promise: Promise.resolve(), cancel: function() {} } });
            });
            async function budgetFor(settings, withHook) {
                state.reset();
                state.markStarting();
                state.report({ errors: [] });
                hooks.clear();
                if (withHook) {
                    hooks.add("preShutdown", function(payload) { return new Promise(resolve => setTimeout(resolve, 200)) });
                }
                health.init(settings);
                const done = start();
                await clock.tickAsync(1000);
                await done;
                wait.calledOnce.should.be.true();
                return wait.firstCall.args[0];
            }
            it("no grace and no hook: the whole shutdownTimeout", async function() {
                (await budgetFor({ shutdownTimeout: 5000 }, false)).should.equal(5000);
            });
            it("a grace of 500 ms: 4500", async function() {
                (await budgetFor({ shutdownTimeout: 5000, health: { enabled: true, unreadyGrace: 500 } }, false)).should.equal(4500);
            });
            it("a hook that ends at +200 ms: 4800", async function() {
                (await budgetFor({ shutdownTimeout: 5000 }, true)).should.equal(4800);
            });
            it("a grace of 500 ms and a hook of 200 ms: 4500", async function() {
                (await budgetFor({ shutdownTimeout: 5000, health: { enabled: true, unreadyGrace: 500 } }, true)).should.equal(4500);
            });
            it("is called with the drain off too (the drain decides), and not without shutdownTimeout", async function() {
                state.reset();
                state.markStarting();
                state.report({ errors: [] });
                health.init({});
                await start();
                wait.called.should.be.false();
            });
            it("stop is called when the promise of the wait resolves, not before", async function() {
                let release;
                wait.callsFake(function() { return { promise: new Promise(resolve => { release = resolve }), cancel: function() {} } });
                health.init({ shutdownTimeout: 5000 });
                const done = start();
                await clock.tickAsync(100);
                stop.called.should.be.false();
                release();
                await done;
                stopTimes.should.eql([100]);
            });
            it("a second shutdown() calls cancel() of the wait, also without grace and hook (R-22)", async function() {
                const cancel = sinon.spy();
                wait.callsFake(function() { return { promise: new Promise(() => {}), cancel: cancel } });
                health.init({ shutdownTimeout: 5000 });
                start();
                await clock.tickAsync(10);
                cancel.called.should.be.false();
                start();
                cancel.calledOnce.should.be.true();
            });
        });
    });
});
