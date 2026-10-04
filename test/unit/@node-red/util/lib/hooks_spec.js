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
});
