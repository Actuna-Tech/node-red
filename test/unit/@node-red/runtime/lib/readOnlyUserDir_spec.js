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
 *   Z-11: tests of the read-only user directory helpers
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const path = require("path");
const os = require("os");
const NR_TEST_UTILS = require("nr-test-utils");
const readOnlyUserDir = NR_TEST_UTILS.require("@node-red/runtime/lib/readOnlyUserDir");

describe("runtime/readOnlyUserDir (Z-11)", function() {
    let oldHome;
    let oldNRH;
    beforeEach(function() {
        oldHome = process.env.HOME;
        oldNRH = process.env.NODE_RED_HOME;
    });
    afterEach(function() {
        process.env.HOME = oldHome;
        if (oldNRH === undefined) {
            delete process.env.NODE_RED_HOME;
        } else {
            process.env.NODE_RED_HOME = oldNRH;
        }
    });

    it("isEnabled only with readOnlyUserDir: true", function() {
        readOnlyUserDir.isEnabled({ readOnlyUserDir: true }).should.be.true();
        readOnlyUserDir.isEnabled({ readOnlyUserDir: "true" }).should.be.false();
        readOnlyUserDir.isEnabled({}).should.be.false();
        readOnlyUserDir.isEnabled(null).should.be.false();
    });

    it("protectedDirs uses userDir", function() {
        readOnlyUserDir.protectedDirs({ userDir: "/data/nr" }).should.eql([path.resolve("/data/nr")]);
    });

    it("protectedDirs falls back to NODE_RED_HOME, cwd and ~/.node-red when userDir is unset", function() {
        process.env.NODE_RED_HOME = "/opt/node-red";
        process.env.HOME = "/home/someone";
        const dirs = readOnlyUserDir.protectedDirs({});
        dirs.should.containEql(path.resolve("/opt/node-red"));
        dirs.should.containEql(process.cwd());
        dirs.should.containEql(path.resolve("/home/someone/.node-red"));
    });

    it("isProtected for the directory and nested paths only", function() {
        const s = { userDir: "/data/nr" };
        readOnlyUserDir.isProtected("/data/nr", s).should.be.true();
        readOnlyUserDir.isProtected("/data/nr/context/global", s).should.be.true();
        readOnlyUserDir.isProtected("/data/nr/../nr/lib", s).should.be.true();
        readOnlyUserDir.isProtected("/data/nr-other/x", s).should.be.false();
        readOnlyUserDir.isProtected("/data", s).should.be.false();
        readOnlyUserDir.isProtected(path.join(os.tmpdir(), "x"), s).should.be.false();
    });

    it("error has code read_only_user_dir and status 400", function() {
        const err = readOnlyUserDir.error("deploy");
        err.should.have.property("code", "read_only_user_dir");
        err.should.have.property("status", 400);
        err.message.should.be.a.String();
    });

    it("assertWritable throws read_only_user_dir only for protected paths when enabled", function() {
        const s = { userDir: "/data/nr", readOnlyUserDir: true };
        (function() { readOnlyUserDir.assertWritable("/data/nr/flows.json", s, "flows") }).should.throw({ code: "read_only_user_dir" });
        readOnlyUserDir.assertWritable("/data/other/flows.json", s, "flows");
        readOnlyUserDir.assertWritable("/data/nr/flows.json", { userDir: "/data/nr" }, "flows");
    });

    describe("applySettings", function() {
        it("disables the features that write to the user directory", function() {
            const s = { readOnlyUserDir: true };
            const result = readOnlyUserDir.applySettings(s);
            s.externalModules.should.eql({
                autoInstall: false,
                palette: { allowInstall: false, allowUpload: false, allowUpdate: false },
                modules: { allowInstall: false }
            });
            // Projects are disabled by default: no editorTheme is added
            s.should.not.have.property("editorTheme");
            result.overridden.should.eql([]);
        });

        it("reports settings set to true that are overridden and keeps other values", function() {
            const s = {
                readOnlyUserDir: true,
                externalModules: { autoInstall: true, autoInstallRetry: 30, palette: { allowInstall: true, allowList: ["x"] }, modules: { allowInstall: false } },
                editorTheme: { projects: { enabled: true }, page: { title: "t" } },
                autoInstallModules: true
            };
            const result = readOnlyUserDir.applySettings(s);
            result.overridden.should.eql(["externalModules.autoInstall", "externalModules.palette.allowInstall", "editorTheme.projects.enabled", "autoInstallModules"]);
            s.externalModules.autoInstallRetry.should.equal(30);
            s.externalModules.palette.allowList.should.eql(["x"]);
            s.externalModules.palette.allowInstall.should.be.false();
            s.editorTheme.page.title.should.equal("t");
        });

        it("does nothing when disabled", function() {
            const s = { externalModules: { autoInstall: true } };
            readOnlyUserDir.applySettings(s).should.eql({ overridden: [] });
            s.should.eql({ externalModules: { autoInstall: true } });
        });
    });
});
