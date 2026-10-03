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
 *   E-01: tests of the deploy pipeline and the shared deploy lock
 *   E-01: setState and deployments wait for the start of a deployment (R-43)
 *   P-01: tests of deploy.response "started" (waitForStart, deploy errors with status 500)
 *   Z-04: tests of the single-flow api (rev, globalRev, globalConfigs, putCreatesFlow)
 *   Z-05: tests of deploy.requireRevision in both states
 * This notice is required by section 4(b) of the Apache License 2.0.
 */


var should = require("should");
var sinon = require("sinon");

var NR_TEST_UTILS = require("nr-test-utils");
var flows = NR_TEST_UTILS.require("@node-red/runtime/lib/api/flows")

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

describe("runtime-api/flows", function() {
    describe("getFlows", function() {
        it("returns the current flow configuration", function(done) {
            flows.init({
                log: mockLog(),
                flows: {
                    getFlows: function() { return [1,2,3] }
                }
            });
            flows.getFlows({}).then(function(result) {
                result.should.eql([1,2,3]);
                done();
            }).catch(done);
        });
    });

    describe("setFlows", function() {
        var setFlows;
        var loadFlows;
        var reloadError = false;
        beforeEach(function() {
            setFlows = sinon.spy(function(flows,credentials,type) {
                if (flows[0] === "error") {
                    var err = new Error("error");
                    err.code = "error";
                    var p = Promise.reject(err);
                    p.catch(()=>{});
                    return p;
                }
                return Promise.resolve("newRev");
            });
            loadFlows = sinon.spy(function() {
                if (!reloadError) {
                    return Promise.resolve("newLoadRev");
                } else {
                    var err = new Error("error");
                    err.code = "error";
                    var p = Promise.reject(err);
                    p.catch(()=>{});
                    return p;
                }
            })
            flows.init({
                log: mockLog(),
                flows: {
                    getFlows: function() { return {rev:"currentRev",flows:[]} },
                    setFlows: setFlows,
                    loadFlows: loadFlows,
                    readFlowsFromStorage: function() { return Promise.resolve({flows:[],rev:"storedRev"}) }
                }
            })

        })
        it("defaults to full deploy", function(done) {
            flows.setFlows({
                flows: {flows:[4,5,6]}
            }).then(function(result) {
                result.should.eql({rev:"newRev"});
                setFlows.called.should.be.true();
                setFlows.lastCall.args[0].should.eql([4,5,6]);
                setFlows.lastCall.args[2].should.eql("full");
                done();
            }).catch(done);
        });
        it("includes credentials when part of the request", function(done) {
            flows.setFlows({
                flows: {flows:[4,5,6], credentials: {$:"creds"}},
            }).then(function(result) {
                result.should.eql({rev:"newRev"});
                setFlows.called.should.be.true();
                setFlows.lastCall.args[0].should.eql([4,5,6]);
                setFlows.lastCall.args[1].should.eql({$:"creds"});
                setFlows.lastCall.args[2].should.eql("full");
                done();
            }).catch(done);
        });
        it("passes through other deploy types", function(done) {
            flows.setFlows({
                deploymentType: "nodes",
                flows: {flows:[4,5,6]}
            }).then(function(result) {
                result.should.eql({rev:"newRev"});
                setFlows.called.should.be.true();
                setFlows.lastCall.args[0].should.eql([4,5,6]);
                setFlows.lastCall.args[2].should.eql("nodes");
                done();
            }).catch(done);
        });
        it("triggers a flow reload", function(done) {
            flows.setFlows({
                deploymentType: "reload"
            }).then(function(result) {
                result.should.eql({rev:"newLoadRev"});
                setFlows.called.should.be.false();
                loadFlows.called.should.be.true();
                done();
            }).catch(done);
        });
        it("allows update when revision matches", function(done) {
            flows.setFlows({
                deploymentType: "nodes",
                flows: {flows:[4,5,6],rev:"currentRev"}
            }).then(function(result) {
                result.should.eql({rev:"newRev"});
                setFlows.called.should.be.true();
                setFlows.lastCall.args[0].should.eql([4,5,6]);
                setFlows.lastCall.args[2].should.eql("nodes");
                done();
            }).catch(done);
        });
        it("rejects update when revision does not match", function(done) {
            flows.setFlows({
                deploymentType: "nodes",
                flows: {flows:[4,5,6],rev:"notTheCurrentRev"}
            }).then(function(result) {
                done(new Error("Did not reject rev mismatch"));
            }).catch(function(err) {
                err.should.have.property('code','version_mismatch');
                err.should.have.property('status',409);
                done();
            }).catch(done);
        });
        it("rejects when reload fails",function(done) {
            reloadError = true;
            flows.setFlows({
                deploymentType: "reload"
            }).then(function(result) {
                done(new Error("Did not return internal error"));
            }).catch(function(err) {
                err.should.have.property('code','error');
                done();
            }).catch(done);
        });
        it("rejects when update fails",function(done) {
            flows.setFlows({
                deploymentType: "full",
                flows: {flows:["error",5,6]}
            }).then(function(result) {
                done(new Error("Did not return internal error"));
            }).catch(function(err) {
                err.should.have.property('code','error');
                done();
            }).catch(done);
        });
    });

    describe("addFlow", function() {
        var addFlow;
        beforeEach(function() {
            addFlow = sinon.spy(function(flow) {
                if (flow === "error") {
                    var err = new Error("error");
                    err.code = "error";
                    var p = Promise.reject(err);
                    p.catch(()=>{});
                    return p;
                }
                return Promise.resolve("newId");
            });
            flows.init({
                log: mockLog(),
                flows: {
                    addFlow: addFlow
                }
            });
        })
        it("adds a flow", function(done) {
            flows.addFlow({flow:{a:"123"}}).then(function(id) {
                addFlow.called.should.be.true();
                addFlow.lastCall.args[0].should.eql({a:"123"});
                id.should.eql("newId");
                done()
            }).catch(done);
        });
        it("rejects when add fails", function(done) {
            flows.addFlow({flow:"error"}).then(function(id) {
                done(new Error("Did not return internal error"));
            }).catch(function(err) {
                err.should.have.property('code','error');
                done();
            }).catch(done);
        });
    });
    describe("getFlow", function() {
        var getFlow;
        beforeEach(function() {
            getFlow = sinon.spy(function(flow) {
                if (flow === "unknown") {
                    return null;
                }
                return [1,2,3];
            });
            flows.init({
                log: mockLog(),
                flows: {
                    getFlow: getFlow
                }
            });
        })
        it("gets a flow", function(done) {
            flows.getFlow({id:"123"}).then(function(flow) {
                flow.should.eql([1,2,3]);
                done()
            }).catch(done);
        });
        it("rejects when flow not found", function(done) {
            flows.getFlow({id:"unknown"}).then(function(flow) {
                done(new Error("Did not return internal error"));
            }).catch(function(err) {
                err.should.have.property('code','not_found');
                err.should.have.property('status',404);
                done();
            }).catch(done);
        });
    });

    describe("updateFlow", function() {
        var updateFlow;
        beforeEach(function() {
            updateFlow = sinon.spy(function(id,flow) {
                if (id === "unknown") {
                    var err = new Error();
                    // TODO: quirk of internal api - uses .code for .status
                    err.code = 404;
                    var p = Promise.reject(err);
                    p.catch(()=>{});
                    return p;
                } else if (id === "error") {
                    var err = new Error();
                    // TODO: quirk of internal api - uses .code for .status
                    err.code = "error";
                    var p = Promise.reject(err);
                    p.catch(()=>{});
                    return p;
                }
                return Promise.resolve();
            });
            flows.init({
                log: mockLog(),
                flows: {
                    updateFlow: updateFlow
                }
            });
        })
        it("updates a flow", function(done) {
            flows.updateFlow({id:"123",flow:[1,2,3]}).then(function(id) {
                id.should.eql("123");
                updateFlow.called.should.be.true();
                updateFlow.lastCall.args[0].should.eql("123");
                updateFlow.lastCall.args[1].should.eql([1,2,3]);
                done()
            }).catch(done);
        });
        it("rejects when flow not found", function(done) {
            flows.updateFlow({id:"unknown"}).then(function(flow) {
                done(new Error("Did not return internal error"));
            }).catch(function(err) {
                err.should.have.property('code','not_found');
                err.should.have.property('status',404);
                done();
            }).catch(done);
        });
        it("rejects when update fails", function(done) {
            flows.updateFlow({id:"error"}).then(function(flow) {
                done(new Error("Did not return internal error"));
            }).catch(function(err) {
                err.should.have.property('code','error');
                err.should.have.property('status',400);
                done();
            }).catch(done);
        });
    });


    describe("deleteFlow", function() {
        var removeFlow;
        beforeEach(function() {
            removeFlow = sinon.spy(function(flow) {
                if (flow === "unknown") {
                    var err = new Error();
                    // TODO: quirk of internal api - uses .code for .status
                    err.code = 404;
                    var p = Promise.reject(err);
                    p.catch(()=>{});
                    return p;
                } else if (flow === "error") {
                    var err = new Error();
                    // TODO: quirk of internal api - uses .code for .status
                    err.code = "error";
                    var p = Promise.reject(err);
                    p.catch(()=>{});
                    return p;
                }
                return Promise.resolve();
            });
            flows.init({
                log: mockLog(),
                flows: {
                    removeFlow: removeFlow
                }
            });
        })
        it("deletes a flow", function(done) {
            flows.deleteFlow({id:"123"}).then(function() {
                removeFlow.called.should.be.true();
                removeFlow.lastCall.args[0].should.eql("123");
                done()
            }).catch(done);
        });
        it("rejects when flow not found", function(done) {
            flows.deleteFlow({id:"unknown"}).then(function(flow) {
                done(new Error("Did not return internal error"));
            }).catch(function(err) {
                err.should.have.property('code','not_found');
                err.should.have.property('status',404);
                done();
            }).catch(done);
        });
        it("rejects when delete fails", function(done) {
            flows.deleteFlow({id:"error"}).then(function(flow) {
                done(new Error("Did not return internal error"));
            }).catch(function(err) {
                err.should.have.property('code','error');
                err.should.have.property('status',400);
                done();
            }).catch(done);
        });
    });

    describe("getNodeCredentials", function() {
        beforeEach(function() {
            flows.init({
                log: mockLog(),
                nodes: {
                    getCredentials: function(id) {
                        if (id === "unknown") {
                            return undefined;
                        } else if (id === "known") {
                            return {
                                username: "abc",
                                password: "123"
                            }
                        } else if (id === "known2") {
                            return {
                                username: "abc",
                                password: ""
                            }
                        } else {
                            return {};
                        }
                    },
                    getCredentialDefinition: function(type) {
                        if (type === "node") {
                            return {
                                username: {type:"text"},
                                password: {type:"password"}
                            }
                        } else {
                            return null;
                        }
                    }
                }
            });
        })
        it("returns an empty object for an unknown node", function(done) {
            flows.getNodeCredentials({id:"unknown", type:"node"}).then(function(result) {
                result.should.eql({});
                done();
            }).catch(done);
        });
        it("gets the filtered credentials for a known node with password", function(done) {
            flows.getNodeCredentials({id:"known", type:"node"}).then(function(result) {
                result.should.eql({
                    username: "abc",
                    has_password: true
                });
                done();
            }).catch(done);
        });
        it("gets the filtered credentials for a known node without password", function(done) {
            flows.getNodeCredentials({id:"known2", type:"node"}).then(function(result) {
                result.should.eql({
                    username: "abc",
                    has_password: false
                });
                done();
            }).catch(done);
        });
        it("gets the empty credentials for a known node without a registered definition", function(done) {
            flows.getNodeCredentials({id:"known2", type:"unknown-type"}).then(function(result) {
                result.should.eql({});
                done();
            }).catch(done);
        });
    });

    describe("flow run state", function() {
        var startFlows, stopFlows, runtime;
        beforeEach(function() {
            let flowsStarted = true;
            let flowsState = "start";
            startFlows = sinon.spy(function(type) {
                if (type !== "full") {
                    var err = new Error();
                    // TODO: quirk of internal api - uses .code for .status
                    err.code = 400;
                    var p = Promise.reject(err);
                    p.catch(()=>{});
                    return p;
                }
                flowsStarted = true;
                flowsState = "start";
                return Promise.resolve();
            });
            stopFlows = sinon.spy(function(type) {
                if (type !== "full") {
                    var err = new Error();
                    // TODO: quirk of internal api - uses .code for .status
                    err.code = 400;
                    var p = Promise.reject(err);
                    p.catch(()=>{});
                    return p;
                }
                flowsStarted = false;
                flowsState = "stop";
                return Promise.resolve();
            });
            runtime = {
                log: mockLog(),
                settings: {
                    runtimeState: {
                        enabled: true,
                        ui: true,
                    },
                },
                flows: {
                    get started() {
                        return flowsStarted;
                    },
                    startFlows,
                    stopFlows,
                    getFlows: function() { return {rev:"currentRev",flows:[]} },
                    state: function() { return flowsState}
                }
            }
        })

        it("gets flows run state", async function() {
            flows.init(runtime);
            const state = await flows.getState({})
            state.should.have.property("state", "start")
        });
        it("permits getting flows run state when setting disabled", async function() {
            runtime.settings.runtimeState.enabled = false;
            flows.init(runtime);
            const state = await flows.getState({})
            state.should.have.property("state", "start")
        });
        it("start flows", async function() {
            flows.init(runtime);
            const state = await flows.setState({state:"start"})
            state.should.have.property("state", "start")
            stopFlows.called.should.not.be.true();
            startFlows.called.should.be.true();
        });
        it("stop flows", async function() {
            flows.init(runtime);
            const state = await flows.setState({state:"stop"})
            state.should.have.property("state", "stop")
            stopFlows.called.should.be.true();
            startFlows.called.should.not.be.true();
        });
        it("rejects starting flows when setting disabled", async function() {
            let err;
            runtime.settings.runtimeState.enabled = false;
            flows.init(runtime);
            try {
                await flows.setState({state:"start"})
            } catch (error) {
                err = error
            }
            stopFlows.called.should.not.be.true();
            startFlows.called.should.not.be.true();
            should(err).have.property("code", "not_allowed")
            should(err).have.property("status", 405)
        });
        it("rejects stopping flows when setting disabled", async function() {
            let err;
            runtime.settings.runtimeState.enabled = false;
            flows.init(runtime);
            try {
                await flows.setState({state:"stop"})
            } catch (error) {
                err = error
            }
            stopFlows.called.should.not.be.true();
            startFlows.called.should.not.be.true();
            should(err).have.property("code", "not_allowed")
            should(err).have.property("status", 405)
        });
        it("rejects setting invalid flows run state", async function() {
            let err;
            flows.init(runtime);
            try {
                await flows.setState({state:"bad-state"})
            } catch (error) {
                err = error
            }
            stopFlows.called.should.not.be.true();
            startFlows.called.should.not.be.true();
            should(err).have.property("code", "invalid_run_state")
            should(err).have.property("status", 400)
        });
    });


    describe("deploy pipeline (E-01)", function() {
        const pipeline = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/pipeline");
        let runtime;
        let release;
        let order;
        function pendingSetFlows() {
            return sinon.spy(function(config) {
                order.push("setFlows:start");
                return new Promise(resolve => {
                    release = function() { order.push("setFlows:end"); resolve("newRev") };
                });
            });
        }
        beforeEach(function() {
            order = [];
            runtime = {
                log: mockLog(),
                settings: { runtimeState: { enabled: true, ui: true }, set: function() {} },
                flows: {
                    getFlows: function() { return {rev:"currentRev",flows:[]} },
                    setFlows: sinon.spy(function() { return Promise.resolve("newRev") }),
                    loadFlows: sinon.spy(function() { return Promise.resolve("loadRev") }),
                    readFlowsFromStorage: sinon.spy(function() { return Promise.resolve({flows:[],rev:"storedRev"}) }),
                    addFlow: sinon.spy(function() { order.push("addFlow"); return Promise.resolve("newId") }),
                    updateFlow: sinon.spy(function() { order.push("updateFlow"); return Promise.resolve() }),
                    removeFlow: sinon.spy(function() { order.push("removeFlow"); return Promise.resolve() }),
                    startFlows: sinon.spy(function() { order.push("startFlows"); return Promise.resolve() }),
                    stopFlows: sinon.spy(function() { order.push("stopFlows"); return Promise.resolve() }),
                    state: function() { return "start" }
                }
            };
            flows.init(runtime);
        });
        afterEach(function() {
            if (pipeline.deploy.restore) {
                pipeline.deploy.restore();
            }
        });
        it("setFlows passes no deployOpts by default", async function() {
            await flows.setFlows({flows:{flows:[1]}});
            runtime.flows.setFlows.calledOnce.should.be.true();
            should.not.exist(runtime.flows.setFlows.firstCall.args[6]);
        });
        it("reload passes no deployOpts by default", async function() {
            const result = await flows.setFlows({deploymentType:"reload"});
            result.should.eql({rev:"loadRev"});
            runtime.flows.loadFlows.firstCall.args[0].should.be.true();
            should.not.exist(runtime.flows.loadFlows.firstCall.args[1]);
            runtime.flows.loadFlows.firstCall.args[2].should.eql({flows:[],rev:"storedRev"});
        });
        it("all api entries call deploy once", async function() {
            const deploySpy = sinon.spy(pipeline, "deploy");
            await flows.setFlows({flows:{flows:[1]}});
            deploySpy.callCount.should.equal(1);
            deploySpy.lastCall.args[0].should.have.property("type","full");
            await flows.setFlows({deploymentType:"reload"});
            deploySpy.callCount.should.equal(2);
            deploySpy.lastCall.args[0].should.have.property("type","reload");
            await flows.addFlow({flow:{}});
            deploySpy.callCount.should.equal(3);
            await flows.updateFlow({id:"1",flow:{}});
            deploySpy.callCount.should.equal(4);
            await flows.deleteFlow({id:"1"});
            deploySpy.callCount.should.equal(5);
            deploySpy.getCalls().slice(2).forEach(c => c.args[0].should.have.property("type","flows"));
            deploySpy.getCalls().forEach(c => c.args[0].should.have.property("source","api"));
        });
        it("setState waits for running deploy (R-11)", async function() {
            runtime.flows.setFlows = pendingSetFlows();
            const deploy = flows.setFlows({flows:{flows:[1]}});
            const setState = flows.setState({state:"stop"});
            await new Promise(resolve => setTimeout(resolve, 10));
            order.should.eql(["setFlows:start"]);
            release();
            await deploy;
            const state = await setState;
            state.should.have.property("state");
            order.should.eql(["setFlows:start", "setFlows:end", "stopFlows"]);
        });
        it("setState does not reject with 409 while deploy runs (R-11)", async function() {
            runtime.flows.setFlows = pendingSetFlows();
            const deploy = flows.setFlows({flows:{flows:[1]}});
            const setState = flows.setState({state:"start"});
            await new Promise(resolve => setTimeout(resolve, 10));
            release();
            await deploy;
            await setState.should.be.fulfilled();
            runtime.flows.startFlows.calledOnce.should.be.true();
        });
        it("a deploy waits for a running setState", async function() {
            let releaseStop;
            runtime.flows.stopFlows = sinon.spy(function() {
                order.push("stopFlows:start");
                return new Promise(resolve => { releaseStop = () => { order.push("stopFlows:end"); resolve() } });
            });
            const setState = flows.setState({state:"stop"});
            const add = flows.addFlow({flow:{}});
            await new Promise(resolve => setTimeout(resolve, 10));
            order.should.eql(["stopFlows:start"]);
            releaseStop();
            await setState;
            await add;
            order.should.eql(["stopFlows:start", "stopFlows:end", "addFlow"]);
        });
        it("setState and a second deploy wait for the start of the first deploy (R-43)", async function() {
            const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");
            let finishStart;
            runtime.flows.setFlows = sinon.spy(function() {
                order.push("setFlows");
                // as flows.setFlows: the start runs asynchronously to the result
                lock.holdUntil(new Promise(resolve => { finishStart = () => { order.push("started"); resolve() } }));
                return Promise.resolve("newRev");
            });
            const result = await flows.setFlows({flows:{flows:[1]}});
            // The response does not wait for the start (default behaviour)
            result.should.eql({rev:"newRev"});
            const setState = flows.setState({state:"stop"});
            const add = flows.addFlow({flow:{}});
            await new Promise(resolve => setTimeout(resolve, 10));
            order.should.eql(["setFlows"]);
            finishStart();
            await setState;
            await add;
            order.should.eql(["setFlows", "started", "stopFlows", "addFlow"]);
        });
        it("setState releases the lock when it fails", async function() {
            runtime.flows.stopFlows = sinon.spy(function() { return Promise.reject(new Error("stop failed")) });
            await flows.setState({state:"stop"}).should.be.rejected();
            await flows.setFlows({flows:{flows:[1]}}).should.be.fulfilled();
        });
        it("single-flow entries wait for a running deploy", async function() {
            runtime.flows.setFlows = pendingSetFlows();
            const deploy = flows.setFlows({flows:{flows:[1]}});
            const add = flows.addFlow({flow:{}});
            const update = flows.updateFlow({id:"1",flow:{}});
            const remove = flows.deleteFlow({id:"1"});
            await new Promise(resolve => setTimeout(resolve, 10));
            order.should.eql(["setFlows:start"]);
            release();
            await Promise.all([deploy, add, update, remove]);
            order.should.eql(["setFlows:start", "setFlows:end", "addFlow", "updateFlow", "removeFlow"]);
        });
    });

    describe("deploy.response (P-01)", function() {
        let runtime;
        function initRuntime(deploySettings) {
            runtime = {
                log: mockLog(),
                settings: { deploy: deploySettings },
                flows: {
                    getFlows: function() { return {rev:"currentRev",flows:[]} },
                    setFlows: sinon.spy(function() { return Promise.resolve("newRev") }),
                    loadFlows: sinon.spy(function() { return Promise.resolve("loadRev") }),
                    readFlowsFromStorage: sinon.spy(function() { return Promise.resolve({flows:[],rev:"storedRev"}) }),
                    addFlow: sinon.spy(function() { return Promise.resolve("newId") }),
                    updateFlow: sinon.spy(function() { return Promise.resolve() }),
                    removeFlow: sinon.spy(function() { return Promise.resolve() })
                }
            };
            if (deploySettings === undefined) {
                delete runtime.settings.deploy;
            }
            flows.init(runtime);
        }
        function startFailed() {
            const err = new Error("Deployment saved, but the flows did not start");
            err.code = "deploy_start_failed";
            err.status = 500;
            err.rev = "newRev";
            err.errors = [{code:"missing_types", message:"Missing node types", types:["missing"]}];
            return err;
        }
        it("setFlows passes waitForStart when deploy.response is started", async function() {
            initRuntime({response:"started"});
            await flows.setFlows({flows:{flows:[1]}});
            runtime.flows.setFlows.firstCall.args[6].should.eql({waitForStart:true});
        });
        it("reload passes waitForStart when deploy.response is started", async function() {
            initRuntime({response:"started"});
            await flows.setFlows({deploymentType:"reload"});
            runtime.flows.loadFlows.firstCall.args[1].should.eql({waitForStart:true});
        });
        it("addFlow/updateFlow/deleteFlow pass waitForStart", async function() {
            initRuntime({response:"started"});
            await flows.addFlow({flow:{}});
            await flows.updateFlow({id:"1",flow:{}});
            await flows.deleteFlow({id:"1"});
            runtime.flows.addFlow.firstCall.args[2].should.eql({waitForStart:true});
            runtime.flows.updateFlow.firstCall.args[3].should.eql({waitForStart:true});
            runtime.flows.removeFlow.firstCall.args[2].should.eql({waitForStart:true});
        });
        it("no deployOpts when setting absent or stopped", async function() {
            for (const deploySettings of [undefined, {}, {response:"stopped"}]) {
                initRuntime(deploySettings);
                await flows.setFlows({flows:{flows:[1]}});
                await flows.addFlow({flow:{}});
                should.not.exist(runtime.flows.setFlows.firstCall.args[6]);
                should.not.exist(runtime.flows.addFlow.firstCall.args[2]);
                runtime.log.warn.called.should.be.false();
            }
        });
        it("invalid deploy.response logs warning and falls back to stopped", async function() {
            initRuntime({response:"later"});
            runtime.log.warn.calledOnce.should.be.true();
            await flows.setFlows({flows:{flows:[1]}});
            should.not.exist(runtime.flows.setFlows.firstCall.args[6]);
        });
        it("invalid deploy.startTimeout logs warning", function() {
            initRuntime({response:"started", startTimeout:"soon"});
            runtime.log.warn.calledOnce.should.be.true();
        });
        it("maps deploy_start_failed to status 500 with rev and errors", async function() {
            initRuntime({response:"started"});
            runtime.flows.setFlows = sinon.spy(function() { return Promise.reject(startFailed()) });
            const err = await flows.setFlows({flows:{flows:[1]}}).should.be.rejected();
            err.should.have.property("code","deploy_start_failed");
            err.should.have.property("status",500);
            err.should.have.property("rev","newRev");
            err.errors[0].should.have.property("code","missing_types");
        });
        it("keeps status 500 of deploy_start_failed and deploy_stop_failed for the single-flow api", async function() {
            initRuntime({response:"started"});
            runtime.flows.addFlow = sinon.spy(function() { return Promise.reject(startFailed()) });
            runtime.flows.updateFlow = sinon.spy(function() { return Promise.reject(startFailed()) });
            runtime.flows.removeFlow = sinon.spy(function() {
                const err = new Error("stop failed");
                err.code = "deploy_stop_failed";
                err.status = 500;
                err.rev = "newRev";
                return Promise.reject(err);
            });
            let err = await flows.addFlow({flow:{}}).should.be.rejected();
            err.should.have.property("status",500);
            err.should.have.property("rev","newRev");
            err = await flows.updateFlow({id:"1",flow:{}}).should.be.rejected();
            err.should.have.property("status",500);
            err.should.have.property("code","deploy_start_failed");
            err = await flows.deleteFlow({id:"1"}).should.be.rejected();
            err.should.have.property("status",500);
            err.should.have.property("code","deploy_stop_failed");
        });
        it("other single-flow errors keep status 400", async function() {
            initRuntime({response:"started"});
            runtime.flows.addFlow = sinon.spy(function() { return Promise.reject(new Error("duplicate id")) });
            const err = await flows.addFlow({flow:{}}).should.be.rejected();
            err.should.have.property("status",400);
        });
    });

    describe("single-flow api (Z-04)", function() {
        let runtime;
        let revisions;
        function initRuntime(deploySettings) {
            revisions = { t1: "rev-t1", global: "rev-global" };
            runtime = {
                log: mockLog(),
                settings: deploySettings ? { deploy: deploySettings } : {},
                flows: {
                    getFlows: function() { return {rev:"rev-all",flows:[]} },
                    getFlow: sinon.spy(function(id) { return id === "t1" ? {id:"t1",label:"Flow 1",nodes:[]} : null }),
                    getFlowRevision: sinon.spy(function(id) { return revisions[id] || null }),
                    addFlow: sinon.spy(function(flow) { revisions.added = "rev-added"; return Promise.resolve("added") }),
                    updateFlow: sinon.spy(function(id, flow, user, deployOpts, opts) {
                        if (!revisions[id] && !(opts && opts.create)) {
                            const err = new Error();
                            err.code = 404;
                            return Promise.reject(err);
                        }
                        const created = !revisions[id];
                        revisions[id] = "rev-" + id + "-updated";
                        return Promise.resolve({created: created});
                    }),
                    removeFlow: sinon.spy(function() { return Promise.resolve() })
                }
            };
            flows.init(runtime);
        }
        async function rejected(promise) {
            try {
                await promise;
            } catch(err) {
                return err;
            }
            throw new Error("not rejected");
        }

        it("returns rev only for v2", async function() {
            initRuntime();
            const v1 = await flows.getFlow({id:"t1"});
            v1.should.not.have.property("rev");
            const v2 = await flows.getFlow({id:"t1", apiVersion:"v2"});
            v2.should.have.property("rev","rev-t1");
            v2.should.have.property("label","Flow 1");
        });
        it("accepts matching rev", async function() {
            initRuntime();
            const id = await flows.updateFlow({id:"t1", flow:{id:"t1", label:"x", nodes:[], rev:"rev-t1"}});
            id.should.equal("t1");
            runtime.flows.updateFlow.calledOnce.should.be.true();
            // rev is not stored with the flow
            runtime.flows.updateFlow.firstCall.args[1].should.eql({id:"t1", label:"x", nodes:[]});
        });
        it("returns the new revisions for v2", async function() {
            initRuntime();
            const result = await flows.updateFlow({id:"t1", flow:{nodes:[], rev:"rev-t1"}, apiVersion:"v2"});
            result.should.eql({id:"t1", rev:"rev-t1-updated", revAll:"rev-all", created:false});
        });
        it("rejects stale rev with 409 version_mismatch", async function() {
            initRuntime();
            const err = await rejected(flows.updateFlow({id:"t1", flow:{nodes:[], rev:"old"}}));
            err.should.have.property("code","version_mismatch");
            err.should.have.property("status",409);
            runtime.flows.updateFlow.called.should.be.false();
        });
        it("rejects an empty rev with 409 version_mismatch (N-01)", async function() {
            initRuntime();
            const err = await rejected(flows.updateFlow({id:"t1", flow:{nodes:[], rev:""}}));
            err.should.have.property("code","version_mismatch");
        });
        it("rejects rev of a wrong type with 400 invalid_revision", async function() {
            initRuntime();
            for (const rev of [5, {}, true]) {
                const err = await rejected(flows.updateFlow({id:"t1", flow:{nodes:[], rev:rev}}));
                err.should.have.property("code","invalid_revision");
                err.should.have.property("status",400);
            }
            const err = await rejected(flows.addFlow({flow:{nodes:[], globalConfigs:[], globalRev:7}}));
            err.should.have.property("code","invalid_revision");
            runtime.flows.updateFlow.called.should.be.false();
            runtime.flows.addFlow.called.should.be.false();
        });
        it("rev null with existing flow returns 409", async function() {
            initRuntime({putCreatesFlow:true});
            const err = await rejected(flows.updateFlow({id:"t1", flow:{nodes:[], rev:null}}));
            err.should.have.property("code","version_mismatch");
        });
        it("putCreatesFlow false returns 404", async function() {
            for (const deploySettings of [undefined, {putCreatesFlow:false}]) {
                initRuntime(deploySettings);
                const err = await rejected(flows.updateFlow({id:"new1", flow:{nodes:[]}}));
                err.should.have.property("code","not_found");
                err.should.have.property("status",404);
                should.not.exist(runtime.flows.updateFlow.firstCall.args[4]);
            }
        });
        it("putCreatesFlow true creates flow", async function() {
            initRuntime({putCreatesFlow:true});
            const result = await flows.updateFlow({id:"new1", flow:{nodes:[], rev:null}, apiVersion:"v2"});
            result.should.eql({id:"new1", rev:"rev-new1-updated", revAll:"rev-all", created:true});
            runtime.flows.updateFlow.firstCall.args[4].should.have.property("create", true);
            const v1 = await flows.updateFlow({id:"new2", flow:{nodes:[]}});
            v1.should.equal("new2");
        });
        it("putCreatesFlow true with a rev of a missing flow returns 409", async function() {
            initRuntime({putCreatesFlow:true});
            const err = await rejected(flows.updateFlow({id:"new1", flow:{nodes:[], rev:"rev-x"}}));
            err.should.have.property("code","version_mismatch");
            runtime.flows.updateFlow.called.should.be.false();
        });
        it("passes globalConfigs and checks globalRev", async function() {
            initRuntime();
            await flows.updateFlow({id:"t1", flow:{nodes:[], globalConfigs:[{id:"c1",type:"cfg"}], globalRev:"rev-global"}});
            runtime.flows.updateFlow.firstCall.args[1].should.eql({nodes:[]});
            runtime.flows.updateFlow.firstCall.args[4].should.have.property("globalConfigs", [{id:"c1",type:"cfg"}]);
            await flows.addFlow({flow:{nodes:[], globalConfigs:[{id:"c2",type:"cfg"}]}});
            runtime.flows.addFlow.firstCall.args[0].should.eql({nodes:[]});
            runtime.flows.addFlow.firstCall.args[3].should.have.property("globalConfigs", [{id:"c2",type:"cfg"}]);
        });
        it("globalRev mismatch returns 409", async function() {
            initRuntime();
            let err = await rejected(flows.updateFlow({id:"t1", flow:{nodes:[], globalConfigs:[], globalRev:"old"}}));
            err.should.have.property("code","version_mismatch");
            err = await rejected(flows.addFlow({flow:{nodes:[], globalConfigs:[], globalRev:"old"}}));
            err.should.have.property("code","version_mismatch");
            err.should.have.property("status",409);
            runtime.flows.addFlow.called.should.be.false();
        });
        it("addFlow ignores rev of the new flow (unchanged)", async function() {
            initRuntime();
            (await flows.addFlow({flow:{nodes:[], rev:"anything"}})).should.equal("added");
            runtime.flows.addFlow.firstCall.args[0].should.eql({nodes:[]});
        });
        it("addFlow returns id and rev for v2", async function() {
            initRuntime();
            (await flows.addFlow({flow:{nodes:[]}, apiVersion:"v2"})).should.eql({id:"added", rev:"rev-added"});
            (await flows.addFlow({flow:{nodes:[]}})).should.equal("added");
        });
        it("concurrent updates with same rev – one 409", async function() {
            initRuntime();
            const results = await Promise.all([
                flows.updateFlow({id:"t1", flow:{nodes:[], rev:"rev-t1"}}).then(() => "ok", err => err.code),
                flows.updateFlow({id:"t1", flow:{nodes:[], rev:"rev-t1"}}).then(() => "ok", err => err.code)
            ]);
            results.sort().should.eql(["ok","version_mismatch"]);
        });
        it("deleteFlow checks an optional rev", async function() {
            initRuntime();
            let err = await rejected(flows.deleteFlow({id:"t1", rev:"old"}));
            err.should.have.property("code","version_mismatch");
            err.should.have.property("status",409);
            runtime.flows.removeFlow.called.should.be.false();
            await flows.deleteFlow({id:"t1", rev:"rev-t1"});
            runtime.flows.removeFlow.calledOnce.should.be.true();
        });
        it("calls without the new fields are unchanged", async function() {
            initRuntime();
            const flow = {id:"t1", label:"x", nodes:[]};
            (await flows.updateFlow({id:"t1", flow:flow})).should.equal("t1");
            runtime.flows.updateFlow.firstCall.args[1].should.equal(flow);
            runtime.flows.getFlowRevision.called.should.be.false();
        });
    });

    describe("requireRevision (Z-05)", function() {
        let runtime;
        let revisions;
        function initRuntime(deploySettings) {
            revisions = { t1: "rev-t1", global: "rev-global" };
            runtime = {
                log: mockLog(),
                settings: deploySettings === undefined ? {} : { deploy: deploySettings },
                flows: {
                    getFlows: function() { return {rev:"rev-all",flows:[]} },
                    getFlowRevision: function(id) { return revisions[id] || null },
                    setFlows: sinon.spy(function() { return Promise.resolve("newRev") }),
                    loadFlows: sinon.spy(function() { return Promise.resolve("loadRev") }),
                    readFlowsFromStorage: sinon.spy(function() { return Promise.resolve({flows:[],rev:"storedRev"}) }),
                    addFlow: sinon.spy(function() { return Promise.resolve("added") }),
                    updateFlow: sinon.spy(function(id, flow, user, deployOpts, opts) {
                        if (!revisions[id] && !(opts && opts.create)) {
                            const err = new Error();
                            err.code = 404;
                            return Promise.reject(err);
                        }
                        return Promise.resolve({created: !revisions[id]});
                    }),
                    removeFlow: sinon.spy(function() { return Promise.resolve() })
                }
            };
            flows.init(runtime);
        }
        async function outcome(promise) {
            try {
                await promise;
                return "ok";
            } catch(err) {
                return err.status + " " + err.code;
            }
        }
        function deployed() {
            return runtime.flows.setFlows.called || runtime.flows.updateFlow.called || runtime.flows.addFlow.called || runtime.flows.removeFlow.called;
        }

        [false, true].forEach(function(required) {
            describe("deploy.requireRevision: " + required, function() {
                const expectRequired = required ? "409 version_required" : "ok";
                beforeEach(function() {
                    initRuntime({requireRevision: required, putCreatesFlow: true});
                });
                it("setFlows without rev", async function() {
                    (await outcome(flows.setFlows({flows:{flows:[1]}, apiVersion:"v2"}))).should.equal(expectRequired);
                    deployed().should.equal(!required);
                });
                it("setFlows v1 without rev", async function() {
                    (await outcome(flows.setFlows({flows:{flows:[1]}, apiVersion:"v1"}))).should.equal(expectRequired);
                    deployed().should.equal(!required);
                });
                it("setFlows with the current rev", async function() {
                    (await outcome(flows.setFlows({flows:{flows:[1], rev:"rev-all"}, apiVersion:"v2"}))).should.equal("ok");
                });
                it("setFlows with a stale rev", async function() {
                    (await outcome(flows.setFlows({flows:{flows:[1], rev:"old"}, apiVersion:"v2"}))).should.equal("409 version_mismatch");
                });
                it("setFlows with an empty rev (N-01)", async function() {
                    (await outcome(flows.setFlows({flows:{flows:[1], rev:""}, apiVersion:"v2"}))).should.equal(required ? "409 version_required" : "409 version_mismatch");
                    (await outcome(flows.setFlows({flows:{flows:[1], rev:null}, apiVersion:"v2"}))).should.equal(required ? "409 version_required" : "409 version_mismatch");
                });
                it("setFlows reload without rev", async function() {
                    (await outcome(flows.setFlows({deploymentType:"reload", apiVersion:"v1"}))).should.equal("ok");
                    runtime.flows.loadFlows.calledOnce.should.be.true();
                });
                it("updateFlow without rev", async function() {
                    (await outcome(flows.updateFlow({id:"t1", flow:{nodes:[]}}))).should.equal(expectRequired);
                    deployed().should.equal(!required);
                });
                it("updateFlow global without rev", async function() {
                    (await outcome(flows.updateFlow({id:"global", flow:{configs:[]}}))).should.equal(expectRequired);
                });
                it("updateFlow with an empty or null rev of an existing flow", async function() {
                    (await outcome(flows.updateFlow({id:"t1", flow:{nodes:[], rev:""}}))).should.equal(required ? "409 version_required" : "409 version_mismatch");
                    (await outcome(flows.updateFlow({id:"t1", flow:{nodes:[], rev:null}}))).should.equal(required ? "409 version_required" : "409 version_mismatch");
                });
                it("updateFlow with the current rev", async function() {
                    (await outcome(flows.updateFlow({id:"t1", flow:{nodes:[], rev:"rev-t1"}}))).should.equal("ok");
                });
                it("updateFlow create with rev null", async function() {
                    (await outcome(flows.updateFlow({id:"new1", flow:{nodes:[], rev:null}}))).should.equal("ok");
                });
                it("updateFlow create without rev", async function() {
                    (await outcome(flows.updateFlow({id:"new1", flow:{nodes:[]}}))).should.equal(expectRequired);
                });
                it("updateFlow with rev of a wrong type", async function() {
                    (await outcome(flows.updateFlow({id:"t1", flow:{nodes:[], rev:5}}))).should.equal("400 invalid_revision");
                });
                it("addFlow without globalConfigs", async function() {
                    (await outcome(flows.addFlow({flow:{nodes:[]}}))).should.equal("ok");
                });
                it("addFlow with globalConfigs without globalRev", async function() {
                    (await outcome(flows.addFlow({flow:{nodes:[], globalConfigs:[{id:"c1",type:"x"}]}}))).should.equal(expectRequired);
                    (await outcome(flows.addFlow({flow:{nodes:[], globalConfigs:[{id:"c1",type:"x"}], globalRev:"rev-global"}}))).should.equal("ok");
                });
                it("updateFlow with globalConfigs without globalRev", async function() {
                    (await outcome(flows.updateFlow({id:"t1", flow:{nodes:[], rev:"rev-t1", globalConfigs:[{id:"c1",type:"x"}]}}))).should.equal(expectRequired);
                    deployed().should.equal(!required);
                    (await outcome(flows.updateFlow({id:"t1", flow:{nodes:[], rev:"rev-t1", globalConfigs:[{id:"c1",type:"x"}], globalRev:""}}))).should.equal(required ? "409 version_required" : "409 version_mismatch");
                    (await outcome(flows.updateFlow({id:"t1", flow:{nodes:[], rev:"rev-t1", globalConfigs:[{id:"c1",type:"x"}], globalRev:"rev-global"}}))).should.equal("ok");
                });
                it("updateFlow without globalConfigs does not need globalRev", async function() {
                    (await outcome(flows.updateFlow({id:"t1", flow:{nodes:[], rev:"rev-t1"}}))).should.equal("ok");
                });
                it("deleteFlow without rev", async function() {
                    (await outcome(flows.deleteFlow({id:"t1"}))).should.equal(expectRequired);
                    (await outcome(flows.deleteFlow({id:"t1", rev:"rev-t1"}))).should.equal("ok");
                });
            });
        });
        it("missing deploy settings object treated as false", async function() {
            initRuntime();
            (await outcome(flows.setFlows({flows:{flows:[1]}, apiVersion:"v1"}))).should.equal("ok");
            (await outcome(flows.deleteFlow({id:"t1"}))).should.equal("ok");
        });
        it("v1 is told to use the v2 api", async function() {
            initRuntime({requireRevision: true});
            runtime.log._ = function(key) { return key };
            let error;
            try {
                await flows.setFlows({flows:{flows:[1]}, apiVersion:"v1"});
            } catch(err) {
                error = err;
            }
            error.should.have.property("code","version_required");
            error.message.should.equal("api.flows.version-required-v1");
        });
        it("version_required is audited", async function() {
            initRuntime({requireRevision: true});
            await outcome(flows.updateFlow({id:"t1", flow:{nodes:[]}}));
            runtime.log.audit.calledWithMatch({event:"flow.update", error:"version_required"}).should.be.true();
            await outcome(flows.setFlows({flows:{flows:[1]}, apiVersion:"v2"}));
            runtime.log.audit.calledWithMatch({event:"flows.set", error:"version_required"}).should.be.true();
        });
    });
});
