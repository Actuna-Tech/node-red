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
 *   #63: tests of the update of a project (the update branch of PUT /projects/:id): the checks run before anything
 *   changes, a failed save or remote change fails the update and the project is restored, valid requests as before
 *   #45: tests of hiding the credentials of remote URLs in the project returned to the API;
 *   toJSON() of a project gives export() (no credentialSecret); the literal secrets of a project
 *   are forgotten when the project is deleted (SEC-007)
 *   #63: getRemotes() of a project with an old ambiguous remote URL does not show the password
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var fs = require("fs-extra");
var os = require("os");
var path = require("path");
var child_process = require("child_process");

var NR_TEST_UTILS = require("nr-test-utils");
var Project = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/projects/Project");

describe("storage/localfilesystem/projects/Project", function() {
    describe("credentials of remote URLs (#45)", function() {
        var tmpDir;
        var projectDir;
        var WITH_PASSWORD = "https://user:s3cret@host.example/org/repo.git";
        var WITH_TOKEN = "https://ghp_tok3n@host.example/org/token.git";
        var PLAIN = "https://host.example/org/plain.git";
        var SCP_LIKE = "git@github.com:org/scp.git";

        function git() {
            child_process.execFileSync("git", Array.prototype.slice.call(arguments), {cwd: projectDir, stdio: "pipe"});
        }

        before(function() {
            Project.init({
                userDir: os.tmpdir(),
                editorTheme: {projects: {}},
                get: function() { return undefined; },
                set: function() { return Promise.resolve(); }
            }, {});
        });
        beforeEach(async function() {
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nr-project-spec-"));
            projectDir = path.join(tmpDir, "proj");
            await fs.mkdirp(projectDir);
            git("init");
            git("remote", "add", "origin", WITH_PASSWORD);
            git("remote", "add", "token", WITH_TOKEN);
            git("remote", "add", "plain", PLAIN);
            git("remote", "add", "scp", SCP_LIKE);
        });
        afterEach(async function() {
            await fs.remove(tmpDir);
        });

        it("export() has no credentials in the remotes, the project keeps the real URLs", async function() {
            var project = await Project.load(projectDir);
            var remotes = project.export().git.remotes;
            JSON.stringify(remotes).should.not.containEql("s3cret");
            JSON.stringify(remotes).should.not.containEql("ghp_tok3n");
            remotes.origin.should.eql({fetch: "https://***@host.example/org/repo.git", push: "https://***@host.example/org/repo.git"});
            remotes.token.fetch.should.equal("https://***@host.example/org/token.git");
            // git and the credentials cache (keyed by the fetch URL) need the real URL
            project.remotes.origin.fetch.should.equal(WITH_PASSWORD);
            project.remotes.origin.push.should.equal(WITH_PASSWORD);
        });

        it("export() does not change a URL without credentials or an scp-like URL", async function() {
            var project = await Project.load(projectDir);
            var remotes = project.export().git.remotes;
            remotes.plain.should.eql({fetch: PLAIN, push: PLAIN});
            remotes.scp.should.eql({fetch: SCP_LIKE, push: SCP_LIKE});
        });

        it("getRemotes() has no credentials", async function() {
            var project = await Project.load(projectDir);
            var result = await project.getRemotes();
            JSON.stringify(result).should.not.containEql("s3cret");
            JSON.stringify(result).should.not.containEql("ghp_tok3n");
            var byName = {};
            result.remotes.forEach(r => { byName[r.name] = r; });
            byName.origin.fetch.should.equal("https://***@host.example/org/repo.git");
            byName.plain.fetch.should.equal(PLAIN);
            byName.scp.fetch.should.equal(SCP_LIKE);
            // .git/config is not changed
            var config = await fs.readFile(path.join(projectDir, ".git", "config"), "utf8");
            config.should.containEql(WITH_PASSWORD);
        });

        it("a serialized Project is its export(): no credentialSecret, no password", async function() {
            Project.init({
                userDir: os.tmpdir(),
                editorTheme: {projects: {}},
                get: function(key) { return key === "projects" ? {projects: {proj: {credentialSecret: "CREDSECRET-0123"}}} : undefined; },
                set: function() { return Promise.resolve(); }
            }, {});
            var project = await Project.load(projectDir);
            project.credentialSecret.should.equal("CREDSECRET-0123");
            var text = JSON.stringify({project: project});
            text.should.not.containEql("CREDSECRET-0123");
            text.should.not.containEql("s3cret");
            JSON.parse(text).project.should.eql(JSON.parse(JSON.stringify(project.export())));
            // a copy for the API, the project itself is not changed
            project.credentialSecret.should.equal("CREDSECRET-0123");
            project.remotes.origin.fetch.should.equal(WITH_PASSWORD);
        });

        it("a project that is not loaded yet serializes to its name", function() {
            // the constructor is not exported: Project.prototype is reached through a loaded project
            return Project.load(projectDir).then(function(project) {
                var notLoaded = Object.create(Object.getPrototypeOf(project));
                notLoaded.name = "p";
                notLoaded.credentialSecret = "CREDSECRET-0123";
                JSON.parse(JSON.stringify(notLoaded)).should.eql({name: "p"});
            });
        });

        it("a project with an old ambiguous remote URL: hidden in export(), forgotten on delete (SEC-007)", async function() {
            var gitTools = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/projects/git");
            git("remote", "set-url", "origin", "https://user:pa ss@host.example/org/repo.git");
            git("remote", "set-url", "--push", "origin", "https://user:pa ss@host.example/org/repo.git");
            var projects = {projects: {proj: {}}};
            Project.init({
                userDir: os.tmpdir(),
                editorTheme: {projects: {}},
                get: function(key) { return key === "projects" ? projects : undefined; },
                set: function() { return Promise.resolve(); }
            }, {});
            var project = await Project.load(projectDir);
            JSON.stringify(project.export()).should.not.containEql("pa ss");
            // #63 B2-AC-2: GET /projects/:id/remotes goes through getRemotes()
            var listed = await project.getRemotes();
            JSON.stringify(listed).should.not.containEql("pa ss");
            listed.remotes.find(r => r.name === "origin").fetch.should.equal("https://***@host.example/org/repo.git");
            project.export().git.remotes.origin.fetch.should.equal("https://***@host.example/org/repo.git");
            gitTools.maskCredentials("pa ss", projectDir).should.equal("***");
            await Project.delete(null, projectDir);
            gitTools.maskCredentials("pa ss", projectDir).should.equal("pa ss");
        });

        it("export() of a project without remotes", async function() {
            git("remote", "remove", "origin");
            git("remote", "remove", "token");
            git("remote", "remove", "plain");
            git("remote", "remove", "scp");
            var project = await Project.load(projectDir);
            should.not.exist(project.export().git.remotes);
        });
    });
})

describe("storage/localfilesystem/projects/Project - update (#63)", function() {
    const harnessModule = require("nr-test-utils/projects-harness");
    const sinon = require("sinon");
    const util = NR_TEST_UTILS.require("@node-red/util");
    const log = util.log;
    const writeUtil = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/util");
    const SECRETS = ["s3cret", "secret-password-value"];

    let h;
    let warn;
    let errorLog;
    let unhandled;
    let onUnhandled;

    beforeEach(function() {
        warn = sinon.stub(log, "warn");
        errorLog = sinon.stub(log, "error");
        unhandled = [];
        onUnhandled = function(reason) { unhandled.push(reason); };
        process.on("unhandledRejection", onUnhandled);
    });
    afterEach(async function() {
        await new Promise(resolve => setImmediate(resolve));
        process.removeListener("unhandledRejection", onUnhandled);
        if (h) {
            await h.cleanup();
            h = null;
        }
        sinon.restore();
    });
    after(function() {
        // the module keeps the settings it was given: leave it with the neutral ones of the other tests of this file
        Project.init({
            userDir: os.tmpdir(),
            editorTheme: {projects: {}},
            get: function() { return undefined; },
            set: function() { return Promise.resolve(); }
        }, {});
    });

    // Spies on everything that a request that is refused must not reach
    function watch() {
        const prototype = Object.getPrototypeOf(h.active());
        return {
            run: sinon.spy(util.exec, "run"),
            addRemote: sinon.spy(h.gitTools, "addRemote"),
            removeRemote: sinon.spy(h.gitTools, "removeRemote"),
            authSet: sinon.spy(h.authCache, "set"),
            stage: sinon.stub(prototype, "stageFile").resolves(),
            commit: sinon.stub(prototype, "commit").resolves()
        };
    }
    function assertNotReached(spies) {
        spies.run.called.should.be.false("a git command was started");
        spies.addRemote.called.should.be.false();
        spies.removeRemote.called.should.be.false();
        spies.authSet.called.should.be.false("an entry of the credentials cache was set");
        spies.stage.called.should.be.false();
        spies.commit.called.should.be.false();
    }
    function update(body) {
        return h.active().update(null, body).then(() => null, err => err);
    }
    function assertConstantFailure(err) {
        should.exist(err, "the update did not fail");
        err.should.be.instanceof(Error);
        err.should.have.property("code", "unexpected_error");
        err.should.have.property("message", "Saving the project failed");
        JSON.stringify([err.message, err.code]).should.not.containEql(h.projectDir);
    }
    function warned() {
        return warn.args.map(args => args.map(String).join(" "));
    }
    // fails the write of the file, the writes of the other files go on
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
    function packageJson() {
        return JSON.parse(fs.readFileSync(path.join(h.projectDir, "package.json"), "utf8"));
    }

    describe("B7-AC-1..4, B7-AC-9: a request that fails a check changes nothing", function() {
        harnessModule.invalidRequests.forEach(function(entry) {
            it(entry.ac + ": " + entry.name + " -> invalid_request naming the field, nothing changed", async function() {
                h = await harnessModule.createHarness();
                const before = h.snapshot();
                const spies = watch();
                const err = await update(entry.body());
                should.exist(err, "the update did not fail");
                err.should.be.instanceof(Error, "the update was rejected with " + typeof err + ", not an Error");
                err.should.have.property("code", "invalid_request");
                err.message.should.containEql(entry.field);
                entry.hidden.forEach(function(text) { err.message.should.not.containEql(text); });
                h.snapshot().should.eql(before);
                assertNotReached(spies);
                errorLog.called.should.be.false("log.error was called");
            });
        });

        it("B7-AC-9: a project without package.json: the message and the status are as before, the key is not changed", async function() {
            h = await harnessModule.createHarness({ withoutPackage: true });
            const before = h.snapshot();
            const err = await update({ credentialSecret: "new", currentCredentialSecret: "old" });
            should.exist(err);
            err.should.be.instanceof(Error);
            err.should.have.property("message", "Cannot update project with missing package.json");
            err.should.have.property("code", "unexpected_error");
            h.snapshot().should.eql(before);
            h.active().credentialSecret.should.equal("old");
        });

        it("B7-AC-9: a wrong current key together with other fields: missing_current_credential_key, nothing changed", async function() {
            h = await harnessModule.createHarness();
            const before = h.snapshot();
            const spies = watch();
            const err = await update({ description: "d", credentialSecret: "new", currentCredentialSecret: "WRONG" });
            should.exist(err);
            err.should.have.property("code", "missing_current_credential_key");
            h.snapshot().should.eql(before);
            assertNotReached(spies);
        });
    });

    describe("B7-AC-2: a key __proto__ of the dependencies with a text value is an own key", function() {
        it("both keys are written to package.json as own keys", async function() {
            h = await harnessModule.createHarness();
            const body = JSON.parse('{"dependencies":{"__proto__":"1.0.0","a":"~1.0"}}');
            const err = await update(body);
            should.not.exist(err);
            const dependencies = packageJson().dependencies;
            Object.prototype.hasOwnProperty.call(dependencies, "__proto__").should.be.true();
            Object.prototype.hasOwnProperty.call(dependencies, "a").should.be.true();
            dependencies.a.should.equal("~1.0");
            should.not.exist(({}).a);
        });
    });

    describe("B7-AC-5: a failed write of a file fails the update", function() {
        it("the README cannot be written: unexpected_error with a constant message, a warning names the file, the project is as on disk", async function() {
            h = await harnessModule.createHarness();
            failWrite("README.md");
            const err = await update({ description: "new" });
            assertConstantFailure(err);
            warned().some(t => t.indexOf("Saving the project file README.md failed") !== -1).should.be.true("no warning: " + JSON.stringify(warned()));
            fs.readFileSync(path.join(h.projectDir, "README.md"), "utf8").should.equal(harnessModule.OLD.description);
            h.active().description.should.equal(harnessModule.OLD.description);
        });

        it("package.json cannot be written: the same, the warning names package.json", async function() {
            h = await harnessModule.createHarness();
            failWrite("package.json");
            const err = await update({ summary: "s" });
            assertConstantFailure(err);
            warned().some(t => t.indexOf("Saving the project file package.json failed") !== -1).should.be.true("no warning: " + JSON.stringify(warned()));
            packageJson().description.should.equal(harnessModule.OLD.summary);
            h.active().package.description.should.equal(harnessModule.OLD.summary);
        });

        it("package.json cannot be read: the same", async function() {
            h = await harnessModule.createHarness();
            h.failNextRead("package.json");
            const err = await update({ summary: "s" });
            assertConstantFailure(err);
            warned().some(t => t.indexOf("package.json") !== -1 && t.indexOf("failed") !== -1).should.be.true("no warning: " + JSON.stringify(warned()));
            packageJson().description.should.equal(harnessModule.OLD.summary);
        });

        it("auto workflow: no stage and no commit after a failed write", async function() {
            h = await harnessModule.createHarness({ mode: "auto" });
            const spies = watch();
            failWrite("README.md");
            const err = await update({ description: "new" });
            assertConstantFailure(err);
            spies.stage.called.should.be.false("the file was staged");
            spies.commit.called.should.be.false("a commit was made");
        });

        it("B7-AC-7: README fails and package.json succeeds: the update fails, what is on disk is shown", async function() {
            h = await harnessModule.createHarness();
            failWrite("README.md");
            const err = await update({ description: "d", summary: "s" });
            assertConstantFailure(err);
            packageJson().description.should.equal("s");
            fs.readFileSync(path.join(h.projectDir, "README.md"), "utf8").should.equal(harnessModule.OLD.description);
            h.active().package.description.should.equal("s");
            h.active().description.should.equal(harnessModule.OLD.description);
        });
    });

    describe("B7-AC-6: a failed save of the settings fails the update and restores the project", function() {
        it("the key is not changed, the settings are restored before the project is loaded again, the warning says what failed", async function() {
            h = await harnessModule.createHarness();
            h.settings.failSaves(1);
            const err = await update({ credentialSecret: "new", currentCredentialSecret: "old" });
            assertConstantFailure(err);
            h.settings.store.projects.projects[h.name].credentialSecret.should.equal("old");
            h.active().credentialSecret.should.equal("old");
            warned().some(t => t.indexOf("Saving the settings failed") !== -1).should.be.true("no warning: " + JSON.stringify(warned()));
            // the restore (a second save of the settings) comes before the reads of the load
            const saves = h.order.map((event, index) => event === "saveSettings" ? index : -1).filter(index => index !== -1);
            saves.should.have.length(2, "the order of events: " + JSON.stringify(h.order));
            const firstRead = h.order.findIndex(event => event.indexOf("read:") === 0);
            if (firstRead !== -1) {
                saves[1].should.be.below(firstRead, "the restore came after the load: " + JSON.stringify(h.order));
            }
            h.settings.saves[1].projects[h.name].credentialSecret.should.equal("old");
        });

        it("a project whose key is not valid and a reset of the key: the flag and the key stay", async function() {
            h = await harnessModule.createHarness();
            h.markKeyInvalid();
            h.settings.failSaves(1);
            const err = await update({ credentialSecret: "new", resetCredentialSecret: true });
            assertConstantFailure(err);
            h.active().credentialSecretInvalid.should.equal(true);
            h.active().credentialSecret.should.equal("old");
            h.settings.store.projects.projects[h.name].credentialSecret.should.equal("old");
        });

        it("the restore fails too: still the same error, two warnings, the second says that the key may need to be entered again", async function() {
            h = await harnessModule.createHarness();
            h.settings.failSaves(2);
            const err = await update({ credentialSecret: "new", currentCredentialSecret: "old" });
            assertConstantFailure(err);
            const texts = warned();
            const first = texts.findIndex(t => t.indexOf("Saving the settings failed") !== -1);
            const second = texts.findIndex(t => t.indexOf("Restoring the project settings failed") !== -1);
            first.should.not.equal(-1, "no warning of the failed save: " + JSON.stringify(texts));
            second.should.not.equal(-1, "no warning of the failed restore: " + JSON.stringify(texts));
            first.should.be.below(second);
            texts[second].should.containEql("the project key may need to be entered again");
        });

        it("a failed save of the settings of a new project entry or of the git user fails the update too", async function() {
            h = await harnessModule.createHarness({ credentialSecret: null });
            h.settings.failSaves(1);
            const err = await update({ git: { user: { name: "N", email: "n@example.org" } } });
            assertConstantFailure(err);
            should.not.exist((h.settings.store.projects.projects[h.name].git || {}).user);
        });
    });

    describe("B7-AC-11: a failed change of a remote fails the update", function() {
        it("a remote that cannot be added: a constant message, no URL, no name, the remotes as in the git configuration", async function() {
            h = await harnessModule.createHarness({ remotes: { origin: "https://host.example/a.git" } });
            sinon.stub(h.gitTools, "addRemote").callsFake(function() {
                const err = new Error("fatal: https://user:s3cret@h.example/r.git is not valid");
                err.code = "git_invalid_argument";
                return Promise.reject(err);
            });
            const err = await update({ description: "d", git: { remotes: { o2: { url: "https://user:s3cret@h.example/r.git" } } } });
            assertConstantFailure(err);
            JSON.stringify([err.message, err.code]).should.not.containEql("o2");
            JSON.stringify([err.message, err.code]).should.not.containEql("h.example");
            const text = warned().filter(t => t.indexOf("Changing the remotes of the project failed") !== -1);
            text.should.have.length(1, "warnings: " + JSON.stringify(warned()));
            text[0].should.containEql("git_invalid_argument");
            JSON.stringify(warned()).should.not.containEql("s3cret");
            Object.keys(h.active().remotes).should.eql(["origin"]);
        });

        it("a remote that cannot be removed: the same, and the failure is not left unhandled", async function() {
            h = await harnessModule.createHarness({ remotes: { origin: "https://host.example/a.git" } });
            sinon.stub(h.gitTools, "removeRemote").callsFake(function() {
                const err = new Error("fatal: cannot remove https://user:s3cret@host.example/a.git");
                err.code = "git_error";
                return Promise.reject(err);
            });
            const err = await update({ git: { remotes: { origin: { removed: true } } } });
            assertConstantFailure(err);
            JSON.stringify([err.message, err.code]).should.not.containEql("origin");
            await new Promise(resolve => setTimeout(resolve, 20));
            unhandled.map(String).should.eql([], "an unhandled rejection");
            JSON.stringify(warned()).should.not.containEql("s3cret");
            Object.keys(h.active().remotes).should.eql(["origin"]);
        });
    });

    describe("B7-AC-8: valid requests are saved as before", function() {
        function readme() { return fs.readFileSync(path.join(h.projectDir, "README.md"), "utf8"); }

        it("description: the README is written", async function() {
            h = await harnessModule.createHarness();
            const result = await h.active().update(null, { description: "new text" });
            readme().should.equal("new text");
            result.should.eql({ flowFilesChanged: false, credentialSecretChanged: false });
        });

        it("summary and version: package.json is written", async function() {
            h = await harnessModule.createHarness();
            await h.active().update(null, { summary: "s", version: "1.2.3" });
            packageJson().should.have.property("description", "s");
            packageJson().should.have.property("version", "1.2.3");
        });

        it("dependencies: an object of texts is written", async function() {
            h = await harnessModule.createHarness();
            await h.active().update(null, { dependencies: { a: "~1.0", b: "^2.0.0" } });
            packageJson().dependencies.should.eql({ a: "~1.0", b: "^2.0.0" });
        });

        it("a new key with the current one: saved, reported as a change of the key", async function() {
            h = await harnessModule.createHarness();
            const result = await h.active().update(null, { credentialSecret: "new", currentCredentialSecret: "old" });
            result.credentialSecretChanged.should.equal(true);
            h.settings.store.projects.projects[h.name].credentialSecret.should.equal("new");
            h.active().credentialSecret.should.equal("new");
        });

        it("a new key as a reset (no current key), with the valid types of the two flags", async function() {
            h = await harnessModule.createHarness();
            const result = await h.active().update(null, { credentialSecret: "new", resetCredentialSecret: true, currentCredentialSecret: "whatever" });
            result.credentialSecretChanged.should.equal(true);
            h.active().credentialSecret.should.equal("new");
        });

        [["false", false], ["null", null], ["an empty text", ""]].forEach(function(entry) {
            it("credentialSecret " + entry[0] + " is ignored", async function() {
                h = await harnessModule.createHarness();
                const before = h.snapshot();
                const result = await h.active().update(null, { credentialSecret: entry[1] });
                result.should.eql({ flowFilesChanged: false, credentialSecretChanged: false });
                h.snapshot().should.eql(before);
            });
        });

        it("the names of the files that are the same as now change nothing", async function() {
            h = await harnessModule.createHarness();
            const before = h.snapshot();
            const result = await h.active().update(null, { files: { package: "package.json", flow: "flows.json", credentials: "flows_cred.json" } });
            result.flowFilesChanged.should.equal(false);
            h.snapshot().should.eql(before);
        });

        it("another flow file inside the project is a change of the files", async function() {
            h = await harnessModule.createHarness();
            const result = await h.active().update(null, { files: { flow: "other.json" } });
            result.flowFilesChanged.should.equal(true);
            packageJson()["node-red"].settings.flowFile.should.equal("other.json");
        });

        it("fields that are not known are ignored", async function() {
            h = await harnessModule.createHarness();
            await h.active().update(null, { description: "new", unknownField: { a: 1 } });
            readme().should.equal("new");
        });

        it("the git user is saved in the settings of the project and kept in the project", async function() {
            h = await harnessModule.createHarness();
            await h.active().update(null, { git: { user: { name: "N", email: "n@example.org" } } });
            h.settings.store.projects.projects[h.name].git.user._.should.eql({ name: "N", email: "n@example.org" });
            h.active().git.user._.should.eql({ name: "N", email: "n@example.org" });
        });

        // the git configuration is read until the change shows (a remote that was changed is a spawned git command)
        async function configShows(check) {
            const file = path.join(h.projectDir, ".git", "config");
            for (let i = 0; i < 100; i++) {
                if (check(fs.readFileSync(file, "utf8"))) {
                    return true;
                }
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            return false;
        }

        it("a remote is added and removed in the git configuration", async function() {
            h = await harnessModule.createHarness({ remotes: { origin: "https://host.example/a.git" } });
            await h.active().update(null, { git: { remotes: { o2: { url: "https://host.example/b.git" } } } });
            (await configShows(config => config.indexOf("o2") !== -1)).should.be.true("o2 is not in the git configuration");
            await h.active().update(null, { git: { remotes: { origin: { removed: true } } } });
            (await configShows(config => config.indexOf("origin") === -1)).should.be.true("origin is still in the git configuration");
        });

        it("credentials for a remote that exists go to the cache of the credentials", async function() {
            h = await harnessModule.createHarness({ remotes: { origin: "https://host.example/a.git" } });
            const authSet = sinon.spy(h.authCache, "set");
            await h.active().update(null, { git: { remotes: { origin: { username: "u", password: "p" } } } });
            authSet.calledOnce.should.be.true();
        });

        it("auto workflow: the changed file is staged and committed", async function() {
            h = await harnessModule.createHarness({ mode: "auto" });
            const spies = watch();
            await h.active().update(null, { description: "new" });
            spies.stage.calledOnce.should.be.true();
            spies.stage.firstCall.args[0].should.eql(["README.md"]);
            spies.commit.calledOnce.should.be.true();
            spies.commit.firstCall.args[1].should.eql({ message: "Update README.md" });
        });
    });
});
