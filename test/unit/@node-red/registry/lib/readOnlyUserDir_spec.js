/**
 * Copyright OpenJS Foundation and other contributors, https://openjsf.org/
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
 *   Z-11: defence in depth of the installers - with readOnlyUserDir install,
 *   update, remove, upload and the modules of the function node are rejected
 *   with read_only_user_dir before anything is written or npm is run
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const NR_TEST_UTILS = require("nr-test-utils");

const installer = NR_TEST_UTILS.require("@node-red/registry/lib/installer");
const externalModules = NR_TEST_UTILS.require("@node-red/registry/lib/externalModules");
const typeRegistry = NR_TEST_UTILS.require("@node-red/registry/lib/registry");
const pluginRegistry = NR_TEST_UTILS.require("@node-red/registry/lib/plugins");
const library = NR_TEST_UTILS.require("@node-red/registry/lib/library");
const { exec, hooks } = NR_TEST_UTILS.require("@node-red/util");

describe("registry installers with readOnlyUserDir (Z-11)", function() {
    let userDir;
    let before;

    function listing(dir) {
        return fs.readdirSync(dir).sort();
    }

    beforeEach(function() {
        userDir = fs.mkdtempSync(path.join(os.tmpdir(), "nr-ro-registry-"));
        before = listing(userDir);
        sinon.stub(exec, "run").resolves({ code: 0, stdout: "", stderr: "" });
    });
    afterEach(function() {
        sinon.restore();
        hooks.clear();
        fs.removeSync(userDir);
    });

    async function rejected(promiseFn) {
        let err = null;
        try {
            await promiseFn();
        } catch (e) {
            err = e;
        }
        should.exist(err, "expected a rejection");
        return err;
    }

    describe("installer.js", function() {
        beforeEach(function() {
            // installAll allowed on purpose: readOnlyUserDir must reject on its own
            installer.init({ userDir: userDir, readOnlyUserDir: true, externalModules: { palette: { allowInstall: true, allowUpload: true, allowUpdate: true } } });
        });
        it("installModule is rejected", async function() {
            const err = await rejected(() => installer.installModule("node-red-contrib-x"));
            err.code.should.equal("read_only_user_dir");
            err.status.should.equal(400);
            exec.run.called.should.be.false();
            listing(userDir).should.eql(before);
        });
        it("installModule with a tarball (upload) is rejected", async function() {
            const err = await rejected(() => installer.installModule(Buffer.from("not a tarball")));
            err.code.should.equal("read_only_user_dir");
            exec.run.called.should.be.false();
            listing(userDir).should.eql(before);
        });
        it("uninstallModule is rejected (no npm remove)", async function() {
            fs.ensureDirSync(path.join(userDir, "node_modules", "node-red-contrib-x"));
            before = listing(userDir);
            const err = await rejected(() => installer.uninstallModule("node-red-contrib-x"));
            err.code.should.equal("read_only_user_dir");
            exec.run.called.should.be.false();
            fs.existsSync(path.join(userDir, "node_modules", "node-red-contrib-x")).should.be.true();
        });
        it("without readOnlyUserDir uninstallModule runs npm remove (unchanged)", async function() {
            installer.init({ userDir: userDir });
            sinon.stub(typeRegistry, "removeModule").returns([]);
            sinon.stub(pluginRegistry, "removeModule").returns([]);
            sinon.stub(library, "removeExamplesDir");
            fs.ensureDirSync(path.join(userDir, "node_modules", "node-red-contrib-x"));
            await installer.uninstallModule("node-red-contrib-x");
            exec.run.calledOnce.should.be.true();
            exec.run.firstCall.args[1].should.containEql("remove");
        });
    });

    describe("externalModules.js", function() {
        function init(readOnlyUserDir) {
            externalModules.init({
                userDir: userDir,
                readOnlyUserDir: readOnlyUserDir,
                externalModules: { modules: { allowInstall: true } },
                get: () => {},
                set: () => {}
            });
            externalModules.register("function", "libs");
        }
        it("a missing module of the function node is not installed", async function() {
            init(true);
            const err = await rejected(() => externalModules.checkFlowDependencies([{ type: "function", libs: [{ module: "foo" }] }]));
            err.should.be.an.Array();
            err[0].error.code.should.equal("read_only_user_dir");
            exec.run.called.should.be.false();
            listing(userDir).should.eql(before);
        });
        it("without readOnlyUserDir the module is installed (unchanged)", async function() {
            init(false);
            await externalModules.checkFlowDependencies([{ type: "function", libs: [{ module: "foo" }] }]);
            exec.run.calledOnce.should.be.true();
        });
    });
});
