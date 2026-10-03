# Przewodnik dostosowania innych rozwiązań do forka Node-RED

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

Data: 2026-10-03 · status: **obowiązujący dla planowania** (nazwy wg D-02 – przyjęte; kontrakty API wg kart pakietów –
mogą się doprecyzować w trakcie realizacji; zmiany oznaczone pakietem) · decyzje: [ANALIZA.md](ANALIZA.md) §7.

## 1. Po co ten dokument

Decyzja **D-02** przyjmuje nazwy ustawień i API inne niż w tekście zlecenia i w README załącznika A. Decyzja **N-03**:
nie dodajemy w silniku aliasów starych nazw – **dostosowujemy inne rozwiązania**. Dokument mówi, co i gdzie zmienić:

| Odbiorca | Rozdział |
|---|---|
| Konfiguracja instancji (`settings.js`, obraz, Helm/`values.yaml`) | §3 |
| Produkt korzystający z Node-RED jako silnika (Bot-Engine), dodatki edytora | §3, §5, §6 |
| Narzędzia Admin API: automaty, asystenci AI (MCP), CI/CD | §4 |
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
| Z-09 | – | `deploy.reload: {watch, type, preReloadTimeout, concurrency}` | `watch: false`, `type: "full"` | to samo przeładowanie, co typ wdrożenia `reload` w Admin API; rekomendowane `type: "diff"` |
| Z-06 | – | `deploy.hookTimeout` | 30000 ms | |
| Z-10 | – | `coordination: {plugin, options}`; `singleInstance` w węźle `inject` | wtyczka lokalna | |
| Z-11 | `readOnlyUserDir` | `readOnlyUserDir` | `false` | inne niż istniejące `readOnly` magazynu plikowego |
| Z-15 | – | `editorOnly` | `false` | wyklucza się z `disableEditor` |
| Z-03 | – | `externalModules.palette.allowDowngrade` | `true` | |
| Z-14 | – | `editorTheme.flowLayout.enabled` | `false` | układ flow (pionowy/hybrydowy) |

### 3.3 Kubernetes (wartości przykładowe dla rozmów do ~15 min)

| Ustawienie Node-RED | Manifest K8s |
|---|---|
| `health.port`, `health.path` | `readinessProbe.httpGet` (`<path>/ready`), `livenessProbe.httpGet` (`<path>/live`) |
| `shutdownTimeout: 1140000` (19 min) | `terminationGracePeriodSeconds: 1200` (20 min) – grace period dłuższy niż drenaż |
| `deploy.reload.preReloadTimeout: 1200000` | – |
| workery: `disableEditor: true`, `httpAdminRoot: false` (Admin API wyłączone) | sondy na osobnym porcie (`health.port`) |

## 4. Narzędzia Admin API (automaty, MCP, CI/CD)

### 4.1 Rewizje i konflikty (Z-04, Z-05, istniejące)

| Sytuacja | Odpowiedź | Co ma zrobić narzędzie |
|---|---|---|
| Rewizja w żądaniu ≠ aktualna | 409 `version_mismatch` (bez zmian) | pobrać aktualny stan (`GET /flows` lub `GET /flow/:id`), nanieść zmiany, ponowić z nową rewizją |
| Brak rewizji przy `deploy.requireRevision: true` | 409 `version_required` | jw. – zawsze wysyłać rewizję |
| Wdrożenie API **v1** (sama tablica) przy `requireRevision: true` | zawsze 409 `version_required` | **przejść na v2** (`Node-RED-API-Version: v2`, treść `{flows, rev}`) |
| `GET /flow/:id` z nagłówkiem v2 | zawiera `rev` flow (Z-04) | używać tej rewizji w `PUT /flow/:id` |
| `PUT /flow/:id` nieistniejącego id przy `deploy.putCreatesFlow: true` | tworzy flow pod tym id; rewizja `rev: null` | – |
| `DELETE /flow/:id` | wymóg `?rev=` – **do potwierdzenia** (karta Z-05) | – |
| Globalne węzły konfiguracyjne razem z flow | nowe pole `globalConfigs[]` (D-08) – pole `configs` zachowuje dotychczasowe znaczenie (konfiguracje flow) | nie wysyłać konfiguracji globalnych w `configs` |

**Zalecenie:** wszystkie narzędzia na API **v2** i obsługa obu kodów 409 (`version_mismatch`, `version_required`) tą samą
ścieżką „pobierz – nanieś – ponów”. Pytanie N-04 (czy narzędzia dziś używają v2) – **nieznane**, więc przewodnik zakłada
sprawdzenie każdego narzędzia (lista kontrolna §7).

### 4.2 Odpowiedź wdrożenia (P-01, `deploy.response: "started"`)

- Odpowiedź przychodzi po starcie flow; endpointy nowego flow odpowiadają od razu.
- Błąd startu: **500 `deploy_start_failed`** z `rev` i `errors[]` – konfiguracja **jest zapisana**; narzędzie powinno
  przyjąć nową rewizję (żeby kolejne wdrożenie nie dostało 409) i zgłosić błąd.
- Błąd zatrzymania: 500 `deploy_stop_failed` z `rev`.

### 4.3 Walidacja przed wdrożeniem (Z-06)

- Odrzucenie przez hook `preDeploy`: **400 `deploy_rejected`** z komunikatem; przekroczenie limitu: 400 `deploy_hook_timeout`.

### 4.4 Pełny katalog kodów
[ZASADY.md](ZASADY.md) §2.4. Słowo `version` w kodach oznacza **rewizję flow** (`rev`), nie wersję API.

## 5. Wtyczki i produkt

| Obszar | Zmiana | Pakiet |
|---|---|---|
| Wtyczka magazynu | opcjonalna funkcja `watchFlows(callback)` – powiadomienia o zmianie flow z innej instancji | Z-09 |
| Wtyczka koordynacji | nowy typ wtyczki `node-red-coordination` (lider, zajęcie zadania) | Z-10 |
| Hooki | `preDeploy`, `postDeploy` (source `api`/`internal`/`storage`), `preReload`, `preShutdown` | Z-06, Z-09, Z-08 |
| Trasy administracyjne bloczków | przy `httpAdminNodeRoutes: "authenticated"` trasa bez uprawnienia wymaga sesji; publiczne – `RED.auth.publicRoute()` | Z-02 |
| Trasy HTTP bloczków | `node.registerHttpRoute(method, path, ...handlers)` – automatyczne zdejmowanie przy zamknięciu | Z-07 |
| Dodatki edytora (15 obecnych) | przeniesienie na API z Z-12.01…Z-12.14 (bez selektorów DOM) | Z-12 |
| Klucze zarezerwowane | węzeł nie może zarejestrować ustawienia o nazwie `deploy`, `flows`, `health`, `coordination` | D-02 (U8) |

## 6. Kod korzystający z łatek załącznika A

| Łatka | Co znika / zmienia się | Działanie |
|---|---|---|
| 0002 (P-04) | – (poprawka zostaje, rozszerzona o scenariusz bez `adminAuth`) | brak |
| 0003 (P-03) | sztywne wyłączenie telemetrii | ustawić `telemetry.locked` (§3.1) |
| 0004 (P-01) | funkcja wewnętrzna `waitForDeployStart()` – **nie jest kontraktem**, może zniknąć lub zmienić nazwę | N-02 (nieznane): sprawdzić, czy kod poza runtime ją wywołuje; jeśli tak – zastąpić ustawieniem `deploy.response: "started"` |
| 0005/0006 (P-02, Z-05) | sztywne odrzucanie v2 bez `rev`; okno „tylko przeładowanie” zawsze | ustawić `deploy.requireRevision`, `editorTheme.deploy.staleFlows` (§3.1) |
| 0001 (Z-13) | częściowe tłumaczenie `pl` | uzupełnione w Z-13 (liczba mnoga wg reguł polskich) |

Nagłówki „Modified by Actuna Sp. z o.o.” – zachowane w forku (D-19).

## 7. Lista kontrolna dostosowania (dla każdego rozwiązania)

- [ ] `settings.js` / Helm: nazwy z §3.2; brak kluczy `flows.*` i `editor.staleFlowsPolicy`.
- [ ] Ustawienia odtwarzające łatki (§3.1) na wszystkich instancjach.
- [ ] Każde narzędzie Admin API: v2, wysyła rewizję, obsługuje `version_mismatch` i `version_required`, `deploy_start_failed` (przyjmuje `rev`), `deploy_rejected`.
- [ ] Kod nie wywołuje `waitForDeployStart()` (N-02).
- [ ] Konfiguracje globalne w `globalConfigs[]`, nie w `configs` (gdy używane `/flow`).
- [ ] K8s: sondy i drenaż wg §3.3.
- [ ] Dodatki edytora przeniesione na API Z-12 (po wdrożeniu Z-12).
- [ ] Test po migracji: wdrożenie przez narzędzie → natychmiastowe wywołanie endpointu nowego flow (200), konflikt rewizji (409), wdrożenie bez rewizji (409 `version_required`).

## 8. Decyzje otwarte wpływające na ten przewodnik

| ID | Temat | Stan |
|---|---|---|
| N-01 | pusty `rev: ""` przy wdrożeniu | do decyzji – opis i wpływ w [ANALIZA.md](ANALIZA.md) §7.1 |
| N-02 | użycie `waitForDeployStart()` poza runtime | nieznane – przyjęto: brak aliasu; sprawdzenie w liście kontrolnej |
| N-04 | czy narzędzia używają API v2 | nieznane – przyjęto: przewodnik wymaga v2 |
| – | `DELETE /flow/:id` z wymogiem rewizji | do decyzji (karta Z-05) |
