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
 *   #45: tests of hiding the credentials of remote URLs in the project returned to the API;
 *   toJSON() of a project gives export() (no credentialSecret)
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
