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
 *   #63: tests that the credentials of an install URL (and of a module given as a URL) are not in the log of the
 *   installer and are passed to exec.run as literal secrets for the event-log; the error of a hook and the arguments that a
 *   hook adds to the npm command are masked in the log too
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var sinon = require("sinon");
var path = require("path");
var fs = require('fs-extra');
var EventEmitter = require('events');

var NR_TEST_UTILS = require("nr-test-utils");

var installer = NR_TEST_UTILS.require("@node-red/registry/lib/installer");
var registry = NR_TEST_UTILS.require("@node-red/registry/lib/index");
var typeRegistry = NR_TEST_UTILS.require("@node-red/registry/lib/registry");
let pluginRegistry = NR_TEST_UTILS.require("@node-red/registry/lib/plugins");
const { events, exec, log, hooks } =  NR_TEST_UTILS.require("@node-red/util");

describe('nodes/registry/installer', function() {

    var mockLog = {
        log: sinon.stub(),
        debug: sinon.stub(),
        trace: sinon.stub(),
        warn: sinon.stub(),
        info: sinon.stub(),
        metric: sinon.stub(),
        _: function(msg) { return msg }
    }

    var execResponse;

    beforeEach(function() {
        sinon.stub(exec,"run").callsFake(() => execResponse || Promise.resolve(""))
        installer.init({})
    });

    afterEach(function() {
        execResponse = null;
        if (registry.addModule.restore) {
            registry.addModule.restore();
        }
        if (registry.removeModule.restore) {
            registry.removeModule.restore();
        }
        if (typeRegistry.removeModule.restore) {
            typeRegistry.removeModule.restore();
        }
        if (registry.getModuleInfo.restore) {
            registry.getModuleInfo.restore();
        }
        if (typeRegistry.getModuleInfo.restore) {
            typeRegistry.getModuleInfo.restore();
        }
        if (typeRegistry.setModulePendingUpdated.restore) {
            typeRegistry.setModulePendingUpdated.restore();
        }
        if (pluginRegistry.removeModule.restore) {
            pluginRegistry.removeModule.restore();
        }
        if (fs.statSync.restore) {
            fs.statSync.restore();
        }
        exec.run.restore();
        hooks.clear();
    });

    describe("installs module", function() {
        it("rejects module name that includes version", function(done) {
            installer.installModule("module@version",null,null).catch(function(err) {
                err.code.should.be.eql('invalid_module_name');
                done();
            }).catch(done);
        });
        it("rejects missing module name", function(done) {
            installer.installModule("",null,null).catch(function(err) {
                err.code.should.be.eql('invalid_module_name');
                done();
            }).catch(done);
        });
        it("rejects null module name", function(done) {
            installer.installModule(null,null,null).catch(function(err) {
                err.code.should.be.eql('invalid_module_name');
                done();
            }).catch(done);
        });
        it("rejects invalid url", function(done) {
            installer.installModule("module",null,"abc").catch(function(err) {
                err.code.should.be.eql('invalid_module_url');
                done();
            });
        });
        it("rejects when npm returns a 404", function(done) {
            var res = {
                code: 1,
                stdout:"",
                stderr:" 404  this_wont_exist"
            }
            var p = Promise.reject(res);
            p.catch((err)=>{});
            execResponse = p;
            installer.installModule("this_wont_exist").catch(function(err) {
                err.should.have.property("code",404);
                done();
            }).catch(done);
        });
        it("rejects when npm does not find specified version", function(done) {
            var res = {
                code: 1,
                stdout:"",
                stderr:" version not found: this_wont_exist@0.1.2"
            }
            var p = Promise.reject(res);
            p.catch((err)=>{});
            execResponse = p;
            sinon.stub(typeRegistry,"getModuleInfo").callsFake(function() {
                return {
                    version: "0.1.1"
                }
            });
            installer.installModule("this_wont_exist","0.1.2").catch(function(err) {
                err.code.should.be.eql(404);
                done();
            }).catch(done);
        });
        it("rejects when update requested to existing version", function(done) {
            sinon.stub(typeRegistry,"getModuleInfo").callsFake(function() {
                return {
                    user: true,
                    version: "0.1.1"
                }
            });
            installer.installModule("this_wont_exist","0.1.1").catch(function(err) {
                err.code.should.be.eql('module_already_loaded');
                done();
            }).catch(done);
        });
        it("rejects when update requested to existing version and url", function(done) {
            sinon.stub(typeRegistry,"getModuleInfo").callsFake(function() {
                return {
                    user: true,
                    version: "0.1.1"
                }
            });
            installer.installModule("this_wont_exist","0.1.1","https://example/foo-0.1.1.tgz").catch(function(err) {
                err.code.should.be.eql('module_already_loaded');
                done();
            }).catch(done);
        });
        it("rejects with generic error", function(done) {
            var res = {
                code: 1,
                stdout:"",
                stderr:" kaboom!"
            }
            var p = Promise.reject(res);
            p.catch((err)=>{});
            execResponse = p;
            installer.installModule("this_wont_exist").then(function() {
                done(new Error("Unexpected success"));
            }).catch(err => {
                // Expected result
                done()
            });
        });
        it("succeeds when module is found", function(done) {
            var nodeInfo = {nodes:{module:"foo",types:["a"]}};

            var res = {
                code: 0,
                stdout:"",
                stderr:""
            }
            var p = Promise.resolve(res);
            p.catch((err)=>{});
            execResponse = p;

            var addModule = sinon.stub(registry,"addModule").callsFake(function(md) {
                return Promise.resolve(nodeInfo);
            });

            installer.installModule("this_wont_exist").then(function(info) {
                info.should.eql(nodeInfo);
                // commsMessages.should.have.length(1);
                // commsMessages[0].topic.should.equal("node/added");
                // commsMessages[0].msg.should.eql(nodeInfo.nodes);
                done();
            }).catch(done);
        });
        it("rejects when non-existant path is provided", function(done) {
            this.timeout(20000);
            var resourcesDir = path.resolve(path.join(__dirname,"resources","local","TestNodeModule","node_modules","NonExistant"));
            installer.installModule(resourcesDir).then(function() {
                done(new Error("Unexpected success"));
            }).catch(function(err) {
                if (err.hasOwnProperty("code")) {
                    err.code.should.eql(404);
                    done();
                }
                else {
                    console.log("ERRROR::"+err.toString()+"::");
                    err.toString().should.eql("Error: Install failed");
                    done();
                }
            });
        });
        it("succeeds when path is valid node-red module", function(done) {
            var nodeInfo = {nodes:{module:"foo",types:["a"]}};
            var addModule = sinon.stub(registry,"addModule").callsFake(function(md) {
                return Promise.resolve(nodeInfo);
            });
            var resourcesDir = path.resolve(path.join(__dirname,"resources","local","TestNodeModule","node_modules","TestNodeModule"));

            var res = {
                code: 0,
                stdout:"",
                stderr:""
            }
            var p = Promise.resolve(res);
            p.catch((err)=>{});
            execResponse = p;
            installer.installModule(resourcesDir).then(function(info) {
                info.should.eql(nodeInfo);
                done();
            }).catch(done);
        });
        it("succeeds when url is valid node-red module", function(done) {
            var nodeInfo = {nodes:{module:"foo",types:["a"]}};

            var res = {
                code: 0,
                stdout:"",
                stderr:""
            }
            var p = Promise.resolve(res);
            p.catch((err)=>{});
            execResponse = p;

            var addModule = sinon.stub(registry,"addModule").callsFake(function(md) {
                return Promise.resolve(nodeInfo);
            });

            installer.installModule("this_wont_exist",null,"https://example/foo-0.1.1.tgz").then(function(info) {
                info.should.eql(nodeInfo);
                done();
            }).catch(done);
        });

        it("succeeds when file path is valid node-red module", function(done) {
            var nodeInfo = {nodes:{module:"foo",types:["a"]}};

            var res = {
                code: 0,
                stdout:"",
                stderr:""
            }
            var p = Promise.resolve(res);
            p.catch((err)=>{});
            execResponse = p;

            var addModule = sinon.stub(registry,"addModule").callsFake(function(md) {
                return Promise.resolve(nodeInfo);
            });

            installer.installModule("foo",null,"/example path/foo-0.1.1.tgz").then(function(info) {
                const lastCallArgs = exec.run.lastCall.args[1];
                lastCallArgs[0].should.match(/npm[\\/]bin[\\/]npm-cli\.js$/)
                const remainingArgs = lastCallArgs.slice(1);
                remainingArgs.should.eql([ 'install', '--no-audit', '--no-update-notifier', '--no-fund', '--save', '--save-prefix=~', '--omit=dev', '--engine-strict', '--', '/example path/foo-0.1.1.tgz' ]);
                info.should.eql(nodeInfo);
                done();
            }).catch(done);
        });

        it("triggers preInstall and postInstall hooks", function(done) {
            let receivedPreEvent,receivedPostEvent;
            hooks.add("preInstall", function(event) { event.args = ["a"]; receivedPreEvent = event; })
            hooks.add("postInstall", function(event) { receivedPostEvent = event; })
            var nodeInfo = {nodes:{module:"foo",types:["a"]}};
            var res = {code: 0,stdout:"",stderr:""}
            var p = Promise.resolve(res);
            p.catch((err)=>{});
            execResponse = p;

            var addModule = sinon.stub(registry,"addModule").callsFake(function(md) {
                return Promise.resolve(nodeInfo);
            });

            installer.installModule("this_wont_exist","1.2.3").then(function(info) {
                exec.run.called.should.be.true();
                exec.run.lastCall.args[1].slice(1).should.eql([ 'install', 'a', '--', 'this_wont_exist@1.2.3' ]);
                info.should.eql(nodeInfo);
                should.exist(receivedPreEvent)
                receivedPreEvent.should.have.property("module","this_wont_exist")
                receivedPreEvent.should.have.property("version","1.2.3")
                receivedPreEvent.should.have.property("dir")
                receivedPreEvent.should.have.property("url")
                receivedPreEvent.should.have.property("isExisting")
                receivedPreEvent.should.have.property("isUpgrade")
                receivedPreEvent.should.eql(receivedPostEvent)
                done();
            }).catch(done);
        });

        it("fails install if preInstall hook fails", function(done) {
            let receivedEvent;
            hooks.add("preInstall", function(event) { throw new Error("preInstall-error"); })
            var nodeInfo = {nodes:{module:"foo",types:["a"]}};

            installer.installModule("this_wont_exist","1.2.3").catch(function(err) {
                exec.run.called.should.be.false();
                done();
            }).catch(done);
        });

        it("skips invoking npm if preInstall returns false", function(done) {
            let receivedEvent;
            hooks.add("preInstall", function(event) { return false })
            hooks.add("postInstall", function(event) { receivedEvent = event; })
            var nodeInfo = {nodes:{module:"foo",types:["a"]}};
            var addModule = sinon.stub(registry,"addModule").callsFake(function(md) {
                return Promise.resolve(nodeInfo);
            });

            installer.installModule("this_wont_exist","1.2.3").then(function() {
                exec.run.called.should.be.false();
                should.exist(receivedEvent);
                done();
            }).catch(done);
        });

        it("rollsback install if postInstall hook fails", function(done) {
            hooks.add("postInstall", function(event) { throw new Error("fail"); })
            installer.installModule("this_wont_exist","1.2.3").catch(function(err) {
                exec.run.calledTwice.should.be.true();
                exec.run.firstCall.args[1].includes("install").should.be.true();
                exec.run.secondCall.args[1].includes("remove").should.be.true();
                done();
            }).catch(done);
        });

        describe("allowUpdate lists", function() {
            it("rejects when update requested with allowUpdate set to false", function(done) {
                installer.init({ externalModules: { palette: { allowUpdate: false } } })
                sinon.stub(typeRegistry,"getModuleInfo").callsFake(function() {
                    return {
                        user: true,
                        version: "0.1.1"
                    }
                });
                installer.installModule("this_wont_exist","0.1.2").catch(function(err) {
                    err.code.should.be.eql('update_not_allowed');
                    done();
                }).catch(done);
            })
            it("succeeds when update requested with module not on denyUpdateList", function(done) {
                installer.init({ externalModules: { palette: { denyUpdateList: ['this_wont_exist'] } } })
                sinon.stub(typeRegistry,"getModuleInfo").callsFake(function() {
                    return {
                        user: true,
                        version: "0.1.1"
                    }
                });

                var res = {
                    code: 0,
                    stdout:"",
                    stderr:""
                }
                var p = Promise.resolve(res);
                p.catch((err)=>{});
                execResponse = p;

                var nodeInfo = {nodes:{module:"this_is_allowed",types:["a"]}};

                var addModule = sinon.stub(registry,"addModule").callsFake(function(md) {
                    return Promise.resolve(nodeInfo);
                });
                sinon.stub(typeRegistry,"setModulePendingUpdated").callsFake(function() {
                    return Promise.resolve(nodeInfo);
                });

                installer.installModule("this_is_allowed","0.1.2").then(function() {
                    done();
                }).catch(done);
            })
            it("rejects when update requested with module on denyUpdateList", function(done) {
                installer.init({ externalModules: { palette: { denyUpdateList: ['this_wont_exist'] } } })
                sinon.stub(typeRegistry,"getModuleInfo").callsFake(function() {
                    return {
                        user: true,
                        version: "0.1.1"
                    }
                });

                var res = {
                    code: 0,
                    stdout:"",
                    stderr:""
                }
                var p = Promise.resolve(res);
                p.catch((err)=>{});
                execResponse = p;

                var nodeInfo = {nodes:{module:"this_is_allowed",types:["a"]}};

                var addModule = sinon.stub(registry,"addModule").callsFake(function(md) {
                    return Promise.resolve(nodeInfo);
                });
                sinon.stub(typeRegistry,"setModulePendingUpdated").callsFake(function() {
                    return Promise.resolve(nodeInfo);
                });

                installer.installModule("this_wont_exist","0.1.2").catch(function(err) {
                    err.code.should.be.eql('update_not_allowed');
                    done();
                }).catch(done);
            })
            it("succeeds when update requested with module on allowUpdateList", function(done) {
                installer.init({ externalModules: { palette: { allowUpdateList: ['this_is_allowed'] } } })
                sinon.stub(typeRegistry,"getModuleInfo").callsFake(function() {
                    return {
                        user: true,
                        version: "0.1.1"
                    }
                });

                var res = {
                    code: 0,
                    stdout:"",
                    stderr:""
                }
                var p = Promise.resolve(res);
                p.catch((err)=>{});
                execResponse = p;

                var nodeInfo = {nodes:{module:"this_is_allowed",types:["a"]}};

                var addModule = sinon.stub(registry,"addModule").callsFake(function(md) {
                    return Promise.resolve(nodeInfo);
                });
                sinon.stub(typeRegistry,"setModulePendingUpdated").callsFake(function() {
                    return Promise.resolve(nodeInfo);
                });

                installer.installModule("this_is_allowed","0.1.2").then(function() {
                    done();
                }).catch(done);
            })
            it("rejects when update requested with module not on allowUpdateList", function(done) {
            installer.init({ externalModules: { palette: { allowUpdateList: ['this_is_allowed'] } } })
            sinon.stub(typeRegistry,"getModuleInfo").callsFake(function() {
                return {
                    user: true,
                    version: "0.1.1"
                }
            });

            var res = {
                code: 0,
                stdout:"",
                stderr:""
            }
            var p = Promise.resolve(res);
            p.catch((err)=>{});
            execResponse = p;

            var nodeInfo = {nodes:{module:"this_wont_exist",types:["a"]}};

            var addModule = sinon.stub(registry,"addModule").callsFake(function(md) {
                return Promise.resolve(nodeInfo);
            });
            sinon.stub(typeRegistry,"setModulePendingUpdated").callsFake(function() {
                return Promise.resolve(nodeInfo);
            });

            installer.installModule("this_wont_exist","0.1.2").catch(function(err) {
                err.code.should.be.eql('update_not_allowed');
                done();
            }).catch(done);
        })
        });
    });
    describe("credentials of the install URL (#63)", function() {
        var sandbox;
        var LOG_METHODS = ["log", "debug", "trace", "warn", "info", "error"];

        beforeEach(function() {
            sandbox = sinon.createSandbox();
            LOG_METHODS.forEach(m => sandbox.stub(log, m));
            // the values of the interpolation are part of the text, as in the real catalog
            sandbox.stub(log, "_").callsFake((key, params) => key + " " + JSON.stringify(params || {}));
        });
        afterEach(function() {
            sandbox.restore();
        });

        function failNpm(stderr) {
            var p = Promise.reject({ code: 1, stdout: "", stderr: stderr });
            p.catch(() => {});
            execResponse = p;
        }
        function logged(methods) {
            return (methods || LOG_METHODS).map(m => log[m].args.map(a => JSON.stringify(a))).reduce((a, b) => a.concat(b), []);
        }
        function secretsOfRun() {
            return exec.run.firstCall.args[4];
        }
        function install() {
            return installer.installModule.apply(installer, arguments).then(
                () => { throw new Error("should have failed"); }, err => err);
        }

        describe("B2-AC-4 npm fails with the URL in its output", function() {
            it("a password in the URL is not in trace, warn or the other lines; the URL is shown masked", async function() {
                failNpm("npm ERR! fetch https://user:s3cret@host.example/x.tgz failed; auth user:s3cret; p@ss1");
                var err = await install("x", null, "https://user:s3cret@host.example/x.tgz");
                logged().join("\n").should.not.containEql("s3cret");
                JSON.stringify([err.message, err.stack]).should.not.containEql("s3cret");
                var warned = logged(["warn"]).join("\n");
                warned.should.containEql("https://***@host.example/x.tgz");
                // the trace line of the npm command names the masked URL
                logged(["trace"]).join("\n").should.containEql("https://***@host.example/x.tgz");
            });

            it("the literal secrets of the URL go to exec.run for the event-log (user info and password)", async function() {
                failNpm("npm ERR! auth user:s3cret");
                await install("x", null, "https://user:s3cret@host.example/x.tgz");
                exec.run.callCount.should.equal(1);
                var secrets = secretsOfRun();
                should(secrets).be.an.Array();
                secrets.should.containEql("user:s3cret");
                secrets.should.containEql("s3cret");
                // the other arguments of exec.run are as before
                exec.run.firstCall.args[0].should.equal(process.execPath);
                exec.run.firstCall.args[2].should.have.property("cwd");
                exec.run.firstCall.args[3].should.equal(true);
            });

            it("an encoded password: the encoded and the decoded forms are hidden and passed as secrets", async function() {
                failNpm("npm ERR! fetch https://user:p%40ss1@host.example/x.tgz failed; auth user:p@ss1; p@ss1; p%40ss1");
                await install("x", null, "https://user:p%40ss1@host.example/x.tgz");
                var text = logged().join("\n");
                text.should.not.containEql("p%40ss1");
                text.should.not.containEql("p@ss1");
                logged(["warn"]).join("\n").should.containEql("https://***@host.example/x.tgz");
                var secrets = secretsOfRun();
                secrets.should.containEql("user:p%40ss1");
                secrets.should.containEql("p%40ss1");
                secrets.should.containEql("user:p@ss1");
                secrets.should.containEql("p@ss1");
            });

            it("a token as the user info is hidden and passed as a secret", async function() {
                failNpm("npm ERR! fetch https://ghp_t0k3nvalue@host.example/x.tgz failed; token ghp_t0k3nvalue");
                await install("x", null, "https://ghp_t0k3nvalue@host.example/x.tgz");
                logged().join("\n").should.not.containEql("t0k3nvalue");
                secretsOfRun().should.containEql("ghp_t0k3nvalue");
            });

            it("a git+https URL with a password is treated the same way", async function() {
                failNpm("npm ERR! git clone git+https://user:s3cret@host.example/o/x.git");
                await install("x", null, "git+https://user:s3cret@host.example/o/x.git");
                logged().join("\n").should.not.containEql("s3cret");
                secretsOfRun().should.containEql("s3cret");
            });
        });

        describe("B2-AC-4 a URL that is refused", function() {
            it("ftp:// with a password: the warning has no password", async function() {
                var err = await install("x", null, "ftp://user:s3cret@h/x.tgz");
                err.code.should.equal("invalid_module_url");
                logged().join("\n").should.not.containEql("s3cret");
                // the warning is written, and names the masked address
                log.warn.called.should.be.true();
                logged(["warn"]).join("\n").should.containEql("ftp://***@h/x.tgz");
                exec.run.called.should.be.false();
            });
        });

        describe("B2-AC-4 unchanged behaviour: no credentials, a short password", function() {
            it("a URL without credentials is logged as it is and no secret is passed", async function() {
                failNpm("npm ERR! fetch https://host.example/x.tgz failed");
                await install("x", null, "https://host.example/x.tgz");
                (secretsOfRun() || []).should.have.length(0);
                logged(["trace"]).join("\n").should.containEql("https://host.example/x.tgz");
                logged(["warn"]).join("\n").should.containEql("https://host.example/x.tgz failed");
            });

            it("an ssh user without a password is logged as it is and no secret is passed", async function() {
                failNpm("npm ERR! git clone git+ssh://git@host.example/o/x.git");
                await install("x", null, "git+ssh://git@host.example/o/x.git");
                (secretsOfRun() || []).should.have.length(0);
                logged(["trace"]).join("\n").should.containEql("git+ssh://git@host.example/o/x.git");
                logged(["warn"]).join("\n").should.containEql("git+ssh://git@host.example/o/x.git");
            });

            it("a password shorter than 4 characters is hidden by the pattern only; it is not passed as a secret", async function() {
                failNpm("npm ERR! fetch https://user:abc@host.example/x.tgz failed");
                await install("x", null, "https://user:abc@host.example/x.tgz");
                (secretsOfRun() || []).forEach(function(secret) {
                    secret.length.should.be.aboveOrEqual(4);
                });
                (secretsOfRun() || []).should.not.containEql("abc");
                var text = logged().join("\n");
                text.should.not.containEql("user:abc@");
                logged(["warn"]).join("\n").should.containEql("https://***@host.example/x.tgz failed");
            });
        });

        describe("#63 a hook error and the arguments that a hook adds (the text of a hook is not trusted to be free of secrets)", function() {
            const URL = "https://user:s3cret@host.example/x.tgz";

            ["preInstall", "postInstall"].forEach(function(hook) {
                it("the error of a " + hook + " hook that names the install URL is logged masked", async function() {
                    hooks.add(hook + ".t63", function(event) {
                        throw new Error("hook failed for " + URL + " (user:s3cret)");
                    });
                    var err = await install("x", null, URL);
                    should.exist(err);
                    logged().join("\n").should.not.containEql("s3cret");
                    // the warning is there, with the address in its masked form
                    logged(["warn"]).join("\n").should.containEql("https://***@host.example/x.tgz");
                });
            });

            [
                ["--//registry.example/:_authToken=NpmTok3nValue", "NpmTok3nValue"],
                ["_authToken=NpmTok3nValue", "NpmTok3nValue"],
                ["--//registry.example/:_auth=Ab12CdEfGh", "Ab12CdEfGh"],
                ["--//registry.example/:_password=Pa55w0rdValue", "Pa55w0rdValue"]
            ].forEach(function(entry) {
                it("the trace of the npm arguments masks the value of " + entry[0].replace(entry[1], "<value>"), async function() {
                    hooks.add("preInstall.t63", function(event) {
                        event.args = event.args.concat([entry[0]]);
                    });
                    failNpm("npm ERR! failed");
                    await install("x");
                    exec.run.callCount.should.equal(1);
                    // npm still gets the argument as the hook gave it
                    exec.run.firstCall.args[1].should.containEql(entry[0]);
                    var traced = logged(["trace"]).join("\n");
                    traced.should.not.containEql(entry[1]);
                    // the rest of the line is there
                    traced.should.containEql("install");
                    traced.should.containEql(entry[0].split("=")[0]);
                });
            });

            it("REV2-L2: the value of a token argument that a hook adds is passed to exec.run as a secret for the event-log", async function() {
                hooks.add("preInstall.t63", function(event) {
                    event.args = event.args.concat(["--//registry.example/:_authToken=NpmTok3nValue"]);
                });
                failNpm("npm ERR! failed");
                await install("x");
                exec.run.callCount.should.equal(1);
                var secrets = secretsOfRun();
                should(secrets).be.an.Array();
                secrets.should.containEql("NpmTok3nValue");
            });

            it("REV2-L1: the output of npm that echoes the value of a token argument is logged masked", async function() {
                hooks.add("preInstall.t63", function(event) {
                    event.args = event.args.concat(["--//registry.example/:_authToken=NpmTok3nValue"]);
                });
                failNpm("npm ERR! config //registry.example/:_authToken=NpmTok3nValue rejected; token NpmTok3nValue is not valid");
                await install("x");
                var warned = logged(["warn"]).join("\n");
                warned.should.not.containEql("NpmTok3nValue");
                // the output itself is logged
                warned.should.containEql("npm ERR!");
                logged().join("\n").should.not.containEql("NpmTok3nValue");
            });

            it("the trace of arguments without a secret is unchanged", async function() {
                hooks.add("preInstall.t63", function(event) {
                    event.args = event.args.concat(["--registry=https://registry.example/", "--loglevel=warn"]);
                });
                failNpm("npm ERR! failed");
                await install("x");
                var traced = logged(["trace"]).join("\n");
                traced.should.containEql("--registry=https://registry.example/");
                traced.should.containEql("--loglevel=warn");
            });
        });

        describe("B2-AC-7 a module that is a URL with credentials", function() {
            it("given without a url (the path branch): no log line has the password", async function() {
                var err = await install("https://user:s3cret@host.example/x");
                should.exist(err);
                logged().join("\n").should.not.containEql("s3cret");
                JSON.stringify([err.message, err.stack]).should.not.containEql("s3cret");
            });

            it("with a url of its own: the info and trace lines that name the module show it masked", async function() {
                failNpm("npm ERR! something about user:s3cret failed");
                await install("https://user:s3cret@host.example/x", null, "https://host.example/x.tgz");
                logged().join("\n").should.not.containEql("s3cret");
                // the module is named in the lines (it is not left out)
                logged(["info"]).join("\n").should.containEql("https://***@host.example/x");
            });

            it("a failed npm install of such a module: the failure warning shows it masked", async function() {
                failNpm("npm ERR! install of https://user:s3cret@host.example/x failed");
                await install("https://user:s3cret@host.example/x", null, "https://host.example/x.tgz");
                logged(["warn"]).join("\n").should.not.containEql("s3cret");
                logged(["warn"]).join("\n").should.containEql("https://***@host.example/x");
            });
        });
    });
    describe("uninstalls module", function() {
        it("rejects invalid module names", function(done) {
            var promises = [];
            var rejectedCount = 0;

            promises.push(installer.uninstallModule("this_wont_exist ").catch(() => {rejectedCount++}));
            promises.push(installer.uninstallModule("this_wont_exist;no_it_really_wont").catch(() => {rejectedCount++}));
            Promise.all(promises).then(function() {
                rejectedCount.should.eql(2);
                done();
            }).catch(done);
        });

        it("rejects with generic error", function(done) {
            var nodeInfo = [{module:"foo",types:["a"]}];
            var removeModule = sinon.stub(registry,"removeModule").callsFake(function(md) {
                return Promise.resolve(nodeInfo);
            });
            var res = {
                code: 1,
                stdout:"",
                stderr:"error"
            }
            var p = Promise.reject(res);
            p.catch((err)=>{});
            execResponse = p;

            installer.uninstallModule("this_wont_exist").then(function() {
                done(new Error("Unexpected success"));
            }).catch(err => {
                // Expected result
                done()
            });
        });
        it("succeeds when module is found", function(done) {
            var nodeInfo = [{module:"foo",types:["a"]}];
            var removeModule = sinon.stub(typeRegistry,"removeModule").callsFake(function(md) {
                return nodeInfo;
            });
            let removePluginModule = sinon.stub(pluginRegistry,"removeModule").callsFake(function(md) {
                return [];
            });
            var getModuleInfo = sinon.stub(registry,"getModuleInfo").callsFake(function(md) {
                return {nodes:[]};
            });
            var res = {
                code: 0,
                stdout:"",
                stderr:""
            }
            var p = Promise.resolve(res);
            p.catch((err)=>{});
            execResponse = p;

            sinon.stub(fs,"statSync").callsFake(function(fn) { return {}; });

            installer.uninstallModule("this_wont_exist").then(function(info) {
                info.should.eql(nodeInfo);
                // commsMessages.should.have.length(1);
                // commsMessages[0].topic.should.equal("node/removed");
                // commsMessages[0].msg.should.eql(nodeInfo);
                done();
            }).catch(done);
        });
    });
});
