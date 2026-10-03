# Backlog – etap 3 (E-02, Z-08–Z-11)

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.
> Zasady, szablon karty i wspólne DoD: [../ZASADY.md](../ZASADY.md). Fakty z kodu: [../WERYFIKACJA.md](../WERYFIKACJA.md).
> Ścieżki kodu względem `packages/node_modules/`, ścieżki testów względem katalogu repozytorium. Baza: 5.0.7 (ZASADY §2.2).
> Oznaczenie „do potwierdzenia” = nie sprawdzono w kodzie albo wymaga decyzji Zamawiającego.
> Kontekst wdrożenia: wiele instancji (edytor + workery), on-premise; długie sesje (rozmowy ~3–4 min, do ~15 min, bez twardych limitów) → drenaż do 20 min.
> Implementacje zewnętrznych wtyczek (magazyn z `watchFlows`, wtyczka koordynacji) są **poza zakresem zlecenia i poza tym repozytorium** – w zlecenie wchodzą punkty rozszerzeń w rdzeniu i domyślna wtyczka lokalna.

## Podsumowanie

| ID | Tytuł | Typ | Priorytet | Ryzyko | Zależności | Szacunek |
|---|---|---|---|---|---|---|
| [E-02](#e-02--model-stanu-instancji) | Model stanu instancji | przerobienie (nowy moduł wewnętrzny, bez zmiany zachowania) | P1 | średnie | E-01 (wynik `start()` z błędami, krok 4/8 potoku); warunek Z-08, Z-09; wykorzystywany opcjonalnie przez P-01 | M |
| [Z-08](#z-08--sondy-zdrowia-live--ready) | Sondy zdrowia `/live` i `/ready` | funkcja + poprawka błędu (D-05: serwer HTTP przy SIGTERM) | P1 | średnie | E-02, E-01 (stany `reloadPending`/`reloading` – punkt integracji wykorzystywany przez Z-09) | M |
| [Z-09](#z-09--przeładowanie-flow-po-zmianie-w-magazynie) | Przeładowanie flow po zmianie w magazynie (`watchFlows`, `preReload`) | funkcja | P1 | wysokie | E-01, E-02, Z-08 (`/ready` – punkt integracji), Z-06 (`VALID_HOOKS`, wzorzec limitu czasu, `postDeploy` – punkt integracji), Z-10 (`deploy.reload.concurrency`), P-01 (błędy startu) | L |
| [Z-10](#z-10--wykonanie-na-jednej-instancji-koordynacja) | Wykonanie na jednej instancji (koordynacja) | funkcja (nowe publiczne API) | P2 | wysokie | E-02 (stan `stopping` – oddanie przywództwa) | L |
| [Z-11](#z-11--praca-z-katalogiem-użytkownika-tylko-do-odczytu) | Praca z katalogiem użytkownika tylko do odczytu | funkcja | P2 | średnie | – | M |

Kolejność realizacji (ANALIZA §6.2, tor A – sekwencyjnie): E-02 (etap 0, specyfikacja + testy; implementacja razem z Z-08) → **Z-08** → **Z-10** → **Z-09** (po Z-06, Z-08 i Z-10 – limit równoległości przeładowań) → **Z-11**. Zależności jednokierunkowe: Z-06 i Z-08 udostępniają punkty integracji, z których korzysta Z-09 (nie odwrotnie).

---

### E-02 – Model stanu instancji

| Pole | Wartość |
|---|---|
| Etap / typ | 0→3 / przerobienie (specyfikacja w etapie 0, implementacja w gałęzi Z-08) |
| Priorytet / ryzyko | P1 / średnie |
| Ustawienie | brak (moduł wewnętrzny, zawsze aktywny, pasywny – nie zmienia zachowania) |
| Zależności | E-01 (`start()` zwraca `{errors}`, kroki 4 i 8 potoku); warunek Z-08, Z-09; wykorzystywany opcjonalnie przez P-01, przez Z-10 (`stopping`) i Z-15 (`loaded`) |
| Pliki | nowy `@node-red/runtime/lib/state.js`; `@node-red/runtime/lib/index.js:135-248` (`start`), `:239-245` (start flow, pusty `.catch` `:245`), `:316-328` (`stop`), obiekt `runtime` (`:331+`); `@node-red/runtime/lib/flows/index.js:57-66` (`type-registered` → późny start), `:118-242` (`setFlows`), `:272-432` (`start`), `:434-515` (`stop`), `:873` (`state()`); `@node-red/runtime/lib/api/flows.js:66-100` (mutex, `reload`), `:283-330` (`setState`) |
| Powiązania | Z-08 (sondy), drenaż do 20 min |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE** (brak jednego, wiarygodnego stanu instancji).
- Istnieje tylko stan flow: zmienna `state` w `flows/index.js` (`'start' | 'stop' | 'safe'`, ustawiana w `start()` `:279,:324,:336` i `stop()` `:458`), odczyt `flows.state()` (`:873`) i flaga `started` (`:872`); używa ich API `getState/setState` (`api/flows.js:267-330`).
- `RED.start()` kończy się **przed** startem flow: `runtime/lib/index.js:240-243` ustawia `started = true`, wywołuje `loadFlows().then(startFlows)` **bez** `await`; błąd odczytu flow jest połykany (`.catch(function(err) {})`, `:245`) – instancja „wisi” bez sygnału błędu. `.catch` obejmuje tylko `loadFlows()` (i synchroniczny wyjątek w `then`): obietnica `redNodes.startFlows()` nie jest zwracana z `then`, więc jej odrzucenie nie jest przechwytywane w ogóle. Serwer HTTP zaczyna nasłuch w `node-red/red.js:505` po `RED.start()`, czyli również przed startem flow.
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
| `init` | stan początkowy – od załadowania modułu do wywołania `runtime.start()` (R-23) | 503 (jak `starting`) | 200 |
| `starting` | od `runtime.start()` do zakończenia pierwszego startu flow | 503 | 200 |
| `ready` | flow uruchomione, ostatnia operacja bez błędów | **200** | 200 |
| `deploying` | wdrożenie (E-01 krok 4 → krok 8) | 503 | 200 |
| `reloadPending` | przeładowanie z magazynu (Z-09) oczekujące – **bez blokady i bez tokenu operacji** (ZASADY §2.3 B kroki 2–3): oczekiwanie na slot koordynacji (`deploy.reload.concurrency`), potem drenaż w `preReload` (flaga `draining`) | jak stan poprzedni (`previous`) do rozpoczęcia drenażu; **503 od wywołania `preReload`** (`draining: true`) | 200 |
| `reloading` | przeładowanie z magazynu (Z-09) **pod blokadą wdrożeń**: ponowny odczyt magazynu, zatrzymanie i start (ZASADY §2.3 B kroki 4–5) | 503 | 200 |
| `idle` | flow zatrzymane: `runtimeFlowState: stop` (API `setState`) lub safe mode (R-23 – `idle` = flow zatrzymane, nie stan początkowy) | 503 (**R-19**, D-13) | 200 |
| `loaded` | instancja tylko edycyjna (Z-15, `editorOnly: true`): flow wczytane, nieuruchamiane z założenia | **200** (D-13 – instancja gotowa do edycji) | 200 |
| `failed` | start flow nieudany: brakujące typy/moduły, błąd odczytu flow z magazynu, błąd startu z `start().errors` | 503 | 200 |
| `stopping` | od wywołania `runtime.stop()` (SIGTERM/SIGINT/SIGHUP/… lub osadzenie) – **nieodwracalny** | 503 | 200 |
| `stopped` | po zakończeniu `runtime.stop()` – końcowy | 503 | 200 (proces jeszcze żyje) |

- **Diagram stanów:**

```
                         ┌──────┐
                         │ init │  (stan początkowy, R-23)
                         └──────┘
                       runtime.start() (T1)
                             │
                             ▼
                       ┌──────────┐  start bez błędów (T2)            ┌─────────┐
                       │ starting │──────────────────────────────────▶│  ready  │
                       └──────────┘                                   └─────────┘
                        │   │   │ editorOnly (T14)  ┌──────────┐          ▲  │ setState stop (T11)
      błąd startu /     │   │   └──────────────────▶│  loaded  │          │  ▼
      brak typów /      │   │ runtimeFlowState=stop └──────────┘      ┌────────┐
      błąd odczytu (T3) │   └─ lub safe mode (T4) ───────────────────▶│  idle  │
                        ▼                                             └────────┘
                  ┌──────────┐ type-registered + start ok (T9) ──▶ ready
                  │  failed  │
                  └──────────┘

   Stany „spoczynku” S ∈ {ready, failed, idle, loaded}:

        S ── wdrożenie (T5) ──────────────────────────────▶ ┌───────────┐
        ▲                                                   │ deploying │── koniec (T6) ──▶ S'
        │                         wdrożenie unieważnia ────▶└───────────┘
        │                         przeładowanie (T5)               ▲
        │                                                          │
        S ── powiadomienie magazynu (T7) ──▶ ┌───────────────┐ ────┘
        ◀── anulowanie: rev bez zmian /      │ reloadPending │  bez blokady: slot koordynacji,
            błąd odczytu (T7b)               │  (draining)   │  potem preReload (T7a: /ready 503)
                                             └───────────────┘
                                                     │ wejście pod blokadę (T8)
                                                     ▼
                                             ┌───────────┐
                                             │ reloading │── koniec (T8a) ──▶ S'
                                             └───────────┘
   S' = ready | failed | idle | loaded (loaded wyłącznie przy editorOnly – nigdy ready)

   każdy stan oprócz stopping/stopped ── SIGTERM/SIGINT (CLI, przed drenażem Z-08) lub runtime.stop() (T12)
                                         ──▶ ┌──────────┐ ── (T13) ──▶ ┌─────────┐
                                             │ stopping │              │ stopped │
                                             └──────────┘              └─────────┘
```

- **Tabela przejść:**

| # | Z | Do | Zdarzenie źródłowe | Źródło w kodzie (istniejące / nowe) |
|---|---|---|---|---|
| T1 | `init` | `starting` | wywołanie `runtime.start()` | nowe: `state.markStarting()` na początku `runtime/lib/index.js` `start()` |
| T2 | `starting` | `ready` | pierwszy `start()` flow zakończony, `errors=[]` | istniejące `flows:started` (`flows/index.js:414`) + nowe: wynik `start()` (E-01) |
| T3 | `starting` | `failed` | `start().errors` niepuste (missing-types, missing-modules, flow-start-failed); odrzucenie `loadFlows()`; odrzucenie `runtime.start()` (np. błąd `storage.init`) | istniejące `runtime-state` (`:301,:315`); nowe: obsługa w `runtime/lib/index.js:245` zamiast pustego `.catch` (oraz zwrócenie obietnicy `startFlows()` z `then`, by objąć także błąd startu) (log bez zmian + `state.fail(err)`) |
| T4 | `starting` | `idle` | `runtimeFlowState === 'stop'` lub safe mode | istniejące `runtime-state` `{state:'stop'}` (`:335`), `{state:'safe'}` (`:325`); nowe: jawne wywołanie modułu stanu w tych gałęziach |
| T5 | `ready` / `failed` / `idle` / `loaded` / `reloadPending` | `deploying` | E-01 krok 4 (wszystkie wejścia potoku: `/flows` full/nodes/flows, `/flow`, `/flow/:id`, `reload` z Admin API, wywołania wewnętrzne z `deployOpts`); z `reloadPending` – wdrożenie **unieważnia** oczekujące przeładowanie (ZASADY §2.3 B; Z-09 przerywa `preReload` sygnałem, zwalnia slot) | nowe: `state.begin("deploy")` w potoku E-01 (wewnątrz mutexu) |
| T6 | `deploying` | `ready` / `failed` / `idle` / `loaded` | E-01 krok 8: koniec startu (`errors=[]` → `ready`; błędy → `failed`; flow nie były uruchomione, bo `started=false` → `idle`; `editorOnly` → `loaded`) | nowe: `state.end(token, result)` |
| T7 | `ready` / `failed` / `idle` / `loaded` | `reloadPending` | powiadomienie magazynu z rewizją różną od aktywnej lub `credentialsChanged` (Z-09, ZASADY §2.3 B krok 2) – **bez blokady, bez tokenu operacji** | nowe: `state.markReloadPending(info)` |
| T7a | `reloadPending` | `reloadPending` (`draining: true`) | rozpoczęcie drenażu – wywołanie `preReload` po zajęciu slotu (krok 3); `/ready` → 503 | nowe: `state.markDraining()` (zdarzenie `instance:state` – zmiana flagi) |
| T7b | `reloadPending` | stan poprzedni (`previous`) | anulowanie bez przeładowania: wstępny odczyt magazynu nieudany lub rewizja równa aktywnej | nowe: `state.cancelPending(reason)` |
| T8 | `reloadPending` | `reloading` | wejście pod blokadę wdrożeń po zakończeniu `preReload` (krok 4: ponowny odczyt magazynu) | nowe: `state.begin("reload")` (wewnątrz mutexu) |
| T8a | `reloading` | `ready` / `failed` / `idle` / `loaded` | koniec przeładowania (jak T6); błąd ponownego odczytu pod blokadą lub rewizja bez zmian → powrót do stanu sprzed T7 (flow nie były zatrzymane) | nowe: `state.end(token, result)` (`aborted: true` przy powrocie) |
| T9 | `failed` | `ready` | późny start po zarejestrowaniu brakującego typu (`type-registered` → `start()`, `flows/index.js:57-66`) bez błędów | istniejące `flows:started` + nowe: wynik `start()` |
| T10 | `idle` | `ready` | `setState start` (`api/flows.js:309-320`) zakończony bez błędów | istniejące `flows:started`; nowe: `state.begin("set-state")`/`end` w `setState` |
| T11 | `ready` / `failed` | `idle` | `setState stop` (`api/flows.js:322-329`) | istniejące `flows:stopped`; nowe: jw. |
| T12 | dowolny poza `stopping`/`stopped` (także `reloadPending` – `preReload` przerywany) | `stopping` | sygnał w CLI (SIGINT, SIGTERM, SIGHUP, SIGUSR2, SIGBREAK, PM2 `shutdown` – `node-red/red.js:543-558`) **przed** drenażem Z-08 (`preShutdown`, ZASADY §2.3 C) albo wywołanie `runtime.stop()` (osadzenie, gdy stan nie jest jeszcze `stopping`) | nowe: `state.markStopping(reason)` – w CLI jako pierwsza instrukcja obsługi sygnału (przez `RED.health`/`runtime.state`), w `runtime/lib/index.js` `stop()` jako pierwsza, synchroniczna instrukcja (idempotentne) |
| T13 | `stopping` | `stopped` | `stopFlows()` + `closeContextsPlugin()` zakończone (sukces lub błąd) | nowe: `state.markStopped(err?)` |
| T14 | `starting` | `loaded` | `editorOnly: true` (Z-15): flow wczytane, start pominięty (ZASADY §2.3 A krok 7) | nowe: wynik `start()` z `flowsRunning:false, reason:"editor-only"` → `state.end` (wprowadza Z-15) |

- **Wejścia:** wywołania API wewnętrznego (niżej) z `runtime/lib/index.js`, potoku E-01, `api/flows.js` (`setState`), Z-09; zdarzenia `flows:*` służą tylko do weryfikacji (testy charakteryzujące), stan ustawiają jawne wywołania – zdarzenia `flows:*` są emitowane także w trakcie wdrożenia i nie mogą same zmieniać stanu.
- **Wyjścia – API wewnętrzne (`runtime/lib/state.js`, dostępne jako `runtime.state`):**

```js
/**
 * @typedef {"init"|"starting"|"ready"|"deploying"|"reloadPending"|"reloading"|"idle"|"loaded"|"failed"|"stopping"|"stopped"} InstanceState
 * @typedef {Object} StateInfo
 * @property {InstanceState} state
 * @property {InstanceState|null} previous
 * @property {string} reason      - np. "startup", "deploy", "reload", "set-state", "missing-types",
 *                                  "missing-modules", "flow-start-failed", "storage-error", "safe-mode", "SIGTERM"
 * @property {number} since       - Date.now() wejścia w stan
 * @property {boolean} [draining]  - tylko w "reloadPending": true od wywołania preReload (/ready 503)
 * @property {Array<{code:string,message:string}>} [errors] - tylko w "failed"
 */
/** @returns {StateInfo} kopia bieżącego stanu (bez I/O, O(1)) */
function get() {}
/** @returns {boolean} true w "ready" i "loaded" (D-13) oraz w "reloadPending" bez drenażu,
 *  jeśli stan poprzedni był gotowy; w pozostałych false */
function isReady() {}
/** @param {(info: StateInfo) => void} listener @returns {() => void} funkcja wyrejestrowania */
function onChange(listener) {}

// --- tylko dla runtime (nie eksportowane do RED.* węzłów) ---
/** wywoływane wyłącznie pod blokadą wdrożeń (mutex E-01)
 *  @param {"deploy"|"reload"|"set-state"} operation @param {object} [info] @returns {symbol} token operacji */
function begin(operation, info) {}
/** Z-09, bez blokady i bez tokenu: T7 */
function markReloadPending(info) {}
/** Z-09: T7a – początek preReload */
function markDraining() {}
/** Z-09: T7b – powrót do stanu poprzedniego @param {string} reason */
function cancelPending(reason) {}
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
  Każde przejście emituje także zdarzenie `instance:state` na `@node-red/util` `events` (payload = `StateInfo`; pola kontraktowe `{state, previous, reason}` – R-23, pozostałe pola addytywne) – dostępne dla wtyczek przez `RED.events`. Nazwa zdarzenia celowo różna od istniejącego `runtime-event`/`runtime-state` (stan flow dla edytora) – **zatwierdzona (R-23)**; nazwy stanów i zdarzenia jako kontrakt w MIGRACJA.md.
- **Niezmienniki:**
  1. `ready` wyłącznie po zakończeniu startu flow ostatniej operacji (start, wdrożenie, przeładowanie, `setState start`, późny start) z pustą listą błędów – samo `flows:started` nie wystarcza (emitowane także po wyjątku `Flow.start`).
  2. `stopping` i `stopped` są nieodwracalne: z `stopping` jedynym przejściem jest `stopped`; wywołania `begin/end/fail` w tych stanach są ignorowane (log `debug`) – zdarzenia z zamykanych flow nie przywracają `ready`.
  3. Najwyżej jedna operacja **pod blokadą** (`deploy` / `reload` / `set-state`) naraz; `begin` wywoływane wyłącznie wewnątrz wspólnego mutexu E-01, przy aktywnej operacji rzuca błąd programisty (`state_operation_in_progress`) (`setState` zostaje objęty mutexem – zob. Ryzyka). `reloadPending` **nie jest operacją** (brak tokenu, brak blokady – ZASADY §2.3 B kroki 2–3): wdrożenie przyjęte w tym czasie przechodzi `reloadPending` → `deploying` (T5) i unieważnia oczekujące przeładowanie; kroki stop/start przeładowania wykonywane są dopiero pod blokadą (`reloading`, T8).
  4. `deploying`/`reloading` ustawiane **przed** zatrzymaniem pierwszego węzła (E-01 krok 4 przed 6), `ready` dopiero **po** starcie ostatniego (krok 8); w `reloadPending` żaden węzeł nie jest zatrzymywany.
  4a. `loaded` występuje wyłącznie przy `editorOnly: true` (Z-15); z `loaded` (i z operacji na instancji edycyjnej) nigdy nie ma przejścia do `ready`.
  5. `end(token)` z nieaktualnym tokenem (np. po `stopping`) nie zmienia stanu.
  6. Brak zdarzenia, gdy stan, powód i flaga `draining` się nie zmieniają; kolejność zdarzeń = kolejność przejść.
  7. Moduł jest pasywny: przy domyślnych ustawieniach nie zmienia żadnych odpowiedzi, logów, kolejności zdarzeń ani czasu wdrożenia (zgodność wstecz; konsumenci – Z-08, Z-09 – są wyłączeni domyślnie).
- **Przypadki błędów:** wyjątek w słuchaczu `onChange` → `log.warn`, pozostali słuchacze wywołani, stan zmieniony; `end` bez `begin` → ignorowane + `log.debug`; odrzucenie `runtime.start()` → `failed` (reason `startup-error`), odrzucenie promise bez zmian (zgodność).
- **Skutki uboczne:** zamiana pustego `.catch` w `runtime/lib/index.js:245` na obsługę ustawiającą `failed` (log jak w `flows/index.js:96-99` już wypisany wcześniej – bez nowych komunikatów); `setState` we wspólnej blokadzie – druga operacja czeka (zmiana kolejkowania, **R-11**).

#### Projekt rozwiązania (minimalny)
1. Testy charakteryzujące (najpierw): kolejność `flows:*` i `runtime-state` dla startu, startu z brakującymi typami, safe mode, `runtimeFlowState: stop`, późnego startu po `type-registered`, `setState start/stop`, `runtime.stop()`.
2. `runtime/lib/state.js` – maszyna stanów z tabelą dozwolonych przejść (obiekt `{from: [to...]}`), `events.emit("instance:state", info)`; bez zależności poza `@node-red/util`.
3. `runtime/lib/index.js`: `markStarting()` na początku `start()`; po `loadFlows().then(startFlows)` – `state.end` na podstawie wyniku `startFlows` (E-01 `{errors}`) albo `state.fail(err)` w miejsce pustego `.catch` (`:245`; obietnica `startFlows()` zwracana z `then`, bo dziś `.catch` obejmuje tylko `loadFlows`); `markStopping("stop")` jako pierwsza instrukcja `stop()`, `markStopped()` w `finally`; `runtime.state` w obiekcie runtime.
4. `flows/index.js`: w gałęziach `runtimeFlowState === 'stop'` i safe mode zwrot w wyniku `start()` pola `flowsRunning:false, reason` (E-01 rozszerza wynik), późny start (`:64-65`) – `state.end/fail` przez wynik `start()`.
5. Potok E-01: `begin("deploy")` w kroku 4, `end` w kroku 8 (także w ścieżce błędu – `finally`); `api/flows.js` `setState` w `mutex.runExclusive` + `begin("set-state")`. `begin("deploy")` ze stanu `reloadPending` emituje przejście, na które reaguje obserwator Z-09 (przerwanie `preReload`).
5a. `markReloadPending`/`markDraining`/`cancelPending` (bez tokenu) dla Z-09; stan `loaded` – przez wynik `start()` z `reason:"editor-only"` (wpinany w Z-15).
6. Powód zatrzymania (sygnał): **`RED.stop(reason)`** → `runtime.stop(reason)` (R-23) – opcjonalny parametr tekstowy (np. `"SIGTERM"`); powód trafia do hooka `preShutdown`, logu i pola `reason` zdarzenia `instance:state`; bez parametru – reason `"stop"` (zgodność wywołań bez argumentu).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Model stanu instancji

  Scenariusz: Stan początkowy init (R-23)
    Zakładając załadowany runtime bez wywołania runtime.start()
    Wtedy stan jest "init"
    Kiedy wywołam runtime.start()
    Wtedy zdarzenie instance:state zawiera state "starting" i previous "init"

  Scenariusz: Powód zatrzymania przekazany przez RED.stop(reason) (R-23)
    Zakładając stan "ready"
    Kiedy wywołam RED.stop("SIGTERM")
    Wtedy zdarzenie instance:state ze stanem "stopping" zawiera reason "SIGTERM"
    I log zatrzymania zawiera powód "SIGTERM"

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

  Scenariusz: Oczekujące przeładowanie nie blokuje wdrożenia
    Zakładając stan "ready" i powiadomienie magazynu o rewizji "B"
    Kiedy stan przejdzie w "reloadPending" i rozpocznie się preReload
    Wtedy flaga draining będzie true, a blokada wdrożeń nie będzie zajęta
    Kiedy klient wyśle POST /flows
    Wtedy stan przejdzie "reloadPending" → "deploying" → "ready"
    I oczekujące przeładowanie zostanie unieważnione (bez kroku "reloading")

  Scenariusz: Przeładowanie pod blokadą
    Zakładając stan "reloadPending" z zakończonym preReload
    Kiedy przeładowanie wejdzie pod blokadę wdrożeń
    Wtedy stan przejdzie "reloading", a potem "ready"

  Scenariusz: Instancja tylko edycyjna
    Zakładając editorOnly = true (Z-15)
    Kiedy uruchomię runtime i wykonam wdrożenie
    Wtedy stan przejdzie "starting" → "loaded" → "deploying" → "loaded"
    I stan nigdy nie będzie "ready"

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
- Jednostkowe, nowy `test/unit/@node-red/runtime/lib/state_spec.js`: `initial state is init` (R-23), `starts in starting after markStarting`, `allows only transitions from the table` (szablon dla każdej pary niedozwolonej), `ready only after end with no errors`, `end with errors sets failed with errors`, `end with flowsRunning false sets idle`, `reloadPending has no token and does not block begin(deploy)`, `begin(deploy) from reloadPending cancels pending`, `markDraining sets draining and isReady false`, `cancelPending returns to previous`, `reloadPending → reloading only via begin(reload)`, `editor-only start ends in loaded and never ready`, `stopping is terminal – begin/end/fail ignored`, `stale token does not change state`, `begin during active operation throws state_operation_in_progress`, `emits instance:state once per transition`, `no event when state unchanged`, `listener exception is logged and others notified`, `onChange returns unsubscribe`.
- `test/unit/@node-red/runtime/lib/index_spec.js`: `state is starting when start() resolves before flows started`, `state becomes ready after startFlows`, `loadFlows rejection sets failed (storage-error)`, `stop() sets stopping synchronously before stopFlows`, `stop() sets stopped after closeContextsPlugin`, `stop(reason) passes reason to instance:state and log` (R-23), `stop() without reason uses "stop"`.
- `test/unit/@node-red/runtime/lib/flows/index_spec.js`: `missing types → failed`, `missing modules → failed`, `safe mode → idle`, `runtimeFlowState stop → idle`, `type-registered late start → ready`, `deploy sets deploying before flows:stopping and ready after flows:started`.
- `test/unit/@node-red/runtime/lib/api/flows_spec.js`: `setState runs in api mutex`, `setState start/stop transitions idle↔ready`.

#### DoD specyficzne
- [ ] Tabela przejść w JSDoc `state.js` identyczna z kartą (test „dozwolone przejścia” generowany z tej tabeli).
- [ ] Testy charakteryzujące zielone przed i po zmianie; istniejące testy `flows/index_spec.js`, `index_spec.js`, `api/flows_spec.js` bez zmian.
- [ ] Brak zmian zachowania przy domyślnych ustawieniach (niezmiennik 7) potwierdzony testem.
- [ ] Nazwa zdarzenia `instance:state` i nazwy stanów zgodne z R-23 (`init` … `stopped`); kontrakt opisany w MIGRACJA.md.

#### Ryzyka i alternatywy
- **Pusty `.catch` przy starcie** (`index.js:245`, obejmuje tylko `loadFlows`): zastąpienie obsługą zmienia tylko stan wewnętrzny (bez nowych logów, bez odrzucania `RED.start()`) – zgodność zachowana.
- **`setState` w mutexie:** zmiana kolejkowania (dziś `setState` może przeplatać się z wdrożeniem – to błąd wyścigu). Alternatywa: zostawić bez mutexu i w module stanu odrzucać `begin` – gorsze (błąd zamiast kolejkowania). **Rozstrzygnięte (R-11):** `setState` pod wspólną blokadą, druga operacja czeka.
- **`idle` vs `failed` dla safe mode:** zlecenie wymienia safe mode obok błędów startu; proponujemy `idle` (decyzja operatora `--safe`), z punktu widzenia `/ready` bez różnicy (503). **Rozstrzygnięte (R-23, R-19):** `idle` (flow zatrzymane, także safe mode), `/ready` 503.
- Stan jest lokalny dla procesu. Instancja tylko edycyjna (Z-15) ma osobny stan `loaded` (nie `idle`) i `/ready` 200 (D-13) – `idle` zostaje dla flow świadomie zatrzymanych (`/ready` 503).
- **Nazwa `idle`:** **rozstrzygnięte (R-23):** `init` = stan początkowy (przed `runtime.start()`, T1), `idle` = flow zatrzymane; ANALIZA §4.2 skorygowana.
- **`reloadPending` bez tokenu:** oczekiwanie na slot i drenaż (do 20 min) nie zajmują blokady, więc nie blokują wdrożeń z edytora; ceną jest unieważnianie oczekującego przeładowania przez wdrożenie lokalne (wdrożenie samo ustala nową konfigurację, nowszy zapis w magazynie generuje kolejne powiadomienie).
- Alternatywa odrzucona: wyprowadzanie stanu wyłącznie ze zdarzeń `flows:*` – zdarzenia nie odróżniają wdrożenia od startu i są emitowane mimo błędów `Flow.start`.

#### Podzadania
- [x] Testy charakteryzujące zdarzeń startu/wdrożenia/zatrzymania (S)
- [x] `runtime/lib/state.js` (z `init`) + testy przejść (M)
- [x] `RED.stop(reason)` → `runtime.stop(reason)` (R-23) (S)
- [x] Wpięcie w `runtime/lib/index.js` (start, pusty `.catch`, stop) (S)
- [x] Wpięcie w potok E-01 i `setState` (+ mutex) (S)
- [x] JSDoc + opis w dokumencie kontraktu E-01 (S)

#### Zrealizowane (gałąź `feature/p3-database`)
- `runtime/lib/state.js` – tabela przejść `TRANSITIONS` (źródło prawdy, JSDoc z tabelą T1–T14), `get`, `isReady`,
  `onChange`, `begin`/`end` (token), `markReloadPending`/`markDraining`/`cancelPending` (Z-09, jeszcze nieużywane),
  `markStarting`, `markStopping`/`markStopped`, `fail`, `reset`; zdarzenie `instance:state` na `RED.events`;
  `runtime.state` w obiekcie runtime.
- Wpięcie: `runtime/lib/index.js` (`markStarting`, `fail` zamiast pustego `.catch` – `storage-error`,
  `flow-start-failed`, `startup-error` przy odrzuceniu `start()`; `stop(reason)` – `stopping` synchronicznie,
  `stopped` po `closeContextsPlugin` także przy błędzie; log `runtime.stopping` tylko z powodem);
  `flows/pipeline.js` krok 4 (`begin("deploy")`) i krok 8 (`end` po zakończeniu startu, przed zwolnieniem blokady –
  `lock.sectionHeld()` + `holdUntil` z tymi samymi opcjami); `api/flows.js` `setState` (`begin/end("set-state")`,
  już pod blokadą E-01); `flows/index.js` `start()` – wynik raportowany do modułu stanu poza operacją (pierwszy start,
  późny start po `type-registered`, przełączenie projektu) oraz `flowsRunning:false` + `reason` (`safe-mode`,
  `set-state`); `node-red/lib/red.js` `RED.stop(reason)`.
- Testy: `state_spec.js` (138, w tym przejścia generowane z tabeli), `index_spec.js` (+9), `flows/index_spec.js`
  (+8), `flows/pipeline_spec.js` (+10), `flows/lock_spec.js` (+1), `api/flows_spec.js` (+6), `node-red/lib/red_spec.js` (+2);
  istniejące testy bez zmian.
- **Rozbieżności z kartą (świadome):**
  - przejścia dodatkowe w tabeli: `starting → deploying` (wdrożenie w trakcie pierwszego startu – wynik startu jest
    wtedy ignorowany, stan ustala koniec wdrożenia) oraz między stanami spoczynku `ready/failed/idle` bez operacji
    (wynik startu przy przełączeniu projektu – Projekty nie przechodzą przez `deploying`);
  - `begin("set-state")` nie zmienia stanu do `end` (karta nie nazywa stanu pośredniego);
  - `begin(…, {supersede: true})` w potoku i `setState`: przy `deploy.startTimeoutReleasesLock: true` (R-45) blokada
    może zostać zwolniona przed końcem startu – nowa operacja przejmuje stan zamiast błędu `state_operation_in_progress`
    (błąd nadal rzucany bez `supersede`);
  - nowa funkcja `report(result)` (wynik startu poza operacją – T2/T3/T4/T9/T14), niewymieniona w API karty;
  - ignorowane przejścia logowane na poziomie `trace` (nie `debug`) – `debug` trafia do `log.log` i zmieniałby logi
    istniejących testów (niezmiennik 7);
  - błąd zapisu/zatrzymania w kroku 5–6: błąd przed startem → powrót do stanu sprzed wdrożenia (`aborted`), wyjątek
    `deploy_stop_failed` → `failed` (`deploy-stop-failed`).

---

### Z-08 – Sondy zdrowia `/live` i `/ready`

| Pole | Wartość |
|---|---|
| Etap / typ | 3 / funkcja + poprawka błędu (D-05: serwer HTTP przy zatrzymaniu) |
| Priorytet / ryzyko | P1 / średnie |
| Ustawienie | `health: { enabled: false, path: "/health", port: <opcjonalnie>, host: <opcjonalnie> }` (zlecenie: `health: { enabled, path }`; ZASADY §2.1); `shutdownTimeout` (płasko, **domyślnie nieustawiony – drenaż wyłączony**, zachowanie 5.0.6; R-22); hook `preShutdown` (bez `shutdownTimeout` nie jest wywoływany – R-37); API osadzających `RED.health`; `deploy.startTimeout` (ms, domyślnie wyłączony – limit czasu startu w trybie `deploy.response: "started"`, R-38) |
| Zależności | E-02 (stan), E-01 (kroki 4/8). Stany `reloadPending`/`reloading` (E-02) to **punkt integracji wykorzystywany przez Z-09** – Z-08 nie zależy od Z-09 |
| Pliki | nowy `@node-red/runtime/lib/health.js`; `@node-red/runtime/lib/index.js` (init/start/stop modułu, `runtime.health`); `node-red/red.js:417-436` (kolejność montowania przed uwierzytelnieniem), `:484` (warunek nasłuchu), `:543-558` (sygnały); `node-red/lib/red.js:60-140` (eksport `RED.health` dla osadzających, ZASADY §2.1); `@node-red/util/lib/hooks.js:3-17` (`preShutdown` w `VALID_HOOKS`); `node-red/settings.js` (sekcja Runtime Settings); `@node-red/runtime/locales/en-US/runtime.json` |
| Powiązania | workery z `httpAdminRoot: false`, drenaż do 20 min |

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
- **Cel:** endpointy żywotności i gotowości dla orkiestratora i load balancera, wiarygodne także w trakcie startu, wdrożenia, przeładowania i zatrzymania; drenaż pracy w toku przy SIGTERM przed zatrzymaniem flow (D-11, ZASADY §2.3 C).
- **Wejścia:** `GET`/`HEAD` `<path>/live`, `<path>/ready`; ustawienia `health.enabled` (domyślnie `false`), `health.path` (domyślnie `"/health"`), `health.port` (opcjonalnie; brak → serwer główny), `health.host` (opcjonalnie; brak → `uiHost`), `shutdownTimeout` (limit drenażu przy zatrzymaniu; **domyślnie nieustawiony – drenaż wyłączony**, R-22); sygnały SIGTERM/SIGINT (CLI); handlery hooka `preShutdown`.
- **Wyjścia:**
  - `/live` → `200` zawsze, gdy proces obsługuje pętlę zdarzeń (we wszystkich stanach E-02, także `stopping` – nie restartować instancji w trakcie drenażu).
  - `/ready` → `200` w stanie `ready`, w `loaded` (instancja tylko edycyjna – D-13; stan wprowadza Z-15, test w Z-15) oraz w `reloadPending` przed rozpoczęciem drenażu (oczekiwanie na slot, gdy stan poprzedni był gotowy); `503` w `starting`, `deploying`, `reloadPending` z `draining: true` (od wywołania `preReload`), `reloading`, `idle` (**R-19**: safe mode i zatrzymane flow), `failed`, `stopping`, `stopped`; `init` – 503 (sondy uruchamiane od `starting`).
  - Treść: `application/json`, `{"status":"ok"}` lub **stała** `{"status":"unavailable"}` (R-22 – bez nazwy stanu); nagłówek `Cache-Control: no-store`. Treść **nie zawiera** stanu, konfiguracji, ścieżek, wersji, listy flow ani błędów.
  - Inne metody → `405`; inne ścieżki pod `<path>` → `404`.
  - Ustawienie wyłączone → brak tras (`404` jak dziś), brak dodatkowego serwera.
- **Niezmienniki:**
  - bez uwierzytelnienia i bez `httpAdminMiddleware`/`httpNodeMiddleware`, niezależnie od `adminAuth`, `httpAdminAuth`, `httpNodeAuth`;
  - działa przy `httpAdminRoot: false` i `httpNodeRoot: false` (z `port` – osobny serwer; bez `port` – serwer główny zaczyna nasłuch tylko dla sond);
  - `/ready` przechodzi na `503` **synchronicznie** w chwili odebrania SIGTERM/SIGINT (stan `stopping`, przed drenażem i przed zatrzymaniem pierwszego węzła), w chwili wywołania `runtime.stop()` przez osadzenie, w kroku 4 E-01 (przed zatrzymaniem węzłów wdrożenia) i przy rozpoczęciu `preReload` (Z-09);
  - kolejność zatrzymania (ZASADY §2.3 C): sygnał → `stopping` (`/ready` 503, `/live` 200) → hook `preShutdown` / oczekiwanie najwyżej `shutdownTimeout` → `RED.stop(reason)` → zamknięcie serwera HTTP (tylko przy `health.enabled`, R-22) → wyjście; **bez ustawionego `shutdownTimeout` – brak drenażu, hook `preShutdown` nie jest wywoływany, natychmiastowe `RED.stop(reason)` (zachowanie 5.0.6, R-22, R-37)**; brak osobnego limitu samego `RED.stop()` – ostatecznym limitem jest `terminationGracePeriodSeconds` orkiestratora (R-37); bez zarejestrowanych handlerów `preShutdown` brak oczekiwania;
  - drugi sygnał SIGTERM/SIGINT w trakcie drenażu → natychmiastowe `RED.stop(reason)` (R-22);
  - odpowiedź nie wykonuje I/O (odczyt `runtime.state.get()`), czas odpowiedzi stały;
  - przy `health.enabled: false` – zachowanie identyczne z 5.0.7 (w tym brak zamykania serwera HTTP – zob. Ryzyka).
- **Przypadki błędów:** `health.port` zajęty → start runtime odrzucony z czytelnym komunikatem (`health.port-in-use`), stan `failed`; `health.port === uiPort` → montaż na serwerze głównym + `log.warn`; `health.path` bez wiodącego `/` lub równy `/` → błąd startu (`health.invalid-path`); `health.path` wewnątrz `httpAdminRoot`/`httpNodeRoot` → dozwolone, sondy mają pierwszeństwo + `log.info` przy starcie (trasa węzła o tej samej ścieżce zostanie przesłonięta).
- **Skutki uboczne:** przy `port` – dodatkowy serwer `http` (moduł wbudowany Node.js, bez nowych zależności), nasłuch na `health.host` (domyślnie `uiHost`); zamykany po `stopped`. W fazie drenażu serwer główny **przyjmuje** połączenia (trwające rozmowy mogą wymagać wywołań zwrotnych HTTP; nowy ruch odcina `/ready` 503), `/live` odpowiada. Po `RED.stop()` – zamknięcie serwera HTTP (`server.close()` + `closeIdleConnections()`, z limitem) przed wyjściem – poprawka D-05 **tylko przy `health.enabled`** (R-22); przy wyłączonych sondach – zachowanie 5.0.7. Hook `preShutdown`: payload `{reason, deadline, signal}`; rozwiązanie = „drenaż zakończony”; przekroczenie limitu → `log.warn("health.shutdown-timeout")` i zatrzymanie mimo to; wyjątek/odrzucenie → `log.error` i zatrzymanie mimo to; drugi sygnał w trakcie drenażu → natychmiastowe `RED.stop()` (**R-22**).

#### Projekt rozwiązania (minimalny)
1. `runtime/lib/health.js`: `init(runtime)`; `handler(req, res, next)` – zwykła funkcja `(req,res)` zgodna z Express i `http`, rozpoznaje `/live` i `/ready` względem `health.path`; `start()` – przy `health.port` tworzy `http.createServer(handler)` i `listen(port, uiHost)` (obietnica odrzucana przy `EADDRINUSE`); `stop()` – zamyka własny serwer po `stopped`.
2. `runtime/lib/index.js`: `health.init` w `init()`, `health.start()` na początku `start()` (sondy dostępne od `starting` – `/ready` 503); `runtime.health` w obiekcie runtime.
3. `node-red/red.js` (CLI): gdy `health.enabled` i brak osobnego portu – `app.use(health.path, RED.health.handler)` **przed** montowaniem `httpAdminAuth`/`httpNodeAuth` i aplikacji (`:417`); warunek nasłuchu (`:484`) rozszerzony o `health.enabled` bez portu.
4. `node-red/lib/red.js`: getter `health` (`{ handler, shutdown }`) dla aplikacji osadzających Node-RED (nowe publiczne API, nazwa wg ZASADY §2.1).
5. Drenaż i D-05 w `exitWhenStopped` (CLI, `node-red/red.js:543-558`): `runtime.state.markStopping(signal)` (przez `RED.health`) → (tylko przy ustawionym `shutdownTimeout`, R-22) `hooks.trigger("preShutdown", {reason, deadline, signal})` w `Promise.race` z `shutdownTimeout` (wzorzec limitu z Z-06) → `RED.stop(signal)` (R-23) → (tylko przy `health.enabled`, R-22) `server.close()` + `server.closeIdleConnections()` (Node ≥ 18.2) z limitem → `process.exit()`; drugi sygnał w trakcie drenażu → natychmiastowe `RED.stop(signal)` (R-22); `"preShutdown"` w `VALID_HOOKS`. Osadzający bez CLI: `RED.health.shutdown({reason})` wykonuje te same kroki bez zamykania cudzego serwera.
6. Szablon `settings.js`: blok `health` (zakomentowany) i zakomentowane `shutdownTimeout` (domyślnie brak – drenaż wyłączony, R-22) z opisem stanów, zaleceniem osobnego portu dla workerów, opisem `shutdownTimeout`/`preShutdown` i relacji z `terminationGracePeriodSeconds` (limit orkiestratora > `shutdownTimeout` + zatrzymanie węzłów).
7. Teksty logów w `runtime.json` (`health.listening`, `health.port-in-use`, `health.invalid-path`, `health.path-shadows-route`, `health.draining`, `health.shutdown-timeout`).

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
    Zakładając health.enabled = true, magazyn z watchFlows, deploy.reload.watch = true i stan "ready"
    Kiedy magazyn powiadomi o zmianie flow
    Wtedy GET /health/ready zwraca 503 od rozpoczęcia drenażu (wywołanie preReload) do startu nowych flow
    I w trakcie oczekiwania na slot przeładowania (deploy.reload.concurrency) GET /health/ready zwraca 200

  Scenariusz: Drenaż przy SIGTERM – 503 od sygnału
    Zakładając health.enabled = true, ustawiony shutdownTimeout, stan "ready" i hook preShutdown, który kończy się po sygnale testu
    Kiedy proces otrzyma SIGTERM
    Wtedy GET /health/ready zwraca 503 natychmiast, a GET /health/live zwraca 200
    I żaden węzeł nie jest zamykany, dopóki hook się nie zakończy
    Kiedy hook się zakończy
    Wtedy wywołane zostanie RED.stop(), a po zatrzymaniu flow serwer HTTP zostanie zamknięty i proces zakończy się

  Scenariusz: Drenaż przy SIGTERM – limit shutdownTimeout
    Zakładając shutdownTimeout = 200 ms i hook preShutdown, który się nie kończy
    Kiedy proces otrzyma SIGTERM
    Wtedy po 200 ms wywołane zostanie RED.stop() mimo to
    I w logu pojawi się ostrzeżenie o przekroczeniu limitu drenażu
    I po zatrzymaniu flow serwer HTTP zostanie zamknięty

  Scenariusz: Zatrzymanie bez hooka preShutdown
    Zakładając brak zarejestrowanych handlerów preShutdown
    Kiedy proces otrzyma SIGTERM
    Wtedy RED.stop() zostanie wywołane bez oczekiwania (jak w wersji bazowej)

  Scenariusz: Drenaż domyślnie wyłączony (R-22, R-37)
    Zakładając brak ustawienia shutdownTimeout i zarejestrowany hook preShutdown, który się nie kończy
    Kiedy proces otrzyma SIGTERM
    Wtedy RED.stop() zostanie wywołane bez oczekiwania (zachowanie 5.0.6)
    I hook preShutdown nie zostanie wywołany (R-37)

  Scenariusz: Drugi SIGTERM w trakcie drenażu (R-22)
    Zakładając ustawiony shutdownTimeout = 60000 ms i hook preShutdown, który się nie kończy
    Kiedy proces otrzyma SIGTERM, a po chwili drugi SIGTERM
    Wtedy RED.stop() zostanie wywołane natychmiast po drugim sygnale

  Scenariusz: Serwer HTTP bez sond nie jest zamykany (R-22)
    Zakładając domyślne ustawienia (health.enabled = false)
    Kiedy proces otrzyma SIGTERM
    Wtedy kolejność zatrzymania i obsługa serwera HTTP są takie jak w wersji 5.0.7

  Szablon scenariusza: Nieudany lub świadomie wstrzymany start
    Zakładając health.enabled = true i <warunek>
    Kiedy runtime się uruchomi
    Wtedy GET /health/ready zwraca 503 ze stałą treścią {"status":"unavailable"} (R-22)
    I stan instancji (E-02) to "<stan>"
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
    Wtedy treść zawiera wyłącznie pole status (R-22 – stała treść 503)
    I nie zawiera nazwy stanu, ścieżek, wersji, identyfikatorów flow ani komunikatów błędów

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

  Scenariusz: Zamknięcie serwera HTTP po zatrzymaniu flow
    Zakładając health.enabled = true i trwające długie żądanie HTTP do flow
    Kiedy proces otrzyma SIGTERM
    Wtedy w fazie drenażu serwer przyjmuje połączenia, a GET /health/live zwraca 200
    I po RED.stop() serwer HTTP jest zamykany dla nowych połączeń przed wyjściem procesu
    I trwające żądanie zostaje obsłużone do końca lub do zamknięcia węzła

  Scenariusz: Metody i ścieżki
    Zakładając health.enabled = true
    Kiedy wyślę POST /health/ready
    Wtedy odpowiedź ma status 405
    Kiedy wyślę HEAD /health/live
    Wtedy odpowiedź ma status 200 bez treści
```

#### Testy
- Jednostkowe, nowy `test/unit/@node-red/runtime/lib/health_spec.js` (supertest na `handler`, atrapa `runtime.state`): `live returns 200 in every state` (szablon po stanach), `ready returns 200 only in ready`, `ready returns 503 with constant body in init|starting|deploying|reloading|idle|failed|stopping|stopped` (R-22), `body contains only status`, `sets Cache-Control no-store`, `405 for POST`, `HEAD supported`, `404 for unknown subpath`, `disabled – no routes, no server`, `port – starts own server`, `port in use – start rejects with health.port-in-use`, `port equal uiPort – mounts on main server and warns`, `invalid path rejected`, `ready 200 in reloadPending before draining`, `ready 503 in reloadPending when draining`, `ready 200 in loaded`.
- Nowy `test/unit/@node-red/runtime/lib/health_shutdown_spec.js` (fake timers, atrapa `RED.stop`): `shutdown sets stopping before preShutdown`, `waits for preShutdown before RED.stop`, `shutdownTimeout proceeds with warning`, `preShutdown error proceeds with error log`, `no hook – no wait`, `no shutdownTimeout – no drain even with preShutdown hook` (R-22), `no shutdownTimeout – preShutdown not invoked` (R-37), `second signal stops immediately` (R-22), `server closed after RED.stop only when health.enabled` (R-22), `server not closed when health disabled`, `RED.stop receives signal as reason` (R-23); `test/unit/@node-red/util/lib/hooks_spec.js`: `allows preShutdown hook`.
- `test/unit/@node-red/runtime/lib/index_spec.js`: `ready 503 when RED.start resolved before flows started`, `ready 503 synchronously after stop() called` (węzeł atrapa z wolnym `close`).
- Integracyjny `test/unit/@node-red/runtime/lib/health_lifecycle_spec.js`: pełna sekwencja start → ready → deploy (węzeł z 2 s `close`) → ready → stop z odpytywaniem `/ready` co 50 ms; wariant missing-types; wariant `runtimeFlowState: stop`.
- `test/unit/node-red/red_spec.js` lub nowy `test/unit/node-red/health_mount_spec.js`: `health mounted before httpNodeAuth`, `server listens when only health enabled` (wydzielenie funkcji montowania z `red.js` do testowalnego modułu – **do potwierdzenia**, CLI nie ma dziś testów).
- Test sygnałów: proces potomny (`child_process.fork`) z minimalnymi ustawieniami, `process.kill(pid,'SIGTERM')`, odpytywanie `/ready` na porcie sond (503 od sygnału, `/live` 200 w drenażu, kolejność `preShutdown` → `RED.stop` → zamknięcie serwera) – bez nowych zależności.

#### DoD specyficzne
- [ ] Testy obu stanów `health.enabled` i obu wariantów (`port` / serwer główny).
- [ ] Szablon `settings.js` z opisem, zaleceniem dla workerów (`httpAdminRoot:false` + `port`) i ostrzeżeniem, że sondy są publiczne na danym porcie.
- [ ] Dokumentacja odpowiedzi (kody, treść) i tabela stan → kod (z E-02).
- [ ] Zamknięcie serwera przy SIGTERM pokryte testem regresji (D-05) – tylko przy `health.enabled`; test, że bez sond zachowanie jak 5.0.7 (R-22).
- [ ] Drenaż przy SIGTERM (D-11): `/ready` 503 od sygnału, `preShutdown` z limitem `shutdownTimeout`, potem `RED.stop()` i zamknięcie serwera HTTP – test w procesie potomnym; bez handlerów `preShutdown` brak opóźnienia; bez `shutdownTimeout` brak drenażu (R-22).
- [ ] Limit czasu oczekiwania na start w trybie `deploy.response: "started"` (R-10, R-38): `deploy.startTimeout` (ms, domyślnie wyłączony) opisany w `settings.js`; po przekroczeniu 500 `deploy_start_failed` z `errors[].code: "start_timeout"`, flow startują dalej w tle (wynik w logu) – testy obu stanów ustawienia (kontrakt wspólny z P-01).

#### Ryzyka i alternatywy
- **Drenaż przy SIGTERM (D-11):** dziś `RED.stop()` od razu zatrzymuje flow (zamyka węzły w ciągu `nodeCloseTimeout`), więc `terminationGracePeriodSeconds: 1200` sam nie chroni rozmów. Rozwiązanie w rdzeniu (zgodnie z D-11 i ZASADY §2.3 C): `stopping` od sygnału, hook `preShutdown` (kończy drenaż wcześniej, gdy rozmowy się skończą) z limitem `shutdownTimeout`, potem `RED.stop()`. `preStop` orkiestratora (uśpienie przed SIGTERM) – **opcja dodatkowa**, niezależna od rdzenia (np. by Endpoints zdążyły się zaktualizować). Ryzyko: `shutdownTimeout` + czas zatrzymania węzłów musi być krótszy niż okres łaski orkiestratora (dokumentacja).
- **Globalny limit zatrzymania:** `shutdownTimeout` ogranicza fazę drenażu; samo `RED.stop()` nadal ograniczone tylko `nodeCloseTimeout` per węzeł – proces może kończyć się dłużej niż okres łaski orkiestratora → SIGKILL. **Rozstrzygnięte (R-37):** brak osobnego limitu `RED.stop()` – ostatecznym limitem jest `terminationGracePeriodSeconds` orkiestratora (dokumentacja w `settings.js`).
- **Zamknięcie serwera:** zgodnie z ZASADY §2.3 C serwer zamykany jest dopiero **po** `RED.stop()` – w fazie drenażu `/live` odpowiada także przy sondach na serwerze głównym (wcześniejsze ryzyko wyłączenia `/live` usunięte). **Rozstrzygnięte (R-22):** zamknięcie serwera tylko przy `health.enabled`; przy `health.enabled:false` (domyślnie) – zachowanie 5.0.7.
- **`/ready` przy `idle`** (`runtimeState` stop, safe mode): 503 chroni przed kierowaniem ruchu do instancji bez flow. Instancja edycyjna (Z-15) ma osobny stan `loaded` z `/ready` 200 (D-13) – **rozstrzygnięte (R-19)**.
- **Limit czasu oczekiwania na start w trybie `deploy.response: "started"`** – przeniesiony z P-01 do Z-08 (R-10). **Rozstrzygnięte (R-38):** `deploy.startTimeout` (ms), domyślnie wyłączony; po przekroczeniu 500 `deploy_start_failed` z `errors[].code: "start_timeout"`, flow startują dalej w tle (wynik w logu). Kontrakt opisany także w karcie P-01 (etap 1) – implementacja w jednym z pakietów wg kolejności realizacji.
- **Wszystkie workery 503 jednocześnie** przy przeładowaniu – rozwiązane w Z-09 (`deploy.reload.concurrency` przez koordynację Z-10, `type: "diff"`).
- Ścieżka sond pod `httpNodeRoot` przesłania trasy `http in` o tej samej ścieżce – ostrzeżenie w logu; zalecenie: osobny port.
- Alternatywa: sondy w `editor-api` – odrzucona (niedostępne przy `httpAdminRoot:false`).

#### Podzadania
- [x] `runtime/lib/health.js` + testy jednostkowe handlera (M)
- [x] Osobny serwer (`port`) + obsługa błędów portu (S)
- [x] Montaż w CLI przed uwierzytelnieniem, warunek nasłuchu, `RED.health` (S)
- [x] Drenaż przy SIGTERM (D-11): `stopping` od sygnału, hook `preShutdown`, `shutdownTimeout`, kolejność `RED.stop()` → zamknięcie serwera HTTP (D-05), `RED.health.shutdown` + test w procesie potomnym (M)
- [x] Test cyklu życia (integracyjny) (M)
- [x] Szablon `settings.js`, CHANGELOG, teksty logów (S)
- [x] `deploy.startTimeout` – limit czasu startu w trybie `"started"`, kod `start_timeout`, start w tle (R-10, R-38) (S) – zrealizowane wcześniej w P-01 (R-45)

#### Zrealizowane (gałąź `feature/p3-database`)
- `runtime/lib/health.js`: `init`, `isEnabled`, `getPath`, `usesMainServer`, `handler` (Express i `http`), `start`
  (walidacja `health.invalid-path`, log `health.path-shadows-route`, ostrzeżenie `health.port-is-ui-port`, własny
  serwer przy `health.port` – `health.port-in-use` odrzuca start i ustawia `failed`), `stop` (po `stopped`),
  `closeServer(server, limit)` (`close` + `closeIdleConnections` z limitem), `shutdown({reason, signal, stop})`
  (część C kontraktu: `stopping` synchronicznie → `preShutdown` tylko przy `shutdownTimeout` i zarejestrowanych
  handlerach, limit z ostrzeżeniem, błąd z logiem → `stop(reason)`; drugie wywołanie przerywa drenaż).
- `runtime/lib/index.js` (`health.init`, `health.start` po katalogu komunikatów – sondy od `starting`, `health.stop`
  po `stopped`, `runtime.health`); `node-red/lib/red.js` (`RED.health`); `node-red/red.js` (montaż przed
  `httpAdminAuth`/`httpNodeAuth`, warunek nasłuchu, `exitWhenStopped(signal)` → `RED.health.shutdown` → zamknięcie
  serwera tylko przy `health.enabled` → `process.exit()`); `util/lib/hooks.js` (`preShutdown` w `VALID_HOOKS`);
  szablon `settings.js` (`health`, `shutdownTimeout`); `runtime.json` (`health.*`).
- Testy: `health_spec.js` (42), `health_shutdown_spec.js` (12), `index_spec.js` (+5), `node-red/lib/red_spec.js` (+2),
  `hooks_spec.js` (+1), proces potomny `test/unit/node-red/health-probes_spec.js` (5: pełna sekwencja start → ready →
  wdrożenie z wolnym zamykaniem węzła (503) → ready → SIGTERM (503 od razu, `/live` 200, serwer główny przyjmuje,
  żaden węzeł niezamknięty do końca `preShutdown`) → wyjście; drugi SIGTERM; serwer główny z `httpNodeAuth`;
  worker bez Admin API i `httpNodeRoot`; ustawienia domyślne – brak sond i brak drenażu mimo hooka).
- **Rozbieżności z kartą / uwagi:**
  - wydzielenie montażu z `node-red/red.js` do osobnego modułu nie zostało zrobione – montaż i sygnały sprawdzane
    testem procesu potomnego (zamiast `health_mount_spec.js`);
  - `health_lifecycle_spec.js` (w procesie, odpytywanie co 50 ms) zastąpiony testem procesu potomnego; warianty
    missing-types i `runtimeFlowState: stop` sprawdzone jednostkowo (`health_spec.js` po stanach, `flows/index_spec.js`);
  - przy wyłączonych sondach CLI też przechodzi przez `RED.health.shutdown` (bez drenażu i bez zamykania serwera);
    jedyna widoczna różnica względem 5.0.7 to log `Stopping Node-RED (SIGTERM)` (powód zatrzymania, R-23); drugi
    sygnał bez drenażu jest ignorowany jak dotąd;
  - handler `preShutdown` musi przyjmować argument `payload` (konwencja hooków: funkcja bez parametrów jest
    traktowana jak wariant z wywołaniem zwrotnym) – opis w `settings.js`;
  - nieprawidłowe `shutdownTimeout` (≤ 0, nie liczba) = brak drenażu, bez ostrzeżenia;
  - `RED.health.closeServer` zamyka serwer z limitem 5 s (stała), własny serwer sond – 1 s.

---

### Z-09 – Przeładowanie flow po zmianie w magazynie

| Pole | Wartość |
|---|---|
| Etap / typ | 3 / funkcja |
| Priorytet / ryzyko | P1 / wysokie |
| Ustawienie | API wtyczki magazynu: opcjonalne `watchFlows(callback)` (bez zmian względem zlecenia); hook `preReload`. Parametry (ZASADY §2.1): `deploy.reload: { watch: false, type: "full" \| "diff" (domyślnie "full"), preReloadTimeout: 1200000, concurrency: <opcjonalnie, tylko liczba> }`; `deploy.reload.retry: { min: 1000, max: 60000, attempts: 10 }` (**R-20**, D-18; `attempts` domyślnie 10 ≈ 8 min – **R-36**). Bez `watchFlows` w magazynie ustawienie nie ma efektu. |
| Zależności | E-01 (wspólny mutex, potok bez kroku 5), E-02 (`reloadPending`, `reloading`), Z-08 (`/ready` – punkt integracji), Z-06 (`VALID_HOOKS`, wzorzec limitu czasu, wywołanie `postDeploy` – punkt integracji), Z-10 (zajęcie slotu przy `concurrency`), P-01 (błędy startu w wyniku `start()`) |
| Pliki | `@node-red/runtime/lib/storage/index.js:51-120` (wykrycie `watchFlows`, `getFlows` – rewizja `:80`); `@node-red/runtime/lib/flows/index.js:104-110` (`load`), `:118-242` (`setFlows`, gałąź `load` `:141-148`), `:434-515`; `@node-red/runtime/lib/flows/util.js` (`diffConfigs`); `@node-red/runtime/lib/api/flows.js:37-38,66-100` (mutex, `reload`); nowy `@node-red/runtime/lib/flows/reload.js`; `@node-red/runtime/lib/coordination/index.js` (Z-10, `claim` slotu); `@node-red/runtime/lib/index.js:239-245,316-328`; `@node-red/util/lib/hooks.js:3-17`; `node-red/settings.js`; `@node-red/runtime/locales/en-US/runtime.json` |
| Powiązania | zewnętrzna wtyczka magazynu implementuje `watchFlows` (poza repozytorium); wydania niezmienne – opcja operacyjna; drenaż do 20 min; ANALIZA §3 (Z-09 mechanizmem podstawowym) |

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
- **Cel:** instancja dowiaduje się o zmianie flow zapisanej w magazynie przez inną instancję i przeładowuje się w miejscu, z drenażem pracy w toku przez `preReload` i sygnałem `/ready` 503 od rozpoczęcia drenażu do końca przeładowania (ZASADY §2.3 B); opcjonalny limit liczby instancji przeładowujących się jednocześnie.
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
 * @property {"full"|"diff"} type      rodzaj przeładowania
 * @property {string[]|null} changedFlows  id flow (zakładek i subflow) zatrzymywanych/zmienianych;
 *                                     null przy "full" (wszystkie)
 * @property {boolean}  credentialsChanged
 * @property {number}   deadline       Date.now() + preReloadTimeout
 * @property {AbortSignal} signal      przerwany przy stopping (SIGTERM w trakcie drenażu) albo przy
 *                                     unieważnieniu przez wdrożenie lokalne (signal.reason: "stopping" | "superseded")
 * @returns {Promise<void>|void}  rozwiązanie = „można przeładować”
 */
```
  Semantyka: handler może jedynie **opóźnić** przeładowanie (np. czekać, aż liczba aktywnych rozmów w `changedFlows` spadnie do zera). Kilka handlerów wykonywanych kolejno (semantyka `hooks.trigger`); limit czasu dotyczy całości.
  - rozwiązanie → przeładowanie;
  - przekroczenie `preReloadTimeout` → `log.warn("reload.hook-timeout")` i **przeładowanie mimo to**;
  - wyjątek / odrzucenie / zwrot `false` → `log.error("reload.hook-failed")` i przeładowanie mimo to (hook nie ma prawa weta – instancja nie może zostać na nieaktualnej konfiguracji; **rozstrzygnięte R-20**; domyślny limit 20 min);
  - `signal` przerwany (SIGTERM) → przeładowanie anulowane, stan `stopping` (E-02);
  - `signal` przerwany przez wdrożenie lokalne (`superseded`) → przeładowanie unieważnione, stan wg wdrożenia (E-02 T5).
  Handler `preReload` wykonywany jest **bez** blokady wdrożeń; hook `preDeploy` przy przeładowaniu z magazynu **nie** jest wywoływany (zmianę zatwierdziła instancja, która ją zapisała), `postDeploy` – tak, z `source: "storage"` (ZASADY §2.3 B krok 6).
- **Wejścia:** powiadomienia `callback`; ustawienia `deploy.reload.*`; aktywna konfiguracja (`flows.getFlows()`).
- **Wyjścia:** przeładowana konfiguracja (pełna lub różnicowa), zdarzenie `runtime-deploy` z nową rewizją (edytory), hook `postDeploy` z `source: "storage"` (Z-06, asynchronicznie), stan E-02 `reloadPending` → `reloading` → `ready`/`failed`/`idle`/`loaded`, logi `reload.*`, wpis audytu `flows.reload` (`source:"storage"`).
- **Algorytm (jeden cykl, zgodnie z ZASADY §2.3 B):**
  1. powiadomienie → jeśli trwa cykl: ustaw `pending = true` i zakończ (koalescencja);
  2. wstępny odczyt `storage.getFlows()` (bez blokady); jeśli `rev === activeRev` i nie `credentialsChanged` → pomiń (własny zapis lub duplikat; `log.debug`); policz `diff = flowUtil.diffConfigs(active, new)` → `changedFlows` (dla `type:"full"` lub `diff.globalConfigChanged` – `null`/pełne);
  3. `state.markReloadPending()` (E-02 T7, **bez blokady i bez tokenu operacji**); przy `deploy.reload.concurrency` (wyłącznie liczba całkowita ≥ 1 – bez wartości procentowych, R-20) – zajęcie slotu przeładowania przez koordynację Z-10 (`claim("reload:slot:<i>", ttl)` dla `i < concurrency`, ponawiane do skutku; `/ready` bez zmian w trakcie oczekiwania); bez ustawienia lub z wtyczką lokalną – slot zawsze dostępny;
  4. `state.markDraining()` (T7a) → `/ready` 503 od tej chwili; `preReload` z limitem `preReloadTimeout` (**poza** blokadą – nie blokuje wdrożeń z edytora przez 20 min);
     wdrożenie (ZASADY §2.3 A) przyjęte na tej instancji w krokach 3–4 **unieważnia** oczekujące przeładowanie: przejście `reloadPending` → `deploying` (T5), przerwanie `signal` (`superseded`), zwolnienie slotu, koniec cyklu (wdrożenie samo ustala nową konfigurację; nowszy zapis w magazynie wygeneruje kolejne powiadomienie);
  5. wejście do wspólnego mutexu E-01 → `state.begin("reload")` (`reloading`, T8) → **ponowny odczyt magazynu** (najnowsza rewizja); rewizja równa aktywnej (bez `credentialsChanged`) lub błąd odczytu → `state.end(token, {aborted:true})` (T8a, powrót do stanu sprzed cyklu, węzły nie zatrzymywane); w przeciwnym razie ponowne policzenie `diff` dla treści odczytanej pod blokadą i zatrzymanie/start wg `type` (E-01 kroki 6–8, bez kroku 5 – brak zapisu do magazynu, bez `forceStart`, **bez `preDeploy`**);
  6. koniec blokady; `state.end()`, zwolnienie slotu, `runtime-deploy`, hook `postDeploy` (`source: "storage"`, asynchronicznie); jeśli `pending` → `pending=false`, nowy cykl od kroku 2.
  Jeśli treść odczytana pod blokadą (krok 5) zmienia flow spoza `changedFlows` przekazanych do `preReload` – `log.warn("reload.changed-during-drain")` i **dodatkowy `preReload` tylko dla tych dodatkowych flow**, w ramach pozostałego limitu `preReloadTimeout` (**D-17, R-20**), wykonywany **poza blokadą** (zwolnienie blokady, powrót do kroku 4 tylko dla dodatkowych flow) – **najwyżej jedna dodatkowa runda**; jeśli po niej treść znów zawiera flow spoza drenowanych – przeładowanie najnowszej rewizji z ostrzeżeniem w logu, bez kolejnego `preReload` (**R-36**).
- **Niezmienniki:**
  - magazyn bez `watchFlows` → zachowanie identyczne z 5.0.7 (brak obserwatora, brak nowych logów);
  - najwyżej jeden cykl naraz; N powiadomień w trakcie cyklu → **jeden** kolejny cykl;
  - przeładowanie nigdy nie zapisuje do magazynu i nigdy nie uruchamia flow zatrzymanych świadomie (`idle` → przeładowanie aktualizuje konfigurację bez startu);
  - zatrzymanie/start węzłów wyłącznie wewnątrz wspólnego mutexu (brak przeplotu z `/flows`, `/flow`, `reload`, `setState`); oczekiwanie na slot i `preReload` – zawsze poza mutexem;
  - uruchamiana jest najnowsza rewizja odczytana **pod blokadą** (krok 5), nie treść z kroku 2;
  - `/ready` 503 od rozpoczęcia drenażu (`preReload`) do końca przeładowania (zgodnie z kryterium zlecenia i E-02); w oczekiwaniu na slot – bez zmian;
  - przy `concurrency = N` i wtyczce koordynacji klastrowej najwyżej N instancji jednocześnie w drenażu lub przeładowaniu;
  - wdrożenie lokalne w trakcie `reloadPending` unieważnia oczekujące przeładowanie;
  - `preDeploy` nie jest wywoływany przy przeładowaniu z magazynu; `postDeploy` – zawsze z `source: "storage"`;
  - po `stopping` żaden cykl nie startuje, trwający jest anulowany przed zatrzymaniem węzłów.
- **Przypadki błędów:**
  - błąd odczytu magazynu (wstępnego – T7b, lub ponownego pod blokadą – T8a z `aborted`) → `log.warn("reload.read-failed")`, stan wraca do sprzed cyklu (działająca konfiguracja bez zmian, `/ready` jak przed cyklem), ponowienie z wykładniczym opóźnieniem `retry.min`…`retry.max`, kolejne powiadomienie resetuje opóźnienie; **po wyczerpaniu `retry.attempts` (domyślnie 10, ~8 min – R-36) → stan `failed` i `/ready` 503** (D-18, **R-20**; działająca konfiguracja nie jest zatrzymywana);
  - błąd startu nowych flow → stan `failed` (E-02), `/ready` 503, log (jak wdrożenie);
  - odrzucenie `claim` slotu (brak łączności z koordynatorem) → instancja pozostaje w `reloadPending` bez drenażu (stara konfiguracja, `/ready` bez zmian), ponowienie z opóźnieniem + `log.warn` (**R-20** – przeładowanie czeka, działa stara konfiguracja; lepiej opóźnić przeładowanie niż przekroczyć limit równoległości); `concurrency` bez wtyczki koordynacji klastrowej → brak efektu + `log.warn` przy starcie;
  - wyjątek w `callback` wtyczki / wywołanie po `stop()` → ignorowane z `log.debug`;
  - `watchFlows` odrzuca przy rejestracji (przy `deploy.reload.watch: true`) → **błąd startu** runtime z komunikatem (`log.error`) (**R-36**).
- **Skutki uboczne:** zdarzenie `runtime-deploy` → edytory połączone z instancją dostają powiadomienie o nowych flow (polityka P-02); wpis audytu; dodatkowy odczyt magazynu na powiadomienie (w tym własne zapisy – odrzucane po porównaniu rewizji).

#### Projekt rozwiązania (minimalny)
1. `storage/index.js`: `watchAvailable = typeof storageModule.watchFlows === "function"`; `storageModuleInterface.watchFlows(cb)` tylko gdy dostępne (opakowanie z `try/catch`), `storageModuleInterface.hasWatchFlows()`.
2. Wspólny mutex: przeniesienie `mutex` z `api/flows.js:37-38` do modułu współdzielonego (np. `runtime/lib/flows/lock.js`, nazwa wg E-01), używanego przez API i przeładowanie.
3. `flows/index.js`: nowa funkcja wewnętrzna `reloadFromStorage(loaded, {type})` – przyjmuje treść odczytaną **pod blokadą** (krok 5), liczy `diff`, wykonuje `stop(type,diff)` → `context.clean` → `start(type,diff)` z `await` (E-01) bez zapisu, bez `forceStart` i bez `preDeploy`; dla `type:"full"` – jak gałąź `load`; credentials przez `credentials.load(loaded.credentials)`. Mechanizm „odczyt z magazynu zamiast zapisu” wspólny z typem `reload` Admin API (E-01, scalenie z Z-06).
4. `runtime/lib/flows/reload.js`: obserwator (fazy `idle/waitingSlot/draining/applying` + flaga `pending`, bufor powiadomień do końca startu, porównanie rewizji, zajęcie slotu przez `runtime.coordination.claim` przy `concurrency` – z `renew` na czas drenażu, `preReload` z `Promise.race` + `AbortController`, przerwanie przy przejściu `reloadPending` → `deploying` (słuchacz `state.onChange`) lub `stopping`, ponowienia), `init(runtime)`, `start()` (po pierwszym starcie flow), `stop()` (abort + wyrejestrowanie).
4a. Po przeładowaniu: `runtime-deploy` i wywołanie `postDeploy` mechanizmem Z-06 z `source: "storage"` (bez `preDeploy`).
5. `runtime/lib/index.js`: rejestracja `watchFlows` (gdy `deploy.reload.watch`) po `storage.init`, przed `loadFlows()` (`:241`); `reload.stop()` na początku `stop()` (po `markStopping`).
6. `util/lib/hooks.js`: `"preReload"` w `VALID_HOOKS` (sekcja z Z-06) + JSDoc payloadu.
7. Szablon `settings.js`: blok `deploy.reload` z opisem; CHANGELOG; dokumentacja kontraktu `watchFlows` dla autorów wtyczek magazynu (JSDoc + przykład atrapy w testach).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Przeładowanie flow po zmianie w magazynie

  Scenariusz: Powiadomienie powoduje przeładowanie (kryterium zlecenia)
    Zakładając atrapę magazynu z watchFlows, deploy.reload.watch = true i działające flow w rewizji "A"
    Kiedy inna instancja zapisze rewizję "B" i atrapa wywoła callback
    Wtedy runtime wczyta flow z magazynu i uruchomi rewizję "B"
    I zdarzenie runtime-deploy zawiera rewizję "B"
    I nic nie zostanie zapisane do magazynu

  Scenariusz: Hook preReload opóźnia przeładowanie (kryterium zlecenia)
    Zakładając hook preReload, który kończy się dopiero po sygnale testu
    Kiedy magazyn powiadomi o zmianie
    Wtedy węzły nie są zatrzymywane, dopóki hook się nie zakończy
    I GET /health/ready zwraca 503 od wywołania hooka przez cały czas oczekiwania
    I blokada wdrożeń nie jest zajęta
    Kiedy hook się zakończy
    Wtedy flow zostaną przeładowane pod blokadą i GET /health/ready zwróci 200

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

  Scenariusz: Wdrożenie w trakcie preReload unieważnia przeładowanie
    Zakładając hook preReload oczekujący na zakończenie rozmów
    Kiedy klient wyśle POST /flows
    Wtedy wdrożenie zostanie wykonane bez czekania na hook
    I hook otrzyma przerwany signal z powodem "superseded"
    I przeładowanie z magazynu nie zostanie wykonane, a stan przejdzie "reloadPending" → "deploying" → "ready"

  Scenariusz: Ponowny odczyt magazynu pod blokadą
    Zakładając preReload dla rewizji "B" i zapis rewizji "C" w magazynie w trakcie drenażu
    Kiedy hook się zakończy
    Wtedy pod blokadą wdrożeń magazyn zostanie odczytany ponownie
    I uruchomiona zostanie rewizja "C"

  Scenariusz: Przeładowanie wywołuje postDeploy, nie preDeploy
    Zakładając zarejestrowane hooki preDeploy i postDeploy (Z-06)
    Kiedy instancja przeładuje flow z magazynu
    Wtedy preDeploy nie zostanie wywołany
    I postDeploy zostanie wywołany z source "storage" po zdarzeniu runtime-deploy

  Scenariusz: Limit równoległości przeładowań (atrapa koordynacji)
    Zakładając trzy instancje ze wspólną atrapą koordynacji (Z-10) i deploy.reload.concurrency = 1
    I hook preReload na każdej instancji, który kończy się po sygnale testu
    Kiedy magazyn powiadomi wszystkie instancje o rewizji "B"
    Wtedy w danej chwili najwyżej jedna instancja wywołuje preReload i zwraca /health/ready 503
    I pozostałe instancje czekają na slot i zwracają /health/ready 200
    Kiedy kolejne hooki będą kończone
    Wtedy instancje przeładują się po kolei i wszystkie uruchomią rewizję "B"

  Scenariusz: Limit równoległości bez wtyczki klastrowej
    Zakładając deploy.reload.concurrency = 1 i wtyczkę koordynacji lokalną
    Kiedy runtime się uruchomi
    Wtedy w logu pojawi się ostrzeżenie, że limit nie ma efektu
    I przeładowanie działa jak bez limitu

  Scenariusz: Przeładowanie różnicowe nie przerywa niezmienionych flow
    Zakładając deploy.reload.type = "diff" i rozmowę trwającą w flow "t2"
    Kiedy w magazynie zmieni się tylko flow "t1"
    Wtedy zatrzymane i uruchomione zostanie tylko flow "t1"
    I rozmowa w flow "t2" nie zostanie przerwana

  Scenariusz: Wartość domyślna type
    Zakładając deploy.reload bez pola type
    Kiedy magazyn powiadomi o zmianie
    Wtedy wykonane zostanie przeładowanie pełne ("full")

  Scenariusz: Hook otrzymuje rewizję i listę zmienionych flow
    Zakładając deploy.reload.type = "diff"
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

  Scenariusz: Wyczerpanie ponowień odczytu (R-20, D-18)
    Zakładając deploy.reload.retry = { min: 10, max: 40, attempts: 3 } i magazyn stale odrzucający getFlows
    Kiedy magazyn powiadomi o zmianie
    Wtedy po 3 nieudanych próbach stan instancji będzie "failed"
    I GET /health/ready zwróci 503
    I działające flow nie zostaną zatrzymane

  Scenariusz: Brak łączności z koordynatorem – przeładowanie czeka (R-20)
    Zakładając deploy.reload.concurrency = 1 i atrapę koordynacji odrzucającą claim
    Kiedy magazyn powiadomi o zmianie
    Wtedy instancja pozostanie w stanie "reloadPending" bez drenażu na starej konfiguracji
    I GET /health/ready zwróci 200
    I runtime ponowi zajęcie slotu z opóźnieniem

  Scenariusz: Dodatkowy preReload dla flow zmienionych w trakcie drenażu (D-17, R-20)
    Zakładając deploy.reload.type = "diff", preReload dla changedFlows ["t1"] i zapis zmiany flow "t2" w trakcie drenażu
    Kiedy hook się zakończy i magazyn zostanie odczytany ponownie
    Wtedy preReload zostanie wywołany ponownie z changedFlows ["t2"] i limitem pozostałym z preReloadTimeout, poza blokadą wdrożeń (R-36)
    I uruchomiona zostanie najnowsza rewizja

  Scenariusz: Najwyżej jedna dodatkowa runda preReload (R-36)
    Zakładając deploy.reload.type = "diff" i kolejne zmiany innych flow zapisywane w trakcie każdego drenażu
    Kiedy zakończy się dodatkowy preReload, a treść znów zawiera flow spoza drenowanych
    Wtedy preReload nie zostanie wywołany po raz trzeci
    I uruchomiona zostanie najnowsza rewizja z ostrzeżeniem w logu

  Scenariusz: Domyślna liczba ponowień odczytu (R-36)
    Zakładając deploy.reload.retry bez attempts i magazyn stale odrzucający getFlows
    Kiedy magazyn powiadomi o zmianie
    Wtedy po 10 nieudanych próbach stan instancji będzie "failed"

  Scenariusz: Błąd rejestracji watchFlows blokuje start (R-36)
    Zakładając deploy.reload.watch = true i magazyn, którego watchFlows odrzuca rejestrację
    Kiedy runtime się uruchamia
    Wtedy start kończy się błędem z komunikatem w logu

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
- Jednostkowe, nowy `test/unit/@node-red/runtime/lib/flows/reload_spec.js` (atrapa magazynu z `watchFlows`, sinon fake timers): `notification triggers reload from storage`, `no save on reload`, `skips when rev equals active`, `reloads on credentialsChanged with same rev`, `coalesces notifications during reload into one`, `buffers notifications during startup`, `preReload delays stop`, `preReload timeout proceeds with warning`, `preReload error proceeds with error log`, `preReload receives rev, activeRev, type, changedFlows, deadline, signal`, `payload is frozen`, `abort on stop cancels reload`, `local deploy during reloadPending supersedes reload`, `rereads storage under lock and applies newest rev`, `no preDeploy, postDeploy with source storage`, `concurrency waits for slot without draining`, `slot released after reload and on supersede`, `claim rejection keeps old config and retries`, `concurrency without cluster plugin warns`, `type defaults to full`, `watch false – no watcher`, `read failure retries with backoff and keeps flows`, `read failure after retry.attempts sets failed and ready 503` (R-20), `concurrency accepts only numbers` (R-20), `additional preReload for flows changed during drain within remaining timeout` (D-17), `additional preReload runs outside lock, at most one round, then reload with warning` (R-36), `retry.attempts defaults to 10` (R-36), `watchFlows registration failure fails start when watch true` (R-36), `idle state updates config without start`, `start errors set failed`.
- `test/unit/@node-red/runtime/lib/storage/index_spec.js`: `exposes watchFlows when module provides it`, `hasWatchFlows false without it`, `callback exceptions are contained`.
- Integracyjny „limit równoległości”: `test/unit/@node-red/runtime/lib/flows/reload_concurrency_spec.js` – trzy obserwatory ze wspólną atrapą koordynatora w pamięci (jak `multi_instance_spec.js` Z-10), fake timers: `at most concurrency instances draining`, `others ready 200 while waiting`.
- `test/unit/@node-red/runtime/lib/flows/index_spec.js`: `reloadFromStorage type diff restarts only changed flows`, `reloadFromStorage full restarts all`, `globalConfigChanged forces full`.
- `test/unit/@node-red/runtime/lib/api/flows_spec.js`: `reload and api deploy share one mutex` (kolejność zdarzeń), `preReload wait does not hold mutex`.
- `test/unit/@node-red/runtime/lib/index_spec.js`: `watchFlows registered before first loadFlows`, `unwatch called on stop`, `storage without watchFlows – no watcher`.
- `test/unit/@node-red/util/lib/hooks_spec.js`: `allows preReload hook`.

#### DoD specyficzne
- [ ] Kontrakt `watchFlows` i payload `preReload` w JSDoc i dokumentacji dla autorów wtyczek magazynu.
- [ ] Test „magazyn bez `watchFlows` = brak zmian” (logi, zdarzenia, wywołania).
- [ ] Wszystkie cztery kryteria odbioru zlecenia jako testy z atrapą magazynu.
- [ ] Limit `preReloadTimeout` konfigurowalny, wartość ≥ 20 min dozwolona i udokumentowana (przykład dla rozmów do ~15 min).
- [ ] Przeładowanie przechodzi przez wspólny mutex E-01 (test kolejności); `preReload` i oczekiwanie na slot – poza mutexem.
- [ ] `deploy.reload.type` domyślnie `"full"`; `"diff"` udokumentowane jako zalecane dla długich rozmów.
- [ ] `deploy.reload.concurrency` (tylko liczba) z testem na atrapie koordynacji (Z-10); brak łączności z koordynatorem → czekanie (R-20).
- [ ] `deploy.reload.retry: { min, max, attempts }` w szablonie `settings.js` (`attempts` domyślnie 10 – R-36); po wyczerpaniu `failed` + 503 (R-20, D-18).

#### Ryzyka i alternatywy
- **Wszystkie workery jednocześnie 503:** powiadomienie dociera do wszystkich instancji naraz; przy `/ready` 503 od rozpoczęcia drenażu (wymóg zlecenia „503 na czas przeładowania”, E-02 T7a) i drenażu do 20 min cały Deployment mógłby przestać przyjmować ruch. Rozwiązanie (D-10): `deploy.reload.concurrency` – zajęcie slotu przez koordynację Z-10 **przed** drenażem (instancje czekające na slot zwracają 200), oraz `type: "diff"` – drenaż i restart tylko zmienionych flow. Bez wtyczki koordynacji klastrowej limit nie działa (ostrzeżenie); alternatywa operacyjna: wydania niezmienne + rolling update.
- **Pełne vs różnicowe:** dziś `load(true)` = pełny restart – przerywa wszystkie rozmowy także w niezmienionych flow (przy rozmowach ~15 min istotne). Rozstrzygnięcie (ZASADY §2.1, D-10): oba tryby, `type: "full" | "diff"`, **domyślnie `"full"`** (semantyka 5.0.6), **zalecane `"diff"`** dla wdrożeń z długimi rozmowami. Ograniczenia różnicowego: zmiana globalnych configów → pełny (jak `setFlows`); diff nie widzi zmian samych poświadczeń (poświadczenia nie są w konfiguracji węzłów przy `load`) → przy `credentialsChanged` pełny restart lub restart węzłów, których poświadczenia się zmieniły (**do potwierdzenia** w implementacji).
- **Rewizja bez poświadczeń** (`storage/index.js:80`): bez `credentialsChanged` od wtyczki zmiana hasła w węźle konfiguracyjnym nie zostanie przeładowana (pominięcie jako „własny zapis”). Wymaganie dla zewnętrznych wtyczek magazynu.
- **Wdrożenie lokalne w trakcie drenażu:** rozstrzygnięte w ZASADY §2.3 B – wdrożenie unieważnia oczekujące przeładowanie (brak ryzyka cofnięcia świeżego wdrożenia); kosztem jest przerwany drenaż na tej instancji (dotyczy głównie instancji z edytorem, gdzie `deploy.reload.watch` domyślnie wyłączone).
- **Instancja z edytorem:** dostaje powiadomienia o własnych zapisach (pomijane po rewizji) i o zapisach innych klientów (np. MCP/CI przez inną instancję) – edytor pokaże powiadomienie o zmianie flow (`runtime-deploy`). W naszej architekturze publikacja idzie przez Admin API edytora – na edytorze `deploy.reload.watch` pozostaje wyłączone (domyślnie `false`).
- **Hook bez prawa weta:** zwrot `false` w innych hookach oznacza zatrzymanie – tu przeładowanie mimo to (spójność klastra ważniejsza). **Rozstrzygnięte (R-20).**
- **Przełączenie projektu** (`projects/index.js:396`) nadal omija mutex – poza zakresem (Projekty i magazyn klastrowy się wykluczają), odnotowane.
- Alternatywa: obserwator wywołujący `api.flows.setFlows({deploymentType:"reload"})` – prostsza, ale brak hooka, diffu, pominięcia własnych zapisów i 503; odrzucona jako niewystarczająca (zostaje jako krok przejściowy).

#### Podzadania
- [ ] Wspólny mutex (wydzielenie z `api/flows.js`) – S
- [ ] `storage/index.js`: wykrycie i opakowanie `watchFlows` – S
- [ ] `flows/index.js`: `reloadFromStorage` (full + diff, bez zapisu, bez `forceStart`, bez `preDeploy`) – M
- [ ] `flows/reload.js`: koalescencja, bufor startowy, porównanie rewizji, `reloadPending` bez blokady, unieważnienie przez wdrożenie, ponowny odczyt pod blokadą, ponowienia z `attempts` i stanem `failed` (R-20), dodatkowy `preReload` (D-17) – M
- [ ] `deploy.reload.concurrency`: slot przez koordynację Z-10 + test z atrapą trzech instancji – M
- [ ] `postDeploy` z `source: "storage"` (mechanizm Z-06) – S
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
| Ustawienie | typ wtyczki `node-red-coordination`; wybór wtyczki: `coordination: { plugin: "<id>", options: {...} }` (brak → wtyczka lokalna) – wybór **tylko jawny** (R-21; nazwy wg D-02); w węźle `inject` nowa właściwość `singleInstance` (domyślnie `false`) |
| Zależności | E-02 (oddanie przywództwa w `stopping`); punkt startu wspólny z Z-09 (`runtime/lib/index.js:239-247`) |
| Pliki | nowy `@node-red/runtime/lib/coordination/index.js` + `local.js`; `@node-red/runtime/lib/index.js:140` (init przed `redNodes.load()` `:166`), `:239-247` (gotowość przed `startFlows`), `:316-328` (stop); `@node-red/registry/lib/plugins.js:21-57`; `@node-red/registry/lib/util.js:85-104` (`createNodeApi` → `RED.coordination`); `@node-red/nodes/core/common/20-inject.js:75-95` (timery), `:168-177` (`close`), `20-inject.html` + `locales/en-US/common/20-inject.{json,html}`; `node-red/settings.js`; `@node-red/runtime/locales/en-US/runtime.json` |
| Powiązania | flow singletonowe przy wielu instancjach; kolejki – uzupełnienie (poza rdzeniem) |

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
  - cron: przed `emit` w callbacku `scheduleTask` – `claim("inject:<nodeId>:<czas zaplanowany ISO>", ttl)`; `Claim` → wyzwolenie; `null` → pominięcie; odrzucenie → pominięcie + `node.warn` (zachowanie bezpieczne). Daje „dokładnie raz” na wyzwolenie bez lidera (D-14, R-21). TTL = min(okres crona, 1 h) – **do potwierdzenia**;
  - interwał i „raz po starcie”: gating przywództwem (`isLeader()` w callbacku timera) – fazy `setInterval` różnią się między instancjami, więc klucz „slotu” `floor(now/interval)` dawałby zdublowane lub pominięte wyzwolenia na granicy slotu (**D-14, R-21**);
  - przycisk ręczny (`POST /inject/:id`) i wejście z innych węzłów – **bez** koordynacji;
  - status węzła: przy `singleInstance` i braku przywództwa – `status({fill:"grey", text:"standby"})` (**R-21**; tekst z `locales/en-US/common/20-inject.json`); po uzyskaniu przywództwa status czyszczony.
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

  Scenariusz: Status "standby" bez przywództwa (R-21)
    Zakładając dwie instancje ze wspólną atrapą, z których A jest liderem, i inject z interwałem oraz singleInstance
    Wtedy węzeł inject w instancji B ma status "standby"
    Kiedy instancja A zostanie zatrzymana i B zostanie liderem
    Wtedy status "standby" w instancji B zostanie wyczyszczony

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
- `test/nodes/core/common/20-inject_spec.js` (node-red-node-test-helper, atrapa `RED.coordination`): `singleInstance cron claims nodeId:scheduledTime`, `singleInstance cron skips when claim null`, `singleInstance cron skips and warns on claim rejection`, `singleInstance interval fires only when leader`, `once fires only when leader`, `manual button not gated`, `default (no singleInstance) unchanged`, `shows standby status when not leader and clears it on leadership` (R-21).
- Integracyjny „dwa runtime'y”: nowy `test/unit/@node-red/runtime/lib/coordination/multi_instance_spec.js` – dwie instancje fasady koordynacji ze wspólną atrapą koordynatora w pamięci i dwa węzły `inject` (fake timers): `fires exactly once across instances`, `takeover after leader stop`. Pełny wariant z dwoma procesami (`child_process.fork`, atrapa koordynatora w procesie nadrzędnym przez IPC) – runtime jest singletonem modułów, więc dwa runtime'y w jednym procesie nie są możliwe. **R-21:** w `npm test` – test dwóch instancji w jednym procesie; wariant wieloprocesowy w **osobnym podzbiorze testów** (poza `npm test`, uruchamiany osobno – nazwa skryptu do ustalenia).

#### DoD specyficzne
- [ ] Interfejs wtyczki i `RED.coordination` w JSDoc + dokumentacja dla autorów wtyczek i węzłów (z przykładem gatingu nasłuchu kolejki).
- [ ] Testy obu stanów (`singleInstance` wł./wył.; wtyczka lokalna / atrapa klastrowa).
- [ ] Przycisk ręczny `inject` niegatkowany – test.
- [ ] Teksty UI en-US; brak zmian eksportu flow dla węzłów bez opcji.
- [ ] Wymóg wspólnej strefy czasowej instancji opisany w dokumentacji opcji.
- [ ] Status „standby” z tekstem en-US (R-21); test wieloprocesowy w osobnym podzbiorze, nie w `npm test` (R-21).

#### Ryzyka i alternatywy
- **Nowe publiczne API** (typ wtyczki, `RED.coordination`) – zobowiązanie utrzymaniowe; projekt minimalny (lider + zajęcie klucza), bez kolejek i blokad rozproszonych ogólnego przeznaczenia.
- **Rozjazd zegarów:** klucz crona oparty na czasie zaplanowanym jest identyczny na instancjach przy tej samej strefie czasowej; różnica zegarów przesuwa tylko moment wyzwolenia, TTL musi przekraczać maksymalny rozjazd. Różne strefy czasowe instancji → różne klucze → zdublowanie (dokumentacja). Wygaśnięcie dzierżawy liczy koordynator, nie lokalny zegar.
- **Zmiana lidera w trakcie wykonania:** dla `inject` wyzwolenie jest natychmiastowe (bez skutku); dla długich zadań węzłów z palety – autor musi reagować na `onLeaderChange(false)` lub `renew()` → `false`. Okno „dwóch liderów” przy podziale sieci zależy od implementacji wtyczki (fencing poza zakresem) – dokumentacja.
- **Interwał/„raz po starcie” przez przywództwo** vs claim slotu – **rozstrzygnięte (D-14, R-21): przywództwo**. „Raz po starcie” przy restarcie lidera wyzwoli się ponownie – zgodne z semantyką „po starcie”.
- **Wybór jawny vs automatyczny:** automatyczne użycie jedynej zainstalowanej wtyczki byłoby wygodne, ale zmienia zachowanie po instalacji modułu – **rozstrzygnięte (R-21): tylko jawnie** (`coordination.plugin`).
- **Kolejki** – Z-10 nie zastępuje kolejek: odbiorcy kolejek z rozdziałem pracy (konsumenci współdzielący kolejkę) nie potrzebują przywództwa; dla subskrypcji bez rozdziału (np. MQTT bez współdzielonych subskrypcji) węzły mogą użyć `RED.coordination.onLeaderChange`. Węzły core poza `inject` (np. `mqtt in`) – **poza zakresem; `mqtt in` w osobnym pakiecie (R-21)**.
- Alternatywa: osobny Deployment z 1 repliką dla flow singletonowych – zostaje jako obejście operacyjne, ale wymaga podziału flow.

#### Podzadania
- [ ] Wtyczka lokalna + testy – S
- [ ] Moduł koordynacji (wybór, start/stop/resign, fasada węzłów) – M
- [ ] Kolejność startu/zatrzymania w `runtime/lib/index.js` – S
- [ ] `RED.coordination` w `createNodeApi` – S
- [ ] `inject`: `singleInstance` (cron – claim, interwał/once – lider), UI, teksty – M
- [ ] Test dwóch instancji w jednym procesie (atrapa koordynatora) w `npm test`; wariant wieloprocesowy w osobnym podzbiorze (R-21) – L
- [ ] Dokumentacja API, szablon `settings.js`, CHANGELOG – S

#### Realizacja (2026-10-03, gałąź `feature/p3-database`)
- Commity: `7efceb5` (API koordynacji, wtyczka lokalna, kolejność start/stop, `RED.coordination` w `createNodeApi`), `34c5e67` (`inject` – `singleInstance`, test dwóch instancji w jednym procesie), commit dokumentacji (`settings.js`, CHANGELOG, MODIFICATIONS, ta notka).
- Weryfikacja stanu: callback `cronosjs.scheduleTask` dostaje **czas zaplanowany** (`dist-node/index.js` – `_runTask()` emituje `_timestamp`) – potwierdzone.
- Rozstrzygnięcia „do potwierdzenia” przyjęte w implementacji (do akceptacji):
  - TTL zajęcia crona = okres wyrażenia ograniczony do **[1 min, 1 h]** (karta: `min(okres, 1 h)`) – dolna granica 1 min daje tolerancję rozjazdu zegarów przy cronie co sekundę;
  - eksport flow: `singleInstance` zapisywane przez edytor tylko przy `true` (`defaults` bez wartości, pole poza wiązaniem `node-input-*`) – istniejące flow eksportują się bez zmian;
  - dwie wtyczki o tym samym id – bez zmian w rejestrze (ostatnia rejestracja wygrywa, jak dotąd);
  - status „standby” – tylko dla wyzwoleń bramkowanych przywództwem (interwał, „raz po starcie”); cron (zajęcie klucza) nie pokazuje statusu, bo może wyzwolić się na dowolnej instancji.
- Uzupełnienia względem karty: `ctx.processId` (losowy na proces) obok `instanceId` – `instanceId` z ustawień jest wspólny dla instancji na wspólnym magazynie; `runtime.coordination.claimSlot(name, limit, ttlMs)` (klucze `slot:<name>:<i>`) jako punkt dla `deploy.reload.concurrency` (Z-09); błąd `coordination.plugin-invalid` dla wtyczki bez wymaganych funkcji; `err.code` błędów startu = `coordination.plugin-not-found` / `coordination.plugin-invalid`.
- Rozbieżności / poza zakresem: `resign()` wołane na początku `runtime.stop()` (stan `stopping` z E-02 jeszcze nie na gałęzi – przy scaleniu z E-02 przenieść do `markStopping`); teksty `inject` w `nodes/locales/en-US/messages.json` (brak pliku `locales/en-US/common/20-inject.json`), pomoc w `locales/en-US/common/20-inject.html`; klucz zarezerwowany `coordination` dla `registerNodeSettings` (D-02 U8) – nie w tym pakiecie (`runtime/lib/settings.js`); wariant wieloprocesowy testu – niezrealizowany (opcjonalny podzbiór poza `npm test`, R-21); pole w edytorze nie sprawdzone w przeglądarce.

---

### Z-11 – Praca z katalogiem użytkownika tylko do odczytu

| Pole | Wartość |
|---|---|
| Etap / typ | 3 / funkcja |
| Priorytet / ryzyko | P2 / średnie |
| Ustawienie | `readOnlyUserDir: false` (bez zmian względem zlecenia); zmienna środowiskowa CLI `NODE_RED_READ_ONLY_USER_DIR` (R-33, ZASADY §2.1) równoważna `readOnlyUserDir: true`, czytana przed wyborem pliku ustawień (**R-18**) |
| Zależności | Z-03 (ujednolicone ustawienia uploadu i **nowy kod `upload_not_allowed`** definiowany w Z-03 – ZASADY §2.4) |
| Pliki | `node-red/red.js:121-157` (wybór/kopiowanie `settings.js`, `:151`); `@node-red/runtime/lib/index.js:135-248` (komunikaty startu, `:167-215,:268` autoinstalacja); `@node-red/registry/lib/installer.js:221,239,274,361,426-485,516,544,575-600`; `@node-red/registry/lib/externalModules.js:35,43,72-73,228-277`; `@node-red/runtime/lib/nodes/context/localfilesystem.js:70-95` (`getBasePath`), `:145-146,202,231,387,412,415`; `@node-red/runtime/lib/nodes/context/index.js:80-180`; `@node-red/runtime/lib/storage/localfilesystem/index.js:36-71`, `settings.js:75,83,117,127`, `sessions.js:47-50`, `library.js:148-172`, `projects/index.js:129-130,607,626,651,662`, `util.js:89-118`; `node-red/settings.js`; `@node-red/runtime/locales/en-US/runtime.json` |
| Powiązania | obraz z systemem plików tylko do odczytu; węzły używające `fs` (poza zakresem) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE** – 16 miejsc zapisu (tabela poniżej, z WERYFIKACJA Z-11).

| # | Miejsce | Co | Kiedy | Wyłączenie dziś | Przy `readOnlyUserDir: true` (propozycja) |
|---|---|---|---|---|---|
| 1 | `node-red/red.js:151` | kopia `settings.js` do `~/.node-red` | start CLI bez pliku ustawień – niezależnie od magazynu | `--settings` / `--userDir` z settings.js | **nie da się sterować z `settings.js`** (kopiowanie przed wczytaniem ustawień) – sterowanie zmienną środowiskową `NODE_RED_READ_ONLY_USER_DIR` (R-18): brak kopiowania; dodatkowo błąd kopiowania → użycie domyślnego pliku + ostrzeżenie zamiast awarii; zalecenie `--settings` |
| 2 | `registry/lib/installer.js:443` | `<userDir>/nodes/<name>-<ver>.tgz` | upload | `externalModules.palette.allowUpload:false` | wyłączone (kod `upload_not_allowed` – nowy kod z Z-03, ZASADY §2.4; dziś `Error` bez kodu) |
| 3 | `installer.js:477-479` | `os.tmpdir()/nr-tarball-*` | upload | jw. | wyłączone razem z uploadem |
| 4 | `installer.js:470` | usunięcie starego tgz | aktualizacja z uploadu | jw. | wyłączone |
| 5 | `installer.js:239` | `npm install --save` | instalacja/aktualizacja z palety | `palette.allowInstall/allowUpdate:false`, listy, `preInstall`→`false` | wyłączone (`install_not_allowed`, `update_not_allowed`) |
| 6 | `installer.js:274,544` | `npm remove` | wycofanie, odinstalowanie | `palette.allowInstall:false` | wyłączone |
| 7 | `runtime/lib/index.js:167-215,268` | instalacja brakujących modułów | start / ponowienia | `externalModules.autoInstall` | wyłączone (ignorowane z ostrzeżeniem) |
| 8 | `registry/lib/externalModules.js:228,232` | `ensureDir(userDir)`, `package.json` | pierwszy moduł węzła Function | `externalModules.modules.allowInstall:false` | wyłączone; moduły już obecne w obrazie nadal używalne |
| 9 | `externalModules.js:277` | `npm install` | `libs` węzła Function | jw. | wyłączone |
| 10 | `runtime/lib/nodes/context/localfilesystem.js:145-146,202,231,387,412,415` | `context/**.json` | zapis/flush kontekstu | tylko gdy `contextStorage` = localfilesystem | gdy katalog kontekstu leży w katalogu chronionym → błąd startu (**R-18**, D-15); `dir` poza nim – dozwolone |
| 11 | `storage/localfilesystem/index.js:50,69` | `node_modules`, `package.json` | init magazynu | własny magazyn / `readOnly` | pominięte (jak `readOnly`) |
| 12 | `storage/localfilesystem/projects/index.js:626,662` (`util.js:89-118`) | flow, poświadczenia, `.backup` | deploy | jw. | wdrożenie odrzucone 400 `read_only_user_dir` (**R-18**; `readOnly` dziś pomija zapis po cichu) |
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
- **Wejścia:** `readOnlyUserDir` (domyślnie `false`); zmienna środowiskowa `NODE_RED_READ_ONLY_USER_DIR` (R-33; R-18 – równoważna `readOnlyUserDir: true`, działa także dla kroku CLI #1); `userDir` (może być nieustawiony); ustawienia `externalModules`, `contextStorage`, `editorTheme.projects`, `readOnly`; wybrany magazyn.
- **Katalogi chronione:** `settings.userDir`, a gdy nieustawiony – katalogi zastępcze używane dziś przez runtime: `NODE_RED_HOME`, katalog bieżący (`.`), `~/.node-red` (jak `HOMEPATH`/`HOME`). Bezwzględny `flowFile` jest chroniony niezależnie od ścieżki – zapis flow/poświadczeń przez magazyn plikowy odrzucany `read_only_user_dir` (**R-40**). Pozostałe ścieżki jawnie skonfigurowane poza katalogami chronionymi (`contextStorage.*.config.dir`) nie są chronione. `os.tmpdir()` – nie jest chroniony, ale jedyny zapis tam (#3) jest wyłączony razem z uploadem.
- **Wyjścia:**
  - przy starcie jeden blok logu `readonly-userdir.enabled` z listą wyłączonych funkcji (instalacja/aktualizacja/usuwanie/upload z palety, autoinstalacja, instalacja modułów węzła Function, Projekty, zapis ustawień/sesji/biblioteki w magazynie plikowym, wdrożenie przy magazynie plikowym);
  - efektywne wartości: `externalModules.palette.allowInstall=false`, `allowUpload=false`, `allowUpdate=false`, `externalModules.modules.allowInstall=false`, `externalModules.autoInstall=false` (nadpisanie z ostrzeżeniem, jeśli ustawiono `true`), `editorTheme.projects.enabled=false`;
  - edytor: paleta bez instalacji (jak przy `allowInstall:false` – istniejące zachowanie UI);
  - próba operacji w trakcie działania (Admin API) → istniejące kody `install_not_allowed`/`update_not_allowed`/`module_not_allowed`, dla uploadu – kod `upload_not_allowed` z Z-03 (nowy, ZASADY §2.4), dla zapisu biblioteki i wdrożenia przy magazynie plikowym – nowy kod `read_only_user_dir` (400).
- **Niezmienniki:**
  - przy `true`: zero wywołań zapisu (`writeFile`, `outputFile`, `ensureDir`, `copy`, `rename`, `remove`, `npm install/remove`) w katalogach chronionych – w trakcie startu, wdrożenia, logowania, zapisu ustawień użytkownika i biblioteki;
  - przy `false`: zachowanie identyczne z 5.0.7 (w tym `readOnly`);
  - własny magazyn (np. w bazie) – wdrożenie, ustawienia, sesje działają normalnie (idą do magazynu);
  - flagi wyłączające są tylko zawężane (`readOnlyUserDir` nigdy nie włącza funkcji wyłączonej przez inne ustawienie).
- **Przypadki błędów:**
  - `contextStorage` z modułem `localfilesystem`, którego katalog leży w katalogu chronionym → błąd startu z komunikatem wskazującym `contextStorage.<nazwa>.config.dir` (**rozstrzygnięte R-18, D-15** – bez cichego przełączenia na `memory`);
  - magazyn plikowy (`localfilesystem`) + `readOnlyUserDir` → start dozwolony (flow z obrazu), wdrożenie odrzucone 400 `read_only_user_dir` zamiast cichego pominięcia jak `readOnly` (**rozstrzygnięte R-18**);
  - `readOnlyUserDir: true` + `editorTheme.projects.enabled: true` → Projekty wyłączone + ostrzeżenie;
  - CLI: przy zmiennej `NODE_RED_READ_ONLY_USER_DIR` – brak próby kopiowania `settings.js` (#1), użycie domyślnego pliku z pakietu (R-18); niezależnie od zmiennej błąd kopiowania (#1) → `console.warn` i użycie domyślnego `settings.js` z pakietu (zamiast wyjątku) – zmiana tylko w ścieżce błędu.
- **Skutki uboczne:** sesje tylko w pamięci przy magazynie plikowym (wylogowanie po restarcie); `instanceId` i `_credentialSecret` generowane przy starcie nie są utrwalane w magazynie plikowym (poświadczenia zaszyfrowane wygenerowanym kluczem nie zostaną zapisane – wdrożenie i tak odrzucone) – dokumentacja.

#### Projekt rozwiązania (minimalny)
1. Nowy moduł `@node-red/util/lib/readOnlyDir.js` (lub w `runtime/lib/settings.js` – **do potwierdzenia**): `isEnabled(settings)`, `protectedDirs(settings)`, `isProtected(path)`, `assertWritable(path, feature)` → błąd `read_only_user_dir`.
2. `runtime/lib/index.js` `start()`: przed `storage.init` – wyliczenie efektywnych flag `externalModules.*`, `editorTheme.projects.enabled`, log bloku `readonly-userdir.enabled`; walidacja `contextStorage` (przed `loadContextsPlugin`).
3. Magazyn plikowy: `readOnlyUserDir` traktowany jak `readOnly` dla #11, #13, #14 (pominięcie); #12 i #15 – odrzucenie `read_only_user_dir` (nie ciche pominięcie).
4. `registry/lib/installer.js`, `externalModules.js`: kontrola `assertWritable` na wejściu `installModule`, `installTarball`, `uninstallModule`, `ensureModuleDir`/`installModules` (obrona w głąb – niezależnie od flag z pkt 2).
5. `context/localfilesystem.js`: kontrola w `open()` (przed `ensureDir`) – błąd z nazwą magazynu.
6. `node-red/red.js:121-157`: odczyt zmiennej `NODE_RED_READ_ONLY_USER_DIR` przed wyborem pliku ustawień (R-18) – pominięcie kopiowania i ustawienie `readOnlyUserDir: true` w wczytanych ustawieniach; `try/catch` wokół `fs.copySync` (`:151`) z fallbackiem na domyślny plik i ostrzeżeniem; w szablonie i dokumentacji – zalecenie `--settings` dla obrazów.
7. Dokumentacja: tabela 16 zapisów (jak wyżej) w szablonie `settings.js` (skrót) i w dokumentacji pakietu; opis relacji `readOnly` ↔ `readOnlyUserDir`; uwaga, że węzły z palety (np. `file`) mogą pisać dowolnie – poza zakresem.

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

  Scenariusz: Bezwzględny flowFile poza katalogiem użytkownika jest chroniony (R-40)
    Zakładając readOnlyUserDir = true, magazyn plikowy i flowFile = "/data/flows.json" poza userDir
    Kiedy wyślę wdrożenie przez Admin API
    Wtedy otrzymam odpowiedź 400 z kodem "read_only_user_dir"
    I plik /data/flows.json pozostanie bez zmian

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
    # upload_not_allowed – nowy kod wprowadzany w Z-03 (ZASADY §2.4); scenariusz wykonywany po scaleniu Z-03

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

  Scenariusz: Zmienna środowiskowa CLI (R-18)
    Zakładając zmienną NODE_RED_READ_ONLY_USER_DIR ustawioną i brak ~/.node-red/settings.js
    Kiedy uruchomię node-red bez --settings
    Wtedy plik settings.js nie zostanie skopiowany do katalogu użytkownika
    I runtime działa jak przy readOnlyUserDir = true

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
- `test/unit/@node-red/runtime/lib/storage/localfilesystem/index_spec.js`, `settings_spec.js`, `sessions_spec.js`, `library_spec.js`, `projects/index_spec.js`: `no ensureDir/package.json when readOnlyUserDir`, `saveSettings skipped`, `saveSessions skipped`, `saveLibraryEntry rejected read_only_user_dir`, `saveFlows rejected read_only_user_dir`, `saveFlows rejected for absolute flowFile outside userDir` (R-40).
- `test/unit/@node-red/runtime/lib/index_spec.js`: `logs disabled features block`, `overrides allowInstall/autoInstall with warning`, `disables projects`.
- Integracyjny, nowy `test/unit/@node-red/runtime/lib/readonly_userdir_spec.js`: (a) rzeczywisty katalog tymczasowy z `chmod 0555` (pominięcie testu z uzasadnieniem, gdy proces działa jako root – `chmod` nie blokuje roota) + atrapa magazynu: start, wdrożenie, logowanie, zapis ustawień użytkownika; (b) atrapa `fs`/`fs-extra` (sinon) rejestrująca wywołania zapisu – asercja „zero zapisów w katalogach chronionych”, wariant z nieustawionym `userDir`.
- CLI: test procesu potomnego z `HOME` tylko do odczytu (`node-red/red.js`) oraz ze zmienną `NODE_RED_READ_ONLY_USER_DIR` (R-18: `env var skips settings copy and enables readOnlyUserDir`) – forma testu do potwierdzenia (brak testów CLI w projekcie).

#### DoD specyficzne
- [ ] Tabela 16 zapisów w dokumentacji pakietu i skrót w szablonie `settings.js`.
- [ ] Test z rzeczywistym katalogiem bez prawa zapisu (z obsługą uruchomienia jako root) i test z atrapą `fs`.
- [ ] Opis relacji `readOnly` ↔ `readOnlyUserDir`; `readOnly` opisane w szablonie `settings.js` (**R-40**).
- [ ] Ochrona bezwzględnego `flowFile` (zapis odrzucany niezależnie od ścieżki) pokryta testem (**R-40**).
- [ ] Zmienna `NODE_RED_READ_ONLY_USER_DIR` opisana w dokumentacji i szablonie `settings.js` (R-18).
- [ ] Testy obu stanów ustawienia dla każdego z miejsc #2–#16.

#### Ryzyka i alternatywy
- **CLI (#1) poza zasięgiem ustawienia** – **rozstrzygnięte (R-18):** zmienna środowiskowa `NODE_RED_READ_ONLY_USER_DIR` (R-33) czytana przed wyborem pliku + fallback w ścieżce błędu + zalecenie `--settings`.
- **Kontekst `localfilesystem`:** błąd startu (głośny, bez utraty danych po cichu) vs przełączenie na `memory` z ostrzeżeniem – **rozstrzygnięte (R-18, D-15): błąd startu**.
- **Wdrożenie przy magazynie plikowym:** odrzucenie (400) różni się od istniejącego cichego pominięcia przy `readOnly` – świadoma rozbieżność, **rozstrzygnięte (R-18): 400 `read_only_user_dir`**.
- **Relacja z `readOnly`:** `readOnly` = „magazyn plikowy nie zapisuje” (nieudokumentowane), `readOnlyUserDir` = „runtime nie pisze do katalogu użytkownika w ogóle” (szersze, obejmuje instalatory i kontekst). Rekomendacja: nie łączyć; `readOnlyUserDir` implikuje zachowanie `readOnly` dla zapisów pomijanych (#11, #13, #14).
- **Wykrywanie przez kontrolę ścieżek vs flagi:** sama kontrola flag może przeoczyć przyszłe miejsca zapisu; obrona w głąb (`assertWritable`) w instalatorach i kontekście + test z atrapą `fs` zmniejsza ryzyko. Moduły z palety i węzły (`file`, `watch` itp.) nie są objęte.
- Test `chmod` nie działa jako root (typowe w kontenerach CI) – test pominięty z uzasadnieniem, atrapa `fs` jako dowód podstawowy.

#### Podzadania
- [x] Moduł katalogów chronionych + testy – S
- [x] Efektywne flagi i komunikat startu – S
- [ ] Instalatory i moduły zewnętrzne (obrona w głąb) – M – **poza zakresem tej gałęzi** (zakaz zmian `registry/**`); działają efektywne flagi `externalModules.*`
- [x] Magazyn plikowy (pomijanie/odrzucanie) – M
- [x] Kontekst `localfilesystem` – S
- [x] CLI: zmienna `NODE_RED_READ_ONLY_USER_DIR` (R-18) + fallback przy kopiowaniu `settings.js` – S
- [~] Testy integracyjne (`chmod` + atrapa `fs`, `userDir` nieustawiony) – M – migawka drzewa katalogów zamiast atrapy `fs`; `chmod` pomijany jako root; `userDir` nieustawiony – tylko test modułu
- [x] Dokumentacja (tabela zapisów), szablon `settings.js` (w tym opis `readOnly` – R-40), CHANGELOG – S (tabela 16 zapisów – w tej karcie; w `settings.js` skrót)
- [x] Ochrona bezwzględnego `flowFile` + test (R-40) – S

#### Zrealizowane (gałąź `feature/p3-database`)
- Nowy moduł `runtime/lib/readOnlyUserDir.js` (zamiast `util/lib/readOnlyDir.js` – `util` poza zakresem plików):
  `isEnabled`, `protectedDirs` (`userDir` albo `NODE_RED_HOME`, katalog bieżący, `~/.node-red`), `isProtected`,
  `error` (400 `read_only_user_dir`), `assertWritable`, `applySettings` (efektywne flagi), `logStartup`.
- `runtime/lib/index.js`: `applySettings` w `init()` **przed** `settings.init` (ustawienia runtime i edytora widzą
  wartości efektywne), blok `readonly-userdir.enabled` + ostrzeżenia `readonly-userdir.setting-overridden` przy starcie.
- Magazyn plikowy: #11 (`node_modules`, `package.json`), #13 (ustawienia, także migracja `.config.json`), #14 (sesje)
  – pominięte jak `readOnly`; #12 `saveFlows`/`saveCredentials` i #15 `saveLibraryEntry` – odrzucenie
  `read_only_user_dir` (niezależnie od ścieżki `flowFile` – R-40; ma pierwszeństwo przed cichym `readOnly`);
  `api/library.js` przekazuje kod (400) zamiast `unexpected_error`. #16 Projekty – wyłączone flagą.
- Kontekst: `nodes/context/index.js` – magazyn `localfilesystem` z katalogiem w katalogu chronionym → błąd ładowania
  `read_only_user_dir` z nazwą magazynu i wskazaniem `contextStorage.<nazwa>.config.dir` (przed `open()`, bez
  tworzenia katalogu) → start odrzucony, stan `failed`.
- CLI `node-red/red.js`: `NODE_RED_READ_ONLY_USER_DIR` (dowolna wartość poza `false`) czytana przed wyborem pliku
  ustawień – brak kopiowania `settings.js`, `readOnlyUserDir: true`; błąd kopiowania → `console.warn` i domyślny plik.
- Szablon `settings.js`: `readOnlyUserDir` (skrót miejsc zapisu, zmienna, zalecenie `--settings`) i `readOnly` (R-40).
- Testy: `readOnlyUserDir_spec.js` (9), `storage/localfilesystem/readonly_userdir_spec.js` (6 + 1 pominięty jako root;
  migawka drzewa katalogów przed/po), `nodes/context/index_spec.js` (+4), `index_spec.js` (+3), `api/library_spec.js`
  (+1), proces potomny `test/unit/node-red/readonly-userdir_spec.js` (4: zmienna środowiskowa – brak kopii i zapisów,
  wdrożenie 400 i flow bez zmian; bez zmiennej – kopia jak dotąd; błąd kopiowania – ostrzeżenie; bezwzględny `flowFile`).
- **Rozbieżności z kartą / niezweryfikowane:**
  - obrona w głąb w `registry/lib/installer.js` i `externalModules.js` (`assertWritable`) – niezrobiona (zakaz zmian
    `registry/**`); instalacje blokują wyłącznie istniejące flagi `externalModules.*` – kody `install_not_allowed`,
    `update_not_allowed`, `module_not_allowed` nie były testowane w tej gałęzi; `upload_not_allowed` – zależny od Z-03;
  - zapis ustawień i sesji jest pomijany po cichu (bez `log.warn` przy pierwszej próbie) – informację daje blok
    przy starcie;
  - brak testu „każde z 16 miejsc objęte kontrolą” i testu z atrapą `fs` przy nieustawionym `userDir` (dowód: migawka
    katalogu przy magazynie plikowym, test modułu dla katalogów zastępczych);
  - CLI: wariant „katalog domowy tylko do odczytu” sprawdzony przez `~/.node-red` będący plikiem (proces działa jako
    root, `chmod` nie blokuje zapisu).

---

## Pytania do Zamawiającego (etap 3)

1. **E-02 – nazwy:** czy akceptują Państwo nazwy stanów (`starting, ready, deploying, reloadPending, reloading, idle, loaded, failed, stopping, stopped`) i zdarzenia `instance:state` (D-02)? Czy rozszerzyć `RED.stop()` o powód zatrzymania (sygnał)? **Rozstrzygnięte (R-23):** stany `init, starting, ready, deploying, reloadPending, reloading, idle, loaded, failed, stopping, stopped` (`init` – stan początkowy, `idle` – flow zatrzymane); zdarzenie `instance:state` `{state, previous, reason}`; `RED.stop(reason)` (powód do `preShutdown` i logu); nazwy jako kontrakt w MIGRACJA.md.
2. **E-02 – `setState` w mutexie:** zgoda na objęcie API start/stop flow (`runtimeState`) wspólną blokadą wdrożeń (usunięcie wyścigu, zmiana kolejkowania)? **Rozstrzygnięte (R-11):** tak – `setState` pod wspólną blokadą z wdrożeniami i przełączeniem projektu; druga operacja czeka.
3. **E-02/Z-08/Z-15 – `/ready` bez działających flow (jedno pytanie):** propozycja – instancja tylko edycyjna w stanie `loaded` → `/ready` 200 (D-13, „gotowa do edycji”); safe mode i `runtimeFlowState: stop` (`idle`) → 503. Czy potwierdzają Państwo? (Pytanie 12 w etapie 4 odsyła tutaj.) Przy okazji: czy ujednolicić nazwę `idle` z ANALIZA §4.2, gdzie oznacza stan początkowy? **Rozstrzygnięte (R-19, R-23):** `loaded` → `/ready` 200 (D-13); safe mode i zatrzymane flow (`idle`) → 503; `idle` ujednolicone – stan początkowy to `init`.
4. **Z-08 – treść odpowiedzi:** czy nazwa stanu w treści `503` jest dopuszczalna (nie jest konfiguracją), czy treść ma być stała? **Rozstrzygnięte (R-22):** stała treść 503 `{"status":"unavailable"}`, bez nazwy stanu.
5. **Z-08 – drenaż przy SIGTERM (D-11):** potwierdzenie rozwiązania w rdzeniu: `/ready` 503 od sygnału, hook `preShutdown` z limitem `shutdownTimeout` (domyślnie 30 s), potem `RED.stop()` i zamknięcie serwera HTTP; `preStop` orkiestratora jako opcja dodatkowa. Czy drugi sygnał w trakcie drenażu ma zatrzymywać natychmiast? Czy potrzebny osobny limit czasu samego `RED.stop()`? **Rozstrzygnięte (R-22):** drenaż domyślnie wyłączony (bez `shutdownTimeout` jak dotąd – brak domyślnych 30 s); drugi SIGTERM → natychmiastowe zatrzymanie. Osobny limit `RED.stop()` – **R-37:** brak; ostatecznym limitem jest `terminationGracePeriodSeconds`; bez `shutdownTimeout` hook `preShutdown` nie jest wywoływany.
6. **Z-08 – serwer HTTP przy SIGTERM (D-05):** zamknięcie serwera po `RED.stop()` tylko przy `health.enabled` (propozycja), czy zawsze (zmiana zachowania 5.0.6, w praktyce tuż przed `process.exit()`)? **Rozstrzygnięte (R-22):** zamykanie serwera HTTP tylko przy `health.enabled`.
7. **Z-09 – limit równoległości (D-10):** potwierdzenie `deploy.reload.concurrency` (slot przez koordynację Z-10, instancje czekające na slot zwracają `/ready` 200, 503 od rozpoczęcia drenażu). Czy `concurrency` ma przyjmować także wartość procentową (np. `"25%"`)? Czy przy braku łączności z koordynatorem przeładowanie ma czekać (propozycja), czy wykonać się bez limitu? **Rozstrzygnięte (R-20):** `concurrency` tylko liczbowo (bez `"25%"`); bez łączności z koordynatorem przeładowanie czeka (działa stara konfiguracja).
8. **Z-09 – przeładowanie różnicowe (D-10):** potwierdzenie `deploy.reload.type: "full" | "diff"` z domyślnym `"full"` i zaleceniem `"diff"` dla długich rozmów. Gdy treść odczytana pod blokadą zmienia flow spoza drenowanych w `preReload` – przeładować najnowszą rewizję z ostrzeżeniem (propozycja) czy wykonać dodatkowy drenaż? **Rozstrzygnięte (R-20, D-10, D-17):** `type: "full" | "diff"`, domyślnie `"full"`; dla flow zmienionych poza drenażem – dodatkowy `preReload` dla tych flow (w ramach pozostałego limitu); **R-36:** poza blokadą, najwyżej jedna runda, potem przeładowanie z ostrzeżeniem.
9. **Z-09 – `preReload` bez weta:** błąd/`false`/limit czasu → przeładowanie mimo to (propozycja), czy możliwość anulowania (instancja zostaje na starej konfiguracji)? Wartość domyślna limitu: 20 min (propozycja) czy krótsza z zaleceniem w dokumentacji? **Rozstrzygnięte (R-20):** `preReload` bez weta; domyślny limit 20 min.
10. **Z-09 – błąd odczytu magazynu:** instancja dalej `ready` na starej konfiguracji z ponowieniami (propozycja), czy po N próbach `failed` (503)? Czy błąd `watchFlows` przy rejestracji ma blokować start? **Rozstrzygnięte (R-20, D-18):** ponowienia, po wyczerpaniu `failed` i `/ready` 503. Błąd `watchFlows` przy rejestracji – **R-36:** przy `watch: true` błąd startu.
11. **Z-09 – ustawienia** `deploy.reload: { watch, type, preReloadTimeout, concurrency }` (ZASADY §2.1): czy dodać `retry: { min, max }` (ponowienia odczytu), czy stałe wartości w kodzie? **Rozstrzygnięte (R-20):** `deploy.reload.retry: { min: 1000, max: 60000, attempts }` (`attempts` domyślnie 10, ~8 min – **R-36**).
12. **Z-10 – semantyka `inject`:** cron przez zajęcie klucza `<nodeId>:<czas zaplanowany>`, interwał i „raz po starcie” przez przywództwo (rekomendacja) – akceptacja? Czy status „standby” w węźle jest pożądany? **Rozstrzygnięte (R-21, D-14):** cron – zajęcie klucza, interwał i „raz po starcie” – przywództwo; status „standby” – tak.
13. **Z-10 – wybór wtyczki:** tylko jawnie (`coordination.plugin`, rekomendacja) czy automatycznie jedyna zainstalowana? Czy inne węzły core (np. `mqtt in`) mają dostać opcję w tym pakiecie? **Rozstrzygnięte (R-21):** wtyczka tylko jawnie (`coordination.plugin`); `mqtt in` w osobnym pakiecie.
14. **Z-10 – test dwóch runtime'ów:** czy wystarczy test dwóch instancji fasady koordynacji w jednym procesie, czy wymagany wariant wieloprocesowy w `npm test`? **Rozstrzygnięte (R-21):** test dwóch instancji w jednym procesie w `npm test`; wariant wieloprocesowy w osobnym podzbiorze.
15. **Z-11 – kontekst `localfilesystem` w katalogu użytkownika:** błąd startu (rekomendacja) czy przełączenie na `memory` z ostrzeżeniem? **Rozstrzygnięte (R-18, D-15):** błąd startu.
16. **Z-11 – wdrożenie przy magazynie plikowym:** odrzucenie 400 `read_only_user_dir` (rekomendacja) czy ciche pominięcie jak istniejące `readOnly`? Czy `readOnly` ma zostać udokumentowane w szablonie? **Rozstrzygnięte (R-18):** 400 `read_only_user_dir`. Udokumentowanie `readOnly` w szablonie – **R-40:** tak, `readOnly` opisane w szablonie `settings.js`.
17. **Z-11 – CLI:** czy dodać zmienną środowiskową (np. `NODE_RED_READ_ONLY_USER_DIR`) działającą przed wyborem pliku ustawień, czy wystarczy fallback w ścieżce błędu i zalecenie `--settings`? Czy bezwzględny `flowFile` poza katalogiem użytkownika ma być chroniony? **Rozstrzygnięte (R-18):** dodatkowo zmienna środowiskowa `NODE_RED_READ_ONLY_USER_DIR` (nazwa – R-33) działająca przed wyborem pliku ustawień. Bezwzględny `flowFile` – **R-40:** chroniony (zapis odrzucany niezależnie od ścieżki).

---

## Zmiany po przeglądzie

Poprawki z listy w [../PRZEGLAD.md](../PRZEGLAD.md) („Lista poprawek do naniesienia”), zgodnie z ZASADY §2.1, §2.3, §2.4 i ANALIZA §4.2, §6.2, §7:

- **#2** – E-02: nowy stan `reloadPending` (bez blokady i bez tokenu operacji, flaga `draining` od `preReload`), `reloading` ograniczony do kroków pod blokadą; diagram stanów i tabela przejść (T5 z `reloadPending` – unieważnienie przez wdrożenie, T7/T7a/T7b/T8/T8a); niezmiennik 3 przeredagowany; nowe API `markReloadPending`/`markDraining`/`cancelPending`; scenariusze BDD i testy. Z-09: algorytm wg ZASADY §2.3 B (preReload poza blokadą, wdrożenie unieważnia oczekujące przeładowanie, stop/start pod blokadą).
- **#2 / #11** – E-02: stan `loaded` dla instancji tylko edycyjnej (Z-15, T14), `/ready` 200 (D-13).
- **#5** – Z-08: zależność od Z-09 zastąpiona „punktem integracji wykorzystywanym przez Z-09” (brak cyklu Z-08↔Z-09); tabela podsumowania i kolejność realizacji wg ANALIZA §6.2 (Z-08 → Z-10 → Z-09 → Z-11).
- **#6** – Z-09: przeładowanie z magazynu bez `preDeploy`, z `postDeploy` (`source: "storage"`); ponowny odczyt magazynu pod blokadą (uruchamiana najnowsza rewizja).
- **#10** – Z-09: `/ready` 503 od rozpoczęcia drenażu (`preReload`) do końca przeładowania – zgodnie z kryterium zlecenia i E-02; ryzyko „wszystkie workery naraz” rozwiązane przez `deploy.reload.concurrency` (koordynacja Z-10) i `type: "diff"`; scenariusze BDD dla limitu równoległości (atrapa koordynacji) i dla `diff`.
- **#11** – jedna propozycja `/ready` dla instancji edycyjnej (`loaded` → 200, D-13) w E-02 i Z-08; jedno pytanie (pytanie 3).
- **#12** – tabela podsumowania: E-02 „wykorzystywany opcjonalnie przez P-01”.
- **#19** – Z-11: `upload_not_allowed` opisany jako nowy kod definiowany w Z-03 (ZASADY §2.4); zależność od Z-03.
- **#20** – Z-08: drenaż przy SIGTERM wg D-11 i ZASADY §2.3 C (`stopping` od sygnału, hook `preShutdown`, `shutdownTimeout`, potem `RED.stop()` i zamknięcie serwera HTTP); scenariusze BDD, testy, DoD, podzadanie; `preStop` orkiestratora jako opcja dodatkowa; ustawienia `health.host`, `shutdownTimeout`, `RED.health`.
- **#21** – Z-09: `type: "full" | "diff"`, domyślnie `"full"`, rekomendacja `"diff"` dla długich rozmów; `watch` domyślnie `false` (ZASADY §2.1).
- **#26** – E-02: `runtime/lib/index.js:247` → `:245`; dopisano, że `.catch` obejmuje tylko `loadFlows` (obietnica `startFlows()` nie jest zwracana).
- **Dodatkowo** – szacunek podzadania Z-10 „M/L” → „L” (skala S/M/L, ZASADY §4); pytania 3, 5–8, 11 zaktualizowane do rozstrzygnięć; nowe „do decyzji”: nazwa `idle` vs ANALIZA §4.2, zmiana flow spoza drenowanych w trakcie `preReload`, `retry` w `deploy.reload`.

## Zmiany po decyzjach (2026-10-03)

Naniesione decyzje z [../REJESTR-DECYZJI.md](../REJESTR-DECYZJI.md):

- **Pytania 1–17** – dopisane rozstrzygnięcia (R-11, R-18, R-19, R-20, R-21, R-22, R-23).
- **E-02 (R-23, R-11, R-19):** nowy stan początkowy `init` (tabela stanów, diagram, T1, typedef, BDD, test); `idle` = flow zatrzymane (safe mode i `runtimeFlowState: stop`), `/ready` 503; `instance:state` `{state, previous, reason}` zatwierdzone; `RED.stop(reason)` (Projekt pkt 6, BDD, testy, podzadanie S); `setState` pod wspólną blokadą.
- **Z-08 (R-22, R-19, R-10, R-23):** stała treść 503 `{"status":"unavailable"}` (Specyfikacja, BDD, testy); `shutdownTimeout` płasko i **domyślnie wyłączony drenaż** (Ustawienie, Wejścia, Niezmienniki, Projekt, nowy scenariusz); drugi SIGTERM → natychmiast; zamykanie serwera HTTP tylko przy `health.enabled` (nowy scenariusz, test, DoD); `RED.stop(signal)`; **nowy element zakresu**: limit czasu oczekiwania na start w trybie `deploy.response: "started"` przeniesiony z P-01 (R-10) – do wyspecyfikowania (Ryzyka, DoD, podzadanie). Szacunek M – do ponownej oceny po specyfikacji limitu.
- **Z-09 (R-20, D-17, D-18):** `deploy.reload.retry: { min, max, attempts }`; po wyczerpaniu `failed` + 503; `concurrency` tylko liczba, przy braku koordynatora czekanie; `preReload` bez weta (20 min); D-17 – dodatkowy `preReload` dla flow zmienionych w trakcie drenażu; 3 nowe scenariusze BDD, testy, DoD.
- **Z-10 (R-21, D-14):** semantyka `inject` zatwierdzona; status „standby” (Specyfikacja, scenariusz, test, DoD); wybór wtyczki tylko jawny; `mqtt in` w osobnym pakiecie; test wieloprocesowy w osobnym podzbiorze (poza `npm test`).
- **Z-11 (R-18, D-15):** kontekst plikowy → błąd startu; wdrożenie przy magazynie plikowym → 400 `read_only_user_dir`; zmienna środowiskowa `NODE_RED_READ_ONLY_USER_DIR` (nazwa robocza) – Ustawienie, tabela zapisów #1, Wejścia, Przypadki błędów, Projekt pkt 6, scenariusz, test, DoD, podzadanie.
- **Doprecyzowania R-33…R-42:**
  - **Z-08 (R-37, R-38):** bez `shutdownTimeout` hook `preShutdown` nie jest wywoływany, brak osobnego limitu `RED.stop()` – ostatecznym limitem `terminationGracePeriodSeconds` (Ustawienie, Niezmienniki, scenariusz, test, Ryzyka, Pytanie 5); limit czasu startu w trybie `"started"` wyspecyfikowany: `deploy.startTimeout` (domyślnie wyłączony), 500 `deploy_start_failed` z `errors[].code: "start_timeout"`, start w tle (Ustawienie, DoD, Ryzyka, podzadanie S – szacunek Z-08 bez zmian, M).
  - **Z-09 (R-36):** `retry.attempts` domyślnie 10 (~8 min); dodatkowy `preReload` (D-17) poza blokadą, najwyżej jedna runda, potem przeładowanie z ostrzeżeniem; przy `watch: true` błąd rejestracji `watchFlows` → błąd startu (Ustawienie, Specyfikacja, Przypadki błędów, 3 nowe scenariusze BDD, testy, DoD, Pytania 8, 10, 11).
  - **Z-11 (R-33, R-40):** nazwa `NODE_RED_READ_ONLY_USER_DIR` bez oznaczenia „robocza”; `readOnly` opisane w szablonie `settings.js`; bezwzględny `flowFile` chroniony (Katalogi chronione, scenariusz BDD, test, DoD, Pytania 16–17, podzadanie).
