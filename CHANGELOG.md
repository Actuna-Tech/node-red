#### Unreleased: Instances and reload

 - Fix (#51): an error of the comparison of the credentials in the reread under the deploy lock (for example
   `credentials_digest_failed`: a getter or a Proxy of a storage plugin object that throws) has the code `reload_failed`,
   as in step 2 of the cycle, instead of `storage_error`. With `deploy.reload.retry.onExhausted: "keepReady"` the instance
   no longer stays ready (`/ready` 200 `warn`) - after the retries it is `failed` (`/ready` 503), because `"keepReady"`
   covers only a read error of storage (R-47). With `"fail"` the same path after a recovery by a local deployment
   starts a new series (#17). A real read error of storage (`storage.getFlows`) keeps the code `storage_error`,
   `credentials_load_failed` keeps its code. Only with `deploy.reload.watch: true`. Tests: `reload_spec.js`
 - Fix (#56): `credentials.init()` resets the module flag `removeDefaultKey`. A migration of the credentials to a
   user key that `load()` had started and `export()` had not finished (generated key `_credentialSecret` and
   `credentialSecret` both set) was carried over to the next `init()` in the same process, and the first `export()`
   of the new instance deleted `_credentialSecret` from its settings without migrating its credentials (with
   settings that cannot delete: `settings.not-available`). It matters for embedding (a repeated `RED.init()`) and
   for tests; a single `init()` per process behaves as before. The other module variables are not reset: `load()`
   overwrites the key, its type and `encryptedCredentials`, and `export()` reads them only after `load()` or `setKey()`.
   Tests: `credentials_spec.js` (a started migration is not carried over), `reload_spec.js` (REV-N01: the tests with
   the real credentials module drop the state after each test, also when an assertion fails)
 - Tests only (no change under `packages/`): `credentials_spec.js` (block "key selection of load() (a pending
   migration)") finishes the migration after each test (`export()`). The tests left the module flag
   `removeDefaultKey` set, `credentials.init()` does not reset it, and in `npm run mocha` (one process) the
   next redeploy in a node test failed with `settings.not-available` (4 tests: `60-link`, `21-httpin` x2,
   `70-CSV`). Fixes the test regression that came with Merge #38
 - Documentation only (#43, R4): the `type` field of the `preReload` payload is the **configured** type
   (`deploy.reload.type`), not the actual one, and the contract does not change. The scope of a reload is
   decided by `changedFlows` (`null` = all flows): with `type: "diff"` the reload is a full one when the
   credentials changed (also during the drain - the extra round then has `changedFlows: null`) or on a
   global change, so the event is then `{type: "diff", changedFlows: null}`; the extra round after a change of
   the flows alone has the list of the new flows and the reload stays a diff. Described in the `settings.js` template, `MIGRACJA.md` and `FORK.md`
 - Reload from storage (`deploy.reload.watch: true`) compares the credentials like the flow
   revision (#2): the runtime computes a digest (HMAC-SHA256 with a per-process random key, of the canonical JSON with sorted keys) of the
   **decrypted** credentials read from storage and compares it with the digest of the running
   configuration (computed after the credentials were loaded - on start, on a reload and on an
   own save); the ciphertext is never compared (a random IV changes it on every save). A reload
   happens when the revision or the credentials digest differ, so a change of the credentials
   alone is reloaded after any notification, a lost notification is healed by the next one, and
   re-encrypting the same content or an own save is not a change. **Behaviour change for storage
   plugins that used the flag:** `credentialsChanged` of a `watchFlows` notification is now only a
   hint to read storage - it no longer forces a drain and a reload by itself (and does not prevent
   one); a plugin only has to return the changed content from `getCredentials()`. The
   `credentialsChanged` field of the `preReload` payload is computed from the comparison. Stored
   credentials are read with the key the credentials load would use - also the old generated key
   while a migration to `credentialSecret` is pending - without migrating, saving or logging
   anything; credentials that this key cannot decrypt fail with `credentials_load_failed` (the same
   path as a failed reload). An instance that started with credentials it could not decrypt has no
   digest: with the running revision in storage that is not an error (as before), a new revision
   goes the normal way. A change of the credentials during the drain of a `diff` reload gets an
   extra `preReload` round for all flows (`changedFlows: null`), like a change of the flows. The digest is internal: never logged and not part of the result of
   `GET /flows` (still `{flows, rev}`). New `credentials.digest()` of the runtime is pure (it
   changes no cache, key or setting). Nothing changes without `deploy.reload.watch`
 - New settings `deploy.reload.retry.onExhausted` (`"fail"` by default - nothing changes: after
   the retries the instance is `failed` and `/ready` is 503) and `deploy.reload.retry.maxStaleTime`
   (ms, default 1800000, used only with `"keepReady"`; 0 - no limit). With `"keepReady"` a failure
   to read the shared storage after the retries no longer takes a ready instance out of rotation:
   it stays ready on the previous revision and `/ready` answers 200
   `{"status":"warn","reason":"reload_failed"}` (a constant body); an idle instance stays idle, errors
   of the configuration (`credentials_load_failed`, `invalid_flows`, a corrupt flow file:
   `invalid_json`, `empty_file`) and a failed start still give `failed` / 503, and after
   `maxStaleTime` (counted from the first failed read) `/ready` is 503. With the default
   `"fail"` nothing changes at all: no condition, no extra event, log or notification. The situation is reported as an error:
   an error log when it starts and once per `retry.max` while it lasts, a persistent notification in
   the editor (it can be dismissed, turns into an error after `maxStaleTime` and into a message
   that disappears on recovery), the new `reload` condition in the `instance:state` event
   (`error.code`, `since`, `attempts`, `activeRev`, `rev`, `keepReady`, `staleDeadline`, `stale`)
   and an info log `reload.recovered`.
   The condition ends when storage holds the running revision again (no drain, no restart), when a
   reload of a new revision succeeds or on a successful deployment on the instance. New contract
   rule: `instance:state` is also emitted when only the `reload` condition changes (the states of
   R-23 and their transitions are unchanged). Decision R-47 (#1)
 - New setting `health.unreadyGrace` (ms, not set by default - nothing changes without it): for a
   planned stop - a stop signal (SIGTERM) and a reload of the flows after a change in storage
   (`deploy.reload`) - `/ready` answers 503 for at least this long, counted from the start of the planned stop or
   reload (when `/ready` answers 503 at the latest; an instance that was already not ready waits
   the full time again - safe, only longer), before the flows stop, so a load balancer that polls `/ready` takes the instance out of rotation
   first. The wait runs at the same time as the `preShutdown` / `preReload` hooks (the flows stop
   after the longer of the two) and is counted inside `shutdownTimeout` and
   `deploy.reload.preReloadTimeout`. On a stop signal only a second signal ends the wait; before a
   reload a deployment on this instance or the stop of the runtime ends it. Without `shutdownTimeout` a shutdown waits exactly `unreadyGrace` (the
   hook is still not called). Deployments from the editor or the Admin API are not delayed. Needs
   `health.enabled: true`; an invalid value or a missing `enabled` logs a warning and uses no grace
   (#8, #1)
 - New setting `startupTimeout` (ms, off by default, the behaviour is unchanged without it): the limit of
   `runtime.start()` - the start of the storage, the settings, the nodes, the context, the coordination plugin and
   the observer of storage, not the load and start of the flows that follow it. A start that does not complete
   in time fails with an error `startup_timeout` (fields `step` - the step it was waiting for - and `timeout`); the
   instance is `failed` / `startup-error`. In the command line this is a failed start of #67: the runtime is
   stopped (at most 5000 ms) and the process exits with 1 - also when the hanging step held no handle (before: exit
   0 without a log) or held one (before: a process without a listening server). In an embedding application
   `RED.start()` rejects with that error and the library never calls `process.exit`. A step that completes after
   the limit is ignored and logged as a warning (nothing after it runs, the flows are not loaded); a coordination
   plugin that starts late is resigned and stopped at once (stopped also when the resign fails), a late own server of the probes and a late observer
   of storage are stopped. A step that fails after the limit is only a warning. A stop during the start
   (`RED.stop()`, a signal) ends the attempt at once with `startup_stopped` and clears the limit (#73). An
   invalid value (not a number of
   ms > 0 and <= 2147483647, for example the string of an environment variable) logs one warning and sets no
   limit. The calls of `resign()` and `stop()` of the coordination are made one after the other (a stop of the
   runtime waits for the release of a late coordination). Recommended value in `FORK.md` §2: `120000`; the budget
   of the Kubernetes `startupProbe` must be longer than `startupTimeout` + 5 s + the time to load the flows (#71,
   R-51)
 - New setting `hooks: { "preReload.<label>": fn, "preShutdown.<label>": fn }` registers the
   `preReload` and `preShutdown` hooks from `settings.js` when the runtime is initialised -
   before the plugins are loaded and before the flows start (not set by default: no hooks,
   nothing changes). Same semantics as `RED.hooks.add(id, fn)` (a function with one
   parameter returns a promise). Only these two hooks and functions are accepted; an
   invalid name, a missing label or a value that is not a function fails the start with an
   error `invalid_hook_setting` that names the key, and nothing is registered. Hooks of
   `settings.js` are registered before the plugins load, so they run first; the same label added by a plugin is
   "already registered" (#7)
 - A hook of the `hooks` setting that would never be called now logs a warning at start (#15):
   `preShutdown.<label>` without `shutdownTimeout` (the hook is not called, R-37; `health.unreadyGrace`
   alone only delays the stop) and `preReload.<label>` without `deploy.reload.watch: true` (the flows
   are never reloaded from the storage). The warning names the hook and the missing setting. It is a
   pure diagnostic: the hooks stay registered, nothing else changes; no warning without the `hooks`
   setting, when the setting is there, or for hooks added by plugins. Test of `hooks` with
   `health.unreadyGrace` (the hook is called, the stop takes at least the grace)
 - An editor-only instance (`editorOnly`) does not start the coordination plugin and is never the
   leader, so `inject` nodes with "Run only on one instance" fire on the instances that run the flows (#4)
 - Documented: health probes without `health.port` are public on the main server; `preReload` and
   `preShutdown` hooks must take exactly one parameter (#5)
 - Drain of the HTTP requests before the flows stop (#40, R-49): a request that `http in` accepted no longer
   stays without an answer when a deployment (any type), a reload from storage, `POST /flows/state` stop or a project
   switch stops the node that holds its message. New setting `deploy.drainHttpNodeRequests: {enabled, timeout,
   retryAfter}` (`enabled: false` by default - unchanged behaviour: no middleware, no tracking, `stop()` works as
   before). When enabled, the runtime waits, at most `timeout` (30000 ms), until the requests accepted by an
   `http in` node are answered, stops the flows, and then answers the requests that are still open with 503: all of
   them after a full stop, the ones past their deadline after a partial one (`nodes`/`flows`). The limit is hard: a
   request longer than `timeout` gets 503 also in flows the deployment does not change. The 503 has a fixed body and
   one of two codes: `http_drain_not_accepted` (the request did not reach a flow, safe to repeat; `Retry-After`) and
   `http_drain_outcome_unknown` (it did; `Retry-After` only for GET, HEAD and OPTIONS); headers set earlier by a
   handler are removed except `Access-Control-*` and `Vary`; a response that already started is destroyed. Only
   accepted requests extend the wait, nothing is read from a request before the authentication, and `RED.stop` answers
   the open requests at once. Deployments, reloads and `POST /flows/state` take up to `timeout` longer. Requests to the
   routes of other nodes are drained only when the node follows the optional contract (`Symbol.for("node-red.httpNode.drain")`
   on the handler and on `req`/`res`, see `MIGRACJA.md`). A message kept in the context and answered after a full stop
   now gets 503 instead of a late 200. New translated messages (`httpDrain.*`, `httpin.errors.drained-response`)
 - Drain of the HTTP requests (#82, R-49 addendum): the debug record of each drain 503 names the node of the route
   (`id`, `type`, `z`; the console shows `[http in:<name or id>]`) when the route was registered with
   `node.registerHttpRoute` (the core `http in`); other routes are logged as before. No URL, path or node name in the
   record
 - Drain of the HTTP requests (#82): the guard uses one timer - every 250 ms while a stop of the flows is in progress,
   afterwards one timeout at the nearest deadline (no periodic timer once the flows have restarted); it no longer
   re-reads the requests that already have a deadline; inside the stop a 503 that could not be written is tried again
   at every period (`answer-failed` logged once per request); an answered request leaves the guard at once. A request
   or a response that cannot be read no longer stops the answers to the other requests. Clients see the same answers
 - Drain of the HTTP requests (#82): only a request that is open, accepted by its node and on a route with the mark is
   waited for (one rule for a deployment, a stop signal and the count of the editor notice); an accepted request on an
   unmarked route no longer holds a deployment; a response that has ended counts as finished before its `finish` event
 - A stop signal waits for the HTTP requests in progress (#82): with `deploy.drainHttpNodeRequests.enabled: true` and
   `shutdownTimeout` set, `health.shutdown` (SIGTERM, SIGINT, `RED.health.shutdown`) waits after `health.unreadyGrace`
   and the `preShutdown` hooks for the requests accepted by `http in` at that moment, at most
   `min(timeout, the time left of shutdownTimeout)`, then stops the flows; the requests still open get 503 as before. New
   log messages `httpDrain.shutdown-waiting` and `httpDrain.shutdown-timeout`; a second signal ends the wait at once.
   **Recorded exception to "off by default" (D8):** this applies to existing configurations that already set both
   options - a request that the flow answers in time now gets its answer instead of 503, and the stop takes up to that
   long. Without `shutdownTimeout` nothing changes; `RED.stop()` called directly still does not wait
 - Instance state (#82): while a stop of the flows waits for HTTP requests, `instance:state` and
   `runtime.state.get()` carry the condition `httpDrain: {requests, since, deadline}` (the state is unchanged; the event
   is emitted also when only this field changes, as for `reload`), and the editor shows a retained warning
   (`notification/http-drain`, the count and the limit; en-US and pl), removed when the wait ends. Not in `stopping`
 - Admin API (#82): removing a module or disabling a module or a node set while a stop of the flows waits for HTTP
   requests or stops the nodes (`deploy.drainHttpNodeRequests` on) answers **409** `{code: "http_drain_in_progress"}`
   with a constant message, audited as before; retry after the deployment. Unknown modules and types in use keep their
   errors; with the drain off nothing changes
 - Drain of the HTTP requests (#82): a `timeout` above 300000 ms (5 min) logs one warning at start
   (`httpDrain.long-timeout`); the value is used as given
 - `http in` (#82): new option "Stop behaviour" (`drainMode`): "Wait for the request (drain)" (`"drain"`, default, also
   for nodes saved without it - unchanged) or "Long-lived connection (SSE/long-poll)" (`"long"`): the route is not
   waited for and never answered 503 by the drain, and the open responses of the node are closed when the node stops
   (with the drain on or off), so event-stream clients reconnect to the new node. A stream stays open and silent when
   only its writer is restarted (a `nodes` deployment, a writer behind link nodes or one that takes the response from
   the context) - send a heartbeat. Labels en-US and pl, help en-US
 - Requests to the routes of the nodes (`http in` and every node that registers a route on `RED.httpNode`)
   no longer get 404 while the flows restart (#8): new setting `deploy.holdHttpNodeRequests:
   {enabled, timeout, maxPending, retryAfter}` (`enabled: false` by default - unchanged behaviour). When
   enabled, a middleware mounted on the httpNode app before the routes of the nodes holds the requests
   from the start of a deployment or of a reload from storage until the new flows have started (the
   instance state `deploying`/`reloading`), then the new flows answer them. After `timeout` (5000 ms)
   or above `maxPending` (1000) held requests the answer is 503 `{code: "http_hold_timeout"}` /
   `{code: "http_hold_queue_full"}` with `Retry-After` (`retryAfter`, 1 s; `maxPending` is global, not per
   client; a failure while releasing a request answers 503 `{code: "http_hold_release_failed"}`). Only
   requests for which the httpNode app has no route at that moment are held: the routes of unchanged nodes
   (a partial deployment) are served at once. If the start fails, the requests are released to the normal routing. The Admin API and the editor are not held; static files under
   `httpNodeRoot` and CORS preflight requests are held, and the 503 has no `Access-Control-*` headers.
   `http in` with "skipBodyParsing": a request that bypassed the capture of the raw body (it arrived while
   the route was replaced) is read raw by the route itself, so the handler still gets a `Buffer` (this no longer
   depends on the setting, see #16)

Features
 - Polish (`pl`) translation of the editor (`editor.json`, 317 keys) and of the core nodes
   (`messages.json`, 102 keys), partial: keys without a translation fall back to English.
   The runtime messages, the JSONata and info-tip catalogs and the help of the other nodes are not
   translated yet. The language is listed in the language selector of the user settings and is
   used by a browser set to Polish when the user has not selected a language.
 - Polish help of the `debug`, `function`, `change` and `json` nodes (`locales/pl/common/21-debug.html`,
   `function/10-function.html`, `function/15-change.html`, `parsers/70-JSON.html`). The files follow the
   en-US 5.0.7 help: the same sections, property names and code samples (Z-13, #12). When the
   editor language is Polish, these nodes show the Polish help instead of the English one.
 - Polish locale files (`pl/messages.json`, `pl/editor.json`) follow the glossary of `FORK.md`: "węzeł"
   instead of "node", "node'a", "node'y" and "bloczek", "subflow" instead of "podflow", and the impersonal form instead of the second
   person ("Można zmodyfikować flow…" instead of "Możesz zmodyfikować flow…"). Only the wording changes,
   the keys are unchanged (Z-13, #21).

 - New API for the coordination of instances that run the same flows: `RED.coordination`
   for nodes (`isLeader()`, `onLeaderChange(node, listener)`, `claim(key, ttlMs)`,
   `info()`) and a plugin type `node-red-coordination` for coordination plugins installed
   from outside the core. The plugin is selected only explicitly with the new setting
   `coordination: {plugin, options}`; without it the built-in local coordination is used
   (a single instance: always the leader, claims in memory) and the behaviour is unchanged.
   An unknown plugin or a failing plugin start fails the start of the runtime. The
   coordination starts before the flows start; `RED.stop()` resigns the leadership before
   the flows stop and stops the plugin after them.
 - Inject node: new option "Run only on one instance" (`singleInstance`, off by default).
   With a coordination plugin a scheduled trigger ("at a specific time", "interval between
   times") fires on the instance that claims it, an "interval" and "inject once" fire only
   on the leader and the node shows the "standby" status on the other instances. The button
   of the node is not affected. Nodes without the option are exported as before.
 - Reload of the flows after a change in storage made by another instance: new setting
   `deploy.reload: { watch, type, preReloadTimeout, concurrency, retry }` (`watch: false` by
   default - nothing changes without it) and the optional function `watchFlows(callback)` of
   storage plugins (without it the setting only logs a warning). The flows are reloaded in the
   process - storage is read again under the deploy lock and the newest revision is started,
   nothing is saved, stopped flows are not started, the process and its HTTP server keep running.
   `type: "full"` (default) restarts all flows, `"diff"` only the changed ones (a changed global
   configuration or credentials restart all). Own writes and duplicate notifications are skipped
   by comparing the revisions; notifications during a reload are coalesced into one more reload,
   those during the start are handled after it; a deployment on this instance supersedes a pending
   reload. The instance state is `reloadPending` → `reloading`; `/ready` answers 503 from the
   start of the drain until the reload has completed
 - New hook `preReload` (`{rev, activeRev, type, changedFlows, credentialsChanged, deadline,
   signal}`, frozen): drains the work in progress before the reload, at most
   `deploy.reload.preReloadTimeout` (default 20 minutes). It can only delay the reload - a
   failure, `false` or the timeout are logged and the flows are reloaded anyway. `signal` is
   aborted on shutdown (`"stopping"`) or when a deployment supersedes the reload
   (`"superseded"`). Flows changed during the drain outside `changedFlows` get one more
   `preReload` (at most one round)
 - `deploy.reload.concurrency` (an integer): at most this many instances drain and reload at the
   same time, through reload slots of a coordination plugin; waiting instances keep the old
   configuration and stay ready, also without a connection to the coordinator. No effect with the
   local coordination (warning)
 - `deploy.reload.retry: { min, max, attempts }` (default `1000`, `60000` ms, `10`): a failed
   read of storage is retried with an exponential delay; after `attempts` failures the instance
   state is `failed` (`/ready` 503) and the running flows are not stopped. With `watch: true` a
   rejected registration of `watchFlows` fails the start
 - The file storage provides `watchFlows`: `flowFile` and its credentials file are watched (file
   system events and polling - also on a shared volume, with `readOnly` and `readOnlyUserDir`);
   own writes and rewrites with the same content are not reported. Not available with projects
 - A reload reads storage strictly (`getFlows({strict: true})`, also passed to storage plugins): a
   read error or an incomplete configuration - a missing, empty or invalid flow file of the file
   storage, a plugin result without an array of flows - is a failed read (retries, then `failed`)
   and never reloads an empty configuration. The read at start is unchanged
 - A reload superseded by another operation on the instance (`POST /flows/state` during the
   drain, or a deployment that fails after it started - for example 400 `read_only_user_dir`) is
   not lost: the revision in storage is compared with the active one again and the reload is
   resumed when they differ
 - After the retries of a failed read were exhausted (`failed`) storage is read again every
   `deploy.reload.retry.max`: the instance becomes ready again once storage can be read, without
   a new notification. The timers of the reload do not keep the process alive and its waits end
   when the runtime stops
 - The file storage keeps the last known content per observer, so two observers of the same file
   in one process are both notified
 - New setting `editorOnly` (default `false`): an editor-only instance loads the flows and saves
   deployments but never starts the flows. The instance state is `loaded` (`/health/ready` 200),
   `runtimeFlowState` is neither read nor saved and safe mode is not ended by a deployment. With
   `deploy.response: "started"` deployments answer `{rev, started: false}` (`POST /flows`, and
   `POST /flow`, `PUT /flow/:id` with the v2 api). `POST /flows/state` start answers 409
   `editor_only`, stop has no effect. Missing node types only log a warning (the state stays
   `loaded`, not `failed`) and the modules of the function node are not installed. Debug messages, node status and admin routes of node
   instances are not available on such an instance

Editor

 - On an editor-only instance the editor shows that the flows are not run on this instance, offers
   no Start/Stop flows, and disables "Restart Flows", the node buttons (for example inject) and
   the "Inject now" button of the inject dialog with a tooltip

Runtime

 - New internal module of the instance state (`runtime/lib/state.js`, available to the runtime as
   `runtime.state`): states `init`, `starting`, `ready`, `deploying`, `reloadPending`, `reloading`,
   `idle`, `loaded`, `failed`, `stopping`, `stopped`; every change emits the event `instance:state`
   with `{state, previous, reason}` (plus `since`, `draining`, `errors`) on `RED.events`. The module
   is passive - responses, logs and the order of the existing events do not change
 - `RED.stop(reason)` / `runtime.stop(reason)`: an optional reason (for example `"SIGTERM"`) given
   to `instance:state` and logged; without it nothing more is logged
 - A failure to read the flows or to start them when the runtime starts is no longer swallowed
   silently: the instance state is `failed` (the log messages and the result of `RED.start()` are
   unchanged)
 - The result of the start of the flows reports `flowsRunning: false` with a `reason` when the
   flows were not started on purpose (safe mode, flows stopped through `POST /flows/state`)
 - New setting `health: { enabled, path, port, host }` (disabled by default): health probes
   `<path>/live` (200 while the process runs) and `<path>/ready` (200 when the flows run or, on an
   editor-only instance, are loaded; otherwise 503 with the constant body `{"status":"unavailable"}`),
   without authentication, `Cache-Control: no-store`, 405 for other methods, 404 for other paths.
   Without `port` they are mounted on the main server before any authentication and the server
   listens even with `httpAdminRoot: false` and `httpNodeRoot: false`; with `port` a separate
   server is started (`host` defaults to `uiHost`); a port in use fails the start
   (`health.port-in-use`)
 - New setting `shutdownTimeout` (ms, not set by default): on a stop signal `/ready` answers 503 at
   once, the new hook `preShutdown` (`{reason, deadline, signal}`) is called and waited for at most
   `shutdownTimeout`, then the flows stop. Without the setting the hook is not called and the flows
   stop at once as before. A second signal during the drain stops at once
 - With `health.enabled` the HTTP server is closed (idle connections too) after the flows stopped
   on a stop signal; without it the shutdown is unchanged
 - New api for embedding applications `RED.health` (`enabled`, `path`, `usesMainServer`, `handler`,
   `shutdown({reason, signal})`, `closeServer(server, limit)`)
 - The CLI logs a failed shutdown (`Shutdown failed: ...`) and exits with 1 instead of an
   unhandled rejection
 - The CLI passes the signal as the stop reason (`RED.stop("SIGTERM")`), logged as
   `Stopping Node-RED (SIGTERM)`
 - New setting `readOnlyUserDir` (default `false`) and the CLI environment variable
   `NODE_RED_READ_ONLY_USER_DIR`: the runtime does not write to the user directory. Palette
   install/update/remove/upload, auto-install of missing modules, modules of the function node and
   Projects are disabled (settings set to `true` are overridden with a warning); one log block at
   start lists the disabled features. With the file storage a deployment and saving a library entry
   are rejected with 400 `read_only_user_dir` (also for an absolute `flowFile` outside the user
   directory), and so is removing a palette module (`DELETE /nodes/:module`, before: `npm remove`
   was run); the installers reject install, update, upload and remove and the modules of the
   function node with `read_only_user_dir` whatever the other settings say; settings and sessions are kept in memory only; a `localfilesystem` context store in
   the user directory fails the start. With the environment variable the CLI does not copy the
   default settings file to `~/.node-red`
 - The CLI no longer fails with an exception when the default settings file cannot be copied to the
   user directory: it warns and uses the default settings file
 - The existing `readOnly` setting is described in the settings template
 - With `readOnly` or `readOnlyUserDir` the file storage reads the backup of an empty flow or
   credentials file without copying it over the file (before, the backup was copied also with
   `readOnly`)

Fixes

 - A missing `instanceId` no longer breaks the start or leaves an unhandled rejection (#3).
   `instanceId: process.env.X` without the variable gives `undefined`; the start failed with
   `property-read-only`. Now such a value counts as absent, as if the key was not in `settings.js`:
   the id saved in the storage settings is used, or an id is generated and saved. The save of a generated id
   is awaited (without a time limit, like reading the settings); a failed save logs a warning
   (`runtime.instance-id-save-failed`) and the start continues with the generated id (before, the
   rejected save was unhandled). An explicit `instanceId` of `settings.js` already won over the
   storage and still does. Other keys of `settings.js` keep their behaviour (`settings.set` still
   rejects them)
 - A warning is logged when the `instanceId` was generated and the coordination plugin is not the
   local one: instances that share a storage need the same explicit `instanceId`
   (`coordination.instance-id-generated`). The generated id is not made safe against instances that
   start at the same time (the storages have no compare-and-set; a re-read after the save would not
   help), so only an explicit id is a solution for a cluster
 - Fix (#75): the coordination of instances logs an error of the coordination plugin or of a leadership listener
   with any value - also `undefined` (`reject()` without an argument), `null`, an object without a prototype or a
   value whose `toString` throws - as one warning, instead of throwing while it logs the error. Before, such a
   value made `resign()` and `stop()` of the coordination reject: `RED.stop()` skipped the stop of the flows, the
   answer to the open HTTP requests, the stop of the plugin and the save of the context, the leadership stayed
   taken, and the command line exited with 1 (`Shutdown failed`); a listener that threw such a value skipped the
   next listeners and left the event of the plugin (an instance that took over the leadership did not tell its
   nodes). Now `resign()` and `stop()` never reject because of it, the listeners are all called, and `stop()` always
   ends stopped (`isLeader()` is `false`, a next `start()` starts the plugin again), also when the unsubscribe
   function returned by `onLeaderChange` of the plugin throws (one more `coordination.stop-failed` warning). A value
   that cannot be printed gives the text `(the value cannot be printed)`. The text of every value that was printed
   before, every `Error` included, is the same. After a SIGTERM with a plugin whose `resign()` rejects with
   `undefined` the command line now exits with 0, as with an `Error`. The late release of a coordination plugin
   that started after `startupTimeout` (#71) logs such a rejection as `coordination.resign-failed` /
   `coordination.stop-failed` instead of `runtime.startup-step-late-failed`. The defect was released in
   `5.0.7-actuna.1`. Tests: `coordination/index_spec.js`, `index_spec.js`, `startup-failure_spec.js`
 - Fix (#76): the other extensions of the fork log an error with any value (also `undefined`, `null` or a value
   that cannot be converted to a string) without throwing, and the operation goes on as it does for an `Error`:
   a failed save of the generated `instanceId` with `undefined` or `null` is only a warning and the start goes on
   (before, the start failed); an instance state listener that throws no longer skips the other listeners and the
   `instance:state` event; a held HTTP request that cannot be released no longer leaves the other held requests
   waiting; a `preShutdown` or `preReload` hook that rejects with such a value is logged and the stop or the reload
   goes on at once (before, it waited for `shutdownTimeout` or `preReloadTimeout`); the observer of storage
   (`deploy.reload.watch`) logs such errors of its stop, of a read of storage (the retry is still scheduled), of the
   slots of `deploy.reload.concurrency` and of a whole cycle, without an unhandled rejection (also when the `code`
   of the error in the debug line of a failed comparison of the credentials cannot be read); the `postDeploy` hooks
   log an error whose `message` or `stack` getter throws as `no message` / `no stack`; the drain of the HTTP
   requests (`deploy.drainHttpNodeRequests`) logs a failure whose `code` cannot be read with the code `unknown`
   and goes on (the other requests are answered, the wait ends). In `RED.hooks.trigger` (promise form) a handler
   that rejects with a value that `new Error(value)` cannot convert, that breaks `instanceof` (a Proxy whose
   `getPrototypeOf` throws) or that cannot take the hook id (`err.hook`) now rejects with an `Error` with the message
   `(the value cannot be printed)` and the hook id; before, the promise never settled. A value that converts gives
   the same message as before and an `Error` is passed on as the same object. The texts of the log are the same for
   every value that was printed before (every `Error`), except that a concatenated debug or warning text of an
   object or `Error` without a `message` and with its own `valueOf` is now its string form. The texts come from one
   internal module of the runtime (`printable.js`), not a part of `RED.util`. The state listeners, the `preShutdown`
   hook and the observer of storage were released in `5.0.7-actuna.1` with this defect. Tests: `printable_spec.js`,
   `index_spec.js`, `state_spec.js`, `httpHold_spec.js`, `health_shutdown_spec.js`, `flows/reload_spec.js`,
   `flows/deployHooks_spec.js`, `httpDrain_spec.js`, `util/lib/hooks_spec.js`

Documentation

 - `instanceId` is described in the `coordination` section of the settings template
   (`instanceId: process.env.NODE_RED_INSTANCE_ID`) and in `FORK.md`: a cluster that shares a
   storage needs the same explicit id on all instances (#3)

#### Unreleased: Security and fixes

Security

 - `credentials.digest()` (the digest of the credentials read from storage, #2) wraps the canonical JSON
   and the HMAC in the same `try` as the decryption (SEC-004, #43): an unusual object of a storage plugin (a
   getter or a Proxy that throws) no longer passes its error on - the digest throws a fixed error with the code
   `credentials_digest_failed` and a fixed message, so the reload log (`reload.read-failed`) cannot quote
   a secret from the message of the cause. The rule of #2 does not change: a failed digest of the running
   configuration is "no change" only for the same revision with an unknown digest, otherwise the error goes on
   (as `reload_failed` in the comparison of the cycle and in the reread under the deploy lock, #51). A key that does not decrypt still gives `credentials_load_failed`
 - Prevent crash on websocket auth packet when admin auth is disabled
 - Render the username as text in the editor user menu and login notification
 - Do not return `credentialSecret` and the remote URLs with their credentials in `GET /settings`
   (permission `settings.read`, so also for a read-only role). With an active project the response contained the
   whole project object (`runtime/lib/api/settings.js`): the project's `credentialSecret` (the key to the encrypted
   flow credentials) and `remotes` with `user:password` of the remote URLs. It now contains the same `export()` of
   the project as `GET /projects/:id` (no `credentialSecret`, credentials of the URLs hidden). The code is the same
   in upstream Node-RED, so this is probably a leak inherited from it. A `Project` that is serialized by accident
   (`JSON.stringify`) now gives its `export()` as well (#45)
 - Hide the credentials of a git URL (`https://user:pass@host`, `https://token@host`, `ssh://user:pass@host`)
   as `//***@` in the projects runtime: in the error of a git command (`message`, `stderr`, `stdout`, `value`) and so in
   the API response and the audit log, in the trace log of the command, and in the `event-log` of `exec.run` (command
   line and output; the output is logged by lines, one event per line and stream instead of one per chunk, so a URL
   split between two chunks is recognised; a line longer than 64 KB is masked as a whole first and then cut at a white space at least 4 KB before its end, so a complete URL or secret is never cut). The `remotes[].fetch` / `push` returned by the projects API
   (`GET /projects/:id`, `GET /projects/:id/remotes`) are masked the same way; git, `.git/config` and the
   credentials cache keep the real URL. The scp-like form `git@host:org/repo` and a user of `ssh://git@host`
   are not changed. The user info of a remote that is already in `.git/config` and that the pattern cannot recognise
   (a password with an unescaped `/` or a space) is also hidden literally, only in the text of the operations of
   that project: the secrets are kept per project, replaced at every `git remote -v`, cleared when the remote or the
   project is removed and limited in number; a normal password is never kept, so masking of a text supplied by a
   user (a commit message) cannot reveal it. The text of a rejected git argument no longer contains the argument.
   The code of a git error (`git_auth_failed`, `git_pull_merge_conflict` ...) is decided on the raw output. A remote URL with white space or control
   characters, or with a user info that cannot be told from the path (a password with `/`, `?`, `#`; an `@` in the path)
   is now rejected on clone and on adding a remote (`git_invalid_argument`) - encode such characters in the password
   (`%2F`, `%40`, `%20`). `exec.run` takes an optional fifth argument with literal secrets for the `event-log`. The helper
   is internal (`require("@node-red/util").maskUrlCredentials`, not a member of `util.util`, so not `RED.util`) (#45)

Fixes

 - Fix (#84): a deployment, a reload or a start of the flows that races the stop of the runtime no longer starts
   flows after the stop or leaves flows running. Once the instance is `stopping` or `stopped` (`RED.stop()`,
   `RED.health.shutdown()`, a stop signal - also during the drain of `shutdownTimeout`):
   every deployment (`POST /flows` of every type, v1 and v2, `POST /flow`, `PUT`/`DELETE /flow/:id`, the runtime api
   `flows.setFlows`/`addFlow`/`updateFlow`/`deleteFlow`) and `POST /flows/state` `{state: "start"}` are refused with
   **503** `{code: "runtime_stopping", message: "The runtime is stopping: the change was not applied"}` - nothing is
   read, saved, stopped or started, no preDeploy or postDeploy handler is called; the refusal is audited (no
   warning). It is checked before the deploy lock is waited for and wins over the checks of the revision (409/400),
   a missing flow (404) and the preDeploy hook. Before: a deployment was saved and its flows started after
   `RED.stop()` had resolved, and a partial deployment (`nodes`, `flows`, the single-flow api) left the unchanged
   flows running. A deployment that was already saving when the stop began is saved and not started: the default
   response is 200 `{rev}` as before (postDeploy `start.status: "not_started"`), with `deploy.response: "started"`
   500 `deploy_start_failed` with `errors[].code: "runtime_stopping"`. A start of the flows (first start, project
   switch, reload, a node type registered late) creates and starts no flow while the instance is stopping - one
   info log `The flows are not started: the runtime is stopping`; a start that is running stops at its next step.
   `RED.stop()` resolves only when every flow is stopped: it waits for a stop of the flows in progress and for the
   flows the starts are starting (each at most `nodeCloseTimeout`, then one warning per flow), never for a module
   install or the deploy lock; nodes that a start creates after that limit are closed when that start ends, after
   `RED.stop()` has resolved (also after the contexts are closed). A deployment whose save was in progress when the
   stop began (state `stopping`, the flows still run) stops only what it changes and starts nothing - the other flows
   run until `RED.stop()`; a `full` deployment in that window stops all flows and starts nothing, and the open HTTP
   requests then get 503 after the flows stop, which ends the wait of the shutdown for them early. A reload from storage whose second read ends while the instance is stopping changes nothing and
   is not a failure. A project switch during the stop is not refused; the flows of the switched project start
   after the restart. Nothing changes outside the states `stopping` and `stopped`. Tests: `stop-race_spec.js`,
   `flows/index_spec.js`, `pipeline_spec.js`, `api/flows_spec.js`, `reload_spec.js`, `state_spec.js`,
   `index_spec.js`, `node-red/deploy-stop-race_spec.js`
 - Refresh the user details in the editor after logging in again when the session expired
 - Do not send comms subscriptions before websocket authentication completes
 - Count the failures of the reload from storage (`deploy.reload`) until the whole cycle
   succeeds, not until the first read succeeds: a failure of the second read under the deploy lock
   or of the reload itself (for example `credentials_load_failed`) now exhausts
   `deploy.reload.retry.attempts` - the instance becomes `failed` (`/ready` 503) like after failed
   reads, instead of retrying for ever from attempt 1. With `onExhausted: "keepReady"` the
   `attempts` of the `reload` condition now grow and the periodic error logs appear in this case
   too. The count starts again after a cycle that applied the reload or found the revision
   unchanged; a new notification from storage only shortens the delay of the next retry and no
   longer resets the count, and a new failing reload after a recovery by a local deployment is
   counted as a new series (#17)
 - A successful cycle of the reload from storage (`deploy.reload`) now ends the retry scheduled by
   an earlier failed cycle: before, one useless extra cycle (a read of storage) followed the
   success, both when the retry timer had not fired yet and when it fired while the successful
   cycle was still running (for example during a slow `preReload` drain). A retry that fires
   while a cycle is running no longer starts an immediate extra cycle either: if that cycle
   fails, the next retry follows the backoff of the failure instead of being run at once. A
   notification from storage still starts a cycle at once, as before. The counters of a new
   series after a recovery by a local deployment are reset explicitly (#26)
 - Editor: a deployment that was saved although the flows did not start (500 `deploy_start_failed` or
   `deploy_stop_failed` with a `rev`, `deploy.response: "started"`) now takes over the new revision and
   marks the changes as deployed; it is shown as one red error that lists the causes (a flow that failed
   to start, a start that takes longer than `deploy.startTimeout`, missing node types or modules, safe
   mode, nodes that could not be stopped). Before, the changes stayed undeployed, the next deploy sent
   the old revision and got a 409 conflict, and a late `runtime-deploy` raised a false "flows changed in
   the background" notice (a blocking dialog with `editorTheme.deploy.staleFlows: "reload-only"`) (#22)
 - Polish editor: the "Search for unknown nodes" button of the missing node types notification is translated (#22)
 - Editor: errors of a deploy, of "Restart flows" and of "Start"/"Stop" show a readable message built from
   the `message` of the response (or a generic one) instead of its raw JSON inserted as HTML. This
   also applies in the default mode; only the display changes, not saving or the API. A response that is
   not JSON no longer breaks the error handling of "Start"/"Stop" (#22)
 - `http in`: on close (a redeploy or a stop) the node removes only its own routes. Before, it removed every
   route with its path and method, so closing one node also removed the routes of other nodes registered on the
   same path (including routes added by other modules through `RED.httpNode`), and it skipped the route that
   followed a removed one (`splice` inside `forEach`), which could leave a route of a closed node. The routes
   are now found by the handler of the node and removed from the end of the stack; a missing router is
   tolerated. The key of a raw body route (`skipBodyParsing`) is also kept while another node still uses the
   same method and path (a count per key), instead of being dropped by the first node that closes (#11)
 - Editor: a failed save to the library (library dialog) and a failed export to the library (export
   dialog of the clipboard) inserted the raw body of the server response into the notification as HTML
   (`library.saveFailed`). It now shows the `message` of a JSON response (or a generic text with the HTTP
   status) with `& < > " '` escaped, never the raw body; the message is built by the same function as
   the deploy errors (`RED.deploy.translateErrorResponse`, today `RED.errors.translateResponse`). A request with no HTTP response (status 0)
   shows "no response from server". Polish editor: `library.saveFailed` and `user.notAuthorized` are
   translated (the message no longer mixes languages). No change of the API (#30)
 - Editor: text from a server response and the module name were inserted into notifications (HTML) without
   escaping. They are now escaped (`& < > " '`) in the palette (install, update, remove, enable and disable of
   a module, install from a file, automatic install), in the projects (the unexpected error: `message` and
   `code`; git errors of the remote branches), in the version control (git errors; a failed connection on pull
   shows the `message` of the error instead of "[object Object]"), when a node module fails to load, on import
   and drop errors (the message of a failed import quotes the pasted text) and for groups. The catalog text
   stays HTML. The shared escaping moved from `RED.deploy` to the new `RED.errors` module (`ui/common/errors.js`,
   loaded before the modules that use it); `RED.deploy.formatStartErrors` works as before, the library no
   longer depends on the deploy module. `RED.deploy.translateErrorResponse` was kept as an alias at that time
   and is removed in #37 (use `RED.errors.translateResponse`). No change of the HTTP API (#34)
 - Editor: more places inserted text that is not from the message catalog into HTML without escaping (#37).
   - Escaped: the module name in the confirmations of install, update and remove and in the progress message
     of the automatic install; the remote URL in the dialog of the git authentication; the file name in the
     confirmation of a revert and in the title of the window with the changes of a file; the names of a project,
     a branch, a remote and a key in the confirmations of their removal; the type and the error of a node that
     could not be registered; the module and the version of an upgraded module; the message of an import
     error; the library type of a saved item; the values of the notifications of the runtime (`red.js`,
     `runtime.js`); the conflict hint of the install button and the pending version of a module.
   - Set as text, not parsed as HTML: the version of a module, the name of a catalog and the options of the
     catalog filter of the Install tab (they came from the remote catalog and ran when the tab opened, with no
     click), the name of an item of the library.
   - Only an `http:` or `https:` address of the remote catalog is a link or a "Open node information" button of
     a module (a `javascript:` address was a link); the page opens with `noopener`. New `RED.errors.httpUrl`.
   - **Changes of the editor API for the code that uses it (a node module, a plugin):**
     `RED.utils.sanitize` now also escapes `"` and `'` (it did `& < >` only) and gives an empty text for
     `null`/`undefined` (it threw a TypeError). A module that puts the result into `.text()` or `.attr()` will now
     show `&quot;`/`&#39;` for a quote - it never should have escaped for a plain-text sink. New
     `RED.utils.sanitizeContent` keeps the old `& < >` escaping (for markdown and for text cut by characters).
     New `RED.errors.notifyGitError` (the function of the projects and of the version control, which were two
     copies). `RED.errors.translateEscaped` keeps a number and a boolean as they are.
     **`RED.deploy.translateErrorResponse` is removed** - the replacement is `RED.errors.translateResponse`
     (the same arguments, the same result); it was never in a release. The HTTP API and the settings do not change.
   - Two places that escaped text for a plain-text sink no longer show entities (the tooltip of a tab, the title
     of the edit dialog of a node, which was escaped twice). Enabling or disabling a module showed "Failed to
     install" with an undefined name (or failed with a ReferenceError); it names the action and the module and
     is shown as an error now, and the texts are in the Polish catalog.
 - Editor: a start result (`deploy-start-result`) that was ignored because its revision was not the one of the
   editor is dropped when the editor starts a deployment. Revisions are content hashes, so a result kept
   long before could be applied to a later deployment of the same content that ended in `start_timeout`:
   it closed that error at once and showed the outcome of the earlier start. A result that arrives
   during the request, before its response, is still shown after the response (#31)
 - `http in` with "Do not parse request body" (`skipBodyParsing`): a route with a parameter (`/hook/:id`) or
   addressed in another letter case than its path (`/HOOK`) now gets the raw body as a `Buffer`, as the option
   promises, regardless of `deploy.holdHttpNodeRequests`. Before, the raw body was captured only for the literal
   `METHOD:url` of the node, so such a route got a parsed body (an object or text; for example it broke the
   verification of a signature of the body). Every route of a node with the option now reads the raw body
   itself (before: only with `deploy.holdHttpNodeRequests`), also when a `httpNodeMiddleware` sets
   `req.skipRawBodyParser` (the example of the settings template; the flag means "skip the parser", not "body
   read"). Behaviour change (#16)
 - Fix (#54): saving a library entry waits until the file is written; before, the Admin API answered 204 before
   the write and a failed write was not reported; now a failed write answers 400 `unexpected_error` and the
   editor shows the save failed; a name that does not denote an entry is refused (403); on a very slow disk the
   request waits
 - Fix (#68): a robustness fix for write errors: a failed write of the file content is reported and the
   existing file is kept; a failed save of the settings or the sessions is logged. A failed write of the content
   of a file of the local file storage (for example `ENOSPC` or `EIO`) rejects the save with the error of the
   write; the target is kept and the temporary file of the call (`<file>.$$$`) removed. Before, the save
   resolved and the file was left empty or cut short. Content that is not a string rejects with a `TypeError`.
   This covers the flows, the credentials, the settings, the
   sessions, the library and the files of a project. Unchanged: a failed fsync is only a warning and a failed
   rename keeps the temporary file. A failed save of the settings or the sessions is logged as a warning
   (`Saving the settings failed`, `Saving the sessions failed`) and the operation that asked for it carries on
   as after a saved file: the telemetry choice, the state of the flows (`POST /flows/state`), the node list,
   the installed modules and the expiry of the sessions. A session whose save was rejected is not kept.
   Behaviour change of the Admin API, answers of errors only: `POST /auth/token` with a password answers 500
   `{"error":"server_error","error_description":"unexpected_error"}` without a token when the session cannot
   be created; `POST /auth/revoke` answers 400 `{"error":"unexpected_error"}` when the session cannot be
   removed; `POST /auth/token` with an exchange code answers every error
   with 400 `{"error":"unexpected_error"}`, also a wrong or expired code (before: `{"error":"Error: Invalid
   exchange code"}` or the text of another error); a request with a bearer token answers 401 when the sessions
   cannot be read, and with an expired token also when the save of the sessions fails. The original error is
   only logged. With an external strategy (`adminAuth.type: "strategy"`) a session that cannot be created gives
   the general message `unexpected_error` in the redirect
 - Fix (#67): when `RED.start()` rejects in the command line `red.js`, the process stops the runtime
   (`RED.stop("startup-error")`, log `Stopping Node-RED (startup-error)`) and exits with code 1. Before, the
   process exited with 0, or stayed alive without a listening main server when a handle kept it open (an own
   `health.port`, `logging.*.metrics`, the IPC channel of PM2). This stop does not run the `preShutdown` hook
   and does not wait for `health.unreadyGrace`. It is limited to a fixed 5000 ms; a stop that rejects or
   does not finish in time is logged as `Shutdown failed: …` and the exit code is still 1. A signal during
   this stop exits with 1 at once; a signal that came before the rejection keeps its own stop and exit code.
   Any value of the rejection (`undefined`, `null`, an object whose `stack` getter throws) is logged; before,
   `undefined` and `null` caused an uncaught exception. A rejected `https` settings function now also exits
   with 1 (before: 0). Unchanged: the embedded mode (`RED.start()` rejects with the same error and the
   library never calls `process.exit`), the `/live` probe and errors of the runtime after a successful start
   (flows, deploys, reloads). An error that `red.js` throws while it prepares the main server after a
   successful start (for example `ERR_SOCKET_BAD_PORT` for a port out of range) is now handled as a failed
   start as well: the same stop and exit code 1 (before: logged as `Failed to start server`, then exit 0 or a
   process without a listening server). With a supervisor that restarts on failure, a lasting configuration
   error now gives a restart loop
 - Fix (#73): a stop during the start (`RED.stop()`, `RED.health.shutdown()`, a stop signal in the command
   line) abandons the start as soon as the instance enters `stopping` (also during the drain of
   `shutdownTimeout`, before `RED.stop()` is called). `RED.start()` rejects at once with an error `startup_stopped`
   (fields `step` - the step the start was waiting for, `null` before the first one - and `reason` - the reason of
   the stop) and the runtime logs one warning `The start was stopped (<reason>) before it completed - waiting
   for: <step>`. Before, a step that completed after the stop finished the start in the stopped instance (the
   flows were loaded and started, a coordination plugin that started late kept the leadership, `RED.start()`
   resolved), and a step that never completed left `RED.start()` pending - with `startupTimeout` until the
   limit, whose timer kept an embedding process alive. Now nothing of the start runs after the stop; a step that
   completes later is logged as `The start step <step> completed after the stop - ignored` (info) and what it
   holds is released as after `startupTimeout` (the coordination plugin is resigned and stopped, the own server
   of the probes and the observer of storage are stopped); a step that fails later is one warning. The timer of
   `startupTimeout` is cleared, so the result is never `startup_timeout` after a stop (a limit that fired before
   the stop keeps its result). The instance state goes `starting` -> `stopping` -> `stopped`, never `failed`.
   `RED.start()` called after `RED.stop()` rejects `startup_stopped` with `step: null` and runs no step (before:
   it started the flows in the stopped instance). After `RED.stop()` no new attempt to install a missing module
   (`externalModules.autoInstall`) is planned or made. In the command line a signal during the start no longer
   logs `Failed to start server`; the exit code is unchanged (0). Embedding applications that use the recipe of
   #67 (`RED.start().catch(...)` -> `RED.stop("startup-error")` and exit code 1) should skip `startup_stopped`:
   it is not a failed start, the application is already stopping (see `MIGRACJA.md` §4.5)
 - Tests only, no change of the product: flaky tests fixed. The HTTP tests no longer reach a foreign server
   on the same machine (supertest started the app on all interfaces but connected to `127.0.0.1`; the
   shared helper `nr-test-utils/supertest` listens on `127.0.0.1`), the `tcp request` test server hook calls
   `done` once, the `watch` test ignores a macOS event of the test preparation and the limits of the
   time-dependent hold tests are wider (#19)
 - Tests only, no change of the product: the tests are more resistant to other processes and to a failed check
   (#41). The TCP, UDP and HTTP request tests (`tcp in`, `tcp request`, `udp in`, `udp out`, `http request`) no longer use
   fixed ports (9000-9300, 10234-10664): the test servers listen on a port assigned by the system and a node that needs the port
   in its configuration (and the servers on all interfaces) get a free port found just before it starts
   (the new helper `nr-test-utils/free-port` also checks the loopback, where a foreign server of a dev tool could answer
   instead), so two runs of `npm run mocha:nodes`
   on one machine do not meet on a port; the tests of `inject` and `debug` use `nr-test-utils/supertest`
   (127.0.0.1) instead of `helper.request()`; the helper reports an explicit error for a TLS server, a URL
   given as text and http2; the macOS event of the `watch` test is explained (node-watch replays the
   events of the preparation of the test); the reload test waits for its pollers after a failed check
 - Tests only, no change of the product: more flaky tests fixed (#54). `tcp request` (mode `sit`): the answer is
   compared as a whole, in however many chunks it arrives; `tcp in`: the test client reports a failed connection
   to its own test, and the flow is loaded again on another port when the port found for the node was taken in
   the meantime; `udp in`: the same retry on a taken port; `http in` (413 for a body of 64 MB): a connection
   that the server resets after its answer is accepted when the server wrote exactly one 413 with
   `Connection: close`; `editor-client/nodes`: the clean-up of a test clears the timers of `nodes.js` before it
   removes `RED`; `watch` (polling): the test moves the time of the file on once per poll interval, so it no
   longer depends on the order of the first poll and the write; `reload-shared-flows` (#8): the test runs with
   the drain on and a slow route in the old flows, so a request is always in progress at the stop; the library
   tests no longer wait 50 ms after a save and use a directory of their own for each test
 - CI only, no change of the product: the test workflow uses `actions/checkout` and `actions/setup-node` v7
   (Node 24) and runs every Node version to its own result (`fail-fast: false`); the suite was checked on
   Ubuntu 26.04, which `ubuntu-latest` becomes from 2026-10-19. The release workflow of upstream runs only in
   `node-red/node-red` (#57)
 - Fix (#61): a hook handler that rejects without a value ends the chain with an error. A handler with one
   argument whose promise rejected with a falsy value (`Promise.reject()`, `throw undefined` in an `async`
   function, `null`, `false`, `0`, `-0`, `0n`, `NaN` or `""`) was called again without end in a loop of
   microtasks, so timers, I/O and HTTP stopped and the process hung (an upstream defect of 5.0.7). Now
   `RED.hooks.trigger` rejects (promise form) or calls `done` (callback form) once with an `Error` with the message
   `Hook handler rejected without an error: <value>` (for an empty string the value is `""`, quotes included), the
   handler is called once and the next handlers are not called; the caller follows its existing error path
   (`preShutdown` and `preReload` log the error and go on; `onSend`, `preRoute`, `preDeliver` and `onReceive` report
   it with `node.error` and the message is not delivered; `postDeliver`, `postReceive` and `onComplete` only report
   it with `node.error`, as the message was already delivered; `preInstall`, `postInstall` and `preUninstall` fail
   the install or uninstall; `postUninstall` only logs a warning, as the module was already removed). A rejection
   with a truthy value, a handler with two arguments and a synchronous `return` or `throw` behave as before. A
   handler that was removed while its promise was pending and then rejects without a value now ends the chain too
   (it used to move to the next handler)
 - Fix (#48, part 1 of 2): `http in`: a text body above the maximum string length of Node.js is answered with 413
   `Payload Too Large` and does not reach the flow. A text body is one read as a string: no `Content-Type`,
   `text/*`, XML and the `application/*` types other than `octet-stream`, `cbor` and `x-protobuf`. The answer is
   the one of the size limit of #16, with the CORS headers of `httpNodeCors`, and writes no log line. The limit counts
   bytes, so a multibyte text above it in bytes is answered with 413 too. A binary body read by a node without "Do
   not parse request body" keeps no limit, as before. The JSON and urlencoded parsers get the maximum string length
   as their limit when `apiMaxLength` gives a larger size (by the size rules of `body-parser`); a larger body takes
   their existing error path, and any other `apiMaxLength` is passed to them unchanged. A 413 is no longer written
   to a request that another layer (`httpNodeMiddleware`, the hold or the drain of the requests) already answered.
   The change does not limit the size of the accepted bodies; a limit in front of Node-RED (a proxy) does. No new
   setting
 - Fix (#48): `http in` with "Accept file uploads": a multipart field whose name has a number in brackets above
   100 (for example `a[101]`, also `a[5][101]`) is answered with 413 `Payload Too Large` and does not reach the
   flow, with no log line. It applies on every upload route, also without `httpInMaxBodySize` and without "Max
   body size". Numbers 0 to 100 (`a[100]`) give an array as before; names without such a number (`a[]`,
   `a[101]x`, `a[1e2]`) and the field names of files are unchanged, and so are URL-encoded forms. A form that
   numbers more than 101 rows in its field names now gets 413. In the same way (always), a multipart field whose
   name has more than 8 opening brackets `[` (every `[` counts, also one that is not closed; for example
   `a[b][c][d][e][f][g][h][i][j]`) is answered with 413; a name with at most 8 is accepted as before. Both
   limits check only the names of text fields, not the names of file parts
 - Fix (#63): Editor: a link or a "Review" button from the remote catalog of modules is made only for an absolute
   `http:` or `https:` address (`RED.errors.httpUrl`). A relative address (`docs/x`, `/x`, `?q=1`, `#a`,
   `//example.org/x`) was resolved against the address of the editor and gave a link into the editor itself; now it
   gives no link and no button
 - Fix (#63): Editor: `RED.utils.renderMarkdown` escapes the text (as `RED.utils.sanitize`: `& < > " '`) when the
   markdown library cannot render it; it returned the text as it was, and the callers put it into HTML. A value
   that is not a string is returned unchanged, as before
 - Fix (#63): the install of a module hides the credentials of the install URL (`https://user:password@host/x.tgz`)
   in its log lines: the `trace` line of the npm command, the warnings and infos of the install (also the error
   output of npm) and the `event-log` show the URL as `https://***@host/x.tgz`. The user info, the password and
   their URI-decoded forms (at least 4 characters) are also hidden as literal text, as npm can print them outside
   the URL form; they are passed to `exec.run` as its literal secrets. The same applies to a module name given as a
   URL with credentials, and to the `url`, `module` and `message` of the `nodes.install` audit events. A URL without
   credentials and the bare user of an `ssh` URL are logged as before. The error of a `preInstall`/`postInstall` hook
   is masked the same way, and an npm argument with a credential that a hook adds (`--//registry/:_authToken=…`,
   `_auth=`, `_password=`) shows its value as `***` in the trace, the `event-log` and the warning with the npm output;
   npm gets it unchanged
 - Tests only (#63): the secrets of a project reach `exec.run`, `getRemotes()` hides an old ambiguous remote
   password, a long output line is cut at a white space (`exec.js` comment of the branch that keeps the masked text);
   the drain spec stops its instances per describe and asserts the close of the socket after 503, the project switch
   does not run `preDeploy`/`postDeploy`, a `preDeploy` handler added during a deployment, the child of the library
   working-directory spec has its own timeout; the reload spec asserts the `reload.read-failed` lines, shares one
   helper and compares the reread result; the token exchange logs; a failed shutdown with an unusual value; the
   jQuery stand-in of the editor tests records more HTML sinks; `http in`: one response on a keep-alive connection
   when another layer answered first, the boundary of a text body at the maximum string length without the opt-in,
   and the size limits of the body parsers from a case table shared with the Admin API. Comments only (no change of
   behaviour): `httpDrain.js`, `flows/pipeline.js` (the moment the `preDeploy` handlers are read) and `21-httpin.js`
 - Fix (#63): reload from storage (`deploy.reload.watch: true`, `onExhausted: "keepReady"`): when the comparison of
   the credentials fails in the reread under the deploy lock, the `reload` condition of the instance state reports
   the revision the reread read, not the older one of step 2. A failed read of storage still reports the revision of
   step 2
 - Fix (#63): the exchange of a code for a token (generic auth strategy) answers once: when the answer with the token
   fails after its headers were sent, the error is logged as before and no second answer (400) is attempted
 - Fix (#63): command line `red.js`: when `RED.start()` rejects with a value the log cannot write (a `Symbol`),
   `Failed to start server:` is written once; the value is printed by the console fallback
 - Fix (#63): Admin API: the JSON and urlencoded parsers get the maximum string length of Node.js as their limit
   when `apiMaxLength` gives a larger size (by the size rules of `body-parser`), the same rule as the parsers of
   `http in` since #48; any other `apiMaxLength` is passed to them unchanged, and the default stays 5 MB. A larger
   body takes the existing error path (413). The parsers read the body before authentication, as in upstream
 - Fix (#63): `RED.hooks` (runtime and editor): a handler that throws a falsy value synchronously (`undefined`,
   `null`, `false`, `0`, `-0`, `0n`, `NaN`, `""`) ends the chain with the error of #61 (`Hook handler rejected without an
   error: <value>`); before, depending on the value, the chain went on without the later handlers, stopped without an
   error or ended with `Error("null")`. For `onSend`, `preRoute`, `preDeliver` and `onReceive` the message is then not
   delivered and the node reports the error. A handler step ends once: the first of its outcomes (return value,
   promise outcome, `done`, synchronous throw) counts and a later one is ignored (the runtime logs it at debug level),
   so `trigger` settles once and `done` is called once. The editor copy of `RED.hooks` gets the behaviour of #61 (a
   rejection without a value ends the chain; it called the same handler again without end) and of #76 (a value that
   cannot be printed gives `Error("(the value cannot be printed)")`)
 - Fix (#63): `RED.hooks.add` writes one warning (runtime: `warn` log with the place of the registration; editor:
   `console.warn`) when a handler declares no parameters: such a handler is called with `(payload, done)` and must call
   `done`, otherwise the chain does not end - the behaviour is unchanged, as in upstream. `preDeploy` and `postDeploy`
   handlers are called as `fn(event)` and get no warning
 - Fix (#63): the library list does not show a file whose name ends with `.$$$` (the working file of a write, left
   after a failed rename), and saving a library entry with such a name is refused with 403 `forbidden`; a `flows`
   entry gets `.json` first, as before
 - Fix (#63): `PUT /projects/:id` (the update of a project: description, summary, version, dependencies, the key,
   the files, the git user and remotes) checks every field before it changes anything. A field of a wrong type
   (for example a description that is not a text, dependencies that are not an object of texts, a key that is a
   number or `true`, `resetCredentialSecret` that is not a boolean), a package file whose name does not end with
   `package.json`, a file outside the project or credentials for a remote that does not exist are answered with 400
   `invalid_request` whose message names the field only (never the value); before, some of them answered 200, some
   400 with a JavaScript message or with the value, after a part of the request had been applied (for example the
   key). A failed save of `README.md` or `package.json`, of the settings or of an added or removed remote now answers
   400 `{"code":"unexpected_error","message":"Saving the project failed"}` instead of 200, with a warning in the log
   (the file, `Saving the settings failed`, or the code of the git error); the settings are restored and the project
   is loaded again from disk, so `GET /projects/:id` shows what was saved, no commit is made and the credentials are
   not re-encrypted. The credentials given with a remote whose add failed are not kept in the credentials cache. The
   same request can be sent again. A project without `package.json` keeps its answer. The
   editor sends only valid values; a client that sent other types gets 400 now

Features

 - `http in`: the raw body (`skipBodyParsing`) is now limited, on by default: the limit is `apiMaxLength`
   (5mb by default), the same setting as for the JSON and URL-encoded bodies; a larger body is answered
   with 413 `Payload Too Large` (also without `Content-Length`) and the flow does not run. Before, the raw
   body had no limit. An integration that sends more than 5mb raw gets 413 until the limit is raised
   (`apiMaxLength` or the node option below). The 413 is sent after the authentication and with the CORS
   headers. The rest of a rejected body is read and discarded (up to 64mb), so the client
   receives the 413 instead of a reset connection; a declared `Content-Length` above 64mb gets the 413 and
   `Connection: close` at once (#16)
 - `http in` with "Do not parse request body": `rawBodyCapture` now runs on the httpNode app, behind
   `httpNodeAuth` and the hold of the requests (`deploy.holdHttpNodeRequests`), instead of the top of the
   root app, so a request that the authentication rejects (or the hold keeps) no longer makes the runtime
   buffer its body first. It still runs before `httpNodeMiddleware` and the routes, so they find the raw
   body in `req.body` as before, up to the highest limit of the nodes on the key (upstream had no limit): a
   larger body is answered with 413 (with the CORS headers) at once and nothing else on the route sees it,
   neither a middleware, nor another route, nor a node without the option. Loading the module again on the same
   app (`RED.stop()` and `RED.start()` in one process) replaces the capture instead of adding another. Do not base authorization on
   `httpNodeMiddleware`, or on `RED.httpNode.use(auth)` added after `RED.start()` (embedded mode): the body of a
   skip route is read before them (up to the limit) and above the limit the client gets 413 instead of 401.
   To avoid reading the body of unauthenticated requests use `httpNodeAuth` or the outer application in front
   of `RED.httpNode`. A node without the option on the same path and method as a node with it gets 413 for a body
   larger than that node's limit.
   The 413 carries the CORS headers of the global `httpNodeCors`, also on a foreign route with its own CORS (#16)
 - `http in`: new optional field "Max body size" (`maxBodySize`) replaces the limit for one node, higher or
   lower, for routes that receive large files or images. A number with an optional unit `b`, `kb`, `mb`
   `gb`, `tb` or `pb` (1024 based, for example `50mb`; a number alone is bytes; up to 32 characters). It applies to
   the raw body and, with "Accept file uploads", to the whole body of a multipart request (all files and fields; 413
   above it, at once when `Content-Length` is above the limit, and by the received bytes for a chunked body).
   Without the field an upload stays unlimited, as before. An empty value uses the default; an invalid one
   logs a warning (`httpin.errors.invalid-max-body-size`) and uses the default. An `apiMaxLength` that is not a size
   above 0 logs one warning (`httpin.errors.invalid-api-max-length`) and uses 5mb. No new global setting. The field
   is shown, and validated by the editor, only with one of the two options. English help and the English and
   Polish messages (#16)
 - `http in`: new optional setting `httpInMaxBodySize` (#48, part 2 of 2), a default size limit of the request
   bodies of the POST, PUT, PATCH and DELETE nodes, for example `"50mb"` (the size format of "Max body size"). Off
   by default, the behaviour is unchanged. When set, it is the limit of the raw body (instead of `apiMaxLength`),
   of the whole body of a multipart upload, and of the text and binary bodies of the nodes without options; a
   larger body is answered with 413 `Payload Too Large` (the answer of #16, with the CORS headers of
   `httpNodeCors`, no log line) and the flow does not run. "Max body size" of a node raises or lowers it for that
   node; a raise logs one warning of the node (`httpin.errors.max-body-size-above-default`). With the setting the
   field is shown, and validated, for every node of those methods; GET never uses it. The JSON and urlencoded
   bodies are not limited by it (their limit stays `apiMaxLength`). A value above the maximum string length of
   Node.js applies and logs one warning (`httpin.errors.large-max-body-size-setting`); the same for "Max body size"
   of a node (`httpin.errors.large-max-body-size`), also without the setting. An invalid value (not a size above
   0, or one that cannot be read) is ignored with one warning (`httpin.errors.invalid-max-body-size-setting`) and
   the limits are then the ones without the setting: the raw body keeps `apiMaxLength`, the other bodies and an
   upload without "Max body size" have no limit (fail-open, check the log after a change). The setting is read
   once at start. The warnings about the setting, about "Max body size" of a node and about `apiMaxLength` show the
   value in a reduced form: a text cut to 32 characters with every character other than a letter, a digit, a
   space, `.`, `+` or `-` shown as `?` (a value that cannot be read as `?`), a number as it is, any other value as
   its type. `GET /settings` carries only `httpInMaxBodySizeEnabled: true` when the setting is valid (never its value;
   without it nothing changes). On an upload route a body that is not multipart is not read, as before. The
   limit applies to one request, not to the sum of the bodies received at the same time. Settings template,
   English help, English and Polish messages
 - `http in` with "Accept file uploads" (#48): an upload with a size limit (`httpInMaxBodySize` or "Max body
   size" of the node) accepts at most 1000 parts in one request (fields and files together); a request with more
   is answered with 413 `Payload Too Large`, with no log line, and the flow does not run. The number is fixed and
   does not depend on the size limit. Without both limits the number of parts is not limited, as before. Other
   errors of the multipart parser are answered with 500 and a warning of the node, as before

#### Unreleased: Engine extensions

Features

 - API of the HTTP routes of a node (#11, Z-07, R-53): `node.registerHttpRoute(method, path, ...handlers)` registers a
   route on the app of the nodes (`RED.httpNode`) and returns a frozen handle `{method, path, remove()}`; the runtime
   removes the route when it stops the node (every deployment that stops it, the removal of the node, the stop of the
   flows, `RED.stop`) - at the start of `close`, before the close callbacks, and also for a node that overrides `close`.
   Only the routes of that instance are removed, not the routes of other nodes or of a new instance with the same id;
   `remove()` removes a route earlier. The route is an ordinary route of the app, added at the moment of the call with
   the public `app.route()`, at the same place as `RED.httpNode[method]()` would add it, so the hold of the requests (#8)
   and the drain (#40, with the mark on the handler) work as for any route. Methods `get`, `post`, `put`, `patch`,
   `delete`, `options`, `head`, `all` (any case); the path is a string or a `RegExp`, passed to Express unchanged;
   handlers are functions or arrays of them. An invalid method, path or handler throws a `TypeError` and leaves the app
   unchanged. The API adds no `httpNodeMiddleware`, CORS or body parsing (the node passes them itself); `httpNodeAuth`
   applies. A registration after the node started to close adds no route and logs one warning per node
   (`httpRoutes.after-close`); a failed removal is logged (`httpRoutes.remove-failed`) and the close goes on. No setting:
   without a call nothing changes (`RED.httpNode` is the same object, a node without routes closes as before). The
   router of the app is read only by one adapter for Express 4 and 5 (`routerStack` in `runtime/lib/nodes/httpRoutes.js`).
   The `http in` node registers its routes through the API (one call per node, the same chain of handlers) and no
   longer removes them from the router of the app itself; its HTTP behaviour is unchanged. The `@node-red/nodes` of the
   fork therefore needs a runtime with `node.registerHttpRoute` (both are released together; there is no fallback for an
   older runtime). Tests: `httpRoutes_spec.js`, `Node_spec.js`, `Flow_spec.js`, `21-httpin-routes_spec.js`, `21-httpin_spec.js`
   (unchanged)
 - Hooks of the deploy pipeline `preDeploy` and `postDeploy` (#10, Z-06, R-50), registered **only** with
   `RED.hooks.add("preDeploy.<label>", fn)` / `RED.hooks.add("postDeploy.<label>", fn)` in a plugin or a node; the `hooks`
   setting of `settings.js` (#7) is unchanged and still rejects them (`invalid_hook_setting`). Without a registered handler
   nothing is copied or timed and the pipeline behaves as before. `preDeploy` runs under the deploy lock before anything
   is saved, stopped or changed, with a frozen copy of the resulting configuration (`POST /flows` of every type and
   "Restart flows", `POST /flow`, `PUT` and `DELETE /flow/:id`, `RED.runtime.flows.*`; the deployment type "load" - which ignores the body and
   deploys the content of storage - is validated on that content like "reload", `event.type` is then "load"; the copy has no `credentials` and no
   `value` of `env` entries of type "cred"). An accepted deployment goes on; `false` or an `Error` with `status: 400` answers
   **400 `deploy_rejected`** `{code, message, reason, details?}` (`reason` is the `code` of the error, `details` a plain
   object or array up to 8 KB); any other result of the validator (an exception, `Promise.reject()`, `done("x")`) answers
   **503 `deploy_hook_failed`** with a fixed message (fail-closed, the cause only in the log); no result within
   `deploy.hookTimeout` (default 30000 ms) answers **503 `deploy_hook_timeout`**, and so does a handler whose earlier
   late call still runs (it is not called again until that call ends). A rejection, a failure and a timeout change nothing
   (no save, no `deploying` state, no events, no drain, no credentials change) and do not cancel a pending reload from
   storage. `postDeploy` is called asynchronously after the result, once for every configuration that was saved or
   reloaded (also when the deployment then failed, also for a reload from storage with `source: "storage"`), never for
   one that was not saved, with `start.status` `started | pending | not_started | start_failed | stop_failed | unknown`;
   it never delays a deployment, an error is only logged; at most 10 calls of a handler can be unfinished (the next ones are
   skipped with a warning), so a handler of the form `(event, done)` must call `done`; a returned (not thrown) Error is an
   acceptance in `preDeploy`. The accessor
   `hooks.handlers(id)` (non-enumerable, for the runtime) is new; `trigger` and `invokeStack` are unchanged. The hook is not
   a security boundary (a reload from storage, a project switch, the start and code in the process bypass it)
 - New setting `deploy.hookTimeout` (ms, default 30000; a number > 0 and <= 2147483647, otherwise a warning and the
   default): the limit of the chain of the `preDeploy` hooks (#10)

 - With `deploy.response: "started"` the `start_timeout` entry of `errors[]` has the additive fields `timeout`,
   `phase` (`"modules"` while the modules of the flows are checked, `"flows"` while they start), `startedAt`,
   `elapsed`, `pending` (flows not started yet; for a "flows" or "nodes" deployment only the flows it starts something in) and `current` (only while a flow of `pending` is being started); a `flow_start_failed` entry of a rejected start has
   `flow` when known. No new code - still 500 `deploy_start_failed`; the default mode is unchanged (#22, R-48)
 - When a deployment answered `start_timeout` and the start of the flows ends later, the runtime publishes
   the event `deploy-start-result` to the logged-in editor sessions (`/comms`, not retained) and the editor
   shows "flows started" (closing the earlier start timeout error) or an error with the causes; the result of
   another revision than the one of the editor is ignored, and it goes to every logged-in editor session
   like `runtime-state`. Not emitted for a deployment that answered in time or in the
   default mode (#22, R-48)

Security

 - New setting `httpAdminNodeRoutes: "open" | "authenticated"` (default `"open"`, unchanged).
   With `"authenticated"` and `adminAuth`, admin routes added by nodes and plugins through
   `RED.httpAdmin` without `RED.auth.needsPermission()` require an authenticated user (or
   the default user of `adminAuth.default`); an unknown value is treated as
   `"authenticated"` with a warning; without `adminAuth` the setting has no effect (warning)
 - New node api `RED.auth.publicRoute()` marks an admin route as intentionally public; public
   routes are logged at startup in `"authenticated"` mode. Node authors who need to support
   older versions can use `RED.auth.publicRoute ? RED.auth.publicRoute() : (req,res,next) => next()`.
   The debug node view routes use it
 - In `"authenticated"` mode, `RED.httpAdmin.use()` without a path is skipped for requests
   without authentication (instead of returning 401 for every later admin route, including
   public routes of other modules), and `RED.auth.needsPermission()` counts only when it comes
   before the first handler of a route. The same applies to `RED.httpAdmin.use()` with a path
   that matches every path (such as `""`, `"*"`, `"/*"`, `["/"]` or a regular expression
   matching everything). The guard is a safer default for well-behaved nodes, not a sandbox
 - New setting `telemetry.locked`: with `locked: true` the telemetry state is fixed to
   `telemetry.enabled` (missing means disabled) and cannot be changed by users - the saved user
   choice is ignored but kept, a `telemetryEnabled` value sent to `POST /settings/user` is ignored
   (the other user settings are saved, the audit event has `telemetry: "locked"`), and
   `GET /settings` reports `telemetryLocked: true`. `NODE_RED_DISABLE_TELEMETRY` and
   `--no-telemetry` keep their behaviour and do not imply the lock. In the editor the switch in
   the user settings is disabled, shows the effective value with a note that it was set by the
   administrator, and the consent prompt is not shown

Editor

 - The editor shows its own texts for the errors of the `preDeploy` hook (#10): `deploy_rejected` as "Deployment rejected by
   validation: <message of the validator>" (escaped; `reason` and `details` are not shown), `deploy_hook_timeout` and
   `deploy_hook_failed` as a fixed text (en-US and pl); nothing was saved, so the changes stay marked as changed
 - New setting `editorTheme.deploy.staleFlows: "prompt" | "reload-only"` (default `"prompt"`,
   unchanged). With `"reload-only"` an editor whose flows were changed elsewhere (a deploy that
   gets 409, or a background update notification with another revision) shows a blocking dialog
   whose only action reloads the flows - no review, merge or "Ignore & deploy"; the deploy button
   stays disabled until then and a deploy always carries the flow revision. Changes not deployed
   from that editor are lost. The protection covers the editor only: a client of the Admin API
   can still deploy without the revision unless `deploy.requireRevision` is set - `"reload-only"`
   without it is logged as a warning at startup. An unknown value is treated as `"prompt"` with a
   warning in the browser console
 - When the server rejects a deploy without the flow revision (409 `version_required`, with
   `deploy.requireRevision`), for example after "Ignore & deploy", the editor shows a message
   and the conflict options without "Ignore & deploy" (review, merge, reload the flows) instead
   of opening the conflict dialog again

Fixes

 - A rejected single-flow request (`POST /flow`, `PUT` and `DELETE /flow/:id` with 409, 404, `duplicate_id`,
   `invalid_flow_id` or 400 `global`) no longer passes through the instance state "deploying" and back (#10, U1): the
   revisions are checked and the configuration is built before the state changes, so there are no `instance:state`
   events, no brief 503 of `/ready`, no brief hold of the HTTP requests (#8), and a pending reload from storage is no longer
   cancelled as superseded by a request that deployed nothing. Responses, codes, messages and the audit are unchanged;
   consumers of `instance:state` no longer see such a request (MIGRACJA 4.5)
 - A reload through the Admin API reads storage in a step of its own and loads the credentials (and publishes the runtime
   state) in the next one, after the `preDeploy` hook (#10, D15): a reload that the hook rejects changes nothing. The order
   relative to the state "deploying" and the result are unchanged; `flows.readFlowsFromStorage()` is the composition of
   `readStoredFlows()` and `loadStoredCredentials()`
 - Restarting the flows from the editor no longer fails with a script error when the server
   answers 409; the conflict dialog is shown
 - "Merge" and "Ignore & deploy" in the conflict dialog no longer fail with a script error when
   no background update notification was shown

Admin API

 - New setting `deploy.response: "stopped" | "started"` (default `"stopped"`, unchanged).
   With `"started"` the Admin API answers a deployment (`POST /flows` of every type including
   `reload`, `POST /flow`, `PUT`/`DELETE /flow/:id`) once the new flows have started and the
   `runtime-deploy` event was emitted, so http endpoints of the deployed flows answer straight
   after the response. Errors (the configuration is saved): 500
   `{code: "deploy_start_failed", message, rev, errors: [...]}` with `errors[].code`
   `missing_types`, `missing_modules`, `safe_mode`, `flow_start_failed` or `start_timeout`
   (errors of single node constructors are only logged, as before), and 500
   `{code: "deploy_stop_failed", message, rev}` when stopping the old nodes fails (in the
   default mode such errors are still ignored). Clients should take the new `rev` from
   the error. Internal loads (runtime start, project switch) do not wait. An unknown value
   is logged as a warning and treated as `"stopped"`
 - New setting `deploy.startTimeout` (ms, default not set): with `"started"` a start that takes
   longer returns 500 `deploy_start_failed` with `errors[].code: "start_timeout"`; the flows
   keep starting in the background and the result is logged. The deploy lock is kept until the
   start completes (a warning is logged after 60 s)
 - New setting `deploy.startTimeoutReleasesLock` (default `false`): with `true` and
   `deploy.startTimeout`, the deploy lock is released when the limit has passed (in both
   response modes, with a warning) while the flows are still starting - a following
   deployment may then run concurrently with that start. An invalid value or `true` without
   `deploy.startTimeout` is logged as a warning
 - Error responses `deploy_start_failed`/`deploy_stop_failed` of the Admin API include `rev` and
   `errors` (other errors are unchanged). In
   `deploy_start_failed`/`deploy_stop_failed` of the single-flow API (`POST /flow`,
   `PUT`/`DELETE /flow/:id`) `rev` is the new revision of the flow (as in the v2 response;
   `null` after `DELETE`) and `revAll` the new revision of the whole configuration; on `/flows`
   `rev` stays the revision of the whole configuration
 - Single-flow API (`/flow`): requests without the new fields and without
   `Node-RED-API-Version: v2` behave as before. New:
   - `GET /flow/:id` with v2 returns the flow revision `rev` (sha256 of the tab and its nodes,
     without credentials; for `global` the global configuration nodes and subflows) and the
     header `ETag: "<rev>"`; the revision changes only when that flow changes
   - `PUT /flow/:id` checks an optional `rev` (409 `version_mismatch`, 400 `invalid_revision`
     for a revision that is not a string); with v2 `If-Match` is equivalent to `rev` (both
     given and different: 400 `invalid_revision`) and the response is `{id, rev, revAll}`
   - optional `globalConfigs[]` (add or replace global configuration nodes in the same
     deployment; 400 `duplicate_id` / `invalid_node_type`) and `globalRev` (revision of
     `global`, 409 `version_mismatch`) in `PUT /flow/:id` and `POST /flow`; the existing
     `configs` keeps its meaning (configuration nodes of the flow)
   - `POST /flow` with v2 returns 201 `{id, rev}`; v1 still 200 `{id}`
   - new setting `deploy.putCreatesFlow` (default `false`): `PUT /flow/:id` of a missing flow
     creates it under that id (201 in v2, 200 in v1; `rev: null` = only if it does not exist;
     400 `invalid_flow_id` if the id is used by another node); without it 404 as before
   - `PUT /flow/:id` rejects node ids used in another flow (400 `duplicate_id`; before
     they were accepted and produced duplicate ids)
   - an invalid `Node-RED-API-Version` on `/flow` is treated as v1, as before, with a warning in
     the log (once per value, at most 100 values); `/flows` still returns 400 `invalid_api_version`
   - `DELETE /flow/:id?rev=<rev>` checks the flow revision when given (409 `version_mismatch`)
   - for a flow that does not exist `PUT` (without `deploy.putCreatesFlow`) and `DELETE` return
     404 as before, also when a revision is given (the revision is not checked)
 - New setting `deploy.requireRevision` (default `false`, unchanged): Admin API deployments
   without a revision are rejected with 409 `{code: "version_required", message}` - `POST /flows`
   v2 without `rev` (an empty `rev` counts as missing), every `POST /flows` v1 (the message
   points to the v2 API), `PUT /flow/:id` without the flow `rev` (`rev: null` to create with
   `deploy.putCreatesFlow`), `DELETE /flow/:id` without `?rev=`, `POST /flow` and
   `PUT /flow/:id` with `globalConfigs` but without `globalRev`. A revision of a wrong type returns 400
   `invalid_revision`. `reload` deployments and `POST /flows/state` are exempt. `GET /settings`
   reports `deploy: {requireRevision: true}` for the editor

Fixes

 - A rejected start of the flows after a deployment is logged as an error instead of an
   unhandled promise rejection (the response is unchanged)
 - `POST /flows/state` and project switches now wait for a running deployment (and the other
   way round) instead of running concurrently with it - they share the deploy lock
 - The deploy lock is held until the new flows have started (also when the start fails); the
   Admin API response still returns before the start completes
 - Project operations that change the flow files (branch change, pull, revert, merge, project
   switch and settings) run together with the reload of the flows under the deploy lock
 - A project commit checks whether it completes a merge under the deploy lock; reading a project
   (`GET /projects/:id`) and creating a project from the existing flow files run under the
   deploy lock, so a deployment cannot save the old flow files between the copy and the switch

Runtime

 - Internal deploy pipeline (`runtime/lib/flows/pipeline.js` `deploy(opts)`) and shared deploy
   lock (`runtime/lib/flows/lock.js`) used by every Admin API deployment; `flows.start()` returns
   the start errors (`missing_types`, `missing_modules`, `flow_start_failed`); new internal
   `readFlowsFromStorage()` and `buildAddFlowConfig`/`buildUpdateFlowConfig`/`buildRemoveFlowConfig`.
   No change to the Admin API, events or logs

#### Unreleased: Flow layouts

Developed by Actuna Sp. z o.o. (Wojciech Repiński), with AI-assisted development.
See `design/flow-layout/` for the analysis, documentation and work log.

**Migration note:** when updating an installation that already uses flow layouts, add
`editorTheme: { flowLayout: { enabled: true } }` to `settings.js`. The controls are disabled
by default, and while disabled the users' default layout settings are ignored - flows
without their own `layout` are drawn left-to-right (`LR`) and wires `curved`, even if a
user chose another default before. Flows with their own `layout`, `wireStyle` or `o` are
not affected.

 - Settings: the flow layout controls are enabled with `editorTheme.flowLayout.enabled`
   (default `false`). When disabled the editor shows no layout controls (flow properties,
   node and subflow appearance, user settings, context menu, `core:*-node-ports*` actions)
   and ignores the users' default layout settings; flows that contain `layout`,
   `wireStyle` or `o` are still drawn with them and saved unchanged. The runtime parts
   do not depend on the setting (Z-14)
 - Editor: flows can be drawn top-to-bottom (`layout: "TB"`) or with an automatic,
   mixed layout (`layout: "auto"`) as well as left-to-right; set per flow, per
   subflow, or as the editor default in the user settings
 - Editor: nodes can override their port orientation (`o: "LR"|"TB"`) from the
   appearance tab, the context menu or the new `core:set-selected-node-ports-*` actions
 - Editor: wires are routed between any combination of port directions and around
   the end nodes when going backwards; new right-angle wire style (`wireStyle: "orthogonal"`)
 - Editor: node status is shown to the right of nodes in top-to-bottom layout
 - Editor: flow layout geometry moved to `ui/view-layout.js` (`RED.viewLayout`)
 - Runtime: changes to node port orientation or subflow layout do not restart nodes
   on a modified-nodes deploy
 - Runtime: the single-flow Admin API (`POST /flow`, `GET`/`PUT /flow/:id`) keeps the
   flow `layout` and `wireStyle`
 - Editor: export and deploy store the editor default layout and wire style of flows
   without their own values when they differ from `LR`/`curved` (FL-B-009)
 - Editor: the diff view shows rows for properties added locally or remotely, such as
   `layout`, `wireStyle` and `o` (FL-B-004)
 - Editor: unknown `layout`, `wireStyle` and `o` values are shown in the edit dialogs
   and no longer removed when the dialog is closed (FL-B-005)
 - Editor: importing a flow whose id already exists can replace the existing flow
   (its properties, layout and content) instead of importing a copy; copy remains the
   default and the replacement can be undone (FL-B-010)
 - Editor: an imported subflow matches an identical existing subflow whatever the order
   of its properties, instead of creating a duplicate (FL-B-006)
 - Editor: port label tooltips of top-to-bottom nodes are shown above the input and
   below the outputs instead of at their side (FL-B-007)
 - Editor: the links of a selected top-to-bottom link node to other flows leave from the
   bottom (link out) or top (link in) of the node with horizontal flow labels, instead of
   being drawn rotated with vertical text (FL-B-008)
 - Editor: no console error at startup with `editorTheme.flowLayout.enabled` set - the
   layout settings no longer redraw the view when the user settings are initialised (FL-B-012)
 - Tests: unit tests for the layout geometry, runtime diff and flow API, Playwright
   end-to-end tests including export/import (`npm run test:e2e`)

#### 5.0.7: Maintenance Release

 - Fix incorrect rendering of typedInput with a single type (#5934) @GogoVega
 - Update body-parser (#5935) @knolleary 
 - docs: clarify settings.js nodesDir accepts an array of paths (#5925) @Bryandero98
 - Fix file in completion after filename evaluation error (#5931) @R0CKing666
 - fix(editor): make disabled wires visible in dark theme (#5926) @Bryandero98
 - Migrate to patched JSONata (#5933) @knolleary

#### 5.0.6: Maintenance Release

- Revert @node-rs/bcrypt update due to OS/arch compatibility issues

#### 5.0.5: Maintenance Release

 - Update dependencies (#5916) @knolleary
 - Fix uncaught exception in json node for malformed JSON string with schema + action=str (#5905) @karthikchundi-commits
 - Update jsonata 2.2.2 (#5915) @knolleary
 - Remove broken stars chart (#5900) @hardillb
 - Fix tlsConfigDisableLocalFiles (#5904) @hardillb
 - Ensure multiplayer event properties are valid (#5898) @knolleary
 - Fix group default fill and fill opacity values (#5878) @bonanitech

#### 5.0.4: Maintenance Release

 - Revert JSONata update further due to regression in behaviour

#### 5.0.3: Maintenance Release

 - Revert JSONata update due to regression in behaviour

#### 5.0.2: Maintenance Release

 - Sanitize session messages (#5883) @knolleary
 - fix tests for windows env (#5866) @Steve-Mcl
 - chore: Update jsonata to latest (#5859) @Steve-Mcl
 - added description for one letter attributes (#5853) @gorenje
 - Fix: escape characters in mocha script commands (#5858) @Steve-Mcl

#### 5.0.1: Maintenance Release

 - Update dependencies (#5847) @knolleary
 - Handle unknown node type properties in info properties table (#5846) @knolleary
 - Add a button to ignore the import of unknown types (#5836) @GogoVega
 - Add --watch option to npm run dev (#5843) @knolleary
 - Load images in info popup before positioning (#5845) @knolleary
 - Handle repositioning tooltip when aligned to top (#5844) @knolleary
 - [5839] NR5: info popover does not support node.info() (#5841) @n-lark
 - [5828] Scroll bars don't update properly (#5832) @n-lark
 - [BUGFIX] Fix git ref parsing resulting in broken merge conflicts and commit diffs (#5833) @beasteers
 - [5808] NR5: navigaton elements overlap workspace content at edges (#5827) @n-lark
 - Fix issue with monaco after expanding and collapsing the editor (#5830) @Steve-Mcl
 - [7522] Sync theme preference into the embedded Node-RED editor (#5819) @n-lark
 - [5809] NR5: Scrollbars are not updating when jumping between nodes in the same workspace (#5826) @n-lark
 - [5810] NR5: "0 plugins" in palette manager (#5825) @n-lark
 - Reposition active popups in response to window resize events (#5823) @knolleary
 - Make docs popup styling consistent with info sidebar (#5822) @knolleary
 - Don't throw error looking up locales for themes (#5813) @hardillb
 - german translation for help texts of the link nodes (#5801) @m-schaeffler
 - Add Japanese Translations for v5.0.0 (#5815) @kazuhitoyokoi
 - Fix images in welcome tour for 4.1 (#5814) @kazuhitoyokoi
 - Fix expandOnClick behaviour of treeList (#5821) @knolleary
 - Avoid initialising sidebars with tabs that do not exist yet (#5818) @knolleary
 - Move sidebar resize-handle down one level in z-index (#5817) @knolleary
 - Fix RED.sidebar.containsTab api (#5816) @knolleary
 - Remove dead link in contributing guide (#5797) @knolleary
 - Set minimum node version to 22.9 (#5792) @bonanitech
 - Update default branch references (#5793) @knolleary

#### 5.0.0: Milestone Release

This marks the next major release of Node-RED. The following changes represent
those added since the last beta. Check the beta release details below for the complete
list.

Breaking Changes

 - Node-RED now requires Node 22.9 or later.
 - We recommend Node 24.

Editor

New Features

 - Add support for GH style blockquote alerts (#5733) @Steve-Mcl
 - Add alert types toolbar functionality to markdown editor (#5757) @Steve-Mcl
 - Rework search statusBar (#5744) @knolleary
 - Welcome tour v5 (#5784) @knolleary

Fixes

 - Do not alter button text for active/focus if its the primary button (#5787) @knolleary
 - Align unknown node style (#5785) @knolleary
 - Add missing core actions (#5777) @knolleary
 - Ensure hidden tabs are restored on reload (#5762) @knolleary
 - Do not show context menu if in the middle of another action (#5763) @knolleary
 - Standardize the scrollbar colors (#5750) @bonanitech
 - Ensure quick-add aligns nodes and junctions to the grid (#5759) @knolleary
 - Fix svg tooltip text alignment (#5753) @knolleary
 - Do not adjust focus when navigating search results (#5749) @knolleary
 - [5712] Accessibility - Buttons and links missing accessible names (#5713) @n-lark
 - Fix subflow virtual port halo sizing (#5748) @knolleary
 - Group sidebar tab buttons (#5747) @knolleary
 - Tidy up import error popover (#5745) @knolleary
 - Move notifications bar to below tab bar (#5743) @knolleary
 - Align sidebar toggle actions (#5742) @knolleary
 - Shrink popover height if not sufficient vertical space (#5741) @knolleary
 - Standardize popover colors (#5738) @knolleary
 - Enable badge annotations on groups (#5729) @Steve-Mcl
 - Refactor workspace grid to use single pattern definition (#5735) @Steve-Mcl
 - Overlay status above selection halo (#5736) @knolleary
 - Tidy up popover appearance (#5740) @knolleary
 - Improve view navigator interaction (#5709) @knolleary
 - [5704] UX: Deploy menu dropdown icon appears too inactive (#5711) @n-lark
 - Redraw halo if node status changes (#5708) @knolleary
 - [5702] UX: Sidebar tab buttons do not show focus indicator when clicking on them (#5710) @n-lark
 - [5693 + 5699] Aligning Dark Theme with Light Theme's SCSS Structure + `node.status` fill of blue is shown as red in dark theme (#5694) @n-lark
 - [5696] `editorTheme.header.title`: long values clip without ellipsis, and misalign when `header.url` is set (#5697) @n-lark
 - [5695] Dropping a node over certain buttons in the footer toolbar causes those buttons to execute (NR5) (#5700) @n-lark

Runtime

 - Add support for installing ESM module nodes (#4355) @hlovdal

Nodes

 - Fix error handling for `linkcall` in function node (#5755) @Steve-Mcl
 - Sort node lists alphabetically (#5739) @knolleary

#### 5.0.0-beta.6: Beta Release

Highlights

 - We now bundle `npm` as our own dependency to improve how the Palette Manager uses it
 - Lots of UI fixes from previous beta feedback
 - Incremental accessiblity improvements in the editor - adding aria labels to buttons and images
 - Ability to call Link In nodes directly from a Function node

Editor

 - Ensure png icon is centrally aligned on first layout (#5688) @knolleary
 - Clip user profile image to the round button in the header (#5690) @knolleary
 - [5683] No discernible outline on junctions and node ports in dark mode in NR5 + lighten shade color (#5691) @n-lark
 - Do not show section title if all options are hidden (#5689) @knolleary
 - Remove reveal on hover in search results and provide button (#5684) @knolleary
 - Invert selected tab button border color to improve contrast (#5681) @knolleary
 - [5658] ctrl+space shortcut isn't always firing (#5670) @n-lark
 - [5674] UX: pointer-event deadzone in the tab bar (#5675) @n-lark
 - [5534] UX: create mechanism for themes to provide multiple variants (#5659) @n-lark
 - Remove aria label application from popover (#5654) @knolleary
 - Remove default admin cors rules (#5652) @knolleary
 - [5653] Accessibility — Attributes (#5655) @n-lark
 - Remove SASS variables marked as deprecated (#5642) @bonanitech
 - [5647] Accessibility - Names and labels (#5648) @n-lark
 - [5649] Accessibility - Viewports, language attributes, and tabIndex (#5650) @n-lark
 - [5644] UX: Address dark theme feedback from latest beta release (#5646) @n-lark
 - Tighten select halo margin (#5651) @knolleary
 - Fix multiplayer icon appearance (#5640) @knolleary
 - Remove unslightly gap in the debug sidebar (#5639) @knolleary
 - [5634] Junctions and ports on hover disappear with light theme (#5635) @n-lark
 - [5636] V5, B5 : Sporadic Panel Height Calculations (#5638) @n-lark

Runtime

 - Fix build scripts for windows (#5687) @knolleary
 - Set minimum node.js version to 22.9 (#5678) @knolleary
 - Update to latest npm (#5677) @knolleary
 - Update some dev dependencies to clear audit noise (#5673) @knolleary
 - Introduce eslint (#5671) @knolleary
 - Remove Grunt as the task runner (#5669) @knolleary
 - Use req.hostname in https redirect to ensure proxy trust is maintained (#5666) @knolleary
 - Sync master updates to dev (#5664) @knolleary
 - Use a token exchange pattern for OAuth logins (#5657) @knolleary

Nodes

 - Allow TLS SNI Server name to be set in the http-request node (#5667) @hardillb
 - Defining utility functions for re-use in a function node (#5494) @Steve-Mcl
 - Only connect websocket client if need to (#5533) @dceejay


#### 5.0.0-beta.5: Beta Release

 - [5517] UX: Create default dark theme (#5625) @n-lark
 - [5629] UX: Deploy menu: Restart Flows should not be faded (#5632) @n-lark
 - Pull master changes to dev (#5631) @knolleary
 - [5532] UX: Improve accessibility of default theme - colour palette (#5613) @n-lark
 - [5616] Add back in expand/collapse tabs for sidenavs (#5626) @n-lark
 - [5572] UX: Handle long instance title text (#5628) @n-lark
 - [5621] UX: Fix styling of dragging sidebar panels (#5627) @n-lark
 - Rework selected/hightlighted node appearance (#5623) @knolleary
 - Ensure active tab is fully visible (#5624) @knolleary
 - Rework sidebars to be draggable (#5618) @knolleary
 - Make scrollbar hitbox larger (#5576) @knolleary
 - [5617] Deploy Menu Redesign (#5619) @n-lark
 - [5603] UX: Header buttons shown whilst editor loading (#5606) @n-lark
 - [5602] UX: Unexpected tab border showing (#5607) @n-lark
 - [5374] UX: replace touch radial menu with standard context menu (#5614) @n-lark
 - [3431] feature: Store sidebar width between editor sessions (#5605) @n-lark
 - Ensure edit dialog fills the tray (#5600) @knolleary
 - Sync 4.1.8 to dev branch (#5587) @knolleary

#### 5.0.0-beta.4: Beta Release

 - Various UX tweaks and tidy ups
 - Renable click to close for edit dialog (#5567) @knolleary
 - Improve the `user-select` CSS code usage (#5565) @bonanitech
 - Tidy up modal shade appearance (#5566) @knolleary
 - Scale highlight based on workspace zoom (#5563) @knolleary
 - Ensure disabled tab has fully dashed border (#5564) @knolleary
 - Add error handling for markdown parser (#5560) @knolleary
 - Update reveal node styling (#5562) @knolleary
 - Minor change to treeList select/expand behaviour (#5556) @knolleary
 - Handle shift-scroll more robustly (#5559) @knolleary
 - Remove obsolete vendor-prefixed CSS properties (#5554) @bonanitech
 - Include sidebar width in position calculation for reveal function (#5555) @knolleary
 - [5377] UX: Ensure menus handle vertical overflow (#5448) @n-lark
 - Account for sidebar width when calculating zoom-to-fit scale (#5551) @knolleary
 - Fix fade effect for tab labels that overflow (#5552) @bonanitech
 - Better touch handling for submenus (#5550) @knolleary
 - Improve workspace footer handling of smaller screen widths (#5549) @knolleary
 - [5540] UX: handle node-red-dashboard css poisoning (#5548) @n-lark
 - [5522] UX: vertical scrollbar should not overlap subflow toolbar (#5537) @n-lark
 - [5523] UX: Cursor events in workspace get interrupted when over status/scroll bars (#5539) @n-lark
 - [5521] UX: Selecting non-flow object in Explorer causes Info to go blank (#5538) @n-lark
 - [5525] UX: Misaligned first tab (#5536) @n-lark
 - Sync 4.1.7 to dev branch (#5531) @knolleary

#### 5.0.0-beta.3: Beta Release

 - UX updates for beta 3 (#5498) @knolleary
 - Update Monaco to latest (0.55.1) (#5508) @Steve-Mcl
 - Move location of new creds files to be next to flows (if they don't exist already in userdir) (#4951) @dceejay

#### 5.0.0-beta.2: Beta Release

Editor

 - UX updates for next beta (#5444) @knolleary

Nodes

 - Add pause button to debug sidebar (#5390) @dceejay
 - Add burst mode to delay node (#5391) @dceejay
 - Add TLS certs/keys from Env Vars (#5376) @hardillb

#### 5.0.0-beta.1: Beta Release

Editor

 - Allow sidebar to be split into two panels (#5378) @knolleary

#### 5.0.0-beta.0: Beta Release

Editor

 - Update Sidebar UX (#5318) @knolleary
 - Workspace pan/zoom updates (#5312) @knolleary
 - Fix panning workspace on touchscreens (#5371) @knolleary
 - Update tour for 5-beta (#5370) @knolleary

Runtime

 - Prep dev branch for beta releases (#5367) @knolleary

Nodes

 - Add ability to use pfx or p12 file for TLS connection settings option (#4907) @dceejay

#### 4.1.11: Maintenance Release

 - Add styles to prevent controls wrapping in find bar (#5779) @Steve-Mcl
 - Update mermaid in dev dependencies (#5775) @knolleary
 - Update dependencies (#5772) @knolleary
 - Allow theme plugin to override node categories (#5770) @knolleary
 - Add description tooltips to palette categories (#5769) @knolleary
 - Fix box-shadow property value (#5764) @bonanitech
 - Typo fixes (#5767) @bonanitech
 - Sanitize all args passed to projects/git api (#5768) @knolleary
 - Ensure subsequent calls to the node editor can open (#5734) @Steve-Mcl
 - Remove debug console.log from externalModules (#5737) @Autre31415

#### 4.1.10: Maintenance Release

 - Ensure project files are inside project root path (#5724) @knolleary
 - Fix module name validation for uninstall and tgz install (#5722) @knolleary

#### 4.1.9: Maintenance Release

 - Update "use-tls" translations to indicate that a custom cert is used (#5685) @tobias47n9e
 - Indicate that "use-tls" label is using a custom config (#5665) @tobias47n9e
 - Bump dependencies for 4.1.9 release (#5663) @knolleary
 - Bundle npm to enable cross-platform module management (#5662) @knolleary
 - Replace uuid library with native function crypto.randomUUID (#5660) @hlovdal
 - Ensure tcp-request doesn't reuse uncloned msg objects (#5612) @hardillb
 - Ensure custom subflow colors override theme overrides (#5599) @knolleary
 - Handle invalid theme regex (#5598) @knolleary
 - Allow a nodes defaults to be overridden by settings.js file (#5591) @dceejay
 - Fix reinitializing server with custom node (#5596) @tobias47n9e
 - Update config sidebar id handling (#5597) @knolleary
 
#### 4.1.8: Maintenance Release

 - Add badges to func node tabs with code in (#5585) @knolleary
 - Fix typo in French link node description (#5530) @LPe7
 - Encode branch name in delete request (#5584) @knolleary
 - Introduce `show-first-tab` and `show-last-tab` actions (#5583) @GogoVega
 - Fix "connected to ..." log string in tcp in/out nodes using TLS (#5484) @marcows
 - TreeList: Fix arrow navigation through filtered TreeList (#5431) @piotrbogun
 - Update tar dependency (#5582) @knolleary
 - Allow Node-RED section of help sidebar to be hidden (#5581) @knolleary
 - Allow theme plugin to override settings and add menu options (#5580) @knolleary

#### 4.1.7: Maintenance Release

 - Do not block touch events on ports (#5527) @knolleary
 - Allow palette.categories to be set via theme plugin (#5526) @knolleary
 - Bump i18next version (#5519) @knolleary
 - Suppress i18n notice in frontend (#5528) @knolleary
 - Set showSupportNotice option on i18n (#5520) @knolleary
 - Do not cache subflow colors as each subflow can have its own (#5518) @knolleary
 - Update tar/multer deps (#5515) @knolleary
 - Remove IE7 CSS hacks (#5511) @bonanitech
 
#### 4.1.6: Maintenance Release

 - Allow palette.theme to be set via theme plugin and include icons (#5500) @knolleary
 - Ensure config sidebar tooltip handles html content (#5501) @knolleary
 - Allow node-red integrator access to available updates (#5499) @Steve-Mcl
 - Add frontend pre and post debug message hooks (#5495) @Steve-Mcl
 - Fix: allow middle-click panning over links and ports (#5496) @lklivingstone
 - Support ctrl key to select configuration nodes (#5486) @kazuhitoyokoi
 - Add § as shortcut meta-key (#5482) @gorenje
 - Update dependencies (#5502) @knolleary

#### 4.1.5: Maintenance Release

 - chore: bump tar to 7.5.7 (#5472) @bryopsida
 - Update node-red-admin dependency @knolleary

#### 4.1.4: Maintenance Release

 - Update tar dependency @knolleary
 - Revert overflow fix in editableList (#5467) @knolleary
 - registry: fix importModule base dir for exports subpaths (#5465) @yuan-cloud
 - fix: prevent race condition in localfilesystem context store during shutdown (#5462) @Dennis-SEG
 - fix: prevent double resolve in node close callback (#5461) @Dennis-SEG
 - fix: prevent incorrect array modification in delay node (#5457) @Dennis-SEG
 - fix: prevent uncaught exceptions in core node event handlers (#5438) @Dennis-SEG

#### 4.1.3: Maintenance Release

Editor

 - 5343/Editor/Bug: Node help tab resets focus when arrow keys are used to switch between nodes (#5406) @piotrbogun
 - Ensure quick-add filter is applied properly when retriggering add (#5427) @knolleary
 - TreeList: Fix widget treeList keyboard navigation scroll behavior (#5421) @piotrbogun
 - Editor: Flow & subflow names are changed to all lowercase in search dialog #5348 (#5401) @n-lark
 - Allow actions show-next-tab and previous to loop (#5355) @GogoVega
 - 5404/Editor/Bug: Junction error in Quick Add dialog (#5407) @piotrbogun
 - Add tooltip to delete button in node property UI (#5410) @kazuhitoyokoi
 - Fix invalid node size in quick add dialog (#5403) @kazuhitoyokoi
 - Expand folder to avoid error in library (#5399) @kazuhitoyokoi
 - Stricter validator for flow file name in project feature (#5398) @kazuhitoyokoi
 - Fix size and scrolling in Git config UI (#5396) @kazuhitoyokoi
 - Reveal node in search results via mouseover (#5368) @gorenje

Runtime

 - Add package-lock.json for reproducible dependency chains (#5426) @dimitrieh
 - Readme markdown refactor for legibility in IDE's (#5423) @dimitrieh
 - Update body-parser (#5418) @knolleary

Nodes

 - fix(http-request): prevent uncaught exceptions in async hooks (#5392) @Dennis-SEG
 - Fix flushing when in variable delay mode (#5382) @dceejay
 - File node TypedInput width fix (#5425) @knolleary
 - Use TextDecoder() to decode UTF-8 characters (#5416) @kazuhitoyokoi
 - Support source information in complete node (#5414) @kazuhitoyokoi
 - Fix status node to retrieve status from all nodes (#5412) @kazuhitoyokoi
 - Decrement count of http requests after error (#5409) @kazuhitoyokoi
 - Fix debug tab to copy displayed value (#5400) @kazuhitoyokoi

#### 4.1.2: Maintenance Release

Editor

 - Fix invalid `dirty` state during redo after deployment (#5352) @GogoVega
 - Fix up port event cancelling on node-select (#5338) @knolleary
 - Add selection-to-subflow context menu item (#5337) @knolleary
 - Show subflow input label on virtual port (#5325) @knolleary
 - Clear suggestions on node/port mouse down (#5323) @knolleary
 - Fix lock icon for read-only user (#5336) @knolleary
 - Fix `RED.comms.subscribe` callback on error (#5313) @GogoVega

Runtime

 - ci: add files generated by npm test to .gitignore (#5230) @bryopsida
 - Handle plugin name in `plugins.getConfig` (#5276) @GogoVega
 - Update express version to 4.22.1 (#5365) @hardillb
 - Improved readme (#5340) @dimitrieh
 - Fix race condition in projects initialization by returning gitTools.init() promise (#5315) @stoprocent

#### 4.1.1: Maintenance Release

Editor

 - Filter suggestions to ensure only enabled set are shown (#5307) @GogoVega
 - Show all catalog items if small enough and no search time provided (#5309) @knolleary
 - Force a redraw after clearing suggested flow on mouse down (#5306) @knolleary
 - i18n(NodeRed) update ES translation files to latest code base (#5299) @joebordes
 - Filter suggestions to ensure only known types are shown (#5301) @knolleary
 - Use the action label if provided (#5302) @GogoVega
 - Handle subflow virtual port nodes when generating quick-add context (#5296) @knolleary
 - Prevents label from taking up all the space for env autocomplete (#5293) @GogoVega
 - Fix env autocomplete result if searchKey starts with `${` (#5292) @GogoVega
 - Fix UI lock-up when typed arrays are expanded in debug window (#5290) @Steve-Mcl
 - Notify installed plugins from the Palette Manager (#5277) @GogoVega
 - Fix uncaught Monaco error (#5266) @Steve-Mcl
 - Add 'url' module to default server-side types in Monaco editor (#5265) @Steve-Mcl
 - Catch errors from RED.comms.subscribe callback (#5263) @hardillb
 - Fix node documentation icon for long catalog loading (#5237) @GogoVega
 - Add tooltip for event log view (#5239) @kazuhitoyokoi
 - Fix undo node output changes inside a Subflow (#5278) @GogoVega

Runtime

 - Ensure flow property is set on sf instance nodes so NR_SUBFLOW_PATH c… (#5297) @knolleary
 - Ignore disabled nodes when checking for dependency modules (#5295) @knolleary
 - Update node-red-admin version (#5294) @knolleary
 - Fix config node resolution in packaged subflow within subflow (#5281) @olivierpelet
 - Remove empty if block (#5273) @bonanitech
 - docs: add security escalation policy (#5269) @UlisesGascon
 - Simplify error logging when issue in settings file (#5310) @knolleary

Nodes

 - Inject: Fix jsonata error reporting in Inject node (#5298) @knolleary
 - Range: Fix rounding errors for range node when using float inputs and intege… (#5257) @dceejay
 - HTTP Request: Show requesting status correctly in http request node when multiple processes are working (#5241) @kazuhitoyokoi
 - Split: Speed up split node (#5252) @hardillb
 - HTTP: Do not assume rawBody middleware is last in stack when moving it (#5300) @knolleary

#### 4.1.0: Milestone Release

 - Fix: multipart form data upload issue (#5228) @debadutta98
 - Update help document of filter node (#5210) @kazuhitoyokoi
 - Fix inject node validation to support binary and hexadecimal numbers (#5212) @ZJvandeWeg
 - Do not select a nearest node if move is active (#5199) @GogoVega

#### 4.1.0-beta.2: Beta Release

Editor

 - feat: tray's primary button function will no longer run when clicking anywhere in #red-ui-editor-shade (#5122) @AllanOricil
 - Truncate topic of debug message and add tooltip (#5168) @GogoVega
 - Add event-log widget to status bar (#5181) @knolleary
 - Add `splice` property to nodes:add event context (#5195) @knolleary
 - Add support for plugin sources of autoComplete fields (#5194) @knolleary
 - setSuggestedFlow api improvements (#5180) @knolleary
 - Do not update suggestion whilst typeSearch hiding (#5193) @knolleary
 - Update jquery (#5192) @knolleary
 - Hide event log status widget by default (#5191) @knolleary
 - Swap manage/install-all buttons in dependency notification (#5189) @knolleary
 - Follow-up tweaks to HTTP In skip body parser (#5188) @knolleary
 - Fixes infotip handling of cursor keys and updates english tip (#5187) @knolleary
 - Add Japanese translations for 4.1.0-beta.1 (#5173) @kazuhitoyokoi
 - Do not use css display when counting filtered palette nodes (#5178) @knolleary
 - Fix `pending_version` not set after module update (#5169) @GogoVega

Runtime

 - Prevent library leaking full local paths (#5186) @hardillb

Nodes

 - HTTP In: feat: Add an option to the HTTP In to include the raw body. (#5037) @debadutta98
 - HTTP Request: Allow limited Strings for msg.rejectUnauthorized (#5172) @hardillb


#### 4.1.0-beta.1: Beta Release

Editor

 - Add update notification (#5117) @knolleary
 - Add a node annotation if the info property is set (#4955) @knolleary
 - Add node suggestion api to editor and apply to typeSearch (#5135) @knolleary
 - Node filter support for typedInput's builtin node (#5154) @GogoVega
 - Import `got` module only once when sending metrics (#5152) @GogoVega
 - Trigger button action of the selected nodes with new Hotkey (#4924) @GogoVega
 - Handle deleting of subflow context entries (#5071) @knolleary
 - Add the `changed` badge to the config node (#5062) @GogoVega
 - Default Palette Search: Sort by Downloads (#5108) @joepavitt
 - Show deprecated message if module flagged (#5134) @knolleary
 - Add link icon to node docs and warn for major update (#5143) @GogoVega
 - Support for a module with nodes and plugins in the palette (#4945) @GogoVega
 - Include module list in global-config node when importing/exporting flows (#4599) @knolleary
 - Add `Install all` button to the module list feature (#5123) @GogoVega
 - Fix node tab filtering (#5119) @knolleary
 - Cleanup global Palette Manager variables (#4958) @GogoVega
 - Add a new `update available` widget to statusBar (#4948) @knolleary
 - Add a queue while installing or removing a module from the Palette Manager (#4937) @GogoVega
 - Ignore state of disabled nodes/flows during deployment (#5054) @GogoVega
 - Exclude internal properties from node definition (#5144) @GogoVega
 - Refresh config node sidebar when changing lock state of a flow (#5072) @knolleary
 - Add a border to better distinguish typedInput type/option dropdowns (#5078) @knolleary
 - Fix undo of subflow color change not applying to instances (#5012) @GogoVega
 - Properly handle scale factor in getLinksAtPoint for firefox (#5087) @knolleary
 - Update markdown drop-target appearance (#5059) @knolleary
 - Support for disabled flows in Sidebar Config (#5061) @GogoVega
 - Support text drag & drop into markdown editor (#5056) @gorenje
 - Truncate long messages from the Debug Sidebar (#4944) @GogoVega
 - Handle link nodes with show/hide label action (#5106) @knolleary
 - Update the Node-RED logo to use the hex variant (#5103) @joepavitt
 - Add the vertical marker to the palette hand (#4954) @GogoVega
 - Monaco Latest (0.52.0) (#4930) @Steve-Mcl
 - Updates monaco to 0.52.0 for action widget sizing fix (#5110) @Steve-Mcl
 - Bump Multer to 2.0.1 (#5151) @hardillb
 - Upgrade multer to 2.0.0 (#5148) @hardillb
 - Update dompurify (#5120) @knolleary
 - Colourise the Node-RED logs (#5109) @hardillb
 - Only apply colours for non-default log lines (#5129) @knolleary
 - feat: import default export if plugin is a transpiled es module (#5137) @dschmidt
 - Add an additional git_auth_failed condition (#5145) @sonnyp
 - Fix Sass deprecation warnings (#4922) @bonanitech
 - chore(editor)!: remove Internet Explorer polyfill (#5070) @Rotzbua
 - Remove Internet Explorer CSS hacks (#5142) @bonanitech

Runtime

 - fix: set label in themeSettings.deployButton despite type attribute (#5053) @matiseni51
 - fix(html): correct buggy html (#4768) @Rotzbua
 - Update dev (#4836) @knolleary
 - Update dependencies (#5107) @knolleary
 - Bump i18next to 24.x and auto-migrate message catalog format (#5088) @knolleary
 - chore(editor): update `DOMPurify` flag (#5073) @Rotzbua
 - Add .editorconfig to .gitignore (#5060) @gorenje

Nodes

 - Complete/Status: Fix complete node to not feedback immediately connected nodes (#5114) @dceejay
 - Function: Add URL/URLSearchParams to Function sandbox (#5159) @knolleary
 - Function: Add support for node: prefixed modules in function node (#5067) @knolleary
 - Function: Add globalFunctionTimeout (#4985) @vasuvanka
 - Exec: Make encoding handling consistent between stdout and err (#5158) @knolleary
 - Split: Let split node send original msg to complete node (#5113) @dceejay
 - Split: Rename Split The field (#5130) @dceejay
 - MQTT: Ensure generated mqtt clientId uses only valid chars (#5156) @knolleary
 - HTTP Request: Fix the capitisation for ALPN settings in http-request (#5105) @hardillb
 - HTTP Request: (docs) Recommend HTTPS over HTTP (#5141) @ZJvandeWeg
 - HTTP Request: Include URL query params in HTTP Digest (#5166) @hardillb
 - Catch: Add code to error object sent by Catch node (#5081) @knolleary
 - Debug: Improve debug display of error objects (#5079) @knolleary

#### 4.0.9: Maintenance Release

 Editor
 
 - Add details for the dynamic subscription to match the English docs (#5050) @aikitori
 - Fix tooltip snapping based on `typedInput` type (#5051) @GogoVega
 - Prevent symbol usage warning in monaco (#5049) @Steve-Mcl
 - Show subflow flow context under node section of sidebar (#5025) @knolleary
 - feat: Add custom label for default deploy button in settings.editorTheme (#5030) @matiseni51
 - Handle long auto-complete suggests (#5042) @knolleary
 - Handle undefined username when generating user icon (#5043) @knolleary
 - Handle dragging node into group and splicing link at same time (#5027) @knolleary
 - Remember context sidebar tree state when refreshing (#5021) @knolleary
 - Update sf instance env vars when removed from template (#5023) @knolleary
 - Do not select group when triggering quick-add within it (#5022) @knolleary
 - Fix library icon handling within library browser component (#5017) @knolleary
 
Runtime
 - Allow env var access to context (#5016) @knolleary
 - fix debug status reporting if null (#5018) @dceejay
 - Fix grunt dev via better ndoemon ignore rules (#5015) @knolleary
 - Fix typo in CHANGELOG (4.0.7-->4.0.8) (#5007) @natcl

Nodes
 - Switch: Avoid exceeding call stack when draining message group in Switch (#5014) @knolleary

#### 4.0.8: Maintenance Release

Editor

 - Fix config node sort order when importing (#5000) @knolleary

#### 4.0.7: Maintenance Release

Editor

 - Fix def can be undefined if the type is missing (#4997) @GogoVega
 - Fix the user list of nested config node (#4995) @GogoVega
 - Support custom login message and button (#4993) @knolleary

#### 4.0.6: Maintenance Release

Editor

 - Roll up various fixes on config node change history (#4975) @knolleary
 - Add quotes when installing local tgz to fix spacing in the file path (#4949) @AGhorab-upland
 - Validate json dropped into editor to avoid unhelpful error messages (#4964) @knolleary
 - Fix junction insert position via context menu (#4974) @knolleary
 - Apply zoom scale when calculating annotation positions (#4981) @knolleary
 - Handle the import of an incomplete Subflow (#4811) @GogoVega
 - Fix updating the Subflow name during a copy (#4809) @GogoVega
 - Rename variable to avoid confusion in view.js (#4963) @knolleary
 - Change groups.length to groups.size (#4959) @hungtcs
 - Remove disabled node types from QuickAddDialog list (#4946) @GogoVega
 - Fix `setModulePendingUpdated` with plugins (#4939) @GogoVega
 - Missing getSubscriptions in the docs while its implemented (#4934) @ersinpw
 - Apply `envVarExcludes` setting to `util.getSetting` into the function node (#4925) @GogoVega
 - Fix `envVar` editable list should be sortable (#4932) @GogoVega
 - Improve the node name auto-generated with the first available number (#4912) @GogoVega

Runtime

 - Get the env config node from the parent subflow (#4960) @GogoVega
 - Update dependencies (#4987) @knolleary

Nodes

 - Performance : make reading single buffer / string file faster by not re-allocating and handling huge buffers (#4980) @Fadoli
 - Make delay node rate limit reset consistent - not send on reset. (#4940) @dceejay
 - Fix trigger node date handling for latest time type input (#4915) @dceejay
 - Fix delay node not dropping when nodeMessageBufferMaxLength is set (#4973)
 - Ensure node.sep is honoured when generating CSV (#4982) @knolleary

#### 4.0.5: Maintenance Release

Editor

 - Refix link call node can call out of a subflow (#4908) @GogoVega

#### 4.0.4: Maintenance Release

Editor

 - Fix `link call` node can call out of a subflow (#4892) @GogoVega
 - Fix wrong unlock state when event is triggered after deployment (#4889) @GogoVega
 - i18n(App) update with latest language file changes (#4903) @joebordes
 - fix typo: depreciated (#4895) @dxdc

Runtime

 - Update dev dependencies (#4893) @knolleary

Nodes
 
 - MQTT: Allow msg.userProperties to have number values (#4900) @hardillb

#### 4.0.3: Maintenance Release

Editor

 - Refresh page title after changing tab name (#4850) @kazuhitoyokoi
 - Add Japanese translations for v4.0.2 (again) (#4853) @kazuhitoyokoi
 - Stay in quick-add mode following context menu insert (#4883) @knolleary
 - Do not include Junction type in quick-add for virtual links (#4879) @knolleary
 - Multiplayer cursor tracking (#4845) @knolleary
 - Hide add-flow options when disabled via editorTheme (#4869) @knolleary
 - Fix env-var config select when multiple defined (#4872) @knolleary
 - Fix subflow outbound-link filter (#4857) @GogoVega
 - Add French translations for v4.0.2 (#4856) @GogoVega
 - Fix moving link wires (#4851) @knolleary
 - Adjust type search dialog position to prevent x-overflow (#4844) @Steve-Mcl
 - fix: modulesInUse might be undefined (#4838) @lorenz-maurer
 - Add Japanese translations for v4.0.2 (#4849) @kazuhitoyokoi
 - Fix menu to enable/disable selection when it's a group (#4828) @GogoVega

Runtime

 - Update dependencies (#4874) @knolleary
 - GitHub: Add citation file to enable "Cite this repository" feature (#4861) @lobis
 - Remove use of util.log (#4875) @knolleary

Nodes

 - Fix invalid property error in range node example (#4855)
 - Fix typo in flow example name (#4854) @kazuhitoyokoi
 - Move SNI, ALPN and Verify Server cert out of check (#4882) @hardillb
 - Set status of mqtt nodes to "disconnected" when deregistered from broker (#4878) @Steve-Mcl
 - MQTT: Ensure will payload is a string (#4873) @knolleary
 - Let batch node terminate "early" if msg.parts set to end of sequence (#4829) @dceejay
 - Fix unintentional Capitalisation in Split node name (#4835) @dceejay

#### 4.0.2: Maintenance Release

Editor

 - Use a more subtle border on the header (#4818) @bonanitech
 - Improve the editor's French translations (#4824) @GogoVega
 - Clean up orphaned editors (#4821) @Steve-Mcl
 - Fix node validation if the property is not required (#4812) @GogoVega
 - Ensure mermaid.min.js is cached properly between loads of the editor (#4817) @knolleary

Runtime

 - Allow auth cookie name to be customised (#4815) @knolleary
 - Guard against undefined sessions in multiplayer (#4816) @knolleary

#### 4.0.1: Maintenance Release

Editor

 - Ensure subflow instance credential property values are extracted (#4802) @knolleary
 - Use `_ADD_` value for both `add new...` and `none` options (#4800) @GogoVega
 - Fix the config node select value assignment (#4788) @GogoVega
 - Add tooltip for number of subflow instance on info tab (#4786) @kazuhitoyokoi
 - Add Japanese translations for v4.0.0 (#4785) @kazuhitoyokoi

Runtime

 - Ensure group nodes are properly exported in /flow api (#4803) @knolleary

 Nodes

 - Joins: make using msg.parts optional in join node (#4796) @dceejay
 - HTTP Request: UI proxy should setup agents for both http_proxy and https_proxy (#4794) @Steve-Mcl
 - HTTP Request: Remove default user agent (#4791) @Steve-Mcl

#### 4.0.0: Milestone Release

This marks the next major release of Node-RED. The following changes represent
those added since the last beta. Check the beta release details below for the complete
list.

Breaking Changes

 - Node-RED now requires Node 18.x or later. At the time of release, we recommend
   using Node 20.

Editor

 - Add `httpStaticCors` (#4761) @knolleary
 - Update dependencies (#4763) @knolleary
 - Sync master to dev (#4756) @knolleary
 - Add tooltip and message validation to `typedInput` (#4747) @GogoVega
 - Replace bcrypt with @node-rs/bcrypt (#4744) @knolleary
 - Export Nodes dialog refinement (#4746) @Steve-Mcl

#### 4.0.0-beta.4: Beta Release

Editor

 - Fix the Sidebar Config is not refreshed after a deploy (#4734) @GogoVega
 - Fix checkboxes are not updated when calling `typedInput("value", "")` (#4729) @GogoVega
 - Fix panning with middle mouse button on windows 10/11 (#4716) @corentin-sodebo-voile
 - Add Japanese translation for sidebar tooltip (#4727) @kazuhitoyokoi
 - Translate the number of items selected in the options list (#4730) @GogoVega
 - Fix a checkbox should return a Boolean value and not the string `on` (#4715) @GogoVega
 - Deleting a grouped node should update the group (#4714) @GogoVega
 - Change the Config Node cursor to `pointer` (#4711) @GogoVega
 - Add missing tooltips to Sidebar (#4713) @GogoVega
 - Allow nodes to return additional history entries in onEditSave (#4710) @knolleary
 - Update to Monaco 0.49.0 (#4725) @Steve-Mcl
 - Add Japanese translations for 4.0.0-beta.3 (#4726) @kazuhitoyokoi
 - Show lock on deploy if user is read-only (#4706) @knolleary

Runtime

 - Ensure all CSS variables are in the output file (#3743) @bonanitech
 - Add httpAdminCookieOptions (#4718) @knolleary
 - chore: migrate deprecated `util.isArray` (#4724) @Rotzbua
 - Add --version cli args (#4707) @knolleary
 - feat(grunt): fail if files are missing (#4739) @Rotzbua
 - fix(node-red-pi): node-red not started by path (#4736) @Rotzbua
 - fix(editor): remove trailing slash (#4735) @Rotzbua
 - fix: remove deprecated mqtt.js (#4733) @Rotzbua 

Nodes

 - Perform Proxy logic more like cURL (#4616) @Steve-Mcl

#### 4.0.0-beta.3: Beta Release

Editor

 - Improve background-deploy notification handling (#4692) @knolleary
 - Hide workspace tab on middle mouse click (#4657) @Steve-Mcl
 - multiplayer: Add user presence indicators (#4666) @knolleary
 - Enable updating dependency node of package.json in project feature (#4676) @kazuhitoyokoi
 - Add French translations for 4.0.0-beta.2 (#4681) @GogoVega
 - Add Japanese translations for 4.0.0-beta.2 (#4674) @kazuhitoyokoi
 - Fix saving of conf-type properties in module packaged subflows (#4658) @knolleary
 - Add npm install timeout notification (#4662) @hardillb
 - Fix undo of subflow env property edits (#4667) @knolleary
 - Fix three error typos in monaco.js (#4660) @JoshuaCWebDeveloper
 - docs: Add closing paragraph tag (#4664) @ZJvandeWeg
 - Avoid login loops when autoLogin enabled but login fails (#4684) @knolleary

Runtime

 - Allow blank strings to be used for env var property substitutions (#4672) @knolleary
 - Use rfdc for cloning pure JSON values (#4679) @knolleary
 - fix: remove outdated Node 11+ check (#4314) @Rotzbua
 - feat(ci): add new nodejs v22 (#4694) @Rotzbua
 - fix(node): increase required node >=18.5 (#4690) @Rotzbua
 - fix(dns): remove outdated node check (#4689) @Rotzbua
 - fix(polyfill): remove import module polyfill (#4688) @Rotzbua
 - Fix typo (#4686) @Rotzbua

Nodes

 - Pass full error object in Function node and copy over cause property (#4685) @knolleary
 - Replacing vm.createScript in favour of vm.Script (#4534) @patlux

#### 4.0.0-beta.2: Beta Release

Editor

 - Introduce multiplayer feature (#4629) @knolleary
 - Separate the "add new config-node" option into a new (+) button (#4627) @GogoVega
 - Retain Palette categories collapsed and filter to localStorage (#4634) @knolleary
 - Ensure palette filter reapplies and clear up unknown categories (#4637) @knolleary
 - Add support for plugin (only) modules to the palette manager (#4620) @knolleary
 - Update monaco to latest and node types to 18 LTS (#4615) @Steve-Mcl

Runtime

 - Fix handling of subflow config-node select type in sf module (#4643) @knolleary
 - Comms API updates (#4628) @knolleary
 - Add French translations for 4.0.0-beta.1 (#4621) @GogoVega
 - Add Japanese translations for 4.0.0-beta.1 (#4612) @kazuhitoyokoi

Nodes
 - Fix change node handling of replacing with boolean (#4639) @knolleary

#### 4.0.0-beta.1: Beta Release

Editor

 - Click on id in debug panel highlights node or flow (#4439) @ralphwetzel
 - Support config selection in a subflow env var (#4587) @Steve-Mcl
 - Add timestamp formatting options to TypedInput (#4468) @knolleary
 - Allow RED.view.select to select links (#4553) @lgrkvst
 - Add auto-complete to flow/global/env typedInput types (#4480) @knolleary
 - Improve the appearance of the Node-RED primary header (#4598) @joepavitt

Runtime

 - let settings.httpNodeAuth accept single middleware or array of middlewares (#4572) @kevinGodell
 - Upgrade to JSONata 2.x (#4590) @knolleary
 - Bump minimum version to node 18 (#4571) @knolleary
 - npm: Remove production flag on npm invocation (#4347) @ZJvandeWeg
 - Timer testing fix (#4367) @hlovdal
 - Bump to 4.0.0-dev (#4322) @knolleary

Nodes

 - TCP node - when resetting, if no payload, stay disconnected @dceejay
 - HTML node: add option for collecting attributes and content (#4513) @gorenje
 - let split node specify property to split on, and join auto join correctly (#4386) @dceejay
 - Add RFC4180 compliant mode to CSV node (#4540) @Steve-Mcl
 - Fix change node to return boolean if asked (#4525) @dceejay
 - Let msg.reset reset Tcp request node connection when in stay connected mode (#4406) @dceejay
 - Let debug node status msg length be settable via settings (#4402) @dceejay
 - Feat: Add ability to set headers for WebSocket client (#4436) @marcus-j-davies

#### Older Releases

Change logs for older releases are available on GitHub: https://github.com/node-red/node-red/releases
