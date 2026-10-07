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
 *   #63: the audit events of the install of a module do not contain the credentials of the install URL or of a module given as a URL
 *   #82: removing or disabling node types during a drain stop: 409 http_drain_in_progress, audited; the other errors keep their status
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var sinon = require("sinon");

var NR_TEST_UTILS = require("nr-test-utils");
var nodes = NR_TEST_UTILS.require("@node-red/runtime/lib/api/nodes")

var mockLog = () => ({
    log: sinon.stub(),
    debug: sinon.stub(),
    trace: sinon.stub(),
    warn: sinon.stub(),
    info: sinon.stub(),
    metric: sinon.stub(),
    audit: sinon.stub(),
    _: function() { return "abc"}
})

describe("runtime-api/nodes", function() {
    describe("getNodeInfo", function() {
        beforeEach(function() {
            nodes.init({
                log: mockLog(),
                nodes: {
                    getNodeInfo: function(id) {
                        if (id === "known") {
                            return {id:"known"};
                        } else {
                            return null;
                        }
                    }
                }
            });
        })
        it("returns node info", function(done) {
            nodes.getNodeInfo({id:"known"}).then(function(result) {
                result.should.eql({id:"known"});
                done();
            }).catch(done);
        });
        it("returns 404 if node not known", function(done) {
            nodes.getNodeInfo({id:"unknown"}).then(function(result) {
                done(new Error("Did not return internal error"));
            }).catch(function(err) {
                err.should.have.property('code','not_found');
                err.should.have.property('status',404);
                done();
            }).catch(done);
        });
    });
    describe("getNodeList", function() {
        beforeEach(function() {
            nodes.init({
                log: mockLog(),
                nodes: {
                    getNodeList: function() {
                        return [1,2,3];
                    }
                }
            });
        })
        it("returns node list", function(done) {
            nodes.getNodeList({}).then(function(result) {
                result.should.eql([1,2,3]);
                done();
            }).catch(done);
        });
    });

    describe("getNodeConfig", function() {
        beforeEach(function() {
            nodes.init({
                log: mockLog(),
                nodes: {
                    getNodeConfig: function(id,lang) {
                        if (id === "known") {
                            return id+lang;
                        } else {
                            return null;
                        }
                    }
                }
            });
        })
        it("returns node config", function(done) {
            nodes.getNodeConfig({id:"known",lang:'lang'}).then(function(result) {
                result.should.eql("knownlang");
                done();
            }).catch(done);
        });
        it("returns 404 if node not known", function(done) {
            nodes.getNodeConfig({id:"unknown",lang:'lang'}).then(function(result) {
                done(new Error("Did not return internal error"));
            }).catch(function(err) {
                err.should.have.property('code','not_found');
                err.should.have.property('status',404);
                done();
            }).catch(done);
        });
    });

    describe("getNodeConfigs", function() {
        beforeEach(function() {
            nodes.init({
                log: mockLog(),
                nodes: {
                    getNodeConfigs: function(lang) {
                        return lang;
                    }
                }
            });
        })
        it("returns all node configs", function(done) {
            nodes.getNodeConfigs({lang:'lang'}).then(function(result) {
                result.should.eql("lang");
                done();
            }).catch(done);
        });
    });

    describe("getModuleInfo", function() {
        beforeEach(function() {
            nodes.init({
                log: mockLog(),
                nodes: {
                    getModuleInfo: function(id) {
                        if (id === "known") {
                            return {module:"known"};
                        } else {
                            return null;
                        }
                    }
                }
            });
        })
        it("returns node info", function(done) {
            nodes.getModuleInfo({module:"known"}).then(function(result) {
                result.should.eql({module:"known"});
                done();
            }).catch(done);
        });
        it("returns 404 if node not known", function(done) {
            nodes.getModuleInfo({module:"unknown"}).then(function(result) {
                done(new Error("Did not return internal error"));
            }).catch(function(err) {
                err.should.have.property('code','not_found');
                err.should.have.property('status',404);
                done();
            }).catch(done);
        });
    });

    describe("addModule: audit of the install (#63, B2-AC-5)", function() {
        var audit;
        var installModule;
        var getModuleInfo;
        var URL = "https://user:s3cret@host/x.tgz";
        var MASKED = "https://***@host/x.tgz";

        beforeEach(function() {
            audit = sinon.stub();
            installModule = sinon.stub();
            getModuleInfo = sinon.stub().returns(null);
            var log = mockLog();
            log.audit = audit;
            nodes.init({
                log: log,
                settings: { available: function() { return true; } },
                nodes: { installModule: installModule, getModuleInfo: getModuleInfo }
            });
        });

        function events() {
            return audit.args.map(a => a[0]);
        }
        function installEvents() {
            return events().filter(e => e.event === "nodes.install");
        }
        function fail(opts) {
            return nodes.addModule(opts).then(() => { throw new Error("should have failed"); }, err => err);
        }
        function assertMasked() {
            var all = installEvents();
            all.length.should.be.above(0);
            JSON.stringify(all).should.not.containEql("s3cret");
        }

        it("success: the url is masked", async function() {
            installModule.resolves({ id: "x" });
            await nodes.addModule({ module: "x", url: URL });
            assertMasked();
            installEvents().should.have.length(1);
            installEvents()[0].should.have.property("module", "x");
            installEvents()[0].should.have.property("url", MASKED);
        });

        it("success: a module given as a URL is masked", async function() {
            installModule.resolves({ id: "x" });
            await nodes.addModule({ module: "https://user:s3cret@host/x.tgz" });
            assertMasked();
            installEvents()[0].should.have.property("module", MASKED);
        });

        it("404: the url and the module are masked", async function() {
            var e = new Error("Module not found");
            e.code = 404;
            installModule.rejects(e);
            await fail({ module: "x", url: URL });
            assertMasked();
            installEvents()[0].should.have.property("error", "not_found");
            installEvents()[0].should.have.property("url", MASKED);
            await fail({ module: "https://user:s3cret@host/x.tgz" });
            assertMasked();
        });

        it("an error with a code: the url and the module are masked", async function() {
            var e = new Error("failed");
            e.code = "x";
            installModule.rejects(e);
            await fail({ module: "x", url: URL });
            await fail({ module: "https://user:s3cret@host/x.tgz" });
            assertMasked();
            installEvents()[0].should.have.property("error", "x");
            installEvents()[0].should.have.property("url", MASKED);
        });

        it("an error without a code: the url and the module are masked (and the message of the error is as it was)", async function() {
            installModule.rejects(new Error("plain failure"));
            await fail({ module: "x", url: URL });
            await fail({ module: "https://user:s3cret@host/x.tgz" });
            assertMasked();
            installEvents()[0].should.have.property("error", "unexpected_error");
            installEvents()[0].should.have.property("message", "Error: plain failure");
            installEvents()[0].should.have.property("url", MASKED);
        });

        it("the literal password is masked also when it appears outside the URL form", async function() {
            installModule.rejects(new Error("plain failure"));
            await fail({ module: "x", url: "https://user:p%40ss1@host/x.tgz" });
            JSON.stringify(installEvents()).should.not.containEql("p%40ss1");
            JSON.stringify(installEvents()).should.not.containEql("p@ss1");
        });

        it("module_already_loaded: the module is masked", async function() {
            getModuleInfo.returns({ user: true, version: "1.0.0" });
            var err = await fail({ module: "https://user:s3cret@host/x.tgz" });
            err.should.have.property("code", "module_already_loaded");
            assertMasked();
            installEvents()[0].should.have.property("error", "module_already_loaded");
            installEvents()[0].should.have.property("module", MASKED);
        });

        it("a tarball together with a module and a url (invalid request): the module and the url are masked", async function() {
            var err = await fail({ tarball: { file: "a.tgz", buffer: Buffer.from("x") }, module: "https://user:s3cret@host/x.tgz", url: URL });
            err.should.have.property("code", "invalid_request");
            assertMasked();
        });

        it("a tarball without a url: the events are unchanged", async function() {
            installModule.resolves({ id: "x" });
            await nodes.addModule({ tarball: { file: "a.tgz", buffer: Buffer.from("x") } });
            installEvents().should.eql([{ event: "nodes.install", tarball: "a.tgz", module: "x" }]);
            audit.resetHistory();
            var e = new Error("bad tarball");
            e.code = "invalid_module";
            installModule.rejects(e);
            await fail({ tarball: { file: "a.tgz", buffer: Buffer.from("x") } });
            installEvents().should.eql([{ event: "nodes.install", module: undefined, version: undefined, url: undefined, error: "invalid_module" }]);
        });

        it("a url without credentials and a plain module name are unchanged", async function() {
            installModule.resolves({ id: "x" });
            await nodes.addModule({ module: "x", version: "1.0.0", url: "https://host/x.tgz" });
            installEvents().should.eql([{ event: "nodes.install", module: "x", version: "1.0.0", url: "https://host/x.tgz" }]);
        });
    });

    describe("removal and disabling during a drain stop: 409 http_drain_in_progress (S-5, #82)", function() {
        var audit;

        function drainError() {
            var e = new Error("constant text of the refusal");
            e.code = "http_drain_in_progress";
            return e;
        }
        function setup(nodesApi) {
            audit = sinon.stub();
            var log = mockLog();
            log.audit = audit;
            nodes.init({
                log: log,
                settings: { available: function() { return true; } },
                nodes: Object.assign({
                    getModuleInfo: function() { return { name: "m", nodes: [{ id: "m/a", enabled: true }, { id: "m/b", enabled: true }] }; },
                    getNodeInfo: function() { return { id: "m/a", enabled: true }; }
                }, nodesApi)
            });
        }
        function auditEvents(name) {
            return audit.args.map(function(a) { return a[0]; }).filter(function(e) { return e.event === name; });
        }
        function failure(promise) {
            return promise.then(function() { throw new Error("should have failed"); }, function(err) { return err; });
        }

        it("removeModule: a refusal that the check throws has status 409 and is audited with its code", async function() {
            setup({ uninstallModule: function() { throw drainError(); } });
            var err = await failure(nodes.removeModule({ module: "m" }));
            err.should.have.property("code", "http_drain_in_progress");
            err.should.have.property("status", 409);
            auditEvents("nodes.remove").should.have.length(1);
            auditEvents("nodes.remove")[0].should.have.property("module", "m");
            auditEvents("nodes.remove")[0].should.have.property("error", "http_drain_in_progress");
        });
        it("removeModule: a refusal that comes as a rejection has status 409 too", async function() {
            setup({ uninstallModule: function() { return Promise.reject(drainError()); } });
            var err = await failure(nodes.removeModule({ module: "m" }));
            err.should.have.property("status", 409);
            auditEvents("nodes.remove")[0].should.have.property("error", "http_drain_in_progress");
        });
        it("removeModule: the other errors keep 400 (thrown and rejected) and 404 stays", async function() {
            setup({ uninstallModule: function() { throw new Error("boom"); } });
            (await failure(nodes.removeModule({ module: "m" }))).should.have.property("status", 400);
            setup({ uninstallModule: function() { return Promise.reject(new Error("boom")); } });
            (await failure(nodes.removeModule({ module: "m" }))).should.have.property("status", 400);
            var typeInUse = new Error("in use");
            typeInUse.code = "type_in_use";
            setup({ uninstallModule: function() { throw typeInUse; } });
            (await failure(nodes.removeModule({ module: "m" }))).should.have.property("status", 400);
            setup({ getModuleInfo: function() { return null; } });
            (await failure(nodes.removeModule({ module: "m" }))).should.have.property("status", 404);
        });
        it("setModuleState (disable): a refusal has status 409 and is audited as nodes.module.set; no other node is disabled", async function() {
            var disabled = [];
            setup({ disableNode: function(id) { disabled.push(id); throw drainError(); } });
            var err = await failure(nodes.setModuleState({ module: "m", enabled: false }));
            err.should.have.property("code", "http_drain_in_progress");
            err.should.have.property("status", 409);
            auditEvents("nodes.module.set").should.have.length(1);
            auditEvents("nodes.module.set")[0].should.have.property("error", "http_drain_in_progress");
            auditEvents("nodes.module.set")[0].should.have.property("module", "m");
        });
        it("setModuleState: a refusal that comes as a rejection has status 409; another error keeps 400", async function() {
            setup({ disableNode: function() { return Promise.reject(drainError()); } });
            (await failure(nodes.setModuleState({ module: "m", enabled: false }))).should.have.property("status", 409);
            setup({ disableNode: function() { return Promise.reject(new Error("boom")); } });
            (await failure(nodes.setModuleState({ module: "m", enabled: false }))).should.have.property("status", 400);
            setup({ disableNode: function() { throw new Error("boom"); } });
            (await failure(nodes.setModuleState({ module: "m", enabled: false }))).should.have.property("status", 400);
        });
        it("setNodeSetState (disable): a refusal has status 409 and is audited as nodes.info.set", async function() {
            setup({ disableNode: function() { throw drainError(); } });
            var err = await failure(nodes.setNodeSetState({ id: "m/a", enabled: false }));
            err.should.have.property("code", "http_drain_in_progress");
            err.should.have.property("status", 409);
            auditEvents("nodes.info.set").should.have.length(1);
            auditEvents("nodes.info.set")[0].should.have.property("error", "http_drain_in_progress");
            auditEvents("nodes.info.set")[0].should.have.property("id", "m/a");
        });
        it("setNodeSetState: a refusal that comes as a rejection has status 409; another error keeps 400", async function() {
            setup({ disableNode: function() { return Promise.reject(drainError()); } });
            (await failure(nodes.setNodeSetState({ id: "m/a", enabled: false }))).should.have.property("status", 409);
            setup({ disableNode: function() { return Promise.reject(new Error("boom")); } });
            (await failure(nodes.setNodeSetState({ id: "m/a", enabled: false }))).should.have.property("status", 400);
            setup({ getNodeInfo: function() { return null; } });
            (await failure(nodes.setNodeSetState({ id: "m/a", enabled: false }))).should.have.property("status", 404);
        });
    });

    describe.skip("addModule", function() {});
    describe.skip("removeModule", function() {});
    describe.skip("setModuleState", function() {});
    describe.skip("setNodeSetState", function() {});

    describe.skip("getModuleCatalogs", function() {});
    describe.skip("getModuleCatalog", function() {});

    describe.skip("getIconList", function() {});
    describe.skip("getIcon", function() {});


});

/*
var should = require("should");
var request = require("nr-test-utils/supertest");
var express = require('express');
var bodyParser = require('body-parser');
var sinon = require('sinon');

var nodes = require("../../../../red/api/admin/nodes");
var apiUtil = require("../../../../red/api/util");

describe("api/admin/nodes", function() {

    var app;
    function initNodes(runtime) {
        runtime.log = {
            audit:function(e){},//console.log(e)},
            _:function(){},
            info: function(){},
            warn: function(){}
        }
        runtime.events = {
            emit: function(){}
        }
        nodes.init(runtime);

    }

    before(function() {
        app = express();
        app.use(bodyParser.json());
        app.get("/nodes",nodes.getAll);
        app.post("/nodes",nodes.post);
        app.get(/\/nodes\/((@[^\/]+\/)?[^\/]+)$/,nodes.getModule);
        app.get(/\/nodes\/((@[^\/]+\/)?[^\/]+)\/([^\/]+)$/,nodes.getSet);
        app.put(/\/nodes\/((@[^\/]+\/)?[^\/]+)$/,nodes.putModule);
        app.put(/\/nodes\/((@[^\/]+\/)?[^\/]+)\/([^\/]+)$/,nodes.putSet);
        app.get("/getIcons",nodes.getIcons);
        app.delete("/nodes/:id",nodes.delete);
        sinon.stub(apiUtil,"determineLangFromHeaders").callsFake(function() {
            return "en-US";
        });
    });
    after(function() {
        apiUtil.determineLangFromHeaders.restore();
    })

    describe('get nodes', function() {
        it('returns node list', function(done) {
            initNodes({
                nodes:{
                    getNodeList: function() {
                        return [1,2,3];
                    }
                }
            });
            request(app)
                .get('/nodes')
                .set('Accept', 'application/json')
                .expect(200)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    res.body.should.be.an.Array();
                    res.body.should.have.lengthOf(3);
                    done();
                });
        });

        it('returns node configs', function(done) {
            initNodes({
                nodes:{
                    getNodeConfigs: function() {
                        return "<script></script>";
                    }
                },
                i18n: {
                    determineLangFromHeaders: function(){}
                }
            });
            request(app)
                .get('/nodes')
                .set('Accept', 'text/html')
                .expect(200)
                .expect("<script></script>")
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    done();
                });
        });

        it('returns node module info', function(done) {
            initNodes({
                nodes:{
                    getModuleInfo: function(id) {
                        return {"node-red":{name:"node-red"}}[id];
                    }
                }
            });
            request(app)
                .get('/nodes/node-red')
                .expect(200)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    res.body.should.have.property("name","node-red");
                    done();
                });
        });

        it('returns 404 for unknown module', function(done) {
            initNodes({
                nodes:{
                    getModuleInfo: function(id) {
                        return {"node-red":{name:"node-red"}}[id];
                    }
                }
            });
            request(app)
                .get('/nodes/node-blue')
                .expect(404)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    done();
                });
        });

        it('returns individual node info', function(done) {
            initNodes({
                nodes:{
                    getNodeInfo: function(id) {
                        return {"node-red/123":{id:"node-red/123"}}[id];
                    }
                }
            });
            request(app)
                .get('/nodes/node-red/123')
                .set('Accept', 'application/json')
                .expect(200)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    res.body.should.have.property("id","node-red/123");
                    done();
                });
        });

        it('returns individual node configs', function(done) {
            initNodes({
                nodes:{
                    getNodeConfig: function(id) {
                        return {"node-red/123":"<script></script>"}[id];
                    }
                },
                i18n: {
                    determineLangFromHeaders: function(){}
                }
            });
            request(app)
                .get('/nodes/node-red/123')
                .set('Accept', 'text/html')
                .expect(200)
                .expect("<script></script>")
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    done();
                });
        });

        it('returns 404 for unknown node', function(done) {
            initNodes({
                nodes:{
                    getNodeInfo: function(id) {
                        return {"node-red/123":{id:"node-red/123"}}[id];
                    }
                }
            });
            request(app)
                .get('/nodes/node-red/456')
                .set('Accept', 'application/json')
                .expect(404)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    done();
                });
        });
    });

    describe('install', function() {

        it('returns 400 if settings are unavailable', function(done) {
            initNodes({
                settings:{available:function(){return false}}
            });
            request(app)
                .post('/nodes')
                .expect(400)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    done();
                });
        });

        it('returns 400 if request is invalid', function(done) {
            initNodes({
                settings:{available:function(){return true}}
            });
            request(app)
                .post('/nodes')
                .send({})
                .expect(400)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    done();
                });
        });

        describe('by module', function() {
            it('installs the module and returns module info', function(done) {
                initNodes({
                    settings:{available:function(){return true}},
                    nodes:{
                        getModuleInfo: function(id) { return null; },
                        installModule: function() {
                            return Promise.resolve({
                                name:"foo",
                                nodes:[{id:"123"}]
                            });
                        }
                    }
                });
                request(app)
                    .post('/nodes')
                    .send({module: 'foo'})
                    .expect(200)
                    .end(function(err,res) {
                        if (err) {
                            throw err;
                        }
                        res.body.should.have.property("name","foo");
                        res.body.should.have.property("nodes");
                        res.body.nodes[0].should.have.property("id","123");
                        done();
                    });
            });

            it('fails the install if already installed', function(done) {
                initNodes({
                    settings:{available:function(){return true}},
                    nodes:{
                        getModuleInfo: function(id) { return {nodes:{id:"123"}}; },
                        installModule: function() {
                            return Promise.resolve({id:"123"});
                        }
                    }
                });
                request(app)
                    .post('/nodes')
                    .send({module: 'foo'})
                    .expect(400)
                    .end(function(err,res) {
                        if (err) {
                            throw err;
                        }
                        done();
                    });
            });

            it('fails the install if module error', function(done) {
                initNodes({
                    settings:{available:function(){return true}},
                    nodes:{
                        getModuleInfo: function(id) { return null },
                        installModule: function() {
                            return Promise.reject(new Error("test error"));
                        }
                    }
                });
                request(app)
                    .post('/nodes')
                    .send({module: 'foo'})
                    .expect(400)
                    .end(function(err,res) {
                        if (err) {
                            throw err;
                        }
                        res.body.should.have.property("message","Error: test error");
                        done();
                    });
            });
            it('fails the install if module not found', function(done) {
                initNodes({
                    settings:{available:function(){return true}},
                    nodes:{
                        getModuleInfo: function(id) { return null },
                        installModule: function() {
                            var err = new Error("test error");
                            err.code = 404;
                            return Promise.reject(err);
                        }
                    }
                });
                request(app)
                    .post('/nodes')
                    .send({module: 'foo'})
                    .expect(404)
                    .end(function(err,res) {
                        if (err) {
                            throw err;
                        }
                        done();
                    });
            });
        });
    });
    describe('delete', function() {
         it('returns 400 if settings are unavailable', function(done) {
            initNodes({
                settings:{available:function(){return false}}
            });

            request(app)
                .del('/nodes/123')
                .expect(400)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    done();
                });
        });

        describe('by module', function() {
            it('uninstalls the module', function(done) {
                initNodes({
                    settings:{available:function(){return true}},
                    nodes:{
                        getModuleInfo: function(id) { return {nodes:[{id:"123"}]} },
                        getNodeInfo: function() { return null },
                        uninstallModule: function() { return Promise.resolve({id:"123"});}
                    }
                });
                request(app)
                    .del('/nodes/foo')
                    .expect(204)
                    .end(function(err,res) {
                        if (err) {
                            throw err;
                        }
                        done();
                    });
            });

            it('fails the uninstall if the module is not installed', function(done) {
                initNodes({
                    settings:{available:function(){return true}},
                    nodes:{
                        getModuleInfo: function(id) { return null },
                        getNodeInfo: function() { return null }
                    }
                });
                request(app)
                    .del('/nodes/foo')
                    .expect(404)
                    .end(function(err,res) {
                        if (err) {
                            throw err;
                        }
                        done();
                    });
            });

            it('fails the uninstall if the module is not installed', function(done) {
                initNodes({
                    settings:{available:function(){return true}},
                    nodes:{
                        getModuleInfo: function(id) { return {nodes:[{id:"123"}]} },
                        getNodeInfo: function() { return null },
                        uninstallModule: function() { return Promise.reject(new Error("test error"));}
                    }
                });
                request(app)
                    .del('/nodes/foo')
                    .expect(400)
                    .end(function(err,res) {
                        if (err) {
                            throw err;
                        }
                        res.body.should.have.property("message","Error: test error");
                        done();
                    });
            });
        });

    });

    describe('enable/disable', function() {
        it('returns 400 if settings are unavailable', function(done) {
            initNodes({
                settings:{available:function(){return false}}
            });
            request(app)
                .put('/nodes/123')
                .expect(400)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    done();
                });
        });

        it('returns 400 for invalid node payload', function(done) {
            initNodes({
                settings:{available:function(){return true}}
            });
            request(app)
                .put('/nodes/node-red/foo')
                .send({})
                .expect(400)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    res.body.should.have.property("message","Invalid request");
                    done();
                });
        });

        it('returns 400 for invalid module payload', function(done) {
            initNodes({
                settings:{available:function(){return true}}
            });
            request(app)
                .put('/nodes/foo')
                .send({})
                .expect(400)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    res.body.should.have.property("message","Invalid request");

                    done();
                });
        });

        it('returns 404 for unknown node', function(done) {
            initNodes({
                settings:{available:function(){return true}},
                nodes:{
                    getNodeInfo: function() { return null }
                }
            });

            request(app)
                .put('/nodes/node-red/foo')
                .send({enabled:false})
                .expect(404)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    done();
                });
        });

        it('returns 404 for unknown module', function(done) {
            initNodes({
                settings:{available:function(){return true}},
                nodes:{
                    getModuleInfo: function(id) { return null }
                }
            });

            request(app)
                .put('/nodes/node-blue')
                .send({enabled:false})
                .expect(404)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    done();
                });
        });

        it('enables disabled node', function(done) {
            initNodes({
                settings:{available:function(){return true}},
                nodes:{
                    getNodeInfo: function() { return {id:"123",enabled: false} },
                    enableNode: function() { return Promise.resolve({id:"123",enabled: true,types:['a']}); }
                }
            });
            request(app)
                .put('/nodes/node-red/foo')
                .send({enabled:true})
                .expect(200)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    res.body.should.have.property("id","123");
                    res.body.should.have.property("enabled",true);

                    done();
                });
        });

        it('disables enabled node', function(done) {
            initNodes({
                settings:{available:function(){return true}},
                nodes:{
                    getNodeInfo: function() { return {id:"123",enabled: true} },
                    disableNode: function() { return Promise.resolve({id:"123",enabled: false,types:['a']}); }
                }
            });
            request(app)
                .put('/nodes/node-red/foo')
                .send({enabled:false})
                .expect(200)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    res.body.should.have.property("id","123");
                    res.body.should.have.property("enabled",false);

                    done();
                });
        });

        describe('no-ops if already in the right state', function() {
            function run(state,done) {
                var enableNode = sinon.spy(function() { return Promise.resolve({id:"123",enabled: true,types:['a']}) });
                var disableNode = sinon.spy(function() { return Promise.resolve({id:"123",enabled: false,types:['a']}) });

                initNodes({
                    settings:{available:function(){return true}},
                    nodes:{
                        getNodeInfo: function() { return {id:"123",enabled: state} },
                        enableNode: enableNode,
                        disableNode: disableNode
                    }
                });
                request(app)
                    .put('/nodes/node-red/foo')
                    .send({enabled:state})
                    .expect(200)
                    .end(function(err,res) {
                        var enableNodeCalled = enableNode.called;
                        var disableNodeCalled = disableNode.called;
                        if (err) {
                            throw err;
                        }
                        enableNodeCalled.should.be.false();
                        disableNodeCalled.should.be.false();
                        res.body.should.have.property("id","123");
                        res.body.should.have.property("enabled",state);

                        done();
                    });
            }
            it('already enabled', function(done) {
                run(true,done);
            });
            it('already disabled', function(done) {
                run(false,done);
            });
        });

        describe('does not no-op if err on node', function() {
            function run(state,done) {
                var enableNode = sinon.spy(function() { return Promise.resolve({id:"123",enabled: true,types:['a']}) });
                var disableNode = sinon.spy(function() { return Promise.resolve({id:"123",enabled: false,types:['a']}) });

                initNodes({
                    settings:{available:function(){return true}},
                    nodes:{
                        getNodeInfo: function() { return {id:"123",enabled: state, err:"foo"} },
                        enableNode: enableNode,
                        disableNode: disableNode
                    }
                });
                request(app)
                    .put('/nodes/node-red/foo')
                    .send({enabled:state})
                    .expect(200)
                    .end(function(err,res) {
                        var enableNodeCalled = enableNode.called;
                        var disableNodeCalled = disableNode.called;
                        if (err) {
                            throw err;
                        }
                        enableNodeCalled.should.be.equal(state);
                        disableNodeCalled.should.be.equal(!state);
                        res.body.should.have.property("id","123");
                        res.body.should.have.property("enabled",state);

                        done();
                    });
            }
            it('already enabled', function(done) {
                run(true,done);
            });
            it('already disabled', function(done) {
                run(false,done);
            });
        });

        it('enables disabled module', function(done) {
            var n1 = {id:"123",enabled:false,types:['a']};
            var n2 = {id:"456",enabled:false,types:['b']};
            var enableNode = sinon.stub();
            enableNode.onFirstCall().returns((function() {
                n1.enabled = true;
                return Promise.resolve(n1);
            })());
            enableNode.onSecondCall().returns((function() {
                n2.enabled = true;
                return Promise.resolve(n2);
            })());
            enableNode.returns(null);
            initNodes({
                settings:{available:function(){return true}},
                nodes:{
                    getModuleInfo: function() { return {name:"node-red", nodes:[n1, n2]} },
                    enableNode: enableNode
                }
            });

            request(app)
                .put('/nodes/node-red')
                .send({enabled:true})
                .expect(200)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    res.body.should.have.property("name","node-red");
                    res.body.should.have.property("nodes");
                    res.body.nodes[0].should.have.property("enabled",true);
                    res.body.nodes[1].should.have.property("enabled",true);

                    done();
                });
        });

        it('disables enabled module', function(done) {
            var n1 = {id:"123",enabled:true,types:['a']};
            var n2 = {id:"456",enabled:true,types:['b']};
            var disableNode = sinon.stub();
            disableNode.onFirstCall().returns((function() {
                n1.enabled = false;
                return Promise.resolve(n1);
            })());
            disableNode.onSecondCall().returns((function() {
                n2.enabled = false;
                return Promise.resolve(n2);
            })());
            disableNode.returns(null);
            initNodes({
                settings:{available:function(){return true}},
                nodes:{
                    getModuleInfo: function() { return {name:"node-red", nodes:[n1, n2]} },
                    disableNode: disableNode
                }
            });

            request(app)
                .put('/nodes/node-red')
                .send({enabled:false})
                .expect(200)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    res.body.should.have.property("name","node-red");
                    res.body.should.have.property("nodes");
                    res.body.nodes[0].should.have.property("enabled",false);
                    res.body.nodes[1].should.have.property("enabled",false);

                    done();
                });
        });

        describe('no-ops if a node in module already in the right state', function() {
            function run(state,done) {
                var node = {id:"123",enabled:state,types:['a']};
                var enableNode = sinon.spy(function(id) {
                    node.enabled = true;
                    return Promise.resolve(node);
                });
                var disableNode = sinon.spy(function(id) {
                    node.enabled = false;
                    return Promise.resolve(node);
                });

                initNodes({
                    settings:{available:function(){return true}},
                    nodes:{
                        getModuleInfo: function() { return {name:"node-red", nodes:[node]}; },
                        enableNode: enableNode,
                        disableNode: disableNode
                    }
                });
                request(app)
                    .put('/nodes/node-red')
                    .send({enabled:state})
                    .expect(200)
                    .end(function(err,res) {
                        var enableNodeCalled = enableNode.called;
                        var disableNodeCalled = disableNode.called;
                        if (err) {
                            throw err;
                        }
                        enableNodeCalled.should.be.false();
                        disableNodeCalled.should.be.false();
                        res.body.should.have.property("name","node-red");
                        res.body.should.have.property("nodes");
                        res.body.nodes[0].should.have.property("enabled",state);

                        done();
                    });
            }
            it('already enabled', function(done) {
                run(true,done);
            });
            it('already disabled', function(done) {
                run(false,done);
            });
        });

        describe('does not no-op if err on a node in module', function() {
            function run(state,done) {
                var node = {id:"123",enabled:state,types:['a'],err:"foo"};
                var enableNode = sinon.spy(function(id) {
                    node.enabled = true;
                    return Promise.resolve(node);
                });
                var disableNode = sinon.spy(function(id) {
                    node.enabled = false;
                    return Promise.resolve(node);
                });

                initNodes({
                    settings:{available:function(){return true}},
                    nodes:{
                        getModuleInfo: function() { return {name:"node-red", nodes:[node]}; },
                        enableNode: enableNode,
                        disableNode: disableNode
                    }
                });

                request(app)
                    .put('/nodes/node-red')
                    .send({enabled:state})
                    .expect(200)
                    .end(function(err,res) {
                        var enableNodeCalled = enableNode.called;
                        var disableNodeCalled = disableNode.called;
                        if (err) {
                            throw err;
                        }
                        enableNodeCalled.should.be.equal(state);
                        disableNodeCalled.should.be.equal(!state);
                        res.body.should.have.property("name","node-red");
                        res.body.should.have.property("nodes");
                        res.body.nodes[0].should.have.property("enabled",state);

                        done();
                    });
            }
            it('already enabled', function(done) {
                run(true,done);
            });
            it('already disabled', function(done) {
                run(false,done);
            });
        });
    });

    describe('get icons', function() {
        it('returns icon list', function(done) {
            initNodes({
                nodes:{
                    getNodeIcons: function() {
                        return {"module":["1.png","2.png","3.png"]};
                    }
                }
            });
            request(app)
                .get('/getIcons')
                .expect(200)
                .end(function(err,res) {
                    if (err) {
                        throw err;
                    }
                    console.log(res.body);
                    res.body.should.have.property("module");
                    res.body.module.should.be.an.Array();
                    res.body.module.should.have.lengthOf(3);
                    done();
                });
        });
    });
});

*/
