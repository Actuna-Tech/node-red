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
 *   #37: a static guard of the editor sources - the message of RED.notify (HTML) does not take text of
 *   an exception, a server response or a user without escaping it, and RED.utils.sanitize is used
 *   only where its output goes to HTML (R1 of the review of #36)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const fs = require("fs");
const path = require("path");

const NR_TEST_UTILS = require("nr-test-utils");

const sourceRoot = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js");

function sources(dir, out) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function(entry) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            sources(full, out);
        } else if (/\.js$/.test(entry.name)) {
            out.push(full);
        }
    });
    return out;
}

/**
 * The text from `start` (just after an opening parenthesis) to the matching closing one, or to
 * the first comma of the argument list when `firstArgument` is set. Strings and template literals
 * are skipped, so a parenthesis in a text does not count.
 */
function balanced(text, start, firstArgument) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (c === "'" || c === '"' || c === "`") {
            i++;
            while (i < text.length && text[i] !== c) {
                if (text[i] === "\\") { i++; }
                i++;
            }
        } else if (c === "(" || c === "[" || c === "{") {
            depth++;
        } else if (c === ")" || c === "]" || c === "}") {
            if (depth === 0) {
                return { text: text.substring(start, i), end: i };
            }
            depth--;
        } else if (c === "," && depth === 0 && firstArgument) {
            return { text: text.substring(start, i), end: i };
        }
    }
    throw new Error("unbalanced text from " + start);
}

// calls whose result is escaped (or built by the escaping helpers): what they take is safe
const ESCAPING_CALLS = /(?:(?<![\w.])escape|RED\.errors\.\w+|moduleFailedMessage|stateChangeFailedMessage|revertConfirmMessage|RED\.utils\.sanitize|authRequiredHtml)\(/;

function withoutEscapingCalls(text) {
    let match;
    while ((match = ESCAPING_CALLS.exec(text)) !== null) {
        const open = match.index + match[0].length;
        text = text.substring(0, match.index) + "ESCAPED" + text.substring(balanced(text, open, false).end + 1);
    }
    return text;
}

// text that is not from the message catalog: an exception, a server response, a name or a file
const TAINTED = /\.message\b|\.toString\(\)|\bresponseJSON\b|\bresponseText\b|\b(?:err|error|xhr|entry|msg|data)\.\w+|\bfilename\b|\bmoduleName\b/;

describe("editor-client sources: the text that RED.notify shows as HTML (#37)", function() {
    // [file relative to the source root]: the calls that are checked
    const NOTIFY_CALL = /(?:RED\.notify|[nN]otification\.update)\(/g;
    const files = sources(sourceRoot, []);
    const calls = [];

    before(function() {
        files.forEach(function(file) {
            const text = fs.readFileSync(file, "utf8");
            let match;
            NOTIFY_CALL.lastIndex = 0;
            while ((match = NOTIFY_CALL.exec(text)) !== null) {
                const first = balanced(text, match.index + match[0].length, true).text;
                calls.push({
                    file: path.relative(sourceRoot, file),
                    line: text.substring(0, match.index).split("\n").length,
                    message: first
                });
            }
        });
    });

    it("finds the notifications of the editor (the guard is not empty)", function() {
        files.length.should.be.above(50);
        calls.length.should.be.above(80);
        calls.some(c => c.file === path.join("ui", "palette-editor.js")).should.be.true();
        calls.some(c => c.file === path.join("ui", "view.js")).should.be.true();
        calls.some(c => c.file === "red.js").should.be.true();
    });

    it("no message takes an exception, a response, a name or a file without escaping it", function() {
        const offending = calls.filter(function(call) {
            // a count is not a text
            const rest = withoutEscapingCalls(call.message).replace(/[\w.]+\.length\b/g, "0");
            return TAINTED.test(rest);
        }).map(c => c.file + ":" + c.line + "  " + c.message.replace(/\s+/g, " ").trim());
        offending.should.eql([]);
    });

    describe("the guard sees what it should", function() {
        it("takes a raw exception message", function() {
            TAINTED.test(withoutEscapingCalls('"<p>"+err.message+"</p>"')).should.be.true();
        });

        it("takes a raw message of a response in the parameters of a catalog text", function() {
            TAINTED.test(withoutEscapingCalls('RED._("x.y",{module:entry.name,message:xhr.responseJSON.message})')).should.be.true();
        });

        it("lets an escaped one pass", function() {
            TAINTED.test(withoutEscapingCalls('RED.errors.translateEscaped("x.y",{message:err.message})')).should.be.false();
            TAINTED.test(withoutEscapingCalls('moduleFailedMessage("k",entry.name,xhr.responseJSON.message)')).should.be.false();
            TAINTED.test(withoutEscapingCalls('RED.errors.escape(error.message)+"x"')).should.be.false();
        });
    });
});

describe("editor-client sources: the call sites of RED.utils.sanitize (#37)", function() {
    // RED.utils.sanitize escapes & < > " ' for HTML. These are the files that call it and the
    // number of calls; every one puts the result into HTML (the content of an element, a menu label,
    // a notification, the title of a tray). A new call site is a review: where does the text go?
    // Not for a plain-text sink (.text(), a tooltip given as a string), which would show the entities.
    const EXPECTED = {
        "red.js": 9,                 // lists in a notification (two calls in one line)
        "user.js": 2,                // the user name: a notification and a menu label
        "ui/library.js": 1,          // a notification
        "ui/clipboard.js": 1,        // a notification
        "ui/editor.js": 7,           // the title of a tray (HTML), an option of a select
        "ui/tab-info.js": 1,         // the content of a table cell
        "ui/utils.js": 3             // the content of the debug message values
    };

    it("are only in the files that were reviewed, with the reviewed number of calls", function() {
        const found = {};
        sources(sourceRoot, []).forEach(function(file) {
            const code = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
            const count = (code.match(/\bRED\.utils\.sanitize\b|(?<![\w.])sanitize\(/g) || []).length;
            if (count > 0) {
                found[path.relative(sourceRoot, file).split(path.sep).join("/")] = count;
            }
        });
        // the definition of sanitize in utils.js is not a call site
        found["ui/utils.js"] -= 1;
        // (red.js also uses RED.utils.sanitize as a function value: types.map(RED.utils.sanitize))
        found.should.eql(EXPECTED);
    });

    it("the text that is processed further uses sanitizeContent (markdown, words of a palette label)", function() {
        fs.readFileSync(path.join(sourceRoot, "ui/tab-help.js"), "utf8").should.containEql("RED.utils.sanitizeContent(data)");
        fs.readFileSync(path.join(sourceRoot, "ui/palette.js"), "utf8").should.containEql("RED.utils.sanitizeContent(label)");
    });

    it("the tooltip of a tab is a plain text: the label is not escaped", function() {
        fs.readFileSync(path.join(sourceRoot, "ui/common/tabs.js"), "utf8")
            .should.containEql("RED.popover.tooltip(link,function() { return tab.label; });");
    });
});
