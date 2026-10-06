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
 *   #67: integration tests of the end of the process after a failed start (CLI)
 *   #75: SIGTERM with a coordination plugin whose resign rejects with undefined
 *   #63: a start rejected with a Symbol (the header of the failure is logged once for every value); RED.stop rejecting
 *   with a value that has no prototype or whose properties throw
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * Runs Node-RED (`red.js`) in a child process with a settings file that makes a
 * step of the start fail (a stub of the coordination, the storage, the editor
 * API, ...), and checks what the process does when `RED.start()` rejects (#67):
 *
 *  - an ordered stop (`RED.stop("startup-error")`) limited to 5000 ms, without
 *    the `preShutdown` hook and without `health.unreadyGrace`
 *  - the exit code 1 (never 0, never a process that stays alive)
 *  - the log of any value of the rejection
 *
 * Every test names the acceptance criterion (AC-n) of the spec of #67. "Exits in
 * time" is a race with a bound of 10 s: a process that stays alive fails the
 * assertion and is killed after the test, it does not hang the run.
 *
 * AC-13 (the embedded mode does not exit) is in `lib/red_spec.js`, AC-14 (/live)
 * is the unchanged `health_spec.js`, AC-15 (the documentation) is a review by grep.
 */
const should = require("should");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const net = require("net");
const { spawn } = require("child_process");

const PACKAGES = path.resolve(__dirname, "../../../packages/node_modules");
const RED_JS = path.join(PACKAGES, "node-red/red.js");
const RED_LIB = path.join(PACKAGES, "node-red/lib/red.js");
const COORDINATION = path.join(PACKAGES, "@node-red/runtime/lib/coordination");
const EDITOR_API = path.join(PACKAGES, "@node-red/editor-api");
const LOCALFS = path.join(PACKAGES, "@node-red/runtime/lib/storage/localfilesystem");

const EXIT_BOUND = 10000;

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

function request(url) {
    return new Promise((resolve) => {
        const req = http.request(url, { method: "GET", headers: { "Connection": "close" } }, res => {
            let text = "";
            res.on("data", d => text += d);
            res.on("end", () => resolve({ status: res.statusCode, text }));
        });
        req.on("error", () => resolve({ status: 0, text: "" }));
        req.end();
    });
}

function status(url) {
    return request(url).then(res => res.status);
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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Whether a TCP connection to the port is refused (nothing listens there)
function refused(port) {
    return new Promise(resolve => {
        const socket = net.connect(port, "127.0.0.1");
        socket.once("connect", () => { socket.destroy(); resolve(false) });
        socket.once("error", err => resolve(err.code === "ECONNREFUSED"));
    });
}

describe("end of the process after a failed start (integration, #67)", function() {
    this.timeout(60000);
    let children = [];
    let dirs = [];
    let servers = [];

    function tempDir() {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), "nr-startfail-"));
        dirs.push(d);
        return d;
    }

    afterEach(async function() {
        children.forEach(c => { if (c.exitCode === null && c.signalCode === null) { c.kill("SIGKILL") } });
        await Promise.all(children.map(c => new Promise(resolve => {
            if (c.exitCode !== null || c.signalCode !== null) {
                return resolve();
            }
            c.once("exit", () => resolve());
        })));
        await Promise.all(servers.map(s => new Promise(resolve => s.close(() => resolve()))));
        dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
        children = [];
        dirs = [];
        servers = [];
    });

    /**
     * Writes settings.js and starts red.js. `extra` is a JS expression of an object
     * merged over the base settings; `pre` is JS run in settings.js before them (stubs;
     * the require cache is shared with red.js).
     */
    function launch(options) {
        options = options || {};
        const userDir = options.userDir || tempDir();
        const marker = path.join(userDir, "marker.log");
        const base = { flowFile: "flows.json", disableEditor: !options.editor, logging: { console: { level: "info" } } };
        const source = `
const fs = require("fs");
const MARKER = ${JSON.stringify(marker)};
${options.pre || ""}
module.exports = Object.assign(${JSON.stringify(base)}, (${options.extra || "{}"}));
`;
        fs.writeFileSync(path.join(userDir, "settings.js"), source);
        fs.writeFileSync(path.join(userDir, "flows.json"), options.flows || "[]");
        return (options.port !== undefined ? Promise.resolve(options.port) : getFreePort()).then(port => {
            const child = spawn(process.execPath, [RED_JS, "-u", userDir, "-p", String(port)], {
                stdio: options.ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"]
            });
            children.push(child);
            const proc = { child, userDir, marker, port, output: "" };
            child.stdout.on("data", d => proc.output += d);
            child.stderr.on("data", d => proc.output += d);
            return proc;
        });
    }

    // Resolves with the exit code; rejects (an assertion failure) when the process stays alive
    function exitsWithin(proc, ms) {
        const child = proc.child;
        return new Promise((resolve, reject) => {
            if (child.exitCode !== null || child.signalCode !== null) {
                return resolve(child.exitCode);
            }
            const timer = setTimeout(() => {
                reject(new Error("the process is still alive " + ms + " ms after the failed start; output:\n" + proc.output));
            }, ms);
            child.once("exit", code => {
                clearTimeout(timer);
                resolve(code);
            });
        });
    }

    function lines(file) {
        return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(l => l) : [];
    }

    function rejectCoordination(valueExpr) {
        return `require(${JSON.stringify(COORDINATION)}).start = () => Promise.reject(${valueExpr});`;
    }

    const COORDINATION_ERROR = `new Error("coordination store unavailable")`;

    // A RED.stop that appends "stop" to the marker and never finishes
    const HANGING_STOP = `require(${JSON.stringify(RED_LIB)}).stop = function() { fs.appendFileSync(MARKER, "stop\\n"); return new Promise(function() {}) };`;

    it("AC-1: a rejected start without probes exits with 1 after the ordered stop, without an uncaught exception", async function() {
        const proc = await launch({ pre: rejectCoordination(COORDINATION_ERROR) });
        const code = await exitsWithin(proc, EXIT_BOUND);
        should(code).equal(1);
        proc.output.should.match(/Failed to start server/);
        proc.output.should.match(/coordination store unavailable/);
        proc.output.should.match(/Stopping Node-RED \(startup-error\)/);
        proc.output.should.not.match(/Uncaught Exception/);
    });

    describe("AC-2: the process ends in every setup that keeps it alive today", function() {
        const variants = [
            { name: "own health port (the probe port is closed afterwards)", ownPort: true },
            { name: "probes on the main server (health.port not set)", extra: `{ health: { enabled: true } }` },
            { name: "metrics (setInterval)", extra: `{ logging: { console: { level: "info", metrics: true } } }` },
            { name: "IPC channel (PM2 in the fork mode)", ipc: true }
        ];
        variants.forEach(v => {
            it("AC-2: " + v.name + ": exit 1", async function() {
                let healthPort;
                let extra = v.extra;
                if (v.ownPort) {
                    healthPort = await getFreePort();
                    extra = `{ health: { enabled: true, port: ${healthPort}, host: "127.0.0.1" } }`;
                }
                const proc = await launch({ pre: rejectCoordination(COORDINATION_ERROR), extra, ipc: v.ipc });
                const code = await exitsWithin(proc, EXIT_BOUND);
                should(code).equal(1);
                proc.output.should.match(/Failed to start server/);
                if (healthPort) {
                    (await refused(healthPort)).should.be.true();
                }
            });
        });
    });

    describe("AC-3: every failed step of the start ends the process with 1", function() {
        // `cause` proves that the start failed in the intended step
        const steps = [
            { name: "probes: invalid health.path", extra: `{ health: { enabled: true, path: "health" } }`, cause: /invalid health\.path/ },
            { name: "probes: health.port in use", occupied: true, cause: /already in use/ },
            { name: "storage: init rejects", extra: `{ storageModule: { init: () => Promise.reject(new Error("storage init failed on purpose")) } }`, cause: /storage init failed on purpose/ },
            { name: "context storage: module does not exist", extra: `{ contextStorage: { default: { module: "does-not-exist" } } }`, cause: /does-not-exist/ },
            { name: "coordination: plugin does not exist", extra: `{ coordination: { plugin: "does-not-exist" } }`, cause: /does-not-exist/ },
            {
                name: "watchFlows of the storage rejects (deploy.reload.watch)",
                pre: `const localfs = require(${JSON.stringify(LOCALFS)});
const failingStorage = Object.assign({}, localfs, { watchFlows: () => Promise.reject(new Error("watch failed on purpose")) });`,
                extra: `{ storageModule: failingStorage, deploy: { reload: { watch: true } } }`,
                cause: /watch failed on purpose/
            }
        ];
        steps.forEach(s => {
            it("AC-3: " + s.name, async function() {
                let extra = s.extra;
                if (s.occupied) {
                    const port = await getFreePort();
                    const occupant = net.createServer();
                    servers.push(occupant);
                    await new Promise((resolve, reject) => { occupant.once("error", reject); occupant.listen(port, "127.0.0.1", resolve) });
                    extra = `{ health: { enabled: true, port: ${port}, host: "127.0.0.1" } }`;
                }
                const proc = await launch({ pre: s.pre, extra });
                const code = await exitsWithin(proc, EXIT_BOUND);
                proc.output.should.match(s.cause);
                proc.output.should.match(/Failed to start server/);
                should(code).equal(1);
            });
        });
    });

    it("AC-4: the editor API fails to start (the state of the runtime is not failed): exit 1", async function() {
        const proc = await launch({
            editor: true,
            pre: `require(${JSON.stringify(EDITOR_API)}).start = () => Promise.reject(new Error("editor registration failed on purpose"));`
        });
        const code = await exitsWithin(proc, EXIT_BOUND);
        proc.output.should.match(/editor registration failed on purpose/);
        should(code).equal(1);
    });

    describe("AC-5: the log of any value of the rejection does not throw", function() {
        const values = [
            { name: "undefined", expr: "undefined" },
            { name: "null", expr: "null" },
            { name: "a string", expr: `"text"` },
            { name: "a number", expr: "42" },
            { name: "an object whose stack getter throws", expr: `{ get stack() { throw new Error("stack getter throws") } }` },
            // R67-1: util.inspect reads the stack of an Error, so this one needs more than the plain object above
            { name: "an Error whose stack getter throws", expr: `(() => { const e = new Error("m"); Object.defineProperty(e, "stack", { get() { throw new Error("x") } }); return e })()` },
            { name: "a Proxy whose get throws", expr: `new Proxy({}, { get() { throw new Error("proxy get throws") } })` },
            // #63 (B4-AC-6): RED.log.error(Symbol()) throws after the header was logged: the header must not be written twice
            { name: "a Symbol", expr: `Symbol("s")` },
            { name: "a Symbol without a description", expr: `Symbol()` }
        ];
        values.forEach(v => {
            it("AC-5 (#63 B4-AC-6): rejection with " + v.name + ": exit 1, the header once, no Uncaught Exception", async function() {
                const proc = await launch({ pre: rejectCoordination(v.expr) });
                const code = await exitsWithin(proc, EXIT_BOUND);
                proc.output.should.match(/Failed to start server/);
                // #63 B4-AC-6: the header of the failure appears exactly once
                (proc.output.match(/Failed to start server/g) || []).should.have.length(1);
                proc.output.should.not.match(/Uncaught Exception/);
                // R67-3: the planned stop happened
                proc.output.should.match(/Stopping Node-RED \(startup-error\)/);
                should(code).equal(1);
            });
        });
    });

    it("AC-5 (R67-2): a synchronous throw in the handler of a resolved start (uiPort out of range) ends the process with 1 after the planned stop", async function() {
        const proc = await launch({ port: 99999 });
        const code = await exitsWithin(proc, EXIT_BOUND);
        proc.output.should.match(/Failed to start server/);
        proc.output.should.match(/ERR_SOCKET_BAD_PORT/);
        proc.output.should.match(/Stopping Node-RED \(startup-error\)/);
        proc.output.should.not.match(/Uncaught Exception/);
        should(code).equal(1);
    });

    it("AC-6: a rejected RED.stop after the failed start is logged as Shutdown failed and the exit code is 1", async function() {
        const proc = await launch({
            pre: rejectCoordination(COORDINATION_ERROR) +
                `\nrequire(${JSON.stringify(RED_LIB)}).stop = function() { return Promise.reject(new Error("stop failed on purpose")) };`
        });
        const code = await exitsWithin(proc, EXIT_BOUND);
        should(code).equal(1);
        proc.output.should.match(/Failed to start server/);
        proc.output.should.match(/Shutdown failed: stop failed on purpose/);
        proc.output.should.not.match(/Uncaught Exception/);
    });

    describe("#63 B4-AC-7: a RED.stop that rejects with a value that cannot be printed as usual", function() {
        const values = [
            { name: "an object without a prototype", expr: "Object.create(null)" },
            { name: "a Proxy whose get throws", expr: `new Proxy({}, { get() { throw new Error("proxy get throws") } })` }
        ];
        values.forEach(v => {
            it("B4-AC-7: " + v.name + ": Shutdown failed is logged, exit 1, no Uncaught Exception", async function() {
                const proc = await launch({
                    pre: rejectCoordination(COORDINATION_ERROR) +
                        `\nrequire(${JSON.stringify(RED_LIB)}).stop = function() { return Promise.reject(${v.expr}) };`
                });
                const code = await exitsWithin(proc, EXIT_BOUND);
                should(code).equal(1);
                proc.output.should.match(/Failed to start server/);
                proc.output.should.match(/Shutdown failed:/);
                proc.output.should.not.match(/Uncaught Exception/);
            });
        });
    });

    it("AC-7: a RED.stop that never finishes is cut off after 5000 ms: exit 1 and Shutdown failed", async function() {
        const proc = await launch({ pre: rejectCoordination(COORDINATION_ERROR) + "\n" + HANGING_STOP });
        await waitFor(() => lines(proc.marker).indexOf("stop") !== -1, EXIT_BOUND, "RED.stop was not called after the failed start; output:\n" + proc.output);
        const stopSeen = Date.now();
        const code = await exitsWithin(proc, EXIT_BOUND);
        const elapsed = Date.now() - stopSeen;
        should(code).equal(1);
        elapsed.should.be.within(4500, EXIT_BOUND);
        proc.output.should.match(/Shutdown failed:/);
    });

    it("AC-8: the failed start does not run the preShutdown hook and does not wait for shutdownTimeout or unreadyGrace", async function() {
        const healthPort = await getFreePort();
        const hookFile = path.join(tempDir(), "hook.txt");
        const proc = await launch({
            pre: rejectCoordination(COORDINATION_ERROR),
            extra: `{
                shutdownTimeout: 60000,
                hooks: { "preShutdown.t": () => fs.appendFileSync(${JSON.stringify(hookFile)}, "hook") },
                health: { enabled: true, port: ${healthPort}, host: "127.0.0.1", unreadyGrace: 30000 }
            }`
        });
        const code = await exitsWithin(proc, EXIT_BOUND);
        should(code).equal(1);
        proc.output.should.match(/Failed to start server/);
        fs.existsSync(hookFile).should.be.false();
    });

    it("AC-9: a signal during the stop after the failed start ends the process at once with 1 and RED.stop is called once", async function() {
        const proc = await launch({ pre: rejectCoordination(COORDINATION_ERROR) + "\n" + HANGING_STOP });
        await waitFor(() => lines(proc.marker).indexOf("stop") !== -1, EXIT_BOUND, "RED.stop was not called after the failed start; output:\n" + proc.output);
        proc.child.kill("SIGTERM");
        const code = await exitsWithin(proc, 2000);
        should(code).equal(1);
        lines(proc.marker).should.eql(["stop"]);
    });

    it("AC-10: a signal before the rejection decides about the exit (code 0) and the failed start does not stop a second time", async function() {
        const proc = await launch({
            pre: `
const pending = new Promise((resolve, reject) => {
    process.once("SIGTERM", () => reject(new Error("start aborted by SIGTERM")));
});
const gate = pending.catch(() => {});
// an open handle, as a connection of a real coordination store: the process lives until the signal
setInterval(() => {}, 1000);
require(${JSON.stringify(COORDINATION)}).start = () => { fs.appendFileSync(MARKER, "coord\\n"); return pending };
require(${JSON.stringify(RED_LIB)}).stop = function() {
    fs.appendFileSync(MARKER, "stop\\n");
    return gate.then(() => new Promise(resolve => setTimeout(resolve, 300)));
};`
        });
        await waitFor(() => lines(proc.marker).indexOf("coord") !== -1, 30000, "the start did not reach the coordination; output:\n" + proc.output);
        proc.child.kill("SIGTERM");
        const code = await exitsWithin(proc, EXIT_BOUND);
        should(code).equal(0);
        lines(proc.marker).filter(l => l === "stop").should.have.length(1);
    });

    it("AC-11: a rejected https settings function ends the process with 1", async function() {
        const proc = await launch({ extra: `{ https: () => Promise.reject(new Error("no cert")) }` });
        const code = await exitsWithin(proc, EXIT_BOUND);
        proc.output.should.match(/Failed to get https settings/);
        should(code).equal(1);
    });

    describe("AC-12: a successful start is unchanged (regression)", function() {
        it("AC-12: valid settings: ready, the process lives on, SIGTERM ends it with 0", async function() {
            const healthPort = await getFreePort();
            const proc = await launch({ extra: `{ health: { enabled: true, port: ${healthPort}, host: "127.0.0.1" } }` });
            const probes = "http://127.0.0.1:" + healthPort + "/health";
            await waitFor(async () => (await status(probes + "/ready")) === 200, 30000, "not ready; output:\n" + proc.output);
            await sleep(3000);
            (proc.child.exitCode === null && proc.child.signalCode === null).should.be.true();
            proc.output.should.not.match(/startup-error/);
            proc.output.should.not.match(/Failed to start/);
            proc.child.kill("SIGTERM");
            const code = await exitsWithin(proc, EXIT_BOUND);
            should(code).equal(0);
        });

        it("AC-12: a flow with a node of an unknown type: failed state, live 200, ready 503, the admin API answers, the process lives on", async function() {
            const healthPort = await getFreePort();
            const proc = await launch({
                extra: `{ health: { enabled: true, port: ${healthPort}, host: "127.0.0.1" } }`,
                flows: JSON.stringify([
                    { id: "t1", type: "tab", label: "t" },
                    { id: "n1", type: "no-such-type", z: "t1", wires: [] }
                ])
            });
            const probes = "http://127.0.0.1:" + healthPort + "/health";
            const base = "http://127.0.0.1:" + proc.port;
            await waitFor(async () => (await status(base + "/flows")) === 200, 30000, "the admin API does not answer; output:\n" + proc.output);
            await waitFor(() => /no-such-type/.test(proc.output), 30000, "the missing type was not reported; output:\n" + proc.output);
            await sleep(3000);
            (await status(probes + "/live")).should.equal(200);
            (await status(probes + "/ready")).should.equal(503);
            (await status(base + "/flows")).should.equal(200);
            (proc.child.exitCode === null && proc.child.signalCode === null).should.be.true();
            proc.output.should.not.match(/Failed to start server/);
        });
    });

    describe("#75: a coordination plugin that rejects with a value without text on the stop", function() {
        // The plugin of a cluster whose resign rejects with undefined (`reject()`) and whose stop works;
        // the marker gets a line for every call. The plugin registry is replaced the way the other tests
        // replace a step: red.js shares the require cache with settings.js
        const PLUGINS = path.join(PACKAGES, "@node-red/runtime/lib/plugins");
        function rejectingPlugin(resignExpr) {
            return `
const testPlugin = {
    id: "test-coord",
    type: "node-red-coordination",
    start: () => Promise.resolve(),
    resign: () => { fs.appendFileSync(MARKER, "resign\\n"); return ${resignExpr}; },
    stop: () => { fs.appendFileSync(MARKER, "stop\\n"); return Promise.resolve(); },
    isLeader: () => true,
    onLeaderChange: () => function() {},
    claim: () => Promise.resolve(null)
};
const registry = require(${JSON.stringify(PLUGINS)});
registry.getPlugin = id => id === "test-coord" ? testPlugin : undefined;
registry.getPluginsByType = () => [];`;
        }

        async function startAndSignal(resignExpr) {
            const healthPort = await getFreePort();
            const proc = await launch({
                pre: rejectingPlugin(resignExpr),
                extra: `{ coordination: { plugin: "test-coord" }, health: { enabled: true, port: ${healthPort}, host: "127.0.0.1" } }`
            });
            const probes = "http://127.0.0.1:" + healthPort + "/health";
            await waitFor(async () => (await status(probes + "/ready")) === 200, 30000, "not ready; output:\n" + proc.output);
            proc.child.kill("SIGTERM");
            const code = await exitsWithin(proc, EXIT_BOUND);
            return { proc, code };
        }

        it("AC-17: SIGTERM, resign rejects with undefined: the stop goes on, exit code 0, the warning names the value, no Shutdown failed", async function() {
            const { proc, code } = await startAndSignal("Promise.reject(undefined)");
            proc.output.should.match(/Coordination: failed to resign the leadership: undefined/);
            proc.output.should.not.match(/Shutdown failed/);
            proc.output.should.not.match(/Uncaught Exception/);
            lines(proc.marker).filter(l => l === "resign").should.have.length(1);
            lines(proc.marker).filter(l => l === "stop").should.have.length(1, "the plugin was not stopped; output:\n" + proc.output);
            should(code).equal(0);
        });

        it("AC-17 (regression): SIGTERM, resign rejects with an Error: exit code 0, the warning has the text of the Error", async function() {
            const { proc, code } = await startAndSignal(`Promise.reject(new Error("resign down"))`);
            proc.output.should.match(/Coordination: failed to resign the leadership: Error: resign down/);
            proc.output.should.not.match(/Shutdown failed/);
            lines(proc.marker).filter(l => l === "stop").should.have.length(1);
            should(code).equal(0);
        });
    });
});
