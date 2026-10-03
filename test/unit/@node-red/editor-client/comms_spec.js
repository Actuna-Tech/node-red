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
 *   comms subscriptions: tests for subscriptions made while authentication is pending
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");

const NR_TEST_UTILS = require("nr-test-utils");

const commsModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/comms.js");

/**
 * WebSocket stand-in: records every instance and every sent message, and lets
 * tests drive the onopen/onmessage/onclose callbacks.
 */
function createWebSocketMock() {
    const instances = [];
    function MockWebSocket(url) {
        this.url = url;
        this.readyState = 0;
        this.sent = [];
        instances.push(this);
    }
    MockWebSocket.prototype.send = function(data) {
        this.sent.push(JSON.parse(data));
    };
    MockWebSocket.prototype.open = function() {
        this.readyState = 1;
        this.onopen();
    };
    MockWebSocket.prototype.receive = function(msg) {
        this.onmessage({ data: JSON.stringify(msg) });
    };
    MockWebSocket.prototype.subscribeMessages = function() {
        return this.sent.filter(function(m) { return m.hasOwnProperty("subscribe"); });
    };
    MockWebSocket.instances = instances;
    return MockWebSocket;
}

describe("editor-client/comms", function() {
    let comms;
    let mockRED;
    let MockWebSocket;
    let authTokens;
    let savedGlobals;

    beforeEach(function() {
        savedGlobals = {
            RED: global.RED,
            WebSocket: global.WebSocket,
            location: global.location,
            document: global.document
        };
        authTokens = { access_token: "1234" };
        MockWebSocket = createWebSocketMock();
        mockRED = {
            events: { on: sinon.stub() },
            settings: {
                get: function(key) {
                    return key === "auth-tokens" ? authTokens : null;
                }
            },
            user: { login: sinon.stub() },
            notify: sinon.stub(),
            _: function(key) { return key; }
        };
        global.RED = mockRED;
        global.WebSocket = MockWebSocket;
        global.location = { hostname: "localhost", port: "1880" };
        global.document = { location: { pathname: "/", protocol: "http:" } };
        delete require.cache[commsModulePath];
        comms = require(commsModulePath);
    });

    afterEach(function() {
        sinon.restore();
        delete require.cache[commsModulePath];
        Object.keys(savedGlobals).forEach(function(key) {
            if (savedGlobals[key] === undefined) {
                delete global[key];
            } else {
                global[key] = savedGlobals[key];
            }
        });
    });

    it("exports RED.comms for tests", function() {
        comms.should.equal(RED.comms);
        comms.should.have.property("subscribe").which.is.a.Function();
    });

    it("does not send subscribe while auth pending", function() {
        comms.connect();
        const ws = MockWebSocket.instances[0];
        ws.open();
        ws.sent.should.eql([{ auth: "1234" }]);

        comms.subscribe("notification/#", function() {});
        ws.subscribeMessages().should.have.length(0);
    });

    it("sends each pending subscription exactly once after auth ok", function() {
        comms.connect();
        const ws = MockWebSocket.instances[0];
        ws.open();
        comms.subscribe("notification/#", function() {});
        comms.subscribe("status/#", function() {});
        comms.subscribe("status/#", function() {});
        ws.receive({ auth: "ok" });

        ws.subscribeMessages().should.eql([
            { subscribe: "notification/#" },
            { subscribe: "status/#" }
        ]);
    });

    it("sends subscribe immediately without auth tokens", function() {
        authTokens = null;
        comms.connect();
        const ws = MockWebSocket.instances[0];
        ws.open();
        ws.sent.should.have.length(0);

        comms.subscribe("notification/#", function() {});
        ws.sent.should.eql([{ subscribe: "notification/#" }]);
    });

    it("sends subscribe immediately once auth has completed", function() {
        comms.connect();
        const ws = MockWebSocket.instances[0];
        ws.open();
        ws.receive({ auth: "ok" });

        comms.subscribe("notification/#", function() {});
        ws.subscribeMessages().should.eql([{ subscribe: "notification/#" }]);
    });

    it("keeps subscriptions after auth fail and replays on reconnect", function() {
        comms.connect();
        const ws1 = MockWebSocket.instances[0];
        ws1.open();
        comms.subscribe("notification/#", function() {});
        ws1.receive({ auth: "fail" });

        RED.user.login.calledOnce.should.be.true();
        const loginCallback = RED.user.login.firstCall.args[1];
        loginCallback();

        MockWebSocket.instances.should.have.length(2);
        const ws2 = MockWebSocket.instances[1];
        ws2.open();
        ws2.subscribeMessages().should.have.length(0);
        ws2.receive({ auth: "ok" });

        ws1.subscribeMessages().should.have.length(0);
        ws2.subscribeMessages().should.eql([{ subscribe: "notification/#" }]);
    });

    it("delivers messages to subscribers after auth ok", function() {
        const received = [];
        comms.connect();
        const ws = MockWebSocket.instances[0];
        ws.open();
        comms.subscribe("notification/#", function(topic, data) {
            received.push([topic, data]);
        });
        ws.receive({ auth: "ok" });
        ws.receive([{ topic: "notification/node/added", data: "foo" }]);

        received.should.eql([["notification/node/added", "foo"]]);
    });
});
