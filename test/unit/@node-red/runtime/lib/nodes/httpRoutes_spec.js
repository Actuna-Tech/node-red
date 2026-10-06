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
 *   new test file (#11): the API of the HTTP routes of a node (node.registerHttpRoute): the
 *   contract, the removal of the routes when the node stops, the adapter of the router of
 *   the app (Express 4 and 5), the order of the routes, the hold of the requests (#8)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

// The tests use the real Node, a real Express app and supertest. They go through the
// public paths only: Node.prototype.registerHttpRoute, Node.prototype.close and
// redNodes.init (which gives the app of the nodes to the routes of the nodes).

const should = require("should");
const sinon = require("sinon");
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const express = require("express");
const EventEmitter = require("events");
const supertest = require("nr-test-utils/supertest");
const NR_TEST_UTILS = require("nr-test-utils");
const RedNode = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/Node");
const redNodes = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/index");
const registryUtil = NR_TEST_UTILS.require("@node-red/registry/lib/util");
const httpHold = NR_TEST_UTILS.require("@node-red/runtime/lib/httpHold");
const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
const util = NR_TEST_UTILS.require("@node-red/util");
const Log = util.log;
const i18n = util.i18n;

describe("runtime/nodes/httpRoutes (#11)", function() {
    let app;
    let nodes;
    let seq = 0;

    function runtimeOf(nodeApp) {
        const runtime = {
            settings: { available: function() { return false }, get: function() { return false } },
            storage: {},
            log: {
                debug: function() {}, warn: function() {}, trace: function() {}, info: function() {},
                log: function() {}, metric: function() { return false }, _: function() { return "" }
            },
            events: new EventEmitter()
        };
        if (nodeApp) {
            runtime.nodeApp = nodeApp;
        }
        return runtime;
    }

    // An app that already has its router (as the app of the runtime has: other layers come first)
    function createApp() {
        const a = express();
        a.use(function base(req, res, next) { next() });
        return a;
    }

    function newNode(id, type) {
        const node = new RedNode({ id: id || ("n" + (++seq)), type: type || "test-http-routes" });
        nodes.push(node);
        return node;
    }

    // The API must exist: without it a test that expects a TypeError would pass on
    // "node.registerHttpRoute is not a function"
    function needApi(node) {
        assert.strictEqual(typeof node.registerHttpRoute, "function", "Node.prototype.registerHttpRoute is not defined");
    }

    function reg(node) {
        needApi(node);
        return node.registerHttpRoute.apply(node, Array.prototype.slice.call(arguments, 1));
    }

    function send(text, status) {
        return function(req, res) { res.status(status || 200).send(text) };
    }

    function get(path, a) { return supertest(a || app).get(path) }

    function stackOf(a) { return a._router ? a._router.stack.slice() : [] }

    function sameStack(before, a, message) {
        const after = stackOf(a);
        assert.strictEqual(after.length, before.length, (message || "stack") + ": length");
        after.forEach(function(layer, i) {
            assert.strictEqual(layer, before[i], (message || "stack") + ": layer " + i);
        });
    }

    function routeLayers(a) {
        return stackOf(a || app).filter(function(layer) { return layer.route });
    }

    function layersOfPath(path, a) {
        return routeLayers(a).filter(function(layer) { return layer.route.path === path });
    }

    // What the thrown call gave: the error, or undefined when it did not throw
    function thrownBy(fn) {
        try {
            fn();
        } catch (err) {
            return { error: err };
        }
        return { error: undefined, none: true };
    }

    // The log: Log.log passes through (the warnings carry id and type), the text of a
    // message names the key and the parameters
    function text(key, params) {
        let p = "";
        try {
            p = params === undefined ? "" : "|" + JSON.stringify(params);
        } catch (err) { /* a parameter that cannot be printed */ }
        return key + p;
    }
    function captureLog() {
        const spy = sinon.spy(Log, "log");
        sinon.stub(Log, "_").callsFake(text);
        sinon.stub(i18n, "_").callsFake(text);
        return {
            warns: function(key) {
                return spy.args.map(function(a) { return a[0] }).filter(function(e) {
                    return e && e.level === Log.WARN && (key === undefined || String(e.msg).indexOf(key) !== -1);
                });
            },
            entries: function(key) {
                return spy.args.map(function(a) { return a[0] }).filter(function(e) {
                    return e && String(e.msg).indexOf(key) !== -1;
                });
            }
        };
    }
    function paramsOf(entry) {
        const s = String(entry.msg);
        const i = s.indexOf("|");
        return i < 0 ? null : JSON.parse(s.slice(i + 1));
    }

    beforeEach(function() {
        nodes = [];
        app = createApp();
        redNodes.init(runtimeOf(app));
    });

    afterEach(function() {
        // the close of a node removes its routes at once (not awaited: a test may hang a close callback)
        nodes.forEach(function(node) {
            try { node.close() } catch (err) { /* the test checked it */ }
        });
        sinon.restore();
    });

    describe("the module", function() {
        it("AC-40 (B2): httpRoutes.js is a leaf module: it requires only @node-red/util", function() {
            const file = NR_TEST_UTILS.resolve("@node-red/runtime/lib/nodes/httpRoutes.js");
            const source = fs.readFileSync(file, "utf8");
            const required = [];
            source.replace(/require\(\s*["']([^"']+)["']\s*\)/g, function(all, name) { required.push(name) });
            required.forEach(function(name) {
                assert.strictEqual(name, "@node-red/util", "httpRoutes.js requires " + name);
            });
        });

        it("AC-40: the messages of the runtime catalog (en-US) have the keys and the texts of D16", function() {
            const catalog = JSON.parse(fs.readFileSync(NR_TEST_UTILS.resolve("@node-red/runtime/locales/en-US/runtime.json"), "utf8"));
            should.exist(catalog.httpRoutes, "group httpRoutes");
            catalog.httpRoutes["after-close"].should.equal("HTTP routes registered after the node was closed are ignored");
            catalog.httpRoutes["remove-failed"].should.equal("Failed to remove the HTTP routes of the node: __message__");
        });

        // the notice of a modification is in the first comment of the file
        function head(file) {
            return fs.readFileSync(NR_TEST_UTILS.resolve(file), "utf8").split("\n").slice(0, 40).join("\n");
        }

        ["Node.js", "index.js"].forEach(function(name) {
            it("AC-40: the file nodes/" + name + " has the notice of a modification (D-19) with #11", function() {
                head("@node-red/runtime/lib/nodes/" + name).should.match(/Modified by Actuna Sp\. z o\.o\.:[^]*#11/);
            });
        });

        it("AC-40: the file nodes/httpRoutes.js has the notice of a new module (D-19) with #11", function() {
            head("@node-red/runtime/lib/nodes/httpRoutes.js").should.match(/Modified by Actuna Sp\. z o\.o\.:[^]*#11/);
        });

        it("AC-40: flows/Flow.js has the notice of a modification (D-19) with #11", function() {
            head("@node-red/runtime/lib/flows/Flow.js").should.match(/Modified by Actuna Sp\. z o\.o\.:[^]*#11/);
        });

        it("AC-40: Node.prototype.registerHttpRoute has a JSDoc comment of its own that names httpNode", function() {
            const source = fs.readFileSync(NR_TEST_UTILS.resolve("@node-red/runtime/lib/nodes/Node.js"), "utf8");
            source.should.match(/\/\*\*(?:(?!\*\/)[^])*httpNode(?:(?!\*\/)[^])*\*\/\s*Node\.prototype\.registerHttpRoute\s*=/);
        });
    });

    describe("the contract of the API", function() {
        it("AC-1: registers a route that answers and returns a handle {method, path, remove}", async function() {
            const node = newNode();
            const handle = reg(node, "get", "/api-x", send("x"));
            const res = await get("/api-x").expect(200);
            res.text.should.equal("x");
            handle.method.should.equal("get");
            handle.path.should.equal("/api-x");
            handle.remove.should.be.a.Function();
        });

        it("AC-1 (D1): the handle is frozen and has only method, path and remove", function() {
            const handle = reg(newNode(), "get", "/frozen", send("x"));
            Object.isFrozen(handle).should.be.true();
            Object.keys(handle).sort().should.eql(["method", "path", "remove"]);
        });

        it("I-3: the route is a top-level layer at the end of the stack, like app.get() at the same moment", function() {
            const node = newNode();
            const before = stackOf(app);
            reg(node, "get", "/i3", send("x"));
            const after = stackOf(app);
            after.should.have.length(before.length + 1);
            after.slice(0, before.length).forEach(function(layer, i) { assert.strictEqual(layer, before[i]) });
            const last = after[after.length - 1];
            should.exist(last.route);
            last.route.path.should.equal("/i3");
            last.route.methods.should.have.property("get", true);
            // the same shape as the layer of app.get
            app.get("/i3-legacy", send("x"));
            const legacy = stackOf(app).pop();
            last.name.should.equal(legacy.name);
            Object.keys(last.route.methods).should.eql(Object.keys(legacy.route.methods));
        });

        it("AC-1: the handle of a RegExp path keeps the same RegExp", async function() {
            const re = /^\/re-handle\/\d+$/;
            const handle = reg(newNode(), "get", re, send("re"));
            assert.strictEqual(handle.path, re);
            await get("/re-handle/12").expect(200);
        });

        ["get", "post", "put", "patch", "delete", "options", "head", "GET", "Post"].forEach(function(method) {
            it("AC-2: method " + method + " answers a request of that method and the handle has it in lower case", async function() {
                const node = newNode();
                const lower = method.toLowerCase();
                const handle = reg(node, method, "/m-" + lower, function(req, res) { res.set("X-Route", lower).status(200).end("ok") });
                handle.method.should.equal(lower);
                const res = await supertest(app)[lower]("/m-" + lower);
                res.status.should.equal(200);
                res.headers["x-route"].should.equal(lower);
            });
        });

        it("AC-2: a get route does not answer a POST", async function() {
            reg(newNode(), "get", "/only-get", send("g"));
            await get("/only-get").expect(200);
            await supertest(app).post("/only-get").expect(404);
        });

        it("AC-2: all answers GET, POST and DELETE", async function() {
            const handle = reg(newNode(), "all", "/any", function(req, res) { res.set("X-Method", req.method).status(200).end("ok") });
            handle.method.should.equal("all");
            for (const method of ["get", "post", "delete"]) {
                const res = await supertest(app)[method]("/any");
                res.status.should.equal(200);
                res.headers["x-method"].should.equal(method.toUpperCase());
            }
        });

        describe("AC-3: a method that is not one of the known methods", function() {
            function spyObject(returns) {
                const calls = [];
                const o = {
                    toString: function() { calls.push("toString"); return returns },
                    toJSON: function() { calls.push("toJSON"); return returns },
                    valueOf: function() { calls.push("valueOf"); return returns }
                };
                return { value: o, calls: calls };
            }
            function spyProxy() {
                const calls = [];
                const traps = {};
                ["get", "has", "ownKeys", "getOwnPropertyDescriptor", "getPrototypeOf", "set", "defineProperty",
                    "deleteProperty", "isExtensible", "setPrototypeOf", "preventExtensions"].forEach(function(trap) {
                    traps[trap] = function() { calls.push(trap); return Reflect[trap].apply(Reflect, arguments) };
                });
                return { value: new Proxy({}, traps), calls: calls };
            }
            function plain(value) { return function() { return { value: value, calls: [] } } }
            const cases = [
                ["\"fetch\"", plain("fetch")], ["\"\"", plain("")], ["\" get\"", plain(" get")], ["null", plain(null)],
                ["undefined", plain(undefined)], ["1", plain(1)], ["{}", plain({})],
                ["new String(\"get\")", plain(new String("get"))],
                ["an object with toString and toJSON", function() { return spyObject("get") }],
                ["a Proxy with traps", spyProxy]
            ];
            cases.forEach(function(c) {
                it("rejects " + c[0] + " with a TypeError, the stack is unchanged, nothing is called on the argument", async function() {
                    const node = newNode();
                    needApi(node);
                    const arg = c[1]();
                    const before = stackOf(app);
                    let called = 0;
                    const result = thrownBy(function() { node.registerHttpRoute(arg.value, "/m", function() { called++ }) });
                    should.exist(result.error, "registerHttpRoute did not throw");
                    result.error.should.be.instanceof(TypeError);
                    result.error.message.should.match(/registerHttpRoute/);
                    sameStack(before, app);
                    await get("/m").expect(404);
                    called.should.equal(0);
                    arg.calls.should.eql([]);
                });
            });
        });

        describe("AC-4: a path that is neither a string nor a RegExp", function() {
            const asText = { toString: function() { return "/a" } };
            [["an array", ["/a"]], ["a number", 1], ["null", null], ["undefined", undefined], ["an object", {}],
                ["an object with toString", asText]].forEach(function(c) {
                it("rejects " + c[0] + " with a TypeError, the stack is unchanged", async function() {
                    const node = newNode();
                    needApi(node);
                    const before = stackOf(app);
                    const result = thrownBy(function() { node.registerHttpRoute("get", c[1], send("a")) });
                    should.exist(result.error, "registerHttpRoute did not throw");
                    result.error.should.be.instanceof(TypeError);
                    result.error.message.should.match(/registerHttpRoute/);
                    sameStack(before, app);
                    await get("/a").expect(404);
                });
            });
        });

        describe("AC-5: handlers that are not functions", function() {
            let called;
            function fn() { called++ }
            beforeEach(function() { called = 0 });
            [["no handler", function() { return [] }], ["an empty array", function() { return [[]] }],
                ["a string", function() { return ["s"] }], ["null", function() { return [null] }],
                ["an object", function() { return [{}] }], ["a function and a number", function() { return [fn, 123] }],
                ["a function and a nested null", function() { return [fn, [[null]]] }]].forEach(function(c) {
                it("rejects " + c[0] + " with a TypeError, the stack is unchanged, no handler is registered", async function() {
                    const node = newNode();
                    needApi(node);
                    const before = stackOf(app);
                    const args = ["get", "/h"].concat(c[1]());
                    const result = thrownBy(function() { node.registerHttpRoute.apply(node, args) });
                    should.exist(result.error, "registerHttpRoute did not throw");
                    result.error.should.be.instanceof(TypeError);
                    result.error.message.should.match(/registerHttpRoute/);
                    sameStack(before, app);
                    await get("/h").expect(404);
                    called.should.equal(0);
                });
            });
        });

        it("AC-6: handlers are flattened (arrays of any depth) and called in order", async function() {
            const calls = [];
            const mw1 = function(req, res, next) { calls.push("mw1"); next() };
            const mw2 = function(req, res, next) { calls.push("mw2"); next() };
            const h = function(req, res) { calls.push("h"); res.status(200).send("ok") };
            reg(newNode(), "get", "/six", [[mw1], [[mw2]]], h);
            await get("/six").expect(200);
            calls.should.eql(["mw1", "mw2", "h"]);
        });

        it("AC-6: an error handler (4 arguments) of the route gets the error", async function() {
            const bad = function(req, res, next) { next(new Error("e")) };
            const errh = function(err, req, res, next) { res.status(500).send(err.message) };
            reg(newNode(), "get", "/six-err", bad, errh);
            const res = await get("/six-err").expect(500);
            res.text.should.equal("e");
        });

        it("AC-6 (D13): an async function and an Express app are accepted as handlers", async function() {
            const sub = express();
            sub.use(function(req, res) { res.status(200).send("sub") });
            reg(newNode(), "get", "/with-sub", sub);
            reg(newNode(), "get", "/with-async", async function(req, res) { res.status(200).send("async") });
            (await get("/with-sub").expect(200)).text.should.equal("sub");
            (await get("/with-async").expect(200)).text.should.equal("async");
        });

        describe("AC-7: hostile arguments: the same error comes out, the stack is unchanged", function() {
            it("an array of handlers with a getter that throws", function() {
                const node = newNode();
                needApi(node);
                const E1 = new Error("E1");
                const handlers = [];
                Object.defineProperty(handlers, 0, { get: function() { throw E1 }, enumerable: true });
                const before = stackOf(app);
                const result = thrownBy(function() { node.registerHttpRoute("get", "/g", handlers) });
                assert.strictEqual(result.error, E1);
                sameStack(before, app);
            });
            it("a Proxy of an array whose get trap throws", function() {
                const node = newNode();
                needApi(node);
                const E2 = new Error("E2");
                const handlers = new Proxy([function() {}], { get: function() { throw E2 } });
                const before = stackOf(app);
                const result = thrownBy(function() { node.registerHttpRoute("get", "/g", handlers) });
                assert.strictEqual(result.error, E2);
                sameStack(before, app);
            });
            it("a path that is a Proxy of a RegExp whose getPrototypeOf trap throws", function() {
                const node = newNode();
                needApi(node);
                const E3 = new Error("E3");
                const path = new Proxy(/x/, { getPrototypeOf: function() { throw E3 } });
                const before = stackOf(app);
                const result = thrownBy(function() { node.registerHttpRoute("get", path, send("x")) });
                assert.strictEqual(result.error, E3);
                sameStack(before, app);
            });
        });

        it("AC-8: a path that Express rejects throws the SyntaxError of Express, the stack is unchanged", function() {
            const node = newNode();
            needApi(node);
            const before = stackOf(app);
            const result = thrownBy(function() { node.registerHttpRoute("get", "/(", send("x")) });
            should.exist(result.error, "registerHttpRoute did not throw");
            result.error.should.be.instanceof(SyntaxError);
            sameStack(before, app);
        });

        describe("AC-9: the same answers as app.get with the same path", function() {
            const probes = ["/a/1", "/a", "/files/x/y", "/", "/re/12", "/re/x"];
            const paths = ["/a/:id", "/files/*", "", /^\/re\/\d+$/];
            const answer = function(req, res) {
                res.status(200).send(JSON.stringify({ url: req.url, params: req.params }));
            };
            async function answers(a) {
                const out = [];
                for (const probe of probes) {
                    const res = await supertest(a).get(probe);
                    out.push({ probe: probe, status: res.status, text: res.status === 200 ? res.text : "" });
                }
                return out;
            }
            paths.forEach(function(path) {
                it("path " + (path instanceof RegExp ? path : JSON.stringify(path)), async function() {
                    const reference = express();
                    reference.get(path, answer);
                    const own = createApp();
                    redNodes.init(runtimeOf(own));
                    reg(newNode(), "get", path, answer);
                    const expected = await answers(reference);
                    expected.some(function(a) { return a.status === 200 }).should.be.true("the reference answers 200 somewhere");
                    (await answers(own)).should.eql(expected);
                });
            });
        });
    });

    describe("the lifecycle: the routes are removed when the node stops", function() {
        it("AC-10: close removes all routes of the node and nothing else", async function() {
            const A = newNode();
            const B = newNode();
            reg(A, "get", "/a1", send("a1-get"));
            reg(A, "post", "/a1", send("a1-post"));
            reg(A, "get", "/a2", send("a2"));
            app.get("/legacy", send("legacy"));
            reg(B, "get", "/b", send("b"));
            const before = stackOf(app);
            await A.close();
            const expected = before.filter(function(layer) {
                return !(layer.route && (layer.route.path === "/a1" || layer.route.path === "/a2"));
            });
            expected.should.have.length(before.length - 3);
            sameStack(expected, app);
            await get("/a1").expect(404);
            await supertest(app).post("/a1").expect(404);
            await get("/a2").expect(404);
            await get("/b").expect(200);
            await get("/legacy").expect(200);
        });

        it("AC-10: close(true) and close(false) both remove the routes", async function() {
            const A = newNode();
            const B = newNode();
            reg(A, "get", "/a-t", send("a"));
            reg(B, "get", "/b-f", send("b"));
            await A.close(true);
            await B.close(false);
            await get("/a-t").expect(404);
            await get("/b-f").expect(404);
        });

        it("AC-11: the routes are removed before the close callbacks run (a callback sees 404)", async function() {
            const A = newNode();
            reg(A, "get", "/a1", send("a1"));
            let status;
            let layersInCallback;
            A.on("close", function(done) {
                // at the first moment of the callback (D5: before the callbacks)
                layersInCallback = layersOfPath("/a1").length;
                get("/a1").then(function(res) { status = res.status; done() }, function() { done() });
            });
            await A.close();
            layersInCallback.should.equal(0);
            status.should.equal(404);
        });

        it("AC-11: the routes are removed also after removeAllListeners(\"close\")", async function() {
            const A = newNode();
            reg(A, "get", "/a1", send("a1"));
            A.on("close", function() {});
            A.removeAllListeners("close");
            await get("/a1").expect(200);
            await A.close();
            await get("/a1").expect(404);
        });

        it("AC-12: a close callback that never calls done does not keep the routes", async function() {
            const A = newNode();
            reg(A, "get", "/a1", send("a1"));
            A.on("close", function(done) { /* never */ });
            A.close();
            await get("/a1").expect(404);
        });

        it("AC-13: a close callback that throws does not keep the routes (synchronous callback)", async function() {
            const A = newNode();
            reg(A, "get", "/a1", send("a1"));
            A.on("close", function() { throw new Error("sync") });
            await A.close();
            await get("/a1").expect(404);
        });

        it("AC-13: a close callback that throws does not keep the routes (callback with done)", async function() {
            const A = newNode();
            reg(A, "get", "/a1", send("a1"));
            A.on("close", function(done) { throw new Error("with done") });
            await A.close();
            await get("/a1").expect(404);
        });

        describe("AC-15: remove() and close() are idempotent and independent", function() {
            it("remove() twice, close() twice, remove() after close(): no throw, undefined, B is untouched", async function() {
                const A = newNode();
                const B = newNode();
                const handle = reg(A, "get", "/a", send("a"));
                reg(B, "get", "/b", send("b"));
                Object.isFrozen(handle).should.be.true();
                should(handle.remove()).be.undefined();
                should(handle.remove()).be.undefined();
                await get("/a").expect(404);
                await A.close();
                await A.close();
                should(handle.remove()).be.undefined();
                await get("/b").expect(200);
            });
            it("close() after remove() does not throw and removes the other routes of the node", async function() {
                const A = newNode();
                const first = reg(A, "get", "/a", send("a"));
                reg(A, "get", "/a-other", send("a-other"));
                first.remove();
                await A.close();
                await get("/a-other").expect(404);
            });
            it("a remove detached from the handle (without this) removes the route", async function() {
                const A = newNode();
                const handle = reg(A, "get", "/a", send("a"));
                const r = handle.remove;
                should(r()).be.undefined();
                await get("/a").expect(404);
            });
        });

        it("AC-16: remove() removes only that registration (the same path, another registration)", async function() {
            const A = newNode();
            const h1 = reg(A, "get", "/d", send("h1"));
            reg(A, "get", "/d", send("h2"));
            reg(A, "get", "/e", send("e"));
            (await get("/d").expect(200)).text.should.equal("h1");
            h1.remove();
            (await get("/d").expect(200)).text.should.equal("h2");
            await get("/e").expect(200);
            reg(A, "get", "/f", send("f"));
            (await get("/f").expect(200)).text.should.equal("f");
        });

        describe("AC-17: a registration after the close is ignored", function() {
            function checkLate(A, log, calls) {
                calls.forEach(function(handle) {
                    handle.method.should.equal("get");
                    handle.path.should.equal("/late");
                    should(handle.remove()).be.undefined();
                });
                const warns = log.warns("httpRoutes.after-close");
                warns.should.have.length(1);
                warns[0].id.should.equal(A.id);
                warns[0].type.should.equal(A.type);
            }
            it("after close(): three calls, no throw, no route, one warning for the instance", async function() {
                const log = captureLog();
                const A = newNode("late-a", "late-type");
                reg(A, "get", "/x", send("x"));
                await A.close();
                const handles = [];
                for (let i = 0; i < 3; i++) {
                    handles.push(reg(A, "get", "/late", send("late")));
                }
                await get("/late").expect(404);
                checkLate(A, log, handles);
            });
            it("inside a close callback: no route, one warning for the instance", async function() {
                const log = captureLog();
                const A = newNode("late-b", "late-type");
                const handles = [];
                A.on("close", function() {
                    for (let i = 0; i < 3; i++) {
                        handles.push(A.registerHttpRoute("get", "/late", send("late")));
                    }
                });
                needApi(A);
                await A.close();
                handles.should.have.length(3);
                await get("/late").expect(404);
                checkLate(A, log, handles);
            });
            it("the warning is per instance: two closed nodes give two warnings", async function() {
                const log = captureLog();
                const A = newNode("late-c");
                const B = newNode("late-d");
                await A.close();
                await B.close();
                reg(A, "get", "/late", send("late"));
                reg(A, "get", "/late", send("late"));
                reg(B, "get", "/late", send("late"));
                log.warns("httpRoutes.after-close").should.have.length(2);
            });
            it("a late registration does not touch the routes of another node", async function() {
                const A = newNode();
                const B = newNode();
                reg(B, "get", "/b", send("b"));
                await A.close();
                reg(A, "get", "/late", send("late")).remove();
                await get("/b").expect(200);
            });
        });

        it("AC-18: a late close of an old instance does not remove the route of the new instance with the same id", async function() {
            const A1 = newNode("same-id");
            reg(A1, "get", "/x", send("old"));
            await A1.close();
            const A2 = newNode("same-id");
            reg(A2, "get", "/x", send("new"));
            await A1.close();
            (await get("/x").expect(200)).text.should.equal("new");
        });

        describe("AC-19: a failure of the removal is logged and the close goes on", function() {
            async function failWith(thrown, replace) {
                const log = captureLog();
                const A = newNode("failing", "failing-type");
                let callbacks = 0;
                A.on("close", function() { callbacks++ });
                A.on("close", function(done) { callbacks++; done() });
                reg(A, "get", "/a1", send("a1"));
                replace(app._router, thrown);
                await A.close();
                callbacks.should.equal(2);
                const warns = log.warns("httpRoutes.remove-failed");
                warns.should.have.length(1);
                warns[0].id.should.equal("failing");
                warns[0].type.should.equal("failing-type");
                return paramsOf(warns[0]);
            }
            function getterThrows(router, thrown) {
                Object.defineProperty(router, "stack", { get: function() { throw thrown }, configurable: true });
            }
            function proxyThrows(router, thrown) {
                const trap = function() { throw thrown };
                router.stack = new Proxy([], { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, set: trap });
            }
            it("the stack getter throws an Error: the text of the error is in the message", async function() {
                const params = await failWith(new Error("boom"), getterThrows);
                should.exist(params, "the message has parameters");
                params.message.should.equal("boom");
            });
            it("the stack is a Proxy whose traps throw", async function() {
                const params = await failWith(new Error("boom2"), proxyThrows);
                should.exist(params, "the message has parameters");
                params.message.should.equal("boom2");
            });
            it("a thrown value whose message is not a string gives \"unknown error\"", async function() {
                const params = await failWith({ message: 42 }, getterThrows);
                should.exist(params, "the message has parameters");
                params.message.should.equal("unknown error");
            });
            it("a thrown value whose message getter throws gives \"unknown error\"", async function() {
                const thrown = Object.create(null, { message: { get: function() { throw new Error("hostile") } } });
                const params = await failWith(thrown, getterThrows);
                should.exist(params, "the message has parameters");
                params.message.should.equal("unknown error");
            });
            it("a thrown primitive gives \"unknown error\"", async function() {
                const params = await failWith("text", getterThrows);
                should.exist(params, "the message has parameters");
                params.message.should.equal("unknown error");
            });
            it("D16: a long message is cut to 200 characters", async function() {
                const params = await failWith(new Error("x".repeat(500)), getterThrows);
                should.exist(params, "the message has parameters");
                params.message.length.should.be.belowOrEqual(200);
                params.message.should.match(/^x+$/);
            });
            it("the log does not carry the path or the method of the routes", async function() {
                const log = captureLog();
                const A = newNode("failing2");
                reg(A, "get", "/secret-path-a1", send("a1"));
                getterThrows(app._router, new Error("boom"));
                await A.close();
                const warns = log.warns("httpRoutes.remove-failed");
                warns.should.have.length(1);
                JSON.stringify(warns[0]).should.not.match(/secret-path/);
            });
        });

        it("AC-20: a runtime router that is gone: no throw and no warning", async function() {
            const log = captureLog();
            const A = newNode();
            reg(A, "get", "/a1", send("a1"));
            delete app._router;
            await A.close();
            log.warns().should.eql([]);
        });

        it("D8: a router stack that is not an array: nothing to remove, no warning", async function() {
            const log = captureLog();
            const A = newNode();
            reg(A, "get", "/a1", send("a1"));
            app._router.stack = {};
            await A.close();
            log.warns().should.eql([]);
        });

        describe("AC-21: the router of the app is read at the removal", function() {
            // an app of the shape of Express 5: `router` is a lazy getter, no _router
            function fakeExpress5() {
                let router = null;
                const verbs = ["get", "post", "put", "patch", "delete", "options", "head", "all"];
                const fake = {
                    get router() {
                        if (!router) {
                            router = { stack: [] };
                        }
                        return router;
                    },
                    route: function(path) {
                        const route = { path: path, stack: [], methods: {} };
                        verbs.forEach(function(verb) {
                            route[verb] = function() {
                                Array.prototype.slice.call(arguments).concat().forEach(function flat(fn) {
                                    if (Array.isArray(fn)) {
                                        fn.forEach(flat);
                                    } else {
                                        route.stack.push({ handle: fn, method: verb });
                                    }
                                });
                                return route;
                            };
                        });
                        fake.router.stack.push({ name: "bound dispatch", handle: function() {}, route: route });
                        return route;
                    }
                };
                return fake;
            }

            it("an app of the shape of Express 5 (lazy router): the layer of A goes, the layer of B stays", async function() {
                const fake = fakeExpress5();
                redNodes.init(runtimeOf(fake));
                assert.strictEqual(fake._router, undefined);
                const A = newNode();
                const B = newNode();
                reg(A, "get", "/express5-a", send("a"));
                reg(B, "get", "/express5-b", send("b"));
                // the stack is replaced by a new array with the same layers
                fake.router.stack = fake.router.stack.slice();
                const current = fake.router.stack;
                current.should.have.length(2);
                await A.close();
                const paths = fake.router.stack.map(function(layer) { return layer.route.path });
                paths.should.eql(["/express5-b"]);
            });

            it("an Express 5 shaped app: a node that did not register does not create or read the router", async function() {
                let reads = 0;
                const fake = fakeExpress5();
                const real = Object.getOwnPropertyDescriptor(fake, "router").get;
                Object.defineProperty(fake, "router", { get: function() { reads++; return real.call(fake) }, configurable: true });
                redNodes.init(runtimeOf(fake));
                const N = newNode();
                await N.close();
                reads.should.equal(0);
            });

            it("an Express 4 app with the _router.stack replaced by a new array", async function() {
                const A = newNode();
                const B = newNode();
                reg(A, "get", "/express4-a", send("a"));
                reg(B, "get", "/express4-b", send("b"));
                app._router.stack = app._router.stack.slice();
                await A.close();
                app._router.stack.some(function(layer) { return layer.route && layer.route.path === "/express4-a" }).should.be.false();
                app._router.stack.some(function(layer) { return layer.route && layer.route.path === "/express4-b" }).should.be.true();
                await get("/express4-b").expect(200);
                await get("/express4-a").expect(404);
            });
        });

        it("AC-22: after another init the routes of the old app are removed from the old app", async function() {
            const app1 = app;
            const app2 = createApp();
            const A = newNode();
            reg(A, "get", "/r", send("r"));
            await get("/r", app1).expect(200);
            redNodes.init(runtimeOf(app2));
            const before2 = stackOf(app2);
            await A.close();
            await get("/r", app1).expect(404);
            sameStack(before2, app2);
        });

        it("AC-22: after another init a new registration goes to the new app", async function() {
            const app1 = app;
            const app2 = createApp();
            redNodes.init(runtimeOf(app2));
            const B = newNode();
            reg(B, "get", "/s", send("s"));
            await get("/s", app2).expect(200);
            await get("/s", app1).expect(404);
        });

        describe("AC-23: a runtime without nodeApp", function() {
            it("init does not throw, registerHttpRoute throws an Error and registers nothing", function() {
                const before = stackOf(app);
                redNodes.init(runtimeOf());
                const node = newNode();
                needApi(node);
                const result = thrownBy(function() { node.registerHttpRoute("get", "/n", send("n")) });
                should.exist(result.error, "registerHttpRoute did not throw");
                result.error.should.be.instanceof(Error);
                // the previous app (an init before) is not used any more
                sameStack(before, app);
            });
        });

        describe("AC-24: this is not a node", function() {
            it("a detached call and a call on another object throw a TypeError, nothing is registered", function() {
                const node = newNode();
                needApi(node);
                const f = node.registerHttpRoute;
                const before = stackOf(app);
                [function() { f("get", "/x", send("x")) },
                    function() { f.call({}, "get", "/x", send("x")) },
                    function() { f.call(null, "get", "/x", send("x")) }].forEach(function(call) {
                    const result = thrownBy(call);
                    should.exist(result.error, "registerHttpRoute did not throw");
                    result.error.should.be.instanceof(TypeError);
                });
                sameStack(before, app);
            });
        });
    });

    describe("order, the requests in progress, scale", function() {
        it("AC-25: a middleware mounted before comes first; a route is in the order of the registration with the legacy routes", async function() {
            const calls = [];
            app.use(function M(req, res, next) { calls.push("M"); next() });
            const A = newNode();
            const B = newNode();
            reg(A, "get", "/p", function(req, res) { calls.push("R"); res.send("R") });
            app.get("/p", function(req, res) { calls.push("L"); res.send("L") });
            app.get("/q", function(req, res) { calls.push("L2"); res.send("L2") });
            reg(B, "get", "/q", function(req, res) { calls.push("R2"); res.send("R2") });
            (await get("/p")).text.should.equal("R");
            calls.should.eql(["M", "R"]);
            (await get("/q")).text.should.equal("L2");
            await A.close();
            (await get("/p")).text.should.equal("L");
        });

        describe("AC-27: a request in progress", function() {
            async function inProgress(variant) {
                const A = newNode();
                let handle;
                let entered;
                const enteredPromise = new Promise(function(resolve) { entered = resolve });
                let release;
                const gate = new Promise(function(resolve) { release = resolve });
                handle = reg(A, "get", "/slow", function(req, res) {
                    entered();
                    gate.then(function() {
                        if (variant === 2) {
                            handle.remove();
                        }
                        res.status(200).send("done");
                    });
                });
                const inflight = get("/slow").then(function(res) { return res });
                await enteredPromise;
                if (variant === 1) {
                    await A.close();
                }
                await get("/slow").expect(404);
                release();
                const res = await inflight;
                res.status.should.equal(200);
                res.text.should.equal("done");
                await get("/slow").expect(404);
            }
            it("variant 1: A.close() while the handler runs: the request ends with 200, a new one gets 404", async function() {
                await inProgress(1);
            });
            it("variant 2: the handler removes its own route before the answer: 200, then 404", async function() {
                // the route is still there for the second request until the handler removes it:
                // the request in progress is held by the gate, so the second one is sent after the release
                const A = newNode();
                let handle;
                let entered;
                const enteredPromise = new Promise(function(resolve) { entered = resolve });
                let release;
                const gate = new Promise(function(resolve) { release = resolve });
                handle = reg(A, "get", "/slow2", function(req, res) {
                    entered();
                    gate.then(function() {
                        handle.remove();
                        res.status(200).send("done");
                    });
                });
                const inflight = get("/slow2").then(function(res) { return res });
                await enteredPromise;
                release();
                const res = await inflight;
                res.status.should.equal(200);
                res.text.should.equal("done");
                await get("/slow2").expect(404);
            });
        });

        it("AC-28: 1000 routes of each of two nodes: close removes exactly the routes of A", async function() {
            this.timeout(20000);
            const A = newNode();
            const B = newNode();
            for (let i = 0; i < 1000; i++) {
                reg(A, "get", "/a/" + i, send("a" + i));
                reg(B, "get", "/b/" + i, send("b" + i));
            }
            const before = stackOf(app);
            await A.close();
            const expected = before.filter(function(layer) { return !(layer.route && /^\/a\//.test(layer.route.path)) });
            expected.should.have.length(before.length - 1000);
            sameStack(expected, app);
            routeLayers().filter(function(layer) { return /^\/b\//.test(layer.route.path) }).should.have.length(1000);
            await get("/a/0").expect(404);
            await get("/a/999").expect(404);
            await get("/b/0").expect(200);
            await get("/b/999").expect(200);
        });

        it("AC-29: two nodes that register the same handler object: closing one does not remove the route of the other", async function() {
            const shared = send("shared");
            const A = newNode();
            const B = newNode();
            reg(A, "get", "/s", shared);
            reg(B, "get", "/s", shared);
            layersOfPath("/s").should.have.length(2);
            await A.close();
            await get("/s").expect(200);
            layersOfPath("/s").should.have.length(1);
        });
    });

    describe("AC-26: the hold of the requests of a deployment (#8)", function() {
        let server;
        let port;

        function request(path) {
            return new Promise(function(resolve, reject) {
                const req = http.request({ host: "127.0.0.1", port: port, path: path, method: "GET", agent: false }, function(res) {
                    let body = "";
                    res.on("data", function(d) { body += d });
                    res.on("end", function() { resolve({ status: res.statusCode, text: body }) });
                });
                req.on("error", reject);
                req.end();
            });
        }
        function waitHeld(count) {
            return new Promise(function(resolve, reject) {
                let n = 0;
                const timer = setInterval(function() {
                    if (httpHold.pending() >= count) {
                        clearInterval(timer);
                        resolve();
                    } else if (++n > 400) {
                        clearInterval(timer);
                        reject(new Error("not held: " + httpHold.pending() + " of " + count));
                    }
                }, 5);
            });
        }

        beforeEach(function(done) {
            sinon.stub(Log, "warn");
            instanceState.reset();
            instanceState.markStarting();
            instanceState.report({ errors: [] });
            httpHold.init({ deploy: { holdHttpNodeRequests: { enabled: true, timeout: 5000 } } });
            app = express();
            // the hold is the first layer, before the routes of the nodes
            app.use(httpHold.middleware);
            redNodes.init(runtimeOf(app));
            server = http.createServer(app).listen(0, "127.0.0.1", function() {
                port = server.address().port;
                done();
            });
        });
        afterEach(function(done) {
            httpHold.dispose();
            instanceState.reset();
            server.closeAllConnections && server.closeAllConnections();
            server.close(function() { done() });
        });

        it("a route of the API answers at once during a deployment; a removed route holds the request until a new route is added", async function() {
            const A = newNode();
            const handle = reg(A, "get", "/h", send("v1"));
            const token = instanceState.begin("deploy");
            const first = await request("/h");
            first.status.should.equal(200);
            first.text.should.equal("v1");
            httpHold.pending().should.equal(0);
            handle.remove();
            const held = request("/h");
            await waitHeld(1);
            reg(A, "get", "/h", send("v2"));
            instanceState.end(token, { errors: [] });
            const res = await held;
            res.status.should.equal(200);
            res.text.should.equal("v2");
            httpHold.pending().should.equal(0);
        });
    });

    describe("the feature unused: nothing changes", function() {
        it("AC-37: init does not add properties to the app and does not touch its router", function() {
            const nodeApp = express();
            const names = Object.getOwnPropertyNames(nodeApp);
            redNodes.init(runtimeOf(nodeApp));
            Object.getOwnPropertyNames(nodeApp).should.eql(names);
            should(nodeApp._router).be.undefined();
        });

        it("AC-37: init does not change the stack of an app that has a router", function() {
            const nodeApp = createApp();
            const before = stackOf(nodeApp);
            redNodes.init(runtimeOf(nodeApp));
            sameStack(before, nodeApp);
        });

        it("AC-37: the app of the nodes (RED.httpNode) is the app of the runtime", function() {
            const nodeApp = express();
            const runtime = runtimeOf(nodeApp);
            runtime.nodes = redNodes;
            runtime.util = {};
            runtime.plugins = {};
            runtime.library = {};
            runtime.adminApp = express();
            redNodes.init(runtime);
            registryUtil.init(runtime);
            assert.strictEqual(registryUtil.createNodeApi({}).httpNode, nodeApp);
        });

        it("AC-38 (fast path): a node that never registered a route does not read the router at close", async function() {
            const A = newNode();
            reg(A, "get", "/a1", send("a1"));
            const router = app._router;
            let reads = 0;
            delete app._router;
            Object.defineProperty(app, "_router", { get: function() { reads++; return router }, configurable: true });
            const N = newNode();
            const log = captureLog();
            await N.close(true);
            await N.close(false);
            reads.should.equal(0);
            log.entries("httpRoutes").should.eql([]);
            // the route of another node is not touched
            await get("/a1").expect(200);
        });

        it("AC-39: a route registered with RED.httpNode (not the API) is not removed when the node closes", async function() {
            const A = newNode();
            app.get("/legacy-a", send("legacy-a"));
            await A.close();
            (await get("/legacy-a").expect(200)).text.should.equal("legacy-a");
        });
    });
});
