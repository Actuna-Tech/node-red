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
 *   #63: new file - the case table of the semantics of a hook chain (what a handler may do and what then happens), shared
 *   by the tests of the runtime copy (util/lib/hooks.js) and of the editor copy (editor-client/src/js/hooks.js), so that
 *   the two copies are held to the same outcomes
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * The cases of the table are run by both copies of `RED.hooks` through the same functions here:
 *
 *   const observed = await exercise(impl, testCase, "promise" | "callback");
 *   assertOutcome(testCase, observed, form);
 *
 * `impl` is `{ add(hookId, fn), remove(hookId), trigger(id, payload, done) }` (the runtime module, or `RED.hooks` of the editor).
 *
 * A case has:
 *   - `id`: the title; `ac`: the acceptance criterion of the spec of #63 (B6-AC-n)
 *   - `handlers(ctx)`: the handlers that are registered, in order, as `onSend.h0`, `onSend.h1`, ...; the tracer `B`
 *     (a one-parameter handler that records "B") is registered after them
 *   - `control(ctx)` (optional): runs after `trigger` was called (it resolves a deferred promise, removes a handler)
 *   - `expect`: `kind` - "resolve" (the chain ends, `done()` without a value), "halt" (`false`), "reject" (an error;
 *     `message` is the message of the error of the promise form; `raw` is the value that the callback form hands
 *     to `done` when it is a value that is not turned into an Error, `anyError` - only that it is an error or a value),
 *     "pending" (the chain never ends: nothing is settled within 60 ms);
 *     `calls` - what ran, in order ("A", "B", and the markers a case writes); `identity` - the error is the very object the
 *     handler used; `ignored` - how many later outcomes of a handler the runtime copy logs at debug level
 *   - `settleMs` (optional): how long to wait for late calls before the result is read (default: 2 macrotasks)
 *
 * Every handler that could be called again by a defect is limited by `ctx.enter`: it throws when it is called more than
 * CAP times, so a defect gives a failed assertion and not an endless loop of microtasks.
 */

const should = require("should");

const CAP = 6;
const PREFIX = "Hook handler rejected without an error: ";
const NOT_PRINTABLE = "(the value cannot be printed)";

function falsyMessage(value) {
    return PREFIX + (typeof value === "string" ? JSON.stringify(value) : String(value));
}

// What a case records: the names of the handlers that ran, in order, and the errors the handlers used
function createContext() {
    const ctx = {
        log: [],
        counts: {},
        thrown: undefined,
        impl: null,
        // a handler enters: it is recorded, and a handler that is called too often is stopped
        enter: function(name) {
            ctx.log.push(name);
            ctx.counts[name] = (ctx.counts[name] || 0) + 1;
            if (ctx.counts[name] > CAP) {
                throw new Error("handler " + name + " was called more than " + CAP + " times");
            }
        },
        // a deferred promise: resolve/reject are called by `control`
        deferred: function() {
            const d = {};
            d.promise = new Promise(function(resolve, reject) { d.resolve = resolve; d.reject = reject; });
            return d;
        },
        remove: function(index) {
            ctx.impl.remove("onSend.h" + index);
        }
    };
    return ctx;
}

const falsyValues = [
    ["undefined", undefined],
    ["null", null],
    ["false", false],
    ["0", 0],
    ["-0", -0],
    ["0n", BigInt(0)],
    ["NaN", NaN],
    ['""', ""]
];

// Values that `new Error(value)` cannot turn into text (#76)
const unprintable = [
    ["a Symbol", function() { return Symbol("s"); }],
    ["an object without a prototype", function() { return Object.create(null); }],
    ["a Proxy whose get throws", function() { return new Proxy({}, { get: function() { throw new Error("proxy get throws"); } }); }]
];

const cases = [];

function add(testCase) {
    cases.push(testCase);
}

// ------------------------------------------------------------------------------------------------------------
// B6-AC-6: what works today stays as it is (rows 6.1, 6.2, 6.6, 6.7, 6.16, 6.17, 6.21)
// ------------------------------------------------------------------------------------------------------------
add({
    id: "6.1 a one-parameter handler that returns nothing: the next handler runs",
    ac: "B6-AC-6",
    handlers: ctx => [function(payload) { ctx.enter("A"); }],
    expect: { kind: "resolve", calls: ["A", "B"] }
});
add({
    id: "6.1 a one-parameter handler that returns a value that is not false: the value is not looked at",
    ac: "B6-AC-6",
    handlers: ctx => [function(payload) { ctx.enter("A"); return 5; }],
    expect: { kind: "resolve", calls: ["A", "B"] }
});
add({
    id: "6.1 a one-parameter handler that returns false halts the chain",
    ac: "B6-AC-6",
    handlers: ctx => [function(payload) { ctx.enter("A"); return false; }],
    expect: { kind: "halt", calls: ["A"] }
});
add({
    id: "6.1 a one-parameter handler that returns a resolved promise: the next handler runs",
    ac: "B6-AC-6",
    handlers: ctx => [function(payload) { ctx.enter("A"); return Promise.resolve(); }],
    expect: { kind: "resolve", calls: ["A", "B"] }
});
add({
    id: "6.1 a promise resolved with a value ends the chain with that value",
    ac: "B6-AC-6",
    handlers: ctx => [function(payload) { ctx.enter("A"); return Promise.resolve("val"); }],
    expect: { kind: "reject", message: "val", raw: "val", calls: ["A"] }
});
add({
    id: "6.1 a promise resolved with false halts the chain",
    ac: "B6-AC-6",
    handlers: ctx => [function(payload) { ctx.enter("A"); return Promise.resolve(false); }],
    expect: { kind: "halt", calls: ["A"] }
});
add({
    id: "6.2 a handler with done that calls done() once: the next handler runs",
    ac: "B6-AC-6",
    handlers: ctx => [function(payload, done) { ctx.enter("A"); done(); }],
    expect: { kind: "resolve", calls: ["A", "B"] }
});
add({
    id: "6.2 a handler with done that calls done(error) once ends the chain with that error",
    ac: "B6-AC-6",
    handlers: ctx => [function(payload, done) { ctx.enter("A"); ctx.thrown = new Error("e"); done(ctx.thrown); }],
    expect: { kind: "reject", message: "e", identity: true, calls: ["A"] }
});
add({
    id: "6.2 a handler with done that calls done(false) halts the chain",
    ac: "B6-AC-6",
    handlers: ctx => [function(payload, done) { ctx.enter("A"); done(false); }],
    expect: { kind: "halt", calls: ["A"] }
});
add({
    id: "6.2 a handler with done that calls done(text): the callback form gets the text, the promise form an Error with it",
    ac: "B6-AC-6",
    handlers: ctx => [function(payload, done) { ctx.enter("A"); done("text"); }],
    expect: { kind: "reject", message: "text", raw: "text", calls: ["A"] }
});
add({
    id: "6.6 a default parameter: function(payload, done = x) has the length 1 and is a one-parameter handler",
    ac: "B6-AC-6",
    handlers: ctx => [function(payload, done = function() {}) { ctx.enter("A"); }],
    expect: { kind: "resolve", calls: ["A", "B"] }
});
add({
    id: "6.7 a synchronous throw of an Error ends the chain with that Error",
    ac: "B6-AC-6",
    handlers: ctx => [function(payload) { ctx.enter("A"); ctx.thrown = new Error("boom"); throw ctx.thrown; }],
    expect: { kind: "reject", message: "boom", identity: true, calls: ["A"] }
});
add({
    id: "6.7 a synchronous throw of a text: the callback form gets the text, the promise form an Error with it",
    ac: "B6-AC-6",
    handlers: ctx => [function(payload) { ctx.enter("A"); throw "text"; }],
    expect: { kind: "reject", message: "text", raw: "text", calls: ["A"] }
});
add({
    id: "6.16 a thenable whose then getter throws ends the chain with that error",
    ac: "B6-AC-6",
    handlers: ctx => [function(payload) {
        ctx.enter("A");
        return { get then() { throw new Error("getter"); } };
    }],
    expect: { kind: "reject", message: "getter", calls: ["A"] }
});
add({
    id: "6.17 a native promise: the next handler runs in the microtask turn that follows the settled promise, as before",
    ac: "B6-AC-6",
    handlers: ctx => [function(payload) {
        ctx.enter("A");
        queueMicrotask(function() { ctx.log.push("t1"); });
        queueMicrotask(function() { queueMicrotask(function() { ctx.log.push("t2"); }); });
        return Promise.resolve();
    }],
    expect: { kind: "resolve", calls: ["A", "t1", "B", "t2"] }
});
add({
    id: "6.21 a handler that is removed while its promise is pending: the chain goes on with the next handler",
    ac: "B6-AC-6",
    handlers: ctx => {
        ctx.pending = ctx.deferred();
        return [function(payload) { ctx.enter("A"); return ctx.pending.promise; }];
    },
    control: async function(ctx) {
        ctx.remove(0);
        ctx.pending.resolve();
    },
    expect: { kind: "resolve", calls: ["A", "B"] }
});

// ------------------------------------------------------------------------------------------------------------
// B6-AC-2: a falsy synchronous throw is an error (rows 6.8, 6.9)
// ------------------------------------------------------------------------------------------------------------
falsyValues.forEach(function(entry) {
    const name = entry[0];
    const value = entry[1];
    add({
        id: "6.8 a one-parameter handler throws " + name + ": an Error, the next handler does not run",
        ac: "B6-AC-2",
        handlers: ctx => [function(payload) { ctx.enter("A"); throw value; }],
        expect: { kind: "reject", message: falsyMessage(value), calls: ["A"] }
    });
    add({
        id: "6.9 a two-parameter handler throws " + name + " before it calls done: an Error, the next handler does not run",
        ac: "B6-AC-2",
        handlers: ctx => [function(payload, done) { ctx.enter("A"); throw value; }],
        expect: { kind: "reject", message: falsyMessage(value), calls: ["A"] }
    });
});

// ------------------------------------------------------------------------------------------------------------
// B6-AC-3: a rejection without a value, and a value that cannot be printed (rows 6.10, 6.11, 6.12)
// ------------------------------------------------------------------------------------------------------------
[
    ["Promise.reject()", function() { return Promise.reject(); }, undefined],
    ["Promise.reject(null)", function() { return Promise.reject(null); }, null],
    ["Promise.reject(0)", function() { return Promise.reject(0); }, 0],
    ["an async handler that throws undefined", async function() { throw undefined; }, undefined]
].forEach(function(entry) {
    add({
        id: "6.11 a handler returns " + entry[0] + ": an Error, the handler is called once, the next handler does not run",
        ac: "B6-AC-3",
        handlers: ctx => [function(payload) { ctx.enter("A"); return entry[1](); }],
        expect: { kind: "reject", message: falsyMessage(entry[2]), calls: ["A"] }
    });
});
unprintable.forEach(function(entry) {
    add({
        id: "6.12 a handler returns a promise that rejects with " + entry[0] + ": an Error '" + NOT_PRINTABLE + "'",
        ac: "B6-AC-3",
        handlers: ctx => [function(payload) { ctx.enter("A"); return Promise.reject(entry[1]()); }],
        expect: { kind: "reject", message: NOT_PRINTABLE, anyError: true, calls: ["A"] }
    });
    add({
        id: "6.10 a handler throws " + entry[0] + ": an Error '" + NOT_PRINTABLE + "'",
        ac: "B6-AC-3",
        handlers: ctx => [function(payload) { ctx.enter("A"); throw entry[1](); }],
        expect: { kind: "reject", message: NOT_PRINTABLE, anyError: true, calls: ["A"] }
    });
});

// ------------------------------------------------------------------------------------------------------------
// B6-AC-4: a thenable that settles more than once (rows 6.13, 6.14, 6.15)
// ------------------------------------------------------------------------------------------------------------
add({
    id: "6.13 a thenable that calls resolve() and then reject(undefined): the step ends once, with the first outcome",
    ac: "B6-AC-4",
    handlers: ctx => [function(payload) {
        ctx.enter("A");
        return { then: function(resolve, reject) { resolve(); reject(undefined); } };
    }],
    expect: { kind: "resolve", calls: ["A", "B"], ignored: 1 }
});
add({
    id: "6.14 a thenable that calls reject(error) and then resolve(): the step ends once with the error, the next handler does not run",
    ac: "B6-AC-4",
    handlers: ctx => [function(payload) {
        ctx.enter("A");
        ctx.thrown = new Error("e");
        return { then: function(resolve, reject) { reject(ctx.thrown); resolve(); } };
    }],
    expect: { kind: "reject", message: "e", identity: true, calls: ["A"], ignored: 1 }
});
add({
    id: "6.15 a thenable whose then throws without calling a callback: the chain ends once with that error",
    ac: "B6-AC-4",
    handlers: ctx => [function(payload) {
        ctx.enter("A");
        return { then: function() { throw new Error("t"); } };
    }],
    expect: { kind: "reject", message: "t", calls: ["A"] }
});
add({
    id: "6.15 a thenable that calls resolve() and then throws: the step ends once with the first outcome",
    ac: "B6-AC-4",
    handlers: ctx => [function(payload) {
        ctx.enter("A");
        return { then: function(resolve) { resolve(); throw new Error("t"); } };
    }],
    expect: { kind: "resolve", calls: ["A", "B"], ignored: 1 }
});

// ------------------------------------------------------------------------------------------------------------
// B6-AC-9: a handler step ends once (rows 6.19, 6.20)
// ------------------------------------------------------------------------------------------------------------
add({
    id: "6.19 a handler with done that calls done() twice in a row: the next handler runs once",
    ac: "B6-AC-9",
    handlers: ctx => [function(payload, done) { ctx.enter("A"); done(); done(); }],
    expect: { kind: "resolve", calls: ["A", "B"], ignored: 1 }
});
add({
    id: "6.19 a handler with done that calls done() again after 10 ms: the next handler runs once",
    ac: "B6-AC-9",
    handlers: ctx => [function(payload, done) { ctx.enter("A"); done(); setTimeout(done, 10); }],
    expect: { kind: "resolve", calls: ["A", "B"], ignored: 1 },
    settleMs: 60
});
add({
    id: "6.19 a handler with done that calls done() and then done(error) in a row: the error is ignored",
    ac: "B6-AC-9",
    handlers: ctx => [function(payload, done) { ctx.enter("A"); done(); done(new Error("late")); }],
    expect: { kind: "resolve", calls: ["A", "B"], ignored: 1 }
});
add({
    id: "6.19 a handler with done that calls done() and then done(error) after 10 ms: the error is ignored",
    ac: "B6-AC-9",
    handlers: ctx => [function(payload, done) { ctx.enter("A"); done(); setTimeout(function() { done(new Error("late")); }, 10); }],
    expect: { kind: "resolve", calls: ["A", "B"], ignored: 1 },
    settleMs: 60
});
add({
    id: "6.19 a handler with done that calls done(error) and then done(): the chain ends with the first, the error",
    ac: "B6-AC-9",
    handlers: ctx => [function(payload, done) { ctx.enter("A"); done(new Error("first")); done(); }],
    expect: { kind: "reject", message: "first", calls: ["A"], ignored: 1 }
});
add({
    id: "6.20 a handler with done that calls done() and then throws: the throw is ignored",
    ac: "B6-AC-9",
    handlers: ctx => [function(payload, done) { ctx.enter("A"); done(); throw new Error("after done"); }],
    expect: { kind: "resolve", calls: ["A", "B"], ignored: 1 }
});

// ------------------------------------------------------------------------------------------------------------
// B6-AC-1: a handler that declares no parameter is run as before (decision (a)): it gets (payload, done) and the
// chain ends only when it calls done (row 6.4)
// ------------------------------------------------------------------------------------------------------------
add({
    id: "6.4 a zero-parameter function that returns nothing: the chain never ends, as before",
    ac: "B6-AC-1",
    handlers: ctx => [function() { ctx.enter("A"); }],
    expect: { kind: "pending", calls: ["A"] }
});
add({
    id: "6.4 a zero-parameter arrow function: the chain never ends, as before",
    ac: "B6-AC-1",
    handlers: ctx => [() => { ctx.enter("A"); }],
    expect: { kind: "pending", calls: ["A"] }
});
add({
    id: "6.4 a zero-parameter async arrow function: the chain never ends, as before",
    ac: "B6-AC-1",
    handlers: ctx => [async () => { ctx.enter("A"); }],
    expect: { kind: "pending", calls: ["A"] }
});
add({
    id: "6.4 a zero-parameter function that calls arguments[1]() continues the chain, as before",
    ac: "B6-AC-1",
    handlers: ctx => [function() { ctx.enter("A"); arguments[1](); }],
    expect: { kind: "resolve", calls: ["A", "B"] }
});

// ------------------------------------------------------------------------------------------------------------
// B6-AC-1: the warning at registration (rows 6.3, 6.5, 6.5a, 6.5b)
// ------------------------------------------------------------------------------------------------------------
const registrations = [
    { id: "6.3 function() {}", hookId: "onSend.z", make: () => function() {}, warns: 1 },
    { id: "6.3 () => {}", hookId: "onSend.z", make: () => () => {}, warns: 1 },
    { id: "6.3 async () => {}", hookId: "onSend.z", make: () => async () => {}, warns: 1 },
    { id: "6.3 a zero-parameter handler of preReload", hookId: "preReload.z", make: () => function() {}, warns: 1, runtimeOnly: true },
    { id: "6.3 a zero-parameter handler without a label", hookId: "onSend", make: () => function() {}, warns: 1 },
    { id: "6.5a a one-parameter function", hookId: "onSend.z", make: () => function(payload) {}, warns: 0 },
    { id: "6.5a a two-parameter function", hookId: "onSend.z", make: () => function(payload, done) {}, warns: 0 },
    { id: "6.5a a one-parameter arrow function", hookId: "onSend.z", make: () => payload => {}, warns: 0 },
    { id: "6.5a a function with a default parameter (length 1)", hookId: "onSend.z", make: () => function(payload, done = function() {}) {}, warns: 0 },
    {
        id: "6.5a a function whose length getter throws", hookId: "onSend.z", warns: 0,
        make: function() {
            const fn = function(payload) {};
            Object.defineProperty(fn, "length", { get: function() { throw new Error("length getter throws"); } });
            return fn;
        }
    },
    {
        id: "6.5a a Proxy of a function whose get trap throws for length", hookId: "onSend.z", warns: 0,
        make: function() {
            return new Proxy(function(payload) {}, {
                get: function(target, key, receiver) {
                    if (key === "length") { throw new Error("length trap throws"); }
                    return Reflect.get(target, key, receiver);
                }
            });
        }
    },
    // a value that is no function: the runtime copy has no check of the type (as before), the editor copy refuses it (as before)
    { id: "6.5a a value that is not a function", hookId: "onSend.z", make: () => "text", warns: 0, nonFunction: true },
    // the deploy hooks are run as fn(event) by the runtime: no warning
    { id: "6.5 a zero-parameter handler of preDeploy", hookId: "preDeploy.z", make: () => function() {}, warns: 0, runtimeOnly: true },
    { id: "6.5 a zero-parameter handler of postDeploy", hookId: "postDeploy.z", make: () => function() {}, warns: 0, runtimeOnly: true }
];

// The hooks setting (settings.js) registers through the same `add`: runtime copy only
const settingsRegistrations = [
    { id: "6.5b a zero-parameter preShutdown of the hooks setting", hookId: "preShutdown.z", make: () => function() {}, warns: 1 },
    { id: "6.5b a zero-parameter preReload of the hooks setting", hookId: "preReload.z", make: () => function() {}, warns: 1 },
    { id: "6.5b a one-parameter preReload of the hooks setting", hookId: "preReload.z", make: () => function(payload) {}, warns: 0 }
];

// ------------------------------------------------------------------------------------------------------------
// Running a case and checking it
// ------------------------------------------------------------------------------------------------------------
function macrotask() {
    return new Promise(function(resolve) { setTimeout(resolve, 0); });
}

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// A printable form of a value for a message; it does not throw for a Symbol, an object without a prototype or a Proxy
function safeShow(value) {
    try {
        if (Array.isArray(value)) {
            return "[" + value.map(safeShow).join(", ") + "]";
        }
        return typeof value === "symbol" ? value.toString() : String(value);
    } catch (err) {
        return "(not printable)";
    }
}

/**
 * Runs a case in one form. Resolves with what happened.
 * @param {Object} impl - `{add, remove, trigger}` of a copy of the hooks
 * @param {Object} testCase
 * @param {"promise"|"callback"} form
 */
async function exercise(impl, testCase, form) {
    const ctx = createContext();
    ctx.impl = impl;
    const handlers = testCase.handlers(ctx);
    handlers.forEach(function(handler, index) {
        impl.add("onSend.h" + index, handler);
    });
    impl.add("onSend.tracer", function(payload) { ctx.log.push("B"); });
    const payload = { payload: "p" };
    const observed = { ctx: ctx, form: form, dones: [], state: "pending" };
    if (form === "promise") {
        impl.trigger("onSend", payload).then(function(value) {
            observed.state = "resolved";
            observed.value = value;
        }, function(err) {
            observed.state = "rejected";
            observed.error = err;
        });
    } else {
        impl.trigger("onSend", payload, function() {
            observed.dones.push(Array.prototype.slice.call(arguments));
        });
    }
    if (testCase.control) {
        await testCase.control(ctx);
    }
    if (testCase.expect.kind === "pending") {
        await sleep(60);
    } else {
        await macrotask();
        await macrotask();
        if (testCase.settleMs) {
            await sleep(testCase.settleMs);
        }
    }
    return observed;
}

/**
 * Asserts what a case expects of the observed result of one form (B6-AC-1..6, B6-AC-9).
 */
function assertOutcome(testCase, observed, form) {
    const expect = testCase.expect;
    const where = " (" + form + " form, calls: " + JSON.stringify(observed.ctx.log) + ")";
    observed.ctx.log.should.eql(expect.calls, "the handlers that ran" + where);
    if (form === "promise") {
        switch (expect.kind) {
            case "pending":
                observed.state.should.equal("pending", "the promise of trigger must not settle" + where);
                break;
            case "resolve":
                observed.state.should.equal("resolved", "trigger must resolve" + where + (observed.error ? ": " + observed.error.message : ""));
                should(observed.value).equal(undefined);
                break;
            case "halt":
                observed.state.should.equal("resolved", "trigger must resolve with false" + where + (observed.error ? ": " + observed.error.message : ""));
                should(observed.value).equal(false);
                break;
            case "reject":
                observed.state.should.equal("rejected", "trigger must reject" + where);
                observed.error.should.be.an.instanceOf(Error);
                observed.error.message.should.equal(expect.message);
                observed.error.should.have.property("hook", "onSend");
                if (expect.identity) {
                    observed.error.should.equal(observed.ctx.thrown);
                }
                break;
            default:
                throw new Error("unknown kind " + expect.kind);
        }
        return;
    }
    // the callback form: done is called once (never when the chain does not end), with the same outcome
    if (expect.kind === "pending") {
        observed.dones.should.have.length(0, "done must not be called" + where);
        return;
    }
    observed.dones.should.have.length(1, "done must be called exactly once" + where + ": " + safeShow(observed.dones));
    const args = observed.dones[0];
    switch (expect.kind) {
        case "resolve":
            should(args[0]).equal(undefined);
            break;
        case "halt":
            should(args[0]).equal(false);
            break;
        case "reject":
            if (expect.identity) {
                args[0].should.equal(observed.ctx.thrown);
            } else if (expect.anyError) {
                // a value that cannot be printed: an Error, or the value itself - not a success. Not `should(value)`: it
                // would read the properties of a Proxy that throws
                if (!args[0]) {
                    throw new Error("done must get an error or the value, got " + safeShow(args[0]) + where);
                }
            } else if (expect.raw !== undefined) {
                args[0].should.equal(expect.raw);
            } else {
                args[0].should.be.an.instanceOf(Error);
                args[0].message.should.equal(expect.message);
            }
            break;
        default:
            throw new Error("unknown kind " + expect.kind);
    }
}

/**
 * Registers the handler of a registration case with `impl.add`; resolves with
 * `{threw}` - what `add` threw, if anything. The caller reads the warnings from its own spy.
 */
function register(impl, registration) {
    let threw;
    try {
        impl.add(registration.hookId, registration.make());
    } catch (err) {
        threw = err;
    }
    return { threw: threw };
}

module.exports = {
    CAP: CAP,
    NOT_PRINTABLE: NOT_PRINTABLE,
    falsyValues: falsyValues,
    falsyMessage: falsyMessage,
    cases: cases,
    registrations: registrations,
    settingsRegistrations: settingsRegistrations,
    exercise: exercise,
    assertOutcome: assertOutcome,
    register: register,
    sleep: sleep,
    macrotask: macrotask
};
