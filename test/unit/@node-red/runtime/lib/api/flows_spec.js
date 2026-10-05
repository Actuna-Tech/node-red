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
 *   E-02: setState moves the instance state between idle and ready
 *   Z-15: editorOnly - setState start 409 editor_only, stop without effect, the
 *   deployment response {rev, started: false} with deploy.response "started"
 *   P-01: tests of deploy.response "started" (waitForStart, deploy errors with status 500)
 *   Z-04: tests of the single-flow api (rev, globalRev, globalConfigs, putCreatesFlow)
 *   Z-05: tests of deploy.requireRevision in both states
 *   R-45: warnings for deploy.startTimeoutReleasesLock
 *   W-3: revisions of the flow and of the whole configuration in deploy errors of /flow
 *   P-02: warning for editorTheme.deploy.staleFlows "reload-only" without deploy.requireRevision
 *   #2: the v2 result of getFlows is only {flows, rev} - no digest of the credentials
 *   #40: setState stop with deploy.drainHttpNodeRequests waits for the accepted requests and answers
 *   the open ones with 503
 *   Z-06 (#10): a rejected single-flow request does not change the instance state (A24, U1);
 *   a reload from the api reads storage and loads the credentials as before (D15, A32 - guards);
 *   the preDeploy hook through the runtime api (the event, 400/503/503, nothing saved, audit with the reason);
 *   a reload rejected by the hook changes nothing (I12, D15, D26)
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
        it("returns only {flows, rev} of the active configuration - no digest of the credentials (#2)", async function() {
            const credentials = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/credentials");
            const runtimeFlows = NR_TEST_UTILS.require("@node-red/runtime/lib/flows");
            const stored = { n1: { user: "abc", password: "secret-password-123" } };
            const load = sinon.stub(credentials, "load").callsFake(async function() {});
            try {
                const config = [{ id: "t1", type: "tab" }];
                runtimeFlows.init({
                    log: mockLog(),
                    settings: {},
                    storage: { getFlows: async () => ({ flows: config, rev: "A", credentials: stored }) }
                });
                await runtimeFlows.load();
                flows.init({ log: mockLog(), flows: runtimeFlows });
                const result = await flows.getFlows({});
                // what GET /flows (v2) serialises
                Object.keys(result).sort().should.eql(["flows", "rev"]);
                result.rev.should.equal("A");
                const digest = credentials.digest(stored);
                const json = JSON.stringify(result);
                json.should.not.containEql(digest);
                json.should.not.containEql("secret-password-123");
                runtimeFlows.credentialsChanged({ credentials: stored }).should.be.false();
            } finally {
                load.restore();
            }
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
                    readStoredFlows: function() { return Promise.resolve({flows:[],rev:"storedRev"}) },
                    loadStoredCredentials: function(config) { return Promise.resolve(config) }
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
                return Promise.resolve("newId");
            });
            flows.init({
                log: mockLog(),
                flows: {
                    // Z-06 (U1): the build runs in step 2 (prepare), so its errors are thrown there
                    buildAddFlowConfig: function(flow) {
                        if (flow === "error") {
                            var err = new Error("error");
                            err.code = "error";
                            throw err;
                        }
                        return {config: [], id: "newId"};
                    },
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
                return Promise.resolve();
            });
            flows.init({
                log: mockLog(),
                flows: {
                    // Z-06 (U1): the build runs in step 2 (prepare), so its errors are thrown there
                    buildUpdateFlowConfig: function(id) {
                        if (id === "unknown") {
                            var err = new Error();
                            // TODO: quirk of internal api - uses .code for .status
                            err.code = 404;
                            throw err;
                        } else if (id === "error") {
                            var err = new Error();
                            // TODO: quirk of internal api - uses .code for .status
                            err.code = "error";
                            throw err;
                        }
                        return {config: [], label: id, created: false};
                    },
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
                return Promise.resolve();
            });
            flows.init({
                log: mockLog(),
                flows: {
                    // Z-06 (U1): the build runs in step 2 (prepare), so its errors are thrown there
                    buildRemoveFlowConfig: function(flow) {
                        if (flow === "unknown") {
                            var err = new Error();
                            // TODO: quirk of internal api - uses .code for .status
                            err.code = 404;
                            throw err;
                        } else if (flow === "error") {
                            var err = new Error();
                            // TODO: quirk of internal api - uses .code for .status
                            err.code = "error";
                            throw err;
                        }
                        return {config: [], flow: {id: flow}};
                    },
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
        it("editorOnly: setState start returns 409 editor_only without saving runtimeFlowState", async function() {
            runtime.settings.editorOnly = true;
            runtime.settings.set = sinon.spy();
            flows.init(runtime);
            let err;
            try {
                await flows.setState({state:"start"});
            } catch (error) {
                err = error;
            }
            should(err).have.property("code", "editor_only");
            should(err).have.property("status", 409);
            startFlows.called.should.be.false();
            runtime.settings.set.called.should.be.false();
        });
        it("editorOnly: setState stop is no-op", async function() {
            runtime.settings.editorOnly = true;
            runtime.settings.set = sinon.spy();
            flows.init(runtime);
            const state = await flows.setState({state:"stop"});
            state.should.have.property("state");
            stopFlows.called.should.be.false();
            runtime.settings.set.called.should.be.false();
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
        describe("stop with the drain of the HTTP requests (#40)", function() {
            const EventEmitter = require("events");
            const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
            const credentials = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/credentials");
            const runtimeFlows = NR_TEST_UTILS.require("@node-red/runtime/lib/flows");
            const httpDrain = NR_TEST_UTILS.require("@node-red/runtime/lib/httpDrain");
            const typeRegistry = NR_TEST_UTILS.require("@node-red/registry");
            let load;
            let checkDependencies;
            function fakeRequest(method) {
                const req = new EventEmitter();
                req.method = method || "POST";
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
                return { req, res, entry: req[httpDrain.S] };
            }
            function flush() {
                return new Promise(resolve => setImmediate(resolve));
            }
            beforeEach(async function() {
                instanceState.reset();
                instanceState.markStarting();
                load = sinon.stub(credentials, "load").callsFake(async function() {});
                checkDependencies = sinon.stub(typeRegistry, "checkFlowDependencies").callsFake(async function() {});
                runtimeFlows.init({
                    log: mockLog(),
                    settings: {},
                    storage: { getFlows: async () => ({ flows: [{ id: "t1", type: "tab" }], rev: "A" }) }
                });
                await runtimeFlows.load();
                await runtimeFlows.startFlows();
                runtimeFlows.started.should.be.true();
                instanceState.get().should.containEql({state:"ready"});
                runtime.flows = runtimeFlows;
            });
            afterEach(async function() {
                httpDrain.dispose();
                await runtimeFlows.stopFlows();
                load.restore();
                checkDependencies.restore();
                instanceState.reset();
            });

            it("waits for the accepted requests, which the flows answer, and then stops", async function() {
                httpDrain.init({ deploy: { drainHttpNodeRequests: { enabled: true, timeout: 5000 } } });
                const request = fakeRequest();
                request.entry.accepted = true;
                flows.init(runtime);
                const promise = flows.setState({state:"stop"});
                await flush();
                runtimeFlows.started.should.be.true();
                request.res.end("answered by the flow");
                const state = await promise;
                state.should.have.property("state", "stop");
                request.res.body.should.equal("answered by the flow");
                runtimeFlows.started.should.be.false();
                instanceState.get().should.containEql({state:"idle", reason:"set-state"});
            });
            it("answers 503 to every open request after the stop, by the outcome for the client", async function() {
                // the limit of the wait: 30 ms of real time
                httpDrain.init({ deploy: { drainHttpNodeRequests: { enabled: true, timeout: 30 } } });
                const accepted = fakeRequest("POST");
                accepted.entry.accepted = true;
                const notAccepted = fakeRequest("POST");
                const unrouted = fakeRequest("GET");
                unrouted.req.route = null;
                flows.init(runtime);
                const state = await flows.setState({state:"stop"});
                state.should.have.property("state", "stop");
                accepted.res.statusCode.should.equal(503);
                JSON.parse(accepted.res.body).code.should.equal("http_drain_outcome_unknown");
                notAccepted.res.statusCode.should.equal(503);
                JSON.parse(notAccepted.res.body).code.should.equal("http_drain_not_accepted");
                unrouted.res.writableEnded.should.be.false();
                runtimeFlows.started.should.be.false();
            });
            it("without the setting the open requests are not touched", async function() {
                const request = fakeRequest();
                request.res.writableEnded.should.be.false();
                flows.init(runtime);
                await flows.setState({state:"stop"});
                request.res.writableEnded.should.be.false();
                httpDrain.size().should.equal(0);
            });
        });
        describe("instance state (E-02)", function() {
            const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
            beforeEach(function() {
                instanceState.reset();
                instanceState.markStarting();
                instanceState.report({errors:[]});
            });
            afterEach(function() {
                instanceState.reset();
            });
            it("setState stop/start transitions ready -> idle -> ready", async function() {
                flows.init(runtime);
                const seen = [];
                const off = instanceState.onChange(info => seen.push(info.state + "/" + info.reason));
                await flows.setState({state:"stop"});
                instanceState.get().should.containEql({state:"idle", reason:"set-state"});
                await flows.setState({state:"start"});
                off();
                instanceState.get().should.containEql({state:"ready", previous:"idle", reason:"set-state"});
                seen.should.eql(["idle/set-state", "ready/set-state"]);
            });
            it("setState start with start errors sets failed", async function() {
                runtime.flows.startFlows = sinon.spy(async () => ({errors:[{code:"missing_types", message:"m"}]}));
                flows.init(runtime);
                await flows.setState({state:"start"});
                instanceState.get().should.containEql({state:"failed", reason:"missing-types"});
            });
            it("setState start with flows not started on purpose (safe mode) sets idle", async function() {
                runtime.flows.startFlows = sinon.spy(async () => ({errors:[{code:"safe_mode"}], flowsRunning:false, reason:"safe-mode"}));
                flows.init(runtime);
                await flows.setState({state:"start"});
                instanceState.get().should.containEql({state:"idle", reason:"safe-mode"});
            });
            it("a rejected start sets failed", async function() {
                runtime.flows.startFlows = sinon.spy(async () => { throw new Error("boom") });
                flows.init(runtime);
                await flows.setState({state:"start"}).should.be.rejected();
                instanceState.get().should.containEql({state:"failed", reason:"flow-start-failed"});
            });
            it("a rejected stop keeps the state", async function() {
                runtime.flows.stopFlows = sinon.spy(async () => { throw new Error("boom") });
                flows.init(runtime);
                await flows.setState({state:"stop"}).should.be.rejected();
                instanceState.get().state.should.equal("ready");
            });
            it("an invalid state does not change the instance state", async function() {
                flows.init(runtime);
                const seen = [];
                const off = instanceState.onChange(info => seen.push(info.state));
                await flows.setState({state:"bad-state"}).should.be.rejected();
                off();
                seen.should.eql([]);
            });
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
                    readStoredFlows: sinon.spy(function() { return Promise.resolve({flows:[],rev:"storedRev"}) }),
                    loadStoredCredentials: sinon.spy(function(config) { return Promise.resolve(config) }),
                    buildAddFlowConfig: function() { return {config: [], id: "newId"} },
                    buildUpdateFlowConfig: function() { return {config: [], label: "l", created: false} },
                    buildRemoveFlowConfig: function() { return {config: [], flow: {id: "1"}} },
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
                    getFlowRevision: function(id) { return "flowRev-" + id },
                    setFlows: sinon.spy(function() { return Promise.resolve("newRev") }),
                    loadFlows: sinon.spy(function() { return Promise.resolve("loadRev") }),
                    readStoredFlows: sinon.spy(function() { return Promise.resolve({flows:[],rev:"storedRev"}) }),
                    loadStoredCredentials: sinon.spy(function(config) { return Promise.resolve(config) }),
                    buildAddFlowConfig: function() { return {config: [], id: "newId"} },
                    buildUpdateFlowConfig: function() { return {config: [], label: "l", created: false} },
                    buildRemoveFlowConfig: function() { return {config: [], flow: {id: "1"}} },
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
        it("editorOnly: response {rev, started: false} with deploy.response started (R-39)", async function() {
            initRuntime({response:"started"});
            runtime.settings.editorOnly = true;
            const result = await flows.setFlows({flows:{flows:[1]}});
            result.should.eql({rev:"newRev", started:false});
            const reload = await flows.setFlows({deploymentType:"reload"});
            reload.should.eql({rev:"loadRev", started:false});
        });
        it("editorOnly: response {rev} with the default deploy.response", async function() {
            initRuntime(undefined);
            runtime.settings.editorOnly = true;
            const result = await flows.setFlows({flows:{flows:[1]}});
            result.should.eql({rev:"newRev"});
        });
        it("editorOnly: single-flow v2 responses carry started: false with deploy.response started", async function() {
            initRuntime({response:"started"});
            runtime.settings.editorOnly = true;
            const added = await flows.addFlow({flow:{label:"x"}, apiVersion:"v2"});
            added.should.have.property("started", false);
            const updated = await flows.updateFlow({id:"f1", flow:{label:"x"}, apiVersion:"v2"});
            updated.should.have.property("started", false);
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
        it("deploy.startTimeoutReleasesLock: no warning for false or true with startTimeout (R-45)", function() {
            for (const deploySettings of [{startTimeout:1000}, {startTimeout:1000, startTimeoutReleasesLock:false}, {startTimeout:1000, startTimeoutReleasesLock:true}, {startTimeoutReleasesLock:false}]) {
                initRuntime(deploySettings);
                runtime.log.warn.called.should.be.false();
            }
        });
        it("invalid deploy.startTimeoutReleasesLock logs warning (R-45)", function() {
            initRuntime({startTimeout:1000, startTimeoutReleasesLock:"yes"});
            runtime.log.warn.calledOnce.should.be.true();
        });
        it("deploy.startTimeoutReleasesLock without startTimeout logs warning (R-45)", function() {
            initRuntime({startTimeoutReleasesLock:true});
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
            runtime.flows.addFlow = sinon.spy(function(flow) { flow.id = "f1"; return Promise.reject(startFailed()) });
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
            // W-3: rev of the flow, revAll of the whole configuration
            err.should.have.property("rev","flowRev-f1");
            err.should.have.property("revAll","newRev");
            err = await flows.updateFlow({id:"1",flow:{}}).should.be.rejected();
            err.should.have.property("status",500);
            err.should.have.property("code","deploy_start_failed");
            err = await flows.deleteFlow({id:"1"}).should.be.rejected();
            err.should.have.property("status",500);
            err.should.have.property("code","deploy_stop_failed");
        });
        it("setFlows (/flows): rev of a deploy error stays the revision of the whole configuration (W-3)", async function() {
            initRuntime({response:"started"});
            runtime.flows.setFlows = sinon.spy(function() { return Promise.reject(startFailed()) });
            const err = await flows.setFlows({flows:{flows:[1]}, apiVersion:"v2"}).should.be.rejected();
            err.should.have.property("rev","newRev");
            err.should.not.have.property("revAll");
        });
        it("other single-flow errors keep status 400", async function() {
            initRuntime({response:"started"});
            runtime.flows.addFlow = sinon.spy(function() { return Promise.reject(new Error("duplicate id")) });
            const err = await flows.addFlow({flow:{}}).should.be.rejected();
            err.should.have.property("status",400);
        });
    });

    describe("editorTheme.deploy.staleFlows without deploy.requireRevision (P-02)", function() {
        function init(settings) {
            const runtime = { log: mockLog(), settings: settings, flows: {} };
            runtime.log._ = function(key) { return key };
            flows.init(runtime);
            return runtime;
        }
        it("logs a warning at init for reload-only without requireRevision", function() {
            for (const deploy of [undefined, {}, {requireRevision:false}]) {
                const runtime = init({editorTheme: {deploy: {staleFlows: "reload-only"}}, deploy: deploy});
                runtime.log.warn.calledOnce.should.be.true();
                runtime.log.warn.firstCall.args[0].should.equal("deploy.stale-flows-without-require-revision");
            }
        });
        it("does not warn with requireRevision, with prompt or without the setting", function() {
            for (const settings of [
                {editorTheme: {deploy: {staleFlows: "reload-only"}}, deploy: {requireRevision: true}},
                {editorTheme: {deploy: {staleFlows: "prompt"}}},
                {editorTheme: {}},
                {}
            ]) {
                init(settings).log.warn.called.should.be.false();
            }
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
                    buildAddFlowConfig: sinon.spy(function(flow) { return {config: [], id: "added"} }),
                    buildUpdateFlowConfig: sinon.spy(function(id, flow, opts) {
                        if (!revisions[id] && !(opts && opts.create)) {
                            const err = new Error();
                            err.code = 404;
                            throw err;
                        }
                        return {config: [], label: id, created: !revisions[id]};
                    }),
                    buildRemoveFlowConfig: function() { return {config: [], flow: {id: "1"}} },
                    addFlow: sinon.spy(function(flow) { revisions.added = "rev-added"; return Promise.resolve("added") }),
                    updateFlow: sinon.spy(function(id, flow, user, deployOpts, opts) {
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
                // Z-06: the build (step 2) got no `create`; updateFlow is not called
                runtime.flows.buildUpdateFlowConfig.firstCall.args[2].should.not.have.property("create");
                runtime.flows.updateFlow.called.should.be.false();
            }
        });
        it("a missing flow with a rev returns 404 before the revision check (as in 5.0.7)", async function() {
            for (const deploySettings of [undefined, {putCreatesFlow:false}, {requireRevision:true}]) {
                initRuntime(deploySettings);
                for (const flow of [{nodes:[], rev:"rev-x"}, {nodes:[], rev:""}, {nodes:[], rev:5}, {nodes:[], rev:"rev-x", globalConfigs:[], globalRev:"old"}]) {
                    const err = await rejected(flows.updateFlow({id:"new1", flow:flow}));
                    err.should.have.property("code","not_found");
                    err.should.have.property("status",404);
                }
            }
        });
        it("deleteFlow of a missing flow with a rev returns 404 before the revision check", async function() {
            for (const deploySettings of [undefined, {requireRevision:true}]) {
                initRuntime(deploySettings);
                // Z-06: reported by the build of the pipeline step 2
                runtime.flows.buildRemoveFlowConfig = sinon.spy(function(id) {
                    if (id === "global") {
                        throw new Error("not allowed to remove global");
                    }
                    const err = new Error();
                    err.code = 404;
                    throw err;
                });
                let err = await rejected(flows.deleteFlow({id:"new1", rev:"rev-x"}));
                err.should.have.property("code","not_found");
                err.should.have.property("status",404);
                // deleting global is not allowed (400), whatever the revision
                err = await rejected(flows.deleteFlow({id:"global", rev:"old"}));
                err.should.have.property("status",400);
                err.message.should.equal("not allowed to remove global");
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
        it("the revisions of a v2 response are read under the deploy lock", async function() {
            initRuntime();
            const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");
            const reads = [];
            runtime.flows.getFlowRevision = function(id) {
                reads.push("rev:" + lock.isLocked());
                return revisions[id] || null;
            };
            runtime.flows.getFlows = function() {
                reads.push("all:" + lock.isLocked());
                return {rev:"rev-all", flows:[]};
            };
            (await flows.updateFlow({id:"t1", flow:{nodes:[]}, apiVersion:"v2"})).should.eql({id:"t1", rev:"rev-t1-updated", revAll:"rev-all", created:false});
            (await flows.addFlow({flow:{nodes:[]}, apiVersion:"v2"})).should.eql({id:"added", rev:"rev-added"});
            reads.length.should.be.above(2);
            reads.forEach(r => r.should.endWith(":true"));
        });
        describe("revisions in deploy errors (W-3)", function() {
            function deployFailed(code) {
                const err = new Error("deploy failed");
                err.code = code;
                err.status = 500;
                err.rev = "rev-all-new";
                if (code === "deploy_start_failed") {
                    err.errors = [{code:"missing_types", message:"Missing node types"}];
                }
                return err;
            }
            it("updateFlow: rev is the flow revision and revAll the revision of the whole configuration", async function() {
                initRuntime();
                runtime.flows.updateFlow = sinon.spy(function(id) {
                    revisions[id] = "rev-" + id + "-new";
                    return Promise.reject(deployFailed("deploy_start_failed"));
                });
                for (const apiVersion of ["v1", "v2"]) {
                    const err = await rejected(flows.updateFlow({id:"t1", flow:{nodes:[]}, apiVersion}));
                    err.should.have.property("code","deploy_start_failed");
                    err.should.have.property("status",500);
                    err.should.have.property("rev","rev-t1-new");
                    err.should.have.property("revAll","rev-all-new");
                    err.errors[0].should.have.property("code","missing_types");
                }
            });
            it("addFlow: rev is the revision of the new flow", async function() {
                initRuntime();
                runtime.flows.addFlow = sinon.spy(function(flow) {
                    flow.id = "added";
                    revisions.added = "rev-added";
                    return Promise.reject(deployFailed("deploy_stop_failed"));
                });
                const err = await rejected(flows.addFlow({flow:{nodes:[]}, apiVersion:"v2"}));
                err.should.have.property("code","deploy_stop_failed");
                err.should.have.property("rev","rev-added");
                err.should.have.property("revAll","rev-all-new");
            });
            it("deleteFlow: rev is null (the flow no longer exists)", async function() {
                initRuntime();
                runtime.flows.removeFlow = sinon.spy(function(id) {
                    delete revisions[id];
                    return Promise.reject(deployFailed("deploy_start_failed"));
                });
                const err = await rejected(flows.deleteFlow({id:"t1"}));
                err.should.have.property("rev",null);
                err.should.have.property("revAll","rev-all-new");
            });
            it("the revisions are read under the deploy lock", async function() {
                initRuntime();
                const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");
                let lockedWhenRead = null;
                runtime.flows.updateFlow = sinon.spy(function(id) {
                    return Promise.reject(deployFailed("deploy_start_failed"));
                });
                runtime.flows.getFlowRevision = function(id) {
                    lockedWhenRead = lock.isLocked();
                    return revisions[id] || null;
                };
                await rejected(flows.updateFlow({id:"t1", flow:{nodes:[]}}));
                lockedWhenRead.should.be.true();
            });
            it("other errors have no revAll", async function() {
                initRuntime();
                const err = await rejected(flows.updateFlow({id:"t1", flow:{nodes:[], rev:"old"}}));
                err.should.have.property("code","version_mismatch");
                err.should.not.have.property("revAll");
            });
        });
        it("calls without the new fields are unchanged", async function() {
            initRuntime();
            const flow = {id:"t1", label:"x", nodes:[]};
            (await flows.updateFlow({id:"t1", flow:flow})).should.equal("t1");
            runtime.flows.updateFlow.firstCall.args[1].should.equal(flow);
            runtime.flows.getFlowRevision.called.should.be.false();
        });
    });

    describe("a rejected single-flow request does not change the instance state (Z-06, A24, U1)", function() {
        const credentials = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/credentials");
        const runtimeFlows = NR_TEST_UTILS.require("@node-red/runtime/lib/flows");
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        let load;
        let saved;
        let seen;
        let off;
        const config = () => [
            {id: "t1", type: "tab", label: "Flow 1"},
            {id: "n1", type: "test", z: "t1", wires: []},
            {id: "t2", type: "tab", label: "Flow 2"},
            {id: "n2", type: "test", z: "t2", wires: []},
            {id: "g1", type: "test-config"}
        ];
        async function setup(deploySettings) {
            saved = [];
            await runtimeFlows.init({
                log: mockLog(),
                settings: {},
                storage: {
                    getFlows: async () => ({flows: config(), rev: "A"}),
                    saveFlows: async (conf) => { saved.push(conf); return "B" }
                }
            });
            await runtimeFlows.load();
            flows.init({log: mockLog(), settings: deploySettings ? {deploy: deploySettings} : {}, flows: runtimeFlows});
            instanceState.reset();
            instanceState.markStarting();
            instanceState.report({errors: []});
            seen = [];
            off = instanceState.onChange(info => seen.push(info.state));
        }
        beforeEach(function() {
            load = sinon.stub(credentials, "load").callsFake(async function() {});
        });
        afterEach(function() {
            if (off) {
                off();
            }
            instanceState.reset();
            load.restore();
        });
        // [description, call, expected status, expected code]
        const cases = [
            ["addFlow 409 (globalRev)", () => flows.addFlow({flow: {nodes: [], globalConfigs: [], globalRev: "old"}}), 409, "version_mismatch"],
            ["addFlow duplicate_id (a global node with the id of a node of a flow)", () => flows.addFlow({flow: {nodes: [], globalConfigs: [{id: "n1", type: "test-config"}]}}), 400, "duplicate_id"],
            ["addFlow duplicate id of a node", () => flows.addFlow({flow: {nodes: [{id: "n1", type: "test"}]}}), 400, undefined],
            ["updateFlow 409 (rev)", () => flows.updateFlow({id: "t1", flow: {nodes: [], rev: "old"}}), 409, "version_mismatch"],
            ["updateFlow 404", () => flows.updateFlow({id: "nope", flow: {nodes: []}}), 404, "not_found"],
            ["updateFlow duplicate_id (a node of another flow)", () => flows.updateFlow({id: "t2", flow: {nodes: [{id: "n1", type: "test"}]}}), 400, "duplicate_id"],
            ["updateFlow invalid_flow_id (putCreatesFlow, the id of a node)", () => flows.updateFlow({id: "n1", flow: {nodes: []}}), 400, "invalid_flow_id", {putCreatesFlow: true}],
            ["deleteFlow 409 (rev)", () => flows.deleteFlow({id: "t1", rev: "old"}), 409, "version_mismatch"],
            ["deleteFlow 404", () => flows.deleteFlow({id: "nope"}), 404, "not_found"],
            ["deleteFlow global 400", () => flows.deleteFlow({id: "global"}), 400, undefined]
        ];
        cases.forEach(function(c) {
            it(c[0] + ": no instance:state event, state unchanged, nothing saved", async function() {
                await setup(c[4]);
                const before = instanceState.get();
                const err = await c[1]().then(() => { throw new Error("not rejected") }, e => e);
                err.should.have.property("status", c[2]);
                if (c[3] !== undefined) {
                    err.should.have.property("code", c[3]);
                }
                seen.should.eql([]);
                instanceState.get().should.eql(before);
                instanceState.get().state.should.equal("ready");
                saved.should.have.length(0);
                NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock").isLocked().should.be.false();
            });
        });
        it("a rejected request does not supersede a pending reload from storage (D19)", async function() {
            await setup();
            instanceState.markReloadPending();
            await flows.deleteFlow({id: "nope"}).should.be.rejected();
            instanceState.get().state.should.equal("reloadPending");
        });
        it("an accepted request still goes through deploying", async function() {
            await setup();
            await flows.deleteFlow({id: "t2"});
            seen[0].should.equal("deploying");
            saved.should.have.length(1);
        });
    });

    describe("reload from the api: the read of storage and of the credentials (Z-06, D15, A32 - guards: pass before and after the change)", function() {
        const credentials = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/credentials");
        const runtimeFlows = NR_TEST_UTILS.require("@node-red/runtime/lib/flows");
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        const events = NR_TEST_UTILS.require("@node-red/util/lib/events");
        let load;
        let record;
        let listener;
        let log;
        let storage;
        const stored = () => ({flows: [{id: "t1", type: "tab", label: "Stored"}], rev: "S", credentials: {n1: {a: 1}}});
        async function setup(opts) {
            opts = opts || {};
            record = [];
            log = mockLog();
            storage = {
                getFlows: async () => {
                    record.push("getFlows");
                    if (opts.storageError) {
                        throw opts.storageError;
                    }
                    return stored();
                },
                saveFlows: async () => { record.push("saveFlows"); return "X" }
            };
            if (opts.projects) {
                storage.projects = {};
            }
            // editorOnly: the flows are loaded and published but never stopped or started
            await runtimeFlows.init({log: log, settings: {editorOnly: true}, storage: storage});
            flows.init({log: log, settings: {editorOnly: true}, flows: runtimeFlows});
            instanceState.reset();
            instanceState.markStarting();
            instanceState.report({errors: []});
            listener = function(evt) {
                if (evt.id === "runtime-state") {
                    record.push("runtime-state:" + (evt.payload ? (evt.payload.error || evt.payload.type || evt.payload.state) + "/" + (evt.payload.text || "") : "retain") + (evt.retain ? ":retain" : ""));
                }
            };
            events.on("runtime-event", listener);
        }
        beforeEach(function() {
            load = sinon.stub(credentials, "load").callsFake(async function(creds) {
                record.push("credentials.load:" + JSON.stringify(creds));
                if (load.failWith) {
                    throw load.failWith;
                }
            });
        });
        afterEach(function() {
            events.removeListener("runtime-event", listener);
            instanceState.reset();
            load.restore();
        });
        it("success: storage is read, then the credentials are loaded, then the runtime state is published; the configuration is the stored one", async function() {
            await setup();
            const result = await flows.setFlows({deploymentType: "reload"});
            result.should.have.property("rev", "S");
            record.slice(0, 3).should.eql(["getFlows", 'credentials.load:{"n1":{"a":1}}', "runtime-state:retain:retain"]);
            runtimeFlows.getFlows().rev.should.equal("S");
            record.should.not.containEql("saveFlows");
        });
        it("a storage error: the active configuration is dropped, the runtime state warns, the error is passed on, nothing else changes", async function() {
            await setup({storageError: Object.assign(new Error("disk"), {code: "storage_error"})});
            // an active configuration exists before the failing reload
            storage.getFlows = async () => stored();
            await runtimeFlows.load();
            runtimeFlows.getFlows().rev.should.equal("S");
            storage.getFlows = async () => { record.push("getFlows"); throw Object.assign(new Error("disk"), {code: "storage_error"}) };
            record.length = 0;
            const err = await flows.setFlows({deploymentType: "reload"}).then(() => { throw new Error("not rejected") }, e => e);
            err.should.have.property("code", "storage_error");
            should.not.exist(runtimeFlows.getFlows());
            record.should.eql(["getFlows", "runtime-state:storage_error/notification.warnings.storage_error:retain"]);
            log.warn.called.should.be.true();
            instanceState.get().state.should.equal("ready");
        });
        it("credentials_load_failed without projects: the credentials are reset with a warning, the reload goes on", async function() {
            await setup();
            load.failWith = Object.assign(new Error("Failed to decrypt credentials"), {code: "credentials_load_failed"});
            const result = await flows.setFlows({deploymentType: "reload"});
            result.should.have.property("rev", "S");
            record.should.containEql("runtime-state:credentials_load_failed/notification.warnings.credentials_load_failed_reset:retain");
            runtimeFlows.getFlows().rev.should.equal("S");
        });
        it("credentials_load_failed with projects: the error is passed on before the state deploying, the active configuration is dropped", async function() {
            await setup({projects: true});
            storage.getFlows = async () => stored();
            await runtimeFlows.load();
            const seen = [];
            const off = instanceState.onChange(info => seen.push(info.state));
            load.failWith = Object.assign(new Error("Failed to decrypt credentials"), {code: "credentials_load_failed"});
            const err = await flows.setFlows({deploymentType: "reload"}).then(() => { throw new Error("not rejected") }, e => e);
            off();
            err.should.have.property("code", "credentials_load_failed");
            seen.should.eql([]);
            should.not.exist(runtimeFlows.getFlows());
            record.should.containEql("runtime-state:credentials_load_failed/notification.warnings.credentials_load_failed:retain");
        });
    });

    describe("deploy hooks (Z-06): preDeploy through the runtime api", function() {
        const { hooks, log: utilLog } = NR_TEST_UTILS.require("@node-red/util");
        let runtime;
        let logStubs;
        let events;
        function setup(deploySettings) {
            runtime = {
                log: mockLog(),
                settings: { deploy: Object.assign({ hookTimeout: 100 }, deploySettings) },
                flows: {
                    getFlows: function() { return {rev: "rev-all", flows: []} },
                    getFlowRevision: function(id) { return id === "t1" || id === "global" ? "rev-" + id : null },
                    setFlows: sinon.spy(function() { return Promise.resolve("newRev") }),
                    loadFlows: sinon.spy(function() { return Promise.resolve("loadRev") }),
                    readStoredFlows: sinon.spy(function() { return Promise.resolve({flows: [{id: "stored", type: "tab", credentials: {a: "secret"}}], rev: "storedRev", credentials: {a: {p: "secret"}}}) }),
                    loadStoredCredentials: sinon.spy(function(config) { return Promise.resolve(config) }),
                    buildAddFlowConfig: sinon.spy(function(flow) { flow.id = "new1"; return {config: [{id: "new1", type: "tab"}], id: "new1"} }),
                    buildUpdateFlowConfig: sinon.spy(function(id, flow, opts) {
                        if (id !== "t1" && id !== "global" && !(opts && opts.create)) {
                            const err = new Error();
                            err.code = 404;
                            throw err;
                        }
                        return {config: [{id: id, type: "tab", credentials: {a: "secret"}, env: [{name: "K", type: "cred", value: "secret"}]}], label: id, created: id !== "t1" && id !== "global"};
                    }),
                    buildRemoveFlowConfig: sinon.spy(function(id) { return {config: [], flow: {id: id}} }),
                    addFlow: sinon.spy(function() { return Promise.resolve("new1") }),
                    updateFlow: sinon.spy(function() { return Promise.resolve({created: false}) }),
                    removeFlow: sinon.spy(function() { return Promise.resolve() })
                }
            };
            flows.init(runtime);
            events = [];
            hooks.clear();
            hooks.add("preDeploy.test", function(event) { events.push(event); return runtime.hookBehaviour ? runtime.hookBehaviour(event) : undefined });
        }
        const saved = () => ["setFlows", "loadFlows", "addFlow", "updateFlow", "removeFlow"].some(fn => runtime.flows[fn].called);
        beforeEach(function() {
            logStubs = [
                sinon.stub(utilLog, "_").callsFake(k => "[" + k + "]"),
                sinon.stub(utilLog, "warn"),
                sinon.stub(utilLog, "error"),
                sinon.stub(utilLog, "debug")
            ];
        });
        afterEach(function() {
            logStubs.forEach(s => s.restore());
            hooks.clear();
        });
        async function rejected(promise) {
            try {
                await promise;
            } catch (err) {
                return err;
            }
            throw new Error("not rejected");
        }
        const calls = {
            "setFlows full": () => flows.setFlows({flows: {flows: [{id: "a", type: "tab"}], credentials: {a: {p: "secret"}}}, deploymentType: "full", user: {username: "u", permissions: "*"}, req: {}}),
            "setFlows nodes": () => flows.setFlows({flows: {flows: [{id: "a", type: "tab"}]}, deploymentType: "nodes", req: {}}),
            "setFlows flows": () => flows.setFlows({flows: {flows: [{id: "a", type: "tab"}]}, deploymentType: "flows", req: {}}),
            "setFlows reload": () => flows.setFlows({deploymentType: "reload", req: {}}),
            "addFlow": () => flows.addFlow({flow: {label: "x", nodes: []}, req: {}}),
            "updateFlow": () => flows.updateFlow({id: "t1", flow: {nodes: []}, req: {}}),
            "updateFlow global": () => flows.updateFlow({id: "global", flow: {configs: []}, req: {}}),
            "updateFlow create": () => flows.updateFlow({id: "new9", flow: {nodes: []}, req: {}}),
            "deleteFlow": () => flows.deleteFlow({id: "t1", req: {}})
        };

        it("the event of every operation: type, operation, flowId, created, flows, activeRev (and rev for reload)", async function() {
            setup({putCreatesFlow: true});
            for (const name of Object.keys(calls)) {
                await calls[name]();
            }
            events.map(e => e.operation).should.eql(["setFlows", "setFlows", "setFlows", "setFlows", "addFlow", "updateFlow", "updateFlow", "updateFlow", "deleteFlow"]);
            events.map(e => e.type).should.eql(["full", "nodes", "flows", "reload", "flows", "flows", "flows", "flows", "flows"]);
            events.forEach(e => { e.source.should.equal("api"); e.activeRev.should.equal("rev-all") });
            events[0].flows.should.eql([{id: "a", type: "tab"}]);
            events[0].user.should.eql({username: "u", permissions: "*"});
            events[3].flows.should.eql([{id: "stored", type: "tab"}]);
            events[3].rev.should.equal("storedRev");
            events[4].flowId.should.equal("new1");
            events[5].flowId.should.equal("t1");
            events[5].created.should.equal(false);
            events[6].flowId.should.equal("global");
            events[7].flowId.should.equal("new9");
            events[7].created.should.equal(true);
            events[8].flowId.should.equal("t1");
            events[8].should.not.have.property("created");
            // SEC-101 everywhere: no credentials, no env cred value
            JSON.stringify(events.map(e => e.flows)).should.not.containEql("secret");
            // created only with putCreatesFlow
            setup({});
            await calls["updateFlow"]();
            events[0].should.not.have.property("created");
        });
        Object.keys(calls).forEach(function(name) {
            it(name + ": a rejection answers 400 deploy_rejected with reason and details, nothing is saved, audited with the reason, no warning with a stack", async function() {
                setup({putCreatesFlow: true});
                runtime.hookBehaviour = () => { throw Object.assign(new Error("forbidden node: x"), {status: 400, code: "forbidden_node", details: {nodes: ["n1"]}, remote: "r", rev: "R", stack: "S"}) };
                const err = await rejected(calls[name]());
                err.should.have.property("code", "deploy_rejected");
                err.should.have.property("status", 400);
                err.should.have.property("message", "forbidden node: x");
                err.should.have.property("reason", "forbidden_node");
                err.details.should.eql({nodes: ["n1"]});
                err.should.not.have.property("remote");
                err.should.not.have.property("rev");
                saved().should.be.false();
                const audit = runtime.log.audit.getCalls().map(c => c.args[0]).filter(a => a.error === "deploy_rejected");
                audit.should.have.length(1);
                audit[0].should.have.property("reason", "forbidden_node");
                runtime.log.warn.called.should.be.false();
            });
            it(name + ": a failure of the validator answers 503 deploy_hook_failed and a timeout 503 deploy_hook_timeout, nothing is saved", async function() {
                setup({putCreatesFlow: true});
                runtime.hookBehaviour = () => { throw new TypeError("secret detail") };
                let err = await rejected(calls[name]());
                err.should.have.property("code", "deploy_hook_failed");
                err.should.have.property("status", 503);
                err.message.should.not.containEql("secret detail");
                saved().should.be.false();
                hooks.clear();
                setup({putCreatesFlow: true});
                runtime.hookBehaviour = () => new Promise(() => {});
                err = await rejected(calls[name]());
                err.should.have.property("code", "deploy_hook_timeout");
                err.should.have.property("status", 503);
                saved().should.be.false();
                const audit = runtime.log.audit.getCalls().map(c => c.args[0]).filter(a => a.error === "deploy_hook_timeout");
                audit.should.have.length(1);
                audit[0].should.not.have.property("reason");
                runtime.log.warn.called.should.be.false();
            });
        });
        it("the deployed configuration of /flows is the client's (I4)", async function() {
            setup();
            const body = {flows: [{id: "a", type: "tab", credentials: {x: "secret"}}], credentials: {a: {x: "secret"}}};
            await flows.setFlows({flows: body, deploymentType: "full", req: {}});
            runtime.flows.setFlows.firstCall.args[0].should.equal(body.flows);
            runtime.flows.setFlows.firstCall.args[1].should.equal(body.credentials);
        });
        it("a handler registered with RED.hooks.add as a promise hook that rejects with an Error status 400 rejects the same way", async function() {
            setup();
            runtime.hookBehaviour = () => Promise.reject(Object.assign(new Error("no"), {status: 400}));
            const err = await rejected(calls["setFlows full"]());
            err.should.have.property("code", "deploy_rejected");
            err.should.have.property("reason", "rejected");
        });
        it("an invalid deploy.hookTimeout is warned about at init and the default is used", function() {
            ["x", 0, -5, Infinity, 2147483648].forEach(function(value) {
                const log = mockLog();
                flows.init({log: log, settings: {deploy: {hookTimeout: value}}, flows: {}});
                log.warn.calledOnce.should.be.true();
            });
            const log = mockLog();
            flows.init({log: log, settings: {deploy: {hookTimeout: 300}}, flows: {}});
            log.warn.called.should.be.false();
            flows.init({log: log, settings: {}, flows: {}});
            log.warn.called.should.be.false();
            NR_TEST_UTILS.require("@node-red/runtime/lib/flows/deployHooks").getHookTimeout().should.equal(30000);
        });
    });

    describe("a reload rejected by the preDeploy hook changes nothing (Z-06, I12, D15, D26)", function() {
        const credentials = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/credentials");
        const runtimeFlows = NR_TEST_UTILS.require("@node-red/runtime/lib/flows");
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        const events = NR_TEST_UTILS.require("@node-red/util/lib/events");
        const { hooks, log: utilLog } = NR_TEST_UTILS.require("@node-red/util");
        let runtimeEvents;
        let listener;
        let stored;
        let logStubs;
        let accept;
        async function setup(options) {
            options = options || {};
            const log = mockLog();
            credentials.init({ log: log, settings: { get: () => false } });
            await credentials.load({ old: { x: 1 } });
            stored = { flows: [{ id: "t2", type: "tab", label: "Stored" }], rev: "S", credentials: { fresh: { y: 2 } } };
            await runtimeFlows.init({
                log: log,
                settings: { editorOnly: true, deploy: { hookTimeout: 100 } },
                storage: Object.assign({
                    getFlows: async () => stored,
                    saveFlows: async () => "X"
                }, options.projects ? { projects: {} } : {})
            });
            // the running configuration, with its credentials loaded as at the start of the process
            const initial = stored;
            stored = { flows: [{ id: "t1", type: "tab", label: "Active" }], rev: "A", credentials: { old: { x: 1 } } };
            await runtimeFlows.load();
            stored = initial;
            flows.init({ log: log, settings: { editorOnly: true, deploy: { hookTimeout: 100 } }, flows: runtimeFlows });
            instanceState.reset();
            instanceState.markStarting();
            instanceState.report({ errors: [] });
            runtimeEvents = [];
            listener = function(evt) { if (evt.id === "runtime-state") { runtimeEvents.push(evt) } };
            events.on("runtime-event", listener);
            runtimeEvents.length = 0;
        }
        beforeEach(function() {
            accept = false;
            logStubs = [sinon.stub(utilLog, "warn"), sinon.stub(utilLog, "error"), sinon.stub(utilLog, "debug")];
            hooks.add("preDeploy.test", function(event) { return accept ? undefined : false });
        });
        afterEach(function() {
            events.removeListener("runtime-event", listener);
            hooks.clear();
            logStubs.forEach(s => s.restore());
            instanceState.reset();
        });
        it("the credentials of the instance, the runtime state, the active configuration and the instance state stay as they were", async function() {
            await setup();
            const loadSpy = sinon.spy(credentials, "load");
            try {
                const seen = [];
                const off = instanceState.onChange(info => seen.push(info.state));
                const before = await credentials.export();
                const err = await flows.setFlows({ deploymentType: "reload", req: {} }).then(() => null, e => e);
                off();
                err.should.have.property("code", "deploy_rejected");
                loadSpy.called.should.be.false();
                (await credentials.export()).should.eql(before);
                (await credentials.export()).should.eql({ old: { x: 1 } });
                runtimeEvents.should.eql([]);
                seen.should.eql([]);
                runtimeFlows.getFlows().rev.should.equal("A");
            } finally {
                loadSpy.restore();
            }
        });
        it("an accepted reload loads the credentials and publishes the runtime state (after the hook)", async function() {
            await setup();
            accept = true;
            const result = await flows.setFlows({ deploymentType: "reload", req: {} });
            result.should.have.property("rev", "S");
            (await credentials.export()).should.eql({ fresh: { y: 2 } });
            runtimeEvents.some(e => e.retain === true && e.payload === undefined).should.be.true();
            runtimeFlows.getFlows().rev.should.equal("S");
        });
        it("D26: with projects a credentials_load_failed comes after the hook; a rejection by the hook hides it", async function() {
            await setup({ projects: true });
            const load = sinon.stub(credentials, "load").callsFake(async function() {
                throw Object.assign(new Error("Failed to decrypt credentials"), { code: "credentials_load_failed" });
            });
            try {
                const err = await flows.setFlows({ deploymentType: "reload", req: {} }).then(() => null, e => e);
                err.should.have.property("code", "deploy_rejected");
                load.called.should.be.false();
                runtimeEvents.should.eql([]);
                runtimeFlows.getFlows().rev.should.equal("A");
                // accepted: the error of the credentials comes (before deploying), as before
                accept = true;
                const second = await flows.setFlows({ deploymentType: "reload", req: {} }).then(() => null, e => e);
                second.should.have.property("code", "credentials_load_failed");
                load.calledOnce.should.be.true();
            } finally {
                load.restore();
            }
        });
        it("a failed read of storage comes before the hook: the hook is not called", async function() {
            await setup();
            let called = false;
            hooks.clear();
            hooks.add("preDeploy.test", function() { called = true });
            const getFlows = sinon.stub(runtimeFlows, "readStoredFlows").callsFake(async function() { throw Object.assign(new Error("disk"), { code: "storage_error" }) });
            try {
                const err = await flows.setFlows({ deploymentType: "reload", req: {} }).then(() => null, e => e);
                err.should.have.property("code", "storage_error");
                called.should.be.false();
            } finally {
                getFlows.restore();
            }
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
                    readStoredFlows: sinon.spy(function() { return Promise.resolve({flows:[],rev:"storedRev"}) }),
                    loadStoredCredentials: sinon.spy(function(config) { return Promise.resolve(config) }),
                    buildAddFlowConfig: function() { return {config: [], id: "added"} },
                    buildUpdateFlowConfig: sinon.spy(function(id, flow, opts) {
                        if (!revisions[id] && !(opts && opts.create)) {
                            const err = new Error();
                            err.code = 404;
                            throw err;
                        }
                        return {config: [], label: id, created: !revisions[id]};
                    }),
                    buildRemoveFlowConfig: function() { return {config: [], flow: {id: "1"}} },
                    addFlow: sinon.spy(function() { return Promise.resolve("added") }),
                    updateFlow: sinon.spy(function(id, flow, user, deployOpts, opts) {
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
