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
 *   E-01: project operations that change the flow files run with the reload under the lock (R-11)
 *   E-01: commit checks the merge state under the lock; getProject and a project created
 *   from the existing flow files under the lock; tests wait for the lock to be released
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var sinon = require("sinon");

var NR_TEST_UTILS = require("nr-test-utils");
var gitTools = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/projects/git");
var util = NR_TEST_UTILS.require("@node-red/util");

/**
 * Waits until the shared deploy lock is free, so a section left by a test
 * cannot run into the next test; fails if it is still held after 2 s.
 */
function waitForDeployLockRelease(lock) {
    let timer;
    return Promise.race([
        lock.runExclusive(async function() {}),
        new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error("the deploy lock is still held after the test")), 2000);
        })
    ]).finally(() => clearTimeout(timer));
}

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
    afterEach(async function() {
        sinon.restore();
        await waitForDeployLockRelease(lock);
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

describe("storage/localfilesystem/projects - operations under the deploy lock (E-01)", function() {
    const os = require("os");
    const projects = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/projects");
    const Project = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/projects/Project");
    const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");
    let order;
    let runtime;
    let project;
    let pending;

    // A project operation that records whether it runs under the lock and
    // can be held open by the test
    function operation(name, result) {
        return sinon.spy(function() {
            order.push(name + (lock.isLocked() ? ":locked" : ":unlocked"));
            if (pending && pending.name === name) {
                return new Promise(resolve => { pending.release = () => { order.push(name + ":end"); resolve(result) } });
            }
            return Promise.resolve(result);
        });
    }
    function wait() {
        return new Promise(resolve => setTimeout(resolve, 10));
    }

    beforeEach(async function() {
        order = [];
        pending = null;
        runtime = {
            nodes: {
                stopFlows: sinon.spy(async function() { order.push("stopFlows") }),
                clearContext: sinon.spy(async function() { order.push("clearContext") }),
                loadFlows: sinon.spy(async function() { order.push("loadFlows") }),
                setCredentialSecret: sinon.spy(),
                clearCredentials: sinon.spy(),
                exportCredentials: sinon.spy(async function() { return {} })
            },
            storage: {
                saveCredentials: sinon.spy(async function() {})
            }
        };
        let projectSettings = {};
        // Projects enabled without git, ssh and file system access (readOnly)
        sinon.stub(gitTools, "init").resolves({ version: "2.40.0" });
        sinon.stub(NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/projects/ssh"), "init").resolves();
        sinon.stub(Project, "init");
        await projects.init({
            userDir: os.tmpdir(),
            readOnly: true,
            flowFile: "e01-test-flows.json",
            editorTheme: { projects: { enabled: true } },
            get: function(key) { return projectSettings[key] },
            set: async function(key, value) { projectSettings[key] = value }
        }, runtime);
        project = {
            name: "p1",
            credentialSecretInvalid: false,
            merging: false,
            isMerging: function() { return project.merging },
            getFlowFile: () => "flows.json",
            getFlowFileBackup: () => ".flows.json.backup",
            getCredentialsFile: () => "flows_cred.json",
            getCredentialsFileBackup: () => ".flows_cred.json.backup",
            setBranch: operation("setBranch"),
            pull: operation("pull"),
            revertFile: operation("revertFile"),
            abortMerge: operation("abortMerge"),
            resolveMerge: operation("resolveMerge"),
            commit: sinon.spy(function() {
                order.push("commit" + (lock.isLocked() ? ":locked" : ":unlocked"));
                project.merging = false;
                return Promise.resolve();
            }),
            update: operation("update", { flowFilesChanged: true }),
            initialise: operation("initialise")
        };
        sinon.stub(Project, "load").callsFake(async function() {
            order.push("load" + (lock.isLocked() ? ":locked" : ":unlocked"));
            return project;
        });
        sinon.stub(console, "log");
        await projects.setActiveProject(null, "p1");
        order = [];
    });
    afterEach(async function() {
        sinon.restore();
        await waitForDeployLockRelease(lock);
    });

    it("a deploy waits for a running branch change and its reload", async function() {
        pending = { name: "setBranch" };
        const change = projects.setBranch(null, "p1", "dev", false);
        const deploy = lock.runExclusive(async function() { order.push("deploy") });
        await wait();
        order.should.eql(["setBranch:locked"]);
        pending.release();
        await change;
        await deploy;
        order.should.eql(["setBranch:locked", "setBranch:end", "stopFlows", "loadFlows", "deploy"]);
        // Internal call: no deployOpts
        runtime.nodes.loadFlows.firstCall.args.should.eql([true]);
    });
    it("a branch change waits for a running deploy", async function() {
        let release;
        const deploy = lock.runExclusive(function() {
            order.push("deploy:start");
            return new Promise(resolve => { release = () => { order.push("deploy:end"); resolve() } });
        });
        const change = projects.setBranch(null, "p1", "dev", false);
        await wait();
        order.should.eql(["deploy:start"]);
        release();
        await deploy;
        await change;
        order.should.eql(["deploy:start", "deploy:end", "setBranch:locked", "stopFlows", "loadFlows"]);
    });
    [
        ["pull", () => projects.pull(null, "p1", "origin/main", false, false), true],
        ["revertFile", () => projects.revertFile(null, "p1", "flows.json"), true],
        ["abortMerge", () => projects.abortMerge(null, "p1"), true],
        ["resolveMerge", () => projects.resolveMerge(null, "p1", "flows.json", "ours"), false],
        ["update", () => projects.updateProject(null, "p1", {}), true],
        ["initialise", () => projects.initialiseProject(null, "p1", {}), true]
    ].forEach(function([name, run, reloads]) {
        it(name + " runs under the lock" + (reloads ? " with the reload" : "") + " and waits for a deploy", async function() {
            pending = { name: name };
            const change = run();
            const deploy = lock.runExclusive(async function() { order.push("deploy") });
            await wait();
            order.should.eql([name + ":locked"]);
            pending.release();
            await change;
            await deploy;
            const expected = [name + ":locked", name + ":end"];
            if (reloads) {
                expected.push("stopFlows", "loadFlows");
            }
            expected.push("deploy");
            order.should.eql(expected);
        });
    });
    it("a credential secret change of the project runs under the lock with the reload", async function() {
        project.credentialSecretInvalid = true;
        project.update = operation("update", { credentialSecretChanged: true });
        pending = { name: "update" };
        const change = projects.updateProject(null, "p1", { resetCredentialSecret: true });
        const deploy = lock.runExclusive(async function() { order.push("deploy") });
        await wait();
        pending.release();
        await change;
        await deploy;
        order.should.eql(["update:locked", "update:end", "stopFlows", "loadFlows", "deploy"]);
        runtime.storage.saveCredentials.calledOnce.should.be.true();
    });
    it("a commit that completes a merge runs under the lock with the reload", async function() {
        project.merging = true;
        await projects.commit(null, "p1", {message: "merge"});
        order.should.eql(["commit:locked", "stopFlows", "loadFlows"]);
    });
    it("a commit checks the merge state under the lock (TOCTOU)", async function() {
        // a pull under the lock leaves the project merging; a commit requested meanwhile
        // must see that state, complete the merge and reload the flows
        let release;
        const pullSection = lock.runExclusive(function() {
            order.push("pull:start");
            return new Promise(resolve => { release = () => { project.merging = true; order.push("pull:end"); resolve() } });
        });
        const commit = projects.commit(null, "p1", {message: "merge"});
        await wait();
        order.should.eql(["pull:start"]);
        release();
        await pullSection;
        await commit;
        order.should.eql(["pull:start", "pull:end", "commit:locked", "stopFlows", "loadFlows"]);
    });
    it("a commit without a merge does not reload the flows", async function() {
        await projects.commit(null, "p1", {message: "change"});
        order.should.eql(["commit:locked"]);
    });
    it("getProject loads the project under the lock and waits for a deploy", async function() {
        project.export = function() { return { name: "p1" } };
        let release;
        const deploy = lock.runExclusive(function() {
            order.push("deploy:start");
            return new Promise(resolve => { release = () => { order.push("deploy:end"); resolve() } });
        });
        const get = projects.getProject(null, "p1");
        await wait();
        order.should.eql(["deploy:start"]);
        release();
        await deploy;
        (await get).should.eql({ name: "p1" });
        order.should.eql(["deploy:start", "deploy:end", "load:locked"]);
    });
    it("getProject of an inactive project fails without the lock", function() {
        (function() { projects.getProject(null, "other") }).should.throw(/inactive project/);
        lock.isLocked().should.be.false();
    });
    it("a project switch loads the project under the lock", async function() {
        await projects.setActiveProject(null, "p1");
        order.should.eql(["load:locked", "stopFlows", "loadFlows"]);
    });
    it("releases the lock when the operation fails", async function() {
        project.setBranch = sinon.spy(async function() { throw new Error("checkout failed") });
        await projects.setBranch(null, "p1", "dev", false).should.be.rejectedWith("checkout failed");
        lock.isLocked().should.be.false();
        order.should.eql([]);
    });
});

describe("storage/localfilesystem/projects - project created from the existing flow files (E-01)", function() {
    const os = require("os");
    const projectsModulePath = NR_TEST_UTILS.resolve("@node-red/runtime/lib/storage/localfilesystem/projects/index.js");
    const Project = NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/projects/Project");
    const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");
    let projects;
    let order;
    let runtime;
    let project;

    beforeEach(async function() {
        // a fresh module instance: no active project
        delete require.cache[projectsModulePath];
        projects = require(projectsModulePath);
        order = [];
        runtime = {
            nodes: {
                stopFlows: sinon.spy(async function() { order.push("stopFlows") }),
                clearContext: sinon.spy(async function() { order.push("clearContext") }),
                loadFlows: sinon.spy(async function() { order.push("loadFlows") }),
                setCredentialSecret: sinon.spy()
            }
        };
        let projectSettings = {};
        sinon.stub(gitTools, "init").resolves({ version: "2.40.0" });
        sinon.stub(NR_TEST_UTILS.require("@node-red/runtime/lib/storage/localfilesystem/projects/ssh"), "init").resolves();
        sinon.stub(Project, "init");
        await projects.init({
            userDir: os.tmpdir(),
            readOnly: true,
            flowFile: "e01-test-flows.json",
            editorTheme: { projects: { enabled: true } },
            get: function(key) { return projectSettings[key] },
            set: async function(key, value) { projectSettings[key] = value }
        }, runtime);
        project = {
            name: "p2",
            isMerging: () => false,
            getFlowFile: () => "flows.json",
            getFlowFileBackup: () => ".flows.json.backup",
            getCredentialsFile: () => "flows_cred.json",
            getCredentialsFileBackup: () => ".flows_cred.json.backup",
            export: () => ({ name: "p2" })
        };
        sinon.stub(Project, "create").callsFake(async function(user, metadata) {
            order.push("create" + (lock.isLocked() ? ":locked" : ":unlocked"));
            return project;
        });
        sinon.stub(Project, "load").callsFake(async function() {
            order.push("load" + (lock.isLocked() ? ":locked" : ":unlocked"));
            return project;
        });
        sinon.stub(console, "log");
    });
    afterEach(async function() {
        sinon.restore();
        delete require.cache[projectsModulePath];
        await waitForDeployLockRelease(lock);
    });

    it("copies the flow files and activates the project in one section with a deploy waiting", async function() {
        let release;
        const firstDeploy = lock.runExclusive(function() {
            order.push("deploy1:start");
            return new Promise(resolve => { release = () => { order.push("deploy1:end"); resolve() } });
        });
        const create = projects.createProject(null, { name: "p2", files: { flow: "flows.json" }, migrateFiles: true });
        await new Promise(resolve => setTimeout(resolve, 10));
        // a deploy requested meanwhile must not save between the copy and the activation
        const secondDeploy = lock.runExclusive(async function() { order.push("deploy2") });
        order.should.eql(["deploy1:start"]);
        release();
        await firstDeploy;
        (await create).should.eql({ name: "p2" });
        await secondDeploy;
        order.indexOf("deploy2").should.be.above(order.indexOf("loadFlows"));
        order.slice(0, 6).should.eql(["deploy1:start", "deploy1:end", "create:locked", "load:locked", "stopFlows", "loadFlows"]);
        const metadata = Project.create.firstCall.args[1];
        metadata.files.should.have.property("oldFlow");
        metadata.files.should.have.property("oldCredentials");
    });
    it("a new empty project is created outside the lock and activated under it", async function() {
        await projects.createProject(null, { name: "p2", files: { flow: "flows.json" } });
        order.slice(0, 4).should.eql(["create:unlocked", "load:locked", "stopFlows", "loadFlows"]);
    });
    it("releases the lock when creating the project fails", async function() {
        Project.create.restore();
        sinon.stub(Project, "create").rejects(new Error("create failed"));
        await projects.createProject(null, { name: "p2", files: { flow: "flows.json" }, migrateFiles: true }).should.be.rejectedWith("create failed");
        lock.isLocked().should.be.false();
    });
});
