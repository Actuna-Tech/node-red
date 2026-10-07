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
 *   #15: the warning at start for a hook of the `hooks` setting that is never called
 *   #19: supertest bound to 127.0.0.1; a limit of the hold test independent of the machine speed (flaky tests)
 *   #40: the drain of the HTTP requests is mounted on the httpNode app only with
 *   deploy.drainHttpNodeRequests.enabled, after the hold and before rawBodyCapture; RED.stop answers
 *   the requests that are still open
 *   #71: startupTimeout - the limit of runtime.start(); a step that completes after it is ignored and released;
 *   phase B: races, the guard of every step, hostile values, failing releases
 *   #76: a save of the generated instanceId that rejects with a value without text is only a warning
 *   #75: a rejection of the coordination plugin with a value without text is one warning of the coordination,
 *   runtime.stop() and the late release finish
 *   #73: a stop during the start abandons the start attempt (startup_stopped); three #71 tests that pinned the
 *   old behaviour of a stop during a start that hangs are changed on purpose (AC-5, AC-7 of #73)
 *   #73 phase B: a stop at every step and boundary, with and without the limit, the drain, hostile reasons, repeated cycles, installs
 *   #82: the start logs the warning of a drain timeout above 300000 ms once
 *   #84: the first start of the flows during the shutdown drain (the state stopping, RED.stop not yet called) creates no flow
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
            const request = require("nr-test-utils/supertest");
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
                // a long hold: a request that was held would take about 1 s, so the limit below
                // does not depend on the speed of a loaded machine
                runtime.init({testSettings: true, httpAdminRoot:"/", deploy: { holdHttpNodeRequests: { enabled: true, timeout: 1000 } }});
                runtime._.nodeApp.get("/hello", (req, res) => res.send("hello"));
                instanceState.begin("deploy");
                const start = Date.now();
                (await request(runtime.httpNode).get("/hello")).text.should.equal("hello");
                (Date.now() - start).should.be.below(900);
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
    describe("deploy.drainHttpNodeRequests (#40)", function() {
        const EventEmitter = require("events");
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        const httpHold = NR_TEST_UTILS.require("@node-red/runtime/lib/httpHold");
        const httpDrain = NR_TEST_UTILS.require("@node-red/runtime/lib/httpDrain");
        const httpInNode = NR_TEST_UTILS.require("@node-red/nodes/core/network/21-httpin.js");
        const DRAIN = { drainHttpNodeRequests: { enabled: true, timeout: 20000 } };
        const HOLD = { holdHttpNodeRequests: { enabled: true } };
        let stubs;
        beforeEach(function() {
            stubs = [];
            instanceState.reset();
        });
        afterEach(function() {
            stubs.forEach(s => s.restore());
            httpDrain.dispose();
            httpHold.dispose();
            instanceState.reset();
        });
        function stub(obj, name, fn) {
            const s = sinon.stub(obj, name).callsFake(fn);
            stubs.push(s);
            return s;
        }
        // The handlers of the httpNode app in order, with the node module loaded as the runtime does
        function layers(app) {
            // the router of an Express app exists once something is mounted on it
            return app._router ? app._router.stack.map(layer => layer.handle) : [];
        }
        function loadHttpIn(app) {
            httpInNode({ httpNode: app, settings: {}, nodes: { registerType: function() {} }, _: function(k) { return k } });
        }
        function names(app) {
            return layers(app).map(handle => {
                if (handle === httpHold.middleware) { return "hold" }
                if (handle === httpDrain.middleware) { return "drain" }
                return handle.name;
            });
        }
        function fakeRequest(runtimeApp) {
            const req = new EventEmitter();
            req.method = "POST";
            req.complete = true;
            req.route = { stack: [{ handle: Object.assign(function() {}, { [httpDrain.S]: true }) }] };
            const res = new EventEmitter();
            const headers = {};
            Object.assign(res, { statusCode: 200, headersSent: false, writableEnded: false, destroyed: false });
            res.getHeaderNames = () => Object.keys(headers);
            res.setHeader = (name, value) => { headers[name.toLowerCase()] = value };
            res.removeHeader = name => { delete headers[name.toLowerCase()] };
            res.end = function(body) { this.body = body; this.writableEnded = true; this.emit("finish") };
            httpDrain.middleware(req, res, function() {});
            return { req, res };
        }

        it("is not mounted without the setting, with enabled: false and with an invalid setting", function() {
            mockUtil();
            stubs.push({ restore: unmockUtil });
            [undefined, { drainHttpNodeRequests: { enabled: false } }, { drainHttpNodeRequests: "yes" }].forEach(function(deploy) {
                runtime.init({testSettings: true, httpAdminRoot:"/", deploy: deploy});
                httpDrain.isEnabled().should.be.false();
                layers(runtime._.nodeApp).should.not.containEql(httpDrain.middleware);
            });
        });
        it("is mounted on the httpNode app with enabled: true", function() {
            runtime.init({testSettings: true, httpAdminRoot:"/", deploy: DRAIN});
            httpDrain.isEnabled().should.be.true();
            layers(runtime._.nodeApp).should.containEql(httpDrain.middleware);
            layers(runtime.httpAdmin).should.not.containEql(httpDrain.middleware);
        });
        it("AC-84 (#82): the start logs the warning of a timeout above 300000 ms once and changes nothing else", function() {
            const warn = sinon.stub(log, "warn");
            const translate = sinon.stub(log, "_").callsFake((key, params) => key + (params ? " " + JSON.stringify(params) : ""));
            stubs.push({ restore: () => { warn.restore(); translate.restore() } });
            const longWarnings = () => warn.args.map(a => a[0]).filter(m => String(m).indexOf("httpDrain.long-timeout") !== -1);
            runtime.init({testSettings: true, httpAdminRoot:"/", deploy: { drainHttpNodeRequests: { enabled: true, timeout: 600000 } }});
            longWarnings().should.eql(['httpDrain.long-timeout {"timeout":600000,"limit":300000}']);
            httpDrain.isEnabled().should.be.true();
            layers(runtime._.nodeApp).should.containEql(httpDrain.middleware);
            // a timeout that is not large, and no setting: no warning
            warn.resetHistory();
            runtime.init({testSettings: true, httpAdminRoot:"/", deploy: DRAIN});
            runtime.init({testSettings: true, httpAdminRoot:"/"});
            longWarnings().should.eql([]);
        });
        it("a second init without the setting disposes the drain", function() {
            runtime.init({testSettings: true, httpAdminRoot:"/", deploy: DRAIN});
            runtime.init({testSettings: true, httpAdminRoot:"/"});
            httpDrain.isEnabled().should.be.false();
        });
        it("the order is the hold, the drain, then rawBodyCapture of the node module - also after the runtime was initialised again in the same process", function() {
            for (let round = 0; round < 3; round++) {
                runtime.init({testSettings: true, httpAdminRoot:"/", deploy: Object.assign({}, HOLD, DRAIN)});
                const app = runtime._.nodeApp;
                names(app).should.eql(["query", "expressInit", "hold", "drain"]);
                loadHttpIn(app);
                names(app).should.eql(["query", "expressInit", "hold", "drain", "rawBodyCapture"]);
                // the module loaded again on the same app (RED.stop() and RED.start()): the capture keeps its place
                loadHttpIn(app);
                names(app).should.eql(["query", "expressInit", "hold", "drain", "rawBodyCapture"]);
            }
        });
        it("the order without the hold is the drain, then rawBodyCapture", function() {
            runtime.init({testSettings: true, httpAdminRoot:"/", deploy: DRAIN});
            loadHttpIn(runtime._.nodeApp);
            names(runtime._.nodeApp).should.eql(["query", "expressInit", "drain", "rawBodyCapture"]);
        });
        it("the order without the drain is unchanged: the hold, then rawBodyCapture", function() {
            runtime.init({testSettings: true, httpAdminRoot:"/", deploy: HOLD});
            loadHttpIn(runtime._.nodeApp);
            names(runtime._.nodeApp).should.eql(["query", "expressInit", "hold", "rawBodyCapture"]);
        });

        describe("stop()", function() {
            let seen;
            beforeEach(function() {
                mockUtil();
                stubs.push({ restore: unmockUtil });
                seen = [];
                const off = instanceState.onChange(info => seen.push(info.state));
                stubs.push({ restore: off });
                stub(redNodes, "closeContextsPlugin", () => { seen.push("closeContextsPlugin"); return Promise.resolve() });
            });
            it("answers the requests that are still open after the flows stopped and before the state is stopped (D3)", async function() {
                runtime.init({testSettings: true, httpAdminRoot:"/", deploy: DRAIN});
                const request = fakeRequest();
                let openInStop;
                stub(redNodes, "stopFlows", () => { openInStop = !request.res.writableEnded; return Promise.resolve() });
                await runtime.stop();
                openInStop.should.be.true();
                request.res.statusCode.should.equal(503);
                JSON.parse(request.res.body).code.should.equal("http_drain_not_accepted");
                seen.should.eql(["stopping", "closeContextsPlugin", "stopped"]);
            });
            it("answers them when the stop of the flows failed, and the stop is still rejected", async function() {
                runtime.init({testSettings: true, httpAdminRoot:"/", deploy: DRAIN});
                const request = fakeRequest();
                stub(redNodes, "stopFlows", () => Promise.reject(new Error("stop failed")));
                await runtime.stop().should.be.rejectedWith("stop failed");
                request.res.statusCode.should.equal(503);
                instanceState.get().state.should.equal("stopped");
            });
            it("does not answer anything when the drain is not enabled (off_identical)", async function() {
                runtime.init({testSettings: true, httpAdminRoot:"/"});
                stub(redNodes, "stopFlows", () => Promise.resolve());
                const finalize = sinon.spy(httpDrain, "finalize");
                stubs.push(finalize);
                await runtime.stop();
                finalize.calledOnce.should.be.true();
                httpDrain.size().should.equal(0);
            });
            it("ends the wait of a drain that is running through stopFlows (the second stop in the state stopping)", async function() {
                runtime.init({testSettings: true, httpAdminRoot:"/", deploy: DRAIN});
                const request = fakeRequest();
                request.req[httpDrain.S].accepted = true;
                // the drain of a deployment that waits for the request
                const waiting = httpDrain.beforeStop();
                let settled = false;
                waiting.then(() => { settled = true });
                await new Promise(resolve => setImmediate(resolve));
                settled.should.be.false();
                stub(redNodes, "stopFlows", () => { httpDrain.abortWait(); return Promise.resolve() });
                await runtime.stop();
                settled.should.be.true();
                request.res.statusCode.should.equal(503);
                JSON.parse(request.res.body).code.should.equal("http_drain_outcome_unknown");
            });
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
        const request = require("nr-test-utils/supertest");
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

        it("an undefined value of settings.js (a missing environment variable) counts as absent: an id is generated and saved", async function() {
            const userSettings = {testSettings: true, httpAdminRoot:"/", instanceId: process.env.NODE_RED_TEST_INSTANCE_ID_NOT_SET};
            userSettings.should.have.property("instanceId", undefined);
            runtime.init(userSettings);
            await runtime.start();
            userSettings.instanceId.should.match(GENERATED);
            settings.get("instanceId").should.equal(userSettings.instanceId);
            settings.instanceId.should.equal(userSettings.instanceId);
            saveSettings.calledOnce.should.be.true();
            saveSettings.firstCall.args[0].should.have.property("instanceId", userSettings.instanceId);
            log._.calledWith("runtime.instance-id-save-failed").should.be.false();
        });

        it("an undefined value of settings.js counts as absent: the id of the storage is used and nothing is saved", async function() {
            getSettings.callsFake(function() {return Promise.resolve({instanceId: "stored"})});
            const userSettings = {testSettings: true, httpAdminRoot:"/", instanceId: undefined};
            runtime.init(userSettings);
            await runtime.start();
            userSettings.instanceId.should.equal("stored");
            settings.get("instanceId").should.equal("stored");
            settings.instanceId.should.equal("stored");
            saveSettings.called.should.be.false();
            seenByCoordination.should.equal("stored");
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

        [
            {name: "undefined", make: function() { return undefined }, printed: "undefined"},
            {name: "null", make: function() { return null }, printed: "null"},
            {name: "Object.create(null)", make: function() { return Object.create(null) }, printed: "(the value cannot be printed)"}
        ].forEach(function(v) {
            it("AC-19 (#76): a save that rejects with " + v.name + " logs a warning, keeps the generated id and does not fail the start", async function() {
                saveSettings.callsFake(function() {return Promise.reject(v.make())});
                const userSettings = {testSettings: true, httpAdminRoot:"/"};
                runtime.init(userSettings);
                await runtime.start();
                userSettings.instanceId.should.match(GENERATED);
                settings.get("instanceId").should.equal(userSettings.instanceId);
                log._.calledWithMatch("runtime.instance-id-save-failed", {message: v.printed}).should.be.true();
                log.warn.called.should.be.true();
                redNodes.loadFlows.called.should.be.true();
            });
        });

        it("waits for the save before the start continues", async function() {
            let finishSave;
            saveSettings.callsFake(function() {return new Promise(resolve => { finishSave = resolve })});
            runtime.init({testSettings: true, httpAdminRoot:"/"});
            const started = runtime.start();
            while (!saveSettings.called) {
                await new Promise(resolve => setImmediate(resolve));
            }
            // the start would have reached the coordination by now if it did not wait
            await new Promise(resolve => setTimeout(resolve, 20));
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

    describe("hooks that are never called (#15)", function() {
        let stubs;

        beforeEach(function() {
            stubs = [
                sinon.stub(storage,"getSettings").callsFake(function() {return Promise.resolve({})}),
                sinon.stub(storage,"saveSettings").callsFake(function() {return Promise.resolve()}),
                sinon.stub(storage,"init").callsFake(function() {return Promise.resolve();}),
                sinon.stub(coordination,"info").callsFake(function() {return {plugin: "local", local: true}}),
                sinon.stub(coordination,"start").callsFake(function() {return Promise.resolve()}),
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
            util.hooks.clear();
            settings.reset();
            NR_TEST_UTILS.require("@node-red/runtime/lib/state").reset();
        });

        function warnings(key) {
            return log._.withArgs("hooks." + key);
        }
        function hook(event) {}
        function base(extra) {
            return Object.assign({testSettings: true, httpAdminRoot: "/"}, extra);
        }

        it("warns about a preShutdown hook without shutdownTimeout and names the hook", async function() {
            runtime.init(base({hooks: {"preShutdown.drain": hook}}));
            await runtime.start();
            warnings("preShutdown-not-called").calledOnce.should.be.true();
            warnings("preShutdown-not-called").firstCall.args[1].should.eql({id: "preShutdown.drain"});
            warnings("preReload-not-called").called.should.be.false();
            log.warn.calledWith("abc").should.be.true();
        });

        it("warns about a preReload hook without deploy.reload.watch and names the hook", async function() {
            runtime.init(base({hooks: {"preReload.drain": hook}}));
            await runtime.start();
            warnings("preReload-not-called").calledOnce.should.be.true();
            warnings("preReload-not-called").firstCall.args[1].should.eql({id: "preReload.drain"});
            warnings("preShutdown-not-called").called.should.be.false();
        });

        it("warns once for each hook of both kinds", async function() {
            runtime.init(base({hooks: {"preShutdown.a": hook, "preShutdown.b": hook, "preReload.a": hook}}));
            await runtime.start();
            warnings("preShutdown-not-called").callCount.should.equal(2);
            warnings("preShutdown-not-called").args.map(a => a[1].id).should.eql(["preShutdown.a", "preShutdown.b"]);
            warnings("preReload-not-called").calledOnce.should.be.true();
        });

        it("warns when shutdownTimeout or deploy.reload.watch is not usable", async function() {
            runtime.init(base({
                shutdownTimeout: 0,
                deploy: {reload: {watch: false}},
                hooks: {"preShutdown.drain": hook, "preReload.drain": hook}
            }));
            await runtime.start();
            warnings("preShutdown-not-called").calledOnce.should.be.true();
            warnings("preReload-not-called").calledOnce.should.be.true();
        });

        it("warns about a shutdownTimeout that is a string or negative", async function() {
            for (const value of ["30000", -1]) {
                log._.resetHistory();
                runtime.init(base({shutdownTimeout: value, hooks: {"preShutdown.drain": hook}}));
                await runtime.start();
                warnings("preShutdown-not-called").calledOnce.should.be.true();
            }
        });

        it("keeps the hooks registered and the start unchanged", async function() {
            runtime.init(base({hooks: {"preShutdown.drain": hook, "preReload.drain": hook}}));
            await runtime.start();
            util.hooks.has("preShutdown.drain").should.be.true();
            util.hooks.has("preReload.drain").should.be.true();
            redNodes.startFlows.called.should.be.true();
        });

        it("does not warn when shutdownTimeout is set", async function() {
            runtime.init(base({shutdownTimeout: 1000, hooks: {"preShutdown.drain": hook}}));
            await runtime.start();
            warnings("preShutdown-not-called").called.should.be.false();
            warnings("preReload-not-called").called.should.be.false();
        });

        it("does not warn when deploy.reload.watch is true", async function() {
            runtime.init(base({deploy: {reload: {watch: true}}, hooks: {"preReload.drain": hook}}));
            await runtime.start();
            warnings("preShutdown-not-called").called.should.be.false();
            warnings("preReload-not-called").called.should.be.false();
        });

        it("does not warn without the hooks setting, even with the conditions not met", async function() {
            runtime.init(base());
            await runtime.start();
            warnings("preShutdown-not-called").called.should.be.false();
            warnings("preReload-not-called").called.should.be.false();
        });

        it("does not warn for an empty hooks setting", async function() {
            runtime.init(base({hooks: {}}));
            await runtime.start();
            warnings("preShutdown-not-called").called.should.be.false();
            warnings("preReload-not-called").called.should.be.false();
        });

        it("does not warn about a hook added by a plugin", async function() {
            runtime.init(base());
            util.hooks.add("preShutdown.plugin", hook);
            util.hooks.add("preReload.plugin", hook);
            await runtime.start();
            warnings("preShutdown-not-called").called.should.be.false();
            warnings("preReload-not-called").called.should.be.false();
        });
    });

    describe("startupTimeout (#71)", function() {
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        const health = NR_TEST_UTILS.require("@node-red/runtime/lib/health");
        const telemetry = NR_TEST_UTILS.require("@node-red/runtime/lib/telemetry");
        const library = NR_TEST_UTILS.require("@node-red/runtime/lib/library");
        const multiplayer = NR_TEST_UTILS.require("@node-red/runtime/lib/multiplayer");
        const plugins = NR_TEST_UTILS.require("@node-red/runtime/lib/plugins");
        const reloadWatcher = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/reload");
        const events = util.events;
        // captured before a fake clock is installed: a bound for the clean-up that does not depend on the clock
        const realSetTimeout = setTimeout;
        const realClearTimeout = clearTimeout;

        const LATE_STEP = "runtime.startup-step-late";
        const LATE_FAILED = "runtime.startup-step-late-failed";
        // #73: the keys of a start that is abandoned by a stop
        const STOPPED_KEY = "runtime.startup-stopped";
        const AFTER_STOP = "runtime.startup-step-after-stop";
        const AFTER_STOP_FAILED = "runtime.startup-step-after-stop-failed";
        const TIMEOUT_KEY = "runtime.startup-timeout";
        const INVALID_KEY = "runtime.invalid-startup-timeout";
        const NOT_PRINTABLE = "(the value cannot be printed)";
        const MAX_TIMER = 2147483647;

        let stubs;
        let cleanups;
        let clock;
        let stateEvents;

        // replaces a function of a module with a stub (a spy without `fn`); everything is restored in afterEach
        function fake(obj, name, fn) {
            if (obj[name] && obj[name].restore) {
                obj[name].restore();
            }
            const s = fn ? sinon.stub(obj, name).callsFake(fn) : sinon.spy(obj, name);
            stubs.push(s);
            return s;
        }
        // the text of log._ names the key and the parameters, so a message is told from another one
        function text(key, params) {
            let p = "";
            try {
                p = params === undefined ? "" : "|" + JSON.stringify(params);
            } catch (err) { /* a parameter that cannot be printed */ }
            return key + p;
        }
        function mockLog(metrics) {
            fake(log, "log", function() {});
            fake(log, "warn", function() {});
            fake(log, "info", function() {});
            fake(log, "trace", function() {});
            fake(log, "error", function() {});
            fake(log, "metric", function() { return !!metrics });
            fake(log, "_", text);
            fake(i18n, "registerMessageCatalog", function() { return Promise.resolve() });
        }
        function deferred() {
            let resolve, reject;
            const promise = new Promise(function(a, b) { resolve = a; reject = b });
            return {promise: promise, resolve: resolve, reject: reject};
        }
        function track(promise) {
            const t = {settled: false, rejected: false};
            promise.then(function(value) {
                t.settled = true;
                t.value = value;
            }, function(err) {
                t.settled = true;
                t.rejected = true;
                t.error = err;
            });
            return t;
        }
        function init(extra) {
            const userSettings = Object.assign({testSettings: true, httpAdminRoot: "/"}, extra);
            runtime.init(userSettings);
            return userSettings;
        }
        // the microtasks, a turn of the real event loop, then the microtasks again
        async function flush() {
            await clock.tickAsync(0);
            await new Promise(function(resolve) { setImmediate(resolve) });
            await clock.tickAsync(0);
        }
        function recordUnhandled() {
            const seen = [];
            const listener = function(reason) { seen.push(reason) };
            process.on("unhandledRejection", listener);
            cleanups.push(function() { process.removeListener("unhandledRejection", listener) });
            return seen;
        }
        function stateNames() {
            return stateEvents.map(function(i) { return i.state });
        }
        function callsOf(stub, key) {
            return stub.getCalls().filter(function(c) { return c.args[0] === key });
        }
        function textOf(key) {
            const calls = callsOf(log._, key);
            calls.length.should.be.above(0, "log._ was not called with " + key);
            return calls[0].returnValue;
        }
        // after the test the plugin stops quietly: a plugin that rejects must not fail the clean-up of an unfixed runtime
        function quietAtCleanup(plugin) {
            cleanups.push(function() {
                plugin.resign = function() { return Promise.resolve() };
                plugin.stop = function() { return Promise.resolve() };
            });
        }
        // the `error` parameters of the warnings of the coordination facade with this key (each one was passed to log.warn)
        function coordinationWarnings(key) {
            return callsOf(log._, "coordination." + key).filter(function(c) {
                return log.warn.withArgs(c.returnValue).callCount > 0;
            }).map(function(c) { return c.args[1].error });
        }
        function warnedWith(key) {
            const t = textOf(key);
            return log.warn.withArgs(t).callCount;
        }
        // The plugin of the coordination of a test: start and resign are driven by the test
        function testPlugin(options) {
            options = options || {};
            const startGate = deferred();
            const resignGate = deferred();
            if (!options.hangingResign) {
                resignGate.resolve();
            }
            const plugin = {
                id: "test-coord",
                type: coordination.PLUGIN_TYPE,
                startGate: startGate,
                resignGate: resignGate,
                start: sinon.spy(function() { return startGate.promise }),
                stop: sinon.spy(function() { return Promise.resolve() }),
                resign: sinon.spy(function() { return resignGate.promise }),
                isLeader: sinon.spy(function() { return true }),
                onLeaderChange: sinon.spy(function() { return function() {} }),
                claim: sinon.spy(function() { return Promise.resolve(null) })
            };
            // the real coordination finds the plugin of the test
            fake(plugins, "getPlugin", function(id) { return id === "test-coord" ? plugin : undefined });
            fake(plugins, "getPluginsByType", function() { return [] });
            coordination.start.restore();
            coordination.info.restore();
            cleanups.push(function() { resignGate.resolve(); startGate.resolve() });
            return plugin;
        }
        const REAL_COORDINATION = {coordination: {plugin: "test-coord"}};

        // a stop that never finishes (a hanging link of the coordination) does not hang the clean-up
        async function stopBounded() {
            let timer;
            await Promise.race([
                Promise.resolve().then(function() { return runtime.stop() }).catch(function() {}),
                new Promise(function(resolve) { timer = realSetTimeout(resolve, 1000) })
            ]);
            realClearTimeout(timer);
        }
        async function resetRuntime() {
            // the runtime keeps `started` and a chain of the coordination across init(): a stop brings it to the rest
            init({});
            await stopBounded();
        }

        beforeEach(async function() {
            stubs = [];
            cleanups = [];
            fake(process, "exit", function() {});
            mockLog(false);
            fake(storage, "init", function() { return Promise.resolve() });
            fake(storage, "getSettings", function() { return Promise.resolve({}) });
            fake(storage, "saveSettings", function() { return Promise.resolve() });
            fake(storage, "hasWatchFlows", function() { return false });
            fake(storage, "watchFlows", function() { return Promise.resolve(function() {}) });
            fake(redNodes, "init", function() {});
            fake(redNodes, "load", function() { return Promise.resolve() });
            fake(redNodes, "cleanModuleList", function() {});
            fake(redNodes, "getNodeList", function() { return [] });
            fake(redNodes, "loadContextsPlugin", function() { return Promise.resolve() });
            fake(redNodes, "loadFlows", function() { return Promise.resolve() });
            fake(redNodes, "startFlows", function() { return Promise.resolve({errors: []}) });
            fake(redNodes, "stopFlows", function() { return Promise.resolve() });
            fake(redNodes, "closeContextsPlugin", function() { return Promise.resolve() });
            fake(health, "start", function() { return Promise.resolve() });
            fake(health, "stop", function() { return Promise.resolve() });
            fake(telemetry, "init", function() { return Promise.resolve() });
            fake(library, "init", function() { return Promise.resolve() });
            fake(multiplayer, "init", function() { return Promise.resolve() });
            fake(settings, "load");
            fake(coordination, "info", function() { return {plugin: "local", local: true} });
            fake(coordination, "start", function() { return Promise.resolve() });
            fake(coordination, "resign");
            fake(coordination, "stop");
            fake(reloadWatcher, "init");
            await resetRuntime();
            instanceState.reset();
            stubs.forEach(function(s) { s.resetHistory && s.resetHistory() });
            stateEvents = [];
            const onState = function(info) { stateEvents.push(info) };
            events.on("instance:state", onState);
            cleanups.push(function() { events.removeListener("instance:state", onState) });
            clock = sinon.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]});
        });
        afterEach(async function() {
            cleanups.forEach(function(c) { c() });
            // the runtime to the rest (`started`, the interval of the metrics), while the stubs still answer
            await stopBounded();
            // removes the accessors that settings.init() defined for the keys of this test
            settings.reset();
            clock.restore();
            stubs.slice().reverse().forEach(function(s) { s.restore() });
            await coordination.stop();
            instanceState.reset();
        });

        // The steps of runtime.start() (S1-S12 of the spec): how a step is made to hang and what must not run after it
        const STEPS = [
            { step: "i18n", hang: function(d) { fake(i18n, "registerMessageCatalog", function() { return d.promise }) }, next: function() { return [health.start] } },
            { step: "health", hang: function(d) { fake(health, "start", function() { return d.promise }) }, next: function() { return [storage.init] } },
            { step: "storage", hang: function(d) { fake(storage, "init", function() { return d.promise }) }, next: function() { return [settings.load] } },
            { step: "settings", hang: function(d) { fake(settings, "load", function() { return d.promise }) }, next: function() { return [telemetry.init] } },
            { step: "telemetry", hang: function(d) { fake(telemetry, "init", function() { return d.promise }) }, next: function() { return [library.init] } },
            { step: "library", hang: function(d) { fake(library, "init", function() { return d.promise }) }, next: function() { return [multiplayer.init] } },
            { step: "multiplayer", hang: function(d) { fake(multiplayer, "init", function() { return d.promise }) }, next: function() { return [storage.saveSettings, redNodes.load] } },
            { step: "instanceId", hang: function(d) { fake(storage, "saveSettings", function() { return d.promise }) }, next: function() { return [redNodes.load] } },
            { step: "nodes", hang: function(d) { fake(redNodes, "load", function() { return d.promise }) }, next: function() { return [redNodes.loadContextsPlugin] } },
            { step: "context", hang: function(d) { fake(redNodes, "loadContextsPlugin", function() { return d.promise }) }, next: function() { return [coordination.start] } },
            { step: "coordination", hang: function(d) { fake(coordination, "start", function() { return d.promise }) }, next: function() { return [reloadWatcher.init, redNodes.loadFlows] } },
            {
                step: "reloadWatch",
                config: { deploy: { reload: { watch: true } } },
                setup: function() { fake(storage, "hasWatchFlows", function() { return true }) },
                hang: function(d) { fake(storage, "watchFlows", function() { return d.promise }) },
                resolveWith: function() { return reloadWatchUnwatch },
                next: function() { return [redNodes.loadFlows, redNodes.startFlows] }
            }
        ];
        let reloadWatchUnwatch;

        // starts the runtime with `startupTimeout: 1000` and the step of the row hanging
        function startHung(row, extra) {
            const d = deferred();
            reloadWatchUnwatch = sinon.spy(function() { return Promise.resolve() });
            if (row.setup) {
                row.setup();
            }
            row.hang(d);
            init(Object.assign({startupTimeout: 1000}, row.config, extra));
            const outcome = track(runtime.start());
            return {d: d, outcome: outcome};
        }
        function resolveLate(row, d) {
            d.resolve(row.resolveWith ? row.resolveWith() : undefined);
        }

        describe("the limit", function() {
            it("AC-1: coordination.start that never settles: pending at 999 ms, startup_timeout at 1000 ms with the step, the state failed", async function() {
                fake(coordination, "start", function() { return new Promise(function() {}) });
                init({startupTimeout: 1000});
                const outcome = track(runtime.start());
                await clock.tickAsync(999);
                outcome.settled.should.be.false();
                instanceState.get().state.should.equal("starting");
                await clock.tickAsync(1);
                outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                const err = outcome.error;
                err.should.have.property("code", "startup_timeout");
                err.should.have.property("step", "coordination");
                err.should.have.property("timeout", 1000);
                log._.calledWith(TIMEOUT_KEY, {timeout: 1000, step: "coordination"}).should.be.true();
                err.message.should.equal(textOf(TIMEOUT_KEY));
                instanceState.get().should.containEql({state: "failed", reason: "startup-error"});
                instanceState.get().errors[0].should.have.property("code", "startup_timeout");
                stateNames().should.eql(["starting", "failed"]);
                process.exit.called.should.be.false();
            });

            describe("AC-2: every step of the start can be the one that the limit names", function() {
                STEPS.forEach(function(row) {
                    it("AC-2: " + row.step + " hangs: startup_timeout with step " + row.step + ", the next step is not called", async function() {
                        const hung = startHung(row);
                        await clock.tickAsync(1000);
                        hung.outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                        hung.outcome.error.should.have.property("code", "startup_timeout");
                        hung.outcome.error.should.have.property("step", row.step);
                        hung.outcome.error.should.have.property("timeout", 1000);
                        row.next().forEach(function(fn) {
                            fn.called.should.be.false();
                        });
                    });
                });
            });

            it("AC-6: all the steps finish before the limit: start() resolves, no startup_timeout, the timer of the limit is gone", async function() {
                init({startupTimeout: 1000});
                const base = clock.countTimers();
                const started = runtime.start();
                clock.countTimers().should.equal(base + 1, "the timer of the limit is created synchronously in start()");
                await started;
                clock.countTimers().should.equal(base);
                await clock.tickAsync(10000);
                callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                instanceState.get().state.should.not.equal("failed");
                clock.countTimers().should.equal(base);
            });

            it("AC-6 (X2): a step that finishes at 999 ms wins over the limit of 1000 ms", async function() {
                fake(coordination, "start", function() { return new Promise(function(resolve) { setTimeout(resolve, 999) }) });
                init({startupTimeout: 1000});
                const base = clock.countTimers();
                const outcome = track(runtime.start());
                clock.countTimers().should.equal(base + 1, "the timer of the limit is created synchronously in start()");
                await clock.tickAsync(999);
                await clock.tickAsync(1);
                outcome.settled.should.be.true();
                outcome.rejected.should.be.false();
                callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                instanceState.get().state.should.not.equal("failed");
                clock.countTimers().should.equal(base);
            });

            it("AC-7: the limit does not cover the load of the flows: start() resolves, the state stays starting", async function() {
                fake(redNodes, "loadFlows", function() { return new Promise(function() {}) });
                init({startupTimeout: 1000});
                const base = clock.countTimers();
                const started = runtime.start();
                clock.countTimers().should.equal(base + 1, "the timer of the limit is created synchronously in start()");
                await started;
                await clock.tickAsync(10000);
                instanceState.get().state.should.equal("starting");
                callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                clock.countTimers().should.equal(base);
            });

            describe("AC-10: the boundaries of the value", function() {
                [
                    { value: 1, pending: 0, rejected: 1 },
                    { value: 1500.5, pending: 1499, rejected: 2 },
                    { value: MAX_TIMER, pending: MAX_TIMER - 1, rejected: 1 }
                ].forEach(function(c) {
                    it("AC-10: startupTimeout " + c.value + ": pending at " + c.pending + " ms, rejected with startup_timeout " + c.rejected + " ms later", async function() {
                        fake(coordination, "start", function() { return new Promise(function() {}) });
                        init({startupTimeout: c.value});
                        const outcome = track(runtime.start());
                        await clock.tickAsync(c.pending);
                        outcome.settled.should.be.false();
                        await clock.tickAsync(c.rejected);
                        outcome.rejected.should.be.true("start() was not rejected at " + (c.pending + c.rejected) + " ms");
                        outcome.error.should.have.property("code", "startup_timeout");
                    });
                });
            });

            it("AC-12: a step that fails before the limit wins: the error of the step, the limit does nothing afterwards", async function() {
                fake(storage, "init", function() {
                    return new Promise(function(resolve, reject) {
                        setTimeout(function() { reject(new Error("no storage")) }, 500);
                    });
                });
                init({startupTimeout: 1000});
                const base = clock.countTimers();
                const outcome = track(runtime.start());
                clock.countTimers().should.equal(base + 1, "the timer of the limit is created synchronously in start()");
                await clock.tickAsync(500);
                await clock.tickAsync(1000);
                outcome.rejected.should.be.true();
                outcome.error.message.should.equal("no storage");
                should.not.exist(outcome.error.code);
                instanceState.get().should.containEql({state: "failed", reason: "startup-error"});
                instanceState.get().errors[0].message.should.equal("no storage");
                const eventCount = stateEvents.length;
                await clock.tickAsync(1000);
                callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                instanceState.get().errors[0].message.should.equal("no storage");
                stateEvents.should.have.length(eventCount);
                clock.countTimers().should.equal(base);
            });
        });

        describe("the setting is off or invalid", function() {
            it("AC-8: without the key and with undefined there is no limit, no timer and no warning (re-init in one test)", async function() {
                for (const extra of [{}, {startupTimeout: undefined}]) {
                    instanceState.reset();
                    log._.resetHistory();
                    fake(coordination, "start", function() { return new Promise(function() {}) });
                    init(extra);
                    const base = clock.countTimers();
                    const outcome = track(runtime.start());
                    clock.countTimers().should.equal(base, "a timer was created without the setting");
                    await clock.tickAsync(MAX_TIMER);
                    outcome.settled.should.be.false();
                    instanceState.get().state.should.equal("starting");
                    callsOf(log._, INVALID_KEY).should.have.length(0);
                    callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                }
            });

            describe("AC-9: an invalid value gives one warning and no limit", function() {
                const values = [
                    { name: "null", make: function() { return null } },
                    { name: "0", make: function() { return 0 } },
                    { name: "-1", make: function() { return -1 } },
                    { name: "NaN", make: function() { return NaN } },
                    { name: "Infinity", make: function() { return Infinity } },
                    { name: "-Infinity", make: function() { return -Infinity } },
                    { name: "2147483648", make: function() { return 2147483648 } },
                    { name: "1e12", make: function() { return 1e12 } },
                    { name: "\"60000\"", make: function() { return "60000" } },
                    { name: "\"abc\"", make: function() { return "abc" } },
                    { name: "true", make: function() { return true } },
                    { name: "{}", make: function() { return {} } },
                    { name: "[]", make: function() { return [] } },
                    { name: "[1000]", make: function() { return [1000] } },
                    { name: "new Number(1000)", make: function() { return new Number(1000) } },
                    { name: "1000n", make: function() { return 1000n } },
                    { name: "Symbol(\"x\")", make: function() { return Symbol("x") } },
                    { name: "() => 1", make: function() { return () => 1 } },
                    { name: "Object.create(null)", make: function() { return Object.create(null) }, unprintable: true },
                    { name: "a Proxy whose get trap throws", make: function() { return new Proxy({}, { get: function() { throw new Error("get trap") } }) }, unprintable: true }
                ];
                values.forEach(function(v) {
                    it("AC-9: " + v.name, async function() {
                        fake(coordination, "start", function() { return new Promise(function() {}) });
                        const value = v.make();
                        const expected = v.unprintable ? NOT_PRINTABLE : String(value);
                        let outcome;
                        (function() {
                            init({startupTimeout: value});
                            outcome = track(runtime.start());
                        }).should.not.throw();
                        await clock.tickAsync(MAX_TIMER);
                        outcome.settled.should.be.false();
                        instanceState.get().state.should.equal("starting");
                        const warnings = callsOf(log._, INVALID_KEY);
                        warnings.should.have.length(1);
                        warnings[0].args[1].should.eql({value: expected});
                        log.warn.withArgs(warnings[0].returnValue).callCount.should.equal(1);
                        callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                    });
                });
            });
        });

        describe("AC-3: a step that completes after the limit is ignored", function() {
            STEPS.forEach(function(row) {
                it("AC-3: " + row.step + " completes late: nothing runs after it, the state and the errors are not touched, one warning", async function() {
                    const hung = startHung(row);
                    await clock.tickAsync(1000);
                    hung.outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                    const errorsBefore = instanceState.get().errors;
                    resolveLate(row, hung.d);
                    await clock.tickAsync(60000);
                    await flush();
                    row.next().forEach(function(fn) {
                        fn.called.should.be.false();
                    });
                    redNodes.loadFlows.called.should.be.false();
                    redNodes.startFlows.called.should.be.false();
                    runtime._.isStarted().should.be.false();
                    instanceState.get().should.containEql({state: "failed", reason: "startup-error"});
                    instanceState.get().errors.should.eql([{code: "startup_timeout", message: textOf(TIMEOUT_KEY)}]);
                    instanceState.get().errors.should.eql(errorsBefore);
                    stateNames().should.eql(["starting", "failed"]);
                    log._.calledWith(LATE_STEP, {step: row.step}).should.be.true();
                    warnedWith(LATE_STEP).should.equal(1);
                    hung.outcome.error.should.have.property("code", "startup_timeout");
                });
            });

            it("AC-3 (instanceId): no interval of the metrics and no welcome banner", async function() {
                fake(log, "metric", function() { return true });
                const hung = startHung(STEPS.filter(function(r) { return r.step === "instanceId" })[0]);
                await clock.tickAsync(1000);
                hung.outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                const base = clock.countTimers();
                hung.d.resolve();
                await flush();
                clock.countTimers().should.equal(base, "a timer was created after the limit");
                await clock.tickAsync(60000);
                log.log.getCalls().filter(function(c) {
                    return c.args[0] && /^runtime\.memory\./.test(c.args[0].event);
                }).should.have.length(0);
                callsOf(log._, "runtime.welcome").should.have.length(0);
            });

            it("AC-3 (nodes, no auto-install): a missing module does not clean the module list", async function() {
                fake(redNodes, "getNodeList", function(cb) {
                    return [{module: "m", enabled: true, loaded: false, types: ["t"]}].filter(cb);
                });
                const hung = startHung(STEPS.filter(function(r) { return r.step === "nodes" })[0]);
                await clock.tickAsync(1000);
                hung.outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                hung.d.resolve();
                await flush();
                redNodes.cleanModuleList.called.should.be.false();
            });

            it("AC-3 (nodes, autoInstall): no install of a missing module and no timer of a new attempt", async function() {
                fake(redNodes, "getNodeList", function(cb) {
                    return [{module: "m", enabled: true, loaded: false, types: ["t"]}].filter(cb);
                });
                const installModule = fake(redNodes, "installModule", function() { return Promise.reject(new Error("no network")) });
                const hung = startHung(STEPS.filter(function(r) { return r.step === "nodes" })[0], {externalModules: {autoInstall: true}});
                await clock.tickAsync(1000);
                hung.outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                const base = clock.countTimers();
                hung.d.resolve();
                await flush();
                installModule.called.should.be.false();
                clock.countTimers().should.equal(base, "a timer of a new attempt was created after the limit");
            });

            it("AC-3 (nodes, readOnlyUserDir): the block of the disabled features is not logged", async function() {
                const hung = startHung(STEPS.filter(function(r) { return r.step === "nodes" })[0], {readOnlyUserDir: true});
                await clock.tickAsync(1000);
                hung.outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                hung.d.resolve();
                await flush();
                log._.getCalls().filter(function(c) { return /^readonly-userdir\./.test(c.args[0]) }).should.have.length(0);
            });

            it("AC-3 (coordination): no reloadWatcher.init and no warning about a generated instanceId", async function() {
                fake(coordination, "info", function() { return {plugin: "cluster", local: false} });
                const hung = startHung(STEPS.filter(function(r) { return r.step === "coordination" })[0]);
                await clock.tickAsync(1000);
                hung.outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                hung.d.resolve();
                await flush();
                reloadWatcher.init.called.should.be.false();
                callsOf(log._, "coordination.instance-id-generated").should.have.length(0);
            });
        });

        describe("AC-4: the resources of a step that completes late are released", function() {
            it("AC-4 (coordination): resign and stop once, resign before stop; a later runtime.stop() does not repeat them", async function() {
                const row = STEPS.filter(function(r) { return r.step === "coordination" })[0];
                const hung = startHung(row);
                await clock.tickAsync(1000);
                hung.outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                hung.d.resolve();
                await clock.tickAsync(0);
                coordination.resign.calledOnce.should.be.true();
                coordination.stop.calledOnce.should.be.true();
                sinon.assert.callOrder(coordination.resign, coordination.stop);
                await runtime.stop();
                await flush();
                coordination.resign.callCount.should.equal(2, "the stop of the runtime calls resign once, as before");
                coordination.stop.callCount.should.equal(2, "the stop of the runtime calls stop once, as before");
            });

            it("AC-4 (coordination, a plugin): the plugin that starts late gets stop() once, also after runtime.stop()", async function() {
                const plugin = testPlugin();
                init(Object.assign({startupTimeout: 1000}, REAL_COORDINATION));
                const outcome = track(runtime.start());
                await clock.tickAsync(1000);
                outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                outcome.error.should.have.property("step", "coordination");
                plugin.startGate.resolve();
                await clock.tickAsync(0);
                await flush();
                plugin.resign.calledOnce.should.be.true();
                plugin.stop.calledOnce.should.be.true();
                sinon.assert.callOrder(plugin.resign, plugin.stop);
                coordination.isLeader().should.be.false();
                await clock.tickAsync(0);
                await runtime.stop();
                plugin.stop.calledOnce.should.be.true("a second plugin.stop()");
                plugin.resign.calledOnce.should.be.true("a second plugin.resign()");
            });

            it("AC-4 (coordination): a stop that rejects is a warning with the step, no unhandled rejection", async function() {
                const unhandled = recordUnhandled();
                fake(coordination, "stop", function() { return Promise.reject(new Error("stop boom")) });
                const hung = startHung(STEPS.filter(function(r) { return r.step === "coordination" })[0]);
                await clock.tickAsync(1000);
                hung.outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                hung.d.resolve();
                await flush();
                const failed = callsOf(log._, LATE_FAILED);
                failed.should.have.length(1);
                failed[0].args[1].should.have.property("step", "coordination");
                failed[0].args[1].message.should.match(/stop boom/);
                warnedWith(LATE_FAILED).should.equal(1);
                unhandled.should.eql([]);
            });

            it("AC-4 (health): health.stop() is called once", async function() {
                const hung = startHung(STEPS.filter(function(r) { return r.step === "health" })[0]);
                await clock.tickAsync(1000);
                hung.outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                health.stop.called.should.be.false();
                hung.d.resolve();
                await flush();
                health.stop.calledOnce.should.be.true();
            });

            it("AC-4 (reloadWatch): the observer that registers late is unregistered once, a later runtime.stop() does not repeat it", async function() {
                const row = STEPS.filter(function(r) { return r.step === "reloadWatch" })[0];
                const hung = startHung(row);
                await clock.tickAsync(1000);
                hung.outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                hung.d.resolve(reloadWatchUnwatch);
                await flush();
                reloadWatchUnwatch.calledOnce.should.be.true();
                await runtime.stop();
                reloadWatchUnwatch.calledOnce.should.be.true("a second unwatch");
            });
        });

        describe("the coordination chain (D8)", function() {
            it("AC-4b: runtime.stop() during the release of a late coordination does not call resign or stop a second time", async function() {
                const unhandled = recordUnhandled();
                const plugin = testPlugin({hangingResign: true});
                init(Object.assign({startupTimeout: 1000}, REAL_COORDINATION));
                const outcome = track(runtime.start());
                await clock.tickAsync(1000);
                outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                plugin.startGate.resolve();
                await clock.tickAsync(0);
                plugin.resign.calledOnce.should.be.true("the release did not call plugin.resign");
                const stopped = track(runtime.stop("SIGTERM"));
                await clock.tickAsync(0);
                await flush();
                plugin.resign.calledOnce.should.be.true("a second plugin.resign()");
                plugin.stop.called.should.be.false("plugin.stop() before the resign was done");
                plugin.resignGate.resolve();
                await flush();
                stopped.settled.should.be.true();
                stopped.rejected.should.be.false();
                plugin.resign.callCount.should.equal(1);
                plugin.stop.callCount.should.equal(1);
                sinon.assert.callOrder(plugin.resign, plugin.stop);
                coordination.isLeader().should.be.false();
                instanceState.get().should.containEql({state: "stopped", reason: "SIGTERM"});
                unhandled.should.eql([]);
            });

            it("AC-11 (#71, changed by #73 AC-5): runtime.stop() during a start that hangs: start() rejects startup_stopped at once, the timer of the limit is gone, a late coordination is released", async function() {
                const unhandled = recordUnhandled();
                const plugin = testPlugin();
                init(Object.assign({startupTimeout: 1000}, REAL_COORDINATION));
                const base = clock.countTimers();
                const outcome = track(runtime.start());
                await clock.tickAsync(100);
                await runtime.stop("SIGTERM");
                await flush();
                outcome.rejected.should.be.true("start() was not rejected by the stop");
                outcome.error.should.have.property("code", "startup_stopped");
                outcome.error.should.have.property("step", "coordination");
                clock.countTimers().should.equal(base, "the timer of the limit is left after the stop");
                await clock.tickAsync(5000);
                callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                instanceState.get().should.containEql({state: "stopped", reason: "SIGTERM"});
                plugin.startGate.resolve();
                await flush();
                redNodes.loadFlows.called.should.be.false();
                runtime._.isStarted().should.be.false();
                plugin.resign.callCount.should.equal(1);
                plugin.stop.callCount.should.equal(1);
                sinon.assert.callOrder(plugin.resign, plugin.stop);
                coordination.isLeader().should.be.false();
                callsOf(log._, AFTER_STOP).should.have.length(1);
                callsOf(log._, LATE_STEP).should.have.length(0);
                unhandled.should.eql([]);
            });

            it("AC-11 (a stub of coordination.start) (#71, changed by #73 AC-5): runtime.stop() at 100 ms, the limit of 1000 ms: start() rejects startup_stopped, the state is stopped", async function() {
                fake(coordination, "start", function() { return new Promise(function() {}) });
                init({startupTimeout: 1000});
                const outcome = track(runtime.start());
                await clock.tickAsync(100);
                await runtime.stop("SIGTERM");
                await clock.tickAsync(900);
                outcome.rejected.should.be.true("start() was not rejected by the stop");
                outcome.error.should.have.property("code", "startup_stopped");
                instanceState.get().should.containEql({state: "stopped", reason: "SIGTERM"});
            });
        });

        describe("AC-5: a step that fails after the limit", function() {
            const LATE_VALUES = [
                { name: "an Error", make: function() { return new Error("late") } },
                { name: "undefined", make: function() { return undefined } },
                { name: "null", make: function() { return null } },
                { name: "a Proxy whose get throws", make: function() { return new Proxy({}, { get: function() { throw new Error("proxy get") } }) } },
                { name: "an object whose message getter throws", make: function() { return { get message() { throw new Error("message getter") } } } }
            ];
            ["coordination", "storage"].forEach(function(stepName) {
                LATE_VALUES.forEach(function(v) {
                    it("AC-5: " + stepName + " rejects late with " + v.name + ": a warning, no unhandled rejection, the errors are not replaced", async function() {
                        const unhandled = recordUnhandled();
                        const row = STEPS.filter(function(r) { return r.step === stepName })[0];
                        const hung = startHung(row);
                        await clock.tickAsync(1000);
                        hung.outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                        hung.d.reject(v.make());
                        await clock.tickAsync(60000);
                        await flush();
                        unhandled.should.eql([]);
                        const failed = callsOf(log._, LATE_FAILED);
                        failed.should.have.length(1);
                        failed[0].args[1].should.have.property("step", stepName);
                        failed[0].args[1].message.should.be.a.String();
                        instanceState.get().should.containEql({state: "failed", reason: "startup-error"});
                        instanceState.get().errors.should.eql([{code: "startup_timeout", message: textOf(TIMEOUT_KEY)}]);
                        stateNames().should.eql(["starting", "failed"]);
                    });
                });
            });
        });

        // Phase B: attempts to break the limit - races, the guard of every step, odd values, failing releases
        describe("phase B (#71)", function() {
            function row(name) {
                return STEPS.filter(function(r) { return r.step === name })[0];
            }
            // clears the state between two starts of one test (the history of the stubs and the events too)
            async function restart() {
                await resetRuntime();
                instanceState.reset();
                stubs.forEach(function(s) { s.resetHistory && s.resetHistory() });
                stateEvents.length = 0;
            }
            function hostileProxy() {
                const trap = function() { throw new Error("trap") };
                return new Proxy({}, { get: trap, has: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
            }
            function failsWith(outcome, step) {
                outcome.rejected.should.be.true("start() was not rejected");
                outcome.error.should.have.property("code", "startup_timeout");
                outcome.error.should.have.property("step", step);
            }

            describe("races", function() {
                it("a step that completes in the same millisecond as the limit: the limit was created first and wins, the step is late", async function() {
                    fake(coordination, "start", function() { return new Promise(function(resolve) { setTimeout(resolve, 1000) }) });
                    init({startupTimeout: 1000});
                    const outcome = track(runtime.start());
                    await clock.tickAsync(1000);
                    await flush();
                    failsWith(outcome, "coordination");
                    redNodes.loadFlows.called.should.be.false();
                    runtime._.isStarted().should.be.false();
                    log._.calledWith(LATE_STEP, {step: "coordination"}).should.be.true();
                    stateNames().should.eql(["starting", "failed"]);
                });

                it("a step that fails in the same millisecond as the limit: startup_timeout stays, the failure is a late warning", async function() {
                    const unhandled = recordUnhandled();
                    fake(coordination, "start", function() {
                        return new Promise(function(resolve, reject) { setTimeout(function() { reject(new Error("same ms")) }, 1000) });
                    });
                    init({startupTimeout: 1000});
                    const outcome = track(runtime.start());
                    await clock.tickAsync(1000);
                    await flush();
                    failsWith(outcome, "coordination");
                    callsOf(log._, LATE_FAILED).should.have.length(1);
                    instanceState.get().errors.should.eql([{code: "startup_timeout", message: textOf(TIMEOUT_KEY)}]);
                    unhandled.should.eql([]);
                });

                it("a step that fails 1 ms before the limit: the error of the step, the object is the one the step threw", async function() {
                    const thrown = new Error("1 ms before");
                    fake(coordination, "start", function() {
                        return new Promise(function(resolve, reject) { setTimeout(function() { reject(thrown) }, 999) });
                    });
                    init({startupTimeout: 1000});
                    const outcome = track(runtime.start());
                    await clock.tickAsync(1000);
                    outcome.rejected.should.be.true();
                    outcome.error.should.equal(thrown);
                    callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                    callsOf(log._, LATE_FAILED).should.have.length(0);
                });

                // #73 AC-7 (replaces "runtime.stop() called at the exact limit"): the one that is created first wins
                it("AC-7 (a) (#73): a stop created after the limit in the same millisecond: the limit was first, startup_timeout", async function() {
                    fake(coordination, "start", function() { return new Promise(function() {}) });
                    init({startupTimeout: 1000});
                    const outcome = track(runtime.start());
                    setTimeout(function() { runtime.stop("SIGTERM") }, 1000);
                    await clock.tickAsync(1000);
                    await flush();
                    failsWith(outcome, "coordination");
                });

                it("AC-7 (b) (#73): a stop created before the limit in the same millisecond: the stop was first, startup_stopped, no startup-timeout", async function() {
                    fake(coordination, "start", function() { return new Promise(function() {}) });
                    init({startupTimeout: 1000});
                    setTimeout(function() { runtime.stop("SIGTERM") }, 1000);
                    const outcome = track(runtime.start());
                    await clock.tickAsync(1000);
                    await flush();
                    outcome.rejected.should.be.true("start() was not rejected");
                    outcome.error.should.have.property("code", "startup_stopped");
                    callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                });

                it("AC-7 (c) (#73): a stop 1 ms before the limit: startup_stopped, the state is stopped with the reason of the stop, the stop resolves", async function() {
                    fake(coordination, "start", function() { return new Promise(function() {}) });
                    init({startupTimeout: 1000});
                    const outcome = track(runtime.start());
                    await clock.tickAsync(999);
                    const stopped = track(runtime.stop("SIGTERM"));
                    await clock.tickAsync(1);
                    await flush();
                    outcome.rejected.should.be.true("start() was not rejected");
                    outcome.error.should.have.property("code", "startup_stopped");
                    callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                    stopped.settled.should.be.true();
                    stopped.rejected.should.be.false();
                    instanceState.get().should.containEql({state: "stopped", reason: "SIGTERM"});
                });

                it("two concurrent runtime.stop() during the release of a late coordination: plugin.resign and plugin.stop once each", async function() {
                    const unhandled = recordUnhandled();
                    const plugin = testPlugin({hangingResign: true});
                    init(Object.assign({startupTimeout: 1000}, REAL_COORDINATION));
                    const outcome = track(runtime.start());
                    await clock.tickAsync(1000);
                    failsWith(outcome, "coordination");
                    plugin.startGate.resolve();
                    await clock.tickAsync(0);
                    plugin.resign.calledOnce.should.be.true();
                    const first = track(runtime.stop("SIGTERM"));
                    const second = track(runtime.stop("SIGTERM"));
                    await flush();
                    first.settled.should.be.false();
                    second.settled.should.be.false();
                    plugin.resignGate.resolve();
                    await flush();
                    first.settled.should.be.true();
                    second.settled.should.be.true();
                    plugin.resign.callCount.should.equal(1);
                    plugin.stop.callCount.should.equal(1);
                    coordination.isLeader().should.be.false();
                    unhandled.should.eql([]);
                });

                [
                    { name: "without startupTimeout (feature off)", extra: {} },
                    { name: "with startupTimeout", extra: {startupTimeout: 1000} }
                ].forEach(function(v) {
                    it("runtime.stop() during a coordination.start that never settles does not wait for it, " + v.name, async function() {
                        const plugin = testPlugin();
                        init(Object.assign({}, v.extra, REAL_COORDINATION));
                        track(runtime.start());
                        await clock.tickAsync(10);
                        const stopped = track(runtime.stop("SIGTERM"));
                        await flush();
                        stopped.settled.should.be.true("stop() waits for the start");
                        stopped.rejected.should.be.false();
                        plugin.start.calledOnce.should.be.true();
                        plugin.resign.called.should.be.false();
                        plugin.stop.called.should.be.false();
                        instanceState.get().should.containEql({state: "stopped", reason: "SIGTERM"});
                    });
                });

                it("a hanging release does not block the stop of the next runtime: init() resets the chain (X3)", async function() {
                    const plugin = testPlugin({hangingResign: true});
                    init(Object.assign({startupTimeout: 1000}, REAL_COORDINATION));
                    const outcome = track(runtime.start());
                    await clock.tickAsync(1000);
                    failsWith(outcome, "coordination");
                    plugin.startGate.resolve();
                    await clock.tickAsync(0);
                    plugin.resign.calledOnce.should.be.true();
                    // the plugin of the first runtime never answers (the coordination is one module); the second runtime
                    // does not call it again and must not wait for the hanging link of the chain of the first one
                    fake(coordination, "resign", function() { return Promise.resolve() });
                    init({});
                    const stopped = track(runtime.stop());
                    await flush();
                    stopped.settled.should.be.true("the stop of the next runtime waits for the hanging link of the previous one");
                });

                it("a limit that fires while the start waits for the observer of storage names reloadWatch", async function() {
                    const hung = startHung(row("reloadWatch"));
                    await clock.tickAsync(1000);
                    failsWith(hung.outcome, "reloadWatch");
                });
            });

            describe("the guard after every step leaves nothing behind", function() {
                // an environment in which every sync fragment after a step has a visible effect
                function hostile(withReadOnly) {
                    fake(log, "metric", function() { return true });
                    fake(redNodes, "getNodeList", function(cb) {
                        return [{module: "m", enabled: true, loaded: false, types: ["t"]}].filter(cb);
                    });
                    fake(redNodes, "installModule", function() { return Promise.reject(new Error("no network")) });
                    fake(coordination, "info", function() { return {plugin: "cluster", local: false} });
                    return withReadOnly ? {readOnlyUserDir: true} : {externalModules: {autoInstall: true}};
                }
                function snapshot() {
                    return {
                        logCalls: log._.callCount,
                        warn: log.warn.callCount,
                        info: log.info.callCount,
                        logLog: log.log.callCount,
                        timers: clock.countTimers(),
                        cleanModuleList: redNodes.cleanModuleList.callCount,
                        installModule: redNodes.installModule.callCount,
                        reloadInit: reloadWatcher.init.callCount,
                        loadFlows: redNodes.loadFlows.callCount,
                        startFlows: redNodes.startFlows.callCount,
                        saveSettings: storage.saveSettings.callCount,
                        events: stateEvents.length
                    };
                }
                [false, true].forEach(function(withReadOnly) {
                    STEPS.forEach(function(r) {
                        it("after " + r.step + " completed late (" + (withReadOnly ? "readOnlyUserDir, clean module list" : "metrics, auto-install, cluster") + "): the only effect is the late warning" + (r.step === "coordination" || r.step === "health" || r.step === "reloadWatch" ? " and the release" : ""), async function() {
                            const unhandled = recordUnhandled();
                            const config = hostile(withReadOnly);
                            const hung = startHung(r, config);
                            await clock.tickAsync(1000);
                            failsWith(hung.outcome, r.step);
                            const before = snapshot();
                            const keysBefore = log._.getCalls().length;
                            resolveLate(r, hung.d);
                            await flush();
                            const after = snapshot();
                            // the register of the observer logs its own line when it completes: that is the step, not a follow-up
                            const expectedKeys = r.step === "reloadWatch" ? [LATE_STEP, "reload.watching"].sort() : [LATE_STEP];
                            log._.getCalls().slice(keysBefore).map(function(c) { return c.args[0] }).sort().should.eql(expectedKeys, "log._ was called for something else than the late warning");
                            (after.warn - before.warn).should.equal(1);
                            (after.info - before.info).should.equal(r.step === "reloadWatch" ? 1 : 0);
                            after.logLog.should.equal(before.logLog);
                            after.timers.should.equal(before.timers);
                            after.cleanModuleList.should.equal(before.cleanModuleList);
                            after.installModule.should.equal(before.installModule);
                            after.reloadInit.should.equal(before.reloadInit);
                            after.loadFlows.should.equal(0);
                            after.startFlows.should.equal(0);
                            after.saveSettings.should.equal(before.saveSettings);
                            after.events.should.equal(before.events);
                            runtime._.isStarted().should.be.false();
                            unhandled.should.eql([]);
                        });
                    });
                });
            });

            describe("late failures with hostile values, every step", function() {
                const HOSTILE = [
                    { name: "a Proxy that throws on every trap", make: hostileProxy },
                    { name: "an object whose toString throws and without a message", make: function() { return { toString: function() { throw new Error("toString") } } } },
                    { name: "a Symbol", make: function() { return Symbol("late") } },
                    { name: "a function whose toString throws", make: function() { const f = function() {}; f.toString = function() { throw new Error("toString") }; return f } },
                    { name: "an object whose message is a Symbol", make: function() { return { message: Symbol("m") } } },
                    { name: "Object.create(null)", make: function() { return Object.create(null) } }
                ];
                STEPS.forEach(function(r) {
                    HOSTILE.forEach(function(v) {
                        it(r.step + " rejects late with " + v.name + ": one warning, no unhandled rejection, the state is untouched", async function() {
                            const unhandled = recordUnhandled();
                            const hung = startHung(r);
                            await clock.tickAsync(1000);
                            failsWith(hung.outcome, r.step);
                            hung.d.reject(v.make());
                            await clock.tickAsync(60000);
                            await flush();
                            unhandled.should.eql([]);
                            const failed = callsOf(log._, LATE_FAILED);
                            if (r.step === "instanceId" && failed.length === 0) {
                                // a failed save of the generated id is only a warning of resolveInstanceId (#3): the step completes
                                callsOf(log._, LATE_STEP).should.have.length(1);
                            } else {
                                failed.should.have.length(1);
                                failed[0].args[1].step.should.equal(r.step);
                                failed[0].args[1].message.should.be.a.String();
                                warnedWith(LATE_FAILED).should.equal(1);
                            }
                            instanceState.get().errors.should.eql([{code: "startup_timeout", message: textOf(TIMEOUT_KEY)}]);
                            stateNames().should.eql(["starting", "failed"]);
                            redNodes.loadFlows.called.should.be.false();
                        });
                    });
                });
            });

            describe("failing releases", function() {
                it("a plugin whose resign throws synchronously: the real coordination logs it, the plugin is still stopped once", async function() {
                    const unhandled = recordUnhandled();
                    const plugin = testPlugin();
                    plugin.resign = sinon.spy(function() { throw new Error("sync resign") });
                    init(Object.assign({startupTimeout: 1000}, REAL_COORDINATION));
                    const outcome = track(runtime.start());
                    await clock.tickAsync(1000);
                    failsWith(outcome, "coordination");
                    plugin.startGate.resolve();
                    await flush();
                    plugin.resign.calledOnce.should.be.true();
                    plugin.stop.calledOnce.should.be.true();
                    coordination.isLeader().should.be.false();
                    unhandled.should.eql([]);
                });

                // Since #75 the real coordination logs a rejection of the plugin with a value without toString
                // as one coordination.resign-failed warning and does not reject; the release still stops the plugin (I-4, I-12)
                [
                    { name: "undefined", make: function() { return Promise.reject(undefined) }, printed: "undefined" },
                    { name: "null", make: function() { return Promise.reject(null) }, printed: "null" }
                ].forEach(function(v) {
                    it("AC-13: a plugin whose resign rejects with " + v.name + ": the late release still stops the plugin once, one resign-failed warning and no late-failed warning, no unhandled rejection", async function() {
                        const unhandled = recordUnhandled();
                        const plugin = testPlugin();
                        quietAtCleanup(plugin);
                        plugin.resign = sinon.spy(v.make);
                        init(Object.assign({startupTimeout: 1000}, REAL_COORDINATION));
                        const outcome = track(runtime.start());
                        await clock.tickAsync(1000);
                        failsWith(outcome, "coordination");
                        plugin.startGate.resolve();
                        await flush();
                        plugin.resign.calledOnce.should.be.true();
                        plugin.stop.calledOnce.should.be.true("the plugin was not stopped after a rejected resign");
                        coordination.isLeader().should.be.false();
                        callsOf(log._, LATE_FAILED).length.should.equal(0, "late-failed warnings");
                        coordinationWarnings("resign-failed").should.eql([v.printed]);
                        unhandled.should.eql([]);
                        // a stop of the runtime afterwards does not call the plugin again
                        await runtime.stop();
                        plugin.stop.calledOnce.should.be.true();
                    });

                    it("AC-12: a plugin whose stop rejects with " + v.name + " (late release): the plugin is stopped once, one stop-failed warning and no late-failed warning, no unhandled rejection", async function() {
                        const unhandled = recordUnhandled();
                        const plugin = testPlugin();
                        quietAtCleanup(plugin);
                        plugin.stop = sinon.spy(v.make);
                        init(Object.assign({startupTimeout: 1000}, REAL_COORDINATION));
                        const outcome = track(runtime.start());
                        await clock.tickAsync(1000);
                        failsWith(outcome, "coordination");
                        plugin.startGate.resolve();
                        await flush();
                        plugin.resign.calledOnce.should.be.true();
                        plugin.stop.calledOnce.should.be.true();
                        coordination.isLeader().should.be.false();
                        coordinationWarnings("stop-failed").should.eql([v.printed]);
                        callsOf(log._, LATE_FAILED).length.should.equal(0, "late-failed warnings");
                        unhandled.should.eql([]);
                        await runtime.stop();
                        plugin.stop.calledOnce.should.be.true("a second plugin.stop() after runtime.stop()");
                    });

                    it("AC-10: runtime.stop() with a plugin whose resign rejects with " + v.name + ": every step of the stop runs, the state is stopped", async function() {
                        const unhandled = recordUnhandled();
                        const plugin = testPlugin();
                        quietAtCleanup(plugin);
                        plugin.startGate.resolve();
                        plugin.resign = sinon.spy(v.make);
                        init(REAL_COORDINATION);
                        await runtime.start();
                        await flush();
                        await runtime.stop("SIGTERM");
                        await flush();
                        redNodes.stopFlows.calledOnce.should.be.true("the flows were not stopped");
                        plugin.resign.calledOnce.should.be.true();
                        plugin.stop.calledOnce.should.be.true("the plugin was not stopped");
                        redNodes.closeContextsPlugin.calledOnce.should.be.true("the context was not closed");
                        health.stop.calledOnce.should.be.true("the health server was not stopped");
                        coordination.isLeader().should.be.false();
                        instanceState.get().state.should.equal("stopped");
                        coordinationWarnings("resign-failed").should.eql([v.printed]);
                        unhandled.should.eql([]);
                    });

                    it("AC-11: runtime.stop() with a plugin whose stop rejects with " + v.name + ": every step of the stop runs, the state is stopped", async function() {
                        const unhandled = recordUnhandled();
                        const plugin = testPlugin();
                        quietAtCleanup(plugin);
                        plugin.startGate.resolve();
                        plugin.stop = sinon.spy(v.make);
                        init(REAL_COORDINATION);
                        await runtime.start();
                        await flush();
                        await runtime.stop("SIGTERM");
                        await flush();
                        redNodes.stopFlows.calledOnce.should.be.true();
                        plugin.stop.calledOnce.should.be.true();
                        redNodes.closeContextsPlugin.calledOnce.should.be.true("the context was not closed");
                        health.stop.calledOnce.should.be.true("the health server was not stopped");
                        coordination.isLeader().should.be.false();
                        instanceState.get().state.should.equal("stopped");
                        coordinationWarnings("stop-failed").should.eql([v.printed]);
                        unhandled.should.eql([]);
                    });
                });

                it("coordination.resign rejecting with an Error: the late release still calls coordination.stop once, the first error is logged once", async function() {
                    const unhandled = recordUnhandled();
                    fake(coordination, "resign", function() { return Promise.reject(new Error("resign rejects")) });
                    const hung = startHung(row("coordination"));
                    await clock.tickAsync(1000);
                    failsWith(hung.outcome, "coordination");
                    hung.d.resolve();
                    await flush();
                    coordination.resign.calledOnce.should.be.true();
                    coordination.stop.calledOnce.should.be.true("coordination.stop was skipped after a rejected resign");
                    const failed = callsOf(log._, LATE_FAILED);
                    failed.should.have.length(1);
                    failed[0].args[1].step.should.equal("coordination");
                    failed[0].args[1].message.should.match(/resign rejects/);
                    unhandled.should.eql([]);
                });

                [
                    { name: "rejects", make: function() { return Promise.reject(new Error("stop rejects")) } },
                    { name: "throws synchronously", make: function() { throw new Error("stop throws") } }
                ].forEach(function(v) {
                    it("a plugin whose stop " + v.name + ": no unhandled rejection, the coordination is not the leader, stop() of the runtime afterwards does not call the plugin again", async function() {
                        const unhandled = recordUnhandled();
                        const plugin = testPlugin();
                        plugin.stop = sinon.spy(v.make);
                        init(Object.assign({startupTimeout: 1000}, REAL_COORDINATION));
                        const outcome = track(runtime.start());
                        await clock.tickAsync(1000);
                        failsWith(outcome, "coordination");
                        plugin.startGate.resolve();
                        await flush();
                        plugin.stop.calledOnce.should.be.true();
                        coordination.isLeader().should.be.false();
                        await runtime.stop();
                        plugin.stop.calledOnce.should.be.true();
                        plugin.resign.calledOnce.should.be.true();
                        unhandled.should.eql([]);
                    });
                });

                [
                    { name: "rejects", make: function() { return Promise.reject(new Error("release boom")) } },
                    { name: "throws synchronously", make: function() { throw new Error("release boom") } }
                ].forEach(function(v) {
                    ["health.stop", "coordination.resign", "reloadWatcher.stop"].forEach(function(which) {
                        it(which + " " + v.name + " in the release: one late-failed warning with the step, no unhandled rejection", async function() {
                            const unhandled = recordUnhandled();
                            const stepName = which === "health.stop" ? "health" : which === "reloadWatcher.stop" ? "reloadWatch" : "coordination";
                            const target = which === "health.stop" ? health : which === "reloadWatcher.stop" ? reloadWatcher : coordination;
                            const method = which.split(".")[1];
                            const hung = startHung(row(stepName));
                            fake(target, method, v.make);
                            await clock.tickAsync(1000);
                            failsWith(hung.outcome, stepName);
                            resolveLate(row(stepName), hung.d);
                            await flush();
                            const failed = callsOf(log._, LATE_FAILED);
                            failed.should.have.length(1);
                            failed[0].args[1].step.should.equal(stepName);
                            failed[0].args[1].message.should.match(/release boom/);
                            unhandled.should.eql([]);
                            instanceState.get().errors.should.eql([{code: "startup_timeout", message: textOf(TIMEOUT_KEY)}]);
                        });
                    });
                });
            });

            describe("values of the setting", function() {
                [
                    { name: "-0", make: function() { return -0 }, printed: "0" },
                    { name: "Number.MAX_SAFE_INTEGER", make: function() { return Number.MAX_SAFE_INTEGER }, printed: "9007199254740991" },
                    { name: "2147483647.5", make: function() { return 2147483647.5 }, printed: "2147483647.5" },
                    { name: "an empty string", make: function() { return "" }, printed: "" },
                    { name: "new String(\"5\")", make: function() { return new String("5") }, printed: "5" },
                    { name: "a Proxy that throws on every trap", make: hostileProxy, printed: NOT_PRINTABLE },
                    { name: "an object whose toString throws", make: function() { return { toString: function() { throw new Error("x") } } }, printed: NOT_PRINTABLE },
                    { name: "an object whose toString returns an object", make: function() { return { toString: function() { return {} }, valueOf: function() { return {} } } }, printed: NOT_PRINTABLE }
                ].forEach(function(v) {
                    it("invalid " + v.name + ": one warning with the printed value, no limit, no timer", async function() {
                        fake(coordination, "start", function() { return new Promise(function() {}) });
                        const value = v.make();
                        init({startupTimeout: value});
                        const base = clock.countTimers();
                        const outcome = track(runtime.start());
                        clock.countTimers().should.equal(base);
                        await clock.tickAsync(MAX_TIMER);
                        outcome.settled.should.be.false();
                        const warnings = callsOf(log._, INVALID_KEY);
                        warnings.should.have.length(1);
                        warnings[0].args[1].should.eql({value: v.printed});
                    });
                });

                [0.5, 1e-9].forEach(function(value) {
                    it("valid " + value + " (below 1 ms): the limit fires after 1 ms and names the step", async function() {
                        fake(coordination, "start", function() { return new Promise(function() {}) });
                        init({startupTimeout: value});
                        const outcome = track(runtime.start());
                        await clock.tickAsync(1);
                        outcome.rejected.should.be.true();
                        outcome.error.should.have.property("code", "startup_timeout");
                        outcome.error.should.have.property("timeout", value);
                    });
                });

                it("the setting is read per start(): a second init() without it removes the limit", async function() {
                    fake(coordination, "start", function() { return new Promise(function() {}) });
                    init({startupTimeout: 1000});
                    const first = track(runtime.start());
                    await clock.tickAsync(1000);
                    first.rejected.should.be.true();
                    await restart();
                    init({});
                    const base = clock.countTimers();
                    const second = track(runtime.start());
                    clock.countTimers().should.equal(base);
                    await clock.tickAsync(MAX_TIMER);
                    second.settled.should.be.false();
                });
            });

            describe("repeated init() and start() in one process", function() {
                it("five failed starts one after another: every one names its step and no timer is left", async function() {
                    const base = clock.countTimers();
                    for (let i = 0; i < 5; i++) {
                        await restart();
                        fake(coordination, "start", function() { return new Promise(function() {}) });
                        init({startupTimeout: 100 + i});
                        const outcome = track(runtime.start());
                        await clock.tickAsync(100 + i);
                        failsWith(outcome, "coordination");
                        outcome.error.should.have.property("timeout", 100 + i);
                        clock.countTimers().should.equal(base);
                        instanceState.get().should.containEql({state: "failed", reason: "startup-error"});
                    }
                });

                it("five successful starts one after another: no timer is left, no warning", async function() {
                    const base = clock.countTimers();
                    for (let i = 0; i < 5; i++) {
                        await restart();
                        init({startupTimeout: 1000});
                        await runtime.start();
                        clock.countTimers().should.equal(base);
                        await clock.tickAsync(5000);
                        instanceState.get().state.should.not.equal("failed");
                    }
                    callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                });

                it("a failed start with the limit, then a start without it in the same process: the second is not limited", async function() {
                    fake(coordination, "start", function() { return new Promise(function() {}) });
                    init({startupTimeout: 500});
                    const first = track(runtime.start());
                    await clock.tickAsync(500);
                    failsWith(first, "coordination");
                    await restart();
                    let release;
                    fake(coordination, "start", function() { return new Promise(function(resolve) { release = resolve }) });
                    init({});
                    const second = track(runtime.start());
                    await clock.tickAsync(100000);
                    second.settled.should.be.false();
                    release();
                    await flush();
                    second.settled.should.be.true();
                    second.rejected.should.be.false();
                });
            });

            describe("the setting off is identical to a start without the code path", function() {
                async function observe(extra, mutate) {
                    await restart();
                    if (mutate) {
                        mutate();
                    }
                    init(extra);
                    const base = clock.countTimers();
                    const outcome = track(runtime.start());
                    const timersAfterCall = clock.countTimers();
                    await clock.tickAsync(0);
                    await flush();
                    return {
                        settled: outcome.settled,
                        rejected: outcome.rejected,
                        error: outcome.error,
                        states: stateEvents.map(function(i) { return i.state + "/" + i.reason }),
                        keys: log._.getCalls().map(function(c) { return c.args[0] }),
                        warn: log.warn.callCount,
                        calls: [redNodes.loadFlows.callCount, redNodes.startFlows.callCount, storage.init.callCount, health.start.callCount],
                        timers: timersAfterCall - base,
                        started: runtime._.isStarted()
                    };
                }
                it("a successful start: the same events, logs, calls and no timer for no key, undefined and an invalid key (except its warning)", async function() {
                    const none = await observe({});
                    const undef = await observe({startupTimeout: undefined});
                    const invalid = await observe({startupTimeout: "x"});
                    none.settled.should.be.true();
                    none.timers.should.equal(0);
                    undef.should.eql(none);
                    invalid.timers.should.equal(0);
                    invalid.keys.filter(function(k) { return k !== INVALID_KEY }).should.eql(none.keys);
                    invalid.keys.filter(function(k) { return k === INVALID_KEY }).should.have.length(1);
                    ["states", "calls", "started", "rejected"].forEach(function(k) { invalid[k].should.eql(none[k]) });
                });
                it("a start that fails in a step: the same error object and events with and without a limit that does not fire", async function() {
                    const thrown = new Error("no storage");
                    const make = function() { fake(storage, "init", function() { return Promise.reject(thrown) }) };
                    const off = await observe({}, make);
                    const on = await observe({startupTimeout: 100000}, make);
                    off.rejected.should.be.true();
                    on.rejected.should.be.true();
                    off.error.should.equal(thrown);
                    on.error.should.equal(thrown);
                    on.states.should.eql(off.states);
                    on.keys.should.eql(off.keys);
                    on.calls.should.eql(off.calls);
                    off.timers.should.equal(0);
                });
                it("a start that never finishes: no limit, no failure, however long the clock runs", async function() {
                    fake(coordination, "start", function() { return new Promise(function() {}) });
                    init({});
                    const base = clock.countTimers();
                    const outcome = track(runtime.start());
                    clock.countTimers().should.equal(base);
                    await clock.tickAsync(MAX_TIMER);
                    await clock.tickAsync(MAX_TIMER);
                    outcome.settled.should.be.false();
                    stateNames().should.eql(["starting"]);
                });
            });
        });

        // #73: a stop during the start abandons the start attempt. AC-5 and AC-7 of the spec are the three
        // tests of #71 above that were changed on purpose (they name "#73 AC-5" and "#73 AC-7").
        describe("stop during start (#73)", function() {
            function row(name) {
                return STEPS.filter(function(r) { return r.step === name })[0];
            }
            // starts the runtime without a limit and with the step of the row hanging
            function startHungNoLimit(r, extra) {
                const d = deferred();
                reloadWatchUnwatch = sinon.spy(function() { return Promise.resolve() });
                if (r.setup) {
                    r.setup();
                }
                r.hang(d);
                init(Object.assign({}, r.config, extra));
                return {d: d, outcome: track(runtime.start())};
            }
            // ... and stops it while the step hangs
            async function stopWhileHung(r, extra) {
                const hung = startHungNoLimit(r, extra);
                await clock.tickAsync(10);
                hung.stopped = track(runtime.stop("SIGTERM"));
                await flush();
                return hung;
            }
            function stoppedAt(outcome, step, reason) {
                outcome.rejected.should.be.true("start() was not rejected by the stop");
                outcome.error.should.have.property("code", "startup_stopped");
                outcome.error.should.have.property("step", step);
                outcome.error.should.have.property("reason", reason);
            }
            function never() {
                fake(coordination, "start", function() { return new Promise(function() {}) });
            }
            function hostileProxy() {
                const trap = function() { throw new Error("trap") };
                return new Proxy({}, { get: trap, has: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
            }
            // a clean runtime between two starts of one test
            async function restart() {
                await resetRuntime();
                instanceState.reset();
                stubs.forEach(function(s) { s.resetHistory && s.resetHistory() });
                stateEvents.length = 0;
            }
            function missingModule() {
                fake(redNodes, "getNodeList", function(cb) {
                    return [{module: "m", enabled: true, loaded: false, types: ["t"]}].filter(cb);
                });
            }

            describe("AC-1: the start is abandoned, no step runs after the stop", function() {
                it("AC-1: coordination.start never settles, no limit: start() rejects startup_stopped at once, the stop does not wait, no failed state, nothing runs", async function() {
                    never();
                    init({});
                    const outcome = track(runtime.start());
                    await clock.tickAsync(100);
                    const stopped = track(runtime.stop("SIGTERM"));
                    await flush();
                    stoppedAt(outcome, "coordination", "SIGTERM");
                    log._.calledWith(STOPPED_KEY, {step: "coordination", reason: "SIGTERM"}).should.be.true();
                    outcome.error.message.should.equal(textOf(STOPPED_KEY));
                    callsOf(log._, STOPPED_KEY).should.have.length(1);
                    warnedWith(STOPPED_KEY).should.equal(1);
                    stopped.settled.should.be.true("stop() waits for the hanging step");
                    stopped.rejected.should.be.false();
                    stateNames().should.eql(["starting", "stopping", "stopped"]);
                    stateEvents[1].should.have.property("reason", "SIGTERM");
                    stateEvents[2].should.have.property("reason", "SIGTERM");
                    runtime._.isStarted().should.be.false();
                    redNodes.loadFlows.called.should.be.false();
                    redNodes.startFlows.called.should.be.false();
                    reloadWatcher.init.called.should.be.false();
                    process.exit.called.should.be.false();
                    // AC-12: the promise settled once, nothing changes afterwards
                    const error = outcome.error;
                    const events = stateEvents.length;
                    await flush();
                    await clock.tickAsync(10000);
                    outcome.error.should.equal(error);
                    stateEvents.should.have.length(events);
                    callsOf(log._, STOPPED_KEY).should.have.length(1);
                });
            });

            describe("AC-2: a step that completes after the stop: nothing runs after it", function() {
                STEPS.forEach(function(r) {
                    it("AC-2: " + r.step + " hangs, then completes after the stop: startup_stopped with the step, nothing after it runs, one info line", async function() {
                        const hung = await stopWhileHung(r);
                        stoppedAt(hung.outcome, r.step, "SIGTERM");
                        hung.stopped.settled.should.be.true();
                        stateNames().should.eql(["starting", "stopping", "stopped"]);
                        const eventsAtStop = stateEvents.length;
                        resolveLate(r, hung.d);
                        await clock.tickAsync(60000);
                        await flush();
                        r.next().forEach(function(fn) {
                            fn.called.should.be.false();
                        });
                        redNodes.loadFlows.called.should.be.false();
                        redNodes.startFlows.called.should.be.false();
                        runtime._.isStarted().should.be.false();
                        log._.calledWith(AFTER_STOP, {step: r.step}).should.be.true();
                        log.info.withArgs(textOf(AFTER_STOP)).callCount.should.equal(1);
                        callsOf(log._, LATE_STEP).should.have.length(0);
                        callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                        stateEvents.should.have.length(eventsAtStop);
                    });
                });

                it("AC-2 (instanceId): no interval of the metrics and no welcome banner", async function() {
                    fake(log, "metric", function() { return true });
                    const hung = await stopWhileHung(row("instanceId"));
                    stoppedAt(hung.outcome, "instanceId", "SIGTERM");
                    const base = clock.countTimers();
                    hung.d.resolve();
                    await flush();
                    clock.countTimers().should.equal(base, "a timer was created after the stop");
                    await clock.tickAsync(60000);
                    log.log.getCalls().filter(function(c) {
                        return c.args[0] && /^runtime\.memory\./.test(c.args[0].event);
                    }).should.have.length(0);
                    callsOf(log._, "runtime.welcome").should.have.length(0);
                });

                it("AC-2 (nodes, no auto-install): a missing module does not clean the module list", async function() {
                    missingModule();
                    const hung = await stopWhileHung(row("nodes"));
                    stoppedAt(hung.outcome, "nodes", "SIGTERM");
                    hung.d.resolve();
                    await flush();
                    redNodes.cleanModuleList.called.should.be.false();
                });

                it("AC-2 (nodes, autoInstall): no install of a missing module and no timer of a new attempt", async function() {
                    missingModule();
                    const installModule = fake(redNodes, "installModule", function() { return Promise.reject(new Error("no network")) });
                    const hung = await stopWhileHung(row("nodes"), {externalModules: {autoInstall: true}});
                    stoppedAt(hung.outcome, "nodes", "SIGTERM");
                    const base = clock.countTimers();
                    hung.d.resolve();
                    await flush();
                    installModule.called.should.be.false();
                    clock.countTimers().should.equal(base, "a timer of a new attempt was created after the stop");
                });

                it("AC-2 (nodes, readOnlyUserDir): the block of the disabled features is not logged", async function() {
                    const hung = await stopWhileHung(row("nodes"), {readOnlyUserDir: true});
                    stoppedAt(hung.outcome, "nodes", "SIGTERM");
                    hung.d.resolve();
                    await flush();
                    log._.getCalls().filter(function(c) { return /^readonly-userdir\./.test(c.args[0]) }).should.have.length(0);
                });

                it("AC-2 (coordination): no reloadWatcher.init and no warning about a generated instanceId", async function() {
                    fake(coordination, "info", function() { return {plugin: "cluster", local: false} });
                    const hung = await stopWhileHung(row("coordination"));
                    stoppedAt(hung.outcome, "coordination", "SIGTERM");
                    hung.d.resolve();
                    await flush();
                    reloadWatcher.init.called.should.be.false();
                    callsOf(log._, "coordination.instance-id-generated").should.have.length(0);
                });
            });

            describe("AC-3: the resources of a step that completes after the stop are released", function() {
                it("AC-3 (a): a plugin that starts after the stop gets resign and stop once, resign first; a later stop does not call it again", async function() {
                    const plugin = testPlugin();
                    init(REAL_COORDINATION);
                    const outcome = track(runtime.start());
                    await clock.tickAsync(10);
                    await runtime.stop("SIGTERM");
                    plugin.startGate.resolve();
                    await flush();
                    stoppedAt(outcome, "coordination", "SIGTERM");
                    plugin.resign.callCount.should.equal(1);
                    plugin.stop.callCount.should.equal(1);
                    sinon.assert.callOrder(plugin.resign, plugin.stop);
                    coordination.isLeader().should.be.false();
                    await runtime.stop();
                    plugin.resign.callCount.should.equal(1);
                    plugin.stop.callCount.should.equal(1);
                });

                it("AC-3 (b): the plugin starts while the stop is still running (stopFlows waits): resign and stop once, resign first", async function() {
                    const plugin = testPlugin();
                    const stopFlows = deferred();
                    fake(redNodes, "stopFlows", function() { return stopFlows.promise });
                    init(REAL_COORDINATION);
                    const outcome = track(runtime.start());
                    await clock.tickAsync(10);
                    const stopped = track(runtime.stop("SIGTERM"));
                    await flush();
                    redNodes.stopFlows.called.should.be.true("the stop did not reach stopFlows");
                    stopped.settled.should.be.false();
                    plugin.startGate.resolve();
                    await flush();
                    stopFlows.resolve();
                    await flush();
                    stopped.settled.should.be.true();
                    stopped.rejected.should.be.false();
                    stoppedAt(outcome, "coordination", "SIGTERM");
                    plugin.resign.callCount.should.equal(1);
                    plugin.stop.callCount.should.equal(1);
                    sinon.assert.callOrder(plugin.resign, plugin.stop);
                    coordination.isLeader().should.be.false();
                });

                it("AC-3 (c): the own server of the probes that starts after the stop is stopped once more", async function() {
                    const hung = await stopWhileHung(row("health"));
                    stoppedAt(hung.outcome, "health", "SIGTERM");
                    const before = health.stop.callCount;
                    hung.d.resolve();
                    await flush();
                    health.stop.callCount.should.equal(before + 1);
                });

                it("AC-3 (d): the observer of storage that registers after the stop is unregistered once", async function() {
                    const hung = await stopWhileHung(row("reloadWatch"));
                    stoppedAt(hung.outcome, "reloadWatch", "SIGTERM");
                    hung.d.resolve(reloadWatchUnwatch);
                    await flush();
                    reloadWatchUnwatch.calledOnce.should.be.true();
                });
            });

            describe("AC-4: a step that fails after the stop, and a failing release", function() {
                const LATE_VALUES = [
                    { name: "an Error", make: function() { return new Error("late") } },
                    { name: "undefined", make: function() { return undefined } },
                    { name: "null", make: function() { return null } },
                    { name: "a Proxy whose get throws", make: function() { return new Proxy({}, { get: function() { throw new Error("proxy get") } }) } },
                    { name: "an object whose message getter throws", make: function() { return { get message() { throw new Error("message getter") } } } }
                ];
                ["coordination", "storage"].forEach(function(stepName) {
                    LATE_VALUES.forEach(function(v) {
                        it("AC-4: " + stepName + " rejects after the stop with " + v.name + ": one warning with the step, no unhandled rejection, nothing after the stop", async function() {
                            const unhandled = recordUnhandled();
                            const hung = await stopWhileHung(row(stepName));
                            stoppedAt(hung.outcome, stepName, "SIGTERM");
                            const events = stateEvents.length;
                            hung.d.reject(v.make());
                            await clock.tickAsync(60000);
                            await flush();
                            unhandled.should.eql([]);
                            const failed = callsOf(log._, AFTER_STOP_FAILED);
                            failed.should.have.length(1);
                            failed[0].args[1].should.have.property("step", stepName);
                            failed[0].args[1].message.should.be.a.String();
                            warnedWith(AFTER_STOP_FAILED).should.equal(1);
                            callsOf(log._, LATE_FAILED).should.have.length(0);
                            instanceState.get().state.should.equal("stopped");
                            stateEvents.should.have.length(events);
                        });
                    });
                });

                it("AC-4 (release): coordination.resign rejects in the release: one after-stop-failed warning for the coordination, coordination.stop is still called once, no unhandled rejection", async function() {
                    const unhandled = recordUnhandled();
                    // the stop of the runtime runs with the original resign; only the release of the late step meets the rejection
                    const hung = await stopWhileHung(row("coordination"));
                    stoppedAt(hung.outcome, "coordination", "SIGTERM");
                    fake(coordination, "resign", function() { return Promise.reject(new Error("resign rejects")) });
                    const stopsBefore = coordination.stop.callCount;
                    hung.d.resolve();
                    await flush();
                    coordination.resign.calledOnce.should.be.true();
                    (coordination.stop.callCount - stopsBefore).should.equal(1, "coordination.stop was skipped after a rejected resign");
                    const failed = callsOf(log._, AFTER_STOP_FAILED);
                    failed.should.have.length(1);
                    failed[0].args[1].should.have.property("step", "coordination");
                    failed[0].args[1].message.should.match(/resign rejects/);
                    warnedWith(AFTER_STOP_FAILED).should.equal(1);
                    callsOf(log._, LATE_FAILED).should.have.length(0);
                    unhandled.should.eql([]);
                });
            });

            describe("AC-5 and AC-6: the limit of startupTimeout", function() {
                it("AC-5: a stop before the limit: startup_stopped, the timer is gone at once, no startup_timeout later, the late coordination is released with the after-stop key", async function() {
                    const plugin = testPlugin();
                    init(Object.assign({startupTimeout: 1000}, REAL_COORDINATION));
                    const base = clock.countTimers();
                    const outcome = track(runtime.start());
                    await clock.tickAsync(100);
                    await runtime.stop("SIGTERM");
                    await flush();
                    stoppedAt(outcome, "coordination", "SIGTERM");
                    outcome.error.should.not.have.property("code", "startup_timeout");
                    clock.countTimers().should.equal(base);
                    const error = outcome.error;
                    await clock.tickAsync(5000);
                    callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                    instanceState.get().should.containEql({state: "stopped", reason: "SIGTERM"});
                    plugin.startGate.resolve();
                    await flush();
                    redNodes.loadFlows.called.should.be.false();
                    plugin.resign.callCount.should.equal(1);
                    plugin.stop.callCount.should.equal(1);
                    sinon.assert.callOrder(plugin.resign, plugin.stop);
                    coordination.isLeader().should.be.false();
                    callsOf(log._, AFTER_STOP).should.have.length(1);
                    callsOf(log._, LATE_STEP).should.have.length(0);
                    // AC-12
                    await clock.tickAsync(10000);
                    outcome.error.should.equal(error);
                });

                it("AC-6: the limit fires first, a stop after it: the result stays startup_timeout, the late step is logged with the keys of #71, the first reason wins", async function() {
                    const d = deferred();
                    fake(coordination, "start", function() { return d.promise });
                    init({startupTimeout: 1000});
                    const outcome = track(runtime.start());
                    await clock.tickAsync(1000);
                    outcome.rejected.should.be.true();
                    outcome.error.should.have.property("code", "startup_timeout");
                    const error = outcome.error;
                    await runtime.stop("SIGTERM");
                    d.resolve();
                    await flush();
                    outcome.error.should.equal(error);
                    outcome.error.should.have.property("code", "startup_timeout");
                    log._.calledWith(LATE_STEP, {step: "coordination"}).should.be.true();
                    callsOf(log._, AFTER_STOP).should.have.length(0);
                    callsOf(log._, STOPPED_KEY).should.have.length(0);
                    stateNames().should.eql(["starting", "failed", "stopping", "stopped"]);
                    // AC-12
                    await clock.tickAsync(10000);
                    outcome.error.should.equal(error);
                });
            });

            describe("AC-8: a shutdown with a drain (RED.health.shutdown) abandons the start at once", function() {
                it("AC-8: the start is abandoned when the instance enters stopping, before the drain ends and before RED.stop", async function() {
                    const unhandled = recordUnhandled();
                    const plugin = testPlugin();
                    cleanups.push(function() { util.hooks.clear() });
                    init(Object.assign({
                        shutdownTimeout: 5000,
                        hooks: { "preShutdown.t": function(event) { return new Promise(function(resolve) { setTimeout(resolve, 3000) }) } }
                    }, REAL_COORDINATION));
                    const stopSpy = sinon.spy(function() { return runtime.stop("SIGTERM") });
                    const outcome = track(runtime.start());
                    await clock.tickAsync(10);
                    const shutdown = track(runtime.health.shutdown({reason: "SIGTERM", stop: stopSpy}));
                    await flush();
                    stopSpy.called.should.be.false("the drain ended too early for this test");
                    outcome.rejected.should.be.true("start() was not rejected when the shutdown began");
                    outcome.error.should.have.property("code", "startup_stopped");
                    outcome.error.should.have.property("reason", "SIGTERM");
                    plugin.startGate.resolve();
                    await flush();
                    stopSpy.called.should.be.false();
                    reloadWatcher.init.called.should.be.false();
                    redNodes.loadFlows.called.should.be.false();
                    plugin.resign.callCount.should.equal(1);
                    plugin.stop.callCount.should.equal(1);
                    await clock.tickAsync(3000);
                    await flush();
                    stopSpy.calledOnce.should.be.true();
                    shutdown.settled.should.be.true();
                    instanceState.get().state.should.equal("stopped");
                    callsOf(log._, STOPPED_KEY).should.have.length(1);
                    warnedWith(STOPPED_KEY).should.equal(1);
                    unhandled.should.eql([]);
                });
            });

            describe("AC-9, AC-10: stops from inside the start", function() {
                it("AC-9: a step that stops the runtime synchronously: startup_stopped with that step, the next step does not run, the step is logged as after the stop", async function() {
                    let stopped;
                    fake(storage, "init", function() {
                        stopped = track(runtime.stop("x"));
                        return Promise.resolve();
                    });
                    init({});
                    const outcome = track(runtime.start());
                    await flush();
                    stoppedAt(outcome, "storage", "x");
                    settings.load.called.should.be.false();
                    log._.calledWith(AFTER_STOP, {step: "storage"}).should.be.true();
                    stopped.settled.should.be.true();
                });

                it("AC-10: a listener of instance:state that stops the runtime on starting: no step starts, step is null", async function() {
                    const listener = function(info) {
                        if (info.state === "starting") {
                            runtime.stop("SIGTERM");
                        }
                    };
                    events.on("instance:state", listener);
                    cleanups.push(function() { events.removeListener("instance:state", listener) });
                    init({});
                    const outcome = track(runtime.start());
                    await flush();
                    outcome.rejected.should.be.true("start() was not rejected");
                    outcome.error.should.have.property("code", "startup_stopped");
                    should(outcome.error.step).equal(null);
                    outcome.error.should.have.property("reason", "SIGTERM");
                    log._.calledWith(STOPPED_KEY, {step: "-", reason: "SIGTERM"}).should.be.true();
                    i18n.registerMessageCatalog.called.should.be.false();
                    health.start.called.should.be.false();
                    storage.init.called.should.be.false();
                    instanceState.get().state.should.equal("stopped");
                });
            });

            describe("AC-11: no gap between the guard of a step and the code that follows it", function() {
                const MAX_N = 30;
                function outcomeOf(outcome) {
                    if (outcome.rejected) {
                        outcome.error.should.have.property("code", "startup_stopped");
                        return "A";
                    }
                    outcome.settled.should.be.true("start() neither resolved nor rejected");
                    return "B";
                }
                function assertConsistent(kind, outcome, n) {
                    if (kind === "A") {
                        reloadWatcher.init.called.should.be.false("N=" + n + ": rejected, but reloadWatcher.init ran");
                        redNodes.loadFlows.called.should.be.false("N=" + n + ": rejected, but loadFlows was called");
                        runtime._.isStarted().should.be.false("N=" + n);
                    } else {
                        redNodes.loadFlows.callCount.should.equal(1, "N=" + n + ": start() resolved, but loadFlows was not called once");
                    }
                }

                it("AC-11: the stop after N microtasks (N = 0..30): start() is rejected and nothing ran, or it resolved and loadFlows was called once - never both or neither", async function() {
                    const seen = {};
                    for (let n = 0; n <= MAX_N; n++) {
                        await restart();
                        const d = deferred();
                        fake(coordination, "start", function() { return d.promise });
                        init({});
                        const outcome = track(runtime.start());
                        await clock.tickAsync(10);
                        d.resolve();
                        for (let i = 0; i < n; i++) {
                            await Promise.resolve();
                        }
                        runtime.stop("SIGTERM");
                        await flush();
                        const kind = outcomeOf(outcome);
                        assertConsistent(kind, outcome, n);
                        seen[kind] = (seen[kind] || 0) + 1;
                        if (n === 0) {
                            kind.should.equal("A", "N=0: the stop right after the step must abandon the start");
                        }
                        if (n === MAX_N) {
                            kind.should.equal("B", "N=" + MAX_N + ": the start must have completed by then");
                        }
                    }
                    seen.should.have.property("A");
                    seen.should.have.property("B");
                });

                it("AC-11 (real coordination): the same with a plugin: at most one plugin operation at a time, stop once, resign once or twice and before stop, not the leader, no unhandled rejection", async function() {
                    const unhandled = recordUnhandled();
                    const seen = {};
                    for (let n = 0; n <= MAX_N; n++) {
                        await restart();
                        if (n > 0) {
                            // testPlugin() restores these two; they are real functions again after the first round
                            fake(coordination, "start");
                            fake(coordination, "info");
                        }
                        const plugin = testPlugin();
                        const order = [];
                        let running = 0;
                        let max = 0;
                        ["resign", "stop"].forEach(function(name) {
                            const original = plugin[name];
                            plugin[name] = sinon.spy(function() {
                                order.push(name);
                                running++;
                                max = Math.max(max, running);
                                return Promise.resolve(original.apply(plugin, arguments)).then(function(v) { running--; return v }, function(e) { running--; throw e });
                            });
                        });
                        init(REAL_COORDINATION);
                        const outcome = track(runtime.start());
                        await clock.tickAsync(10);
                        plugin.startGate.resolve();
                        for (let i = 0; i < n; i++) {
                            await Promise.resolve();
                        }
                        runtime.stop("SIGTERM");
                        await flush();
                        const kind = outcomeOf(outcome);
                        assertConsistent(kind, outcome, n);
                        seen[kind] = (seen[kind] || 0) + 1;
                        max.should.be.belowOrEqual(1, "N=" + n + ": operations of the plugin ran at the same time");
                        plugin.stop.callCount.should.equal(1, "N=" + n);
                        [1, 2].should.containEql(plugin.resign.callCount, "N=" + n);
                        if (plugin.resign.callCount === 2) {
                            order.lastIndexOf("resign").should.be.below(order.indexOf("stop"), "N=" + n + ": a resign after the stop of the plugin");
                        }
                        coordination.isLeader().should.be.false("N=" + n);
                        if (n === 0) {
                            kind.should.equal("A", "N=0: the stop right after the step must abandon the start");
                        }
                        if (n === MAX_N) {
                            kind.should.equal("B", "N=" + MAX_N + ": the start must have completed by then");
                        }
                    }
                    seen.should.have.property("A");
                    seen.should.have.property("B");
                    unhandled.should.eql([]);
                });
            });

            describe("AC-13, AC-14, AC-15: more than one stop, odd reasons, init()", function() {
                it("AC-13: two stops at once: one rejection, one warning, the reason of the first stop, both stops resolve", async function() {
                    never();
                    init({});
                    const outcome = track(runtime.start());
                    await clock.tickAsync(10);
                    const first = track(runtime.stop("SIGTERM"));
                    const second = track(runtime.stop("SIGINT"));
                    await flush();
                    stoppedAt(outcome, "coordination", "SIGTERM");
                    callsOf(log._, STOPPED_KEY).should.have.length(1);
                    log.warn.getCalls().filter(function(c) { return typeof c.args[0] === "string" && c.args[0].indexOf(STOPPED_KEY) === 0 }).should.have.length(1);
                    first.settled.should.be.true();
                    second.settled.should.be.true();
                    first.rejected.should.be.false();
                    second.rejected.should.be.false();
                    instanceState.get().should.containEql({state: "stopped", reason: "SIGTERM"});
                });

                [
                    { name: "no argument", call: function() { return runtime.stop() } },
                    { name: "an empty string", call: function() { return runtime.stop("") } },
                    { name: "42", call: function() { return runtime.stop(42) } },
                    { name: "{}", call: function() { return runtime.stop({}) } },
                    { name: "null", call: function() { return runtime.stop(null) } },
                    { name: "a Proxy whose get trap throws", call: function() { return runtime.stop(hostileProxy()) } }
                ].forEach(function(v) {
                    it("AC-14: the reason is " + v.name + ": nothing throws, start() rejects startup_stopped with the reason stop", async function() {
                        never();
                        init({});
                        const outcome = track(runtime.start());
                        await clock.tickAsync(10);
                        let stopped;
                        (function() { stopped = track(v.call()) }).should.not.throw();
                        await flush();
                        stoppedAt(outcome, "coordination", "stop");
                        stopped.settled.should.be.true();
                    });
                });

                it("AC-15: init() during the start detaches the attempt: a later stop does not reject the old start()", async function() {
                    never();
                    init({});
                    const first = track(runtime.start());
                    await clock.tickAsync(10);
                    init({});
                    await runtime.stop();
                    await flush();
                    first.settled.should.be.false("the start of the runtime before init() was rejected");
                    callsOf(log._, STOPPED_KEY).should.have.length(0);
                });
            });

            describe("AC-16: no new attempt to install a module after the stop", function() {
                const AUTO = {externalModules: {autoInstall: true, autoInstallRetry: 30}};
                const LONGEST = 30000 * 8 * 2;

                it("AC-16 (R1, R6): the installs fail after the stop: no timer, no new install; a new runtime in the same process retries again", async function() {
                    missingModule();
                    const install = deferred();
                    const installModule = fake(redNodes, "installModule", function() { return install.promise });
                    init(AUTO);
                    const base = clock.countTimers();
                    await runtime.start();
                    installModule.callCount.should.equal(1);
                    await runtime.stop();
                    install.reject(new Error("no network"));
                    await flush();
                    clock.countTimers().should.equal(base, "a timer of a new attempt exists after the stop");
                    await clock.tickAsync(LONGEST);
                    installModule.callCount.should.equal(1);
                    // R6: the flag of the stop is reset by init()
                    fake(redNodes, "installModule", function() { return Promise.reject(new Error("no network")) });
                    init(AUTO);
                    await runtime.start();
                    await flush();
                    redNodes.installModule.callCount.should.equal(1);
                    await clock.tickAsync(30000);
                    redNodes.installModule.callCount.should.equal(2, "a new runtime does not retry the installs");
                });

                it("AC-16 (R6, alone): a stop, then init() and start(): the retry of the installs works again", async function() {
                    missingModule();
                    fake(redNodes, "installModule", function() { return Promise.resolve({nodes: []}) });
                    init(AUTO);
                    await runtime.start();
                    await runtime.stop();
                    await restart();
                    missingModule();
                    fake(redNodes, "installModule", function() { return Promise.reject(new Error("no network")) });
                    init(AUTO);
                    await runtime.start();
                    await flush();
                    redNodes.installModule.callCount.should.equal(1);
                    await clock.tickAsync(30000);
                    redNodes.installModule.callCount.should.equal(2, "the retry is blocked by the flag of an earlier stop");
                });

                it("AC-16 (R4): a stop during the start after the installs began, the installs fail later: no timer, no new install", async function() {
                    missingModule();
                    const install = deferred();
                    const installModule = fake(redNodes, "installModule", function() { return install.promise });
                    never();
                    init(AUTO);
                    const base = clock.countTimers();
                    const outcome = track(runtime.start());
                    await flush();
                    installModule.callCount.should.equal(1);
                    runtime.stop();
                    install.reject(new Error("no network"));
                    await flush();
                    await clock.tickAsync(240000 * 2);
                    installModule.callCount.should.equal(1);
                    clock.countTimers().should.equal(base);
                    outcome.settled.should.be.true();
                });

                it("AC-16 (R2, regression): the installs failed before the stop (a timer is set): the stop clears it, no new install", async function() {
                    missingModule();
                    const installModule = fake(redNodes, "installModule", function() { return Promise.reject(new Error("no network")) });
                    init(AUTO);
                    await runtime.start();
                    await flush();
                    installModule.callCount.should.equal(1);
                    await runtime.stop();
                    await clock.tickAsync(240000 * 2);
                    installModule.callCount.should.equal(1);
                });

                it("AC-16 (R3, regression): without a stop the install is tried again after the retry time", async function() {
                    missingModule();
                    const installModule = fake(redNodes, "installModule", function() { return Promise.reject(new Error("no network")) });
                    init(AUTO);
                    await runtime.start();
                    await flush();
                    installModule.callCount.should.equal(1);
                    await clock.tickAsync(30000);
                    installModule.callCount.should.equal(2);
                });
            });

            describe("AC-26: start() in an instance that is stopping or stopped", function() {
                function neverCalled() {
                    i18n.registerMessageCatalog.called.should.be.false();
                    health.start.called.should.be.false();
                    storage.init.called.should.be.false();
                    redNodes.loadFlows.called.should.be.false();
                }
                it("AC-26: after a stop (stopped): startup_stopped with step null and the reason of the state, no step, no event", async function() {
                    init({});
                    await runtime.stop("SIGTERM");
                    instanceState.get().state.should.equal("stopped");
                    stubs.forEach(function(s) { s.resetHistory && s.resetHistory() });
                    stateEvents.length = 0;
                    const outcome = track(runtime.start());
                    await flush();
                    outcome.rejected.should.be.true("start() was not rejected");
                    outcome.error.should.have.property("code", "startup_stopped");
                    should(outcome.error.step).equal(null);
                    outcome.error.should.have.property("reason", "SIGTERM");
                    neverCalled();
                    stateEvents.should.have.length(0);
                    runtime._.isStarted().should.be.false();
                });

                it("AC-26 (stopping): while the stop still runs: the same", async function() {
                    const stopFlows = deferred();
                    fake(redNodes, "stopFlows", function() { return stopFlows.promise });
                    init({});
                    const stopped = track(runtime.stop("SIGTERM"));
                    await flush();
                    instanceState.get().state.should.equal("stopping");
                    stopped.settled.should.be.false();
                    stubs.forEach(function(s) { s.resetHistory && s.resetHistory() });
                    stateEvents.length = 0;
                    const outcome = track(runtime.start());
                    await flush();
                    outcome.rejected.should.be.true("start() was not rejected");
                    outcome.error.should.have.property("code", "startup_stopped");
                    should(outcome.error.step).equal(null);
                    outcome.error.should.have.property("reason", "SIGTERM");
                    neverCalled();
                    stateEvents.should.have.length(0);
                    stopFlows.resolve();
                    await flush();
                    stopped.settled.should.be.true();
                });
            });

            describe("R73-N1: a failure of loadFlows that is not a rejected promise", function() {
                function loggedAbout(text) {
                    return [log.error, log.warn].some(function(stub) {
                        return stub.getCalls().some(function(c) {
                            return c.args.some(function(a) {
                                try { return String(a).indexOf(text) !== -1 } catch (e) { return false }
                            });
                        });
                    });
                }
                it("R73-N1: loadFlows throws synchronously: the state is failed with storage-error, the failure is logged, no unhandled rejection", async function() {
                    const unhandled = recordUnhandled();
                    fake(redNodes, "loadFlows", function() { throw new Error("sync boom") });
                    init({});
                    track(runtime.start());
                    await flush();
                    await clock.tickAsync(1000);
                    await flush();
                    instanceState.get().should.containEql({state: "failed", reason: "storage-error"});
                    instanceState.get().errors[0].should.have.property("message", "sync boom");
                    loggedAbout("sync boom").should.be.true("the failure of loadFlows is not logged");
                    redNodes.startFlows.called.should.be.false();
                    unhandled.should.eql([]);
                });

                it("R73-N1 (control): loadFlows rejects: the same state, as before (regression)", async function() {
                    const unhandled = recordUnhandled();
                    fake(redNodes, "loadFlows", function() { return Promise.reject(new Error("async boom")) });
                    init({});
                    await runtime.start();
                    await flush();
                    instanceState.get().should.containEql({state: "failed", reason: "storage-error"});
                    instanceState.get().errors[0].should.have.property("message", "async boom");
                    unhandled.should.eql([]);
                });
            });

            describe("AC-17: the behaviour without a stop during the start is unchanged", function() {
                it("AC-17 (M1): a stop before start(): the state is stopped, no startup-stopped message", async function() {
                    init({});
                    await runtime.stop("SIGTERM");
                    instanceState.get().should.containEql({state: "stopped", reason: "SIGTERM"});
                    callsOf(log._, STOPPED_KEY).should.have.length(0);
                });

                it("AC-17 (M7): a stop after a completed start: start() resolved, no startup-stopped and no after-stop message, the events as before", async function() {
                    init({});
                    await runtime.start();
                    await flush();
                    await runtime.stop();
                    callsOf(log._, STOPPED_KEY).should.have.length(0);
                    callsOf(log._, AFTER_STOP).should.have.length(0);
                    callsOf(log._, AFTER_STOP_FAILED).should.have.length(0);
                    stateNames().should.eql(["starting", "stopping", "stopped"]);
                });
            });

            // Phase B (#73): attempts to break the abandoning of a start
            describe("phase B (#73)", function() {
                const MAX_N = 12;
                // the number of the listeners of the instance state that the runtime holds: a leak shows as a difference
                function countListeners() {
                    const original = instanceState.onChange;
                    const counter = {live: 0};
                    fake(instanceState, "onChange", function(listener) {
                        counter.live++;
                        const unsubscribe = original.call(instanceState, listener);
                        let done = false;
                        return function() {
                            if (!done) {
                                done = true;
                                counter.live--;
                            }
                            return unsubscribe();
                        };
                    });
                    return counter;
                }
                function outcomeOf(outcome) {
                    if (outcome.rejected) {
                        outcome.error.should.have.property("code", "startup_stopped");
                        return "A";
                    }
                    outcome.settled.should.be.true("start() neither resolved nor rejected");
                    return "B";
                }

                describe("a stop at every step, with startupTimeout", function() {
                    STEPS.forEach(function(r) {
                        it("a stop while " + r.step + " hangs, limit 1000: startup_stopped with the step, no timer, no startup_timeout later, the step is released as after the stop", async function() {
                            const unhandled = recordUnhandled();
                            const base = clock.countTimers();
                            const hung = startHung(r);
                            await clock.tickAsync(10);
                            const stopped = track(runtime.stop("SIGTERM"));
                            await flush();
                            stoppedAt(hung.outcome, r.step, "SIGTERM");
                            stopped.settled.should.be.true();
                            clock.countTimers().should.equal(base);
                            await clock.tickAsync(5000);
                            callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                            resolveLate(r, hung.d);
                            await flush();
                            r.next().forEach(function(fn) {
                                fn.called.should.be.false();
                            });
                            redNodes.loadFlows.called.should.be.false();
                            callsOf(log._, LATE_STEP).should.have.length(0);
                            log._.calledWith(AFTER_STOP, {step: r.step}).should.be.true();
                            clock.countTimers().should.equal(base);
                            unhandled.should.eql([]);
                        });
                    });
                });

                describe("a stop at every boundary after a step (0..12 microtasks), with and without startupTimeout", function() {
                    [false, true].forEach(function(withLimit) {
                        STEPS.forEach(function(r) {
                            it("after " + r.step + " completes" + (withLimit ? ", limit 1000" : "") + ": start() is rejected and nothing ran, or it resolved and loadFlows was called once - never both, never neither", async function() {
                                const unhandled = recordUnhandled();
                                const seen = {};
                                for (let n = 0; n <= MAX_N; n++) {
                                    await restart();
                                    const base = clock.countTimers();
                                    const hung = withLimit ? startHung(r) : startHungNoLimit(r);
                                    await clock.tickAsync(10);
                                    resolveLate(r, hung.d);
                                    for (let i = 0; i < n; i++) {
                                        await Promise.resolve();
                                    }
                                    runtime.stop("SIGTERM");
                                    await flush();
                                    const kind = outcomeOf(hung.outcome);
                                    if (kind === "A") {
                                        redNodes.loadFlows.called.should.be.false("N=" + n + ": rejected, but loadFlows was called");
                                        runtime._.isStarted().should.be.false("N=" + n);
                                    } else {
                                        redNodes.loadFlows.callCount.should.equal(1, "N=" + n + ": resolved, but loadFlows was not called once");
                                    }
                                    clock.countTimers().should.equal(base, "N=" + n + ": a timer is left");
                                    seen[kind] = true;
                                }
                                seen.should.have.property("A");
                                unhandled.should.eql([]);
                            });
                        });
                    });
                });

                describe("real coordination", function() {
                    it("a stop after 0..30 microtasks with startupTimeout: one outcome, one release at most twice in a row, no timer left", async function() {
                        const unhandled = recordUnhandled();
                        for (let n = 0; n <= 30; n++) {
                            await restart();
                            if (n > 0) {
                                fake(coordination, "start");
                                fake(coordination, "info");
                            }
                            const plugin = testPlugin();
                            init(Object.assign({startupTimeout: 1000}, REAL_COORDINATION));
                            const base = clock.countTimers();
                            const outcome = track(runtime.start());
                            await clock.tickAsync(10);
                            plugin.startGate.resolve();
                            for (let i = 0; i < n; i++) {
                                await Promise.resolve();
                            }
                            runtime.stop("SIGTERM");
                            await flush();
                            const kind = outcomeOf(outcome);
                            if (kind === "A") {
                                redNodes.loadFlows.called.should.be.false("N=" + n);
                            } else {
                                redNodes.loadFlows.callCount.should.equal(1, "N=" + n);
                            }
                            plugin.stop.callCount.should.equal(1, "N=" + n);
                            coordination.isLeader().should.be.false("N=" + n);
                            clock.countTimers().should.equal(base, "N=" + n + ": a timer is left");
                            await clock.tickAsync(5000);
                            callsOf(log._, TIMEOUT_KEY).should.have.length(0, "N=" + n);
                        }
                        unhandled.should.eql([]);
                    });

                    it("the limit first, then a stop in the same millisecond: startup_timeout, the late coordination is released once with the late key", async function() {
                        const unhandled = recordUnhandled();
                        const plugin = testPlugin();
                        init(Object.assign({startupTimeout: 1000}, REAL_COORDINATION));
                        const outcome = track(runtime.start());
                        setTimeout(function() { runtime.stop("SIGTERM") }, 1000);
                        await clock.tickAsync(1000);
                        await flush();
                        outcome.rejected.should.be.true();
                        outcome.error.should.have.property("code", "startup_timeout");
                        plugin.startGate.resolve();
                        await flush();
                        plugin.resign.callCount.should.equal(1);
                        plugin.stop.callCount.should.equal(1);
                        callsOf(log._, LATE_STEP).should.have.length(1);
                        callsOf(log._, AFTER_STOP).should.have.length(0);
                        callsOf(log._, STOPPED_KEY).should.have.length(0);
                        unhandled.should.eql([]);
                    });

                    it("a stop first, then the limit in the same millisecond: startup_stopped, the late coordination is released once with the after-stop key, never startup_timeout", async function() {
                        const unhandled = recordUnhandled();
                        const plugin = testPlugin();
                        init(Object.assign({startupTimeout: 1000}, REAL_COORDINATION));
                        setTimeout(function() { runtime.stop("SIGTERM") }, 1000);
                        const outcome = track(runtime.start());
                        await clock.tickAsync(1000);
                        await flush();
                        outcome.rejected.should.be.true();
                        outcome.error.should.have.property("code", "startup_stopped");
                        plugin.startGate.resolve();
                        await flush();
                        plugin.resign.callCount.should.equal(1);
                        plugin.stop.callCount.should.equal(1);
                        callsOf(log._, AFTER_STOP).should.have.length(1);
                        callsOf(log._, LATE_STEP).should.have.length(0);
                        callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                        unhandled.should.eql([]);
                    });

                    it("a plugin whose start stops the runtime synchronously and then completes: released once, startup_stopped", async function() {
                        const unhandled = recordUnhandled();
                        const plugin = testPlugin();
                        plugin.start = sinon.spy(function() {
                            runtime.stop("x");
                            return plugin.startGate.promise;
                        });
                        init(REAL_COORDINATION);
                        const outcome = track(runtime.start());
                        await clock.tickAsync(10);
                        stoppedAt(outcome, "coordination", "x");
                        plugin.startGate.resolve();
                        await flush();
                        plugin.resign.callCount.should.equal(1);
                        plugin.stop.callCount.should.equal(1);
                        sinon.assert.callOrder(plugin.resign, plugin.stop);
                        coordination.isLeader().should.be.false();
                        unhandled.should.eql([]);
                    });
                });

                describe("RED.health.shutdown with a drain and other stops", function() {
                    async function drainSetup() {
                        const plugin = testPlugin();
                        cleanups.push(function() { util.hooks.clear() });
                        init(Object.assign({
                            shutdownTimeout: 5000,
                            hooks: { "preShutdown.t": function(event) { return new Promise(function(resolve) { setTimeout(resolve, 3000) }) } }
                        }, REAL_COORDINATION));
                        const stopSpy = sinon.spy(function(reason) { return runtime.stop(reason) });
                        const outcome = track(runtime.start());
                        await clock.tickAsync(10);
                        return {plugin: plugin, stopSpy: stopSpy, outcome: outcome};
                    }

                    it("a runtime.stop() during the drain: one rejection with the reason of the shutdown, one warning, the late coordination released once, the later RED.stop is harmless", async function() {
                        const unhandled = recordUnhandled();
                        const s = await drainSetup();
                        track(runtime.health.shutdown({reason: "SIGTERM", stop: s.stopSpy}));
                        await flush();
                        const second = track(runtime.stop("SIGINT"));
                        await flush();
                        stoppedAt(s.outcome, "coordination", "SIGTERM");
                        second.settled.should.be.true();
                        second.rejected.should.be.false();
                        s.plugin.startGate.resolve();
                        await flush();
                        s.plugin.resign.callCount.should.equal(1);
                        s.plugin.stop.callCount.should.equal(1);
                        await clock.tickAsync(3000);
                        await flush();
                        s.stopSpy.calledOnce.should.be.true();
                        instanceState.get().should.containEql({state: "stopped", reason: "SIGTERM"});
                        callsOf(log._, STOPPED_KEY).should.have.length(1);
                        s.plugin.resign.callCount.should.equal(1);
                        s.plugin.stop.callCount.should.equal(1);
                        unhandled.should.eql([]);
                    });

                    it("a second health.shutdown during the drain cuts it short: RED.stop once, the start rejected once", async function() {
                        const unhandled = recordUnhandled();
                        const s = await drainSetup();
                        const first = track(runtime.health.shutdown({reason: "SIGTERM", stop: s.stopSpy}));
                        await flush();
                        s.stopSpy.called.should.be.false();
                        const second = track(runtime.health.shutdown({reason: "SIGINT", stop: s.stopSpy}));
                        await flush();
                        s.stopSpy.calledOnce.should.be.true("the second shutdown did not cut the drain short");
                        first.settled.should.be.true();
                        second.settled.should.be.true();
                        stoppedAt(s.outcome, "coordination", "SIGTERM");
                        callsOf(log._, STOPPED_KEY).should.have.length(1);
                        await clock.tickAsync(10000);
                        s.stopSpy.calledOnce.should.be.true();
                        unhandled.should.eql([]);
                    });
                });

                describe("a stop from inside the start", function() {
                    it("a step that stops the runtime and then rejects: startup_stopped, one after-stop-failed warning, no unhandled rejection", async function() {
                        const unhandled = recordUnhandled();
                        fake(storage, "init", function() {
                            runtime.stop("x");
                            return Promise.reject(new Error("after the stop"));
                        });
                        init({});
                        const outcome = track(runtime.start());
                        await flush();
                        stoppedAt(outcome, "storage", "x");
                        const failed = callsOf(log._, AFTER_STOP_FAILED);
                        failed.should.have.length(1);
                        failed[0].args[1].should.have.property("step", "storage");
                        failed[0].args[1].message.should.equal("after the stop");
                        settings.load.called.should.be.false();
                        instanceState.get().state.should.equal("stopped");
                        unhandled.should.eql([]);
                    });

                    it("a listener of starting that stops the runtime, with startupTimeout: step null, no timer, no startup_timeout later", async function() {
                        const listener = function(info) {
                            if (info.state === "starting") {
                                runtime.stop("SIGTERM");
                            }
                        };
                        events.on("instance:state", listener);
                        cleanups.push(function() { events.removeListener("instance:state", listener) });
                        init({startupTimeout: 1000});
                        const base = clock.countTimers();
                        const outcome = track(runtime.start());
                        await flush();
                        outcome.rejected.should.be.true();
                        outcome.error.should.have.property("code", "startup_stopped");
                        should(outcome.error.step).equal(null);
                        await clock.tickAsync(5000);
                        clock.countTimers().should.equal(base);
                        callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                        i18n.registerMessageCatalog.called.should.be.false();
                    });

                    it("a listener of stopping that stops again (nested): one rejection with the first reason, one warning, nothing throws", async function() {
                        const unhandled = recordUnhandled();
                        const listener = function(info) {
                            if (info.state === "stopping" && info.reason === "SIGTERM") {
                                runtime.stop("nested");
                            }
                        };
                        events.on("instance:state", listener);
                        cleanups.push(function() { events.removeListener("instance:state", listener) });
                        never();
                        init({});
                        const outcome = track(runtime.start());
                        await clock.tickAsync(10);
                        const stopped = track(runtime.stop("SIGTERM"));
                        await flush();
                        stoppedAt(outcome, "coordination", "SIGTERM");
                        stopped.settled.should.be.true();
                        stopped.rejected.should.be.false();
                        callsOf(log._, STOPPED_KEY).should.have.length(1);
                        unhandled.should.eql([]);
                    });

                    it("the first step throws synchronously: the error reaches the caller as before, no listener of the state is left, a later stop is quiet", async function() {
                        const unhandled = recordUnhandled();
                        fake(i18n, "registerMessageCatalog", function() { throw new Error("sync i18n") });
                        const counter = countListeners();
                        init({startupTimeout: 1000});
                        const base = clock.countTimers();
                        const live = counter.live;
                        let caught;
                        let outcome;
                        try {
                            outcome = track(runtime.start());
                        } catch (err) {
                            caught = err;
                        }
                        await flush();
                        const error = caught || (outcome && outcome.error);
                        should.exist(error, "start() neither threw nor rejected");
                        error.should.have.property("message", "sync i18n");
                        counter.live.should.equal(live, "a listener of the instance state is left");
                        clock.countTimers().should.equal(base);
                        await runtime.stop("SIGTERM");
                        await clock.tickAsync(5000);
                        callsOf(log._, STOPPED_KEY).should.have.length(0);
                        callsOf(log._, TIMEOUT_KEY).should.have.length(0);
                        unhandled.should.eql([]);
                    });
                });

                describe("hostile reasons", function() {
                    function longString() { return "x".repeat(100000) }
                    [
                        { name: "a Symbol", make: function() { return Symbol("s") }, expected: "stop" },
                        { name: "an object whose toString throws", make: function() { return { toString: function() { throw new Error("toString") } } }, expected: "stop" },
                        { name: "an array", make: function() { return ["SIGTERM"] }, expected: "stop" },
                        { name: "a function", make: function() { return function SIGTERM() {} }, expected: "stop" },
                        { name: "a String object", make: function() { return new String("SIGTERM") }, expected: "stop" },
                        { name: "\"__proto__\"", make: function() { return "__proto__" }, expected: "__proto__" },
                        { name: "a string with non-ASCII characters", make: function() { return "stop é中😀" }, expected: "stop é中😀" },
                        { name: "a string of 100000 characters", make: longString, expected: longString() }
                    ].forEach(function(v) {
                        it("runtime.stop(" + v.name + "): nothing throws, start() rejects with the reason " + (v.expected.length > 30 ? "(the string)" : JSON.stringify(v.expected)), async function() {
                            const unhandled = recordUnhandled();
                            never();
                            init({});
                            const outcome = track(runtime.start());
                            await clock.tickAsync(10);
                            let stopped;
                            (function() { stopped = track(runtime.stop(v.make())) }).should.not.throw();
                            await flush();
                            stoppedAt(outcome, "coordination", v.expected);
                            stopped.settled.should.be.true();
                            unhandled.should.eql([]);
                        });
                    });

                    [
                        { name: "42", make: function() { return 42 } },
                        { name: "{}", make: function() { return {} } },
                        { name: "null", make: function() { return null } },
                        { name: "an empty string", make: function() { return "" } },
                        { name: "a Symbol", make: function() { return Symbol("s") } },
                        { name: "a Proxy whose get trap throws", make: hostileProxy }
                    ].forEach(function(v) {
                        it("health.shutdown({reason: " + v.name + "}): nothing throws, start() rejects with the reason shutdown", async function() {
                            const unhandled = recordUnhandled();
                            never();
                            init({});
                            const outcome = track(runtime.start());
                            await clock.tickAsync(10);
                            let shut;
                            (function() { shut = track(runtime.health.shutdown({reason: v.make(), stop: function() { return Promise.resolve() }})) }).should.not.throw();
                            await flush();
                            stoppedAt(outcome, "coordination", "shutdown");
                            shut.settled.should.be.true();
                            unhandled.should.eql([]);
                        });
                    });
                });

                describe("repeated init(), start() and stop()", function() {
                    it("15 cycles of a hung start stopped (with a changing limit): every start rejected once, no timer left, one warning per cycle", async function() {
                        const unhandled = recordUnhandled();
                        const base = clock.countTimers();
                        for (let i = 0; i < 15; i++) {
                            await restart();
                            never();
                            init(i % 2 ? {startupTimeout: 100 + i} : {});
                            const outcome = track(runtime.start());
                            await clock.tickAsync(10);
                            await runtime.stop("cycle-" + i);
                            await flush();
                            stoppedAt(outcome, "coordination", "cycle-" + i);
                            clock.countTimers().should.equal(base, "cycle " + i);
                            callsOf(log._, STOPPED_KEY).should.have.length(1, "cycle " + i);
                            await clock.tickAsync(1000);
                            callsOf(log._, TIMEOUT_KEY).should.have.length(0, "cycle " + i);
                        }
                        unhandled.should.eql([]);
                    });

                    it("eight starts detached by init(): none of them is rejected by the final stop, no warning", async function() {
                        const unhandled = recordUnhandled();
                        never();
                        const outcomes = [];
                        for (let i = 0; i < 8; i++) {
                            init({startupTimeout: i % 2 ? 100000 : undefined});
                            outcomes.push(track(runtime.start()));
                            await clock.tickAsync(1);
                        }
                        init({});
                        await runtime.stop("SIGTERM");
                        await flush();
                        outcomes.forEach(function(o, i) {
                            o.settled.should.be.false("start " + i + " was settled by a stop after init()");
                        });
                        callsOf(log._, STOPPED_KEY).should.have.length(0);
                        unhandled.should.eql([]);
                    });

                    it("the listener of the instance state is gone after a completed start, a failed step, the limit and a stop", async function() {
                        const counter = countListeners();
                        const outcomes = [
                            {name: "success", prepare: function() {}, run: async function() { await runtime.start() }},
                            {name: "failed step", prepare: function() { fake(storage, "init", function() { return Promise.reject(new Error("no storage")) }) }, run: async function() { await runtime.start().catch(function() {}) }},
                            {name: "limit", prepare: function() { never() }, extra: {startupTimeout: 100}, run: async function() { const o = track(runtime.start()); await clock.tickAsync(100); o.rejected.should.be.true() }},
                            {name: "stop", prepare: function() { never() }, run: async function() { const o = track(runtime.start()); await clock.tickAsync(10); await runtime.stop("SIGTERM"); await flush(); o.rejected.should.be.true() }}
                        ];
                        for (const o of outcomes) {
                            await restart();
                            o.prepare();
                            init(o.extra || {});
                            const before = counter.live;
                            await o.run();
                            await flush();
                            counter.live.should.equal(before, o.name + ": a listener is left");
                        }
                    });

                    it("a stop, init() and a start in the same process: the start runs (the instance can be started again after init())", async function() {
                        init({});
                        await runtime.stop("SIGTERM");
                        init({});
                        await runtime.start();
                        redNodes.loadFlows.called.should.be.true();
                        callsOf(log._, STOPPED_KEY).should.have.length(0);
                    });
                });

                describe("the installs of missing modules after a stop", function() {
                    const AUTO = {externalModules: {autoInstall: true, autoInstallRetry: 30}};
                    const LONGEST = 30000 * 8 * 2;

                    it("three failed rounds of installs, then a stop: no timer, no fourth round", async function() {
                        missingModule();
                        const installModule = fake(redNodes, "installModule", function() { return Promise.reject(new Error("no network")) });
                        init(AUTO);
                        const base = clock.countTimers();
                        await runtime.start();
                        await flush();
                        await clock.tickAsync(30000);
                        await clock.tickAsync(30000);
                        installModule.callCount.should.equal(3);
                        await runtime.stop();
                        await flush();
                        clock.countTimers().should.equal(base);
                        await clock.tickAsync(LONGEST);
                        installModule.callCount.should.equal(3);
                    });

                    it("an install in flight that succeeds after the stop: no timer, no new install, nothing thrown", async function() {
                        const unhandled = recordUnhandled();
                        missingModule();
                        const install = deferred();
                        const installModule = fake(redNodes, "installModule", function() { return install.promise });
                        init(AUTO);
                        const base = clock.countTimers();
                        await runtime.start();
                        await runtime.stop();
                        install.resolve({nodes: []});
                        await flush();
                        clock.countTimers().should.equal(base);
                        await clock.tickAsync(LONGEST);
                        installModule.callCount.should.equal(1);
                        unhandled.should.eql([]);
                    });

                    it("two modules, one installs and one fails after the stop: no retry of the failed one", async function() {
                        fake(redNodes, "getNodeList", function(cb) {
                            return [
                                {module: "a", enabled: true, loaded: false, types: ["ta"]},
                                {module: "b", enabled: true, loaded: false, types: ["tb"]}
                            ].filter(cb);
                        });
                        const gates = {a: deferred(), b: deferred()};
                        const installModule = fake(redNodes, "installModule", function(id) { return gates[id].promise });
                        init(AUTO);
                        const base = clock.countTimers();
                        await runtime.start();
                        installModule.callCount.should.equal(2);
                        await runtime.stop();
                        gates.a.resolve({nodes: []});
                        gates.b.reject(new Error("no network"));
                        await flush();
                        clock.countTimers().should.equal(base);
                        await clock.tickAsync(LONGEST);
                        installModule.callCount.should.equal(2);
                    });

                    it("the deprecated autoInstallModules with autoInstallModulesRetry: no retry after a stop that came while the install was in flight", async function() {
                        missingModule();
                        const install = deferred();
                        const installModule = fake(redNodes, "installModule", function() { return install.promise });
                        init({autoInstallModules: true, autoInstallModulesRetry: 5000});
                        const base = clock.countTimers();
                        await runtime.start();
                        await runtime.stop();
                        install.reject(new Error("no network"));
                        await flush();
                        clock.countTimers().should.equal(base);
                        await clock.tickAsync(5000 * 8 * 2);
                        installModule.callCount.should.equal(1);
                    });
                });

                describe("start() after a stop", function() {
                    it("a stop after an init() that followed an earlier stop, then start() without init(): startup_stopped, no step (the instance is stopped)", async function() {
                        init({});
                        await runtime.stop("first");
                        init({});
                        await runtime.start();
                        await runtime.stop("second");
                        instanceState.get().should.containEql({state: "stopped"});
                        stubs.forEach(function(s) { s.resetHistory && s.resetHistory() });
                        const outcome = track(runtime.start());
                        await flush();
                        outcome.rejected.should.be.true("a stopped instance started again without init()");
                        outcome.error.should.have.property("code", "startup_stopped");
                        storage.init.called.should.be.false();
                        redNodes.loadFlows.called.should.be.false();
                    });
                });
            });
        });
    });
    // #84 (AC-16, E14): the first start of the runtime reaches the start of the flows while the instance is stopping
    describe("the first start of the flows while the instance is stopping (#84, AC-16)", function() {
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        const flowsModule = NR_TEST_UTILS.require("@node-red/runtime/lib/flows");
        const Flow = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/Flow");
        const credentials = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/credentials");
        const typeRegistry = NR_TEST_UTILS.require("@node-red/registry");
        const { createWorld, deferred, delay, flush, settle } = require("nr-test-utils/stop-race-world");
        let stubs;
        let world;
        let states;
        let off;
        let loadGate;
        beforeEach(function() {
            this.timeout(10000);
            instanceState.reset();
            states = [];
            off = instanceState.onChange(info => states.push(info.state));
            loadGate = deferred();
            world = createWorld(Flow, sinon);
            stubs = [
                sinon.stub(storage, "init").callsFake(() => Promise.resolve()),
                sinon.stub(redNodes, "init").callsFake(() => {}),
                sinon.stub(redNodes, "load").callsFake(() => Promise.resolve()),
                sinon.stub(redNodes, "cleanModuleList").callsFake(() => {}),
                sinon.stub(redNodes, "getNodeList").callsFake(() => []),
                sinon.stub(redNodes, "loadContextsPlugin").callsFake(() => Promise.resolve()),
                sinon.stub(redNodes, "closeContextsPlugin").callsFake(() => Promise.resolve()),
                // the flows are read when the test lets them
                sinon.stub(redNodes, "loadFlows").callsFake(async function() { await loadGate.promise; return flowsModule.load() }),
                sinon.stub(typeRegistry, "get").callsFake(type => type.indexOf("missing") === -1),
                sinon.stub(typeRegistry, "checkFlowDependencies").callsFake(async () => {}),
                sinon.stub(credentials, "clean").callsFake(conf => { conf.forEach(n => { delete n.credentials }); return Promise.resolve() }),
                sinon.stub(credentials, "load").callsFake(() => Promise.resolve()),
                sinon.stub(credentials, "add").callsFake(async () => {})
            ];
            mockUtil();
        });
        afterEach(async function() {
            loadGate.resolve();
            world.releaseAll();
            await delay(30);
            off();
            instanceState.reset();
            util.hooks.clear();
            try {
                // drop whatever the test left in the flows module
                await flowsModule.load();
                await flowsModule.startFlows();
                await flowsModule.stopFlows("full");
            } finally {
                world.restore();
                stubs.forEach(s => s.restore());
                unmockUtil();
                instanceState.reset();
            }
        });

        it("AC-16: the shutdown drain began (state stopping, RED.stop not called) while the flows are being read: no flow is created; after the stop the states are starting, stopping, stopped", async function() {
            this.timeout(10000);
            const quietLog = { log: sinon.stub(), debug: sinon.stub(), trace: sinon.stub(), warn: sinon.stub(), info: sinon.stub(), error: sinon.stub(), metric: sinon.stub(), audit: sinon.stub(), _: k => k };
            flowsModule.init({ log: quietLog, settings: {}, storage: {
                getFlows: async () => ({ flows: [{ id: "A", type: "tab" }, { id: "a1", type: "test", z: "A", wires: [] }], rev: "r1" }),
                saveFlows: async () => "r2"
            } });
            runtime.init({ testSettings: true, httpAdminRoot: "/", shutdownTimeout: 5000, hooks: {
                "preShutdown.t84": function(payload) { return new Promise(function(resolve) { setTimeout(resolve, 400) }) }
            } });
            await runtime.start();
            instanceState.get().state.should.equal("starting");
            // health.shutdown: the state is stopping at once, RED.stop only after the drain
            const stopSpy = sinon.spy(function() { return runtime.stop("SIGTERM") });
            const shutdown = runtime.health.shutdown({ reason: "SIGTERM", stop: stopSpy });
            await flush();
            instanceState.get().state.should.equal("stopping");
            stopSpy.called.should.be.false("the drain ended too early for this test");
            // the read of the flows ends in the drain: the start of the flows is reached in stopping
            loadGate.resolve();
            await flush(6);
            await delay(100);
            stopSpy.called.should.be.false();
            world.created.should.eql([], "a flow was created while the instance is stopping");
            world.starts.should.eql([]);
            flowsModule.started.should.be.false();
            flowsModule.state().should.equal("stop");
            (await settle(shutdown, 4000)).state.should.equal("resolved");
            instanceState.get().state.should.equal("stopped");
            states.should.eql(["starting", "stopping", "stopped"]);
            world.created.should.eql([]);
        });
    });
});
