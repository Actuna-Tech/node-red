const should = require("should");
const NR_TEST_UTILS = require("nr-test-utils");

const hooks = NR_TEST_UTILS.require("@node-red/util/lib/hooks");

describe("util/hooks", function() {
    afterEach(function() {
        hooks.clear();
    })
    it("allows a hook to be registered", function(done) {
        let calledWith = null;
        hooks.has("onSend").should.be.false();
        hooks.add("onSend", function(payload) { calledWith = payload } )
        hooks.has("onSend").should.be.true();
        let data = { a: 1 };
        hooks.trigger("onSend",data,err => {
            calledWith.should.equal(data);
            done(err);
        })
    })
    it("allows preShutdown hook", function() {
        hooks.add("preShutdown", function(payload) {});
        hooks.has("preShutdown").should.be.true();
    })
    it("allows preReload hook", function() {
        hooks.add("preReload", function(payload) {});
        hooks.has("preReload").should.be.true();
    })
    it("rejects invalid hook id", function(done) {
        try {
            hooks.add("foo", function(payload) {})
            done(new Error("Invalid hook accepted"))
        } catch(err) {
            done();
        }
    })
    it("calls hooks in the order they were registered", function(done) {
        hooks.add("onSend", function(payload) { payload.order.push("A") } )
        hooks.add("onSend", function(payload) { payload.order.push("B") } )
        let data = { order:[] };
        hooks.trigger("onSend",data,err => {
            data.order.should.eql(["A","B"])
            done(err);
        })
    })

    it("does not allow multiple hooks with same id.label", function() {
        hooks.has("onSend.one").should.be.false();
        hooks.has("onSend").should.be.false();
        hooks.add("onSend.one", function(payload) { payload.order.push("A") } );
        hooks.has("onSend.one").should.be.true();
        hooks.has("onSend").should.be.true();
        (function() {
            hooks.add("onSend.one", function(payload) { payload.order.push("B") } )
        }).should.throw();
    })

    it("removes labelled hook", function(done) {
        hooks.has("onSend.A").should.be.false();
        hooks.has("onSend.B").should.be.false();
        hooks.has("onSend").should.be.false();

        hooks.add("onSend.A", function(payload) { payload.order.push("A") } )

        hooks.has("onSend.A").should.be.true();
        hooks.has("onSend.B").should.be.false();
        hooks.has("onSend").should.be.true();

        hooks.add("onSend.B", function(payload) { payload.order.push("B") } )

        hooks.has("onSend.A").should.be.true();
        hooks.has("onSend.B").should.be.true();
        hooks.has("onSend").should.be.true();

        hooks.remove("onSend.A");

        hooks.has("onSend.A").should.be.false();
        hooks.has("onSend.B").should.be.true();
        hooks.has("onSend").should.be.true();


        let data = { order:[] };
        hooks.trigger("onSend",data,err => {
            try {
                data.order.should.eql(["B"])

                hooks.remove("onSend.B");

                hooks.has("onSend.A").should.be.false();
                hooks.has("onSend.B").should.be.false();
                hooks.has("onSend").should.be.false();

                done(err);
            } catch(err2) {
                done(err2);
            }
        })
    })

    it("cannot remove unlabelled hook", function() {
        hooks.add("onSend", function(payload) { payload.order.push("A") } );
        (function() {
            hooks.remove("onSend")
        }).should.throw();
    })
    it("removes all hooks with same label", function(done) {
        hooks.add("onSend.A", function(payload) { payload.order.push("A") } )
        hooks.add("onSend.B", function(payload) { payload.order.push("B") } )
        hooks.add("preRoute.A", function(payload) { payload.order.push("C") } )
        hooks.add("preRoute.B", function(payload) { payload.order.push("D") } )

        let data = { order:[] };
        hooks.trigger("onSend",data,err => {
            data.order.should.eql(["A","B"])
            hooks.trigger("preRoute", data, err => {
                data.order.should.eql(["A","B","C","D"])

                data.order = [];

                hooks.remove("*.A");

                hooks.trigger("onSend",data,err => {
                    data.order.should.eql(["B"])
                    hooks.trigger("preRoute", data, err => {
                        data.order.should.eql(["B","D"])
                    })
                    done(err);
                })
            })
        })
    })
    it("allows a hook to remove itself whilst being called", function(done) {
        let data = { order: [] }
        hooks.add("onSend.A", function(payload) { payload.order.push("A") } )
        hooks.add("onSend.B", function(payload) {
            hooks.remove("*.B");
        })
        hooks.add("onSend.C", function(payload) { payload.order.push("C") } )
        hooks.add("onSend.D", function(payload) { payload.order.push("D") } )

        hooks.trigger("onSend", data, err => {
            try {
                should.not.exist(err);
                data.order.should.eql(["A","C","D"])
                done();
            } catch(e) {
                done(e);
            }
        })
    });

    it("allows a hook to remove itself and others whilst being called", function(done) {
        let data = { order: [] }
        hooks.add("onSend.A", function(payload) { payload.order.push("A") } )
        hooks.add("onSend.B", function(payload) {
            hooks.remove("*.B");
            hooks.remove("*.C");
        })
        hooks.add("onSend.C", function(payload) { payload.order.push("C") } )
        hooks.add("onSend.D", function(payload) { payload.order.push("D") } )

        hooks.trigger("onSend", data, err => {
            try {
                should.not.exist(err);
                data.order.should.eql(["A","D"])
                done();
            } catch(e) {
                done(e);
            }
        })
    });

    it("halts execution on return false", function(done) {
        hooks.add("onSend.A", function(payload) { payload.order.push("A"); return false } )
        hooks.add("onSend.B", function(payload) { payload.order.push("B") } )

        let data = { order:[] };
        hooks.trigger("onSend",data,err => {
            data.order.should.eql(["A"])
            err.should.be.false();
            done();
        })
    })
    it("halts execution on thrown error", function(done) {
        hooks.add("onSend.A", function(payload) { payload.order.push("A"); throw new Error("error") } )
        hooks.add("onSend.B", function(payload) { payload.order.push("B") } )

        let data = { order:[] };
        hooks.trigger("onSend",data,err => {
            data.order.should.eql(["A"])
            should.exist(err);
            err.should.not.be.false()
            done();
        })
    })

    it("handler can use callback function", function(done) {
        hooks.add("onSend.A", function(payload, done) {
            setTimeout(function() {
                payload.order.push("A")
                done()
            },30)
        })
        hooks.add("onSend.B", function(payload) { payload.order.push("B") } )

        let data = { order:[] };
        hooks.trigger("onSend",data,err => {
            data.order.should.eql(["A","B"])
            done(err);
        })
    })

    it("handler can use callback function - halt execution", function(done) {
        hooks.add("onSend.A", function(payload, done) {
            setTimeout(function() {
                payload.order.push("A")
                done(false)
            },30)
        })
        hooks.add("onSend.B", function(payload) { payload.order.push("B") } )

        let data = { order:[] };
        hooks.trigger("onSend",data,err => {
            data.order.should.eql(["A"])
            err.should.be.false()
            done();
        })
    })
    it("handler can use callback function - halt on error", function(done) {
        hooks.add("onSend.A", function(payload, done) {
            setTimeout(function() {
                done(new Error("test error"))
            },30)
        })
        hooks.add("onSend.B", function(payload) { payload.order.push("B") } )

        let data = { order:[] };
        hooks.trigger("onSend",data,err => {
            data.order.should.eql([])
            should.exist(err);
            err.should.not.be.false()
            done();
        })
    })

    it("handler be an async function", function(done) {
        hooks.add("onSend.A", async function(payload) {
            return new Promise(resolve => {
                setTimeout(function() {
                    payload.order.push("A")
                    resolve()
                },30)
            });
        })
        hooks.add("onSend.B", function(payload) { payload.order.push("B") } )

        let data = { order:[] };
        hooks.trigger("onSend",data,err => {
            data.order.should.eql(["A","B"])
            done(err);
        })
    })

    it("handler be an async function - halt execution", function(done) {
        hooks.add("onSend.A", async function(payload) {
            return new Promise(resolve => {
                setTimeout(function() {
                    payload.order.push("A")
                    resolve(false)
                },30)
            });
        })
        hooks.add("onSend.B", function(payload) { payload.order.push("B") } )

        let data = { order:[] };
        hooks.trigger("onSend",data,err => {
            data.order.should.eql(["A"])
            done(err);
        })
    })
    it("handler be an async function - halt on error", function(done) {
        hooks.add("onSend.A", async function(payload) {
            return new Promise((resolve,reject) => {
                setTimeout(function() {
                    reject(new Error("test error"))
                },30)
            });
        })
        hooks.add("onSend.B", function(payload) { payload.order.push("B") } )

        let data = { order:[] };
        hooks.trigger("onSend",data,err => {
            data.order.should.eql([])
            should.exist(err);
            err.should.not.be.false()
            done();
        })
    })


    it("handler can use callback function - promise API", function(done) {
        hooks.add("onSend.A", function(payload, done) {
            setTimeout(function() {
                payload.order.push("A")
                done()
            },30)
        })
        hooks.add("onSend.B", function(payload) { payload.order.push("B") } )

        let data = { order:[] };
        hooks.trigger("onSend",data).then(() => {
            data.order.should.eql(["A","B"])
            done()
        }).catch(done)
    })

    it("handler can halt execution - promise API", function(done) {
        hooks.add("onSend.A", function(payload, done) {
            setTimeout(function() {
                payload.order.push("A")
                done(false)
            },30)
        })
        hooks.add("onSend.B", function(payload) { payload.order.push("B") } )

        let data = { order:[] };
        hooks.trigger("onSend",data).then(() => {
            data.order.should.eql(["A"])
            done()
        }).catch(done)
    })

    it("handler can halt execution on error - promise API", function(done) {
        hooks.add("onSend.A", function(payload, done) {
            throw new Error("error");
        })
        hooks.add("onSend.B", function(payload) { payload.order.push("B") } )

        let data = { order:[] };
        hooks.trigger("onSend",data).then(() => {
            done("hooks.trigger resolved unexpectedly")
        }).catch(err => {
            done();
        })
    })
    describe("addFromSettings (#7)", function() {
        function codeOf(setting) {
            try {
                hooks.addFromSettings(setting);
            } catch(err) {
                return err;
            }
            throw new Error("addFromSettings did not throw");
        }
        it("registers preReload and preShutdown hooks", function() {
            hooks.addFromSettings({
                "preReload.drain": function(event) {},
                "preShutdown.drain": function(event) {}
            });
            hooks.has("preReload").should.be.true();
            hooks.has("preReload.drain").should.be.true();
            hooks.has("preShutdown.drain").should.be.true();
        });
        it("accepts an empty object", function() {
            hooks.addFromSettings({});
            hooks.has("preReload").should.be.false();
        });
        it("rejects a hook name that is not allowed, naming the key", function() {
            ["onSend.x", "preDeploy.x", "unknown.x", "x"].forEach(key => {
                const err = codeOf({[key]: function(event) {}});
                err.should.have.property("code", "invalid_hook_setting");
                err.message.should.containEql("'"+key+"'");
            });
            hooks.has("onSend").should.be.false();
        });
        it("rejects a missing or empty label", function() {
            ["preReload", "preReload.", "preReload.  "].forEach(key => {
                const err = codeOf({[key]: function(event) {}});
                err.should.have.property("code", "invalid_hook_setting");
                err.message.should.containEql("label");
                err.message.should.containEql("'"+key+"'");
            });
            hooks.has("preReload").should.be.false();
        });
        it("rejects a label with a dot", function() {
            const err = codeOf({"preReload.a.b": function(event) {}});
            err.should.have.property("code", "invalid_hook_setting");
            err.message.should.containEql("preReload.a.b");
        });
        it("rejects a label that could reach Object.prototype", function() {
            ["__proto__", "constructor", "a b", "x/y"].forEach(label => {
                const err = codeOf({["preReload." + label]: function(event) {}});
                err.should.have.property("code", "invalid_hook_setting");
            });
            should.not.exist(({}).preReload);
            hooks.has("preReload").should.be.false();
        });
        it("rejects a value that is not a function", function() {
            [undefined, null, "x", 1, {}, []].forEach(value => {
                const err = codeOf({"preShutdown.drain": value});
                err.should.have.property("code", "invalid_hook_setting");
                err.message.should.containEql("preShutdown.drain");
                err.message.should.containEql("function");
            });
            hooks.has("preShutdown").should.be.false();
        });
        it("rejects a setting that is not an object", function() {
            [undefined, null, "preReload.x", 1, true, [], function() {}].forEach(setting => {
                codeOf(setting).should.have.property("code", "invalid_hook_setting");
            });
        });
        it("registers nothing when any key is invalid", function() {
            const err = codeOf({
                "preReload.drain": function(event) {},
                "preShutdown.drain": "not a function"
            });
            err.message.should.containEql("preShutdown.drain");
            hooks.has("preReload").should.be.false();
            hooks.has("preShutdown").should.be.false();
        });
        it("replaces the hooks of a previous call without throwing", function(done) {
            const calls = [];
            hooks.addFromSettings({
                "preReload.drain": function(event) { calls.push("first") },
                "preShutdown.drain": function(event) { calls.push("old-shutdown") }
            });
            (function() {
                hooks.addFromSettings({"preReload.drain": function(event) { calls.push("second") }});
            }).should.not.throw();
            hooks.has("preShutdown").should.be.false();
            hooks.trigger("preReload", {}).then(() => {
                calls.should.eql(["second"]);
                done();
            }).catch(done);
        });
        it("keeps the previous settings hooks when the new setting is invalid", function() {
            hooks.addFromSettings({"preReload.drain": function(event) {}});
            codeOf({"preReload.other": "x"});
            hooks.has("preReload.drain").should.be.true();
            hooks.has("preReload.other").should.be.false();
        });
        it("rejects a label already registered by a plugin and registers nothing", function() {
            hooks.add("preReload.drain", function(event) {});
            const err = codeOf({
                "preShutdown.other": function(event) {},
                "preReload.drain": function(event) {}
            });
            err.should.have.property("code", "invalid_hook_setting");
            err.message.should.containEql("preReload.drain");
            err.message.should.containEql("already registered");
            hooks.has("preShutdown").should.be.false();
        });
        it("a plugin hook with the same label is rejected after the settings hook", function() {
            hooks.addFromSettings({"preReload.drain": function(event) {}});
            (function() {
                hooks.add("preReload.drain", function(event) {});
            }).should.throw(/already registered/);
        });
        it("does not remove a plugin hook when the settings hooks are removed", function() {
            hooks.addFromSettings({"preReload.drain": function(event) {}});
            hooks.add("preShutdown.plugin", function(event) {});
            hooks.removeFromSettings();
            hooks.has("preReload").should.be.false();
            hooks.has("preShutdown.plugin").should.be.true();
        });
        it("runs the settings hook before a plugin hook of the same name", function(done) {
            const order = [];
            hooks.addFromSettings({"preReload.drain": function(event) { order.push("settings") }});
            hooks.add("preReload.plugin", function(event) { order.push("plugin") });
            hooks.trigger("preReload", {}).then(() => {
                order.should.eql(["settings", "plugin"]);
                done();
            }).catch(done);
        });
        it("awaits a hook with one parameter that returns a promise", function(done) {
            let finished = false;
            hooks.addFromSettings({"preShutdown.drain": async function(event) {
                await new Promise(resolve => setTimeout(resolve, 30));
                finished = true;
            }});
            hooks.trigger("preShutdown", {reason: "test"}).then(() => {
                finished.should.be.true();
                done();
            }).catch(done);
        });
        it("passes the payload and a returned value other than undefined stops the next hooks", function(done) {
            let payload;
            let secondCalled = false;
            hooks.addFromSettings({
                "preReload.a": function(event) { payload = event; return false; },
                "preReload.b": function(event) { secondCalled = true; }
            });
            const data = {rev: "1"};
            hooks.trigger("preReload", data).then(() => {
                payload.should.equal(data);
                secondCalled.should.be.false();
                done();
            }).catch(done);
        });
    })

    describe("preDeploy and postDeploy, handlers() (Z-06)", function() {
        it("allows preDeploy and postDeploy", function() {
            hooks.has("preDeploy").should.be.false();
            hooks.has("postDeploy").should.be.false();
            hooks.add("preDeploy.a", function(event) {});
            hooks.add("postDeploy.a", function(event) {});
            hooks.has("preDeploy").should.be.true();
            hooks.has("postDeploy").should.be.true();
            hooks.has("preDeploy.a").should.be.true();
            hooks.remove("preDeploy.a");
            hooks.has("preDeploy").should.be.false();
        });
        it("still rejects an unknown hook name", function() {
            (function() { hooks.add("preDeployed.x", function() {}) }).should.throw("Invalid hook 'preDeployed'");
            (function() { hooks.add("deploy", function() {}) }).should.throw("Invalid hook 'deploy'");
        });
        it("handlers() lists the handlers in the order of registration with id, location and cb", function() {
            const a = function(event) {};
            const b = function(event, done) {};
            const c = function(event) {};
            hooks.add("preDeploy.first", a);
            hooks.add("preDeploy", b);
            hooks.add("preDeploy.third", c);
            hooks.add("postDeploy.other", function() {});
            const list = hooks.handlers("preDeploy");
            list.map(h => h.id).should.eql(["preDeploy.first", "preDeploy", "preDeploy.third"]);
            list.map(h => h.cb).should.eql([a, b, c]);
            list[0].location.should.match(/hooks_spec\.js/);
            hooks.handlers("postDeploy").map(h => h.id).should.eql(["postDeploy.other"]);
        });
        it("handlers() of a hook without handlers (and of an unknown name) is an empty list", function() {
            hooks.handlers("preDeploy").should.eql([]);
            hooks.handlers("nothing").should.eql([]);
        });
        it("handlers() omits removed handlers; the snapshot tells with isRemoved() when one is removed later", function() {
            hooks.add("preDeploy.a", function() {});
            hooks.add("preDeploy.b", function() {});
            hooks.add("preDeploy.c", function() {});
            hooks.remove("preDeploy.b");
            hooks.handlers("preDeploy").map(h => h.id).should.eql(["preDeploy.a", "preDeploy.c"]);
            const snapshot = hooks.handlers("preDeploy");
            snapshot.map(h => h.isRemoved()).should.eql([false, false]);
            hooks.remove("preDeploy.a");
            snapshot.map(h => h.isRemoved()).should.eql([true, false]);
            hooks.handlers("preDeploy").map(h => h.id).should.eql(["preDeploy.c"]);
        });
        it("handlers() is a snapshot: a handler added later is not in it (unlike the chain of trigger)", function() {
            hooks.add("preDeploy.a", function() {});
            const snapshot = hooks.handlers("preDeploy");
            hooks.add("preDeploy.b", function() {});
            snapshot.should.have.length(1);
            hooks.handlers("preDeploy").should.have.length(2);
        });
        it("the object of a handler is stable for the registration; a handler added again under the same label is a new object", function() {
            const fn = function() {};
            hooks.add("preDeploy.a", fn);
            const first = hooks.handlers("preDeploy")[0];
            hooks.handlers("preDeploy")[0].should.equal(first);
            hooks.remove("preDeploy.a");
            hooks.add("preDeploy.a", fn);
            const second = hooks.handlers("preDeploy")[0];
            second.should.not.equal(first);
            first.isRemoved().should.be.true();
            second.isRemoved().should.be.false();
            Object.isFrozen(second).should.be.true();
        });
        it("clear() does not mark the handlers as removed (documented)", function() {
            hooks.add("preDeploy.a", function() {});
            const snapshot = hooks.handlers("preDeploy");
            hooks.clear();
            hooks.handlers("preDeploy").should.eql([]);
            snapshot[0].isRemoved().should.be.false();
        });
        it("handlers is not enumerable: it is not listed with the other functions of RED.hooks", function() {
            Object.keys(hooks).should.not.containEql("handlers");
            Object.keys(hooks).sort().should.eql(["add","addFromSettings","clear","has","remove","removeFromSettings","trigger"]);
            hooks.should.have.property("handlers");
            Object.getOwnPropertyDescriptor(hooks, "handlers").enumerable.should.be.false();
        });
        it("addFromSettings still rejects preDeploy and postDeploy (P4: only RED.hooks.add registers them)", function() {
            ["preDeploy.x", "postDeploy.x"].forEach(function(key) {
                let error;
                try {
                    hooks.addFromSettings({[key]: function() {}});
                } catch(err) {
                    error = err;
                }
                should.exist(error);
                error.should.have.property("code", "invalid_hook_setting");
                error.message.should.containEql("only preReload and preShutdown can be set");
            });
            hooks.has("preDeploy").should.be.false();
        });
        it("regression: trigger of preReload still halts on a promise resolved with true", function(done) {
            hooks.add("preReload.a", function(event) { return Promise.resolve(true) });
            hooks.trigger("preReload", {}).then(() => done(new Error("resolved")), err => {
                err.should.be.an.Error();
                err.message.should.equal("true");
                done();
            }).catch(done);
        });
        it("regression: trigger of onSend still halts on a thrown error", function(done) {
            const order = [];
            hooks.add("onSend.a", function(event) { order.push("a"); throw new Error("stop") });
            hooks.add("onSend.b", function(event) { order.push("b") });
            hooks.trigger("onSend", {}).then(() => done(new Error("resolved")), err => {
                err.message.should.equal("stop");
                order.should.eql(["a"]);
                done();
            }).catch(done);
        });
        it("trigger of preDeploy behaves as for any other hook (the semantics of the deploy hooks are in the runtime, deployHooks.js)", function(done) {
            const order = [];
            hooks.add("preDeploy.a", function(event) { order.push("a"); return false });
            hooks.add("preDeploy.b", function(event) { order.push("b") });
            hooks.trigger("preDeploy", {}).then(result => {
                should(result).equal(false);
                order.should.eql(["a"]);
                done();
            }).catch(done);
        });
    });
});
