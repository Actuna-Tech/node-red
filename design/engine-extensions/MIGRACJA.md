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
| #40 | – | `deploy.drainHttpNodeRequests: {enabled, timeout, retryAfter}` | `enabled: false`, `timeout: 30000` ms, `retryAfter: 1` s | drenaż zapytań HTTP przed zatrzymaniem flow: runtime czeka (≤ `timeout`, limit twardy) na zapytania przyjęte przez `http in`, po zatrzymaniu odpowiada 503 na otwarte (`http_drain_not_accepted` / `http_drain_outcome_unknown`); zalecane `timeout` 5000–10000 dla Bot-Engine i ruchu publicznego; z `shutdownTimeout` także sygnał zatrzymania czeka na zapytania, SSE/long-poll – `http in` `drainMode: "long"` (#82); szczegóły: §4.7 (R-49) |
| P-01 / Z-08 | – | `deploy.startTimeout` (ms) | wyłączony | limit czasu startu w trybie `deploy.response: "started"`; po przekroczeniu 500 `deploy_start_failed` z `errors[].code: "start_timeout"`, flow startują dalej w tle (R-38) |
| Z-06 (#10) | – | `deploy.hookTimeout` | 30000 ms | jeden limit łańcucha hooków `preDeploy` (pod blokadą wdrożeń); skończona liczba > 0 i ≤ 2147483647, inaczej ostrzeżenie i 30000; hooki rejestruje się tylko przez `RED.hooks.add` we wtyczce (§4.3, §5); kontrakt: R-50 |
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
| `startupTimeout: 120000` (2 min) | `startupProbe` na `<path>/ready` z budżetem 180 s (`periodSeconds: 10`, `failureThreshold: 18`) – budżet większy niż `startupTimeout` + 5 s (zatrzymanie po nieudanym starcie, #67) + czas wczytania flow (#71) |
| `deploy.reload.preReloadTimeout: 1200000` | – |
| `health.unreadyGrace` (np. 15000; większe niż `periodSeconds` × `failureThreshold` sondy `readiness` lub odpytywania balansera) | `/ready` 503 przez co najmniej tyle ms PRZED zatrzymaniem flow (SIGTERM i przeładowanie z magazynu); mieści się w `shutdownTimeout`/`preReloadTimeout`; bez `shutdownTimeout` zamykanie czeka dokładnie `unreadyGrace` – `terminationGracePeriodSeconds` dłuższy; nie dotyczy wdrożenia z edytora |
| workery: `disableEditor: true`, `httpAdminRoot: false` (Admin API wyłączone) | sondy na osobnym porcie (`health.port`) |
| `health.enabled: true` | warunek zamykania serwera HTTP przy zatrzymaniu (R-22); bez sond – zachowanie 5.0.7 |
| instancja edytora `editorOnly: true` | `readinessProbe` → 200 w stanie `loaded` (R-19) |

Drugi SIGTERM w trakcie drenażu zatrzymuje proces natychmiast (R-22) – nie wysyłać go z narzędzi przed upływem `shutdownTimeout`.
Bez `shutdownTimeout` drenaż jest wyłączony (zachowanie jak dotąd), a hook `preShutdown` nie jest wywoływany (R-37).

**Nieudany start (#67):** gdy `RED.start()` odrzuci (np. magazyn koordynacji albo kontekstu niedostępny przy starcie),
`red.js` zatrzymuje runtime (najwyżej 5000 ms, bez `preShutdown`) i kończy się kodem 1, więc `restartPolicy`, systemd
`Restart=on-failure` albo PM2 uruchamiają instancję ponownie. Przy trwałym błędzie konfiguracji (np. zła `health.path`)
powstaje pętla restartów: `CrashLoopBackOff` w Kubernetes, `StartLimitBurst` w systemd. To zamierzony, widoczny skutek;
przyczynę podaje log `Failed to start server:` z poprzedniego uruchomienia.

**Zawieszony start (#71):** gdy krok startu nie kończy się wcale (np. magazyn koordynacji nie odpowiada zamiast
odmówić), bez ustawienia `startupTimeout` proces nie kończy się sam, jak dotąd – stan `starting` trwa, `/ready` 503,
`/live` 200. Z `startupTimeout` (zalecane `120000`, FORK §2) zawieszony `RED.start()` jest nieudanym startem: po limicie
błąd `startup_timeout` z nazwą kroku, na który runtime czekał, zatrzymanie (najwyżej 5000 ms) i kod 1, więc supervisor
uruchamia instancję ponownie. Limit obejmuje tylko start runtime, nie wczytanie i start flow po nim, dlatego
`startupProbe` na `<path>/ready` nadal jest zalecana: wykrywa też instancję zawieszoną przy wczytaniu flow. Reguła
budżetu: `failureThreshold` × `periodSeconds` sondy `startupProbe` musi być większe niż `startupTimeout` + 5 s
(zatrzymanie po nieudanym starcie, #67) + czas wczytania flow; inaczej kubelet wysyła SIGTERM przed limitem i proces
kończy się kodem 0 – log podaje wtedy krok, na który start czekał (`The start was stopped (SIGTERM) before it completed -
waiting for: <step>`, #73).

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
  uruchamianego flow, tylko w fazie `"flows"` i tylko dla flow z `pending`; bez `current`, gdy start czeka na flow, którego wdrożenie nie uruchamia; „nodes” nie liczy przepiętych/powiązanych węzłów). Wpis `flow_start_failed` z odrzuconego startu ma `flow`, gdy znany (wpisy
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

### 4.3 Walidacja przed wdrożeniem (Z-06, #10, R-15, R-50)

- **Rejestracja:** wyłącznie `RED.hooks.add("preDeploy.<etykieta>", fn)` i `RED.hooks.add("postDeploy.<etykieta>", fn)` we wtyczce
  (`node-red.plugins`) albo węźle. Ustawienie `hooks` w `settings.js` **nie** przyjmuje tych hooków (wpis `hooks: {"preDeploy.x": …}`
  kończy start błędem `invalid_hook_setting`, jak dotąd; do `settings.js` wolno rejestrować tylko `preReload` i `preShutdown`, W7).
- **Kontrakt `preDeploy`:** `fn(event)` albo `fn(event, done)`; `event` to zamrożona kopia wynikowej konfiguracji:
  `{type, source: "api"|"internal", operation, flowId?, created?, flows, activeRev, rev?, user, deadline, signal}`.
  `flows` nie zawiera `credentials` żadnego elementu ani `value` wpisów `env` typu `cred`; **pozostałe pola mogą zawierać sekrety**
  (`env` typu `str`, adresy z `user:pass@`, kod `function`) – nie wysyłać całych `flows` do usług zewnętrznych, tylko potrzebne pola.
  Handlery wykonują się po kolei, pod blokadą wdrożeń, najwyżej raz na wdrożenie.
- **Sposób odrzucenia i kody odpowiedzi:**
  - akceptacja: zwrot wartości innej niż `false` (także w obietnicy) albo `done()`; **zwrócony (nie rzucony) `Error` też jest akceptacją** – odrzucić można tylko przez `throw`, odrzuconą obietnicę, `done(err)` albo `false`;
  - **400 `deploy_rejected`** `{code, message, reason, details?}` – `false` / `done(false)` albo `Error` ze `status: 400` (rzucony, odrzucona
    obietnica lub `done(err)`): `message` = komunikat błędu, `reason` = jego `code` (litery, cyfry, `_ . : -`, do 64 znaków; inaczej `"rejected"`),
    `details` = jego `details` (zwykły obiekt albo tablica, do 8 KB); **to jedyne odrzucenie zamierzone** – klient nie ponawia bez zmiany treści;
  - **503 `deploy_hook_failed`** `{code, message}` – awaria walidatora (wyjątek, `Promise.reject()` bez wartości, `done("x")`, mutacja
    zamrożonego zdarzenia): stały komunikat, nic nie zapisano; narzędzie może ponowić później (fail-closed, P2);
  - **503 `deploy_hook_timeout`** – brak wyniku w `deploy.hookTimeout` (30 s) albo poprzednie wywołanie tego samego handlera jeszcze trwa (SEC-103).
- W `message` i `details` **nie umieszczać** sekretów, adresów wewnętrznych ani odpowiedzi usług (trafiają do klienta i do audytu).
- **Handler musi respektować `event.signal` / `event.deadline`** i dawać własny limit wywołaniom sieciowym: po limicie runtime nie czeka, ale wywołanie,
  które się nie skończyło, blokuje handler – następne wdrożenia dostają 503 od razu, bez wywołania handlera, **do końca tego wywołania albo restartu**
  (konsekwencja fail-closed). Log `warn` podaje wiek spóźnionego wywołania w ms. **Procedura awaryjna:** wyłączyć wtyczkę z walidatorem i zrestartować
  instancję (np. zmienna środowiskowa czytana przez wtyczkę); nie ma ustawienia omijającego walidację. `POST /flows/state` i Projekty działają
  bez hooków, ale pozwalają tylko zatrzymać albo wznowić obecne flow, nie wdrożyć poprawki.
- **„Restart flows” jest walidowany** (typ `reload`, `event.type === "reload"`, treść z magazynu); tak samo typ wdrożenia `load` (nagłówek `Node-RED-Deployment-Type: load` ignoruje treść żądania i wdraża zawartość magazynu): przy zarejestrowanym `preDeploy` handler dostaje zawartość magazynu z `event.type === "load"` i `event.rev`, a wdrażany jest ten sam obiekt. **D20:** `preDeploy` chroni zapisy przez API i runtime
  tej instancji, **nie treść magazynu** – treść odrzucona przy `reload` może trafić do flow przez przeładowanie z magazynu (Z-09, bez `preDeploy`)
  albo przy restarcie procesu; zalecenie dla konsumentów: walidować zapisy (`type !== "reload" && type !== "load"` – oba typy niosą treść z magazynu). **D26:** przy `reload` z Projektami błąd
  `credentials_load_failed` pojawia się **po** hooku (poświadczenia ładuje krok 3a); odrzucenie przez hook go przesłania – klient dostaje `deploy_rejected`.
  **Błąd odczytu magazynu:** dla `reload` i dla `load` przy zarejestrowanym `preDeploy` występuje przed stanem `deploying` (krok 2), więc bez przejścia `instance:state`;
  dla `load` bez handlera – wewnątrz `deploying`, jak przed #10.
- **Moment rejestracji:** raz na wdrożenie, pod blokadą, przed krokiem 2, czytane jest tylko, czy jakikolwiek handler `preDeploy` jest zarejestrowany: bez handlera wdrożenie idzie starą ścieżką także wtedy, gdy handler zostanie dodany w trakcie; listę handlerów krok 3 bierze w chwili wywołania (handler dodany przed krokiem 3 jest wywołany, usunięty - nie).
- **Ograniczenia (SEC-105):** hook nie jest granicą bezpieczeństwa – omijają go Z-09 (zapis do wspólnego magazynu), operacje Projektów, start procesu
  i kod w procesie (np. `RED.hooks.remove`; ta sama możliwość pozwala też podmienić `RED.hooks.has`).
- **Ponowne wejście (SEC-104):** z `preDeploy` i `postDeploy` nie wolno wdrażać. Wdrożenie z `preDeploy` czeka na blokadę trzymaną przez własne
  wdrożenie i kończy się 503 po `hookTimeout`; `postDeploy`, który wdraża, wdraża w nieskończoność.
- **`postDeploy`:** wywoływany asynchronicznie po wyniku, **dokładnie raz** dla każdej zapisanej albo przeładowanej konfiguracji (także gdy wdrożenie
  zakończyło się potem błędem, np. 500 `deploy_start_failed`; nigdy dla niezapisanej), równolegle z innymi handlerami, błąd tylko w logu.
  `event`: `{rev, type, source: "api"|"internal"|"storage", operation, flowId, user, reloadType?, start: {status, errors?}, error?, deadline, signal}`;
  `start.status`: `started` · `pending` (także `start_timeout` z `errors`) · `not_started` · `start_failed` · `stop_failed` · `unknown`. W chwili
  wywołania stan instancji to zwykle jeszcze `deploying` – wynik startu podają `instance:state` i `deploy-start-result`. Handler publikujący
  zmianę innym instancjom **musi pomijać `source === "storage"`**. Na handler `postDeploy` przypada **najwyżej 10 niezakończonych wywołań**: kolejne
  są pomijane z ostrzeżeniem w logu (`deploy.post-hook-skipped`), dopóki któreś się nie skończy – handler w postaci `(event, done)` **musi wywołać `done`**
  (bez `done` i bez zwróconej obietnicy wywołanie nigdy się nie kończy, a po 10 wdrożeniach handler przestaje być wołany do restartu).
- Hooki **nie** są wywoływane przy starcie procesu (wczytanie flow z magazynu), `POST /flows/state` ani przy operacjach Projektów (R-15);
  `preDeploy` nie jest wywoływany także przy przeładowaniu z magazynu (Z-09), `postDeploy` – tak (`source: "storage"`, gdy zapisano).
- Uprawnienia do typów węzłów (Z-12.08): wdrożenie z dodanym/zmienionym węzłem typu niedozwolonego dla użytkownika
  jest odrzucane w całości – **403 `node_type_not_permitted`** z `types[]` (R-27, R-33). Obsługiwane są obie listy
  (R-42): odbierająca (`["*", "!nodes.type.exec"]`) i dozwolonych (`["!nodes.type.*", "nodes.type.inject", …]`);
  przyznanie konkretnego typu ma pierwszeństwo przed `!nodes.type.*`, odebranie konkretnego typu – przed wszystkim.
  Przeładowanie z magazynu (typ `reload`, Z-09) nie jest kontrolowane per użytkownik (R-42).
- Wdrożenie przy `readOnlyUserDir: true` i magazynie plikowym: **400 `read_only_user_dir`** (R-18).

### 4.4 Pełny katalog kodów
[ZASADY.md](ZASADY.md) §2.4. Słowo `version` w kodach oznacza **rewizję flow** (`rev`), nie wersję API.

- **503 `runtime_stopping` (#84):** instancja się zatrzymuje (stan `stopping`/`stopped` – sygnał, `RED.health.shutdown()`,
  `RED.stop()`, także w trakcie drenażu `shutdownTimeout`). Odpowiedź na każde wdrożenie (`POST /flows` wszystkich typów,
  v1 i v2, `POST /flow`, `PUT`/`DELETE /flow/:id`) i na `POST /flows/state` `{state: "start"}`; treść `{code, message}`,
  komunikat stały, bez `Retry-After`. **Nic nie zostało zmienione** – bezpieczne ponowienie po restarcie instancji albo
  na innej instancji (np. przez Service w K8s). Odmowa ma pierwszeństwo przed 409/400 rewizji i 404 brakującego flow.
  Klient Admin API, który ponawia 503 `deploy_hook_*`, może tak samo ponawiać `runtime_stopping`; nie traktować go jak
  konfliktu rewizji. Wdrożenie, które zapisywało konfigurację, gdy zatrzymanie się zaczęło, jest zapisane i nie
  startuje: domyślnie 200 `{rev}`, w trybie `deploy.response: "started"` 500 `deploy_start_failed` z `rev` i
  `errors[].code: "runtime_stopping"` (nie powtarzać – zmiana wystartuje po restarcie). Hook `postDeploy` takiego
  wdrożenia ma `start.status: "not_started"` (zatrzymanie zaczęło się przed wynikiem; `"pending"`, gdy po wyniku –
  ostateczną prawdą jest wtedy `instance:state` `stopping`).

### 4.5 Stan instancji, sondy i zatrzymanie (E-02, Z-08, Z-15)

- **Nazwy stanów są kontraktem** (R-23): `init, starting, ready, deploying, reloadPending, reloading, idle, loaded, failed,
  stopping, stopped`. `init` – stan początkowy (przed startem runtime); `idle` – flow zatrzymane (`runtimeState` „stop”
  lub safe mode); `loaded` – instancja tylko edycyjna (`editorOnly`).
- **Zdarzenie `instance:state`** z treścią `{state, previous, reason}` (R-23); kod osadzający zatrzymuje runtime przez
  `RED.stop(reason)` – powód trafia do hooka `preShutdown` i logu.
- **Nieudany start (#67):** CLI `red.js` po odrzuceniu `RED.start()` woła `RED.stop("startup-error")` (bez hooka
  `preShutdown` i bez `health.unreadyGrace`, limit 5000 ms) i kończy się kodem 1; sygnał w trakcie tego zatrzymania
  kończy proces od razu kodem 1. Tryb osadzony bez zmian: `RED.start()` odrzuca tym samym błędem, stan to
  `failed`/`startup-error` (gdy odrzuci rejestracja Admin API, stan runtime może nie być `failed`), a własny serwer sond
  i uchwyty runtime żyją do `RED.stop(reason)`. Biblioteka nie woła `process.exit` – o procesie decyduje kod osadzający.
  Odpowiednik zachowania CLI (log błędu, zatrzymanie z limitem 5000 ms, kod 1 także przy nieudanym lub zawieszonym
  zatrzymaniu):

  ```js
  RED.start().catch(err => {
      // #73: the start was abandoned by RED.stop() - not a failed start, the application is already stopping
      if (err && err.code === "startup_stopped") return;
      console.error("Node-RED failed to start:", err);
      const stopped = Promise.resolve()
          .then(() => RED.stop("startup-error"))
          .catch(stopErr => console.error("Node-RED stop failed:", stopErr));
      const limit = new Promise(resolve => setTimeout(resolve, 5000));
      return Promise.race([stopped, limit]).finally(() => process.exit(1));
  });
  ```

  Kontrakt `/live` bez zmian.
- **Limit startu (`startupTimeout`, #71):** po przekroczeniu `RED.start()` odrzuca błędem z `code: "startup_timeout"`
  oraz polami `step` (krok, na który runtime czekał) i `timeout`; stan `failed`/`startup-error`, dalej jak przy
  nieudanym starcie wyżej. Krok, który skończy się po limicie, jest ignorowany (ostrzeżenie w logu, flow nie są
  wczytywane); późno uruchomiona wtyczka koordynacji dostaje od razu `resign()` i `stop()`, późny własny serwer sond i
  obserwator magazynu są zatrzymywane.
- **Zatrzymanie w trakcie startu (#73):** `RED.stop()` albo `RED.health.shutdown()` (sygnał w CLI), które przyjdą przed
  końcem startu, porzucają start w chwili wejścia instancji w stan `stopping` (także w trakcie drenażu
  `shutdownTimeout`). `RED.start()` od razu odrzuca błędem z `code: "startup_stopped"` oraz polami `step` (krok, na
  który start czekał, `null` przed pierwszym) i `reason` (przyczyna zatrzymania); runtime loguje jedno ostrzeżenie z
  krokiem. Timer `startupTimeout` jest czyszczony, więc proces osadzający kończy się sam po `RED.stop()` (limit, który
  odpalił przed zatrzymaniem, zachowuje wynik `startup_timeout`). Stan instancji: `starting` → `stopping` → `stopped`,
  bez `failed`. Krok, który skończy się po zatrzymaniu, jest ignorowany, a jego zasoby zwalniane jak po limicie.
  `RED.start()` wywołane po `RED.stop()` odrzuca `startup_stopped` ze `step: null` bez żadnego kroku. Ponowne
  `RED.init()` po `RED.stop()` w tym samym procesie nie jest obsługiwane: pierwszy `RED.start()` po takim `RED.init()`
  działa jak przed #73 (bez odrzucenia), kolejne – jak wyżej. `catch` przy
  `RED.start()` jest wymagany i powinien pominąć `startup_stopped` – to nie nieudany start (przykład wyżej); drugie
  `RED.stop("startup-error")` i kod 1 byłyby błędem.
- **Wdrożenie w trakcie zatrzymania (#84):** od wejścia w stan `stopping` żadne wdrożenie, przeładowanie ani start nie
  tworzy ani nie uruchamia flow (wdrożenia: 503 `runtime_stopping`, §4.4; start flow: jeden log `info` `The flows are not
  started: the runtime is stopping`). `RED.stop()` rozwiązuje się dopiero, gdy wszystkie flow są zatrzymane – także flow
  zostawione przez wdrożenie częściowe i flow uruchomione przez start, który już trwał: czeka na trwające zatrzymanie flow
  i na flow, które starty właśnie uruchamiają (każde najwyżej `nodeCloseTimeout`, potem ostrzeżenie), nigdy na instalację
  modułów ani blokadę wdrożeń. Węzły, które start utworzy po tym limicie, są zamykane, gdy ten start się skończy – już po
  rozwiązaniu `RED.stop()` (także po zamknięciu kontekstów); są zamykane jak przy zwykłym zatrzymaniu (`removed: false`),
  także gdy ich flow zostało usunięte z konfiguracji. Wdrożenie, które zapisywało konfigurację, gdy zatrzymanie się zaczęło
  (stan `stopping`, flow jeszcze działają), zatrzymuje tylko to, co zmienia (`full` – wszystko; otwarte zapytania HTTP
  dostają wtedy 503 po zatrzymaniu flow, co kończy wcześniej czekanie zatrzymania procesu na zapytania), i niczego nie
  uruchamia; po nim `GET /flows/state` i zdarzenie `runtime-state` mówią `stop`
  (`deploy: true`), choć niezmienione flow obsługują jeszcze ruch do `RED.stop()` – stan instancji to już `stopping`,
  `/ready` 503. Kod osadzający, który wołał `setFlows` po `RED.stop()`, dostaje odrzucenie `runtime_stopping`.
  Zmiana projektu w trakcie zatrzymania nie jest odrzucana; flow przełączonego projektu startują po restarcie. Sekwencja
  stanów bez zmian (`… → stopping → stopped`, nigdy `failed`/`ready` z powodu pominiętego startu).
- **Odrzucone żądanie `/flow` nie emituje `deploying` (#10, U1, A24, D19):** `POST /flow`, `PUT` i `DELETE /flow/:id` sprawdzają rewizje i budują
  konfigurację przed stanem `deploying`, więc odrzucone żądanie (409, 404, `duplicate_id`, `invalid_flow_id`, 400 `global`) nie przechodzi przez
  `deploying` i z powrotem: brak zdarzeń `instance:state`, brak chwilowego 503 na `/ready` i brak chwilowego wstrzymania z #8; nie unieważnia też
  oczekującego przeładowania z magazynu (Z-09). Odbiorca zdarzeń, który liczył takie żądania jako wdrożenie, ich już nie zobaczy.
  Zmiana nie zależy od hooków.
- **Warunek `reload` (R-47)** – obok stanu, nie nowy stan (tabela przejść R-23 bez zmian): zdarzenie i `runtime.state.get()`
  zawierają pole `reload` `{error: {code}, since, attempts, activeRev, rev, keepReady, staleDeadline, stale?}` – tylko
  gdy przeładowanie z magazynu nie powiodło się po wyczerpaniu ponowień (kod `storage_error`, `credentials_load_failed`,
  `invalid_flows`, `invalid_json`, `empty_file` lub `reload_failed`); **warunek istnieje tylko przy `onExhausted: "keepReady"`** –
  przy domyślnym `"fail"` brak pola, dodatkowych zdarzeń i logów (sekwencja zdarzeń jak przed R-47); brak pola = brak warunku. **Nowa reguła kontraktu:** `instance:state` jest emitowane
  także, gdy zmienia się **samo** pole `reload` (ustawienie, zmiana liczby prób, przekroczenie `maxStaleTime`, skasowanie)
  przy niezmienionym `state` – odbiorca, który ma reagować tylko na zmiany stanu, porównuje `state`, `reason` i `since`
  (nie liczy każdego zdarzenia jako przejścia). Gdy `keepReady` eskaluje do błędu konfiguracji (z `storage_error` na np. `invalid_flows`), odbiorca może zobaczyć jedno zdarzenie przejściowe – zdarzenie `failed` nosi jeszcze poprzedni warunek z `keepReady: true` – a zaraz po nim poprawiony warunek. Wtyczki i monitoring mogą z tego przekazywać alarm (np. do systemu alertów).
- **Warunek `httpDrain` (#82)** – obok stanu, jak `reload` (ta sama reguła kontraktu, tabela przejść R-23 bez zmian): tylko przy
  `deploy.drainHttpNodeRequests.enabled: true`, gdy zatrzymanie flow (wdrożenie, przeładowanie z magazynu, `POST /flows/state` stop, przełączenie
  projektu) czeka na zapytania HTTP przyjęte przez węzły, zdarzenie i `runtime.state.get()` zawierają pole `httpDrain: {requests, since, deadline}`
  (liczba zapytań, na które czeka, początek i najpóźniejszy koniec czekania, `Date.now()`); brak pola = brak czekania. Ustawienie i skasowanie pola
  emitują `instance:state` przy niezmienionym `state` (odbiorca porównuje `state`, `reason` i `since`); pole nie powstaje w `stopping`/`stopped`
  (ustawione wcześniej jest kasowane, gdy czekanie się skończy) ani przy czekaniu z sygnału zatrzymania. `/ready`, `state`, `previous`, `reason` i
  `since` bez zmian. Edytor dostaje równolegle zachowywane powiadomienie `/comms` `notification/http-drain` (`{type: "warning", text, count,
  limit}` – `limit` to `timeout` drenażu w ms; pola `timeout` nie ma, bo edytor czyta je jako czas samoczynnego zamknięcia; skasowanie – pusta treść). Przy wyłączonym ustawieniu sekwencja zdarzeń jak dotąd.
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

### 4.7 Drenaż zapytań HTTP przed zatrzymaniem flow (#40, R-49)

Dotyczy rozwiązań, które wołają Admin API (wdrożenie, `POST /flows/state`), klientów HTTP węzłów `http in` oraz węzłów
zewnętrznych rejestrujących trasy na `RED.httpNode`. Przy `deploy.drainHttpNodeRequests.enabled: false` (domyślnie) nic się nie zmienia.

- **Ustawienie:** `deploy: { drainHttpNodeRequests: { enabled, timeout, retryAfter } }` – `timeout` 30000 ms, `retryAfter` 1 s. Zakres:
  zapytania do tras `httpNode` z oznaczonym handlerem (rdzeń: `http in`), globalnie (nie per flow).
- **Czas wdrożenia:** `POST /flows`, `POST /flows/state` stop i przeładowanie z magazynu trwają **do `timeout` dłużej** (drenaż jest pod blokadą
  wdrożeń, a w klastrze trzyma slot Z-10: przejście klastra wydłuża się o N × `timeout`; zalecane `deploy.reload.concurrency`).
  Najgorszy czas przeładowania Z-09: czekanie na blokadę (drenaż poprzedniej operacji + `nodeCloseTimeout` + start) + `preReloadTimeout` +
  `timeout` + `nodeCloseTimeout` + start; `PreReloadEvent.deadline` jest limitem hooka, **nie najpóźniejszą chwilą zatrzymania flow**.
  Klienci Admin API muszą mieć limit czasu żądania dłuższy niż `timeout` + czas zatrzymania węzłów.
- **Limit twardy (P1):** zapytanie dłuższe niż `timeout` dostaje 503 także we flow, których wdrożenie nie zmieniało. Długie raporty i eksporty
  powinny mieć `timeout` dłuższy niż najdłuższe zwykłe zapytanie albo być asynchroniczne (zwracać identyfikator zadania). Endpointy long-poll
  i SSE na `http in` ustaw na „Połączenie długotrwałe (SSE/long-poll)” (`drainMode: "long"`, niżej) – bez tego wstrzymują każde wdrożenie o pełny
  `timeout`, a potem są zrywane. `timeout` powyżej 300000 ms daje jedno ostrzeżenie przy starcie (`httpDrain.long-timeout`, #82).
- **Dwa kody 503 (ciało stałe `{code, message}`, `Cache-Control: no-store`, bez URL i tekstu błędu):**
  - `http_drain_not_accepted` – zapytanie nie trafiło do flow (np. ciało jeszcze nie było odczytane, uwierzytelnianie w toku): **bezpieczne do
    ponowienia**; zawsze `Retry-After`; `Connection: close`, gdy ciało nie zostało odczytane do końca;
  - `http_drain_outcome_unknown` – zapytanie trafiło do flow, a flow zatrzymano przed odpowiedzią: **wynik nieznany**; `Retry-After` tylko dla
    GET, HEAD i OPTIONS.
  Przyczyna (limit czy zatrzymanie) idzie tylko do logu operatora. Odpowiedź już rozpoczęta (strumień) jest niszczona (połączenie zerwane).
  Nagłówki ustawione wcześniej przez handler trasy (np. `Set-Cookie`, `Content-Encoding`) są usuwane z tego 503; zostają `Access-Control-*`
  i `Vary`.
- **Idempotencja (SEC-002, SEC-007):** `outcome_unknown` oznacza, że flow mógł zadziałać. Flow z zapisami lub płatnościami wymagają **klucza
  idempotencji** po stronie klienta (ponowienie z tym samym kluczem). Przy włączonym drenażu klient ma prawo traktować GET jako bezpieczny do
  ponowienia (`Retry-After`) – flow z efektami ubocznymi na GET są niedozwolone; efekty uboczne obsługuj przez POST.
- **Kontrakt dla węzłów zewnętrznych (opcjonalny):** jeden symbol `Symbol.for("node-red.httpNode.drain")` (bez `require` runtime), którego
  właścicielem jest runtime, ma **dwa znaczenia** (A17): na handlerze trasy – `handler[S] = true` (trasa jest drenowana); na `req` i `res` –
  wpis runtime (istnieje tylko przy włączonym ustawieniu; węzeł go **nie tworzy**). Węzeł, który chce być drenowany: (1) oznacza handler trasy,
  (2) na początku handlera: `const e = req[S]; if (e) { if (e.drained) return; e.accepted = true; }` tuż przed przekazaniem wiadomości do flow,
  (3) przy późnej odpowiedzi sprawdza `res[S] && res[S].drained` i nic nie wysyła (zapytanie dostało już 503). Trasy bez znacznika (np. `bot-start`)
  nie są drenowane – wymagają własnej obsługi. Na zapytanie runtime czeka tylko wtedy, gdy jest otwarte, przyjęte (`accepted`) **i** na trasie ze
  znacznikiem (#82) – `accepted` na trasie bez znacznika nic nie zmienia. Węzeł z połączeniami długotrwałymi (SSE, long-poll) **zostawia handler bez
  znacznika** i sam zamyka swoje otwarte odpowiedzi w `close` (jak `http in` w trybie `"long"`); rekord `debug` odpowiedzi 503 nazywa węzeł trasy
  zarejestrowanej przez `node.registerHttpRoute` (§5).
- **`http in` – „Przy zatrzymaniu” (`drainMode`, #82):** nowa właściwość węzła we flow JSON (eksportowane flow): `"drain"` (domyślnie; brak lub inna
  wartość = `"drain"`, zachowanie bez zmian) albo `"long"`: trasa bez znacznika (drenaż nie czeka i nie odpowiada 503), `accepted` nie jest
  ustawiane, a przy zatrzymaniu węzła (wdrożenie `full`, wdrożenie `flows` zmieniające węzeł połączony z `http in`, usunięcie, `RED.stop`) jego
  otwarte odpowiedzi są niszczone (połączenie zamknięte); działa przy włączonym i wyłączonym drenażu. Klient SSE (EventSource) łączy się ponownie
  sam, klient long-poll widzi błąd sieci i musi ponowić. Strumień zostaje otwarty i cichy, gdy restartowany jest tylko pisarz (wdrożenie `nodes`
  zmieniające tylko jego; w `flows` i `nodes` pisarz za węzłami link albo z odpowiedzią w kontekście) – zalecany heartbeat. Tylko dla SSE/long-poll:
  zwykłe zapytanie w tym trybie jest zrywane zamiast obsłużone.
- **Zapytania w czasie drenażu:** nowe zapytania są przepuszczane do starych flow (nie przedłużają drenażu, ale dostają termin); `holdHttpNodeRequests`
  (#8) nie jest zmieniony. Zapytanie w fazie `rawBodyCapture` (upload do trasy z `skipBodyParsing`, jeszcze bez dopasowanej trasy) nie jest objęte
  gwarancją: po zatrzymaniu dostaje 404 albo trasę nowego flow.
- **Różnice względem wyłączonego ustawienia (świadome):** wiadomość odłożona w kontekście i odpowiedziana później przez nowe flow (stash/LATE)
  przy zatrzymaniu pełnym dostaje 503 zamiast późnego 200 (późna odpowiedź `http response` jest tylko w logu `debug`); symbol na handlerze `http in`
  jest nieobserwowalny (nie dodaje warstwy trasy).
- **Stan instancji i sondy:** brak nowego stanu (R-23), `/ready` bez zmian: `deploying`/`reloading`/`stopping` → 503; przy `POST /flows/state` stop
  i przełączeniu projektu `/ready` odpowiada 200 przez cały drenaż. Czekanie widać w polu `httpDrain` zdarzenia `instance:state` (§4.5, #82).
- **Usuwanie i wyłączanie typów węzłów (#82):** w czasie zatrzymania z drenażem (czekanie i zatrzymywanie węzłów) `DELETE /nodes/<moduł>`,
  `PUT /nodes/<moduł>` i `PUT /nodes/<id>` z `enabled: false` odpowiadają **409** `{code: "http_drain_in_progress", message}` (stały komunikat,
  bez nazwy modułu; audyt `nodes.remove` / `nodes.module.set` / `nodes.info.set`) – skrypty usuwające moduły zaraz po wdrożeniu muszą ponowić po
  wdrożeniu (do `timeout`). `not_found` i `type_in_use` mają pierwszeństwo i swój status. Instalacja, aktualizacja i włączanie bez zmian.
  `credentials.clean` nadal działa na nowej konfiguracji.
- **Zatrzymanie procesu:** `RED.stop` nie czeka na zapytania (R-37): po zatrzymaniu flow `finalize` odpowiada 503 albo niszczy odpowiedź; trwający
  drenaż wdrożenia przerywa dopiero `RED.stop`, więc przy `shutdownTimeout` trwa w czasie `preShutdown`. **Sygnał zatrzymania (#82):** przy
  `shutdownTimeout` `health.shutdown` (CLI, `RED.health.shutdown`) po `health.unreadyGrace` i hookach `preShutdown` czeka na zapytania przyjęte w tej
  chwili, najwyżej `min(timeout, czas pozostały z shutdownTimeout)` (logi `httpDrain.shutdown-waiting`, `httpDrain.shutdown-timeout`), potem
  `RED.stop`; drugi sygnał kończy czekanie od razu. Działa od razu w istniejących konfiguracjach z oboma ustawieniami (wyjątek D8, R-49). Kod
  osadzający, który woła `RED.stop()` wprost, nie czeka – może użyć `RED.health.shutdown({reason, signal})` (samo woła `RED.stop`). Kubernetes:
  `terminationGracePeriodSeconds` ≥ `shutdownTimeout` + 15 s (`nodeCloseTimeout`) + 5 s (zamknięcie serwera).

## 5. Wtyczki i produkt

| Obszar | Zmiana | Pakiet |
|---|---|---|
| Wtyczka magazynu | opcjonalna funkcja `watchFlows(callback)` – powiadomienia o zmianie flow z innej instancji | Z-09 |
| Wtyczka koordynacji | nowy typ wtyczki `node-red-coordination` (lider, zajęcie zadania); wybór tylko jawnie w `coordination.plugin`; `inject` z `singleInstance`: cron – zajęcie klucza `<id>:<czas>` (dokładnie raz), interwał – lider (D-14); węzeł na instancji niebędącej liderem pokazuje status „standby”; `mqtt in` z `singleInstance` – osobny pakiet (R-21); `start` tylko łączy z koordynatorem i nie czeka na przywództwo; przy `startupTimeout` (#71) start wtyczki, który rozwiąże się po limicie albo po zatrzymaniu (#73), jest od razu zakończony wywołaniami `resign()` i `stop()` (`stop()` także wtedy, gdy `resign()` się nie powiedzie), a start, który nigdy się nie rozstrzygnie, nie może zostać zwolniony – wtyczka powinna mieć własne limity połączenia | Z-10 |
| Hooki | `preDeploy` (tylko walidacja: 400 `deploy_rejected` + `reason`, 503 `deploy_hook_failed`, 503 `deploy_hook_timeout`; §4.3), `postDeploy` (source `api`/`internal`/`storage`, asynchronicznie), `preReload` (bez weta), `preShutdown` (z `reason`); brak hooków wdrożenia przy starcie procesu i operacjach Projektów (R-15, R-20, R-23, R-50); **`preDeploy` i `postDeploy` rejestruje się tylko przez `RED.hooks.add`** (wtyczka, węzeł); `preReload` i `preShutdown` także z ustawienia `hooks` w `settings.js` (rejestracja przy `init`, #7). **Handler bez parametrów** (`function(){}`, `() => {}`, `async () => {}`) hooka wywoływanego przez `trigger` (wiadomości, instalacja modułów, `preReload`, `preShutdown`, hooki edytora) dostaje `(payload, done)` i musi wywołać `done`, inaczej łańcuch się nie kończy – jak w upstream; od #63 rejestracja zapisuje jedno ostrzeżenie (runtime: log `warn` z miejscem rejestracji, edytor: `console.warn`) – zadeklaruj `(payload)`. `preDeploy` i `postDeploy` nie są objęte (wywoływane jako `fn(event)`, bez ostrzeżenia). Od #63 synchroniczne `throw` wartości fałszywej (`undefined`, `null`, `false`, `0`, `""` …) kończy łańcuch błędem, a każdy krok handlera kończy się raz (pierwszy wynik) | Z-06, Z-09, Z-08 |
| Trasy administracyjne bloczków | przy `httpAdminNodeRoutes: "authenticated"` trasa bez uprawnienia wymaga sesji; publiczne – `RED.auth.publicRoute()` | Z-02 |
| Trasy HTTP bloczków | `node.registerHttpRoute(method, path, ...handlers)` → zamrożony uchwyt `{method, path, remove()}`; runtime zdejmuje trasę sam przy każdym zatrzymaniu węzła (wdrożenie, usunięcie, zatrzymanie flow, `RED.stop`) – bez własnego `close` i bez `_router`; `remove()` zdejmuje wcześniej; zob. §5.3 (#11, R-53) | Z-07 |
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
  i seriami (runtime łączy powiadomienia), także dla zapisów tej samej instancji (pomijane po rewizji i skrócie poświadczeń).
- **Poświadczenia porównuje runtime** (#2): obok rewizji flow liczy skrót (HMAC-SHA-256 z kluczem losowym dla procesu, z kanonicznego JSON o posortowanych
  kluczach) **odszyfrowanej** zawartości poświadczeń odczytanych z magazynu i porównuje go ze skrótem poświadczeń
  działającej konfiguracji. Szyfrogramu się nie porównuje (losowy IV zmienia go przy każdym zapisie), więc ponowne
  zaszyfrowanie tych samych poświadczeń nie jest zmianą. Przeładowanie następuje, gdy różni się rewizja **lub** skrót
  poświadczeń – zmiana samych poświadczeń wymaga tylko powiadomienia (z flagą lub bez), a zgubione powiadomienie
  naprawia kolejne. Skrót jest wewnętrzny: nie jest logowany ani zwracany przez żadne API (`GET /flows` zwraca tylko
  `{flows, rev}`). Poświadczenia są odczytywane kluczem, którego użyłoby wczytanie poświadczeń (także starym wygenerowanym kluczem w trakcie migracji do `credentialSecret`, bez migrowania i zapisu); te, których nie da się odszyfrować, to błąd `credentials_load_failed`
  (ta sama ścieżka co błąd przeładowania: ponowienia `retry`, `failed`; `onExhausted: "keepReady"` go nie utrzymuje). Wyjątek: gdy działająca konfiguracja wystartowała z poświadczeniami, których nie dało się odszyfrować (nie ma skrótu), a rewizja flow w magazynie jest działającą, nieodszyfrowalne poświadczenia nie są błędem (jak przed #2) – nowa rewizja idzie normalną ścieżką. Zmiana poświadczeń w trakcie drenażu przeładowania `diff` daje dodatkową rundę `preReload` dla wszystkich flow (`changedFlows: null`, `credentialsChanged: true`).
- **`credentialsChanged` w powiadomieniu jest tylko wskazówką** do odczytu magazynu (każde powiadomienie go wywołuje).
  Samo nie wymusza przeładowania (dawniej wymuszało, z pominięciem porównania rewizji) i nie blokuje go. **Zmiana
  zachowania dla wtyczek magazynu**, które używały flagi do wymuszenia przeładowania: flaga nie wymusza już
  przeładowania – wystarczy, że `getCredentials()` zwraca zmienioną zawartość; flagę można nadal przekazywać
  (jest ignorowana poza wywołaniem odczytu).
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
| `type` | `"full"` \| `"diff"` – **typ z konfiguracji** (`deploy.reload.type`), a nie faktyczny typ przeładowania (#43): przy `"diff"` przeładowanie jest pełne, gdy zmieniły się poświadczenia (także w trakcie drenażu – wtedy dodatkowa runda ma `changedFlows: null`) albo przy zmianie globalnej, a w ładunku jest wtedy `{type: "diff", changedFlows: null}`; dodatkowa runda po zmianie samych flow ma listę nowych flow i przeładowanie pozostaje `diff`. **O zakresie przeładowania decyduje `changedFlows`**, nie `type` |
| `changedFlows` | id flow (zakładek, subflow) restartowanych; `null` = wszystkie (`full`, zmiana konfiguracji globalnej lub węzła konfiguracyjnego poza flow, zmiana poświadczeń, dodatkowa runda po zmianie poświadczeń w trakcie drenażu). **To pole rozstrzyga o zakresie** |
| `credentialsChanged` | **obliczone** (#2): poświadczenia w magazynie różnią się (skrót odszyfrowanej zawartości) od działających – nie jest kopią flagi powiadomienia |
| `deadline` | `Date.now() + preReloadTimeout` z chwili rozpoczęcia drenażu (wspólny dla dodatkowej rundy D-17) |
| `signal` | `AbortSignal`; `reason`: `"stopping"` (zatrzymanie procesu) lub `"superseded"` (wdrożenie na tej instancji) |

- Handler musi **deklarować parametr** `event` (semantyka hooków Node-RED: funkcja bez parametrów jest traktowana jak
  wariant z `done` i nie kończy się) i zwrócić obietnicę rozwiązywaną, gdy praca w toku się zakończy.
- Brak prawa weta (R-20): błąd, odrzucenie, `false` lub przekroczenie limitu → log i przeładowanie mimo to.
- `/ready` 503 od wywołania hooka do końca przeładowania; hook działa **bez** blokady wdrożeń; `preDeploy` nie jest
  wywoływany przy przeładowaniu z magazynu (`postDeploy` z `source: "storage"` – tak, gdy zapisano; Z-06, R-50).
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

### 5.3 Trasy HTTP węzłów: `node.registerHttpRoute` (Z-07, #11, R-53)

Dotyczy węzłów spoza rdzenia, które rejestrują trasy na `RED.httpNode`. Trasy dodane po staremu działają jak dotąd (nie są
zdejmowane automatycznie); przejście jest zalecane, bo prywatny `_router` znika w Express 5.

**Przed:**

```js
function MyNode(n) {
    RED.nodes.createNode(this, n);
    const node = this;
    const handler = function(req, res) { /* ... */ };
    RED.httpNode.post(n.path, handler);
    node.on("close", function() {
        // własne zdejmowanie po prywatnym stosie routera
        const stack = RED.httpNode._router.stack;
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].route && stack[i].route.stack.some(l => l.handle === handler)) {
                stack.splice(i, 1);
            }
        }
    });
}
```

**Po:**

```js
function MyNode(n) {
    RED.nodes.createNode(this, n);
    // ... reszta konstruktora; trasa na końcu
    this.registerHttpRoute("post", n.path, function(req, res) { /* ... */ });
}
```

- **Zdejmowanie:** usuń własny `splice` z `close` – runtime zdejmuje trasy instancji na początku `close` (przed callbackami `close`)
  i przy zatrzymaniu węzła przez flow, także gdy węzeł nadpisuje `close`. `remove()` z uchwytu zdejmuje trasę wcześniej (idempotentne,
  działa bez `this`).
- **Rejestruj na końcu konstruktora:** konstruktor, który rzuci po rejestracji, zostawia trasę do restartu (węzeł nie powstaje, runtime
  go nie zamyka).
- **Argumenty:** metoda `get|post|put|patch|delete|options|head|all` (dowolna wielkość liter); ścieżka – string albo `RegExp`, bez
  zmian dla Express; handlery – funkcje albo tablice funkcji (także handler błędu o 4 argumentach). Inaczej `TypeError` i nic nie jest
  dodane. Rejestracja po rozpoczęciu zamykania węzła jest pomijana z jednym ostrzeżeniem (`httpRoutes.after-close`).
- **Czego API nie dodaje:** `httpNodeMiddleware`, CORS, parsowania cookies i ciała – przekaż je sam w `handlers` (jak `http in`).
  `httpNodeAuth` obowiązuje (ta sama aplikacja).
- **Drenaż (#40, §4.7):** opcjonalnie oznacz handler kończący żądanie `handler[Symbol.for("node-red.httpNode.drain")] = true` – jak dotąd;
  połączeń długotrwałych (SSE, long-poll) nie oznaczaj, zamykaj je w `close`. Rekord `debug` odpowiedzi 503 drenażu nazywa węzeł trasy
  zarejestrowanej przez to API (`id`, `type`, `z`, #82).
- **Zgodność:** sprawdź `typeof node.registerHttpRoute === "function"`, jeśli węzeł ma działać także na runtime bez tego API.

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
- [ ] Każde narzędzie Admin API: v2, wysyła rewizję, obsługuje `version_mismatch` i `version_required`, `deploy_start_failed` (przyjmuje `rev`; `errors[].code` m.in. `safe_mode`, `start_timeout`), `deploy_rejected` (z `reason` i opcjonalnym `details`), 503 `deploy_hook_failed`; `POST /flow` → 201 tylko w v2 (R-34); odpowiedź `{rev, started: false}` instancji `editorOnly` (R-39).
- [ ] Kod nie wywołuje `waitForDeployStart()` (N-02).
- [ ] Konfiguracje globalne w `globalConfigs[]`, nie w `configs` (gdy używane `/flow`).
- [ ] K8s: sondy i drenaż wg §3.3.
- [ ] Dodatki edytora przeniesione na API Z-12 (po wdrożeniu Z-12); linki w formacie `#flow/<id>/node/<id>`; źródła osadzenia w `editorTheme.embedding.allowedOrigins` (R-28).
- [ ] Narzędzia obsługują 503 `runtime_stopping` (#84: instancja się zatrzymuje, nic nie zmieniono – ponowienie po restarcie albo na innej instancji; w `deploy_start_failed` jako `errors[].code` – zapisane, nie powtarzać).
- [ ] Narzędzia obsługują 503 `deploy_hook_timeout` i `deploy_hook_failed` (ponowienie później; nic nie zapisano), 403 `node_type_not_permitted`, 400 `read_only_user_dir`; `DELETE /flow/:id` z `?rev=` (R-14, R-15, R-18, R-27).
- [ ] Monitoring stanu: nazwy stanów i zdarzenie `instance:state` wg §4.5; brak parsowania treści 503 sondy (R-22, R-23).
- [ ] Lista `Origin` dla `/comms` i `editorTheme.embedding.allowedOrigins` ustawione na naszych instalacjach (R-06, R-35); klienty `/comms` bez założenia `auth fail` przy wyłączonym `adminAuth` (R-05).
- [ ] Konfiguracja uploadu tylko przez `externalModules.palette.allowUpload` (R-17); instancje tylko do odczytu – `readOnlyUserDir` lub zmienna środowiskowa (R-18).
- [ ] Drenaż HTTP (#40, §4.7): limit czasu żądań Admin API dłuższy niż `deploy.drainHttpNodeRequests.timeout`; klienty HTTP obsługują 503 `http_drain_not_accepted` (ponowienie) i `http_drain_outcome_unknown` (klucz idempotencji; GET traktowany jako bezpieczny); węzły zewnętrzne z trasami na `httpNode` – opcjonalny kontrakt symbolu (połączenia długotrwałe – handler bez znacznika); endpointy SSE/long-poll na `http in` – `drainMode: "long"`; skrypty usuwające lub wyłączające moduły – ponowienie po 409 `http_drain_in_progress`; odbiorcy `instance:state` – pole `httpDrain` (#82).
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
