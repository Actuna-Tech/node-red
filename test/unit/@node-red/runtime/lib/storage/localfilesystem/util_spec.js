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
 *   #68: tests of the write errors of writeFile - a failed write of the file content
 *   is rejected, the existing file is kept and the temporary file of the call is removed
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const NR_TEST_UTILS = require("nr-test-utils");
const util = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/util");
const { mkdtemp, readFile } = require('fs/promises');
const { join } = require('path');
const { tmpdir } = require('os');
const sinon = require("sinon");
const nodeFs = require("fs");
const fsx = require("fs-extra");
const { log } = NR_TEST_UTILS.require("@node-red/util");
const { settle, flush, stubFsWrite, fsError } = require("nr-test-utils/fault-injection");

describe('storage/localfilesystem/util', function() {
    describe('writeFile', function () {
        it('manages concurrent calls to modify the same file', async function () {
            const testDirectory = await mkdtemp(join(tmpdir(), 'nr-test-'));
            const testFile = join(testDirectory, 'foo.txt')
            const testBackupFile = testFile + '.$$$'

            let counter = 0
            const promises = [
                util.writeFile(testFile, `update-${counter++}`, testBackupFile ),
                util.writeFile(testFile, `update-${counter++}`, testBackupFile ),
                util.writeFile(testFile, `update-${counter++}`, testBackupFile )
            ]

            await Promise.all(promises)

            const result = await readFile(testFile, { encoding: 'utf-8' })
            result.should.equal('update-2')
        })
    })
    describe('writeFile - errors of the write of the content (#68)', function () {
        const LOG_METHODS = ["log", "debug", "trace", "warn", "info", "metric", "audit", "error"];
        let sandbox;
        let dir;
        let target;
        let tempFile;
        let streams;

        beforeEach(async function () {
            sandbox = sinon.createSandbox();
            streams = [];
            dir = await mkdtemp(join(tmpdir(), 'nr-test-'));
            target = join(dir, 'target.txt');
            tempFile = target + '.$$$';
            nodeFs.writeFileSync(target, 'OLD');
            LOG_METHODS.forEach(function (name) {
                if (typeof log[name] === "function") {
                    sandbox.stub(log, name);
                }
            });
            sandbox.spy(log, "_");
        });
        afterEach(function () {
            sandbox.restore();
            streams.forEach(function (stream) { stream.destroy() });
            nodeFs.rmSync(dir, { recursive: true, force: true });
        });

        const read = function (file) { return nodeFs.readFileSync(file, 'utf8') };
        const exists = function (file) { return nodeFs.existsSync(file) };
        const enospc = function () { return fsError("ENOSPC") };

        // the fs-extra functions are universal: a callback or a promise
        function failing(err) {
            return function () {
                const callback = arguments[arguments.length - 1];
                if (typeof callback === "function") {
                    setImmediate(callback, err);
                    return;
                }
                return Promise.reject(err);
            };
        }
        function wrapStreams(wrap) {
            const original = fsx.createWriteStream;
            return sandbox.stub(fsx, "createWriteStream").callsFake(function () {
                const stream = original.apply(fsx, arguments);
                streams.push(stream);
                if (wrap) {
                    wrap(stream);
                }
                return stream;
            });
        }
        async function expectRejected(promise, code) {
            const result = await settle(promise);
            result.state.should.equal("rejected", "the write was " + result.state + " instead of rejected");
            if (code) {
                result.err.should.have.property("code", code);
            }
            return result.err;
        }
        async function expectResolved(promise) {
            const result = await settle(promise);
            result.state.should.equal("resolved", "the write was " + result.state + " instead of resolved");
            return result.value;
        }
        function warnedWith(key) {
            return log._.getCalls().some(function (call) { return call.args[0] === key });
        }

        it('AC-1: a failed write of the content (ENOSPC) rejects with the error and keeps the target', async function () {
            stubFsWrite(sandbox, enospc);
            await expectRejected(util.writeFile(target, "NEW"), "ENOSPC");
            read(target).should.equal("OLD");
            exists(tempFile).should.be.false();
        });
        it('AC-1: a failed write of the content for a target that did not exist does not create it', async function () {
            const fresh = join(dir, 'fresh.txt');
            stubFsWrite(sandbox, enospc);
            await expectRejected(util.writeFile(fresh, "NEW"), "ENOSPC");
            exists(fresh).should.be.false();
            exists(fresh + '.$$$').should.be.false();
        });
        it('AC-2: a write that stops after 3 bytes with EIO rejects with EIO and keeps the target', async function () {
            stubFsWrite(sandbox, function (n) { return n === 1 ? { bytes: 3 } : fsError("EIO") });
            await expectRejected(util.writeFile(target, "NEW-CONTENT"), "EIO");
            read(target).should.equal("OLD");
            exists(tempFile).should.be.false();
        });
        it('AC-3: a short write without an error is completed and the content is saved in full', async function () {
            stubFsWrite(sandbox, function (n) { return n === 1 ? { bytes: 3 } : undefined });
            await expectResolved(util.writeFile(target, "NEW-CONTENT"));
            read(target).should.equal("NEW-CONTENT");
        });

        [
            ["123", 123],
            ["null", null],
            ["an object", {}],
            ["undefined", undefined]
        ].forEach(function (testCase) {
            it('AC-4: content that is not a string (' + testCase[0] + ') rejects with a TypeError and the next write works', async function () {
                const err = await expectRejected(util.writeFile(target, testCase[1]));
                err.should.be.instanceof(TypeError);
                read(target).should.equal("OLD");
                exists(tempFile).should.be.false();
                await expectResolved(util.writeFile(target, "NEXT"));
                read(target).should.equal("NEXT");
            });
        });

        it('AC-5: the first of two concurrent writes fails, the second is done and a third works', async function () {
            let failFirst = true;
            stubFsWrite(sandbox, function () {
                if (failFirst) {
                    failFirst = false;
                    return enospc();
                }
            });
            const p1 = util.writeFile(target, "FIRST");
            const p2 = util.writeFile(target, "SECOND");
            const r1 = await settle(p1);
            const r2 = await settle(p2);
            r1.state.should.equal("rejected", "the first write was " + r1.state);
            r1.err.should.have.property("code", "ENOSPC");
            r2.state.should.equal("resolved", "the second write was " + r2.state);
            read(target).should.equal("SECOND");
            await expectResolved(util.writeFile(target, "THIRD"));
            read(target).should.equal("THIRD");
        });

        it('AC-6: a failed removal of the temporary file is only logged and the write is rejected with the original error', async function () {
            let writesFail = true;
            stubFsWrite(sandbox, function () { if (writesFail) { return enospc() } });
            sandbox.stub(fsx, "unlink").callsFake(failing(fsError("EPERM")));
            sandbox.spy(fsx, "remove");
            const err = await expectRejected(util.writeFile(target, "NEW"));
            err.should.have.property("code", "ENOSPC");
            fsx.unlink.called.should.be.true("the temporary file was not removed");
            log.debug.args.some(function (args) { return String(args[0]).indexOf(tempFile) !== -1 }).should.be.true();
            fsx.remove.called.should.be.false();
            writesFail = false;
            fsx.unlink.restore();
            await expectResolved(util.writeFile(target, "AFTER"));
            read(target).should.equal("AFTER");
        });

        it('AC-7: after a failed write there is no fsync, end or rename, one warning with the known key', async function () {
            stubFsWrite(sandbox, enospc);
            sandbox.spy(fsx, "fsync");
            sandbox.spy(fsx, "rename");
            let endSpy;
            wrapStreams(function (stream) {
                endSpy = sandbox.spy(stream, "end");
            });
            await expectRejected(util.writeFile(target, "NEW"));
            await flush();
            warnedWith("storage.localfilesystem.fsync-fail").should.be.true();
            log.warn.callCount.should.equal(1);
            fsx.fsync.called.should.be.false("fsync was called");
            fsx.rename.called.should.be.false("rename was called");
            endSpy.called.should.be.false("end was called");
        });

        it('AC-8: a failed fsync is only a warning, the write goes on and is resolved (current behaviour)', async function () {
            sandbox.stub(fsx, "fsync").callsFake(failing(fsError("EIO")));
            await expectResolved(util.writeFile(target, "NEW"));
            read(target).should.equal("NEW");
            warnedWith("storage.localfilesystem.fsync-fail").should.be.true();
        });

        it('AC-9: a failed rename rejects, keeps the target and leaves the temporary file (current behaviour)', async function () {
            sandbox.stub(fsx, "rename").callsFake(failing(fsError("EXDEV")));
            await expectRejected(util.writeFile(target, "NEW"), "EXDEV");
            read(target).should.equal("OLD");
            read(tempFile).should.equal("NEW");
        });

        it('AC-10: a temporary path that is a directory rejects and nothing is removed', async function () {
            nodeFs.mkdirSync(tempFile);
            nodeFs.writeFileSync(join(tempFile, "keep"), "KEEP");
            sandbox.spy(fsx, "unlink");
            const err = await expectRejected(util.writeFile(target, "NEW"));
            err.code.should.be.a.String().and.not.be.empty();
            read(target).should.equal("OLD");
            exists(tempFile).should.be.true();
            read(join(tempFile, "keep")).should.equal("KEEP");
            fsx.unlink.called.should.be.false();
        });

        it('AC-11: a parent that is a file rejects with a code', async function () {
            const parent = join(dir, "afile");
            nodeFs.writeFileSync(parent, "x");
            const err = await expectRejected(util.writeFile(join(parent, "t.txt"), "NEW"));
            err.code.should.be.a.String().and.not.be.empty();
        });

        it('AC-12: a successful write creates the missing directories and saves the bytes', async function () {
            const content = "zażółć 日本語\n";
            const deep = join(dir, "a", "b", "t");
            sandbox.spy(fsx, "unlink");
            const value = await expectResolved(util.writeFile(deep, content));
            should(value).be.undefined();
            nodeFs.readFileSync(deep).equals(Buffer.from(content, "utf8")).should.be.true();
            exists(deep + '.$$$').should.be.false();
            fsx.unlink.called.should.be.false();
        });
        it('AC-12: a successful write with a backup path keeps the order of the calls and logs no warning', async function () {
            const backup = join(dir, "target.backup");
            const copy = sandbox.spy(fsx, "copy");
            const ensureDir = sandbox.spy(fsx, "ensureDir");
            const fsync = sandbox.spy(fsx, "fsync");
            const rename = sandbox.spy(fsx, "rename");
            const unlink = sandbox.spy(fsx, "unlink");
            await expectResolved(util.writeFile(target, "NEW", backup));
            read(backup).should.equal("OLD");
            read(target).should.equal("NEW");
            [copy, ensureDir, fsync, rename].forEach(function (spy) { spy.callCount.should.equal(1) });
            copy.calledBefore(ensureDir).should.be.true();
            ensureDir.calledBefore(fsync).should.be.true();
            fsync.calledBefore(rename).should.be.true();
            log.warn.called.should.be.false();
            unlink.called.should.be.false();
        });

        it('AC-13: a failed write with a backup path rejects, the target and the backup keep the old content', async function () {
            const backup = join(dir, "target.backup");
            stubFsWrite(sandbox, enospc);
            await expectRejected(util.writeFile(target, "NEW", backup), "ENOSPC");
            read(target).should.equal("OLD");
            read(backup).should.equal("OLD");
        });

        it('AC-14: an error in the callback of end rejects with it, without a rename', async function () {
            const eio = fsError("EIO");
            wrapStreams(function (stream) {
                stream.end = function (callback) {
                    setImmediate(callback, eio);
                    return stream;
                };
            });
            sandbox.spy(fsx, "rename");
            const err = await expectRejected(util.writeFile(target, "NEW"));
            err.should.equal(eio);
            fsx.rename.called.should.be.false();
            read(target).should.equal("OLD");
            exists(tempFile).should.be.false();
        });
        it('AC-14: an error event of the stream before end rejects with it, without a rename', async function () {
            const eio = fsError("EIO");
            wrapStreams(function (stream) {
                stream.once("open", function () { stream.emit("error", eio) });
            });
            sandbox.spy(fsx, "rename");
            const err = await expectRejected(util.writeFile(target, "NEW"));
            err.should.equal(eio);
            await flush();
            fsx.rename.called.should.be.false();
            read(target).should.equal("OLD");
            exists(tempFile).should.be.false();
        });

        it('AC-18: the logs of the failures do not contain the content', async function () {
            const marker = "MARKER-68-" + Math.random().toString(36).slice(2);
            const eio = fsError("EIO");
            // 1. a failed write
            const writes = stubFsWrite(sandbox, enospc);
            await expectRejected(util.writeFile(target, marker));
            writes.restore();
            // 2. a failure after 3 bytes
            const partial = stubFsWrite(sandbox, function (n) { return n === 1 ? { bytes: 3 } : fsError("EIO") });
            await expectRejected(util.writeFile(target, marker + marker));
            partial.restore();
            // 3. an error of end together with a failed removal
            wrapStreams(function (stream) {
                stream.end = function (callback) { setImmediate(callback, eio); return stream };
            });
            sandbox.stub(fsx, "unlink").callsFake(failing(fsError("EPERM")));
            await expectRejected(util.writeFile(target, marker));
            await flush();
            let logged = 0;
            LOG_METHODS.concat(["_"]).forEach(function (name) {
                if (typeof log[name] === "function" && log[name].getCalls) {
                    log[name].getCalls().forEach(function (call) {
                        logged++;
                        JSON.stringify(call.args).should.not.containEql(marker);
                    });
                }
            });
            logged.should.be.above(0, "the failures were not logged at all");
        });

        it('AC-19: the temporary file of a failed write is removed before the rejection, and not touched by the next write', async function () {
            let failFirst = true;
            stubFsWrite(sandbox, function () {
                if (failFirst) {
                    failFirst = false;
                    return enospc();
                }
            });
            const events = [];
            const realUnlink = fsx.unlink;
            const unlink = sandbox.stub(fsx, "unlink").callsFake(function () {
                events.push("unlink");
                return realUnlink.apply(fsx, arguments);
            });
            wrapStreams(function () { events.push("open-" + streams.length) });
            const p1 = util.writeFile(target, "FIRST");
            const p2 = util.writeFile(target, "SECOND");
            const settled1 = settle(p1.catch(function (err) { events.push("rejected-1"); throw err }));
            const r1 = await settled1;
            const r2 = await settle(p2);
            r1.state.should.equal("rejected", "the first write was " + r1.state);
            r2.state.should.equal("resolved", "the second write was " + r2.state);
            read(target).should.equal("SECOND");
            unlink.callCount.should.equal(1);
            events.should.eql(["open-1", "unlink", "rejected-1", "open-2"]);
        });

        it('AC-20: a stream closed before the callback of end still ends in a rejection', async function () {
            const eio = fsError("EIO");
            wrapStreams(function (stream) {
                stream.end = function (callback) {
                    stream.destroy();
                    stream.once("close", function () { callback(eio) });
                    return stream;
                };
            });
            const err = await expectRejected(util.writeFile(target, "NEW"));
            err.should.equal(eio);
            read(target).should.equal("OLD");
            exists(tempFile).should.be.false();
        });
    });
    describe('parseJSON', function() {
        it('returns parsed JSON', function() {
            var result = util.parseJSON('{"a":123}');
            result.should.eql({a:123});
        })
        it('ignores BOM character', function() {
            var result = util.parseJSON('\uFEFF{"a":123}');
            result.should.eql({a:123});
        })
    })
});
