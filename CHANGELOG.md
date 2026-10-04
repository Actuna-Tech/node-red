#### Unreleased: Instances and reload

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

Documentation

 - `instanceId` is described in the `coordination` section of the settings template
   (`instanceId: process.env.NODE_RED_INSTANCE_ID`) and in `FORK.md`: a cluster that shares a
   storage needs the same explicit id on all instances (#3)

#### Unreleased: Security and fixes

Security

 - Prevent crash on websocket auth packet when admin auth is disabled
 - Render the username as text in the editor user menu and login notification

Fixes

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
   the deploy errors (`RED.deploy.translateErrorResponse`). A request with no HTTP response (status 0)
   shows "no response from server". Polish editor: `library.saveFailed` and `user.notAuthorized` are
   translated (the message no longer mixes languages). No change of the API (#30)
 - Editor: text from a server response and the module name were inserted into notifications (HTML) without
   escaping. They are now escaped (`& < > " '`) in the palette (install, update, remove, enable and disable of
   a module, install from a file, automatic install), in the projects (the unexpected error: `message` and
   `code`; git errors of the remote branches), in the version control (git errors; a failed connection on pull
   shows the `message` of the error instead of "[object Object]"), when a node module fails to load, on import
   and drop errors (the message of a failed import quotes the pasted text) and for groups. The catalog text
   stays HTML. The shared escaping moved from `RED.deploy` to the new `RED.errors` module (`ui/common/errors.js`,
   loaded before the modules that use it); `RED.deploy.translateErrorResponse` and `RED.deploy.formatStartErrors`
   work as before, and the library no longer depends on the deploy module. No change of the API (#34)
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
 - Tests only, no change of the product: flaky tests fixed. The HTTP tests no longer reach a foreign server
   on the same machine (supertest started the app on all interfaces but connected to `127.0.0.1`; the
   shared helper `nr-test-utils/supertest` listens on `127.0.0.1`), the `tcp request` test server hook calls
   `done` once, the `watch` test ignores a macOS event of the test preparation and the limits of the
   time-dependent hold tests are wider (#19)

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
   app (`RED.stop()` and `RED.start()` in one process) replaces the capture instead of adding another. An authorization in `httpNodeMiddleware` runs after the
   body has been read (up to the limit): above the limit the client gets 413 instead of 401. To avoid reading
   the body of unauthenticated requests use `httpNodeAuth` or an application middleware in front of `RED.httpNode`.
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

#### Unreleased: Engine extensions

Features

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
