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
 *   #73: integration tests of a stop during the start (a stop abandons the start attempt): the CLI in a
 *   child process (signals, the drain of the shutdown) and an embedding script
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * Runs Node-RED (`red.js`) in a child process with a settings file in which the
 * coordination does not finish its start (a stub of `coordination.start`), and
 * checks what a stop during the start does (#73):
 *
 *  - the embedded mode: `RED.stop()` makes `RED.start()` reject with `startup_stopped` at once, with or
 *    without `startupTimeout`; the process ends by itself (no timer of the limit holds it) - AC-18
 *  - the CLI: a signal during the start ends the process with 0, the log names the step the start waited
 *    for, there is no "Failed to start server" - AC-19
 *  - the drain of the shutdown (`shutdownTimeout` + `preShutdown`): a step that completes during the
 *    drain does not start the flows - AC-20; the signal during the stop of a signal ends the process - AC-21, AC-25
 *
 * Every test names the acceptance criterion (AC-n) of the spec of #73. The limits are far above the time
 * the start needs to reach the coordination (the #71 lesson: about 0.5 s on a quiet machine, much more under
 * nyc or on a loaded CI runner) and the tests wait for marker files, not for fixed times.
 * "Exits in time" is a race with a bound: a process that stays alive fails the assertion and is killed after
 * the test, it does not hang the run.
 */
const should = require("should");
const path = require("path");
const os = require("os");
const fs = require("fs");
const net = require("net");
const { spawn } = require("child_process");

const PACKAGES = path.resolve(__dirname, "../../../packages/node_modules");
const RED_JS = path.join(PACKAGES, "node-red/red.js");
const RED_LIB = path.join(PACKAGES, "node-red/lib/red.js");
const COORDINATION = path.join(PACKAGES, "@node-red/runtime/lib/coordination");

const EXIT_BOUND = 10000;
// a limit of startupTimeout that does not fire before the test sends its signal, however slow the start is
const LIMIT = 6000;
// the start of the process the embedding script uses: far above everything the test waits for
const EMBEDDER_LIMIT = 60000;

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

describe("stop during the start (integration, #73)", function() {
    this.timeout(60000);
    let children = [];
    let dirs = [];

    function tempDir() {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), "nr-startupstop-"));
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

    function lines(file) {
        return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(l => l) : [];
    }

    function whenCoordinationStarted(proc) {
        return waitFor(() => lines(proc.marker).indexOf("coord") !== -1, 30000, "the start did not reach the coordination; output:\n" + proc.output);
    }

    function count(text, part) {
        return text.split(part).length - 1;
    }

    // The start of the coordination never finishes and leaves a "coord" line in the marker
    const HANGING_COORDINATION = `require(${JSON.stringify(COORDINATION)}).start = () => { fs.appendFileSync(MARKER, "coord\\n"); return new Promise(() => {}) };`;
    // An open handle, as the connection of a real coordination store: it keeps the process alive
    const HANDLE = `setInterval(() => {}, 1000);`;
    // A RED.stop that appends "stop" to the marker and then does what it did before
    const COUNTING_STOP = `
const REDLIB = require(${JSON.stringify(RED_LIB)});
const originalStop = REDLIB.stop;
REDLIB.stop = function() { fs.appendFileSync(MARKER, "stop\\n"); return originalStop.apply(this, arguments) };`;

    describe("AC-18: the embedded mode", function() {
        [
            { name: "with startupTimeout", limit: `startupTimeout: ${EMBEDDER_LIMIT},` },
            { name: "without startupTimeout", limit: "" }
        ].forEach(v => {
            it("AC-18: RED.stop() during a start that hangs, " + v.name + ": RED.start() rejects startup_stopped at once, the states are starting,stopping,stopped, the process ends by itself with 0", async function() {
                const dir = tempDir();
                const marker = path.join(dir, "marker.log");
                const script = path.join(dir, "embedder.js");
                fs.writeFileSync(script, `
const fs = require("fs");
const RED = require(${JSON.stringify(RED_LIB)});
// the coordination does not finish its start and holds no handle; a timer that fires once runs the stop
require(${JSON.stringify(COORDINATION)}).start = () => {
    fs.appendFileSync(${JSON.stringify(marker)}, "coord\\n");
    setTimeout(() => {
        RED.stop("app-stop").then(() => console.log("STOPPED " + states.join(",")));
    }, 300);
    return new Promise(() => {});
};
const states = [];
RED.init({
    userDir: ${JSON.stringify(dir)},
    flowFile: "flows.json",
    ${v.limit}
    disableEditor: true,
    logging: { console: { level: "off" } }
});
RED.events.on("instance:state", s => states.push(s.state));
RED.start().then(
    () => console.log("RESOLVED"),
    e => console.log(JSON.stringify({ code: e.code, step: e.step, reason: e.reason }))
);
`);
                fs.writeFileSync(path.join(dir, "flows.json"), "[]");
                const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] });
                children.push(child);
                const proc = { child, output: "", marker };
                child.stdout.on("data", d => proc.output += d);
                child.stderr.on("data", d => proc.output += d);
                await whenCoordinationStarted(proc);
                const code = await exitsWithin(proc, EXIT_BOUND);
                proc.output.should.containEql(JSON.stringify({ code: "startup_stopped", step: "coordination", reason: "app-stop" }));
                proc.output.should.containEql("STOPPED starting,stopping,stopped");
                proc.output.should.not.match(/RESOLVED/);
                // the script does not call process.exit: nothing keeps the process alive after the stop
                should(code).equal(0);
            });
        });
    });

    describe("AC-19: a signal during a start that hangs (CLI)", function() {
        [
            { name: "without startupTimeout", extra: "{}" },
            { name: "with startupTimeout", extra: `{ startupTimeout: ${LIMIT} }` }
        ].forEach(v => {
            it("AC-19: SIGTERM, " + v.name + ": exit 0, the log names the step, no failed-start message", async function() {
                const proc = await launch({ pre: HANDLE + "\n" + HANGING_COORDINATION, extra: v.extra });
                await whenCoordinationStarted(proc);
                proc.child.kill("SIGTERM");
                const code = await exitsWithin(proc, EXIT_BOUND);
                proc.output.should.containEql("The start was stopped (SIGTERM) before it completed - waiting for: coordination");
                proc.output.should.containEql("Stopping Node-RED (SIGTERM)");
                proc.output.should.not.match(/Failed to start server/);
                proc.output.should.not.match(/did not complete within startupTimeout/);
                proc.output.should.not.match(/Uncaught Exception/);
                should(code).equal(0);
            });
        });
    });

    describe("AC-20: the drain of the shutdown", function() {
        it("AC-20: a coordination that completes during the preShutdown drain: the start is already abandoned, the flows do not start, exit 0", async function() {
            const proc = await launch({
                pre: HANDLE + `
require(${JSON.stringify(COORDINATION)}).start = () => {
    fs.appendFileSync(MARKER, "coord\\n");
    return new Promise(resolve => setTimeout(resolve, 1500));
};`,
                extra: `{ shutdownTimeout: 8000, hooks: { "preShutdown.t": () => new Promise(resolve => setTimeout(resolve, 3000)) } }`
            });
            await whenCoordinationStarted(proc);
            proc.child.kill("SIGTERM");
            const code = await exitsWithin(proc, EXIT_BOUND);
            proc.output.should.containEql("The start was stopped (SIGTERM)");
            proc.output.should.containEql("The start step coordination completed after the stop - ignored");
            proc.output.should.not.match(/Starting flows/);
            proc.output.should.not.match(/Failed to start server/);
            should(code).equal(0);
        });
    });

    describe("AC-25: a second signal during the drain", function() {
        it("AC-25: the drain is cut short, exit 0, RED.stop once, the warning once, no failed-start message", async function() {
            const proc = await launch({
                pre: HANDLE + "\n" + HANGING_COORDINATION + "\n" + COUNTING_STOP,
                extra: `{ shutdownTimeout: 8000, hooks: { "preShutdown.t": () => new Promise(resolve => setTimeout(resolve, 6000)) } }`
            });
            await whenCoordinationStarted(proc);
            proc.child.kill("SIGTERM");
            await waitFor(() => proc.output.indexOf("The start was stopped (SIGTERM)") !== -1, 5000, "the signal did not abandon the start; output:\n" + proc.output);
            lines(proc.marker).filter(l => l === "stop").should.have.length(0, "RED.stop ran before the drain ended");
            proc.child.kill("SIGTERM");
            const code = await exitsWithin(proc, EXIT_BOUND);
            should(code).equal(0);
            lines(proc.marker).filter(l => l === "stop").should.have.length(1);
            count(proc.output, "The start was stopped").should.equal(1);
            proc.output.should.not.match(/Failed to start server/);
            proc.output.should.not.match(/Uncaught Exception/);
        });
    });
});
