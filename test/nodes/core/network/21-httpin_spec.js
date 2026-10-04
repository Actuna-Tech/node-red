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
