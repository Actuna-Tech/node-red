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
 *   Z-02: tests of publicRoute() and of the needsPermission() marker
 *   #68: tests of a failed save of the sessions in the token request, the revoke request,
 *   the exchange of the code and the generic strategy (a failed save is logged and answered
 *   with a general error)
 *   #63: the exchange of the code - no second answer when the response was already sent, and the level of the log
 *   for each kind of error (debug for an invalid code and a missing session store, warn for the others)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var sinon = require("sinon");

var passport = require("passport");

var NR_TEST_UTILS = require("nr-test-utils");

var auth = NR_TEST_UTILS.require("@node-red/editor-api/lib/auth");
var Users = NR_TEST_UTILS.require("@node-red/editor-api/lib/auth/users");
var Tokens = NR_TEST_UTILS.require("@node-red/editor-api/lib/auth/tokens");
var Permissions = NR_TEST_UTILS.require("@node-red/editor-api/lib/auth/permissions");
var { log: utilLog } = NR_TEST_UTILS.require("@node-red/util");
var http = require("http");
var request = require("nr-test-utils/supertest");
var express = require("express");
var bodyParser = require("body-parser");
var { settle, flush, trackRejections } = require("nr-test-utils/fault-injection");

describe("api/auth/index",function() {



    describe("ensureClientSecret", function() {
        before(function() {
            auth.init({},{})
        });
        it("leaves client_secret alone if not present",function(done) {
            var req = {
                body: {
                    client_secret: "test_value"
                }
            };
            auth.ensureClientSecret(req,null,function() {
                req.body.should.have.a.property("client_secret","test_value");
                done();
            })
        });
        it("applies a default client_secret if not present",function(done) {
            var req = {
                body: { }
            };
            auth.ensureClientSecret(req,null,function() {
                req.body.should.have.a.property("client_secret","not_available");
                done();
            })
        });
    });

    describe("revoke", function() {
        it("revokes a token", function(done) {
            var revokeToken = sinon.stub(Tokens,"revoke").callsFake(function() {
                return Promise.resolve();
            });

            var req = { body: { token: "abcdef" } };

            var res = { status: function(resp) {
                revokeToken.restore();

                resp.should.equal(200);
                return {
                    end: done
                }
            }};

            auth.revoke(req,res);
        });
    });

    describe("login", function() {
        beforeEach(function() {
            sinon.stub(Tokens,"init").callsFake(function(){});
            sinon.stub(Users,"init").callsFake(function(){});
        });
        afterEach(function() {
            Tokens.init.restore();
            Users.init.restore();
        });
        it("returns login details - credentials", function(done) {
            auth.init({adminAuth:{type:"credentials"}},{})
            auth.login(null,{json: function(resp) {
                resp.should.have.a.property("type","credentials");
                resp.should.have.a.property("prompts");
                resp.prompts.should.have.a.lengthOf(2);
                done();
            }});
        });
        it("returns login details - none", function(done) {
            auth.init({},{})
            auth.login(null,{json: function(resp) {
                resp.should.eql({});
                done();
            }});
        });
        it("returns login details - strategy", function(done) {
            auth.init({adminAuth:{type:"strategy",strategy:{label:"test-strategy",icon:"test-icon"}}},{})
            auth.login(null,{json: function(resp) {
                resp.should.have.a.property("type","strategy");
                resp.should.have.a.property("prompts");
                resp.prompts.should.have.a.lengthOf(1);
                resp.prompts[0].should.have.a.property("type","button");
                resp.prompts[0].should.have.a.property("label","test-strategy");
                resp.prompts[0].should.have.a.property("icon","test-icon");

                done();
            }});
        });

    });
    describe("needsPermission", function() {
        beforeEach(function() {
            sinon.stub(Tokens,"init").callsFake(function(){});
            sinon.stub(Users,"init").callsFake(function(){});
        });
        afterEach(function() {
            Tokens.init.restore();
            Users.init.restore();
            if (passport.authenticate.restore) {
                passport.authenticate.restore();
            }
            if (Permissions.hasPermission.restore) {
                Permissions.hasPermission.restore();
            }
        });


        it('no-ops if adminAuth not set', function(done) {
            sinon.stub(passport,"authenticate").callsFake(function(scopes,opts) {
                return function(req,res,next) {
                }
            });
            auth.init({});
            var func = auth.needsPermission("foo");
            func({},{},function() {
                passport.authenticate.called.should.be.false();
                done();
            })
        });
        it('skips auth if req.user undefined', function(done) {
            sinon.stub(passport,"authenticate").callsFake(function(scopes,opts) {
                return function(req,res,next) {
                    next();
                }
            });
            sinon.stub(Permissions,"hasPermission").callsFake(function(perm) { return true });
            auth.init({adminAuth:{}});
            var func = auth.needsPermission("foo");
            func({user:null},{},function() {
                try {
                    passport.authenticate.called.should.be.true();
                    Permissions.hasPermission.called.should.be.false();
                    done();
                } catch(err) {
                    done(err);
                }
            })
        });

        it('passes for valid user permission', function(done) {
            sinon.stub(passport,"authenticate").callsFake(function(scopes,opts) {
                return function(req,res,next) {
                    next();
                }
            });
            sinon.stub(Permissions,"hasPermission").callsFake(function(perm) { return true });
            auth.init({adminAuth:{}});
            var func = auth.needsPermission("foo");
            func({user:true,authInfo: { scope: "read"}},{},function() {
                try {
                    passport.authenticate.called.should.be.true();
                    Permissions.hasPermission.called.should.be.true();
                    Permissions.hasPermission.lastCall.args[0].should.eql("read");
                    Permissions.hasPermission.lastCall.args[1].should.eql("foo");
                    done();
                } catch(err) {
                    done(err);
                }
            })
        });

        it('rejects for invalid user permission', function(done) {
            sinon.stub(passport,"authenticate").callsFake(function(scopes,opts) {
                return function(req,res,next) {
                    next();
                }
            });
            sinon.stub(Permissions,"hasPermission").callsFake(function(perm) { return false });
            auth.init({adminAuth:{}});
            var func = auth.needsPermission("foo");
            func({user:true,authInfo: { scope: "read"}},{
                status: function(status) {
                    return { end: function() {
                        try {
                            status.should.eql(401);
                            done();
                        } catch(err) {
                            done(err);
                        }
                    }}
                }
            },function() {
                done(new Error("hasPermission unexpected passed"))
            });
        });
    });

    describe("publicRoute", function() {
        const ADMIN_ROUTE_AUTH = Symbol.for("node-red.adminRouteAuth");
        it("publicRoute returns marked pass-through middleware", function(done) {
            auth.init({adminAuth:{}});
            const func = auth.publicRoute();
            func[ADMIN_ROUTE_AUTH].should.equal("public");
            func({},{},done);
        });
        it("needsPermission middleware is marked", function() {
            auth.init({});
            auth.needsPermission("foo")[ADMIN_ROUTE_AUTH].should.equal("permission");
            auth.needsPermission("")[ADMIN_ROUTE_AUTH].should.equal("permission");
        });
    });
});

describe("api/auth/index - a failed save of the sessions (#68)", function() {
    var sandbox;
    var tracker;
    var warn;
    var audit;
    var servers;

    beforeEach(function() {
        sandbox = sinon.createSandbox();
        tracker = trackRejections();
        warn = sandbox.stub(utilLog, "warn");
        audit = sandbox.stub(utilLog, "audit");
        sandbox.stub(utilLog, "error");
        servers = [];
        auth.init({}, {});
    });
    afterEach(function() {
        // a request that got no answer must not keep its server open
        servers.forEach(function(server) {
            server.closeAllConnections();
            if (server.listening) {
                server.close();
            }
        });
        sandbox.restore();
        // back to the state before the sessions storage was set
        Tokens.init({});
    });

    var PATH_TEXT = "/tmp/userdir/.sessions.json";
    function storageError() {
        var err = new Error("ENOSPC: no space left on device, write '" + PATH_TEXT + "'");
        err.code = "ENOSPC";
        return err;
    }
    function createApp(setup) {
        var app = express();
        app.use(bodyParser.json());
        app.use(bodyParser.urlencoded({ extended: true }));
        app.use(passport.initialize());
        setup(app);
        var server = http.createServer(app);
        servers.push(server);
        return server;
    }
    // A request without an answer must be an assertion failure, not a timeout of the test
    async function send(req) {
        var result = await settle(req, 1000);
        if (result.state === "timeout") {
            req.abort();
        }
        result.state.should.equal("resolved", "the request got no answer (" + result.state + ")");
        return result.value;
    }
    function auditedEvents() {
        return audit.args.map(function(args) { return args[0] && args[0].event });
    }

    it("AC-Q1d (S12): POST /auth/token with a password gives 500 without a token and without the path", async function() {
        sandbox.stub(Users, "authenticate").callsFake(function() {
            return Promise.resolve({ username: "user68i", permissions: "*" });
        });
        sandbox.stub(Tokens, "create").callsFake(function() { return tracker.reject(storageError()) });
        var app = createApp(function(app) {
            app.post("/auth/token", auth.ensureClientSecret, auth.authenticateClient, auth.getToken, auth.errorHandler);
        });
        var res = await send(request(app).post("/auth/token").type("form").send({
            client_id: "node-red-admin", grant_type: "password", scope: "*", username: "user68i", password: "pw"
        }));
        res.status.should.equal(500);
        res.text.should.not.containEql("access_token");
        res.text.should.not.containEql(PATH_TEXT);
        res.text.should.not.containEql("ENOSPC");
        res.body.should.eql({ error: "server_error", error_description: "unexpected_error" });
        auditedEvents().should.not.containEql("auth.login");
        warn.called.should.be.true();
        tracker.dropped().should.have.length(0);
    });

    it("AC-Q1e (S13): POST /auth/revoke gives the general 400 answer without details and without the audit entry of a sign-out", async function() {
        sandbox.stub(Tokens, "revoke").callsFake(function() { return tracker.reject(storageError()) });
        var app = createApp(function(app) {
            app.post("/auth/revoke", auth.revoke);
        });
        var res = await send(request(app).post("/auth/revoke").send({ token: "token-68" }));
        res.status.should.equal(400);
        res.body.should.eql({ error: "unexpected_error" });
        res.text.should.not.containEql(PATH_TEXT);
        warn.called.should.be.true();
        auditedEvents().should.not.containEql("auth.login.revoke");
        tracker.dropped().should.have.length(0);
    });

    it("AC-Q1h (S18): POST /auth/token with a code gives 400 unexpected_error and logs the original error", async function() {
        sandbox.stub(Tokens, "exchangeCodeForToken").callsFake(function() { return tracker.reject(storageError()) });
        var app = createApp(function(app) {
            app.post("/auth/token", auth.exchangeCodeForToken);
        });
        var res = await send(request(app).post("/auth/token").send({ code: "code-68" }));
        res.status.should.equal(400);
        res.body.should.eql({ error: "unexpected_error" });
        res.text.should.not.containEql(PATH_TEXT);
        warn.args.some(function(args) { return args.join(" ").indexOf(PATH_TEXT) !== -1 }).should.be.true();
        tracker.dropped().should.have.length(0);
    });
    it("AC-Q1h (S18): POST /auth/token with a wrong code gives the same 400 body", async function() {
        await Tokens.init({}, {
            getSessions: function() { return Promise.resolve({}) },
            saveSessions: function() { return Promise.resolve() }
        });
        var app = createApp(function(app) {
            app.post("/auth/token", auth.exchangeCodeForToken);
        });
        var res = await send(request(app).post("/auth/token").send({ code: "wrong-code-68" }));
        res.status.should.equal(400);
        res.body.should.eql({ error: "unexpected_error" });
    });

    describe("completeVerify of the generic strategy", function() {
        var passportStrategyName = "strategy68";
        var verify;
        beforeEach(function() {
            class FakeStrategy extends passport.Strategy {
                constructor(options, verifyFunction) {
                    super();
                    this.name = passportStrategyName;
                    verify = verifyFunction;
                }
                authenticate() {}
            }
            auth.init({ adminAuth: { type: "strategy", strategy: {} }, httpAdminRoot: "/" }, {});
            var adminApp = { use: function() {}, get: function() {}, post: function() {} };
            auth.genericStrategy(adminApp, { name: passportStrategyName, strategy: FakeStrategy, options: {} });
        });
        afterEach(function() {
            passport.unuse(passportStrategyName);
            // the authentication settings of the module must not stay on for the other test files
            auth.init({}, {});
        });

        function callbackRecorder() {
            var calls = [];
            var finished = new Promise(function(resolve) { calls.finished = resolve });
            return {
                calls: calls,
                finished: finished,
                callback: function() {
                    calls.push(Array.prototype.slice.call(arguments));
                    calls.finished();
                }
            };
        }

        it("S14 (guard of the current behaviour): a saved token is passed on in the user", async function() {
            var user = { username: "user68f", permissions: "*" };
            var tokens = { exchangeCode: "code" };
            sandbox.stub(Users, "authenticate").callsFake(function() { return Promise.resolve(user) });
            sandbox.stub(Tokens, "create").callsFake(function() { return Promise.resolve(tokens) });
            var recorder = callbackRecorder();
            verify("profile68", recorder.callback);
            var result = await settle(recorder.finished, 500);
            result.state.should.equal("resolved");
            recorder.calls.should.have.length(1);
            should.not.exist(recorder.calls[0][0]);
            recorder.calls[0][1].should.equal(user);
            user.tokens.should.equal(tokens);
        });
        it("AC-Q1f (S14): a failed save gives one general error and the user gets no tokens", async function() {
            var user = { username: "user68g", permissions: "*" };
            sandbox.stub(Users, "authenticate").callsFake(function() { return Promise.resolve(user) });
            sandbox.stub(Tokens, "create").callsFake(function() { return tracker.reject(storageError()) });
            var recorder = callbackRecorder();
            verify("profile68", recorder.callback);
            var result = await settle(recorder.finished, 500);
            result.state.should.equal("resolved", "the verification did not answer (" + result.state + ")");
            await flush();
            recorder.calls.should.have.length(1);
            var err = recorder.calls[0][0];
            err.should.be.instanceof(Error);
            err.should.have.property("message", "unexpected_error");
            err.should.not.have.property("code");
            should.not.exist(user.tokens);
            warn.called.should.be.true();
            auditedEvents().should.not.containEql("auth.login");
            tracker.dropped().should.have.length(0);
        });
    });
});

describe("exchangeCodeForToken (#63)", function() {
    var sandbox;
    var debug;
    var warn;

    beforeEach(function() {
        sandbox = sinon.createSandbox();
        debug = sandbox.stub(utilLog, "debug");
        warn = sandbox.stub(utilLog, "warn");
        auth.init({}, {});
    });
    afterEach(function() {
        sandbox.restore();
    });

    // a response whose json() can fail: `failFirst` - the first call throws (after the headers were sent, or before)
    function createRes(options) {
        options = options || {};
        var res = {
            headersSent: false,
            statusCode: undefined,
            status: sinon.spy(function(code) { res.statusCode = code; return res; }),
            json: sinon.spy(function() {
                if (options.failFirst && res.json.callCount === 1) {
                    if (options.sentBeforeFailing) {
                        res.headersSent = true;
                    }
                    throw new Error("the write failed");
                }
                res.headersSent = true;
            })
        };
        return res;
    }

    it("B4-AC-4: success answers with the token once", async function() {
        sandbox.stub(Tokens, "exchangeCodeForToken").resolves({ access_token: "t", token_type: "Bearer" });
        var res = createRes();
        await auth.exchangeCodeForToken({ body: { code: "c" } }, res);
        res.json.callCount.should.equal(1);
        res.json.firstCall.args[0].should.eql({ access_token: "t", token_type: "Bearer" });
        res.status.called.should.be.false();
        warn.called.should.be.false();
    });

    it("B4-AC-4: res.json throws after the headers were sent - no second answer, a warning is logged", async function() {
        sandbox.stub(Tokens, "exchangeCodeForToken").resolves({ access_token: "t" });
        var res = createRes({ failFirst: true, sentBeforeFailing: true });
        await auth.exchangeCodeForToken({ body: { code: "c" } }, res);
        res.status.called.should.be.false();
        res.json.callCount.should.equal(1);
        warn.called.should.be.true();
        warn.args.map(a => a.join(" ")).join("\n").should.containEql("Exchanging the code for a token failed");
    });

    it("B4-AC-4: res.json throws before anything was sent - the answer is 400 unexpected_error", async function() {
        sandbox.stub(Tokens, "exchangeCodeForToken").resolves({ access_token: "t" });
        var res = createRes({ failFirst: true, sentBeforeFailing: false });
        await auth.exchangeCodeForToken({ body: { code: "c" } }, res);
        res.status.calledOnce.should.be.true();
        res.status.firstCall.args[0].should.equal(400);
        res.json.callCount.should.equal(2);
        res.json.secondCall.args[0].should.eql({ error: "unexpected_error" });
    });

    [
        ["invalid_exchange_code", Object.assign(new Error("invalid"), { code: "invalid_exchange_code" }), "debug"],
        ["not_initialised", Object.assign(new Error("not initialised"), { code: "not_initialised" }), "debug"],
        ["any other error", new Error("the save failed"), "warn"],
        ["an error with another code", Object.assign(new Error("other"), { code: "ENOSPC" }), "warn"]
    ].forEach(function(row) {
        it("B4-AC-5: " + row[0] + " is logged with " + row[2] + " and answered with 400 unexpected_error", async function() {
            sandbox.stub(Tokens, "exchangeCodeForToken").rejects(row[1]);
            var res = createRes();
            await auth.exchangeCodeForToken({ body: { code: "c" } }, res);
            res.status.calledOnce.should.be.true();
            res.status.firstCall.args[0].should.equal(400);
            res.json.calledOnce.should.be.true();
            res.json.firstCall.args[0].should.eql({ error: "unexpected_error" });
            var written = (row[2] === "debug" ? debug : warn);
            var other = (row[2] === "debug" ? warn : debug);
            written.args.map(a => a.join(" ")).join("\n").should.containEql("Exchanging the code for a token failed");
            other.args.map(a => a.join(" ")).join("\n").should.not.containEql("Exchanging the code for a token failed");
        });
    });
});
