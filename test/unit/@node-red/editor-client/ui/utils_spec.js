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
 *   #37: tests of RED.utils.sanitize (escapes the quotes too) and RED.utils.sanitizeContent (& < > only)
 *   #63: tests of RED.utils.renderMarkdown (a text that cannot be rendered is escaped, not returned raw)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const cheerio = require("cheerio");

const NR_TEST_UTILS = require("nr-test-utils");
const catalog = require("../helpers/catalog");

const errorsModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/common/errors.js");
const utilsModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/utils.js");

// stands in for the libraries and the DOM that ui/utils.js uses while it is loaded (marked, DOMPurify,
// jQuery): any property is a function that gives such a stand-in
function loose() {
    const f = function() { return loose(); };
    return new Proxy(f, {
        get(target, prop) {
            if (prop === Symbol.toPrimitive) { return () => ""; }
            if (typeof prop === "symbol" || prop === "then") { return undefined; }
            return loose();
        },
        construct() { return loose(); },
        apply() { return loose(); }
    });
}

describe("editor-client/ui/utils (#37)", function() {
    const INJECTION = catalog.INJECTION;
    let savedGlobals;
    let utils;

    beforeEach(function() {
        savedGlobals = { RED: global.RED, window: global.window, $: global.$, DOMPurify: global.DOMPurify };
        global.RED = {};
        delete require.cache[errorsModulePath];
        delete require.cache[utilsModulePath];
        require(errorsModulePath);
        global.window = { marked: loose() };
        global.$ = loose();
        global.DOMPurify = loose();
        require(utilsModulePath);
        utils = RED.utils;
    });

    afterEach(function() {
        delete require.cache[errorsModulePath];
        delete require.cache[utilsModulePath];
        Object.keys(savedGlobals).forEach(function(key) {
            if (savedGlobals[key] === undefined) {
                delete global[key];
            } else {
                global[key] = savedGlobals[key];
            }
        });
    });

    describe("sanitize", function() {
        it("escapes & < > \" and '", function() {
            utils.sanitize(`<a href="x" title='y'>&</a>`).should.equal("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
        });

        it("keeps the text in the value of an attribute: a quote does not close it", function() {
            const text = 'x" onmouseover="alert(1)" data-y=\'z';
            const html = '<span title="' + utils.sanitize(text) + '">t</span>';
            const span = cheerio.load(html)("span");
            span.attr("title").should.equal(text);
            should(span.attr("onmouseover")).be.undefined();
            Object.keys(span.attr()).should.eql(["title"]);
        });

        it("does not create an element from the injection", function() {
            catalog.assertNoElement("<p>" + utils.sanitize(INJECTION) + "</p>", "img");
        });

        it("works as a function of Array.map (red.js lists)", function() {
            ["a<b", "c\"d"].map(utils.sanitize).should.eql(["a&lt;b", "c&quot;d"]);
        });
    });

    describe("sanitizeContent", function() {
        it("escapes only & < >: the text goes through markdown or is cut by characters", function() {
            utils.sanitizeContent(`a "b" 'c' <d> &`).should.equal(`a "b" 'c' &lt;d&gt; &amp;`);
        });
    });

    describe("renderMarkdown (#63, B1-AC-3, B1-AC-4)", function() {
        let savedMarkdownGlobals;
        let warn;

        beforeEach(function() {
            savedMarkdownGlobals = { _marked: global._marked, DOMPurify: global.DOMPurify };
            warn = sinon.stub(console, "warn");
        });

        afterEach(function() {
            warn.restore();
            Object.keys(savedMarkdownGlobals).forEach(function(key) {
                if (savedMarkdownGlobals[key] === undefined) {
                    delete global[key];
                } else {
                    global[key] = savedMarkdownGlobals[key];
                }
            });
        });

        it("B1-AC-3: a text the markdown library cannot render is shown as text, not as raw HTML", function() {
            global._marked = { parse() { throw new Error("x"); } };
            const input = "<img src=x onerror=alert(1)>";
            const result = utils.renderMarkdown(input);
            result.should.equal(utils.sanitize(input));
            result.should.not.containEql("<img");
            catalog.assertNoElement("<p>" + result + "</p>", "img");
        });

        it("B1-AC-3: the escaping covers the quotes and ampersands of the text too", function() {
            global._marked = { parse() { throw new Error("x"); } };
            utils.renderMarkdown("a \"b\" 'c' & <d>").should.equal("a &quot;b&quot; &#39;c&#39; &amp; &lt;d&gt;");
        });

        it("B1-AC-3: what is no text is returned unchanged when the markdown library throws", function() {
            global._marked = { parse() { throw new Error("x"); } };
            const object = { a: 1 };
            should(utils.renderMarkdown(undefined)).equal(undefined);
            should(utils.renderMarkdown(null)).equal(null);
            utils.renderMarkdown(5).should.equal(5);
            utils.renderMarkdown(object).should.equal(object);
        });

        it("B1-AC-4: a text that is rendered gives the result of DOMPurify (unchanged behaviour)", function() {
            global._marked = { parse() { return "<p>a</p>"; } };
            const seen = [];
            global.DOMPurify = { sanitize(html) { seen.push(html); return "cleaned:" + html; } };
            utils.renderMarkdown("a").should.equal("cleaned:<p>a</p>");
            seen.should.eql(["<p>a</p>"]);
        });
    });
});
