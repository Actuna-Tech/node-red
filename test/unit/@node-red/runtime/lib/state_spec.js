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
 *   E-02: tests of the instance state module
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const NR_TEST_UTILS = require("nr-test-utils");
const state = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
const { events, log } = NR_TEST_UTILS.require("@node-red/util");

describe("runtime/state (E-02)", function() {
    let emitted;
    function onEvent(info) { emitted.push(info) }

    beforeEach(function() {
        state.reset();
        emitted = [];
        events.on("instance:state", onEvent);
    });
    afterEach(function() {
        events.removeListener("instance:state", onEvent);
        state.reset();
        sinon.restore();
    });

    function toReady() {
        state.markStarting();
        state.report({ errors: [] });
    }

    it("initial state is init", function() {
        const info = state.get();
        info.state.should.equal("init");
        should(info.previous).be.null();
        state.isReady().should.be.false();
    });

    it("starts in starting after markStarting", function() {
        state.markStarting();
        state.get().state.should.equal("starting");
        emitted.should.have.length(1);
        emitted[0].should.containEql({ state: "starting", previous: "init", reason: "startup" });
        emitted[0].should.have.property("since").which.is.a.Number();
    });

    it("ready only after a result with no errors", function() {
        state.markStarting();
        state.isReady().should.be.false();
        state.report({ errors: [] });
        state.get().should.containEql({ state: "ready", previous: "starting", reason: "startup" });
        state.isReady().should.be.true();
    });

    it("start errors set failed with the errors and the reason of the first error", function() {
        for (const code of ["missing_types", "missing_modules", "flow_start_failed"]) {
            state.reset();
            state.markStarting();
            state.report({ errors: [{ code: code, message: "m", types: ["x"] }] });
            const info = state.get();
            info.state.should.equal("failed");
            info.reason.should.equal(code.replace(/_/g, "-"));
            info.errors.should.eql([{ code: code, message: "m" }]);
            state.isReady().should.be.false();
        }
    });

    it("flowsRunning false sets idle with its reason (safe mode, stopped flows)", function() {
        state.markStarting();
        state.report({ errors: [{ code: "safe_mode", message: "x" }], flowsRunning: false, reason: "safe-mode" });
        state.get().should.containEql({ state: "idle", reason: "safe-mode" });
        state.reset();
        state.markStarting();
        state.report({ errors: [], flowsRunning: false, reason: "set-state" });
        state.get().should.containEql({ state: "idle", reason: "set-state" });
        state.isReady().should.be.false();
    });

    it("fail() sets failed (storage-error) outside an operation", function() {
        state.markStarting();
        const err = new Error("cannot read");
        err.code = "ENOENT";
        state.fail(err, "storage-error");
        const info = state.get();
        info.should.containEql({ state: "failed", reason: "storage-error" });
        info.errors.should.eql([{ code: "ENOENT", message: "cannot read" }]);
    });

    it("fail() without a reason uses startup-error", function() {
        state.markStarting();
        state.fail(new Error("x"));
        state.get().reason.should.equal("startup-error");
    });

    it("a late start without errors moves failed to ready", function() {
        state.markStarting();
        state.report({ errors: [{ code: "missing_types", message: "m" }] });
        state.report({ errors: [] });
        state.get().should.containEql({ state: "ready", previous: "failed", reason: "start" });
    });

    it("report() in init is ignored", function() {
        state.report({ errors: [] });
        state.get().state.should.equal("init");
        emitted.should.have.length(0);
    });

    describe("operations", function() {
        it("begin(deploy) sets deploying and end sets ready", function() {
            toReady();
            const token = state.begin("deploy");
            (typeof token).should.equal("symbol");
            state.get().should.containEql({ state: "deploying", previous: "ready", reason: "deploy" });
            state.isReady().should.be.false();
            state.end(token, { errors: [] });
            state.get().should.containEql({ state: "ready", previous: "deploying", reason: "deploy" });
        });

        it("end with errors sets failed", function() {
            toReady();
            const token = state.begin("deploy");
            state.end(token, { errors: [{ code: "missing_types", message: "m" }] });
            state.get().should.containEql({ state: "failed", reason: "missing-types" });
        });

        it("end with flowsRunning false sets idle", function() {
            toReady();
            const token = state.begin("deploy");
            state.end(token, { flowsRunning: false });
            state.get().should.containEql({ state: "idle", reason: "deploy" });
        });

        it("end aborted returns to the state before the operation", function() {
            state.markStarting();
            state.report({ errors: [{ code: "missing_types", message: "m" }] });
            const token = state.begin("deploy");
            state.end(token, { aborted: true });
            const info = state.get();
            info.should.containEql({ state: "failed", reason: "missing-types" });
            info.errors.should.eql([{ code: "missing_types", message: "m" }]);
        });

        it("set-state keeps the state until end", function() {
            toReady();
            emitted = [];
            const token = state.begin("set-state");
            state.get().state.should.equal("ready");
            emitted.should.have.length(0);
            state.end(token, { flowsRunning: false, reason: "set-state" });
            state.get().should.containEql({ state: "idle", reason: "set-state" });
            const token2 = state.begin("set-state");
            state.end(token2, { errors: [] });
            state.get().should.containEql({ state: "ready", previous: "idle", reason: "set-state" });
        });

        it("begin during an active operation throws state_operation_in_progress", function() {
            toReady();
            state.begin("deploy");
            (function() { state.begin("set-state") }).should.throw({ code: "state_operation_in_progress" });
        });

        it("begin with supersede replaces the running operation; the old token is stale", function() {
            toReady();
            const first = state.begin("deploy");
            const second = state.begin("deploy", { supersede: true });
            state.end(first, { errors: [{ code: "missing_types", message: "m" }] });
            state.get().state.should.equal("deploying");
            state.end(second, { aborted: true });
            state.get().state.should.equal("ready");
        });

        it("a stale token does not change the state", function() {
            toReady();
            const token = state.begin("deploy");
            state.end(token, { errors: [] });
            emitted = [];
            state.end(token, { errors: [{ code: "missing_types" }] });
            state.end(undefined, { errors: [] });
            state.get().state.should.equal("ready");
            emitted.should.have.length(0);
        });

        it("report() and fail() are ignored while an operation runs", function() {
            toReady();
            const token = state.begin("deploy");
            state.report({ errors: [] });
            state.fail(new Error("x"));
            state.get().state.should.equal("deploying");
            state.end(token, { errors: [] });
        });

        it("begin with an unknown operation throws", function() {
            (function() { state.begin("other") }).should.throw();
        });

        it("a deployment while starting is allowed", function() {
            state.markStarting();
            const token = state.begin("deploy");
            state.get().state.should.equal("deploying");
            state.end(token, { errors: [] });
            state.get().state.should.equal("ready");
        });
    });

    describe("pending reload (Z-09 api)", function() {
        it("reloadPending has no token and does not block begin(deploy)", function() {
            toReady();
            state.markReloadPending({ reason: "storage" }).should.be.true();
            state.get().should.containEql({ state: "reloadPending", previous: "ready", reason: "storage", draining: false });
            state.isReady().should.be.true();
            const token = state.begin("deploy");
            should.exist(token);
        });

        it("begin(deploy) from reloadPending cancels the pending reload", function() {
            toReady();
            state.markReloadPending();
            state.markDraining();
            const token = state.begin("deploy");
            state.get().should.containEql({ state: "deploying", previous: "reloadPending" });
            state.end(token, { aborted: true });
            // aborted: back to the state before the pending reload
            state.get().state.should.equal("ready");
            state.cancelPending("x").should.be.false();
        });

        it("markDraining sets draining and isReady false", function() {
            toReady();
            state.markReloadPending();
            emitted = [];
            state.markDraining().should.be.true();
            state.get().draining.should.be.true();
            state.isReady().should.be.false();
            emitted.should.have.length(1);
            emitted[0].should.containEql({ state: "reloadPending", draining: true });
        });

        it("reloadPending before draining is not ready when the state before it was not ready", function() {
            state.markStarting();
            state.report({ errors: [{ code: "missing_types" }] });
            state.markReloadPending();
            state.isReady().should.be.false();
        });

        it("cancelPending returns to the state before", function() {
            toReady();
            state.markReloadPending();
            state.markDraining();
            state.cancelPending("unchanged").should.be.true();
            state.get().should.containEql({ state: "ready", previous: "reloadPending", reason: "unchanged" });
        });

        it("reloadPending -> reloading only via begin(reload)", function() {
            toReady();
            const t0 = state.begin("reload");
            state.get().state.should.equal("ready");
            state.end(t0, { aborted: true });
            state.markReloadPending();
            const token = state.begin("reload");
            state.get().should.containEql({ state: "reloading", previous: "reloadPending", reason: "reload" });
            state.end(token, { errors: [] });
            state.get().should.containEql({ state: "ready", reason: "reload" });
        });

        it("an aborted reload returns to the state before the pending reload", function() {
            state.markStarting();
            state.report({ errors: [], flowsRunning: false, reason: "set-state" });
            state.markReloadPending();
            const token = state.begin("reload");
            state.end(token, { aborted: true });
            state.get().should.containEql({ state: "idle", reason: "set-state" });
        });

        it("markReloadPending is refused during an operation or outside a resting state", function() {
            state.markReloadPending().should.be.false();
            toReady();
            const token = state.begin("deploy");
            state.markReloadPending().should.be.false();
            state.end(token, { errors: [] });
            state.markDraining().should.be.false();
        });
    });

    describe("editor-only (Z-15 extension point)", function() {
        it("editor-only start ends in loaded and never ready", function() {
            state.markStarting();
            state.report({ errors: [], flowsRunning: false, reason: "editor-only" });
            state.get().state.should.equal("loaded");
            state.isReady().should.be.true();
            const token = state.begin("deploy");
            state.end(token, { errors: [] });
            state.get().state.should.equal("loaded");
            state.report({ errors: [] });
            state.get().state.should.equal("loaded");
        });
    });

    describe("stopping", function() {
        it("stopping is final - begin/end/fail/report ignored", function() {
            toReady();
            const token = state.begin("deploy");
            state.markStopping("SIGTERM").should.be.true();
            state.get().should.containEql({ state: "stopping", previous: "deploying", reason: "SIGTERM" });
            state.end(token, { errors: [] });
            should(state.begin("deploy")).be.null();
            state.fail(new Error("x"));
            state.report({ errors: [] });
            state.markReloadPending().should.be.false();
            state.markStarting();
            state.get().state.should.equal("stopping");
            state.markStopping("other").should.be.false();
            state.get().reason.should.equal("SIGTERM");
            state.markStopped();
            state.get().should.containEql({ state: "stopped", previous: "stopping", reason: "SIGTERM" });
            state.isReady().should.be.false();
        });

        it("markStopping without a reason uses stop", function() {
            state.markStopping();
            state.get().should.containEql({ state: "stopping", previous: "init", reason: "stop" });
        });

        it("markStopped outside stopping is ignored", function() {
            toReady();
            state.markStopped();
            state.get().state.should.equal("ready");
        });
    });

    describe("transitions table", function() {
        it("every state is in the table and stopping/stopped are final", function() {
            state.STATES.forEach(function(s) {
                state.TRANSITIONS.should.have.property(s);
            });
            state.TRANSITIONS.stopping.should.eql(["stopped"]);
            state.TRANSITIONS.stopped.should.eql([]);
        });

        // The card transitions (E-02): driven through the api, so a transition is
        // reachable only where the table allows it
        const drive = {
            init: function() {},
            starting: function() { state.markStarting() },
            ready: toReady,
            failed: function() { state.markStarting(); state.report({ errors: [{ code: "missing_types" }] }) },
            idle: function() { state.markStarting(); state.report({ flowsRunning: false, reason: "set-state" }) },
            loaded: function() { state.markStarting(); state.report({ flowsRunning: false, reason: "editor-only" }) },
            deploying: function() { toReady(); state.begin("deploy") },
            reloadPending: function() { toReady(); state.markReloadPending() },
            reloading: function() { toReady(); state.markReloadPending(); state.begin("reload") },
            stopping: function() { state.markStopping() },
            stopped: function() { state.markStopping(); state.markStopped() }
        };
        // every way of moving to another state, by target
        const moves = {
            starting: function() { state.markStarting() },
            ready: function() { state.report({ errors: [] }) },
            failed: function() { state.fail(new Error("x")) },
            idle: function() { state.report({ flowsRunning: false, reason: "set-state" }) },
            loaded: function() { state.report({ flowsRunning: false, reason: "editor-only" }) },
            deploying: function() { try { state.begin("deploy") } catch(err) {} },
            reloadPending: function() { state.markReloadPending() },
            reloading: function() { try { state.begin("reload") } catch(err) {} },
            stopping: function() { state.markStopping() },
            stopped: function() { state.markStopped() }
        };
        state.STATES.forEach(function(from) {
            Object.keys(moves).forEach(function(to) {
                if (from === to) {
                    return;
                }
                it("transition " + from + " -> " + to + " only when the table allows it", function() {
                    drive[from]();
                    state.get().state.should.equal(from);
                    sinon.stub(log, "trace");
                    moves[to]();
                    const now = state.get().state;
                    if (now === to) {
                        state.TRANSITIONS[from].should.containEql(to);
                    } else {
                        now.should.equal(from);
                    }
                });
            });
        });
    });

    describe("events and listeners", function() {
        it("emits instance:state once per transition, in order", function() {
            toReady();
            const token = state.begin("deploy");
            state.end(token, { errors: [] });
            state.markStopping("SIGTERM");
            state.markStopped();
            emitted.map(e => e.state).should.eql(["starting", "ready", "deploying", "ready", "stopping", "stopped"]);
            emitted.forEach(function(e) {
                Object.keys(e).should.containDeep(["state", "previous", "reason", "since"]);
            });
        });

        it("no event when the state, reason and draining flag do not change", function() {
            toReady();
            emitted = [];
            state.report({ errors: [] });
            state.report({ errors: [] });
            emitted.should.have.length(1); // ready/startup -> ready/start
            state.report({ errors: [] });
            emitted.should.have.length(1);
        });

        it("onChange is notified and returns an unsubscribe function", function() {
            const seen = [];
            const off = state.onChange(info => seen.push(info.state));
            state.markStarting();
            off();
            state.report({ errors: [] });
            seen.should.eql(["starting"]);
        });

        it("a listener exception is logged and the other listeners are notified", function() {
            const warn = sinon.stub(log, "warn");
            const seen = [];
            state.onChange(function() { throw new Error("boom") });
            state.onChange(info => seen.push(info.state));
            state.markStarting();
            seen.should.eql(["starting"]);
            warn.calledOnce.should.be.true();
            state.get().state.should.equal("starting");
        });

        it("get() returns a copy", function() {
            state.markStarting();
            state.report({ errors: [{ code: "missing_types", message: "m" }] });
            const info = state.get();
            info.state = "ready";
            info.errors.push({});
            state.get().state.should.equal("failed");
            state.get().errors.should.have.length(1);
        });
    });
});
