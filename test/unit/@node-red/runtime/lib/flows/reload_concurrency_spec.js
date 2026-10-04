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
 *   Z-09: the limit of reloads at the same time (deploy.reload.concurrency) with
 *   three instances and one coordinator in memory
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const NR_TEST_UTILS = require("nr-test-utils");
const reloadModule = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/reload");
const { createCoordination } = NR_TEST_UTILS.require("@node-red/runtime/lib/coordination");
const local = NR_TEST_UTILS.require("@node-red/runtime/lib/coordination/local");

function waitFor(check, timeout, message) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function poll() {
            if (check()) {
                return resolve();
            }
            if (Date.now() - start > (timeout || 3000)) {
                return reject(new Error(message || "timeout"));
            }
            setTimeout(poll, 2);
        })();
    });
}

// A minimal instance state with the calls used by the reloader
function createState() {
    let current = { state: "ready", draining: false };
    let before = null;
    const listeners = [];
    function set(next) {
        const previous = current.state;
        current = Object.assign({ draining: false }, next);
        listeners.forEach(l => l({ state: current.state, previous: previous, draining: current.draining }));
    }
    return {
        get: () => Object.assign({}, current),
        isReady: () => current.state === "ready" || (current.state === "reloadPending" && !current.draining),
        onChange: l => { listeners.push(l); return () => listeners.splice(listeners.indexOf(l), 1) },
        markReloadPending: () => { before = current.state; set({ state: "reloadPending" }); return true },
        markDraining: () => { set({ state: "reloadPending", draining: true }); return true },
        cancelPending: () => { set({ state: before }); return true },
        fail: () => set({ state: "failed" }),
        reloading: () => set({ state: "reloading" }),
        ready: () => set({ state: "ready" })
    };
}

describe("flows/reload - concurrency with three instances (Z-09, Z-10)", function() {
    const store = { rev: "A", flows: [] };
    let instances;
    let sharedClaims;

    // One coordinator in memory shared by the instances: a cluster plugin
    // whose claims are those of one local plugin
    function createSharedPlugin() {
        return {
            type: local.PLUGIN_TYPE,
            start: async () => {},
            stop: async () => {},
            isLeader: () => false,
            onLeaderChange: () => () => {},
            claim: (key, ttl) => sharedClaims.claim(key, ttl)
        };
    }

    async function createInstance(name) {
        const plugin = createSharedPlugin();
        const coordination = createCoordination();
        await coordination.start({
            settings: { coordination: { plugin: "shared" }, get: () => name },
            plugins: { getPlugin: () => plugin, getPluginsByType: () => [plugin] }
        });
        const state = createState();
        const inst = { name: name, state: state, active: { rev: "A" }, hookCalls: 0, releases: [], coordination: coordination };
        const pipeline = {
            deploy: async function(opts) {
                if (state.get().state !== "reloadPending") {
                    return { skipped: "superseded" };
                }
                const decision = await opts.reread();
                if (!decision || !decision.apply) {
                    return { skipped: decision };
                }
                state.reloading();
                inst.active = { rev: decision.apply.rev };
                state.ready();
                return { rev: decision.apply.rev };
            }
        };
        const lock = { runExclusive: async fn => fn() };
        const log = { _: k => k, warn() {}, error() {}, info() {}, debug() {}, trace() {}, audit() {} };
        const hooks = {
            has: () => true,
            trigger: () => {
                inst.hookCalls++;
                return new Promise(resolve => inst.releases.push(resolve));
            }
        };
        inst.reloader = reloadModule.createReloader({ state: state, pipeline: pipeline, lock: lock });
        inst.reloader.init({
            settings: { deploy: { reload: { watch: true, concurrency: 1, retry: { min: 5, max: 5 } } } },
            storage: {
                hasWatchFlows: () => true,
                watchFlows: async cb => { inst.notify = cb },
                getFlows: async () => ({ rev: store.rev, flows: store.flows })
            },
            flows: { getFlows: () => inst.active, getChangedFlows: () => null, credentialsChanged: () => false },
            coordination: coordination,
            hooks: hooks,
            log: log
        });
        await inst.reloader.register();
        inst.reloader.startupComplete();
        return inst;
    }

    beforeEach(async function() {
        store.rev = "A";
        sharedClaims = local.create();
        await sharedClaims.start({});
        instances = [];
        for (const name of ["i1", "i2", "i3"]) {
            instances.push(await createInstance(name));
        }
    });
    afterEach(async function() {
        for (const inst of instances) {
            await inst.reloader.stop();
            await inst.coordination.stop();
        }
        await sharedClaims.stop();
    });

    it("at most concurrency instances draining, others ready 200 while waiting", async function() {
        store.rev = "B";
        instances.forEach(inst => inst.notify({ rev: "B" }));
        for (let round = 0; round < 3; round++) {
            await waitFor(() => instances.filter(i => i.hookCalls > 0 && i.releases.length > 0).length === 1, 3000, "one instance draining");
            await new Promise(r => setTimeout(r, 30));
            const draining = instances.filter(i => i.state.get().draining);
            draining.should.have.length(1);
            draining[0].state.isReady().should.be.false();
            instances.filter(i => i !== draining[0] && i.active.rev === "A").forEach(i => {
                i.state.get().state.should.equal("reloadPending");
                i.state.isReady().should.be.true();
            });
            draining[0].releases.shift()();
            await waitFor(() => draining[0].active.rev === "B");
        }
        instances.forEach(i => {
            i.active.rev.should.equal("B");
            i.hookCalls.should.equal(1);
            i.state.get().state.should.equal("ready");
        });
    });
});
