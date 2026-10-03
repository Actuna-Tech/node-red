# Analiza załącznika A – łatki Zamawiającego względem kart backlogu

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.
> Dotyczy: `Zalacznik-A/0001…0006-*.patch` + `README.md`. Karty: [backlog/etap-1.md](backlog/etap-1.md) (P-01…P-04),
> [backlog/etap-2.md](backlog/etap-2.md) (Z-05), [backlog/etap-4.md](backlog/etap-4.md) (Z-13). Zasady: [ZASADY.md](ZASADY.md).
> Uwzględnia decyzje D-19 (nagłówki o modyfikacji), D-20 (`version_required`), D-21 (adres autora) z [ANALIZA.md](ANALIZA.md) §7.
> „Do potwierdzenia” = nie sprawdzono uruchomieniem albo wymaga decyzji Zamawiającego.

## Metoda

- Osobny worktree (usunięty po analizie) na commicie wydania **5.0.7** (`d9644c4`); łatki nałożone `git am` w kolejności 0001→0006 na lokalnej gałęzi (bez wypychania). Kontrolnie to samo na **5.0.6** (`2604028`).
- `node_modules` z gałęzi roboczej (symlink), `npm run build`, `npm run lint`, mocha: zestaw obszarów (`_spec.js`, telemetry, `runtime/lib/api/flows_spec`, `runtime/lib/flows/index_spec`, `editor-api/lib/admin/flows_spec`, `editor-api/lib/auth/*`) oraz cały `test/unit/**`.
- Dowód regresji: testy z łatek uruchomione na kodzie źródłowym 5.0.7 (pliki źródłowe cofnięte, testy z łatek pozostawione).
- P-04: skrypt odtwarzający (serwer `comms` bez `adminAuth`, klient websocket wysyła `{"auth":"x"}`) na 5.0.7 i po łatce.
- Z-13: skrypt porównujący drzewa kluczy `pl` ↔ `en-US` (liście JSON; tablica `inject.days` liczona osobno).

## Podsumowanie

| Łatka | Pakiet | Nakłada się na 5.0.7? | Wynik testów (po nałożeniu 0001–0006) | Ocena | Główne zmiany potrzebne |
|---|---|---|---|---|---|
| 0001 pl (częściowe) | Z-13 | tak, bez konfliktów | build OK (jsonlint 52 plików) | punkt wyjścia: editor 28,3%, nodes 11,2% pokrycia; 13 kluczy-sierot; liczba mnoga i 1 placeholder błędne; brak `languages.pl` | przemapować 13 kluczy, `_one/_few/_many/_other`, poprawić `actions.search-counter`, dodać `"pl": "Polski"`, słownik (węzeł vs bloczek) |
| 0002 `tokens.get()` | P-04 | tak | brak nowych testów; istniejące auth – zielone; awaria **potwierdzona i usunięta** skryptem | poprawna, ale niepełna (tylko `get()`) | testy regresji, `comms.js` (brak `adminAuth`, `.catch` w `handleAuthPacket`), strażniki pozostałych funkcji, zgłoszenie wg `SECURITY.md` |
| 0003 telemetria wyłączona | P-03 | tak | **4 czerwone** w `telemetry/index_spec.js` (jak w README) | do zastąpienia w całości | `telemetry.locked` wg karty; przywrócić 4 testy + testy blokady |
| 0004 odpowiedź po starcie | P-01 | tak | +6 testów, zielone; 5 z nich czerwonych bez poprawki | dobry rdzeń mechanizmu, ale „na sztywno” i bez błędów start/stop | ustawienie `deploy.response`, `deploy_start_failed`/`deploy_stop_failed` z `rev`, `rejectHandler`, edytor (`rev` po błędzie), test integracyjny http-in, oba stany |
| 0005 test v2 bez `rev` | P-02 / **Z-05** | tak | +4 testy, zielone; 2 czerwone bez poprawki | właściwe przypadki, zły pakiet i brak stanu „wyłączone” | przenieść do Z-05, sparametryzować `[false,true]`, przenieść na warstwę runtime |
| 0006 okno nieaktualnego edytora | P-02 (+Z-05) | tak (**wymaga 0001** – dopisuje klucze w `pl/editor.json`) | lint OK; brak testów edytora | dobra logika okna, **usuwa** zachowanie 5.0.6 (Scal/Nadpisz/Przejrzyj) | warunek `editorTheme.deploy.staleFlows`, przywrócić `resolveConflict` i powiadomienie dla `"prompt"`, wymóg `rev` po stronie serwera do Z-05 (za `deploy.requireRevision`) |

**Liczby testów (cały `test/unit/**`, środowisko bez `ssh-keygen`):**

| Stan | passing | pending | failing | Uwagi |
|---|---|---|---|---|
| 5.0.7 czyste | 1288 | 30 | 5 | 5 × `projects/ssh` – brak `ssh-keygen` (środowiskowe) |
| 5.0.7 + 0001–0006 | 1294 | 30 | 9 | 5 × `ssh` (środowiskowe) + 4 × `telemetry` (łatka 0003) |

- Zestaw obszarów: 5.0.7 – 125 passing / 4 pending / 0 failing; po łatkach – 131 / 4 / **4 failing** (telemetria). Łatki dodają 10 testów (5 + 1 w P-01, 4 w 0005).
- Zgodne z README Zamawiającego (1299 / 30 / 4): u nas 1294 + 5 testów `ssh` zależnych od środowiska = 1299.
- **Regresja:** na kodzie 5.0.7 z testami z łatek pada **7 z 10** nowych testów (`setFlows`, `addFlow`, `updateFlow`, `deleteFlow`, `waitForDeployStart resolves only after…`, `rejects v2 deploy without revision`, `rejects v2 deploy with an empty body`); 3 pozostałe to testy charakteryzujące (przechodzą przed i po).
- **5.0.6:** `git am` 0001–0006 bez konfliktów. Pliki zmieniane przez łatki są **identyczne** w 5.0.6 i 5.0.7 (`git diff 2604028 d9644c4` – zmiany tylko w `test/unit/@node-red/util/lib/{jsonata,util}_spec.js`), więc wyniki dla obszarów będą takie same – na 5.0.6 testów **nie uruchamiano**.
- `npm run lint` (eslint `editor-client/src/js`) – bez błędów; `npm run build` – OK.

## Szczegóły per łatka

### 0002 → P-04 (`tokens.get()` przed `init()`)

**Co robi:** `editor-api/lib/auth/tokens.js` – w `get()` dodano `if (!storage) return Promise.resolve(null);` (1 linia) + nagłówek o modyfikacji. Brak testów.

**Weryfikacja (uruchomione):**
- 5.0.7: serwer `comms` bez `adminAuth`, klient wysyła `{"auth":"x"}` → `uncaughtException: Cannot read properties of undefined (reading 'getSessions')` → w `node-red/red.js:525-540` byłoby `process.exit(1)`. **Wniosek WERYFIKACJA §P-04 potwierdzony uruchomieniem.**
- Po 0002: serwer odpowiada `{"auth":"fail"}` i zamyka połączenie; proces działa.

**Ocena względem karty:**
- Pokrywa: scenariusz `[odbiór]` „Wywołanie przed init() nie kończy się błędem” oraz brak awarii przy pakiecie `auth` bez `adminAuth` (pośrednio – `Tokens.get` → `null` → `Users.tokens` → `null` → `auth fail`).
- Nie pokrywa:
  - **odpowiedzi `{"auth":"ok"}` bez `adminAuth`** (karta, Specyfikacja) – klient z zapamiętanym `auth-tokens` dostaje `fail`, a `editor-client/src/js/comms.js:91-96` reaguje `RED.user.login(...)` i ponownym łączeniem; czy powstaje pętla przy wyłączonym `adminAuth` – **do potwierdzenia** (komentarz w commicie „the client retries after login” jest dla tego scenariusza nieścisły);
  - **`.catch` w `handleAuthPacket`** – odrzucenie `Users.get`/`Users.tokens` (np. własna funkcja `adminAuth.tokens`, która zgłasza błąd) nadal kończy się nieobsłużonym odrzuceniem; w Node ≥15 domyślnie → `uncaughtException` → `exit(1)` (wniosek z kodu, nie uruchamiano);
  - strażnika w `loadSessions()` i funkcjach zapisujących (`create`, `revoke`, `clear` – karta pkt 1);
  - **testów regresji** (DoD: „test pada bez poprawki”) – brak w łatce;
  - opisu do zgłoszenia prywatnego (`SECURITY.md`).
- Jakość: zmiana minimalna i bezpieczna; `apiAccessTokens` przed `init` nie jest używane – OK.

**Zachować:** linię strażnika (równoważna z kartą pkt 1). **Dodać:** testy `tokens_spec` (świeży moduł z `require.cache`) i `comms_spec` (bez `adminAuth`), zmiany `comms.js`, strażniki pozostałych funkcji. Mój skrypt odtwarzający może posłużyć jako wzór testu `comms_spec`.

### 0003 → P-03 (telemetria)

**Co robi:** `runtime/lib/telemetry/index.js` – `isTelemetryEnabled()` zaczyna się od `return false` (reszta kodu nieosiągalna, „dla łatwiejszych rebase’ów”) + nagłówek na początku pliku (plik w upstream **nie ma** nagłówka licencyjnego).

**Skutki (z kodu):**
- 4 testy telemetrii czerwone (README to przyznaje).
- `enable()` (z `POST /settings/user`) **nadal zapisuje** `telemetryEnabled=true` i uruchamia harmonogram (`startTelemetry`); `report()` kończy się na `isTelemetryEnabled()` → nic nie wysyła. Przełącznik w edytorze można włączyć, po przeładowaniu wraca do „wyłączony” (`GET /settings` → `telemetryEnabled:false`) – mylące dla użytkownika.
- Okno zgody przy pierwszym uruchomieniu nie pojawia się (`red.js:694` – `false` ≠ `undefined`); powiadomienia o nowej wersji (wynik raportu) wyłączone.

**Ocena:** do zastąpienia w całości projektem z karty (`telemetry.locked`). Z łatki zachować tylko uzasadnienie z opisu commita (pierwszeństwo `telemetryEnabled` nad `settings.telemetry.enabled` i `NODE_RED_DISABLE_TELEMETRY`) – zgodne z WERYFIKACJA §P-03. Docelowa konfiguracja Zamawiającego: `telemetry: { enabled: false, locked: true }` (notatka migracyjna).

### 0004 → P-01 (odpowiedź po starcie)

**Co robi:**
- `runtime/lib/flows/index.js` `setFlows`: wynik `start(...)` zapamiętany w zmiennej modułu `deployStartPromise`; dodana obsługa odrzucenia `start` (`log.warn(err.stack)`); nowa eksportowana funkcja `waitForDeployStart()` zwraca ostatnią obietnicę startu. Kolejność dla wywołań wewnętrznych bez zmian (rewizja zwracana przed startem – zgodnie z kartą, „Niezmienniki”).
- `runtime/lib/api/flows.js`: `afterStart()` (= `runtime.flows.waitForDeployStart()` lub natychmiast) przed zwróceniem wyniku w `setFlows` (także `reload` – przez `load(true)` → `setFlows("load")`), `addFlow`, `updateFlow`, `deleteFlow`.
- Testy: 5 w `api/flows_spec.js` (atrapa `waitForDeployStart` z opóźnieniem), 1 w `flows/index_spec.js` (start flow `t2` z opóźnieniem 50 ms).

**Pokrycie ustaleń WERYFIKACJA / karty:**

| Wymaganie | 0004 |
|---|---|
| Ustawienie, domyślnie `"stopped"` (5.0.6) | **brak** – zawsze czeka |
| Ścieżki `POST /flows` (full/nodes/flows), `reload`, `POST/PUT/DELETE /flow` | tak |
| Odpowiedź po `runtime-deploy` (krok 9 ZASADY §2.3 A) | tak – emisja w `then` przed rozwiązaniem obietnicy |
| Mutex obejmuje oczekiwanie (`setFlows`) | tak (`afterStart` w `runExclusive`); `/flow` – poza mutexem jak w 5.0.7 |
| Błąd startu w odpowiedzi (`deploy_start_failed`, `rev`, `errors`) | **nie** – błąd tylko w logu, odpowiedź sukcesu |
| Błąd zatrzymania (`deploy_stop_failed`, `rev`) | **nie** – pusty `.catch` (`:233`) nadal połyka; `deployStartPromise` nie jest wtedy aktualizowane, więc `afterStart` zwraca obietnicę **poprzedniego** wdrożenia, a klient dostaje `{rev: undefined}` jak w 5.0.7 |
| Brakujące typy/moduły | `start()` je zgłasza zdarzeniami, nie odrzuceniem – odpowiedź sukcesu (do potwierdzenia testem) |
| `rejectHandler` przepuszcza `rev`/`errors`; edytor aktualizuje `rev` po błędzie | brak |
| Test integracyjny http-in (kryterium odbioru) | brak (tylko testy jednostkowe z atrapami) |
| `settings.js`, CHANGELOG, JSDoc | brak |

**Ryzyka / uwagi:**
- Zmienna globalna „ostatni start” zamiast wyniku konkretnego wdrożenia: `addFlow/updateFlow/deleteFlow` działają poza mutexem, więc przy równoległych operacjach odpowiedź może czekać na start innego wdrożenia (zwykle późniejszego – skutek: dłuższe oczekiwanie, nie błąd). Nie da się przez nią przekazać `errors[]` konkretnego wdrożenia.
- Dodany handler odrzucenia `start` zmienia zachowanie także w trybie domyślnym: w 5.0.7 odrzucenie `start` w tym miejscu jest nieobsłużone (w Node ≥15 – zakończenie procesu), po łatce – wpis `warn`. To w praktyce poprawka błędu; czy odrzucenie jest osiągalne – **do potwierdzenia**. Wymaga decyzji (Pytanie 3) i własnego testu.
- `log.warn(err.stack)` bez komunikatu i18n.
- Nazwa `waitForDeployStart()`: czytelna, ale opisuje mechanizm globalny. Karta przewiduje opcję na wywołanie (`deployOpts.waitForStart`), która niesie wynik i błędy konkretnego wdrożenia. `runtime.flows` to moduł wewnętrzny (nie publiczne API), więc nazwa nie jest kontraktem – chyba że korzystają z niej narzędzia Zamawiającego (Pytanie 2).

**Zachować:** testy (po sparametryzowaniu na oba stany: `"stopped"` – odpowiedź **przed** startem, `"started"` – po), wzorzec testu `index_spec` (opóźniony `start` flow), test „does not wait when the deploy is rejected”, obsługę odrzucenia `start` (po decyzji). **Zmienić:** mechanizm na opcję na wywołanie (karta pkt 2) albo – jeśli Zamawiający chce zachować `waitForDeployStart()` – niech zwraca wynik konkretnego wdrożenia (`{rev, errors}`), a API czeka tylko przy `deploy.response === "started"`.

### 0005 + 0006 → P-02 (nieaktualny edytor) i Z-05 (wymóg rewizji)

**0005 (tylko testy, `editor-api/lib/admin/flows_spec.js`):** v2 bez `rev` → 409 `version_required`; v2 z pustą treścią → 409; v2 z `rev` → 200; `reload` v2 bez `rev` → 200. Commit testowy poprzedza implementację (0006) – sam w sobie czerwony (problem dla `git bisect`).

**0006 – zakres:**

| Plik | Zmiana |
|---|---|
| `editor-api/lib/admin/flows.js` | `post()`: v2 (nie `reload`) bez `rev` / `rev` `null` / `""` → `res.status(409).json({code:"version_required", message:"Deploy rejected: …"})` – **zawsze**, bez ustawienia; poza `rejectHandler` i bez wpisu audytu |
| `editor-client/src/js/ui/deploy.js` (204 linie w diffie: +88/−116) | usunięte `resolveConflict` (Cancel/Review/Merge/Overwrite, ~90 linii), `currentDiff`, powiadomienie w tle z „Review changes”; nowe: `showStaleFlows()` (modal bez zamykania, jedna akcja „reload” → `window.location.reload()`), `staleFlowsReloading` (pomija ostrzeżenie `beforeunload`), `revisionSeenDuringDeploy` + `settleDeployInflight()` (wykrycie cudzego wdrożenia **w trakcie** własnego), `save(skipValidation)` bez `force` i z blokadą, gdy okno jest pokazane, `rev` wysyłane zawsze |
| `locales/en-US/editor.json` | `deploy.confirm.button.reload` „Reload”, `deploy.confirm.staleFlows`, `deploy.confirm.staleFlowsLost` (stare `merge`/`overwrite`/`conflict*` zostają, nieużywane) |
| `locales/pl/editor.json` | te same 3 klucze („Wczytaj ponownie”, …) – stąd zależność od 0001 |

**Pokrycie ustaleń:**
- **Oba wejścia do okna:** tak – 409 z `save()` i z `restart()` oraz powiadomienie `notification/runtime-deploy`; dodatkowo okno w trakcie własnego wdrożenia (nowe ustalenie – karta go nie ma).
- **`deploy.js:390` (`nns`):** usunięte przez zmianę sygnatury `resolveConflict()` (bez argumentów). W trybie `"prompt"` (przywrócone okno 5.0.6) poprawka musi wyznaczać `nns` (np. `RED.nodes.createCompleteNodeSet()`) albo pokazywać komunikat – łatka tego nie rozwiązuje, bo usuwa tryb.
- **Ustawienie `editorTheme.deploy.staleFlows`:** brak; brak przekazania w `editor-api/lib/editor/theme.js`. Zachowanie 5.0.6 (Scal/Nadpisz/Przejrzyj, nieblokujące powiadomienie) **usunięte** – sprzeczne z DoD „domyślnie = 5.0.6”.
- **Wymóg `rev` po stronie serwera:** w zleceniu i kartach to Z-05 (`deploy.requireRevision`, domyślnie `false`) w warstwie `runtime/lib/api/flows.js` (krok 2 E-01, pod mutexem, przed `preDeploy`). Łatka robi to w `editor-api` „na sztywno” – łamie każdego klienta v2 bez `rev` przy domyślnych ustawieniach.
- **Pusty string `rev`:** łatka → 409 `version_required`; karta Z-05 → 400 `invalid_revision`. Do rozstrzygnięcia (Pytanie 1).
- Testy edytora: brak (zgodnie z ryzykiem karty; po D-03 – testy logiki wydzielonej z DOM, E-03).

**Ryzyka znalezione w 0006:**
- Operacje Projektów wołają `RED.deploy.setDeployInflight(true/false)` (`projectSettings.js:1141,1177,1537`, `tab-versionControl.js:192-195,388-408,533-556,703`) – nie przechodzą przez `settleDeployInflight()`. Jeśli `runtime-deploy` z nową rewizją dotrze po `setDeployInflight(false)`, a przed odświeżeniem `RED.nodes.version()`, pojawi się **blokujące** okno (w 5.0.7 – znikające powiadomienie). Możliwy fałszywy alarm – **do potwierdzenia** testem ręcznym.
- `runtime-deploy` jest zdarzeniem `retain` – po ponownym połączeniu websocketu edytor dostaje ostatnią rewizję; przy różnicy – modal (w 5.0.7 – powiadomienie). Zamierzone, ale ostrzejsze.
- Interakcja z P-01 `"started"`: `runtime-deploy` własnego wdrożenia przychodzi w trakcie `deployInflight`; `settleDeployInflight()` porównuje z `RED.nodes.version()` ustawionym w `.done` (przed `.always`) – brak fałszywego okna (wniosek z kodu; test wskazany).
- Komentarze-narracje diffu w kodzie (`// was \`deployInflight = false\``, `// upstream passed an undefined \`nns\` here`) – do usunięcia.

**Kod błędu `version_required` vs `revision_required` (ZASADY §2.4):**
- Za `version_required`: (1) spójność z istniejącym kodem dla tego samego pojęcia `version_mismatch` (`runtime/lib/api/flows.js:91`) i z API edytora `RED.nodes.version()`; para `version_required`/`version_mismatch` czyta się jako jedna rodzina; (2) zgodność z łatką Zamawiającego (i ewentualnymi jego narzędziami/testami – zakres do potwierdzenia); (3) koszt zmiany zerowy (kod jeszcze nie jest w kontrakcie upstream).
- Przeciw: pole w treści nazywa się `rev`, a Z-04 wprowadza `invalid_revision` i `globalRev`; „version” myli się z wersją API (`invalid_api_version`, nagłówek `Node-RED-API-Version`).
- **Rekomendacja:** `version_required` – **zgodne z decyzją D-20** (już naniesioną w ZASADY §2.4 i kartach). Dla spójności rodziny rozważyć zmianę Z-04 `invalid_revision` → `invalid_version` albo jawnie udokumentować w §2.4, że „version” w kodach błędów = rewizja flow (`rev`), a nie wersja API (Pytanie 1).

**Zachować z 0006:** `showStaleFlows()` (treść, modal bez zamykania, jedna akcja), `staleFlowsReloading` + `beforeunload`, blokada `save()`, `revisionSeenDuringDeploy`/`settleDeployInflight()`, zawsze wysyłany `rev` w `reload-only`, klucze en-US (`staleFlows`, `staleFlowsLost`, `button.reload`), komunikat serwera (po przeniesieniu do Z-05 i i18n/`rejectHandler`). **Zmienić:** wszystko za `isReloadOnly()`; w `"prompt"` – kod 5.0.7 bez zmian (+ poprawka `nns`); część serwerowa → Z-05 w runtime API za `deploy.requireRevision`; testy 0005 → Z-05 z `[false, true]`.

## Nagłówki i komentarze

### Inwentaryzacja nagłówków „Modified by Actuna Sp. z o.o.”

Format we wszystkich przypadkach (komentarz blokowy po nagłówku licencji projektu):
```
/*
 * Modified by Actuna Sp. z o.o.:
 *   <funkcja>: <opis zmiany i powód>
 * This notice is required by section 4(b) of the Apache License 2.0.
 */
```

| Plik | Łatka | Opis w nagłówku | Uwagi |
|---|---|---|---|
| `editor-api/lib/auth/tokens.js` | 0002 | `get()`: zwraca `null` przed `init()` | po nagłówku licencji |
| `runtime/lib/telemetry/index.js` | 0003 | `isTelemetryEnabled()`: zawsze `false` | **linia 1** – plik nie ma nagłówka licencji projektu |
| `editor-api/lib/admin/flows.js` | 0006 | `post()`: v2 bez rewizji → 409 `version_required` | |
| `editor-client/src/js/ui/deploy.js` | 0006 | modal „flows changed elsewhere”, bez Merge/Overwrite, zawsze `rev` | trafia też do `public/red/red.js` po buildzie (komentarze blokowe – do potwierdzenia, czy minifikator je zostawia w `red.min.js`) |
| `runtime/lib/api/flows.js` | 0004 | **brak nagłówka** | niespójne z README i D-19 |
| `runtime/lib/flows/index.js` | 0004 | **brak nagłówka** | jw. |
| `locales/en-US/editor.json`, `locales/pl/*.json` | 0001, 0006 | brak (JSON nie ma komentarzy) | ewentualnie wpis w pliku zbiorczym (opcja C niżej) |
| pliki testów (0004, 0005) | – | brak | |

Komentarze w kodzie ze słowem „upstream” (= oficjalne 5.0.6 wg README): 8 wystąpień w liniach dodanych (0003: 1, 0004: 4 – w tym testy, 0006: 3). Po D-01 (baza 5.0.7) „upstream” jest nieprecyzyjne; w gałęzi do zgłoszenia upstream – nie na miejscu.

### Fakty i opcje (bez porady prawnej)

- Apache 2.0 §4(b): przy **redystrybucji** utworu zależnego zmienione pliki mają nosić wyraźną informację, że zostały zmienione. Tekst licencji nie określa formy ani nie wymaga wprost nazwy podmiotu; nazwa firmy to praktyka (tak robią łatki).
- **Dystrybucja forka** (`Actuna-Tech/node-red`, paczki dla klientów): obowiązek z §4(b) dotyczy tej sytuacji. **D-19:** nagłówki zostają i są dopisywane do każdego pliku zmienionego przez nas. Konsekwencja: punkt DoD ZASADY §3 „Brak nazw produktów … i nagłówkach plików” (linia 148) jest dziś **sprzeczny z D-19** – wymaga przeredagowania (nazwa firmy to nie nazwa produktu, ale zapis „nagłówkach plików” obejmuje te nagłówki).
- **Zgłoszenie do upstream** (dziś zablokowane – D-04): kontrybucja do projektu, nie redystrybucja forka; projekt używa nagłówka „Copyright JS Foundation and other contributors” i DCO/CLA. D-19: gałęzie upstream **bez** nagłówków o modyfikacji i bez narracji „upstream did X”.
- Opcje dla forka:
  - **A (D-19, obecna):** nagłówek z nazwą firmy w każdym zmienionym pliku; szablon jak wyżej, opis aktualizowany przy przeróbce (np. „`isTelemetryEnabled()`: honours `telemetry.locked`”).
  - **B:** nagłówek ogólny („This file has been modified from the original Node-RED source; see CHANGES-FORK.md”) + plik zbiorczy z nazwą firmy i listą zmian – mniej szumu w plikach, mniej konfliktów przy rebase.
  - **C (uzupełnienie A lub B):** plik zbiorczy obejmujący pliki bez komentarzy (JSON locale, pliki binarne/zbudowane).
- Utrzymanie dwóch wariantów (fork z nagłówkami, upstream bez) najprościej zrobić jako osobny commit „notices” na szczycie gałęzi forka – do potwierdzenia w E-04.

## Z-13 – statystyki tłumaczenia (0001, na 5.0.7)

| Plik | en-US (5.0.7) | pl (0001) | Klucze pl obecne w en-US | Pokrycie | Klucze pl spoza en-US |
|---|---|---|---|---|---|
| `editor-client/locales/*/editor.json` | 1126 | 332 | 319 | **28,3%** | **13** |
| `nodes/locales/*/messages.json` | 872 (866 liści + `inject.days` = 7 el.) | 98 | 98 | **11,2%** | 0 |

Po 0006: en-US 1129, pl 335, wspólne 322 (28,5%). Opis commita 0001 podaje „332 of 1089 editor keys” – 1089 to liczba ze zlecenia, nie z 5.0.7 (prawdopodobnie inna wersja bazowa; do potwierdzenia).

- **13 kluczy-sierot** (tłumaczenia ignorowane przez edytor): `common.label.{enabled,disabled,show,hide,none,true,false,or,and}`, `event-log.{title,view}`, `keyboard-shortcuts.{title,filter}`. W 5.0.7 odpowiedniki to m.in. `eventLog.{title,view}`, `keyboard.title`, `common.label.{enable,disable}`; pozostałych `common.label.*` w en-US brak. Sugeruje to tłumaczenie z innej wersji lub ręcznie zbudowaną strukturę.
- **Placeholdery `__x__`:** 1 niezgodność – `actions.search-counter`: en `__result__ of __count__`, pl `"__term__" __result__ z __count__`; kod (`ui/search.js:590-593`) nie przekazuje `term` → w UI pusty cudzysłów (dokładny wynik i18next – do potwierdzenia).
- **Znaczniki HTML:** 0 niezgodności.
- **Identyczne z en-US:** 12 w editor (np. `Ok`, `Flow __number__`, `Start`, `Stop`, `sidebar.info.id`) i 5 w messages – w większości zasadne.
- **Liczba mnoga:** en-US 39 par `_plural` (editor) i 5 (messages). pl ma 2 klucze w formacie v3: `clipboard.nodeCopied(_plural)`, `editor.nodesUse(_plural)`; 0 kluczy `_one/_few/_many/_other`. W i18next 25 `_plural` dla `pl` nie działa (Z-13, WERYFIKACJA) → zawsze forma bazowa („Skopiowano 5 węzeł”); dodatkowo dwie formy nie wyrażają trzech polskich („2 węzłów” jest błędne).
- **`languages.pl`:** brak w `languages` wszystkich `editor.json` (także w samym `pl/editor.json` – przestrzeń `languages` 0/10).
- **Pokrycie przestrzeni editor (pl/en):** `deploy` 37/42, `menu` 66/78, `workspace` 25/28, `editor` 46/56, `contextMenu` 5/5, `actions` 9/10, `sidebar` 67/229, `clipboard` 28/62, `common` 14/42, `notification` 13/46, `palette` 12/120; **0** m.in. `projects` (134), `diff` (34), `keyboard` (35), `subflow` (32), `library`, `search`, `typedInput`, `telemetry`, `languages`. Nodes: `debug` 39/45, `function` 24/27, `change` 23/23, `json` 12/12; reszta 0.
- **Terminologia (wstępnie, 8 przykładów):**
  1. „node” → **„węzeł”** (51 wartości), „bloczek” – 0; tymczasem README i zlecenie mówią „bloczki” – decyzja do słownika.
  2. „flow” nietłumaczone i nieodmieniane (59 wartości): „Zmienione flow”, „Flow na serwerze zostały zaktualizowane”, `menu.label.flows` „Flow” = `sidebar.info.flow` „Flow” (l.poj. = l.mn.).
  3. Rejestr opisów niespójny: `fullDesc` „Wdraża wszystko…” (3. os.) vs `startFlowsDesc` „Uruchom flow” (tryb rozkazujący).
  4. „Restart flow”, „Restartuje…” – anglicyzm (alternatywa: „Uruchom ponownie”).
  5. `deploy.full` „Wszystko” (dla „Full”) – opisowe, do słownika (przycisk ma typy: pełne/zmienione flow/zmienione węzły).
  6. `common.label.ok` „Ok” (zwyczajowo „OK”).
  7. `deploy.confirm.button.reload` „Wczytaj ponownie” (0006) vs „Przeładuj” w karcie P-02 (BDD) – ujednolicić.
  8. Poprawne i spójne: „Wdróż”, „Scal”, „Ignoruj i wdróż”, „węzeł konfiguracyjny”, „<strong>Ostrzeżenie</strong>: __message__”.

## Rekomendowane zmiany w kartach i ZASADY

### P-01 (`etap-1.md`)
1. Weryfikacja stanu: „Modyfikacja Zamawiającego – diff nie był dostępny” → odwołanie do tej analizy (łatka 0004) i lista luk: brak ustawienia, brak błędów start/stop, `{rev: undefined}` przy błędzie zatrzymania, brak `rejectHandler`/edytora/testu integracyjnego.
2. Projekt pkt 2: dopisać wybór mechanizmu – opcja na wywołanie `waitForStart` (rekomendacja) zamiast globalnego `waitForDeployStart()`; jeśli Zamawiający potrzebuje nazwy `waitForDeployStart()`, zwraca ona wynik konkretnego wdrożenia (`{rev, errors}`).
3. Nowy punkt: obsługa odrzucenia `start()` w trybie domyślnym (log zamiast nieobsłużonego odrzucenia) jako poprawka błędu – po decyzji Zamawiającego, z osobnym testem.
4. Testy: przejąć 6 testów z 0004 i sparametryzować `["stopped","started"]` (w `"stopped"` asercja odwrotna – odpowiedź przed startem); dodać przypadek błędu zatrzymania (dziś `afterStart` czeka na start poprzedniego wdrożenia).
5. Ryzyka: `/flow` poza mutexem → oczekiwanie na start innego wdrożenia; wskazać, czy objąć `/flow` blokadą (E-01).
6. DoD: notatka migracyjna – „0004 → `deploy.response: "started"`”.

### P-02 (`etap-1.md`)
1. Weryfikacja: dopisać przegląd 0006 (zakres `deploy.js` +88/−116, usunięcie `resolveConflict` i powiadomienia w tle).
2. Projekt: przejąć z 0006 `showStaleFlows()`, `staleFlowsReloading`/`beforeunload`, blokadę `save()`, **`revisionSeenDuringDeploy`/`settleDeployInflight()`** (nowy przypadek); całość za `isReloadOnly()`; w `"prompt"` kod 5.0.7 bez zmian.
3. Poprawka `:390` (`nns`) – doprecyzować, że w trybie `"prompt"` musi wyznaczać zbiór węzłów (łatka usuwa argument tylko dlatego, że usuwa tryb).
4. Teksty: dodać klucz `deploy.confirm.staleFlowsLost`; etykieta akcji – ujednolicić „Przeładuj” / „Wczytaj ponownie”.
5. BDD: nowy scenariusz „Zmiana flow w innym miejscu w trakcie własnego wdrożenia → okno po zakończeniu wdrożenia”; scenariusz „Operacja Projektów nie wywołuje okna” (ryzyko `setDeployInflight`).
6. Zakres: część serwerowa 0006 (`admin/flows.js`) i testy 0005 – jawnie przeniesione do Z-05.

### P-03 (`etap-1.md`)
1. Ryzyka: „Modyfikacja Zamawiającego … zastąpiona” → doprecyzować, że 0003 jest odrzucana w całości; dopisać skutki 0003 (harmonogram uruchamiany i `telemetryEnabled` zapisywane mimo wyłączenia; przełącznik „wraca”).
2. DoD: „4 testy z `telemetry/index_spec.js` czerwone po 0003 – zielone po P-03” jako dowód.

### P-04 (`etap-1.md`)
1. Weryfikacja: awaria **potwierdzona uruchomieniem** (5.0.7) i usunięta przez 0002; zmienić „wniosek z kodu, nie uruchamiano”.
2. Przegląd modyfikacji (podzadanie): wykonany – 0002 = pkt 1 karty w części `get()`; brak `comms.js`, `.catch`, testów.
3. Dopisać ryzyko: odrzucenie `Users.get/tokens` w `handleAuthPacket` (własna funkcja `adminAuth.tokens`) → nieobsłużone odrzucenie → `exit(1)` w Node ≥15 (wniosek z kodu).
4. Pytanie 8: usunąć prośbę o diff (dostarczony).

### Z-05 (`etap-2.md`)
1. Kod `version_required` – już naniesiony (D-20); dopisać źródło: łatka 0006.
2. Projekt: przejąć warunek z 0006 (`rev` `undefined`/`null`) do `checkRevision` w `runtime/lib/api/flows.js`, za `deploy.requireRevision`; odpowiedź przez `rejectHandler` z audytem (`flows.set`, `error:"version_required"`); komunikat bez nazw produktów.
3. Rozstrzygnąć `rev: ""`: 409 `version_required` (jak 0006) vs 400 `invalid_revision` (karta) – Pytanie 1.
4. Testy: przejąć 4 testy 0005 i sparametryzować `[false, true]` (przy `false` v2 bez `rev` → 200 jak 5.0.7).

### Z-13 (`etap-4.md`)
1. Wejścia: zamiast „332 klucze edytora wg zlecenia” – 332 klucze, z czego **319** zgodnych z 5.0.7 (28,3%), **13 do przemapowania**; nodes 98/872 (11,2%).
2. Podzadanie „Scalenie tłumaczenia Zamawiającego”: przemapowanie 13 kluczy, poprawka `actions.search-counter`, zamiana 2 par `_plural` na `_one/_few/_many/_other`, dodanie `languages.pl`.
3. Słownik: rozstrzygnąć „węzeł” (użyte w 0001) vs „bloczek” (zlecenie/README); odmiana „flow”; rejestr opisów `*Desc`.

### ZASADY
1. §2.4: przy `version_required` dopisać zdanie „`version` w kodach błędów = rewizja flow (`rev`), nie wersja API (`invalid_api_version`)”; rozważyć `invalid_revision` → `invalid_version` (spójność rodziny) albo uzasadnić wyjątek.
2. §2.4: doprecyzować `rev: ""` / nie-string (jeden kod).
3. §2.1: bez zmian nazw z powodu załącznika (README powtarza propozycje zlecenia; rewizja nazw w toku – NAZWY-ANALIZA.md). Odnotować, że domyślne wartości z README (`"stopped"`, `"prompt"`/`false`, brak blokady) są zgodne z kartami.
4. §3 DoD: „Brak nazw produktów w … nagłówkach plików” → „… w kodzie, komunikatach, ustawieniach i testach; wyjątek: nagłówki o modyfikacji wg pkt 4(b) w gałęziach forka (D-19); w gałęziach do zgłoszenia upstream – bez nich”.
5. §3 DoD: „każdy plik zmieniony w forku ma nagłówek o modyfikacji” (0004 tego nie spełnia) oraz „bez komentarzy-narracji diffu i słowa »upstream« w znaczeniu »wersja bazowa«”.

## Autorstwo łatek

- Wszystkie 6 łatek: autor `Wojciech Repiński <wrepinski@gmail.com>`, daty 2026-09-03…2026-09-30, nagłówek `From 0000000…` (eksport bez oryginalnych identyfikatorów commitów), **brak `Signed-off-by`** (`git log` po `am`: 0 wystąpień). README: podpis DCO składany przy zgłoszeniu.
- Autor i adres są tożsame z autorem prac (linia autorstwa dokumentów, D-21).
- Styl tematów niejednolity: „Add partial Polish…”, „runtime: …”, „editor-api: …”, „test(editor-api): …” (konwencja *conventional commits*); przy przeróbce – jeden styl projektu.
- Przeróbka powstanie jako nowe commity na gałęziach pakietów (DoD §3) z `Signed-off-by`; czy zachować łatki jako osobne commity historyczne – Pytanie 9.

## Pytania do Zamawiającego

1. **Kod i warunki 409 (D-20):** czy Państwa narzędzia opierają się tylko na `code:"version_required"`, czy także na statusie 409 dla pustego `rev: ""` i na treści komunikatu? Czy możemy dla `""`/nie-stringa zwracać 400 `invalid_revision` (lub `invalid_version`)?
2. **P-01:** czy jakikolwiek Państwa kod lub test (poza łatkami) wywołuje `runtime.flows.waitForDeployStart()`? Jeśli nie – zastępujemy ją opcją na wywołanie.
3. **P-01:** czy akceptują Państwo obsługę odrzucenia `start()` także w trybie domyślnym (log zamiast nieobsłużonego odrzucenia – poprawka błędu, drobna zmiana względem 5.0.6)?
4. **P-02:** etykieta akcji – „Przeładuj” czy „Wczytaj ponownie”? Czy blokujące okno po operacjach Projektów (ryzyko fałszywego alarmu) jest akceptowalne do czasu testu, czy wyłączamy wykrywanie w trakcie operacji Projektów?
5. **P-04:** łatka przy wyłączonym `adminAuth` odpowiada `{"auth":"fail"}` i zamyka połączenie; karta proponuje `{"auth":"ok"}`. Który wariant?
6. **Z-13:** z jakiej wersji Node-RED pochodzi tłumaczenie (1089 kluczy, 13 kluczy nieistniejących w 5.0.7)? „węzeł” czy „bloczek”? Czy `jsonata.json`, `infotips.json`, `runtime.json` są w zakresie (README wymienia tylko editor/nodes i pomoc HTML)?
7. **Nagłówki (D-19):** czy szablon z łatek (`Modified by Actuna Sp. z o.o.: <funkcja>: <opis>` + zdanie o 4(b)) jest obowiązujący? Jak oznaczać pliki bez komentarzy (JSON) i bez nagłówka licencji (`telemetry/index.js`) – plik zbiorczy? Czy uzupełniamy brakujące nagłówki w plikach z 0004?
8. **Komentarze „upstream”:** czy po D-01 zastępujemy je neutralnym opisem („5.0.7”/„wersja bazowa”) – w forku i w gałęziach upstream?
9. **Historia:** czy łatki 0001–0006 mają zostać w historii forka jako osobne commity (z dopisanym `Signed-off-by`), czy wystarczą nowe commity pakietów zastępujące je (z odwołaniem do załącznika A w opisie)?
