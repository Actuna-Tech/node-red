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
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const EventEmitter = require("events");

const NR_TEST_UTILS = require("nr-test-utils");
const coordination = NR_TEST_UTILS.require("@node-red/runtime/lib/coordination");
const {events, log} = NR_TEST_UTILS.require("@node-red/util");
const {createCoordinator, createRuntime} = require("./mockCoordinator");

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
