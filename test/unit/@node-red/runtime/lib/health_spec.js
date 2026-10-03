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
 *   Z-08: tests of the health probes /live and /ready
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const http = require("http");
const net = require("net");
const express = require("express");
const request = require("supertest");
const NR_TEST_UTILS = require("nr-test-utils");
const health = NR_TEST_UTILS.require("@node-red/runtime/lib/health");
const state = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
const { log } = NR_TEST_UTILS.require("@node-red/util");

function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, "127.0.0.1", () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
        srv.on("error", reject);
    });
}

function get(port, path, method) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port: port, path: path, method: method || "GET" }, res => {
            let text = "";
            res.on("data", d => text += d);
            res.on("end", () => resolve({ status: res.statusCode, text: text, headers: res.headers }));
        });
        req.on("error", reject);
        req.end();
    });
}

// Moves the instance state to the given state through its api
const drive = {
    init: function() {},
    starting: function() { state.markStarting() },
    ready: function() { state.markStarting(); state.report({ errors: [] }) },
    deploying: function() { drive.ready(); state.begin("deploy") },
    reloadPending: function() { drive.ready(); state.markReloadPending() },
    draining: function() { drive.ready(); state.markReloadPending(); state.markDraining() },
    reloading: function() { drive.ready(); state.markReloadPending(); state.begin("reload") },
    idle: function() { state.markStarting(); state.report({ flowsRunning: false, reason: "safe-mode" }) },
    loaded: function() { state.markStarting(); state.report({ flowsRunning: false, reason: "editor-only" }) },
    failed: function() { state.markStarting(); state.report({ errors: [{ code: "missing_types" }] }) },
    stopping: function() { drive.ready(); state.markStopping("SIGTERM") },
    stopped: function() { drive.stopping(); state.markStopped() }
};

describe("runtime/health (Z-08)", function() {
    let app;
    beforeEach(function() {
        state.reset();
        sinon.stub(log, "info");
        sinon.stub(log, "warn");
        sinon.stub(log, "_").callsFake(key => key);
        health.init({ health: { enabled: true }, uiPort: 1880 });
        app = express();
        app.use(health.getPath(), health.handler);
    });
    afterEach(async function() {
        sinon.restore();
        await health.stop();
        state.reset();
    });

    describe("handler", function() {
        Object.keys(drive).forEach(function(name) {
            it("live returns 200 in " + name, async function() {
                drive[name]();
                const res = await request(app).get("/health/live");
                res.status.should.equal(200);
                res.body.should.eql({ status: "ok" });
            });
        });

        ["ready", "loaded", "reloadPending"].forEach(function(name) {
            it("ready returns 200 in " + name, async function() {
                drive[name]();
                const res = await request(app).get("/health/ready");
                res.status.should.equal(200);
                res.body.should.eql({ status: "ok" });
            });
        });

        ["init", "starting", "deploying", "draining", "reloading", "idle", "failed", "stopping", "stopped"].forEach(function(name) {
            it("ready returns 503 with a constant body in " + name + " (R-22)", async function() {
                drive[name]();
                const res = await request(app).get("/health/ready");
                res.status.should.equal(503);
                res.text.should.equal('{"status":"unavailable"}');
            });
        });

        it("body contains only status, json content type and Cache-Control no-store", async function() {
            drive.failed();
            for (const p of ["/health/live", "/health/ready"]) {
                const res = await request(app).get(p);
                Object.keys(res.body).should.eql(["status"]);
                res.headers["content-type"].should.match(/^application\/json/);
                res.headers["cache-control"].should.equal("no-store");
            }
        });

        it("405 for POST with an Allow header", async function() {
            const res = await request(app).post("/health/ready");
            res.status.should.equal(405);
            res.headers.allow.should.equal("GET, HEAD");
        });

        it("HEAD supported without a body", async function() {
            drive.ready();
            const res = await request(app).head("/health/live");
            res.status.should.equal(200);
            should(res.text).be.undefined();
        });

        it("404 for an unknown subpath", async function() {
            (await request(app).get("/health/other")).status.should.equal(404);
            (await request(app).get("/health")).status.should.equal(404);
        });

        it("ignores the query string", async function() {
            drive.ready();
            (await request(app).get("/health/ready?x=1")).status.should.equal(200);
        });

        it("a custom path", async function() {
            health.init({ health: { enabled: true, path: "/probes/" } });
            health.getPath().should.equal("/probes");
            const app2 = express();
            app2.use(health.getPath(), health.handler);
            (await request(app2).get("/probes/live")).status.should.equal(200);
        });
    });

    describe("settings", function() {
        it("disabled by default - no routes, no server", async function() {
            health.init({});
            health.isEnabled().should.be.false();
            health.usesMainServer().should.be.false();
            await health.start();
            should(health.getServer()).be.null();
        });

        it("enabled without a port uses the main server", function() {
            health.init({ health: { enabled: true }, uiPort: 1880 });
            health.usesMainServer().should.be.true();
            health.getPath().should.equal("/health");
        });

        it("invalid path rejected at start (health.invalid-path)", async function() {
            for (const p of ["health", "/", ""]) {
                health.init({ health: { enabled: true, path: p } });
                const err = await health.start().should.be.rejected();
                err.should.have.property("code", "health.invalid-path");
            }
        });

        it("logs when the path is inside httpNodeRoot or httpAdminRoot (shadowed routes)", async function() {
            health.init({ health: { enabled: true }, httpNodeRoot: "/", httpAdminRoot: "/admin/" });
            await health.start();
            log.info.calledWithMatch("health.path-shadows-route").should.be.true();
        });

        it("port equal to uiPort mounts on the main server and warns", async function() {
            health.init({ health: { enabled: true, port: 1880 }, uiPort: 1880 });
            health.usesMainServer().should.be.true();
            await health.start();
            should(health.getServer()).be.null();
            log.warn.calledWithMatch("health.port-is-ui-port").should.be.true();
        });
    });

    describe("own server (health.port)", function() {
        it("starts its own server on the port", async function() {
            const port = await getFreePort();
            health.init({ health: { enabled: true, port: port, host: "127.0.0.1" }, uiPort: 1880 });
            health.usesMainServer().should.be.false();
            await health.start();
            should.exist(health.getServer());
            drive.ready();
            (await get(port, "/health/ready")).status.should.equal(200);
            (await get(port, "/health/live")).status.should.equal(200);
            (await get(port, "/other")).status.should.equal(404);
            (await get(port, "/healthz/ready")).status.should.equal(404);
            (await get(port, "/health/ready", "POST")).status.should.equal(405);
            state.markStopping();
            (await get(port, "/health/ready")).status.should.equal(503);
            log.info.calledWithMatch("health.listening").should.be.true();
        });

        it("port in use - start rejects with health.port-in-use", async function() {
            const blocker = net.createServer();
            await new Promise(resolve => blocker.listen(0, "127.0.0.1", resolve));
            const port = blocker.address().port;
            try {
                health.init({ health: { enabled: true, port: port, host: "127.0.0.1" }, uiPort: 1880 });
                const err = await health.start().should.be.rejected();
                err.should.have.property("code", "health.port-in-use");
                should(health.getServer()).be.null();
            } finally {
                blocker.close();
            }
        });

        it("stop closes the own server", async function() {
            const port = await getFreePort();
            health.init({ health: { enabled: true, port: port, host: "127.0.0.1" } });
            await health.start();
            await health.stop();
            should(health.getServer()).be.null();
            await get(port, "/health/live").should.be.rejected();
        });

        it("the host defaults to uiHost", async function() {
            const port = await getFreePort();
            health.init({ health: { enabled: true, port: port }, uiHost: "127.0.0.1" });
            await health.start();
            health.getServer().address().address.should.equal("127.0.0.1");
        });
    });

    describe("closeServer", function() {
        it("closes a server and its idle connections", async function() {
            const server = http.createServer((req, res) => res.end("x"));
            await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
            const port = server.address().port;
            const agent = new http.Agent({ keepAlive: true });
            await new Promise(resolve => http.get({ host: "127.0.0.1", port: port, agent: agent }, res => { res.resume(); res.on("end", resolve) }));
            await health.closeServer(server, 2000);
            server.listening.should.be.false();
            agent.destroy();
        });

        it("resolves after the limit when a connection stays active", async function() {
            const server = http.createServer(() => { /* never answers */ });
            await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
            const port = server.address().port;
            const req = http.get({ host: "127.0.0.1", port: port });
            req.on("error", () => {});
            await new Promise(resolve => setTimeout(resolve, 50));
            const start = Date.now();
            await health.closeServer(server, 100);
            (Date.now() - start).should.be.below(1000);
            req.destroy();
        });

        it("resolves for a server that is not listening", async function() {
            await health.closeServer(http.createServer(), 100);
            await health.closeServer(null, 100);
        });
    });
});
