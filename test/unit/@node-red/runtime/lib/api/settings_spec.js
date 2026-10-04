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
 *   P-03: tests of telemetryLocked and of ignoring telemetryEnabled while locked
 *   Z-05: test of the deploy.requireRevision flag in the runtime settings
 *   Z-15: test of the editorOnly flag in the runtime settings
 *   #45: the active project in the runtime settings is its export(); test with a real Project (no
 *   credentialSecret, no credentials of the remote URLs)
 *   #19: supertest bound to 127.0.0.1 (nr-test-utils/supertest), no crosstalk with other processes (flaky tests)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */


var should = require("should");
var sinon = require("sinon");
var clone = require("clone");

var NR_TEST_UTILS = require("nr-test-utils");
var settings = NR_TEST_UTILS.require("@node-red/runtime/lib/api/settings")

var mockLog = () => ({
    log: sinon.stub(),
    debug: sinon.stub(),
    trace: sinon.stub(),
    warn: sinon.stub(),
    info: sinon.stub(),
    metric: sinon.stub(),
    audit: sinon.stub(),
    _: function() { return "abc"}
})

describe("runtime-api/settings", function() {
    describe("getRuntimeSettings", function() {
        it("gets the runtime settings", function() {
            settings.init({
                settings: {
                    foo: 123,
                    httpNodeRoot: "testHttpNodeRoot",
                    version: "testVersion",
                    paletteCategories :["red","blue","green"],
                    exportNodeSettings: (obj) => {
                        obj.testNodeSetting = "helloWorld";
                    },
                },
                plugins: {
                    exportPluginSettings: (obj) => {
                        obj.testPluginSettings = "helloPluginWorld";
                    }
                },
                nodes: {
                    listContextStores: () => { return {stores:["file","memory"], default: "file"} },
                    installerEnabled: () => false,
                    getCredentialKeyType: () => "test-key-type"
                },
                library: {getLibraries: () => ["lib1"] },
                storage: {},
                telemetry: { isEnabled: () => true }
            })
            return settings.getRuntimeSettings({}).then(result => {
                result.should.have.property("httpNodeRoot","testHttpNodeRoot");
                result.should.have.property("version","testVersion");
                result.should.have.property("paletteCategories",["red","blue","green"]);
                result.should.have.property("libraries",["lib1"]);
                result.should.have.property("testNodeSetting","helloWorld");
                result.should.have.property("testPluginSettings","helloPluginWorld");
                result.should.not.have.property("foo",123);
                result.should.have.property("flowEncryptionType","test-key-type");
                result.should.not.have.property("user");
                result.should.have.property("externalModules");
                result.externalModules.should.eql({palette:{allowInstall:false, allowUpload: false}});

            })
        });
        it("gets the filtered user settings", function() {
            settings.init({
                settings: {
                    foo: 123,
                    httpNodeRoot: "testHttpNodeRoot",
                    version: "testVersion",
                    paletteCategories :["red","blue","green"],
                    exportNodeSettings: (obj) => {
                        obj.testNodeSetting = "helloWorld";
                    },
                },
                plugins: {
                    exportPluginSettings: (obj) => {
                        obj.testPluginSettings = "helloPluginWorld";
                    }
                },
                nodes: {
                    listContextStores: () => { return {stores:["file","memory"], default: "file"} },
                    installerEnabled: () => false,
                    getCredentialKeyType: () => "test-key-type"
                },
                library: {getLibraries: () => { ["lib1"]} },
                storage: {},
                telemetry: { isEnabled: () => true }
            })
            return settings.getRuntimeSettings({
                user: {
                    username: "nick",
                    anonymous: false,
                    image: "http://example.com",
                    permissions: "*",
                    private: "secret"
                }
            }).then(result => {
                result.should.have.property("user");
                result.user.should.have.property("username","nick");
                result.user.should.have.property("permissions","*");
                result.user.should.have.property("image","http://example.com");
                result.user.should.have.property("anonymous",false);
                result.user.should.not.have.property("private");
            })
        });
        it("gets the filtered settings when editor disabled ", function() {
            settings.init({
                settings: {
                    disableEditor: true,
                    foo: 123,
                    httpNodeRoot: "testHttpNodeRoot",
                    version: "testVersion",
                    paletteCategories :["red","blue","green"],
                    exportNodeSettings: (obj) => {
                        obj.testNodeSetting = "helloWorld";
                    },
                },
                plugins: {
                    exportPluginSettings: (obj) => {
                        obj.testPluginSettings = "helloPluginWorld";
                    }
                },
                nodes: {
                    listContextStores: () => { return {stores:["file","memory"], default: "file"} },
                    installerEnabled: () => false,
                    getCredentialKeyType: () => "test-key-type"
                },
                library: {getLibraries: () => { ["lib1"]} },
                storage: {
                    projects: {
                        getActiveProject: () => ({name: 'test-active-project', credentialSecret: 'must-not-be-sent', export: () => ({name: 'test-active-project'})}),
                        getFlowFilename:  () => 'test-flow-file',
                        getCredentialsFilename:  () => 'test-creds-file',
                        getGlobalGitUser: () => {return {name:'foo',email:'foo@example.com'}}
                    }
                },
                telemetry: { isEnabled: () => true }
            })
            return settings.getRuntimeSettings({
                user: {
                    username: "nick",
                    anonymous: false,
                    image: "http://example.com",
                    permissions: "*",
                    private: "secret"
                }
            }).then(result => {
                result.should.have.property("user");
                result.user.should.have.property("username","nick");
                result.user.should.have.property("permissions","*");
                result.user.should.have.property("image","http://example.com");
                result.user.should.have.property("anonymous",false);
                result.user.should.not.have.property("private");

                // Filtered out when disableEditor is true
                result.should.not.have.property("paletteCategories",["red","blue","green"]);
                result.should.not.have.property("testNodeSetting","helloWorld");
                result.should.not.have.property("foo",123);
                result.should.not.have.property("flowEncryptionType","test-key-type");
                result.should.not.have.property("project");
                result.should.not.have.property("git");

            })
        });
        it('includes project settings if projects available', function() {
            settings.init({
                settings: {
                    foo: 123,
                    httpNodeRoot: "testHttpNodeRoot",
                    version: "testVersion",
                    paletteCategories :["red","blue","green"],
                    exportNodeSettings: (obj) => {
                        obj.testNodeSetting = "helloWorld";
                    },
                },
                plugins: {
                    exportPluginSettings: (obj) => {
                        obj.testPluginSettings = "helloPluginWorld";
                    }
                },
                nodes: {
                    listContextStores: () => { return {stores:["file","memory"], default: "file"} },
                    installerEnabled: () => false,
                    getCredentialKeyType: () => "test-key-type"
                },
                library: {getLibraries: () => { ["lib1"]} },
                storage: {
                    projects: {
                        getActiveProject: () => ({name: 'test-active-project', credentialSecret: 'must-not-be-sent', export: () => ({name: 'test-active-project'})}),
                        getFlowFilename:  () => 'test-flow-file',
                        getCredentialsFilename:  () => 'test-creds-file',
                        getGlobalGitUser: () => {return {name:'foo',email:'foo@example.com'}}
                    }
                },
                telemetry: { isEnabled: () => true }
            })
            return settings.getRuntimeSettings({
                user: {
                    username: "nick",
                    anonymous: false,
                    image: "http://example.com",
                    permissions: "*",
                    private: "secret"
                }
            }).then(result => {
                // the export() of the project, not the project itself (#45)
                result.should.have.property("project",{name: "test-active-project"});
                JSON.stringify(result).should.not.containEql("must-not-be-sent");
                result.should.not.have.property("files");
                result.should.have.property("git");
                result.git.should.have.property("globalUser",{name:'foo',email:'foo@example.com'});
            });
        });

        describe('active project from a real Project (#45)', function() {
            var fs = require("fs-extra");
            var os = require("os");
            var path = require("path");
            var child_process = require("child_process");
            var Project = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/projects/Project");
            var tmpDir;
            var project;

            beforeEach(async function() {
                tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nr-settings-spec-"));
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
                project = await Project.load(dir);
            });
            afterEach(async function() {
                await fs.remove(tmpDir);
            });

            function initWithProject() {
                settings.init({
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
            }

            it('the real project has the secrets that must not be sent', function() {
                // guards the test itself: the project object holds them
                project.credentialSecret.should.equal("CREDSECRET-0123");
                project.remotes.origin.fetch.should.containEql("s3cret");
            });

            it('has neither the credentialSecret nor the credentials of the remote URLs', async function() {
                initWithProject();
                var result = await settings.getRuntimeSettings({user: {username: "nick", anonymous: false, permissions: "*"}});
                var text = JSON.stringify(result);
                text.should.not.containEql("CREDSECRET-0123");
                text.should.not.containEql("credentialSecret\"");
                text.should.not.containEql("s3cret");
                result.project.name.should.equal("p1");
                result.project.git.remotes.origin.fetch.should.equal("https://***@host.example/org/repo.git");
                result.project.settings.should.have.property("credentialsEncrypted", true);
            });
        });

        it('includes existing files details if projects enabled but no active project and files exist', function() {
            settings.init({
                settings: {
                    foo: 123,
                    httpNodeRoot: "testHttpNodeRoot",
                    version: "testVersion",
                    paletteCategories :["red","blue","green"],
                    exportNodeSettings: (obj) => {
                        obj.testNodeSetting = "helloWorld";
                    },
                },
                plugins: {
                    exportPluginSettings: (obj) => {
                        obj.testPluginSettings = "helloPluginWorld";
                    }
                },
                nodes: {
                    listContextStores: () => { return {stores:["file","memory"], default: "file"} },
                    installerEnabled: () => false,
                    getCredentialKeyType: () => "test-key-type"
                },
                library: {getLibraries: () => { ["lib1"]} },
                storage: {
                    projects: {
                        flowFileExists: () => true,
                        getActiveProject: () => false,
                        getFlowFilename:  () => 'test-flow-file',
                        getCredentialsFilename:  () => 'test-creds-file',
                        getGlobalGitUser: () => {return {name:'foo',email:'foo@example.com'}}
                    }
                },
                telemetry: { isEnabled: () => true }
            })
            return settings.getRuntimeSettings({
                user: {
                    username: "nick",
                    anonymous: false,
                    image: "http://example.com",
                    permissions: "*",
                    private: "secret"
                }
            }).then(result => {
                result.git.should.have.property("globalUser",{name:'foo',email:'foo@example.com'});
                result.should.not.have.property("project");
                result.should.have.property("files");
                result.files.should.have.property("flow",'test-flow-file');
                result.files.should.have.property("credentials",'test-creds-file');
                result.should.have.property("git");
                result.git.should.have.property("globalUser",{name:'foo',email:'foo@example.com'});
            });
        });

        it('does not include file details if projects enabled but no active project and files do not exist', function() {
            settings.init({
                settings: {
                    foo: 123,
                    httpNodeRoot: "testHttpNodeRoot",
                    version: "testVersion",
                    paletteCategories :["red","blue","green"],
                    exportNodeSettings: (obj) => {
                        obj.testNodeSetting = "helloWorld";
                    },
                },
                plugins: {
                    exportPluginSettings: (obj) => {
                        obj.testPluginSettings = "helloPluginWorld";
                    }
                },
                nodes: {
                    listContextStores: () => { return {stores:["file","memory"], default: "file"} },
                    installerEnabled: () => false,
                    getCredentialKeyType: () => "test-key-type"
                },
                library: {getLibraries: () => { ["lib1"]} },
                storage: {
                    projects: {
                        flowFileExists: () => false,
                        getActiveProject: () => false,
                        getFlowFilename:  () => 'test-flow-file',
                        getCredentialsFilename:  () => 'test-creds-file',
                        getGlobalGitUser: () => {return {name:'foo',email:'foo@example.com'}}
                    }
                },
                telemetry: { isEnabled: () => true }
            })
            return settings.getRuntimeSettings({
                user: {
                    username: "nick",
                    anonymous: false,
                    image: "http://example.com",
                    permissions: "*",
                    private: "secret"
                }
            }).then(result => {
                result.should.not.have.property("project");
                result.should.not.have.property("files");
                result.should.have.property("git");
                result.git.should.have.property("globalUser",{name:'foo',email:'foo@example.com'});
            });
        });
    });
    describe("getUserSettings", function() {
        before(function() {
            settings.init({
                settings: {
                    getUserSettings: username => username
                }
            });
        })
        it("returns default user settings", function() {
            return settings.getUserSettings({}).then(result => {
                result.should.eql("_");
            })
        })
        it("returns default user settings for anonymous", function() {
            return settings.getUserSettings({user:{anonymous:true}}).then(result => {
                result.should.eql("_");
            })
        })
        it("returns user settings", function() {
            return settings.getUserSettings({user:{username:'nick'}}).then(result => {
                result.should.eql("nick");
            })
        })
    });

    describe("updateUserSettings", function() {
        var userSettings;
        before(function() {
            settings.init({
                settings: {
                    getUserSettings: username => clone(userSettings[username]),
                    setUserSettings: (username, settings) => {
                        if (username === 'error') {
                            var p = Promise.reject(new Error("unknown user"));
                            p.catch(()=>{});
                            return p;
                        } else if (username === 'throw') {
                            throw new Error("thrown error");
                        }
                        userSettings[username] = clone(settings);
                        return  Promise.resolve();
                    }
                },
                log: mockLog()
            });
        })
        beforeEach(function() {
            userSettings = {
                "_": { abc: 123 },
                "nick": {abc: 456}
            }
        })
        it('sets default user settings', function() {
            return settings.updateUserSettings({settings:{abc:789}}).then(function() {
                userSettings._.abc.should.eql(789)
            })
        })
        it('merges user settings', function() {
            return settings.updateUserSettings({settings:{def:789}}).then(function() {
                userSettings._.abc.should.eql(123)
                userSettings._.def.should.eql(789)
            })
        })
        it('sets default user settings for anonymous user', function() {
            return settings.updateUserSettings({user:{anonymous:true},settings:{def:789}}).then(function() {
                userSettings._.abc.should.eql(123)
                userSettings._.def.should.eql(789)
            })
        })
        it('sets named user settings', function() {
            return settings.updateUserSettings({user:{username:'nick'},settings:{def:789}}).then(function() {
                userSettings.nick.abc.should.eql(456)
                userSettings.nick.def.should.eql(789)
            })
        })
        it('rejects with suitable error', function(done) {
            settings.updateUserSettings({user:{username:'error'},settings:{def:789}}).then(result => {
                done("Unexpected resolve for error case");
            }).catch(err => {
                err.should.have.property('status', 400);
                done();
            }).catch(done);
        })
        it('rejects with suitable error - thrown', function(done) {
            settings.updateUserSettings({user:{username:'throw'},settings:{def:789}}).then(result => {
                done("Unexpected resolve for error case");
            }).catch(err => {
                err.should.have.property('status', 400);
                done();
            }).catch(done);
        })
    });
    describe("telemetry locked by the administrator (P-03)", function() {
        let userSettings;
        let telemetry;
        let log;
        function initSettings(locked) {
            telemetry = {
                isEnabled: () => false,
                isLocked: () => locked,
                enable: sinon.stub(),
                disable: sinon.stub()
            };
            log = mockLog();
            settings.init({
                settings: {
                    getUserSettings: username => clone(userSettings[username]),
                    setUserSettings: (username, settings) => {
                        userSettings[username] = clone(settings);
                        return Promise.resolve();
                    },
                    exportNodeSettings: () => {}
                },
                plugins: { exportPluginSettings: () => {} },
                nodes: {
                    listContextStores: () => { return {stores:["file","memory"], default: "file"} },
                    installerEnabled: () => false,
                    getCredentialKeyType: () => "test-key-type"
                },
                library: {getLibraries: () => ["lib1"] },
                storage: {},
                telemetry: telemetry,
                log: log
            });
        }
        beforeEach(function() {
            userSettings = { "_": { abc: 123 } };
        });
        it('updateUserSettings ignores telemetryEnabled when locked', function() {
            initSettings(true);
            return settings.updateUserSettings({settings:{telemetryEnabled: true, def: 789}}).then(function() {
                telemetry.enable.called.should.be.false();
                telemetry.disable.called.should.be.false();
                userSettings._.should.not.have.property("telemetryEnabled");
                log.audit.calledWithMatch({event: "settings.update", telemetry: "locked"}).should.be.true();
            });
        });
        it('updateUserSettings saves other settings when telemetry locked', function() {
            initSettings(true);
            return settings.updateUserSettings({settings:{telemetryEnabled: false, def: 789}}).then(function() {
                telemetry.disable.called.should.be.false();
                userSettings._.should.eql({abc: 123, def: 789});
            });
        });
        it('updateUserSettings enables telemetry when not locked (unchanged)', function() {
            initSettings(false);
            return settings.updateUserSettings({settings:{telemetryEnabled: true, def: 789}}).then(function() {
                telemetry.enable.calledOnce.should.be.true();
                userSettings._.should.eql({abc: 123, def: 789});
                log.audit.calledWithMatch({telemetry: "locked"}).should.be.false();
            });
        });
        it('getRuntimeSettings includes telemetryLocked when locked', function() {
            initSettings(true);
            return settings.getRuntimeSettings({}).then(result => {
                result.should.have.property("telemetryLocked", true);
                result.should.have.property("telemetryEnabled", false);
            });
        });
        it('getRuntimeSettings omits telemetryLocked by default', function() {
            initSettings(false);
            return settings.getRuntimeSettings({}).then(result => {
                result.should.not.have.property("telemetryLocked");
            });
        });
    });
    describe("deploy.requireRevision in the runtime settings (Z-05)", function() {
        function initWith(deploy) {
            const runtimeSettings = {
                httpNodeRoot: "/",
                version: "v",
                exportNodeSettings: () => {}
            };
            if (deploy !== undefined) {
                runtimeSettings.deploy = deploy;
            }
            settings.init({
                settings: runtimeSettings,
                plugins: { exportPluginSettings: () => {} },
                nodes: {
                    listContextStores: () => { return {stores:["memory"], default: "memory"} },
                    installerEnabled: () => false,
                    getCredentialKeyType: () => "test-key-type"
                },
                library: {getLibraries: () => [] },
                storage: {},
                telemetry: { isEnabled: () => false }
            });
        }
        it("exposes only the requireRevision flag when it is set", async function() {
            initWith({requireRevision: true, putCreatesFlow: true, response: "started"});
            const result = await settings.getRuntimeSettings({});
            result.should.have.property("deploy", {requireRevision: true});
        });
        it("omits deploy when requireRevision is not set", async function() {
            for (const deploy of [undefined, {}, {requireRevision: false}]) {
                initWith(deploy);
                const result = await settings.getRuntimeSettings({});
                result.should.not.have.property("deploy");
            }
        });
    });
    describe("editorOnly in the runtime settings (Z-15)", function() {
        function initWith(editorOnly) {
            const runtimeSettings = { httpNodeRoot: "/", version: "v", exportNodeSettings: () => {} };
            if (editorOnly !== undefined) {
                runtimeSettings.editorOnly = editorOnly;
            }
            settings.init({
                settings: runtimeSettings,
                plugins: { exportPluginSettings: () => {} },
                nodes: {
                    listContextStores: () => { return {stores:["memory"], default: "memory"} },
                    installerEnabled: () => false,
                    getCredentialKeyType: () => "test-key-type"
                },
                library: {getLibraries: () => [] },
                storage: {},
                telemetry: { isEnabled: () => false }
            });
        }
        it("exposes editorOnly to the editor", async function() {
            initWith(true);
            const result = await settings.getRuntimeSettings({});
            result.should.have.property("editorOnly", true);
        });
        it("omits editorOnly when not set or not true", async function() {
            for (const value of [undefined, false, "true"]) {
                initWith(value);
                const result = await settings.getRuntimeSettings({});
                result.should.not.have.property("editorOnly");
            }
        });
    });
    describe("getUserKeys", function() {
        before(function() {
            settings.init({
                storage: {
                    projects: {
                        ssh: {
                            listSSHKeys: username => {
                                if (username === 'error') {
                                    var p = Promise.reject(new Error("unknown user"));
                                    p.catch(()=>{});
                                    return p;
                                }
                                return Promise.resolve([username])
                            }
                        }
                    }
                }
            })
        })
        it('returns the default users keys', function() {
            return settings.getUserKeys({}).then(result => {
                result.should.eql(['__default']);
            })
        })
        it('returns the default users keys for anonymous', function() {
            return settings.getUserKeys({user:{anonymous:true}}).then(result => {
                result.should.eql(['__default']);
            })
        })
        it('returns the users keys', function() {
            return settings.getUserKeys({user:{username:'nick'}}).then(result => {
                result.should.eql(['nick']);
            })
        })
        it('rejects with suitable error', function(done) {
            settings.getUserKeys({user:{username:'error'}}).then(result => {
                done("Unexpected resolve for error case");
            }).catch(err => {
                err.should.have.property('status', 400);
                done();
            }).catch(done);
        })
    });

    describe("getUserKey", function() {
        before(function() {
            settings.init({
                storage: {
                    projects: {
                        ssh: {
                            getSSHKey: (username, id) => {
                                if (username === 'error') {
                                    var p = Promise.reject(new Error("unknown user"));
                                    p.catch(()=>{});
                                    return p;
                                } else if (username === '404') {
                                    return Promise.resolve(null);
                                }
                                return Promise.resolve({username,id})
                            }
                        }
                    }
                }
            })
        })
        it('returns the default user key', function() {
            return settings.getUserKey({id:'keyid'}).then(result => {
                result.should.eql({id:'keyid',username:"__default"});
            })
        })
        it('returns the default user key - anonymous', function() {
            return settings.getUserKey({user:{anonymous:true},id:'keyid'}).then(result => {
                result.should.eql({id:'keyid',username:"__default"});
            })
        })
        it('returns the user key', function() {
            return settings.getUserKey({user:{username:'nick'},id:'keyid'}).then(result => {
                result.should.eql({id:'keyid',username:"nick"});
            })
        })
        it('404s for unknown key', function(done) {
            settings.getUserKey({user:{username:'404'},id:'keyid'}).then(result => {
                done("Unexpected resolve for error case");
            }).catch(err => {
                err.should.have.property('status', 404);
                err.should.have.property('code', 'not_found');
                done();
            }).catch(done);
        })
        it('rejects with suitable error', function(done) {
            settings.getUserKey({user:{username:'error'}}).then(result => {
                done("Unexpected resolve for error case");
            }).catch(err => {
                err.should.have.property('status', 400);
                done();
            }).catch(done);
        })
    });
    describe("generateUserKey", function() {
        before(function() {
            settings.init({
                storage: {
                    projects: {
                        ssh: {
                            generateSSHKey: (username, opts) => {
                                if (username === 'error') {
                                    var p = Promise.reject(new Error("unknown user"));
                                    p.catch(()=>{});
                                    return p;
                                }
                                return Promise.resolve(JSON.stringify({username,opts}))
                            }
                        }
                    }
                }
            })
        })
        it('generates for the default user', function() {
            return settings.generateUserKey({id:'keyid'}).then(result => {
                var data = JSON.parse(result);
                data.should.eql({opts:{id:'keyid'},username:"__default"});
            })
        })
        it('generates for the default user - anonymous', function() {
            return settings.generateUserKey({user:{anonymous:true},id:'keyid'}).then(result => {
                var data = JSON.parse(result);
                data.should.eql({opts:{user:{anonymous:true},id:'keyid'},username:"__default"});
            })
        })
        it('generates for the user', function() {
            return settings.generateUserKey({user:{username:'nick'},id:'keyid'}).then(result => {
                var data = JSON.parse(result);
                data.should.eql({opts:{user:{username:'nick'},id:'keyid'},username:"nick"});
            })
        })
        it('rejects with suitable error', function(done) {
            settings.generateUserKey({user:{username:'error'}}).then(result => {
                done("Unexpected resolve for error case");
            }).catch(err => {
                err.should.have.property('status', 400);
                done();
            }).catch(done);
        })

    });
    describe("removeUserKey", function() {
        var received = {};
        before(function() {
            settings.init({
                storage: {
                    projects: {
                        ssh: {
                            deleteSSHKey: (username, id) => {
                                if (username === 'error') {
                                    var p = Promise.reject(new Error("unknown user"));
                                    p.catch(()=>{});
                                    return p;
                                }
                                received.username = username;
                                received.id = id;
                                return Promise.resolve();
                            }
                        }
                    }
                }
            })
        });
        beforeEach(function() {
            received.username = "";
            received.id = "";
        })
        it('removes for the default user', function() {
            return settings.removeUserKey({id:'keyid'}).then(() => {
                received.username.should.eql("__default");
                received.id.should.eql("keyid");
            })
        })
        it('removes for the default user key - anonymous', function() {
            return settings.removeUserKey({user:{anonymous:true},id:'keyid'}).then(() => {
                received.username.should.eql("__default");
                received.id.should.eql("keyid");
            })
        })
        it('returns the user key', function() {
            return settings.removeUserKey({user:{username:'nick'},id:'keyid'}).then(() => {
                received.username.should.eql("nick");
                received.id.should.eql("keyid");
            })
        })
        it('rejects with suitable error', function(done) {
            settings.removeUserKey({user:{username:'error'}}).then(result => {
                done("Unexpected resolve for error case");
            }).catch(err => {
                err.should.have.property('status', 400);
                done();
            }).catch(done);
        })
    });

});



/*


var should = require("should");
var sinon = require("sinon");
var request = require("nr-test-utils/supertest");
var express = require("express");
var editorApi = require("../../../../red/api/editor");
var comms = require("../../../../red/api/editor/comms");
var info = require("../../../../red/api/editor/settings");
var auth = require("../../../../red/api/auth");
var sshkeys = require("../../../../red/api/editor/sshkeys");
var bodyParser = require("body-parser");
var fs = require("fs-extra");
var fspath = require("path");


describe("api/editor/sshkeys", function() {
    var app;
    var mockList = [
        'library','theme','locales','credentials','comms'
    ]
    var isStarted = true;
    var errors = [];
    var session_data = {};

    var mockRuntime = {
        settings:{
            httpNodeRoot: true,
            httpAdminRoot: true,
            disableEditor: false,
            exportNodeSettings:function(){},
            storage: {
                getSessions: function(){
                    return Promise.resolve(session_data);
                },
                setSessions: function(_session) {
                    session_data = _session;
                    return Promise.resolve();
                }
            }
        },
        log:{audit:function(){},error:function(msg){errors.push(msg)},trace:function(){}},
        storage: {
            projects: {
                ssh: {
                    init: function(){},
                    listSSHKeys: function(){},
                    getSSHKey: function(){},
                    generateSSHKey: function(){},
                    deleteSSHKey: function(){}
                }
            }
        },
        events:{on:function(){},removeListener:function(){}},
        isStarted: function() { return isStarted; },
        nodes: {installerEnabled: function() { return false }}
    };

    before(function() {
        auth.init(mockRuntime);
        app = express();
        app.use(bodyParser.json());
        app.use(editorApi.init({},mockRuntime));
    });
    after(function() {
    })

    beforeEach(function() {
        sinon.stub(mockRuntime.storage.projects.ssh, "listSSHKeys");
        sinon.stub(mockRuntime.storage.projects.ssh, "getSSHKey");
        sinon.stub(mockRuntime.storage.projects.ssh, "generateSSHKey");
        sinon.stub(mockRuntime.storage.projects.ssh, "deleteSSHKey");
    })
    afterEach(function() {
        mockRuntime.storage.projects.ssh.listSSHKeys.restore();
        mockRuntime.storage.projects.ssh.getSSHKey.restore();
        mockRuntime.storage.projects.ssh.generateSSHKey.restore();
        mockRuntime.storage.projects.ssh.deleteSSHKey.restore();
    })

    it('GET /settings/user/keys --- return empty list', function(done) {
        mockRuntime.storage.projects.ssh.listSSHKeys.returns(Promise.resolve([]));
        request(app)
        .get("/settings/user/keys")
        .expect(200)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            res.body.should.have.property('keys');
            res.body.keys.should.be.empty();
            done();
        });
    });

    it('GET /settings/user/keys --- return normal list', function(done) {
        var fileList = [
            'test_key01',
            'test_key02'
        ];
        var retList = fileList.map(function(elem) {
            return {
                name: elem
            };
        });
        mockRuntime.storage.projects.ssh.listSSHKeys.returns(Promise.resolve(retList));
        request(app)
        .get("/settings/user/keys")
        .expect(200)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            res.body.should.have.property('keys');
            for (var item of retList) {
                res.body.keys.should.containEql(item);
            }
            done();
        });
    });

    it('GET /settings/user/keys --- return Error', function(done) {
        var errInstance = new Error("Messages here.....");
        errInstance.code = "test_code";
        var p = Promise.reject(errInstance);
        p.catch(()=>{});
        mockRuntime.storage.projects.ssh.listSSHKeys.returns(p);
        request(app)
        .get("/settings/user/keys")
        .expect(400)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            res.body.should.have.property('error');
            res.body.error.should.be.equal(errInstance.code);
            res.body.should.have.property('message');
            res.body.message.should.be.equal(errInstance.message);
            done();
        });
    });

    it('GET /settings/user/keys/<key_file_name> --- return 404', function(done) {
        mockRuntime.storage.projects.ssh.getSSHKey.returns(Promise.resolve(null));
        request(app)
        .get("/settings/user/keys/NOT_REAL")
        .expect(404)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            done();
        });
    });
    it('GET /settings/user/keys --- return Unexpected Error', function(done) {
        var errInstance = new Error("Messages.....");
        var p = Promise.reject(errInstance);
        p.catch(()=>{});
        mockRuntime.storage.projects.ssh.listSSHKeys.returns(p);
        request(app)
        .get("/settings/user/keys")
        .expect(400)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            res.body.should.have.property('error');
            res.body.error.should.be.equal("unexpected_error");
            res.body.should.have.property('message');
            res.body.message.should.be.equal(errInstance.toString());
            done();
        });
    });

    it('GET /settings/user/keys/<key_file_name> --- return content', function(done) {
        var key_file_name = "test_key";
        var fileContent = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQD3a+sgtgzSbbliWxmOq5p6+H/mE+0gjWfLWrkIVmHENd1mifV4uCmIHAR2NfuadUYMQ3+bQ90kpmmEKTMYPsyentsKpHQZxTzG7wOCAIpJnbPTHDMxEJhVTaAwEjbVyMSIzTTPfnhoavWIBu0+uMgKDDlBm+RjlgkFlyhXyCN6UwFrIUUMH6Gw+eQHLiooKIl8ce7uDxIlt+9b7hFCU+sQ3kvuse239DZluu6+8buMWqJvrEHgzS9adRFKku8nSPAEPYn85vDi7OgVAcLQufknNgs47KHBAx9h04LeSrFJ/P5J1b//ItRpMOIme+O9d1BR46puzhvUaCHLdvO9czj+OmW+dIm+QIk6lZIOOMnppG72kZxtLfeKT16ur+2FbwAdL9ItBp4BI/YTlBPoa5mLMxpuWfmX1qHntvtGc9wEwS1P7YFfmF3XiK5apxalzrn0Qlr5UmDNbVIqJb1OlbC0w03Z0oktti1xT+R2DGOLWM4lBbpXDHV1BhQ7oYOvbUD8Cnof55lTP0WHHsOHlQc/BGDti1XA9aBX/OzVyzBUYEf0pkimsD0RYo6aqt7QwehJYdlz9x1NBguBffT0s4NhNb9IWr+ASnFPvNl2sw4XH/8U0J0q8ZkMpKkbLM1Zdp1Fv00GF0f5UNRokai6uM3w/ccantJ3WvZ6GtctqytWrw== \n";
        mockRuntime.storage.projects.ssh.getSSHKey.returns(Promise.resolve(fileContent));
        request(app)
        .get("/settings/user/keys/" + key_file_name)
        .expect(200)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            mockRuntime.storage.projects.ssh.getSSHKey.called.should.be.true();
            res.body.should.be.deepEqual({ publickey: fileContent });
            done();
        });
    });

    it('GET /settings/user/keys/<key_file_name> --- return Error', function(done) {
        var key_file_name = "test_key";
        var errInstance = new Error("Messages.....");
        errInstance.code = "test_code";
        var p = Promise.reject(errInstance);
        p.catch(()=>{});
        mockRuntime.storage.projects.ssh.getSSHKey.returns(p);
        request(app)
        .get("/settings/user/keys/" + key_file_name)
        .expect(400)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            res.body.should.have.property('error');
            res.body.error.should.be.equal(errInstance.code);
            res.body.should.have.property('message');
            res.body.message.should.be.equal(errInstance.message);
            done();
        });
    });

    it('GET /settings/user/keys/<key_file_name> --- return Unexpected Error', function(done) {
        var key_file_name = "test_key";
        var errInstance = new Error("Messages.....");
        var p = Promise.reject(errInstance);
        p.catch(()=>{});
        mockRuntime.storage.projects.ssh.getSSHKey.returns(p);
        request(app)
        .get("/settings/user/keys/" + key_file_name)
        .expect(400)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            res.body.should.have.property('error');
            res.body.error.should.be.equal("unexpected_error");
            res.body.should.have.property('message');
            res.body.message.should.be.equal(errInstance.toString());
            done();
        });
    });

    it('POST /settings/user/keys --- success', function(done) {
        var key_file_name = "test_key";
        mockRuntime.storage.projects.ssh.generateSSHKey.returns(Promise.resolve(key_file_name));
        request(app)
        .post("/settings/user/keys")
        .send({ name: key_file_name })
        .expect(200)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            done();
        });
    });

    it('POST /settings/user/keys --- return parameter error', function(done) {
        var key_file_name = "test_key";
        mockRuntime.storage.projects.ssh.generateSSHKey.returns(Promise.resolve(key_file_name));
        request(app)
        .post("/settings/user/keys")
        .expect(400)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            res.body.should.have.property('error');
            res.body.error.should.be.equal("unexpected_error");
            res.body.should.have.property('message');
            res.body.message.should.be.equal("You need to have body or body.name");
            done();
        });
    });

    it('POST /settings/user/keys --- return Error', function(done) {
        var key_file_name = "test_key";
        var errInstance = new Error("Messages.....");
        errInstance.code = "test_code";
        var p = Promise.reject(errInstance);
        p.catch(()=>{});
        mockRuntime.storage.projects.ssh.generateSSHKey.returns(p);
        request(app)
        .post("/settings/user/keys")
        .send({ name: key_file_name })
        .expect(400)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            res.body.should.have.property('error');
            res.body.error.should.be.equal("test_code");
            res.body.should.have.property('message');
            res.body.message.should.be.equal(errInstance.message);
            done();
        });
    });

    it('POST /settings/user/keys --- return Unexpected error', function(done) {
        var key_file_name = "test_key";
        var errInstance = new Error("Messages.....");
        var p = Promise.reject(errInstance);
        p.catch(()=>{});
        mockRuntime.storage.projects.ssh.generateSSHKey.returns(p);
        request(app)
        .post("/settings/user/keys")
        .send({ name: key_file_name })
        .expect(400)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            res.body.should.have.property('error');
            res.body.error.should.be.equal("unexpected_error");
            res.body.should.have.property('message');
            res.body.message.should.be.equal(errInstance.toString());
            done();
        });
    });

    it('DELETE /settings/user/keys/<key_file_name> --- success', function(done) {
        var key_file_name = "test_key";
        mockRuntime.storage.projects.ssh.deleteSSHKey.returns(Promise.resolve(true));
        request(app)
        .delete("/settings/user/keys/" + key_file_name)
        .expect(204)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            res.body.should.be.deepEqual({});
            done();
        });
    });

    it('DELETE /settings/user/keys/<key_file_name> --- return Error', function(done) {
        var key_file_name = "test_key";
        var errInstance = new Error("Messages.....");
        errInstance.code = "test_code";
        var p = Promise.reject(errInstance);
        p.catch(()=>{});
        mockRuntime.storage.projects.ssh.deleteSSHKey.returns(p);
        request(app)
        .delete("/settings/user/keys/" + key_file_name)
        .expect(400)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            res.body.should.have.property('error');
            res.body.error.should.be.equal("test_code");
            res.body.should.have.property('message');
            res.body.message.should.be.equal(errInstance.message);
            done();
        });
    });

    it('DELETE /settings/user/keys/<key_file_name> --- return Unexpected Error', function(done) {
        var key_file_name = "test_key";
        var errInstance = new Error("Messages.....");
        var p = Promise.reject(errInstance);
        p.catch(()=>{});
        mockRuntime.storage.projects.ssh.deleteSSHKey.returns(p);
        request(app)
        .delete("/settings/user/keys/" + key_file_name)
        .expect(400)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            res.body.should.have.property('error');
            res.body.error.should.be.equal("unexpected_error");
            res.body.should.have.property('message');
            res.body.message.should.be.equal(errInstance.toString());
            done();
        });
    });
});
*/
