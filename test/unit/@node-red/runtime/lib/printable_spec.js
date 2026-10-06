/**
 * Copyright JS Foundation and other contributors, http://js.foundation
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
 *   #75, #76: new test file - the text of an error value for the log
 *   (errorText, messageText of runtime/lib/printable.js): never throws, always a string, the text of
 *   every value that is printed today stays the same
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const fs = require("fs");
const NR_TEST_UTILS = require("nr-test-utils");
const values = require("./printableValues");

describe("runtime/printable (#75, #76)", function() {
    const NOT_PRINTABLE = values.NOT_PRINTABLE;
    // required in every test, so that each test fails by itself while the module does not exist
    function P() {
        return NR_TEST_UTILS.require("@node-red/runtime/lib/printable");
    }

    // a call that throws must not stop the other checks of a test with a hostile value in its name
    function call(fn, value) {
        try {
            return fn(value);
        } catch (err) {
            let text;
            try { text = String(err) } catch (e) { text = NOT_PRINTABLE }
            throw new Error("the function threw: " + text);
        }
    }

    it("AC-18: exports NOT_PRINTABLE, errorText and messageText", function() {
        P().NOT_PRINTABLE.should.equal("(the value cannot be printed)");
        P().errorText.should.be.a.Function();
        P().messageText.should.be.a.Function();
    });

    it("AC-18 / I-13: the module has no require() and is not a part of the node API", function() {
        const file = NR_TEST_UTILS.resolve("@node-red/runtime/lib/printable.js");
        fs.readFileSync(file, "utf8").indexOf("require(").should.equal(-1);
        const util = NR_TEST_UTILS.require("@node-red/util");
        Object.keys(util).forEach(k => should.not.exist(util[k] && util[k].errorText));
    });

    describe("errorText (the text of toString, AC-1, AC-7, AC-18)", function() {
        values.unprintable.forEach(function(v) {
            it("AC-18: " + v.name + " gives " + JSON.stringify(v.text), function() {
                const text = call(P().errorText, v.make());
                (typeof text).should.equal("string");
                text.should.equal(v.text);
            });
        });
        values.printable.forEach(function(v) {
            it("AC-18: " + v.name + " gives " + JSON.stringify(v.text.length > 40 ? v.text.slice(0, 40) + "..." : v.text), function() {
                const text = call(P().errorText, v.make());
                (typeof text).should.equal("string");
                text.should.equal(v.text);
            });
        });

        it("AC-18: the text of a very long string is not cut", function() {
            call(P().errorText, "y".repeat(1000000)).should.have.length(1000000);
        });

        it("AC-8 / I-8: toString is called exactly once (a text, a throw)", function() {
            let calls = 0;
            call(P().errorText, { toString: function() { calls++; return "x" } }).should.equal("x");
            calls.should.equal(1);
            calls = 0;
            call(P().errorText, { toString: function() { calls++; throw new Error("t") } }).should.equal(NOT_PRINTABLE);
            calls.should.equal(1);
        });

        it("AC-18 / I-8: the getter of toString is read exactly once", function() {
            let reads = 0;
            const value = Object.defineProperty({}, "toString", { get: function() { reads++; return function() { return "g" } } });
            call(P().errorText, value).should.equal("g");
            reads.should.equal(1);
        });

        it("I-8: for undefined and null no property is read", function() {
            call(P().errorText, undefined).should.equal("undefined");
            call(P().errorText, null).should.equal("null");
        });
    });

    describe("messageText (the message, AC-18)", function() {
        function throwingMessage() {
            const err = new Error("x");
            Object.defineProperty(err, "message", { get: function() { throw new Error("getter") } });
            return err;
        }
        function revoked() {
            const r = Proxy.revocable({}, {});
            r.revoke();
            return r.proxy;
        }
        [
            ["undefined", () => undefined, "undefined"],
            ["null", () => null, "null"],
            ["new Error(\"s\")", () => new Error("s"), "s"],
            ["new Error(\"\")", () => new Error(""), "Error"],
            ["new TypeError(\"t\")", () => new TypeError("t"), "t"],
            ["{message: \"m\"}", () => ({ message: "m" }), "m"],
            ["{message: 5}", () => ({ message: 5 }), "5"],
            ["\"text\"", () => "text", "text"],
            ["\"\"", () => "", ""],
            ["0", () => 0, "0"],
            ["false", () => false, "false"],
            ["Symbol(\"x\")", () => Symbol("x"), "Symbol(x)"],
            ["[1, 2]", () => [1, 2], "1,2"],
            ["{}", () => ({}), "[object Object]"],
            ["{message: \"\"}", () => ({ message: "" }), "[object Object]"],
            ["Object.create(null)", () => Object.create(null), NOT_PRINTABLE],
            ["an Error with a throwing getter of message", throwingMessage, NOT_PRINTABLE],
            ["a Proxy that throws on every get", () => new Proxy({}, { get: function() { throw 1 } }), NOT_PRINTABLE],
            ["a revoked Proxy", revoked, NOT_PRINTABLE],
            ["{message: Object.create(null)}", () => ({ message: Object.create(null) }), NOT_PRINTABLE],
            ["{message: Symbol(\"y\")}", () => ({ message: Symbol("y") }), NOT_PRINTABLE]
        ].forEach(function(row) {
            it("AC-18: " + row[0] + " gives " + JSON.stringify(row[2]), function() {
                const text = call(P().messageText, row[1]());
                (typeof text).should.equal("string");
                text.should.equal(row[2]);
            });
        });

        it("AC-18 / I-10: the getter of message is read exactly once", function() {
            let reads = 0;
            const value = Object.defineProperty({}, "message", { get: function() { reads++; return "once" } });
            call(P().messageText, value).should.equal("once");
            reads.should.equal(1);
        });

        it("AC-18: does not print the content of an object (no JSON, no inspect)", function() {
            call(P().messageText, { password: "secret", url: "mqtt://u:p@h" }).should.equal("[object Object]");
            call(P().errorText, { password: "secret" }).should.equal("[object Object]");
        });

        it("AC-18: the message of a very long Error is not cut", function() {
            call(P().messageText, new Error("z".repeat(100000))).should.have.length(100000);
        });
    });

    describe("every function always returns a string and never throws (I-10)", function() {
        const all = values.unprintable.concat(values.printable);
        ["errorText", "messageText"].forEach(function(name) {
            all.forEach(function(v) {
                it("AC-18: " + name + " of " + v.name + " is a string", function() {
                    (typeof call(P()[name], v.make())).should.equal("string");
                });
            });
        });
    });
});
