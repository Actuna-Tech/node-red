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
 *   Z-10: tests of the coordination facade (RED.coordination)
 *   #75: tests of an error without text or that cannot be printed in the facade
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const EventEmitter = require("events");

const NR_TEST_UTILS = require("nr-test-utils");
const coordination = NR_TEST_UTILS.require("@node-red/runtime/lib/coordination");
const {events, log} = NR_TEST_UTILS.require("@node-red/util");
const {createCoordinator, createRuntime} = require("./mockCoordinator");
const values = require("../printableValues");

describe("runtime/coordination", function() {
    let facade;
    beforeEach(function() {
        sinon.stub(log, "info");
        sinon.stub(log, "warn");
        sinon.stub(log, "error");
        sinon.stub(log, "_").callsFake(function(key, opts) { return key + (opts ? " " + JSON.stringify(opts) : "") });
        facade = coordination.createCoordination();
    });
    afterEach(async function() {
        await facade.stop();
        sinon.restore();
    });

    function makeNode(id) {
        const node = new EventEmitter();
        node.id = id || "n1";
        return node;
    }

    describe("plugin selection", function() {
        it("uses local plugin by default", async function() {
            await facade.start(createRuntime({}, []));
            facade.info().should.eql({plugin: "local", local: true});
            facade.isLeader().should.be.true();
            log.info.calledWithMatch("coordination.using").should.be.true();
            log.warn.called.should.be.false();
        });

        it("uses local plugin when coordination has no plugin", async function() {
            await facade.start(createRuntime({coordination: {options: {a: 1}}}, []));
            facade.info().should.eql({plugin: "local", local: true});
        });

        it("selects plugin by settings.coordination.plugin", async function() {
            const coordinator = createCoordinator();
            const plugin = Object.assign(coordinator.createPlugin("a"), {id: "cluster"});
            const options = {url: "x"};
            await facade.start(createRuntime({coordination: {plugin: "cluster", options: options}, instanceId: "inst"}, [plugin]));
            plugin.startCalls.should.equal(1);
            plugin.ctx.options.should.eql(options);
            plugin.ctx.instanceId.should.equal("inst");
            plugin.ctx.processId.should.be.a.String();
            plugin.ctx.processId.length.should.be.above(0);
            should.exist(plugin.ctx.log);
            facade.info().should.eql({plugin: "cluster", local: false});
            facade.isLeader().should.be.true();
            log.info.calledWithMatch(sinon.match(/coordination.using.*cluster/)).should.be.true();
        });

        it("passes an empty options object when none is set", async function() {
            const plugin = Object.assign(createCoordinator().createPlugin("a"), {id: "cluster"});
            await facade.start(createRuntime({coordination: {plugin: "cluster"}}, [plugin]));
            plugin.ctx.options.should.eql({});
        });

        it("fails start for unknown plugin", async function() {
            const err = await facade.start(createRuntime({coordination: {plugin: "missing"}}, [])).should.be.rejected();
            err.code.should.equal("coordination.plugin-not-found");
            facade.isLeader().should.be.false();
            await facade.claim("k", 100).should.be.rejected();
        });

        it("fails start for wrong type", async function() {
            const plugin = {id: "lib", type: "node-red-library-source"};
            const err = await facade.start(createRuntime({coordination: {plugin: "lib"}}, [plugin])).should.be.rejected();
            err.code.should.equal("coordination.plugin-not-found");
        });

        it("fails start for a plugin without the required functions", async function() {
            const plugin = {id: "bad", type: "node-red-coordination", start: function() { return Promise.resolve() }};
            const err = await facade.start(createRuntime({coordination: {plugin: "bad"}}, [plugin])).should.be.rejected();
            err.code.should.equal("coordination.plugin-invalid");
        });

        it("warns when plugins installed but not selected", async function() {
            const coordinator = createCoordinator();
            const p1 = Object.assign(coordinator.createPlugin("a"), {id: "c1"});
            const p2 = Object.assign(coordinator.createPlugin("b"), {id: "c2"});
            await facade.start(createRuntime({}, [p1, p2]));
            facade.info().should.eql({plugin: "local", local: true});
            log.warn.calledWithMatch("coordination.plugin-not-selected").should.be.true();
            p1.startCalls.should.equal(0);
            p2.startCalls.should.equal(0);
        });

        it("no fallback when plugin start rejects", async function() {
            const plugin = Object.assign(createCoordinator().createPlugin("a"), {id: "cluster"});
            plugin.start = function() { return Promise.reject(new Error("no connection")) };
            const err = await facade.start(createRuntime({coordination: {plugin: "cluster"}}, [plugin])).should.be.rejected();
            err.message.should.match(/no connection/);
            facade.isLeader().should.be.false();
            await facade.claim("k", 100).should.be.rejected();
        });

        it("ignores plugin added after start with warning", async function() {
            const plugins = [];
            await facade.start(createRuntime({}, plugins));
            plugins.push({id: "late", type: "node-red-coordination"});
            plugins.push({id: "other", type: "node-red-library-source"});
            events.emit("registry:plugin-added", "other");
            log.warn.called.should.be.false();
            events.emit("registry:plugin-added", "late");
            log.warn.calledWithMatch("coordination.plugin-added-after-start").should.be.true();
            facade.info().should.eql({plugin: "local", local: true});
        });

        it("does not warn about plugins added after stop", async function() {
            const plugins = [];
            await facade.start(createRuntime({}, plugins));
            await facade.stop();
            plugins.push({id: "late", type: "node-red-coordination"});
            events.emit("registry:plugin-added", "late");
            log.warn.called.should.be.false();
        });

        it("start twice does not restart the plugin", async function() {
            const plugin = Object.assign(createCoordinator().createPlugin("a"), {id: "cluster"});
            const runtime = createRuntime({coordination: {plugin: "cluster"}}, [plugin]);
            await facade.start(runtime);
            await facade.start(runtime);
            plugin.startCalls.should.equal(1);
        });
    });

    describe("stop and resign", function() {
        it("resign hands over the leadership and stop releases the plugin", async function() {
            const coordinator = createCoordinator();
            const pa = Object.assign(coordinator.createPlugin("a"), {id: "cluster"});
            const pb = Object.assign(coordinator.createPlugin("b"), {id: "cluster"});
            const facadeB = coordination.createCoordination();
            await facade.start(createRuntime({coordination: {plugin: "cluster"}}, [pa]));
            await facadeB.start(createRuntime({coordination: {plugin: "cluster"}}, [pb]));
            facade.isLeader().should.be.true();
            facadeB.isLeader().should.be.false();
            await facade.resign();
            facade.isLeader().should.be.false();
            facadeB.isLeader().should.be.true();
            // leadership lost while stopping is not a warning
            log.warn.calledWithMatch("coordination.leader-lost").should.be.false();
            await facade.stop();
            await facade.claim("k", 100).should.be.rejected();
            await facadeB.stop();
        });

        it("resign and stop before start do nothing", async function() {
            await facade.resign();
            await facade.stop();
        });

        it("logs a failing plugin stop or resign as a warning", async function() {
            const plugin = Object.assign(createCoordinator().createPlugin("a"), {id: "cluster"});
            plugin.resign = function() { return Promise.reject(new Error("r")) };
            plugin.stop = function() { return Promise.reject(new Error("s")) };
            await facade.start(createRuntime({coordination: {plugin: "cluster"}}, [plugin]));
            await facade.resign();
            await facade.stop();
            log.warn.calledWithMatch("coordination.resign-failed").should.be.true();
            log.warn.calledWithMatch("coordination.stop-failed").should.be.true();
        });

        it("can be started again after stop", async function() {
            await facade.start(createRuntime({}, []));
            await facade.stop();
            facade.isLeader().should.be.false();
            await facade.start(createRuntime({}, []));
            facade.isLeader().should.be.true();
            should.exist(await facade.claim("k", 100));
        });
    });

    describe("leadership", function() {
        let coordinator;
        let plugin;
        beforeEach(async function() {
            coordinator = createCoordinator();
            plugin = Object.assign(coordinator.createPlugin("a"), {id: "cluster"});
            await facade.start(createRuntime({coordination: {plugin: "cluster"}}, [plugin]));
        });

        it("connection loss: isLeader false, listeners get false and a warning is logged", async function() {
            const node = makeNode();
            const listener = sinon.stub();
            facade.onLeaderChange(node, listener);
            facade.isLeader().should.be.true();
            coordinator.disconnect(plugin);
            facade.isLeader().should.be.false();
            listener.calledOnceWith(false).should.be.true();
            log.warn.calledWithMatch("coordination.leader-lost").should.be.true();
            await facade.claim("k", 100).should.be.rejected();
            coordinator.reconnect(plugin);
            listener.lastCall.args[0].should.be.true();
            log.info.calledWithMatch("coordination.leader-acquired").should.be.true();
        });

        it("node api auto-unsubscribes on node close", async function() {
            const node = makeNode();
            const listener = sinon.stub();
            facade.api.onLeaderChange(node, listener);
            node.emit("close");
            coordinator.disconnect(plugin);
            listener.called.should.be.false();
        });

        it("the returned function removes the listener", function() {
            const listener = sinon.stub();
            const remove = facade.api.onLeaderChange(makeNode(), listener);
            remove();
            coordinator.disconnect(plugin);
            listener.called.should.be.false();
        });

        it("accepts a listener without a node", function() {
            const listener = sinon.stub();
            facade.onLeaderChange(listener);
            coordinator.disconnect(plugin);
            listener.calledOnceWith(false).should.be.true();
        });

        it("rejects a listener that is not a function", function() {
            (function() { facade.api.onLeaderChange(makeNode(), "x") }).should.throw();
        });

        it("listener exception logged", function() {
            const failing = sinon.stub().throws(new Error("boom"));
            const other = sinon.stub();
            facade.onLeaderChange(makeNode(), failing);
            facade.onLeaderChange(makeNode(), other);
            coordinator.disconnect(plugin);
            failing.called.should.be.true();
            other.calledOnceWith(false).should.be.true();
            log.warn.calledWithMatch("coordination.listener-error").should.be.true();
        });

        it("isLeader is false when the plugin throws", function() {
            plugin.isLeader = function() { throw new Error("x") };
            facade.isLeader().should.be.false();
        });

        it("claim validates the key and ttl", async function() {
            await facade.claim("", 100).should.be.rejected();
            await facade.claim("k", 0).should.be.rejected();
            await facade.claim("k", NaN).should.be.rejected();
        });

        it("claim rejects when the plugin throws", async function() {
            plugin.claim = function() { throw new Error("x") };
            await facade.claim("k", 100).should.be.rejected();
        });
    });

    describe("claimSlot (deploy.reload.concurrency, Z-09)", function() {
        it("claims one of limit slots and null when all are taken", async function() {
            const coordinator = createCoordinator();
            const pa = Object.assign(coordinator.createPlugin("a"), {id: "cluster"});
            const pb = Object.assign(coordinator.createPlugin("b"), {id: "cluster"});
            const pc = Object.assign(coordinator.createPlugin("c"), {id: "cluster"});
            const facadeB = coordination.createCoordination();
            const facadeC = coordination.createCoordination();
            await facade.start(createRuntime({coordination: {plugin: "cluster"}}, [pa]));
            await facadeB.start(createRuntime({coordination: {plugin: "cluster"}}, [pb]));
            await facadeC.start(createRuntime({coordination: {plugin: "cluster"}}, [pc]));
            const s1 = await facade.claimSlot("reload", 2, 1000);
            const s2 = await facadeB.claimSlot("reload", 2, 1000);
            const s3 = await facadeC.claimSlot("reload", 2, 1000);
            should.exist(s1);
            should.exist(s2);
            should.not.exist(s3);
            s1.key.should.not.equal(s2.key);
            s1.key.should.match(/^slot:reload:/);
            await s1.release();
            should.exist(await facadeC.claimSlot("reload", 2, 1000));
            await facadeB.stop();
            await facadeC.stop();
        });

        it("rejects an invalid limit", async function() {
            await facade.start(createRuntime({}, []));
            await facade.claimSlot("reload", 0, 1000).should.be.rejected();
            await facade.claimSlot("reload", 1.5, 1000).should.be.rejected();
            await facade.claimSlot("", 1, 1000).should.be.rejected();
        });

        it("rejects without a connection to the coordinator", async function() {
            const coordinator = createCoordinator();
            const plugin = Object.assign(coordinator.createPlugin("a"), {id: "cluster"});
            await facade.start(createRuntime({coordination: {plugin: "cluster"}}, [plugin]));
            coordinator.disconnect(plugin);
            await facade.claimSlot("reload", 2, 1000).should.be.rejected();
        });
    });

    describe("node api", function() {
        it("exposes isLeader, onLeaderChange, claim and info only", async function() {
            Object.keys(facade.api).sort().should.eql(["claim", "info", "isLeader", "onLeaderChange"]);
            Object.isFrozen(facade.api).should.be.true();
            await facade.start(createRuntime({}, []));
            facade.api.isLeader().should.be.true();
            facade.api.info().should.eql({plugin: "local", local: true});
            should.exist(await facade.api.claim("k", 100));
        });

        it("info does not expose the plugin options", async function() {
            const plugin = Object.assign(createCoordinator().createPlugin("a"), {id: "cluster"});
            await facade.start(createRuntime({coordination: {plugin: "cluster", options: {password: "secret"}}}, [plugin]));
            JSON.stringify(facade.api.info()).should.not.match(/secret/);
        });

        it("before start: not leader and claim rejects", async function() {
            facade.api.isLeader().should.be.false();
            await facade.api.claim("k", 100).should.be.rejected();
        });
    });

    it("the module is a facade instance used by the runtime", function() {
        coordination.isLeader.should.be.a.Function();
        coordination.api.should.be.an.Object();
        coordination.PLUGIN_TYPE.should.equal("node-red-coordination");
    });
});

describe("runtime/coordination - an error that cannot be printed (#75)", function() {
    const NOT_PRINTABLE = values.NOT_PRINTABLE;
    let facade;
    let extra;
    beforeEach(function() {
        sinon.stub(log, "info");
        sinon.stub(log, "warn");
        sinon.stub(log, "error");
        sinon.stub(log, "_").callsFake(function(key, opts) { return key + (opts ? " " + JSON.stringify(opts) : "") });
        facade = coordination.createCoordination();
        extra = [];
    });
    afterEach(async function() {
        // a facade that is left started by a failing test must not hide the failure
        for (const f of [facade].concat(extra)) {
            try { await f.stop() } catch (err) { /* ignored on purpose */ }
        }
        sinon.restore();
    });

    /**
     * Runs the work (a promise or a function) and turns any failure into an
     * ordinary Error, so that a hostile value never reaches the test runner.
     */
    async function ok(what, work) {
        try {
            return await (typeof work === "function" ? work() : work);
        } catch (err) {
            let text;
            try { text = String(err) } catch (e) { text = "(the value cannot be printed)" }
            throw new Error(what + " must not fail but failed with: " + text);
        }
    }

    function makeNode(id) {
        const node = new EventEmitter();
        node.id = id || "n1";
        return node;
    }

    /**
     * A plugin of the cluster kind that does exactly what the test says. It does
     * not release anything on `stop()`, `isLeader()` stays `true`.
     */
    function makePlugin(over) {
        const unsubscribe = sinon.spy();
        const plugin = {
            id: "cluster",
            type: "node-red-coordination",
            startCalls: 0,
            stopCalls: 0,
            resignCalls: 0,
            unsubscribe: unsubscribe,
            start: function() { plugin.startCalls++; return Promise.resolve() },
            stop: function() { plugin.stopCalls++; return Promise.resolve() },
            resign: function() { plugin.resignCalls++; return Promise.resolve() },
            isLeader: function() { return true },
            onLeaderChange: function(listener) { plugin.listener = listener; return unsubscribe },
            claim: function() { return Promise.resolve(null) }
        };
        return Object.assign(plugin, over);
    }

    // The unsubscribe function of the plugin that throws what `make` creates. A plain counter, not a sinon spy:
    // a spy does not rethrow `undefined`
    function throwingUnsubscribe(plugin, make) {
        plugin.unsubscribeCalls = 0;
        return function() {
            return function() {
                plugin.unsubscribeCalls++;
                throw make();
            };
        };
    }

    function clusterRuntime(plugin) {
        return createRuntime({coordination: {plugin: "cluster"}}, [plugin]);
    }

    /** the `error` parameters passed to the catalog for the key, in order */
    function texts(key) {
        return log._.getCalls().filter(c => c.args[0] === "coordination." + key).map(c => c.args[1].error);
    }

    /** the number of `log.warn` calls for the key */
    function warnCount(key) {
        return log.warn.getCalls().filter(c => typeof c.args[0] === "string" && c.args[0].indexOf("coordination." + key) === 0).length;
    }

    /** exactly one warning for the key, with this text (a string) */
    function expectOneWarning(key, text) {
        warnCount(key).should.equal(1);
        const found = texts(key);
        found.should.have.length(1);
        (typeof found[0]).should.equal("string");
        found[0].should.equal(text);
    }

    async function expectNotStarted(f) {
        f.isLeader().should.be.false();
        const err = await f.claim("k", 100).should.be.rejected();
        err.code.should.equal("coordination.not-started");
    }

    describe("resign (AC-1, AC-2)", function() {
        values.unprintable.forEach(function(v) {
            it("AC-1: a rejection with " + v.name + " is one resign-failed warning and resign resolves", async function() {
                const plugin = makePlugin({resign: function() { return Promise.reject(v.make()) }});
                await facade.start(clusterRuntime(plugin));
                await ok("resign()", facade.resign());
                expectOneWarning("resign-failed", v.text);
                warnCount("stop-failed").should.equal(0);
            });
        });

        [
            ["V1 undefined", undefined, "undefined"],
            ["V2 null", null, "null"],
            ["V3 Object.create(null)", Object.create(null), NOT_PRINTABLE]
        ].forEach(function(row) {
            it("AC-2: a synchronous throw of " + row[0] + " is one resign-failed warning", async function() {
                const plugin = makePlugin({resign: function() { throw row[1] }});
                await facade.start(clusterRuntime(plugin));
                await ok("resign()", facade.resign());
                expectOneWarning("resign-failed", row[2]);
            });
        });

        it("AC-2: a thenable that rejects with undefined is one resign-failed warning", async function() {
            const plugin = makePlugin({resign: function() { return {then: function(_, reject) { reject(undefined) }} }});
            await facade.start(clusterRuntime(plugin));
            await ok("resign()", facade.resign());
            expectOneWarning("resign-failed", "undefined");
        });
    });

    describe("stop (AC-3, AC-4, AC-4b)", function() {
        values.unprintable.forEach(function(v) {
            it("AC-3: a rejection with " + v.name + " is one stop-failed warning and the facade is stopped", async function() {
                const plugin = makePlugin({stop: function() { plugin.stopCalls++; return Promise.reject(v.make()) }});
                const runtime = clusterRuntime(plugin);
                await facade.start(runtime);
                await ok("stop()", facade.stop());
                expectOneWarning("stop-failed", v.text);
                plugin.stopCalls.should.equal(1);
                await expectNotStarted(facade);
                plugin.unsubscribe.calledOnce.should.be.true();
                await facade.start(runtime);
                plugin.startCalls.should.equal(2);
            });
        });

        it("AC-4: a synchronous throw of undefined is one stop-failed warning and the facade is stopped", async function() {
            const plugin = makePlugin({stop: function() { plugin.stopCalls++; throw undefined }});
            const runtime = clusterRuntime(plugin);
            await facade.start(runtime);
            await ok("stop()", facade.stop());
            expectOneWarning("stop-failed", "undefined");
            await expectNotStarted(facade);
            plugin.unsubscribe.calledOnce.should.be.true();
            await facade.start(runtime);
            plugin.startCalls.should.equal(2);
        });

        [
            ["new Error(\"u\")", () => new Error("u"), "Error: u"],
            ["undefined", () => undefined, "undefined"],
            ["null", () => null, "null"],
            ["Object.create(null)", () => Object.create(null), NOT_PRINTABLE]
        ].forEach(function(row) {
            it("AC-4b (i): the unsubscribe function throws " + row[0] + ", the plugin stopped fine: one stop-failed warning, the facade is stopped", async function() {
                const plugin = makePlugin();
                plugin.onLeaderChange = throwingUnsubscribe(plugin, row[1]);
                const runtime = clusterRuntime(plugin);
                await facade.start(runtime);
                await ok("stop()", facade.stop());
                plugin.unsubscribeCalls.should.equal(1);
                expectOneWarning("stop-failed", row[2]);
                await expectNotStarted(facade);
                await ok("stop()", facade.stop());
                plugin.unsubscribeCalls.should.equal(1);
                plugin.stopCalls.should.equal(1);
                await facade.start(runtime);
                plugin.startCalls.should.equal(2);
                facade.isLeader().should.be.true();
            });

            it("AC-4b (ii): the unsubscribe function throws " + row[0] + " and the plugin stop rejects: two stop-failed warnings, the facade is stopped", async function() {
                const plugin = makePlugin({stop: function() { plugin.stopCalls++; return Promise.reject(undefined) }});
                plugin.onLeaderChange = throwingUnsubscribe(plugin, row[1]);
                const runtime = clusterRuntime(plugin);
                await facade.start(runtime);
                await ok("stop()", facade.stop());
                plugin.unsubscribeCalls.should.equal(1);
                warnCount("stop-failed").should.equal(2);
                texts("stop-failed").should.eql(["undefined", row[2]]);
                await expectNotStarted(facade);
                await ok("stop()", facade.stop());
                plugin.unsubscribeCalls.should.equal(1);
                plugin.stopCalls.should.equal(1);
                await facade.start(runtime);
                plugin.startCalls.should.equal(2);
                facade.isLeader().should.be.true();
            });
        });
    });

    describe("leadership listeners (AC-5, AC-5b, AC-6)", function() {
        values.unprintable.forEach(function(v) {
            it("AC-5: a listener that throws " + v.name + " is one listener-error warning, the others are called", async function() {
                const coordinator = createCoordinator();
                const plugin = Object.assign(coordinator.createPlugin("a"), {id: "cluster"});
                await facade.start(clusterRuntime(plugin));
                const received = [];
                facade.onLeaderChange(makeNode("a"), function() { throw v.make() });
                facade.onLeaderChange(makeNode("b"), function(leader) { received.push(leader) });
                facade.onLeaderChange(makeNode("c"), function() { throw undefined });
                await ok("the leadership change of the plugin", () => coordinator.disconnect(plugin));
                received.should.eql([false]);
                warnCount("listener-error").should.equal(2);
                texts("listener-error").should.eql([v.text, "undefined"]);
                log.warn.getCalls().filter(c => c.args[0].indexOf("coordination.listener-error") !== 0)
                    .map(c => c.args[0].split(" ")[0]).should.eql(["coordination.leader-lost"]);
            });
        });

        it("AC-5b: two instances, the listener of the instance that hands over throws undefined: the other instance still learns that it leads", async function() {
            const coordinator = createCoordinator();
            const pa = Object.assign(coordinator.createPlugin("a"), {id: "cluster"});
            const pb = Object.assign(coordinator.createPlugin("b"), {id: "cluster"});
            const facadeB = coordination.createCoordination();
            extra.push(facadeB);
            await facade.start(clusterRuntime(pa));
            await facadeB.start(clusterRuntime(pb));
            facade.isLeader().should.be.true();
            facadeB.isLeader().should.be.false();
            const receivedB = [];
            facade.onLeaderChange(makeNode("a"), function() { throw undefined });
            facadeB.onLeaderChange(makeNode("b"), function(leader) { receivedB.push(leader) });
            await ok("resign()", facade.resign());
            receivedB.should.eql([true]);
            facadeB.isLeader().should.be.true();
            facade.isLeader().should.be.false();
            expectOneWarning("listener-error", "undefined");
            warnCount("resign-failed").should.equal(0);
        });

        [
            ["undefined", () => undefined, "undefined"],
            ["Object.create(null)", () => Object.create(null), NOT_PRINTABLE]
        ].forEach(function(row) {
            it("AC-6: local plugin, a listener that throws " + row[0] + " on stop: one listener-error warning, no stop-failed", async function() {
                await facade.start(createRuntime({}, []));
                const received = [];
                facade.onLeaderChange(makeNode("a"), function() { throw row[1]() });
                facade.onLeaderChange(makeNode("b"), function(leader) { received.push(leader) });
                await ok("stop()", facade.stop());
                received.should.eql([false]);
                expectOneWarning("listener-error", row[2]);
                warnCount("stop-failed").should.equal(0);
                facade.isLeader().should.be.false();
            });
        });
    });

    describe("text of the values that are printed today (AC-7)", function() {
        function check(v, key, found) {
            warnCount(key).should.equal(1);
            found.should.have.length(1);
            values.render(found[0]).should.equal(v.text);
        }

        values.printable.forEach(function(v) {
            it("AC-7: resign rejecting with " + v.name, async function() {
                const plugin = makePlugin({resign: function() { return Promise.reject(v.make()) }});
                await facade.start(clusterRuntime(plugin));
                await ok("resign()", facade.resign());
                check(v, "resign-failed", texts("resign-failed"));
            });

            it("AC-7: stop rejecting with " + v.name, async function() {
                const plugin = makePlugin({stop: function() { return Promise.reject(v.make()) }});
                await facade.start(clusterRuntime(plugin));
                await ok("stop()", facade.stop());
                check(v, "stop-failed", texts("stop-failed"));
            });

            it("AC-7: a listener throwing " + v.name, async function() {
                const coordinator = createCoordinator();
                const plugin = Object.assign(coordinator.createPlugin("a"), {id: "cluster"});
                await facade.start(clusterRuntime(plugin));
                facade.onLeaderChange(makeNode("a"), function() { throw v.make() });
                await ok("the leadership change of the plugin", () => coordinator.disconnect(plugin));
                check(v, "listener-error", texts("listener-error"));
            });
        });

        values.printable.filter(v => v.notString).forEach(function(v) {
            it("AC-7 / I-2: the error passed to the catalog is a string for " + v.name, async function() {
                const plugin = makePlugin({resign: function() { return Promise.reject(v.make()) }});
                await facade.start(clusterRuntime(plugin));
                await ok("resign()", facade.resign());
                expectOneWarning("resign-failed", v.text);
            });
        });

        [
            ["resign-failed", "Coordination: failed to resign the leadership: Error: s"],
            ["stop-failed", "Coordination: failed to stop the coordination plugin: Error: s"],
            ["listener-error", "Coordination: error in a leadership listener: Error: s"]
        ].forEach(function(row) {
            it("AC-7: with the real catalog the line for " + row[0] + " is '" + row[1] + "'", async function() {
                const catalog = require(NR_TEST_UTILS.resolve("@node-red/runtime/locales/en-US/runtime.json"));
                const coordinator = createCoordinator();
                const plugin = Object.assign(coordinator.createPlugin("a"), {id: "cluster"});
                plugin.resign = function() { return Promise.reject(new Error("s")) };
                plugin.stop = function() { return Promise.reject(new Error("s")) };
                await facade.start(clusterRuntime(plugin));
                facade.onLeaderChange(makeNode("a"), function() { throw new Error("s") });
                if (row[0] === "resign-failed") {
                    await ok("resign()", facade.resign());
                } else if (row[0] === "stop-failed") {
                    await ok("stop()", facade.stop());
                } else {
                    await ok("the leadership change of the plugin", () => coordinator.disconnect(plugin));
                }
                const found = texts(row[0]);
                found.should.have.length(1);
                catalog.coordination[row[0]].replace("__error__", found[0]).should.equal(row[1]);
            });
        });
    });

    describe("toString is called once (AC-8)", function() {
        function subjects() {
            return [
                ["a toString that returns a text", sinon.stub().returns("x"), "x"],
                ["a toString that throws", sinon.stub().throws(new Error("t")), NOT_PRINTABLE]
            ];
        }

        subjects().forEach(function(row, index) {
            it("AC-8: " + row[0] + " is called once for a resign rejection", async function() {
                const spy = subjects()[index][1];
                const plugin = makePlugin({resign: function() { return Promise.reject({toString: spy}) }});
                await facade.start(clusterRuntime(plugin));
                await ok("resign()", facade.resign());
                spy.callCount.should.equal(1);
                expectOneWarning("resign-failed", row[2]);
            });

            it("AC-8: " + row[0] + " is called once for a stop rejection", async function() {
                const spy = subjects()[index][1];
                const plugin = makePlugin({stop: function() { return Promise.reject({toString: spy}) }});
                await facade.start(clusterRuntime(plugin));
                await ok("stop()", facade.stop());
                spy.callCount.should.equal(1);
                expectOneWarning("stop-failed", row[2]);
            });

            it("AC-8: " + row[0] + " is called once for a listener exception", async function() {
                const spy = subjects()[index][1];
                const coordinator = createCoordinator();
                const plugin = Object.assign(coordinator.createPlugin("a"), {id: "cluster"});
                await facade.start(clusterRuntime(plugin));
                facade.onLeaderChange(makeNode("a"), function() { throw {toString: spy} });
                await ok("the leadership change of the plugin", () => coordinator.disconnect(plugin));
                spy.callCount.should.equal(1);
                expectOneWarning("listener-error", row[2]);
            });
        });
    });

    describe("unchanged behaviour (AC-9)", function() {
        it("AC-9: a plugin without resign: resign logs nothing", async function() {
            const plugin = makePlugin();
            delete plugin.resign;
            await facade.start(clusterRuntime(plugin));
            await ok("resign()", facade.resign());
            log.warn.called.should.be.false();
        });

        it("AC-9: resign and stop before the start and a second stop do nothing", async function() {
            await ok("resign()", facade.resign());
            await ok("stop()", facade.stop());
            const plugin = makePlugin();
            await facade.start(clusterRuntime(plugin));
            await ok("stop()", facade.stop());
            await ok("stop()", facade.stop());
            plugin.stopCalls.should.equal(1);
            plugin.unsubscribe.calledOnce.should.be.true();
            log.warn.called.should.be.false();
        });

        it("AC-9: an editor-only instance has no failing plugin path", async function() {
            await facade.start(createRuntime({editorOnly: true}, []));
            await ok("resign()", facade.resign());
            await ok("stop()", facade.stop());
            log.warn.called.should.be.false();
        });

        it("AC-9: the keys of the facade are unchanged (I-9)", function() {
            Object.keys(coordination.createCoordination()).should.eql(
                ["PLUGIN_TYPE", "start", "resign", "stop", "isLeader", "onLeaderChange", "claim", "claimSlot", "info", "api"]);
            Object.isFrozen(facade.api).should.be.true();
            Object.keys(facade.api).sort().should.eql(["claim", "info", "isLeader", "onLeaderChange"]);
        });
    });
});
