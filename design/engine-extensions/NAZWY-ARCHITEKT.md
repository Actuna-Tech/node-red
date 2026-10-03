# Nazwy ustawień i API – ponowna analiza architektoniczna (D-02, rewizja)

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.
> Dokument towarzyszy [ZASADY.md](ZASADY.md) §2.1/§2.1a i [ANALIZA.md](ANALIZA.md) §7 (D-02 rewizja). Wpływ biznesowy i migracja – osobny dokument analityka.

## 1. Metoda

- Niezależna ocena dwóch zestawów nazw (zlecenie / załącznik A vs rekomendacja D-02) wyłącznie na podstawie kodu bazy **5.0.7** (katalog `packages/node_modules`), bez przyjmowania poprzedniego uzasadnienia za pewnik.
- Sprawdzone: szablon `node-red/settings.js` (sekcje, konwencja płaska vs obiekty), `@node-red/runtime/lib/settings.js` (trzy mapy ustawień, reguła prefiksu ustawień węzłów), `@node-red/runtime/lib/api/settings.js` (`safeSettings` – co trafia do edytora), `@node-red/editor-api/lib/editor/theme.js` i `admin/settings.js` (kanał `editorTheme`), `@node-red/editor-client/src/js/settings.js` i `ui/userSettings.js` (jak edytor czyta `editor`), `@node-red/registry/lib/util.js` (obiekt `RED` dla węzłów), `@node-red/editor-api/lib/auth/index.js` (`RED.auth`), `@node-red/util/lib/hooks.js` (`VALID_HOOKS`), `runtime/lib/nodes/Node.js` (prototyp węzła), magazyn plikowy (`readOnly`), łatki załącznika A.
- Odwołania w formacie `plik:linia` względem `packages/node_modules/` (chyba że podano inaczej). Wnioski z kodu – nieuruchamiane.

## 2. Ustalenia z kodu

### 2.1 Konwencja szablonu `settings.js`

| Obserwacja | Dowód |
|---|---|
| Szablon dzieli ustawienia na sekcje: Flow File and User Directory, Security, Server, **Runtime Settings** (`lang`, `runtimeState`, `telemetry`, `diagnostics`, `logging`, `contextStorage`, `exportGlobalContextKeys`, `externalModules`), **Editor Settings** (`disableEditor`, `editorTheme`), **Node Settings** | `node-red/settings.js:25-33, 65-70, 130-146, 274-284, 403-407, 496-500` |
| Płaskie klucze = pojedyncze wartości dotyczące procesu/pliku/serwera: `flowFile`, `flowFilePretty`, `userDir`, `uiPort`, `disableEditor`, `exportGlobalContextKeys`, `nodeMessageBufferMaxLength`, `functionTimeout`, `globalFunctionTimeout` | `settings.js:35, 50, 148, 373, 413, 533, 541, 558` |
| Rodzina prefiksów `http*`: `httpAdminRoot`, `httpAdminMiddleware`, `httpAdminCookieOptions`, `httpNodeRoot`, `httpNodeMiddleware`, `httpNodeCors`, `httpStatic*` | `settings.js:137-141, 172, 178, 189, 196, 203, 221, 234, 257` |
| Obiekty grupujące nazwane od **podsystemu/funkcji**, nie od zasobu: `diagnostics {enabled, ui}`, `runtimeState {enabled, ui}`, `telemetry {enabled, updateNotification}`, `logging`, `contextStorage`, `externalModules {autoInstall, palette{...}, modules{...}}` – zagnieżdżenie 2–3 poziomów jest przyjęte | `settings.js:298-303, 311-316, 317-332, 383-400` |
| `editorTheme` zawiera nie tylko wygląd, ale **zachowanie edytora**: `projects {enabled, workflow.mode}`, `multiplayer {enabled}`, `codeEditor`, `markdownEditor`, `tours` | `settings.js:419-494` |
| Płaskie limity czasu: `nodeCloseTimeout`, `socketTimeout`, `inboundWebSocketTimeout`, `httpRequestTimeout` | `runtime/lib/flows/Flow.js:857`, `runtime/lib/api/diagnostics.js:122-124`, `nodes/core/network/21-httprequest.js:99` |
| Płaskie flagi trybu instancji: `disableEditor`, `safeMode` (CLI `--safe`), `readOnly`, `verbose` | `node-red/red.js:206, 209, 304, 311`; `runtime/lib/index.js:229` |
| Precedens deprecjacji nazwy: `httpRoot` → `httpNodeRoot/httpAdminRoot`, `editorTheme.palette.editable` → `externalModules.palette.allowInstall` (`server.deprecatedOption`) | `runtime/lib/index.js:226-227`; `registry/lib/installer.js:579-582` |
| Brak w kodzie 5.0.7 kluczy: `deploy`, `flows`, `health`, `coordination`, `editorOnly`, `readOnlyUserDir`, `shutdownTimeout`, `hookTimeout` (grep po `packages/node_modules`) | – |

### 2.2 Trzy mapy ustawień w runtime (`runtime/lib/settings.js`)

- `localSettings` – plik `settings.js` (tylko odczyt, getter na obiekcie `settings`; `set` rzuca błąd) – `:22-23, 36-48, 79-82`.
- `globalSettings` – zapisywane przez magazyn (`.config.*.json`): `nodes`, `runtimeFlowState`, `telemetryEnabled`, `users` – `:24-25, 53-63`; przykłady odczytu: `runtime/lib/flows/index.js:331`, `runtime/lib/telemetry/index.js:114,186,196`.
- `userSettings = globalSettings.users` – ustawienia **per użytkownik**; dostęp wyłącznie przez `getUserSettings/setUserSettings` (`get('users')` rzuca błąd) – `:64-67, 181-195`.
- **Wniosek do 2a:** klucz `editor` w `settings.js` trafiłby do `localSettings.editor`, a `editor` użytkownika leży w `globalSettings.users[<user>].editor`. **Po stronie runtime nie ma kolizji** – to różne mapy. Poprzednie uzasadnienie (ZASADY §2.1: „klucz `editor` jest używany przez ustawienia użytkownika w runtime”) było nieprecyzyjne. Kolizja istnieje, ale **po stronie edytora** (pkt 2.4).

### 2.3 Ustawienia węzłów i reguła prefiksu

- `registerType(..., {settings: {...}})` → `settings.registerNodeSettings(type, opts)`: każda nazwa właściwości **musi zaczynać się** od znormalizowanej nazwy typu (`util.normaliseNodeTypeName`, np. `function` → `functionExternalModules`, `functionTimeout`) – `runtime/lib/settings.js:127-137`, `runtime/lib/nodes/index.js:57`, `util/lib/util.js:848-859`, przykłady `nodes/core/function/10-function.js:612-614`, `21-debug.js:217`, `05-tls.js:118-121`.
- `exportNodeSettings` kopiuje do `safeSettings` właściwości `exportable`; jeśli klucz istnieje w `localSettings`, **eksportuje wartość z `settings.js`**; nie nadpisuje tylko kluczy już obecnych w `safeSettings` – `:139-158`.
- **Skutek dla nazw:** węzeł zewnętrzny o typie `deploy`, `flows`, `health`, `coordination` lub `telemetry` może zarejestrować właściwość o nazwie równej naszemu obiektowi (reguła `startsWith` dopuszcza nazwę identyczną z typem) i wyeksportować **cały** nasz obiekt do edytora (nie są chronione także `telemetry`, `runtimeState`, `diagnostics` – te ostatnie tylko dlatego, że `safeSettings` już je zawiera). Ryzyko **symetryczne** dla `flows.*` i `deploy.*` – nie różnicuje zestawów. W 5.0.7 brak typów węzłów o takich nazwach w rdzeniu. Zalecenie (poza zakresem nazw, tanie): w `registerNodeSettings` odrzucać właściwość równą zarezerwowanemu kluczowi rdzenia (lista stała) – do rozważenia w E-01/E-02.
- Ustawienia wtyczek: `definition.settings` eksportowane pod **id wtyczki** jako klucz obiektu w `settings.js` (`registry/lib/plugins.js:39, 158-190`) – nie kolidują z nazwami rdzenia.

### 2.4 Jak edytor czyta ustawienia (kluczowe dla P-02)

- Edytor pobiera `GET settings` → `safeSettings` (biała lista budowana w `runtime/lib/api/settings.js:76-186`) + `editorTheme` doklejane przez `editor-api/lib/admin/settings.js:57-66` (`theme.settings()`); osobno `GET settings/user` → `userSettings` (`editor-client/src/js/settings.js:206-220`).
- `RED.settings.get(key)` szuka **najpierw w ustawieniach użytkownika, a przy braku – w `RED.settings` (ustawienia runtime)** – `editor-client/src/js/settings.js:60-76` (fallback `:69-71`).
- Klucz `editor` jest **kluczem ustawień użytkownika** edytora: `RED.settings.get('editor')` / `RED.settings.set('editor', ...)` w `ui/userSettings.js:265, 353-356, 368, 403, 447`, `ui/view.js:1003, 1551, 1754, 2006, 2011`, `ui/subflow.js:626`; struktura `editor.view.<opcja>`.
- **Realna kolizja `editor.staleFlowsPolicy`:** aby edytor znał politykę, runtime musiałby wyeksportować `safeSettings.editor = {...}`. Wtedy: (1) `RED.settings.get('editor')` zwróci u użytkownika bez własnych ustawień **obiekt runtime**, a `userSettings.js:353-356` dopisze do niego `view` i **zapisze całość jako ustawienia użytkownika** (`POST settings/user`) – polityka serwera „zamrozi się” w profilu użytkownika; (2) ponieważ użytkownik przeważa nad runtime w `get()`, każdy klient z uprawnieniem `settings.write` może **nadpisać politykę** własnym `editor.staleFlowsPolicy` – obejście zabezpieczenia, jeśli implementacja czytałaby przez `RED.settings.get`. Kolizja jest więc **merytoryczna**, choć leży w edytorze, a nie w runtime.
- Naturalne kanały dla zachowania edytora sterowanego z `settings.js`:
  - `editorTheme.*` – biała lista w `theme.js:398-434` (`menu`, `palette`, `projects`, `multiplayer`, `keymap`, `theme`, `tours`, `help`, `deployButton :350-364`, `userMenu :366-368`); odczyt `RED.settings.theme("projects.enabled")`, `RED.settings.theme("deployButton")` (`editor-client/src/js/red.js:201, 737, 874, 893`). Nowy klucz wymaga dopisania do białej listy (jak `multiplayer`).
  - `safeSettings.<obiekt runtime>` – precedens `runtimeState {enabled, ui}` i `diagnostics {enabled, ui}` (`api/settings.js:155-172`), czytane `RED.settings.runtimeState.ui` (`ui/deploy.js:76, 108`). Tu edytor dostaje **wycinek** obiektu runtime.
- Uwaga poboczna (błąd w 5.0.7, do ewentualnego zgłoszenia osobno): `theme.js:432-434` przypisuje `theme.help` do `themeSettings.tours` (nadpisuje `tours`). Dotyka miejsca, w którym P-02/Z-14 dopiszą nowe klucze – poprawić przy okazji, z testem.

### 2.5 Przestrzeń `flows`

- W `settings.js` i runtime **nie ma** klucza `flows`; są `flowFile`, `flowFilePretty` (`settings.js:35, 50`; `storage/localfilesystem/projects/index.js:58-59, 148-157`) oraz zapisywany `runtimeFlowState` (`flows/index.js:331`).
- Słowo `flows` występuje jako **zasób API** i uprawnienie: ścieżki `/flows`, `/flows/state`, uprawnienia `flows.read/flows.write` (`editor-api/lib/auth/index.js:57`), zdarzenia audytu `flows.set`. To **precedens pośrednio na korzyść `flows.*`** („ustawienia zasobu flows”) – kolizji nie ma. Argument „myli się z plikiem flow” (ZASADY §2.1) jest słaby; mocniejszy jest argument z pkt 2.6.

### 2.6 Grupowanie: `deploy` vs rozproszenie

- Nazwa `deploy` jest już **pojęciem spójnym w całym projekcie**: zdarzenie `runtime-deploy` (`runtime/lib/api/flows.js`), typy wdrożenia `full/nodes/flows/reload`, moduł edytora `RED.deploy` (`editor-client/src/js/ui/deploy.js`), `editorTheme.deployButton` (`theme.js:350`), hooki `preDeploy/postDeploy` (planowane; wzorzec `preInstall/postInstall` – `util/lib/hooks.js:13-16`).
- Zestaw D-02 kładzie w `deploy` ustawienia **jednej operacji**: `response` (P-01), `putCreatesFlow` (Z-04), `requireRevision` (Z-05), `hookTimeout` (Z-06), `reload {...}` (Z-09). W zestawie zlecenia te same ustawienia nazywałyby się `flows.deployResponse`, `flows.putCreates`, `flows.requireRevision`, a dla Z-06/Z-09 brak propozycji – `flows.hookTimeout` byłoby niejednoznaczne (hook czego?), `flows.deployResponse` powtarza słowo z nazwy obiektu, `putCreates` nie mówi, co tworzy.
- Rozmiar obiektu: 5 kluczy + 1 obiekt zagnieżdżony – porównywalne z `externalModules` (`settings.js:383-400`). Nie jest to „rosnący obiekt bez granic”, bo zakres jest zdefiniowany: potok wdrożenia (ZASADY §2.3).

### 2.7 API węzłów (`RED.*`, `node.*`)

- Obiekt `RED` dla węzła: `nodes`, `log`, `settings`, `events`, `hooks`, `util`, `version`, `require`, `import`, `comms`, `plugins`, `library`, `httpNode`, `httpAdmin`, `server`, `auth`, `_` – `registry/lib/util.js:66-128`. `RED.settings` to kopia metod i getterów `runtime.settings` (`:113`), więc `RED.settings.deploy` / `RED.settings.flows` działałoby identycznie.
- `RED.auth` = `runtime.adminApi.auth` z jedną metodą publiczną `needsPermission(permission)` zwracającą middleware (`editor-api/lib/auth/index.js:61-77`, atrapy `runtime/lib/index.js:46-49`, `registry/lib/util.js:119-121`). Nowa metoda musi być dodana w trzech miejscach (karta Z-02 to przewiduje).
- `Node.prototype`: `updateWires, context, on, emit, close, send, receive, log, warn, error, debug, trace, metric, status` – `runtime/lib/nodes/Node.js:89-616`; brak metod `register*`. Słowo „route” ma już w Node-RED znaczenie **trasowania komunikatów**: hook `preRoute` (`util/lib/hooks.js:6`). `node.registerRoute` byłoby dwuznaczne.
- Typy wtyczek: `node-red-theme` (`theme.js:393`), `node-red-library-source` (`runtime/lib/library/index.js:60`) – wzorzec `node-red-<rola>`.
- Hooki: `VALID_HOOKS` to płaska lista `on*/pre*/post*` (`hooks.js:3-17`); `preReload`, `preDeploy`, `postDeploy`, `preShutdown` pasują.
- Magazyn: `getFlows/saveFlows/getCredentials/saveCredentials/getSettings/saveSettings/getSessions/saveSessions/getLibraryEntry/saveLibraryEntry` (`runtime/lib/storage/index.js:73-153`) – `watchFlows(callback)` pasuje do rodziny (`<czasownik>Flows`).

### 2.8 `readOnly` (Z-11)

Istniejące, nieudokumentowane `settings.readOnly` (w szablonie tylko `ui.readOnly` dashboardu – `settings.js:563`, inne znaczenie) obejmuje magazyn plikowy: `node_modules`/`package.json` (`storage/localfilesystem/index.js:49, 59`), ustawienia (`settings.js:117, 127`), sesje (`sessions.js:47`), bibliotekę (`library.js:148, 155`), **flow i poświadczenia po cichu** (`projects/index.js:606-608, 651-653` – `return` bez błędu), git Projektów (`projects/index.js:129`); log `settings.readonly-mode` (`runtime/lib/index.js:229`, tekst `runtime.json:90` „Changes will not be saved”). Nie obejmuje instalatora, modułów zewnętrznych, kontekstu plikowego ani kopii `settings.js` w CLI (szczegóły: karta Z-11, `backlog/etap-3.md`).

### 2.9 Załącznik A a nazwy

Łatki 0002–0006 **nie zawierają żadnego ustawienia** (grep nazw `deployResponse`, `staleFlowsPolicy`, `putCreates`, `requireRevision`, `locked` w `*.patch` – tylko klucze i18n `staleFlows*`). Nazwy ze zlecenia występują wyłącznie w `README.md` załącznika jako „propozycja”. **Nie istnieje kod Zamawiającego, który je czyta** – koszt przyjęcia innych nazw po stronie kodu wynosi zero; pozostaje koszt dokumentacyjny/komunikacyjny (ocena analityka).

## 3. Rekomendacje per wiersz

| Pakiet | Zlecenie / zał. A | D-02 | **Rekomendacja architekta** | Różnica | Kolizja | Zgodność z konwencją |
|---|---|---|---|---|---|---|
| P-01 | `flows.deployResponse` | `deploy.response` | **`deploy.response: "stopped" \| "started"`** | kosmetyczna (obie bez kolizji) | brak dla obu | `deploy` = podsystem (jak `runtimeState`, `telemetry`); spójne z hookami i `RED.deploy` |
| P-02 | `editor.staleFlowsPolicy` | `editorTheme.deploy.staleFlows` | **`editorTheme.deploy.staleFlows: "prompt" \| "reload-only"`** | **merytoryczna** | `editor` – realna (edytor, pkt 2.4) | kanał `editorTheme` = zachowanie edytora (`projects`, `multiplayer`) |
| Z-04 | `flows.putCreates` | `deploy.putCreatesFlow` | **`deploy.putCreatesFlow: false`** | kosmetyczna + czytelność | brak | nazwa mówi, co jest tworzone |
| Z-05 | `flows.requireRevision` | `deploy.requireRevision` | **`deploy.requireRevision: false`** | kosmetyczna | brak | jw. |
| P-03 | `telemetry.locked` | bez zmian | **`telemetry.locked: false`** (bez zmian) | – | brak | obiekt `telemetry` istnieje (`settings.js:317`) |
| Z-02 | `httpAdminNodeRoutes`, `RED.auth.public()` | `httpAdminNodeRoutes`, `RED.auth.publicRoute()` | **`httpAdminNodeRoutes: "open" \| "authenticated"`**; **`RED.auth.publicRoute()`** | ustawienie: bez różnicy; API: kosmetyczna z uzasadnieniem | brak | rodzina `httpAdmin*`; `publicRoute()` czyta się jak `needsPermission()` – fabryka middleware |
| Z-07 | `node.registerRoute` | `node.registerHttpRoute` | **`node.registerHttpRoute(method, path, ...handlers)`** | **merytoryczna** | `route` = trasowanie komunikatów (`preRoute`) | JSDoc: trasa na `RED.httpNode` (nie `httpAdmin`) |
| Z-08 | `health: {enabled, path}` | `health: {enabled, path, port, host}` + `shutdownTimeout` | **jak D-02** | rozszerzenie (nadzbiór zlecenia) | brak | struktura jak `diagnostics`; płaski `shutdownTimeout` jak `nodeCloseTimeout` |
| Z-09 | `watchFlows`, `preReload` | bez zmian + `deploy.reload {watch, type, preReloadTimeout, concurrency}` | **jak D-02** | brak dla API; `deploy.reload` – nowe | brak | `watchFlows` jak `getFlows/saveFlows`; hook `pre*` |
| Z-10 | typ „koordynacja” | `node-red-coordination`, `RED.coordination`, `coordination: {plugin, options}` | **jak D-02** | doprecyzowanie | brak | typ jak `node-red-library-source`; `coordination` jak `contextStorage` |
| Z-11 | `readOnlyUserDir` | bez zmian | **`readOnlyUserDir: false`** (bez zmian); `readOnly` nietknięte, relacja udokumentowana | – | `readOnly` – inne, węższe znaczenie (pkt 2.8) | płaska flaga trybu jak `disableEditor`, `safeMode` |
| Z-15 | – | `editorOnly` (alt. `runtimeState.autoStart`) | **`editorOnly: false`** | – | brak | płaska flaga trybu, symetria z `disableEditor`; `runtimeState` to API start/stop z zapisywanym `runtimeFlowState` – inna semantyka |
| Z-06 | – | `deploy.hookTimeout` | **`deploy.hookTimeout: 30000`** | – | brak | w obiekcie operacji, której dotyczy |
| Z-03 | – | `externalModules.palette.allowDowngrade` | **jak D-02** | – | brak | rodzina `allowInstall/allowUpdate/allowUpload` (`installer.js:79-83, 426, 595`) |
| Z-14 | – | `editorTheme.flowLayout.enabled` | **jak D-02** | – | brak | jak `editorTheme.multiplayer.enabled` |

### Uzasadnienia szczegółowe

**P-01 / Z-04 / Z-05 / Z-06 / Z-09 (`deploy.*`).** Oba zestawy są wolne od kolizji (pkt 2.5). Przewaga `deploy` jest spójnościowa: jedna operacja, jeden obiekt, zgodność z nazwami hooków i zdarzenia `runtime-deploy`; `flows.*` wymusiłoby powtórzenie słowa (`flows.deployResponse`) i nie ma dobrego miejsca dla Z-06/Z-09. Ryzyko eksportu przez węzeł o typie `deploy` lub `flows` jest identyczne (pkt 2.3). Ocena: **różnica kosmetyczna**, decyzja może uwzględnić koszt komunikacji (analityk). Czytelność dla użytkownika Node-RED: `deploy.response: "started"` jest zrozumiałe bez dokumentacji; `flows.deployResponse` również.

**P-02 (`editorTheme.deploy.staleFlows`).** Jedyna różnica, którą oceniam jako **merytoryczną**: klucz `editor` jest przestrzenią ustawień użytkownika w edytorze, a `RED.settings.get()` łączy ją z ustawieniami runtime (pkt 2.4). Każda implementacja, która chciałaby przekazać `editor.staleFlowsPolicy` do edytora, albo wymusi czytanie „obok” standardowego API (`RED.settings.editor` zamiast `get`), albo stworzy furtkę do nadpisania polityki przez użytkownika. `editorTheme` jest kanałem sprawdzonym dla zachowań edytora (`projects.enabled`, `multiplayer.enabled`, `deployButton`). Nazwa `deploy` w `editorTheme` wymaga rozróżnienia od `deployButton` (wygląd) w dokumentacji – jak w ZASADY §2.1a. Wartości `"prompt" | "reload-only"` – bez zmian względem zlecenia (sufiks `Policy` zbędny: wartości są polityką).

**P-03 (`telemetry.locked`).** Bez kolizji; obiekt istnieje (`settings.js:317-332`, odczyt `telemetry/index.js:108, 141`). Alternatywa bardziej opisowa (`telemetry.allowUserOverride: false`, bo komentarz szablonu mówi wprost o nadpisaniu przez użytkownika – `settings.js:324`) nie daje korzyści wartej odejścia od zlecenia. **Zostaje `locked`.**

**Z-02 (`RED.auth.publicRoute()`).** `public` jako nazwa właściwości jest legalne, ale jest słowem zarezerwowanym w trybie ścisłym jako identyfikator – mylące w przykładach i podpowiedziach IDE; `publicRoute()` jest symetryczne do `needsPermission()` (obie zwracają middleware). Różnica kosmetyczna; koszt zmiany dla Zamawiającego zerowy (brak kodu, pkt 2.9). Ustawienie `httpAdminNodeRoutes` – bez różnicy między zestawami.

**Z-07 (`node.registerHttpRoute`).** `route` w Node-RED oznacza trasowanie komunikatów (`preRoute`, `preDeliver` – `hooks.js:6-7`); `registerRoute` na węźle sugerowałoby rejestrację w potoku komunikatów. Zmiana **merytoryczna** (jednoznaczność API publicznego dla autorów węzłów). Pozostaje dwuznaczność `httpNode` vs `httpAdmin` – rozwiązać JSDoc-iem i tym, że API obsługuje wyłącznie `httpNode` (karta Z-07); jeśli kiedyś potrzebny będzie odpowiednik dla `httpAdmin`, nazwa `registerHttpAdminRoute` pozostaje wolna.

**Z-08.** Zlecenie podaje nadzbiór-zgodny `health: {enabled, path}`; `port`, `host` są opcjonalnymi rozszerzeniami – brak sprzeczności. `shutdownTimeout` płasko: zatrzymanie procesu to nie sonda, a płaskie limity czasu są konwencją (`nodeCloseTimeout` – `Flow.js:857`). Uwaga: `uiHost`/`uiPort` są płaskie, więc `health.port/host` odstaje od pary `ui*` – akceptowalne, bo to opcje jednej funkcji (jak `diagnostics.ui`).

**Z-11.** `readOnlyUserDir` zostaje. Alternatywa „jedno `readOnly` o rozszerzonym znaczeniu” byłaby zmianą zachowania dla dzisiejszych użytkowników (ciche pominięcie → błąd wdrożenia) – niezgodna z DoD „domyślnie = 5.0.6”. Alternatywa „`readOnly` jako alias zdeprecjonowany” (wzorzec `server.deprecatedOption`) nie jest możliwa, bo semantyki się różnią. Zasada współistnienia (do karty Z-11): `readOnlyUserDir: true` implikuje zachowania `readOnly` tam, gdzie się pokrywają, ale zgłasza błąd zamiast cichego `return`; `readOnly` bez `readOnlyUserDir` – bez zmian.

**Z-15.** `editorOnly` – płaska flaga trybu obok `disableEditor` i `safeMode`; `runtimeState.autoStart` byłoby mylące, bo `runtimeState` steruje API start/stop z trwałym `runtimeFlowState` (`flows/index.js:329-337`), a instancja tylko edycyjna ma **nie zapisywać** stanu. Wykluczenie `editorOnly` + `disableEditor` – jak §2.1a.

**Z-10, Z-03, Z-14.** Zgodne z precedensami (pkt 2.7, `installer.js`, `settings.js:490-493`). Bez uwag.

## 4. Wariant pośredni

Cel: ograniczyć różnice względem dokumentów Zamawiającego tam, gdzie nie ma problemu technicznego.

| Grupa | Wariant „minimum zmian” | Ocena |
|---|---|---|
| A. `flows.*` zamiast `deploy.*` (P-01, Z-04, Z-05) z `flows.hookTimeout`, `flows.reload` (Z-06, Z-09) | technicznie dopuszczalne – brak kolizji | kosmetyczna; traci się spójność z `preDeploy/postDeploy`; `flows.deployResponse` → lepiej wtedy `flows.deployResponse` zostawić, ale `flows.putCreates` → `flows.putCreatesFlow` |
| B. `deploy.staleFlows` w obiekcie runtime `deploy`, eksportowane do edytora przez `safeSettings` (wzorzec `runtimeState.ui`) | technicznie poprawne; wszystkie ustawienia wdrożenia w jednym miejscu | merytorycznie równorzędne z `editorTheme.deploy.staleFlows`; wada: runtime przechowuje czysto edytorową politykę UX; zaleta: jeden obiekt `deploy`. **Nie** rozwiązuje problemu nazwy `editor` – ta pozostaje wykluczona |
| C. `editor.staleFlowsPolicy` | **odradzane** | kolizja merytoryczna (pkt 2.4) |
| D. `RED.auth.public()` | dopuszczalne technicznie | odradzane: słowo zarezerwowane, brak symetrii z `needsPermission()`; koszt zmiany zerowy |
| E. `node.registerRoute` | dopuszczalne technicznie | odradzane: dwuznaczność z trasowaniem komunikatów |

**Propozycja architekta:** utrzymać zestaw D-02 w całości; jeżeli Zamawiający przedkłada zgodność dokumentów nad spójność, jedyną grupą, w której można ustąpić bez kosztu technicznego, jest **A** (`flows.*`), pod warunkiem przyjęcia także `flows.hookTimeout` i `flows.reload` (jedna przestrzeń, nie dwie). Grupy C, D, E – nie. Wariant B – jako alternatywa równorzędna dla P-02, do wyboru przez Zamawiającego (kanał `editorTheme` vs jeden obiekt `deploy`).

## 5. Ryzyka

| Ryzyko | Dotyczy | Ocena | Łagodzenie |
|---|---|---|---|
| Węzeł zewnętrzny o typie równym kluczowi rdzenia (`deploy`, `flows`, `health`, `coordination`) eksportuje cały obiekt ustawień do edytora (`runtime/lib/settings.js:139-158`) | wszystkie obiekty, oba zestawy | niskie (brak takich typów w rdzeniu; wymaga świadomej rejestracji) | lista kluczy zarezerwowanych w `registerNodeSettings`; w `safeSettings` eksportować tylko wycinki (jak `runtimeState`) |
| Nowy klucz w `editorTheme` wymaga wpisu w białej liście `theme.js:398-434`; pominięcie = edytor nie widzi ustawienia | P-02, Z-14 | średnie (łatwe do przeoczenia) | test jednostkowy `theme_spec` na przekazanie klucza; poprawić przy okazji błąd `help → tours` (`theme.js:432-434`) |
| `RED.settings.get("editorTheme.deploy.staleFlows")` czytane przez `get` zamiast `theme()` podlega nadpisaniu z ustawień użytkownika (fallback `settings.js:69-71`) | P-02 (każda nazwa) | średnie | w implementacji używać wyłącznie `RED.settings.theme("deploy.staleFlows", "prompt")`; test |
| `diagnostics` raportuje stałą listę ustawień (`api/diagnostics.js:110-145`) – nowe klucze niewidoczne w `/diagnostics` | wszystkie | niskie | dopisać `deploy`, `health`, `editorOnly`, `readOnlyUserDir`, `coordination.plugin` jako `SET/UNSET` lub wartości bez sekretów |
| Dokumentacja `editorTheme.deploy` vs `editorTheme.deployButton` | P-02 | niskie | sąsiadujące wpisy w szablonie `settings.js` z komentarzem |
| Zmiana nazw względem README załącznika A – rozbieżność dokumentów Zamawiającego | P-01, P-02, Z-05 | organizacyjne | notatka migracyjna w kartach (już zalecona w ZALACZNIK-A-ANALIZA §„ZASADY” pkt 3); ocena – analityk |

## 6. Wnioski

1. **Zestaw D-02 zostaje potwierdzony** w całości; żadna z nazw nie koliduje z kodem 5.0.7 (grep), wszystkie mają precedens w konwencji szablonu lub API.
2. Różnice względem zlecenia dzielą się na **merytoryczne** (P-02 `editor` → `editorTheme`; Z-07 `registerRoute` → `registerHttpRoute`) i **kosmetyczne** (`flows.*` → `deploy.*`; `public()` → `publicRoute()`). W kosmetycznych jedyną grupą, gdzie ustępstwo nic nie kosztuje technicznie, jest `flows.*` (wariant A) – pod warunkiem konsekwencji dla Z-06/Z-09.
3. **Korekta uzasadnienia P-02** względem ZASADY §2.1: kolizja klucza `editor` nie zachodzi w runtime (osobne mapy `localSettings` / `globalSettings.users` – `runtime/lib/settings.js:22-25, 60-76`), lecz w edytorze (`editor-client/src/js/settings.js:60-76`, `ui/userSettings.js:353-356`), gdzie `editor` jest przestrzenią ustawień użytkownika, a `get()` łączy obie przestrzenie – skutkiem byłoby utrwalenie polityki w profilu użytkownika i możliwość jej nadpisania. Wniosek ten sam, dowód inny – proponuję zaktualizować §2.1 (wiersz P-02) i §2.1a.
4. Załącznik A nie zawiera kodu czytającego sporne nazwy (pkt 2.9) – zmiana nazw nie wymaga migracji kodu Zamawiającego; pozostaje aktualizacja README/kart (analityk).
5. Zalecenia poboczne do kart (nie zmieniają nazw): lista zarezerwowanych kluczy w `registerNodeSettings`; test białej listy `theme.js` i poprawka `help → tours`; wpisy w `/diagnostics`; w P-02 odczyt wyłącznie przez `RED.settings.theme()`.
