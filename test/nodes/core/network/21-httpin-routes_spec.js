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
 *   new test file (#11): the "http in" node registers its routes with node.registerHttpRoute and
 *   the runtime removes them when the node stops (deploy types flows, nodes and full), a node
 *   type of its own that uses the API, the same behaviour of "http in" as before
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

// The tests of the existing behaviour of "http in" are in 21-httpin_spec.js (it stays unchanged);
// this file only adds what the API of the routes of a node (#11) needs.

const should = require("should");
const sinon = require("sinon");
const assert = require("assert");
const fs = require("fs");
const supertest = require("nr-test-utils/supertest");
const helper = require("node-red-node-test-helper");
const NR_TEST_UTILS = require("nr-test-utils");
const httpInNode = NR_TEST_UTILS.require("@node-red/nodes/core/network/21-httpin.js");
const Node = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/Node");

describe("HTTP In node - routes of the node API (#11)", function() {
    let RED;
    let savedSettings;
    let received;
    let handled;
    const attached = new WeakSet();

    function httpInWrapper(_RED) {
        RED = _RED;
        return httpInNode(_RED);
    }

    // A node type of its own: its constructor registers the route through the API
    let customHandles;
    let customHits;
    function customNode(_RED) {
        RED = _RED;
        function CustomRoute(n) {
            _RED.nodes.createNode(this, n);
            customHandles.push(this.registerHttpRoute("get", n.path || "/custom", function(req, res) {
                customHits++;
                res.status(200).send("custom");
            }));
        }
        _RED.nodes.registerType("custom-route", CustomRoute);
    }

    function stack() {
        return RED.httpNode._router ? RED.httpNode._router.stack : [];
    }
    function routeLayers() {
        return stack().filter(layer => layer.route);
    }
    function layersOfPath(path) {
        return routeLayers().filter(layer => layer.route.path === path);
    }
    function layersOfNode(id) {
        const callback = helper.getNode(id).callback;
        return routeLayers().filter(layer => layer.route.stack.some(l => l.handle === callback));
    }

    // The sinks answer with the id of their node, one message is counted
    function attachSinks(ids) {
        ids.forEach(function(id) {
            const sink = helper.getNode(id);
            if (!sink || attached.has(sink)) {
                return;
            }
            attached.add(sink);
            sink.on("input", function(msg) {
                handled.push(id);
                msg.res._res.status(200).send(id);
            });
        });
    }

    function load(nodeFn, flow, sinks) {
        return new Promise(function(resolve, reject) {
            helper.load(nodeFn, flow, function(err) {
                if (err) {
                    return reject(err);
                }
                handled = [];
                attachSinks(sinks || []);
                resolve();
            }).catch(reject);
        });
    }

    function post(path) {
        return supertest(RED.httpNode).post(path).set("Content-Type", "application/json").send("{}");
    }
    function get(path) {
        return supertest(RED.httpNode).get(path);
    }

    function warningsOf(id) {
        return helper.log().args.filter(function(args) {
            return args[0] && args[0].level === helper.log().WARN && args[0].id === id;
        }).map(args => args[0]);
    }

    before(function(done) {
        savedSettings = helper._settings;
        helper.startServer(done);
    });

    after(function(done) {
        helper._settings = savedSettings;
        helper.stopServer(done);
    });

    beforeEach(function() {
        helper.settings({});
        customHandles = [];
        customHits = 0;
        handled = [];
    });

    afterEach(function(done) {
        helper.unload().then(function() { done() }, done);
    });

    describe("deployments of the flows (AC-30, AC-31)", function() {
        const SINKS = ["sinkA", "sinkB", "sinkC"];

        function flows(nameOfA) {
            return [
                { id: "tab1", type: "tab", label: "one" },
                { id: "A", z: "tab1", type: "http in", name: nameOfA, url: "/same", method: "post", wires: [["sinkA"]] },
                { id: "sinkA", z: "tab1", type: "helper" },
                { id: "tab2", type: "tab", label: "two" },
                { id: "B", z: "tab2", type: "http in", url: "/same", method: "post", wires: [["sinkB"]] },
                { id: "sinkB", z: "tab2", type: "helper" },
                { id: "C", z: "tab2", type: "http in", url: "/c", method: "get", wires: [["sinkC"]] },
                { id: "sinkC", z: "tab2", type: "helper" }
            ];
        }

        async function deploy(flow, type) {
            await helper.setFlows(flow, type);
            attachSinks(SINKS);
        }

        async function check(label, sameB) {
            layersOfNode("A").should.have.length(1, label + ": one layer of A");
            const b = layersOfNode("B");
            b.should.have.length(1, label + ": one layer of B");
            if (sameB) {
                assert.strictEqual(b[0], sameB, label + ": the layer of B is the same object");
            }
            const before = handled.length;
            // the first layer on the path answers: which one depends on the order of the starts
            const answerOfSame = (await post("/same").expect(200)).text;
            ["sinkA", "sinkB"].should.containEql(answerOfSame);
            (await get("/c").expect(200)).text.should.equal("sinkC");
            handled.slice(before).should.eql([answerOfSame, "sinkC"], label + ": one message per request");
        }

        it("AC-30: the deployments flows, nodes (a change of A only) and full (three times) leave one layer per node", async function() {
            await load(httpInWrapper, flows("first"), SINKS);
            await check("load");
            let layerOfB = layersOfNode("B")[0];

            await deploy(flows("second"), "flows");
            await check("flows", layerOfB);

            await deploy(flows("third"), "nodes");
            await check("nodes", layerOfB);

            for (let i = 0; i < 3; i++) {
                await deploy(flows("full-" + i), "full");
                await check("full " + i);
            }
        });

        it("AC-31: a deployment without A (type nodes) removes its route", async function() {
            await load(httpInWrapper, [
                { id: "tab1", type: "tab", label: "one" },
                { id: "A", z: "tab1", type: "http in", url: "/a", method: "get", wires: [["sinkA"]] },
                { id: "sinkA", z: "tab1", type: "helper" },
                { id: "tab2", type: "tab", label: "two" },
                { id: "C", z: "tab2", type: "http in", url: "/c", method: "get", wires: [["sinkC"]] },
                { id: "sinkC", z: "tab2", type: "helper" }
            ], ["sinkA", "sinkC"]);
            await get("/a").expect(200);
            layersOfPath("/a").should.have.length(1);
            await helper.setFlows([
                { id: "tab1", type: "tab", label: "one" },
                { id: "tab2", type: "tab", label: "two" },
                { id: "C", z: "tab2", type: "http in", url: "/c", method: "get", wires: [["sinkC"]] },
                { id: "sinkC", z: "tab2", type: "helper" }
            ], "nodes");
            attachSinks(["sinkC"]);
            await get("/a").expect(404);
            layersOfPath("/a").should.have.length(0);
            await get("/c").expect(200);
        });

        it("AC-31: a deployment without A (type full) removes its route", async function() {
            await load(httpInWrapper, [
                { id: "tab1", type: "tab", label: "one" },
                { id: "A", z: "tab1", type: "http in", url: "/a", method: "get", wires: [["sinkA"]] },
                { id: "sinkA", z: "tab1", type: "helper" }
            ], ["sinkA"]);
            await get("/a").expect(200);
            await helper.setFlows([{ id: "tab1", type: "tab", label: "one" }], "full");
            await get("/a").expect(404);
            layersOfPath("/a").should.have.length(0);
        });
    });

    describe("a node type of its own (AC-32, AC-36)", function() {
        const FLOW = [
            { id: "tab1", type: "tab", label: "one" },
            { id: "c1", z: "tab1", type: "custom-route" }
        ];

        it("AC-32: three full deployments leave one layer and one call per request; unload removes the route", async function() {
            await load(customNode, FLOW);
            customHandles.should.have.length(1, "the constructor registered the route through the API");
            for (let i = 0; i < 3; i++) {
                await helper.setFlows(FLOW, "full");
                layersOfPath("/custom").should.have.length(1);
                const before = customHits;
                (await get("/custom").expect(200)).text.should.equal("custom");
                (customHits - before).should.equal(1);
            }
            await helper.unload();
            layersOfPath("/custom").should.have.length(0);
            await get("/custom").expect(404);
        });

        it("AC-36: httpNodeRoot false: a node that uses the API gets a handle and its route answers", async function() {
            helper.settings({ httpNodeRoot: false });
            await load(customNode, FLOW);
            customHandles.should.have.length(1);
            customHandles[0].method.should.equal("get");
            customHandles[0].path.should.equal("/custom");
            (await get("/custom").expect(200)).text.should.equal("custom");
        });

        it("AC-36: httpNodeRoot false: \"http in\" warns that no route was created and registers none", async function() {
            helper.settings({ httpNodeRoot: false });
            await load(httpInWrapper, [
                { id: "tab1", type: "tab", label: "one" },
                { id: "in", z: "tab1", type: "http in", url: "/hook", method: "get", wires: [] }
            ]);
            warningsOf("in").map(e => e.msg).should.eql(["httpin.errors.not-created"]);
            routeLayers().should.have.length(0);
        });
    });

    describe("\"http in\" registers through the API (AC-33, AC-35)", function() {
        let spy;
        afterEach(function() {
            if (spy) {
                spy.restore();
                spy = null;
            }
        });

        function flat(list) {
            return list.reduce((all, item) => all.concat(Array.isArray(item) ? flat(item) : [item]), []);
        }

        it("AC-33: one call per node with (method, url, ...handlers), the callback and the error handler last", async function() {
            should(Node.prototype.registerHttpRoute).be.a.Function();
            spy = sinon.spy(Node.prototype, "registerHttpRoute");
            await load(httpInWrapper, [
                { id: "tab1", type: "tab", label: "one" },
                { id: "p", z: "tab1", type: "http in", url: "/post-route", method: "post", skipBodyParsing: true, wires: [] },
                { id: "g", z: "tab1", type: "http in", url: "/get-route", method: "get", wires: [] }
            ]);
            spy.callCount.should.equal(2);
            const byUrl = {};
            spy.args.forEach(function(args, i) {
                byUrl[args[1]] = { args: args, node: spy.thisValues[i] };
            });
            const post = byUrl["/post-route"];
            const getCall = byUrl["/get-route"];
            post.args[0].should.equal("post");
            getCall.args[0].should.equal("get");
            const postHandlers = flat(post.args.slice(2));
            const getHandlers = flat(getCall.args.slice(2));
            postHandlers.should.have.length(11);
            getHandlers.should.have.length(6);
            assert.strictEqual(postHandlers[9], helper.getNode("p").callback);
            assert.strictEqual(postHandlers[10], helper.getNode("p").errorHandler);
            assert.strictEqual(getHandlers[4], helper.getNode("g").callback);
            assert.strictEqual(getHandlers[5], helper.getNode("g").errorHandler);
            assert.strictEqual(post.node, helper.getNode("p"));
            assert.strictEqual(getCall.node, helper.getNode("g"));
        });

        it("AC-33 (grep): the source of \"http in\" has no removeNodeRoutes and reads _router only to place the raw body capture", function() {
            const file = NR_TEST_UTILS.resolve("@node-red/nodes/core/network/21-httpin.js");
            const lines = fs.readFileSync(file, "utf8").split("\n");
            lines.filter(line => /removeNodeRoutes/.test(line)).should.eql([]);
            const from = lines.findIndex(line => /typeof RED\.httpNode === 'function'/.test(line));
            const to = lines.findIndex(line => /function createRequestWrapper/.test(line));
            from.should.be.aboveOrEqual(0);
            to.should.be.above(from);
            lines.forEach(function(line, i) {
                if (/_router/.test(line)) {
                    (i > from && i < to).should.be.true("_router outside of the block of rawBodyCapture, line " + (i + 1));
                }
            });
        });

        it("AC-35: a node with the method options registers no route, throws nothing and warns about nothing", async function() {
            await load(httpInWrapper, [
                { id: "tab1", type: "tab", label: "one" },
                { id: "in", z: "tab1", type: "http in", url: "/opt", method: "options", wires: [] }
            ]);
            routeLayers().should.have.length(0);
            warningsOf("in").should.eql([]);
        });
    });

    describe("settings that shape the chain of handlers (E7)", function() {
        const FLOW = [
            { id: "tab1", type: "tab", label: "one" },
            { id: "in", z: "tab1", type: "http in", url: "/mw", method: "post", wires: [["sink"]] },
            { id: "sink", z: "tab1", type: "helper" }
        ];

        it("an httpNodeMiddleware function runs before the node", async function() {
            const calls = [];
            helper.settings({ httpNodeMiddleware: function(req, res, next) { calls.push("mw"); next() } });
            await load(httpInWrapper, FLOW, ["sink"]);
            (await post("/mw").expect(200)).text.should.equal("sink");
            calls.should.eql(["mw"]);
        });

        it("an httpNodeMiddleware array runs in order before the node", async function() {
            const calls = [];
            helper.settings({ httpNodeMiddleware: [
                function(req, res, next) { calls.push("one"); next() },
                function(req, res, next) { calls.push("two"); next() }
            ] });
            await load(httpInWrapper, FLOW, ["sink"]);
            (await post("/mw").expect(200)).text.should.equal("sink");
            calls.should.eql(["one", "two"]);
        });
    });
});
