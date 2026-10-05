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
 *   Z-06 (#10): tests of the preDeploy hook of the deploy pipeline (flows/deployHooks.js): the copy
 *   for the handler (no credentials), the calling styles, the results (400 deploy_rejected, 503
 *   deploy_hook_failed, 503 deploy_hook_timeout), the sanitising of what leaves the runtime, the
 *   limits for a handler that does not finish; the postDeploy hook (step 11): classifyStart, the event, the
 *   parallel calls, a failure only in the log, the limit of 10 unfinished calls; a result that cannot be read
 *   (a getter that throws, a revoked Proxy) is a failure and never an unhandled rejection (S-C1)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const NR_TEST_UTILS = require("nr-test-utils");
const deployHooks = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/deployHooks");
const { log, hooks } = NR_TEST_UTILS.require("@node-red/util");

describe("flows/deployHooks", function() {
    let logged;
    let stubs;
    let settings;

    // a message of the catalog is shown as [key {params}], so the tests do not depend on the loaded catalog
    function catalogText(key, params) {
        return "[" + key + (params ? " " + JSON.stringify(params) : "") + "]";
    }

    beforeEach(function() {
        logged = { warn: [], error: [], debug: [] };
        stubs = [
            sinon.stub(log, "_").callsFake(catalogText),
            sinon.stub(log, "warn").callsFake(m => logged.warn.push(m)),
            sinon.stub(log, "error").callsFake(m => logged.error.push(m)),
            sinon.stub(log, "debug").callsFake(m => logged.debug.push(m))
        ];
        settings = { deploy: { hookTimeout: 200 } };
        deployHooks.init({ settings: settings });
    });
    afterEach(function() {
        stubs.forEach(s => s.restore());
        hooks.clear();
    });

    const config = () => [
        { id: "t1", type: "tab", label: "T" },
        { id: "n1", type: "test", z: "t1", wires: [] }
    ];
    function info(overrides) {
        return Object.assign({
            type: "full", source: "api", operation: "setFlows", flows: config(), activeRev: "r1",
            user: { username: "u", permissions: "*" }
        }, overrides);
    }
    // resolves with the error the pipeline answers with, or null when the chain accepted
    async function outcome(promise) {
        try {
            await promise;
            return null;
        } catch (err) {
            return err;
        }
    }
    const run = (overrides) => outcome(deployHooks.runPreDeploy(info(overrides)));

    describe("isValidHookTimeout and getHookTimeout", function() {
        it("accepts a finite number of ms > 0 and <= 2147483647", function() {
            [1, 300, 30000, 2147483647, 0.5].forEach(v => deployHooks.isValidHookTimeout(v).should.be.true());
        });
        it("rejects everything else", function() {
            ["30000", 0, -1, Infinity, NaN, 2147483648, null, undefined, {}, [], true].forEach(v => deployHooks.isValidHookTimeout(v).should.be.false());
        });
        it("getHookTimeout reads the setting at every call; an invalid or missing one gives 30000", function() {
            deployHooks.getHookTimeout().should.equal(200);
            settings.deploy.hookTimeout = 500;
            deployHooks.getHookTimeout().should.equal(500);
            ["x", 0, Infinity, 2147483648].forEach(function(v) {
                settings.deploy.hookTimeout = v;
                deployHooks.getHookTimeout().should.equal(30000);
            });
            delete settings.deploy;
            deployHooks.getHookTimeout().should.equal(30000);
            deployHooks.init({});
            deployHooks.getHookTimeout().should.equal(30000);
            deployHooks.DEFAULT_HOOK_TIMEOUT.should.equal(30000);
        });
    });

    describe("copyForHook (SEC-101, A27)", function() {
        it("drops the credentials of a tab, a subflow template, an instance, a global config and a group", function() {
            const flows = [
                { id: "t1", type: "tab", credentials: { a: "secret" } },
                { id: "s1", type: "subflow", credentials: { b: "secret" }, env: [{ name: "K", type: "cred", value: "secret" }] },
                { id: "i1", type: "subflow:s1", z: "t1", credentials: { c: "secret" }, env: [{ name: "K", type: "cred", value: "secret" }, { name: "P", type: "str", value: "plain" }] },
                { id: "g1", type: "test-config", credentials: { d: "secret" }, user: "name" },
                { id: "grp1", type: "group", z: "t1", env: [{ name: "G", type: "cred", value: "secret" }] },
                { id: "n1", type: "test", z: "t1", credentials: { user: "x", password: "secret" } }
            ];
            const copy = deployHooks.copyForHook(flows);
            JSON.stringify(copy).should.not.containEql("secret");
            copy[0].should.eql({ id: "t1", type: "tab" });
            copy[1].env.should.eql([{ name: "K", type: "cred" }]);
            copy[2].env.should.eql([{ name: "K", type: "cred" }, { name: "P", type: "str", value: "plain" }]);
            copy[3].should.eql({ id: "g1", type: "test-config", user: "name" });
            copy[4].env.should.eql([{ name: "G", type: "cred" }]);
            copy[5].should.not.have.property("credentials");
            // the original is not touched
            flows[0].credentials.should.eql({ a: "secret" });
            flows[1].env[0].value.should.equal("secret");
        });
        it("is deeply frozen", function() {
            const copy = deployHooks.copyForHook([{ id: "n", nested: { list: [1, { a: 1 }] } }]);
            Object.isFrozen(copy).should.be.true();
            Object.isFrozen(copy[0]).should.be.true();
            Object.isFrozen(copy[0].nested.list[1]).should.be.true();
            (function() { "use strict"; copy[0].id = "x" }).should.throw(TypeError);
        });
        it("also removes the credentials and env cred inside the result of a toJSON (a storage plugin)", function() {
            const node = {
                toJSON: function() {
                    return { id: "n1", type: "test", credentials: { p: "secret" }, env: [{ name: "K", type: "cred", value: "secret" }], nested: { credentials: { q: "secret" } } };
                }
            };
            const copy = deployHooks.copyForHook([node]);
            JSON.stringify(copy).should.not.containEql("secret");
            copy[0].should.eql({ id: "n1", type: "test", env: [{ name: "K", type: "cred" }], nested: {} });
        });
        it("throws for a configuration that cannot be serialised", function() {
            const cyclic = { id: "n" };
            cyclic.self = cyclic;
            (function() { deployHooks.copyForHook([cyclic]) }).should.throw(TypeError);
            (function() { deployHooks.copyForHook([{ big: BigInt(1) }]) }).should.throw(TypeError);
        });
    });

    describe("sanitizeText and sanitizeUser (SEC-102, SEC-106, I6)", function() {
        it("replaces control characters, C1 controls, line and paragraph separators and bidi overrides with a space", function() {
            const text = deployHooks.sanitizeText("a\nb\r\tc\x1b[31md\x00e\x7ff\x9bg\u2028h\u2029i\u202Ej\u202Ak\u2066l\u2069m", 1000, "fb");
            text.should.equal("a b  c [31md e f g h i j k l m");
            /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/.test(text).should.be.false();
        });
        it("limits the length", function() {
            deployHooks.sanitizeText("x".repeat(5000), 1000, "fb").should.have.length(1000);
            deployHooks.sanitizeText("x".repeat(5000), 200, "fb").should.have.length(200);
        });
        it("gives the fallback for a toString that throws, an object without toString, undefined, null and an empty text", function() {
            deployHooks.sanitizeText({ toString: function() { throw new Error("boom") } }, 100, "fb").should.equal("fb");
            deployHooks.sanitizeText(Object.create(null), 100, "fb").should.equal("fb");
            deployHooks.sanitizeText("  \n ", 100, "fb").should.equal("fb");
            deployHooks.sanitizeText(undefined, 100, "fb").should.equal("fb");
            deployHooks.sanitizeText(null, 100, "fb").should.equal("fb");
            deployHooks.sanitizeText(404, 100, "fb").should.equal("404");
        });
        it("sanitizeUser keeps only username and permissions", function() {
            const user = deployHooks.sanitizeUser({ username: "admin", permissions: "*", token: "secret", anonymous: false });
            user.should.eql({ username: "admin", permissions: "*" });
            Object.isFrozen(user).should.be.true();
            deployHooks.sanitizeUser({ username: "u", permissions: ["flows.read", "flows.write", 5] }).permissions.should.eql(["flows.read", "flows.write"]);
            should.not.exist(deployHooks.sanitizeUser(null));
            should.not.exist(deployHooks.sanitizeUser(undefined));
            should.not.exist(deployHooks.sanitizeUser("admin"));
            deployHooks.sanitizeUser({}).should.eql({ username: null, permissions: null });
        });
    });

    describe("the event of a handler", function() {
        it("has the fields of the contract; flows without credentials; frozen, the signal is not", async function() {
            let event;
            const flows = config();
            flows[0].credentials = { x: "secret" };
            hooks.add("preDeploy.a", function(e) { event = e });
            const err = await run({ flows: flows, flowId: "t1", created: false, rev: "stored", user: { username: "u", permissions: "*", token: "secret" } });
            should.not.exist(err);
            event.type.should.equal("full");
            event.source.should.equal("api");
            event.operation.should.equal("setFlows");
            event.flowId.should.equal("t1");
            event.created.should.equal(false);
            event.rev.should.equal("stored");
            event.activeRev.should.equal("r1");
            event.user.should.eql({ username: "u", permissions: "*" });
            event.flows.should.eql([{ id: "t1", type: "tab", label: "T" }, { id: "n1", type: "test", z: "t1", wires: [] }]);
            event.deadline.should.be.a.Number();
            Object.isFrozen(event).should.be.true();
            Object.isFrozen(event.flows[1]).should.be.true();
            (event.signal instanceof AbortSignal).should.be.true();
            Object.isFrozen(event.signal).should.be.false();
            event.signal.aborted.should.be.false();
        });
        it("has no flowId, created and rev when they do not apply; activeRev is null without an active configuration; user null", async function() {
            let event;
            hooks.add("preDeploy.a", function(e) { event = e });
            await run({ activeRev: undefined, user: undefined });
            event.should.not.have.property("flowId");
            event.should.not.have.property("created");
            event.should.not.have.property("rev");
            should.equal(event.activeRev, null);
            should.equal(event.user, null);
        });
        it("a mutation of the event in strict mode is a failure: 503, the stored configuration is the client's (I4)", async function() {
            hooks.add("preDeploy.a", function(e) { "use strict"; e.flows[0].label = "changed" });
            const err = await run();
            err.should.have.property("code", "deploy_hook_failed");
            err.should.have.property("status", 503);
            logged.error.should.have.length(1);
        });
        it("a mutation in sloppy mode changes nothing", async function() {
            const flows = config();
            let seen;
            hooks.add("preDeploy.a", function(e) { e.flows[0].label = "changed"; seen = e.flows[0].label });
            should.not.exist(await run({ flows: flows }));
            seen.should.equal("T");
            flows[0].label.should.equal("T");
        });
        it("a configuration that cannot be copied fails closed (503)", async function() {
            hooks.add("preDeploy.a", function() {});
            const cyclic = { id: "n" };
            cyclic.self = cyclic;
            const err = await run({ flows: [cyclic] });
            err.should.have.property("code", "deploy_hook_failed");
        });
    });

    describe("calling styles (U2)", function() {
        it("one parameter: a returned value or promise is the result", async function() {
            const order = [];
            hooks.add("preDeploy.sync", function(e) { order.push("sync") });
            hooks.add("preDeploy.async", async function(e) { await null; order.push("async") });
            hooks.add("preDeploy.promise", function(e) { return Promise.resolve().then(() => { order.push("promise") }) });
            should.not.exist(await run());
            order.should.eql(["sync", "async", "promise"]);
        });
        it("a function of length 0 is called like one with one parameter and does not hang", async function() {
            let called = false;
            hooks.add("preDeploy.zero", async () => { called = true });
            hooks.add("preDeploy.zero2", function() { called = called && true });
            should.not.exist(await run());
            called.should.be.true();
            (async () => {}).length.should.equal(0);
        });
        it("two parameters: done() accepts", async function() {
            hooks.add("preDeploy.cb", function(e, done) { setImmediate(() => done()) });
            should.not.exist(await run());
        });
        it("two parameters: a returned promise counts, the first result wins", async function() {
            hooks.add("preDeploy.cb", function(e, done) { return Promise.resolve(false) });
            const err = await run();
            err.should.have.property("code", "deploy_rejected");
            hooks.clear();
            hooks.add("preDeploy.cb", function(e, done) { done(); return Promise.resolve(false) });
            should.not.exist(await run());
            hooks.clear();
            hooks.add("preDeploy.cb", function(e, done) { setImmediate(() => done(false)); return new Promise(() => {}) });
            (await run()).should.have.property("code", "deploy_rejected");
        });
        it("two parameters: a returned value that is not a promise is ignored (the handler must call done)", async function() {
            hooks.add("preDeploy.cb", function(e, done) { return false });
            const started = Date.now();
            const err = await run();
            err.should.have.property("code", "deploy_hook_timeout");
            (Date.now() - started).should.be.below(1000);
        });
        it("a second result after the first is ignored", async function() {
            hooks.add("preDeploy.cb", function(e, done) { done(); done(false); done(new Error("late")) });
            should.not.exist(await run());
            logged.warn.should.eql([]);
        });
    });

    describe("results of a handler (the table of the contract)", function() {
        function intended(properties) {
            return Object.assign(new Error("not allowed"), { status: 400 }, properties);
        }
        [
            ["returns undefined", () => undefined],
            ["returns true", () => true],
            ["returns an object", () => ({ ok: 1 })],
            ["returns null", () => null],
            ["returns a promise resolved with a value", () => Promise.resolve("fine")],
            ["returns a promise resolved with a non-false falsy value", () => Promise.resolve(0)]
        ].forEach(function(c) {
            it("accepts: " + c[0], async function() {
                hooks.add("preDeploy.a", c[1]);
                should.not.exist(await run());
            });
        });
        it("accepts: done(undefined)", async function() {
            hooks.add("preDeploy.a", function(e, done) { done(undefined) });
            should.not.exist(await run());
        });

        it("false: 400 deploy_rejected with the default message and reason 'rejected'", async function() {
            hooks.add("preDeploy.a", () => false);
            const err = await run();
            err.should.have.property("code", "deploy_rejected");
            err.should.have.property("status", 400);
            err.should.have.property("reason", "rejected");
            err.should.have.property("message", "[deploy.rejected-default]");
            err.should.not.have.property("details");
        });
        it("a promise resolved with false and done(false) reject the same way", async function() {
            hooks.add("preDeploy.a", async () => false);
            (await run()).should.have.property("reason", "rejected");
            hooks.clear();
            hooks.add("preDeploy.a", function(e, done) { done(false) });
            (await run()).should.have.property("reason", "rejected");
        });
        it("an Error with status 400 thrown: its message, its code as reason, its details", async function() {
            hooks.add("preDeploy.a", () => { throw intended({ code: "forbidden_node", details: { nodes: ["n1"] } }) });
            const err = await run();
            err.should.have.property("code", "deploy_rejected");
            err.should.have.property("status", 400);
            err.should.have.property("message", "not allowed");
            err.should.have.property("reason", "forbidden_node");
            err.details.should.eql({ nodes: ["n1"] });
        });
        it("an Error with status 400 rejected by a promise and passed to done rejects the same way", async function() {
            hooks.add("preDeploy.a", () => Promise.reject(intended({ code: "x_1" })));
            (await run()).should.have.property("reason", "x_1");
            hooks.clear();
            hooks.add("preDeploy.a", function(e, done) { done(intended({ code: "y.2" })) });
            (await run()).should.have.property("reason", "y.2");
        });
        it("the error that reaches the response is a new one: remote, rev, errors, stack and other fields of the handler's error are not carried", async function() {
            const original = intended({ code: "forbidden_node", remote: "secret-remote", rev: "R", revAll: "RA", errors: [{ code: "e" }], extra: "x", stack: "stack with secret" });
            hooks.add("preDeploy.a", () => { throw original });
            const err = await run();
            err.should.not.equal(original);
            ["remote", "rev", "revAll", "errors", "extra"].forEach(k => err.should.not.have.property(k));
            Object.keys(err).sort().should.eql(["code", "reason", "status"]);
            err.stack.should.not.containEql("secret");
        });
        it("reason that does not match [A-Za-z0-9_.:-]{1,64} becomes 'rejected'", async function() {
            for (const code of ["has space", "x".repeat(65), "", "a/b", 400, undefined, "\u0142", "a\nb"]) {
                hooks.clear();
                hooks.add("preDeploy.a", () => { throw intended({ code: code }) });
                (await run()).should.have.property("reason", "rejected");
            }
            hooks.clear();
            hooks.add("preDeploy.a", () => { throw intended({ code: "x".repeat(64) }) });
            (await run()).should.have.property("reason", "x".repeat(64));
        });
        it("the message of the response is limited to 1000 characters, cleaned of control characters; an empty one is the default", async function() {
            hooks.add("preDeploy.a", () => { throw intended({ message: "m".repeat(3000) }) });
            (await run()).message.should.have.length(1000);
            hooks.clear();
            hooks.add("preDeploy.a", () => { throw Object.assign(new Error("line1\nline2\x1b[31m\x9b\u2028\u202E end"), { status: 400 }) });
            const err = await run();
            err.message.should.equal("line1 line2 [31m    end");
            hooks.clear();
            hooks.add("preDeploy.a", () => { throw Object.assign(new Error(""), { status: 400 }) });
            (await run()).message.should.equal("[deploy.rejected-default]");
        });
        it("a message whose toString throws is replaced by the default", async function() {
            const error = intended({});
            Object.defineProperty(error, "message", { get: function() { throw new Error("boom") } });
            hooks.add("preDeploy.a", () => { throw error });
            const err = await run();
            err.should.have.property("code", "deploy_rejected");
            err.message.should.equal("[deploy.rejected-default]");
            hooks.clear();
            hooks.add("preDeploy.a", () => { throw intended({ message: { toString: function() { throw new Error("boom") } } }) });
            (await run()).message.should.equal("[deploy.rejected-default]");
        });
        it("details: a plain object or an array up to 8 KB is passed as a parsed copy; the rest is dropped with a warning", async function() {
            const details = { list: ["a"], nested: { n: 1 } };
            hooks.add("preDeploy.a", () => { throw intended({ details: details }) });
            const err = await run();
            err.details.should.eql(details);
            err.details.should.not.equal(details);
            hooks.clear();
            hooks.add("preDeploy.a", () => { throw intended({ details: [1, 2] }) });
            (await run()).details.should.eql([1, 2]);

            const dropped = [
                ["a string", "text"],
                ["more than 8 KB", { big: "x".repeat(9000) }],
                ["a cycle", (function() { const c = {}; c.c = c; return c })()],
                ["a BigInt", { n: BigInt(1) }],
                ["a class instance", new (class Foo { constructor() { this.a = 1 } })()],
                ["a function", function() {}]
            ];
            for (const d of dropped) {
                logged.warn.length = 0;
                hooks.clear();
                hooks.add("preDeploy.a", () => { throw intended({ details: d[1] }) });
                const e = await run();
                e.should.have.property("code", "deploy_rejected");
                e.should.not.have.property("details", undefined);
                should(e.details).be.undefined();
                logged.warn.should.have.length(1, d[0]);
                logged.warn[0].should.containEql("deploy.hook-details-dropped");
            }
            // 8 KB exactly is allowed
            const exact = { s: "x".repeat(8 * 1024 - 8) };
            Buffer.byteLength(JSON.stringify(exact)).should.equal(8 * 1024);
            hooks.clear();
            hooks.add("preDeploy.a", () => { throw intended({ details: exact }) });
            (await run()).details.should.eql(exact);
        });

        [
            ["a TypeError thrown", () => { throw new TypeError("x is not a function") }],
            ["an Error without status 400", () => { throw new Error("db down") }],
            ["an Error with another status", () => { throw Object.assign(new Error("nope"), { status: 403 }) }],
            ["a thrown string", () => { throw "x" }],
            ["a thrown plain object with status 400 (not an Error)", () => { throw { status: 400, message: "m" } }],
            ["Promise.reject() without a value", () => Promise.reject()],
            ["a promise rejected with an Error", () => Promise.reject(new Error("net"))],
            ["an async function that throws", async () => { throw new RangeError("r") }],
            ["done('x')", function(e, done) { done("x") }],
            ["done(true)", function(e, done) { done(true) }],
            ["done(null)", function(e, done) { done(null) }],
            ["done(new Error()) without status 400", function(e, done) { done(new Error("net")) }]
        ].forEach(function(c) {
            it("failure: " + c[0] + " is a 503 deploy_hook_failed with a constant message, not a rejection", async function() {
                hooks.add("preDeploy.a", c[1]);
                const err = await run();
                err.should.have.property("code", "deploy_hook_failed");
                err.should.have.property("status", 503);
                err.should.have.property("message", "[deploy.hook-failed]");
                err.should.not.have.property("reason");
                err.should.not.have.property("details");
                logged.error.should.have.length(1);
                logged.error[0].should.containEql("deploy.hook-failed-log");
            });
        });
        it("a failure is logged with the hook id, the error code and a cleaned message of at most 200 characters; the stack only at debug level", async function() {
            const error = Object.assign(new Error("first line\n" + "long ".repeat(100) + "\x1b[31m\x9b"), { code: "ECONNRESET" });
            hooks.add("preDeploy.validator", () => { throw error });
            const err = await run();
            err.message.should.not.containEql("ECONNRESET");
            logged.error.should.have.length(1);
            const entry = logged.error[0];
            entry.should.containEql('"id":"preDeploy.validator"');
            entry.should.containEql('"code":"ECONNRESET"');
            const params = JSON.parse(entry.slice(entry.indexOf("{")).replace(/\]$/, ""));
            params.message.should.have.length(200);
            /[\u0000-\u001F\u007F-\u009F]/.test(params.message).should.be.false();
            logged.debug.join("\n").should.containEql("Error: first line");
            logged.error.join("\n").should.not.containEql("at ");
        });
        it("a code that is not a short identifier is not logged as it is; a thrown value without Error is logged as text", async function() {
            hooks.add("preDeploy.a", () => { throw Object.assign(new Error("m"), { code: "bad code\nwith newline" }) });
            await run();
            logged.error[0].should.containEql('"code":"-"');
            logged.error.length = 0;
            hooks.clear();
            hooks.add("preDeploy.a", () => { throw { toString: function() { throw new Error("boom") } } });
            await run();
            logged.error[0].should.containEql('"message":"no message"');
        });
        it("the label of the handler is cleaned in the log", async function() {
            hooks.add("preDeploy.bad\nlabel", () => { throw new Error("x") });
            await run();
            logged.error[0].should.not.match(/[\u0000-\u001F]/);
        });
        it("the first result that is not an acceptance ends the chain; the handlers run in the order of registration", async function() {
            const order = [];
            hooks.add("preDeploy.a", () => { order.push("a") });
            hooks.add("preDeploy.b", () => { order.push("b"); return false });
            hooks.add("preDeploy.c", () => { order.push("c") });
            (await run()).should.have.property("code", "deploy_rejected");
            order.should.eql(["a", "b"]);
            order.length = 0;
            hooks.clear();
            hooks.add("preDeploy.a", () => { order.push("a"); throw new Error("x") });
            hooks.add("preDeploy.b", () => { order.push("b") });
            (await run()).should.have.property("code", "deploy_hook_failed");
            order.should.eql(["a"]);
        });
        it("a handler removed by an earlier one during the chain is not called (isRemoved)", async function() {
            const order = [];
            hooks.add("preDeploy.a", () => { order.push("a"); hooks.remove("preDeploy.b") });
            hooks.add("preDeploy.b", () => { order.push("b") });
            hooks.add("preDeploy.c", () => { order.push("c") });
            should.not.exist(await run());
            order.should.eql(["a", "c"]);
        });
        it("a handler added during the chain is not called in it (the snapshot)", async function() {
            const order = [];
            hooks.add("preDeploy.a", () => { order.push("a"); hooks.add("preDeploy.late", () => { order.push("late") }) });
            should.not.exist(await run());
            order.should.eql(["a"]);
        });
    });

    describe("the limit of the chain (deploy.hookTimeout, I9, I14, SEC-103)", function() {
        let clock;
        let unhandled;
        let onUnhandled;
        beforeEach(function() {
            clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
            unhandled = [];
            onUnhandled = reason => unhandled.push(reason);
            process.on("unhandledRejection", onUnhandled);
        });
        afterEach(function() {
            clock.restore();
            process.removeListener("unhandledRejection", onUnhandled);
        });
        const flush = () => new Promise(resolve => setImmediate(resolve));
        async function tick(ms) {
            await clock.tickAsync(ms);
            await flush();
        }

        it("a handler that does not finish before the deadline: 503 deploy_hook_timeout, the signal is aborted with 'timeout'", async function() {
            let signal;
            let deadline;
            hooks.add("preDeploy.hang", function(e) { signal = e.signal; deadline = e.deadline; return new Promise(() => {}) });
            const started = Date.now();
            const promise = outcome(deployHooks.runPreDeploy(info()));
            await tick(199);
            signal.aborted.should.be.false();
            await tick(1);
            const err = await promise;
            err.should.have.property("code", "deploy_hook_timeout");
            err.should.have.property("status", 503);
            err.should.have.property("message", "[deploy.hook-timeout]");
            signal.aborted.should.be.true();
            signal.reason.should.equal("timeout");
            deadline.should.equal(started + 200);
            logged.warn.some(m => m.indexOf("deploy.hook-timeout-log") !== -1 && m.indexOf("preDeploy.hang") !== -1).should.be.true();
        });
        it("the deadline is shared by the whole chain", async function() {
            const order = [];
            hooks.add("preDeploy.a", () => new Promise(resolve => setTimeout(() => { order.push("a"); resolve() }, 150)));
            hooks.add("preDeploy.b", () => new Promise(resolve => setTimeout(() => { order.push("b"); resolve() }, 150)));
            const promise = outcome(deployHooks.runPreDeploy(info()));
            await tick(200);
            (await promise).should.have.property("code", "deploy_hook_timeout");
            order.should.eql(["a"]);
        });
        it("the timer is cleared and does not keep the process alive; no timer is left after a quick chain", async function() {
            hooks.add("preDeploy.a", () => {});
            should.not.exist(await outcome(deployHooks.runPreDeploy(info())));
            clock.countTimers().should.equal(0);
        });
        it("a result that arrives after the deadline is ignored and logged as late; no unhandled rejection", async function() {
            let rejectLate;
            hooks.add("preDeploy.slow", () => new Promise((resolve, reject) => { rejectLate = reject }));
            const promise = outcome(deployHooks.runPreDeploy(info()));
            await tick(200);
            (await promise).should.have.property("code", "deploy_hook_timeout");
            logged.warn.length = 0;
            rejectLate(new Error("secret late failure"));
            await flush();
            await flush();
            logged.warn.should.have.length(1);
            logged.warn[0].should.containEql("deploy.hook-late");
            logged.warn[0].should.containEql("preDeploy.slow");
            logged.warn[0].should.not.containEql("secret late failure");
            logged.error.should.eql([]);
            unhandled.should.eql([]);
        });
        it("SEC-103: while the late call of a handler runs, the next deployment is answered at once with 503, without calling the handler", async function() {
            let calls = 0;
            let finishLate;
            hooks.add("preDeploy.slow", function() { calls++; return new Promise(resolve => { finishLate = resolve }) });
            let promise = outcome(deployHooks.runPreDeploy(info()));
            await tick(200);
            (await promise).should.have.property("code", "deploy_hook_timeout");
            calls.should.equal(1);
            logged.warn.length = 0;
            await tick(1000);
            // the second and the third deployment: immediately, the handler is not called
            for (let i = 0; i < 2; i++) {
                const err = await outcome(deployHooks.runPreDeploy(info()));
                err.should.have.property("code", "deploy_hook_timeout");
            }
            calls.should.equal(1);
            logged.warn.should.have.length(2);
            logged.warn[0].should.containEql("deploy.hook-busy");
            logged.warn[0].should.containEql('"id":"preDeploy.slow"');
            // SEC-107: the age of the late call in ms
            JSON.parse(logged.warn[0].slice(logged.warn[0].indexOf("{")).replace(/\]$/, "")).age.should.be.aboveOrEqual(1000);
            // I14: when the late call ends, the next deployment calls the handler again and its result is its own
            logged.warn.length = 0;
            finishLate(false);
            await flush();
            await flush();
            logged.warn.should.have.length(1);
            logged.warn[0].should.containEql("deploy.hook-late");
            promise = outcome(deployHooks.runPreDeploy(info()));
            await flush();
            calls.should.equal(2);
            await tick(200);
            (await promise).should.have.property("code", "deploy_hook_timeout");
        });
        it("I14: the late result of a call (false) does not reject a later deployment", async function() {
            let calls = 0;
            const finishers = [];
            hooks.add("preDeploy.slow", function() {
                calls++;
                if (calls === 1) {
                    return new Promise(resolve => finishers.push(resolve));
                }
                return undefined;
            });
            const first = outcome(deployHooks.runPreDeploy(info()));
            await tick(200);
            (await first).should.have.property("code", "deploy_hook_timeout");
            finishers[0](false);
            await flush();
            await flush();
            // the handler accepts now: the late `false` has no effect
            should.not.exist(await outcome(deployHooks.runPreDeploy(info())));
            calls.should.equal(2);
        });
        it("a handler added again under the same label after the removal of a hanging one is not blocked", async function() {
            hooks.add("preDeploy.v", () => new Promise(() => {}));
            const first = outcome(deployHooks.runPreDeploy(info()));
            await tick(200);
            (await first).should.have.property("code", "deploy_hook_timeout");
            // still the same registration: busy
            (await outcome(deployHooks.runPreDeploy(info()))).should.have.property("code", "deploy_hook_timeout");
            hooks.remove("preDeploy.v");
            hooks.add("preDeploy.v", () => {});
            should.not.exist(await outcome(deployHooks.runPreDeploy(info())));
        });
        it("a handler that hangs blocks only itself: another handler registered before it is called as usual", async function() {
            const order = [];
            hooks.add("preDeploy.ok", () => { order.push("ok") });
            hooks.add("preDeploy.hang", () => new Promise(() => {}));
            let promise = outcome(deployHooks.runPreDeploy(info()));
            await tick(200);
            (await promise).should.have.property("code", "deploy_hook_timeout");
            (await outcome(deployHooks.runPreDeploy(info()))).should.have.property("code", "deploy_hook_timeout");
            order.should.eql(["ok", "ok"]);
        });
        it("a handler that throws after the deadline does not end in an unhandled rejection", async function() {
            hooks.add("preDeploy.a", () => new Promise((resolve, reject) => setTimeout(() => reject(new Error("late")), 300)));
            const promise = outcome(deployHooks.runPreDeploy(info()));
            await tick(200);
            (await promise).should.have.property("code", "deploy_hook_timeout");
            await tick(200);
            unhandled.should.eql([]);
        });
        it("the timeout comes from settings read at each call", async function() {
            settings.deploy.hookTimeout = 1000;
            hooks.add("preDeploy.hang", () => new Promise(() => {}));
            const promise = outcome(deployHooks.runPreDeploy(info()));
            await tick(999);
            let settled = false;
            promise.then(() => { settled = true });
            await flush();
            settled.should.be.false();
            await tick(1);
            (await promise).should.have.property("code", "deploy_hook_timeout");
        });
    });

    describe("classifyStart: the dictionary of start.status (D17, D23, D24)", function() {
        const waited = { waitForStart: true, held: true };
        const notWaited = { waitForStart: false, held: true };
        it("no error: started with deploy.response started, pending in the default mode, not_started without a registered start", function() {
            deployHooks.classifyStart(null, waited).should.eql({ start: { status: "started" } });
            deployHooks.classifyStart(null, notWaited).should.eql({ start: { status: "pending" } });
            deployHooks.classifyStart(null, { waitForStart: true, held: false }).should.eql({ start: { status: "not_started" } });
            deployHooks.classifyStart(null, { waitForStart: false, held: false }).should.eql({ start: { status: "not_started" } });
            deployHooks.classifyStart(undefined, {}).should.eql({ start: { status: "not_started" } });
        });
        it("D23: a swallowed stop error of the default mode leaves no registered start: not_started, not pending", function() {
            // flows.setFlows resolves (no error) and registered nothing with the lock
            deployHooks.classifyStart(null, { waitForStart: false, held: false, direct: true }).start.status.should.equal("not_started");
        });
        it("deploy_start_failed with start_timeout is pending with the errors; without it start_failed with the errors", function() {
            const timeout = Object.assign(new Error("x"), { code: "deploy_start_failed", errors: [{ code: "start_timeout", message: "t", timeout: 30, phase: "flows", pending: ["t1"] }] });
            deployHooks.classifyStart(timeout, waited).should.eql({ start: { status: "pending", errors: [{ code: "start_timeout", message: "t", timeout: 30, phase: "flows", pending: ["t1"] }] } });
            const failed = Object.assign(new Error("x"), { code: "deploy_start_failed", errors: [{ code: "missing_types", message: "m", types: ["a"] }, { code: "start_timeout" }].slice(0, 1) });
            deployHooks.classifyStart(failed, waited).should.eql({ start: { status: "start_failed", errors: [{ code: "missing_types", message: "m", types: ["a"] }] } });
            const mixed = Object.assign(new Error("x"), { code: "deploy_start_failed", errors: [{ code: "flow_start_failed", flow: "t2" }, { code: "start_timeout" }] });
            deployHooks.classifyStart(mixed, waited).start.status.should.equal("pending");
            deployHooks.classifyStart(Object.assign(new Error("x"), { code: "deploy_start_failed" }), waited).should.eql({ start: { status: "start_failed", errors: [] } });
        });
        it("the errors are a copy", function() {
            const errors = [{ code: "missing_types", types: ["a"] }];
            const result = deployHooks.classifyStart(Object.assign(new Error("x"), { code: "deploy_start_failed", errors: errors }), waited);
            result.start.errors.should.not.equal(errors);
            result.start.errors[0].types.should.not.equal(errors[0].types);
        });
        it("deploy_stop_failed is stop_failed", function() {
            deployHooks.classifyStart(Object.assign(new Error("x"), { code: "deploy_stop_failed" }), waited).should.eql({ start: { status: "stop_failed" } });
        });
        it("D24: an unexpected error after the save keeps the status of the registered start and is reported apart; unknown only for an error of the deployment step itself", function() {
            const other = Object.assign(new Error("late failure"), { code: "revision_lookup_failed" });
            deployHooks.classifyStart(other, { waitForStart: true, held: true, direct: false }).should.eql({ start: { status: "started" }, error: { code: "revision_lookup_failed" } });
            deployHooks.classifyStart(other, { waitForStart: false, held: true, direct: false }).should.eql({ start: { status: "pending" }, error: { code: "revision_lookup_failed" } });
            deployHooks.classifyStart(other, { waitForStart: false, held: false, direct: false }).should.eql({ start: { status: "not_started" }, error: { code: "revision_lookup_failed" } });
            deployHooks.classifyStart(other, { waitForStart: false, held: false, direct: true }).should.eql({ start: { status: "unknown" }, error: { code: "revision_lookup_failed" } });
            // a code that is not a short identifier, or none
            deployHooks.classifyStart(new Error("x"), { direct: true }).should.eql({ start: { status: "unknown" }, error: { code: "unexpected_error" } });
            deployHooks.classifyStart(Object.assign(new Error("x"), { code: 404 }), {}).error.code.should.equal("unexpected_error");
            deployHooks.classifyStart(Object.assign(new Error("x"), { code: "has space\n" }), {}).error.code.should.equal("unexpected_error");
        });
    });

    describe("notifyPostDeploy (step 11)", function() {
        const flush = () => new Promise(resolve => setImmediate(resolve));
        const facts = (overrides) => Object.assign({
            rev: "r2", type: "full", source: "api", operation: "setFlows", flowId: null,
            user: { username: "u", permissions: "*", token: "secret" }, start: { status: "pending" }
        }, overrides);

        it("calls the handlers asynchronously, not before the caller continues", async function() {
            const calls = [];
            hooks.add("postDeploy.a", e => { calls.push("a") });
            deployHooks.notifyPostDeploy(facts());
            calls.should.eql([]);
            await flush();
            calls.should.eql(["a"]);
        });
        it("the event: rev, type, source, operation, flowId, user (whitelist), start, deadline, signal; frozen, the signal is not", async function() {
            let event;
            hooks.add("postDeploy.a", e => { event = e });
            deployHooks.notifyPostDeploy(facts({ type: "flows", operation: "updateFlow", flowId: "t1", start: { status: "start_failed", errors: [{ code: "missing_types" }] }, error: { code: "x_1" } }));
            await flush();
            event.rev.should.equal("r2");
            event.type.should.equal("flows");
            event.source.should.equal("api");
            event.operation.should.equal("updateFlow");
            event.flowId.should.equal("t1");
            event.user.should.eql({ username: "u", permissions: "*" });
            event.start.should.eql({ status: "start_failed", errors: [{ code: "missing_types" }] });
            event.error.should.eql({ code: "x_1" });
            event.should.not.have.property("reloadType");
            event.deadline.should.be.a.Number();
            Object.isFrozen(event).should.be.true();
            Object.isFrozen(event.start.errors[0]).should.be.true();
            Object.isFrozen(event.signal).should.be.false();
            event.should.not.have.property("flows");
        });
        it("a reload from storage: source storage, operation null, flowId null, user null, reloadType", async function() {
            let event;
            hooks.add("postDeploy.a", e => { event = e });
            deployHooks.notifyPostDeploy(facts({ type: "reload", source: "storage", operation: null, user: undefined, reloadType: "diff" }));
            await flush();
            event.source.should.equal("storage");
            should.equal(event.operation, null);
            should.equal(event.flowId, null);
            should.equal(event.user, null);
            event.reloadType.should.equal("diff");
        });
        it("all handlers are started in parallel in the order of registration; a slow one does not hold back the next", async function() {
            const order = [];
            hooks.add("postDeploy.a", () => { order.push("a:start"); return new Promise(() => {}) });
            hooks.add("postDeploy.b", () => { order.push("b:start") });
            hooks.add("postDeploy.c", (e, done) => { order.push("c:start"); setImmediate(() => { order.push("c:end"); done() }) });
            deployHooks.notifyPostDeploy(facts());
            await flush();
            order.slice(0, 3).should.eql(["a:start", "b:start", "c:start"]);
            await flush();
            order.should.eql(["a:start", "b:start", "c:start", "c:end"]);
        });
        it("a failure is a warning with the hook id, the code and a cleaned message; nothing else; the other handlers still run", async function() {
            const order = [];
            hooks.add("postDeploy.bad", () => { throw Object.assign(new Error("boom\n\x1b[31m\x9b" + "x".repeat(500)), { code: "EBOOM" }) });
            hooks.add("postDeploy.rejects", () => Promise.reject(new Error("net")));
            hooks.add("postDeploy.done", (e, done) => done(new Error("cb")));
            hooks.add("postDeploy.ok", () => { order.push("ok") });
            deployHooks.notifyPostDeploy(facts());
            await flush();
            await flush();
            order.should.eql(["ok"]);
            logged.warn.should.have.length(3);
            logged.warn.forEach(m => m.should.containEql("deploy.post-hook-failed"));
            logged.warn[0].should.containEql('"id":"postDeploy.bad"');
            logged.warn[0].should.containEql('"code":"EBOOM"');
            const params = JSON.parse(logged.warn[0].slice(logged.warn[0].indexOf("{")).replace(/\]$/, ""));
            params.message.should.have.length(200);
            /[\u0000-\u001F\u007F-\u009F]/.test(params.message).should.be.false();
            logged.error.should.eql([]);
        });
        it("a returned value is ignored (false, an object, done(false), done('x'))", async function() {
            hooks.add("postDeploy.a", () => false);
            hooks.add("postDeploy.b", () => Promise.resolve({ x: 1 }));
            hooks.add("postDeploy.c", (e, done) => done(false));
            hooks.add("postDeploy.d", (e, done) => done("x"));
            deployHooks.notifyPostDeploy(facts());
            await flush();
            await flush();
            logged.warn.should.eql([]);
        });
        it("does nothing without handlers, and a handler removed before the call is not called", async function() {
            deployHooks.notifyPostDeploy(facts());
            await flush();
            let called = false;
            hooks.add("postDeploy.a", () => { called = true });
            deployHooks.notifyPostDeploy(facts());
            hooks.remove("postDeploy.a");
            await flush();
            called.should.be.false();
        });
        it("a facts object that cannot be turned into an event is a warning, not an exception", async function() {
            hooks.add("postDeploy.a", () => {});
            const cyclic = { status: "pending" };
            cyclic.self = cyclic;
            deployHooks.notifyPostDeploy(facts({ start: cyclic }));
            await flush();
            logged.warn.should.have.length(1);
            logged.warn[0].should.containEql("deploy.post-hook-failed");
        });

        describe("limits", function() {
            let clock;
            beforeEach(function() {
                clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
            });
            afterEach(function() {
                clock.restore();
            });
            async function tick(ms) {
                await clock.tickAsync(ms);
                await flush();
            }
            it("a handler that has not finished within hookTimeout: a warning and the signal aborted with 'timeout', it is not interrupted", async function() {
                let signal;
                let finish;
                hooks.add("postDeploy.slow", e => { signal = e.signal; return new Promise(resolve => { finish = resolve }) });
                deployHooks.notifyPostDeploy(facts());
                await tick(0);
                signal.aborted.should.be.false();
                await tick(199);
                signal.aborted.should.be.false();
                logged.warn.should.eql([]);
                await tick(1);
                signal.aborted.should.be.true();
                signal.reason.should.equal("timeout");
                logged.warn.should.have.length(1);
                logged.warn[0].should.containEql("deploy.post-hook-slow");
                logged.warn[0].should.containEql("postDeploy.slow");
                finish();
                await tick(0);
                logged.warn.should.have.length(1);
            });
            it("no timer is left when the handlers finish quickly", async function() {
                hooks.add("postDeploy.a", () => {});
                hooks.add("postDeploy.b", () => Promise.resolve());
                deployHooks.notifyPostDeploy(facts());
                await tick(0);
                clock.countTimers().should.equal(0);
            });
            it("SEC-103: at most 10 unfinished calls of a handler; the 11th is skipped with a warning; finished calls free the slots", async function() {
                let calls = 0;
                const finishers = [];
                hooks.add("postDeploy.hang", () => { calls++; return new Promise(resolve => finishers.push(resolve)) });
                for (let i = 0; i < 10; i++) {
                    deployHooks.notifyPostDeploy(facts());
                }
                await tick(0);
                calls.should.equal(10);
                logged.warn.length = 0;
                deployHooks.notifyPostDeploy(facts());
                await tick(0);
                calls.should.equal(10);
                logged.warn.should.have.length(1);
                logged.warn[0].should.containEql("deploy.post-hook-skipped");
                logged.warn[0].should.containEql("postDeploy.hang");
                finishers[0]();
                await tick(0);
                deployHooks.notifyPostDeploy(facts());
                await tick(0);
                calls.should.equal(11);
                // a handler that does not hang is not affected by the limit of another
                let other = 0;
                hooks.add("postDeploy.fine", () => { other++ });
                deployHooks.notifyPostDeploy(facts());
                await tick(0);
                other.should.equal(1);
            });
            it("a handler added again under the same label after the removal of a hanging one is not blocked", async function() {
                hooks.add("postDeploy.v", () => new Promise(() => {}));
                for (let i = 0; i < 10; i++) {
                    deployHooks.notifyPostDeploy(facts());
                }
                await tick(0);
                hooks.remove("postDeploy.v");
                let called = false;
                hooks.add("postDeploy.v", () => { called = true });
                deployHooks.notifyPostDeploy(facts());
                await tick(0);
                called.should.be.true();
            });
        });
    });

    describe("what a handler throws can be anything (S-C1): no unhandled rejection, no end of the process", function() {
        let unhandled;
        let onUnhandled;
        const flush = () => new Promise(resolve => setImmediate(resolve));
        beforeEach(function() {
            unhandled = [];
            onUnhandled = reason => unhandled.push(reason);
            process.on("unhandledRejection", onUnhandled);
        });
        afterEach(function() {
            process.removeListener("unhandledRejection", onUnhandled);
        });
        function throwingStatus() {
            const error = new Error("boom");
            Object.defineProperty(error, "status", { get: function() { throw new Error("status getter") } });
            return error;
        }
        function throwingStack() {
            const error = new Error("boom");
            Object.defineProperty(error, "stack", { get: function() { throw new Error("stack getter") } });
            return error;
        }
        function revoked() {
            const proxy = Proxy.revocable({}, {});
            proxy.revoke();
            return proxy.proxy;
        }
        // [description, how the handler produces it]
        const producers = [
            ["rejects a promise", value => () => Promise.reject(value())],
            ["throws", value => () => { throw value() }],
            ["passes it to done", value => (event, done) => done(value())]
        ];
        const values = [
            ["an Error whose status getter throws", throwingStatus],
            ["an Error whose stack getter throws", throwingStack],
            ["a revoked Proxy", revoked]
        ];
        values.forEach(function(v) {
            producers.forEach(function(p) {
                it("preDeploy: a handler that " + p[0] + " " + v[0] + " is a 503 deploy_hook_failed", async function() {
                    hooks.add("preDeploy.a", p[1](v[1]));
                    const err = await run();
                    err.should.have.property("code", "deploy_hook_failed");
                    err.should.have.property("status", 503);
                    await flush();
                    await flush();
                    unhandled.should.eql([]);
                    logged.error.should.have.length(1);
                    // the next deployment is not blocked (the call ended)
                    hooks.clear();
                    hooks.add("preDeploy.a", () => {});
                    should.not.exist(await run());
                });
                it("postDeploy: a handler that " + p[0] + " " + v[0] + " is a warning only", async function() {
                    const calls = [];
                    hooks.add("postDeploy.a", p[1](v[1]));
                    hooks.add("postDeploy.b", () => { calls.push("b") });
                    deployHooks.notifyPostDeploy({ rev: "r", type: "full", source: "api", operation: "setFlows", flowId: null, user: null, start: { status: "pending" } });
                    await flush();
                    await flush();
                    unhandled.should.eql([]);
                    calls.should.eql(["b"]);
                    logged.warn.should.have.length(1);
                    logged.warn[0].should.containEql("deploy.post-hook-failed");
                });
            });
        });
        it("preDeploy: an Error with status 400 whose stack getter throws is still a rejection (the stack is never read)", async function() {
            const error = Object.assign(throwingStack(), { status: 400, code: "forbidden_node" });
            hooks.add("preDeploy.a", () => Promise.reject(error));
            const err = await run();
            err.should.have.property("code", "deploy_rejected");
            err.should.have.property("reason", "forbidden_node");
            unhandled.should.eql([]);
        });
        it("preDeploy: details that cannot be read (a revoked Proxy, as the object or an array of them) are dropped with a warning, the rejection stays", async function() {
            for (const details of [revoked(), [revoked()], { nested: revoked() }]) {
                logged.warn.length = 0;
                hooks.clear();
                hooks.add("preDeploy.a", () => { throw Object.assign(new Error("no"), { status: 400, code: "x", details: details }) });
                const err = await run();
                err.should.have.property("code", "deploy_rejected");
                should(err.details).be.undefined();
                logged.warn.should.have.length(1);
                logged.warn[0].should.containEql("deploy.hook-details-dropped");
            }
            unhandled.should.eql([]);
        });
        it("preDeploy: an exception in the code that reads the result becomes a 503 (the last resort of the chain)", async function() {
            // a handler whose id cannot be cleaned is not possible; a log function that throws once is
            hooks.add("preDeploy.a", () => { throw new TypeError("x") });
            logStubsFailOnce();
            const err = await run();
            err.should.have.property("code", "deploy_hook_failed");
            err.should.have.property("status", 503);
            unhandled.should.eql([]);
        });
        function logStubsFailOnce() {
            let first = true;
            log.error.callsFake(function(m) {
                if (first) {
                    first = false;
                    throw new Error("the logger failed");
                }
                logged.error.push(m);
            });
        }
    });
});
