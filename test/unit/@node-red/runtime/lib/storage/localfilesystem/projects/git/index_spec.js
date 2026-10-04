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
 *   #45: tests of hiding the credentials of a git URL in errors and in the log, of rejecting
 *   an ambiguous user info and of hiding the known user infos literally
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

        it("SSH:// in capital letters is handled like ssh://: a bare user is not changed, a password is hidden", async function() {
            var stderr = "fatal: Could not read from remote repository SSH://git@host.example/org/repo.git\n";
            failWith(stderr);
            var err = await gitTools.fetch("/tmp/p", "origin").then(
                () => { throw new Error("should have failed"); }, e => e);
            err.message.should.equal(stderr);
            sinon.restore();
            failWith("fatal: Could not read from SSH://user:s3cret@host.example/org/repo.git\n");
            err = await gitTools.fetch("/tmp/p", "origin").then(
                () => { throw new Error("should have failed"); }, e => e);
            everything(err).should.not.containEql("s3cret");
            err.message.should.containEql("SSH://***@host.example/org/repo.git");
        });

        it("the text of an invalid argument has no password (a commit message that looks like an option)", async function() {
            var run = sinon.stub(util.exec, "run").resolves({ stdout: "", stderr: "" });
            var err = await Promise.resolve().then(() => gitTools.commit("/tmp/p", "-https://user:s3cret@host.example/r.git")).then(
                () => { throw new Error("should have failed"); }, e => e);
            err.code.should.equal("git_invalid_argument");
            everything(err).should.not.containEql("s3cret");
            err.message.should.containEql("-https://***@host.example/r.git");
            run.called.should.be.false();
        });

        describe("ambiguous user info of a URL (SEC-002)", function() {
            var AMBIGUOUS = [
                ["an unescaped / in the password", "https://user:pa/ss@host.example/org/repo.git"],
                ["a space in the password", "https://user:pa ss@host.example/org/repo.git"],
                ["a tab in the password", "https://user:pa\tss@host.example/org/repo.git"],
                ["a newline in the URL", "https://user:s3cret@host.example/org/repo.git\n"],
                ["a numeric port-like password with /", "https://user:12/ss@host.example/org/repo.git"],
                ["an unescaped ? in the password", "https://user:pa?ss@host.example/org/repo.git"],
                ["an unescaped # in the password", "https://user:pa#ss@host.example/org/repo.git"],
                ["ssh with / in the password", "ssh://user:pa/ss@host.example/org/repo.git"],
                ["an @ in the path", "https://host.example/org@x/repo.git"]
            ];
            AMBIGUOUS.forEach(function(c) {
                it("clone rejects " + c[0], async function() {
                    var run = sinon.stub(util.exec, "run").resolves({ stdout: "", stderr: "" });
                    var err = await Promise.resolve().then(() => gitTools.clone({url: c[1]}, null, "/tmp/p")).then(
                        () => { throw new Error("should have failed"); }, e => e);
                    err.code.should.equal("git_invalid_argument");
                    everything(err).should.not.containEql("s3cret");
                    everything(err).should.not.containEql("pa/ss");
                    everything(err).should.not.containEql("pa ss");
                    run.called.should.be.false();
                });
                it("addRemote rejects " + c[0], async function() {
                    var run = sinon.stub(util.exec, "run").resolves({ stdout: "", stderr: "" });
                    var err = await Promise.resolve().then(() => gitTools.addRemote("/tmp/p", "origin", {url: c[1]})).then(
                        () => { throw new Error("should have failed"); }, e => e);
                    err.code.should.equal("git_invalid_argument");
                    everything(err).should.not.containEql("pa/ss");
                    everything(err).should.not.containEql("pa ss");
                    run.called.should.be.false();
                });
            });

            [
                "https://user:pa%2Fss@host.example/org/repo.git",
                "https://user:pa%20ss@host.example/org/repo.git",
                "https://user:p@ss@host.example/org/repo.git",
                "https://ghp_tok3n@github.com/org/repo.git",
                "https://host.example:8443/org/repo.git",
                "https://user:s3cret@[::1]:8443/org/repo.git",
                "http://host.example/org/repo.git",
                "ssh://git@host.example:2222/org/repo.git",
                "SSH://git@host.example/org/repo.git",
                "git://host.example/org/repo.git",
                "file:///tmp/my repo",
                "git@github.com:org/repo.git"
            ].forEach(function(url) {
                it("clone and addRemote accept " + JSON.stringify(url), async function() {
                    var run = sinon.stub(util.exec, "run").resolves({ stdout: "", stderr: "" });
                    await gitTools.clone({url: url}, null, "/tmp/p");
                    await gitTools.addRemote("/tmp/p", "origin", {url: url});
                    run.callCount.should.equal(2);
                    run.firstCall.args[1].should.containEql(url);
                });
            });
        });

        describe("known user infos are hidden literally (SEC-002 b)", function() {
            // a URL that is already in .git/config, as git accepts it (an unescaped "/" and a space)
            var CONFIG_OUTPUT = "origin\thttps://user:pa/ss@host.example/org/repo.git (fetch)\n" +
                                "origin\thttps://user:pa/ss@host.example/org/repo.git (push)\n" +
                                "other\thttps://user:pa ss@other.example/b.git (fetch)\n" +
                                "other\thttps://user:pa ss@other.example/b.git (push)\n";

            it("the remotes of the project are hidden in the error, in the trace log and in maskCredentials", async function() {
                var run = sinon.stub(util.exec, "run");
                run.onFirstCall().resolves({ stdout: CONFIG_OUTPUT, stderr: "" });
                var remotes = await gitTools.getRemotes("/tmp/p");
                // the real URLs are returned: git and the credentials cache need them
                remotes.origin.fetch.should.equal("https://user:pa/ss@host.example/org/repo.git");
                // the pattern misses these, the literal secrets do not
                run.onSecondCall().callsFake(function() {
                    return Promise.reject({ code: 128, stdout: "", stderr:
                        "fatal: unable to access 'https://user:pa/ss@host.example/org/repo.git/': error\n" +
                        "fatal: could not read from https://user:pa ss@other.example/b.git\n" });
                });
                var err = await gitTools.fetch("/tmp/p", "origin").then(
                    () => { throw new Error("should have failed"); }, e => e);
                everything(err).should.not.containEql("pa/ss");
                everything(err).should.not.containEql("pa ss");
                err.message.should.containEql("https://***@host.example/org/repo.git/");
                gitTools.maskCredentials(remotes.origin.fetch).should.equal("https://***@host.example/org/repo.git");
                gitTools.maskCredentials(remotes.other.push).should.equal("https://***@other.example/b.git");
                gitTools.maskCredentials("plain text without secrets").should.equal("plain text without secrets");
            });

            it("a URL with an @ in a path or a bare ssh user does not register a secret for the user", function() {
                return Promise.resolve().then(async function() {
                    sinon.stub(util.exec, "run").resolves({ stdout:
                        "origin\tssh://deploy-user@host.example/org/repo.git (fetch)\n", stderr: "" });
                    await gitTools.getRemotes("/tmp/p");
                    gitTools.maskCredentials("deploy-user@host.example").should.equal("deploy-user@host.example");
                });
            });
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
