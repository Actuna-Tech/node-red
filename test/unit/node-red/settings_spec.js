/*
 * Modified by Actuna Sp. z o.o.:
 *   Z-14: test that the flow layout example in the settings template enables the controls
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
});
