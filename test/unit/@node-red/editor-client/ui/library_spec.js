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
 *   #30: a failed save to the library (library dialog, export dialog of the clipboard) shows a
 *   readable, escaped message instead of the raw body of the response
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const fs = require("fs");

const NR_TEST_UTILS = require("nr-test-utils");

const deployModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/deploy.js");
const libraryModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/library.js");
const clipboardModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/clipboard.js");

describe("editor-client/ui/library (#30)", function() {
    const enUS = JSON.parse(fs.readFileSync(NR_TEST_UTILS.resolve("@node-red/editor-client/locales/en-US/editor.json")));
    const INJECTION = "<img src=x onerror=alert(1)>";
    let library;
    let notifications;
    let savedGlobals;

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

    function lastNotification() {
        return notifications[notifications.length - 1];
    }

    function assertNoMarkup(n) {
        n.msg.should.not.containEql("<img");
        n.msg.should.not.containEql("<script");
        n.msg.should.not.containEql("onerror=alert(1)>");
        n.msg.should.not.containEql('{"');
    }

    beforeEach(function() {
        savedGlobals = { RED: global.RED, $: global.$, window: global.window };
        notifications = [];
        global.RED = {
            _: translate,
            notify: function(msg, options) {
                const n = { msg, options };
                notifications.push(n);
                return n;
            }
        };
        global.$ = function() { return {}; };
        global.window = {};
        delete require.cache[deployModulePath];
        delete require.cache[libraryModulePath];
        require(deployModulePath);
        library = require(libraryModulePath);
    });

    afterEach(function() {
        sinon.restore();
        delete require.cache[deployModulePath];
        delete require.cache[libraryModulePath];
        Object.keys(savedGlobals).forEach(function(key) {
            if (savedGlobals[key] === undefined) {
                delete global[key];
            } else {
                global[key] = savedGlobals[key];
            }
        });
    });

    it("exports RED.library for tests", function() {
        library.should.equal(RED.library);
        library.should.have.property("notifySaveFailed").which.is.a.Function();
    });

    describe("a failed save", function() {
        it("shows the message of a JSON response, readable", function() {
            const body = { code: "forbidden", message: "Library is read only" };
            library.notifySaveFailed({ status: 403, responseJSON: body, responseText: JSON.stringify(body) });
            notifications.should.have.length(1);
            lastNotification().msg.should.equal("Save failed: Library is read only");
            lastNotification().options.should.equal("error");
        });

        it("reads a JSON body from responseText when jQuery did not parse it", function() {
            library.notifySaveFailed({ status: 400, responseText: JSON.stringify({ message: "Invalid name" }) });
            lastNotification().msg.should.equal("Save failed: Invalid name");
        });

        it("escapes markup and quotes in the message of a JSON response", function() {
            const body = { message: INJECTION + " \"q\" 'a' &" };
            library.notifySaveFailed({ status: 500, responseJSON: body, responseText: JSON.stringify(body) });
            assertNoMarkup(lastNotification());
            lastNotification().msg.should.containEql("&lt;img src=x onerror=alert(1)&gt;");
            lastNotification().msg.should.containEql("&quot;q&quot; &#39;a&#39; &amp;");
        });

        it("never shows a body that is not JSON, only a generic text with the HTTP status", function() {
            library.notifySaveFailed({ status: 502, responseText: "<html>" + INJECTION + "</html>" });
            assertNoMarkup(lastNotification());
            lastNotification().msg.should.equal("Save failed: unexpected response from the server (HTTP 502)");
        });

        it("shows the generic text when the JSON body has no message", function() {
            const body = { code: "x", note: INJECTION };
            library.notifySaveFailed({ status: 500, responseJSON: body, responseText: JSON.stringify(body) });
            assertNoMarkup(lastNotification());
            lastNotification().msg.should.equal("Save failed: unexpected response from the server (HTTP 500)");
        });

        it("shows the no response text when there is no HTTP response (network error)", function() {
            library.notifySaveFailed({ status: 0 });
            lastNotification().msg.should.equal("Save failed: no response from server");
            library.notifySaveFailed({});
            lastNotification().msg.should.equal("Save failed: no response from server");
        });

        it("401 shows the catalog text, not the response", function() {
            library.notifySaveFailed({ status: 401, responseText: INJECTION });
            assertNoMarkup(lastNotification());
            lastNotification().msg.should.equal("Save failed: Not authorized");
        });
    });

    describe("saveToLibrary (the Save button of the library dialog)", function() {
        let $;
        let requests;
        let dialogs;
        let menuOptions;

        // jQuery stand-in: selected elements are kept per selector, any other call is chainable;
        // dialog(options) is recorded and $.ajax records the requests
        function createJQueryMock() {
            const registry = {};
            function makeElement(selector) {
                const api = {
                    val() { return "name-" + selector; },
                    height() { return 800; },
                    dialog(options) { if (options && typeof options === "object") { dialogs[selector] = options; } return proxy; }
                };
                const proxy = new Proxy(api, {
                    get(target, prop) {
                        if (prop in target) { return target[prop]; }
                        if (typeof prop === "symbol" || prop === "then") { return undefined; }
                        return function() { return proxy; };
                    }
                });
                return proxy;
            }
            function jq(selector) {
                if (typeof selector === "string" && selector.charAt(0) !== "<") {
                    registry[selector] = registry[selector] || makeElement(selector);
                    return registry[selector];
                }
                return makeElement(String(selector));
            }
            jq.ajax = function(opts) {
                const req = {
                    opts,
                    done(fn) { req._done = fn; return req; },
                    fail(fn) { req._fail = fn; return req; }
                };
                requests.push(req);
                return req;
            };
            return jq;
        }

        // Opens the save dialog of a library type and presses Save: the request is the one in `requests`
        function save() {
            library.init();
            library.createBrowser.should.be.ok();
            library.create({
                type: "function", url: "functions", ext: "js", fields: ["name"],
                editor: { getValue: function() { return "text"; } }
            });
            menuOptions.find(o => /menu-save-library$/.test(o.id)).onselect();
            const buttons = dialogs["#red-ui-library-dialog-save"].buttons;
            buttons[buttons.length - 1].click.call({});
            requests.should.have.length(1);
            requests[0].opts.url.should.equal("library/local/functions/name-#red-ui-library-dialog-save-filename");
        }

        beforeEach(function() {
            requests = [];
            dialogs = {};
            menuOptions = [];
            $ = createJQueryMock();
            global.$ = $;
            global.window = {};
            RED.settings = { libraries: [{ id: "local", label: "library.library" }] };
            RED.menu = { init: function(def) { menuOptions = def.options; } };
            RED.keyboard = { enable: sinon.stub(), disable: sinon.stub() };
            RED.panels = { create: sinon.stub() };
            const browser = {
                getSelected: function() { return { children: [], library: "local", type: "functions", path: "" }; },
                data: sinon.stub(),
                select: sinon.stub()
            };
            sinon.stub(library, "createBrowser").returns(browser);
            sinon.useFakeTimers();
        });

        it("a failed save with markup in the message shows it escaped, no element from the server", function() {
            save();
            const body = { code: "x", message: INJECTION };
            requests[0]._fail({ status: 500, responseJSON: body, responseText: JSON.stringify(body) });
            notifications.should.have.length(1);
            assertNoMarkup(lastNotification());
            lastNotification().msg.should.equal("Save failed: &lt;img src=x onerror=alert(1)&gt;");
            lastNotification().options.should.equal("error");
        });

        it("a failed save with markup in a body that is not JSON shows only a generic text", function() {
            save();
            requests[0]._fail({ status: 502, responseText: "<html>" + INJECTION + "</html>" });
            assertNoMarkup(lastNotification());
            lastNotification().msg.should.equal("Save failed: unexpected response from the server (HTTP 502)");
        });

        it("a failed save without a response shows that there is no response", function() {
            save();
            requests[0]._fail({ status: 0 });
            lastNotification().msg.should.equal("Save failed: no response from server");
        });

        it("a failed save with a readable message shows it", function() {
            save();
            const body = { message: "Library is read only" };
            requests[0]._fail({ status: 403, responseJSON: body, responseText: JSON.stringify(body) });
            lastNotification().msg.should.equal("Save failed: Library is read only");
        });
    });

    describe("the wiring of the export dialog of the clipboard", function() {
        // the export dialog needs the whole clipboard UI to be driven: only its wiring is checked
        it("a failed export reports through RED.library.notifySaveFailed, not through the response body", function() {
            const source = fs.readFileSync(clipboardModulePath, "utf8");
            source.should.containEql(".fail(RED.library.notifySaveFailed)");
            source.should.not.match(/library\.saveFailed[^\n]*responseText/);
        });

        it("library.js does not insert the response body into the save failed message", function() {
            const source = fs.readFileSync(libraryModulePath, "utf8");
            source.should.not.match(/library\.saveFailed[^\n]*responseText/);
        });
    });
});
