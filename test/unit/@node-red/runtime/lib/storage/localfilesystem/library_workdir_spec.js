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
 *   #54: new test file - library_spec.js works in a directory of its own, so that two runs of it on one machine
 *   (and a run next to other files) do not touch each other's files (flaky tests)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const fs = require("fs-extra");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "../../../../../../..");
const MOCHA = require.resolve("mocha/bin/mocha.js");

describe("storage/localfilesystem/library_spec working directory (#54)", function() {
    const sharedDir = path.join(__dirname, ".testUserHome");
    const marker = path.join(sharedDir, "marker");

    afterEach(function() {
        fs.removeSync(sharedDir);
    });

    // Runs the tests of library_spec.js that use the user directory of the spec in an instance of mocha of its
    // own; resolves with its result code and its output
    function runLibrarySpec() {
        return new Promise(function(resolve, reject) {
            const child = spawn(process.execPath, [MOCHA, path.join(__dirname, "library_spec.js"), "--grep", "storage/localfilesystem/library should"], { cwd: ROOT });
            let output = "";
            child.stdout.on("data", function(data) { output += data });
            child.stderr.on("data", function(data) { output += data });
            child.once("error", reject);
            child.once("close", function(code) { resolve({ code: code, output: output }) });
        });
    }

    it("AC-32: a file in .testUserHome next to the spec is not touched by a run of library_spec.js", async function() {
        fs.ensureDirSync(sharedDir);
        fs.writeFileSync(marker, "keep");
        const run = await runLibrarySpec();
        run.output.should.match(/[1-9][0-9]* passing/);
        run.code.should.equal(0);
        fs.existsSync(marker).should.be.true();
        fs.readFileSync(marker, "utf8").should.equal("keep");
    });
});
