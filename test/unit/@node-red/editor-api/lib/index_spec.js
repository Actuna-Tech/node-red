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
 *   #19: supertest bound to 127.0.0.1 (nr-test-utils/supertest), no crosstalk with other processes (flaky tests)
 *   #63: the limit that the JSON and urlencoded parsers of the Admin API get from apiMaxLength (the shared case table
 *   of test/resources/body-parser-limit-cases.js), and the answer 413 for a declared length above the maximum string length
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var sinon = require("sinon");
var request = require("nr-test-utils/supertest");
var express = require("express");
var limitCases = require("../../../../resources/body-parser-limit-cases");

var NR_TEST_UTILS = require("nr-test-utils");
const auth = require("basic-auth");

var api = NR_TEST_UTILS.require("@node-red/editor-api");

var apiAuth = NR_TEST_UTILS.require("@node-red/editor-api/lib/auth");
var apiEditor = NR_TEST_UTILS.require("@node-red/editor-api/lib/editor");
var apiAdmin = NR_TEST_UTILS.require("@node-red/editor-api/lib/admin");


describe("api/index", function() {
    var beforeEach = function() {
        sinon.stub(apiAuth,"init").callsFake(function(){});
        sinon.stub(apiEditor,"init").callsFake(function(){
            var app = express();
            app.get("/editor",function(req,res) { res.status(200).end(); });
            return app;
        });
        sinon.stub(apiAdmin,"init").callsFake(function(){
            var app = express();
            app.get("/admin",function(req,res) { res.status(200).end(); });
            return app;
        });
        sinon.stub(apiAuth,"login").callsFake(function(req,res){
            res.status(200).end();
        });
    };
    var afterEach = function() {
        apiAuth.init.restore();
        apiAuth.login.restore();
        apiEditor.init.restore();
        apiAdmin.init.restore();
    };

    beforeEach(beforeEach);
    afterEach(afterEach);

    it("does not setup admin api if httpAdminRoot is false", function(done) {
        api.init({ httpAdminRoot: false },{},{},{});
        should.not.exist(api.httpAdmin);
        done();
    });
    describe('initalises admin api without adminAuth', function() {
        before(function() {
            beforeEach();
            api.init({},{},{},{});
        });
        after(afterEach);
        it('exposes the editor',function(done) {
            request(api.httpAdmin).get("/editor").expect(200).end(done);
        })
        it('exposes the admin api',function(done) {
            request(api.httpAdmin).get("/admin").expect(200).end(done);
        })
        it('exposes the auth api',function(done) {
            request(api.httpAdmin).get("/auth/login").expect(200).end(done);
        })
    });

    describe('initalises admin api without editor', function() {
        before(function() {
            beforeEach();
            api.init({ disableEditor: true },{},{},{});
        });
        after(afterEach);
        it('does not expose the editor',function(done) {
            request(api.httpAdmin).get("/editor").expect(404).end(done);
        })
        it('exposes the admin api',function(done) {
            request(api.httpAdmin).get("/admin").expect(200).end(done);
        })
        it('exposes the auth api',function(done) {
            request(api.httpAdmin).get("/auth/login").expect(200).end(done)
        })
    });

    describe('initialises api with admin middleware', function() {
        it('ignores non-function values',function(done) {
            api.init({ httpAdminRoot: true, httpAdminMiddleware: undefined },{},{},{});
            const middlewareFound = api.httpAdmin._router.stack.filter((layer) => layer.name === 'testMiddleware')
            should(middlewareFound).be.empty();
            done();
        });

        it('only accepts functions as middleware',function(done) {
            const testMiddleware = function(req, res, next){ next(); };
            api.init({ httpAdminRoot: true, httpAdminMiddleware: testMiddleware },{},{},{});
            const middlewareFound = api.httpAdmin._router.stack.filter((layer) => layer.name === 'testMiddleware')
            should(middlewareFound).be.length(1);
            done();
        });
    });

    describe('initialises api with authentication enabled', function() {

        it('enables an oauth/openID based authentication mechanism',function(done) {
            const stub = sinon.stub(apiAuth, 'genericStrategy').callsFake(function(){});
            const adminAuth = { type: 'strategy', strategy: {} }
            api.init({ httpAdminRoot: true, adminAuth },{},{},{});
            should(stub.called).be.ok();
            stub.restore();
            done();
        });

        it('enables password protection',function(done) {
            const adminAuth = { type: 'credentials' }
            api.init({ httpAdminRoot: true, adminAuth },{},{},{});
            
            // is the name ("initialize") of the passport middleware present
            const middlewareFound = api.httpAdmin._router.stack.filter((layer) => layer.name === 'initialize')
            should(middlewareFound).be.length(1);
            done();
        });

    });

    describe('initialises api with custom cors config', function () {
        const httpAdminCors = {
            origin: "*",
            methods: "GET,PUT,POST,DELETE"
        };

        it('uses default cors middleware when user settings absent', function(done){
            api.init({ httpAdminRoot: true }, {}, {}, {});
            const middlewareFound = api.httpAdmin._router.stack.filter((layer) => layer.name === 'corsMiddleware')
            should(middlewareFound).be.length(0);
            done();
        })

        it('enables custom cors middleware when settings present', function(done){
            api.init({ httpAdminRoot: true, httpAdminCors }, {}, {}, {});
            const middlewareFound = api.httpAdmin._router.stack.filter((layer) => layer.name === 'corsMiddleware')
            should(middlewareFound).be.length(1);
            done();
        })
    });

    describe('editor start', function () {

        it('cannot be started when editor is disabled', function (done) {
            const stub = sinon.stub(apiEditor, 'start').callsFake(function () {
                return Promise.resolve(true);
            });
            api.init({ httpAdminRoot: true, disableEditor: true }, {}, {}, {});
            should(api.start()).resolvedWith(true);
            stub.restore();
            done();
        });

        it('can be started when editor enabled', function (done) {
            const stub = sinon.stub(apiEditor, 'start');
            api.init({ httpAdminRoot: true, disableEditor: false }, {}, {}, {});
            api.start();
            should(stub.called).be.true();
            stub.restore();
            done();
        });

    });

    describe("the limit of the body parsers (#63)", function() {
        this.timeout(10000);

        before(function() {
            beforeEach();
        });
        after(afterEach);

        // The limits that api.init gives to bodyParser.json and bodyParser.urlencoded; the parsers are stand-ins that
        // let every request pass (only the calls that come from the Admin API count)
        function limitsFor(settings) {
            const parsers = require("body-parser");
            const names = ["json", "urlencoded"];
            const saved = {};
            const limits = { json: [], urlencoded: [] };
            names.forEach(function(name) {
                saved[name] = Object.getOwnPropertyDescriptor(parsers, name);
                Object.defineProperty(parsers, name, {
                    configurable: true,
                    enumerable: true,
                    value: function(options) {
                        if (new Error().stack.indexOf("editor-api/lib/index.js") !== -1) {
                            limits[name].push(options && options.limit);
                        }
                        return function(req, res, next) { next(); };
                    }
                });
            });
            try {
                api.init(settings, {}, {}, {});
            } finally {
                names.forEach(function(name) { Object.defineProperty(parsers, name, saved[name]); });
            }
            return limits;
        }

        function checkLimits(limits, expected) {
            limits.json.should.have.length(1);
            limits.urlencoded.should.have.length(1);
            should(limits.json[0]).equal(expected);
            should(limits.urlencoded[0]).equal(expected);
        }

        describe("B5-AC-3: the shared case table", function() {
            it("holds the values whose result is known from the rule", function() {
                const find = value => limitCases.cases.filter(c => c.given && Object.is(c.value, value))[0];
                limitCases.anchors.clamped.forEach(function(value) {
                    should.exist(find(value), "missing " + String(value));
                    find(value).expected.should.equal(limitCases.MAX);
                });
                limitCases.anchors.unchanged.forEach(function(value) {
                    should.exist(find(value), "missing " + String(value));
                    find(value).expected.should.equal(value);
                });
                limitCases.anchors.default.forEach(function(value) {
                    should.exist(find(value), "missing " + String(value));
                    find(value).expected.should.equal("5mb");
                });
                limitCases.cases.filter(c => !c.given).should.have.length(1);
                limitCases.cases.length.should.be.above(35);
            });

            limitCases.cases.forEach(function(entry) {
                it((entry.group === "clamped" ? "B5-AC-1/3" : "B5-AC-2/3") + ": apiMaxLength " + entry.label + " gives both parsers the limit of the table (" + entry.group + ")", function() {
                    checkLimits(limitsFor(limitCases.settingsFor(entry)), entry.expected);
                });
            });
        });

        // B5-AC-1 as the spec words it ("413 within 2000 ms for a declared length of 600000000 and 1 KiB of the body")
        // cannot be a test: body-parser 1.20.8 reads off the whole request before it passes its 413 on (read.js, `dump`),
        // with the default limit of 5 MB and with a limit clamped to the maximum string length alike - the answer comes
        // when the body has arrived. The difference the clamp makes is the limit given to the parsers: the table above
        // (the rows of the group "clamped" fail without the clamp).
        describe("the answers of the Admin API for the size of a body", function() {
            it("B5-AC-2: a JSON body of 6 MB with the default limit gets 413, as before", async function() {
                api.init({}, {}, {}, {});
                const res = await request(api.httpAdmin).post("/admin").set("Content-Type", "application/json")
                    .send(Buffer.from('{"a":"' + "x".repeat(6 * 1024 * 1024) + '"}'));
                res.status.should.equal(413);
            });

            it("B5-AC-2: a body below the limit is read: a small JSON body reaches the route", async function() {
                api.init({ apiMaxLength: "1gb" }, {}, {}, {});
                api.httpAdmin.post("/probe", function(req, res) { res.status(200).json(req.body); });
                const res = await request(api.httpAdmin).post("/probe").send({ a: 1 });
                res.status.should.equal(200);
                res.body.should.eql({ a: 1 });
            });
        });
    });
});
