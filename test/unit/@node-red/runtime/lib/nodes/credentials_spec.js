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
 *   #2: tests of digest() - the digest of the credentials read from storage, also
 *   during a pending migration from the default key to a user key
 *   #43 (SEC-004): digest() of an unusual object (a getter, a Proxy that throws) -
 *   a fixed error credentials_digest_failed without the message of the cause
 *   Test isolation: the tests of load() with a pending migration finish it (export) after
 *   each test, so the module flag removeDefaultKey does not leak to other specs of the process
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var should = require("should");
var sinon = require("sinon");
var util = require("util");
var crypto = require("crypto");

var NR_TEST_UTILS = require("nr-test-utils");
var index = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/index");
var credentials = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/credentials");
var log = NR_TEST_UTILS.require("@node-red/util").log;


describe('red/runtime/nodes/credentials', function() {

    var encryptionDisabledSettings = {
        get: function(key) {
            return false;
        }
    }

    afterEach(function() {
        index.clearRegistry();
    });

    it('loads provided credentials',function() {
        credentials.init({
            log: log,
            settings: encryptionDisabledSettings
        });

        return credentials.load({"a":{"b":1,"c":2}}).then(function() {
            credentials.get("a").should.have.property('b',1);
            credentials.get("a").should.have.property('c',2);
        });
    });
    it('adds a new credential',function() {
        credentials.init({
            log: log,
            settings: encryptionDisabledSettings
        });
        return credentials.load({"a":{"b":1,"c":2}}).then(function() {
            credentials.dirty().should.be.false();
            should.not.exist(credentials.get("b"));
            return credentials.add("b",{"foo":"bar"}).then(function() {
                credentials.get("b").should.have.property("foo","bar");
                credentials.dirty().should.be.true();
            });
        });
    });
    it('deletes an existing credential',function() {
        credentials.init({
            log: log,
            settings: encryptionDisabledSettings
        });
        return credentials.load({"a":{"b":1,"c":2}}).then(function() {
            credentials.dirty().should.be.false();
            credentials.delete("a");
            should.not.exist(credentials.get("a"));
            credentials.dirty().should.be.true();
        });
    });

    it('exports the credentials, clearing dirty flag', function() {
        credentials.init({
            log: log,
            settings: encryptionDisabledSettings
        });
        var creds = {"a":{"b":1,"c":2}};
        return credentials.load(creds).then(function() {
            return credentials.add("b",{"foo":"bar"})
        }).then(function() {
            credentials.dirty().should.be.true();
            return credentials.export().then(function(exported) {
                exported.should.eql(creds);
                credentials.dirty().should.be.false();
            })
        });
    })

    describe("#clean",function() {
        it("removes credentials of unknown nodes",function() {
            credentials.init({
                log: log,
                settings: encryptionDisabledSettings,
                nodes: { getType: () => function(){} }
            });
            var creds = {"a":{"b":1,"c":2},"b":{"d":3}};
            return credentials.load(creds).then(function() {
                credentials.dirty().should.be.false();
                should.exist(credentials.get("a"));
                should.exist(credentials.get("b"));
                return credentials.clean([{id:"b"}]).then(function() {
                    credentials.dirty().should.be.true();
                    should.not.exist(credentials.get("a"));
                    should.exist(credentials.get("b"));
                });
            });
        });
        it("extracts credentials of known nodes",function() {
            credentials.init({
                log: log,
                settings: encryptionDisabledSettings,
                nodes: { getType: () => function(){} }
            });
            credentials.register("testNode",{"b":"text","c":"password"})
            var creds = {"a":{"b":1,"c":2}};
            var newConfig = [{id:"a",type:"testNode",credentials:{"b":"newBValue","c":"newCValue"}}];
            return credentials.load(creds).then(function() {
                credentials.dirty().should.be.false();
                return credentials.clean(newConfig).then(function() {
                    credentials.dirty().should.be.true();
                    credentials.get("a").should.have.property('b',"newBValue");
                    credentials.get("a").should.have.property('c',"newCValue");
                    should.not.exist(newConfig[0].credentials);
                });
            });
        });


    });

    it('warns if a node has no credential definition', function() {
        credentials.init({
            log: log,
            settings: encryptionDisabledSettings,
            nodes: { getType: () => function(){} }
        });
        return credentials.load({}).then(function() {
            var node = {id:"node",type:"test",credentials:{
                user1:"newUser",
                password1:"newPassword"
            }};
            sinon.spy(log,"warn");
            credentials.extract(node);
            log.warn.called.should.be.true();
            should.not.exist(node.credentials);
            log.warn.restore();
        });
    })

    it('extract credential updates in the provided node', function(done) {
        credentials.init({
            log: log,
            settings: encryptionDisabledSettings,
            nodes: { getType: () => function(){} }
        });
        var defintion = {
            user1:{type:"text"},
            password1:{type:"password"},
            user2:{type:"text"},
            password2:{type:"password"},
            user3:{type:"text"},
            password3:{type:"password"}

        };
        credentials.register("test",defintion);
        var def = credentials.getDefinition("test");
        defintion.should.eql(def);

        credentials.load({"node":{user1:"abc",password1:"123",user2:"def",password2:"456",user3:"ghi",password3:"789"}}).then(function() {
            var node = {id:"node",type:"test",credentials:{
                // user1 unchanged
                password1:"__PWRD__",
                user2: "",
                password2:"   ",
                user3:"newUser",
                password3:"newPassword"
            }};
            credentials.dirty().should.be.false();
            credentials.extract(node);

            node.should.not.have.a.property("credentials");

            credentials.dirty().should.be.true();
            var newCreds = credentials.get("node");
            newCreds.should.have.a.property("user1","abc");
            newCreds.should.have.a.property("password1","123");
            newCreds.should.not.have.a.property("user2");
            newCreds.should.not.have.a.property("password2");
            newCreds.should.have.a.property("user3","newUser");
            newCreds.should.have.a.property("password3","newPassword");

            done();
        });
    });
    it('extract ignores node without credentials', function(done) {
        credentials.init({
            log: log,
            settings: encryptionDisabledSettings,
            nodes: { getType: () => function(){} }
        });
        credentials.load({"node":{user1:"abc",password1:"123"}}).then(function() {
            var node = {id:"node",type:"test"};

            credentials.dirty().should.be.false();
            credentials.extract(node);
            credentials.dirty().should.be.false();
            done();
        });
    });

    describe("encryption",function() {
        var settings = {};
        var runtime = {
            log: log,
            settings: {
                get: function(key) {
                    return settings[key];
                },
                set: function(key,value) {
                    settings[key] = value;
                    return Promise.resolve();
                },
                delete: function(key) {
                    delete settings[key];
                    return Promise.resolve();
                }
            },
            nodes: { getType: () => function(){} }
        }
        it('migrates to encrypted and generates default key', function(done) {
            settings = {};
            credentials.init(runtime);
            credentials.load({"node":{user1:"abc",password1:"123"}}).then(function() {
                settings.should.have.a.property("_credentialSecret");
                settings._credentialSecret.should.have.a.length(64);
                credentials.dirty().should.be.true();
                credentials.export().then(function(result) {
                    result.should.have.a.property("$");
                    // reset everything - but with _credentialSecret still set
                    credentials.init(runtime);
                    // load the freshly encrypted version
                    credentials.load(result).then(function() {
                        should.exist(credentials.get("node"));
                        done();
                    })
                });
            });
        });
        it('uses default key', function(done) {
            settings = {
                _credentialSecret: "e3a36f47f005bf2aaa51ce3fc6fcaafd79da8d03f2b1a9281f8fb0a285e6255a"
            };
            // {"node":{user1:"abc",password1:"123"}}
            var cryptedFlows = {"$":"5b89d8209b5158a3c313675561b1a5b5phN1gDBe81Zv98KqS/hVDmc9EKvaKqRIvcyXYvBlFNzzzJtvN7qfw06i"};
            credentials.init(runtime);
            credentials.load(cryptedFlows).then(function() {
                should.exist(credentials.get("node"));
                credentials.dirty().should.be.false();
                credentials.add("node",{user1:"def",password1:"456"});
                credentials.export().then(function(result) {
                    result.should.have.a.property("$");
                    // reset everything - but with _credentialSecret still set
                    credentials.init(runtime);
                    // load the freshly encrypted version
                    credentials.load(result).then(function() {
                        should.exist(credentials.get("node"));
                        credentials.get("node").should.have.a.property("user1","def");
                        credentials.get("node").should.have.a.property("password1","456");
                        done();
                    })
                });
            });
        });
        it('uses user key', function(done) {
            settings = {
                credentialSecret: "e3a36f47f005bf2aaa51ce3fc6fcaafd79da8d03f2b1a9281f8fb0a285e6255a"
            };
            // {"node":{user1:"abc",password1:"123"}}
            var cryptedFlows = {"$":"5b89d8209b5158a3c313675561b1a5b5phN1gDBe81Zv98KqS/hVDmc9EKvaKqRIvcyXYvBlFNzzzJtvN7qfw06i"};
            credentials.init(runtime);
            credentials.load(cryptedFlows).then(function() {
                credentials.dirty().should.be.false();
                should.exist(credentials.get("node"));
                credentials.add("node",{user1:"def",password1:"456"});
                credentials.export().then(function(result) {
                    result.should.have.a.property("$");

                    // reset everything - but with _credentialSecret still set
                    credentials.init(runtime);
                    // load the freshly encrypted version
                    credentials.load(result).then(function() {
                        should.exist(credentials.get("node"));
                        credentials.get("node").should.have.a.property("user1","def");
                        credentials.get("node").should.have.a.property("password1","456");
                        done();
                    })
                });
            });
        });
        it('uses user key - when settings are otherwise unavailable', function(done) {
            var runtime = {
                log: log,
                settings: {
                    get: function(key) {
                        if (key === 'credentialSecret') {
                            return "e3a36f47f005bf2aaa51ce3fc6fcaafd79da8d03f2b1a9281f8fb0a285e6255a";
                        }
                        throw new Error();
                    },
                    set: function(key,value) {
                        throw new Error();
                    }
                }
            }
            // {"node":{user1:"abc",password1:"123"}}
            var cryptedFlows = {"$":"5b89d8209b5158a3c313675561b1a5b5phN1gDBe81Zv98KqS/hVDmc9EKvaKqRIvcyXYvBlFNzzzJtvN7qfw06i"};
            credentials.init(runtime);
            credentials.load(cryptedFlows).then(function() {
                should.exist(credentials.get("node"));
                credentials.add("node",{user1:"def",password1:"456"});
                credentials.export().then(function(result) {
                    result.should.have.a.property("$");

                    // reset everything - but with _credentialSecret still set
                    credentials.init(runtime);
                    // load the freshly encrypted version
                    credentials.load(result).then(function() {
                        should.exist(credentials.get("node"));
                        credentials.get("node").should.have.a.property("user1","def");
                        credentials.get("node").should.have.a.property("password1","456");
                        done();
                    })
                });
            });
        });
        it('migrates from default key to user key', function() {
            settings = {
                _credentialSecret: "e3a36f47f005bf2aaa51ce3fc6fcaafd79da8d03f2b1a9281f8fb0a285e6255a",
                credentialSecret:  "aaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbcccccccccccccddddddddddddeeeee"
            };
            // {"node":{user1:"abc",password1:"123"}}
            var cryptedFlows = {"$":"5b89d8209b5158a3c313675561b1a5b5phN1gDBe81Zv98KqS/hVDmc9EKvaKqRIvcyXYvBlFNzzzJtvN7qfw06i"};
            credentials.init(runtime);
            return credentials.load(cryptedFlows).then(function() {
                credentials.dirty().should.be.true();
                should.exist(credentials.get("node"));
                return credentials.export().then(function(result) {
                    result.should.have.a.property("$");
                    settings.should.not.have.a.property("_credentialSecret");

                    // reset everything - but with _credentialSecret still set
                    credentials.init(runtime);
                    // load the freshly encrypted version
                    return credentials.load(result).then(function() {
                        should.exist(credentials.get("node"));
                        credentials.get("node").should.have.a.property("user1","abc");
                        credentials.get("node").should.have.a.property("password1","123");
                    })
                });
            });
        });

        it('migrates from default key to user key - unencrypted original', function(done) {
            settings = {
                _credentialSecret: "e3a36f47f005bf2aaa51ce3fc6fcaafd79da8d03f2b1a9281f8fb0a285e6255a",
                credentialSecret:  "aaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbcccccccccccccddddddddddddeeeee"
            };
            // {"node":{user1:"abc",password1:"123"}}
            var unencryptedFlows = {"node":{user1:"abc",password1:"123"}};
            credentials.init(runtime);
            credentials.load(unencryptedFlows).then(function() {
                credentials.dirty().should.be.true();
                should.exist(credentials.get("node"));
                credentials.export().then(function(result) {
                    result.should.have.a.property("$");
                    settings.should.not.have.a.property("_credentialSecret");
                    // reset everything - but with _credentialSecret still set
                    credentials.init(runtime);
                    // load the freshly encrypted version
                    credentials.load(result).then(function() {
                        should.exist(credentials.get("node"));
                        credentials.get("node").should.have.a.property("user1","abc");
                        credentials.get("node").should.have.a.property("password1","123");
                        done();
                    })
                });
            });
        });

        it('migrates from default key to unencrypted', function(done) {
            settings = {
                _credentialSecret: "e3a36f47f005bf2aaa51ce3fc6fcaafd79da8d03f2b1a9281f8fb0a285e6255a",
                credentialSecret:  false
            };
            // {"node":{user1:"abc",password1:"123"}}
            var cryptedFlows = {"$":"5b89d8209b5158a3c313675561b1a5b5phN1gDBe81Zv98KqS/hVDmc9EKvaKqRIvcyXYvBlFNzzzJtvN7qfw06i"};
            credentials.init(runtime);
            credentials.load(cryptedFlows).then(function() {
                credentials.dirty().should.be.true();
                should.exist(credentials.get("node"));
                credentials.export().then(function(result) {
                    result.should.not.have.a.property("$");
                    settings.should.not.have.a.property("_credentialSecret");
                    result.should.eql({"node":{user1:"abc",password1:"123"}});
                    done();
                });
            });
        });
        it('handles bad default key - resets credentials', function(done) {
            settings = {
                _credentialSecret: "badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb"
            };
            // {"node":{user1:"abc",password1:"123"}}
            var cryptedFlows = {"$":"5b89d8209b5158a3c313675561b1a5b5phN1gDBe81Zv98KqS/hVDmc9EKvaKqRIvcyXYvBlFNzzzJtvN7qfw06i"};
            credentials.init(runtime);
            credentials.load(cryptedFlows).then(function() {
                // credentials.dirty().should.be.true();
                // should.not.exist(credentials.get("node"));
                done();
            }).catch(function(err) {
                err.should.have.property('code','credentials_load_failed');
                done();
            });
        });
        it('handles bad user key - resets credentials', function(done) {
            settings = {
                credentialSecret: "badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb"
            };
            // {"node":{user1:"abc",password1:"123"}}
            var cryptedFlows = {"$":"5b89d8209b5158a3c313675561b1a5b5phN1gDBe81Zv98KqS/hVDmc9EKvaKqRIvcyXYvBlFNzzzJtvN7qfw06i"};
            credentials.init(runtime);
            credentials.load(cryptedFlows).then(function() {
                // credentials.dirty().should.be.true();
                // should.not.exist(credentials.get("node"));
                done();
            }).catch(function(err) {
                err.should.have.property('code','credentials_load_failed');
                done();
            });
        });

        it('handles bad credentials object - resets credentials', function(done) {
            settings = {
                credentialSecret: "e3a36f47f005bf2aaa51ce3fc6fcaafd79da8d03f2b1a9281f8fb0a285e6255a"
            };
            // {"node":{user1:"abc",password1:"123"}}
            var cryptedFlows = {"BADKEY":"5b89d8209b5158a3c313675561b1a5b5phN1gDBe81Zv98KqS/hVDmc9EKvaKqRIvcyXYvBlFNzzzJtvN7qfw06i"};
            credentials.init(runtime);
            credentials.load(cryptedFlows).then(function() {
                done();
            }).catch(function(err) {
                err.should.have.property('code','credentials_load_failed');
                done();
            });
        });

        it('handles unavailable settings - leaves creds unencrypted', function(done) {
            var runtime = {
                log: log,
                settings: {
                    get: function(key) {
                        throw new Error();
                    },
                    set: function(key,value) {
                        throw new Error();
                    }
                },
                nodes: { getType: () => function(){} }
            }
            // {"node":{user1:"abc",password1:"123"}}
            credentials.init(runtime);
            credentials.load({"node":{user1:"abc",password1:"123"}}).then(function() {
                credentials.dirty().should.be.false();
                should.exist(credentials.get("node"));
                credentials.export().then(function(result) {
                    result.should.not.have.a.property("$");
                    result.should.have.a.property("node");
                    done();
                });
            });
        });
    })
    describe("#digest (#2)", function() {
        var USER_KEY = "e3a36f47f005bf2aaa51ce3fc6fcaafd79da8d03f2b1a9281f8fb0a285e6255a";
        // {"node":{user1:"abc",password1:"123"}} encrypted with USER_KEY
        var CRYPTED = {"$":"5b89d8209b5158a3c313675561b1a5b5phN1gDBe81Zv98KqS/hVDmc9EKvaKqRIvcyXYvBlFNzzzJtvN7qfw06i"};
        var settingsValues;
        var settingsSet;
        var logStub;
        var runtime;

        function encrypt(secret, text) {
            var key = crypto.createHash("sha256").update(secret).digest();
            var iv = crypto.randomBytes(16);
            var cipher = crypto.createCipheriv("aes-256-ctr", key, iv);
            return {"$": iv.toString("hex") + cipher.update(text, "utf8", "base64") + cipher.final("base64")};
        }
        function logCalls() {
            return ["warn", "error", "info", "debug", "trace"].reduce(function(n, level) {
                return n + logStub[level].callCount;
            }, 0);
        }

        beforeEach(function() {
            settingsValues = { credentialSecret: USER_KEY };
            settingsSet = sinon.spy(function(key, value) { settingsValues[key] = value; return Promise.resolve() });
            logStub = { _: function(key) { return key } };
            ["warn", "error", "info", "debug", "trace"].forEach(function(level) { logStub[level] = sinon.spy() });
            runtime = {
                log: logStub,
                settings: {
                    get: function(key) { return settingsValues[key] },
                    set: settingsSet,
                    delete: function(key) { delete settingsValues[key]; return Promise.resolve() }
                },
                nodes: { getType: () => function(){} }
            };
        });

        it("is a digest of the canonical JSON: the order of the keys does not matter", function() {
            credentials.init(runtime);
            var a = credentials.digest({"n1":{"user":"abc","password":"123"},"n2":{"k":[1,{"b":2,"a":1}]}});
            var b = credentials.digest({"n2":{"k":[1,{"a":1,"b":2}]},"n1":{"password":"123","user":"abc"}});
            a.should.match(/^[0-9a-f]{64}$/);
            a.should.equal(b);
            // stable inside the process, and keyed: not a plain hash of the content that
            // could be matched against a leaked value (HMAC with a per-process key)
            credentials.digest({"n1":{"user":"abc","password":"123"},"n2":{"k":[1,{"a":1,"b":2}]}}).should.equal(a);
            a.should.not.equal(crypto.createHash("sha256").update('{"n1":{"password":"123","user":"abc"},"n2":{"k":[1,{"a":1,"b":2}]}}').digest("hex"));
            // init() of the module does not change the key of the digests inside the process
            credentials.init(runtime);
            credentials.digest({"n2":{"k":[1,{"b":2,"a":1}]},"n1":{"user":"abc","password":"123"}}).should.equal(a);
        });
        it("differs for different content, also the order of an array", function() {
            credentials.init(runtime);
            var base = credentials.digest({"n1":{"user":"abc"},"l":[1,2]});
            credentials.digest({"n1":{"user":"abd"},"l":[1,2]}).should.not.equal(base);
            credentials.digest({"n1":{"user":"abc"},"l":[2,1]}).should.not.equal(base);
            credentials.digest({"n1":{"user":"abc"}}).should.not.equal(base);
            credentials.digest({}).should.not.equal(base);
        });
        it("is the digest of the decrypted content: encrypted and plain give the same", function() {
            credentials.init(runtime);
            return credentials.load(CRYPTED).then(function() {
                credentials.digest(CRYPTED).should.equal(credentials.digest({"node":{"password1":"123","user1":"abc"}}));
            });
        });
        it("re-encryption of the same content (a new random iv) gives the same digest", function() {
            credentials.init(runtime);
            return credentials.load({}).then(function() {
                return credentials.add("node", {"user1":"abc","password1":"123"});
            }).then(function() {
                return credentials.export();
            }).then(function(first) {
                // dirty again without changing the content
                credentials.delete("nothing");
                return credentials.export().then(function(second) {
                    first.should.have.property("$");
                    second.should.have.property("$");
                    // the ciphertext changes on every save - it must not be compared
                    second["$"].should.not.equal(first["$"]);
                    credentials.digest(second).should.equal(credentials.digest(first));
                    credentials.digest(first).should.equal(credentials.digest({"node":{"user1":"abc","password1":"123"}}));
                });
            });
        });
        it("a change of one value changes the digest", function() {
            credentials.init(runtime);
            return credentials.load({}).then(function() {
                return credentials.add("node", {"user1":"abc","password1":"123"});
            }).then(function() {
                return credentials.export();
            }).then(function(first) {
                return credentials.add("node", {"user1":"abc","password1":"124"}).then(function() {
                    return credentials.export().then(function(second) {
                        credentials.digest(second).should.not.equal(credentials.digest(first));
                    });
                });
            });
        });
        it("does not change the state of the module: cache, dirty flag, key, settings, log", function() {
            credentials.init(runtime);
            return credentials.load(CRYPTED).then(function() {
                var cache = JSON.stringify(credentials.get("node"));
                var keyType = credentials.getKeyType();
                var settingsBefore = JSON.stringify(settingsValues);
                var logBefore = logCalls();
                credentials.dirty().should.be.false();
                // content of another configuration, encrypted with the current key
                var other = encrypt(USER_KEY, JSON.stringify({"other":{"user1":"x"},"node":{"user1":"y"}}));
                credentials.digest(other).should.match(/^[0-9a-f]{64}$/);
                credentials.digest({"third":{"a":1}}).should.match(/^[0-9a-f]{64}$/);
                should.not.exist(credentials.get("other"));
                should.not.exist(credentials.get("third"));
                JSON.stringify(credentials.get("node")).should.equal(cache);
                credentials.dirty().should.be.false();
                credentials.getKeyType().should.equal(keyType);
                JSON.stringify(settingsValues).should.equal(settingsBefore);
                settingsSet.called.should.be.false();
                logCalls().should.equal(logBefore);
                // the same cache is exported as before
                return credentials.export().then(function(exported) {
                    exported.should.eql(CRYPTED);
                });
            });
        });
        it("does not generate or save a key (unlike load): no key yet - credentials_load_failed", function() {
            settingsValues = {};
            credentials.init(runtime);
            (function() { credentials.digest(CRYPTED) }).should.throw({ code: "credentials_load_failed" });
            settingsSet.called.should.be.false();
            settingsValues.should.eql({});
            should.not.exist(credentials.get("node"));
            credentials.dirty().should.be.false();
        });
        it("a wrong key: credentials_load_failed, a fixed message, nothing changed, nothing logged", function() {
            credentials.init(runtime);
            return credentials.load(CRYPTED).then(function() {
                var logBefore = logCalls();
                var wrong = encrypt("another key", JSON.stringify({"node":{"user1":"secret-user"}}));
                var error;
                try {
                    credentials.digest(wrong);
                } catch(err) {
                    error = err;
                }
                should.exist(error);
                error.should.have.property("code", "credentials_load_failed");
                error.should.have.property("message", "Failed to decrypt credentials");
                error.should.not.have.property("cause");
                // the cache of the running configuration is not cleared, the module is not dirty
                credentials.get("node").should.have.property("user1", "abc");
                credentials.dirty().should.be.false();
                logCalls().should.equal(logBefore);
            });
        });
        it("a corrupt value: credentials_load_failed without the content in the message", function() {
            credentials.init(runtime);
            return credentials.load(CRYPTED).then(function() {
                // decrypts, but is not JSON - the message of JSON.parse could quote the text
                var notJson = encrypt(USER_KEY, "not-json secret-value-0123456789");
                var error;
                try {
                    credentials.digest(notJson);
                } catch(err) {
                    error = err;
                }
                should.exist(error);
                error.should.have.property("code", "credentials_load_failed");
                error.message.should.equal("Failed to decrypt credentials");
                error.should.not.have.property("cause");
                JSON.stringify(error).should.not.containEql("secret-value");
                String(error.stack).should.not.containEql("secret-value");
                (function() { credentials.digest({"$":"zz"}) }).should.throw({ code: "credentials_load_failed" });
            });
        });
        describe("an unusual object of a storage plugin (SEC-004, #43)", function() {
            var SECRET = "secret-getter-0123456789";
            var cases = {
                "a getter that throws": function() {
                    return { "node": { get password1() { throw new Error("boom " + SECRET) } } };
                },
                "a Proxy whose get trap throws": function() {
                    return new Proxy({ "node": { "user1": "abc" } }, { get: function() { throw new Error("boom " + SECRET) } });
                },
                "a Proxy whose ownKeys trap throws": function() {
                    return new Proxy({ "node": { "user1": "abc" } }, { ownKeys: function() { throw new Error("boom " + SECRET) } });
                },
                "a Proxy whose getOwnPropertyDescriptor trap throws": function() {
                    return new Proxy({ "node": { "user1": "abc" } }, { getOwnPropertyDescriptor: function() { throw new Error("boom " + SECRET) } });
                }
            };
            Object.keys(cases).forEach(function(name) {
                it(name + ": credentials_digest_failed, a fixed message, no cause, nothing logged", function() {
                    credentials.init(runtime);
                    return credentials.load(CRYPTED).then(function() {
                        var logBefore = logCalls();
                        var error;
                        try {
                            credentials.digest(cases[name]());
                        } catch(err) {
                            error = err;
                        }
                        should.exist(error);
                        error.should.have.property("code", "credentials_digest_failed");
                        error.should.have.property("message", "Failed to compute the credentials digest");
                        error.should.not.have.property("cause");
                        JSON.stringify(error).should.not.containEql(SECRET);
                        String(error.stack).should.not.containEql(SECRET);
                        credentials.get("node").should.have.property("user1", "abc");
                        credentials.dirty().should.be.false();
                        logCalls().should.equal(logBefore);
                    });
                });
            });
        });
        it("encrypted credentials while the encryption is disabled: credentials_load_failed", function() {
            credentials.init({ log: logStub, settings: { get: function() { return false } } });
            return credentials.load({"a":{"b":1}}).then(function() {
                (function() { credentials.digest(CRYPTED) }).should.throw({ code: "credentials_load_failed" });
                credentials.get("a").should.have.property("b", 1);
            });
        });
        describe("key selection of load() (a pending migration)", function() {
            var DEFAULT_KEY = "e3a36f47f005bf2aaa51ce3fc6fcaafd79da8d03f2b1a9281f8fb0a285e6255a";
            var NEW_USER_KEY = "aaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbcccccccccccccddddddddddddeeeee";
            // {"node":{user1:"abc",password1:"123"}} encrypted with the DEFAULT key
            var OLD = CRYPTED;
            var PLAIN_DIGEST;

            beforeEach(function() {
                settingsValues = { _credentialSecret: DEFAULT_KEY, credentialSecret: NEW_USER_KEY };
                credentials.init(runtime);
                PLAIN_DIGEST = credentials.digest({"node":{"user1":"abc","password1":"123"}});
            });
            afterEach(function() {
                // A load() with a pending migration sets the module flag removeDefaultKey, which
                // init() does not reset and only export() clears. Finish the migration here (the
                // settings stub of this block is still the one of the module), so that the flag
                // does not leak to the tests that run later in the same process (they would get
                // "settings.not-available" from the export of a redeploy).
                return credentials.export();
            });

            it("during the migration the credentials still encrypted with the old key have a digest, nothing is changed", function() {
                return credentials.load(OLD).then(function() {
                    // load() migrates: dirty, the default key waits to be removed by the export
                    credentials.dirty().should.be.true();
                    var cache = JSON.stringify(credentials.get("node"));
                    var settingsBefore = JSON.stringify(settingsValues);
                    var logBefore = logCalls();
                    credentials.digest(OLD).should.equal(PLAIN_DIGEST);
                    credentials.digest(OLD).should.equal(PLAIN_DIGEST);
                    credentials.dirty().should.be.true();
                    JSON.stringify(credentials.get("node")).should.equal(cache);
                    JSON.stringify(settingsValues).should.equal(settingsBefore);
                    settingsValues.should.have.property("_credentialSecret", DEFAULT_KEY);
                    settingsSet.called.should.be.false();
                    logCalls().should.equal(logBefore);
                    // the migration is still done by the export, as without digest()
                    return credentials.export().then(function(result) {
                        result.should.have.property("$");
                        settingsValues.should.not.have.property("_credentialSecret");
                        credentials.digest(result).should.equal(PLAIN_DIGEST);
                    });
                });
            });
            it("before load() the same key is used (the instance did not read the credentials yet)", function() {
                credentials.digest(OLD).should.equal(PLAIN_DIGEST);
            });
            it("after the first save the digest is stable: the same content, the new key", function() {
                return credentials.load(OLD).then(function() {
                    return credentials.export();
                }).then(function(saved) {
                    // the default key is gone, the user key reads what was saved
                    credentials.digest(saved).should.equal(PLAIN_DIGEST);
                    // another save of the same content (a new iv) is the same digest
                    credentials.delete("nothing");
                    return credentials.export().then(function(again) {
                        again["$"].should.not.equal(saved["$"]);
                        credentials.digest(again).should.equal(PLAIN_DIGEST);
                    });
                });
            });
            it("the digest during the migration equals the digest after it (no reload caused by the migration)", function() {
                return credentials.load(OLD).then(function() {
                    var before = credentials.digest(OLD);
                    return credentials.export().then(function(saved) {
                        credentials.digest(saved).should.equal(before);
                    });
                });
            });
            it("only exactly {\"$\": ...} is read with the default key, as in load() (a second property: the user key)", function() {
                // load() decrypts with the default key only when the object has the one key "$";
                // with another property the normal decryption (the user key) applies
                var withDefault = Object.assign({ extra: 1 }, OLD);
                (function() { credentials.digest(withDefault) }).should.throw({ code: "credentials_load_failed" });
                var withUser = Object.assign({ extra: 1 }, encrypt(NEW_USER_KEY, JSON.stringify({"node":{"user1":"abc","password1":"123"}})));
                credentials.digest(withUser).should.equal(PLAIN_DIGEST);
                // the same as load() does with these objects
                return credentials.load(withDefault).then(function() {
                    throw new Error("load() should have failed");
                }, function(err) {
                    err.should.have.property("code", "credentials_load_failed");
                    credentials.init(runtime);
                    return credentials.load(withUser).then(function() {
                        credentials.get("node").should.have.property("user1", "abc");
                    });
                });
            });
            it("encryption disabled by the user: a second property is not migrated (no key), as in load()", function() {
                settingsValues = { _credentialSecret: DEFAULT_KEY, credentialSecret: false };
                credentials.init(runtime);
                (function() { credentials.digest(Object.assign({ extra: 1 }, OLD)) }).should.throw({ code: "credentials_load_failed" });
                credentials.digest(OLD).should.equal(PLAIN_DIGEST);
            });
            it("a truly wrong key still gives credentials_load_failed during the migration", function() {
                return credentials.load(OLD).then(function() {
                    var foreign = encrypt("a key that was never used", JSON.stringify({"node":{"user1":"abc"}}));
                    (function() { credentials.digest(foreign) }).should.throw({ code: "credentials_load_failed", message: "Failed to decrypt credentials" });
                    // not encrypted with the new user key either: load() does not try it with the default key present
                    var withUserKey = encrypt(NEW_USER_KEY, JSON.stringify({"node":{"user1":"abc"}}));
                    (function() { credentials.digest(withUserKey) }).should.throw({ code: "credentials_load_failed" });
                    credentials.dirty().should.be.true();
                    credentials.get("node").should.have.property("user1", "abc");
                });
            });
            it("migration to unencrypted (credentialSecret false, default key present): the old key reads them", function() {
                settingsValues = { _credentialSecret: DEFAULT_KEY, credentialSecret: false };
                credentials.init(runtime);
                return credentials.load(OLD).then(function() {
                    credentials.digest(OLD).should.equal(PLAIN_DIGEST);
                    credentials.digest({"node":{"user1":"abc","password1":"123"}}).should.equal(PLAIN_DIGEST);
                });
            });
            it("an active project: the key of the project", function() {
                var projectKey = "a project key";
                var projectRuntime = Object.assign({}, runtime, {
                    storage: { projects: { getActiveProject: function() { return { credentialSecret: projectKey } } } }
                });
                credentials.init(projectRuntime);
                var stored = encrypt(projectKey, JSON.stringify({"node":{"user1":"abc","password1":"123"}}));
                credentials.digest(stored).should.equal(PLAIN_DIGEST);
                (function() { credentials.digest(OLD) }).should.throw({ code: "credentials_load_failed" });
                // a project without a key: the credentials cannot be encrypted
                var noKey = Object.assign({}, runtime, {
                    storage: { projects: { getActiveProject: function() { return {} } } }
                });
                credentials.init(noKey);
                (function() { credentials.digest(stored) }).should.throw({ code: "credentials_load_failed" });
            });
            it("no user key, the default key is the key", function() {
                settingsValues = { _credentialSecret: DEFAULT_KEY };
                credentials.init(runtime);
                credentials.digest(OLD).should.equal(PLAIN_DIGEST);
            });
        });
        it("empty or missing credentials have a digest", function() {
            credentials.init(runtime);
            credentials.digest({}).should.equal(credentials.digest(undefined));
            credentials.digest(null).should.equal(credentials.digest({}));
        });
    });
})
