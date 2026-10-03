# Backlog – Z-12: punkty rozszerzeń edytora (załącznik B)

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.
> Dokument uzupełnia kartę [Z-12 w etap-4.md](etap-4.md#z-12--punkty-rozszerzeń-edytora-dla-pluginów) (spike + szkielet)
> o rozpisanie 14 punktów z załącznika B. Zasady wspólne, DoD i szablon karty: [../ZASADY.md](../ZASADY.md) §3–§4.
> Harness testów: [E-03](etap-4.md#e-03--harness-testów-edytora); decyzja D-03 ([../ANALIZA.md](../ANALIZA.md) §7.0):
> **bez Playwright w repozytorium** – „test edytora” = test jednostkowy logiki wydzielonej z DOM w `npm test`;
> E2E = osobny podzbiór poza `npm test`, nie wchodzi do gałęzi pakietów.

Ścieżki skrócone: `ec/` = `packages/node_modules/@node-red/editor-client/src/js/`,
`ea/` = `packages/node_modules/@node-red/editor-api/lib/`, `rt/` = `packages/node_modules/@node-red/runtime/lib/`.
Numery linii – kod 5.0.7 na gałęzi roboczej (commit `18f3127`). Testy: `test/unit/@node-red/...` (mocha/should/sinon).

## Spis treści

- [Podsumowanie](#podsumowanie)
- [Ustalenia przekrojowe](#ustalenia-przekrojowe)
- Karty: [01](#z-1201--ekran-logowania-rozszerzenie-przed-i-po-uwierzytelnieniu) ·
  [02](#z-1202--wejście-z-jednorazowym-kodem-i-zapis-tokena) · [03](#z-1203--zdarzenie-edytor-gotowy) ·
  [04](#z-1204--cykl-życia-zakładki-paska-bocznego) · [05](#z-1205--menu-główne-dodanie-pozycji) ·
  [06](#z-1206--menu-użytkownika-trwałe-pozycje) · [07](#z-1207--nagłówek-przycisk-lub-plakietka) ·
  [08](#z-1208--uprawnienia-użytkownika-w-edytorze-i-serwerze) · [09](#z-1209--paleta-kolejność-etykiety-ukrywanie) ·
  [10](#z-1210--głęboki-link-akcja-reveal-node-i-postmessage) · [11](#z-1211--subskrypcja-kanału-komunikacji-z-01) ·
  [12](#z-1212--wywołania-api-serwera-z-pluginu) · [13](#z-1213--okna-modalne-i-panel-pełnoekranowy) ·
  [14](#z-1214--api-między-pluginami-oraz-pluginem-a-bloczkiem)
- [Grupowanie w pakiety dostarczeniowe](#grupowanie-w-pakiety-dostarczeniowe)
- [Ocena pod kątem upstream](#ocena-pod-kątem-upstream)
- [Pytania do Zamawiającego](#pytania-do-zamawiającego)

## Podsumowanie

Wynik weryfikacji: **11 POTWIERDZONE, 3 CZĘŚCIOWO (02, 10, 13), 0 NIEPOTWIERDZONE.**

| ID | Tytuł | Prio. Zam. | Weryfikacja | Proponowane API (konwencja Node-RED) | Zmiana serwera? | Ryzyko bezpieczeństwa | Szac. | Zależności |
|---|---|---|---|---|---|---|---|---|
| Z-12.01 | Ekran logowania – rozszerzenie przed/po uwierzytelnieniu | W | POTWIERDZONE | hooki edytora `RED.hooks`: `loginPrepare`, `loginFailed`, `loginPost`; skrypty logowania tylko z kanałów administratora (`editorTheme.page.scripts`, wtyczka motywu) – **wariant A (R-25)** | nie (wariant B odrzucony – R-25; dodatkowe pola przez `loginPost` z własną trasą pluginu) | **wysokie** (kod przed uwierzytelnieniem, XSS → kradzież haseł) | L (bez wariantu B – do ponownej oceny, możliwe M) | 03 (cykl życia), 12 (zamiast zdarzeń jQuery), E-03 |
| Z-12.02 | Wejście z jednorazowym kodem i zapis tokena | Ś | CZĘŚCIOWO | `#code=` obok `?code=`; `RED.user.setSession(tokens) → Promise`; zapis wyłącznie pól tokena | tak (przekierowanie strategii z `#code=` – opcja) | **wysokie** (logowanie na cudze konto, utrwalenie sesji) | M | 01 (`loginPost` także po wymianie kodu) |
| Z-12.03 | Zdarzenie „edytor gotowy” | W | POTWIERDZONE | zdarzenie `editor:ready` (`RED.events`), pole `onready` w definicji pluginu, gwarancja kolejności `onadd` | nie | niskie | S | E-03; baza dla 04–07, 10, 14 |
| Z-12.04 | Pełny cykl życia zakładki paska bocznego | W | POTWIERDZONE | `RED.sidebar.addTab({…, onhide, permission})`, `RED.sidebar.setTabLabel`, `RED.sidebar.setTabBadge`, `RED.sidebar.getTabContainer` | nie | niskie (etykieta/plakietka jako tekst) | M | 03; 08 (zdarzenie `user:permissions`) |
| Z-12.05 | Menu główne – dodanie pozycji | Ś | POTWIERDZONE | `RED.menu.addMainMenuItem(opts) → uchwyt`, udokumentowane grupy | nie | niskie | S | 03 |
| Z-12.06 | Menu użytkownika – trwałe pozycje | Ś | POTWIERDZONE | `RED.user.addMenuItem(opts)` / `RED.user.removeMenuItem(id)` | nie | niskie (+ istniejący problem: nazwa użytkownika jako HTML) | S | 03, 08 (opcja `permission`) |
| Z-12.07 | Nagłówek – przycisk lub plakietka | N | POTWIERDZONE | `RED.header.addItem(opts) → {update, setVisible, remove}`, `RED.header.removeItem(id)` | nie | niskie | M | 03 |
| Z-12.08 | Elementy UI zależne od uprawnień (model „implikacja + `!`”, egzekucja serwerowa typów – R-27) | W | POTWIERDZONE | rozszerzenie zakresów (`flows.deploy`, `flows.import`, `flows.export`, `nodes.type.<typ>`; `palette.manage` = istniejące `nodes.write`), wpisy odbierające (`"!…"`), zdarzenie `user:permissions`, `RED.settings.user.attributes` | **tak** (`ea/auth/permissions.js`, trasy Admin API, `rt/api/settings.js`, kontrola typów przy wdrożeniu – **w zakresie, R-27**) | **wysokie** (ukrycie w UI ≠ zabezpieczenie) | L (kontrola typów obowiązkowa – R-27; rozważyć podział) | E-01 (kontrola typów w potoku), Z-06; 04/06/09 korzystają |
| Z-12.09 | Paleta – kolejność, etykiety, ukrywanie | Ś | POTWIERDZONE | `editorTheme.palette.nodeOrder`, `editorTheme.palette.categoryLabels`; ukrywanie typów z 08 | częściowo (tylko scalanie z wtyczki motywu w `theme.js`) | średnie (ukrycie bez egzekucji z 08) | M | 08 |
| Z-12.10 | Otwarcie bloczka po id, głęboki link, `postMessage` | Ś | CZĘŚCIOWO | obsługa `hashchange`, format `#flow/<flowId>/node/<nodeId>`, akcja `core:reveal-node` (`RED.actions`), `editorTheme.embedding.allowedOrigins` (domyślnie wyłączone; obejmuje też `set-theme` – R-28) | tak (przekazanie nowego klucza `editorTheme` w `theme.js`) | **średnie–wysokie** (`postMessage` z obcych źródeł) | M | 03 |
| Z-12.11 | Subskrypcja kanału komunikacji | W | POTWIERDZONE | brak nowego API – poprawka `RED.comms.subscribe` w **Z-01** | nie (klient) | niskie | – (w Z-01, S) | **Z-01** |
| Z-12.12 | Sesja i wywołania API serwera z pluginu | W | POTWIERDZONE | `RED.api.request(path, options) → Promise`, `RED.settings.httpAdminRoot` | tak (`rt/api/settings.js` – `httpAdminRoot`) | **wysokie** (wyciek tokena do obcej domeny) | M | 01 (hook odpowiedzi logowania), 02 |
| Z-12.13 | Panel pełnoekranowy i okna modalne | Ś | CZĘŚCIOWO | `RED.dialog.open/confirm`, `RED.overlay.open` | nie | średnie (ramka z obcym adresem, HTML w treści) | M | 03; spójne z `RED.tray` |
| Z-12.14 | API między pluginami / plugin–bloczek | N | POTWIERDZONE | konwencja pola `api` w definicji pluginu, `RED.plugins.getPluginAPI(id)`, `RED.plugins.whenAvailable(id) → Promise` | nie | niskie | S | 03 |

Łączny szacunek (bez 11): 3×L, 7×M, 3×S + E2E (osobny podzbiór). Po decyzjach (2026-10-03): Z-12.08 – kontrola typów obowiązkowa (R-27, wzrost); Z-12.01 – bez wariantu B (R-25, spadek); Z-12.02 – `&next=` i opcja `sessionStorage` w zakresie (R-26).

## Ustalenia przekrojowe

1. **Kolejność startu edytora (fakty):** `index.mst:46-50` – `red.js`, `main.js`, potem `editorTheme.page.scripts`
   (skrypty wykonują się **przed** `RED.init`, bo `main.js` woła `RED.init` w `$(function(){…})`) →
   `RED.init` (`ec/red.js:953`) → `RED.settings.init` (wymiana `?code=`, `$.ajaxSetup`, `GET settings`; przy 401
   `RED.user.login`) → `loadEditor` (`red.js:841`: `RED.user.init`, `RED.sidebar.init` `:849`, `RED.deploy.init` `:874`,
   w `RED.keyboard.init` callback: `buildMainMenu`, zakładki core, `RED.comms.connect`) → `loadPluginList` (`:932`,
   `GET plugins` – wymaga `plugins.read`, `ea/admin/index.js:92-95`) → `onadd` pluginów (`ec/plugins.js:29-30`) →
   `loadNodeList` → `loadFlows` (`flows:loaded`, `red.js:303`) → `completeLoad` (`:320`, `loader.end()` `:674`,
   pokazanie paska narzędzi nagłówka `:676`, `RED.sidebar.show(":first")` `:678`).
2. **Pluginy doinstalowane w trakcie sesji** (paleta) dostają `onadd` po starcie (`red.js:544-571`), więc każde nowe API
   musi działać także po `editor:ready` (wywołanie natychmiastowe zamiast oczekiwania na zdarzenie, które już minęło).
3. **Etykiety menu to HTML** (`ec/ui/common/menu.js:152-160`), `RED.popover.dialog` wstawia treść przez `.html()`
   (`ec/ui/common/popover.js:786`). Nowe API przyjmują **tekst** (`label`) i opcjonalnie **element DOM** – nie łańcuch
   HTML – aby dodatki nie wprowadzały XSS. Istniejący problem: nazwa użytkownika wstawiana jako HTML
   (`ec/user.js:265` `"<b>"+username+"</b>"`) – przy strategii zewnętrznej nazwa pochodzi od dostawcy tożsamości;
   **rozstrzygnięte (R-08): osobna poprawka bezpieczeństwa teraz** (poza Z-12, priorytet 2, poprawka błędu z testem).
   W tej samej poprawce – odświeżenie `RED.settings.user` po ponownym logowaniu po wygaśnięciu sesji (`ec/comms.js:96-105`;
   dziś brak) z testem, który pada bez poprawki (**R-41**).
4. **Logika uprawnień jest zdublowana**: serwer `ea/auth/permissions.js:22-61`, klient `ec/user.js:297-345` (identyczne
   reguły). Każda zmiana (08) – w obu miejscach, z **wspólną tabelą przypadków testowych** uruchamianą dla obu.
5. **Konwencja nazw:** istniejące przestrzenie `RED.sidebar`, `RED.menu`, `RED.user`, `RED.events`, `RED.actions`,
   `RED.hooks`, `RED.plugins`, `RED.settings`; nowe tylko tam, gdzie brak odpowiednika: `RED.header`, `RED.dialog`,
   `RED.overlay`, `RED.api`. Zdarzenia `obszar:zdarzenie` (`flows:loaded`, `registry:plugin-added`) → `editor:ready`,
   `user:permissions`. Hooki edytora camelCase z obszarem na początku (`viewAddNode`, `debugPreProcessMessage`) →
   `loginPrepare`, `loginFailed`, `loginPost` (dopisane do `VALID_HOOKS`, `ec/hooks.js:7-15`).
   **Korekta karty Z-12 w etap-4.md:** `RED.header.add` → `RED.header.addItem` (spójność z `RED.menu.addItem`).
6. **Moduły:** nowe pliki w `ec/` dopisane do `concatEditor` (`scripts/build/config.js:19-97`); logika bez DOM w funkcjach
   eksportowanych wzorcem CommonJS (`search.js`, E-03) – testowalna w `npm test`.
7. **Dokumentacja „w stylu projektu”:** JSDoc w kodzie (`@since`, `@public`) + strona API edytora w katalogu
   `design/editor-api/` (**rozstrzygnięte R-24**). Deprecjacja nowych API: min. jedna wersja minor z ostrzeżeniem w konsoli (R-24).
   Przykłady pluginów: `test/resources/plugin/editor-extensions-example/` (wzorzec: `test/resources/plugin/test-plugin/`).
8. **Kryterium odbioru „żaden dodatek nie używa selektorów DOM edytora”** – weryfikowane statycznie: skrypt kontrolny
   (poza `npm test`, w raporcie) przeszukuje kod dodatków Zamawiającego i przykładów pod kątem `$("#red-ui-`, `.red-ui-`,
   `document.querySelector`, `getElementById` w odniesieniu do elementów edytora. Wyjątek dopuszczony: kontener
   zwrócony przez API (np. `getTabContainer`, element dialogu) – wewnątrz własnej treści dodatku.
9. **Punkty spoza załącznika B** (z karty Z-12 w etap-4.md): `RED.deploy.addMenuItem`, hook `deployPre`, dokumentacja
   `RED.view.annotations` – załącznik ich nie wymienia; **rozstrzygnięte (R-24): poza Z-12, osobny pakiet później**; nie są wliczone w szacunki poniżej.

### Wspólne scenariusze odbioru (stosowane w każdej karcie)

```gherkin
Szablon scenariusza: Odbiór punktu Z-12.<nn> (kryteria odbioru z załącznika B)
  Zakładając wdrożony punkt "<api>"
  Wtedy istnieje dokumentacja API w stylu projektu (JSDoc + strona w design/editor-api/ – R-24)
  I istnieje przykład pluginu w test/resources/plugin/editor-extensions-example korzystający wyłącznie z "<api>"
  I istnieje test jednostkowy logiki w npm test (wg E-03) albo scenariusz E2E w osobnym podzbiorze (D-03)
  I skrypt kontrolny nie znajduje w przykładzie selektorów DOM edytora

Scenariusz: Brak pluginu – edytor jak w 5.0.7
  Zakładając brak pluginów i skryptów używających nowego API
  Kiedy otworzę edytor
  Wtedy wygląd i zachowanie edytora są identyczne jak w 5.0.7, a istniejące testy przechodzą bez zmian
```

---

### Z-12.01 – Ekran logowania: rozszerzenie przed i po uwierzytelnieniu

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja |
| Priorytet / ryzyko | W / **wysokie** (kod wykonywany przed uwierzytelnieniem) |
| Ustawienie | **wariant A (R-25)**: brak nowego (istniejące `editorTheme.page.scripts`, `editorTheme.theme`); ~~wariant B: `editorTheme.login.plugins`~~ – odrzucony (R-25) |
| Zależności | 03, 12, E-03; Z-12.02 korzysta z `loginPost` |
| Pliki | `ec/user.js:18-218`, `ec/settings.js:163-186`, `ec/hooks.js:7-15`, `ea/auth/index.js:93-139`, `ea/editor/theme.js:104-132,290-300,370-391`, `editor-client/templates/index.mst:46-52`, `ea/admin/index.js:92-95` |
| Powiązania | Z-12.02, Z-12.12 |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE** (z uzupełnieniami).
- `RED.user.login` (`ec/user.js:18-218`) buduje okno w całości wewnętrznie; brak hooków i zdarzeń.
- Błąd logowania: stały tekst `user.loginFailed` (`:79`), odpowiedź serwera pomijana (`.fail`, `:110-112`).
- `loginMessage` (`ea/auth/index.js:129-131`) wyświetlany **tylko w gałęzi `else`** (`ec/user.js:171-176`), tj. gdy
  `adminAuth.type` nie jest ani `credentials`, ani `strategy` (np. same `adminAuth.tokens` + `editorTheme.login.button`).
  Różnica względem załącznika: nie „tylko przy zewnętrznej strategii” – w gałęzi `strategy` (`:120-169`) komunikat
  również nie jest pokazywany (pokazywane są tylko `session_message`).
- Pluginy: `GET plugins` wymaga `plugins.read` (`ea/admin/index.js:92-95`), ładowane po `RED.settings.init`
  (`ec/red.js:932`) – potwierdzone.
- **Uzupełnienie:** istnieją już dwa kanały kodu przed uwierzytelnieniem, oba kontrolowane wyłącznie przez administratora:
  `editorTheme.page.scripts` (serwowane bez sesji przez `/theme/scripts/…`, `theme.js:296-299`; wstawiane w
  `index.mst:48-50`, wykonują się przed `RED.init`) oraz `scripts` wtyczki motywu `node-red-theme` aktywowanej przez
  `editorTheme.theme` (`theme.js:104-132`). Instalacja modułu z palety nie aktywuje motywu.
- Ścieżki z `/resources/<moduł>/<plik>` są serwowane **bez sprawdzenia uprawnień** (`ea/editor/index.js:79`,
  `ea/editor/ui.js:76-95`) – zasoby modułów są więc już publiczne; `/locales/...` także bez uprawnień (`index.js:94`).
- Dodatkowe pola formularza: `passwordTokenExchange` (`ea/auth/strategies.js:84-110`) otrzymuje tylko
  `username`, `password`, `scope` – pola dodane przez plugin **nie trafią** do `adminAuth.authenticate` bez zmiany
  serwera (możliwość przekazania treści żądania przez oauth2orize – **do potwierdzenia**).

#### Specyfikacja
- **Cel:** dodatek może (a) pokazać komunikat z treści odpowiedzi serwera przy błędzie, (b) wykonać krok po udanym
  logowaniu przed startem edytora, (c) dodać elementy do formularza – bez DOM edytora.
- **Wejścia:** hooki rejestrowane przez `RED.hooks.add(...)` ze skryptu dostępnego przed uwierzytelnieniem.
- **Wyjścia:** wynik hooków steruje oknem logowania (komunikat, wstrzymanie, przerwanie).
- **Niezmienniki:** bez zarejestrowanych hooków okno i przepływ identyczne jak w 5.0.7; kod przed uwierzytelnieniem
  pochodzi **wyłącznie** z konfiguracji administratora (`settings.js`), nigdy z samej instalacji z palety; bez sesji nie
  są ujawniane: lista modułów/pluginów, katalogi komunikatów innych modułów, ustawienia runtime, dane użytkowników.
- **Przypadki błędów:** wyjątek w hooku → zalogowany w konsoli, okno działa dalej z zachowaniem domyślnym;
  `loginPost` odrzucony lub zwraca `false` → wylogowanie (`auth/revoke`), usunięcie tokena, ponowne okno logowania
  z komunikatem; brak odpowiedzi `loginPost` – brak limitu czasu (krok interaktywny), ale okno ma przycisk „Anuluj”
  = wylogowanie.
- **Skutki uboczne:** nowe hooki w `VALID_HOOKS`; bez zmian serwera (wariant A, R-25).

#### Projekt API
```js
/**
 * Hook: przygotowanie formularza logowania (credentials). Wywoływany po zbudowaniu pól z /auth/login.
 * @param {Object} payload
 * @param {"credentials"|"strategy"|string} payload.type
 * @param {Array<{id,type,label}>} payload.prompts  - pola z serwera (tylko odczyt)
 * @param {HTMLElement} payload.container            - kontener na DODATKOWE elementy pluginu (pusty div pod polami)
 * @param {function(string):void} payload.setMessage - komunikat tekstowy (wstawiany przez .text())
 * @since 5.x (Z-12)
 */
RED.hooks.add("loginPrepare.myPlugin", function(payload) {});

/**
 * Hook: nieudane logowanie. Zwrócony tekst zastępuje user.loginFailed (wstawiany jako TEKST).
 * @param {{status:number, error?:string, errorDescription?:string, body?:Object}} payload
 * @returns {void|string|Promise<void|string>}
 */
RED.hooks.add("loginFailed.myPlugin", function(payload) {});

/**
 * Hook: po udanym uzyskaniu tokena (hasło, wymiana kodu, setSession), PRZED RED.settings.load i startem edytora.
 * Kolejność: wg kolejności rejestracji; każdy kolejny czeka na Promise poprzedniego.
 * @param {{user?:Object, container:HTMLElement, request:function}} payload
 *        request – RED.api.request (12) z już ustawionym tokenem
 * @returns {void|false|Promise<void|false>} false/odrzucenie = przerwanie i wylogowanie
 */
RED.hooks.add("loginPost.myPlugin", function(payload) {});
```
- Miejsce: `ec/user.js` (wywołania `RED.hooks.trigger`), `ec/settings.js:130-138` (po wymianie kodu), `ec/red.js:970-976`
  (oczekiwanie na `loginPost` przed `loadEditor`). Logika sekwencji hooków i mapowania odpowiedzi błędu (`jqXHR` →
  `{status,error,errorDescription}`) w funkcjach bez DOM (`RED.user._loginFlow` – eksport CommonJS).
- **Dostarczanie skryptu (rozstrzygnięte R-25 – wariant A, bez zmian serwera):** dodatek logowania jako skrypt
  `editorTheme.page.scripts` albo `scripts` wtyczki motywu (`editorTheme.theme`). Oba kanały wymagają edycji
  `settings.js`. Dokumentacja opisuje wzorzec „plugin = część edytorowa (po zalogowaniu) + skrypt logowania (przed)”.
- **Wariant B – odrzucony (R-25); opis zachowany jako historia:** nowe pole w `package.json` pluginu
  (`"node-red": {"plugins": {...}, "loginScripts": [...]}` – nazwa do potwierdzenia) + publiczny endpoint
  `GET /theme/login-scripts/<id>/<plik>` serwujący **tylko** skrypty pluginów wymienionych w `editorTheme.login.plugins`
  (lista w `settings.js`). Nie ujawnia listy pluginów; katalog komunikatów tylko tych pluginów. Instalacja z palety nie
  aktywuje skryptu; aktualizacja aktywnego modułu z palety zmienia kod przed logowaniem – opisane w dokumentacji
  (rekomendacja: w produkcji `externalModules.palette.allowUpdate: false` dla takich modułów lub instalacja tylko z obrazu).
- **Dodatkowe pola** (np. kod jednorazowy) – **rozstrzygnięte (R-25): przez krok `loginPost` z własną trasą pluginu** (12),
  bez zmiany `strategies.js` i bez przekazywania pól do `adminAuth.authenticate`.
- **Lista do wyboru po logowaniu:** rekomendacja – plugin pobiera listę w `loginPost` własną trasą przez
  `payload.request` (bez rozszerzania odpowiedzi `auth/token`, która jest budowana przez oauth2orize).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Rozszerzenie ekranu logowania

  Scenariusz: Komunikat błędu z odpowiedzi serwera
    Zakładając skrypt logowania z hookiem loginFailed zwracającym pole error_description odpowiedzi
    Kiedy podam błędne hasło
    Wtedy okno pokazuje tekst z odpowiedzi serwera zamiast "Login failed"
    I tekst jest wstawiony jako tekst, a znaczniki HTML z odpowiedzi nie są interpretowane

  Scenariusz: Krok po zalogowaniu wstrzymuje start edytora
    Zakładając hook loginPost pokazujący listę w payload.container i rozwiązujący Promise po wyborze
    Kiedy zaloguję się poprawnie
    Wtedy edytor nie ładuje pluginów ani flow przed rozwiązaniem Promise
    I po wyborze edytor startuje normalnie

  Scenariusz: Przerwanie w loginPost
    Zakładając hook loginPost zwracający false
    Kiedy zaloguję się poprawnie
    Wtedy token jest unieważniony przez auth/revoke i usunięty z przeglądarki
    I ponownie widzę okno logowania z komunikatem

  Scenariusz: Wyjątek w hooku nie blokuje logowania
    Zakładając hook loginPrepare zgłaszający wyjątek
    Kiedy otworzę edytor
    Wtedy okno logowania działa jak w 5.0.7, a błąd jest w konsoli

  Scenariusz: Plugin z palety nie wykonuje kodu przed logowaniem (wariant A, R-25)
    Zakładając moduł z pluginem edytora zainstalowany z palety i niewymieniony w editorTheme.page.scripts ani editorTheme.theme
    Kiedy niezalogowany użytkownik otworzy edytor
    Wtedy żaden skrypt modułu nie jest wykonywany przed zalogowaniem

  Scenariusz: Bez sesji nie są ujawniane dane instancji
    Kiedy niezalogowany klient wywoła GET plugins
    Wtedy otrzymuje 401

  Scenariusz: Dodatkowe pole przez loginPost z własną trasą pluginu (R-25)
    Zakładając hook loginPost pokazujący pole kodu w payload.container i wysyłający je własną trasą pluginu przez payload.request
    Kiedy zaloguję się poprawnie i podam kod
    Wtedy edytor startuje dopiero po akceptacji kodu przez trasę pluginu
    I żądanie auth/token nie zawiera dodatkowego pola

  # + wspólne scenariusze odbioru (api = hooki loginPrepare/loginFailed/loginPost)
```

#### Testy
- Jednostkowe `test/unit/@node-red/editor-client/user_login_spec.js` (logika wydzielona): `maps jqXHR to loginFailed payload`,
  `loginFailed result replaces default message`, `loginPost hooks run sequentially`, `loginPost false aborts and revokes`,
  `hook exception falls back to default`.
- `test/unit/@node-red/editor-client/hooks_spec.js`: nowe identyfikatory w `VALID_HOOKS`.
- ~~Wariant B: testy `theme_spec.js` endpointu skryptów logowania~~ – odrzucony (R-25).
- E2E (osobny podzbiór, D-03): `login_extension_e2espec.js` – komunikat błędu, krok wyboru, przerwanie.

#### DoD specyficzne
- [ ] Przegląd bezpieczeństwa: każde miejsce wstawiania tekstu z serwera/pluginu używa `.text()`.
- [ ] Dokumentacja ostrzega: skrypt logowania ma dostęp do pól hasła – instalować tylko zaufany kod.
- [ ] Dokumentacja wzorca „dodatkowe pola przez `loginPost` + własna trasa pluginu” (R-25); wariant B odrzucony.
- [ ] Przykład: `editor-extensions-example/login.js` (komunikat + krok wyboru).

#### Ryzyka i alternatywy
- **XSS przed logowaniem = przechwycenie haseł** – stąd tekst zamiast HTML i kanały tylko z `settings.js`.
- **Brak CSP** w edytorze (nagłówki ustawia ewentualnie `httpAdminMiddleware`) – **do potwierdzenia**; rekomendacja
  w dokumentacji wdrożeniowej.
- Alternatywa: tylko udokumentowanie `page.scripts` + hooki (wariant A) – minimum, rekomendowane na start.
- `loginPost` dotyczy także ponownego logowania po wygaśnięciu sesji (`ec/comms.js:96-105`) – tam edytor już działa;
  hook dostaje flagę `relogin: true` (do potwierdzenia z Zamawiającym, czy krok ma się powtarzać).

#### Podzadania
- [ ] Hooki `loginPrepare`/`loginFailed`/`loginPost` + wydzielona logika + testy – M
- [ ] Oczekiwanie na `loginPost` w `RED.init`/wymianie kodu/ponownym logowaniu – M
- [ ] ~~Wariant B: endpoint i ustawienie `editorTheme.login.plugins` + testy serwera – M~~ – odrzucony (R-25)
- [ ] Dokumentacja, przykład, E2E – S

---

### Z-12.02 – Wejście z jednorazowym kodem i zapis tokena

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja |
| Priorytet / ryzyko | Ś / **wysokie** |
| Ustawienie | `adminAuth.strategy.codeInFragment: false` (nazwa robocza; `true` → przekierowanie z `#code=`); `editorTheme.auth.tokenStorage: "local" \| "session"`, domyślnie `"local"` (R-26, **R-33**) |
| Zależności | 01 (`loginPost`), 12 |
| Pliki | `ec/settings.js:41-51,109-142`, `ec/user.js:104,220-242`, `ea/auth/index.js:254-268,277-284`, `ea/auth/tokens.js:134-198`, `ea/auth/strategies.js:84-100` |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **CZĘŚCIOWO**.
- `?code=` wymieniany przez `POST auth/token` (`ec/settings.js:123-138`); przestarzały `?access_token=` (`:114-121`) –
  potwierdzone. Po wymianie zapisywane jest **tylko** `{access_token}` (`:131`).
- Kod w zapytaniu: serwer sam przekierowuje na `httpAdminRoot + '?code=' + exchangeCode` (`ea/auth/index.js:258`) –
  kod trafia do logów pośredników przy żądaniu `GET /`. Kod jest jednorazowy i ważny 20 s
  (`ea/auth/tokens.js:101,154-157,177-195`) – ryzyko ograniczone, ale realne.
- Zapis całej odpowiedzi: `RED.settings.set("auth-tokens", data)` (`ec/user.js:104`) – potwierdzone, ale odpowiedź
  `auth/token` (oauth2orize, `strategies.js:96-100`) zawiera tylko `access_token`, `expires_in`, `token_type`.
  **Różnica względem załącznika:** w rdzeniu nie są utrwalane dane „nie-tokenowe” poza `expires_in`/`token_type`;
  problem dotyczy raczej braku kontraktu (dowolne pola z niestandardowych odpowiedzi trafią do localStorage).
- Klucz localStorage: `"auth-tokens" + authTokensSuffix`, gdzie sufiks to ścieżka strony z `/`→`-`
  (`ec/settings.js:46,111-112`) – dodatki kopiują ten wewnętrzny sposób, potwierdzone.
- Jak „inna aplikacja” uzyskuje kod? Kody tworzy tylko `Tokens.create(..., true)` w strategii (`ea/auth/index.js:157`).
  Przekazanie sesji z zewnętrznej aplikacji wymaga po stronie serwera mechanizmu wydania kodu – **rozstrzygnięte (R-26):
  kod wydaje własna strategia `adminAuth`/plugin**, rdzeń jedynie przyjmuje `#code=…&next=…`.

#### Specyfikacja
- **Cel:** kod jednorazowy także we fragmencie adresu; oficjalny zapis tokena; w localStorage tylko pola tokena.
- **Wejścia:** `#code=<kod>[&next=<głęboki link>]` (R-26) lub `?code=<kod>`; `RED.user.setSession({access_token, expires_in?})`; ustawienie `editorTheme.auth.tokenStorage`: `"local"` (domyślnie, `localStorage` – jak 5.0.7) lub `"session"` (`sessionStorage`) (R-26, **R-33**).
- **Wyjścia:** token w localStorage (lub `sessionStorage` przy `editorTheme.auth.tokenStorage: "session"` – R-26, R-33) w postaci `{access_token, expires_in?, expires_at?}`; adres oczyszczony bez
  przeładowania (`history.replaceState`); przy `next` – nawigacja do głębokiego linku (format Z-12.10) po starcie edytora.
- **Niezmienniki:** `?code=` i `?access_token=` działają jak dziś; domyślne przekierowanie serwera bez zmian
  (`codeInFragment: false`); fragmenty `#flow/…`, `#node/…` nie są interpretowane jako kod.
- **Przypadki błędów:** nieważny/wygasły kod → 400 (`ea/auth/index.js:282`), adres oczyszczony, okno logowania z
  komunikatem (hook `loginFailed`); `setSession` z tokenem odrzuconym przez serwer (401 na `GET settings`) → Promise
  odrzucony, nic nie jest zapisywane.
- **Skutki uboczne:** zmiana formatu zapisu tokena (zgodna wstecz przy odczycie – odczyt `access_token` jak dziś).

#### Projekt API
```js
/**
 * Ustanawia sesję edytora z tokenu uzyskanego poza oknem logowania (SSO, przekazanie sesji).
 * Weryfikuje token (GET settings z nagłówkiem Authorization), zapisuje WYŁĄCZNIE pola tokena,
 * uruchamia hook loginPost (01) i przeładowuje ustawienia.
 * @param {{access_token:string, expires_in?:number}} tokens
 * @returns {Promise<Object>} rozwiązany obiektem RED.settings.user; odrzucony przy 401
 * @since 5.x (Z-12)
 */
RED.user.setSession(tokens)
```
- `ec/settings.js`: funkcja wewnętrzna `pickTokenFields(obj)` (bez DOM, testowalna) używana przez `set("auth-tokens")`;
  parser `parseAuthParams(location) → {code, accessToken, source: "query"|"fragment"}` (czysta funkcja).
- Fragment: rozpoznawany tylko format `#code=<kod>` z opcjonalnym `&next=<hash>` dla głębokiego linku (**R-26**); `next` przyjmowany wyłącznie jako fragment edytora (format Z-12.10), nigdy jako adres zewnętrzny.
- Serwer: `completeGenericStrategyAuth` (`ea/auth/index.js:254-259`) – przy `codeInFragment: true` przekierowanie
  `httpAdminRoot + '#code=' + encodeURIComponent(code)`.
- **Ochrona przed logowaniem na cudze konto (login CSRF / utrwalenie sesji):** jeśli w przeglądarce jest już ważny token
  innego użytkownika, przed zastąpieniem pokazywane jest potwierdzenie („Zalogować jako X?”); po wejściu z kodem zawsze
  powiadomienie „zalogowano jako <nazwa>” (tekst). Kod jest jednorazowy i krótkotrwały (istniejące 20 s).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Wejście z kodem jednorazowym i zapis tokena

  Scenariusz: Kod we fragmencie adresu
    Zakładając ważny kod jednorazowy
    Kiedy otworzę edytor pod adresem z #code=<kod>
    Wtedy edytor wymienia kod przez POST auth/token i startuje zalogowany
    I adres po starcie nie zawiera kodu, a strona nie jest przeładowywana
    I żądanie GET strony edytora nie zawiera kodu (fragment nie jest wysyłany do serwera)

  Scenariusz: Zgodność wstecz z ?code=
    Kiedy otworzę edytor z ?code=<kod>
    Wtedy zachowanie jest jak w 5.0.7

  Scenariusz: Zapis wyłącznie pól tokena
    Zakładając odpowiedź logowania z dodatkowym polem "profile"
    Kiedy zaloguję się
    Wtedy w localStorage zapisane są tylko access_token i expires_in (oraz wyliczone expires_at)

  Scenariusz: setSession z nieważnym tokenem
    Kiedy plugin wywoła RED.user.setSession z tokenem odrzucanym przez serwer
    Wtedy Promise jest odrzucony, a localStorage nie zmienia się

  Scenariusz: Kod innego użytkownika przy aktywnej sesji
    Zakładając zalogowanego użytkownika A
    Kiedy otworzę adres z kodem użytkownika B
    Wtedy edytor pyta o potwierdzenie przed zastąpieniem sesji

  Scenariusz: Kod z głębokim linkiem (R-26)
    Zakładając ważny kod jednorazowy
    Kiedy otworzę edytor pod adresem z #code=<kod>&next=flow/<flowId>/node/<nodeId>
    Wtedy edytor startuje zalogowany i pokazuje wskazany bloczek
    I adres po starcie nie zawiera kodu

  Scenariusz: Przechowywanie tokena w sessionStorage jako opcja (R-26, R-33)
    Zakładając editorTheme.auth.tokenStorage = "session"
    Kiedy zaloguję się
    Wtedy token jest zapisany w sessionStorage, a nie w localStorage
    I bez ustawienia (domyślnie "local") token jest zapisywany w localStorage jak w 5.0.7

  Scenariusz: Przekierowanie strategii z fragmentem
    Zakładając adminAuth.strategy.codeInFragment = true
    Kiedy zakończy się logowanie strategią
    Wtedy serwer przekierowuje na adres z #code= zamiast ?code=

  # + wspólne scenariusze odbioru (api = RED.user.setSession, #code=)
```

#### Testy
- `test/unit/@node-red/editor-client/settings_auth_spec.js`: `parses code from fragment`, `ignores #flow hash`,
  `keeps ?code and ?access_token`, `pickTokenFields drops extra fields`, `reads legacy stored token`, `parses next from fragment` (R-26), `rejects external next`, `stores token in sessionStorage when tokenStorage is session` (R-26, R-33), `defaults to localStorage when tokenStorage absent or local`.
- `test/unit/@node-red/editor-api/lib/editor/theme_spec.js`: `passes auth.tokenStorage setting` (nowy klucz `editorTheme` przekazywany jawnie – jak w Z-12.10).
- `test/unit/@node-red/editor-client/user_session_spec.js`: `setSession verifies before storing`, `rejects on 401`.
- `test/unit/@node-red/editor-api/lib/auth/index_spec.js`: `redirects with fragment when codeInFragment`, `default redirect unchanged`.
- E2E (osobny podzbiór): wejście z `#code=`, brak kodu w logu serwera testowego.

#### DoD specyficzne
- [ ] Ustawienie `codeInFragment` w szablonie `settings.js` (zakomentowane, opis ryzyka logów pośredników).
- [ ] Dokumentacja: kod wydaje własna strategia `adminAuth`/plugin, rdzeń przyjmuje `#code=…&next=…` (R-26); ustawienie `editorTheme.auth.tokenStorage` opisane w szablonie `settings.js` (R-26, R-33).
- [ ] Przykład: `editor-extensions-example/session.js` (`setSession` po wymianie z własną trasą).

#### Ryzyka i alternatywy
- **Login CSRF / utrwalenie sesji** – link z kodem atakującego loguje ofiarę na konto atakującego; łagodzenie: potwierdzenie
  przy zmianie użytkownika, widoczny komunikat, krótki czas życia kodu. Klasyczny CSRF Admin API nie dotyczy (token w
  nagłówku `Authorization`, nie w ciasteczku), chyba że wdrożenie używa ciasteczek przez `httpAdminMiddleware`/`adminAuth.tokens`
  – wtedy CSRF po stronie wdrożenia (opis w dokumentacji).
- `setSession` dostępne dla każdego skryptu na stronie – nie zwiększa uprawnień (skrypt na tej samej stronie i tak ma
  dostęp do localStorage), ale musi być opisane.
- `sessionStorage` zamiast `localStorage` (token znika po zamknięciu karty) – **rozstrzygnięte (R-26): jako opcja, domyślnie `localStorage`** (bez zmiany zachowania domyślnego); nazwa: `editorTheme.auth.tokenStorage: "local" | "session"` (**R-33**).

#### Podzadania
- [ ] Parser parametrów (`code`, `next` – R-26) i `pickTokenFields` + testy – S
- [ ] `editorTheme.auth.tokenStorage` (R-26, R-33): odczyt w `ec/settings.js`, przekazanie w `ea/editor/theme.js`, testy – S
- [ ] `RED.user.setSession` + potwierdzenie zmiany użytkownika – M
- [ ] Serwer: `codeInFragment` + test – S
- [ ] Dokumentacja, przykład, E2E – S

---

### Z-12.03 – Zdarzenie „edytor gotowy”

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja |
| Priorytet / ryzyko | W / niskie |
| Ustawienie | brak |
| Zależności | E-03; bazowe dla 04, 05, 06, 07, 10, 13, 14 |
| Pliki | `ec/red.js:236-318,320-688,841-934`, `ec/plugins.js:6-33`, `ec/events.js:17-59`, `ec/ui/sidebar.js:120-183,1127` |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE**.
- `flows:loaded` (`ec/red.js:303`) – emitowane tylko przy powodzeniu importu, także ponownie po przełączeniu projektu
  (`:343`) – nie jest „jednorazowym” momentem gotowości; przy błędzie importu (`:304-313`) nie jest emitowane.
- `onadd` wywoływane synchronicznie w `registerPlugin` (`ec/plugins.js:29-30`); dla pluginów z `/plugins` – po
  `RED.sidebar.init` i zbudowaniu menu (`red.js:849,878-932`), ale **przed** węzłami i flow.
- `page.scripts` wykonują się przed `RED.init` (`index.mst:48-50`, `main.js`) – brak punktu startu.
- `RED.sidebar.addTab` przed `init()` rzuca `TypeError` (`ec/ui/sidebar.js:182`: `targetSidebar.sections` niezdefiniowane).
- `RED.events` nie ma zdarzeń „zapamiętanych” – subskrybent po fakcie nie dostaje zdarzenia (`events.js:20-53`).

#### Specyfikacja
- **Cel:** jeden pewny moment rejestracji UI i gwarancje kolejności.
- **Wejścia:** subskrypcja `RED.events.on("editor:ready", fn)`; pole `onready` w definicji pluginu.
- **Wyjścia:** wywołanie raz na sesję strony, po: inicjalizacji rejestrów UI, załadowaniu pluginów, węzłów, flow
  (także gdy flow są puste lub import się nie powiódł), subskrypcjach `completeLoad` i `loader.end()`.
- **Niezmienniki:** `onadd` – dotychczasowy moment dla pluginów z `/plugins` (bez zmiany); plugin zarejestrowany
  **przed** gotowością rejestrów UI (np. z `page.scripts`) dostaje `onadd` odroczone do chwili gotowości rejestrów
  (dziś to wywołanie by rzuciło – zmiana zgodna wstecz); plugin zarejestrowany po `editor:ready` dostaje `onready`
  natychmiast (asynchronicznie, w kolejnym takcie).
- **Przypadki błędów:** wyjątek w `onready`/obsłudze zdarzenia → złapany i zalogowany (jak `events.js:45-50`).
- **Skutki uboczne:** `RED.sidebar.addTab` przed `init` – czytelny błąd (`Error("RED.sidebar not initialised – use onadd/editor:ready")`) zamiast `TypeError`.

#### Projekt API
```js
/** Zdarzenie emitowane raz, gdy edytor jest w pełni gotowy. @event editor:ready @since 5.x */
RED.events.on("editor:ready", function() {});

/** Stan gotowości (tylko odczyt). @returns {{ui:boolean, ready:boolean}} */
RED.state.editorReady   // lub RED.events.isReady("editor:ready") – nazwa do potwierdzenia w spike

RED.plugins.registerPlugin("my-plugin", {
    type: "my-type",
    onadd: function() {},   // gwarancja: rejestry UI (sidebar, menu, actions, statusBar, deploy, user, header) gotowe
    onready: function() {}  // gwarancja: po editor:ready (lub natychmiast, jeśli już minęło)
});
```
- Miejsce: `ec/red.js` – emisja na końcu `completeLoad` (po `RED.sidebar.show(":first")`, `:678`) oraz w ścieżce błędu
  importu; `ec/plugins.js` – kolejka `pendingOnadd` opróżniana w `loadEditor` tuż przed `loadPluginList()` (`red.js:932`).
- Logika („bramka gotowości”: kolejka, natychmiastowe wywołanie po fakcie, izolacja wyjątków) jako czysta funkcja
  `createReadyGate()` eksportowana do testów.
- Udokumentowana kolejność: `page.scripts` → (logowanie, `loginPost`) → rejestry UI → `onadd` (kolejność ładowania
  pluginów) → węzły → flow (`flows:loaded`) → `editor:ready` → `onready`.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Zdarzenie edytor gotowy

  Scenariusz: Skrypt z page.scripts rejestruje zakładkę
    Zakładając skrypt page.scripts rejestrujący plugin z onready dodającym zakładkę paska bocznego
    Kiedy otworzę edytor
    Wtedy zakładka jest widoczna, a w konsoli nie ma błędów

  Scenariusz: Jednorazowość
    Kiedy przełączę projekt (ponowny flows:loaded)
    Wtedy editor:ready nie jest emitowane ponownie

  Scenariusz: Plugin doinstalowany z palety
    Zakładając edytor po editor:ready
    Kiedy zainstaluję plugin z onready
    Wtedy onready jest wywołane jednokrotnie

  Scenariusz: Błąd importu flow
    Zakładając flow, którego import zgłasza błąd
    Wtedy editor:ready jest mimo to emitowane

  Scenariusz: Wyjątek w onready
    Zakładając dwa pluginy, z których pierwszy zgłasza wyjątek w onready
    Wtedy drugi plugin otrzymuje onready, a błąd jest w konsoli

  # + wspólne scenariusze odbioru (api = editor:ready, onready)
```

#### Testy
- `test/unit/@node-red/editor-client/ready_gate_spec.js`: `queues callbacks until ready`, `fires once`, `late subscriber called async`,
  `isolates exceptions`, `deferred onadd before ui ready`.
- `test/unit/@node-red/editor-client/plugins_spec.js`: `onadd deferred when registered before ui init`, `onready after ready`.
- E2E: plugin z `page.scripts` i plugin z katalogu `nodesDir`.

#### DoD specyficzne
- [ ] Diagram kolejności startu w dokumentacji.
- [ ] Przykład: `editor-extensions-example/ready.js`.

#### Ryzyka i alternatywy
- Zmiana momentu `onadd` dla wczesnej rejestracji – dziś skutkuje wyjątkiem, więc brak użytkowników poprawnego zachowania.
- Alternatywa: tylko `flows:loaded` + dokumentacja – odrzucona (wielokrotne, zależne od powodzenia importu).

#### Podzadania
- [ ] Bramka gotowości + emisja + `onready` + testy – S
- [ ] Odroczenie `onadd`, czytelny błąd `addTab` przed `init` – S
- [ ] Dokumentacja i przykład – S

---

### Z-12.04 – Cykl życia zakładki paska bocznego

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja |
| Priorytet / ryzyko | W / niskie |
| Ustawienie | brak |
| Zależności | 03; 08 (zdarzenie `user:permissions` – opcja `permission` działa też bez niego na `RED.user.hasPermission`) |
| Pliki | `ec/ui/sidebar.js:120-318,629-690,692-790,1201-1208` |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE**.
- `addTab` (`:120`) z `onchange` wywoływanym przy pokazaniu (`:738-740`), `onremove` (`:297-299`), `containsTab` (`:787`);
  eksport: `init, addTab, removeTab, show, containsTab, toggleSidebar` (`:1201-1208`).
- Brak `onhide`: przy pokazaniu innej zakładki treść jest tylko ukrywana (`:736`), `hideTab` (`:268`) nie jest eksportowane
  i nie powiadamia; zwinięcie paska (`toggleSidebar`, `:629`) również bez powiadomienia.
- Brak zmiany etykiety/plakietki: `name` używane w menu Widok (`:198-205`), podpowiedzi (`:241`), banerze (`:747`).
- Struktura 5.x: przyciski `button[data-tab-id]` (`:239`), dwie sekcje (top/bottom) w dwóch paskach – potwierdzone.
- Brak kontroli duplikatu `id` (drugi `addTab` z tym samym `id` nadpisuje `knownTabs`, zostawiając osierocony przycisk).

#### Specyfikacja
- **Cel:** reagowanie na ukrycie, zmiana etykiety i plakietki, widoczność wg uprawnień, stabilny kontener.
- **Wejścia:** nowe opcje `addTab`: `onhide`, `permission`; nowe funkcje poniżej.
- **Wyjścia:** wywołania zwrotne w kolejności `onhide(stara)` → `onchange(nowa)`; aktualizacja UI.
- **Niezmienniki:** zakładki bez nowych opcji działają jak dziś; `onhide` nie jest wywoływane dla zakładki, która nie
  była widoczna; plugin nie może zmienić etykiety/plakietki zakładki core (tylko jeśli sam ją dodał – identyfikacja przez
  `id` zarejestrowane z `module`/pluginem; dla core – ostrzeżenie i brak zmiany, **do potwierdzenia**, czy dopuścić).
- **Przypadki błędów:** nieznane `id` → `false` + ostrzeżenie; duplikat `id` w `addTab` → ostrzeżenie, drugi wpis odrzucony.
- **Skutki uboczne:** nowe klasy CSS plakietki (`red-ui-sidebar-tab-badge`) w `sass`.

#### Projekt API
```js
/**
 * @param {Object} options  dotychczasowe pola + :
 * @param {function} [options.onhide]   wywoływane, gdy zakładka przestaje być widoczna
 *        (inna zakładka w tej sekcji, ukrycie sekcji, zwinięcie paska, removeTab gdy była widoczna – przed onremove)
 * @param {string|string[]} [options.permission]  zakładka dodawana tylko, gdy RED.user.hasPermission(permission);
 *        ponownie oceniana przy user:permissions (08)
 * @returns {boolean} false, gdy zakładka nie została dodana (duplikat, brak uprawnień)
 */
RED.sidebar.addTab(options)
/** @param {string} id @param {string} label tekst (bez HTML) @returns {boolean} */
RED.sidebar.setTabLabel(id, label)
/** @param {string} id @param {null|string|number|{text:string,type?:"info"|"warning"|"error"}} badge null = usuń */
RED.sidebar.setTabBadge(id, badge)
/** @param {string} id @returns {HTMLElement|null} kontener treści zakładki (stabilny przez cały cykl życia) */
RED.sidebar.getTabContainer(id)
/** @param {string} id @returns {boolean} */
RED.sidebar.isTabVisible(id)
```
- Logika przejść stanów (która zakładka traci/zyskuje widoczność przy `show`/`hideSection`/`toggleSidebar`/`removeTab`)
  wydzielona do czystej funkcji `computeVisibilityTransitions(state, action)` – testowalna; DOM tylko w adapterze.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Cykl życia zakładki paska bocznego

  Scenariusz: onhide przy przełączeniu
    Zakładając widoczną zakładkę pluginu A z onhide
    Kiedy pokażę inną zakładkę w tej samej sekcji
    Wtedy onhide zakładki A jest wywołane przed onchange nowej zakładki

  Scenariusz: onhide przy zwinięciu paska
    Kiedy zwinę pasek boczny z widoczną zakładką A
    Wtedy onhide zakładki A jest wywołane

  Scenariusz: Etykieta i plakietka
    Kiedy plugin wywoła setTabLabel("a","Nowa") i setTabBadge("a",3)
    Wtedy etykieta w podpowiedzi, banerze i menu Widok to "Nowa", a przycisk zakładki pokazuje plakietkę "3"
    I etykieta "<b>x</b>" jest wyświetlana dosłownie jako tekst

  Scenariusz: Widoczność zależna od uprawnień
    Zakładając użytkownika bez uprawnienia flows.deploy
    Kiedy plugin doda zakładkę z permission "flows.deploy"
    Wtedy zakładka nie jest dodana, a addTab zwraca false

  Scenariusz: Duplikat identyfikatora
    Kiedy plugin doda drugą zakładkę o istniejącym id
    Wtedy w konsoli jest ostrzeżenie, a pasek ma jeden przycisk tej zakładki

  # + wspólne scenariusze odbioru (api = RED.sidebar.*)
```

#### Testy
- `test/unit/@node-red/editor-client/ui/sidebar_lifecycle_spec.js`: `hide transition on show other`, `hide on collapse`,
  `hide before remove`, `no hide when not visible`, `duplicate id rejected`, `permission filter`, `badge model normalisation`.
- E2E: przykład z plakietką i `onhide`.

#### DoD specyficzne
- [ ] Opis gwarancji kolejności `onhide`/`onchange`/`onremove` w dokumentacji.
- [ ] Przykład: `editor-extensions-example/sidebar.js`.

#### Ryzyka i alternatywy
- Złożony stan dwóch pasków i sekcji (5.x) – stąd czysta funkcja przejść i testy tabelaryczne.
- Alternatywa: zdarzenia `sidebar:tab-shown/hidden` w `RED.events` – mniej precyzyjne (globalne); można dodać obok.

#### Podzadania
- [ ] `onhide` + funkcja przejść + testy – M
- [ ] `setTabLabel`, `setTabBadge` (+ CSS), `getTabContainer`, `isTabVisible` – S
- [ ] Opcja `permission`, duplikaty – S
- [ ] Dokumentacja, przykład – S

---

### Z-12.05 – Menu główne: dodanie pozycji

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja |
| Priorytet / ryzyko | Ś / niskie |
| Ustawienie | brak (pozycje pluginów respektują `editorTheme.menu["<id>"] = false`, `menu.js:91`) |
| Zależności | 03 |
| Pliki | `ec/red.js:735-840`, `ec/ui/common/menu.js:87-160,547-572` |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE**.
- Menu główne: `RED.menu.init({id:"red-ui-header-button-sidemenu"})` (`ec/red.js:839-840`) – identyfikator to szczegół DOM.
- `RED.menu.addItem(id, opt)` (`menu.js:547-569`): `group` działa tylko przez klasę `red-ui-menu-group-<grupa>`
  i sortuje alfabetycznie po etykiecie; pozycje core nie mają grup (separatory `null`, `red.js:817-824`) – nie da się
  wskazać miejsca. Etykieta wstawiana jako HTML (`menu.js:152-160`).
- Menu budowane w callbacku `RED.keyboard.init` (`red.js:875-876`) – wcześniejsze `addItem` trafia w nieistniejący kontener.

#### Specyfikacja
- **Cel:** dodanie pozycji w udokumentowanym miejscu menu głównego.
- **Wejścia:** `{id, label, icon?, onselect (funkcja lub nazwa akcji), group, permission?, options?}`.
- **Wyjścia:** pozycja w grupie; uchwyt `{remove(), setDisabled(b), setVisible(b)}`.
- **Niezmienniki:** pozycje core i ich kolejność bez zmian; wywołanie przed zbudowaniem menu – kolejkowane.
- **Przypadki błędów:** duplikat `id` → ostrzeżenie, odrzucenie; nieznana grupa → koniec menu przed „Ustawienia” + ostrzeżenie.
- **Skutki uboczne:** w pozycjach core dodane znaczniki grup (atrybut danych, bez zmiany wyglądu).

#### Projekt API
```js
/**
 * @param {Object} opts
 * @param {string} opts.id
 * @param {string} opts.label  tekst (escapowany); opts.sublabel – tekst
 * @param {string|function} opts.onselect  nazwa akcji RED.actions lub funkcja
 * @param {"projects"|"edit"|"view"|"arrange"|"import-export"|"search"|"flows"|"subflows"|"groups"|"palette"|"settings"|"help"} opts.group
 * @param {string|string[]} [opts.permission]
 * @returns {{remove:function, setDisabled:function(boolean), setVisible:function(boolean)}|null}
 */
RED.menu.addMainMenuItem(opts)
RED.menu.MAIN_MENU_GROUPS   // zamrożona lista grup (dokumentacja)
```
- Implementacja: tabela grup → „kotwica” (id pozycji core, po której wstawiamy) – czysta funkcja
  `resolveInsertPoint(groups, existing, opts)`; adapter DOM używa istniejącego `RED.menu.addItem`/`createMenuItem`.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Pozycje menu głównego

  Scenariusz: Pozycja w grupie
    Kiedy plugin doda pozycję z group "help"
    Wtedy pozycja jest w sekcji pomocy menu głównego, a pozycje core zachowują kolejność

  Scenariusz: Rejestracja przed zbudowaniem menu
    Zakładając wywołanie w onadd pluginu z page.scripts
    Wtedy pozycja pojawia się po zbudowaniu menu

  Scenariusz: Ukrycie przez editorTheme.menu
    Zakładając editorTheme.menu["my-item"] = false
    Wtedy pozycja pluginu "my-item" nie jest widoczna

  Scenariusz: Uprawnienie
    Zakładając użytkownika bez "flows.export"
    Kiedy plugin doda pozycję z permission "flows.export"
    Wtedy pozycja nie jest widoczna

  # + wspólne scenariusze odbioru (api = RED.menu.addMainMenuItem)
```

#### Testy
- `test/unit/@node-red/editor-client/ui/menu_main_spec.js`: `resolves anchor per group`, `unknown group fallback`,
  `queues before build`, `duplicate id rejected`, `label escaped`.

#### DoD specyficzne
- [ ] Tabela grup w dokumentacji (zrzut menu z oznaczeniem grup).
- [ ] Przykład: `editor-extensions-example/menu.js`.

#### Ryzyka i alternatywy
- Grupy stają się kontraktem – zmiana menu upstream wymaga utrzymania mapowania.
- Alternatywa: tylko stała `RED.menu.MAIN_MENU` dla `addItem` – tańsze, ale bez kontroli miejsca.

#### Podzadania
- [ ] Grupy, kotwice, kolejka, uchwyt + testy – S
- [ ] Dokumentacja, przykład – S

---

### Z-12.06 – Menu użytkownika: trwałe pozycje

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja |
| Priorytet / ryzyko | Ś / niskie |
| Ustawienie | brak (`editorTheme.userMenu: false` – menu nie istnieje, API zwraca `null`) |
| Zależności | 03, 08 |
| Pliki | `ec/user.js:244-292` |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE**.
- `updateUserMenu()` (`ec/user.js:244-277`) usuwa wszystkie `li` i buduje menu od nowa przy logowaniu z trybu anonimowego
  (`:253-258`) oraz po `login({updateMenu:true})` (`:105-107`) – dopisane pozycje znikają.
- Menu tworzone tylko gdy `RED.settings.user` i `editorTheme.userMenu !== false` (`:280-290`).
- **Uzupełnienie bezpieczeństwa:** nazwa użytkownika jako HTML (`:265`) – patrz Ustalenia przekrojowe p. 3; **R-08: osobna poprawka teraz** (poza Z-12; Z-12.06 bazuje na tej poprawce).
  **Zrealizowane (F1, 2026-10-03): `bac427e`** – nazwa użytkownika escapowana (`RED.utils.sanitize`) w menu i w powiadomieniu „loggedInAs” (`:255`, ten sam błąd); `login({updateMenu:true})` odświeża `RED.settings.user` (`refreshSettings`) przed przebudową menu (R-41; naprawione w `user.js`, bo tam leżała przyczyna); testy `test/unit/@node-red/editor-client/user_spec.js`.
- **Uzupełnienie:** po ponownym logowaniu po wygaśnięciu sesji (`ec/comms.js:96-105`) `RED.settings.user` nie jest
  odświeżane – menu i uprawnienia mogą dotyczyć poprzedniego użytkownika; **rozstrzygnięte (R-41):** naprawiane razem
  z poprawką R-08 (poza Z-12; test, który pada bez poprawki); Z-12.06 i Z-12.08 bazują na tej poprawce.

#### Specyfikacja
- **Cel:** pozycje pluginów zachowane przy przebudowie menu.
- **Wejścia:** `{id, label, icon?, onselect, when?: "authenticated"|"anonymous"|"always", permission?, position?: "top"|"bottom"}`.
- **Wyjścia:** pozycje dodawane przy każdej przebudowie po pozycjach core (lub przed „Wyloguj” – `position`).
- **Niezmienniki:** pozycje core i ich kolejność bez zmian.
- **Przypadki błędów:** duplikat `id` → ostrzeżenie; menu wyłączone → `null`.
- **Skutki uboczne:** brak.

#### Projekt API
```js
/** @returns {{remove:function}|null} */
RED.user.addMenuItem({ id, label, icon, onselect, when, permission, position })
RED.user.removeMenuItem(id)
```
- Rejestr pozycji w `ec/user.js` (tablica), funkcja `buildUserMenuModel(user, registry)` (czysta – lista pozycji core +
  pluginów wg `when`/`permission`); `updateUserMenu` renderuje model. Przy okazji: nazwa użytkownika renderowana jako tekst.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Trwałe pozycje menu użytkownika

  Scenariusz: Pozycja przetrwa ponowne logowanie
    Zakładając pozycję "Zmień hasło" dodaną przez plugin
    Kiedy wyloguję się z trybu anonimowego do zalogowanego (przebudowa menu)
    Wtedy pozycja "Zmień hasło" jest nadal w menu użytkownika

  Scenariusz: Pozycja tylko dla zalogowanych
    Zakładając pozycję z when "authenticated"
    Kiedy użytkownik jest anonimowy
    Wtedy pozycja nie jest widoczna

  Scenariusz: Nazwa użytkownika jako tekst (regresja osobnej poprawki R-08)
    Zakładając użytkownika o nazwie "<img src=x onerror=alert(1)>"
    Wtedy menu pokazuje nazwę dosłownie i żaden skrypt nie jest wykonany

  # + wspólne scenariusze odbioru (api = RED.user.addMenuItem)
```

#### Testy
- `test/unit/@node-red/editor-client/user_menu_spec.js`: `model contains plugin items after rebuild`, `when filter`,
  `permission filter`, `position before logout`, `duplicate id`.

#### DoD specyficzne
- [ ] Przykład: `editor-extensions-example/user-menu.js` („Wyloguj wszystkie sesje” przez `RED.api.request` – 12).

#### Ryzyka i alternatywy
- Niskie. Alternatywa: zdarzenie `user:menu-rebuilt` – wymagałoby od dodatków ponownego dodawania (gorsze).

#### Podzadania
- [ ] Rejestr, model, render, testy – S
- [ ] Dokumentacja, przykład – S

---

### Z-12.07 – Nagłówek: przycisk lub plakietka

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja |
| Priorytet / ryzyko | N / niskie |
| Ustawienie | brak |
| Zależności | 03 |
| Pliki | `ec/red.js:902-925` (`buildEditor`, logo), `ec/ui/deploy.js:57-98` (`prependTo(".red-ui-header-toolbar")`), `ec/user.js:283-284`, `ec/ui/notifications.js:330`, `ea/editor/theme.js:330-347` |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE**.
- `editorTheme.header` – tylko tytuł/obraz/adres (`theme.js:330-347`, render `red.js:913-925`).
- Elementy core dopisywane jQuery do `ul.red-ui-header-toolbar` (`prependTo` w `deploy.js`, `user.js:283`,
  `notifications.js:330`; `appendTo` menu `red.js:839`) – kolejność wynika z kolejności `init`.
- Pasek narzędzi ukryty do końca `completeLoad` (`red.js:676`).

#### Specyfikacja
- **Cel:** przycisk/plakietka w nagłówku z kontrolą położenia i aktualizacją.
- **Wejścia:** `{id, label?, icon?, element?, title?, onclick?, position: "left"|"right", priority?: number}`
  (`left` = obok logo/tytułu, `right` = pasek narzędzi, przed przyciskiem Wdróż).
- **Wyjścia:** uchwyt `{update(partialOpts), setVisible(b), remove()}`.
- **Niezmienniki:** elementy core i ich kolejność bez zmian; brak `html` w postaci łańcucha – tylko `label` (tekst) lub
  `element` (węzeł DOM utworzony przez plugin).
- **Przypadki błędów:** duplikat `id` → ostrzeżenie, odrzucenie; wyjątek w `onclick` → złapany, zalogowany.
- **Skutki uboczne:** nowy moduł `ec/ui/header.js` (+ `concatEditor`), styl `red-ui-header-item`.

#### Projekt API
```js
/** @returns {{update:function(Object), setVisible:function(boolean), remove:function}|null} */
RED.header.addItem({ id, label, icon, element, title, onclick, position, priority })
RED.header.removeItem(id)
```
- Porządek wg `priority` (rosnąco), przy równym – kolejność rejestracji; czysta funkcja `orderItems(items)`.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Elementy nagłówka

  Scenariusz: Kolejność wg priorytetu
    Zakładając dwa pluginy dodające elementy z priorytetami 20 i 10 w odwrotnej kolejności ładowania
    Wtedy element z priorytetem 10 jest przed elementem z priorytetem 20

  Scenariusz: Aktualizacja plakietki
    Kiedy plugin wywoła update({label:"PROD"}) na uchwycie
    Wtedy element pokazuje "PROD" bez ponownego dodawania

  Scenariusz: Błąd w onclick
    Zakładając element, którego onclick zgłasza wyjątek
    Kiedy kliknę element
    Wtedy błąd jest w konsoli, a edytor działa dalej

  # + wspólne scenariusze odbioru (api = RED.header.addItem)
```

#### Testy
- `test/unit/@node-red/editor-client/ui/header_spec.js`: `orders items by priority`, `rejects duplicate id with warning`,
  `remove() detaches item`, `update merges options`, `handler exception is caught` (zgodnie z kartą Z-12 w etap-4.md).

#### DoD specyficzne
- [ ] Przykład: `editor-extensions-example/header.js` (oznaczenie środowiska).

#### Ryzyka i alternatywy
- Szerokość nagłówka na wąskich ekranach – dokumentacja zaleca krótkie etykiety; element `left` ukrywany < 600 px (do potwierdzenia).
- Migracja elementów core na `RED.header` – **poza zakresem** (ryzyko regresji).

#### Podzadania
- [ ] Moduł `RED.header` + porządek + testy – M
- [ ] Dokumentacja, przykład – S

---

### Z-12.08 – Uprawnienia użytkownika w edytorze i serwerze

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja (edytor **i** serwer) |
| Priorytet / ryzyko | W / **wysokie** (bezpieczeństwo, zgodność wstecz konfiguracji `adminAuth`) |
| Ustawienie | brak nowego przełącznika: nowe zakresy działają tylko, gdy użyte w `adminAuth.users[].permissions` / `default.permissions`; atrybuty – pole `attributes` obiektu użytkownika |
| Zależności | E-01 (kontrola typów w potoku wdrożenia – krok 2a ZASADY §2.3 A, zmiana potoku – R-27), 04/05/06/09 (korzystają z `permission`), E-03; ~~Z-06 jako alternatywa~~ – odrzucona (R-27) |
| Pliki | `ea/auth/permissions.js:19-61`, `ec/user.js:294-345`, `ea/auth/index.js:61-78`, `ea/admin/index.js:43-97`, `ea/editor/index.js:75-116`, `ea/auth/strategies.js:84-110,163-170`, `ea/auth/tokens.js:134-175`, `rt/api/settings.js:76-87`, `ec/ui/deploy.js:180-190,405-414`, `ec/ui/view.js:1316`, `ec/red.js:818-821,851-855`, `ec/ui/clipboard.js:1288-1291`, `ec/ui/palette.js:533-550`, `ec/ui/typeSearch.js:421-440` |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE** (z uzupełnieniami istotnymi dla projektu).
- **Model uprawnień (serwer, `ea/auth/permissions.js:22-61`, klient identycznie `ec/user.js:306-345`):** zakres to łańcuch
  lub tablica; dopasowanie: `"*"` – wszystko; równość dokładna; `"read"`/`"*.read"` → każde `x.read`; `"write"`/`"*.write"`
  → każde `x.write` (regex `^((.+)\.)?write$`); tablica wymaganych = wszystkie; tablica posiadanych = którykolwiek.
  **Brak hierarchii i brak odbierania** – nowy zakres np. `flows.deploy` nie byłby przyznany użytkownikom z `"write"`
  (nie kończy się na `.write`) → naiwne dodanie złamałoby zgodność wstecz.
- **Egzekucja serwera:** `needsPermission` (`ea/auth/index.js:61-78`) sprawdza `req.authInfo.scope` (zakres **tokena**,
  ustalony przy logowaniu: `strategies.js:86-90`, zapis `tokens.js:139-145`); bez `adminAuth` – brak kontroli.
  Wdrożenie = `POST /flows`, `POST /flow`, `PUT/DELETE /flow/:id` → `flows.write` (`ea/admin/index.js:44,54-56`);
  start/stop flow `POST /flows/state` → `flows.write` (`:49`); instalacja modułów `POST/PUT/DELETE /nodes…` →
  `nodes.write` (`:65-76`); biblioteka `library.write` (`ea/editor/index.js:101`).
- **Edytor:** `hasPermission` używa `RED.settings.user.permissions` (= `user.permissions`, `rt/api/settings.js:82`), nie zakresu
  tokena (w praktyce równe, bo edytor loguje się ze `scope:""`, `ec/user.js:93`). Sprawdzenia: Wdróż – `flows.write`
  (`deploy.js:183-187,411`); `canEdit` w `view.js:1316` dotyczy **tylko przycisku edycji w okienku adnotacji**, nie całego
  obszaru roboczego – użytkownik bez `flows.write` może edytować lokalnie (nie może wdrożyć); ustawienia użytkownika –
  `settings.write` (`userSettings.js:32`).
- **Menedżer palety:** UI zależy tylko od `externalModules.palette.allowInstall` (`red.js:818-821,851-855`) – **nie** sprawdza
  `nodes.write`, mimo że serwer go egzekwuje. Czyli „`palette.manage`” istnieje po stronie serwera jako `nodes.write`.
- Statyczne `editorTheme.menu["menu-item-…"]` (`menu.js:91`) – potwierdzone; `RED.settings.user` – tylko 4 pola
  (`rt/api/settings.js:82`) – potwierdzone; brak zdarzenia „uprawnienia ustalone” – potwierdzone (`login` emitowane tylko
  przy przejściu z trybu anonimowego, `user.js:257`).
- Ukrycie typu w palecie (`palette.js:533`) nie dotyczy szybkiego dodawania (`typeSearch.js:421-440` nie sprawdza ukrycia –
  **do potwierdzenia** w E2E), importu ani wklejania.
- Eksport (`core:show-export-dialog`, `clipboard.js:1288`) i import działają lokalnie; **serwer nie może ich egzekwować**
  – użytkownik z `flows.read` pobiera całość przez `GET /flows`.

#### Specyfikacja
- **Cel:** szczegółowe uprawnienia sprawdzane przez wbudowane elementy UI **i** – tam gdzie to możliwe – egzekwowane przez
  serwer; zdarzenie ustalenia uprawnień; dodatkowe atrybuty użytkownika w edytorze.
- **Wejścia:** `permissions` użytkownika w `adminAuth` (łańcuch/tablica) z nowymi nazwami i wpisami odbierającymi; pole
  `attributes` obiektu użytkownika zwracanego przez `adminAuth.users`/`authenticate`.
- **Wyjścia:** wynik `hasPermission` (serwer/klient), 401/403 z Admin API, widoczność/blokada elementów UI,
  `RED.settings.user.attributes`, zdarzenie `user:permissions`.
- **Niezmienniki (zgodność wstecz):** każda istniejąca konfiguracja (`"*"`, `"read"`, `["flows.read","flows.write"]` itd.)
  daje identyczne wyniki dla wszystkich istniejących tras i elementów UI; nowe zakresy są **domyślnie przyznane** przez
  zakres-rodzica (implikacja); ograniczenie wymaga jawnego wpisu odbierającego.
- **Przypadki błędów:** odmowa na serwerze → jak dziś `401` + `log.audit permission.fail` (`ea/auth/index.js:71-72`);
  nowa kontrola typów przy wdrożeniu → `403 { code: "node_type_not_permitted", message, types:[…] }` (kod do dopisania
  w katalogu ZASADY §2.4); nieprawidłowy wpis uprawnień (np. `"!"`) → ostrzeżenie w logu przy starcie, wpis ignorowany.
- **Skutki uboczne:** zmiana `permissions.js` (moduł współdzielony przez wszystkie trasy i `RED.auth.needsPermission`
  dla węzłów); zmiana kontraktu `GET settings` (nowe pole `user.attributes`).

#### Projekt API
**1. Rozszerzenie modelu (serwer + klient, ta sama tabela reguł):**

| Uprawnienie | Rodzic (implikacja) | Egzekucja serwera | Element UI |
|---|---|---|---|
| `flows.deploy` | `flows.write` | **tak** – trasy wdrożenia wymagają `["flows.write","flows.deploy"]` (oba; posiadacz `flows.write` spełnia oba) | przycisk/menu Wdróż, `core:deploy-flows`, restart flow |
| `flows.import` | `flows.write` | nie (import lokalny); faktyczną barierą jest `flows.deploy` | menu/akcje importu, wklejanie z zewnątrz |
| `flows.export` | `flows.read` | **nie da się** (dane dostępne przez `GET /flows`) – **utrudnienie, nie zabezpieczenie** | menu/akcje eksportu, kopiowanie do schowka systemowego, eksport do biblioteki |
| `palette.manage` | – | **zamiast nowej nazwy: istniejące `nodes.write`** (już egzekwowane) | menedżer palety, menu „Zarządzaj paletą” |
| `nodes.type.<typ>` | `flows.write` | **tak (R-27, L)** – przy wdrożeniu odrzucenie całego wdrożenia, gdy zawiera dodane/zmienione węzły typu bez uprawnienia | paleta, szybkie dodawanie, import/wklejanie (filtrowanie z komunikatem) |
| tryb tylko do odczytu | brak `flows.write` (istniejące) | **tak** (istniejące `flows.write`) | blokada edycji obszaru roboczego (nowe w UI; dziś tylko Wdróż) |

- **Wpisy odbierające:** element tablicy z prefiksem `!` (np. `["*", "!flows.export", "!nodes.type.exec"]`) odbiera
  uprawnienie i wszystkie mu podrzędne (model „implikacja + `!`” – **R-27**). **Listy typów węzłów (R-42) – obie:**
  (a) lista odbierająca – `["*", "!nodes.type.exec"]` (zakazane typy); (b) lista dozwolonych – `["!nodes.type.*",
  "nodes.type.inject", …]` (odebranie wszystkich typów + jawne przyznanie wybranych). **Reguła pierwszeństwa dla
  `nodes.type.*` (R-42):** (1) odebranie konkretnego typu (`!nodes.type.<typ>`) wygrywa ze wszystkim (także z
  `nodes.type.<typ>` w tej samej tablicy); (2) przyznanie konkretnego typu (`nodes.type.<typ>`) wygrywa z
  `!nodes.type.*`; (3) w pozostałych przypadkach – `!nodes.type.*` odbiera, w przeciwnym razie dziedziczenie z rodzica
  (`flows.write`). Istniejące konfiguracje nie zawierają `!`, więc ich wynik się nie zmienia.
- Sygnatury bez zmian: `permissions.hasPermission(userScope, permission)` (serwer), `RED.user.hasPermission(permission)`
  (klient); nowe: `RED.user.getPermissions() → Array<string>` (kopia), stała `RED.user.PERMISSIONS` (dokumentacja nazw).
- Reguła implikacji jako tabela w jednym miejscu na stronę (serwer `permissions.js`, klient `user.js`) i **wspólny plik
  przypadków** `test/resources/permissions-cases.json` uruchamiany przez testy obu stron (gwarancja zgodności).

**2. Zdarzenie i atrybuty:**
```js
/** Emitowane po każdym ustaleniu uprawnień: po RED.settings.load (start), po zalogowaniu z trybu anonimowego,
 *  po ponownym logowaniu po wygaśnięciu sesji (odświeżenie RED.settings.user – poprawka R-08/R-41, comms.js:96-105).
 *  Gwarancja: przed editor:ready przy starcie; plugin w onready może czytać RED.user.hasPermission synchronicznie.
 * @event user:permissions @param {{permissions:Array<string>, user:Object}} */
RED.events.on("user:permissions", fn);
/** Atrybuty z adminAuth: obiekt user.attributes (JSON, limit rozmiaru np. 8 KB – do potwierdzenia), tylko do odczytu. */
RED.settings.user.attributes
```
- Serwer: `rt/api/settings.js:82` – lista pól `["anonymous","username","image","permissions","attributes"]`;
  `attributes` kopiowane głęboko i tylko jeśli to zwykły obiekt JSON. **Zasada białej listy zostaje** – nigdy nie
  przekazujemy całego obiektu użytkownika (przy `adminAuth.users` obiekt z `Users.get` zawiera skrót hasła – `ea/auth/users.js:82`; usuwa go tylko `cleanUser`, `:120-122`, przy logowaniu).

**3. Kontrola typów przy wdrożeniu (w zakresie – R-27, tor A; zmiana potoku E-01):** w `rt/api/flows.js` (pod blokadą, krok 2a potoku E-01 – ZASADY §2.3 A,
po kontroli rewizji, przed `preDeploy`) porównanie nowej konfiguracji z aktywną; węzły dodane lub zmienione typu, do którego użytkownik nie ma
`nodes.type.<typ>` → `403 node_type_not_permitted` z `types[]` (ZASADY §2.4), bez zapisu. Węzły istniejące i niezmienione – dozwolone. Dotyczy wszystkich wejść potoku z użytkownikiem (`/flows`, `/flow`, `/flow/:id`); `reload` i przeładowanie z magazynu (Z-09) – **bez kontroli per użytkownik** (brak użytkownika; treść w magazynie pochodzi z kontrolowanych wdrożeń – **R-42**). Wymaga przekazania zakresu
użytkownika do runtime (`opts.user` jest już przekazywany do API runtime – do potwierdzenia, czy z zakresem tokena).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Szczegółowe uprawnienia edytora

  Scenariusz: Zgodność wstecz istniejących zakresów
    Zakładając użytkowników z uprawnieniami "*", "read", "write", ["flows.read","flows.write"]
    Kiedy wywołają każdą trasę Admin API
    Wtedy wynik autoryzacji jest identyczny jak w 5.0.7
    I tabela przypadków permissions-cases.json daje te same wyniki na serwerze i w edytorze

  Scenariusz: Edycja bez wdrażania – egzekucja serwera
    Zakładając użytkownika z uprawnieniami ["*","!flows.deploy"]
    Kiedy wyśle POST /flows bezpośrednio (z pominięciem edytora)
    Wtedy serwer odpowiada 401, a w logu audytu jest permission.fail
    I w edytorze przycisk Wdróż jest zablokowany

  Scenariusz: Ukrycie w UI to nie zabezpieczenie – eksport
    Zakładając użytkownika z ["*","!flows.export"]
    Wtedy pozycje i akcje eksportu są niedostępne w edytorze
    I dokumentacja stwierdza, że GET /flows nadal zwraca konfigurację (uprawnienie flows.read)

  Scenariusz: Menedżer palety wg nodes.write
    Zakładając użytkownika bez nodes.write
    Wtedy menu "Zarządzaj paletą" nie jest widoczne
    I POST /nodes zwraca 401 (jak w 5.0.7)

  Scenariusz: Zabroniony typ węzła
    Zakładając użytkownika z ["*","!nodes.type.exec"]
    Kiedy wklei flow zawierające węzeł exec i spróbuje wdrożyć
    Wtedy edytor ostrzega przy wklejaniu, a serwer odrzuca wdrożenie kodem node_type_not_permitted
    I istniejący niezmieniony węzeł exec nie blokuje wdrożenia innych zmian

  Scenariusz: Egzekucja serwerowa z pominięciem edytora (R-27)
    Zakładając użytkownika z ["*","!nodes.type.exec"] i aktywny flow z węzłem exec
    Kiedy wyśle POST /flows bezpośrednio ze zmienioną właściwością węzła exec
    Wtedy odpowiedź ma status 403 i kod node_type_not_permitted z types ["exec"]
    I magazyn i uruchomione flow pozostają bez zmian
    I hook preDeploy nie jest wywoływany

  Scenariusz: Lista dozwolonych typów (R-42)
    Zakładając użytkownika z ["*","!nodes.type.*","nodes.type.inject","nodes.type.debug"]
    Kiedy wyśle POST /flows z nowymi węzłami inject i debug
    Wtedy wdrożenie się powiedzie
    Kiedy wyśle POST /flows z nowym węzłem function
    Wtedy odpowiedź ma status 403 i kod node_type_not_permitted z types ["function"]

  Scenariusz: Odebranie konkretnego typu wygrywa ze wszystkim (R-42)
    Zakładając użytkownika z ["*","nodes.type.exec","!nodes.type.exec"]
    Kiedy wyśle POST /flows z nowym węzłem exec
    Wtedy odpowiedź ma status 403 i kod node_type_not_permitted z types ["exec"]

  Scenariusz: Przeładowanie z magazynu bez kontroli typów (R-42)
    Zakładając magazyn z flow zawierającym węzeł exec, zapisany przez innego użytkownika
    Kiedy instancja przeładuje flow z magazynu (Z-09) lub wykona wdrożenie typu reload
    Wtedy kontrola nodes.type nie jest wykonywana

  Scenariusz: Tryb tylko do odczytu
    Zakładając użytkownika z uprawnieniem "read"
    Wtedy obszar roboczy nie pozwala dodawać, przesuwać ani usuwać węzłów

  Scenariusz: Zdarzenie user:permissions i atrybuty
    Zakładając użytkownika z attributes {"department":"ops"}
    Kiedy edytor wystartuje
    Wtedy user:permissions jest emitowane przed editor:ready
    I RED.settings.user.attributes.department = "ops", a RED.settings.user nie zawiera pola password

  # + wspólne scenariusze odbioru (api = zakresy, user:permissions, attributes)
```

#### Testy
- `test/unit/@node-red/editor-api/lib/auth/permissions_spec.js`: przypadki z `permissions-cases.json`: `implied by parent`,
  `negation wins`, `wildcard negation nodes.type.*`, `specific grant wins over !nodes.type.*` (R-42),
  `specific negation wins over specific grant` (R-42), `allow-list ["!nodes.type.*", "nodes.type.inject"]` (R-42),
  `legacy scopes unchanged`, `invalid entry ignored`.
- `test/unit/@node-red/editor-client/user_permissions_spec.js`: ten sam plik przypadków dla `RED.user.hasPermission`.
- `test/unit/@node-red/editor-api/lib/admin/flows_spec.js`, `flow_spec.js`: `deploy denied with !flows.deploy`, `legacy write allowed`.
- `test/unit/@node-red/runtime/lib/api/settings_spec.js`: `exposes attributes`, `never exposes password`, `rejects non-plain attributes`.
- `test/unit/@node-red/runtime/lib/api/flows_spec.js`: `rejects added node of denied type`, `rejects changed node of denied type` (R-27), `allows unchanged denied node`, `type check runs after revision check and before preDeploy` (krok 2a), `403 body contains types[]`, `allow-list permits granted types only` (R-42), `reload and storage reload skip type check` (R-42).
- Edytor (logika): `deploy_permissions_spec.js` – model stanów przycisku Wdróż wg uprawnień (wydzielony z `deploy.js`, E-03).
- E2E (osobny podzbiór): matryca użytkowników × elementy UI.

#### DoD specyficzne
- [ ] Przegląd bezpieczeństwa z listą: które uprawnienia są egzekwowane na serwerze, a które są tylko UI (tabela w dokumentacji).
- [ ] Szablon `settings.js`: przykład `permissions` z wpisami odbierającymi i `attributes` (zakomentowane).
- [ ] Kontrakt `GET settings` (pole `user.attributes`) opisany i przetestowany.
- [ ] Kod błędu `node_type_not_permitted` w katalogu ZASADY §2.4.
- [ ] Przykład: `editor-extensions-example/permissions.js` (reakcja na `user:permissions`, bez selektorów DOM).

#### Ryzyka i alternatywy
- **Ukrycie w UI ≠ zabezpieczenie** – dokumentacja i kryteria odbioru jawnie rozróżniają; eksport/import/ukrycie obszaru
  roboczego to wyłącznie UX.
- **Zmiana współdzielonego `permissions.js`** – wpływa na `RED.auth.needsPermission` w węzłach (trasy `httpAdmin`); tabela
  przypadków chroni przed regresją.
- **Zakres tokena utrwalony przy logowaniu** – zmiana uprawnień w `adminAuth` działa po ponownym zalogowaniu (jak dziś); opis.
- **Kontrola typów** wymaga dostępu runtime do zakresu użytkownika i porównania konfiguracji – L; **rozstrzygnięte (R-27): egzekucja serwerowa w potoku E-01** (alternatywa „hook `preDeploy`” odrzucona).
- Alternatywa dla `!`: osobne pole `restrictions` w obiekcie użytkownika – **odrzucona (R-27)**.
- `flows.export` – **tylko utrudnienie** (R-27); dokumentacja to stwierdza.

#### Podzadania
- [ ] Model: implikacje + odbieranie (serwer + klient) + wspólna tabela przypadków – M
- [ ] Trasy wdrożenia `flows.deploy` + testy kontraktu – S
- [ ] Wbudowane elementy UI (Wdróż, import/eksport, paleta `nodes.write`, tryb tylko do odczytu) + testy logiki – M
- [ ] `user:permissions`, `attributes` – M (odświeżenie `RED.settings.user` po ponownym logowaniu – w poprawce R-08, **R-41**)
- [ ] Kontrola `nodes.type.<typ>` przy wdrożeniu (runtime, krok 2a potoku E-01) – L (**w zakresie – R-27**)
- [ ] Dokumentacja, przykład, E2E – M

---

### Z-12.09 – Paleta: kolejność, etykiety, ukrywanie

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja |
| Priorytet / ryzyko | Ś / średnie |
| Ustawienie | `editorTheme.palette.nodeOrder: { "<kategoria>": ["typ1","typ2"] }`, `editorTheme.palette.categoryLabels: { "<kategoria>": "Etykieta" }` |
| Zależności | 08 (ukrywanie typów wg `nodes.type.<typ>`) |
| Pliki | `ec/ui/palette.js:40-70,284-330,533-550,735-830`, `ea/editor/theme.js:199-230,383-391`, `ec/ui/typeSearch.js` |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE**.
- Kolejność kategorii: `paletteCategories` lub `editorTheme.palette.categories` (`order`, `descriptions`, `nodeOverrides`)
  – `palette.js:742-760`; `RED.palette.hide/show(type)` – `:533-550` (tylko widok, nietrwałe).
- Etykieta kategorii z katalogu i18n `<ns>:palette.label.<kategoria>` (`palette.js:45,53`) – nie z ustawień.
- Kolejność węzłów w kategorii – brak (kolejność dodawania).
- `editorTheme.palette` z `settings.js` przechodzi do edytora w całości (`theme.js:383-391`), a z wtyczki motywu
  scalane są tylko `theme` i `categories` (`theme.js:199-230`) → nowe klucze z `settings.js` nie wymagają zmiany serwera,
  z wtyczki motywu – wymagają.

#### Specyfikacja
- **Cel:** kolejność węzłów w kategorii, etykiety kategorii z ustawień, ukrycie typów zależne od uprawnień.
- **Wejścia:** `nodeOrder`, `categoryLabels`; uprawnienia z 08.
- **Wyjścia:** paleta uporządkowana; typy bez uprawnienia niewidoczne w palecie **i** w szybkim dodawaniu.
- **Niezmienniki:** bez nowych kluczy – paleta jak w 5.0.7; typy nieujęte w `nodeOrder` – po wymienionych, w dotychczasowej
  kolejności; etykieta z `categoryLabels` ma pierwszeństwo przed i18n (tekst, bez HTML).
- **Przypadki błędów:** nieznany typ w `nodeOrder` – ignorowany; nieprawidłowy format – ostrzeżenie w konsoli, klucz ignorowany.
- **Skutki uboczne:** scalanie nowych kluczy z wtyczki motywu w `theme.js`.

#### Projekt API
- Ustawienia jak wyżej (szablon `settings.js`); czysta funkcja `sortCategoryNodes(types, order)` i `resolveCategoryLabel(cat, labels, i18n)`.
- Ukrywanie: `RED.palette.isTypeAllowed(type)` = `RED.user.hasPermission("nodes.type."+type)`; używane w `addNodeType`,
  `typeSearch` i przy imporcie (ostrzeżenie, 08). Egzekucja – wyłącznie wg 08.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Konfiguracja palety

  Scenariusz: Kolejność węzłów w kategorii
    Zakładając nodeOrder {"common": ["debug","inject"]}
    Wtedy w kategorii common debug jest przed inject, a pozostałe węzły po nich

  Scenariusz: Etykieta kategorii z ustawień
    Zakładając categoryLabels {"function": "Logika"}
    Wtedy nagłówek kategorii function to "Logika"

  Scenariusz: Typ bez uprawnienia
    Zakładając użytkownika z ["*","!nodes.type.exec"]
    Wtedy exec nie jest widoczny w palecie ani w szybkim dodawaniu
    I wdrożenie nowego węzła exec jest odrzucane przez serwer (08)

  # + wspólne scenariusze odbioru (api = editorTheme.palette.nodeOrder/categoryLabels)
```

#### Testy
- `test/unit/@node-red/editor-client/ui/palette_order_spec.js`: `orders listed types first`, `ignores unknown`, `label precedence`.
- `test/unit/@node-red/editor-api/lib/editor/theme_spec.js`: `merges nodeOrder/categoryLabels from theme plugin`.

#### DoD specyficzne
- [ ] Szablon `settings.js` (zakomentowane przykłady).
- [ ] Przykład: konfiguracja + plugin sprawdzający `RED.palette.isTypeAllowed`.

#### Ryzyka i alternatywy
- Ukrycie bez 08 jest wyłącznie kosmetyczne – zaznaczone w dokumentacji; z 08 serwer egzekwuje `nodes.type.<typ>` przy wdrożeniu (R-27).
- Alternatywa dla `categoryLabels`: katalog i18n w module dodatku – działa już dziś, ale wymaga modułu.

#### Podzadania
- [ ] `nodeOrder`, `categoryLabels` + testy + scalanie w `theme.js` – M
- [ ] Ukrywanie wg uprawnień (paleta, szybkie dodawanie) – S
- [ ] Dokumentacja, przykład – S

---

### Z-12.10 – Głęboki link, akcja `reveal-node` i `postMessage`

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja |
| Priorytet / ryzyko | Ś / **średnie–wysokie** (kanał `postMessage`) |
| Ustawienie | `editorTheme.embedding.allowedOrigins` (nazwa wg R-28, **R-33** i ZASADY §2.1 – zastępuje wcześniejsze `editorTheme.embedding.postMessage.allowedOrigins`); lista obejmuje także istniejący kanał `set-theme` (R-28). Brak ustawienia = zachowanie 5.0.7 (`set-theme` bez kontroli źródła, nowy kanał nieaktywny) + ostrzeżenie w logu przy starcie; ustawiona lista – tylko wymienione źródła (**R-35**) |
| Zależności | 03 |
| Pliki | `ec/red.js:244-302`, `ec/ui/workspaces.js:350-366`, `ec/ui/view.js:7921`, `ec/ui/actions.js:6-56`, `ec/ui/userSettings.js:450-457`, `ea/editor/theme.js:380-420` |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **CZĘŚCIOWO**.
- `RED.view.reveal(id)` (`view.js:7921`) – potwierdzone.
- Adres obsługiwany tylko przy wczytaniu flow (`red.js:244-302`): formaty **`#flow/<id>`**, `#node/<id>`, `#group/<id>`, każdy
  z opcjonalnym `/edit`. **Różnica względem załącznika:** format z identyfikatorem flow istnieje (`#flow/<id>`, `:256-262`);
  brakuje formatu łączonego `#flow/<flowId>/node/<nodeId>` – **rozstrzygnięte (R-28): nowy format w zakresie**.
- Brak `hashchange` (grep w `ec/`); edytor sam ustawia `#flow/<id>` przy zmianie zakładki (`workspaces.js:354,365`) –
  obsługa `hashchange` musi ignorować zmiany wywołane przez edytor (pętla).
- Brak akcji `core:reveal-node`; `RED.actions.invoke(name, ...args)` przekazuje argumenty (`actions.js:49-56`).
- **Istniejący kanał `postMessage`:** w ramce edytor nasłuchuje `message` typu `set-theme` **bez sprawdzenia `event.origin`**
  i wysyła `request-theme` z `targetOrigin '*'` (`userSettings.js:450-457`) – niskie ryzyko (tylko motyw), ale nowy kanał
  nie może powielać tego wzorca; **rozstrzygnięte (R-28): `set-theme` objęty `editorTheme.embedding.allowedOrigins`**.
- Nowy klucz `editorTheme` musi zostać jawnie przepisany w `theme.js` (lista kluczy `:380-420`) – zmiana serwera (mała).

#### Specyfikacja
- **Cel:** nawigacja do bloczka w trakcie sesji (adres, akcja), bezpieczny kanał dla edytora w ramce.
- **Wejścia:** zmiana `location.hash` (formaty istniejące oraz nowy `#flow/<flowId>/node/<nodeId>[/edit]` – R-28); `RED.actions.invoke("core:reveal-node", {id, edit?})`; komunikat
  `{type:"node-red:reveal-node", id, edit?}` z dozwolonego źródła.
- **Wyjścia:** przejście do flow, zaznaczenie, opcjonalnie okno edycji; odpowiedź `postMessage`
  `{type:"node-red:result", requestId, ok, error?}` do `event.origin`.
- **Niezmienniki:** zachowanie przy pierwszym wczytaniu jak dziś; bez ustawienia `allowedOrigins` edytor nie rejestruje
  nasłuchu nowego kanału; kanał `set-theme` sprawdza `event.origin` wg tej samej listy (R-28); **bez ustawienia – `set-theme` jak w 5.0.7 (bez kontroli źródła) + ostrzeżenie w logu przy starcie serwera; przy ustawionej liście – tylko wymienione źródła (R-35)**; kanał obsługuje **wyłącznie** zamkniętą listę typów komunikatów (bez wywoływania dowolnych akcji –
  np. `core:deploy-flows` nie jest dostępne).
- **Przypadki błędów:** nieznany id → powiadomienie „nie znaleziono” (tekst), odpowiedź `ok:false, error:"not_found"`;
  źródło spoza listy / `event.source !== window.parent` → komunikat ignorowany (log `debug`); nieprawidłowy kształt → ignorowany.
- **Skutki uboczne:** nowy moduł `ec/ui/navigation.js` (parser + obsługa), klucz w `theme.js`.

#### Projekt API
```js
/** @action core:reveal-node @param {{id:string, edit?:boolean}} args */
RED.actions.invoke("core:reveal-node", { id: "abc", edit: true });
/** Czysta funkcja (obsługuje m.in. #flow/<flowId>/node/<nodeId> – R-28): @returns {{type:"flow"|"node"|"group", id:string, flowId?:string, edit:boolean}|null} */
RED.navigation.parseLocationHash(hash)   // przestrzeń RED.navigation – nazwa do potwierdzenia (alternatywa: RED.view)
```
- `postMessage`: dokładne porównanie `event.origin` z listą (bez `*` i wzorców); tylko komunikaty z `window.parent`
  (edytor osadzony); odpowiedzi zawsze z `targetOrigin = event.origin`. Rejestracja nasłuchu po `editor:ready`.
- Rekomendacja wdrożeniowa (dokumentacja): ograniczenie osadzania nagłówkiem `Content-Security-Policy: frame-ancestors`
  przez `httpAdminMiddleware` – dziś edytor nie ustawia takiego nagłówka (**do potwierdzenia**).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Nawigacja do bloczka

  Scenariusz: Zmiana adresu w trakcie sesji
    Zakładając otwarty edytor
    Kiedy zmienię adres na #node/<id>/edit
    Wtedy edytor pokazuje flow z bloczkiem, zaznacza go i otwiera okno edycji

  Scenariusz: Link z identyfikatorem flow i bloczka (R-28)
    Kiedy otworzę adres #flow/<flowId>/node/<nodeId>
    Wtedy edytor przełącza na flow <flowId>, pokazuje i zaznacza bloczek <nodeId>

  Scenariusz: set-theme ze źródła spoza listy (R-28)
    Zakładając allowedOrigins ["https://app.example"]
    Kiedy komunikat set-theme przyjdzie z https://evil.example
    Wtedy motyw nie zostaje zmieniony

  Scenariusz: set-theme bez ustawienia działa jak w 5.0.7 (R-35)
    Zakładając brak editorTheme.embedding.allowedOrigins
    Kiedy komunikat set-theme przyjdzie z dowolnego źródła
    Wtedy motyw zostaje zmieniony jak w 5.0.7
    I przy starcie serwera w logu jest ostrzeżenie o braku listy źródeł

  Scenariusz: Brak pętli przy zmianie zakładki
    Kiedy przełączę zakładkę flow (edytor ustawia #flow/<id>)
    Wtedy obsługa hashchange nie wykonuje dodatkowej nawigacji

  Scenariusz: Akcja z argumentem
    Kiedy plugin wywoła RED.actions.invoke("core:reveal-node", {id:"x"})
    Wtedy bloczek x jest pokazany i zaznaczony

  Scenariusz: postMessage domyślnie wyłączone
    Zakładając brak editorTheme.embedding
    Kiedy ramka nadrzędna wyśle {type:"node-red:reveal-node"}
    Wtedy edytor nie reaguje

  Scenariusz: Źródło spoza listy
    Zakładając editorTheme.embedding.allowedOrigins ["https://app.example"]
    Kiedy komunikat przyjdzie z https://evil.example
    Wtedy jest zignorowany

  Scenariusz: Niedozwolony typ komunikatu
    Kiedy dozwolone źródło wyśle {type:"node-red:invoke-action", name:"core:deploy-flows"}
    Wtedy komunikat jest zignorowany

  # + wspólne scenariusze odbioru (api = core:reveal-node, hashchange, embedding.postMessage)
```

#### Testy
- `test/unit/@node-red/editor-client/ui/navigation_spec.js`: `parses flow/node/group/edit`, `rejects malformed`,
  `parses flow/<flowId>/node/<nodeId>` (R-28), `ignores self-induced hash`, `origin allowlist exact match`, `set-theme checks origin allowlist` (R-28), `set-theme unchecked when allowedOrigins absent` (R-35), `rejects non-parent source`, `rejects unknown message type`.
- `test/unit/@node-red/editor-api/lib/editor/theme_spec.js`: `passes embedding settings`, `warns at startup when embedding.allowedOrigins absent` (R-35; ostrzeżenie po stronie serwera, log przy starcie – R-43; realizacji).
- E2E: strona testowa osadzająca edytor w ramce (dwa źródła).

#### DoD specyficzne
- [ ] Dokumentacja protokołu komunikatów (typy, odpowiedzi) i rekomendacji `frame-ancestors`.
- [ ] Szablon `settings.js`: `editorTheme.embedding.allowedOrigins` z opisem zachowania bez ustawienia (5.0.7 + ostrzeżenie) i zaleceniem ustawienia listy w naszych instalacjach (R-35).
- [ ] Przykład: strona osadzająca + plugin używający akcji.

#### Ryzyka i alternatywy
- **`postMessage` = zdalne sterowanie edytorem** – stąd domyślnie wyłączone, dokładna lista źródeł i zamknięta lista typów.
- Alternatywa: tylko `hashchange` (rodzic zmienia `src`/hash ramki) – bez nowego kanału; mniej funkcji (brak odpowiedzi).

#### Podzadania
- [ ] Parser + `hashchange` + akcja + testy – M
- [ ] Kanał `postMessage` + ustawienie `editorTheme.embedding.allowedOrigins` + objęcie `set-theme` (R-28) + testy – M
- [ ] Dokumentacja, przykład, E2E – S

---

### Z-12.11 – Subskrypcja kanału komunikacji (Z-01)

| Pole | Wartość |
|---|---|
| Etap / typ | realizowane w **Z-01** (poprawka błędu) |
| Priorytet / ryzyko | W / niskie |
| Ustawienie | brak |
| Zależności | **Z-01**, E-03 |
| Pliki | `ec/comms.js:59-106,175-183`; serwer `ea/editor/comms.js:110-112,149-165` (WERYFIKACJA §Z-01) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE** – `subscribe()` wysyła przy `readyState==1` bez sprawdzenia `pendingAuth` (`ec/comms.js:180-182`);
po `auth ok` `completeConnection()` (`:62-69`) odtwarza subskrypcje. Plugin z `onadd` – `RED.comms.connect()` jest wołane
przed `loadPluginList` (`red.js:896,932`), więc subskrypcja w `onadd` trafia w okno `pendingAuth`.

#### Specyfikacja
Jak w karcie Z-01 (nie wysyłać w `subscribe()` podczas `pendingAuth`). Uzupełnienie dla Z-12: dokumentacja gwarancji
„`RED.comms.subscribe` można wołać w `onadd`/`onready`; subskrypcja zostanie wysłana po uwierzytelnieniu i odtworzona po
ponownym połączeniu”.

#### Projekt API
Bez nowego API; JSDoc `RED.comms.subscribe(topic, callback)` / `unsubscribe` z opisem gwarancji.

#### Kryteria akceptacji (BDD)
```gherkin
Scenariusz: Subskrypcja w onadd przy włączonym adminAuth
  Zakładając plugin subskrybujący temat w onadd
  Kiedy edytor połączy się z serwerem wymagającym uwierzytelnienia
  Wtedy połączenie nie jest zamykane, a plugin otrzymuje komunikaty tematu
# + wspólne scenariusze odbioru (dokumentacja RED.comms.subscribe, przykład w editor-extensions-example)
```

#### Testy
`test/unit/@node-red/editor-client/comms_spec.js` (Z-01): `does not send subscribe while auth pending`, `replays after auth ok`.

#### DoD specyficzne
- [ ] Odbiór w Z-01; w Z-12 tylko dokumentacja i przykład.

#### Ryzyka i alternatywy
Brak dodatkowych.

#### Podzadania
- [ ] Dokumentacja gwarancji + przykład – S (kod w Z-01)

---

### Z-12.12 – Wywołania API serwera z pluginu

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja |
| Priorytet / ryzyko | W / **wysokie** (token w nagłówku) |
| Ustawienie | brak (nowe pole tylko do odczytu `RED.settings.httpAdminRoot`) |
| Zależności | 01 (hook `loginFailed`/`loginPost` zamiast globalnych zdarzeń jQuery), 02 |
| Pliki | `ec/settings.js:109-161`, `ec/red.js:953-966` (`apiRootUrl`), `ec/comms.js:42-57`, `rt/api/settings.js:76-79`, `ea/auth/index.js:104-107` |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE**.
- `$.ajaxSetup.beforeSend` (`ec/settings.js:145-159`) dokleja `Authorization` i `Node-RED-API-Version: v2` tylko dla ścieżek
  względnych (regex `^\s*(https?:|\/|\.)`), dopisując `RED.settings.apiRootUrl`; `fetch` nie dostaje nagłówka.
- `httpAdminRoot` nie jest przekazywany (`rt/api/settings.js:76-79`: `httpNodeRoot`, `version`); `RED.user.logout` – `ec/user.js:220`.
- **Uzupełnienie:** `RED.settings.apiRootUrl` może być adresem bezwzględnym (osadzenie edytora; `comms.js:42-47`) – bazą
  dla `RED.api.request` musi być `apiRootUrl`, a nie wyłącznie `location`.

#### Specyfikacja
- **Cel:** jedno wywołanie z uwierzytelnieniem i właściwą ścieżką bazową, oparte na `fetch`.
- **Wejścia:** `path` względna (np. `"flows"`, `"my-plugin/data"`), `options` jak `fetch` + `json`, `query`.
- **Wyjścia:** `Promise<{status, headers, data}>` (JSON parsowany, gdy `content-type` JSON), odrzucenie z
  `{status, code?, message, data}` dla statusów ≥ 400.
- **Niezmienniki:** token dołączany **wyłącznie** dla adresów, których rozwiązany URL ma to samo `origin` i zaczyna się od
  ścieżki bazowej instancji (`apiRootUrl` lub katalogu strony edytora); zachowanie `$.ajax` bez zmian.
- **Przypadki błędów:** ścieżka bezwzględna (`https://…`, `//host`, `/inna`), wyjście poza bazę (`../`) → odrzucenie
  `Error("invalid_path")` **bez wysłania żądania**; 401 → zdarzenie i (opcjonalnie) okno logowania, potem jednokrotne
  ponowienie (opcja `retryOnLogin`, domyślnie `false` – do potwierdzenia); brak sieci → odrzucenie.
- **Skutki uboczne:** nowe pole `httpAdminRoot` w `GET settings` (ścieżka – niska wrażliwość, ale opisana w kontrakcie).

#### Projekt API
```js
/**
 * @param {string} path  ścieżka WZGLĘDNA wobec bazy Admin API instancji
 * @param {Object} [options]
 * @param {string} [options.method="GET"]
 * @param {Object|string|FormData} [options.body]  obiekt → JSON (Content-Type: application/json)
 * @param {Object} [options.query]   parametry zapytania (kodowane)
 * @param {Object} [options.headers] (Authorization nie może być nadpisany)
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{status:number, headers:Headers, data:*}>}
 * @since 5.x (Z-12)
 */
RED.api.request(path, options)
RED.settings.httpAdminRoot   // np. "/admin/" – tylko do odczytu
```
- Moduł `ec/api.js` (+ `concatEditor` po `settings.js`); czyste funkcje `resolveApiUrl(base, path) → URL|Error` i
  `buildHeaders(tokens, headers)` – eksport do testów.
- Trasy `httpNode` (inny korzeń, inne uwierzytelnianie `httpNodeAuth`) – **poza** `RED.api.request`; dokumentacja wskazuje
  zwykły `fetch` z `RED.settings.httpNodeRoot` (bez tokena edytora).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Wywołania API z pluginu

  Scenariusz: Wywołanie Admin API z uwierzytelnieniem
    Zakładając zalogowanego użytkownika i httpAdminRoot "/admin"
    Kiedy plugin wywoła RED.api.request("flows")
    Wtedy żądanie trafia do /admin/flows z nagłówkami Authorization i Node-RED-API-Version
    I wynik zawiera sparsowany JSON

  Scenariusz: Brak wycieku tokena do obcej domeny
    Kiedy plugin wywoła RED.api.request("https://evil.example/x") albo RED.api.request("//evil.example/x")
    Wtedy Promise jest odrzucony błędem invalid_path, a żadne żądanie sieciowe nie jest wysłane

  Scenariusz: Wyjście poza bazę instancji
    Kiedy plugin wywoła RED.api.request("../inna-instancja/flows")
    Wtedy Promise jest odrzucony błędem invalid_path

  Scenariusz: Błąd HTTP
    Kiedy serwer odpowie 409 {code:"version_mismatch"}
    Wtedy Promise jest odrzucony obiektem z status 409 i code "version_mismatch"

  Scenariusz: httpAdminRoot w ustawieniach edytora
    Wtedy RED.settings.httpAdminRoot odpowiada ustawieniu serwera

  # + wspólne scenariusze odbioru (api = RED.api.request, RED.settings.httpAdminRoot)
```

#### Testy
- `test/unit/@node-red/editor-client/api_spec.js`: `resolves relative path`, `rejects absolute`, `rejects protocol-relative`,
  `rejects traversal`, `uses absolute apiRootUrl origin`, `adds auth only when token`, `cannot override Authorization`,
  `maps error body` (`global.fetch` jako atrapa `sinon`).
- `test/unit/@node-red/runtime/lib/api/settings_spec.js`: `includes httpAdminRoot`.

#### DoD specyficzne
- [ ] Kontrakt `GET settings` (nowe pole) opisany.
- [ ] Przykład: plugin wołający własną trasę `RED.httpAdmin` węzła/pluginu (powiązanie Z-02).

#### Ryzyka i alternatywy
- **Wyciek tokena** – jedyna dopuszczona baza; brak opcji „wyślij token gdziekolwiek”.
- Alternatywa: udokumentowanie `$.ajax` ze ścieżkami względnymi – działa dziś, ale nie obejmuje `fetch` i wiąże dodatki z jQuery.

#### Podzadania
- [ ] `RED.api.request` + czyste funkcje + testy – M
- [ ] `httpAdminRoot` w runtime + test – S
- [ ] Dokumentacja, przykład – S

---

### Z-12.13 – Okna modalne i panel pełnoekranowy

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja |
| Priorytet / ryzyko | Ś / średnie |
| Ustawienie | brak |
| Zależności | 03; spójność z `RED.tray` |
| Pliki | `ec/ui/common/popover.js:771-835` (`RED.popover.dialog`), `ec/ui/tray.js:229-260`, `ec/user.js:31-47` (okno jQuery UI), `ec/red.js:931-935` (`#red-ui-full-shade`, `#red-ui-global-dialog-container`), `ec/ui/keyboard.js` |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **CZĘŚCIOWO**.
- `RED.tray` (panel edycji), `RED.popover` – potwierdzone; okna jQuery UI (`user.js:31-47`) – wewnętrzne.
- **Uzupełnienie:** istnieje nieudokumentowane ogólne okno `RED.popover.dialog({title, content, buttons, closeButton})`
  (`popover.js:771-835`, użyte w `red.js:696`) – treść przez `.html()` (`:786`), brak obsługi Esc, pułapki fokusu,
  przywracania fokusu, stosu warstw; stała szerokość 500 px; `z-index: 2000`.
- Panel pełnoekranowy z ramką – brak.

#### Specyfikacja
- **Cel:** okno (formularz, potwierdzenie) i panel pełnoekranowy (ramka/treść) ze spójną obsługą warstw, Esc, fokusu.
- **Wejścia:** opcje poniżej.
- **Wyjścia:** uchwyt `{close(result), element}`; `confirm` → `Promise<boolean>`.
- **Niezmienniki:** `RED.popover.dialog` działa jak dziś (może zostać przepięty na nową implementację tylko bez zmiany
  wyglądu); skróty klawiaturowe edytora wyłączone, gdy okno otwarte (`RED.keyboard.disable/enable`, jak `user.js:45,215`);
  Esc zamyka **najwyższą** warstwę; fokus wraca do elementu sprzed otwarcia.
- **Przypadki błędów:** wyjątek w `onclose`/przycisku → złapany; `url` w `RED.overlay` o schemacie innym niż `https:`/`http:`
  względny do instancji (np. `javascript:`) → odrzucenie.
- **Skutki uboczne:** nowy moduł `ec/ui/common/dialog.js`.

#### Projekt API
```js
/**
 * @param {Object} o
 * @param {string} o.title                    tekst
 * @param {HTMLElement|string} o.content      element lub TEKST (łańcuch nie jest interpretowany jako HTML)
 * @param {Array<{text:string, class?:"primary"|"danger", click:function(close)}>} [o.buttons]
 * @param {number|string} [o.width]
 * @param {boolean} [o.closeOnEscape=true]
 * @param {function(result)} [o.onclose]
 * @returns {{close:function(*), element:HTMLElement}}
 */
RED.dialog.open(o)
/** @returns {Promise<boolean>} */
RED.dialog.confirm(text, { title, okLabel, cancelLabel, danger })
/**
 * Panel pełnoekranowy nad obszarem roboczym.
 * @param {{title:string, url?:string, content?:HTMLElement, sandbox?:string, onclose?:function}} o
 *        url – ramka; domyślnie sandbox="allow-scripts allow-forms allow-popups" (bez allow-same-origin), referrerpolicy="no-referrer"
 * @returns {{close:function, element:HTMLElement, frame?:HTMLIFrameElement}}
 */
RED.overlay.open(o)
```
- Wspólny menedżer warstw (`createLayerStack()` – czysta logika: kolejność, Esc → najwyższa, przywracanie fokusu) – testowalny.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Okna modalne i panel pełnoekranowy

  Scenariusz: Esc zamyka najwyższą warstwę
    Zakładając otwarty panel RED.overlay i nad nim okno RED.dialog
    Kiedy nacisnę Esc
    Wtedy zamyka się tylko okno, panel pozostaje otwarty

  Scenariusz: Fokus i skróty
    Kiedy otworzę okno dialogowe
    Wtedy fokus jest w oknie, Tab nie wychodzi poza okno, skróty edytora są nieaktywne
    I po zamknięciu fokus wraca do poprzedniego elementu

  Scenariusz: Potwierdzenie jako Promise
    Kiedy plugin wywoła RED.dialog.confirm("Usunąć?") i kliknę Anuluj
    Wtedy Promise rozwiązuje się wartością false

  Scenariusz: Treść tekstowa nie jest HTML
    Kiedy plugin przekaże content "<img src=x onerror=alert(1)>"
    Wtedy treść jest wyświetlona dosłownie

  Scenariusz: Ramka w piaskownicy
    Kiedy plugin otworzy RED.overlay z url aplikacji
    Wtedy ramka ma atrybut sandbox bez allow-same-origin, chyba że plugin jawnie go poda

  # + wspólne scenariusze odbioru (api = RED.dialog, RED.overlay)
```

#### Testy
- `test/unit/@node-red/editor-client/ui/common/dialog_spec.js`: `layer stack order`, `escape closes top only`, `focus restore target`,
  `confirm resolves true/false`, `rejects javascript url`, `default sandbox`.
- E2E: fokus i Esc w przeglądarce.

#### DoD specyficzne
- [ ] Dokumentacja relacji `RED.tray` / `RED.dialog` / `RED.overlay` / `RED.popover` (kiedy czego używać).
- [ ] Przykład: formularz w oknie + panel z ramką.

#### Ryzyka i alternatywy
- Ramka z adresem tej samej domeny i `allow-same-origin` ma dostęp do tokena w localStorage – dokumentacja i domyślna piaskownica.
- Alternatywa: udokumentowanie `RED.popover.dialog` + poprawki (Esc, fokus) – tańsze, ale nazwa myląca (popover ≠ okno).

#### Podzadania
- [ ] Menedżer warstw + `RED.dialog` + testy – M
- [ ] `RED.overlay` (ramka, piaskownica) – S
- [ ] Dokumentacja, przykład, E2E – S

---

### Z-12.14 – API między pluginami oraz pluginem a bloczkiem

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja (głównie dokumentacja) |
| Priorytet / ryzyko | N / niskie |
| Ustawienie | brak |
| Zależności | 03 |
| Pliki | `ec/plugins.js:6-41`, `ec/red.js:19-60,544-571` |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE**.
- `RED.plugins.getPlugin(id)` (`plugins.js:35-37`) zwraca definicję – technicznie wystarcza; brak konwencji.
- `registerPlugin` nadpisuje istniejący `id` bez ostrzeżenia (`:7`); zdarzenie `registry:plugin-added` (`:32`).
- Kolejność: pluginy ładowane przed węzłami (`red.js:30-32`) – panel edycji węzła ma dostęp do pluginów z `/plugins`;
  pluginy doinstalowane później – nie od razu.

#### Specyfikacja
- **Cel:** udostępnianie funkcji bez `window.*`.
- **Wejścia:** pole `api` w definicji pluginu.
- **Wyjścia:** `getPluginAPI(id)` → obiekt `api` lub `undefined`; `whenAvailable(id)` → `Promise<api>`.
- **Niezmienniki:** `getPlugin` bez zmian; `api` zamrażane płytko (`Object.freeze`) przy rejestracji.
- **Przypadki błędów:** duplikat `id` → ostrzeżenie (zachowanie nadpisania bez zmian – zgodność); `whenAvailable` z
  `timeout` → odrzucenie po czasie.
- **Skutki uboczne:** brak.

#### Projekt API
```js
RED.plugins.registerPlugin("acme-auth", { type: "acme", api: { getTenant() {…} } });
/** @returns {Object|undefined} */
RED.plugins.getPluginAPI("acme-auth")
/** @param {string} id @param {{timeout?:number}} [opts] @returns {Promise<Object>} */
RED.plugins.whenAvailable("acme-auth", { timeout: 10000 })
// w oneditprepare węzła:
const api = RED.plugins.getPluginAPI("acme-auth"); if (api) { … }
```

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: API między pluginami

  Scenariusz: Użycie API pluginu w panelu edycji bloczka
    Zakładając plugin "acme-auth" z polem api
    Kiedy otworzę panel edycji bloczka, który wywołuje RED.plugins.getPluginAPI("acme-auth").getTenant()
    Wtedy panel otrzymuje wynik bez zmiennych globalnych window.*

  Scenariusz: Oczekiwanie na plugin ładowany później
    Kiedy plugin B wywoła whenAvailable("A") przed rejestracją A
    Wtedy Promise rozwiązuje się po rejestracji A

  # + wspólne scenariusze odbioru (api = pole api, getPluginAPI, whenAvailable)
```

#### Testy
- `test/unit/@node-red/editor-client/plugins_spec.js`: `getPluginAPI returns api`, `whenAvailable resolves later`,
  `whenAvailable timeout`, `duplicate id warns`.

#### DoD specyficzne
- [ ] Przykład: plugin + węzeł testowy korzystający z API w `oneditprepare`.

#### Ryzyka i alternatywy
- Wersjonowanie API między pluginami – po stronie autorów (dokumentacja zaleca pole `api.version`).

#### Podzadania
- [ ] `getPluginAPI`, `whenAvailable`, ostrzeżenie + testy – S
- [ ] Dokumentacja, przykład – S

---

## Grupowanie w pakiety dostarczeniowe

Każdy pakiet = osobna gałąź od 5.0.7 (ZASADY §3), własny odbiór. Kolejność Z-12c → Z-12a → Z-12b → Z-12d → Z-12e (Z-01 równolegle) i możliwość odłożenia 07 – **zatwierdzone (R-24)**. Tor **A** = runtime / editor-api (serwer),
tor **B** = editor-client.

| Pakiet | Punkty | Prio. | Zmiany serwera (tor A) | Edytor (tor B) | Szac. | Zależności | Kolejność |
|---|---|---|---|---|---|---|---|
| **Z-12c** Cykl życia UI | 03, 04, 05, 06, 07 | W (03, 04), Ś (05, 06), N (07) | **nie** | tak | M+M+S+S+M | E-03; 08 dla opcji `permission` (działa na istniejącym `hasPermission`) | **1** (03 jako pierwsze – baza dla wszystkich); 07 może zostać odłożone |
| *(Z-01)* | 11 | W | nie (klient) | tak | S | – | **1** (równolegle; pakiet Z-01) |
| **Z-12a** Logowanie i sesja | 01, 12, 02 | W (01, 12), Ś (02) | **tak (mniejsze)**: `rt/api/settings.js` (`httpAdminRoot`), `ea/auth/index.js` (`codeInFragment`); wariant B i pola w `strategies.js` – odpadają (R-25) | tak | L+M+M (01 bez wariantu B – możliwe M) | 03; decyzje R-25, R-26 | **2** (01 i 12 przed 02) |
| **Z-12b** Uprawnienia | 08, 09 | W (08), Ś (09) | **tak (największe)**: `ea/auth/permissions.js`, trasy `ea/admin/index.js`, `rt/api/settings.js` (`attributes`), `rt/api/flows.js` (kontrola typów, krok 2a E-01 – **obowiązkowo, R-27**), `ea/editor/theme.js` (09) | tak | L+M (wzrost: kontrola typów obowiązkowa – R-27) | E-01; decyzja R-27 | **3** – specyfikacja i decyzje od razu (W), implementacja po Z-12c; tor A może startować równolegle z Z-12a |
| **Z-12d** Nawigacja i okna | 10, 13 | Ś | **tak (mała)**: `ea/editor/theme.js` (`editorTheme.embedding.allowedOrigins` – R-28) | tak | M+M | 03 | **4** |
| **Z-12e** API pluginów | 14 | N | nie | tak | S | 03 | **5** (lub dołączone do Z-12c, jeśli tańsze) |

Uwagi do torów: tor B jest krytyczny (wszystkie pakiety); tor A obciążają Z-12b (L) i Z-12a. Zmiany w `permissions.js`
i `rt/api/settings.js` dotykają plików używanych przez inne pakiety (Z-02 – `RED.auth.needsPermission`; E-01 – potok
wdrożenia) – kolejność scalania uzgadniana w E-01.

## Ocena pod kątem upstream

*Ocena Wykonawcy, nie stanowisko projektu (D-04: zgłoszenia upstream zablokowane do odwołania).*

| Punkt | Ocena szans przyjęcia | Uzasadnienie |
|---|---|---|
| 03 `editor:ready`, `onready` | wysoka | mała zmiana, typowa potrzeba autorów pluginów |
| 04 cykl życia zakładki | wysoka | rozszerza istniejące API, bez zmian zachowania |
| 05, 06 menu | średnio-wysoka | prosta; grupy menu to nowe zobowiązanie |
| 07 `RED.header` | średnia | nowa przestrzeń; upstream może woleć własny projekt nagłówka |
| 10 `hashchange`, akcja | wysoka; `postMessage` – średnio-niska | nawigacja naturalna; kanał osadzania to decyzja architektoniczna |
| 11 | wysoka | poprawka błędu (Z-01) |
| 12 `RED.api.request` | średnio-wysoka | zastępuje zależność od jQuery w pluginach |
| 13 `RED.dialog` | średnia | częściowo pokrywa się z `RED.popover.dialog` |
| 14 | średnia | głównie dokumentacja |
| 02 `#code=` | średnia | poprawa prywatności kodu; wymaga uzgodnienia z mechanizmem strategii |
| 09 | średnia | ustawienia palety są rozwijane upstream (`nodeOverrides`), może kolidować |
| 01 hooki logowania | średnio-niska | wrażliwe bezpieczeństwo; wariant A (hooki + `page.scripts`) ma większe szanse niż wariant B |
| 08 uprawnienia | niska–średnia | duża zmiana modelu bezpieczeństwa; upstream prawdopodobnie zaprojektuje własny model |

## Pytania do Zamawiającego

1. **P-1 – zakres:** czy punkty z wcześniejszej karty Z-12 spoza załącznika B (`RED.deploy.addMenuItem`, hook `deployPre`,
   dokumentacja `RED.view.annotations`) pozostają w zakresie, czy je usuwamy? **Rozstrzygnięte (R-24):** poza Z-12 – osobny pakiet realizowany później (karta etap-4.md oznaczona).
2. **P-2 – dokumentacja:** gdzie ma trafić dokumentacja API edytora „w stylu projektu” (repozytorium dokumentacji
   nodered.org w forku, katalog w tym repozytorium, oba)? **Rozstrzygnięte (R-24):** JSDoc + katalog `design/editor-api/` w tym repozytorium.
3. **P-3 – 01, dostarczanie skryptów logowania:** czy wystarcza wariant A (`editorTheme.page.scripts` / wtyczka motywu),
   czy wymagany jest wariant B (plugin z polem `loginScripts` aktywowany w `editorTheme.login.plugins`)? **Rozstrzygnięte (R-25):** wariant A (`editorTheme.page.scripts` / wtyczka motywu); wariant B odrzucony.
4. **P-4 – 01, dodatkowe pola formularza:** do czego służą (np. kod jednorazowy)? Czy wartości mają trafić do
   `adminAuth.authenticate` (zmiana serwera), czy wystarczy krok `loginPost` z własną trasą? **Rozstrzygnięte (R-25):** dodatkowe pola przez krok `loginPost` z własną trasą pluginu (bez zmiany `adminAuth.authenticate`).
5. **P-5 – 02:** w jaki sposób aplikacja zewnętrzna uzyskuje kod jednorazowy (własna strategia, osobna trasa wydająca kod)?
   Czy potrzebny jest format `#code=…&next=<głęboki link>`? **Rozstrzygnięte (R-26):** kod wydaje własna strategia `adminAuth`/plugin; rdzeń przyjmuje `#code=…&next=…` (format z `next` – tak).
6. **P-6 – 02:** czy dopuszczalna jest zmiana przechowywania tokena na `sessionStorage` (opcja), czy pozostaje `localStorage`? **Rozstrzygnięte (R-26):** `sessionStorage` jako opcja, domyślnie `localStorage`; nazwa ustawienia – `editorTheme.auth.tokenStorage: "local" | "session"` (**R-33**).
7. **P-7 – 08:** czy akceptujecie model „implikacja + wpisy odbierające `!`” (zgodny wstecz), czy wolicie osobne pole
   `restrictions` w obiekcie użytkownika? Jakie atrybuty użytkownika mają trafiać do edytora i jaki limit rozmiaru? **Rozstrzygnięte (R-27):** model „implikacja + `!`” (uprawnienia podrzędne dziedziczone, `!` odbiera, pierwszeństwo odebrania; dla typów węzłów doprecyzowane w R-42 – przyznanie konkretnego typu wygrywa z `!nodes.type.*`). Zakresu atrybutów użytkownika i limitu rozmiaru decyzja nie obejmuje (karta: biała lista + limit np. 8 KB – do potwierdzenia).
8. **P-8 – 08/09, typy węzłów:** czy wymagana jest egzekucja serwerowa `nodes.type.<typ>` przy wdrożeniu (L, zmiana potoku
   E-01), czy wystarczy UI + własny hook `preDeploy` (Z-06)? Czy potrzebne są listy dozwolonych typów (allow-list)? **Rozstrzygnięte (R-27):** egzekucja serwerowa `nodes.type.<typ>` przy wdrożeniu – w zakresie (zmiana potoku E-01, krok 2a; 403 `node_type_not_permitted`); `flows.export` – tylko utrudnienie. Listy dozwolonych typów – **R-42:** obie listy (odbierająca i dozwolonych); przyznanie konkretnego typu wygrywa z `!nodes.type.*`, odebranie konkretnego typu – ze wszystkim; przeładowanie z magazynu bez kontroli per użytkownik.
9. **P-9 – 10:** co oznacza „format z identyfikatorem flow” – `#flow/<id>` już działa; czy chodzi o `#flow/<flowId>/node/<nodeId>`?
   Czy istniejący kanał motywu (`set-theme` bez kontroli źródła) ma zostać objęty listą `allowedOrigins`? **Rozstrzygnięte (R-28):** nowy format `#flow/<flowId>/node/<nodeId>`, `hashchange`, `core:reveal-node`; `set-theme` objęty `editorTheme.embedding.allowedOrigins`. **R-35:** brak ustawienia = zachowanie 5.0.7 z ostrzeżeniem w logu; ustawiona lista – tylko wymienione źródła.
10. **P-10 – bezpieczeństwo poza zakresem:** czy zgłosić jako osobną poprawkę wstawianie nazwy użytkownika jako HTML w menu
    użytkownika (`ec/user.js:265`) i brak odświeżenia `RED.settings.user` po ponownym logowaniu (`ec/comms.js:96-105`)? **Rozstrzygnięte (R-08):** osobna poprawka bezpieczeństwa teraz (nazwa użytkownika jako HTML, `ec/user.js:265`). Brak odświeżenia `RED.settings.user` po ponownym logowaniu – **R-41:** naprawiany razem z poprawką R-08 (test, który pada bez poprawki).
11. **P-11 – stabilność API:** okres deprecjacji nowych API (rekomendacja jak w etap-4.md: min. jedna wersja minor z ostrzeżeniem). **Rozstrzygnięte (R-24):** min. jedna wersja minor z ostrzeżeniem.
12. **P-12 – kolejność:** czy akceptujecie kolejność pakietów Z-12c → Z-12a → Z-12b → Z-12d → Z-12e (Z-01 równolegle) i
    ewentualne odłożenie 07 (N)? **Rozstrzygnięte (R-24):** tak – Z-12c → Z-12a → Z-12b → Z-12d → Z-12e (Z-01 równolegle); 07 może zostać odłożone.

## Zmiany po decyzjach (2026-10-03)

Naniesione decyzje z [../REJESTR-DECYZJI.md](../REJESTR-DECYZJI.md):

- **Pytania P-1…P-12** – dopisane rozstrzygnięcia (R-08, R-24, R-25, R-26, R-27, R-28).
- **Ustalenia przekrojowe (R-08, R-24):** XSS nazwy użytkownika – osobna poprawka teraz; dokumentacja – JSDoc + `design/editor-api/`; deprecjacja – min. jedna wersja minor; punkty spoza załącznika B – osobny pakiet później; kolejność pakietów zatwierdzona.
- **Z-12.01 (R-25):** wariant A; wariant B odrzucony (Ustawienie, Projekt, BDD – scenariusze wariantu B zastąpione, nowy scenariusz „dodatkowe pole przez `loginPost`”, testy, DoD, podzadanie M usunięte). Szacunek L – do ponownej oceny (możliwe M).
- **Z-12.02 (R-26):** kod z własnej strategii/pluginu; `#code=…&next=…` w zakresie; opcja `sessionStorage` (domyślnie `localStorage`) – Wejścia, Wyjścia, Projekt, 2 nowe scenariusze, testy, DoD, nowe podzadanie S. Szacunek M bez zmian.
- **Z-12.06 (R-08):** poprawka XSS nazwy użytkownika wydzielona; scenariusz zachowany jako regresja.
- **Z-12.08 (R-27):** model „implikacja + `!`” zatwierdzony; egzekucja serwerowa `nodes.type.<typ>` **obowiązkowa** (krok 2a potoku E-01, 403 `node_type_not_permitted` z `types[]`); alternatywy (`preDeploy`, `restrictions`) odrzucone; nowy scenariusz i testy. **Szacunek: Z-12.08 L (kontrola typów obowiązkowa), Z-12b – wzrost** (wcześniej podzadanie L było opcjonalne).
- **Z-12.09 (R-27):** ukrywanie typów wsparte egzekucją serwerową.
- **Z-12.10 (R-28):** format `#flow/<flowId>/node/<nodeId>`; ustawienie `editorTheme.embedding.allowedOrigins` (nazwa wg ZASADY §2.1) obejmuje `set-theme`; 2 nowe scenariusze, testy.
- **Grupowanie (R-24, R-25, R-27, R-28):** Z-12a – mniejszy zakres serwera; Z-12b – kontrola typów obowiązkowa; Z-12d – nowa nazwa ustawienia.
- **Doprecyzowania R-33…R-42:**
  - **Ustalenia przekrojowe, Z-12.06, P-10 (R-08, R-41):** odświeżenie `RED.settings.user` po ponownym logowaniu naprawiane w poprawce XSS R-08 (test, który pada bez poprawki); usunięte „do potwierdzenia” i podzadanie w Z-12.08 przeniesione do poprawki.
  - **Z-12.02 (R-33):** nazwa `editorTheme.auth.tokenStorage: "local" | "session"`, domyślnie `"local"` (Ustawienie, Wejścia, Wyjścia, scenariusz, testy – w tym przekazanie w `theme.js`, DoD, Ryzyka, podzadanie, P-6).
  - **Z-12.08 (R-42):** obie listy typów (odbierająca i dozwolonych); reguła pierwszeństwa: przyznanie konkretnego typu wygrywa z `!nodes.type.*`, odebranie konkretnego typu wygrywa ze wszystkim (zastępuje wcześniejsze „odebranie ma pierwszeństwo” dla `!nodes.type.*` + `nodes.type.inject`); `reload` i przeładowanie z magazynu bez kontroli per użytkownik; 3 nowe scenariusze, testy (wspólna tabela przypadków), P-7, P-8.
  - **Z-12.10 (R-33, R-35):** nazwa `editorTheme.embedding.allowedOrigins` potwierdzona; brak ustawienia = 5.0.7 (`set-theme` bez kontroli, nowy kanał nieaktywny) + ostrzeżenie w logu; ustawiona lista – tylko wymienione źródła (Ustawienie, Niezmienniki, scenariusz, testy, DoD, P-9).
