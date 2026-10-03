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
 *   Z-10: in-memory coordinator shared by several coordination plugins in one
 *   process - stands in for a cluster coordinator in the tests
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * Creates an in-memory coordinator. Each call of `createPlugin()` returns a
 * plugin of type `node-red-coordination` for one instance; all plugins of one
 * coordinator share the leadership and the claims.
 *
 * - the first started (connected) member is the leader; when it stops,
 *   resigns or disconnects, the next connected member becomes the leader
 * - `disconnect(plugin)` simulates a lost connection: the member is no longer
 *   leader and its claims are rejected; `reconnect(plugin)` joins again
 */
function createCoordinator() {
    const members = [];
    const claims = new Map();
    let leader = null;

    function electLeader() {
        if (leader && leader.connected && leader.started && !leader.resigned) {
            return;
        }
        const previous = leader;
        leader = members.find(m => m.connected && m.started && !m.resigned) || null;
        if (previous && previous !== leader) {
            previous.emit(false);
        }
        if (leader && leader !== previous) {
            leader.emit(true);
        }
    }

    function createPlugin(id) {
        const listeners = new Set();
        const member = {
            id: id,
            started: false,
            connected: true,
            resigned: false,
            emit: function(isLeader) {
                listeners.forEach(l => l(isLeader));
            }
        };
        members.push(member);
        const plugin = {
            type: "node-red-coordination",
            member: member,
            startCalls: 0,
            start: function(ctx) {
                plugin.startCalls++;
                plugin.ctx = ctx;
                member.started = true;
                member.resigned = false;
                electLeader();
                return Promise.resolve();
            },
            stop: function() {
                member.started = false;
                if (leader === member) {
                    leader = null;
                    member.emit(false);
                }
                electLeader();
                return Promise.resolve();
            },
            resign: function() {
                member.resigned = true;
                electLeader();
                return Promise.resolve();
            },
            isLeader: function() {
                return leader === member && member.connected;
            },
            onLeaderChange: function(listener) {
                listeners.add(listener);
                return function() { listeners.delete(listener) };
            },
            claim: function(key, ttlMs) {
                if (!member.connected || !member.started) {
                    return Promise.reject(new Error("not connected"));
                }
                const now = Date.now();
                const current = claims.get(key);
                if (current && current.expiresAt > now) {
                    return Promise.resolve(null);
                }
                const entry = {owner: member.id, expiresAt: now + ttlMs};
                claims.set(key, entry);
                return Promise.resolve({
                    key: key,
                    expiresAt: entry.expiresAt,
                    release: function() {
                        if (claims.get(key) === entry) {
                            claims.delete(key);
                        }
                        return Promise.resolve();
                    }
                });
            },
            status: function() {
                return {connected: member.connected};
            }
        };
        return plugin;
    }

    return {
        createPlugin: createPlugin,
        claims: claims,
        get leader() { return leader ? leader.id : null },
        disconnect: function(plugin) {
            plugin.member.connected = false;
            if (leader === plugin.member) {
                leader = null;
                plugin.member.emit(false);
            }
            electLeader();
        },
        reconnect: function(plugin) {
            plugin.member.connected = true;
            electLeader();
        }
    };
}

/**
 * Creates the part of the runtime used by the coordination module.
 * @param {Object} settings - runtime settings (for example `{coordination: {plugin: "cluster"}}`)
 * @param {Object[]} plugins - registered plugins (each with `id` and `type`)
 * @param {Object} events - event emitter of the runtime
 */
function createRuntime(settings, plugins, events) {
    return {
        settings: Object.assign({get: function(p) { return settings[p] }}, settings),
        events: events,
        plugins: {
            getPlugin: function(id) { return plugins.find(p => p.id === id) },
            getPluginsByType: function(type) { return plugins.filter(p => p.type === type) }
        }
    };
}

module.exports = {
    createCoordinator: createCoordinator,
    createRuntime: createRuntime
};
