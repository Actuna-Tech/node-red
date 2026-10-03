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
 *   E-01: tests of the project switch under the shared deploy lock
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var sinon = require("sinon");

var NR_TEST_UTILS = require("nr-test-utils");
var gitTools = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/projects/git");
var util = NR_TEST_UTILS.require("@node-red/util");

describe("storage/localfilesystem/projects/git/index", function() {
    afterEach(function() {
        sinon.restore();
    });

    it("allows git index stage selectors when reading conflicted files", async function() {
        var runStub = sinon.stub(util.exec, "run").resolves({ stdout: "content" });

        var content = await gitTools.getFile("/tmp/project", "flows.json", ":1");

        content.should.equal("content");
        runStub.calledOnce.should.be.true();
        runStub.firstCall.args[0].should.equal("git");
        runStub.firstCall.args[1].should.containEql("show");
        runStub.firstCall.args[1].should.containEql(":1:flows.json");
    });

    it("continues to reject invalid treeish values when reading files", async function() {
        (function() {
            gitTools.getFile("/tmp/project", "flows.json", "--upload-pack=evil");
        }).should.throw(/treeish is not a valid git revision/);
    });

    it("allows limited revision expressions when reading files", async function() {
        var runStub = sinon.stub(util.exec, "run").resolves({ stdout: "content" });

        var content = await gitTools.getFile("/tmp/project", "flows.json", "abc123~1");

        content.should.equal("content");
        runStub.calledOnce.should.be.true();
        runStub.firstCall.args[1].should.containEql("show");
        runStub.firstCall.args[1].should.containEql("abc123~1:flows.json");
    });

    it("allows limited revision expressions for commit history pagination", async function() {
        var runStub = sinon.stub(util.exec, "run");
        runStub.onFirstCall().resolves({ stdout: "10" });
        runStub.onSecondCall().resolves({ stdout: "" });

        var result = await gitTools.getCommits("/tmp/project", { before: "abc123~1", limit: 20 });

        result.should.have.property("before", "abc123~1");
        runStub.secondCall.args[1].should.containEql("abc123~1");
    });
});

describe("storage/localfilesystem/projects - deploy lock (E-01)", function() {
    const os = require("os");
    const projects = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/projects");
    const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");
    let order;
    let runtime;

    beforeEach(async function() {
        order = [];
        runtime = {
            nodes: {
                stopFlows: sinon.spy(async function() { order.push("stopFlows") }),
                clearContext: sinon.spy(async function() { order.push("clearContext") }),
                loadFlows: sinon.spy(async function() { order.push("loadFlows") })
            }
        };
        await projects.init({
            userDir: os.tmpdir(),
            flowFile: "e01-test-flows.json",
            editorTheme: { projects: { enabled: false } }
        }, runtime);
        sinon.stub(console, "log");
    });
    afterEach(function() {
        sinon.restore();
    });

    it("project switch waits for running deploy (R-11)", async function() {
        let release;
        const deploy = lock.runExclusive(function() {
            order.push("deploy:start");
            return new Promise(resolve => { release = () => { order.push("deploy:end"); resolve() } });
        });
        // No active project in this test: the project-update event fails after loading,
        // which does not matter here
        const reload = projects._reloadActiveProject("loaded", true).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 10));
        order.should.eql(["deploy:start"]);
        release();
        await deploy;
        await reload;
        order.should.eql(["deploy:start", "deploy:end", "stopFlows", "clearContext", "loadFlows"]);
        // Internal call: no deployOpts
        runtime.nodes.loadFlows.firstCall.args.should.eql([true]);
    });
    it("a deploy waits for a running project switch", async function() {
        let releaseLoad;
        runtime.nodes.loadFlows = sinon.spy(function() {
            order.push("loadFlows:start");
            return new Promise(resolve => { releaseLoad = () => { order.push("loadFlows:end"); resolve() } });
        });
        const reload = projects._reloadActiveProject("loaded").catch(() => {});
        const deploy = lock.runExclusive(async function() { order.push("deploy") });
        await new Promise(resolve => setTimeout(resolve, 10));
        order.should.eql(["stopFlows", "loadFlows:start"]);
        releaseLoad();
        await reload;
        await deploy;
        order.should.eql(["stopFlows", "loadFlows:start", "loadFlows:end", "deploy"]);
    });
    it("releases the lock when the project switch fails", async function() {
        runtime.nodes.stopFlows = sinon.spy(async function() { throw new Error("stop failed") });
        await projects._reloadActiveProject("loaded").should.be.rejectedWith("stop failed");
        lock.isLocked().should.be.false();
    });
});
