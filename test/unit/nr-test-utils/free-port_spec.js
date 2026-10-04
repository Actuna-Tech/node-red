/**
 * Copyright OpenJS Foundation and other contributors, https://openjsf.org/
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
 *   #41: new test file - the nr-test-utils/free-port helper
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const net = require("net");
const { freePort, listenOnFreePort, isFreeOnLoopback } = require("nr-test-utils/free-port");

function listen(server, port, host) {
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve(server.address().port));
    });
}

function close(server) {
    return new Promise(resolve => server.close(() => resolve()));
}

describe("nr-test-utils/free-port", function() {
    it("gives a port that can be listened on, on all interfaces", async function() {
        const port = await freePort();
        port.should.be.a.Number().and.above(0);
        const server = net.createServer();
        (await listen(server, port)).should.equal(port);
        await close(server);
    });

    it("isFreeOnLoopback is false for a port taken on 127.0.0.1 and true for a released one", async function() {
        const foreign = net.createServer();
        const port = await listen(foreign, 0, "127.0.0.1");
        (await isFreeOnLoopback(port)).should.be.false();
        await close(foreign);
        (await isFreeOnLoopback(port)).should.be.true();
    });

    it("isFreeOnLoopback is false for a port taken on ::1 (when the machine has IPv6)", async function() {
        const foreign = net.createServer();
        let port;
        try {
            port = await listen(foreign, 0, "::1");
        } catch (err) {
            if (err.code === "EADDRNOTAVAIL" || err.code === "EAFNOSUPPORT") {
                return this.skip();
            }
            throw err;
        }
        (await isFreeOnLoopback(port)).should.be.false();
        await close(foreign);
    });

    it("listenOnFreePort starts the server and gives its port", async function() {
        const server = net.createServer();
        const port = await listenOnFreePort(server);
        server.address().port.should.equal(port);
        await close(server);
    });
});
