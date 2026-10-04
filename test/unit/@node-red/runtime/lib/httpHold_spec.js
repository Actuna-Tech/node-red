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
 *   #8: tests of the hold of the requests to the routes of the nodes while the
 *   flows restart (deploy.holdHttpNodeRequests)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const http = require("http");
const express = require("express");
const NR_TEST_UTILS = require("nr-test-utils");
const httpHold = NR_TEST_UTILS.require("@node-red/runtime/lib/httpHold");
const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
const pipeline = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/pipeline");
const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");
const { log } = NR_TEST_UTILS.require("@node-red/util");

describe("runtime/httpHold (#8)", function() {
    let app;
    let server;
    let port;
    // What the "nodes" of the fake flows answer: the routes are added and removed
    // like the http in node does (RED.httpNode + _router.stack)
    let routes;

    function addRoute(path, body) {
        app.get(path, function(req, res) { res.status(200).send(body) });
        routes[path] = body;
    }
    function removeRoute(path) {
        app._router.stack.forEach(function(layer, i, stack) {
            if (layer.route && layer.route.path === path) {
                stack.splice(i, 1);
            }
        });
        delete routes[path];
    }

    function get(path, opts) {
        opts = opts || {};
        return new Promise(function(resolve, reject) {
            const req = http.request({ host: "127.0.0.1", port: port, path: path, method: opts.method || "GET", agent: false }, function(res) {
                let text = "";
                res.on("data", d => text += d);
                res.on("end", () => resolve({ status: res.statusCode, text: text, headers: res.headers }));
            });
            req.on("error", reject);
            req.end();
        });
    }
    // The request is sent and has reached the server
    async function getHeld(path) {
        const before = httpHold.pending();
        const promise = get(path);
        for (let i = 0; i < 100 && httpHold.pending() === before; i++) {
            await new Promise(r => setTimeout(r, 5));
        }
        return promise;
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

    async function setup(holdSettings, withHold) {
        if (server) {
            // a second setup in one test: the previous server is closed first
            httpHold.dispose();
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
            server = null;
        }
        instanceState.reset();
        instanceState.markStarting();
        instanceState.report({ errors: [] });
        httpHold.init(holdSettings === undefined ? {} : { deploy: { holdHttpNodeRequests: holdSettings } });
        app = express();
        routes = {};
        if (withHold !== false && httpHold.isEnabled()) {
            app.use(httpHold.middleware);
        }
        // a stand-in of an admin app: not behind the middleware
        return new Promise(resolve => {
            server = http.createServer(app).listen(0, "127.0.0.1", function() {
                port = server.address().port;
                resolve();
            });
        });
    }

    beforeEach(function() {
        sinon.stub(log, "warn");
        sinon.stub(log, "_").callsFake((key, v) => key + (v ? " " + JSON.stringify(v) : ""));
    });
    afterEach(function(done) {
        httpHold.dispose();
        instanceState.reset();
        sinon.restore();
        if (server) {
            server.closeAllConnections && server.closeAllConnections();
            server.close(function() { done() });
            server = null;
        } else {
            done();
        }
    });

    describe("setting off (default)", function() {
        it("is disabled without the setting and the middleware passes the request on", async function() {
            await setup(undefined);
            httpHold.isEnabled().should.be.false();
            const next = sinon.spy();
            httpHold.middleware({}, {}, next);
            next.calledOnce.should.be.true();
        });
        it("is disabled with enabled: false or without enabled", async function() {
            await setup({ enabled: false });
            httpHold.isEnabled().should.be.false();
            await setup({ timeout: 100 });
            httpHold.isEnabled().should.be.false();
        });
        it("a request in the restart window gets 404 as before (route absent)", async function() {
            await setup(undefined);
            addRoute("/hello", "old");
            instanceState.begin("deploy");
            removeRoute("/hello");
            const res = await get("/hello");
            res.status.should.equal(404);
            httpHold.pending().should.equal(0);
        });
        it("a setting that is not an object disables the hold with a warning", async function() {
            await setup(true);
            httpHold.isEnabled().should.be.false();
            log.warn.calledOnce.should.be.true();
            log.warn.firstCall.args[0].should.match(/httpHold.invalid-setting/);
        });
    });

    describe("setting on", function() {
        it("passes requests on when no restart runs (ready, reloadPending, failed, idle)", async function() {
            await setup({ enabled: true, timeout: 200 });
            addRoute("/hello", "v1");
            (await get("/hello")).text.should.equal("v1");
            instanceState.markReloadPending();
            instanceState.markDraining();
            (await get("/hello")).text.should.equal("v1");
            httpHold.pending().should.equal(0);
        });

        it("holds a request during a deployment and answers it with the new flow", async function() {
            await setup({ enabled: true, timeout: 5000 });
            addRoute("/hello", "v1");
            const token = instanceState.begin("deploy");
            removeRoute("/hello");
            const pendingRes = getHeld("/hello");
            await waitHeld(1);
            // the new flows start
            addRoute("/hello", "v2");
            instanceState.end(token, { errors: [] });
            const res = await pendingRes;
            res.status.should.equal(200);
            res.text.should.equal("v2");
            httpHold.pending().should.equal(0);
        });

        it("holds a request during a reload from storage", async function() {
            await setup({ enabled: true, timeout: 5000 });
            addRoute("/hello", "v1");
            instanceState.markReloadPending();
            instanceState.markDraining();
            const token = instanceState.begin("reload");
            removeRoute("/hello");
            const pendingRes = getHeld("/hello");
            await waitHeld(1);
            addRoute("/hello", "v2");
            instanceState.end(token, { errors: [] });
            const res = await pendingRes;
            res.status.should.equal(200);
            res.text.should.equal("v2");
        });

        it("a request that arrives during the drain of a reload is not held", async function() {
            await setup({ enabled: true, timeout: 5000 });
            addRoute("/hello", "v1");
            instanceState.markReloadPending();
            instanceState.markDraining();
            const res = await get("/hello");
            res.text.should.equal("v1");
            httpHold.pending().should.equal(0);
        });

        it("a request that is already processed is not affected", async function() {
            await setup({ enabled: true, timeout: 5000 });
            let finish;
            app.get("/slow", function(req, res) { finish = function() { res.send("slow done") } });
            const slow = get("/slow");
            await new Promise(r => setTimeout(r, 30));
            const token = instanceState.begin("deploy");
            finish();
            (await slow).text.should.equal("slow done");
            httpHold.pending().should.equal(0);
            instanceState.end(token, { errors: [] });
        });

        it("releases all held requests in the order of arrival", async function() {
            await setup({ enabled: true, timeout: 5000 });
            const order = [];
            const token = instanceState.begin("deploy");
            const all = [1, 2, 3].map(i => get("/n" + i).then(res => order.push(res.text)));
            await waitHeld(3);
            [1, 2, 3].forEach(i => app.get("/n" + i, (req, res) => res.send("r" + i)));
            instanceState.end(token, { errors: [] });
            await Promise.all(all);
            order.sort().should.eql(["r1", "r2", "r3"]);
        });

        it("answers 503 with Retry-After and a JSON body after the timeout, never 404", async function() {
            await setup({ enabled: true, timeout: 80, retryAfter: 3 });
            addRoute("/hello", "v1");
            instanceState.begin("deploy");
            removeRoute("/hello");
            const started = Date.now();
            const res = await getHeld("/hello");
            (Date.now() - started).should.be.aboveOrEqual(70);
            res.status.should.equal(503);
            res.headers["retry-after"].should.equal("3");
            res.headers["cache-control"].should.equal("no-store");
            res.headers["content-type"].should.match(/application\/json/);
            JSON.parse(res.text).code.should.equal("http_hold_timeout");
            httpHold.pending().should.equal(0);
        });

        it("the default Retry-After is 1 second", async function() {
            await setup({ enabled: true, timeout: 30 });
            instanceState.begin("deploy");
            const res = await getHeld("/x");
            res.status.should.equal(503);
            res.headers["retry-after"].should.equal("1");
        });

        it("a HEAD request after the timeout gets 503 without a body", async function() {
            await setup({ enabled: true, timeout: 30 });
            instanceState.begin("deploy");
            const res = await get("/x", { method: "HEAD" });
            res.status.should.equal(503);
            res.text.should.equal("");
        });

        it("answers 503 at once when maxPending requests are held", async function() {
            await setup({ enabled: true, timeout: 5000, maxPending: 2 });
            const token = instanceState.begin("deploy");
            const first = [get("/a"), get("/b")];
            await waitHeld(2);
            const started = Date.now();
            const res = await get("/c");
            (Date.now() - started).should.be.below(1000);
            res.status.should.equal(503);
            res.headers["retry-after"].should.equal("1");
            JSON.parse(res.text).code.should.equal("http_hold_queue_full");
            httpHold.pending().should.equal(2);
            // the held ones are still answered once the flows started
            app.get("/a", (req, res) => res.send("A"));
            app.get("/b", (req, res) => res.send("B"));
            instanceState.end(token, { errors: [] });
            (await Promise.all(first)).map(r => r.text).should.eql(["A", "B"]);
        });

        it("a failed start releases the held requests to the normal routing", async function() {
            await setup({ enabled: true, timeout: 5000 });
            const token = instanceState.begin("deploy");
            const pendingRes = getHeld("/hello");
            await waitHeld(1);
            instanceState.end(token, { errors: [{ code: "missing_types", message: "m" }] });
            instanceState.get().state.should.equal("failed");
            const res = await pendingRes;
            res.status.should.equal(404);
            httpHold.pending().should.equal(0);
        });

        it("flows stopped by the deployment (idle) release the held requests", async function() {
            await setup({ enabled: true, timeout: 5000 });
            const token = instanceState.begin("deploy");
            const pendingRes = getHeld("/hello");
            await waitHeld(1);
            instanceState.end(token, { flowsRunning: false });
            (await pendingRes).status.should.equal(404);
        });

        it("the stop of the runtime releases the held requests", async function() {
            await setup({ enabled: true, timeout: 5000 });
            instanceState.begin("deploy");
            const pendingRes = getHeld("/hello");
            await waitHeld(1);
            instanceState.markStopping("SIGTERM");
            (await pendingRes).status.should.equal(404);
        });

        it("a client that gives up frees its place", async function() {
            await setup({ enabled: true, timeout: 5000, maxPending: 1 });
            instanceState.begin("deploy");
            const req = http.request({ host: "127.0.0.1", port: port, path: "/gone", agent: false });
            req.on("error", () => {});
            req.end();
            await waitHeld(1);
            req.destroy();
            for (let i = 0; i < 100 && httpHold.pending() > 0; i++) {
                await new Promise(r => setTimeout(r, 5));
            }
            httpHold.pending().should.equal(0);
        });

        it("does not hold the routes that are not behind the middleware (admin API, editor)", async function() {
            await setup({ enabled: true, timeout: 5000 });
            // like red.js: the admin app is a separate app, the node app is mounted at httpNodeRoot
            const root = express();
            const adminApp = express();
            adminApp.get("/flows", (req, res) => res.send("admin"));
            const nodeApp = express();
            nodeApp.use(httpHold.middleware);
            root.use("/", adminApp);
            root.use("/api", nodeApp);
            const rootServer = http.createServer(root).listen(0, "127.0.0.1");
            await new Promise(r => rootServer.on("listening", r));
            const rootPort = rootServer.address().port;
            instanceState.begin("deploy");
            const fetch = path => new Promise((resolve, reject) => {
                http.get({ host: "127.0.0.1", port: rootPort, path: path, agent: false }, res => {
                    let text = "";
                    res.on("data", d => text += d);
                    res.on("end", () => resolve({ status: res.statusCode, text: text }));
                }).on("error", reject);
            });
            try {
                const admin = await fetch("/flows");
                admin.text.should.equal("admin");
                httpHold.pending().should.equal(0);
                const held = fetch("/api/hello");
                await waitHeld(1);
                instanceState.markStopping("stop");
                (await held).status.should.equal(404);
            } finally {
                await new Promise(r => rootServer.close(r));
            }
        });

        it("init again releases the held requests and starts from the new settings", async function() {
            await setup({ enabled: true, timeout: 5000 });
            instanceState.begin("deploy");
            const pendingRes = getHeld("/hello");
            await waitHeld(1);
            httpHold.init({});
            (await pendingRes).status.should.equal(404);
            httpHold.isEnabled().should.be.false();
        });
    });

    describe("settings validation", function() {
        it("uses the defaults and warns for invalid options", async function() {
            await setup({ enabled: true, timeout: -5, maxPending: 1.5, retryAfter: "x" });
            log.warn.callCount.should.equal(3);
            // maxPending default 1000, timeout default 5000: not rejected at once
            instanceState.begin("deploy");
            const pendingRes = getHeld("/hello");
            await waitHeld(1);
            httpHold.pending().should.equal(1);
            instanceState.markStopping("stop");
            await pendingRes;
        });
    });

    describe("robustness", function() {
        it("a timeout above the limit of setTimeout is invalid: warning and the default, no immediate 503", async function() {
            await setup({ enabled: true, timeout: 3e9 });
            log.warn.calledOnce.should.be.true();
            log.warn.firstCall.args[0].should.match(/httpHold.invalid-option.*timeout/);
            instanceState.begin("deploy");
            const pendingRes = getHeld("/hello");
            await waitHeld(1);
            await new Promise(r => setTimeout(r, 100));
            httpHold.pending().should.equal(1);
            instanceState.markStopping("stop");
            await pendingRes;
        });
        it("the largest allowed timeout is accepted", async function() {
            await setup({ enabled: true, timeout: 2147483647 });
            log.warn.called.should.be.false();
        });
        it("a next() that throws does not drop the other held requests", async function() {
            await setup({ enabled: true, timeout: 5000 });
            instanceState.begin("deploy");
            const fakeRes = () => ({ headersSent: false, statusCode: 0, headers: {}, on() {}, removeListener() {},
                setHeader(k, v) { this.headers[k] = v }, end() { this.ended = true } });
            const res1 = fakeRes();
            const res2 = fakeRes();
            const next1 = sinon.stub().throws(new Error("boom"));
            const next2 = sinon.spy();
            httpHold.middleware({ method: "GET" }, res1, next1);
            httpHold.middleware({ method: "GET" }, res2, next2);
            httpHold.pending().should.equal(2);
            instanceState.markStopping("stop");
            next1.calledOnce.should.be.true();
            next2.calledOnce.should.be.true();
            res1.statusCode.should.equal(503);
            res1.ended.should.be.true();
            log.warn.calledOnce.should.be.true();
            log.warn.firstCall.args[0].should.match(/httpHold.release-failed/);
            httpHold.pending().should.equal(0);
        });
    });

    describe("with the deploy pipeline and the reload from storage", function() {
        let flows;
        let startFlows;
        beforeEach(async function() {
            await setup({ enabled: true, timeout: 5000 });
            addRoute("/hello", "v1");
            // flows like flows/index.js: the old nodes stop (their routes are removed),
            // the new nodes start later and the start is registered with lock.holdUntil()
            startFlows = function(newBody, result) {
                return new Promise(function(resolve) {
                    setTimeout(function() {
                        addRoute("/hello", newBody);
                        resolve(result || { errors: [] });
                    }, 60);
                });
            };
            flows = {
                getFlows: () => ({ rev: "r1", flows: [] }),
                setFlows: sinon.spy(async function() {
                    removeRoute("/hello");
                    lock.holdUntil(startFlows("v2"));
                    return "r2";
                }),
                reloadFromStorage: sinon.spy(async function(loaded) {
                    removeRoute("/hello");
                    lock.holdUntil(startFlows("v3"));
                    return loaded.rev;
                })
            };
            pipeline.init({ flows: flows });
        });

        it("a request in the window of a deployment waits and gets the new flow", async function() {
            const deployed = pipeline.deploy({ flows: { flows: [1] } });
            await deployed;
            // the old route is gone, the new nodes have not started yet
            routes.should.not.have.property("/hello");
            const res = await getHeld("/hello");
            res.status.should.equal(200);
            res.text.should.equal("v2");
        });

        it("a request in the window of a reload from storage waits and gets the new flow", async function() {
            instanceState.markReloadPending();
            instanceState.markDraining();
            const reloaded = pipeline.deploy({ type: "reload", source: "storage", reread: async () => ({ apply: { flows: [], rev: "r3" }, reloadType: "full" }) });
            await reloaded;
            routes.should.not.have.property("/hello");
            const res = await getHeld("/hello");
            res.status.should.equal(200);
            res.text.should.equal("v3");
        });

        it("the same window gives 404 when the setting is off", async function() {
            await setup(undefined);
            addRoute("/hello", "v1");
            pipeline.init({ flows: flows });
            await pipeline.deploy({ flows: { flows: [1] } });
            routes.should.not.have.property("/hello");
            (await get("/hello")).status.should.equal(404);
            // let the start finish before the next test
            await lock.runExclusive(async function() {});
        });

        it("a failed start of the new flows releases the request to the routing", async function() {
            flows.setFlows = async function() {
                removeRoute("/hello");
                lock.holdUntil(new Promise(r => setTimeout(() => r({ errors: [{ code: "missing_types", message: "m" }] }), 60)));
                return "r2";
            };
            await pipeline.deploy({ flows: { flows: [1] } });
            const res = await getHeld("/hello");
            res.status.should.equal(404);
            instanceState.get().state.should.equal("failed");
        });
    });
});
