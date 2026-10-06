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
 *   tokens before init: regression tests for calls made before init()
 *   tokens before init: prototype property names are not treated as tokens
 *   #68: tests of a failed save of the sessions (the expiry of the sessions, the first load,
 *   get with an expired token, a session that was not saved is not kept)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var sinon = require("sinon");

var NR_TEST_UTILS = require("nr-test-utils");

var Tokens = NR_TEST_UTILS.require("@node-red/editor-api/lib/auth/tokens");
var Users = NR_TEST_UTILS.require("@node-red/editor-api/lib/auth/users");
var { log: utilLog } = NR_TEST_UTILS.require("@node-red/util");
var { settle, flush, trackRejections } = require("nr-test-utils/fault-injection");


describe("api/auth/tokens", function() {
    describe("#init",function() {
        it('loads sessions', function(done) {
            Tokens.init({}).then(done);
        });
    });


    describe("#get",function() {
        it('returns a valid token', function(done) {
            Tokens.init({},{
                getSessions:function() {
                    return Promise.resolve({"1234":{"user":"fred","expires":Date.now()+1000}});
                }
            }).then(function() {
                Tokens.get("1234").then(function(token) {
                    try {
                        token.should.have.a.property("user","fred");
                        done();
                    } catch(err) {
                        done(err);
                    }
                });
            });
        });

        it('returns null for an invalid token', function(done) {
            Tokens.init({},{
                getSessions:function() {
                    return Promise.resolve({});
                }
            }).then(function() {
                Tokens.get("1234").then(function(token) {
                    try {
                        should.not.exist(token);
                        done();
                    } catch(err) {
                        done(err);
                    }
                });
            });
        });
        it('returns null for an expired token', function(done) {
            var saveSessions = sinon.stub().returns(Promise.resolve());
            var expiryTime = Date.now()+50;
            Tokens.init({},{
                getSessions:function() {
                    return Promise.resolve({"1234":{"user":"fred","expires":expiryTime}});
                },
                saveSessions: saveSessions
            }).then(function() {
                Tokens.get("1234").then(function(token) {
                    try {
                        should.exist(token);
                        setTimeout(function() {
                            Tokens.get("1234").then(function(token) {
                                try {
                                    should.not.exist(token);
                                    saveSessions.calledOnce.should.be.true();
                                    done();
                                } catch(err) {
                                    done(err);
                                }
                            });
                        },100);
                    } catch(err) {
                        done(err);
                    }
                });
            });
        });

        it('returns a valid api token', function(done) {
            Tokens.init({
                tokens: [{
                    token: "1234",
                    user: "fred",
                }]
            },{
                getSessions:function() {
                    return Promise.resolve({});
                }
            }).then(function() {
                Tokens.get("1234").then(function(token) {
                    try {
                        token.should.have.a.property("user","fred");
                        done();
                    } catch(err) {
                        done(err);
                    }
                });
            });

        });
    });

    describe("#create",function() {
        it('creates a token', function(done) {
            var savedSession;
            Tokens.init({sessionExpiryTime: 10},{
                getSessions:function() {
                    return Promise.resolve({});
                },
                saveSessions:function(sess) {
                    savedSession = sess;
                    return Promise.resolve();
                }
            });
            var expectedExpiryTime = Date.now()+10000;


            Tokens.create("user","client","scope").then(function(token) {
                try {
                    should.exist(savedSession);
                    var sessionKeys = Object.keys(savedSession);
                    sessionKeys.should.have.lengthOf(1);

                    token.should.have.a.property('accessToken',sessionKeys[0]);
                    savedSession[sessionKeys[0]].should.have.a.property('user','user');
                    savedSession[sessionKeys[0]].should.have.a.property('client','client');
                    savedSession[sessionKeys[0]].should.have.a.property('scope','scope');
                    savedSession[sessionKeys[0]].should.have.a.property('expires');
                    savedSession[sessionKeys[0]].expires.should.be.within(expectedExpiryTime-200,expectedExpiryTime+200);
                    done();
                } catch(err) {
                    done(err);
                }
            });
        });
    });

    describe('Exchange code for token', function () {
        it('creates a token with an exchange code', function (done) {
            let savedSession;
            Tokens.init({sessionExpiryTime: 10, exchangeCodeExpiryTime: 0.5},{
                getSessions:function() {
                    return Promise.resolve({});
                },
                saveSessions:function(sess) {
                    savedSession = sess;
                    return Promise.resolve();
                }
            });
            Tokens.create("user", "client", "scope", true).then(function(token) {
                // When created with an exchange code, the session should not be saved until the code is exchanged
                should.not.exist(savedSession);
                token.should.have.a.property('exchangeCode');

                return Tokens.exchangeCodeForToken(token.exchangeCode).then(function(tokenResponse) {
                    tokenResponse.should.have.a.property('accessToken');
                    tokenResponse.should.have.a.property('expires_in');
                    should.exist(savedSession);
                    var sessionKeys = Object.keys(savedSession);
                    sessionKeys.should.have.lengthOf(1);
                    savedSession[sessionKeys[0]].should.have.a.property('user','user');
                    savedSession[sessionKeys[0]].should.have.a.property('client','client');
                    savedSession[sessionKeys[0]].should.have.a.property('scope','scope');
                    savedSession[sessionKeys[0]].should.have.a.property('expires');
                })
            }).then(done).catch(err => {
                done(err)
            })
        })
        it('cannot exchange an invalid code', function (done) {
            let savedSession;
            Tokens.init({sessionExpiryTime: 10, exchangeCodeExpiryTime: 0.5},{
                getSessions:function() {
                    return Promise.resolve({});
                },
                saveSessions:function(sess) {
                    savedSession = sess;
                    return Promise.resolve();
                }
            });
            Tokens.create("user", "client", "scope", true).then(function(token) {
                // When created with an exchange code, the session should not be saved until the code is exchanged
                should.not.exist(savedSession);
                token.should.have.a.property('exchangeCode');
                return Tokens.exchangeCodeForToken('invalid').then(function(tokenResponse) {
                    throw new Error("Should not have exchanged an invalid code");
                }).catch(err => {
                    err.toString().should.match(/Invalid exchange code/);
                })
            }).then(done).catch(err => {
                done(err)
            })
        })
        it('cannot exchange an expired code', function (done) {
            let savedSession;
            Tokens.init({sessionExpiryTime: 10, exchangeCodeExpiryTime: 0.1},{
                getSessions:function() {
                    return Promise.resolve({});
                },
                saveSessions:function(sess) {
                    savedSession = sess;
                    return Promise.resolve();
                }
            });
            Tokens.create("user", "client", "scope", true).then(function(token) {
                // When created with an exchange code, the session should not be saved until the code is exchanged
                should.not.exist(savedSession);
                token.should.have.a.property('exchangeCode');
                return new Promise(resolve => setTimeout(resolve, 200)).then(() => {
                    return Tokens.exchangeCodeForToken(token.exchangeCode).then(function(tokenResponse) {
                        throw new Error("Should not have exchanged an invalid code");
                    }).catch(err => {
                        err.toString().should.match(/Invalid exchange code/);
                    })
                })
            }).then(done).catch(err => {
                done(err)
            })
        })
        it('cannot exchange a code twice', function (done) {
            let savedSession;
            Tokens.init({sessionExpiryTime: 10, exchangeCodeExpiryTime: 0.1},{
                getSessions:function() {
                    return Promise.resolve({});
                },
                saveSessions:function(sess) {
                    savedSession = sess;
                    return Promise.resolve();
                }
            });
            Tokens.create("user", "client", "scope", true).then(function(token) {
                // When created with an exchange code, the session should not be saved until the code is exchanged
                should.not.exist(savedSession);
                token.should.have.a.property('exchangeCode');
                return Tokens.exchangeCodeForToken(token.exchangeCode).then(function(tokenResponse) {
                    tokenResponse.should.have.a.property('accessToken');
                    tokenResponse.should.have.a.property('expires_in');
                    return Tokens.exchangeCodeForToken(token.exchangeCode).then(function(tokenResponse) {
                        throw new Error("Should not have been able to exchange the same code twice");
                    }).catch(err => {
                        err.toString().should.match(/Invalid exchange code/);
                    })
                }).catch(err => {
                    err.toString().should.match(/Invalid exchange code/);
                })
            }).then(done).catch(err => {
                done(err)
            })
        })
    })

    describe("#revoke", function() {
        it('revokes a token', function(done) {
            var savedSession;
            Tokens.init({},{
                getSessions:function() {
                    return Promise.resolve({"1234":{"user":"fred","expires":Date.now()+1000}});
                },
                saveSessions:function(sess) {
                    savedSession = sess;
                    return Promise.resolve();
                }
            }).then(function() {
                Tokens.revoke("1234").then(function() {
                    try {
                        savedSession.should.not.have.a.property("1234");
                        done();
                    } catch(err) {
                        done(err);
                    }
                });
            });
        });
    });

    describe("#get before init", function() {
        // Module state is shared between test files, so load a fresh copy
        // of the tokens module that has never had init() called.
        var tokensPath = require.resolve(NR_TEST_UTILS.resolve("@node-red/editor-api/lib/auth/tokens"));
        var originalModule;
        var FreshTokens;
        beforeEach(function() {
            originalModule = require.cache[tokensPath];
            delete require.cache[tokensPath];
            FreshTokens = require(tokensPath);
        });
        afterEach(function() {
            require.cache[tokensPath] = originalModule;
        });

        it('does not throw and resolves null when called before init', function() {
            var result;
            (function() {
                result = FreshTokens.get("x");
            }).should.not.throw();
            return result.then(function(token) {
                should(token).be.null();
            });
        });

        it('resolves null for prototype property names before init', function() {
            return Promise.all(["constructor","__proto__","toString"].map(function(name) {
                return FreshTokens.get(name).then(function(token) {
                    should(token).be.null();
                });
            }));
        });

        it('create before init rejects with not_initialised', function() {
            var result;
            (function() {
                result = FreshTokens.create("fred","node-red-editor","*");
            }).should.not.throw();
            return result.then(function() {
                throw new Error("create unexpectedly resolved");
            }, function(err) {
                err.should.have.property("code","not_initialised");
            });
        });

        it('revoke before init rejects with not_initialised', function() {
            var result;
            (function() {
                result = FreshTokens.revoke("x");
            }).should.not.throw();
            return result.then(function() {
                throw new Error("revoke unexpectedly resolved");
            }, function(err) {
                err.should.have.property("code","not_initialised");
            });
        });

        it('exchangeCodeForToken before init rejects with not_initialised', function() {
            var result;
            (function() {
                result = FreshTokens.exchangeCodeForToken("x");
            }).should.not.throw();
            return result.then(function() {
                throw new Error("exchangeCodeForToken unexpectedly resolved");
            }, function(err) {
                err.should.have.property("code","not_initialised");
            });
        });
    });

});

describe("api/auth/tokens - a failed save of the sessions (#68)", function() {
    var tokensPath = require.resolve(NR_TEST_UTILS.resolve("@node-red/editor-api/lib/auth/tokens"));
    var strategiesPath = require.resolve(NR_TEST_UTILS.resolve("@node-red/editor-api/lib/auth/strategies"));
    var sandbox;
    var clock;
    var tracker;
    var warn;
    var savedModules;
    var Fresh;
    var freshStrategies;

    // Module state is shared between the test files: a fresh copy of the modules is used
    beforeEach(function() {
        sandbox = sinon.createSandbox();
        clock = sinon.useFakeTimers({ now: Date.now(), toFake: ["setTimeout", "clearTimeout", "Date"] });
        tracker = trackRejections();
        warn = sandbox.stub(utilLog, "warn");
        sandbox.stub(utilLog, "audit");
        savedModules = {};
        [tokensPath, strategiesPath].forEach(function(modulePath) {
            savedModules[modulePath] = require.cache[modulePath];
            delete require.cache[modulePath];
        });
        Fresh = require(tokensPath);
        freshStrategies = require(strategiesPath);
    });
    afterEach(function() {
        clock.restore();
        sandbox.restore();
        [tokensPath, strategiesPath].forEach(function(modulePath) {
            if (savedModules[modulePath]) {
                require.cache[modulePath] = savedModules[modulePath];
            } else {
                delete require.cache[modulePath];
            }
        });
    });

    function saveError() {
        return new Error("ENOSPC: no space left on device, write '/tmp/userdir/.sessions.json'");
    }
    function loggedSessionsFailure() {
        return warn.args.filter(function(args) { return /Saving the sessions failed/.test(args.join(" ")) });
    }

    it("AC-Q1b (S9): the timer that expires a session logs a failed save", async function() {
        var now = Date.now();
        var storage = {
            getSessions: function() { return Promise.resolve({ "A": { user: "fred", expires: now + 1000 } }) },
            saveSessions: sinon.spy(function() { return tracker.reject(saveError()) })
        };
        await Fresh.init({}, storage);
        await Fresh.get("unknown");
        storage.saveSessions.called.should.be.false();
        clock.tick(6001);
        await flush();
        storage.saveSessions.calledOnce.should.be.true();
        tracker.dropped().should.have.length(0);
        loggedSessionsFailure().should.have.length(1);
    });
    it("AC-Q1b (S10): the timer set when a session is created logs a failed save", async function() {
        var failing = false;
        var storage = {
            getSessions: function() { return Promise.resolve({}) },
            saveSessions: sinon.spy(function() { return failing ? tracker.reject(saveError()) : Promise.resolve() })
        };
        await Fresh.init({ sessionExpiryTime: 10 }, storage);
        var created = await Fresh.create("fred", "client", "*", false);
        created.should.have.property("accessToken");
        failing = true;
        clock.tick(15001);
        await flush();
        storage.saveSessions.calledTwice.should.be.true();
        tracker.dropped().should.have.length(0);
        loggedSessionsFailure().should.have.length(1);
    });

    it("AC-Q1g (S15, S16): a failed save when the sessions are loaded does not break the next requests", async function() {
        var now = Date.now();
        var user = { username: "fred", permissions: "*" };
        sandbox.stub(Users, "get").callsFake(function() { return Promise.resolve(user) });
        var saves = 0;
        var storage = {
            getSessions: function() {
                return Promise.resolve({
                    "A": { user: "fred", scope: "*", expires: now + 100000 },
                    "B": { user: "fred", scope: "*", expires: now - 1000 }
                });
            },
            saveSessions: sinon.spy(function() { return ++saves === 1 ? tracker.reject(saveError()) : Promise.resolve() })
        };
        await Fresh.init({}, storage);

        var resultA = await settle(Fresh.get("A"));
        resultA.state.should.equal("resolved", "get(A) was " + resultA.state);
        resultA.value.should.have.property("user", "fred");
        var resultB = await settle(Fresh.get("B"));
        resultB.state.should.equal("resolved", "get(B) was " + resultB.state);
        should.not.exist(resultB.value);
        var resultCreate = await settle(Fresh.create("user", "node-red-admin", "*", false));
        resultCreate.state.should.equal("resolved", "create was " + resultCreate.state);
        resultCreate.value.should.have.property("accessToken");

        var doneArgs = [];
        var done = new Promise(function(resolve) {
            freshStrategies.bearerStrategy("A", function() {
                doneArgs.push(Array.prototype.slice.call(arguments));
                resolve();
            });
        });
        var resultBearer = await settle(done, 500);
        resultBearer.state.should.equal("resolved", "the bearer strategy was " + resultBearer.state);
        await flush();
        doneArgs.should.have.length(1);
        should.not.exist(doneArgs[0][0]);
        doneArgs[0][1].should.equal(user);
        doneArgs[0][2].should.eql({ scope: "*" });
        loggedSessionsFailure().should.have.length(1);
        tracker.dropped().should.have.length(0);
    });
    it("AC-Q1g (S16): a failed save when a token is found expired answers as for an expired token", async function() {
        var now = Date.now();
        var failing = false;
        var storage = {
            getSessions: function() { return Promise.resolve({ "C": { user: "fred", expires: now + 1000 } }) },
            saveSessions: sinon.spy(function() { return failing ? tracker.reject(saveError()) : Promise.resolve() })
        };
        await Fresh.init({}, storage);
        var valid = await Fresh.get("C");
        valid.should.have.property("user", "fred");
        // the token expires before the timer of the expiry (5 s of grace) runs
        clock.tick(2000);
        failing = true;
        var result = await settle(Fresh.get("C"));
        result.state.should.equal("resolved", "get was " + result.state);
        should(result.value).be.null();
        await flush();
        loggedSessionsFailure().should.have.length(1);
        tracker.dropped().should.have.length(0);
    });

    it("AC-Q1i (S17): a session whose save failed is not kept (create)", async function() {
        var failing = true;
        var keysAtSave = [];
        var storage = {
            getSessions: function() { return Promise.resolve({}) },
            saveSessions: function(sessions) {
                keysAtSave.push(Object.keys(sessions));
                return failing ? tracker.reject(saveError()) : Promise.resolve();
            }
        };
        await Fresh.init({}, storage);
        var result = await settle(Fresh.create("fred", "client", "*", false));
        result.state.should.equal("rejected", "create was " + result.state);
        keysAtSave.should.have.length(1);
        keysAtSave[0].should.have.length(1);
        var token = keysAtSave[0][0];
        failing = false;
        var session = await settle(Fresh.get(token));
        session.state.should.equal("resolved");
        should.not.exist(session.value);
    });
    it("AC-Q1i (S17): a session whose save failed is not kept (exchange of the code)", async function() {
        var failing = true;
        var keysAtSave = [];
        var storage = {
            getSessions: function() { return Promise.resolve({}) },
            saveSessions: function(sessions) {
                keysAtSave.push(Object.keys(sessions));
                return failing ? tracker.reject(saveError()) : Promise.resolve();
            }
        };
        await Fresh.init({ exchangeCodeExpiryTime: 20 }, storage);
        var pending = await Fresh.create("fred", "client", "*", true);
        pending.should.have.property("exchangeCode");
        var result = await settle(Fresh.exchangeCodeForToken(pending.exchangeCode));
        result.state.should.equal("rejected", "the exchange was " + result.state);
        keysAtSave.should.have.length(1);
        keysAtSave[0].should.have.length(1);
        var token = keysAtSave[0][0];
        failing = false;
        var session = await settle(Fresh.get(token));
        session.state.should.equal("resolved");
        should.not.exist(session.value);
    });
});
