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
 *   #63: tests of PUT /projects/:id (status and body): a request that fails a check, a failed save or remote change,
 *   valid requests; the real project API, the real storage of the projects and a real project
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var sinon = require("sinon");
var request = require("nr-test-utils/supertest");
var express = require("express");
var bodyParser = require("body-parser");
var fs = require("fs-extra");
var path = require("path");
var harnessModule = require("nr-test-utils/projects-harness");
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

describe("api/editor/projects - PUT /projects/:id (#63)", function() {
    this.timeout(10000);
    const writeUtil = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/util");
    const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");
    let h;
    let app;
    let warn;
    let errorLog;
    let unhandled;
    let onUnhandled;

    beforeEach(function() {
        warn = sinon.stub(util.log, "warn");
        errorLog = sinon.stub(util.log, "error");
        sinon.stub(console, "log");
        unhandled = [];
        onUnhandled = reason => unhandled.push(reason);
        process.on("unhandledRejection", onUnhandled);
    });
    afterEach(async function() {
        process.removeListener("unhandledRejection", onUnhandled);
        if (h) {
            await h.cleanup();
            h = null;
        }
        sinon.restore();
    });

    async function start(options) {
        h = await harnessModule.createHarness(options);
        projects.init({}, { projects: h.projectApi });
        app = express();
        app.use(bodyParser.json());
        app.use("/projects", projects.app());
    }
    function put(body) {
        return request(app).put("/projects/p1").type("json").send(typeof body === "string" ? body : JSON.stringify(body));
    }
    function failWrite(base) {
        const original = writeUtil.writeFile;
        return sinon.stub(writeUtil, "writeFile").callsFake(function(file) {
            if (path.basename(String(file)) === base) {
                const err = new Error("ENOSPC: no space left on device, write '" + file + "'");
                err.code = "ENOSPC";
                return Promise.reject(err);
            }
            return original.apply(this, arguments);
        });
    }
    function warned() {
        return warn.args.map(args => args.map(String).join(" "));
    }
    async function assertOldProject() {
        const res = await request(app).get("/projects/p1");
        res.status.should.equal(200);
        res.body.description.should.equal(harnessModule.OLD.description);
        res.body.summary.should.equal(harnessModule.OLD.summary);
        res.body.version.should.equal(harnessModule.OLD.version);
        res.body.dependencies.should.eql(harnessModule.OLD.dependencies);
    }
    function assertConstant400(res) {
        res.status.should.equal(400);
        res.body.should.eql({ code: "unexpected_error", message: "Saving the project failed" });
        res.text.should.not.containEql(h.projectDir);
        res.text.should.not.containEql(h.userDir);
    }

    describe("B7-AC-1..4, B7-AC-9: a request that fails a check", function() {
        harnessModule.invalidRequests.forEach(function(entry) {
            it(entry.ac + ": " + entry.name + " -> 400 invalid_request naming the field, nothing changed, the old project is returned", async function() {
                await start();
                const before = h.snapshot();
                const res = await put(entry.body());
                res.status.should.equal(400, res.text);
                res.body.should.have.property("code", "invalid_request");
                res.body.message.should.containEql(entry.field);
                entry.hidden.forEach(function(text) { res.text.should.not.containEql(text); });
                res.text.should.not.containEql(h.projectDir);
                errorLog.called.should.be.false("log.error was called");
                h.snapshot().should.eql(before);
                await assertOldProject();
            });
        });

        it("B7-AC-9: a project without package.json: 400 with the message as before, the key is not changed, nothing is logged as an error", async function() {
            await start({ withoutPackage: true });
            const before = h.snapshot();
            const res = await put({ credentialSecret: "new", currentCredentialSecret: "old" });
            res.status.should.equal(400);
            res.body.should.eql({ code: "unexpected_error", message: "Cannot update project with missing package.json" });
            errorLog.called.should.be.false("log.error was called");
            h.snapshot().should.eql(before);
        });

        it("B7-AC-9: a wrong current key together with other fields: 400 missing_current_credential_key, the README is unchanged", async function() {
            await start();
            const before = h.snapshot();
            const res = await put({ description: "d", credentialSecret: "new", currentCredentialSecret: "WRONG" });
            res.status.should.equal(400);
            res.body.should.have.property("code", "missing_current_credential_key");
            h.snapshot().should.eql(before);
        });
    });

    describe("B7-AC-2: dependencies with a key __proto__", function() {
        it("200, and both keys are in package.json as own keys", async function() {
            await start();
            const res = await put('{"dependencies":{"__proto__":"1.0.0","a":"~1.0"}}');
            res.status.should.equal(200, res.text);
            const dependencies = JSON.parse(fs.readFileSync(path.join(h.projectDir, "package.json"), "utf8")).dependencies;
            Object.prototype.hasOwnProperty.call(dependencies, "__proto__").should.be.true();
            dependencies.a.should.equal("~1.0");
        });
    });

    describe("B7-AC-5, B7-AC-7: a failed write", function() {
        it("the README cannot be written: 400 unexpected_error with a constant message and no path, the old project is returned", async function() {
            await start();
            failWrite("README.md");
            const res = await put({ description: "new" });
            assertConstant400(res);
            warned().some(t => t.indexOf("Saving the project file README.md failed") !== -1).should.be.true(JSON.stringify(warned()));
            await assertOldProject();
        });

        it("package.json cannot be written: the same", async function() {
            await start();
            failWrite("package.json");
            const res = await put({ summary: "s" });
            assertConstant400(res);
            await assertOldProject();
        });

        it("package.json cannot be read: the same", async function() {
            await start();
            h.failNextRead("package.json");
            const res = await put({ summary: "s" });
            assertConstant400(res);
            await assertOldProject();
        });

        it("auto workflow: no stage and no commit", async function() {
            await start({ mode: "auto" });
            const prototype = Object.getPrototypeOf(h.active());
            const stage = sinon.stub(prototype, "stageFile").resolves();
            const commit = sinon.stub(prototype, "commit").resolves();
            failWrite("README.md");
            const res = await put({ description: "new" });
            assertConstant400(res);
            stage.called.should.be.false();
            commit.called.should.be.false();
        });

        it("B7-AC-7: the README fails, package.json is written: 400, and the project shows what is on disk (the new summary, the old description)", async function() {
            await start();
            failWrite("README.md");
            const res = await put({ description: "d", summary: "s" });
            assertConstant400(res);
            const project = await request(app).get("/projects/p1");
            project.body.summary.should.equal("s");
            project.body.description.should.equal(harnessModule.OLD.description);
        });
    });

    describe("B7-AC-6: a failed save of the settings", function() {
        it("400 unexpected_error, the key and the credentials are as before, the retry of the same request works", async function() {
            await start();
            h.settings.failSaves(1);
            const res = await put({ credentialSecret: "new", currentCredentialSecret: "old" });
            assertConstant400(res);
            h.runtime.storage.saveCredentials.called.should.be.false();
            h.settings.store.projects.projects.p1.credentialSecret.should.equal("old");
            const again = await put({ credentialSecret: "new", currentCredentialSecret: "old" });
            again.status.should.equal(200, again.text);
            h.settings.store.projects.projects.p1.credentialSecret.should.equal("new");
            h.runtime.storage.saveCredentials.calledOnce.should.be.true();
        });
    });

    describe("B7-AC-11: a failed change of a remote", function() {
        it("a remote that cannot be added: 400 with a constant message, no URL and no name, the remotes are as in the git configuration", async function() {
            await start({ remotes: { origin: "https://host.example/a.git" } });
            sinon.stub(h.gitTools, "addRemote").callsFake(function() {
                const err = new Error("fatal: https://user:s3cret@h.example/r.git is not valid");
                err.code = "git_invalid_argument";
                return Promise.reject(err);
            });
            const res = await put({ git: { remotes: { o2: { url: "https://user:s3cret@h.example/r.git" } } } });
            assertConstant400(res);
            res.text.should.not.containEql("o2");
            res.text.should.not.containEql("s3cret");
            JSON.stringify(warned()).should.not.containEql("s3cret");
            const remotes = await request(app).get("/projects/p1/remotes");
            remotes.status.should.equal(200);
            remotes.body.remotes.map(r => r.name).should.eql(["origin"]);
        });

        it("a remote that cannot be removed: the same, and the failure is not left unhandled", async function() {
            await start({ remotes: { origin: "https://host.example/a.git" } });
            sinon.stub(h.gitTools, "removeRemote").callsFake(function() {
                const err = new Error("fatal: cannot remove the remote");
                err.code = "git_error";
                return Promise.reject(err);
            });
            const res = await put({ git: { remotes: { origin: { removed: true } } } });
            assertConstant400(res);
            res.text.should.not.containEql("origin");
            await new Promise(resolve => setTimeout(resolve, 20));
            unhandled.map(String).should.eql([], "an unhandled rejection");
            const remotes = await request(app).get("/projects/p1/remotes");
            remotes.body.remotes.map(r => r.name).should.eql(["origin"]);
        });
    });

    describe("B7-AC-8: valid requests answer 200 with the project", function() {
        it("a description: the project in the answer has it, and README.md has it", async function() {
            await start();
            const res = await put({ description: "new text" });
            res.status.should.equal(200, res.text);
            res.body.description.should.equal("new text");
            fs.readFileSync(path.join(h.projectDir, "README.md"), "utf8").should.equal("new text");
        });

        it("summary, version and dependencies", async function() {
            await start();
            const res = await put({ summary: "s", version: "1.2.3", dependencies: { a: "~1.0" } });
            res.status.should.equal(200, res.text);
            res.body.should.have.property("summary", "s");
            res.body.should.have.property("version", "1.2.3");
            res.body.dependencies.should.eql({ a: "~1.0" });
        });

        it("a new key with the current key: 200, the credentials are re-encrypted and saved", async function() {
            await start();
            const res = await put({ credentialSecret: "new", currentCredentialSecret: "old" });
            res.status.should.equal(200, res.text);
            h.runtime.storage.saveCredentials.calledOnce.should.be.true();
            res.text.should.not.containEql('"credentialSecret"');
        });

        it("the names of the files that are as they are, a key that is false and unknown fields: 200 and nothing changes", async function() {
            await start();
            const before = h.snapshot();
            const res = await put({ credentialSecret: false, files: { package: "package.json", flow: "flows.json", credentials: "flows_cred.json" }, unknown: { a: 1 } });
            res.status.should.equal(200, res.text);
            h.snapshot().should.eql(before);
        });

        it("a request without a field to update answers 400 invalid_request as before", async function() {
            await start();
            const res = await put({ nothing: true });
            res.status.should.equal(400);
            res.body.should.eql({ error: "unexpected_error", message: "invalid_request" });
        });
    });
});
