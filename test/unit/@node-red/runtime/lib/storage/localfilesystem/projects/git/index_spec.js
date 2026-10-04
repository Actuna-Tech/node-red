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
 *   #45: tests of hiding the credentials of a git URL in errors and in the log
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var sinon = require("sinon");

var NR_TEST_UTILS = require("nr-test-utils");
var gitTools = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/projects/git");
var util = NR_TEST_UTILS.require("@node-red/util");

describe("storage/localfilesystem/projects/git/index", function() {
    describe("credentials of a remote URL (#45)", function() {
        var logged;
        var logHandler = { emit: function(type, msg) { logged.push(msg); } };

        beforeEach(function() {
            logged = [];
            util.log.addHandler(logHandler);
        });
        afterEach(function() {
            util.log.removeHandler(logHandler);
            sinon.restore();
        });

        function failWith(stderr, stdout) {
            return sinon.stub(util.exec, "run").callsFake(function() {
                return Promise.reject({ code: 128, stdout: stdout || "", stderr: stderr });
            });
        }
        function everything(err) {
            return JSON.stringify([err.message, err.stderr, err.stdout, err.stack, err.value, logged]);
        }

        var URL_WITH_PASSWORD = "https://user:s3cret@host.example/org/repo.git";
        var CLONE_FAILURE = "Cloning into '.'...\nfatal: unable to access 'https://user:s3cret@host.example/org/repo.git/': " +
                            "The requested URL returned error: 403\n";

        it("clone: the error has no password in message, stderr, stdout, stack or log", async function() {
            var run = failWith(CLONE_FAILURE, "out https://user:s3cret@host.example/org/repo.git");
            var err = await gitTools.clone({url: URL_WITH_PASSWORD}, null, "/tmp/p").then(
                () => { throw new Error("should have failed"); }, e => e);
            everything(err).should.not.containEql("s3cret");
            err.message.should.containEql("https://***@host.example/org/repo.git/");
            // classification of the error is not affected
            err.code.should.equal("git_auth_failed");
            // git itself still gets the real URL
            run.firstCall.args[1].should.containEql(URL_WITH_PASSWORD);
        });

        it("clone: a bare token is hidden too", async function() {
            failWith("fatal: unable to access 'https://ghp_tok3n@github.com/org/repo.git/': error");
            var err = await gitTools.clone({url: "https://ghp_tok3n@github.com/org/repo.git"}, null, "/tmp/p").then(
                () => { throw new Error("should have failed"); }, e => e);
            everything(err).should.not.containEql("ghp_tok3n");
            err.message.should.containEql("https://***@github.com/org/repo.git/");
        });

        it("fetch: the error has no password, more than one URL in a message are all hidden", async function() {
            failWith("fatal: unable to access 'https://user:s3cret@host.example/a.git/': x\n" +
                     "fatal: could not read from 'http://other:p4ss@other.example/b.git'\n");
            var err = await gitTools.fetch("/tmp/p", "origin").then(
                () => { throw new Error("should have failed"); }, e => e);
            everything(err).should.not.containEql("s3cret");
            everything(err).should.not.containEql("p4ss");
            err.message.should.containEql("https://***@host.example/a.git/");
            err.message.should.containEql("http://***@other.example/b.git");
        });

        it("pull and push: the error has no password", async function() {
            failWith("fatal: unable to access 'https://user:s3cret@host.example/org/repo.git/': error");
            var err = await gitTools.pull("/tmp/p", "origin", "main").then(
                () => { throw new Error("should have failed"); }, e => e);
            everything(err).should.not.containEql("s3cret");
            err = await gitTools.push("/tmp/p", "origin", "main").then(
                () => { throw new Error("should have failed"); }, e => e);
            everything(err).should.not.containEql("s3cret");
        });

        it("the trace log of the command has no password, git still gets the URL", async function() {
            var run = sinon.stub(util.exec, "run").resolves({ stdout: "", stderr: "" });
            await gitTools.clone({url: URL_WITH_PASSWORD}, null, "/tmp/p");
            JSON.stringify(logged).should.not.containEql("s3cret");
            JSON.stringify(logged).should.containEql("https://***@host.example/org/repo.git");
            run.firstCall.args[1].should.containEql(URL_WITH_PASSWORD);
        });

        it("an invalid URL: the error value has no password", async function() {
            var err = await Promise.resolve().then(() => gitTools.clone({url: "ftp://user:s3cret@host.example/r.git"}, null, "/tmp/p")).then(
                () => { throw new Error("should have failed"); }, e => e);
            err.code.should.equal("git_invalid_argument");
            everything(err).should.not.containEql("s3cret");
        });

        it("a URL without credentials is not changed", async function() {
            failWith("fatal: unable to access 'https://host.example/org/repo.git/': Could not resolve host: host.example\n");
            var err = await gitTools.fetch("/tmp/p", "origin").then(
                () => { throw new Error("should have failed"); }, e => e);
            err.message.should.equal("fatal: unable to access 'https://host.example/org/repo.git/': Could not resolve host: host.example\n");
        });

        it("an ssh and an scp-like URL are not changed", async function() {
            var stderr = "fatal: Could not read from remote repository ssh://git@host.example/org/repo.git " +
                         "and git@github.com:org/repo.git\nPermission denied (publickey).\n";
            failWith(stderr);
            var err = await gitTools.fetch("/tmp/p", "origin").then(
                () => { throw new Error("should have failed"); }, e => e);
            err.message.should.equal(stderr);
            err.stderr.should.equal(stderr);
            err.code.should.equal("git_auth_failed");
        });

        it("a password of an ssh URL is hidden", async function() {
            failWith("fatal: Could not read from ssh://user:s3cret@host.example/org/repo.git\n");
            var err = await gitTools.fetch("/tmp/p", "origin").then(
                () => { throw new Error("should have failed"); }, e => e);
            everything(err).should.not.containEql("s3cret");
            err.message.should.containEql("ssh://***@host.example/org/repo.git");
        });
    });
});
