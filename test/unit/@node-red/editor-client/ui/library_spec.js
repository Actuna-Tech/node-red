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

        it("shows the generic text when there is no body (network error)", function() {
            library.notifySaveFailed({ status: 0 });
            lastNotification().msg.should.equal("Save failed: unexpected response from the server (HTTP 0)");
        });

        it("401 shows the catalog text, not the response", function() {
            library.notifySaveFailed({ status: 401, responseText: INJECTION });
            assertNoMarkup(lastNotification());
            lastNotification().msg.should.equal("Save failed: Not authorized");
        });
    });

    describe("the sources of the save and the export to the library", function() {
        it("library.js and clipboard.js never put a response body into a notification", function() {
            [libraryModulePath, clipboardModulePath].forEach(function(file) {
                const source = fs.readFileSync(file, "utf8");
                source.should.not.match(/responseText/, file);
            });
        });

        it("the export dialog reports a failed save with RED.library.notifySaveFailed", function() {
            const source = fs.readFileSync(clipboardModulePath, "utf8");
            source.should.containEql(".fail(RED.library.notifySaveFailed)");
            source.should.not.containEql('RED.notify(RED._("library.saveFailed"');
        });
    });
});
