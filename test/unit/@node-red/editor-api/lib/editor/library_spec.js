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
 *   #19: supertest bound to 127.0.0.1 (nr-test-utils/supertest), no crosstalk with other processes (flaky tests)
 *   #54: the answers of a save that fails and of a name that does not denote an entry (flaky tests)
 *   #63: a save of a name that ends with .$$$ (the working file of a write) is answered with 403
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var sinon = require("sinon");
var request = require("nr-test-utils/supertest");
var express = require('express');
var bodyParser = require('body-parser');
var fs = require('fs-extra');
var os = require('os');
var path = require('path');

var NR_TEST_UTILS = require("nr-test-utils");

var library = NR_TEST_UTILS.require("@node-red/editor-api/lib/editor/library");
var runtimeApiLibrary = NR_TEST_UTILS.require("@node-red/runtime/lib/api/library");
var runtimeLocalLibrary = NR_TEST_UTILS.require("@node-red/runtime/lib/library/local");
var fileLibrary = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/library");
var writeUtil = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/util");

var app;

describe("api/editor/library", function() {

    before(function() {
        app = express();
        app.use(bodyParser.json());
        app.get(/library\/([^\/]+)\/([^\/]+)(?:$|\/(.*))/,library.getEntry);
        app.post(/library\/([^\/]+)\/([^\/]+)\/(.*)/,library.saveEntry);
    });
    after(function() {
    });

    it('returns an individual entry - flow type', function(done) {
        var opts;
        library.init({
            library: {
                getEntry: function(_opts) {
                    opts = _opts;
                    return Promise.resolve('{"a":1,"b":2}');
                }
            }
        });
        request(app)
            .get('/library/local/flows/abc')
            .expect(200)
            .end(function(err,res) {
                if (err) {
                    return done(err);
                }
                res.body.should.have.property('a',1);
                res.body.should.have.property('b',2);
                opts.should.have.property('library','local');
                opts.should.have.property('type','flows');
                opts.should.have.property('path','abc');
                done();
            });
    })
    it('returns a directory listing - flow type', function(done) {
        var opts;
        library.init({
            library: {
                getEntry: function(_opts) {
                    opts = _opts;
                    return Promise.resolve({"a":1,"b":2});
                }
            }
        });
        request(app)
            .get('/library/local/flows/abc/def')
            .expect(200)
            .end(function(err,res) {
                if (err) {
                    return done(err);
                }
                res.body.should.have.property('a',1);
                res.body.should.have.property('b',2);
                opts.should.have.property('library','local');
                opts.should.have.property('type','flows');
                opts.should.have.property('path','abc/def');
                done();
            });
    })
    it('returns an individual entry - non-flow type', function(done) {
        var opts;
        library.init({
            library: {
                getEntry: function(_opts) {
                    opts = _opts;
                    return Promise.resolve('{"a":1,"b":2}');
                }
            }
        });
        request(app)
            .get('/library/local/non-flow/abc')
            .expect(200)
            .end(function(err,res) {
                if (err) {
                    return done(err);
                }
                opts.should.have.property('library','local');
                opts.should.have.property('type','non-flow');
                opts.should.have.property('path','abc');
                res.text.should.eql('{"a":1,"b":2}');
                done();
            });
    })
    it('returns a directory listing - non-flow type', function(done) {
        var opts;
        library.init({
            library: {
                getEntry: function(_opts) {
                    opts = _opts;
                    return Promise.resolve({"a":1,"b":2});
                }
            }
        });
        request(app)
            .get('/library/local/non-flow/abc/def')
            .expect(200)
            .end(function(err,res) {
                if (err) {
                    return done(err);
                }
                res.body.should.have.property('a',1);
                res.body.should.have.property('b',2);
                opts.should.have.property('library','local');
                opts.should.have.property('type','non-flow');
                opts.should.have.property('path','abc/def');
                done();
            });
    })

    it('returns an error on individual get', function(done) {
        var opts;
        library.init({
            library: {
                getEntry: function(_opts) {
                    opts = _opts;
                    var err = new Error("message");
                    err.code = "random_error";
                    err.status = 400;
                    var p = Promise.reject(err);
                    p.catch(()=>{});
                    return p;
                }
            }
        });
        request(app)
            .get('/library/local/flows/123')
            .expect(400)
            .end(function(err,res) {
                if (err) {
                    return done(err);
                }
                opts.should.have.property('library','local');
                opts.should.have.property('type','flows');
                opts.should.have.property('path','123');

                res.body.should.have.property('code');
                res.body.code.should.be.equal("random_error");
                res.body.should.have.property('message');
                res.body.message.should.be.equal("message");
                done();
            });
    });


    it('saves an individual entry - flow type', function(done) {
        var opts;
        library.init({
            library: {
                saveEntry: function(_opts) {
                    opts = _opts;
                    return Promise.resolve();
                }
            }
        });
        request(app)
            .post('/library/local/flows/abc/def')
            .expect(204)
            .send({a:1,b:2,c:3})
            .end(function(err,res) {
                if (err) {
                    return done(err);
                }
                opts.should.have.property('library','local');
                opts.should.have.property('type','flows');
                opts.should.have.property('path','abc/def');
                opts.should.have.property('meta',{});
                opts.should.have.property('body',JSON.stringify({a:1,b:2,c:3}));
                done();
            });
    })

    it('saves an individual entry - non-flow type', function(done) {
        var opts;
        library.init({
            library: {
                saveEntry: function(_opts) {
                    opts = _opts;
                    return Promise.resolve();
                }
            }
        });
        request(app)
            .post('/library/local/non-flow/abc/def')
            .expect(204)
            .send({a:1,b:2,text:"123"})
            .end(function(err,res) {
                if (err) {
                    return done(err);
                }
                opts.should.have.property('library','local');
                opts.should.have.property('type','non-flow');
                opts.should.have.property('path','abc/def');
                opts.should.have.property('meta',{a:1,b:2});
                opts.should.have.property('body',"123");
                done();
            });
    })

    it('returns an error on individual save', function(done) {
        var opts;
        library.init({
            library: {
                saveEntry: function(_opts) {
                    opts = _opts;
                    var err = new Error("message");
                    err.code = "random_error";
                    err.status = 400;
                    var p = Promise.reject(err);
                    p.catch(()=>{});
                    return p;
                }
            }
        });
        request(app)
            .post('/library/local/non-flow/abc/def')
            .send({a:1,b:2,text:"123"})
            .expect(400)
            .end(function(err,res) {
                if (err) {
                    return done(err);
                }
                opts.should.have.property('type','non-flow');
                opts.should.have.property('library','local');
                opts.should.have.property('path','abc/def');

                res.body.should.have.property('code');
                res.body.code.should.be.equal("random_error");
                res.body.should.have.property('message');
                res.body.message.should.be.equal("message");
                done();
            });
    });
    // #54: the answers of a save to the library
    describe("answers of a save (#54)", function() {
        it('AC-31: a save that fails without a code answers 400 unexpected_error and no path', function(done) {
            library.init({
                library: {
                    saveEntry: function(_opts) {
                        // the shape of the error of runtime/lib/api/library.js
                        var err = new Error();
                        err.status = 400;
                        var p = Promise.reject(err);
                        p.catch(()=>{});
                        return p;
                    }
                }
            });
            request(app)
                .post('/library/local/functions/a/b')
                .send({text:"x"})
                .expect(400)
                .end(function(err,res) {
                    if (err) {
                        return done(err);
                    }
                    try {
                        res.body.should.eql({code:"unexpected_error", message:"Error"});
                        done();
                    } catch(e) {
                        done(e);
                    }
                });
        });

        describe("with the file storage", function() {
            let dir;
            let writes;
            let originalWriteFile;
            const mockLog = { log: sinon.stub(), debug: sinon.stub(), trace: sinon.stub(), warn: sinon.stub(), info: sinon.stub(), metric: sinon.stub(), audit: sinon.stub(), _: function() { return "abc" } };

            beforeEach(async function() {
                dir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-editor-library-"));
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
                runtimeLocalLibrary.init({ log: mockLog, storage: fileLibrary });
                runtimeApiLibrary.init({
                    log: mockLog,
                    library: { saveEntry: function(lib, type, entryPath, meta, body) { return runtimeLocalLibrary.saveEntry(type, entryPath, meta, body) } }
                });
                library.init({ library: runtimeApiLibrary });
            });

            afterEach(async function() {
                writeUtil.writeFile = originalWriteFile;
                await Promise.allSettled(writes);
                fs.removeSync(dir);
            });

            it('AC-44: a name that does not denote an entry is refused with 403 and nothing is written', async function() {
                const res = await request(app).post('/library/local/functions/').send({text:"x"});
                res.status.should.equal(403);
                res.text.should.equal('{"code":"forbidden","message":"Error"}');
                await Promise.allSettled(writes);
                fs.existsSync(path.join(dir, "lib", "functions")).should.be.false();
            });

            it('B6-AC-10 (#63): a save to a name that ends with .$$$ answers 403 and nothing is written', async function() {
                const res = await request(app).post('/library/local/functions/a.js.$$$').send({text:"x", mno:"pqr"});
                res.status.should.equal(403);
                res.text.should.equal('{"code":"forbidden","message":"Error"}');
                await Promise.allSettled(writes);
                writes.should.have.length(0);
                const libDir = path.join(dir, "lib");
                fs.readdirSync(libDir, { recursive: true }).map(String).filter(n => /\$\$\$/.test(n)).should.eql([]);
            });

            it('B6-AC-10 (#63, unchanged): the name a.js.$$$x is a name of an entry and answers 204', async function() {
                const res = await request(app).post('/library/local/functions/a.js.$$$x').send({text:"x"});
                res.status.should.equal(204);
                fs.existsSync(path.join(dir, "lib", "functions", "a.js.$$$x")).should.be.true();
            });

            it('AC-44: a save to a name of an entry answers 204 when the file is on disk', async function() {
                const res = await request(app).post('/library/local/functions/a.js').send({text:"x", mno:"pqr"});
                res.status.should.equal(204);
                fs.readFileSync(path.join(dir, "lib", "functions", "a.js"), "utf8").should.equal("// mno: pqr\nx");
            });
        });
    });
});
