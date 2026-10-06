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
 *   E-02: RED.stop(reason) passes the reason to the runtime (R-23)
 *   Z-08: RED.health
 *   #67: a rejected RED.start() does not end the process in the embedded mode
 * This notice is required by section 4(b) of the Apache License 2.0.
 */
var should = require("should");
var sinon = require("sinon");
var fs = require("fs");
var path = require("path");


var NR_TEST_UTILS = require("nr-test-utils");

var api = NR_TEST_UTILS.require("@node-red/runtime/lib/api");

var RED = NR_TEST_UTILS.require("node-red");

var runtime = NR_TEST_UTILS.require("@node-red/runtime");
var api = NR_TEST_UTILS.require("@node-red/runtime/lib/api");


describe("red/red", function() {

    // describe("check build", function() {
    //     beforeEach(function() {
    //         sinon.stub(runtime,"init").callsFake(function() {});
    //         sinon.stub(api,"init").callsFake(function() {});
    //         // sinon.stub(RED,"version").callsFake(function() { return "version";});
    //     });
    //     afterEach(function() {
    //         runtime.init.restore();
    //         api.init.restore();
    //         fs.statSync.restore();
    //         // RED.version.restore();
    //     });
    //     it.skip('warns if build has not been run',function() {
    //         sinon.stub(fs,"statSync").callsFake(function() { throw new Error();});
    //
    //         /*jshint immed: false */
    //         (function() {
    //             RED.init({},{});
    //         }).should.throw("Node-RED not built");
    //     });
    //     it('passed if build has been run',function() {
    //         sinon.stub(fs,"statSync").callsFake(function() { });
    //         RED.init({},{});
    //     });
    // });

    describe("externals", function() {
        it('reports version', function() {
            /\d+\.\d+\.\d+(-git)?/.test(RED.version()).should.be.true();
        });
        it.skip('access server externals', function() {
            // TODO: unstubable accessors - need to make this testable
            // RED.app;
            // RED.httpAdmin;
            // RED.httpNode;
            // RED.server;
        });
        it.skip('only initialises api component if httpAdmin enabled');
        it.skip('stubs httpAdmin if httpAdmin disabled');
        it.skip('stubs httpNode if httpNode disabled');
    });

    describe("health (Z-08)", function() {
        const health = NR_TEST_UTILS.require("@node-red/runtime/lib/health");
        afterEach(function() {
            sinon.restore();
            health.init({});
            NR_TEST_UTILS.require("@node-red/runtime/lib/state").reset();
        });
        it('exposes the health settings and handler', function() {
            health.init({ health: { enabled: true, path: "/probe" }, uiPort: 1880 });
            RED.health.enabled.should.be.true();
            RED.health.path.should.equal("/probe");
            RED.health.usesMainServer.should.be.true();
            RED.health.handler.should.equal(health.handler);
            RED.health.closeServer.should.equal(health.closeServer);
        });
        it('shutdown stops through RED.stop with the reason', async function() {
            health.init({});
            const stop = sinon.stub(runtime, "stop").resolves();
            await RED.health.shutdown({ reason: "SIGTERM", signal: "SIGTERM" });
            stop.firstCall.args.should.eql(["SIGTERM"]);
        });
    });

    describe("stop (E-02)", function() {
        afterEach(function() {
            sinon.restore();
        });
        it('passes the reason to runtime.stop (R-23)', async function() {
            const stop = sinon.stub(runtime, "stop").resolves();
            await RED.stop("SIGTERM");
            stop.calledOnce.should.be.true();
            stop.firstCall.args.should.eql(["SIGTERM"]);
        });
        it('calls runtime.stop without a reason as before', async function() {
            const stop = sinon.stub(runtime, "stop").resolves();
            await RED.stop();
            stop.firstCall.args.should.eql([undefined]);
        });
    });

    describe("start (#67)", function() {
        afterEach(function() {
            sinon.restore();
        });
        it('AC-13: a rejected runtime start rejects RED.start() with the same error and does not call process.exit', async function() {
            const failure = new Error("runtime start failed on purpose");
            sinon.stub(runtime, "start").rejects(failure);
            const exit = sinon.stub(process, "exit");
            let caught;
            try {
                await RED.start();
            } catch (err) {
                caught = err;
            }
            exit.called.should.be.false();
            should.exist(caught);
            caught.should.equal(failure);
        });
    });

});
