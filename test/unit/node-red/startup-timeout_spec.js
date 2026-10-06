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
 *   #71: integration tests of the startupTimeout setting (the limit of runtime.start()): the CLI in a
 *   child process and an embedding script
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * Runs Node-RED (`red.js`) in a child process with a settings file in which the
 * coordination never finishes its start (a stub of `coordination.start`), and
 * checks what `startupTimeout` (#71) does:
 *
 *  - with a valid value the start fails when the limit has passed, so the path of
 *    #67 runs: the ordered stop, the exit code 1 (also when nothing else keeps the
 *    process alive, which is code 0 without the setting)
 *  - without the setting, or with an invalid value, nothing changes (the process
 *    lives on); an invalid value is one warning
 *  - a signal before the limit decides about the exit (code 0), a signal after it
 *    ends the process at once with 1
 *  - a start step that completes after the limit is ignored
 *  - the embedded mode: `RED.start()` rejects and the library does not call
 *    `process.exit`
 *
 * Every test names the acceptance criterion (AC-n) of the spec of #71. "Exits in
 * time" is a race with a bound: a process that stays alive fails the assertion and
 * is killed after the test, it does not hang the run.
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

describe("startupTimeout (integration, #71)", function() {
    this.timeout(60000);
    let children = [];
    let dirs = [];

    function tempDir() {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), "nr-startuptimeout-"));
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
        dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
        children = [];
        dirs = [];
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
        const base = { flowFile: "flows.json", disableEditor: true, logging: { console: { level: "info" } } };
        const source = `
const fs = require("fs");
const MARKER = ${JSON.stringify(marker)};
${options.pre || ""}
module.exports = Object.assign(${JSON.stringify(base)}, (${options.extra || "{}"}));
`;
        fs.writeFileSync(path.join(userDir, "settings.js"), source);
        fs.writeFileSync(path.join(userDir, "flows.json"), options.flows || "[]");
        return getFreePort().then(port => {
            const startedAt = Date.now();
            const child = spawn(process.execPath, [RED_JS, "-u", userDir, "-p", String(port)], {
                stdio: ["ignore", "pipe", "pipe"]
            });
            children.push(child);
            const proc = { child, userDir, marker, port, output: "", startedAt };
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
                reject(new Error("the process is still alive " + ms + " ms after the start of the wait; output:\n" + proc.output));
            }, ms);
            child.once("exit", code => {
                clearTimeout(timer);
                resolve(code);
            });
        });
    }

    function alive(proc) {
        return proc.child.exitCode === null && proc.child.signalCode === null;
    }

    function lines(file) {
        return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(l => l) : [];
    }

    function whenCoordinationStarted(proc) {
        return waitFor(() => lines(proc.marker).indexOf("coord") !== -1, 30000, "the start did not reach the coordination; output:\n" + proc.output);
    }

    // The start of the coordination never finishes and leaves a "coord" line in the marker
    const HANGING_COORDINATION = `require(${JSON.stringify(COORDINATION)}).start = () => { fs.appendFileSync(MARKER, "coord\\n"); return new Promise(() => {}) };`;
    // An open handle, as the connection of a real coordination store: it keeps the process alive
    const HANDLE = `setInterval(() => {}, 1000);`;
    // A RED.stop that appends "stop" to the marker and never finishes
    const HANGING_STOP = `require(${JSON.stringify(RED_LIB)}).stop = function() { fs.appendFileSync(MARKER, "stop\\n"); return new Promise(function() {}) };`;

    describe("AC-13: the embedded mode", function() {
        it("AC-13: RED.start() rejects with startup_timeout, the instance state is failed, the library does not call process.exit", async function() {
            const dir = tempDir();
            const script = path.join(dir, "embedder.js");
            fs.writeFileSync(script, `
require(${JSON.stringify(COORDINATION)}).start = () => new Promise(() => {});
const RED = require(${JSON.stringify(RED_LIB)});
let last;
RED.events.on("instance:state", s => { last = s });
RED.init({
    userDir: ${JSON.stringify(dir)},
    flowFile: "flows.json",
    startupTimeout: 500,
    disableEditor: true,
    logging: { console: { level: "off" } }
});
RED.start().then(
    () => console.log("RESOLVED"),
    e => console.log(JSON.stringify({ code: e.code, step: e.step, state: last.state, reason: last.reason, err0: last.errors && last.errors[0].code }))
).then(() => setTimeout(() => process.exit(7), 1000));
`);
            fs.writeFileSync(path.join(dir, "flows.json"), "[]");
            const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] });
            children.push(child);
            const proc = { child, output: "" };
            child.stdout.on("data", d => proc.output += d);
            child.stderr.on("data", d => proc.output += d);
            const code = await exitsWithin(proc, EXIT_BOUND);
            proc.output.should.not.match(/RESOLVED/);
            proc.output.should.containEql(JSON.stringify({ code: "startup_timeout", step: "coordination", state: "failed", reason: "startup-error", err0: "startup_timeout" }));
            // the script ends the process itself: the library did not call process.exit
            should(code).equal(7);
        });
    });

    describe("AC-14, AC-15, AC-16: the limit ends the process with 1", function() {
        it("AC-14: a coordination that never starts and keeps a handle: exit 1 after the limit and the ordered stop", async function() {
            const proc = await launch({ pre: HANDLE + "\n" + HANGING_COORDINATION, extra: `{ startupTimeout: 1500 }` });
            const code = await exitsWithin(proc, 1500 + EXIT_BOUND);
            const elapsed = Date.now() - proc.startedAt;
            proc.output.should.match(/Failed to start server/);
            proc.output.should.match(/did not complete within startupTimeout \(1500 ms\)/);
            proc.output.should.match(/waiting for: coordination/);
            proc.output.should.match(/Stopping Node-RED \(startup-error\)/);
            proc.output.should.not.match(/Uncaught Exception/);
            should(code).equal(1);
            elapsed.should.be.aboveOrEqual(1500);
        });

        [
            { name: "without probes", extra: `{ startupTimeout: 1500 }` },
            { name: "with the probes on the main server (health.enabled)", extra: `{ startupTimeout: 1500, health: { enabled: true } }` }
        ].forEach(v => {
            it("AC-15: a coordination that never starts and keeps no handle, " + v.name + ": exit 1, not 0", async function() {
                const proc = await launch({ pre: HANGING_COORDINATION, extra: v.extra });
                const code = await exitsWithin(proc, 1500 + EXIT_BOUND);
                proc.output.should.match(/Failed to start server/);
                should(code).equal(1);
            });
        });

        it("AC-16: the probes of an own port answer until the limit (live 200, ready 503), the main port is closed, then exit 1 and the probe port is closed", async function() {
            const healthPort = await getFreePort();
            const proc = await launch({
                pre: HANGING_COORDINATION,
                extra: `{ startupTimeout: 3000, health: { enabled: true, port: ${healthPort}, host: "127.0.0.1" } }`
            });
            await whenCoordinationStarted(proc);
            const probes = "http://127.0.0.1:" + healthPort + "/health";
            (await status(probes + "/live")).should.equal(200);
            (await status(probes + "/ready")).should.equal(503);
            (await refused(proc.port)).should.be.true();
            const code = await exitsWithin(proc, 3000 + EXIT_BOUND);
            proc.output.should.match(/Failed to start server/);
            should(code).equal(1);
            (await refused(healthPort)).should.be.true();
        });
    });

    describe("AC-17: without the setting or with an invalid value the process lives on (feature off)", function() {
        it("AC-17: without startupTimeout: the process lives on, no failure, no mention of the setting", async function() {
            const proc = await launch({ pre: HANDLE + "\n" + HANGING_COORDINATION });
            await whenCoordinationStarted(proc);
            await sleep(4000);
            alive(proc).should.be.true();
            proc.output.should.not.match(/Failed to start server/);
            proc.output.should.not.match(/startupTimeout/);
        });

        it("AC-17: startupTimeout: \"60000\" (a string): one warning, no limit, the process lives on", async function() {
            const proc = await launch({ pre: HANDLE + "\n" + HANGING_COORDINATION, extra: `{ startupTimeout: "60000" }` });
            await whenCoordinationStarted(proc);
            await sleep(4000);
            alive(proc).should.be.true();
            proc.output.should.not.match(/Failed to start server/);
            proc.output.should.not.match(/startupTimeout \(/);
            proc.output.should.match(/Invalid startupTimeout setting: 60000/);
            proc.output.match(/Invalid startupTimeout setting/g).should.have.length(1);
        });
    });

    describe("AC-18, AC-19: signals", function() {
        it("AC-18: a signal before the limit decides about the exit (0), the limit that fires during that stop does not stop a second time", async function() {
            const proc = await launch({
                pre: HANDLE + "\n" + HANGING_COORDINATION + `
require(${JSON.stringify(RED_LIB)}).stop = function() { fs.appendFileSync(MARKER, "stop\\n"); return new Promise(resolve => setTimeout(resolve, 3000)) };`,
                extra: `{ startupTimeout: 2000 }`
            });
            await whenCoordinationStarted(proc);
            proc.child.kill("SIGTERM");
            const code = await exitsWithin(proc, 2000 + EXIT_BOUND);
            should(code).equal(0);
            lines(proc.marker).filter(l => l === "stop").should.have.length(1);
            proc.output.should.match(/Failed to start server/);
            proc.output.should.not.match(/Stopping Node-RED \(startup-error\)/);
        });

        it("AC-19: a signal during the stop after the limit ends the process at once with 1 and RED.stop is called once", async function() {
            const proc = await launch({ pre: HANDLE + "\n" + HANGING_COORDINATION + "\n" + HANGING_STOP, extra: `{ startupTimeout: 1000 }` });
            await waitFor(() => lines(proc.marker).indexOf("stop") !== -1, 1000 + EXIT_BOUND, "RED.stop was not called after the limit; output:\n" + proc.output);
            proc.child.kill("SIGTERM");
            const code = await exitsWithin(proc, 2000);
            should(code).equal(1);
            lines(proc.marker).filter(l => l === "stop").should.have.length(1);
        });
    });

    it("AC-20: a coordination that completes after the limit is ignored: exit 1, the warning, the flows do not start", async function() {
        const proc = await launch({
            pre: `
require(${JSON.stringify(COORDINATION)}).start = () => { fs.appendFileSync(MARKER, "coord\\n"); return new Promise(resolve => setTimeout(resolve, 1500)) };
const RED = require(${JSON.stringify(RED_LIB)});
const originalStop = RED.stop;
RED.stop = function() {
    fs.appendFileSync(MARKER, "stop\\n");
    return new Promise(resolve => setTimeout(resolve, 2000)).then(() => originalStop.apply(this, arguments));
};`,
            extra: `{ startupTimeout: 1000 }`
        });
        const code = await exitsWithin(proc, 1000 + EXIT_BOUND);
        should(code).equal(1);
        proc.output.should.match(/The start step coordination completed after startupTimeout - ignored/);
        proc.output.should.not.match(/Starting flows/);
    });

    it("AC-21: a successful start with startupTimeout is unchanged: ready, the process lives on past twice the limit, SIGTERM ends it with 0 (regression)", async function() {
        const healthPort = await getFreePort();
        const proc = await launch({
            extra: `{ startupTimeout: 2000, health: { enabled: true, port: ${healthPort}, host: "127.0.0.1" } }`
        });
        const probes = "http://127.0.0.1:" + healthPort + "/health";
        await waitFor(async () => (await status(probes + "/ready")) === 200, 30000, "not ready; output:\n" + proc.output);
        await sleep(4000);
        alive(proc).should.be.true();
        proc.output.should.not.match(/startupTimeout/);
        proc.output.should.not.match(/Failed to start/);
        proc.child.kill("SIGTERM");
        const code = await exitsWithin(proc, EXIT_BOUND);
        should(code).equal(0);
    });
});
