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
 *   Z-04: contract tests of the single-flow api v2 (rev, ETag, If-Match, 201)
 *   Z-05: contract tests of DELETE /flow/:id?rev=
 *   R-46: an invalid Node-RED-API-Version on /flow is treated as v1 with a warning
 *   W-3: contract of the deploy errors of the single-flow api (rev, revAll, errors)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var request = require('supertest');
var express = require('express');
var bodyParser = require('body-parser');
var sinon = require('sinon');

var NR_TEST_UTILS = require("nr-test-utils");

var flow = NR_TEST_UTILS.require("@node-red/editor-api/lib/admin/flow");

describe("api/admin/flow", function() {

    var app;

    before(function() {
        app = express();
        app.use(bodyParser.json());
        app.get("/flow/:id",flow.get);
        app.post("/flow",flow.post);
        app.put("/flow/:id",flow.put);
        app.delete("/flow/:id",flow.delete);
    });

    describe("get", function() {
        before(function() {
            var opts;
            flow.init({
                flows: {
                    getFlow: function(_opts) {
                        opts = _opts;
                        if (opts.id === '123') {
                            return Promise.resolve({id:'123'});
                        } else {
                            var err = new Error("message");
                            err.code = "not_found";
                            err.status = 404;
                            var p = Promise.reject(err);
                            p.catch(()=>{});
                            return p;
                        }
                    }
                }
            });
        })
        it('gets a known flow', function(done) {
            request(app)
                .get('/flow/123')
                .set('Accept', 'application/json')
                .expect(200)
                .end(function(err,res) {
                    if (err) {
                        return done(err);
                    }
                    res.body.should.has.a.property('id','123');
                    done();
                });
        })
        it('404s an unknown flow', function(done) {
            request(app)
                .get('/flow/456')
                .set('Accept', 'application/json')
                .expect(404)
                .end(done);
        })
    });

    describe("add", function() {
        var opts;
        before(function() {
            flow.init({
                flows: {
                    addFlow: function(_opts) {
                        opts = _opts;
                        if (opts.flow.id === "123") {
                            return Promise.resolve('123')
                        } else {
                            var err = new Error("random error");
                            err.code = "random_error";
                            err.status = 400;
                            var p = Promise.reject(err);
                            p.catch(()=>{});
                            return p;
                        }
                    }
                }
            });
        })
        it('adds a new flow', function(done) {
            request(app)
                .post('/flow')
                .set('Accept', 'application/json')
                .send({id:'123'})
                .expect(200)
                .end(function(err,res) {
                    if (err) {
                        return done(err);
                    }
                    res.body.should.has.a.property('id','123');
                    done();
                });
        })
        it('400 an invalid flow', function(done) {
            request(app)
                .post('/flow')
                .set('Accept', 'application/json')
                .send({id:'error'})
                .expect(400)
                .end(function(err,res) {
                    if (err) {
                        return done(err);
                    }
                    res.body.should.has.a.property('code','random_error');
                    res.body.should.has.a.property('message','random error');

                    done();
                });
        })
    })

    describe("update", function() {

        var opts;
        before(function() {
            flow.init({
                flows: {
                    updateFlow: function(_opts) {
                        opts = _opts;
                        if (opts.id === "123") {
                            return Promise.resolve('123')
                        } else {
                            var err = new Error("random error");
                            err.code = "random_error";
                            err.status = 400;
                            var p = Promise.reject(err);
                            p.catch(()=>{});
                            return p;
                        }
                    }
                }
            });
        })

        it('updates an existing flow', function(done) {
            request(app)
                .put('/flow/123')
                .set('Accept', 'application/json')
                .send({id:'123'})
                .expect(200)
                .end(function(err,res) {
                    if (err) {
                        return done(err);
                    }
                    res.body.should.has.a.property('id','123');
                    opts.should.have.property('id','123');
                    opts.should.have.property('flow',{id:'123'})
                    done();
                });
        })

        it('400 an invalid flow', function(done) {
            request(app)
                .put('/flow/456')
                .set('Accept', 'application/json')
                .send({id:'456'})
                .expect(400)
                .end(function(err,res) {
                    if (err) {
                        return done(err);
                    }
                    res.body.should.has.a.property('code','random_error');
                    res.body.should.has.a.property('message','random error');

                    done();
                });
        })
    })

    describe("delete", function() {

        var opts;
        before(function() {
            flow.init({
                flows: {
                    deleteFlow: function(_opts) {
                        opts = _opts;
                        if (opts.id === "123") {
                            return Promise.resolve()
                        } else {
                            var err = new Error("random error");
                            err.code = "random_error";
                            err.status = 400;
                            var p = Promise.reject(err);
                            p.catch(()=>{});
                            return p;
                        }
                    }
                }
            });
        })

        it('deletes an existing flow', function(done) {
            request(app)
                .del('/flow/123')
                .set('Accept', 'application/json')
                .expect(204)
                .end(function(err,res) {
                    if (err) {
                        return done(err);
                    }
                    opts.should.have.property('id','123');
                    done();
                });
        })

        it('400 an invalid flow', function(done) {
            request(app)
                .del('/flow/456')
                .set('Accept', 'application/json')
                .expect(400)
                .end(function(err,res) {
                    if (err) {
                        return done(err);
                    }
                    res.body.should.has.a.property('code','random_error');
                    res.body.should.has.a.property('message','random error');

                    done();
                });
        })
    })

    describe("single-flow api v1/v2 (Z-04)", function() {
        let calls;
        let created;
        before(function() {
            flow.init({
                flows: {
                    getFlow: function(opts) {
                        calls.push(opts);
                        const result = {id: opts.id, label: "Flow"};
                        if (opts.apiVersion === "v2") {
                            result.rev = "rev-" + opts.id;
                        }
                        return Promise.resolve(result);
                    },
                    addFlow: function(opts) {
                        calls.push(opts);
                        return Promise.resolve(opts.apiVersion === "v2" ? {id:"0123456789abcdef", rev:"rev-new"} : "0123456789abcdef");
                    },
                    updateFlow: function(opts) {
                        calls.push(opts);
                        if (opts.flow.rev === "stale") {
                            const err = new Error();
                            err.code = "version_mismatch";
                            err.status = 409;
                            return Promise.reject(err);
                        }
                        if (opts.apiVersion === "v2") {
                            return Promise.resolve({id: opts.id, rev: "rev-updated", revAll: "rev-all", created: created});
                        }
                        return Promise.resolve(opts.id);
                    }
                }
            });
        });
        beforeEach(function() {
            calls = [];
            created = false;
        });
        it("legacy GET/POST/PUT unchanged", async function() {
            let res = await request(app).get("/flow/t1").expect(200);
            res.body.should.eql({id:"t1", label:"Flow"});
            should(res.headers.etag === '"rev-t1"').be.false();
            res = await request(app).post("/flow").send({nodes:[]}).expect(200);
            res.body.should.eql({id:"0123456789abcdef"});
            res = await request(app).put("/flow/t1").send({nodes:[]}).expect(200);
            res.body.should.eql({id:"t1"});
            calls.forEach(c => c.should.have.property("apiVersion","v1"));
        });
        it("GET v2 returns rev and ETag header", async function() {
            const res = await request(app).get("/flow/t1").set("Node-RED-API-Version","v2").expect(200);
            res.body.should.have.property("rev","rev-t1");
            res.headers.should.have.property("etag",'"rev-t1"');
        });
        it("GET v1 has no rev and no ETag of the flow revision", async function() {
            const res = await request(app).get("/flow/t1").expect(200);
            res.body.should.not.have.property("rev");
            should(res.headers.etag === '"rev-t1"').be.false();
        });
        it("POST /flow v2 returns 201 with 16-hex id", async function() {
            const res = await request(app).post("/flow").set("Node-RED-API-Version","v2").send({nodes:[]}).expect(201);
            res.body.should.have.property("id");
            res.body.id.should.match(/^[0-9a-f]{16}$/);
            res.body.should.have.property("rev","rev-new");
        });
        it("POST /flow v1 returns 200", async function() {
            const res = await request(app).post("/flow").send({nodes:[]}).expect(200);
            res.body.id.should.match(/^[0-9a-f]{16}$/);
        });
        it("PUT create returns 201 in v2 and 200 in v1", async function() {
            created = true;
            let res = await request(app).put("/flow/new1").set("Node-RED-API-Version","v2").send({nodes:[], rev:null}).expect(201);
            res.body.should.eql({id:"new1", rev:"rev-updated", revAll:"rev-all"});
            res = await request(app).put("/flow/new2").send({nodes:[]}).expect(200);
            res.body.should.eql({id:"new2"});
        });
        it("PUT v2 returns 200 with the revisions for an existing flow", async function() {
            const res = await request(app).put("/flow/t1").set("Node-RED-API-Version","v2").send({nodes:[], rev:"rev-t1"}).expect(200);
            res.body.should.eql({id:"t1", rev:"rev-updated", revAll:"rev-all"});
        });
        it("PUT v2 If-Match acts as rev", async function() {
            await request(app).put("/flow/t1").set("Node-RED-API-Version","v2").set("If-Match",'"rev-t1"').send({nodes:[]}).expect(200);
            calls[0].flow.should.eql({nodes:[], rev:"rev-t1"});
            const res = await request(app).put("/flow/t1").set("Node-RED-API-Version","v2").set("If-Match",'W/"stale"').send({nodes:[]}).expect(409);
            res.body.should.have.property("code","version_mismatch");
        });
        it("PUT v2 with If-Match and the same rev is accepted", async function() {
            await request(app).put("/flow/t1").set("Node-RED-API-Version","v2").set("If-Match",'"rev-t1"').send({nodes:[], rev:"rev-t1"}).expect(200);
        });
        it("PUT v2 conflicting If-Match and rev returns 400 invalid_revision", async function() {
            const res = await request(app).put("/flow/t1").set("Node-RED-API-Version","v2").set("If-Match",'"rev-t1"').send({nodes:[], rev:"other"}).expect(400);
            res.body.should.have.property("code","invalid_revision");
            calls.should.have.length(0);
        });
        it("If-Match ignored in v1", async function() {
            await request(app).put("/flow/t1").set("If-Match",'"stale"').send({nodes:[]}).expect(200);
            calls[0].flow.should.eql({nodes:[]});
        });
        it("PUT with stale rev returns 409", async function() {
            const res = await request(app).put("/flow/t1").send({nodes:[], rev:"stale"}).expect(409);
            res.body.should.have.property("code","version_mismatch");
        });
        describe("invalid API version (R-46)", function() {
            const log = NR_TEST_UTILS.require("@node-red/util").log;
            let warn;
            let translate;
            beforeEach(function() {
                warn = sinon.stub(log, "warn");
                translate = sinon.stub(log, "_").callsFake((key, opts) => key + " " + JSON.stringify(opts));
            });
            afterEach(function() {
                warn.restore();
                translate.restore();
            });
            it("is treated as v1 - responses as in 5.0.7", async function() {
                let res = await request(app).get("/flow/t1").set("Node-RED-API-Version","v3").expect(200);
                res.body.should.eql({id:"t1", label:"Flow"});
                res = await request(app).post("/flow").set("Node-RED-API-Version","v3").send({nodes:[]}).expect(200);
                res.body.should.eql({id:"0123456789abcdef"});
                res = await request(app).put("/flow/t1").set("Node-RED-API-Version","v3").set("If-Match",'"stale"').send({nodes:[]}).expect(200);
                res.body.should.eql({id:"t1"});
                calls.should.have.length(3);
                calls.forEach(c => c.should.have.property("apiVersion","v1"));
                // If-Match is ignored as in v1
                calls[2].flow.should.not.have.property("rev");
            });
            it("logs a warning once per value", async function() {
                const value = "v9-" + Date.now();
                await request(app).get("/flow/t1").set("Node-RED-API-Version",value).expect(200);
                await request(app).get("/flow/t1").set("Node-RED-API-Version",value).expect(200);
                await request(app).put("/flow/t1").set("Node-RED-API-Version",value).send({nodes:[]}).expect(200);
                warn.calledOnce.should.be.true();
                warn.firstCall.args[0].should.containEql("api.flow.invalid-api-version");
                warn.firstCall.args[0].should.containEql(value);
                await request(app).get("/flow/t1").set("Node-RED-API-Version",value+"-other").expect(200);
                warn.calledTwice.should.be.true();
            });
            it("limits the number of warned values", async function() {
                for (let i = 0; i < 120; i++) {
                    await request(app).get("/flow/t1").set("Node-RED-API-Version","limit-" + i + "-" + Date.now()).expect(200);
                }
                warn.callCount.should.be.belowOrEqual(101);
                warn.callCount.should.be.above(0);
            });
            it("does not warn for v1, v2 or a missing header", async function() {
                await request(app).get("/flow/t1").expect(200);
                await request(app).get("/flow/t1").set("Node-RED-API-Version","v1").expect(200);
                await request(app).get("/flow/t1").set("Node-RED-API-Version","v2").expect(200);
                warn.called.should.be.false();
            });
        });
    });

    describe("deploy errors of the single-flow api (W-3)", function() {
        before(function() {
            flow.init({
                flows: {
                    updateFlow: function(opts) {
                        const err = new Error("Deployment saved, but the flows did not start");
                        err.code = "deploy_start_failed";
                        err.status = 500;
                        err.rev = "rev-flow";
                        err.revAll = "rev-all";
                        err.errors = [{code:"start_timeout", message:"timeout"}];
                        return Promise.reject(err);
                    },
                    deleteFlow: function(opts) {
                        const err = new Error("stop failed");
                        err.code = "deploy_stop_failed";
                        err.status = 500;
                        err.rev = null;
                        err.revAll = "rev-all";
                        return Promise.reject(err);
                    }
                }
            });
        });
        it("PUT returns 500 with rev of the flow, revAll and errors", async function() {
            for (const version of ["v1", "v2"]) {
                const res = await request(app).put("/flow/t1").set("Node-RED-API-Version",version).send({nodes:[]}).expect(500);
                res.body.should.eql({
                    code: "deploy_start_failed",
                    message: "Deployment saved, but the flows did not start",
                    rev: "rev-flow",
                    revAll: "rev-all",
                    errors: [{code:"start_timeout", message:"timeout"}]
                });
            }
        });
        it("DELETE returns 500 with rev null and revAll", async function() {
            const res = await request(app).delete("/flow/t1").expect(500);
            res.body.should.eql({code:"deploy_stop_failed", message:"stop failed", rev:null, revAll:"rev-all"});
        });
    });

    describe("DELETE /flow/:id?rev= (Z-05)", function() {
        let calls;
        before(function() {
            flow.init({
                flows: {
                    deleteFlow: function(opts) {
                        calls.push(opts);
                        if (opts.rev === undefined) {
                            const err = new Error("A revision (rev) is required to deploy");
                            err.code = "version_required";
                            err.status = 409;
                            return Promise.reject(err);
                        }
                        return Promise.resolve();
                    }
                }
            });
        });
        beforeEach(function() {
            calls = [];
        });
        it("passes ?rev= to the runtime", async function() {
            await request(app).del('/flow/t1?rev=abc').expect(204);
            calls[0].should.have.property("rev","abc");
        });
        it("error body has code and message", async function() {
            const res = await request(app).del('/flow/t1').expect(409);
            res.body.should.eql({code:"version_required", message:"A revision (rev) is required to deploy"});
            calls[0].should.not.have.property("rev");
        });
    });
});
