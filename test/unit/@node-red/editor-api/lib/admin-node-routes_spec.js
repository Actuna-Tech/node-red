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
 *   Z-02: integration tests of httpAdminNodeRoutes (editor-api auth + node admin routes)
 *   Z-02: use() without a path and the position of the permission marker
 *   #19: supertest bound to 127.0.0.1 (nr-test-utils/supertest), no crosstalk with other processes (flaky tests)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const request = require("nr-test-utils/supertest");
const express = require("express");

const NR_TEST_UTILS = require("nr-test-utils");
const api = NR_TEST_UTILS.require("@node-red/editor-api");
const apiAdmin = NR_TEST_UTILS.require("@node-red/editor-api/lib/admin");
const registryUtil = NR_TEST_UTILS.require("@node-red/registry/lib/util");
const log = NR_TEST_UTILS.require("@node-red/util").log;

describe("api/admin node routes (httpAdminNodeRoutes)", function() {
    // Note: the "read" scope grants every "*.read" permission, so the
    // route with a permission uses "z02.write"
    function ok(req,res) { res.status(200).end() }

    let runtimeAdminApp;

    function setup(settings) {
        settings = Object.assign({ disableEditor: true }, settings);
        const storage = {
            getSessions: function() { return Promise.resolve({}) },
            saveSessions: function() { return Promise.resolve() }
        };
        api.init(settings, null, storage, {});
        runtimeAdminApp = express();
        api.httpAdmin.use(runtimeAdminApp);
        registryUtil.init({
            nodes: {},
            settings: settings,
            adminApp: runtimeAdminApp,
            adminApi: api,
            plugins: {},
            library: {}
        });
        const RED = registryUtil.createNodeApi({ id: "z02-module/z02", module: "z02-module", namespace: "z02-module" });
        RED.httpAdmin.get("/z02/open", ok);
        RED.httpAdmin.get("/z02/perm", RED.auth.needsPermission("z02.write"), ok);
        RED.httpAdmin.get("/z02/public", RED.auth.publicRoute(), ok);
        RED.httpAdmin.post("/z02/post", ok);
        RED.httpAdmin.all("/z02/all", ok);
        RED.httpAdmin.use("/z02/use", ok);
        RED.httpAdmin.route("/z02/route").get(ok);
        return RED;
    }
    function adminAuth(extra) {
        return Object.assign({
            type: "credentials",
            users: [
                { username: "reader", password: "x", permissions: "read" },
                { username: "z02", password: "x", permissions: ["read", "z02.write"] }
            ],
            tokens: [
                { token: "tok-reader", user: "reader", scope: ["read"] },
                { token: "tok-z02", user: "z02", scope: ["read", "z02.write"] }
            ]
        }, extra);
    }

    beforeEach(function() {
        sinon.stub(apiAdmin, "init").callsFake(function() {
            const app = express();
            app.get("/flows", function(req,res) { res.status(200).end() });
            return app;
        });
        sinon.stub(log, "info");
        sinon.stub(log, "warn");
        sinon.stub(log, "audit");
        sinon.stub(log, "_").callsFake(function(key, opts) { return key+" "+JSON.stringify(opts||{}) });
    });
    afterEach(function() {
        apiAdmin.init.restore();
        log.info.restore();
        log.warn.restore();
        log.audit.restore();
        log._.restore();
    });

    describe("authenticated mode", function() {
        beforeEach(function() {
            setup({ adminAuth: adminAuth(), httpAdminNodeRoutes: "authenticated" });
        });
        it("route without permission requires a session", async function() {
            await request(api.httpAdmin).get("/z02/open").expect(401);
            await request(api.httpAdmin).get("/z02/open").set("Authorization","Bearer tok-reader").expect(200);
        });
        it("route with needsPermission is unchanged", async function() {
            await request(api.httpAdmin).get("/z02/perm").set("Authorization","Bearer tok-reader").expect(401);
            await request(api.httpAdmin).get("/z02/perm").set("Authorization","Bearer tok-z02").expect(200);
        });
        it("public route is available without a session and logged", async function() {
            await request(api.httpAdmin).get("/z02/public").expect(200);
            log.info.calledWithMatch(/z02-module/).should.be.true();
            log.info.calledWithMatch(/\/z02\/public/).should.be.true();
        });
        it("all registration methods are guarded", async function() {
            await request(api.httpAdmin).post("/z02/post").expect(401);
            await request(api.httpAdmin).get("/z02/all").expect(401);
            await request(api.httpAdmin).get("/z02/use").expect(401);
            await request(api.httpAdmin).get("/z02/route").expect(401);
        });
        it("use without a path does not block public routes of other modules (W1)", async function() {
            const plugin = registryUtil.createNodeApi({ id: "w1-plugin/w1", module: "w1-plugin", namespace: "w1-plugin" });
            plugin.httpAdmin.use(function(req,res,next) { res.set("x-w1","1"); next() });
            const other = registryUtil.createNodeApi({ id: "w1-other/w1", module: "w1-other", namespace: "w1-other" });
            other.httpAdmin.get("/w1/view/x", other.auth.publicRoute(), ok);
            other.httpAdmin.get("/w1/protected", ok);
            const pub = await request(api.httpAdmin).get("/w1/view/x").expect(200);
            should.not.exist(pub.headers["x-w1"]);
            await request(api.httpAdmin).get("/z02/public").expect(200);
            await request(api.httpAdmin).get("/w1/protected").expect(401);
            await request(api.httpAdmin).get("/w1/unknown").expect(404);
            const authed = await request(api.httpAdmin).get("/w1/protected").set("Authorization","Bearer tok-reader").expect(200);
            authed.headers["x-w1"].should.equal("1");
        });
        it("a permission marker after a handler does not count (D1)", async function() {
            const RED = registryUtil.createNodeApi({ id: "d1-module/d1", module: "d1-module", namespace: "d1-module" });
            RED.httpAdmin.get("/d1/order", ok, RED.auth.needsPermission("z02.write"));
            await request(api.httpAdmin).get("/d1/order").expect(401);
        });
        it("built-in routes are unchanged", async function() {
            await request(api.httpAdmin).get("/auth/login").expect(200);
        });
    });

    describe("default user (R-07)", function() {
        beforeEach(function() {
            setup({ adminAuth: adminAuth({ default: { permissions: "read" } }), httpAdminNodeRoutes: "authenticated" });
        });
        it("anonymous default user can access unmarked route", async function() {
            await request(api.httpAdmin).get("/z02/open").expect(200);
        });
        it("anonymous default user cannot access route with permission", async function() {
            await request(api.httpAdmin).get("/z02/perm").expect(401);
        });
    });

    describe("default mode", function() {
        it("route without permission is open and httpAdmin is the runtime admin app", async function() {
            const RED = setup({ adminAuth: adminAuth() });
            RED.httpAdmin.should.equal(runtimeAdminApp);
            await request(api.httpAdmin).get("/z02/open").expect(200);
            log.warn.called.should.be.false();
        });
    });

    describe("without adminAuth", function() {
        it("logs a warning and leaves routes open", async function() {
            setup({ httpAdminNodeRoutes: "authenticated" });
            log.warn.calledWithMatch(/no-admin-auth/).should.be.true();
            await request(api.httpAdmin).get("/z02/open").expect(200);
        });
    });

    describe("unknown value (R-41)", function() {
        it("is treated as authenticated with a warning", async function() {
            setup({ adminAuth: adminAuth(), httpAdminNodeRoutes: "closed" });
            log.warn.calledWithMatch(/unknown-value/).should.be.true();
            await request(api.httpAdmin).get("/z02/open").expect(401);
        });
    });
});
