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
 *   E-01: the lock is held until the start completes (R-43)
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
            readFlowsFromStorage: sinon.spy(async function() {
                calls.push({ fn: "readFlowsFromStorage", locked: lock.isLocked() });
                return loadedConfig;
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
    it("api reload reads storage under lock before preDeploy anchor", async function() {
        const result = await pipeline.deploy({ type: "reload", source: "api" });
        result.should.eql({ rev: "loadRev" });
        calls.map(c => c.fn).should.eql(["readFlowsFromStorage", "loadFlows"]);
        calls.every(c => c.locked).should.be.true();
        flows.loadFlows.firstCall.args.should.eql([true, undefined, loadedConfig]);
    });
    it("reload with loaded config does not read storage again", async function() {
        const loaded = { flows: [], rev: "x" };
        await pipeline.deploy({ type: "reload", source: "storage", loaded: loaded });
        flows.readFlowsFromStorage.called.should.be.false();
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
        flows.readFlowsFromStorage = sinon.spy(async function() {
            order.push("second");
            return loadedConfig;
        });
        const second = pipeline.deploy({ type: "reload" });
        const setState = lock.runExclusive(async () => order.push("setState"));
        await new Promise(resolve => setTimeout(resolve, 10));
        order.should.eql([]);
        flows.readFlowsFromStorage.called.should.be.false();
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
    it("releases the lock when the deployment fails", async function() {
        flows.setFlows = sinon.spy(async () => { throw new Error("save failed") });
        await pipeline.deploy({ flows: { flows: [1] } }).should.be.rejectedWith("save failed");
        lock.isLocked().should.be.false();
    });
});
