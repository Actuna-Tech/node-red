# Przegląd spójności backlogu – zlecenie rozszerzeń silnika

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.
> Przegląd niezależny dokumentów: [ZASADY.md](ZASADY.md), [ANALIZA.md](ANALIZA.md), [WERYFIKACJA.md](WERYFIKACJA.md),
> [backlog/etap-1.md](backlog/etap-1.md) … [backlog/etap-4.md](backlog/etap-4.md). Kod czytany tylko do weryfikacji twierdzeń
> (baza gałęzi: 5.0.7). Ścieżki kodu względem `packages/node_modules/`.

## Podsumowanie przeglądu

| Waga | Liczba | Znaczenie |
|---|---|---|
| **Krytyczne** | 5 | sprzeczność kontraktu lub kolejności, która uniemożliwia realizację zgodnie z planem albo daje wzajemnie wykluczające się testy |
| **Istotne** | 19 | rozbieżność między dokumentami / brak wymaganej treści, który spowoduje przeróbki lub błędną decyzję |
| **Drobne** | 9 | numeracja linii, formatowanie, brak oznaczeń, porządek dokumentu |
| **Razem** | **33** | liczone wg pozycji „Listy poprawek do naniesienia” (kilka uwag z sekcji 1–5 scalono w jedną poprawkę) |

Najważniejsze wnioski:
1. **Nazwy ustawień z ZASADY §2.1 są stosowane spójnie** we wszystkich kartach (brak użyć nazw ze zlecenia poza kolumną „propozycja zlecenia”). Problemem są **nowe nazwy spoza §2.1** (≥ 12), których D-02 nie obejmuje.
2. **Kontrakt potoku E-01 nie rozstrzyga trzech kwestii**, które karty rozstrzygają sprzecznie: moment odpowiedzi względem `postDeploy`/`runtime-deploy` (P-01 ↔ Z-06 ↔ ZASADY), przeładowanie z magazynu poza mutexem (Z-09 ↔ ZASADY ↔ E-02) oraz współbieżność operacji w module stanu (E-02 ↔ Z-09).
3. **Plan §6.2 jest niewykonalny w obecnym brzmieniu:** Z-05 przed Z-04 mimo zależności odwrotnej, cykle P-02↔Z-05, Z-08↔Z-09, Z-06↔Z-09; cztery pary planu dzielą pliki.
4. **Weryfikacja twierdzeń o kodzie:** 15 z 17 sprawdzonych POTWIERDZONE (w tym P-04 – synchroniczny `TypeError` odtworzony uruchomieniem), 2 NIEPOTWIERDZONE (ANALIZA §3: `/comms` na workerach z `disableEditor`; Z-11: istniejący kod `upload_not_allowed`).

---

## 1. Nazwy ustawień, API, hooków i kodów błędów

### 1.1 Zgodność z ZASADY §2.1 (wynik: zgodne)

| Nazwa (§2.1) | Gdzie użyta | Wynik |
|---|---|---|
| `deploy.response` | etap-1 P-01 (17×), etap-2 Z-06, etap-4 Z-15 | zgodne |
| `deploy.requireRevision` | etap-1 P-02, etap-2 Z-05 | zgodne |
| `deploy.putCreatesFlow` | etap-2 Z-04 | zgodne |
| `editorTheme.deploy.staleFlows` | etap-1 P-02, etap-2 Z-05 | zgodne |
| `telemetry.locked` | etap-1 P-03 | zgodne |
| `httpAdminNodeRoutes`, `RED.auth.publicRoute()` | etap-1 Z-02 | zgodne (`RED.auth.public()` tylko jako „propozycja zlecenia”) |
| `node.registerHttpRoute` | etap-2 Z-07 | zgodne |
| `health: {enabled, path, port}` | etap-3 Z-08 | zgodne (ścieżki `<path>/live`, `<path>/ready`) |
| `watchFlows`, `preReload` | etap-3 Z-09 | zgodne |
| `preDeploy`, `postDeploy` | etap-2 Z-06, etap-4 Z-12/Z-15 | zgodne |
| `node-red-coordination`, `RED.coordination` | etap-3 Z-10 | zgodne |
| `readOnlyUserDir` | etap-3 Z-11 | zgodne |
| `editorTheme.flowLayout` | etap-4 Z-14 | zgodne |
| Z-15 `editorOnly` / `runtimeState.autoStart` | ANALIZA §6.4, etap-4 Z-15 | zgodne między nimi, **ale brak wiersza w ZASADY §2.1** (D-02 odsyła do „§2.1 + Z-15”) – uwaga **N-1** (drobna) |
| `version_mismatch` (409) | etap-1 P-02, etap-2 Z-04/Z-05 | zgodne z kodem (`runtime/lib/api/flows.js:80-84`) |
| `revision_required` (409) | etap-2 Z-05 (12×) | spójne wewnątrz etapu 2; nieobecne w ZASADY/ANALIZA – zob. N-3 |

### 1.2 Rozbieżności i luki

| # | Plik / karta | Wartość | Problem | Waga |
|---|---|---|---|---|
| N-2 | etap-2 Z-06 | `deploy.hookTimeout` (30000) | nowe ustawienie poza §2.1/D-02 | istotna |
| | etap-3 Z-09 | `deploy.reload: {watch, type, preReloadTimeout, retry}` | jw.; dodatkowo ANALIZA §3 wymaga limitu ≥ 20 min, a w karcie domyślnie 1200000 ms – spójne, ale niezatwierdzone | |
| | etap-3 Z-10 | `coordination: {plugin, options}`; właściwość węzła `inject` `singleInstance` | jw. | |
| | etap-2 Z-03 | `externalModules.palette.allowDowngrade` | jw. | |
| | etap-3 Z-08 | `health.host`, `health.shutdownDelay` (pytania), `RED.health` (nowe publiczne API osadzających) | jw. | |
| | etap-3 E-02 | zdarzenie `instance:state`, `runtime.state` | jw. (karta sama odsyła do D-02) | |
| | etap-4 Z-12 | `RED.header`, `RED.dialog`, `RED.deploy.addMenuItem`, hook edytora `deployPre` | jw. | |
| N-3 | etap-1 P-01, etap-2 Z-03/Z-04/Z-05/Z-06, etap-3 Z-11, etap-4 Z-15 | `deploy_start_failed`, `deploy_stop_failed` (500), `revision_required` (409), `invalid_revision`, `deploy_rejected` (400), `deploy_hook_timeout`, `invalid_flow_id`, `invalid_node_type`, `duplicate_id`, `module_downgrade_not_allowed`, `read_only_user_dir`, `editor_only` (409) | brak wspólnego katalogu kodów błędów i statusów HTTP (ZASADY lub dokument kontraktu Admin API z Z-04); część „do potwierdzenia” w wielu miejscach | istotna |
| N-4 | etap-3 Z-11 (tabela #2, BDD „Funkcje wymagające zapisu”) vs etap-2 Z-03 („kody bez zmian”) | `upload_not_allowed` | kod **nie istnieje** (`registry/lib/installer.js:426-428` rzuca `Error` bez kodu; `runtime/lib/api/nodes.js:175-180` zwraca `invalid_request`); Z-11 traktuje go jak istniejący, a Z-03 deklaruje brak zmian kodów | istotna |
| N-5 | etap-1 E-01 (`missing-types`, `missing-modules`, `flow-start-failed`) vs kody API (`snake_case`) | styl kodów | dwie konwencje (myślnik w `errors[].code`, podkreślenie w `code`) – do jawnego zapisania w E-01 | drobna |

---

## 2. Kontrakt potoku wdrożenia (ZASADY §2.3, E-01) vs P-01, Z-04, Z-05, Z-06, E-02, Z-08, Z-09, Z-15

| # | Dokumenty | Sprzeczność | Waga |
|---|---|---|---|
| K-1 | ZASADY §2.3 (kroki 7→8→9→10), etap-1 P-01 (Wyjścia, Projekt pkt 2, test `emits runtime-deploy before resolving when waitForStart`), etap-2 Z-06 (Ryzyka „Moment postDeploy”: odpowiedź **nie czeka** na `postDeploy`) | ZASADY: `postDeploy` (9) **przed** `runtime-deploy` (10). P-01: w trybie `started` odpowiedź wychodzi **po** emisji `runtime-deploy`. Z-06: odpowiedź **nie czeka** na `postDeploy`. Wszystkie trzy jednocześnie są niespełnialne: albo `runtime-deploy` przed `postDeploy` (zmiana ZASADY), albo odpowiedź czeka na `postDeploy` (zmiana Z-06), albo odpowiedź przed `runtime-deploy` (zmiana P-01). Dodatkowo nieokreślone, czy odpowiedź czeka na krok 8 (`ready`) – istotne dla klientów odpytujących `/ready` zaraz po odpowiedzi. | **krytyczna** |
| K-2 | ZASADY §2.3 (ostatni akapit: „ta sama ścieżka… korzysta z tej samej blokady”), etap-3 Z-09 (Algorytm kroki 4–6: `state.begin("reload")` i `preReload` **poza** mutexem), etap-3 E-02 (niezmiennik 3: „najwyżej jedna operacja naraz; `begin` przy aktywnej operacji rzuca `state_operation_in_progress`”), Z-09 BDD „Oczekiwanie w preReload nie blokuje wdrożeń” | Wdrożenie z Admin API w trakcie `preReload` wywoła `begin("deploy")` przy aktywnej operacji `reload` → wyjątek programisty wg E-02. Z-09 wymaga, by takie wdrożenie przeszło. Ponadto ZASADY mówią o wspólnej blokadzie, a Z-09 trzyma ją tylko od kroku 6. | **krytyczna** |
| K-3 | ZASADY §2.3 (Z-09 „przechodzi tę samą ścieżkę”), etap-2 Z-06 (hooki dla `reload` z Admin API, odczyt magazynu przed `preDeploy`), etap-3 Z-09 (brak `preDeploy`/`postDeploy` dla przeładowania z magazynu), etap-4 Z-15 pkt 6 | Nie ustalono, czy przeładowanie z magazynu (Z-09) wywołuje `preDeploy`/`postDeploy` (z „tej samej ścieżki” wynika, że tak; z karty Z-09 – że nie). Dwa różne mechanizmy „odczytaj, potem uruchom tę samą treść” (Z-06 pkt 3: parametr w `flows.load`; Z-09: `reloadFromStorage(loaded)`) – do scalenia w E-01. | istotna |
| I-1 | ZASADY §2.3 krok 6 („błędy zatrzymania NIE są połykane”), etap-1 E-01 (Ryzyka) i P-01 (gałąź domyślna z pustym `.catch`), ANALIZA §4.1 („domyślnie zachowujemy 5.0.6”) vs ANALIZA §7 D-05 (rekomendacja: dołączyć do P-01 jako poprawkę błędu z testem regresji) | ZASADY i D-05 mówią „naprawić”, karty i §4.1 – „tylko w trybie `started`”. ANALIZA jest wewnętrznie sprzeczna; zadanie E-01b z §4.1 nie ma karty. | istotna |
| I-2 | etap-1 E-01 (Projekt pkt 1–5, Alternatywy: „osobna funkcja `deploy(opts)` … odrzucona”), etap-2 Z-04 (Projekt pkt 1: wydzielenie `buildAddFlowConfig/buildUpdateFlowConfig` „potrzebne także dla E-01/Z-06”), etap-2 Z-06 (Projekt pkt 2: „funkcja `deploy(opts)` … nazwa w E-01”), etap-3 Z-09 (pkt 2: wspólny mutex `flows/lock.js` „nazwa wg E-01”) | Karty zależne zakładają, że E-01 dostarczy: wspólną funkcję potoku, wydzieloną budowę konfiguracji `/flow`, współdzielony mutex i wariant „odczyt przed hookiem”. Karta E-01 żadnego z nich nie obejmuje, a `deploy(opts)` wprost odrzuca. | istotna |
| I-3 | etap-3 E-02 (Ryzyka „`setState` w mutexie”, T10/T11, Projekt pkt 5) vs ZASADY §2.3 / etap-1 E-01 (lista wejść) | `POST /flows/state` (`setState`) staje się operacją potoku z mutexem i stanem, ale nie występuje w kontrakcie E-01 ani w ZASADY. Weryfikacja: `setState` (`runtime/lib/api/flows.js:283`) faktycznie bez `runExclusive` (mutex tylko w `:67,:109,:159,:193`). | istotna |
| I-4 | ANALIZA §4.2 (diagram: `starting/ready/deploying/reloading/stopping/stopped/failed`) vs etap-3 E-02 (dodatkowy stan `idle`, przejścia z `failed`/`idle` do `deploying`) vs etap-4 Z-15 pkt 5 („`ready` z flagą albo osobny stan `editor-only`”) | model stanu w ANALIZA nieaktualny; Z-15 proponuje stan, którego E-02 nie zna | istotna |
| I-5 | etap-3 Z-09 (BDD „Hook preReload opóźnia przeładowanie (kryterium zlecenia)”: `/ready` 503 przez cały `preReload`) vs Z-09 Ryzyka (rekomendacja A: 503 tylko w kroku 7) vs E-02 (T7: `reloading` przed `preReload`) vs ANALIZA §4.10 / D-10 | rekomendacja karty przeczy jej własnemu scenariuszowi odbioru i modelowi E-02; wymaga decyzji przed implementacją Z-08/Z-09 | istotna |
| I-6 | etap-3 E-02 / Z-08 (`idle` → `/ready` 503) vs etap-4 Z-15 pkt 6 (`/ready` 200 po wczytaniu flow) | różne propozycje dla instancji edycyjnej w trzech kartach; pytanie zadane dwukrotnie (etap-3 P3, etap-4 P12) | istotna |
| – | ZASADY §2.3 kroki 2→3→4→5, etap-2 Z-05 (kontrola rewizji przed `preDeploy`), Z-06 (409 nie wywołuje `preDeploy`), E-02 (T5 w kroku 4), Z-08 (503 w kroku 4) | **zgodne** | – |
| – | etap-4 Z-15 (wdrożenie bez kroków 6–7, `runtime-deploy` jak dziś) | zgodne z ZASADY; brak opisu, czy krok 4/8 (`deploying`) występuje (Z-15 pkt 6 mówi „503 na czas zapisu”) – spójne z E-02 | – |

---

## 3. Zależności i plan ANALIZA §6.2

### 3.1 Kolejność i cykle

| # | Dokumenty | Problem | Waga |
|---|---|---|---|
| K-4 | etap-2 tabela (Z-05 zależy od **Z-04**; kolejność „E-01 → Z-04 → Z-05 → Z-06”), ANALIZA §6.2 krok 2.1 **Z-05**, 2.2 **Z-04** („Z-04 po Z-05”), ANALIZA §5 (3.8): „E-01 → P-01 → **Z-05 → Z-04** → Z-06 → Z-09” | trzy różne kolejności; plan §6.2 realizuje zależny (Z-05) przed zależnością (Z-04: rewizja flow, `globalRev`, `rev:null`) | **krytyczna** |
| K-5 | etap-1 P-02 (zależy od Z-05) ↔ etap-2 Z-05 (zależy od P-02); ANALIZA §6.2: P-02 w kroku 1.3, Z-05 w 2.1 | cykl; P-02 realizowany przed swoją zależnością. Rozwiązanie: oznaczyć zależność P-02→Z-05 jako „miękką” (ostrzeżenie w logu po Z-05), a Z-05→P-02 jako integrację edytora | **krytyczna** |
| K-6 | etap-3 Z-08 (zależy od Z-09 – stan `reloading`) ↔ Z-09 (zależy od Z-08); etap-2 Z-06 (zależy od Z-09 – `preReload`) ↔ etap-3 Z-09 (zależy od Z-06) | dwa cykle w tabelach; ANALIZA §6.2 słusznie ustawia Z-06 → Z-08 → Z-09, więc w kartach Z-06 i Z-08 zależność od Z-09 należy zamienić na „punkt integracji dostarczany w Z-09” | **krytyczna** |
| I-7 | etap-3 tabela podsumowania E-02 („warunek Z-08, Z-09, **P-01**”) vs karta E-02 („wykorzystywany przez P-01 (opcjonalnie)”); ANALIZA §6.1 (implementacja E-02 w Z-08, krok 3.1) a P-01 w kroku 1.3 | tabela czyni E-02 warunkiem P-01, którego implementacja przychodzi dwa etapy później | istotna |
| I-8 | ANALIZA §6.1 (E-05), etap-4 E-04 (odsyła do E-05) | **brak karty E-05** (środowisko weryfikacji, CI z `ssh-keygen`) w żadnym pliku; ANALIZA §8 nie wymienia też E-03/E-04 w etapie 4 | istotna |

Pozostałe zależności z tabel są wykonalne w kolejności §6.2: P-01 (1.3) → Z-06 (2.3); Z-04 → Z-14 (2.3, Z-14a razem z Z-04); E-01/E-02 → Z-15 (4); E-03 (0) → P-02, Z-01, Z-12; Z-10 zależy tylko od E-02.

### 3.2 Pary w §6.2 a wspólne pliki (wymóg „bez wspólnych plików w parze”)

| Krok | Para | Wspólne pliki (wg kart) | Waga |
|---|---|---|---|
| 1.1 | P-04 + Z-01 | brak (serwer `editor-api/lib/editor/comms.js` vs klient `editor-client/src/js/comms.js`) | – |
| 1.2 | P-03 + Z-02 | tylko szablon `node-red/settings.js`, CHANGELOG | drobna (wspólne dla prawie wszystkich par – patrz D-7) |
| 1.3 | **P-01 + P-02** | `editor-client/src/js/ui/deploy.js` (P-01 Projekt pkt 4: `.fail` z `rev`, `:676-683`; P-02: `:680-681`, `save`), `locales/en-US/editor.json` | istotna (I-9) |
| 2.1 | Z-05 + Z-03 | `locales/en-US/editor.json` (Z-05 komunikat `revision_required`, Z-03 `palette.editor.uploaded.*`) | drobna |
| 2.2 | Z-04 + Z-07 | brak | – |
| 2.3 | **Z-06 + Z-14** | `runtime/lib/flows/util.js` (Z-06: `changedFlows` z `diff`; Z-14a: `diffNodes`) – ANALIZA §4.1 sama oznacza oba w tym wierszu; `runtime/lib/flows/index.js` `addFlow/updateFlow` (Z-06 vs `copyFlowLayoutProperties` Z-14a) | istotna (I-9) |
| 3.1 | **Z-08 + Z-11** | `runtime/lib/index.js` `start()` (Z-08 init/start `health`; Z-11 efektywne flagi przed `storage.init`), `node-red/red.js` (Z-08 `:417-436,:484,:543-558`; Z-11 `:121-157`), `runtime/locales/en-US/runtime.json` | istotna (I-9) |
| 3.2 | Z-09 + Z-10 | `runtime/lib/index.js` (`:239-247`, `stop()`) – etap-3 przyznaje i ustala kolejność scaleń; ANALIZA §6.2 nadal nazywa parę „rozłączną” | istotna (I-9) |
| 4 | Z-13 + Z-12 → Z-15 | `locales/*` (Z-12/Z-15 dodają klucze en-US, Z-13 `pl`) – zamierzone (test zgodności) | drobna |

Dodatkowo deploy.js modyfikują P-01, P-02, Z-05 (Overwrite, `revision_required`, poprawka `:390`), Z-06 (`deploy_rejected`) i Z-15 (menu Deploy) – ryzyko konfliktów w jednym pliku przez 4 kroki; zalecany jeden wspólny punkt obsługi błędów wdrożenia w `deploy.js` ustalony w E-01/E-03.

---

## 4. Kryteria odbioru ze zlecenia i uzupełnienia z ANALIZA §9

Legenda oznaczeń: etap-1 – `[odbiór]`; etap-3 – „(kryterium zlecenia)”; etap-4 – komentarz `# Kryterium odbioru ze zlecenia`; **etap-2 – brak oznaczeń** (uwaga I-10). Trzy konwencje – uwaga D-8.

| Pakiet | Scenariusze oznaczone jako kryteria zlecenia | Uzupełnienia ANALIZA §9 w karcie | Braki |
|---|---|---|---|
| P-01 | tak (3) | błąd startu w odpowiedzi ✔; `addFlow/updateFlow/removeFlow` ✔; wywołania wewnętrzne ✔ | – |
| P-02 | tak (2) | oba wejścia (409, tło) ✔; blokada wymuszonego wdrożenia ✔ | E2E zależne od E-03/D-03 (opisane) |
| P-03 | tak (2) | API ustawień przy `locked` ✔; UI zablokowane ✔; **zmienna środowiskowa** – tylko pytanie, brak scenariusza (nawet warunkowego) | D-9 |
| P-04 | tak (1) | scenariusz bez `adminAuth` ✔; brak `process.exit` ✔; `.catch` (scenariusz `Tokens.get` odrzuca) ✔ | uzupełnienia nieoznaczone jako „[odbiór]”, choć §9 uznaje kryterium zlecenia za niewystarczające – drobne |
| Z-01 | tak (2) | rzeczywisty objaw (brak `auth fail`, połączenie otwarte) ✔ | – |
| Z-02 | tak (4) | widoki debug ✔; log przy starcie ✔; brak `adminAuth` ✔ | – |
| Z-03 | **brak oznaczeń** | semver ✔; poprzednia wersja w hookach ✔; spójne nazwy ustawień ✔; **potwierdzenie w edytorze – brak** (tylko pytanie, karta wyklucza z zakresu minimalnego) | I-10, I-11 |
| Z-04 | **brak oznaczeń** (scenariusze odpowiadają kryteriom: stare wywołania, rev, tworzenie, configs) | kolizja `configs` → `globalConfigs[]` (D-08) ✔; FL-B-001 ✔ | I-10 |
| Z-05 | **brak oznaczeń** (szablony obu stanów dla v1/v2/`/flow/:id` są) | `POST /flow` ✔, `DELETE /flow/:id` ✔, `reload` ✔, wymuszone nadpisanie ✔ | I-10 |
| Z-06 | **brak oznaczeń** (odrzucenie, kolejność, wyjątek, brak hooków – są) | limit czasu hooka ✔ (jako „do potwierdzenia”); błąd `postDeploy` nie cofa ✔ | I-10 |
| Z-07 | **brak oznaczeń** (trasa raz/wcale, http in bez zmian – są) | regresja `splice` ✔ (test); **kolejność middleware** – tylko Ryzyka, brak scenariusza | I-10, D-9 |
| Z-08 | tak (1, łączony) | 503 od SIGTERM ✔; nasłuch przed startem flow ✔; osobny port ✔; **drenaż wg D-11 – brak** (karta rekomenduje `preStop`, D-11 – hook `preShutdown`) | I-12 |
| Z-09 | tak (4) | wspólny mutex ✔; koalescencja ✔; błąd odczytu magazynu ✔; `credentialsChanged` (§4.10) ✔ | rozjazd z D-10 (I-13) |
| Z-10 | tak (3) | wygaśnięcie dzierżawy ✔; utrata połączenia ✔; przycisk ręczny ✔ | – |
| Z-11 | tak (2) | `userDir` nieustawiony ✔; kopia `settings.js` przez CLI ✔; błąd zamiast cichego pominięcia (§4.10) ✔ | kod `upload_not_allowed` (N-4) |
| Z-12 | tak (2, komentarze) | wymaga E-03 i załącznika B (opisane) | – |
| Z-13 | tak (2, komentarze) | test zgodności kluczy pl↔en-US w `npm test` ✔ | – |

---

## 5. Weryfikacja twierdzeń o kodzie

Metoda: odczyt kodu; jedno twierdzenie (nr 1a) sprawdzone uruchomieniem `node -e` (bez zmian w repozytorium).

| # | Twierdzenie (źródło) | Wynik | Dowód |
|---|---|---|---|
| 1a | `tokens.get()` przed `init()` rzuca **synchronicznie** `TypeError` (WERYFIKACJA P-04, etap-1 P-04) | **POTWIERDZONE (uruchomione)** | `require(".../auth/tokens.js").get("x")` → `SYNC THROW: TypeError Cannot read properties of undefined (reading 'getSessions')`; `loadSessions()` `tokens.js:84-92` woła `storage.getSessions()` bez strażnika |
| 1b | P-04: bez `adminAuth` pakiet `{"auth":…}` trafia do `Tokens.get`, wyjątek nieobsłużony → `process.exit(1)` | **POTWIERDZONE (analiza statyczna)** | `auth/index.js:45-50` – `Tokens.init` tylko przy `adminAuth`; `editor/comms.js:70` `pendingAuth = !user && adminAuth != null` → `false`; `:135-137` `if (msg.auth) handleAuthPacket(msg)` w słuchaczu `message`; `node-red/red.js:525-540` `uncaughtException` → `process.exit(1)`. Pełny scenariusz websocket nieuruchamiany |
| 2 | `/comms` (upgrade) pomija `httpAdminMiddleware` i nie sprawdza `Origin` (ANALIZA §4.3, etap-1 P-04) | **POTWIERDZONE** | `editor/comms.js:222-245` – `server.on('upgrade')` → `wsServer.handleUpgrade` bez `verifyClient`/kontroli nagłówka; middleware montowane tylko na `adminApp` (`editor-api/lib/index.js:50-54`) |
| 3 | ANALIZA §3 (wiersz P-04): „workery z `disableEditor` **nadal wystawiają** Admin API i `/comms`” | **NIEPOTWIERDZONE (w części `/comms`)** | `editor-api/lib/index.js:83-87` – `editor` (a z nim `comms.init`, `editor/index.js:46-48`) tylko gdy `!settings.disableEditor`; Admin API (`./admin`) montowane zawsze. Karta etap-1 P-04 (Powiązania) jest poprawna („`/comms` nie jest uruchamiane”) – ANALIZA do korekty |
| 4 | `restart()` używa niezdefiniowanego `nns` (ANALIZA §4.9, etap-2 Z-05) | **POTWIERDZONE** | `editor-client/src/js/ui/deploy.js:367-400`, `:390` `resolveConflict(nns, true)`; `nns` deklarowane tylko w `:164` (`var` w innej funkcji) i `:536` (`const` w `save`) |
| 5 | `installTarball` zapisuje `.tgz` przed sprawdzeniem wersji (ANALIZA §4.9, etap-2 Z-03) | **POTWIERDZONE** | `registry/lib/installer.js:443` `await fs.outputFile(tarballPath, tarball)` przed `installModule` (`:466`), który dopiero sprawdza `module_already_loaded` (`:196-199`); `isUpdate` (`:446,:454`) nieużywane |
| 6 | Zamknięcie jednego `http in` usuwa trasy innych węzłów; `splice` w `forEach` (etap-2 Z-07) | **POTWIERDZONE** | `nodes/core/network/21-httpin.js:356-365` – dopasowanie po `route.path === node.url && methods[node.method]` (bez identyfikatora węzła), `routes.splice(i,1)` w `forEach`; brak `test/nodes/core/network/21-httpin_spec.js` |
| 7 | `setState` poza mutexem API (etap-3 E-02) | **POTWIERDZONE** | `runtime/lib/api/flows.js:283` `setState` bez `runExclusive`; `runExclusive` tylko w `:67` (`setFlows`), `:109`, `:159`, `:193` |
| 8 | `readOnly` magazynu plikowego pomija zapis flow po cichu (ANALIZA §4.10, etap-3 Z-11) | **POTWIERDZONE** | `storage/localfilesystem/projects/index.js:606-608` `saveFlows`: `if (settings.readOnly) { return }`; `:650-652` `saveCredentials` jw. |
| 9 | Błąd odczytu flow przy starcie połykany, `runtime/lib/index.js:247` (ANALIZA §4.10, etap-3 E-02) | **POTWIERDZONE, linia `:245`** | `runtime/lib/index.js:241-245` `redNodes.loadFlows().then(...startFlows()).catch(function(err) {})`; uwaga: `startFlows()` nie jest zwracane, więc `.catch` obejmuje tylko odrzucenie `loadFlows` |
| 10 | `setFlows`: `start()` bez `await` (`:228`), pusty `.catch` (`:233`) (WERYFIKACJA P-01, etap-1 E-01/P-01) | **POTWIERDZONE** | `runtime/lib/flows/index.js:228` `start(type,diff,muteLog,true).then(...)` bez `return`; `:233` `.catch(function(err) { })`; `runtime-deploy` w `:229` po starcie |
| 11 | Callback `cronosjs` dostaje czas zaplanowany (etap-3 Z-10, „do potwierdzenia”) | **POTWIERDZONE** | `node_modules/cronosjs/dist-node/index.js:950-952` `scheduleTask` → `.on('run', task)`; `:919-921` `_runTask(){ this._emit('run', this._timestamp) }`; `_timestamp` = następna data z sekwencji (`:922-926`) ustawiana przed uruchomieniem → wartość = czas zaplanowany. `20-inject.js:84` dziś argument ignoruje |
| 12 | Rewizja bez poświadczeń (ANALIZA §4.10, etap-3 Z-09) | **POTWIERDZONE** | `runtime/lib/storage/index.js:80` `sha256(JSON.stringify(result.flows))` |
| 13 | `VALID_HOOKS` bez hooków wdrożenia; `false` → rozwiązanie, nie odrzucenie (etap-2 Z-06) | **POTWIERDZONE + uwaga** | `util/lib/hooks.js:3-17`; `trigger` `:162-188` – `err === false` → `resolve(false)`. Uwaga: handler zwracający promise odrzucony wartością `undefined` **nie** przerywa łańcucha (`result.then(handleResolve, callNextHook)` → `callNextHook(undefined)`), więc Z-06 „odrzucony promise → `deploy_rejected`” wymaga jawnej obsługi (uwaga D-6) |
| 14 | `theme.js` nie przekazuje `editorTheme.deploy`/`flowLayout` (etap-1 P-02, etap-4 Z-14) | **POTWIERDZONE** | `editor-api/lib/editor/theme.js:412-422` – tylko `projects`, `multiplayer`, `keymap` (+ wcześniejsze `palette`, `menu` itd.) |
| 15 | Telemetria: zapisany `telemetryEnabled` wygrywa nad `settings.js` (etap-1 P-03) | **POTWIERDZONE** | `runtime/lib/telemetry/index.js:126-129` (`runtimeTelemetryEnabled !== undefined` → zwrot); `api/settings.js:224-233` `enable()/disable()` bez kontroli administratora |
| 16 | Przełączenie projektu omija mutex (etap-1 E-01, etap-3 Z-09) | **POTWIERDZONE** | `storage/localfilesystem/projects/index.js:396` `runtime.nodes.loadFlows(true)` – bezpośrednio, bez `api/flows.js` |
| 17 | Kod `upload_not_allowed` jako istniejący (etap-3 Z-11, tabela #2 i BDD) | **NIEPOTWIERDZONE** | brak kodu w `registry/lib`, `runtime/lib`, `editor-api/lib`; `installer.js:426-428` `throw new Error("Module upload disabled")` bez `code`; `runtime/lib/api/nodes.js:175-180` – `invalid_request` |

---

## 6. Szacunki – zestawienie

| ID | Etap | Szacunek | Priorytet | Ryzyko | Zależności (wg tabel podsumowujących) |
|---|---|---|---|---|---|
| E-01 | 1 (etap 0 wg ANALIZA §6.1) | M | P1 | średnie | – (warunek P-01, Z-04, Z-05, Z-06, Z-08, Z-09) |
| P-01 | 1 | L | P1 | średnie | E-01 |
| P-02 | 1 | M | P2 | średnie | Z-05 (**cykl**, K-5) |
| P-03 | 1 | M | P2 | niskie | – |
| P-04 | 1 | S | P1 | niskie (zmiana) / wysokie (skutek) | – |
| Z-01 | 1 | S | P3 | niskie | – |
| Z-02 | 1 | L | P1 | wysokie | – |
| Z-03 | 2 | M | P3 | niskie | – |
| Z-04 | 2 | L | P1 | wysokie | E-01, FL-B-001 |
| Z-05 | 2 | M | P1 | średnie | E-01, Z-04, P-02 (**K-4, K-5**) |
| Z-06 | 2 | M–L | P1 | średnie | E-01, P-01, Z-04/Z-05 (+ Z-09 w karcie – **K-6**) |
| Z-07 | 2 | M | P2 | średnie | – |
| E-02 | 3 (spec. etap 0, impl. w Z-08) | M | P1 | średnie | E-01; „warunek” Z-08, Z-09, P-01 (I-7) |
| Z-08 | 3 | M | P1 | średnie | E-02, E-01 (+ Z-09 w karcie – **K-6**) |
| Z-09 | 3 | L | P1 | wysokie | E-01, E-02, Z-08, Z-06, P-01 |
| Z-10 | 3 | L | P2 | wysokie | E-02 |
| Z-11 | 3 | M | P2 | średnie | – (koordynacja z Z-03) |
| Z-12 | 4 | M (spike) + S–M/punkt | P3 | wysokie | załącznik B, E-03, P-02/Z-06 |
| Z-13 | 4 | L | P3 | średnie | tłumaczenie Zamawiającego; klucze P-02, Z-03, Z-14, Z-15 |
| Z-14 | 4 (krok 2.3) | M | P3 | średnie | E-04, Z-04, E-03, D-03, D-06 |
| Z-15 | 4 | M | P2 | średnie | E-01, E-02; D-02, D-06 |
| E-03 | 4 (etap 0) | S (+ M E2E) | P1 | niskie | D-03 |
| E-04 | 4 (etap 0) | M | P1 | niskie | D-01, D-04 |
| E-05 | 0 | **brak karty** | – | – | – (I-8) |

Rozkład: S – 3 (P-04, Z-01, E-03), M – 12, L – 6 (P-01, Z-02, Z-04, Z-09, Z-10, Z-13), niestandardowe – 2 (Z-06 „M–L”, Z-12 „M + S–M/punkt”; uwaga D-5). Pakiety o ryzyku wysokim: Z-02, Z-04, Z-09, Z-10, Z-12 – wszystkie poza Z-12 z priorytetem P1/P2.

---

## 7. Pytania do Zamawiającego – zestawienie (bez duplikatów)

Oznaczenia źródeł: E1/E2/E3/E4 – sekcja „Pytania” pliku etapu, numer pytania. **NOWE** = brak odpowiadającej decyzji w ANALIZA §7.

| # | Temat | Pytanie (scalone) | Źródła | Decyzja |
|---|---|---|---|---|
| **A** | **Wersja, nazwy, proces** | | | |
| A1 | Wersja bazowa | potwierdzenie bazy 5.0.7 | E1-13 | D-01 |
| A2 | Nazwy | akceptacja `deploy.response`, `editorTheme.deploy.staleFlows`, `RED.auth.publicRoute()` i pozostałych z §2.1 | E1-1 | D-02 |
| A3 | Nazwy nowe | stany E-02 i zdarzenie `instance:state`; `deploy.reload.*`; `deploy.hookTimeout`; `coordination.plugin`; `editorOnly` vs `runtimeState.autoStart` | E3-1, E3-11, E2-12, E3-13, E4-12 | D-02 (rozszerzyć §2.1 – N-2) |
| A4 | DCO/CLA, AI | kto podpisuje DCO i CLA OpenJS; oznaczanie pracy z AI | E4-15 | D-04 |
| A5 | Nazwy narzędzi | czy „bez nazw produktów” obejmuje narzędzia stron trzecich (np. E2E) w CHANGELOG/testach | E4-16 | **NOWE** |
| A6 | CHANGELOG | wpis w gałęzi pakietu czy tylko w opisie dostarczenia | E4-17 | **NOWE** |
| A7 | Zakres Z-14/Z-15 | Z-14 i Z-15 w zakresie zlecenia | (ANALIZA) | D-06 |
| **B** | **Potok wdrożenia (E-01, P-01, Z-05, Z-06)** | | | |
| B1 | Błędy zatrzymania | naprawić połykanie także w trybie domyślnym czy tylko w `started` | E1-2 | D-05 (sprzeczność z §4.1 – I-1) |
| B2 | Kod HTTP błędu startu | 500 z `{code, rev, errors}` czy 200/207 | E1-3 | **NOWE** |
| B3 | Zakres błędu startu | czy także błędy konstruktorów węzłów | E1-4 | **NOWE** |
| B4 | Limit czasu startu | limit oczekiwania w trybie `started` czy w Z-08 | E1-5 | **NOWE** |
| B5 | Moment `postDeploy` | czy odpowiedź `started` czeka na `postDeploy`; limit `deploy.hookTimeout` 30 s | E2-12 | **NOWE** (rozstrzyga K-1) |
| B6 | Modyfikacja w `preDeploy` | tylko walidacja, bez modyfikacji | E2-11 | **NOWE** |
| B7 | Hooki dla startu/projektów | czy start runtime i przełączenie projektu wywołują hooki | E2-13 | **NOWE** |
| B8 | Macierz rewizji | v1 przy wymogu: 409 czy nagłówek; `DELETE ?rev=`; `reload` zwolniony | E2-9 | **NOWE** |
| B9 | Overwrite / reload-only | czy `reload-only` implikuje wymóg `rev`; Overwrite przy wymogu – pobranie rewizji czy niedostępne; podgląd różnic/eksport zmian przed przeładowaniem | E1-6, E2-10 (duplikat scalony) | **NOWE** |
| B10 | `setState` w mutexie | zgoda na objęcie start/stop flow blokadą wdrożeń | E3-2 | **NOWE** |
| **C** | **API pojedynczego flow (Z-04)** | | | |
| C1 | `configs` vs `globalConfigs` | nowe pole `globalConfigs[]` | E2-5 | D-08 |
| C2 | Transport rewizji | `rev` tylko przy v2; `ETag`/`If-Match` | E2-6 | D-09 (część `ETag` – **NOWE**) |
| C3 | Tworzenie pod id | 200 czy 201; format id | E2-7 | **NOWE** |
| C4 | `globalRev` | czy potrzebna osobna rewizja globalnych configów | E2-8 | **NOWE** |
| **D** | **Bezpieczeństwo (P-04, Z-02)** | | | |
| D1 | Zgłoszenie P-04 | zgłoszenie prywatne wg `SECURITY.md`, wstrzymanie publikacji gałęzi; diff modyfikacji Zamawiającego; `{"auth":"ok"}` czy ignorowanie pakietu bez `adminAuth` | E1-8 | **NOWE** (ANALIZA §4.3 rekomenduje, brak D-xx) |
| D2 | `Origin` dla `/comms` | osobny pakiet / ustawienie | E1-9 | D-07 |
| D3 | Z-02 anonimowy | czy `adminAuth.default` spełnia „uwierzytelniona sesja” | E1-11 | **NOWE** |
| D4 | Z-02 nieznana wartość | `"open"` czy `"authenticated"`; lista modułów z publicznymi trasami | E1-12 | **NOWE** |
| **E** | **Edytor i testy** | | | |
| E1 | Playwright | Playwright w `devDependencies`; alternatywa: testy logiki + scenariusz ręczny | E4-14 | D-03 |
| E2 | Eksport CommonJS | eksport w `comms.js`/`deploy.js` na potrzeby testów | E1-10 | D-03 (powiązane; **NOWE** jako osobna zgoda) |
| **F** | **Telemetria (P-03)** | `NODE_RED_DISABLE_TELEMETRY` → `locked`; dopuszczalność `locked` + `enabled:true` | E1-7 | **NOWE** |
| **G** | **Paleta (Z-03)** | | | |
| G1 | Zakres skorygowany | akceptacja skorygowanego zakresu | E2-1 | **NOWE** |
| G2 | Obniżenie wersji | dozwolone z ostrzeżeniem czy blokowane; `allowDowngrade` | E2-2 | **NOWE** |
| G3 | Potwierdzenie | wymagane potwierdzenie przed instalacją (`dryRun`) | E2-3 | **NOWE** |
| G4 | Ustawienia uploadu | kanoniczne `allowUpload` + aliasy | E2-4 | D-05 (niespójne nazwy uploadu) |
| **H** | **Trasy HTTP węzła (Z-07)** | przełącznik awaryjny dla modułów czytających `_router.stack`; `rawBodyCapture` w tym pakiecie czy osobno | E2-14 | D-05 (część `splice`); reszta **NOWE** |
| **I** | **Stan, sondy, zatrzymanie (E-02, Z-08, Z-15)** | | | |
| I1 | `idle` i `/ready` | safe mode / flow zatrzymane → `idle` + 503; `/ready` instancji edycyjnej 200 po wczytaniu flow | E3-3, E4-12 (duplikat scalony) | **NOWE** (rozstrzyga I-6) |
| I2 | Treść 503 | nazwa stanu w treści czy treść stała | E3-4 | **NOWE** |
| I3 | Drenaż przy SIGTERM | `preStop` vs `health.shutdownDelay` vs hook przed zatrzymaniem; globalny limit zatrzymania; `RED.stop()` z powodem | E3-5, E3-1 (część) | D-11 (karta rekomenduje inaczej – I-12) |
| I4 | Serwer HTTP przy SIGTERM | zamykać tylko przy osobnym porcie czy zawsze; `health.host` | E3-6 | D-05 |
| **J** | **Przeładowanie (Z-09)** | | | |
| J1 | Jednoczesne 503 | A/B/C/D (503 tylko w oknie restartu, kolejno przez Z-10, losowe opóźnienie, wydania niezmienne) | E3-7 | D-10 |
| J2 | Różnicowe | `type: "full" \| "flows"`, wartość domyślna | E3-8 | D-10 (sprzeczność wartości domyślnej – I-13) |
| J3 | `preReload` bez weta | przeładowanie mimo błędu/limitu; domyślny limit 20 min | E3-9 | **NOWE** |
| J4 | Błąd odczytu magazynu | `ready` z ponowieniami czy `failed` po N próbach; błąd `watchFlows` blokuje start | E3-10 | **NOWE** |
| J5 | Konflikt z lokalnym wdrożeniem | „magazyn źródłem prawdy” w trakcie drenażu | E3-11 (część) | **NOWE** |
| **K** | **Koordynacja (Z-10)** | | | |
| K1 | Semantyka `inject` | cron przez zajęcie klucza, interwał/once przez przywództwo; status „standby” | E3-12 | **NOWE** |
| K2 | Wybór wtyczki | tylko jawnie; inne węzły core (`mqtt in`) | E3-13 | D-02 (nazwa) / **NOWE** (zakres) |
| K3 | Test dwóch runtime'ów | jeden proces vs wieloprocesowy w `npm test` | E3-14 | **NOWE** |
| **L** | **userDir tylko do odczytu (Z-11)** | | | |
| L1 | Kontekst plikowy | błąd startu czy przełączenie na `memory` | E3-15 | **NOWE** |
| L2 | Wdrożenie przy magazynie plikowym | 400 `read_only_user_dir` czy ciche pominięcie; dokumentacja `readOnly` | E3-16 | **NOWE** (ANALIZA §4.10 „decyzja”, brak D-xx) |
| L3 | CLI | zmienna środowiskowa przed wyborem pliku; ochrona bezwzględnego `flowFile` | E3-17 | **NOWE** |
| **M** | **Punkty edytora (Z-12)** | termin załącznika B; pokrycie potrzeb przez `RED.header`/Deploy/`RED.dialog`; hook Deploy tylko UX; okres deprecjacji | E4-1, E4-2, E4-3 | **NOWE** |
| **N** | **Tłumaczenie (Z-13)** | zakres (`runtime.json`, pomoc HTML); wersja źródła 332 kluczy (1089 vs 1126); rejestr i słownik; automatyczny wybór `pl`; utrzymanie i zgłoszenie `_plural` | E4-4…E4-8 | **NOWE** |
| **O** | **Układ flow (Z-14)** | rysowanie przy wyłączonym ustawieniu; runtime bez bramkowania; zakres FL-B-004…008 | E4-9, E4-10, E4-11 | D-06 (zakres) / **NOWE** (semantyka) |
| **P** | **Instancja edycyjna (Z-15)** | przycisk `inject` i trasy admin – opis czy blokada; kształt odpowiedzi P-01 `{rev, started:false}` | E4-12 (część), E4-13 | D-02, D-06 / **NOWE** (zachowanie) |

Wniosek: z ok. 50 pytań tylko 11 decyzji D-01…D-11 ma pokrycie; **ok. 35 pytań jest NOWYCH** – ANALIZA §7 wymaga rozszerzenia (np. D-12 potok/odpowiedź, D-13 bezpieczeństwo Z-02/P-04, D-14 Z-11) albo jawnego odesłania do sekcji „Pytania” kart.

---

## Pozostałe uwagi (spoza sekcji 1–5)

| # | Plik / sekcja | Uwaga | Waga |
|---|---|---|---|
| I-12 | etap-3 Z-08 (Ryzyka „Drenaż przy SIGTERM”, Pytanie 5) vs ANALIZA §4.10 i D-11 | ANALIZA rekomenduje drenaż w rdzeniu (hook `preShutdown`, limit) jako „warunek ochrony rozmów”; karta rekomenduje `preStop` w orkiestratorze, bez scenariusza ani podzadania | istotna |
| I-13 | etap-3 Z-09 (Ryzyka „Pełne vs różnicowe”: domyślnie `"full"`) vs ANALIZA D-10 („różnicowe domyślnie przy włączonym Z-09”) | sprzeczne rekomendacje wartości domyślnej | istotna |
| I-14 | ANALIZA §4.9 (poprawka `deploy.js:390` „w P-02”) vs etap-2 Z-05 (Projekt pkt 4, DoD) vs etap-1 P-02 (brak wzmianki) | dwóch właścicieli jednej poprawki | istotna |
| I-15 | ANALIZA §3 (wiersz P-04) | `/comms` nie jest uruchamiane przy `disableEditor` (sekcja 5, nr 3) – ocena ryzyka dla workerów do korekty (ryzyko dotyczy Admin API, nie `/comms`) | istotna |
| I-16 | ANALIZA §8 (tabela backlogu), §6.1 („D-01…D-06”) | tabela nie wymienia E-03/E-04 w etapie 4 ani E-05; decyzji jest 11 | istotna |
| D-1 | ANALIZA – kolejność sekcji | §4.9 i §4.10 umieszczone po §6.4 (przed §7) | drobna |
| D-2 | etap-3 E-02 (Pliki, T3, Projekt pkt 3), ANALIZA §4.10 | `runtime/lib/index.js:247` – faktycznie `:245` | drobna |
| D-3 | ANALIZA §1 pkt 4 | „pisane równolegle (maks. 2 jednocześnie)” – karty pisało 4 autorów równolegle | drobna |
| D-7 | ANALIZA §6.2 | wszystkie pary zmieniają szablon `node-red/settings.js` i CHANGELOG – reguła „bez wspólnych plików” powinna jawnie wyłączyć te dwa pliki (konflikty trywialne) | drobna |

---

## Lista poprawek do naniesienia

| # | Plik | Karta / sekcja | Poprawka | Waga |
|---|---|---|---|---|
| 1 | ZASADY.md | §2.3 | Ustalić jednoznacznie: moment odpowiedzi w trybie `started` (po kroku 7, 8 czy 9), kolejność `postDeploy` ↔ `runtime-deploy`; zaktualizować P-01 (test `emits runtime-deploy before resolving`) i Z-06 (Ryzyka) do jednej wersji (K-1) | krytyczna |
| 2 | ZASADY.md, backlog/etap-3.md | §2.3; E-02 (niezmiennik 3), Z-09 (Algorytm 4–6) | Rozstrzygnąć współbieżność `reload` (faza `preReload` poza mutexem) z wdrożeniem: np. `reloading` jako stan oczekiwania bez tokenu operacji do kroku 6 albo anulowanie cyklu przy wdrożeniu lokalnym; dopisać do ZASADY, że mutex obejmuje kroki 6–8 przeładowania (K-2) | krytyczna |
| 3 | ANALIZA.md, backlog/etap-2.md | §6.2 (krok 2.1/2.2), §5 (3.8); etap-2 „Kolejność realizacji” | Ujednolicić kolejność Z-04 → Z-05 (zgodnie z zależnością w karcie Z-05) we wszystkich trzech miejscach; poprawić uzasadnienie pary 2.2 (K-4) | krytyczna |
| 4 | backlog/etap-1.md, backlog/etap-2.md | P-02, Z-05 (Zależności, tabele) | Przerwać cykl: P-02 → Z-05 jako zależność miękka (ostrzeżenie w logu po dostarczeniu Z-05), Z-05 → P-02 jako integracja edytora (K-5) | krytyczna |
| 5 | backlog/etap-2.md, backlog/etap-3.md | Z-06 (Zależności: Z-09), Z-08 (Zależności: Z-09) | Zamienić na „punkt integracji dostarczany w Z-09” (usunąć cykle Z-06↔Z-09, Z-08↔Z-09) (K-6) | krytyczna |
| 6 | ZASADY.md, backlog/etap-2.md, backlog/etap-3.md | §2.3 akapit Z-09; Z-06 Projekt pkt 3; Z-09 | Rozstrzygnąć, czy przeładowanie z magazynu wywołuje `preDeploy`/`postDeploy`; scalić mechanizm „odczyt przed hookiem” (Z-06) z `reloadFromStorage` (Z-09) w E-01 (K-3) | istotna |
| 7 | backlog/etap-1.md | E-01 (Specyfikacja, Projekt, Podzadania) | Dodać do zakresu E-01: wspólny mutex (moduł), wydzielenie budowy konfiguracji `/flow` (z Z-04), decyzję „funkcja potoku vs parametr” (Z-06 zakłada `deploy(opts)`, E-01 ją odrzuca), wejście `setState` i przełączenie projektu (I-2, I-3) | istotna |
| 8 | ZASADY.md, ANALIZA.md, backlog/etap-1.md | §2.3 krok 6; §4.1 vs D-05; E-01/P-01 | Ujednolicić politykę połykania błędów zatrzymania (tryb domyślny); ZASADY krok 6 dostosować do decyzji; utworzyć kartę E-01b albo usunąć odwołanie (I-1) | istotna |
| 9 | ANALIZA.md | §4.2 | Zaktualizować diagram stanów o `idle` i przejścia z E-02; odnotować kwestię stanu instancji edycyjnej (Z-15) (I-4) | istotna |
| 10 | backlog/etap-3.md | Z-09 (Ryzyka „Wszystkie workery…”, BDD „Hook preReload opóźnia…”) | Uzgodnić rekomendację 503 z kryterium zlecenia i E-02 (T7), albo oznaczyć scenariusz jako zależny od decyzji D-10 (I-5) | istotna |
| 11 | backlog/etap-3.md, backlog/etap-4.md | E-02/Z-08 (`idle` → 503), Z-15 pkt 6 | Jedna propozycja `/ready` dla instancji edycyjnej; jedno pytanie (I-6) | istotna |
| 12 | backlog/etap-3.md | tabela podsumowania (E-02) | „warunek … P-01” → „wykorzystywany opcjonalnie przez P-01” (I-7) | istotna |
| 13 | ANALIZA.md, backlog/ | §6.1, §8 | Dodać kartę E-05 (np. w etap-4.md obok E-03/E-04); uzupełnić tabelę §8 o E-03, E-04, E-05; „D-01…D-06” → „D-01…D-11” (I-8, I-16) | istotna |
| 14 | ANALIZA.md | §6.2 | Zmienić pary współdzielące pliki: 1.3 (P-01 + P-02 – `deploy.js`), 2.3 (Z-06 + Z-14a – `flows/util.js`, `flows/index.js`), 3.1 (Z-08 + Z-11 – `runtime/lib/index.js`, `node-red/red.js`), 3.2 (Z-09 + Z-10 – `runtime/lib/index.js`); albo jawnie dopuścić wyjątki z kolejnością scaleń; wyłączyć z reguły `settings.js`/CHANGELOG (I-9, D-7) | istotna |
| 15 | backlog/etap-2.md | Z-03, Z-04, Z-05, Z-06, Z-07 (BDD) | Oznaczyć scenariusze będące kryteriami odbioru zlecenia (jedna konwencja dla wszystkich etapów, np. `[odbiór]`) (I-10, D-8) | istotna |
| 16 | backlog/etap-2.md | Z-03 (Specyfikacja, BDD) | Uzupełnienie ANALIZA §9 „potwierdzenie w edytorze”: dodać scenariusz warunkowy (po decyzji `dryRun`) albo w ANALIZA §9 oznaczyć jako poza zakresem minimalnym (I-11) | istotna |
| 17 | ZASADY.md | §2.1 | Dodać wiersze: Z-15 (`editorOnly`/`runtimeState.autoStart`), Z-06 `deploy.hookTimeout`, Z-09 `deploy.reload.*`, Z-10 `coordination.*` + `singleInstance`, Z-03 `allowDowngrade`, Z-08 `RED.health`/`health.host`, E-02 `instance:state`/`runtime.state`, Z-12 `RED.header`/`RED.dialog`/`deployPre` (N-1, N-2) | istotna |
| 18 | ZASADY.md (lub dokument kontraktu Z-04) | nowa sekcja „Kody błędów” | Katalog kodów i statusów HTTP wszystkich pakietów (N-3); jedna konwencja kodów w `errors[]` (N-5) | istotna |
| 19 | backlog/etap-3.md, backlog/etap-2.md | Z-11 (tabela #2, BDD), Z-03 (Przypadki błędów) | `upload_not_allowed` nie istnieje: zdefiniować jako nowy kod (w Z-03 albo Z-11) albo użyć istniejącego `invalid_request`; usunąć sprzeczność z „kody bez zmian” w Z-03 (N-4) | istotna |
| 20 | backlog/etap-3.md | Z-08 (Ryzyka, Pytania, BDD, Podzadania) | Uzgodnić z D-11: drenaż `preShutdown`/`shutdownDelay` z limitem jako opcja w karcie (scenariusz + podzadanie) albo zmienić rekomendację D-11 (I-12) | istotna |
| 21 | backlog/etap-3.md lub ANALIZA.md | Z-09 (Ryzyka „Pełne vs różnicowe”, Pytanie 8) vs D-10 | Ujednolicić wartość domyślną `type` (I-13) | istotna |
| 22 | ANALIZA.md, backlog/etap-1.md | §4.9 (wiersz `nns`), P-02 | Właściciel poprawki `deploy.js:390` = Z-05 (jak w karcie) albo przenieść do P-02 z testem – jedna wersja (I-14) | istotna |
| 23 | ANALIZA.md | §3 (wiersz P-04) | Skorygować: workery z `disableEditor` wystawiają Admin API, **nie** `/comms` (`editor-api/lib/index.js:83-87`) (I-15) | istotna |
| 24 | ANALIZA.md | §7 | Dodać decyzje dla ok. 35 nowych pytań (sekcja 7 przeglądu) lub odesłanie do „Pytań” kart; scalić duplikaty (P-02/Z-05 Overwrite, Z-08/Z-15 `/ready`) | istotna |
| 25 | backlog/etap-2.md | Z-06 (Specyfikacja „Wyjścia”, Projekt pkt 2) | Uwzględnić, że `hooks.trigger` nie odrzuca przy promise odrzuconym wartością `undefined` (`util/lib/hooks.js` `invokeStack`) – owinąć handler/wynik (D-6) | drobna |
| 26 | backlog/etap-3.md, ANALIZA.md | E-02 (Pliki, T3, Projekt pkt 3), §4.10 | `runtime/lib/index.js:247` → `:245`; dopisać, że `.catch` obejmuje tylko `loadFlows` (D-2) | drobna |
| 27 | ANALIZA.md | kolejność sekcji | Przenieść §4.9, §4.10 do sekcji 4 (przed §5) (D-1) | drobna |
| 28 | ANALIZA.md | §1 pkt 4 | Skorygować opis metody (liczba równoległych autorów) (D-3) | drobna |
| 29 | backlog/etap-2.md, backlog/etap-4.md | tabele podsumowania (Z-06 „M–L”, Z-12, E-03) | Szacunki w skali S/M/L wg ZASADY §4 (np. Z-06 → L, Z-12 → M + osobne karty punktów) (D-5) | drobna |
| 30 | backlog/etap-1.md | P-03 (BDD) | Dodać scenariusz warunkowy dla `NODE_RED_DISABLE_TELEMETRY` (po decyzji) – uzupełnienie z ANALIZA §9 (D-9) | drobna |
| 31 | backlog/etap-2.md | Z-07 (BDD) | Dodać scenariusz kolejności middleware/tras (uzupełnienie ANALIZA §9, dziś tylko w Ryzykach) (D-9) | drobna |
| 32 | backlog/etap-1.md | P-04 (BDD) | Oznaczyć scenariusz „bez `adminAuth`” jako kryterium odbioru (ANALIZA §9: kryterium zlecenia niewystarczające) | drobna |
| 33 | ZASADY.md | §2.1 | Wiersz Z-15 wymagany przez D-02 („§2.1 + Z-15”) – zob. poz. 17 (N-1) | drobna |
