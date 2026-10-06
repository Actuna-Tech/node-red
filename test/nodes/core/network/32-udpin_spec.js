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
 *   #41: no fixed port - every test uses a free UDP port found before the node starts
 *   (two test runs on one machine do not collide)
 *   #54: acceptance tests of a port that is taken before the node binds (flaky tests)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var dgram = require("dgram");
var should = require("should");
var helper = require("node-red-node-test-helper");
var udpNode = require("nr-test-utils").require("@node-red/nodes/core/network/32-udp.js");


describe('UDP in Node', function() {
    // A free UDP port of the given type (udp4 or udp6): the "udp in" node binds the port
    // given in its configuration, so it is known only before the node starts.
    // Not checked: a foreign UDP socket on 127.0.0.1 that shares the port (the node binds with
    // reuseAddr: true, so on macOS it can coexist with such a socket); only the port that the
    // system gives for a plain bind is used.
    function getFreePort(proto, done) {
        var probe = dgram.createSocket(proto);
        probe.once("error", done);
        probe.bind(0, function() {
            var freePort = probe.address().port;
            probe.close(function() {
                done(null, freePort);
            });
        });
    }

    // where the free ports come from: getFreePort(proto, done) (#54: a test can offer ports that are taken)
    var portSource = getFreePort;

    before(function(done) {
        helper.startServer(done);
    });

    beforeEach(function() {
        portSource = getFreePort;
    });

    after(function(done) {
        helper.stopServer(done);
    });

    afterEach(function() {
        helper.unload();
    });

    function sendIPv4(msg, port) {
        var sock = dgram.createSocket('udp4');
        sock.send(msg, 0, msg.length, port, "127.0.0.1", function(msg) {
            sock.close();
        });
    }

    // The port is found before the node starts, so another program can take it before the node binds (#54).
    // The node reports a failed bind as an error ("udp.errors.error"; the only way a bind fails here is a port
    // in use) and logs once it listens: the test starts again on the next port until the node listens, for 10
    // ports in all.
    // Why a port cannot be bound, for the message of a failed retry: the error that the node logged (the test
    // runtime logs the message key only, without the error) and the code that a bind of the test on the same
    // port gets, with the options of the node (EADDRINUSE when the port is taken)
    function bindOutcome(proto, port) {
        return new Promise(function(resolve) {
            const probe = dgram.createSocket({type: proto, reuseAddr: true});
            probe.once("error", function(err) { probe.close(); resolve(err.code || String(err)) });
            probe.bind(port, function() { probe.close(function() { resolve("no error") }) });
        });
    }

    var UDP_PORTS = 10;
    function checkRecv(dt, proto, val0, val1, done) {
        (function attempt(n) {
            portSource(proto, function(err, port) {
                if (err) { return done(err); }
                checkRecvOnPort(port, dt, proto, val0, val1, done, function taken(logged) {
                    if (n >= UDP_PORTS) {
                        return bindOutcome(proto, port).then(function(outcome) {
                            done(new Error("udp in did not bind any of " + UDP_PORTS + " ports, the last one was " + port +
                                ": the node logged " + logged + ", a bind of the test on that port gets " + outcome));
                        });
                    }
                    attempt(n + 1);
                });
            });
        })(1);
    }

    // taken(logged) is called, after the unload of the flow, when the node could not bind the port; logged is the
    // error that the node logged, in quotes
    function checkRecvOnPort(port, dt, proto, val0, val1, done, taken) {
        var flow = [{id:"n1", type:"udp in",
                     group: "", multicast:false,
                     port:port, ipv:proto,
                     datatype: dt, iface: "",
                     wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        helper.load(udpNode, flow, function() {
            var n1 = helper.getNode("n1");
            var n2 = helper.getNode("n2");
            var settled = false;
            function listening() {
                n2.on("input", function(msg) {
                    try {
                        var ip = ((proto === 'udp6') ? '::ffff:':'') +'127.0.0.1';
                        msg.should.have.property('ip', ip);
                        msg.should.have.property('port');
                        msg.should.have.property('payload');
                        msg.payload.should.deepEqual(val1);
                        done();
                    } catch(err) {
                        done(err);
                    }
                });
                sendIPv4(val0, port);
            }
            n1.on("call:log", function() {
                if (!settled) {
                    settled = true;
                    listening();
                }
            });
            n1.on("call:error", function(call) {
                if (settled) {
                    return;
                }
                settled = true;
                const logged = JSON.stringify(String(call.args[0]));
                Promise.resolve(helper.unload()).then(function() { taken(logged) }, done);
            });
        });
    }

    it('should recv IPv4 data (Buffer)', function(done) {
        checkRecv('buffer', 'udp4', 'hello', Buffer('hello'), done);
    });

    it('should recv IPv4 data (String)', function(done) {
        checkRecv('utf8', 'udp4', 'hello', 'hello', done);
    });

    it('should recv IPv4 data (base64)', function(done) {
        checkRecv('base64', 'udp4', 'hello', Buffer('hello').toString('base64'), done);
    });

    it('should recv IPv6 data (Buffer)', function(done) {
        checkRecv('buffer', 'udp6', 'hello', Buffer('hello'), done);
    });

    it('should recv IPv6 data (String)', function(done) {
        checkRecv('utf8', 'udp6', 'hello', 'hello', done);
    });

    it('should recv IPv6 data (base64)', function(done) {
        checkRecv('base64', 'udp6', 'hello', Buffer('hello').toString('base64'), done);
    });

    // #54: a port that is taken, without reuseAddr and on all interfaces, before the node binds
    describe('a port that is taken before the node binds (#54)', function() {
        let holders;

        beforeEach(function() {
            holders = [];
        });

        afterEach(async function() {
            for (const holder of holders) {
                await new Promise(function(resolve) { holder.close(resolve) });
            }
        });

        function holdPort() {
            return new Promise(function(resolve, reject) {
                const holder = dgram.createSocket({type: "udp4", reuseAddr: false});
                holder.once("error", reject);
                holder.bind(0, function() {
                    holders.push(holder);
                    resolve(holder.address().port);
                });
            });
        }

        // The ports the source gives, in this order (the last one again when they are used up)
        function offer(ports) {
            const handedOut = [];
            portSource = function(proto, done) {
                const next = ports[Math.min(handedOut.length, ports.length - 1)];
                handedOut.push(next);
                done(null, next);
            };
            return handedOut;
        }

        function text(err) {
            return [err.message].concat((err.errors || []).map(function(e) { return e.message })).join(" ");
        }

        it('AC-18: a taken port is replaced by another one', function(done) {
            holdPort().then(function(taken) {
                return new Promise(function(resolve, reject) {
                    getFreePort("udp4", function(err, free) { err ? reject(err) : resolve([taken, free]) });
                });
            }).then(function(ports) {
                const handedOut = offer(ports);
                checkRecv('buffer', 'udp4', 'hello', Buffer('hello'), function(err) {
                    try {
                        should.not.exist(err);
                        handedOut.should.eql(ports);
                        done();
                    } catch(e) {
                        done(e);
                    }
                });
            }).catch(done);
        });

        it('AC-18: when every port is taken the test fails with an error that names the last port', function(done) {
            const taken = [];
            (function hold(n) {
                if (n === 0) {
                    return start();
                }
                holdPort().then(function(port) { taken.push(port); hold(n - 1) }, done);
            })(12);
            function start() {
                const handedOut = offer(taken);
                checkRecv('buffer', 'udp4', 'hello', Buffer('hello'), function(err) {
                    try {
                        should.exist(err);
                        handedOut.should.have.length(10);
                        text(err).should.containEql("EADDRINUSE");
                        text(err).should.containEql(String(handedOut[handedOut.length - 1]));
                        done();
                    } catch(e) {
                        done(e);
                    }
                });
            }
        });
    });

});
