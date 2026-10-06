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
        // SPEC GAP: hooks.trigger() of @node-red/util wraps a rejection that is not an Error with `new Error(value)`, which
        // throws for these two values inside the hook machinery - the promise never settles. Fixing health.js alone does
        // not turn these two rows green; they need a change of util/lib/hooks.js too
        {name: "Object.create(null) [gap: hooks.trigger wraps it with new Error(value)]", make: function() { return Object.create(null) }},
        {name: "a Proxy that throws on every get [gap: hooks.trigger wraps it with new Error(value)]", make: function() { return new Proxy({}, {get: function() { throw new Error("p") }}) }},
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
});
