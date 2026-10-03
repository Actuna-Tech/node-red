# Weryfikacja „Stanu w 5.0.6” ze zlecenia względem kodu

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

Metoda: przegląd kodu (4 niezależne przeglądy tylko do odczytu), gałąź na bazie **5.0.7**
(różnice 5.0.6→5.0.7 nie dotyczą badanych obszarów – zob. [ANALIZA.md](ANALIZA.md) §2).
Ścieżki względem `packages/node_modules/`. Nic nie było uruchamiane, o ile nie zaznaczono inaczej.

## Podsumowanie

| Pakiet | Wynik | Najważniejsza różnica względem zlecenia |
|---|---|---|
| P-01 | **potwierdzone** | dodatkowo: błędy zatrzymania są połykane (pusty `.catch`), klient dostaje `{rev: undefined}`; błędy startu tylko w logu |
| P-02 | **częściowo** | okno konfliktu pojawia się dopiero po 409 lub z powiadomienia „Review changes”, nie przy każdym wdrożeniu; opcja „Overwrite” tylko po 409 |
| P-03 | **potwierdzone** | dowolny użytkownik z `settings.write` może włączyć telemetrię mimo wyłączenia przez administratora |
| P-04 | **potwierdzone, poważniejsze** | przy **wyłączonym** `adminAuth` dowolny klient websocket wysyłający `{"auth":"x"}` wywołuje synchroniczny `TypeError` → wyjątek nieobsłużony → `process.exit(1)` (wniosek z kodu, nie uruchamiano) |
| Z-01 | **potwierdzone, z korektą** | subskrypcja przed `auth ok` nie ginie po cichu: przy użytkowniku anonimowym jest obsłużona, bez niego serwer zamyka połączenie (`auth fail`) → zbędne logowanie/ponowne łączenie |
| Z-02 | **potwierdzone** | brak globalnego uwierzytelnienia tras węzłów; nawet core udostępnia publicznie widoki debug |
| Z-03 | **w większości nieprawdziwe** | aktualizacja z `.tgz` **jest** wykrywana (`isUpgrade`, „nodeUpgraded”); brakuje: potwierdzenia przed instalacją, porównania semver (starsza wersja = „upgrade”), poprzedniej wersji w hookach; flaga `isUpdate` nieużywana; trzy niespójne nazwy ustawienia uploadu |
| Z-04 | **potwierdzone (c – częściowo)** | `PUT /flow/global` już pozwala wdrażać globalne węzły konfiguracyjne i subflow (zastępuje wszystkie naraz) |
| Z-05 | **potwierdzone** | `reload` też pomija kontrolę; endpointy `/flow` nie mają żadnej kontroli rewizji |
| Z-06 | **potwierdzone** | hooki z białą listą `VALID_HOOKS` – nowe nazwy wymagają rozszerzenia listy |
| Z-07 | **potwierdzone + błąd** | usuwanie tras w `http in` używa `splice` w `forEach` (pomija sąsiednią trasę); kod zależy od Express 4 (`_router`), w Express 5 przestanie działać |
| Z-08 | **potwierdzone** | dodatkowo: `RED.start()` kończy się i serwer HTTP nasłuchuje **przed** startem flow; serwer HTTP nie jest zamykany przy SIGTERM; brak globalnego limitu czasu zatrzymania |
| Z-09 | **potwierdzone** | `flows.load(true)` już realizuje przeładowanie z magazynu (pełny restart, bez blokady API) – do ponownego użycia |
| Z-10 | **potwierdzone** | wzorzec typu wtyczki runtime istnieje (`node-red-library-source`), kolejność startu wymaga gotowości koordynacji przed `startFlows` |
| Z-11 | **potwierdzone** | 16 miejsc zapisu; przy własnym magazynie `userDir` może być nieustawiony → instalator pisze do `NODE_RED_HOME` lub katalogu bieżącego; CLI kopiuje `settings.js` do `~/.node-red` niezależnie od magazynu |
| Z-12 | **potwierdzone** | brak API dla elementów nagłówka i przycisku Deploy; brak ogólnego okna modalnego; plakietki węzłów są (nieudokumentowane `RED.view.annotations`) |
| Z-13 | **częściowo** | `editor.json` en-US w czystym 5.0.7 ma **1126** kluczy (nie 1089; na naszej gałęzi 1140 – w tym 14 kluczy `layout.*` z Z-14); łącznie ~2300 tekstów JSON + 36 plików pomocy (~13,3 tys. słów); język wykrywany automatycznie z katalogu `locales/pl`; klucze `_plural` z en-US nie działają dla `pl` w i18next 25 – potrzebne sufiksy `_one/_few/_many/_other` (sprawdzone skryptem poza edytorem) |

## Szczegóły (fakty dla implementacji)

### P-01
- `runtime/lib/flows/index.js:207-241` (`setFlows`): zapis → `stop()` → `context.clean` → `start(...)` **bez await** (`:228`), `return flowRevision`.
- Pusty `.catch(function(err){})` (`:233`) połyka błędy zatrzymania/czyszczenia.
- Wszystkie typy (`full`, `nodes`, `flows`), `reload` (`api/flows.js:74` → `flows.load(true)`), `addFlow`/`updateFlow`/`removeFlow` (`:626`, `:800`, `:822`) mają tę samą cechę.
- Błędy startu: zdarzenia `runtime-state` (`:301,:315,:325`), `console.log` (`:409-411`), `Log.error` w `flows/util.js:273-274`; odrzucenie `start` nieobsłużone.
- Kolejność zdarzeń: `flows:stopping` → `flows:stopped` → `runtime-state stop` → `flows:starting` → `flows:started` → `nodes-started` → `runtime-state start` → `runtime-deploy`.
- Odpowiedzi HTTP: `editor-api/lib/admin/flows.js:62-69`, `admin/flow.js:42-59`.

### P-02
- `editor-client/src/js/ui/deploy.js:218-299` `resolveConflict`: Cancel, Review, Merge (aktywne tylko bez konfliktów), Overwrite (tylko gdy `activeDeploy`, `:268-279`).
- Wykrycie: klient wysyła `rev` (`:540-543`), runtime 409 `version_mismatch` (`runtime/lib/api/flows.js:76-84`), klient `:680-681`.
- Powiadomienie w tle: `notification/runtime-deploy` (`:142-196`) z przyciskiem „Review changes” (bez Overwrite).
- Brak testów jednostkowych `deploy.js`; testy serwera: `test/unit/@node-red/editor-api/lib/admin/flows_spec.js`, `runtime/lib/api/flows_spec.js`.

### P-03
- `runtime/lib/telemetry/index.js:99-138`: `telemetryEnabled` (runtime) ma pierwszeństwo nad `telemetry.enabled` z settings.js; zmienna `NODE_RED_DISABLE_TELEMETRY`/`--no-telemetry` ustawia tylko `settings.telemetry.enabled=false` (`node-red/red.js:222-224`).
- Zapis przełącznika: `runtime/lib/api/settings.js:224-233` → `telemetry.enable()/disable()` (`:183-199`) bez sprawdzenia ustawienia administratora.
- Edytor: `userSettings.js:238-248` (zawsze widoczny), pierwsze uruchomienie `red.js:691-720`; wartość: `api/settings.js:164`.
- Testy: `runtime/lib/telemetry/index_spec.js`, `runtime/lib/api/settings_spec.js`.

### P-04
- `editor-api/lib/auth/tokens.js:19,86,118`: `get()` → `loadSessions()` → `storage.getSessions()` na `undefined` → synchroniczny `TypeError`.
- `Tokens.init` wywoływany tylko gdy `adminAuth` (`auth/index.js:45-50`).
- Bez `adminAuth`: `editor/comms.js:70,135-137,82` przekazuje `{"auth":...}` do `Tokens.get` → wyjątek w obsłudze `message` → `node-red/red.js:525-540` `process.exit(1)`.
- `handleAuthPacket` bez `.catch`.
- Testy: `editor-api/lib/auth/tokens_spec.js`, `editor-api/lib/editor/comms_spec.js` (brak przypadku pakietu auth bez adminAuth).

### Z-01
- Klient `editor-client/src/js/comms.js:175-183` `subscribe()` wysyła przy `readyState==1` bez sprawdzenia `pendingAuth`; po `auth ok` `completeConnection()` (`:62-69`) i tak odtwarza wszystkie subskrypcje z mapy `subscriptions`.
- Serwer `editor-api/lib/editor/comms.js:149-165`: przy `pendingAuth` i użytkowniku anonimowym – obsługuje; bez niego – `auth fail` i zamknięcie (`:110-112`, `:162-163`); klient reaguje logowaniem i ponownym łączeniem (`client :93-98`).
- Minimalna poprawka: nie wysyłać w `subscribe()` podczas `pendingAuth` (odtworzenie po `auth ok` już istnieje).
- Testy serwera: `editor-api/lib/editor/comms_spec.js`; brak testów klienta.

### Z-02
- Węzły dostają `httpAdmin: runtime.adminApp` (`registry/lib/util.js:102`; zwykła aplikacja express `runtime/lib/index.js:95`), montowaną w `node-red/lib/red.js:77`.
- `RED.auth` = `{needsPermission}` (`editor-api/lib/index.js:132-134`); `needsPermission` w `editor-api/lib/auth/index.js:59-78`.
- Brak globalnego uwierzytelnienia; jedyne globalne opcje: `httpAdminMiddleware` (`editor-api/lib/index.js:50-54`), przestarzały `httpAdminAuth`.
- Core: z uprawnieniem `20-inject.js:179`, `21-debug.js:250,270`, `32-udp.js:137`; publiczne: `21-debug.js:286,310` (widoki debug).
- **Uwaga:** `disableEditor: true` nie wyłącza Admin API (`editor-api/lib/index.js:83-95`); wyłącza je dopiero `httpAdminRoot: false`.
- Testy: `editor-api/lib/auth/index_spec.js`, `permissions_spec.js`, `editor-api/lib/index_spec.js`.

### Z-03
- Ścieżka: `palette-editor.js:1427-1478` (brak `.done`) → `editor-api/lib/admin/index.js:62-64` (multer w pamięci) → `admin/nodes.js:54-64` → `runtime/lib/api/nodes.js:174-200` → `registry/lib/installer.js:138-139,425-474` (`installTarball`) → `installModule` (`:191-213`).
- Wersja różna → `isUpgrade` (porównanie `!==`, bez semver), ta sama → `module_already_loaded` (`:196-199`); `isUpdate` (`:456`) nieużywane.
- Hooki `preInstall/postInstall` (`:222-244`): `{module, version, url, dir, isExisting, isUpgrade, args}` – brak poprzedniej wersji i oznaczenia źródła (upload).
- Ustawienia uploadu: `externalModules.palette.allowUpload` (`installer.js:426`), `externalModules.palette.upload` (`runtime/lib/api/nodes.js:175`), `editorTheme.palette.upload` (`editor-api/lib/admin/nodes.js:54`).
- Testy: `registry/lib/installer_spec.js` (hooki 287-353, listy 355-490) – brak testu ścieżki tarball; brak testu uploadu w `admin/nodes_spec.js`.

### Z-04, Z-05
- `rev` tylko dla całości: `runtime/lib/storage/index.js:80,98`, `flows/index.js:211-214`; `getFlow` bez rewizji (`:642-733`).
- `updateFlow` nieistniejące id → 404 (`:739-743`, `api/flows.js:166-170`); `addFlow` nadpisuje id (`:577`); duplikaty → 400.
- `updateFlow` przypisuje `z` wszystkim węzłom i `configs` (`:791-796`); `addFlow` jw. (`:606,:619`); `subflows` dla zwykłego flow ignorowane; `PUT /flow/global` (`:749-767`) zastępuje globalne konfiguracje i subflow.
- Kontrola rewizji tylko `api/flows.js:76-86` (w `mutex.runExclusive`, `:67`); v1 (`admin/flows.js:56`) nigdy nie ma `rev`; `reload` pomija; `/flow` – brak kontroli; 409 `version_mismatch` (`editor-api/lib/util.js:42-58`).
- **Nasza zmiana FL-B-001** (`copyFlowLayoutProperties` w `addFlow/getFlow/updateFlow`) dotyka tych samych funkcji.

### Z-06
- `util/lib/hooks.js:3-17` `VALID_HOOKS`: `onSend, preRoute, preDeliver, postDeliver, onReceive, postReceive, onComplete, preInstall, postInstall, preUninstall, postUninstall`; `add()` odrzuca inne (`:63-65`); `trigger()` bez handlerów → resolve (`:162-171`); handler może zatrzymać (`false`) lub odrzucić (błąd) (`:175-183`).
- Wzorzec: `registry/lib/installer.js:232-245`.

### Z-07
- `nodes/core/network/21-httpin.js:356-365` – usuwanie przez `RED.httpNode._router.stack` z `splice` w `forEach`; `:135-141` przesuwa middleware `rawBodyCapture` przez `_router.stack`.
- Express 4.22.2 (`package.json:63`); Express 5 zmienia `_router` → `router`.
- Brak `test/nodes/core/network/21-httpin_spec.js`.

### Z-08
- Brak endpointów zdrowia; `/settings` i `/diagnostics` wymagają uwierzytelnienia.
- `runtime/lib/index.js:240-243`: `started=true`, potem `loadFlows().then(startFlows)` bez await → `RED.start()` kończy się przed startem flow; `node-red/red.js:483,505` nasłuch.
- Zatrzymanie: `node-red/red.js:543-558` (SIGINT, SIGTERM, SIGHUP, SIGUSR2, SIGBREAK, PM2 `shutdown`), `RED.stop()` (`node-red/lib/red.js:134-140`) → `runtime.stop()` (`runtime/lib/index.js:316-328`) → `api.stop()`; serwer HTTP nie jest zamykany; `nodeCloseTimeout` domyślnie 15 s (`flows/Flow.js:29,857`, `stopNode :767-788`).
- Testy: `runtime/lib/flows/Flow_spec.js:477`, `flows/index_spec.js`, `runtime/lib/index_spec.js`; brak testów sygnałów.

### Z-09
- Magazyn: `init, getFlows, saveFlows, saveCredentials, getSettings/saveSettings, getSessions/saveSessions, getLibraryEntry/saveLibraryEntry` (+ przestarzałe, `projects`, `sshkeys`); brak `watch` (`runtime/lib/storage/index.js:51-195`).
- Start: `runtime/lib/index.js:241-243`; `flows.load(true)` = odczyt z magazynu + pełny restart, bez blokady API (`api/flows.js:67` mutex) – obserwator musi przejść przez `api.flows.setFlows({deploymentType:'reload'})` lub wspólny mutex.

### Z-10
- `nodes/core/common/20-inject.js:19,75-100,168-177` – `setInterval`/`cronosjs`, brak koordynacji; punkt zaczepienia: wywołania zwrotne timerów (`:80,:84,:95`), nie `on("input")` (przycisk ręczny `:179`).
- Wtyczki: `registry/lib/plugins.js:21-57` (`registerPlugin`, `getPluginsByType`, `registry:plugin-added`); wzorzec runtime: `runtime/lib/library/index.js:35-60` (`node-red-library-source`).
- Kolejność: `library.init` (`runtime/lib/index.js:140`) przed `redNodes.load()` (`:166`); flow startują `:239-243` – koordynacja gotowa przed `startFlows`.
- API węzłów: `registry/lib/util.js` (`createNodeApi`). Testy: `registry/lib/plugins_spec.js`, `runtime/lib/plugins_spec.js`, `runtime/lib/library/index_spec.js`, `test/nodes/core/common/20-inject_spec.js`.

### Z-11 – zapisy na dysk

| # | Miejsce | Co | Kiedy | Wyłączenie dziś |
|---|---|---|---|---|
| 1 | `node-red/red.js:151` | kopia `settings.js` do `~/.node-red` | start CLI bez pliku ustawień – **niezależnie od magazynu** | `--settings` / `--userDir` z settings.js |
| 2 | `registry/lib/installer.js:443` | `<userDir>/nodes/<name>-<ver>.tgz` | upload | `externalModules.palette.allowUpload:false` |
| 3 | `installer.js:477-479` | `os.tmpdir()/nr-tarball-*` (usuwany) | upload | jw. |
| 4 | `installer.js:470` | usunięcie starego tgz | aktualizacja z uploadu | jw. |
| 5 | `installer.js:239` | `npm install --save` (`node_modules`, `package.json`, lock) | instalacja/aktualizacja z palety | `palette.allowInstall/allowUpdate:false`, listy, hook `preInstall`→`false` |
| 6 | `installer.js:274,544` | `npm remove` | wycofanie, odinstalowanie | `palette.allowInstall:false` |
| 7 | `runtime/lib/index.js:167-215,268` | instalacja brakujących modułów | start / ponowienia | `externalModules.autoInstall` (domyślnie wył.) |
| 8 | `registry/lib/externalModules.js:228,232` | `ensureDir(userDir)`, `package.json` | pierwszy moduł węzła Function | `externalModules.modules.allowInstall:false` |
| 9 | `externalModules.js:277` | `npm install` | `libs` węzła Function | jw. |
| 10 | `runtime/lib/nodes/context/localfilesystem.js:145-146,202,231,387,412,415` | `context/**.json` | zapis/flush kontekstu | tylko gdy `contextStorage` = localfilesystem |
| 11 | `storage/localfilesystem/index.js:50,69` | `node_modules`, `package.json` | init magazynu | własny magazyn / `readOnly` |
| 12 | `storage/localfilesystem/projects/index.js:626,662` (`util.js:89-118`) | flow, poświadczenia, `.backup` | deploy | jw. |
| 13 | `storage/localfilesystem/settings.js:75,83` | `.config.*.json` | zapis ustawień | jw. |
| 14 | `storage/localfilesystem/sessions.js:50` | `.sessions.json` | logowanie | jw. |
| 15 | `storage/localfilesystem/library.js:149,171-172` | `lib/**` | biblioteka | jw. |
| 16 | `storage/localfilesystem/projects/index.js:130` | `projects/` (git) | Projekty włączone | `editorTheme.projects.enabled`, własny magazyn |

Dodatkowo: `localfilesystem.init` ustawia `settings.userDir` (`storage/localfilesystem/index.js:36-46`) – przy własnym magazynie może być nieustawiony.

### Z-12 – istniejące punkty rozszerzeń edytora (`editor-client/src/js/`)

| Punkt | API |
|---|---|
| Pasek boczny | `RED.sidebar.addTab` (`ui/sidebar.js:120`) |
| Menu główne | `RED.menu.addItem/removeItem` (`ui/common/menu.js:547`) |
| Akcje, skróty | `RED.actions.add` (`ui/actions.js:6`), `RED.keyboard.add` |
| Pasek stanu | `RED.statusBar.add` (`ui/statusBar.js:31`) |
| Plakietki węzłów | `RED.view.annotations.register` (`ui/view-annotations.js:101`) – nieudokumentowane |
| Hooki widoku | `viewAddNode, viewRedrawNode, viewAddPort, …, debugPre/PostProcessMessage` (`hooks.js:7-15`) |
| Popover, menu, panel | `RED.popover.*` (`ui/common/popover.js`) |
| Tray, powiadomienia z przyciskami | `RED.tray.show` (`ui/tray.js:243`), `RED.notify` (`ui/notifications.js:66`) |
| Menu kontekstowe, panele ustawień, panele edycji, kategorie palety | `RED.contextMenu.show`, `RED.userSettings.add`, `RED.editor.registerEditPane`, `RED.palette.registerCategory` |
| **Brak** | elementy nagłówka (core dopisuje do `.red-ui-header-toolbar` jQuery), przycisk Deploy (`RED.deploy` eksportuje tylko `init`, `setDeployInflight`), ogólne okno modalne |

Testy jednostkowe edytora w `test/unit/@node-red/editor-client/ui/`: `search_spec.js` (upstream) i nasz `view-layout_spec.js` – wzorzec dla E-03.

### Z-13
- Brak `pl`. Klucze en-US: `editor.json` 1126 (czyste 5.0.7; 1140 z Z-14), `jsonata.json` 138, `infotips.json` 19, `nodes/messages.json` 872, `runtime.json` 141; pomoc węzłów: 36 plików HTML (~13 340 słów).
- Języki wykrywane z katalogów (`util/lib/i18n.js:49-67,221`); w selektorze nazwa z `languages.<kod>` w `editor.json` każdego języka (`userSettings.js:105,186`).
- Do dodania: `editor-client/locales/pl/{editor,jsonata,infotips}.json`, `nodes/locales/pl/messages.json` + pomoc, `runtime/locales/pl/runtime.json`, `"pl": "Polski"` w `languages` wszystkich `editor.json`.
- Testy: `util/lib/i18n_spec.js`, `editor-api/lib/editor/locales_spec.js`.
