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
 *   #41: no fixed ports - the test server listens on a port assigned by the system and the port of
 *   the "tcp in" server is a free port found before the node starts (nr-test-utils/free-port) (two test runs on one machine do not collide)
 *   #54: acceptance tests of the errors of the test client (reset, refused) and of a port that is taken before the node starts (flaky tests)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var net = require("net");
var getFreePort = require("nr-test-utils/free-port").freePort;
var should = require("should");
var stoppable = require('stoppable');
var helper = require("node-red-node-test-helper");

var tcpinNode = require("nr-test-utils").require("@node-red/nodes/core/network/31-tcpin.js");


describe('TCP in Node', function() {
    // the port of the "tcp in" node in the server mode: a free port found before the node starts
    var port = undefined;
    var server = undefined;
    // the port of the test server (the "tcp in" node in the client mode): assigned by the system
    var server_port = undefined;
    var reply_data = undefined;
    // where the free ports come from (#54: a test can offer ports that are taken)
    var nextPort = getFreePort;

    // The "tcp in" server listens on all interfaces and the port is in the configuration of
    // the node, so it is found before the node starts: a port that is free also on the
    // loopback addresses, where a foreign server (a dev tool on 127.0.0.1) could answer
    // instead of the node.
    beforeEach(function(done) {
        nextPort = getFreePort;
        nextPort().then(function(freePort) {
            port = freePort;
            startServer(done);
        }, done);
    });

    afterEach(function(done) {
        helper.unload();
        stopServer(done);
    });

    function sendArray(sock, array) {
        if(array.length > 0) {
            sock.write(array[0], function() {
                sendArray(sock, array.slice(1));
            });
        }
        else {
            sock.end();
        }
    }

    function startServer(done) {
        server = stoppable(net.createServer(function(c) {
            sendArray(c, reply_data);
        }));
        server.once("error", done);
        server.listen(0, "localhost", function() {
            server.removeListener("error", done);
            server_port = server.address().port;
            done();
        });
    }

    function stopServer(done) {
        server.stop(done);
    }

    // onError(err) (#54): called with the error of the connection (a reset, a refused connection)
    function send(wdata, onError) {
        var opt = {port:port, host:"localhost"};
        var client = net.createConnection(opt, function() {
            client.write(wdata[0], function() {
                client.end();
                if(wdata.length > 1) {
                    send(wdata.slice(1), onError);
                }
            });
        });
        if (onError) {
            client.on("error", onError);
        }
    }

    function eql(v0, v1) {
        return((v0 === v1) || ((typeof v0) === 'object' && v0.equals(v1)));
    }

    // The port of a "tcp in" server is found before the node starts, so another program can take it in
    // between (#54). The node reports that as "cannot-listen" (the only way a listen fails here is a port in
    // use) and logs once it listens: the flow is loaded again on the next port until the node listens,
    // for 10 ports in all. ready() is called once the node listens, fail(err) when no port was free.
    var LISTEN_PORTS = 10;
    function loadListening(flow, ready, fail, attempt) {
        attempt = attempt || 1;
        helper.load(tcpinNode, flow, function() {
            var n1 = helper.getNode("n1");
            var settled = false;
            n1.on("call:log", function() {
                if (!settled) {
                    settled = true;
                    ready();
                }
            });
            n1.on("call:error", function() {
                if (settled) {
                    return;
                }
                settled = true;
                if (attempt >= LISTEN_PORTS) {
                    fail(new Error("tcp in did not listen on any of " + LISTEN_PORTS + " ports, the last one was " + port + ": EADDRINUSE"));
                    return;
                }
                Promise.resolve(helper.unload()).then(nextPort).then(function(freePort) {
                    port = freePort;
                    flow[0].port = port;
                    loadListening(flow, ready, fail, attempt + 1);
                }).catch(fail);
            });
        });
    }

    function testTCP(flow, wdata, rdata, is_server, done) {
        if(is_server) {
            reply_data = wdata;
        }
        // an error of the connection or a message that does not fit ends this test once; what comes
        // after that is of no interest to it
        var finished = false;
        function finish(err) {
            if (!finished) {
                finished = true;
                done(err);
            }
        }
        function receive() {
            var n2 = helper.getNode("n2");
            var rcount = 0;
            n2.on("input", function(msg) {
                if (finished) {
                    return;
                }
                try {
                    if(eql(msg.payload, rdata[rcount])) {
                        rcount++;
                    }
                    else {
                        should.fail();
                    }
                } catch(err) {
                    finish(err);
                    return;
                }
                if(rcount === rdata.length) {
                    finish();
                }
            });
        }
        if(is_server) {
            helper.load(tcpinNode, flow, receive);
        }
        else {
            loadListening(flow, function() {
                receive();
                send(wdata, finish);
            }, finish);
        }
    }

    function testTCP0(flow, wdata, rdata, done) {
        testTCP(flow, wdata, rdata, false, done);
    }

    function testTCP1(flow, wdata, rdata, done) {
        testTCP(flow, wdata, rdata, true, done);
    }

    it('should recv data (Stream/Buffer)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"server", host:"localhost", port:port, datamode:"stream", datatype:"buffer", newline:"", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP0(flow, ["foo"], [Buffer("foo")], done);
    });

    it('should recv data (Stream/String/Delimiter:\\n)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"server", host:"localhost", port:port, datamode:"stream", datatype:"utf8", newline:"\n", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP0(flow, ["foo\nbar"], ["foo", "bar"], done);
    });

    it('should recv data (Stream/String/Delimiter:o\\n)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"server", host:"localhost", port:port, datamode:"stream", datatype:"utf8", newline:"o\n", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP0(flow, ["foo\nbar"], ["fo", "bar"], done);
    });

    it('should recv data (Stream/String/Delimiter:o\\n) and reattach o', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"server", host:"localhost", port:port, datamode:"stream", datatype:"utf8", newline:"o\n", trim:true, topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP0(flow, ["foo\nbar"], ["foo\n", "bar"], done);
    });

    it('should recv data (Stream/String/No delimiter)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"server", host:"localhost", port:port, datamode:"stream", datatype:"utf8", newline:"", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP0(flow, ["foo\nbar"], ["foo\nbar"], done);
    });

    it('should recv data (Stream/Base64)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"server", host:"localhost", port:port, datamode:"stream", datatype:"base64", newline:"", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP0(flow, ["foo"], [Buffer("foo").toString('base64')], done);
    });

    it('should recv data (Single/Buffer)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"server", host:"localhost", port:port, datamode:"single", datatype:"buffer", newline:"", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP0(flow, ["foo"], [Buffer("foo")], done);
    });

    it('should recv data (Single/String)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"server", host:"localhost", port:port, datamode:"single", datatype:"utf8", newline:"\n", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP0(flow, ["foo\nbar\nbaz"], ["foo\nbar\nbaz"], done);
    });

    it('should recv data (Stream/Base64)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"server", host:"localhost", port:port, datamode:"single", datatype:"base64", newline:"", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP0(flow, ["foo"], [Buffer("foo").toString('base64')], done);
    });

    it('should recv multiple data (Stream/Buffer)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"server", host:"localhost", port:port, datamode:"stream", datatype:"buffer", newline:"", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP0(flow, ["foo", "bar"], [Buffer("foo"), Buffer("bar")], done);
    });

    it('should recv multiple data (Stream/String/Delimiter:\\n)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"server", host:"localhost", port:port, datamode:"stream", datatype:"utf8", newline:"\n", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP0(flow, ["foo", "bar\nbaz"], ["foo", "bar", "baz"], done);
    });

    it('should recv multiple data (Stream/String/No delimiter)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"server", host:"localhost", port:port, datamode:"stream", datatype:"utf8", newline:"", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP0(flow, ["foo", "bar\nbaz"], ["foo", "bar\nbaz"], done);
    });

    it('should recv multiple data (Stream/Base64)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"server", host:"localhost", port:port, datamode:"stream", datatype:"base64", newline:"", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        var wdata = ["foo", "bar"];
        var rdata = wdata.map(function(x) {
            return Buffer(x).toString('base64');
        });
        testTCP0(flow,  wdata, rdata, done);
    });

    it('should connect & recv data (Stream/Buffer)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"client", host:"localhost", port:server_port, datamode:"stream", datatype:"buffer", newline:"", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP1(flow, ["foo"], [Buffer("foo")], done);
    });

    it('should connect & recv data (Stream/String/Delimiter:\\n)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"client", host:"localhost", port:server_port, datamode:"stream", datatype:"utf8", newline:"\n", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP1(flow, ["foo\nbar"], ["foo", "bar"], done);
    });

    it('should connect & recv data (Stream/String/No delimiter)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"client", host:"localhost", port:server_port, datamode:"stream", datatype:"utf8", newline:"", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP1(flow, ["foo\nbar"], ["foo\nbar"], done);
    });

    it('should connect & recv data (Stream/Base64)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"client", host:"localhost", port:server_port, datamode:"stream", datatype:"base64", newline:"", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP1(flow, ["foo"], [Buffer("foo").toString('base64')], done);
    });

    it('should connect & recv data (Single/Buffer)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"client", host:"localhost", port:server_port, datamode:"single", datatype:"buffer", newline:"", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP1(flow, ["foo"], [Buffer("foo")], done);
    });

    it('should connect & recv data (Single/String)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"client", host:"localhost", port:server_port, datamode:"single", datatype:"utf8", newline:"\n", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP1(flow, ["foo\nbar\nbaz"], ["foo\nbar\nbaz"], done);
    });

    it('should connect & recv data (Stream/Base64)', function(done) {
        var flow = [{id:"n1", type:"tcp in", server:"client", host:"localhost", port:server_port, datamode:"single", datatype:"base64", newline:"", topic:"", base64:false, wires:[["n2"]] },
                    {id:"n2", type:"helper"}];
        testTCP1(flow, ["foo"], [Buffer("foo").toString('base64')], done);
    });

    // #54: a failed connection of the test client and a port that is taken before the node starts
    describe('errors of the test client and a taken port (#54)', function() {
        let cleanups;

        beforeEach(function() {
            cleanups = [];
        });

        afterEach(async function() {
            for (const cleanup of cleanups.reverse()) {
                await cleanup();
            }
        });

        function listen(srv, host) {
            return new Promise(function(resolve, reject) {
                srv.once("error", reject);
                const args = host ? [0, host] : [0];
                srv.listen.apply(srv, args.concat([function() {
                    srv.removeListener("error", reject);
                    cleanups.push(function() { return new Promise(function(r) { srv.close(function() { r() }) }) });
                    resolve(srv.address().port);
                }]));
            });
        }

        function turns(count) {
            return new Promise(function(resolve) {
                (function next(n) { n === 0 ? resolve() : setImmediate(next, n - 1) })(count);
            });
        }

        function text(err) {
            return [err.message].concat((err.errors || []).map(function(e) { return e.message })).join(" ");
        }

        it('AC-7: a connection reset by the server before the messages arrive is reported to the test', function(done) {
            const resetter = net.createServer(function(sock) { sock.resetAndDestroy() });
            listen(resetter).then(function(resetPort) {
                port = resetPort;
                send(["foo"], function(err) {
                    try {
                        err.should.have.property("code", "ECONNRESET");
                        done();
                    } catch(e) {
                        done(e);
                    }
                });
            }, done);
        });

        it('AC-8: a reset that arrives after the test has finished is not reported', async function() {
            const sockets = [];
            const quiet = net.createServer(function(sock) {
                sockets.push(sock);
                sock.on("error", function() {});
                sock.resume();
            });
            port = await listen(quiet);
            // errors for a test that has finished are of no interest to it (the callback only records them)
            const late = [];
            send(["foo"], function(err) { late.push(err) });
            while (sockets.length === 0) {
                await turns(1);
            }
            const closed = new Promise(function(resolve) { sockets[0].once("close", resolve) });
            // the test is over here; the server resets the connection of the client
            sockets[0].resetAndDestroy();
            await closed;
            await turns(5);
        });

        it('AC-9: a refused connection is reported to the test with the port', function(done) {
            getFreePort().then(function(closedPort) {
                port = closedPort;
                send(["foo"], function(err) {
                    try {
                        err.should.have.property("code", "ECONNREFUSED");
                        text(err).should.containEql(String(closedPort));
                        done();
                    } catch(e) {
                        done(e);
                    }
                });
            }, done);
        });

        // Holds a port on all interfaces, like a server that took it after the search for a free port
        async function holdPort() {
            const holder = net.createServer(function(sock) { sock.on("error", function() {}); sock.resume() });
            return listen(holder);
        }

        function offer(ports) {
            const handedOut = [];
            nextPort = function() {
                const next = ports[Math.min(handedOut.length, ports.length - 1)];
                handedOut.push(next);
                return Promise.resolve(next);
            };
            return handedOut;
        }

        it('AC-15: a port that is taken before the node starts is replaced by another one', async function() {
            const taken = await holdPort();
            const free = await getFreePort();
            const handedOut = offer([taken, free]);
            port = await nextPort();
            port.should.equal(taken);
            const flow = [{id:"n1", type:"tcp in", server:"server", host:"localhost", port:port, datamode:"stream", datatype:"buffer", newline:"", topic:"", base64:false, wires:[["n2"]] },
                          {id:"n2", type:"helper"}];
            await new Promise(function(resolve, reject) {
                testTCP0(flow, ["foo"], [Buffer("foo")], function(err) { err ? reject(err) : resolve() });
            });
            handedOut.should.eql([taken, free]);
            port.should.equal(free);
        });

        it('AC-16: when every port is taken the test fails with the last port, before the time limit', async function() {
            const takenPorts = [];
            for (let i = 0; i < 12; i++) {
                takenPorts.push(await holdPort());
            }
            const handedOut = offer(takenPorts);
            port = await nextPort();
            const flow = [{id:"n1", type:"tcp in", server:"server", host:"localhost", port:port, datamode:"stream", datatype:"buffer", newline:"", topic:"", base64:false, wires:[["n2"]] },
                          {id:"n2", type:"helper"}];
            const err = await new Promise(function(resolve) {
                testTCP0(flow, ["foo"], [Buffer("foo")], function(err) { resolve(err) });
            });
            should.exist(err);
            handedOut.should.have.length(10);
            text(err).should.containEql("EADDRINUSE");
            text(err).should.containEql(String(handedOut[handedOut.length - 1]));
        });
    });

});
