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
 *   #84: new file - a deployment, a start or a reload that races the stop of the runtime (runtime.stop()) must not
 *   start flows after the stop or leave flows running: the complete stop, the start guard, the result of a deployment
 *   that was past step 4 when the stop began, the refusal of the runtime api in stopping and stopped
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * The real modules flows/index.js, flows/pipeline.js, api/flows.js, the instance state, the deploy lock and
 * runtime.stop() with the fake flows of nr-test-utils/stop-race-world (the nodes are recorded, a close or a start
 * can be held). Every test names the acceptance criterion (AC-n) of the spec of #84.
 *
 * The modules keep state (the flows, the instance state, the lock): every test ends with a full stop of the flows
 * it started and resets the instance state, so nothing leaks into the specs that run later in the same process.
 */
const should = require("should");
const sinon = require("sinon");
const fs = require("fs");
const path = require("path");
const clone = require("clone");
const NR_TEST_UTILS = require("nr-test-utils");
const { createWorld, deferred, delay, flush, settle } = require("nr-test-utils/stop-race-world");

const flows = NR_TEST_UTILS.require("@node-red/runtime/lib/flows");
const apiFlows = NR_TEST_UTILS.require("@node-red/runtime/lib/api/flows");
const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");
const httpDrain = NR_TEST_UTILS.require("@node-red/runtime/lib/httpDrain");
const credentials = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/credentials");
const redNodes = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes");
const runtimeIndex = NR_TEST_UTILS.require("@node-red/runtime");
const typeRegistry = NR_TEST_UTILS.require("@node-red/registry");
const Flow = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/Flow");
const { events, hooks, log: utilLog } = NR_TEST_UTILS.require("@node-red/util");

const SKIPPED = "nodes.flows.start-skipped-stopping";

// Flow A (node a1) and flow B (node b1); `v` is a property of b1: version 2 is "the new configuration"
function config(v) {
    return [
        { id: "A", type: "tab", label: "A" },
        { id: "a1", type: "test", z: "A", wires: [], v: 1 },
        { id: "B", type: "tab", label: "B" },
        { id: "b1", type: "test", z: "B", wires: [], v: v || 1 }
    ];
}

describe("flows: a deployment racing the stop of the runtime (#84)", function() {
    let world;
    let storage;
    let saved;
    let saveGate;
    let rev;
    let runtime;
    let mockLog;
    let settings;
    let stubs;
    let seen;
    let states;
    let contexts;
    let dependencyGate;
    let drainGate;
    let finalized;
    let pending;
    let offState;
    const listeners = [];

    function listen(name, fn) {
        events.on(name, fn);
        listeners.push([name, fn]);
    }

    before(function() {
        stubs = [
            sinon.stub(typeRegistry, "get").callsFake(type => type.indexOf("missing") === -1),
            sinon.stub(typeRegistry, "checkFlowDependencies").callsFake(async function() {
                if (dependencyGate) {
                    await dependencyGate.promise;
                }
            })
        ];
    });
    after(function() {
        stubs.forEach(s => s.restore());
    });

    function infoCount(key) {
        return mockLog.info.args.filter(a => a[0] === key).length;
    }

    // The flows module and the apis, initialised with a storage mock; the flows are started (state ready)
    async function boot(extraSettings, options) {
        options = options || {};
        settings = Object.assign({ deploy: {}, runtimeState: { enabled: true, ui: false } }, extraSettings);
        saved = [];
        rev = 1;
        saveGate = null;
        mockLog = {
            log: sinon.stub(), debug: sinon.stub(), trace: sinon.stub(), warn: sinon.stub(), info: sinon.stub(),
            error: sinon.stub(), metric: sinon.stub(), audit: sinon.stub(),
            _: sinon.spy(function(key, params) { return params ? key + " " + JSON.stringify(params) : key })
        };
        storage = {
            getFlows: async () => ({ flows: clone(config(1)), rev: "rev1" }),
            saveFlows: async function(conf) {
                saved.push(conf);
                if (saveGate) {
                    await saveGate.promise;
                }
                return "rev" + (++rev);
            }
        };
        runtime = { log: mockLog, settings: settings, storage: storage, flows: flows, hooks: hooks, events: events };
        instanceState.reset();
        instanceState.markStarting();
        // reset() drops the listeners of the state
        if (offState) {
            offState();
        }
        offState = instanceState.onChange(info => states.push(info.state));
        flows.init(runtime);
        apiFlows.init(runtime);
        await flows.load();
        await flows.startFlows();
        await flush();
        if (!options.keepEvents) {
            seen.length = 0;
            states.length = 0;
        }
    }

    beforeEach(function() {
        world = createWorld(Flow, sinon);
        seen = [];
        states = [];
        contexts = [];
        dependencyGate = null;
        drainGate = null;
        finalized = [];
        pending = [];
        hooks.clear();
        credentialsStubs();
        ["flows:starting", "flows:started", "flows:stopping", "flows:stopped", "nodes-started", "nodes-stopped"].forEach(name => {
            listen(name, () => seen.push(name));
        });
        listen("runtime-event", function(event) {
            if (event && event.id === "runtime-state") {
                seen.push("runtime-state:" + (event.payload && event.payload.state));
            } else if (event && event.id === "runtime-deploy") {
                seen.push("runtime-deploy:" + event.payload.revision);
            }
        });
        stubs.push(sinon.stub(redNodes, "closeContextsPlugin").callsFake(async function() {
            contexts.push(world.closed.length);
        }));
    });

    let credentialStubs = [];
    function credentialsStubs() {
        credentialStubs = [
            sinon.stub(credentials, "clean").callsFake(conf => { conf.forEach(n => { delete n.credentials }); return Promise.resolve() }),
            sinon.stub(credentials, "load").callsFake(() => Promise.resolve()),
            sinon.stub(credentials, "add").callsFake(async () => {})
        ];
    }

    afterEach(async function() {
        // release what waits, let the suspended code finish, then drop the flows of the module (a partial stop
        // keeps the flow objects: the next spec that loads flows in this process would find the fakes)
        world.releaseAll();
        [saveGate, dependencyGate, drainGate].forEach(gate => gate && gate.resolve());
        await delay(30);
        // the full stop below must not fail on a node that a test made fail
        world.closeFail = {};
        world.closeGate = {};
        if (offState) {
            offState();
            offState = null;
        }
        listeners.splice(0).forEach(l => events.removeListener(l[0], l[1]));
        instanceState.reset();
        dependencyGate = null;
        saveGate = null;
        stubs.splice(2).forEach(s => s.restore());
        settings.deploy = {};
        settings.editorOnly = false;
        delete settings.nodeCloseTimeout;
        delete settings.safeMode;
        try {
            storage.getFlows = async () => ({ flows: clone(config(1)), rev: "clean" });
            storage.saveFlows = async () => "clean";
            await flows.load();
            await flows.startFlows();
            await flows.stopFlows("full");
        } finally {
            world.restore();
            credentialStubs.forEach(s => s.restore());
            hooks.clear();
            httpDrain.dispose();
            instanceState.reset();
        }
    });

    // runtime.stop(): the real function, with the contexts plugin stubbed; never rejects the test by itself
    function stopRuntime(reason) {
        const promise = runtimeIndex.stop(reason);
        pending.push(promise.catch(() => {}));
        return promise;
    }
    // a deployment through the runtime api
    function deploy(type, v, extra) {
        const promise = apiFlows.setFlows(Object.assign({ flows: { flows: config(v === undefined ? 2 : v) }, deploymentType: type, req: {}, user: { username: "u" } }, extra));
        pending.push(promise.catch(() => {}));
        return promise;
    }
    function starts() {
        return world.starts.length;
    }
    // the nodes that exist: asked through the module the editor and the nodes use
    function existing() {
        return ["a1", "b1"].filter(id => flows.get(id));
    }
    // nothing was constructed after the start of the test, no flow is running, every node was closed once
    function assertComplete(expectedClosed) {
        world.constructed.length.should.equal(expectedClosed.base, "a node was constructed after the stop");
        world.constructedNew().should.eql([]);
        world.closedTwice().should.eql([]);
        ["a1", "b1"].forEach(id => (world.closeCalls[id] || 0).should.equal(1, id + " was not closed exactly once"));
        existing().should.eql([]);
        world.liveIds().should.eql([], "a flow was left running");
        flows.started.should.be.false();
        flows.state().should.equal("stop");
    }

    describe("the harness (guard: passes before and after the change)", function() {
        it("AC-22: a deployment without a stop constructs the new nodes; runtime.stop() without a deployment closes everything in the order of today", async function() {
            await boot();
            const base = world.constructed.length;
            const result = await deploy("full");
            result.should.have.property("rev");
            await delay(100);
            world.constructedNew().map(n => n.id).should.eql(["b1"]);
            world.constructed.length.should.be.above(base);
            seen.length = 0;
            await stopRuntime();
            seen.should.eql(["flows:stopping", "flows:stopped", "runtime-state:stop", "nodes-stopped"]);
            world.liveIds().should.eql([]);
            flows.started.should.be.false();
            states.should.containEql("stopped");
        });
    });

    describe("AC-7: a full deployment is in its stop step when runtime.stop() is called (drain off, default response)", function() {
        let base;
        let deployment;
        let stopped;
        async function race(type, v) {
            await boot();
            base = world.constructed.length;
            world.closeGate.b1 = deferred();
            deployment = deploy(type, v);
            await flush();
            // the precondition: the deployment is in its stop step (the old node b1 is closing)
            world.closeCalls.b1.should.equal(1);
            stopped = stopRuntime();
            await delay(50);
            world.closeGate.b1.resolve();
        }

        it("AC-7: after runtime.stop() resolves no node of the new configuration is constructed (also not 200 ms later); the old nodes were closed once; the flows are stopped", async function() {
            await race("full");
            (await settle(stopped)).state.should.equal("resolved");
            (await settle(deployment)).state.should.equal("resolved");
            await delay(250);
            assertComplete({ base: base });
        });
        it("AC-7: GET /flows/state answers stop; no flows:started, nodes-started or runtime-state start after the stop began", async function() {
            await race("full");
            await settle(stopped);
            await settle(deployment);
            await delay(250);
            (await apiFlows.getState({})).should.eql({ state: "stop" });
            seen.filter(e => e === "flows:started" || e === "nodes-started" || e === "runtime-state:start" || e === "flows:starting").should.eql([]);
        });
        it("AC-7: the deployment answers 200 {rev}, the configuration is saved and active, runtime-deploy carries the revision", async function() {
            await race("full");
            const result = await settle(deployment);
            result.state.should.equal("resolved");
            result.value.should.have.property("rev").which.is.a.String();
            flows.getFlows().rev.should.equal(result.value.rev);
            saved.should.have.length(1);
            await settle(stopped);
            seen.should.containEql("runtime-deploy:" + result.value.rev);
        });
        it("AC-7: exactly one info log of the skipped start", async function() {
            await race("full");
            await settle(stopped);
            await settle(deployment);
            await delay(250);
            infoCount(SKIPPED).should.equal(1);
        });
        it("AC-24: the instance states after the deployment began are exactly deploying, stopping, stopped", async function() {
            await race("full");
            await settle(stopped);
            await settle(deployment);
            await delay(250);
            states.should.eql(["deploying", "stopping", "stopped"]);
        });
    });

    describe("AC-8: partial deployments (nodes, flows, PUT /flow/B) in their stop step when runtime.stop() is called", function() {
        // [name, how the deployment is made]
        const variants = [
            ["nodes", () => deploy("nodes", 2)],
            ["flows", () => deploy("flows", 2)],
            ["PUT /flow/B", () => {
                const promise = apiFlows.updateFlow({ id: "B", flow: { label: "B", nodes: [{ id: "b1", type: "test", v: 2, wires: [] }] }, req: {}, user: { username: "u" } });
                pending.push(promise.catch(() => {}));
                return promise;
            }]
        ];
        variants.forEach(function(variant) {
            it("AC-8: " + variant[0] + ": every node of A and B is closed exactly once when runtime.stop() resolves, getNode is null, nothing constructed after the stop", async function() {
                await boot();
                const base = world.constructed.length;
                world.closeGate.b1 = deferred();
                const deployment = variant[1]();
                await flush();
                world.closeCalls.b1.should.equal(1);
                const stopped = stopRuntime();
                await delay(50);
                world.closeGate.b1.resolve();
                (await settle(stopped)).state.should.equal("resolved");
                await settle(deployment);
                await delay(250);
                assertComplete({ base: base });
                (world.closeCalls.a1 || 0).should.equal(1);
            });
        });
    });

    describe("AC-9: the same with deploy.drainHttpNodeRequests on", function() {
        function enableDrain() {
            drainGate = deferred();
            const order = [];
            stubs.push(
                sinon.stub(httpDrain, "isEnabled").returns(true),
                sinon.stub(httpDrain, "beforeStop").callsFake(async function() { order.push("beforeStop"); await drainGate.promise }),
                sinon.stub(httpDrain, "afterStop").callsFake(function(scope) { order.push("afterStop:" + scope) }),
                // RED.stop ends the wait for the requests (the second stop in the state stopping)
                sinon.stub(httpDrain, "abortWait").callsFake(function() { drainGate.resolve() }),
                sinon.stub(httpDrain, "finalize").callsFake(function() { finalized.push(world.closed.length) })
            );
            return order;
        }
        ["full", "nodes"].forEach(function(type) {
            it("AC-9: " + type + " deployment waits for an open request (beforeStop), runtime.stop() is called: nothing new is constructed, all nodes closed once, finalize after the complete stop", async function() {
                await boot();
                const base = world.constructed.length;
                const order = enableDrain();
                world.closeGate.b1 = deferred();
                const deployment = deploy(type, 2);
                await flush();
                order.should.eql(["beforeStop"]);
                const stopped = stopRuntime();
                await delay(50);
                // the wait for the requests ended with RED.stop: the nodes of the deployment are closing
                world.closeGate.b1.resolve();
                (await settle(stopped)).state.should.equal("resolved");
                await settle(deployment);
                await delay(250);
                assertComplete({ base: base });
                // finalize answers what is still open; it runs after the last node was closed
                finalized.should.have.length(1);
                finalized[0].should.equal(2);
            });
        });
    });

    describe("AC-10: the result of a deployment that was past step 4 when the stop began", function() {
        let posts;
        beforeEach(function() {
            posts = [];
            hooks.add("postDeploy.t84", event => { posts.push(event) });
        });
        async function startedModeRace(extraDeploy) {
            await boot({ deploy: Object.assign({ response: "started" }, extraDeploy) });
            world.closeGate.b1 = deferred();
            const deployment = deploy("full", 2);
            const outcome = deployment.then(() => null, err => err);
            await flush();
            const stopped = stopRuntime();
            await delay(50);
            world.closeGate.b1.resolve();
            return { stopped: stopped, outcome: outcome };
        }
        [
            ["without startTimeout", undefined],
            ["with startTimeout that is not reached", { startTimeout: 5000 }]
        ].forEach(function(variant) {
            it("AC-10: deploy.response started, " + variant[0] + ": 500 deploy_start_failed with the revision and errors[0].code runtime_stopping; the configuration is saved; postDeploy once with start_failed", async function() {
                const race = await startedModeRace(variant[1]);
                (await settle(race.stopped)).state.should.equal("resolved");
                const err = (await settle(race.outcome)).value;
                should.exist(err, "the deployment was answered as a success");
                err.should.have.property("code", "deploy_start_failed");
                err.should.have.property("status", 500);
                err.should.have.property("rev").which.is.a.String();
                err.errors.should.have.length(1);
                err.errors[0].should.have.property("code", "runtime_stopping");
                err.errors[0].message.should.equal(SKIPPED);
                saved.should.have.length(1);
                flows.getFlows().rev.should.equal(err.rev);
                await delay(100);
                posts.should.have.length(1);
                posts[0].start.status.should.equal("start_failed");
                posts[0].start.errors.map(e => e.code).should.containEql("runtime_stopping");
                world.constructedNew().should.eql([]);
            });
        });
        it("AC-10 (N-2): default response, the stop began before the deployment returned its result: postDeploy start.status is not_started", async function() {
            await boot();
            world.closeGate.b1 = deferred();
            const deployment = deploy("full", 2);
            await flush();
            const stopped = stopRuntime();
            await delay(50);
            world.closeGate.b1.resolve();
            (await settle(deployment)).state.should.equal("resolved");
            await settle(stopped);
            await delay(100);
            posts.should.have.length(1);
            posts[0].start.status.should.equal("not_started");
        });
        it("AC-10 (N-2): default response, the stop began after the response while the start is held: start.status is pending", async function() {
            await boot();
            dependencyGate = deferred();
            const result = await deploy("full", 2);
            result.should.have.property("rev");
            // the start waits for its modules: the lock is held, the facts say that the start is pending
            const stopped = stopRuntime();
            (await settle(stopped)).state.should.equal("resolved");
            await delay(100);
            posts.should.have.length(1);
            posts[0].start.status.should.equal("pending");
        });
    });

    describe("AC-11 (V9, H5): a start waiting for its modules when runtime.stop() is called", function() {
        it("AC-11: a deployment: runtime.stop() resolves while the modules are pending; when they arrive no flow is created and flows:started is not emitted; the flows are stopped", async function() {
            await boot();
            dependencyGate = deferred();
            const base = world.created.length;
            await deploy("full", 2);
            await flush();
            seen.length = 0;
            const stopped = stopRuntime();
            // not waiting for a module install
            (await settle(stopped, 1000)).state.should.equal("resolved");
            dependencyGate.resolve();
            await delay(250);
            world.created.length.should.equal(base, "Flow.create was called after the stop");
            world.constructedNew().should.eql([]);
            seen.should.not.containEql("flows:started");
            seen.should.not.containEql("nodes-started");
            flows.started.should.be.false();
            flows.state().should.equal("stop");
        });
    });

    describe("AC-13 (V6, H4): storage.saveFlows pending when the stop begins", function() {
        it("AC-13: runtime.stop() resolves while the save is pending (the old flows are stopped); when the save ends no flow is created; the answer is 200 {rev}", async function() {
            await boot();
            const base = world.constructed.length;
            saveGate = deferred();
            const deployment = deploy("full", 2);
            await flush();
            saved.should.have.length(1);
            const stopped = stopRuntime();
            (await settle(stopped, 1000)).state.should.equal("resolved");
            world.liveIds().should.eql([]);
            saveGate.resolve();
            const result = await settle(deployment);
            result.state.should.equal("resolved");
            result.value.should.have.property("rev");
            await delay(250);
            world.constructed.length.should.equal(base);
            flows.started.should.be.false();
        });
        it("AC-13: deploy.response started: when the save ends the answer is 500 deploy_start_failed with runtime_stopping (saved, not started)", async function() {
            await boot({ deploy: { response: "started" } });
            saveGate = deferred();
            const deployment = deploy("full", 2);
            const outcome = deployment.then(() => null, err => err);
            await flush();
            const stopped = stopRuntime();
            (await settle(stopped, 1000)).state.should.equal("resolved");
            saveGate.resolve();
            const err = (await settle(outcome)).value;
            should.exist(err, "the deployment was answered as a success");
            err.should.have.property("code", "deploy_start_failed");
            err.should.have.property("status", 500);
            err.errors[0].should.have.property("code", "runtime_stopping");
            world.constructedNew().should.eql([]);
        });
        it("AC-13: the instance is stopping (the shutdown drain), the flows still run, the save ends: the old flows are stopped, nothing is started, the answer is 200", async function() {
            await boot();
            const base = world.constructed.length;
            saveGate = deferred();
            const deployment = deploy("full", 2);
            await flush();
            instanceState.markStopping("SIGTERM");
            saveGate.resolve();
            const result = await settle(deployment);
            result.state.should.equal("resolved");
            await delay(250);
            world.constructed.length.should.equal(base, "the flows were started in the state stopping");
            seen.should.not.containEql("flows:started");
            flows.started.should.be.false();
            infoCount(SKIPPED).should.equal(1);
        });
    });

    describe("AC-19 (V7, drain off): runtime.stop() waits for the stop of the deployment", function() {
        it("AC-19: it resolves only after the close completed and closeContextsPlugin is called after it", async function() {
            await boot();
            world.closeGate.b1 = deferred();
            const deployment = deploy("full", 2);
            await flush();
            const stopped = stopRuntime();
            // the close of b1 is not complete: runtime.stop() does not resolve
            (await settle(stopped, 150)).state.should.equal("timeout", "runtime.stop() resolved before the close of a node completed");
            contexts.should.eql([]);
            world.closeGate.b1.resolve();
            (await settle(stopped)).state.should.equal("resolved");
            // the contexts plugin is closed after the nodes were closed (a1 and b1)
            contexts.should.eql([2]);
            await settle(deployment);
        });
    });

    describe("AC-20 (H1, E9): more than one stop during the race", function() {
        it("AC-20: two concurrent runtime.stop() calls: both settle without rejection, each node is closed once, no flow is left, nothing new is constructed", async function() {
            await boot();
            const base = world.constructed.length;
            world.closeGate.b1 = deferred();
            const deployment = deploy("full", 2);
            await flush();
            const first = stopRuntime();
            const second = stopRuntime();
            await delay(50);
            world.closeGate.b1.resolve();
            (await settle(first)).state.should.equal("resolved");
            (await settle(second)).state.should.equal("resolved");
            await settle(deployment);
            await delay(250);
            assertComplete({ base: base });
        });
        it("AC-20: POST /flows/state stop overlapping runtime.stop(): both settle, runtime.stop() waits for the nodes that are closing, each node is closed once, no flow is left", async function() {
            await boot();
            world.closeGate.b1 = deferred();
            const state = apiFlows.setState({ state: "stop", req: {} });
            pending.push(state.catch(() => {}));
            await flush();
            world.closeCalls.b1.should.equal(1);
            const stopped = stopRuntime();
            (await settle(stopped, 150)).state.should.equal("timeout", "runtime.stop() did not wait for the stop in progress");
            world.closeGate.b1.resolve();
            (await settle(stopped)).state.should.equal("resolved");
            (await settle(state)).state.should.equal("resolved");
            world.closedTwice().should.eql([]);
            world.liveIds().should.eql([]);
            flows.started.should.be.false();
        });
    });

    describe("AC-21 (H10): the stop of the deployment fails during the race", function() {
        it("AC-21: deploy.response started, a node close fails: the deployment answers 500 deploy_stop_failed as today; runtime.stop() still stops the remaining flows and resolves", async function() {
            await boot({ deploy: { response: "started" } });
            world.closeGate.b1 = deferred();
            world.closeFail.b1 = new Error("close failed");
            const deployment = deploy("nodes", 2);
            const outcome = deployment.then(() => null, err => err);
            await flush();
            world.closeCalls.b1.should.equal(1);
            const stopped = stopRuntime();
            await delay(50);
            world.closeGate.b1.resolve();
            const err = (await settle(outcome)).value;
            should.exist(err);
            err.should.have.property("code", "deploy_stop_failed");
            err.should.have.property("status", 500);
            // the error of the waited stop is not adopted by runtime.stop()
            (await settle(stopped)).state.should.equal("resolved");
            (world.closeCalls.a1 || 0).should.equal(1, "the remaining flow was not stopped");
            world.closedTwice().should.eql([]);
            world.liveIds().should.eql([]);
            flows.started.should.be.false();
            await delay(150);
            world.constructedNew().should.eql([]);
        });
    });

    describe("AC-5: deployments queued behind a start that holds the lock", function() {
        it("AC-5: when the instance stops both waiting deployments are refused in order, the first one's start is skipped, only the first is saved", async function() {
            await boot();
            const base = world.created.length;
            dependencyGate = deferred();
            // the first deployment returns; its start waits for the modules and holds the lock
            const first = await deploy("full", 2);
            first.should.have.property("rev");
            const order = [];
            const second = deploy("full", 3).then(() => order.push("second:ok"), err => order.push("second:" + err.code));
            const third = deploy("full", 4).then(() => order.push("third:ok"), err => order.push("third:" + err.code));
            await delay(30);
            order.should.eql([]);
            const stopped = stopRuntime();
            (await settle(stopped)).state.should.equal("resolved");
            dependencyGate.resolve();
            await Promise.all([settle(second), settle(third)]);
            order.should.eql(["second:runtime_stopping", "third:runtime_stopping"]);
            saved.should.have.length(1);
            await delay(150);
            world.created.length.should.equal(base);
            world.constructedNew().should.eql([]);
            flows.started.should.be.false();
        });
    });

    describe("AC-3 (E7, E19, V12): the runtime api after runtime.stop() resolved", function() {
        it("AC-3: setFlows, addFlow, updateFlow, deleteFlow reject runtime_stopping 503 (with and without req); nothing is saved or created", async function() {
            await boot();
            await stopRuntime();
            instanceState.get().state.should.equal("stopped");
            const created = world.created.length;
            const calls = [
                () => apiFlows.setFlows({ flows: { flows: config(2) }, deploymentType: "full" }),
                () => apiFlows.setFlows({ flows: { flows: config(2) }, deploymentType: "full", req: {} }),
                () => apiFlows.setFlows({ deploymentType: "reload" }),
                () => apiFlows.addFlow({ flow: { label: "x", nodes: [] } }),
                () => apiFlows.updateFlow({ id: "B", flow: { nodes: [] }, req: {} }),
                () => apiFlows.deleteFlow({ id: "B" })
            ];
            for (const call of calls) {
                const outcome = await settle(call());
                outcome.state.should.equal("rejected", "the call was accepted after the stop");
                outcome.err.should.have.property("code", "runtime_stopping");
                outcome.err.should.have.property("status", 503);
            }
            saved.should.have.length(0);
            world.created.length.should.equal(created);
            flows.started.should.be.false();
        });
        it("AC-1/AC-3: in the state stopping (the shutdown drain, the flows still run) a deployment is refused and the flows keep running", async function() {
            await boot();
            instanceState.markStopping("SIGTERM");
            const outcome = await settle(deploy("full", 2));
            outcome.state.should.equal("rejected");
            outcome.err.should.have.property("code", "runtime_stopping");
            outcome.err.should.have.property("status", 503);
            saved.should.have.length(0);
            flows.started.should.be.true();
            existing().should.eql(["a1", "b1"]);
            world.closeCalls.should.eql({});
            mockLog.warn.called.should.be.false();
        });
        it("AC-1 (V16): an editor-only instance refuses a deployment in stopping too", async function() {
            await boot({ editorOnly: true });
            instanceState.markStopping("SIGTERM");
            const outcome = await settle(deploy("full", 2));
            outcome.state.should.equal("rejected");
            outcome.err.should.have.property("code", "runtime_stopping");
            saved.should.have.length(0);
        });
    });

    describe("AC-24 (H3): a node constructor that calls runtime.stop() during Flow.start", function() {
        it("AC-24: no deadlock, the start and the stop settle, no further flow is started, the flows are stopped", async function() {
            await boot();
            let stopped;
            world.onConstruct = function(def) {
                if (!stopped) {
                    // as a node would: the stop is not waited for inside the constructor
                    stopped = stopRuntime();
                }
            };
            const before = starts();
            await deploy("full", 2);
            await flush();
            for (let i = 0; i < 50 && !stopped; i++) {
                await delay(10);
            }
            should.exist(stopped, "the node was not constructed");
            (await settle(stopped, 2000)).state.should.equal("resolved");
            await delay(200);
            // the global flow, then flow A (whose node called the stop): flow B is not started
            world.starts.slice(before).should.eql(["global", "A"]);
            world.liveIds().should.eql([]);
            flows.started.should.be.false();
            flows.state().should.equal("stop");
        });
    });

    describe("AC-23 (V11, regression): runtime.stop() without a deployment in progress", function() {
        it("AC-23: emits flows:stopping, flows:stopped, runtime-state stop and nodes-stopped, logs Stopping flows / Stopped flows, closes each node once", async function() {
            await boot();
            await stopRuntime();
            seen.should.eql(["flows:stopping", "flows:stopped", "runtime-state:stop", "nodes-stopped"]);
            const logged = mockLog._.args.map(a => a[0]).filter(k => /^nodes\.flows\.(stopping|stopped)-flows$/.test(k));
            logged.should.eql(["nodes.flows.stopping-flows", "nodes.flows.stopped-flows"]);
            world.closedTwice().should.eql([]);
            world.liveIds().should.eql([]);
            states.should.eql(["stopping", "stopped"]);
        });
        it("AC-23: with no flows started it emits nothing and resolves", async function() {
            await boot({ safeMode: true });
            flows.started.should.be.true();
            await flows.stopFlows();
            seen.length = 0;
            await stopRuntime();
            seen.should.eql([]);
        });
    });

    describe("D7: the catalogue of the runtime", function() {
        const catalogue = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../../../packages/node_modules/@node-red/runtime/locales/en-US/runtime.json"), "utf8"));
        it("api.flows.runtime-stopping is the constant text of the refusal", function() {
            should.exist(catalogue.api.flows["runtime-stopping"]);
            catalogue.api.flows["runtime-stopping"].should.equal("The runtime is stopping: the change was not applied");
        });
        it("nodes.flows.start-skipped-stopping and nodes.flows.start-wait-timeout", function() {
            should.exist(catalogue.nodes.flows["start-skipped-stopping"]);
            catalogue.nodes.flows["start-skipped-stopping"].should.equal("The flows are not started: the runtime is stopping");
            should.exist(catalogue.nodes.flows["start-wait-timeout"]);
            catalogue.nodes.flows["start-wait-timeout"].should.equal("The stop did not wait longer for a flow that is starting: __flow__");
        });
    });
});
