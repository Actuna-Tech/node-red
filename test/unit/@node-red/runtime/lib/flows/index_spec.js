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
