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
 *   Z-14: flow layout: tests for layout properties in the single-flow API
 *   E-01: tests of the deploy pipeline contract; the deploy lock is held until the start completes
 *   P-01: tests of setFlows waiting for the start (deploy.response "started"), start errors,
 *   deploy.startTimeout and the log of a rejected start in the default mode
 *   R-45: the deploy lock is kept after deploy.startTimeout unless
 *   deploy.startTimeoutReleasesLock is set
 *   Z-04: tests of getFlowRevision and the single-flow configuration (create, globalConfigs)
 *   Z-09: tests of reloadFromStorage (full, diff) and getChangedFlows
 *   Z-15: tests of the editor-only instance (editorOnly)
 *   #22: tests of the facts of start_timeout (phase, pending, current), of the flow in
 *   flow_start_failed and of the runtime event deploy-start-result after a start_timeout response
 *   #2: tests of credentialsChanged (the digest of the credentials of the active configuration,
 *   kept apart from getFlows())
 *   #40: tests of the stop with deploy.drainHttpNodeRequests (the order beforeStop, stop of the nodes,
 *   afterStop; no change with the setting off; the serialisation of the stops; a node type registered
 *   during the drain)
 *   Z-06 (#10): tests of opts.built of addFlow/updateFlow/removeFlow (the configuration built by the pipeline);
 *   readStoredFlows/loadStoredCredentials (the halves of readFlowsFromStorage, D15, A32)
 *   #63: load(true), the project switch path, does not call preDeploy or postDeploy handlers (I8 of #10)
 *   #82: the tests of the stop with the drain leave no flow objects (stubs) in the module for the specs that run later; checkTypeInUse refuses the removal and the disabling of node types during a drain stop (409)
 *   #84: the start guard (no flow is created or started in stopping and stopped, by any caller) and the complete stop
 *   (a stop in stopping waits for the stop and for the flow that is starting, then stops every flow)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var sinon = require("sinon");
var clone = require("clone");
var NR_TEST_UTILS = require("nr-test-utils");

var flows = NR_TEST_UTILS.require("@node-red/runtime/lib/flows");
var RedNode = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/Node");
var RED = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes");
var events = NR_TEST_UTILS.require("@node-red/util/lib/events");
var credentials = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/credentials");
var typeRegistry = NR_TEST_UTILS.require("@node-red/registry")
var Flow = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/Flow");
const { createWorld, deferred: worldDeferred, quiesce, until, fakeClock, watch, pastAllBounds, timerArmed, settle, SUITE_TIMEOUT } = require("nr-test-utils/stop-race-world");

describe('flows/index', function() {

    var storage;
    var eventsOn;
    var credentialsClean;
    var credentialsLoad;
    var credentialsAdd;

    var flowCreate;
    var getType;
    var checkFlowDependencies;

    var mockLog = {
        log: sinon.stub(),
        debug: sinon.stub(),
        trace: sinon.stub(),
        warn: sinon.stub(),
        info: sinon.stub(),
        metric: sinon.stub(),
        _: function() { return "abc"}
    }


    before(function() {
        getType = sinon.stub(typeRegistry,"get").callsFake(function(type) {
            return type.indexOf('missing') === -1;
        });
        checkFlowDependencies = sinon.stub(typeRegistry, "checkFlowDependencies").callsFake(async function(flow) {
            if (flow[0].id === "node-with-missing-modules") {
                throw new Error("Missing module");
            }
        });
    });

    after(function() {
        getType.restore();
        checkFlowDependencies.restore();
    });


    beforeEach(function() {
        eventsOn = sinon.spy(events,"on");
        credentialsClean = sinon.stub(credentials,"clean").callsFake(function(conf) {
            conf.forEach(function(n) {
                delete n.credentials;
            });
            return Promise.resolve();
        });
        credentialsLoad = sinon.stub(credentials,"load").callsFake(function(creds) {
            if (creds && creds.hasOwnProperty("$") && creds['$'] === "fail") {
                return Promise.reject("creds error");
            }
            return Promise.resolve();
        });
        credentialsAdd = sinon.stub(credentials,"add").callsFake(async function(id, conf){})
        flowCreate = sinon.stub(Flow,"create").callsFake(function(parent, global, flow) {
            var id;
            if (typeof flow === 'undefined') {
                flow = global;
                id = '_GLOBAL_';
            } else {
                id = flow.id;
            }
            flowCreate.flows[id] = {
                flow: flow,
                global: global,
                start: sinon.spy(async() => {}),
                update: sinon.spy(),
                stop: sinon.spy(),
                getActiveNodes: function() {
                    return flow.nodes||{};
                },
                handleError: sinon.spy(),
                handleStatus: sinon.spy()

            }
            return flowCreate.flows[id];
        });
        flowCreate.flows = {};

        storage = {
            saveFlows: function(conf) {
                storage.conf = conf;
                return Promise.resolve();
            }
        }
    });

    afterEach(function(done) {
        eventsOn.restore();
        credentialsClean.restore();
        credentialsLoad.restore();
        credentialsAdd.restore();
        flowCreate.restore();

        flows.stopFlows().then(done);

    });
    // describe('#init',function() {
    //     it('registers the type-registered handler', function() {
    //         flows.init({},{});
    //         eventsOn.calledOnce.should.be.true();
    //     });
    // });

    describe('#setFlows', function() {
        it('sets the full flow', function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1",type:"tab"}
            ];
            flows.init({log:mockLog, settings:{},storage:storage});
            flows.setFlows(originalConfig).then(function() {
                credentialsClean.called.should.be.true();
                storage.hasOwnProperty('conf').should.be.true();
                flows.getFlows().flows.should.eql(originalConfig);
                done();
            });

        });
        it('preserves the flow layout properties', function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",o:"TB",wires:[]},
                {id:"t1",type:"tab",layout:"TB",wireStyle:"orthogonal"}
            ];
            flows.init({log:mockLog, settings:{},storage:storage});
            flows.setFlows(originalConfig).then(function() {
                storage.conf.flows.should.eql(originalConfig);
                var savedFlows = flows.getFlows().flows;
                savedFlows[0].o.should.equal("TB");
                savedFlows[1].layout.should.equal("TB");
                savedFlows[1].wireStyle.should.equal("orthogonal");
                done();
            }).catch(done);
        });
        it('loads the full flow for type load', function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1",type:"tab"}
            ];
            var loadStorage = {
                saveFlows: function(conf) {
                    loadStorage.conf = conf;
                    return Promise.resolve(456);
                },
                getFlows: function() {
                    return Promise.resolve({flows:originalConfig,rev:123})
                }
            }
            flows.init({log:mockLog, settings:{},storage:loadStorage});
            flows.setFlows(originalConfig,"load").then(function() {
                credentialsClean.called.should.be.false();
                // 'load' type does not trigger a save
                loadStorage.hasOwnProperty('conf').should.be.false();
                flows.getFlows().flows.should.eql(originalConfig);
                done();
            });

        });

        it('extracts credentials from the full flow', function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[],credentials:{"a":1}},
                {id:"t1",type:"tab"}
            ];
            flows.init({log:mockLog, settings:{},storage:storage});
            flows.setFlows(originalConfig).then(function() {
                credentialsClean.called.should.be.true();
                storage.hasOwnProperty('conf').should.be.true();
                var cleanedFlows = flows.getFlows();
                storage.conf.flows.should.eql(cleanedFlows.flows);
                cleanedFlows.flows.should.not.eql(originalConfig);
                cleanedFlows.flows[0].credentials = {"a":1};
                cleanedFlows.flows.should.eql(originalConfig);
                done();
            });
        });

        it('sets the full flow including credentials', function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1",type:"tab"}
            ];
            var credentials = {"t1-1":{"a":1}};

            flows.init({log:mockLog, settings:{},storage:storage});
            flows.setFlows(originalConfig,credentials).then(function() {
                credentialsClean.called.should.be.true();
                credentialsAdd.called.should.be.true();
                credentialsAdd.lastCall.args[0].should.eql("t1-1");
                credentialsAdd.lastCall.args[1].should.eql({"a":1});
                flows.getFlows().flows.should.eql(originalConfig);
                done();
            });
        });

        it('updates existing flows with partial deployment - nodes', function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1",type:"tab"}
            ];
            var newConfig = clone(originalConfig);
            newConfig.push({id:"t1-2",x:10,y:10,z:"t1",type:"test",wires:[]});
            newConfig.push({id:"t2",type:"tab"});
            newConfig.push({id:"t2-1",x:10,y:10,z:"t2",type:"test",wires:[]});
            storage.getFlows = function() {
                return Promise.resolve({flows:originalConfig});
            }
            events.once('flows:started',function() {
                events.once('flows:started', function() {
                    try {
                        flows.getFlows().flows.should.eql(newConfig);
                        flowCreate.flows['t1'].update.called.should.be.true();
                        flowCreate.flows['t2'].start.called.should.be.true();
                        flowCreate.flows['_GLOBAL_'].update.called.should.be.true();
                        done();
                    } catch(err) {
                        done(err)
                    }
                })
                flows.setFlows(newConfig,"nodes")
            });

            flows.init({log:mockLog, settings:{},storage:storage});
            flows.load().then(function() {
                flows.startFlows();
            });
        });

        it('updates existing flows with partial deployment - flows', function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1",type:"tab"}
            ];
            var newConfig = clone(originalConfig);
            newConfig.push({id:"t1-2",x:10,y:10,z:"t1",type:"test",wires:[]});
            newConfig.push({id:"t2",type:"tab"});
            newConfig.push({id:"t2-1",x:10,y:10,z:"t2",type:"test",wires:[]});
            storage.getFlows = function() {
                return Promise.resolve({flows:originalConfig});
            }

            events.once('flows:started',function() {
                events.once('flows:started',function() {
                    flows.getFlows().flows.should.eql(newConfig);
                    flowCreate.flows['t1'].update.called.should.be.true();
                    flowCreate.flows['t2'].start.called.should.be.true();
                    flowCreate.flows['_GLOBAL_'].update.called.should.be.true();
                    flows.stopFlows().then(done);
                })
                flows.setFlows(newConfig,"nodes")
            });

            flows.init({log:mockLog, settings:{},storage:storage});
            flows.load().then(function() {
                flows.startFlows();
            });
        });

        it('returns error if it cannot decrypt credentials', function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1",type:"tab"}
            ];
            var credentials = {"$":"fail"};

            flows.init({log:mockLog, settings:{},storage:storage});
            flows.setFlows(originalConfig,credentials).then(function() {
                done("Unexpected success when credentials couldn't be decrypted")
            }).catch(function(err) {
                done();
            });
        });
    });

    describe('#load', function() {
        it('loads the flow config', function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1",type:"tab"}
            ];
            storage.getFlows = function() {
                return Promise.resolve({flows:originalConfig});
            }
            flows.init({log:mockLog, settings:{},storage:storage});
            flows.load().then(function() {
                credentialsLoad.called.should.be.true();
                // 'load' type does not trigger a save
                storage.hasOwnProperty('conf').should.be.false();
                flows.getFlows().flows.should.eql(originalConfig);
                done();
            });
        });
    });

    describe('#startFlows', function() {
        it('starts the loaded config', function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1",type:"tab"}
            ];
            storage.getFlows = function() {
                return Promise.resolve({flows:originalConfig});
            }

            events.once('flows:started',function() {
                Object.keys(flowCreate.flows).should.eql(['_GLOBAL_','t1']);
                done();
            });

            flows.init({log:mockLog, settings:{},storage:storage});
            flows.load().then(function() {
                return flows.startFlows();
            });
        });
        it('does not start if nodes missing', function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1-2",x:10,y:10,z:"t1",type:"missing",wires:[]},
                {id:"t1",type:"tab"}
            ];
            storage.getFlows = function() {
                return Promise.resolve({flows:originalConfig});
            }

            flows.init({log:mockLog, settings:{},storage:storage});
            flows.load().then(function() {
                return flows.startFlows();
            }).then(() => {
                try {
                    flowCreate.called.should.be.false();
                    done();
                } catch(err) {
                    done(err);
                }
            });
        });

        it('starts when missing nodes registered', function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1-2",x:10,y:10,z:"t1",type:"missing",wires:[]},
                {id:"t1-3",x:10,y:10,z:"t1",type:"missing2",wires:[]},
                {id:"t1",type:"tab"}
            ];
            storage.getFlows = function() {
                return Promise.resolve({flows:originalConfig});
            }
            flows.init({log:mockLog, settings:{},storage:storage});
            flows.load().then(function() {
                return flows.startFlows();
            }).then(() => {
                flowCreate.called.should.be.false();
                events.emit("type-registered","missing");
                setTimeout(function() {
                    flowCreate.called.should.be.false();
                    events.emit("type-registered","missing2");
                    setTimeout(function() {
                        flowCreate.called.should.be.true();
                        done();
                    },10);
                },10);
            });
        });

        it('does not start if external modules missing', function(done) {
            var originalConfig = [
                {id:"node-with-missing-modules",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1",type:"tab"}
            ];

            storage.getFlows = function() {
                return Promise.resolve({flows:originalConfig});
            }
            var receivedEvent = null;
            var handleEvent = function(payload) {
                receivedEvent = payload;
            }

            events.on("runtime-event",handleEvent);

            //{id:"runtime-state",payload:{error:"missing-modules", type:"warning",text:"notification.warnings.missing-modules",modules:missingModules},retain:true});"


            flows.init({log:mockLog, settings:{},storage:storage});
            flows.load().then(flows.startFlows).then(() => {
                events.removeListener("runtime-event",handleEvent);
                try {
                    flowCreate.called.should.be.false();
                    receivedEvent.should.have.property('id','runtime-state');
                    receivedEvent.should.have.property('payload', {
                        state: 'stop',
                        error: 'missing-modules',
                        type: 'warning',
                        text: 'notification.warnings.missing-modules',
                        modules: []
                     });

                    done();
                }catch(err) {
                    done(err)
                }
            });
        });

    });

    describe.skip('#get',function() {

    });

    describe('#eachNode', function() {
        it('iterates the flow nodes', function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1",type:"tab"}
            ];
            storage.getFlows = function() {
                return Promise.resolve({flows:originalConfig});
            }
            flows.init({log:mockLog, settings:{},storage:storage});
            flows.load().then(function() {
                var c = 0;
                flows.eachNode(function(node) {
                    c++
                })
                c.should.equal(2);
                done();
            });
        });
    });

    describe('#stopFlows', function() {

    });
    // describe('#handleError', function() {
    //     it('passes error to correct flow', function(done) {
    //         var originalConfig = [
    //             {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
    //             {id:"t1",type:"tab"}
    //         ];
    //         storage.getFlows = function() {
    //             return Promise.resolve({flows:originalConfig});
    //         }
    //
    //         events.once('flows:started',function() {
    //             flows.handleError(originalConfig[0],"message",{});
    //             flowCreate.flows['t1'].handleError.called.should.be.true();
    //             done();
    //         });
    //
    //         flows.init({log:mockLog, settings:{},storage:storage});
    //         flows.load().then(function() {
    //             flows.startFlows();
    //         });
    //     });
    //     it('passes error to flows that use the originating global config', function(done) {
    //         var originalConfig = [
    //             {id:"configNode",type:"test"},
    //             {id:"t1",type:"tab"},
    //             {id:"t1-1",x:10,y:10,z:"t1",type:"test",config:"configNode",wires:[]},
    //             {id:"t2",type:"tab"},
    //             {id:"t2-1",x:10,y:10,z:"t2",type:"test",wires:[]},
    //             {id:"t3",type:"tab"},
    //             {id:"t3-1",x:10,y:10,z:"t3",type:"test",config:"configNode",wires:[]}
    //         ];
    //         storage.getFlows = function() {
    //             return Promise.resolve({flows:originalConfig});
    //         }
    //
    //         events.once('flows:started',function() {
    //             flows.handleError(originalConfig[0],"message",{});
    //             try {
    //                 flowCreate.flows['t1'].handleError.called.should.be.true();
    //                 flowCreate.flows['t2'].handleError.called.should.be.false();
    //                 flowCreate.flows['t3'].handleError.called.should.be.true();
    //                 done();
    //             } catch(err) {
    //                 done(err);
    //             }
    //         });
    //
    //         flows.init({log:mockLog, settings:{},storage:storage});
    //         flows.load().then(function() {
    //             flows.startFlows();
    //         });
    //     });
    // });
    // describe('#handleStatus', function() {
    //     it('passes status to correct flow', function(done) {
    //         var originalConfig = [
    //             {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
    //             {id:"t1",type:"tab"}
    //         ];
    //         storage.getFlows = function() {
    //             return Promise.resolve({flows:originalConfig});
    //         }
    //
    //         events.once('flows:started',function() {
    //             flows.handleStatus(originalConfig[0],"message");
    //             flowCreate.flows['t1'].handleStatus.called.should.be.true();
    //             done();
    //         });
    //
    //         flows.init({log:mockLog, settings:{},storage:storage});
    //         flows.load().then(function() {
    //             flows.startFlows();
    //         });
    //     });
    //
    //     it('passes status to flows that use the originating global config', function(done) {
    //         var originalConfig = [
    //             {id:"configNode",type:"test"},
    //             {id:"t1",type:"tab"},
    //             {id:"t1-1",x:10,y:10,z:"t1",type:"test",config:"configNode",wires:[]},
    //             {id:"t2",type:"tab"},
    //             {id:"t2-1",x:10,y:10,z:"t2",type:"test",wires:[]},
    //             {id:"t3",type:"tab"},
    //             {id:"t3-1",x:10,y:10,z:"t3",type:"test",config:"configNode",wires:[]}
    //         ];
    //         storage.getFlows = function() {
    //             return Promise.resolve({flows:originalConfig});
    //         }
    //
    //         events.once('flows:started',function() {
    //             flows.handleStatus(originalConfig[0],"message");
    //             try {
    //                 flowCreate.flows['t1'].handleStatus.called.should.be.true();
    //                 flowCreate.flows['t2'].handleStatus.called.should.be.false();
    //                 flowCreate.flows['t3'].handleStatus.called.should.be.true();
    //                 done();
    //             } catch(err) {
    //                 done(err);
    //             }
    //         });
    //
    //         flows.init({log:mockLog, settings:{},storage:storage});
    //         flows.load().then(function() {
    //             flows.startFlows();
    //         });
    //     });
    // });

    describe('#checkTypeInUse', function() {

        before(function() {
            sinon.stub(typeRegistry,"getNodeInfo").callsFake(function(id) {
                if (id === 'unused-module') {
                    return {types:['one','two','three']}
                } else {
                    return {types:['one','test','three']}
                }
            });
        });

        after(function() {
            typeRegistry.getNodeInfo.restore();
        });

        it('returns cleanly if type not is use', function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1",type:"tab"}
            ];
            flows.init({log:mockLog, settings:{},storage:storage});
            flows.setFlows(originalConfig).then(function() {
                flows.checkTypeInUse("unused-module");
                done();
            });
        });
        it('throws error if type is in use', function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1",type:"tab"}
            ];
            flows.init({log:mockLog, settings:{},storage:storage});
            flows.setFlows(originalConfig).then(function() {
                /*jshint immed: false */
                try {
                    flows.checkTypeInUse("used-module");
                    done("type_in_use error not thrown");
                } catch(err) {
                    err.code.should.eql("type_in_use");
                    done();
                }
            });
        });
    });

    describe('#addFlow', function() {
        it("rejects duplicate node id",function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1",type:"tab"}
            ];
            storage.getFlows = function() {
                return Promise.resolve({flows:originalConfig});
            }
            flows.init({log:mockLog, settings:{},storage:storage});
            flows.load().then(function() {
                flows.addFlow({
                    label:'new flow',
                    nodes:[
                        {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]}
                    ]
                }).then(function() {
                    done(new Error('failed to reject duplicate node id'));
                }).catch(function(err) {
                    done();
                })
            });

        });

        it("addFlow",function(done) {
            var originalConfig = [
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1",type:"tab"}
            ];
            storage.getFlows = function() {
                return Promise.resolve({flows:originalConfig});
            }
            storage.setFlows = function() {
                return Promise.resolve();
            }
            flows.init({log:mockLog, settings:{},storage:storage});
            flows.load().then(function() {
                return flows.startFlows();
            }).then(function() {
                flows.addFlow({
                    label:'new flow',
                    nodes:[
                        {id:"t2-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                        {id:"t2-2",x:10,y:10,z:"t1",type:"test",wires:[]},
                        {id:"t2-3",z:"t1",type:"test"}
                    ]
                }).then(function(id) {
                    flows.getFlows().flows.should.have.lengthOf(6);
                    var createdFlows = Object.keys(flowCreate.flows);
                    createdFlows.should.have.lengthOf(3);
                    createdFlows[2].should.eql(id);
                    done();
                }).catch(function(err) {
                    done(err);
                })
            });

        });
    })
    describe('flow layout properties', function() {
        function loadFlows(originalConfig) {
            storage.getFlows = function() {
                return Promise.resolve({flows:originalConfig});
            }
            flows.init({log:mockLog, settings:{},storage:storage});
            return flows.load().then(function() {
                return flows.startFlows();
            });
        }
        it("addFlow keeps the layout of the new flow and getFlow returns it", function() {
            return loadFlows([{id:"t1",type:"tab"}]).then(function() {
                return flows.addFlow({
                    label:'new flow',
                    layout:'TB',
                    wireStyle:'orthogonal',
                    nodes:[{id:"t2-1",x:10,y:10,type:"test",o:"LR",wires:[]}]
                });
            }).then(function(id) {
                var tab = flows.getFlows().flows.find(n => n.id === id);
                tab.layout.should.equal('TB');
                tab.wireStyle.should.equal('orthogonal');
                var flow = flows.getFlow(id);
                flow.layout.should.equal('TB');
                flow.wireStyle.should.equal('orthogonal');
                flow.nodes[0].o.should.equal('LR');
            });
        });
        it("getFlow does not add layout properties to a flow without them", function() {
            return loadFlows([{id:"t1",type:"tab",label:"Flow"}]).then(function() {
                var flow = flows.getFlow("t1");
                flow.should.not.have.property('layout');
                flow.should.not.have.property('wireStyle');
            });
        });
        it("updateFlow keeps the layout of the flow", function() {
            return loadFlows([
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1",type:"tab",label:"Flow"}
            ]).then(function() {
                return flows.updateFlow("t1", {
                    id:"t1",
                    label:'Flow',
                    layout:'auto',
                    nodes:[{id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]}]
                });
            }).then(function() {
                var tab = flows.getFlows().flows.find(n => n.id === "t1");
                tab.layout.should.equal('auto');
                tab.should.not.have.property('wireStyle');
                flows.getFlow("t1").layout.should.equal('auto');
            });
        });
    })
    describe('deploy pipeline contract', function() {
        const redUtil = NR_TEST_UTILS.require("@node-red/util").util;
        const baseConfig = [
            {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
            {id:"t1",type:"tab",label:"Flow 1"},
            {id:"t2-1",x:10,y:10,z:"t2",type:"test",wires:[]},
            {id:"t2",type:"tab",label:"Flow 2"}
        ];
        let recorded;
        let recorder;
        const recordedEvents = ["flows:stopping","flows:stopped","flows:starting","flows:started"];
        function startRecording() {
            recorded = [];
            recorder = {};
            recordedEvents.forEach(function(name) {
                recorder[name] = function() { recorded.push(name) };
                events.on(name, recorder[name]);
            });
            recorder["runtime-event"] = function(evt) {
                if (evt.id === "runtime-deploy") {
                    recorded.push("runtime-deploy");
                }
            };
            events.on("runtime-event", recorder["runtime-event"]);
        }
        function stopRecording() {
            if (recorder) {
                Object.keys(recorder).forEach(function(name) {
                    events.removeListener(name, recorder[name]);
                });
                recorder = null;
            }
        }
        function waitFor(name) {
            return new Promise(resolve => {
                const check = () => { if (recorded.indexOf(name) !== -1) { resolve() } else { setTimeout(check, 2) } };
                check();
            });
        }
        function loadAndStart(config) {
            storage.getFlows = function() {
                return Promise.resolve({flows:clone(config||baseConfig), rev:"loadedRev"});
            }
            flows.init({log:mockLog, settings:{},storage:storage});
            return flows.load().then(function() {
                return flows.startFlows();
            });
        }
        afterEach(function() {
            stopRecording();
        });

        ["full","nodes","flows"].forEach(function(type) {
            it('emits deploy events in order for '+type, async function() {
                await loadAndStart();
                startRecording();
                const newConfig = clone(baseConfig);
                newConfig[0].changed = true;
                await flows.setFlows(newConfig, type);
                recorded.push("resolved");
                await waitFor("runtime-deploy");
                recorded.filter(e => e !== "resolved").should.eql(["flows:stopping","flows:stopped","flows:starting","flows:started","runtime-deploy"]);
                // The promise resolves after the nodes stopped, before flows:started
                recorded.indexOf("resolved").should.be.above(recorded.indexOf("flows:stopped"));
                recorded.indexOf("resolved").should.be.below(recorded.indexOf("flows:started"));
            });
        });
        it('resolves setFlows before flows:started by default', async function() {
            await loadAndStart();
            startRecording();
            await flows.setFlows(clone(baseConfig), "full");
            recorded.should.not.containEql("flows:started");
            await waitFor("flows:started");
        });
        it('saves to storage before stopping the nodes', async function() {
            await loadAndStart();
            startRecording();
            let savedBeforeStop = null;
            storage.saveFlows = function(conf) {
                savedBeforeStop = recorded.indexOf("flows:stopping") === -1;
                storage.conf = conf;
                return Promise.resolve("savedRev");
            };
            const rev = await flows.setFlows(clone(baseConfig), "full");
            rev.should.equal("savedRev");
            savedBeforeStop.should.be.true();
        });
        it('readFlowsFromStorage returns the stored config', async function() {
            storage.getFlows = function() { return Promise.resolve({flows:clone(baseConfig), rev:"storedRev"}) };
            flows.init({log:mockLog, settings:{},storage:storage});
            const loaded = await flows.readFlowsFromStorage();
            loaded.should.have.property("rev","storedRev");
            loaded.flows.should.eql(baseConfig);
        });
        describe('readStoredFlows and loadStoredCredentials (Z-06, D15, A32)', function() {
            let runtimeEvents;
            let listener;
            beforeEach(function() {
                runtimeEvents = [];
                listener = function(evt) { if (evt.id === "runtime-state") { runtimeEvents.push(evt) } };
                events.on("runtime-event", listener);
            });
            afterEach(function() {
                events.removeListener("runtime-event", listener);
            });
            const stored = () => ({flows:clone(baseConfig), rev:"storedRev", credentials:{n1:{a:1}}});
            it('readStoredFlows has no side effects on success: no credentials, no event, the active configuration is unchanged', async function() {
                storage.getFlows = function() { return Promise.resolve(stored()) };
                flows.init({log:mockLog, settings:{},storage:storage});
                await flows.load();
                credentialsLoad.resetHistory();
                runtimeEvents.length = 0;
                storage.getFlows = function() { return Promise.resolve({flows:[], rev:"other", credentials:{}}) };
                const loaded = await flows.readStoredFlows();
                loaded.should.have.property("rev", "other");
                credentialsLoad.called.should.be.false();
                runtimeEvents.should.eql([]);
                flows.getFlows().rev.should.equal("storedRev");
            });
            it('readStoredFlows on a storage error: drops the active configuration, publishes the warning, logs and throws (as readFlowsFromStorage)', async function() {
                storage.getFlows = function() { return Promise.resolve(stored()) };
                flows.init({log:mockLog, settings:{},storage:storage});
                await flows.load();
                runtimeEvents.length = 0;
                mockLog.warn.resetHistory();
                const error = Object.assign(new Error("disk"), {code:"storage_error"});
                storage.getFlows = function() { return Promise.reject(error) };
                (await flows.readStoredFlows().then(() => null, e => e)).should.equal(error);
                should.not.exist(flows.getFlows());
                runtimeEvents.should.have.length(1);
                runtimeEvents[0].should.have.property("retain", true);
                runtimeEvents[0].payload.should.eql({type:"warning", error:"storage_error", project:undefined, text:"notification.warnings.storage_error"});
                mockLog.warn.calledOnce.should.be.true();
            });
            it('readStoredFlows: project_not_found is logged with its own message', async function() {
                flows.init({log:mockLog, settings:{},storage:storage});
                const logSpy = sinon.spy(mockLog, "_");
                try {
                    storage.getFlows = function() { return Promise.reject(Object.assign(new Error("x"), {code:"project_not_found", project:"p1"})) };
                    await flows.readStoredFlows().should.be.rejected();
                    logSpy.calledWith("storage.localfilesystem.projects.project-not-found", {project:"p1"}).should.be.true();
                } finally {
                    logSpy.restore();
                }
            });
            it('loadStoredCredentials loads the credentials, publishes the runtime state (retained) and returns the configuration', async function() {
                flows.init({log:mockLog, settings:{},storage:storage});
                const config = stored();
                (await flows.loadStoredCredentials(config)).should.equal(config);
                credentialsLoad.calledOnce.should.be.true();
                credentialsLoad.firstCall.args[0].should.eql({n1:{a:1}});
                runtimeEvents.should.have.length(1);
                runtimeEvents[0].should.eql({id:"runtime-state", retain:true});
            });
            it('loadStoredCredentials: credentials_load_failed without projects resets the credentials (warning, the config is returned, the first start publishes no runtime state)', async function() {
                flows.init({log:mockLog, settings:{},storage:storage});
                credentialsLoad.callsFake(function() { return Promise.reject(Object.assign(new Error("fail"), {code:"credentials_load_failed"})) });
                const config = stored();
                (await flows.loadStoredCredentials(config)).should.equal(config);
                runtimeEvents.should.have.length(1);
                runtimeEvents[0].payload.should.have.property("text", "notification.warnings.credentials_load_failed_reset");
                // credentialsPendingReset: the next start does not publish {state: 'start'}
                storage.getFlows = function() { return Promise.resolve(stored()) };
                credentialsLoad.callsFake(function() { return Promise.resolve() });
                await flows.load();
                runtimeEvents.length = 0;
                await flows.startFlows();
                runtimeEvents.filter(e => e.payload && e.payload.state === "start").should.have.length(0);
                // the control: the next start publishes it again
                await flows.stopFlows();
                await flows.startFlows();
                runtimeEvents.filter(e => e.payload && e.payload.state === "start").should.have.length(1);
            });
            it('loadStoredCredentials: credentials_load_failed with projects, and any other error, drop the active configuration and throw', async function() {
                storage.projects = {};
                storage.getFlows = function() { return Promise.resolve(stored()) };
                flows.init({log:mockLog, settings:{},storage:storage});
                await flows.load();
                runtimeEvents.length = 0;
                const error = Object.assign(new Error("fail"), {code:"credentials_load_failed"});
                credentialsLoad.callsFake(function() { return Promise.reject(error) });
                (await flows.loadStoredCredentials(stored()).then(() => null, e => e)).should.equal(error);
                should.not.exist(flows.getFlows());
                runtimeEvents.should.have.length(1);
                runtimeEvents[0].payload.should.have.property("text", "notification.warnings.credentials_load_failed");
            });
            it('readFlowsFromStorage is the composition: read, credentials, runtime state - in this order, the same result', async function() {
                const order = [];
                storage.getFlows = function() { order.push("getFlows"); return Promise.resolve(stored()) };
                credentialsLoad.callsFake(function() { order.push("credentials.load"); return Promise.resolve() });
                flows.init({log:mockLog, settings:{},storage:storage});
                const l = function(evt) { if (evt.id === "runtime-state") { order.push("runtime-state") } };
                events.on("runtime-event", l);
                try {
                    const loaded = await flows.readFlowsFromStorage();
                    loaded.should.have.property("rev", "storedRev");
                    order.should.eql(["getFlows", "credentials.load", "runtime-state"]);
                } finally {
                    events.removeListener("runtime-event", l);
                }
            });
        });
        it('reload saves nothing and restarts all flows', async function() {
            await loadAndStart();
            startRecording();
            let reads = 0;
            storage.getFlows = function() { reads++; return Promise.resolve({flows:clone(baseConfig), rev:"storedRev"}) };
            storage.saveFlows = sinon.spy(function() { return Promise.resolve() });
            flowCreate.resetHistory();
            const rev = await flows.load(true);
            rev.should.equal("storedRev");
            reads.should.equal(1);
            storage.saveFlows.called.should.be.false();
            await waitFor("runtime-deploy");
            // global + t1 + t2 recreated
            flowCreate.callCount.should.equal(3);
        });
        it('#63 B3-AC-4: load(true), as called by a switch of the project, calls no preDeploy or postDeploy handler', async function() {
            const { hooks } = NR_TEST_UTILS.require("@node-red/util");
            const pre = sinon.spy();
            const post = sinon.spy();
            hooks.add("preDeploy.projectSwitch", pre);
            hooks.add("postDeploy.projectSwitch", post);
            try {
                await loadAndStart();
                // the handlers were registered before the first load too: nothing of the start calls them
                storage.getFlows = function() { return Promise.resolve({flows:clone(baseConfig), rev:"storedRev"}) };
                storage.saveFlows = sinon.spy(function() { return Promise.resolve() });
                const rev = await flows.load(true);
                rev.should.equal("storedRev");
                // postDeploy runs after the start, asynchronously: let it run if it were going to
                await new Promise(r => setImmediate(r));
                await new Promise(r => setImmediate(r));
                pre.called.should.be.false();
                post.called.should.be.false();
            } finally {
                hooks.remove("*.projectSwitch");
            }
        });
        it('reload with a loaded config does not read storage again', async function() {
            await loadAndStart();
            let reads = 0;
            storage.getFlows = function() { reads++; return Promise.resolve({flows:[], rev:"other"}) };
            storage.saveFlows = sinon.spy(function() { return Promise.resolve() });
            const loaded = {flows:clone(baseConfig).slice(0,2), rev:"loadedRev2"};
            const rev = await flows.load(true, undefined, loaded);
            rev.should.equal("loadedRev2");
            reads.should.equal(0);
            storage.saveFlows.called.should.be.false();
            flows.getFlows().should.eql({flows:loaded.flows, rev:"loadedRev2"});
        });
        it('buildAddFlowConfig matches the 5.0.7 result of addFlow', async function() {
            await loadAndStart();
            const generateId = sinon.stub(redUtil, "generateId").returns("new-flow");
            try {
                const flow = {
                    label: "new flow", info: "info", disabled: false, env: [{name:"a",value:"1",type:"str"}],
                    layout: "TB", wireStyle: "orthogonal",
                    nodes: [{id:"n1",type:"test",z:"other",wires:[]}],
                    configs: [{id:"c1",type:"test-config"}]
                };
                const expected = clone(baseConfig).concat([
                    {type:"tab",label:"new flow",id:"new-flow",info:"info",disabled:false,env:[{name:"a",value:"1",type:"str"}],layout:"TB",wireStyle:"orthogonal"},
                    {id:"n1",type:"test",z:"new-flow",wires:[]},
                    {id:"c1",type:"test-config",z:"new-flow"}
                ]);
                const built = flows.buildAddFlowConfig(clone(flow));
                built.should.have.property("id","new-flow");
                built.config.should.eql(expected);
                const id = await flows.addFlow(clone(flow));
                id.should.equal("new-flow");
                storage.conf.flows.should.eql(expected);
            } finally {
                generateId.restore();
            }
        });
        it('buildAddFlowConfig rejects duplicate ids and invalid types as before', async function() {
            await loadAndStart();
            (function() { flows.buildAddFlowConfig({nodes:[{id:"t1-1",type:"test"}]}) }).should.throw('duplicate id');
            (function() { flows.buildAddFlowConfig({nodes:[{id:"x",type:"tab"}]}) }).should.throw('invalid node type: tab');
            (function() { flows.buildAddFlowConfig({}) }).should.throw('missing nodes property');
        });
        it('buildUpdateFlowConfig matches the 5.0.7 result of updateFlow', async function() {
            await loadAndStart();
            const newFlow = {id:"t1",label:"Flow 1b",info:"i",layout:"auto",nodes:[{id:"t1-9",type:"test",wires:[]}],configs:[{id:"c9",type:"test-config"}]};
            const expected = [
                {id:"t2-1",x:10,y:10,z:"t2",type:"test",wires:[]},
                {id:"t2",type:"tab",label:"Flow 2"},
                {type:"tab",label:"Flow 1b",id:"t1",info:"i",layout:"auto"},
                {id:"t1-9",type:"test",wires:[],z:"t1"},
                {id:"c9",type:"test-config",z:"t1"}
            ];
            const built = flows.buildUpdateFlowConfig("t1", clone(newFlow));
            built.config.should.eql(expected);
            built.should.have.property("label","Flow 1");
            await flows.updateFlow("t1", clone(newFlow));
            storage.conf.flows.should.eql(expected);
        });
        it('buildUpdateFlowConfig for global matches the 5.0.7 result of updateFlow', async function() {
            await loadAndStart(baseConfig.concat([{id:"g1",type:"test-config"}]));
            const newGlobal = {configs:[{id:"g2",type:"test-config"}],subflows:[{id:"sf1",type:"subflow",name:"sf",nodes:[{id:"sf1-1",type:"test",z:"sf1"}],configs:[]}]};
            const expected = clone(baseConfig).concat([
                {id:"g2",type:"test-config"},
                {id:"sf1-1",type:"test",z:"sf1"},
                {id:"sf1",type:"subflow",name:"sf"}
            ]);
            const built = flows.buildUpdateFlowConfig("global", clone(newGlobal));
            built.config.should.eql(expected);
            await flows.updateFlow("global", clone(newGlobal));
            storage.conf.flows.should.eql(expected);
        });
        it('buildUpdateFlowConfig rejects an unknown flow with code 404', async function() {
            await loadAndStart();
            let error;
            try {
                flows.buildUpdateFlowConfig("unknown", {nodes:[]});
            } catch(err) {
                error = err;
            }
            should.exist(error);
            error.should.have.property("code", 404);
        });
        it('buildRemoveFlowConfig matches the 5.0.7 result of removeFlow', async function() {
            await loadAndStart();
            const expected = [
                {id:"t2-1",x:10,y:10,z:"t2",type:"test",wires:[]},
                {id:"t2",type:"tab",label:"Flow 2"}
            ];
            const built = flows.buildRemoveFlowConfig("t1");
            built.config.should.eql(expected);
            await flows.removeFlow("t1");
            storage.conf.flows.should.eql(expected);
            (function() { flows.buildRemoveFlowConfig("global") }).should.throw('not allowed to remove global');
        });
        it('addFlow, updateFlow and removeFlow with opts.built deploy that configuration and do not build again (Z-06)', async function() {
            await loadAndStart();
            // an input that the build rejects: with `built` it is not built again
            const addBuilt = { config: clone(baseConfig).concat([{id:"b1",type:"tab",label:"B"}]), id: "b1" };
            const flow = { id: "b1" };
            (await flows.addFlow(flow, null, undefined, { built: addBuilt })).should.equal("b1");
            storage.conf.flows.should.eql(addBuilt.config);
            const updateBuilt = { config: clone(baseConfig).slice(0,2), label: "x", created: true };
            (await flows.updateFlow("nope", {}, null, undefined, { built: updateBuilt })).should.eql({ created: true });
            storage.conf.flows.should.eql(updateBuilt.config);
            const removeBuilt = { config: [{id:"t2",type:"tab",label:"Flow 2"}], flow: { id: "t1", label: "Flow 1" } };
            await flows.removeFlow("not-built", null, undefined, { built: removeBuilt });
            storage.conf.flows.should.eql(removeBuilt.config);
        });
        it('addFlow, updateFlow and removeFlow without opts.built still build (and reject) as before', async function() {
            await loadAndStart();
            await flows.addFlow({}).should.be.rejectedWith('missing nodes property');
            await flows.updateFlow("unknown", {nodes:[]}).should.be.rejected();
            await flows.removeFlow("global").should.be.rejectedWith('not allowed to remove global');
        });
        it('start returns no errors when flows start', async function() {
            storage.getFlows = function() { return Promise.resolve({flows:clone(baseConfig)}) };
            flows.init({log:mockLog, settings:{},storage:storage});
            await flows.load();
            const result = await flows.startFlows();
            result.should.eql({errors:[]});
        });
        it('start returns missing_types error', async function() {
            storage.getFlows = function() { return Promise.resolve({flows:[{id:"t1-1",z:"t1",type:"missing"},{id:"t1",type:"tab"}]}) };
            flows.init({log:mockLog, settings:{},storage:storage});
            await flows.load();
            const result = await flows.startFlows();
            result.errors.should.have.length(1);
            result.errors[0].should.have.property("code","missing_types");
            result.errors[0].should.have.property("types",["missing"]);
            result.errors[0].should.have.property("message");
        });
        it('start returns missing_modules error', async function() {
            storage.getFlows = function() { return Promise.resolve({flows:[{id:"node-with-missing-modules",z:"t1",type:"test"},{id:"t1",type:"tab"}]}) };
            flows.init({log:mockLog, settings:{},storage:storage});
            await flows.load();
            const result = await flows.startFlows();
            result.errors.should.have.length(1);
            result.errors[0].should.have.property("code","missing_modules");
            result.errors[0].should.have.property("modules",[]);
        });
        it('start returns flow_start_failed when Flow.start throws', async function() {
            storage.getFlows = function() { return Promise.resolve({flows:clone(baseConfig)}) };
            flows.init({log:mockLog, settings:{},storage:storage});
            await flows.load();
            flowCreate.restore();
            // replaced stub - restored by the outer afterEach
            flowCreate = sinon.stub(Flow,"create").callsFake(function(parent, global, flow) {
                const id = flow ? flow.id : "global";
                return {
                    start: async function() { if (id === "t2") { throw new Error("boom") } },
                    stop: sinon.spy(async () => {}),
                    update: sinon.spy(),
                    getActiveNodes: () => ({})
                };
            });
            const consoleLog = sinon.stub(console, "log");
            let result;
            try {
                result = await flows.startFlows();
            } finally {
                consoleLog.restore();
            }
            result.errors.should.have.length(1);
            result.errors[0].should.have.property("code","flow_start_failed");
            result.errors[0].should.have.property("flow","t2");
            result.errors[0].should.have.property("message","boom");
        });
        it('default mode swallows stop errors (unchanged, D-05)', async function() {
            await loadAndStart();
            Object.keys(flowCreate.flows).forEach(function(id) {
                flowCreate.flows[id].stop = function() { return Promise.reject(new Error("stop failed")) };
            });
            const rev = await flows.setFlows(clone(baseConfig), "full");
            should.not.exist(rev);
        });
        it('setFlows holds the deploy lock until the start completes (R-43)', async function() {
            const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");
            await loadAndStart();
            let finishStart;
            const pendingStart = new Promise(resolve => { finishStart = resolve });
            flowCreate.restore();
            // replaced stub - restored by the outer afterEach
            flowCreate = sinon.stub(Flow,"create").callsFake(function(parent, global, flow) {
                return {
                    start: function() { return pendingStart },
                    stop: sinon.spy(async () => {}),
                    update: sinon.spy(),
                    getActiveNodes: () => ({})
                };
            });
            startRecording();
            const rev = await lock.runExclusive(function() {
                return flows.setFlows(clone(baseConfig), "full");
            });
            // The result is returned before the start completes (default behaviour)
            should.not.exist(rev);
            recorded.should.not.containEql("runtime-deploy");
            lock.isLocked().should.be.true();
            finishStart();
            await waitFor("runtime-deploy");
            await lock.runExclusive(async () => {});
            lock.isLocked().should.be.false();
        });
        it('setFlows accepts deployOpts without changing the default behaviour', async function() {
            await loadAndStart();
            startRecording();
            await flows.setFlows(clone(baseConfig), null, "full", false, false, null, {waitForStart:false});
            recorded.should.not.containEql("flows:started");
            await waitFor("runtime-deploy");
        });

        describe('#setFlows waitForStart (P-01)', function() {
            let log;
            let settings;
            function initFlows(extraSettings) {
                log = Object.assign({}, mockLog, { warn: sinon.stub(), info: sinon.stub(), error: sinon.stub() });
                settings = Object.assign({}, extraSettings || {});
                storage.getFlows = function() {
                    return Promise.resolve({flows:clone(baseConfig), rev:"loadedRev"});
                };
                storage.saveFlows = function(conf) {
                    storage.conf = conf;
                    return Promise.resolve("savedRev");
                };
                flows.init({log:log, settings:settings, storage:storage});
                return flows.load().then(function() {
                    return flows.startFlows();
                });
            }
            function replaceFlowCreate(start) {
                flowCreate.restore();
                // replaced stub - restored by the outer afterEach
                flowCreate = sinon.stub(Flow,"create").callsFake(function(parent, global, flow) {
                    const id = flow ? flow.id : "global";
                    return {
                        start: function() { return start(id) },
                        stop: sinon.spy(async () => {}),
                        update: sinon.spy(),
                        getActiveNodes: () => ({})
                    };
                });
            }
            const waitForStart = {waitForStart: true};

            it('resolves after flows:started when waitForStart', async function() {
                await initFlows();
                startRecording();
                const rev = await flows.setFlows(clone(baseConfig), null, "full", false, false, null, waitForStart);
                rev.should.equal("savedRev");
                recorded.should.containEql("flows:started");
            });
            it('emits runtime-deploy before resolving when waitForStart', async function() {
                await initFlows();
                startRecording();
                await flows.setFlows(clone(baseConfig), null, "nodes", false, false, null, waitForStart);
                recorded.should.eql(["flows:stopping","flows:stopped","flows:starting","flows:started","runtime-deploy"]);
            });
            it('rejects with deploy_start_failed and rev on missing types', async function() {
                await initFlows();
                const config = clone(baseConfig);
                config.push({id:"t1-2",z:"t1",type:"missing",wires:[]});
                const err = await flows.setFlows(config, null, "full", false, false, null, waitForStart).should.be.rejected();
                err.should.have.property("code","deploy_start_failed");
                err.should.have.property("status",500);
                err.should.have.property("rev","savedRev");
                err.errors.should.have.length(1);
                err.errors[0].should.have.property("code","missing_types");
                // The configuration is saved
                storage.conf.flows.should.eql(config);
            });
            it('rejects with deploy_start_failed and flow_start_failed when a flow fails to start', async function() {
                await initFlows();
                replaceFlowCreate(async function(id) { if (id === "t2") { throw new Error("boom") } });
                const consoleLog = sinon.stub(console, "log");
                let err;
                try {
                    err = await flows.setFlows(clone(baseConfig), null, "full", false, false, null, waitForStart).should.be.rejected();
                } finally {
                    consoleLog.restore();
                }
                err.should.have.property("code","deploy_start_failed");
                err.errors[0].should.have.property("code","flow_start_failed");
                err.errors[0].should.have.property("flow","t2");
            });
            it('rejects with deploy_stop_failed and rev when stop fails', async function() {
                await initFlows();
                Object.keys(flowCreate.flows).forEach(function(id) {
                    flowCreate.flows[id].stop = function() { return Promise.reject(new Error("stop failed")) };
                });
                const err = await flows.setFlows(clone(baseConfig), null, "full", false, false, null, waitForStart).should.be.rejected();
                err.should.have.property("code","deploy_stop_failed");
                err.should.have.property("status",500);
                err.should.have.property("rev","savedRev");
                err.should.have.property("message","stop failed");
            });
            it('default swallows stop errors (unchanged, D-05)', async function() {
                await initFlows();
                Object.keys(flowCreate.flows).forEach(function(id) {
                    flowCreate.flows[id].stop = function() { return Promise.reject(new Error("stop failed")) };
                });
                const rev = await flows.setFlows(clone(baseConfig), "full");
                should.not.exist(rev);
            });
            it('default resolves before flows:started (unchanged)', async function() {
                await initFlows({deploy: {startTimeout: 1000}});
                startRecording();
                await flows.setFlows(clone(baseConfig), "full");
                recorded.should.not.containEql("flows:started");
                await waitFor("runtime-deploy");
            });
            it('load(true,{waitForStart}) waits for start', async function() {
                await initFlows();
                startRecording();
                const rev = await flows.load(true, waitForStart);
                rev.should.equal("loadedRev");
                recorded.should.containEql("flows:started");
                recorded.should.containEql("runtime-deploy");
            });
            it('rejects with deploy_start_failed and errors[].code safe_mode when safe mode prevents start', async function() {
                await initFlows();
                settings.safeMode = true;
                // A load without forceStart keeps safe mode (the Admin API reload removes it)
                const err = await flows.load(false, waitForStart).should.be.rejected();
                err.should.have.property("code","deploy_start_failed");
                err.should.have.property("rev","loadedRev");
                err.errors[0].should.have.property("code","safe_mode");
            });
            it('resolves without error when the flows are stopped on purpose (runtimeFlowState stop)', async function() {
                await initFlows();
                settings.get = function(prop) { return prop === "runtimeFlowState" ? "stop" : undefined };
                const rev = await flows.setFlows(clone(baseConfig), null, "full", false, false, null, waitForStart);
                rev.should.equal("savedRev");
            });
            it('rejects with start_timeout after deploy.startTimeout and keeps starting in background', async function() {
                await initFlows({deploy: {startTimeout: 30}});
                let finishStart;
                const pendingStart = new Promise(resolve => { finishStart = resolve });
                replaceFlowCreate(function() { return pendingStart });
                startRecording();
                const started = Date.now();
                const err = await flows.setFlows(clone(baseConfig), null, "full", false, false, null, waitForStart).should.be.rejected();
                (Date.now() - started).should.be.below(1000);
                err.should.have.property("code","deploy_start_failed");
                err.should.have.property("status",500);
                err.should.have.property("rev","savedRev");
                err.errors[0].should.have.property("code","start_timeout");
                recorded.should.not.containEql("flows:started");
                // The start goes on in the background; its result is logged
                const infoCalls = log.info.callCount;
                finishStart();
                await waitFor("runtime-deploy");
                await new Promise(resolve => setTimeout(resolve, 5));
                log.info.callCount.should.be.above(infoCalls);
            });
            describe('facts of the start (#22)', function() {
                let resultEvents;
                let resultListener;
                beforeEach(function() {
                    resultEvents = [];
                    resultListener = function(evt) {
                        if (evt.id === "deploy-start-result") { resultEvents.push(evt) }
                    };
                    events.on("runtime-event", resultListener);
                });
                afterEach(function() {
                    events.removeListener("runtime-event", resultListener);
                });
                function tick(ms) { return new Promise(resolve => setTimeout(resolve, ms || 10)) }

                it('start_timeout in the phase flows lists the flows not started and the current one', async function() {
                    await initFlows({deploy: {startTimeout: 30}});
                    let finishStart;
                    const pendingStart = new Promise(resolve => { finishStart = resolve });
                    replaceFlowCreate(function(id) { return id === "t1" ? pendingStart : Promise.resolve() });
                    try {
                        const err = await flows.setFlows(clone(baseConfig), null, "full", false, false, null, waitForStart).should.be.rejected();
                        const entry = err.errors[0];
                        entry.should.have.property("code","start_timeout");
                        entry.should.have.property("phase","flows");
                        entry.should.have.property("current","t1");
                        entry.pending.should.eql(["t1","t2"]);
                        entry.should.have.property("timeout",30);
                        entry.startedAt.should.be.a.Number();
                        entry.elapsed.should.be.a.Number();
                        entry.elapsed.should.be.aboveOrEqual(20); // the timer and Date.now differ by a millisecond or two
                        entry.should.have.property("message");
                    } finally {
                        finishStart();
                        await tick();
                    }
                });
                it('start_timeout in the phase modules has no flows pending', async function() {
                    await initFlows({deploy: {startTimeout: 30}});
                    let finishModules;
                    const modulesPending = new Promise(resolve => { finishModules = resolve });
                    checkFlowDependencies.callsFake(function() { return modulesPending });
                    try {
                        const err = await flows.setFlows(clone(baseConfig), null, "full", false, false, null, waitForStart).should.be.rejected();
                        const entry = err.errors[0];
                        entry.should.have.property("code","start_timeout");
                        entry.should.have.property("phase","modules");
                        entry.pending.should.eql([]);
                        entry.should.not.have.property("current");
                        entry.elapsed.should.be.a.Number();
                    } finally {
                        finishModules();
                        await tick();
                        checkFlowDependencies.callsFake(async function(flow) {
                            if (flow[0].id === "node-with-missing-modules") {
                                throw new Error("Missing module");
                            }
                        });
                    }
                });
                it('flow_start_failed of a rejected start() names the flow when known', async function() {
                    await initFlows();
                    flowCreate.restore();
                    // replaced stub - restored by the outer afterEach
                    flowCreate = sinon.stub(Flow,"create").callsFake(function(parent, global, flow) {
                        if (flow && flow.id === "t2") { throw new Error("create failed") }
                        return { start: async function() {}, stop: sinon.spy(async () => {}), update: sinon.spy(), getActiveNodes: () => ({}) };
                    });
                    const err = await flows.setFlows(clone(baseConfig), null, "full", false, false, null, waitForStart).should.be.rejected();
                    err.should.have.property("code","deploy_start_failed");
                    err.errors.should.have.length(1);
                    err.errors[0].should.have.property("code","flow_start_failed");
                    err.errors[0].should.have.property("message","create failed");
                    err.errors[0].should.have.property("flow","t2");
                });
                it('flow_start_failed of a rejected start() has no flow when none is known', async function() {
                    await initFlows();
                    checkFlowDependencies.callsFake(async function() { throw "not a list of modules" });
                    try {
                        const consoleLog = sinon.stub(console, "log");
                        let err;
                        try {
                            err = await flows.setFlows(clone(baseConfig), null, "full", false, false, null, waitForStart).should.be.rejected();
                        } finally {
                            consoleLog.restore();
                        }
                        err.errors[0].should.have.property("code","flow_start_failed");
                        err.errors[0].should.not.have.property("flow");
                    } finally {
                        checkFlowDependencies.callsFake(async function(flow) {
                            if (flow[0].id === "node-with-missing-modules") {
                                throw new Error("Missing module");
                            }
                        });
                    }
                });
                ["flows","nodes"].forEach(function(type) {
                    it('start_timeout of a "' + type + '" deploy lists only the flows the deployment starts something in', async function() {
                        await initFlows({deploy: {startTimeout: 30}});
                        const oldT2 = flowCreate.flows.t2;
                        let finishStart;
                        const pendingStart = new Promise(resolve => { finishStart = resolve });
                        // the changed flow t2 is started again (a new one after a flows stop, the same after a nodes stop);
                        // the unchanged global flow and t1 keep running - their start is held here as the first
                        // ones, so that they would be listed as pending if they were not filtered out
                        oldT2.start = function() { return pendingStart };
                        flowCreate.flows._GLOBAL_.start = function() { return pendingStart };
                        flowCreate.flows.t1.start = function() { return pendingStart };
                        replaceFlowCreate(function(id) { return id === "t2" ? pendingStart : Promise.resolve() });
                        const changed = clone(baseConfig);
                        changed.find(n => n.id === "t2-1").foo = "bar";
                        try {
                            const err = await flows.setFlows(changed, null, type, false, false, null, waitForStart).should.be.rejected();
                            const entry = err.errors[0];
                            entry.should.have.property("code","start_timeout");
                            entry.should.have.property("phase","flows");
                            // t1 and global keep running: neither is started by this deployment
                            entry.pending.should.eql(["t2"]);
                            // the start waits for global, which is not in pending: no current flow
                            entry.should.not.have.property("current");
                        } finally {
                            finishStart();
                            await tick();
                        }
                    });
                });
                ["flows","nodes"].forEach(function(type) {
                    it('start_timeout of a "' + type + '" deploy names the changed flow as current when it is the one being started', async function() {
                        await initFlows({deploy: {startTimeout: 30}});
                        let finishStart;
                        const pendingStart = new Promise(resolve => { finishStart = resolve });
                        flowCreate.flows.t2.start = function() { return pendingStart };
                        replaceFlowCreate(function(id) { return id === "t2" ? pendingStart : Promise.resolve() });
                        const changed = clone(baseConfig);
                        changed.find(n => n.id === "t2-1").foo = "bar";
                        try {
                            const err = await flows.setFlows(changed, null, type, false, false, null, waitForStart).should.be.rejected();
                            err.errors[0].pending.should.eql(["t2"]);
                            err.errors[0].should.have.property("current","t2");
                        } finally {
                            finishStart();
                            await tick();
                        }
                    });
                });
                ["nodes","flows"].forEach(function(type) {
                    it('start_timeout of a "' + type + '" deploy ' + (type === "nodes" ? 'does not list' : 'lists') + ' a flow with only rewired nodes', async function() {
                        await initFlows({deploy: {startTimeout: 1000}});
                        const wired = baseConfig.concat([{id:"t1-2",x:10,y:10,z:"t1",type:"test",wires:[]}]);
                        await flows.setFlows(clone(wired), null, "full", false, false, null, waitForStart);
                        const rewired = clone(wired);
                        rewired.find(n => n.id === "t1-1").wires = [["t1-2"]];
                        settings.deploy.startTimeout = 30;
                        let finishStart;
                        const pendingStart = new Promise(resolve => { finishStart = resolve });
                        // the start waits for global (first); t1 would be the one listed
                        flowCreate.flows._GLOBAL_.start = function() { return pendingStart };
                        replaceFlowCreate(function(id) { return id === "t1" ? pendingStart : Promise.resolve() });
                        try {
                            const err = await flows.setFlows(rewired, null, type, false, false, null, waitForStart).should.be.rejected();
                            // "nodes" does not restart the rewired nodes (only rewires them); "flows" does
                            err.errors[0].pending.should.eql(type === "flows" ? ["t1"] : []);
                        } finally {
                            finishStart();
                            await tick();
                        }
                    });
                });
                it('start_timeout of a "flows" deploy lists a flow the deployment creates', async function() {
                    await initFlows({deploy: {startTimeout: 30}});
                    let finishStart;
                    const pendingStart = new Promise(resolve => { finishStart = resolve });
                    replaceFlowCreate(function(id) { return id === "t3" ? pendingStart : Promise.resolve() });
                    const config = clone(baseConfig).concat([{id:"t3-1",x:10,y:10,z:"t3",type:"test",wires:[]},{id:"t3",type:"tab",label:"Flow 3"}]);
                    try {
                        const err = await flows.setFlows(config, null, "flows", false, false, null, waitForStart).should.be.rejected();
                        err.errors[0].pending.should.eql(["t3"]);
                        err.errors[0].should.have.property("current","t3");
                    } finally {
                        finishStart();
                        await tick();
                    }
                });
                it('flow_start_failed of a rejected start() does not name a flow created before the failing one', async function() {
                    await initFlows();
                    const oldT2 = flowCreate.flows.t2;
                    oldT2.update = function() { throw new Error("update failed") };
                    flowCreate.restore();
                    // replaced stub - restored by the outer afterEach
                    flowCreate = sinon.stub(Flow,"create").callsFake(function() {
                        return { start: async function() {}, stop: sinon.spy(async () => {}), update: sinon.spy(), getActiveNodes: () => ({}) };
                    });
                    // t0 is created first, then the update of the existing t2 throws
                    const config = [{id:"t0-1",x:10,y:10,z:"t0",type:"test",wires:[]},{id:"t0",type:"tab",label:"Flow 0"}].concat(clone(baseConfig));
                    const err = await flows.setFlows(config, null, "flows", false, false, null, waitForStart).should.be.rejected();
                    err.errors[0].should.have.property("code","flow_start_failed");
                    err.errors[0].should.have.property("message","update failed");
                    err.errors[0].should.have.property("flow","t2");
                });
                it('the other start errors are unchanged (no extra fields)', async function() {
                    await initFlows({deploy: {startTimeout: 1000}});
                    const config = clone(baseConfig);
                    config.push({id:"t1-2",z:"t1",type:"missing",wires:[]});
                    const err = await flows.setFlows(config, null, "full", false, false, null, waitForStart).should.be.rejected();
                    Object.keys(err.errors[0]).sort().should.eql(["code","message","types"]);
                });
                it('emits deploy-start-result "started" after a start_timeout response when the start completes', async function() {
                    await initFlows({deploy: {startTimeout: 30}});
                    let finishStart;
                    const pendingStart = new Promise(resolve => { finishStart = resolve });
                    replaceFlowCreate(function() { return pendingStart });
                    await flows.setFlows(clone(baseConfig), null, "full", false, false, null, waitForStart).should.be.rejected();
                    resultEvents.should.have.length(0);
                    finishStart();
                    await tick();
                    resultEvents.should.have.length(1);
                    resultEvents[0].should.have.property("retain",false);
                    resultEvents[0].payload.should.have.property("type","success");
                    resultEvents[0].payload.should.have.property("text","notification.info.deploy-started");
                    resultEvents[0].payload.should.have.property("revision","savedRev");
                });
                it('emits deploy-start-result with the errors after a start_timeout response when the start fails', async function() {
                    await initFlows({deploy: {startTimeout: 30}});
                    let failStart;
                    const pendingStart = new Promise((resolve, reject) => { failStart = reject });
                    replaceFlowCreate(function(id) { return id === "t2" ? pendingStart : Promise.resolve() });
                    const consoleLog = sinon.stub(console, "log");
                    try {
                        await flows.setFlows(clone(baseConfig), null, "full", false, false, null, waitForStart).should.be.rejected();
                        resultEvents.should.have.length(0);
                        failStart(new Error("late boom"));
                        await tick();
                    } finally {
                        consoleLog.restore();
                    }
                    resultEvents.should.have.length(1);
                    resultEvents[0].should.have.property("retain",false);
                    resultEvents[0].payload.should.have.property("type","error");
                    resultEvents[0].payload.should.have.property("text","notification.errors.deploy-start-failed");
                    resultEvents[0].payload.should.have.property("revision","savedRev");
                    resultEvents[0].payload.errors.should.have.length(1);
                    resultEvents[0].payload.errors[0].should.have.property("code","flow_start_failed");
                    resultEvents[0].payload.errors[0].should.have.property("flow","t2");
                    resultEvents[0].payload.errors[0].should.have.property("message","late boom");
                });
                it('emits no deploy-start-result for a deployment that answered in time', async function() {
                    await initFlows({deploy: {startTimeout: 1000}});
                    await flows.setFlows(clone(baseConfig), null, "full", false, false, null, waitForStart);
                    // a start that fails within the limit
                    const config = clone(baseConfig);
                    config.push({id:"t1-2",z:"t1",type:"missing",wires:[]});
                    await flows.setFlows(config, null, "full", false, false, null, waitForStart).should.be.rejected();
                    await tick(40);
                    resultEvents.should.have.length(0);
                });
                it('emits no deploy-start-result in the default mode', async function() {
                    await initFlows({deploy: {startTimeout: 30}});
                    let finishStart;
                    const pendingStart = new Promise(resolve => { finishStart = resolve });
                    replaceFlowCreate(function() { return pendingStart });
                    // the default mode answers before the start with the revision
                    const rev = await flows.setFlows(clone(baseConfig), "full");
                    rev.should.equal("savedRev");
                    await tick(60);
                    finishStart();
                    await tick();
                    resultEvents.should.have.length(0);
                });
            });
            it('no timeout when deploy.startTimeout absent', async function() {
                await initFlows();
                replaceFlowCreate(function() { return new Promise(resolve => setTimeout(resolve, 50)) });
                startRecording();
                const rev = await flows.setFlows(clone(baseConfig), null, "full", false, false, null, waitForStart);
                rev.should.equal("savedRev");
                recorded.should.containEql("flows:started");
            });
            [
                {name: "default mode", deployOpts: undefined, deploy: {startTimeout: 30}},
                {name: "started mode", deployOpts: waitForStart, deploy: {startTimeout: 30}},
                {name: "started mode, startTimeoutReleasesLock false", deployOpts: waitForStart, deploy: {startTimeout: 30, startTimeoutReleasesLock: false}}
            ].forEach(function(mode) {
                it('with deploy.startTimeout keeps the deploy lock until the start completes - ' + mode.name + ' (R-45)', async function() {
                    const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");
                    const utilLog = NR_TEST_UTILS.require("@node-red/util").log;
                    const warn = sinon.stub(utilLog, "warn");
                    let finishStart;
                    try {
                        await initFlows({deploy: mode.deploy});
                        const pendingStart = new Promise(resolve => { finishStart = resolve });
                        replaceFlowCreate(function() { return pendingStart });
                        let error;
                        await lock.runExclusive(function() {
                            return flows.setFlows(clone(baseConfig), null, "full", false, false, null, mode.deployOpts);
                        }).catch(err => { error = err });
                        if (mode.deployOpts) {
                            // 500 start_timeout is returned, the lock is kept
                            error.should.have.property("code","deploy_start_failed");
                            error.errors[0].should.have.property("code","start_timeout");
                        } else {
                            should.not.exist(error);
                        }
                        await new Promise(resolve => setTimeout(resolve, 80));
                        lock.isLocked().should.be.true();
                        warn.called.should.be.false();
                        finishStart();
                        await lock.runExclusive(async () => {});
                        lock.isLocked().should.be.false();
                        await new Promise(resolve => setTimeout(resolve, 5));
                    } finally {
                        warn.restore();
                        if (finishStart) { finishStart() }
                    }
                });
            });
            it('with deploy.startTimeoutReleasesLock releases the deploy lock after the limit while the start goes on (W2, R-45)', async function() {
                const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");
                const utilLog = NR_TEST_UTILS.require("@node-red/util").log;
                const warn = sinon.stub(utilLog, "warn");
                let finishStart;
                try {
                    await initFlows({deploy: {startTimeout: 30, startTimeoutReleasesLock: true}});
                    const pendingStart = new Promise(resolve => { finishStart = resolve });
                    replaceFlowCreate(function() { return pendingStart });
                    // default response mode: the result returns before the start
                    await lock.runExclusive(function() {
                        return flows.setFlows(clone(baseConfig), "full");
                    });
                    lock.isLocked().should.be.true();
                    await lock.runExclusive(async () => {});
                    lock.isLocked().should.be.false();
                    warn.calledOnce.should.be.true();
                } finally {
                    warn.restore();
                    if (finishStart) { finishStart() }
                }
            });
            it('default mode logs start() rejection', async function() {
                await initFlows();
                flowCreate.restore();
                // replaced stub - restored by the outer afterEach
                flowCreate = sinon.stub(Flow,"create").callsFake(function() { throw new Error("create failed") });
                await flows.setFlows(clone(baseConfig), "full");
                await new Promise(resolve => setTimeout(resolve, 10));
                log.error.called.should.be.true();
            });
        });

        describe('#getFlowRevision (Z-04)', function() {
            const config = baseConfig.concat([
                {id:"g1",type:"test-config"},
                {id:"sf1",type:"subflow",name:"sf"},
                {id:"sf1-1",type:"test",z:"sf1"}
            ]);
            it('is stable for unchanged flow', async function() {
                await loadAndStart(config);
                const rev = flows.getFlowRevision("t1");
                rev.should.match(/^[0-9a-f]{64}$/);
                await flows.setFlows(clone(config), "full");
                flows.getFlowRevision("t1").should.equal(rev);
            });
            it('changes when flow node changes', async function() {
                await loadAndStart(config);
                const rev = flows.getFlowRevision("t1");
                const changed = clone(config);
                changed[0].x = 99;
                await flows.setFlows(changed, "full");
                flows.getFlowRevision("t1").should.not.equal(rev);
            });
            it('does not change when another flow changes', async function() {
                await loadAndStart(config);
                const rev = flows.getFlowRevision("t1");
                const revAll = flows.getFlows().rev;
                const changed = clone(config);
                changed[2].x = 99;
                storage.saveFlows = function(conf) { storage.conf = conf; return Promise.resolve("otherRev") };
                await flows.setFlows(changed, "full");
                flows.getFlowRevision("t1").should.equal(rev);
                flows.getFlows().rev.should.not.equal(revAll);
            });
            it('ignores credentials', async function() {
                await loadAndStart(config);
                const rev = flows.getFlowRevision("t1");
                const withCreds = clone(config);
                withCreds[0].credentials = {user:"a"};
                await flows.setFlows(withCreds, "full");
                flows.getFlowRevision("t1").should.equal(rev);
            });
            it('computes global revision', async function() {
                await loadAndStart(config);
                const rev = flows.getFlowRevision("global");
                rev.should.match(/^[0-9a-f]{64}$/);
                const changed = clone(config);
                changed[0].x = 99;
                await flows.setFlows(changed, "full");
                flows.getFlowRevision("global").should.equal(rev);
                const changedGlobal = clone(config);
                changedGlobal[4].name = "changed";
                await flows.setFlows(changedGlobal, "full");
                flows.getFlowRevision("global").should.not.equal(rev);
            });
            it('returns null for an unknown flow', async function() {
                await loadAndStart(config);
                should.not.exist(flows.getFlowRevision("unknown"));
                should.not.exist(flows.getFlowRevision("t1-1"));
            });
        });

        describe('single-flow configuration (Z-04)', function() {
            const config = baseConfig.concat([{id:"g1",type:"test-config",value:1}]);
            function codeOf(fn) {
                try {
                    fn();
                } catch(err) {
                    return err.code;
                }
                return null;
            }
            it('creates flow with given id when create flag set', async function() {
                await loadAndStart(config);
                const built = flows.buildUpdateFlowConfig("new1", {label:"New", layout:"TB", nodes:[{id:"n1",type:"test",wires:[]}]}, {create:true});
                built.should.have.property("created", true);
                built.config.should.containEql({type:"tab",label:"New",id:"new1",layout:"TB"});
                built.config.should.containEql({id:"n1",type:"test",wires:[],z:"new1"});
                await flows.updateFlow("new1", {label:"New", layout:"TB", nodes:[{id:"n1",type:"test",x:10,y:10,wires:[]}]}, null, undefined, {create:true});
                flows.getFlow("new1").should.have.property("layout","TB");
                flows.getFlow("new1").nodes.should.have.length(1);
            });
            it('rejects an unknown flow with code 404 without the create flag', async function() {
                await loadAndStart(config);
                codeOf(() => flows.buildUpdateFlowConfig("new1", {nodes:[]})).should.equal(404);
            });
            it('rejects create when id used by a node', async function() {
                await loadAndStart(config);
                codeOf(() => flows.buildUpdateFlowConfig("t1-1", {nodes:[]}, {create:true})).should.equal("invalid_flow_id");
                codeOf(() => flows.buildUpdateFlowConfig("g1", {nodes:[]}, {create:true})).should.equal("invalid_flow_id");
            });
            it('rejects node id used in another flow', async function() {
                await loadAndStart(config);
                codeOf(() => flows.buildUpdateFlowConfig("t1", {nodes:[{id:"t2-1",type:"test"}]})).should.equal("duplicate_id");
                codeOf(() => flows.buildUpdateFlowConfig("t1", {nodes:[], configs:[{id:"g1",type:"test-config"}]})).should.equal("duplicate_id");
                // nodes of the same flow keep their ids
                should(codeOf(() => flows.buildUpdateFlowConfig("t1", {nodes:[{id:"t1-1",type:"test"}]}))).be.null();
            });
            it('upserts globalConfigs', async function() {
                await loadAndStart(config);
                const built = flows.buildUpdateFlowConfig("t1", {nodes:[{id:"t1-1",type:"test"}]}, {globalConfigs:[{id:"g1",type:"test-config",value:2},{id:"g2",type:"test-config",z:"t1"}]});
                built.config.filter(n => n.id === "g1").should.eql([{id:"g1",type:"test-config",value:2}]);
                built.config.filter(n => n.id === "g2").should.eql([{id:"g2",type:"test-config"}]);
                const added = flows.buildAddFlowConfig({nodes:[]}, {globalConfigs:[{id:"g3",type:"test-config"}]});
                added.config.filter(n => n.id === "g3").should.eql([{id:"g3",type:"test-config"}]);
            });
            it('rejects globalConfig id used in another flow', async function() {
                await loadAndStart(config);
                codeOf(() => flows.buildUpdateFlowConfig("t1", {nodes:[]}, {globalConfigs:[{id:"t2-1",type:"test-config"}]})).should.equal("duplicate_id");
                codeOf(() => flows.buildUpdateFlowConfig("t1", {nodes:[{id:"x1",type:"test"}]}, {globalConfigs:[{id:"x1",type:"test-config"}]})).should.equal("duplicate_id");
                codeOf(() => flows.buildAddFlowConfig({nodes:[]}, {globalConfigs:[{id:"t2",type:"test-config"}]})).should.equal("duplicate_id");
            });
            it('rejects globalConfigs of type tab, subflow or group', async function() {
                await loadAndStart(config);
                ["tab","subflow","group"].forEach(function(type) {
                    codeOf(() => flows.buildUpdateFlowConfig("t1", {nodes:[]}, {globalConfigs:[{id:"x",type:type}]})).should.equal("invalid_node_type");
                });
            });
            it('keeps configs flow-scoped', async function() {
                await loadAndStart(config);
                const built = flows.buildUpdateFlowConfig("t1", {nodes:[], configs:[{id:"c2",type:"test-config"}]});
                built.config.filter(n => n.id === "c2").should.eql([{id:"c2",type:"test-config",z:"t1"}]);
            });
        });
    });
    describe('instance state (E-02)', function() {
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        const okConfig = [
            {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
            {id:"t1",type:"tab"}
        ];
        function loadAndStart(config, settings) {
            storage.getFlows = function() {
                return Promise.resolve({flows:clone(config), rev:"loadedRev"});
            }
            flows.init({log:mockLog, settings:settings||{}, storage:storage});
            return flows.load().then(function() {
                return flows.startFlows();
            });
        }
        beforeEach(function() {
            instanceState.reset();
            instanceState.markStarting();
        });
        afterEach(async function() {
            // Leave a configuration without missing types: a type registered by
            // later tests must not start these flows
            await flows.stopFlows();
            storage.getFlows = function() { return Promise.resolve({flows:clone(okConfig), rev:"cleanRev"}) };
            await flows.load();
            instanceState.reset();
        });

        it('start without errors -> ready', async function() {
            await loadAndStart(okConfig);
            instanceState.get().should.containEql({state:"ready", reason:"startup"});
        });
        it('missing types -> failed', async function() {
            await loadAndStart([{id:"t1-1",z:"t1",type:"missing"},{id:"t1",type:"tab"}]);
            instanceState.get().should.containEql({state:"failed", reason:"missing-types"});
        });
        it('missing modules -> failed', async function() {
            await loadAndStart([{id:"node-with-missing-modules",z:"t1",type:"test"},{id:"t1",type:"tab"}]);
            instanceState.get().should.containEql({state:"failed", reason:"missing-modules"});
        });
        it('safe mode -> idle', async function() {
            const result = await loadAndStart(okConfig, {safeMode:true});
            result.should.have.property("flowsRunning", false);
            result.errors[0].should.have.property("code", "safe_mode");
            instanceState.get().should.containEql({state:"idle", reason:"safe-mode"});
        });
        it('runtimeFlowState stop -> idle', async function() {
            const result = await loadAndStart(okConfig, {get: function(prop) { return prop === "runtimeFlowState" ? "stop" : undefined }});
            result.should.eql({errors:[], flowsRunning:false, reason:"set-state"});
            instanceState.get().should.containEql({state:"idle", reason:"set-state"});
        });
        it('Flow.start throws -> failed (flow-start-failed)', async function() {
            flowCreate.restore();
            // replaced stub - restored by the outer afterEach
            flowCreate = sinon.stub(Flow,"create").callsFake(function() {
                return {
                    start: async function() { throw new Error("boom") },
                    stop: sinon.spy(async () => {}),
                    update: sinon.spy(),
                    getActiveNodes: () => ({})
                };
            });
            const consoleLog = sinon.stub(console, "log");
            try {
                await loadAndStart(okConfig);
            } finally {
                consoleLog.restore();
            }
            instanceState.get().should.containEql({state:"failed", reason:"flow-start-failed"});
        });
        it('type-registered late start -> ready', async function() {
            await loadAndStart([{id:"t1-1",z:"t1",type:"missing"},{id:"t1",type:"tab"}]);
            instanceState.get().state.should.equal("failed");
            const ready = new Promise(resolve => {
                const off = instanceState.onChange(info => { if (info.state === "ready") { off(); resolve(info) } });
            });
            events.emit("type-registered","missing");
            const info = await ready;
            info.should.containEql({state:"ready", previous:"failed"});
        });
        it('a deployment does not change the state through the start (the pipeline does)', async function() {
            await loadAndStart(okConfig);
            const token = instanceState.begin("deploy");
            await flows.setFlows(clone(okConfig).concat([{id:"t1-2",z:"t1",type:"missing"}]), null, "full", false, false, null, {waitForStart:true}).catch(() => {});
            instanceState.get().state.should.equal("deploying");
            instanceState.end(token, {aborted:true});
        });
    });
    describe('reload from storage (Z-09)', function() {
        const base = [
            {id:"t1",type:"tab"},
            {id:"t1-1",z:"t1",type:"test",foo:"a",wires:[]},
            {id:"t2",type:"tab"},
            {id:"t2-1",z:"t2",type:"test",foo:"a",wires:[]}
        ];
        function changed(id, value) {
            const config = clone(base);
            config.forEach(n => { if (n.id === id) { n.foo = value } });
            return config;
        }
        async function startWith(config, settings) {
            storage.getFlows = function() {
                return Promise.resolve({flows:clone(config), rev:"A"});
            };
            flows.init({log:mockLog, settings:settings||{}, storage:storage});
            await flows.load();
            await flows.startFlows();
        }

        it('getChangedFlows lists the changed tabs', async function() {
            await startWith(base);
            flows.getChangedFlows({flows: changed("t1-1","b")}).should.eql(["t1"]);
            flows.getChangedFlows({flows: clone(base)}).should.eql([]);
        });
        it('getChangedFlows: a changed config node outside the flows - null (all flows)', async function() {
            const withConfig = clone(base).concat([{id:"c1",type:"test-config",foo:"a"}]);
            await startWith(withConfig);
            const next = clone(withConfig);
            next[next.length-1].foo = "b";
            should(flows.getChangedFlows({flows: next})).be.null();
        });
        it('getChangedFlows: a changed global-config node - null (all flows)', async function() {
            const withConfig = clone(base).concat([{id:"c1",type:"global-config",foo:"a"}]);
            await startWith(withConfig);
            const next = clone(withConfig);
            next[next.length-1].foo = "b";
            should(flows.getChangedFlows({flows: next})).be.null();
        });
        it('reloadFromStorage type diff restarts only changed flows', async function() {
            await startWith(base);
            const t2 = flowCreate.flows["t2"];
            flowCreate.flows["t1"].stop = sinon.spy(async () => {});
            const t1 = flowCreate.flows["t1"];
            t2.stop = sinon.spy(async () => {});
            const rev = await flows.reloadFromStorage({flows: changed("t1-1","b"), rev:"B", credentials:{}}, {type:"diff"});
            rev.should.equal("B");
            // stop() of a modified-flows reload: t1 with the changed nodes, t2 untouched
            t1.stop.calledOnce.should.be.true();
            t1.stop.firstCall.args[0].should.containEql("t1-1");
            t2.stop.firstCall.args[0].should.not.containEql("t2-1");
            storage.hasOwnProperty('conf').should.be.false();
            flows.getFlows().rev.should.equal("B");
            credentialsLoad.called.should.be.true();
        });
        it('reloadFromStorage full restarts all', async function() {
            await startWith(base);
            const before = Object.assign({}, flowCreate.flows);
            await flows.reloadFromStorage({flows: changed("t1-1","b"), rev:"B", credentials:{}}, {type:"full"});
            await new Promise(r => setTimeout(r, 10));
            flowCreate.flows["t2"].should.not.equal(before["t2"]);
            flowCreate.flows["t1"].should.not.equal(before["t1"]);
            storage.hasOwnProperty('conf').should.be.false();
        });
        it('reloadFromStorage does not start stopped flows', async function() {
            await startWith(base);
            await flows.stopFlows();
            const created = Object.keys(flowCreate.flows).length;
            flowCreate.flows = {};
            await flows.reloadFromStorage({flows: changed("t1-1","b"), rev:"B", credentials:{}}, {type:"full"});
            await new Promise(r => setTimeout(r, 10));
            Object.keys(flowCreate.flows).should.have.length(0);
            created.should.be.above(0);
            flows.getFlows().rev.should.equal("B");
        });
        it('globalConfigChanged forces full', async function() {
            const withConfig = clone(base).concat([{id:"c1",type:"global-config",foo:"a"}]);
            await startWith(withConfig);
            const before = Object.assign({}, flowCreate.flows);
            const next = clone(withConfig);
            next[next.length-1].foo = "b";
            await flows.reloadFromStorage({flows: next, rev:"B", credentials:{}}, {type:"diff"});
            await new Promise(r => setTimeout(r, 10));
            flowCreate.flows["t2"].should.not.equal(before["t2"]);
        });
    });
    describe('credentials of the active configuration (#2)', function() {
        const base = [
            {id:"t1",type:"tab"},
            {id:"t1-1",z:"t1",type:"test",foo:"a",wires:[]}
        ];
        const CREDS = {n1:{user:"abc",password:"123"},n2:{token:"xyz"}};
        async function startWith(creds) {
            storage.getFlows = function() {
                return Promise.resolve({flows:clone(base), rev:"A", credentials:clone(creds)});
            };
            flows.init({log:mockLog, settings:{}, storage:storage});
            await flows.load();
            await flows.startFlows();
        }

        it('getFlows() returns only {flows, rev} - the digest is not a property of the active configuration', async function() {
            await startWith(CREDS);
            Object.keys(flows.getFlows()).sort().should.eql(["flows","rev"]);
            const digest = credentials.digest(CREDS);
            JSON.stringify(flows.getFlows()).should.not.containEql(digest);
            // after a deployment too
            await flows.setFlows(clone(base));
            Object.keys(flows.getFlows()).sort().should.eql(["flows","rev"]);
            JSON.stringify(flows.getFlows()).should.not.containEql(digest);
            // after a reload from storage too
            await flows.reloadFromStorage({flows:clone(base), rev:"B", credentials:{n1:{user:"other"}}}, {type:"full"});
            Object.keys(flows.getFlows()).sort().should.eql(["flows","rev"]);
        });
        it('credentialsChanged compares the content: the same (any order of keys) - false, another - true', async function() {
            await startWith(CREDS);
            flows.credentialsChanged({credentials:clone(CREDS)}).should.be.false();
            flows.credentialsChanged({credentials:{n2:{token:"xyz"},n1:{password:"123",user:"abc"}}}).should.be.false();
            flows.credentialsChanged({credentials:{n1:{user:"abc",password:"124"},n2:{token:"xyz"}}}).should.be.true();
            flows.credentialsChanged({credentials:{n1:CREDS.n1}}).should.be.true();
            flows.credentialsChanged({credentials:{}}).should.be.true();
            flows.credentialsChanged({}).should.be.true();
        });
        it('credentialsChanged loads and changes nothing', async function() {
            await startWith(CREDS);
            credentialsLoad.resetHistory();
            credentialsAdd.resetHistory();
            flows.credentialsChanged({credentials:{n1:{user:"other"}}}).should.be.true();
            credentialsLoad.called.should.be.false();
            credentialsAdd.called.should.be.false();
            credentialsClean.called.should.be.false();
        });
        it('reloadFromStorage: the credentials of the reloaded configuration are the active ones', async function() {
            await startWith(CREDS);
            const next = {n1:{user:"other"}};
            flows.credentialsChanged({credentials:next}).should.be.true();
            await flows.reloadFromStorage({flows:clone(base), rev:"A", credentials:clone(next)}, {type:"full"});
            flows.credentialsChanged({credentials:next}).should.be.false();
            flows.credentialsChanged({credentials:CREDS}).should.be.true();
        });
        it('an own save with credentials: they are the active ones, the notification of it is not a change', async function() {
            await startWith(CREDS);
            const saved = {n1:{user:"own"}};
            const exportStub = sinon.stub(credentials, "export").callsFake(async () => clone(saved));
            const dirtyStub = sinon.stub(credentials, "dirty").returns(true);
            try {
                await flows.setFlows(clone(base));
                storage.conf.credentialsDirty.should.be.true();
                storage.conf.credentials.should.eql(saved);
            } finally {
                exportStub.restore();
                dirtyStub.restore();
            }
            flows.credentialsChanged({credentials:saved}).should.be.false();
            flows.credentialsChanged({credentials:CREDS}).should.be.true();
        });
        it('an own save without credentials: storage keeps its credentials, the active ones do not change', async function() {
            await startWith(CREDS);
            // not dirty: the export may return anything, it is not saved
            const exportStub = sinon.stub(credentials, "export").callsFake(async () => null);
            const dirtyStub = sinon.stub(credentials, "dirty").returns(false);
            try {
                await flows.setFlows(clone(base));
                should(storage.conf.credentialsDirty).not.be.ok();
            } finally {
                exportStub.restore();
                dirtyStub.restore();
            }
            flows.credentialsChanged({credentials:clone(CREDS)}).should.be.false();
        });
        it('stored credentials that cannot be decrypted: credentials_load_failed', async function() {
            await startWith(CREDS);
            (function() { flows.credentialsChanged({credentials:{"$":"not a valid ciphertext"}}) }).should.throw({code:"credentials_load_failed"});
        });
        it('a start with credentials that failed to load (reset): the flows load, the digest is unknown - any stored credentials differ', async function() {
            credentialsLoad.callsFake(function() {
                return Promise.reject(Object.assign(new Error("Failed to decrypt credentials"), {code:"credentials_load_failed"}));
            });
            await startWith({"$":"not a valid ciphertext"});
            flows.getFlows().rev.should.equal("A");
            flows.credentialsChanged({credentials:{}}).should.be.true();
            flows.credentialsChanged({credentials:CREDS}).should.be.true();
        });
        it('hasCredentialsRevision: true with a digest, false when the credentials could not be digested', async function() {
            await startWith(CREDS);
            flows.hasCredentialsRevision().should.be.true();
            await flows.stopFlows();
            credentialsLoad.callsFake(function() {
                return Promise.reject(Object.assign(new Error("Failed to decrypt credentials"), {code:"credentials_load_failed"}));
            });
            await startWith({"$":"not a valid ciphertext"});
            flows.hasCredentialsRevision().should.be.false();
            // a deployment with credentials that can be digested gives it back
            const exportStub = sinon.stub(credentials, "export").callsFake(async () => clone(CREDS));
            const dirtyStub = sinon.stub(credentials, "dirty").returns(true);
            try {
                await flows.setFlows(clone(base));
            } finally {
                exportStub.restore();
                dirtyStub.restore();
            }
            flows.hasCredentialsRevision().should.be.true();
        });
        it('any error of the digest of the active configuration: the deployment is not failed, the digest is unknown, only the code is logged', async function() {
            await startWith(CREDS);
            mockLog.debug.resetHistory();
            const secret = "secret-password-from-an-unexpected-error";
            const digestStub = sinon.stub(credentials, "digest").callsFake(function() {
                throw Object.assign(new TypeError(secret), {code:"unexpected_code"});
            });
            try {
                // an own save that is already stored must not fail because of the digest
                const exportStub = sinon.stub(credentials, "export").callsFake(async () => clone(CREDS));
                const dirtyStub = sinon.stub(credentials, "dirty").returns(true);
                try {
                    await flows.setFlows(clone(base)).should.be.fulfilled();
                } finally {
                    exportStub.restore();
                    dirtyStub.restore();
                }
                // and a reload from storage
                await flows.reloadFromStorage({flows:clone(base), rev:"B", credentials:clone(CREDS)}, {type:"full"});
            } finally {
                digestStub.restore();
            }
            flows.getFlows().rev.should.equal("B");
            flows.hasCredentialsRevision().should.be.false();
            // unknown = changed
            flows.credentialsChanged({credentials:clone(CREDS)}).should.be.true();
            const logged = JSON.stringify(mockLog.debug.args);
            logged.should.containEql("unexpected_code");
            logged.should.not.containEql(secret);
        });
        it('without an active configuration (failed start) the credentials differ', async function() {
            storage.getFlows = function() {
                return Promise.reject(Object.assign(new Error("no flows"), {code:"invalid_flows"}));
            };
            flows.init({log:mockLog, settings:{}, storage:storage});
            await flows.load().should.be.rejected();
            should(flows.getFlows()).be.null();
            flows.credentialsChanged({credentials:{}}).should.be.true();
        });
    });
    describe('editor-only instance (Z-15)', function() {
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        const okConfig = [
            {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
            {id:"t1",type:"tab"}
        ];
        let runtimeEvents;
        let settingsGet;
        let settingsSet;
        function editorSettings(extra) {
            settingsGet = sinon.spy(function() { return "start" });
            settingsSet = sinon.spy();
            return Object.assign({editorOnly: true, get: settingsGet, set: settingsSet}, extra || {});
        }
        function loadWith(settings) {
            storage.getFlows = function() {
                return Promise.resolve({flows:clone(okConfig), rev:"loadedRev"});
            };
            flows.init({log:mockLog, settings:settings, storage:storage});
            return flows.load().then(function() {
                return flows.startFlows();
            });
        }
        function onRuntimeEvent(event) { runtimeEvents.push(event) }
        beforeEach(function() {
            runtimeEvents = [];
            events.on("runtime-event", onRuntimeEvent);
            instanceState.reset();
            instanceState.markStarting();
        });
        afterEach(function() {
            events.removeListener("runtime-event", onRuntimeEvent);
            instanceState.reset();
        });

        it('default: unchanged start behaviour', async function() {
            const result = await loadWith({});
            result.should.eql({errors:[]});
            flowCreate.called.should.be.true();
            instanceState.get().state.should.equal("ready");
        });
        it('editorOnly: start does not start flows', async function() {
            const result = await loadWith(editorSettings());
            result.should.eql({errors:[], flowsRunning:false, reason:"editor-only"});
            flowCreate.called.should.be.false();
            flows.state().should.equal("stop");
        });
        it('editorOnly: emits runtime-state editor-only', async function() {
            await loadWith(editorSettings());
            runtimeEvents.some(e => e.id === "runtime-state" && e.payload && e.payload.error === "editor-only" && e.payload.state === "stop" && e.payload.type === "info" && e.payload.text === "notification.info.editor-only").should.be.true();
        });
        it('editorOnly: does not read or write runtimeFlowState', async function() {
            await loadWith(editorSettings());
            settingsGet.calledWith("runtimeFlowState").should.be.false();
            settingsSet.called.should.be.false();
        });
        function loadConfig(settings, config, log) {
            storage.getFlows = function() {
                return Promise.resolve({flows:clone(config), rev:"loadedRev"});
            };
            flows.init({log:log || mockLog, settings:settings, storage:storage});
            return flows.load().then(function() {
                return flows.startFlows();
            });
        }
        function keyLog() {
            const log = {warn: sinon.spy(), info: sinon.spy(), debug: sinon.spy(), trace: sinon.spy(), error: sinon.spy(), log: sinon.spy(), metric: sinon.spy()};
            log._ = function(key, params) { return key + (params ? " " + JSON.stringify(params) : "") };
            return log;
        }
        it('editorOnly: missing types - loaded (not failed) with a warning in the log (review regression)', async function() {
            const log = keyLog();
            const result = await loadConfig(editorSettings(), [{id:"t1-1",z:"t1",type:"missing"},{id:"t1",type:"tab"}], log);
            result.should.eql({errors:[], flowsRunning:false, reason:"editor-only"});
            instanceState.get().state.should.equal("loaded");
            instanceState.isReady().should.be.true();
            log.warn.args.some(a => String(a[0]).indexOf("nodes.flows.editor-only-missing-types") === 0 && String(a[0]).indexOf("missing") !== -1).should.be.true();
            runtimeEvents.some(e => e.id === "runtime-state" && e.payload && e.payload.error === "missing-types").should.be.false();
        });
        it('editorOnly: checkFlowDependencies (modules of the function node) is not called (review regression)', async function() {
            checkFlowDependencies.resetHistory();
            const result = await loadConfig(editorSettings(), [{id:"node-with-missing-modules",z:"t1",type:"test"},{id:"t1",type:"tab"}]);
            checkFlowDependencies.called.should.be.false();
            result.errors.should.eql([]);
            instanceState.get().state.should.equal("loaded");
        });
        it('editorOnly: a deployment with missing types is not a start error', async function() {
            await loadWith(editorSettings());
            const next = clone(okConfig).concat([{id:"t1-2",z:"t1",type:"missing",wires:[]}]);
            await flows.setFlows(next, null, "full", false, false, null, {waitForStart:true});
            storage.conf.flows.should.eql(next);
            flowCreate.called.should.be.false();
        });
        it('default: missing types still fail the start (unchanged)', async function() {
            checkFlowDependencies.resetHistory();
            const result = await loadConfig({}, [{id:"t1-1",z:"t1",type:"missing"},{id:"t1",type:"tab"}]);
            result.errors[0].should.have.property("code","missing_types");
            instanceState.get().state.should.equal("failed");
        });
        it('editorOnly: start ends in loaded (ready probe 200, D-13)', async function() {
            await loadWith(editorSettings());
            instanceState.get().state.should.equal("loaded");
            instanceState.isReady().should.be.true();
        });
        it('editorOnly: setFlows saves without starting (full/nodes/flows)', async function() {
            await loadWith(editorSettings());
            runtimeEvents = [];
            for (const type of ["full", "nodes", "flows"]) {
                delete storage.conf;
                const next = clone(okConfig).concat([{id:"t1-"+type,z:"t1",type:"test",wires:[]}]);
                await flows.setFlows(next, null, type);
                storage.conf.flows.should.eql(next);
            }
            flowCreate.called.should.be.false();
            runtimeEvents.filter(e => e.id === "runtime-deploy").length.should.equal(3);
        });
        it('editorOnly: setFlows with forceStart does not start', async function() {
            await loadWith(editorSettings());
            await flows.setFlows(clone(okConfig), null, "full", false, true);
            flowCreate.called.should.be.false();
        });
        it('editorOnly: load(true) does not start', async function() {
            await loadWith(editorSettings());
            await flows.load(true);
            flowCreate.called.should.be.false();
        });
        it('editorOnly: safeMode is not cleared by deploy', async function() {
            const settings = editorSettings({safeMode: true});
            await loadWith(settings);
            await flows.setFlows(clone(okConfig), null, "full");
            await flows.load(true);
            settings.safeMode.should.be.true();
            flowCreate.called.should.be.false();
        });
        it('editorOnly: waitForStart resolves with the revision without starting (R-39)', async function() {
            await loadWith(editorSettings());
            storage.saveFlows = function(conf) { storage.conf = conf; return Promise.resolve("savedRev") };
            const rev = await flows.setFlows(clone(okConfig).concat([{id:"t1-9",z:"t1",type:"test",wires:[]}]), null, "full", false, false, null, {waitForStart:true});
            rev.should.equal("savedRev");
            flowCreate.called.should.be.false();
        });
        it('editorOnly: a non-boolean value is ignored with a warning', async function() {
            mockLog.warn.resetHistory();
            const result = await loadWith({editorOnly: "yes"});
            mockLog.warn.called.should.be.true();
            result.should.eql({errors:[]});
            flowCreate.called.should.be.true();
        });
    });
    describe('stop with the drain of the HTTP requests (#40)', function() {
        const httpDrain = NR_TEST_UTILS.require("@node-red/runtime/lib/httpDrain");
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        const EventEmitter = require("events");
        const okConfig = [
            {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
            {id:"t1",type:"tab"}
        ];
        let stubs;
        let calls;

        function loadAndStart(config) {
            storage.getFlows = function() {
                return Promise.resolve({flows:clone(config||okConfig), rev:"loadedRev"});
            }
            flows.init({log:mockLog, settings:{},storage:storage});
            return flows.load().then(function() {
                return flows.startFlows();
            });
        }
        // The drain enabled, its steps recorded; beforeStop waits for `gate` when given
        function enable(gate) {
            calls = [];
            stubs = [
                sinon.stub(httpDrain, "isEnabled").returns(true),
                sinon.stub(httpDrain, "beforeStop").callsFake(async function() { calls.push("beforeStop"); if (gate) { await gate } }),
                sinon.stub(httpDrain, "afterStop").callsFake(function(scope) { calls.push("afterStop:" + scope) })
            ];
        }
        function flush() {
            return new Promise(resolve => setImmediate(resolve));
        }
        async function settled(promise) {
            let done = false;
            promise.then(() => { done = true }, () => { done = true });
            await flush();
            return done;
        }
        function deferred() {
            let resolve;
            const promise = new Promise(r => { resolve = r });
            return { promise, resolve };
        }
        beforeEach(function() {
            stubs = [];
            instanceState.reset();
            instanceState.markStarting();
        });
        afterEach(async function() {
            stubs.forEach(stub => stub.restore());
            httpDrain.dispose();
            // a configuration without missing types: a type registered by later tests must not start these flows
            await flows.stopFlows();
            // A partial stop ("nodes", "flows") keeps the flow objects of the module (here the stubs of Flow.create)
            // and a stop of flows that are not started does not remove them: a later spec in the same process that
            // loads flows (the test helper of the nodes) would find them and fail with "getNode is not a function".
            // A full stop of started flows drops them
            await loadAndStart();
            await flows.stopFlows("full");
            storage.getFlows = function() { return Promise.resolve({flows:clone(okConfig), rev:"cleanRev"}) };
            await flows.load();
            instanceState.reset();
        });

        it('stopFlows of the nodes module is the wrapper that drains', async function() {
            RED.stopFlows.should.equal(flows.stopFlows);
            await loadAndStart();
            enable();
            await RED.stopFlows();
            calls.should.eql(["beforeStop", "afterStop:full"]);
        });
        it('waits for beforeStop, then stops the nodes, then calls afterStop', async function() {
            await loadAndStart();
            const gate = deferred();
            enable(gate.promise);
            const order = [];
            events.once("flows:stopping", () => { order.push("flows:stopping"); calls.push("stopNodes") });
            const promise = flows.stopFlows("full");
            await flush();
            calls.should.eql(["beforeStop"]);
            flowCreate.flows.t1.stop.called.should.be.false();
            flows.started.should.be.true();
            gate.resolve();
            await promise;
            calls.should.eql(["beforeStop", "stopNodes", "afterStop:full"]);
            flowCreate.flows.t1.stop.called.should.be.true();
            flows.started.should.be.false();
        });
        it('with the setting off nothing of the drain is called and the flows are stopped synchronously (off_identical)', async function() {
            await loadAndStart();
            const spies = ["beforeStop", "afterStop", "abortWait", "finalize"].map(name => sinon.spy(httpDrain, name));
            stubs = spies;
            httpDrain.isEnabled().should.be.false();
            const promise = flows.stopFlows();
            // as before: the nodes are stopped in the same tick
            flows.started.should.be.false();
            flowCreate.flows.t1.stop.calledOnce.should.be.true();
            await promise;
            spies.forEach(spy => spy.called.should.be.false());
            // a second stop is a no-op
            await flows.stopFlows();
        });
        it('with the setting off a rejected stop is passed on unchanged and the next one is a no-op', async function() {
            await loadAndStart();
            flowCreate.flows.t1.stop = sinon.spy(() => Promise.reject(new Error("close failed")));
            await flows.stopFlows().should.be.rejectedWith("close failed");
            await flows.stopFlows();
        });
        [
            ["no type", undefined, undefined, "full"],
            ["full", "full", undefined, "full"],
            ["nodes", "nodes", {added:[], changed:["t1-1"], removed:[], rewired:[], linked:[], flowChanged:[]}, "partial"],
            ["flows", "flows", {added:[], changed:[], removed:[], rewired:[], linked:[], flowChanged:["t1"]}, "partial"],
            ["nodes with a changed global configuration node", "nodes", {added:[], changed:[], removed:[], rewired:[], linked:[], flowChanged:[], globalConfigChanged:true}, "full"]
        ].forEach(function(entry) {
            it('afterStop gets the scope ' + entry[3] + ' for ' + entry[0], async function() {
                await loadAndStart();
                enable();
                await flows.stopFlows(entry[1], entry[2]);
                calls.should.eql(["beforeStop", "afterStop:" + entry[3]]);
            });
        });
        it('does nothing when the flows are not started', async function() {
            flows.init({log:mockLog, settings:{},storage:storage});
            enable();
            await flows.stopFlows();
            calls.should.eql([]);
        });
        it('a rejected stop of the nodes still calls afterStop and the next stop() does not fail (A3)', async function() {
            await loadAndStart();
            enable();
            flowCreate.flows.t1.stop = sinon.spy(() => Promise.reject(new Error("close failed")));
            const first = flows.stopFlows();
            const second = flows.stopFlows();
            await first.should.be.rejectedWith("close failed");
            // the second one waited for the first, then ran again: the flows are stopped, nothing to do
            await second;
            calls.should.eql(["beforeStop", "afterStop:full"]);
            // and the guard is cleared: a later stop() of started flows drains again
            await loadAndStart();
            await flows.stopFlows();
            calls.should.eql(["beforeStop", "afterStop:full", "beforeStop", "afterStop:full"]);
        });
        it('a stop that is called during the drain waits for it and drains once', async function() {
            await loadAndStart();
            const gate = deferred();
            enable(gate.promise);
            const first = flows.stopFlows();
            const second = flows.stopFlows();
            await flush();
            (await settled(second)).should.be.false();
            gate.resolve();
            await Promise.all([first, second]);
            calls.should.eql(["beforeStop", "afterStop:full"]);
            flowCreate.flows.t1.stop.calledOnce.should.be.true();
        });
        it('a node type registered while the flows are being stopped does not start the flows (A2, D4)', async function() {
            await loadAndStart([
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1-2",x:10,y:10,z:"t1",type:"missing",wires:[]},
                {id:"t1",type:"tab"}
            ]);
            flowCreate.called.should.be.false();
            const gate = deferred();
            enable(gate.promise);
            mockLog.debug.resetHistory();
            const promise = flows.stopFlows();
            await flush();
            events.emit("type-registered", "missing");
            await flush();
            flowCreate.called.should.be.false();
            mockLog.debug.called.should.be.true();
            gate.resolve();
            await promise;
            flowCreate.called.should.be.false();
        });
        it('a node type registered while no stop runs starts the flows (unchanged)', async function() {
            await loadAndStart([
                {id:"t1-1",x:10,y:10,z:"t1",type:"test",wires:[]},
                {id:"t1-2",x:10,y:10,z:"t1",type:"missing",wires:[]},
                {id:"t1",type:"tab"}
            ]);
            enable();
            events.emit("type-registered", "missing");
            await flush();
            flowCreate.called.should.be.true();
        });

        // #82 (S-5): removing or disabling node types is refused while a stop waits for the HTTP requests or
        // stops the nodes (the drain on); the existing errors come first
        describe('refusal of the removal and of the disabling during a drain stop (S-5, #82)', function() {
            const keyLog = Object.assign({}, mockLog, { _: function(key, params) { return params ? key + JSON.stringify(params) : key } });
            let extra;
            let removed;
            function onEvent(event) {
                if (event && event.id === "node/removed") { removed.push(event) }
            }
            function loadAndStartKeyLog() {
                storage.getFlows = function() {
                    return Promise.resolve({flows:clone(okConfig), rev:"loadedRev"});
                }
                flows.init({log:keyLog, settings:{},storage:storage});
                return flows.load().then(function() {
                    return flows.startFlows();
                });
            }
            function refusal(fn) {
                try {
                    fn();
                } catch (err) {
                    return err;
                }
                return null;
            }
            function assertRefused(err) {
                should.exist(err, 'checkTypeInUse did not throw');
                err.should.have.property('code', 'http_drain_in_progress');
                err.should.have.property('status', 409);
                // a constant text: no module name, no request data
                err.message.should.equal('nodes.index.drain-in-progress');
            }
            // Runs `fn` while a stop of the flows is in progress: "beforeStop" (waiting for the requests) or
            // "stopNow" (the nodes are being stopped). The stop is always released and awaited
            async function during(phase, fn) {
                await loadAndStartKeyLog();
                const gate = deferred();
                if (phase === "stopNow") {
                    flowCreate.flows.t1.stop = sinon.spy(() => gate.promise);
                    enable();
                } else {
                    enable(gate.promise);
                }
                const promise = flows.stopFlows();
                try {
                    await flush();
                    if (phase === "stopNow") {
                        flowCreate.flows.t1.stop.called.should.be.true();
                    }
                    await fn();
                } finally {
                    gate.resolve();
                    await promise;
                }
            }
            beforeEach(function() {
                removed = [];
                events.on("runtime-event", onEvent);
                extra = [
                    sinon.stub(typeRegistry, "getNodeInfo").callsFake(function(id) {
                        if (/^missing\//.test(id)) { return null }
                        if (/^used\//.test(id)) { return {types:['test']} }
                        return {types:['unused-type']};
                    }),
                    sinon.stub(typeRegistry, "getModuleInfo").callsFake(function(id) {
                        return id === "m" ? {name:"m", user:true, nodes:[{name:"n"}]} : null;
                    }),
                    sinon.stub(typeRegistry, "uninstallModule").callsFake(function() { return Promise.resolve([{id:"m/n"}]) }),
                    sinon.stub(typeRegistry, "disableNode").callsFake(function() { return Promise.resolve({id:"m/n", enabled:false, types:[]}) })
                ];
            });
            afterEach(function() {
                events.removeListener("runtime-event", onEvent);
                extra.forEach(stub => stub.restore());
            });

            ["beforeStop", "stopNow"].forEach(function(phase) {
                it('AC-70: during ' + phase + ' checkTypeInUse refuses with 409 http_drain_in_progress and a constant message; after the stop it does not', async function() {
                    await during(phase, async function() {
                        assertRefused(refusal(() => flows.checkTypeInUse('some/module')));
                    });
                    should.not.exist(refusal(() => flows.checkTypeInUse('some/module')));
                });
                it('AC-70: during ' + phase + ' the removal of a module is refused: it stays installed and no node/removed event is sent', async function() {
                    await during(phase, async function() {
                        assertRefused(refusal(() => RED.uninstallModule('m')));
                        typeRegistry.uninstallModule.called.should.be.false();
                        removed.should.eql([]);
                    });
                    await RED.uninstallModule('m');
                    typeRegistry.uninstallModule.calledOnce.should.be.true();
                    removed.should.have.length(1);
                });
                it('AC-71: during ' + phase + ' disabling a node set or a module is refused: nothing is disabled', async function() {
                    await during(phase, async function() {
                        assertRefused(refusal(() => RED.disableNode('m/n')));
                        typeRegistry.disableNode.called.should.be.false();
                    });
                });
            });
            it('AC-72: an unknown module and a type that the configuration uses keep their own errors during the drain', async function() {
                await during("beforeStop", async function() {
                    const unknown = refusal(() => flows.checkTypeInUse('missing/n'));
                    should.exist(unknown);
                    should.not.exist(unknown.code);
                    unknown.message.should.match(/unrecognised-id/);
                    const used = refusal(() => flows.checkTypeInUse('used/n'));
                    should.exist(used);
                    used.should.have.property('code', 'type_in_use');
                    should.not.exist(used.status);
                });
            });
            it('AC-73: after the stop (also while the new nodes start) the check passes as before', async function() {
                await loadAndStartKeyLog();
                enable();
                await flows.stopFlows();
                should.not.exist(refusal(() => flows.checkTypeInUse('some/module')));
                (refusal(() => flows.checkTypeInUse('used/n')) || {}).should.have.property('code', 'type_in_use');
            });
            it('AC-74: with the drain off the check is as before, also while the nodes are being stopped', async function() {
                await loadAndStartKeyLog();
                httpDrain.isEnabled().should.be.false();
                const stopGate = deferred();
                flowCreate.flows.t1.stop = sinon.spy(() => stopGate.promise);
                const promise = flows.stopFlows();
                try {
                    should.not.exist(refusal(() => flows.checkTypeInUse('some/module')));
                    (refusal(() => flows.checkTypeInUse('used/n')) || {}).should.have.property('code', 'type_in_use');
                } finally {
                    stopGate.resolve();
                    await promise;
                }
            });
            it('AC-75: the message does not contain the module name, whatever it is', async function() {
                await during("beforeStop", async function() {
                    ['<script>alert(1)</script>', 'x'.repeat(10000)].forEach(function(name) {
                        const err = refusal(() => flows.checkTypeInUse(name));
                        assertRefused(err);
                        err.message.length.should.be.below(100);
                        err.message.should.not.match(/script|xxx/);
                        JSON.stringify(err).should.not.match(/script|xxx/);
                    });
                });
            });
        });

        describe('with the real drain', function() {
            function fakeRequest() {
                const req = new EventEmitter();
                req.method = "POST";
                req.complete = true;
                req.route = { stack: [{ handle: Object.assign(function() {}, { [httpDrain.S]: true }) }] };
                const res = new EventEmitter();
                const headers = {};
                Object.assign(res, { statusCode: 200, headersSent: false, writableEnded: false, destroyed: false, ends: 0 });
                res.getHeaderNames = () => Object.keys(headers);
                res.setHeader = (name, value) => { headers[name.toLowerCase()] = value };
                res.removeHeader = name => { delete headers[name.toLowerCase()] };
                res.end = function(body) {
                    this.ends++;
                    if (this.fail) { throw new Error("cannot write") }
                    this.body = body;
                    this.writableEnded = true;
                    this.emit("finish");
                };
                httpDrain.middleware(req, res, function() {});
                return { req, res };
            }
            beforeEach(function() {
                httpDrain.init({ deploy: { drainHttpNodeRequests: { enabled: true, timeout: 20000 } } });
            });

            it('an error while answering one request does not stop the others and stop() resolves (test 5)', async function() {
                await loadAndStart();
                const bad = fakeRequest();
                bad.res.fail = true;
                const good = fakeRequest();
                await flows.stopFlows();
                good.res.statusCode.should.equal(503);
                good.res.writableEnded.should.be.true();
                flowCreate.flows.t1.stop.calledOnce.should.be.true();
                flows.started.should.be.false();
            });
            it('waits for an accepted request, which the flow answers (the nodes stop afterwards)', async function() {
                await loadAndStart();
                const request = fakeRequest();
                request.req[httpDrain.S].accepted = true;
                const promise = flows.stopFlows();
                await flush();
                flowCreate.flows.t1.stop.called.should.be.false();
                request.res.end("answered by the flow");
                await promise;
                request.res.body.should.equal("answered by the flow");
                request.res.ends.should.equal(1);
                flowCreate.flows.t1.stop.called.should.be.true();
            });
            it('RED.stop in the middle of the drain: markStopping does not end the wait, the second stop() does (D5)', async function() {
                await loadAndStart();
                instanceState.markStarting();
                instanceState.report({ errors: [] });
                const token = instanceState.begin("deploy");
                const request = fakeRequest();
                request.req[httpDrain.S].accepted = true;
                const first = flows.stopFlows("nodes", {added:[], changed:["t1-1"], removed:[], rewired:[], linked:[], flowChanged:[]});
                await flush();
                instanceState.markStopping("SIGTERM");
                (await settled(first)).should.be.false();
                request.res.writableEnded.should.be.false();
                // runtime.stop() -> stopFlows() in the state stopping: ends the wait of the first stop
                const second = flows.stopFlows();
                await first;
                await second;
                flowCreate.flows.t1.stop.called.should.be.true();
                // afterStop of the partial stop leaves the request; finalize (RED.stop) answers it
                httpDrain.finalize();
                request.res.statusCode.should.equal(503);
                instanceState.end(token, { errors: [] });
            });
        });
    });
    // #84 (S-4, S-6, S-7, D3, D4, D5, D6): the start guard and the complete stop of the flows module, with the fake flows
    describe('stopping instance: the start guard and the complete stop (#84)', function() {
        // the limit of a hang, not of the speed of the machine: nothing in this block waits for a stretch of time
        this.timeout(SUITE_TIMEOUT * 3); // a test can wait (bounded) several times: the guard is larger than their sum
        const instanceState = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
        const httpDrain = NR_TEST_UTILS.require("@node-red/runtime/lib/httpDrain");
        const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");
        const SKIPPED = "nodes.flows.start-skipped-stopping";
        const CONFIG = [
            {id:"A",type:"tab"}, {id:"a1",type:"test",z:"A",wires:[]},
            {id:"B",type:"tab"}, {id:"b1",type:"test",z:"B",wires:[]}
        ];
        const CONFIG3 = CONFIG.concat([{id:"C",type:"tab"}, {id:"c1",type:"test",z:"C",wires:[]}]);
        const PARTIAL = {added:[],changed:["b1"],removed:[],rewired:[],linked:[],flowChanged:[]};
        let world;
        let keyLog;
        let settingsObject;
        let seen;
        let gates;
        let drainStubs;
        let listeners;
        // a fake clock for the production timers (the tests whose result depends on a time bound); restored after every test
        let clock = null;
        const defaultDependencies = async function(flow) {
            if (flow[0].id === "node-with-missing-modules") {
                throw new Error("Missing module");
            }
        };

        function listen(name, fn) {
            events.on(name, fn);
            listeners.push([name, fn]);
        }
        function gate() {
            const g = worldDeferred();
            gates.push(g);
            return g;
        }
        function infoCount(key) {
            return keyLog.info.args.filter(a => a[0] === key).length;
        }
        // the close of the node was requested (the gate of the node holds it)
        function closeRequested(id, what) {
            return until(() => world.closeCalls[id] === 1, what || ("the close of " + id + " was not requested"));
        }
        // the module initialised, the configuration loaded, the flows not started
        async function boot(settings, config) {
            // the stub of the outer beforeEach is replaced by the world's
            flowCreate.restore();
            world = createWorld(Flow, sinon);
            settingsObject = settings || {};
            storage.getFlows = function() {
                return Promise.resolve({flows:clone(config||CONFIG), rev:"loadedRev"});
            };
            flows.init({log:keyLog, settings:settingsObject, storage:storage});
            instanceState.reset();
            instanceState.markStarting();
            await flows.load();
            // load() emits runtime-event runtime-state while the state is still starting (loadStoredCredentials):
            // events from before the test's stop began are not what the assertions below are about
            seen.length = 0;
        }
        async function bootAndStart(settings, config) {
            await boot(settings, config);
            await flows.startFlows();
            // startFlows() resolved: its events were emitted before (synchronously), nothing is left to wait for
            seen.length = 0;
        }

        beforeEach(function() {
            keyLog = {
                log: sinon.stub(), debug: sinon.stub(), trace: sinon.stub(), warn: sinon.stub(), info: sinon.stub(), metric: sinon.stub(),
                _: function(key, params) { return params ? key + " " + JSON.stringify(params) : key }
            };
            seen = [];
            gates = [];
            drainStubs = [];
            listeners = [];
            ["flows:starting", "flows:started", "flows:stopping", "flows:stopped", "nodes-started", "nodes-stopped"].forEach(name => listen(name, () => seen.push(name)));
            listen("runtime-event", function(event) {
                if (event && event.id === "runtime-state") {
                    seen.push("runtime-state" + (event.payload && event.payload.state ? ":" + event.payload.state : ""));
                }
            });
        });
        afterEach(async function() {
            if (clock) {
                clock.restore();
                clock = null;
            }
            world.releaseAll();
            gates.forEach(g => g.resolve());
            await quiesce();
            world.closeFail = {};
            world.closeGate = {};
            drainStubs.forEach(stub => stub.restore());
            httpDrain.dispose();
            listeners.forEach(l => events.removeListener(l[0], l[1]));
            checkFlowDependencies.callsFake(defaultDependencies);
            instanceState.reset();
            // a configuration without missing types, started and stopped completely: the fakes of this test must
            // not stay in the module for the specs that run later
            delete settingsObject.safeMode;
            delete settingsObject.get;
            delete settingsObject.nodeCloseTimeout;
            storage.getFlows = function() { return Promise.resolve({flows:clone(CONFIG), rev:"cleanRev"}) };
            try {
                await flows.load();
                await flows.startFlows();
                await flows.stopFlows("full");
            } finally {
                world.restore();
            }
            await flows.load();
            instanceState.reset();
        });

        describe('D4, AC-18: a start in stopping and stopped', function() {
            function assertSkipped(result) {
                result.should.have.property("flowsRunning", false);
                result.should.have.property("reason", "stopping");
                result.errors.should.have.length(1);
                result.errors[0].should.have.property("code", "runtime_stopping");
                result.errors[0].should.have.property("message", SKIPPED);
            }
            function assertNothingStarted() {
                world.created.should.eql([]);
                world.starts.should.eql([]);
                flows.started.should.be.false();
                flows.state().should.equal("stop");
                seen.filter(e => e !== "flows:stopping" && e !== "flows:stopped").should.eql([]);
            }
            ["stopping", "stopped"].forEach(function(name) {
                it('AC-18: in ' + name + ' startFlows() returns the skipped result, creates no flow, emits nothing and logs once', async function() {
                    await boot();
                    instanceState.markStopping("SIGTERM");
                    if (name === "stopped") {
                        instanceState.markStopped();
                    }
                    const result = await flows.startFlows();
                    assertSkipped(result);
                    assertNothingStarted();
                    infoCount(SKIPPED).should.equal(1);
                    keyLog.warn.called.should.be.false();
                });
            });
            it('AC-18: a start with safe mode on returns the skipped result and emits no safe-mode or runtime-state event', async function() {
                await boot({safeMode: true});
                instanceState.markStopping("SIGTERM");
                assertSkipped(await flows.startFlows());
                assertNothingStarted();
                keyLog.info.args.map(a => a[0]).join("|").should.not.containEql("safe-mode");
            });
            it('AC-18: a start with runtimeFlowState stop returns the skipped result and emits no runtime-state event', async function() {
                await boot({get: function(prop) { return prop === "runtimeFlowState" ? "stop" : undefined }});
                instanceState.markStopping("SIGTERM");
                assertSkipped(await flows.startFlows());
                assertNothingStarted();
                keyLog.info.args.map(a => a[0]).join("|").should.not.containEql("stopped-flows");
            });
            it('AC-18: a start with missing types returns the skipped result and emits no missing-types event', async function() {
                await boot({}, [{id:"A",type:"tab"}, {id:"m1",type:"missing",z:"A",wires:[]}]);
                instanceState.markStopping("SIGTERM");
                assertSkipped(await flows.startFlows());
                assertNothingStarted();
                keyLog.info.args.map(a => a[0]).join("|").should.not.containEql("missing-types");
            });
            it('AC-18 (off): outside stopping the same starts do what they did (the skipped result is only for stopping)', async function() {
                await boot();
                const result = await flows.startFlows();
                result.should.eql({errors: []});
                world.created.should.not.eql([]);
                flows.started.should.be.true();
            });
            it('AC-27: a stub of isStopping() that returns true skips the start while the state text is starting', async function() {
                await boot();
                should(typeof instanceState.isStopping).equal("function", "state.isStopping is not exported");
                const stub = sinon.stub(instanceState, "isStopping").returns(true);
                try {
                    assertSkipped(await flows.startFlows());
                    instanceState.get().state.should.equal("starting");
                    assertNothingStarted();
                } finally {
                    stub.restore();
                }
            });
        });

        describe('D6, AC-17: a node type registered while the instance is stopping', function() {
            const MISSING = [{id:"A",type:"tab"}, {id:"m1",type:"missing",z:"A",wires:[]}];
            it('AC-17: the last missing type arrives in stopping: no start, no runtime-state event, one debug log', async function() {
                await boot({}, MISSING);
                const result = await flows.startFlows();
                result.errors[0].should.have.property("code", "missing_types");
                seen.length = 0;
                instanceState.markStopping("SIGTERM");
                events.emit("type-registered", "missing");
                // the late start decided to skip: the debug log is its end
                await until(() => keyLog.debug.args.filter(a => a[0] === SKIPPED).length === 1, "the late start did not log the skip");
                await quiesce();
                world.created.should.eql([]);
                seen.should.eql([]);
                keyLog.debug.args.filter(a => a[0] === SKIPPED).should.have.length(1);
                infoCount(SKIPPED).should.equal(0);
                flows.started.should.be.true();
            });
            it('AC-17 (off): without stopping the same registration starts the flows', async function() {
                await boot({}, MISSING);
                await flows.startFlows();
                seen.length = 0;
                events.emit("type-registered", "missing");
                await until(() => seen.indexOf("runtime-state") !== -1, "the late start did not finish");
                world.created.should.not.eql([]);
            });
            it('AC-27: a stub of isStopping() that returns true skips the late start', async function() {
                await boot({}, MISSING);
                await flows.startFlows();
                seen.length = 0;
                should(typeof instanceState.isStopping).equal("function", "state.isStopping is not exported");
                const stub = sinon.stub(instanceState, "isStopping").returns(true);
                try {
                    events.emit("type-registered", "missing");
                    // the late start decided to skip: the debug log is its end
                    await until(() => keyLog.debug.args.filter(a => a[0] === SKIPPED).length === 1, "the late start did not log the skip");
                    await quiesce();
                    world.created.should.eql([]);
                    seen.should.eql([]);
                } finally {
                    stub.restore();
                }
            });
        });

        describe('E13, AC-15: load(true) - the project switch and the reload', function() {
            it('AC-15: in stopping load(true) resolves with the revision and creates no flow', async function() {
                await boot();
                instanceState.markStopping("SIGTERM");
                const rev = await flows.load(true);
                rev.should.equal("loadedRev");
                world.created.should.eql([]);
                flows.started.should.be.false();
                flows.state().should.equal("stop");
            });
            it('AC-15 (off): outside stopping load(true) starts the flows', async function() {
                await boot();
                await flows.load(true);
                world.created.should.not.eql([]);
                flows.started.should.be.true();
            });
            it('AC-15: a project switch that races the stop leaves no flow running after the stop', async function() {
                await bootAndStart();
                const base = world.created.length;
                world.closeGate.b1 = worldDeferred();
                // what the project switch does under the lock: stop the flows, load the flows of the project and start them
                const switching = lock.runExclusive(async function() {
                    await flows.stopFlows();
                    await flows.load(true);
                });
                await closeRequested("b1", "the project switch did not begin to close b1");
                instanceState.markStopping("SIGTERM");
                // the call decided synchronously to wait for the stop in progress (the close of b1 is held by its gate)
                const stopped = flows.stopFlows();
                world.closeGate.b1.resolve();
                (await settle(stopped)).state.should.equal("resolved");
                (await settle(switching)).state.should.equal("resolved");
                await quiesce();
                world.created.length.should.equal(base, "the switched project was started in stopping");
                world.liveIds().should.eql([]);
                flows.started.should.be.false();
                flows.state().should.equal("stop");
            });
        });

        describe('D4, V9, AC-11: a start that waits for its modules', function() {
            it('AC-11: runtime stop resolves while the modules are pending; when they arrive no flow is created and started is false', async function() {
                await boot();
                const modules = gate();
                let waiting = false;
                checkFlowDependencies.callsFake(async function() { waiting = true; await modules.promise });
                const starting = flows.startFlows();
                await until(() => waiting, "the start did not wait for its modules");
                instanceState.markStopping("SIGTERM");
                const stopped = flows.stopFlows();
                // never for a module install
                (await settle(stopped)).state.should.equal("resolved");
                modules.resolve();
                await settle(starting);
                await quiesce();
                world.created.should.eql([], "Flow.create was called after the stop");
                seen.should.not.containEql("flows:started");
                seen.should.not.containEql("nodes-started");
                flows.started.should.be.false("started is true after the late checkpoint");
                flows.state().should.equal("stop");
            });
        });

        describe('D4, V10, AC-12: a start that waits for a flow', function() {
            it('AC-12: runtime stop does not resolve before the flow that is starting; no further flow is started; every created flow is stopped', async function() {
                // the bound of the wait for the flow that is starting (the default nodeCloseTimeout, 15000) is the fake clock
                clock = fakeClock(sinon);
                await boot({}, CONFIG3);
                world.firstStartGate = worldDeferred();
                const starting = flows.startFlows();
                await until(() => world.starts.length === 1, "the start did not begin the first flow");
                world.starts.should.eql(["global"]);
                instanceState.markStopping("SIGTERM");
                const armedBefore = clock.countTimers();
                const stopped = flows.stopFlows();
                const ended = watch(stopped);
                await timerArmed(clock, armedBefore, "the stop did not wait for the flow that is starting");
                // the stop waits for the flow until its bound: one ms before it, it still waits
                await clock.tickAsync(14999);
                await quiesce();
                ended.done.should.be.false("the stop did not wait for the flow that is starting");
                world.starts.should.eql(["global"]);
                world.firstStartGate.resolve();
                (await settle(stopped)).state.should.equal("resolved");
                await settle(starting);
                await quiesce();
                world.starts.should.eql(["global"], "a further flow was started in stopping");
                world.created.length.should.be.above(0);
                world.liveIds().should.eql([]);
                flows.started.should.be.false("started is true after the late checkpoint");
                flows.state().should.equal("stop");
            });
        });

        describe('N-1, H7, AC-26: a start that never ends', function() {
            it('AC-26: with nodeCloseTimeout 200 the stop resolves after about 200 ms, one warning names the flow, the flow is stopped, no further flow is started', async function() {
                await boot({nodeCloseTimeout: 200}, CONFIG3);
                world.startHangs.global = true;
                const starting = flows.startFlows();
                await until(() => world.starts.length === 1, "the start did not begin the first flow");
                world.starts.should.eql(["global"]);
                instanceState.markStopping("SIGTERM");
                // the bound (nodeCloseTimeout 200) is the fake clock: the stop waits for it (NB-4: a lower bound; no upper
                // bound of the wall clock is a behaviour of the stop)
                clock = fakeClock(sinon);
                const stopped = flows.stopFlows();
                let resolved = false;
                stopped.then(() => { resolved = true }, () => { resolved = true });
                await quiesce();
                resolved.should.be.false("the stop did not wait for the flow that is starting");
                clock.tick(199);
                await quiesce();
                resolved.should.be.false("the stop did not wait for the bound");
                clock.tick(1);
                const outcome = await settle(stopped);
                outcome.state.should.equal("resolved");
                clock.restore();
                clock = null;
                const warnings = keyLog.warn.args.filter(a => /nodes\.flows\.start-wait-timeout/.test(a[0]));
                warnings.should.have.length(1);
                warnings[0][0].should.containEql("global");
                world.stopCalls.map(c => c.flow).should.containEql("global");
                world.starts.should.eql(["global"]);
                world.liveIds().should.eql([]);
                world.releaseAll();
                await settle(starting);
                await quiesce();
                world.starts.should.eql(["global"], "a further flow was started after the bound");
                flows.started.should.be.false();
            });
        });

        describe('D5, S-6: the stop in stopping', function() {
            it('AC-19: waits for a stop in progress (drain off) and resolves after the nodes closed', async function() {
                await bootAndStart();
                world.closeGate.b1 = worldDeferred();
                clock = fakeClock(sinon);
                const first = flows.stopFlows();
                await closeRequested("b1", "the first stop did not begin to close b1");
                instanceState.markStopping("SIGTERM");
                const second = flows.stopFlows();
                // the second stop waits for the stop in progress, whatever the bounds of the production code are
                const ended = watch(second);
                await pastAllBounds(clock);
                ended.done.should.be.false("the stop did not wait for the stop in progress");
                world.closeGate.b1.resolve();
                (await settle(second)).state.should.equal("resolved");
                world.closed.should.containEql("b1");
                await first;
                world.closedTwice().should.eql([]);
                world.liveIds().should.eql([]);
            });
            it('S-6: stops every flow that exists, also when started is false (a partial stop left flow A)', async function() {
                await bootAndStart();
                await flows.stopFlows("nodes", PARTIAL);
                flows.started.should.be.false();
                world.live().map(f => f.id).should.containEql("A");
                instanceState.markStopping("SIGTERM");
                await flows.stopFlows();
                world.liveIds().should.eql([]);
                (world.closeCalls.a1 || 0).should.equal(1);
                (world.closeCalls.b1 || 0).should.equal(1);
                flows.started.should.be.false();
                flows.state().should.equal("stop");
            });
            it('S-6 (drain on): a partial stop left flow A: the stop in stopping stops it too', async function() {
                await bootAndStart();
                drainStubs.push(
                    sinon.stub(httpDrain, "isEnabled").returns(true),
                    sinon.stub(httpDrain, "beforeStop").callsFake(async function() {}),
                    sinon.stub(httpDrain, "afterStop").callsFake(function() {})
                );
                await flows.stopFlows("nodes", PARTIAL);
                flows.started.should.be.false();
                instanceState.markStopping("SIGTERM");
                await flows.stopFlows();
                world.liveIds().should.eql([]);
                (world.closeCalls.a1 || 0).should.equal(1);
            });
            it('S-6 (drain on): waits for the stop in progress (stopInProgress) and for its nodes', async function() {
                await bootAndStart();
                const requests = gate();
                let waitingForRequests = false;
                drainStubs.push(
                    sinon.stub(httpDrain, "isEnabled").returns(true),
                    sinon.stub(httpDrain, "beforeStop").callsFake(async function() { waitingForRequests = true; await requests.promise }),
                    sinon.stub(httpDrain, "afterStop").callsFake(function() {}),
                    sinon.stub(httpDrain, "abortWait").callsFake(function() { requests.resolve() })
                );
                world.closeGate.b1 = worldDeferred();
                clock = fakeClock(sinon);
                const first = flows.stopFlows();
                await until(() => waitingForRequests, "the first stop did not wait for the requests");
                instanceState.markStopping("SIGTERM");
                const second = flows.stopFlows();
                // the wait for the requests ends with the stop of RED.stop; the nodes are closing
                await closeRequested("b1", "the end of the wait for the requests did not let the stop close b1");
                // the second stop waits for the nodes that are closing, whatever the bounds of the production code are
                const ended = watch(second);
                await pastAllBounds(clock);
                ended.done.should.be.false("the second stop did not wait for the nodes that are closing");
                world.closeGate.b1.resolve();
                (await settle(second)).state.should.equal("resolved");
                await settle(first);
                world.closedTwice().should.eql([]);
                world.liveIds().should.eql([]);
            });
            it('I-4: it never takes the deploy lock: a held lock does not delay the stop', async function() {
                await bootAndStart();
                const held = gate();
                const holding = lock.runExclusive(() => held.promise);
                instanceState.markStopping("SIGTERM");
                (await settle(flows.stopFlows())).state.should.equal("resolved");
                world.liveIds().should.eql([]);
                held.resolve();
                await holding;
            });
            it('S-6: a rejection of the stop that was waited for is not passed on', async function() {
                await bootAndStart();
                world.closeGate.b1 = worldDeferred();
                world.closeFail.b1 = new Error("close failed");
                const first = flows.stopFlows();
                first.catch(() => {});
                await closeRequested("b1", "the first stop did not begin to close b1");
                instanceState.markStopping("SIGTERM");
                const second = flows.stopFlows();
                world.closeGate.b1.resolve();
                (await settle(second)).state.should.equal("resolved");
                (await settle(first)).state.should.equal("rejected");
            });
            it('AC-27: a stub of isStopping() that returns true makes the stop wait for the stop in progress', async function() {
                await bootAndStart();
                world.closeGate.b1 = worldDeferred();
                clock = fakeClock(sinon);
                const first = flows.stopFlows();
                await closeRequested("b1", "the first stop did not begin to close b1");
                should(typeof instanceState.isStopping).equal("function", "state.isStopping is not exported");
                const stub = sinon.stub(instanceState, "isStopping").returns(true);
                try {
                    const second = flows.stopFlows();
                    // the second stop waits for the stop in progress, whatever the bounds of the production code are
                    const ended = watch(second);
                    await pastAllBounds(clock);
                    ended.done.should.be.false("the stop did not react to isStopping()");
                    world.closeGate.b1.resolve();
                    (await settle(second)).state.should.equal("resolved");
                } finally {
                    stub.restore();
                }
                await first;
            });
        });

        describe('AC-22, AC-23: outside stopping nothing changes (guards: pass before and after the change)', function() {
            it('AC-22: with the drain off stopFlows() sets started to false synchronously, before the nodes closed', async function() {
                await bootAndStart();
                world.closeGate.b1 = worldDeferred();
                const stopping = flows.stopFlows();
                flows.started.should.be.false();
                flows.state().should.equal("stop");
                world.closeGate.b1.resolve();
                await stopping;
            });
            it('AC-22: a second stop outside stopping does not wait for the first (drain off)', async function() {
                await bootAndStart();
                world.closeGate.b1 = worldDeferred();
                const first = flows.stopFlows();
                (await settle(flows.stopFlows())).state.should.equal("resolved");
                world.closeGate.b1.resolve();
                await first;
            });
            describe('B1: checkTypeInUse with the drain off', function() {
                let extra;
                beforeEach(function() {
                    extra = sinon.stub(typeRegistry, "getNodeInfo").callsFake(function() { return {types:['unused-type']} });
                });
                afterEach(function() {
                    extra.restore();
                });
                it('AC-22: during the stop of a deployment (drain off) the removal of a module is not refused', async function() {
                    await bootAndStart();
                    world.closeGate.b1 = worldDeferred();
                    const deployment = flows.setFlows(clone(CONFIG).map(n => n.id === "b1" ? Object.assign({}, n, {v: 2}) : n), null, "full", false, false, null, undefined);
                    await closeRequested("b1", "the deployment did not begin to close b1");
                    should.doesNotThrow(() => flows.checkTypeInUse("m/n"));
                    world.closeGate.b1.resolve();
                    await deployment;
                });
                it('AC-22: in stopping, while the nodes are being stopped (drain off), checkTypeInUse does not throw http_drain_in_progress', async function() {
                    await bootAndStart();
                    world.closeGate.b1 = worldDeferred();
                    const first = flows.stopFlows();
                    await closeRequested("b1", "the first stop did not begin to close b1");
                    instanceState.markStopping("SIGTERM");
                    const second = flows.stopFlows();
                    should.doesNotThrow(() => flows.checkTypeInUse("m/n"));
                    world.closeGate.b1.resolve();
                    await settle(second);
                    await first;
                });
            });
        });
    });
    describe('#updateFlow', function() {
        it.skip("updateFlow");
    })
    describe('#removeFlow', function() {
        it.skip("removeFlow");
    })
    describe('#disableFlow', function() {
        it.skip("disableFlow");
    })
    describe('#enableFlow', function() {
        it.skip("enableFlow");
    })
});
