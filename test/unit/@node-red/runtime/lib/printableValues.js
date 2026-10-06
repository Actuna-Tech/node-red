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
 *   #75, #76: new test fixture - the error values (nullish, unprintable and
 *   ordinary ones) that reporting an error must survive, with the text that
 *   the reporting must produce for each of them
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * The text for a value that cannot be printed (the same as in the runtime).
 */
const NOT_PRINTABLE = "(the value cannot be printed)";

function throwingMessage() {
    const err = new Error("x");
    Object.defineProperty(err, "message", {get: function() { throw new Error("getter of message") }});
    return err;
}

function throwingName() {
    const err = new Error("x");
    Object.defineProperty(err, "name", {get: function() { throw new Error("getter of name") }});
    return err;
}

function revokedProxy() {
    const r = Proxy.revocable({}, {});
    r.revoke();
    return r.proxy;
}

/**
 * The values that cannot be printed (or have no text): V1-V12 of the specification.
 * `make()` creates a fresh value each time; `text` is the text expected for the
 * rules of `errorText` (based on `toString`).
 */
const unprintable = [
    {name: "V1 undefined", make: () => undefined, text: "undefined"},
    {name: "V2 null", make: () => null, text: "null"},
    {name: "V3 Object.create(null)", make: () => Object.create(null), text: NOT_PRINTABLE},
    {name: "V4 toString throws an Error", make: () => ({toString: function() { throw new Error("t") }}), text: NOT_PRINTABLE},
    {name: "V5 toString throws undefined", make: () => ({toString: function() { throw undefined }}), text: NOT_PRINTABLE},
    {name: "V6 getter of toString throws", make: () => Object.defineProperty({}, "toString", {get: function() { throw new Error("g") }}), text: NOT_PRINTABLE},
    {name: "V7 toString is not a function", make: () => ({toString: 5}), text: NOT_PRINTABLE},
    {name: "V8 Error with a throwing getter of message", make: throwingMessage, text: NOT_PRINTABLE},
    {name: "V8 Error with a throwing getter of name", make: throwingName, text: NOT_PRINTABLE},
    {name: "V9 Proxy that throws on every get", make: () => new Proxy({}, {get: function() { throw new Error("p") }}), text: NOT_PRINTABLE},
    {name: "V10 revoked Proxy", make: revokedProxy, text: NOT_PRINTABLE},
    {name: "V11 toString returns an object without a prototype", make: () => ({toString: function() { return Object.create(null) }}), text: NOT_PRINTABLE},
    {name: "V12 toString returns a Symbol", make: () => ({toString: function() { return Symbol("y") }}), text: NOT_PRINTABLE}
];

function customError() {
    const err = new Error("c");
    err.name = "CustomError";
    return err;
}

function longError() {
    return new Error("x".repeat(100000));
}

function f() {}

/**
 * The values whose text is printed today: V13-V22 of the specification. `text`
 * is the text of `errorText` (the line must stay the same byte for byte);
 * `rendered` is the same text as a catalog (i18next) renders it today - an
 * `undefined` or `null` is an empty text, any other value is concatenated.
 */
const printable = [
    {name: "V13 Error", make: () => new Error("s"), text: "Error: s"},
    {name: "V14 TypeError", make: () => new TypeError("t"), text: "TypeError: t"},
    {name: "V14 Error with an own name", make: customError, text: "CustomError: c"},
    {name: "V14 Error with an empty message", make: () => new Error(""), text: "Error"},
    {name: "V15 string", make: () => "text", text: "text"},
    {name: "V15 empty string", make: () => "", text: ""},
    {name: "V16 number", make: () => 42, text: "42"},
    {name: "V16 NaN", make: () => NaN, text: "NaN"},
    {name: "V16 false", make: () => false, text: "false"},
    {name: "V16 bigint", make: () => BigInt(10), text: "10"},
    {name: "V17 Symbol", make: () => Symbol("x"), text: "Symbol(x)"},
    {name: "V18 object that looks like an error", make: () => ({message: "m"}), text: "[object Object]"},
    {name: "V18 array", make: () => [1, 2], text: "1,2"},
    {name: "V19 function", make: () => f, text: String(f)},
    {name: "V20 own toString", make: () => ({toString: function() { return "own" }}), text: "own"},
    {name: "V21 toString returns a number", make: () => ({toString: function() { return 5 }}), text: "5", notString: true},
    {name: "V22 toString returns undefined", make: () => ({toString: function() {}}), text: "", notString: true},
    {name: "V24 Error with a message of 100000 characters", make: longError, text: "Error: " + "x".repeat(100000)}
];

/**
 * How a catalog (i18next with `escapeValue: false`) renders an interpolated value.
 */
function render(value) {
    return value === undefined || value === null ? "" : "" + value;
}

module.exports = {
    NOT_PRINTABLE: NOT_PRINTABLE,
    unprintable: unprintable,
    printable: printable,
    render: render
};
