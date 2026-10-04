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
 *   #41: no fixed port - the receiving socket of every test is bound to a port assigned by the system
 *   and the node is configured with it (two test runs on one machine do not collide)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

var dgram = require("dgram");
var should = require("should");
var helper = require("node-red-node-test-helper");
var udpNode = require("nr-test-utils").require("@node-red/nodes/core/network/32-udp.js");


describe('UDP out Node', function() {
    before(function(done) {
        helper.startServer(done);
    });

    after(function(done) {
        helper.stopServer(done);
    });

    afterEach(function() {
        helper.unload();
    });

    // Binds the receiving socket to a port assigned by the system and calls
    // listening(port) when it is bound; done is called when the data has arrived.
    function recvData(data, listening, done) {
        var sock = dgram.createSocket('udp4');
        sock.on('message', function(msg, rinfo) {
            sock.close(done);
            msg.should.deepEqual(data);
        });
        sock.once('error', done);
        sock.bind(0, '127.0.0.1', function() {
            sock.removeListener('error', done);
            listening(sock.address().port);
        });
    }

    function checkSend(proto, val0, val1, decode, dest_in_msg, done) {
        recvData(val1, function(port) {
            checkSendTo(port, proto, decode, dest_in_msg);
        }, done);
    }

    function checkSendTo(port, proto, decode, dest_in_msg) {
        var dst_ip = dest_in_msg ? undefined : "127.0.0.1";
        var dst_port = dest_in_msg ? undefined : port;
        var flow = [{id:"n1", type:"udp out",
                     addr:dst_ip, port:dst_port, iface: "",
                     ipv:proto, outport: "",
                     base64:decode, multicast:false,
                     wires:[] }];
        helper.load(udpNode, flow, function() {
            var n1 = helper.getNode("n1");
            var msg = {};
            if (decode) {
                msg.payload = Buffer.from("hello").toString('base64');
            }
            else {
                msg.payload = "hello";
            }
            if (dest_in_msg) {
                msg.ip = "127.0.0.1";
                msg.port = port;
            }
            setTimeout(function() {
                n1.receive(msg);
            }, 200);
        });
    }

    it('should send IPv4 data', function(done) {
        checkSend('udp4', 'hello', Buffer.from('hello'), false, false, done);
    });

    it('should send IPv4 data (base64)', function(done) {
        checkSend('udp4', 'hello', Buffer.from('hello'), true, false, done);
    });

    it('should send IPv4 data with dest from msg', function(done) {
        checkSend('udp4', 'hello', Buffer.from('hello'), false, true, done);
    });

});
