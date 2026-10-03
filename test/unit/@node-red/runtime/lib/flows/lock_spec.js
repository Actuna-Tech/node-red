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
 *   E-01: tests of the shared deploy lock
 *   E-01: tests of holdUntil - the lock is held until the start of the flows completes (R-43)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const NR_TEST_UTILS = require("nr-test-utils");
const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");

describe("flows/lock", function() {
    it("runs exclusive sections sequentially", async function() {
        const order = [];
        let releaseFirst;
        const first = lock.runExclusive(function() {
            order.push("first:start");
            return new Promise(resolve => { releaseFirst = resolve }).then(() => {
                order.push("first:end");
                return 1;
            });
        });
        const second = lock.runExclusive(async function() {
            order.push("second");
            return 2;
        });
        await new Promise(resolve => setTimeout(resolve, 10));
        order.should.eql(["first:start"]);
        lock.isLocked().should.be.true();
        releaseFirst();
        (await first).should.equal(1);
        (await second).should.equal(2);
        order.should.eql(["first:start", "first:end", "second"]);
        lock.isLocked().should.be.false();
    });
    it("releases lock when section throws", async function() {
        await lock.runExclusive(async function() {
            throw new Error("fail");
        }).should.be.rejectedWith("fail");
        lock.isLocked().should.be.false();
        (await lock.runExclusive(async () => "next")).should.equal("next");
    });
    it("keeps the lock after the section until a held promise settles (R-43)", async function() {
        let finishStart;
        const result = await lock.runExclusive(async function() {
            lock.holdUntil(new Promise(resolve => { finishStart = resolve }));
            return "deployed";
        });
        // The result is returned before the held promise settles
        result.should.equal("deployed");
        lock.isLocked().should.be.true();
        const order = [];
        const next = lock.runExclusive(async function() { order.push("next") });
        await new Promise(resolve => setTimeout(resolve, 10));
        order.should.eql([]);
        finishStart();
        await next;
        order.should.eql(["next"]);
        lock.isLocked().should.be.false();
    });
    it("releases the lock when a held promise rejects", async function() {
        let failStart;
        await lock.runExclusive(async function() {
            lock.holdUntil(new Promise((resolve, reject) => { failStart = reject }));
        });
        lock.isLocked().should.be.true();
        failStart(new Error("start failed"));
        (await lock.runExclusive(async () => "next")).should.equal("next");
        lock.isLocked().should.be.false();
    });
    it("releases the lock when a section with a held promise throws", async function() {
        let finishStart;
        await lock.runExclusive(async function() {
            lock.holdUntil(new Promise(resolve => { finishStart = resolve }));
            throw new Error("fail");
        }).should.be.rejectedWith("fail");
        lock.isLocked().should.be.true();
        finishStart();
        (await lock.runExclusive(async () => "next")).should.equal("next");
    });
    it("ignores holdUntil outside a section", async function() {
        lock.holdUntil(new Promise(() => {}));
        lock.isLocked().should.be.false();
        (await lock.runExclusive(async () => "next")).should.equal("next");
        lock.isLocked().should.be.false();
    });
    it("releases lock when a synchronous section throws", async function() {
        await lock.runExclusive(function() {
            throw new Error("sync fail");
        }).should.be.rejectedWith("sync fail");
        lock.isLocked().should.be.false();
    });
});
