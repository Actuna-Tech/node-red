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
 *   #84: new file - integration tests (child processes) of a deployment that races the stop of the runtime: an embedded
 *   Node-RED whose RED.stop() is called during the stop step of a deployment, and the CLI with a shutdown drain in
 *   which every deployment is refused
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * AC-25 of the spec of #84. A node type defined in the user directory writes a line to a marker file when it
 * is constructed and when it is closed (the close of a node can be delayed); the tests read the file.
 *
 *  - the embedded mode: a full deployment over HTTP whose old node closes slowly; `RED.stop()` is called during
 *    that stop. After it resolves no node of the new revision is constructed (the test waits 1.5 s) and every old
 *    node has a close marker.
 *  - the CLI: SIGTERM with `shutdownTimeout` and a `preShutdown` hook that waits for a file; during that drain every
 *    request that deploys or starts the flows is answered 503 `runtime_stopping` and changes nothing.
 *
 * The runtime keeps singletons, so the instances are child processes. Every child is killed (SIGKILL) after the test;
 * every wait is bounded, so a failing test does not hang the run.
 */
const should = require("should");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const { freePort } = require("nr-test-utils/free-port");
const { SUITE_TIMEOUT, WAIT_LIMIT } = require("nr-test-utils/stop-race-world");

// The limit of a wait for an event of a child process: only for a hang, not a requirement of speed (a slow machine, a
// container with coverage). The suite timeout is larger than it.
const WAIT = WAIT_LIMIT * 3;

const PACKAGES = path.resolve(__dirname, "../../../packages/node_modules");
const RED_JS = path.join(PACKAGES, "node-red/red.js");
const RED_LIB = path.join(PACKAGES, "node-red/lib/red.js");
const UTIL = path.join(PACKAGES, "@node-red/util");
const EXPRESS = require.resolve("express");
const V2 = { "Node-RED-API-Version": "v2" };

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function request(base, method, urlPath, body, headers, raw) {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? "" : (raw ? body : JSON.stringify(body));
        const req = http.request(base + urlPath, {
            method,
            agent: false,
            headers: Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "Connection": "close" }, headers || {})
        }, res => {
            let text = "";
            res.on("data", d => text += d);
            res.on("end", () => {
                let json;
                try { json = text ? JSON.parse(text) : undefined } catch (err) { json = undefined }
                resolve({ status: res.statusCode, body: json, text, headers: res.headers });
            });
        });
        req.setTimeout(WAIT, () => req.destroy(new Error("the request took more than " + WAIT / 1000 + " s")));
        req.on("error", reject);
        req.end(data);
    });
}

async function waitFor(check, timeout, message) {
    const started = Date.now();
    for (;;) {
        let ok = false;
        try { ok = await check() } catch (err) { ok = false }
        if (ok) {
            return;
        }
        if (Date.now() - started > timeout) {
            throw new Error(message || "timeout");
        }
        await sleep(50);
    }
}

// The marker node: `v` is the version of the configuration, `closeDelay` the time its close takes, `closeWait` a file
// whose existence ends its close (when it is set it replaces the time)
const NODE_JS = `
module.exports = function(RED) {
    const fs = require("fs");
    function MarkerNode(n) {
        RED.nodes.createNode(this, n);
        const marker = process.env.NR_MARKER;
        fs.appendFileSync(marker, "construct " + n.id + " v" + (n.v || 1) + "\\n");
        this.on("close", function(done) {
            fs.appendFileSync(marker, "close " + n.id + "\\n");
            const finish = function() {
                fs.appendFileSync(marker, "closed " + n.id + "\\n");
                done();
            };
            if (n.closeWait) {
                // the close ends when the test creates the file: the order of the events is the test's, not the clock's
                (function check() {
                    if (fs.existsSync(n.closeWait)) {
                        finish();
                    } else {
                        setTimeout(check, 20);
                    }
                })();
            } else {
                setTimeout(finish, Number(n.closeDelay) || 0);
            }
        });
    }
    RED.nodes.registerType("marker", MarkerNode);
};
`;
const NODE_HTML = `<script type="text/javascript">RED.nodes.registerType("marker",{category:"function",defaults:{v:{value:1},closeDelay:{value:0},closeWait:{value:""}},inputs:0,outputs:0,label:"marker"});</script>`;

// The flows: `v` is the version; m1 closes slowly (900 ms, or when the file `closeWait` exists)
function flowsOf(v, closeWait) {
    return [
        { id: "t", type: "tab", label: "t" },
        { id: "m1", type: "marker", z: "t", v: v, closeDelay: closeWait ? 0 : 900, closeWait: closeWait || "", wires: [] },
        { id: "m2", type: "marker", z: "t", v: v, closeDelay: 0, wires: [] }
    ];
}

describe("a deployment that races the stop of the runtime (integration, #84)", function() {
    // the limit of a hang, not of the speed of the machine
    this.timeout(SUITE_TIMEOUT * 3);
    let children = [];
    let dirs = [];

    afterEach(async function() {
        children.forEach(c => { if (c.exitCode === null && c.signalCode === null) { c.kill("SIGKILL") } });
        await Promise.all(children.map(c => new Promise(resolve => {
            if (c.exitCode !== null || c.signalCode !== null) {
                return resolve();
            }
            c.once("exit", () => resolve());
        })));
        dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
        children = [];
        dirs = [];
    });

    function prepare(gated) {
        const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-stoprace-"));
        dirs.push(userDir);
        const nodesDir = path.join(userDir, "nodes");
        fs.mkdirSync(nodesDir);
        fs.writeFileSync(path.join(nodesDir, "marker.js"), NODE_JS);
        fs.writeFileSync(path.join(nodesDir, "marker.html"), NODE_HTML);
        // gated: the close of m1 ends when the test creates `closeGate` (nothing else ends it)
        const closeGate = path.join(userDir, "close-m1");
        fs.writeFileSync(path.join(userDir, "flows.json"), JSON.stringify(flowsOf(1, gated ? closeGate : undefined)));
        const marker = path.join(userDir, "marker.log");
        fs.writeFileSync(marker, "");
        return { userDir, nodesDir, marker, closeGate };
    }
    function lines(marker) {
        return fs.readFileSync(marker, "utf8").split("\n").filter(l => l);
    }
    function spawnChild(args, env, proc) {
        const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], env: Object.assign({}, process.env, env) });
        children.push(child);
        proc.child = child;
        proc.output = "";
        child.stdout.on("data", d => proc.output += d);
        child.stderr.on("data", d => proc.output += d);
        return child;
    }
    async function waitForServer(proc) {
        await waitFor(async () => (await request(proc.base, "GET", "/flows", undefined, V2)).status === 200, WAIT, "the server did not start; output:\n" + proc.output);
        await waitFor(() => lines(proc.marker).filter(l => l.indexOf("construct ") === 0).length >= 2, WAIT, "the flows were not started; output:\n" + proc.output);
    }

    describe("AC-25: the embedded mode", function() {
        // gated: the close of m1 waits for the test (see prepare)
        async function launchEmbedded(gated) {
            const dirs = prepare(gated);
            const port = await freePort();
            const script = path.join(dirs.userDir, "embedder.js");
            fs.writeFileSync(script, `
const http = require("http");
const express = require(${JSON.stringify(EXPRESS)});
const RED = require(${JSON.stringify(RED_LIB)});
const app = express();
const server = http.createServer(app);
RED.init(server, {
    userDir: ${JSON.stringify(dirs.userDir)},
    flowFile: "flows.json",
    nodesDir: [${JSON.stringify(dirs.nodesDir)}],
    httpAdminRoot: "/",
    disableEditor: true,
    logging: { console: { level: "off" } }
});
// the application stops Node-RED on request and answers when RED.stop() has resolved
app.post("/__stop", function(req, res) {
    require("fs").appendFileSync(process.env.NR_MARKER, "stop-called\\n");
    RED.stop().then(function() { res.json({ stopped: true }) }, function(err) { res.status(500).json({ error: String(err) }) });
});
app.use("/", RED.httpAdmin);
RED.start().then(function() { server.listen(${port}, "127.0.0.1") });
`);
            const proc = Object.assign(dirs, { base: "http://127.0.0.1:" + port, port });
            spawnChild([script], { NR_MARKER: dirs.marker }, proc);
            await waitForServer(proc);
            return proc;
        }

        it("AC-25: RED.stop() during the stop step of a full deployment: no node of the new revision is constructed afterwards, every old node has a close marker, the deployment answers 200", async function() {
            const proc = await launchEmbedded(true);
            const deployment = request(proc.base, "POST", "/flows", { flows: flowsOf(2) }, Object.assign({ "Node-RED-Deployment-Type": "full" }, V2));
            // the deployment is in its stop step: the old nodes are closing (the close of m1 waits for the test)
            await waitFor(() => lines(proc.marker).indexOf("close m1") !== -1, WAIT, "the deployment did not reach its stop step; output:\n" + proc.output);
            lines(proc.marker).should.not.containEql("closed m1");
            // RED.stop() is called while m1 is closing; the close ends only after the call (the call is in the marker file)
            const stopping = request(proc.base, "POST", "/__stop");
            await waitFor(() => lines(proc.marker).indexOf("stop-called") !== -1, WAIT, "RED.stop() was not called; output:\n" + proc.output);
            fs.writeFileSync(proc.closeGate, "");
            const stop = await stopping;
            stop.status.should.equal(200);
            // after RED.stop() resolved nothing starts. A window of time can only show an absence: it makes the test more
            // sensitive, it never decides about a correct runtime (the length is not a requirement of speed)
            await sleep(1500);
            const marked = lines(proc.marker);
            marked.filter(l => /^construct .* v2$/.test(l)).should.eql([], "a node of the new revision was constructed after RED.stop() resolved; output:\n" + proc.output);
            marked.should.containEql("close m1");
            marked.should.containEql("close m2");
            marked.should.containEql("closed m1");
            marked.filter(l => l === "close m1").should.have.length(1);
            marked.filter(l => l === "close m2").should.have.length(1);
            const answer = await deployment;
            answer.status.should.equal(200);
            answer.body.should.have.property("rev");
        });

        it("AC-25: the same with a partial deployment (type nodes): the unchanged node is closed too", async function() {
            const proc = await launchEmbedded(true);
            const changed = flowsOf(1);
            // only m1 changes: m2 is unchanged and stays running through the deployment
            changed[1].v = 2;
            const deployment = request(proc.base, "POST", "/flows", { flows: changed }, Object.assign({ "Node-RED-Deployment-Type": "nodes" }, V2));
            await waitFor(() => lines(proc.marker).indexOf("close m1") !== -1, WAIT, "the deployment did not reach its stop step; output:\n" + proc.output);
            const stopping = request(proc.base, "POST", "/__stop");
            await waitFor(() => lines(proc.marker).indexOf("stop-called") !== -1, WAIT, "RED.stop() was not called; output:\n" + proc.output);
            fs.writeFileSync(proc.closeGate, "");
            const stop = await stopping;
            stop.status.should.equal(200);
            await sleep(1500);
            const marked = lines(proc.marker);
            marked.filter(l => /^construct .* v2$/.test(l)).should.eql([], "a node of the new revision was constructed after RED.stop() resolved; output:\n" + proc.output);
            marked.should.containEql("close m1");
            marked.should.containEql("close m2");
            marked.filter(l => l === "close m2").should.have.length(1);
            await deployment;
        });

        it("AC-25: after RED.stop() resolved a deployment through the Admin API is refused 503 runtime_stopping and constructs nothing", async function() {
            const proc = await launchEmbedded(false);
            const stop = await request(proc.base, "POST", "/__stop");
            stop.status.should.equal(200);
            const before = lines(proc.marker);
            const answer = await request(proc.base, "POST", "/flows", { flows: flowsOf(3) }, Object.assign({ "Node-RED-Deployment-Type": "full" }, V2));
            answer.status.should.equal(503);
            answer.body.should.have.property("code", "runtime_stopping");
            await sleep(500);
            lines(proc.marker).should.eql(before);
            fs.readFileSync(path.join(proc.userDir, "flows.json"), "utf8").should.not.containEql('"v":3');
        });
    });

    describe("AC-25: the CLI with a shutdown drain", function() {
        async function launchCli() {
            const dirs = prepare();
            const port = await freePort();
            const healthPort = await freePort();
            const release = path.join(dirs.userDir, "release");
            const settingsFile = `
const fs = require("fs");
require(${JSON.stringify(UTIL)}).hooks.add("preShutdown", function(payload) {
    return new Promise(function(resolve) {
        (function check() {
            if (fs.existsSync(${JSON.stringify(release)})) {
                resolve();
            } else {
                setTimeout(check, 50);
            }
        })();
    });
});
module.exports = ${JSON.stringify({
                flowFile: "flows.json",
                nodesDir: [dirs.nodesDir],
                disableEditor: true,
                runtimeState: { enabled: true, ui: false },
                logging: { console: { level: "info" } },
                health: { enabled: true, port: healthPort, host: "127.0.0.1" },
                shutdownTimeout: 30000
            })};
`;
            fs.writeFileSync(path.join(dirs.userDir, "settings.js"), settingsFile);
            const proc = Object.assign(dirs, { base: "http://127.0.0.1:" + port, port, release, probes: "http://127.0.0.1:" + healthPort });
            spawnChild([RED_JS, "-u", dirs.userDir, "-p", String(port)], { NR_MARKER: dirs.marker }, proc);
            await waitForServer(proc);
            return proc;
        }

        it("AC-25: during the drain every deployment and every start is refused 503 runtime_stopping, nothing changes; after the drain the nodes are closed once each", async function() {
            const proc = await launchCli();
            const initial = lines(proc.marker);
            proc.child.kill("SIGTERM");
            await waitFor(async () => (await request(proc.probes, "GET", "/health/ready")).status === 503, WAIT, "/ready did not answer 503 after SIGTERM; output:\n" + proc.output);
            const refused = async function(name, method, urlPath, body, headers, raw) {
                const res = await request(proc.base, method, urlPath, body, headers, raw);
                res.status.should.equal(503, name + ": " + res.text);
                should.exist(res.body, name + ": no JSON body (" + res.text + ")");
                res.body.should.have.property("code", "runtime_stopping");
                res.body.should.have.property("message").which.is.a.String();
                return res;
            };
            const full = Object.assign({ "Node-RED-Deployment-Type": "full" }, V2);
            await refused("full v2", "POST", "/flows", { flows: flowsOf(2) }, full);
            await refused("nodes v2", "POST", "/flows", { flows: flowsOf(2) }, Object.assign({ "Node-RED-Deployment-Type": "nodes" }, V2));
            await refused("flows v2", "POST", "/flows", { flows: flowsOf(2) }, Object.assign({ "Node-RED-Deployment-Type": "flows" }, V2));
            await refused("reload", "POST", "/flows", undefined, Object.assign({ "Node-RED-Deployment-Type": "reload" }, V2));
            // a wrong revision (would be 409) is refused first
            await refused("full v2 with a wrong rev", "POST", "/flows", { rev: "wrong", flows: flowsOf(2) }, full);
            // v1: an array body, not 204
            await refused("full v1", "POST", "/flows", flowsOf(2), { "Node-RED-Deployment-Type": "full" });
            await refused("POST /flow", "POST", "/flow", { label: "x", nodes: [] }, V2);
            await refused("PUT /flow/t", "PUT", "/flow/t", { label: "t", nodes: [] }, V2);
            await refused("DELETE /flow/t", "DELETE", "/flow/t", undefined, V2);
            await refused("POST /flows/state start", "POST", "/flows/state", { state: "start" });
            // what is decided before the runtime is asked keeps its answer
            const broken = await request(proc.base, "POST", "/flows", '{"flows":', full, true);
            broken.status.should.equal(400);
            const invalid = await request(proc.base, "POST", "/flows/state", { state: "x" });
            invalid.status.should.equal(400);
            invalid.body.should.have.property("code", "invalid_run_state");
            // nothing changed: the flows run, the file is the old one, no marker line
            lines(proc.marker).should.eql(initial);
            (await request(proc.base, "GET", "/flows/state")).body.should.have.property("state", "start");
            JSON.parse(fs.readFileSync(path.join(proc.userDir, "flows.json"), "utf8")).find(n => n.id === "m1").v.should.equal(1);
            // the end of the drain: RED.stop closes the nodes, the process ends
            fs.writeFileSync(proc.release, "");
            await waitFor(() => proc.child.exitCode !== null || proc.child.signalCode !== null, WAIT, "the process did not exit; output:\n" + proc.output);
            should(proc.child.exitCode).equal(0);
            const marked = lines(proc.marker);
            marked.filter(l => /^construct .* v2$/.test(l)).should.eql([]);
            marked.filter(l => l === "close m1").should.have.length(1);
            marked.filter(l => l === "close m2").should.have.length(1);
            proc.output.should.not.match(/Uncaught Exception/);
        });
    });
});
