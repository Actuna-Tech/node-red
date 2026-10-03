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
 *   Z-09: watchFlows of the file storage - flowFile and the credentials file
 *   written by another instance (shared volume), own writes ignored
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const NR_TEST_UTILS = require("nr-test-utils");

// A fresh copy of the file storage (see readonly_userdir_spec.js): the
// Projects tests leave module state in projects/index.js
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

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function waitFor(check, timeout) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function poll() {
            if (check()) {
                return resolve();
            }
            if (Date.now() - start > (timeout || 5000)) {
                return reject(new Error("timeout"));
            }
            setTimeout(poll, 10);
        })();
    });
}
function revOf(flows) {
    return crypto.createHash("sha256").update(JSON.stringify(flows)).digest("hex");
}
// Writes like another instance (util.writeFile): a temporary file and a rename
function writeAtomically(file, content) {
    fs.writeFileSync(file + ".other", content);
    fs.renameSync(file + ".other", file);
}

describe("storage/localfilesystem watchFlows (Z-09)", function() {
    this.timeout(10000);
    const mockRuntime = { log: { _: function() { return "placeholder" }, info: function() {}, warn: function() {}, trace: function() {}, debug: function() {} } };
    const flowsA = [{ type: "tab", id: "t1", label: "A" }];
    const flowsB = [{ type: "tab", id: "t1", label: "B" }, { type: "tab", id: "t2", label: "new" }];
    let localfilesystem;
    let userDir;
    let unwatch;
    let notifications;

    before(function() {
        localfilesystem = freshLocalFileSystem();
    });
    after(function() {
        restoreLocalFileSystem();
    });
    beforeEach(function() {
        notifications = [];
        unwatch = null;
        userDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-watch-"));
        fs.writeFileSync(path.join(userDir, "flows.json"), JSON.stringify(flowsA));
        fs.writeFileSync(path.join(userDir, "flows_cred.json"), JSON.stringify({ t1: { user: "a" } }));
    });
    afterEach(async function() {
        if (unwatch) {
            await unwatch();
        }
        fs.removeSync(userDir);
    });

    async function start(extra) {
        await localfilesystem.init(Object.assign({ userDir: userDir, flowFile: "flows.json", getUserSettings: () => ({}) }, extra || {}), mockRuntime);
        await localfilesystem.getFlows();
        unwatch = await localfilesystem.watchFlows(n => notifications.push(n));
        unwatch.should.be.a.Function();
    }

    it("provides watchFlows", function() {
        localfilesystem.watchFlows.should.be.a.Function();
    });

    it("notifies a change of flowFile written by another instance with the revision", async function() {
        await start();
        writeAtomically(path.join(userDir, "flows.json"), JSON.stringify(flowsB, null, 4));
        await waitFor(() => notifications.length > 0);
        notifications[0].should.have.property("rev", revOf(flowsB));
        notifications[0].should.have.property("credentialsChanged", false);
    });

    it("notifies a change of the credentials file with credentialsChanged", async function() {
        await start();
        writeAtomically(path.join(userDir, "flows_cred.json"), JSON.stringify({ t1: { user: "b" } }));
        await waitFor(() => notifications.length > 0);
        notifications[0].should.have.property("credentialsChanged", true);
    });

    it("an own save does not notify", async function() {
        await start();
        await localfilesystem.saveFlows(flowsB);
        await localfilesystem.saveCredentials({ t1: { user: "c" } });
        await delay(1600);
        notifications.should.have.length(0);
    });

    it("the same content written again does not notify", async function() {
        await start();
        writeAtomically(path.join(userDir, "flows.json"), JSON.stringify(flowsA));
        await delay(1600);
        notifications.should.have.length(0);
    });

    it("a burst of writes is debounced into a notification of the last content", async function() {
        await start();
        for (let i = 0; i < 5; i++) {
            writeAtomically(path.join(userDir, "flows.json"), JSON.stringify([{ type: "tab", id: "t1", label: "v" + i }]));
        }
        await waitFor(() => notifications.length > 0);
        await delay(600);
        notifications.length.should.be.belowOrEqual(2);
        notifications[notifications.length - 1].rev.should.equal(revOf([{ type: "tab", id: "t1", label: "v4" }]));
    });

    it("a partially written file is ignored until it is valid", async function() {
        await start();
        fs.writeFileSync(path.join(userDir, "flows.json"), "[{\"type\":\"tab\"");
        await delay(800);
        notifications.should.have.length(0);
        fs.writeFileSync(path.join(userDir, "flows.json"), JSON.stringify(flowsB));
        await waitFor(() => notifications.length > 0);
        notifications[0].rev.should.equal(revOf(flowsB));
    });

    it("works with readOnlyUserDir", async function() {
        await start({ readOnlyUserDir: true });
        writeAtomically(path.join(userDir, "flows.json"), JSON.stringify(flowsB));
        await waitFor(() => notifications.length > 0);
        notifications[0].rev.should.equal(revOf(flowsB));
    });

    it("works with readOnly and a flowFile in another directory", async function() {
        const shared = fs.mkdtempSync(path.join(os.tmpdir(), "nr-watch-shared-"));
        try {
            fs.writeFileSync(path.join(shared, "flows.json"), JSON.stringify(flowsA));
            await start({ readOnly: true, flowFile: path.join(shared, "flows.json") });
            writeAtomically(path.join(shared, "flows.json"), JSON.stringify(flowsB));
            await waitFor(() => notifications.length > 0);
            notifications[0].rev.should.equal(revOf(flowsB));
        } finally {
            await unwatch();
            unwatch = null;
            fs.removeSync(shared);
        }
    });

    it("without file system events (shared volume) the polling notifies", async function() {
        const nodeFs = require("fs");
        const original = nodeFs.watch;
        nodeFs.watch = function() { throw new Error("not supported") };
        try {
            await start();
        } finally {
            nodeFs.watch = original;
        }
        writeAtomically(path.join(userDir, "flows.json"), JSON.stringify(flowsB));
        await waitFor(() => notifications.length > 0);
        notifications[0].rev.should.equal(revOf(flowsB));
    });

    it("no notification after unwatch", async function() {
        await start();
        await unwatch();
        unwatch = null;
        writeAtomically(path.join(userDir, "flows.json"), JSON.stringify(flowsB));
        await delay(1600);
        notifications.should.have.length(0);
    });

    it("a removed flowFile does not notify", async function() {
        await start();
        fs.removeSync(path.join(userDir, "flows.json"));
        await delay(1600);
        notifications.should.have.length(0);
    });
});

describe("storage/localfilesystem/watch - observers (Z-09 review)", function() {
    this.timeout(10000);
    const watch = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/watch");
    let dir;
    let stops;
    beforeEach(function() {
        stops = [];
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-watch2-"));
        fs.writeFileSync(path.join(dir, "flows.json"), JSON.stringify([{ id: "t1", type: "tab" }]));
    });
    afterEach(async function() {
        for (const stop of stops) {
            await stop();
        }
        fs.removeSync(dir);
    });
    it("two observers of the same file in one process are both notified (state per observer)", async function() {
        const file = path.join(dir, "flows.json");
        const a = [];
        const b = [];
        stops.push(await watch.watchFiles({ flows: file }, n => a.push(n), { debounce: 20, interval: 50 }));
        stops.push(await watch.watchFiles({ flows: file }, n => b.push(n), { debounce: 60, interval: 50 }));
        writeAtomically(file, JSON.stringify([{ id: "t1", type: "tab", label: "changed" }]));
        await waitFor(() => a.length > 0 && b.length > 0, 3000);
    });
    it("noteWrite is applied to every active observer", async function() {
        const file = path.join(dir, "flows.json");
        const a = [];
        const b = [];
        stops.push(await watch.watchFiles({ flows: file }, n => a.push(n), { debounce: 20, interval: 50 }));
        stops.push(await watch.watchFiles({ flows: file }, n => b.push(n), { debounce: 20, interval: 50 }));
        const content = JSON.stringify([{ id: "t1", type: "tab", label: "own" }]);
        watch.noteWrite(file, content);
        writeAtomically(file, content);
        await delay(300);
        a.should.have.length(0);
        b.should.have.length(0);
    });
});
