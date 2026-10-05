/**
 * Copyright JS Foundation and other contributors, http://js.foundation
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
 *   #54: a failed write of a library entry reaches the caller of the library (flaky tests)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var sinon = require("sinon");
var fs = require("fs-extra");
var os = require("os");
var path = require("path");

var NR_TEST_UTILS = require("nr-test-utils");
var localLibrary = NR_TEST_UTILS.require("@node-red/runtime/lib/library/local")
var fileLibrary = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/library")
var writeUtil = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/util")

var mockLog = {
    log: sinon.stub(),
    debug: sinon.stub(),
    trace: sinon.stub(),
    warn: sinon.stub(),
    info: sinon.stub(),
    metric: sinon.stub(),
    audit: sinon.stub(),
    _: function() { return "abc"}
}

describe("runtime/library/local", function() {

    describe("getEntry", function() {
        before(function() {
            localLibrary.init({
                log: mockLog,
                storage: {
                    getLibraryEntry: function(type,path) {
                        return Promise.resolve({type,path});
                    }
                }
            });
        });

        it('returns a registered non-flow entry', function(done) {
            localLibrary.getEntry("test-type","/abc").then(function(result) {
                result.should.have.property("type","test-type")
                result.should.have.property("path","/abc")
                done();
            }).catch(done);
        });

        it ('returns a flow entry', function(done) {
            localLibrary.getEntry("flows","/abc").then(function(result) {
                result.should.have.property("path","/abc")
                done();
            }).catch(done);
        });
    });

    describe("saveEntry", function() {
        before(function() {
            localLibrary.init({
                log: mockLog,
                storage: {
                    saveLibraryEntry: function(type, path, meta, body) {
                        return Promise.resolve({type,path,meta,body})
                    }
                }
            });
        });
        it('saves a flow entry', function(done) {
            localLibrary.saveEntry('flows','/abc',{id:"meta"},{id:"body"}).then(function(result) {
                result.should.have.property("path","/abc");
                result.should.have.property("body",{id:"body"});
                done();
            }).catch(done);
        })
        it('saves a non-flow entry', function(done) {
            localLibrary.saveEntry('test-type','/abc',{id:"meta"},{id:"body"}).then(function(result) {
                result.should.have.property("type","test-type");
                result.should.have.property("path","/abc");
                result.should.have.property("meta",{id:"meta"});
                result.should.have.property("body",{id:"body"});
                done();
            }).catch(done);
        })

    });
    // #54: the file storage behind the library
    describe("saveEntry with the file storage (#54)", function() {
        let dir;
        let writes;
        let originalWriteFile;

        beforeEach(async function() {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-local-library-"));
            writes = [];
            originalWriteFile = writeUtil.writeFile;
            // The promise of a write that the caller does not wait for is marked as seen, so that its
            // failure is not reported to a later test; the writes are awaited before the directory goes
            writeUtil.writeFile = function() {
                const result = originalWriteFile.apply(this, arguments);
                result.catch(function() {});
                writes.push(result);
                return result;
            };
            await fileLibrary.init({ userDir: dir });
            localLibrary.init({ log: mockLog, storage: fileLibrary });
        });
        afterEach(async function() {
            writeUtil.writeFile = originalWriteFile;
            await Promise.allSettled(writes);
            const readOnlyFolder = path.join(dir, "lib", "functions", "RO");
            if (fs.existsSync(readOnlyFolder)) {
                fs.chmodSync(readOnlyFolder, 0o755);
            }
            fs.removeSync(dir);
        });

        it("AC-30: a folder that cannot be written rejects the save with EACCES", async function() {
            if (process.getuid && process.getuid() === 0) {
                // chmod does not stop root from writing
                this.skip();
            }
            fs.ensureDirSync(path.join(dir, "lib", "functions", "RO"));
            fs.chmodSync(path.join(dir, "lib", "functions", "RO"), 0o555);
            let outcome;
            try {
                await localLibrary.saveEntry("functions", "RO/b.js", {}, "x");
                outcome = "resolved";
            } catch (err) {
                outcome = err;
            }
            outcome.should.have.property("code", "EACCES");
        });
    });
});
