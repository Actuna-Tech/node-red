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
 *   #34: a failed install, update, remove or enable of a module shows the module name and the message of the server escaped
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");

const NR_TEST_UTILS = require("nr-test-utils");
const catalog = require("../helpers/catalog");

const errorsModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/common/errors.js");
const paletteEditorModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/palette-editor.js");

describe("editor-client/ui/palette-editor (#34)", function() {
    const INJECTION = catalog.INJECTION;
    let editor;
    let notifier;
    let requests;
    let savedGlobals;

    // jQuery stand-in: any element call is chainable; $.ajax records the request and lets the test
    // fail it (the callbacks run at once, like a settled request)
    function createJQueryMock() {
        function makeElement() {
            const api = {};
            const proxy = new Proxy(api, {
                get(target, prop) {
                    if (prop in target) { return target[prop]; }
                    if (typeof prop === "symbol" || prop === "then") { return undefined; }
                    return function() { return proxy; };
                }
            });
            return proxy;
        }
        function jq() { return makeElement(); }
        jq.ajax = function(opts) {
            const callbacks = {};
            const req = {
                opts,
                done(fn) { callbacks.done = fn; return req; },
                fail(fn) { callbacks.fail = fn; return req; },
                always(fn) { callbacks.always = fn; return req; },
                // the server answers with an error response
                failWith(xhr) {
                    callbacks.fail(xhr, "error", "err");
                    if (callbacks.always) { callbacks.always(); }
                }
            };
            requests.push(req);
            return req;
        };
        return jq;
    }

    function lastNotification() {
        return notifier.notifications[notifier.notifications.length - 1];
    }

    function button(notification, className) {
        return notification.options.buttons.find(b => b.class && b.class.indexOf(className) !== -1);
    }

    function errorResponse(message) {
        return { status: 400, responseJSON: { message } };
    }

    beforeEach(function() {
        savedGlobals = { RED: global.RED, $: global.$, window: global.window };
        notifier = catalog.createNotifier();
        requests = [];
        global.RED = {
            _: catalog.translate,
            notify: notifier.notify,
            palette: {},
            settings: { get: (key, def) => def },
            utils: { addSpinnerOverlay: () => ({ remove() {}, appendTo() {} }) },
            eventLog: { startEvent() {} },
            actions: { invoke() {} },
            popover: { tooltip() {}, create() {} },
            events: { on() {} }
        };
        global.$ = createJQueryMock();
        global.window = {};
        delete require.cache[errorsModulePath];
        delete require.cache[paletteEditorModulePath];
        require(errorsModulePath);
        editor = require(paletteEditorModulePath);
    });

    afterEach(function() {
        delete require.cache[errorsModulePath];
        delete require.cache[paletteEditorModulePath];
        Object.keys(savedGlobals).forEach(function(key) {
            if (savedGlobals[key] === undefined) {
                delete global[key];
            } else {
                global[key] = savedGlobals[key];
            }
        });
    });

    it("is loaded as RED.palette.editor", function() {
        RED.palette.editor.should.have.property("install").which.is.a.Function();
        editor.install.should.equal(RED.palette.editor.install);
    });

    describe("moduleFailedMessage", function() {
        it("escapes the module and the message, and keeps the HTML of the catalog text", function() {
            editor.moduleFailedMessage("palette.editor.errors.enableFailed", "mod\"ule", INJECTION).should.equal(
                "<p>Failed to enable: mod&quot;ule</p><p>&lt;img src=x onerror=alert(1)&gt;</p><p>Check the log for more information</p>");
        });

        it("covers the failures of enable, disable, install, update and remove", function() {
            ["enable", "disable", "install", "update", "remove"].forEach(function(action) {
                const html = editor.moduleFailedMessage("palette.editor.errors." + action + "Failed", INJECTION, INJECTION);
                catalog.assertNoMarkup(html);
                html.should.containEql("<p>Failed to " + action + ": &lt;img");
            });
        });
    });

    describe("install", function() {
        function confirmInstall(entry) {
            editor.install(entry, {}, function() {});
            const confirm = lastNotification();
            button(confirm, "red-ui-palette-module-install-confirm-button-install").click();
        }

        it("shows the message of a failed install as text", function() {
            confirmInstall({ id: "node-red-contrib-x", version: "1.0.0" });
            requests.should.have.length(1);
            requests[0].failWith(errorResponse("npm failed: " + INJECTION));
            const n = lastNotification();
            n.msg.should.equal("<p>Failed to install: node-red-contrib-x</p><p>npm failed: &lt;img src=x onerror=alert(1)&gt;</p><p>Check the log for more information</p>");
            catalog.assertNoMarkup(n.msg);
            n.options.type.should.equal("error");
        });

        it("shows the module name as text", function() {
            confirmInstall({ id: INJECTION, version: "1.0.0" });
            requests[0].failWith(errorResponse("fail"));
            lastNotification().msg.should.containEql("Failed to install: &lt;img src=x onerror=alert(1)&gt;</p>");
            catalog.assertNoMarkup(lastNotification().msg);
        });
    });

    describe("remove", function() {
        it("shows the message of a failed remove as text", function() {
            editor.remove({ name: "node-red-contrib-x" }, {}, function() {});
            button(lastNotification(), "red-ui-palette-module-install-confirm-button-remove").click();
            requests.should.have.length(1);
            requests[0].failWith(errorResponse(INJECTION));
            const n = lastNotification();
            n.msg.should.equal("<p>Failed to remove: node-red-contrib-x</p><p>&lt;img src=x onerror=alert(1)&gt;</p><p>Check the log for more information</p>");
            catalog.assertNoMarkup(n.msg);
        });
    });

    describe("update", function() {
        it("shows the message of a failed update as text", function() {
            editor.nodeEntries["node-red-contrib-x"] = { info: { version: "1.0.0" } };
            editor.update({ name: "node-red-contrib-x" }, "2.0.0", undefined, {}, function() {});
            button(lastNotification(), "red-ui-palette-module-install-confirm-button-update").click();
            requests.should.have.length(1);
            requests[0].failWith(errorResponse(INJECTION));
            const n = lastNotification();
            n.msg.should.equal("<p>Failed to update: node-red-contrib-x</p><p>&lt;img src=x onerror=alert(1)&gt;</p><p>Check the log for more information</p>");
            catalog.assertNoMarkup(n.msg);
        });
    });

    describe("autoInstallModules", function() {
        it("shows the message of a failed install as text", function() {
            editor.autoInstallModules({ "node-red-contrib-x": "1.0.0" });
            requests.should.have.length(1);
            requests[0].failWith(errorResponse(INJECTION));
            const n = lastNotification();
            n.msg.should.equal("<p>Failed to install: node-red-contrib-x</p><p>&lt;img src=x onerror=alert(1)&gt;</p><p>Check the log for more information</p>");
            catalog.assertNoMarkup(n.msg);
        });
    });
});
