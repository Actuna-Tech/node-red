# Backlog – etap 1 (P-01–P-04, Z-01, Z-02, E-01)

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.
> Zasady, szablon karty i wspólne DoD: [../ZASADY.md](../ZASADY.md). Fakty z kodu: [../WERYFIKACJA.md](../WERYFIKACJA.md).
> Ścieżki plików względem `packages/node_modules/` (kod) i katalogu głównego repozytorium (testy). Baza: 5.0.7 (ZASADY §2.2).
> Oznaczenie „do potwierdzenia” = nie sprawdzono w kodzie albo wymaga decyzji Zamawiającego.

## Podsumowanie

| ID | Tytuł | Typ | Priorytet | Ryzyko | Zależności | Szacunek |
|---|---|---|---|---|---|---|
| [E-01](#e-01--kontrakt-potoku-wdrożenia) | Kontrakt potoku wdrożenia | przerobienie | P1 | średnie | – (warunek P-01, Z-04, Z-05, Z-06, Z-08, Z-09) | L |
| [P-01](#p-01--odpowiedź-admin-api-na-wdrożenie-po-starcie-nowych-flow) | Odpowiedź Admin API na wdrożenie po starcie nowych flow | funkcja | P1 | średnie | E-01 | L |
| [P-02](#p-02--ochrona-przed-nadpisaniem-flow-przez-nieaktualny-edytor) | Ochrona przed nadpisaniem flow przez nieaktualny edytor | funkcja | P2 | średnie | Z-05 – **miękka** (po dostarczeniu Z-05 korzysta z wymogu rewizji; nie blokuje realizacji) | M |
| [P-03](#p-03--telemetria-wyłączalna-trwale-przez-administratora) | Telemetria wyłączalna trwale przez administratora | funkcja | P2 | niskie | – | M |
| [P-04](#p-04--zabezpieczenie-tokensget-przed-wywołaniem-przed-init) | Zabezpieczenie `tokens.get()` przed wywołaniem przed `init()` | poprawka błędu (bezpieczeństwo) | P1 | niskie (zmiana) / wysokie (skutek błędu) | – | S |
| [Z-01](#z-01--wyścig-subskrypcji-websocketu-comms) | Wyścig subskrypcji websocketu `/comms` | poprawka błędu | P3 | niskie | – (ten sam obszar co P-04) | S |
| [Z-02](#z-02--wymóg-uwierzytelnienia-dla-tras-administracyjnych-bloczków) | Wymóg uwierzytelnienia dla tras administracyjnych bloczków | funkcja | P1 | wysokie | – | L |

Kolejność realizacji (ANALIZA §6.2): E-01 – etap 0 (dokument kontraktu i refaktor bez zmiany zachowania); tor A: **P-04 → P-01**; tor B (równolegle): **Z-01 → P-03 → Z-02 → P-02** (P-02 – właściciel zmian `deploy.js` w etapie 1, w tym poprawki `nns`). P-04 pierwszy ze względu na bezpieczeństwo; Z-01 i P-04 dotykają tego samego protokołu `/comms`, ale różnych plików.

---

### E-01 – Kontrakt potoku wdrożenia

| Pole | Wartość |
|---|---|
| Etap / typ | 1 (etap 0 wg ANALIZA §6.2) / przerobienie (bez zmiany zachowania; wyjątek: serializacja `setState` i przełączenia projektu – do decyzji) |
| Priorytet / ryzyko | P1 / średnie |
| Ustawienie | brak |
| Zależności | brak; **warunek** P-01 (oraz Z-04, Z-05, Z-06, Z-08, Z-09, FL-B-001/FL-B-002 w kolejnych etapach) |
| Pliki | `@node-red/runtime/lib/flows/index.js:118-241` (`setFlows`), `:272-432` (`start`), `:434+` (`stop`), `:104-110` (`load`), `:570-830` (`addFlow`/`updateFlow`/`removeFlow`); `@node-red/runtime/lib/api/flows.js:37-38` (`async-mutex`), `:66-100` (mutex, 409), `:118-200`, `:283` (`setState` – bez mutexu); `@node-red/runtime/lib/storage/localfilesystem/projects/index.js:396` (przełączenie projektu → `runtime.nodes.loadFlows(true)`); `@node-red/editor-api/lib/admin/flows.js:47-69`, `admin/flow.js:36-79`; nowe: `@node-red/runtime/lib/flows/lock.js` (wspólny mutex), `@node-red/runtime/lib/flows/pipeline.js` (funkcja potoku `deploy(opts)`; nazwy modułów – do potwierdzenia przy przeglądzie) |
| Powiązania | FL-B-001/FL-B-002 (`copyFlowLayoutProperties` w `addFlow/getFlow/updateFlow`), K8S-T-005/K8S-T-006 (drenaż i wydania na workerach) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE** (potrzeba wspólnego kontraktu wynika z kodu).
- Wszystkie wejścia kończą się w `flows.setFlows()`: `full/nodes/flows` (`api/flows.js:87`), `reload` (`api/flows.js:74` → `flows.load(true)` → `setFlows(null,null,"load",false,true)`), `addFlow/updateFlow/removeFlow` (`flows/index.js:626,800,822` z typem `flows`), przełączenie projektu (`storage/localfilesystem/projects/index.js:396` → `runtime.nodes.loadFlows(true)`) oraz start runtime (`runtime/lib/index.js:241`).
- `setFlows`: zapis → `stop()` → `context.clean` → `start()` **bez await** (`:228`), zwrot `flowRevision`; pusty `.catch(function(err){})` (`:233`) połyka błędy zatrzymania/czyszczenia (klient dostaje `{rev: undefined}`).
- `start()` nie zwraca błędów: brakujące typy/moduły → zdarzenie `runtime-state` i `return` (`:301,:315`), wyjątki `Flow.start` → `console.log` (`:409-411`), błędy konstruktorów węzłów → `Log.error` (`flows/util.js:273-274`).
- Kontrola rewizji tylko w `api/flows.js:76-86` (w `mutex.runExclusive`, `:67`); przełączenie projektu nie korzysta z mutexu; `setState` (`api/flows.js:283`) – bez `runExclusive` (mutex tylko w `:67,:109,:159,:193`).
- Kolejność zdarzeń: `flows:stopping` → `flows:stopped` → `runtime-state stop` → `flows:starting` → `flows:started` → `nodes-started` → `runtime-state start` → `runtime-deploy`.

#### Specyfikacja
- **Cel:** jedna, udokumentowana i pokryta testami kolejność kroków wdrożenia (ZASADY §2.3 A/B/C), realizowana przez **jedną wewnętrzną funkcję potoku** i jeden wspólny mutex, do których pakiety dopinają się w nazwanych punktach, zamiast zmieniać `setFlows` każdy po swojemu.
- **Zakres (elementy, na które liczą karty zależne – Z-04, Z-06, Z-09, E-02):**
  1. **wspólny mutex jako moduł** (`flows/lock.js`, wydzielony z `api/flows.js:37-38`) – jedyna blokada wdrożeń, używana przez Admin API, przełączenie projektu, `setState` i przeładowanie z magazynu (Z-09, kroki B4–B5);
  2. **wydzielenie budowy konfiguracji `/flow`** z `addFlow/updateFlow/removeFlow` do czystych funkcji `buildAddFlowConfig(flow)`, `buildUpdateFlowConfig(id, flow, opts)`, `buildRemoveFlowConfig(id)` (z `copyFlowLayoutProperties` – FL-B-001 bez zmian); Z-04 rozszerza je (tworzenie pod id, `globalConfigs[]`), Z-06 przekazuje wynik do `preDeploy`;
  3. **jedna wewnętrzna funkcja potoku `deploy(opts)`** – decyzja: rekomendowana jedna funkcja (spójna z Z-06) zamiast rozproszonych parametrów; `setFlows(..., deployOpts)` pozostaje transportem opcji do `flows/index.js`;
  4. **jeden mechanizm „wczytaj, potem uruchom tę samą treść”**: `readFlowsFromStorage()` → `deploy({type:"reload", loaded})` – wspólny dla jawnego `reload` przez API (Z-06) i przeładowania z magazynu (Z-09);
  5. **ścieżki objęte kontraktem** ponad Admin API: `setState` (`POST /flows/state`, wejście E-02) i przełączenie projektu (`flows.load(true)` z `projects/index.js:396`).
- **Wejścia:** wszystkie wejścia wymienione w „Weryfikacji” oraz `setState`; opcje `deploy(opts)`: `{type: "full"|"nodes"|"flows"|"reload"|"state", source: "api"|"internal"|"storage", config?|build?, credentials?, loaded?, user?, req?, deployOpts}`; wewnętrzny obiekt `deployOpts` (na razie jedno pole `waitForStart: boolean`, domyślnie `false`).
- **Wyjścia:** bez zmian dla wszystkich wywołań (rewizja, kody HTTP, zdarzenia). Nowe: `start()` zwraca wynik `{errors: Array<{code, message, flow?, types?, modules?}>}` (dotychczasowi wywołujący wynik ignorują); kody `errors[].code` w `snake_case` (ZASADY §2.4): `missing_types`, `missing_modules`, `flow_start_failed`.
- **Niezmienniki:** przy `deployOpts` pominiętym kolejność kroków, zdarzeń, logów i odpowiedzi identyczna jak w 5.0.7; wywołania wewnętrzne (start runtime, projekty) nie przekazują `deployOpts`; zapis do magazynu zawsze przed zatrzymaniem; `runtime-deploy` zawsze po starcie; funkcje `build*FlowConfig` dają konfigurację identyczną z dzisiejszą (test równości); jedyna zmiana obserwowalna: przełączenie projektu i `setState` są serializowane z wdrożeniami przez wspólny mutex (**do decyzji** – Pytanie 14).
- **Przypadki błędów:** błąd zapisu → odrzucenie (jak dziś); błąd zatrzymania (ZASADY §2.3 krok 6, D-05): w trybie domyślnym – połknięty jak w 5.0.6; w trybie `waitForStart` (`deploy.response: "started"`) – propagowany jako `deploy_stop_failed` (500, z `rev`; implementacja w P-01).
- **Skutki uboczne:** brak nowych zachowań poza serializacją (wyżej); dokument kontraktu w `design/engine-extensions/` (ZASADY §2.3 rozszerzony o mapę „krok → funkcja/linia → pakiet”).

#### Projekt rozwiązania (minimalny)
1. **Testy charakteryzujące** (najpierw, bez zmian kodu): kolejność zdarzeń i moment rozwiązania obietnicy `setFlows` względem `flows:started` dla `full`, `nodes`, `flows`, `load(true)`, `addFlow`, `updateFlow`, `removeFlow`, `setState`, przełączenia projektu; odpowiedź HTTP `admin/flows.js` v1 (204) i v2 (`{rev}`); konfiguracja wynikowa `addFlow/updateFlow/removeFlow` (zapis oczekiwanych wyników 5.0.7).
2. **Wspólny mutex** `runtime/lib/flows/lock.js`: `runExclusive(fn)` na istniejącym `async-mutex` (bez nowej zależności); `api/flows.js` korzysta z modułu zamiast lokalnej instancji (`:37-38`). Z-09 (kroki B4–B5) używa tego samego modułu.
3. **Funkcja potoku** `runtime/lib/flows/pipeline.js` `deploy(opts)` (rekomendacja – jedna wewnętrzna funkcja, spójna z Z-06): realizuje kroki ZASADY §2.3 A w jednym miejscu – `lock.runExclusive` → (2) istniejąca kontrola `rev` → [kotwica 3: `preDeploy`, Z-06] → [kotwica 4: stan, E-02/Z-08] → (5) zapis lub – dla `reload` – użycie `opts.loaded` → (6–7) `flows.setFlows(..., deployOpts)` → [kotwica 8: stan] → koniec blokady → (9) `runtime-deploy` (emitowane jak dziś z `setFlows`) → (10) wynik → [kotwica 11: `postDeploy`, Z-06]. Funkcje `setFlows` (wszystkie typy, także `reload`), `addFlow`, `updateFlow`, `deleteFlow` w `api/flows.js` stają się cienkimi nakładkami (walidacja wejścia, mapowanie błędów). Alternatywa „parametry w każdej funkcji osobno” – odrzucona (każdy pakiet dopisywałby kroki w 4–5 miejscach).
4. **Budowa konfiguracji `/flow`**: wydzielenie z `flows/index.js` (`:570-830`) czystych funkcji `buildAddFlowConfig`, `buildUpdateFlowConfig`, `buildRemoveFlowConfig` (wspólne `buildTabNode` z `copyFlowLayoutProperties`); `addFlow/updateFlow/removeFlow` = `build*` + `deploy({type:"flows", config})`. Z-04 rozszerza te funkcje, nie wydziela ich ponownie.
5. `flows/index.js`: `setFlows(_config,_credentials,type,muteLog,forceStart,user,deployOpts)` – nowy, ostatni, opcjonalny parametr; gałąź `waitForStart` (implementacja w P-01) zostawiona jako jawny punkt rozszerzenia; `load(forceStart, deployOpts)`.
6. **Przeładowanie z magazynu – jeden mechanizm:** `readFlowsFromStorage()` (odczyt konfiguracji i rewizji) + `deploy({type:"reload", loaded})` uruchamiające dokładnie wczytaną treść bez ponownego odczytu. Jawny `reload` przez API: odczyt pod blokadą tuż przed krokiem 3, aby `preDeploy` widział treść, która zostanie uruchomiona (doprecyzowanie kroku 5 ZASADY dla typu `reload` – **do zatwierdzenia** przy przeglądzie E-01, Pytanie 15); Z-09: odczyt w kroku B4 pod tą samą blokadą, bez `preDeploy`, `postDeploy` z `source: "storage"` (ZASADY §2.3 B).
7. **`setState` (`POST /flows/state`)**: wywołanie przez `lock.runExclusive` (wejście E-02 – zmiana stanu flow serializowana z wdrożeniami); bez kroków 2, 3, 5 i bez hooków – **do decyzji** (Pytanie 14).
8. **Przełączenie projektu** (`projects/index.js:396` → `runtime.nodes.loadFlows(true)`): ścieżka przez `lock.runExclusive` (bez blokady wewnątrz jawnego `reload` API, który już ją trzyma – brak zakleszczenia), `source:"internal"`, bez `deployOpts` i bez hooków (zgodnie z rekomendacją Z-06, Pytanie 13 etapu 2 – **do decyzji**).
9. `start()` zbiera błędy do `result.errors` (brakujące typy `missing_types`, brakujące moduły `missing_modules`, wyjątek `Flow.start` `flow_start_failed`) bez zmiany logów i zdarzeń; zwraca `result`.
10. Komentarz-kotwica w kodzie dla kroków 3, 4, 8, 11 (gdzie wpinają się Z-05, Z-06, Z-08) – **bez** pustych hooków (unikamy kodu na zapas).
11. Mapa kroków (A, B, C) w dokumencie kontraktu: krok → funkcja/linia → pakiet.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Kontrakt potoku wdrożenia

  Scenariusz: Kolejność zdarzeń wdrożenia pełnego bez zmian
    Zakładając uruchomione flow i domyślne ustawienia
    Kiedy wywołam setFlows z typem "full"
    Wtedy zdarzenia wystąpią w kolejności: flows:stopping, flows:stopped, flows:starting, flows:started, runtime-deploy
    I obietnica setFlows zostanie rozwiązana przed zdarzeniem flows:started

  Szablon scenariusza: Wszystkie wejścia przechodzą przez ten sam potok
    Kiedy wykonam wdrożenie przez "<wejście>"
    Wtedy zapis do magazynu nastąpi przed zatrzymaniem węzłów
    I zdarzenie runtime-deploy zostanie wyemitowane po starcie węzłów
    Przykłady:
      | wejście        |
      | full           |
      | nodes          |
      | flows          |
      | reload         |
      | POST /flow     |
      | PUT /flow/:id  |
      | DELETE /flow/:id |

  Scenariusz: start() raportuje brakujące typy bez zmiany zachowania
    Zakładając flow z węzłem nieznanego typu
    Kiedy runtime uruchomi flow
    Wtedy wynik start() zawiera błąd o kodzie "missing_types"
    I zdarzenie runtime-state oraz logi są takie same jak w 5.0.7

  Scenariusz: Wywołania wewnętrzne bez opcji wdrożenia
    Kiedy runtime ładuje flow przy starcie lub przy przełączeniu projektu
    Wtedy setFlows jest wywoływane bez deployOpts

  Scenariusz: Wszystkie wejścia Admin API przechodzą przez jedną funkcję potoku
    Kiedy wykonam wdrożenie przez /flows, POST /flow, PUT /flow/:id, DELETE /flow/:id lub reload
    Wtedy każde z nich wywołuje deploy(opts) dokładnie raz
    I odpowiedzi HTTP są takie same jak w 5.0.7

  Scenariusz: Wydzielona budowa konfiguracji /flow bez zmiany wyniku
    Zakładając zapisane wyniki addFlow, updateFlow i removeFlow z wersji 5.0.7
    Kiedy zbuduję konfigurację funkcjami build*FlowConfig dla tych samych danych
    Wtedy konfiguracja jest identyczna, łącznie z właściwościami układu zakładki (FL-B-001)

  Scenariusz: Reload uruchamia dokładnie wczytaną treść
    Kiedy wykonam deploy z typem "reload" i konfiguracją wczytaną z magazynu
    Wtedy magazyn nie jest odczytywany ponownie
    I nic nie jest zapisywane do magazynu

  Scenariusz: Przełączenie projektu serializowane z wdrożeniem (do decyzji)
    Zakładając trwające wdrożenie przez Admin API
    Kiedy nastąpi przełączenie projektu
    Wtedy wczytanie flow projektu rozpocznie się po zakończeniu wdrożenia

  Scenariusz: setState serializowane z wdrożeniem (do decyzji)
    Zakładając trwające wdrożenie przez Admin API
    Kiedy wyślę POST /flows/state ze stanem "stop"
    Wtedy zatrzymanie flow rozpocznie się po zakończeniu wdrożenia

  Scenariusz: Błąd zatrzymania w trybie domyślnym jak w 5.0.6
    Zakładając domyślne ustawienia i węzeł, którego zamknięcie zgłasza błąd
    Kiedy wdrożę zmianę tego węzła
    Wtedy odpowiedź jest taka jak w 5.0.6
```

#### Testy
- Jednostkowe `test/unit/@node-red/runtime/lib/flows/index_spec.js`, nowy `describe('deploy pipeline contract')`:
  `emits deploy events in order for full|nodes|flows`, `resolves setFlows before flows:started by default`, `reload saves nothing and restarts all flows`, `addFlow/updateFlow/removeFlow use the same pipeline`, `buildAddFlowConfig/buildUpdateFlowConfig/buildRemoveFlowConfig match 5.0.7 results`, `start returns missing_types error`, `start returns missing_modules error`, `start returns flow_start_failed when Flow.start throws`, `default mode swallows stop errors (unchanged, D-05)`.
- Jednostkowe `test/unit/@node-red/runtime/lib/flows/lock_spec.js` (nowy): `runs exclusive sections sequentially`, `releases lock when section throws`.
- Jednostkowe `test/unit/@node-red/runtime/lib/flows/pipeline_spec.js` (nowy): `all api entries call deploy once`, `reload with loaded config does not read storage again`, `reload saves nothing`, `revision check inside lock`.
- Jednostkowe `test/unit/@node-red/runtime/lib/api/flows_spec.js`: `setFlows passes no deployOpts by default`, `reload passes no deployOpts by default`, `setState waits for running deploy` (po decyzji, Pytanie 14).
- Jednostkowe `test/unit/@node-red/runtime/lib/storage/localfilesystem/projects/index_spec.js` (lub test `runtime.nodes.loadFlows`): `project switch waits for running deploy` (po decyzji).
- Kontraktowe `test/unit/@node-red/editor-api/lib/admin/flows_spec.js`, `flow_spec.js`: istniejące przypadki bez zmian (kody 204/200, kształt odpowiedzi).

#### DoD specyficzne
- [ ] Testy charakteryzujące dodane i zielone **przed** refaktorem; po refaktorze bez zmian.
- [ ] Brak zmian w istniejących testach `flows/index_spec.js`, `api/flows_spec.js`, `admin/flow(s)_spec.js`.
- [ ] Dokument kontraktu z mapą krok → funkcja → pakiet zaakceptowany przez właścicieli P-01, Z-04–Z-06, Z-08, Z-09.
- [ ] JSDoc dla `deploy(opts)`, `deployOpts`, `build*FlowConfig`, `lock.runExclusive` i wyniku `start()`.
- [ ] Kody `errors[].code` w `snake_case` zgodnie z ZASADY §2.4.

#### Ryzyka i alternatywy
- **Połykanie błędów zatrzymania** (`:233`): rozstrzygnięte w ZASADY §2.3 krok 6 i D-05 – w trybie domyślnym bez zmian (jak 5.0.6), w trybie `deploy.response: "started"` – `deploy_stop_failed` (500, z `rev`) w P-01. Zmiana trybu domyślnego wymagałaby osobnej decyzji Zamawiającego.
- **Jedna funkcja potoku `deploy(opts)` vs parametry** – rekomendacja: jedna wewnętrzna funkcja (pkt 3 Projektu); większy diff E-01 niż sam parametr `setFlows`, ale Z-04, Z-05, Z-06, Z-08, Z-09 dopinają się w jednym miejscu, a nie w 4–5 funkcjach. Konflikt z FL-B-001 łagodzi wydzielenie `buildTabNode` z `copyFlowLayoutProperties` bez zmiany zachowania.
- **Serializacja `setState` i przełączenia projektu** – zmienia współbieżność (dziś bez blokady); ryzyko zakleszczenia, gdy ścieżka z blokadą woła inną ścieżkę z blokadą (np. `reload` → `flows.load`) – blokada tylko na granicy wejścia (`api/flows.js`, `runtime.nodes.loadFlows` dla projektów), nigdy w `flows/index.js`; test zakleszczenia.
- Konflikty scaleń z FL-B-001/002 (te same funkcje) – E-01 bazuje na gałęzi z FL-B-001 albo odwrotnie; kolejność ustalić przed startem.

#### Podzadania
- [ ] Testy charakteryzujące potoku, `setState`, projektów, wyników `addFlow/updateFlow/removeFlow` (M)
- [ ] Moduł `flows/lock.js` + przełączenie `api/flows.js` (S)
- [ ] Funkcja potoku `deploy(opts)` + nakładki w `api/flows.js` (M)
- [ ] Wydzielenie `build*FlowConfig` / `buildTabNode` (M)
- [ ] `readFlowsFromStorage` + `deploy({type:"reload", loaded})` (S)
- [ ] `setState` i przełączenie projektu przez blokadę (po decyzji) (S)
- [ ] Parametr `deployOpts` w `setFlows/load` (S)
- [ ] `start()` zwraca `{errors}` (S)
- [ ] Dokument kontraktu z mapą kroków (S)
- [ ] Przegląd z właścicielami pakietów zależnych (S)

---

### P-01 – Odpowiedź Admin API na wdrożenie po starcie nowych flow

| Pole | Wartość |
|---|---|
| Etap / typ | 1 / funkcja |
| Priorytet / ryzyko | P1 / średnie |
| Ustawienie | `deploy.response: "stopped" \| "started"` (zlecenie: `flows.deployResponse`), domyślnie `"stopped"` |
| Zależności | E-01 |
| Pliki | `@node-red/runtime/lib/flows/index.js:207-241` (`setFlows`), `:228`, `:233`, `:272-432` (`start`), `:626,:800,:822`; `@node-red/runtime/lib/api/flows.js:66-100,118-200`; `@node-red/editor-api/lib/admin/flows.js:47-69`, `admin/flow.js:36-79`; `@node-red/editor-client/src/js/ui/deploy.js:556-683` (obsługa błędu z `rev`); `node-red/settings.js` (sekcja Runtime Settings) |
| Powiązania | K8S-T-005/K8S-T-006 (wdrożenie na workerach, sondy gotowości – Z-08) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE**, z rozszerzeniem.
- `setFlows` zwraca rewizję zaraz po `stop()`+`context.clean`; `start(...)` wywołane bez `await` (`flows/index.js:228`) – odpowiedź HTTP (`admin/flows.js:62-69`, `admin/flow.js:42-59`) wychodzi przed rejestracją tras `http in` nowych węzłów → 404 dla zapytania wysłanego tuż po odpowiedzi.
- Dotyczy wszystkich typów (`full`, `nodes`, `flows`), `reload` (`api/flows.js:74`) i operacji `/flow` (`flows/index.js:626,800,822`).
- **Ponad zlecenie:** pusty `.catch` (`:233`) połyka błędy zatrzymania/czyszczenia kontekstu – klient dostaje `{rev: undefined}` (v2) lub 204 (v1) mimo błędu; błędy startu tylko w logu/zdarzeniach (`:301,:315,:325,:409-411`, `flows/util.js:273-274`).
- Wywołania wewnętrzne: start runtime (`runtime/lib/index.js:241`), przełączenie projektu (`projects/index.js:396`).
- Modyfikacja Zamawiającego (odpowiedź zawsze po starcie) – diff nie był dostępny; do przeglądu.

#### Specyfikacja
- **Cel:** w trybie `"started"` odpowiedź Admin API na wdrożenie wychodzi dopiero po starcie nowych węzłów; błędy startu trafiają do odpowiedzi.
- **Wejścia:** `POST /flows` (v1, v2; typy `full`, `nodes`, `flows`, `reload`), `POST /flow`, `PUT /flow/:id`, `DELETE /flow/:id`; ustawienie `deploy.response`.
- **Wyjścia:**
  - `"stopped"` (domyślnie): bez zmian względem 5.0.7.
  - `"started"`, sukces: jak dziś (v1 204, v2 `{rev}`, `/flow` `{id}`/204), ale po zdarzeniu `flows:started`, stanie `ready` i emisji `runtime-deploy` – **odpowiedź po kroku 9** ZASADY §2.3 A; hook `postDeploy` (Z-06, krok 11) wykonywany asynchronicznie **po** odpowiedzi i jej nie wstrzymuje.
  - `"started"`, błąd startu: odpowiedź błędu w formacie `rejectHandler` (`editor-api/lib/util.js:42-58`) `{code:"deploy_start_failed", message, rev, errors:[...]}`; HTTP 500 (ZASADY §2.4; akceptacja kodu – Pytanie 3). Konfiguracja pozostaje zapisana (rewizja zmieniona).
  - `"started"`, błąd zatrzymania: 500 `{code:"deploy_stop_failed", message, rev}` (ZASADY §2.3 krok 6, §2.4, D-05). W trybie domyślnym błąd zatrzymania połykany jak w 5.0.6.
- **Niezmienniki:** wywołania wewnętrzne runtime (start, projekty) zachowują kolejność z 5.0.6 niezależnie od ustawienia; kolejność zdarzeń bez zmian (różni się tylko moment odpowiedzi); mutex API obejmuje cały czas oczekiwania na start (kolejne wdrożenie czeka); `runtimeFlowState: "stop"` (flow zatrzymane świadomie) → odpowiedź bez błędu po zapisie.
- **Przypadki błędów:** nieznana wartość ustawienia → ostrzeżenie w logu przy starcie i tryb `"stopped"`; brakujące typy/moduły → `deploy_start_failed` z `errors[].code = missing_types|missing_modules`; wyjątek `Flow.start` → `flow_start_failed` (snake_case – ZASADY §2.4). Błędy konstruktorów pojedynczych węzłów (dziś tylko `Log.error` w `flows/util.js:273`) – **poza zakresem na etapie 1** (do potwierdzenia, zob. Pytania).
- **Skutki uboczne:** dłuższy czas odpowiedzi w trybie `"started"` (o czas startu węzłów; nie o czas `postDeploy`); zdarzenie `runtime-deploy` dociera do edytorów przed odpowiedzią – edytor wdrażający je ignoruje (`deployInflight`, `deploy.js:143-145`).

#### Projekt rozwiązania (minimalny)
1. `runtime/lib/api/flows.js`: funkcja `getDeployOpts()` czyta `runtime.settings.deploy?.response`; `"started"` → `{waitForStart:true}`; przekazanie do `setFlows`, `loadFlows(true, opts)`, `addFlow/updateFlow/removeFlow`. Walidacja wartości i ostrzeżenie raz (przy `init`).
2. `runtime/lib/flows/index.js` `setFlows` (punkt rozszerzenia z E-01): gdy `deployOpts.waitForStart` → `return start(...).then(result => { emit runtime-deploy; if (result.errors.length) throw deployStartError(result, flowRevision); return flowRevision })`, a błędy zatrzymania przepuszczane jako `deploy_stop_failed` z `rev`. Gałąź domyślna bez zmian (łącznie z pustym `.catch` – D-05). Kolejność zgodna z ZASADY §2.3 A: start (7) → stan (8) → `runtime-deploy` (9) → odpowiedź (10); `postDeploy` (11) uruchamia funkcja potoku E-01 po rozwiązaniu obietnicy, bez oczekiwania (Z-06).
3. `api/flows.js`: mapowanie błędów `deploy_start_failed`/`deploy_stop_failed` na `err.status` i dołączenie `rev`/`errors`; `editor-api/lib/util.js` `rejectHandler` – przepuszczenie `rev` i `errors` do odpowiedzi (dziś kopiuje tylko `code`, `message`, `remote`).
4. Edytor (`deploy.js` `.fail`, `:676-683`): gdy odpowiedź błędu zawiera `rev`, ustawić `RED.nodes.version(rev)` i pokazać komunikat (tekst w `locales/en-US/editor.json`, klucz `deploy.errors.startFailed`) – inaczej kolejne wdrożenie dostaje 409. Zmiana nieaktywna w trybie domyślnym (serwer nie zwraca `rev` w błędach).
5. `node-red/settings.js`: zakomentowany blok `deploy: { response: "stopped" }` z opisem; CHANGELOG.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Odpowiedź na wdrożenie po starcie nowych flow

  Scenariusz: [odbiór] Endpoint http in nowego flow dostępny zaraz po odpowiedzi w trybie "started"
    Zakładając ustawienie deploy.response = "started"
    I działający runtime z Admin API
    Kiedy wdrożę przez POST /flows nowy flow z węzłami "http in" GET /p01 i "http response"
    I natychmiast po otrzymaniu odpowiedzi wdrożenia wyślę GET /p01
    Wtedy otrzymam odpowiedź 200

  Scenariusz: [odbiór] Tryb domyślny bez zmian
    Zakładając brak ustawienia deploy.response
    Kiedy wdrożę flow przez POST /flows
    Wtedy odpowiedź zostanie wysłana przed zdarzeniem flows:started
    I kształt odpowiedzi i kod HTTP są jak w 5.0.7

  Scenariusz: [odbiór] Wdrożenie typu reload w trybie "started"
    Zakładając ustawienie deploy.response = "started"
    Kiedy wyślę POST /flows z nagłówkiem Node-RED-Deployment-Type: reload
    Wtedy odpowiedź zostanie wysłana po zdarzeniu flows:started
    I endpoint http in z flow w magazynie odpowiada 200 natychmiast po odpowiedzi

  Szablon scenariusza: Operacje /flow czekają na start w trybie "started"
    Zakładając ustawienie deploy.response = "started"
    Kiedy wykonam "<operacja>"
    Wtedy odpowiedź zostanie wysłana po zdarzeniu flows:started
    Przykłady:
      | operacja          |
      | POST /flow        |
      | PUT /flow/:id     |
      | DELETE /flow/:id  |

  Scenariusz: Błąd startu zwracany w odpowiedzi
    Zakładając ustawienie deploy.response = "started"
    Kiedy wdrożę flow z węzłem nieznanego typu przez API v2
    Wtedy otrzymam odpowiedź 500 z kodem "deploy_start_failed"
    I odpowiedź zawiera nową rewizję i listę błędów z kodem "missing_types"

  Scenariusz: Błąd zatrzymania zwracany w odpowiedzi w trybie "started"
    Zakładając ustawienie deploy.response = "started"
    I węzeł, którego zamknięcie zgłasza błąd
    Kiedy wdrożę zmianę tego węzła przez API v2
    Wtedy otrzymam odpowiedź 500 z kodem "deploy_stop_failed" i nową rewizją

  Scenariusz: Błąd zatrzymania w trybie domyślnym połykany jak w 5.0.6
    Zakładając brak ustawienia deploy.response
    I węzeł, którego zamknięcie zgłasza błąd
    Kiedy wdrożę zmianę tego węzła
    Wtedy otrzymam odpowiedź jak w 5.0.6

  Scenariusz: Odpowiedź w trybie "started" po runtime-deploy, bez oczekiwania na postDeploy (weryfikacja po dostarczeniu Z-06)
    Zakładając ustawienie deploy.response = "started"
    I zarejestrowany hook postDeploy, który kończy się po 5 s
    Kiedy wdrożę flow przez POST /flows
    Wtedy odpowiedź zostanie wysłana po zdarzeniu runtime-deploy
    I przed zakończeniem hooka postDeploy

  Scenariusz: Błąd startu w trybie domyślnym tylko w logu
    Zakładając brak ustawienia deploy.response
    Kiedy wdrożę flow z węzłem nieznanego typu
    Wtedy otrzymam odpowiedź jak w 5.0.7

  Scenariusz: Wywołania wewnętrzne zachowują kolejność z 5.0.6
    Zakładając ustawienie deploy.response = "started"
    Kiedy runtime ładuje flow przy starcie lub przy przełączeniu projektu
    Wtedy setFlows jest wywoływane bez oczekiwania na start

  Scenariusz: Nieprawidłowa wartość ustawienia
    Zakładając ustawienie deploy.response = "later"
    Kiedy runtime się uruchomi
    Wtedy w logu pojawi się ostrzeżenie
    I wdrożenia działają jak w trybie "stopped"

  Scenariusz: Kolejne wdrożenie czeka na zakończenie startu
    Zakładając ustawienie deploy.response = "started" i węzeł o długim starcie
    Kiedy wyślę dwa wdrożenia jedno po drugim
    Wtedy drugie zostanie przetworzone po odpowiedzi na pierwsze
```

#### Testy
- Jednostkowe `test/unit/@node-red/runtime/lib/flows/index_spec.js` (`describe('#setFlows waitForStart')`): `resolves after flows:started when waitForStart`, `emits runtime-deploy before resolving when waitForStart`, `rejects with deploy_start_failed and rev on missing types`, `rejects with deploy_stop_failed and rev when stop fails`, `default swallows stop errors (unchanged, D-05)`, `default resolves before flows:started (unchanged)`, `load(true,{waitForStart}) waits for start`.
- Jednostkowe `test/unit/@node-red/runtime/lib/api/flows_spec.js`: `setFlows passes waitForStart when deploy.response is started`, `reload passes waitForStart when deploy.response is started`, `addFlow/updateFlow/deleteFlow pass waitForStart`, `no deployOpts when setting absent`, `invalid deploy.response logs warning and falls back to stopped`, `maps deploy_start_failed to status 500 with rev and errors`, `maps deploy_stop_failed to status 500 with rev`, `response does not wait for postDeploy` (po Z-06; do tego czasu – test kotwicy kroku 11).
- Kontraktowe `test/unit/@node-red/editor-api/lib/admin/flows_spec.js`, `flow_spec.js`, `test/unit/@node-red/editor-api/lib/util_spec.js` (istnieje): `rejectHandler includes rev and errors when present`; istniejące przypadki bez zmian.
- Integracyjne (proces potomny `red.js`, tymczasowy `userDir`, wzorem `test/editor/e2e/flow_layout_e2espec.js`, ale bez przeglądarki): nowy plik `test/unit/node-red/deploy-response_spec.js` (lokalizacja do potwierdzenia): `started: new http-in endpoint returns 200 immediately after POST /flows`, `started: reload deploy - endpoint returns 200 immediately`, `started: POST /flow - endpoint returns 200 immediately`. Test trybu domyślnego **nie** sprawdza 404 (wyścig – test niestabilny); tryb domyślny pokrywają testy jednostkowe kolejności.
- E2E: brak (zmiana edytora ograniczona do obsługi `rev` w błędzie – test ręczny w raporcie; do potwierdzenia, czy wymagany test Playwright).

#### DoD specyficzne
- [ ] Test integracyjny trybu `"started"` czerwony bez zmiany, zielony po zmianie; 20 kolejnych uruchomień bez niestabilności.
- [ ] Ustawienie `deploy` opisane w `settings.js` (Runtime Settings) z adnotacją o wydłużonym czasie odpowiedzi.
- [ ] Opis kontraktu błędu `deploy_start_failed`/`deploy_stop_failed` w JSDoc `api/flows.js` i w CHANGELOG.
- [ ] Notatka migracyjna dla Zamawiającego: zastąpienie modyfikacji „na sztywno” ustawieniem `deploy.response: "started"`.

#### Ryzyka i alternatywy
- **Kod HTTP przy błędzie startu:** konfiguracja jest już zapisana – kod błędu może sugerować klientom brak zapisu; kod 200 z ostrzeżeniem łamie wymaganie „błąd startu zwracany w odpowiedzi”. Pytanie do Zamawiającego.
- **Długi start** (węzły z wolną inicjalizacją): odpowiedź może przekroczyć limity proxy/Ingress; mutex blokuje kolejne wdrożenia. Brak limitu czasu w zakresie P-01 (ewentualnie Z-08) – pytanie.
- Granica „błędu startu”: błędy konstruktorów węzłów nie są dziś propagowane (`flows/util.js:273`) – rozszerzenie wymagałoby zmian w `Flow.js`; proponujemy etap późniejszy.
- Alternatywa: oczekiwanie na zdarzenie `flows:started` w warstwie API zamiast parametru `setFlows` – kruche przy równoległych zdarzeniach; odrzucona.
- Workery (K8S-T-005): wdrożenie przez Admin API workera w trybie `"started"` daje deterministyczną gotowość – korzystne dla sond Z-08.

#### Podzadania
- [ ] Testy (czerwone): jednostkowe `waitForStart`, integracyjny http-in (M)
- [ ] `getDeployOpts` + przekazanie opcji w `api/flows.js` (S)
- [ ] Gałąź `waitForStart` w `setFlows` + błędy start/stop z `rev` (M)
- [ ] `rejectHandler` – `rev`/`errors` (S)
- [ ] Edytor: aktualizacja `rev` po błędzie startu + tekst en-US (S)
- [ ] `settings.js`, JSDoc, CHANGELOG, notatka migracyjna (S)

---

### P-02 – Ochrona przed nadpisaniem flow przez nieaktualny edytor

| Pole | Wartość |
|---|---|
| Etap / typ | 1 / funkcja |
| Priorytet / ryzyko | P2 / średnie |
| Ustawienie | `editorTheme.deploy.staleFlows: "prompt" \| "reload-only"` (zlecenie: `editor.staleFlowsPolicy`), domyślnie `"prompt"` |
| Zależności | Z-05 – zależność **miękka** (`deploy.requireRevision` – egzekwowanie po stronie serwera; wymóg `rev` przeniesiony do Z-05 zgodnie ze zleceniem). P-02 realizowany przed Z-05 (ANALIZA §6.2); po dostarczeniu Z-05 tryb `reload-only` korzysta z wymogu rewizji (ostrzeżenie w logu, gdy wymóg wyłączony). Integracja edytora z Z-05 (Overwrite wg D-12, `revision_required`) dotyka `deploy.js` **po** scaleniu P-02 |
| Pliki | `@node-red/editor-client/src/js/ui/deploy.js:142-176` (powiadomienie `runtime-deploy`), `:218-299` (`resolveConflict`), `:367-400` (`restart()`, `:390` – niezdefiniowane `nns`), `:404` (`save(skipValidation, force)`), `:540-543` (`rev`), `:680-681` (409); `@node-red/editor-api/lib/editor/theme.js:398-430` (przekazanie `editorTheme` do edytora); `@node-red/editor-client/locales/en-US/editor.json:378-392` (`deploy.confirm.*`); `node-red/settings.js:419+` (`editorTheme`) |
| Powiązania | FL-B-004 (okno różnic – w `reload-only` scalanie i przegląd różnic znikają), Z-14 (teksty UI w tłumaczeniach), Z-05 |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **CZĘŚCIOWO**.
- Okno konfliktu (`resolveConflict`, `deploy.js:218-299`): Cancel, Review, Merge (aktywne tylko bez konfliktów), **Overwrite tylko gdy `activeDeploy`** (`:268-279`), tj. po 409.
- Dwa wejścia: (1) odpowiedź 409 `version_mismatch` (`runtime/lib/api/flows.js:76-84`, klient `deploy.js:680-681` → `resolveConflict(nns,true)`); (2) powiadomienie w tle `notification/runtime-deploy` (`:142-176`) z przyciskiem „Review changes” → `resolveConflict(nns,false)` (bez Overwrite).
- Overwrite = `save(true, true)` → wdrożenie **bez `rev`** (`:541-543`) → serwer nie sprawdza rewizji → cudze zmiany cofnięte.
- API v2 bez `rev` przyjmowane (`api/flows.js:75` – kontrola tylko gdy `flows.hasOwnProperty('rev')`) – zakres Z-05.
- Różnica względem zlecenia: okno nie pojawia się „przy każdym wdrożeniu”, tylko po 409 lub z powiadomienia.
- Brak testów jednostkowych `deploy.js`; testy serwera: `editor-api/lib/admin/flows_spec.js`, `runtime/lib/api/flows_spec.js`.
- **Błąd istniejący (właściciel: P-02, ANALIZA §4.9):** `restart()` (`deploy.js:367-400`) przy 409 wywołuje `resolveConflict(nns, true)` (`:390`), a `nns` nie jest zdefiniowane w tym zakresie (`var nns` w `:164` i `const nns` w `save`, `:536` – inne funkcje) → `ReferenceError`. Dziś praktycznie nieosiągalne (reload nie zwraca 409); osiągalne po zmianach Z-05/Z-06 (np. 409 lub błąd z serwera dla `reload`).
- `editorTheme.deploy` nie jest dziś przekazywane do edytora (`theme.js` kopiuje wybrane klucze: `menu`, `palette`, `projects`, `multiplayer`, `keymap`, `theme`, `tours`; `deployButton` osobno `:350-365`).

#### Specyfikacja
- **Cel:** w trybie `"reload-only"` edytor z nieaktualną wersją flow nie może wdrożyć bez przeładowania; jedyną akcją okna jest przeładowanie.
- **Wejścia:** ustawienie `editorTheme.deploy.staleFlows`; zdarzenia: 409 z wdrożenia, powiadomienie `notification/runtime-deploy` z inną rewizją.
- **Wyjścia:**
  - `"prompt"` (domyślnie): bez zmian (okno z Cancel/Review/Merge/Overwrite jak w 5.0.7).
  - `"reload-only"`: blokujące okno modalne (bez zamykania klawiszem Esc i bez Cancel) z tekstem o nowszej wersji na serwerze i jedną akcją „Przeładuj” (`window.location.reload()`); po wejściu w stan nieaktualny przycisk Deploy zablokowany, a `save()` z `force=true` ignorowany.
- **Niezmienniki:** tryb domyślny – identyczny DOM i zachowanie okna; wdrożenie aktualnego edytora (zgodny `rev`) działa w obu trybach; `reload` (restart flow) i `POST /flows/state` nie są blokowane (nie nadpisują konfiguracji); zmiany z tego samego edytora nie wyzwalają okna (`currentRev === msg.revision`).
- **Przypadki błędów:** nieznana wartość ustawienia → tryb `"prompt"` + ostrzeżenie w konsoli przeglądarki; brak uprawnienia `flows.write` → bez zmian (przycisk i tak zablokowany).
- **Skutki uboczne:** utrata niewdrożonych zmian lokalnych po przeładowaniu (komunikat musi to mówić); z okna znika przegląd różnic i scalanie (FL-B-004 bez znaczenia w tym trybie).

#### Projekt rozwiązania (minimalny)
1. `editor-api/lib/editor/theme.js`: `if (theme.hasOwnProperty("deploy")) themeSettings.deploy = { staleFlows: theme.deploy.staleFlows }` (tylko znane pola).
2. `deploy.js`: `function isReloadOnly() { return RED.settings.theme("deploy.staleFlows","prompt") === "reload-only" }`; nowa funkcja `showStaleFlowsReload()` (modal `RED.notify(..., {modal:true, fixed:true, buttons:[reload]})`), stan `staleFlows = true`.
3. Wejście 409 (`:680-681`) i powiadomienie (`:142-176`): w `reload-only` wołają `showStaleFlowsReload()` zamiast `resolveConflict` / powiadomienia z „Review”.
4. `save(skipValidation, force)`: w `reload-only` – `if (staleFlows) return showStaleFlowsReload()`; `force` traktowane jak `false` (zawsze wysyłany `rev`).
5. Teksty: `editor.json` en-US `deploy.confirm.staleFlows` (treść), `deploy.confirm.button.reload`; (pl po Z-13). Ewentualne istniejące `window.onbeforeunload` przy przeładowaniu – do potwierdzenia (w `deploy.js:136-138` zakomentowane).
6. **Poprawka `restart()` (`deploy.js:390`)** – niezależna od ustawienia: przy 409 zbiór węzłów wyznaczany jak w `save` (albo komunikat błędu i odświeżenie stanu przycisku) zamiast odwołania do niezdefiniowanego `nns`; test regresji (pkt 8 / E2E). W trybie `reload-only` – `showStaleFlowsReload()`.
7. `settings.js` (`editorTheme`): zakomentowany `deploy: { staleFlows: "prompt" }` z adnotacją, że bez Z-05 tryb chroni tylko przed edytorem. Uwaga nazewnicza: obok istnieje `editorTheme.deployButton`.
8. Ułatwienie testów: na końcu `deploy.js` eksport CommonJS jak w `ui/search.js` (`if (typeof module !== "undefined" && module.exports)`) – do potwierdzenia, czy `deploy.js` daje się załadować z atrapą `RED`/`$` (duże zależności od jQuery; jeśli nie – tylko E2E).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Ochrona przed nadpisaniem flow przez nieaktualny edytor

  Scenariusz: [odbiór] Po zmianie flow przez API edytor nie może wdrożyć bez przeładowania
    Zakładając ustawienie editorTheme.deploy.staleFlows = "reload-only"
    I edytor otwarty z bieżącymi flow
    Kiedy inny klient zmieni flow przez POST /flows
    I w edytorze zmienię węzeł i kliknę Deploy
    Wtedy zobaczę blokujące okno z jedną akcją "Przeładuj"
    I okno nie zawiera akcji "Scal", "Przejrzyj zmiany" ani "Ignoruj i wdróż"
    I flow na serwerze pozostają w wersji drugiego klienta

  Scenariusz: [odbiór] Tryb domyślny bez zmian
    Zakładając brak ustawienia editorTheme.deploy.staleFlows
    Kiedy wdrożenie edytora dostanie odpowiedź 409
    Wtedy zobaczę okno z akcjami Anuluj, Przejrzyj zmiany, Scal, Ignoruj i wdróż jak w 5.0.7

  Scenariusz: Powiadomienie w tle w trybie reload-only
    Zakładając ustawienie editorTheme.deploy.staleFlows = "reload-only"
    Kiedy runtime wyemituje runtime-deploy z rewizją inną niż w edytorze
    Wtedy zobaczę blokujące okno z jedną akcją "Przeładuj"
    I przycisk Deploy pozostanie zablokowany do przeładowania

  Scenariusz: Wymuszone wdrożenie zablokowane po stronie klienta
    Zakładając ustawienie editorTheme.deploy.staleFlows = "reload-only"
    Kiedy kod edytora wywoła wdrożenie z wymuszeniem (bez rev)
    Wtedy żądanie zawiera rev
    I serwer odpowiada 409 przy nieaktualnej rewizji

  Scenariusz: Aktualny edytor wdraża normalnie
    Zakładając ustawienie editorTheme.deploy.staleFlows = "reload-only"
    I nikt inny nie zmienił flow
    Kiedy kliknę Deploy
    Wtedy wdrożenie się powiedzie bez okna

  Scenariusz: Teksty okna w tłumaczeniach
    Zakładając język edytora en-US
    Wtedy treść okna i etykieta akcji pochodzą z kluczy deploy.confirm.staleFlows i deploy.confirm.button.reload

  Scenariusz: Restart flow z edytora przy błędzie 409 nie powoduje błędu skryptu
    Zakładając domyślne ustawienia
    Kiedy restart flow z edytora (typ reload) otrzyma odpowiedź 409
    Wtedy edytor pokazuje okno konfliktu lub komunikat
    I w konsoli przeglądarki nie ma ReferenceError
    # bez poprawki: ReferenceError "nns is not defined" (deploy.js:390)

  Scenariusz: Wdrożenie API v2 bez rev (poza zakresem P-02)
    Zakładając ustawienie editorTheme.deploy.staleFlows = "reload-only" i brak deploy.requireRevision
    Kiedy klient API wyśle POST /flows v2 bez rev
    Wtedy wdrożenie jest przyjmowane jak w 5.0.7
```

#### Testy
- Jednostkowe `test/unit/@node-red/editor-api/lib/editor/theme_spec.js`: `passes editorTheme.deploy.staleFlows to the editor`, `omits deploy when not set`.
- Jednostkowe edytora (jeśli wykonalne, pkt 8) `test/unit/@node-red/editor-client/ui/deploy_spec.js`: `reload-only: 409 shows reload dialog instead of resolveConflict`, `reload-only: runtime-deploy notification shows reload dialog`, `reload-only: save(true,true) still sends rev`, `prompt: 409 calls resolveConflict with activeDeploy`, `restart: 409 does not throw ReferenceError` (regresja `:390`, czerwony bez poprawki).
- E2E Playwright `test/editor/e2e/stale_flows_e2espec.js` (wzorem `flow_layout_e2espec.js`, pomijany bez Playwright): `reload-only: deploy after API change shows reload-only dialog`, `reload-only: background update shows reload-only dialog`, `reload-only: server flows unchanged after attempt`, `prompt: conflict dialog has merge and overwrite`, `restart with 409 shows dialog without script error` (gdy test jednostkowy niewykonalny – atrapa odpowiedzi 409 dla `reload`).
- Kontraktowe serwera: bez zmian (`admin/flows_spec.js`, `api/flows_spec.js` – istniejące 409).

#### DoD specyficzne
- [ ] Oba wejścia (409 i `runtime-deploy`) oraz `save(true,true)` objęte w `reload-only`.
- [ ] Teksty w `locales/en-US/editor.json` (bez nazw produktów); klucze zgłoszone do Z-13 (pl).
- [ ] Opis w `settings.js` zawiera ostrzeżenie o braku ochrony przed klientami API bez Z-05.
- [ ] Zrzut ekranu okna w raporcie.
- [ ] Poprawka `restart()` (`deploy.js:390`) z testem regresji (czerwony bez poprawki) i wpisem w CHANGELOG.

#### Ryzyka i alternatywy
- **Ochrona tylko po stronie klienta:** dowolny klient API (lub zmodyfikowany edytor) może wdrożyć bez `rev`. Pełna ochrona wymaga Z-05 (`deploy.requireRevision`). Propozycja: P-02 przy starcie runtime loguje ostrzeżenie, gdy `reload-only` bez `deploy.requireRevision` (aktywne po dostarczeniu Z-05 – zależność miękka). Wymuszone nadpisanie przy `deploy.requireRevision` (D-12): edytor wysyła aktualną rewizję po potwierdzeniu w oknie; w `reload-only` niedostępne (realizacja w Z-05). Pytanie do Zamawiającego, czy `reload-only` ma implikować wymóg `rev`.
- Utrata pracy użytkownika przy przeładowaniu – alternatywa: akcja „Eksportuj moje zmiany” przed przeładowaniem (poza zakresem; pytanie).
- Zakres okna: czy zachować podgląd różnic tylko do odczytu – pytanie.
- Testy jednostkowe `deploy.js` mogą być niewykonalne bez dużej atrapy jQuery → główny dowód to E2E (wymaga Playwright, nie jest zależnością projektu).
- Nazwa `editorTheme.deploy` obok `editorTheme.deployButton` – możliwe pomylenie; alternatywa `editorTheme.deployButton.staleFlows` odrzucona (to ustawienia wyglądu przycisku).

#### Podzadania
- [ ] `theme.js` – przekazanie ustawienia + test (S)
- [ ] `deploy.js` – `showStaleFlowsReload`, oba wejścia, blokada `force` (M)
- [ ] Poprawka `restart()` (`nns`, `:390`) + test regresji (S)
- [ ] Teksty en-US (S)
- [ ] Test jednostkowy edytora (o ile wykonalny) (M)
- [ ] E2E Playwright (M)
- [ ] `settings.js`, CHANGELOG (S)

---

### P-03 – Telemetria wyłączalna trwale przez administratora

| Pole | Wartość |
|---|---|
| Etap / typ | 1 / funkcja |
| Priorytet / ryzyko | P2 / niskie |
| Ustawienie | `telemetry: { enabled: false, locked: true }` (zlecenie: `telemetry.locked` – bez zmian) |
| Zależności | brak |
| Pliki | `@node-red/runtime/lib/telemetry/index.js:99-138` (`isTelemetryEnabled`), `:183-199` (`enable/disable`), `:205` (`isEnabled`); `@node-red/runtime/lib/api/settings.js:164`, `:224-233`; `@node-red/editor-client/src/js/ui/userSettings.js:238-248`, `:280-300`; `@node-red/editor-client/src/js/red.js:691-720` (`checkTelemetry`); `node-red/red.js:222-224`; `node-red/settings.js:317-332` |
| Powiązania | K8S-T-002 (ustawienia w bazie – `telemetryEnabled` zapisywane w magazynie ustawień) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE**.
- `isTelemetryEnabled()` (`telemetry/index.js:99-138`): zapisany `telemetryEnabled` (runtime) ma pierwszeństwo przed `telemetry.enabled` z settings.js.
- `NODE_RED_DISABLE_TELEMETRY` / `--no-telemetry` ustawiają tylko `settings.telemetry.enabled = false` (`node-red/red.js:222-224`) – zapisany przełącznik użytkownika nadal wygrywa.
- `updateUserSettings` (`api/settings.js:224-233`) woła `telemetry.enable()/disable()` bez sprawdzenia ustawienia administratora – dowolny użytkownik z `settings.write` może włączyć telemetrię.
- Edytor wysyła **cały** obiekt ustawień użytkownika (`editor-client/src/js/settings.js:224-249`, `POST settings/user`) – odrzucenie żądania (400) zablokowałoby zapis wszystkich ustawień użytkownika.
- `report()` sprawdza `isTelemetryEnabled()` przed wysłaniem (`telemetry/index.js:47-50`); powiadomienia o aktualizacji są wynikiem raportu (wyłączenie telemetrii wyłącza je też).
- Testy: `test/unit/@node-red/runtime/lib/telemetry/index_spec.js` (m.in. `User settings - enable overrides runtime settings`), `runtime/lib/api/settings_spec.js`.

#### Specyfikacja
- **Cel:** administrator może trwale ustalić stan telemetrii; użytkownik edytora nie może go zmienić.
- **Wejścia:** `telemetry.enabled`, `telemetry.locked` (settings.js); zapisane `telemetryEnabled`; `POST /settings/user` z `telemetryEnabled`; zmienna `NODE_RED_DISABLE_TELEMETRY`.
- **Wyjścia:**
  - `locked: true` → `isEnabled()` = `telemetry.enabled === true` (brak `enabled` → `false`); zapisane `telemetryEnabled` ignorowane.
  - `GET /settings` zwraca `telemetryEnabled` (wartość efektywna) i nowe pole `telemetryLocked: true`.
  - Edytor: przełącznik widoczny, nieaktywny, z opisem „ustawione przez administratora”; okno zgody przy pierwszym uruchomieniu nie jest pokazywane.
  - `POST /settings/user` z `telemetryEnabled` przy `locked` → wartość ignorowana (bez `enable/disable`, bez zapisu), reszta ustawień zapisana, wpis audytu `settings.update` z `telemetry:"locked"` (propozycja), odpowiedź jak dziś (204).
  - Bez `locked` → jak 5.0.6.
- **Niezmienniki:** bez `locked` zachowanie i istniejące testy bez zmian; zapisane `telemetryEnabled` nie jest kasowane przy `locked` (po zdjęciu blokady wraca wybór użytkownika).
- **Przypadki błędów:** `locked` nie-boolean → traktowane jak `false` + ostrzeżenie; magazyn ustawień niedostępny → bez zmian.
- **Skutki uboczne:** przy `locked` i `enabled:false` brak powiadomień o nowej wersji (jak dziś przy wyłączonej telemetrii) – opis w `settings.js`.

#### Projekt rozwiązania (minimalny)
1. `telemetry/index.js`: `function isTelemetryLocked()` (`settings.get('telemetry')?.locked === true`); w `isTelemetryEnabled()` przed odczytem `telemetryEnabled`: `if (isTelemetryLocked()) return telemetrySettings.enabled === true`; `enable()/disable()` przy blokadzie – no-op z `log.debug`; eksport `isLocked`.
2. `api/settings.js:224-233`: przy `runtime.telemetry.isLocked()` usunąć `telemetryEnabled` z `currentSettings` bez wywołań; audyt. `:164`: `safeSettings.telemetryLocked = true` tylko gdy zablokowana (brak pola w trybie domyślnym – zgodność odpowiedzi).
3. Edytor: `userSettings.js` – obsługa opcji `disabled` dla przełącznika (do potwierdzenia, czy mechanizm istnieje; w `:280-300` brak) i opis z klucza `telemetry.lockedByAdmin` (en-US); `red.js` `checkTelemetry` – pominięcie, gdy `RED.settings.telemetryLocked`.
4. `NODE_RED_DISABLE_TELEMETRY`: **propozycja** – ustawia także `locked: true` (zmienna środowiskowa to decyzja operatora, nie użytkownika); zmiana zachowania 5.0.6 → wymaga zgody (Pytania). Do decyzji implementowana za flagą w tym samym miejscu (`node-red/red.js:222-224`).
5. `settings.js` (blok `telemetry`): zakomentowane `// locked: true` z opisem; CHANGELOG.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Telemetria blokowana przez administratora

  Scenariusz: [odbiór] Blokada wygrywa z zapisanym przełącznikiem użytkownika
    Zakładając ustawienie telemetry = { enabled: false, locked: true }
    I zapisane ustawienie runtime telemetryEnabled = true
    Kiedy runtime się uruchomi
    Wtedy telemetria nie jest włączona
    I harmonogram wysyłki nie jest uruchomiony

  Scenariusz: [odbiór] Bez locked zachowanie jak w 5.0.6
    Zakładając ustawienie telemetry = { enabled: false }
    I zapisane ustawienie runtime telemetryEnabled = true
    Kiedy runtime się uruchomi
    Wtedy telemetria jest włączona

  Scenariusz: Próba włączenia przez API ustawień jest ignorowana
    Zakładając ustawienie telemetry = { enabled: false, locked: true }
    Kiedy użytkownik z uprawnieniem settings.write wyśle POST /settings/user z telemetryEnabled = true i innym ustawieniem
    Wtedy telemetria pozostaje wyłączona
    I wartość telemetryEnabled nie zostaje zapisana
    I inne ustawienie użytkownika zostaje zapisane
    I powstaje wpis audytu

  Scenariusz: Edytor pokazuje przełącznik zablokowany
    Zakładając ustawienie telemetry = { enabled: false, locked: true }
    Kiedy otworzę edytor
    Wtedy GET /settings zwraca telemetryLocked = true i telemetryEnabled = false
    I przełącznik telemetrii jest nieaktywny z opisem o administratorze
    I okno zgody na telemetrię nie jest wyświetlane

  Scenariusz: Blokada z włączoną telemetrią
    Zakładając ustawienie telemetry = { enabled: true, locked: true }
    I zapisane telemetryEnabled = false
    Wtedy telemetria jest włączona

  Scenariusz: Brak pola telemetryLocked w trybie domyślnym
    Zakładając brak telemetry.locked
    Wtedy odpowiedź GET /settings nie zawiera pola telemetryLocked

  # Scenariusz warunkowy – obowiązuje tylko po decyzji Zamawiającego, że zmienna implikuje locked (Pytanie 7)
  Scenariusz: Zmienna NODE_RED_DISABLE_TELEMETRY blokuje telemetrię (warunkowy)
    Zakładając zmienną środowiskową NODE_RED_DISABLE_TELEMETRY ustawioną przy starcie
    I zapisane ustawienie runtime telemetryEnabled = true
    Kiedy runtime się uruchomi
    Wtedy telemetria nie jest włączona
    I GET /settings zwraca telemetryLocked = true
    I próba włączenia przez POST /settings/user jest ignorowana
  # Wariant przy decyzji przeciwnej: zachowanie jak w 5.0.6 (zapisany przełącznik użytkownika wygrywa) – test charakteryzujący
```

#### Testy
- Jednostkowe `test/unit/@node-red/runtime/lib/telemetry/index_spec.js`: `Locked - settings disable overrides user enable`, `Locked - settings enable overrides user disable`, `Locked without enabled - disabled`, `Locked - enable() does not start schedule` (atrapa `cronosjs.scheduleTask`), `Not locked - user settings override (unchanged)`.
- Jednostkowe `test/unit/@node-red/runtime/lib/api/settings_spec.js`: `updateUserSettings ignores telemetryEnabled when locked`, `updateUserSettings saves other settings when telemetry locked`, `updateUserSettings enables telemetry when not locked (unchanged)`, `getRuntimeSettings includes telemetryLocked when locked`, `getRuntimeSettings omits telemetryLocked by default`.
- Jednostkowe `test/unit/node-red/red_spec.js` (do potwierdzenia, czy `red.js` CLI jest testowalny) – scenariusz warunkowy `NODE_RED_DISABLE_TELEMETRY`: `env var implies locked` (po zatwierdzeniu implikacji) albo `env var keeps 5.0.6 behaviour` (po decyzji przeciwnej).
- E2E: opcjonalnie w `test/editor/e2e/` – przełącznik nieaktywny (do potwierdzenia potrzeby).

#### DoD specyficzne
- [ ] Testy z kryteriów odbioru czerwone przed zmianą.
- [ ] `settings.js` opisuje `locked` i wpływ na powiadomienia o aktualizacji.
- [ ] Tekst en-US `telemetry.lockedByAdmin`.
- [ ] Decyzja o `NODE_RED_DISABLE_TELEMETRY` udokumentowana w karcie i CHANGELOG.

#### Ryzyka i alternatywy
- Odrzucenie (400) zamiast ignorowania – złamałoby zapis wszystkich ustawień użytkownika (edytor wysyła całość); dlatego ignorowanie + audyt.
- `locked: true` z `enabled: true` wymusza telemetrię bez zgody użytkownika – decyzja administratora; pytanie, czy dopuszczalne.
- Zmienna środowiskowa implikująca `locked` zmienia zachowanie 5.0.6 – wymaga zgody.
- Modyfikacja Zamawiającego (`isTelemetryEnabled()` zawsze `false`) – po wdrożeniu P-03 zastąpiona ustawieniem `{enabled:false, locked:true}`.

#### Podzadania
- [ ] `isTelemetryLocked`, `isTelemetryEnabled`, `enable/disable` + testy (S)
- [ ] API ustawień: ignorowanie, `telemetryLocked` + testy (S)
- [ ] Edytor: przełącznik nieaktywny, pominięcie okna zgody, tekst en-US (M)
- [ ] (po decyzji) zmienna środowiskowa → `locked` (S)
- [ ] `settings.js`, CHANGELOG (S)

---

### P-04 – Zabezpieczenie `tokens.get()` przed wywołaniem przed `init()`

| Pole | Wartość |
|---|---|
| Etap / typ | 1 / poprawka błędu (bezpieczeństwo – zdalne zakończenie procesu) |
| Priorytet / ryzyko | P1 / niskie ryzyko zmiany, **wysoki** skutek błędu |
| Ustawienie | brak (poprawka błędu – wyjątek od zasady „domyślnie wyłączone”) |
| Zależności | brak |
| Pliki | `@node-red/editor-api/lib/auth/tokens.js:19,86-94,118-135` (`loadSessions`, `get`); `@node-red/editor-api/lib/auth/index.js:45-50` (`Tokens.init` tylko przy `adminAuth`); `@node-red/editor-api/lib/editor/comms.js:69-70` (`pendingAuth`), `:82-107` (`handleAuthPacket`), `:131-165` (`message`), `:222-245` (`upgrade`); `node-red/red.js:525-540` |
| Powiązania | Z-01 (ten sam protokół `/comms`), K8S-T-005 (workery z `disableEditor` – `/comms` nie jest uruchamiane) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE, poważniejsze niż w zleceniu** (wniosek z kodu, nie uruchamiano).
- `tokens.get()` → `loadSessions()` → `storage.getSessions()` przy `storage === undefined` → **synchroniczny** `TypeError` (`tokens.js:86-94,118-119`).
- `Tokens.init` wywoływany tylko przy `adminAuth` (`auth/index.js:45-50`).
- Przy **wyłączonym** `adminAuth`: `pendingAuth = false` (`comms.js:70`), więc pakiet `{"auth":"x"}` trafia do `handleAuthPacket` (`:135-137`) → `Tokens.get` rzuca synchronicznie w obsłudze zdarzenia `message` → wyjątek nieobsłużony → `node-red/red.js:525-540` `process.exit(1)`.
- `handleAuthPacket` bez `.catch` (także `Users.get/Users.tokens` w środku).
- **Wektor bez uwierzytelnienia:** połączenie websocket jest obsługiwane przez `server.on('upgrade')` (`comms.js:222-245`) – z pominięciem `httpAdminMiddleware`; brak kontroli nagłówka `Origin` (brak `verifyClient`) → także strona WWW otwarta w przeglądarce użytkownika z dostępem do instancji może otworzyć `/comms` i wysłać pakiet (cross-site WebSocket). Realny scenariusz niezłośliwy: przeglądarka z tokenem zapamiętanym po wcześniejszym włączeniu `adminAuth` (klient wysyła `auth`, gdy ma `auth-tokens`, `editor-client/src/js/comms.js:60-61,79-80`).
- Opis zlecenia („przed inicjalizacją magazynu sesji”) – przy włączonym `adminAuth` `init` ustawia `storage` przed startem serwera, więc scenariusz z `adminAuth` nie został potwierdzony; potwierdzony jest scenariusz z wyłączonym `adminAuth`.
- Testy: `test/unit/@node-red/editor-api/lib/auth/tokens_spec.js` (zawsze po `init`), `editor-api/lib/editor/comms_spec.js` (brak przypadku pakietu `auth` bez `adminAuth`; `Tokens.get` atrapowany w sekcjach z `adminAuth`).
- Modyfikacja Zamawiającego – diff niedostępny; „przegląd modyfikacji” wymaga jego dostarczenia (do potwierdzenia).

#### Specyfikacja
- **Cel:** żadne wywołanie `tokens.*` przed `init()` ani pakiet `auth` od klienta nie może zakończyć procesu.
- **Wejścia:** wywołanie `Tokens.get(token)` przed `init`; pakiet websocket `{"auth": <dowolna wartość>}` przy włączonym i wyłączonym `adminAuth`.
- **Wyjścia:**
  - `Tokens.get` przed `init` → obietnica rozwiązana wartością `null` (brak sesji), bez wyjątku synchronicznego; pozostałe funkcje korzystające z `storage` (`create`, `revoke`, `clear`, wygasanie – do potwierdzenia pełnej listy) – odrzucona obietnica z błędem `not_initialised` zamiast `TypeError`.
  - Pakiet `auth` przy wyłączonym `adminAuth` → serwer nie woła `Tokens`; odpowiada `{"auth":"ok"}` (połączenie i tak jest aktywne – klient z zapamiętanym tokenem kończy łączenie i odtwarza subskrypcje). Propozycja – do potwierdzenia (alternatywa: zignorować pakiet; wtedy klient z `pendingAuth` nie odtworzy subskrypcji).
  - Błąd w `handleAuthPacket` (odrzucenie `Tokens.get`/`Users.*`) → `{"auth":"fail"}` + zamknięcie połączenia + wpis audytu `comms.auth.fail`.
- **Niezmienniki:** przy włączonym `adminAuth` i zainicjowanym module zachowanie jak dziś (istniejące testy `comms_spec.js`, `tokens_spec.js` bez zmian).
- **Przypadki błędów:** jak wyżej; brak wyjątków synchronicznych w obsłudze zdarzeń websocket.
- **Skutki uboczne:** brak.

#### Projekt rozwiązania (minimalny)
1. `tokens.js`: w `loadSessions()` – `if (!storage) return Promise.resolve()` (puste sesje); `get()` działa wtedy na pustym `sessions`/`apiAccessTokens` (zainicjować `apiAccessTokens = {}` w deklaracji). Funkcje zapisujące – strażnik zwracający odrzuconą obietnicę.
2. `comms.js` `handleAuthPacket`: `if (!settings.adminAuth) { ws.send({auth:"ok"}); return }` (do potwierdzenia, pkt w Specyfikacji); obudowanie całości w `Promise.resolve().then(() => Tokens.get(msg.auth))…` + `.catch(() => completeConnection(msg,null,null,false))`.
3. Opis do zgłoszenia upstream: przyczyna, wektor, wersje (5.0.6, 5.0.7), poprawka i test – **kanał prywatny** wg `SECURITY.md` projektu (`team@nodered.org`; eskalacja: OpenJS Foundation CNA `security@lists.openjsf.org` po 6 dniach roboczych bez potwierdzenia), **nie** publiczny PR/issue do czasu odpowiedzi zespołu. Bez nazw produktów Zamawiającego.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: tokens.get() przed init()

  Scenariusz: [odbiór] Wywołanie przed init() nie kończy się błędem
    Zakładając świeżo załadowany moduł tokens bez wywołania init()
    Kiedy wywołam Tokens.get("x")
    Wtedy nie zostanie rzucony wyjątek synchroniczny
    I obietnica zostanie rozwiązana wartością null
    # bez poprawki: TypeError "Cannot read properties of undefined (reading 'getSessions')"

  # uzupełnienie kryterium zlecenia (ANALIZA §9: kryterium zlecenia niewystarczające) – część odbioru
  Scenariusz: [odbiór] Pakiet auth przy wyłączonym adminAuth nie kończy procesu
    Zakładając serwer comms bez adminAuth i niezainicjowany moduł tokens
    Kiedy klient websocket wyśle {"auth":"x"}
    Wtedy proces działa dalej
    I klient otrzyma {"auth":"ok"}
    I klient nadal otrzymuje wiadomości z subskrybowanych tematów

  Scenariusz: Błąd weryfikacji tokenu przy włączonym adminAuth
    Zakładając serwer comms z adminAuth
    I Tokens.get odrzuca obietnicę
    Kiedy klient wyśle {"auth":"x"}
    Wtedy klient otrzyma {"auth":"fail"}
    I połączenie zostanie zamknięte
    I powstanie wpis audytu comms.auth.fail

  Scenariusz: Zachowanie przy włączonym adminAuth bez zmian
    Zakładając serwer comms z adminAuth i poprawnym tokenem
    Kiedy klient wyśle {"auth":"1234"}
    Wtedy klient otrzyma {"auth":"ok"} jak w 5.0.7
```

#### Testy
- Regresja `test/unit/@node-red/editor-api/lib/auth/tokens_spec.js`, `describe("#get before init")`: `does not throw and resolves null when called before init` – moduł ładowany na świeżo (`delete require.cache[NR_TEST_UTILS.resolve("@node-red/editor-api/lib/auth/tokens")]`), bo stan modułu jest współdzielony między plikami testów; `create/revoke before init reject with not_initialised`.
- Regresja `test/unit/@node-red/editor-api/lib/editor/comms_spec.js`, nowy `describe("auth packet without adminAuth")` (świeże `comms` i `tokens` z pamięci podręcznej `require`): `does not crash on auth packet when adminAuth disabled` (bez poprawki mocha zgłasza wyjątek nieobsłużony → test czerwony), `replies auth ok and keeps delivering messages`; w `authentication required, no anonymous`: `rejects connection when token lookup fails`.
- Dowód „pada bez poprawki”: uruchomienie obu testów na bazie bez zmiany – wynik w raporcie.

#### DoD specyficzne
- [ ] Oba testy regresji czerwone na bazie 5.0.7, zielone po poprawce (logi w raporcie).
- [ ] Opis zgłoszenia upstream (osobny dokument roboczy, przekazany Zamawiającemu przed wysyłką) zgodny z `SECURITY.md`; brak publicznego PR do czasu decyzji.
- [ ] Ocena bezpieczeństwa w raporcie: wektor (brak `adminAuth`, `httpAdminMiddleware` nie chroni `/comms`, brak kontroli `Origin`), skutek (DoS), obejście tymczasowe (`disableEditor` albo `adminAuth`).
- [ ] CHANGELOG – wpis neutralny („Prevent crash on websocket auth packet when admin auth is disabled”) po uzgodnieniu terminu ujawnienia.

#### Ryzyka i alternatywy
- Ujawnienie podatności publicznym PR przed poprawką upstream – dlatego zgłoszenie prywatne; termin publikacji gałęzi uzgodnić z Zamawiającym.
- Odpowiedź `auth ok` bez `adminAuth` vs ignorowanie pakietu – wpływ na klienta z zapamiętanym tokenem (pytanie).
- Brak kontroli `Origin` dla `/comms` – osobny problem bezpieczeństwa (odczyt komunikatów debug przez obcą stronę przy braku `adminAuth`); poza zakresem P-04, zgłosić razem (pytanie, czy dodać pakiet).
- Alternatywa: tylko strażnik w `tokens.js` (bez zmiany `comms.js`) – usuwa awarię, ale klient z tokenem dostaje `auth fail` i pętlę logowania; odrzucona jako niepełna.

#### Podzadania
- [ ] Testy regresji `tokens_spec`, `comms_spec` (czerwone) (S)
- [ ] Strażniki w `tokens.js` (S)
- [ ] `handleAuthPacket`: brak `adminAuth`, `.catch` (S)
- [ ] Ocena bezpieczeństwa + opis zgłoszenia wg `SECURITY.md` (S)
- [ ] Przegląd modyfikacji Zamawiającego (po dostarczeniu diffu) (S)

---

### Z-01 – Wyścig subskrypcji websocketu `/comms`

| Pole | Wartość |
|---|---|
| Etap / typ | 1 / poprawka błędu |
| Priorytet / ryzyko | P3 / niskie |
| Ustawienie | brak (poprawka błędu) |
| Zależności | brak (ten sam protokół co P-04, inne pliki) |
| Pliki | `@node-red/editor-client/src/js/comms.js:25` (`pendingAuth`), `:60-69` (`completeConnection`), `:79-98`, `:175-183` (`subscribe`); serwer (bez zmian) `@node-red/editor-api/lib/editor/comms.js:110-112,149-165` |
| Powiązania | K8S-T-002 (edytor z `adminAuth` w roli editor) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE, z korektą**.
- Klient `subscribe()` (`comms.js:175-183`) wysyła `{subscribe}` przy `readyState == 1` bez sprawdzenia `pendingAuth`.
- Po `auth ok` `completeConnection()` (`:62-69`) i tak wysyła wszystkie subskrypcje z mapy `subscriptions` – subskrypcja nie ginie w danych klienta.
- Serwer przy `pendingAuth` (`editor-api/lib/editor/comms.js:149-165`): z użytkownikiem anonimowym – obsługuje subskrypcję; **bez** użytkownika anonimowego – `auth fail` i zamknięcie połączenia (`:110-112,:162-163`), a klient reaguje oknem logowania i ponownym łączeniem (`client :93-98`).
- Korekta względem zlecenia: skutkiem nie jest cicha utrata subskrypcji, tylko zerwanie połączenia i zbędne logowanie.
- Brak testów jednostkowych klienta; wzorzec ładowania kodu klienta w mocha istnieje: `test/unit/@node-red/editor-client/ui/search_spec.js`, `view-layout_spec.js` (globalny atrapowy `RED`, `require` po eksporcie CommonJS – `ui/search.js` ma `if (typeof module !== "undefined" && module.exports)`); E2E Playwright: `test/editor/e2e/flow_layout_e2espec.js`.

#### Specyfikacja
- **Cel:** subskrypcje zgłoszone przed potwierdzeniem uwierzytelnienia są wysyłane dopiero po `auth ok`.
- **Wejścia:** `RED.comms.subscribe(topic, cb)` wywołane, gdy `ws.readyState == 1` i `pendingAuth == true`.
- **Wyjścia:** brak wysyłki `{subscribe}` przed `auth ok`; po `auth ok` dokładnie jedna wysyłka na temat (przez istniejące `completeConnection`).
- **Niezmienniki:** bez `adminAuth` (brak `auth-tokens`, `pendingAuth == false`) – wysyłka natychmiastowa jak dziś; protokół serwera bez zmian; obsługa wiadomości i ponownego łączenia bez zmian.
- **Przypadki błędów:** `auth fail` → subskrypcje pozostają w mapie i są wysyłane po kolejnym udanym połączeniu (jak dziś).
- **Skutki uboczne:** brak.

#### Projekt rozwiązania (minimalny)
1. `editor-client/src/js/comms.js` `subscribe()`: warunek `if (ws && ws.readyState == 1 && !pendingAuth)`. Kolejka = istniejąca mapa `subscriptions` (odtwarzana w `completeConnection`).
2. Testowalność: na końcu pliku eksport CommonJS jak w `ui/search.js` (`module.exports = RED.comms`) – nie wpływa na zbudowany edytor (wzorzec już przyjęty w repozytorium).
3. Test klienta `test/unit/@node-red/editor-client/comms_spec.js`: globalne atrapy `RED` (`events.on`, `settings.get` zwracające `auth-tokens`, `user.login`, `notify`, `_`), `location`/`document`, klasa `WebSocket` rejestrująca `send` i pozwalająca wywołać `onopen`/`onmessage`.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Subskrypcje przed potwierdzeniem uwierzytelnienia

  Scenariusz: [odbiór] Subskrypcja sprzed auth ok dostarczona po auth ok
    Zakładając edytor z zapisanym tokenem dostępu
    I otwarte połączenie websocket oczekujące na potwierdzenie uwierzytelnienia
    Kiedy edytor zasubskrybuje temat "notification/#"
    Wtedy do serwera nie zostanie wysłana wiadomość subscribe
    Kiedy serwer odpowie {"auth":"ok"}
    Wtedy do serwera zostanie wysłana dokładnie jedna wiadomość subscribe dla "notification/#"

  Scenariusz: [odbiór] Bez adminAuth bez zmian
    Zakładając edytor bez tokenu dostępu
    I otwarte połączenie websocket
    Kiedy edytor zasubskrybuje temat "notification/#"
    Wtedy wiadomość subscribe zostanie wysłana natychmiast

  Scenariusz: Brak zerwania połączenia przy adminAuth bez użytkownika anonimowego
    Zakładając serwer z adminAuth bez użytkownika anonimowego
    Kiedy klient zasubskrybuje temat przed potwierdzeniem uwierzytelnienia
    Wtedy serwer nie odpowie {"auth":"fail"}
    I połączenie pozostanie otwarte po auth ok

  Scenariusz: Subskrypcje po nieudanym uwierzytelnieniu zachowane
    Zakładając subskrypcję zgłoszoną przed potwierdzeniem
    Kiedy serwer odpowie {"auth":"fail"} i klient połączy się ponownie z poprawnym tokenem
    Wtedy subskrypcja zostanie wysłana po auth ok nowego połączenia
```

#### Testy
- Jednostkowe klienta (nowe) `test/unit/@node-red/editor-client/comms_spec.js`: `does not send subscribe while auth pending`, `sends each pending subscription exactly once after auth ok`, `sends subscribe immediately without auth tokens`, `keeps subscriptions after auth fail and replays on reconnect`. Test `sends each pending subscription exactly once` czerwony bez poprawki (dziś wysyłka podwójna: przed i po `auth ok`).
- Serwer – charakteryzujący `test/unit/@node-red/editor-api/lib/editor/comms_spec.js` w `authentication required, no anonymous`: `closes connection with auth fail when subscribe arrives before auth` (dokumentuje przyczynę; bez zmian kodu serwera).
- E2E (opcjonalnie, alternatywa przy braku zgody na eksport CommonJS): `test/editor/e2e/comms_auth_e2espec.js` – edytor z `adminAuth`, brak okna logowania po przeładowaniu z ważnym tokenem.

#### DoD specyficzne
- [ ] Test klienta czerwony bez poprawki, zielony z poprawką.
- [ ] Zmiana klienta ograniczona do warunku w `subscribe()` (+ eksport testowy).
- [ ] Opis w CHANGELOG (poprawka błędu).

#### Ryzyka i alternatywy
- Eksport CommonJS w `comms.js` to zmiana pliku produkcyjnego dla testów – wzorzec istnieje (`ui/search.js`), ale wymaga akceptacji przeglądu; alternatywa: E2E.
- Alternatywa po stronie serwera (kolejkowanie wiadomości przy `pendingAuth`) – większa zmiana protokołu, niepotrzebna, skoro klient odtwarza subskrypcje; odrzucona.
- `unsubscribe()` klienta nie wysyła nic do serwera – istniejąca cecha, poza zakresem.

#### Podzadania
- [ ] Atrapy i test klienta (czerwony) (S)
- [ ] Warunek `!pendingAuth` w `subscribe()` (S)
- [ ] Test charakteryzujący serwera (S)
- [ ] CHANGELOG (S)

---

### Z-02 – Wymóg uwierzytelnienia dla tras administracyjnych bloczków

| Pole | Wartość |
|---|---|
| Etap / typ | 1 / funkcja (bezpieczeństwo) |
| Priorytet / ryzyko | P1 / wysokie (wpływ na moduły zewnętrzne) |
| Ustawienie | `httpAdminNodeRoutes: "open" \| "authenticated"` (zlecenie: bez zmian), domyślnie `"open"`; API węzłów `RED.auth.publicRoute()` (zlecenie: `RED.auth.public()`) |
| Zależności | brak |
| Pliki | `@node-red/registry/lib/util.js:65-125` (`createNodeApi`: `httpAdmin: runtime.adminApp` `:102`, `red.auth` `:114-122`); `@node-red/runtime/lib/index.js:40-52` (atrapa `adminApi` przy `httpAdminRoot:false`), `:95`; `node-red/lib/red.js:77` (montowanie); `@node-red/editor-api/lib/index.js:132-134` (`auth: {needsPermission}`); `@node-red/editor-api/lib/auth/index.js:59-78` (`needsPermission`); `@node-red/nodes/core/common/21-debug.js:286,310`; `node-red/settings.js` (sekcja Security) |
| Powiązania | K8S-T-002/K8S-T-005 (workery z `disableEditor` nadal wystawiają Admin API i trasy węzłów) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE**.
- Węzły i wtyczki dostają `httpAdmin: runtime.adminApp` (`registry/lib/util.js:102`; `createNodeApi` używane dla węzłów i wtyczek – `loader.js:416,448`); `adminApp` to zwykła aplikacja express (`runtime/lib/index.js:95`) montowana w aplikacji Admin API (`node-red/lib/red.js:77` – `api.httpAdmin.use(runtime.httpAdmin)`).
- `RED.auth` = `{needsPermission}` (`editor-api/lib/index.js:132-134`); `needsPermission(p)` przy `adminAuth` uwierzytelnia (`bearer`, `tokens`, `anon`) i sprawdza uprawnienie, bez `adminAuth` – przepuszcza (`auth/index.js:59-78`); `hasPermission(scope, "")` zawsze `true` (`auth/permissions.js:23-25`) → `needsPermission("")` = „dowolny uwierzytelniony (lub anonimowy z `adminAuth.default`)”.
- Brak globalnego uwierzytelnienia tras węzłów; jedyne opcje globalne: `httpAdminMiddleware` (`editor-api/lib/index.js:50-54`), przestarzały `httpAdminAuth`.
- Core: z uprawnieniem `20-inject.js:179`, `21-debug.js:250,270`, `32-udp.js:137`; **publiczne celowo** `21-debug.js:286` (`/debug/view/view.html`) i `:310` (`/debug/view/*`) – komentarz w kodzie: plik ładowany przez `<script>`, więc nie dostaje nagłówka uwierzytelnienia.
- `disableEditor: true` nie wyłącza Admin API (`editor-api/lib/index.js:83-95`); wyłącza je `httpAdminRoot: false` – wtedy węzły dostają atrapę `stubbedExpressApp` (`get/post/put/delete`) i `needsPermission` no-op (`runtime/lib/index.js:40-52`).

#### Specyfikacja
- **Cel:** w trybie `"authenticated"` trasa administracyjna dodana przez bloczek/wtyczkę bez jawnego uprawnienia wymaga uwierzytelnionej sesji; publiczność trasy jest jawną decyzją autora (`RED.auth.publicRoute()`), widoczną w logu.
- **Wejścia:** rejestracje tras przez `RED.httpAdmin.<metoda>(path, ...handlers)`, `.all`, `.use`, `.route(path).<metoda>`; ustawienia `httpAdminNodeRoutes`, `adminAuth`.
- **Wyjścia (tryb `"authenticated"` + `adminAuth`):**
  - trasa bez znacznika → przed handlerami wstawiane `needsPermission("")`: bez sesji 401, z sesją 200;
  - trasa z `RED.auth.needsPermission(p)` → bez zmian;
  - trasa z `RED.auth.publicRoute()` → bez uwierzytelnienia; przy rejestracji wpis `info` w logu: moduł, metoda, ścieżka.
- **Niezmienniki:** tryb `"open"` – `RED.httpAdmin` to ten sam obiekt co dziś, `publicRoute()` zwraca przepuszczające middleware, brak nowych logów; trasy wbudowane edytora i Admin API bez zmian (nie przechodzą przez `runtime.adminApp`); bez `adminAuth` – bez zmian w obu trybach (+ jedno ostrzeżenie przy starcie, że `"authenticated"` nie działa bez `adminAuth`); przy `httpAdminRoot:false` – atrapa ma `publicRoute`, brak błędów ładowania węzłów.
- **Przypadki błędów:** nieznana wartość ustawienia → ostrzeżenie i `"open"` (propozycja; alternatywa bezpieczniejsza – `"authenticated"`, pytanie); węzeł wołający `publicRoute` na starszej wersji → `TypeError` (dokumentacja zaleca `RED.auth.publicRoute ? RED.auth.publicRoute() : (q,s,n)=>n()`).
- **Skutki uboczne:** moduły zewnętrzne z publicznymi trasami (np. pliki ładowane przez `<script>`/`<img>` w edytorze) przestaną działać w trybie `"authenticated"` do czasu dodania `publicRoute()` – lista ostrzeżeń w logu pomaga je znaleźć (401 + audyt `permission.fail`).

#### Projekt rozwiązania (minimalny)
1. **Znaczniki tras:** `Symbol.for("node-red.adminRouteAuth")` ustawiany na funkcji zwracanej przez `needsPermission(p)` (wartość `"permission"`) i `publicRoute()` (wartość `"public"`) – `editor-api/lib/auth/index.js`; globalny rejestr symboli, bez zależności registry → editor-api.
2. `editor-api/lib/auth/index.js`: `publicRoute()` (JSDoc); eksport w `editor-api/lib/index.js:132-134` (`auth: {needsPermission, publicRoute}`); atrapa `adminApi.auth` w `runtime/lib/index.js:46-52` i fallback `registry/lib/util.js:119-121` – także `publicRoute`.
3. `registry/lib/util.js`: nowa funkcja `guardAdminApp(app, auth, owner, log)` używana w `createNodeApi` **tylko** gdy `runtime.settings.httpAdminNodeRoutes === "authenticated"`: obiekt `Object.create(app)` z nadpisanymi metodami HTTP (`http.METHODS` małymi literami), `all`, `use`, `route` (opakowanie zwróconej trasy); każda metoda spłaszcza handlery, szuka znacznika; brak znacznika → `[auth.needsPermission(""), ...handlers]`; `"public"` → log `info` (klucz w `runtime/locales/en-US/runtime.json`, np. `server.public-admin-route` – do potwierdzenia przestrzeni nazw); `app.get(name)` z jednym argumentem (odczyt ustawienia express) przekazywane bez zmian.
4. Core `21-debug.js:286,310`: dodanie `RED.auth.publicRoute()` jako pierwszego handlera (zachowanie bez zmian w obu trybach).
5. Ostrzeżenie przy starcie, gdy `"authenticated"` bez `adminAuth`.
6. `settings.js` (Security): zakomentowane `// httpAdminNodeRoutes: "authenticated"` z opisem i uwagą, że `disableEditor` nie wyłącza Admin API (workery: `httpAdminRoot:false` albo `adminAuth` + `"authenticated"`); CHANGELOG; dokumentacja dla autorów węzłów (JSDoc `publicRoute`).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Uwierzytelnienie tras administracyjnych bloczków

  Tło:
    Zakładając włączone adminAuth z użytkownikiem "admin"
    I bloczek rejestrujący trasę GET /z02/open bez uprawnienia
    I bloczek rejestrujący trasę GET /z02/perm z RED.auth.needsPermission("z02.read")
    I bloczek rejestrujący trasę GET /z02/public z RED.auth.publicRoute()

  Scenariusz: [odbiór] Trasa bez uprawnienia wymaga sesji
    Zakładając ustawienie httpAdminNodeRoutes = "authenticated"
    Kiedy wyślę GET /z02/open bez tokenu
    Wtedy otrzymam 401
    Kiedy wyślę GET /z02/open z ważnym tokenem
    Wtedy otrzymam 200

  Scenariusz: [odbiór] Trasa z needsPermission jak dotąd
    Zakładając ustawienie httpAdminNodeRoutes = "authenticated"
    Kiedy wyślę GET /z02/perm z tokenem użytkownika bez uprawnienia z02.read
    Wtedy otrzymam 401
    Kiedy wyślę GET /z02/perm z tokenem użytkownika z uprawnieniem z02.read
    Wtedy otrzymam 200

  Scenariusz: [odbiór] Trasa publiczna dostępna bez sesji i zalogowana przy starcie
    Zakładając ustawienie httpAdminNodeRoutes = "authenticated"
    Kiedy runtime się uruchomi
    Wtedy log zawiera wpis o publicznej trasie GET /z02/public z nazwą modułu
    Kiedy wyślę GET /z02/public bez tokenu
    Wtedy otrzymam 200

  Scenariusz: [odbiór] Tryb domyślny bez zmian
    Zakładając brak ustawienia httpAdminNodeRoutes
    Kiedy wyślę GET /z02/open bez tokenu
    Wtedy otrzymam 200
    I RED.httpAdmin jest tym samym obiektem co runtime.adminApp

  Scenariusz: Trasy wbudowane edytora bez zmian
    Zakładając ustawienie httpAdminNodeRoutes = "authenticated"
    Wtedy GET /auth/login bez tokenu zwraca 200
    I GET /flows bez tokenu zwraca 401 jak w 5.0.7

  Scenariusz: Widoki debug pozostają publiczne
    Zakładając ustawienie httpAdminNodeRoutes = "authenticated"
    Kiedy wyślę GET /debug/view/view.html bez tokenu
    Wtedy otrzymam 200

  Scenariusz: Brak adminAuth
    Zakładając brak adminAuth i ustawienie httpAdminNodeRoutes = "authenticated"
    Kiedy runtime się uruchomi
    Wtedy w logu pojawi się ostrzeżenie o braku efektu ustawienia
    I GET /z02/open bez tokenu zwraca 200

  Scenariusz: Admin API wyłączone
    Zakładając httpAdminRoot = false
    Kiedy runtime załaduje węzeł debug
    Wtedy ładowanie kończy się bez błędu

  Szablon scenariusza: Wszystkie sposoby rejestracji są chronione
    Zakładając ustawienie httpAdminNodeRoutes = "authenticated"
    Kiedy bloczek zarejestruje trasę przez "<sposób>" bez uprawnienia
    Wtedy zapytanie bez tokenu zwraca 401
    Przykłady:
      | sposób                 |
      | RED.httpAdmin.post     |
      | RED.httpAdmin.all      |
      | RED.httpAdmin.use      |
      | RED.httpAdmin.route().get |
```

#### Testy
- Jednostkowe `test/unit/@node-red/registry/lib/util_spec.js`, `describe("createNodeApi httpAdmin guard")`: `returns runtime.adminApp unchanged when open`, `prepends authentication to routes without marker`, `keeps routes with needsPermission unchanged`, `does not guard publicRoute and logs it`, `guards all/use/route`, `passes app.get(setting) through`.
- Jednostkowe `test/unit/@node-red/editor-api/lib/auth/index_spec.js`: `publicRoute returns marked pass-through middleware`, `needsPermission middleware is marked`.
- Integracyjne (supertest) `test/unit/@node-red/editor-api/lib/index_spec.js` lub nowy `test/unit/node-red/lib/admin-node-routes_spec.js` (do potwierdzenia lokalizacji – potrzebne złożenie editor-api + runtime adminApp + atrapy użytkowników/tokenów jak w `comms_spec.js`): przypadki z Gherkin (401/200, needsPermission, public, tryb domyślny, brak `adminAuth`, `/auth/login`).
- Węzły `test/nodes/core/common/21-debug_spec.js` (istniejący przypadek `GET /debug/view/view.html` `:679`): `debug view routes are public in authenticated mode`.
- `test/unit/@node-red/runtime/lib/index_spec.js`: `stubbed adminApi.auth provides publicRoute`.

#### DoD specyficzne
- [ ] Przegląd bezpieczeństwa: wszystkie metody rejestracji objęte; brak obejścia przez `use` bez ścieżki; testy obu trybów i bez `adminAuth`.
- [ ] Core: wszystkie trasy `RED.httpAdmin` w `@node-red/nodes` mają `needsPermission` albo `publicRoute` (weryfikacja `grep` w raporcie).
- [ ] Dokumentacja dla autorów węzłów (JSDoc + CHANGELOG) z wzorcem zgodności wstecz.
- [ ] Teksty logów w `runtime/locales/en-US/runtime.json`.

#### Ryzyka i alternatywy
- **Moduły zewnętrzne** z publicznymi trasami (zasoby ładowane bez nagłówka) przestaną działać w `"authenticated"` – mitigacja: log 401/audyt, dokumentacja; decyzja Zamawiającego o liście dopuszczonych modułów (pytanie).
- Opakowanie aplikacji express (`Object.create`) może nie objąć rzadkich API (`app.param`, `app.engine`, podaplikacje montowane przez `use(subApp)` – te ostatnie objęte jak `use`); do potwierdzenia testami.
- Alternatywa B: jedno middleware przed `runtime.httpAdmin` w `node-red/lib/red.js:77` z listą tras publicznych rejestrowanych osobnym wywołaniem `publicRoute(method, path)` – prostsze i obejmuje wszystko, ale bez przypisania trasy do modułu w logu i z ryzykiem rozjazdu wzorców ścieżek; do rozważenia przy przeglądzie.
- Użytkownik anonimowy (`adminAuth.default`) spełnia `needsPermission("")` → trasa bez uprawnienia dostępna anonimowo, gdy anonimowy dostęp jest włączony. Pytanie: czy „uwierzytelniona sesja” ma wykluczać anonimowego.
- Workery (K8S-T-005): `disableEditor` nie chroni Admin API ani tras węzłów – w chart należy wymusić `httpAdminRoot:false` albo `adminAuth` + `"authenticated"`.
- Nieznana wartość ustawienia → `"open"` (zgodność) vs `"authenticated"` (bezpieczeństwo) – pytanie.

#### Podzadania
- [ ] Znaczniki + `publicRoute` w editor-api, atrapy w runtime/registry (S)
- [ ] `guardAdminApp` w `registry/lib/util.js` + testy jednostkowe (M)
- [ ] Test integracyjny supertest (M)
- [ ] `21-debug.js` – `publicRoute` + test (S)
- [ ] Ostrzeżenia startowe, teksty logów (S)
- [ ] `settings.js`, JSDoc, CHANGELOG, notatka dla autorów węzłów (S)

---

## Pytania do Zamawiającego (etap 1)

1. **Nazwy ustawień:** czy akceptują Państwo rekomendacje `deploy.response` (zamiast `flows.deployResponse`) i `editorTheme.deploy.staleFlows` (zamiast `editor.staleFlowsPolicy`) oraz `RED.auth.publicRoute()` (zamiast `RED.auth.public()`)? (ZASADY §2.1)
2. **E-01 / P-01 – błędy zatrzymania:** propozycja rozstrzygnięta w ZASADY §2.3 krok 6 i D-05 – w trybie domyślnym jak 5.0.6 (połykane), w `deploy.response: "started"` → 500 `deploy_stop_failed` z `rev`. Prosimy o zatwierdzenie (albo decyzję o naprawie także w trybie domyślnym).
3. **P-01 – kod HTTP przy błędzie startu:** konfiguracja jest już zapisana. Proponujemy 500 z `{code:"deploy_start_failed", rev, errors}`. Akceptacja, czy wolą Państwo inny kod (np. 200 z polem `errors` albo 207)?
4. **P-01 – zakres „błędu startu”:** czy wystarczą brakujące typy/moduły i wyjątki startu flow, czy także błędy konstruktorów pojedynczych węzłów (dziś tylko log; wymaga zmian w `Flow.js`)?
5. **P-01 – limit czasu:** czy w trybie `"started"` potrzebny jest limit czasu oczekiwania na start (np. dla proxy/Ingress), czy przenieść to do Z-08?
6. **P-02 – egzekwowanie po stronie serwera:** czy `reload-only` ma implikować wymóg `rev` (Z-05), czy pozostaje ochroną tylko edytora? Czy w oknie zostawić podgląd różnic tylko do odczytu lub eksport lokalnych zmian przed przeładowaniem?
7. **P-03 – zmienna `NODE_RED_DISABLE_TELEMETRY`:** czy ma implikować `locked: true` (zmiana względem 5.0.6)? Czy dopuszczalne jest `locked: true` z `enabled: true` (wymuszenie telemetrii)?
8. **P-04 – zgłoszenie:** czy zgłaszamy problem prywatnie zespołowi projektu wg `SECURITY.md` (nasza rekomendacja) i wstrzymujemy publikację gałęzi do czasu odpowiedzi? Prosimy o diff obecnej modyfikacji (do przeglądu). Czy przy wyłączonym `adminAuth` serwer ma odpowiadać na pakiet `auth` `{"auth":"ok"}` (rekomendacja) czy go ignorować?
9. **P-04 – kontrola `Origin` dla `/comms`:** brak weryfikacji pochodzenia połączenia websocket (wniosek z kodu). Czy dodać osobny pakiet poprawki?
10. **Z-01 – testy klienta:** czy akceptują Państwo eksport CommonJS w `editor-client/src/js/comms.js` (wzorzec z `ui/search.js`) na potrzeby testu jednostkowego, czy wolą E2E (Playwright – nie jest zależnością projektu)?
11. **Z-02 – użytkownik anonimowy:** czy przy `adminAuth.default` (dostęp anonimowy) trasa bez uprawnienia ma być dostępna anonimowo (zachowanie `needsPermission("")`), czy wymagać zalogowanego użytkownika?
12. **Z-02 – nieznana wartość ustawienia:** zachować `"open"` (zgodność) czy przyjąć `"authenticated"` (bezpieczeństwo)? Czy znane są moduły zewnętrzne z publicznymi trasami, które muszą działać w trybie `"authenticated"`?
13. **Wersja bazowa:** potwierdzenie bazy 5.0.7 (ZASADY §2.2).
14. **E-01 – serializacja `setState` i przełączenia projektu:** czy zgadzają się Państwo, by `POST /flows/state` (start/stop flow) i przełączenie projektu korzystały ze wspólnej blokady wdrożeń (czekają na trwające wdrożenie; dziś działają bez blokady)? Rekomendacja: tak, bez hooków `preDeploy`/`postDeploy` dla tych ścieżek.
15. **E-01 – jawny `reload` przez API:** czy akceptują Państwo odczyt magazynu pod blokadą **przed** hookiem `preDeploy` (hook widzi treść, która zostanie uruchomiona; doprecyzowanie kroku 5 ZASADY §2.3 A dla typu `reload`)? Alternatywa: `preDeploy` dla `reload` z `flows: null`.

## Zmiany po przeglądzie

Poprawki z [../PRZEGLAD.md](../PRZEGLAD.md) („Lista poprawek do naniesienia”), zgodnie z zaktualizowanymi ZASADY §2.1/§2.3/§2.4 i ANALIZA §4.9, §6.2, §7:

- **#1** – P-01: moment odpowiedzi w trybie `started` = po kroku 9 ZASADY §2.3 A (po `runtime-deploy`); `postDeploy` asynchronicznie po odpowiedzi (Wyjścia, Skutki, Projekt pkt 2, nowy scenariusz i test); test `emits runtime-deploy before resolving when waitForStart` zgodny.
- **#4** – P-02: zależność od Z-05 oznaczona jako **miękka** (tabela podsumowania, karta, Ryzyka z odwołaniem do D-12); integracja edytora Z-05 po scaleniu P-02.
- **#7** – E-01: zakres rozszerzony o wspólny mutex (`flows/lock.js`), wydzielenie `build*FlowConfig` (wspólne z Z-04), jedną wewnętrzną funkcję potoku `deploy(opts)` (rekomendacja, zastępuje „odrzuconą” alternatywę), jeden mechanizm `readFlowsFromStorage` + `deploy({type:"reload", loaded})` (Z-06/Z-09), ścieżki `setState` i przełączenia projektu; zaktualizowane Pliki, Specyfikacja, Projekt, BDD, Testy, DoD, Ryzyka, Podzadania; szacunek M → L; nowe Pytania 14–15 („do decyzji”).
- **#8** – E-01/P-01: polityka błędów zatrzymania wg D-05 i ZASADY §2.3 krok 6 (domyślnie jak 5.0.6; `started` → 500 `deploy_stop_failed` z `rev`); scenariusze i testy obu trybów; Pytanie 2 przeformułowane na zatwierdzenie. Odwołań do „E-01b” w pliku nie było.
- **#22** – P-02 właścicielem poprawki `deploy.js:390` (`nns`): Weryfikacja, Pliki, Projekt pkt 6, scenariusz BDD, testy, DoD, podzadanie.
- **#30** – P-03: scenariusz warunkowy dla `NODE_RED_DISABLE_TELEMETRY` (po decyzji – Pytanie 7) i odpowiadający test.
- **#32** – P-04: scenariusz „Pakiet auth przy wyłączonym adminAuth” oznaczony `[odbiór]` (uzupełnienie kryterium zlecenia).
- **Kody błędów (ZASADY §2.4):** `missing-types`/`missing-modules`/`flow-start-failed` → `missing_types`/`missing_modules`/`flow_start_failed` (E-01, P-01); statusy `deploy_start_failed`/`deploy_stop_failed` = 500 wg §2.4.
- **Kolejność (ANALIZA §6.2):** „Kolejność realizacji” etapu 1 dostosowana do dwóch torów (E-01 w etapie 0; tor A: P-04 → P-01; tor B: Z-01 → P-03 → Z-02 → P-02).
