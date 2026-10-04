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
 *   Z-02: tests of the httpAdmin guard (httpAdminNodeRoutes) in the node api
 *   Z-02: tests of use() without a path and of the position of the permission marker
 *   Z-02: tests of use() with paths that match every path
 *   Z-10: test of RED.coordination in the node api
 *   #19: supertest bound to 127.0.0.1 (nr-test-utils/supertest), no crosstalk with other processes (flaky tests)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");

const NR_TEST_UTILS = require("nr-test-utils");
const registryUtil = NR_TEST_UTILS.require("@node-red/registry/lib/util");

// Get the internal runtime api
const runtime = NR_TEST_UTILS.require("@node-red/runtime")._;

const i18n = NR_TEST_UTILS.require("@node-red/util").i18n;

describe("red/nodes/registry/util",function() {
    describe("createNodeApi", function() {
        let i18n_;
        let registerType;
        let registerSubflow;

        before(function() {
            i18n_ = sinon.stub(i18n,"_").callsFake(function() {
                return Array.prototype.slice.call(arguments,0);
            })
            registerType = sinon.stub(runtime.nodes,"registerType");
            registerSubflow = sinon.stub(runtime.nodes,"registerSubflow");
        });
        after(function() {
            i18n_.restore();
            registerType.restore();
            registerSubflow.restore();
        })

        it("builds node-specific view of runtime api", function() {
            registryUtil.init(runtime);
            var result = registryUtil.createNodeApi({id: "my-node", namespace: "my-namespace"})
            // Need a better strategy here.
            // For now, validate the node-custom functions

            var message = result._("message");
            // This should prepend the node's namespace to the message
            message.should.eql([ 'my-namespace:message' ]);

            var nodeConstructor = () => {};
            var nodeOpts = {};
            result.nodes.registerType("type",nodeConstructor, nodeOpts);
            registerType.called.should.be.true();
            registerType.lastCall.args[0].should.eql("my-node")
            registerType.lastCall.args[1].should.eql("type")
            registerType.lastCall.args[2].should.eql(nodeConstructor)
            registerType.lastCall.args[3].should.eql(nodeOpts)

            var subflowDef = {};
            result.nodes.registerSubflow(subflowDef);
            registerSubflow.called.should.be.true();
            registerSubflow.lastCall.args[0].should.eql("my-node")
            registerSubflow.lastCall.args[1].should.eql(subflowDef)

        });

        it("createNodeApi exposes RED.coordination", function() {
            registryUtil.init(runtime);
            const result = registryUtil.createNodeApi({id: "my-node", namespace: "my-namespace"});
            should.exist(result.coordination);
            result.coordination.should.equal(runtime.coordination.api);
            result.coordination.isLeader.should.be.a.Function();
            result.coordination.onLeaderChange.should.be.a.Function();
            result.coordination.claim.should.be.a.Function();
            result.coordination.info.should.be.a.Function();
        });

        it("createNodeApi without coordination in the runtime leaves RED.coordination undefined", function() {
            registryUtil.init({nodes: runtime.nodes, settings: {}, hooks: runtime.hooks, util: runtime.util, plugins: runtime.plugins, library: runtime.library});
            const result = registryUtil.createNodeApi({id: "my-node", namespace: "my-namespace"});
            should.not.exist(result.coordination);
            registryUtil.init(runtime);
        });
    });
    describe("createNodeApi httpAdmin guard", function() {
        const express = require("express");
        const request = require("nr-test-utils/supertest");
        const log = NR_TEST_UTILS.require("@node-red/util").log;
        const ADMIN_ROUTE_AUTH = Symbol.for("node-red.adminRouteAuth");
        let adminApp;
        let fakeAuth;
        let logInfo;
        let logWarn;

        // A fake auth api: needsPermission() requires an 'x-token' header,
        // which must contain the permission (or 'any' for permission "")
        function createFakeAuth() {
            return {
                needsPermission: sinon.spy(function(permission) {
                    const fn = function(req,res,next) {
                        const token = req.headers['x-token'];
                        if (token && (permission === "" || token === permission)) {
                            return next();
                        }
                        res.status(401).end();
                    };
                    fn[ADMIN_ROUTE_AUTH] = "permission";
                    return fn;
                }),
                publicRoute: function() {
                    const fn = function(req,res,next) { next() };
                    fn[ADMIN_ROUTE_AUTH] = "public";
                    return fn;
                }
            }
        }
        function createApi(settings, node) {
            registryUtil.init({
                nodes: {},
                settings: settings,
                adminApp: adminApp,
                adminApi: { auth: fakeAuth },
                plugins: {},
                library: {}
            });
            return registryUtil.createNodeApi(node || {id: "my-module/my-set", module: "my-module", namespace: "my-module"});
        }
        function ok(req,res) { res.status(200).end() }

        beforeEach(function() {
            adminApp = express();
            fakeAuth = createFakeAuth();
            logInfo = sinon.stub(log,"info");
            logWarn = sinon.stub(log,"warn");
            sinon.stub(log,"_").callsFake(function(key, opts) { return key+" "+JSON.stringify(opts||{}) });
        });
        afterEach(function() {
            log._.restore();
            logInfo.restore();
            logWarn.restore();
        });

        it("returns runtime.adminApp unchanged when setting is not set", async function() {
            const RED = createApi({adminAuth: {}});
            RED.httpAdmin.should.equal(adminApp);
            RED.httpAdmin.get("/z02/open", ok);
            await request(adminApp).get("/z02/open").expect(200);
            logWarn.called.should.be.false();
        });
        it("returns runtime.adminApp unchanged when open", function() {
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "open"});
            RED.httpAdmin.should.equal(adminApp);
            logWarn.called.should.be.false();
        });
        it("exposes publicRoute in open mode", async function() {
            const RED = createApi({adminAuth: {}});
            RED.auth.publicRoute.should.be.a.Function();
            RED.httpAdmin.get("/z02/public", RED.auth.publicRoute(), ok);
            await request(adminApp).get("/z02/public").expect(200);
            logInfo.called.should.be.false();
        });
        it("prepends authentication to routes without marker", async function() {
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"});
            RED.httpAdmin.should.not.equal(adminApp);
            RED.httpAdmin.get("/z02/open", ok);
            await request(adminApp).get("/z02/open").expect(401);
            await request(adminApp).get("/z02/open").set("x-token","any").expect(200);
            fakeAuth.needsPermission.calledWith("").should.be.true();
        });
        it("keeps routes with needsPermission unchanged", async function() {
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"});
            RED.httpAdmin.get("/z02/perm", RED.auth.needsPermission("z02.read"), ok);
            fakeAuth.needsPermission.callCount.should.equal(1);
            await request(adminApp).get("/z02/perm").set("x-token","any").expect(401);
            await request(adminApp).get("/z02/perm").set("x-token","z02.read").expect(200);
        });
        it("guards a route whose permission marker follows a handler (D1)", async function() {
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"});
            RED.httpAdmin.get("/z02/order", ok, RED.auth.needsPermission("z02.read"));
            await request(adminApp).get("/z02/order").expect(401);
            fakeAuth.needsPermission.calledWith("").should.be.true();
            await request(adminApp).get("/z02/order").set("x-token","any").expect(200);
        });
        it("accepts several markers before the first handler", async function() {
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"});
            RED.httpAdmin.get("/z02/two", [RED.auth.needsPermission("z02.read")], RED.auth.needsPermission("z02.read"), ok);
            fakeAuth.needsPermission.callCount.should.equal(2);
            await request(adminApp).get("/z02/two").set("x-token","z02.read").expect(200);
        });
        it("finds the marker in an array of handlers", async function() {
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"});
            RED.httpAdmin.get("/z02/perm", [RED.auth.needsPermission("z02.read"), ok]);
            fakeAuth.needsPermission.callCount.should.equal(1);
            await request(adminApp).get("/z02/perm").set("x-token","z02.read").expect(200);
        });
        it("does not guard publicRoute and logs it", async function() {
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"});
            RED.httpAdmin.get("/z02/public", RED.auth.publicRoute(), ok);
            await request(adminApp).get("/z02/public").expect(200);
            logInfo.calledOnce.should.be.true();
            const msg = logInfo.firstCall.args[0];
            msg.should.containEql("my-module");
            msg.should.containEql("GET");
            msg.should.containEql("/z02/public");
        });
        it("guards post, all, use and route", async function() {
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"});
            RED.httpAdmin.post("/z02/post", ok);
            RED.httpAdmin.all("/z02/all", ok);
            RED.httpAdmin.use("/z02/use", ok);
            const route = RED.httpAdmin.route("/z02/route");
            route.get(ok).should.equal(route);
            route.put(ok);
            await request(adminApp).post("/z02/post").expect(401);
            await request(adminApp).delete("/z02/all").expect(401);
            await request(adminApp).get("/z02/use/x").expect(401);
            await request(adminApp).get("/z02/route").expect(401);
            await request(adminApp).put("/z02/route").expect(401);
            await request(adminApp).post("/z02/post").set("x-token","any").expect(200);
            await request(adminApp).delete("/z02/all").set("x-token","any").expect(200);
            await request(adminApp).get("/z02/use/x").set("x-token","any").expect(200);
            await request(adminApp).get("/z02/route").set("x-token","any").expect(200);
            await request(adminApp).put("/z02/route").set("x-token","any").expect(200);
        });
        it("skips use without a path for a request without authentication", async function() {
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"});
            RED.httpAdmin.use(ok);
            await request(adminApp).get("/anything").expect(404);
            await request(adminApp).get("/anything").set("x-token","any").expect(200);
        });
        it("use without a path does not block routes of other modules (W1)", async function() {
            const A = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"}, {id: "a/a", module: "a", namespace: "a"});
            let globalCalls = 0;
            A.httpAdmin.use(function(req,res,next) { globalCalls++; res.set("x-global","1"); next() });
            A.httpAdmin.use("/", function(req,res,next) { globalCalls++; next() });
            const B = registryUtil.createNodeApi({id: "b/b", module: "b", namespace: "b"});
            B.httpAdmin.get("/b/view/x", B.auth.publicRoute(), ok);
            B.httpAdmin.get("/b/protected", ok);
            const pub = await request(adminApp).get("/b/view/x").expect(200);
            should.not.exist(pub.headers["x-global"]);
            globalCalls.should.equal(0);
            await request(adminApp).get("/b/protected").expect(401);
            await request(adminApp).get("/nonexistent").expect(404);
            const authed = await request(adminApp).get("/b/protected").set("x-token","any").expect(200);
            authed.headers["x-global"].should.equal("1");
            globalCalls.should.equal(2);
            // The authentication check runs once per request for one use() call
            fakeAuth.needsPermission.callCount.should.equal(3);
        });
        // every form that express matches against every path, as use() without a path
        [["\"\"", ""], ["\"/\"", "/"], ["[\"/\"]", ["/"]], ["/.*/", /.*/], ["\"*\"", "*"], ["\"/*\"", "/*"],
         ["\"**\"", "**"], ["\"/*/\"", "/*/"], ["\"*/*\"", "*/*"], ["\"/:any?\"", "/:any?"], ["/^\\/.*/", /^\/.*/],
         ["[\"/a\", \"/*\"]", ["/a", "/*"]]].forEach(function(form) {
            it("use(" + form[0] + ") does not block routes of other modules (W1)", async function() {
                const A = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"}, {id: "a/a", module: "a", namespace: "a"});
                let globalCalls = 0;
                A.httpAdmin.use(form[1], function(req,res,next) { globalCalls++; next() });
                const B = registryUtil.createNodeApi({id: "b/b", module: "b", namespace: "b"});
                B.httpAdmin.get("/b/view/x", B.auth.publicRoute(), ok);
                B.httpAdmin.get("/b/protected", ok);
                await request(adminApp).get("/b/view/x").expect(200);
                globalCalls.should.equal(0);
                await request(adminApp).get("/b/protected").expect(401);
                await request(adminApp).get("/nonexistent").expect(404);
                await request(adminApp).get("/b/protected").set("x-token","any").expect(200);
                globalCalls.should.equal(1);
            });
        });
        // paths that do not match every path keep the guard (401 without authentication);
        // express mounts a use() regexp only at a "/" or "." after the matched part, so /^\// matches "/" only
        [["\"/a\"", "/a"], ["\"/a*\"", "/a*"], ["[\"/a\"]", ["/a"]], ["/^\\/a/", /^\/a/], ["\"//\"", "//", true], ["/^\\//", /^\//, true]].forEach(function(form) {
            it("use(" + form[0] + ") is guarded and does not affect other routes", async function() {
                const A = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"}, {id: "a/a", module: "a", namespace: "a"});
                A.httpAdmin.use(form[1], ok);
                const B = registryUtil.createNodeApi({id: "b/b", module: "b", namespace: "b"});
                B.httpAdmin.get("/b/view/x", B.auth.publicRoute(), ok);
                await request(adminApp).get("/b/view/x").expect(200);
                if (!form[2]) {
                    await request(adminApp).get("/a").expect(401);
                    await request(adminApp).get("/a").set("x-token","any").expect(200);
                }
            });
        });
        it("recognises paths matching every path from their text without the express matcher", function() {
            // an app without the express 4 router (no layer class to test the path with)
            const used = [];
            adminApp = { use: function() { used.push(Array.prototype.slice.call(arguments)) } };
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"});
            const fn = function(req,res,next) { next() };
            const isGuarded = call => call.flat().some(h => typeof h === "function" && h[ADMIN_ROUTE_AUTH] === "permission");
            ["", "/", "*", "/*", "**", "/*/", "(.*)", /.*/, /^\/.*/, ["/a", "*"]].forEach(function(p, i) {
                RED.httpAdmin.use(p, fn);
                isGuarded(used[i]).should.be.false(String(p));
            });
            const n = used.length;
            ["/a", "/a*", /^\/a/, /^\//, ["/a"]].forEach(function(p, i) {
                RED.httpAdmin.use(p, fn);
                isGuarded(used[n + i]).should.be.true(String(p));
            });
        });
        it("keeps the arity of an error handler given to use without a path", async function() {
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"});
            RED.httpAdmin.get("/z02/fail", function(req,res,next) { next(new Error("boom")) });
            RED.httpAdmin.use(function(err,req,res,next) { res.status(418).end() });
            await request(adminApp).get("/z02/fail").expect(401);
            await request(adminApp).get("/z02/fail").set("x-token","any").expect(418);
        });
        it("mounts a sub-application given to use without a path", async function() {
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"});
            const sub = express();
            sub.get("/sub2/x", function(req,res) { res.send(String(req.app === sub)) });
            RED.httpAdmin.use(sub);
            sub.parent.should.equal(adminApp);
            adminApp.get("/after", function(req,res) { res.send(String(req.app === adminApp)) });
            await request(adminApp).get("/sub2/x").expect(404);
            const res = await request(adminApp).get("/sub2/x").set("x-token","any").expect(200);
            res.text.should.equal("true");
            const after = await request(adminApp).get("/after").set("x-token","any").expect(200);
            after.text.should.equal("true");
        });
        it("guards a mounted sub-application", async function() {
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"});
            const sub = express();
            sub.get("/x", ok);
            RED.httpAdmin.use("/sub", sub);
            await request(adminApp).get("/sub/x").expect(401);
            await request(adminApp).get("/sub/x").set("x-token","any").expect(200);
        });
        it("passes app.get(setting) through", function() {
            adminApp.set("my-setting", 123);
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"});
            RED.httpAdmin.get("my-setting").should.equal(123);
        });
        it("routes registered through the guard are added to runtime.adminApp", async function() {
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "authenticated"});
            RED.httpAdmin.param("id", function(req,res,next,id) { req.z02 = id; next() });
            RED.httpAdmin.get("/z02/item/:id", function(req,res) { res.send(req.z02) });
            const res = await request(adminApp).get("/z02/item/abc").set("x-token","any").expect(200);
            res.text.should.equal("abc");
        });
        it("unknown value guards like authenticated and logs warning (R-41)", async function() {
            const RED = createApi({adminAuth: {}, httpAdminNodeRoutes: "closed"});
            RED.httpAdmin.get("/z02/open", ok);
            await request(adminApp).get("/z02/open").expect(401);
            logWarn.calledOnce.should.be.true();
            logWarn.firstCall.args[0].should.containEql("closed");
            // Only warns once
            registryUtil.createNodeApi({id: "other/set", module: "other", namespace: "other"});
            logWarn.calledTwice.should.be.false();
        });
        it("warns once and does not guard when adminAuth is not set", async function() {
            createApi({httpAdminNodeRoutes: "authenticated"});
            const RED = registryUtil.createNodeApi({id: "other/set", module: "other", namespace: "other"});
            RED.httpAdmin.should.equal(adminApp);
            RED.httpAdmin.get("/z02/open", ok);
            await request(adminApp).get("/z02/open").expect(200);
            logWarn.calledOnce.should.be.true();
        });
        it("provides publicRoute when the admin api is not available", function() {
            registryUtil.init({ nodes: {}, settings: {httpAdminNodeRoutes: "authenticated"}, adminApp: adminApp, plugins: {}, library: {} });
            const RED = registryUtil.createNodeApi({id: "my-module/my-set", namespace: "my-module"});
            RED.auth.publicRoute.should.be.a.Function();
            RED.auth.needsPermission("foo").should.be.a.Function();
        });
    });
    describe("checkModuleAllowed", function() {
        function checkList(module, version, allowList, denyList) {
            return registryUtil.checkModuleAllowed(
                module,
                version,
                registryUtil.parseModuleList(allowList),
                registryUtil.parseModuleList(denyList)
            )
        }

        it("allows module with no allow/deny list provided", function() {
            checkList("abc","1.2.3",[],[]).should.be.true();
        })
        it("defaults allow to * when only deny list is provided", function() {
            checkList("abc","1.2.3",["*"],["def"]).should.be.true();
            checkList("def","1.2.3",["*"],["def"]).should.be.false();
        })
        it("uses most specific matching rule", function() {
            checkList("abc","1.2.3",["ab*"],["a*"]).should.be.true();
            checkList("def","1.2.3",["d*"],["de*"]).should.be.false();
        })
        it("checks version string using semver rules", function() {
            // Deny
            checkList("abc","1.2.3",["abc@1.2.2"],["*"]).should.be.false();
            checkList("abc","1.2.3",["abc@1.2.4"],["*"]).should.be.false();
            checkList("abc","1.2.3",["abc@>1.2.3"],["*"]).should.be.false();
            checkList("abc","1.2.3",["abc@>=1.2.3"],["abc"]).should.be.false();


            checkList("node-red-contrib-foo","1.2.3",["*"],["*contrib*"]).should.be.false();


            // Allow
            checkList("abc","1.2.3",["abc@1.2.3"],["*"]).should.be.true();
            checkList("abc","1.2.3",["abc@<1.2.4"],["*"]).should.be.true();
            checkList("abc","1.2.3",["abc"],["abc@>1.2.3"]).should.be.true();
            checkList("abc","1.2.3",["abc"],["abc@<1.2.3||>1.2.3"]).should.be.true();
            checkList("node-red-contrib-foo","1.2.3",["*contrib*"],["*"]).should.be.true();
        })

    })
});
