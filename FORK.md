# Fork Actuna-Tech/node-red – specyfika

> Opracowała firma **Actuna Sp. z o.o.** (Wojciech Repiński), z użyciem narzędzi AI.
> Dokument opisuje, czym ten fork różni się od Node-RED, jak go skonfigurować i jak w nim pracować.
> Szczegóły zmian: [CHANGELOG.md](CHANGELOG.md) (sekcje „Unreleased”); pliki zmienione bez nagłówka:
> [MODIFICATIONS.md](MODIFICATIONS.md); zasady pracy: [AGENTS.md](AGENTS.md).

## 1. Wersja bazowa i gałęzie

| Element | Wartość |
|---|---|
| Wersja bazowa | Node-RED **5.0.7** (commit `cd05a9a`, decyzja D-01) |
| `main` | jedyna gałąź; F1–F3 (kamień milowy F3) i priorytet 3 (wiele instancji) – stan `5c2608b` |
| Zgłoszenia do Node-RED | **zablokowane** (D-04): brak PR/issues/push do `node-red/node-red`; hook `design/git-hooks/pre-push` |

> Wzmianki o gałęziach `claude/loving-fermat-ftfo9h` i `feature/p3-database` w `design/` są historyczne –
> obie zostały scalone do `main` i usunięte. Znaczniki „do potwierdzenia”/„do decyzji” w kartach etapów opisują
> stan z chwili ich pisania; rozstrzygnięcia są w rejestrze decyzji i sekcjach „Realizacja” kart.

**Zasada nadrzędna:** każda nowa funkcja jest **domyślnie wyłączona** – bez nowych ustawień fork zachowuje się
jak Node-RED 5.0.7 (wyjątki – poprawki błędów, sekcja 6). API v1 bez zmian.

## 2. Zalecana konfiguracja naszych instalacji

```js
// settings.js – zalecane ustawienia dla instalacji Actuna (wybrane; opis każdego w sekcji 5)
module.exports = {
    adminAuth: { /* ... */ },
    httpAdminNodeRoutes: "authenticated",   // trasy admin węzłów tylko po zalogowaniu (Z-02)
    telemetry: { enabled: false, locked: true }, // telemetria wyłączona na stałe (P-03)
    health: { enabled: true, port: 1881, unreadyGrace: 15000 }, // sondy; /ready 503 min. 15 s przed zatrzymaniem flow (Z-16) – tylko za balanserem
    deploy: {
        response: "started",                // odpowiedź API po starcie flow (P-01)
        requireRevision: true,              // każde wdrożenie z aktualną rewizją (Z-05)
        reload: { retry: { onExhausted: "keepReady" } }, // z deploy.reload.watch: awaria magazynu nie wyłącza instancji z ruchu; /ready 200 „warn”, po 30 min 503 (R-47)
        holdHttpNodeRequests: { enabled: true } // żądania HTTP węzłów czekają na restart flow zamiast 404 (#8)
    },
    editorTheme: {
        flowLayout: { enabled: true },      // kontrolki układu flow (Z-14) – WYMAGANE przy aktualizacji
        deploy: { staleFlows: "reload-only" } // nieaktualny edytor tylko przeładowuje (P-02)
    }
};
```

> **Aktualizacja istniejącej instalacji:** bez `editorTheme.flowLayout.enabled: true` kontrolki układu znikają,
> a domyślny układ użytkownika jest ignorowany (flow bez własnego `layout` rysują się poziomo).
> Przy `deploy.requireRevision: true` klienci Admin API (skrypty, MCP, CI/CD) muszą używać API v2 i wysyłać
> rewizję – przewodnik: [design/engine-extensions/MIGRACJA.md](design/engine-extensions/MIGRACJA.md).

## 3. Funkcje edytora

### Układ flow (Z-14, FL-B-004…012)
- Układ flow: poziomy `LR` (domyślny), pionowy `TB`, automatyczny `auto` – dla flow (`layout` w zakładce),
  subflow lub jako domyślny w ustawieniach użytkownika; orientacja portów pojedynczego węzła (`o: "LR"|"TB"`).
- Styl połączeń: zaokrąglony `curved` (domyślny) lub prostokątny `orthogonal` (`wireStyle`), z omijaniem węzłów.
- Eksport/import i deploy przenoszą wygląd 1:1 (także domyślny układ użytkownika – FL-B-009); okno różnic pokazuje
  właściwości układu; nieznane wartości nie giną.
- Moduł geometrii `RED.viewLayout` (`ui/view-layout.js`); zmiana orientacji/układu nie restartuje węzłów.
- Dokumentacja: [design/flow-layout/DOKUMENTACJA.md](design/flow-layout/DOKUMENTACJA.md).

### Język polski – częściowo (Z-13)

- Dodane `locales/pl/editor.json` (317 z 1151 kluczy en-US, ok. 28%, oraz 8 form liczby mnogiej) i `locales/pl/messages.json` (102 z 873, ok. 12%) –
  tłumaczenie częściowe od Zamawiającego; brakujące klucze wracają do en-US (`fallbackLng`). Słownik: „węzeł”,
  `flow`/`subflow` bez tłumaczenia, „Wdróż”; forma bezosobowa. Liczba mnoga: `_one/_few/_many/_other` (i18next 25).
- Pomoc węzłów (#12): `locales/pl/common/21-debug.html`, `function/10-function.html`, `function/15-change.html`
  i `parsers/70-JSON.html` (węzły `debug`, `function`, `change`, `json`) – tłumaczenie pomocy en-US 5.0.7: te same sekcje,
  nazwy właściwości `msg`, przykłady kodu i wartości opcji po angielsku. Pliki mają nagłówek licencji i adnotację D-19.
- Brak: `runtime.json`, `jsonata.json`, `infotips.json`, pomoc HTML pozostałych węzłów (D-16, R-29) i test pełnej zgodności
  kluczy – do kolejnego etapu Z-13. Pomoc węzła bez pliku `pl` wyświetla się po angielsku.
- Język wykrywany z katalogu `locales/pl`; nazwa w selektorze z `languages.pl` (`"Polski"`, dodane w `en-US` i `es-ES`).
  Przeglądarka z językiem `pl` bez wybranego języka w ustawieniach użytkownika pokaże teraz polski edytor.
- Test: `test/unit/@node-red/editor-client/locales_pl_spec.js` (brak kluczy nadmiarowych, spójne placeholdery i znaczniki).

### Import elementów o istniejących identyfikatorach (FL-B-010)
- Flow i subflow: wybór **„zastąp”** albo **„kopia”** w oknie konfliktu (domyślnie kopia); cofnięcie przywraca stan.
- Zablokowany flow (`locked`) nie może zostać zastąpiony – tylko kopia (R-44).
- Identyczny subflow jest rozpoznawany niezależnie od kolejności właściwości (FL-B-006).

### Ochrona przed nadpisaniem (P-02)
- `editorTheme.deploy.staleFlows: "reload-only"` – nieaktualny edytor pokazuje okno z jedyną akcją
  „Przeładuj flow” (bez „Overwrite”). Pełna ochrona wymaga także `deploy.requireRevision` (serwer).

## 4. Bezpieczeństwo

| Zmiana | Pakiet | Domyślnie |
|---|---|---|
| Pakiet `auth` przez `/comms` bez `adminAuth` nie zatrzymuje procesu (odpowiedź `auth ok`) | P-04 | poprawka |
| Nazwa użytkownika wstawiana jako tekst (XSS), odświeżenie danych po ponownym logowaniu | R-08, R-41 | poprawka |
| Odpowiedź serwera przy błędzie zapisu/eksportu do biblioteki pokazywana jako escapowany tekst, nie jako HTML (XSS) | #30 | poprawka |
| Komunikaty błędów palety, projektów, kontroli wersji, ładowania modułu węzła, importu i grup pokazywane jako escapowany tekst, nie jako HTML (XSS) | #34 | poprawka |
| Dalsze komunikaty z tekstem spoza katalogu (nazwa modułu w potwierdzeniach palety, adres zdalny git, nazwa pliku przy `revert`, nazwy projektu/gałęzi/zdalnego/klucza, błędy rejestracji węzła i importu) escapowane; `RED.utils.sanitize` escapuje też cudzysłowy | #37 | poprawka |
| Subskrypcje `/comms` dopiero po uwierzytelnieniu | Z-01 | poprawka |
| Trasy admin węzłów wymagają logowania: `httpAdminNodeRoutes: "authenticated"`, `RED.auth.publicRoute()` | Z-02 | `"open"` |
| Telemetria blokowana przez administratora: `telemetry.locked` (także w edytorze) | P-03 | wyłączone |

Ograniczenie Z-02: to bezpieczniejsza wartość domyślna dla poprawnie napisanych węzłów, nie piaskownica
(opis w `settings.js`).

## 5. Admin API i potok wdrożenia

### Nowe ustawienia

| Ustawienie | Domyślnie | Działanie | Pakiet |
|---|---|---|---|
| `deploy.response` | `"stopped"` | `"started"` – odpowiedź po starcie flow; błąd startu → 500 `deploy_start_failed` z `rev`, `errors[]` | P-01 |
| `deploy.startTimeout` | brak | limit czasu startu w trybie `"started"` (500 z `start_timeout`, start trwa w tle) | P-01 |
| `deploy.startTimeoutReleasesLock` | `false` | `true` – blokada wdrożeń zwalniana po limicie (ryzyko równoległego startu) | R-45 |
| `deploy.putCreatesFlow` | `false` | `PUT /flow/:id` tworzy brakujący flow pod tym id | Z-04 |
| `deploy.holdHttpNodeRequests: {enabled, timeout, maxPending, retryAfter}` | `enabled: false`, `timeout: 5000` ms, `maxPending: 1000`, `retryAfter: 1` s | `enabled: true` – żądania do tras węzłów (`httpNodeRoot`, np. `http in`), **dla których w danym momencie nie ma trasy**, są wstrzymywane na czas restartu flow (wdrożenie i przeładowanie z magazynu) i obsługiwane przez nowe flow po ich starcie, zamiast 404; trasy niezmienionych węzłów odpowiadają od razu; po `timeout` lub przy przepełnieniu `maxPending` (limit globalny, nie na klienta) → 503 z `Retry-After` (kody `http_hold_timeout`, `http_hold_queue_full`, `http_hold_release_failed`); szczegóły niżej | #8 |
| `deploy.requireRevision` | `false` | wdrożenie bez rewizji → 409 `version_required`; v1 zawsze 409 | Z-05 |
| `httpAdminNodeRoutes` | `"open"` | `"authenticated"` – ochrona tras admin węzłów | Z-02 |
| `telemetry.locked` | brak | blokada ustawienia telemetrii | P-03 |
| `editorTheme.flowLayout.enabled` | `false` | kontrolki układu flow | Z-14 |
| `editorTheme.deploy.staleFlows` | `"prompt"` | `"reload-only"` – nieaktualny edytor tylko przeładowuje | P-02 |

### API pojedynczego flow (`/flow`, Z-04) – nagłówek `Node-RED-API-Version: v2`
- `GET /flow/:id` → `rev` (rewizja flow) + nagłówek `ETag`; `If-Match` równoważne `rev`.
- `PUT /flow/:id` → `{id, rev, revAll}`; opcjonalnie `globalConfigs[]` + `globalRev`.
- `POST /flow` → **201** `{id, rev}` (v1: 200 `{id}`); `DELETE /flow/:id?rev=`.
- Kody błędów (snake_case): `version_mismatch`, `version_required`, `invalid_revision`, `duplicate_id`,
  `invalid_flow_id`, `invalid_node_type`, `deploy_start_failed`, `deploy_stop_failed` – katalog:
  [design/engine-extensions/ZASADY.md](design/engine-extensions/ZASADY.md) §2.4.

### Wynik startu w trybie `"started"` – fakty i późny wynik (#22, R-48)
- Wpis `errors[]` o `code: "start_timeout"` ma dodatkowe pola (addytywne, tylko tryb `"started"`): `timeout` (ms, wartość
  `deploy.startTimeout`), `phase` (`"modules"` – sprawdzanie i instalacja modułów flow; `"flows"` – uruchamianie flow),
  `startedAt` (ms od epoki), `elapsed` (ms w chwili limitu), `pending` (id flow jeszcze niewystartowanych, razem z bieżącym; przy wdrożeniu
  „flows”/„nodes” tylko flow, w których wdrożenie coś uruchamia – utworzone przez nie, zawierające dodane, zmienione, przepięte
  lub powiązane węzły albo zmienione same; niezmienione flow działają dalej i nie są wymieniane; w fazie `"modules"` pusta lista) i `current` (id flow uruchamianego w chwili limitu; tylko w fazie `"flows"` i tylko gdy uruchamiane jest flow z `pending` – gdy start czeka na flow, w którym wdrożenie nic nie uruchamia, np. niezmienione flow lub `global` przy wdrożeniu „flows”/„nodes”, `current` nie ma). Przy wdrożeniu „nodes” przepięte i powiązane węzły nie liczą się jako uruchamiane (stop zostawia je działające, start je tylko przepina); przy „flows” liczą się.
  Wpis `flow_start_failed` z odrzuconego startu ma `flow` (id), gdy wiadomo, którego flow dotyczył błąd. Nie ma nowego kodu
  najwyższego poziomu – nadal 500 `deploy_start_failed`. Brak kontraktu gotowości węzłów i klasyfikacji przyczyn po kodach
  systemowych (R-10 bez zmian): dodajemy wyłącznie fakty.
- Gdy odpowiedź wróciła z `start_timeout`, a start flow skończył się później, runtime publikuje zdarzenie `deploy-start-result`
  (`notification/deploy-start-result` w `/comms`, bez retencji): `{type: "success", text, timeout, revision}` albo
  `{type: "error", error: "deploy_start_failed", text, revision, errors[]}`. Zdarzenie dostają tylko zalogowane sesje edytora
  (jak inne zdarzenia środowiska; `/comms` wymaga uwierzytelnienia przy `adminAuth`); edytor pokazuje „Flow zostały uruchomione”
  albo czerwony błąd z przyczynami. Nie jest emitowane po wdrożeniu, które odpowiedziało w czasie, ani w trybie domyślnym.
  Edytor pokazuje wynik tylko, gdy `revision` zdarzenia jest rewizją tego edytora (nowsze wdrożenie lub inna sesja z inną
  rewizją go pomija) i zamyka wtedy otwarty czerwony błąd `start_timeout` tego wdrożenia. **Zasięg (SEC-003):** zdarzenie,
  razem z komunikatami błędów i nazwami flow w `errors[]`, trafia do **wszystkich** zalogowanych użytkowników edytora (sesje
  `/comms` z uprawnieniem odczytu), tak samo jak `runtime-state` i zdarzenia debug – nie tylko do użytkownika, który wdrażał.

### Wstrzymywanie żądań HTTP węzłów podczas restartu flow (#8)
- **Surowe ciało (`skipBodyParsing`) w oknie stop→start:** żądanie do trasy `http in` z „surowym ciałem”, które przeszło przez
  `rawBodyCapture` w oknie stop→start (klucz trasy chwilowo nieobecny), po wypuszczeniu dostałoby ciało sparsowane (obiekt/tekst zamiast
  `Buffer`, np. psuje weryfikację podpisu HMAC). Trasa takiego węzła czyta więc surowe ciało sama, jeśli nie zostało jeszcze odczytane
  (`21-httpin.js`, `createRawBodyFallback`). W #8 robiła to tylko trasa przy `enabled: true`; od #16 robi to każda trasa `skipBodyParsing`,
  **niezależnie od tego ustawienia** (zob. §6).
- **Surowe ciało tras z parametrem i inną wielkością liter (#16):** `rawBodyCapture` dopasowuje dosłowny klucz `METODA:url`, więc trasa
  `skipBodyParsing` z parametrem (`/hook/:id`) lub inną wielkością liter nigdy nie była przechwytywana i dostawała ciało sparsowane.
  Teraz taka trasa dostaje `Buffer` zawsze (zapasowy odczyt wyżej) – zob. §6 (limit rozmiaru surowego ciała i opcja węzła `Max body size`).
- **Problem:** trasy węzłów (`http in` i każdy węzeł rejestrujący trasę w `RED.httpNode`) są usuwane przy zatrzymaniu węzła
  i dodawane przy starcie nowych; żądanie w oknie stop→start dostaje 404, nieodróżnialne od nieistniejącego zasobu.
- **Rozwiązanie:** `runtime/lib/httpHold.js` – middleware montowany na aplikacji `httpNode` **przed** trasami węzłów
  (`runtime/lib/index.js`, tylko przy `enabled: true`; bez ustawienia aplikacja nie zmienia się wcale). Sygnałem jest stan
  instancji E-02 (`runtime/lib/state.js`): żądania bez trasy są wstrzymywane w stanach `deploying` (potok A, krok 4–8) i `reloading`
  (potok B, krok 5), które kończą się dopiero po starcie nowych flow (`pipeline.js` `endWithStart`, R-43) – nowe trasy
  istnieją, gdy żądania są wypuszczane. Brak równoległej maszyny stanów; nasłuch przez `instanceState.onChange`.
- **Tylko żądania bez trasy:** przy wdrożeniu częściowym (`nodes`/`flows`) trasy niezmienionych węzłów istnieją i odpowiadają
  od razu – nawet gdy wdrożenie trwa dłużej niż `timeout`. Middleware sprawdza w momencie nadejścia żądania, czy router aplikacji
  `httpNode` (`req.app._router.stack`) ma trasę pasującą do ścieżki i metody (HEAD obsługuje trasa GET; `OPTIONS` – dowolna trasa
  na tej ścieżce); wstrzymywane jest tylko żądanie bez takiej trasy. Handlery zamontowane przez `app.use()` nie są trasami, więc
  żądania, które obsłużyłby tylko taki handler, są wstrzymywane. Gdy routera nie da się sprawdzić, wstrzymywane jest każde żądanie.
- **Wypuszczenie:** po zmianie stanu na inny niż `deploying`/`reloading`. Przy błędzie startu (`failed`), flow zatrzymanych (`idle`)
  i zatrzymaniu runtime wstrzymane żądania trafiają do zwykłego routingu (router odpowie jak dziś, np. 404 dla trasy, która nie
  powstała) – nie przetrzymujemy ich dłużej niż trwa operacja, a `Retry-After` nie ma sensu, gdy nie wiadomo, czy trasa wróci.
- **Limity:** `timeout` (5000 ms) – po nim 503 `{"code":"http_hold_timeout"}` z `Retry-After`; `maxPending` (1000, globalny – nie na klienta,
  bez `httpNodeAuth` kolejkę może zająć każdy, ale tylko w oknie wdrożenia) – ponad limit
  503 `{"code":"http_hold_queue_full"}` od razu (pamięć ograniczona); `retryAfter` (1 s). Wyjątek przy wypuszczaniu żądania →
  503 `{"code":"http_hold_release_failed"}` (pozostałe żądania są wypuszczane normalnie). Klient, który się rozłączył,
  zwalnia miejsce. Błędna wartość opcji → ostrzeżenie i wartość domyślna; ustawienie niebędące obiektem → ostrzeżenie, wyłączone.
- **Zakres:** tylko aplikacja `httpNode` (ścieżki pod `httpNodeRoot`); Admin API, edytor i sondy `health` nie są wstrzymywane.
  Uwaga: przy `httpNodeRoot: "/"` (domyślnie) aplikacja `httpNode` jest montowana przed `httpStatic` (`red.js`), więc **pliki statyczne
  serwowane pod `httpNodeRoot` także są wstrzymywane**; nie są wstrzymywane tylko te pod innym korzeniem. Wstrzymywane jest też
  preflight CORS (`OPTIONS` rejestrowane przez `http in` na `httpNode`), a odpowiedź 503 z wstrzymania **nie niesie nagłówków
  `Access-Control-*`** – przeglądarka zgłosi błąd CORS zamiast 503 (klient spoza przeglądarki widzi 503 i `Retry-After`).
  Uwierzytelnianie `httpNodeAuth` (montowane w CLI przed `httpNode`) wykonuje się przed wstrzymaniem. Żądania już obsługiwane nie są ruszane.
  Poza zakresem: pierwszy start procesu (`starting`), `POST /flows/state`, przełączenie projektu, okno drenażu (`reloadPending` –
  stare trasy jeszcze odpowiadają), połączenia WebSocket.
- **Wybory projektowe:** nazwa `deploy.holdHttpNodeRequests` (rodzina `deploy.*`, ZASADY §2.1; nie `deploy.reload.*`, bo obejmuje także
  zwykłe wdrożenie); okno wstrzymania to cały stan `deploying`/`reloading`, ale wstrzymywane są tylko żądania bez trasy (patrz wyżej),
  więc zdrowe trasy nie dostają 503 przy długim wdrożeniu. Ustaw `timeout` poniżej limitów czasu load balancera i klientów.

### Potok wdrożenia (E-01)
- Wspólna blokada (`runtime/lib/flows/lock.js`) dla `POST /flows`, `/flow`, `POST /flows/state` i operacji
  Projektów (zmiana gałęzi, pull, revert, scalanie); druga operacja czeka. Blokada trwa do końca startu flow (R-43).
- Potok `runtime/lib/flows/pipeline.js` – kroki i punkty rozszerzeń: ZASADY §2.3.

### Wiele instancji (priorytet 3)

| Ustawienie / API | Domyślnie | Działanie | Pakiet |
|---|---|---|---|
| stan instancji `runtime.state`, zdarzenie `instance:state`, `RED.stop(reason)` | zawsze (pasywne) | `init, starting, ready, deploying, reloadPending, reloading, idle, loaded, failed, stopping, stopped`; obok stanu warunek `reload` (nieudane przeładowanie z magazynu: `error.code`, `since`, `attempts`, `activeRev`, `rev`, `keepReady`, `staleDeadline`) – zmiana samego warunku też emituje `instance:state` (R-47) | E-02 |
| `health: {enabled, path, port, host}` | wyłączone | `/live`, `/ready` (503 `{"status":"unavailable"}` poza stanem gotowości), bez uwierzytelnienia | Z-08 |
| `health.unreadyGrace` | brak (0) | planowane zatrzymanie (SIGTERM, przeładowanie z magazynu `deploy.reload`): `/ready` odpowiada 503 co najmniej tyle ms, **liczone od początku planowanego zatrzymania/przeładowania** (najpóźniej wtedy `/ready` odpowiada 503; instancja już niegotowa czeka pełny czas ponownie – bezpiecznie, tylko dłużej), zanim flow zostaną zatrzymane – balanser odpytujący `/ready` zdąży wyłączyć instancję z ruchu. Czeka równolegle z hookami `preShutdown`/`preReload` (zatrzymanie po dłuższym z nich) i mieści się w limicie: ograniczone `shutdownTimeout` (SIGTERM) i `deploy.reload.preReloadTimeout` (przeładowanie). Przy SIGTERM przerywa je tylko drugi sygnał; przed przeładowaniem – wdrożenie na tej instancji lub zatrzymanie runtime. Bez `shutdownTimeout` zamykanie czeka dokładnie `unreadyGrace` (hook `preShutdown` nadal nie jest wołany) – `terminationGracePeriodSeconds` musi być dłuższy. **Nie dotyczy** wdrożenia z edytora/Admin API (ta instancja jest edytowana, żądanie nie może czekać). Wymaga `health.enabled: true`; wartość nie będąca liczbą ≥ 0 lub brak `enabled` → ostrzeżenie w logu i brak oczekiwania (zgłoszenia #8, #1) | Z-16 |
| `hooks: {"preReload.<etykieta>": fn, "preShutdown.<etykieta>": fn}` | brak | hooki `preReload` i `preShutdown` rejestrowane z `settings.js` przy `init` runtime – przed wtyczkami i pierwszym startem flow (SIGTERM podczas startu też je widzi); semantyka jak `RED.hooks.add` (arność 1 = obietnica); dozwolone tylko te dwa hooki i tylko funkcje – inna nazwa, brak etykiety lub wartość niebędąca funkcją = błąd startu `invalid_hook_setting` z nazwą klucza (nic nie jest rejestrowane); etykieta: litery, cyfry, `_`, `-`; hooki z `settings.js` są rejestrowane przed wtyczkami, więc przy starcie wołane przed ich hookami; ta sama etykieta z wtyczki → „already registered”; `preShutdown` działa tylko z `shutdownTimeout`, `preReload` tylko z `deploy.reload.watch`; hook z `settings.js`, który się nie wykona (`preShutdown.*` bez `shutdownTimeout` > 0, `preReload.*` bez `deploy.reload.watch: true`), pozostaje zarejestrowany, a przy starcie jest ostrzeżenie w logu z nazwą klucza i brakującym ustawieniem (tylko diagnostyka; hooki wtyczek bez ostrzeżeń; bez ustawienia `hooks` brak ostrzeżeń) | #7, #15 |
| `shutdownTimeout` + hook `preShutdown` | brak | drenaż przy SIGTERM: `/ready` 503 od razu, hook z limitem, potem zatrzymanie; drugi sygnał = natychmiast | Z-08 |
| `readOnlyUserDir`, zmienna `NODE_RED_READ_ONLY_USER_DIR` | `false` | brak zapisu do katalogu użytkownika; wdrożenie przy magazynie plikowym i `DELETE /nodes/<moduł>` → 400 `read_only_user_dir`; instalatory palety i modułów function odrzucają zapis niezależnie od innych ustawień | Z-11 |
| `coordination: {plugin, options}`, `RED.coordination` (węzły), typ wtyczki `node-red-coordination` | wtyczka lokalna | przywództwo i zajęcia z TTL; własna wtyczka wybierana jawnie | Z-10 |
| `inject` – „Run only on one instance” (`singleInstance`) | wyłączone | cron raz w klastrze, interwał tylko na liderze, status „standby” | Z-10 |
| `deploy.reload: {watch, type, preReloadTimeout, concurrency, retry}` | `watch: false`, `type: "full"`, 20 min, brak limitu, `{1000, 60000, 10, "fail", 1800000}` | przeładowanie flow w procesie po zmianie w magazynie: drenaż (`/ready` 503), ponowny odczyt pod blokadą, najnowsza rewizja, bez zapisu i bez restartu procesu; powiadomienia łączone, w trakcie startu buforowane; wdrożenie lokalne unieważnia oczekujące przeładowanie (po unieważnieniu – także przez `POST /flows/state` lub nieudane wdrożenie – rewizja w magazynie jest porównywana z aktywną i przeładowanie wznawiane, gdy się różnią); `diff` – tylko zmienione flow; `concurrency` – sloty koordynacji; po wyczerpaniu `retry.attempts` kolejnych nieudanych cykli `failed`, potem odczyt co `retry.max` aż do powrotu do `ready`; cykl jest nieudany na każdym kroku (odczyt, ponowny odczyt pod blokadą, samo przeładowanie, np. `credentials_load_failed`), a licznik zaczyna się od nowa dopiero po udanym cyklu (przeładowanie zastosowane lub rewizja bez zmian), nie po udanym pierwszym odczycie (#17) | Z-09, #17 |
| `deploy.reload.retry.onExhausted` | `"fail"` | po wyczerpaniu `retry.attempts` nieudanych cykli przeładowania (patrz wyżej): `"fail"` – jak dotąd (R-36): `failed` i `/ready` 503; `"keepReady"` – **tylko błąd odczytu magazynu** (`storage_error`): stan cyklu życia bez zmian, gotowa instancja zostaje gotowa i dalej uruchamia poprzednią rewizję, `/ready` 200 `{"status":"warn","reason":"reload_failed"}` (stała treść – bez rewizji i tekstu błędu), bezczynna zostaje `idle` (503); bez wymuszonego przeładowania. Błędy konfiguracji (`credentials_load_failed`, `invalid_flows`, uszkodzony plik flow lub poświadczeń: `invalid_json`, `empty_file`), inny błąd samego przeładowania i nieudany start flow zawsze dają `failed`/503 (z `"keepReady"` warunek `reload` ma wtedy `keepReady: false`). **Raportowanie jako błąd:** log `error` przy wejściu (kod, liczba prób, rewizja aktywna) i co najwyżej raz na `retry.max` dopóki trwa; trwałe powiadomienie w edytorze (`reload-failed`); pole `reload` zdarzenia `instance:state`; log `info` `reload.recovered` po powrocie i komunikat o powrocie w edytorze (znika po 10 s); po `maxStaleTime` powiadomienie zmienia się w błąd. Wszystko tylko z `"keepReady"` – przy `"fail"` bez warunku, zdarzeń, logów i powiadomień. Koniec stanu: odczyt z tą samą rewizją co aktywna (bez drenażu, `preReload` i restartu), udane przeładowanie nowej rewizji (także gdy jej start się nie powiedzie), udane wdrożenie na tej instancji. **Ryzyko:** instancja, która nie czyta magazynu (np. pojedynczy pod odcięty od sieci), obsługuje nieaktualną rewizję – ogranicza to `maxStaleTime`. Nieprawidłowa wartość → ostrzeżenie i `"fail"` | #1, R-47 |
| `deploy.reload.retry.maxStaleTime` | `1800000` (30 min); tylko z `"keepReady"` | po tym czasie od pierwszego nieudanego odczytu serii błędów (nie od wyczerpania ponowień) `/ready` odpowiada 503 (log `error`, zdarzenie `instance:state` z `reload.stale`); flow nadal działają, odczyt magazynu jest ponawiany co `retry.max`; `0` – bez limitu; wartość niebędąca liczbą ≥ 0, ≤ 2147483647 → ostrzeżenie i domyślna | #1, R-47 |
| `watchFlows(callback)` wtyczki magazynu | opcjonalne | bez niego `deploy.reload` bez efektu (ostrzeżenie); magazyn plikowy obserwuje `flowFile` i plik poświadczeń (także wspólny wolumen, `readOnly`, `readOnlyUserDir`; nie z Projektami); błąd rejestracji przy `watch: true` → błąd startu; odczyt do przeładowania ścisły (`getFlows({strict: true})`) – błąd odczytu, brak, pusty lub niepoprawny plik flow → ponowienia, potem `failed`, nigdy pusta konfiguracja | Z-09 |
| hook `preReload` | brak | `{rev, activeRev, type, changedFlows, credentialsChanged, deadline, signal}` (o zakresie przeładowania decyduje `changedFlows`, `null` = wszystkie flow; `type` to typ z konfiguracji, nie faktyczny – przy `"diff"` przeładowanie jest pełne po zmianie poświadczeń, także w trakcie drenażu, lub przy zmianie globalnej; dodatkowa runda po zmianie samych flow ma listę nowych flow i pozostaje `diff`, #43) – drenaż pracy w toku z limitem `preReloadTimeout`, bez prawa weta; dodatkowa runda dla flow zmienionych w trakcie drenażu (najwyżej jedna) | Z-09 |
| `editorOnly` | `false` | instancja tylko do edycji: flow wczytane, nigdy nie startują (stan `loaded`, `/ready` 200 – także przy brakujących typach, tylko ostrzeżenie w logu; moduły węzła Function nie są instalowane); wdrożenie tylko zapisuje (`{rev, started: false}` przy `deploy.response: "started"`); `POST /flows/state` start → 409 `editor_only`; w edytorze bez Start/Stop, „Restart Flows” i przyciski węzłów (inject) nieaktywne z podpowiedzią | Z-15 |

**Uwagi konfiguracyjne (wiele instancji):**
- Sondy bez `health.port` są montowane na głównym serwerze HTTP **przed uwierzytelnieniem** – na instancji wystawionej
  przez reverse proxy `/health/live` i `/health/ready` są publiczne. Zalecenie: osobny `health.port` dostępny tylko
  w sieci wewnętrznej (zgłoszenie #5).
- Hooki `preReload` i `preShutdown` muszą mieć **dokładnie jeden parametr** (`payload`) i zwracać obietnicę, np.
  `RED.hooks.add("preReload", async (payload) => { … })`. Hook z innym parametrem jest wołany jako
  `(payload, done)` (mechanizm hooków Node-RED), a zwrócona obietnica jest ignorowana – bez wywołania `done`
  przeładowanie czeka do `preReloadTimeout` (domyślnie 20 min), zamykanie do `shutdownTimeout` (zgłoszenie #5).
- Hooki `preReload` i `preShutdown` można rejestrować w `settings.js` (`hooks`, zgłoszenie #7) – bez wtyczki i bez
  sięgania do wewnętrznego singletonu `@node-red/util`; obowiązuje ta sama zasada jednego parametru. Przykład:
  `hooks: { "preShutdown.drain": async (payload) => { … } }`. Hook zarejestrowany z wtyczki lub węzła nadal działa, ale
  pojawia się dopiero po załadowaniu wtyczek.
- Hook z `settings.js`, który nigdy się nie wykona, jest zgłaszany ostrzeżeniem przy starcie (zgłoszenie #15):
  `preShutdown.<etykieta>` bez `shutdownTimeout` (hook nie jest wołany, a `health.unreadyGrace` samo drenuje – log
  „Not ready for N ms before stopping” nie oznacza, że hook zadziałał) oraz `preReload.<etykieta>` bez
  `deploy.reload.watch: true` (przeładowanie z magazynu nie działa). Ostrzeżenie nazywa hook i brakujące ustawienie;
  hook pozostaje zarejestrowany, zachowanie się nie zmienia.
- Instancja `editorOnly` nie uczestniczy w koordynacji klastra (nie uruchamia wybranej wtyczki koordynacji) i nigdy
  nie jest liderem – przywództwo obejmują tylko instancje wykonujące flow (zgłoszenie #4).
- Klaster współdzielący magazyn wymaga **jawnego `instanceId`, takiego samego na wszystkich instancjach** (`settings.js`,
  np. `instanceId: process.env.NODE_RED_INSTANCE_ID`; w Bot-Engine – ustawiane per tenant). Bez niego każda instancja
  generuje identyfikator i zapisuje go w magazynie; przy równoczesnym starcie zapis nie jest bezpieczny (magazyny nie
  mają compare-and-set, `storage-postgres` nadpisuje cały wiersz ustawień), więc instancje mogą zakończyć z różnymi
  identyfikatorami – ponowny odczyt po zapisie tego nie naprawia. Wygenerowany identyfikator przy wtyczce koordynacji
  innej niż lokalna daje ostrzeżenie w logu (`coordination.instance-id-generated`). Jawny `instanceId` z `settings.js`
  ma pierwszeństwo przed magazynem. `instanceId: process.env.X` przy braku zmiennej daje `undefined`: wartość jest
  traktowana jak brak klucza (używany jest identyfikator z magazynu albo generowany i zapisywany); wcześniej start
  kończył się błędem `property-read-only` (zgłoszenie #3). Identyfikator generuje i zapisuje tylko pierwsza instancja
  (albo instancje ścigające się przy pierwszym starcie); pozostałe czytają go z magazynu. Ostrzeżenie o wygenerowanym
  identyfikatorze pojawia się tylko przy starcie, który go wygenerował. Przy `readOnly`/`readOnlyUserDir` (ustawienia
  tylko w pamięci) identyfikator zmienia się przy każdym starcie, więc w klastrze jest tam wymagany jawny `instanceId`.

## 6. Zmiany zachowania względem 5.0.7 (poprawki błędów)

- Restart flow przy 409 i przyciski „Merge”/„Ignore & deploy” nie kończą się błędem skryptu.
- Odrzucony start flow jest logowany (zamiast nieobsłużonego odrzucenia obietnicy).
- `PUT /flow/:id` z id węzła z innego flow → 400 `duplicate_id` (wcześniej zdublowane id).
- Nieprawidłowy `Node-RED-API-Version` na `/flow` – traktowany jak v1 z ostrzeżeniem w logu (R-46).
- Operacje stanu flow i Projektów czekają na trwające wdrożenie (wcześniej mogły się na nie nałożyć).
- Nowa linia logu przy starcie `Coordination   : local` (lub nazwa wtyczki koordynacji, Z-10) – świadoma zmiana wyjścia logu; narzędzia parsujące log startowy muszą ją tolerować.
- Nieudane zatrzymanie po sygnale (np. odrzucone `RED.stop()`) – log `Shutdown failed: …` i kod wyjścia 1 (wcześniej nieobsłużone odrzucenie obietnicy, Z-08).
- Przy `readOnly`/`readOnlyUserDir` pusty plik flow lub poświadczeń nie jest nadpisywany kopią `.backup` – kopia jest tylko czytana (Z-09/Z-11).
- Przy `deploy.reload.retry.onExhausted: "keepReady"` (domyślnie wyłączone) `/health/ready` może odpowiedzieć 200 z treścią `{"status":"warn","reason":"reload_failed"}` zamiast `{"status":"ok"}`; monitoring dopasowujący treść `"ok"` zobaczy `"warn"` tylko po włączeniu opcji. Zdarzenie `instance:state` jest emitowane także przy zmianie samego warunku `reload` (bez zmiany `state`) – to nowa reguła kontraktu (R-47, MIGRACJA §4.5); odbiorca reagujący tylko na zmiany stanu porównuje `state`, `reason` i `since`. W trybie domyślnym (`"fail"`) nic się nie zmienia: brak warunku `reload`, dodatkowych zdarzeń, logów i powiadomień – ta sama sekwencja zdarzeń `instance:state` i te same odpowiedzi `/ready` co przed R-47 (R-36).
- `instanceId` (#3): start czeka na zapis wygenerowanego identyfikatora w magazynie, **bez limitu czasu** (tak samo jak
  na odczyt ustawień z magazynu) – zapis, który się nie kończy, wstrzymuje start. `instanceId: undefined` w `settings.js`
  (np. `process.env.X` bez zmiennej) nie kończy już startu błędem `property-read-only`; jest traktowane jak brak klucza,
  więc czytany jest identyfikator z magazynu (wcześniej start padał). Odrzucony zapis identyfikatora jest ostrzeżeniem
  w logu, a nie nieobsłużonym odrzuceniem obietnicy; start trwa z wygenerowanym identyfikatorem.
- Przeładowanie z magazynu (`deploy.reload.watch: true`), w którym zawodzi ponowny odczyt pod blokadą lub samo przeładowanie (np. `credentials_load_failed`), wyczerpuje teraz `deploy.reload.retry.attempts` i kończy się stanem `failed` (503) – wcześniej licznik był zerowany po każdym udanym pierwszym odczycie i instancja ponawiała próby w nieskończoność, nie osiągając `failed` (#17). Dotyczy też trybu domyślnego; z `"keepReady"` rosną `attempts` warunku `reload` i pojawiają się okresowe logi `error`. Nowe powiadomienie o zmianie w magazynie skraca tylko opóźnienie kolejnej próby (backoff zaczyna od `retry.min`), nie zeruje licznika prób – inaczej instancja, która dostaje powiadomienia częściej niż trwa seria prób (np. wtyczka magazynu powiadamiająca po ponownym połączeniu), nigdy nie osiągałaby `failed`. Po wyczerpaniu prób i powrocie instancji do `ready` przez wdrożenie lokalne nowy błąd konfiguracji lub przeładowania (np. `credentials_load_failed` nowej rewizji) rozpoczyna nową serię i znów kończy się `failed` po `retry.attempts` próbach; sam błąd odczytu magazynu zachowuje się jak dotąd (okresowe próby, bez nowego `failed`). Logowanie po wyczerpaniu: w trybie `"fail"` instancja w stanie `failed` ponawia cykl co `retry.max` i loguje to na poziomie `debug` (bez ostrzeżeń `read-failed`); z `"keepReady"` błąd konfiguracji lub przeładowania po warunku `storage_error` powoduje natychmiastowe `failed` (log `error` `reload.not-kept-ready`). Udany cykl przeładowania kończy też ponowienie zaplanowane przez wcześniejszy nieudany cykl – wcześniej po sukcesie startował jeszcze jeden zbędny cykl (dodatkowy odczyt magazynu), zarówno gdy timer ponowienia jeszcze nie wystrzelił, jak i gdy wystrzelił w trakcie udanego cyklu (np. podczas wolnego drenażu `preReload`). Ponowienie, które wystrzeli w trakcie trwającego cyklu, nie uruchamia już natychmiastowego dodatkowego cyklu: gdy ten cykl się nie powiedzie, następna próba następuje po opóźnieniu (backoff) tej porażki, a nie od razu. Powiadomienie z magazynu nadal uruchamia cykl od razu, jak dotąd (#26).
- Przeładowanie z magazynu (`deploy.reload.watch: true`, #2): poświadczenia są porównywane tak jak rewizja flow – runtime liczy skrót (HMAC-SHA-256 kanonicznego JSON z kluczem losowym dla procesu) **odszyfrowanej** zawartości poświadczeń z magazynu i porównuje go ze skrótem działającej konfiguracji (liczonym po wczytaniu poświadczeń przy przeładowaniu, starcie i własnym zapisie). Przeładowanie następuje, gdy różni się rewizja lub skrót; zmiana samych poświadczeń jest wykrywana bez flagi w powiadomieniu, a zgubione powiadomienie naprawia kolejne. **Flaga `credentialsChanged` powiadomienia `watchFlows` jest tylko wskazówką do odczytu** – nie wymusza już przeładowania (dawniej wymuszała pełny drenaż i przeładowanie z pominięciem porównania rewizji, także przy niezmienionych poświadczeniach); wtyczki magazynu, które używały jej do wymuszenia, nie mają tego efektu. Pole `credentialsChanged` hooka `preReload` jest teraz obliczane z porównania skrótów. Ponowne zaszyfrowanie tych samych poświadczeń (nowy losowy IV) i własny zapis nie są zmianą. Poświadczenia z magazynu są odczytywane kluczem, którego użyłoby wczytanie poświadczeń – także starym wygenerowanym kluczem, dopóki trwa migracja do `credentialSecret` – bez migrowania, zapisu i logowania; te, których ten klucz nie odszyfruje, kończą się `credentials_load_failed` tą samą ścieżką co błąd przeładowania. Skrót jest wewnętrzny (nie jest logowany, nie jest zwracany przez `GET /flows` – tylko `{flows, rev}`). Wyjątek: instancja uruchomiona z poświadczeniami, których nie dało się odszyfrować (np. po resecie poświadczeń przy złym kluczu), nie ma skrótu; przy tej samej rewizji flow nieodszyfrowalne poświadczenia w magazynie nie są błędem (jak przed #2), nowa rewizja idzie normalną ścieżką (`credentials_load_failed`). Dotyczy tylko `deploy.reload.watch: true`; bez niego nic się nie zmienia.
- Hook `preReload` (#43): pole `type` ładunku to **typ z konfiguracji** (`deploy.reload.type`), a nie faktyczny typ przeładowania – kontrakt się nie zmienia. O zakresie decyduje `changedFlows` (`null` = wszystkie flow); przy `type: "diff"` przeładowanie jest pełne, gdy zmieniły się poświadczenia (także w trakcie drenażu – wtedy dodatkowa runda ma `changedFlows: null`) albo przy zmianie globalnej, i ładunek ma wtedy `{type: "diff", changedFlows: null}`; dodatkowa runda po zmianie samych flow ma listę nowych flow i przeładowanie pozostaje `diff`. Wtyczka powinna czytać zakres z `changedFlows`, nie z `type`.
- `credentials.digest()` (#43, SEC-004): każdy błąd poza odszyfrowaniem (np. getter lub Proxy obiektu z wtyczki magazynu, który rzuca) kończy się stałym błędem `credentials_digest_failed` o stałym komunikacie, bez komunikatu przyczyny – log przeładowania (`reload.read-failed`) nie zacytuje więc sekretu. Reguła z #2 się nie zmienia: nieudany skrót to „brak zmiany” tylko przy tej samej rewizji i nieznanym skrócie działającej konfiguracji, w przeciwnym razie błąd idzie dalej (`reload_failed` w porównaniu cyklu, `storage_error` przy ponownym odczycie pod blokadą – z `keepReady` instancja zostaje wtedy gotowa).
- Edytor, błędy wdrożenia (#22, R-48): (1) odpowiedź 500 `deploy_start_failed` / `deploy_stop_failed` z `rev` oznacza, że konfiguracja
  **jest zapisana** (tryb `deploy.response: "started"`) – edytor przejmuje nowy `rev`, oznacza zmiany jako wdrożone i pokazuje
  czerwony błąd z listą przyczyn (wcześniej: zmiany niewdrożone, nieaktualny `rev` i 409 `version_mismatch` przy kolejnym
  wdrożeniu, fałszywe „flow zmienione w tle” przy późnym `runtime-deploy`, w `reload-only` blokujące okno); (2) **także w trybie
  domyślnym** błędy wdrożenia, „Restart flow” i „Start/Stop” pokazują czytelny komunikat zbudowany z pola `message` odpowiedzi
  (albo ogólny „nieoczekiwana odpowiedź serwera (HTTP …)”) zamiast surowego JSON-a wstawianego jako HTML – zmiana tylko
  wyświetlania, bez wpływu na zapis i API; wartości z odpowiedzi i nazwy flow są escapowane. Zmiany zachowania dla 409
  (`version_mismatch`, `version_required`) i dla błędów bez `rev` (zmiany zostają niewdrożone) nie ma.
- `http in` (#11): przy zamknięciu węzła (wdrożenie, zatrzymanie) usuwane są **tylko trasy tego węzła**, rozpoznane po jego handlerze. Wcześniej usuwane były wszystkie trasy z tą samą ścieżką i metodą – także innych węzłów `http in` i tras dodanych przez inne moduły przez `RED.httpNode` – a trasa następująca bezpośrednio po usuniętej była pomijana (`splice` w trakcie `forEach`). Klucz trasy „surowego ciała” (`skipBodyParsing`) jest utrzymywany, dopóki korzysta z niego jakikolwiek węzeł (licznik na klucz). Skutek: gdy dwa węzły `http in` mają tę samą ścieżkę i metodę, odpowiada pierwszy zarejestrowany (Express), a po jego zamknięciu odpowiada drugi, zamiast 404. Węzły spoza rdzenia nadal nie mają wspieranego sposobu zdejmowania własnych tras (API tras węzła jest osobnym etapem #11).
- Edytor, błąd zapisu do biblioteki (okno biblioteki) i eksportu do biblioteki (okno eksportu schowka) (#30): komunikat
  `library.saveFailed` wstawiał surową treść odpowiedzi serwera jako HTML (XSS przy odpowiedzi z znacznikami). Teraz
  pokazuje pole `message` odpowiedzi JSON (albo ogólny „nieoczekiwana odpowiedź serwera (HTTP …)”) z escapowaniem
  `& < > " '`, nigdy surową treść; ten sam formater co błędy wdrożenia (`RED.deploy.translateErrorResponse`, dziś `RED.errors.translateResponse`). Brak odpowiedzi
  HTTP (status 0) daje „brak odpowiedzi z serwera”. Polski edytor: przetłumaczone `library.saveFailed` i `user.notAuthorized`
  (komunikat nie miesza języków). Bez zmian API.
- Edytor, błędy z serwera i błędy importu w powiadomieniach (#34): tekst z odpowiedzi serwera i nazwa modułu
  były wstawiane do `RED.notify` (renderuje HTML) bez escapowania. Teraz są escapowane (`& < > " '`) w: palecie
  (instalacja, aktualizacja, usunięcie, włączenie i wyłączenie modułu, instalacja z pliku i automatyczna),
  projektach (błąd nieoczekiwany: `message` i `code`; błędy git zdalnych gałęzi), kontroli wersji (błędy git,
  utrata połączenia przy pull – pokazuje teraz `message` zamiast „[object Object]”), ładowaniu modułu węzła
  (`red.js`), imporcie i upuszczaniu węzłów (`view.js`; komunikat błędu importu zawiera fragment wklejonego tekstu) i
  grupach (`group.js`). Tekst katalogu nadal jest HTML-em. Wspólny kod escapowania przeniesiony z `RED.deploy`
  do nowego modułu `RED.errors` (`ui/common/errors.js`: `escape`, `parseResponse`, `translateEscaped`,
  `translateResponse`, `translateException`); `RED.deploy.formatStartErrors` działa jak dotąd, a biblioteka nie zależy już od
  modułu wdrożenia. `RED.deploy.translateErrorResponse` został wtedy jako alias, a w #37 jest usunięty (zamiennik:
  `RED.errors.translateResponse`). Bez zmian API HTTP.
- Edytor, dalsze miejsca z tekstem spoza katalogu w HTML (#37):
  - Escapowane: nazwa modułu w potwierdzeniach instalacji, aktualizacji i usunięcia oraz w komunikacie postępu instalacji
    automatycznej; adres zdalnego repozytorium w oknie uwierzytelnienia git; nazwa pliku w potwierdzeniu `revert` i w
    tytule okna ze zmianami pliku; nazwy projektu, gałęzi, zdalnego repozytorium i klucza w potwierdzeniach usunięcia;
    typ i błąd węzła, którego nie dało się zarejestrować; moduł i wersja zaktualizowanego modułu; komunikat błędu
    importu; typ biblioteki przy zapisie; wartości powiadomień runtime (`red.js`, `runtime.js`); podpowiedź konfliktu
    na przycisku instalacji i wersja modułu oczekująca na restart.
  - Ustawiane jako tekst, nie jako HTML: wersja modułu, nazwa katalogu i opcje filtra katalogów na zakładce Install
    (pochodzą ze zdalnego katalogu i uruchamiały się przy samym otwarciu zakładki, bez kliknięcia), nazwa elementu
    biblioteki.
  - Linkiem i przyciskiem „Open node information” jest tylko adres `http:` lub `https:` ze zdalnego katalogu (adres
    `javascript:` był linkiem); strona otwiera się z `noopener`. Nowe `RED.errors.httpUrl`.
  - **Zmiany API edytora dla kodu, który z niego korzysta (moduł węzła, wtyczka):** `RED.utils.sanitize` escapuje teraz
    także `"` i `'` (dotąd tylko `& < >`) i dla `null`/`undefined` zwraca pusty tekst (dotąd błąd TypeError). Moduł, który
    wynik wstawia do `.text()` lub `.attr()`, pokaże teraz `&quot;`/`&#39;` zamiast cudzysłowu – do czystego tekstu nie
    wolno escapować. Nowe `RED.utils.sanitizeContent` zachowuje dawne escapowanie `& < >` (markdown, tekst dzielony po
    znakach). Nowe `RED.errors.notifyGitError` (dawniej dwie kopie w projektach i kontroli wersji);
    `RED.errors.translateEscaped` zostawia liczby i wartości logiczne bez zmian. **`RED.deploy.translateErrorResponse`
    jest usunięty** – zamiennik: `RED.errors.translateResponse` (te same argumenty i wynik); nie było go w żadnym
    wydaniu. API HTTP i ustawienia bez zmian.
  - Dwa miejsca, które escapowały tekst dla miejsca wyświetlającego czysty tekst (podpowiedź zakładki, tytuł okna edycji
    węzła – escapowany dwukrotnie), nie pokazują już encji. Włączenie i wyłączenie modułu pokazywało „Nie udało się
    zainstalować” z niezdefiniowaną nazwą (albo kończyło się błędem `ReferenceError`); teraz podaje właściwą czynność i
    moduł, jako błąd, a teksty są też w polskim katalogu.
  - Nie zrobione (opcjonalne, R2 przeglądu #36): maskowanie `//user:pass@` w stderr gita – właściwe miejsce to runtime
    (komunikat błędu jest budowany w `projects/git`, trafia do odpowiedzi API i logów), osobne zgłoszenie (#45).
- `http in`, surowe ciało „Do not parse request body” (`skipBodyParsing`, #16): (1) trasa z parametrem (`/hook/:id`) lub adresowana inną
  wielkością liter (`/HOOK`) dostaje teraz `Buffer` **niezależnie od `deploy.holdHttpNodeRequests`** (wcześniej – obiekt lub tekst,
  bo `rawBodyCapture` zna tylko dosłowny klucz `METODA:url`; psuło to np. weryfikację podpisu ciała); każda trasa z tą opcją czyta
  surowe ciało sama. (2) **Surowe ciało ma limit, domyślnie włączony:** wartość `apiMaxLength`
  (domyślnie 5 MB; to samo ustawienie co parsery JSON i urlencoded); większe ciało → **413** (także bez `Content-Length`; z nagłówkami
  CORS, bo odpowiedź wysyła trasa), flow się nie wykonuje. **Integracja wysyłająca surowe ciało powyżej 5 MB dostanie 413**, dopóki nie podniesie się limitu (`apiMaxLength` albo
  pole węzła). Reszta odrzuconego ciała jest czytana i odrzucana (do 64 MB), żeby klient dostał 413, a nie reset połączenia; gdy `Content-Length`
  deklaruje ponad 64 MB (albo odrzucone ciało przekroczy 64 MB), odpowiedź 413 z `Connection: close` idzie od razu.
  (3) **Pole węzła „Max body size” (`maxBodySize`):** zastępuje limit dla jednego węzła (wyższy lub niższy), dla tras przyjmujących duże
  pliki lub obrazy; liczba z opcjonalną jednostką `b`/`kb`/`mb`/`gb`/`tb`/`pb` (1024; np. `50mb`; sama liczba to bajty; tekst do 32 znaków). Dotyczy surowego
  ciała oraz – przy „Accept file uploads” – **całego ciała żądania multipart** (wszystkie pliki i pola razem, z ramkami multipart, więc
  pojedynczy plik przechodzi do nieco poniżej limitu); 413 po przekroczeniu: od razu, gdy `Content-Length` przekracza limit, a przy
  `Transfer-Encoding: chunked` po przekroczeniu liczby odebranych bajtów (multer nie dostaje reszty); bez pola upload pozostaje **bez
  limitu**, jak dotąd. Żądanie niebędące multipart na trasie z uploadem nie jest limitowane tym polem (jak dotąd). Puste pole = domyślny
  limit; nieprawidłowa wartość → ostrzeżenie węzła i limit domyślny (pole jest brane pod uwagę tylko przy `skipBodyParsing` lub
  uploadzie; w edytorze jest walidowane tylko, gdy widoczne). Nieprawidłowe `apiMaxLength` (liczba ≤ 0 albo tekst niebędący rozmiarem, np. `abc`) → jedno ostrzeżenie w logu
  (nie na każdy węzeł) i 5 MB. Brak nowego ustawienia globalnego. Na trasie dzielonej przez kilka węzłów obowiązuje limit węzła, który
  odpowiada (pierwszy zarejestrowany). Bez zmian: parsery JSON/urlencoded (nadal `apiMaxLength`) oraz `rawBodyParser` (ciało
  tekstowe i binarne trasy bez `skipBodyParsing`, nadal bez limitu).
  (4) **Miejsce odczytu (bezpieczeństwo):** `rawBodyCapture` jest zamontowany na aplikacji `httpNode` (`RED.httpNode`), a nie na aplikacji
  głównej. `httpNodeAuth` jest zamontowany na aplikacji głównej przed `httpNode` (`red.js`), a wstrzymanie żądań (#8) jest pierwszą warstwą
  `httpNode` (montowane przy inicjalizacji runtime, przed załadowaniem węzłów), więc **nic nie jest czytane przed uwierzytelnieniem ani
  w czasie wstrzymania** (wcześniej bufor do najwyższego limitu rósł przed odmową 401). Odczyt jest **przed** `httpNodeMiddleware` i trasami,
  więc middleware i obce trasy na tym samym kluczu nadal dostają `Buffer` w `req.body`, jak w upstream – **ale tylko do najwyższego limitu
  węzłów `skipBodyParsing` na kluczu** (upstream nie miał limitu): ciało większe dostaje 413 od razu z przechwycenia (z nagłówkami CORS
  węzłów) i **nic więcej** – ani middleware, ani obca trasa, ani węzeł bez `skipBodyParsing` na tym kluczu – go nie widzi (strumień jest
  już wstrzymany; reszta jest czytana i odrzucana, zob. wyżej). Klucz trasy jest względem `httpNodeRoot` (bez prefiksu). Na wspólnym
  kluczu przechwycenie czyta do najwyższego z limitów, a trasa każdego węzła sprawdza własny. Trasa węzła czyta ciało, gdy przechwycenie tego nie zrobiło (trasa
  z parametrem, inna wielkość liter, okno #8), **także gdy middleware ustawił `req.skipRawBodyParser = true`** (przykład z `settings.js`;
  flaga oznacza „pomiń parser”, nie „ciało przeczytane” – do tego służy osobna flaga `_rawBodyRead`). Uwaga (dwa odczyty): middleware, który na trasie
  z parametrem sam czyta strumień ciała, ustawia `skipRawBodyParser` i nie zużywa go do końca, nie wyklucza odczytu przez trasę węzła –
  ciało może być wtedy przeczytane dwa razy (przez middleware i przez trasę); strumień zużyty do końca trasa pomija (`readableEnded`). Ładowanie modułu ponownie na tej samej
  aplikacji (`RED.stop()` i `RED.start()` w jednym procesie) zastępuje warstwę przechwycenia na jej miejscu, zamiast dodawać drugą.
  **Nie opieraj autoryzacji na `httpNodeMiddleware` ani na `RED.httpNode.use(auth)` dodanym po `RED.start()` (tryb osadzony):** ciało trasy
  `skipBodyParsing` jest czytane przed nimi (do limitu), a powyżej limitu klient dostaje 413 zamiast 401. Żeby nie czytać ciała żądań
  nieuwierzytelnionych, użyj `httpNodeAuth` albo middleware aplikacji zewnętrznej przed `RED.httpNode`. 413 z przechwycenia dostaje
  nagłówki CORS z globalnego `httpNodeCors`, także na trasie obcej z własnym CORS. Węzeł bez `skipBodyParsing` na tej samej ścieżce
  i metodzie co węzeł z tą opcją dostaje 413 dla ciała większego niż limit tamtego węzła.
- `GET /settings` (#45, SEC-001): z aktywnym projektem odpowiedź zawierała cały obiekt projektu (`runtime/lib/api/settings.js`), a w nim `credentialSecret` projektu (klucz do zaszyfrowanych poświadczeń flow) i `remotes` z `user:hasło` adresów repozytoriów – dla każdego z uprawnieniem `settings.read` (także rola tylko do odczytu). Teraz `project` w tej odpowiedzi to `export()` projektu, ten sam co w `GET /projects/:id` (bez `credentialSecret`, adresy zamaskowane). Kod jest taki sam w upstream, więc to najpewniej luka odziedziczona. Zserializowany przez pomyłkę `Project` (`JSON.stringify`) też daje `export()`. Edytor nie czyta `RED.settings.project`.
- Projekty/git (#45): dane logowania z adresu URL repozytorium (`https://user:haslo@host/...`, `https://token@host/...`, `ssh://user:haslo@host/...`) są zastępowane przez `//***@` w runtime, w miejscu tworzenia błędu: w treści błędu polecenia git (`message`, `stderr`, `stdout`, `value`, a więc także w odpowiedzi API i logu audytu), w logu `trace` polecenia i w zdarzeniach `event-log` polecenia uruchomionego przez `exec.run` (linia polecenia i wyjście; to obejmuje też `npm install` z adresu z hasłem, ale wyłącznie w `event-log` – log `trace` i błąd instalatora modułów (`registry/lib/installer.js`) nie są maskowane). Wyjście w `event-log` jest zapisywane liniami (jedno zdarzenie na linię i strumień zamiast jednego na fragment), więc adres rozcięty między fragmentami też jest rozpoznany (linia dłuższa niż 64 KB jest najpierw maskowana w całości, potem ucinana na ostatnim białym znaku co najmniej 4 KB przed końcem; ostatnie 4 KB czeka na kolejny fragment, więc adres lub sekret niekompletny w chwili cięcia jest dokończony i zamaskowany później). `remotes[].fetch` i `push` zwracane przez API projektów (`GET /projects/:id`, `GET /projects/:id/remotes`) są maskowane tak samo; git, `.git/config` i pamięć podręczna poświadczeń (klucz = adres `fetch`) zachowują prawdziwy adres, więc działanie gita się nie zmienia. Adres scp (`git@github.com:org/repo`) i sam użytkownik `ssh://git@host` (bez hasła) nie są zmieniane. Dodatkowo identyfikator użytkownika i hasło zdalnego, który już jest w `.git/config`, a którego wzorzec nie rozpoznaje (hasło z nieescapowanym `/` lub spacją), są ukrywane dosłownie, tylko w tekście operacji tego projektu: sekrety są trzymane per projekt, podmieniane przy każdym `git remote -v`, czyszczone przy usunięciu zdalnego lub projektu i ograniczone liczbowo; zwykłe hasło nigdy nie trafia na tę listę, więc maskowanie tekstu wpisanego przez użytkownika (np. wiadomości commita) niczego nie zdradza. Treść odrzuconego argumentu gita nie zawiera już samego argumentu. Kod błędu gita (`git_auth_failed`, `git_pull_merge_conflict` …) jest ustalany na surowym wyjściu, maskowany jest tylko tekst błędu. **Ograniczenie (SEC-011):** stary zdalny adres wpisany ręcznie do `.git/config`, w którym hasło zaczyna się od cyfr przed `/` (`user:2024/abc@host`) albo token zawiera `/` (`tok/en@host`), nie jest maskowany – wzorzec go nie rozpoznaje, a nie da się go odróżnić od portu lub ścieżki, więc nie jest też zapamiętywany jako sekret. Dotyczy tylko adresów wpisanych ręcznie; nowe takie adresy odrzuca walidacja przy klonowaniu i dodawaniu zdalnego. Zalecenie: zakodować hasło (`%2F`) w `.git/config`. **Zmiana zachowania:** adres zdalny z białym znakiem lub znakiem sterującym albo z danymi logowania, których nie da się odróżnić od ścieżki (hasło z `/`, `?`, `#`; `@` w ścieżce), jest odrzucany przy klonowaniu i dodawaniu zdalnego (`git_invalid_argument`) – znaki specjalne w haśle trzeba zakodować (`%2F`, `%40`, `%20`). Funkcja `maskUrlCredentials` jest wewnętrzna (`require("@node-red/util").maskUrlCredentials`, poza `util.util`, więc nie jest `RED.util` w węzłach). `exec.run` przyjmuje opcjonalny piąty argument z dosłownymi sekretami dla `event-log`. **Znane ograniczenie (SEC-004):** adres z hasłem jest argumentem procesu `git`, więc na hoście wielodostępnym jest widoczny w `ps` dla innych użytkowników systemu – maskowanie dotyczy błędów, logów i API, nie listy procesów; zalecane są klucze SSH albo poświadczenia z pamięci podręcznej zamiast hasła w adresie. Bez nowych ustawień.

## 7. Testy i proces

| Element | Zasada |
|---|---|
| Testy jednostkowe | `npm test` / `npx mocha test/unit/_spec.js "test/unit/**/*_spec.js"`; 5 testów `projects/ssh` wymaga `ssh-keygen` |
| Testy E2E | `npm run test:e2e` – Playwright **nie** jest w repozytorium (D-03): `npm i --no-save playwright`; bez niego testy są pomijane |
| Nagłówki modyfikacji | każdy zmieniony plik: blok „Modified by Actuna Sp. z o.o.” (D-19); JSON i szablon `settings.js` – w MODIFICATIONS.md |
| Commity | autorem jest operator AI (obecnie Wojciech Repiński), `Signed-off-by` (DCO), bez `Co-Authored-By` dla AI |
| Zależności npm | bez nowych zależności bez zgody Zamawiającego |
| Przegląd | każda faza: niezależny przegląd (DoD – ZASADY §3) |
| Decyzje | [design/engine-extensions/REJESTR-DECYZJI.md](design/engine-extensions/REJESTR-DECYZJI.md) (R-01…) |
| Plan i budżet | [design/PRIORYTETY.md](design/PRIORYTETY.md) |

## 8. Stan i dalsze prace

**Zrealizowane (na `main`):** priorytet 1 (układ flow, FL-B-004…012), priorytet 2 (P-01…P-04, Z-01, Z-02,
Z-04, Z-05, E-01), priorytet 3 w zakresie budżetu (E-02, Z-08, Z-09, Z-10, Z-11, Z-15). Każda faza przeszła
niezależny przegląd; poprawki po przeglądzie priorytetu 3 zweryfikowane testami (bez drugiego przeglądu – budżet).

**Weryfikacja (`5c2608b`):** build, lint, `verify-deps` czyste; testy jednostkowe 2253 ✔ / 5 ✘ (projects/ssh –
brak `ssh-keygen`); testy węzłów: 4 ✘ środowiskowe (proxy, IPv6 – tak samo na wersji bazowej); E2E 52/52.

**Wtyczki zewnętrzne:** magazyn i koordynację dla wielu instancji dostarcza się jako prywatne wtyczki poza tym
repozytorium. Kontrakt: [MIGRACJA.md](design/engine-extensions/MIGRACJA.md) §5.2 (`watchFlows`,
`getFlows({strict})`, `preReload`) oraz `node-red-coordination` (sekcja 5). Bez wtyczek działa wariant z
`flows.json` na wspólnym wolumenie (`deploy.reload.watch`, `readOnlyUserDir`).

**Znane ograniczenia:** FL-B-011 (dopasowanie subflow po kolejności węzłów); ograniczenia FL-B-010 (karta);
Z-02 nie jest piaskownicą; Z-09 – pełna ochrona przed pustą konfiguracją wymaga obsługi `{strict: true}` we
wtyczce magazynu; wspólny wolumen sieciowy (NFS) i klastrowa wtyczka koordynacji nie testowane na żywo;
różne strefy czasowe instancji – podwójne wyzwolenie crona w `inject` „tylko jedna instancja”; ostrzeżenie o
brakujących typach na instancji `editorOnly` tylko w logu.

**Poza zakresem (kolejny etap):** Z-06 (hooki `preDeploy`/`postDeploy`), Z-03, Z-07, Z-12 (rozszerzenia
edytora), Z-13 (język polski), FL-B-011.

**Do wykonania przez właściciela repozytorium:** przepisanie historii (usunięcie `design/k8s-postgres/` z
historii i force push), przeniesienie do repozytorium prywatnego (forka publicznego repozytorium nie można
przełączyć na prywatne), tag kamienia milowego F3 na commicie „Docs: milestone F3 summary”.
