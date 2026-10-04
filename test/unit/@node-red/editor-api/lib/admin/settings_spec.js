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
 *   #45: GET /settings with an active project has no credentialSecret and no credentials of the remote URLs
 *   #19: supertest bound to 127.0.0.1 (nr-test-utils/supertest), no crosstalk with other processes (flaky tests)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var request = require("nr-test-utils/supertest");
var express = require('express');
var bodyParser = require("body-parser");
var sinon = require('sinon');

var app;

var NR_TEST_UTILS = require("nr-test-utils");

var info = NR_TEST_UTILS.require("@node-red/editor-api/lib/admin/settings");
var theme = NR_TEST_UTILS.require("@node-red/editor-api/lib/editor/theme");

describe("api/editor/settings", function() {
    before(function() {
        sinon.stub(theme,"settings").callsFake(function() { return { existing: 123, test: 456 };});
        app = express();
        app.use(bodyParser.json());
        app.get("/settings",info.runtimeSettings);
    });

    after(function() {
        theme.settings.restore();
    });

    it('returns the runtime settings', function(done) {
        info.init({},{
            settings: {
                getRuntimeSettings: function(opts) {
                    return Promise.resolve({
                        a:1,
                        b:2,
                        editorTheme: { existing: 789 }
                    })
                }
            }
        });
        request(app)
        .get("/settings")
        .expect(200)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            res.body.should.have.property("a",1);
            res.body.should.have.property("b",2);
            res.body.should.have.property("editorTheme",{existing: 789, test:456});
            done();
        });
    });
    it('returns the runtime settings - disableEditor true', function(done) {
        info.init({disableEditor: true},{
            settings: {
                getRuntimeSettings: function(opts) {
                    return Promise.resolve({
                        a:1,
                        b:2
                    })
                }
            }
        });
        request(app)
        .get("/settings")
        .expect(200)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            res.body.should.have.property("a",1);
            res.body.should.have.property("b",2);
            // no editorTheme if disabledEditor true
            res.body.should.not.have.property("editorTheme");
            done();
        });
    });

});

describe("api/admin/settings - active project (#45)", function() {
    var fs = require("fs-extra");
    var os = require("os");
    var path = require("path");
    var child_process = require("child_process");
    var runtimeSettings = NR_TEST_UTILS.require("@node-red/runtime/lib/api/settings");
    var Project = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/projects/Project");
    var tmpDir;
    var adminApp;

    before(function() {
        sinon.stub(theme,"settings").callsFake(function() { return {}; });
    });
    after(function() {
        theme.settings.restore();
    });
    beforeEach(async function() {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nr-admin-settings-spec-"));
        var dir = path.join(tmpDir, "p1");
        await fs.mkdirp(dir);
        child_process.execFileSync("git", ["init", "-q"], {cwd: dir});
        child_process.execFileSync("git", ["remote", "add", "origin", "https://user:s3cret@host.example/org/repo.git"], {cwd: dir});
        await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({name: "p1", "node-red": {settings: {flowFile: "flow.json", credentialsFile: "flow_cred.json"}}}));
        await fs.writeFile(path.join(dir, "flow.json"), "[]");
        Project.init({
            userDir: tmpDir,
            editorTheme: {projects: {}},
            get: function(key) { return key === "projects" ? {projects: {p1: {credentialSecret: "CREDSECRET-0123"}}} : undefined; },
            set: function() { return Promise.resolve(); }
        }, {});
        var project = await Project.load(dir);
        runtimeSettings.init({
            settings: { version: "testVersion", exportNodeSettings: () => {} },
            library: {getLibraries: () => []},
plugins: { exportPluginSettings: () => {} },
            nodes: {
                listContextStores: () => { return {stores:["memory"], default: "memory"} },
                installerEnabled: () => false,
                getCredentialKeyType: () => "test-key-type"
            },
            storage: {
                projects: {
                    getActiveProject: () => project,
                    getFlowFilename: () => 'flow.json',
                    getCredentialsFilename: () => 'flow_cred.json',
                    getGlobalGitUser: () => null
                }
            },
            telemetry: { isEnabled: () => true }
        });
        // the real runtime settings API behind the real route
        info.init({}, { settings: runtimeSettings });
        adminApp = express();
        adminApp.get("/settings", info.runtimeSettings);
    });
    afterEach(async function() {
        await fs.remove(tmpDir);
    });

    it('GET /settings has neither the credentialSecret nor the password of a remote URL', async function() {
        const res = await request(adminApp).get("/settings").expect(200);
        res.text.should.not.containEql("CREDSECRET-0123");
        res.text.should.not.containEql("s3cret");
        res.body.project.name.should.equal("p1");
        res.body.project.git.remotes.origin.fetch.should.equal("https://***@host.example/org/repo.git");
    });
});
