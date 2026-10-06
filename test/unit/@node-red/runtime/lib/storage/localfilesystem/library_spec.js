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
 *   #54: acceptance tests of saving a library entry - the save waits for the write and passes on a failed write,
 *   a name that does not denote an entry is refused, the entries are listed right after the save (flaky tests)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var fs = require('fs-extra');
var os = require('os');
var path = require('path');
var sinon = require('sinon');
var NR_TEST_UTILS = require("nr-test-utils");

var localfilesystemLibrary = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/library");
var writeUtil = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/util");
var logger = NR_TEST_UTILS.require("@node-red/util").log;

describe('storage/localfilesystem/library', function() {
    // #54: a directory of its own for each test, so that two runs of this spec do not touch each other's files
    var userDir;
    beforeEach(function() {
        userDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-library-legacy-"));
    });
    afterEach(function(done) {
        fs.remove(userDir,done);
    });

    it('should return an empty list of library objects',function(done) {
        localfilesystemLibrary.init({userDir:userDir}).then(function() {
            localfilesystemLibrary.getLibraryEntry('object','').then(function(flows) {
                flows.should.eql([]);
                done();
            }).catch(function(err) {
                done(err);
            });
        }).catch(function(err) {
            done(err);
        });
    });

    it('should return an empty list of library objects (path=/)',function(done) {
        localfilesystemLibrary.init({userDir:userDir}).then(function() {
            localfilesystemLibrary.getLibraryEntry('object','/').then(function(flows) {
                flows.should.eql([]);
                done();
            }).catch(function(err) {
                done(err);
            });
        }).catch(function(err) {
            done(err);
        });
    });

    it('should return an error for a non-existent library object',function(done) {
        localfilesystemLibrary.init({userDir:userDir}).then(function() {
            localfilesystemLibrary.getLibraryEntry('object','A/B').then(function(flows) {
                should.fail(null,null,"non-existent flow");
            }).catch(function(err) {
                should.exist(err);
                done();
            });
        }).catch(function(err) {
            done(err);
        });
    });

    function createObjectLibrary(type) {
        type = type || "object";
        var objLib = path.join(userDir, "lib", type);
        try {
            fs.mkdirSync(objLib);
        } catch (err) {
        }
        fs.mkdirSync(path.join(objLib, "A"));
        fs.mkdirSync(path.join(objLib, "B"));
        fs.mkdirSync(path.join(objLib, "B", "C"));
        fs.mkdirSync(path.join(objLib, "D"));
        if (type === "functions" || type === "object") {
            fs.writeFileSync(path.join(objLib, "file1.js"), "// abc: def\n// not a metaline \n\n Hi", 'utf8');
            fs.writeFileSync(path.join(objLib, "B", "file2.js"), "// ghi: jkl\n// not a metaline \n\n Hi", 'utf8');
            fs.writeFileSync(path.join(objLib, "D", "file3.js"), "// mno: 日本語テスト\n\nこんにちわ", 'utf8');
        }
        if (type === "flows" || type === "object") {
            fs.writeFileSync(path.join(objLib, "B", "flow.json"), "Hi", 'utf8');
        }
    }

    it('should return a directory listing of library objects', function (done) {
        localfilesystemLibrary.init({userDir: userDir}).then(function () {
            createObjectLibrary();

            localfilesystemLibrary.getLibraryEntry('object', '').then(function (flows) {
                flows.should.eql([ 'A', 'B', 'D', { abc: 'def', fn: 'file1.js' }]);
                localfilesystemLibrary.getLibraryEntry('object', 'B').then(function (flows) {
                    flows.should.eql([ 'C', { ghi: 'jkl', fn: 'file2.js' }, { fn: 'flow.json' }]);
                    localfilesystemLibrary.getLibraryEntry('object', 'B/C').then(function (flows) {
                        flows.should.eql([]);
                        localfilesystemLibrary.getLibraryEntry('object', 'D').then(function (flows) {
                            flows.should.eql([{ mno: '日本語テスト', fn: 'file3.js' }]);
                            done();
                        }).catch(function (err) {
                            done(err);
                        });
                    }).catch(function (err) {
                        done(err);
                    });
                }).catch(function (err) {
                    done(err);
                });
            }).catch(function (err) {
                done(err);
            });
        }).catch(function (err) {
            done(err);
        });
    });

    it('should load a flow library object with .json unspecified', function(done) {
        localfilesystemLibrary.init({userDir:userDir}).then(function() {
            createObjectLibrary("flows");
            localfilesystemLibrary.getLibraryEntry('flows','B/flow').then(function(flows) {
                flows.should.eql("Hi");
                done();
            }).catch(function(err) {
                done(err);
            });
        });

    });

    it('should return a library object',function(done) {
        localfilesystemLibrary.init({userDir:userDir}).then(function() {
            createObjectLibrary();
            localfilesystemLibrary.getLibraryEntry('object','B/file2.js').then(function(body) {
                body.should.eql("// not a metaline \n\n Hi");
                done();
            }).catch(function(err) {
                done(err);
            });
        }).catch(function(err) {
            done(err);
        });
    });

    it('should return a newly saved library function',function(done) {
        localfilesystemLibrary.init({userDir:userDir}).then(function() {
            createObjectLibrary("functions");
            localfilesystemLibrary.getLibraryEntry('functions','B').then(function(flows) {
                flows.should.eql([ 'C', { ghi: 'jkl', fn: 'file2.js' } ]);
                var ft = path.join("B","D","file3.js");
                localfilesystemLibrary.saveLibraryEntry('functions',ft,{mno:'pqr'},"// another non meta line\n\n Hi There").then(function() {
                    (function() {
                        localfilesystemLibrary.getLibraryEntry('functions',path.join("B","D")).then(function(flows) {
                            flows.should.eql([ { mno: 'pqr', fn: 'file3.js' } ]);
                            localfilesystemLibrary.getLibraryEntry('functions',ft).then(function(body) {
                                body.should.eql("// another non meta line\n\n Hi There");
                                done();
                            }).catch(function(err) {
                                done(err);
                            });
                        }).catch(function(err) {
                            done(err);
                        })
                    })();
                }).catch(function(err) {
                    done(err);
                });
            }).catch(function(err) {
                done(err);
            });
        }).catch(function(err) {
            done(err);
        });
    });

    it('should return a newly saved library flow',function(done) {
        localfilesystemLibrary.init({userDir:userDir}).then(function() {
            createObjectLibrary("flows");
            localfilesystemLibrary.getLibraryEntry('flows','B').then(function(flows) {
                flows.should.eql([ 'C', {fn:'flow.json'} ]);
                var ft = path.join("B","D","file3");
                localfilesystemLibrary.saveLibraryEntry('flows',ft,{mno:'pqr'},"Hi").then(function() {
                    (function() {
                        localfilesystemLibrary.getLibraryEntry('flows',path.join("B","D")).then(function(flows) {
                            flows.should.eql([ { mno: 'pqr', fn: 'file3.json' } ]);
                            localfilesystemLibrary.getLibraryEntry('flows',ft+".json").then(function(body) {
                                body.should.eql("Hi");
                                done();
                            }).catch(function(err) {
                                done(err);
                            });
                        }).catch(function(err) {
                            done(err);
                        })
                    })();
                }).catch(function(err) {
                    done(err);
                });
            }).catch(function(err) {
                done(err);
            });
        }).catch(function(err) {
            done(err);
        });
    });

    it('should return a newly saved library flow (multi-byte character)',function(done) {
        localfilesystemLibrary.init({userDir:userDir}).then(function() {
            createObjectLibrary("flows");
            localfilesystemLibrary.getLibraryEntry('flows','B').then(function(flows) {
                flows.should.eql([ 'C', {fn:'flow.json'} ]);
                var ft = path.join("B","D","file4");
                localfilesystemLibrary.saveLibraryEntry('flows',ft,{mno:'pqr'},"こんにちわこんにちわこんにちわ").then(function() {
                    (function() {
                        localfilesystemLibrary.getLibraryEntry('flows',path.join("B","D")).then(function(flows) {
                            flows.should.eql([ { mno: 'pqr', fn: 'file4.json' } ]);
                            localfilesystemLibrary.getLibraryEntry('flows',ft+".json").then(function(body) {
                                body.should.eql("こんにちわこんにちわこんにちわ");
                                done();
                            }).catch(function(err) {
                                done(err);
                            });
                        }).catch(function(err) {
                            done(err);
                        })
                    })();
                }).catch(function(err) {
                    done(err);
                });
            }).catch(function(err) {
                done(err);
            });
        }).catch(function(err) {
            done(err);
        });
    });
    // #54: saving an entry waits for the write of the file and passes on a failed write
    describe('saving an entry (#54)', function() {
        let dir;
        let libDir;
        let writes;
        let originalWriteFile;

        function save(type, name, meta, body) {
            return localfilesystemLibrary.saveLibraryEntry(type, name, meta, body);
        }

        function listing() {
            return fs.readdirSync(libDir, { recursive: true }).map(String);
        }

        function turns(count) {
            return new Promise(function(resolve) {
                (function next(n) { n === 0 ? resolve() : setImmediate(next, n - 1) })(count);
            });
        }

        beforeEach(async function() {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-library-'));
            libDir = path.join(dir, 'lib');
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
            await localfilesystemLibrary.init({ userDir: dir });
        });

        afterEach(async function() {
            writeUtil.writeFile = originalWriteFile;
            sinon.restore();
            await Promise.allSettled(writes);
            fs.chmodSync(dir, 0o755);
            fs.removeSync(dir);
        });

        it('AC-22: the save resolves after the write of the file', async function() {
            let finish;
            const stub = sinon.stub().callsFake(function() { return new Promise(function(resolve) { finish = resolve }) });
            writeUtil.writeFile = stub;
            let settled = false;
            const saving = save('functions', path.join('B', 'D', 'file3.js'), { mno: 'pqr' }, 'body').then(function(result) {
                settled = true;
                return result;
            });
            // the save calls the write within a few turns; a bound keeps a save that never writes from
            // spinning on after the test
            for (let n = 0; !stub.called; n++) {
                if (n >= 1000) {
                    throw new Error("the save did not call the write within 1000 turns of the event loop");
                }
                await turns(1);
            }
            stub.firstCall.args.should.eql([path.join(libDir, 'functions', 'B', 'D', 'file3.js'), '// mno: pqr\nbody']);
            await turns(10);
            settled.should.be.false();
            finish();
            should(await saving).be.undefined();
        });

        it('AC-23: a failed write rejects the save with the error of the write', async function() {
            const failure = new Error('write failed');
            failure.code = 'EIO';
            writeUtil.writeFile = function() {
                const rejected = Promise.reject(failure);
                rejected.catch(function() {});
                return rejected;
            };
            let outcome;
            try {
                await save('functions', 'B/file.js', {}, 'x');
                outcome = 'resolved';
            } catch (err) {
                outcome = err;
            }
            (outcome === failure).should.be.true();
        });

        it('AC-24: a folder that cannot be written rejects the save with EACCES and leaves nothing behind', async function() {
            if (process.getuid && process.getuid() === 0) {
                // chmod does not stop root from writing
                this.skip();
            }
            const target = path.join(libDir, 'functions', 'RO');
            fs.ensureDirSync(target);
            fs.chmodSync(target, 0o555);
            let outcome;
            try {
                await save('functions', 'RO/b.js', {}, 'x');
                outcome = 'resolved';
            } catch (err) {
                outcome = err;
            }
            try {
                outcome.should.have.property('code', 'EACCES');
                fs.readdirSync(target).should.eql([]);
            } finally {
                fs.chmodSync(target, 0o755);
            }
        });

        it('AC-25: a saved function is listed right after the save, with its content', async function() {
            const name = path.join('B', 'D', 'file3.js');
            await save('functions', name, { mno: 'pqr' }, '// another non meta line\n\n Hi There');
            (await localfilesystemLibrary.getLibraryEntry('functions', path.join('B', 'D'))).should.eql([{ mno: 'pqr', fn: 'file3.js' }]);
            (await localfilesystemLibrary.getLibraryEntry('functions', name)).should.eql('// another non meta line\n\n Hi There');
        });

        it('AC-25: a saved flow is listed right after the save, with its content', async function() {
            await save('flows', path.join('B', 'D', 'file3'), { mno: 'pqr' }, 'Hi');
            (await localfilesystemLibrary.getLibraryEntry('flows', path.join('B', 'D'))).should.eql([{ mno: 'pqr', fn: 'file3.json' }]);
            (await localfilesystemLibrary.getLibraryEntry('flows', path.join('B', 'D', 'file3.json'))).should.eql('Hi');
        });

        it('AC-25: a saved flow with multi-byte characters is listed right after the save, with its content', async function() {
            await save('flows', path.join('B', 'D', 'file4'), { mno: 'pqr' }, 'こんにちわこんにちわこんにちわ');
            (await localfilesystemLibrary.getLibraryEntry('flows', path.join('B', 'D'))).should.eql([{ mno: 'pqr', fn: 'file4.json' }]);
            (await localfilesystemLibrary.getLibraryEntry('flows', path.join('B', 'D', 'file4.json'))).should.eql('こんにちわこんにちわこんにちわ');
        });

        it('AC-26: a failed fsync is logged and the entry is saved in full', async function() {
            const warn = sinon.stub(logger, 'warn');
            // The text of a message depends on the catalogs that other specs have loaded (none: undefined; the
            // runtime catalog: the translated sentence). The key and the path are what the test looks for.
            sinon.stub(logger, '_').callsFake(function(key, opts) { return key + ' ' + opts.path });
            const fs2 = require('fs-extra');
            sinon.stub(fs2, 'fsync').callsFake(function(fd, callback) { callback(new Error('fsync failed')) });
            await save('functions', 'B/file.js', { a: 'b' }, 'content');
            warn.called.should.be.true();
            const logged = warn.args.map(function(args) { return String(args[0]) }).join('\n');
            logged.should.containEql('fsync-fail');
            logged.should.containEql('file.js.$$$');
            fs.readFileSync(path.join(libDir, 'functions', 'B', 'file.js'), 'utf8').should.eql('// a: b\ncontent');
        });

        it('AC-27: with readOnly the save resolves without writing', async function() {
            const readOnlyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-library-ro-'));
            try {
                await localfilesystemLibrary.init({ userDir: readOnlyDir, readOnly: true });
                should(await save('functions', 'B/file.js', {}, 'x')).be.undefined();
                fs.existsSync(path.join(readOnlyDir, 'lib')).should.be.false();
            } finally {
                fs.removeSync(readOnlyDir);
            }
        });

        it('AC-28: two saves of one entry, one after the other: each resolves after its own write, the last wins', async function() {
            const file = path.join(libDir, 'functions', 'C', 'x.js');
            const first = save('functions', 'C/x.js', {}, 'X');
            const second = save('functions', 'C/x.js', {}, 'Y');
            await first;
            ['X', 'Y'].should.containEql(fs.readFileSync(file, 'utf8'));
            await second;
            fs.readFileSync(file, 'utf8').should.eql('Y');
            listing().filter(function(n) { return n.endsWith('.$$$') }).should.eql([]);
        });

        it('AC-29: a flow with a body that is not JSON is rejected before anything is written', async function() {
            await localfilesystemLibrary.init({ userDir: dir, flowFilePretty: true });
            const err = await save('flows', 'bad', {}, '{not json').should.be.rejected();
            err.should.be.instanceof(SyntaxError);
            fs.existsSync(path.join(libDir, 'flows', 'bad.json')).should.be.false();
        });

        it('AC-29: meta with a value that is not text is rejected before anything is written', async function() {
            const err = await save('functions', 'B/file.js', { a: 5 }, 'x').should.be.rejected();
            err.should.be.instanceof(TypeError);
            fs.existsSync(path.join(libDir, 'functions', 'B')).should.be.false();
        });

        it('AC-44: a name that does not denote an entry is refused (403 code) and nothing is written', async function() {
            let outcome;
            try {
                await save('functions', '', {}, 'x');
                outcome = 'resolved';
            } catch (err) {
                outcome = err;
            }
            outcome.should.have.property('code', 'forbidden');
            outcome.should.have.property('message', '');
            await Promise.allSettled(writes);
            // the folder of the type is not replaced by a file
            if (fs.existsSync(path.join(libDir, 'functions'))) {
                fs.statSync(path.join(libDir, 'functions')).isDirectory().should.be.true();
            }
            listing().filter(function(n) { return n.endsWith('.$$$') }).should.eql([]);
        });

        it('AC-46: two names that differ in letter case only are both settled and leave no temporary file', async function() {
            // where letter case matters (most Linux file systems) each name has its own file
            const probe = path.join(dir, 'Probe');
            fs.writeFileSync(probe, '');
            const caseSensitive = !fs.existsSync(path.join(dir, 'probe'));
            const results = await Promise.allSettled([
                save('functions', 'A.js', {}, 'AAAA'),
                save('functions', 'a.js', {}, 'bb')
            ]);
            results.should.have.length(2);
            results.forEach(function(result) { ['fulfilled', 'rejected'].should.containEql(result.status) });
            listing().filter(function(n) { return n.endsWith('.$$$') }).should.eql([]);
            if (caseSensitive) {
                results.forEach(function(result) { result.status.should.equal('fulfilled') });
                fs.readFileSync(path.join(libDir, 'functions', 'A.js'), 'utf8').should.eql('AAAA');
                fs.readFileSync(path.join(libDir, 'functions', 'a.js'), 'utf8').should.eql('bb');
            }
        });

        it('AC-47: a name that starts with two dots is a normal entry', async function() {
            should(await save('functions', '..notes.js', { a: 'b' }, 'x')).be.undefined();
            fs.readFileSync(path.join(libDir, 'functions', '..notes.js'), 'utf8').should.eql('// a: b\nx');
        });

        it('AC-48: with readOnly an empty name resolves like any other name', async function() {
            const readOnlyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-library-ro-'));
            try {
                await localfilesystemLibrary.init({ userDir: readOnlyDir, readOnly: true });
                should(await save('functions', '', {}, 'x')).be.undefined();
                fs.existsSync(path.join(readOnlyDir, 'lib')).should.be.false();
            } finally {
                fs.removeSync(readOnlyDir);
            }
        });
    });
});
