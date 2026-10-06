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
 *   #71: startupTimeout - the limit of runtime.start(); a step that completes after it is ignored and released
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
                runtime.stop().catch(function() {}),
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

            it("AC-11: runtime.stop() during a start that hangs: start() rejects at the limit, the state stays stopped, a late coordination is released", async function() {
                const unhandled = recordUnhandled();
                const plugin = testPlugin();
                init(Object.assign({startupTimeout: 1000}, REAL_COORDINATION));
                const outcome = track(runtime.start());
                await clock.tickAsync(100);
                await runtime.stop("SIGTERM");
                await clock.tickAsync(900);
                outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                outcome.error.should.have.property("code", "startup_timeout");
                instanceState.get().should.containEql({state: "stopped", reason: "SIGTERM"});
                plugin.startGate.resolve();
                await clock.tickAsync(0);
                await flush();
                redNodes.loadFlows.called.should.be.false();
                runtime._.isStarted().should.be.false();
                plugin.resign.callCount.should.equal(1);
                plugin.stop.callCount.should.equal(1);
                sinon.assert.callOrder(plugin.resign, plugin.stop);
                coordination.isLeader().should.be.false();
                unhandled.should.eql([]);
            });

            it("AC-11 (a stub of coordination.start): runtime.stop() at 100 ms, the limit at 1000 ms: start() rejects, the state is stopped", async function() {
                fake(coordination, "start", function() { return new Promise(function() {}) });
                init({startupTimeout: 1000});
                const outcome = track(runtime.start());
                await clock.tickAsync(100);
                await runtime.stop("SIGTERM");
                await clock.tickAsync(900);
                outcome.rejected.should.be.true("start() was not rejected at startupTimeout");
                outcome.error.should.have.property("code", "startup_timeout");
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
    });
});
