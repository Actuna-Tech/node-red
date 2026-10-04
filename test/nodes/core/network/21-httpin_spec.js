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

    function flow(skipBodyParsing) {
        return [
            { id: "in", type: "http in", url: "/hook", method: "post", skipBodyParsing: skipBodyParsing, wires: [["sink"]] },
            { id: "sink", type: "helper" }
        ];
    }

    function load(skipBodyParsing, done) {
        helper.load(httpInWrapper, flow(skipBodyParsing), function() {
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

    before(function(done) {
        helper.startServer(done);
    });

    after(function(done) {
        helper.stopServer(done);
    });

    afterEach(function(done) {
        helper.unload().then(function() { done() }, done);
    });

    it("gives a Buffer to the handler when the raw body was captured", function(done) {
        load(true, function() {
            supertest(RED.httpNode)
                .post("/hook")
                .set("Content-Type", "application/json")
                .send('{"a": 1}')
                .expect(200)
                .end(function(err) {
                    if (err) { return done(err) }
                    received.should.have.length(1);
                    Buffer.isBuffer(received[0].payload).should.be.true();
                    received[0].payload.toString().should.equal('{"a": 1}');
                    done();
                });
        });
    });

    it("gives a Buffer when the request bypassed the capture of the raw body", function(done) {
        load(true, function() {
            bypassRawBodyCapture();
            supertest(RED.httpNode)
                .post("/hook")
                .set("Content-Type", "application/json")
                .send('{"a":   1}')
                .expect(200)
                .end(function(err) {
                    if (err) { return done(err) }
                    received.should.have.length(1);
                    Buffer.isBuffer(received[0].payload).should.be.true();
                    // the exact bytes (a parsed body would be an object)
                    received[0].payload.toString().should.equal('{"a":   1}');
                    done();
                });
        });
    });

    it("gives a Buffer for a urlencoded body that bypassed the capture", function(done) {
        load(true, function() {
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

    it("still parses a JSON body of a route without skipBodyParsing", function(done) {
        load(false, function() {
            supertest(RED.httpNode)
                .post("/hook")
                .set("Content-Type", "application/json")
                .send('{"a": 1}')
                .expect(200)
                .end(function(err) {
                    if (err) { return done(err) }
                    received.should.have.length(1);
                    Buffer.isBuffer(received[0].payload).should.be.false();
                    received[0].payload.should.eql({ a: 1 });
                    done();
                });
        });
    });

    it("still parses a JSON body of a route without skipBodyParsing when the capture is bypassed", function(done) {
        load(false, function() {
            bypassRawBodyCapture();
            supertest(RED.httpNode)
                .post("/hook")
                .set("Content-Type", "application/json")
                .send('{"a": 1}')
                .expect(200)
                .end(function(err) {
                    if (err) { return done(err) }
                    received[0].payload.should.eql({ a: 1 });
                    done();
                });
        });
    });
});
