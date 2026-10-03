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
 *   Z-10: tests of the local coordination plugin
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");

const NR_TEST_UTILS = require("nr-test-utils");
const local = NR_TEST_UTILS.require("@node-red/runtime/lib/coordination/local");

describe("runtime/coordination/local", function() {
    let plugin;
    let clock;
    beforeEach(async function() {
        clock = sinon.useFakeTimers({now: 1000000, toFake: ["Date"]});
        plugin = local.create();
        await plugin.start({instanceId: "a", options: {}});
    });
    afterEach(async function() {
        clock.restore();
        await plugin.stop();
    });

    it("has the coordination plugin type", function() {
        plugin.type.should.equal("node-red-coordination");
    });

    it("always leader", function() {
        plugin.isLeader().should.be.true();
    });

    it("claim returns Claim first time and null within ttl", async function() {
        const claim = await plugin.claim("k1", 1000);
        should.exist(claim);
        claim.key.should.equal("k1");
        claim.expiresAt.should.equal(1001000);
        claim.release.should.be.a.Function();
        const second = await plugin.claim("k1", 1000);
        should.not.exist(second);
        // another key is independent
        should.exist(await plugin.claim("k2", 1000));
    });

    it("claim available after ttl", async function() {
        should.exist(await plugin.claim("k1", 100));
        clock.tick(99);
        should.not.exist(await plugin.claim("k1", 100));
        clock.tick(1);
        should.exist(await plugin.claim("k1", 100));
    });

    it("release frees key", async function() {
        const claim = await plugin.claim("k1", 1000);
        await claim.release();
        should.exist(await plugin.claim("k1", 1000));
    });

    it("release of an expired claim does not free the key claimed again", async function() {
        const first = await plugin.claim("k1", 100);
        clock.tick(100);
        const second = await plugin.claim("k1", 1000);
        should.exist(second);
        await first.release();
        should.not.exist(await plugin.claim("k1", 1000));
    });

    it("renew extends a held claim and returns false for a lost one", async function() {
        const claim = await plugin.claim("k1", 100);
        clock.tick(50);
        (await claim.renew(100)).should.be.true();
        claim.expiresAt.should.equal(1000150);
        clock.tick(99);
        should.not.exist(await plugin.claim("k1", 100));
        clock.tick(1);
        (await claim.renew(100)).should.be.false();
    });

    it("rejects an invalid key or ttl", async function() {
        await plugin.claim("", 100).should.be.rejected();
        await plugin.claim(123, 100).should.be.rejected();
        await plugin.claim("k", 0).should.be.rejected();
        await plugin.claim("k", -1).should.be.rejected();
        await plugin.claim("k", Infinity).should.be.rejected();
        await plugin.claim("k", "100").should.be.rejected();
    });

    it("onLeaderChange reports false on stop and can be removed", async function() {
        const a = sinon.stub();
        const b = sinon.stub();
        plugin.onLeaderChange(a);
        const removeB = plugin.onLeaderChange(b);
        removeB();
        await plugin.stop();
        a.calledOnceWith(false).should.be.true();
        b.called.should.be.false();
        plugin.isLeader().should.be.false();
        await plugin.claim("k", 100).should.be.rejected();
        // start again
        await plugin.start({});
        plugin.isLeader().should.be.true();
    });

    it("stop clears the claims", async function() {
        should.exist(await plugin.claim("k1", 1000));
        await plugin.stop();
        await plugin.start({});
        should.exist(await plugin.claim("k1", 1000));
    });

    it("status reports the connection", async function() {
        plugin.status().should.eql({connected: true});
        await plugin.stop();
        plugin.status().should.eql({connected: false});
    });

    it("removes expired claims", async function() {
        for (let i = 0; i < 10; i++) {
            await plugin.claim("k"+i, 100);
        }
        plugin._size().should.equal(10);
        clock.tick(100);
        await plugin.claim("other", 100);
        plugin._size().should.equal(1);
    });
});
