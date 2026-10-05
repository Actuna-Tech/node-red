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
 *   #40: tests of the 503 answer of the drain of the HTTP requests (headers, cleared headers,
 *   HEAD, Connection: close, Retry-After)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const http = require("http");
const NR_TEST_UTILS = require("nr-test-utils");
const httpNodeResponse = NR_TEST_UTILS.require("@node-red/runtime/lib/httpNodeResponse");

describe("runtime/httpNodeResponse (#40)", function() {
    let server;
    let port;
    // The handler that answers the next request: (req, res) => void
    let handler;

    before(function(done) {
        server = http.createServer(function(req, res) { handler(req, res) });
        server.listen(0, "127.0.0.1", function() {
            port = server.address().port;
            done();
        });
    });
    after(function(done) {
        server.close(done);
    });

    function call(method) {
        return new Promise(function(resolve, reject) {
            const req = http.request({ host: "127.0.0.1", port: port, path: "/x", method: method || "GET", agent: false }, function(res) {
                const chunks = [];
                res.on("data", d => chunks.push(d));
                res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString(), message: res.statusMessage }));
            });
            req.on("error", reject);
            req.end();
        });
    }

    it("answers 503 with the fixed JSON body, no-store and Retry-After", async function() {
        handler = (req, res) => httpNodeResponse.sendUnavailable(req, res, { code: "c1", message: "m1", retryAfter: 3 });
        const res = await call();
        res.status.should.equal(503);
        res.headers["retry-after"].should.equal("3");
        res.headers["cache-control"].should.equal("no-store");
        res.headers["content-type"].should.match(/^application\/json/);
        res.headers["content-length"].should.equal(String(Buffer.byteLength(res.text)));
        JSON.parse(res.text).should.eql({ code: "c1", message: "m1" });
    });

    it("sends no Retry-After for null and for undefined", async function() {
        for (const retryAfter of [null, undefined]) {
            handler = (req, res) => httpNodeResponse.sendUnavailable(req, res, { code: "c", message: "m", retryAfter: retryAfter });
            const res = await call();
            res.status.should.equal(503);
            res.headers.should.not.have.property("retry-after");
        }
    });

    it("sends Connection: close with close", async function() {
        handler = (req, res) => httpNodeResponse.sendUnavailable(req, res, { code: "c", message: "m", retryAfter: 1, close: true });
        const res = await call();
        res.status.should.equal(503);
        res.headers.connection.should.equal("close");
    });

    it("HEAD gets the headers and no body", async function() {
        handler = (req, res) => httpNodeResponse.sendUnavailable(req, res, { code: "c", message: "m", retryAfter: 1 });
        const res = await call("HEAD");
        res.status.should.equal(503);
        res.text.should.equal("");
        res.headers["content-length"].should.not.equal("0");
    });

    describe("clearHeaders", function() {
        function setEarlier(res) {
            res.setHeader("Set-Cookie", "sid=secret");
            res.setHeader("Content-Encoding", "gzip");
            res.setHeader("ETag", "\"abc\"");
            res.setHeader("X-Custom", "1");
            res.setHeader("Content-Type", "text/html");
            res.setHeader("Access-Control-Allow-Origin", "https://a.example");
            res.setHeader("Access-Control-Allow-Credentials", "true");
            res.setHeader("Vary", "Origin");
            res.statusMessage = "Custom phrase";
        }
        it("removes the headers set before, except Access-Control-* and Vary", async function() {
            handler = (req, res) => { setEarlier(res); httpNodeResponse.sendUnavailable(req, res, { code: "c", message: "m", retryAfter: 1, clearHeaders: true }) };
            const res = await call();
            res.status.should.equal(503);
            res.headers.should.not.have.property("set-cookie");
            res.headers.should.not.have.property("content-encoding");
            res.headers.should.not.have.property("etag");
            res.headers.should.not.have.property("x-custom");
            res.headers["content-type"].should.match(/^application\/json/);
            res.headers["access-control-allow-origin"].should.equal("https://a.example");
            res.headers["access-control-allow-credentials"].should.equal("true");
            res.headers.vary.should.equal("Origin");
            res.message.should.equal("Service Unavailable");
            JSON.parse(res.text).should.eql({ code: "c", message: "m" });
        });
        it("keeps the headers set before without clearHeaders", async function() {
            handler = (req, res) => { setEarlier(res); httpNodeResponse.sendUnavailable(req, res, { code: "c", message: "m", retryAfter: 1 }) };
            const res = await call();
            res.headers["set-cookie"].should.eql(["sid=secret"]);
            res.headers["x-custom"].should.equal("1");
        });
    });
});
