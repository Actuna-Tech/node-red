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
 *   #37: a static guard of the editor sources against text from outside the catalog reaching HTML.
 *   It checks the first argument of RED.notify / notification.update, the concatenation of text into
 *   HTML ($("<..."+x), .html(), .append(), .prepend()) in the files that #37 changed, the places that
 *   were fixed (pinned), and the call sites of RED.utils.sanitize. It is a heuristic over the text of the
 *   sources - it does NOT see a text that reaches HTML through a variable that is made elsewhere
 *   (var text = ...; RED.notify(text)), a tray title or the content of a popover that is passed as a
 *   variable, the other files, an attribute that gets an address, or the HTML built by a node. The
 *   behaviour of the fixes is tested by the driving tests of the modules (palette-editor, projects,
 *   tab-versionControl, library, errors, utils); this guard only keeps a fixed place from coming back
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

function read(relative) {
    return fs.readFileSync(path.join(sourceRoot, relative), "utf8");
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

/** The top-level parts of a list (arguments, entries of an object) split at the commas. */
function splitTop(text) {
    const parts = [];
    let from = 0;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
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
            depth--;
        } else if (c === "," && depth === 0) {
            parts.push(text.substring(from, i));
            from = i + 1;
        }
    }
    if (text.substring(from).trim() !== "") {
        parts.push(text.substring(from));
    }
    return parts;
}

// The calls whose result is escaped, or built from escaped values: what they take is safe. The
// escaping of RED.errors only - parseResponse, httpUrl and the rest are not escaping.
const ESCAPING_CALLS = new RegExp("(?:(?<![\\w.])escape|RED\\.errors\\.(?:escape|translateEscaped|translateResponse|translateException|notifyGitError)|" +
    "RED\\.utils\\.sanitize|moduleFailedMessage|stateChangeFailedMessage|revertConfirmMessage|diffTitle|conflictTipMessage|authRequiredHtml)\\(");

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

/**
 * The values of the parameters of the catalog texts (`RED._(key, {...})`) in `text` that are not
 * escaped: every value must be escaped (the call is replaced by ESCAPED), a message of the catalog
 * (`RED._(...)`), a literal, a length, or the parameter must be `count`. Parameters that are not an
 * object literal (`RED._(key, msg)`) cannot be told, they are reported.
 */
function unescapedParameters(text) {
    const found = [];
    const call = /(?<![\w.])RED\._\(/g;
    let match;
    while ((match = call.exec(text)) !== null) {
        const args = splitTop(balanced(text, match.index + match[0].length, false).text);
        if (args.length < 2) {
            continue;
        }
        const params = args[1].trim();
        if (params.charAt(0) !== "{") {
            found.push(params);
            continue;
        }
        splitTop(params.substring(1, params.length - 1)).forEach(function(entry) {
            const colon = entry.indexOf(":");
            const name = (colon === -1 ? entry : entry.substring(0, colon)).trim();
            const value = (colon === -1 ? entry : entry.substring(colon + 1)).trim();
            const allowed = name === "count" || value === "ESCAPED" || /^RED\._\(/.test(value) || /^(?:\d+|"[^"]*"|'[^']*')$/.test(value) ||
                /\.length$/.test(value);
            if (!allowed) {
                found.push(name + ": " + value);
            }
        });
    }
    return found;
}

describe("editor-client sources: the first argument of RED.notify (#37)", function() {
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

    function describeCall(call) {
        return call.file + ":" + call.line + "  " + call.message.replace(/\s+/g, " ").trim();
    }

    it("finds the notifications of the editor (the guard is not empty)", function() {
        files.length.should.be.above(50);
        calls.length.should.be.above(80);
        calls.some(c => c.file === path.join("ui", "palette-editor.js")).should.be.true();
        calls.some(c => c.file === path.join("ui", "view.js")).should.be.true();
        calls.some(c => c.file === "red.js").should.be.true();
    });

    it("no message takes an exception, a response, a name or a file without escaping it", function() {
        calls.filter(function(call) {
            // a count is not a text
            const rest = withoutEscapingCalls(call.message).replace(/[\w.]+\.length\b/g, "0");
            return TAINTED.test(rest);
        }).map(describeCall).should.eql([]);
    });

    it("every parameter of a catalog text in a message is escaped (or a count, a literal, or a catalog text)", function() {
        calls.filter(call => unescapedParameters(withoutEscapingCalls(call.message)).length > 0)
            .map(call => describeCall(call) + "   -> " + unescapedParameters(withoutEscapingCalls(call.message)).join("; "))
            .should.eql([]);
    });

    describe("the guard sees what it should", function() {
        it("takes a raw exception message", function() {
            TAINTED.test(withoutEscapingCalls('"<p>"+err.message+"</p>"')).should.be.true();
        });

        it("takes a raw value in the parameters of a catalog text", function() {
            unescapedParameters('RED._("x.y",{module:entry.name,message:xhr.responseJSON.message})').should.eql(["module: entry.name", "message: xhr.responseJSON.message"]);
            unescapedParameters('RED._("x.y",{type:fullType, error:error})').should.eql(["type: fullType", "error: error"]);
            unescapedParameters('RED._("library.savedType", {type:activeLibrary.type})').should.eql(["type: activeLibrary.type"]);
        });

        it("takes parameters that are not an object literal", function() {
            unescapedParameters('RED._("notification.state.flowsStopped", msg)').should.eql(["msg"]);
        });

        it("lets an escaped value, a count, a literal, a length and a catalog text pass", function() {
            unescapedParameters(withoutEscapingCalls('RED._("x",{a:RED.errors.escape(err.message),count:n,b:"x",c:list.length,d:RED._("y")})')).should.eql([]);
            unescapedParameters(withoutEscapingCalls('RED.errors.translateEscaped("x.y",{message:err.message})')).should.eql([]);
            TAINTED.test(withoutEscapingCalls('moduleFailedMessage("k",entry.name,xhr.responseJSON.message)')).should.be.false();
            TAINTED.test(withoutEscapingCalls('RED.errors.escape(error.message)+"x"')).should.be.false();
        });

        it("does not take parseResponse, httpUrl and the like for escaping", function() {
            TAINTED.test(withoutEscapingCalls('RED.errors.parseResponse(xhr).message')).should.be.true();
            TAINTED.test(withoutEscapingCalls('RED.errors.httpUrl(entry.url)+entry.name')).should.be.true();
            withoutEscapingCalls("RED.errors.parseResponse(xhr)").should.equal("RED.errors.parseResponse(xhr)");
        });
    });
});

describe("editor-client sources: text put into HTML by concatenation, in the files #37 changed", function() {
    // the files where #37 escaped or rebuilt a place; the other files of the editor are not scanned
    const SCANNED = [
        "ui/palette-editor.js", "ui/projects/tab-versionControl.js", "ui/projects/projects.js", "ui/library.js",
        "ui/projects/projectSettings.js", "ui/projects/projectUserSettings.js", "red.js", "nodes.js", "runtime.js"
    ];
    // Operands that were reviewed: they are not text of a remote catalog, a repository or a user.
    // Keyed by the file and the text of the operand, with the reason.
    const REVIEWED = {
        "ui/palette-editor.js::new Intl.NumberFormat().format(entry.downloads.week)": "a formatted number, NaN for anything else",
        "ui/palette-editor.js::formatUpdatedAt(entry.updated_at)": "a text of the message catalog (a time) or a count of it",
        "ui/projects/tab-versionControl.js::(state==='unstaged')?\"plus\":\"minus\"": "one of two constants",
        "ui/projects/projects.js::(RED.settings.flowEncryptionType !== 'user')?'disabled':''": "one of two constants",
        "ui/projects/projects.js::(RED.settings.flowEncryptionType !== 'user')?RED._(\"projects.encryption-config.disabled\"):''": "a constant or a message of the catalog",
        "ui/library.js::options.type": "the type of a library of a node definition (the module of the node, not the remote)",
        "ui/projects/projectSettings.js::desc": "the markdown of the project description, cleaned by RED.utils.renderMarkdown (DOMPurify), or a catalog text",
        "ui/projects/projectSettings.js::RED.text.bidi.resolveBaseTextDir(desc)": "the direction of the text: ltr or rtl",
        "ui/projects/projectSettings.js::iconClass": "one of two constants",
        "ui/projects/projectSettings.js::fileIcon": "a constant chosen by the file name",
        "ui/projects/projectSettings.js::entry.status.ahead": "a number of commits (git status of the runtime)",
        "ui/projects/projectSettings.js::entry.status.behind": "a number of commits (git status of the runtime)",
        "red.js::config": "the HTML of the configuration of a node module, which the runtime serves to be HTML"
    };

    // the calls that parse a string as HTML
    const HTML_CALLS = /\$\(|\.html\(|\.append\(|\.prepend\(|\.before\(|\.after\(/g;

    /**
     * The operands of an expression that builds HTML: the parts between the `+` and the string
     * literals at the top level (a literal or a `+` inside a call belongs to the operand).
     */
    function operands(expr) {
        const result = [];
        let current = "";
        let depth = 0;
        let hasMarkup = false;
        function flush() {
            if (current.trim() !== "") { result.push(current.trim()); }
            current = "";
        }
        function literalEnd(from, quote) {
            let j = from + 1;
            while (j < expr.length && expr[j] !== quote) { if (expr[j] === "\\") { j++; } j++; }
            return j;
        }
        for (let i = 0; i < expr.length; i++) {
            const c = expr[i];
            if (c === "'" || c === '"' || c === "`") {
                const end = literalEnd(i, c);
                if (depth > 0) {
                    current += expr.substring(i, end + 1);
                } else if (c === "`") {
                    flush();
                    for (let j = i + 1; j < end; j++) {
                        if (expr[j] === "$" && expr[j + 1] === "{") {
                            const inner = balanced(expr, j + 2, false);
                            result.push(inner.text.trim());
                            j = inner.end;
                        } else if (expr[j] === "<") {
                            hasMarkup = true;
                        }
                    }
                } else {
                    if (expr.substring(i + 1, end).indexOf("<") !== -1) { hasMarkup = true; }
                    flush();
                }
                i = end;
            } else if (c === "+" && depth === 0) {
                flush();
            } else {
                if (c === "(" || c === "[" || c === "{") { depth++; }
                if (c === ")" || c === "]" || c === "}") { depth--; }
                current += c;
            }
        }
        flush();
        return { operands: result, hasMarkup };
    }

    function unsafeOperands(expr, file) {
        const parsed = operands(expr);
        if (!parsed.hasMarkup) {
            return [];
        }
        return parsed.operands.filter(function(operand) {
            operand = withoutEscapingCalls(operand).trim();
            // (a + b) or (a || b): the parentheses of the expression are no part of it
            while (operand.charAt(0) === "(" && balanced(operand, 1, false).end === operand.length - 1) {
                operand = operand.substring(1, operand.length - 1).trim();
            }
            if (operand === "" || operand === "ESCAPED") { return false; }
            if (/^\d+$/.test(operand) || Object.prototype.hasOwnProperty.call(REVIEWED, file + "::" + operand)) { return false; }
            if (/^RED\._\(/.test(operand)) {
                // a message of the catalog; its parameters are checked
                return unescapedParameters(operand).length > 0;
            }
            return true;
        });
    }

    function findings() {
        const found = [];
        SCANNED.forEach(function(relative) {
            // the comments are not code: block comments and whole-line comments are blanked, line numbers stay
            const text = read(relative).replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");
            let match;
            HTML_CALLS.lastIndex = 0;
            while ((match = HTML_CALLS.exec(text)) !== null) {
                const arg = balanced(text, match.index + match[0].length, true).text;
                unsafeOperands(withoutEscapingCalls(arg), relative).forEach(function(operand) {
                    found.push(relative + ":" + text.substring(0, match.index).split("\n").length + "  " + operand);
                });
            }
        });
        return found;
    }

    it("every text that is put into HTML is escaped, a message of the catalog, or reviewed", function() {
        findings().should.eql([]);
    });

    describe("the guard sees what it should", function() {
        it("takes a text that is concatenated into HTML", function() {
            unsafeOperands("'<span>'+entry.version+'</span>'", "test").should.eql(["entry.version"]);
            unsafeOperands("'<option value=\"'+catalog.name+'\">'+catalog.name+'</option>'", "test").should.eql(["catalog.name", "catalog.name"]);
            unsafeOperands("`<option value=\"${catalog.name}\">${catalog.name}</option>`", "test").should.eql(["catalog.name", "catalog.name"]);
            unsafeOperands("'<td>'+file.props.name+'</td>'", "test").should.eql(["file.props.name"]);
        });

        it("lets pass an escaped text, a message of the catalog and the HTML without text", function() {
            unsafeOperands("'<span>'+RED.errors.escape(entry.version)+'</span>'", "test").should.eql([]);
            unsafeOperands("'<span>'+RED._('palette.editor.install')+'</span>'", "test").should.eql([]);
            unsafeOperands("'<span>'+RED._('x.y',{count:n})+'</span>'", "test").should.eql([]);
            unsafeOperands("'<i class=\"fa fa-x\"></i>'", "test").should.eql([]);
            unsafeOperands("RED._('x')+': '+name", "test").should.eql([]);   // no markup in the literals: not HTML
        });

        it("takes a message of the catalog with a parameter that is not escaped", function() {
            unsafeOperands("'<p>'+RED._('x.y',{name:entry.name})+'</p>'", "test").should.eql(["RED._('x.y',{name:entry.name})"]);
        });
    });
});

describe("editor-client sources: the places that #37 fixed stay fixed (pinned)", function() {
    // [file, text that must be in the file, text that must not be]
    const PINNED = [
        ["ui/projects/projects.js", "$(authRequiredHtml(url))", "+url+"],
        ["ui/projects/projects.js", "RED.errors.escape(url)", "'+url"],
        ["ui/projects/tab-versionControl.js", "diffTitle(state, entry.file)", "+' : '+entry.file"],
        ["ui/projects/tab-versionControl.js", "revertConfirmMessage(entry.file)", "RED._(\"sidebar.project.versionControl.revert\""],
        ["ui/library.js", "<td>'+RED._(\"library.name\")+'</td><td></td></tr>'", "+file.props.name+"],
        ["red.js", "RED.errors.translateEscaped(msg.text,msg)", "RED._(msg.text,msg)"],
        ["nodes.js", "RED.errors.translateEscaped(\"palette.event.unknownNodeRegistered\"", "RED._(\"palette.event.unknownNodeRegistered\""],
        ["ui/library.js", "RED.errors.translateEscaped(\"library.savedType\"", "RED._(\"library.savedType\""],
        ["runtime.js", "RED.errors.translateEscaped(\"notification.state.flows\"", "RED._(\"notification.state.flows\""],
        ["ui/palette-editor.js", "RED.errors.translateEscaped('palette.editor.conflictTip'", "RED._('palette.editor.conflictTip'"],
        ["ui/palette-editor.js", "catalogSelection.append(catalogOption(catalog))", "<option value=\"${catalog.name}\">"],
        ["ui/palette-editor.js", "metaItem(\"red-ui-palette-module-version\"", "'+entry.version+'"],
        ["ui/palette-editor.js", "renderPendingVersion(nodeEntry.versionSpan", "versionSpan.html("]
    ];

    PINNED.forEach(function(pin) {
        it(pin[0] + " has " + pin[1] + " and does not have " + pin[2], function() {
            const text = read(pin[0]);
            text.should.containEql(pin[1]);
            text.should.not.containEql(pin[2]);
        });
    });

    describe("palette-editor.js: enable and disable (the handlers are driven by palette-editor_spec)", function() {
        it("a failed change of the state is shown by exactly two calls, with the node set id and the module name", function() {
            const text = read("ui/palette-editor.js");
            const calls = text.match(/(?<!function )notifyStateChangeFailed\(newState,[^)]*\)/g);
            calls.should.eql(["notifyStateChangeFailed(newState,set.id,xhr)", "notifyStateChangeFailed(newState,entry.name,xhr)"]);
        });

        it("the text \"installFailed\" is in the install, the upload and the automatic install only", function() {
            const text = read("ui/palette-editor.js");
            const lines = text.split("\n").map((line, i) => ({ line, n: i + 1 })).filter(l => /errors\.installFailed|installFailed'/.test(l.line));
            // install (entry.id), upload (filename), automatic install (moduleName)
            lines.map(l => /entry\.id|filename|moduleName/.test(l.line)).should.eql(lines.map(() => true));
            lines.should.have.length(3);
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
        read("ui/tab-help.js").should.containEql("RED.utils.sanitizeContent(data)");
        read("ui/palette.js").should.containEql("RED.utils.sanitizeContent(label)");
    });

    it("the tooltip of a tab is a plain text: the label is not escaped", function() {
        read("ui/common/tabs.js").should.containEql("RED.popover.tooltip(link,function() { return tab.label; });");
    });
});
