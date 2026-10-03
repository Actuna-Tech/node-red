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
 *   Z-04: integration test of the single-flow api (revisions, If-Match, globalConfigs,
 *   PUT creating a flow) on a running Node-RED
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * Runs Node-RED in a child process (temporary user directory, editor disabled)
 * with `deploy.putCreatesFlow: true` and goes through the single-flow api.
 */
const should = require("should");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

const RED_JS = path.resolve(__dirname, "../../../packages/node_modules/node-red/red.js");

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
            headers: Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, headers || {})
        }, res => {
            let text = "";
            res.on("data", d => text += d);
            res.on("end", () => {
                let json;
                try { json = text ? JSON.parse(text) : undefined } catch (err) { json = undefined }
                resolve({ status: res.statusCode, headers: res.headers, body: json });
            });
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
                if (res.status === 200) {
                    resolve();
                } else {
                    retry();
                }
            }, retry);
            function retry() {
                if (Date.now() - start > timeout) {
                    reject(new Error("Node-RED did not start"));
                } else {
                    setTimeout(check, 200);
                }
            }
        })();
    });
}

const V2 = { "Node-RED-API-Version": "v2" };

describe("single-flow api (integration, Z-04)", function() {
    this.timeout(60000);
    let server;
    let userDir;
    let url;

    before(async function() {
        userDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-flow-api-"));
        fs.writeFileSync(path.join(userDir, "flows.json"), JSON.stringify([
            { id: "t1", type: "tab", label: "Flow 1" },
            { id: "n1", type: "comment", z: "t1", name: "a", x: 100, y: 100, wires: [] },
            { id: "t2", type: "tab", label: "Flow 2" },
            { id: "n2", type: "comment", z: "t2", name: "b", x: 100, y: 100, wires: [] }
        ]));
        const settings = {
            flowFile: "flows.json",
            disableEditor: true,
            logging: { console: { level: "off" } },
            deploy: { putCreatesFlow: true }
        };
        fs.writeFileSync(path.join(userDir, "settings.js"), "module.exports = " + JSON.stringify(settings));
        const port = await getFreePort();
        url = "http://127.0.0.1:" + port;
        server = spawn(process.execPath, [RED_JS, "-u", userDir, "-p", String(port)], { stdio: "ignore" });
        await waitForServer(url, 30000);
    });

    after(function() {
        if (server) {
            server.kill();
        }
        if (userDir) {
            fs.rmSync(userDir, { recursive: true, force: true });
        }
    });

    it("GET v2 -> PUT with rev -> PUT with the old rev (409)", async function() {
        const v1 = await request("GET", url + "/flow/t1");
        v1.body.should.not.have.property("rev");
        const got = await request("GET", url + "/flow/t1", undefined, V2);
        got.status.should.equal(200);
        got.headers.should.have.property("etag", '"' + got.body.rev + '"');
        const flow = Object.assign({}, got.body, { label: "Flow 1b" });
        const put = await request("PUT", url + "/flow/t1", flow, V2);
        put.status.should.equal(200);
        put.body.should.have.property("rev");
        put.body.rev.should.not.equal(got.body.rev);
        const stale = await request("PUT", url + "/flow/t1", flow, V2);
        stale.status.should.equal(409);
        stale.body.should.have.property("code", "version_mismatch");
        const ifMatch = await request("PUT", url + "/flow/t1", { label: "Flow 1c", nodes: got.body.nodes }, Object.assign({ "If-Match": '"' + put.body.rev + '"' }, V2));
        ifMatch.status.should.equal(200);
        // the revision is not stored with the flow
        (await request("GET", url + "/flows")).body.filter(n => n.id === "t1")[0].should.not.have.property("rev");
    });

    it("revision of a flow does not change when another flow changes", async function() {
        const before = (await request("GET", url + "/flow/t1", undefined, V2)).body.rev;
        const t2 = (await request("GET", url + "/flow/t2", undefined, V2)).body;
        (await request("PUT", url + "/flow/t2", Object.assign(t2, { label: "Flow 2b" }), V2)).status.should.equal(200);
        (await request("GET", url + "/flow/t1", undefined, V2)).body.rev.should.equal(before);
    });

    it("PUT creates a flow under the given id and adds globalConfigs", async function() {
        const res = await request("PUT", url + "/flow/new1", {
            label: "New", layout: "TB", rev: null,
            nodes: [{ id: "nn1", type: "comment", x: 10, y: 10, wires: [] }],
            globalConfigs: [{ id: "c1", type: "comment-config-test", name: "cfg" }]
        }, V2);
        res.status.should.equal(201);
        res.body.should.have.property("id", "new1");
        const created = (await request("GET", url + "/flow/new1")).body;
        created.should.have.property("layout", "TB");
        created.nodes.map(n => n.id).should.eql(["nn1"]);
        const global = (await request("GET", url + "/flow/global")).body;
        global.configs.map(n => n.id).should.containEql("c1");
        const conflict = await request("PUT", url + "/flow/new1", { label: "New", nodes: [], globalConfigs: [{ id: "n2", type: "x" }] });
        conflict.status.should.equal(400);
        conflict.body.should.have.property("code", "duplicate_id");
    });

    it("POST /flow: 201 with a 16 hex id in v2, 200 in v1", async function() {
        const v2 = await request("POST", url + "/flow", { label: "p", nodes: [] }, V2);
        v2.status.should.equal(201);
        v2.body.id.should.match(/^[0-9a-f]{16}$/);
        v2.body.should.have.property("rev");
        const v1 = await request("POST", url + "/flow", { label: "p", nodes: [] });
        v1.status.should.equal(200);
        v1.body.should.eql({ id: v1.body.id });
    });
});
