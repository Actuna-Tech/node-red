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
 *   Z-15: end-to-end tests of the editor of an editor-only instance (editorOnly)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * End-to-end tests of an editor-only instance: the notification, the deploy
 * menu without Start/Stop and with a disabled "Restart Flows", the disabled
 * inject button with a tooltip, and a deployment that saves without starting.
 *
 * Like the other e2e tests these run Node-RED in a child process and drive the
 * editor in Chromium using Playwright, which is not a dependency of Node-RED.
 * Build the editor first (`npm run build`); the tests are skipped if
 * Playwright cannot be loaded.
 */
const should = require("should");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

let playwright;
try {
    playwright = require("playwright");
} catch (err) {
    try {
        playwright = require("playwright-core");
    } catch (err2) {
        playwright = null;
    }
}

const RED_JS = path.resolve(__dirname, "../../../packages/node_modules/node-red/red.js");

function testFlows() {
    return [
        { id: "t1", type: "tab", label: "Flow 1", disabled: false, info: "" },
        { id: "n1", type: "inject", z: "t1", name: "tick", props: [{ p: "payload" }], payload: "x", payloadType: "str", repeat: "1", once: true, onceDelay: 0.1, topic: "", x: 120, y: 100, wires: [["n2"]] },
        { id: "n2", type: "debug", z: "t1", name: "end", active: true, x: 320, y: 100, wires: [] },
        { id: "h1", type: "http in", z: "t1", url: "/editor-only-test", method: "get", x: 120, y: 200, wires: [["h2"]] },
        { id: "h2", type: "http response", z: "t1", statusCode: "", x: 320, y: 200, wires: [] }
    ];
}

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
        const req = http.request(url, { method, headers: Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, headers || {}) }, res => {
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
            Promise.resolve().then(check).then(ok => ok ? resolve() : retry(), retry);
            function retry() {
                if (Date.now() - start > timeout) {
                    reject(new Error(message || "timeout"));
                } else {
                    setTimeout(poll, 100);
                }
            }
        })();
    });
}

(playwright ? describe : describe.skip)("editor-only instance (e2e, Z-15)", function() {
    this.timeout(60000);
    const ctx = {};

    before(async function() {
        if (!fs.existsSync(path.resolve(__dirname, "../../../packages/node_modules/@node-red/editor-client/public/red/red.min.js"))) {
            throw new Error("Editor not built - run 'npm run build' first");
        }
        ctx.userDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-editor-only-e2e-"));
        fs.writeFileSync(path.join(ctx.userDir, "flows.json"), JSON.stringify(testFlows()));
        const healthPort = await getFreePort();
        const settings = {
            flowFile: "flows.json",
            editorOnly: true,
            runtimeState: { enabled: true, ui: true },
            deploy: { response: "started" },
            health: { enabled: true, port: healthPort, host: "127.0.0.1" },
            editorTheme: { tours: false },
            logging: { console: { level: "warn" } }
        };
        fs.writeFileSync(path.join(ctx.userDir, "settings.js"), "module.exports = " + JSON.stringify(settings));
        const port = await getFreePort();
        ctx.url = "http://127.0.0.1:" + port;
        ctx.ready = "http://127.0.0.1:" + healthPort + "/health/ready";
        ctx.server = spawn(process.execPath, [RED_JS, "-u", ctx.userDir, "-p", String(port)], { stdio: "ignore" });
        await waitFor(async () => (await request("GET", ctx.ready)).status === 200, 30000, "not ready");
        ctx.browser = await playwright.chromium.launch();
    });

    after(async function() {
        if (ctx.browser) {
            await ctx.browser.close();
        }
        if (ctx.server) {
            ctx.server.kill();
        }
        if (ctx.userDir) {
            fs.rmSync(ctx.userDir, { recursive: true, force: true });
        }
    });

    beforeEach(async function() {
        ctx.page = await ctx.browser.newPage({ viewport: { width: 1400, height: 900 } });
        ctx.pageErrors = [];
        ctx.page.on("pageerror", err => ctx.pageErrors.push(err.message));
        await ctx.page.goto(ctx.url);
        await ctx.page.waitForSelector(".red-ui-flow-node-group", { timeout: 30000 });
        const dismiss = await ctx.page.$("text=No, do not enable notifications");
        if (dismiss) {
            await dismiss.click();
        }
    });

    afterEach(async function() {
        const errors = ctx.pageErrors;
        await ctx.page.close();
        errors.should.eql([]);
    });

    it("the flows do not run: no http route, /ready 200 (loaded)", async function() {
        (await request("GET", ctx.url + "/editor-only-test")).status.should.equal(404);
        (await request("GET", ctx.ready)).status.should.equal(200);
    });

    it("shows that the flows are not run on this instance", async function() {
        await ctx.page.waitForSelector("text=Flows are not run on this instance.", { timeout: 10000 });
    });

    it("deploy menu: no Start/Stop, Restart Flows disabled with a hint", async function() {
        await ctx.page.click("#red-ui-header-button-deploy-options");
        should.not.exist(await ctx.page.$("#deploymenu-item-runtime-start"));
        should.not.exist(await ctx.page.$("#deploymenu-item-runtime-stop"));
        const reload = await ctx.page.$eval("#deploymenu-item-reload", el => ({ disabled: el.parentElement.classList.contains("disabled"), text: el.textContent }));
        reload.disabled.should.be.true();
        reload.text.should.match(/Flows are not run on this instance/);
    });

    it("the inject button is disabled with a tooltip", async function() {
        const button = await ctx.page.evaluate(() => {
            const nodeEl = document.getElementById("n1");
            const group = nodeEl.querySelector(".red-ui-flow-node-button");
            return { disabled: group.classList.contains("red-ui-flow-node-button-disabled"), title: (group.querySelector("title") || {}).textContent };
        });
        button.disabled.should.be.true();
        button.title.should.equal("Flows are not run on this instance");
    });

    it("a deployment saves the flows without starting them: {rev, started: false}", async function() {
        const current = JSON.parse((await request("GET", ctx.url + "/flows", undefined, { "Node-RED-API-Version": "v2" })).text);
        const flows = testFlows();
        flows[4].statusCode = "201";
        const res = await request("POST", ctx.url + "/flows", { rev: current.rev, flows: flows }, { "Node-RED-API-Version": "v2" });
        res.status.should.equal(200);
        const body = JSON.parse(res.text);
        body.should.have.property("rev");
        body.should.have.property("started", false);
        (await request("GET", ctx.url + "/editor-only-test")).status.should.equal(404);
        JSON.parse(fs.readFileSync(path.join(ctx.userDir, "flows.json"), "utf8"))[4].statusCode.should.equal("201");
        const state = await request("POST", ctx.url + "/flows/state", { state: "start" });
        state.status.should.equal(409);
        JSON.parse(state.text).should.have.property("code", "editor_only");
    });
});
