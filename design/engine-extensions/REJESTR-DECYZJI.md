# Rejestr decyzji do ustalenia

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

Zebrane ze wszystkich dokumentów (ANALIZA §7.1, „Pytania” w kartach etapów 1–4, Z-12, ZALACZNIK-A-ANALIZA),
bez duplikatów, w kolejności priorytetów biznesowych ([../PRIORYTETY.md](../PRIORYTETY.md)). Przechodzimy punkt po
punkcie; wynik każdej decyzji trafia do kolumny „Decyzja” i do dokumentów, których dotyczy.

**Już rozstrzygnięte (nie wracamy):** D-01 baza 5.0.7 · D-02 nazwy (rewizja: utrzymane) · D-03 bez Playwright ·
D-04 podpisy, blokada upstream · D-10 przeładowanie różnicowe · D-11 drenaż SIGTERM · D-19 nagłówki · D-20
`version_required` · D-21 e-mail · B-01 utrwalanie wyglądu · N-01…N-04 · `allowDowngrade` domyślnie `true` ·
kod `invalid_node_type` w katalogu.

## Priorytet 1 – układ flow i przenoszalność

| ID | Temat | Źródło | Rekomendacja | Decyzja |
|---|---|---|---|---|
| R-01 | Z-14: zachowanie przy `editorTheme.flowLayout.enabled: false` | etap-4 p.9 | flow z zapisanym układem rysują się wg danych; ukryte tylko kontrolki | |
| R-02 | Z-14: części runtime (API flow, `diffNodes`) działają niezależnie od ustawienia | etap-4 p.10 | tak (brak skutku dla flow bez tych pól) | |
| R-03 | Z-14: zakres błędów FL-B-004…009 | etap-4 p.11 | 004, 005, 006, 009 wymagane (eksport/import); 007, 008 – jakość wyglądu | |

## Priorytet 2 – bezpieczeństwo

| ID | Temat | Źródło | Rekomendacja | Decyzja |
|---|---|---|---|---|
| R-04 | P-04: zgłoszenie luki zespołowi Node-RED (prywatnie, `SECURITY.md`) mimo blokady upstream (D-04) | etap-1 p.8 | do decyzji | |
| R-05 | P-04: odpowiedź `/comms` na pakiet `auth` przy wyłączonym `adminAuth` | ZAŁ-A p.5 | do decyzji | |
| R-06 | D-07: kontrola nagłówka `Origin` dla `/comms` | etap-1 p.9 | tak, ustawienie z bezpieczną listą domyślną | |
| R-07 | Z-02: użytkownik anonimowy (`adminAuth.default`) i wartość domyślna | etap-1 p.11–12 | anonimowy jak `needsPermission("")`; domyślnie `"open"` | |
| R-08 | XSS: nazwa użytkownika jako HTML w menu (`user.js:265`) | Z-12 P-10 | osobna poprawka bezpieczeństwa | |
| R-09 | P-03: `NODE_RED_DISABLE_TELEMETRY` ⇒ `locked`? `locked` + `enabled: true`? | etap-1 p.7 | bez implikacji; `locked` działa w obie strony | |

## Priorytet 2 – API

| ID | Temat | Źródło | Rekomendacja | Decyzja |
|---|---|---|---|---|
| R-10 | P-01: kod błędu startu (500 `deploy_start_failed`), zakres „błędu startu”, limit czasu, błędy zatrzymania (D-05), obsługa odrzucenia `start()` w trybie domyślnym | etap-1 p.2–5; ZAŁ-A p.3 | 500 + `rev`; typy/moduły + wyjątki flow; limit w Z-08; D-05 jak w ZASADY; log w trybie domyślnym | |
| R-11 | E-01: `POST /flows/state` i przełączenie projektu pod wspólną blokadą; odczyt przy jawnym `reload` przed `preDeploy` | etap-1 p.14–15; etap-3 p.2 | tak / tak | |
| R-12 | P-02: egzekwowanie po stronie serwera, „Overwrite” (D-12), etykieta, okno przy operacjach Projektów | etap-1 p.6; etap-2 p.10; ZAŁ-A p.4 | `reload-only` bez implikacji wymogu `rev`; D-12 | |
| R-13 | Z-04: `globalConfigs[]` (D-08), `rev` tylko w v2 (D-09) / `ETag`, 200 vs 201 i format id, `globalRev` | etap-2 p.5–8 | D-08, D-09; 201; `globalRev` tak | |
| R-14 | Z-05: v1 przy wymogu, `DELETE /flow/:id` z `?rev=`, `reload` zwolniony | etap-2 p.9 | 409 dla v1; DELETE z rev; reload zwolniony | |
| R-15 | Z-06: `preDeploy` tylko walidacja, limit 30 s, `postDeploy` asynchronicznie, brak hooków przy starcie/Projektach | etap-2 p.11–13 | tak | |
| R-16 | Z-07: przełącznik awaryjny `http in`, `rawBodyCapture` osobno | etap-2 p.14 | bez przełącznika; osobno | |
| R-17 | Z-03: zakres skorygowany, potwierdzenie przed instalacją (`dryRun`), aliasy ustawień uploadu | etap-2 p.1, 3, 4 | zakres skorygowany; bez `dryRun`; kanoniczne `allowUpload` + aliasy | |

## Priorytet 3 – baza danych, wiele instancji

| ID | Temat | Źródło | Rekomendacja | Decyzja |
|---|---|---|---|---|
| R-18 | Z-11: kontekst plikowy (D-15), wdrożenie przy magazynie plikowym, zmienna środowiskowa CLI | etap-3 p.15–17 | błąd startu; 400 `read_only_user_dir`; zmienna środowiskowa | |
| R-19 | Z-15: `editorOnly` vs `runtimeState.autoStart`, przycisk `inject`, `/ready` (D-13) | etap-4 p.12–13; etap-3 p.3 | `editorOnly`; przycisk nieaktywny; 200 w `loaded` | |
| R-20 | Z-09: `concurrency`, `preReload` bez weta, błąd odczytu magazynu (D-18), `retry`, D-17 | etap-3 p.7–11 | jak w kartach | |
| R-21 | Z-10: semantyka `inject` (D-14), jawny wybór wtyczki, `mqtt in` w pakiecie?, test dwóch runtime'ów | etap-3 p.12–14 | D-14; jawnie; `mqtt in` osobno; jeden proces | |
| R-22 | Z-08: stan w treści 503, zamykanie serwera HTTP, domyślny `shutdownTimeout` | etap-3 p.4–6 | stała treść; zamykanie tylko przy `health.enabled`; drenaż wyłączony domyślnie | |
| R-23 | E-02: nazwy stanów i zdarzenia `instance:state` | etap-3 p.1 | jak w karcie | |

## Edytor – Z-12 (załącznik B)

| ID | Temat | Źródło | Rekomendacja | Decyzja |
|---|---|---|---|---|
| R-24 | zakres spoza załącznika (`RED.deploy.addMenuItem`, `deployPre`), miejsce dokumentacji, okres deprecjacji, kolejność pakietów Z-12a…e | Z-12 P-1, P-2, P-11, P-12; etap-4 p.1–3 | | |
| R-25 | 12.01 logowanie: wariant dostarczania skryptów, dodatkowe pola | Z-12 P-3, P-4 | | |
| R-26 | 12.02 kod jednorazowy: źródło kodu, `sessionStorage` | Z-12 P-5, P-6 | | |
| R-27 | 12.08 uprawnienia: model „implikacja + `!`”, egzekucja serwerowa typów bloczków | Z-12 P-7, P-8 | | |
| R-28 | 12.10 format linku z identyfikatorem flow | Z-12 P-9 | | |

## Z-13 – język polski

| ID | Temat | Źródło | Rekomendacja | Decyzja |
|---|---|---|---|---|
| R-29 | zakres (`runtime.json`, pomoc HTML – D-16), wersja źródłowa tłumaczenia, rejestr i terminologia („węzeł” vs „bloczek”), automatyczny wybór języka, utrzymanie | etap-4 p.4–8; ZAŁ-A p.6 | | |

## Proces i dostarczenie

| ID | Temat | Źródło | Rekomendacja | Decyzja |
|---|---|---|---|---|
| R-30 | E-04: szablon nagłówków (JSON, pliki bez licencji), komentarze „upstream”, historia łatek, CHANGELOG, nazwy narzędzi | ZAŁ-A p.7–9; etap-4 p.16–17 | | |
| R-31 | E-05: miejsce CI, macierz wersji Node | etap-4 p.18 | | |
| R-32 | Z-01: test klienta przez eksport CommonJS w `comms.js` (po D-03) | etap-1 p.10 | tak | |
