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
 *   #19: supertest bound to 127.0.0.1 (nr-test-utils/supertest), no crosstalk with other processes (flaky tests)
 *   #16: the raw body of routes with parameters or another letter case without
 *   deploy.holdHttpNodeRequests, the size limit of the raw body and of an upload
 *   #40: the contract with the drain of the HTTP requests of the runtime: the marked handler, accepted,
 *   no message and no 500 for a request that the drain answered, "http response" drops a late response,
 *   no change of the routes with the setting off
 *   #54: acceptance tests of the 413 test for a connection that is reset after the answer of the server (flaky tests)
 *   #48: acceptance tests of the answer 413 for a text body above the maximum string length, of the limits given to
 *   the JSON and urlencoded parsers, and of a response that another layer already sent
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const supertest = require("nr-test-utils/supertest");
const express = require("express");
const bodyParser = require("body-parser");
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

        it("gives a Buffer to a skipBodyParsing route addressed in another letter case", function(done) {
            load(true, HOLD, function() {
                post("/HOOK", '{"a": 1}', done, function(payload) {
                    Buffer.isBuffer(payload).should.be.true();
                    payload.toString().should.equal('{"a": 1}');
                });
            });
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

    // The raw body does not depend on the setting (#16): before, without it a route with
    // parameters, another letter case or a bypassed capture got a parsed body
    describe("without deploy.holdHttpNodeRequests", function() {
        it("gives a Buffer to the handler when the raw body was captured", function(done) {
            load(true, undefined, function() {
                post("/hook", '{"a": 1}', done, function(payload) {
                    Buffer.isBuffer(payload).should.be.true();
                    payload.toString().should.equal('{"a": 1}');
                });
            });
        });

        it("gives a Buffer to a skipBodyParsing route with a parameter (/hook/:id <- /hook/42)", function(done) {
            load(true, undefined, function() {
                post("/hook/42", '{"a": 1}', done, function(payload) {
                    Buffer.isBuffer(payload).should.be.true();
                    payload.toString().should.equal('{"a": 1}');
                });
            }, "/hook/:id");
        });

        it("gives a Buffer to a skipBodyParsing route addressed in another letter case", function(done) {
            load(true, undefined, function() {
                post("/HOOK", '{"a": 1}', done, function(payload) {
                    Buffer.isBuffer(payload).should.be.true();
                    payload.toString().should.equal('{"a": 1}');
                });
            });
        });

        it("gives a Buffer to a skipBodyParsing route that bypassed the capture", function(done) {
            load(true, undefined, function() {
                bypassRawBodyCapture();
                post("/hook", '{"a":   1}', done, function(payload) {
                    Buffer.isBuffer(payload).should.be.true();
                    payload.toString().should.equal('{"a":   1}');
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
                                Buffer.isBuffer(payload).should.be.true();
                            });
                        }, "/hook/:id");
                    }, done);
                }, function(payload) {
                    Buffer.isBuffer(payload).should.be.true();
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

        it("still parses a JSON body of a route without skipBodyParsing when the capture is bypassed", function(done) {
            load(false, undefined, function() {
                bypassRawBodyCapture();
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
            (await keyOfRoute("/same")).should.equal(HELD);
            (await rawPost("/same", '{"x":  1}')).text.should.equal('buffer:{"x":  1}');
        });

        it("keeps the raw body of a skipBodyParsing node when a node without it on the same route closes", async function() {
            await load(flowOf(httpIn("a", { skipBodyParsing: true }), httpIn("b")));
            rawAnswers();
            await helper.getNode("b").close();
            (await keyOfRoute("/same")).should.equal(HELD);
            (await rawPost("/same", '{"x":  1}')).text.should.equal('buffer:{"x":  1}');
        });

        it("a second close() of the same node does not release the key of another node", async function() {
            await load(flowOf(httpIn("a", { skipBodyParsing: true }), httpIn("b", { skipBodyParsing: true })));
            rawAnswers();
            const a = helper.getNode("a");
            await a.close();
            await a.close();
            (await keyOfRoute("/same")).should.equal(HELD);
            (await rawPost("/same", '{"x":  1}')).text.should.equal('buffer:{"x":  1}');
        });

        // Whether rawBodyCapture holds the key of the route: a route that is not a node goes
        // before the routes of the nodes (so the nodes of the route do not answer first,
        // whether they are on it or not) and reports whether it got the raw body (a held
        // key makes it a Buffer). All inside ONE module instance: a reload of the module
        // (a new helper.load) would start with an empty set of keys and hide a leaked key.
        const HELD = "buffer";
        const RELEASED = "not read";
        async function keyOfRoute(path, route) {
            const foreign = function(req, res) { res.status(200).send(Buffer.isBuffer(req.body) ? HELD : RELEASED) };
            RED.httpNode.post(route || path, foreign);
            const stack = RED.httpNode._router.stack;
            const layer = stack.pop();
            const firstRoute = stack.findIndex(l => l.route);
            stack.splice(firstRoute < 0 ? stack.length : firstRoute, 0, layer);
            try {
                return (await rawPost(path, '{"x": 1}')).text;
            } finally {
                RED.httpNode._router.stack = RED.httpNode._router.stack.filter(layer => !(layer.route && layer.route.stack.some(l => l.handle === foreign)));
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
            (await keyOfRoute("/same")).should.equal(RELEASED);
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
                (await keyOfRoute("/same")).should.equal(HELD);
                (await rawPost("/same", '{"x":  1}')).text.should.equal('buffer:{"x":  1}');
            }
        });

        it("an invalid path with skipBodyParsing leaves no held key", async function() {
            await load(flowOf(httpIn("bad", { url: "/foo(", skipBodyParsing: true })));
            (await keyOfRoute("/foo(", /^\/foo\($/)).should.equal(RELEASED);
        });

        it("stops capturing the raw body when the last node of the route closes", async function() {
            await load(flowOf(httpIn("a", { skipBodyParsing: true }), httpIn("b", { skipBodyParsing: true })));
            await helper.getNode("a").close();
            await helper.getNode("b").close();
            (await keyOfRoute("/same")).should.equal(RELEASED);
        });

        it("captures the raw body again after a redeploy once all the nodes of the route had closed", async function() {
            await load(flowOf(httpIn("a", { skipBodyParsing: true }), httpIn("b", { skipBodyParsing: true })));
            await helper.getNode("a").close();
            await helper.getNode("b").close();
            (await keyOfRoute("/same")).should.equal(RELEASED);
            // both closed: a redeploy of one node with skipBodyParsing captures again
            await redeploy(flowOf(httpIn("a", { skipBodyParsing: true })));
            (await rawPost("/same", '{"x":  1}')).text.should.equal('buffer:{"x":  1}');
        });
    });
});

// The size limit of the raw body (skipBodyParsing) and of an uploaded file (#16)
describe("HTTP In node - size limit of the raw body and of an upload", function() {
    const http = require("http");
    let RED;
    let outer;
    let server;
    let received;
    let before401;
    let holdLike;
    let mountAt = "/";

    // The httpNode app is mounted on an outer app as in the runtime, where the
    // authentication of the nodes (httpNodeAuth) is on the outer app in front of it,
    // and a hold of the requests (#8) is the first layer of the httpNode app, before the
    // module of the node adds rawBodyCapture
    function httpInWrapper(_RED) {
        RED = _RED;
        if (holdLike) { RED.httpNode.use(holdLike) }
        outer = express();
        if (before401) {
            outer.use(function(req, res) {
                before401.push({ flowing: req.readableFlowing, didRead: req.readableDidRead });
                res.sendStatus(401);
            });
        }
        outer.use(mountAt, RED.httpNode);
        return httpInNode(_RED);
    }

    // The nodes of a flow: [id, extra properties of the "http in" node]; every node
    // answers 200 through its own sink
    function flowOf(nodes) {
        const flow = [];
        nodes.forEach(function(entry) {
            flow.push(Object.assign({ id: entry[0], type: "http in", url: "/hook", method: "post", skipBodyParsing: true, wires: [["sink-" + entry[0]]] }, entry[1]));
            flow.push({ id: "sink-" + entry[0], type: "helper" });
        });
        return flow;
    }

    // settings: the settings of the runtime (for example apiMaxLength)
    async function load(nodes, settings) {
        helper.settings(settings || {});
        await new Promise(function(resolve, reject) {
            helper.load(httpInWrapper, flowOf(nodes), function() {
                received = [];
                nodes.forEach(function(entry) {
                    helper.getNode("sink-" + entry[0]).on("input", function(msg) {
                        received.push({ id: entry[0], msg: msg });
                        msg.req.res.status(200).end();
                    });
                });
                resolve();
            }, reject);
        });
        // a server bound to the loopback address only: supertest(app) on its own
        // port crosstalks with other processes on a development machine (#19)
        server = http.createServer(outer);
        await new Promise(function(resolve) { server.listen(0, "127.0.0.1", resolve) });
    }

    function raw(path, size) {
        return supertest(server).post(path).set("Content-Type", "application/octet-stream").send(Buffer.alloc(size, 0x61));
    }

    function upload(path, size) {
        return supertest(server).post(path).attach("f", Buffer.alloc(size, 0x61), "f.bin");
    }

    // The warnings of the node about an invalid size (the log carries the message key)
    function sizeWarnings() {
        return helper.log().args.filter(function(args) {
            return args[0] && args[0].msg === "httpin.errors.invalid-max-body-size";
        });
    }

    function apiWarnings() {
        return helper.log().args.filter(function(args) {
            return args[0] && args[0].msg === "httpin.errors.invalid-api-max-length";
        });
    }

    // The status code (and headers) of a request whose body is written by the test: the
    // first response counts, a request that is still being sent is reset by a server that
    // answered early. headers: of the request; chunks: the body, or none (only the
    // headers are sent)
    function request(path, headers, chunks, origin) {
        return new Promise(function(resolve, reject) {
            let answered = false;
            const req = http.request({ host: "127.0.0.1", port: server.address().port, method: "POST", path: path, agent: false, headers: headers }, function(res) {
                answered = true;
                res.resume();
                res.on("end", function() { req.destroy(); resolve(res) });
            });
            req.on("error", function(err) { answered || reject(err) });
            if (chunks) {
                chunks.forEach(function(chunk) { req.write(chunk) });
                req.end();
            } else {
                req.flushHeaders();
            }
        });
    }

    // What the server wrote as answers (#54), recorded on the side of the server: each entry is
    // {statusCode, connection}; next() resolves once there is an entry
    function servedRecord() {
        const entries = [];
        const waiting = [];
        return {
            entries: entries,
            add: function(entry) {
                entries.push(entry);
                waiting.splice(0).forEach(function(resume) { resume() });
            },
            next: function() {
                return entries.length > 0 ? Promise.resolve() : new Promise(function(resume) { waiting.push(resume) });
            }
        };
    }

    // The request of the 413 tests (#54): resolves with {statusCode, connection} of the answer.
    // A client that is still sending when the server answers and closes can see a reset (EPIPE,
    // ECONNRESET) before it has parsed the answer; then what counts is the answer that the server
    // recorded in `record` (servedRecord) - exactly one, 413 with "Connection: close". Any other
    // error, and a reset without an answer of the server, rejects.
    function request413(path, headers, chunks, record) {
        return request(path, headers, chunks).then(function(res) {
            return { statusCode: res.statusCode, connection: res.headers.connection };
        }, async function(err) {
            if (err.code !== "EPIPE" && err.code !== "ECONNRESET") {
                throw err;
            }
            // The server records its answer when it has written it, before it closes the connection, so the
            // record is there when the reset is seen; a few turns of the event loop (not a time) allow for
            // the order of the events of the two sides in this process
            await Promise.race([record.next(), new Promise(function(resolve) {
                (function turn(n) { n === 0 ? resolve() : setImmediate(turn, n - 1) })(20);
            })]);
            if (record.entries.length === 1 && record.entries[0].statusCode === 413 && record.entries[0].connection === "close") {
                return record.entries[0];
            }
            throw err;
        });
    }

    // A multipart body of `count` parts (small files) of `size` bytes, in chunks
    const BOUNDARY = "XXboundaryXX";
    function multipartChunks(count, size) {
        const chunks = [];
        for (let i = 0; i < count; i++) {
            chunks.push(Buffer.concat([
                Buffer.from("--" + BOUNDARY + "\r\nContent-Disposition: form-data; name=\"f" + i + "\"; filename=\"f" + i + ".bin\"\r\nContent-Type: application/octet-stream\r\n\r\n"),
                Buffer.alloc(size, 0x61),
                Buffer.from("\r\n")
            ]));
        }
        chunks.push(Buffer.from("--" + BOUNDARY + "--\r\n"));
        return chunks;
    }
    const MULTIPART = { "Content-Type": "multipart/form-data; boundary=" + BOUNDARY };

    let savedSettings;

    before(function(done) {
        savedSettings = helper._settings;
        helper.startServer(done);
    });

    after(function(done) {
        helper._settings = savedSettings;
        helper.stopServer(done);
    });

    afterEach(async function() {
        if (server) {
            // open keep-alive connections would hold close() back
            server.closeAllConnections();
            await new Promise(function(resolve) { server.close(resolve) });
            server = null;
        }
        await helper.unload();
        // the helper reuses the httpNode app: it is a root app again
        RED.httpNode.parent = undefined;
        before401 = null;
        holdLike = null;
        mountAt = "/";
    });

    describe("default limit (apiMaxLength, 5mb)", function() {
        it("answers 413 to a raw body above 5mb and does not run the flow", async function() {
            await load([["a"]]);
            await raw("/hook", 6 * 1024 * 1024).expect(413);
            received.should.have.length(0);
        });

        it("accepts a raw body below 5mb", async function() {
            await load([["a"]]);
            await raw("/hook", 4 * 1024 * 1024).expect(200);
            received.should.have.length(1);
            Buffer.isBuffer(received[0].msg.payload).should.be.true();
            received[0].msg.payload.length.should.equal(4 * 1024 * 1024);
        });

        it("limits a route with a parameter and a route addressed in another letter case", async function() {
            await load([["a", { url: "/hook/:id" }], ["b", { url: "/Other" }]]);
            await raw("/hook/1", 6 * 1024 * 1024).expect(413);
            await raw("/OTHER", 6 * 1024 * 1024).expect(413);
            received.should.have.length(0);
            await raw("/hook/1", 1024).expect(200);
            await raw("/OTHER", 1024).expect(200);
            received.should.have.length(2);
        });

        it("uses the apiMaxLength setting, in the same format as the body parsers", async function() {
            await load([["a"], ["b", { url: "/p/:id" }]], { apiMaxLength: "1kb" });
            await raw("/hook", 2048).expect(413);
            await raw("/p/1", 2048).expect(413);
            await raw("/hook", 1000).expect(200);
            await raw("/p/1", 1000).expect(200);
            received.should.have.length(2);
        });

        it("accepts apiMaxLength as a number of bytes", async function() {
            await load([["a"]], { apiMaxLength: 1024 });
            await raw("/hook", 2048).expect(413);
            await raw("/hook", 1000).expect(200);
        });

        it("limits a body without Content-Length (chunked)", async function() {
            await load([["a"], ["b", { url: "/p/:id" }]], { apiMaxLength: "1kb" });
            function chunked(path, size) {
                return new Promise(function(resolve, reject) {
                    const req = http.request({ host: "127.0.0.1", port: server.address().port, method: "POST", path: path, agent: false,
                        headers: { "Content-Type": "application/octet-stream", "Transfer-Encoding": "chunked" } }, function(res) {
                        res.resume();
                        res.on("end", function() { resolve(res.statusCode) });
                    });
                    req.on("error", reject);
                    for (let sent = 0; sent < size; sent += 512) { req.write(Buffer.alloc(512, 0x61)) }
                    req.end();
                });
            }
            (await chunked("/hook", 4096)).should.equal(413);
            (await chunked("/p/1", 4096)).should.equal(413);
            (await chunked("/hook", 512)).should.equal(200);
            (await chunked("/p/1", 512)).should.equal(200);
            received.should.have.length(2);
        });

        it("limits the raw body that bypassed the capture", async function() {
            await load([["a"]], { apiMaxLength: "1kb" });
            const stack = RED.httpNode._router.stack;
            stack.splice(stack.findIndex(layer => layer.handle && layer.handle.name === "rawBodyCapture"), 1);
            await raw("/hook", 2048).expect(413);
            await raw("/hook", 1000).expect(200);
        });

        it("uses 5mb and warns for an apiMaxLength that is not a size above 0", async function() {
            // a negative number is accepted by the body parsers, a string that is not a size is not
            // one warning for all the nodes
            await load([["a"], ["b", { url: "/b" }], ["c", { url: "/c", skipBodyParsing: false, upload: true }]], { apiMaxLength: -1 });
            apiWarnings().should.have.length(1);
            sizeWarnings().should.have.length(0);
            await raw("/hook", 1024).expect(200);
            await raw("/hook", 6 * 1024 * 1024).expect(413);
        });

        it("does not warn about apiMaxLength for nodes that have no raw body or upload", async function() {
            await load([["a", { method: "get", skipBodyParsing: false }], ["b", { url: "/b", skipBodyParsing: false }]], { apiMaxLength: -1 });
            apiWarnings().should.have.length(0);
        });

        it("does not limit the parsed body of a route without skipBodyParsing by the raw limit", async function() {
            await load([["a", { skipBodyParsing: false }]], { apiMaxLength: "1kb" });
            await supertest(server).post("/hook").set("Content-Type", "application/json").send('{"a": 1}').expect(200);
            received[0].msg.payload.should.eql({ a: 1 });
        });
    });

    describe("limit of the node (maxBodySize)", function() {
        it("raises the limit above the default for the raw body", async function() {
            await load([["a", { maxBodySize: "8mb" }], ["b", { url: "/p/:id", maxBodySize: "8mb" }]]);
            await raw("/hook", 6 * 1024 * 1024).expect(200);
            await raw("/p/1", 6 * 1024 * 1024).expect(200);
            received.should.have.length(2);
            received[0].msg.payload.length.should.equal(6 * 1024 * 1024);
            await raw("/hook", 9 * 1024 * 1024).expect(413);
            await raw("/p/1", 9 * 1024 * 1024).expect(413);
        });

        it("lowers the limit below the setting", async function() {
            await load([["a", { maxBodySize: "1kb" }], ["b", { url: "/p/:id", maxBodySize: 1024 }]], { apiMaxLength: "1mb" });
            await raw("/hook", 2048).expect(413);
            await raw("/p/1", 2048).expect(413);
            await raw("/hook", 1000).expect(200);
            await raw("/p/1", 1000).expect(200);
        });

        it("accepts the units b, kb, mb, gb in any case and a plain number of bytes", async function() {
            await load([["a", { maxBodySize: " 2 KB " }], ["b", { url: "/b", maxBodySize: "1500" }], ["c", { url: "/c", maxBodySize: "0.5kb" }]], { apiMaxLength: "10kb" });
            await raw("/hook", 2000).expect(200);
            await raw("/hook", 2100).expect(413);
            await raw("/b", 1400).expect(200);
            await raw("/b", 1600).expect(413);
            await raw("/c", 500).expect(200);
            await raw("/c", 600).expect(413);
        });

        it("uses the default for an empty value", async function() {
            await load([["a", { maxBodySize: "" }], ["b", { url: "/b", maxBodySize: "   " }]], { apiMaxLength: "1kb" });
            await raw("/hook", 2048).expect(413);
            await raw("/b", 2048).expect(413);
            sizeWarnings().should.have.length(0);
        });

        ["abc", "-5", "0", "5 apples", "1e3", "NaN"].forEach(function(value) {
            it("uses the default and warns for an invalid value " + JSON.stringify(value), async function() {
                await load([["a", { maxBodySize: value }]], { apiMaxLength: "1kb" });
                sizeWarnings().should.have.length(1);
                await raw("/hook", 2048).expect(413);
                await raw("/hook", 1000).expect(200);
            });
        });

        it("applies the limit of each node on a route shared by nodes", async function() {
            await load([["a", { maxBodySize: "1kb" }], ["b", { maxBodySize: "10kb" }]]);
            // the first registered node answers (Express): its limit counts
            await raw("/hook", 2048).expect(413);
            received.should.have.length(0);
            await raw("/hook", 500).expect(200);
            received[0].id.should.equal("a");
            // the node with the lower limit is gone: the other one answers within its limit
            await helper.getNode("a").close();
            await raw("/hook", 2048).expect(200);
            received[1].id.should.equal("b");
            await raw("/hook", 11 * 1024).expect(413);
        });

        it("applies the limit of the first node on a shared route when it is the higher one", async function() {
            await load([["a", { maxBodySize: "10kb" }], ["b", { maxBodySize: "1kb" }]]);
            await raw("/hook", 2048).expect(200);
            received[0].id.should.equal("a");
            await raw("/hook", 11 * 1024).expect(413);
        });

        it("accepts the units tb and pb", async function() {
            await load([["a", { maxBodySize: "1tb" }], ["b", { url: "/b", maxBodySize: "2 PB" }]], { apiMaxLength: "1kb" });
            sizeWarnings().should.have.length(0);
            await raw("/hook", 2048).expect(200);
            await raw("/b", 2048).expect(200);
        });

        it("rejects a value that is far too long without a long match, and warns", async function() {
            // a number, spaces, a character that is not a unit: the case of a pattern with two
            // neighbouring \s* (quadratic time without a limit of the length)
            const value = "1" + " ".repeat(40000) + "x";
            const start = Date.now();
            await load([["a", { maxBodySize: value }]], { apiMaxLength: "1kb" });
            (Date.now() - start).should.be.below(1000);
            sizeWarnings().should.have.length(1);
            // the warning does not carry the whole text
            JSON.stringify(sizeWarnings()).length.should.be.below(2000);
            await raw("/hook", 2048).expect(413);
        });

        it("ignores the field of a node that has no raw body and no upload", async function() {
            await load([["a", { skipBodyParsing: false, maxBodySize: "abc" }]]);
            sizeWarnings().should.have.length(0);
        });
    });

    describe("after the authentication and with CORS", function() {
        it("does not read the body of a request that the authentication in front of the nodes rejects", async function() {
            before401 = [];
            await load([["a"], ["b", { url: "/p/:id" }]]);
            await supertest(server).post("/hook").set("Content-Type", "application/octet-stream").send(Buffer.alloc(100 * 1024, 0x61)).expect(401);
            await supertest(server).post("/p/1").set("Content-Type", "application/octet-stream").send(Buffer.alloc(100 * 1024, 0x61)).expect(401);
            before401.should.have.length(2);
            // the body of the request was neither read nor started to flow
            before401.forEach(function(seen) {
                should(seen.flowing).equal(null);
                seen.didRead.should.be.false();
            });
            received.should.have.length(0);
        });

        it("sends the 413 with the CORS headers, from a route with a literal path and a parameter", async function() {
            await load([["a"], ["b", { url: "/p/:id" }]], { apiMaxLength: "1kb", httpNodeCors: { origin: "*" } });
            for (const path of ["/hook", "/p/1"]) {
                const res = await raw(path, 2048).set("Origin", "http://example.test").expect(413);
                res.headers["access-control-allow-origin"].should.equal("*");
            }
        });

        it("does not read the body of a request that the hold of the requests keeps, reads it after the release", async function() {
            const held = [];
            holdLike = function(req, res, next) {
                held.push({ next: next, flowing: req.readableFlowing, didRead: req.readableDidRead });
            };
            await load([["a"]]);
            const answer = supertest(server).post("/hook").set("Content-Type", "application/octet-stream").send(Buffer.alloc(100 * 1024, 0x61)).expect(200).then(function(res) { return res });
            while (held.length === 0) { await new Promise(function(resolve) { setTimeout(resolve, 5) }) }
            // held in front of rawBodyCapture: the stream was not touched
            should(held[0].flowing).equal(null);
            held[0].didRead.should.be.false();
            received.should.have.length(0);
            held[0].next();
            await answer;
            Buffer.isBuffer(received[0].msg.payload).should.be.true();
            received[0].msg.payload.length.should.equal(100 * 1024);
        });
    });

    describe("middleware and other routes on the route of a node with skipBodyParsing", function() {
        // the example of settings.js: a middleware that sets skipRawBodyParser
        function skipping(req, res, next) { req.skipRawBodyParser = true; next() }

        it("gives a Buffer for a literal path and for a path with a parameter although a middleware sets skipRawBodyParser", async function() {
            await load([["a"], ["b", { url: "/p/:id" }]], { httpNodeMiddleware: skipping });
            await supertest(server).post("/hook").set("Content-Type", "application/octet-stream").send(Buffer.alloc(10, 0x61)).expect(200);
            await supertest(server).post("/p/1").set("Content-Type", "application/octet-stream").send(Buffer.alloc(10, 0x61)).expect(200);
            received.should.have.length(2);
            received.forEach(function(r) {
                Buffer.isBuffer(r.msg.payload).should.be.true();
                r.msg.payload.length.should.equal(10);
            });
        });

        it("lets the middleware find the raw body in req.body, also under a mount path of the httpNode app", async function() {
            mountAt = "/api";
            const seen = [];
            await load([["a"]], { httpNodeMiddleware: function(req, res, next) { seen.push(Buffer.isBuffer(req.body)); next() } });
            await supertest(server).post("/api/hook").set("Content-Type", "application/json").send('{"x": 1}').expect(200);
            seen.should.eql([true]);
            Buffer.isBuffer(received[0].msg.payload).should.be.true();
        });

        it("gives the raw body to another route on the same method and path", async function() {
            await load([["a"]]);
            const foreign = function(req, res) { res.status(200).send(Buffer.isBuffer(req.body) ? "buffer" : "not read") };
            RED.httpNode.post("/hook", foreign);
            // before the route of the node, which would answer first
            const stack = RED.httpNode._router.stack;
            stack.splice(stack.findIndex(l => l.route), 0, stack.pop());
            const res = await supertest(server).post("/hook").set("Content-Type", "application/json").send('{"x": 1}').expect(200);
            res.text.should.equal("buffer");
        });
    });

    describe("another receiver of a body above the limit of a node with skipBodyParsing", function() {
        const BIG = 3008;

        // the body above the limit is answered by rawBodyCapture, whoever would answer the
        // request: the others never wait for a body that is not read any more
        async function chunkedStatus(path, size) {
            const chunks = [];
            for (let sent = 0; sent < size; sent += 512) { chunks.push(Buffer.alloc(Math.min(512, size - sent), 0x61)) }
            return (await request(path, { "Content-Type": "application/octet-stream", "Transfer-Encoding": "chunked" }, chunks)).statusCode;
        }

        it("answers 413 for a node without skipBodyParsing that is registered first (Content-Length and chunked)", async function() {
            await load([["n", { skipBodyParsing: false }], ["a", { maxBodySize: "1kb" }]]);
            await raw("/hook", BIG).expect(413);
            (await chunkedStatus("/hook", BIG)).should.equal(413);
            received.should.have.length(0);
            // within the limit the first node answers with the body it got
            await raw("/hook", 500).expect(200);
            received[0].id.should.equal("n");
            Buffer.isBuffer(received[0].msg.payload).should.be.true();
        });

        it("answers 413 for a foreign route with a body parser that is before the nodes (Content-Length and chunked)", async function() {
            await load([["a", { maxBodySize: "1kb" }]]);
            const foreign = function(req, res) { res.status(200).send("parsed " + typeof req.body) };
            RED.httpNode.post("/hook", bodyParser.text({ type: function() { return true }, limit: "1mb" }), foreign);
            const stack = RED.httpNode._router.stack;
            stack.splice(stack.findIndex(l => l.route), 0, stack.pop());
            await raw("/hook", BIG).expect(413);
            (await chunkedStatus("/hook", BIG)).should.equal(413);
            received.should.have.length(0);
        });

        it("sends the CORS headers with that 413 (a node without skipBodyParsing first)", async function() {
            await load([["n", { skipBodyParsing: false }], ["a", { maxBodySize: "1kb" }]], { httpNodeCors: { origin: "*" } });
            const res = await raw("/hook", BIG).set("Origin", "http://example.test").expect(413);
            res.headers["access-control-allow-origin"].should.equal("*");
        });
    });

    describe("capture of an earlier load of the module", function() {
        it("is replaced, at its place, not added again, when the module loads again on the same httpNode app", function() {
            const app = express();
            const hold = function hold(req, res, next) { next() };
            app.use(hold);
            const fakeRED = { httpNode: app, settings: {}, nodes: { registerType: function() {} }, _: function(k) { return k } };
            const layers = () => app._router.stack.map(l => l.handle.name);
            httpInNode(fakeRED);
            layers().should.eql(["query", "expressInit", "hold", "rawBodyCapture"]);
            // another layer after the capture: the new capture takes the place of the old one
            app.use(function after(req, res, next) { next() });
            httpInNode(fakeRED);
            layers().should.eql(["query", "expressInit", "hold", "rawBodyCapture", "after"]);
        });
    });

    describe("rejected body that is large", function() {
        it("answers 413 at once and closes the connection when the declared length is above 64mb", async function() {
            await load([["a"]]);
            // only the headers are sent: a server that read the body first would wait
            const res = await request("/hook", { "Content-Type": "application/octet-stream", "Content-Length": 70 * 1024 * 1024 });
            res.statusCode.should.equal(413);
            res.headers.connection.should.equal("close");
            received.should.have.length(0);
        });

        it("the same for a multipart upload above the limit of the node", async function() {
            await load([["a", { upload: true, skipBodyParsing: false, maxBodySize: "1kb" }]]);
            const res = await request("/hook", Object.assign({ "Content-Length": 70 * 1024 * 1024 }, MULTIPART));
            res.statusCode.should.equal(413);
            res.headers.connection.should.equal("close");
        });

        it("does not read a multipart body of a declared length above the limit of the node, multer does not run", async function() {
            await load([["a", { upload: true, skipBodyParsing: false, maxBodySize: "1kb" }]]);
            const chunks = multipartChunks(1, 2000);
            const res = await request("/hook", Object.assign({ "Content-Length": Buffer.concat(chunks).length }, MULTIPART), chunks);
            res.statusCode.should.equal(413);
            received.should.have.length(0);
        });

        it("answers 413 and closes the connection when a chunked body passes 64mb", async function() {
            await load([["a"]], { apiMaxLength: "1kb" });
            const chunk = Buffer.alloc(1024 * 1024, 0x61);
            const chunks = [];
            for (let i = 0; i < 66; i++) { chunks.push(chunk) }
            // #54: the server answers early and closes, so a client that is still sending can see a reset
            // before it has parsed the answer; the answer that the server wrote counts then
            const record = servedRecord();
            server.on("request", function(req, res) {
                res.on("finish", function() {
                    record.add({ statusCode: res.statusCode, connection: res.getHeader("connection") });
                });
            });
            const res = await request413("/hook", { "Content-Type": "application/octet-stream", "Transfer-Encoding": "chunked" }, chunks, record);
            res.statusCode.should.equal(413);
            res.connection.should.equal("close");
            await record.next();
            record.entries.should.eql([{ statusCode: 413, connection: "close" }]);
        });

        // #54: the 66 MiB body of the test above, and a server that answers and resets
        function bigChunks() {
            const chunk = Buffer.alloc(1024 * 1024, 0x61);
            const chunks = [];
            for (let i = 0; i < 66; i++) { chunks.push(chunk) }
            return chunks;
        }
        const BIG_HEADERS = { "Content-Type": "application/octet-stream", "Transfer-Encoding": "chunked" };
        const ANSWER_413 = "HTTP/1.1 413 Payload Too Large\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 17\r\nConnection: close\r\n\r\nPayload Too Large";

        it("AC-11: the answer 413 with Connection: close is seen by the client and written once by the server", async function() {
            await load([["a"]], { apiMaxLength: "1kb" });
            const record = servedRecord();
            server.on("request", function(req, res) {
                res.on("finish", function() {
                    record.add({ statusCode: res.statusCode, connection: res.getHeader("connection") });
                });
            });
            const answer = await request413("/hook", BIG_HEADERS, bigChunks(), record);
            answer.statusCode.should.equal(413);
            answer.connection.should.equal("close");
            await record.next();
            record.entries.should.eql([{ statusCode: 413, connection: "close" }]);
        });

        // A server of raw sockets: onHeaders(socket) runs once the headers of a request have arrived
        function listenRaw(onHeaders) {
            const net = require("net");
            const raw = net.createServer(function(socket) {
                let head = "";
                let seen = false;
                socket.on("error", function() {});
                socket.on("data", function(data) {
                    if (seen) { return }
                    head += data.toString("latin1");
                    if (head.indexOf("\r\n\r\n") !== -1) {
                        seen = true;
                        onHeaders(socket);
                    }
                });
            });
            return new Promise(function(resolve, reject) {
                raw.once("error", reject);
                raw.listen(0, "127.0.0.1", function() { resolve(raw) });
            });
        }

        // The tests of the helper talk to a raw server through `server`, which the helper reads
        async function withRawServer(onHeaders, run) {
            const raw = await listenRaw(onHeaders);
            const saved = server;
            server = raw;
            try {
                return await run();
            } finally {
                server = saved;
                await new Promise(function(resolve) { raw.close(resolve) });
            }
        }

        it("AC-12: a reset after the 413 that the server wrote is not an error of the test", async function() {
            await load([["a"]], { apiMaxLength: "1kb" });
            const record = servedRecord();
            const answer = await withRawServer(function(socket) {
                socket.write(ANSWER_413, function() {
                    record.add({ statusCode: 413, connection: "close" });
                    socket.resetAndDestroy();
                });
            }, function() {
                return request413("/hook", BIG_HEADERS, bigChunks(), record);
            });
            answer.statusCode.should.equal(413);
            answer.connection.should.equal("close");
            record.entries.should.eql([{ statusCode: 413, connection: "close" }]);
        });

        // The client sees the reset before it has parsed any answer, whatever the system does with the data of the
        // answer that arrived with it: http.request gives a request that fails with `code` and never answers
        function failBeforeAnswer(code) {
            const { EventEmitter } = require("events");
            const sinon = require("sinon");
            return sinon.stub(http, "request").callsFake(function() {
                const req = new EventEmitter();
                req.write = function() { return true };
                req.flushHeaders = function() {};
                req.destroy = function() {};
                req.setTimeout = function() { return req };
                req.end = function() {
                    setImmediate(function() {
                        const err = new Error("write " + code);
                        err.code = code;
                        req.emit("error", err);
                    });
                };
                return req;
            });
        }

        ["EPIPE", "ECONNRESET"].forEach(function(code) {
            it("AC-12: " + code + " before the client parsed the answer is not an error of the test when the server wrote the 413", async function() {
                await load([["a"]], { apiMaxLength: "1kb" });
                const record = servedRecord();
                record.add({ statusCode: 413, connection: "close" });
                const stub = failBeforeAnswer(code);
                try {
                    const answer = await request413("/hook", BIG_HEADERS, bigChunks(), record);
                    answer.statusCode.should.equal(413);
                    answer.connection.should.equal("close");
                } finally {
                    stub.restore();
                }
            });

            it("AC-13: " + code + " before the client parsed the answer fails the test when the server wrote nothing", async function() {
                await load([["a"]], { apiMaxLength: "1kb" });
                const record = servedRecord();
                const stub = failBeforeAnswer(code);
                let err;
                try {
                    err = await request413("/hook", BIG_HEADERS, bigChunks(), record).then(function() { return undefined }, function(e) { return e });
                } finally {
                    stub.restore();
                }
                should.exist(err);
                err.should.have.property("code", code);
            });
        });

        it("AC-13: a reset before any answer of the server fails the test", async function() {
            await load([["a"]], { apiMaxLength: "1kb" });
            const record = servedRecord();
            const err = await withRawServer(function(socket) {
                socket.resetAndDestroy();
            }, function() {
                return request413("/hook", BIG_HEADERS, bigChunks(), record).then(function() {
                    throw new Error("no failure although the server never answered");
                }, function(err) { return err });
            });
            ["ECONNRESET", "EPIPE"].should.containEql(err.code);
            record.entries.should.have.length(0);
        });
    });

    // #48: a text body above the maximum string length of Node.js, the limits given to the JSON and
    // urlencoded parsers, and a response that another layer already sent
    describe("text body above the maximum string length (#48)", function() {
        const path = require("path");
        const MAX = require("buffer").constants.MAX_STRING_LENGTH;
        // a status line of a correct answer is there within this time; a request that is not
        // answered is closed by the client after it
        const ANSWER_BOUND = 1000;
        const KIB = Buffer.alloc(1024, 0x61);
        // the unit of a size text, built from parts
        const GB = "g" + "b";
        // the event name of a stray error, built from parts
        const STRAY_EVENT = ["un", "caught", "Exception"].join("");

        function delay(ms) {
            return new Promise(function(resolve) { setTimeout(resolve, ms) });
        }

        // the value of `promise`, or `fallback` after `ms`
        function within(promise, ms, fallback) {
            let timer;
            return Promise.race([promise, new Promise(function(resolve) { timer = setTimeout(resolve, ms, fallback) })]).then(function(value) {
                clearTimeout(timer);
                return value;
            });
        }

        // One request, bounded in time. Resolves with {settled: true, statusCode, headers, body} when
        // the answer is complete, {settled: true, error} when the connection fails before it, and
        // {settled: false} when there is no status line after `bound` ms (the request is closed by the
        // client then). chunks: the body, written at once; options.end false leaves the request open
        // after the chunks (a declared length above the bytes that are sent).
        function exchange(method, urlPath, headers, chunks, options) {
            const end = !options || options.end !== false;
            const bound = (options && options.bound) || ANSWER_BOUND;
            return new Promise(function(resolve) {
                let done = false;
                let timer;
                function finish(result) {
                    if (done) { return }
                    done = true;
                    clearTimeout(timer);
                    req.destroy();
                    resolve(result);
                }
                const req = http.request({ host: "127.0.0.1", port: server.address().port, method: method, path: urlPath, agent: false, headers: headers }, function(res) {
                    const parts = [];
                    res.on("data", function(chunk) { parts.push(chunk) });
                    const complete = function() {
                        finish({ settled: true, statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString() });
                    };
                    res.on("end", complete);
                    res.on("close", complete);
                });
                req.on("error", function(err) { finish({ settled: true, error: err.code || err.message }) });
                timer = setTimeout(function() { finish({ settled: false }) }, bound);
                chunks.forEach(function(chunk) { req.write(chunk) });
                if (end) { req.end() }
            });
        }

        // A request that the test ends or closes itself: client.first resolves with the status code of the
        // first answer; the request stays open
        function openRequest(method, urlPath, headers, chunks) {
            const client = { statuses: [], errors: [] };
            client.first = new Promise(function(resolve) { client.resolveFirst = resolve });
            client.req = http.request({ host: "127.0.0.1", port: server.address().port, method: method, path: urlPath, agent: false, headers: headers }, function(res) {
                client.statuses.push(res.statusCode);
                res.resume();
                client.resolveFirst(res.statusCode);
            });
            client.req.on("error", function(err) { client.errors.push(err.code || err.message) });
            chunks.forEach(function(chunk) { client.req.write(chunk) });
            return client;
        }

        // Collects the stray errors of the test run while a test runs: the listeners of the runner are
        // taken off and put back by restore()
        function collectStrays() {
            const saved = process.listeners(STRAY_EVENT);
            const seen = [];
            process.removeAllListeners(STRAY_EVENT);
            const handler = function(err) { seen.push(err && (err.code || err.message)) };
            process.on(STRAY_EVENT, handler);
            return {
                seen: seen,
                restore: function() {
                    process.removeListener(STRAY_EVENT, handler);
                    saved.forEach(function(listener) { process.on(STRAY_EVENT, listener) });
                }
            };
        }

        function declared(extra) {
            return Object.assign({ "Content-Length": String(MAX + 1) }, extra);
        }

        // The text types of the input table (the second entry: the headers of the request, the third:
        // the body that is sent, 1 KiB of ASCII by default)
        const TEXT_TYPES = [
            ["no Content-Type", {}],
            ["text/plain", { "Content-Type": "text/plain" }],
            ["text/plain; charset=utf-8", { "Content-Type": "text/plain; charset=utf-8" }],
            ["text/csv", { "Content-Type": "text/csv" }],
            ["text/xml", { "Content-Type": "text/xml" }],
            ["application/xml", { "Content-Type": "application/xml" }],
            ["application/atom+xml", { "Content-Type": "application/atom+xml" }],
            ["application/x-ndjson", { "Content-Type": "application/x-ndjson" }],
            ["application/vnd.api+json", { "Content-Type": "application/vnd.api+json" }],
            ["text/plain with Content-Encoding gzip", { "Content-Type": "text/plain", "Content-Encoding": "gzip" }],
            ["multibyte text/plain; charset=utf-8", { "Content-Type": "text/plain; charset=utf-8" }, Buffer.from("zażółć gęślą jaźń ".repeat(60))]
        ];

        // The first answers of all the text types, sent together: {label: status code, or a text when
        // there is no status line}
        async function statusPerTextType(method, urlPath, extraHeaders) {
            const results = await Promise.all(TEXT_TYPES.map(function(type) {
                return exchange(method, urlPath, declared(Object.assign({}, type[1], extraHeaders)), [type[2] || KIB], { end: false });
            }));
            const summary = {};
            TEXT_TYPES.forEach(function(type, i) {
                summary[type[0]] = results[i].settled ? (results[i].statusCode || results[i].error) : "no status line within " + ANSWER_BOUND + " ms";
            });
            return { summary: summary, results: results };
        }

        const ALL_413 = {};
        TEXT_TYPES.forEach(function(type) { ALL_413[type[0]] = 413 });

        function checkAnswer413(result) {
            result.statusCode.should.equal(413);
            result.headers["content-type"].should.equal("text/plain; charset=utf-8");
            result.headers["content-length"].should.equal("17");
            result.headers.connection.should.equal("close");
            result.body.should.equal("Payload Too Large");
        }

        describe("AC-1: a text body above the maximum string length is answered with 413", function() {
            [
                ["POST", { method: "post" }],
                ["PUT", { method: "put" }],
                ["PATCH", { method: "patch" }],
                ["DELETE", { method: "delete" }]
            ].forEach(function(route) {
                it("AC-1: " + route[0] + ", every text type, the declared length is above the maximum", async function() {
                    await load([["a", Object.assign({ skipBodyParsing: false }, route[1])]]);
                    const outcome = await statusPerTextType(route[1].method.toUpperCase(), "/hook");
                    outcome.summary.should.eql(ALL_413);
                    outcome.results.forEach(checkAnswer413);
                    received.should.have.length(0);
                });
            });
        });

        it("AC-2: the next request to the route is served after a 413", async function() {
            await load([["a", { skipBodyParsing: false }]]);
            const refused = await exchange("POST", "/hook", declared({ "Content-Type": "text/plain" }), [KIB], { end: false });
            refused.should.have.property("statusCode", 413);
            const text = "b".repeat(100);
            const served = await exchange("POST", "/hook", { "Content-Type": "text/plain" }, [Buffer.from(text)]);
            served.should.have.property("statusCode", 200);
            received.should.have.length(1);
            received[0].msg.payload.should.equal(text);
        });

        describe("AC-3: small bodies keep their payload type", function() {
            const SMALL = "small body éä {a}";
            const TEXT_PAYLOAD = [
                ["no Content-Type", {}],
                ["text/plain", { "Content-Type": "text/plain" }],
                ["application/xml", { "Content-Type": "application/xml" }],
                ["application/x-ndjson", { "Content-Type": "application/x-ndjson" }]
            ];
            const BUFFER_PAYLOAD = ["application/octet-stream", "application/cbor", "application/x-protobuf", "image/png", "multipart/form-data; boundary=xx"];

            TEXT_PAYLOAD.forEach(function(entry) {
                it("AC-3: a string payload for " + entry[0], async function() {
                    await load([["a", { skipBodyParsing: false }]]);
                    const res = await exchange("POST", "/hook", entry[1], [Buffer.from(SMALL)]);
                    res.should.have.property("statusCode", 200);
                    received.should.have.length(1);
                    received[0].msg.payload.should.equal(SMALL);
                });
            });

            BUFFER_PAYLOAD.forEach(function(type) {
                it("AC-3: a Buffer payload for " + type, async function() {
                    await load([["a", { skipBodyParsing: false }]]);
                    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 0x61, 0x62]);
                    const res = await exchange("POST", "/hook", { "Content-Type": type }, [bytes]);
                    res.should.have.property("statusCode", 200);
                    received.should.have.length(1);
                    Buffer.isBuffer(received[0].msg.payload).should.be.true();
                    received[0].msg.payload.equals(bytes).should.be.true();
                });
            });

            it("AC-3: an object payload for JSON and for urlencoded", async function() {
                await load([["a", { skipBodyParsing: false }]]);
                (await exchange("POST", "/hook", { "Content-Type": "application/json" }, [Buffer.from('{"a": 1}')])).should.have.property("statusCode", 200);
                (await exchange("POST", "/hook", { "Content-Type": "application/x-www-form-urlencoded" }, [Buffer.from("a=1&b=2")])).should.have.property("statusCode", 200);
                received.should.have.length(2);
                received[0].msg.payload.should.eql({ a: 1 });
                received[1].msg.payload.should.eql({ a: "1", b: "2" });
            });
        });

        // Opt-in tests with bodies at the boundary of the maximum string length: they need a large
        // test run and are run on purpose
        describe("AC-4, AC-5 (opt-in: NODE_RED_TEST_LARGE_BODY=1)", function() {
            const OPTED_IN = process.env.NODE_RED_TEST_LARGE_BODY === "1";
            const MIB = 1024 * 1024;

            it("AC-4 (opt-in: NODE_RED_TEST_LARGE_BODY=1): a chunked text body above the maximum string length is answered with one 413 and the next request is served", async function() {
                if (!OPTED_IN) { return this.skip() }
                this.timeout(300000);
                await load([["a", { skipBodyParsing: false }]]);
                const record = servedRecord();
                server.on("request", function(req, res) {
                    res.on("finish", function() {
                        record.add({ statusCode: res.statusCode, connection: res.getHeader("connection") });
                    });
                });
                const chunk = Buffer.alloc(MIB, 0x61);
                const chunks = [];
                for (let sent = 0; sent < MAX + 64 * MIB; sent += MIB) { chunks.push(chunk) }
                const answer = await request413("/hook", { "Content-Type": "text/plain", "Transfer-Encoding": "chunked" }, chunks, record);
                answer.statusCode.should.equal(413);
                answer.connection.should.equal("close");
                await record.next();
                record.entries.should.eql([{ statusCode: 413, connection: "close" }]);
                received.should.have.length(0);
                const served = await exchange("POST", "/hook", { "Content-Type": "text/plain" }, [Buffer.from("small")], { bound: 10000 });
                served.should.have.property("statusCode", 200);
            });

            it("AC-5 (opt-in: NODE_RED_TEST_LARGE_BODY=1): a text body of exactly the maximum string length is accepted", async function() {
                if (!OPTED_IN) { return this.skip() }
                this.timeout(300000);
                await load([["a", { skipBodyParsing: false }]]);
                const chunk = Buffer.alloc(MIB, 0x61);
                const chunks = [];
                let left = MAX;
                for (; left >= MIB; left -= MIB) { chunks.push(chunk) }
                if (left > 0) { chunks.push(Buffer.alloc(left, 0x61)) }
                const res = await exchange("POST", "/hook", { "Content-Type": "text/plain", "Content-Length": String(MAX) }, chunks, { bound: 280000 });
                res.should.have.property("statusCode", 200);
                received.should.have.length(1);
                received[0].msg.payload.length.should.equal(MAX);
            });
        });

        describe("AC-6: binary bodies keep no limit", function() {
            it("AC-6a: application/octet-stream and image/png with a declared length above the maximum get no status line within 200 ms on a plain route, and the next request is served", async function() {
                await load([["a", { skipBodyParsing: false }]]);
                const outcome = {};
                for (const type of ["application/octet-stream", "image/png"]) {
                    const res = await exchange("POST", "/hook", declared({ "Content-Type": type }), [KIB], { end: false, bound: 200 });
                    outcome[type] = res.settled;
                }
                outcome.should.eql({ "application/octet-stream": false, "image/png": false });
                received.should.have.length(0);
                const served = await exchange("POST", "/hook", { "Content-Type": "application/octet-stream" }, [KIB]);
                served.should.have.property("statusCode", 200);
                received.should.have.length(1);
                received[0].msg.payload.equals(KIB).should.be.true();
            });
        });

        describe("AC-7: the limit given to the JSON and urlencoded parsers", function() {
            const bytesModule = require(require.resolve("bytes", { paths: [path.dirname(require.resolve("body-parser"))] }));

            // The limits that the node passes to bodyParser.json and bodyParser.urlencoded when it starts;
            // the parsers are stand-ins that let every request pass
            async function limitsFor(apiMaxLength, given) {
                const parsers = require("body-parser");
                const names = ["json", "urlencoded"];
                const saved = {};
                const limits = { json: [], urlencoded: [] };
                names.forEach(function(name) {
                    saved[name] = Object.getOwnPropertyDescriptor(parsers, name);
                    Object.defineProperty(parsers, name, {
                        configurable: true,
                        enumerable: true,
                        value: function(options) {
                            // the helper of the tests builds parsers for its own admin app: only the calls
                            // that come from the node count
                            if (new Error().stack.indexOf("21-httpin.js") !== -1) {
                                limits[name].push(options && options.limit);
                            }
                            return function(req, res, next) { next() };
                        }
                    });
                });
                try {
                    await load([["a", { skipBodyParsing: false }]], given ? { apiMaxLength: apiMaxLength } : {});
                } finally {
                    names.forEach(function(name) { Object.defineProperty(parsers, name, saved[name]) });
                }
                return limits;
            }

            function label(value) {
                return typeof value === "string" ? JSON.stringify(value) : typeof value + " " + String(value);
            }

            function checkLimits(limits, expected) {
                limits.json.should.have.length(1);
                limits.urlencoded.should.have.length(1);
                should(limits.json[0]).equal(expected);
                should(limits.urlencoded[0]).equal(expected);
            }

            [
                "1" + GB, 1e9, Infinity, "+1" + GB, "600000000abc"
            ].forEach(function(value) {
                it("AC-7a: apiMaxLength " + label(value) + " gives both parsers the maximum string length as the limit", async function() {
                    checkLimits(await limitsFor(value, true), MAX);
                });
            });

            [
                ["5mb", "5mb"], [undefined, "5mb"], ["+5mb", "+5mb"], ["1e9", "1e9"], [-1, -1], [-Infinity, -Infinity]
            ].forEach(function(entry) {
                it("AC-7a: apiMaxLength " + label(entry[0]) + " gives both parsers " + label(entry[1]) + " as the limit, unchanged", async function() {
                    checkLimits(await limitsFor(entry[0], entry[0] !== undefined), entry[1]);
                });
            });

            // R2-03: the limit follows the rules of the bytes module for these inputs, also at the
            // boundary of the maximum string length
            [
                "1" + GB, 1e9, Infinity, "+1" + GB, "600000000abc", " 600000000", "1" + GB + " ", "1 " + GB.toUpperCase(),
                "1\t" + GB, "0x40000000", "1.5pb", 1e400, 10n, {}, true, "5mb", "+5mb", "1e9", -1, -Infinity, "abc",
                "1tb", "0.5" + GB, "512mb", "511mb", MAX, MAX + 1, MAX + "b", (MAX + 1) + "b", String(MAX), String(MAX + 1)
            ].forEach(function(value) {
                it("AC-7 R2-03: apiMaxLength " + label(value) + " gives the limit that the rules of the bytes module give", async function() {
                    const parsed = bytesModule.parse(value);
                    const expected = (typeof parsed === "number" && parsed > MAX) ? MAX : value;
                    checkLimits(await limitsFor(value, true), expected);
                });
            });

            [
                ["application/json", Buffer.from('{"abc":12}'), Buffer.from('{"a":"' + "x".repeat(1100))],
                ["application/x-www-form-urlencoded", Buffer.from("abcd=1234"), Buffer.from("a=" + "x".repeat(1100))]
            ].forEach(function(entry) {
                it("AC-7b: " + entry[0] + " with a declared length above the maximum gets no message, and the next request is served", async function() {
                    await load([["a", { skipBodyParsing: false }]], { apiMaxLength: "1" + GB });
                    const strays = collectStrays();
                    try {
                        const client = openRequest("POST", "/hook", declared({ "Content-Type": entry[0] }), [entry[2].slice(0, 1024)]);
                        await delay(200);
                        received.should.have.length(0);
                        client.req.destroy();
                        await delay(100);
                        strays.seen.should.eql([]);
                    } finally {
                        strays.restore();
                    }
                    const served = await exchange("POST", "/hook", { "Content-Type": entry[0] }, [entry[1]]);
                    served.should.have.property("statusCode", 200);
                    received.should.have.length(1);
                });
            });

            it("AC-7c: a fully framed JSON body of 2 KiB above apiMaxLength 1kb gets 500", async function() {
                await load([["a", { skipBodyParsing: false }]], { apiMaxLength: "1kb" });
                const body = Buffer.from(JSON.stringify({ a: "x".repeat(2048) }));
                const res = await exchange("POST", "/hook", { "Content-Type": "application/json", "Content-Length": String(body.length) }, [body]);
                res.should.have.property("statusCode", 500);
                received.should.have.length(0);
            });
        });

        it("AC-8: the 413 carries the CORS headers, on a literal path and on a path with a parameter", async function() {
            await load([["a", { skipBodyParsing: false }], ["b", { url: "/p/:id", skipBodyParsing: false }]], { httpNodeCors: { origin: "*" } });
            const origin = { Origin: "http://example.test" };
            const seen = {};
            const paths = ["/hook", "/p/1"];
            const results = await Promise.all(paths.map(function(urlPath) {
                return exchange("POST", urlPath, declared(Object.assign({ "Content-Type": "text/plain" }, origin)), [KIB], { end: false });
            }));
            paths.forEach(function(urlPath, i) {
                const res = results[i];
                seen[urlPath] = res.settled ? [res.statusCode, res.headers["access-control-allow-origin"]] : "no status line";
            });
            seen.should.eql({ "/hook": [413, "*"], "/p/1": [413, "*"] });
        });

        describe("AC-9: a response that another layer sent before the limit was hit", function() {
            // answers 503 with Connection: close, and calls next() as the layers of a held request do
            function answerAndContinue(req, res, next) {
                if (req.headers["x-answer-first"]) {
                    res.statusCode = 503;
                    res.setHeader("Connection", "close");
                    res.end("busy");
                }
                next();
            }

            // sends the request, then waits for the closing of both sides
            async function singleAnswer(urlPath, headers) {
                const strays = collectStrays();
                try {
                    const res = await exchange("POST", urlPath, declared(Object.assign({ "x-answer-first": "1" }, headers)), [Buffer.alloc(1024, 0x61)].concat([]), { end: false });
                    await delay(150);
                    return { res: res, strays: strays.seen.slice() };
                } finally {
                    strays.restore();
                }
            }

            function checkSingle(outcome) {
                outcome.res.should.have.property("statusCode", 503);
                outcome.res.body.should.equal("busy");
                outcome.strays.should.eql([]);
            }

            it("AC-9a: httpNodeMiddleware answers first, a node without options, text/plain with a declared length above the maximum", async function() {
                await load([["a", { skipBodyParsing: false }]], { httpNodeMiddleware: answerAndContinue });
                checkSingle(await singleAnswer("/hook", { "Content-Type": "text/plain" }));
                const served = await exchange("POST", "/hook", { "Content-Type": "text/plain" }, [Buffer.from("b".repeat(100))]);
                served.should.have.property("statusCode", 200);
                received.should.have.length(1);
            });

            it("AC-9b: httpNodeMiddleware answers first, a Do not parse node on a path with a parameter, a declared 2 KiB above apiMaxLength 1kb", async function() {
                await load([["a", { url: "/p/:id" }]], { apiMaxLength: "1kb", httpNodeMiddleware: answerAndContinue });
                const strays = collectStrays();
                let outcome;
                try {
                    const res = await exchange("POST", "/p/1", { "x-answer-first": "1", "Content-Type": "application/octet-stream", "Content-Length": "2048" }, [KIB], { end: false });
                    await delay(150);
                    outcome = { res: res, strays: strays.seen.slice() };
                } finally {
                    strays.restore();
                }
                checkSingle(outcome);
                const served = await exchange("POST", "/p/1", { "Content-Type": "application/octet-stream" }, [Buffer.alloc(500, 0x61)]);
                served.should.have.property("statusCode", 200);
                received.should.have.length(1);
            });

            it("AC-9b: the same with a declared length above the bound of the discarded part of a refused body", async function() {
                await load([["a", { url: "/p/:id" }]], { apiMaxLength: "1kb", httpNodeMiddleware: answerAndContinue });
                const strays = collectStrays();
                let outcome;
                try {
                    const res = await exchange("POST", "/p/1", { "x-answer-first": "1", "Content-Type": "application/octet-stream", "Content-Length": String(70 * 1024 * 1024) }, [KIB], { end: false });
                    await delay(150);
                    outcome = { res: res, strays: strays.seen.slice() };
                } finally {
                    strays.restore();
                }
                checkSingle(outcome);
                const served = await exchange("POST", "/p/1", { "Content-Type": "application/octet-stream" }, [Buffer.alloc(500, 0x61)]);
                served.should.have.property("statusCode", 200);
                received.should.have.length(1);
            });

            it("AC-9c: a layer in front of the capture answers first, a Do not parse node, a declared 2 KiB above apiMaxLength 1kb, with CORS set", async function() {
                holdLike = answerAndContinue;
                await load([["a"]], { apiMaxLength: "1kb", httpNodeCors: { origin: "*" } });
                const strays = collectStrays();
                let outcome;
                try {
                    const res = await exchange("POST", "/hook", { "x-answer-first": "1", Origin: "http://example.test", "Content-Type": "application/octet-stream", "Content-Length": "2048" }, [KIB], { end: false });
                    await delay(150);
                    outcome = { res: res, strays: strays.seen.slice() };
                } finally {
                    strays.restore();
                }
                checkSingle(outcome);
                const served = await exchange("POST", "/hook", { "Content-Type": "application/octet-stream" }, [Buffer.alloc(500, 0x61)]);
                served.should.have.property("statusCode", 200);
                received.should.have.length(1);
            });
        });

        it("AC-10: a 413 writes no log line", async function() {
            await load([["a", { skipBodyParsing: false }]]);
            const before = helper.log().args.length;
            const res = await exchange("POST", "/hook", declared({ "Content-Type": "text/plain" }), [KIB], { end: false });
            res.should.have.property("statusCode", 413);
            await delay(100);
            helper.log().args.slice(before).should.eql([]);
        });

        describe("AC-11: a response that another layer sent while the rest of the body is discarded", function() {
            // The middleware keeps `res` of the requests that carry the marker header; the test answers it
            // with 503 and Connection: close once the limit is hit, as the drain does, and then the client
            // ends the request or closes it
            async function answeredWhileDiscarding(headers, chunks, closing) {
                const kept = [];
                await load([["a", { url: "/p/:id" }]], {
                    apiMaxLength: "1kb",
                    httpNodeMiddleware: function(req, res, next) {
                        if (req.headers["x-keep"]) { kept.push(res) }
                        next();
                    }
                });
                const strays = collectStrays();
                try {
                    const client = openRequest("POST", "/p/1", Object.assign({ "x-keep": "1", "Content-Type": "application/octet-stream" }, headers), chunks);
                    for (let i = 0; i < 200 && kept.length === 0; i++) { await delay(5) }
                    kept.should.have.length(1);
                    await delay(50);
                    kept[0].statusCode = 503;
                    kept[0].setHeader("Connection", "close");
                    kept[0].end("busy");
                    const status = await within(client.first, ANSWER_BOUND, "no status line");
                    if (closing === "ends") {
                        client.req.end();
                    } else if (closing === "destroys") {
                        client.req.destroy();
                    } else if (closing === "closed by the server") {
                        kept[0].req.destroy();
                    } else {
                        kept[0].req.destroy(new Error("failed"));
                    }
                    await delay(150);
                    return { status: status, statuses: client.statuses.slice(), strays: strays.seen.slice() };
                } finally {
                    strays.restore();
                }
            }

            [
                ["ends", "the client ends the request"],
                ["destroys", "the client destroys the request"],
                ["closed by the server", "the request is closed on the server side"],
                ["fails", "the request fails with an error on the server side"]
            ].forEach(function(closing) {
                it("AC-11a: a declared 4 KiB body that is sent in part, " + closing[1] + " after the 503", async function() {
                    const outcome = await answeredWhileDiscarding({ "Content-Length": "4096" }, [KIB], closing[0]);
                    outcome.should.eql({ status: 503, statuses: [503], strays: [] });
                    const served = await exchange("POST", "/p/1", { "Content-Type": "application/octet-stream" }, [Buffer.alloc(500, 0x61)]);
                    served.should.have.property("statusCode", 200);
                });

                it("AC-11b: a chunked body that passes 1 KiB, " + closing[1] + " after the 503", async function() {
                    const outcome = await answeredWhileDiscarding({ "Transfer-Encoding": "chunked" }, [Buffer.alloc(600, 0x61), Buffer.alloc(600, 0x61)], closing[0]);
                    outcome.should.eql({ status: 503, statuses: [503], strays: [] });
                    const served = await exchange("POST", "/p/1", { "Content-Type": "application/octet-stream" }, [Buffer.alloc(500, 0x61)]);
                    served.should.have.property("statusCode", 200);
                });
            });
        });
    });

    describe("file upload (multer)", function() {
        it("limits the whole body of an upload: many small files together above the limit", async function() {
            await load([["a", { upload: true, skipBodyParsing: false, maxBodySize: "100kb" }]]);
            let req = supertest(server).post("/hook");
            for (let i = 0; i < 200; i++) { req = req.attach("f" + i, Buffer.alloc(1024, 0x61), "f" + i + ".bin") }
            await req.expect(413);
            received.should.have.length(0);
            // a few files within the limit
            req = supertest(server).post("/hook");
            for (let i = 0; i < 10; i++) { req = req.attach("f" + i, Buffer.alloc(1024, 0x61), "f" + i + ".bin") }
            await req.expect(200);
            received[0].msg.req.files.should.have.length(10);
        });

        it("limits a chunked upload (no Content-Length) by the bytes that arrive, multer does not finish", async function() {
            await load([["a", { upload: true, skipBodyParsing: false, maxBodySize: "100kb" }]]);
            const chunks = multipartChunks(300, 1024);
            const res = await request("/hook", Object.assign({ "Transfer-Encoding": "chunked" }, MULTIPART), chunks);
            res.statusCode.should.equal(413);
            received.should.have.length(0);
            // the next chunked upload within the limit works
            const ok = await request("/hook", Object.assign({ "Transfer-Encoding": "chunked" }, MULTIPART), multipartChunks(10, 1024));
            ok.statusCode.should.equal(200);
            received.should.have.length(1);
            received[0].msg.req.files.should.have.length(10);
        });

        it("does not limit a request that is not multipart by the limit of the node, as before", async function() {
            await load([["a", { upload: true, skipBodyParsing: false, maxBodySize: "1kb" }]]);
            await supertest(server).post("/hook").set("Content-Type", "text/plain").send("x".repeat(5000)).expect(200);
            received.should.have.length(1);
        });

        it("answers 413 to a file above the limit of the node", async function() {
            await load([["a", { upload: true, skipBodyParsing: false, maxBodySize: "1kb" }]]);
            await upload("/hook", 2048).expect(413);
            received.should.have.length(0);
        });

        it("accepts a file within the limit of the node, in req.files", async function() {
            await load([["a", { upload: true, skipBodyParsing: false, maxBodySize: "1kb" }]]);
            await upload("/hook", 500).expect(200);
            received.should.have.length(1);
            received[0].msg.req.files.should.have.length(1);
            received[0].msg.req.files[0].size.should.equal(500);
        });

        it("accepts a file above the default limit with a raised limit of the node", async function() {
            await load([["a", { upload: true, skipBodyParsing: false, maxBodySize: "8mb" }]], { apiMaxLength: "1kb" });
            await upload("/hook", 4096).expect(200);
            received[0].msg.req.files[0].size.should.equal(4096);
        });

        it("does not limit the files without the limit of the node, as before", async function() {
            await load([["a", { upload: true, skipBodyParsing: false }]], { apiMaxLength: "1kb" });
            await upload("/hook", 4096).expect(200);
            received[0].msg.req.files[0].size.should.equal(4096);
        });

        it("uses the default for an invalid limit of the node (the files stay unlimited)", async function() {
            await load([["a", { upload: true, skipBodyParsing: false, maxBodySize: "abc" }]], { apiMaxLength: "1kb" });
            sizeWarnings().should.have.length(1);
            await upload("/hook", 4096).expect(200);
        });
    });
});

// The contract with the drain of the HTTP requests of the runtime (#40, deploy.drainHttpNodeRequests)
describe("HTTP In node - drain of the HTTP requests (#40)", function() {
    const http = require("http");
    const sinon = require("sinon");
    const NR_TEST_UTILS = require("nr-test-utils");
    const httpDrain = NR_TEST_UTILS.require("@node-red/runtime/lib/httpDrain");
    const S = httpDrain.S;
    let RED;
    let received;
    // the callbacks `next` of the held requests: a stand-in of a slow authentication (httpNodeMiddleware)
    let held;
    let savedSettings;

    // The runtime mounts the middleware of the drain on the httpNode app before the node module loads
    function wrapper(_RED) {
        RED = _RED;
        if (httpDrain.isEnabled()) {
            _RED.httpNode.use(httpDrain.middleware);
        }
        return httpInNode(_RED);
    }

    function flow(method, extra) {
        return [
            Object.assign({ id: "in", type: "http in", url: "/hook", method: method || "post", wires: [["sink"]] }, extra),
            { id: "sink", type: "helper" },
            { id: "out", type: "http response", statusCode: "200", wires: [] }
        ];
    }

    // drain: the setting `deploy.drainHttpNodeRequests` (undefined: off); withAuth: a request waits in a middleware
    function load(nodes, options) {
        options = options || {};
        const settings = {};
        if (options.drain) {
            settings.deploy = { drainHttpNodeRequests: Object.assign({ enabled: true, timeout: 5000 }, options.drain) };
            httpDrain.init(settings);
        } else {
            httpDrain.dispose();
        }
        if (options.withAuth) {
            settings.httpNodeMiddleware = function(req, res, next) { held.push({ req, res, next }) };
        }
        if (options.middleware) {
            settings.httpNodeMiddleware = options.middleware;
        }
        helper.settings(settings);
        return new Promise(function(resolve, reject) {
            helper.load(wrapper, nodes, function(err) {
                if (err) { return reject(err) }
                received = [];
                helper.getNode("sink").on("input", function(msg) {
                    received.push(msg);
                    if (!options.silentSink) {
                        msg.req.res.status(200).end("sink");
                    }
                });
                resolve();
            });
        });
    }
    function waitFor(check, what) {
        return new Promise(function(resolve, reject) {
            const started = Date.now();
            (function poll() {
                if (check()) { return resolve() }
                if (Date.now() - started > 3000) { return reject(new Error("timeout waiting for " + what)) }
                setTimeout(poll, 5);
            })();
        });
    }
    function flush() {
        return new Promise(resolve => setImmediate(resolve));
    }
    function route(app) {
        const layer = app._router.stack.find(l => l.route && l.route.path === "/hook");
        should.exist(layer);
        return layer.route;
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
        held = [];
    });
    afterEach(function(done) {
        // a stop with the drain enabled answers what is still open (the contract under test)
        helper.unload().then(function() {
            httpDrain.dispose();
            done();
        }, function(err) {
            httpDrain.dispose();
            done(err);
        });
    });

    describe("the marked handler", function() {
        ["get", "post", "put", "patch", "delete"].forEach(function(method) {
            it("the route of a " + method + " node has a handler marked for the drain, also with the drain off", async function() {
                await load(flow(method));
                route(RED.httpNode).stack.filter(l => l.handle[S] === true).length.should.equal(1);
                httpDrain.isEnabled().should.be.false();
            });
        });
        it("the marked handler is the callback of the node", async function() {
            await load(flow("post"));
            const node = helper.getNode("in");
            node.callback[S].should.be.true();
            route(RED.httpNode).stack.some(l => l.handle === node.callback).should.be.true();
        });
        it("with the drain off the app has no new layer and a post route no new handler (A11, D10)", async function() {
            await load(flow("post"));
            RED.httpNode._router.stack.map(l => l.handle.name).should.eql(["query", "expressInit", "rawBodyCapture", "bound dispatch"]);
            // cookie parser, middleware, cors, metrics, raw body, json, urlencoded, multipart, raw parser, callback, error handler
            route(RED.httpNode).stack.length.should.equal(11);
        });
        it("with the drain off a get route has no new handler either", async function() {
            await load(flow("get"));
            // cookie parser, middleware, cors, metrics, callback, error handler
            route(RED.httpNode).stack.length.should.equal(6);
        });
    });

    describe("with the drain off", function() {
        it("the request has no entry and the flow answers as before", async function() {
            await load(flow("post"), { middleware: function(req, res, next) { req.sawEntry = req[S]; next() } });
            const res = await supertest(RED.httpNode).post("/hook").send({ a: 1 }).expect(200);
            res.text.should.equal("sink");
            should.not.exist(received[0].req.sawEntry);
            should.not.exist(received[0].req[S]);
            httpDrain.size().should.equal(0);
        });
    });

    describe("with the drain on", function() {
        it("the request is accepted when the node passes it into the flow, not before", async function() {
            const seen = [];
            await load(flow("post"), {
                drain: {},
                middleware: function(req, res, next) { seen.push(req[S].accepted); next() }
            });
            const res = await supertest(RED.httpNode).post("/hook").send({ a: 1 }).expect(200);
            res.text.should.equal("sink");
            seen.should.eql([false]);
            received[0].req[S].accepted.should.be.true();
            received[0].req[S].drained.should.be.false();
        });
        it("the entry is removed when the response has finished", async function() {
            await load(flow("get"), { drain: {} });
            await supertest(RED.httpNode).get("/hook").expect(200);
            await waitFor(() => httpDrain.size() === 0, "the entry to be removed");
        });
        it("the middleware does not touch the request stream before the authentication", async function() {
            const seen = [];
            await load(flow("post"), {
                drain: {},
                middleware: function(req, res, next) {
                    seen.push({ data: req.listenerCount("data"), readable: req.listenerCount("readable"), flowing: req.readableFlowing });
                    next();
                }
            });
            await supertest(RED.httpNode).post("/hook").send({ a: 1 }).expect(200);
            seen.should.eql([{ data: 0, readable: 0, flowing: null }]);
        });
        it("a request that waits in the authentication does not extend the wait of the drain, and gets 503 not_accepted after the stop", async function() {
            await load(flow("post"), { drain: {}, withAuth: true });
            const pending = supertest(RED.httpNode).post("/hook").send({ a: 1 }).then(res => res);
            await waitFor(() => held.length === 1, "the request to reach the authentication");
            const started = Date.now();
            await httpDrain.beforeStop();
            (Date.now() - started).should.be.below(1000);
            httpDrain.afterStop("full");
            const res = await pending;
            res.status.should.equal(503);
            res.body.code.should.equal("http_drain_not_accepted");
            res.headers["retry-after"].should.equal("1");
            received.length.should.equal(0);
        });
    });

    describe("a request that the drain already answered with 503", function() {
        it("is not sent into the flow when the authentication ends later (SEC-003)", async function() {
            await load(flow("post"), { drain: {}, withAuth: true });
            const pending = supertest(RED.httpNode).post("/hook").send({ a: 1 }).then(res => res);
            await waitFor(() => held.length === 1, "the request to reach the authentication");
            await httpDrain.beforeStop();
            httpDrain.afterStop("full");
            (await pending).status.should.equal(503);
            const node = helper.getNode("in");
            node.warn.resetHistory();
            // the authentication ends, the parsers read the body, the handler runs
            held[0].next();
            await flush();
            await flush();
            received.length.should.equal(0);
            node.warn.called.should.be.false();
            held[0].req[S].accepted.should.be.false();
        });
        it("does not send into the flow when the handler is called after the answer (callback)", async function() {
            await load(flow("post"));
            const node = helper.getNode("in");
            const send = node.send;
            send.resetHistory();
            const entry = { accepted: false, drained: true };
            node.callback({ [S]: entry, headers: {}, body: {} }, { [S]: entry });
            send.called.should.be.false();
            entry.accepted.should.be.false();
        });
        it("does not answer 500 to an error of the parser after the answer (errorHandler, no ERR_HTTP_HEADERS_SENT)", async function() {
            await load(flow("post"));
            const node = helper.getNode("in");
            node.warn.resetHistory();
            const res = { sendStatus: function() { throw new Error("must not be called") } };
            node.errorHandler(new Error("request aborted"), { [S]: { drained: true } }, res, function() {});
            node.warn.called.should.be.false();
        });
        it("an error of the parser answers 500 as before when the request was not answered by the drain", async function() {
            await load(flow("post"));
            const node = helper.getNode("in");
            node.warn.resetHistory();
            const res = { sendStatus: sinon.stub() };
            node.errorHandler(new Error("bad"), { [S]: { drained: false } }, res, function() {});
            res.sendStatus.calledWith(500).should.be.true();
            node.warn.calledOnce.should.be.true();
            const plain = { sendStatus: sinon.stub() };
            node.errorHandler(new Error("bad"), {}, plain, function() {});
            plain.sendStatus.calledWith(500).should.be.true();
        });
        it("an error of the parser after the answer reaches no response (integration)", async function() {
            await load(flow("post"), { drain: {}, withAuth: true });
            const pending = supertest(RED.httpNode).post("/hook").send({ a: 1 }).then(res => res);
            await waitFor(() => held.length === 1, "the request to reach the authentication");
            await httpDrain.beforeStop();
            httpDrain.afterStop("full");
            const res = await pending;
            res.status.should.equal(503);
            const node = helper.getNode("in");
            node.warn.resetHistory();
            held[0].next(new Error("failed after the answer"));
            await flush();
            node.warn.called.should.be.false();
            res.body.code.should.equal("http_drain_not_accepted");
        });
        it("http response drops a late response and does not write (SEC-005)", async function() {
            await load(flow("post"));
            const out = helper.getNode("out");
            const debug = out.debug;
            debug.resetHistory();
            const _res = { status: sinon.stub(), set: sinon.stub(), get: sinon.stub(), send: sinon.stub(), jsonp: sinon.stub(), [S]: { drained: true } };
            out.receive({ payload: "late", res: { _res } });
            await flush();
            _res.status.called.should.be.false();
            _res.send.called.should.be.false();
            debug.calledOnce.should.be.true();
            debug.firstCall.args[0].should.equal("httpin.errors.drained-response");
        });
        it("http response answers a request that has an entry and was not answered by the drain", async function() {
            await load(flow("post"), { drain: {}, silentSink: true });
            const pending = supertest(RED.httpNode).post("/hook").send({ a: 1 }).then(res => res);
            await waitFor(() => received.length === 1, "the message");
            helper.getNode("out").receive({ payload: "from the flow", res: received[0].res });
            const res = await pending;
            res.status.should.equal(200);
            res.text.should.equal("from the flow");
        });
        it("http response with a response that is not an http in response still warns as before", async function() {
            await load(flow("post"));
            const out = helper.getNode("out");
            const warn = out.warn;
            warn.resetHistory();
            out.receive({ payload: "x" });
            await flush();
            warn.calledOnce.should.be.true();
        });
    });

    describe("the request of a route with skipBodyParsing in rawBodyCapture", function() {
        it("is not waited for at the stop: it has no route yet, and after it the router answers 404, not nothing (the upload before the route)", async function() {
            await load(flow("post", { skipBodyParsing: true }), { drain: {} });
            const server = http.createServer(RED.httpNode);
            await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
            try {
                const answer = new Promise(function(resolve, reject) {
                    const req = http.request({ host: "127.0.0.1", port: server.address().port, path: "/hook", method: "POST", agent: false, headers: { "Content-Type": "application/octet-stream", "Content-Length": 20 } }, function(res) {
                        res.resume();
                        res.on("end", () => resolve(res.statusCode));
                    });
                    req.on("error", reject);
                    req.write("0123456789");
                    // the capture reads the body, the route is not matched yet
                    waitFor(() => httpDrain.size() === 1, "the request").then(async function() {
                        const started = Date.now();
                        // the stop: the node closes, its route is removed
                        await helper.unload();
                        (Date.now() - started).should.be.below(1000);
                        req.end("0123456789");
                    }).catch(reject);
                });
                (await answer).should.equal(404);
            } finally {
                server.close();
            }
        });
    });
});
