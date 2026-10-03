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
| Z-09 | – | `deploy.reload: {watch, type, preReloadTimeout, concurrency}` | `watch: false`, `type: "full"`, `preReloadTimeout: 1200000` (20 min) | to samo przeładowanie, co typ wdrożenia `reload` w Admin API; rekomendowane `type: "diff"`; `concurrency` – tylko liczba; bez łączności z koordynatorem przeładowanie czeka (działa stara konfiguracja) (R-20) |
| Z-09 | – | `deploy.reload.retry: { min, max, attempts }` | `min: 1000`, `max: 60000` (ms), `attempts: 10` (~8 min) (R-36) | ponowienia odczytu magazynu; po wyczerpaniu `attempts` → stan `failed`, `/ready` 503 (R-20, D-18, R-36); przy `watch: true` błąd rejestracji `watchFlows` → błąd startu (R-36) |
| P-01 / Z-08 | – | `deploy.startTimeout` (ms) | wyłączony | limit czasu startu w trybie `deploy.response: "started"`; po przekroczeniu 500 `deploy_start_failed` z `errors[].code: "start_timeout"`, flow startują dalej w tle (R-38) |
| Z-06 | – | `deploy.hookTimeout` | 30000 ms | |
| Z-10 | – | `coordination: {plugin, options}`; `singleInstance` w węźle `inject` | wtyczka lokalna | wtyczkę zewnętrzną wybiera się **tylko jawnie** w `coordination.plugin` (bez automatycznego wykrywania) (R-21) |
| Z-11 | `readOnlyUserDir` | `readOnlyUserDir` + zmienna środowiskowa `NODE_RED_READ_ONLY_USER_DIR` (R-33) | `false` | inne niż istniejące `readOnly` magazynu plikowego (`readOnly` opisane w szablonie `settings.js` – R-40); zmienna działa także w CLI przed wyborem pliku ustawień (R-18); chroni także bezwzględny `flowFile` (R-40) |
| Z-15 | – | `editorOnly` | `false` | wyklucza się z `disableEditor`; wybrane zamiast `runtimeState.autoStart` (R-19) |
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
| Globalne węzły konfiguracyjne – rewizja | `globalRev` (R-13) | wysyłać `globalRev` razem z `globalConfigs[]` |
| `PUT /flow/:id` nieistniejącego id przy `deploy.putCreatesFlow: true` | tworzy flow pod tym id; rewizja `rev: null`; **201** w v2 / **200** w v1 (R-34) | – |
| `PUT /flow/:id` nieistniejącego id bez `deploy.putCreatesFlow` | **404** jak dotąd (R-34) | utworzyć flow przez `POST /flow` |
| `DELETE /flow/:id` przy `requireRevision: true` | wymaga `?rev=` – brak → 409 `version_required` (R-14) | dołączać `?rev=<rev flow>` |
| Globalne węzły konfiguracyjne razem z flow | nowe pole `globalConfigs[]` (D-08) – pole `configs` zachowuje dotychczasowe znaczenie (konfiguracje flow) | nie wysyłać konfiguracji globalnych w `configs` |

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
- Instancja tylko edycyjna (`editorOnly: true`): odpowiedź **`{rev, started: false}`** bez błędu – flow nie są
  uruchamiane (R-39).
- Błąd zatrzymania: 500 `deploy_stop_failed` z `rev`.

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
- **Sondy** (`health.enabled`, R-19, R-22): `/health/ready` → 200 w `ready` i `loaded`; 503 m.in. w `idle` (safe mode,
  zatrzymane flow), `failed`, `stopping`. Treść 503 jest **stała**: `{"status":"unavailable"}` – nie zawiera nazwy stanu
  (stan odczytywać ze zdarzenia `instance:state` / `runtime.state`, nie z sondy).
- **Przeładowanie z magazynu** (Z-09, R-20): `preReload` nie ma prawa weta (tylko opóźnia, limit `preReloadTimeout`);
  przy dodatkowych flow zmienionych po drenażu – ponowny `preReload` dla nich (D-17), poza blokadą, najwyżej jedna
  runda, potem przeładowanie z ostrzeżeniem w logu (R-36); błąd odczytu magazynu → ponowienia wg `deploy.reload.retry`
  (domyślnie 10 prób, ~8 min), po wyczerpaniu `failed` i 503 (D-18, R-36); przy `deploy.reload.watch: true` błąd
  rejestracji `watchFlows` → błąd startu instancji (R-36).
- **Instancja tylko edycyjna** (`editorOnly: true`, R-19): przycisk `inject` i akcja „Restart flows” w edytorze
  ukryte/nieaktywne (R-39); operacje wymagające działających flow → 409 `editor_only`; wdrożenie w trybie
  `deploy.response: "started"` → `{rev, started: false}` (R-39).

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
| Hooki | `preDeploy` (tylko walidacja), `postDeploy` (source `api`/`internal`/`storage`, asynchronicznie), `preReload` (bez weta), `preShutdown` (z `reason`); brak hooków wdrożenia przy starcie procesu i operacjach Projektów (R-15, R-20, R-23) | Z-06, Z-09, Z-08 |
| Trasy administracyjne bloczków | przy `httpAdminNodeRoutes: "authenticated"` trasa bez uprawnienia wymaga sesji; publiczne – `RED.auth.publicRoute()` | Z-02 |
| Trasy HTTP bloczków | `node.registerHttpRoute(method, path, ...handlers)` – automatyczne zdejmowanie przy zamknięciu | Z-07 |
| Dodatki edytora (15 obecnych) | przeniesienie na API z Z-12.01…Z-12.14 (bez selektorów DOM); kolejność pakietów Z-12c → a → b → d → e; przestarzałe API – min. jedna wersja minor z ostrzeżeniem (R-24) | Z-12 |
| Logowanie (12.01) | **wariant A**: skrypty logowania przez `editorTheme.page.scripts` lub wtyczkę motywu (bez zmian serwera); dodatkowe pola/kroki – hook edytora `loginPost` z własną trasą pluginu (R-25) | Z-12 |
| Kod jednorazowy (12.02) | kod wydaje własna strategia `adminAuth`/plugin; rdzeń przyjmuje `#code=<kod>&next=<hash>`; przechowywanie tokena: `editorTheme.auth.tokenStorage` – `"local"` (domyślnie, `localStorage`) lub `"session"` (`sessionStorage`) (R-26, R-33) | Z-12 |
| Uprawnienia (12.08) | zakresy podrzędne `flows.deploy`, `flows.import`, `flows.export`, `nodes.type.<typ>` dziedziczone z rodzica; wpis z prefiksem `!` odbiera, np. `["*", "!nodes.type.exec"]`; lista dozwolonych: `["!nodes.type.*", "nodes.type.inject", …]` – przyznanie konkretnego typu wygrywa z `!nodes.type.*`, odebranie konkretnego typu wygrywa ze wszystkim (R-42); serwer egzekwuje typy przy wdrożeniu (bez kontroli przy przeładowaniu z magazynu – R-42); `flows.export` – tylko utrudnienie w UI (R-27) | Z-12 |
| Linki i osadzanie (12.10) | głęboki link `#flow/<flowId>/node/<nodeId>` (obsługa `hashchange`, akcja `core:reveal-node`); `postMessage`, w tym kanał `set-theme`, tylko ze źródeł z `editorTheme.embedding.allowedOrigins` – produkt osadzający edytor musi się tam wpisać (R-28); brak ustawienia = zachowanie 5.0.7 z ostrzeżeniem w logu (R-35) | Z-12 |
| Klucze zarezerwowane | węzeł nie może zarejestrować ustawienia o nazwie `deploy`, `flows`, `health`, `coordination` | D-02 (U8) |

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
