/*
 * Modified by Actuna Sp. z o.o.:
 *   Z-14: test that the flow layout example in the settings template enables the controls
 *   #71: test that startupTimeout is not set by default in the settings template and that its example is valid
 *   #48: test that httpInMaxBodySize is not set by default in the settings template, that it is described and that its example is valid
 * This notice is required by section 4(b) of the Apache License 2.0.
 */
const should = require("should");
const fs = require("fs");
const os = require("os");
const path = require("path");

const NR_TEST_UTILS = require("nr-test-utils");

const templatePath = NR_TEST_UTILS.resolve("node-red/settings.js");

/**
 * Load settings from source text through a temporary file
 * @param {string} source
 */
function loadSettings(source) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-settings-spec-"));
    const file = path.join(dir, "settings.js");
    fs.writeFileSync(file, source);
    try {
        return require(file);
    } finally {
        delete require.cache[file];
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * Uncomment the commented example that starts with `//<name>:`, up to the
 * line that closes its braces
 */
function uncommentExample(source, name) {
    const lines = source.split("\n");
    const start = lines.findIndex(l => new RegExp("^\\s*//" + name + ":").test(l));
    if (start === -1) {
        throw new Error("Example not found: " + name);
    }
    let depth = 0;
    for (let i = start; i < lines.length; i++) {
        lines[i] = lines[i].replace(/^(\s*)\/\//, "$1");
        depth += (lines[i].match(/{/g) || []).length - (lines[i].match(/}/g) || []).length;
        if (depth <= 0) {
            break;
        }
    }
    return lines.join("\n");
}

describe("node-red/settings.js template", function() {
    let source;

    before(function() {
        source = fs.readFileSync(templatePath, "utf8");
    });

    it("does not set editorTheme.flowLayout by default", function() {
        const settings = loadSettings(source);
        should.not.exist(settings.editorTheme.flowLayout);
    });

    it("enables the flow layout controls when the flowLayout example is uncommented", function() {
        const settings = loadSettings(uncommentExample(source, "flowLayout"));
        settings.editorTheme.flowLayout.should.eql({ enabled: true });
    });

    it("AC-22 (#71): does not set startupTimeout by default", function() {
        const settings = loadSettings(source);
        should(settings.startupTimeout).be.undefined();
    });

    it("AC-22 (#71): the startupTimeout example, when uncommented, is a finite number of ms > 0 and <= 2147483647", function() {
        const settings = loadSettings(uncommentExample(source, "startupTimeout"));
        settings.startupTimeout.should.be.a.Number();
        Number.isFinite(settings.startupTimeout).should.be.true();
        settings.startupTimeout.should.be.above(0);
        settings.startupTimeout.should.not.be.above(2147483647);
    });

    describe("httpInMaxBodySize (#48)", function() {
        it("AC-20 (#48): does not set httpInMaxBodySize by default", function() {
            const settings = loadSettings(source);
            should(settings.httpInMaxBodySize).be.undefined();
        });

        it("AC-20 (#48): the Node Settings list at the head of the section names httpInMaxBodySize", function() {
            const from = source.indexOf("Node Settings\n *  - fileWorkingDirectory");
            from.should.be.above(0);
            const list = source.slice(from, source.indexOf("*****/", from));
            list.should.containEql("httpInMaxBodySize");
        });

        it("AC-21 (#48): the httpInMaxBodySize example, when uncommented, is a size that the node accepts: a number above 0, or a number with a unit", function() {
            const settings = loadSettings(uncommentExample(source, "httpInMaxBodySize"));
            const value = settings.httpInMaxBodySize;
            if (typeof value === "number") {
                Number.isFinite(value).should.be.true();
                value.should.be.above(0);
            } else {
                value.should.be.a.String();
                value.trim().should.match(/^\d+(\.\d+)?\s*(b|kb|mb|gb|tb|pb)?$/i);
                parseFloat(value).should.be.above(0);
            }
        });

        it("AC-50 (#48): the text of the template says that the setting is off by default, that the limit of a node can raise or lower it, that JSON and urlencoded bodies are not limited by it, and that an invalid value is ignored and only logged", function() {
            const lines = source.split("\n");
            // the comment of the setting: from the line that opens it to the example of the setting
            const at = lines.findIndex(function(line) { return /^\s*\/\/\s*httpInMaxBodySize:/.test(line) });
            should.ok(at >= 0, "the commented example of httpInMaxBodySize is not in the template");
            let start = at;
            while (start > 0 && at - start < 60 && !/^\s*\/\*\*/.test(lines[start])) { start -= 1 }
            const block = lines.slice(start, at + 1).join("\n");
            block.should.match(/default/i);
            block.should.match(/\b(raise|raises|lower|lowers)\b/i);
            block.should.match(/json/i);
            block.should.match(/urlencoded|url-encoded/i);
            block.should.match(/ignored/i);
            block.should.match(/\blog(ged)?\b/i);
            block.should.match(/\b413\b/);
        });

        it("AC-50 (#48): the comment of apiMaxLength tells about httpInMaxBodySize", function() {
            const lines = source.split("\n");
            const at = lines.findIndex(function(line) { return /^\s*\/\/\s*apiMaxLength:/.test(line) });
            should.ok(at >= 0, "the commented example of apiMaxLength is not in the template");
            let start = at;
            while (start > 0 && at - start < 60 && !/^\s*\/\*\*/.test(lines[start])) { start -= 1 }
            lines.slice(start, at + 1).join("\n").should.containEql("httpInMaxBodySize");
        });
    });
});
