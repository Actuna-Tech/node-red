# Backlog – etap 3 (E-02, Z-08–Z-11)

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.
> Zasady, szablon karty i wspólne DoD: [../ZASADY.md](../ZASADY.md). Fakty z kodu: [../WERYFIKACJA.md](../WERYFIKACJA.md).
> Ścieżki kodu względem `packages/node_modules/`, ścieżki testów względem katalogu repozytorium. Baza: 5.0.7 (ZASADY §2.2).
> Oznaczenie „do potwierdzenia” = nie sprawdzono w kodzie albo wymaga decyzji Zamawiającego.
> Kontekst wdrożenia: [../../k8s-postgres/ARCHITEKTURA.md](../../k8s-postgres/ARCHITEKTURA.md) §0.1, §3.5 (rozmowy voicebota ~3–4 min, czatbota ~15 min, bez twardych limitów → drenaż 20 min; on-premise; edytor + workery; PostgreSQL + Redis).
> Implementacje wtyczek klastrowych (magazyn z `watchFlows` na PostgreSQL LISTEN/NOTIFY lub Redis, koordynacja na blokadzie doradczej PostgreSQL lub Redis) są **poza zakresem zlecenia** – w zlecenie wchodzą punkty rozszerzeń w rdzeniu i domyślna wtyczka lokalna.

## Podsumowanie

| ID | Tytuł | Typ | Priorytet | Ryzyko | Zależności | Szacunek |
|---|---|---|---|---|---|---|
| [E-02](#e-02--model-stanu-instancji) | Model stanu instancji | przerobienie (nowy moduł wewnętrzny, bez zmiany zachowania) | P1 | średnie | E-01 (wynik `start()` z błędami, krok 4/8 potoku); warunek Z-08, Z-09, P-01 | M |
| [Z-08](#z-08--sondy-zdrowia-live--ready) | Sondy zdrowia `/live` i `/ready` | funkcja + poprawka błędu (D-05: serwer HTTP przy SIGTERM) | P1 | średnie | E-02, E-01 | M |
| [Z-09](#z-09--przeładowanie-flow-po-zmianie-w-magazynie) | Przeładowanie flow po zmianie w magazynie (`watchFlows`, `preReload`) | funkcja | P1 | wysokie | E-01, E-02, Z-08, Z-06 (rozszerzenie `VALID_HOOKS`, wzorzec limitu czasu hooka), P-01 (błędy startu) | L |
| [Z-10](#z-10--wykonanie-na-jednej-instancji-koordynacja) | Wykonanie na jednej instancji (koordynacja) | funkcja (nowe publiczne API) | P2 | wysokie | E-02 (stan `stopping` – oddanie przywództwa) | L |
| [Z-11](#z-11--praca-z-katalogiem-użytkownika-tylko-do-odczytu) | Praca z katalogiem użytkownika tylko do odczytu | funkcja | P2 | średnie | – | M |

Kolejność realizacji (ANALIZA §6.2): E-02 (etap 0, specyfikacja + testy; implementacja razem z Z-08) → para **Z-08 + Z-11** (rozłączne pliki) → para **Z-09 + Z-10** (Z-09 po Z-08 i Z-06). Z-10 i Z-09 mają wspólny punkt w `runtime/lib/index.js` (kolejność startu) – scalać w ustalonej kolejności (najpierw Z-10).

---

### E-02 – Model stanu instancji

| Pole | Wartość |
|---|---|
| Etap / typ | 0→3 / przerobienie (specyfikacja w etapie 0, implementacja w gałęzi Z-08) |
| Priorytet / ryzyko | P1 / średnie |
| Ustawienie | brak (moduł wewnętrzny, zawsze aktywny, pasywny – nie zmienia zachowania) |
| Zależności | E-01 (`start()` zwraca `{errors}`, kroki 4 i 8 potoku); warunek Z-08, Z-09; wykorzystywany przez P-01 (opcjonalnie) i Z-10 (`stopping`) |
| Pliki | nowy `@node-red/runtime/lib/state.js`; `@node-red/runtime/lib/index.js:135-248` (`start`), `:240-247` (start flow, pusty `.catch`), `:316-328` (`stop`), obiekt `runtime` (`:331+`); `@node-red/runtime/lib/flows/index.js:57-66` (`type-registered` → późny start), `:118-242` (`setFlows`), `:272-432` (`start`), `:434-515` (`stop`), `:873` (`state()`); `@node-red/runtime/lib/api/flows.js:66-100` (mutex, `reload`), `:283-330` (`setState`) |
| Powiązania | K8S-T-005 (sondy), ARCHITEKTURA §3.5 (drenaż 20 min) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE** (brak jednego, wiarygodnego stanu instancji).
- Istnieje tylko stan flow: zmienna `state` w `flows/index.js` (`'start' | 'stop' | 'safe'`, ustawiana w `start()` `:279,:324,:336` i `stop()` `:458`), odczyt `flows.state()` (`:873`) i flaga `started` (`:872`); używa ich API `getState/setState` (`api/flows.js:267-330`).
- `RED.start()` kończy się **przed** startem flow: `runtime/lib/index.js:240-243` ustawia `started = true`, wywołuje `loadFlows().then(startFlows)` **bez** `await`; błąd odczytu flow jest połykany (`.catch(function(err) {})`, `:247`) – instancja „wisi” bez sygnału błędu. Serwer HTTP zaczyna nasłuch w `node-red/red.js:505` po `RED.start()`, czyli również przed startem flow.
- Zdarzenia istniejące: `flows:starting` (`flows/index.js:349`), `flows:started` (`:414`, emitowane także wtedy, gdy `Flow.start` rzucił wyjątek – tylko `console.log`, `:409-411`), `flows:stopping` (`:467`), `flows:stopped` (`:508`), `runtime-event` `runtime-state` (`:64,:82,:90,:94,:301,:315,:325,:335,:421,:510`), `runtime-deploy` (`:229,:238`).
- Nieudany start (brakujące typy `:301`, brakujące moduły `:315`, safe mode `:325`) kończy `start()` bez błędu – tylko zdarzenie i `return`. Brakujące typy mogą zostać doinstalowane później: `type-registered` → `start()` (`:57-66`) – stan „nieudany” nie jest więc końcowy.
- `runtimeFlowState === 'stop'` (flow zatrzymane świadomie, `:333-340`) – `start()` kończy się bez startu flow.
- Zatrzymanie: `runtime.stop()` (`runtime/lib/index.js:316-328`) → `stopFlows()` → `closeContextsPlugin()`; brak flagi „zatrzymywanie” widocznej dla innych modułów (`started=false` dopiero w `stop()`).
- `setState` (start/stop flow przez API) **nie** jest objęty mutexem API (`api/flows.js:283`, brak `runExclusive`) – do uwzględnienia w modelu.

#### Specyfikacja
- **Cel:** jeden moduł z autorytatywnym stanem instancji (cykl życia procesu + stan flow), z którego korzystają sondy (Z-08), przeładowanie (Z-09), koordynacja (Z-10) i opcjonalnie P-01 – zamiast logiki rozproszonej po pakietach.
- **Stany (`InstanceState`):**

| Stan | Znaczenie | `/ready` (Z-08) | `/live` (Z-08) |
|---|---|---|---|
| `starting` | od `runtime.start()` do zakończenia pierwszego startu flow | 503 | 200 |
| `ready` | flow uruchomione, ostatnia operacja bez błędów | **200** | 200 |
| `deploying` | wdrożenie (E-01 krok 4 → krok 8) | 503 | 200 |
| `reloading` | przeładowanie z magazynu (Z-09), od decyzji o przeładowaniu (przed `preReload`) do końca startu | 503 | 200 |
| `idle` | flow świadomie nieuruchomione: `runtimeFlowState: stop` (API `setState`) lub safe mode | 503 (propozycja – pytanie) | 200 |
| `failed` | start flow nieudany: brakujące typy/moduły, błąd odczytu flow z magazynu, błąd startu z `start().errors` | 503 | 200 |
| `stopping` | od wywołania `runtime.stop()` (SIGTERM/SIGINT/SIGHUP/… lub osadzenie) – **nieodwracalny** | 503 | 200 |
| `stopped` | po zakończeniu `runtime.stop()` – końcowy | 503 | 200 (proces jeszcze żyje) |

- **Diagram stanów:**

```
                 runtime.start()
                       │
                       ▼
                 ┌──────────┐ start bez błędów  ┌─────────┐
                 │ starting │──────────────────▶│  ready  │◀──────────────┐
                 └──────────┘                   └─────────┘               │
                   │      │ runtimeFlowState=stop │  │  │  setState stop  │
     błąd startu / │      │ lub safe mode         │  │  └──────────▶ ┌────────┐
     brak typów /  │      └──────────────────────────┼─────────────▶ │  idle  │
     błąd odczytu  ▼                              │  │  setState     └────────┘
                 ┌──────────┐◀── błąd startu ─────┤  │  start ok ────────▲ │
                 │  failed  │                     │  │                   │ │
                 └──────────┘── type-registered ──┼─▶│ (ready)           │ │
                   │    │      + start ok         │  │                   │ │
         wdrożenie │    │ powiadomienie           ▼  ▼                   │ │
                   │    │ magazynu        ┌───────────┐ ┌───────────┐    │ │
                   └────┼────────────────▶│ deploying │ │ reloading │◀───┼─┘
                        └────────────────▶└───────────┘ └───────────┘    │
                                            │  koniec: ready | failed | idle
                                            └────────────────────────────┘

   każdy stan oprócz stopping/stopped ── runtime.stop() ──▶ ┌──────────┐ ──▶ ┌─────────┐
                                                            │ stopping │     │ stopped │
                                                            └──────────┘     └─────────┘
```

- **Tabela przejść:**

| # | Z | Do | Zdarzenie źródłowe | Źródło w kodzie (istniejące / nowe) |
|---|---|---|---|---|
| T1 | – (init) | `starting` | wywołanie `runtime.start()` | nowe: `state.markStarting()` na początku `runtime/lib/index.js` `start()` |
| T2 | `starting` | `ready` | pierwszy `start()` flow zakończony, `errors=[]` | istniejące `flows:started` (`flows/index.js:414`) + nowe: wynik `start()` (E-01) |
| T3 | `starting` | `failed` | `start().errors` niepuste (missing-types, missing-modules, flow-start-failed); odrzucenie `loadFlows()`; odrzucenie `runtime.start()` (np. błąd `storage.init`) | istniejące `runtime-state` (`:301,:315`); nowe: obsługa w `runtime/lib/index.js:247` zamiast pustego `.catch` (log bez zmian + `state.fail(err)`) |
| T4 | `starting` | `idle` | `runtimeFlowState === 'stop'` lub safe mode | istniejące `runtime-state` `{state:'stop'}` (`:335`), `{state:'safe'}` (`:325`); nowe: jawne wywołanie modułu stanu w tych gałęziach |
| T5 | `ready` / `failed` / `idle` | `deploying` | E-01 krok 4 (wszystkie wejścia potoku: `/flows` full/nodes/flows, `/flow`, `/flow/:id`, `reload` z Admin API, wywołania wewnętrzne z `deployOpts`) | nowe: `state.begin("deploy")` w potoku E-01 (wewnątrz mutexu) |
| T6 | `deploying` | `ready` / `failed` / `idle` | E-01 krok 8: koniec startu (`errors=[]` → `ready`; błędy → `failed`; flow nie były uruchomione, bo `started=false` → `idle`) | nowe: `state.end(token, result)` |
| T7 | `ready` / `failed` / `idle` | `reloading` | decyzja o przeładowaniu z magazynu (Z-09) | nowe: `state.begin("reload")` |
| T8 | `reloading` | `ready` / `failed` / `idle` | koniec przeładowania (jak T6); błąd odczytu magazynu → powrót do stanu sprzed T7 (flow nie były zatrzymane) | nowe: `state.end(token, result)` |
| T9 | `failed` | `ready` | późny start po zarejestrowaniu brakującego typu (`type-registered` → `start()`, `flows/index.js:57-66`) bez błędów | istniejące `flows:started` + nowe: wynik `start()` |
| T10 | `idle` | `ready` | `setState start` (`api/flows.js:309-320`) zakończony bez błędów | istniejące `flows:started`; nowe: `state.begin("set-state")`/`end` w `setState` |
| T11 | `ready` / `failed` | `idle` | `setState stop` (`api/flows.js:322-329`) | istniejące `flows:stopped`; nowe: jw. |
| T12 | dowolny poza `stopping`/`stopped` | `stopping` | wywołanie `runtime.stop()` (CLI: SIGINT, SIGTERM, SIGHUP, SIGUSR2, SIGBREAK, PM2 `shutdown` – `node-red/red.js:543-558`) | nowe: `state.markStopping(reason)` jako **pierwsza, synchroniczna** instrukcja `runtime/lib/index.js` `stop()` |
| T13 | `stopping` | `stopped` | `stopFlows()` + `closeContextsPlugin()` zakończone (sukces lub błąd) | nowe: `state.markStopped(err?)` |

- **Wejścia:** wywołania API wewnętrznego (niżej) z `runtime/lib/index.js`, potoku E-01, `api/flows.js` (`setState`), Z-09; zdarzenia `flows:*` służą tylko do weryfikacji (testy charakteryzujące), stan ustawiają jawne wywołania – zdarzenia `flows:*` są emitowane także w trakcie wdrożenia i nie mogą same zmieniać stanu.
- **Wyjścia – API wewnętrzne (`runtime/lib/state.js`, dostępne jako `runtime.state`):**

```js
/**
 * @typedef {"starting"|"ready"|"deploying"|"reloading"|"idle"|"failed"|"stopping"|"stopped"} InstanceState
 * @typedef {Object} StateInfo
 * @property {InstanceState} state
 * @property {InstanceState|null} previous
 * @property {string} reason      - np. "startup", "deploy", "reload", "set-state", "missing-types",
 *                                  "missing-modules", "flow-start-failed", "storage-error", "safe-mode", "SIGTERM"
 * @property {number} since       - Date.now() wejścia w stan
 * @property {Array<{code:string,message:string}>} [errors] - tylko w "failed"
 */
/** @returns {StateInfo} kopia bieżącego stanu (bez I/O, O(1)) */
function get() {}
/** @returns {boolean} true tylko w stanie "ready" */
function isReady() {}
/** @param {(info: StateInfo) => void} listener @returns {() => void} funkcja wyrejestrowania */
function onChange(listener) {}

// --- tylko dla runtime (nie eksportowane do RED.* węzłów) ---
/** @param {"deploy"|"reload"|"set-state"} operation @param {object} [info] @returns {symbol} token operacji */
function begin(operation, info) {}
/** @param {symbol} token @param {{errors?: Array, flowsRunning: boolean, aborted?: boolean}} result */
function end(token, result) {}
function markStarting() {}
/** @param {string} reason */
function markStopping(reason) {}
/** @param {Error} [err] */
function markStopped(err) {}
/** @param {Error|Array} errors */
function fail(errors) {}
/** tylko testy */
function reset() {}
```
  Każde przejście emituje także zdarzenie `instance:state` na `@node-red/util` `events` (payload = `StateInfo`) – dostępne dla wtyczek przez `RED.events`. Nazwa zdarzenia celowo różna od istniejącego `runtime-event`/`runtime-state` (stan flow dla edytora) – **do potwierdzenia** (D-02).
- **Niezmienniki:**
  1. `ready` wyłącznie po zakończeniu startu flow ostatniej operacji (start, wdrożenie, przeładowanie, `setState start`, późny start) z pustą listą błędów – samo `flows:started` nie wystarcza (emitowane także po wyjątku `Flow.start`).
  2. `stopping` i `stopped` są nieodwracalne: z `stopping` jedynym przejściem jest `stopped`; wywołania `begin/end/fail` w tych stanach są ignorowane (log `debug`) – zdarzenia z zamykanych flow nie przywracają `ready`.
  3. Najwyżej jedna operacja (`deploy` / `reload` / `set-state`) naraz; `begin` przy aktywnej operacji rzuca błąd programisty (`state_operation_in_progress`) – gwarancję daje wspólny mutex E-01 (`setState` zostaje objęty mutexem – zob. Ryzyka).
  4. `deploying`/`reloading` ustawiane **przed** zatrzymaniem pierwszego węzła (E-01 krok 4 przed 6), `ready` dopiero **po** starcie ostatniego (krok 8).
  5. `end(token)` z nieaktualnym tokenem (np. po `stopping`) nie zmienia stanu.
  6. Brak zdarzenia, gdy stan i powód się nie zmieniają; kolejność zdarzeń = kolejność przejść.
  7. Moduł jest pasywny: przy domyślnych ustawieniach nie zmienia żadnych odpowiedzi, logów, kolejności zdarzeń ani czasu wdrożenia (zgodność wstecz; konsumenci – Z-08, Z-09 – są wyłączeni domyślnie).
- **Przypadki błędów:** wyjątek w słuchaczu `onChange` → `log.warn`, pozostali słuchacze wywołani, stan zmieniony; `end` bez `begin` → ignorowane + `log.debug`; odrzucenie `runtime.start()` → `failed` (reason `startup-error`), odrzucenie promise bez zmian (zgodność).
- **Skutki uboczne:** zamiana pustego `.catch` w `runtime/lib/index.js:247` na obsługę ustawiającą `failed` (log jak w `flows/index.js:96-99` już wypisany wcześniej – bez nowych komunikatów); `setState` w mutexie (zmiana kolejkowania – zob. Ryzyka).

#### Projekt rozwiązania (minimalny)
1. Testy charakteryzujące (najpierw): kolejność `flows:*` i `runtime-state` dla startu, startu z brakującymi typami, safe mode, `runtimeFlowState: stop`, późnego startu po `type-registered`, `setState start/stop`, `runtime.stop()`.
2. `runtime/lib/state.js` – maszyna stanów z tabelą dozwolonych przejść (obiekt `{from: [to...]}`), `events.emit("instance:state", info)`; bez zależności poza `@node-red/util`.
3. `runtime/lib/index.js`: `markStarting()` na początku `start()`; po `loadFlows().then(startFlows)` – `state.end` na podstawie wyniku `startFlows` (E-01 `{errors}`) albo `state.fail(err)` w miejsce pustego `.catch` (`:247`); `markStopping("stop")` jako pierwsza instrukcja `stop()`, `markStopped()` w `finally`; `runtime.state` w obiekcie runtime.
4. `flows/index.js`: w gałęziach `runtimeFlowState === 'stop'` i safe mode zwrot w wyniku `start()` pola `flowsRunning:false, reason` (E-01 rozszerza wynik), późny start (`:64-65`) – `state.end/fail` przez wynik `start()`.
5. Potok E-01: `begin("deploy")` w kroku 4, `end` w kroku 8 (także w ścieżce błędu – `finally`); `api/flows.js` `setState` w `mutex.runExclusive` + `begin("set-state")`.
6. Powód zatrzymania (sygnał) przekazywany opcjonalnie: `RED.stop({reason:"SIGTERM"})` → `runtime.stop(opts)` – **do potwierdzenia** (czy rozszerzać sygnaturę publicznego `RED.stop`; alternatywa: reason `"stop"` dla wszystkich).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Model stanu instancji

  Scenariusz: Start zakończony powodzeniem
    Zakładając poprawne flow w magazynie
    Kiedy uruchomię runtime
    Wtedy stan przejdzie kolejno: "starting", "ready"
    I stan "ready" zostanie ustawiony dopiero po starcie wszystkich flow
    I stan bezpośrednio po rozwiązaniu obietnicy RED.start() jest "starting", jeżeli flow jeszcze nie wystartowały

  Szablon scenariusza: Nieudany start
    Zakładając <warunek>
    Kiedy uruchomię runtime
    Wtedy stan będzie "failed" z powodem "<powód>"
    Przykłady:
      | warunek                                       | powód             |
      | flow z węzłem nieznanego typu                 | missing-types     |
      | flow wymagające niezainstalowanego modułu     | missing-modules   |
      | magazyn odrzuca odczyt flow                   | storage-error     |
      | Flow.start rzuca wyjątek                      | flow-start-failed |

  Scenariusz: Brakujący typ doinstalowany później
    Zakładając stan "failed" z powodem "missing-types"
    Kiedy brakujący typ zostanie zarejestrowany i flow wystartują bez błędów
    Wtedy stan będzie "ready"

  Szablon scenariusza: Flow świadomie nieuruchomione
    Zakładając <warunek>
    Kiedy uruchomię runtime
    Wtedy stan będzie "idle" z powodem "<powód>"
    Przykłady:
      | warunek                               | powód     |
      | runtimeFlowState zapisany jako "stop" | set-state |
      | tryb safe mode                        | safe-mode |

  Scenariusz: Wdrożenie
    Zakładając stan "ready"
    Kiedy wykonam wdrożenie typu "full"
    Wtedy stan "deploying" zostanie ustawiony przed zdarzeniem flows:stopping
    I stan "ready" zostanie ustawiony po zdarzeniu flows:started
    I zdarzenia instance:state wystąpią w kolejności: deploying, ready

  Scenariusz: Wdrożenie z błędem startu
    Zakładając stan "ready"
    Kiedy wdrożę flow z węzłem nieznanego typu
    Wtedy stan będzie "failed" z powodem "missing-types"

  Scenariusz: Wdrożenie przy zatrzymanych flow
    Zakładając stan "idle" po setState stop
    Kiedy wykonam wdrożenie
    Wtedy stan przejdzie "deploying", a potem "idle"

  Scenariusz: Zatrzymanie jest nieodwracalne
    Zakładając stan "ready"
    Kiedy wywołam runtime.stop()
    Wtedy stan "stopping" zostanie ustawiony przed zdarzeniem flows:stopping
    I po zakończeniu zatrzymania stan będzie "stopped"
    I zdarzenia z zamykanych flow nie zmienią stanu na "ready"

  Scenariusz: Zatrzymanie w trakcie wdrożenia
    Zakładając stan "deploying"
    Kiedy wywołam runtime.stop()
    Wtedy stan będzie "stopping"
    I zakończenie wdrożenia nie zmieni stanu

  Scenariusz: Jedna operacja naraz
    Zakładając trwające wdrożenie
    Kiedy równolegle wywołam setState stop
    Wtedy setState zostanie wykonane po zakończeniu wdrożenia
    I stan nie będzie jednocześnie "deploying" i "idle"

  Scenariusz: Brak zmian przy domyślnych ustawieniach
    Zakładając domyślne ustawienia
    Kiedy wykonam start, wdrożenia i zatrzymanie
    Wtedy odpowiedzi, logi i kolejność zdarzeń flows:* oraz runtime-event są takie jak w wersji bazowej

  Scenariusz: Błąd słuchacza nie blokuje zmiany stanu
    Zakładając słuchacza onChange, który rzuca wyjątek
    Kiedy stan się zmieni
    Wtedy pozostali słuchacze zostaną powiadomieni
    I w logu pojawi się ostrzeżenie
```

#### Testy
- Jednostkowe, nowy `test/unit/@node-red/runtime/lib/state_spec.js`: `starts in starting after markStarting`, `allows only transitions from the table` (szablon dla każdej pary niedozwolonej), `ready only after end with no errors`, `end with errors sets failed with errors`, `end with flowsRunning false sets idle`, `stopping is terminal – begin/end/fail ignored`, `stale token does not change state`, `begin during active operation throws state_operation_in_progress`, `emits instance:state once per transition`, `no event when state unchanged`, `listener exception is logged and others notified`, `onChange returns unsubscribe`.
- `test/unit/@node-red/runtime/lib/index_spec.js`: `state is starting when start() resolves before flows started`, `state becomes ready after startFlows`, `loadFlows rejection sets failed (storage-error)`, `stop() sets stopping synchronously before stopFlows`, `stop() sets stopped after closeContextsPlugin`.
- `test/unit/@node-red/runtime/lib/flows/index_spec.js`: `missing types → failed`, `missing modules → failed`, `safe mode → idle`, `runtimeFlowState stop → idle`, `type-registered late start → ready`, `deploy sets deploying before flows:stopping and ready after flows:started`.
- `test/unit/@node-red/runtime/lib/api/flows_spec.js`: `setState runs in api mutex`, `setState start/stop transitions idle↔ready`.

#### DoD specyficzne
- [ ] Tabela przejść w JSDoc `state.js` identyczna z kartą (test „dozwolone przejścia” generowany z tej tabeli).
- [ ] Testy charakteryzujące zielone przed i po zmianie; istniejące testy `flows/index_spec.js`, `index_spec.js`, `api/flows_spec.js` bez zmian.
- [ ] Brak zmian zachowania przy domyślnych ustawieniach (niezmiennik 7) potwierdzony testem.
- [ ] Nazwa zdarzenia `instance:state` i nazwy stanów zatwierdzone (D-02).

#### Ryzyka i alternatywy
- **Pusty `.catch` przy starcie** (`index.js:247`): zastąpienie obsługą zmienia tylko stan wewnętrzny (bez nowych logów, bez odrzucania `RED.start()`) – zgodność zachowana.
- **`setState` w mutexie:** zmiana kolejkowania (dziś `setState` może przeplatać się z wdrożeniem – to błąd wyścigu). Alternatywa: zostawić bez mutexu i w module stanu odrzucać `begin` – gorsze (błąd zamiast kolejkowania). **Pytanie** – czy akceptują Państwo objęcie `setState` mutexem.
- **`idle` vs `failed` dla safe mode:** zlecenie wymienia safe mode obok błędów startu; proponujemy `idle` (decyzja operatora `--safe`), z punktu widzenia `/ready` bez różnicy (503). **Pytanie**.
- Stan jest lokalny dla procesu – instancja z edytorem bez wykonywania flow (Z-15) będzie stale w `idle`; `/ready` dla takiej roli – do ustalenia w Z-15.
- Alternatywa odrzucona: wyprowadzanie stanu wyłącznie ze zdarzeń `flows:*` – zdarzenia nie odróżniają wdrożenia od startu i są emitowane mimo błędów `Flow.start`.

#### Podzadania
- [ ] Testy charakteryzujące zdarzeń startu/wdrożenia/zatrzymania (S)
- [ ] `runtime/lib/state.js` + testy przejść (M)
- [ ] Wpięcie w `runtime/lib/index.js` (start, pusty `.catch`, stop) (S)
- [ ] Wpięcie w potok E-01 i `setState` (+ mutex) (S)
- [ ] JSDoc + opis w dokumencie kontraktu E-01 (S)

---

### Z-08 – Sondy zdrowia `/live` i `/ready`

| Pole | Wartość |
|---|---|
| Etap / typ | 3 / funkcja + poprawka błędu (D-05: serwer HTTP przy zatrzymaniu) |
| Priorytet / ryzyko | P1 / średnie |
| Ustawienie | `health: { enabled: false, path: "/health", port: <opcjonalnie> }` (zlecenie: `health: { enabled, path }`; ZASADY §2.1) |
| Zależności | E-02 (stan), E-01 (kroki 4/8), Z-09 (stan `reloading`) |
| Pliki | nowy `@node-red/runtime/lib/health.js`; `@node-red/runtime/lib/index.js` (init/start/stop modułu, `runtime.health`); `node-red/red.js:417-436` (kolejność montowania przed uwierzytelnieniem), `:484` (warunek nasłuchu), `:543-558` (sygnały); `node-red/lib/red.js:60-140` (eksport `RED.health` dla osadzających – do potwierdzenia); `node-red/settings.js` (sekcja Runtime Settings); `@node-red/runtime/locales/en-US/runtime.json` |
| Powiązania | K8S-T-005 (sondy, workery z `httpAdminRoot: false`), ARCHITEKTURA §3.5 (drenaż 20 min) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE**, z rozszerzeniem.
- Brak endpointów zdrowia; `/settings` i `/diagnostics` wymagają uwierzytelnienia (WERYFIKACJA Z-08).
- **Fałszywa gotowość:** `RED.start()` kończy się przed startem flow (`runtime/lib/index.js:240-243`, start flow bez `await`), a serwer HTTP nasłuchuje od `node-red/red.js:505` – sonda oparta na „proces odpowiada” zgłaszałaby gotowość przed rejestracją tras `http in`. Potrzebny model stanu (E-02).
- **Zatrzymanie:** sygnały SIGINT, SIGTERM, SIGHUP, SIGUSR2, SIGBREAK i PM2 `shutdown` → `exitWhenStopped` → `RED.stop()` → `process.exit()` (`node-red/red.js:543-558`); `RED.stop()` (`node-red/lib/red.js:134-140`) → `runtime.stop()` (`runtime/lib/index.js:316-328`) → `api.stop()`. **Serwer HTTP nie jest zamykany** – nowe połączenia są przyjmowane w trakcie zatrzymywania flow.
- **Brak globalnego limitu czasu zatrzymania:** tylko `nodeCloseTimeout` na węzeł, domyślnie 15 s (`flows/Flow.js:29,857`, `stopNode :767-788`).
- **Workery z `httpAdminRoot: false`:** aplikacja administracyjna nie jest montowana (`node-red/red.js:422-424`); przy jednoczesnym `httpNodeRoot: false` i braku `httpStatic` serwer w ogóle nie nasłuchuje („headless”, `:484`, `:514`). Sondy nie mogą więc wisieć na `RED.httpAdmin`.
- Uwierzytelnienie montowane na korzeniach: `httpAdminAuth` (`:417-420`), `httpNodeAuth` (`:426-432`) – jeśli `health.path` leży pod `httpNodeRoot: "/"` z `httpNodeAuth`, sonda byłaby objęta uwierzytelnieniem, o ile nie zostanie zamontowana wcześniej.
- Stany nieudanego startu: `flows/index.js:301` (missing-types), `:315` (missing-modules), `:325` (safe mode); `runtimeFlowState: stop` `:333-340`.
- Testy: `runtime/lib/flows/Flow_spec.js:477` (nodeCloseTimeout), `flows/index_spec.js`, `runtime/lib/index_spec.js`; brak testów sygnałów i `node-red/red.js`.

#### Specyfikacja
- **Cel:** endpointy żywotności i gotowości dla orkiestratora i load balancera, wiarygodne także w trakcie startu, wdrożenia, przeładowania i zatrzymania.
- **Wejścia:** `GET`/`HEAD` `<path>/live`, `<path>/ready`; ustawienia `health.enabled` (domyślnie `false`), `health.path` (domyślnie `"/health"`), `health.port` (opcjonalnie; brak → serwer główny).
- **Wyjścia:**
  - `/live` → `200` zawsze, gdy proces obsługuje pętlę zdarzeń (we wszystkich stanach E-02, także `stopping` – nie restartować instancji w trakcie drenażu).
  - `/ready` → `200` tylko w stanie `ready`; `503` w `starting`, `deploying`, `reloading`, `idle` (propozycja), `failed`, `stopping`, `stopped`.
  - Treść: `application/json`, `{"status":"ok"}` lub `{"status":"unavailable","state":"<stan E-02>"}`; nagłówek `Cache-Control: no-store`. Treść **nie zawiera** konfiguracji, ścieżek, wersji, listy flow ani błędów (nazwa stanu – do potwierdzenia, zob. pytania).
  - Inne metody → `405`; inne ścieżki pod `<path>` → `404`.
  - Ustawienie wyłączone → brak tras (`404` jak dziś), brak dodatkowego serwera.
- **Niezmienniki:**
  - bez uwierzytelnienia i bez `httpAdminMiddleware`/`httpNodeMiddleware`, niezależnie od `adminAuth`, `httpAdminAuth`, `httpNodeAuth`;
  - działa przy `httpAdminRoot: false` i `httpNodeRoot: false` (z `port` – osobny serwer; bez `port` – serwer główny zaczyna nasłuch tylko dla sond);
  - `/ready` przechodzi na `503` **synchronicznie** w chwili wywołania `runtime.stop()` (przed zatrzymaniem pierwszego węzła) i w kroku 4 E-01 (przed zatrzymaniem węzłów wdrożenia);
  - odpowiedź nie wykonuje I/O (odczyt `runtime.state.get()`), czas odpowiedzi stały;
  - przy `health.enabled: false` – zachowanie identyczne z 5.0.7 (w tym brak zamykania serwera HTTP – zob. Ryzyka).
- **Przypadki błędów:** `health.port` zajęty → start runtime odrzucony z czytelnym komunikatem (`health.port-in-use`), stan `failed`; `health.port === uiPort` → montaż na serwerze głównym + `log.warn`; `health.path` bez wiodącego `/` lub równy `/` → błąd startu (`health.invalid-path`); `health.path` wewnątrz `httpAdminRoot`/`httpNodeRoot` → dozwolone, sondy mają pierwszeństwo + `log.info` przy starcie (trasa węzła o tej samej ścieżce zostanie przesłonięta).
- **Skutki uboczne:** przy `port` – dodatkowy serwer `http` (moduł wbudowany Node.js, bez nowych zależności), nasłuch na `uiHost` (do potwierdzenia: osobne `health.host`); zamykany po `stopped`. Przy włączonych sondach i osobnym porcie – zamknięcie serwera głównego dla **nowych** połączeń w chwili `stopping` (`server.close()`, trwające połączenia i strumienie obsługiwane dalej) – poprawka D-05.

#### Projekt rozwiązania (minimalny)
1. `runtime/lib/health.js`: `init(runtime)`; `handler(req, res, next)` – zwykła funkcja `(req,res)` zgodna z Express i `http`, rozpoznaje `/live` i `/ready` względem `health.path`; `start()` – przy `health.port` tworzy `http.createServer(handler)` i `listen(port, uiHost)` (obietnica odrzucana przy `EADDRINUSE`); `stop()` – zamyka własny serwer po `stopped`.
2. `runtime/lib/index.js`: `health.init` w `init()`, `health.start()` na początku `start()` (sondy dostępne od `starting` – `/ready` 503); `runtime.health` w obiekcie runtime.
3. `node-red/red.js` (CLI): gdy `health.enabled` i brak osobnego portu – `app.use(health.path, RED.health.handler)` **przed** montowaniem `httpAdminAuth`/`httpNodeAuth` i aplikacji (`:417`); warunek nasłuchu (`:484`) rozszerzony o `health.enabled` bez portu.
4. `node-red/lib/red.js`: getter `health` (`{ handler }`) dla aplikacji osadzających Node-RED – **do potwierdzenia** (nowe publiczne API).
5. D-05: w `exitWhenStopped` (CLI) – przy `health.enabled` i osobnym porcie `server.close()` + `server.closeIdleConnections()` (Node ≥ 18.2) przed `RED.stop()`; przy sondach na serwerze głównym serwer nie jest zamykany (inaczej `/live` przestałby odpowiadać) – zob. Ryzyka.
6. Szablon `settings.js`: blok `health` (zakomentowany) z opisem stanów, zaleceniem osobnego portu dla workerów i uwagą o drenażu.
7. Teksty logów w `runtime.json` (`health.listening`, `health.port-in-use`, `health.invalid-path`, `health.path-shadows-route`).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Sondy zdrowia

  Scenariusz: Przejścia stanów start → gotowy → wdrożenie → gotowy → zatrzymanie (kryterium zlecenia)
    Zakładając health.enabled = true
    Kiedy runtime się uruchamia i flow jeszcze nie wystartowały
    Wtedy GET /health/ready zwraca 503, a GET /health/live zwraca 200
    Kiedy flow wystartują bez błędów
    Wtedy GET /health/ready zwraca 200
    Kiedy rozpocznę wdrożenie, którego węzeł zamyka się 2 s
    Wtedy w trakcie wdrożenia GET /health/ready zwraca 503
    Kiedy nowe flow wystartują
    Wtedy GET /health/ready zwraca 200
    Kiedy proces otrzyma SIGTERM
    Wtedy GET /health/ready zwraca 503, zanim pierwszy węzeł zacznie się zamykać
    I GET /health/live zwraca 200 do zakończenia zatrzymania

  Scenariusz: Gotowość dopiero po starcie flow, nie po RED.start()
    Zakładając health.enabled = true i start flow opóźniony atrapą
    Kiedy obietnica RED.start() zostanie rozwiązana
    Wtedy GET /health/ready zwraca 503 do chwili startu flow

  Szablon scenariusza: Sygnały zatrzymania
    Zakładając health.enabled = true i stan "ready"
    Kiedy proces otrzyma <sygnał>
    Wtedy GET /health/ready zwraca 503
    Przykłady:
      | sygnał  |
      | SIGTERM |
      | SIGINT  |

  Scenariusz: Przeładowanie z magazynu
    Zakładając health.enabled = true, magazyn z watchFlows i stan "ready"
    Kiedy magazyn powiadomi o zmianie flow
    Wtedy GET /health/ready zwraca 503 od decyzji o przeładowaniu do startu nowych flow

  Szablon scenariusza: Nieudany lub świadomie wstrzymany start
    Zakładając health.enabled = true i <warunek>
    Kiedy runtime się uruchomi
    Wtedy GET /health/ready zwraca 503 z treścią zawierającą state "<stan>"
    I GET /health/live zwraca 200
    Przykłady:
      | warunek                               | stan   |
      | flow z węzłem nieznanego typu         | failed |
      | flow wymagające brakującego modułu    | failed |
      | błąd odczytu flow z magazynu          | failed |
      | tryb safe mode                        | idle   |
      | runtimeFlowState zapisany jako "stop" | idle   |

  Scenariusz: Bez uwierzytelnienia
    Zakładając health.enabled = true, włączone adminAuth i httpNodeAuth na "/"
    Kiedy wyślę GET /health/ready bez poświadczeń
    Wtedy odpowiedź nie jest 401

  Scenariusz: Treść nie ujawnia konfiguracji
    Zakładając health.enabled = true
    Kiedy wyślę GET /health/ready i GET /health/live
    Wtedy treść zawiera wyłącznie pola status i opcjonalnie state
    I nie zawiera ścieżek, wersji, identyfikatorów flow ani komunikatów błędów

  Scenariusz: Workery bez Admin API – osobny port
    Zakładając httpAdminRoot = false, httpNodeRoot = false i health = { enabled: true, port: 1881 }
    Kiedy runtime się uruchomi
    Wtedy GET http://host:1881/health/ready odpowiada zgodnie ze stanem
    I port uiPort nie przyjmuje połączeń

  Scenariusz: Workery bez Admin API – serwer główny
    Zakładając httpAdminRoot = false, httpNodeRoot = false i health = { enabled: true }
    Kiedy runtime się uruchomi
    Wtedy serwer główny nasłuchuje i obsługuje tylko trasy sond

  Scenariusz: Ustawienie wyłączone
    Zakładając domyślne ustawienia
    Kiedy wyślę GET /health/ready
    Wtedy odpowiedź jest taka jak w wersji bazowej (404 lub trasa użytkownika)
    I nie jest uruchamiany dodatkowy serwer

  Scenariusz: Zajęty port sond
    Zakładając health.port zajęty przez inny proces
    Kiedy runtime się uruchamia
    Wtedy start kończy się błędem z komunikatem wskazującym health.port

  Scenariusz: Zamknięcie serwera dla nowych połączeń przy zatrzymaniu
    Zakładając health = { enabled: true, port: 1881 } i trwające długie żądanie HTTP do flow
    Kiedy proces otrzyma SIGTERM
    Wtedy nowe połączenia na uiPort są odrzucane
    I trwające żądanie zostaje obsłużone do końca lub do zamknięcia węzła

  Scenariusz: Metody i ścieżki
    Zakładając health.enabled = true
    Kiedy wyślę POST /health/ready
    Wtedy odpowiedź ma status 405
    Kiedy wyślę HEAD /health/live
    Wtedy odpowiedź ma status 200 bez treści
```

#### Testy
- Jednostkowe, nowy `test/unit/@node-red/runtime/lib/health_spec.js` (supertest na `handler`, atrapa `runtime.state`): `live returns 200 in every state` (szablon po stanach), `ready returns 200 only in ready`, `ready returns 503 with state in starting|deploying|reloading|idle|failed|stopping|stopped`, `body contains only status and state`, `sets Cache-Control no-store`, `405 for POST`, `HEAD supported`, `404 for unknown subpath`, `disabled – no routes, no server`, `port – starts own server`, `port in use – start rejects with health.port-in-use`, `port equal uiPort – mounts on main server and warns`, `invalid path rejected`.
- `test/unit/@node-red/runtime/lib/index_spec.js`: `ready 503 when RED.start resolved before flows started`, `ready 503 synchronously after stop() called` (węzeł atrapa z wolnym `close`).
- Integracyjny `test/unit/@node-red/runtime/lib/health_lifecycle_spec.js`: pełna sekwencja start → ready → deploy (węzeł z 2 s `close`) → ready → stop z odpytywaniem `/ready` co 50 ms; wariant missing-types; wariant `runtimeFlowState: stop`.
- `test/unit/node-red/red_spec.js` lub nowy `test/unit/node-red/health_mount_spec.js`: `health mounted before httpNodeAuth`, `server listens when only health enabled` (wydzielenie funkcji montowania z `red.js` do testowalnego modułu – **do potwierdzenia**, CLI nie ma dziś testów).
- Test sygnałów: proces potomny (`child_process.fork`) z minimalnymi ustawieniami, `process.kill(pid,'SIGTERM')`, odpytywanie `/ready` na porcie sond – bez nowych zależności.

#### DoD specyficzne
- [ ] Testy obu stanów `health.enabled` i obu wariantów (`port` / serwer główny).
- [ ] Szablon `settings.js` z opisem, zaleceniem dla workerów (`httpAdminRoot:false` + `port`) i ostrzeżeniem, że sondy są publiczne na danym porcie.
- [ ] Dokumentacja odpowiedzi (kody, treść) i tabela stan → kod (z E-02).
- [ ] Zamknięcie serwera przy SIGTERM pokryte testem regresji (D-05) albo jawnie odłożone decyzją.

#### Ryzyka i alternatywy
- **Drenaż przy SIGTERM:** `RED.stop()` od razu zatrzymuje flow (zamyka węzły w ciągu `nodeCloseTimeout`), więc `terminationGracePeriodSeconds: 1200` sam nie chroni rozmów – sonda 503 tylko przestaje kierować **nowy** ruch. Opcje: (A) `preStop` w Kubernetes (uśpienie przed SIGTERM; pod usuwany z Endpoints od razu) – bez zmian w rdzeniu, rekomendacja na teraz; (B) `health.shutdownDelay` (ms między 503 a zatrzymaniem flow); (C) hook „przed zatrzymaniem” analogiczny do `preReload`, kończący drenaż wcześniej, gdy rozmowy się skończą. **Pytanie** – (B)/(C) poza opisem zlecenia.
- **Globalny limit zatrzymania:** brak (tylko `nodeCloseTimeout` per węzeł); proces może kończyć się dłużej niż okres łaski orkiestratora → SIGKILL. Proponujemy nie dodawać w tym pakiecie (orkiestrator ma własny limit) – **pytanie**.
- **Zamknięcie serwera przy sondach na serwerze głównym** wyłączyłoby `/live` (ryzyko restartu w trakcie zamykania – zachowanie kubeleta dla sond żywotności poda w stanie Terminating **do potwierdzenia**); stąd zamykanie tylko przy osobnym porcie. Poprawka D-05 dla `health.enabled:false` (domyślnie) zmieniłaby zachowanie 5.0.6 – proponujemy tylko przy włączonych sondach.
- **`/ready` przy `idle`** (`runtimeState` stop, safe mode): 503 chroni przed kierowaniem ruchu do instancji bez flow; instancja edycyjna (Z-15) potrzebuje innej semantyki – **pytanie**.
- **Wszystkie workery 503 jednocześnie** przy przeładowaniu (Z-09) – opisane w Z-09.
- Ścieżka sond pod `httpNodeRoot` przesłania trasy `http in` o tej samej ścieżce – ostrzeżenie w logu; zalecenie: osobny port.
- Alternatywa: sondy w `editor-api` – odrzucona (niedostępne przy `httpAdminRoot:false`).

#### Podzadania
- [ ] `runtime/lib/health.js` + testy jednostkowe handlera (M)
- [ ] Osobny serwer (`port`) + obsługa błędów portu (S)
- [ ] Montaż w CLI przed uwierzytelnieniem, warunek nasłuchu, `RED.health` (S)
- [ ] D-05: zamykanie serwera przy SIGTERM (przy osobnym porcie) + test w procesie potomnym (M)
- [ ] Test cyklu życia (integracyjny) (M)
- [ ] Szablon `settings.js`, CHANGELOG, teksty logów (S)

---

### Z-09 – Przeładowanie flow po zmianie w magazynie

| Pole | Wartość |
|---|---|
| Etap / typ | 3 / funkcja |
| Priorytet / ryzyko | P1 / wysokie |
| Ustawienie | API wtyczki magazynu: opcjonalne `watchFlows(callback)` (bez zmian względem zlecenia); hook `preReload`. Parametry: propozycja `deploy.reload: { watch: true, type: "full" \| "flows", preReloadTimeout: 1200000, retry: { min: 1000, max: 60000 } }` – nazwa i wartości domyślne **do potwierdzenia** (D-02). Bez `watchFlows` w magazynie ustawienie nie ma efektu. |
| Zależności | E-01 (wspólny mutex, potok bez kroku 5), E-02 (`reloading`), Z-08 (`/ready`), Z-06 (`VALID_HOOKS`, wzorzec limitu czasu), P-01 (błędy startu w wyniku `start()`) |
| Pliki | `@node-red/runtime/lib/storage/index.js:51-120` (wykrycie `watchFlows`, `getFlows` – rewizja `:80`); `@node-red/runtime/lib/flows/index.js:104-110` (`load`), `:118-242` (`setFlows`, gałąź `load` `:141-148`), `:434-515`; `@node-red/runtime/lib/flows/util.js` (`diffConfigs`); `@node-red/runtime/lib/api/flows.js:37-38,66-100` (mutex, `reload`); nowy `@node-red/runtime/lib/flows/reload.js`; `@node-red/runtime/lib/index.js:239-247,316-328`; `@node-red/util/lib/hooks.js:3-17`; `node-red/settings.js`; `@node-red/runtime/locales/en-US/runtime.json` |
| Powiązania | K8S-T-001 (nasza wtyczka magazynu implementuje `watchFlows` – PostgreSQL LISTEN/NOTIFY lub Redis), K8S-T-006 (wydania niezmienne – opcja operacyjna), ARCHITEKTURA §3.3, §3.5 (drenaż 20 min), ANALIZA §3 (Z-09 mechanizmem podstawowym) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE**; mechanizm przeładowania już istnieje.
- API magazynu: `init, getFlows, saveFlows, saveCredentials, getSettings/saveSettings, getSessions/saveSessions, getLibraryEntry/saveLibraryEntry` (+ `projects`, `sshkeys`); brak obserwacji zmian (`storage/index.js:51-195`). Funkcje opcjonalne wykrywane przez `hasOwnProperty` (`:56-57` – `getSettings/saveSettings`, `getSessions/saveSessions`) – wzorzec dla `watchFlows`.
- Rewizja = SHA-256 z `JSON.stringify(flows)` (`storage/index.js:80`, `:98`) – **bez poświadczeń**: zmiana samych poświadczeń nie zmienia rewizji.
- `flows.load(true)` (`flows/index.js:104-110`) → `setFlows(null,null,"load",false,true)`: odczyt z magazynu (`loadFlows()` – flow + poświadczenia), `type = "full"`, `diff` nieustalony → **pełny restart** wszystkich flow (`:141-148`, `:212-233`); brak zapisu do magazynu.
- `reload` z Admin API: `api/flows.js:73-74` → `flows.loadFlows(true)` w `mutex.runExclusive` (`:67`); mutex jest lokalny dla modułu (`:37-38`) – bezpośrednie wywołanie `flows.load(true)` przez obserwatora **ominęłoby** blokadę. Przełączenie projektu (`storage/localfilesystem/projects/index.js:396`) też omija mutex.
- Przeładowanie przy zatrzymanych flow (`started=false`, np. `runtimeFlowState: stop`) – `forceStart=true` w `load(true)` **uruchomiłoby** flow (`:212`) – obserwator nie może używać `forceStart`.
- Start flow bez `await` i połykanie błędów zatrzymania (`:228`, `:233`) – dotyczy także przeładowania (rozwiązuje E-01/P-01).
- `setFlows` emituje `runtime-deploy` z nową rewizją (`:229`) → edytory dostają powiadomienie o zmianie flow (zachowanie edytora wg P-02).
- Hooki: `VALID_HOOKS` (`util/lib/hooks.js:3-17`) – `preReload` wymaga dopisania; `trigger()` bez limitu czasu (WERYFIKACJA Z-06).

#### Specyfikacja
- **Cel:** instancja dowiaduje się o zmianie flow zapisanej w magazynie przez inną instancję i przeładowuje się w miejscu, z drenażem pracy w toku przez `preReload` i sygnałem `/ready` 503 na czas przeładowania.
- **Kontrakt wtyczki magazynu (opcjonalny):**

```js
/**
 * Opcjonalne. Rejestruje obserwatora zmian flow w magazynie.
 * Runtime wywołuje raz, po storage.init() i PRZED pierwszym odczytem flow
 * (powiadomienia sprzed zakończenia startu są buforowane – brak okna utraty zmian).
 *
 * @param {(notification?: FlowsChangeNotification) => void} callback
 *        wywoływany przy każdej zmianie flow/poświadczeń w magazynie (także zmianie
 *        dokonanej przez tę instancję). Może być wywoływany wielokrotnie i seriami.
 * @returns {Promise<void | (() => Promise<void>)>} opcjonalnie funkcja wyrejestrowania,
 *        wywoływana przez runtime w runtime.stop()
 *
 * @typedef {Object} FlowsChangeNotification   – wszystkie pola opcjonalne (wskazówki)
 * @property {string}  [rev]                 rewizja zapisanych flow (jak storage.getFlows().rev)
 * @property {boolean} [credentialsChanged]  zmieniono poświadczenia (rewizja ich nie obejmuje)
 * @property {string}  [source]              identyfikator instancji zapisującej (nieinterpretowany)
 */
watchFlows(callback)
```
  Runtime **zawsze** wczytuje flow przez `getFlows()`/`getCredentials()` – powiadomienie jest tylko sygnałem (wtyczka może wywołać `callback()` bez argumentów).
- **Hook `preReload`** (`RED.hooks.add("preReload", handler)`):

```js
/**
 * @typedef {Object} PreReloadEvent            – zamrożona kopia
 * @property {string}   rev            rewizja, która zostanie uruchomiona
 * @property {string}   activeRev      rewizja aktualnie działająca
 * @property {"full"|"flows"} type     rodzaj przeładowania
 * @property {string[]|null} changedFlows  id flow (zakładek i subflow) zatrzymywanych/zmienianych;
 *                                     null przy "full" (wszystkie)
 * @property {boolean}  credentialsChanged
 * @property {number}   deadline       Date.now() + preReloadTimeout
 * @property {AbortSignal} signal      przerwany przy runtime.stop() (SIGTERM w trakcie drenażu)
 * @returns {Promise<void>|void}  rozwiązanie = „można przeładować”
 */
```
  Semantyka: handler może jedynie **opóźnić** przeładowanie (np. czekać, aż liczba aktywnych rozmów w `changedFlows` spadnie do zera). Kilka handlerów wykonywanych kolejno (semantyka `hooks.trigger`); limit czasu dotyczy całości.
  - rozwiązanie → przeładowanie;
  - przekroczenie `preReloadTimeout` → `log.warn("reload.hook-timeout")` i **przeładowanie mimo to**;
  - wyjątek / odrzucenie / zwrot `false` → `log.error("reload.hook-failed")` i przeładowanie mimo to (hook nie ma prawa weta – instancja nie może zostać na nieaktualnej konfiguracji; **pytanie**);
  - `signal` przerwany (SIGTERM) → przeładowanie anulowane, stan `stopping` (E-02).
- **Wejścia:** powiadomienia `callback`; ustawienia `deploy.reload.*`; aktywna konfiguracja (`flows.getFlows()`).
- **Wyjścia:** przeładowana konfiguracja (pełna lub różnicowa), zdarzenie `runtime-deploy` z nową rewizją (edytory), stan E-02 `reloading` → `ready`/`failed`/`idle`, logi `reload.*`, wpis audytu `flows.reload` (`source:"storage"`).
- **Algorytm (jeden cykl):**
  1. powiadomienie → jeśli trwa cykl: ustaw `pending = true` i zakończ (koalescencja);
  2. odczyt `storage.getFlows()`; jeśli `rev === activeRev` i nie `credentialsChanged` → pomiń (własny zapis lub duplikat; `log.debug`);
  3. policz `diff = flowUtil.diffConfigs(active, new)` → `changedFlows` (dla `type:"full"` lub `diff.globalConfigChanged` – `null`/pełne);
  4. `state.begin("reload")` → `/ready` 503;
  5. `preReload` z limitem czasu (**poza** mutexem – nie blokuje wdrożeń z edytora przez 20 min);
  6. wejście do wspólnego mutexu E-01; jeśli w międzyczasie aktywna rewizja zmieniła się lokalnie (wdrożenie z Admin API) → ponowne porównanie z treścią z kroku 2: równa → koniec; różna → przeładowanie treści z kroku 2 (magazyn jest źródłem prawdy – **do potwierdzenia**);
  7. zatrzymanie i start wg `type` (E-01 kroki 6–8, bez kroku 5 – brak zapisu do magazynu, bez `forceStart`);
  8. `state.end()`, `runtime-deploy`; jeśli `pending` → `pending=false`, nowy cykl od kroku 2.
- **Niezmienniki:**
  - magazyn bez `watchFlows` → zachowanie identyczne z 5.0.7 (brak obserwatora, brak nowych logów);
  - najwyżej jeden cykl naraz; N powiadomień w trakcie cyklu → **jeden** kolejny cykl;
  - przeładowanie nigdy nie zapisuje do magazynu i nigdy nie uruchamia flow zatrzymanych świadomie (`idle` → przeładowanie aktualizuje konfigurację bez startu);
  - zatrzymanie/start węzłów wyłącznie wewnątrz wspólnego mutexu (brak przeplotu z `/flows`, `/flow`, `reload`, `setState`);
  - uruchamiana jest dokładnie treść przekazana do `preReload` (rev w hooku = rev po przeładowaniu);
  - po `stopping` żaden cykl nie startuje, trwający jest anulowany przed zatrzymaniem węzłów.
- **Przypadki błędów:**
  - błąd odczytu magazynu → `log.warn("reload.read-failed")`, stan wraca do sprzed cyklu (działająca konfiguracja bez zmian, `/ready` jak przed cyklem – propozycja), ponowienie z wykładniczym opóźnieniem `retry.min`…`retry.max`, kolejne powiadomienie resetuje opóźnienie; **pytanie**: czy po N nieudanych próbach przejść w `failed` (instancja nieaktualna względem klastra);
  - błąd startu nowych flow → stan `failed` (E-02), `/ready` 503, log (jak wdrożenie);
  - wyjątek w `callback` wtyczki / wywołanie po `stop()` → ignorowane z `log.debug`;
  - `watchFlows` odrzuca przy rejestracji → `log.error`, runtime startuje bez obserwacji (propozycja; alternatywa: błąd startu – **pytanie**).
- **Skutki uboczne:** zdarzenie `runtime-deploy` → edytory połączone z instancją dostają powiadomienie o nowych flow (polityka P-02); wpis audytu; dodatkowy odczyt magazynu na powiadomienie (w tym własne zapisy – odrzucane po porównaniu rewizji).

#### Projekt rozwiązania (minimalny)
1. `storage/index.js`: `watchAvailable = typeof storageModule.watchFlows === "function"`; `storageModuleInterface.watchFlows(cb)` tylko gdy dostępne (opakowanie z `try/catch`), `storageModuleInterface.hasWatchFlows()`.
2. Wspólny mutex: przeniesienie `mutex` z `api/flows.js:37-38` do modułu współdzielonego (np. `runtime/lib/flows/lock.js`, nazwa wg E-01), używanego przez API i przeładowanie.
3. `flows/index.js`: nowa funkcja wewnętrzna `reloadFromStorage(loaded, {type})` – przyjmuje treść już wczytaną (krok 2), liczy `diff`, wykonuje `stop(type,diff)` → `context.clean` → `start(type,diff)` z `await` (E-01) bez zapisu i bez `forceStart`; dla `type:"full"` – jak gałąź `load`; credentials przez `credentials.load(loaded.credentials)`.
4. `runtime/lib/flows/reload.js`: obserwator (stan `idle/running/pending`, bufor powiadomień do końca startu, porównanie rewizji, `preReload` z `Promise.race` + `AbortController`, ponowienia), `init(runtime)`, `start()` (po pierwszym starcie flow), `stop()` (abort + wyrejestrowanie).
5. `runtime/lib/index.js`: rejestracja `watchFlows` po `storage.init`, przed `loadFlows()` (`:241`); `reload.stop()` na początku `stop()` (po `markStopping`).
6. `util/lib/hooks.js`: `"preReload"` w `VALID_HOOKS` (sekcja z Z-06) + JSDoc payloadu.
7. Szablon `settings.js`: blok `deploy.reload` z opisem; CHANGELOG; dokumentacja kontraktu `watchFlows` dla autorów wtyczek magazynu (JSDoc + przykład atrapy w testach).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Przeładowanie flow po zmianie w magazynie

  Scenariusz: Powiadomienie powoduje przeładowanie (kryterium zlecenia)
    Zakładając atrapę magazynu z watchFlows i działające flow w rewizji "A"
    Kiedy inna instancja zapisze rewizję "B" i atrapa wywoła callback
    Wtedy runtime wczyta flow z magazynu i uruchomi rewizję "B"
    I zdarzenie runtime-deploy zawiera rewizję "B"
    I nic nie zostanie zapisane do magazynu

  Scenariusz: Hook preReload opóźnia przeładowanie (kryterium zlecenia)
    Zakładając hook preReload, który kończy się dopiero po sygnale testu
    Kiedy magazyn powiadomi o zmianie
    Wtedy węzły nie są zatrzymywane, dopóki hook się nie zakończy
    I GET /health/ready zwraca 503 przez cały czas oczekiwania
    Kiedy hook się zakończy
    Wtedy flow zostaną przeładowane i GET /health/ready zwróci 200

  Scenariusz: Limit czasu hooka (kryterium zlecenia)
    Zakładając deploy.reload.preReloadTimeout = 100 ms i hook preReload, który się nie kończy
    Kiedy magazyn powiadomi o zmianie
    Wtedy po 100 ms flow zostaną przeładowane mimo to
    I w logu pojawi się ostrzeżenie o przekroczeniu limitu

  Scenariusz: Magazyn bez watchFlows (kryterium zlecenia)
    Zakładając magazyn bez funkcji watchFlows
    Kiedy runtime się uruchomi i inna instancja zmieni flow w magazynie
    Wtedy runtime nie przeładowuje flow
    I zachowanie oraz logi są takie jak w wersji bazowej

  Scenariusz: Powiadomienie o własnym zapisie
    Zakładając, że ta instancja wdrożyła rewizję "B" przez Admin API
    Kiedy magazyn powiadomi o rewizji "B"
    Wtedy przeładowanie nie zostanie wykonane, a hook preReload nie zostanie wywołany

  Scenariusz: Zmiana samych poświadczeń
    Zakładając powiadomienie z credentialsChanged = true i niezmienioną rewizją
    Kiedy runtime obsłuży powiadomienie
    Wtedy flow zostaną przeładowane z nowymi poświadczeniami

  Scenariusz: Koalescencja zbiegających się powiadomień
    Zakładając trwające przeładowanie rewizji "B" zablokowane w preReload
    Kiedy magazyn wyśle 5 powiadomień, a ostatnia zapisana rewizja to "F"
    Wtedy po zakończeniu przeładowania "B" wykonane zostanie dokładnie jedno kolejne przeładowanie
    I uruchomiona zostanie rewizja "F"

  Scenariusz: Wspólna blokada z Admin API
    Zakładając przeładowanie w fazie zatrzymywania węzłów
    Kiedy klient wyśle POST /flows
    Wtedy wdrożenie zostanie wykonane dopiero po zakończeniu przeładowania
    I zatrzymanie i start węzłów obu operacji nie przeplatają się

  Scenariusz: Oczekiwanie w preReload nie blokuje wdrożeń
    Zakładając hook preReload oczekujący na zakończenie rozmów
    Kiedy klient wyśle POST /flows
    Wtedy wdrożenie zostanie wykonane bez czekania na hook

  Scenariusz: Hook otrzymuje rewizję i listę zmienionych flow
    Zakładając deploy.reload.type = "flows"
    Kiedy w magazynie zmieni się tylko flow "t1"
    Wtedy preReload otrzyma rev nowej rewizji, activeRev działającej i changedFlows ["t1"]
    I flow "t2" nie zostanie zatrzymane

  Scenariusz: Przeładowanie pełne
    Zakładając deploy.reload.type = "full"
    Kiedy magazyn powiadomi o zmianie
    Wtedy preReload otrzyma type "full" i changedFlows null
    I wszystkie flow zostaną zrestartowane

  Scenariusz: Błąd hooka nie blokuje przeładowania
    Zakładając hook preReload, który rzuca błąd
    Kiedy magazyn powiadomi o zmianie
    Wtedy flow zostaną przeładowane
    I w logu pojawi się błąd hooka

  Scenariusz: Błąd odczytu magazynu
    Zakładając, że magazyn odrzuca getFlows dwa razy, a potem odpowiada
    Kiedy magazyn powiadomi o zmianie
    Wtedy działające flow nie zostaną zatrzymane
    I runtime ponowi odczyt z rosnącym opóźnieniem i za trzecim razem przeładuje flow
    I w logu pojawią się ostrzeżenia o błędzie odczytu

  Scenariusz: Flow zatrzymane świadomie
    Zakładając stan "idle" po setState stop
    Kiedy magazyn powiadomi o zmianie
    Wtedy aktywna konfiguracja zostanie zaktualizowana bez uruchamiania flow

  Scenariusz: SIGTERM w trakcie drenażu
    Zakładając hook preReload oczekujący na zakończenie rozmów
    Kiedy proces otrzyma SIGTERM
    Wtedy hook otrzyma przerwany signal
    I przeładowanie nie zostanie wykonane, a stan będzie "stopping"

  Scenariusz: Zmiana w okresie startu nie ginie
    Zakładając, że magazyn powiadomi o rewizji "B" w trakcie pierwszego startu rewizji "A"
    Kiedy start się zakończy
    Wtedy runtime przeładuje flow do rewizji "B"

  Scenariusz: Edytor dostaje informację o przeładowaniu
    Zakładając edytor połączony z instancją
    Kiedy instancja przeładuje flow z magazynu
    Wtedy edytor otrzyma zdarzenie runtime-deploy z nową rewizją
```

#### Testy
- Jednostkowe, nowy `test/unit/@node-red/runtime/lib/flows/reload_spec.js` (atrapa magazynu z `watchFlows`, sinon fake timers): `notification triggers reload from storage`, `no save on reload`, `skips when rev equals active`, `reloads on credentialsChanged with same rev`, `coalesces notifications during reload into one`, `buffers notifications during startup`, `preReload delays stop`, `preReload timeout proceeds with warning`, `preReload error proceeds with error log`, `preReload receives rev, activeRev, type, changedFlows, deadline, signal`, `payload is frozen`, `abort on stop cancels reload`, `read failure retries with backoff and keeps flows`, `idle state updates config without start`, `start errors set failed`.
- `test/unit/@node-red/runtime/lib/storage/index_spec.js`: `exposes watchFlows when module provides it`, `hasWatchFlows false without it`, `callback exceptions are contained`.
- `test/unit/@node-red/runtime/lib/flows/index_spec.js`: `reloadFromStorage type flows restarts only changed flows`, `reloadFromStorage full restarts all`, `globalConfigChanged forces full`.
- `test/unit/@node-red/runtime/lib/api/flows_spec.js`: `reload and api deploy share one mutex` (kolejność zdarzeń), `preReload wait does not hold mutex`.
- `test/unit/@node-red/runtime/lib/index_spec.js`: `watchFlows registered before first loadFlows`, `unwatch called on stop`, `storage without watchFlows – no watcher`.
- `test/unit/@node-red/util/lib/hooks_spec.js`: `allows preReload hook`.

#### DoD specyficzne
- [ ] Kontrakt `watchFlows` i payload `preReload` w JSDoc i dokumentacji dla autorów wtyczek magazynu.
- [ ] Test „magazyn bez `watchFlows` = brak zmian” (logi, zdarzenia, wywołania).
- [ ] Wszystkie cztery kryteria odbioru zlecenia jako testy z atrapą magazynu.
- [ ] Limit `preReloadTimeout` konfigurowalny, wartość ≥ 20 min dozwolona i udokumentowana (przykład dla rozmów do ~15 min).
- [ ] Przeładowanie przechodzi przez wspólny mutex E-01 (test kolejności).

#### Ryzyka i alternatywy
- **Wszystkie workery jednocześnie 503:** powiadomienie dociera do wszystkich instancji naraz; przy `/ready` 503 od kroku 4 i drenażu do 20 min cały Deployment przestaje przyjmować ruch – **przerwa w obsłudze**. Opcje: (A) `/ready` 503 tylko na czas faktycznego zatrzymania/startu (krok 7), a w trakcie `preReload` instancja przyjmuje nowe rozmowy (hook decyduje, co z nimi – np. kieruje je do starej wersji flow); (B) przeładowanie po kolei: przed krokiem 4 zajęcie przez koordynację (Z-10) „miejsca przeładowania” z limitem równoległości (np. 1 lub 25% instancji); (C) losowe opóźnienie startu cyklu; (D) wydania niezmienne + rolling update (K8S-T-006) zamiast przeładowania na produkcji. Zlecenie wymaga 503 „na czas przeładowania” – **pytanie** (rekomendacja: A dla 503 + B jako opcja; B wiąże Z-09 z Z-10).
- **Pełne vs różnicowe:** dziś `load(true)` = pełny restart – przerywa wszystkie rozmowy także w niezmienionych flow (przy rozmowach ~15 min istotne). Rekomendacja: zaimplementować oba (`type: "full" | "flows"`), domyślnie `"full"` (semantyka zlecenia i 5.0.6), dla workerów zalecane `"flows"`. Ograniczenia różnicowego: zmiana globalnych configów → pełny (jak `setFlows`); diff nie widzi zmian samych poświadczeń (poświadczenia nie są w konfiguracji węzłów przy `load`) → przy `credentialsChanged` pełny restart lub restart węzłów, których poświadczenia się zmieniły (**do potwierdzenia** w implementacji). **Pytanie**.
- **Rewizja bez poświadczeń** (`storage/index.js:80`): bez `credentialsChanged` od wtyczki zmiana hasła w węźle konfiguracyjnym nie zostanie przeładowana (pominięcie jako „własny zapis”). Wymaganie dla wtyczek magazynu (K8S-T-001).
- **Wdrożenie lokalne w trakcie drenażu** (krok 6): rekomendacja „magazyn jest źródłem prawdy” – na instancji z edytorem może cofnąć świeże lokalne wdrożenie, jeśli powiadomienie dotyczy starszej rewizji; zapis lokalny i tak generuje kolejne powiadomienie z nowszą rewizją. **Do potwierdzenia**; alternatywa: odrzucić cykl, jeśli lokalna rewizja zmieniła się w trakcie `preReload`.
- **Instancja z edytorem:** dostaje powiadomienia o własnych zapisach (pomijane po rewizji) i o zapisach innych klientów (np. MCP/CI przez inną instancję) – edytor pokaże powiadomienie o zmianie flow (`runtime-deploy`). W naszej architekturze publikacja idzie przez Admin API edytora – na edytorze można wyłączyć `deploy.reload.watch`.
- **Hook bez prawa weta:** zwrot `false` w innych hookach oznacza zatrzymanie – tu przeładowanie mimo to (spójność klastra ważniejsza). **Pytanie**.
- **Przełączenie projektu** (`projects/index.js:396`) nadal omija mutex – poza zakresem (Projekty i magazyn klastrowy się wykluczają), odnotowane.
- Alternatywa: obserwator wywołujący `api.flows.setFlows({deploymentType:"reload"})` – prostsza, ale brak hooka, diffu, pominięcia własnych zapisów i 503; odrzucona jako niewystarczająca (zostaje jako krok przejściowy).

#### Podzadania
- [ ] Wspólny mutex (wydzielenie z `api/flows.js`) – S
- [ ] `storage/index.js`: wykrycie i opakowanie `watchFlows` – S
- [ ] `flows/index.js`: `reloadFromStorage` (full + flows, bez zapisu, bez `forceStart`) – M
- [ ] `flows/reload.js`: koalescencja, bufor startowy, porównanie rewizji, ponowienia – M
- [ ] `preReload`: `VALID_HOOKS`, limit czasu, `AbortSignal`, payload – M
- [ ] Wpięcie w start/stop runtime i E-02 – S
- [ ] Testy z atrapą magazynu (kryteria zlecenia + uzupełnienia) – L
- [ ] Szablon `settings.js`, kontrakt dla autorów wtyczek, CHANGELOG – S

---

### Z-10 – Wykonanie na jednej instancji (koordynacja)

| Pole | Wartość |
|---|---|
| Etap / typ | 3 / funkcja (nowe publiczne API) |
| Priorytet / ryzyko | P2 / wysokie |
| Ustawienie | typ wtyczki `node-red-coordination`; wybór wtyczki: propozycja `coordination: { plugin: "<id>", options: {...} }` (brak → wtyczka lokalna) – nazwa **do potwierdzenia** (D-02); w węźle `inject` nowa właściwość `singleInstance` (domyślnie `false`) |
| Zależności | E-02 (oddanie przywództwa w `stopping`); punkt startu wspólny z Z-09 (`runtime/lib/index.js:239-247`) |
| Pliki | nowy `@node-red/runtime/lib/coordination/index.js` + `local.js`; `@node-red/runtime/lib/index.js:140` (init przed `redNodes.load()` `:166`), `:239-247` (gotowość przed `startFlows`), `:316-328` (stop); `@node-red/registry/lib/plugins.js:21-57`; `@node-red/registry/lib/util.js:85-104` (`createNodeApi` → `RED.coordination`); `@node-red/nodes/core/common/20-inject.js:75-95` (timery), `:168-177` (`close`), `20-inject.html` + `locales/en-US/common/20-inject.{json,html}`; `node-red/settings.js`; `@node-red/runtime/locales/en-US/runtime.json` |
| Powiązania | K8S-T-013 (**zastąpione** przez Z-10), K8S-T-014 (kolejki – uzupełnienie), ARCHITEKTURA §3.4 („flow singletonowe”) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE.**
- `inject` (`20-inject.js`): `setInterval` (`:78-80`), `cronosjs.scheduleTask` (`:84`, callback otrzymuje `timestamp` – wg typów `cronosjs` `dist-types/index.d.ts:4`; czy jest to czas zaplanowany – **do potwierdzenia**), „raz po starcie” `setTimeout` (`:88-92`), bez „once” `repeaterSetup()` (`:94`); wszystkie wołają `node.emit("input", {})` – brak koordynacji. Przycisk ręczny: `POST /inject/:id` → `node.receive(...)` (`:179-186`) – ta sama ścieżka `on("input")` (`:97`), więc gating w `on("input")` blokowałby przycisk.
- Strefa czasu crona: `scheduleTask(this.crontab, ...)` bez opcji strefy (`:84`) – czas lokalny procesu.
- Rejestr wtyczek: `registerPlugin` (`registry/lib/plugins.js:21-49`) indeksuje po `type`, emituje `registry:plugin-added` (`:48`); `getPluginsByType` (`:55-57`). Wzorzec runtime: `node-red-library-source` (`runtime/lib/library/index.js:35-60` – nasłuch `registry:plugin-added` od `init`).
- Kolejność: `library.init` (`runtime/lib/index.js:140`) → `redNodes.load()` (`:166`, ładuje moduły i wtyczki) → `loadContextsPlugin()` → `started=true; loadFlows().then(startFlows)` (`:239-243`) – koordynacja musi być gotowa przed `startFlows`.
- API węzłów: `createNodeApi` (`registry/lib/util.js`) – obiekt `RED` z `plugins`, `library`, `httpNode`… (`:85-104`); miejsce na `RED.coordination`.
- Wtyczka może zostać doinstalowana z palety w trakcie działania (`registry:plugin-added` po starcie).
- Testy: `registry/lib/plugins_spec.js`, `runtime/lib/plugins_spec.js`, `runtime/lib/library/index_spec.js`, `test/nodes/core/common/20-inject_spec.js`.

#### Specyfikacja
- **Cel:** przy wielu instancjach z tym samym zestawem flow zadania harmonogramu (i inne zadania wybranych węzłów) wykonują się na jednej instancji; przy jednej instancji – jak 5.0.6.
- **Interfejs wtyczki (`type: "node-red-coordination"`):**

```js
/**
 * Rejestracja: RED.plugins.registerPlugin("<id>", { type: "node-red-coordination", ...metody })
 *
 * @typedef {Object} CoordinationPlugin
 * @property {"node-red-coordination"} type
 *
 * @property {(ctx: {instanceId: string, options: object, log: object}) => Promise<void>} start
 *   Łączy z koordynatorem. Wywołane raz, przed startem flow. Odrzucenie = błąd startu runtime.
 * @property {() => Promise<void>} stop
 *   Oddaje przywództwo i zwalnia zajęcia; wywołane w runtime.stop() po zatrzymaniu flow.
 * @property {() => Promise<void>} [resign]
 *   Oddaje przywództwo bez rozłączania; wywołane na początku runtime.stop() (stan "stopping").
 *
 * @property {() => boolean} isLeader
 *   Synchronicznie; false, gdy brak potwierdzonego przywództwa (w tym brak połączenia).
 * @property {(listener: (isLeader: boolean) => void) => (() => void)} onLeaderChange
 *   Zwraca funkcję wyrejestrowania. Wywoływany przy każdej zmianie (także utracie połączenia → false).
 *
 * @property {(key: string, ttlMs: number) => Promise<Claim|null>} claim
 *   Atomowe zajęcie klucza w całym klastrze na ttlMs. null = zajęty przez inną instancję
 *   (lub tę samą wcześniej). Odrzucenie = brak łączności (wywołujący NIE wykonuje zadania).
 *
 * @property {() => {connected: boolean}} [status]
 *
 * @typedef {Object} Claim
 * @property {string} key
 * @property {number} expiresAt               – czas wygaśnięcia wg zegara koordynatora, przeliczony lokalnie
 * @property {() => Promise<void>} release
 * @property {(ttlMs: number) => Promise<boolean>} [renew]  – false = utracone
 */
```
- **API dla węzłów (`RED.coordination`, przez `createNodeApi`):**

```js
/** @returns {boolean} czy ta instancja jest liderem (wtyczka lokalna: zawsze true) */
RED.coordination.isLeader()
/** @param {Node} node - wyrejestrowanie automatyczne przy close węzła
 *  @param {(isLeader:boolean)=>void} listener  @returns {() => void} */
RED.coordination.onLeaderChange(node, listener)
/** @param {string} key - zalecany prefiks: id węzła  @param {number} ttlMs
 *  @returns {Promise<Claim|null>} null = nie wykonuj; odrzucenie = brak łączności, nie wykonuj */
RED.coordination.claim(key, ttlMs)
/** @returns {{plugin: string, local: boolean}} – bez danych konfiguracyjnych wtyczki */
RED.coordination.info()
```
- **Wtyczka lokalna (domyślna, wbudowana):** `isLeader()` → zawsze `true`; `onLeaderChange` – nigdy nie wywołuje (poza `false` przy `stop`); `claim(key, ttl)` – mapa w pamięci: pierwsze zajęcie klucza w ramach TTL → `Claim`, kolejne → `null` (ta sama semantyka co klastrowa). Przy jednej instancji `inject` z `singleInstance` zachowuje się jak bez opcji.
- **Węzeł `inject` – opcja „Uruchamiaj tylko na jednej instancji” (`singleInstance`):**
  - cron: przed `emit` w callbacku `scheduleTask` – `claim("inject:<nodeId>:<czas zaplanowany ISO>", ttl)`; `Claim` → wyzwolenie; `null` → pominięcie; odrzucenie → pominięcie + `node.warn` (zachowanie bezpieczne). Daje „dokładnie raz” na wyzwolenie bez lidera. TTL = min(okres crona, 1 h) – **do potwierdzenia**;
  - interwał i „raz po starcie”: gating przywództwem (`isLeader()` w callbacku timera) – fazy `setInterval` różnią się między instancjami, więc klucz „slotu” `floor(now/interval)` dawałby zdublowane lub pominięte wyzwolenia na granicy slotu (rekomendacja; **pytanie**);
  - przycisk ręczny (`POST /inject/:id`) i wejście z innych węzłów – **bez** koordynacji;
  - status węzła: przy `singleInstance` i braku przywództwa – opcjonalnie `status({fill:"grey", text:"standby"})` – **do potwierdzenia** (zmiana UI).
- **Wejścia:** ustawienie `coordination`, zarejestrowane wtyczki typu `node-red-coordination`, właściwość `singleInstance` węzła.
- **Wyjścia:** `RED.coordination` dla węzłów; log przy starcie (`coordination.using`, z id wtyczki); zdarzenie zmiany przywództwa w logu (`info`).
- **Niezmienniki:**
  - bez ustawienia `coordination` i bez `singleInstance` – zachowanie identyczne z 5.0.6;
  - koordynacja gotowa (`start()` rozwiązane) **przed** `startFlows`; zatrzymywana **po** `stopFlows`;
  - w `stopping` (E-02) wywoływane `resign()` – przywództwo przechodzi na inną instancję przed długim drenażem;
  - brak łączności z koordynatorem ⇒ `isLeader() === false` i `claim` odrzuca ⇒ zadania z koordynacją **nie są wykonywane** (lepiej pominąć niż zdublować);
  - wybór wtyczki wyłącznie jawny (ustawienie) – instalacja modułu z wtyczką nie zmienia zachowania.
- **Przypadki błędów:** `coordination.plugin` wskazuje niezarejestrowaną wtyczkę lub wtyczkę innego typu → błąd startu runtime (`coordination.plugin-not-found`), stan `failed`; brak ustawienia, a zainstalowano ≥ 1 wtyczkę koordynacji → `log.warn` („użyto lokalnej”); dwie wtyczki o tym samym id → błąd rejestru jak dziś (**do potwierdzenia**); wtyczka dodana po starcie → ignorowana do restartu + `log.warn`; `start()` wtyczki odrzuca → błąd startu (bez fallbacku na lokalną – fallback zdublowałby zadania); wyjątek w słuchaczu `onLeaderChange` → `log.warn`.
- **Skutki uboczne:** nowa właściwość w konfiguracji węzła `inject` (eksport flow zawiera `singleInstance` tylko przy `true` – **do potwierdzenia**, by nie zmieniać eksportu istniejących flow).

#### Projekt rozwiązania (minimalny)
1. `runtime/lib/coordination/local.js` – wtyczka lokalna (mapa zajęć z wygasaniem, `isLeader` true).
2. `runtime/lib/coordination/index.js`: `init(runtime)` (nasłuch `registry:plugin-added` jak `library/index.js:35-60`), `start()` – wybór wtyczki wg `settings.coordination.plugin`, `await plugin.start({instanceId, options, log})`; `resign()`, `stop()`; fasada dla węzłów z automatycznym wyrejestrowaniem słuchaczy przy `close` węzła; fabryka `createCoordination(plugin)` (nie singleton – umożliwia test dwóch instancji w jednym procesie).
3. `runtime/lib/index.js`: `coordination.init` obok `library.init` (`:140`); `await coordination.start()` w łańcuchu przed `started = true` / `loadFlows()` (`:239-241`); w `stop()`: `markStopping` → `coordination.resign()` → `stopFlows()` → `coordination.stop()` → `closeContextsPlugin()`.
4. `registry/lib/util.js` `createNodeApi`: `coordination: runtime.coordination.nodeApi(node)`.
5. `20-inject.js`: funkcja `fire(scheduledTime)` w callbackach `:80`, `:84`, `:90` (bez zmian w `on("input")`); `20-inject.html`: pole wyboru w zakładce harmonogramu; teksty en-US (+ `pl` w Z-13).
6. Szablon `settings.js`: blok `coordination` z opisem; CHANGELOG; dokumentacja API dla autorów węzłów (JSDoc + przykład węzła nasłuchu kolejki z gatingiem przywództwem).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Wykonanie na jednej instancji

  Scenariusz: Dwa runtime'y ze wspólną atrapą koordynacji – wyzwolenie raz (kryterium zlecenia)
    Zakładając dwie instancje runtime z tym samym flow i wspólną atrapą koordynacji
    I węzeł inject z cronem co minutę i opcją singleInstance
    Kiedy nadejdzie zaplanowany czas
    Wtedy wiadomość zostanie wysłana dokładnie raz łącznie w obu instancjach

  Scenariusz: Przejęcie po zatrzymaniu lidera (kryterium zlecenia)
    Zakładając dwie instancje, z których A jest liderem, i inject z interwałem 1 s oraz singleInstance
    Kiedy instancja A zostanie zatrzymana
    Wtedy instancja B zostanie liderem
    I kolejne wyzwolenia następują w instancji B

  Scenariusz: Wtyczka lokalna (kryterium zlecenia)
    Zakładając brak ustawienia coordination
    Kiedy flow z injectem singleInstance działa w jednej instancji
    Wtedy wyzwolenia następują tak samo jak bez opcji singleInstance
    I RED.coordination.isLeader() zwraca true

  Scenariusz: Bez opcji zachowanie jak dotąd
    Zakładając dwie instancje ze wspólną atrapą i inject bez singleInstance
    Kiedy nadejdzie zaplanowany czas
    Wtedy wiadomość zostanie wysłana w każdej instancji

  Scenariusz: Przycisk ręczny nie jest blokowany
    Zakładając instancję, która nie jest liderem, i inject z singleInstance
    Kiedy użytkownik kliknie przycisk inject (POST /inject/:id)
    Wtedy wiadomość zostanie wysłana

  Scenariusz: Utrata połączenia z koordynatorem
    Zakładając instancję-lidera i inject z singleInstance
    Kiedy atrapa koordynacji zasygnalizuje utratę połączenia
    Wtedy isLeader() zwraca false, a słuchacze onLeaderChange otrzymają false
    I kolejne wyzwolenia harmonogramu nie są wykonywane
    I w logu pojawi się ostrzeżenie

  Scenariusz: Błąd claim – zachowanie bezpieczne
    Zakładając inject z cronem i singleInstance
    Kiedy claim zostanie odrzucony z powodu braku łączności
    Wtedy wiadomość nie zostanie wysłana, a węzeł zgłosi ostrzeżenie

  Scenariusz: Wygaśnięcie dzierżawy
    Zakładając zajęcie klucza z ttl 100 ms przez instancję A
    Kiedy minie 100 ms bez zwolnienia
    Wtedy instancja B może zająć ten sam klucz

  Scenariusz: Oddanie przywództwa przy zatrzymaniu
    Zakładając instancję-lidera A i drugą instancję B
    Kiedy A otrzyma SIGTERM
    Wtedy A wywoła resign przed zatrzymaniem flow
    I B zostanie liderem, zanim A zakończy zatrzymywanie

  Scenariusz: Koordynacja gotowa przed startem flow
    Zakładając wtyczkę koordynacji, której start trwa 500 ms
    Kiedy runtime się uruchamia
    Wtedy żaden węzeł nie zostanie uruchomiony przed zakończeniem startu wtyczki

  Szablon scenariusza: Błędy konfiguracji
    Zakładając <konfiguracja>
    Kiedy runtime się uruchamia
    Wtedy <wynik>
    Przykłady:
      | konfiguracja                                              | wynik                                           |
      | coordination.plugin wskazuje nieistniejącą wtyczkę        | start kończy się błędem coordination.plugin-not-found |
      | coordination.plugin wskazuje wtyczkę innego typu          | start kończy się błędem                         |
      | brak ustawienia, zainstalowane dwie wtyczki koordynacji   | użyta wtyczka lokalna i ostrzeżenie w logu      |
      | start wybranej wtyczki odrzuca                            | start kończy się błędem, bez fallbacku          |

  Scenariusz: API dla autorów węzłów
    Zakładając węzeł z palety używający RED.coordination.onLeaderChange(node, fn)
    Kiedy węzeł zostanie zamknięty przy wdrożeniu
    Wtedy jego słuchacz zostanie automatycznie wyrejestrowany
```

#### Testy
- Jednostkowe, nowy `test/unit/@node-red/runtime/lib/coordination/index_spec.js`: `uses local plugin by default`, `selects plugin by settings.coordination.plugin`, `fails start for unknown plugin`, `fails start for wrong type`, `warns when plugins installed but not selected`, `no fallback when plugin start rejects`, `ignores plugin added after start with warning`, `resign called on stopping before stopFlows`, `stop called after stopFlows`, `node api auto-unsubscribes on node close`, `listener exception logged`.
- Nowy `test/unit/@node-red/runtime/lib/coordination/local_spec.js`: `always leader`, `claim returns Claim first time and null within ttl`, `claim available after ttl`, `release frees key`.
- `test/unit/@node-red/runtime/lib/index_spec.js`: `coordination started before startFlows`, `coordination stopped after stopFlows`.
- `test/unit/@node-red/registry/lib/util_spec.js`: `createNodeApi exposes RED.coordination`.
- `test/nodes/core/common/20-inject_spec.js` (node-red-node-test-helper, atrapa `RED.coordination`): `singleInstance cron claims nodeId:scheduledTime`, `singleInstance cron skips when claim null`, `singleInstance cron skips and warns on claim rejection`, `singleInstance interval fires only when leader`, `once fires only when leader`, `manual button not gated`, `default (no singleInstance) unchanged`.
- Integracyjny „dwa runtime'y”: nowy `test/unit/@node-red/runtime/lib/coordination/multi_instance_spec.js` – dwie instancje fasady koordynacji ze wspólną atrapą koordynatora w pamięci i dwa węzły `inject` (fake timers): `fires exactly once across instances`, `takeover after leader stop`. Pełny wariant z dwoma procesami (`child_process.fork`, atrapa koordynatora w procesie nadrzędnym przez IPC) – runtime jest singletonem modułów, więc dwa runtime'y w jednym procesie nie są możliwe (**do potwierdzenia**: czy wariant wieloprocesowy wymagany w `npm test`).

#### DoD specyficzne
- [ ] Interfejs wtyczki i `RED.coordination` w JSDoc + dokumentacja dla autorów wtyczek i węzłów (z przykładem gatingu nasłuchu kolejki).
- [ ] Testy obu stanów (`singleInstance` wł./wył.; wtyczka lokalna / atrapa klastrowa).
- [ ] Przycisk ręczny `inject` niegatkowany – test.
- [ ] Teksty UI en-US; brak zmian eksportu flow dla węzłów bez opcji.
- [ ] Wymóg wspólnej strefy czasowej instancji opisany w dokumentacji opcji.

#### Ryzyka i alternatywy
- **Nowe publiczne API** (typ wtyczki, `RED.coordination`) – zobowiązanie utrzymaniowe; projekt minimalny (lider + zajęcie klucza), bez kolejek i blokad rozproszonych ogólnego przeznaczenia.
- **Rozjazd zegarów:** klucz crona oparty na czasie zaplanowanym jest identyczny na instancjach przy tej samej strefie czasowej; różnica zegarów przesuwa tylko moment wyzwolenia, TTL musi przekraczać maksymalny rozjazd. Różne strefy czasowe instancji → różne klucze → zdublowanie (dokumentacja). Wygaśnięcie dzierżawy liczy koordynator, nie lokalny zegar.
- **Zmiana lidera w trakcie wykonania:** dla `inject` wyzwolenie jest natychmiastowe (bez skutku); dla długich zadań węzłów z palety – autor musi reagować na `onLeaderChange(false)` lub `renew()` → `false`. Okno „dwóch liderów” przy podziale sieci zależy od implementacji wtyczki (fencing poza zakresem) – dokumentacja.
- **Interwał/„raz po starcie” przez przywództwo** vs claim slotu – rekomendacja przywództwo (**pytanie**). „Raz po starcie” przy restarcie lidera wyzwoli się ponownie – zgodne z semantyką „po starcie”.
- **Wybór jawny vs automatyczny:** automatyczne użycie jedynej zainstalowanej wtyczki byłoby wygodne, ale zmienia zachowanie po instalacji modułu – rekomendacja jawne ustawienie (**pytanie**).
- **Kolejki (K8S-T-014)** – Z-10 nie zastępuje kolejek: odbiorcy kolejek z rozdziałem pracy (SKIP LOCKED, grupy konsumentów Redis Streams) nie potrzebują przywództwa; dla subskrypcji bez rozdziału (np. MQTT bez współdzielonych subskrypcji) węzły mogą użyć `RED.coordination.onLeaderChange`. Węzły core poza `inject` (np. `mqtt in`) – poza zakresem (**pytanie**).
- Alternatywa: osobny Deployment z 1 repliką dla flow singletonowych (K8S-T-013) – zostaje jako obejście operacyjne, ale wymaga podziału flow.

#### Podzadania
- [ ] Wtyczka lokalna + testy – S
- [ ] Moduł koordynacji (wybór, start/stop/resign, fasada węzłów) – M
- [ ] Kolejność startu/zatrzymania w `runtime/lib/index.js` – S
- [ ] `RED.coordination` w `createNodeApi` – S
- [ ] `inject`: `singleInstance` (cron – claim, interwał/once – lider), UI, teksty – M
- [ ] Test dwóch instancji (atrapa koordynatora; opcjonalnie wieloprocesowy) – M/L
- [ ] Dokumentacja API, szablon `settings.js`, CHANGELOG – S

---

### Z-11 – Praca z katalogiem użytkownika tylko do odczytu

| Pole | Wartość |
|---|---|
| Etap / typ | 3 / funkcja |
| Priorytet / ryzyko | P2 / średnie |
| Ustawienie | `readOnlyUserDir: false` (bez zmian względem zlecenia) |
| Zależności | – (koordynacja z Z-03 – ujednolicone ustawienia uploadu) |
| Pliki | `node-red/red.js:121-157` (wybór/kopiowanie `settings.js`, `:151`); `@node-red/runtime/lib/index.js:135-248` (komunikaty startu, `:167-215,:268` autoinstalacja); `@node-red/registry/lib/installer.js:221,239,274,361,426-485,516,544,575-600`; `@node-red/registry/lib/externalModules.js:35,43,72-73,228-277`; `@node-red/runtime/lib/nodes/context/localfilesystem.js:70-95` (`getBasePath`), `:145-146,202,231,387,412,415`; `@node-red/runtime/lib/nodes/context/index.js:80-180`; `@node-red/runtime/lib/storage/localfilesystem/index.js:36-71`, `settings.js:75,83,117,127`, `sessions.js:47-50`, `library.js:148-172`, `projects/index.js:129-130,607,626,651,662`, `util.js:89-118`; `node-red/settings.js`; `@node-red/runtime/locales/en-US/runtime.json` |
| Powiązania | K8S-T-005 (obraz, system plików tylko do odczytu), K8S-A-002 (węzły używające `fs`), K8S-T-004 |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE** – 16 miejsc zapisu (tabela poniżej, z WERYFIKACJA Z-11).

| # | Miejsce | Co | Kiedy | Wyłączenie dziś | Przy `readOnlyUserDir: true` (propozycja) |
|---|---|---|---|---|---|
| 1 | `node-red/red.js:151` | kopia `settings.js` do `~/.node-red` | start CLI bez pliku ustawień – niezależnie od magazynu | `--settings` / `--userDir` z settings.js | **nie da się sterować z `settings.js`** (kopiowanie przed wczytaniem ustawień); błąd kopiowania → użycie domyślnego pliku + ostrzeżenie zamiast awarii; zalecenie `--settings` |
| 2 | `registry/lib/installer.js:443` | `<userDir>/nodes/<name>-<ver>.tgz` | upload | `externalModules.palette.allowUpload:false` | wyłączone (`upload_not_allowed`) |
| 3 | `installer.js:477-479` | `os.tmpdir()/nr-tarball-*` | upload | jw. | wyłączone razem z uploadem |
| 4 | `installer.js:470` | usunięcie starego tgz | aktualizacja z uploadu | jw. | wyłączone |
| 5 | `installer.js:239` | `npm install --save` | instalacja/aktualizacja z palety | `palette.allowInstall/allowUpdate:false`, listy, `preInstall`→`false` | wyłączone (`install_not_allowed`, `update_not_allowed`) |
| 6 | `installer.js:274,544` | `npm remove` | wycofanie, odinstalowanie | `palette.allowInstall:false` | wyłączone |
| 7 | `runtime/lib/index.js:167-215,268` | instalacja brakujących modułów | start / ponowienia | `externalModules.autoInstall` | wyłączone (ignorowane z ostrzeżeniem) |
| 8 | `registry/lib/externalModules.js:228,232` | `ensureDir(userDir)`, `package.json` | pierwszy moduł węzła Function | `externalModules.modules.allowInstall:false` | wyłączone; moduły już obecne w obrazie nadal używalne |
| 9 | `externalModules.js:277` | `npm install` | `libs` węzła Function | jw. | wyłączone |
| 10 | `runtime/lib/nodes/context/localfilesystem.js:145-146,202,231,387,412,415` | `context/**.json` | zapis/flush kontekstu | tylko gdy `contextStorage` = localfilesystem | gdy katalog kontekstu leży w katalogu chronionym → błąd startu (propozycja – pytanie); `dir` poza nim – dozwolone |
| 11 | `storage/localfilesystem/index.js:50,69` | `node_modules`, `package.json` | init magazynu | własny magazyn / `readOnly` | pominięte (jak `readOnly`) |
| 12 | `storage/localfilesystem/projects/index.js:626,662` (`util.js:89-118`) | flow, poświadczenia, `.backup` | deploy | jw. | wdrożenie odrzucone z czytelnym błędem (propozycja – pytanie; `readOnly` dziś pomija zapis po cichu) |
| 13 | `storage/localfilesystem/settings.js:75,83` | `.config.*.json` | zapis ustawień (także `instanceId`, `_credentialSecret`, rejestr węzłów, telemetria) | jw. | pominięte, `log.warn` raz przy starcie |
| 14 | `storage/localfilesystem/sessions.js:50` | `.sessions.json` | logowanie | jw. | pominięte (sesje tylko w pamięci) |
| 15 | `storage/localfilesystem/library.js:149,171-172` | `lib/**` | biblioteka | jw. | zapis do biblioteki lokalnej odrzucony z błędem |
| 16 | `storage/localfilesystem/projects/index.js:130` | `projects/` (git) | Projekty włączone | `editorTheme.projects.enabled`, własny magazyn | Projekty wyłączone z komunikatem przy starcie |

- **Katalog użytkownika może być nieustawiony** przy własnym magazynie: ustawia go tylko `localfilesystem.init` (`storage/localfilesystem/index.js:36-46`); instalatory i moduły zewnętrzne piszą wtedy do `settings.userDir || process.env.NODE_RED_HOME || "."` (`installer.js:221,361,440,470,516`, `externalModules.js:35,43`), a kontekst `localfilesystem` do `NODE_RED_HOME`/`HOMEPATH`/`~/.node-red` (`context/localfilesystem.js:70-95`). `NODE_RED_HOME` CLI ustawia na katalog pakietu (`node-red/red.js:121`) – zapis do katalogu instalacji.
- **CLI** kopiuje `settings.js` przed wczytaniem jakichkolwiek ustawień (`node-red/red.js:121-157`, wczytanie `:160`) – ani `readOnlyUserDir`, ani `-D readOnlyUserDir=true` nie mogą tego zablokować. Kopiowanie zachodzi tylko, gdy `~/.node-red/settings.js` nie istnieje i domyślny plik nie był modyfikowany; błąd `fs.copySync` na systemie plików tylko do odczytu kończy start wyjątkiem (wniosek z kodu, nie uruchamiano).
- **Istniejące `settings.readOnly`** (nieudokumentowane w szablonie `settings.js` – tam `readOnly` występuje tylko w opisie `ui`): wyłącznie magazyn plikowy – pomija `ensureDir`/`package.json` (`index.js:49,59`), migrację i zapis ustawień (`settings.js:117,127`), sesje (`sessions.js:47`), bibliotekę (`library.js:148,155`), flow i poświadczenia **po cichu** (`projects/index.js:607,651` – `return` bez błędu: wdrożenie „udaje się”, zmiany giną przy restarcie), git w Projektach (`projects/index.js:129`); log `settings.readonly-mode` (`runtime/lib/index.js:230`). Nie obejmuje instalatorów (#2–#9) ani kontekstu (#10).
- Już istnieją: `externalModules.palette.allowInstall/allowUpload/allowUpdate`, `externalModules.modules.allowInstall`, `externalModules.autoInstall`, wymienny magazyn kontekstu, `nodeCloseTimeout`; kody błędów `install_not_allowed`, `update_not_allowed` (`installer.js:186,210`), `module_not_allowed` (`externalModules.js:91-123`).

#### Specyfikacja
- **Cel:** jednoznaczna gwarancja, że przy `readOnlyUserDir: true` runtime nie próbuje zapisu do katalogu użytkownika (ani do katalogów zastępczych), a funkcje wymagające zapisu są wyłączone z czytelnym komunikatem przy starcie; dokumentacja wszystkich miejsc zapisu.
- **Wejścia:** `readOnlyUserDir` (domyślnie `false`); `userDir` (może być nieustawiony); ustawienia `externalModules`, `contextStorage`, `editorTheme.projects`, `readOnly`; wybrany magazyn.
- **Katalogi chronione:** `settings.userDir`, a gdy nieustawiony – katalogi zastępcze używane dziś przez runtime: `NODE_RED_HOME`, katalog bieżący (`.`), `~/.node-red` (jak `HOMEPATH`/`HOME`). Ścieżki jawnie skonfigurowane poza nimi (`contextStorage.*.config.dir`, bezwzględny `flowFile` – **do potwierdzenia**) nie są chronione. `os.tmpdir()` – nie jest chroniony, ale jedyny zapis tam (#3) jest wyłączony razem z uploadem.
- **Wyjścia:**
  - przy starcie jeden blok logu `readonly-userdir.enabled` z listą wyłączonych funkcji (instalacja/aktualizacja/usuwanie/upload z palety, autoinstalacja, instalacja modułów węzła Function, Projekty, zapis ustawień/sesji/biblioteki w magazynie plikowym, wdrożenie przy magazynie plikowym);
  - efektywne wartości: `externalModules.palette.allowInstall=false`, `allowUpload=false`, `allowUpdate=false`, `externalModules.modules.allowInstall=false`, `externalModules.autoInstall=false` (nadpisanie z ostrzeżeniem, jeśli ustawiono `true`), `editorTheme.projects.enabled=false`;
  - edytor: paleta bez instalacji (jak przy `allowInstall:false` – istniejące zachowanie UI);
  - próba operacji w trakcie działania (Admin API) → istniejące kody `install_not_allowed`/`update_not_allowed`/`module_not_allowed`, dla zapisu biblioteki i wdrożenia przy magazynie plikowym – nowy kod `read_only_user_dir` (400).
- **Niezmienniki:**
  - przy `true`: zero wywołań zapisu (`writeFile`, `outputFile`, `ensureDir`, `copy`, `rename`, `remove`, `npm install/remove`) w katalogach chronionych – w trakcie startu, wdrożenia, logowania, zapisu ustawień użytkownika i biblioteki;
  - przy `false`: zachowanie identyczne z 5.0.7 (w tym `readOnly`);
  - własny magazyn (np. w bazie) – wdrożenie, ustawienia, sesje działają normalnie (idą do magazynu);
  - flagi wyłączające są tylko zawężane (`readOnlyUserDir` nigdy nie włącza funkcji wyłączonej przez inne ustawienie).
- **Przypadki błędów:**
  - `contextStorage` z modułem `localfilesystem`, którego katalog leży w katalogu chronionym → błąd startu z komunikatem wskazującym `contextStorage.<nazwa>.config.dir` (propozycja; alternatywa: wyłączenie magazynu i przełączenie na `memory` z ostrzeżeniem – **pytanie**);
  - magazyn plikowy (`localfilesystem`) + `readOnlyUserDir` → start dozwolony (flow z obrazu), wdrożenie odrzucone 400 `read_only_user_dir` zamiast cichego pominięcia jak `readOnly` (**pytanie**);
  - `readOnlyUserDir: true` + `editorTheme.projects.enabled: true` → Projekty wyłączone + ostrzeżenie;
  - CLI: błąd kopiowania `settings.js` (#1) → `console.warn` i użycie domyślnego `settings.js` z pakietu (zamiast wyjątku) – zmiana tylko w ścieżce błędu.
- **Skutki uboczne:** sesje tylko w pamięci przy magazynie plikowym (wylogowanie po restarcie); `instanceId` i `_credentialSecret` generowane przy starcie nie są utrwalane w magazynie plikowym (poświadczenia zaszyfrowane wygenerowanym kluczem nie zostaną zapisane – wdrożenie i tak odrzucone) – dokumentacja.

#### Projekt rozwiązania (minimalny)
1. Nowy moduł `@node-red/util/lib/readOnlyDir.js` (lub w `runtime/lib/settings.js` – **do potwierdzenia**): `isEnabled(settings)`, `protectedDirs(settings)`, `isProtected(path)`, `assertWritable(path, feature)` → błąd `read_only_user_dir`.
2. `runtime/lib/index.js` `start()`: przed `storage.init` – wyliczenie efektywnych flag `externalModules.*`, `editorTheme.projects.enabled`, log bloku `readonly-userdir.enabled`; walidacja `contextStorage` (przed `loadContextsPlugin`).
3. Magazyn plikowy: `readOnlyUserDir` traktowany jak `readOnly` dla #11, #13, #14 (pominięcie); #12 i #15 – odrzucenie `read_only_user_dir` (nie ciche pominięcie).
4. `registry/lib/installer.js`, `externalModules.js`: kontrola `assertWritable` na wejściu `installModule`, `installTarball`, `uninstallModule`, `ensureModuleDir`/`installModules` (obrona w głąb – niezależnie od flag z pkt 2).
5. `context/localfilesystem.js`: kontrola w `open()` (przed `ensureDir`) – błąd z nazwą magazynu.
6. `node-red/red.js:151`: `try/catch` wokół `fs.copySync` z fallbackiem na domyślny plik i ostrzeżeniem; w szablonie i dokumentacji – zalecenie `--settings` dla obrazów.
7. Dokumentacja: tabela 16 zapisów (jak wyżej) w szablonie `settings.js` (skrót) i w dokumentacji pakietu; opis relacji `readOnly` ↔ `readOnlyUserDir`; uwaga, że węzły z palety (np. `file`) mogą pisać dowolnie – poza zakresem (K8S-A-002).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Katalog użytkownika tylko do odczytu

  Scenariusz: Start i wdrożenie z katalogiem bez prawa zapisu i atrapą magazynu (kryterium zlecenia)
    Zakładając readOnlyUserDir = true, katalog użytkownika z uprawnieniami tylko do odczytu (chmod 0555) i atrapę magazynu
    Kiedy runtime się uruchomi i wykonam wdrożenie przez POST /flows
    Wtedy start i wdrożenie zakończą się powodzeniem
    I flow zostaną zapisane w atrapie magazynu
    I nie wystąpi żadna próba zapisu w katalogu użytkownika (atrapa fs nie odnotuje wywołań zapisu)

  Scenariusz: Lista zapisów w dokumentacji (kryterium zlecenia)
    Zakładając dokumentację pakietu
    Wtedy zawiera ona wszystkie 16 miejsc zapisu z warunkiem wystąpienia i sposobem wyłączenia
    I test sprawdza, że każde miejsce z listy jest objęte kontrolą readOnlyUserDir lub opisane jako niezależne od ustawień

  Scenariusz: Komunikat przy starcie
    Zakładając readOnlyUserDir = true
    Kiedy runtime się uruchomi
    Wtedy w logu pojawi się jeden blok z listą wyłączonych funkcji

  Szablon scenariusza: Funkcje wymagające zapisu są wyłączone
    Zakładając readOnlyUserDir = true
    Kiedy wykonam <operacja>
    Wtedy odpowiedź zawiera kod "<kod>"
    I nie wystąpi próba zapisu na dysk
    Przykłady:
      | operacja                                | kod                 |
      | instalację modułu z palety              | install_not_allowed |
      | aktualizację modułu z palety            | update_not_allowed  |
      | upload paczki .tgz                      | upload_not_allowed  |
      | usunięcie modułu                        | install_not_allowed |
      | wdrożenie Function z nowym modułem libs | module_not_allowed  |

  Scenariusz: Ustawienia sprzeczne są nadpisywane
    Zakładając readOnlyUserDir = true i externalModules.palette.allowInstall = true
    Kiedy runtime się uruchomi
    Wtedy instalacja z palety jest wyłączona
    I w logu pojawi się ostrzeżenie o nadpisaniu ustawienia

  Scenariusz: Autoinstalacja brakujących modułów
    Zakładając readOnlyUserDir = true, externalModules.autoInstall = true i flow z brakującym modułem
    Kiedy runtime się uruchomi
    Wtedy nie zostanie uruchomione npm install
    I stan instancji będzie "failed" z powodem "missing-types"

  Scenariusz: userDir nieustawiony przy własnym magazynie
    Zakładając readOnlyUserDir = true, atrapę magazynu i brak settings.userDir
    Kiedy wykonam start, wdrożenie i próbę instalacji modułu
    Wtedy nie wystąpi próba zapisu w NODE_RED_HOME, w katalogu bieżącym ani w ~/.node-red

  Scenariusz: Kontekst w katalogu użytkownika
    Zakładając readOnlyUserDir = true i contextStorage z modułem localfilesystem bez opcji dir
    Kiedy runtime się uruchamia
    Wtedy start kończy się błędem wskazującym magazyn kontekstu

  Scenariusz: Kontekst poza katalogiem użytkownika
    Zakładając readOnlyUserDir = true i contextStorage localfilesystem z dir na zapisywalnym wolumenie
    Kiedy runtime zapisze kontekst
    Wtedy zapis trafi do wskazanego katalogu

  Scenariusz: Magazyn plikowy
    Zakładając readOnlyUserDir = true i domyślny magazyn plikowy z flow w katalogu tylko do odczytu
    Kiedy runtime się uruchomi
    Wtedy flow wystartują
    Kiedy wykonam wdrożenie
    Wtedy odpowiedź ma status 400 i kod "read_only_user_dir"
    I działające flow pozostaną bez zmian

  Scenariusz: Projekty
    Zakładając readOnlyUserDir = true i editorTheme.projects.enabled = true
    Kiedy runtime się uruchomi
    Wtedy Projekty są wyłączone, a w logu jest ostrzeżenie

  Scenariusz: CLI na systemie plików tylko do odczytu
    Zakładając brak ~/.node-red/settings.js i katalog domowy tylko do odczytu
    Kiedy uruchomię node-red bez --settings
    Wtedy proces nie zakończy się wyjątkiem
    I użyty zostanie domyślny plik ustawień z ostrzeżeniem

  Scenariusz: Ustawienie wyłączone
    Zakładając readOnlyUserDir = false
    Kiedy wykonam start, wdrożenie, instalację modułu i zapis kontekstu
    Wtedy zachowanie i zapisy są takie jak w wersji bazowej
```

#### Testy
- Jednostkowe, nowy `test/unit/@node-red/util/lib/readOnlyDir_spec.js` (lub odpowiednik w runtime): `protectedDirs uses userDir`, `protectedDirs falls back to NODE_RED_HOME, cwd and ~/.node-red when userDir unset`, `isProtected for nested paths`, `assertWritable throws read_only_user_dir`.
- `test/unit/@node-red/registry/lib/installer_spec.js`: `installModule rejected when readOnlyUserDir`, `installTarball rejected`, `uninstallModule rejected`, `no exec.run when readOnlyUserDir` (stub `exec.run`, `fs`).
- `test/unit/@node-red/registry/lib/externalModules_spec.js`: `ensureModuleDir not called`, `install libs rejected with module_not_allowed`.
- `test/unit/@node-red/runtime/lib/nodes/context/localfilesystem_spec.js` / `context/index_spec.js`: `open rejects when dir in protected dir`, `dir outside protected dir allowed`.
- `test/unit/@node-red/runtime/lib/storage/localfilesystem/index_spec.js`, `settings_spec.js`, `sessions_spec.js`, `library_spec.js`, `projects/index_spec.js`: `no ensureDir/package.json when readOnlyUserDir`, `saveSettings skipped`, `saveSessions skipped`, `saveLibraryEntry rejected read_only_user_dir`, `saveFlows rejected read_only_user_dir`.
- `test/unit/@node-red/runtime/lib/index_spec.js`: `logs disabled features block`, `overrides allowInstall/autoInstall with warning`, `disables projects`.
- Integracyjny, nowy `test/unit/@node-red/runtime/lib/readonly_userdir_spec.js`: (a) rzeczywisty katalog tymczasowy z `chmod 0555` (pominięcie testu z uzasadnieniem, gdy proces działa jako root – `chmod` nie blokuje roota) + atrapa magazynu: start, wdrożenie, logowanie, zapis ustawień użytkownika; (b) atrapa `fs`/`fs-extra` (sinon) rejestrująca wywołania zapisu – asercja „zero zapisów w katalogach chronionych”, wariant z nieustawionym `userDir`.
- CLI: test procesu potomnego z `HOME` tylko do odczytu (`node-red/red.js`) – **do potwierdzenia** (brak testów CLI w projekcie).

#### DoD specyficzne
- [ ] Tabela 16 zapisów w dokumentacji pakietu i skrót w szablonie `settings.js`.
- [ ] Test z rzeczywistym katalogiem bez prawa zapisu (z obsługą uruchomienia jako root) i test z atrapą `fs`.
- [ ] Opis relacji `readOnly` ↔ `readOnlyUserDir` (i czy `readOnly` ma zostać udokumentowane – pytanie).
- [ ] Testy obu stanów ustawienia dla każdego z miejsc #2–#16.

#### Ryzyka i alternatywy
- **CLI (#1) poza zasięgiem ustawienia** – rozwiązanie częściowe (fallback w ścieżce błędu + zalecenie `--settings`); alternatywa: zmienna środowiskowa `NODE_RED_READ_ONLY_USER_DIR` czytana przed wyborem pliku – **pytanie**.
- **Kontekst `localfilesystem`:** błąd startu (głośny, bez utraty danych po cichu) vs przełączenie na `memory` z ostrzeżeniem (instancja startuje, ale dane kontekstu znikają przy restarcie) – rekomendacja błąd startu. **Pytanie**.
- **Wdrożenie przy magazynie plikowym:** odrzucenie (400) różni się od istniejącego cichego pominięcia przy `readOnly` – świadoma rozbieżność; alternatywa: zachowanie jak `readOnly`. **Pytanie**.
- **Relacja z `readOnly`:** `readOnly` = „magazyn plikowy nie zapisuje” (nieudokumentowane), `readOnlyUserDir` = „runtime nie pisze do katalogu użytkownika w ogóle” (szersze, obejmuje instalatory i kontekst). Rekomendacja: nie łączyć; `readOnlyUserDir` implikuje zachowanie `readOnly` dla zapisów pomijanych (#11, #13, #14).
- **Wykrywanie przez kontrolę ścieżek vs flagi:** sama kontrola flag może przeoczyć przyszłe miejsca zapisu; obrona w głąb (`assertWritable`) w instalatorach i kontekście + test z atrapą `fs` zmniejsza ryzyko. Moduły z palety i węzły (`file`, `watch` itp.) nie są objęte (K8S-A-002).
- Test `chmod` nie działa jako root (typowe w kontenerach CI) – test pominięty z uzasadnieniem, atrapa `fs` jako dowód podstawowy.

#### Podzadania
- [ ] Moduł katalogów chronionych + testy – S
- [ ] Efektywne flagi i komunikat startu – S
- [ ] Instalatory i moduły zewnętrzne (obrona w głąb) – M
- [ ] Magazyn plikowy (pomijanie/odrzucanie) – M
- [ ] Kontekst `localfilesystem` – S
- [ ] CLI: fallback przy kopiowaniu `settings.js` – S
- [ ] Testy integracyjne (`chmod` + atrapa `fs`, `userDir` nieustawiony) – M
- [ ] Dokumentacja (tabela zapisów), szablon `settings.js`, CHANGELOG – S

---

## Pytania do Zamawiającego (etap 3)

1. **E-02 – nazwy:** czy akceptują Państwo nazwy stanów (`starting, ready, deploying, reloading, idle, failed, stopping, stopped`) i zdarzenia `instance:state` (D-02)? Czy rozszerzyć `RED.stop()` o powód zatrzymania (sygnał)?
2. **E-02 – `setState` w mutexie:** zgoda na objęcie API start/stop flow (`runtimeState`) wspólną blokadą wdrożeń (usunięcie wyścigu, zmiana kolejkowania)?
3. **E-02/Z-08 – safe mode i flow zatrzymane świadomie:** stan `idle` i `/ready` 503 (propozycja) – czy dla instancji edycyjnej (Z-15) `/ready` ma oznaczać „edytor gotowy” (200 mimo braku flow)?
4. **Z-08 – treść odpowiedzi:** czy nazwa stanu w treści `503` jest dopuszczalna (nie jest konfiguracją), czy treść ma być stała?
5. **Z-08 – drenaż przy SIGTERM:** dziś flow są zatrzymywane od razu po sygnale. Wystarczy `preStop` w orkiestratorze (rekomendacja), czy dodać `health.shutdownDelay` albo hook „przed zatrzymaniem” (jak `preReload`)? Czy potrzebny globalny limit czasu zatrzymania?
6. **Z-08 – serwer HTTP przy SIGTERM (D-05):** zamykać serwer dla nowych połączeń tylko przy włączonych sondach na osobnym porcie (propozycja), czy zawsze (zmiana zachowania 5.0.6)? Czy potrzebne `health.host`?
7. **Z-09 – jednoczesne 503 na wszystkich workerach:** powiadomienie trafia do wszystkich instancji naraz; przy 503 przez cały drenaż (do 20 min) Deployment traci całą przepustowość. Które rozwiązanie: (A) 503 tylko w oknie zatrzymania/startu, (B) przeładowanie po kolei przez koordynację Z-10, (C) losowe opóźnienie, (D) wydania niezmienne na produkcji?
8. **Z-09 – przeładowanie różnicowe:** zgoda na `deploy.reload.type: "full" | "flows"` z domyślnym `"full"` (zalecane `"flows"` dla workerów, by nie przerywać rozmów w niezmienionych flow)?
9. **Z-09 – `preReload` bez weta:** błąd/`false`/limit czasu → przeładowanie mimo to (propozycja), czy możliwość anulowania (instancja zostaje na starej konfiguracji)? Wartość domyślna limitu: 20 min (propozycja) czy krótsza z zaleceniem w dokumentacji?
10. **Z-09 – błąd odczytu magazynu:** instancja dalej `ready` na starej konfiguracji z ponowieniami (propozycja), czy po N próbach `failed` (503)? Czy błąd `watchFlows` przy rejestracji ma blokować start?
11. **Z-09 – nazwa i kształt ustawień** `deploy.reload: { watch, type, preReloadTimeout, retry }` (D-02); czy powiadomienie z rewizją równą lokalnemu, świeżemu wdrożeniu w trakcie drenażu ma być rozstrzygane na korzyść magazynu?
12. **Z-10 – semantyka `inject`:** cron przez zajęcie klucza `<nodeId>:<czas zaplanowany>`, interwał i „raz po starcie” przez przywództwo (rekomendacja) – akceptacja? Czy status „standby” w węźle jest pożądany?
13. **Z-10 – wybór wtyczki:** tylko jawnie (`coordination.plugin`, rekomendacja) czy automatycznie jedyna zainstalowana? Czy inne węzły core (np. `mqtt in`) mają dostać opcję w tym pakiecie?
14. **Z-10 – test dwóch runtime'ów:** czy wystarczy test dwóch instancji fasady koordynacji w jednym procesie, czy wymagany wariant wieloprocesowy w `npm test`?
15. **Z-11 – kontekst `localfilesystem` w katalogu użytkownika:** błąd startu (rekomendacja) czy przełączenie na `memory` z ostrzeżeniem?
16. **Z-11 – wdrożenie przy magazynie plikowym:** odrzucenie 400 `read_only_user_dir` (rekomendacja) czy ciche pominięcie jak istniejące `readOnly`? Czy `readOnly` ma zostać udokumentowane w szablonie?
17. **Z-11 – CLI:** czy dodać zmienną środowiskową (np. `NODE_RED_READ_ONLY_USER_DIR`) działającą przed wyborem pliku ustawień, czy wystarczy fallback w ścieżce błędu i zalecenie `--settings`? Czy bezwzględny `flowFile` poza katalogiem użytkownika ma być chroniony?
