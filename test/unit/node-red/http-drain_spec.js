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
 *   #40: acceptance test of deploy.drainHttpNodeRequests - a request that "http in" accepted gets an
 *   answer, whatever stops the flows (deployments of every type, a reload from storage, a stop
 *   of the flows), with the setting off, on with a long limit and on with a short one
 *   #63: every describe stops its own instance in its `after`; the slow-body test asserts that the client socket is
 *   closed after the 503 with `Connection: close`
 *   #82: the debug record of a drain 503 names the node of the route; a stop signal waits for the requests in progress
 *   inside shutdownTimeout; long-lived connections (http in with drainMode long) are not waited for and are closed when the
 *   node stops
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * Runs Node-RED in a child process (temporary user directory, Admin API, no editor) with a flow
 * `http in -> delay 600 ms -> http response` and, while one request is in the delay node,
 * stops the flows with each operation of issue #40. The process is a child, not the process
 * of the test: the runtime keeps singletons (instance state, flows, health) that would leak
 * into the other specs.
 *
 *  - setting off: the results of the issue (the request is lost when the node that holds the
 *    message stops: no answer; 200 when only another node changes);
 *  - on, `timeout` 5000: the flow answers, 200, in every scenario;
 *  - on, `timeout` 200: 503 `http_drain_outcome_unknown` in every scenario (a hard limit, also
 *    for the flows that the deployment does not change).
 */
const should = require("should");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

const RED_JS = path.resolve(__dirname, "../../../packages/node_modules/node-red/red.js");
const V2 = { "Node-RED-API-Version": "v2" };
const DELAY = 900;

function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = http.createServer();
        srv.listen(0, "127.0.0.1", () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
        srv.on("error", reject);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// The request of the Admin API (JSON)
function api(url, method, path, body, headers) {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? "" : JSON.stringify(body);
        const req = http.request(url + path, {
            method,
            agent: false,
            headers: Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "Connection": "close" }, V2, headers || {})
        }, res => {
            let text = "";
            res.on("data", d => text += d);
            res.on("end", () => {
                let json;
                try { json = text ? JSON.parse(text) : undefined } catch (err) { json = undefined }
                resolve({ status: res.statusCode, body: json, text });
            });
        });
        req.on("error", reject);
        req.end(data);
    });
}

/**
 * A request of a client of the node. Resolves with `{status, headers, body, ms}` when the answer
 * arrives, `{hang: true}` when there is none within `waitMs`, `{error}` when the connection fails.
 * `cancel()` destroys the request.
 */
function send(url, path, options) {
    options = options || {};
    const started = Date.now();
    let req;
    const done = new Promise(resolve => {
        const timer = setTimeout(() => { resolve({ hang: true, ms: Date.now() - started }); req.destroy() }, options.waitMs || 4000);
        req = http.request(url + path, { method: options.method || "GET", agent: false, headers: Object.assign({ "Connection": "close" }, options.headers || {}) }, res => {
            const chunks = [];
            res.on("data", d => chunks.push(d));
            res.on("end", () => {
                clearTimeout(timer);
                const text = Buffer.concat(chunks).toString();
                let json;
                try { json = text ? JSON.parse(text) : undefined } catch (err) { json = undefined }
                resolve({ status: res.statusCode, headers: res.headers, body: json, text, ms: Date.now() - started });
            });
        });
        req.on("error", err => { clearTimeout(timer); resolve({ error: err.message, ms: Date.now() - started }) });
        if (options.write) {
            req.write(options.write);
        } else {
            req.end(options.body);
        }
    });
    return { done, req, cancel: () => req.destroy() };
}

// The flows of the tests. `v` changes one part: `url` (http in), `holder` (the node that holds the message),
// `other` (an unrelated node)
function flows(v, port) {
    v = v || {};
    return [
        { id: "t", type: "tab", label: "t" },
        { id: "i", type: "http in", z: "t", url: "/slow" + (v.url || ""), method: "get", wires: [["h"]] },
        { id: "h", type: "delay", z: "t", name: "hold" + (v.holder || ""), pauseType: "delay", timeout: String(DELAY), timeoutUnits: "milliseconds", rate: "1", nbRateUnits: "1", rateUnits: "second", randomFirst: "1", randomLast: "5", randomUnits: "seconds", drop: false, outputs: 1, allowrate: false, wires: [["o"]] },
        { id: "o", type: "http response", z: "t", statusCode: "200", wires: [] },
        { id: "x", type: "inject", z: "t", name: "other" + (v.other || ""), props: [], repeat: "", once: false, wires: [[]] },
        // an answer at once
        { id: "fi", type: "http in", z: "t", url: "/fast", method: "get", wires: [["fo"]] },
        { id: "fo", type: "http response", z: "t", statusCode: "200", wires: [] },
        // a POST that is processed slowly
        { id: "pi", type: "http in", z: "t", url: "/slowpost", method: "post", wires: [["ph"]] },
        { id: "ph", type: "delay", z: "t", name: "post hold", pauseType: "delay", timeout: String(DELAY), timeoutUnits: "milliseconds", rate: "1", nbRateUnits: "1", rateUnits: "second", randomFirst: "1", randomLast: "5", randomUnits: "seconds", drop: false, outputs: 1, allowrate: false, wires: [["po"]] },
        { id: "po", type: "http response", z: "t", statusCode: "200", wires: [] },
        // a request of the flow to the node itself
        { id: "si", type: "http in", z: "t", url: "/self", method: "get", wires: [["sh"]] },
        { id: "sh", type: "delay", z: "t", name: "self hold", pauseType: "delay", timeout: String(DELAY), timeoutUnits: "milliseconds", rate: "1", nbRateUnits: "1", rateUnits: "second", randomFirst: "1", randomLast: "5", randomUnits: "seconds", drop: false, outputs: 1, allowrate: false, wires: [["sr"]] },
        { id: "sr", type: "http request", z: "t", method: "GET", ret: "txt", paytoqs: "ignore", url: "http://127.0.0.1:" + port + "/fast", tls: "", persist: false, proxy: "", insecureHTTPParser: false, authType: "", senderr: false, headers: [], wires: [["so"]] },
        { id: "so", type: "http response", z: "t", statusCode: "200", wires: [] },
        // the message is kept in the global context and answered later by another request (the late response)
        { id: "ti", type: "http in", z: "t", url: "/stash", method: "get", wires: [["tf"]] },
        { id: "tf", type: "function", z: "t", name: "stash", func: "global.set('stash', (global.get('stash')||[]).concat([msg])); return null;", outputs: 1, wires: [[]] },
        { id: "li", type: "http in", z: "t", url: "/late", method: "get", wires: [["lf"]] },
        { id: "lf", type: "function", z: "t", name: "late", func: "const s = global.get('stash')||[]; const old = s.shift(); global.set('stash', s); if (old) { old.payload = 'late'; node.send([old, msg]); } else { node.send([null, msg]); } return null;", outputs: 2, wires: [["lo"], ["lo2"]] },
        { id: "lo", type: "http response", z: "t", statusCode: "200", wires: [] },
        { id: "lo2", type: "http response", z: "t", statusCode: "200", wires: [] }
    ];
}

// What the operation does to the running flows
const OPERATIONS = {
    "full": inst => deploy(inst, "full", { other: "1" }),
    "flows-httpin": inst => deploy(inst, "flows", { url: "2" }),
    "flows-holder": inst => deploy(inst, "flows", { holder: "2" }),
    "flows-other": inst => deploy(inst, "flows", { other: "2" }),
    "nodes-httpin": inst => deploy(inst, "nodes", { url: "2" }),
    "nodes-holder": inst => deploy(inst, "nodes", { holder: "2" }),
    "nodes-other": inst => deploy(inst, "nodes", { other: "2" }),
    "reload": inst => api(inst.url, "POST", "/flows", undefined, { "Node-RED-Deployment-Type": "reload" }),
    "stop": inst => api(inst.url, "POST", "/flows/state", { state: "stop" })
};

function deploy(inst, type, variant) {
    return api(inst.url, "POST", "/flows", { flows: flows(variant, inst.port) }, { "Node-RED-Deployment-Type": type });
}

// With the setting off: the flows that lose the message (no answer) and the ones that do not (200)
const OFF_RESULTS = {
    "full": "hang",
    "flows-httpin": "hang",
    "flows-holder": "hang",
    "flows-other": 200,
    "nodes-httpin": 200,
    "nodes-holder": "hang",
    "nodes-other": 200,
    "reload": "hang",
    "stop": "hang"
};

describe("drain of the HTTP requests (acceptance, #40)", function() {
    this.timeout(180000);
    const children = [];
    const dirs = [];

    after(function() {
        children.forEach(c => { if (c.exitCode === null && c.signalCode === null) { c.kill("SIGKILL") } });
        dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
    });

    async function waitForServer(url) {
        const started = Date.now();
        for (;;) {
            try {
                if ((await api(url, "GET", "/flows")).status === 200 && (await send(url, "/fast").done).status === 200) {
                    return;
                }
            } catch (err) {
                // not listening yet
            }
            if (Date.now() - started > 40000) {
                throw new Error("Node-RED did not start");
            }
            await sleep(200);
        }
    }

    // The instance of Node-RED; `drain` is the setting deploy.drainHttpNodeRequests (undefined: off)
    // `extra`: `shutdownTimeout` (the setting), `delay` (ms of the delay node of /slow) and `flows` (a function of
    // the port that gives the flows to start with) (#82)
    async function startInstance(drain, extra) {
        extra = extra || {};
        const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-drain-"));
        dirs.push(userDir);
        const port = await getFreePort();
        const deployment = {};
        if (drain) {
            deployment.drainHttpNodeRequests = Object.assign({ enabled: true }, drain);
        }
        const startFlows = extra.flows ? extra.flows(port) : flows({}, port);
        if (extra.delay) {
            startFlows.find(n => n.id === "h").timeout = String(extra.delay);
        }
        fs.writeFileSync(path.join(userDir, "flows.json"), JSON.stringify(startFlows));
        const settingsObject = {
            flowFile: "flows.json",
            disableEditor: true,
            runtimeState: { enabled: true, ui: false },
            logging: { console: { level: "debug" } },
            deploy: deployment
        };
        if (extra.shutdownTimeout !== undefined) {
            settingsObject.shutdownTimeout = extra.shutdownTimeout;
        }
        fs.writeFileSync(path.join(userDir, "settings.js"), "module.exports = " + JSON.stringify(settingsObject));
        const child = spawn(process.execPath, [RED_JS, "-u", userDir, "-p", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
        children.push(child);
        const output = [];
        child.stdout.on("data", d => output.push(d.toString()));
        child.stderr.on("data", d => output.push(d.toString()));
        const inst = { url: "http://127.0.0.1:" + port, port, child, output: () => output.join("") };
        await waitForServer(inst.url);
        return inst;
    }

    // Stops an instance at the end of its describe (a child that is still running is killed, SIGKILL), so no
    // instance lives on until the last describe has ended; the final sweep stays for a failed `before`
    async function stopInstance(inst) {
        if (!inst || !inst.child) {
            return;
        }
        const child = inst.child;
        if (child.exitCode === null && child.signalCode === null) {
            const exited = new Promise(resolve => child.once("exit", resolve));
            child.kill("SIGKILL");
            await Promise.race([exited, sleep(5000)]);
        }
    }

    // The base flows, running
    async function reset(inst) {
        const state = await api(inst.url, "POST", "/flows/state", { state: "start" });
        state.status.should.equal(200);
        const result = await deploy(inst, "full", {});
        result.status.should.equal(200);
        const started = Date.now();
        while (Date.now() - started < 10000) {
            const [fast, slow] = await Promise.all([send(inst.url, "/fast").done, send(inst.url, "/slow", { waitMs: 3000 }).done]);
            if (fast.status === 200 && slow.status === 200) {
                return;
            }
            await sleep(100);
        }
        throw new Error("the base flows did not start");
    }

    // The request in the delay node, the operation 150 ms later; resolves with what the client saw
    async function scenario(inst, name, options) {
        options = options || {};
        await reset(inst);
        const client = send(inst.url, options.path || "/slow", { method: options.method, waitMs: options.waitMs || DELAY + 1200 });
        await sleep(150);
        const started = Date.now();
        let opMs = null;
        const operation = OPERATIONS[name](inst).then(res => res, err => ({ error: err.message })).then(res => { opMs = Date.now() - started; return res });
        const during = options.during ? options.during(inst, client) : null;
        const result = await client.done;
        const op = await operation;
        result.opMs = opMs;
        result.op = op;
        result.during = during ? await during : undefined;
        return result;
    }

    describe("the setting off", function() {
        let inst;
        before(async function() { inst = await startInstance(undefined) });
        after(function() { return stopInstance(inst) });

        Object.keys(OFF_RESULTS).forEach(function(name) {
            it(name + ": " + (OFF_RESULTS[name] === "hang" ? "the request is lost (no answer), as before" : "the flow answers 200, as before"), async function() {
                const result = await scenario(inst, name, { waitMs: DELAY + 1100 });
                if (OFF_RESULTS[name] === "hang") {
                    should(result.hang).be.true();
                } else {
                    result.status.should.equal(OFF_RESULTS[name]);
                }
            });
        });
        it("a stop of the flows does not wait: the request of the operation takes no longer than before", async function() {
            const result = await scenario(inst, "full", { waitMs: DELAY + 400 });
            result.op.status.should.equal(200);
            result.opMs.should.be.below(DELAY);
        });
    });

    describe("on, timeout 5000", function() {
        let inst;
        before(async function() { inst = await startInstance({ timeout: 5000 }) });
        after(function() { return stopInstance(inst) });

        Object.keys(OPERATIONS).forEach(function(name) {
            it(name + ": the flow answers the request in progress, 200", async function() {
                const result = await scenario(inst, name, { waitMs: 4000 });
                result.status.should.equal(200);
                // the answer of the flow, not of the limit
                result.ms.should.be.below(DELAY + 1500);
                result.op.status.should.be.oneOf([200, 204]);
            });
        });
        it("the deployment waits for the request: POST /flows answers after the answer of the flow", async function() {
            const result = await scenario(inst, "full", { waitMs: 4000 });
            result.status.should.equal(200);
            result.opMs.should.be.above(DELAY - 250 - 150);
        });
        it("a new fast request during the drain is served by the old flows, 200", async function() {
            const result = await scenario(inst, "full", {
                waitMs: 4000,
                during: async function(i) {
                    await sleep(100);
                    return send(i.url, "/fast").done;
                }
            });
            result.status.should.equal(200);
            result.during.status.should.equal(200);
        });
        it("a new slow request during a full stop gets 503 http_drain_outcome_unknown with Retry-After (GET)", async function() {
            const result = await scenario(inst, "full", {
                waitMs: 4000,
                during: async function(i) {
                    await sleep(250);
                    return send(i.url, "/slow", { waitMs: 4000 }).done;
                }
            });
            // the request of S0 is answered by the flow
            result.status.should.equal(200);
            // the new one was in the delay node when the nodes stopped
            result.during.status.should.equal(503);
            result.during.body.code.should.equal("http_drain_outcome_unknown");
            result.during.headers["retry-after"].should.equal("1");
        });
        it("the request of the flow to the same node ends without waiting for the limit", async function() {
            const result = await scenario(inst, "full", { path: "/self", waitMs: 4000 });
            result.status.should.equal(200);
            result.opMs.should.be.below(DELAY + 1500);
        });
        it("a request that is slow to send its body does not extend the drain; it gets 503 http_drain_not_accepted, Connection: close and Retry-After", async function() {
            await reset(inst);
            // the headers announce 1000 bytes, 10 arrive: the body parser of the route waits (text: the Admin API,
            // mounted on the same root, would read a JSON body before the route is matched)
            const slow = send(inst.url, "/slowpost", { method: "POST", write: "0123456789", headers: { "Content-Type": "text/plain", "Content-Length": "1000" }, waitMs: 4000 });
            // the client socket: it must be closed by the server after the 503 (Connection: close)
            const socketClosed = new Promise(resolve => slow.req.on("socket", socket => {
                if (socket.destroyed) { resolve(); } else { socket.once("close", resolve); }
            }));
            await sleep(150);
            const started = Date.now();
            const op = await deploy(inst, "full", { other: "3" });
            op.status.should.equal(200);
            // nothing was accepted, so nothing is waited for
            (Date.now() - started).should.be.below(DELAY);
            const result = await slow.done;
            result.status.should.equal(503);
            result.body.code.should.equal("http_drain_not_accepted");
            result.headers["retry-after"].should.equal("1");
            result.headers.connection.should.equal("close");
            // asserted, not tolerated: the connection is closed within 1000 ms after the answer
            const closedInTime = await Promise.race([socketClosed.then(() => true), sleep(1000).then(() => false)]);
            closedInTime.should.equal(true, "the client socket was not closed within 1000 ms after the 503");
            // the server closes the connection after the 503 while the client keeps sending the body: no crash, no error
            try { slow.req.write("0123456789", () => {}) } catch (err) { /* the socket is already closed */ }
            await sleep(200);
            slow.cancel();
            (await send(inst.url, "/fast").done).status.should.equal(200);
            inst.output().should.not.match(/uncaught|TypeError|ERR_HTTP_HEADERS_SENT|Cannot set headers/i);
        });
        it("a request that the flow keeps and answers after a full stop gets 503, the late response is dropped without an error", async function() {
            await reset(inst);
            const stashed = send(inst.url, "/stash", { waitMs: 8000 });
            await sleep(200);
            const op = await deploy(inst, "full", { other: "4" });
            op.status.should.equal(200);
            // nobody answers a stashed request: the limit (5 s) is not waited for, the nodes stop only after it...
            const result = await stashed.done;
            result.status.should.equal(503);
            result.body.code.should.equal("http_drain_outcome_unknown");
            // ... then the old message arrives at an http response node of the new flows (once they have started)
            const started = Date.now();
            while ((await send(inst.url, "/fast").done).status !== 200 && Date.now() - started < 10000) {
                await sleep(50);
            }
            const late = await send(inst.url, "/late", { waitMs: 4000 }).done;
            late.status.should.equal(200);
            await sleep(100);
            inst.output().should.match(/already answered with 503/);
            inst.output().should.not.match(/ERR_HTTP_HEADERS_SENT|Cannot set headers/);
        });
    });

    describe("on, timeout 2000: a request that arrives in the drain of a deployment that changes its node (A18)", function() {
        let inst;
        before(async function() { inst = await startInstance({ timeout: 2000 }) });
        after(function() { return stopInstance(inst) });

        ["flows-holder", "nodes-holder"].forEach(function(name) {
            it(name + ": the request of the drain is answered by the flow, the new one is lost with the node and gets 503 after its deadline, not none", async function() {
                const result = await scenario(inst, name, {
                    waitMs: 5000,
                    during: async function(i) {
                        // the drain ends when the request of S0 is answered (900 ms), then the node that holds
                        // this one is stopped; the deadline (the arrival + 2000 ms) is still ahead
                        await sleep(300);
                        return send(i.url, "/slow", { waitMs: 8000 }).done;
                    }
                });
                result.status.should.equal(200);
                should.not.exist(result.during.hang);
                result.during.status.should.equal(503);
                result.during.body.code.should.equal("http_drain_outcome_unknown");
                result.during.headers["retry-after"].should.equal("1");
                // after the deadline (about 2000 ms after the arrival), long after the stop of the node
                result.during.ms.should.be.above(1500);
                result.during.ms.should.be.below(4500);
            });
        });
    });

    describe("on, timeout 200", function() {
        let inst;
        before(async function() { inst = await startInstance({ timeout: 200 }) });
        after(function() { return stopInstance(inst) });

        Object.keys(OPERATIONS).forEach(function(name) {
            it(name + ": 503 http_drain_outcome_unknown after the limit, with Retry-After for a GET", async function() {
                const result = await scenario(inst, name, { waitMs: 3000 });
                result.status.should.equal(503);
                result.body.code.should.equal("http_drain_outcome_unknown");
                result.headers["retry-after"].should.equal("1");
                result.headers["cache-control"].should.equal("no-store");
                result.op.status.should.be.oneOf([200, 204]);
                // not later than the limit and the stop of the nodes
                result.ms.should.be.below(DELAY);
            });
        });
        it("an accepted POST gets 503 http_drain_outcome_unknown without Retry-After", async function() {
            const result = await scenario(inst, "full", { path: "/slowpost", method: "POST", waitMs: 3000, });
            result.status.should.equal(503);
            result.body.code.should.equal("http_drain_outcome_unknown");
            result.headers.should.not.have.property("retry-after");
        });
        it("the instance serves the requests normally afterwards", async function() {
            await reset(inst);
            (await send(inst.url, "/slow", { waitMs: 3000 }).done).status.should.equal(200);
        });
        it("AC-15 (#82): the debug record of the 503 names the node of the route", async function() {
            const result = await scenario(inst, "full", { path: "/slowpost", method: "POST", waitMs: 3000 });
            result.status.should.equal(503);
            result.body.code.should.equal("http_drain_outcome_unknown");
            await sleep(200);
            // a boolean, so that a failure does not print the whole output of the child
            (inst.output().indexOf("[http in:pi] HTTP drain: a POST request answered 503 http_drain_outcome_unknown") !== -1)
                .should.equal(true, "the debug record of the 503 does not name the node pi");
        });
    });
    // #82 (S-3): a stop signal waits for the requests that are in progress, inside shutdownTimeout
    describe("a stop signal (SIGTERM, #82)", function() {
        let inst;
        afterEach(function() { return stopInstance(inst) });

        function exitOf(instance) {
            return new Promise(resolve => {
                if (instance.child.exitCode !== null || instance.child.signalCode !== null) {
                    return resolve({ code: instance.child.exitCode, signal: instance.child.signalCode });
                }
                instance.child.once("exit", (code, signal) => resolve({ code, signal }));
            });
        }

        it("AC-41: with shutdownTimeout the request that takes 1500 ms is answered by the flow, 200, and the process exits with 0 after it", async function() {
            inst = await startInstance({ timeout: 5000 }, { shutdownTimeout: 5000, delay: 1500 });
            const client = send(inst.url, "/slow", { waitMs: 8000 });
            await sleep(300);
            const signalled = Date.now();
            const exited = exitOf(inst);
            inst.child.kill("SIGTERM");
            const result = await client.done;
            result.status.should.equal(200);
            (Date.now() - signalled).should.be.above(1000);
            const exit = await Promise.race([exited, sleep(10000).then(() => ({ timeout: true }))]);
            should.not.exist(exit.timeout);
            exit.code.should.equal(0);
        });
        it("AC-41: without shutdownTimeout the request gets 503 http_drain_outcome_unknown, as before", async function() {
            inst = await startInstance({ timeout: 5000 }, { delay: 1500 });
            const client = send(inst.url, "/slow", { waitMs: 8000 });
            await sleep(300);
            const exited = exitOf(inst);
            inst.child.kill("SIGTERM");
            const result = await client.done;
            result.status.should.equal(503);
            result.body.code.should.equal("http_drain_outcome_unknown");
            const exit = await Promise.race([exited, sleep(10000).then(() => ({ timeout: true }))]);
            should.not.exist(exit.timeout);
        });
        it("a second signal ends the wait at once: the request gets 503 and the process exits", async function() {
            inst = await startInstance({ timeout: 5000 }, { shutdownTimeout: 20000, delay: 4000 });
            const client = send(inst.url, "/slow", { waitMs: 8000 });
            await sleep(300);
            const exited = exitOf(inst);
            inst.child.kill("SIGTERM");
            await sleep(500);
            const second = Date.now();
            inst.child.kill("SIGTERM");
            const result = await client.done;
            result.status.should.equal(503);
            (Date.now() - second).should.be.below(2500);
            const exit = await Promise.race([exited, sleep(10000).then(() => ({ timeout: true }))]);
            should.not.exist(exit.timeout);
        });
    });
    // #82 (S-8): long-lived connections (an event stream) on `http in` with drainMode "long"
    describe("http in with drainMode long (S-8, #82)", function() {
        // The writer: starts the stream and writes a chunk every 100 ms until the response is closed. A function
        // node clears its timers when it stops
        const DIRECT_WRITER = "const res = msg.res._res; res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache'}); res.write('data: open\\n\\n'); " +
            "const t = setInterval(() => { if (res.destroyed || res.writableEnded) { clearInterval(t); return; } res.write('data: tick\\n\\n'); }, 100); return null;";
        // The response is kept in the context of the flow; the ticks are written by the "On Start" code of a node
        // (so a writer that is restarted writes with its own mark)
        const STORE = "const res = msg.res._res; res.writeHead(200, {'Content-Type': 'text/event-stream'}); res.write('data: open\\n\\n'); flow.set('stream', res); return null;";
        function ticker(mark) {
            return "setInterval(() => { const s = flow.get('stream'); if (s && !s.destroyed && !s.writableEnded) { s.write('data: tick-" + mark + "\\n\\n'); } }, 100);";
        }
        function fn(id, name, func, extra) {
            return Object.assign({ id: id, type: "function", z: "t", name: name, func: func, outputs: 1, noerr: 0, initialize: "", finalize: "", libs: [], wires: [[]] }, extra);
        }
        // `v.writer` changes the writer, `v.other` an unrelated node of another flow; `kind`: "direct" (http in -> writer),
        // "link" (http in -> link out -> link in -> writer) or "context" (a response kept in the context, a separate writer)
        function longFlows(kind, v) {
            v = v || {};
            const base = [
                { id: "t", type: "tab", label: "t" },
                { id: "u", type: "tab", label: "u" },
                { id: "x", type: "inject", z: "u", name: "other" + (v.other || ""), props: [], repeat: "", once: false, wires: [[]] },
                { id: "fi", type: "http in", z: "t", url: "/fast", method: "get", wires: [["fo"]] },
                { id: "fo", type: "http response", z: "t", statusCode: "200", wires: [] }
            ];
            if (kind === "direct") {
                return base.concat([
                    { id: "li", type: "http in", z: "t", url: "/stream", method: "get", drainMode: "long", wires: [["lw"]] },
                    fn("lw", "writer" + (v.writer || ""), DIRECT_WRITER)
                ]);
            }
            if (kind === "link") {
                return base.concat([
                    { id: "li", type: "http in", z: "t", url: "/stream", method: "get", drainMode: "long", wires: [["lo"]] },
                    // x and y: a node without them is a configuration node, and two nodes that refer to each other are a loop
                    { id: "lo", type: "link out", z: "t", x: 300, y: 100, mode: "link", links: ["lin"], wires: [] },
                    { id: "lin", type: "link in", z: "t", x: 400, y: 100, links: ["lo"], wires: [["lw"]] },
                    fn("lw", "writer" + (v.writer || ""), STORE, { initialize: ticker(v.writer || "W1") })
                ]);
            }
            // context: the stream is opened by one node, written by another that no wire connects to it
            return base.concat([
                { id: "li", type: "http in", z: "t", url: "/stream", method: "get", drainMode: "long", wires: [["ls"]] },
                fn("ls", "store", STORE),
                fn("lw", "writer" + (v.writer || ""), "return null;", { initialize: ticker(v.writer || "W1") })
            ]);
        }

        this.timeout(90000);
        let inst;
        let streams;

        function startLong(drain, extra) {
            extra = Object.assign({}, extra);
            return startInstance(drain, Object.assign({ flows: port => longFlows(extra.kind || "direct") }, extra));
        }
        // a deployment that does not answer fails the test after 20 s instead of hanging it
        function deployLong(instance, type, kind, v) {
            const deployment = api(instance.url, "POST", "/flows", { flows: longFlows(kind, v) }, { "Node-RED-Deployment-Type": type });
            const limit = new Promise((resolve, reject) => setTimeout(() => reject(new Error("the deployment did not answer within 20 s")), 20000).unref());
            return Promise.race([deployment, limit]);
        }
        // a stream like the one of a browser: resolves when the headers have arrived
        function openStream(instance) {
            return new Promise(function(resolve, reject) {
                const s = { chunks: [], closed: false, status: null };
                s.req = http.get(instance.url + "/stream", { agent: false }, function(res) {
                    s.status = res.statusCode;
                    res.on("data", d => s.chunks.push(d.toString()));
                    res.on("error", () => {});
                    s.closedPromise = new Promise(function(done) { res.on("close", function() { s.closed = true; done() }) });
                    resolve(s);
                });
                s.req.on("error", function(err) { if (s.status === null) { reject(err) } });
                streams.push(s);
            });
        }
        async function closedWithin(s, ms) {
            return Promise.race([s.closedPromise.then(() => true), sleep(ms).then(() => false)]);
        }
        function text(s) {
            return s.chunks.join("");
        }
        async function growsWithin(s, ms) {
            const before = s.chunks.length;
            const started = Date.now();
            while (Date.now() - started < ms) {
                if (s.chunks.length > before) { return true }
                await sleep(25);
            }
            return false;
        }
        // the base flows running with a new stream
        async function fresh(instance, kind) {
            const state = await api(instance.url, "POST", "/flows/state", { state: "start" });
            state.status.should.equal(200);
            (await deployLong(instance, "full", kind)).status.should.equal(200);
            const started = Date.now();
            for (;;) {
                if ((await send(instance.url, "/fast").done).status === 200) { break }
                if (Date.now() - started > 10000) { throw new Error("the flows did not start") }
                await sleep(100);
            }
            const s = await openStream(instance);
            s.status.should.equal(200);
            (await growsWithin(s, 1500)).should.equal(true, "the stream does not get its chunks");
            return s;
        }

        beforeEach(function() { streams = [] });
        afterEach(async function() {
            streams.forEach(s => { try { s.req.destroy() } catch (err) { /* closed */ } });
            await stopInstance(inst);
            inst = null;
        });

        // the drain on and the drain off (AC-98) behave the same way
        [["the drain on", { timeout: 5000 }], ["the drain off (AC-98)", undefined]].forEach(function(variant) {
            describe("with " + variant[0], function() {
                beforeEach(async function() { inst = await startLong(variant[1], { kind: "direct" }) });

                it("AC-92: a full deployment does not wait for the stream; the connection is closed when the node stops; no 503, no drain record", async function() {
                    const stream = await fresh(inst, "direct");
                    const mark = inst.output().length;
                    const started = Date.now();
                    const result = await deployLong(inst, "full", "direct", { other: "1" });
                    result.status.should.equal(200);
                    (Date.now() - started).should.be.below(1500);
                    (await closedWithin(stream, 1500)).should.equal(true, "the connection was not closed");
                    text(stream).should.not.match(/http_drain|503/);
                    const output = inst.output().slice(mark);
                    output.should.not.match(/Waiting for \d+ HTTP request/);
                    output.should.not.match(/HTTP drain \(/);
                });
                it("AC-93: a flows deployment that changes the node wired to the http in closes the stream", async function() {
                    const stream = await fresh(inst, "direct");
                    const result = await deployLong(inst, "flows", "direct", { writer: "2" });
                    result.status.should.equal(200);
                    (await closedWithin(stream, 1500)).should.equal(true, "the connection was not closed");
                    text(stream).should.not.match(/http_drain|503/);
                });
                ["flows", "nodes"].forEach(function(type) {
                    it("AC-93: a " + type + " deployment that changes only an unrelated flow keeps the stream open and the flow goes on writing to it", async function() {
                        const stream = await fresh(inst, "direct");
                        const result = await deployLong(inst, type, "direct", { other: "2" });
                        result.status.should.equal(200);
                        (await growsWithin(stream, 1500)).should.equal(true, "no chunk reached the client after the deployment");
                        stream.closed.should.be.false();
                        text(stream).should.not.match(/http_drain|503/);
                    });
                });
                it("AC-99 (the documented residual): a nodes deployment that changes only the writer leaves the stream open and silent, no 503", async function() {
                    const stream = await fresh(inst, "direct");
                    const result = await deployLong(inst, "nodes", "direct", { writer: "2" });
                    result.status.should.equal(200);
                    await sleep(500);
                    stream.closed.should.equal(false, "the stream was closed by a deployment that did not change the http in");
                    // the old writer is stopped, the new one has nothing to write: silent
                    const count = stream.chunks.length;
                    await sleep(500);
                    stream.chunks.length.should.equal(count);
                    text(stream).should.not.match(/http_drain|503/);
                });
            });
        });

        ["link", "context"].forEach(function(kind) {
            describe("the writer behind " + (kind === "link" ? "link nodes" : "a response kept in the context") + " (AC-93b, the documented residual)", function() {
                beforeEach(async function() { inst = await startLong({ timeout: 5000 }, { kind: kind }) });
                ["flows", "nodes"].forEach(function(type) {
                    it("a " + type + " deployment that changes the writer keeps the stream open and the new writer writes to it", async function() {
                        const stream = await fresh(inst, kind);
                        /tick-W1/.test(text(stream)).should.equal(true, "the first writer does not write");
                        const result = await deployLong(inst, type, kind, { writer: "W2" });
                        result.status.should.equal(200);
                        const started = Date.now();
                        while (!/tick-W2/.test(text(stream)) && Date.now() - started < 3000) {
                            await sleep(50);
                        }
                        /tick-W2/.test(text(stream)).should.equal(true, "the new writer did not write to the stream");
                        stream.closed.should.equal(false, "the stream was closed");
                        /http_drain|503/.test(text(stream)).should.equal(false, "a 503 was written to the stream");
                    });
                });
            });
        });

        describe("a stop signal (AC-94, AC-95)", function() {
            function exitOf(instance) {
                return new Promise(resolve => {
                    if (instance.child.exitCode !== null || instance.child.signalCode !== null) {
                        return resolve({ code: instance.child.exitCode });
                    }
                    instance.child.once("exit", (code, signal) => resolve({ code, signal }));
                });
            }
            it("AC-94: SIGTERM (RED.stop) closes the stream and answers no 503", async function() {
                inst = await startLong({ timeout: 5000 }, { kind: "direct" });
                const stream = await fresh(inst, "direct");
                const exited = exitOf(inst);
                inst.child.kill("SIGTERM");
                (await closedWithin(stream, 4000)).should.equal(true, "the stream was not closed");
                text(stream).should.not.match(/http_drain|503/);
                const exit = await Promise.race([exited, sleep(8000).then(() => ({ timeout: true }))]);
                should.not.exist(exit.timeout);
            });
            it("AC-95: with shutdownTimeout the SIGTERM path does not wait for the stream and the stream is closed when the flows stop", async function() {
                inst = await startLong({ timeout: 5000 }, { kind: "direct", shutdownTimeout: 5000 });
                const stream = await fresh(inst, "direct");
                const mark = inst.output().length;
                const exited = exitOf(inst);
                const started = Date.now();
                inst.child.kill("SIGTERM");
                (await closedWithin(stream, 4000)).should.equal(true, "the stream was not closed");
                (Date.now() - started).should.be.below(3000);
                const exit = await Promise.race([exited, sleep(8000).then(() => ({ timeout: true }))]);
                should.not.exist(exit.timeout);
                (Date.now() - started).should.be.below(4000);
                inst.output().slice(mark).should.not.match(/Waiting for \d+ HTTP request/);
                text(stream).should.not.match(/http_drain|503/);
            });
        });
    });
});
