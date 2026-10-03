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
 *   P-01: integration test of deploy.response "started" - the http in endpoint of a
 *   deployed flow answers straight after the deploy response
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * Runs Node-RED in a child process (temporary user directory, editor disabled)
 * with `deploy.response: "started"` and calls the http in endpoint of a newly
 * deployed flow straight after the Admin API response.
 *
 * The default mode is not tested here: whether the endpoint exists right after
 * the response depends on timing (a test would be unreliable); the unit tests
 * of flows/index.js check the order instead.
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

function httpFlow(tab, route) {
    return [
        { id: tab, type: "tab", label: "Flow " + route },
        { id: tab + "-in", type: "http in", z: tab, url: "/" + route, method: "get", wires: [[tab + "-out"]] },
        { id: tab + "-out", type: "http response", z: tab, statusCode: "200", wires: [] }
    ];
}

describe("deploy.response started (integration, P-01)", function() {
    this.timeout(60000);
    let server;
    let userDir;
    let url;

    before(async function() {
        userDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-deploy-response-"));
        fs.writeFileSync(path.join(userDir, "flows.json"), JSON.stringify(httpFlow("tStored", "stored")));
        const settings = {
            flowFile: "flows.json",
            disableEditor: true,
            logging: { console: { level: "off" } },
            deploy: { response: "started" }
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

    it("started: new http-in endpoint returns 200 immediately after POST /flows", async function() {
        const current = JSON.parse((await request("GET", url + "/flows", undefined, { "Node-RED-API-Version": "v2" })).text);
        const deploy = await request("POST", url + "/flows", { rev: current.rev, flows: current.flows.concat(httpFlow("tNew", "p01")) }, { "Node-RED-API-Version": "v2" });
        deploy.status.should.equal(200);
        JSON.parse(deploy.text).should.have.property("rev");
        (await request("GET", url + "/p01")).status.should.equal(200);
    });

    it("started: reload deploy - endpoint returns 200 immediately", async function() {
        const deploy = await request("POST", url + "/flows", undefined, { "Node-RED-API-Version": "v2", "Node-RED-Deployment-Type": "reload" });
        deploy.status.should.equal(200);
        (await request("GET", url + "/p01")).status.should.equal(200);
        (await request("GET", url + "/stored")).status.should.equal(200);
    });

    it("started: POST /flow - endpoint returns 200 immediately", async function() {
        const flow = httpFlow("ignored", "p01flow");
        const deploy = await request("POST", url + "/flow", { label: "added", nodes: flow.slice(1).map(n => { const c = Object.assign({}, n); delete c.z; return c }) });
        deploy.status.should.equal(200);
        (await request("GET", url + "/p01flow")).status.should.equal(200);
    });
});
