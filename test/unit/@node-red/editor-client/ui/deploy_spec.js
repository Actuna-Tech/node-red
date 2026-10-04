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
 *   P-02: tests of the stale flows handling (editorTheme.deploy.staleFlows) and of restart on 409
 *   W-4: 409 version_required does not loop the conflict dialog
 *   Z-15: editor-only instance - no Start/Stop items, "Restart flows" disabled
 *   #22: a saved deployment whose flows did not start takes over the revision; readable, escaped
 *   messages instead of the raw JSON of the response (deploy, restart, start/stop flows)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const fs = require("fs");

const NR_TEST_UTILS = require("nr-test-utils");

const deployModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/deploy.js");

/**
 * Minimal jQuery stand-in: elements selected by a selector string are kept
 * (so their classes and visibility can be checked); any other call is
 * accepted and chainable. $.ajax records the requests and lets tests settle them.
 */
function createJQueryMock() {
    const registry = {};
    function makeElement(selector) {
        const state = { selector, classes: new Set(), visible: false, handlers: {} };
        let proxy;
        const api = {
            addClass(c) { String(c).split(/\s+/).forEach(x => x && state.classes.add(x)); return proxy; },
            removeClass(c) { String(c).split(/\s+/).forEach(x => state.classes.delete(x)); return proxy; },
            hasClass(c) { return state.classes.has(c); },
            is(q) { return q === ":visible" ? state.visible : false; },
            show() { state.visible = true; return proxy; },
            hide() { state.visible = false; return proxy; },
            on(ev, fn) { state.handlers[ev] = fn; return proxy; },
            __state: state
        };
        proxy = new Proxy(api, {
            get(target, prop) {
                if (prop in target) {
                    return target[prop];
                }
                if (typeof prop === "symbol" || prop === "then") {
                    return undefined;
                }
                return function() { return proxy; };
            }
        });
        return proxy;
    }
    function $(selector) {
        if (typeof selector === "string" && selector.charAt(0) !== "<") {
            if (!registry[selector]) {
                registry[selector] = makeElement(selector);
            }
            return registry[selector];
        }
        return makeElement(selector);
    }
    $.requests = [];
    $.ajax = function(opts) {
        const req = {
            opts,
            done(fn) { req._done = fn; return req; },
            fail(fn) { req._fail = fn; return req; },
            always(fn) { req._always = fn; return req; }
        };
        $.requests.push(req);
        return req;
    };
    return $;
}

describe("editor-client/ui/deploy", function() {
    let deploy;
    let mockRED;
    let $;
    let savedGlobals;
    let editorTheme;
    let notifications;
    let commsHandlers;
    let eventHandlers;
    let actions;
    let windowListeners;
    let dirty;

    function load() {
        delete require.cache[deployModulePath];
        deploy = require(deployModulePath);
        deploy.init({});
    }

    function lastNotification() {
        return notifications[notifications.length - 1];
    }

    function deployButton() {
        return $("#red-ui-header-button-deploy");
    }

    beforeEach(function() {
        savedGlobals = { RED: global.RED, $: global.$, window: global.window };
        editorTheme = {};
        notifications = [];
        commsHandlers = {};
        eventHandlers = {};
        actions = {};
        windowListeners = {};
        dirty = true;
        $ = createJQueryMock();
        mockRED = {
            _: function(key) { return key; },
            settings: {
                theme: function(property, defaultValue) {
                    const parts = property.split(".");
                    let v = editorTheme;
                    for (let i = 0; i < parts.length; i++) {
                        if (v === undefined || v === null) {
                            return defaultValue;
                        }
                        v = v[parts[i]];
                    }
                    return v === undefined ? defaultValue : v;
                },
                user: { permissions: "*" }
            },
            menu: { init: sinon.stub(), setSelected: sinon.stub() },
            actions: { add: function(name, fn) { actions[name] = fn; }, invoke: sinon.stub() },
            events: {
                on: function(name, fn) { eventHandlers[name] = fn; },
                emit: sinon.stub()
            },
            comms: { subscribe: function(topic, fn) { commsHandlers[topic] = fn; } },
            user: { hasPermission: function() { return true; } },
            nodes: {
                dirty: function(state) { if (state !== undefined) { dirty = state; } return dirty; },
                version: sinon.stub().returns("rev-1"),
                createCompleteNodeSet: sinon.stub().returns([{ id: "n1", type: "inject" }]),
                originalFlow: sinon.stub(),
                eachConfig: function() {},
                eachNode: function() {},
                eachGroup: function() {},
                eachJunction: function() {},
                eachSubflow: function() {},
                eachWorkspace: function() {}
            },
            notify: function(msg, options) {
                const n = { msg, options, close: sinon.stub(), update: sinon.stub(), hideNotification: sinon.stub(), showNotification: sinon.stub() };
                notifications.push(n);
                return n;
            },
            notifications: { shade: { show: sinon.stub(), hide: sinon.stub() } },
            diff: { getRemoteDiff: sinon.stub(), showRemoteDiff: sinon.stub(), mergeDiff: sinon.stub() },
            history: { markAllDirty: sinon.stub() },
            view: { redraw: sinon.stub() },
            sidebar: { config: { refresh: sinon.stub() } }
        };
        global.RED = mockRED;
        global.$ = $;
        global.window = {
            addEventListener: function(name, fn) { windowListeners[name] = fn; },
            location: { reload: sinon.stub() }
        };
    });

    afterEach(function() {
        sinon.restore();
        delete require.cache[deployModulePath];
        Object.keys(savedGlobals).forEach(function(key) {
            if (savedGlobals[key] === undefined) {
                delete global[key];
            } else {
                global[key] = savedGlobals[key];
            }
        });
    });

    it("exports RED.deploy for tests", function() {
        load();
        deploy.should.equal(RED.deploy);
        deploy.should.have.property("init").which.is.a.Function();
    });

    describe("staleFlows: prompt (default)", function() {
        beforeEach(function() {
            load();
        });

        it("409 on deploy shows the conflict dialog with Merge and Overwrite", function() {
            actions["core:deploy-flows"](true);
            $.requests.should.have.length(1);
            JSON.parse($.requests[0].opts.data).should.have.property("rev", "rev-1");
            $.requests[0]._fail({ status: 409 });
            mockRED.diff.getRemoteDiff.calledOnce.should.be.true();
            const ids = lastNotification().options.buttons.map(b => b.id);
            ids.should.containEql("red-ui-deploy-dialog-confirm-deploy-merge");
            ids.should.containEql("red-ui-deploy-dialog-confirm-deploy-overwrite");
            lastNotification().options.buttons.should.have.length(4);
        });

        it("Overwrite deploys without the revision", function() {
            actions["core:deploy-flows"](true);
            $.requests[0]._fail({ status: 409 });
            const overwrite = lastNotification().options.buttons.find(b => b.id === "red-ui-deploy-dialog-confirm-deploy-overwrite");
            deployButton().removeClass("disabled");
            overwrite.click();
            $.requests.should.have.length(2);
            JSON.parse($.requests[1].opts.data).should.not.have.property("rev");
        });

        describe("409 version_required (W-4)", function() {
            function versionRequired(viaText) {
                const body = { code: "version_required", message: "A revision (rev) is required to deploy" };
                return viaText ? { status: 409, responseText: JSON.stringify(body) } : { status: 409, responseJSON: body, responseText: JSON.stringify(body) };
            }
            function buttonIds() {
                return lastNotification().options.buttons.map(b => b.id);
            }
            [false, true].forEach(function(viaText) {
                it("after Ignore & deploy shows the conflict options without Ignore & deploy" + (viaText ? " (responseText)" : ""), function() {
                    const spy = sinon.spy(mockRED, "_");
                    actions["core:deploy-flows"](true);
                    $.requests[0]._fail({ status: 409 });
                    const overwrite = lastNotification().options.buttons.find(b => b.id === "red-ui-deploy-dialog-confirm-deploy-overwrite");
                    deployButton().removeClass("disabled");
                    overwrite.click();
                    JSON.parse($.requests[1].opts.data).should.not.have.property("rev");
                    const count = notifications.length;
                    $.requests[1]._fail(versionRequired(viaText));
                    notifications.length.should.equal(count + 1);
                    spy.calledWith("deploy.errors.revisionRequired").should.be.true();
                    const ids = buttonIds();
                    ids.should.not.containEql("red-ui-deploy-dialog-confirm-deploy-overwrite");
                    ids.should.containEql("red-ui-deploy-dialog-confirm-deploy-review");
                    ids.should.containEql("red-ui-deploy-dialog-confirm-deploy-merge");
                    ids.should.containEql("red-ui-deploy-dialog-confirm-deploy-reload");
                    mockRED.diff.getRemoteDiff.calledTwice.should.be.true();
                });
            });
            it("the reload option reloads the editor", function() {
                actions["core:deploy-flows"](true, true);
                $.requests[0]._fail(versionRequired());
                lastNotification().options.buttons.find(b => b.id === "red-ui-deploy-dialog-confirm-deploy-reload").click();
                window.location.reload.calledOnce.should.be.true();
                // no further deploy request
                $.requests.should.have.length(1);
            });
            it("a 409 version_mismatch keeps Ignore & deploy", function() {
                actions["core:deploy-flows"](true);
                $.requests[0]._fail({ status: 409, responseJSON: { code: "version_mismatch" } });
                buttonIds().should.containEql("red-ui-deploy-dialog-confirm-deploy-overwrite");
                buttonIds().should.not.containEql("red-ui-deploy-dialog-confirm-deploy-reload");
            });
        });

        it("runtime-deploy notification shows the non-blocking notice", function() {
            commsHandlers["notification/runtime-deploy"]("notification/runtime-deploy", { revision: "rev-2" });
            notifications.should.have.length(1);
            lastNotification().options.should.have.property("id", "background-update");
            lastNotification().options.should.have.property("modal", false);
        });

        it("ignores a runtime-deploy notification with the editor's revision", function() {
            commsHandlers["notification/runtime-deploy"]("notification/runtime-deploy", { revision: "rev-1" });
            notifications.should.have.length(0);
        });
    });

    describe("staleFlows: reload-only", function() {
        beforeEach(function() {
            editorTheme = { deploy: { staleFlows: "reload-only" } };
            load();
        });

        function assertReloadDialog(n) {
            n.options.should.have.property("modal", true);
            n.options.should.have.property("fixed", true);
            n.options.buttons.should.have.length(1);
            n.options.buttons[0].should.have.property("id", "red-ui-deploy-dialog-stale-flows-reload");
            n.options.buttons[0].should.have.property("text", "deploy.confirm.button.reload");
        }

        it("409 shows the reload dialog instead of the conflict dialog", function() {
            actions["core:deploy-flows"](true);
            $.requests[0]._fail({ status: 409 });
            mockRED.diff.getRemoteDiff.called.should.be.false();
            notifications.should.have.length(1);
            assertReloadDialog(lastNotification());
        });

        it("the reload dialog text comes from deploy.confirm.staleFlows", function() {
            const spy = sinon.spy(mockRED, "_");
            actions["core:deploy-flows"](true);
            $.requests[0]._fail({ status: 409 });
            spy.calledWith("deploy.confirm.staleFlows").should.be.true();
            spy.calledWith("deploy.confirm.button.reload").should.be.true();
        });

        it("runtime-deploy notification shows the reload dialog", function() {
            commsHandlers["notification/runtime-deploy"]("notification/runtime-deploy", { revision: "rev-2" });
            notifications.should.have.length(1);
            assertReloadDialog(lastNotification());
        });

        it("shows the reload dialog only once", function() {
            commsHandlers["notification/runtime-deploy"]("notification/runtime-deploy", { revision: "rev-2" });
            commsHandlers["notification/runtime-deploy"]("notification/runtime-deploy", { revision: "rev-3" });
            notifications.should.have.length(1);
        });

        it("ignores a runtime-deploy notification with the editor's revision", function() {
            commsHandlers["notification/runtime-deploy"]("notification/runtime-deploy", { revision: "rev-1" });
            notifications.should.have.length(0);
        });

        it("keeps the deploy button disabled and does not deploy once stale", function() {
            commsHandlers["notification/runtime-deploy"]("notification/runtime-deploy", { revision: "rev-2" });
            deployButton().hasClass("disabled").should.be.true();
            eventHandlers["workspace:dirty"]({ dirty: true });
            deployButton().hasClass("disabled").should.be.true();
            eventHandlers["login"]();
            deployButton().hasClass("disabled").should.be.true();
            deployButton().removeClass("disabled");
            actions["core:deploy-flows"](true);
            $.requests.should.have.length(0);
        });

        it("save(true,true) still sends rev", function() {
            // RED.actions.invoke("core:deploy-flows", true, true) - a deploy with force
            actions["core:deploy-flows"](true, true);
            $.requests.should.have.length(1);
            JSON.parse($.requests[0].opts.data).should.have.property("rev", "rev-1");
        });

        it("a current editor deploys without a dialog", function() {
            actions["core:deploy-flows"](true);
            $.requests[0]._done({ rev: "rev-2" });
            notifications.should.have.length(1);
            notifications[0].options.should.not.have.property("modal");
        });

        it("the reload action reloads the page without the undeployed changes prompt", function() {
            commsHandlers["notification/runtime-deploy"]("notification/runtime-deploy", { revision: "rev-2" });
            lastNotification().options.buttons[0].click();
            window.location.reload.calledOnce.should.be.true();
            const event = { preventDefault: sinon.stub(), stopImmediatePropagation: sinon.stub() };
            windowListeners.beforeunload(event);
            event.preventDefault.called.should.be.false();
        });

        it("does not block restarting the flows", function() {
            commsHandlers["notification/runtime-deploy"]("notification/runtime-deploy", { revision: "rev-2" });
            actions["core:restart-flows"]();
            $.requests.should.have.length(1);
            $.requests[0].opts.headers.should.have.property("Node-RED-Deployment-Type", "reload");
        });

        it("restart: 409 shows the reload dialog", function() {
            actions["core:restart-flows"]();
            $.requests[0]._fail({ status: 409 });
            assertReloadDialog(lastNotification());
        });
    });

    describe("staleFlows: unknown value", function() {
        it("falls back to prompt with a warning in the console", function() {
            const warn = sinon.stub(console, "warn");
            editorTheme = { deploy: { staleFlows: "reload" } };
            load();
            actions["core:deploy-flows"](true);
            $.requests[0]._fail({ status: 409 });
            mockRED.diff.getRemoteDiff.calledOnce.should.be.true();
            warn.called.should.be.true();
        });
    });

    describe("restart", function() {
        it("409 does not throw a ReferenceError and shows the conflict dialog", function() {
            load();
            actions["core:restart-flows"]();
            $.requests.should.have.length(1);
            (function() {
                $.requests[0]._fail({ status: 409 });
            }).should.not.throw();
            mockRED.diff.getRemoteDiff.calledOnce.should.be.true();
        });

        it("keeps the beforeunload prompt for undeployed changes", function() {
            load();
            const event = { preventDefault: sinon.stub(), stopImmediatePropagation: sinon.stub() };
            windowListeners.beforeunload(event);
            event.preventDefault.calledOnce.should.be.true();
        });
    });
    describe("failed deployment (#22)", function() {
        const enUS = JSON.parse(fs.readFileSync(NR_TEST_UTILS.resolve("@node-red/editor-client/locales/en-US/editor.json")));
        const INJECTION = "<img src=x onerror=alert(1)>";
        let version;
        let workspaces;

        // The real en-US catalog: a missing key fails the test, the parameters are interpolated
        function translate(key, params) {
            let value = enUS;
            key.split(".").forEach(function(part) {
                if (value === undefined || value === null || !Object.prototype.hasOwnProperty.call(value, part)) {
                    throw new Error("missing translation key " + key);
                }
                value = value[part];
            });
            return String(value).replace(/__([^_\s]+?)__/g, function(match, name) {
                return params && params[name] !== undefined ? params[name] : match;
            });
        }
        function notificationType(n) {
            return typeof n.options === "string" ? n.options : n.options.type;
        }
        function assertNoRawResponse(n) {
            n.msg.should.not.containEql("<img");
            n.msg.should.not.containEql("<script");
            n.msg.should.not.containEql("onerror=alert(1)>");
            n.msg.should.not.containEql('{"');
            n.msg.should.not.containEql("responseText");
        }
        function fail(xhr) {
            return $.requests[$.requests.length - 1]._fail(xhr);
        }
        function body(obj) {
            return { status: 500, responseJSON: obj, responseText: JSON.stringify(obj) };
        }
        function startFailed(errors, rev) {
            const obj = { code: "deploy_start_failed", message: "Deployment saved, but the flows did not start", errors: errors };
            if (rev !== undefined) { obj.rev = rev }
            return body(obj);
        }

        beforeEach(function() {
            version = "rev-1";
            workspaces = {
                t1: { id: "t1", label: INJECTION },
                t2: { id: "t2", label: "Flow 2" },
                t3: { id: "t3", label: "Flow 3" }
            };
            mockRED._ = translate;
            mockRED.nodes.version = sinon.spy(function(v) { if (v !== undefined) { version = v } return version; });
            mockRED.nodes.workspace = function(id) { return workspaces[id]; };
            mockRED.nodes.subflow = function() { return null; };
        });

        describe("saved but the flows did not start (deploy_start_failed with rev)", function() {
            beforeEach(function() {
                load();
                actions["core:deploy-flows"](true);
            });

            it("takes over the revision and marks the changes as deployed", function() {
                dirty.should.be.true();
                fail(startFailed([{ code: "flow_start_failed", message: "boom", flow: "t2" }], "rev-2"));
                dirty.should.be.false();
                version.should.equal("rev-2");
                mockRED.nodes.originalFlow.calledOnce.should.be.true();
                mockRED.history.markAllDirty.calledOnce.should.be.true();
                mockRED.events.emit.calledWith("deploy").should.be.true();
            });
            it("shows one red error notification with the causes, escaped, without raw JSON", function() {
                fail(startFailed([
                    { code: "flow_start_failed", message: "boom " + INJECTION, flow: "t1" },
                    { code: "flow_start_failed", message: "no flow" },
                    { code: "missing_types", message: "Missing node types", types: ["a-type", INJECTION] },
                    { code: "missing_modules", message: "Missing modules", modules: [{ module: "mod-x", error: "E" }] },
                    { code: "safe_mode", message: "Flows not started in safe mode" }
                ], "rev-2"));
                notifications.should.have.length(1);
                const n = lastNotification();
                notificationType(n).should.equal("error");
                n.options.should.have.property("fixed", true);
                assertNoRawResponse(n);
                n.msg.should.containEql(translate("deploy.errors.savedWithErrors"));
                // the label of the tab and the message are escaped
                n.msg.should.containEql('Flow "&lt;img src=x onerror=alert(1)&gt;" failed to start: boom &lt;img src=x onerror=alert(1)&gt;');
                n.msg.should.containEql("A flow failed to start: no flow");
                n.msg.should.containEql("Missing node types: a-type, &lt;img src=x onerror=alert(1)&gt;");
                n.msg.should.containEql("Missing modules: mod-x");
                n.msg.should.containEql("safe mode");
                (n.msg.match(/<li>/g) || []).should.have.length(5);
                // closeable
                n.options.buttons.should.have.length(1);
                n.options.buttons[0].click();
                n.close.calledOnce.should.be.true();
            });
            it("the next deploy sends the new revision", function() {
                fail(startFailed([{ code: "flow_start_failed", message: "boom", flow: "t2" }], "rev-2"));
                deployButton().removeClass("disabled");
                actions["core:deploy-flows"](true);
                $.requests.should.have.length(2);
                JSON.parse($.requests[1].opts.data).should.have.property("rev", "rev-2");
            });
            it("a late runtime-deploy with the revision of the editor shows no 'changed in background' notice", function() {
                const clock = sinon.useFakeTimers();
                fail(startFailed([{ code: "start_timeout", message: "t", timeout: 30, phase: "flows", pending: ["t2"] }], "rev-2"));
                $.requests[0]._always();
                clock.tick(400);
                const count = notifications.length;
                commsHandlers["notification/runtime-deploy"]("notification/runtime-deploy", { revision: "rev-2" });
                notifications.should.have.length(count);
                // a revision of somebody else is still reported
                commsHandlers["notification/runtime-deploy"]("notification/runtime-deploy", { revision: "rev-3" });
                notifications.should.have.length(count + 1);
                lastNotification().options.should.have.property("id", "background-update");
            });
            it("deploy_start_failed without errors[] shows the message", function() {
                fail(body({ code: "deploy_start_failed", message: "Deployment saved " + INJECTION, rev: "rev-2" }));
                dirty.should.be.false();
                assertNoRawResponse(lastNotification());
                lastNotification().msg.should.containEql("Deployment saved &lt;img");
            });
        });

        describe("saved but the flows did not start - reload-only", function() {
            it("a late runtime-deploy with the revision of the editor shows no reload dialog", function() {
                editorTheme = { deploy: { staleFlows: "reload-only" } };
                load();
                const clock = sinon.useFakeTimers();
                actions["core:deploy-flows"](true);
                fail(startFailed([{ code: "start_timeout", message: "t" }], "rev-2"));
                $.requests[0]._always();
                clock.tick(400);
                const count = notifications.length;
                commsHandlers["notification/runtime-deploy"]("notification/runtime-deploy", { revision: "rev-2" });
                notifications.should.have.length(count);
                notifications.filter(n => n.options && n.options.modal).should.have.length(0);
                // a revision of somebody else still blocks the editor
                commsHandlers["notification/runtime-deploy"]("notification/runtime-deploy", { revision: "rev-3" });
                lastNotification().options.should.have.property("modal", true);
            });
        });

        describe("start_timeout", function() {
            beforeEach(function() {
                load();
                actions["core:deploy-flows"](true);
            });
            it("lists the flows not started, the current one and the phase", function() {
                fail(startFailed([{ code: "start_timeout", message: "The flows did not start within 30000 ms", timeout: 30000, phase: "flows", startedAt: 1, elapsed: 30001, pending: ["t1", "t2", "t3"], current: "t1" }], "rev-2"));
                dirty.should.be.false();
                const n = lastNotification();
                notificationType(n).should.equal("error");
                assertNoRawResponse(n);
                n.msg.should.containEql("The start takes longer than 30 s and continues in the background.");
                n.msg.should.containEql("Phase: starting the flows.");
                n.msg.should.containEql("Starting now: &lt;img src=x onerror=alert(1)&gt;.");
                n.msg.should.containEql("Not started yet: &lt;img src=x onerror=alert(1)&gt;, Flow 2, Flow 3.");
                n.msg.should.containEql("The result will be shown when the start ends.");
            });
            it("names the phase modules and has no flows to list", function() {
                fail(startFailed([{ code: "start_timeout", message: "t", timeout: 500, phase: "modules", pending: [] }], "rev-2"));
                const n = lastNotification();
                n.msg.should.containEql("The start takes longer than 0.5 s");
                n.msg.should.containEql("Phase: checking the modules required by the flows.");
                n.msg.should.not.containEql("Not started yet");
                n.msg.should.not.containEql("Starting now");
            });
            it("crops a long list of pending flows and shows the global nodes by name", function() {
                const ids = ["global"];
                for (let i = 0; i < 8; i++) { ids.push("x" + i) }
                fail(startFailed([{ code: "start_timeout", message: "t", phase: "flows", pending: ids, current: "global" }], "rev-2"));
                const n = lastNotification();
                n.msg.should.containEql("The start takes longer than the limit for the response");
                n.msg.should.containEql("Starting now: global nodes.");
                n.msg.should.containEql("+ 4 more");
            });
            it("an old runtime without the additive fields still gives a readable message", function() {
                fail(startFailed([{ code: "start_timeout", message: "The flows did not start within 30000 ms" }], "rev-2"));
                lastNotification().msg.should.containEql("continues in the background");
            });
        });

        describe("saved but the previous nodes could not be stopped (deploy_stop_failed with rev)", function() {
            beforeEach(function() {
                load();
                actions["core:deploy-flows"](true);
            });
            it("takes over the revision and shows a red error", function() {
                fail(body({ code: "deploy_stop_failed", message: "stop failed " + INJECTION, rev: "rev-2" }));
                dirty.should.be.false();
                version.should.equal("rev-2");
                const n = lastNotification();
                notificationType(n).should.equal("error");
                assertNoRawResponse(n);
                n.msg.should.containEql("The previous nodes could not be stopped: stop failed &lt;img");
            });
            it("without a message", function() {
                fail(body({ code: "deploy_stop_failed", rev: "rev-2" }));
                lastNotification().msg.should.containEql("The previous nodes could not be stopped.");
            });
        });

        describe("other errors", function() {
            beforeEach(function() {
                load();
                actions["core:deploy-flows"](true);
            });
            it("400 without rev keeps the changes dirty and shows the message, not the JSON", function() {
                fail({ status: 400, responseJSON: { code: "invalid_flow", message: "Invalid flow " + INJECTION }, responseText: '{"code":"invalid_flow","message":"Invalid flow <img src=x onerror=alert(1)>"}' });
                dirty.should.be.true();
                version.should.equal("rev-1");
                deployButton().hasClass("disabled").should.be.false();
                const n = lastNotification();
                notificationType(n).should.equal("error");
                assertNoRawResponse(n);
                n.msg.should.equal("Deploy failed: Invalid flow &lt;img src=x onerror=alert(1)&gt;");
            });
            it("reads the message from responseText when there is no responseJSON", function() {
                fail({ status: 400, responseText: '{"code":"x","message":"plain message"}' });
                lastNotification().msg.should.equal("Deploy failed: plain message");
            });
            it("deploy_start_failed without a rev keeps the changes dirty", function() {
                fail(startFailed([{ code: "missing_types", message: "m", types: ["t"] }]));
                dirty.should.be.true();
                version.should.equal("rev-1");
                mockRED.nodes.originalFlow.called.should.be.false();
                lastNotification().msg.should.containEql("Missing node types: t");
            });
            it("a response that is not JSON gives a generic message and no HTML from it", function() {
                fail({ status: 502, responseText: "<html><body>Bad Gateway " + INJECTION + "</body></html>" });
                dirty.should.be.true();
                const n = lastNotification();
                n.msg.should.equal("Deploy failed: unexpected response from the server (HTTP 502)");
                assertNoRawResponse(n);
                n.msg.should.not.containEql("<html>");
            });
            it("a JSON response without a message gives a generic message", function() {
                fail({ status: 500, responseJSON: { code: "unexpected_error" }, responseText: '{"code":"unexpected_error"}' });
                lastNotification().msg.should.equal("Deploy failed: unexpected response from the server (HTTP 500)");
            });
            it("no response keeps the message of before", function() {
                fail({ status: 0 });
                dirty.should.be.true();
                lastNotification().msg.should.equal("Deploy failed: no response from server");
            });
            it("409 version_mismatch is unchanged: the conflict dialog, changes dirty", function() {
                fail({ status: 409, responseJSON: { code: "version_mismatch", message: "m" }, responseText: '{"code":"version_mismatch"}' });
                dirty.should.be.true();
                mockRED.diff.getRemoteDiff.calledOnce.should.be.true();
                lastNotification().options.should.have.property("modal", true);
            });
        });

        describe("restart", function() {
            beforeEach(function() {
                load();
                actions["core:restart-flows"]();
            });
            it("shows the causes of a failed start as a red error and does not take over a revision", function() {
                fail(startFailed([{ code: "flow_start_failed", message: "boom", flow: "t2" }], "rev-2"));
                version.should.equal("rev-1");
                dirty.should.be.true();
                const n = lastNotification();
                notificationType(n).should.equal("error");
                n.msg.should.containEql(translate("deploy.errors.startFailed"));
                n.msg.should.not.containEql(translate("deploy.errors.savedWithErrors"));
                n.msg.should.containEql('Flow "Flow 2" failed to start: boom');
            });
            it("shows a readable, escaped message instead of the raw JSON", function() {
                fail({ status: 400, responseJSON: { message: "bad " + INJECTION }, responseText: '{"message":"bad <img src=x onerror=alert(1)>"}' });
                const n = lastNotification();
                notificationType(n).should.equal("error");
                assertNoRawResponse(n);
                n.msg.should.equal("Deploy failed: bad &lt;img src=x onerror=alert(1)&gt;");
            });
            it("a response that is not JSON gives a generic message", function() {
                fail({ status: 503, responseText: "<h1>unavailable</h1>" });
                lastNotification().msg.should.equal("Deploy failed: unexpected response from the server (HTTP 503)");
            });
        });

        describe("start and stop flows", function() {
            beforeEach(function() {
                mockRED.settings.runtimeState = { enabled: true, ui: true };
                load();
                actions["core:start-flows"]();
            });
            it("does not throw on a response that is not JSON and shows a generic message", function() {
                (function() {
                    fail({ status: 502, responseText: "<h1>Bad gateway</h1>" });
                }).should.not.throw();
                lastNotification().msg.should.equal("<strong>Error</strong>: unexpected response from the server (HTTP 502)");
            });
            it("shows the message of the response, escaped", function() {
                fail({ status: 400, responseJSON: { message: "nope " + INJECTION }, responseText: '{"message":"nope <img src=x onerror=alert(1)>"}' });
                const n = lastNotification();
                notificationType(n).should.equal("error");
                n.msg.should.equal("<strong>Error</strong>: nope &lt;img src=x onerror=alert(1)&gt;");
            });
            it("lists the causes of a failed start", function() {
                fail(startFailed([{ code: "missing_types", message: "m", types: ["t1"] }], "rev-9"));
                lastNotification().msg.should.containEql("Missing node types: t1");
                // no deployment: nothing is taken over
                version.should.equal("rev-1");
            });
        });

        describe("RED.deploy.formatStartErrors", function() {
            beforeEach(function() {
                load();
            });
            it("shows the message of an unknown code, escaped", function() {
                deploy.formatStartErrors([{ code: "something_new", message: "new " + INJECTION }]).should.equal(
                    '<ul class="red-ui-deploy-dialog-confirm-list"><li>new &lt;img src=x onerror=alert(1)&gt;</li></ul>');
            });
            it("shows the code of an unknown entry without a message", function() {
                deploy.formatStartErrors([{ code: "something_new" }]).should.containEql("something_new");
            });
            it("tolerates a missing list", function() {
                deploy.formatStartErrors(undefined).should.equal('<ul class="red-ui-deploy-dialog-confirm-list"></ul>');
            });
        });
    });
    describe("editor-only instance (Z-15, R-39)", function() {
        function menuOptions() {
            return mockRED.menu.init.lastCall.args[0].options.filter(o => o);
        }
        it("default: Start/Stop with runtimeState.ui and an enabled Restart flows", function() {
            mockRED.settings.runtimeState = { enabled: true, ui: true };
            load();
            const ids = menuOptions().map(o => o.id);
            ids.should.containEql("deploymenu-item-runtime-start");
            ids.should.containEql("deploymenu-item-runtime-stop");
            const reload = menuOptions().find(o => o.id === "deploymenu-item-reload");
            should(reload.disabled).not.be.true();
            actions.should.have.property("core:start-flows");
        });
        it("editorOnly: no Start/Stop flows, Restart flows disabled with a hint", function() {
            mockRED.settings.runtimeState = { enabled: true, ui: true };
            mockRED.settings.editorOnly = true;
            load();
            const ids = menuOptions().map(o => o.id);
            ids.should.not.containEql("deploymenu-item-runtime-start");
            ids.should.not.containEql("deploymenu-item-runtime-stop");
            const reload = menuOptions().find(o => o.id === "deploymenu-item-reload");
            reload.disabled.should.be.true();
            reload.sublabel.should.equal("deploy.editorOnly");
            actions.should.not.have.property("core:start-flows");
            actions.should.not.have.property("core:stop-flows");
        });
        it("editorOnly: the restart action does not call the server and shows the hint", function() {
            mockRED.settings.editorOnly = true;
            load();
            actions["core:restart-flows"]();
            $.requests.should.have.length(0);
            lastNotification().msg.should.containEql("deploy.editorOnly");
        });
    });
});
