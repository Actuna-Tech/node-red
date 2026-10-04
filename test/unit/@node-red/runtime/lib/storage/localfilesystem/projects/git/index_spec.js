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
 *   an ambiguous user info and of hiding the known user infos literally (per project, only what
 *   the pattern does not hide; SEC-006..010)
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
        // what an API client can get from the error: the response has message and code
        // (not the server log nor err.value, which have the user's own text unchanged)
        function inError(err) {
            return JSON.stringify([err.message, err.stderr, err.stdout, err.stack]);
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
            // the value of the argument is not in the message at all (SEC-006)
            err.message.should.not.containEql("https://");
            err.message.should.containEql("index");
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
            var PROJECT_A = "/tmp/nr-secrets-a";
            var PROJECT_B = "/tmp/nr-secrets-b";

            function remotesOutput(url) {
                return "origin\t" + url + " (fetch)\norigin\t" + url + " (push)\n";
            }
            // loads the remotes of a project: its secrets are remembered
            function loadRemotes(cwd, output) {
                sinon.restore();
                sinon.stub(util.exec, "run").resolves({ stdout: output, stderr: "" });
                return gitTools.getRemotes(cwd).then(function(remotes) {
                    sinon.restore();
                    return remotes;
                });
            }
            function fetchFailing(cwd, stderr, stdout) {
                sinon.restore();
                sinon.stub(util.exec, "run").callsFake(function() {
                    return Promise.reject({ code: 128, stdout: stdout || "", stderr: stderr });
                });
                return gitTools.fetch(cwd, "origin").then(
                    () => { throw new Error("should have failed"); }, e => e);
            }

            it("the remotes of the project are hidden in the error, in the trace log and in maskCredentials", async function() {
                var remotes = await loadRemotes(PROJECT_A, CONFIG_OUTPUT);
                // the real URLs are returned: git and the credentials cache need them
                remotes.origin.fetch.should.equal("https://user:pa/ss@host.example/org/repo.git");
                // the pattern misses these, the literal secrets do not
                var err = await fetchFailing(PROJECT_A,
                    "fatal: unable to access 'https://user:pa/ss@host.example/org/repo.git/': error\n" +
                    "fatal: could not read from https://user:pa ss@other.example/b.git\n");
                everything(err).should.not.containEql("pa/ss");
                everything(err).should.not.containEql("pa ss");
                err.message.should.containEql("https://***@host.example/org/repo.git/");
                gitTools.maskCredentials(remotes.origin.fetch, PROJECT_A).should.equal("https://***@host.example/org/repo.git");
                gitTools.maskCredentials(remotes.other.push, PROJECT_A).should.equal("https://***@other.example/b.git");
                gitTools.maskCredentials("plain text without secrets", PROJECT_A).should.equal("plain text without secrets");
            });

            it("a bare ssh user does not register a secret", async function() {
                await loadRemotes(PROJECT_A, remotesOutput("ssh://deploy-user@host.example/org/repo.git"));
                gitTools.maskCredentials("deploy-user@host.example", PROJECT_A).should.equal("deploy-user@host.example");
            });

            describe("a password is not an oracle (SEC-006)", function() {
                it("a normal password (hidden by the pattern) is never remembered", async function() {
                    await loadRemotes(PROJECT_A, remotesOutput("https://alice:Summer2024@git.example/a.git"));
                    // a text of the user in the same project is not changed
                    gitTools.maskCredentials("my Summer2024 text", PROJECT_A).should.equal("my Summer2024 text");
                    gitTools.maskCredentials("my Summer2024 text", PROJECT_B).should.equal("my Summer2024 text");
                });

                it("a commit in project B with the password of project A does not return *** nor the password", async function() {
                    await loadRemotes(PROJECT_A, remotesOutput("https://alice:Summer2024@git.example/a.git"));
                    var err = await Promise.resolve().then(() => gitTools.commit(PROJECT_B, "-password Winter2023 Summer2024 letmein1")).then(
                        () => { throw new Error("should have failed"); }, e => e);
                    err.code.should.equal("git_invalid_argument");
                    inError(err).should.not.containEql("Summer2024");
                    err.message.should.not.containEql("***");
                    err.message.should.not.containEql("Winter2023");
                });

                it("the same with an old ambiguous password of project A (not hidden by the pattern)", async function() {
                    await loadRemotes(PROJECT_A, remotesOutput("https://alice:Summer 2024@git.example/a.git"));
                    // the secret is only used for project A
                    var err = await Promise.resolve().then(() => gitTools.commit(PROJECT_B, "-Summer 2024")).then(
                        () => { throw new Error("should have failed"); }, e => e);
                    inError(err).should.not.containEql("Summer 2024");
                    err.message.should.not.containEql("***");
                    // the output of git in project B is not masked with the secrets of project A
                    var errB = await fetchFailing(PROJECT_B, "fatal: Summer 2024\n");
                    errB.message.should.equal("fatal: Summer 2024\n");
                    var errA = await fetchFailing(PROJECT_A, "fatal: Summer 2024\n");
                    errA.message.should.equal("fatal: ***\n");
                });

                it("a rejected argument is not in the message: only its index", async function() {
                    var err = await Promise.resolve().then(() => gitTools.commit(PROJECT_B, "-whatever")).then(
                        () => { throw new Error("should have failed"); }, e => e);
                    err.message.should.equal("Invalid argument passed to git: argv element at index 4 looks like an option but is not on the allow-list");
                });
            });

            describe("the secrets do not grow without end (SEC-007)", function() {
                it("a failing remote add does not remember the URL", async function() {
                    sinon.stub(util.exec, "run").callsFake(function() {
                        return Promise.reject({ code: 128, stdout: "", stderr: "fatal: remote origin already exists.\n" });
                    });
                    var err = await gitTools.addRemote(PROJECT_A, "origin", {url: "https://alice:Autumn2024@git.example/a.git"}).then(
                        () => { throw new Error("should have failed"); }, e => e);
                    err.code.should.equal("git_remote_already_exists");
                    gitTools.maskCredentials("Autumn2024", PROJECT_A).should.equal("Autumn2024");
                });

                it("getRemotes replaces the secrets of the project: a removed remote is forgotten", async function() {
                    await loadRemotes(PROJECT_A, remotesOutput("https://alice:Summer 2024@git.example/a.git"));
                    gitTools.maskCredentials("x Summer 2024 x", PROJECT_A).should.equal("x *** x");
                    await loadRemotes(PROJECT_A, remotesOutput("https://git.example/a.git"));
                    gitTools.maskCredentials("x Summer 2024 x", PROJECT_A).should.equal("x Summer 2024 x");
                    // no remotes at all
                    await loadRemotes(PROJECT_A, remotesOutput("https://alice:Summer 2024@git.example/a.git"));
                    await loadRemotes(PROJECT_A, "");
                    gitTools.maskCredentials("x Summer 2024 x", PROJECT_A).should.equal("x Summer 2024 x");
                });

                it("removeRemote and forgetSecrets clear the secrets of the project", async function() {
                    await loadRemotes(PROJECT_A, remotesOutput("https://alice:Summer 2024@git.example/a.git"));
                    sinon.stub(util.exec, "run").resolves({ stdout: "", stderr: "" });
                    await gitTools.removeRemote(PROJECT_A, "origin");
                    sinon.restore();
                    gitTools.maskCredentials("x Summer 2024 x", PROJECT_A).should.equal("x Summer 2024 x");
                    await loadRemotes(PROJECT_A, remotesOutput("https://alice:Summer 2024@git.example/a.git"));
                    gitTools.forgetSecrets(PROJECT_A);
                    gitTools.maskCredentials("x Summer 2024 x", PROJECT_A).should.equal("x Summer 2024 x");
                });

                it("a project keeps a limited number of secrets", async function() {
                    var lines = "";
                    for (var i = 0; i < 60; i++) {
                        var url = "https://alice:pass word" + (1000 + i) + "@git.example/r" + i + ".git";
                        lines += "r" + i + "\t" + url + " (fetch)\n";
                    }
                    await loadRemotes(PROJECT_A, lines);
                    var masked = 0;
                    for (var j = 0; j < 60; j++) {
                        if (gitTools.maskCredentials("pass word" + (1000 + j), PROJECT_A) === "***") {
                            masked++;
                        }
                    }
                    masked.should.be.above(0);
                    masked.should.be.belowOrEqual(16);
                });

                it("the number of projects with secrets is limited", async function() {
                    for (var i = 0; i < 300; i++) {
                        await loadRemotes("/tmp/nr-secrets-many-" + i, remotesOutput("https://alice:Summer " + (2000 + i) + "@git.example/a.git"));
                    }
                    // the oldest are dropped, the newest are kept
                    gitTools.maskCredentials("Summer 2000", "/tmp/nr-secrets-many-0").should.equal("Summer 2000");
                    gitTools.maskCredentials("Summer 2299", "/tmp/nr-secrets-many-299").should.equal("***");
                    for (var k = 0; k < 300; k++) {
                        gitTools.forgetSecrets("/tmp/nr-secrets-many-" + k);
                    }
                });
            });

            describe("the code of the error is decided on the raw output (SEC-008)", function() {
                it("a secret that is a word of the message of git does not change git_auth_failed", async function() {
                    await loadRemotes(PROJECT_A, remotesOutput("https://user:Authentication failed@host.example/r.git"));
                    gitTools.maskCredentials("remote: Authentication failed", PROJECT_A).should.equal("remote: ***");
                    var err = await fetchFailing(PROJECT_A, "remote: Authentication failed for 'https://host.example/r.git/'\n");
                    err.code.should.equal("git_auth_failed");
                    // only the text of the error is masked
                    err.message.should.containEql("remote: *** for");
                });

                it("a secret that is a word of the message of git does not change git_pull_merge_conflict", async function() {
                    await loadRemotes(PROJECT_A, remotesOutput("https://user:CONFLICT (content)@host.example/r.git"));
                    sinon.stub(util.exec, "run").callsFake(function() {
                        return Promise.reject({ code: 1, stdout: "CONFLICT (content): Merge conflict in flow.json\n", stderr: "" });
                    });
                    var err = await gitTools.pull(PROJECT_A, "origin", "main").then(
                        () => { throw new Error("should have failed"); }, e => e);
                    err.code.should.equal("git_pull_merge_conflict");
                    err.stdout.should.not.containEql("CONFLICT (content)");
                });

                it("a secret that is the text of 'nothing to commit' does not change the result", async function() {
                    await loadRemotes(PROJECT_A, remotesOutput("https://user:nothing to commit@host.example/r.git"));
                    sinon.stub(util.exec, "run").callsFake(function() {
                        return Promise.reject({ code: 1, stdout: "On branch main\nnothing to commit, working tree clean\n", stderr: "" });
                    });
                    var result = await gitTools.commit(PROJECT_A, "message");
                    result.should.containEql("nothing to commit");
                });
            });

            describe("the user info of a URL (SEC-010)", function() {
                it("an @ in the path of a URL without a user info gives no false secret", async function() {
                    await loadRemotes(PROJECT_A, remotesOutput("https://git.example/org@team/repo.git"));
                    gitTools.maskCredentials("git.example/org", PROJECT_A).should.equal("git.example/org");
                    await loadRemotes(PROJECT_A, remotesOutput("https://git.example:8443/org@team/repo.git"));
                    gitTools.maskCredentials("git.example:8443/org", PROJECT_A).should.equal("git.example:8443/org");
                });

                it("a space in the user info is still hidden, an @ in the path after it does not extend it", async function() {
                    await loadRemotes(PROJECT_A, remotesOutput("https://user:pa ss@git.example/org@team/repo.git"));
                    gitTools.maskCredentials("pa ss", PROJECT_A).should.equal("***");
                    gitTools.maskCredentials("git.example/org", PROJECT_A).should.equal("git.example/org");
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
