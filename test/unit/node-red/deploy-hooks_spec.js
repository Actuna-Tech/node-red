/**
 * Copyright JS Foundation and other contributors, http://js.foundation
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
 *   Z-06 (#10): acceptance tests of the preDeploy and postDeploy hooks of the deploy pipeline - a plugin
 *   registered with RED.hooks.add in a child process rejects (400 deploy_rejected), fails (503
 *   deploy_hook_failed), hangs (503 deploy_hook_timeout) and is notified after a deployment; the guard
 *   `off_identical`: without the plugin the statuses and bodies of the same scenario are those of 5.0.7
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * Runs Node-RED in a child process (temporary user directory, editor disabled) with the plugin
 * `test-deploy-hooks` (deploy-hooks-plugin.js). The behaviour of the hooks is set with a control file
 * that the plugin reads at every call. The flow of the tests: `http in` -> `template "v1"` ->
 * `http response`, the route /hello answers "v1".
 *
 * The describe "without the plugin (off_identical)" is a guard: its expectations are those of 5.0.7 and
 * it passes on the version before the hooks as well as after.
 */
const should = require("should");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const { writePlugin, readLog } = require("./deploy-hooks-plugin");

const RED_JS = path.resolve(__dirname, "../../../packages/node_modules/node-red/red.js");
const V2 = { "Node-RED-API-Version": "v2" };

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

function request(method, url, body, headers) {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? "" : JSON.stringify(body);
        const req = http.request(url, {
            method,
            headers: Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "Connection": "close" }, headers || {})
        }, res => {
            let text = "";
            res.on("data", d => text += d);
            res.on("end", () => {
                let json;
                try {
                    json = text ? JSON.parse(text) : undefined;
                } catch (err) {
                    json = undefined;
                }
                resolve({ status: res.statusCode, text: text, json: json });
            });
        });
        req.setTimeout(20000, () => req.destroy(new Error("timeout")));
        req.on("error", reject);
        req.end(data);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(check, timeout, message) {
    const start = Date.now();
    for (;;) {
        if (await check()) {
            return;
        }
        if (Date.now() - start > timeout) {
            throw new Error(message || "timeout");
        }
        await sleep(50);
    }
}

// tab + http in + template + http response; the route answers `text`
function helloFlow(tab, route, text) {
    return [
        { id: tab, type: "tab", label: "Flow " + route },
        { id: tab + "-in", type: "http in", z: tab, url: "/" + route, method: "get", wires: [[tab + "-tpl"]] },
        { id: tab + "-tpl", type: "template", z: tab, field: "payload", fieldType: "msg", syntax: "plain", template: text, output: "str", wires: [[tab + "-out"]] },
        { id: tab + "-out", type: "http response", z: tab, statusCode: "", wires: [] }
    ];
}
// nodes of a flow for the single-flow api (no tab, no z)
function helloNodes(prefix, route, text) {
    return helloFlow("x", route, text).slice(1).map(n => {
        const copy = JSON.parse(JSON.stringify(n).split("x-").join(prefix + "-"));
        delete copy.z;
        return copy;
    });
}
const injectNode = (id, z) => ({ id: id, type: "inject", z: z, name: "forbidden", props: [], repeat: "", crontab: "", once: false, topic: "", wires: [[]] });

describe("deploy hooks preDeploy and postDeploy (acceptance, Z-06)", function() {
    this.timeout(120000);
    const children = [];
    const dirs = [];

    after(function() {
        children.forEach(c => { if (c.exitCode === null && c.signalCode === null) { c.kill("SIGKILL") } });
        dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
    });

    // options: {plugin: boolean, deploy: object}
    async function startServer(options) {
        options = options || {};
        const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-deploy-hooks-"));
        const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-deploy-hooks-log-"));
        dirs.push(userDir, logDir);
        const flowFile = path.join(userDir, "flows.json");
        fs.writeFileSync(flowFile, JSON.stringify(helloFlow("t1", "hello", "v1")));
        const controlFile = path.join(logDir, "control.json");
        fs.writeFileSync(controlFile, "{}");
        if (options.plugin) {
            writePlugin(userDir);
        }
        const settings = {
            flowFile: "flows.json",
            disableEditor: true,
            logging: { console: { level: "off" } },
            deploy: options.deploy || {}
        };
        fs.writeFileSync(path.join(userDir, "settings.js"), "module.exports = " + JSON.stringify(settings));
        const port = await getFreePort();
        const url = "http://127.0.0.1:" + port;
        const child = spawn(process.execPath, [RED_JS, "-u", userDir, "-p", String(port)], {
            stdio: "ignore",
            env: Object.assign({}, process.env, { HOOK_CONTROL_FILE: controlFile, HOOK_LOG_DIR: logDir })
        });
        children.push(child);
        await waitFor(async () => {
            try {
                return (await request("GET", url + "/hello")).text === "v1";
            } catch (err) {
                return false;
            }
        }, 30000, "Node-RED did not start");
        return {
            url: url,
            userDir: userDir,
            logDir: logDir,
            flowFile: flowFile,
            child: child,
            control: function(settingsOfPlugin) { fs.writeFileSync(controlFile, JSON.stringify(settingsOfPlugin)) },
            file: function() {
                return { content: fs.readFileSync(flowFile, "utf8"), mtimeMs: fs.statSync(flowFile).mtimeMs };
            },
            flows: async function() { return (await request("GET", url + "/flows", undefined, V2)).json },
            hello: async function() { return (await request("GET", url + "/hello")).text },
            // In the default mode a deployment answers before the new flows start: the route may be
            // missing for a moment after an accepted deployment, so the tests wait for the text
            expectRoute: async function(route, text) {
                await waitFor(async () => (await request("GET", url + "/" + route)).text === text, 10000, "the route /" + route + " does not answer " + text);
            },
            log: function(name) { return readLog(logDir, name) }
        };
    }

    describe("without the plugin (off_identical: the statuses and bodies of 5.0.7)", function() {
        let server;
        before(async function() {
            server = await startServer({ plugin: false });
        });

        it("the same scenario gives the statuses and the bodies of the version before the hooks", async function() {
            const url = server.url;
            const current = await server.flows();
            current.should.have.property("rev");
            // POST /flows v2: a new flow
            let res = await request("POST", url + "/flows", { rev: current.rev, flows: current.flows.concat(helloFlow("t2", "second", "v2")) }, V2);
            res.status.should.equal(200);
            Object.keys(res.json).should.eql(["rev"]);
            await server.expectRoute("second", "v2");
            // the stale revision
            res = await request("POST", url + "/flows", { rev: current.rev, flows: current.flows }, V2);
            res.status.should.equal(409);
            res.json.should.have.property("code", "version_mismatch");
            // POST /flow (v1): 200 {id}
            res = await request("POST", url + "/flow", { label: "added", nodes: helloNodes("a", "added", "va") });
            res.status.should.equal(200);
            Object.keys(res.json).should.eql(["id"]);
            const id = res.json.id;
            await server.expectRoute("added", "va");
            // PUT /flow/:id (v1): 200 {id}
            res = await request("PUT", url + "/flow/" + id, { label: "added", nodes: helloNodes("a", "added", "vb") });
            res.status.should.equal(200);
            res.json.should.eql({ id: id });
            await server.expectRoute("added", "vb");
            // the rejected requests of the single-flow api: the same codes as before
            res = await request("PUT", url + "/flow/missing", { label: "m", nodes: [] });
            res.status.should.equal(404);
            res.json.should.have.property("code", "not_found");
            res = await request("DELETE", url + "/flow/global");
            res.status.should.equal(400);
            res.json.should.have.property("message", "not allowed to remove global");
            res = await request("DELETE", url + "/flow/missing");
            res.status.should.equal(404);
            // DELETE /flow/:id: 204
            res = await request("DELETE", url + "/flow/" + id);
            res.status.should.equal(204);
            await waitFor(async () => (await request("GET", url + "/added")).status === 404, 5000, "the flow was not removed");
            // reload: v1 204, v2 200 {rev}
            res = await request("POST", url + "/flows", undefined, { "Node-RED-Deployment-Type": "reload" });
            res.status.should.equal(204);
            res = await request("POST", url + "/flows", undefined, Object.assign({ "Node-RED-Deployment-Type": "reload" }, V2));
            res.status.should.equal(200);
            Object.keys(res.json).should.eql(["rev"]);
            // the original flow still answers
            await server.expectRoute("hello", "v1");
        });
    });

    describe("with the plugin", function() {
        let server;
        before(async function() {
            server = await startServer({ plugin: true, deploy: { hookTimeout: 5000 } });
        });
        afterEach(function() {
            server.control({});
        });

        function assertNothingChanged(before, message) {
            const after = server.file();
            after.content.should.equal(before.content, message);
            after.mtimeMs.should.equal(before.mtimeMs, message);
        }
        function assertRejected(res, extra) {
            res.status.should.equal(400);
            res.json.should.have.property("code", "deploy_rejected");
            res.json.should.have.property("reason", "forbidden_node");
            res.json.should.have.property("message");
            res.json.details.should.be.an.Object();
            Object.keys(res.json).sort().should.eql(["code", "details", "message", "reason"]);
        }

        it("the plugin was loaded: the validator is called for an accepted deployment (the default is acceptance)", async function() {
            const before = server.log("pre.log").length;
            const current = await server.flows();
            const res = await request("POST", server.url + "/flows", { rev: current.rev, flows: current.flows }, V2);
            res.status.should.equal(200);
            const calls = server.log("pre.log").slice(before);
            calls.should.have.length(1);
            calls[0].should.containEql({ type: "full", source: "api", operation: "setFlows", mode: "accept" });
        });

        it("POST /flows v2: a forbidden node is rejected with 400 deploy_rejected, reason and details; the file and the route are unchanged", async function() {
            const current = await server.flows();
            server.control({ pre: "forbidden" });
            const before = server.file();
            const res = await request("POST", server.url + "/flows", { rev: current.rev, flows: current.flows.concat(helloFlow("t9", "nine", "v9"), [injectNode("bad1", "t9")]) }, V2);
            assertRejected(res);
            res.json.details.should.eql({ nodes: ["bad1"] });
            res.json.message.should.equal("forbidden node type: inject");
            assertNothingChanged(before);
            await server.expectRoute("hello", "v1");
            (await request("GET", server.url + "/nine")).status.should.equal(404);
            // the v1 api answers the same
            const v1 = await request("POST", server.url + "/flows", current.flows.concat([injectNode("bad1", "t1")]));
            assertRejected(v1);
            assertNothingChanged(before);
        });

        it("POST /flow: a flow with a forbidden node is rejected; nothing is saved", async function() {
            server.control({ pre: "forbidden" });
            const before = server.file();
            const nodes = helloNodes("f", "flowroute", "vf").concat([injectNode("bad2")]);
            const res = await request("POST", server.url + "/flow", { label: "forbidden", nodes: nodes });
            assertRejected(res);
            res.json.details.should.eql({ nodes: ["bad2"] });
            assertNothingChanged(before);
            (await request("GET", server.url + "/flowroute")).status.should.equal(404);
            server.log("pre.log").pop().should.containEql({ type: "flows", operation: "addFlow", mode: "forbidden" });
        });

        it("PUT /flow/:id: an update with a forbidden node is rejected; the flow keeps answering", async function() {
            server.control({ pre: "forbidden" });
            const before = server.file();
            const nodes = helloNodes("t1", "hello", "changed").concat([injectNode("bad3")]);
            const res = await request("PUT", server.url + "/flow/t1", { label: "Flow hello", nodes: nodes });
            assertRejected(res);
            assertNothingChanged(before);
            await server.expectRoute("hello", "v1");
            const last = server.log("pre.log").pop();
            last.should.containEql({ type: "flows", operation: "updateFlow", flowId: "t1" });
        });

        it("DELETE /flow/:id: a rejected deletion keeps the flow", async function() {
            server.control({ pre: "reject" });
            const before = server.file();
            const res = await request("DELETE", server.url + "/flow/t1");
            assertRejected(res);
            res.json.details.should.eql({ operation: "deleteFlow" });
            assertNothingChanged(before);
            await server.expectRoute("hello", "v1");
        });

        it("a rejected request of the single-flow api that fails earlier (404) never reaches the validator", async function() {
            server.control({ pre: "reject" });
            const calls = server.log("pre.log").length;
            const res = await request("DELETE", server.url + "/flow/missing");
            res.status.should.equal(404);
            res.json.should.have.property("code", "not_found");
            const stale = await request("POST", server.url + "/flows", { rev: "stale", flows: [] }, V2);
            stale.status.should.equal(409);
            server.log("pre.log").length.should.equal(calls);
        });

        it("a failure of the validator is 503 deploy_hook_failed without the text of the error; nothing is saved", async function() {
            server.control({ pre: "fail" });
            const current = await server.flows();
            const before = server.file();
            const res = await request("POST", server.url + "/flows", { rev: current.rev, flows: current.flows }, V2);
            res.status.should.equal(503);
            Object.keys(res.json).sort().should.eql(["code", "message"]);
            res.json.should.have.property("code", "deploy_hook_failed");
            res.text.should.not.containEql("secret-detail");
            res.text.should.not.containEql("TypeError");
            res.text.should.not.containEql("exploded");
            assertNothingChanged(before);
            await server.expectRoute("hello", "v1");
            const flow = await request("PUT", server.url + "/flow/t1", { label: "Flow hello", nodes: helloNodes("t1", "hello", "v1") });
            flow.status.should.equal(503);
            flow.json.should.have.property("code", "deploy_hook_failed");
        });

        it("a reload after an external change of the file to a forbidden flow is rejected; the file is as the test wrote it, the route still answers v1", async function() {
            server.control({ pre: "forbidden" });
            const forbidden = helloFlow("t1", "hello", "from the file").concat([injectNode("bad4", "t1")]);
            fs.writeFileSync(server.flowFile, JSON.stringify(forbidden));
            const before = server.file();
            const calls = server.log("pre.log").length;
            const res = await request("POST", server.url + "/flows", undefined, Object.assign({ "Node-RED-Deployment-Type": "reload" }, V2));
            assertRejected(res);
            res.json.details.should.eql({ nodes: ["bad4"] });
            assertNothingChanged(before);
            await server.expectRoute("hello", "v1");
            const last = server.log("pre.log").slice(calls).pop();
            last.should.containEql({ type: "reload", operation: "setFlows", mode: "forbidden" });
            // an accepted reload deploys the file
            server.control({ pre: "accept" });
            fs.writeFileSync(server.flowFile, JSON.stringify(helloFlow("t1", "hello", "v1")));
            (await request("POST", server.url + "/flows", undefined, Object.assign({ "Node-RED-Deployment-Type": "reload" }, V2))).status.should.equal(200);
        });
    });

    describe("a validator that does not finish (deploy.hookTimeout)", function() {
        it("503 deploy_hook_timeout after the limit, the next deployment at once; after the late call ended a deployment goes through", async function() {
            const server = await startServer({ plugin: true, deploy: { hookTimeout: 1000 } });
            server.control({ pre: "hang" });
            const current = await server.flows();
            const before = server.file();
            const body = { rev: current.rev, flows: current.flows.concat(helloFlow("t5", "five", "v5")) };
            let started = Date.now();
            let res = await request("POST", server.url + "/flows", body, V2);
            const first = Date.now() - started;
            res.status.should.equal(503);
            Object.keys(res.json).sort().should.eql(["code", "message"]);
            res.json.should.have.property("code", "deploy_hook_timeout");
            first.should.be.aboveOrEqual(900);
            first.should.be.below(10000);
            // the late call still runs: the next deployment is answered at once, without calling the validator
            const calls = server.log("pre.log").filter(l => !l.late).length;
            started = Date.now();
            res = await request("POST", server.url + "/flows", body, V2);
            const second = Date.now() - started;
            res.status.should.equal(503);
            res.json.should.have.property("code", "deploy_hook_timeout");
            // at once: much sooner than the limit (a validator that was called again would take 1000 ms)
            second.should.be.below(700);
            server.log("pre.log").filter(l => !l.late).length.should.equal(calls);
            const after = server.file();
            after.content.should.equal(before.content);
            after.mtimeMs.should.equal(before.mtimeMs);
            await server.expectRoute("hello", "v1");
            // the validator accepts, its late call ends, the deployment goes through
            server.control({ pre: "accept" });
            await waitFor(async () => server.log("pre.log").some(l => l.late === "ended"), 5000, "the late call did not end");
            res = await request("POST", server.url + "/flows", body, V2);
            res.status.should.equal(200);
            await server.expectRoute("five", "v5");
        });
    });

    describe("postDeploy", function() {
        it("the handler gets source api, the revision of the response and start.status; a slow handler does not delay the response", async function() {
            const server = await startServer({ plugin: true });
            const current = await server.flows();
            let res = await request("POST", server.url + "/flows", { rev: current.rev, flows: current.flows.concat(helloFlow("t6", "six", "v6")) }, V2);
            res.status.should.equal(200);
            const rev = res.json.rev;
            await waitFor(async () => server.log("post.log").length >= 1, 5000, "postDeploy was not called");
            const first = server.log("post.log")[0];
            first.should.containEql({ source: "api", rev: rev, type: "full", operation: "setFlows", status: "pending" });
            // a slow handler (2 s): the answer comes at once, the note a little later
            server.control({ post: "slow" });
            const started = Date.now();
            const current2 = await server.flows();
            res = await request("POST", server.url + "/flows", { rev: current2.rev, flows: current2.flows.concat(helloFlow("t7", "seven", "v7")) }, V2);
            const elapsed = Date.now() - started;
            res.status.should.equal(200);
            elapsed.should.be.below(1500);
            server.log("post.log").should.have.length(1);
            await waitFor(async () => server.log("post.log").length >= 2, 8000, "the slow postDeploy did not finish");
            const second = server.log("post.log")[1];
            second.should.containEql({ source: "api", rev: res.json.rev, status: "pending" });
            second.at.should.be.aboveOrEqual(started + 1900);
            // the single-flow api: the operation and the flow
            server.control({});
            res = await request("POST", server.url + "/flow", { label: "added", nodes: helloNodes("a", "added", "va") }, V2);
            res.status.should.equal(201);
            await waitFor(async () => server.log("post.log").length >= 3, 5000, "postDeploy of /flow was not called");
            server.log("post.log")[2].should.containEql({ source: "api", type: "flows", operation: "addFlow", flowId: res.json.id, rev: (await server.flows()).rev });
        });

        it("a rejected deployment has no postDeploy", async function() {
            const server = await startServer({ plugin: true });
            server.control({ pre: "reject" });
            const current = await server.flows();
            const res = await request("POST", server.url + "/flows", { rev: current.rev, flows: current.flows }, V2);
            res.status.should.equal(400);
            await sleep(500);
            server.log("post.log").should.have.length(0);
        });
    });
});
