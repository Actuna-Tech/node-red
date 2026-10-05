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
 *   Z-11: the file storage with a read-only user directory
 *   #54: an entry saved to the library is on disk when the save resolves (flaky tests)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * The file storage with `readOnlyUserDir: true`: no write to the user
 * directory (checked by comparing a snapshot of the directory tree before and
 * after, and with a real directory without write permission when the tests do
 * not run as root), deployments and library entries rejected with
 * `read_only_user_dir`, settings and sessions not saved.
 */
const should = require("should");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const NR_TEST_UTILS = require("nr-test-utils");

// A fresh copy of the file storage: the Projects tests leave an active project
// in the module state of projects/index.js. The shared copy is put back after
// these tests.
const STORAGE_DIR = path.dirname(NR_TEST_UTILS.resolve("@node-red/runtime/lib/storage/localfilesystem/index.js"));
let savedCache;
function freshLocalFileSystem() {
    savedCache = {};
    Object.keys(require.cache).forEach(function(k) {
        if (k.startsWith(STORAGE_DIR + path.sep)) {
            savedCache[k] = require.cache[k];
            delete require.cache[k];
        }
    });
    return require(path.join(STORAGE_DIR, "index.js"));
}
function restoreLocalFileSystem() {
    Object.keys(require.cache).forEach(function(k) {
        if (k.startsWith(STORAGE_DIR + path.sep)) {
            delete require.cache[k];
        }
    });
    Object.assign(require.cache, savedCache);
}
let localfilesystem;

function snapshot(dir) {
    const result = {};
    (function walk(d) {
        fs.readdirSync(d).forEach(function(name) {
            const p = path.join(d, name);
            const st = fs.statSync(p);
            if (st.isDirectory()) {
                result[path.relative(dir, p) + "/"] = "dir";
                walk(p);
            } else {
                result[path.relative(dir, p)] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") + ":" + st.mtimeMs;
            }
        });
    })(dir);
    return result;
}

describe("storage/localfilesystem with readOnlyUserDir (Z-11)", function() {
    const mockRuntime = { log: { _: function() { return "placeholder" }, info: function() {}, warn: function() {}, trace: function() {} } };
    const testFlow = [{ type: "tab", id: "t1", label: "Sheet 1" }];
    let userDir;
    let outsideDir;

    before(function() {
        localfilesystem = freshLocalFileSystem();
    });
    after(function() {
        restoreLocalFileSystem();
    });
    beforeEach(function() {
        userDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-ro-userdir-"));
        outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-ro-outside-"));
        fs.writeFileSync(path.join(userDir, "flows.json"), JSON.stringify(testFlow));
        fs.writeFileSync(path.join(userDir, ".config.runtime.json"), JSON.stringify({ instanceId: "abc" }));
    });
    afterEach(function() {
        fs.chmodSync(userDir, 0o755);
        fs.removeSync(userDir);
        fs.removeSync(outsideDir);
    });

    function settings(extra) {
        return Object.assign({ userDir: userDir, flowFile: "flows.json", readOnlyUserDir: true, getUserSettings: () => ({}) }, extra || {});
    }

    it("init, reads, settings and sessions do not write to the user directory", async function() {
        const before = snapshot(userDir);
        await localfilesystem.init(settings(), mockRuntime);
        (await localfilesystem.getFlows()).should.eql(testFlow);
        (await localfilesystem.getSettings()).should.have.property("instanceId", "abc");
        await localfilesystem.saveSettings({ instanceId: "changed", _credentialSecret: "x" });
        await localfilesystem.saveSessions({ token: { user: "u" } });
        snapshot(userDir).should.eql(before);
    });

    it("saveFlows and saveCredentials are rejected with read_only_user_dir", async function() {
        await localfilesystem.init(settings(), mockRuntime);
        const before = snapshot(userDir);
        const err = await localfilesystem.saveFlows([{ id: "x", type: "tab" }]).should.be.rejected();
        err.should.have.property("code", "read_only_user_dir");
        err.should.have.property("status", 400);
        (await localfilesystem.saveCredentials({ x: { a: 1 } }).should.be.rejected()).should.have.property("code", "read_only_user_dir");
        snapshot(userDir).should.eql(before);
    });

    it("an absolute flowFile outside the user directory is protected too (R-40)", async function() {
        const flowFile = path.join(outsideDir, "flows.json");
        fs.writeFileSync(flowFile, JSON.stringify(testFlow));
        await localfilesystem.init(settings({ flowFile: flowFile }), mockRuntime);
        const before = snapshot(outsideDir);
        (await localfilesystem.saveFlows([{ id: "x", type: "tab" }]).should.be.rejected()).should.have.property("code", "read_only_user_dir");
        (await localfilesystem.saveCredentials({}).should.be.rejected()).should.have.property("code", "read_only_user_dir");
        snapshot(outsideDir).should.eql(before);
        (await localfilesystem.getFlows()).should.eql(testFlow);
    });

    it("saveLibraryEntry is rejected with read_only_user_dir", async function() {
        await localfilesystem.init(settings(), mockRuntime);
        const before = snapshot(userDir);
        (await localfilesystem.saveLibraryEntry("flows", "test", {}, "[]").should.be.rejected()).should.have.property("code", "read_only_user_dir");
        snapshot(userDir).should.eql(before);
    });

    it("readOnlyUserDir takes precedence over readOnly for deployments (400 instead of a silent skip)", async function() {
        await localfilesystem.init(settings({ readOnly: true }), mockRuntime);
        (await localfilesystem.saveFlows([]).should.be.rejected()).should.have.property("code", "read_only_user_dir");
    });

    it("with a real directory without write permission (skipped as root)", async function() {
        if (process.getuid && process.getuid() === 0) {
            // chmod does not stop root from writing - the snapshot tests above are the evidence
            this.skip();
        }
        fs.chmodSync(userDir, 0o555);
        await localfilesystem.init(settings(), mockRuntime);
        await localfilesystem.saveSettings({ instanceId: "changed" });
        await localfilesystem.saveSessions({});
        (await localfilesystem.saveFlows([]).should.be.rejected()).should.have.property("code", "read_only_user_dir");
    });

    describe("readOnlyUserDir not set (unchanged behaviour)", function() {
        it("init creates the directories and package.json; saves write", async function() {
            await localfilesystem.init(settings({ readOnlyUserDir: false }), mockRuntime);
            fs.existsSync(path.join(userDir, "lib", "flows")).should.be.true();
            fs.existsSync(path.join(userDir, "node_modules")).should.be.true();
            fs.existsSync(path.join(userDir, "package.json")).should.be.true();
            await localfilesystem.saveFlows([{ id: "x", type: "tab" }]);
            JSON.parse(fs.readFileSync(path.join(userDir, "flows.json"), "utf8")).should.eql([{ id: "x", type: "tab" }]);
            await localfilesystem.saveSessions({ a: 1 });
            fs.existsSync(path.join(userDir, ".sessions.json")).should.be.true();
            await localfilesystem.saveLibraryEntry("flows", "test", {}, "[]");
            await new Promise(r => setTimeout(r, 50));
            fs.existsSync(path.join(userDir, "lib", "flows", "test.json")).should.be.true();
        });

        it("AC-25: a saved library entry is on disk as soon as the save resolves", async function() {
            await localfilesystem.init(settings({ readOnlyUserDir: false }), mockRuntime);
            await localfilesystem.saveLibraryEntry("flows", "test", {}, "[]");
            fs.readFileSync(path.join(userDir, "lib", "flows", "test.json"), "utf8").should.equal("[]");
            fs.readdirSync(path.join(userDir, "lib", "flows")).filter(n => n.endsWith(".$$$")).should.eql([]);
        });
    });
});
