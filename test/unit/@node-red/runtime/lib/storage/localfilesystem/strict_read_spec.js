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
 *   Z-09: tests of the strict read of the flow file for a reload from storage
 *   (D-18, R-36) and of the backup that is not copied with readOnly/readOnlyUserDir
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * `getFlows({strict: true})` - the read for a reload from storage - rejects on
 * a read error, a missing, empty or invalid flow file instead of returning an
 * empty configuration; `getFlows()` (the start) is unchanged. With `readOnly`
 * or `readOnlyUserDir` the backup of an empty file is read but never copied.
 */
const should = require("should");
const sinon = require("sinon");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const NR_TEST_UTILS = require("nr-test-utils");

// A fresh copy of the file storage (the Projects tests keep a module state)
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

describe("storage/localfilesystem strict read for a reload (Z-09)", function() {
    const mockRuntime = { log: { _: function() { return "placeholder" }, info: function() {}, warn: function() {}, trace: function() {}, debug: function() {} } };
    const testFlow = [{ type: "tab", id: "t1", label: "Sheet 1" }];
    let localfilesystem;
    let util;
    let userDir;
    let flowFile;
    let backupFile;
    let credFile;

    before(function() {
        localfilesystem = freshLocalFileSystem();
        util = require(path.join(STORAGE_DIR, "util.js"));
    });
    after(function() {
        restoreLocalFileSystem();
    });
    beforeEach(function() {
        userDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-strict-"));
        flowFile = path.join(userDir, "flows.json");
        backupFile = path.join(userDir, ".flows.json.backup");
        credFile = path.join(userDir, "flows_cred.json");
        fs.writeFileSync(flowFile, JSON.stringify(testFlow));
    });
    afterEach(function() {
        sinon.restore();
        fs.removeSync(userDir);
    });

    function settings(extra) {
        return Object.assign({ userDir: userDir, flowFile: "flows.json", getUserSettings: () => ({}) }, extra || {});
    }

    describe("getFlows({strict: true})", function() {
        it("returns a valid flow file", async function() {
            await localfilesystem.init(settings(), mockRuntime);
            (await localfilesystem.getFlows({ strict: true })).should.eql(testFlow);
        });
        it("rejects an invalid JSON flow file (a non-atomic write in progress)", async function() {
            await localfilesystem.init(settings(), mockRuntime);
            fs.writeFileSync(flowFile, '[{"id":"t1","type":"ta');
            const err = await localfilesystem.getFlows({ strict: true }).then(() => null, e => e);
            should.exist(err);
            err.code.should.equal("invalid_json");
        });
        it("rejects an empty flow file and does not restore the backup", async function() {
            await localfilesystem.init(settings(), mockRuntime);
            fs.writeFileSync(flowFile, "");
            fs.writeFileSync(backupFile, JSON.stringify(testFlow));
            const err = await localfilesystem.getFlows({ strict: true }).then(() => null, e => e);
            should.exist(err);
            err.code.should.equal("empty_file");
            fs.readFileSync(flowFile, "utf8").should.equal("");
        });
        it("rejects a missing flow file", async function() {
            await localfilesystem.init(settings(), mockRuntime);
            fs.removeSync(flowFile);
            const err = await localfilesystem.getFlows({ strict: true }).then(() => null, e => e);
            should.exist(err);
            err.code.should.equal("ENOENT");
        });
        it("rejects a read error (EIO)", async function() {
            await localfilesystem.init(settings(), mockRuntime);
            sinon.stub(fs, "readFile").callsFake(function(p, enc, cb) {
                const e = new Error("EIO: i/o error, read");
                e.code = "EIO";
                cb(e);
            });
            const err = await localfilesystem.getFlows({ strict: true }).then(() => null, e => e);
            should.exist(err);
            err.code.should.equal("EIO");
        });
        it("credentials: a missing file is no credentials, an invalid one is rejected", async function() {
            await localfilesystem.init(settings(), mockRuntime);
            (await localfilesystem.getCredentials({ strict: true })).should.eql({});
            fs.writeFileSync(credFile, "{\"a\":");
            const err = await localfilesystem.getCredentials({ strict: true }).then(() => null, e => e);
            should.exist(err);
            err.code.should.equal("invalid_json");
        });
    });

    describe("getFlows() at start (unchanged behaviour)", function() {
        it("an invalid flow file gives an empty configuration", async function() {
            await localfilesystem.init(settings(), mockRuntime);
            fs.writeFileSync(flowFile, "[{");
            (await localfilesystem.getFlows()).should.eql([]);
        });
        it("a missing flow file gives an empty configuration", async function() {
            await localfilesystem.init(settings(), mockRuntime);
            fs.removeSync(flowFile);
            (await localfilesystem.getFlows()).should.eql([]);
        });
        it("an empty flow file is restored from the backup (copied)", async function() {
            await localfilesystem.init(settings(), mockRuntime);
            fs.writeFileSync(flowFile, "");
            fs.writeFileSync(backupFile, JSON.stringify(testFlow));
            (await localfilesystem.getFlows()).should.eql(testFlow);
            JSON.parse(fs.readFileSync(flowFile, "utf8")).should.eql(testFlow);
        });
    });

    describe("the backup of an empty file is not copied without write access", function() {
        [["readOnlyUserDir", { readOnlyUserDir: true }], ["readOnly", { readOnly: true }]].forEach(function(entry) {
            it(entry[0] + " - the backup is read, the flow file stays unchanged", async function() {
                await localfilesystem.init(settings(entry[1]), mockRuntime);
                fs.writeFileSync(flowFile, "");
                fs.writeFileSync(backupFile, JSON.stringify(testFlow));
                const copy = sinon.spy(fs, "copy");
                (await localfilesystem.getFlows()).should.eql(testFlow);
                copy.called.should.be.false();
                fs.readFileSync(flowFile, "utf8").should.equal("");
            });
        });
    });

    describe("util.readFile", function() {
        it("strict - an invalid file is rejected, non-strict - the empty response", async function() {
            fs.writeFileSync(flowFile, "nope");
            should(await util.readFile(flowFile, backupFile, null, "flow")).be.null();
            const err = await util.readFile(flowFile, backupFile, null, "flow", { strict: true }).then(() => null, e => e);
            err.code.should.equal("invalid_json");
        });
    });
});

describe("storage/index getFlows({strict: true}) (Z-09)", function() {
    const storage = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/index");

    it("passes the options to the plugin", async function() {
        const getFlows = sinon.spy(async function() { return [] });
        const getCredentials = sinon.spy(async function() { return {} });
        await storage.init({ settings: { storageModule: { init: function() {}, getFlows: getFlows, getCredentials: getCredentials } } });
        await storage.getFlows({ strict: true });
        getFlows.firstCall.args[0].should.eql({ strict: true });
        getCredentials.firstCall.args[0].should.eql({ strict: true });
    });
    it("a plugin returning no array is rejected only in a strict read", async function() {
        await storage.init({ settings: { storageModule: { init: function() {}, getFlows: async () => null, getCredentials: async () => ({}) } } });
        const loaded = await storage.getFlows();
        should(loaded.flows).be.null();
        const err = await storage.getFlows({ strict: true }).then(() => null, e => e);
        should.exist(err);
        err.code.should.equal("invalid_flows");
    });
});
