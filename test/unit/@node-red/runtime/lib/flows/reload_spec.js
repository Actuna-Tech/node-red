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
 *   Z-09: tests of the reload of the flows after a change in storage (watchFlows,
 *   preReload, coalescing, retries, reload slots)
 *   Z-09: regression tests of the review - a strict read of the file storage
 *   (an invalid flow file during the reload), lost reloads after a superseded
 *   cycle, the way out of "failed", timers
 *   Z-16: tests of health.unreadyGrace before a reload
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const NR_TEST_UTILS = require("nr-test-utils");
const reloadModule = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/reload");
const pipeline = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/pipeline");
const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");
const state = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
const hooks = NR_TEST_UTILS.require("@node-red/util").hooks;

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitFor(check, timeout, message) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function poll() {
            if (check()) {
                return resolve();
            }
            if (Date.now() - start > (timeout || 2000)) {
                return reject(new Error(message || "timeout"));
            }
            setTimeout(poll, 2);
        })();
    });
}

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r });
    return { promise, resolve };
}

function flowsOf(rev) {
    return [{ id: "t1", type: "tab", label: rev }];
}

/**
 * A runtime with a storage mock providing watchFlows, the flows mock and the
 * real instance state, deploy lock and pipeline.
 */
function createEnv(opts) {
    opts = opts || {};
    const env = {
        stored: { flows: flowsOf("A"), rev: "A", credentials: {} },
        active: { flows: flowsOf("A"), rev: "A" },
        applied: [],
        logs: { warn: [], error: [], info: [], debug: [], trace: [] },
        audits: [],
        getFlowsCalls: 0,
        getFlowsArgs: [],
        failReads: 0,
        failAlways: false,
        idle: false,
        startErrors: null,
        unwatch: sinon.spy(async function() {})
    };
    const log = {
        _: (key, params) => key + (params ? " " + JSON.stringify(params) : ""),
        audit: m => env.audits.push(m)
    };
    ["warn", "error", "info", "debug", "trace"].forEach(level => {
        log[level] = m => env.logs[level].push(String(m));
    });
    env.storage = {
        hasWatchFlows: () => opts.withoutWatch !== true,
        watchFlows: sinon.spy(async function(cb) {
            if (opts.watchFails) {
                throw new Error("cannot watch");
            }
            env.notify = cb;
            return env.unwatch;
        }),
        getFlows: async function(readOpts) {
            env.getFlowsArgs.push(readOpts);
            env.getFlowsCalls++;
            if (env.failAlways || env.failReads > 0) {
                env.failReads--;
                throw new Error("storage unavailable");
            }
            return JSON.parse(JSON.stringify(env.stored));
        },
        saveFlows: sinon.spy(async function() {})
    };
    env.flows = {
        getFlows: () => env.active,
        getChangedFlows: sinon.spy(function(loaded) {
            return opts.changedFlows ? opts.changedFlows(loaded, env.active) : ["t1"];
        }),
        reloadFromStorage: sinon.spy(async function(loaded, reloadOpts) {
            env.applied.push({ rev: loaded.rev, type: reloadOpts.type, credentialsChanged: reloadOpts.credentialsChanged, locked: lock.isLocked() });
            env.active = { flows: loaded.flows, rev: loaded.rev };
            if (!env.idle) {
                lock.holdUntil(Promise.resolve({ errors: env.startErrors || [] }));
            }
            return loaded.rev;
        }),
        setFlows: sinon.spy(async function(flows) {
            env.active = { flows: flows, rev: "deployed" };
            env.stored = { flows: flows, rev: "deployed", credentials: {} };
            lock.holdUntil(Promise.resolve({ errors: [] }));
            return "deployed";
        })
    };
    env.claims = [];
    env.coordination = {
        info: () => ({ plugin: opts.localCoordination === false ? "cluster" : "local", local: opts.localCoordination !== false }),
        claimSlot: sinon.spy(async function(name, limit, ttl) {
            if (opts.claimSlot) {
                return opts.claimSlot(name, limit, ttl);
            }
            const claim = { key: "slot:" + name + ":0", release: sinon.spy(async function() {}), renew: sinon.spy(async function() { return true }) };
            env.claims.push(claim);
            return claim;
        })
    };
    env.runtime = {
        settings: { deploy: { reload: Object.assign({ watch: true }, opts.reload || {}) } },
        storage: env.storage,
        flows: env.flows,
        coordination: env.coordination,
        hooks: hooks,
        log: log
    };
    pipeline.init(env.runtime);
    env.reloader = reloadModule.createReloader();
    env.reloader.init(env.runtime);
    env.change = function(rev, extra) {
        env.stored = Object.assign({ flows: flowsOf(rev), rev: rev, credentials: {} }, extra || {});
    };
    env.start = async function() {
        await env.reloader.register();
        env.reloader.startupComplete();
    };
    return env;
}

describe("flows/reload (Z-09)", function() {
    let env;
    let states;
    let unsubscribe;

    beforeEach(function() {
        hooks.clear();
        state.reset();
        state.markStarting();
        state.report({ errors: [] });
        states = [];
        unsubscribe = state.onChange(info => states.push(info.state + (info.draining ? ":draining" : "")));
    });
    afterEach(async function() {
        unsubscribe();
        hooks.clear();
        if (env) {
            await env.reloader.stop();
            env = null;
        }
        state.reset();
    });

    describe("registration", function() {
        it("watch false - no watcher", async function() {
            env = createEnv({ reload: { watch: false } });
            await env.reloader.register();
            env.storage.watchFlows.called.should.be.false();
            env.logs.warn.should.have.length(0);
        });
        it("watch not set - no watcher (default false)", async function() {
            env = createEnv();
            env.runtime.settings.deploy = {};
            env.reloader.init(env.runtime);
            await env.reloader.register();
            env.storage.watchFlows.called.should.be.false();
        });
        it("storage without watchFlows - warning, no watcher", async function() {
            env = createEnv({ withoutWatch: true });
            await env.reloader.register();
            env.storage.watchFlows.called.should.be.false();
            env.logs.warn.some(m => m.indexOf("reload.watch-not-supported") === 0).should.be.true();
        });
        it("watchFlows registration failure fails start when watch true (R-36)", async function() {
            env = createEnv({ watchFails: true });
            await env.reloader.register().should.be.rejectedWith("cannot watch");
            env.logs.error.some(m => m.indexOf("reload.watch-failed") === 0).should.be.true();
        });
        it("unwatch called on stop", async function() {
            env = createEnv();
            await env.start();
            await env.reloader.stop();
            env.unwatch.calledOnce.should.be.true();
        });
        it("invalid type falls back to full with a warning", async function() {
            env = createEnv({ reload: { type: "partial" } });
            env.logs.warn.some(m => m.indexOf("reload.invalid-type") === 0).should.be.true();
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1);
            env.applied[0].type.should.equal("full");
        });
    });

    describe("reload cycle", function() {
        it("notification triggers reload from storage", async function() {
            env = createEnv();
            await env.start();
            env.change("B");
            env.notify({ rev: "B" });
            await waitFor(() => env.applied.length === 1 && state.get().state === "ready");
            env.applied[0].should.eql({ rev: "B", type: "full", credentialsChanged: false, locked: true });
            env.active.rev.should.equal("B");
            states.should.eql(["reloadPending", "reloadPending:draining", "reloading", "ready"]);
            env.audits.some(a => a.event === "flows.reload" && a.source === "storage" && a.rev === "B").should.be.true();
        });
        it("no save on reload", async function() {
            env = createEnv();
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1);
            env.storage.saveFlows.called.should.be.false();
        });
        it("skips when rev equals active (own write) - preReload not called", async function() {
            env = createEnv();
            const hook = sinon.spy();
            hooks.add("preReload", hook);
            await env.start();
            env.notify({ rev: "A" });
            await waitFor(() => env.getFlowsCalls === 1);
            await delay(20);
            env.applied.should.have.length(0);
            hook.called.should.be.false();
            states.should.eql([]);
        });
        it("reloads on credentialsChanged with same rev", async function() {
            env = createEnv({ reload: { type: "diff" } });
            await env.start();
            env.notify({ credentialsChanged: true });
            await waitFor(() => env.applied.length === 1);
            // the diff does not see the credentials: a full reload
            env.applied[0].type.should.equal("full");
            env.applied[0].credentialsChanged.should.be.true();
        });
        it("type defaults to full - preReload gets type full and changedFlows null", async function() {
            env = createEnv();
            let payload;
            hooks.add("preReload", p => { payload = p });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1);
            payload.type.should.equal("full");
            should(payload.changedFlows).be.null();
            env.applied[0].type.should.equal("full");
        });
        it("preReload receives rev, activeRev, type, changedFlows, credentialsChanged, deadline, signal - frozen", async function() {
            env = createEnv({ reload: { type: "diff", preReloadTimeout: 5000 } });
            let payload;
            hooks.add("preReload", p => { payload = p });
            await env.start();
            env.change("B");
            const before = Date.now();
            env.notify();
            await waitFor(() => env.applied.length === 1);
            payload.rev.should.equal("B");
            payload.activeRev.should.equal("A");
            payload.type.should.equal("diff");
            payload.changedFlows.should.eql(["t1"]);
            payload.credentialsChanged.should.be.false();
            payload.deadline.should.be.within(before + 5000, Date.now() + 5000);
            payload.signal.should.have.property("aborted", false);
            Object.isFrozen(payload).should.be.true();
            Object.isFrozen(payload.changedFlows).should.be.true();
            (function() { "use strict"; payload.rev = "X" }).should.throw();
            env.applied[0].type.should.equal("diff");
        });
        it("preReload delays the stop: /ready 503, lock not held while it waits", async function() {
            env = createEnv();
            const release = deferred();
            let calledWhile;
            hooks.add("preReload", function(payload) {
                calledWhile = { ready: state.isReady(), locked: lock.isLocked(), state: state.get() };
                return release.promise;
            });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => !!calledWhile);
            calledWhile.ready.should.be.false();
            calledWhile.locked.should.be.false();
            calledWhile.state.draining.should.be.true();
            await delay(20);
            env.applied.should.have.length(0);
            state.isReady().should.be.false();
            release.resolve();
            await waitFor(() => env.applied.length === 1 && state.isReady());
            env.applied[0].locked.should.be.true();
        });
        it("preReload timeout proceeds with warning", async function() {
            env = createEnv({ reload: { preReloadTimeout: 30 } });
            hooks.add("preReload", p => new Promise(() => {}));
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1);
            env.logs.warn.some(m => m.indexOf("reload.hook-timeout") === 0).should.be.true();
        });
        it("preReload error proceeds with error log", async function() {
            env = createEnv();
            hooks.add("preReload", p => { throw new Error("boom") });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1);
            env.logs.error.some(m => m.indexOf("reload.hook-failed") === 0 && m.indexOf("boom") > 0).should.be.true();
        });
        it("preReload returning false is no veto", async function() {
            env = createEnv();
            hooks.add("preReload", p => false);
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1);
            env.logs.error.some(m => m.indexOf("reload.hook-failed") === 0).should.be.true();
        });
        it("rereads storage under lock and applies newest rev", async function() {
            env = createEnv();
            let revs = [];
            hooks.add("preReload", p => { revs.push(p.rev); env.change("C") });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1);
            revs.should.eql(["B"]);
            env.applied[0].rev.should.equal("C");
        });
        it("change reverted during drain - nothing reloaded, back to ready", async function() {
            env = createEnv();
            hooks.add("preReload", p => { env.change("A") });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => states.length >= 3);
            await delay(10);
            env.applied.should.have.length(0);
            states.should.eql(["reloadPending", "reloadPending:draining", "ready"]);
        });
        it("coalesces notifications during reload into one", async function() {
            env = createEnv();
            const release = deferred();
            let calls = 0;
            hooks.add("preReload", p => { calls++; return calls === 1 ? release.promise : undefined });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => calls === 1);
            ["C", "D", "E", "F"].forEach(rev => { env.change(rev); env.notify() });
            env.notify();
            // the first cycle rereads under the lock: F; the coalesced cycle then has nothing to do
            release.resolve();
            await waitFor(() => env.applied.length >= 1 && state.get().state === "ready");
            await delay(20);
            env.applied.map(a => a.rev).should.eql(["F"]);
        });
        it("coalesced cycle reloads a change written after the reread", async function() {
            env = createEnv();
            let calls = 0;
            hooks.add("preReload", p => { calls++ });
            env.flows.reloadFromStorage = sinon.spy(async function(loaded, o) {
                env.applied.push({ rev: loaded.rev, type: o.type });
                env.active = { flows: loaded.flows, rev: loaded.rev };
                if (loaded.rev === "B") {
                    // written by another instance while this one reloads
                    env.change("F");
                    env.notify();
                    env.notify();
                }
                lock.holdUntil(Promise.resolve({ errors: [] }));
                return loaded.rev;
            });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 2 && state.get().state === "ready");
            await delay(20);
            env.applied.map(a => a.rev).should.eql(["B", "F"]);
            calls.should.equal(2);
        });
        it("buffers notifications during startup", async function() {
            env = createEnv();
            await env.reloader.register();
            env.change("B");
            env.notify();
            await delay(20);
            env.getFlowsCalls.should.equal(0);
            env.applied.should.have.length(0);
            env.reloader.startupComplete();
            await waitFor(() => env.applied.length === 1);
            env.applied[0].rev.should.equal("B");
        });
        it("idle state updates config without start", async function() {
            env = createEnv();
            state.reset();
            state.markStarting();
            state.report({ errors: [], flowsRunning: false, reason: "set-state" });
            state.get().state.should.equal("idle");
            env.idle = true;
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1 && state.get().state === "idle");
            env.active.rev.should.equal("B");
        });
        it("start errors set failed", async function() {
            env = createEnv();
            env.startErrors = [{ code: "missing_types", message: "Missing node types" }];
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => state.get().state === "failed");
            state.isReady().should.be.false();
        });
        it("notification after stop is ignored", async function() {
            env = createEnv();
            await env.start();
            await env.reloader.stop();
            env.change("B");
            env.notify();
            await delay(20);
            env.getFlowsCalls.should.equal(0);
        });
        it("exceptions in the cycle do not escape the callback", async function() {
            env = createEnv();
            await env.start();
            env.flows.getFlows = () => { throw new Error("unexpected") };
            env.change("B");
            (function() { env.notify() }).should.not.throw();
            await delay(20);
            env.applied.should.have.length(0);
        });
    });

    describe("deployments and stop", function() {
        it("local deploy during reloadPending supersedes reload", async function() {
            env = createEnv({ reload: { concurrency: 1 }, localCoordination: false });
            let payload;
            hooks.add("preReload", p => { payload = p; return new Promise(() => {}) });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => !!payload);
            const result = await pipeline.deploy({ type: "full", source: "api", flows: { flows: flowsOf("D") } });
            result.rev.should.equal("deployed");
            payload.signal.aborted.should.be.true();
            payload.signal.reason.should.equal("superseded");
            await waitFor(() => state.get().state === "ready");
            await delay(20);
            env.applied.should.have.length(0);
            states.should.eql(["reloadPending", "reloadPending:draining", "deploying", "ready"]);
            // the reload slot is released
            env.claims[0].release.calledOnce.should.be.true();
        });
        it("a failed local deploy after begin(deploy) does not lose the reload (review regression)", async function() {
            env = createEnv();
            let payload;
            const d = deferred();
            hooks.add("preReload", p => { if (!payload) { payload = p; return d.promise } });
            env.flows.setFlows = async function() {
                const err = new Error("read-only user directory");
                err.code = "read_only_user_dir";
                err.status = 400;
                throw err;
            };
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => !!payload);
            const err = await pipeline.deploy({ type: "full", source: "api", flows: { flows: flowsOf("D") } }).then(() => null, e => e);
            err.code.should.equal("read_only_user_dir");
            payload.signal.aborted.should.be.true();
            d.resolve();
            // storage (B) differs from the active revision (A): the reload is resumed
            await waitFor(() => env.applied.length === 1, 2000, "reload lost");
            env.applied[0].rev.should.equal("B");
            await waitFor(() => state.get().state === "ready");
        });
        ["stop", "start"].forEach(function(target) {
            it("POST /flows/state " + target + " during the drain does not lose the reload (review regression)", async function() {
                env = createEnv();
                let payload;
                const d = deferred();
                hooks.add("preReload", p => { if (!payload) { payload = p; return d.promise } });
                await env.start();
                env.change("B");
                env.notify();
                await waitFor(() => !!payload);
                // the same calls as api/flows.js setState
                await lock.runExclusive(async function() {
                    // stopped flows are not started by the reload
                    env.idle = target === "stop";
                    const token = state.begin("set-state", { supersede: true });
                    state.end(token, target === "stop" ? { flowsRunning: false, reason: "set-state" } : { errors: [] });
                });
                d.resolve();
                await waitFor(() => env.applied.length === 1, 2000, "reload lost");
                env.applied[0].rev.should.equal("B");
                await waitFor(() => state.get().state === (target === "stop" ? "idle" : "ready"));
            });
        });
        it("a successful local deploy during the drain - no reload after it (storage = active)", async function() {
            env = createEnv();
            let payload;
            hooks.add("preReload", p => { payload = p; return new Promise(() => {}) });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => !!payload);
            await pipeline.deploy({ type: "full", source: "api", flows: { flows: flowsOf("D") } });
            await waitFor(() => state.get().state === "ready");
            await delay(30);
            env.applied.should.have.length(0);
            env.active.rev.should.equal("deployed");
        });
        it("deployment waiting for the lock is not overtaken: reload and api deploy share one mutex", async function() {
            env = createEnv();
            const order = [];
            const applyStarted = deferred();
            const finishApply = deferred();
            env.flows.reloadFromStorage = async function(loaded) {
                order.push("reload:start");
                applyStarted.resolve();
                await finishApply.promise;
                order.push("reload:end");
                env.active = { flows: loaded.flows, rev: loaded.rev };
                return loaded.rev;
            };
            const setFlows = env.flows.setFlows;
            env.flows.setFlows = async function() {
                order.push("deploy");
                return setFlows.apply(this, arguments);
            };
            await env.start();
            env.change("B");
            env.notify();
            await applyStarted.promise;
            const deploy = pipeline.deploy({ type: "full", flows: { flows: flowsOf("D") } });
            await delay(10);
            finishApply.resolve();
            await deploy;
            order.should.eql(["reload:start", "reload:end", "deploy"]);
        });
        it("abort on stop cancels reload (SIGTERM during drain)", async function() {
            env = createEnv();
            let payload;
            hooks.add("preReload", p => { payload = p; return new Promise(() => {}) });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => !!payload);
            state.markStopping("SIGTERM");
            payload.signal.aborted.should.be.true();
            payload.signal.reason.should.equal("stopping");
            await delay(20);
            env.applied.should.have.length(0);
            state.get().state.should.equal("stopping");
        });
    });

    describe("diff reload and changes during the drain (D-17)", function() {
        it("diff - preReload gets the changed flows, reload type diff", async function() {
            env = createEnv({ reload: { type: "diff" } });
            const changed = [];
            hooks.add("preReload", p => { changed.push(p.changedFlows.slice()) });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1);
            changed.should.eql([["t1"]]);
            env.applied[0].type.should.equal("diff");
        });
        it("additional preReload for flows changed during drain within remaining timeout", async function() {
            const map = { B: ["t1"], C: ["t1", "t2"] };
            env = createEnv({ reload: { type: "diff", preReloadTimeout: 5000 }, changedFlows: loaded => map[loaded.rev] });
            const calls = [];
            hooks.add("preReload", p => {
                calls.push({ rev: p.rev, changedFlows: p.changedFlows.slice(), deadline: p.deadline, locked: lock.isLocked() });
                if (calls.length === 1) {
                    env.change("C");
                }
            });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1);
            calls.should.have.length(2);
            calls[1].changedFlows.should.eql(["t2"]);
            calls[1].rev.should.equal("C");
            calls[1].deadline.should.equal(calls[0].deadline);
            calls[1].locked.should.be.false();
            env.applied[0].rev.should.equal("C");
            env.logs.warn.some(m => m.indexOf("reload.changed-during-drain") === 0).should.be.true();
        });
        it("additional preReload runs at most one round, then reload with warning", async function() {
            const map = { B: ["t1"], C: ["t1", "t2"], D: ["t1", "t2", "t3"] };
            env = createEnv({ reload: { type: "diff" }, changedFlows: loaded => map[loaded.rev] });
            let calls = 0;
            hooks.add("preReload", p => {
                calls++;
                env.change(calls === 1 ? "C" : "D");
            });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1);
            calls.should.equal(2);
            env.applied[0].rev.should.equal("D");
            env.logs.warn.some(m => m.indexOf("reload.changed-after-extra-drain") === 0).should.be.true();
        });
    });

    describe("storage read failures (R-20, R-36, D-18)", function() {
        it("read failure retries with backoff and keeps flows", async function() {
            env = createEnv({ reload: { retry: { min: 5, max: 20 } } });
            await env.start();
            env.failReads = 2;
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1);
            env.getFlowsCalls.should.be.aboveOrEqual(3);
            env.logs.warn.filter(m => m.indexOf("reload.read-failed") === 0).should.have.length(2);
            state.get().state.should.equal("ready");
        });
        it("read failure after retry.attempts sets failed and ready 503", async function() {
            env = createEnv({ reload: { retry: { min: 1, max: 4, attempts: 3 } } });
            await env.start();
            env.failAlways = true;
            env.change("B");
            let atFailed = null;
            const off = state.onChange(info => { if (info.state === "failed" && atFailed === null) { atFailed = env.getFlowsCalls } });
            env.notify();
            await waitFor(() => state.get().state === "failed");
            off();
            atFailed.should.equal(3);
            state.isReady().should.be.false();
            env.applied.should.have.length(0);
            env.logs.error.some(m => m.indexOf("reload.retries-exhausted") === 0).should.be.true();
            // the next notification tries again and recovers
            env.failAlways = false;
            env.notify();
            await waitFor(() => state.get().state === "ready");
            env.applied.should.have.length(1);
        });
        it("retry.attempts defaults to 10", async function() {
            env = createEnv({ reload: { retry: { min: 1, max: 1 } } });
            await env.start();
            env.failAlways = true;
            let atFailed = null;
            const off = state.onChange(info => { if (info.state === "failed" && atFailed === null) { atFailed = env.getFlowsCalls } });
            env.notify();
            await waitFor(() => state.get().state === "failed");
            off();
            atFailed.should.equal(10);
        });
        it("read failure under the lock returns to the state before the cycle", async function() {
            env = createEnv({ reload: { retry: { min: 5, max: 5 } } });
            let failed = false;
            hooks.add("preReload", p => { if (!failed) { failed = true; env.failReads = 1 } });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1);
            states.slice(0, 3).should.eql(["reloadPending", "reloadPending:draining", "ready"]);
        });
        it("after the retries were exhausted storage is read again every retry.max - back to ready without a notification", async function() {
            env = createEnv({ reload: { retry: { min: 1, max: 15, attempts: 2 } } });
            await env.start();
            env.failAlways = true;
            env.change("B");
            env.notify();
            await waitFor(() => state.get().state === "failed");
            const atFailed = env.getFlowsCalls;
            // still failing: periodic reads, no new "retries exhausted" error
            await waitFor(() => env.getFlowsCalls >= atFailed + 2, 1000, "no periodic read");
            env.logs.error.filter(m => m.indexOf("reload.retries-exhausted") === 0).should.have.length(1);
            state.get().state.should.equal("failed");
            // access restored - no notification needed
            env.failAlways = false;
            await waitFor(() => state.get().state === "ready", 1000, "not back to ready");
            env.applied.should.have.length(1);
            env.applied[0].rev.should.equal("B");
        });
        it("a new retry timer replaces the previous one (no extra cycle)", async function() {
            env = createEnv({ reload: { retry: { min: 30, max: 1000, attempts: 5 } } });
            let first = true;
            hooks.add("preReload", p => {
                if (first) {
                    first = false;
                    // the reread and the coalesced cycle fail; a notification during the cycle
                    env.failReads = 2;
                    env.notify();
                }
            });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1, 2000);
            await delay(150);
            // step 2 + reread (failed) + coalesced step 2 (failed) + one retry (step 2 + reread)
            env.getFlowsCalls.should.equal(5);
        });
        it("the timers of the reloader do not keep the process alive and stop() ends the waits", async function() {
            const recorded = [];
            const realSetTimeout = global.setTimeout;
            global.setTimeout = function() {
                const timer = realSetTimeout.apply(this, arguments);
                if (/flows[\\/]reload\.js/.test(new Error().stack)) {
                    recorded.push(timer);
                }
                return timer;
            };
            try {
                env = createEnv({ reload: { retry: { min: 600000, max: 600000, attempts: 3 } } });
                await env.start();
                env.failReads = 1;
                env.change("B");
                env.notify();
                await waitFor(() => recorded.length > 0);
                // a cycle waiting for another operation sleeps retry.min
                await lock.runExclusive(async function() {
                    const token = state.begin("set-state", { supersede: true });
                    env.notify();
                    await delay(10);
                    state.end(token, { errors: [] });
                });
                await waitFor(() => recorded.length > 1);
            } finally {
                global.setTimeout = realSetTimeout;
            }
            recorded.forEach(t => t.hasRef().should.be.false());
            await env.reloader.stop();
            recorded.forEach(t => t._destroyed.should.be.true());
        });
        it("storage is read strictly (getFlows({strict: true})) in both reads of the cycle", async function() {
            env = createEnv();
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1);
            env.getFlowsArgs.should.have.length(2);
            env.getFlowsArgs.forEach(a => a.should.eql({ strict: true }));
        });
        describe("with the file storage (review regression)", function() {
            const fsx = require("fs-extra");
            const osx = require("os");
            const pathx = require("path");
            const cryptox = require("crypto");
            const STORAGE_DIR = pathx.dirname(NR_TEST_UTILS.resolve("@node-red/runtime/lib/storage/localfilesystem/index.js"));
            let savedCache;
            let lfs;
            let dir;
            before(function() {
                // a fresh copy: the Projects tests keep a module state
                savedCache = {};
                Object.keys(require.cache).forEach(function(k) {
                    if (k.startsWith(STORAGE_DIR + pathx.sep)) {
                        savedCache[k] = require.cache[k];
                        delete require.cache[k];
                    }
                });
                lfs = require(pathx.join(STORAGE_DIR, "index.js"));
            });
            after(function() {
                Object.keys(require.cache).forEach(function(k) {
                    if (k.startsWith(STORAGE_DIR + pathx.sep)) {
                        delete require.cache[k];
                    }
                });
                Object.assign(require.cache, savedCache);
            });
            afterEach(function() {
                if (dir) {
                    fsx.removeSync(dir);
                    dir = null;
                }
            });
            async function fileEnv(reload) {
                dir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), "nr-reload-file-"));
                const flowFile = pathx.join(dir, "flows.json");
                fsx.writeFileSync(flowFile, JSON.stringify(flowsOf("A")));
                const rlog = { _: () => "x", info() {}, warn() {}, trace() {}, debug() {}, error() {} };
                await lfs.init({ userDir: dir, flowFile: "flows.json", readOnlyUserDir: true, getUserSettings: () => ({}) }, { log: rlog });
                const e = createEnv({ reload: reload });
                e.storage.getFlows = async function(readOpts) {
                    e.getFlowsCalls++;
                    const flows = await lfs.getFlows(readOpts);
                    const creds = await lfs.getCredentials(readOpts);
                    return { flows: flows, rev: cryptox.createHash("sha256").update(JSON.stringify(flows)).digest("hex"), credentials: creds };
                };
                e.active = await e.storage.getFlows();
                e.flowFile = flowFile;
                return e;
            }
            [["invalid JSON", "[{\"id\":\"t1\",\"type\":\"ta"], ["an empty file", ""], ["a missing file", null]].forEach(function(entry) {
                it(entry[0] + " during the reload - flows unchanged, retries, then failed", async function() {
                    env = await fileEnv({ retry: { min: 2, max: 60000, attempts: 3 } });
                    const before = env.active;
                    const d = deferred();
                    let payload;
                    hooks.add("preReload", p => { payload = p; return d.promise });
                    await env.start();
                    fsx.writeFileSync(env.flowFile, JSON.stringify(flowsOf("B")));
                    env.notify({});
                    await waitFor(() => !!payload);
                    // a non-atomic write by another writer is in progress during the reread
                    if (entry[1] === null) {
                        fsx.removeSync(env.flowFile);
                    } else {
                        fsx.writeFileSync(env.flowFile, entry[1]);
                    }
                    d.resolve();
                    await waitFor(() => state.get().state === "failed", 2000);
                    env.applied.should.have.length(0);
                    env.active.should.equal(before);
                    env.getFlowsCalls.should.be.aboveOrEqual(4);
                    states.should.containEql("ready");
                    // nothing written next to the flow file (readOnlyUserDir)
                    fsx.readdirSync(dir).filter(n => n.indexOf("flows") !== -1).length.should.be.belowOrEqual(1);
                });
            });
        });
    });

    describe("concurrency (Z-10 slots)", function() {
        it("concurrency waits for slot without draining", async function() {
            let attempts = 0;
            let allow = false;
            const release = sinon.spy(async function() {});
            env = createEnv({
                reload: { concurrency: 2, retry: { min: 5, max: 5 } },
                localCoordination: false,
                claimSlot: async function(name, limit) {
                    attempts++;
                    name.should.equal("reload");
                    limit.should.equal(2);
                    return allow ? { key: "slot:reload:1", release: release } : null;
                }
            });
            const hook = sinon.spy();
            hooks.add("preReload", function(payload) { hook(payload) });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => attempts >= 2);
            state.get().state.should.equal("reloadPending");
            state.get().draining.should.be.false();
            state.isReady().should.be.true();
            hook.called.should.be.false();
            env.applied.should.have.length(0);
            allow = true;
            await waitFor(() => env.applied.length === 1);
            hook.calledOnce.should.be.true();
            release.calledOnce.should.be.true();
        });
        it("claim rejection keeps old config and retries", async function() {
            let attempts = 0;
            env = createEnv({
                reload: { concurrency: 1, retry: { min: 5, max: 10 } },
                localCoordination: false,
                claimSlot: async function() {
                    attempts++;
                    if (attempts < 3) {
                        throw new Error("no connection");
                    }
                    return { key: "slot:reload:0", release: async function() {} };
                }
            });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => attempts === 2);
            state.get().state.should.equal("reloadPending");
            state.isReady().should.be.true();
            env.active.rev.should.equal("A");
            await waitFor(() => env.applied.length === 1);
            env.logs.warn.filter(m => m.indexOf("reload.slot-claim-failed") === 0).length.should.be.aboveOrEqual(2);
        });
        it("concurrency without cluster plugin warns and has no effect", async function() {
            env = createEnv({ reload: { concurrency: 1 } });
            await env.start();
            env.logs.warn.some(m => m.indexOf("reload.concurrency-local") === 0).should.be.true();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1);
            env.coordination.claimSlot.called.should.be.false();
        });
        it("concurrency accepts only numbers", async function() {
            env = createEnv({ reload: { concurrency: "50%" }, localCoordination: false });
            env.logs.warn.some(m => m.indexOf("reload.invalid-concurrency") === 0).should.be.true();
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1);
            env.coordination.claimSlot.called.should.be.false();
        });
        it("slot released after reload", async function() {
            env = createEnv({ reload: { concurrency: 1 }, localCoordination: false });
            await env.start();
            env.change("B");
            env.notify();
            await waitFor(() => env.applied.length === 1 && env.claims.length === 1 && env.claims[0].release.called);
        });
    });

    describe("health.unreadyGrace (Z-16)", function() {
        let clock;
        let notReadyAt;

        beforeEach(function() {
            notReadyAt = null;
        });
        afterEach(function() {
            if (clock) {
                clock.restore();
                clock = null;
            }
        });

        // Fake time; `health` is the health setting of the runtime
        function setup(health, reload, extra) {
            clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
            env = createEnv(Object.assign({ reload: reload || {} }, extra || {}));
            if (health !== undefined) {
                env.runtime.settings.health = health;
            }
            env.reloader.init(env.runtime);
            state.onChange(info => {
                if (info.draining && notReadyAt === null) {
                    notReadyAt = Date.now();
                }
            });
            return env;
        }
        async function trigger() {
            await env.start();
            env.change("B");
            env.notify();
        }

        it("not set - the flows are reloaded without a wait", async function() {
            setup({ enabled: true });
            await trigger();
            await clock.tickAsync(0);
            env.applied.should.have.length(1);
            env.logs.info.some(m => m.indexOf("reload.unready-grace") === 0).should.be.false();
        });

        it("on - the reload happens no earlier than the grace after /ready turned 503", async function() {
            setup({ enabled: true, unreadyGrace: 500 });
            await trigger();
            await clock.tickAsync(499);
            notReadyAt.should.equal(0);
            state.isReady().should.be.false();
            env.applied.should.have.length(0);
            await clock.tickAsync(1);
            env.applied.should.have.length(1);
            Date.now().should.equal(500);
            await clock.tickAsync(0);
            state.get().state.should.equal("ready");
            env.logs.info.some(m => m.indexOf("reload.unready-grace") === 0).should.be.true();
        });

        it("on - a hook longer than the grace adds no wait", async function() {
            setup({ enabled: true, unreadyGrace: 500 });
            hooks.add("preReload", p => new Promise(resolve => setTimeout(resolve, 800)));
            await trigger();
            await clock.tickAsync(799);
            env.applied.should.have.length(0);
            await clock.tickAsync(1);
            env.applied.should.have.length(1);
            Date.now().should.equal(800);
        });

        it("on - a hook shorter than the grace still waits for the grace", async function() {
            setup({ enabled: true, unreadyGrace: 500 });
            hooks.add("preReload", p => new Promise(resolve => setTimeout(resolve, 100)));
            await trigger();
            await clock.tickAsync(499);
            env.applied.should.have.length(0);
            await clock.tickAsync(1);
            env.applied.should.have.length(1);
        });

        it("on - a failing hook does not shorten the grace", async function() {
            setup({ enabled: true, unreadyGrace: 500 });
            hooks.add("preReload", p => { throw new Error("boom") });
            await trigger();
            await clock.tickAsync(499);
            env.applied.should.have.length(0);
            env.logs.error.some(m => m.indexOf("reload.hook-failed") === 0).should.be.true();
            await clock.tickAsync(1);
            env.applied.should.have.length(1);
        });

        it("is counted inside preReloadTimeout: capped by it", async function() {
            setup({ enabled: true, unreadyGrace: 5000 }, { preReloadTimeout: 300 });
            await trigger();
            await clock.tickAsync(299);
            env.applied.should.have.length(0);
            await clock.tickAsync(1);
            env.applied.should.have.length(1);
            Date.now().should.equal(300);
        });

        it("a deployment on this instance ends the grace and supersedes the reload", async function() {
            setup({ enabled: true, unreadyGrace: 60000 });
            await trigger();
            await clock.tickAsync(100);
            state.get().draining.should.be.true();
            const result = await pipeline.deploy({ type: "full", source: "api", flows: { flows: flowsOf("D") } });
            result.rev.should.equal("deployed");
            await clock.tickAsync(0);
            env.applied.should.have.length(0);
            clock.countTimers().should.equal(0);
        });

        it("a stop of the reloader ends the grace without a reload", async function() {
            setup({ enabled: true, unreadyGrace: 60000 });
            await trigger();
            await clock.tickAsync(100);
            await env.reloader.stop();
            await clock.tickAsync(0);
            env.applied.should.have.length(0);
            clock.countTimers().should.equal(0);
        });

        it("the stop of the runtime (state stopping) ends the grace", async function() {
            setup({ enabled: true, unreadyGrace: 60000 });
            await trigger();
            await clock.tickAsync(100);
            state.markStopping("SIGTERM");
            await clock.tickAsync(0);
            env.applied.should.have.length(0);
            clock.countTimers().should.equal(0);
        });

        it("invalid values and no health.enabled - no wait", async function() {
            for (const health of [{ enabled: true, unreadyGrace: "500" }, { enabled: true, unreadyGrace: -5 }, { enabled: true, unreadyGrace: NaN }, { unreadyGrace: 500 }, { enabled: true, unreadyGrace: 0 }]) {
                if (env) {
                    await env.reloader.stop();
                    clock.restore();
                    state.reset();
                    state.markStarting();
                    state.report({ errors: [] });
                }
                setup(health);
                await trigger();
                await clock.tickAsync(0);
                env.applied.should.have.length(1, JSON.stringify(health));
            }
        });

        it("an editor deployment is not delayed", async function() {
            setup({ enabled: true, unreadyGrace: 60000 });
            await env.start();
            const result = await pipeline.deploy({ type: "full", source: "api", flows: { flows: flowsOf("D") } });
            result.rev.should.equal("deployed");
            Date.now().should.equal(0);
        });
    });
});
