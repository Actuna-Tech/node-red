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
 *   Z-11: integration tests of the read-only user directory (CLI)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * Runs Node-RED in a child process with a temporary HOME:
 *  - NODE_RED_READ_ONLY_USER_DIR (R-18, R-33): settings.js is not copied to
 *    ~/.node-red, nothing is written to the user directory, a deployment is
 *    rejected with 400 read_only_user_dir and the running flows are unchanged
 *  - without the variable the default settings file is copied as before
 *  - a failing copy of settings.js is a warning, not an exception
 *  - readOnlyUserDir with an absolute flowFile outside the user directory (R-40)
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

function waitForServer(url, timeout) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function check() {
            request("GET", url + "/flows").then(res => {
                if (res.status === 200) { resolve() } else { retry() }
            }, retry);
            function retry() {
                if (Date.now() - start > timeout) { reject(new Error("Node-RED did not start")) } else { setTimeout(check, 200) }
            }
        })();
    });
}

function list(dir) {
    const result = [];
    (function walk(d) {
        fs.readdirSync(d).forEach(name => {
            const p = path.join(d, name);
            result.push(path.relative(dir, p));
            if (fs.statSync(p).isDirectory()) {
                walk(p);
            }
        });
    })(dir);
    return result.sort();
}

describe("read-only user directory (integration, Z-11)", function() {
    this.timeout(60000);
    const children = [];
    const dirs = [];
    function tempDir() {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), "nr-ro-cli-"));
        dirs.push(d);
        return d;
    }
    function run(args, env) {
        const child = spawn(process.execPath, [RED_JS].concat(args), {
            stdio: ["ignore", "pipe", "pipe"],
            env: Object.assign({}, process.env, { NODE_RED_HOME: "" }, env)
        });
        child.output = "";
        child.stdout.on("data", d => child.output += d);
        child.stderr.on("data", d => child.output += d);
        children.push(child);
        return child;
    }
    function stop(child) {
        return new Promise(resolve => {
            if (child.exitCode !== null || child.signalCode !== null) {
                return resolve();
            }
            child.once("exit", () => resolve());
            child.kill("SIGTERM");
        });
    }
    after(function() {
        children.forEach(c => { if (c.exitCode === null && c.signalCode === null) { c.kill("SIGKILL") } });
        dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
    });

    it("NODE_RED_READ_ONLY_USER_DIR: settings.js not copied, nothing written, deploy rejected with read_only_user_dir", async function() {
        const home = tempDir();
        const userDir = path.join(home, ".node-red");
        fs.mkdirSync(userDir);
        const flows = [{ id: "t1", type: "tab", label: "Image" }];
        fs.writeFileSync(path.join(userDir, "flows.json"), JSON.stringify(flows));
        const before = list(home);
        const port = await getFreePort();
        const child = run(["-p", String(port)], { HOME: home, NODE_RED_READ_ONLY_USER_DIR: "true" });
        const url = "http://127.0.0.1:" + port;
        await waitForServer(url, 30000);
        const current = JSON.parse((await request("GET", url + "/flows", undefined, { "Node-RED-API-Version": "v2" })).text);
        current.flows.should.eql(flows);
        const res = await request("POST", url + "/flows", { rev: current.rev, flows: [{ id: "t2", type: "tab", label: "New" }] }, { "Node-RED-API-Version": "v2" });
        res.status.should.equal(400);
        JSON.parse(res.text).should.have.property("code", "read_only_user_dir");
        const after = JSON.parse((await request("GET", url + "/flows", undefined, { "Node-RED-API-Version": "v2" })).text);
        after.flows.should.eql(flows);
        after.rev.should.equal(current.rev);
        await stop(child);
        list(home).should.eql(before);
        child.output.should.match(/Read-only user directory/);
    });

    it("without the variable the default settings file is copied as before", async function() {
        const home = tempDir();
        const port = await getFreePort();
        const child = run(["-p", String(port)], { HOME: home, NODE_RED_READ_ONLY_USER_DIR: "" });
        const url = "http://127.0.0.1:" + port;
        await waitForServer(url, 30000);
        await stop(child);
        const defaultSettings = path.resolve(__dirname, "../../../packages/node_modules/node-red/settings.js");
        const stat = fs.statSync(defaultSettings);
        if (stat.mtime.getTime() <= stat.ctime.getTime()) {
            fs.existsSync(path.join(home, ".node-red", "settings.js")).should.be.true();
        }
        fs.existsSync(path.join(home, ".node-red", "package.json")).should.be.true();
    });

    it("a failing copy of settings.js is a warning, not an exception", async function() {
        const home = tempDir();
        // ~/.node-red is a file: the copy fails
        fs.writeFileSync(path.join(home, ".node-red"), "");
        const port = await getFreePort();
        const child = run(["-p", String(port)], { HOME: home, NODE_RED_READ_ONLY_USER_DIR: "" });
        await new Promise(resolve => {
            const timer = setTimeout(resolve, 5000);
            child.once("exit", () => { clearTimeout(timer); resolve() });
        });
        await stop(child);
        child.output.should.match(/Could not copy the default settings file/);
        child.output.should.not.match(/at Object\.copySync|ENOTDIR: not a directory, (copyfile|mkdir|open)[^\n]*\n\s+at /);
    });

    it("readOnlyUserDir with an absolute flowFile outside the user directory rejects the deploy (R-40)", async function() {
        const userDir = tempDir();
        const dataDir = tempDir();
        const flowFile = path.join(dataDir, "flows.json");
        const flows = [{ id: "t1", type: "tab", label: "Data" }];
        fs.writeFileSync(flowFile, JSON.stringify(flows));
        fs.writeFileSync(path.join(userDir, "settings.js"), "module.exports = " + JSON.stringify({
            flowFile: flowFile,
            disableEditor: true,
            readOnlyUserDir: true,
            logging: { console: { level: "off" } }
        }));
        const beforeUser = list(userDir);
        const port = await getFreePort();
        const child = run(["-u", userDir, "-p", String(port)], {});
        const url = "http://127.0.0.1:" + port;
        await waitForServer(url, 30000);
        const current = JSON.parse((await request("GET", url + "/flows", undefined, { "Node-RED-API-Version": "v2" })).text);
        const res = await request("POST", url + "/flows", { rev: current.rev, flows: [] }, { "Node-RED-API-Version": "v2" });
        res.status.should.equal(400);
        JSON.parse(res.text).should.have.property("code", "read_only_user_dir");
        await stop(child);
        JSON.parse(fs.readFileSync(flowFile, "utf8")).should.eql(flows);
        list(dataDir).should.eql(["flows.json"]);
        list(userDir).should.eql(beforeUser);
    });
});
