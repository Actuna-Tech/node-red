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
 *   #63: new file - an onSend handler that throws a falsy value in a flow: the message is not delivered and the
 *   sending node reports an error (B6-AC-2, the effect on message routing)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const helper = require("node-red-node-test-helper");
const { hooks } = require("nr-test-utils").require("@node-red/util");

describe("message routing with an onSend handler that throws a falsy value (#63)", function() {
    before(function(done) {
        helper.startServer(done);
    });
    after(function(done) {
        helper.stopServer(done);
    });
    afterEach(function() {
        hooks.clear();
        return helper.unload();
    });

    const flow = [{ id: "n1", type: "helper", wires: [["n2"]] }, { id: "n2", type: "helper" }];

    // sends one message from n1 with the handler registered; resolves with what happened within `waitMs`
    function run(handler, waitMs) {
        return new Promise(function(resolve) {
            helper.load([], flow, function() {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                const outcome = { delivered: [], errors: [], handlerCalls: 0 };
                hooks.add("onSend.t63", function(payload) {
                    outcome.handlerCalls++;
                    return handler(payload);
                });
                n1.on("call:error", function(call) { outcome.errors.push(call.args[0]); });
                n2.on("input", function(msg) { outcome.delivered.push(msg); });
                n1.send({ payload: "x" });
                setTimeout(function() { resolve(outcome); }, waitMs || 100);
            });
        });
    }

    [
        ["undefined", undefined],
        ["null", null],
        ["false", false],
        ["0", 0],
        ["an empty text", ""]
    ].forEach(function(entry) {
        it("B6-AC-2: a handler that throws " + entry[0] + ": the message is not delivered and the node reports an error", async function() {
            const outcome = await run(function() { throw entry[1]; });
            outcome.handlerCalls.should.equal(1);
            outcome.delivered.should.have.length(0);
            outcome.errors.should.have.length(1);
            String(outcome.errors[0] instanceof Error ? outcome.errors[0].message : outcome.errors[0])
                .should.containEql("Hook handler rejected without an error");
        });
    });

    it("B6-AC-6 (unchanged): a handler that does nothing: the message is delivered, no error", async function() {
        const outcome = await run(function() {});
        outcome.delivered.should.have.length(1);
        outcome.errors.should.have.length(0);
    });

    it("B6-AC-6 (unchanged): a handler that returns false halts the message quietly", async function() {
        const outcome = await run(function() { return false; });
        outcome.delivered.should.have.length(0);
        outcome.errors.should.have.length(0);
    });
});
