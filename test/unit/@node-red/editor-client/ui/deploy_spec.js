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
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");

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
});
