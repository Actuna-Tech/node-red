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
 *   #19: the test server hook calls done exactly once, retries on a taken port and answers with one ACK per connection, whatever the split of the chunks (flaky tests)
 *   #41: the test server listens on a port assigned by the system (port 0), no fixed port
 *   #54: acceptance tests of the "sit" mode with an answer that arrives in two chunks (flaky tests)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var net = require("net");
var should = require("should");
var stoppable = require('stoppable');
var helper = require("node-red-node-test-helper");
var tcpinNode = require("nr-test-utils").require("@node-red/nodes/core/network/31-tcpin.js");
var RED = require("nr-test-utils").require("node-red/lib/red.js");


describe('TCP Request Node', function() {
    var server = undefined;
    // the port assigned by the system once the server listens (#41)
    var port = undefined;

    // Starts the test server on a port assigned by the system (port 0, so two runs of
    // the tests on one machine never meet on a port) and calls done exactly once:
    // without an error when it listens, with the error when listening fails.
    function startServer(done) {
        const candidate = stoppable(net.createServer(function(c) {
            // "ACK:" starts the answer of a connection once. The messages of a test arrive
            // in one or more chunks, depending on the timing of the sockets; a prefix on
            // every chunk would make the answer depend on that split.
            let acknowledged = false;
            c.on('data', function(data) {
                var rdata = (acknowledged ? "" : "ACK:")+data.toString();
                acknowledged = true;
                c.write(rdata);
            });
            c.on('error', function(err) {
                // The client side of a connection was reset or closed while the
                // test shuts it down. It ends this connection only; the server and
                // the hook must not be started again here.
                c.destroy();
            });
        }));
        candidate.once('error', done);
        candidate.listen(0, "127.0.0.1", function() {
            candidate.removeAllListeners('error');
            server = candidate;
            port = candidate.address().port;
            done();
        });
    }

    before(function(done) {
        startServer(done);
    });

    after(function(done) {
        server.stop(done);
    });

    afterEach(function() {
        helper.unload();
    });

    function testTCP(flow, val0, val1, done) {
        helper.load(tcpinNode, flow, function() {
            var n1 = helper.getNode("n1");
            var n2 = helper.getNode("n2");
            n2.on("input", function(msg) {
                try {
                    if (typeof val1 === 'object') {
                        msg.should.have.properties(Object.assign({}, val1, {payload: Buffer.from(val1.payload)}));
                    } else {
                        msg.should.have.property('payload', Buffer.from(val1));
                    }
                    done();
                } catch(err) {
                    done(err);
                }
            });
            if((typeof val0) === 'object') {
                n1.receive(val0);
            } else {
                n1.receive({payload:val0});
            }
        });
    }

    function testTCPMany(flow, values, result, done) {
        helper.load(tcpinNode, flow, () => {
            const n1 = helper.getNode("n1");
            const n2 = helper.getNode("n2");
            n2.on("input", msg => {
                try {
                    if (typeof result === 'object') {
                        if (flow[0].ret === "string") {
                            msg.should.have.properties(Object.assign({}, result, {payload: result.payload}));
                        } else {
                            msg.should.have.properties(Object.assign({}, result, {payload: Buffer.from(result.payload)}));
                        }
                    } else {
                        if (flow[0].ret === "string") {
                            msg.should.have.property('payload', result);
                        } else {
                            msg.should.have.property('payload', Buffer.from(result));
                        }
                    }
                    done();
                } catch(err) {
                    done(err);
                }
            });
            values.forEach(value => {
                n1.receive(typeof value === 'object' ? value : {payload: value});
            });
        });
    }

    describe('single message', function () {
        it('should send & recv data', function(done) {
            var flow = [{id:"n1", type:"tcp request", server:"localhost", port:port, out:"time", splitc: "0", wires:[["n2"]] },
            {id:"n2", type:"helper"}];
            testTCP(flow, {
                payload: 'foo',
                topic: 'bar'
            }, {
                payload: 'ACK:foo',
                topic: 'bar'
            }, done);
        });

        it('should retain complete message', function(done) {
            var flow = [{id:"n1", type:"tcp request", server:"localhost", port:port, out:"time", splitc: "0", wires:[["n2"]] },
            {id:"n2", type:"helper"}];
            testTCP(flow, {
                payload: 'foo',
                topic: 'bar'
            }, {
                payload: 'ACK:foo',
                topic: 'bar'
            }, done);
        });

        it('should send & recv data when specified character received', function(done) {
            var flow = [{id:"n1", type:"tcp request", server:"localhost", port:port, out:"char", splitc: "0", wires:[["n2"]] },
            {id:"n2", type:"helper"}];
            testTCP(flow, {
                payload: 'foo0bar0',
                topic: 'bar'
            }, {
                payload: 'ACK:foo0',
                topic: 'bar'
            }, done);
        });

        it('should send & recv data after fixed number of chars received', function(done) {
            var flow = [{id:"n1", type:"tcp request", server:"localhost", port:port, out:"count", splitc: "7", wires:[["n2"]] },
            {id:"n2", type:"helper"}];
            testTCP(flow, {
                payload: 'foo bar',
                topic: 'bar'
            }, {
                payload: 'ACK:foo',
                topic: 'bar'
            }, done);
        });

        it('should send & receive, then keep connection', function(done) {
            var flow = [{id:"n1", type:"tcp request", server:"localhost", port:port, out:"sit", splitc: "5", wires:[["n2"]] },
            {id:"n2", type:"helper"}];
            testTCP(flow, {
                payload: 'foo',
                topic: 'bar'
            }, {
                payload: 'ACK:foo',
                topic: 'bar'
            }, done);
        });

        it('should send & recv data to/from server:port from msg', function(done) {
            var flow = [{id:"n1", type:"tcp request", server:"", port:"", out:"time", splitc: "0", wires:[["n2"]] },
            {id:"n2", type:"helper"}];
            testTCP(flow, {
                payload: "foo",
                host: "localhost",
                port: port
            }, {
                payload: "ACK:foo",
                host: 'localhost',
                port: port
            }, done);
        });
    });

    describe('many messages', function () {
        it('should send & recv data', function(done) {
            var flow = [{id:"n1", type:"tcp request", server:"localhost", port:port, out:"time", splitc: "0", wires:[["n2"]] },
                        {id:"n2", type:"helper"}];
            testTCPMany(flow, [{
                payload: 'f',
                topic: 'bar'
            }, {
                payload: 'o',
                topic: 'bar'
            }, {
                payload: 'o',
                topic: 'bar'
            }], {
                payload: 'ACK:foo',
                topic: 'bar'
            }, done);
        });

        it('should send & recv data when specified character received', function(done) {
            var flow = [{id:"n1", type:"tcp request", server:"localhost", port:port, out:"char", splitc: "0", wires:[["n2"]] },
                        {id:"n2", type:"helper"}];
            testTCPMany(flow, [{
                payload: "foo0",
                topic: 'bar'
            }, {
                payload: "bar0",
                topic: 'bar'
            }], {
                payload: "ACK:foo0",
                topic: 'bar'
            }, done);
        });

        it('should send & recv data after fixed number of chars received', function(done) {
            var flow = [{id:"n1", type:"tcp request", server:"localhost", port:port, out:"count", splitc: "7", wires:[["n2"]] },
                        {id:"n2", type:"helper"}];
            testTCPMany(flow, [{
                payload: "fo",
                topic: 'bar'
            }, {
                payload: "ob",
                topic: 'bar'
            }, {
                payload: "ar",
                topic: 'bar'
            }], {
                payload: "ACK:foo",
                topic: 'bar'
            }, done);
        });

        it('should send & receive, then keep connection', function(done) {
            var flow = [{id:"n1", type:"tcp request", server:"localhost", port:port, out:"sit", splitc: "5", wires:[["n2"]] },
                        {id:"n2", type:"helper"}];
            testTCPMany(flow, [{
                payload: "foo",
                topic: 'bar'
            }, {
                payload: "bar",
                topic: 'bar'
            }, {
                payload: "baz",
                topic: 'bar'
            }], {
                payload: "ACK:foobarbaz",
                topic: 'bar'
            }, done);
        });

        it('should send & receive, then keep connection, and not split return strings', function(done) {
            var flow = [{id:"n1", type:"tcp request", server:"localhost", port:port, out:"sit", ret:"string", newline:"", wires:[["n2"]] },
                        {id:"n2", type:"helper"}];
            testTCPMany(flow, [{
                payload: "foo",
                topic: 'boo'
            }, {
                payload: "bar<A>\nfoo",
                topic: 'boo'
            }], {
                payload: "ACK:foobar<A>\nfoo",
                topic: 'boo'
            }, done);
        });

        it('should send & receive, then keep connection, and split return strings', function(done) {
            var flow = [{id:"n1", type:"tcp request", server:"localhost", port:port, out:"sit", ret:"string", newline:"<A>\\n", wires:[["n2"]] },
                        {id:"n2", type:"helper"}];
            testTCPMany(flow, [{
                payload: "foo",
                topic: 'boo'
            }, {
                payload: "bar<A>\nfoo",
                topic: 'boo'
            }], {
                payload: "ACK:foobar",
                topic: 'boo'
            }, done);
        });

        it('should send & receive, then keep connection, and split return strings and reattach delimiter', function(done) {
            var flow = [{id:"n1", type:"tcp request", server:"localhost", port:port, out:"sit", ret:"string", newline:"<A>\\n", trim:true, wires:[["n2"]] },
                        {id:"n2", type:"helper"}];
            testTCPMany(flow, [{
                payload: "foo",
                topic: 'boo'
            }, {
                payload: "bar<A>\nfoo",
                topic: 'boo'
            }], {
                payload: "ACK:foobar<A>\n",
                topic: 'boo'
            }, done);
        });

        it('should send & recv data to/from server:port from msg', function(done) {
            var flow = [{id:"n1", type:"tcp request", server:"", port:"", out:"time", splitc: "0", wires:[["n2"]] },
                        {id:"n2", type:"helper"}];
            testTCPMany(flow, [
                {
                    payload: "f",
                    host: "localhost",
                    port: port
                },
                {
                    payload: "o",
                    host: "localhost",
                    port: port
                },
                {
                    payload: "o",
                    host: "localhost",
                    port: port
                }
            ], {
                payload: "ACK:foo",
                host: 'localhost',
                port: port
            }, done);
        });

        it('should limit the queue size', function (done) {
            RED.settings.tcpMsgQueueSize = 10;
            var flow = [{id:"n1", type:"tcp request", server:"localhost", port:port, out:"sit", splitc: "5", wires:[["n2"]] },
                        {id:"n2", type:"helper"}];
            // create one more msg than is allowed
            const msgs = new Array(RED.settings.tcpMsgQueueSize + 1).fill('x');
            const expected = msgs.slice(0, -1);
            testTCPMany(flow, msgs, "ACK:" + expected.join(''), done);
        });

        it('should only retain the latest message', function(done) {
            var flow = [{id:"n1", type:"tcp request", server:"localhost", port:port, out:"time", splitc: "0", wires:[["n2"]] },
                        {id:"n2", type:"helper"}];
            testTCPMany(flow, [{
                payload: 'f',
                topic: 'bar'
            }, {
                payload: 'o',
                topic: 'baz'
            }, {
                payload: 'o',
                topic: 'quux'
            }], {
                payload: 'ACK:foo',
                topic: 'quux'
            }, done);
        });
    });
    // #54: the answer of a connection arrives in more than one chunk
    describe('the answer arrives in two chunks (#54)', function () {
        // The pause between two writes of the server: the client reads them one by one
        const PAUSE = 25;
        let splitServer = undefined;
        let splitPort = undefined;

        // A server that answers a connection in separate writes, with "ACK:" once at the start.
        // surplus: the answer gets one more character at its end.
        // The first write holds the "ACK:" and the first `firstLength` bytes of what the server
        // receives; whatever follows (in the same chunk or in the next ones) goes in writes of its own,
        // each one PAUSE ms after the previous one has been written out.
        function listenSplit(firstLength, surplus, done) {
            const candidate = stoppable(net.createServer(function(c) {
                c.setNoDelay(true);
                let acknowledged = false;
                const queue = [];
                let writing = false;
                function pump() {
                    if (queue.length === 0) {
                        writing = false;
                        return;
                    }
                    writing = true;
                    c.write(queue.shift(), function() { setTimeout(pump, PAUSE) });
                }
                function enqueue(text) {
                    if (text.length === 0) {
                        return;
                    }
                    queue.push(text);
                    if (!writing) {
                        pump();
                    }
                }
                c.on('data', function(data) {
                    let text = data.toString();
                    if (!acknowledged) {
                        acknowledged = true;
                        enqueue("ACK:" + text.slice(0, firstLength));
                        text = text.slice(firstLength);
                    }
                    enqueue(text + (surplus ? "X" : ""));
                });
                c.on('error', function() { c.destroy() });
            }));
            candidate.once('error', done);
            candidate.listen(0, "127.0.0.1", function() {
                candidate.removeAllListeners('error');
                splitServer = candidate;
                splitPort = candidate.address().port;
                done();
            });
        }

        function stopSplitServer(done) {
            splitServer.stop(done);
        }

        // The messages of a connection in "sit" mode are one per chunk; the payloads joined are compared
        function sitFlow(extra) {
            return [Object.assign({id:"n1", type:"tcp request", server:"localhost", port:splitPort, out:"sit", wires:[["n2"]] }, extra),
                    {id:"n2", type:"helper"}];
        }

        describe('with a first chunk of 3 bytes', function () {
            before(function(done) { listenSplit(3, false, done) });
            after(function(done) { stopSplitServer(done) });

            it('AC-1: should send & receive, then keep connection, and not split return strings', function(done) {
                testTCPMany(sitFlow({ret:"string", newline:""}), [{
                    payload: "foo",
                    topic: 'boo'
                }, {
                    payload: "bar<A>\nfoo",
                    topic: 'boo'
                }], {
                    payload: "ACK:foobar<A>\nfoo",
                    topic: 'boo'
                }, done);
            });

            it('AC-2: should limit the queue size', function (done) {
                RED.settings.tcpMsgQueueSize = 10;
                const msgs = new Array(RED.settings.tcpMsgQueueSize + 1).fill('x');
                const expected = msgs.slice(0, -1);
                testTCPMany(sitFlow({splitc: "5"}), msgs, "ACK:" + expected.join(''), done);
            });

            it('AC-3: should send & receive, then keep connection', function(done) {
                testTCPMany(sitFlow({splitc: "5"}), [{
                    payload: "foo",
                    topic: 'bar'
                }, {
                    payload: "bar",
                    topic: 'bar'
                }, {
                    payload: "baz",
                    topic: 'bar'
                }], {
                    payload: "ACK:foobarbaz",
                    topic: 'bar'
                }, done);
            });

            it('AC-5: the node passes on one message per chunk it receives', function(done) {
                const flow = sitFlow({ret:"string", newline:""});
                const seen = [];
                helper.load(tcpinNode, flow, function() {
                    const n1 = helper.getNode("n1");
                    const n2 = helper.getNode("n2");
                    n2.on("input", function(msg) {
                        seen.push(msg.payload);
                        if (seen.length === 2) {
                            // nothing more arrives after the second one
                            setTimeout(function() {
                                try {
                                    seen.should.eql(["ACK:foo", "bar<A>\nfoo"]);
                                    done();
                                } catch(err) {
                                    done(err);
                                }
                            }, 4 * PAUSE);
                        }
                    });
                    n1.receive({payload: "foo", topic: 'boo'});
                    n1.receive({payload: "bar<A>\nfoo", topic: 'boo'});
                });
            });
        });

        describe('with a server that adds a character to the answer', function () {
            before(function(done) { listenSplit(2, true, done) });
            after(function(done) { stopSplitServer(done) });

            it('AC-6: data beyond the expected answer fails the comparison, not the time limit', function(done) {
                testTCPMany(sitFlow({ret:"string", newline:""}), [{
                    payload: "foo",
                    topic: 'boo'
                }], {
                    payload: "ACK:foo",
                    topic: 'boo'
                }, function(err) {
                    try {
                        should.exist(err);
                        err.name.should.equal("AssertionError");
                        done();
                    } catch(e) {
                        done(e);
                    }
                });
            });
        });
    });
});
