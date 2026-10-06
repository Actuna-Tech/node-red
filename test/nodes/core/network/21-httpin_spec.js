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
 *   #48: acceptance tests of the optional default size limit httpInMaxBodySize (formats, invalid values, the limit of the
 *   node, upload, routes without parsing, JSON and urlencoded, CORS, what the editor settings carry, node warnings)
 *   #48: acceptance tests of the cap of 1000 parts of an upload (with the setting httpInMaxBodySize or the field of the
 *   node) and of the limit of 100 for a number in brackets in the name of a multipart field (413 on every upload route)
 *   #48: acceptance tests of the limit of 8 for the nesting depth of the name of a multipart field (413 on every upload route)
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
    let registrations = [];
    let rendered = [];
    // a private copy of the settings module of the runtime that gets the node settings the module registers,
    // as the runtime does it, and exports them as GET /settings does (see newSettingsExport)
    let settingsExport = null;

    // The httpNode app is mounted on an outer app as in the runtime, where the
    // authentication of the nodes (httpNodeAuth) is on the outer app in front of it,
    // and a hold of the requests (#8) is the first layer of the httpNode app, before the
    // module of the node adds rawBodyCapture
    function httpInWrapper(_RED) {
        RED = _RED;
        // What the module of the node asks the runtime for (#48): the registrations of its types and the
        // messages it renders (key and parameters), for the tests of the settings
        const registerType = _RED.nodes.registerType;
        _RED.nodes.registerType = function(type, constructor, opts) {
            registrations.push({ type: type, opts: opts });
            if (settingsExport && type === "http in" && opts && opts.settings) {
                settingsExport.register(type, opts.settings);
            }
            return registerType.apply(this, arguments);
        };
        _RED._ = function(key, options) {
            rendered.push({ key: key, options: options });
            return key;
        };
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

    // settings: the settings of the runtime (for example apiMaxLength); tune: optional, called with the settings
    // object that the runtime reads, after helper.settings() has merged them (getters and proxies go there)
    async function load(nodes, settings, tune) {
        helper.settings(settings || {});
        if (tune) { tune(helper._settings) }
        if (settingsExport && !settingsExport.ready) { settingsExport.start(helper._settings) }
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

    // The path of the node settings to GET /settings, with the real settings module of the runtime in a private
    // copy: register() is what the registry does with the settings of a registered type, start() gives the
    // module the settings object that the runtime reads (settings.js), exported() is the body of GET /settings
    // that this module gives (a JSON text, as res.json writes it)
    function newSettingsExport() {
        const file = require("nr-test-utils").resolve("@node-red/runtime/lib/settings.js");
        const cached = require.cache[file];
        delete require.cache[file];
        let copy;
        try {
            copy = require(file);
        } finally {
            if (cached) { require.cache[file] = cached } else { delete require.cache[file] }
        }
        const entry = {
            ready: false,
            errors: [],
            start: function(localSettings) {
                copy.init(localSettings);
                entry.ready = true;
            },
            register: function(type, opts) {
                try { copy.registerNodeSettings(type, opts) } catch (err) { entry.errors.push(err.message) }
            },
            exported: function() {
                return JSON.parse(JSON.stringify(copy.exportNodeSettings({ httpNodeRoot: "/" })));
            }
        };
        return entry;
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
        registrations = [];
        rendered = [];
        settingsExport = null;
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

    // Helpers of the tests of the size limits of the text bodies (#48)
    const MAX = require("buffer").constants.MAX_STRING_LENGTH;
    // a status line of a correct answer is there within this time; a request that is not
    // answered is closed by the client after it
    const ANSWER_BOUND = 1000;
    const KIB = Buffer.alloc(1024, 0x61);
    // the event name of an error that no handler took
    const STRAY_EVENT = "uncaughtException";

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

    // #48: a text body above the maximum string length of Node.js, the limits given to the JSON and
    // urlencoded parsers, and a response that another layer already sent
    describe("text body above the maximum string length (#48)", function() {
        const path = require("path");
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
                for (let sent = 0; sent < MAX + 65 * MIB; sent += MIB) { chunks.push(chunk) }
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
                "1gb", 1e9, Infinity, "+1gb", "600000000abc"
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
                "1gb", 1e9, Infinity, "+1gb", "600000000abc", " 600000000", "1gb ", "1 GB",
                "1\tgb", "0x40000000", "1.5pb", 1e400, 10n, {}, true, "5mb", "+5mb", "1e9", -1, -Infinity, "abc",
                "1tb", "0.5gb", "512mb", "511mb", MAX, MAX + 1, MAX + "b", (MAX + 1) + "b", String(MAX), String(MAX + 1)
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
                    await load([["a", { skipBodyParsing: false }]], { apiMaxLength: "1gb" });
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

    // The optional default size limit of the setting httpInMaxBodySize (#48, part 2)
    describe("default size limit of the setting httpInMaxBodySize (#48, part 2)", function() {
        const SETTING = "httpInMaxBodySize";
        const FLAG = "httpInMaxBodySizeEnabled";
        const OCTET = { "Content-Type": "application/octet-stream" };
        const PLAIN = { "Content-Type": "text/plain" };
        const NO_OPTIONS = { skipBodyParsing: false };
        const UPLOAD = { skipBodyParsing: false, upload: true };
        const ORIGIN = { Origin: "http://example.test" };
        const MIB = 1024 * 1024;
        const BASE_EXPORT = { httpNodeRoot: "/" };

        // The first answer of one request with a body of `size` bytes: its status code, or a text when there is
        // none. options: method, chunked (no Content-Length), bound (ms)
        async function answer(urlPath, headers, size, options) {
            const chunked = !!(options && options.chunked);
            const chunks = [];
            if (chunked) {
                for (let left = size; left > 0; left -= 512) { chunks.push(Buffer.alloc(Math.min(512, left), 0x61)) }
            } else {
                chunks.push(Buffer.alloc(size, 0x61));
            }
            const sent = Object.assign({}, headers, chunked ? { "Transfer-Encoding": "chunked" } : { "Content-Length": String(size) });
            const res = await exchange((options && options.method) || "POST", urlPath, sent, chunks, { bound: (options && options.bound) || 10000 });
            if (options && options.full) { return res }
            return res.settled ? (res.statusCode || res.error) : "no status line within " + ANSWER_BOUND + " ms";
        }

        function logged(key) {
            return helper.log().args.filter(function(args) { return args[0] && args[0].msg === key });
        }

        // every warning about a size that the node module wrote
        function sizeLogged() {
            return helper.log().args.filter(function(args) {
                return args[0] && typeof args[0].msg === "string" && /max-body-size/.test(args[0].msg);
            });
        }

        // the parameters of the message `key` as the module asked the runtime to render it
        function renderedWith(key) {
            return rendered.filter(function(entry) { return entry.key === key });
        }

        async function loadExporting(nodes, settings, tune) {
            settingsExport = newSettingsExport();
            await load(nodes, settings, tune);
        }

        async function stop() {
            server.closeAllConnections();
            await new Promise(function(resolve) { server.close(resolve) });
            server = null;
            await helper.unload();
            RED.httpNode.parent = undefined;
        }

        function label(value) {
            if (typeof value === "string") { return JSON.stringify(value.length > 20 ? value.slice(0, 20) + "..." : value) }
            if (typeof value === "symbol") { return "a symbol" }
            return typeof value === "object" && value !== null ? "an object" : typeof value + " " + String(value);
        }

        describe("AC-20: the setting absent or falsy changes nothing", function() {
            [["absent", undefined], ["null", null], ["false", false], ["0", 0], ["an empty text", ""], ["NaN", NaN]].forEach(function(entry) {
                it("AC-20: " + entry[0] + ": a large binary body is accepted, an upload without a limit of the node is not limited, no warning, nothing exported", async function() {
                    const settings = { apiMaxLength: "1kb" };
                    if (entry[0] !== "absent") { settings[SETTING] = entry[1] }
                    await loadExporting([["a", NO_OPTIONS], ["b", Object.assign({ url: "/up" }, UPLOAD)]], settings);
                    // the body of a plain route has no limit as before (the raw limit is of the other routes)
                    (await answer("/hook", OCTET, 6 * MIB)).should.equal(200);
                    await upload("/up", 4096).expect(200);
                    received.should.have.length(2);
                    received[1].msg.req.files[0].size.should.equal(4096);
                    sizeLogged().should.eql([]);
                    settingsExport.exported().should.eql(BASE_EXPORT);
                });
            });

            it("AC-20: the absent setting registers no exported setting", async function() {
                await loadExporting([["a", NO_OPTIONS]], {});
                const own = registrations.filter(function(entry) { return entry.type === "http in" });
                own.should.have.length(1);
                // no settings, or an empty set that replaces an earlier registration
                should(own[0].opts === undefined || own[0].opts.settings === undefined || Object.keys(own[0].opts.settings).length === 0).be.true();
                settingsExport.errors.should.eql([]);
            });
        });

        describe("AC-21: the formats of the setting", function() {
            [2048, "2kb", " 2 KB ", "2048b", "2048"].forEach(function(value) {
                it("AC-21: " + label(value) + " limits a node without options: 2000 bytes are accepted, 2100 get 413", async function() {
                    await load([["a", NO_OPTIONS]], { [SETTING]: value });
                    (await answer("/hook", OCTET, 2000)).should.equal(200);
                    (await answer("/hook", OCTET, 2100)).should.equal(413);
                    received.should.have.length(1);
                    logged("httpin.errors.invalid-max-body-size-setting").should.have.length(0);
                });
            });

            it("AC-21: \"0.5kb\": 500 bytes are accepted, 600 get 413", async function() {
                await load([["a", NO_OPTIONS]], { [SETTING]: "0.5kb" });
                (await answer("/hook", OCTET, 500)).should.equal(200);
                (await answer("/hook", OCTET, 600)).should.equal(413);
            });

            it("AC-21: the limit is the given number of bytes: the body of that size is accepted, one byte more gets 413", async function() {
                await load([["a", NO_OPTIONS]], { [SETTING]: 2048 });
                (await answer("/hook", OCTET, 2048)).should.equal(200);
                (await answer("/hook", OCTET, 2049)).should.equal(413);
            });

            ["1tb", "1pb", "2 PB"].forEach(function(value) {
                it("AC-21: the units up to pb are valid: " + label(value) + " is no invalid value and is exported as enabled", async function() {
                    await loadExporting([["a", NO_OPTIONS]], { [SETTING]: value });
                    logged("httpin.errors.invalid-max-body-size-setting").should.have.length(0);
                    settingsExport.exported().should.eql(Object.assign({ [FLAG]: true }, BASE_EXPORT));
                    (await answer("/hook", OCTET, 4096)).should.equal(200);
                });
            });
        });

        describe("AC-22: a setting that is not a size is ignored with one warning", function() {
            const hostile = function() { throw new Error("hostile value") };
            const traps = {};
            ["get", "set", "has", "ownKeys", "getPrototypeOf", "getOwnPropertyDescriptor", "defineProperty", "deleteProperty"].forEach(function(trap) { traps[trap] = hostile });
            const throwing = { toJSON: hostile, toString: hostile, valueOf: hostile };
            // [label, a function that puts the value on the settings object that the runtime reads, what the
            // warning may show: a text (a string or number is cut to 32 characters), or null when it is not checked]
            const ODD = [
                ["a text that is not a size", "abc"],
                ["a negative number", -1],
                ["\"0\"", "0"],
                ["an exponent", "1e3"],
                ["a leading plus", "+1kb"],
                ["an empty object", {}],
                ["an empty array", []],
                ["Infinity", Infinity],
                ["a bigint", 10n],
                ["a symbol", Symbol("size")],
                ["an object without a prototype", Object.create(null)],
                ["an object with toJSON and toString that throw", throwing],
                ["a text of 40000 characters", "1" + " ".repeat(40000) + "x"],
                ["a proxy with traps that throw", new Proxy({}, traps)]
            ];

            function expectedRendering(value) {
                if (typeof value === "string") { return value.slice(0, 32) }
                if (typeof value === "number") { return value }
                return typeof value;
            }

            function checkWarningText(value) {
                const calls = renderedWith("httpin.errors.invalid-max-body-size-setting");
                calls.should.have.length(1);
                const shown = calls[0].options ? Object.keys(calls[0].options).map(function(k) { return calls[0].options[k] }) : [];
                shown.forEach(function(item) {
                    // nothing that is not a string or a number reaches the text of the warning
                    ["string", "number"].should.containEql(typeof item);
                    (calls[0].key + " " + item).length.should.be.below(200);
                });
                if (value !== undefined) {
                    const expected = expectedRendering(value);
                    should(shown.some(function(item) { return item === expected || (typeof expected === "number" && item === String(expected)) })).be.true();
                }
            }

            ODD.forEach(function(entry) {
                it("AC-22: " + entry[0] + ": one warning, the setting is ignored, the editor settings are as without it", async function() {
                    const start = Date.now();
                    await loadExporting([["a", NO_OPTIONS], ["b", { url: "/b", skipBodyParsing: false }], ["c", { url: "/c", skipBodyParsing: false }]], {}, function(settings) {
                        settings[SETTING] = entry[1];
                    });
                    (Date.now() - start).should.be.below(1000);
                    logged("httpin.errors.invalid-max-body-size-setting").should.have.length(1);
                    checkWarningText(entry[1]);
                    (await answer("/hook", OCTET, 6 * MIB)).should.equal(200);
                    settingsExport.exported().should.eql(BASE_EXPORT);
                    settingsExport.errors.should.eql([]);
                });
            });

            it("AC-22: a getter of the setting that throws: one warning, the setting is ignored, the editor settings are as without it", async function() {
                const start = Date.now();
                await loadExporting([["a", NO_OPTIONS], ["b", { url: "/b", skipBodyParsing: false }], ["c", { url: "/c", skipBodyParsing: false }]], {}, function(settings) {
                    Object.defineProperty(settings, SETTING, { configurable: true, enumerable: true, get: hostile });
                });
                (Date.now() - start).should.be.below(1000);
                logged("httpin.errors.invalid-max-body-size-setting").should.have.length(1);
                checkWarningText(undefined);
                (await answer("/hook", OCTET, 6 * MIB)).should.equal(200);
                settingsExport.exported().should.eql(BASE_EXPORT);
            });

            it("AC-22: a getter of the setting that throws on every read after the first one still gives one warning", async function() {
                let reads = 0;
                await loadExporting([["a", NO_OPTIONS], ["b", { url: "/b", skipBodyParsing: false }]], {}, function(settings) {
                    Object.defineProperty(settings, SETTING, { configurable: true, enumerable: true, get: function() {
                        reads += 1;
                        if (reads > 1) { throw new Error("hostile value") }
                        return "abc";
                    } });
                });
                logged("httpin.errors.invalid-max-body-size-setting").should.have.length(1);
                (await answer("/hook", OCTET, 6 * MIB)).should.equal(200);
            });
        });

        describe("AC-23: a setting or a node limit above the maximum string length", function() {
            it("AC-23: a setting above it applies, with one warning, and a small body is accepted", async function() {
                await load([["a", NO_OPTIONS], ["b", { url: "/b", skipBodyParsing: false }]], { [SETTING]: "1gb" });
                logged("httpin.errors.large-max-body-size-setting").should.have.length(1);
                logged("httpin.errors.invalid-max-body-size-setting").should.have.length(0);
                (await answer("/hook", OCTET, 1024)).should.equal(200);
            });

            it("AC-23: a limit of the node above it, without the setting: one warning per node, no warning about an invalid size", async function() {
                await load([["a", { maxBodySize: "1gb" }], ["b", { url: "/b", maxBodySize: "1gb" }]]);
                logged("httpin.errors.large-max-body-size").should.have.length(2);
                logged("httpin.errors.invalid-max-body-size").should.have.length(0);
                logged("httpin.errors.large-max-body-size-setting").should.have.length(0);
            });

            it("AC-23: a limit of the node above it on a node with an upload: one warning", async function() {
                await load([["a", Object.assign({ maxBodySize: "1gb" }, UPLOAD)]]);
                logged("httpin.errors.large-max-body-size").should.have.length(1);
            });

            it("AC-23: a limit of the node below it: no warning", async function() {
                await load([["a", { maxBodySize: "8mb" }]], { [SETTING]: "50mb" });
                logged("httpin.errors.large-max-body-size").should.have.length(0);
                logged("httpin.errors.large-max-body-size-setting").should.have.length(0);
            });
        });

        describe("AC-24: the setting limits a node without options", function() {
            [
                ["POST", "post"], ["PUT", "put"], ["PATCH", "patch"], ["DELETE", "delete"]
            ].forEach(function(entry) {
                it("AC-24: " + entry[0] + ": binary bodies above the limit get 413 (declared and chunked), below it are accepted as a Buffer", async function() {
                    await load([["a", { skipBodyParsing: false, method: entry[1] }]], { [SETTING]: "1kb" });
                    (await answer("/hook", OCTET, 2048, { method: entry[0] })).should.equal(413);
                    (await answer("/hook", OCTET, 4096, { method: entry[0], chunked: true })).should.equal(413);
                    received.should.have.length(0);
                    (await answer("/hook", OCTET, 1000, { method: entry[0] })).should.equal(200);
                    received.should.have.length(1);
                    Buffer.isBuffer(received[0].msg.payload).should.be.true();
                    received[0].msg.payload.length.should.equal(1000);
                });
            });

            it("AC-24: text bodies above the limit get 413, below it are accepted as a string", async function() {
                await load([["a", NO_OPTIONS]], { [SETTING]: "1kb" });
                (await answer("/hook", PLAIN, 2048)).should.equal(413);
                (await answer("/hook", PLAIN, 4096, { chunked: true })).should.equal(413);
                (await answer("/hook", {}, 2048)).should.equal(413);
                received.should.have.length(0);
                (await answer("/hook", PLAIN, 1000)).should.equal(200);
                received.should.have.length(1);
                received[0].msg.payload.should.equal("a".repeat(1000));
            });

            it("AC-24: other binary types, and text with a Content-Encoding, are limited by their bytes", async function() {
                await load([["a", NO_OPTIONS]], { [SETTING]: "1kb" });
                (await answer("/hook", { "Content-Type": "image/png" }, 2048)).should.equal(413);
                (await answer("/hook", { "Content-Type": "application/cbor" }, 2048)).should.equal(413);
                (await answer("/hook", { "Content-Type": "application/xml" }, 2048)).should.equal(413);
                (await answer("/hook", { "Content-Type": "text/plain", "Content-Encoding": "gzip" }, 2048)).should.equal(413);
                received.should.have.length(0);
            });

            it("AC-24: a 413 writes no log line", async function() {
                await load([["a", NO_OPTIONS]], { [SETTING]: "1kb" });
                const before = helper.log().args.length;
                (await answer("/hook", OCTET, 2048)).should.equal(413);
                helper.log().args.slice(before).should.eql([]);
            });

            it("AC-24: the 413 is the same answer as the other 413 of the node", async function() {
                await load([["a", NO_OPTIONS]], { [SETTING]: "1kb" });
                const res = await answer("/hook", OCTET, 2048, { full: true });
                res.should.have.property("statusCode", 413);
                res.headers["content-type"].should.equal("text/plain; charset=utf-8");
                res.headers["content-length"].should.equal("17");
                res.body.should.equal("Payload Too Large");
            });
        });

        describe("AC-25: the limit of the node raises or lowers the setting on a node without options", function() {
            it("AC-25: a higher limit of the node raises it", async function() {
                await load([["a", Object.assign({ maxBodySize: "8kb" }, NO_OPTIONS)]], { [SETTING]: "1kb" });
                (await answer("/hook", OCTET, 4096)).should.equal(200);
                (await answer("/hook", OCTET, 9 * 1024)).should.equal(413);
            });

            it("AC-25: a lower limit of the node lowers it", async function() {
                await load([["a", Object.assign({ maxBodySize: "1kb" }, NO_OPTIONS)]], { [SETTING]: "8kb" });
                (await answer("/hook", OCTET, 2048)).should.equal(413);
                (await answer("/hook", OCTET, 1000)).should.equal(200);
            });

            it("AC-25: the same for text", async function() {
                await load([["a", Object.assign({ maxBodySize: "8kb" }, NO_OPTIONS)], ["b", Object.assign({ url: "/b", maxBodySize: "1kb" }, NO_OPTIONS)]], { [SETTING]: "4kb" });
                (await answer("/hook", PLAIN, 6 * 1024)).should.equal(200);
                (await answer("/hook", PLAIN, 9 * 1024)).should.equal(413);
                (await answer("/b", PLAIN, 2048)).should.equal(413);
            });
        });

        describe("AC-26: without the setting the limit of a node without options is ignored", function() {
            it("AC-26: 4 KiB are accepted and nothing is logged about the size", async function() {
                await load([["a", Object.assign({ maxBodySize: "1kb" }, NO_OPTIONS)]]);
                (await answer("/hook", OCTET, 4096)).should.equal(200);
                sizeLogged().should.eql([]);
            });

            it("AC-26: a stale hidden value is ignored without a warning, whatever it is", async function() {
                await load([["a", Object.assign({ maxBodySize: "abc" }, NO_OPTIONS)], ["b", Object.assign({ url: "/b", maxBodySize: "1gb" }, NO_OPTIONS)]]);
                (await answer("/hook", OCTET, 4096)).should.equal(200);
                (await answer("/b", OCTET, 4096)).should.equal(200);
                sizeLogged().should.eql([]);
            });
        });

        describe("AC-27: an invalid limit of the node with the setting", function() {
            it("AC-27: one warning of the node, the setting is the limit", async function() {
                await load([["a", Object.assign({ maxBodySize: "abc" }, NO_OPTIONS)]], { [SETTING]: "1kb" });
                logged("httpin.errors.invalid-max-body-size").should.have.length(1);
                (await answer("/hook", OCTET, 2048)).should.equal(413);
                (await answer("/hook", OCTET, 1000)).should.equal(200);
            });
        });

        describe("AC-28: the setting on a node with an upload", function() {
            it("AC-28: the whole body of many small files above the setting gets 413, a few files are accepted", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "100kb" });
                let req = supertest(server).post("/hook");
                for (let i = 0; i < 200; i++) { req = req.attach("f" + i, Buffer.alloc(1024, 0x61), "f" + i + ".bin") }
                await req.expect(413);
                received.should.have.length(0);
                req = supertest(server).post("/hook");
                for (let i = 0; i < 10; i++) { req = req.attach("f" + i, Buffer.alloc(1024, 0x61), "f" + i + ".bin") }
                await req.expect(200);
                received[0].msg.req.files.should.have.length(10);
            });

            it("AC-28: a chunked upload above the setting gets 413, a chunked upload within it is accepted", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "100kb" });
                const res = await request("/hook", Object.assign({ "Transfer-Encoding": "chunked" }, MULTIPART), multipartChunks(300, 1024));
                res.statusCode.should.equal(413);
                received.should.have.length(0);
                const ok = await request("/hook", Object.assign({ "Transfer-Encoding": "chunked" }, MULTIPART), multipartChunks(10, 1024));
                ok.statusCode.should.equal(200);
                received[0].msg.req.files.should.have.length(10);
            });

            it("AC-28: a higher limit of the node raises the setting", async function() {
                await load([["a", Object.assign({ maxBodySize: "8mb" }, UPLOAD)]], { [SETTING]: "1kb" });
                await upload("/hook", 4096).expect(200);
                received[0].msg.req.files[0].size.should.equal(4096);
            });

            it("AC-28: a lower limit of the node lowers the setting", async function() {
                await load([["a", Object.assign({ maxBodySize: "1kb" }, UPLOAD)]], { [SETTING]: "8mb" });
                await upload("/hook", 4096).expect(413);
                received.should.have.length(0);
            });

            it("AC-28: a file within the setting is accepted with its content", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "8kb" });
                await upload("/hook", 500).expect(200);
                received[0].msg.req.files[0].size.should.equal(500);
            });
        });

        describe("AC-29: a body of an upload route that is not multipart", function() {
            it("AC-29: without the setting it is not limited by the limit of the node (as before)", async function() {
                await load([["a", Object.assign({ maxBodySize: "1kb" }, UPLOAD)]]);
                (await answer("/hook", PLAIN, 5000)).should.equal(200);
                (await answer("/hook", OCTET, 5000)).should.equal(200);
            });
        });

        describe("AC-30: the setting is the default of a Do not parse route", function() {
            it("AC-30: it replaces apiMaxLength: 6 KiB are accepted and 9 KiB get 413", async function() {
                await load([["a"], ["b", { url: "/p/:id" }]], { apiMaxLength: "1kb", [SETTING]: "8kb" });
                (await answer("/hook", OCTET, 6 * 1024)).should.equal(200);
                (await answer("/hook", OCTET, 9 * 1024)).should.equal(413);
                (await answer("/p/1", OCTET, 6 * 1024)).should.equal(200);
                (await answer("/p/1", OCTET, 9 * 1024)).should.equal(413);
            });

            it("AC-30: a lower setting limits the route read by the capture and the route read by the fallback", async function() {
                await load([["a"], ["b", { url: "/p/:id" }]], { [SETTING]: "1kb" });
                (await answer("/hook", OCTET, 2048)).should.equal(413);
                (await answer("/p/1", OCTET, 2048)).should.equal(413);
                (await answer("/hook", OCTET, 1000)).should.equal(200);
                (await answer("/p/1", OCTET, 1000)).should.equal(200);
                received.should.have.length(2);
            });

            [-1, 0, "0"].forEach(function(value) {
                it("AC-30: apiMaxLength " + label(value) + " is not read when the setting is valid: no warning about it", async function() {
                    await load([["a"], ["b", { url: "/b", skipBodyParsing: false, upload: true }]], { apiMaxLength: value, [SETTING]: "1kb" });
                    logged("httpin.errors.invalid-api-max-length").should.have.length(0);
                    (await answer("/hook", OCTET, 2048)).should.equal(413);
                });
            });

            it("AC-30: a limit of the node on the route is the limit of the node", async function() {
                await load([["a", { maxBodySize: "8kb" }]], { apiMaxLength: "1kb", [SETTING]: "2kb" });
                (await answer("/hook", OCTET, 6 * 1024)).should.equal(200);
                (await answer("/hook", OCTET, 9 * 1024)).should.equal(413);
            });
        });

        describe("AC-31: JSON and urlencoded bodies are not limited by the setting or by the limit of the node", function() {
            it("AC-31: a tiny setting and a tiny limit of the node leave small JSON and urlencoded bodies accepted as objects", async function() {
                await load([["a", Object.assign({ maxBodySize: "4b" }, NO_OPTIONS)]], { [SETTING]: "4b" });
                const json = await exchange("POST", "/hook", { "Content-Type": "application/json" }, [Buffer.from('{"a": 1}')]);
                json.should.have.property("statusCode", 200);
                const form = await exchange("POST", "/hook", { "Content-Type": "application/x-www-form-urlencoded" }, [Buffer.from("a=1&b=2")]);
                form.should.have.property("statusCode", 200);
                received[received.length - 2].msg.payload.should.eql({ a: 1 });
                received[received.length - 1].msg.payload.should.eql({ a: "1", b: "2" });
            });

            it("AC-31: a large setting does not raise the limit of the JSON parser (apiMaxLength, 5mb by default): a body above that limit gets 500", async function() {
                await load([["a", NO_OPTIONS]], { [SETTING]: "50mb" });
                const body = Buffer.from(JSON.stringify({ a: "x".repeat(6 * MIB) }));
                const res = await exchange("POST", "/hook", { "Content-Type": "application/json", "Content-Length": String(body.length) }, [body], { bound: 10000 });
                res.should.have.property("statusCode", 500);
                received.should.have.length(0);
            });
        });

        describe("AC-32: a GET node", function() {
            it("AC-32: the limit of the node is ignored without a warning, a query is served", async function() {
                await load([["a", { method: "get", skipBodyParsing: false, maxBodySize: "abc" }], ["b", { url: "/b", method: "get", skipBodyParsing: false, maxBodySize: "1gb" }]], { [SETTING]: "1kb" });
                sizeLogged().should.eql([]);
                await supertest(server).get("/hook?x=1").expect(200);
                await supertest(server).get("/b?x=1").expect(200);
                received.should.have.length(2);
                received[0].msg.payload.should.eql({ x: "1" });
            });
        });

        describe("AC-33: two nodes without options on one route", function() {
            it("AC-33: the limit of the first node applies", async function() {
                await load([["a", Object.assign({ maxBodySize: "1kb" }, NO_OPTIONS)], ["b", Object.assign({ maxBodySize: "10kb" }, NO_OPTIONS)]], { [SETTING]: "100kb" });
                (await answer("/hook", OCTET, 2048)).should.equal(413);
                received.should.have.length(0);
                (await answer("/hook", OCTET, 500)).should.equal(200);
                received[0].id.should.equal("a");
            });
        });

        describe("AC-34: the 413 of the setting carries the CORS headers", function() {
            const CORS = { httpNodeCors: { origin: "*" } };

            it("AC-34: binary and text bodies of a node without options", async function() {
                await load([["a", NO_OPTIONS], ["b", { url: "/p/:id", skipBodyParsing: false }]], Object.assign({ [SETTING]: "1kb" }, CORS));
                const seen = {};
                for (const entry of [["binary", OCTET], ["text", PLAIN]]) {
                    for (const urlPath of ["/hook", "/p/1"]) {
                        const res = await answer(urlPath, Object.assign({}, entry[1], ORIGIN), 2048, { full: true });
                        seen[entry[0] + " " + urlPath] = [res.statusCode, res.headers && res.headers["access-control-allow-origin"]];
                    }
                }
                seen.should.eql({
                    "binary /hook": [413, "*"], "binary /p/1": [413, "*"], "text /hook": [413, "*"], "text /p/1": [413, "*"]
                });
            });

            it("AC-34: a Do not parse node (the capture)", async function() {
                await load([["a"]], Object.assign({ [SETTING]: "1kb" }, CORS));
                const res = await answer("/hook", Object.assign({}, OCTET, ORIGIN), 2048, { full: true });
                [res.statusCode, res.headers["access-control-allow-origin"]].should.eql([413, "*"]);
            });

            it("AC-34: an upload, declared and chunked", async function() {
                await load([["a", UPLOAD]], Object.assign({ [SETTING]: "1kb" }, CORS));
                const chunks = multipartChunks(1, 2048);
                const length = String(Buffer.concat(chunks).length);
                const declaredRes = await exchange("POST", "/hook", Object.assign({ "Content-Length": length }, MULTIPART, ORIGIN), chunks, { bound: 10000 });
                const chunkedRes = await exchange("POST", "/hook", Object.assign({ "Transfer-Encoding": "chunked" }, MULTIPART, ORIGIN), chunks, { bound: 10000 });
                [declaredRes, chunkedRes].map(function(res) {
                    return [res.statusCode, res.headers && res.headers["access-control-allow-origin"]];
                }).should.eql([[413, "*"], [413, "*"]]);
            });
        });

        describe("AC-35: what GET /settings tells the editor", function() {
            ["50mb", 2048, "2kb"].forEach(function(value) {
                it("AC-35: a valid setting " + label(value) + " is exported only as the flag, never as its value", async function() {
                    await loadExporting([["a", NO_OPTIONS]], { [SETTING]: value });
                    const exported = settingsExport.exported();
                    exported.should.eql(Object.assign({ [FLAG]: true }, BASE_EXPORT));
                    exported.should.not.have.property(SETTING);
                    settingsExport.errors.should.eql([]);
                });

                it("AC-35: a valid setting " + label(value) + " registers exactly the exportable flag with the value true", async function() {
                    await loadExporting([["a", NO_OPTIONS]], { [SETTING]: value });
                    const own = registrations.filter(function(entry) { return entry.type === "http in" });
                    own.should.have.length(1);
                    should(own[0].opts && own[0].opts.settings).be.an.Object();
                    own[0].opts.settings.should.eql({ [FLAG]: { value: true, exportable: true } });
                    // the registry takes the names: none is refused, so nothing is logged about a registration
                    helper.log().args.filter(function(args) {
                        return args[0] && /invalid property/i.test(String(args[0].msg));
                    }).should.eql([]);
                });
            });

            ["abc", "0", -1, "1e3"].forEach(function(value) {
                it("AC-35: an invalid setting " + label(value) + " exports neither key", async function() {
                    await loadExporting([["a", NO_OPTIONS]], { [SETTING]: value });
                    settingsExport.exported().should.eql(BASE_EXPORT);
                    const own = registrations.filter(function(entry) { return entry.type === "http in" });
                    should(own[0].opts === undefined || own[0].opts.settings === undefined || Object.keys(own[0].opts.settings).length === 0).be.true();
                });
            });

            it("AC-35 (R2-01): a valid setting followed by an absent one in the same run leaves no flag", async function() {
                await loadExporting([["a", NO_OPTIONS]], { [SETTING]: "50mb" });
                settingsExport.exported().should.eql(Object.assign({ [FLAG]: true }, BASE_EXPORT));
                await stop();
                await load([["a", NO_OPTIONS]], {});
                settingsExport.exported().should.eql(BASE_EXPORT);
            });

            it("AC-35 (R2-01): a valid setting followed by an invalid one in the same run leaves no flag", async function() {
                await loadExporting([["a", NO_OPTIONS]], { [SETTING]: "50mb" });
                settingsExport.exported().should.eql(Object.assign({ [FLAG]: true }, BASE_EXPORT));
                await stop();
                await load([["a", NO_OPTIONS]], { [SETTING]: "abc" });
                settingsExport.exported().should.eql(BASE_EXPORT);
            });

            it("AC-35 (R2-01): an absent setting followed by a valid one in the same run gets the flag", async function() {
                await loadExporting([["a", NO_OPTIONS]], {});
                settingsExport.exported().should.eql(BASE_EXPORT);
                await stop();
                await load([["a", NO_OPTIONS]], { [SETTING]: "50mb" });
                settingsExport.exported().should.eql(Object.assign({ [FLAG]: true }, BASE_EXPORT));
            });
        });

        describe("AC-36: a limit of the node above the setting", function() {
            it("AC-36: one warning per node (no options, upload, Do not parse), and the limit of the node applies", async function() {
                await load([
                    ["a", Object.assign({ maxBodySize: "8kb" }, NO_OPTIONS)],
                    ["b", Object.assign({ url: "/up", maxBodySize: "8kb" }, UPLOAD)],
                    ["c", { url: "/raw", maxBodySize: "8kb" }]
                ], { [SETTING]: "1kb" });
                logged("httpin.errors.max-body-size-above-default").should.have.length(3);
                (await answer("/hook", OCTET, 4096)).should.equal(200);
                (await answer("/raw", OCTET, 4096)).should.equal(200);
                await upload("/up", 4096).expect(200);
            });

            it("AC-36: the warning carries the limit of the node and the setting", async function() {
                await load([["a", Object.assign({ maxBodySize: "8kb" }, NO_OPTIONS)]], { [SETTING]: "1kb" });
                const calls = renderedWith("httpin.errors.max-body-size-above-default");
                calls.should.have.length(1);
                const shown = Object.keys(calls[0].options || {}).map(function(k) { return String(calls[0].options[k]) });
                shown.some(function(text) { return text.indexOf("8kb") !== -1 }).should.be.true();
                shown.some(function(text) { return text.indexOf("1kb") !== -1 || text.indexOf("1024") !== -1 }).should.be.true();
            });

            it("AC-36: a limit of the node below the setting, equal to it, or without a setting: no such warning", async function() {
                await load([
                    ["a", Object.assign({ maxBodySize: "512b" }, NO_OPTIONS)],
                    ["b", Object.assign({ url: "/b", maxBodySize: "1kb" }, NO_OPTIONS)]
                ], { [SETTING]: "1kb" });
                logged("httpin.errors.max-body-size-above-default").should.have.length(0);
            });

            it("AC-36: without the setting there is no such warning", async function() {
                await load([["a", { maxBodySize: "8kb" }], ["b", Object.assign({ url: "/b", maxBodySize: "8kb" }, NO_OPTIONS)]]);
                logged("httpin.errors.max-body-size-above-default").should.have.length(0);
            });

            it("AC-36: a node that does not use its limit (a GET node) gives no such warning", async function() {
                await load([["a", { method: "get", skipBodyParsing: false, maxBodySize: "8kb" }]], { [SETTING]: "1kb" });
                logged("httpin.errors.max-body-size-above-default").should.have.length(0);
            });
        });

        describe("a value shown in a warning is shown in a safe form (#48)", function() {
            // the form that a warning gets for a text: at most 32 characters, every character outside
            // [0-9A-Za-z .+-] replaced by "?"
            const FORMAT_CHARACTERS = "$t(";

            // the options of the only rendering of the message `key`, with the time the load took
            async function loadTimed(nodes, settings) {
                const start = Date.now();
                await load(nodes, settings);
                (Date.now() - start).should.be.below(1000);
            }

            function shownOf(key) {
                const calls = renderedWith(key);
                calls.should.have.length(1);
                return calls[0].options.value;
            }

            it("a setting with characters of the message format is shown in a safe form", async function() {
                await loadTimed([["a", NO_OPTIONS]], { [SETTING]: "x" + FORMAT_CHARACTERS });
                logged("httpin.errors.invalid-max-body-size-setting").should.have.length(1);
                shownOf("httpin.errors.invalid-max-body-size-setting").should.equal("x?t?");
                (await answer("/hook", OCTET, 1024)).should.equal(200);
                received.should.have.length(1);
            });

            it("a limit of a node with characters of the message format, cut to 32 characters, is shown in a safe form", async function() {
                await loadTimed([["a", Object.assign({ maxBodySize: FORMAT_CHARACTERS + "a".repeat(29) }, NO_OPTIONS)]], { [SETTING]: "1kb" });
                logged("httpin.errors.invalid-max-body-size").should.have.length(1);
                shownOf("httpin.errors.invalid-max-body-size").should.equal("?t?" + "a".repeat(29));
                (await answer("/hook", OCTET, 1000)).should.equal(200);
                (await answer("/hook", OCTET, 2048)).should.equal(413);
            });

            it("a limit of a node longer than 32 characters is cut before it is shown", async function() {
                await loadTimed([["a", Object.assign({ maxBodySize: FORMAT_CHARACTERS + "a".repeat(100) }, NO_OPTIONS)]], { [SETTING]: "1kb" });
                shownOf("httpin.errors.invalid-max-body-size").should.equal("?t?" + "a".repeat(29));
            });

            it("an apiMaxLength with characters of the message format is shown in a safe form on a Do not parse node", async function() {
                // a leading number, so that the body parsers take the value and the node starts
                await loadTimed([["a"]], { apiMaxLength: "1" + FORMAT_CHARACTERS });
                logged("httpin.errors.invalid-api-max-length").should.have.length(1);
                shownOf("httpin.errors.invalid-api-max-length").should.equal("1?t?");
                (await answer("/hook", OCTET, 1024)).should.equal(200);
                received.should.have.length(1);
            });

            it("an apiMaxLength that is the same text without a leading number: the module loads and the warning shows the safe form", async function() {
                // the body parsers refuse such a value, so the node itself does not start: no request is sent
                await loadTimed([["a"]], { apiMaxLength: "x" + FORMAT_CHARACTERS });
                logged("httpin.errors.invalid-api-max-length").should.have.length(1);
                shownOf("httpin.errors.invalid-api-max-length").should.equal("x?t?");
            });

            [
                ["a letter with an accent", "zażółć", "za????"],
                ["a line break and a tab", "a\nb\tc", "a?b?c"],
                ["braces, quotes, a percent sign and a backslash", "{a}\"'%\\", "?a?????"],
                ["the characters that are allowed", "1.5 +-Zz9", "1.5 +-Zz9"]
            ].forEach(function(entry) {
                it("the setting shows " + entry[0] + " in a safe form", async function() {
                    await loadTimed([["a", NO_OPTIONS]], { [SETTING]: entry[1] + "!" });
                    shownOf("httpin.errors.invalid-max-body-size-setting").should.equal(entry[2] + "?");
                });
            });

            it("a number is shown as it is, any other value as its type", async function() {
                await loadTimed([["a", NO_OPTIONS]], { [SETTING]: -5 });
                shownOf("httpin.errors.invalid-max-body-size-setting").should.equal(-5);
                await stop();
                rendered.length = 0;
                await loadTimed([["a", NO_OPTIONS]], { [SETTING]: { toString: function() { return "x$t(" } } });
                shownOf("httpin.errors.invalid-max-body-size-setting").should.equal("object");
            });
        });

        describe("the text limit stays within the maximum string length when a limit is above it (#48)", function() {
            function declaredText(extra) {
                return Object.assign({ "Content-Type": "text/plain", "Content-Length": String(MAX + 1) }, extra);
            }

            function checkRefused(res) {
                res.should.have.property("settled", true);
                res.should.have.property("statusCode", 413);
                res.headers.connection.should.equal("close");
                res.headers["content-length"].should.equal("17");
                res.body.should.equal("Payload Too Large");
            }

            it("a setting above it: a text body that declares one byte more is answered with 413 at once and the connection is closed", async function() {
                await load([["a", NO_OPTIONS]], { [SETTING]: "1gb" });
                checkRefused(await exchange("POST", "/hook", declaredText(), [KIB], { end: false }));
                received.should.have.length(0);
                (await answer("/hook", PLAIN, 1024)).should.equal(200);
            });

            it("a limit of the node above it with a lower setting: the same", async function() {
                await load([["a", Object.assign({ maxBodySize: "1gb" }, NO_OPTIONS)]], { [SETTING]: "1kb" });
                checkRefused(await exchange("POST", "/hook", declaredText(), [KIB], { end: false }));
                received.should.have.length(0);
            });

            it("a limit of the node above it with a lower setting: a text body of 2 KiB is accepted as a string and a binary body above the limit is not refused", async function() {
                await load([["a", Object.assign({ maxBodySize: "1gb" }, NO_OPTIONS)]], { [SETTING]: "1kb" });
                (await answer("/hook", PLAIN, 2048)).should.equal(200);
                received[0].msg.payload.should.equal("a".repeat(2048));
                (await answer("/hook", OCTET, 4096)).should.equal(200);
            });

            it("a setting above it, a multibyte text that declares one byte more is answered with 413", async function() {
                await load([["a", NO_OPTIONS]], { [SETTING]: "1gb" });
                checkRefused(await exchange("POST", "/hook", declaredText({ "Content-Type": "text/plain; charset=utf-8" }), [Buffer.from("zażółć gęślą ".repeat(80))], { end: false }));
            });
        });

        describe("AC-11 with the setting: a response that another layer sent while the rest of the body is discarded", function() {
            // The middleware keeps `res` of the requests with the marker header; the test answers it with 503 and
            // Connection: close once the limit of the setting is hit, as the drain does
            async function answeredWhileDiscarding(headers, chunks, closing) {
                const kept = [];
                await load([["a", NO_OPTIONS]], {
                    [SETTING]: "1kb",
                    httpNodeMiddleware: function(req, res, next) {
                        if (req.headers["x-keep"]) { kept.push(res) }
                        next();
                    }
                });
                const strays = collectStrays();
                try {
                    const client = openRequest("POST", "/hook", Object.assign({ "x-keep": "1", "Content-Type": "application/octet-stream" }, headers), chunks);
                    for (let i = 0; i < 200 && kept.length === 0; i++) { await delay(5) }
                    kept.should.have.length(1);
                    await delay(50);
                    kept[0].statusCode = 503;
                    kept[0].setHeader("Connection", "close");
                    kept[0].end("busy");
                    const status = await within(client.first, ANSWER_BOUND, "no status line");
                    if (closing === "ends") {
                        client.req.end();
                    } else {
                        client.req.destroy();
                    }
                    await delay(150);
                    return { status: status, statuses: client.statuses.slice(), strays: strays.seen.slice() };
                } finally {
                    strays.restore();
                }
            }

            [["ends", "the client ends the request"], ["destroys", "the client destroys the request"]].forEach(function(closing) {
                it("AC-11: a declared 4 KiB body that is sent in part, " + closing[1] + " after the 503", async function() {
                    const outcome = await answeredWhileDiscarding({ "Content-Length": "4096" }, [KIB], closing[0]);
                    outcome.should.eql({ status: 503, statuses: [503], strays: [] });
                    (await answer("/hook", OCTET, 500)).should.equal(200);
                });

                it("AC-11: a chunked body that passes 1 KiB, " + closing[1] + " after the 503", async function() {
                    const outcome = await answeredWhileDiscarding({ "Transfer-Encoding": "chunked" }, [Buffer.alloc(600, 0x61), Buffer.alloc(600, 0x61)], closing[0]);
                    outcome.should.eql({ status: 503, statuses: [503], strays: [] });
                    (await answer("/hook", OCTET, 500)).should.equal(200);
                });
            });
        });
    });

    // The part cap of an upload and the numbers in the names of its fields (#48): AC-1 ... AC-27 of
    // local/briefs/48-parts-spec.md
    describe("part cap of an upload and numbered field names (#48)", function() {
        this.timeout(30000);
        const SETTING = "httpInMaxBodySize";
        const FLAG = "httpInMaxBodySizeEnabled";
        const UPLOAD = { skipBodyParsing: false, upload: true };
        const ORIGIN = { Origin: "http://example.test" };
        const BASE_EXPORT = { httpNodeRoot: "/" };
        const CAP = 1000;

        // One part of a multipart body: a text field or a file
        function fieldPart(name, value) {
            return "--" + BOUNDARY + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + value + "\r\n";
        }
        function filePart(name, content) {
            return "--" + BOUNDARY + "\r\nContent-Disposition: form-data; name=\"" + name + "\"; filename=\"" + (name || "x") + ".bin\"\r\nContent-Type: application/octet-stream\r\n\r\n" + content + "\r\n";
        }
        // A part that multer ignores (a file with an empty file name) but that the parser counts as a part
        function ignoredPart(name) {
            return "--" + BOUNDARY + "\r\nContent-Disposition: form-data; name=\"" + name + "\"; filename=\"\"\r\n\r\n\r\n";
        }
        // `count` parts: files "f<i>" of `size` bytes, or fields "f<i>"
        function files(count, size, namer) {
            const parts = [];
            for (let i = 0; i < count; i++) { parts.push(filePart(namer ? namer(i) : "f" + i, "a".repeat(size === undefined ? 1 : size))) }
            return parts;
        }
        function ignored(count) {
            const parts = [];
            for (let i = 0; i < count; i++) { parts.push(ignoredPart("f" + i)) }
            return parts;
        }
        function fields(count) {
            const parts = [];
            for (let i = 0; i < count; i++) { parts.push(fieldPart("f" + i, "v" + i)) }
            return parts;
        }
        function bodyOf(parts) {
            return Buffer.from(parts.join("") + "--" + BOUNDARY + "--\r\n");
        }

        // One request with the parts; options: chunked, headers, path, bound (ms), raw (a Buffer instead of the parts)
        function sendParts(parts, options) {
            const opts = options || {};
            const body = opts.raw || bodyOf(parts);
            const chunks = [];
            if (opts.chunked) {
                for (let at = 0; at < body.length; at += 4096) { chunks.push(body.subarray(at, at + 4096)) }
            } else {
                chunks.push(body);
            }
            const headers = Object.assign({}, MULTIPART, opts.chunked ? { "Transfer-Encoding": "chunked" } : { "Content-Length": String(body.length) }, opts.headers);
            return exchange("POST", opts.path || "/hook", headers, chunks, { bound: opts.bound || 10000 });
        }

        // the statuses of every answer to one request, and the stray errors, after the connection is quiet
        async function everyAnswer(parts, options) {
            const opts = options || {};
            const body = bodyOf(parts);
            const strays = collectStrays();
            try {
                const client = openRequest("POST", opts.path || "/hook", Object.assign({}, MULTIPART, { "Content-Length": String(body.length) }, opts.headers), [body]);
                client.req.end();
                await within(client.first, 10000, "no status line");
                await delay(200);
                return { statuses: client.statuses.slice(), strays: strays.seen.slice() };
            } finally {
                strays.restore();
            }
        }

        // The answer is the 413 of sendTooLarge
        function expectTooLarge(res) {
            res.should.have.property("settled", true);
            res.should.have.property("statusCode", 413);
            res.body.should.equal("Payload Too Large");
            res.headers["content-type"].should.equal("text/plain; charset=utf-8");
        }

        // `received` and the log of the node: nothing since `mark`
        let mark;
        function markLog() { mark = helper.log().args.length }
        // warnings and errors (levels 30 and below) written since `mark`; the helper also writes its own events
        function newLog() {
            return helper.log().args.slice(mark).filter(function(args) { return args[0] && args[0].level <= 30 });
        }
        function noLogSinceMark() { newLog().should.eql([]) }

        // loads with the node settings exported as GET /settings does
        async function loadExporting(nodes, settings, tune) {
            settingsExport = newSettingsExport();
            await load(nodes, settings, tune);
        }

        // the node accepts the request and the flow gets the message
        function expectAccepted(res, files, keys) {
            res.should.have.property("statusCode", 200);
            received.should.have.length(1);
            if (files !== undefined) { received[0].msg.req.files.should.have.length(files) }
            if (keys !== undefined) { Object.keys(received[0].msg.payload).should.have.length(keys) }
        }

        // the part cap is on: the setting (the text and the number form) or the field of the node
        const CAPPED = [
            ["the setting \"50mb\"", UPLOAD, { [SETTING]: "50mb" }],
            ["the setting 52428800", UPLOAD, { [SETTING]: 52428800 }],
            ["the field of the node \"100mb\" only", Object.assign({ maxBodySize: "100mb" }, UPLOAD), {}],
            ["the field of the node 104857600 only", Object.assign({ maxBodySize: 104857600 }, UPLOAD), {}]
        ];

        describe("AC-1: 1000 file parts are accepted with the cap on", function() {
            CAPPED.slice(0, 2).forEach(function(entry) {
                it("AC-1: " + entry[0] + ", 1000 files of 1 byte: 200, one message, 1000 files", async function() {
                    await load([["a", entry[1]]], entry[2]);
                    markLog();
                    expectAccepted(await sendParts(files(CAP, 1)), CAP);
                    noLogSinceMark();
                });
            });
        });

        describe("AC-2: 1001 parts get 413 with the cap on", function() {
            const VARIANTS = [
                ["files of 1 byte", function() { return files(CAP + 1, 1) }],
                ["empty files", function() { return files(CAP + 1, 0) }],
                ["parts that multer ignores (an empty file name)", function() { return ignored(CAP + 1) }],
                ["a field and 1000 parts that multer ignores", function() { return [fieldPart("first", "v")].concat(ignored(CAP)) }]
            ];
            VARIANTS.forEach(function(variant) {
                it("AC-2: " + variant[0] + " with the setting: 413 Payload Too Large, text/plain, no message, no log", async function() {
                    await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                    markLog();
                    expectTooLarge(await sendParts(variant[1]()));
                    received.should.have.length(0);
                    noLogSinceMark();
                });
            });

            it("AC-2: the boundary is exact for empty files and for the parts that multer ignores: 1000 are accepted", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                expectAccepted(await sendParts(files(CAP, 0)), CAP);
                received.length = 0;
                expectAccepted(await sendParts(ignored(CAP)), 0);
            });

            it("AC-2: a part with an empty field name is a multer error that is not a limit: 500 and one warning, as before (also in a body of 1001 parts)", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                markLog();
                const res = await sendParts([filePart("", "a")].concat(files(CAP, 1)));
                res.should.have.property("statusCode", 500);
                received.should.have.length(0);
                newLog().should.have.length(1);
            });

            it("AC-2: exactly one answer reaches the client, no stray error", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                (await everyAnswer(files(CAP + 1, 1))).should.eql({ statuses: [413], strays: [] });
                received.should.have.length(0);
            });
        });

        describe("AC-3: fields only", function() {
            it("AC-3: 1000 fields: 200 and 1000 keys in the payload", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                markLog();
                expectAccepted(await sendParts(fields(CAP)), 0, CAP);
                noLogSinceMark();
            });

            it("AC-3: 1001 fields: 413, no message, no log", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                markLog();
                expectTooLarge(await sendParts(fields(CAP + 1)));
                received.should.have.length(0);
                noLogSinceMark();
            });
        });

        describe("AC-4: fields and files together", function() {
            function mixed(nFiles, nFields) {
                const parts = [];
                const most = Math.max(nFiles, nFields);
                for (let i = 0; i < most; i++) {
                    if (i < nFiles) { parts.push(filePart("g" + i, "a")) }
                    if (i < nFields) { parts.push(fieldPart("h" + i, "v")) }
                }
                return parts;
            }

            it("AC-4: 500 files and 500 fields (interleaved): 200, 500 files, 500 keys", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                expectAccepted(await sendParts(mixed(500, 500)), 500, 500);
            });

            it("AC-4: 500 files and 500 fields (files first): 200", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                expectAccepted(await sendParts(files(500, 1).concat(fields(500))), 500, 500);
            });

            it("AC-4: 501 files and 500 fields: 413, no message", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                markLog();
                expectTooLarge(await sendParts(mixed(501, 500)));
                received.should.have.length(0);
                noLogSinceMark();
            });

            it("AC-4: 500 files and 501 fields: 413, no message", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                expectTooLarge(await sendParts(mixed(500, 501)));
                received.should.have.length(0);
            });
        });

        describe("AC-5: the field of the node alone switches the cap on", function() {
            CAPPED.slice(2).forEach(function(entry) {
                it("AC-5: " + entry[0] + ": 1000 parts are accepted, 1001 get 413 without a log", async function() {
                    await load([["a", entry[1]]], entry[2]);
                    markLog();
                    expectAccepted(await sendParts(files(CAP, 1)), CAP);
                    received.length = 0;
                    expectTooLarge(await sendParts(files(CAP + 1, 1)));
                    received.should.have.length(0);
                    noLogSinceMark();
                });
            });
        });

        describe("AC-6: with neither the setting nor the field of the node the number of parts is not limited", function() {
            it("AC-6: 1500 files of 1 byte: 200 and 1500 files", async function() {
                await load([["a", UPLOAD]], {});
                markLog();
                expectAccepted(await sendParts(files(1500, 1)), 1500);
                noLogSinceMark();
            });

            it("AC-6: 1500 fields: 200 and 1500 keys", async function() {
                await load([["a", UPLOAD]], {});
                expectAccepted(await sendParts(fields(1500)), 0, 1500);
            });

            it("AC-6: 1500 parts with an apiMaxLength of the runtime and no limit of the upload: still not limited", async function() {
                await load([["a", UPLOAD]], { apiMaxLength: "1mb" });
                expectAccepted(await sendParts(files(1500, 1)), 1500);
            });
        });

        describe("AC-7: a limit that is not valid leaves the cap off", function() {
            const hostile = function() { throw new Error("hostile value") };
            const FIELDS = [
                ["(a) the setting \"abc\"", UPLOAD, { [SETTING]: "abc" }, null],
                ["(b) the setting 0", UPLOAD, { [SETTING]: 0 }, null],
                ["(c) a getter of the setting that throws", UPLOAD, {}, function(settings) {
                    Object.defineProperty(settings, SETTING, { configurable: true, enumerable: true, get: hostile });
                }],
                ["(d) the field of the node \"abc\"", Object.assign({ maxBodySize: "abc" }, UPLOAD), {}, null],
                ["(e) the field of the node \"0\"", Object.assign({ maxBodySize: "0" }, UPLOAD), {}, null],
                ["(f) the field of the node {}", Object.assign({ maxBodySize: {} }, UPLOAD), {}, null],
                ["(g) the field of the node \"   \"", Object.assign({ maxBodySize: "   " }, UPLOAD), {}, null],
                ["(i) the field of the node [], no setting", Object.assign({ maxBodySize: [] }, UPLOAD), {}, null],
                ["(j) the field of the node true, no setting", Object.assign({ maxBodySize: true }, UPLOAD), {}, null]
            ];
            FIELDS.forEach(function(entry) {
                it("AC-7: " + entry[0] + ": 1500 parts are accepted (the existing warning stays as it is)", async function() {
                    await load([["a", entry[1]]], entry[2], entry[3] || undefined);
                    expectAccepted(await sendParts(files(1500, 1)), 1500);
                });
            });

            it("AC-7: (h) a valid setting and the field of the node \"abc\": 1001 parts get 413, 1000 are accepted", async function() {
                await load([["a", Object.assign({ maxBodySize: "abc" }, UPLOAD)]], { [SETTING]: "50mb" });
                expectAccepted(await sendParts(files(CAP, 1)), CAP);
                received.length = 0;
                expectTooLarge(await sendParts(files(CAP + 1, 1)));
                received.should.have.length(0);
            });

            it("AC-7: a valid setting and the field of the node {}: 1001 parts get 413", async function() {
                await load([["a", Object.assign({ maxBodySize: {} }, UPLOAD)]], { [SETTING]: "50mb" });
                expectTooLarge(await sendParts(files(CAP + 1, 1)));
                received.should.have.length(0);
            });
        });

        describe("AC-8: the number of parts does not depend on the limit of the bytes", function() {
            [
                ["the setting \"1mb\" and the field of the node \"500mb\"", Object.assign({ maxBodySize: "500mb" }, UPLOAD), { [SETTING]: "1mb" }],
                ["the setting \"500mb\" and the field of the node \"1mb\"", Object.assign({ maxBodySize: "1mb" }, UPLOAD), { [SETTING]: "500mb" }]
            ].forEach(function(entry) {
                it("AC-8: " + entry[0] + ": 1000 parts of 1 byte are accepted, 1001 get 413", async function() {
                    await load([["a", entry[1]]], entry[2]);
                    expectAccepted(await sendParts(files(CAP, 1)), CAP);
                    received.length = 0;
                    expectTooLarge(await sendParts(files(CAP + 1, 1)));
                    received.should.have.length(0);
                });
            });
        });

        describe("AC-9: a chunked body (no Content-Length)", function() {
            it("AC-9: 1001 parts: 413, no message", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                markLog();
                expectTooLarge(await sendParts(files(CAP + 1, 1), { chunked: true }));
                received.should.have.length(0);
                noLogSinceMark();
            });

            it("AC-9: 1000 parts: 200 and 1000 files", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                expectAccepted(await sendParts(files(CAP, 1), { chunked: true }), CAP);
            });

            it("AC-9: 1001 fields, chunked, with the field of the node only: 413", async function() {
                await load([["a", Object.assign({ maxBodySize: "100mb" }, UPLOAD)]], {});
                expectTooLarge(await sendParts(fields(CAP + 1), { chunked: true }));
                received.should.have.length(0);
            });
        });

        describe("AC-10: a very large number of parts", function() {
            it("AC-10: 100000 empty file parts: 413 within the bound of the test, no message", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                const one = filePart("f", "");
                const body = Buffer.from(new Array(100000).fill(one).join("") + "--" + BOUNDARY + "--\r\n");
                body.length.should.be.below(12 * 1024 * 1024);
                const started = Date.now();
                const res = await sendParts(null, { raw: body, bound: 10000 });
                (Date.now() - started).should.be.below(10000);
                expectTooLarge(res);
                received.should.have.length(0);
                // the next request is served
                expectAccepted(await sendParts(files(3, 1)), 3);
            });
        });

        describe("AC-11: the limit of the bytes is hit before the cap of the parts", function() {
            it("AC-11: 20 files of 1 KiB with the setting \"10kb\": exactly one answer, 413, no message", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "10kb" });
                (await everyAnswer(files(20, 1024))).should.eql({ statuses: [413], strays: [] });
                received.should.have.length(0);
            });
        });

        describe("AC-12: the 413 of the cap carries the CORS headers", function() {
            it("AC-12: 1001 parts with an Origin header and httpNodeCors: 413 with Access-Control-Allow-Origin", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb", httpNodeCors: { origin: "*" } });
                const res = await sendParts(files(CAP + 1, 1), { headers: ORIGIN });
                expectTooLarge(res);
                res.headers["access-control-allow-origin"].should.equal("*");
                received.should.have.length(0);
            });

            it("AC-12: 1001 parts with the field of the node only, with CORS: 413 with Access-Control-Allow-Origin", async function() {
                await load([["a", Object.assign({ maxBodySize: "100mb" }, UPLOAD)]], { httpNodeCors: { origin: "*" } });
                const res = await sendParts(files(CAP + 1, 1), { headers: ORIGIN });
                expectTooLarge(res);
                res.headers["access-control-allow-origin"].should.equal("*");
            });
        });

        describe("AC-13: a response that another layer already sent", function() {
            function answerAndContinue(req, res, next) {
                res.status(202).end();
                next();
            }

            // answers when the whole body has arrived, and lets the request go on at once: the body of 1001 parts
            // is read before the answer, so multer sees all of it
            function answerAtEndAndContinue(req, res, next) {
                req.on("end", function() { res.status(202).end() });
                next();
            }

            it("AC-13: 1001 parts with the setting, the answer given when the body has arrived: one answer (202), no stray error, no message, no log", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb", httpNodeMiddleware: answerAtEndAndContinue });
                markLog();
                (await everyAnswer(files(CAP + 1, 1))).should.eql({ statuses: [202], strays: [] });
                received.should.have.length(0);
                noLogSinceMark();
            });

            it("AC-13: 1001 parts with the setting, the answer given at once: one answer (202), no stray error, no message, no log", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb", httpNodeMiddleware: answerAndContinue });
                markLog();
                (await everyAnswer(files(CAP + 1, 1))).should.eql({ statuses: [202], strays: [] });
                received.should.have.length(0);
                noLogSinceMark();
            });

            it("AC-13: the field a[101] without a setting: one answer (202), no stray error, no message, no log", async function() {
                await load([["a", UPLOAD]], { httpNodeMiddleware: answerAndContinue });
                markLog();
                (await everyAnswer([fieldPart("a[101]", "v")])).should.eql({ statuses: [202], strays: [] });
                received.should.have.length(0);
                noLogSinceMark();
            });
        });

        describe("AC-14: no state between requests", function() {
            it("AC-14: after a request of 1001 parts a request of 10 parts is served with its 10 files", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                expectTooLarge(await sendParts(files(CAP + 1, 1)));
                received.should.have.length(0);
                expectAccepted(await sendParts(files(10, 1)), 10);
            });

            it("AC-14: two requests of 1000 parts at the same time are both accepted", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                const both = await Promise.all([sendParts(files(CAP, 1)), sendParts(files(CAP, 2))]);
                both.map(function(res) { return res.statusCode }).should.eql([200, 200]);
                received.should.have.length(2);
                received.map(function(entry) { return entry.msg.req.files.length }).should.eql([CAP, CAP]);
            });

            it("AC-14: a request of 1001 parts and one of 1000 at the same time: 413 and 200", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                const both = await Promise.all([sendParts(files(CAP + 1, 1)), sendParts(files(CAP, 1))]);
                both.map(function(res) { return res.statusCode }).should.eql([413, 200]);
                received.should.have.length(1);
                received[0].msg.req.files.should.have.length(CAP);
            });

            it("AC-14: after the 413 of a field a[101] the next request with a[100] is served", async function() {
                await load([["a", UPLOAD]], {});
                expectTooLarge(await sendParts([fieldPart("a[101]", "v")]));
                received.should.have.length(0);
                expectAccepted(await sendParts([fieldPart("a[100]", "v")]));
            });
        });

        describe("AC-15: a body that is not multipart on a route of an upload", function() {
            it("AC-15: text/plain of 5000 bytes with the setting is accepted as before", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                const res = await exchange("POST", "/hook", { "Content-Type": "text/plain", "Content-Length": "5000" }, [Buffer.alloc(5000, 0x61)], { bound: 5000 });
                res.should.have.property("statusCode", 200);
                received.should.have.length(1);
            });
        });

        describe("AC-16: a route of an upload with Do not parse", function() {
            it("AC-16: the setting, 1500 parts below the limit of the bytes: 200 and the whole body as a Buffer", async function() {
                await load([["a", { skipBodyParsing: true, upload: true }]], { [SETTING]: "50mb" });
                const body = bodyOf(files(1500, 1));
                const res = await sendParts(null, { raw: body });
                res.should.have.property("statusCode", 200);
                received.should.have.length(1);
                Buffer.isBuffer(received[0].msg.payload).should.be.true();
                received[0].msg.payload.equals(body).should.be.true();
            });
        });

        describe("AC-17: the other errors of multer are answered as before", function() {
            it("AC-17: a text field of 1.5 MB (above the 1 MB of the parser): 500 and one warning of the node", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                markLog();
                const res = await sendParts([fieldPart("big", "x".repeat(1536 * 1024))]);
                res.should.have.property("statusCode", 500);
                received.should.have.length(0);
                newLog().should.have.length(1);
            });

            it("AC-17: a body without the closing boundary: 500 and one warning of the node", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                markLog();
                const res = await sendParts(null, { raw: Buffer.from(fieldPart("a", "v") + "--" + BOUNDARY + "\r\nContent-Disposition: form-data; name=\"b\"\r\n\r\nunfinished") });
                res.should.have.property("statusCode", 500);
                received.should.have.length(0);
                newLog().should.have.length(1);
            });

            it("AC-17: the same errors without the setting: 500 and one warning of the node", async function() {
                await load([["a", UPLOAD]], {});
                markLog();
                const res = await sendParts([fieldPart("big", "x".repeat(1536 * 1024))]);
                res.should.have.property("statusCode", 500);
                newLog().should.have.length(1);
            });
        });

        describe("AC-18: what GET /settings tells the editor", function() {
            it("AC-18: with the setting only the flag is exported, nothing new", async function() {
                await loadExporting([["a", UPLOAD]], { [SETTING]: "50mb" });
                settingsExport.exported().should.eql(Object.assign({ [FLAG]: true }, BASE_EXPORT));
            });

            it("AC-18: without the setting nothing is exported", async function() {
                await loadExporting([["a", UPLOAD]], {});
                settingsExport.exported().should.eql(BASE_EXPORT);
            });
        });

        describe("AC-20: a number up to 100 in the name of a field is accepted", function() {
            it("AC-20: a[100]=v without any limit: 200, an array of 101 entries, the value at 100", async function() {
                await load([["a", UPLOAD]], {});
                markLog();
                expectAccepted(await sendParts([fieldPart("a[100]", "v")]));
                const a = received[0].msg.payload.a;
                Array.isArray(a).should.be.true();
                a.should.have.length(101);
                a[100].should.equal("v");
                noLogSinceMark();
            });

            it("AC-20: a[0100] (the number 100 with a leading zero) is accepted", async function() {
                await load([["a", UPLOAD]], {});
                expectAccepted(await sendParts([fieldPart("a[0100]", "v")]));
            });

            it("AC-20: a[100] is accepted with the setting and with the field of the node", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                expectAccepted(await sendParts([fieldPart("a[100]", "v")]));
                await stopServerOf();
                await load([["a", Object.assign({ maxBodySize: "100mb" }, UPLOAD)]], {});
                received.length = 0;
                expectAccepted(await sendParts([fieldPart("a[100]", "v")]));
            });

            it("AC-20: a[100] in a chunked body is accepted", async function() {
                await load([["a", UPLOAD]], {});
                expectAccepted(await sendParts([fieldPart("a[100]", "v")], { chunked: true }));
            });
        });

        // closes the server and the nodes of the test, to load another flow in the same test
        async function stopServerOf() {
            server.closeAllConnections();
            await new Promise(function(resolve) { server.close(resolve) });
            server = null;
            await helper.unload();
            RED.httpNode.parent = undefined;
        }

        describe("AC-21: a number above 100 in the name of a field gets 413 without any limit", function() {
            it("AC-21: a[101]=v: 413 Payload Too Large, no message, no log", async function() {
                await load([["a", UPLOAD]], {});
                markLog();
                expectTooLarge(await sendParts([fieldPart("a[101]", "v")]));
                received.should.have.length(0);
                noLogSinceMark();
            });

            it("AC-21: exactly one answer reaches the client, no stray error", async function() {
                await load([["a", UPLOAD]], {});
                (await everyAnswer([fieldPart("a[101]", "v")])).should.eql({ statuses: [413], strays: [] });
                received.should.have.length(0);
            });

            it("AC-21: a[101] after fields that are valid, and before them: 413", async function() {
                await load([["a", UPLOAD]], {});
                expectTooLarge(await sendParts([fieldPart("x", "1"), fieldPart("y[2]", "2"), fieldPart("a[101]", "v")]));
                expectTooLarge(await sendParts([fieldPart("a[101]", "v"), fieldPart("x", "1")]));
                received.should.have.length(0);
            });

            it("AC-21: a[101] in a chunked body: 413", async function() {
                await load([["a", UPLOAD]], {});
                expectTooLarge(await sendParts([fieldPart("a[101]", "v")], { chunked: true }));
                received.should.have.length(0);
            });

            it("AC-21: the 413 carries the CORS headers", async function() {
                await load([["a", UPLOAD]], { httpNodeCors: { origin: "*" } });
                const res = await sendParts([fieldPart("a[101]", "v")], { headers: ORIGIN });
                expectTooLarge(res);
                res.headers["access-control-allow-origin"].should.equal("*");
            });
        });

        describe("AC-22: the same with the cap on", function() {
            it("AC-22a: with the setting, a[101]: 413, no log", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                markLog();
                expectTooLarge(await sendParts([fieldPart("a[101]", "v")]));
                received.should.have.length(0);
                noLogSinceMark();
            });

            it("AC-22b: with the field of the node \"100mb\" only, a[101]: 413, no log", async function() {
                await load([["a", Object.assign({ maxBodySize: "100mb" }, UPLOAD)]], {});
                markLog();
                expectTooLarge(await sendParts([fieldPart("a[101]", "v")]));
                received.should.have.length(0);
                noLogSinceMark();
            });

            it("AC-22: the limit of the number is 100 and not lower with the cap on: a[100] is accepted", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                expectAccepted(await sendParts([fieldPart("a[100]", "v")]));
            });
        });

        describe("AC-23: other forms of a number above 100", function() {
            ["a[5][101]", "a[0101]", "a[4294967294]", "a[4294967295]", "a[99999999999999999999]"].forEach(function(name) {
                it("AC-23: the field " + name + ": 413, no message, no log", async function() {
                    await load([["a", UPLOAD]], {});
                    markLog();
                    expectTooLarge(await sendParts([fieldPart(name, "v")]));
                    received.should.have.length(0);
                    noLogSinceMark();
                });
            });
        });

        describe("AC-24: names that are not a number in brackets are not changed", function() {
            [
                ["a[101]x", { "a[101]x": "v" }],
                ["[5000]", { "[5000]": "v" }],
                ["a[ 101]", { a: { " 101": "v" } }],
                ["a[1e2]", { a: { "1e2": "v" } }],
                ["a[-5]", { a: { "-5": "v" } }],
                ["a[]", { a: ["v"] }],
                ["a%5B5000%5D", { "a%5B5000%5D": "v" }],
                ["a[0]", { a: ["v"] }],
                ["a", { a: "v" }]
            ].forEach(function(entry) {
                it("AC-24: the field " + JSON.stringify(entry[0]) + " is accepted, the payload is " + JSON.stringify(entry[1]), async function() {
                    await load([["a", UPLOAD]], {});
                    expectAccepted(await sendParts([fieldPart(entry[0], "v")]));
                    JSON.parse(JSON.stringify(received[0].msg.payload)).should.eql(entry[1]);
                });
            });

            it("AC-24: a[100][b] is accepted: an array of 101 entries with the value at a[100].b", async function() {
                await load([["a", UPLOAD]], {});
                expectAccepted(await sendParts([fieldPart("a[100][b]", "v")]));
                const a = received[0].msg.payload.a;
                Array.isArray(a).should.be.true();
                a.should.have.length(101);
                a[100].b.should.equal("v");
            });

            it("AC-24: the names that are not checked are accepted with the cap on as well", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                expectAccepted(await sendParts([fieldPart("a[101]x", "v"), fieldPart("a[1e2]", "v")]));
                JSON.parse(JSON.stringify(received[0].msg.payload)).should.eql({ "a[101]x": "v", a: { "1e2": "v" } });
            });
        });

        describe("AC-25: a file part is not checked for the number in its field name", function() {
            it("AC-25: a file part named a[99999]: 200 and req.files[0].fieldname is a[99999]", async function() {
                await load([["a", UPLOAD]], {});
                markLog();
                expectAccepted(await sendParts([filePart("a[99999]", "data")]), 1);
                received[0].msg.req.files[0].fieldname.should.equal("a[99999]");
                noLogSinceMark();
            });

            it("AC-25: the same with the cap on", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                expectAccepted(await sendParts([filePart("a[99999]", "data")]), 1);
                received[0].msg.req.files[0].fieldname.should.equal("a[99999]");
            });
        });

        describe("AC-26: the rest of the body is read before the answer", function() {
            it("AC-26: a[101] first, 2 MB of further parts after it: 413 within the bound of the test, no message", async function() {
                await load([["a", UPLOAD]], {});
                const parts = [fieldPart("a[101]", "v")].concat(files(22, 100 * 1024));
                bodyOf(parts).length.should.be.above(2 * 1024 * 1024);
                markLog();
                const started = Date.now();
                expectTooLarge(await sendParts(parts, { bound: 10000 }));
                (Date.now() - started).should.be.below(10000);
                received.should.have.length(0);
                noLogSinceMark();
                // the next request is served
                expectAccepted(await sendParts([fieldPart("a[1]", "v")]));
            });
        });

        describe("AC-27: urlencoded and JSON bodies are not changed", function() {
            it("AC-27: urlencoded a[5000]=v: payload as before", async function() {
                await load([["a", UPLOAD]], {});
                const body = Buffer.from("a[5000]=v");
                const res = await exchange("POST", "/hook", { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": String(body.length) }, [body], { bound: 5000 });
                res.should.have.property("statusCode", 200);
                JSON.parse(JSON.stringify(received[0].msg.payload)).should.eql({ a: { 5000: "v" } });
            });

            it("AC-27: JSON {\"a\":{\"5000\":\"v\"}}: payload as before", async function() {
                await load([["a", UPLOAD]], {});
                const body = Buffer.from(JSON.stringify({ a: { 5000: "v" } }));
                const res = await exchange("POST", "/hook", { "Content-Type": "application/json", "Content-Length": String(body.length) }, [body], { bound: 5000 });
                res.should.have.property("statusCode", 200);
                JSON.parse(JSON.stringify(received[0].msg.payload)).should.eql({ a: { 5000: "v" } });
            });

            it("AC-27: the same with the setting on", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                const body = Buffer.from("a[5000]=v");
                const res = await exchange("POST", "/hook", { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": String(body.length) }, [body], { bound: 5000 });
                res.should.have.property("statusCode", 200);
                JSON.parse(JSON.stringify(received[0].msg.payload)).should.eql({ a: { 5000: "v" } });
            });
        });

        // The depth of a field name (the number of "[" in it) is limited to 8 on every upload route (#48, REV-001)
        describe("REV-001: the nesting depth of a field name", function() {
            const KEYS8 = "a[b][c][d][e][f][g][h][i]";
            const KEYS9 = KEYS8 + "[j]";
            const MIXED8 = "data[items][0][options][1][value][x][y][z]";
            const MIXED9 = MIXED8 + "[w]";
            const INDEXES8 = "n[0][0][0][0][0][0][0][0]";
            const INDEXES9 = INDEXES8 + "[0]";
            const CONFIGS = [
                ["no limit", UPLOAD, {}],
                ["the setting", UPLOAD, { [SETTING]: "50mb" }],
                ["the field of the node only", Object.assign({ maxBodySize: "100mb" }, UPLOAD), {}]
            ];
            function roundTrip(value) { return JSON.parse(JSON.stringify(value)) }

            CONFIGS.forEach(function(config) {
                it("REV-001: " + config[0] + ", depth 8 (keys): 200 and the exact payload", async function() {
                    await load([["a", config[1]]], config[2]);
                    markLog();
                    expectAccepted(await sendParts([fieldPart(KEYS8, "v")]));
                    roundTrip(received[0].msg.payload).should.eql({ a: { b: { c: { d: { e: { f: { g: { h: { i: "v" } } } } } } } } });
                    noLogSinceMark();
                });

                it("REV-001: " + config[0] + ", depth 9 (keys): 413, no message, no log", async function() {
                    await load([["a", config[1]]], config[2]);
                    markLog();
                    expectTooLarge(await sendParts([fieldPart(KEYS9, "v")]));
                    received.should.have.length(0);
                    noLogSinceMark();
                });

                it("REV-001: " + config[0] + ", depth 9 (keys) in a chunked body: 413, then the next request is served", async function() {
                    await load([["a", config[1]]], config[2]);
                    expectTooLarge(await sendParts([fieldPart(KEYS9, "v")], { chunked: true }));
                    received.should.have.length(0);
                    expectAccepted(await sendParts([fieldPart(KEYS8, "v")], { chunked: true }));
                });
            });

            it("REV-001: a name that mixes indexes and keys, depth 8: 200 and the exact payload", async function() {
                await load([["a", UPLOAD]], {});
                expectAccepted(await sendParts([fieldPart(MIXED8, "v")]));
                roundTrip(received[0].msg.payload).should.eql({ data: { items: [{ options: [null, { value: { x: { y: { z: "v" } } } }] }] } });
            });

            it("REV-001: a name that mixes indexes and keys, one more level (depth 9): 413, no message, no log", async function() {
                await load([["a", UPLOAD]], {});
                markLog();
                expectTooLarge(await sendParts([fieldPart(MIXED9, "v")]));
                received.should.have.length(0);
                noLogSinceMark();
            });

            it("REV-001: only indexes, depth 8: 200 and nested arrays; depth 9: 413", async function() {
                await load([["a", UPLOAD]], {});
                expectAccepted(await sendParts([fieldPart(INDEXES8, "v")]));
                roundTrip(received[0].msg.payload).should.eql({ n: [[[[[[[["v"]]]]]]]] });
                received.length = 0;
                expectTooLarge(await sendParts([fieldPart(INDEXES9, "v")]));
                received.should.have.length(0);
            });

            it("REV-001: the depth of a name in a body with other valid fields: the deep name decides, wherever it stands", async function() {
                await load([["a", UPLOAD]], {});
                expectTooLarge(await sendParts([fieldPart("x", "1"), fieldPart(KEYS9, "v"), fieldPart("y", "2")]));
                expectTooLarge(await sendParts([fieldPart(KEYS9, "v"), fieldPart("x", "1")]));
                expectTooLarge(await sendParts([fieldPart("x", "1"), fieldPart("y[1]", "2"), fieldPart(KEYS9, "v")]));
                received.should.have.length(0);
            });

            it("REV-001: the 413 carries the CORS headers, with and without a size limit", async function() {
                await load([["a", UPLOAD]], { httpNodeCors: { origin: "*" } });
                let res = await sendParts([fieldPart(KEYS9, "v")], { headers: ORIGIN });
                expectTooLarge(res);
                res.headers["access-control-allow-origin"].should.equal("*");
                await stopServerOf();
                await load([["a", Object.assign({ maxBodySize: "100mb" }, UPLOAD)]], { httpNodeCors: { origin: "*" } });
                res = await sendParts([fieldPart(KEYS9, "v")], { headers: ORIGIN });
                expectTooLarge(res);
                res.headers["access-control-allow-origin"].should.equal("*");
                received.should.have.length(0);
            });

            it("REV-001: exactly one answer reaches the client, no stray error", async function() {
                await load([["a", UPLOAD]], {});
                (await everyAnswer([fieldPart(KEYS9, "v")])).should.eql({ statuses: [413], strays: [] });
                received.should.have.length(0);
            });

            it("REV-001: a response that another layer already sent stays the only one (202), no message, no log", async function() {
                await load([["a", UPLOAD]], { httpNodeMiddleware: function(req, res, next) { res.status(202).end(); next() } });
                markLog();
                (await everyAnswer([fieldPart(KEYS9, "v")])).should.eql({ statuses: [202], strays: [] });
                received.should.have.length(0);
                noLogSinceMark();
            });

            it("REV-001: the rest of the body is read before the answer: a deep name first, 2 MB after it: 413 within the bound", async function() {
                await load([["a", UPLOAD]], {});
                const parts = [fieldPart(KEYS9, "v")].concat(files(22, 100 * 1024));
                const started = Date.now();
                expectTooLarge(await sendParts(parts, { bound: 10000 }));
                (Date.now() - started).should.be.below(10000);
                received.should.have.length(0);
                expectAccepted(await sendParts([fieldPart("a[1]", "v")]));
            });

            it("REV-001: names without brackets are not affected, however long a dotted name is", async function() {
                await load([["a", UPLOAD]], {});
                const dotted = "a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p";
                expectAccepted(await sendParts([fieldPart(dotted, "v"), fieldPart("plain", "w")]));
                roundTrip(received[0].msg.payload).should.eql({ [dotted]: "v", plain: "w" });
            });

            it("REV-001: a file part with a deep name is not checked (as with a number above 100)", async function() {
                await load([["a", UPLOAD]], {});
                expectAccepted(await sendParts([filePart(KEYS9, "data")]), 1);
                received[0].msg.req.files[0].fieldname.should.equal(KEYS9);
            });

            it("REV-001: urlencoded and JSON bodies with a deep name are not changed (200)", async function() {
                await load([["a", UPLOAD]], {});
                const form = Buffer.from(KEYS9 + "=v");
                let res = await exchange("POST", "/hook", { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": String(form.length) }, [form], { bound: 5000 });
                res.should.have.property("statusCode", 200);
                const json = Buffer.from(JSON.stringify({ [KEYS9]: "v" }));
                res = await exchange("POST", "/hook", { "Content-Type": "application/json", "Content-Length": String(json.length) }, [json], { bound: 5000 });
                res.should.have.property("statusCode", 200);
                received.should.have.length(2);
            });

            it("REV-001: the other limits stay: 1001 parts with the setting still get 413, a[100] is accepted, a[101] gets 413", async function() {
                await load([["a", UPLOAD]], { [SETTING]: "50mb" });
                expectTooLarge(await sendParts(files(CAP + 1, 1)));
                expectTooLarge(await sendParts([fieldPart("a[101]", "v")]));
                received.should.have.length(0);
                expectAccepted(await sendParts([fieldPart("a[100]", "v")]));
            });
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
