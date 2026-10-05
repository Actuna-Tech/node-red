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
 *   #1 (R-47): tests of deploy.reload.retry.onExhausted / maxStaleTime (the
 *   condition `reload`, /ready warn, active reporting)
 *   #17: tests of the counting of the failures until the cycle succeeds (an error
 *   of the reread under the lock or of the reload step exhausts the retries;
 *   notifications reset the delay, not the count)
 *   #26: tests of the explicit reset of the counters in a new series and of the
 *   cancelled retry after a successful cycle, a retry that fires during a running
 *   cycle (retryQueued)
 *   #2: tests of the comparison of the credentials (the digest of the decrypted
 *   content): a change of the credentials alone, the flag of a notification as a
 *   hint, re-encryption, an own save, a key that does not decrypt; credentials changed
 *   during the drain of a diff reload (the extra preReload round for all flows); a running
 *   configuration without a digest (credentials that could not be decrypted at start)
 *   #43: `type` of the preReload payload is the configured one - the scope is decided by
 *   changedFlows (documented); an unusual object of the storage in digest() (SEC-004):
 *   credentials_digest_failed without the message of the cause in the log, the R2 rule
 *   #56 (REV-N01): the tests with the real credentials module drop its state after each test
 *   (init() resets a migration that was started and not finished by a failed test)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const sinon = require("sinon");
const NR_TEST_UTILS = require("nr-test-utils");
const reloadModule = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/reload");
const pipeline = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/pipeline");
const lock = NR_TEST_UTILS.require("@node-red/runtime/lib/flows/lock");
const state = NR_TEST_UTILS.require("@node-red/runtime/lib/state");
const health = NR_TEST_UTILS.require("@node-red/runtime/lib/health");
const hooks = NR_TEST_UTILS.require("@node-red/util").hooks;
const events = NR_TEST_UTILS.require("@node-red/util").events;

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

// #2: the mock of flows.credentialsChanged compares the CONTENT of the credentials, as
// the digest does: the encrypted form is "<content>:<iv>" - the same content with
// another iv is the same credentials; a plain object is its own content
function contentOf(creds) {
    return (creds && typeof creds.$ === "string") ? creds.$.split(":")[0] : JSON.stringify(creds || {});
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
        // the content of the credentials of the active configuration (#2)
        activeCredentials: contentOf({}),
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
                throw env.failError || new Error("storage unavailable");
            }
            return JSON.parse(JSON.stringify(env.stored));
        },
        saveFlows: sinon.spy(async function() {})
    };
    env.flows = {
        getFlows: () => env.active,
        credentialsChanged: sinon.spy(function(loaded) {
            if (env.credentialsError) {
                throw env.credentialsError;
            }
            return contentOf(loaded.credentials) !== env.activeCredentials;
        }),
        // false: the running configuration has no digest of its credentials (#2)
        hasCredentialsRevision: () => env.credentialsKnown !== false,
        getChangedFlows: sinon.spy(function(loaded) {
            return opts.changedFlows ? opts.changedFlows(loaded, env.active) : ["t1"];
        }),
        reloadFromStorage: sinon.spy(async function(loaded, reloadOpts) {
            if (env.reloadError) {
                throw env.reloadError;
            }
            env.applied.push({ rev: loaded.rev, type: reloadOpts.type, credentialsChanged: reloadOpts.credentialsChanged, locked: lock.isLocked() });
            env.active = { flows: loaded.flows, rev: loaded.rev };
            env.activeCredentials = contentOf(loaded.credentials);
            if (!env.idle) {
                lock.holdUntil(Promise.resolve({ errors: env.startErrors || [] }));
            }
            return loaded.rev;
        }),
        setFlows: sinon.spy(async function(flows, creds) {
            env.active = { flows: flows, rev: "deployed" };
            env.stored = { flows: flows, rev: "deployed", credentials: creds || {} };
            env.activeCredentials = contentOf(env.stored.credentials);
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
        describe("credentials (#2)", function() {
            // The credentials are compared by the digest of their decrypted content
            // (the mock of flows.credentialsChanged, see contentOf); the `credentialsChanged`
            // flag of a notification is only a hint to read storage
            it("a change of the credentials alone, a notification without the flag - a full reload", async function() {
                env = createEnv({ reload: { type: "diff" } });
                let payload;
                hooks.add("preReload", p => { payload = p });
                await env.start();
                env.change("A", { credentials: { $: "new:iv1" } });
                env.notify({ rev: "A" });
                await waitFor(() => env.applied.length === 1);
                // the diff does not see the credentials: a full reload
                env.applied[0].type.should.equal("full");
                env.applied[0].credentialsChanged.should.be.true();
                // computed, not copied from the notification
                payload.credentialsChanged.should.be.true();
                should(payload.changedFlows).be.null();
                env.activeCredentials.should.equal("new");
            });
            it("the preReload payload of a diff reload with changed credentials: type is the configured one, the scope is changedFlows null (#43)", async function() {
                // documented contract: `type` is the configured type, not the actual one; the scope
                // of the reload is decided by `changedFlows` (null = all flows)
                env = createEnv({ reload: { type: "diff" } });
                let payload;
                hooks.add("preReload", p => { payload = p });
                await env.start();
                env.change("A", { credentials: { $: "new:iv1" } });
                env.notify();
                await waitFor(() => env.applied.length === 1);
                payload.type.should.equal("diff");
                should(payload.changedFlows).be.null();
                env.applied[0].type.should.equal("full");
            });
            it("a change of the credentials alone, a notification with the flag false - a reload", async function() {
                env = createEnv();
                await env.start();
                env.change("A", { credentials: { $: "new:iv1" } });
                env.notify({ credentialsChanged: false });
                await waitFor(() => env.applied.length === 1);
                env.applied[0].credentialsChanged.should.be.true();
            });
            it("a lost notification heals: the next notification without the flag reloads the credentials", async function() {
                env = createEnv();
                await env.start();
                // another instance changed the credentials, the notification about it was lost
                env.change("A", { credentials: { $: "new:iv1" } });
                env.notify();
                await waitFor(() => env.applied.length === 1);
                env.applied[0].credentialsChanged.should.be.true();
            });
            it("the flag with unchanged revision and credentials - no reload, no drain, no preReload", async function() {
                env = createEnv();
                const hook = sinon.spy();
                hooks.add("preReload", hook);
                await env.start();
                env.notify({ credentialsChanged: true });
                await waitFor(() => env.getFlowsCalls === 1);
                await delay(20);
                env.applied.should.have.length(0);
                hook.called.should.be.false();
                states.should.eql([]);
            });
            it("the flag does not force a reload either with a new revision and the same credentials: the payload is computed", async function() {
                env = createEnv();
                let payload;
                hooks.add("preReload", p => { payload = p });
                await env.start();
                env.change("B");
                env.notify({ credentialsChanged: true });
                await waitFor(() => env.applied.length === 1);
                payload.credentialsChanged.should.be.false();
                env.applied[0].credentialsChanged.should.be.false();
            });
            it("re-encryption of the same content (another iv) - no reload", async function() {
                env = createEnv();
                env.activeCredentials = "same";
                const hook = sinon.spy();
                hooks.add("preReload", hook);
                await env.start();
                env.change("A", { credentials: { $: "same:iv2" } });
                env.notify({ credentialsChanged: true });
                env.notify();
                await waitFor(() => env.getFlowsCalls >= 1);
                await delay(20);
                env.applied.should.have.length(0);
                hook.called.should.be.false();
                states.should.eql([]);
            });
            it("an own save with credentialsDirty - the notification of it reloads nothing", async function() {
                env = createEnv();
                await env.start();
                // the deployment saves the flows and the (re-encrypted) credentials, storage notifies
                await pipeline.deploy({ type: "full", source: "api", flows: { flows: flowsOf("D"), credentials: { $: "own:iv1" }, credentialsDirty: true } });
                await waitFor(() => state.get().state === "ready");
                env.stored.credentials.should.eql({ $: "own:iv1" });
                env.getFlowsCalls = 0;
                env.notify({ rev: "deployed", credentialsChanged: true });
                await waitFor(() => env.getFlowsCalls === 1);
                await delay(20);
                env.applied.should.have.length(0);
                // the same content saved by another instance with another iv: still nothing
                env.change("deployed", { credentials: { $: "own:iv9" } });
                env.stored.flows = env.active.flows;
                env.notify({ credentialsChanged: true });
                await waitFor(() => env.getFlowsCalls === 2);
                await delay(20);
                env.applied.should.have.length(0);
            });
            it("the credentials changed during the drain of a diff reload - one more preReload round for all flows, then a full reload", async function() {
                env = createEnv({ reload: { type: "diff" } });
                const d = deferred();
                const calls = [];
                hooks.add("preReload", p => {
                    calls.push({ rev: p.rev, type: p.type, changedFlows: p.changedFlows && p.changedFlows.slice(), credentialsChanged: p.credentialsChanged, locked: lock.isLocked() });
                    return calls.length === 1 ? d.promise : undefined;
                });
                await env.start();
                env.change("B");
                env.notify();
                await waitFor(() => calls.length === 1);
                calls[0].should.containEql({ type: "diff", credentialsChanged: false });
                calls[0].changedFlows.should.eql(["t1"]);
                env.change("B", { credentials: { $: "late:iv1" } });
                d.resolve();
                await waitFor(() => env.applied.length === 1);
                // the contract: what is restarted (all flows) is drained
                calls.should.have.length(2);
                calls[1].should.containEql({ rev: "B", credentialsChanged: true, locked: false });
                should(calls[1].changedFlows).be.null();
                env.applied[0].should.containEql({ rev: "B", type: "full", credentialsChanged: true });
                env.logs.warn.some(m => m.indexOf("reload.changed-during-drain") === 0 && m.indexOf('"*"') !== -1).should.be.true();
            });
            it("the credentials changed during the second round of a diff reload - at most one more round, a full reload with a warning", async function() {
                const map = { B: ["t1"], C: ["t1", "t2"] };
                env = createEnv({ reload: { type: "diff" }, changedFlows: loaded => map[loaded.rev] });
                const calls = [];
                hooks.add("preReload", p => {
                    calls.push({ rev: p.rev, changedFlows: p.changedFlows && p.changedFlows.slice(), credentialsChanged: p.credentialsChanged });
                    if (calls.length === 1) {
                        env.change("C");
                    } else if (calls.length === 2) {
                        env.change("C", { credentials: { $: "late:iv1" } });
                    }
                });
                await env.start();
                env.change("B");
                env.notify();
                await waitFor(() => env.applied.length === 1);
                calls.should.have.length(2);
                calls[1].changedFlows.should.eql(["t2"]);
                calls[1].credentialsChanged.should.be.false();
                env.applied[0].should.containEql({ rev: "C", type: "full", credentialsChanged: true });
                env.logs.warn.some(m => m.indexOf("reload.changed-after-extra-drain") === 0 && m.indexOf('"*"') !== -1).should.be.true();
            });
            it("the credentials changed with the flows in the first drain - the extra round is for all flows", async function() {
                const map = { B: ["t1"], C: ["t1", "t2"] };
                env = createEnv({ reload: { type: "diff" }, changedFlows: loaded => map[loaded.rev] });
                const calls = [];
                hooks.add("preReload", p => {
                    calls.push({ rev: p.rev, changedFlows: p.changedFlows && p.changedFlows.slice(), credentialsChanged: p.credentialsChanged });
                    if (calls.length === 1) {
                        env.change("C", { credentials: { $: "late:iv1" } });
                    }
                });
                await env.start();
                env.change("B");
                env.notify();
                await waitFor(() => env.applied.length === 1);
                calls.should.have.length(2);
                should(calls[1].changedFlows).be.null();
                calls[1].should.containEql({ rev: "C", credentialsChanged: true });
                env.applied[0].should.containEql({ rev: "C", type: "full", credentialsChanged: true });
            });
            it("the credentials changed back during the drain, same revision - nothing is reloaded", async function() {
                env = createEnv();
                const d = deferred();
                let payload;
                hooks.add("preReload", p => { payload = p; return d.promise });
                await env.start();
                env.change("A", { credentials: { $: "tmp:iv1" } });
                env.notify();
                await waitFor(() => !!payload);
                payload.credentialsChanged.should.be.true();
                env.change("A", { credentials: {} });
                d.resolve();
                await waitFor(() => state.get().state === "ready" && states.length >= 3);
                env.applied.should.have.length(0);
            });
            describe("a running configuration without a digest of its credentials", function() {
                // it started with credentials that could not be decrypted (a reset), see flows.hasCredentialsRevision
                const undecryptable = () => Object.assign(new Error("Failed to decrypt credentials"), { code: "credentials_load_failed" });
                const retry = { min: 2, max: 60000, attempts: 1, onExhausted: "keepReady" };
                it("the same revision, credentials that cannot be decrypted - not an error, nothing happens (as before #2)", async function() {
                    env = createEnv({ reload: { retry: retry } });
                    env.credentialsKnown = false;
                    env.credentialsError = undecryptable();
                    const hook = sinon.spy();
                    hooks.add("preReload", hook);
                    await env.start();
                    env.change("A", { credentials: { $: "cipher:iv1" } });
                    env.notify({ credentialsChanged: true });
                    env.notify();
                    await waitFor(() => env.getFlowsCalls >= 2);
                    await delay(30);
                    env.applied.should.have.length(0);
                    hook.called.should.be.false();
                    states.should.eql([]);
                    state.get().state.should.equal("ready");
                    state.get().should.not.have.property("reload");
                    env.logs.warn.some(m => m.indexOf("reload.read-failed") === 0).should.be.false();
                    env.logs.debug.some(m => m.indexOf("cannot be decrypted (credentials_load_failed)") !== -1).should.be.true();
                    JSON.stringify(env.logs).should.not.containEql("cipher:iv1");
                });
                it("a new revision goes the normal way: credentials_load_failed", async function() {
                    env = createEnv({ reload: { retry: retry } });
                    env.credentialsKnown = false;
                    env.credentialsError = undecryptable();
                    await env.start();
                    env.change("B", { credentials: { $: "cipher:iv1" } });
                    env.notify();
                    await waitFor(() => state.get().state === "failed", 2000, "not failed");
                    state.get().reload.should.containEql({ error: { code: "credentials_load_failed" }, keepReady: false });
                    env.applied.should.have.length(0);
                });
                it("with a digest the same revision and credentials that cannot be decrypted is still an error", async function() {
                    env = createEnv({ reload: { retry: retry } });
                    env.credentialsError = undecryptable();
                    await env.start();
                    env.change("A", { credentials: { $: "cipher:iv1" } });
                    env.notify();
                    await waitFor(() => state.get().state === "failed", 2000, "not failed");
                    state.get().reload.should.containEql({ error: { code: "credentials_load_failed" } });
                });
                it("the reread under the lock: the revision is the running one again and the credentials cannot be decrypted - unchanged", async function() {
                    env = createEnv({ reload: { retry: retry } });
                    env.credentialsKnown = false;
                    const d = deferred();
                    let payload;
                    hooks.add("preReload", p => { payload = p; return d.promise });
                    await env.start();
                    env.change("B");
                    env.notify();
                    await waitFor(() => !!payload);
                    env.credentialsError = undecryptable();
                    env.change("A", { credentials: { $: "cipher:iv1" } });
                    d.resolve();
                    await waitFor(() => state.get().state === "ready" && states.length >= 3);
                    env.applied.should.have.length(0);
                    state.get().should.not.have.property("reload");
                });
            });
            describe("with the real credentials module (random iv, key)", function() {
                const credentialsModule = NR_TEST_UTILS.require("@node-red/runtime/lib/nodes/credentials");
                const settingsValues = { credentialSecret: "a user key for the credentials of the reload tests" };
                let digestOfActive;
                function initCredentials(secretSettings) {
                    credentialsModule.init({
                        log: { _: k => k, warn() {}, debug() {}, info() {}, error() {}, trace() {} },
                        settings: { get: key => secretSettings[key], set: async () => {}, delete: async key => { delete secretSettings[key] } },
                        nodes: { getType: () => function() {} }
                    });
                }
                afterEach(function() {
                    // #56 (REV-N01): a test of a pending migration may stop on a failed assertion before it
                    // ends the migration with export(). load() then leaves removeDefaultKey set in the module,
                    // and the next redeploy of a later spec gets "settings.not-available". init() resets the
                    // flag, so this drops the state of the instance whatever way the test ended (it cannot
                    // throw and does not depend on the settings of the test, unlike an export() in a finally).
                    initCredentials(settingsValues);
                });
                async function encryptedWith(content, secretSettings) {
                    initCredentials(secretSettings);
                    await credentialsModule.load({});
                    for (const id of Object.keys(content)) {
                        await credentialsModule.add(id, content[id]);
                    }
                    return credentialsModule.export();
                }
                // the flows mock backed by the digest of the real module
                function useRealDigest(e) {
                    e.flows.credentialsChanged = function(loaded) {
                        return credentialsModule.digest(loaded.credentials) !== digestOfActive;
                    };
                    e.flows.reloadFromStorage = sinon.spy(async function(loaded, reloadOpts) {
                        digestOfActive = credentialsModule.digest(loaded.credentials);
                        e.applied.push({ rev: loaded.rev, type: reloadOpts.type, credentialsChanged: reloadOpts.credentialsChanged });
                        e.active = { flows: loaded.flows, rev: loaded.rev };
                        return loaded.rev;
                    });
                }
                it("a notification during a pending migration from the default key to a user key: no credentials_load_failed, no reload", async function() {
                    const defaultKey = "e3a36f47f005bf2aaa51ce3fc6fcaafd79da8d03f2b1a9281f8fb0a285e6255a";
                    // {"node":{user1:"abc",password1:"123"}} encrypted with the default key
                    const old = { "$": "5b89d8209b5158a3c313675561b1a5b5phN1gDBe81Zv98KqS/hVDmc9EKvaKqRIvcyXYvBlFNzzzJtvN7qfw06i" };
                    const migrating = { _credentialSecret: defaultKey, credentialSecret: "a user key that replaces the default one" };
                    env = createEnv({ reload: { retry: { min: 2, max: 60000, attempts: 1, onExhausted: "keepReady" } } });
                    initCredentials(migrating);
                    await credentialsModule.load(old);
                    credentialsModule.dirty().should.be.true();
                    digestOfActive = credentialsModule.digest(old);
                    useRealDigest(env);
                    await env.start();
                    env.change("A", { credentials: old });
                    env.notify({ credentialsChanged: true });
                    env.notify();
                    await waitFor(() => env.getFlowsCalls >= 1);
                    await delay(30);
                    env.applied.should.have.length(0);
                    states.should.eql([]);
                    state.get().should.not.have.property("reload");
                    // the first save migrates; storage then holds the same content under the user key
                    const saved = await credentialsModule.export();
                    saved["$"].should.not.equal(old["$"]);
                    env.change("A", { credentials: saved });
                    env.notify({ credentialsChanged: true });
                    await waitFor(() => env.getFlowsCalls >= 3);
                    await delay(30);
                    env.applied.should.have.length(0);
                    state.get().should.not.have.property("reload");
                });
                describe("an unusual object of the storage in digest() (SEC-004, #43)", function() {
                    const SECRET = "secret-getter-0123456789";
                    const retry = { min: 2, max: 60000, attempts: 1, onExhausted: "keepReady" };
                    const throwing = () => ({ n1: { get password() { throw new Error("boom " + SECRET) } } });
                    function useObjectStorage(e) {
                        // the storage hands over the object itself (the mock clones through JSON)
                        e.storage.getFlows = async function() {
                            e.getFlowsCalls++;
                            return e.stored;
                        };
                    }
                    it("a new revision: the error goes on as reload_failed, the log has no secret", async function() {
                        env = createEnv({ reload: { retry: retry } });
                        initCredentials(settingsValues);
                        digestOfActive = credentialsModule.digest({ n1: { user: "abc" } });
                        useRealDigest(env);
                        useObjectStorage(env);
                        await env.start();
                        env.change("B", { credentials: throwing() });
                        env.notify();
                        await waitFor(() => state.get().state === "failed", 2000, "not failed");
                        state.get().reload.should.containEql({ error: { code: "reload_failed" } });
                        env.applied.should.have.length(0);
                        JSON.stringify(env.logs).should.not.containEql(SECRET);
                        JSON.stringify(state.get()).should.not.containEql(SECRET);
                        env.logs.warn.some(m => m.indexOf("reload.read-failed") === 0 && m.indexOf("Failed to compute the credentials digest") !== -1).should.be.true();
                    });
                    it("the same revision with a known digest of the running credentials: still an error", async function() {
                        env = createEnv({ reload: { retry: retry } });
                        initCredentials(settingsValues);
                        digestOfActive = credentialsModule.digest({ n1: { user: "abc" } });
                        useRealDigest(env);
                        useObjectStorage(env);
                        await env.start();
                        env.change("A", { credentials: throwing() });
                        env.notify();
                        await waitFor(() => state.get().state === "failed", 2000, "not failed");
                        state.get().reload.should.containEql({ error: { code: "reload_failed" } });
                        JSON.stringify(env.logs).should.not.containEql(SECRET);
                    });
                    it("the same revision, the running credentials have no digest (R2 of #2): not an error, nothing happens", async function() {
                        env = createEnv({ reload: { retry: retry } });
                        env.credentialsKnown = false;
                        initCredentials(settingsValues);
                        useRealDigest(env);
                        useObjectStorage(env);
                        await env.start();
                        env.change("A", { credentials: throwing() });
                        env.notify();
                        await waitFor(() => env.getFlowsCalls >= 1);
                        await delay(30);
                        env.applied.should.have.length(0);
                        states.should.eql([]);
                        state.get().should.not.have.property("reload");
                        env.logs.debug.some(m => m.indexOf("(credentials_digest_failed)") !== -1).should.be.true();
                        JSON.stringify(env.logs).should.not.containEql(SECRET);
                    });
                });
                it("re-encryption (a new iv, another ciphertext) is no reload; another content is one; a wrong key is credentials_load_failed", async function() {
                    env = createEnv({ reload: { retry: { min: 2, max: 60000, attempts: 1, onExhausted: "keepReady" } } });
                    const first = await encryptedWith({ n1: { user: "abc", password: "123" } }, settingsValues);
                    const again = await encryptedWith({ n1: { password: "123", user: "abc" } }, settingsValues);
                    first["$"].should.not.equal(again["$"]);
                    digestOfActive = credentialsModule.digest(first);
                    useRealDigest(env);
                    await env.start();
                    env.change("A", { credentials: again });
                    env.notify({ credentialsChanged: true });
                    await waitFor(() => env.getFlowsCalls === 1);
                    await delay(20);
                    env.applied.should.have.length(0);
                    states.should.eql([]);
                    // another content with the same key: a reload without the flag
                    const changed = await encryptedWith({ n1: { user: "abc", password: "124" } }, settingsValues);
                    env.change("A", { credentials: changed });
                    env.notify();
                    await waitFor(() => env.applied.length === 1);
                    env.applied[0].credentialsChanged.should.be.true();
                    // the credentials of storage were encrypted with another key
                    const foreign = await encryptedWith({ n1: { user: "abc", password: "124" } }, { credentialSecret: "another key" });
                    initCredentials(settingsValues);
                    await credentialsModule.load(changed);
                    env.change("A", { credentials: foreign });
                    env.notify();
                    await waitFor(() => state.get().state === "failed", 2000, "not failed");
                    state.get().reload.should.containEql({ error: { code: "credentials_load_failed" }, keepReady: false });
                    env.applied.should.have.length(1);
                });
            });
            it("a key that does not decrypt the credentials (step 2) - credentials_load_failed, nothing reloaded, flows keep running", async function() {
                env = createEnv({ reload: { retry: { min: 2, max: 60000, attempts: 1, onExhausted: "keepReady" } } });
                env.credentialsError = Object.assign(new Error("Failed to decrypt credentials"), { code: "credentials_load_failed" });
                const hook = sinon.spy();
                hooks.add("preReload", hook);
                await env.start();
                env.change("A", { credentials: { $: "new:iv1" } });
                env.notify({ credentialsChanged: true });
                await waitFor(() => state.get().state === "failed", 2000, "not failed");
                state.get().reload.should.containEql({ error: { code: "credentials_load_failed" }, keepReady: false });
                env.applied.should.have.length(0);
                hook.called.should.be.false();
                env.flows.reloadFromStorage.called.should.be.false();
                env.logs.warn.some(m => m.indexOf("reload.read-failed") === 0).should.be.true();
                // the error message is the fixed one and does not carry the credentials
                JSON.stringify(env.logs).should.not.containEql("new:iv1");
            });
            it("a key that does not decrypt the credentials of the newest revision (the reread under the lock) - credentials_load_failed", async function() {
                env = createEnv({ reload: { retry: { min: 2, max: 60000, attempts: 1, onExhausted: "keepReady" } } });
                const d = deferred();
                let payload;
                hooks.add("preReload", p => { payload = p; return d.promise });
                await env.start();
                env.change("B");
                env.notify();
                await waitFor(() => !!payload);
                env.credentialsError = Object.assign(new Error("Failed to decrypt credentials"), { code: "credentials_load_failed" });
                d.resolve();
                await waitFor(() => state.get().state === "failed", 2000, "not failed");
                state.get().reload.should.containEql({ error: { code: "credentials_load_failed" }, keepReady: false });
                env.applied.should.have.length(0);
                env.active.rev.should.equal("A");
            });
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
            // R-47: the default mode - the condition is the fact, the policy is R-36
            // R-47: the default mode sets no condition at all (R-36 exactly as before)
            state.get().should.not.have.property("reload");
            health.readiness({ ready: state.isReady(), reload: state.get().reload }, Date.now()).status.should.equal(503);
            // the next notification tries again and recovers
            env.failAlways = false;
            env.notify();
            await waitFor(() => state.get().state === "ready");
            env.applied.should.have.length(1);
            state.get().should.not.have.property("reload");
            health.readiness({ ready: state.isReady(), reload: state.get().reload }, Date.now()).should.eql({ status: 200, body: '{"status":"ok"}' });
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

    describe("deploy.reload.retry.onExhausted and maxStaleTime (R-47)", function() {
        const READY_OK = { status: 200, body: '{"status":"ok"}' };
        const READY_WARN = { status: 200, body: '{"status":"warn","reason":"reload_failed"}' };
        const READY_503 = { status: 503, body: '{"status":"unavailable"}' };
        let clock;
        let runtimeEvents;
        let stateEvents;

        function onRuntimeEvent(e) { runtimeEvents.push(e) }
        function onStateEvent(e) { stateEvents.push(e) }
        function readiness() {
            return health.readiness({ ready: state.isReady(), reload: state.get().reload }, Date.now());
        }
        function logged(level, key) {
            return env.logs[level].filter(m => m.indexOf(key) === 0);
        }
        function retry(onExhausted, extra) {
            return { retry: Object.assign({ min: 1, max: 10, attempts: 2, onExhausted: onExhausted }, extra || {}) };
        }
        function notifications() {
            return runtimeEvents.filter(e => e.id === "reload-failed");
        }
        // Real timers: the retries are exhausted
        async function exhaust() {
            await env.start();
            env.failAlways = true;
            env.change("B");
            env.notify();
            await waitFor(() => logged("error", "reload.retries-exhausted").length > 0 || state.get().reload !== undefined, 2000, "retries not exhausted");
        }
        // Fake time: `reload` are the reload settings
        function fake(reload, envOpts) {
            clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
            env = createEnv(Object.assign({ reload: reload }, envOpts || {}));
            return env;
        }
        async function exhaustFake() {
            await env.start();
            env.failAlways = true;
            env.change("B");
            env.notify();
            await clock.tickAsync(20);
            state.get().should.have.property("reload");
        }

        beforeEach(function() {
            runtimeEvents = [];
            stateEvents = [];
            events.on("runtime-event", onRuntimeEvent);
            events.on("instance:state", onStateEvent);
        });
        afterEach(function() {
            events.removeListener("runtime-event", onRuntimeEvent);
            events.removeListener("instance:state", onStateEvent);
            if (clock) {
                clock.restore();
                clock = null;
            }
        });

        describe("settings", function() {
            it("defaults: fail and 30 minutes", async function() {
                env = createEnv({ reload: { retry: { min: 1, max: 10, attempts: 1 } } });
                env.logs.warn.should.have.length(0);
                clock = sinon.useFakeTimers({ toFake: ["Date"] });
                await env.start();
                env.failAlways = true;
                env.change("B");
                env.notify();
                await waitFor(() => state.get().state === "failed");
                // no condition in the default mode, so no limit either
                state.get().should.not.have.property("reload");
            });
            it("keepReady with the default maxStaleTime - the deadline is since + 1800000", async function() {
                env = createEnv({ reload: retry("keepReady", { attempts: 1 }) });
                env.logs.warn.should.have.length(0);
                await exhaust();
                const reload = state.get().reload;
                reload.keepReady.should.be.true();
                (reload.staleDeadline - reload.since).should.equal(1800000);
            });
            it("an explicit maxStaleTime and the largest timer value are accepted", async function() {
                env = createEnv({ reload: retry("keepReady", { attempts: 1, maxStaleTime: 2147483647 }) });
                env.logs.warn.should.have.length(0);
                await exhaust();
                (state.get().reload.staleDeadline - state.get().reload.since).should.equal(2147483647);
            });
            it("maxStaleTime 0 - no limit (no deadline, no timer, warn does not turn into 503)", async function() {
                fake(retry("keepReady", { attempts: 1, max: 3600000, maxStaleTime: 0 }));
                env.logs.warn.should.have.length(0);
                await exhaustFake();
                (state.get().reload.staleDeadline === null).should.be.true();
                await clock.tickAsync(24 * 3600000);
                readiness().should.eql(READY_WARN);
                logged("error", "reload.stale").should.have.length(0);
                state.get().reload.should.not.have.property("stale");
            });
            it("an invalid onExhausted - warning and the default (fail)", async function() {
                env = createEnv({ reload: retry("sometimes", { attempts: 1 }) });
                logged("warn", "reload.invalid-on-exhausted").should.have.length(1);
                logged("warn", "reload.invalid-on-exhausted")[0].should.containEql("sometimes");
                await exhaust();
                state.get().state.should.equal("failed");
                state.get().should.not.have.property("reload");
            });
            [-1, "10", NaN, Infinity, 2147483648, null, true].forEach(function(value) {
                it("an invalid maxStaleTime " + String(value) + " - warning and the default", async function() {
                    env = createEnv({ reload: retry("keepReady", { attempts: 1, maxStaleTime: value }) });
                    logged("warn", "reload.invalid-retry").should.have.length(1);
                    logged("warn", "reload.invalid-retry")[0].should.containEql("maxStaleTime");
                    await exhaust();
                    (state.get().reload.staleDeadline - state.get().reload.since).should.equal(1800000);
                });
            });
        });

        describe("the default mode (fail) - R-36 unchanged", function() {
            it("failed, no condition, forced reload, no editor notification, no new logs or events", async function() {
                env = createEnv({ reload: retry("fail") });
                await env.start();
                env.failAlways = true;
                env.change("B");
                env.notify();
                await waitFor(() => state.get().state === "failed");
                state.get().should.not.have.property("reload");
                readiness().should.eql(READY_503);
                notifications().should.have.length(0);
                logged("error", "reload.keep-ready").should.have.length(0);
                logged("error", "reload.stale").should.have.length(0);
                // forceNext: the same revision is reloaded after the recovery (R-36)
                env.failAlways = false;
                env.stored = Object.assign({}, env.stored, { rev: "A" });
                env.notify();
                await waitFor(() => state.get().state === "ready");
                env.applied.should.have.length(1);
                state.get().should.not.have.property("reload");
                notifications().should.have.length(0);
                logged("info", "reload.recovered").should.have.length(0);
                stateEvents.forEach(e => e.should.not.have.property("reload"));
            });
            it("the sequence of instance:state events equals the one before R-47 (regression)", async function() {
                // an outage of 10 s with the retries exhausted, then the recovery (no onExhausted set)
                fake({ retry: { min: 1, max: 1000, attempts: 2 } });
                await env.start();
                env.failAlways = true;
                env.change("B");
                env.notify();
                await clock.tickAsync(10000);
                env.failAlways = false;
                await clock.tickAsync(1000);
                await clock.tickAsync(0);
                stateEvents.map(e => e.state).should.eql(["failed", "reloadPending", "reloadPending", "reloading", "ready"]);
                stateEvents.forEach(e => e.should.not.have.property("reload"));
                notifications().should.have.length(0);
                logged("info", "reload.recovered").should.have.length(0);
                logged("error", "reload.keep-ready").should.have.length(0);
                env.applied.should.have.length(1);
            });
            it("an editor-only instance (loaded) stays ready: 200 ok, no condition", async function() {
                env = createEnv({ reload: retry("fail") });
                state.reset();
                state.markStarting();
                state.report({ flowsRunning: false, reason: "editor-only" });
                state.get().state.should.equal("loaded");
                await exhaust();
                state.get().state.should.equal("loaded");
                state.get().should.not.have.property("reload");
                state.isReady().should.be.true();
                readiness().should.eql(READY_OK);
            });
            it("a local deployment after the exhaustion: ready, 200 ok", async function() {
                env = createEnv({ reload: retry("fail") });
                await exhaust();
                await waitFor(() => state.get().state === "failed");
                readiness().should.eql(READY_503);
                const result = await pipeline.deploy({ type: "full", source: "api", flows: { flows: flowsOf("D") } });
                result.rev.should.equal("deployed");
                await waitFor(() => state.get().state === "ready");
                state.get().should.not.have.property("reload");
                readiness().should.eql(READY_OK);
                logged("info", "reload.recovered").should.have.length(0);
            });
            it("the periodic read after a local deployment while storage is still unreadable: no new failed state (as before)", async function() {
                env = createEnv({ reload: retry("fail") });
                await exhaust();
                await waitFor(() => state.get().state === "failed");
                await pipeline.deploy({ type: "full", source: "api", flows: { flows: flowsOf("D") } });
                await waitFor(() => state.get().state === "ready");
                const calls = env.getFlowsCalls;
                await waitFor(() => env.getFlowsCalls >= calls + 3, 2000, "no periodic read");
                state.get().state.should.equal("ready");
                state.get().should.not.have.property("reload");
            });
        });

        describe("keepReady - the read error of storage", function() {
            it("a ready instance stays ready: warn, no failed state, no forced reload, the flows run", async function() {
                env = createEnv({ reload: retry("keepReady") });
                await exhaust();
                state.get().state.should.equal("ready");
                states.should.not.containEql("failed");
                state.isReady().should.be.true();
                readiness().should.eql(READY_WARN);
                state.get().reload.should.containEql({ error: { code: "storage_error" }, keepReady: true, attempts: 2, activeRev: "A" });
                env.applied.should.have.length(0);
                env.active.rev.should.equal("A");
            });
            it("an idle instance stays idle: 503", async function() {
                env = createEnv({ reload: retry("keepReady") });
                state.reset();
                state.markStarting();
                state.report({ flowsRunning: false, reason: "set-state" });
                env.idle = true;
                await exhaust();
                state.get().state.should.equal("idle");
                state.get().reload.keepReady.should.be.true();
                readiness().should.eql(READY_503);
            });
            it("a startup error of storage (F1) is not affected: failed, 503, no condition", function() {
                state.reset();
                state.markStarting();
                state.fail(new Error("storage down"), "storage-error");
                state.get().state.should.equal("failed");
                state.get().should.not.have.property("reload");
                readiness().should.eql(READY_503);
            });
            it("recovery with the same revision: the condition is cleared with no drain, no preReload, no reload", async function() {
                env = createEnv({ reload: retry("keepReady") });
                const hook = sinon.spy();
                hooks.add("preReload", p => { hook(p) });
                await exhaust();
                states.length = 0;
                env.failAlways = false;
                env.change("A");
                await waitFor(() => state.get().reload === undefined, 2000, "the condition was not cleared");
                readiness().should.eql(READY_OK);
                hook.called.should.be.false();
                env.flows.reloadFromStorage.called.should.be.false();
                states.should.not.containEql("reloadPending");
                states.should.not.containEql("reloading");
                state.get().state.should.equal("ready");
                logged("info", "reload.recovered").should.have.length(1);
                logged("info", "reload.recovered")[0].should.containEql("\"reason\":\"unchanged\"");
                logged("info", "reload.recovered")[0].should.containEql("storage_error");
            });
            it("recovery with another revision: a normal reload, the condition cleared", async function() {
                env = createEnv({ reload: retry("keepReady") });
                const hook = sinon.spy();
                hooks.add("preReload", p => { hook(p) });
                await exhaust();
                env.failAlways = false;
                await waitFor(() => env.applied.length === 1 && state.get().state === "ready", 2000, "no reload");
                env.applied[0].rev.should.equal("B");
                hook.calledOnce.should.be.true();
                state.get().should.not.have.property("reload");
                readiness().should.eql(READY_OK);
                logged("info", "reload.recovered")[0].should.containEql("\"reason\":\"reload\"");
            });
            it("recovery when the revision went back during the drain (unchanged) clears the condition", async function() {
                env = createEnv({ reload: retry("keepReady") });
                const d = deferred();
                hooks.add("preReload", p => d.promise);
                await exhaust();
                env.failAlways = false;
                await waitFor(() => states.indexOf("reloadPending:draining") !== -1);
                state.get().reload.should.have.property("keepReady", true);
                env.change("A");
                d.resolve();
                await waitFor(() => state.get().reload === undefined, 2000, "the condition was not cleared");
                env.applied.should.have.length(0);
                state.get().state.should.equal("ready");
            });
            it("recovery by a reload whose start fails (F5): the condition cleared, failed, 503", async function() {
                env = createEnv({ reload: retry("keepReady") });
                env.startErrors = [{ code: "flow_start_failed", message: "start failed" }];
                await exhaust();
                env.failAlways = false;
                await waitFor(() => state.get().state === "failed", 2000, "not failed");
                state.get().should.not.have.property("reload");
                readiness().should.eql(READY_503);
            });
            it("recovery by a reload with a partial start: failed, 503", async function() {
                env = createEnv({ reload: retry("keepReady") });
                env.startErrors = [{ code: "node_start_failed", message: "one node failed" }];
                await exhaust();
                env.failAlways = false;
                await waitFor(() => state.get().state === "failed", 2000, "not failed");
                state.get().errors[0].code.should.equal("node-start-failed".replace(/-/g, "_"));
                readiness().should.eql(READY_503);
            });
            it("reloadPending (not draining) after the exhaustion is 200 warn, draining is 503", async function() {
                // a slot that is not given yet keeps the cycle in "reloadPending" before the drain
                const gate = deferred();
                const d = deferred();
                const seen = {};
                env = createEnv({
                    reload: Object.assign({ concurrency: 1 }, retry("keepReady")),
                    localCoordination: false,
                    claimSlot: async function() {
                        await gate.promise;
                        return { release: async function() {}, renew: async function() { return true } };
                    }
                });
                hooks.add("preReload", p => {
                    seen.draining = readiness();
                    return d.promise;
                });
                await exhaust();
                env.failAlways = false;
                await waitFor(() => state.get().state === "reloadPending" && !state.get().draining);
                state.get().reload.should.have.property("keepReady", true);
                readiness().should.eql(READY_WARN);
                gate.resolve();
                await waitFor(() => !!seen.draining);
                seen.draining.should.eql(READY_503);
                d.resolve();
                await waitFor(() => env.applied.length === 1 && state.get().state === "ready" && state.get().reload === undefined);
                readiness().should.eql(READY_OK);
            });
            it("a local deployment clears the condition, the notification and the stale timer", async function() {
                fake(retry("keepReady", { attempts: 1, max: 100000, maxStaleTime: 5000 }));
                await exhaustFake();
                readiness().should.eql(READY_WARN);
                const result = await pipeline.deploy({ type: "full", source: "api", flows: { flows: flowsOf("D") } });
                result.rev.should.equal("deployed");
                await clock.tickAsync(0);
                state.get().should.not.have.property("reload");
                readiness().should.eql(READY_OK);
                notifications().should.have.length(2);
                notifications()[1].should.eql({ id: "reload-failed", payload: { type: "success", text: "notification.warnings.reload_recovered", timeout: 10000 }, retain: false });
                logged("info", "reload.recovered")[0].should.containEql("\"reason\":\"deploy\"");
                await clock.tickAsync(10000);
                logged("error", "reload.stale").should.have.length(0);
                readiness().should.eql(READY_OK);
            });
            it("after a local deployment while storage is still unreadable the condition is reported again", async function() {
                fake(retry("keepReady", { attempts: 1, max: 100 }));
                await exhaustFake();
                await pipeline.deploy({ type: "full", source: "api", flows: { flows: flowsOf("D") } });
                await clock.tickAsync(0);
                state.get().should.not.have.property("reload");
                await clock.tickAsync(100);
                state.get().should.have.property("reload");
                state.get().reload.keepReady.should.be.true();
                logged("error", "reload.keep-ready").should.have.length(2);
                notifications().should.have.length(3);
            });
        });

        describe("keepReady - the errors of the configuration always fail", function() {
            it("credentials_load_failed: failed, 503, no editor notification, a forced reload after the recovery", async function() {
                env = createEnv({ reload: retry("keepReady") });
                env.failError = Object.assign(new Error("credentials cannot be decrypted"), { code: "credentials_load_failed" });
                await exhaust();
                await waitFor(() => state.get().state === "failed", 2000, "not failed");
                state.get().reload.should.containEql({ error: { code: "credentials_load_failed" }, keepReady: false });
                (state.get().reload.staleDeadline === null).should.be.true();
                readiness().should.eql(READY_503);
                notifications().should.have.length(0);
                logged("error", "reload.keep-ready").should.have.length(0);
                // forceNext (R-36): the revision in storage is reloaded even though it is the running one
                env.failError = null;
                env.failAlways = false;
                env.change("A");
                await waitFor(() => state.get().state === "ready", 2000, "not ready again");
                env.applied.should.have.length(1);
                state.get().should.not.have.property("reload");
            });
            it("the event order: failed first, then the condition (no ready instance with keepReady false in between)", async function() {
                env = createEnv({ reload: retry("keepReady") });
                env.failError = Object.assign(new Error("credentials cannot be decrypted"), { code: "credentials_load_failed" });
                await env.start();
                stateEvents.length = 0;
                env.failAlways = true;
                env.change("B");
                env.notify();
                await waitFor(() => state.get().state === "failed", 2000, "not failed");
                const summary = stateEvents.map(e => e.state + (e.reload ? ":" + e.reload.error.code + ":" + e.reload.keepReady : ""));
                summary.slice(0, 2).should.eql(["failed", "failed:credentials_load_failed:false"]);
                summary.should.not.containEql("ready:credentials_load_failed:false");
                // the condition is not taken for a clear by the reloader itself
                logged("info", "reload.recovered").should.have.length(0);
                state.get().reload.error.code.should.equal("credentials_load_failed");
            });
            it("credentials_load_failed during the reload itself (retry.attempts 1): failed, 503", async function() {
                env = createEnv({ reload: retry("keepReady", { attempts: 1 }) });
                env.reloadError = Object.assign(new Error("credentials cannot be decrypted"), { code: "credentials_load_failed" });
                await env.start();
                env.change("B");
                env.notify();
                await waitFor(() => state.get().state === "failed", 2000, "not failed");
                state.get().reload.should.containEql({ error: { code: "credentials_load_failed" }, keepReady: false });
                readiness().should.eql(READY_503);
                notifications().should.have.length(0);
            });
            it("invalid_flows from storage: failed, 503", async function() {
                env = createEnv({ reload: retry("keepReady") });
                env.failError = Object.assign(new Error("no flow configuration"), { code: "invalid_flows" });
                await exhaust();
                await waitFor(() => state.get().state === "failed");
                state.get().reload.should.containEql({ error: { code: "invalid_flows" }, keepReady: false });
                readiness().should.eql(READY_503);
            });
            ["invalid_json", "empty_file"].forEach(function(code) {
                it("a corrupt flow file (" + code + ") fails: failed, 503, no keep-ready notification", async function() {
                    env = createEnv({ reload: retry("keepReady") });
                    env.failError = Object.assign(new Error("the flow file is corrupt"), { code: code });
                    await exhaust();
                    await waitFor(() => state.get().state === "failed");
                    state.get().reload.should.containEql({ error: { code: code }, keepReady: false });
                    readiness().should.eql(READY_503);
                    notifications().should.have.length(0);
                    logged("error", "reload.keep-ready").should.have.length(0);
                });
            });
            it("a raw code of an error of the reload itself does not leak into the condition (reload_failed)", async function() {
                env = createEnv({ reload: retry("keepReady", { attempts: 1 }) });
                env.reloadError = Object.assign(new Error("busy"), { code: "state_operation_in_progress" });
                await env.start();
                env.change("B");
                env.notify();
                await waitFor(() => state.get().state === "failed", 2000, "not failed");
                state.get().reload.error.code.should.equal("reload_failed");
            });
            it("any other error of the reload itself (not storage) fails as well", async function() {
                env = createEnv({ reload: retry("keepReady", { attempts: 1 }) });
                env.reloadError = new Error("flows cannot be stopped");
                await env.start();
                env.change("B");
                env.notify();
                await waitFor(() => state.get().state === "failed", 2000, "not failed");
                state.get().reload.should.containEql({ error: { code: "reload_failed" }, keepReady: false });
            });
            it("a kept-ready instance whose error turns into a configuration error fails", async function() {
                env = createEnv({ reload: retry("keepReady") });
                await exhaust();
                state.get().state.should.equal("ready");
                env.failError = Object.assign(new Error("no flow configuration"), { code: "invalid_flows" });
                await waitFor(() => state.get().state === "failed", 2000, "not failed");
                state.get().reload.should.containEql({ error: { code: "invalid_flows" }, keepReady: false });
                state.get().reload.since.should.be.belowOrEqual(Date.now());
                logged("error", "reload.not-kept-ready").should.have.length(1);
                (notifications().pop().payload === undefined).should.be.true();
                readiness().should.eql(READY_503);
            });
        });

        describe("the failures are counted until the cycle succeeds (#17)", function() {
            const CREDENTIALS_ERROR = () => Object.assign(new Error("credentials cannot be decrypted"), { code: "credentials_load_failed" });

            // The second read of a cycle (under the deploy lock) fails with env.rereadError
            function failRereads(error) {
                const original = env.storage.getFlows;
                env.rereadError = error;
                env.storage.getFlows = async function(readOpts) {
                    if (env.rereadError && lock.isLocked()) {
                        env.getFlowsCalls++;
                        throw env.rereadError;
                    }
                    return original(readOpts);
                };
            }
            // Lets the promise chains of a cycle run (fake time does not advance)
            async function settle() {
                for (let i = 0; i < 5; i++) {
                    await clock.tickAsync(0);
                }
            }
            function attemptsLogged() {
                return logged("warn", "reload.read-failed").map(m => JSON.parse(m.slice("reload.read-failed ".length)).attempt);
            }
            // The first read of the first cycle waits for gate.resolve() and then fails
            function failFirstReadAfter(gate) {
                const original = env.storage.getFlows;
                let first = true;
                env.storage.getFlows = async function(readOpts) {
                    if (first) {
                        first = false;
                        env.getFlowsCalls++;
                        await gate.promise;
                        throw new Error("storage unavailable");
                    }
                    return original(readOpts);
                };
            }
            function atFailedState() {
                const seen = { reloads: null, reads: null };
                const off = state.onChange(info => {
                    if (info.state === "failed" && seen.reloads === null) {
                        seen.reloads = env.flows.reloadFromStorage.callCount;
                        seen.reads = env.getFlowsCalls;
                    }
                });
                return { seen: seen, off: off };
            }

            it("fail: credentials_load_failed in the reload step exhausts retry.attempts - failed, /ready 503", async function() {
                env = createEnv({ reload: retry("fail", { attempts: 3 }) });
                env.reloadError = CREDENTIALS_ERROR();
                await env.start();
                const watch = atFailedState();
                env.change("B");
                env.notify();
                await waitFor(() => state.get().state === "failed", 2000, "never failed");
                watch.off();
                watch.seen.reloads.should.equal(3);
                state.isReady().should.be.false();
                readiness().should.eql(READY_503);
                env.applied.should.have.length(0);
                logged("warn", "reload.read-failed").should.have.length(3);
                logged("error", "reload.retries-exhausted").should.have.length(1);
                logged("error", "reload.retries-exhausted")[0].should.containEql("\"attempts\":3");
                // R-36 as before: no condition in the default mode
                state.get().should.not.have.property("reload");
                notifications().should.have.length(0);
            });
            it("fail: after the exhaustion the instance is reloaded again every retry.max and recovers (forced reload)", async function() {
                env = createEnv({ reload: retry("fail", { attempts: 3 }) });
                env.reloadError = CREDENTIALS_ERROR();
                await env.start();
                env.change("B");
                env.notify();
                await waitFor(() => state.get().state === "failed", 2000, "never failed");
                const calls = env.flows.reloadFromStorage.callCount;
                await waitFor(() => env.flows.reloadFromStorage.callCount >= calls + 2, 2000, "no periodic reload");
                logged("error", "reload.retries-exhausted").should.have.length(1);
                env.reloadError = null;
                await waitFor(() => state.get().state === "ready", 2000, "not ready again");
                env.applied.should.have.length(1);
                env.applied[0].rev.should.equal("B");
            });
            it("fail: a failed reread under the lock exhausts retry.attempts - failed, /ready 503", async function() {
                env = createEnv({ reload: retry("fail", { attempts: 3 }) });
                failRereads(new Error("storage unavailable under the lock"));
                await env.start();
                const watch = atFailedState();
                env.change("B");
                env.notify();
                await waitFor(() => state.get().state === "failed", 2000, "never failed");
                watch.off();
                // step 2 and the reread of each of the 3 cycles
                watch.seen.reads.should.equal(6);
                state.isReady().should.be.false();
                readiness().should.eql(READY_503);
                env.flows.reloadFromStorage.called.should.be.false();
                logged("warn", "reload.read-failed").should.have.length(3);
                logged("error", "reload.retries-exhausted").should.have.length(1);
                state.get().should.not.have.property("reload");
            });
            it("fail: the failures of different steps of the cycle count together", async function() {
                env = createEnv({ reload: retry("fail", { attempts: 3 }) });
                failRereads(new Error("storage unavailable under the lock"));
                await env.start();
                const watch = atFailedState();
                env.failReads = 1; // the read of step 2 of the first cycle
                env.change("B");
                env.notify();
                await waitFor(() => state.get().state === "failed", 2000, "never failed");
                watch.off();
                // 1 (step 2 fails) + 2 x (step 2 and the reread)
                watch.seen.reads.should.equal(5);
                logged("warn", "reload.read-failed").should.have.length(3);
                logged("error", "reload.retries-exhausted").should.have.length(1);
            });
            it("fail: an unexpected failure of the reload (not storage) exhausts retry.attempts as well", async function() {
                env = createEnv({ reload: retry("fail", { attempts: 3 }) });
                env.reloadError = new Error("flows cannot be stopped");
                await env.start();
                const watch = atFailedState();
                env.change("B");
                env.notify();
                await waitFor(() => state.get().state === "failed", 2000, "never failed");
                watch.off();
                watch.seen.reloads.should.equal(3);
            });
            it("a successful cycle resets the counter: two failures, a success, two failures - not exhausted with attempts 3", async function() {
                fake(retry("fail", { min: 1000, max: 1000, attempts: 3 }));
                env.reloadError = CREDENTIALS_ERROR();
                await env.start();
                env.change("B");
                env.notify();
                await clock.tickAsync(1500);
                env.flows.reloadFromStorage.callCount.should.equal(2);
                env.reloadError = null;
                await clock.tickAsync(1000);
                env.applied.should.have.length(1);
                env.flows.reloadFromStorage.callCount.should.equal(3);
                env.reloadError = CREDENTIALS_ERROR();
                env.change("C");
                env.notify();
                await clock.tickAsync(1500);
                env.flows.reloadFromStorage.callCount.should.equal(5);
                state.get().state.should.equal("ready");
                env.reloadError = null;
                await clock.tickAsync(1000);
                env.applied.should.have.length(2);
                state.get().state.should.equal("ready");
                states.should.not.containEql("failed");
                logged("error", "reload.retries-exhausted").should.have.length(0);
                logged("warn", "reload.read-failed").map(m => JSON.parse(m.slice("reload.read-failed ".length)).attempt).should.eql([1, 2, 1, 2]);
            });
            it("a cycle that ends with the revision unchanged also resets the counter", async function() {
                fake(retry("fail", { min: 1000, max: 1000, attempts: 3 }));
                failRereads(new Error("storage unavailable under the lock"));
                await env.start();
                env.change("B");
                env.notify();
                await clock.tickAsync(1500);
                logged("warn", "reload.read-failed").should.have.length(2);
                // storage holds the running revision again: the next cycle ends as unchanged
                env.rereadError = null;
                env.change("A");
                await clock.tickAsync(1000);
                env.flows.reloadFromStorage.called.should.be.false();
                logged("warn", "reload.read-failed").should.have.length(2);
                // two more failures do not exhaust (the counter started again)
                env.rereadError = new Error("storage unavailable under the lock");
                env.change("B");
                env.notify();
                await clock.tickAsync(1500);
                logged("warn", "reload.read-failed").should.have.length(4);
                state.get().state.should.equal("ready");
                env.rereadError = null;
                await clock.tickAsync(1000);
                env.applied.should.have.length(1);
                states.should.not.containEql("failed");
                logged("error", "reload.retries-exhausted").should.have.length(0);
            });
            it("keepReady: a failed reread under the lock (storage_error) keeps the instance ready and counts the attempts", async function() {
                env = createEnv({ reload: retry("keepReady") });
                failRereads(new Error("storage unavailable under the lock"));
                await env.start();
                env.change("B");
                env.notify();
                await waitFor(() => state.get().reload !== undefined, 2000, "no condition");
                state.get().state.should.equal("ready");
                state.get().reload.should.containEql({ error: { code: "storage_error" }, keepReady: true, attempts: 2, activeRev: "A" });
                readiness().should.eql(READY_WARN);
                // the attempts keep growing across the cycles (step 2 succeeds every time)
                await waitFor(() => state.get().reload.attempts >= 5, 2000, "the attempts stand still");
                logged("warn", "reload.read-failed").should.have.length(2);
                logged("error", "reload.keep-ready").should.have.length(1);
                logged("error", "reload.retries-exhausted").should.have.length(0);
                // the periodic error log while the condition lasts
                await waitFor(() => logged("error", "reload.still-failing").length >= 1, 2000, "no periodic error log");
                logged("error", "reload.still-failing")[0].should.containEql("storage_error");
                states.should.not.containEql("failed");
                notifications().should.have.length(1);
                // recovery
                env.rereadError = null;
                await waitFor(() => env.applied.length === 1 && state.get().reload === undefined, 2000, "no recovery");
                readiness().should.eql(READY_OK);
            });
            it("keepReady: the series starts at the first failure - an intermediate successful read of step 2 does not move `since`", async function() {
                const start = 1700000000000;
                clock = sinon.useFakeTimers({ now: start, toFake: ["setTimeout", "clearTimeout", "Date"] });
                env = createEnv({ reload: retry("keepReady", { min: 1000, max: 1000, attempts: 3, maxStaleTime: 600000 }) });
                failRereads(new Error("storage unavailable under the lock"));
                await env.start();
                env.change("B");
                env.notify();
                await clock.tickAsync(2500);
                state.get().should.have.property("reload");
                state.get().reload.since.should.equal(start);
                state.get().reload.attempts.should.equal(3);
                state.get().reload.staleDeadline.should.equal(start + 600000);
                // still the same series later
                await clock.tickAsync(3000);
                state.get().reload.since.should.equal(start);
                state.get().reload.attempts.should.be.above(3);
            });
            it("notifications that keep coming do not prevent failed (the notification resets the delay, not the count)", async function() {
                fake(retry("fail", { min: 1000, max: 1000, attempts: 3 }));
                env.reloadError = CREDENTIALS_ERROR();
                await env.start();
                const watch = atFailedState();
                env.change("B");
                for (let i = 0; i < 6 && state.get().state !== "failed"; i++) {
                    env.notify();
                    await clock.tickAsync(1500);
                }
                watch.off();
                state.get().state.should.equal("failed");
                watch.seen.reloads.should.equal(3);
                logged("warn", "reload.read-failed").map(m => JSON.parse(m.slice("reload.read-failed ".length)).attempt).should.eql([1, 2, 3]);
                logged("error", "reload.retries-exhausted").should.have.length(1);
            });
            it("a notification resets the delay of the retry (backoff starts again), not the attempts", async function() {
                fake(retry("fail", { min: 1000, max: 60000, attempts: 10 }));
                env.reloadError = CREDENTIALS_ERROR();
                await env.start();
                env.change("B");
                env.notify();
                // failures at 0, +1000 (delay 1000), +3000 (delay 2000), the next one would be at +7000 (delay 4000)
                await clock.tickAsync(3500);
                env.flows.reloadFromStorage.callCount.should.equal(3);
                env.notify();
                await clock.tickAsync(0);
                env.flows.reloadFromStorage.callCount.should.equal(4);
                // the delay started again at min (1000), the attempt number goes on
                await clock.tickAsync(1000);
                env.flows.reloadFromStorage.callCount.should.equal(5);
                logged("warn", "reload.read-failed").map(m => JSON.parse(m.slice("reload.read-failed ".length)).attempt).should.eql([1, 2, 3, 4, 5]);
            });
            it("fail: after the recovery from the exhaustion a new series of failures exhausts again", async function() {
                fake(retry("fail", { min: 1000, max: 1000, attempts: 2 }));
                env.reloadError = CREDENTIALS_ERROR();
                await env.start();
                env.change("B");
                env.notify();
                await clock.tickAsync(3000);
                state.get().state.should.equal("failed");
                env.reloadError = null;
                await clock.tickAsync(1500);
                state.get().state.should.equal("ready");
                env.applied.should.have.length(1);
                env.reloadError = CREDENTIALS_ERROR();
                env.change("C");
                env.notify();
                await clock.tickAsync(5000);
                state.get().state.should.equal("failed");
                logged("error", "reload.retries-exhausted").should.have.length(2);
            });
            it("keepReady: after a successful cycle the next series has its own since and attempts", async function() {
                const start = 1700000000000;
                clock = sinon.useFakeTimers({ now: start, toFake: ["setTimeout", "clearTimeout", "Date"] });
                env = createEnv({ reload: retry("keepReady", { min: 1000, max: 1000, attempts: 3, maxStaleTime: 600000 }) });
                failRereads(new Error("storage unavailable under the lock"));
                await env.start();
                env.change("B");
                env.notify();
                // two failures, below attempts 3
                await clock.tickAsync(1500);
                logged("warn", "reload.read-failed").should.have.length(2);
                state.get().should.not.have.property("reload");
                env.rereadError = null;
                await clock.tickAsync(1000);
                env.applied.should.have.length(1);
                // much later (longer than maxStaleTime) a new series starts
                await clock.tickAsync(1000000);
                const second = Date.now();
                env.rereadError = new Error("storage unavailable under the lock");
                env.change("C");
                env.notify();
                await clock.tickAsync(3500);
                state.get().reload.since.should.equal(second);
                state.get().reload.attempts.should.equal(4);
                state.get().reload.should.not.have.property("stale", true);
                readiness().should.eql(READY_WARN);
            });
            it("fail: after the recovery from the exhaustion a new series of read failures of storage exhausts again", async function() {
                fake(retry("fail", { min: 1000, max: 1000, attempts: 2 }));
                env.failAlways = true;
                await env.start();
                env.change("B");
                env.notify();
                await clock.tickAsync(3000);
                state.get().state.should.equal("failed");
                env.failAlways = false;
                await clock.tickAsync(1500);
                state.get().state.should.equal("ready");
                env.applied.should.have.length(1);
                env.failAlways = true;
                env.change("C");
                env.notify();
                await clock.tickAsync(5000);
                state.get().state.should.equal("failed");
                logged("error", "reload.retries-exhausted").should.have.length(2);
            });
            it("a cycle that ends unchanged after the drain (the reread finds the running revision) also resets the counter", async function() {
                fake(retry("fail", { min: 1000, max: 1000, attempts: 3 }));
                failRereads(new Error("storage unavailable under the lock"));
                let drains = 0;
                hooks.add("preReload", p => {
                    drains++;
                    if (drains === 3) {
                        // the third cycle: storage holds the running revision again at the reread
                        env.rereadError = null;
                        env.change("A");
                    }
                });
                await env.start();
                env.change("B");
                env.notify();
                await clock.tickAsync(2500);
                drains.should.equal(3);
                logged("warn", "reload.read-failed").should.have.length(2);
                env.flows.reloadFromStorage.called.should.be.false();
                // two more failures do not exhaust: the series started again
                env.rereadError = new Error("storage unavailable under the lock");
                env.change("B");
                env.notify();
                await clock.tickAsync(1500);
                logged("warn", "reload.read-failed").should.have.length(4);
                state.get().state.should.equal("ready");
                logged("error", "reload.retries-exhausted").should.have.length(0);
            });
            it("fail: the retries exhausted earlier, recovery by a local deployment, then a failing reload of a new revision exhausts again", async function() {
                fake(retry("fail", { min: 1000, max: 1000, attempts: 2 }));
                env.failAlways = true;
                await env.start();
                env.change("B");
                env.notify();
                await clock.tickAsync(3000);
                state.get().state.should.equal("failed");
                logged("error", "reload.retries-exhausted").should.have.length(1);
                await pipeline.deploy({ type: "full", source: "api", flows: { flows: flowsOf("D") } });
                await clock.tickAsync(0);
                state.get().state.should.equal("ready");
                env.failAlways = false;
                env.reloadError = CREDENTIALS_ERROR();
                env.change("E");
                env.notify();
                await clock.tickAsync(5000);
                state.get().state.should.equal("failed");
                logged("error", "reload.retries-exhausted").should.have.length(2);
                // the new series is counted from 1 again (#26)
                attemptsLogged().should.eql([1, 2, 1, 2]);
                // still failed: the periodic cycles do not start a new series each time
                const warns = logged("warn", "reload.read-failed").length;
                await clock.tickAsync(60000);
                logged("warn", "reload.read-failed").should.have.length(warns);
                logged("error", "reload.retries-exhausted").should.have.length(2);
            });
            it("(mutation guard) fail: a new series after a local deployment starts its backoff at retry.min and counts the attempts from 1 (#26)", async function() {
                fake(retry("fail", { min: 1000, max: 60000, attempts: 2 }));
                env.reloadError = CREDENTIALS_ERROR();
                await env.start();
                env.change("B");
                env.notify();
                // failures at 0 and +1000: exhausted, the next cycle is due in retry.max
                await clock.tickAsync(1500);
                state.get().state.should.equal("failed");
                attemptsLogged().should.eql([1, 2]);
                await pipeline.deploy({ type: "full", source: "api", flows: { flows: flowsOf("D") } });
                await clock.tickAsync(0);
                state.get().state.should.equal("ready");
                // no notification (it would reset the delay): the periodic cycle starts the new series
                env.change("E");
                await clock.tickAsync(60000);
                attemptsLogged().should.eql([1, 2, 1]);
                // the delay of the new series is retry.min (1000), not a continuation of the old backoff
                await clock.tickAsync(1500);
                attemptsLogged().should.eql([1, 2, 1, 2]);
                state.get().state.should.equal("failed");
                logged("error", "reload.retries-exhausted").should.have.length(2);
            });
            it("(regression) a successful cycle cancels the retry scheduled by an earlier failed cycle - no useless cycle (#26, probe P7)", async function() {
                fake(retry("fail", { min: 1000, max: 60000, attempts: 5 }));
                const gate = deferred();
                failFirstReadAfter(gate);
                await env.start();
                env.change("B");
                env.notify();
                await clock.tickAsync(0);
                env.getFlowsCalls.should.equal(1);
                // a notification arrives during the failing cycle A: cycle B follows at once
                env.notify();
                gate.resolve();
                await clock.tickAsync(0);
                // A failed (and scheduled a retry), B read twice (step 2 and under the lock) and applied B
                logged("warn", "reload.read-failed").should.have.length(1);
                env.applied.should.have.length(1);
                env.getFlowsCalls.should.equal(3);
                // the retry of A is obsolete: it must not start cycle C
                await clock.tickAsync(5000);
                env.getFlowsCalls.should.equal(3);
                env.flows.reloadFromStorage.callCount.should.equal(1);
                state.get().state.should.equal("ready");
            });
            it("(regression) the retry fires during a slow successful cycle (preReload drain) - no useless cycle (#26, R1)", async function() {
                fake(retry("fail", { min: 1000, max: 60000, attempts: 5 }));
                const gate = deferred();
                const hookGate = deferred();
                failFirstReadAfter(gate);
                hooks.add("preReload", p => hookGate.promise);
                await env.start();
                env.change("B");
                env.notify();
                await clock.tickAsync(0);
                // a notification arrives during the failing cycle A: cycle B follows at once
                env.notify();
                gate.resolve();
                await clock.tickAsync(0);
                logged("warn", "reload.read-failed").should.have.length(1);
                // cycle B waits in the drain; the retry of A (1000 ms) fires meanwhile
                await clock.tickAsync(1500);
                env.applied.should.have.length(0);
                hookGate.resolve();
                await settle();
                env.applied.should.have.length(1);
                const afterB = env.getFlowsCalls;
                // A: 1 read, B: step 2 and the reread
                afterB.should.equal(3);
                await clock.tickAsync(5000);
                env.getFlowsCalls.should.equal(afterB);
                env.flows.reloadFromStorage.callCount.should.equal(1);
                state.get().state.should.equal("ready");
            });
            it("(regression) the retry fires during a failing cycle - no immediate extra cycle, the next one follows the backoff (#26, R5)", async function() {
                fake(retry("fail", { min: 1000, max: 60000, attempts: 10 }));
                const gate = deferred();
                const hookGate = deferred();
                failFirstReadAfter(gate);
                hooks.add("preReload", p => hookGate.promise);
                await env.start();
                env.change("B");
                env.notify();
                await clock.tickAsync(0);
                env.notify();
                gate.resolve();
                await clock.tickAsync(0);
                attemptsLogged().should.eql([1]);
                // cycle B waits in the drain; the retry of A (1000 ms) fires meanwhile
                await clock.tickAsync(1500);
                env.reloadError = CREDENTIALS_ERROR();
                hookGate.resolve();
                await settle();
                // B failed (attempt 2, delay 2000): the fired retry did not start cycle C
                attemptsLogged().should.eql([1, 2]);
                env.flows.reloadFromStorage.callCount.should.equal(1);
                await clock.tickAsync(1999);
                env.flows.reloadFromStorage.callCount.should.equal(1);
                await clock.tickAsync(1);
                env.flows.reloadFromStorage.callCount.should.equal(2);
                attemptsLogged().should.eql([1, 2, 3]);
            });
            it("(guard) the retry fired during a superseded cycle is not lost - the reload is applied after it", async function() {
                fake(retry("fail", { min: 1000, max: 60000, attempts: 5 }));
                const gate = deferred();
                const hookGate = deferred();
                failFirstReadAfter(gate);
                let drains = 0;
                hooks.add("preReload", p => { drains++; return drains === 1 ? hookGate.promise : undefined });
                await env.start();
                env.change("B");
                env.notify();
                await clock.tickAsync(0);
                env.notify();
                gate.resolve();
                await clock.tickAsync(0);
                await clock.tickAsync(1500);
                // the retry of A fired during cycle B; a set-state operation supersedes B
                await lock.runExclusive(async function() {
                    const token = state.begin("set-state", { supersede: true });
                    state.end(token, { errors: [] });
                });
                hookGate.resolve();
                await clock.tickAsync(1000);
                env.applied.should.have.length(1);
                env.applied[0].rev.should.equal("B");
                state.get().state.should.equal("ready");
            });
            it("(guard, passes on the base) a successful cycle ends the periodic cycles of the exhausted state - no more reads of storage (#26)", async function() {
                fake(retry("fail", { min: 1000, max: 10000, attempts: 2 }));
                env.failAlways = true;
                await env.start();
                env.change("B");
                env.notify();
                await clock.tickAsync(1500);
                state.get().state.should.equal("failed");
                // storage works again: the periodic cycle applies the revision and ends the series
                env.failAlways = false;
                await clock.tickAsync(10000);
                state.get().state.should.equal("ready");
                env.applied.should.have.length(1);
                const reads = env.getFlowsCalls;
                await clock.tickAsync(60000);
                env.getFlowsCalls.should.equal(reads);
            });
            it("(guard, passes on the base) a retry scheduled by a failure after a success is not cancelled by the earlier success (#26)", async function() {
                fake(retry("fail", { min: 1000, max: 60000, attempts: 5 }));
                await env.start();
                env.change("B");
                env.notify();
                await clock.tickAsync(0);
                env.applied.should.have.length(1);
                // a later failing cycle schedules its own retry, which must run
                env.reloadError = CREDENTIALS_ERROR();
                env.change("C");
                env.notify();
                await clock.tickAsync(0);
                env.reloadError = null;
                attemptsLogged().should.eql([1]);
                await clock.tickAsync(1000);
                env.applied.should.have.length(2);
                env.applied[1].rev.should.equal("C");
            });
            it("fail: after a local deployment a pure read failure of storage still starts no new failed state (unchanged)", async function() {
                fake(retry("fail", { min: 1000, max: 1000, attempts: 2 }));
                env.failAlways = true;
                await env.start();
                env.change("B");
                env.notify();
                await clock.tickAsync(3000);
                state.get().state.should.equal("failed");
                await pipeline.deploy({ type: "full", source: "api", flows: { flows: flowsOf("D") } });
                await clock.tickAsync(0);
                await clock.tickAsync(20000);
                state.get().state.should.equal("ready");
                logged("error", "reload.retries-exhausted").should.have.length(1);
            });
            it("keepReady: credentials_load_failed in the reload step fails after retry.attempts cycles (a configuration error)", async function() {
                env = createEnv({ reload: retry("keepReady", { attempts: 3 }) });
                env.reloadError = CREDENTIALS_ERROR();
                await env.start();
                const watch = atFailedState();
                env.change("B");
                env.notify();
                await waitFor(() => state.get().state === "failed", 2000, "never failed");
                watch.off();
                watch.seen.reloads.should.equal(3);
                state.get().reload.should.containEql({ error: { code: "credentials_load_failed" }, keepReady: false });
                readiness().should.eql(READY_503);
                notifications().should.have.length(0);
            });
        });

        describe("maxStaleTime", function() {
            it("passes: /ready 503, one error log, the event with stale, no more attempts to log it", async function() {
                fake(retry("keepReady", { attempts: 1, max: 100000, maxStaleTime: 5000 }));
                await exhaustFake();
                readiness().should.eql(READY_WARN);
                logged("error", "reload.stale").should.have.length(0);
                const before = stateEvents.length;
                await clock.tickAsync(5000);
                readiness().should.eql(READY_503);
                state.get().state.should.equal("ready");
                logged("error", "reload.stale").should.have.length(1);
                stateEvents.length.should.equal(before + 1);
                const last = stateEvents[stateEvents.length - 1];
                last.state.should.equal("ready");
                last.reload.should.containEql({ stale: true, keepReady: true });
                await clock.tickAsync(20000);
                logged("error", "reload.stale").should.have.length(1);
            });
            it("is counted from the first failed read of the series, not from the end of the retries", async function() {
                fake(retry("keepReady", { min: 100, max: 1000, attempts: 4, maxStaleTime: 60000 }));
                await env.start();
                env.failAlways = true;
                env.change("B");
                const t0 = Date.now();
                env.notify();
                // the retries 100 + 200 + 400 ms: exhausted 700 ms after the first failed read
                await clock.tickAsync(700);
                state.get().should.have.property("reload");
                const reload = state.get().reload;
                reload.since.should.equal(t0);
                reload.staleDeadline.should.equal(t0 + 60000);
                (Date.now() - t0).should.equal(700);
                await clock.tickAsync(60000 - 700);
                readiness().should.eql(READY_503);
            });
            it("is counted from the first failure, not from every attempt", async function() {
                fake(retry("keepReady", { attempts: 1, max: 1000, maxStaleTime: 5500 }));
                await exhaustFake();
                const since = state.get().reload.since;
                await clock.tickAsync(5000);
                state.get().reload.since.should.equal(since);
                readiness().should.eql(READY_WARN);
                await clock.tickAsync(500);
                readiness().should.eql(READY_503);
            });
            it("recovery after it: back to ready ok", async function() {
                fake(retry("keepReady", { attempts: 1, max: 1000, maxStaleTime: 3000 }));
                await exhaustFake();
                await clock.tickAsync(3000);
                readiness().should.eql(READY_503);
                env.failAlways = false;
                env.change("A");
                await clock.tickAsync(1000);
                state.get().should.not.have.property("reload");
                readiness().should.eql(READY_OK);
            });
            it("stop() clears the timer: no event after the stop", async function() {
                fake(retry("keepReady", { attempts: 1, max: 100000, maxStaleTime: 5000 }));
                await exhaustFake();
                await env.reloader.stop();
                const before = stateEvents.length;
                await clock.tickAsync(10000);
                logged("error", "reload.stale").should.have.length(0);
                stateEvents.length.should.equal(before);
            });
            it("the stale timer does not keep the process alive and stop() ends it", async function() {
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
                    env = createEnv({ reload: retry("keepReady", { attempts: 1, max: 600000, maxStaleTime: 600000 }) });
                    await exhaust();
                } finally {
                    global.setTimeout = realSetTimeout;
                }
                // the retry timer and the stale timer
                recorded.length.should.be.aboveOrEqual(2);
                recorded.forEach(t => t.hasRef().should.be.false());
                await env.reloader.stop();
                recorded.forEach(t => t._destroyed.should.be.true());
            });
        });

        describe("active reporting", function() {
            it("an error log on entering with the code, the attempts and the active revision", async function() {
                env = createEnv({ reload: retry("keepReady") });
                await exhaust();
                const entries = logged("error", "reload.keep-ready");
                entries.should.have.length(1);
                entries[0].should.containEql("\"code\":\"storage_error\"").and.containEql("\"attempts\":2").and.containEql("\"rev\":\"A\"");
                // the message text of the error is for the log only
                entries[0].should.containEql("storage unavailable");
            });
            it("keepReady + storage_error: no contradicting retries-exhausted error log, only the keep-ready one", async function() {
                env = createEnv({ reload: retry("keepReady") });
                await exhaust();
                logged("error", "reload.retries-exhausted").should.have.length(0);
                logged("error", "reload.keep-ready").should.have.length(1);
                env.logs.error.should.have.length(1);
            });
            it("keepReady + a configuration error (fails) keeps the retries-exhausted error log", async function() {
                env = createEnv({ reload: retry("keepReady") });
                env.failError = Object.assign(new Error("no flow configuration"), { code: "invalid_flows" });
                await exhaust();
                logged("error", "reload.retries-exhausted").should.have.length(1);
            });
            it("mode fail keeps the retries-exhausted error log", async function() {
                env = createEnv({ reload: retry("fail") });
                await exhaust();
                logged("error", "reload.retries-exhausted").should.have.length(1);
            });
            it("an error log at most once per retry cycle while the condition lasts", async function() {
                fake(retry("keepReady", { attempts: 1, max: 60000, maxStaleTime: 0 }));
                await exhaustFake();
                logged("error", "reload.keep-ready").should.have.length(1);
                // a burst of notifications: failed attempts, no error logs
                for (let i = 0; i < 5; i++) {
                    env.notify();
                    await clock.tickAsync(1);
                }
                logged("error", "reload.still-failing").should.have.length(0);
                state.get().reload.attempts.should.be.above(5);
                await clock.tickAsync(60000);
                logged("error", "reload.still-failing").should.have.length(1);
                await clock.tickAsync(60000);
                logged("error", "reload.still-failing").should.have.length(2);
                logged("error", "reload.still-failing")[1].should.containEql("storage_error");
                logged("error", "reload.keep-ready").should.have.length(1);
            });
            it("the editor notification: one retained warning while the condition lasts, cleared on recovery", async function() {
                env = createEnv({ reload: retry("keepReady") });
                await exhaust();
                // further failed attempts do not repeat it
                const calls = env.getFlowsCalls;
                await waitFor(() => env.getFlowsCalls >= calls + 3);
                notifications().should.have.length(1);
                const n = notifications()[0];
                n.retain.should.be.true();
                n.payload.should.containEql({ type: "warning", error: "reload_failed", text: "notification.warnings.reload_failed", code: "storage_error" });
                new Date(n.payload.since).toISOString().should.equal(n.payload.since);
                n.payload.since.should.equal(new Date(state.get().reload.since).toISOString());
                Object.keys(n.payload).sort().should.eql(["code", "error", "since", "text", "type"]);
                // recovery: a message that disappears (the editor closes it after the timeout);
                // not retained, so the retained warning is removed
                env.failAlways = false;
                env.change("A");
                await waitFor(() => notifications().length === 2);
                notifications()[1].should.eql({ id: "reload-failed", payload: { type: "success", text: "notification.warnings.reload_recovered", timeout: 10000 }, retain: false });
                notifications().should.have.length(2);
            });
            it("no recovery message when there was no notification (no editor warning was shown)", async function() {
                env = createEnv({ reload: retry("keepReady") });
                env.failError = Object.assign(new Error("no flow configuration"), { code: "invalid_flows" });
                await exhaust();
                notifications().should.have.length(0);
                env.failError = null;
                env.failAlways = false;
                env.change("A");
                await waitFor(() => state.get().reload === undefined, 2000, "not recovered");
                notifications().should.have.length(0);
            });
            it("maxStaleTime: the same notification is updated (type error, reload_stale), retained", async function() {
                fake(retry("keepReady", { attempts: 1, max: 100000, maxStaleTime: 5000 }));
                await exhaustFake();
                notifications().should.have.length(1);
                await clock.tickAsync(5000);
                notifications().should.have.length(2);
                notifications()[1].retain.should.be.true();
                notifications()[1].payload.should.containEql({ type: "error", error: "reload_stale", text: "notification.warnings.reload_stale", code: "storage_error" });
            });
            it("the event instance:state is emitted when only the condition changes", async function() {
                env = createEnv({ reload: retry("keepReady") });
                await env.start();
                env.failAlways = true;
                env.change("B");
                stateEvents.length = 0;
                env.notify();
                await waitFor(() => state.get().reload !== undefined);
                const entered = stateEvents.filter(e => e.reload);
                entered.should.have.length(1);
                entered[0].state.should.equal("ready");
                entered[0].reload.should.containEql({ keepReady: true, attempts: 2, activeRev: "A" });
                // another failed attempt: attempts changed
                await waitFor(() => stateEvents.some(e => e.reload && e.reload.attempts > 2));
                // recovery: an event without the condition and with the same state
                env.failAlways = false;
                env.change("A");
                await waitFor(() => stateEvents[stateEvents.length - 1].reload === undefined);
                stateEvents[stateEvents.length - 1].state.should.equal("ready");
            });
        });

        describe("contract", function() {
            it("the listener of the cycle ignores events that change only the condition", async function() {
                env = createEnv();
                const d = deferred();
                hooks.add("preReload", p => d.promise);
                await env.start();
                env.change("B");
                env.notify();
                await waitFor(() => states.indexOf("reloadPending:draining") !== -1);
                // a deployment on this instance supersedes the cycle (once) ...
                state.begin("deploy", { supersede: true });
                logged("info", "reload.superseded").should.have.length(1);
                // ... condition-only events in the state "deploying" (previous: reloadPending) do not react again
                state.markReloadFailed({ error: "storage_error", attempts: 1 });
                state.markReloadFailed({ error: "storage_error", attempts: 2 });
                state.clearReloadFailed();
                logged("info", "reload.superseded").should.have.length(1);
                d.resolve();
            });
            it("a condition-only event during a running cycle does not abort it", async function() {
                env = createEnv();
                const d = deferred();
                hooks.add("preReload", p => d.promise);
                await env.start();
                env.change("B");
                env.notify();
                await waitFor(() => states.indexOf("reloadPending:draining") !== -1);
                state.markReloadFailed({ error: "storage_error", attempts: 1 });
                d.resolve();
                await waitFor(() => env.applied.length === 1 && state.get().state === "ready");
            });
            it("coexists with health.unreadyGrace: a reload after the condition waits for the grace once", async function() {
                fake(retry("keepReady", { attempts: 1, max: 100000, maxStaleTime: 0 }));
                env.runtime.settings.health = { enabled: true, unreadyGrace: 500 };
                env.reloader.init(env.runtime);
                let drainStart = null;
                state.onChange(info => {
                    if (info.draining && drainStart === null) {
                        drainStart = Date.now();
                    }
                });
                await exhaustFake();
                const t0 = Date.now();
                env.failAlways = false;
                env.notify();
                await clock.tickAsync(499);
                env.applied.should.have.length(0);
                drainStart.should.be.aboveOrEqual(t0);
                await clock.tickAsync(1);
                env.applied.should.have.length(1);
                (Date.now() - drainStart).should.equal(500);
                await clock.tickAsync(0);
                state.get().should.not.have.property("reload");
                logged("info", "reload.unready-grace").should.have.length(1);
            });
            it("coexists with health.unreadyGrace: a recovery with the same revision has no grace and no drain", async function() {
                fake(retry("keepReady", { attempts: 1, max: 100000, maxStaleTime: 0 }));
                env.runtime.settings.health = { enabled: true, unreadyGrace: 500 };
                env.reloader.init(env.runtime);
                await exhaustFake();
                env.failAlways = false;
                env.change("A");
                env.notify();
                await clock.tickAsync(0);
                state.get().should.not.have.property("reload");
                logged("info", "reload.unready-grace").should.have.length(0);
                states.should.not.containEql("reloadPending:draining");
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

        it("an editor deployment is not delayed: no drain, no preReload, no grace", async function() {
            setup({ enabled: true, unreadyGrace: 60000 });
            let hookCalls = 0;
            hooks.add("preReload", p => { hookCalls++ });
            await env.start();
            const result = await pipeline.deploy({ type: "full", source: "api", flows: { flows: flowsOf("D") } });
            result.rev.should.equal("deployed");
            // the fake clock was not advanced: a grace would never have ended
            Date.now().should.equal(0);
            hookCalls.should.equal(0);
            (notReadyAt === null).should.be.true();
            states.should.not.containEql("reloadPending:draining");
            states.should.containEql("deploying");
        });

        it("the second preReload round (D-17) adds no grace and keeps the deadline", async function() {
            const map = { B: ["t1"], C: ["t1", "t2"] };
            setup({ enabled: true, unreadyGrace: 500 }, { type: "diff", preReloadTimeout: 5000 }, { changedFlows: loaded => map[loaded.rev] });
            const calls = [];
            hooks.add("preReload", p => {
                calls.push({ rev: p.rev, deadline: p.deadline, at: Date.now() });
                if (calls.length === 1) {
                    env.change("C");
                }
            });
            await trigger();
            await clock.tickAsync(499);
            env.applied.should.have.length(0);
            calls.should.have.length(1);
            await clock.tickAsync(1);
            // after the grace of the first round: the second round is run at once
            calls.should.have.length(2);
            calls[1].at.should.equal(500);
            calls[1].deadline.should.equal(calls[0].deadline);
            env.applied.should.have.length(1);
            env.applied[0].rev.should.equal("C");
            Date.now().should.equal(500);
        });
    });
});
