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
 *   Z-10: two instances of the coordination facade with a shared coordinator
 *   in one process, each running an inject node (R-21)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const EventEmitter = require("events");

const NR_TEST_UTILS = require("nr-test-utils");
const coordination = NR_TEST_UTILS.require("@node-red/runtime/lib/coordination");
const injectModule = NR_TEST_UTILS.require("@node-red/nodes/core/common/20-inject.js");
const {log, util} = NR_TEST_UTILS.require("@node-red/util");
const {createCoordinator, createRuntime} = require("./mockCoordinator");

/**
 * A minimal node for the inject node outside a runtime: `emit("input")`
 * calls the input handlers with send/done, like the runtime does.
 */
function FakeNode() {}
FakeNode.prototype = Object.create(EventEmitter.prototype);
FakeNode.prototype.emit = function(event, msg) {
    if (event === "input") {
        const node = this;
        this.listeners("input").forEach(function(handler) {
            handler.call(node, msg, function(m) { node.sent.push(m) }, function() {});
        });
        return true;
    }
    return EventEmitter.prototype.emit.apply(this, arguments);
};
FakeNode.prototype.status = function(s) { this.statuses.push(s) };
FakeNode.prototype.warn = function(w) { this.warnings.push(w) };
FakeNode.prototype.error = function() {};
FakeNode.prototype.debug = function() {};

/**
 * One "instance": a coordination facade and the inject node type loaded with
 * a node api that provides `RED.coordination` of that facade.
 */
function createInstance(facade) {
    let InjectNode;
    const RED = {
        nodes: {
            createNode: function(node, config) {
                EventEmitter.call(node);
                node.id = config.id;
                node.sent = [];
                node.statuses = [];
                node.warnings = [];
            },
            registerType: function(type, constructor) {
                Object.setPrototypeOf(constructor.prototype, FakeNode.prototype);
                InjectNode = constructor;
            },
            getNode: function() { return null }
        },
        util: util,
        coordination: facade.api,
        httpAdmin: {post: function() {}},
        auth: {needsPermission: function() { return function() {} }},
        _: function(key) { return key }
    };
    injectModule(RED);
    const nodes = [];
    return {
        facade: facade,
        createInject: function(config) {
            const node = new InjectNode(Object.assign({
                id: "inject1",
                type: "inject",
                props: [{p: "payload", v: "x", vt: "str"}]
            }, config));
            nodes.push(node);
            return node;
        },
        // stop as runtime.stop() does: resign, stop the flows, stop the coordination
        stop: async function() {
            await facade.resign();
            nodes.forEach(function(node) {
                node.close();
                node.emit("close");
            });
            await facade.stop();
        }
    };
}

describe("runtime/coordination - two instances in one process", function() {
    let clock;
    let coordinator;
    let instanceA;
    let instanceB;
    let pluginA;

    beforeEach(async function() {
        sinon.stub(log, "info");
        sinon.stub(log, "warn");
        clock = sinon.useFakeTimers({
            now: Date.UTC(2026, 0, 1, 0, 0, 30),
            toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
        });
        coordinator = createCoordinator();
        pluginA = Object.assign(coordinator.createPlugin("A"), {id: "cluster"});
        const pluginB = Object.assign(coordinator.createPlugin("B"), {id: "cluster"});
        const facadeA = coordination.createCoordination();
        const facadeB = coordination.createCoordination();
        await facadeA.start(createRuntime({coordination: {plugin: "cluster"}}, [pluginA]));
        await facadeB.start(createRuntime({coordination: {plugin: "cluster"}}, [pluginB]));
        instanceA = createInstance(facadeA);
        instanceB = createInstance(facadeB);
    });
    afterEach(async function() {
        await instanceA.stop();
        await instanceB.stop();
        clock.restore();
        sinon.restore();
    });

    it("fires exactly once across instances (cron)", async function() {
        const a = instanceA.createInject({crontab: "* * * * *", singleInstance: true});
        const b = instanceB.createInject({crontab: "* * * * *", singleInstance: true});
        await clock.tickAsync(30000);
        (a.sent.length + b.sent.length).should.equal(1);
        await clock.tickAsync(60000);
        (a.sent.length + b.sent.length).should.equal(2);
        coordinator.claims.has("inject:inject1:2026-01-01T00:01:00.000Z").should.be.true();
        coordinator.claims.has("inject:inject1:2026-01-01T00:02:00.000Z").should.be.true();
    });

    it("without singleInstance fires in each instance", async function() {
        const a = instanceA.createInject({crontab: "* * * * *"});
        const b = instanceB.createInject({crontab: "* * * * *"});
        await clock.tickAsync(30000);
        a.sent.length.should.equal(1);
        b.sent.length.should.equal(1);
        coordinator.claims.size.should.equal(0);
    });

    it("interval fires only on the leader; standby on the other instance", async function() {
        const a = instanceA.createInject({repeat: 1, singleInstance: true});
        const b = instanceB.createInject({repeat: 1, singleInstance: true});
        await clock.tickAsync(3000);
        a.sent.length.should.equal(3);
        b.sent.length.should.equal(0);
        a.statuses.length.should.equal(0);
        b.statuses.should.eql([{fill: "grey", shape: "ring", text: "inject.standby"}]);
    });

    it("takeover after leader stop", async function() {
        const a = instanceA.createInject({repeat: 1, singleInstance: true});
        const b = instanceB.createInject({repeat: 1, singleInstance: true});
        await clock.tickAsync(2000);
        a.sent.length.should.equal(2);
        b.sent.length.should.equal(0);
        await instanceA.stop();
        instanceB.facade.isLeader().should.be.true();
        b.statuses[b.statuses.length - 1].should.eql({});
        await clock.tickAsync(3000);
        a.sent.length.should.equal(2);
        b.sent.length.should.equal(3);
    });

    it("leader resigns before its flows stop", async function() {
        instanceA.facade.isLeader().should.be.true();
        await instanceA.facade.resign();
        instanceB.facade.isLeader().should.be.true();
        instanceA.facade.isLeader().should.be.false();
    });

    it("connection loss stops the triggers of the instance", async function() {
        const a = instanceA.createInject({repeat: 1, singleInstance: true});
        const c = instanceA.createInject({id: "cron1", crontab: "* * * * *", singleInstance: true});
        coordinator.disconnect(pluginA);
        await clock.tickAsync(30000);
        a.sent.length.should.equal(0);
        c.sent.length.should.equal(0);
        c.warnings.length.should.equal(1);
        c.warnings[0].should.equal("inject.errors.claim-failed");
        a.statuses[a.statuses.length - 1].should.have.property("text", "inject.standby");
        log.warn.called.should.be.true();
    });

});

describe("runtime/coordination - local plugin with an inject node", function() {
    let clock;
    let instance;
    beforeEach(async function() {
        sinon.stub(log, "info");
        sinon.stub(log, "warn");
        clock = sinon.useFakeTimers({
            now: Date.UTC(2026, 0, 1, 0, 0, 30),
            toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
        });
        const facade = coordination.createCoordination();
        await facade.start(createRuntime({}, []));
        instance = createInstance(facade);
    });
    afterEach(async function() {
        await instance.stop();
        clock.restore();
        sinon.restore();
    });

    it("fires as without the singleInstance option", async function() {
        instance.facade.api.isLeader().should.be.true();
        const interval = instance.createInject({id: "i1", repeat: 1, singleInstance: true});
        const cron = instance.createInject({id: "c1", crontab: "* * * * *", singleInstance: true});
        const once = instance.createInject({id: "o1", once: true, onceDelay: 0.1, singleInstance: true});
        await clock.tickAsync(30000);
        interval.sent.length.should.equal(30);
        cron.sent.length.should.equal(1);
        once.sent.length.should.equal(1);
        interval.statuses.length.should.equal(0);
    });
});
