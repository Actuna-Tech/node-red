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
 *   #63: new file - tests of the copy of RED.hooks in the editor, driven by the case table of the runtime copy
 *   (test/unit/@node-red/util/lib/hooks-cases.js): the editor gives the same outcomes as the runtime
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");

const NR_TEST_UTILS = require("nr-test-utils");
const shared = require("../util/lib/hooks-cases");

const hooksModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/hooks.js");

describe("editor-client/hooks (#63)", function() {
    let savedRED;
    let warn;
    let unhandled;
    let onUnhandled;
    let impl;

    beforeEach(function() {
        savedRED = global.RED;
        global.RED = {};
        delete require.cache[hooksModulePath];
        require(hooksModulePath);
        impl = RED.hooks;
        warn = sinon.stub(console, "warn");
        unhandled = [];
        onUnhandled = reason => unhandled.push(reason);
        process.on("unhandledRejection", onUnhandled);
    });

    afterEach(async function() {
        // let a rejection of a case that nobody handled arrive before the check
        await shared.macrotask();
        process.removeListener("unhandledRejection", onUnhandled);
        warn.restore();
        impl.clear();
        delete require.cache[hooksModulePath];
        if (savedRED === undefined) {
            delete global.RED;
        } else {
            global.RED = savedRED;
        }
    });

    it("is RED.hooks", function() {
        ["has", "clear", "add", "remove", "trigger"].forEach(name => impl.should.have.property(name).which.is.a.Function());
    });

    describe("the shared case table (the same outcomes as the runtime copy, I-3)", function() {
        shared.cases.forEach(function(testCase) {
            ["promise", "callback"].forEach(function(form) {
                it(testCase.ac + ": " + testCase.id + " (" + form + " form)", async function() {
                    const observed = await shared.exercise(impl, testCase, form);
                    shared.assertOutcome(testCase, observed, form);
                    // a rejection that nobody handled (checked in the test: a failed hook would stop the rest of the suite)
                    await shared.macrotask();
                    unhandled.map(String).should.eql([], "an unhandled rejection");
                });
            });
        });
    });

    describe("B6-AC-1: the warning at the registration of a handler without parameters", function() {
        shared.registrations.filter(r => !r.runtimeOnly).forEach(function(registration) {
            it(registration.id + ": " + registration.warns + " warning" + (registration.warns === 1 ? "" : "s"), function() {
                const result = shared.register(impl, registration);
                if (registration.nonFunction) {
                    // as before: the editor copy refuses a handler that is not a function
                    should.exist(result.threw);
                    result.threw.message.should.containEql("Callback must be a function");
                } else {
                    should.not.exist(result.threw);
                }
                warn.callCount.should.equal(registration.warns);
                if (registration.warns === 1) {
                    const text = String(warn.firstCall.args.join(" "));
                    text.should.containEql(registration.hookId.split(".")[0]);
                    text.should.containEql("(payload, done)");
                    text.should.containEql("(payload)");
                    text.should.containEql("done");
                }
            });
        });

        it("one warning per registration, not per run", async function() {
            impl.add("onSend.z", function() {});
            warn.callCount.should.equal(1);
            impl.trigger("onSend", {}, function() {});
            await shared.sleep(20);
            warn.callCount.should.equal(1);
        });
    });

    describe("what the editor copy did before and keeps", function() {
        it("a hook id that is not one of the known ones is accepted (knownHooksOnly is off)", function() {
            impl.add("anyName.x", function(payload) {});
            impl.has("anyName.x").should.be.true();
        });

        it("a labelled hook cannot be registered twice and is removed by its label", function() {
            impl.add("viewAddNode.a", function(payload) {});
            (() => impl.add("viewAddNode.a", function(payload) {})).should.throw(/already registered/);
            impl.remove("viewAddNode.a");
            impl.has("viewAddNode.a").should.be.false();
        });

        it("trigger without a handler resolves, and calls done once", async function() {
            should(await impl.trigger("nothingHere", {})).equal(undefined);
            const calls = [];
            impl.trigger("nothingHere", {}, function() { calls.push(Array.prototype.slice.call(arguments)); });
            calls.should.eql([[]]);
        });
    });
});
