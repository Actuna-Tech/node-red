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
 *   Z-02: test of publicRoute() in the stubbed admin api
 *   Z-10: order of the start and stop of the coordination
 *   E-02: the instance state on start and stop, RED.stop(reason)
 *   Z-08: the health probes follow the start and stop of the runtime
 *   Z-11: readOnlyUserDir - effective settings and the log at start
 *   Z-09: the observer of storage (watchFlows) registered before the flows are
 *   read, a failed registration fails the start, unregistered on stop
 *   #8: the hold of the requests to the routes of the nodes is mounted on the
 *   httpNode app only with deploy.holdHttpNodeRequests.enabled
 *   #7: the `hooks` setting is registered by init()
 *   #3: the generated instanceId (an undefined value of settings.js, a failed save)
 *   and the warning for a generated id with a coordination plugin of a cluster
 * This notice is required by section 4(b) of the Apache License 2.0.
 */
var should = require("should");
var sinon = require("sinon");
var path = require("path");

var NR_TEST_UTILS = require("nr-test-utils");

var api = NR_TEST_UTILS.require("@node-red/runtime/lib/api");
var runtime = NR_TEST_UTILS.require("@node-red/runtime");

var redNodes = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes");
var storage = NR_TEST_UTILS.require("@node-red/runtime/lib/storage");
var settings = NR_TEST_UTILS.require("@node-red/runtime/lib/settings");
var coordination = NR_TEST_UTILS.require("@node-red/runtime/lib/coordination");
var util = NR_TEST_UTILS.require("@node-red/util");

var log = NR_TEST_UTILS.require("@node-red/util").log;
var i18n = NR_TEST_UTILS.require("@node-red/util").i18n;

describe("runtime", function() {
    afterEach(function() {
        if (console.log.restore) {
            console.log.restore();
        }
    })

    before(function() {
        process.env.NODE_RED_HOME = NR_TEST_UTILS.resolve("node-red");
    });
    after(function() {
        delete process.env.NODE_RED_HOME;
    });
    function mockUtil(metrics) {
        sinon.stub(log,"log").callsFake(function(){})
        sinon.stub(log,"warn").callsFake(function(){})
        sinon.stub(log,"info").callsFake(function(){})
        sinon.stub(log,"trace").callsFake(function(){})
        sinon.stub(log,"metric").callsFake(function(){ return !!metrics })
        sinon.stub(log,"_").callsFake(function(){ return "abc"})
        sinon.stub(i18n,"registerMessageCatalog").callsFake(function(){ return Promise.resolve()})
    }
    function unmockUtil() {
        log.log.restore && log.log.restore();
        log.warn.restore && log.warn.restore();
        log.info.restore && log.info.restore();
        log.trace.restore && log.trace.restore();
        log.metric.restore && log.metric.restore();
        log._.restore && log._.restore();
        i18n.registerMessageCatalog.restore && i18n.registerMessageCatalog.restore();
    }
    describe("init", function() {
        beforeEach(function() {
            sinon.stub(log,"init").callsFake(function() {});
            sinon.stub(settings,"init").callsFake(function() {});
            sinon.stub(redNodes,"init").callsFake(function() {})
            mockUtil();
        });
        afterEach(function() {
            log.init.restore();
            settings.init.restore();
            redNodes.init.restore();
            unmockUtil();
        })

        it("initialises components", function() {
            runtime.init({testSettings: true, httpAdminRoot:"/"});
            settings.init.called.should.be.true();
            redNodes.init.called.should.be.true();
        });

        describe("hooks setting (#7)", function() {
            afterEach(function() {
                util.hooks.clear();
            });
            it("registers the hooks of the setting", function() {
                runtime.init({testSettings: true, httpAdminRoot:"/", hooks: {
                    "preReload.drain": async function(event) {},
                    "preShutdown.drain": async function(event) {}
                }});
                util.hooks.has("preReload").should.be.true();
                util.hooks.has("preShutdown.drain").should.be.true();
                redNodes.init.called.should.be.true();
            });
            it("registers the hooks before the nodes are initialised", function() {
                let registered;
                redNodes.init.callsFake(function() {
                    registered = util.hooks.has("preReload.drain");
                });
                runtime.init({testSettings: true, httpAdminRoot:"/", hooks: {
                    "preReload.drain": async function(event) {}
                }});
                registered.should.be.true();
            });
            it("fails init for an invalid setting, with a code and the key", function() {
                try {
                    runtime.init({testSettings: true, httpAdminRoot:"/", hooks: {
                        "onSend.drain": function(event) {}
                    }});
                } catch(err) {
                    err.should.have.property("code", "invalid_hook_setting");
                    err.message.should.containEql("onSend.drain");
                    redNodes.init.called.should.be.false();
                    util.hooks.has("onSend").should.be.false();
                    return;
                }
                throw new Error("init did not throw");
            });
            it("registers no hooks without the setting", function() {
                runtime.init({testSettings: true, httpAdminRoot:"/"});
                util.hooks.has("preReload").should.be.false();
                util.hooks.has("preShutdown").should.be.false();
            });
            it("removes the hooks of a previous init when the setting is gone", function() {
                runtime.init({testSettings: true, httpAdminRoot:"/", hooks: {
                    "preReload.drain": async function(event) {}
                }});
                util.hooks.has("preReload").should.be.true();
                runtime.init({testSettings: true, httpAdminRoot:"/"});
                util.hooks.has("preReload").should.be.false();
            });
            it("can be initialised twice with the same setting", function() {
                const setting = {"preShutdown.drain": async function(event) {}};
                runtime.init({testSettings: true, httpAdminRoot:"/", hooks: setting});
                (function() {
                    runtime.init({testSettings: true, httpAdminRoot:"/", hooks: setting});
                }).should.not.throw();
                util.hooks.has("preShutdown.drain").should.be.true();
            });
        });

        it("stubbed adminApi.auth provides publicRoute", function(done) {
            runtime.init({testSettings: true, httpAdminRoot: false});
            const auth = runtime._.adminApi.auth;
            auth.needsPermission("foo").should.be.a.Function();
            auth.publicRoute()({},{},done);
        });

        describe("deploy.holdHttpNodeRequests (#8)", function() {
            const request = require("supertest");
            const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
            const httpHold = NR_TEST_UTILS.require("@node-red/runtime/lib/httpHold");
            beforeEach(function() {
                instanceState.reset();
                instanceState.markStarting();
                instanceState.report({ errors: [] });
            });
            afterEach(function() {
                httpHold.dispose();
                instanceState.reset();
            });
            function removeRoute(path) {
                const stack = runtime._.nodeApp._router.stack;
                stack.splice(0, stack.length, ...stack.filter(layer => !(layer.route && layer.route.path === path)));
            }
            it("holds the requests of the httpNode app for a route that is missing during a deployment when enabled", async function() {
                runtime.init({testSettings: true, httpAdminRoot:"/", deploy: { holdHttpNodeRequests: { enabled: true, timeout: 50 } }});
                runtime._.nodeApp.get("/hello", (req, res) => res.send("hello"));
                (await request(runtime.httpNode).get("/hello")).text.should.equal("hello");
                instanceState.begin("deploy");
                // the route of the node is removed while the node restarts
                removeRoute("/hello");
                const res = await request(runtime.httpNode).get("/hello");
                res.status.should.equal(503);
                res.headers["retry-after"].should.equal("1");
            });
            it("does not hold the requests of the httpNode app for a route that exists during a deployment and a reload", async function() {
                runtime.init({testSettings: true, httpAdminRoot:"/", deploy: { holdHttpNodeRequests: { enabled: true, timeout: 50 } }});
                runtime._.nodeApp.get("/hello", (req, res) => res.send("hello"));
                instanceState.begin("deploy");
                const start = Date.now();
                (await request(runtime.httpNode).get("/hello")).text.should.equal("hello");
                (Date.now() - start).should.be.below(40);
                httpHold.pending().should.equal(0);
                instanceState.reset();
                instanceState.markStarting();
                instanceState.report({ errors: [] });
                instanceState.markReloadPending();
                instanceState.markDraining();
                instanceState.begin("reload");
                (await request(runtime.httpNode).get("/hello")).text.should.equal("hello");
                httpHold.pending().should.equal(0);
            });
            it("does not change the httpNode app when the setting is off", async function() {
                runtime.init({testSettings: true, httpAdminRoot:"/"});
                runtime._.nodeApp.get("/hello", (req, res) => res.send("hello"));
                instanceState.begin("deploy");
                (await request(runtime.httpNode).get("/hello")).text.should.equal("hello");
                (await request(runtime.httpNode).get("/missing")).status.should.equal(404);
            });
            it("the admin app is not held", async function() {
                runtime.init({testSettings: true, httpAdminRoot:"/", deploy: { holdHttpNodeRequests: { enabled: true, timeout: 50 } }});
                runtime.httpAdmin.get("/admin-probe", (req, res) => res.send("admin"));
                instanceState.begin("deploy");
                (await request(runtime.httpAdmin).get("/admin-probe")).text.should.equal("admin");
            });
        });

        it("returns version", function() {
            runtime.init({testSettings: true, httpAdminRoot:"/"});
            return runtime.version().then(version => {
                /^\d+\.\d+\.\d+(-.*)?$/.test(version).should.be.true();
            });


        })
    });

    describe("start",function() {
        var storageInit;
        var settingsLoad;
        var redNodesInit;
        var redNodesLoad;
        var redNodesCleanModuleList;
        var redNodesGetNodeList;
        var redNodesLoadFlows;
        var redNodesStartFlows;
        var redNodesLoadContextsPlugin;

        beforeEach(function() {
            storageInit = sinon.stub(storage,"init").callsFake(function(settings) {return Promise.resolve();});
            redNodesInit = sinon.stub(redNodes,"init").callsFake(function() {});
            redNodesLoad = sinon.stub(redNodes,"load").callsFake(function() {return Promise.resolve()});
            redNodesCleanModuleList = sinon.stub(redNodes,"cleanModuleList").callsFake(function(){});
            redNodesLoadFlows = sinon.stub(redNodes,"loadFlows").callsFake(function() {return Promise.resolve()});
            redNodesStartFlows = sinon.stub(redNodes,"startFlows").callsFake(function() {});
            redNodesLoadContextsPlugin = sinon.stub(redNodes,"loadContextsPlugin").callsFake(function() {return Promise.resolve()});
            mockUtil();
        });
        afterEach(function() {
            storageInit.restore();
            redNodesInit.restore();
            redNodesLoad.restore();
            redNodesGetNodeList.restore();
            redNodesCleanModuleList.restore();
            redNodesLoadFlows.restore();
            redNodesStartFlows.restore();
            redNodesLoadContextsPlugin.restore();
            unmockUtil();
        });
        it("reports errored/missing modules",function(done) {
            redNodesGetNodeList = sinon.stub(redNodes,"getNodeList").callsFake(function(cb) {
                return [
                    {  err:"errored",name:"errName" }, // error
                    {  module:"module",enabled:true,loaded:false,types:["typeA","typeB"]} // missing
                ].filter(cb);
            });
            runtime.init({testSettings: true, httpAdminRoot:"/", load:function() { return Promise.resolve();}});
            // sinon.stub(console,"log");
            runtime.start().then(function() {
                // console.log.restore();
                try {
                    storageInit.calledOnce.should.be.true();
                    redNodesInit.calledOnce.should.be.true();
                    redNodesLoad.calledOnce.should.be.true();
                    redNodesLoadFlows.calledOnce.should.be.true();

                    log.warn.calledWithMatch("Failed to register 1 node type");
                    log.warn.calledWithMatch("Missing node modules");
                    log.warn.calledWithMatch(" - module: typeA, typeB");
                    redNodesCleanModuleList.calledOnce.should.be.true();
                    done();
                } catch(err) {
                    done(err);
                }
            }).catch(err=>{done(err)});
        });
        it("initiates load of missing modules",function(done) {
            redNodesGetNodeList = sinon.stub(redNodes,"getNodeList").callsFake(function(cb) {
                return [
                    {  err:"errored",name:"errName" }, // error
                    {  err:"errored",name:"errName" }, // error
                    {  module:"module",enabled:true,loaded:false,types:["typeA","typeB"]}, // missing
                    {  module:"node-red",enabled:true,loaded:false,types:["typeC","typeD"]} // missing
                ].filter(cb);
            });
            var serverInstallModule = sinon.stub(redNodes,"installModule").callsFake(function(name) { return Promise.resolve({nodes:[]});});
            runtime.init({testSettings: true, autoInstallModules:true, httpAdminRoot:"/", load:function() { return Promise.resolve();}});
            sinon.stub(console,"log");
            runtime.start().then(function() {
                console.log.restore();
                try {
                    log.warn.calledWithMatch("Failed to register 2 node types");
                    log.warn.calledWithMatch("Missing node modules");
                    log.warn.calledWithMatch(" - module: typeA, typeB");
                    log.warn.calledWithMatch(" - node-red: typeC, typeD");
                    redNodesCleanModuleList.calledOnce.should.be.false();
                    serverInstallModule.calledOnce.should.be.true();
                    serverInstallModule.calledWithMatch("module");
                    done();
                } catch(err) {
                    done(err);
                } finally {
                    serverInstallModule.restore();
                }
            }).catch(err=>{done(err)});
        });
        it("reports errored modules when verbose is enabled",function(done) {
            redNodesGetNodeList = sinon.stub(redNodes,"getNodeList").callsFake(function(cb) {
                return [
                    {  err:"errored",name:"errName" } // error
                ].filter(cb);
            });
            runtime.init({testSettings: true, verbose:true, httpAdminRoot:"/", load:function() { return Promise.resolve();}});
            sinon.stub(console,"log");
            runtime.start().then(function() {
                console.log.restore();
                try {
                    log.warn.neverCalledWithMatch("Failed to register 1 node type");
                    log.warn.calledWithMatch("[errName] errored");
                    done();
                } catch(err) {
                    done(err);
                }
            }).catch(err=>{done(err)});
        });

        it("coordination started before startFlows", async function() {
            redNodesGetNodeList = sinon.stub(redNodes,"getNodeList").callsFake(function() {return []});
            let resolveStart;
            const coordStart = sinon.stub(coordination,"start").callsFake(function() {
                return new Promise(resolve => { resolveStart = resolve });
            });
            try {
                runtime.init({testSettings: true, httpAdminRoot:"/", load:function() { return Promise.resolve();}});
                const started = runtime.start();
                await new Promise(resolve => setTimeout(resolve, 50));
                coordStart.calledOnce.should.be.true();
                coordStart.firstCall.args[0].should.equal(runtime._);
                redNodesLoadContextsPlugin.called.should.be.true();
                redNodesLoadFlows.called.should.be.false();
                redNodesStartFlows.called.should.be.false();
                resolveStart();
                await started;
                await new Promise(resolve => setImmediate(resolve));
                redNodesLoadFlows.calledOnce.should.be.true();
                redNodesStartFlows.calledOnce.should.be.true();
                sinon.assert.callOrder(redNodesLoadContextsPlugin, coordStart, redNodesLoadFlows, redNodesStartFlows);
            } finally {
                coordStart.restore();
            }
        });

        it("coordination start failure fails the start without starting flows", async function() {
            redNodesGetNodeList = sinon.stub(redNodes,"getNodeList").callsFake(function() {return []});
            const coordStart = sinon.stub(coordination,"start").callsFake(function() {
                const err = new Error("not found");
                err.code = "coordination.plugin-not-found";
                return Promise.reject(err);
            });
            try {
                runtime.init({testSettings: true, httpAdminRoot:"/", load:function() { return Promise.resolve();}});
                const err = await runtime.start().should.be.rejected();
                err.code.should.equal("coordination.plugin-not-found");
                redNodesLoadFlows.called.should.be.false();
            } finally {
                coordStart.restore();
            }
        });

        describe("reload from storage (Z-09)", function() {
            let hasWatch;
            let watch;
            let unwatch;
            beforeEach(function() {
                redNodesGetNodeList = sinon.stub(redNodes,"getNodeList").callsFake(function() {return []});
                unwatch = sinon.spy(async function() {});
                hasWatch = sinon.stub(storage,"hasWatchFlows").callsFake(() => true);
                watch = sinon.stub(storage,"watchFlows").callsFake(async function() { return unwatch });
            });
            afterEach(function() {
                hasWatch.restore();
                watch.restore();
            });
            it("watchFlows registered before first loadFlows", async function() {
                runtime.init({testSettings: true, httpAdminRoot:"/", deploy: {reload: {watch: true}}, load:function() { return Promise.resolve();}});
                await runtime.start();
                await new Promise(resolve => setImmediate(resolve));
                watch.calledOnce.should.be.true();
                sinon.assert.callOrder(storageInit, watch, redNodesLoadFlows);
            });
            it("storage without watchFlows - no watcher", async function() {
                hasWatch.restore();
                hasWatch = sinon.stub(storage,"hasWatchFlows").callsFake(() => false);
                runtime.init({testSettings: true, httpAdminRoot:"/", deploy: {reload: {watch: true}}, load:function() { return Promise.resolve();}});
                await runtime.start();
                watch.called.should.be.false();
            });
            it("watch not enabled - watchFlows not called", async function() {
                runtime.init({testSettings: true, httpAdminRoot:"/", load:function() { return Promise.resolve();}});
                await runtime.start();
                watch.called.should.be.false();
            });
            it("watchFlows registration failure fails the start (R-36)", async function() {
                watch.restore();
                watch = sinon.stub(storage,"watchFlows").callsFake(async function() { throw new Error("cannot watch") });
                sinon.stub(log,"error").callsFake(function(){});
                try {
                    runtime.init({testSettings: true, httpAdminRoot:"/", deploy: {reload: {watch: true}}, load:function() { return Promise.resolve();}});
                    await runtime.start().should.be.rejectedWith("cannot watch");
                    redNodesLoadFlows.called.should.be.false();
                } finally {
                    log.error.restore();
                }
            });
            it("unwatch called on stop", async function() {
                const stopFlows = sinon.stub(redNodes,"stopFlows").callsFake(function() { return Promise.resolve();} );
                try {
                    runtime.init({testSettings: true, httpAdminRoot:"/", deploy: {reload: {watch: true}}, load:function() { return Promise.resolve();}});
                    await runtime.start();
                    await runtime.stop();
                    unwatch.calledOnce.should.be.true();
                    sinon.assert.callOrder(unwatch, stopFlows);
                } finally {
                    stopFlows.restore();
                }
            });
        });

        it("reports runtime metrics",function(done) {
            var stopFlows = sinon.stub(redNodes,"stopFlows").callsFake(function() { return Promise.resolve();} );
            redNodesGetNodeList = sinon.stub(redNodes,"getNodeList").callsFake(function() {return []});
            unmockUtil();
            mockUtil(true);
            runtime.init(
                {testSettings: true, runtimeMetricInterval:200, httpAdminRoot:"/", load:function() { return Promise.resolve();}},
                {},
                undefined);
            // sinon.stub(console,"log");
            runtime.start().then(function() {
                // console.log.restore();
                setTimeout(function() {
                    try {
                        log.log.args.should.have.lengthOf(3);
                        log.log.args[0][0].should.have.property("event","runtime.memory.rss");
                        log.log.args[1][0].should.have.property("event","runtime.memory.heapTotal");
                        log.log.args[2][0].should.have.property("event","runtime.memory.heapUsed");
                        done();
                    } catch(err) {
                        done(err);
                    } finally {
                        runtime.stop();
                        stopFlows.restore();
                    }
                },300);
            }).catch(err=>{done(err)});
        });


    });

    it("resign called before stopFlows, coordination stopped after stopFlows", async function() {
        const stopFlows = sinon.stub(redNodes,"stopFlows").callsFake(function() { return Promise.resolve();} );
        const closeContextsPlugin = sinon.stub(redNodes,"closeContextsPlugin").callsFake(function() { return Promise.resolve();} );
        const resign = sinon.stub(coordination,"resign").callsFake(function() { return Promise.resolve();} );
        const coordStop = sinon.stub(coordination,"stop").callsFake(function() { return Promise.resolve();} );
        try {
            await runtime.stop();
            resign.calledOnce.should.be.true();
            coordStop.calledOnce.should.be.true();
            sinon.assert.callOrder(resign, stopFlows, coordStop, closeContextsPlugin);
        } finally {
            stopFlows.restore();
            closeContextsPlugin.restore();
            resign.restore();
            coordStop.restore();
        }
    });

    it("stops components", function(done) {
        var stopFlows = sinon.stub(redNodes,"stopFlows").callsFake(function() { return Promise.resolve();} );
        var closeContextsPlugin = sinon.stub(redNodes,"closeContextsPlugin").callsFake(function() { return Promise.resolve();} );
        runtime.stop().then(function(){
            stopFlows.called.should.be.true();
            closeContextsPlugin.called.should.be.true();
            stopFlows.restore();
            closeContextsPlugin.restore();
            done();
        }).catch(function(err){
            stopFlows.restore();
            closeContextsPlugin.restore();
            return done(err)
        });
    });
    describe("instance state (E-02)", function() {
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        let stubs;
        let seen;
        let off;
        beforeEach(function() {
            instanceState.reset();
            seen = [];
            off = instanceState.onChange(info => seen.push(info));
            stubs = [
                sinon.stub(storage,"init").callsFake(function() {return Promise.resolve();}),
                sinon.stub(redNodes,"init").callsFake(function() {}),
                sinon.stub(redNodes,"load").callsFake(function() {return Promise.resolve()}),
                sinon.stub(redNodes,"cleanModuleList").callsFake(function(){}),
                sinon.stub(redNodes,"getNodeList").callsFake(function() {return []}),
                sinon.stub(redNodes,"loadContextsPlugin").callsFake(function() {return Promise.resolve()})
            ];
            mockUtil();
        });
        afterEach(function() {
            off();
            stubs.forEach(s => s.restore());
            unmockUtil();
            instanceState.reset();
        });
        function stub(obj, name, fn) {
            const s = sinon.stub(obj, name).callsFake(fn);
            stubs.push(s);
            return s;
        }

        it("state is init before start() and starting when start() resolves before the flows started", async function() {
            instanceState.get().state.should.equal("init");
            let finishStart;
            stub(redNodes, "loadFlows", () => Promise.resolve());
            stub(redNodes, "startFlows", () => new Promise(resolve => { finishStart = resolve }));
            runtime.init({testSettings: true, httpAdminRoot:"/"});
            await runtime.start();
            instanceState.get().state.should.equal("starting");
            seen[0].should.containEql({state:"starting", previous:"init"});
            finishStart({errors:[]});
        });

        it("loadFlows rejection sets failed (storage-error) and start() still resolves", async function() {
            const err = new Error("cannot read flows");
            stub(redNodes, "loadFlows", () => Promise.reject(err));
            stub(redNodes, "startFlows", () => Promise.resolve({errors:[]}));
            runtime.init({testSettings: true, httpAdminRoot:"/"});
            await runtime.start();
            await new Promise(resolve => setTimeout(resolve, 10));
            instanceState.get().should.containEql({state:"failed", reason:"storage-error"});
        });

        it("startFlows rejection sets failed (flow-start-failed) without an unhandled rejection", async function() {
            stub(redNodes, "loadFlows", () => Promise.resolve());
            stub(redNodes, "startFlows", () => Promise.reject(new Error("boom")));
            runtime.init({testSettings: true, httpAdminRoot:"/"});
            await runtime.start();
            await new Promise(resolve => setTimeout(resolve, 10));
            instanceState.get().should.containEql({state:"failed", reason:"flow-start-failed"});
        });

        it("a rejected runtime start (storage.init) sets failed (startup-error) and rejects as before", async function() {
            storage.init.restore();
            stubs.shift();
            stub(storage, "init", () => Promise.reject(new Error("no storage")));
            runtime.init({testSettings: true, httpAdminRoot:"/"});
            await runtime.start().should.be.rejectedWith("no storage");
            instanceState.get().should.containEql({state:"failed", reason:"startup-error"});
        });

        it("stop() sets stopping synchronously before stopFlows and stopped after closeContextsPlugin", async function() {
            const order = [];
            stub(redNodes, "stopFlows", () => { order.push("stopFlows:" + instanceState.get().state); return Promise.resolve() });
            stub(redNodes, "closeContextsPlugin", () => { order.push("close:" + instanceState.get().state); return Promise.resolve() });
            const p = runtime.stop();
            instanceState.get().state.should.equal("stopping");
            await p;
            order.should.eql(["stopFlows:stopping", "close:stopping"]);
            instanceState.get().should.containEql({state:"stopped", reason:"stop"});
        });

        it("stop() without a reason uses stop and logs nothing new", async function() {
            stub(redNodes, "stopFlows", () => Promise.resolve());
            stub(redNodes, "closeContextsPlugin", () => Promise.resolve());
            await runtime.stop();
            seen.map(i => i.reason).should.eql(["stop", "stop"]);
            log.info.called.should.be.false();
        });

        it("stop(reason) passes the reason to instance:state and the log (R-23)", async function() {
            const events = NR_TEST_UTILS.require("@node-red/util").events;
            const emitted = [];
            const onEvent = info => emitted.push(info);
            events.on("instance:state", onEvent);
            stub(redNodes, "stopFlows", () => Promise.resolve());
            stub(redNodes, "closeContextsPlugin", () => Promise.resolve());
            try {
                await runtime.stop("SIGTERM");
            } finally {
                events.removeListener("instance:state", onEvent);
            }
            emitted[0].should.containEql({state:"stopping", reason:"SIGTERM"});
            log.info.calledOnce.should.be.true();
            log._.calledWithMatch("runtime.stopping", {reason:"SIGTERM"}).should.be.true();
        });

        it("a failing stop still ends in stopped", async function() {
            stub(redNodes, "stopFlows", () => Promise.reject(new Error("stop failed")));
            stub(redNodes, "closeContextsPlugin", () => Promise.resolve());
            await runtime.stop().should.be.rejectedWith("stop failed");
            instanceState.get().state.should.equal("stopped");
        });

        it("exposes the state on the internal runtime object", function() {
            runtime._.state.should.equal(instanceState);
        });
    });
    describe("health probes (Z-08)", function() {
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        const health = NR_TEST_UTILS.require("@node-red/runtime/lib/health");
        const express = require("express");
        const request = require("supertest");
        const net = require("net");
        let stubs;
        beforeEach(function() {
            instanceState.reset();
            stubs = [
                sinon.stub(storage,"init").callsFake(function() {return Promise.resolve();}),
                sinon.stub(redNodes,"init").callsFake(function() {}),
                sinon.stub(redNodes,"load").callsFake(function() {return Promise.resolve()}),
                sinon.stub(redNodes,"cleanModuleList").callsFake(function(){}),
                sinon.stub(redNodes,"getNodeList").callsFake(function() {return []}),
                sinon.stub(redNodes,"loadContextsPlugin").callsFake(function() {return Promise.resolve()})
            ];
            mockUtil();
        });
        afterEach(async function() {
            stubs.forEach(s => s.restore());
            unmockUtil();
            await health.stop();
            health.init({});
            instanceState.reset();
        });
        function stub(obj, name, fn) {
            const s = sinon.stub(obj, name).callsFake(fn);
            stubs.push(s);
            return s;
        }
        function app() {
            const a = express();
            a.use(runtime._.health.getPath(), runtime._.health.handler);
            return a;
        }

        it("ready 503 when RED.start resolved before the flows started, 200 after", async function() {
            let finishStart;
            stub(redNodes, "loadFlows", () => Promise.resolve());
            stub(redNodes, "startFlows", () => new Promise(resolve => { finishStart = resolve }).then(r => { instanceState.report(r); return r }));
            runtime.init({testSettings: true, httpAdminRoot:"/", health: {enabled: true}});
            await runtime.start();
            (await request(app()).get("/health/ready")).status.should.equal(503);
            (await request(app()).get("/health/live")).status.should.equal(200);
            finishStart({errors: []});
            await new Promise(resolve => setTimeout(resolve, 10));
            (await request(app()).get("/health/ready")).status.should.equal(200);
        });

        it("ready 503 synchronously after stop() is called (slow close)", async function() {
            instanceState.markStarting();
            instanceState.report({errors: []});
            runtime.init({testSettings: true, httpAdminRoot:"/", health: {enabled: true}});
            let finishStop;
            stub(redNodes, "stopFlows", () => new Promise(resolve => { finishStop = resolve }));
            stub(redNodes, "closeContextsPlugin", () => Promise.resolve());
            (await request(app()).get("/health/ready")).status.should.equal(200);
            const stopped = runtime.stop();
            (await request(app()).get("/health/ready")).status.should.equal(503);
            (await request(app()).get("/health/live")).status.should.equal(200);
            finishStop();
            await stopped;
        });

        it("a busy health.port rejects the start with health.port-in-use and sets failed", async function() {
            const blocker = net.createServer();
            await new Promise(resolve => blocker.listen(0, "127.0.0.1", resolve));
            try {
                runtime.init({testSettings: true, httpAdminRoot:"/", health: {enabled: true, port: blocker.address().port, host: "127.0.0.1"}});
                const err = await runtime.start().should.be.rejected();
                err.should.have.property("code", "health.port-in-use");
                instanceState.get().state.should.equal("failed");
                storage.init.called.should.be.false();
            } finally {
                blocker.close();
            }
        });

        it("the own server of the probes is closed when the runtime stopped", async function() {
            const srv = net.createServer();
            await new Promise(resolve => srv.listen(0, "127.0.0.1", resolve));
            const port = srv.address().port;
            await new Promise(resolve => srv.close(resolve));
            stub(redNodes, "loadFlows", () => Promise.resolve());
            stub(redNodes, "startFlows", () => Promise.resolve({errors: []}));
            stub(redNodes, "stopFlows", () => Promise.resolve());
            stub(redNodes, "closeContextsPlugin", () => Promise.resolve());
            runtime.init({testSettings: true, httpAdminRoot:"/", health: {enabled: true, port: port, host: "127.0.0.1"}});
            await runtime.start();
            should.exist(runtime._.health.getServer());
            await runtime.stop();
            should(runtime._.health.getServer()).be.null();
        });

        it("disabled by default - no server", async function() {
            stub(redNodes, "loadFlows", () => Promise.resolve());
            stub(redNodes, "startFlows", () => Promise.resolve({errors: []}));
            runtime.init({testSettings: true, httpAdminRoot:"/"});
            await runtime.start();
            runtime._.health.isEnabled().should.be.false();
            should(runtime._.health.getServer()).be.null();
        });
    });
    describe("readOnlyUserDir (Z-11)", function() {
        let stubs;
        beforeEach(function() {
            stubs = [
                sinon.stub(storage,"init").callsFake(function() {return Promise.resolve();}),
                sinon.stub(redNodes,"init").callsFake(function() {}),
                sinon.stub(redNodes,"load").callsFake(function() {return Promise.resolve()}),
                sinon.stub(redNodes,"cleanModuleList").callsFake(function(){}),
                sinon.stub(redNodes,"getNodeList").callsFake(function() {return []}),
                sinon.stub(redNodes,"loadContextsPlugin").callsFake(function() {return Promise.resolve()}),
                sinon.stub(redNodes,"loadFlows").callsFake(function() {return Promise.resolve()}),
                sinon.stub(redNodes,"startFlows").callsFake(function() {return Promise.resolve({errors:[]})})
            ];
            mockUtil();
        });
        afterEach(function() {
            stubs.forEach(s => s.restore());
            unmockUtil();
            NR_TEST_UTILS.require("@node-red/runtime/lib/state").reset();
        });

        it("disables the features that write and logs one block with warnings for overridden settings", async function() {
            // editorTheme.projects is covered by readOnlyUserDir_spec: an editorTheme key
            // would stay as a getter on the shared runtime settings for later test files
            const userSettings = {testSettings: true, httpAdminRoot:"/", readOnlyUserDir: true,
                externalModules: {autoInstall: true, palette: {allowInstall: true}}};
            runtime.init(userSettings);
            userSettings.externalModules.palette.should.eql({allowInstall: false, allowUpload: false, allowUpdate: false});
            userSettings.externalModules.autoInstall.should.be.false();
            userSettings.externalModules.modules.allowInstall.should.be.false();
            // the runtime settings see the effective values
            settings.externalModules.palette.allowInstall.should.be.false();
            await runtime.start();
            log._.calledWithMatch("readonly-userdir.enabled").should.be.true();
            log._.withArgs("readonly-userdir.setting-overridden").callCount.should.equal(2);
        });

        it("does not install missing modules at start (autoInstall overridden)", async function() {
            redNodes.getNodeList.restore();
            stubs.splice(4, 1);
            stubs.push(sinon.stub(redNodes,"getNodeList").callsFake(function(cb) {
                return [{module:"module",enabled:true,loaded:false,types:["typeA"]}].filter(cb);
            }));
            const installModule = sinon.stub(redNodes,"installModule").callsFake(() => Promise.resolve({nodes:[]}));
            stubs.push(installModule);
            runtime.init({testSettings: true, httpAdminRoot:"/", readOnlyUserDir: true, externalModules: {autoInstall: true}});
            await runtime.start();
            installModule.called.should.be.false();
        });

        it("nothing changes without the setting", async function() {
            const userSettings = {testSettings: true, httpAdminRoot:"/", externalModules: {autoInstall: true}};
            runtime.init(userSettings);
            userSettings.should.eql({testSettings: true, httpAdminRoot:"/", externalModules: {autoInstall: true}, version: userSettings.version});
            await runtime.start();
            log._.calledWithMatch("readonly-userdir.enabled").should.be.false();
        });
    });

    describe("instanceId (#3)", function() {
        let stubs;
        let getSettings;
        let saveSettings;
        let coordStart;
        let coordInfo;
        let seenByCoordination;
        const GENERATED = /^[0-9a-f]{16}$/;

        beforeEach(function() {
            seenByCoordination = undefined;
            getSettings = sinon.stub(storage,"getSettings").callsFake(function() {return Promise.resolve({})});
            saveSettings = sinon.stub(storage,"saveSettings").callsFake(function() {return Promise.resolve()});
            coordInfo = sinon.stub(coordination,"info").callsFake(function() {return {plugin: "local", local: true}});
            coordStart = sinon.stub(coordination,"start").callsFake(function(rt) {
                seenByCoordination = rt.settings.get("instanceId");
                return Promise.resolve();
            });
            stubs = [
                getSettings, saveSettings, coordInfo, coordStart,
                sinon.stub(storage,"init").callsFake(function() {return Promise.resolve();}),
                sinon.stub(redNodes,"init").callsFake(function() {}),
                sinon.stub(redNodes,"load").callsFake(function() {return Promise.resolve()}),
                sinon.stub(redNodes,"cleanModuleList").callsFake(function(){}),
                sinon.stub(redNodes,"getNodeList").callsFake(function() {return []}),
                sinon.stub(redNodes,"loadContextsPlugin").callsFake(function() {return Promise.resolve()}),
                sinon.stub(redNodes,"loadFlows").callsFake(function() {return Promise.resolve()}),
                sinon.stub(redNodes,"startFlows").callsFake(function() {return Promise.resolve({errors:[]})})
            ];
            mockUtil();
        });
        afterEach(function() {
            stubs.forEach(s => s.restore());
            unmockUtil();
            // removes the accessors that settings.init() defined for the keys of the test settings
            settings.reset();
            NR_TEST_UTILS.require("@node-red/runtime/lib/state").reset();
        });

        function generatedWarning() {
            return log._.withArgs("coordination.instance-id-generated");
        }

        it("generates and saves an id when there is none", async function() {
            const userSettings = {testSettings: true, httpAdminRoot:"/"};
            runtime.init(userSettings);
            await runtime.start();
            userSettings.instanceId.should.match(GENERATED);
            saveSettings.calledOnce.should.be.true();
            saveSettings.firstCall.args[0].should.have.property("instanceId", userSettings.instanceId);
            settings.get("instanceId").should.equal(userSettings.instanceId);
        });

        it("keeps the id of the storage", async function() {
            getSettings.callsFake(function() {return Promise.resolve({instanceId: "stored"})});
            const userSettings = {testSettings: true, httpAdminRoot:"/"};
            runtime.init(userSettings);
            await runtime.start();
            userSettings.instanceId.should.equal("stored");
            saveSettings.called.should.be.false();
        });

        it("an explicit id of settings.js wins over the storage and nothing is saved", async function() {
            getSettings.callsFake(function() {return Promise.resolve({instanceId: "stored"})});
            const userSettings = {testSettings: true, httpAdminRoot:"/", instanceId: "cluster-1"};
            runtime.init(userSettings);
            await runtime.start();
            userSettings.instanceId.should.equal("cluster-1");
            settings.get("instanceId").should.equal("cluster-1");
            saveSettings.called.should.be.false();
        });

        it("an undefined value of settings.js (a missing environment variable) does not fail the start and counts as absent", async function() {
            const userSettings = {testSettings: true, httpAdminRoot:"/", instanceId: process.env.NODE_RED_TEST_INSTANCE_ID_NOT_SET};
            userSettings.should.have.property("instanceId", undefined);
            runtime.init(userSettings);
            await runtime.start();
            userSettings.instanceId.should.match(GENERATED);
            settings.get("instanceId").should.equal(userSettings.instanceId);
            // settings.set rejects the keys of settings.js: the generated id stays in memory
            saveSettings.called.should.be.false();
            log._.calledWith("runtime.instance-id-save-failed").should.be.false();
        });

        it("other keys of settings.js that are undefined stay read-only", async function() {
            runtime.init({testSettings: true, httpAdminRoot:"/", credentialSecret: undefined});
            await runtime.start();
            (function() { settings.set("credentialSecret", "x") }).should.throw();
            should.not.exist(settings.get("credentialSecret"));
        });

        it("a failed save logs a warning, keeps the generated id and does not fail the start", async function() {
            saveSettings.callsFake(function() {return Promise.reject(new Error("disk full"))});
            const userSettings = {testSettings: true, httpAdminRoot:"/"};
            runtime.init(userSettings);
            await runtime.start();
            userSettings.instanceId.should.match(GENERATED);
            settings.get("instanceId").should.equal(userSettings.instanceId);
            log._.calledWithMatch("runtime.instance-id-save-failed", {message: "disk full"}).should.be.true();
            log.warn.called.should.be.true();
            redNodes.loadFlows.called.should.be.true();
        });

        it("waits for the save before the start continues", async function() {
            let finishSave;
            saveSettings.callsFake(function() {return new Promise(resolve => { finishSave = resolve })});
            runtime.init({testSettings: true, httpAdminRoot:"/"});
            const started = runtime.start();
            await new Promise(resolve => setTimeout(resolve, 50));
            saveSettings.calledOnce.should.be.true();
            coordStart.called.should.be.false();
            finishSave();
            await started;
            coordStart.calledOnce.should.be.true();
        });

        it("passes the generated id to the coordination", async function() {
            const userSettings = {testSettings: true, httpAdminRoot:"/"};
            runtime.init(userSettings);
            await runtime.start();
            seenByCoordination.should.equal(userSettings.instanceId);
            seenByCoordination.should.match(GENERATED);
        });

        it("passes the generated id to the coordination when settings.js has it undefined", async function() {
            const userSettings = {testSettings: true, httpAdminRoot:"/", instanceId: undefined};
            runtime.init(userSettings);
            await runtime.start();
            seenByCoordination.should.equal(userSettings.instanceId);
            seenByCoordination.should.match(GENERATED);
        });

        it("passes the explicit id to the coordination", async function() {
            runtime.init({testSettings: true, httpAdminRoot:"/", instanceId: "cluster-1"});
            await runtime.start();
            seenByCoordination.should.equal("cluster-1");
        });

        it("warns about a generated id when the coordination is not the local one", async function() {
            coordInfo.callsFake(function() {return {plugin: "cluster", local: false}});
            runtime.init({testSettings: true, httpAdminRoot:"/"});
            await runtime.start();
            generatedWarning().calledOnce.should.be.true();
            generatedWarning().firstCall.args[1].should.eql({plugin: "cluster"});
            log.warn.called.should.be.true();
        });

        it("warns about a generated id of an undefined value of settings.js with a coordination of a cluster", async function() {
            coordInfo.callsFake(function() {return {plugin: "cluster", local: false}});
            runtime.init({testSettings: true, httpAdminRoot:"/", instanceId: undefined});
            await runtime.start();
            generatedWarning().calledOnce.should.be.true();
        });

        it("does not warn when the id is explicit, also with a coordination of a cluster", async function() {
            coordInfo.callsFake(function() {return {plugin: "cluster", local: false}});
            runtime.init({testSettings: true, httpAdminRoot:"/", instanceId: "cluster-1"});
            await runtime.start();
            generatedWarning().called.should.be.false();
        });

        it("does not warn when the id comes from the storage, with a coordination of a cluster", async function() {
            getSettings.callsFake(function() {return Promise.resolve({instanceId: "stored"})});
            coordInfo.callsFake(function() {return {plugin: "cluster", local: false}});
            runtime.init({testSettings: true, httpAdminRoot:"/"});
            await runtime.start();
            generatedWarning().called.should.be.false();
        });

        it("does not warn about a generated id with the local coordination", async function() {
            runtime.init({testSettings: true, httpAdminRoot:"/"});
            await runtime.start();
            generatedWarning().called.should.be.false();
        });
    });
});
