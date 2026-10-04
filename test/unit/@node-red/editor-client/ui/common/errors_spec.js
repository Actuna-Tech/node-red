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
 *   #34: tests of RED.errors, the shared escaping of error texts shown as HTML
 *   #37: notifyGitError, shared by the projects and the version control; httpUrl; translateEscaped keeps numbers
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");

const NR_TEST_UTILS = require("nr-test-utils");
const catalog = require("../../helpers/catalog");

const errorsModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/common/errors.js");

describe("editor-client/ui/common/errors (#34)", function() {
    const INJECTION = catalog.INJECTION;
    let errors;
    let savedRED;

    beforeEach(function() {
        savedRED = global.RED;
        global.RED = { _: catalog.translate };
        delete require.cache[errorsModulePath];
        errors = require(errorsModulePath);
    });

    afterEach(function() {
        delete require.cache[errorsModulePath];
        if (savedRED === undefined) {
            delete global.RED;
        } else {
            global.RED = savedRED;
        }
    });

    it("is RED.errors", function() {
        errors.should.equal(RED.errors);
        ["escape", "httpUrl", "notifyGitError", "parseResponse", "translateEscaped", "translateResponse", "translateException"]
            .forEach(name => errors.should.have.property(name).which.is.a.Function());
    });

    describe("escape", function() {
        it("escapes & < > \" and '", function() {
            errors.escape(`<a href="x" title='y'>&</a>`).should.equal("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
        });

        it("escapes the ampersand first, so an entity is shown as typed", function() {
            errors.escape("&lt;").should.equal("&amp;lt;");
        });

        it("turns the injection into text", function() {
            errors.escape(INJECTION).should.equal("&lt;img src=x onerror=alert(1)&gt;");
            catalog.assertNoMarkup(errors.escape(INJECTION));
        });

        it("gives an empty text for undefined and null, and a text for other values", function() {
            errors.escape(undefined).should.equal("");
            errors.escape(null).should.equal("");
            errors.escape(0).should.equal("0");
            errors.escape(new Error("<b>")).should.equal("Error: &lt;b&gt;");
        });
    });

    describe("parseResponse", function() {
        it("returns responseJSON, or the JSON object of responseText", function() {
            errors.parseResponse({ responseJSON: { a: 1 } }).should.eql({ a: 1 });
            errors.parseResponse({ responseText: '{"a":2}' }).should.eql({ a: 2 });
        });

        it("returns null for no body, text, an array and a scalar", function() {
            should(errors.parseResponse({})).be.null();
            should(errors.parseResponse({ responseText: "<html>" })).be.null();
            should(errors.parseResponse({ responseText: "[1]" })).be.null();
            should(errors.parseResponse({ responseText: "5" })).be.null();
            should(errors.parseResponse({ responseJSON: null, responseText: "" })).be.null();
        });
    });

    describe("translateEscaped", function() {
        it("escapes every value and keeps the HTML of the catalog", function() {
            const html = errors.translateEscaped("palette.editor.errors.installFailed", { module: INJECTION, message: "m\"'" });
            html.should.equal("<p>Failed to install: &lt;img src=x onerror=alert(1)&gt;</p><p>m&quot;&#39;</p><p>Check the log for more information</p>");
        });

        it("does not escape the values again (each call escapes once)", function() {
            const html = errors.translateEscaped("library.saveFailed", { message: "a & b" });
            html.should.equal("Save failed: a &amp; b");
        });
    });

    describe("translateResponse", function() {
        it("shows the escaped message of a JSON response", function() {
            const body = { message: INJECTION + " \"q\" 'a'" };
            const html = errors.translateResponse("library.saveFailed", { status: 500, responseJSON: body, responseText: JSON.stringify(body) });
            html.should.equal("Save failed: &lt;img src=x onerror=alert(1)&gt; &quot;q&quot; &#39;a&#39;");
        });

        it("shows a generic text with the status for a body that is not JSON or has no message", function() {
            errors.translateResponse("library.saveFailed", { status: 502, responseText: "<html>" + INJECTION })
                .should.equal("Save failed: unexpected response from the server (HTTP 502)");
            errors.translateResponse("library.saveFailed", { status: 500, responseJSON: { code: "x", message: "" } })
                .should.equal("Save failed: unexpected response from the server (HTTP 500)");
        });
    });

    describe("translateException", function() {
        it("shows the message of an error of the editor (NODE_RED), escaped", function() {
            const error = new Error("Invalid flow: " + INJECTION);
            error.code = "NODE_RED";
            const html = errors.translateException("notification.error", error);
            html.should.equal("<strong>Error</strong>: Invalid flow: &lt;img src=x onerror=alert(1)&gt;");
        });

        it("shows toString() of any other exception, escaped", function() {
            const html = errors.translateException("notification.error", new TypeError("x <b>y</b>"));
            html.should.equal("<strong>Error</strong>: TypeError: x &lt;b&gt;y&lt;/b&gt;");
        });

        it("the message of a parse error that quotes the pasted text carries no markup", function() {
            let parseError;
            try { JSON.parse(INJECTION); } catch (err) { parseError = err; }
            const error = new Error(RED._("clipboard.invalidFlow", { message: parseError.message }));
            error.code = "NODE_RED";
            const html = errors.translateException("notification.error", error);
            catalog.assertNoMarkup(html);
        });
    });

    describe("notifyGitError (#37; the projects and the version control)", function() {
        let notifier;
        beforeEach(function() {
            notifier = catalog.createNotifier();
            global.RED.notify = notifier.notify;
        });

        it("shows the message of the server as text in a red notification", function() {
            errors.notifyGitError({ code: "git_connection_failed", message: INJECTION });
            notifier.notifications.should.have.length(1);
            notifier.notifications[0].msg.should.equal("&lt;img src=x onerror=alert(1)&gt;");
            notifier.notifications[0].options.should.equal("error");
            catalog.assertNoElement(notifier.notifications[0].msg, "img");
        });

        it("escapes the quotes and shows nothing for a missing message", function() {
            errors.notifyGitError({ message: "a \"b\" 'c'" });
            notifier.notifications[0].msg.should.equal("a &quot;b&quot; &#39;c&#39;");
            errors.notifyGitError({});
            notifier.notifications[1].msg.should.equal("");
        });
    });

    describe("httpUrl (#37; a link or window.open from the remote catalog)", function() {
        it("gives an http or https address, normalized", function() {
            errors.httpUrl("https://example.org/a b?x=1").should.equal("https://example.org/a%20b?x=1");
            errors.httpUrl("http://example.org").should.equal("http://example.org/");
            errors.httpUrl("HTTPS://Example.org/").should.equal("https://example.org/");
        });

        it("gives null for a javascript:, data:, vbscript:, file: or blob: address, also written in a way a browser accepts", function() {
            [
                "javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "\tjava\nscript:alert(1)",
                "data:text/html,<img src=x onerror=alert(1)>", "vbscript:msgbox(1)", "file:///etc/passwd",
                "blob:https://example.org/1", "ftp://example.org/", "//example.org/x", "mailto:a@b.c"
            ].forEach(function(value) {
                should(errors.httpUrl(value)).equal(null, value);
            });
        });

        it("gives null for no address, an empty text and what is no text", function() {
            [undefined, null, "", 5, {}, ["https://example.org"], true].forEach(function(value) {
                should(errors.httpUrl(value)).equal(null);
            });
        });

        it("resolves a relative address against the address of the editor", function() {
            global.window = { location: { href: "https://editor.example/red/" } };
            try {
                errors.httpUrl("docs/x").should.equal("https://editor.example/red/docs/x");
                should(errors.httpUrl("javascript:alert(1)")).equal(null);
            } finally {
                delete global.window;
            }
            should(errors.httpUrl("docs/x")).equal(null);
        });
    });

    describe("translateEscaped (#37)", function() {
        it("keeps a number and a boolean as they are, escapes the rest", function() {
            const seen = [];
            global.RED._ = function(key, params) { seen.push(params); return key; };
            errors.translateEscaped("k", { count: 3, flag: false, name: "<b>", missing: undefined, nothing: null });
            seen[0].count.should.equal(3);
            seen[0].flag.should.equal(false);
            seen[0].name.should.equal("&lt;b&gt;");
            seen[0].missing.should.equal("");
            seen[0].nothing.should.equal("");
        });
    });
});
