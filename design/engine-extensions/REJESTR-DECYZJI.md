# Rejestr decyzji do ustalenia

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

Zebrane ze wszystkich dokumentów (ANALIZA §7.1, „Pytania” w kartach etapów 1–4, Z-12, ZALACZNIK-A-ANALIZA),
bez duplikatów, w kolejności priorytetów biznesowych ([../PRIORYTETY.md](../PRIORYTETY.md)). Przechodzimy punkt po
punkcie; wynik każdej decyzji trafia do kolumny „Decyzja” i do dokumentów, których dotyczy.

**Stan (2026-10-03):** wszystkie punkty R-01…R-43 rozstrzygnięte. R-01…R-32 naniesione na ANALIZA §7.0, ZASADY,
MIGRACJA, PRIORYTETY i karty etapów; R-33…R-43 – doprecyzowania po propagacji (sekcja niżej).

**Już rozstrzygnięte (nie wracamy):** D-01 baza 5.0.7 · D-02 nazwy (rewizja: utrzymane) · D-03 bez Playwright ·
D-04 podpisy, blokada upstream · D-10 przeładowanie różnicowe · D-11 drenaż SIGTERM · D-19 nagłówki · D-20
`version_required` · D-21 e-mail · B-01 utrwalanie wyglądu · N-01…N-04 · `allowDowngrade` domyślnie `true` ·
kod `invalid_node_type` w katalogu.

## Priorytet 1 – układ flow i przenoszalność

| ID | Temat | Źródło | Rekomendacja | Decyzja |
|---|---|---|---|---|
| R-01 | Z-14: zachowanie przy `editorTheme.flowLayout.enabled: false` | etap-4 p.9 | flow z zapisanym układem rysują się wg danych; ukryte tylko kontrolki || **rysuj wg danych** – ukryte tylko kontrolki (2026-10-03) |
| R-02 | Z-14: części runtime (API flow, `diffNodes`) działają niezależnie od ustawienia | etap-4 p.10 | tak (brak skutku dla flow bez tych pól) || **zawsze** – niezależnie od ustawienia (2026-10-03) |
| R-03 | Z-14: zakres błędów FL-B-004…009 | etap-4 p.11 | 004, 005, 006, 009 wymagane (eksport/import); 007, 008 – jakość wyglądu || **wszystkie: FL-B-004, 005, 006, 007, 008** (+ 009 z B-01) (2026-10-03) |

## Priorytet 2 – bezpieczeństwo

| ID | Temat | Źródło | Rekomendacja | Decyzja |
|---|---|---|---|---|
| R-04 | P-04: zgłoszenie luki zespołowi Node-RED (prywatnie, `SECURITY.md`) mimo blokady upstream (D-04) | etap-1 p.8 | do decyzji || **nie teraz** – poprawka tylko w forku; zgłoszenie po zniesieniu blokady D-04 (ryzyko dla innych użytkowników przyjęte) (2026-10-03) |
| R-05 | P-04: odpowiedź `/comms` na pakiet `auth` przy wyłączonym `adminAuth` | ZAŁ-A p.5 | do decyzji || **`auth ok`** – połączenie działa dalej (zmiana względem łatki 0002) (2026-10-03) |
| R-06 | D-07: kontrola nagłówka `Origin` dla `/comms` | etap-1 p.9 | tak, ustawienie z bezpieczną listą domyślną || **tak, opcjonalnie** – ustawienie z listą dozwolonych źródeł, domyślnie wyłączone; w naszych instalacjach włączone (2026-10-03) |
| R-07 | Z-02: użytkownik anonimowy (`adminAuth.default`) i wartość domyślna | etap-1 p.11–12 | anonimowy jak `needsPermission("")`; domyślnie `"open"` || **jak `needsPermission("")`** – użytkownik domyślny ma dostęp jak do wbudowanych tras (2026-10-03) |
| R-08 | XSS: nazwa użytkownika jako HTML w menu (`user.js:265`) | Z-12 P-10 | osobna poprawka bezpieczeństwa || **osobna poprawka teraz** (priorytet 2, poprawka błędu z testem) (2026-10-03) |
| R-09 | P-03: `NODE_RED_DISABLE_TELEMETRY` ⇒ `locked`? `locked` + `enabled: true`? | etap-1 p.7 | bez implikacji; `locked` działa w obie strony || **bez implikacji, obie strony** – `NODE_RED_DISABLE_TELEMETRY` działa jak dotąd; `telemetry.locked` blokuje zmianę `enabled` przy dowolnej wartości (2026-10-03) |

## Priorytet 2 – API

| ID | Temat | Źródło | Rekomendacja | Decyzja |
|---|---|---|---|---|
| R-10 | P-01: kod błędu startu (500 `deploy_start_failed`), zakres „błędu startu”, limit czasu, błędy zatrzymania (D-05), obsługa odrzucenia `start()` w trybie domyślnym | etap-1 p.2–5; ZAŁ-A p.3 | 500 + `rev`; typy/moduły + wyjątki flow; limit w Z-08; D-05 jak w ZASADY; log w trybie domyślnym || **500 `deploy_start_failed` + `rev` + `errors[]`**; zakres błędu startu: brakujące typy, moduły, tryb bezpieczny, wyjątki startu flow (bez błędów konstruktorów pojedynczych węzłów); w trybie domyślnym odrzucenie `start()` logowane (poprawka błędu); limit czasu → Z-08; błędy zatrzymania wg D-05/ZASADY (2026-10-03) |
| R-11 | E-01: `POST /flows/state` i przełączenie projektu pod wspólną blokadą; odczyt przy jawnym `reload` przed `preDeploy` | etap-1 p.14–15; etap-3 p.2 | tak / tak || **tak / tak** – `POST /flows`, `POST /flows/state` i przełączenie projektu pod wspólną blokadą (druga operacja czeka); przy `reload` odczyt magazynu przed `preDeploy` (2026-10-03) |
| R-12 | P-02: egzekwowanie po stronie serwera, „Overwrite” (D-12), etykieta, okno przy operacjach Projektów | etap-1 p.6; etap-2 p.10; ZAŁ-A p.4 | `reload-only` bez implikacji wymogu `rev`; D-12 || **zgodnie z rekomendacją** – `staleFlows: "reload-only"` tylko w edytorze (ukrywa „Overwrite”); wymóg `rev` wyłącznie przez `deploy.requireRevision` (Z-05); etykieta „Przeładuj flow”; Projekty bez zmian (fałszywy alarm) (2026-10-03) |
| R-13 | Z-04: `globalConfigs[]` (D-08), `rev` tylko w v2 (D-09) / `ETag`, 200 vs 201 i format id, `globalRev` | etap-2 p.5–8 | D-08, D-09; 201; `globalRev` tak || **zgodnie z rekomendacją** – `globalConfigs[]` (D-08); `rev` tylko w v2 + `ETag`, v1 bez zmian (D-09); `POST /flow` → 201 z id 16 hex; `globalRev` tak (2026-10-03) |
| R-14 | Z-05: v1 przy wymogu, `DELETE /flow/:id` z `?rev=`, `reload` zwolniony | etap-2 p.9 | 409 dla v1; DELETE z rev; reload zwolniony || **zgodnie z rekomendacją** – przy `requireRevision: true` klient v1 → 409 `version_required`; `DELETE /flow/:id` wymaga `?rev=`; `reload` zwolniony (2026-10-03) |
| R-15 | Z-06: `preDeploy` tylko walidacja, limit 30 s, `postDeploy` asynchronicznie, brak hooków przy starcie/Projektach | etap-2 p.11–13 | tak || **zgodnie z rekomendacją** – `preDeploy` tylko walidacja (400 `deploy_rejected`), limit 30 s (`deploy.hookTimeout`, 503 `deploy_hook_timeout`); `postDeploy` asynchronicznie, błąd tylko w logu; bez hooków przy starcie procesu i operacjach Projektów (2026-10-03) |
| R-16 | Z-07: przełącznik awaryjny `http in`, `rawBodyCapture` osobno | etap-2 p.14 | bez przełącznika; osobno || **bez przełącznika awaryjnego; `rawBodyCapture` osobnym ustawieniem** (2026-10-03) |
| R-17 | Z-03: zakres skorygowany, potwierdzenie przed instalacją (`dryRun`), aliasy ustawień uploadu | etap-2 p.1, 3, 4 | zakres skorygowany; bez `dryRun`; kanoniczne `allowUpload` + aliasy || **zgodnie z rekomendacją** – zakres skorygowany (`upload_not_allowed`, `module_downgrade_not_allowed` przy `allowDowngrade: true` domyślnie, walidacja typu); bez `dryRun`; kanoniczne `externalModules.palette.allowUpload` + aliasy z ostrzeżeniem w logu (2026-10-03) |

## Priorytet 3 – baza danych, wiele instancji

| ID | Temat | Źródło | Rekomendacja | Decyzja |
|---|---|---|---|---|
| R-18 | Z-11: kontekst plikowy (D-15), wdrożenie przy magazynie plikowym, zmienna środowiskowa CLI | etap-3 p.15–17 | błąd startu; 400 `read_only_user_dir`; zmienna środowiskowa || **zgodnie z rekomendacją** – kontekst plikowy przy `readOnlyUserDir` → błąd startu (D-15); wdrożenie przy magazynie plikowym → 400 `read_only_user_dir`; dodatkowo zmienna środowiskowa (2026-10-03) |
| R-19 | Z-15: `editorOnly` vs `runtimeState.autoStart`, przycisk `inject`, `/ready` (D-13) | etap-4 p.12–13; etap-3 p.3 | `editorOnly`; przycisk nieaktywny; 200 w `loaded` || **zgodnie z rekomendacją** – `editorOnly: true`; przycisk `inject` nieaktywny z podpowiedzią; `/health/ready` 200 w stanie `loaded` (D-13), safe mode i zatrzymane flow → 503 (2026-10-03) |
| R-20 | Z-09: `concurrency`, `preReload` bez weta, błąd odczytu magazynu (D-18), `retry`, D-17 | etap-3 p.7–11 | jak w kartach || **zgodnie z rekomendacją** – `concurrency` tylko liczbowo, bez łączności z koordynatorem czeka (stara konfiguracja działa); `preReload` bez weta, domyślnie 20 min; błąd odczytu → ponowienia, po wyczerpaniu `failed` i 503 (D-18); `deploy.reload.retry: { min: 1000, max: 60000, attempts }`; D-17 – dodatkowy `preReload` dla zmienionych flow (2026-10-03) |
| R-21 | Z-10: semantyka `inject` (D-14), jawny wybór wtyczki, `mqtt in` w pakiecie?, test dwóch runtime'ów | etap-3 p.12–14 | D-14; jawnie; `mqtt in` osobno; jeden proces || **zgodnie z rekomendacją** – D-14 + status „standby”; wtyczka tylko jawnie (`coordination.plugin`); `mqtt in` w osobnym pakiecie; test dwóch instancji w jednym procesie, wieloprocesowy w osobnym podzbiorze (2026-10-03) |
| R-22 | Z-08: stan w treści 503, zamykanie serwera HTTP, domyślny `shutdownTimeout` | etap-3 p.4–6 | stała treść; zamykanie tylko przy `health.enabled`; drenaż wyłączony domyślnie || **zgodnie z rekomendacją** – stała treść 503 `{"status":"unavailable"}`; zamykanie serwera HTTP tylko przy `health.enabled`; drenaż domyślnie wyłączony (bez `shutdownTimeout` jak dotąd); drugi SIGTERM → natychmiast (2026-10-03) |
| R-23 | E-02: nazwy stanów i zdarzenia `instance:state` | etap-3 p.1 | jak w karcie || **zgodnie z rekomendacją** – stany `init, starting, ready, deploying, reloadPending, reloading, idle, loaded, failed, stopping, stopped`; zdarzenie `instance:state` `{state, previous, reason}`; `RED.stop(reason)` (powód do `preShutdown` i logu); `init` = stan początkowy, `idle` = flow zatrzymane (korekta ANALIZA §4.2); nazwy jako kontrakt w MIGRACJA.md (2026-10-03) |

## Edytor – Z-12 (załącznik B)

| ID | Temat | Źródło | Rekomendacja | Decyzja |
|---|---|---|---|---|
| R-24 | zakres spoza załącznika (`RED.deploy.addMenuItem`, `deployPre`), miejsce dokumentacji, okres deprecjacji, kolejność pakietów Z-12a…e | Z-12 P-1, P-2, P-11, P-12; etap-4 p.1–3 | || **zgodnie z rekomendacją** – `RED.deploy.addMenuItem`, `deployPre`, dokumentacja `RED.view.annotations` poza Z-12 (osobny pakiet później); dokumentacja: JSDoc + `design/editor-api/`; deprecjacja min. jedna wersja minor z ostrzeżeniem; kolejność Z-12c → Z-12a → Z-12b → Z-12d → Z-12e (Z-01 równolegle), 07 może zostać odłożone (2026-10-03) |
| R-25 | 12.01 logowanie: wariant dostarczania skryptów, dodatkowe pola | Z-12 P-3, P-4 | || **wariant A + `loginPost`** – skrypty logowania przez `editorTheme.page.scripts`/wtyczkę motywu (bez zmian serwera); dodatkowe pola przez krok `loginPost` z własną trasą pluginu (2026-10-03) |
| R-26 | 12.02 kod jednorazowy: źródło kodu, `sessionStorage` | Z-12 P-5, P-6 | || **własna strategia + opcja `sessionStorage`** – kod wydaje strategia `adminAuth`/plugin, rdzeń przyjmuje `#code=…&next=…`; `sessionStorage` jako opcja, domyślnie `localStorage` (2026-10-03) |
| R-27 | 12.08 uprawnienia: model „implikacja + `!`”, egzekucja serwerowa typów bloczków | Z-12 P-7, P-8 | || **implikacja + `!`; egzekucja serwerowa** – uprawnienia podrzędne (`flows.deploy`, `flows.import`, `flows.export`, `nodes.type.<typ>`) dziedziczone, wpisy `!` odbierają (pierwszeństwo); serwer odrzuca przy wdrożeniu dodane/zmienione węzły zabronionego typu (zmiana potoku E-01); `flows.export` – tylko utrudnienie (2026-10-03) |
| R-28 | 12.10 format linku z identyfikatorem flow | Z-12 P-9 | || **`#flow/<flowId>/node/<nodeId>` + `allowedOrigins` dla motywu** – nowy format linku, `hashchange`, `core:reveal-node`; kanał `set-theme` objęty `editorTheme.embedding.allowedOrigins` (2026-10-03) |

## Z-13 – język polski

| ID | Temat | Źródło | Rekomendacja | Decyzja |
|---|---|---|---|---|
| R-29 | zakres (`runtime.json`, pomoc HTML – D-16), wersja źródłowa tłumaczenia, rejestr i terminologia („węzeł” vs „bloczek”), automatyczny wybór języka, utrzymanie | etap-4 p.4–8; ZAŁ-A p.6 | || **zgodnie z rekomendacją** – JSON edytora, `messages.json` i `runtime.json` teraz, pomoc HTML (D-16) osobnym etapem; baza 5.0.7; forma bezosobowa; „węzeł”, „flow”/„subflow” bez tłumaczenia, „Wdróż”; słownik zatwierdza Zamawiający; automatyczny wybór `pl`; test zgodności kluczy, uzupełnia Wykonawca (2026-10-03) |

## Proces i dostarczenie

| ID | Temat | Źródło | Rekomendacja | Decyzja |
|---|---|---|---|---|
| R-30 | E-04: szablon nagłówków (JSON, pliki bez licencji), komentarze „upstream”, historia łatek, CHANGELOG, nazwy narzędzi | ZAŁ-A p.7–9; etap-4 p.16–17 | || **zgodnie z rekomendacją** – szablon nagłówka z łatek + `MODIFICATIONS.md` dla plików bez komentarzy/licencji, uzupełnienie nagłówków z 0004; komentarze „upstream” → „wersja bazowa 5.0.7”; łatki zastąpione commitami pakietów (odwołanie do zał. A); CHANGELOG „Unreleased” w gałęzi pakietu; nazwy narzędzi stron trzecich dozwolone (2026-10-03) |
| R-31 | E-05: miejsce CI, macierz wersji Node | etap-4 p.18 | || **zgodnie z rekomendacją** – CI (GitHub Actions) w forku `Actuna-Tech/node-red`, gałąź integracyjna (np. `actuna/integration`); gałęzie pakietów Node 22, integracja Node 22 i 24; E2E nieblokujące (ręcznie/nocnie, wynik w raporcie) (2026-10-03) |
| R-32 | Z-01: test klienta przez eksport CommonJS w `comms.js` (po D-03) | etap-1 p.10 | tak || **tak** – logika `comms.js` niezależna od DOM eksportowana wzorcem CommonJS, testy mocha z atrapą WebSocket w `npm test` (2026-10-03) |

## Doprecyzowania po naniesieniu decyzji (2026-10-03)

Szczegóły, których decyzje R-01…R-32 nie rozstrzygały. **T** = ustalenie techniczne Wykonawcy (bez wpływu biznesowego;
Zamawiający może je zmienić w dowolnej chwili), **Z** = decyzja Zamawiającego.

| ID | Temat | Rodzaj | Ustalenie |
|---|---|---|---|
| R-33 | Nazwy roboczych ustawień i kodów | T | `httpAdminCommsOrigins` (R-06); `editorTheme.embedding.allowedOrigins` (R-28; zamiast `…embedding.postMessage.allowedOrigins`); `NODE_RED_READ_ONLY_USER_DIR` (R-18); `editorTheme.auth.tokenStorage: "local" \| "session"`, domyślnie `"local"` (R-26); 403 `node_type_not_permitted` z `types[]` (R-27); `errors[].code: "safe_mode"` (R-10) |
| R-34 | Z-04: zakres statusu 201, `PUT` tworzący, `If-Match` | Z | **201 tylko dla v2**, v1 nadal 200; `PUT /flow/:id` tworzy tylko przy `deploy.putCreatesFlow: true` (201 w v2 / 200 w v1), bez ustawienia 404 jak dziś; w v2 `If-Match: <ETag>` równoważne `rev`, sprzeczne oba → 400 |
| R-35 | Domyślne listy źródeł (`/comms`, `set-theme`) | Z | **brak ustawienia = zachowanie 5.0.7** (bez kontroli, ostrzeżenie w logu przy starcie); ustawiona lista – tylko wymienione źródła, `/comms` przyjmuje też własne źródło edytora; w naszych instalacjach lista zawsze ustawiona |
| R-36 | Z-09: `attempts`, dodatkowy `preReload`, błąd `watchFlows` | Z | `retry.attempts` domyślnie 10 (~8 min), potem `failed`; dodatkowy `preReload` (D-17) poza blokadą, najwyżej jedna runda, potem przeładowanie z ostrzeżeniem; przy `watch: true` błąd rejestracji `watchFlows` → błąd startu |
| R-37 | Z-08: `preShutdown` bez `shutdownTimeout`, limit `RED.stop()` | T | bez `shutdownTimeout` hook `preShutdown` nie jest wywoływany (zachowanie 5.0.x); brak osobnego limitu `RED.stop()` – ostatecznym limitem jest `terminationGracePeriodSeconds` orkiestratora |
| R-38 | Z-08/P-01: limit czasu startu w trybie `deploy.response: "started"` | T | `deploy.startTimeout` (ms), domyślnie wyłączony; po przekroczeniu 500 `deploy_start_failed` z `errors[].code: "start_timeout"`, flow startują dalej w tle (wynik w logu) |
| R-39 | Z-15/P-01: odpowiedź na instancji `editorOnly`, „Restart flows” | T | `deploy.response: "started"` → `{rev, started: false}` (bez błędu); akcja „Restart flows” ukryta/nieaktywna jak przycisk `inject` |
| R-40 | Z-11: dokumentacja `readOnly`, bezwzględny `flowFile` | T | `readOnly` opisane w szablonie `settings.js`; `readOnlyUserDir` chroni także bezwzględny `flowFile` (zapis odrzucany niezależnie od ścieżki) |
| R-41 | Z-02: nieznana wartość `httpAdminNodeRoutes`; R-08: odświeżenie użytkownika po ponownym logowaniu | T | nieznana wartość → traktowana jak `"authenticated"` (bezpieczniej) + ostrzeżenie w logu; brak odświeżenia `RED.settings.user` po ponownym logowaniu (`comms.js:96-105`) – naprawiany razem z poprawką R-08 (test, który pada bez poprawki) |
| R-42 | Z-12.08/R-27: listy typów węzłów; kontrola przy przeładowaniu | Z (+T) | **obie listy**: wpisy odbierające `!nodes.type.<typ>` (zakazane) oraz lista dozwolonych (np. `["!nodes.type.*", "nodes.type.inject", …]` – odebranie wszystkich + jawne przyznanie wybranych; przyznanie konkretnego typu ma pierwszeństwo przed `!nodes.type.*`, odebranie konkretnego typu – przed wszystkim); **T:** przeładowanie z magazynu (`reload`, Z-09) nie jest kontrolowane per użytkownik – brak użytkownika; treść w magazynie pochodzi z kontrolowanych wdrożeń |
| R-43 | Szczegóły z naniesienia R-33…R-43 | T | sprzeczne `If-Match` i `rev` → 400 `invalid_revision`; `If-Match` w v1 ignorowany (v1 bez zmian); pusta lista `[]` = jawnie „żadne źródło zewnętrzne” (`/comms` tylko własne źródło edytora, `set-theme` i nowy kanał nieaktywne) – brak ustawienia = jak 5.0.7 (R-35); ostrzeżenie o braku list – serwer, log przy starcie; po przekroczeniu `deploy.startTimeout` odpowiedź wraca, a blokada wdrożeń trwa do końca startu w tle (spójność potoku E-01); nazwy `adminAuth.strategy.codeInFragment`, `RED.header`, `RED.dialog` przyjęte jak w kartach |
