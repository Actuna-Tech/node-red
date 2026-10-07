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
 *   #84 (phase B): new file - the stop of the runtime against the real Flow and Subflow classes (not the fakes of
 *   stop-race-world): a start that hangs in a node of a subflow, nodes created after the limit of the wait
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * The real flows module with the real Flow and Subflow and recorded test nodes. `flowUtil.createNode` is wrapped
 * so that the creation of a node can be held (the start of the flow then hangs inside Flow.start or Subflow.start).
 */
const should = require("should");
const sinon = require("sinon");
const util = require("util");
const NR_TEST_UTILS = require("nr-test-utils");
const { deferred, delay, flush, settle } = require("nr-test-utils/stop-race-world");

const flows = NR_TEST_UTILS.require("@node-red/runtime/lib/flows");
const flowUtil = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/util");
const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
const httpDrain = NR_TEST_UTILS.require("@node-red/runtime/lib/httpDrain");
const credentials = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/credentials");
const redNodes = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes");
const Node = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/Node");
const runtimeIndex = NR_TEST_UTILS.require("@node-red/runtime");
const typeRegistry = NR_TEST_UTILS.require("@node-red/registry");
const { events, hooks } = NR_TEST_UTILS.require("@node-red/util");

// flow A: a node a1 and an instance si of the subflow S (nodes s1, s2)
function config() {
    return [
        { id: "A", type: "tab", label: "A" },
        { id: "a1", type: "test", z: "A", x: 1, y: 1, wires: [] },
        { id: "S", type: "subflow", name: "S", info: "", in: [], out: [] },
        { id: "s1", type: "test", z: "S", x: 1, y: 1, wires: [] },
        { id: "s2", type: "test", z: "S", x: 1, y: 1, wires: [] },
        { id: "si", type: "subflow:S", z: "A", x: 1, y: 1, wires: [] },
        { id: "a2", type: "test", z: "A", x: 1, y: 1, wires: [] }
    ];
}

describe("flows: the stop of the runtime against the real Flow and Subflow (#84, phase B)", function() {
    let constructed;
    let closeDelay;
    let closed;
    let gates;
    let stubs;
    let unhandled;
    let mockLog;
    let settings;
    let pending;
    const onUnhandled = reason => { unhandled.push(reason) };

    function TestNode(n) {
        Node.call(this, n);
        const node = this;
        constructed.push(n.id);
        this.on("close", function(done) {
            if (closeDelay[node.id]) {
                setTimeout(function() { closed.push(node.id); done() }, closeDelay[node.id]);
            } else {
                closed.push(node.id);
                done();
            }
        });
    }
    util.inherits(TestNode, Node);

    before(function() {
        stubs = [
            sinon.stub(typeRegistry, "get").callsFake(type => type === "test" ? TestNode : undefined),
            sinon.stub(typeRegistry, "checkFlowDependencies").callsFake(async function() {})
        ];
        const original = flowUtil.createNode;
        stubs.push(sinon.stub(flowUtil, "createNode").callsFake(async function(flow, cfg) {
            const key = Object.keys(gates).find(k => cfg.id === k || String(cfg.id).endsWith("-" + k));
            if (key && gates[key]) {
                await gates[key].promise;
            }
            return original.apply(this, arguments);
        }));
    });
    after(function() {
        stubs.forEach(s => s.restore());
    });

    beforeEach(function() {
        constructed = [];
        closeDelay = {};
        closed = [];
        gates = {};
        unhandled = [];
        pending = [];
        process.on("unhandledRejection", onUnhandled);
        mockLog = {
            log: sinon.stub(), debug: sinon.stub(), trace: sinon.stub(), warn: sinon.stub(), info: sinon.stub(),
            error: sinon.stub(), metric: sinon.stub(), audit: sinon.stub(),
            _: sinon.spy(function(key, params) { return params ? key + " " + JSON.stringify(params) : key })
        };
        stubs.push(
            sinon.stub(credentials, "clean").callsFake(conf => { conf.forEach(n => { delete n.credentials }); return Promise.resolve() }),
            sinon.stub(credentials, "load").callsFake(() => Promise.resolve()),
            sinon.stub(credentials, "add").callsFake(async () => {}),
            sinon.stub(redNodes, "closeContextsPlugin").callsFake(async function() {})
        );
    });

    afterEach(async function() {
        Object.keys(gates).forEach(k => gates[k] && gates[k].resolve());
        await delay(30);
        gates = {};
        stubs.splice(3).forEach(s => s.restore());
        try {
            await flows.stopFlows("full");
        } finally {
            httpDrain.dispose();
            instanceState.reset();
            hooks.clear();
            process.removeListener("unhandledRejection", onUnhandled);
        }
    });

    async function boot(extraSettings) {
        settings = Object.assign({ deploy: {}, runtimeState: { enabled: true, ui: false } }, extraSettings);
        const storage = {
            getFlows: async () => ({ flows: JSON.parse(JSON.stringify(config())), rev: "rev1" }),
            saveFlows: async () => "rev2"
        };
        const runtime = { log: mockLog, settings: settings, storage: storage, flows: flows, hooks: hooks, events: events };
        instanceState.reset();
        instanceState.markStarting();
        flows.init(runtime);
        await flows.load();
    }
    function stopRuntime() {
        const promise = runtimeIndex.stop();
        pending.push(promise.catch(() => {}));
        return promise;
    }
    async function until(condition, ms) {
        const limit = Date.now() + (ms || 2000);
        while (!condition() && Date.now() < limit) {
            await delay(10);
        }
        condition().should.be.true("the condition was not reached");
    }
    function warnings() {
        return mockLog.warn.args.filter(a => /nodes\.flows\.start-wait-timeout/.test(a[0]));
    }
    // every node that was constructed was closed, and exactly once
    function assertAllClosedOnce() {
        constructed.slice().sort().should.eql(closed.slice().sort(), "constructed and closed nodes differ");
    }
    async function assertNoUnhandled() {
        await flush();
        await delay(20);
        unhandled.map(e => (e && e.message) || String(e)).should.eql([], "a promise was rejected without a handler");
    }

    it("B-13: harness - the start of the flows with a subflow creates the nodes of the flow and of the subflow; runtime.stop() closes each of them once", async function() {
        await boot();
        await flows.startFlows();
        constructed.length.should.equal(4, "the subflow was not started: " + JSON.stringify(constructed));
        (await settle(stopRuntime())).state.should.equal("resolved");
        assertAllClosedOnce();
        await assertNoUnhandled();
    });

    ["s2", "a2"].forEach(function(held) {
        it("B-13: the start hangs at the node " + held + " (" + (held === "s2" ? "inside the subflow" : "after the subflow") + "): runtime.stop() resolves after the bound; when the start ends every node it created is closed exactly once, the subflow too", async function() {
            await boot({ nodeCloseTimeout: 200 });
            gates[held] = deferred();
            const starting = flows.startFlows();
            pending.push(starting.catch(() => {}));
            await until(() => constructed.length > 0 && (held === "a2" ? constructed.some(id => /-s2$/.test(id)) : constructed.some(id => /-s1$/.test(id))));
            const began = Date.now();
            (await settle(stopRuntime(), 3000)).state.should.equal("resolved");
            (Date.now() - began).should.be.aboveOrEqual(190);
            warnings().should.have.length(1);
            gates[held].resolve();
            (await settle(starting, 3000)).state.should.equal("resolved");
            await delay(150);
            assertAllClosedOnce();
            constructed.should.containEql("a1");
            flows.started.should.be.false();
            flows.state().should.equal("stop");
            await assertNoUnhandled();
        });
    });

    it("B-13: the start ends while runtime.stop() is closing a slow node of the same flow: the node it creates meanwhile is closed, no node is closed twice, runtime.stop() resolves", async function() {
        await boot({ nodeCloseTimeout: 2000 });
        // a1 is created first and closes slowly; the start hangs at a2
        closeDelay.a1 = 300;
        gates.a2 = deferred();
        const starting = flows.startFlows();
        pending.push(starting.catch(() => {}));
        await until(() => constructed.some(id => /-s2$/.test(id)));
        // stop: the bound is the nodeCloseTimeout of the setting: use a short one through the default of the module
        settings.nodeCloseTimeout = 100;
        const stopped = stopRuntime();
        // the bound passes (100 ms): the stop of the flow A is closing a1 (300 ms); the start ends now
        await delay(150);
        gates.a2.resolve();
        (await settle(stopped, 3000)).state.should.equal("resolved");
        (await settle(starting, 3000)).state.should.equal("resolved");
        await delay(400);
        assertAllClosedOnce();
        constructed.filter(id => id === "a2").should.have.length(1);
        flows.started.should.be.false();
        await assertNoUnhandled();
    });
});
