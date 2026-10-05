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
    async function startInstance(drain) {
        const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-drain-"));
        dirs.push(userDir);
        const port = await getFreePort();
        const deployment = {};
        if (drain) {
            deployment.drainHttpNodeRequests = Object.assign({ enabled: true }, drain);
        }
        fs.writeFileSync(path.join(userDir, "flows.json"), JSON.stringify(flows({}, port)));
        fs.writeFileSync(path.join(userDir, "settings.js"), "module.exports = " + JSON.stringify({
            flowFile: "flows.json",
            disableEditor: true,
            runtimeState: { enabled: true, ui: false },
            logging: { console: { level: "debug" } },
            deploy: deployment
        }));
        const child = spawn(process.execPath, [RED_JS, "-u", userDir, "-p", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
        children.push(child);
        const output = [];
        child.stdout.on("data", d => output.push(d.toString()));
        child.stderr.on("data", d => output.push(d.toString()));
        const inst = { url: "http://127.0.0.1:" + port, port, child, output: () => output.join("") };
        await waitForServer(inst.url);
        return inst;
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
    });
});
