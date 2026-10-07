# Zlecenie rozszerzeń silnika – zasady wspólne dla backlogu

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.
> Dokument towarzyszy [ANALIZA.md](ANALIZA.md) (analiza zgodności i plan). Karty pakietów: [backlog/](backlog/).

## 1. Identyfikatory i powiązania

- Pakiety zlecenia: `P-01`…`P-04`, `Z-01`…`Z-13`; nasz pakiet proponowany: `Z-14` (układ flow).
- Zadania przekrojowe: `E-nn` (np. `E-01` – kontrakt potoku wdrożenia).
- Powiązania z istniejącymi backlogami: `FL-*` ([../flow-layout/BACKLOG.md](../flow-layout/BACKLOG.md)).
- Statusy i priorytety jak w backlogu układu flow (§1).

## 2. Decyzje (pkt 3.4 zlecenia)

> **Decyzje Zamawiającego z 2026-10-03:** D-01 baza **5.0.7**; D-02 rekomendacje nazw **przyjęte po krytycznym
> sprawdzeniu** (wynik w §2.1a); D-03 **bez Playwright w repozytorium** – E2E to osobny podzbiór testów;
> D-10 przyjęte. Szczegóły i pozostałe decyzje: [ANALIZA.md](ANALIZA.md) §7.
>
> **Rejestr decyzji R-01…R-32 (2026-10-03) – zamknięty**, źródło prawdy: [REJESTR-DECYZJI.md](REJESTR-DECYZJI.md);
> w tym dokumencie naniesione R-06, R-10, R-11, R-14, R-15, R-17, R-18, R-20, R-22, R-23, R-27, R-28, R-30, R-31 (oznaczenia „(R-xx)”)
> oraz doprecyzowania R-33…R-42 z tego samego rejestru.

### 2.1 Nazwy ustawień

> **Rewizja D-02 (2026-10-03):** dwie niezależne analizy potwierdziły wszystkie nazwy – [NAZWY-ANALIZA.md](NAZWY-ANALIZA.md). Kolumna „Propozycja zlecenia” poniżej jest **oficjalną tabelą mapowania** nazw ze zlecenia/załącznika A na nazwy forka (do protokołu odbioru).

| Pakiet | Propozycja zlecenia | **Rekomendacja** | Uzasadnienie |
|---|---|---|---|
| P-01 | `flows.deployResponse` | `deploy.response: "stopped" \| "started"` | wspólny obiekt `deploy` dla P-01/Z-04/Z-05; w `settings.js` nie ma przestrzeni `flows` (są `flowFile`, `flowFilePretty`), a `flows` myli się z plikiem flow |
| P-02 | `editor.staleFlowsPolicy` | `editorTheme.deploy.staleFlows: "prompt" \| "reload-only"` | ustawienia funkcjonalne edytora są w `editorTheme` (`projects`, `multiplayer`); kolizja klucza `editor` występuje **w edytorze**: `RED.settings.get()` najpierw czyta ustawienia użytkownika, a `userSettings.js:353-356` zapisuje `editor` z powrotem do profilu – polityka serwera utrwaliłaby się w profilu użytkownika (korekta: w runtime mapy są rozdzielone) |
| P-03 | `telemetry.locked` | `telemetry.locked` (bez zmian) | obiekt `telemetry` już istnieje w `settings.js` |
| Z-02 | `httpAdminNodeRoutes` | `httpAdminNodeRoutes: "open" \| "authenticated"` (bez zmian) | spójne z `httpAdminRoot`, `httpAdminMiddleware`; API: `RED.auth.publicRoute()` zamiast `RED.auth.public()` (czytelne jako wywołanie, nie właściwość) |
| Z-04 | `flows.putCreates` | `deploy.putCreatesFlow: false` | jw. – obiekt `deploy` |
| Z-05 | `flows.requireRevision` | `deploy.requireRevision: false` | jw. |
| Z-07 | `node.registerRoute` | `node.registerHttpRoute(method, path, ...handlers)` | jednoznaczne (trasa HTTP węzła), odróżnia od tras administracyjnych |
| Z-08 | `health: {enabled, path}` | `health: { enabled:false, path:"/health", port: <opcjonalnie> }` | sondy muszą działać także przy `httpAdminRoot: false` i nie powinny być wystawiane przez publiczny Ingress – opcjonalny osobny port |
| Z-09 | `watchFlows(callback)`, hook `preReload` | bez zmian | spójne z API magazynu i nazwami hooków `pre*`/`post*` |
| Z-10 | typ wtyczki „koordynacja” | typ `node-red-coordination`, API węzłów `RED.coordination` | spójne z istniejącym typem `node-red-library-source` |
| Z-11 | `readOnlyUserDir` | `readOnlyUserDir` (bez zmian) | |
| Z-11 | – | zmienna środowiskowa `NODE_RED_READ_ONLY_USER_DIR` (R-33) | działa w CLI przed wyborem pliku ustawień (kopia `settings.js` do `~/.node-red`); równoważna `readOnlyUserDir: true` (**R-18**); `readOnlyUserDir` chroni także bezwzględny `flowFile` (R-40) |
| Z-14 | – | `editorTheme.flowLayout: { enabled: false }` | wymóg zlecenia 3.2: domyślnie zachowanie jak oficjalne wydanie (bez nowych elementów UI) |
| Z-15 | – | `editorOnly: false` (alternatywa: `runtimeState.autoStart`) | jedno znaczenie: instancja wczytuje flow, nie uruchamia ich i nie zapisuje stanu w magazynie; przy `deploy.response: "started"` odpowiedź `{rev, started: false}` (R-39) |
| P-01 / Z-08 | – | `deploy.startTimeout` (ms), domyślnie wyłączony | limit czasu startu w trybie `deploy.response: "started"`; po przekroczeniu 500 `deploy_start_failed` z `errors[].code: "start_timeout"`, flow startują dalej w tle, wynik w logu (**R-38**); blokada wdrożeń trwa do końca startu (R-43, **R-45**) |
| P-01 | – | `deploy.startTimeoutReleasesLock: false` | `true` (przy ustawionym `startTimeout`) – blokada wdrożeń zwalniana po upływie `startTimeout` w obu trybach odpowiedzi (ostrzeżenie w logu); ryzyko równoległego startu flow przez kolejne wdrożenie; domyślnie blokada do końca startu (**R-45**) |
| Z-06 (#10) | – | `deploy.hookTimeout: 30000` (ms) | jeden limit dla całego łańcucha hooków `preDeploy`, które działają pod blokadą wdrożeń – limit chroni przed zablokowaniem API; w `postDeploy` tylko ostrzeżenie i `abort("timeout")` sygnału, bez przerywania. Zakres: skończona liczba > 0 i ≤ 2147483647; wartość niepoprawna (napis, ≤ 0, `Infinity`) → ostrzeżenie w logu przy starcie i 30000 (walidacja: `deployHooks.isValidHookTimeout`, jedna implementacja); wartość czytana przy każdym wdrożeniu. Hooki rejestruje się **wyłącznie** przez `RED.hooks.add("preDeploy.<etykieta>", fn)` / `"postDeploy.<etykieta>"` (wtyczka, węzeł) – bez zmian w ustawieniu `hooks` (**R-50**) |
| Z-09 | – | `deploy.reload: { watch: false, type: "full" \| "diff", preReloadTimeout: 1200000, concurrency: <opcjonalnie> }` | `type` domyślnie `"full"` (jak dzisiejszy `reload`); dla długich rozmów rekomendowane `"diff"`; `concurrency` wymaga wtyczki koordynacji (Z-10) – tylko wartość liczbowa; bez łączności z koordynatorem przeładowanie czeka, działa stara konfiguracja (R-20); przy `watch: true` błąd rejestracji `watchFlows` → błąd startu (R-36); dodatkowy `preReload` (D-17) poza blokadą – najwyżej jedna runda, potem przeładowanie z ostrzeżeniem (R-36) |
| #8 | – | `deploy.holdHttpNodeRequests: { enabled: false, timeout: 5000, maxPending: 1000, retryAfter: 1 }` | `enabled: false` = zachowanie 5.0.7 (404 w oknie restartu) | żądania do tras węzłów (`httpNode`) **bez istniejącej trasy** wstrzymywane na czas wdrożenia i przeładowania z magazynu (stany E-02 `deploying`/`reloading`), po `timeout` lub `maxPending` → 503 z `Retry-After`; rodzina `deploy.*` (nie `deploy.reload.*` – obejmuje też zwykłe wdrożenie); opis: FORK.md §5 |
| #40 | – | `deploy.drainHttpNodeRequests: { enabled: false, timeout: 30000, retryAfter: 1 }` | `enabled: false` = zachowanie 5.0.7 (bez śledzenia, `stop()` jak dotąd) | przed zatrzymaniem flow runtime czeka (≤ `timeout`, limit twardy – także dla flow niezmienianych, **R-49**) na zapytania przyjęte przez trasy `httpNode` z oznaczonym handlerem (rdzeń: `http in`), po zatrzymaniu odpowiada 503 na otwarte (`http_drain_not_accepted` / `http_drain_outcome_unknown`); rodzina `deploy.*`, symetryczna z `holdHttpNodeRequests` (#8); `timeout` ma inne znaczenie niż `hold.timeout` (limit czekania na S0 i odstęp terminu); w logach i dokumentach „drenaż HTTP” (nie mylić z `preReload`/`preShutdown`); opis: FORK.md §5 |
| Z-09 | – | `deploy.reload.retry: { min: 1000, max: 60000, attempts }` (ms) | ponawianie odczytu magazynu po błędzie, opóźnienie wykładnicze `min`…`max`; po wyczerpaniu `attempts` – stan `failed` i `/ready` 503 (D-18, **R-20**); `attempts` domyślnie **10** (~8 min), potem `failed` (**R-36**) |
| Z-09 (#1) | – | `deploy.reload.retry.onExhausted: "fail" \| "keepReady"` (domyślnie `"fail"`), `deploy.reload.retry.maxStaleTime` (ms, domyślnie 1800000, tylko z `"keepReady"`, `0` = bez limitu) | zachowanie po wyczerpaniu `attempts` odczytów magazynu: `"fail"` – R-36 bez zmian; `"keepReady"` – dla błędu odczytu magazynu (`storage_error`) gotowa instancja zostaje gotowa na poprzedniej rewizji (`/ready` 200 `warn`), błąd raportowany aktywnie; limit nieaktualności chroni przed partycją pojedynczego poda; nazwa `onExhausted` obejmuje tylko odczyt magazynu (odrzucona `health.readyWhenReloadFailed` – sugerowała błąd startu po przeładowaniu, który zawsze zostaje 503); **R-47** |
| Z-10 | – | `coordination: { plugin, options }`; właściwość węzła `inject`: `singleInstance` | wybór wtyczki jak `contextStorage`; domyślnie wtyczka lokalna |
| Z-03 | – | `externalModules.palette.allowUpload` – **nazwa kanoniczna**; `externalModules.palette.upload` i `editorTheme.palette.upload` – przestarzałe aliasy | aliasy nadal honorowane (każde `false` wyłącza upload), ich użycie → ostrzeżenie w logu; w szablonie `settings.js` tylko nazwa kanoniczna (**R-17**) |
| Z-03 | – | `externalModules.palette.allowDowngrade: true` (domyślnie = zachowanie 5.0.6) | `false` blokuje instalację starszej wersji z `.tgz` (rekomendowane w produkcji); domyślna wartość nie zmienia dzisiejszego zachowania (DoD §3) |
| Z-08 | – | `health.host` (opcjonalnie); **`shutdownTimeout`** (płasko, domyślnie wyłączony drenaż – zachowanie 5.0.6); API osadzających `RED.health` | drenaż przy SIGTERM (D-11); nazwa płaska jak `nodeCloseTimeout`/`functionTimeout` – to cykl życia procesu, nie sonda; bez `shutdownTimeout` hook `preShutdown` nie jest wywoływany; brak osobnego limitu `RED.stop()` – ostatecznym limitem jest `terminationGracePeriodSeconds` orkiestratora (R-37) |
| #71 | – | `startupTimeout` (ms, płasko, domyślnie brak) | limit `runtime.start()` (bez wczytania i startu flow); po przekroczeniu błąd `startup_timeout` z polami `step` i `timeout` → ścieżka nieudanego startu #67 (CLI: kod 1); wartość inna niż liczba > 0 i ≤ 2147483647 → ostrzeżenie w logu i brak limitu (jak `deploy.startTimeout`); krok, który skończy się po limicie, jest ignorowany i zwalniany; nazwa płaska jak `shutdownTimeout` – cykl życia procesu (**R-51**) |
| #48 | – | `httpInMaxBodySize` (rozmiar jak pole „Max body size”, płasko, domyślnie brak); pochodna flaga `httpInMaxBodySizeEnabled` (tylko `true`, eksportowana do edytora, nie do wpisywania) | domyślny limit ciał węzłów `http in` metod POST, PUT, PATCH, DELETE: surowe ciało (zamiast `apiMaxLength`), całe ciało uploadu multipart, ciała tekstowe i binarne węzłów bez opcji; nie dotyczy JSON i urlencoded (nadal `apiMaxLength`); pole węzła podnosi lub obniża limit (podniesienie – ostrzeżenie węzła); niepoprawna wartość → jedno ostrzeżenie i brak limitu domyślnego (fail-open, decyzja właściciela); bez ustawienia zachowanie i `/settings` bez zmian; surowa wartość nigdy nie trafia do `/settings` |
| Z-16 | – | `health.unreadyGrace` (ms), domyślnie wyłączone (zgłoszenia #8, #1) | czas, przez który `/ready` odpowiada 503 PRZED zatrzymaniem flow przy planowanym zatrzymaniu (SIGTERM – Z-08, przeładowanie z magazynu – Z-09); liczony od początku planowanego zatrzymania/przeładowania (najpóźniej wtedy `/ready` odpowiada 503; instancja już niegotowa czeka pełny czas ponownie), równolegle z hookami `preShutdown`/`preReload`, w limitach `shutdownTimeout`/`preReloadTimeout`; nie dotyczy wdrożenia z edytora/Admin API; leży pod `health`, bo dotyczy kontraktu gotowości, nie cyklu życia procesu; wymaga `health.enabled` |
| Z-08 / Z-09 (#7) | – | `hooks: { "preReload.<etykieta>": fn, "preShutdown.<etykieta>": fn }` (płasko, domyślnie brak) | rejestracja hooków z `settings.js` przy `init` runtime, przed wtyczkami; identyfikator `nazwa.etykieta` jak w `RED.hooks.add`; dozwolone tylko `preReload` i `preShutdown`; niepoprawny klucz lub wartość = błąd startu `invalid_hook_setting` (komunikat bez i18n – katalog `runtime` jest ładowany w `start`); `hooks` na liście kluczy zarezerwowanych (§2.1a); **zasada W7 (R-50):** z `settings.js` (`hooks`) wolno rejestrować wyłącznie hooki **cyklu życia procesu i przeładowania** (`preShutdown`, `preReload`); hooków ścieżki komunikatów (`onSend`, `preRoute`, …) i potoku wdrożenia (`preDeploy`, `postDeploy`) – nigdy bez nowej decyzji w rejestrze; wpis `hooks: {"preDeploy.x": …}` nadal kończy start błędem `invalid_hook_setting` |
| E-02 | – | zdarzenie `instance:state` `{state, previous, reason}`, odczyt `runtime.state`; `RED.stop(reason)` | jedno źródło stanu dla P-01, Z-08, Z-09, Z-15; stany: `init, starting, ready, deploying, reloadPending, reloading, idle, loaded, failed, stopping, stopped` – kontrakt w [MIGRACJA.md](MIGRACJA.md) (**R-23**) |
| P-04 / D-07 | – | `httpAdminCommsOrigins: ["https://…"]` (R-33) | kontrola nagłówka `Origin` przy połączeniu `/comms`; brak ustawienia = zachowanie 5.0.7 (bez kontroli, ostrzeżenie w logu przy starcie); ustawiona lista – tylko wymienione źródła oraz własne źródło edytora; w naszych instalacjach lista zawsze ustawiona (**R-06**, **R-35**); nazwa z rodziny `httpAdmin*` (D-02), bo `/comms` działa pod `httpAdminRoot` |
| Z-12.10 | – | `editorTheme.embedding.allowedOrigins` (R-33; zamiast `…embedding.postMessage.allowedOrigins`) | lista źródeł dla `postMessage` osadzonego edytora; obejmuje także istniejący kanał `set-theme` (**R-28**); brak ustawienia = zachowanie 5.0.7 (bez kontroli, ostrzeżenie w logu przy starcie); ustawiona lista – tylko wymienione źródła; w naszych instalacjach lista zawsze ustawiona (**R-35**) |
| Z-12.02 | – | `editorTheme.auth.tokenStorage: "local" \| "session"`, domyślnie `"local"` | miejsce przechowywania tokenu w przeglądarce; `"local"` = zachowanie 5.0.7, `"session"` – token w `sessionStorage` (R-26, **R-33**) |
| Z-12.08 | – | uprawnienia `nodes.type.<typ>` / `!nodes.type.<typ>` | obie listy: odbierające (`!nodes.type.<typ>`) i dozwolonych (`["!nodes.type.*", "nodes.type.inject", …]`); przyznanie konkretnego typu ma pierwszeństwo przed `!nodes.type.*`, odebranie konkretnego typu – przed wszystkim; przeładowanie z magazynu (Z-09) nie jest kontrolowane per użytkownik (R-27, **R-42**) |
| Z-12 | – | `RED.header`, `RED.dialog`, `RED.deploy.addMenuItem`, hook edytora `deployPre` | `RED.header`, `RED.dialog` przyjęte (R-43); `addMenuItem`, `deployPre` – poza Z-12 (R-24) |

### 2.1a Krytyczne sprawdzenie nazw (D-02, wynik)

Sprawdzone w szablonie `packages/node_modules/node-red/settings.js` i w kodzie (runtime, editor-api, editor-client, registry):

| Nazwa | Kolizja / konwencja | Wynik |
|---|---|---|
| `deploy.*` | brak klucza `deploy` w ustawieniach i kodzie runtime; obiekty grupujące mają precedensy (`runtimeState`, `telemetry`, `externalModules`) | **przyjęte** |
| `editorTheme.deploy.staleFlows` | `editorTheme` ma już m.in. `palette`, `projects`, `codeEditor`, `deployButton` (wygląd przycisku) – `deploy` jako osobny obiekt zachowania, nie wyglądu | **przyjęte**; w dokumentacji odróżnić od `deployButton` |
| `telemetry.locked` | obiekt `telemetry` istnieje w szablonie | **przyjęte** |
| `httpAdminNodeRoutes` | spójne z rodziną `httpAdmin*` (`httpAdminRoot`, `httpAdminMiddleware`, `httpAdminCookieOptions`) | **przyjęte** |
| `health: {enabled, path, port, host}` | brak kolizji; struktura jak `diagnostics: {enabled, ui}` | **przyjęte** |
| `health.shutdownTimeout` | zatrzymanie procesu to nie sonda; płaskie limity czasu w projekcie: `nodeCloseTimeout`, `functionTimeout`, `globalFunctionTimeout` | **zmienione na `shutdownTimeout`** |
| `startupTimeout` (#71) | start procesu to cykl życia, nie sonda ani wdrożenie – płasko jak `shutdownTimeout`; nie `startTimeout`, bo `deploy.startTimeout` (R-38) to limit startu flow przy wdrożeniu; „startup” jak przyczyna stanu `startup-error`; brak kolizji w kodzie i szablonie | **przyjęte** (R-51) |
| `httpInMaxBodySize` (#48) | ustawienie węzła – konwencja `httpRequestTimeout`, `execMaxBufferSize`; prefiks `httpIn` wymagany przez `registerNodeSettings` dla typu `http in`; te same słowa co pole węzła `maxBodySize`; odrzucone `httpNodeMaxLength` i `httpNodeMaxBodySize` (rodzina `httpNode*` obejmuje wszystkie trasy węzłów, a limit jest tylko w `http in`; „MaxLength” znaczy w projekcie bajty, znaki albo liczbę); brak kolizji w kodzie i szablonie | **przyjęte** (decyzja właściciela OQ-1, 2026-10-06) |
| `readOnlyUserDir` | **istnieje nieudokumentowane `readOnly`** używane przez magazyn plikowy (`storage/localfilesystem/index.js:49,59`, `library.js:148`) – po cichu pomija zapis | **przyjęte**; zmiana znaczenia `readOnly` złamałaby zgodność – w Z-11 opisać relację: `readOnlyUserDir` obejmuje cały runtime i zgłasza błąd zamiast cichego pominięcia; `readOnly` bez zmian |
| `editorOnly` | symetryczne do istniejącego `disableEditor` (płaskie, boolean) | **przyjęte**; `editorOnly` + `disableEditor` jednocześnie = błąd konfiguracji przy starcie |
| `coordination: {plugin, options}` | wzorzec jak `contextStorage`; typ wtyczki jak `node-red-library-source` | **przyjęte** |
| `externalModules.palette.allowDowngrade` | spójne z `allowInstall`, `allowUpdate`, `allowUpload` | **przyjęte** (domyślnie `true` = 5.0.6) |
| `editorTheme.flowLayout` | spójne z `editorTheme.codeEditor`, `markdownEditor` | **przyjęte** |
| hooki `preDeploy`, `postDeploy`, `preReload`, `preShutdown` | konwencja `pre*/post*` jak `preInstall/postInstall` | **przyjęte** (rozszerzenie `VALID_HOOKS`) |
| `RED.auth.publicRoute()`, `node.registerHttpRoute()`, `RED.coordination` | brak kolizji w API węzłów (`registry/lib/util.js`); `registerRoute` dwuznaczne z trasowaniem komunikatów (`preRoute`) | **przyjęte** |
| klucze zarezerwowane | reguła prefiksu `registerNodeSettings` (`runtime/lib/settings.js:127-158`): węzeł o typie `deploy`, `flows`, `health`, `coordination`, `hooks` mógłby wyeksportować cały obiekt ustawień do edytora | **dodać listę kluczy zarezerwowanych** (odrzucenie rejestracji takiego ustawienia węzła) |
| kody błędów `snake_case` | jak istniejące `version_mismatch`, `module_already_loaded`, `invalid_request` | **przyjęte** |

### 2.2 Wersja bazowa
Zlecenie wskazuje `5.0.6`. Wydanie `5.0.7` zawiera poprawki bezpieczeństwa (migracja na załataną
bibliotekę JSONata, aktualizacja `body-parser`). **Decyzja D-01: baza `5.0.7`.**

### 2.3 Kontrakt potoku wdrożenia (zadanie E-01)
Pakiety P-01, Z-04, Z-05, Z-06, Z-08, Z-09, Z-15 oraz nasze FL-B-001/FL-B-002 zmieniają te same funkcje
(`runtime/lib/api/flows.js`, `runtime/lib/flows/index.js`, `editor-api/lib/admin/flow(s).js`).
Wspólna kolejność kroków (rozstrzygnięcia K-1…K-3 z [PRZEGLAD.md](PRZEGLAD.md) – **propozycja do zatwierdzenia**;
uzupełniona o decyzje R-10, R-11, R-14, R-15, R-22, R-23, R-27):

- **Wspólna blokada (R-11):** `POST /flows`, `POST /flows/state` (start/stop flow) i przełączenie projektu wykonują się
  pod tą samą blokadą wdrożeń (`runtime/lib/flows/lock.js`); druga operacja czeka na zakończenie pierwszej.
  Blokada trwa do końca startu nowych flow (krok A8, R-43), także gdy odpowiedź HTTP wraca wcześniej i po przekroczeniu
  `deploy.startTimeout`; zwolnienie po limicie tylko przy `deploy.startTimeoutReleasesLock: true` (R-45).
- **Hooki (R-15, doprecyzowane w R-50 – #10):** `preDeploy` – tylko walidacja (bez modyfikacji treści), limit `deploy.hookTimeout` (30 s);
  `postDeploy` – asynchronicznie, błąd tylko w logu; **brak hooków** `preDeploy`/`postDeploy` przy starcie procesu
  (wczytanie flow z magazynu) i przy operacjach Projektów (`POST /flows/state`, przełączenie projektu). Rejestracja tylko
  przez `RED.hooks.add`; wykonanie przez `flows/deployHooks.js` na podstawie akcesora `hooks.handlers(id)` (nie przez
  `hooks.trigger`, który zostaje bez zmian). `POST /flows` w trybie Projektów jest wdrożeniem (hooki działają).

**A. Wdrożenie przez Admin API lub wywołanie wewnętrzne** (`/flows`, `/flow`, `/flow/:id`, typ `reload`):
```
 1. przyjęcie żądania (źródło: api | internal)
       #84: instancja w stanie `stopping`/`stopped` (`state.isStopping()`) → 503 `runtime_stopping` (`pipeline.stoppingError()`,
       stały komunikat), PRZED czekaniem na blokadę i przed odczytem treści żądania; nic się nie zmienia (bez odczytu magazynu,
       zapisu, poświadczeń, zatrzymania, startu, `runtime-deploy`, `preDeploy`, `postDeploy`, zmiany stanu); audyt z kodem
 ── blokada wdrożeń (runtime/lib/flows/lock.js) ─────────────────────────────────
    #84: ta sama odmowa jako pierwsza pod blokadą (wygrywa z błędami kroku 2, 403 i hookiem – D8)
 2. kontrola rewizji            – istniejące 409 version_mismatch; Z-05 version_required (także klient v1 przy
       requireRevision – R-14; DELETE /flow/:id wymaga ?rev= – R-14); Z-04 rewizja flow
       (typ reload: zwolniony z wymogu rewizji – R-14; odczyt magazynu tutaj, pod blokadą, PRZED preDeploy – R-11 – także typ `load` przy zarejestrowanym `preDeploy`: ignoruje treść żądania i wdraża zawartość magazynu, więc jest walidowany na tej zawartości jak reload, R-C1;
        preDeploy w kroku 3 widzi treść, która zostanie uruchomiona; krok 2 tylko CZYTA: `readStoredFlows()` – bez zmiany
        poświadczeń i bez zdarzenia `runtime-state`, #10 D15)
       `/flow`: sprawdzenie rewizji i budowa nowej konfiguracji (`build*FlowConfig`) – funkcja `prepare` w `pipeline.deploy` –
        też tutaj, przed krokiem 3 i 4 (#10, U1): odrzucone żądanie (409, 404, `duplicate_id`, `invalid_flow_id`, 400 `global`)
        nie przechodzi przez stan `deploying`, nie emituje `instance:state`, nie wstrzymuje `/ready` i nie unieważnia
        oczekującego przeładowania Z-09 (dawniej robiło to w kroku `apply`, po kroku 4)
 2a. kontrola uprawnień do typów węzłów – Z-12.08: dodane/zmienione węzły typu niedozwolonego dla użytkownika
       (odebrany `nodes.type.<typ>` lub brak przyznania przy `!nodes.type.*`) → 403 node_type_not_permitted,
       odrzucenie całego wdrożenia, bez zapisu (R-27, R-42); typ reload – bez kontroli (brak użytkownika; R-42)
 3. hook preDeploy              – Z-06 (#10, R-15, R-50); tylko walidacja (zamrożona kopia wynikowej konfiguracji, bez `credentials`
       i bez `value` wpisów `env` typu `cred`), pod blokadą, wywoływany najwyżej raz na wdrożenie, jeden limit `deploy.hookTimeout`
       dla łańcucha; handlery po kolei w kolejności rejestracji, pierwszy wynik inny niż akceptacja kończy łańcuch:
         • `undefined` albo wartość ≠ `false` (także w obietnicy), `done()` → akceptacja;
         • `false` / `done(false)` albo `Error` ze `status: 400` → 400 `deploy_rejected` {message, reason = `err.code`, details?} –
           to jedyne odrzucenie zamierzone;
         • każdy inny wynik (wyjątek, `Promise.reject()`, `done("x")`, mutacja zamrożonej kopii) → 503 `deploy_hook_failed`
           (stały komunikat, przyczyna tylko w logu; fail-closed);
         • brak wyniku przed `deadline` → 503 `deploy_hook_timeout`; także od razu (bez wywołania), gdy poprzednie, spóźnione wywołanie
           tego samego handlera jeszcze trwa (SEC-103: najwyżej jedno spóźnione wywołanie `preDeploy` na handler);
       odpowiedź budowana od nowa z białej listy i oczyszczona (znaki sterujące, C1, U+2028/9, nadpisania dwukierunkowe; `message` ≤ 1000,
       `reason` `[A-Za-z0-9_.:-]{1,64}`, `details` obiekt/tablica ≤ 8 KB). Przy odrzuceniu, awarii i limicie nic się nie zmienia (brak
       zapisu, zatrzymania, stanu, drenażu, wstrzymywania, poświadczeń, `runtime-deploy` i `postDeploy`), blokada jest zwalniana.
       Bez handlera: brak kopii, timera i wywołania akcesora. To nie jest granica bezpieczeństwa (R-50, SEC-105)
 3→3a. #84: odmowa 503 `runtime_stopping`, gdy instancja zaczęła się zatrzymywać w krokach 2–3 (np. handler `preDeploy`)
 3a. (tylko `reload` oraz `load` przy zarejestrowanym `preDeploy`) poświadczenia i `runtime-state` – `loadStoredCredentials()`: załadowanie poświadczeń odczytanej konfiguracji i
       zdarzenie `runtime-state` (retain), PO hooku, przed stanem `deploying` (#10, D15) – odrzucony `reload` niczego nie zmienia;
       błąd `credentials_load_failed` (Projekty) pojawia się po hooku, przed `deploying`, jak dotąd przed `deploying`
 4. stan = "deploying"          – E-02 / Z-08 (/ready → 503); #84: `begin()` zwraca `null` (stan `stopping` w kroku 3a) →
       odmowa 503 `runtime_stopping`, nic nie zapisano
 5. zapis do magazynu           – (typ reload: brak zapisu – treść odczytana w kroku 2)
 6a. drenaż zapytań HTTP        – #40 (R-49), tylko z `deploy.drainHttpNodeRequests.enabled`: `httpDrain.beforeStop()` czeka (≤ `timeout`, pod
       blokadą) na zapytania PRZYJĘTE przez trasy `httpNode` z oznaczonym handlerem; nie czeka w stanie `stopping`; nie odrzuca
 6. zatrzymanie zmienionych węzłów
       tryb domyślny: jak 5.0.6 (błędy zatrzymania połykane – D-05);
       tryb deploy.response="started": błąd zatrzymania → 500 deploy_stop_failed (z rev)
 6b. odpowiedzi na otwarte zapytania – #40: `httpDrain.afterStop(scope)` (nie rzuca; także po błędzie kroku 6): zakres pełny (typ `full`,
       `globalConfigChanged`, `setState` stop, `RED.stop`, projekty) – 503 wszystkim otwartym zapytaniom z dopasowaną trasą; zakres
       częściowy (`nodes`/`flows`) – tylko tym po terminie (P1: twardy limit, także flow niezmieniane); okno zapytań trwa do końca
       kroku 8 (stan `deploying`/`reloading`) – zapytania przychodzące w oknie dostają termin; strażnik odpowiada 503 po terminie także po zamknięciu okna (limit twardy, A18) – zapytania spoza okna terminu nie mają
 7. start nowych węzłów         – Z-15 editorOnly: krok pominięty; tryb "started" → odpowiedź {rev, started: false} (R-39)
       #84: wdrożenie, które przeszło krok 4, zanim instancja zaczęła się zatrzymywać: krok 6 w zakresie wdrożenia (D5 po poprawce:
       zatrzymanie samego wdrożenia – `isDeploy === true` – nie jest pełne; zatrzymuje tylko to, co wdrożenie zmienia – przy `full` wszystko –
       przy wyłączonym drenażu po trwającym `stopNow()`, przy włączonym ścieżką #82 bez przerywania czekania zatrzymania procesu; po nim
       `started` jest `false` i jest emitowane `runtime-state` stop `deploy: true`, a niezmienione flow działają do `RED.stop`, które
       zatrzymuje resztę; `/ready` odpowiada już 503), start pominięty (`start()`
       zwraca `{errors: [{code: "runtime_stopping"}], flowsRunning: false, reason: "stopping"}`, jeden log `info`, bez zdarzeń
       `flows:started`/`nodes-started`/`runtime-state` start); tryb domyślny 200 `{rev}`, `runtime-deploy` z rewizją; tryb "started"
       500 `deploy_start_failed` z `errors[].code: "runtime_stopping"`; `postDeploy` `start.status`: `not_started` (zatrzymanie
       zaczęło się przed wynikiem), `pending` (po wyniku), `start_failed` (tryb "started")
 8. stan = "ready" (lub "failed" przy błędzie startu)
 ── koniec blokady ─────────────────────────────────────────────────────────────
 9. zdarzenie runtime-deploy (edytory)
10. ODPOWIEDŹ HTTP
       deploy.response="stopped" (domyślnie): odpowiedź już po kroku 6, kroki 7–9 kończą się asynchronicznie (jak 5.0.6)
       deploy.response="started": odpowiedź po kroku 9; błąd startu → 500 deploy_start_failed (z rev i errors[] – konfiguracja
       jest zapisana; R-10). Błąd startu = brakujące typy, brakujące moduły, safe mode, wyjątki startu flow – bez błędów
       konstruktorów pojedynczych węzłów (R-10); limit czasu startu – deploy.startTimeout (domyślnie wyłączony):
       po przekroczeniu 500 deploy_start_failed z errors[].code "start_timeout", flow startują dalej w tle (R-38)
       tryb domyślny: odrzucenie start() jest logowane (dziś połykane) – poprawka błędu (R-10)
11. hook postDeploy             – Z-06 (#10, R-50); `setImmediate` po wyniku, bez `await`: dokładnie raz dla każdej ZAPISANEJ albo przeładowanej
       konfiguracji – także gdy wdrożenie zakończyło się potem błędem – i nigdy dla niezapisanej (odrzucenie, limit, 409/400, błąd zapisu).
       Fakt „zapisano” = podmiana aktywnej konfiguracji (`flows.getFlows()` zwraca ten sam obiekt do chwili zapisu albo odczytu),
       odczytana pod blokadą po kroku 4 (`savedSince`), nie lista kodów błędów. Handlery równolegle (start w kolejności rejestracji),
       błąd tylko w logu (nie cofa wdrożenia), wartości zwracane ignorowane; najwyżej 10 niezakończonych wywołań na handler (potem
       pominięcie z ostrzeżeniem). Zdarzenie: `{rev, type, source: "api"|"internal"|"storage", operation, flowId, user, reloadType?,
       start: {status, errors?}, error?: {code}, deadline, signal}`. W trybie domyślnym w chwili wywołania stan to jeszcze `deploying`
       (start trwa); ostateczny wynik – `instance:state` i `deploy-start-result` (#22).
       Słownik `start.status`: `started` (tryb `"started"`, flow wystartowały) · `pending` (tryb domyślny z zarejestrowanym startem, albo
       `deploy_start_failed` z wpisem `start_timeout` + `errors` – to nie porażka, R-38) · `not_started` (`editorOnly`, flow zatrzymane,
       albo połknięty błąd zatrzymania w trybie domyślnym, D-05) · `start_failed` (`deploy_start_failed` bez `start_timeout`, `errors`) ·
       `stop_failed` (tylko tryb `"started"`) · `unknown` (nieoczekiwany błąd samego kroku wdrożenia po zapisie; kod w `error`). Nieoczekiwany
       błąd po zapisie niezwiązany ze startem zostawia status zarejestrowanego startu i jest podany osobno w `error: {code}`.
       Pętle: handler publikujący zmianę do innych instancji MUSI pomijać `source === "storage"`; handler, który sam wdraża, tworzy
       nieskończoną pętlę wdrożeń (SEC-104)
```

**B. Przeładowanie po zmianie w magazynie** (Z-09, `watchFlows`):
```
 1. powiadomienie (sygnał do odczytu; przeładowanie, gdy rewizja != aktywna lub skrót poświadczeń != aktywny, #2) – koalescencja: kolejne powiadomienia w trakcie = jedno następne przeładowanie
 2. stan = "reloadPending" (bez blokady); koordynacja: zajęcie slotu przeładowania (deploy.reload.concurrency, Z-10)
 3. hook preReload (bez blokady) – czeka na zakończenie pracy w toku, limit deploy.reload.preReloadTimeout;
       /ready → 503 od tej chwili (drenaż)
    Jeśli w tym czasie przyjdzie wdrożenie (A) na tej instancji – oczekujące przeładowanie jest unieważniane
    (wdrożenie samo ustala nową konfigurację).
 ── blokada wdrożeń ─────────────────────────────────────────────────────────────
 4. ponowny odczyt magazynu (najnowsza rewizja)
 5. stan = "reloading" – #84: instancja w stanie `stopping`/`stopped` już przy wejściu pod blokadę (zamiast `superseded`) albo
       `begin("reload")` zwraca `null` (instancja zaczęła się zatrzymywać w trakcie odczytu) →
       `pipeline.deploy` zwraca `{skipped: "stopping"}` przed `flows.reloadFromStorage` i faktami `postDeploy`; `flows/reload.js`
       kończy cykl po cichu (bez `readFailed`, `markReloadFailed`, `cycleSucceeded`, dodatkowej rundy); kroki A6–A8, w tym 6a/6b (type "full": wszystkie flow; "diff": tylko zmienione)
       drenaż HTTP (#40) jest PO hookach `preReload` i dodatkowej rundzie D-17 (poza blokadą, bez zatrzymania), pod blokadą, raz na
       `stop()` – bez podwójnego drenażu i podwójnej odpowiedzi; najgorszy czas przeładowania = czekanie na blokadę (drenaż poprzedniej
       operacji + `nodeCloseTimeout` + start) + `preReloadTimeout` + `deploy.drainHttpNodeRequests.timeout` + `nodeCloseTimeout` + start;
       `PreReloadEvent.deadline` NIE jest już najpóźniejszą chwilą zatrzymania flow; slot Z-10 jest trzymany i odnawiany przez cały
       drenaż HTTP (przejście klastra wydłuża się o N × `timeout`; zalecane `deploy.reload.concurrency`)
 ── koniec blokady ──
 6. zdarzenie runtime-deploy; hook postDeploy (source: "storage"); BEZ preDeploy
    (zmianę zatwierdziła instancja, która ją zapisała – jej preDeploy już się wykonał). `postDeploy(storage)` tylko gdy przeładowanie
    doszło do stanu `reloading` i podmieniło aktywną konfigurację; fakt „zapisano” odczytany pod blokadą po `begin("reload")`
    (D22/A31): przeładowanie unieważnione przez wdrożenie na tej instancji, pominięte albo runda D-17 bez decyzji nie dają `postDeploy`.
    `preDeploy` chroni zapisy przez API tej instancji, nie treść magazynu (D20): treść odrzucona przy `reload` może trafić do flow
    przez Z-09 albo przy restarcie procesu
```

**C. Zatrzymanie procesu** (Z-08, D-11): SIGTERM/SIGINT → stan `stopping` (/ready 503, nieodwracalny) →
hook `preShutdown` / oczekiwanie do `shutdownTimeout` → `RED.stop(reason)` → zamknięcie serwera HTTP → wyjście.
Bez ustawionego `shutdownTimeout` – zachowanie 5.0.6 (natychmiastowe zatrzymanie, hook `preShutdown` nie jest wywoływany – R-37).
Brak osobnego limitu `RED.stop()` – ostatecznym limitem jest `terminationGracePeriodSeconds` orkiestratora (R-37).

- **Drenaż HTTP przy zatrzymaniu procesu (#40, R-49):** `markStopping` NIE przerywa trwającego drenażu wdrożenia – przerywa go dopiero
  `RED.stop` → `stopFlows()` (`httpDrain.abortWait()`), więc przy `shutdownTimeout` drenaż wdrożenia trwa w czasie `preShutdown`/`unreadyGrace`.
  Własne zatrzymanie `RED.stop` (stan `stopping`) nie czeka na zapytania (R-37): po zatrzymaniu flow `httpDrain.finalize()` (po
  `stopFlows()`, także gdy ten odrzucił; niezależny od `started`; nie rzuca; przy wyłączonym ustawieniu kończy się od razu) odpowiada 503
  albo niszczy odpowiedź (strumień) na zapytania, które były otwarte w chwili wywołania. Wdrożenie w stanie `stopping` (token `null`) też nie
  czeka, pozostałe zapytania obejmuje `finalize`; po `finalize` nie ma otwartego zapytania przyjętego przed `finalize`. Faza 2: czekanie
  na zapytania w `shutdownTimeout` (część HTTP w `health.shutdown`).
- **Wyścig `RED.stop` z wdrożeniem i startem (#84):** w stanie `stopping`/`stopped` żadne wdrożenie, przeładowanie ani start nie tworzy
  ani nie uruchamia flow: wdrożenia i `POST /flows/state` start – 503 `runtime_stopping` (A1, pod blokadą, po kroku 3, w kroku 4);
  przeładowanie z magazynu – `{skipped: "stopping"}` (B5); `start()` (wdrożenie po kroku 4, pierwszy start w drenażu `shutdownTimeout`,
  zmiana projektu, późny typ węzła) – sprawdzenie przed `started = true`, po fazie modułów, przed każdym `Flow.start` i przed zgłoszeniem
  startu. Zatrzymanie flow wywołane w tym stanie przez `RED.stop` → `stopFlows()`, `POST /flows/state` stop albo zmianę projektu jest
  pełne: czeka na trwające zatrzymanie (drenaż włączony: `stopInProgress`; wyłączony: `stopNowRunning`) i na wszystkie flow, które starty
  właśnie uruchamiają (każde najwyżej `nodeCloseTimeout`, potem jedno ostrzeżenie `nodes.flows.start-wait-timeout` na flow; z
  `deploy.startTimeoutReleasesLock` mogą to być dwa starty naraz), nigdy na instalację modułów ani blokadę wdrożeń; potem zatrzymuje
  wszystkie istniejące flow w zakresie pełnym, także gdy `started` jest `false` (flow zostawione przez wdrożenie częściowe). `RED.stop()`
  rozwiązuje się po zamknięciu ich węzłów. Zatrzymanie samego wdrożenia (`setFlows`, `isDeploy === true`) zachowuje swój zakres (krok 6
  wyżej). Flow zatrzymane, zanim skończył się jego `Flow.start` (po limicie), jest zatrzymywane ponownie, gdy ten start się skończy – węzły
  utworzone przez start po limicie są wtedy zamykane (każdy raz). Wdrożenie `full` (także przeładowanie `full` po `begin`) w trakcie
  okresu łaski zatrzymania zatrzymuje wszystko i niczego nie uruchamia. Zmiana projektu w trakcie zatrzymania nie jest odrzucana (flow
  przełączonego projektu startują po restarcie).
- **`POST /flows/state` stop i przełączenie projektu (#40):** `setState` stop (pod blokadą) wykonuje 6a → zatrzymanie pełne → 6b; przełączenie
  projektu idzie przez `stopFlows()` bez argumentów (zakres pełny; start nowego projektu nie ma okna, jak w wersji bazowej). Przy tych
  operacjach `/ready` odpowiada 200 przez cały drenaż (D9; bez nowego mapowania R-23) – zapytania po zatrzymaniu dostają 503 albo 404.

- `RED.stop(reason)` – powód (np. `"SIGTERM"`) trafia do hooka `preShutdown`, logu i pola `reason` zdarzenia `instance:state` (R-23).
- Drenaż domyślnie wyłączony – bez `shutdownTimeout` jak dotąd (R-22).
- **Drugi SIGTERM** w trakcie drenażu → natychmiastowe zatrzymanie (bez czekania na `shutdownTimeout`) (R-22).
- Zamknięcie serwera HTTP – **tylko przy `health.enabled`** (R-22); bez tego – zachowanie 5.0.7.
- Odpowiedź sondy w stanie niegotowości: **stała treść 503 `{"status":"unavailable"}`** – bez ujawniania nazwy stanu (R-22).

#### Mapa kroków potoku (E-01)

Stan po E-01 (`30a786d`); ścieżki względem `packages/node_modules/@node-red/runtime/lib/`. „Kotwica” = komentarz w kodzie,
w którym pakiet dopisuje swój krok (bez pustych hooków).

| Krok | Funkcja | Pakiet |
|---|---|---|
| A1 | `api/flows.js` `setFlows`/`addFlow`/`updateFlow`/`deleteFlow` → `flows/pipeline.js` `deploy({type, source:"api", …})` (dokładnie raz) | E-01 |
| blokada | `flows/lock.js` `runExclusive` – w `pipeline.deploy`, `api/flows.js` `setState`, `storage/localfilesystem/projects/index.js` `withDeployLock` (`reloadActiveProject`, `setActiveProject`, `setBranch`, `pull`, `revertFile`, `resolveMerge`, `abortMerge`, `commit` kończący scalanie, `initialiseProject`, `updateProject`: zmiana plików i przeładowanie w jednej sekcji); `holdUntil(promise)` – blokada trwa po zakończeniu sekcji do rozstrzygnięcia obietnicy (start flow, R-43) | E-01 (R-11, R-43); Z-09 (B4–B5) |
| A2 | `pipeline.deploy` → `checkRevision` (409 `version_mismatch`); `/flow`: `opts.prepare()` (rewizje + `build*FlowConfig`, #10); `reload`: `flows/index.js` `readStoredFlows()` pod blokadą (tylko odczyt, #10 D15) | E-01; Z-04, Z-05; Z-06 |
| A2a | kotwica w `pipeline.deploy` | Z-12.08 (R-27) |
| A3 | `pipeline.deploy` → `flows/deployHooks.js` `runPreDeploy` (`reload` – po odczycie A2); handlery z akcesora `util/lib/hooks.js` `handlers(id)` | Z-06 (#10) |
| A3a | `pipeline.deploy` → `flows/index.js` `loadStoredCredentials()` (tylko `reload` oraz `load` przy zarejestrowanym `preDeploy`; po hooku, przed A4) | Z-06 (#10, D15) |
| A4, A8 | kotwice w `pipeline.deploy`; A8 wykonuje się po zakończeniu startu (obietnica startu zarejestrowana przez `setFlows` w `lock.holdUntil`), blokada zwalniana po starcie także przy błędzie (R-43) | E-02, Z-08 |
| A5–A7 | `flows/index.js` `setFlows(…, deployOpts, loaded)` (zapis → `stop` → `context.clean` → `start` asynchronicznie, zarejestrowany w `lock.holdUntil`); `/flow`: krok `apply(deployOpts, prepared)` → `addFlow`/`updateFlow`/`removeFlow(…, {built})` = `setFlows` (konfiguracja zbudowana w `prepare`, A2); `reload`: `load(true, deployOpts, loaded)` | E-01; P-01 (`deployOpts.waitForStart`, punkt rozszerzenia w `setFlows`), Z-04 (`build*FlowConfig`), Z-15 |
| A7 (wynik) | `flows/index.js` `start()` → `{errors: [{code: "missing_types" \| "missing_modules" \| "flow_start_failed", …}]}` | E-01; P-01 (+ `safe_mode`, `start_timeout`) |
| A9 | `flows/index.js` `setFlows` – zdarzenie `runtime-deploy` po `start()` | bez zmian |
| A10 | wynik `pipeline.deploy` (`{rev}` lub `{result}` kroku `apply`) → `api/flows.js` | E-01; P-01 |
| A11 | `pipeline.deploy` → `flows/deployHooks.js` `notifyPostDeploy` (fakty zebrane pod blokadą: `postFacts`, `classifyStart`; wywołanie po sekcji blokady, `setImmediate`); B6: `pipeline.reloadFromStorage` | Z-06 (#10) |
| B | `readFlowsFromStorage()` + `pipeline.deploy({type:"reload", source:"storage", loaded})` (bez ponownego odczytu) | Z-09 |
| A6a, A6b | `flows/index.js` `stop()` – opakowanie przy włączonym `deploy.drainHttpNodeRequests`: `httpDrain.beforeStop()` → `stopNow()` (dotychczasowa treść `stop()`, bez zmian) → `httpDrain.afterStop(scope)` (`runtime/lib/httpDrain.js`). **Semantyka `stopInProgress`:** serializuje zatrzymania tylko przy włączonym ustawieniu; kolejne `stop()` czeka (`.then(f, f)` – odrzucenie pierwszego NIE przechodzi na kolejne) i wykonuje się ponownie (no-op przy zatrzymanych flow); w stanie `stopping` kolejne `stop()` wywołuje `abortWait()`; `stopInProgress` jest czyszczony zawsze (`afterStop` nie rzuca); handler `type-registered` nie startuje flow, gdy `stopInProgress` (log `debug`). Przy wyłączonym ustawieniu `stop()` = `stopNow()`, wołane synchronicznie jak dotąd. #84: w stanie `stopping`/`stopped` `stop()` bez `isDeploy === true` = `stopAll()` (czeka na `stopInProgress`, `stopNowRunning` – obietnicę trwającego `stopNow()` przy wyłączonym drenażu, tylko przypisywaną – i na każde uruchamiane flow, potem zatrzymanie pełne); zatrzymanie wdrożenia (`isDeploy === true`) zachowuje zakres i ścieżkę #82, przy wyłączonym drenażu wykonuje się po `stopNowRunning` (tylko w stanie końcowym); `stopInProgress` zachowuje znaczenie #82 (`checkTypeInUse` i handler `type-registered` czytają tylko je) | #40 (R-49), #84 |
| `RED.stop` | `runtime/lib/index.js` `stop()`: po `redNodes.stopFlows()` (także po odrzuceniu) `httpDrain.finalize()`; `stopFlows()` w stanie `stopping` zatrzymuje wszystkie flow (#84) | #40 (R-49), #84 |
| `setState`, Projekty | tylko blokada – bez kroków A2–A5 i bez hooków (R-11, R-15); zatrzymanie flow przechodzi przez A6a/A6b (#40) | E-01 |

### 2.4 Katalog kodów błędów (propozycja)

`version` w kodach błędów oznacza **rewizję flow (`rev`)**, nie wersję API. Konwencja: `snake_case` we wszystkich polach `code` (także `errors[].code` z E-01); odpowiedź
`{ code, message, rev? }`; istniejące kody bez zmian.

| Kod | HTTP | Pakiet | Kiedy |
|---|---|---|---|
| `version_mismatch` | 409 | istniejący, Z-04 | rewizja w żądaniu ≠ aktualna (całość lub flow) |
| `version_required` | 409 | Z-05 | `deploy.requireRevision: true` i brak rewizji (nazwa jak w łatce 0006 Zamawiającego – decyzja D-20); także każde wdrożenie API v1 (sama tablica) i `DELETE /flow/:id` bez `?rev=` przy `requireRevision: true` (R-14); typ `reload` zwolniony (R-14) |
| `invalid_revision` | 400 | Z-04 | rewizja w złym typie (np. liczba, obiekt); **pusty `rev` nie jest tym błędem** – pusty `rev` (`""` lub `null`): przy `deploy.requireRevision: false` – jak w 5.0.7 (409 `version_mismatch`); przy `true` – traktowany jak brak rewizji → 409 `version_required` (decyzja N-01, wariant A) |
| `deploy_rejected` | 400 | Z-06 (#10) | `preDeploy` odrzucił wdrożenie – **wyłącznie odrzucenie zamierzone** (`false` albo `Error` ze `status: 400`); odpowiedź `{code, message, reason, details?}`: `message` z hooka (oczyszczony, ≤ 1000), `reason` = kod błędu hooka (`[A-Za-z0-9_.:-]{1,64}`, inaczej `"rejected"`), `details` – obiekt lub tablica ≤ 8 KB (R-15, R-50) |
| `deploy_hook_failed` | 503 | Z-06 (#10) | awaria walidatora (wyjątek, `Promise.reject()`, `done("x")`, mutacja zamrożonego zdarzenia); stały komunikat, przyczyna tylko w logu; nic nie zapisano (fail-closed, R-50) |
| `runtime_stopping` | 503 | #84 | instancja w stanie `stopping`/`stopped`: odmowa każdego wdrożenia (`POST /flows` wszystkich typów, v1 i v2, `/flow*`, API runtime) i `POST /flows/state` start; stały komunikat, bez `Retry-After`; nic nie zmieniono – ponowienie po restarcie albo na innej instancji. Także `errors[].code` w `deploy_start_failed` (tryb `started`), gdy wdrożenie zapisało konfigurację przed zatrzymaniem, a start został pominięty |
| `deploy_hook_timeout` | 503 | Z-06 (#10) | `preDeploy` przekroczył `deploy.hookTimeout` (R-15; wcześniej proponowane 400) albo poprzednie, spóźnione wywołanie tego samego handlera jeszcze trwa (SEC-103); nic nie zapisano |
| `deploy_stop_failed` | 500 | P-01 | tryb `started`: błąd zatrzymania węzłów; `rev` (w `/flow` także `revAll` – W-3) |
| `deploy_start_failed` | 500 | P-01 | tryb `started`: błąd startu – odpowiedź `{ code, message, rev, errors[] }`, `errors[].code` w `snake_case`, m.in. `safe_mode` (R-10, R-33) i `start_timeout` (przekroczony `deploy.startTimeout`, R-38); zakres błędu startu wg §2.3 A krok 10 (R-10); w `/flow` `rev` = rewizja flow, `revAll` = rewizja całości (W-3); pola wpisów `errors[]` (#22, R-48): `start_timeout` – `timeout`, `phase` (`modules`/`flows`), `startedAt`, `elapsed`, `pending[]` (przy wdrożeniu „flows”/„nodes” tylko flow, w których wdrożenie coś uruchamia), `current` (tylko gdy uruchamiane jest flow z `pending`); `flow_start_failed` – `flow` (gdy znany); późny wynik startu po `start_timeout` – zdarzenie `/comms` `deploy-start-result` |
| `invalid_flow_id` | 400 | Z-04 | `PUT /flow/:id` z niedozwolonym id przy `deploy.putCreatesFlow` |
| `duplicate_id` | 400 | Z-04 | id węzła/konfiguracji należy do innego flow |
| `module_downgrade_not_allowed` | 400 | Z-03 | `.tgz` ze starszą wersją przy `allowDowngrade: false` |
| `invalid_node_type` | 400 | Z-04 | węzeł w `globalConfigs[]` nie jest węzłem konfiguracyjnym |
| `upload_not_allowed` | 400 | **Z-03 (nowy kod)** | upload wyłączony – dziś `Error` bez kodu / `invalid_request` |
| `read_only_user_dir` | 400 | Z-11 | operacja wymagająca zapisu przy `readOnlyUserDir: true`, w tym wdrożenie przy magazynie plikowym (R-18) |
| `node_type_not_permitted` | 403 | Z-12.08 | wdrożenie zawiera dodane/zmienione węzły typu, do którego użytkownik nie ma uprawnienia (odebrane `!nodes.type.<typ>` lub nieprzyznane przy `!nodes.type.*`); odpowiedź z polem `types[]` (R-27, **R-33**, R-42) |
| `editor_only` | 409 | Z-15 | operacja wymagająca działających flow (np. `inject`) na instancji edycyjnej |
| `http_hold_timeout` | 503 | #8 | żądanie do trasy węzła czekało na restart flow dłużej niż `deploy.holdHttpNodeRequests.timeout`; nagłówek `Retry-After` |
| `http_hold_queue_full` | 503 | #8 | liczba wstrzymanych żądań osiągnęła `deploy.holdHttpNodeRequests.maxPending` (limit globalny, nie na klienta); nagłówek `Retry-After` |
| `http_hold_release_failed` | 503 | #8 | wyjątek przy wypuszczaniu wstrzymanego żądania po restarcie flow; nagłówek `Retry-After` |
| `http_drain_not_accepted` | 503 | #40 | drenaż HTTP: zapytanie nie trafiło do flow (nie zostało przyjęte przez węzeł `http in`, np. wolne ciało lub uwierzytelnianie w toku w chwili zatrzymania) – można bezpiecznie ponowić; zawsze z `Retry-After`; `Connection: close`, gdy ciało nie zostało odczytane; ciało stałe `{code, message}` (R-49) |
| `http_drain_outcome_unknown` | 503 | #40 | drenaż HTTP: zapytanie trafiło do flow, a flow zatrzymano przed odpowiedzią (limit `deploy.drainHttpNodeRequests.timeout` albo zatrzymanie) – flow mógł zadziałać; `Retry-After` tylko dla GET/HEAD/OPTIONS; przyczyna (limit/zatrzymanie) tylko w logu (R-49) |
| `state_operation_in_progress` | 409 | E-02 | (wewnętrzny) próba drugiej operacji stanu pod blokadą |
| `reload_failed` | 200 (`reason` w treści `/health/ready`) | Z-09 (#1) | `deploy.reload.retry.onExhausted: "keepReady"`: przeładowanie z magazynu nie powiodło się, gotowa instancja uruchamia poprzednią rewizję – treść `{"status":"warn","reason":"reload_failed"}`; stały kod, bez rewizji i tekstu błędu (R-47). Kody w warunku `reload` stanu instancji (`error.code`): `storage_error`, `credentials_load_failed`, `invalid_flows`, `invalid_json`, `empty_file` (uszkodzony plik – błędy konfiguracji, zawsze `failed`), `reload_failed` (inny błąd samego przeładowania); warunek ustawiany tylko przy `"keepReady"` |

### 2.5 Proces i dostarczenie (E-04, E-05)

**E-04 – dostosowanie gałęzi (R-30):**
- Nagłówek o modyfikacji wg szablonu z łatek załącznika A („Modified by Actuna Sp. z o.o.: <opis>”, D-19); pliki, w których
  nie można umieścić komentarza lub nagłówka licencji (np. JSON) – wpis w `MODIFICATIONS.md` (lista plików i opis zmian);
  uzupełnienie brakujących nagłówków z łatki 0004.
- Komentarze w kodzie „upstream” → „wersja bazowa 5.0.7”.
- Historia łatek: łatki zastąpione commitami pakietów (odwołanie do załącznika A w opisie).
- CHANGELOG: sekcja „Unreleased” w gałęzi pakietu (bez nazw produktów).
- Nazwy narzędzi stron trzecich (np. w opisie środowiska testów) – dozwolone.

**E-05 – środowisko weryfikacji (R-31):**
- CI (GitHub Actions) w forku `Actuna-Tech/node-red`, gałąź integracyjna (np. `actuna/integration`).
- Macierz Node: gałęzie pakietów – Node 22; gałąź integracyjna – Node 22 i 24.
- E2E (D-03) – nieblokujące: uruchamiane ręcznie lub nocnie, wynik w raporcie pakietu.

## 3. Wspólne Definition of Done (każdy pakiet)

Łączy wymagania zlecenia (§3) z praktykami pracy:

- [ ] **Specyfikacja** w karcie zatwierdzona (cel, wejścia/wyjścia, niezmienniki, błędy, skutki uboczne, kryteria BDD).
- [ ] **Zgodność wstecz:** nowe zachowanie domyślnie wyłączone; przy domyślnych ustawieniach wszystkie istniejące testy przechodzą bez zmian (wyjątek: pakiety „poprawka błędu”).
- [ ] **Testy najpierw:** test odtwarzający problem / wymaganie (czerwony) przed implementacją; dla poprawek błędów – test, który pada bez poprawki.
- [ ] **Testy obu stanów ustawienia** i ścieżek błędów, w strukturze `test/unit/...` (mocha/should).
- [ ] **`npm test` przechodzi** (build, verify-deps, lint, coverage). Uruchamiane w środowisku z `ssh-keygen` (testy projektów); każdy pominięty/środowiskowy błąd wymieniony z uzasadnieniem.
- [ ] **Brak nazw produktów** w kodzie, komunikatach, ustawieniach i testach; **nagłówki o modyfikacji** „Modified by Actuna Sp. z o.o.: <opis>” w każdym zmienionym pliku forka (pkt 4(b) licencji Apache 2.0 – D-19; gałęzie do ewentualnego zgłoszenia upstream bez nich); brak nowych zależności npm bez zgody.
- [ ] **Dokumentacja:** ustawienie w szablonie `packages/node_modules/node-red/settings.js` (zakomentowane, z opisem); JSDoc dla nowego API; wpis do CHANGELOG (bez nazw produktów); teksty UI w `locales/en-US` (+ `pl` po Z-13).
- [ ] **Kontrakty:** zmiany Admin API opisane i pokryte testami kontraktu (stare wywołania bez zmian).
- [ ] **Dostarczenie:** osobna gałąź pakietu względem wersji bazowej (5.0.7) w forku `Actuna-Tech/node-red`; commity w stylu projektu, autor i `Signed-off-by`: Wojciech Repiński (Actuna Sp. z o.o.) – D-04; **bez PR/push do `node-red/node-red`**; zależności między pakietami jawnie opisane.
- [ ] **Przegląd:** niezależny przegląd diffu (poprawność, zakres, zgodność wstecz, bezpieczeństwo); brak niezwiązanych zmian.
- [ ] **Raport:** co zmieniono, nowe ustawienia, wpływ na zgodność, dowody weryfikacji (liczby testów), czego nie zweryfikowano.

### Ewaluacje wspólne (dla agentów i przeglądu)

```yaml
evals:
  - name: existing_tests_default_settings
    requirement: pass
  - name: new_tests_both_setting_states
    requirement: present_and_pass
  - name: regression_test_fails_without_fix   # tylko poprawki błędów
    requirement: demonstrated
  - name: public_contracts
    requirement: unchanged_unless_documented
  - name: product_names
    requirement: none_in_code_tests_messages
  - name: modification_notices          # D-19
    requirement: present_in_every_modified_file_of_the_fork
  - name: new_dependencies
    requirement: none_without_approval
  - name: settings_template_documented
    requirement: true
  - name: scope
    requirement: no_unrelated_changes
```

## 4. Szablon karty pakietu

```markdown
### <ID> – <tytuł>

| Pole | Wartość |
|---|---|
| Etap / typ | 1–4 / funkcja \| poprawka błędu \| przerobienie |
| Priorytet / ryzyko | P1–P4 / niskie–wysokie |
| Ustawienie | rekomendowana nazwa (propozycja zlecenia) |
| Zależności | inne pakiety, E-01 |
| Pliki | ścieżki (+ linie z weryfikacji) |
| Powiązania | FL-*, inne pakiety P/Z/E |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: POTWIERDZONE / CZĘŚCIOWO / NIEPOTWIERDZONE + fakty z plik:linia; różnice względem opisu zlecenia.

#### Specyfikacja
Cel · Wejścia · Wyjścia · Niezmienniki · Przypadki błędów · Skutki uboczne

#### Projekt rozwiązania (minimalny)

#### Kryteria akceptacji (BDD)
Scenariusze Gherkin (po polsku); obejmują kryteria odbioru ze zlecenia + uzupełnienia.

#### Testy
Jednostkowe / integracyjne / kontraktowe / E2E – pliki i nazwy przypadków.

#### DoD specyficzne
Lista kontrolna ponad wspólne DoD (§3).

#### Ryzyka i alternatywy

#### Podzadania
Lista z szacunkiem S/M/L.
```

## 5. Role agentów (przy realizacji)

| Rola | Zakres | Wynik | Weryfikacja |
|---|---|---|---|
| Weryfikator (Explore) | odczyt kodu, potwierdzenie stanu | raport plik:linia | cytaty kodu |
| Implementacja (jeden pakiet) | tylko pliki z karty pakietu | gałąź pakietu | testy z karty, `npm test` |
| Testy | brakujące przypadki, regresja | testy (czerwone przed zmianą) | uruchomienie bez/z poprawką |
| Przegląd | niezależna ocena diffu | lista uwag | DoD §3, ewaluacje |

Zasada eskalacji: niejasność wpływająca na zachowanie lub kontrakt → pytanie do Zamawiającego, nie założenie.
