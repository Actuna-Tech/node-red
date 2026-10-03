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

/**
 * End-to-end tests of the flow layout options (left-right, top-bottom, auto)
 * and wire styles in the editor.
 *
 * These run Node-RED in a child process and drive the editor in Chromium
 * using Playwright. Playwright is not a dependency of Node-RED, so install it
 * first and build the editor:
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   npm run build
 *   npm run test:e2e
 *
 * The tests are skipped if Playwright cannot be loaded.
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
    // A small flow used on each tab: inject -> function (3 outputs) -> 2 debug + change, change -> debug
    function chain(z, prefix, positions) {
        const id = i => prefix + i;
        const p = positions;
        return [
            { id: id(0), type: "inject", z, name: "start", props: [], repeat: "", once: false, topic: "", x: p[0][0], y: p[0][1], wires: [[id(1)]] },
            { id: id(1), type: "function", z, name: "router", func: "return msg;", outputs: 3, x: p[1][0], y: p[1][1], wires: [[id(2)], [id(3)], [id(4)]] },
            { id: id(2), type: "debug", z, name: "out A", active: true, x: p[2][0], y: p[2][1], wires: [] },
            { id: id(3), type: "change", z, name: "modify", rules: [], x: p[3][0], y: p[3][1], wires: [[id(5)]] },
            { id: id(4), type: "debug", z, name: "out C", active: true, x: p[4][0], y: p[4][1], wires: [] },
            { id: id(5), type: "debug", z, name: "end", active: true, x: p[5][0], y: p[5][1], wires: [] }
        ];
    }
    return [
        { id: "tLR", type: "tab", label: "Horizontal", disabled: false, info: "" },
        ...chain("tLR", "h", [[120, 100], [320, 100], [540, 60], [540, 100], [540, 140], [760, 100]]),
        { id: "tTB", type: "tab", label: "Vertical", disabled: false, info: "", layout: "TB" },
        ...chain("tTB", "v", [[300, 60], [300, 160], [140, 280], [300, 280], [460, 280], [300, 400]]),
        { id: "tAuto", type: "tab", label: "Auto", disabled: false, info: "", layout: "auto" },
        ...chain("tAuto", "a", [[120, 100], [320, 100], [540, 100], [320, 260], [540, 260], [320, 420]]),
        { id: "tOrth", type: "tab", label: "Orthogonal", disabled: false, info: "", wireStyle: "orthogonal" },
        ...chain("tOrth", "o", [[120, 100], [320, 100], [540, 60], [540, 100], [540, 140], [760, 100]]),
        { id: "tMix", type: "tab", label: "Mixed", disabled: false, info: "" },
        ...chain("tMix", "m", [[120, 100], [320, 100], [540, 60], [320, 240], [540, 140], [320, 380]]).map(n => {
            if (n.id === "m3" || n.id === "m5") {
                n.o = "TB";
            }
            return n;
        })
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

function getJSON(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let body = "";
            res.on("data", d => body += d);
            res.on("end", () => {
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(err);
                }
            });
        }).on("error", reject);
    });
}

(playwright ? describe : describe.skip)("editor flow layout (e2e)", function() {
    this.timeout(60000);

    let userDir;
    let server;
    let url;
    let browser;
    let page;
    let pageErrors;

    before(async function() {
        if (!fs.existsSync(path.resolve(__dirname, "../../../packages/node_modules/@node-red/editor-client/public/red/red.min.js"))) {
            throw new Error("Editor not built - run 'npm run build' first");
        }
        userDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-layout-e2e-"));
        fs.writeFileSync(path.join(userDir, "flows.json"), JSON.stringify(testFlows()));
        fs.writeFileSync(path.join(userDir, "settings.js"), "module.exports = { flowFile: 'flows.json', editorTheme: { tours: false }, logging: { console: { level: 'warn' } } }");
        const port = await getFreePort();
        url = "http://127.0.0.1:" + port;
        server = spawn(process.execPath, [RED_JS, "-u", userDir, "-p", String(port)], { stdio: "ignore" });
        await waitForServer(url, 30000);
        browser = await playwright.chromium.launch();
    });

    after(async function() {
        if (browser) {
            await browser.close();
        }
        if (server) {
            server.kill();
        }
        if (userDir) {
            fs.rmSync(userDir, { recursive: true, force: true });
        }
    });

    beforeEach(async function() {
        page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
        pageErrors = [];
        page.on("pageerror", err => pageErrors.push(err.message));
        await page.goto(url);
        await page.waitForSelector(".red-ui-flow-node-group", { timeout: 30000 });
        // Dismiss the update notification prompt if it is shown
        const dismiss = await page.$("text=No, do not enable notifications");
        if (dismiss) {
            await dismiss.click();
        }
    });

    afterEach(async function() {
        pageErrors.should.eql([]);
        await page.close();
    });

    async function showFlow(id) {
        await page.evaluate(id => RED.workspaces.show(id), id);
        await page.waitForTimeout(300);
    }

    /** Get the bounding boxes of a node and its ports, in workspace coordinates */
    function nodeGeometry(id) {
        return page.evaluate(id => {
            const n = RED.nodes.node(id);
            const el = document.getElementById(id);
            // Measure relative to the node body - the group includes the ports
            const origin = el.__mainRect__.getBoundingClientRect();
            const scale = RED.view.scale();
            const rel = e => {
                const r = e.getBoundingClientRect();
                return { x: (r.x - origin.x) / scale, y: (r.y - origin.y) / scale, w: r.width / scale, h: r.height / scale };
            };
            const outputs = Array.from(el.querySelectorAll(".red-ui-flow-port-output .red-ui-flow-port")).map(rel);
            const input = el.querySelector(".red-ui-flow-port-input .red-ui-flow-port");
            return {
                w: n.w,
                h: n.h,
                orientation: RED.view.layout.getNodeOrientation(n),
                input: input ? rel(input) : null,
                outputs
            };
        }, id);
    }

    function wirePath(sourceId, sourcePort, targetId) {
        return page.evaluate(([sourceId, sourcePort, targetId]) => {
            const link = Array.from(document.querySelectorAll(".red-ui-flow-link")).find(el => {
                const d = el.__data__;
                return d.source.id === sourceId && (d.sourcePort || 0) === sourcePort && d.target.id === targetId;
            });
            return link ? link.querySelector(".red-ui-flow-link-line").getAttribute("d") : null;
        }, [sourceId, sourcePort, targetId]);
    }

    function startPoint(path) {
        const m = /^M\s*(-?[\d.]+)\s+(-?[\d.]+)/.exec(path);
        return [parseFloat(m[1]), parseFloat(m[2])];
    }

    function endPoint(path) {
        const numbers = path.match(/-?\d*\.?\d+/g).map(parseFloat);
        return [numbers[numbers.length - 2], numbers[numbers.length - 1]];
    }

    describe("left to right layout", function() {
        it("places inputs on the left and outputs on the right", async function() {
            await showFlow("tLR");
            const g = await nodeGeometry("h1");
            g.orientation.should.equal("LR");
            g.input.x.should.be.below(0);
            g.outputs.should.have.length(3);
            g.outputs.forEach(function(o) {
                (o.x + o.w).should.be.above(g.w);
            });
            g.outputs[0].y.should.be.below(g.outputs[1].y);
            g.outputs[1].y.should.be.below(g.outputs[2].y);
        });

        it("draws wires with the classic curve", async function() {
            await showFlow("tLR");
            const expected = await page.evaluate(() => {
                const s = RED.nodes.node("h0");
                const t = RED.nodes.node("h1");
                return RED.viewLayout.generateLinkPath(s.x + s.w / 2, s.y, t.x - t.w / 2, t.y, 1, false);
            });
            (await wirePath("h0", 0, "h1")).should.equal(expected);
        });
    });

    describe("top to bottom layout", function() {
        it("places inputs on the top and outputs along the bottom", async function() {
            await showFlow("tTB");
            const g = await nodeGeometry("v1");
            g.orientation.should.equal("TB");
            g.input.y.should.be.below(0);
            g.input.x.should.be.approximately(g.w / 2 - 5, 1);
            g.outputs.should.have.length(3);
            g.outputs.forEach(function(o) {
                (o.y + o.h).should.be.above(g.h);
                o.x.should.be.within(0, g.w);
            });
            g.outputs[0].x.should.be.below(g.outputs[1].x);
            g.outputs[1].x.should.be.below(g.outputs[2].x);
            // The height does not grow with the number of outputs
            g.h.should.equal(30);
        });

        it("draws wires from the bottom of the source to the top of the target", async function() {
            await showFlow("tTB");
            const nodes = await page.evaluate(() => {
                const s = RED.nodes.node("v0");
                const t = RED.nodes.node("v1");
                return { s: { x: s.x, y: s.y, h: s.h }, t: { x: t.x, y: t.y, h: t.h } };
            });
            const path = await wirePath("v0", 0, "v1");
            startPoint(path).should.eql([nodes.s.x, nodes.s.y + nodes.s.h / 2]);
            endPoint(path).should.eql([nodes.t.x, nodes.t.y - nodes.t.h / 2]);
        });

        it("shows the node status to the right of the node", async function() {
            await showFlow("tTB");
            const status = await page.evaluate(() => {
                const n = RED.nodes.node("v3");
                n.status = { fill: "green", shape: "dot", text: "connected" };
                n.dirtyStatus = true;
                n.dirty = true;
                RED.view.redraw(false, true);
                const el = document.getElementById("v3");
                const transform = el.__statusGroup__.getAttribute("transform");
                return { transform, w: n.w, statusHeight: n.statusHeight };
            });
            const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(status.transform);
            parseFloat(m[1]).should.be.above(status.w);
            status.statusHeight.should.equal(0);
        });

        it("creates a wire by dragging from an output to an input", async function() {
            await showFlow("tTB");
            const port = await page.$("#v3 .red-ui-flow-port-output .red-ui-flow-port");
            const target = await page.$("#v2 .red-ui-flow-port-input .red-ui-flow-port");
            const from = await port.boundingBox();
            const to = await target.boundingBox();
            await page.mouse.move(from.x + 5, from.y + 5);
            await page.mouse.down();
            await page.mouse.move(from.x + 40, from.y + 60, { steps: 5 });
            const dragPath = await page.$eval(".red-ui-flow-drag-line", el => el.getAttribute("d"));
            dragPath.should.not.match(/NaN/);
            await page.mouse.move(to.x + 5, to.y + 5, { steps: 5 });
            await page.mouse.up();
            const count = await page.evaluate(() => RED.nodes.filterLinks({ source: RED.nodes.node("v3"), target: RED.nodes.node("v2") }).length);
            count.should.equal(1);
            await page.evaluate(() => RED.history.pop());
        });
    });

    describe("automatic layout", function() {
        it("makes nodes in a vertical chain vertical and keeps horizontal ones horizontal", async function() {
            await showFlow("tAuto");
            (await nodeGeometry("a0")).orientation.should.equal("LR");
            (await nodeGeometry("a2")).orientation.should.equal("LR");
            // modify (a3) is below router and above end (a5)
            (await nodeGeometry("a3")).orientation.should.equal("TB");
            (await nodeGeometry("a5")).orientation.should.equal("TB");
        });

        it("updates the orientation when a node is moved", async function() {
            await showFlow("tAuto");
            await page.evaluate(() => {
                const n = RED.nodes.node("a5");
                n.x = 700;
                n.y = 260;
                n.dirty = true;
                RED.view.redraw(false, true);
            });
            (await nodeGeometry("a5")).orientation.should.equal("LR");
        });
    });

    describe("orthogonal wires", function() {
        it("draws wires with straight segments and rounded corners", async function() {
            await showFlow("tOrth");
            const path = await wirePath("o1", 0, "o2");
            path.should.match(/^M[\d\s.LQ-]+$/);
            path.should.not.match(/C/);
        });
    });

    describe("node port orientation", function() {
        it("uses the node's own orientation over the flow layout", async function() {
            await showFlow("tMix");
            (await nodeGeometry("m1")).orientation.should.equal("LR");
            const g = await nodeGeometry("m3");
            g.orientation.should.equal("TB");
            g.input.y.should.be.below(0);
            // Wire from a right-hand output to a top input
            const path = await wirePath("m1", 1, "m3");
            path.should.not.match(/NaN/);
        });

        it("sets the orientation of the selected nodes from the context menu actions, with undo", async function() {
            await showFlow("tLR");
            const result = await page.evaluate(() => {
                const n = RED.nodes.node("h3");
                RED.view.select({ nodes: [n] });
                RED.actions.invoke("core:set-selected-node-ports-vertical");
                const afterSet = n.o;
                const exported = RED.nodes.convertNode(n).o;
                RED.actions.invoke("core:reset-selected-node-ports");
                const afterReset = n.o;
                RED.history.pop();
                const afterUndo = n.o;
                RED.history.pop();
                RED.view.select(null);
                return { afterSet, exported, afterReset, afterUndo, final: n.o, exportedFinal: RED.nodes.convertNode(n).hasOwnProperty("o") };
            });
            result.should.eql({ afterSet: "TB", exported: "TB", afterReset: undefined, afterUndo: "TB", final: undefined, exportedFinal: false });
        });

        it("sets the orientation from the node appearance tab", async function() {
            await showFlow("tLR");
            await page.evaluate(() => RED.editor.edit(RED.nodes.node("h2")));
            await page.waitForSelector("#node-input-port-orientation", { state: "attached" });
            await page.evaluate(() => $('a[href="#editor-tab-appearance"]').each(function() { this.click(); }));
            await page.selectOption("#node-input-port-orientation", "TB");
            await page.click("#node-dialog-ok");
            await page.waitForTimeout(300);
            (await nodeGeometry("h2")).orientation.should.equal("TB");
            await page.evaluate(() => RED.history.pop());
            (await page.evaluate(() => RED.nodes.node("h2").o === undefined)).should.be.true();
        });
    });

    describe("flow properties", function() {
        it("sets the layout and wire style of a flow, with undo", async function() {
            await showFlow("tLR");
            await page.evaluate(() => RED.editor.editFlow(RED.nodes.workspace("tLR")));
            await page.waitForSelector("#node-input-flow-layout");
            (await page.$eval("#node-input-flow-layout", el => el.value)).should.equal("");
            await page.selectOption("#node-input-flow-layout", "TB");
            await page.selectOption("#node-input-flow-wire-style", "orthogonal");
            await page.click("#node-dialog-ok");
            await page.waitForTimeout(500);
            (await nodeGeometry("h1")).orientation.should.equal("TB");
            const tab = await page.evaluate(() => RED.nodes.convertNode(RED.nodes.workspace("tLR")));
            tab.layout.should.equal("TB");
            tab.wireStyle.should.equal("orthogonal");
            (await wirePath("h0", 0, "h1")).should.not.match(/C/);

            await page.evaluate(() => RED.history.pop());
            await page.waitForTimeout(300);
            (await nodeGeometry("h1")).orientation.should.equal("LR");
            const restored = await page.evaluate(() => RED.nodes.convertNode(RED.nodes.workspace("tLR")));
            restored.should.not.have.property("layout");
            restored.should.not.have.property("wireStyle");
        });

        it("does not add layout properties to flows that do not set them", async function() {
            const exported = await page.evaluate(() => RED.nodes.createCompleteNodeSet());
            const tabs = exported.filter(n => n.type === "tab");
            tabs.find(t => t.id === "tLR").should.not.have.property("layout");
            tabs.find(t => t.id === "tTB").layout.should.equal("TB");
            exported.find(n => n.id === "h1").should.not.have.property("o");
            exported.find(n => n.id === "m3").o.should.equal("TB");
        });
    });

    describe("user settings", function() {
        async function setDefaultLayout(layout) {
            // Save the user settings straight away and wait for them to be stored,
            // so they do not leak into the next test
            await Promise.all([
                page.waitForResponse(res => /\/settings\/user$/.test(res.url())),
                page.evaluate(layout => {
                    const editor = RED.settings.get("editor");
                    editor.view["view-flow-layout"] = layout;
                    RED.settings.set("editor", editor, true);
                    RED.view.redraw(true, true);
                }, layout)
            ]);
        }

        it("uses the default layout from the user settings for flows that do not set one", async function() {
            await setDefaultLayout("TB");
            await showFlow("tLR");
            (await nodeGeometry("h1")).orientation.should.equal("TB");
            await setDefaultLayout("LR");
            (await nodeGeometry("h1")).orientation.should.equal("LR");
        });

        it("shows the layout options in the settings dialog", async function() {
            await page.evaluate(() => RED.actions.invoke("core:show-user-settings"));
            await page.waitForSelector("#user-settings-view-flow-layout");
            (await page.$eval("#user-settings-view-flow-layout", el => el.value)).should.equal("LR");
            (await page.$eval("#user-settings-view-wire-style", el => el.value)).should.equal("curved");
            const options = await page.$$eval("#user-settings-view-flow-layout option", els => els.map(e => e.value));
            options.should.eql(["LR", "TB", "auto"]);
        });
    });

    describe("deploy", function() {
        it("saves the layout properties to the runtime", async function() {
            await page.evaluate(() => {
                const ws = RED.nodes.workspace("tOrth");
                ws.layout = "auto";
                ws.changed = true;
                RED.nodes.dirty(true);
            });
            await page.evaluate(() => RED.actions.invoke("core:deploy-flows"));
            await page.waitForFunction(() => !RED.nodes.dirty(), null, { timeout: 10000 });
            const flows = await getJSON(url + "/flows");
            flows.find(n => n.id === "tOrth").should.containEql({ layout: "auto", wireStyle: "orthogonal" });
            flows.find(n => n.id === "tTB").layout.should.equal("TB");
            flows.find(n => n.id === "m3").o.should.equal("TB");
        });
    });
});
