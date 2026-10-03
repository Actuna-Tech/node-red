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
});
