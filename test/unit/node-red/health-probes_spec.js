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
 *   Z-08: integration tests of the health probes and the drain on SIGTERM
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * Runs Node-RED in a child process (temporary user directory, editor disabled)
 * and checks the health probes through the start, a deployment and the stop
 * on SIGTERM, with and without a drain (Z-08, D-11), plus the mounting of the
 * probes on the main server before the authentication of the node routes.
 *
 * A node defined in `<userDir>/nodes` closes slowly, so the deployment and the
 * stop take a measurable time; a `preShutdown` hook registered in settings.js
 * waits for a file created by the test and writes the order of the steps to
 * a log file.
 */
const should = require("should");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const net = require("net");
const { spawn } = require("child_process");

const RED_JS = path.resolve(__dirname, "../../../packages/node_modules/node-red/red.js");
const UTIL = path.resolve(__dirname, "../../../packages/node_modules/@node-red/util");

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

function request(method, url, body, headers) {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? "" : JSON.stringify(body);
        const req = http.request(url, {
            method,
            headers: Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "Connection": "close" }, headers || {})
        }, res => {
            let text = "";
            res.on("data", d => text += d);
            res.on("end", () => resolve({ status: res.statusCode, text }));
        });
        req.on("error", reject);
        req.end(data);
    });
}

function waitFor(check, timeout, message) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function poll() {
            Promise.resolve().then(check).then(ok => {
                if (ok) {
                    resolve();
                } else {
                    retry();
                }
            }, retry);
            function retry() {
                if (Date.now() - start > timeout) {
                    reject(new Error(message || "timeout"));
                } else {
                    setTimeout(poll, 50);
                }
            }
        })();
    });
}

function status(url) {
    return request("GET", url).then(res => res.status, () => 0);
}

function exited(child) {
    return new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) {
            return resolve(child.exitCode);
        }
        child.once("exit", code => resolve(code));
    });
}

// A node that takes `delay` ms to close and appends "close" to the step log
function writeSlowNode(userDir, stepLog) {
    const nodesDir = path.join(userDir, "nodes");
    fs.mkdirSync(nodesDir);
    fs.writeFileSync(path.join(nodesDir, "slow-close.js"), `
module.exports = function(RED) {
    function SlowClose(n) {
        RED.nodes.createNode(this, n);
        this.on("close", function(done) {
            setTimeout(function() {
                require("fs").appendFileSync(${JSON.stringify(stepLog)}, "close\\n");
                done();
            }, Number(n.delay) || 0);
        });
    }
    RED.nodes.registerType("slow-close", SlowClose);
};
`);
    fs.writeFileSync(path.join(nodesDir, "slow-close.html"), `<script type="text/javascript">RED.nodes.registerType("slow-close",{category:"function",defaults:{delay:{value:0}},inputs:1,outputs:0,label:"slow"});</script>`);
}

function slowFlow(label, delay) {
    return [
        { id: "tSlow", type: "tab", label: label },
        { id: "nSlow", type: "slow-close", z: "tSlow", delay: delay, wires: [] }
    ];
}

function startNodeRed(userDir, settingsSource, port, env) {
    fs.writeFileSync(path.join(userDir, "settings.js"), settingsSource);
    return spawn(process.execPath, [RED_JS, "-u", userDir, "-p", String(port)], { stdio: "ignore", env: Object.assign({}, process.env, env || {}) });
}

describe("health probes and drain on SIGTERM (integration, Z-08)", function() {
    this.timeout(90000);
    const children = [];
    const dirs = [];

    function tempDir() {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), "nr-health-"));
        dirs.push(d);
        return d;
    }

    after(function() {
        children.forEach(c => { if (c.exitCode === null && c.signalCode === null) { c.kill("SIGKILL") } });
        dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
    });

    it("own port: 503 while starting/deploying/draining, 200 when ready, drain with preShutdown, then exit", async function() {
        const userDir = tempDir();
        const stepLog = path.join(userDir, "steps.log");
        const release = path.join(userDir, "release");
        writeSlowNode(userDir, stepLog);
        fs.writeFileSync(path.join(userDir, "flows.json"), JSON.stringify(slowFlow("A", 1500)));
        const port = await getFreePort();
        const healthPort = await getFreePort();
        const settings = `
const fs = require("fs");
require(${JSON.stringify(UTIL)}).hooks.add("preShutdown", function(payload) {
    fs.appendFileSync(${JSON.stringify(stepLog)}, "hook-start " + payload.reason + "\\n");
    return new Promise(function(resolve) {
        (function check() {
            if (fs.existsSync(${JSON.stringify(release)})) {
                fs.appendFileSync(${JSON.stringify(stepLog)}, "hook-end\\n");
                resolve();
            } else {
                setTimeout(check, 50);
            }
        })();
    });
});
module.exports = ${JSON.stringify({
            flowFile: "flows.json",
            disableEditor: true,
            logging: { console: { level: "off" } },
            health: { enabled: true, port: healthPort, host: "127.0.0.1" },
            shutdownTimeout: 30000
        })};
`;
        const child = startNodeRed(userDir, settings, port);
        children.push(child);
        const base = "http://127.0.0.1:" + port;
        const probes = "http://127.0.0.1:" + healthPort + "/health";

        await waitFor(async () => (await status(probes + "/ready")) === 200, 30000, "not ready");
        (await status(probes + "/live")).should.equal(200);
        const body = await request("GET", probes + "/ready");
        body.text.should.equal('{"status":"ok"}');

        // A deployment: /ready 503 while the slow node closes, 200 afterwards
        const current = JSON.parse((await request("GET", base + "/flows", undefined, { "Node-RED-API-Version": "v2" })).text);
        const statuses = [];
        let polling = true;
        const poller = (async () => {
            while (polling) {
                statuses.push(await status(probes + "/ready"));
                await new Promise(r => setTimeout(r, 50));
            }
        })();
        const deploy = await request("POST", base + "/flows", { rev: current.rev, flows: slowFlow("B", 1500) }, { "Node-RED-API-Version": "v2" });
        deploy.status.should.equal(200);
        await waitFor(async () => (await status(probes + "/ready")) === 200, 10000, "not ready after deploy");
        polling = false;
        await poller;
        statuses.should.containEql(503);

        // SIGTERM: /ready 503 at once, /live 200, the main server still accepts; no node closed yet
        fs.writeFileSync(stepLog, "");
        child.kill("SIGTERM");
        await waitFor(async () => (await status(probes + "/ready")) === 503, 2000, "ready not 503 after SIGTERM");
        await waitFor(() => fs.readFileSync(stepLog, "utf8").indexOf("hook-start") !== -1, 5000, "hook not called");
        (await status(probes + "/live")).should.equal(200);
        (await status(base + "/flows")).should.equal(200);
        await new Promise(r => setTimeout(r, 300));
        fs.readFileSync(stepLog, "utf8").should.not.containEql("close");
        (await request("GET", probes + "/ready")).text.should.equal('{"status":"unavailable"}');

        // End of the drain: RED.stop closes the nodes, then the process exits
        fs.writeFileSync(release, "");
        const code = await Promise.race([exited(child), new Promise(r => setTimeout(() => r("timeout"), 15000))]);
        should(code).not.equal("timeout");
        fs.readFileSync(stepLog, "utf8").split("\n").filter(l => l).should.eql(["hook-start SIGTERM", "hook-end", "close"]);
    });

    it("second SIGTERM during the drain stops at once (R-22)", async function() {
        const userDir = tempDir();
        const stepLog = path.join(userDir, "steps.log");
        writeSlowNode(userDir, stepLog);
        fs.writeFileSync(path.join(userDir, "flows.json"), JSON.stringify(slowFlow("A", 0)));
        const port = await getFreePort();
        const healthPort = await getFreePort();
        const settings = `
require(${JSON.stringify(UTIL)}).hooks.add("preShutdown", function(payload) {
    require("fs").appendFileSync(${JSON.stringify(stepLog)}, "hook-start\\n");
    return new Promise(function() {});
});
module.exports = ${JSON.stringify({
            flowFile: "flows.json",
            disableEditor: true,
            logging: { console: { level: "off" } },
            health: { enabled: true, port: healthPort, host: "127.0.0.1" },
            shutdownTimeout: 60000
        })};
`;
        const child = startNodeRed(userDir, settings, port);
        children.push(child);
        const probes = "http://127.0.0.1:" + healthPort + "/health";
        await waitFor(async () => (await status(probes + "/ready")) === 200, 30000, "not ready");
        child.kill("SIGTERM");
        await waitFor(() => fs.existsSync(stepLog) && fs.readFileSync(stepLog, "utf8").indexOf("hook-start") !== -1, 5000, "hook not called");
        child.kill("SIGTERM");
        const code = await Promise.race([exited(child), new Promise(r => setTimeout(() => r("timeout"), 10000))]);
        should(code).not.equal("timeout");
        fs.readFileSync(stepLog, "utf8").should.containEql("close");
    });

    it("main server: probes mounted before httpNodeAuth; the server listens for the probes only", async function() {
        const bcrypt = require("bcryptjs");
        const userDir = tempDir();
        fs.writeFileSync(path.join(userDir, "flows.json"), "[]");
        const port = await getFreePort();
        const settings = "module.exports = " + JSON.stringify({
            flowFile: "flows.json",
            logging: { console: { level: "off" } },
            httpAdminRoot: false,
            httpNodeRoot: "/",
            httpNodeAuth: { user: "user", pass: bcrypt.hashSync("secret", 8) },
            health: { enabled: true }
        });
        const child = startNodeRed(userDir, settings, port);
        children.push(child);
        const base = "http://127.0.0.1:" + port;
        await waitFor(async () => (await status(base + "/health/ready")) === 200, 30000, "not ready");
        (await status(base + "/health/live")).should.equal(200);
        (await status(base + "/other")).should.equal(401);
        child.kill("SIGTERM");
        const code = await Promise.race([exited(child), new Promise(r => setTimeout(() => r("timeout"), 10000))]);
        should(code).not.equal("timeout");
    });

    it("headless worker (httpAdminRoot and httpNodeRoot false): the main server listens for the probes", async function() {
        const userDir = tempDir();
        fs.writeFileSync(path.join(userDir, "flows.json"), "[]");
        const port = await getFreePort();
        const settings = "module.exports = " + JSON.stringify({
            flowFile: "flows.json",
            logging: { console: { level: "off" } },
            httpAdminRoot: false,
            httpNodeRoot: false,
            health: { enabled: true }
        });
        const child = startNodeRed(userDir, settings, port);
        children.push(child);
        const base = "http://127.0.0.1:" + port;
        await waitFor(async () => (await status(base + "/health/ready")) === 200, 30000, "not ready");
        (await status(base + "/flows")).should.equal(404);
        child.kill("SIGTERM");
        await exited(child);
    });

    it("health disabled (default): no probes, SIGTERM stops without drain even with a preShutdown hook (R-22, R-37)", async function() {
        const userDir = tempDir();
        const stepLog = path.join(userDir, "steps.log");
        fs.writeFileSync(path.join(userDir, "flows.json"), "[]");
        const port = await getFreePort();
        const settings = `
require(${JSON.stringify(UTIL)}).hooks.add("preShutdown", function(payload) {
    require("fs").appendFileSync(${JSON.stringify(stepLog)}, "hook-start\\n");
    return new Promise(function() {});
});
module.exports = ${JSON.stringify({
            flowFile: "flows.json",
            disableEditor: true,
            logging: { console: { level: "off" } }
        })};
`;
        const child = startNodeRed(userDir, settings, port);
        children.push(child);
        const base = "http://127.0.0.1:" + port;
        await waitFor(async () => (await status(base + "/flows")) === 200, 30000, "not started");
        (await status(base + "/health/ready")).should.equal(404);
        child.kill("SIGTERM");
        const code = await Promise.race([exited(child), new Promise(r => setTimeout(() => r("timeout"), 10000))]);
        should(code).not.equal("timeout");
        fs.existsSync(stepLog).should.be.false();
    });
});
