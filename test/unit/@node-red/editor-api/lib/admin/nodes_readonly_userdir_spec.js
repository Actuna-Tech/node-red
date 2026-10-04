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
 *   Z-11: contract test - DELETE /nodes/:module with readOnlyUserDir is rejected
 *   with 400 read_only_user_dir (no npm remove)
 *   #19: supertest bound to 127.0.0.1 (nr-test-utils/supertest), no crosstalk with other processes (flaky tests)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const request = require("nr-test-utils/supertest");
const express = require("express");
const sinon = require("sinon");
const NR_TEST_UTILS = require("nr-test-utils");

const adminNodes = NR_TEST_UTILS.require("@node-red/editor-api/lib/admin/nodes");
const runtimeNodesApi = NR_TEST_UTILS.require("@node-red/runtime/lib/api/nodes");

describe("DELETE /nodes/:module with readOnlyUserDir (Z-11)", function() {
    let app;
    let runtime;

    function setup(readOnlyUserDir) {
        runtime = {
            log: { audit: sinon.stub(), _: k => k, warn: sinon.stub(), info: sinon.stub(), trace: sinon.stub(), debug: sinon.stub() },
            settings: { available: () => true, readOnlyUserDir: readOnlyUserDir },
            nodes: {
                getModuleInfo: sinon.stub().returns({ name: "node-red-contrib-x", user: true }),
                uninstallModule: sinon.stub().resolves([])
            }
        };
        runtimeNodesApi.init(runtime);
        adminNodes.init({ settings: {}, nodes: runtimeNodesApi });
        app = express();
        app.delete(/\/nodes\/((@[^\/]+\/)?[^\/]+)$/, adminNodes.delete);
    }

    it("readOnlyUserDir: 400 read_only_user_dir, npm remove not run, audited", async function() {
        setup(true);
        const res = await request(app).del("/nodes/node-red-contrib-x").expect(400);
        res.body.should.have.property("code", "read_only_user_dir");
        runtime.nodes.uninstallModule.called.should.be.false();
        runtime.log.audit.calledWithMatch({ event: "nodes.remove", error: "read_only_user_dir" }).should.be.true();
    });
    it("readOnlyUserDir: also for a scoped module", async function() {
        setup(true);
        const res = await request(app).del("/nodes/@scope/node-red-contrib-x").expect(400);
        res.body.should.have.property("code", "read_only_user_dir");
        runtime.nodes.uninstallModule.called.should.be.false();
    });
    it("without readOnlyUserDir: the module is removed (unchanged)", async function() {
        setup(false);
        await request(app).del("/nodes/node-red-contrib-x").expect(204);
        runtime.nodes.uninstallModule.calledOnce.should.be.true();
    });
});
