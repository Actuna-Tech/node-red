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
 *   new test file (#8): the raw body of an "http in" route with skipBodyParsing,
 *   with and without deploy.holdHttpNodeRequests
 *   #11: tests of the removal of the routes of an "http in" node on close
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const supertest = require("supertest");
const helper = require("node-red-node-test-helper");
const httpInNode = require("nr-test-utils").require("@node-red/nodes/core/network/21-httpin.js");

describe("HTTP In node - raw body (skipBodyParsing)", function() {
    let RED;
    let received;

    // Loads the node and keeps the RED object it gets (its httpNode app)
    function httpInWrapper(_RED) {
        RED = _RED;
        return httpInNode(_RED);
    }

    const HOLD = { holdHttpNodeRequests: { enabled: true } };

    function flow(skipBodyParsing, url) {
        return [
            { id: "in", type: "http in", url: url || "/hook", method: "post", skipBodyParsing: skipBodyParsing, wires: [["sink"]] },
            { id: "sink", type: "helper" }
        ];
    }

    // deploy: the `deploy` setting of the runtime (undefined: no setting)
    function load(skipBodyParsing, deploy, done, url) {
        helper.settings(deploy === undefined ? {} : { deploy: deploy });
        helper.load(httpInWrapper, flow(skipBodyParsing, url), function() {
            received = [];
            helper.getNode("sink").on("input", function(msg) {
                received.push(msg);
                msg.req.res.status(200).end();
            });
            done();
        });
    }

    // The request passes the root app without the capture of the raw body: what happens
    // to a request that arrives while the route of the node is replaced (#8)
    function bypassRawBodyCapture() {
        const stack = RED.httpNode._router.stack;
        const index = stack.findIndex(layer => layer.handle && layer.handle.name === "rawBodyCapture");
        index.should.be.aboveOrEqual(0);
        stack.splice(index, 1);
    }

    // helper.settings() replaces the settings of the helper for the specs that run after
    // this one: the original object is put back at the end
    let savedSettings;

    before(function(done) {
        savedSettings = helper._settings;
        helper.startServer(done);
    });

    after(function(done) {
        helper._settings = savedSettings;
        helper.stopServer(done);
    });

    afterEach(function(done) {
        helper.unload().then(function() { done() }, done);
    });

    function post(path, body, done, check) {
        supertest(RED.httpNode)
            .post(path)
            .set("Content-Type", "application/json")
            .send(body)
            .expect(200)
            .end(function(err) {
                if (err) { return done(err) }
                try {
                    received.should.have.length(1);
                    check(received[0].payload);
                    done();
                } catch (e) {
                    done(e);
                }
            });
    }

    describe("with deploy.holdHttpNodeRequests enabled", function() {
        it("gives a Buffer to the handler when the raw body was captured", function(done) {
            load(true, HOLD, function() {
                post("/hook", '{"a": 1}', done, function(payload) {
                    Buffer.isBuffer(payload).should.be.true();
                    payload.toString().should.equal('{"a": 1}');
                });
            });
        });

        it("gives a Buffer when the request bypassed the capture of the raw body", function(done) {
            load(true, HOLD, function() {
                bypassRawBodyCapture();
                post("/hook", '{"a":   1}', done, function(payload) {
                    Buffer.isBuffer(payload).should.be.true();
                    // the exact bytes (a parsed body would be an object)
                    payload.toString().should.equal('{"a":   1}');
                });
            });
        });

        it("gives a Buffer for a urlencoded body that bypassed the capture", function(done) {
            load(true, HOLD, function() {
                bypassRawBodyCapture();
                supertest(RED.httpNode)
                    .post("/hook")
                    .type("form")
                    .send("a=1&b=2")
                    .expect(200)
                    .end(function(err) {
                        if (err) { return done(err) }
                        Buffer.isBuffer(received[0].payload).should.be.true();
                        received[0].payload.toString().should.equal("a=1&b=2");
                        done();
                    });
            });
        });

        it("gives a Buffer to a skipBodyParsing route with a parameter, which the capture never matches", function(done) {
            load(true, HOLD, function() {
                post("/hook/42", '{"a": 1}', done, function(payload) {
                    Buffer.isBuffer(payload).should.be.true();
                    payload.toString().should.equal('{"a": 1}');
                });
            }, "/hook/:id");
        });

        it("still parses a JSON body of a route without skipBodyParsing", function(done) {
            load(false, HOLD, function() {
                post("/hook", '{"a": 1}', done, function(payload) {
                    Buffer.isBuffer(payload).should.be.false();
                    payload.should.eql({ a: 1 });
                });
            });
        });

        it("still parses a JSON body of a route without skipBodyParsing when the capture is bypassed", function(done) {
            load(false, HOLD, function() {
                bypassRawBodyCapture();
                post("/hook", '{"a": 1}', done, function(payload) {
                    payload.should.eql({ a: 1 });
                });
            });
        });
    });

    // Without the setting the behaviour is that of 5.0.7 (regression guard)
    describe("without deploy.holdHttpNodeRequests (behaviour of 5.0.7)", function() {
        it("gives a Buffer to the handler when the raw body was captured", function(done) {
            load(true, undefined, function() {
                post("/hook", '{"a": 1}', done, function(payload) {
                    Buffer.isBuffer(payload).should.be.true();
                    payload.toString().should.equal('{"a": 1}');
                });
            });
        });

        it("gives the parsed body to a skipBodyParsing route with a parameter (/hook/:id <- /hook/42)", function(done) {
            load(true, undefined, function() {
                post("/hook/42", '{"a": 1}', done, function(payload) {
                    Buffer.isBuffer(payload).should.be.false();
                    payload.should.eql({ a: 1 });
                });
            }, "/hook/:id");
        });

        it("gives the parsed body to a skipBodyParsing route addressed in another letter case", function(done) {
            load(true, undefined, function() {
                post("/HOOK", '{"a": 1}', done, function(payload) {
                    Buffer.isBuffer(payload).should.be.false();
                    payload.should.eql({ a: 1 });
                });
            });
        });

        it("does not read the raw body of a skipBodyParsing route that bypassed the capture", function(done) {
            load(true, undefined, function() {
                bypassRawBodyCapture();
                post("/hook", '{"a": 1}', done, function(payload) {
                    payload.should.eql({ a: 1 });
                });
            });
        });

        it("the same with enabled: false and with a setting that is not an object", function(done) {
            load(true, { holdHttpNodeRequests: { enabled: false } }, function() {
                post("/hook/42", '{"a": 1}', function(err) {
                    if (err) { return done(err) }
                    helper.unload().then(function() {
                        load(true, { holdHttpNodeRequests: true }, function() {
                            post("/hook/42", '{"a": 1}', done, function(payload) {
                                payload.should.eql({ a: 1 });
                            });
                        }, "/hook/:id");
                    }, done);
                }, function(payload) {
                    payload.should.eql({ a: 1 });
                });
            }, "/hook/:id");
        });

        it("still parses a JSON body of a route without skipBodyParsing", function(done) {
            load(false, undefined, function() {
                post("/hook", '{"a": 1}', done, function(payload) {
                    payload.should.eql({ a: 1 });
                });
            });
        });
    });
});

// The routes of an "http in" node are removed on close: only its own (#11)
describe("HTTP In node - routes removed on close", function() {
    let RED;

    function httpInWrapper(_RED) {
        RED = _RED;
        return httpInNode(_RED);
    }

    // An "http in" node that answers with its own id, so a test sees which node
    // handled the request
    function httpIn(id, extra) {
        return [
            Object.assign({ id: id, type: "http in", url: "/same", method: "post", wires: [["sink-" + id]] }, extra),
            { id: "sink-" + id, type: "helper" }
        ];
    }

    function flowOf() {
        return Array.prototype.concat.apply([], arguments);
    }

    function load(flow) {
        return new Promise(function(resolve, reject) {
            helper.load(httpInWrapper, flow, function() {
                flow.filter(n => n.type === "http in").forEach(function(n) {
                    helper.getNode("sink-" + n.id).on("input", function(msg) {
                        msg.res._res.status(200).send(n.id);
                    });
                });
                resolve();
            }).catch(reject);
        });
    }

    // The layers of the router that hold a route (the app also holds middleware)
    function routeLayers() {
        return RED.httpNode._router.stack.filter(layer => layer.route);
    }

    function layersOfNode(id) {
        const callback = helper.getNode(id).callback;
        return routeLayers().filter(layer => layer.route.stack.some(l => l.handle === callback));
    }

    function answer(path) {
        return supertest(RED.httpNode).post(path).set("Content-Type", "application/json").send("{}");
    }

    function answerOf(path) {
        return answer(path).expect(200).then(res => res.text);
    }

    let savedSettings;

    before(function(done) {
        savedSettings = helper._settings;
        helper.startServer(done);
    });

    after(function(done) {
        helper._settings = savedSettings;
        helper.stopServer(done);
    });

    afterEach(function(done) {
        helper.unload().then(function() { done() }, done);
    });

    it("keeps the route of another node with the same path and method when the first node closes", async function() {
        await load(flowOf(httpIn("a"), httpIn("b")));
        (await answerOf("/same")).should.equal("a");
        await helper.getNode("a").close();
        layersOfNode("a").should.have.length(0);
        layersOfNode("b").should.have.length(1);
        (await answerOf("/same")).should.equal("b");
    });

    it("keeps the route of another node with the same path and method that is not next to it in the stack", async function() {
        await load(flowOf(httpIn("a"), httpIn("spacer", { url: "/other" }), httpIn("b")));
        await helper.getNode("a").close();
        layersOfNode("a").should.have.length(0);
        layersOfNode("spacer").should.have.length(1);
        layersOfNode("b").should.have.length(1);
        (await answerOf("/same")).should.equal("b");
    });

    it("keeps the route of another node with the same path and method when the last node closes", async function() {
        await load(flowOf(httpIn("a"), httpIn("b")));
        await helper.getNode("b").close();
        layersOfNode("a").should.have.length(1);
        (await answerOf("/same")).should.equal("a");
    });

    it("does not skip or remove the neighbours of a closed node (three nodes on the same route)", async function() {
        await load(flowOf(httpIn("a"), httpIn("b"), httpIn("c")));
        const before = routeLayers().length;
        await helper.getNode("a").close();
        routeLayers().should.have.length(before - 1);
        layersOfNode("b").should.have.length(1);
        layersOfNode("c").should.have.length(1);
        await helper.getNode("c").close();
        routeLayers().should.have.length(before - 2);
        (await answerOf("/same")).should.equal("b");
    });

    it("keeps the routes of other methods and paths", async function() {
        await load(flowOf(httpIn("a"), httpIn("b", { method: "put" }), httpIn("c", { url: "/other" })));
        await helper.getNode("a").close();
        layersOfNode("b").should.have.length(1);
        layersOfNode("c").should.have.length(1);
        await supertest(RED.httpNode).put("/same").set("Content-Type", "application/json").send("{}").expect(200);
        (await answerOf("/other")).should.equal("c");
        await answer("/same").expect(404);
    });

    // A guard only (in Express 4 one RED.httpNode.post() adds one layer, the parsers are
    // handlers inside its route): it passes on the old code too. The tests above fail on it.
    it("removes all the layers of a node (POST with upload and parsers) and leaves no dead layer", async function() {
        await load(flowOf(httpIn("a", { upload: true }), httpIn("b", { url: "/other" })));
        const all = routeLayers().length;
        const own = layersOfNode("a");
        own.length.should.be.aboveOrEqual(1);
        await helper.getNode("a").close();
        own.forEach(layer => RED.httpNode._router.stack.should.not.containEql(layer));
        routeLayers().should.have.length(all - own.length);
        layersOfNode("b").should.have.length(1);
        await answer("/same").expect(404);
    });

    it("removes every route of the nodes when they all close", async function() {
        await load(flowOf(httpIn("a"), httpIn("b"), httpIn("c"), httpIn("d", { method: "put" })));
        routeLayers().should.have.length(4);
        await helper.unload();
        routeLayers().should.have.length(0);
    });

    it("keeps a route that another module registered on the same path and method", async function() {
        await load(flowOf(httpIn("a"), httpIn("spacer", { url: "/other" })));
        const foreign = function(req, res) { res.status(200).send("foreign") };
        RED.httpNode.post("/same", foreign);
        try {
            await helper.getNode("a").close();
            routeLayers().should.have.length(2);
            routeLayers()[1].route.stack[0].handle.should.equal(foreign);
            (await answerOf("/same")).should.equal("foreign");
        } finally {
            // the foreign route is not part of the flows: remove it for the next specs
            RED.httpNode._router.stack = RED.httpNode._router.stack.filter(layer => !(layer.route && layer.route.stack[0].handle === foreign));
        }
    });

    // A guard only: with the nodes closed one after the other the old code also left no
    // layer. The growth shows only for nodes that share a route (the tests above).
    it("does not grow the router stack over redeploys", async function() {
        const flow = flowOf(httpIn("a"), httpIn("b", { upload: true }), httpIn("c", { method: "get" }));
        await load(flow);
        const expected = routeLayers().length;
        expected.should.equal(3);
        for (let i = 0; i < 5; i++) {
            await helper.unload();
            routeLayers().should.have.length(0);
            await load(flow);
            routeLayers().should.have.length(expected);
        }
    });

    it("does not fail to close when the router of the app is gone", async function() {
        await load(flowOf(httpIn("a")));
        const router = RED.httpNode._router;
        delete RED.httpNode._router;
        try {
            await helper.getNode("a").close();
        } finally {
            RED.httpNode._router = router;
        }
    });

    describe("raw body route key shared by nodes (skipBodyParsing)", function() {
        function rawPost(path, body) {
            return supertest(RED.httpNode).post(path).set("Content-Type", "application/json").send(body).expect(200);
        }

        function rawAnswers() {
            // the answer of a sink that reports whether it got a Buffer
            ["a", "b"].forEach(function(id) {
                const sink = helper.getNode("sink-" + id);
                if (!sink) { return }
                sink.removeAllListeners("input");
                sink.on("input", function(msg) {
                    msg.res._res.status(200).send(Buffer.isBuffer(msg.payload) ? "buffer:" + msg.payload.toString() : "parsed");
                });
            });
        }

        it("keeps the raw body of a route while another node with skipBodyParsing is still on it", async function() {
            await load(flowOf(httpIn("a", { skipBodyParsing: true }), httpIn("b", { skipBodyParsing: true })));
            rawAnswers();
            (await rawPost("/same", '{"x":  1}')).text.should.equal('buffer:{"x":  1}');
            await helper.getNode("a").close();
            (await rawPost("/same", '{"x":  1}')).text.should.equal('buffer:{"x":  1}');
        });

        it("keeps the raw body of a skipBodyParsing node when a node without it on the same route closes", async function() {
            await load(flowOf(httpIn("a", { skipBodyParsing: true }), httpIn("b")));
            rawAnswers();
            await helper.getNode("b").close();
            (await rawPost("/same", '{"x":  1}')).text.should.equal('buffer:{"x":  1}');
        });

        it("a second close() of the same node does not release the key of another node", async function() {
            await load(flowOf(httpIn("a", { skipBodyParsing: true }), httpIn("b", { skipBodyParsing: true })));
            rawAnswers();
            const a = helper.getNode("a");
            await a.close();
            await a.close();
            (await rawPost("/same", '{"x":  1}')).text.should.equal('buffer:{"x":  1}');
        });

        // What rawBodyCapture does with a request to the route once no node is on it: a
        // route that is not a node reports whether it got the raw body (a held key makes
        // it a Buffer). All inside ONE module instance: a reload of the module (a new
        // helper.load) would start with an empty set of keys and hide a leaked key.
        async function bodyOfForeignRoute(path, route) {
            const foreign = function(req, res) { res.status(200).send(Buffer.isBuffer(req.body) ? "buffer" : "not read") };
            RED.httpNode.post(route || path, foreign);
            try {
                return (await rawPost(path, '{"x":  1}')).text;
            } finally {
                RED.httpNode._router.stack = RED.httpNode._router.stack.filter(layer => !(layer.route && layer.route.stack[0].handle === foreign));
            }
        }

        // A redeploy of all the flows in the running module (not a new load of the module)
        async function redeploy(flow) {
            await helper.setFlows(flow, "full");
            rawAnswers();
        }

        it("a second close() leaves the count at zero (no key is held after it)", async function() {
            await load(flowOf(httpIn("a", { skipBodyParsing: true })));
            const a = helper.getNode("a");
            await a.close();
            await a.close();
            (await bodyOfForeignRoute("/same")).should.equal("not read");
        });

        it("a redeploy toggling skipBodyParsing true -> false -> true on the same route follows the setting", async function() {
            await load(flowOf(httpIn("a", { skipBodyParsing: true })));
            rawAnswers();
            (await rawPost("/same", '{"x":  1}')).text.should.equal('buffer:{"x":  1}');
            await redeploy(flowOf(httpIn("a", { skipBodyParsing: false })));
            (await rawPost("/same", '{"x":  1}')).text.should.equal("parsed");
            await redeploy(flowOf(httpIn("a", { skipBodyParsing: true })));
            (await rawPost("/same", '{"x":  1}')).text.should.equal('buffer:{"x":  1}');
        });

        it("repeated close() of one node leaves the key of the other node with skipBodyParsing", async function() {
            await load(flowOf(httpIn("a", { skipBodyParsing: true }), httpIn("b", { skipBodyParsing: true })));
            rawAnswers();
            for (let i = 0; i < 3; i++) {
                await helper.getNode("a").close();
                (await rawPost("/same", '{"x":  1}')).text.should.equal('buffer:{"x":  1}');
            }
        });

        it("an invalid path with skipBodyParsing leaves no held key", async function() {
            await load(flowOf(httpIn("bad", { url: "/foo(", skipBodyParsing: true })));
            (await bodyOfForeignRoute("/foo(", /^\/foo\($/)).should.equal("not read");
        });

        it("stops capturing the raw body when the last node of the route closes", async function() {
            await load(flowOf(httpIn("a", { skipBodyParsing: true }), httpIn("b", { skipBodyParsing: true })));
            await helper.getNode("a").close();
            await helper.getNode("b").close();
            (await bodyOfForeignRoute("/same")).should.equal("not read");
        });

        it("captures the raw body again after a redeploy once all the nodes of the route had closed", async function() {
            await load(flowOf(httpIn("a", { skipBodyParsing: true }), httpIn("b", { skipBodyParsing: true })));
            await helper.getNode("a").close();
            await helper.getNode("b").close();
            (await bodyOfForeignRoute("/same")).should.equal("not read");
            // both closed: a redeploy of one node with skipBodyParsing captures again
            await redeploy(flowOf(httpIn("a", { skipBodyParsing: true })));
            (await rawPost("/same", '{"x":  1}')).text.should.equal('buffer:{"x":  1}');
        });
    });
});
