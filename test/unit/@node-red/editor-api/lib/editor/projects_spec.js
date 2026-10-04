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
 *   #45: tests of the error of a git command with the credentials of a URL in the API response and the audit log
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var sinon = require("sinon");
var request = require("nr-test-utils/supertest");
var express = require("express");
var NR_TEST_UTILS = require("nr-test-utils");

var projects = NR_TEST_UTILS.require("@node-red/editor-api/lib/editor/projects");
var gitTools = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/projects/git");
var util = NR_TEST_UTILS.require("@node-red/util");

describe("api/editor/projects", function() {
    describe("credentials of a remote URL in an error (#45)", function() {
        var app;
        var logged;
        var logHandler = { emit: function(type, msg) { logged.push(msg); } };
        var STDERR = "fatal: unable to access 'https://user:s3cret@host.example/org/repo.git/': " +
                     "The requested URL returned error: 403\n";

        before(function() {
            // the runtime API of the test calls the real git module of the runtime
            projects.init({}, {
                projects: {
                    available: function() { return Promise.resolve(true); },
                    pull: function(opts) { return gitTools.pull("/tmp/p", "origin", "main"); },
                    push: function(opts) { return gitTools.push("/tmp/p", "origin", "main"); }
                }
            });
            app = express();
            app.use("/projects", projects.app());
        });
        beforeEach(function() {
            logged = [];
            util.log.addHandler(logHandler);
            sinon.stub(util.exec, "run").callsFake(function() {
                return Promise.reject({ code: 128, stdout: "", stderr: STDERR });
            });
        });
        afterEach(function() {
            util.log.removeHandler(logHandler);
            sinon.restore();
        });

        ["pull", "push"].forEach(function(operation) {
            it("POST /projects/:id/" + operation + " --- the response and the log have no password", function(done) {
                request(app)
                    .post("/projects/p1/" + operation)
                    .expect(400)
                    .end(function(err, res) {
                        if (err) {
                            return done(err);
                        }
                        try {
                            res.body.code.should.equal("git_auth_failed");
                            res.body.message.should.containEql("https://***@host.example/org/repo.git/");
                            JSON.stringify(res.body).should.not.containEql("s3cret");
                            res.text.should.not.containEql("s3cret");
                            // the audit log of the API error and every other log line
                            logged.length.should.be.above(0);
                            JSON.stringify(logged).should.not.containEql("s3cret");
                            done();
                        } catch (e) {
                            done(e);
                        }
                    });
            });
        });
    });
});
