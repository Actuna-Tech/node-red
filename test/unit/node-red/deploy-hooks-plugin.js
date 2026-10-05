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
 *   Z-06 (#10): the test plugin of the acceptance tests of the deploy hooks - it registers a preDeploy
 *   validator and a postDeploy notifier with RED.hooks.add in the child process; what they do is set by
 *   a control file that they read at every call
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * Writes the plugin `test-deploy-hooks` into `<userDir>/node_modules`. The child process must have
 * the environment variables HOOK_CONTROL_FILE (JSON, read at every call) and HOOK_LOG_DIR (the plugin
 * appends one JSON line per call to `pre.log` and `post.log` there).
 *
 * Control file: `{pre, post}`
 *   pre   "accept" (default) | "forbidden" (reject a configuration that has a node of type `inject`) |
 *         "reject" (reject everything) | "fail" (throw a TypeError) | "hang" (no result until the mode changes)
 *   post  "write" (default) | "slow" (writes after 2 s)
 */
const fs = require("fs");
const path = require("path");

const PLUGIN_SOURCE = `
const fs = require("fs");
const path = require("path");
module.exports = function(RED) {
    const controlFile = process.env.HOOK_CONTROL_FILE;
    const logDir = process.env.HOOK_LOG_DIR;
    function control() {
        try {
            return JSON.parse(fs.readFileSync(controlFile, "utf8"));
        } catch (err) {
            return {};
        }
    }
    function record(name, entry) {
        fs.appendFileSync(path.join(logDir, name), JSON.stringify(entry) + "\\n");
    }
    RED.plugins.registerPlugin("test-deploy-hooks", { type: "test-hooks" });
    RED.hooks.add("preDeploy.testValidator", function(event) {
        const mode = control().pre || "accept";
        record("pre.log", { type: event.type, source: event.source, operation: event.operation, flowId: event.flowId, mode: mode });
        if (mode === "forbidden") {
            const forbidden = event.flows.filter(n => n.type === "inject");
            if (forbidden.length > 0) {
                throw Object.assign(new Error("forbidden node type: inject"), { status: 400, code: "forbidden_node", details: { nodes: forbidden.map(n => n.id) } });
            }
        } else if (mode === "reject") {
            throw Object.assign(new Error("every deployment is rejected"), { status: 400, code: "forbidden_node", details: { operation: event.operation } });
        } else if (mode === "fail") {
            throw new TypeError("the validator exploded: secret-detail");
        } else if (mode === "hang") {
            return new Promise(function(resolve) {
                const timer = setInterval(function() {
                    if ((control().pre || "accept") !== "hang") {
                        clearInterval(timer);
                        record("pre.log", { late: "ended" });
                        resolve();
                    }
                }, 50);
            });
        }
    });
    RED.hooks.add("postDeploy.testNotifier", async function(event) {
        if ((control().post || "write") === "slow") {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        record("post.log", { at: Date.now(), source: event.source, rev: event.rev, status: event.start.status, type: event.type, operation: event.operation, flowId: event.flowId, reloadType: event.reloadType });
    });
};
`;

function writePlugin(userDir) {
    const dir = path.join(userDir, "node_modules", "test-deploy-hooks");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
        name: "test-deploy-hooks",
        version: "1.0.0",
        "node-red": { plugins: { "test-deploy-hooks": "test-deploy-hooks.js" } }
    }));
    fs.writeFileSync(path.join(dir, "test-deploy-hooks.js"), PLUGIN_SOURCE);
}

// The lines of a log of the plugin as objects
function readLog(logDir, name) {
    const file = path.join(logDir, name);
    if (!fs.existsSync(file)) {
        return [];
    }
    return fs.readFileSync(file, "utf8").split("\n").filter(l => l).map(l => JSON.parse(l));
}

module.exports = { writePlugin, readLog };
