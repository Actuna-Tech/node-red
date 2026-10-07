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
 *   #84 (phase B): new file - tries to break the fix of the race between a deployment, a start and the stop of the
 *   runtime: two stops, the chained stop of a deployment, a start that never ends, an orphan flow whose stop fails,
 *   two starts slower than the bound, the stop by the state api, a project switch and a reload during the shutdown
 *   grace, idempotency of the stop, unhandled rejections and timers left after the stop
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * Same world as stop-race_spec.js (the real flows module, pipeline, api, instance state, lock and runtime.stop() with
 * the fake flows of nr-test-utils/stop-race-world), with inputs the spec did not list. Every test also fails when a
 * promise is rejected without a handler while it runs (process "unhandledRejection").
 */
const should = require("should");
const sinon = require("sinon");
const clone = require("clone");
const NR_TEST_UTILS = require("nr-test-utils");
const { createWorld, deferred, flush, quiesce, until, fakeClock, settle, SUITE_TIMEOUT } = require("nr-test-utils/stop-race-world");

const flows = NR_TEST_UTILS.require("@node-red/runtime/lib/flows");
const apiFlows = NR_TEST_UTILS.require("@node-red/runtime/lib/api/flows");
const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
const httpDrain = NR_TEST_UTILS.require("@node-red/runtime/lib/httpDrain");
const context = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/context");
const credentials = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/credentials");
const redNodes = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes");
const runtimeIndex = NR_TEST_UTILS.require("@node-red/runtime");
const typeRegistry = NR_TEST_UTILS.require("@node-red/registry");
const Flow = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/Flow");
const { events, hooks } = NR_TEST_UTILS.require("@node-red/util");

const SKIPPED = "nodes.flows.start-skipped-stopping";

function config(v) {
    return [
        { id: "A", type: "tab", label: "A" },
        { id: "a1", type: "test", z: "A", wires: [], v: 1 },
        { id: "B", type: "tab", label: "B" },
        { id: "b1", type: "test", z: "B", wires: [], v: v || 1 }
    ];
}

describe("flows: breaking the fix of the race between a deployment and the stop of the runtime (#84, phase B)", function() {
    // the limit of a hang, not of the speed of the machine: nothing in this suite waits for a stretch of time
    this.timeout(SUITE_TIMEOUT);
    let world;
    let storage;
    let saved;
    let saveGate;
    let rev;
    let mockLog;
    let settings;
    let stubs;
    let seen;
    let states;
    let contexts;
    let finalized;
    let pending;
    let offState;
    let unhandled;
    let timers;
    // a fake clock for the production timers (the tests whose result depends on a time bound); restored after every test
    let clock = null;
    const listeners = [];
    const onUnhandled = reason => { unhandled.push(reason) };

    function listen(name, fn) {
        events.on(name, fn);
        listeners.push([name, fn]);
    }

    before(function() {
        stubs = [
            sinon.stub(typeRegistry, "get").callsFake(type => type.indexOf("missing") === -1),
            sinon.stub(typeRegistry, "checkFlowDependencies").callsFake(async function() {})
        ];
    });
    after(function() {
        stubs.forEach(s => s.restore());
    });

    function infoCount(key) {
        return mockLog.info.args.filter(a => a[0] === key).length;
    }
    function warnings() {
        return mockLog.warn.args.filter(a => /nodes\.flows\.start-wait-timeout/.test(a[0]));
    }
    // the flow names of the warnings: the catalogue is a spy that prints the key and the parameters
    function warnedFlows() {
        return warnings().map(a => JSON.parse(a[0].replace("nodes.flows.start-wait-timeout ", "")).flow);
    }

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
        const runtime = { log: mockLog, settings: settings, storage: storage, flows: flows, hooks: hooks, events: events };
        instanceState.reset();
        instanceState.markStarting();
        if (offState) {
            offState();
        }
        offState = instanceState.onChange(info => states.push(info.state));
        flows.init(runtime);
        apiFlows.init(runtime);
        await flows.load();
        if (!options.noStart) {
            await flows.startFlows();
        }
        await flush();
        seen.length = 0;
        states.length = 0;
    }

    let credentialStubs = [];
    beforeEach(function() {
        world = createWorld(Flow, sinon);
        seen = [];
        states = [];
        contexts = [];
        finalized = [];
        pending = [];
        unhandled = [];
        timers = null;
        process.on("unhandledRejection", onUnhandled);
        hooks.clear();
        credentialStubs = [
            sinon.stub(credentials, "clean").callsFake(conf => { conf.forEach(n => { delete n.credentials }); return Promise.resolve() }),
            sinon.stub(credentials, "load").callsFake(() => Promise.resolve()),
            sinon.stub(credentials, "add").callsFake(async () => {})
        ];
        ["flows:starting", "flows:started", "flows:stopping", "flows:stopped", "nodes-started", "nodes-stopped"].forEach(name => {
            listen(name, () => seen.push(name));
        });
        listen("runtime-event", function(event) {
            if (event && event.id === "runtime-state") {
                seen.push("runtime-state:" + (event.payload && event.payload.state));
            }
        });
        stubs.push(sinon.stub(redNodes, "closeContextsPlugin").callsFake(async function() {
            contexts.push(world.closed.length);
        }));
    });

    afterEach(async function() {
        if (timers) {
            timers.restore();
            timers = null;
        }
        if (clock) {
            clock.restore();
            clock = null;
        }
        world.releaseAll();
        await quiesce();
        world.closeFail = {};
        world.closeGate = {};
        if (offState) {
            offState();
            offState = null;
        }
        listeners.splice(0).forEach(l => events.removeListener(l[0], l[1]));
        instanceState.reset();
        saveGate = null;
        stubs.splice(2).forEach(s => s.restore());
        settings.deploy = {};
        settings.editorOnly = false;
        delete settings.nodeCloseTimeout;
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
            process.removeListener("unhandledRejection", onUnhandled);
        }
    });

    function stopRuntime(reason) {
        const promise = runtimeIndex.stop(reason);
        pending.push(promise.catch(() => {}));
        return promise;
    }
    function deploy(type, v, extra) {
        const promise = apiFlows.setFlows(Object.assign({ flows: { flows: config(v === undefined ? 2 : v) }, deploymentType: type, req: {}, user: { username: "u" } }, extra));
        pending.push(promise.catch(() => {}));
        return promise;
    }
    function starts() {
        return world.starts.length;
    }
    function existing() {
        return ["a1", "b1"].filter(id => flows.get(id));
    }
    // the real drain (deploy.drainHttpNodeRequests), finalize() recorded with the number of the closed nodes
    function enableRealDrain(timeout) {
        httpDrain.init({ deploy: { drainHttpNodeRequests: { enabled: true, timeout: timeout || 1000 } } });
        httpDrain.isEnabled().should.be.true();
        const original = httpDrain.finalize;
        stubs.push(sinon.stub(httpDrain, "finalize").callsFake(function() {
            finalized.push(world.closed.length);
            return original.apply(httpDrain, arguments);
        }));
    }
    // every node that was constructed was closed, and each one exactly once (a request per instance)
    function assertNoOrphans() {
        world.flowObjects.forEach(fake => Object.keys(fake.nodes).should.eql([], "flow " + fake.id + " keeps nodes"));
        world.closed.length.should.equal(world.constructed.length, "constructed and closed nodes differ");
        world.constructed.forEach(n => {
            const instances = world.constructed.filter(m => m.id === n.id).length;
            (world.closeCalls[n.id] || 0).should.equal(instances, n.id + " was not closed exactly once per instance");
        });
    }
    // nothing is running, nothing was constructed after `base`, each node of the first generation closed once
    function assertComplete(base) {
        world.constructed.length.should.equal(base, "a node was constructed after the stop");
        world.closedTwice().should.eql([]);
        ["a1", "b1"].forEach(id => (world.closeCalls[id] || 0).should.equal(1, id + " was not closed exactly once"));
        existing().should.eql([]);
        world.liveIds().should.eql([], "a flow was left running");
        flows.started.should.be.false();
        flows.state().should.equal("stop");
    }
    // the timers that production code created during the test and that are neither fired nor cleared nor unref-ed
    function trackTimers() {
        const realSet = global.setTimeout;
        const realClear = global.clearTimeout;
        const live = new Set();
        global.setTimeout = function(fn, ms) {
            const entry = { ms: ms, stack: (new Error().stack || "").split("\n").slice(2, 5).map(s => s.trim()).join(" | ") };
            const args = Array.prototype.slice.call(arguments, 2);
            const timer = realSet.call(global, function() {
                live.delete(entry);
                return fn.apply(this, arguments);
            }, ms, ...args);
            entry.timer = timer;
            live.add(entry);
            return timer;
        };
        global.clearTimeout = function(timer) {
            live.forEach(entry => { if (entry.timer === timer) { live.delete(entry) } });
            return realClear.call(global, timer);
        };
        timers = {
            left: () => Array.from(live).filter(e => !(e.timer && typeof e.timer.hasRef === "function" && !e.timer.hasRef())),
            restore: () => { global.setTimeout = realSet; global.clearTimeout = realClear }
        };
        return timers;
    }
    async function assertNoUnhandled() {
        await quiesce();
        unhandled.map(e => (e && e.message) || String(e)).should.eql([], "a promise was rejected without a handler");
    }
    function check(name, fn) {
        it(name, async function() {
            await fn.call(this);
            await assertNoUnhandled();
        });
    }

    // a start of the first flow A that never ends (until the test releases it); nodeCloseTimeout is `bound`
    async function hungStart(bound, hangOn) {
        await boot({ nodeCloseTimeout: bound }, { noStart: true });
        world.startHangs[hangOn || "A"] = true;
        const starting = flows.startFlows();
        pending.push(starting.catch(() => {}));
        await until(() => world.starts.indexOf(hangOn || "A") !== -1);
        // wrapped: a promise that is returned from an async function is waited for
        return { starting: starting };
    }

    [["drain off", false], ["drain on", true]].forEach(function(mode) {
        describe("two runtime.stop() calls racing a scoped deployment (" + mode[0] + ")", function() {
            ["nodes", "flows"].forEach(function(type) {
                check("B-1: " + type + " deployment in its scoped stop step, two concurrent runtime.stop(): both settle, each node closed once, nothing constructed, contexts and finalize after all closes", async function() {
                    await boot();
                    if (mode[1]) {
                        enableRealDrain();
                    }
                    const base = world.constructed.length;
                    world.closeGate.b1 = deferred();
                    const deployment = deploy(type, 2);
                    await flush();
                    world.closeCalls.b1.should.equal(1);
                    const first = stopRuntime();
                    const second = stopRuntime();
                    (await settle(first, 120)).state.should.equal("timeout", "runtime.stop() did not wait for the close in progress");
                    (await settle(second, 50)).state.should.equal("timeout");
                    world.closeGate.b1.resolve();
                    (await settle(first)).state.should.equal("resolved");
                    (await settle(second)).state.should.equal("resolved");
                    (await settle(deployment)).state.should.equal("resolved");
                    await quiesce();
                    assertComplete(base);
                    contexts.length.should.equal(2);
                    contexts.forEach(n => n.should.equal(2, "closeContexts ran before all nodes were closed"));
                    if (mode[1]) {
                        finalized.length.should.equal(2);
                        finalized.forEach(n => n.should.equal(2, "finalize ran before all nodes were closed"));
                    }
                    infoCount(SKIPPED).should.equal(1);
                });
            });
        });
    });

    describe("C2: the chained scoped stop of a deployment racing two stops (drain off)", function() {
        check("B-2: a second deployment is refused (503, nothing saved) while the first deployment's stop is chained behind RED.stop; two RED.stop settle; each node closed once", async function() {
            await boot();
            const base = world.constructed.length;
            const cleans = [];
            stubs.push(sinon.stub(context, "clean").callsFake(async function() { cleans.push(world.closed.length) }));
            const gate = deferred();
            storage.getFlows = async () => {
                await gate.promise;
                return { flows: clone(config(2)), rev: "rev-load" };
            };
            const loading = flows.load(true);
            pending.push(loading.catch(() => {}));
            await flush();
            world.closeGate.b1 = deferred();
            instanceState.markStopping("SIGTERM");
            const first = stopRuntime();
            await until(() => world.closeCalls.b1 === 1);
            gate.resolve();
            (await settle(loading, 150)).state.should.equal("timeout", "the chained stop ran while a node was closing");
            // the second deployment comes while the first one is chained
            const savedBefore = saved.length;
            const revBefore = flows.getFlows().rev;
            const refused = await settle(deploy("full", 3));
            refused.state.should.equal("rejected");
            refused.err.should.have.property("code", "runtime_stopping");
            refused.err.should.have.property("status", 503);
            saved.length.should.equal(savedBefore);
            const second = stopRuntime();
            world.closeGate.b1.resolve();
            (await settle(loading)).state.should.equal("resolved");
            (await settle(first)).state.should.equal("resolved");
            (await settle(second)).state.should.equal("resolved");
            await quiesce();
            flows.getFlows().rev.should.not.equal(undefined);
            revBefore.should.not.equal(undefined);
            assertComplete(base);
            cleans.forEach(n => n.should.equal(2, "context.clean ran while a node was closing"));
            contexts.length.should.equal(2);
            contexts.forEach(n => n.should.equal(2, "closeContexts ran before all nodes were closed"));
            world.constructedNew().should.eql([]);
        });
        check("B-2: the chained stop with three concurrent RED.stop and a node whose close fails: all settle, nobody rejects, each node closed once", async function() {
            await boot();
            const gate = deferred();
            storage.getFlows = async () => {
                await gate.promise;
                return { flows: clone(config(2)), rev: "rev-load" };
            };
            const loading = flows.load(true);
            pending.push(loading.catch(() => {}));
            await flush();
            world.closeGate.b1 = deferred();
            world.closeFail.b1 = new Error("close failed");
            instanceState.markStopping("SIGTERM");
            const stops = [stopRuntime(), stopRuntime()];
            await until(() => world.closeCalls.b1 === 1);
            gate.resolve();
            stops.push(stopRuntime());
            world.closeGate.b1.resolve();
            const outcomes = await Promise.all(stops.map(s => settle(s)));
            // a close error is reported as today by the stop that runs the close; the others are not hung
            outcomes.forEach(o => o.state.should.not.equal("timeout"));
            (await settle(loading)).state.should.not.equal("timeout");
            world.closedTwice().should.eql([]);
            world.liveIds().should.eql([]);
            flows.started.should.be.false();
        });
    });

    describe("a start that never ends: runtime.stop() is bounded", function() {
        check("B-3: with the flow A start hanging: the first stop resolves after the bound, a second and a third (also concurrent) at once and without a second warning; the state sequence is stopping, stopped", async function() {
            const starting = (await hungStart(150)).starting;
            // the bound (nodeCloseTimeout 150) is the fake clock
            clock = fakeClock(sinon);
            const first = stopRuntime();
            const concurrent = stopRuntime();
            let resolved = 0;
            [first, concurrent].forEach(st => st.then(() => { resolved++ }, () => { resolved++ }));
            await quiesce();
            clock.tick(149);
            await quiesce();
            resolved.should.equal(0, "runtime.stop() did not wait for the bound");
            clock.tick(1);
            (await settle(first)).state.should.equal("resolved");
            (await settle(concurrent)).state.should.equal("resolved");
            warnings().should.have.length(1);
            // a stop after the bound does not wait again: the clock is not moved any more, it resolves at once
            (await settle(stopRuntime())).state.should.equal("resolved", "a stop after the bound waited again");
            warnings().should.have.length(1, "the second stop warned again");
            clock.restore();
            clock = null;
            states.should.eql(["stopping", "stopped"]);
            flows.started.should.be.false();
            flows.state().should.equal("stop");
            world.liveIds().should.eql([]);
            // the embedder starts again after the stop: nothing happens
            const before = starts();
            (await settle(flows.startFlows())).state.should.equal("resolved");
            starts().should.equal(before);
            world.releaseAll();
            await settle(starting);
            await quiesce();
            assertNoOrphans();
            // the late end of the start does not change the instance state or the flows state
            states.should.eql(["stopping", "stopped"]);
            instanceState.get().state.should.equal("stopped");
            flows.started.should.be.false();
            flows.state().should.equal("stop");
            seen.should.not.containEql("flows:started");
        });
        check("B-3: the hanging start is the global flow (the first one): the stop is bounded, the late nodes are closed", async function() {
            const starting = (await hungStart(120, "global")).starting;
            const stopped = stopRuntime();
            (await settle(stopped)).state.should.equal("resolved");
            warnings().should.have.length(1);
            warnedFlows().should.eql(["global"]);
            world.releaseAll();
            await settle(starting);
            await quiesce();
            world.starts.should.eql(["global"], "a flow was started after the bound");
            assertNoOrphans();
        });
        check("B-3: a deployment whose start never ends, response started with startTimeout: the stop is bounded and resolves; the deployment is answered", async function() {
            await boot({ nodeCloseTimeout: 150, deploy: { response: "started", startTimeout: 5000 } });
            world.startHangs.A = true;
            const deployment = deploy("full", 2);
            const outcome = deployment.then(() => null, err => err);
            await until(() => world.starts.filter(id => id === "A").length === 2);
            const stopped = stopRuntime();
            (await settle(stopped)).state.should.equal("resolved");
            world.releaseAll();
            const err = (await settle(outcome)).value;
            // the start was skipped after the bound: saved, not started
            should.exist(err);
            err.should.have.property("code", "deploy_start_failed");
            err.errors.map(e => e.code).should.containEql("runtime_stopping");
            await quiesce();
            assertNoOrphans();
        });
    });

    describe("an orphan flow whose stop fails when its start ends", function() {
        // A: the first call of stop (the stop of the runtime) works, the second one (the orphan stop) is `second`
        async function orphan(second) {
            const starting = (await hungStart(120)).starting;
            const flowA = world.flowObjects.find(f => f.id === "A");
            const realStop = flowA.stop;
            let calls = 0;
            flowA.stop = function() {
                calls++;
                if (calls === 1) {
                    return realStop.apply(flowA, arguments);
                }
                return second();
            };
            const stopped = stopRuntime();
            (await settle(stopped)).state.should.equal("resolved");
            return { starting: starting, calls: () => calls };
        }
        check("B-4: the orphan stop rejects: runtime.stop() resolved; the start ends without rejecting; nothing unhandled", async function() {
            const o = await orphan(() => Promise.reject(new Error("orphan stop failed")));
            world.releaseAll();
            const outcome = await settle(o.starting);
            outcome.state.should.equal("resolved", "a rejection of the orphan stop was passed on");
            o.calls().should.equal(2);
            flows.started.should.be.false();
        });
        check("B-4: the orphan stop throws synchronously: the start ends without rejecting (rejections are swallowed); nothing unhandled", async function() {
            const o = await orphan(() => { throw new Error("orphan stop threw") });
            world.releaseAll();
            const outcome = await settle(o.starting);
            outcome.state.should.equal("resolved", "an exception of the orphan stop was passed on");
            o.calls().should.equal(2);
            flows.started.should.be.false();
        });
        check("B-4: the orphan stop never settles: the start itself is not released by it, but runtime.stop() and a second stop already resolved", async function() {
            const o = await orphan(() => new Promise(() => {}));
            world.releaseAll();
            (await settle(o.starting, 200)).state.should.equal("timeout");
            (await settle(stopRuntime())).state.should.equal("resolved");
            flows.started.should.be.false();
        });
    });

    describe("a start that ends at the bound of the wait", function() {
        [-30, -5, 0, 5, 30].forEach(function(offset) {
            check("B-5: the start ends " + offset + " ms from the bound: runtime.stop() resolves, at most one warning, every node closed exactly once, nothing left", async function() {
                const bound = 100;
                const starting = (await hungStart(bound)).starting;
                // the bound is the fake clock: the start is released `offset` ms from it, exactly
                clock = fakeClock(sinon);
                const stopped = stopRuntime();
                await quiesce();
                if (offset < 0) {
                    clock.tick(bound + offset);
                    world.releaseAll();
                    (await settle(stopped)).state.should.equal("resolved");
                    clock.tick(-offset);
                } else {
                    clock.tick(bound);
                    // the stop does not wait for the start longer than the bound
                    (await settle(stopped)).state.should.equal("resolved");
                    clock.tick(offset);
                    world.releaseAll();
                }
                (await settle(starting)).state.should.equal("resolved");
                await quiesce();
                warnings().should.have.length(offset < 0 ? 0 : 1);
                world.starts.should.eql(["global", "A"], "a further flow was started");
                assertNoOrphans();
                world.closedTwice().should.eql([]);
                world.liveIds().should.eql([]);
                flows.started.should.be.false();
                flows.state().should.equal("stop");
            });
        });
    });

    describe("R-45: two starts in Flow.start at the same time, both slower than the bound", function() {
        const BOUND = 300;
        check("B-6: one warning per flow (two flows, two warnings, not 2 x the bound), both flows stopped, the nodes both starts create afterwards are closed once", async function() {
            await boot({ nodeCloseTimeout: BOUND, deploy: { startTimeout: 100, startTimeoutReleasesLock: true } });
            const startsOf = id => world.starts.filter(x => x === id).length;
            const baseA = startsOf("A");
            const baseB = startsOf("B");
            const g1 = deferred();
            const g2 = deferred();
            // start 1 hangs in flow A; start 2 passes flow A and hangs in flow B
            world.startGates.A = g1;
            const first = await deploy("full", 2);
            first.should.have.property("rev");
            await until(() => startsOf("A") === baseA + 1);
            delete world.startGates.A;
            world.startGates.B = g2;
            const second = deploy("full", 3);
            await until(() => startsOf("B") === baseB + 1);
            // the bound (nodeCloseTimeout) is the fake clock: both starts are waited for at the same time
            clock = fakeClock(sinon);
            const stopped = stopRuntime();
            let resolved = false;
            stopped.then(() => { resolved = true }, () => { resolved = true });
            await quiesce();
            clock.tick(BOUND - 1);
            await quiesce();
            resolved.should.be.false("runtime.stop() did not wait for the bound");
            clock.tick(1);
            (await settle(stopped)).state.should.equal("resolved", "the waits for the two starts were added up");
            clock.restore();
            clock = null;
            warnedFlows().sort().should.eql(["A", "B"], "not one warning per flow");
            world.liveIds().should.eql([]);
            g1.resolve();
            g2.resolve();
            await settle(second);
            await quiesce();
            assertNoOrphans();
            world.liveIds().should.eql([]);
            flows.started.should.be.false();
            flows.state().should.equal("stop");
            warnings().should.have.length(2);
        });
    });

    [["drain off", false], ["drain on", true]].forEach(function(mode) {
        describe("POST /flows/state stop and runtime.stop() (" + mode[0] + ")", function() {
            check("B-7: the state api stops the flows first, runtime.stop() after it: nothing is closed twice, nothing is emitted twice", async function() {
                await boot();
                if (mode[1]) {
                    enableRealDrain();
                }
                const result = await apiFlows.setState({ state: "stop", req: {} });
                result.should.eql({ state: "stop" });
                seen.should.eql(["flows:stopping", "flows:stopped", "runtime-state:stop", "nodes-stopped"]);
                seen.length = 0;
                (await settle(stopRuntime())).state.should.equal("resolved");
                seen.should.eql([], "runtime.stop() stopped the flows that were stopped");
                world.closedTwice().should.eql([]);
                world.liveIds().should.eql([]);
                // the state api stop ended the operation with "idle"
                states.should.eql(["idle", "stopping", "stopped"]);
                // POST /flows/state stop after the stop: unchanged, 200
                (await apiFlows.getState({})).should.eql({ state: "stop" });
            });
            check("B-7: runtime.stop() first, then the state api stop and start: stop 200, start 503; nothing is closed twice", async function() {
                await boot();
                if (mode[1]) {
                    enableRealDrain();
                }
                await stopRuntime();
                const stoppedAgain = await settle(apiFlows.setState({ state: "stop", req: {} }));
                stoppedAgain.state.should.equal("resolved");
                const startAgain = await settle(apiFlows.setState({ state: "start", req: {} }));
                startAgain.state.should.equal("rejected");
                startAgain.err.should.have.property("code", "runtime_stopping");
                world.closedTwice().should.eql([]);
                world.liveIds().should.eql([]);
            });
            check("B-7: the state api stop, runtime.stop() and a deployment overlapping while a node closes: all settle, the deployment is refused, each node closed once", async function() {
                await boot();
                if (mode[1]) {
                    enableRealDrain();
                }
                world.closeGate.b1 = deferred();
                const state = apiFlows.setState({ state: "stop", req: {} });
                pending.push(state.catch(() => {}));
                await flush();
                const stopped = stopRuntime();
                const refused = await settle(deploy("full", 2));
                refused.state.should.equal("rejected");
                refused.err.should.have.property("code", "runtime_stopping");
                (await settle(stopped, 120)).state.should.equal("timeout");
                world.closeGate.b1.resolve();
                (await settle(stopped)).state.should.equal("resolved");
                (await settle(state)).state.should.equal("resolved");
                world.closedTwice().should.eql([]);
                world.liveIds().should.eql([]);
                saved.should.have.length(0);
            });
        });
    });

    [["drain off", false], ["drain on", true]].forEach(function(mode) {
        describe("a project switch during the shutdown grace (" + mode[0] + ")", function() {
            check("B-8: stopFlows then load(true): every node closed once, nothing constructed or started, the flows are stopped; runtime.stop() after it closes nothing twice", async function() {
                await boot();
                if (mode[1]) {
                    enableRealDrain();
                }
                const base = world.constructed.length;
                const startsBefore = starts();
                instanceState.markStopping("SIGTERM");
                // RT/lib/storage/localfilesystem/projects/index.js: stopFlows() then loadFlows(true)
                await flows.stopFlows();
                const loadedRev = await settle(flows.load(true));
                loadedRev.state.should.equal("resolved");
                loadedRev.value.should.be.a.String();
                await quiesce();
                world.constructed.length.should.equal(base);
                starts().should.equal(startsBefore);
                flows.started.should.be.false();
                existing().should.eql([]);
                (await settle(stopRuntime())).state.should.equal("resolved");
                assertComplete(base);
                states.should.eql(["stopping", "stopped"]);
            });
            check("B-8: the project switch racing runtime.stop() while a node closes: both settle, no flow is running afterwards, each node closed once", async function() {
                await boot();
                if (mode[1]) {
                    enableRealDrain();
                }
                const base = world.constructed.length;
                world.closeGate.b1 = deferred();
                instanceState.markStopping("SIGTERM");
                const switching = flows.stopFlows().then(() => flows.load(true));
                pending.push(switching.catch(() => {}));
                await until(() => world.closeCalls.b1 === 1);
                const stopped = stopRuntime();
                (await settle(stopped, 120)).state.should.equal("timeout");
                world.closeGate.b1.resolve();
                (await settle(stopped)).state.should.equal("resolved");
                (await settle(switching)).state.should.equal("resolved");
                await quiesce();
                assertComplete(base);
            });
        });
    });

    [["drain off", false], ["drain on", true]].forEach(function(mode) {
        describe("a reload with forceStart (load(true)) while the instance is stopping and the flows still run (" + mode[0] + ")", function() {
            check("B-8: it stops what runs and starts nothing: every node closed once, nothing constructed, the revision is returned; runtime.stop() after it closes nothing twice", async function() {
                await boot();
                if (mode[1]) {
                    enableRealDrain();
                }
                const base = world.constructed.length;
                const startsBefore = starts();
                instanceState.markStopping("SIGTERM");
                const loaded = await settle(flows.load(true));
                loaded.state.should.equal("resolved");
                await quiesce();
                world.constructed.length.should.equal(base);
                starts().should.equal(startsBefore);
                flows.started.should.be.false();
                (await settle(stopRuntime())).state.should.equal("resolved");
                assertComplete(base);
                states.should.eql(["stopping", "stopped"]);
                infoCount(SKIPPED).should.equal(1);
            });
        });
    });

    [["drain off", false], ["drain on", true]].forEach(function(mode) {
        describe("a diff reload that passed begin while the instance is stopping (" + mode[0] + ")", function() {
            check("B-9: reloadFromStorage diff: only the changed node is closed, the unchanged one still exists, nothing is constructed; runtime.stop() closes the rest once, contexts and finalize after", async function() {
                await boot();
                if (mode[1]) {
                    enableRealDrain();
                }
                const base = world.constructed.length;
                const startsBefore = starts();
                instanceState.markStopping("SIGTERM");
                const reloaded = await settle(flows.reloadFromStorage({ flows: clone(config(2)), rev: "rev-reload", credentials: {} }, { type: "diff" }));
                reloaded.state.should.equal("resolved");
                await quiesce();
                (world.closeCalls.b1 || 0).should.equal(1, "the changed node was not closed once");
                should(world.closeCalls.a1).equal(undefined, "the unchanged node was closed by the scoped stop of the reload");
                existing().should.eql(["a1"]);
                starts().should.equal(startsBefore);
                world.constructed.length.should.equal(base);
                (await settle(stopRuntime())).state.should.equal("resolved");
                assertComplete(base);
                contexts.should.eql([2]);
                if (mode[1]) {
                    finalized.should.eql([2]);
                }
            });
            check("B-9: reloadFromStorage full: everything is stopped, nothing is started, runtime.stop() resolves, each node closed once", async function() {
                await boot();
                if (mode[1]) {
                    enableRealDrain();
                }
                const base = world.constructed.length;
                instanceState.markStopping("SIGTERM");
                (await settle(flows.reloadFromStorage({ flows: clone(config(2)), rev: "rev-reload", credentials: {} }, { type: "full" }))).state.should.equal("resolved");
                await quiesce();
                world.constructed.length.should.equal(base);
                (await settle(stopRuntime())).state.should.equal("resolved");
                assertComplete(base);
            });
        });
    });

    [["drain off", false], ["drain on", true]].forEach(function(mode) {
        describe("idempotency of runtime.stop() (" + mode[0] + ")", function() {
            check("B-10: three sequential stops: the nodes are closed once, the flows events and the logs of the stop appear once, the states are stopping, stopped", async function() {
                await boot();
                if (mode[1]) {
                    enableRealDrain();
                }
                for (let i = 0; i < 3; i++) {
                    (await settle(stopRuntime())).state.should.equal("resolved");
                }
                seen.should.eql(["flows:stopping", "flows:stopped", "runtime-state:stop", "nodes-stopped"]);
                world.closedTwice().should.eql([]);
                world.liveIds().should.eql([]);
                states.should.eql(["stopping", "stopped"]);
                mockLog.info.args.filter(a => a[0] === "nodes.flows.stopping-flows").should.have.length(1);
                // the contexts plugin is closed by every stop, after the nodes
                contexts.forEach(n => n.should.equal(2));
            });
            check("B-10: three concurrent stops with a node that closes slowly: all resolve after the close, the nodes are closed once", async function() {
                await boot();
                if (mode[1]) {
                    enableRealDrain();
                }
                world.closeGate.b1 = deferred();
                const stops = [stopRuntime(), stopRuntime(), stopRuntime()];
                (await settle(stops[2], 100)).state.should.equal("timeout");
                world.closeGate.b1.resolve();
                for (const s of stops) {
                    (await settle(s)).state.should.equal("resolved");
                }
                seen.should.eql(["flows:stopping", "flows:stopped", "runtime-state:stop", "nodes-stopped"]);
                world.closedTwice().should.eql([]);
                contexts.forEach(n => n.should.equal(2));
                if (mode[1]) {
                    finalized.forEach(n => n.should.equal(2));
                }
                states.should.eql(["stopping", "stopped"]);
            });
        });
    });

    describe("more starts that hang, more ways to hang", function() {
        [["drain off", false], ["drain on", true]].forEach(function(mode) {
            check("B-14: a start that never ends (" + mode[0] + "): runtime.stop() is bounded; contexts and finalize after the closes; the late nodes are closed", async function() {
                await boot({ nodeCloseTimeout: 120 }, { noStart: true });
                if (mode[1]) {
                    enableRealDrain();
                }
                world.startHangs.A = true;
                const starting = flows.startFlows();
                pending.push(starting.catch(() => {}));
                await until(() => world.starts.indexOf("A") !== -1);
                // the bound (nodeCloseTimeout 120) is the fake clock
                clock = fakeClock(sinon);
                const first = stopRuntime();
                const second = stopRuntime();
                let resolved = 0;
                [first, second].forEach(st => st.then(() => { resolved++ }, () => { resolved++ }));
                await quiesce();
                clock.tick(119);
                await quiesce();
                resolved.should.equal(0, "runtime.stop() did not wait for the bound");
                clock.tick(1);
                (await settle(first)).state.should.equal("resolved");
                (await settle(second)).state.should.equal("resolved");
                clock.restore();
                clock = null;
                warnings().should.have.length(1);
                contexts.length.should.equal(2);
                if (mode[1]) {
                    finalized.length.should.equal(2);
                }
                world.releaseAll();
                await settle(starting);
                await quiesce();
                assertNoOrphans();
            });
        });

        check("B-14: the default bound is 15000 ms (nodeCloseTimeout not set): the stop does not resolve at 14999 ms and resolves at 15000 ms", async function() {
            const starting = (await hungStart(undefined)).starting;
            const clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            try {
                let resolved = false;
                const stopped = stopRuntime();
                stopped.then(() => { resolved = true });
                await flush(5);
                clock.tick(14999);
                await flush(5);
                resolved.should.be.false("runtime.stop() resolved before the default bound");
                clock.tick(1);
                await flush(10);
                resolved.should.be.true("runtime.stop() did not resolve at the default bound");
                warnings().should.have.length(1);
            } finally {
                clock.restore();
            }
            world.releaseAll();
            await settle(starting);
        });

        check("B-14: the shutdown grace: the start of a flow ends after the instance began to stop and before runtime.stop(): the flows it created are stopped by runtime.stop(), each node once", async function() {
            await boot({ nodeCloseTimeout: 5000 }, { noStart: true });
            const gate = deferred();
            world.startGates.A = gate;
            const starting = flows.startFlows();
            pending.push(starting.catch(() => {}));
            await until(() => world.starts.indexOf("A") !== -1);
            instanceState.markStopping("SIGTERM");
            gate.resolve();
            (await settle(starting)).state.should.equal("resolved");
            // flow B was not started: the start is skipped at its next step
            world.starts.should.eql(["global", "A"]);
            seen.should.not.containEql("flows:started");
            (await settle(stopRuntime())).state.should.equal("resolved");
            world.closedTwice().should.eql([]);
            world.liveIds().should.eql([], "a flow was left running");
            world.flowObjects.forEach(f => Object.keys(f.nodes).should.eql([], "flow " + f.id + " keeps nodes"));
            (world.closeCalls.a1 || 0).should.equal(1);
            flows.started.should.be.false();
            flows.state().should.equal("stop");
        });

        check("B-14: the logger throws when the wait for a starting flow reaches its bound: runtime.stop() still resolves", async function() {
            const starting = (await hungStart(100)).starting;
            mockLog.warn = sinon.spy(function() { throw new Error("the logger failed") });
            // the exception of the timer is expected: mocha must not take it for the failure of another test
            const saved = process.listeners("uncaughtException");
            process.removeAllListeners("uncaughtException");
            const caught = [];
            const handler = err => { caught.push(err) };
            process.on("uncaughtException", handler);
            try {
                const outcome = await settle(stopRuntime());
                outcome.state.should.equal("resolved", "runtime.stop() never resolved after the logger threw (the wait of the start was not ended)");
            } finally {
                world.releaseAll();
                await settle(starting);
                await quiesce();
                process.removeListener("uncaughtException", handler);
                saved.forEach(l => process.on("uncaughtException", l));
            }
            caught.length.should.equal(0, "an exception escaped from a timer of the runtime: " + caught.map(e => e.message).join(","));
        });
    });

    describe("two starts in the same flow", function() {
        check("B-15: R-45, a nodes deployment starts the flow A again while the first start waits in it: one warning for the flow A", async function() {
            const BOUND = 250;
            await boot({ nodeCloseTimeout: BOUND, deploy: { startTimeout: 100, startTimeoutReleasesLock: true } });
            const startsOfA = () => world.starts.filter(id => id === "A").length;
            const base = startsOfA();
            const gate = deferred();
            world.startGates.A = gate;
            const first = await deploy("full", 2);
            first.should.have.property("rev");
            await until(() => startsOfA() === base + 1);
            // the second deployment changes b1 only: it calls the start of the same flow object A
            const second = deploy("nodes", 3);
            await until(() => startsOfA() === base + 2);
            (await settle(stopRuntime())).state.should.equal("resolved");
            warnedFlows().should.eql(["A"], "more than one warning for the same flow");
            gate.resolve();
            await settle(second);
            await quiesce();
            assertNoOrphans();
            world.liveIds().should.eql([]);
        });
    });

    describe("timers of a deployment with response started and startTimeout, stopped during its stop step", function() {
        check("B-16: no timer of the runtime is running after runtime.stop() and the answer of the deployment", async function() {
            await boot({ deploy: { response: "started", startTimeout: 5000 } });
            trackTimers();
            world.closeGate.b1 = deferred();
            const deployment = deploy("full", 2);
            const outcome = deployment.then(() => null, err => err);
            await flush();
            const stopped = stopRuntime();
            await flush(10);
            world.closeGate.b1.resolve();
            (await settle(stopped)).state.should.equal("resolved");
            const err = (await settle(outcome)).value;
            should.exist(err);
            err.should.have.property("code", "deploy_start_failed");
            await flush(10);
            const left = timers.left().filter(e => /runtime\/lib\/(flows|index|state)/.test(e.stack));
            left.map(e => e.ms + "ms " + e.stack).should.eql([], "a timer is still running");
        });
    });

    describe("many callers", function() {
        check("B-17: fifty concurrent runtime.stop() calls with a start that never ends: all resolve after one bound, one warning, one set of events", async function() {
            const starting = (await hungStart(150)).starting;
            // the bound (nodeCloseTimeout 150) is the fake clock: all the callers wait for the same bound
            clock = fakeClock(sinon);
            const stops = [];
            for (let i = 0; i < 50; i++) {
                stops.push(stopRuntime());
            }
            let resolved = 0;
            stops.forEach(st => st.then(() => { resolved++ }, () => { resolved++ }));
            await quiesce();
            clock.tick(149);
            await quiesce();
            resolved.should.equal(0, "runtime.stop() did not wait for the bound");
            clock.tick(1);
            const outcomes = await Promise.all(stops.map(st => settle(st)));
            outcomes.forEach(o => o.state.should.equal("resolved"));
            clock.restore();
            clock = null;
            warnings().should.have.length(1);
            seen.filter(e => e === "flows:stopping").should.have.length(1);
            states.should.eql(["stopping", "stopped"]);
            world.releaseAll();
            await settle(starting);
            await quiesce();
            assertNoOrphans();
        });
        check("B-17: fifty concurrent runtime.stop() calls with a node that closes slowly: each node closed once, all resolve", async function() {
            await boot();
            world.closeGate.b1 = deferred();
            const stops = [];
            for (let i = 0; i < 50; i++) {
                stops.push(stopRuntime());
            }
            await flush(10);
            world.closeGate.b1.resolve();
            const outcomes = await Promise.all(stops.map(st => settle(st)));
            outcomes.forEach(o => o.state.should.equal("resolved"));
            world.closedTwice().should.eql([]);
            world.liveIds().should.eql([]);
            seen.filter(e => e === "flows:stopping").should.have.length(1);
        });
        check("B-17: callers that start the flows after the stop: each start is skipped with one info log, nothing is created, no event", async function() {
            await boot();
            await stopRuntime();
            seen.length = 0;
            const created = world.created.length;
            const results = [];
            for (let i = 0; i < 3; i++) {
                results.push(await flows.startFlows());
            }
            results.forEach(r => {
                r.should.have.property("reason", "stopping");
                r.should.have.property("flowsRunning", false);
                r.errors.map(e => e.code).should.eql(["runtime_stopping"]);
            });
            infoCount(SKIPPED).should.equal(3);
            world.created.length.should.equal(created);
            seen.should.eql([]);
            states.should.eql(["stopping", "stopped"]);
            flows.started.should.be.false();
        });
    });

    describe("timers: none left running after runtime.stop() resolves", function() {
        function noTimers(label) {
            const left = timers.left().filter(e => /runtime\/lib\/(flows|index|state)/.test(e.stack) || /waitForStartingFlow|stopAll/.test(e.stack));
            left.map(e => e.ms + "ms " + e.stack).should.eql([], label + ": a timer is still running");
        }
        check("B-11: a plain stop during a deployment's stop step", async function() {
            await boot();
            trackTimers();
            world.closeGate.b1 = deferred();
            const deployment = deploy("full", 2);
            await flush();
            const stopped = stopRuntime();
            await flush(10);
            world.closeGate.b1.resolve();
            (await settle(stopped)).state.should.equal("resolved");
            await settle(deployment);
            noTimers("plain");
        });
        check("B-11: a start that ends before the bound (the wait is cleared)", async function() {
            // the bound is far away: the start ends long before it, whatever the speed of the machine
            const starting = (await hungStart(600000)).starting;
            trackTimers();
            const stopped = stopRuntime();
            await flush(10);
            world.releaseAll();
            (await settle(stopped)).state.should.equal("resolved");
            await settle(starting);
            noTimers("released before the bound");
            warnings().should.have.length(0);
        });
        check("B-11: a start that is waited for until the bound (the wait fired)", async function() {
            const starting = (await hungStart(80)).starting;
            trackTimers();
            (await settle(stopRuntime())).state.should.equal("resolved");
            noTimers("bound reached");
            world.releaseAll();
            await settle(starting);
            noTimers("after the late start ended");
        });
        check("B-11: the drain is on", async function() {
            await boot();
            enableRealDrain();
            trackTimers();
            world.closeGate.b1 = deferred();
            const deployment = deploy("nodes", 2);
            await flush();
            const stopped = stopRuntime();
            await flush(10);
            world.closeGate.b1.resolve();
            (await settle(stopped)).state.should.equal("resolved");
            await settle(deployment);
            noTimers("drain on");
        });
    });

    describe("hostile deployments in stopping", function() {
        check("B-12: a body with a throwing getter, a toJSON that throws and a Proxy that throws is refused with 503 before it is read", async function() {
            await boot();
            instanceState.markStopping("SIGTERM");
            const hostile = [
                { get flows() { throw new Error("getter") } },
                { flows: { toJSON() { throw new Error("toJSON") } } },
                new Proxy({}, { get() { throw new Error("proxy") }, has() { throw new Error("proxy") }, ownKeys() { throw new Error("proxy") } })
            ];
            for (const body of hostile) {
                const outcome = await settle(apiFlows.setFlows({ flows: body, deploymentType: "full", req: {}, user: { username: "u" } }));
                outcome.state.should.equal("rejected");
                outcome.err.should.have.property("code", "runtime_stopping");
                outcome.err.should.have.property("status", 503);
            }
            saved.should.have.length(0);
            mockLog.warn.called.should.be.false();
        });
        check("B-12: a deployment type that does not exist, in stopping: refused as runtime_stopping", async function() {
            await boot();
            instanceState.markStopping("SIGTERM");
            const outcome = await settle(apiFlows.setFlows({ flows: { flows: config(2) }, deploymentType: "bogus", req: {} }));
            outcome.state.should.equal("rejected");
            outcome.err.should.have.property("code", "runtime_stopping");
        });
        check("B-12: a deployment racing the stop at every step of the save never starts a flow (saveFlows rejects after the stop)", async function() {
            await boot();
            const base = world.constructed.length;
            saveGate = deferred();
            const deployment = deploy("full", 2);
            const outcome = deployment.then(() => null, err => err);
            await flush();
            const stopped = stopRuntime();
            (await settle(stopped)).state.should.equal("resolved");
            // the save fails after the stop
            storage.saveFlows = async function() { throw new Error("disk full") };
            saveGate.reject(new Error("disk full"));
            const err = (await settle(outcome)).value;
            should.exist(err);
            await quiesce();
            world.constructed.length.should.equal(base);
            flows.started.should.be.false();
            existing().should.eql([]);
        });
    });
});
