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
 *   #7: integration tests of the `hooks` setting (preShutdown/preReload) of settings.js
 *   #15: the hook with health.unreadyGrace, the warnings for hooks that are never called
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * Runs Node-RED in a child process (temporary user directory, editor disabled):
 * a `preShutdown` hook of the `hooks` setting is called on SIGTERM, and an invalid
 * hook name in the setting fails the start with a readable message and exit code 1.
 */
const should = require("should");
const path = require("path");
const os = require("os");
const fs = require("fs");
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

function waitFor(check, timeout, message) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function poll() {
            if (check()) {
                resolve();
            } else if (Date.now() - start > timeout) {
                reject(new Error(message || "timeout"));
            } else {
                setTimeout(poll, 50);
            }
        })();
    });
}

function exited(child) {
    return new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) {
            return resolve(child.exitCode);
        }
        child.once("exit", code => resolve(code));
    });
}

describe("hooks setting of settings.js (integration, #7)", function() {
    this.timeout(60000);
    const children = [];
    const dirs = [];

    function tempDir() {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), "nr-hooks-"));
        dirs.push(d);
        return d;
    }

    function start(userDir, settingsSource, port) {
        fs.writeFileSync(path.join(userDir, "settings.js"), settingsSource);
        fs.writeFileSync(path.join(userDir, "flows.json"), "[]");
        const child = spawn(process.execPath, [RED_JS, "-u", userDir, "-p", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
        child.output = "";
        child.stdout.on("data", d => child.output += d);
        child.stderr.on("data", d => child.output += d);
        children.push(child);
        return child;
    }

    after(function() {
        children.forEach(c => { if (c.exitCode === null && c.signalCode === null) { c.kill("SIGKILL") } });
        dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
    });

    it("a preShutdown hook of the setting is called on SIGTERM and the drain waits for it", async function() {
        const userDir = tempDir();
        const stepLog = path.join(userDir, "steps.log");
        const port = await getFreePort();
        const healthPort = await getFreePort();
        const child = start(userDir, `
const fs = require("fs");
module.exports = Object.assign(${JSON.stringify({
            flowFile: "flows.json",
            disableEditor: true,
            logging: { console: { level: "info" } },
            health: { enabled: true, port: healthPort, host: "127.0.0.1" },
            shutdownTimeout: 30000
        })}, {
    hooks: {
        "preShutdown.drain": async function(payload) {
            fs.appendFileSync(${JSON.stringify(stepLog)}, "hook " + payload.reason + "\\n");
            await new Promise(resolve => setTimeout(resolve, 300));
            fs.appendFileSync(${JSON.stringify(stepLog)}, "hook-end\\n");
        }
    }
});
`, port);
        await waitFor(() => /Started flows/.test(child.output), 30000, "not started: " + child.output);
        child.kill("SIGTERM");
        const code = await Promise.race([exited(child), new Promise(r => setTimeout(() => r("timeout"), 15000))]);
        should(code).not.equal("timeout");
        fs.readFileSync(stepLog, "utf8").split("\n").filter(l => l).should.eql(["hook SIGTERM", "hook-end"]);
    });

    it("a preShutdown hook of the setting is called with health.unreadyGrace and the stop takes at least the grace (#15)", async function() {
        const GRACE = 700;
        const userDir = tempDir();
        const stepLog = path.join(userDir, "steps.log");
        const port = await getFreePort();
        const healthPort = await getFreePort();
        const child = start(userDir, `
const fs = require("fs");
module.exports = Object.assign(${JSON.stringify({
            flowFile: "flows.json",
            disableEditor: true,
            logging: { console: { level: "info" } },
            health: { enabled: true, port: healthPort, host: "127.0.0.1", unreadyGrace: GRACE },
            shutdownTimeout: 30000
        })}, {
    hooks: {
        "preShutdown.drain": async function(payload) {
            fs.appendFileSync(${JSON.stringify(stepLog)}, "hook " + payload.reason + "\\n");
        }
    }
});
`, port);
        await waitFor(() => /Started flows/.test(child.output), 30000, "not started: " + child.output);
        // both settings are there: no warning about a hook that is never called
        child.output.should.not.containEql("is not called");
        const signalled = Date.now();
        child.kill("SIGTERM");
        const code = await Promise.race([exited(child), new Promise(r => setTimeout(() => r("timeout"), 15000))]);
        const stopTime = Date.now() - signalled;
        should(code).not.equal("timeout");
        fs.readFileSync(stepLog, "utf8").split("\n").filter(l => l).should.eql(["hook SIGTERM"]);
        child.output.should.containEql(String(GRACE));
        stopTime.should.be.aboveOrEqual(GRACE);
    });

    it("warns at start about the hooks that are never called, and a preShutdown hook is not called without shutdownTimeout (#15)", async function() {
        const userDir = tempDir();
        const stepLog = path.join(userDir, "steps.log");
        const port = await getFreePort();
        const child = start(userDir, `
const fs = require("fs");
module.exports = {
    flowFile: "flows.json",
    disableEditor: true,
    logging: { console: { level: "info" } },
    hooks: {
        "preShutdown.drain": function(payload) { fs.appendFileSync(${JSON.stringify(stepLog)}, "hook\\n"); return Promise.resolve(); },
        "preReload.sync": function(event) { return Promise.resolve(); }
    }
};
`, port);
        await waitFor(() => /Started flows/.test(child.output), 30000, "not started: " + child.output);
        child.output.should.match(/preShutdown\.drain.*shutdownTimeout/);
        child.output.should.match(/preReload\.sync.*deploy\.reload\.watch/);
        child.kill("SIGTERM");
        const code = await Promise.race([exited(child), new Promise(r => setTimeout(() => r("timeout"), 15000))]);
        should(code).not.equal("timeout");
        fs.existsSync(stepLog).should.be.false();
    });

    it("an invalid hook name fails the start with the key in the message and exit code 1", async function() {
        const userDir = tempDir();
        const port = await getFreePort();
        const child = start(userDir, `
module.exports = {
    flowFile: "flows.json",
    disableEditor: true,
    hooks: { "onSend.drain": function(event) {} }
};
`, port);
        const code = await Promise.race([exited(child), new Promise(r => setTimeout(() => r("timeout"), 30000))]);
        code.should.equal(1);
        child.output.should.containEql("Failed to start server");
        child.output.should.containEql("onSend.drain");
        child.output.should.containEql("Invalid 'hooks' setting");
    });

    it("a missing label fails the start", async function() {
        const userDir = tempDir();
        const port = await getFreePort();
        const child = start(userDir, `
module.exports = {
    flowFile: "flows.json",
    disableEditor: true,
    hooks: { "preReload": function(event) {} }
};
`, port);
        const code = await Promise.race([exited(child), new Promise(r => setTimeout(() => r("timeout"), 30000))]);
        code.should.equal(1);
        child.output.should.containEql("'preReload'");
        child.output.should.containEql("label");
    });
});
