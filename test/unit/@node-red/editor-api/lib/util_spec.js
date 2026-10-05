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
 *   P-01: tests of rejectHandler passing rev and errors of a deployment error
 *   W-3: revAll of a deployment error of the single-flow api
 *   P-01: rev, revAll and errors are passed only for deploy_start_failed/deploy_stop_failed
 *   #22: the additive fields of a start_timeout and of a flow_start_failed entry reach the response
 *   #19: supertest bound to 127.0.0.1 (nr-test-utils/supertest), no crosstalk with other processes (flaky tests)
 *   Z-06 (#10): reason and details of deploy_rejected only; the codes of the preDeploy hook (400/503/503)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var sinon = require("sinon");
var request = require("nr-test-utils/supertest");
var express = require('express');

var NR_TEST_UTILS = require("nr-test-utils");

var apiUtil = NR_TEST_UTILS.require("@node-red/editor-api/lib/util");

var log = NR_TEST_UTILS.require("@node-red/util").log;
var i18n = NR_TEST_UTILS.require("@node-red/util").i18n;

describe("api/util", function() {
    describe("errorHandler", function() {
        var loggedError = null;
        var loggedEvent = null;
        var app;
        before(function() {
            app = express();
            sinon.stub(log,'error').callsFake(function(msg) {loggedError = msg;});
            sinon.stub(log,'audit').callsFake(function(event) {loggedEvent = event;});
            app.get("/tooLarge", function(req,res) {
                var err = new Error();
                err.message = "request entity too large";
                throw err;
            },apiUtil.errorHandler)
            app.get("/stack", function(req,res) {
                var err = new Error();
                err.message = "stacktrace";
                throw err;
            },apiUtil.errorHandler)
        });
        after(function() {
            log.error.restore();
            log.audit.restore();
        })
        beforeEach(function() {
            loggedError = null;
            loggedEvent = null;
        })
        it("logs an error for request entity too large", function(done) {
            request(app).get("/tooLarge").expect(400).end(function(err,res) {
                if (err) {
                    return done(err);
                }
                res.body.should.have.property("error","unexpected_error");
                res.body.should.have.property("message","Error: request entity too large");

                loggedError.should.have.property("message","request entity too large");

                loggedEvent.should.have.property("event","api.error");
                loggedEvent.should.have.property("error","unexpected_error");
                loggedEvent.should.have.property("message","Error: request entity too large");
                done();
            });
        })
        it("logs an error plus stack for other errors", function(done) {
            request(app).get("/stack").expect(400).end(function(err,res) {
                if (err) {
                    return done(err);
                }
                res.body.should.have.property("error","unexpected_error");
                res.body.should.have.property("message","Error: stacktrace");

                /Error: stacktrace\s*at.*util_spec.js/m.test(loggedError).should.be.true();

                loggedEvent.should.have.property("event","api.error");
                loggedEvent.should.have.property("error","unexpected_error");
                loggedEvent.should.have.property("message","Error: stacktrace");



                done();
            });
        });
    })

    describe('determineLangFromHeaders', function() {
        var oldDefaultLang;
        before(function() {
            oldDefaultLang = i18n.defaultLang;
            i18n.defaultLang = "en-US";
        })
        after(function() {
            i18n.defaultLang = oldDefaultLang;
        })
        it('returns the default lang if non provided', function() {
            apiUtil.determineLangFromHeaders(null).should.eql("en-US");
        })
        it('returns the first language accepted', function() {
            apiUtil.determineLangFromHeaders(['fr-FR','en-GB']).should.eql("fr-FR");
        })
    })

    describe("rejectHandler", function() {
        var app;
        before(function() {
            app = express();
            sinon.stub(log,'audit');
            sinon.stub(log,'error');
            app.get("/startFailed", function(req,res) {
                var err = new Error("Deployment saved, but the flows did not start");
                err.code = "deploy_start_failed";
                err.status = 500;
                err.rev = "abc";
                err.errors = [{code:"missing_types", message:"Missing node types", types:["missing"]}];
                apiUtil.rejectHandler(req,res,err);
            });
            app.get("/startTimeout", function(req,res) {
                var err = new Error("Deployment saved, but the flows did not start");
                err.code = "deploy_start_failed";
                err.status = 500;
                err.rev = "abc";
                err.errors = [
                    {code:"start_timeout", message:"The flows did not start within 30 ms", timeout:30, phase:"flows", startedAt:1759536000000, elapsed:31, pending:["t1","t2"], current:"t1"},
                    {code:"flow_start_failed", message:"boom", flow:"t2"}
                ];
                apiUtil.rejectHandler(req,res,err);
            });
            app.get("/flowStopFailed", function(req,res) {
                var err = new Error("stop failed");
                err.code = "deploy_stop_failed";
                err.status = 500;
                err.rev = null;
                err.revAll = "all";
                apiUtil.rejectHandler(req,res,err);
            });
            app.get("/otherWithFields", function(req,res) {
                var err = new Error("conflict");
                err.code = "version_mismatch";
                err.status = 409;
                err.rev = "internal";
                err.revAll = "internal-all";
                err.errors = [{code:"x"}];
                apiUtil.rejectHandler(req,res,err);
            });
            app.get("/rejected", function(req,res) {
                var err = new Error("forbidden node: x");
                err.code = "deploy_rejected";
                err.status = 400;
                err.reason = "forbidden_node";
                err.details = {nodes: ["n1"]};
                // the runtime builds this error from a whitelist, so no `remote` (copied by rejectHandler for every error)
                err.rev = "internal";
                err.revAll = "internal-all";
                err.errors = [{code: "x"}];
                apiUtil.rejectHandler(req,res,err);
            });
            app.get("/rejectedMinimal", function(req,res) {
                var err = new Error("Deployment rejected by validation");
                err.code = "deploy_rejected";
                err.status = 400;
                err.reason = "rejected";
                apiUtil.rejectHandler(req,res,err);
            });
            app.get("/hookFailed", function(req,res) {
                var err = new Error("Deployment validation is unavailable - nothing was saved");
                err.code = "deploy_hook_failed";
                err.status = 503;
                err.reason = "internal";
                err.details = {secret: 1};
                apiUtil.rejectHandler(req,res,err);
            });
            app.get("/hookTimeout", function(req,res) {
                var err = new Error("Deployment validation did not finish in time - nothing was saved");
                err.code = "deploy_hook_timeout";
                err.status = 503;
                err.reason = "internal";
                err.details = {secret: 1};
                apiUtil.rejectHandler(req,res,err);
            });
            app.get("/otherWithReason", function(req,res) {
                var err = new Error("conflict");
                err.code = "version_mismatch";
                err.status = 409;
                err.reason = "internal";
                err.details = {secret: 1};
                apiUtil.rejectHandler(req,res,err);
            });
            app.get("/plain", function(req,res) {
                var err = new Error("not found");
                err.code = "not_found";
                err.status = 404;
                apiUtil.rejectHandler(req,res,err);
            });
        });
        after(function() {
            log.audit.restore();
            log.error.restore();
        });
        it("rejectHandler includes rev and errors when present", async function() {
            const res = await request(app).get("/startFailed").expect(500);
            res.body.should.eql({
                code: "deploy_start_failed",
                message: "Deployment saved, but the flows did not start",
                rev: "abc",
                errors: [{code:"missing_types", message:"Missing node types", types:["missing"]}]
            });
        });
        it("rejectHandler passes the additive fields of the error entries on (#22)", async function() {
            const res = await request(app).get("/startTimeout").expect(500);
            res.body.rev.should.equal("abc");
            res.body.errors.should.eql([
                {code:"start_timeout", message:"The flows did not start within 30 ms", timeout:30, phase:"flows", startedAt:1759536000000, elapsed:31, pending:["t1","t2"], current:"t1"},
                {code:"flow_start_failed", message:"boom", flow:"t2"}
            ]);
        });
        it("rejectHandler includes revAll and a null rev of the single-flow api (W-3)", async function() {
            const res = await request(app).get("/flowStopFailed").expect(500);
            res.body.should.eql({code:"deploy_stop_failed", message:"stop failed", rev:null, revAll:"all"});
        });
        it("rejectHandler passes rev, revAll and errors only for deploy_start_failed/deploy_stop_failed", async function() {
            const res = await request(app).get("/otherWithFields").expect(409);
            res.body.should.eql({code:"version_mismatch", message:"conflict"});
        });
        it("rejectHandler passes reason and details of deploy_rejected - and no other field (Z-06)", async function() {
            const res = await request(app).get("/rejected").expect(400);
            res.body.should.eql({code:"deploy_rejected", message:"forbidden node: x", reason:"forbidden_node", details:{nodes:["n1"]}});
        });
        it("rejectHandler: deploy_rejected without details has only code, message and reason (Z-06)", async function() {
            const res = await request(app).get("/rejectedMinimal").expect(400);
            res.body.should.eql({code:"deploy_rejected", message:"Deployment rejected by validation", reason:"rejected"});
        });
        it("rejectHandler: deploy_hook_failed and deploy_hook_timeout are 503 with code and message only (Z-06)", async function() {
            let res = await request(app).get("/hookFailed").expect(503);
            res.body.should.eql({code:"deploy_hook_failed", message:"Deployment validation is unavailable - nothing was saved"});
            res = await request(app).get("/hookTimeout").expect(503);
            res.body.should.eql({code:"deploy_hook_timeout", message:"Deployment validation did not finish in time - nothing was saved"});
        });
        it("rejectHandler does not pass reason and details of another code (Z-06)", async function() {
            const res = await request(app).get("/otherWithReason").expect(409);
            res.body.should.eql({code:"version_mismatch", message:"conflict"});
        });
        it("rejectHandler response unchanged without rev and errors", async function() {
            const res = await request(app).get("/plain").expect(404);
            res.body.should.eql({code:"not_found", message:"not found"});
        });
    });
});
