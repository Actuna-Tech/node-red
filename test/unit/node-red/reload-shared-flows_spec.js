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
 *   Z-09: acceptance test - two instances on one shared flow file reload the
 *   flows in the process after the file changed, with a drain of the work in
 *   progress (preReload) and /ready 503 during the drain
 *   #8: acceptance test of deploy.holdHttpNodeRequests with a real "http in" node
 *   in the window between the stop of the old flows and the start of the new ones
 *   #7: the preReload hook is registered with the `hooks` setting of settings.js
 *   #19: longer limits of the hold test, the pollers stop when a check fails (flaky tests)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * Runs two Node-RED instances in child processes. Both use the same flow file
 * in a shared directory (like a shared volume) with `readOnlyUserDir` and
 * `deploy.reload.watch`. A node defined in `<userDir>/nodes` holds an HTTP
 * request for 2 s and counts the work in progress; a `preReload` hook of the
 * `hooks` setting waits until the count is zero.
 *
 * While a request ("turn") is held on each instance, a new flow file with
 * another tab is written: the turns complete with 200, /ready answers 503
 * during the drain, the new route answers afterwards and the processes are
 * not restarted (same process, the HTTP server always answers).
 *
 * A second case (#8) widens the stop->start window of a full reload with a node
 * whose close takes 1.5 s: the route of an "http in" is removed when its node
 * closes, so for about 1.5 s the route does not exist. Requests sent all the
 * time during the reload get 404 without `deploy.holdHttpNodeRequests` and, with
 * it, are held and answered by the new flows (never 404, never 503).
 */
const should = require("should");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const net = require("net");
const { spawn } = require("child_process");

const RED_JS = path.resolve(__dirname, "../../../packages/node_modules/node-red/red.js");

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

// A request that gets no answer in 30 s is destroyed: request() rejects, status() gives -1
// (a hung connection fails the test with a clear message instead of a mocha timeout)
function request(method, url) {
    return new Promise((resolve, reject) => {
        const req = http.request(url, { method, headers: { "Connection": "close" } }, res => {
            let text = "";
            res.on("data", d => text += d);
            res.on("end", () => resolve({ status: res.statusCode, text }));
        });
        req.setTimeout(30000, () => req.destroy(new Error("timeout")));
        req.on("error", reject);
        req.end();
    });
}

// 0: the connection failed, -1: no answer within the timeout (30 s: longer than any hold)
function status(url) {
    return request("GET", url).then(res => res.status, err => err && err.message === "timeout" ? -1 : 0);
}

function waitFor(check, timeout, message) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function poll() {
            Promise.resolve().then(check).then(ok => ok ? resolve() : retry(), retry);
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

function writeHoldNode(userDir) {
    const nodesDir = path.join(userDir, "nodes");
    fs.mkdirSync(nodesDir);
    fs.writeFileSync(path.join(nodesDir, "hold-turn.js"), `
module.exports = function(RED) {
    function HoldTurn(n) {
        RED.nodes.createNode(this, n);
        this.on("input", function(msg, send, done) {
            global.__turnsInProgress = (global.__turnsInProgress || 0) + 1;
            setTimeout(function() {
                global.__turnsInProgress--;
                msg.payload = "turn " + process.pid;
                send(msg);
                done();
            }, Number(n.delay) || 0);
        });
    }
    RED.nodes.registerType("hold-turn", HoldTurn);
};
`);
    // The close of this node takes `closeDelay` ms: it keeps the stop of the old flows
    // (and so the window without the routes) open
    fs.writeFileSync(path.join(nodesDir, "slow-close.js"), `
module.exports = function(RED) {
    function SlowClose(n) {
        RED.nodes.createNode(this, n);
        this.on("close", function(done) {
            setTimeout(done, Number(n.closeDelay) || 0);
        });
    }
    RED.nodes.registerType("slow-close", SlowClose);
};
`);
    fs.writeFileSync(path.join(nodesDir, "slow-close.html"), `<script type="text/javascript">RED.nodes.registerType("slow-close",{category:"function",defaults:{closeDelay:{value:0}},inputs:0,outputs:0,label:"slow close"});</script>`);
    fs.writeFileSync(path.join(nodesDir, "hold-turn.html"), `<script type="text/javascript">RED.nodes.registerType("hold-turn",{category:"function",defaults:{delay:{value:0}},inputs:1,outputs:1,label:"hold"});</script>`);
}

function routeNodes(tab, url, extra) {
    return [
        { id: tab + "-in", type: "http in", z: tab, url: url, method: "get", wires: [[tab + (extra ? "-hold" : "-out")]] },
        extra ? Object.assign({ id: tab + "-hold", z: tab, wires: [[tab + "-out"]] }, extra) : null,
        { id: tab + "-out", type: "http response", z: tab, statusCode: "", wires: [] }
    ].filter(n => n);
}

const FLOWS_A = [{ id: "tA", type: "tab", label: "A" }].concat(routeNodes("tA", "/turn", { type: "hold-turn", delay: 2000 }));
const FLOWS_B = FLOWS_A.concat([{ id: "tB", type: "tab", label: "B" }]).concat(routeNodes("tB", "/new"));

// #8: /stable answers 200 in the old flows and 202 in the new ones; /turn is a request
// in progress that the drain waits for; slow-close widens the window without routes
function windowFlows(statusCode) {
    return [{ id: "tW", type: "tab", label: "W" }]
        .concat(routeNodes("tW", "/stable").map(n => n.type === "http response" ? Object.assign(n, { statusCode: statusCode }) : n))
        .concat(routeNodes("tT", "/turn", { type: "hold-turn", delay: 1000 }).map(n => Object.assign(n, { z: "tW" })))
        .concat([{ id: "slow", type: "slow-close", z: "tW", closeDelay: 1500, wires: [] }]);
}

describe("reload of shared flows in two instances (acceptance, Z-09)", function() {
    this.timeout(90000);
    const children = [];
    const dirs = [];

    function tempDir(prefix) {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        dirs.push(d);
        return d;
    }

    after(function() {
        children.forEach(c => { if (c.exitCode === null && c.signalCode === null) { c.kill("SIGKILL") } });
        dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
    });

    async function startInstance(flowFile, deploy) {
        const userDir = tempDir("nr-reload-");
        writeHoldNode(userDir);
        const port = await getFreePort();
        const healthPort = await getFreePort();
        // The drain hook is registered with the `hooks` setting (#7)
        fs.writeFileSync(path.join(userDir, "settings.js"), `
module.exports = Object.assign(${JSON.stringify({
            flowFile: flowFile,
            readOnlyUserDir: true,
            disableEditor: true,
            logging: { console: { level: "off" } },
            health: { enabled: true, port: healthPort, host: "127.0.0.1" },
            deploy: Object.assign({ reload: { watch: true, preReloadTimeout: 30000 } }, deploy)
        })}, {
    hooks: {
        "preReload.drain": function(event) {
            return new Promise(function(resolve) {
                (function check() {
                    if (!global.__turnsInProgress || event.signal.aborted) {
                        resolve();
                    } else {
                        setTimeout(check, 20);
                    }
                })();
            });
        }
    }
});
`);
        const child = spawn(process.execPath, [RED_JS, "-u", userDir, "-p", String(port)], { stdio: "ignore" });
        children.push(child);
        return {
            child: child,
            pid: child.pid,
            base: "http://127.0.0.1:" + port,
            ready: "http://127.0.0.1:" + healthPort + "/health/ready"
        };
    }

    it("a new flow file is reloaded after the turns in progress completed, without a restart", async function() {
        const shared = tempDir("nr-reload-shared-");
        const flowFile = path.join(shared, "flows.json");
        fs.writeFileSync(flowFile, JSON.stringify(FLOWS_A));
        const instances = [await startInstance(flowFile), await startInstance(flowFile)];
        for (const inst of instances) {
            await waitFor(async () => (await status(inst.ready)) === 200, 30000, "not ready");
            (await status(inst.base + "/new")).should.equal(404);
        }

        // The probes and the HTTP server are watched during the whole reload
        const observed = instances.map(() => []);
        let polling = true;
        const pollers = instances.map((inst, i) => (async () => {
            while (polling) {
                observed[i].push(await status(inst.ready));
                await new Promise(r => setTimeout(r, 25));
            }
        })());

        try {
            // A turn in progress on each instance
            const turns = instances.map(inst => request("GET", inst.base + "/turn"));
            await new Promise(r => setTimeout(r, 400));
            // Another instance (or a deployment elsewhere) writes the new flows
            fs.writeFileSync(flowFile + ".tmp", JSON.stringify(FLOWS_B));
            fs.renameSync(flowFile + ".tmp", flowFile);

            const results = await Promise.all(turns);
            results.forEach((res, i) => {
                res.status.should.equal(200);
                res.text.should.equal("turn " + instances[i].pid);
            });
            for (const inst of instances) {
                await waitFor(async () => (await status(inst.base + "/new")) === 200, 15000, "new route not available");
                await waitFor(async () => (await status(inst.ready)) === 200, 10000, "not ready after the reload");
            }
            polling = false;
            await Promise.all(pollers);

            observed.forEach(statuses => {
                // 503 during the drain, the HTTP server never stopped answering
                statuses.should.containEql(503);
                statuses.should.not.containEql(0);
            });
            instances.forEach(inst => {
                should(inst.child.exitCode).be.null();
                should(inst.child.signalCode).be.null();
            });
            // The reloaded flows keep working and the old route still answers
            (await request("GET", instances[0].base + "/turn")).status.should.equal(200);
            // The shared flow file was not written by the instances
            JSON.parse(fs.readFileSync(flowFile, "utf8")).should.eql(FLOWS_B);
        } finally {
            // a failed check must not leave the pollers running: they keep mocha alive
            polling = false;
        }
    });

    // Sends GET /stable all the time (two sequential pollers) during a reload of the
    // flows written to the shared file; returns the statuses in the order of the answers
    async function reloadUnderLoad(deploy) {
        const shared = tempDir("nr-reload-hold-");
        const flowFile = path.join(shared, "flows.json");
        fs.writeFileSync(flowFile, JSON.stringify(windowFlows("200")));
        const inst = await startInstance(flowFile, deploy);
        await waitFor(async () => (await status(inst.ready)) === 200, 30000, "not ready");
        (await status(inst.base + "/stable")).should.equal(200);

        const statuses = [];
        let polling = true;
        const pollers = [0, 1].map(() => (async () => {
            while (polling) {
                statuses.push(await status(inst.base + "/stable"));
                await new Promise(r => setTimeout(r, 10));
            }
        })());
        try {
            // A request in progress: the drain waits for it, the reload starts when it completes
            const turn = request("GET", inst.base + "/turn");
            await new Promise(r => setTimeout(r, 300));
            fs.writeFileSync(flowFile + ".tmp", JSON.stringify(windowFlows("202")));
            fs.renameSync(flowFile + ".tmp", flowFile);
            (await turn).status.should.equal(200);
            // the new flows answer 202 on /stable once started
            await waitFor(async () => statuses.indexOf(202) !== -1, 20000, "the new flows did not answer");
            await new Promise(r => setTimeout(r, 300));
            polling = false;
            await Promise.all(pollers);
            should(inst.child.exitCode).be.null();
            return statuses;
        } finally {
            // a failed check must not leave the pollers running: they keep mocha alive
            polling = false;
        }
    }

    it("with deploy.holdHttpNodeRequests a request in the stop->start window gets the answer of the new flows, never 404 (#8)", async function() {
        const statuses = await reloadUnderLoad({ holdHttpNodeRequests: { enabled: true, timeout: 15000 } });
        if (statuses.indexOf(-1) !== -1) {
            throw new Error("a request got no answer within 30 s (held too long): " + JSON.stringify(statuses));
        }
        statuses.should.not.containEql(404);
        statuses.should.not.containEql(503);
        statuses.should.not.containEql(0);
        statuses.should.containEql(200);
        statuses.should.containEql(202);
        // once the new flows answer, the old ones never do again
        statuses.slice(statuses.indexOf(202)).should.not.containEql(200);
    });

    it("control: without the setting the same window gives 404 (#8)", async function() {
        const statuses = await reloadUnderLoad();
        // the route is gone for the 1.5 s the old flows take to stop
        statuses.should.containEql(404);
        statuses.should.containEql(202);
    });
});
