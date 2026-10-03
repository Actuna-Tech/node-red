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
 *   P-02: end-to-end tests of the editor with out-of-date flows (editorTheme.deploy.staleFlows)
 *   and of restarting the flows when the server answers 409
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * End-to-end tests of an editor whose flows were changed elsewhere.
 *
 * Like flow_layout_e2espec.js these run Node-RED in a child process and drive
 * the editor in Chromium using Playwright, which is not a dependency of
 * Node-RED. Build the editor first (`npm run build`); the tests are skipped
 * if Playwright cannot be loaded.
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
        { id: "n1", type: "inject", z: "t1", name: "start", props: [], repeat: "", once: false, topic: "", x: 120, y: 100, wires: [["n2"]] },
        { id: "n2", type: "debug", z: "t1", name: "end", active: true, x: 320, y: 100, wires: [] }
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

function waitForServer(url, timeout) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function check() {
            http.get(url + "/settings", res => {
                res.resume();
                if (res.statusCode === 200) {
                    resolve();
                } else {
                    retry();
                }
            }).on("error", retry);
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

function request(method, url, body) {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? "" : JSON.stringify(body);
        const req = http.request(url, { method, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, res => {
            let text = "";
            res.on("data", d => text += d);
            res.on("end", () => {
                if (res.statusCode >= 300) {
                    reject(new Error(res.statusCode + ": " + text));
                    return;
                }
                try {
                    resolve(text ? JSON.parse(text) : null);
                } catch (err) {
                    reject(err);
                }
            });
        });
        req.on("error", reject);
        req.end(data);
    });
}

async function startNodeRED(editorTheme) {
    if (!fs.existsSync(path.resolve(__dirname, "../../../packages/node_modules/@node-red/editor-client/public/red/red.min.js"))) {
        throw new Error("Editor not built - run 'npm run build' first");
    }
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-stale-e2e-"));
    fs.writeFileSync(path.join(userDir, "flows.json"), JSON.stringify(testFlows()));
    const settings = { flowFile: "flows.json", editorTheme: editorTheme, logging: { console: { level: "warn" } } };
    fs.writeFileSync(path.join(userDir, "settings.js"), "module.exports = " + JSON.stringify(settings));
    const port = await getFreePort();
    const url = "http://127.0.0.1:" + port;
    const server = spawn(process.execPath, [RED_JS, "-u", userDir, "-p", String(port)], { stdio: "ignore" });
    await waitForServer(url, 30000);
    return { server, url, userDir };
}

function staleFlowsSuite(title, editorTheme, tests) {
    (playwright ? describe : describe.skip)(title, function() {
        this.timeout(60000);
        const ctx = {};

        before(async function() {
            Object.assign(ctx, await startNodeRED(editorTheme));
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
            // every test starts from the original flows
            await request("POST", ctx.url + "/flows", testFlows());
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

        tests(ctx);
    });
}

/** Change the flows on the server as another client of the Admin API would */
function changeFlowsElsewhere(url) {
    const flows = testFlows();
    flows[1].name = "changed by another client";
    return request("POST", url + "/flows", flows);
}

/**
 * Change the flows elsewhere while the editor ignores the background update
 * notification (as during its own deploy), so its next deploy is out of date
 */
async function changeFlowsElsewhereUnnoticed(page, url) {
    await page.evaluate(() => RED.deploy.setDeployInflight(true));
    await changeFlowsElsewhere(url);
    await page.waitForTimeout(500);
    await page.evaluate(() => RED.deploy.setDeployInflight(false));
}

/** Change a node in the editor and click Deploy */
async function editAndDeploy(page) {
    await page.evaluate(() => {
        const n = RED.nodes.node("n2");
        n.name = "changed in the editor";
        n.changed = true;
        n.dirty = true;
        RED.nodes.dirty(true);
    });
    await page.click("#red-ui-header-button-deploy");
}

/** The labels of the buttons of the visible modal notification */
function dialogButtons(page) {
    return page.$$eval(".red-ui-notification .ui-dialog-buttonset button", els => els.filter(el => el.offsetParent !== null).map(el => el.textContent));
}

staleFlowsSuite("editor with editorTheme.deploy.staleFlows reload-only (e2e, P-02)", { tours: false, deploy: { staleFlows: "reload-only" } }, function(ctx) {
    it("deploy after an API change shows the reload-only dialog", async function() {
        await changeFlowsElsewhereUnnoticed(ctx.page, ctx.url);
        await editAndDeploy(ctx.page);
        await ctx.page.waitForSelector("#red-ui-deploy-dialog-stale-flows");
        (await dialogButtons(ctx.page)).should.eql(["Reload flows"]);
        (await ctx.page.textContent("#red-ui-deploy-dialog-stale-flows")).should.match(/changed elsewhere/);
        should.not.exist(await ctx.page.$("#red-ui-deploy-dialog-confirm-deploy-overwrite"));
        should.not.exist(await ctx.page.$("#red-ui-deploy-dialog-confirm-deploy-merge"));
        if (process.env.STALE_FLOWS_SCREENSHOT) {
            await ctx.page.waitForTimeout(500);
            await ctx.page.screenshot({ path: process.env.STALE_FLOWS_SCREENSHOT });
        }
    });

    it("server flows unchanged after the attempt", async function() {
        await changeFlowsElsewhereUnnoticed(ctx.page, ctx.url);
        await editAndDeploy(ctx.page);
        await ctx.page.waitForSelector("#red-ui-deploy-dialog-stale-flows");
        // a forced deploy (as "Ignore & deploy" did) still carries the revision and is rejected
        await ctx.page.evaluate(() => RED.actions.invoke("core:deploy-flows", true, true));
        await ctx.page.waitForTimeout(500);
        const flows = await request("GET", ctx.url + "/flows");
        flows.find(n => n.id === "n1").name.should.equal("changed by another client");
        flows.find(n => n.id === "n2").name.should.equal("end");
    });

    it("background update shows the reload-only dialog that only a reload closes", async function() {
        await changeFlowsElsewhere(ctx.url);
        await ctx.page.waitForSelector("#red-ui-deploy-dialog-stale-flows");
        (await dialogButtons(ctx.page)).should.eql(["Reload flows"]);
        await ctx.page.keyboard.press("Escape");
        await ctx.page.waitForTimeout(300);
        (await ctx.page.isVisible("#red-ui-deploy-dialog-stale-flows")).should.be.true();
        await ctx.page.evaluate(() => RED.nodes.dirty(true));
        (await ctx.page.getAttribute("#red-ui-header-button-deploy", "class")).should.match(/disabled/);

        await Promise.all([
            ctx.page.waitForNavigation(),
            ctx.page.click("#red-ui-deploy-dialog-stale-flows-reload")
        ]);
        await ctx.page.waitForSelector(".red-ui-flow-node-group", { timeout: 30000 });
        should.not.exist(await ctx.page.$("#red-ui-deploy-dialog-stale-flows"));
        (await ctx.page.evaluate(() => RED.nodes.node("n1").name)).should.equal("changed by another client");
    });

    it("a current editor deploys without a dialog", async function() {
        await editAndDeploy(ctx.page);
        await ctx.page.waitForTimeout(800);
        should.not.exist(await ctx.page.$("#red-ui-deploy-dialog-stale-flows"));
        const flows = await request("GET", ctx.url + "/flows");
        flows.find(n => n.id === "n2").name.should.equal("changed in the editor");
    });
});

staleFlowsSuite("editor with editorTheme.deploy.staleFlows not set (e2e, P-02)", { tours: false }, function(ctx) {
    it("conflict dialog has merge and overwrite", async function() {
        await changeFlowsElsewhereUnnoticed(ctx.page, ctx.url);
        await editAndDeploy(ctx.page);
        await ctx.page.waitForSelector("#red-ui-deploy-dialog-confirm-deploy-overwrite");
        (await dialogButtons(ctx.page)).should.eql(["Cancel", "Review changes", "Merge", "Ignore & deploy"]);
        should.not.exist(await ctx.page.$("#red-ui-deploy-dialog-stale-flows"));
    });

    it("background update shows the non-blocking notice", async function() {
        await changeFlowsElsewhere(ctx.url);
        await ctx.page.waitForSelector("text=The flows on the server have been updated.");
        should.not.exist(await ctx.page.$("#red-ui-deploy-dialog-stale-flows"));
    });

    it("restart with 409 shows the dialog without a script error", async function() {
        await ctx.page.route("**/flows", (route, req) => {
            if (req.method() === "POST" && req.headers()["node-red-deployment-type"] === "reload") {
                route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "version_mismatch" }) });
            } else {
                route.continue();
            }
        });
        await ctx.page.evaluate(() => RED.actions.invoke("core:restart-flows"));
        await ctx.page.waitForSelector("#red-ui-deploy-dialog-confirm-deploy-overwrite");
        // afterEach checks there was no script error (before the fix: "nns is not defined")
    });
});
