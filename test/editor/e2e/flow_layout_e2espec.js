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
 *   Z-14, FL-B-010: end-to-end tests of flow layouts and import of flows with the same ids
 *   Z-14: run with editorTheme.flowLayout.enabled set; tests with the setting not set
 *   FL-B-007: test of the position of port label tooltips
 *   FL-B-008: test of the labels of links to other flows
 *   FL-B-012: test of the editor start without errors in the console
 *   P-03: test of the user settings with the telemetry setting locked by the administrator
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

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
 *
 * The main suite runs with `editorTheme.flowLayout.enabled: true`; a second
 * suite checks the editor with the setting not set (the default).
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

function sendJSON(method, url, body) {
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

/**
 * Start Node-RED in a child process with the test flows
 * @param {object} editorTheme the editorTheme settings
 * @param {object} [extraSettings] other settings to add to the settings file
 * @returns {Promise<{server, url: string, userDir: string}>}
 */
async function startNodeRED(editorTheme, extraSettings) {
    if (!fs.existsSync(path.resolve(__dirname, "../../../packages/node_modules/@node-red/editor-client/public/red/red.min.js"))) {
        throw new Error("Editor not built - run 'npm run build' first");
    }
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-layout-e2e-"));
    fs.writeFileSync(path.join(userDir, "flows.json"), JSON.stringify(testFlows()));
    const settings = Object.assign({ flowFile: "flows.json", editorTheme: editorTheme, logging: { console: { level: "warn" } } }, extraSettings || {});
    fs.writeFileSync(path.join(userDir, "settings.js"), "module.exports = " + JSON.stringify(settings));
    const port = await getFreePort();
    const url = "http://127.0.0.1:" + port;
    const server = spawn(process.execPath, [RED_JS, "-u", userDir, "-p", String(port)], { stdio: "ignore" });
    await waitForServer(url, 30000);
    return { server, url, userDir };
}

/** Get the labels of the items of the context menu shown for the selected node */
function contextMenuLabels(page, nodeId) {
    return page.evaluate(nodeId => {
        RED.view.select({ nodes: [RED.nodes.node(nodeId)] });
        RED.contextMenu.show({ type: "workspace", x: 200, y: 200 });
        const labels = Array.from(document.querySelectorAll("#red-ui-workspace-context-menu .red-ui-menu-label")).map(el => el.textContent);
        RED.contextMenu.hide();
        RED.view.select(null);
        return labels;
    }, nodeId);
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
        ({ server, url, userDir } = await startNodeRED({ tours: false, flowLayout: { enabled: true } }));
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

    describe("port label tooltips (FL-B-007)", function() {
        /** Hover over a port and get the bounding boxes of the port and its tooltip */
        async function tooltipBox(selector) {
            await page.mouse.move(5, 5);
            await page.hover(selector);
            await page.waitForSelector(".red-ui-flow-port-tooltip", { timeout: 3000 });
            const result = await page.evaluate(selector => {
                const box = el => {
                    const r = el.getBoundingClientRect();
                    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
                };
                return {
                    port: box(document.querySelector(selector)),
                    tooltip: box(document.querySelector(".red-ui-flow-port-tooltip path")),
                    text: box(document.querySelector(".red-ui-flow-port-tooltip text"))
                };
            }, selector);
            await page.mouse.move(5, 5);
            await page.waitForSelector(".red-ui-flow-port-tooltip", { state: "detached", timeout: 3000 });
            return result;
        }

        async function setLabels(id) {
            await page.evaluate(id => {
                const n = RED.nodes.node(id);
                n.inputLabels = ["input label"];
                n.outputLabels = ["first", "second", "third"];
            }, id);
        }

        async function clearLabels(id) {
            await page.evaluate(id => {
                const n = RED.nodes.node(id);
                delete n.inputLabels;
                delete n.outputLabels;
            }, id);
        }

        it("shows the tooltips above the input and below the outputs in top to bottom layout", async function() {
            await showFlow("tTB");
            await setLabels("v1");
            try {
                const output = await tooltipBox("#v1 .red-ui-flow-port-output .red-ui-flow-port");
                output.tooltip.y.should.be.aboveOrEqual(output.port.y + output.port.h - 1);
                output.tooltip.cx.should.be.approximately(output.port.cx, 2);
                // The label is inside the tooltip
                output.text.y.should.be.aboveOrEqual(output.tooltip.y);
                (output.text.y + output.text.h).should.be.belowOrEqual(output.tooltip.y + output.tooltip.h);
                const input = await tooltipBox("#v1 .red-ui-flow-port-input .red-ui-flow-port");
                (input.tooltip.y + input.tooltip.h).should.be.belowOrEqual(input.port.y + 1);
                input.tooltip.cx.should.be.approximately(input.port.cx, 2);
            } finally {
                await clearLabels("v1");
            }
        });

        it("keeps the tooltips at the side of the ports in left to right layout", async function() {
            await showFlow("tLR");
            await setLabels("h1");
            try {
                const output = await tooltipBox("#h1 .red-ui-flow-port-output .red-ui-flow-port");
                output.tooltip.x.should.be.aboveOrEqual(output.port.x + output.port.w - 1);
                output.tooltip.cy.should.be.approximately(output.port.cy, 2);
                const input = await tooltipBox("#h1 .red-ui-flow-port-input .red-ui-flow-port");
                (input.tooltip.x + input.tooltip.w).should.be.belowOrEqual(input.port.x + 1);
                input.tooltip.cy.should.be.approximately(input.port.cy, 2);
            } finally {
                await clearLabels("h1");
            }
        });
    });

    describe("links to other flows (FL-B-008)", function() {
        async function addLinkNodes() {
            // Imported nodes are added to the active flow
            await page.evaluate(() => {
                RED.workspaces.show("tLR");
                RED.nodes.import([{ id: "li1", type: "link in", z: "tLR", name: "", links: [], x: 120, y: 300, wires: [] }]);
                RED.workspaces.show("tTB");
                RED.nodes.import([{ id: "lo1", type: "link out", z: "tTB", name: "", mode: "link", links: ["li1"], x: 600, y: 60, wires: [] }]);
                RED.nodes.node("li1").links = ["lo1"];
            });
        }

        /** Select a link node and get the bounding boxes of the node and the labels of its links */
        async function offFlowLabels(id) {
            await page.evaluate(id => {
                RED.view.select({ nodes: [RED.nodes.node(id)] });
                RED.view.redraw(true);
            }, id);
            await page.waitForSelector(".red-ui-flow-link-off-flow .red-ui-flow-port-label");
            return page.evaluate(id => {
                const box = el => {
                    const r = el.getBoundingClientRect();
                    return { x: r.x, y: r.y, w: r.width, h: r.height };
                };
                const group = document.querySelector(".red-ui-flow-link-off-flow");
                return {
                    transform: group.getAttribute("transform"),
                    node: box(document.getElementById(id).__mainRect__),
                    labels: Array.from(group.querySelectorAll(".red-ui-flow-port-label")).map(el => Object.assign(box(el), { text: el.textContent }))
                };
            }, id);
        }

        it("shows horizontal labels below a top to bottom link out node", async function() {
            await addLinkNodes();
            await showFlow("tTB");
            const result = await offFlowLabels("lo1");
            result.transform.should.not.match(/rotate/);
            result.labels.should.have.length(1);
            const label = result.labels[0];
            label.text.should.equal("Horizontal");
            label.w.should.be.above(label.h);
            label.y.should.be.aboveOrEqual(result.node.y + result.node.h);
            // Clicking the label shows the flow of the linked node
            await page.mouse.click(label.x + label.w / 2, label.y + label.h / 2);
            await page.waitForTimeout(300);
            (await page.evaluate(() => RED.workspaces.active())).should.equal("tLR");
        });

        it("keeps the labels at the side of a left to right link in node", async function() {
            await addLinkNodes();
            await showFlow("tLR");
            const result = await offFlowLabels("li1");
            result.transform.should.not.match(/rotate/);
            const label = result.labels[0];
            label.text.should.equal("Vertical");
            label.w.should.be.above(label.h);
            (label.x + label.w).should.be.belowOrEqual(result.node.x);
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

        it("shows the port orientation entries in the context menu", async function() {
            await showFlow("tLR");
            const expected = await page.evaluate(() => [RED._("layout.setHorizontal"), RED._("layout.setVertical"), RED._("layout.setInherit")]);
            const labels = await contextMenuLabels(page, "h3");
            labels.should.containDeep(expected);
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

        it("starts the editor without errors in the console (FL-B-012)", async function() {
            const freshPage = await browser.newPage({ viewport: { width: 1500, height: 900 } });
            const problems = [];
            freshPage.on("pageerror", err => problems.push("pageerror: " + err.message));
            freshPage.on("console", msg => {
                const text = msg.text();
                const location = msg.location() || {};
                if (/^Failed to load resource/.test(text) && location.url && location.url.indexOf(url) !== 0) {
                    // Resources from other hosts depend on the network of the test machine
                    return;
                }
                if (msg.type() === "error" || /RED\.events\.emit error/.test(text) || /treeList/.test(text)) {
                    problems.push(msg.type() + ": " + text);
                }
            });
            try {
                await freshPage.goto(url);
                await freshPage.waitForSelector(".red-ui-flow-node-group", { timeout: 30000 });
                await freshPage.waitForTimeout(500);
            } finally {
                await freshPage.close();
            }
            problems.should.eql([]);
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

    describe("export and import", function() {
        async function exportJSON(range) {
            await page.evaluate(() => RED.actions.invoke("core:show-export-dialog"));
            await page.waitForSelector("#red-ui-clipboard-dialog-export-rng-" + range, { state: "visible" });
            await page.click("#red-ui-clipboard-dialog-export-rng-" + range);
            await page.waitForTimeout(200);
            const json = await page.$eval("#red-ui-clipboard-dialog-export-text", el => el.value);
            await page.click("#red-ui-clipboard-dialog-cancel");
            await page.waitForTimeout(300);
            return JSON.parse(json);
        }

        async function importJSON(nodes) {
            await page.evaluate(() => RED.actions.invoke("core:show-import-dialog"));
            await page.waitForSelector("#red-ui-clipboard-dialog-import-text", { state: "visible" });
            await page.fill("#red-ui-clipboard-dialog-import-text", JSON.stringify(nodes));
            // The dialog validates the text on keyup
            await page.focus("#red-ui-clipboard-dialog-import-text");
            await page.keyboard.press("End");
            await page.waitForSelector("#red-ui-clipboard-dialog-ok:not(.disabled)");
            await page.click("#red-ui-clipboard-dialog-ok");
            await page.waitForTimeout(500);
            // Imported nodes follow the mouse until they are dropped
            await page.mouse.move(900, 600);
            await page.mouse.click(900, 600);
            await page.waitForTimeout(300);
        }

        // Give every node a new id, as if the flow came from another Node-RED instance
        function withNewIds(nodes) {
            let json = JSON.stringify(nodes);
            nodes.forEach(function(n) {
                json = json.split('"' + n.id + '"').join('"x' + n.id + '"');
            });
            return JSON.parse(json);
        }

        it("exports the current flow with its layout and imports it into a new flow", async function() {
            await showFlow("tTB");
            await page.evaluate(() => {
                RED.view.select({ nodes: [RED.nodes.node("v4")] });
                RED.actions.invoke("core:set-selected-node-ports-horizontal");
                RED.view.select(null);
            });
            const exported = await exportJSON("flow");
            exported.find(n => n.type === "tab").should.containEql({ id: "tTB", layout: "TB" });
            exported.find(n => n.id === "v4").o.should.equal("LR");
            exported.find(n => n.id === "v1").should.not.have.property("o");

            await importJSON(withNewIds(exported));
            const result = await page.evaluate(() => {
                const tab = RED.nodes.workspace("xtTB");
                return {
                    active: RED.workspaces.active(),
                    tab: tab && { layout: tab.layout, wireStyle: tab.wireStyle },
                    v1: RED.view.layout.getNodeOrientation(RED.nodes.node("xv1")),
                    v4: RED.nodes.node("xv4").o,
                    v4Orientation: RED.view.layout.getNodeOrientation(RED.nodes.node("xv4"))
                };
            });
            result.tab.should.eql({ layout: "TB", wireStyle: undefined });
            result.v1.should.equal("TB");
            result.v4.should.equal("LR");
            result.v4Orientation.should.equal("LR");
            // The imported flow is drawn top to bottom
            await showFlow("xtTB");
            const g = await nodeGeometry("xv1");
            g.input.y.should.be.below(0);
        });

        it("exports all flows with their layout options", async function() {
            const exported = await exportJSON("full");
            const tabs = exported.filter(n => n.type === "tab");
            tabs.find(t => t.id === "tLR").should.not.have.property("layout");
            tabs.find(t => t.id === "tTB").layout.should.equal("TB");
            tabs.find(t => t.id === "tAuto").layout.should.equal("auto");
            tabs.find(t => t.id === "tOrth").wireStyle.should.equal("orthogonal");
            exported.find(n => n.id === "m3").o.should.equal("TB");
        });

        it("keeps the orientation of copied nodes, which otherwise follow the target flow", async function() {
            await showFlow("tMix");
            await page.evaluate(() => RED.view.select({ nodes: [RED.nodes.node("m1"), RED.nodes.node("m3")] }));
            const exported = await exportJSON("selected");
            exported.filter(n => n.type === "tab").should.have.length(0);
            exported.find(n => n.id === "m3").o.should.equal("TB");

            // Paste into a top to bottom flow
            await showFlow("tTB");
            await importJSON(withNewIds(exported));
            const pasted = await page.evaluate(() => ({
                m1: RED.view.layout.getNodeOrientation(RED.nodes.node("xm1")),
                m1o: RED.nodes.node("xm1").o,
                m3: RED.nodes.node("xm3").o,
                z: RED.nodes.node("xm1").z
            }));
            pasted.should.eql({ m1: "TB", m1o: undefined, m3: "TB", z: "tTB" });
        });

        it("exports and imports the layout of a subflow with its instance", async function() {
            await showFlow("tLR");
            await page.evaluate(() => {
                RED.view.importNodes([
                    { id: "sfL", type: "subflow", name: "Vertical subflow", info: "", category: "", layout: "TB", wireStyle: "orthogonal",
                        in: [{ x: 60, y: 40, wires: [{ id: "sfn1" }] }], out: [{ x: 300, y: 200, wires: [{ id: "sfn1", port: 0 }] }], env: [], color: "#DDAA99" },
                    { id: "sfn1", type: "change", z: "sfL", name: "", rules: [], x: 180, y: 120, wires: [[]] },
                    { id: "sfi1", type: "subflow:sfL", z: "tLR", name: "", x: 300, y: 300, wires: [[]] }
                ], { generateIds: false, touchImport: true });
                RED.view.select({ nodes: [RED.nodes.node("sfi1")] });
            });
            const exported = await exportJSON("selected");
            const sf = exported.find(n => n.type === "subflow");
            sf.layout.should.equal("TB");
            sf.wireStyle.should.equal("orthogonal");

            // Remove the original subflow, as an identical subflow that already
            // exists would be reused rather than imported
            await page.evaluate(() => { RED.history.pop(); RED.view.select(null); });
            (await page.evaluate(() => !!RED.nodes.subflow("sfL"))).should.be.false();

            await importJSON(withNewIds(exported));
            const imported = await page.evaluate(() => {
                const sf = RED.nodes.subflow("xsfL");
                return sf && { layout: sf.layout, wireStyle: sf.wireStyle };
            });
            imported.should.eql({ layout: "TB", wireStyle: "orthogonal" });
            // The flow inside the imported subflow is drawn top to bottom
            await showFlow("xsfL");
            (await nodeGeometry("xsfn1")).orientation.should.equal("TB");
        });

        describe("importing a flow and subflow with the same ids", function() {
            // A flow with a subflow instance, both using the top to bottom layout
            async function createFlowWithSubflow() {
                await page.evaluate(() => {
                    RED.view.importNodes([
                        { id: "tImp", type: "tab", label: "Import test", disabled: false, info: "", env: [], layout: "TB" },
                        { id: "sfImp", type: "subflow", name: "Import subflow", info: "", category: "", layout: "TB", wireStyle: "orthogonal",
                            in: [{ x: 60, y: 40, wires: [{ id: "sfImpN" }] }], out: [], env: [], color: "#DDAA99" },
                        { id: "sfImpN", type: "change", z: "sfImp", name: "", rules: [], x: 180, y: 120, wires: [[]] },
                        { id: "iImp", type: "subflow:sfImp", z: "tImp", name: "", x: 300, y: 200, wires: [] }
                    ], { generateIds: false, touchImport: true });
                });
                await showFlow("tImp");
            }

            async function startImport(nodes) {
                await page.evaluate(() => RED.actions.invoke("core:show-import-dialog"));
                await page.waitForSelector("#red-ui-clipboard-dialog-import-text", { state: "visible" });
                await page.fill("#red-ui-clipboard-dialog-import-text", JSON.stringify(nodes));
                await page.focus("#red-ui-clipboard-dialog-import-text");
                await page.keyboard.press("End");
                await page.waitForSelector("#red-ui-clipboard-dialog-ok:not(.disabled)");
                await page.click("#red-ui-clipboard-dialog-ok");
                // The editor asks what to do with the nodes that already exist
                await page.waitForSelector(".red-ui-notification button:has-text('Import copy')", { state: "visible" });
            }

            async function changeLocalLayout() {
                await page.evaluate(() => {
                    RED.nodes.workspace("tImp").layout = "LR";
                    RED.nodes.subflow("sfImp").layout = "LR";
                    RED.nodes.subflow("sfImp").wireStyle = "curved";
                });
            }

            async function removeFlowWithSubflow() {
                await page.evaluate(() => {
                    RED.view.select(null);
                    ["tImp", "xtImp"].forEach(id => { if (RED.nodes.workspace(id)) { RED.workspaces.delete(RED.nodes.workspace(id)); } });
                    RED.nodes.eachSubflow(sf => { if (/^Import subflow/.test(sf.name)) { RED.nodes.removeSubflow(sf); } });
                });
            }

            afterEach(removeFlowWithSubflow);

            it("replaces the existing subflow with the imported layout and keeps the flow when it is not imported", async function() {
                await createFlowWithSubflow();
                const exported = await exportJSON("flow");
                exported.find(n => n.id === "sfImp").layout.should.equal("TB");
                await changeLocalLayout();

                await startImport(exported);
                await page.click(".red-ui-notification button:has-text('View nodes')");
                await page.waitForSelector("#red-ui-clipboard-dialog-import-conflict", { state: "visible" });
                // The editor offers to replace both the subflow and the flow (FL-B-010);
                // by default both are imported as copies
                const offered = await page.evaluate(() => {
                    const ids = [];
                    $('.red-ui-clipboard-dialog-import-conflicts-controls input[type="checkbox"]:visible').each(function() {
                        ids.push($(this).attr("data-node-id") + ":" + (this.checked ? "replace" : "copy"));
                    });
                    return ids;
                });
                offered.should.eql(["sfImp:copy", "tImp:copy"]);
                // Replace the subflow and do not import the flow again
                await page.evaluate(() => {
                    // A conflicting subflow is not selected by default: select it, then choose "replace"
                    $('.red-ui-clipboard-dialog-import-conflicts-gutter input[data-node-id="sfImp"]').prop("checked", true).trigger("change");
                    $('.red-ui-clipboard-dialog-import-conflicts-controls input[data-node-id="sfImp"]').prop("checked", true);
                    $('#red-ui-clipboard-dialog-import-conflicts-list input[data-node-id="tImp"]').prop("checked", false).trigger("change");
                });
                await page.click("#red-ui-clipboard-dialog-import-conflict");
                await page.waitForTimeout(500);

                const result = await page.evaluate(() => {
                    const flows = [];
                    RED.nodes.eachWorkspace(ws => { if (ws.label === "Import test") { flows.push(ws.id); } });
                    const subflows = [];
                    RED.nodes.eachSubflow(sf => { if (/^Import subflow/.test(sf.name)) { subflows.push(sf.id); } });
                    const sf = RED.nodes.subflow("sfImp");
                    return { flows, subflows, tab: RED.nodes.workspace("tImp").layout, sf: { layout: sf.layout, wireStyle: sf.wireStyle } };
                });
                // No duplicates: the existing subflow now has the imported layout
                result.subflows.should.eql(["sfImp"]);
                result.sf.should.eql({ layout: "TB", wireStyle: "orthogonal" });
                // The flow was not imported, so it keeps its own layout
                result.flows.should.eql(["tImp"]);
                result.tab.should.equal("LR");
            });

            it("replaces the existing flow with the imported layout and content; undo restores it (FL-B-010)", async function() {
                await createFlowWithSubflow();
                const exported = await exportJSON("flow");
                exported.find(n => n.id === "tImp").layout.should.equal("TB");
                // Local changes: flow properties and content
                await changeLocalLayout();
                await page.evaluate(() => {
                    RED.nodes.workspace("tImp").label = "Import test (local)";
                    RED.nodes.workspace("tImp").info = "local";
                    RED.view.importNodes([
                        { id: "localImpN", type: "inject", z: "tImp", name: "local", props: [], repeat: "", once: false, topic: "", x: 200, y: 80, wires: [] }
                    ], { generateIds: false, touchImport: true });
                });
                const before = await page.evaluate(() => RED.nodes.filterNodes({ z: "tImp" }).map(n => n.id).sort());
                before.should.eql(["iImp", "localImpN"]);

                await startImport(exported);
                await page.click(".red-ui-notification button:has-text('View nodes')");
                await page.waitForSelector("#red-ui-clipboard-dialog-import-conflict", { state: "visible" });
                await page.evaluate(() => {
                    $('.red-ui-clipboard-dialog-import-conflicts-gutter input[data-node-id="sfImp"]').prop("checked", true).trigger("change");
                    $('.red-ui-clipboard-dialog-import-conflicts-controls input[data-node-id="sfImp"]').prop("checked", true);
                    $('.red-ui-clipboard-dialog-import-conflicts-controls input[data-node-id="tImp"]').prop("checked", true);
                });
                await page.click("#red-ui-clipboard-dialog-import-conflict");
                await page.waitForTimeout(500);

                const state = () => page.evaluate(() => {
                    const flows = [];
                    RED.nodes.eachWorkspace(ws => { if (/^Import test/.test(ws.label)) { flows.push(ws.id); } });
                    const subflows = [];
                    RED.nodes.eachSubflow(sf => { if (/^Import subflow/.test(sf.name)) { subflows.push(sf.id); } });
                    const ws = RED.nodes.workspace("tImp");
                    return {
                        flows,
                        subflows,
                        tab: { label: ws.label, info: ws.info, layout: ws.layout || null },
                        nodes: RED.nodes.filterNodes({ z: "tImp" }).map(n => n.id).sort(),
                        instances: RED.nodes.subflow("sfImp").instances.map(n => n.id),
                        dirty: RED.nodes.dirty()
                    };
                });
                const replaced = await state();
                // One flow with the imported properties, layout and content
                replaced.flows.should.eql(["tImp"]);
                replaced.subflows.should.eql(["sfImp"]);
                replaced.tab.should.eql({ label: "Import test", info: "", layout: "TB" });
                replaced.nodes.should.eql(["iImp"]);
                replaced.instances.should.eql(["iImp"]);
                replaced.dirty.should.be.true();
                // The instance in the replaced flow is drawn top to bottom
                await showFlow("tImp");
                (await nodeGeometry("iImp")).orientation.should.equal("TB");

                // Undo restores the flow as it was before the import
                await page.evaluate(() => RED.history.pop());
                await page.waitForTimeout(300);
                const restored = await state();
                restored.flows.should.eql(["tImp"]);
                restored.subflows.should.eql(["sfImp"]);
                restored.tab.should.eql({ label: "Import test (local)", info: "local", layout: "LR" });
                restored.nodes.should.eql(["iImp", "localImpN"]);
                restored.instances.should.eql(["iImp"]);
            });

            it("replaces a flow with a new subflow from another instance; undo and redo keep the instance (FL-B-010)", async function() {
                await createFlowWithSubflow();
                // The same flow exported from another instance, now using a subflow
                // that does not exist here
                const exported = [
                    { id: "tImp", type: "tab", label: "Import test (remote)", disabled: false, info: "", env: [], layout: "TB" },
                    { id: "sfNew", type: "subflow", name: "Import subflow (remote)", info: "", category: "",
                        in: [{ x: 60, y: 40, wires: [{ id: "sfNewN" }] }], out: [{ x: 300, y: 40, wires: [{ id: "sfNewN", port: 0 }] }], env: [], color: "#DDAA99" },
                    { id: "sfNewN", type: "change", z: "sfNew", name: "", rules: [], x: 180, y: 120, wires: [[]] },
                    { id: "iNew", type: "subflow:sfNew", z: "tImp", name: "", x: 300, y: 200, wires: [[]] }
                ];
                await startImport(exported);
                await page.click(".red-ui-notification button:has-text('View nodes')");
                await page.waitForSelector("#red-ui-clipboard-dialog-import-conflict", { state: "visible" });
                await page.evaluate(() => {
                    $('.red-ui-clipboard-dialog-import-conflicts-controls input[data-node-id="tImp"]').prop("checked", true);
                });
                await page.click("#red-ui-clipboard-dialog-import-conflict");
                await page.waitForTimeout(500);

                const state = () => page.evaluate(() => {
                    const sf = RED.nodes.subflow("sfNew");
                    const iNew = RED.nodes.node("iNew");
                    return {
                        label: RED.nodes.workspace("tImp").label,
                        nodes: RED.nodes.filterNodes({ z: "tImp" }).map(n => n.id).sort(),
                        subflow: !!sf,
                        instance: iNew ? { type: iNew.type, outputs: iNew.outputs } : null,
                        instances: sf ? sf.instances.map(n => n.id) : null,
                        oldInstances: RED.nodes.subflow("sfImp").instances.map(n => n.id)
                    };
                });
                const replaced = await state();
                replaced.should.eql({
                    label: "Import test (remote)", nodes: ["iNew"], subflow: true,
                    instance: { type: "subflow:sfNew", outputs: 1 }, instances: ["iNew"], oldInstances: []
                });
                await showFlow("tImp");
                (await page.$$("#red-ui-workspace-chart .red-ui-flow-node-unknown")).should.have.length(0);

                // Undo restores the flow and removes the new subflow
                await page.evaluate(() => RED.history.pop());
                await page.waitForTimeout(300);
                (await state()).should.eql({
                    label: "Import test", nodes: ["iImp"], subflow: false,
                    instance: null, instances: null, oldInstances: ["iImp"]
                });

                // Redo brings back the subflow before the flow content that uses it
                await page.evaluate(() => RED.history.redo());
                await page.waitForTimeout(300);
                (await state()).should.eql(replaced);
            });

            it("replaces a flow with a new config node from another instance (FL-B-010)", async function() {
                await createFlowWithSubflow();
                const exported = [
                    { id: "tImp", type: "tab", label: "Import test (remote)", disabled: false, info: "", env: [] },
                    { id: "cfgNew", type: "mqtt-broker", name: "Import broker", broker: "localhost", port: "1883" },
                    { id: "mqNew", type: "mqtt in", z: "tImp", name: "", topic: "t", qos: "2", datatype: "auto-detect", broker: "cfgNew", x: 200, y: 120, wires: [[]] }
                ];
                await startImport(exported);
                await page.click(".red-ui-notification button:has-text('View nodes')");
                await page.waitForSelector("#red-ui-clipboard-dialog-import-conflict", { state: "visible" });
                await page.evaluate(() => {
                    $('.red-ui-clipboard-dialog-import-conflicts-controls input[data-node-id="tImp"]').prop("checked", true);
                });
                await page.click("#red-ui-clipboard-dialog-import-conflict");
                await page.waitForTimeout(500);

                const state = () => page.evaluate(() => {
                    const cfg = RED.nodes.node("cfgNew");
                    const mq = RED.nodes.node("mqNew");
                    return {
                        nodes: RED.nodes.filterNodes({ z: "tImp" }).map(n => n.id).sort(),
                        // the users are the nodes in the flow (not stale objects)
                        users: cfg ? cfg.users.map(n => n === RED.nodes.node(n.id) ? n.id : "stale:" + n.id) : null,
                        broker: mq ? mq.broker : null
                    };
                });
                const removeConfig = () => page.evaluate(() => {
                    if (RED.nodes.node("cfgNew")) { RED.nodes.remove("cfgNew"); }
                });
                try {
                    (await state()).should.eql({ nodes: ["mqNew"], users: ["mqNew"], broker: "cfgNew" });
                    // Undo restores the flow and removes the new config node
                    await page.evaluate(() => RED.history.pop());
                    await page.waitForTimeout(300);
                    (await state()).should.eql({ nodes: ["iImp"], users: null, broker: null });
                    // Redo adds the config node before the flow content that uses it
                    await page.evaluate(() => RED.history.redo());
                    await page.waitForTimeout(300);
                    (await state()).should.eql({ nodes: ["mqNew"], users: ["mqNew"], broker: "cfgNew" });
                } finally {
                    await removeConfig();
                }
            });

            it("does not offer to replace a locked flow and imports it as a copy", async function() {
                await createFlowWithSubflow();
                const exported = await exportJSON("flow");
                await page.evaluate(() => {
                    RED.nodes.workspace("tImp").layout = "LR";
                    RED.nodes.workspace("tImp").locked = true;
                });

                await startImport(exported);
                await page.click(".red-ui-notification button:has-text('View nodes')");
                await page.waitForSelector("#red-ui-clipboard-dialog-import-conflict", { state: "visible" });
                const control = await page.evaluate(() => {
                    const cb = $('.red-ui-clipboard-dialog-import-conflicts-controls input[data-node-id="tImp"]');
                    return { visible: cb.is(":visible"), disabled: cb.prop("disabled"), checked: cb.prop("checked") };
                });
                // The replace option is shown but cannot be selected for the locked flow
                control.should.eql({ visible: true, disabled: true, checked: false });
                await page.click("#red-ui-clipboard-dialog-import-conflict");
                await page.waitForTimeout(500);
                await page.mouse.move(900, 600);
                await page.mouse.click(900, 600);
                await page.waitForTimeout(300);

                const result = await page.evaluate(() => {
                    const flows = [];
                    RED.nodes.eachWorkspace(ws => { if (ws.label === "Import test") { flows.push({ id: ws.id, layout: ws.layout, locked: !!ws.locked }); } });
                    return flows;
                });
                // The locked flow is unchanged and the imported flow is a copy
                result.find(f => f.id === "tImp").should.eql({ id: "tImp", layout: "LR", locked: true });
                const copies = result.filter(f => f.id !== "tImp");
                copies.should.have.length(1);
                copies[0].layout.should.equal("TB");

                await page.evaluate(() => {
                    RED.nodes.workspace("tImp").locked = false;
                    RED.nodes.eachWorkspace(ws => { if (ws.label === "Import test" && ws.id !== "tImp") { RED.workspaces.delete(ws); } });
                });
            });

            it("imports a copy of the flow and subflow with the imported layout and keeps the existing ones", async function() {
                await createFlowWithSubflow();
                const exported = await exportJSON("flow");
                await changeLocalLayout();

                await startImport(exported);
                await page.click(".red-ui-notification button:has-text('Import copy')");
                await page.waitForTimeout(500);
                // Imported nodes follow the mouse until they are dropped
                await page.mouse.move(900, 600);
                await page.mouse.click(900, 600);
                await page.waitForTimeout(300);

                const result = await page.evaluate(() => {
                    const flows = [];
                    RED.nodes.eachWorkspace(ws => { if (ws.label === "Import test") { flows.push({ id: ws.id, layout: ws.layout }); } });
                    const subflows = [];
                    RED.nodes.eachSubflow(sf => { if (/^Import subflow/.test(sf.name)) { subflows.push({ id: sf.id, layout: sf.layout, wireStyle: sf.wireStyle }); } });
                    return { flows, subflows };
                });
                // The existing flow and subflow keep their own layout
                result.flows.find(f => f.id === "tImp").layout.should.equal("LR");
                result.subflows.find(f => f.id === "sfImp").should.containEql({ layout: "LR", wireStyle: "curved" });
                // The copies have new ids and the imported layout
                const copies = result.subflows.filter(f => f.id !== "sfImp");
                copies.should.have.length(1);
                copies[0].should.containEql({ layout: "TB", wireStyle: "orthogonal" });
                const flowCopies = result.flows.filter(f => f.id !== "tImp");
                flowCopies.forEach(f => f.layout.should.equal("TB"));
            });
        });
    });

    describe("admin api", function() {
        it("keeps the layout when a single flow is added, read and updated", async function() {
            const added = await sendJSON("POST", url + "/flow", {
                label: "API flow",
                layout: "TB",
                wireStyle: "orthogonal",
                nodes: [
                    { id: "api1", type: "inject", name: "api start", props: [], repeat: "", once: false, topic: "", x: 200, y: 80, wires: [["api2"]] },
                    { id: "api2", type: "debug", name: "api end", active: true, o: "LR", x: 200, y: 200, wires: [] }
                ]
            });
            const flow = await getJSON(url + "/flow/" + added.id);
            flow.layout.should.equal("TB");
            flow.wireStyle.should.equal("orthogonal");
            flow.nodes.find(n => n.id === "api2").o.should.equal("LR");

            flow.layout = "auto";
            delete flow.wireStyle;
            await sendJSON("PUT", url + "/flow/" + added.id, flow);
            const updated = await getJSON(url + "/flow/" + added.id);
            updated.layout.should.equal("auto");
            updated.should.not.have.property("wireStyle");

            // The editor picks up the flow added through the API
            await page.reload();
            await page.waitForSelector(".red-ui-flow-node-group", { timeout: 30000 });
            const tab = await page.evaluate(id => {
                const ws = RED.nodes.workspace(id);
                return { layout: ws.layout, wireStyle: ws.wireStyle };
            }, added.id);
            tab.should.eql({ layout: "auto", wireStyle: undefined });
            await sendJSON("DELETE", url + "/flow/" + added.id).catch(() => {});
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

(playwright ? describe : describe.skip)("editor flow layout with editorTheme.flowLayout.enabled not set (e2e)", function() {
    this.timeout(60000);

    let userDir;
    let server;
    let url;
    let browser;
    let page;
    let pageErrors;

    before(async function() {
        ({ server, url, userDir } = await startNodeRED({ tours: false }));
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

    function orientation(id) {
        return page.evaluate(id => RED.view.layout.getNodeOrientation(RED.nodes.node(id)), id);
    }

    function linkPath(sourceId, targetId) {
        return page.evaluate(([sourceId, targetId]) => {
            const link = Array.from(document.querySelectorAll(".red-ui-flow-link")).find(el => el.__data__.source.id === sourceId && el.__data__.target.id === targetId);
            return link ? link.querySelector(".red-ui-flow-link-line").getAttribute("d") : null;
        }, [sourceId, targetId]);
    }

    async function setUserDefaults(view) {
        await Promise.all([
            page.waitForResponse(res => /\/settings\/user$/.test(res.url())),
            page.evaluate(view => {
                const editor = RED.settings.get("editor");
                Object.assign(editor.view, view);
                RED.settings.set("editor", editor, true);
                RED.view.redraw(true, true);
            }, view)
        ]);
    }

    it("shows no flow layout controls", async function() {
        (await page.evaluate(() => RED.view.layout.isEnabled())).should.be.false();

        // Flow properties
        await showFlow("tTB");
        await page.evaluate(() => RED.editor.editFlow(RED.nodes.workspace("tTB")));
        await page.waitForSelector("#node-input-name");
        should(await page.$("#node-input-flow-layout")).be.null();
        should(await page.$("#node-input-flow-wire-style")).be.null();
        // Let the info editor finish loading before the dialog is closed
        await page.waitForTimeout(1000);
        await page.click("#node-dialog-cancel");
        await page.waitForTimeout(300);

        // Node appearance
        await page.evaluate(() => RED.editor.edit(RED.nodes.node("v1")));
        await page.waitForSelector("#node-input-show-label", { state: "attached" });
        should(await page.$("#node-input-port-orientation")).be.null();
        await page.waitForTimeout(1000);
        await page.click("#node-dialog-cancel");
        await page.waitForTimeout(300);

        // User settings
        await page.evaluate(() => RED.actions.invoke("core:show-user-settings"));
        await page.waitForSelector("#user-settings-view-node-show-label", { state: "attached" });
        should(await page.$("#user-settings-view-flow-layout")).be.null();
        should(await page.$("#user-settings-view-wire-style")).be.null();
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);

        // Context menu and actions
        const layoutLabels = await page.evaluate(() => [RED._("layout.setHorizontal"), RED._("layout.setVertical"), RED._("layout.setInherit")]);
        const labels = await contextMenuLabels(page, "v1");
        labels.length.should.be.above(0);
        layoutLabels.forEach(l => labels.should.not.containEql(l));
        const actions = await page.evaluate(() => RED.actions.list().map(a => a.id));
        actions.should.containEql("core:show-selected-node-labels");
        ["core:set-selected-node-ports-horizontal", "core:set-selected-node-ports-vertical", "core:reset-selected-node-ports"]
            .forEach(a => actions.should.not.containEql(a));
    });

    it("draws flows with saved layout properties from their data", async function() {
        await showFlow("tTB");
        (await orientation("v1")).should.equal("TB");
        await showFlow("tMix");
        (await orientation("m1")).should.equal("LR");
        (await orientation("m3")).should.equal("TB");
        await showFlow("tOrth");
        (await linkPath("o0", "o1")).should.not.match(/C/);
    });

    it("draws flows without layout properties with the classic curve", async function() {
        await showFlow("tLR");
        (await orientation("h1")).should.equal("LR");
        const expected = await page.evaluate(() => {
            const s = RED.nodes.node("h0");
            const t = RED.nodes.node("h1");
            return RED.viewLayout.generateLinkPath(s.x + s.w / 2, s.y, t.x - t.w / 2, t.y, 1, false);
        });
        (await linkPath("h0", "h1")).should.equal(expected);
    });

    it("ignores the user's default layout settings and keeps them", async function() {
        await setUserDefaults({ "view-flow-layout": "TB", "view-wire-style": "orthogonal" });
        try {
            await showFlow("tLR");
            (await orientation("h1")).should.equal("LR");
            const exported = await page.evaluate(() => RED.nodes.createCompleteNodeSet({ flowLayoutDefaults: true }));
            const tLR = exported.find(n => n.id === "tLR");
            tLR.should.not.have.property("layout");
            tLR.should.not.have.property("wireStyle");
            const view = await page.evaluate(() => RED.settings.get("editor").view);
            view.should.containEql({ "view-flow-layout": "TB", "view-wire-style": "orthogonal" });
        } finally {
            await setUserDefaults({ "view-flow-layout": "LR", "view-wire-style": "curved" });
        }
    });

    it("keeps the layout properties on edit and deploy", async function() {
        await page.evaluate(() => {
            const n = RED.nodes.node("v3");
            n.name = "renamed";
            n.changed = true;
            n.dirty = true;
            RED.nodes.dirty(true);
        });
        await page.evaluate(() => RED.actions.invoke("core:deploy-flows"));
        await page.waitForFunction(() => !RED.nodes.dirty(), null, { timeout: 10000 });
        const flows = await getJSON(url + "/flows");
        flows.find(n => n.id === "v3").name.should.equal("renamed");
        flows.find(n => n.id === "tTB").layout.should.equal("TB");
        flows.find(n => n.id === "tOrth").wireStyle.should.equal("orthogonal");
        flows.find(n => n.id === "m3").o.should.equal("TB");
        flows.find(n => n.id === "tLR").should.not.have.property("layout");
        flows.find(n => n.id === "tLR").should.not.have.property("wireStyle");
    });
});

(playwright ? describe : describe.skip)("editor with the telemetry setting locked by the administrator (e2e, P-03)", function() {
    this.timeout(60000);

    let userDir;
    let server;
    let url;
    let browser;

    before(async function() {
        ({ server, url, userDir } = await startNodeRED({ tours: false }, { telemetry: { enabled: false, locked: true } }));
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

    it("does not show the consent prompt and shows the toggle disabled with the effective value", async function() {
        const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
        const pageErrors = [];
        page.on("pageerror", err => pageErrors.push(err.message));
        try {
            await page.goto(url);
            await page.waitForSelector(".red-ui-flow-node-group", { timeout: 30000 });
            await page.waitForTimeout(500);
            (await page.evaluate(() => RED.settings.telemetryLocked)).should.be.true();
            should.not.exist(await page.$("text=No, do not enable notifications"));
            await page.evaluate(() => RED.actions.invoke("core:show-user-settings"));
            await page.waitForSelector("#user-settings-telemetryEnabled", { state: "attached" });
            (await page.$eval("#user-settings-telemetryEnabled", el => el.disabled)).should.be.true();
            (await page.$eval("#user-settings-telemetryEnabled", el => el.checked)).should.be.false();
            const label = await page.$eval("label[for='user-settings-telemetryEnabled']", el => el.textContent);
            label.should.containEql("This setting has been set by the administrator and cannot be changed.");
            // Closing the dialog does not send the locked value
            const requests = [];
            page.on("request", req => {
                if (/\/settings\/user$/.test(req.url()) && req.method() === "POST") {
                    requests.push(JSON.parse(req.postData() || "{}"));
                }
            });
            await page.evaluate(() => RED.tray.close());
            await page.waitForTimeout(500);
            requests.forEach(body => body.should.not.have.property("telemetryEnabled"));
        } finally {
            await page.close();
        }
        pageErrors.should.eql([]);
    });
});
