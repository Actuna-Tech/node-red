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
 *   #1 (R-47): tests of the readiness policy with the condition `reload` (warn)
 *   #19: supertest bound to 127.0.0.1 (nr-test-utils/supertest), no crosstalk with other processes (flaky tests)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const http = require("http");
const net = require("net");
const express = require("express");
const request = require("nr-test-utils/supertest");
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

    describe("readiness policy with the condition reload (R-47)", function() {
        const OK = { status: 200, body: '{"status":"ok"}' };
        const WARN = { status: 200, body: '{"status":"warn","reason":"reload_failed"}' };
        const UNAVAILABLE = { status: 503, body: '{"status":"unavailable"}' };
        function cond(keepReady, staleDeadline) {
            return { error: { code: "storage_error" }, since: 0, attempts: 10, activeRev: "A", rev: null, keepReady: keepReady, staleDeadline: staleDeadline === undefined ? null : staleDeadline };
        }

        describe("readiness(info, now) - a pure function", function() {
            it("ready without a condition - ok", function() {
                health.readiness({ ready: true }, 0).should.eql(OK);
            });
            it("ready, condition keepReady false - ok (the default mode, also past a deadline)", function() {
                health.readiness({ ready: true, reload: cond(false) }, 0).should.eql(OK);
                health.readiness({ ready: true, reload: cond(false, 10) }, 100).should.eql(OK);
            });
            it("ready, keepReady, no deadline - warn", function() {
                health.readiness({ ready: true, reload: cond(true, null) }, 1e15).should.eql(WARN);
            });
            it("ready, keepReady, before the deadline - warn", function() {
                health.readiness({ ready: true, reload: cond(true, 1000) }, 999).should.eql(WARN);
            });
            it("ready, keepReady, at and after the deadline - 503", function() {
                health.readiness({ ready: true, reload: cond(true, 1000) }, 1000).should.eql(UNAVAILABLE);
                health.readiness({ ready: true, reload: cond(true, 1000) }, 5000).should.eql(UNAVAILABLE);
            });
            it("not ready - 503, whatever the condition", function() {
                health.readiness({ ready: false }, 0).should.eql(UNAVAILABLE);
                health.readiness({ ready: false, reload: cond(true) }, 0).should.eql(UNAVAILABLE);
                health.readiness({ ready: false, reload: cond(false) }, 0).should.eql(UNAVAILABLE);
            });
            it("the bodies are constant: no revision, no error text", function() {
                const result = health.readiness({ ready: true, reload: Object.assign(cond(true), { activeRev: "secret-rev", rev: "other", error: { code: "storage_error", message: "secret message" } }) }, 0);
                result.body.should.not.match(/secret/);
            });
        });

        describe("handler", function() {
            it("ready + condition keepReady - 200 warn with a constant body, /live 200", async function() {
                drive.ready();
                state.markReloadFailed({ error: "storage_error", attempts: 10, activeRev: "secret-rev", keepReady: true });
                const res = await request(app).get("/health/ready");
                res.status.should.equal(200);
                res.text.should.equal('{"status":"warn","reason":"reload_failed"}');
                res.headers["content-type"].should.match(/^application\/json/);
                res.headers["cache-control"].should.equal("no-store");
                (await request(app).get("/health/live")).text.should.equal('{"status":"ok"}');
            });
            it("HEAD gives the status and headers of warn without a body", async function() {
                drive.ready();
                state.markReloadFailed({ error: "storage_error", keepReady: true });
                const res = await request(app).head("/health/ready");
                res.status.should.equal(200);
                res.headers["content-type"].should.match(/^application\/json/);
                res.headers["cache-control"].should.equal("no-store");
                should(res.text).be.undefined();
            });
            it("ready + condition keepReady false - ok, as without the condition (default mode)", async function() {
                drive.ready();
                state.markReloadFailed({ error: "storage_error", keepReady: false });
                const res = await request(app).get("/health/ready");
                res.status.should.equal(200);
                res.text.should.equal('{"status":"ok"}');
            });
            it("editor-only (loaded) + condition keepReady false - ok", async function() {
                drive.loaded();
                state.markReloadFailed({ error: "storage_error", keepReady: false });
                const res = await request(app).get("/health/ready");
                res.status.should.equal(200);
                res.text.should.equal('{"status":"ok"}');
            });
            it("the condition cleared - ok again", async function() {
                drive.ready();
                state.markReloadFailed({ error: "storage_error", keepReady: true });
                state.clearReloadFailed();
                const res = await request(app).get("/health/ready");
                res.text.should.equal('{"status":"ok"}');
            });
            it("keepReady past staleDeadline - 503", async function() {
                drive.ready();
                state.markReloadFailed({ error: "storage_error", keepReady: true, staleDeadline: Date.now() - 1 });
                const res = await request(app).get("/health/ready");
                res.status.should.equal(503);
                res.text.should.equal('{"status":"unavailable"}');
                (await request(app).get("/health/live")).status.should.equal(200);
            });
            it("keepReady before staleDeadline - warn, then 503 when the time passes (no I/O, evaluated per request)", async function() {
                const clock = sinon.useFakeTimers({ toFake: ["Date"] });
                try {
                    drive.ready();
                    state.markReloadFailed({ error: "storage_error", keepReady: true, staleDeadline: 1000 });
                    health.readiness({ ready: state.isReady(), reload: state.get().reload }, Date.now()).status.should.equal(200);
                    clock.tick(1000);
                    health.readiness({ ready: state.isReady(), reload: state.get().reload }, Date.now()).status.should.equal(503);
                } finally {
                    clock.restore();
                }
            });
            ["idle", "failed", "draining", "reloading", "deploying", "starting"].forEach(function(name) {
                it("a condition keepReady does not make " + name + " ready - 503", async function() {
                    drive[name]();
                    state.markReloadFailed({ error: "storage_error", keepReady: true });
                    const res = await request(app).get("/health/ready");
                    res.status.should.equal(503);
                    res.text.should.equal('{"status":"unavailable"}');
                });
            });
            it("reloadPending before draining + condition keepReady - warn", async function() {
                drive.reloadPending();
                state.markReloadFailed({ error: "storage_error", keepReady: true });
                const res = await request(app).get("/health/ready");
                res.status.should.equal(200);
                res.text.should.equal('{"status":"warn","reason":"reload_failed"}');
            });
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
