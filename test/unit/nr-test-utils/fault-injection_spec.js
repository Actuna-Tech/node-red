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
 *   #68: new file - tests of the helpers for the tests of write errors
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { settle, flush, trackRejections, stubFsWrite, fsError } = require("nr-test-utils/fault-injection");

describe("nr-test-utils/fault-injection", function() {
    describe("settle", function() {
        it("reports a resolved promise", async function() {
            const result = await settle(Promise.resolve(5));
            result.should.eql({ state: "resolved", value: 5 });
        });
        it("reports a rejected promise", async function() {
            const err = new Error("x");
            const result = await settle(Promise.reject(err));
            result.state.should.equal("rejected");
            result.err.should.equal(err);
        });
        it("reports a promise that does not settle as a timeout", async function() {
            const result = await settle(new Promise(function() {}), 20);
            result.should.eql({ state: "timeout" });
        });
        it("ends also with fake timers installed", async function() {
            const clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            try {
                const result = await settle(new Promise(function() {}), 20);
                result.state.should.equal("timeout");
            } finally {
                clock.restore();
            }
        });
    });

    describe("trackRejections", function() {
        it("reports a rejection without a handler", async function() {
            const tracker = trackRejections();
            tracker.reject(new Error("lost"));
            await flush();
            tracker.dropped().should.have.length(1);
            tracker.dropped()[0].message.should.equal("lost");
        });
        it("does not report a rejection handled with catch", async function() {
            const tracker = trackRejections();
            tracker.reject(new Error("seen")).catch(function() {});
            await flush();
            tracker.dropped().should.have.length(0);
        });
        it("does not report a rejection handled with the second argument of then", async function() {
            const tracker = trackRejections();
            tracker.reject(new Error("seen")).then(function() {}, function() {});
            await flush();
            tracker.dropped().should.have.length(0);
        });
        it("does not report a rejection that is awaited and caught", async function() {
            const tracker = trackRejections();
            try {
                await tracker.reject(new Error("seen"));
            } catch (err) {}
            await flush();
            tracker.dropped().should.have.length(0);
        });
        it("reports the promise derived with then without a rejection handler", async function() {
            const tracker = trackRejections();
            tracker.reject(new Error("lost")).then(function() {});
            await flush();
            tracker.dropped().should.have.length(1);
        });
        it("does not report the derived promise when the caller handles it", async function() {
            const tracker = trackRejections();
            tracker.reject(new Error("seen")).then(function() {}).catch(function() {});
            await flush();
            tracker.dropped().should.have.length(0);
        });
        it("reports the promise derived with a handler that throws again", async function() {
            const tracker = trackRejections();
            tracker.reject(new Error("first")).then(null, function(err) { throw err });
            await flush();
            tracker.dropped().should.have.length(1);
        });
        it("does not report a resolved promise", async function() {
            const tracker = trackRejections();
            tracker.resolve(1).then(function() {});
            await flush();
            tracker.dropped().should.have.length(0);
        });
    });

    describe("stubFsWrite and fsError", function() {
        let sandbox;
        let dir;
        beforeEach(function() {
            sandbox = sinon.createSandbox();
            dir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-test-"));
        });
        afterEach(function() {
            sandbox.restore();
            fs.rmSync(dir, { recursive: true, force: true });
        });
        function writeThroughStream(file, content) {
            return new Promise(function(resolve) {
                const stream = fs.createWriteStream(file);
                stream.on("error", function(err) { resolve({ err: err }) });
                stream.end(content, function(err) { resolve(err ? { err: err } : {}) });
            });
        }
        it("fails the write with the given error", async function() {
            stubFsWrite(sandbox, function() { return fsError("ENOSPC") });
            const result = await settle(writeThroughStream(path.join(dir, "a"), "data"));
            result.value.err.code.should.equal("ENOSPC");
        });
        it("writes a part of the data and then the rest", async function() {
            const stub = stubFsWrite(sandbox, function(n) { return n === 1 ? { bytes: 3 } : undefined });
            const file = path.join(dir, "b");
            const result = await settle(writeThroughStream(file, "NEW-CONTENT"));
            result.value.should.eql({});
            fs.readFileSync(file, "utf8").should.equal("NEW-CONTENT");
            stub.callCount.should.be.above(1);
        });
        it("writes as usual when the plan returns nothing", async function() {
            stubFsWrite(sandbox, function() {});
            const file = path.join(dir, "c");
            const result = await settle(writeThroughStream(file, "plain"));
            result.value.should.eql({});
            fs.readFileSync(file, "utf8").should.equal("plain");
        });
    });
});
