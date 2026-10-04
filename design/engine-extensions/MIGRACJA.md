# Przewodnik dostosowania innych rozwiązań do forka Node-RED

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

Data: 2026-10-03 · status: **obowiązujący dla planowania** (nazwy wg D-02 – przyjęte; kontrakty API wg kart pakietów –
mogą się doprecyzować w trakcie realizacji; zmiany oznaczone pakietem) · decyzje: [ANALIZA.md](ANALIZA.md) §7.

> **Rejestr decyzji R-01…R-32 zamknięty (2026-10-03)** – [REJESTR-DECYZJI.md](REJESTR-DECYZJI.md). Kontrakty widoczne z
> zewnątrz, które z niego wynikają, są naniesione poniżej z oznaczeniem „(R-xx)”; naniesione także doprecyzowania R-33…R-42.

## 1. Po co ten dokument

Decyzja **D-02** przyjmuje nazwy ustawień i API inne niż w tekście zlecenia i w README załącznika A. Decyzja **N-03**:
nie dodajemy w silniku aliasów starych nazw – **dostosowujemy inne rozwiązania**. Dokument mówi, co i gdzie zmienić:

| Odbiorca | Rozdział |
|---|---|
| Konfiguracja instancji (`settings.js`, obraz, Helm/`values.yaml`) | §3 |
| Produkt korzystający z Node-RED jako silnika (Bot-Engine), dodatki edytora | §3, §5, §5.1, §6 |
| Narzędzia Admin API: automaty, asystenci AI (MCP), CI/CD | §4 |
| Operatorzy (K8s, sondy, zatrzymanie), monitoring stanu instancji | §3.3, §4.5 |
| Klienci `/comms` (edytor, własne klienty websocket) | §4.6 |
| Wtyczki: magazyn (`storageModule`), koordynacja, uwierzytelnianie | §5 |
| Kod korzystający z łatek załącznika A | §6 |

## 2. Zasada ogólna

- **Wartości domyślne forka = zachowanie oficjalnego Node-RED 5.0.7.** Łatki z załącznika A działały **na sztywno**;
  w forku to samo zachowanie trzeba **jawnie włączyć** ustawieniem (§3.1). Bez tego zachowanie wraca do 5.0.7.
- Nazwy ze zlecenia **nie działają** (nie ma aliasów) – wpisanie ich do `settings.js` nie da żadnego efektu.
- Kod błędu `version_required` (z łatki 0006) **zostaje** (D-20).

## 3. Konfiguracja instancji

### 3.1 Minimalna konfiguracja odtwarzająca dzisiejsze łatki (warunek odbioru P-01)

```js
// settings.js – instancje edytora i wykonawcze
module.exports = {
    deploy: {
        response: "started",        // P-01: odpowiedź Admin API dopiero po starcie flow (łatka 0004)
        requireRevision: true       // Z-05: wdrożenie bez rewizji → 409 version_required (łatka 0006, część serwerowa)
    },
    editorTheme: {
        deploy: {
            staleFlows: "reload-only" // P-02: nieaktualny edytor musi przeładować (łatka 0006, część edytora)
        }
    },
    telemetry: {
        enabled: false,
        locked: true                // P-03: użytkownik nie może włączyć telemetrii (łatka 0003)
    }
    // P-04 (łatka 0002) – poprawka błędu, bez ustawienia
}
```

**Ryzyko przy pominięciu:** bez `deploy.response: "started"` automaty MCP/CI mogą dostawać sporadyczne **404** z endpointów
nowego flow tuż po wdrożeniu (wraca zachowanie 5.0.7).

### 3.2 Mapowanie nazw (oficjalne, do protokołu odbioru)

| Pakiet | Zlecenie / README załącznika A | **Fork (obowiązuje)** | Domyślnie | Uwagi |
|---|---|---|---|---|
| P-01 | `flows.deployResponse` | `deploy.response` | `"stopped"` | `"started"` = łatka 0004 |
| P-02 | `editor.staleFlowsPolicy` | `editorTheme.deploy.staleFlows` | `"prompt"` | **nie** `editor.*` – ten klucz należy do ustawień użytkownika edytora; nie mylić z `editorTheme.deployButton` (wygląd przycisku) |
| Z-04 | `flows.putCreates` | `deploy.putCreatesFlow` | `false` | |
| Z-05 | `flows.requireRevision` | `deploy.requireRevision` | `false` | |
| P-03 | `telemetry.locked` | `telemetry.locked` | brak blokady | bez zmian |
| Z-02 | `httpAdminNodeRoutes` | `httpAdminNodeRoutes` | `"open"` | bez zmian |
| Z-08 | `health: {enabled, path}` | `health: {enabled, path, port, host}` + **`shutdownTimeout`** (płasko) | wyłączone | `shutdownTimeout` < `terminationGracePeriodSeconds` w K8s |
| Z-09 | – | `deploy.reload: {watch, type, preReloadTimeout, concurrency}` (kontrakt wtyczek – §5.2) | `watch: false`, `type: "full"`, `preReloadTimeout: 1200000` (20 min) | to samo przeładowanie, co typ wdrożenia `reload` w Admin API; rekomendowane `type: "diff"`; `concurrency` – tylko liczba; bez łączności z koordynatorem przeładowanie czeka (działa stara konfiguracja) (R-20) |
| Z-09 | – | `deploy.reload.retry: { min, max, attempts }` | `min: 1000`, `max: 60000` (ms), `attempts: 10` (~8 min) (R-36) | ponowienia nieudanych cykli przeładowania (odczyt magazynu, ponowny odczyt pod blokadą, samo przeładowanie); licznik zeruje się dopiero po udanym cyklu (#17); po wyczerpaniu `attempts` → stan `failed`, `/ready` 503 (R-20, D-18, R-36); przy `watch: true` błąd rejestracji `watchFlows` → błąd startu (R-36) |
| #8 | – | `deploy.holdHttpNodeRequests: {enabled, timeout, maxPending, retryAfter}` | `enabled: false`, `timeout: 5000` ms, `maxPending: 1000`, `retryAfter: 1` s | żądania do tras węzłów (`httpNode`) bez istniejącej trasy (trasy niezmienionych węzłów odpowiadają od razu) czekają na koniec restartu flow (wdrożenie, przeładowanie z magazynu) zamiast 404; po limicie 503 `http_hold_timeout` / `http_hold_queue_full` z `Retry-After`; klienci powinni ponawiać 503 po `Retry-After` |
| P-01 / Z-08 | – | `deploy.startTimeout` (ms) | wyłączony | limit czasu startu w trybie `deploy.response: "started"`; po przekroczeniu 500 `deploy_start_failed` z `errors[].code: "start_timeout"`, flow startują dalej w tle (R-38) |
| Z-06 | – | `deploy.hookTimeout` | 30000 ms | |
| Z-10 | – | `coordination: {plugin, options}`; `singleInstance` w węźle `inject` | wtyczka lokalna | wtyczkę zewnętrzną wybiera się **tylko jawnie** w `coordination.plugin` (bez automatycznego wykrywania) (R-21) |
| Z-11 | `readOnlyUserDir` | `readOnlyUserDir` + zmienna środowiskowa `NODE_RED_READ_ONLY_USER_DIR` (R-33) | `false` | inne niż istniejące `readOnly` magazynu plikowego (`readOnly` opisane w szablonie `settings.js` – R-40); zmienna działa także w CLI przed wyborem pliku ustawień (R-18); chroni także bezwzględny `flowFile` (R-40) |
| Z-15 | – | `editorOnly` | `false` | wyklucza się z `disableEditor`; wybrane zamiast `runtimeState.autoStart` (R-19); tylko `true` włącza (inna wartość – ostrzeżenie) |
| Z-03 | – | `externalModules.palette.allowDowngrade` | `true` | |
| Z-03 | `externalModules.palette.upload`, `editorTheme.palette.upload` | `externalModules.palette.allowUpload` (kanoniczne) | upload dozwolony | stare nazwy działają jako przestarzałe aliasy z ostrzeżeniem w logu – przejść na nazwę kanoniczną (R-17) |
| P-04 / D-07 | – | `httpAdminCommsOrigins` (R-33) | brak = zachowanie 5.0.7 (bez kontroli, ostrzeżenie w logu przy starcie) (R-35) | lista dozwolonych `Origin` dla `/comms`; przy ustawionej liście przyjmowane są tylko wymienione źródła oraz własne źródło edytora (R-35); w naszych instalacjach **zawsze ustawić** (R-06, R-35) |
| Z-12.10 | – | `editorTheme.embedding.allowedOrigins` (R-33) | brak = zachowanie 5.0.7 (bez kontroli, ostrzeżenie w logu przy starcie) (R-35) | źródła dozwolone dla `postMessage` osadzonego edytora, w tym kanału `set-theme` (R-28); przy ustawionej liście – tylko wymienione źródła; w naszych instalacjach **zawsze ustawić** (R-35) |
| Z-12.02 | – | `editorTheme.auth.tokenStorage: "local" \| "session"` (R-33) | `"local"` | przechowywanie tokenu: `localStorage` (jak 5.0.7) lub `sessionStorage` (R-26) |
| Z-14 | – | `editorTheme.flowLayout.enabled` | `false` | układ flow (pionowy/hybrydowy) |

### 3.3 Kubernetes (wartości przykładowe dla rozmów do ~15 min)

| Ustawienie Node-RED | Manifest K8s |
|---|---|
| `health.port`, `health.path` | `readinessProbe.httpGet` (`<path>/ready`), `livenessProbe.httpGet` (`<path>/live`) |
| `shutdownTimeout: 1140000` (19 min) | `terminationGracePeriodSeconds: 1200` (20 min) – grace period dłuższy niż drenaż; brak osobnego limitu `RED.stop()` – ostatecznym limitem jest grace period (R-37) |
| `deploy.reload.preReloadTimeout: 1200000` | – |
| `health.unreadyGrace` (np. 15000; większe niż `periodSeconds` × `failureThreshold` sondy `readiness` lub odpytywania balansera) | `/ready` 503 przez co najmniej tyle ms PRZED zatrzymaniem flow (SIGTERM i przeładowanie z magazynu); mieści się w `shutdownTimeout`/`preReloadTimeout`; bez `shutdownTimeout` zamykanie czeka dokładnie `unreadyGrace` – `terminationGracePeriodSeconds` dłuższy; nie dotyczy wdrożenia z edytora |
| workery: `disableEditor: true`, `httpAdminRoot: false` (Admin API wyłączone) | sondy na osobnym porcie (`health.port`) |
| `health.enabled: true` | warunek zamykania serwera HTTP przy zatrzymaniu (R-22); bez sond – zachowanie 5.0.7 |
| instancja edytora `editorOnly: true` | `readinessProbe` → 200 w stanie `loaded` (R-19) |

Drugi SIGTERM w trakcie drenażu zatrzymuje proces natychmiast (R-22) – nie wysyłać go z narzędzi przed upływem `shutdownTimeout`.
Bez `shutdownTimeout` drenaż jest wyłączony (zachowanie jak dotąd), a hook `preShutdown` nie jest wywoływany (R-37).

## 4. Narzędzia Admin API (automaty, MCP, CI/CD)

### 4.1 Rewizje i konflikty (Z-04, Z-05, istniejące)

| Sytuacja | Odpowiedź | Co ma zrobić narzędzie |
|---|---|---|
| Rewizja w żądaniu ≠ aktualna | 409 `version_mismatch` (bez zmian) | pobrać aktualny stan (`GET /flows` lub `GET /flow/:id`), nanieść zmiany, ponowić z nową rewizją |
| Brak rewizji przy `deploy.requireRevision: true` (także pusty `rev: ""` lub `null` – N-01) | 409 `version_required` | jw. – zawsze wysyłać rewizję |
| Pusty `rev: ""` przy `deploy.requireRevision: false` | 409 `version_mismatch` (jak w 5.0.7) | jw. |
| Wdrożenie API **v1** (sama tablica) przy `requireRevision: true` | zawsze 409 `version_required` (R-14) | **przejść na v2** (`Node-RED-API-Version: v2`, treść `{flows, rev}`) |
| Typ wdrożenia `reload` przy `requireRevision: true` | zwolniony z wymogu rewizji (R-14) | – |
| `GET /flow/:id` z nagłówkiem v2 | zawiera `rev` flow i nagłówek `ETag` (Z-04, R-13); bez nagłówka v2 – odpowiedź bez zmian (D-09) | używać tej rewizji w `PUT /flow/:id` |
| `POST /flow` | API **v2**: **201** z id nowego flow (16 znaków hex) (R-13, R-34); API v1: **200** jak dotąd (R-34) | odczytać id z odpowiedzi; nie zakładać 201 bez nagłówka v2 |
| `PUT /flow/:id` z nagłówkiem `If-Match: <ETag>` (v2) | równoważne `rev` w treści; `If-Match` i `rev` sprzeczne → **400** (R-34) | wysyłać jedno z nich albo oba zgodne |
| Globalne węzły konfiguracyjne – rewizja | `globalRev` (R-13); przy `deploy.requireRevision: true` `globalConfigs[]` bez `globalRev` → 409 `version_required` w `POST /flow` i `PUT /flow/:id` (Z-05) | wysyłać `globalRev` razem z `globalConfigs[]` |
| `PUT /flow/:id` nieistniejącego id przy `deploy.putCreatesFlow: true` | tworzy flow pod tym id; rewizja `rev: null`; **201** w v2 / **200** w v1 (R-34) | – |
| `PUT /flow/:id` nieistniejącego id bez `deploy.putCreatesFlow` | **404** jak dotąd (R-34) | utworzyć flow przez `POST /flow` |
| `DELETE /flow/:id` przy `requireRevision: true` | wymaga `?rev=` – brak → 409 `version_required` (R-14) | dołączać `?rev=<rev flow>` |
| Globalne węzły konfiguracyjne razem z flow | nowe pole `globalConfigs[]` (D-08) – pole `configs` zachowuje dotychczasowe znaczenie (konfiguracje flow) | nie wysyłać konfiguracji globalnych w `configs` |
| Format `ETag` (Z-04, doprecyzowanie przy realizacji) | `ETag: "<rev>"` (w cudzysłowie, zgodnie z HTTP); `If-Match` przyjmowany z cudzysłowem lub bez, także z prefiksem `W/`; `If-Match: *` = brak rewizji | odsyłać wartość `ETag` bez zmian |
| Odpowiedź `PUT /flow/:id` w v2 (Z-04) | `{id, rev, revAll}` – `rev` nowa rewizja flow, `revAll` nowa rewizja całości | zapamiętać `rev` do kolejnego `PUT` |
| `rev` w `POST /flow` (Z-04) | ignorowane jak dotąd (sprawdzane tylko `globalRev`) | – |
| `PUT /flow/:id` z id węzła używanym w innym flow (Z-04) | 400 `duplicate_id` (dotąd przyjmowane, powstawały zdublowane id) | poprawić dane |
| Nieprawidłowy nagłówek `Node-RED-API-Version` na `/flow` (Z-04, R-46) | traktowany jak **v1** (jak w 5.0.7) + ostrzeżenie w logu serwera (raz na wartość, najwyżej 100 wartości); `/flows` nadal 400 `invalid_api_version` | wysyłać `v1`/`v2` albo brak nagłówka |
| `DELETE /flow/:id?rev=` bez `deploy.requireRevision` (Z-05) | rewizja sprawdzana, gdy podana (409 `version_mismatch`) | – |
| `PUT /flow/:id` lub `DELETE` nieistniejącego flow (Z-04, Z-05) | 404 `not_found` ma pierwszeństwo przed kontrolą rewizji – `version_required`, a także `version_mismatch`/`invalid_revision`, gdy podano `rev`/`?rev=` (jak v1 w 5.0.7; dla `PUT` bez `putCreatesFlow`); `DELETE /flow/global` – 400 jak dotąd | – |
| Stan wymogu rewizji dla edytora (Z-05) | `GET /settings` → `deploy: {requireRevision: true}` (tylko gdy włączony) | – |

**Zalecenie:** wszystkie narzędzia na API **v2** i obsługa obu kodów 409 (`version_mismatch`, `version_required`) tą samą
ścieżką „pobierz – nanieś – ponów”. Pytanie N-04 (czy narzędzia dziś używają v2) – **nieznane**, więc przewodnik zakłada
sprawdzenie każdego narzędzia (lista kontrolna §7).

### 4.2 Odpowiedź wdrożenia (P-01, `deploy.response: "started"`)

- Odpowiedź przychodzi po starcie flow; endpointy nowego flow odpowiadają od razu.
- Błąd startu: **500 `deploy_start_failed`** z `rev` i `errors[]` – konfiguracja **jest zapisana**; narzędzie powinno
  przyjąć nową rewizję (żeby kolejne wdrożenie nie dostało 409) i zgłosić błąd (R-10).
- „Błąd startu” obejmuje: brakujące typy węzłów, brakujące moduły, tryb bezpieczny (safe mode), wyjątki startu flow;
  **nie** obejmuje błędów konstruktorów pojedynczych węzłów (te – jak dotąd, status/log węzła) (R-10).
- Tryb bezpieczny zgłaszany jest w `errors[]` z `code: "safe_mode"` (R-33).
- Limit czasu startu: `deploy.startTimeout` (ms, domyślnie wyłączony). Po przekroczeniu **500 `deploy_start_failed`**
  z `errors[].code: "start_timeout"`; flow startują dalej w tle (wynik w logu) – narzędzie przyjmuje `rev` jak przy
  innym błędzie startu (R-38).
- Pola wpisu `start_timeout` (#22, R-48, addytywne): `timeout` (ms), `phase` (`"modules"` | `"flows"`), `startedAt` (ms od epoki),
  `elapsed` (ms), `pending` (id flow jeszcze niewystartowanych, razem z bieżącym; przy wdrożeniu „flows”/„nodes” tylko flow, w których wdrożenie coś uruchamia; w fazie `"modules"` `[]`) i `current` (id
  uruchamianego flow, tylko w fazie `"flows"`). Wpis `flow_start_failed` z odrzuconego startu ma `flow`, gdy znany (wpisy
  z samego startu flow miały je już wcześniej). Pola nie zmieniają kodów ani statusów; klient, który ich nie zna, je pomija.
- Późny wynik (#22, R-48): po odpowiedzi `start_timeout` runtime publikuje po zakończeniu startu zdarzenie `deploy-start-result`
  (`/comms`, temat `notification/deploy-start-result`, bez retencji; tylko zalogowane sesje – wszystkie, razem z treścią błędów, SEC-003): `{type: "success"|"error",
  text, revision, errors[]?}` – tylko dla wdrożenia, które odpowiedziało `start_timeout`; klient porównuje `revision` ze swoją.
- Instancja tylko edycyjna (`editorOnly: true`): odpowiedź **`{rev, started: false}`** bez błędu – flow nie są
  uruchamiane (R-39).
- Błąd zatrzymania: 500 `deploy_stop_failed` z `rev`.
- Znaczenie `rev` w błędach `deploy_start_failed`/`deploy_stop_failed` (W-3): w `/flows` – rewizja całej konfiguracji
  (bez zmian); w `/flow` (`POST`, `PUT /flow/:id`, `DELETE /flow/:id`, v1 i v2) – `rev` = nowa rewizja **flow** (jak
  w odpowiedzi sukcesu v2; `null` po `DELETE` – flow już nie istnieje), a `revAll` = nowa rewizja całości. Narzędzie
  zapamiętuje `rev` do kolejnego `PUT /flow/:id` (lub `DELETE ?rev=`), a `revAll` do `POST /flows`.
- Kolejne wdrożenia czekają na start flow poprzedniego wdrożenia (blokada wdrożeń) – **do końca startu**, także
  po przekroczeniu `deploy.startTimeout` (odpowiedź 500 `start_timeout` wraca, blokada trwa); po 60 s ostrzeżenie
  w logu (R-43, **R-45**). Zwolnienie blokady po upływie `deploy.startTimeout` (w obu trybach odpowiedzi,
  ostrzeżenie w logu, start trwa w tle) tylko przy jawnym `deploy.startTimeoutReleasesLock: true` (domyślnie
  `false`) – **ryzyko:** kolejne wdrożenie może zatrzymywać i uruchamiać flow równolegle z niezakończonym startem
  poprzedniego (R-45).

### 4.3 Walidacja przed wdrożeniem (Z-06)

- Odrzucenie przez hook `preDeploy`: **400 `deploy_rejected`** z komunikatem; przekroczenie limitu (`deploy.hookTimeout`,
  30 s): **503 `deploy_hook_timeout`** (R-15) – narzędzie może ponowić później.
- `preDeploy` służy **tylko do walidacji** (nie modyfikuje treści); `postDeploy` wykonuje się asynchronicznie po odpowiedzi,
  jego błąd trafia tylko do logu (R-15).
- Hooki **nie** są wywoływane przy starcie procesu (wczytanie flow z magazynu) ani przy operacjach Projektów (R-15).
- Uprawnienia do typów węzłów (Z-12.08): wdrożenie z dodanym/zmienionym węzłem typu niedozwolonego dla użytkownika
  jest odrzucane w całości – **403 `node_type_not_permitted`** z `types[]` (R-27, R-33). Obsługiwane są obie listy
  (R-42): odbierająca (`["*", "!nodes.type.exec"]`) i dozwolonych (`["!nodes.type.*", "nodes.type.inject", …]`);
  przyznanie konkretnego typu ma pierwszeństwo przed `!nodes.type.*`, odebranie konkretnego typu – przed wszystkim.
  Przeładowanie z magazynu (typ `reload`, Z-09) nie jest kontrolowane per użytkownik (R-42).
- Wdrożenie przy `readOnlyUserDir: true` i magazynie plikowym: **400 `read_only_user_dir`** (R-18).

### 4.4 Pełny katalog kodów
[ZASADY.md](ZASADY.md) §2.4. Słowo `version` w kodach oznacza **rewizję flow** (`rev`), nie wersję API.

### 4.5 Stan instancji, sondy i zatrzymanie (E-02, Z-08, Z-15)

- **Nazwy stanów są kontraktem** (R-23): `init, starting, ready, deploying, reloadPending, reloading, idle, loaded, failed,
  stopping, stopped`. `init` – stan początkowy (przed startem runtime); `idle` – flow zatrzymane (`runtimeState` „stop”
  lub safe mode); `loaded` – instancja tylko edycyjna (`editorOnly`).
- **Zdarzenie `instance:state`** z treścią `{state, previous, reason}` (R-23); kod osadzający zatrzymuje runtime przez
  `RED.stop(reason)` – powód trafia do hooka `preShutdown` i logu.
- **Warunek `reload` (R-47)** – obok stanu, nie nowy stan (tabela przejść R-23 bez zmian): zdarzenie i `runtime.state.get()`
  zawierają pole `reload` `{error: {code}, since, attempts, activeRev, rev, keepReady, staleDeadline, stale?}` – tylko
  gdy przeładowanie z magazynu nie powiodło się po wyczerpaniu ponowień (kod `storage_error`, `credentials_load_failed`,
  `invalid_flows`, `invalid_json`, `empty_file` lub `reload_failed`); **warunek istnieje tylko przy `onExhausted: "keepReady"`** –
  przy domyślnym `"fail"` brak pola, dodatkowych zdarzeń i logów (sekwencja zdarzeń jak przed R-47); brak pola = brak warunku. **Nowa reguła kontraktu:** `instance:state` jest emitowane
  także, gdy zmienia się **samo** pole `reload` (ustawienie, zmiana liczby prób, przekroczenie `maxStaleTime`, skasowanie)
  przy niezmienionym `state` – odbiorca, który ma reagować tylko na zmiany stanu, porównuje `state`, `reason` i `since`
  (nie liczy każdego zdarzenia jako przejścia). Gdy `keepReady` eskaluje do błędu konfiguracji (z `storage_error` na np. `invalid_flows`), odbiorca może zobaczyć jedno zdarzenie przejściowe – zdarzenie `failed` nosi jeszcze poprzedni warunek z `keepReady: true` – a zaraz po nim poprawiony warunek. Wtyczki i monitoring mogą z tego przekazywać alarm (np. do systemu alertów).
- **Sondy** (`health.enabled`, R-19, R-22): `/health/ready` → 200 w `ready` i `loaded`; 503 m.in. w `idle` (safe mode,
  zatrzymane flow), `failed`, `stopping`. Treść 503 jest **stała**: `{"status":"unavailable"}` – nie zawiera nazwy stanu
  (stan odczytywać ze zdarzenia `instance:state` / `runtime.state`, nie z sondy).
  **`warn` (R-47):** tylko przy `deploy.reload.retry.onExhausted: "keepReady"` gotowa instancja, której przeładowanie z magazynu
  nie powiodło się (odczyt magazynu po wyczerpaniu ponowień), odpowiada 200 z treścią `{"status":"warn","reason":"reload_failed"}`
  (stały kod – bez rewizji i tekstu błędu, bo sonda jest bez uwierzytelnienia); po `deploy.reload.retry.maxStaleTime` (domyślnie
  30 min, `0` = bez limitu) – 503 `{"status":"unavailable"}`. **Monitoring dopasowujący treść `"ok"` zobaczy `"warn"` dopiero po
  włączeniu `keepReady`** (domyślnie `"fail"` – treść i kody bez zmian, także dla `editorOnly`); sprawdzanie samego kodu HTTP
  działa jak dotąd. `/live` bez zmian. Draft IETF health-check: `warn` → 2xx.
- **Przeładowanie z magazynu** (Z-09, R-20): `preReload` nie ma prawa weta (tylko opóźnia, limit `preReloadTimeout`);
  przy dodatkowych flow zmienionych po drenażu – ponowny `preReload` dla nich (D-17), poza blokadą, najwyżej jedna
  runda, potem przeładowanie z ostrzeżeniem w logu (R-36); błąd odczytu magazynu lub samego przeładowania → ponowienia wg `deploy.reload.retry`
  (domyślnie 10 prób, ~8 min; próby liczone do udanego cyklu, nie do udanego pierwszego odczytu – #17), po wyczerpaniu `failed` i 503 (D-18, R-36), a dalej odczyt co `retry.max` – po odzyskaniu dostępu powrót do `ready` bez nowego powiadomienia; przy `deploy.reload.watch: true` błąd
  rejestracji `watchFlows` → błąd startu instancji (R-36).
- **Instancja tylko edycyjna** (`editorOnly: true`, R-19): przyciski węzłów (m.in. `inject`) i akcja „Restart flows”
  w edytorze nieaktywne z podpowiedzią (R-39); `POST /flows/state` start → 409 `editor_only`; wdrożenie w trybie
  `deploy.response: "started"` → `{rev, started: false}` (R-39; także `POST /flow` i `PUT /flow/:id` w v2);
  brakujące typy węzłów **nie** dają stanu `failed` – instancja raportuje `loaded` (`/ready` 200) z ostrzeżeniem w logu
  (`nodes.flows.editor-only-missing-types`), a moduły węzła Function nie są instalowane (`checkFlowDependencies` nie
  jest wołane). Edytor pokazuje nieznane typy jak zwykle; walidację kompletności modułów przenieść do CI lub instancji
  wykonawczej (tam brakujące typy nadal dają `failed`).

### 4.6 Połączenie `/comms` (P-04)

- Przy **wyłączonym `adminAuth`** pakiet `auth` (np. token zapamiętany przez przeglądarkę) dostaje odpowiedź **`auth ok`**,
  połączenie działa dalej (R-05) – **zmiana względem łatki 0002** (tam: `auth fail`). Klienty nie powinny traktować
  `auth ok` jako dowodu uwierzytelnienia.
- Kontrola nagłówka `Origin` (R-06): ustawienie `httpAdminCommsOrigins` z listą dozwolonych źródeł (R-33). Brak
  ustawienia = zachowanie 5.0.7 (bez kontroli, ostrzeżenie w logu przy starcie) (R-35). Przy ustawionej liście
  połączenie z niedozwolonego źródła jest odrzucane; własne źródło edytora jest przyjmowane zawsze (R-35) – klienty
  spoza przeglądarki i edytory osadzone w innych domenach muszą być na liście.

## 5. Wtyczki i produkt

| Obszar | Zmiana | Pakiet |
|---|---|---|
| Wtyczka magazynu | opcjonalna funkcja `watchFlows(callback)` – powiadomienia o zmianie flow z innej instancji | Z-09 |
| Wtyczka koordynacji | nowy typ wtyczki `node-red-coordination` (lider, zajęcie zadania); wybór tylko jawnie w `coordination.plugin`; `inject` z `singleInstance`: cron – zajęcie klucza `<id>:<czas>` (dokładnie raz), interwał – lider (D-14); węzeł na instancji niebędącej liderem pokazuje status „standby”; `mqtt in` z `singleInstance` – osobny pakiet (R-21) | Z-10 |
| Hooki | `preDeploy` (tylko walidacja), `postDeploy` (source `api`/`internal`/`storage`, asynchronicznie), `preReload` (bez weta), `preShutdown` (z `reason`); brak hooków wdrożenia przy starcie procesu i operacjach Projektów (R-15, R-20, R-23); `preReload` i `preShutdown` także z ustawienia `hooks` w `settings.js` (rejestracja przy `init`, #7) | Z-06, Z-09, Z-08 |
| Trasy administracyjne bloczków | przy `httpAdminNodeRoutes: "authenticated"` trasa bez uprawnienia wymaga sesji; publiczne – `RED.auth.publicRoute()` | Z-02 |
| Trasy HTTP bloczków | `node.registerHttpRoute(method, path, ...handlers)` – automatyczne zdejmowanie przy zamknięciu | Z-07 |
| Dodatki edytora (15 obecnych) | przeniesienie na API z Z-12.01…Z-12.14 (bez selektorów DOM); kolejność pakietów Z-12c → a → b → d → e; przestarzałe API – min. jedna wersja minor z ostrzeżeniem (R-24) | Z-12 |
| Logowanie (12.01) | **wariant A**: skrypty logowania przez `editorTheme.page.scripts` lub wtyczkę motywu (bez zmian serwera); dodatkowe pola/kroki – hook edytora `loginPost` z własną trasą pluginu (R-25) | Z-12 |
| Kod jednorazowy (12.02) | kod wydaje własna strategia `adminAuth`/plugin; rdzeń przyjmuje `#code=<kod>&next=<hash>`; przechowywanie tokena: `editorTheme.auth.tokenStorage` – `"local"` (domyślnie, `localStorage`) lub `"session"` (`sessionStorage`) (R-26, R-33) | Z-12 |
| Uprawnienia (12.08) | zakresy podrzędne `flows.deploy`, `flows.import`, `flows.export`, `nodes.type.<typ>` dziedziczone z rodzica; wpis z prefiksem `!` odbiera, np. `["*", "!nodes.type.exec"]`; lista dozwolonych: `["!nodes.type.*", "nodes.type.inject", …]` – przyznanie konkretnego typu wygrywa z `!nodes.type.*`, odebranie konkretnego typu wygrywa ze wszystkim (R-42); serwer egzekwuje typy przy wdrożeniu (bez kontroli przy przeładowaniu z magazynu – R-42); `flows.export` – tylko utrudnienie w UI (R-27) | Z-12 |
| Linki i osadzanie (12.10) | głęboki link `#flow/<flowId>/node/<nodeId>` (obsługa `hashchange`, akcja `core:reveal-node`); `postMessage`, w tym kanał `set-theme`, tylko ze źródeł z `editorTheme.embedding.allowedOrigins` – produkt osadzający edytor musi się tam wpisać (R-28); brak ustawienia = zachowanie 5.0.7 z ostrzeżeniem w logu (R-35) | Z-12 |
| Klucze zarezerwowane | węzeł nie może zarejestrować ustawienia o nazwie `deploy`, `flows`, `health`, `coordination`, `hooks` | D-02 (U8) |

### 5.2 Kontrakt dla autorów wtyczek magazynu: `watchFlows` i `preReload` (Z-09)

Zrealizowane (scalone do `main`) (`runtime/lib/flows/reload.js`, `runtime/lib/storage/index.js`).

**`watchFlows(callback)`** – opcjonalna funkcja modułu magazynu (`storageModule`):

```js
/**
 * Rejestruje obserwatora zmian flow (i poświadczeń) w magazynie. Runtime wywołuje ją raz,
 * po storage.init() i przed pierwszym odczytem flow, tylko przy deploy.reload.watch: true.
 * @param {(notification?: {rev?: string, credentialsChanged?: boolean, source?: string}) => void} callback
 * @returns {Promise<void | (() => Promise<void>)>} opcjonalnie funkcja wyrejestrowania (wołana w RED.stop())
 */
watchFlows(callback)
```

- Powiadomienie jest **tylko sygnałem**: runtime zawsze czyta flow przez `getFlows()`/`getCredentials()` i porównuje
  rewizję (SHA-256 z `JSON.stringify(flows)`) z działającą. Wolno wołać `callback()` bez argumentów, wielokrotnie
  i seriami (runtime łączy powiadomienia), także dla zapisów tej samej instancji (pomijane po rewizji).
- **Rewizja nie obejmuje poświadczeń** – przy zmianie samych poświadczeń wtyczka musi przekazać
  `credentialsChanged: true`, inaczej zmiana nie zostanie przeładowana.
- Wyjątek w `callback` nie wraca do wtyczki; wywołanie po wyrejestrowaniu jest ignorowane.
- Odrzucenie rejestracji przy `deploy.reload.watch: true` → **błąd startu** runtime (R-36). Magazyn bez `watchFlows`
  → ustawienie bez efektu, ostrzeżenie w logu.
- Przeładowanie nigdy nie zapisuje do magazynu (`saveFlows` nie jest wołane).
- **Odczyt ścisły:** do przeładowania runtime woła `getFlows({strict: true})` i `getCredentials({strict: true})`.
  Wtyczka przy tym argumencie musi **odrzucić** obietnicę przy błędzie odczytu lub niepełnej konfiguracji (np. zapis
  w toku), zamiast zwracać pustą konfigurację; brak poświadczeń to `{}`. Wynik bez tablicy flow runtime odrzuca sam
  (`invalid_flows`). Odrzucenie = nieudany odczyt: ponowienia `retry`, po wyczerpaniu `failed`, flow działają dalej
  (D-18, R-36). Wtyczki ignorujące argument działają jak dotąd (odczyt przy starcie – bez argumentu, bez zmian).
  Magazyn plikowy: brak, pusty lub niepoprawny plik flow → odrzucenie (kody `ENOENT`/kod `fs`, `empty_file`,
  `invalid_json`), bez odtwarzania `.backup`.
- Wbudowany magazyn plikowy implementuje `watchFlows` (zdarzenia systemu plików + odpytywanie co 1 s, debounce
  200 ms; własne zapisy pomijane po treści); nie działa z Projektami.

**Hook `preReload`** – `RED.hooks.add("preReload", function(event) { ... })`:

| Pole (obiekt zamrożony) | Znaczenie |
|---|---|
| `rev` / `activeRev` | rewizja, która zostanie uruchomiona / działająca |
| `type` | `"full"` \| `"diff"` (`deploy.reload.type`) |
| `changedFlows` | id flow (zakładek, subflow) restartowanych; `null` = wszystkie (`full`, zmiana konfiguracji globalnej lub węzła konfiguracyjnego poza flow, zmiana poświadczeń) |
| `credentialsChanged` | zmiana poświadczeń |
| `deadline` | `Date.now() + preReloadTimeout` z chwili rozpoczęcia drenażu (wspólny dla dodatkowej rundy D-17) |
| `signal` | `AbortSignal`; `reason`: `"stopping"` (zatrzymanie procesu) lub `"superseded"` (wdrożenie na tej instancji) |

- Handler musi **deklarować parametr** `event` (semantyka hooków Node-RED: funkcja bez parametrów jest traktowana jak
  wariant z `done` i nie kończy się) i zwrócić obietnicę rozwiązywaną, gdy praca w toku się zakończy.
- Brak prawa weta (R-20): błąd, odrzucenie, `false` lub przekroczenie limitu → log i przeładowanie mimo to.
- `/ready` 503 od wywołania hooka do końca przeładowania; hook działa **bez** blokady wdrożeń; `preDeploy` nie jest
  wywoływany przy przeładowaniu z magazynu (`postDeploy` – po realizacji Z-06, obecnie odłożone).
- Flow zmienione w trakcie drenażu poza `changedFlows` (`type: "diff"`) → jeszcze jeden `preReload` tylko dla nich,
  w ramach pozostałego limitu, najwyżej jedna runda (D-17, R-36).
- Przy `deploy.reload.concurrency` instancja przed drenażem zajmuje slot `slot:reload:<i>` przez wtyczkę koordynacji
  (`claim(key, ttlMs)`, TTL 60 s odnawiany przez `renew` co 20 s, jeśli wtyczka go udostępnia); oczekujące instancje
  zostają w `reloadPending` bez drenażu (`/ready` bez zmian).

### 5.1 Terminologia polska (Z-13, R-29)

- Zakres tłumaczenia teraz: JSON edytora, `messages.json`, `runtime.json`; pomoc HTML węzłów – osobny etap (D-16).
- Forma bezosobowa; „węzeł” (nie „bloczek”) w tekstach UI; „flow” i „subflow” bez tłumaczenia; przycisk wdrożenia – „Wdróż”;
  przeładowanie w P-02 – „Przeładuj flow” (R-12).
- Słownik terminów zatwierdza Zamawiający; dodatki edytora i dokumentacja produktu powinny używać tych samych terminów.
- Automatyczny wybór języka `pl`; test zgodności kluczy pl↔en-US w `npm test`.

## 6. Kod korzystający z łatek załącznika A

| Łatka | Co znika / zmienia się | Działanie |
|---|---|---|
| 0002 (P-04) | poprawka zostaje, rozszerzona o scenariusz bez `adminAuth`; **zmiana**: bez `adminAuth` odpowiedź na pakiet `auth` to `auth ok` (łatka: `auth fail`) (R-05) | klienty polegające na `auth fail` – dostosować (§4.6) |
| 0003 (P-03) | sztywne wyłączenie telemetrii | ustawić `telemetry.locked` (§3.1) |
| 0004 (P-01) | funkcja wewnętrzna `waitForDeployStart()` – **nie jest kontraktem**, może zniknąć lub zmienić nazwę | N-02 (nieznane): sprawdzić, czy kod poza runtime ją wywołuje; jeśli tak – zastąpić ustawieniem `deploy.response: "started"` |
| 0005/0006 (P-02, Z-05) | sztywne odrzucanie v2 bez `rev`; okno „tylko przeładowanie” zawsze | ustawić `deploy.requireRevision`, `editorTheme.deploy.staleFlows` (§3.1) |
| 0001 (Z-13) | częściowe tłumaczenie `pl` | uzupełnione w Z-13 (liczba mnoga wg reguł polskich); terminologia – §5.1 (R-29) |

Nagłówki „Modified by Actuna Sp. z o.o.” – zachowane w forku (D-19); pliki bez możliwości komentarza – `MODIFICATIONS.md`;
łatki zastąpione commitami pakietów (R-30).

## 7. Lista kontrolna dostosowania (dla każdego rozwiązania)

- [ ] `settings.js` / Helm: nazwy z §3.2; brak kluczy `flows.*` i `editor.staleFlowsPolicy`.
- [ ] Ustawienia odtwarzające łatki (§3.1) na wszystkich instancjach.
- [ ] Każde narzędzie Admin API: v2, wysyła rewizję, obsługuje `version_mismatch` i `version_required`, `deploy_start_failed` (przyjmuje `rev`; `errors[].code` m.in. `safe_mode`, `start_timeout`), `deploy_rejected`; `POST /flow` → 201 tylko w v2 (R-34); odpowiedź `{rev, started: false}` instancji `editorOnly` (R-39).
- [ ] Kod nie wywołuje `waitForDeployStart()` (N-02).
- [ ] Konfiguracje globalne w `globalConfigs[]`, nie w `configs` (gdy używane `/flow`).
- [ ] K8s: sondy i drenaż wg §3.3.
- [ ] Dodatki edytora przeniesione na API Z-12 (po wdrożeniu Z-12); linki w formacie `#flow/<id>/node/<id>`; źródła osadzenia w `editorTheme.embedding.allowedOrigins` (R-28).
- [ ] Narzędzia obsługują 503 `deploy_hook_timeout` (ponowienie), 403 `node_type_not_permitted`, 400 `read_only_user_dir`; `DELETE /flow/:id` z `?rev=` (R-14, R-15, R-18, R-27).
- [ ] Monitoring stanu: nazwy stanów i zdarzenie `instance:state` wg §4.5; brak parsowania treści 503 sondy (R-22, R-23).
- [ ] Lista `Origin` dla `/comms` i `editorTheme.embedding.allowedOrigins` ustawione na naszych instalacjach (R-06, R-35); klienty `/comms` bez założenia `auth fail` przy wyłączonym `adminAuth` (R-05).
- [ ] Konfiguracja uploadu tylko przez `externalModules.palette.allowUpload` (R-17); instancje tylko do odczytu – `readOnlyUserDir` lub zmienna środowiskowa (R-18).
- [ ] Teksty i dokumentacja po polsku zgodne z terminologią §5.1 (R-29).
- [ ] Test po migracji: wdrożenie przez narzędzie → natychmiastowe wywołanie endpointu nowego flow (200), konflikt rewizji (409), wdrożenie bez rewizji (409 `version_required`).

## 8. Decyzje otwarte wpływające na ten przewodnik

| ID | Temat | Stan |
|---|---|---|
| N-01 | pusty `rev: ""` przy wdrożeniu | **rozstrzygnięte – wariant A** (§4.1) |
| N-02 | użycie `waitForDeployStart()` poza runtime | nieznane – przyjęto: brak aliasu; sprawdzenie w liście kontrolnej |
| N-04 | czy narzędzia używają API v2 | nieznane – przyjęto: przewodnik wymaga v2 |
| – | `DELETE /flow/:id` z wymogiem rewizji | **rozstrzygnięte – R-14** (§4.1) |
| R-01…R-32 | pozostałe decyzje wpływające na przewodnik | **rozstrzygnięte** – [REJESTR-DECYZJI.md](REJESTR-DECYZJI.md) |
| R-33…R-42 | doprecyzowania (nazwy robocze, 201/`If-Match`, listy źródeł, `retry`, `startTimeout`, `editorOnly`, listy typów) | **rozstrzygnięte** – [REJESTR-DECYZJI.md](REJESTR-DECYZJI.md), naniesione powyżej |

### Uzupełnienie (zgłoszenia #4, #5)
- Kształt hooków `preReload`/`preShutdown`: `async (payload) => { … }` – dokładnie jeden parametr; inna liczba
  parametrów oznacza wywołanie `(payload, done)` i ignorowanie zwróconej obietnicy.
- Sondy bez `health.port` są publiczne na głównym serwerze – używaj osobnego portu w sieci wewnętrznej.
- Wtyczka koordynacji nie jest uruchamiana na instancji `editorOnly`; fasada zwraca tam `isLeader() === false`,
  a `info().plugin === "editor-only"`.
