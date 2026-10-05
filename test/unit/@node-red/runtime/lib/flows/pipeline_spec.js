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
 *   Z-06 (#10): prepare/apply of the single-flow api (U1); reload: read in step 2, credentials in step 3a (D15)
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
});
