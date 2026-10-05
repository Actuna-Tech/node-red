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
 *   #41: new test file - the nr-test-utils/supertest helper (loopback binding, explicit errors)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const http = require("http");
const http2 = require("http2");
const https = require("https");
const express = require("express");
const request = require("nr-test-utils/supertest");

describe("nr-test-utils/supertest", function() {
    it("serves an express app on 127.0.0.1", function(done) {
        const app = express();
        app.get("/x", (req, res) => res.json({ addr: req.socket.localAddress }));
        request(app).get("/x").expect(200).end(function(err, res) {
            if (err) { return done(err); }
            try {
                res.body.addr.should.match(/127\.0\.0\.1$/);
                done();
            } catch (e) { done(e); }
        });
    });

    it("serves a plain http.Server", function(done) {
        const server = http.createServer((req, res) => res.end("ok"));
        request(server).get("/").expect(200, "ok").end(done);
    });

    it("rejects a URL given as text", function() {
        (() => request("http://127.0.0.1:1")).should.throw(TypeError, /URL given as text/);
    });

    it("rejects a TLS server", function() {
        const server = https.createServer({}, (req, res) => res.end());
        (() => request(server)).should.throw(TypeError, /TLS server/);
    });

    it("rejects the http2 option", function() {
        (() => request(express(), { http2: true })).should.throw(TypeError, /http2/);
    });

    it("rejects an http2 server (plain and secure)", function() {
        (() => request(http2.createServer())).should.throw(TypeError, /http2/);
        (() => request(http2.createSecureServer({}))).should.throw(TypeError, /TLS server/);
    });

    it("rejects something that is not an application", function() {
        (() => request(undefined)).should.throw(TypeError, /unsupported application/);
        (() => request({})).should.throw(TypeError, /unsupported application/);
    });
});
