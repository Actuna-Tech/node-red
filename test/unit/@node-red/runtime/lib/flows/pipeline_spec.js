/**
 * Copyright JS Foundation and other contributors, http://js.foundation
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
 *   E-01: tests of the deploy pipeline contract
 *   E-01: the lock is held until the start completes (R-43); a failed storage read releases it
 *   E-02: the instance state in steps 4 and 8
 *   Z-09: reload from storage (source "storage" with reread)
 *   Z-06 (#10): prepare/apply of the single-flow api (U1); reload: read in step 2, credentials in step 3a (D15);
 *   the preDeploy hook (step 3): the order, a rejection/failure/timeout without effects, no credentials in the
 *   event, I10, I13, I14, SEC-104(a); without a handler nothing is done (I1); the postDeploy hook (step 11):
 *   once per saved or reloaded configuration (I11, D18, D22/A31, D23, D24), the dictionary of start.status, I7
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const NR_TEST_UTILS = require("nr-test-utils");
const pipeline = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/pipeline");
const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");

describe("flows/pipeline", function() {
    let flows;
    let calls;
    const loadedConfig = { flows: [{id:"t1", type:"tab"}], rev: "storedRev" };

    beforeEach(function() {
        calls = [];
        flows = {
            getFlows: sinon.spy(() => ({ rev: "currentRev", flows: [] })),
            setFlows: sinon.spy(async function() {
                calls.push({ fn: "setFlows", locked: lock.isLocked() });
                return "newRev";
            }),
            // Z-06 (D15): step 2 reads, step 3a loads the credentials
            readStoredFlows: sinon.spy(async function() {
                calls.push({ fn: "readStoredFlows", locked: lock.isLocked() });
                return loadedConfig;
            }),
            loadStoredCredentials: sinon.spy(async function(config) {
                calls.push({ fn: "loadStoredCredentials", locked: lock.isLocked() });
                return config;
            }),
            loadFlows: sinon.spy(async function() {
                calls.push({ fn: "loadFlows", locked: lock.isLocked() });
                return "loadRev";
            })
        };
        pipeline.init({ flows: flows });
    });

    it("deploys full/nodes/flows through setFlows under the lock", async function() {
        for (const type of ["full", "nodes", "flows"]) {
            flows.setFlows.resetHistory();
            const result = await pipeline.deploy({ type: type, source: "api", flows: { flows: [1,2], credentials: {a:1} }, user: "u" });
            result.should.eql({ rev: "newRev" });
            flows.setFlows.calledOnce.should.be.true();
            flows.setFlows.firstCall.args.should.eql([[1,2], {a:1}, type, null, null, "u", undefined]);
        }
        calls.every(c => c.locked).should.be.true();
    });
    it("defaults to a full deploy", async function() {
        await pipeline.deploy({ flows: { flows: [1] } });
        flows.setFlows.firstCall.args[2].should.equal("full");
    });
    it("passes deployOpts to setFlows", async function() {
        const deployOpts = { waitForStart: false };
        await pipeline.deploy({ type: "full", flows: { flows: [1] }, deployOpts: deployOpts });
        flows.setFlows.firstCall.args[6].should.equal(deployOpts);
    });
    it("revision check inside lock", async function() {
        flows.getFlows = sinon.spy(() => {
            calls.push({ fn: "getFlows", locked: lock.isLocked() });
            return { rev: "currentRev", flows: [] };
        });
        await pipeline.deploy({ type: "full", flows: { flows: [1], rev: "currentRev" } });
        calls[0].should.eql({ fn: "getFlows", locked: true });
        flows.setFlows.calledOnce.should.be.true();
    });
    it("rejects with version_mismatch without deploying", async function() {
        const err = await pipeline.deploy({ type: "nodes", flows: { flows: [1], rev: "otherRev" } }).should.be.rejected();
        err.should.have.property("code", "version_mismatch");
        err.should.have.property("status", 409);
        flows.setFlows.called.should.be.false();
        lock.isLocked().should.be.false();
    });
    it("api reload reads storage under lock before preDeploy anchor and loads the credentials after it (D15)", async function() {
        const result = await pipeline.deploy({ type: "reload", source: "api" });
        result.should.eql({ rev: "loadRev" });
        calls.map(c => c.fn).should.eql(["readStoredFlows", "loadStoredCredentials", "loadFlows"]);
        calls.every(c => c.locked).should.be.true();
        flows.loadFlows.firstCall.args.should.eql([true, undefined, loadedConfig]);
    });
    it("reload with loaded config does not read storage again", async function() {
        const loaded = { flows: [], rev: "x" };
        await pipeline.deploy({ type: "reload", source: "storage", loaded: loaded });
        flows.readStoredFlows.called.should.be.false();
        // the configuration comes with its credentials loaded: no step 3a
        flows.loadStoredCredentials.called.should.be.false();
        flows.loadFlows.firstCall.args[2].should.equal(loaded);
    });
    it("reload saves nothing", async function() {
        await pipeline.deploy({ type: "reload" });
        flows.setFlows.called.should.be.false();
    });
    it("reload is not subject to the revision check", async function() {
        await pipeline.deploy({ type: "reload", flows: { rev: "otherRev" } });
        flows.loadFlows.calledOnce.should.be.true();
    });
    it("runs an apply step (single-flow entries) once under the lock", async function() {
        const deployOpts = {};
        const apply = sinon.spy(async function(opts) {
            lock.isLocked().should.be.true();
            return "flowId";
        });
        const result = await pipeline.deploy({ type: "flows", apply: apply, deployOpts: deployOpts });
        result.should.eql({ result: "flowId" });
        apply.calledOnce.should.be.true();
        apply.firstCall.args[0].should.equal(deployOpts);
        flows.setFlows.called.should.be.false();
    });
    it("serialises deployments: the second waits for the first", async function() {
        let release;
        flows.setFlows = sinon.spy(function(config) {
            calls.push({ fn: "setFlows:" + config[0] });
            if (config[0] === "first") {
                return new Promise(resolve => { release = () => resolve("rev1") });
            }
            return Promise.resolve("rev2");
        });
        const first = pipeline.deploy({ flows: { flows: ["first"] } });
        const second = pipeline.deploy({ flows: { flows: ["second"] } });
        await new Promise(resolve => setTimeout(resolve, 10));
        calls.map(c => c.fn).should.eql(["setFlows:first"]);
        release();
        (await first).should.eql({ rev: "rev1" });
        (await second).should.eql({ rev: "rev2" });
        calls.map(c => c.fn).should.eql(["setFlows:first", "setFlows:second"]);
    });
    it("returns the result before the start completes and keeps the lock until then (R-43)", async function() {
        let finishStart;
        flows.setFlows = sinon.spy(async function() {
            // as flows.setFlows: the start runs asynchronously to the result
            lock.holdUntil(new Promise(resolve => { finishStart = resolve }));
            return "rev1";
        });
        const result = await pipeline.deploy({ flows: { flows: ["first"] } });
        result.should.eql({ rev: "rev1" });
        lock.isLocked().should.be.true();
        const order = [];
        flows.readStoredFlows = sinon.spy(async function() {
            order.push("second");
            return loadedConfig;
        });
        const second = pipeline.deploy({ type: "reload" });
        const setState = lock.runExclusive(async () => order.push("setState"));
        await new Promise(resolve => setTimeout(resolve, 10));
        order.should.eql([]);
        flows.readStoredFlows.called.should.be.false();
        finishStart({ errors: [] });
        await Promise.all([second, setState]);
        order.should.eql(["second", "setState"]);
        lock.isLocked().should.be.false();
    });
    it("a failed start releases the lock", async function() {
        let failStart;
        flows.setFlows = sinon.spy(async function() {
            lock.holdUntil(new Promise((resolve, reject) => { failStart = reject }));
            return "rev1";
        });
        await pipeline.deploy({ flows: { flows: [1] } });
        lock.isLocked().should.be.true();
        failStart(new Error("start failed"));
        (await pipeline.deploy({ type: "reload" })).should.eql({ rev: "loadRev" });
        lock.isLocked().should.be.false();
    });
    it("releases the lock when reading storage for reload fails (D4)", async function() {
        flows.readStoredFlows = sinon.spy(async () => { throw new Error("read failed") });
        await pipeline.deploy({ type: "reload" }).should.be.rejectedWith("read failed");
        flows.loadFlows.called.should.be.false();
        lock.isLocked().should.be.false();
    });
    it("releases the lock when the deployment fails", async function() {
        flows.setFlows = sinon.spy(async () => { throw new Error("save failed") });
        await pipeline.deploy({ flows: { flows: [1] } }).should.be.rejectedWith("save failed");
        lock.isLocked().should.be.false();
    });
    describe("instance state (E-02, steps 4 and 8)", function() {
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        let finishStart;
        beforeEach(function() {
            instanceState.reset();
            instanceState.markStarting();
            instanceState.report({ errors: [] });
        });
        afterEach(function() {
            instanceState.reset();
        });
        // A setFlows that starts the flows like flows/index.js: the start is
        // registered with lock.holdUntil()
        function startingSetFlows(startResult) {
            return sinon.spy(async function() {
                calls.push({ fn: "setFlows", state: instanceState.get().state });
                const started = new Promise(resolve => { finishStart = function() { resolve(startResult) } });
                lock.holdUntil(started);
                return "newRev";
            });
        }

        it("sets deploying before the save/stop step and ready after the start, before the lock is released", async function() {
            flows.setFlows = startingSetFlows({ errors: [] });
            const result = await pipeline.deploy({ flows: { flows: [1] } });
            result.should.eql({ rev: "newRev" });
            calls[0].state.should.equal("deploying");
            instanceState.get().state.should.equal("deploying");
            lock.isLocked().should.be.true();
            let stateWhenUnlocked;
            const next = lock.runExclusive(async function() { stateWhenUnlocked = instanceState.get().state });
            finishStart();
            await next;
            stateWhenUnlocked.should.equal("ready");
            instanceState.get().should.containEql({ state: "ready", previous: "deploying", reason: "deploy" });
        });

        it("start errors set failed", async function() {
            flows.setFlows = startingSetFlows({ errors: [{ code: "missing_types", message: "m" }] });
            await pipeline.deploy({ flows: { flows: [1] } });
            finishStart();
            await lock.runExclusive(async () => {});
            instanceState.get().should.containEql({ state: "failed", reason: "missing-types" });
        });

        it("a rejected start sets failed (flow-start-failed)", async function() {
            flows.setFlows = sinon.spy(async function() {
                const started = Promise.reject(new Error("boom"));
                started.catch(() => {});
                lock.holdUntil(started);
                return "newRev";
            });
            await pipeline.deploy({ flows: { flows: [1] } });
            await lock.runExclusive(async () => {});
            instanceState.get().should.containEql({ state: "failed", reason: "flow-start-failed" });
        });

        it("flows not started (stopped flows) set idle", async function() {
            await pipeline.deploy({ flows: { flows: [1] } });
            instanceState.get().should.containEql({ state: "idle", previous: "deploying" });
        });

        it("a failed revision check does not change the state", async function() {
            const seen = [];
            const off = instanceState.onChange(info => seen.push(info.state));
            await pipeline.deploy({ flows: { flows: [1], rev: "other" } }).should.be.rejected();
            off();
            seen.should.eql([]);
        });

        it("a failed save returns to the state before the deployment", async function() {
            flows.setFlows = sinon.spy(async () => { throw new Error("save failed") });
            await pipeline.deploy({ flows: { flows: [1] } }).should.be.rejectedWith("save failed");
            instanceState.get().should.containEql({ state: "ready", previous: "deploying" });
        });

        it("a stop failure (deploy_stop_failed) sets failed", async function() {
            flows.setFlows = sinon.spy(async () => { const err = new Error("stop"); err.code = "deploy_stop_failed"; throw err });
            await pipeline.deploy({ flows: { flows: [1] } }).should.be.rejected();
            instanceState.get().should.containEql({ state: "failed", reason: "deploy-stop-failed" });
        });

        it("reload and the single-flow api go through deploying", async function() {
            const seen = [];
            const off = instanceState.onChange(info => seen.push(info.state));
            await pipeline.deploy({ type: "reload" });
            await pipeline.deploy({ type: "flows", apply: async () => "x" });
            off();
            seen.should.eql(["deploying", "idle", "deploying", "idle"]);
        });

        it("a deployment while stopping does not change the state", async function() {
            instanceState.markStopping("SIGTERM");
            flows.setFlows = startingSetFlows({ errors: [] });
            await pipeline.deploy({ flows: { flows: [1] } });
            finishStart();
            await lock.runExclusive(async () => {});
            instanceState.get().state.should.equal("stopping");
        });

        it("a deployment from reloadPending cancels the pending reload", async function() {
            instanceState.markReloadPending();
            instanceState.markDraining();
            flows.setFlows = startingSetFlows({ errors: [] });
            await pipeline.deploy({ flows: { flows: [1] } });
            calls[0].state.should.equal("deploying");
            finishStart();
            await lock.runExclusive(async () => {});
            instanceState.get().state.should.equal("ready");
        });
    });
    describe("prepare and apply of the single-flow api (Z-06, U1)", function() {
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        beforeEach(function() {
            instanceState.reset();
            instanceState.markStarting();
            instanceState.report({ errors: [] });
        });
        afterEach(function() {
            instanceState.reset();
        });
        it("prepare runs under the lock in step 2 - before the state deploying - and its result goes to apply", async function() {
            const prepared = { config: [1] };
            const deployOpts = {};
            const prepare = sinon.spy(async function() {
                calls.push({ fn: "prepare", locked: lock.isLocked(), state: instanceState.get().state });
                return prepared;
            });
            const apply = sinon.spy(async function() {
                calls.push({ fn: "apply", locked: lock.isLocked(), state: instanceState.get().state });
                return "flowId";
            });
            const result = await pipeline.deploy({ type: "flows", prepare: prepare, apply: apply, deployOpts: deployOpts });
            result.should.eql({ result: "flowId" });
            prepare.calledOnce.should.be.true();
            apply.calledOnce.should.be.true();
            apply.firstCall.args[0].should.equal(deployOpts);
            apply.firstCall.args[1].should.equal(prepared);
            calls.should.eql([
                { fn: "prepare", locked: true, state: "ready" },
                { fn: "apply", locked: true, state: "deploying" }
            ]);
        });
        it("a rejection in prepare does not touch the instance state, does not call apply and releases the lock (A24)", async function() {
            const seen = [];
            const off = instanceState.onChange(info => seen.push(info.state));
            const apply = sinon.spy(async () => "x");
            const error = Object.assign(new Error("missing"), { code: 404 });
            const caught = await pipeline.deploy({ type: "flows", prepare: () => { throw error }, apply: apply }).should.be.rejected();
            off();
            caught.should.equal(error);
            seen.should.eql([]);
            instanceState.get().state.should.equal("ready");
            apply.called.should.be.false();
            lock.isLocked().should.be.false();
        });
        it("a prepare that rejects asynchronously behaves the same", async function() {
            const seen = [];
            const off = instanceState.onChange(info => seen.push(info.state));
            await pipeline.deploy({ type: "flows", prepare: async () => { throw new Error("late") }, apply: async () => "x" }).should.be.rejectedWith("late");
            off();
            seen.should.eql([]);
            lock.isLocked().should.be.false();
        });
        it("a rejected single-flow request does not cancel a pending reload from storage (D19)", async function() {
            instanceState.markReloadPending();
            await pipeline.deploy({ type: "flows", prepare: () => { throw new Error("409") }, apply: async () => "x" }).should.be.rejected();
            instanceState.get().state.should.equal("reloadPending");
        });
        it("without prepare apply gets no prepared value (compatibility)", async function() {
            const apply = sinon.spy(async () => "x");
            await pipeline.deploy({ type: "flows", apply: apply });
            should.not.exist(apply.firstCall.args[1]);
        });
        it("an error of apply returns to the state before the deployment", async function() {
            await pipeline.deploy({ type: "flows", prepare: async () => ({}), apply: async () => { throw new Error("apply failed") } }).should.be.rejectedWith("apply failed");
            instanceState.get().should.containEql({ state: "ready", previous: "deploying" });
        });
    });
    describe("reload: step 2 reads, step 3a loads the credentials (Z-06, D15)", function() {
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        beforeEach(function() {
            instanceState.reset();
            instanceState.markStarting();
            instanceState.report({ errors: [] });
        });
        afterEach(function() {
            instanceState.reset();
        });
        it("the read is under the lock in the state ready, the credentials too - the state deploying only after step 3a", async function() {
            flows.readStoredFlows = sinon.spy(async function() {
                calls.push({ fn: "readStoredFlows", state: instanceState.get().state });
                return loadedConfig;
            });
            flows.loadStoredCredentials = sinon.spy(async function(config) {
                calls.push({ fn: "loadStoredCredentials", state: instanceState.get().state });
                return { flows: config.flows, rev: config.rev, credentials: "loaded" };
            });
            flows.loadFlows = sinon.spy(async function() {
                calls.push({ fn: "loadFlows", state: instanceState.get().state });
                return "loadRev";
            });
            await pipeline.deploy({ type: "reload", source: "api" });
            calls.should.eql([
                { fn: "readStoredFlows", state: "ready" },
                { fn: "loadStoredCredentials", state: "ready" },
                { fn: "loadFlows", state: "deploying" }
            ]);
            // step 3a gets what step 2 read; the result of step 3a is deployed
            flows.loadStoredCredentials.firstCall.args[0].should.equal(loadedConfig);
            flows.loadFlows.firstCall.args[2].should.have.property("credentials", "loaded");
        });
        it("an error of step 3a (credentials_load_failed) comes before the state deploying, releases the lock and does not deploy", async function() {
            const seen = [];
            const off = instanceState.onChange(info => seen.push(info.state));
            flows.loadStoredCredentials = sinon.spy(async function() {
                throw Object.assign(new Error("Failed to decrypt credentials"), { code: "credentials_load_failed" });
            });
            const err = await pipeline.deploy({ type: "reload" }).should.be.rejected();
            off();
            err.should.have.property("code", "credentials_load_failed");
            seen.should.eql([]);
            flows.loadFlows.called.should.be.false();
            lock.isLocked().should.be.false();
        });
        it("a failed read (step 2) does not reach step 3a", async function() {
            flows.readStoredFlows = sinon.spy(async () => { throw new Error("read failed") });
            await pipeline.deploy({ type: "reload" }).should.be.rejectedWith("read failed");
            flows.loadStoredCredentials.called.should.be.false();
        });
    });
    describe("reload from storage (Z-09)", function() {
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        beforeEach(function() {
            instanceState.reset();
            instanceState.markStarting();
            instanceState.report({ errors: [] });
            flows.reloadFromStorage = sinon.spy(async function(loaded) {
                calls.push({ fn: "reloadFromStorage", locked: lock.isLocked(), state: instanceState.get().state });
                lock.holdUntil(Promise.resolve({ errors: [] }));
                return loaded.rev;
            });
        });
        afterEach(function() {
            instanceState.reset();
        });
        it("skipped when not reloadPending (superseded) - reread not called", async function() {
            let called = false;
            const result = await pipeline.deploy({ type: "reload", source: "storage", reread: async () => { called = true } });
            result.should.eql({ skipped: "superseded" });
            called.should.be.false();
        });
        it("rereads under the lock and reloads in the state reloading - nothing saved", async function() {
            instanceState.markReloadPending();
            const result = await pipeline.deploy({ type: "reload", source: "storage", reread: async function() {
                calls.push({ fn: "reread", locked: lock.isLocked() });
                return { apply: { flows: [], rev: "B" }, reloadType: "diff", credentialsChanged: false };
            } });
            result.should.eql({ rev: "B" });
            calls.should.eql([{ fn: "reread", locked: true }, { fn: "reloadFromStorage", locked: true, state: "reloading" }]);
            flows.reloadFromStorage.firstCall.args[1].should.eql({ type: "diff", credentialsChanged: false });
            flows.setFlows.called.should.be.false();
            await new Promise(r => setImmediate(r));
            instanceState.get().state.should.equal("ready");
        });
        it("a decision without apply is returned as skipped", async function() {
            instanceState.markReloadPending();
            const result = await pipeline.deploy({ type: "reload", source: "storage", reread: async () => ({ skip: "unchanged" }) });
            result.should.eql({ skipped: { skip: "unchanged" } });
            flows.reloadFromStorage.called.should.be.false();
        });
        it("a failed reload returns to the state before the pending reload", async function() {
            instanceState.markReloadPending();
            flows.reloadFromStorage = async function() { throw new Error("credentials") };
            await pipeline.deploy({ type: "reload", source: "storage", reread: async () => ({ apply: { rev: "B" } }) }).should.be.rejectedWith("credentials");
            instanceState.get().state.should.equal("ready");
            lock.isLocked().should.be.false();
        });
    });
    describe("preDeploy hook (Z-06, step 3)", function() {
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        const { hooks, log } = NR_TEST_UTILS.require("@node-red/util");
        let logStubs;
        let logged;
        let seen;
        let offState;
        function intended(properties) {
            return Object.assign(new Error("not allowed"), { status: 400, code: "forbidden_node" }, properties);
        }
        beforeEach(function() {
            instanceState.reset();
            instanceState.markStarting();
            instanceState.report({ errors: [] });
            logged = { warn: [], error: [] };
            logStubs = [
                sinon.stub(log, "_").callsFake(k => "[" + k + "]"),
                sinon.stub(log, "warn").callsFake(m => logged.warn.push(m)),
                sinon.stub(log, "error").callsFake(m => logged.error.push(m)),
                sinon.stub(log, "debug")
            ];
            seen = [];
            offState = instanceState.onChange(info => seen.push(info.state));
            pipeline.init({ flows: flows, settings: { deploy: { hookTimeout: 100 } } });
        });
        afterEach(function() {
            offState();
            logStubs.forEach(s => s.restore());
            hooks.clear();
            instanceState.reset();
        });
        const noEffects = () => {
            flows.setFlows.called.should.be.false();
            flows.loadFlows.called.should.be.false();
            flows.loadStoredCredentials.called.should.be.false();
            seen.should.eql([]);
            lock.isLocked().should.be.false();
        };

        describe("without a handler (I1, off_identical)", function() {
            it("no copy, no timer, no accessor call, no extra read of the active configuration", async function() {
                // hooks.handlers is read-only (S-C3), so it cannot be spied on; only the two functions of deployHooks
                // read it, and neither may be called
                const deployHooks = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/deployHooks");
                const pre = sinon.spy(deployHooks, "runPreDeploy");
                const post = sinon.spy(deployHooks, "notifyPostDeploy");
                const has = sinon.spy(hooks, "has");
                const clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
                try {
                    await pipeline.deploy({ type: "full", source: "api", flows: { flows: [1, 2] } });
                    await pipeline.deploy({ type: "reload", source: "api" });
                    await pipeline.deploy({ type: "flows", prepare: async () => ({ config: [] }), apply: async () => "x", operation: "addFlow" });
                    pre.called.should.be.false();
                    post.called.should.be.false();
                    flows.getFlows.called.should.be.false();
                    clock.countTimers().should.equal(0);
                    has.calledWith("preDeploy").should.be.true();
                } finally {
                    clock.restore();
                    pre.restore();
                    post.restore();
                    has.restore();
                }
            });
            it("a hook other than preDeploy does not change anything", async function() {
                hooks.add("preReload.a", () => false);
                hooks.add("postDeploy.a", () => false);
                (await pipeline.deploy({ type: "full", flows: { flows: [1] } })).should.eql({ rev: "newRev" });
            });
        });

        describe("order and place (I2)", function() {
            it("runs once per deployment, under the lock, after the revision check, before the state deploying (full)", async function() {
                const order = [];
                hooks.add("preDeploy.a", function(event) {
                    order.push({ fn: "hook", locked: lock.isLocked(), state: instanceState.get().state });
                });
                flows.setFlows = sinon.spy(async function() { order.push({ fn: "setFlows", state: instanceState.get().state }); return "newRev" });
                await pipeline.deploy({ type: "full", source: "api", flows: { flows: [1] } });
                order.should.eql([{ fn: "hook", locked: true, state: "ready" }, { fn: "setFlows", state: "deploying" }]);
            });
            it("a revision error (409) comes before the hook: the hook is not called", async function() {
                const hook = sinon.spy();
                hooks.add("preDeploy.a", hook);
                await pipeline.deploy({ type: "full", flows: { flows: [1], rev: "other" } }).should.be.rejected();
                hook.called.should.be.false();
                noEffects();
            });
            it("single-flow api: an error of prepare (404, 409 ...) comes before the hook", async function() {
                const hook = sinon.spy();
                hooks.add("preDeploy.a", hook);
                await pipeline.deploy({ type: "flows", prepare: () => { throw Object.assign(new Error(), { code: 404 }) }, apply: async () => "x" }).should.be.rejected();
                hook.called.should.be.false();
                seen.should.eql([]);
            });
            it("reload: read (2) -> hook (3) -> credentials (3a) -> state deploying (4) -> load", async function() {
                const order = [];
                flows.readStoredFlows = sinon.spy(async () => { order.push("read:" + instanceState.get().state); return loadedConfig });
                flows.loadStoredCredentials = sinon.spy(async (c) => { order.push("credentials:" + instanceState.get().state); return c });
                flows.loadFlows = sinon.spy(async () => { order.push("load:" + instanceState.get().state); return "loadRev" });
                hooks.add("preDeploy.a", function() { order.push("hook:" + instanceState.get().state) });
                await pipeline.deploy({ type: "reload", source: "api" });
                order.should.eql(["read:ready", "hook:ready", "credentials:ready", "load:deploying"]);
            });
            it("the hook gets the candidate configuration: /flows the body, /flow prepared.config, reload the stored flows", async function() {
                const events = [];
                hooks.add("preDeploy.a", function(event) { events.push(event) });
                await pipeline.deploy({ type: "nodes", source: "api", req: {}, operation: "setFlows", flows: { flows: [{ id: "a", type: "x" }], credentials: { a: { p: "s" } } }, user: { username: "u", permissions: "*" } });
                await pipeline.deploy({
                    type: "flows", req: {}, operation: "updateFlow", user: null,
                    describe: (p) => ({ flowId: "t9", created: p.created }),
                    prepare: async () => ({ config: [{ id: "t9", type: "tab" }], created: true }), apply: async () => "x"
                });
                await pipeline.deploy({ type: "reload", source: "api" });
                events.map(e => e.type).should.eql(["nodes", "flows", "reload"]);
                events[0].flows.should.eql([{ id: "a", type: "x" }]);
                events[0].should.not.have.property("credentials");
                events[0].operation.should.equal("setFlows");
                events[0].source.should.equal("api");
                events[0].activeRev.should.equal("currentRev");
                events[0].user.should.eql({ username: "u", permissions: "*" });
                events[1].flows.should.eql([{ id: "t9", type: "tab" }]);
                events[1].operation.should.equal("updateFlow");
                events[1].flowId.should.equal("t9");
                events[1].created.should.equal(true);
                should.equal(events[1].user, null);
                events[2].flows.should.eql(loadedConfig.flows);
                events[2].rev.should.equal("storedRev");
                events[2].activeRev.should.equal("currentRev");
            });
            it("source is internal without a request", async function() {
                let event;
                hooks.add("preDeploy.a", function(e) { event = e });
                await pipeline.deploy({ type: "full", source: "api", operation: "setFlows", flows: { flows: [1] } });
                event.source.should.equal("internal");
            });
            it("a body whose flows are not an array: the hook is skipped, the deployment goes on as in 5.0.7", async function() {
                const hook = sinon.spy();
                hooks.add("preDeploy.a", hook);
                await pipeline.deploy({ type: "full", flows: { flows: "not an array" } });
                await pipeline.deploy({ type: "full", flows: {} });
                hook.called.should.be.false();
                flows.setFlows.calledTwice.should.be.true();
            });
        });

        describe("a rejection, a failure and a timeout (I3)", function() {
            const kinds = [
                ["a rejection by false", () => false, "deploy_rejected", 400],
                ["a rejection by an Error with status 400", () => { throw intended() }, "deploy_rejected", 400],
                ["a failure", () => { throw new TypeError("x") }, "deploy_hook_failed", 503],
                ["a timeout", () => new Promise(() => {}), "deploy_hook_timeout", 503]
            ];
            const operations = [
                ["/flows full", () => ({ type: "full", source: "api", flows: { flows: [1] } })],
                ["/flows flows", () => ({ type: "flows", source: "api", flows: { flows: [1] } })],
                ["/flows reload", () => ({ type: "reload", source: "api" })],
                ["/flow", () => ({ type: "flows", source: "api", prepare: async () => ({ config: [1] }), apply: async () => "x" })]
            ];
            kinds.forEach(function(kind) {
                operations.forEach(function(operation) {
                    it(kind[0] + " (" + operation[0] + "): no save, no stop, no state, no credentials, no postDeploy; the lock is released", async function() {
                        const post = sinon.spy();
                        hooks.add("postDeploy.a", post);
                        hooks.add("preDeploy.a", kind[1]);
                        const err = await pipeline.deploy(operation[1]()).then(() => null, e => e);
                        should.exist(err);
                        err.should.have.property("code", kind[2]);
                        err.should.have.property("status", kind[3]);
                        noEffects();
                        await new Promise(r => setImmediate(r));
                        post.called.should.be.false();
                    });
                });
            });
            it("the next deployment after a rejection goes through", async function() {
                let accept = false;
                hooks.add("preDeploy.a", () => accept ? undefined : false);
                await pipeline.deploy({ type: "full", flows: { flows: [1] } }).should.be.rejected();
                accept = true;
                (await pipeline.deploy({ type: "full", flows: { flows: [1] } })).should.eql({ rev: "newRev" });
                seen[0].should.equal("deploying");
            });
            it("a rejection does not cancel a pending reload from storage (reloadPending) and does not clear the condition reload (R-47)", async function() {
                instanceState.markReloadPending();
                instanceState.markDraining();
                seen.length = 0;
                hooks.add("preDeploy.a", () => false);
                await pipeline.deploy({ type: "full", flows: { flows: [1] } }).should.be.rejected();
                instanceState.get().state.should.equal("reloadPending");
                seen.should.eql([]);
            });
            it("the lock is held by the hook for at most hookTimeout (I9)", async function() {
                hooks.add("preDeploy.a", () => new Promise(() => {}));
                const started = Date.now();
                const first = pipeline.deploy({ type: "full", flows: { flows: [1] } }).then(() => null, e => e);
                await new Promise(r => setTimeout(r, 30));
                lock.isLocked().should.be.true();
                const second = pipeline.deploy({ type: "full", flows: { flows: [2] } }).then(() => null, e => e);
                (await first).should.have.property("code", "deploy_hook_timeout");
                (Date.now() - started).should.be.below(400);
                // SEC-103: the second does not run the handler again
                (await second).should.have.property("code", "deploy_hook_timeout");
                lock.isLocked().should.be.false();
                flows.setFlows.called.should.be.false();
            });
        });

        describe("what the hook cannot do (I4, I5)", function() {
            it("I4: a mutation of the event gives 503 and the deployed configuration is the client's, credentials included", async function() {
                const body = { flows: [{ id: "t1", type: "tab", credentials: { a: "secret" } }], credentials: { t1: { a: "secret" } } };
                hooks.add("preDeploy.a", function(event) { "use strict"; event.flows[0].label = "changed" });
                const err = await pipeline.deploy({ type: "full", flows: body }).then(() => null, e => e);
                err.should.have.property("code", "deploy_hook_failed");
                flows.setFlows.called.should.be.false();
                // a sloppy handler: nothing changes
                hooks.clear();
                hooks.add("preDeploy.b", function(event) { event.flows[0].label = "changed" });
                await pipeline.deploy({ type: "full", flows: body });
                flows.setFlows.firstCall.args[0].should.equal(body.flows);
                body.flows[0].should.eql({ id: "t1", type: "tab", credentials: { a: "secret" } });
                flows.setFlows.firstCall.args[1].should.equal(body.credentials);
            });
            it("I5: no credentials and no env cred value in the event of /flows, /flow and reload", async function() {
                const secretConfig = () => [
                    { id: "t1", type: "tab", credentials: { c: "secret" }, env: [{ name: "K", type: "cred", value: "secret" }] },
                    { id: "n1", type: "subflow:s1", z: "t1", credentials: { c: "secret" }, env: [{ name: "K", type: "cred", value: "secret" }] }
                ];
                const events = [];
                hooks.add("preDeploy.a", function(event) { events.push(JSON.stringify(event.flows)) });
                await pipeline.deploy({ type: "full", flows: { flows: secretConfig(), credentials: { t1: { c: "secret" } } } });
                await pipeline.deploy({ type: "flows", prepare: async () => ({ config: secretConfig() }), apply: async () => "x" });
                flows.readStoredFlows = sinon.spy(async () => ({ flows: secretConfig(), rev: "R", credentials: { t1: { c: "secret" } } }));
                await pipeline.deploy({ type: "reload" });
                events.should.have.length(3);
                events.forEach(e => e.should.not.containEql("secret"));
            });
        });

        describe("reload: what was checked is what runs (I10)", function() {
            it("the same object that the hook saw is deployed; storage is not read again", async function() {
                const stored = { flows: [{ id: "t1", type: "tab" }], rev: "A" };
                flows.readStoredFlows = sinon.spy(async () => stored);
                hooks.add("preDeploy.a", async function(event) {
                    // the file changes while the hook runs
                    flows.readStoredFlows = sinon.spy(async () => ({ flows: [{ id: "forbidden", type: "tab" }], rev: "B" }));
                    await new Promise(r => setTimeout(r, 10));
                });
                await pipeline.deploy({ type: "reload", source: "api" });
                flows.loadFlows.calledOnce.should.be.true();
                flows.loadFlows.firstCall.args[2].should.equal(stored);
                flows.loadStoredCredentials.firstCall.args[0].should.equal(stored);
            });
        });

        describe("startTimeoutReleasesLock and supersede (I13)", function() {
            it("the preDeploy of a second deployment runs while the first still starts; its rejection does not touch the first's state or token", async function() {
                let finishStart;
                let startCalls = 0;
                flows.setFlows = sinon.spy(async function() {
                    startCalls++;
                    if (startCalls === 1) {
                        // as flows.setFlows with deploy.startTimeoutReleasesLock: the lock is released after the limit
                        lock.holdUntil(new Promise(resolve => { finishStart = () => resolve({ errors: [] }) }), { limit: 20 });
                    }
                    return "rev" + startCalls;
                });
                hooks.add("preDeploy.a", function(event) { return event.flows[0] === "reject" ? false : undefined });
                (await pipeline.deploy({ type: "full", flows: { flows: ["first"] } })).should.eql({ rev: "rev1" });
                const stateBefore = instanceState.get();
                stateBefore.state.should.equal("deploying");
                const err = await pipeline.deploy({ type: "full", flows: { flows: ["reject"] } }).then(() => null, e => e);
                err.should.have.property("code", "deploy_rejected");
                // the first deployment is still starting: its state and token are untouched
                instanceState.get().should.eql(stateBefore);
                flows.setFlows.calledOnce.should.be.true();
                finishStart();
                await lock.runExclusive(async () => {});
                instanceState.get().should.containEql({ state: "ready", previous: "deploying", reason: "deploy" });
                // preDeploy ran exactly once for each of the two deployments
                (await pipeline.deploy({ type: "full", flows: { flows: ["third"] } })).should.eql({ rev: "rev2" });
            });
            it("an accepted second deployment during the start (supersede) runs the hook once", async function() {
                let finishStart;
                let startCalls = 0;
                flows.setFlows = sinon.spy(async function() {
                    startCalls++;
                    if (startCalls === 1) {
                        lock.holdUntil(new Promise(resolve => { finishStart = () => resolve({ errors: [] }) }), { limit: 20 });
                    }
                    return "rev" + startCalls;
                });
                const hook = sinon.spy();
                hooks.add("preDeploy.a", hook);
                await pipeline.deploy({ type: "full", flows: { flows: ["first"] } });
                await pipeline.deploy({ type: "full", flows: { flows: ["second"] } });
                hook.calledTwice.should.be.true();
                finishStart();
                await lock.runExclusive(async () => {});
            });
        });

        describe("a handler that never finishes (I14)", function() {
            it("three deployments: the first times out, the next two are answered at once without calling the handler; the late result does not change a later deployment", async function() {
                let calls = 0;
                let finishLate;
                hooks.add("preDeploy.hang", function() {
                    calls++;
                    if (calls === 1) {
                        return new Promise(resolve => { finishLate = resolve });
                    }
                });
                const first = await pipeline.deploy({ type: "full", flows: { flows: [1] } }).then(() => null, e => e);
                first.should.have.property("code", "deploy_hook_timeout");
                const started = Date.now();
                for (let i = 0; i < 2; i++) {
                    (await pipeline.deploy({ type: "full", flows: { flows: [1] } }).then(() => null, e => e)).should.have.property("code", "deploy_hook_timeout");
                }
                (Date.now() - started).should.be.below(50);
                calls.should.equal(1);
                finishLate(false);
                await new Promise(r => setTimeout(r, 10));
                // the call ended: the handler accepts again and the late `false` is not applied
                (await pipeline.deploy({ type: "full", flows: { flows: [1] } })).should.eql({ rev: "newRev" });
                calls.should.equal(2);
            });
        });

        describe("a deployment started from the hook (SEC-104a, documented)", function() {
            it("ends with 503 within the hookTimeout (plus a margin): the inner one waits for the lock, the limit stops the outer one, the inner one meets the busy handler", async function() {
                pipeline.init({ flows: flows, settings: { deploy: { hookTimeout: 200 } } });
                const results = {};
                let inner;
                hooks.add("preDeploy.reentrant", function() {
                    inner = pipeline.deploy({ type: "full", flows: { flows: ["inner"] } }).then(() => { results.inner = null }, e => { results.inner = e });
                    return inner;
                });
                const started = Date.now();
                const outer = await pipeline.deploy({ type: "full", flows: { flows: ["outer"] } }).then(() => null, e => e);
                outer.should.have.property("code", "deploy_hook_timeout");
                await inner;
                results.inner.should.have.property("code", "deploy_hook_timeout");
                // hookTimeout is 200 ms: both ended within it (+ a margin of less than half of it), not after 2 x hookTimeout
                (Date.now() - started).should.be.below(350);
                flows.setFlows.called.should.be.false();
                lock.isLocked().should.be.false();
            });
        });

        describe('deployment type "load" (the header Node-RED-Deployment-Type: ignores the body, deploys the content of storage)', function() {
            const stored = () => ({ flows: [{ id: "t1", type: "tab" }, { id: "bad", type: "inject", z: "t1" }], rev: "storedRev", credentials: { c: 1 } });
            beforeEach(function() {
                flows.readStoredFlows = sinon.spy(async function() { calls.push({ fn: "readStoredFlows", state: instanceState.get().state }); return stored() });
                flows.loadStoredCredentials = sinon.spy(async function(config) { calls.push({ fn: "loadStoredCredentials", state: instanceState.get().state }); return Object.assign({ loaded: true }, config) });
                flows.setFlows = sinon.spy(async function() { calls.push({ fn: "setFlows", state: instanceState.get().state }); return "newRev" });
            });
            const rejectForbidden = (event) => event.flows.some(n => n.type === "inject") ? false : undefined;

            [["{}", {}], ["[]", { flows: [] }], ["no body", undefined], ["a body that is not an array", { flows: "x" }]].forEach(function(c) {
                it("with a handler: a body of " + c[0] + " does not hide the content of storage - the hook sees it and rejects; nothing is activated", async function() {
                    const events = [];
                    hooks.add("preDeploy.a", function(event) { events.push(event); return rejectForbidden(event) });
                    const err = await pipeline.deploy({ type: "load", source: "api", req: {}, operation: "setFlows", flows: c[1] }).then(() => null, e => e);
                    err.should.have.property("code", "deploy_rejected");
                    err.should.have.property("status", 400);
                    events.should.have.length(1);
                    events[0].type.should.equal("load");
                    events[0].rev.should.equal("storedRev");
                    events[0].flows.map(n => n.id).should.eql(["t1", "bad"]);
                    flows.setFlows.called.should.be.false();
                    flows.loadFlows.called.should.be.false();
                    flows.loadStoredCredentials.called.should.be.false();
                    seen.should.eql([]);
                    lock.isLocked().should.be.false();
                });
            });
            it("with a handler that accepts: read (2) -> hook (3) -> credentials (3a) -> deploying (4) -> setFlows with the same object (I10)", async function() {
                let saw;
                hooks.add("preDeploy.a", async function(event) {
                    saw = event;
                    calls.push({ fn: "hook", state: instanceState.get().state });
                    // storage changes while the hook runs: it is not read again
                    flows.readStoredFlows = sinon.spy(async () => ({ flows: [{ id: "other", type: "tab" }], rev: "otherRev" }));
                });
                const result = await pipeline.deploy({ type: "load", source: "api", req: {}, operation: "setFlows", flows: { flows: [] } });
                result.should.eql({ rev: "newRev" });
                calls.map(c => c.fn + ":" + c.state).should.eql(["readStoredFlows:ready", "hook:ready", "loadStoredCredentials:ready", "setFlows:deploying"]);
                saw.flows.map(n => n.id).should.eql(["t1", "bad"]);
                const args = flows.setFlows.firstCall.args;
                args.should.have.length(8);
                args[2].should.equal("load");
                // the object that was deployed is the one that loadStoredCredentials returned for what the hook saw
                args[7].should.have.property("loaded", true);
                args[7].should.have.property("rev", "storedRev");
                args[7].flows.map(n => n.id).should.eql(["t1", "bad"]);
                flows.loadStoredCredentials.firstCall.args[0].should.have.property("rev", "storedRev");
            });
            it("the revision check (409) comes before the read and the hook", async function() {
                const hook = sinon.spy();
                hooks.add("preDeploy.a", hook);
                await pipeline.deploy({ type: "load", flows: { flows: [], rev: "other" } }).should.be.rejectedWith({ code: "version_mismatch" });
                flows.readStoredFlows.called.should.be.false();
                hook.called.should.be.false();
            });
            it("a failed read of storage ends the deployment before the hook", async function() {
                const hook = sinon.spy();
                hooks.add("preDeploy.a", hook);
                flows.readStoredFlows = sinon.spy(async () => { throw new Error("read failed") });
                await pipeline.deploy({ type: "load", flows: { flows: [] } }).should.be.rejectedWith("read failed");
                hook.called.should.be.false();
                flows.setFlows.called.should.be.false();
                seen.should.eql([]);
            });
            it("a stored content whose flows are not an array is not given to the hook (as for reload)", async function() {
                const hook = sinon.spy();
                hooks.add("preDeploy.a", hook);
                flows.readStoredFlows = sinon.spy(async () => ({ flows: "x", rev: "r" }));
                await pipeline.deploy({ type: "load", flows: {} });
                hook.called.should.be.false();
                flows.setFlows.calledOnce.should.be.true();
            });
            it("off_identical - without a preDeploy handler the old path: no read in the pipeline, setFlows with the 7 arguments", async function() {
                hooks.add("preReload.a", () => false);
                hooks.add("postDeploy.a", () => {});
                await pipeline.deploy({ type: "load", source: "api", flows: { flows: [] }, user: "u" });
                flows.readStoredFlows.called.should.be.false();
                flows.loadStoredCredentials.called.should.be.false();
                flows.setFlows.firstCall.args.should.eql([[], undefined, "load", null, null, "u", undefined]);
                calls.map(c => c.fn + ":" + c.state).should.eql(["setFlows:deploying"]);
            });
            it("a postDeploy handler alone does not change the path of load", async function() {
                const post = [];
                hooks.add("postDeploy.a", e => { post.push(e) });
                flows.getFlows = sinon.spy(() => ({ rev: "R" + flows.getFlows.callCount }));
                await pipeline.deploy({ type: "load", source: "api", req: {}, operation: "setFlows", flows: {} });
                flows.readStoredFlows.called.should.be.false();
                await new Promise(r => setImmediate(r));
                post.should.have.length(1);
                post[0].type.should.equal("load");
            });
        });

        describe("scope (I8)", function() {
            it("a reload from storage (source storage) does not run preDeploy", async function() {
                const hook = sinon.spy();
                hooks.add("preDeploy.a", hook);
                instanceState.markReloadPending();
                flows.reloadFromStorage = sinon.spy(async (loaded) => loaded.rev);
                const result = await pipeline.deploy({ type: "reload", source: "storage", reread: async () => ({ apply: { flows: [], rev: "B" }, reloadType: "full" }) });
                result.should.eql({ rev: "B" });
                hook.called.should.be.false();
            });
        });
    });
    describe("postDeploy hook (Z-06, step 11)", function() {
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        const { hooks, log } = NR_TEST_UTILS.require("@node-red/util");
        let logStubs;
        let logged;
        let posts;
        let active;
        let counter;
        const flush = async () => { await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)) };
        // flows.setFlows / loadFlows / reloadFromStorage that replace the active configuration like flows/index.js
        function replacing(rev, extra) {
            return sinon.spy(async function() {
                active = { rev: rev || ("N" + (++counter)), flows: [] };
                if (extra) {
                    await extra();
                }
                return active.rev;
            });
        }
        beforeEach(function() {
            instanceState.reset();
            instanceState.markStarting();
            instanceState.report({ errors: [] });
            logged = { warn: [], error: [] };
            logStubs = [
                sinon.stub(log, "_").callsFake(k => "[" + k + "]"),
                sinon.stub(log, "warn").callsFake(m => logged.warn.push(m)),
                sinon.stub(log, "error").callsFake(m => logged.error.push(m)),
                sinon.stub(log, "debug")
            ];
            counter = 0;
            active = { rev: "A", flows: [] };
            flows.getFlows = sinon.spy(() => active);
            flows.setFlows = replacing();
            flows.loadFlows = replacing("L");
            flows.reloadFromStorage = sinon.spy(async function(loaded) { active = { rev: loaded.rev, flows: [] }; return loaded.rev });
            posts = [];
            hooks.add("postDeploy.test", function(event) { posts.push(event) });
            pipeline.init({ flows: flows, settings: { deploy: { hookTimeout: 100 } } });
        });
        afterEach(function() {
            logStubs.forEach(s => s.restore());
            hooks.clear();
            instanceState.reset();
        });
        const savedError = (code, extra) => Object.assign(new Error(code), { code: code, status: 500 }, extra);

        describe("when and what", function() {
            it("once per deployment, after the result is returned, asynchronously; the event has the facts", async function() {
                const result = await pipeline.deploy({ type: "nodes", source: "api", req: {}, operation: "setFlows", flows: { flows: [1] }, user: { username: "u", permissions: "*" } });
                result.should.eql({ rev: "N1" });
                posts.should.have.length(0);
                await flush();
                posts.should.have.length(1);
                posts[0].rev.should.equal("N1");
                posts[0].type.should.equal("nodes");
                posts[0].source.should.equal("api");
                posts[0].operation.should.equal("setFlows");
                should.equal(posts[0].flowId, null);
                posts[0].user.should.eql({ username: "u", permissions: "*" });
                posts[0].start.should.eql({ status: "not_started" });
                posts[0].should.not.have.property("reloadType");
            });
            it("the single-flow api: operation and flowId; the revision is that of the whole configuration", async function() {
                await pipeline.deploy({
                    type: "flows", req: {}, operation: "addFlow", describe: p => ({ flowId: p.id }),
                    prepare: async () => ({ config: [], id: "new1" }),
                    apply: async (deployOpts, prepared) => { await flows.setFlows(); return prepared.id }
                });
                await flush();
                posts.should.have.length(1);
                posts[0].operation.should.equal("addFlow");
                posts[0].flowId.should.equal("new1");
                posts[0].rev.should.equal("N1");
            });
            it("source is internal without a request", async function() {
                await pipeline.deploy({ type: "full", source: "api", operation: "setFlows", flows: { flows: [1] } });
                await flush();
                posts[0].source.should.equal("internal");
            });
            it("an API reload: type reload and reloadType full, the revision loaded", async function() {
                await pipeline.deploy({ type: "reload", source: "api", req: {}, operation: "setFlows" });
                await flush();
                posts.should.have.length(1);
                posts[0].type.should.equal("reload");
                posts[0].reloadType.should.equal("full");
                posts[0].rev.should.equal("L");
            });
            it("D17: pending in the default mode with a registered start, started with deploy.response started", async function() {
                const holding = () => sinon.spy(async function() {
                    active = { rev: "N" + (++counter), flows: [] };
                    lock.holdUntil(new Promise(() => {}), { limit: 5 });
                    return active.rev;
                });
                flows.setFlows = holding();
                await pipeline.deploy({ type: "full", flows: { flows: [1] } });
                await flush();
                posts[0].start.should.eql({ status: "pending" });
                flows.setFlows = holding();
                await pipeline.deploy({ type: "full", flows: { flows: [1] }, deployOpts: { waitForStart: true } });
                await flush();
                posts[1].start.should.eql({ status: "started" });
            });
            it("the state at the call: deploying with the lock held while the start goes on (a handler must not assume ready)", async function() {
                let finishStart;
                flows.setFlows = sinon.spy(async function() {
                    active = { rev: "N", flows: [] };
                    lock.holdUntil(new Promise(resolve => { finishStart = () => resolve({ errors: [] }) }));
                    return "N";
                });
                let seen;
                hooks.clear();
                hooks.add("postDeploy.test", function() { seen = { state: instanceState.get().state, locked: lock.isLocked() } });
                await pipeline.deploy({ type: "full", flows: { flows: [1] } });
                await flush();
                seen.should.eql({ state: "deploying", locked: true });
                finishStart();
                await lock.runExclusive(async () => {});
            });
            it("D23: the default mode, a swallowed stop error (no start registered, flows.setFlows resolves): not_started", async function() {
                flows.setFlows = sinon.spy(async function() { active = { rev: "N", flows: [] }; return undefined });
                const result = await pipeline.deploy({ type: "full", flows: { flows: [1] } });
                result.should.eql({ rev: undefined });
                await flush();
                posts.should.have.length(1);
                posts[0].start.should.eql({ status: "not_started" });
                instanceState.get().state.should.equal("idle");
            });
            it("the order of the deployments is kept (FIFO) and each is notified once", async function() {
                await pipeline.deploy({ type: "full", flows: { flows: [1] } });
                await pipeline.deploy({ type: "full", flows: { flows: [2] } });
                await pipeline.deploy({ type: "full", flows: { flows: [3] } });
                await flush();
                posts.map(p => p.rev).should.eql(["N1", "N2", "N3"]);
            });
        });

        describe("an error after the save is a deployed configuration too (I11, D18, D24)", function() {
            it("deploy_start_failed with a start_timeout: one call, pending with the errors; the deployment still rejects", async function() {
                flows.setFlows = sinon.spy(async function() {
                    active = { rev: "N", flows: [] };
                    lock.holdUntil(new Promise(() => {}), { limit: 5 });
                    throw savedError("deploy_start_failed", { rev: "N", errors: [{ code: "start_timeout", message: "t", timeout: 30 }] });
                });
                const err = await pipeline.deploy({ type: "full", flows: { flows: [1] }, deployOpts: { waitForStart: true } }).should.be.rejected();
                err.should.have.property("code", "deploy_start_failed");
                await flush();
                posts.should.have.length(1);
                posts[0].start.should.eql({ status: "pending", errors: [{ code: "start_timeout", message: "t", timeout: 30 }] });
                posts[0].rev.should.equal("N");
            });
            it("deploy_start_failed without a start_timeout: start_failed with the errors; deploy_stop_failed: stop_failed", async function() {
                flows.setFlows = sinon.spy(async function() {
                    active = { rev: "N" + (++counter), flows: [] };
                    throw savedError("deploy_start_failed", { errors: [{ code: "missing_types", message: "m", types: ["x"] }] });
                });
                await pipeline.deploy({ type: "full", flows: { flows: [1] }, deployOpts: { waitForStart: true } }).should.be.rejected();
                flows.setFlows = sinon.spy(async function() {
                    active = { rev: "N" + (++counter), flows: [] };
                    throw savedError("deploy_stop_failed", { rev: "N2" });
                });
                await pipeline.deploy({ type: "full", flows: { flows: [1] }, deployOpts: { waitForStart: true } }).should.be.rejected();
                await flush();
                posts.map(p => p.start.status).should.eql(["start_failed", "stop_failed"]);
                posts[0].start.errors.should.eql([{ code: "missing_types", message: "m", types: ["x"] }]);
            });
            it("an unexpected error in apply after the save: one call, the start status from the registered start, the error apart (D24)", async function() {
                const err = await pipeline.deploy({
                    type: "flows", req: {}, operation: "updateFlow", prepare: async () => ({ config: [] }),
                    apply: async () => { await flows.setFlows(); throw Object.assign(new Error("lookup"), { code: "revision_lookup_failed" }) }
                }).should.be.rejected();
                err.should.have.property("code", "revision_lookup_failed");
                await flush();
                posts.should.have.length(1);
                posts[0].start.should.eql({ status: "not_started" });
                posts[0].error.should.eql({ code: "revision_lookup_failed" });
            });
            it("an unexpected error of flows.setFlows itself after the save: unknown", async function() {
                flows.setFlows = sinon.spy(async function() {
                    active = { rev: "N", flows: [] };
                    throw new TypeError("unexpected");
                });
                await pipeline.deploy({ type: "full", flows: { flows: [1] } }).should.be.rejectedWith("unexpected");
                await flush();
                posts.should.have.length(1);
                posts[0].start.should.eql({ status: "unknown" });
                posts[0].error.should.eql({ code: "unexpected_error" });
            });
            it("a failed save (the active configuration is not replaced): no call", async function() {
                flows.setFlows = sinon.spy(async () => { throw new Error("save failed") });
                await pipeline.deploy({ type: "full", flows: { flows: [1] } }).should.be.rejectedWith("save failed");
                await pipeline.deploy({
                    type: "flows", prepare: async () => ({ config: [] }),
                    apply: async () => { throw Object.assign(new Error("save failed"), { code: "storage_error" }) }
                }).should.be.rejected();
                await flush();
                posts.should.have.length(0);
            });
            it("rejections before the save (409, an error of prepare, the hook, a read of storage): no call", async function() {
                await pipeline.deploy({ type: "full", flows: { flows: [1], rev: "other" } }).should.be.rejected();
                await pipeline.deploy({ type: "flows", prepare: () => { throw Object.assign(new Error(), { code: 404 }) }, apply: async () => "x" }).should.be.rejected();
                hooks.add("preDeploy.no", () => false);
                await pipeline.deploy({ type: "full", flows: { flows: [1] } }).should.be.rejected();
                hooks.remove("preDeploy.no");
                flows.readStoredFlows = sinon.spy(async () => { throw new Error("read failed") });
                await pipeline.deploy({ type: "reload" }).should.be.rejected();
                await flush();
                posts.should.have.length(0);
            });
        });

        describe("a handler never delays the deployment (I7)", function() {
            it("a handler that does not finish: the response and the next deployments are not delayed, the lock is free", async function() {
                hooks.clear();
                let calls = 0;
                hooks.add("postDeploy.hang", () => { calls++; return new Promise(() => {}) });
                const started = Date.now();
                await pipeline.deploy({ type: "full", flows: { flows: [1] } });
                await pipeline.deploy({ type: "full", flows: { flows: [2] } });
                (Date.now() - started).should.be.below(50);
                lock.isLocked().should.be.false();
                await flush();
                calls.should.equal(2);
            });
            it("a handler that throws does not change the result of the deployment", async function() {
                hooks.clear();
                hooks.add("postDeploy.bad", () => { throw new Error("boom") });
                (await pipeline.deploy({ type: "full", flows: { flows: [1] } })).should.eql({ rev: "N1" });
                await flush();
                logged.warn.should.have.length(1);
                logged.warn[0].should.containEql("deploy.post-hook-failed");
            });
        });

        describe("a reload from storage (source storage, step 11 of part B)", function() {
            const reread = (decision) => async () => decision;
            it("once, after the reload was applied: source storage, operation null, reloadType, the revision loaded", async function() {
                instanceState.markReloadPending();
                const result = await pipeline.deploy({ type: "reload", source: "storage", reread: reread({ apply: { flows: [], rev: "B" }, reloadType: "diff", credentialsChanged: false }) });
                result.should.eql({ rev: "B" });
                await flush();
                posts.should.have.length(1);
                posts[0].source.should.equal("storage");
                posts[0].type.should.equal("reload");
                posts[0].reloadType.should.equal("diff");
                should.equal(posts[0].operation, null);
                should.equal(posts[0].flowId, null);
                should.equal(posts[0].user, null);
                posts[0].rev.should.equal("B");
                posts[0].start.should.eql({ status: "not_started" });
            });
            it("pending with a registered start", async function() {
                instanceState.markReloadPending();
                flows.reloadFromStorage = sinon.spy(async function(loaded) {
                    active = { rev: loaded.rev, flows: [] };
                    lock.holdUntil(Promise.resolve({ errors: [] }));
                    return loaded.rev;
                });
                await pipeline.deploy({ type: "reload", source: "storage", reread: reread({ apply: { flows: [], rev: "B" }, reloadType: "full" }) });
                await flush();
                posts[0].start.should.eql({ status: "pending" });
            });
            it("no preDeploy for a reload from storage, also with a postDeploy handler (R-15)", async function() {
                const pre = sinon.spy();
                hooks.add("preDeploy.a", pre);
                instanceState.markReloadPending();
                await pipeline.deploy({ type: "reload", source: "storage", reread: reread({ apply: { flows: [], rev: "B" }, reloadType: "full" }) });
                await flush();
                pre.called.should.be.false();
                posts.should.have.length(1);
            });
            it("D22/A31: a pending reload superseded by a deployment of this instance: exactly one postDeploy (api), none for storage", async function() {
                instanceState.markReloadPending();
                instanceState.markDraining();
                let rereadCalled = false;
                // the deployment A takes the lock first and supersedes the pending reload B
                const a = pipeline.deploy({ type: "full", source: "api", req: {}, operation: "setFlows", flows: { flows: [1] } });
                const b = pipeline.deploy({ type: "reload", source: "storage", reread: async () => { rereadCalled = true; return { apply: { flows: [], rev: "B" }, reloadType: "full" } } });
                (await a).should.eql({ rev: "N1" });
                (await b).should.eql({ skipped: "superseded" });
                await flush();
                rereadCalled.should.be.false();
                flows.reloadFromStorage.called.should.be.false();
                posts.should.have.length(1);
                posts[0].source.should.equal("api");
                posts[0].rev.should.equal("N1");
            });
            it("D22: a round of D-17 without a decision to apply (skip, unchanged, an extra round): no postDeploy", async function() {
                for (const decision of [
                    { skip: "unchanged" },
                    { skip: "aborted" },
                    { extra: ["t1"], fresh: { rev: "C", flows: [] }, credentialsChanged: false },
                    { error: new Error("read failed") },
                    undefined
                ]) {
                    instanceState.markReloadPending();
                    const result = await pipeline.deploy({ type: "reload", source: "storage", reread: reread(decision) });
                    result.should.have.property("skipped");
                    // the cycle restores the state, as reload.js does
                    instanceState.cancelPending();
                }
                await flush();
                posts.should.have.length(0);
                flows.reloadFromStorage.called.should.be.false();
            });
            it("an error before the active configuration is replaced (the credentials cannot be loaded): no call; after it: one call with the error", async function() {
                instanceState.markReloadPending();
                flows.reloadFromStorage = sinon.spy(async function() { throw Object.assign(new Error("credentials"), { code: "credentials_load_failed" }) });
                await pipeline.deploy({ type: "reload", source: "storage", reread: reread({ apply: { flows: [], rev: "B" }, reloadType: "full" }) }).should.be.rejectedWith("credentials");
                await flush();
                posts.should.have.length(0);
                instanceState.get().state.should.equal("ready");
                instanceState.markReloadPending();
                flows.reloadFromStorage = sinon.spy(async function() { active = { rev: "B", flows: [] }; throw new TypeError("after the replacement") });
                await pipeline.deploy({ type: "reload", source: "storage", reread: reread({ apply: { flows: [], rev: "B" }, reloadType: "full" }) }).should.be.rejectedWith("after the replacement");
                await flush();
                posts.should.have.length(1);
                posts[0].start.should.eql({ status: "unknown" });
                posts[0].error.should.eql({ code: "unexpected_error" });
            });
        });

        describe("without a postDeploy handler (I1)", function() {
            it("the active configuration is not read for the facts; a preDeploy handler alone changes nothing about it", async function() {
                hooks.clear();
                hooks.add("preDeploy.a", () => {});
                flows.getFlows.resetHistory();
                await pipeline.deploy({ type: "nodes", flows: { flows: [1] } });
                // the event of preDeploy reads the active revision once
                flows.getFlows.callCount.should.equal(1);
                hooks.clear();
                flows.getFlows.resetHistory();
                await pipeline.deploy({ type: "nodes", flows: { flows: [1] } });
                instanceState.markReloadPending();
                await pipeline.deploy({ type: "reload", source: "storage", reread: async () => ({ apply: { flows: [], rev: "B" }, reloadType: "full" }) });
                flows.getFlows.called.should.be.false();
            });
        });
    });
});
