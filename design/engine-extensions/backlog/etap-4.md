# Backlog – etap 4 (Z-12–Z-15, E-03, E-04, E-05)

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.
> Zasady, szablon karty i wspólne DoD: [../ZASADY.md](../ZASADY.md). Fakty z kodu: [../WERYFIKACJA.md](../WERYFIKACJA.md).
> Ścieżki plików względem `packages/node_modules/` (kod) i katalogu głównego repozytorium (testy). Baza: 5.0.7 (ZASADY §2.2).
> Oznaczenie „do potwierdzenia” = nie sprawdzono w kodzie albo wymaga decyzji Zamawiającego.
> Gałąź z dotychczasowymi zmianami układu flow: `claude/loving-fermat-ftfo9h` (baza `cd05a9a` = 5.0.7 + 2 commity upstream).

## Podsumowanie

| ID | Tytuł | Typ | Priorytet | Ryzyko | Zależności | Szacunek |
|---|---|---|---|---|---|---|
| [Z-12](#z-12--punkty-rozszerzeń-edytora-dla-pluginów) | Punkty rozszerzeń edytora dla pluginów (spike + szkielet) | funkcja | P3 | wysokie (publiczne API, brak załącznika B) | załącznik B (Zamawiający), E-03, P-02/Z-06 (Deploy) | M (spike + szkielet); każdy punkt z załącznika B – osobna karta z własnym szacunkiem S/M/L |
| [Z-13](#z-13--polskie-tłumaczenie) | Polskie tłumaczenie | funkcja | P3 | średnie (wolumen, przegląd językowy) | tłumaczenie częściowe od Zamawiającego; klucze z P-02, Z-03, Z-14, Z-15 | L |
| [Z-14](#z-14--układ-flow-dostosowanie-istniejącej-realizacji) | Układ flow – dostosowanie istniejącej realizacji | funkcja (propozycja Wykonawcy) | P3 | średnie | E-04, Z-04 (część runtime), E-03, D-03, D-06 | M |
| [Z-15](#z-15--instancja-tylko-edycyjna) | Instancja tylko edycyjna | funkcja (propozycja Wykonawcy) | P2 | średnie | E-01, E-02; zgodność z P-01, Z-06, Z-08, Z-09; D-02, D-06 | M |
| [E-03](#e-03--harness-testów-edytora) | Harness testów edytora | przerobienie (infrastruktura testów) | P1 (etap 0) | niskie | D-03 | M (helper S + E2E M przy D-03 = tak) |
| [E-04](#e-04--dostosowanie-istniejącej-gałęzi) | Dostosowanie istniejącej gałęzi | przerobienie (proces) | P1 (etap 0) | niskie | D-01, D-04 | M |
| [E-05](#e-05--środowisko-weryfikacji) | Środowisko weryfikacji (CI, raport pakietu, gałąź integracyjna) | przerobienie (infrastruktura weryfikacji) | P1 (etap 0) | niskie | D-03 (zadanie E2E), D-04 | M |

Kolejność realizacji: **E-03, E-04 i E-05 w etapie 0** (ANALIZA §6.1 – karty w tym pliku, bo dotyczą głównie pakietów edytora i układu flow) →
Z-14 (krok 2.3, po Z-04) → Z-13 (krok 4, równolegle z kodem; klucze nowych tekstów doklejane na bieżąco) → Z-12 (po załączniku B) → Z-15
(po Z-08/Z-09, bo dopina się do modelu stanu E-02).

---

### Z-12 – Punkty rozszerzeń edytora dla pluginów

> **Po załączniku B (2026-10-03):** szczegółowe karty 14 punktów i podział na pakiety Z-12a…e – [etap-4-z12.md](etap-4-z12.md). Ta karta pozostaje opisem ogólnym.

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja – **spike + szkielet** (pełny zakres po załączniku B) |
| Priorytet / ryzyko | P3 / wysokie (każde nowe API edytora = zobowiązanie utrzymaniowe; zakres nieznany) |
| Ustawienie | brak (API dostępne zawsze; bez użycia przez plugin brak zmian w UI) |
| Zależności | **załącznik B** (lista punktów – jeszcze nie przekazany); E-03 (testy edytora); P-02 i Z-06 (rozszerzenia Deploy muszą respektować ich przepływ) |
| Pliki | `editor-client/src/js/plugins.js:6-75` (`registerPlugin`, `onadd` `:29-30`), `ui/deploy.js:60-115,696-702`, `ui/notifications.js:330`, `ui/view-annotations.js:101`, `hooks.js:1-15`, `ui/common/menu.js:547`, `ui/sidebar.js:120`, `ui/statusBar.js:31`, `ui/tray.js:243`, `ui/notifications.js:66`; `editor-api/lib/editor/theme.js:350-357` (`editorTheme.deployButton`) |
| Powiązania | K8S-T-006 (przycisk „Publikuj”), K8S-T-003 (oznaczenie środowiska / zdarzenia z workerów), Z-15 (komunikat „instancja edycyjna”) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE** (WERYFIKACJA §Z-12) + uzupełnienia z tej karty.

Macierz: kategorie ze zlecenia × istniejące API.

| Kategoria ze zlecenia | Istniejące API | Ocena | Luka |
|---|---|---|---|
| Pasek boczny | `RED.sidebar.addTab` (`ui/sidebar.js:120`) | wystarczające, udokumentowane | – |
| Menu (główne) | `RED.menu.addItem/removeItem` (`ui/common/menu.js:547`) | wystarczające | brak gwarancji stabilnych identyfikatorów pozycji (punkt wstawienia) – do potwierdzenia |
| Nagłówek | **brak**; core dopisuje elementy jQuery `prependTo(".red-ui-header-toolbar")` (`ui/deploy.js:69,98`, `ui/notifications.js:330`) | luka | API elementów nagłówka z kolejnością |
| Przycisk Deploy | `RED.deploy` eksportuje tylko `init`, `setDeployInflight` (`ui/deploy.js:696-702`); menu Deploy budowane przez `RED.menu.init({id:"red-ui-header-button-deploy-options"})` (`:81`); `editorTheme.deployButton` – tylko etykieta/typ (`theme.js:350-357`) | luka | pozycje menu Deploy (dziś może działać nieoficjalnie `RED.menu.addItem("red-ui-header-button-deploy-options", …)` – **do potwierdzenia**), zdarzenia/hook przed wdrożeniem w edytorze |
| Plakietki węzłów | `RED.view.annotations.register` (`ui/view-annotations.js:101`, użycie core `ui/view.js:1249,1355`) | istnieje, **nieudokumentowane** | dokumentacja + deklaracja stabilności |
| Okna | `RED.tray.show` (`ui/tray.js:243`), `RED.notify` z przyciskami (`ui/notifications.js:66`), `RED.popover.*` | częściowe | ogólne okno modalne (formularz, potwierdzenie) – dziś pluginy budują je z jQuery UI `dialog` (wewnętrzne) |
| Pasek stanu | `RED.statusBar.add` (`ui/statusBar.js:31`) | wystarczające | – |
| Akcje, skróty, menu kontekstowe, ustawienia użytkownika, panele edycji, kategorie palety | `RED.actions.add`, `RED.keyboard.add`, `RED.contextMenu.show`, `RED.userSettings.add`, `RED.editor.registerEditPane`, `RED.palette.registerCategory` | wystarczające | – |
| Hooki widoku | `RED.hooks` z `VALID_HOOKS` (`hooks.js:7-15`: `viewAddNode`, `viewRemoveNode`, `viewAddPort`, `viewRemovePort`, `viewRedrawNode`, `debugPre/PostProcessMessage`); `knownHooksOnly = false` (`hooks.js:5`) – nieznane nazwy są dziś przyjmowane | wystarczające jako mechanizm | nowe hooki edytora (np. `deployPre`) wymagają dopisania do `VALID_HOOKS` |
| Rejestracja pluginu | `RED.plugins.registerPlugin(id, def)` + `def.onadd()` (`plugins.js:6,29-30`), `getPluginsByType` (`:39`) | wzorzec do użycia | – |

Fakt: brak testów jednostkowych edytora dla tych modułów (WERYFIKACJA: jedyne testy klienta to `test/unit/@node-red/editor-client/ui/search_spec.js` – upstream – oraz nasz `view-layout_spec.js`).

#### Specyfikacja
- **Cel:** pluginy edytora realizują dodatki (nagłówek, Deploy, okna, plakietki) przez publiczne, udokumentowane API zamiast wstrzykiwania skryptów (`editorTheme.page.scripts`) operujących na DOM; API odporne na zmiany wersji.
- **Wejścia:** załącznik B (lista punktów od Zamawiającego); propozycje Wykonawcy (do potwierdzenia po załączniku B):
  1. `RED.header.add({id, element|label+icon+onclick, priority, position:"left"|"right"})` → uchwyt `{remove(), setVisible(b)}`; `RED.header.remove(id)`.
  2. Rozszerzenia Deploy: `RED.deploy.addMenuItem({id, label, sublabel, icon, onselect, priority})`, zdarzenia `deploy:before` / `deploy:after` (`RED.events`) albo hook edytora `deployPre` (może anulować z komunikatem) – **powiązanie z Z-06** (walidacja serwerowa pozostaje źródłem prawdy) i **P-02** (polityka `reload-only` ma pierwszeństwo).
  3. Ogólne okno modalne: `RED.dialog.show({title, content, buttons:[{text, class, click}], width, closeOnEscape})` → `{close()}`; `RED.dialog.confirm(text, opts) → Promise<boolean>` (nazwa `RED.dialog` – do potwierdzenia, brak kolizji w `editor-client/src/js` – do sprawdzenia przy implementacji).
  4. Dokumentacja `RED.view.annotations.register/unregister` (bez zmiany kodu, deklaracja jako API publiczne).
- **Wyjścia:** nowe moduły/API z JSDoc; dokument „Punkty rozszerzeń edytora” (strona w `docs`/`API.md` – miejsce do potwierdzenia); przykład pluginu dla każdego nowego punktu (`test/resources/plugins/editor-extension-example/` lub katalog przykładów – do potwierdzenia).
- **Niezmienniki:** bez pluginu UI identyczny z 5.0.7 (core migruje swoje elementy nagłówka na nowe API tylko jeśli DOM i kolejność pozostają bez zmian – albo nie migruje, decyzja w spike); stare sposoby (`page.scripts`, jQuery na `.red-ui-header-toolbar`) działają dalej; plugin nie może usunąć elementów core (tylko własne `id`).
- **Przypadki błędów:** duplikat `id` → ostrzeżenie w konsoli, drugi wpis odrzucony (spójnie z `registerType` – ostrzeżenie zamiast wyjątku); wyjątek w `onclick`/`onselect`/handlerze `deployPre` → złapany, zalogowany, nie blokuje edytora; handler `deployPre` bez odpowiedzi → limit czasu (np. 10 s – do potwierdzenia) i kontynuacja/anulowanie wg decyzji.
- **Skutki uboczne:** nowe publiczne API (zobowiązanie); zasady stabilności – wersjonowanie (`RED.header.version` lub sekcja w dokumentacji), deprecjacja min. jedna wersja minor z ostrzeżeniem w konsoli.

#### Projekt rozwiązania (minimalny)
1. **Spike (M):** porównanie załącznika B z macierzą powyżej; dla każdej pozycji decyzja: istniejące API (dokumentacja) / nowe API / poza zakresem. Wynik – tabela w tej karcie + pytania do Zamawiającego.
2. **Szkielet wspólny:** każdy nowy punkt jako cienki moduł `ui/<punkt>.js` w `scripts/build/config.js` (lista `concatEditor`), rejestrowany przed `RED.plugins` (kolejność ładowania – do potwierdzenia), z logiką wydzieloną od DOM (testowalną w E-03).
3. **Wzorzec użycia:** plugin typu edytora rejestrowany przez `RED.plugins.registerPlugin("my-plugin", {type:"…", onadd: function(){ RED.header.add(...) }})` – przykład w dokumentacji i w katalogu przykładów.
4. Dokumentacja `RED.view.annotations` (parametry `element`, `show`, `filter`, kolejność rysowania – na podstawie `view-annotations.js`).
5. Stabilność: lista API publicznych w dokumencie, oznaczenie `@public`/`@since` w JSDoc.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Punkty rozszerzeń edytora dla pluginów

  # Kryterium odbioru ze zlecenia (1)
  Szablon scenariusza: Przykład pluginu dla każdego nowego punktu rozszerzeń
    Zakładając, że w Node-RED zainstalowano przykładowy plugin dla punktu "<punkt>"
    Kiedy otworzę edytor
    Wtedy element pluginu jest widoczny w miejscu "<miejsce>"
    I plugin nie modyfikuje DOM poza API punktu "<punkt>"
    Przykłady:
      | punkt          | miejsce                        |
      | RED.header     | pasek nagłówka, wg priorytetu  |
      | RED.deploy     | menu przycisku Deploy          |
      | RED.dialog     | okno modalne po akcji pluginu  |
    # lista ostateczna wg załącznika B

  # Kryterium odbioru ze zlecenia (2)
  Scenariusz: Testy edytora projektu przechodzą bez błędów
    Zakładając gałąź pakietu Z-12
    Kiedy uruchomię npm test (oraz test:e2e, jeśli D-03 = tak)
    Wtedy wszystkie testy przechodzą, w tym nowe testy punktów rozszerzeń

  Scenariusz: Brak pluginu – edytor jak w 5.0.7
    Zakładając brak pluginów używających nowych API
    Kiedy otworzę edytor
    Wtedy pasek nagłówka, menu Deploy i okna są identyczne jak w 5.0.7

  Scenariusz: Kolejność elementów nagłówka
    Zakładając dwa pluginy dodające elementy nagłówka z priorytetami 10 i 20
    Wtedy elementy są ułożone zgodnie z priorytetem niezależnie od kolejności ładowania pluginów

  Scenariusz: Duplikat identyfikatora
    Kiedy plugin doda element nagłówka z id już zarejestrowanym
    Wtedy w konsoli pojawia się ostrzeżenie, a drugi element nie jest dodany

  Scenariusz: Błąd w handlerze pluginu nie blokuje edytora
    Zakładając pozycję menu Deploy, której onselect zgłasza wyjątek
    Kiedy wybiorę tę pozycję
    Wtedy błąd jest zalogowany w konsoli, a edytor i Deploy działają dalej

  Scenariusz: Hook przed wdrożeniem w edytorze anuluje wdrożenie
    Zakładając plugin z handlerem deployPre zwracającym odmowę z komunikatem
    Kiedy kliknę Deploy
    Wtedy żądanie wdrożenia nie jest wysyłane, a komunikat jest wyświetlony
    I walidacja serwerowa preDeploy (Z-06) działa niezależnie od edytora

  Scenariusz: Usunięcie elementu przez uchwyt
    Kiedy plugin wywoła remove() na uchwycie elementu nagłówka
    Wtedy element znika, a pozostałe zachowują kolejność
```

#### Testy
- Jednostkowe (wzorzec E-03) `test/unit/@node-red/editor-client/ui/header_spec.js`: `orders items by priority`, `rejects duplicate id with warning`, `remove() detaches item`, `handler exception is caught`.
- `test/unit/@node-red/editor-client/ui/deploy-extensions_spec.js`: `addMenuItem adds item to deploy menu`, `deployPre rejection cancels deploy`, `deployPre timeout`, `handler exception does not block deploy`.
- `test/unit/@node-red/editor-client/ui/dialog_spec.js`: `confirm resolves true/false`, `escape closes when allowed` (tylko logika – DOM w E2E).
- E2E (jeśli D-03 = tak) `test/editor/e2e/editor_extensions_e2espec.js`: przykładowy plugin ładowany z katalogu testowego; asercje widoczności i kolejności.
- `test/unit/@node-red/editor-api/lib/editor/theme_spec.js` – tylko jeśli powstaną nowe ustawienia `editorTheme` (dziś nieplanowane).

#### DoD specyficzne
- [ ] Wynik spike (macierz po załączniku B) zatwierdzony przez Zamawiającego przed implementacją.
- [ ] Każdy nowy punkt: JSDoc, dokumentacja, przykład pluginu, test jednostkowy logiki, (E2E wg D-03).
- [ ] `RED.view.annotations` udokumentowane.
- [ ] Zasady stabilności i deprecjacji opisane w dokumentacji.
- [ ] Brak zmian UI bez pluginów (porównanie zrzutów ekranu przed/po w raporcie).

#### Ryzyka i alternatywy
- **Brak załącznika B** – karta celowo ogranicza się do spike i szkieletu; szacunek końcowy po załączniku.
- **Zobowiązanie utrzymaniowe:** każde API edytora musi przetrwać przebudowy UI upstream; ocena szans przyjęcia upstream zależy od punktu (ANALIZA §4.8). Alternatywa: punkty jako zdarzenia (`RED.events`) zamiast nowych modułów – mniej kodu, słabsza kontrola kolejności.
- **Hook przed wdrożeniem w edytorze** dubluje Z-06 – ryzyko mylenia walidacji klienta z serwerową; rekomendacja: hook edytora tylko do UX (np. potwierdzenie), walidacja wiążąca w Z-06.
- **Kolizja z P-02:** rozszerzenie Deploy nie może omijać polityki `reload-only` – test integracyjny P-02 + Z-12.
- **Brak harnessu DOM** (brak jsdom w zależnościach) – testy jednostkowe tylko dla logiki; zachowanie DOM wymaga E2E (D-03).

#### Podzadania
- [ ] Spike: macierz załącznik B × istniejące API, pytania – M
- [ ] `RED.header` + test + przykład – M
- [ ] Rozszerzenia Deploy (menu, zdarzenia/hook) + testy + przykład – M
- [ ] `RED.dialog` + test + przykład – S
- [ ] Dokumentacja `RED.view.annotations` i zasady stabilności – S
- [ ] E2E przykładowych pluginów (wg D-03) – M

---

### Z-13 – Polskie tłumaczenie

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja |
| Priorytet / ryzyko | P3 / średnie (wolumen, spójność terminologii, formy liczby mnogiej) |
| Ustawienie | brak (język wykrywany z katalogu `locales/pl`; wybór w ustawieniach użytkownika lub z przeglądarki) |
| Zależności | tłumaczenie częściowe od Zamawiającego; teksty nowych pakietów (P-02 `deploy.confirm.*`, Z-03, Z-12, Z-14 `layout.*`, Z-15) – doklejane przed zamknięciem |
| Pliki | nowe: `editor-client/locales/pl/{editor,jsonata,infotips}.json`, `nodes/locales/pl/messages.json` + pliki pomocy `nodes/locales/pl/<kategoria>/*.html`, `runtime/locales/pl/runtime.json` (zakres – pytanie); zmiana: `"pl": "Polski"` w `languages` wszystkich `editor-client/locales/*/editor.json`; mechanizm: `util/lib/i18n.js:49-67,165-185,221`, `editor-client/src/js/i18n.js:30-57`, `ui/userSettings.js:105,186`, `registry/lib/loader.js:546-575` |
| Powiązania | FL-T-004 (klucze `layout.*`), K8S (on-premise dla polskich klientów) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **CZĘŚCIOWO** (WERYFIKACJA §Z-13) + uzupełnienia:
- Brak `pl` we wszystkich trzech katalogach `locales` (dziś: `de, en-US, es-ES, fr, ja, ko, pt-BR, ru, zh-CN, zh-TW`).
- Liczby kluczy en-US (liczone jako liście drzewa JSON): `editor.json` **1140** na naszej gałęzi, w tym **14** kluczy `layout.*` z Z-14 → **1126 w czystym 5.0.7** (zlecenie: 1089 – różnica prawdopodobnie z innej wersji/metody liczenia, do potwierdzenia u Zamawiającego); `jsonata.json` 138; `infotips.json` 19; `nodes/messages.json` 872; `runtime.json` 141; pomoc węzłów: **36** plików HTML (~13 340 słów).
- Pomoc węzłów ma **zapasowanie per plik**: brak pliku w `pl` → wersja domyślnego języka (`registry/lib/loader.js:561-575`) – częściowe tłumaczenie pomocy nie psuje edytora.
- Nazwa języka w selektorze pochodzi z `languages.<kod>` w `editor.json` (`userSettings.js:105,186`); en-US dziś: 10 pozycji, bez `pl`.
- **Liczba mnoga (do potwierdzenia w edytorze):** projekt używa `i18next` **25.8.14** (`package.json:71`) bez opcji `compatibilityJSON` (`editor-client/src/js/i18n.js:30-50`, `util/lib/i18n.js:165-180`). en-US używa formatu v3 (`klucz` + `klucz_plural`: 39 par w `editor.json`, 5 w `messages.json`, 1 w `runtime.json`), `ru` – formatu v1/v2 (`klucz_plural_2`, `klucz_plural_5`). Próba poza edytorem (skrypt z `i18next` z `node_modules` projektu): `_plural` en-US **nie jest używany** („2 node”), natomiast sufiksy Intl dla `pl` działają poprawnie: `_one` (1), `_few` (2, 22), `_many` (5, 25), `_other` (1.5). Wniosek: dla `pl` stosujemy sufiksy `_one/_few/_many/_other`; niedziałające `_plural` en-US to osobny problem upstream (poza zakresem; zgłoszenie – pytanie).

#### Specyfikacja
- **Cel:** pełne polskie tłumaczenie edytora i węzłów core, spójne terminologicznie, z automatyczną kontrolą kompletności w `npm test`.
- **Wejścia:** pliki en-US (źródło prawdy); tłumaczenie częściowe Zamawiającego (332 klucze edytora wg zlecenia); słownik pojęć (tworzony w pakiecie).
- **Wyjścia:** pliki `pl` (lista w „Pliki”); słownik pojęć w opisie zmiany (PR) i w `design/engine-extensions/` (np. `SLOWNIK-PL.md` – poza upstream); test zgodności kluczy.
- **Niezmienniki:** pliki en-US i pozostałych języków bez zmian poza dodaniem `"pl": "Polski"` w `languages`; użytkownik bez wybranego `pl` (i przeglądarka bez `pl`) widzi edytor jak w 5.0.7; placeholdery `__nazwa__` i znaczniki HTML zachowane 1:1; identyfikatory techniczne (`msg.payload`, nazwy właściwości, typy) nietłumaczone.
- **Przypadki błędów:** brakujący klucz w `pl` → test czerwony (w runtime zapasowo en-US przez `fallbackLng`); placeholder różny od en-US → test czerwony; niepoprawny JSON → błąd buildu (`scripts/build/jsonlint.js`).
- **Skutki uboczne:** przeglądarki z językiem `pl` zaczną domyślnie pokazywać polski edytor (wykrywanie automatyczne) – zmiana widoczna dla polskich użytkowników instalacji z domyślnymi ustawieniami (zob. Ryzyka).

#### Projekt rozwiązania (minimalny)
1. **Słownik pojęć** (przed tłumaczeniem, zatwierdzany przez Zamawiającego): flow, subflow, węzeł/bloczek, wdrożenie (Deploy), paleta, kontekst, zakładka, linia/połączenie, grupa, węzeł konfiguracyjny itd. – z decyzją, co zostaje po angielsku (np. „Deploy” na przycisku?).
2. **Rejestr:** forma bezosobowa w etykietach i komunikatach („Wdróż”, „Nie można zapisać…”) vs „Ty” – **pytanie**; rekomendacja: bezosobowa/tryb rozkazujący jak w systemowych UI.
3. **Proces:** scalenie tłumaczenia Zamawiającego → tłumaczenie brakujących kluczy wspomagane AI ze słownikiem → automatyczny test zgodności → przegląd językowy Zamawiającego (w paczkach wg przestrzeni kluczy) → poprawki.
4. **Liczba mnoga:** dla każdej pary en-US `x`/`x_plural` w `pl`: `x` (forma podstawowa, dla wywołań bez `count`), `x_one`, `x_few`, `x_many`, `x_other` – do potwierdzenia testem w edytorze (E2E lub ręcznie) przed tłumaczeniem całości.
5. **Test zgodności** `test/unit/locales/pl_parity_spec.js` (nazwa do potwierdzenia): porównanie drzew kluczy pl↔en-US dla `editor`, `jsonata`, `infotips`, `messages`, `runtime` (wg zakresu), z regułą dla liczby mnogiej; porównanie zbiorów placeholderów `__x__` i znaczników HTML w każdej wartości; brak kluczy nadmiarowych; `languages.pl` we wszystkich `editor.json`; dla pomocy HTML (jeśli w zakresie) – zgodność listy plików.
6. Klucze nowych pakietów (P-02, Z-03, Z-12, Z-14 `layout.*`, Z-15) dopisywane w tych pakietach albo w Z-13 przed zamknięciem – test zgodności to wymusza.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Polskie tłumaczenie edytora i węzłów

  # Kryterium odbioru ze zlecenia (1)
  Scenariusz: Zgodność kluczy z en-US – żadnego brakującego
    Zakładając pliki locales/pl w editor-client i nodes
    Kiedy uruchomię npm test
    Wtedy test zgodności potwierdza, że każdy klucz en-US ma odpowiednik w pl
    I żaden klucz pl nie jest nadmiarowy
    I placeholdery __x__ i znaczniki HTML w każdej wartości są zgodne z en-US

  # Kryterium odbioru ze zlecenia (2)
  Scenariusz: Przegląd językowy przez Zamawiającego
    Zakładając komplet tłumaczeń i słownik pojęć
    Kiedy Zamawiający przeprowadzi przegląd językowy
    Wtedy wszystkie uwagi są uwzględnione, a przegląd jest zatwierdzony na piśmie

  Scenariusz: Wybór języka polskiego
    Zakładając instalację z katalogami locales/pl
    Kiedy w ustawieniach użytkownika wybiorę język "Polski"
    Wtedy menu, okna, paleta i pomoc węzłów są po polsku

  Scenariusz: Język domyślny bez zmian dla innych użytkowników
    Zakładając przeglądarkę z językiem en-US i brak wyboru języka w ustawieniach
    Kiedy otworzę edytor
    Wtedy edytor jest w języku angielskim jak w 5.0.7

  Scenariusz: Formy liczby mnogiej
    Zakładając język "Polski"
    Kiedy skopiuję 1, 2 i 5 węzłów
    Wtedy komunikaty używają form "1 węzeł", "2 węzły", "5 węzłów"

  Scenariusz: Brak tłumaczenia pomocy węzła
    Zakładając brak pliku pomocy pl dla węzła
    Kiedy otworzę pomoc tego węzła w języku "Polski"
    Wtedy wyświetla się pomoc angielska

  Scenariusz: Spójna terminologia
    Zakładając słownik pojęć zatwierdzony przez Zamawiającego
    Wtedy każde wystąpienie pojęcia ze słownika w plikach pl używa zatwierdzonego tłumaczenia
```

#### Testy
- `test/unit/locales/pl_parity_spec.js` (nowy): `editor.json pl has all en-US keys`, `no extra keys in pl`, `plural keys have _one/_few/_many/_other`, `placeholders match en-US`, `html tags match en-US`, `jsonata/infotips/messages/runtime parity` (wg zakresu), `every editor.json lists pl in languages`, `help files list matches` (jeśli pomoc w zakresie).
- Istniejące: `test/unit/@node-red/util/lib/i18n_spec.js`, `test/unit/@node-red/editor-api/lib/editor/locales_spec.js` – bez zmian, przechodzą.
- Opcjonalnie: prosty test słownika (lista zakazanych wariantów, np. „przepływ” jeśli słownik ustali „flow”) – do decyzji.
- Ręcznie / E2E: zrzuty kluczowych okien (Deploy, właściwości węzła, ustawienia) w `pl` do przeglądu językowego.

#### DoD specyficzne
- [ ] Słownik pojęć i rejestr zatwierdzone przed tłumaczeniem całości.
- [ ] Mechanizm liczby mnogiej `pl` potwierdzony w edytorze (zrzut/test) przed tłumaczeniem całości.
- [ ] Test zgodności w `npm test`, zielony.
- [ ] Przegląd językowy Zamawiającego zatwierdzony.
- [ ] Klucze z pakietów etapów 1–4 (w tym `layout.*`) obecne.
- [ ] Brak zmian w wartościach en-US i innych języków (poza `languages.pl`).

#### Ryzyka i alternatywy
- **Wolumen:** ~2310 tekstów JSON + ~13,3 tys. słów pomocy; przegląd językowy to wąskie gardło – paczki wg przestrzeni kluczy.
- **Automatyczne przełączenie na polski:** użytkownicy z przeglądarką `pl` zobaczą polski edytor bez akcji – formalnie zmiana względem 5.0.7 przy domyślnych ustawieniach (wymóg 3.2). Tak działa każdy nowy język w projekcie; rekomendacja: akceptować (bez ustawienia) – **pytanie**.
- **Liczba mnoga:** mieszane formaty (v3 w en-US, v1/v2 w `ru`) przy i18next 25 – ryzyko, że niektóre formy nie działają; wykryte przy okazji (en-US `_plural`) – zgłosić upstream osobno, nie poprawiać w Z-13.
- **Rozjazd po aktualizacji upstream:** nowe klucze en-US w kolejnych wersjach → test zgodności czerwony; to zamierzone (wymusza uzupełnienie), ale wymaga procesu utrzymania – **pytanie**, kto utrzymuje.
- **Pomoc węzłów HTML:** duży koszt; alternatywa – w pierwszej wersji tylko JSON, pomoc w drugiej fazie (zapasowanie per plik działa).
- **Jakość tłumaczenia AI:** łagodzenie – słownik, przegląd językowy, test placeholderów.

#### Podzadania
- [ ] Słownik pojęć + decyzja o rejestrze – S
- [ ] Potwierdzenie mechanizmu liczby mnogiej w edytorze – S
- [ ] Test zgodności kluczy (czerwony na starcie) – S
- [ ] Scalenie tłumaczenia Zamawiającego + `editor.json` – L
- [ ] `jsonata.json`, `infotips.json` – S
- [ ] `nodes/messages.json` – M
- [ ] `runtime.json` (jeśli w zakresie) – S
- [ ] Pomoc węzłów HTML (jeśli w zakresie) – L
- [ ] Przegląd językowy i poprawki – M

---

### Z-14 – Układ flow (dostosowanie istniejącej realizacji)

| Pole | Wartość |
|---|---|
| Etap / typ | 4 (krok 2.3 planu) / funkcja – propozycja Wykonawcy, **zrealizowana**, do dostosowania |
| Priorytet / ryzyko | P3 / średnie (duża zmiana `view.js`; ocena szans upstream – średnia) |
| Ustawienie | `editorTheme.flowLayout: { enabled: false }` (ZASADY §2.1) |
| Zależności | E-04 (atrybucja, gałęzie, DCO), Z-04 (część runtime w tych samych funkcjach), E-03/D-03 (testy edytora), Z-13 (`layout.*` w `pl`), D-06 (zakres) |
| Pliki | edytor: `editor-client/src/js/ui/view.js` (m.in. `getFlowLayoutOptions` `:1542-1560`, `getNodeOrientation` `:1608-1618`), `ui/view-layout.js` (nowy, eksport CommonJS `:476-477`), `ui/editors/flowLayout.js` (nowy), `ui/editors/panes/appearance.js`, `ui/editors/panes/flowProperties.js`, `ui/userSettings.js`, `ui/view-tools.js`, `ui/contextMenu.js`, `nodes.js`, `locales/en-US/editor.json` (14 kluczy `layout.*`); runtime: `runtime/lib/flows/util.js` (`diffNodes`), `runtime/lib/flows/index.js` (`copyFlowLayoutProperties` w `addFlow/getFlow/updateFlow`); `scripts/build/config.js`; do zmiany: `editor-api/lib/editor/theme.js:412-418` (przekazanie ustawienia), `node-red/settings.js` (sekcja `editorTheme` `:419+`) |
| Powiązania | FL-B-004…008, FL-T-001…007 ([../../flow-layout/BACKLOG.md](../../flow-layout/BACKLOG.md)), [DOKUMENTACJA](../../flow-layout/DOKUMENTACJA.md), [PROBLEMY](../../flow-layout/PROBLEMY.md) |

#### Weryfikacja stanu (gałąź `claude/loving-fermat-ftfo9h` względem `cd05a9a`)
Wynik: **funkcja działa; NIEZGODNA z wymaganiami ogólnymi zlecenia** w punktach poniżej.
- Funkcja (skrót z DOKUMENTACJA): układy `LR`/`TB`/`auto`, style linii `curved`/`orthogonal`, hierarchia węzeł (`o`) → flow (`layout`, `wireStyle` na `tab`/`subflow`) → ustawienia użytkownika (`editor.view["view-flow-layout"]`, `["view-wire-style"]`) → `LR`; geometria w `RED.viewLayout` (bez DOM); zmiana wyłącznie wizualna – deploy „Modified nodes” nie restartuje węzłów.
- Zmiany: 19 plików, +2212/−189 (`git diff --stat cd05a9a HEAD` dla `packages`, `test`, `package.json`, `CHANGELOG.md`, `scripts`).
- **Niezgodność 3.2 (domyślnie jak 5.0.7):** brak ustawienia – nowe kontrolki są zawsze widoczne: pola „Layout/Wires” we właściwościach flow (`flowProperties.js` → `RED.editor.flowLayout.create`), w wyglądzie subflow i „Ports” w wyglądzie węzła (`appearance.js`), sekcja „Flow layout” w ustawieniach użytkownika (`userSettings.js`), 3 pozycje menu kontekstowego (`contextMenu.js`), 3 akcje `core:set-selected-node-ports-*`/`core:reset-selected-node-ports` (`view-tools.js`). `settings.js` – brak opisu.
- **Niezgodność 3.3 (brak nazw):** atrybucja z nazwą firmy w nagłówkach `ui/view-layout.js:16-17`, `ui/editors/flowLayout.js:16-17` i w `CHANGELOG.md:3` (przenoszona przez build do `public/red/about` i `node-red/CHANGELOG.md` – pliki generowane, nieśledzone w git).
- **Niezgodność 3.8 (DCO):** 18 commitów autorstwa `Claude <noreply@anthropic.com>` bez `Signed-off-by`; commity mieszają kod i `design/` (np. `373ff93` – CHANGELOG + dokumentacja) → E-04.
- **Runtime (niezależne od ustawienia):** `diffNodes` pomija `o` dla wszystkich węzłów oraz `layout`/`wireStyle` dla `subflow`; `copyFlowLayoutProperties` przenosi `layout`/`wireStyle` w API pojedynczego flow. Dla flow bez tych właściwości zachowanie identyczne z 5.0.7. Kolizja `o` z właściwością węzła zewnętrznego jest mało prawdopodobna: wszystkie jednoliterowe nazwy są w `internalProperties` (`nodes.js:47-90`), a `registerType` usuwa je z `defaults` z ostrzeżeniem (`nodes.js:289-291`) – warunek `!defaults.hasOwnProperty("o")` w `appearance.js`/`nodes.js` jest więc praktycznie martwy (do uproszczenia).
- **Przekazanie ustawień do edytora:** `theme.js` buduje `themeSettings` selektywnie (`projects`, `multiplayer`, `keymap` – `:412-422`) → nowe `editorTheme.flowLayout` wymaga jawnego przekazania (wzorzec `multiplayer`), odczyt w edytorze `RED.settings.theme("flowLayout.enabled", false)`.
- **Testy:** `test/unit/@node-red/editor-client/ui/view-layout_spec.js` (56 bloków `describe/it`, w `npm test`), `runtime/lib/flows/index_spec.js` (+69), `util_spec.js` (+50); E2E `test/editor/e2e/flow_layout_e2espec.js` (Playwright, `describe.skip` bez Playwrighta, `:157`) – skrypt `test:e2e` **poza** `npm test`.
- **Otwarte pozycje FL:** FL-B-004 (P3, okno różnic), FL-B-005 (P4, nieprawidłowe wartości z importu), FL-B-006 (P4, istniejący błąd upstream), FL-B-007 (P4, podpowiedzi portów w TB), FL-B-008 (P4, obrócone etykiety linków w TB); FL-T-001…007 – nowe funkcje/proces; FL-T-004 (tłumaczenia `layout.*`) – oznaczone „Gotowe” do pracy, klucze tylko w en-US.

#### Specyfikacja
- **Cel:** funkcja układu flow dostępna po włączeniu ustawienia; przy domyślnych ustawieniach edytor bez nowych elementów UI; kod bez nazw firm; dostarczenie w gałęziach/PR zgodnie z wymaganiami zlecenia.
- **Wejścia:** `editorTheme.flowLayout.enabled` (`boolean`, domyślnie `false`; brak obiektu = `false`); dane flow: `layout`, `wireStyle` (`tab`, `subflow`), `o` (węzeł, `junction`); ustawienia użytkownika `view-flow-layout`, `view-wire-style`.
- **Wyjścia:**
  - `enabled: true` – zachowanie jak dziś na gałęzi;
  - `enabled: false` (**rekomendacja do zatwierdzenia**): brak kontrolek (pola we właściwościach flow/subflow/węzła, sekcja w ustawieniach użytkownika, pozycje menu kontekstowego, akcje `core:*-node-ports*` nierejestrowane); **flow z zapisanym układem nadal rysują się zgodnie z danymi** (dane mają pierwszeństwo; brak „cichej” zmiany wyglądu po imporcie) i dane są zachowywane przy zapisie, eksporcie, kopiowaniu i w Admin API; **ustawienia użytkownika (`view-flow-layout`, `view-wire-style`) są ignorowane** (domyślnie `LR`/`curved`) – nie są usuwane.
- **Niezmienniki:** przy `enabled: false` i flow bez `layout`/`wireStyle`/`o` rysowanie, eksport, deploy i Admin API identyczne jak w 5.0.7 (w tym ścieżka krzywej LR – `generateLinkPath` jak oryginał); runtime nie zależy od ustawienia (dane przechodzą zawsze); wartości poza `LR`/`TB`/`auto`, `curved`/`orthogonal` nie zmieniają rysowania (traktowane jak brak).
- **Przypadki błędów:** `editorTheme.flowLayout` nie-obiekt lub `enabled` nie-boolean → traktowane jak `false` (bez wyjątku); nieprawidłowe wartości w danych → FL-B-005 (zachowane, nieużywane, nieusuwane po cichu).
- **Skutki uboczne:** nowe ustawienie w `settings.js`; `RED.view.layout`, `RED.viewLayout`, `RED.editor.flowLayout` – nowe API edytora (zob. Ryzyka); klucze `layout.*` w `pl` (Z-13).

#### Projekt rozwiązania (minimalny)
1. `editor-api/lib/editor/theme.js`: przekazanie `theme.flowLayout` do `themeSettings` (wzorzec `multiplayer`, `:416-418`); test w `theme_spec.js`.
2. Edytor – jedna funkcja `RED.view.layout.isEnabled()` (`RED.settings.theme("flowLayout.enabled", false) === true`), używana przez: `flowLayout.create/apply` (no-op), `appearance.js` (wiersz „Ports”), `userSettings.js` (sekcja dodawana warunkowo), `contextMenu.js` (pozycje warunkowo), `view-tools.js` (rejestracja akcji warunkowo), `getFlowLayoutOptions` (pomija ustawienia użytkownika przy wyłączonym).
3. `settings.js` – zakomentowany przykład w `editorTheme`:
   ```js
   /** Flow layout options (top-to-bottom and automatic layouts, right-angle wires).
    * When disabled (default) the editor shows no layout controls; flows that
    * already contain layout properties are still drawn and saved unchanged. */
   //flowLayout: {
   //    enabled: false
   //},
   ```
4. Usunięcie atrybucji (E-04), uproszczenie martwego warunku `defaults.o` (opcjonalnie – osobny commit).
5. **Podział na PR/gałęzie** (każda z `npm test`):
   - **Z-14a runtime** – `diffNodes` (`o`, `layout`/`wireStyle` subflow) + `copyFlowLayoutProperties`; **razem z Z-04** albo nad Z-04 (te same funkcje `addFlow/getFlow/updateFlow`) – testy runtime;
   - **Z-14b geometria** – `ui/view-layout.js` + `scripts/build/config.js` + `view-layout_spec.js` (bez zmian zachowania: `view.js` korzysta z funkcji 1:1 dla LR);
   - **Z-14c UI** – `view.js`, `flowLayout.js`, panele, ustawienia, menu, akcje, `nodes.js` (eksport), `theme.js`, `settings.js`, `en-US`.
6. Otwarte błędy w zakresie (rekomendacja, **pytanie**): **FL-B-005** (integralność danych – w zakresie), **FL-B-004** (czytelność okna różnic; powiązane z P-02 tryb `prompt` – w zakresie jako osobny commit; dotyczy też `l`, `d`, `icon` – błąd upstream), **FL-B-007/008** (kosmetyka widoczna tylko przy `enabled: true` – opcjonalnie), **FL-B-006** (błąd upstream – poza zakresem, zgłoszenie osobno). FL-T-001/002/005/006 – poza zakresem zlecenia.
7. E2E: `test:e2e` zostaje poza `npm test` (wymóg „`npm test` bez błędów” spełniony testami jednostkowymi); E2E uruchamiane w CI osobno (FL-T-003) – wg D-03. E2E dopisuje start Node-RED z `editorTheme.flowLayout.enabled: true` oraz scenariusz z wyłączonym.
8. Zmiany w Express / editor-api poza `theme.js` – **brak**.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Układ flow sterowany ustawieniem editorTheme.flowLayout.enabled

  Scenariusz: Domyślne ustawienia – brak nowych elementów UI
    Zakładając settings.js bez editorTheme.flowLayout
    Kiedy otworzę właściwości flow, wygląd węzła, wygląd subflow, ustawienia użytkownika i menu kontekstowe węzła
    Wtedy nie ma pól "Layout", "Wires", "Ports", sekcji "Flow layout" ani pozycji "Ports: …"
    I lista akcji nie zawiera core:set-selected-node-ports-horizontal, -vertical ani core:reset-selected-node-ports

  Scenariusz: Domyślne ustawienia – flow bez danych układu jak w 5.0.7
    Zakładając editorTheme.flowLayout.enabled = false i flow bez layout, wireStyle i o
    Kiedy wyeksportuję flow i wdrożę go
    Wtedy eksport i plik flow są identyczne jak z 5.0.7
    I linie są rysowane ścieżką identyczną z 5.0.7

  Scenariusz: Wyłączone ustawienie – flow z zapisanym układem
    Zakładając editorTheme.flowLayout.enabled = false
    I zaimportowany flow z layout "TB" i węzłem z o "LR"
    Kiedy otworzę ten flow, zmienię nazwę węzła i wdrożę
    Wtedy flow jest rysowany góra → dół, a węzeł z portami lewo → prawo
    I layout i o są zachowane w pliku flow i w eksporcie

  Scenariusz: Wyłączone ustawienie – ustawienia użytkownika ignorowane
    Zakładając użytkownika z zapisanym view-flow-layout = "TB"
    I editorTheme.flowLayout.enabled = false
    Kiedy otworzę flow bez layout
    Wtedy flow jest rysowany lewo → prawo
    I zapisane ustawienie użytkownika nie zostało usunięte

  Scenariusz: Włączone ustawienie – pełna funkcja
    Zakładając editorTheme.flowLayout.enabled = true
    Kiedy ustawię we właściwościach flow układ "Top to bottom" i styl "Right angles"
    Wtedy flow rysuje się góra → dół z liniami pod kątem prostym
    I zmianę można cofnąć (Undo)

  Scenariusz: Zmiana samego układu nie restartuje węzłów (oba stany ustawienia)
    Zakładając flow z działającymi węzłami
    Kiedy zmienię tylko o węzła lub layout subflow i wdrożę "Modified nodes"
    Wtedy żaden węzeł nie jest restartowany

  Scenariusz: API pojedynczego flow zachowuje układ (oba stany ustawienia)
    Kiedy wyślę PUT /flow/:id z layout "TB"
    Wtedy GET /flow/:id zwraca layout "TB"

  Scenariusz: Nieprawidłowa wartość ustawienia
    Zakładając editorTheme.flowLayout = "yes"
    Wtedy edytor zachowuje się jak przy enabled = false, bez błędu w konsoli

  Scenariusz: Brak nazw firm w kodzie
    Kiedy przeszukam packages/ i test/ (po npm run build) pod kątem nazwy firmy Wykonawcy
    Wtedy nie ma żadnego wystąpienia
```

#### Testy
- `test/unit/@node-red/editor-api/lib/editor/theme_spec.js`: `passes editorTheme.flowLayout to the editor`, `omits flowLayout when not set`.
- `test/unit/@node-red/editor-client/ui/view-layout_spec.js` (istniejący): bez zmian; dopisać `LR curved path equals original generateLinkPath` (jeśli nie ma – do sprawdzenia).
- Nowy, wg E-03 (jeśli logika `isEnabled`/opcji flow zostanie wydzielona z `view.js`): `test/unit/@node-red/editor-client/ui/view-layout-options_spec.js`: `disabled ignores user settings`, `disabled uses flow layout data`, `invalid setting treated as disabled`, `invalid layout value treated as unset`.
- Runtime (istniejące): `runtime/lib/flows/util_spec.js` (`o`, layout subflow), `runtime/lib/flows/index_spec.js` (`addFlow/getFlow/updateFlow` z `layout`/`wireStyle`) – przeniesione do gałęzi Z-14a.
- E2E (poza `npm test`, wg D-03) `test/editor/e2e/flow_layout_e2espec.js`: dodać `disabled: no layout controls`, `disabled: flow with saved layout is drawn and kept`; istniejące przypadki uruchamiane z `enabled: true`.

#### DoD specyficzne
- [ ] Ustawienie `editorTheme.flowLayout.enabled` przekazane do edytora, opisane w `settings.js`, testy obu stanów.
- [ ] Zrzuty ekranu „przed (5.0.7) / po (enabled:false)” – brak różnic UI w raporcie.
- [ ] Brak atrybucji w `packages/`, `test/`, `CHANGELOG.md` (po `npm run build` – także pliki generowane).
- [ ] Wpis CHANGELOG bez nazw firm (opis funkcji + ustawienia).
- [ ] Trzy gałęzie/PR (Z-14a/b/c) – każda z `npm test`; Z-14a zintegrowana z Z-04.
- [ ] Decyzja o FL-B-004…008 zapisana; pozycje w zakresie zamknięte z testami.
- [ ] Klucze `layout.*` przekazane do Z-13.

#### Ryzyka i alternatywy
- **Rysowanie przy wyłączonym ustawieniu (decyzja):** rekomendacja „dane mają pierwszeństwo” odbiega od ścisłego „jak 5.0.7” tylko dla flow, które już zawierają `layout`/`o` (5.0.7 narysowałby je lewo → prawo, a przy ponownym zapisie/eksporcie pominąłby właściwości układu – DOKUMENTACJA, „Zgodność”). Alternatywa: przy wyłączonym ignorować dane przy rysowaniu, ale nadal je zachowywać – mniej spójne wizualnie między instancjami. → **pytanie**.
- **Runtime niezależny od ustawienia:** `copyFlowLayoutProperties` zmienia kontrakt `POST/PUT /flow` dla klientów wysyłających `layout`/`wireStyle` (5.0.7 je gubi). Rekomendacja: bez bramkowania (zachowanie danych, brak skutku dla klientów bez tych pól) – **pytanie**; alternatywa – bramkowanie ustawieniem runtime.
- **Publiczne API edytora** (`RED.view.layout`, `RED.viewLayout`, `RED.editor.flowLayout`) – zobowiązanie; alternatywa: oznaczyć jako wewnętrzne w pierwszej wersji.
- **Upstream:** duża zmiana `view.js` (+446/−189) – ryzyko konfliktów przy aktualizacji bazy; dyskusja z opiekunami przed PR (FL-T-007).
- **E2E poza `npm test`:** regresje UI wykrywane tylko w osobnym zadaniu CI (FL-T-003) – zależne od D-03.

#### Podzadania
- [ ] Przekazanie ustawienia (`theme.js`) + testy – S
- [ ] Bramkowanie kontrolek i ustawień użytkownika w edytorze + testy logiki – M
- [ ] `settings.js`, CHANGELOG, JSDoc API układu – S
- [ ] Podział na gałęzie Z-14a/b/c (z E-04) + `npm test` na każdej – M
- [ ] FL-B-005 (+ FL-B-004 wg decyzji) – M
- [ ] E2E obu stanów ustawienia (wg D-03) – S

---

### Z-15 – Instancja tylko edycyjna

| Pole | Wartość |
|---|---|
| Etap / typ | 4 / funkcja – propozycja Wykonawcy (wymóg z rozmowy: „edytor produkcyjny służy tylko do edycji, nie jest workerem”) |
| Priorytet / ryzyko | P2 / średnie (dotyka startu runtime i potoku wdrożenia) |
| Ustawienie | `editorOnly: false` (ZASADY §2.1; alternatywa: `runtimeState.autoStart` – semantyka miękka: nie startują przy uruchomieniu, ale mogłyby być uruchomione API); rekomendacja – semantyka ścisła: przy `editorOnly: true` flow nigdy nie startują; potwierdzenie D-02 |
| Zależności | E-01 (punkt w potoku: „start” pomijany – ZASADY §2.3 A krok 7), E-02 (stan `loaded`, T14), zgodność z P-01, Z-06, Z-08, Z-09, Z-10; D-02, D-06, D-13 |
| Pliki | `runtime/lib/flows/index.js:36-38` (`started`, `state`), `:104-110` (`load`, `safeMode`), `:118-133` (`setFlows`, `safeMode`), `:207-241` (gałąź `forceStart \|\| started`), `:272-345` (`start`: `safeMode` `:320-327`, `runtimeFlowState` `:329-338`); `runtime/lib/api/flows.js:66-100` (`setFlows`, `reload`), `:282-336` (`setState`, wymaga `runtimeState.enabled`); `editor-api/lib/admin/index.js:47-49` (`/flows/state`); `runtime/lib/api/settings.js:166-173` (`runtimeState` dla edytora); `editor-client/src/js/red.js:366-420` (powiadomienia `runtime-state`), `ui/deploy.js:77-80` (Start/Stop/Restart w menu Deploy); `node-red/settings.js:304-315` (`runtimeState`) |
| Powiązania | K8S-T-002 (rola editor), K8S-T-003 (debug/status z workerów – wtyczka), K8S-T-006 (publikacja) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **brak funkcji; dwa istniejące mechanizmy częściowe, oba nieodpowiednie**:
- **`runtimeFlowState`** (`flows/index.js:329-338`): przy `'stop'` `start()` emituje `runtime-state {state:'stop'}`, ustawia `started=false` i kończy. Wartość pochodzi z `settings.get('runtimeFlowState')` – **ustawienia runtime w magazynie** (zapis przez `setState`, `api/flows.js:311-327`). Przy wspólnym magazynie (edytor + workery) zatrzymałby też workery; obejście – wtyczka magazynu filtrująca klucz (ANALIZA §3).
- **`safeMode`** (`--safe`): flow wczytane, ale nieuruchamiane (`:320-327`), ale **pierwsze wdrożenie lub `reload` wyłącza tryb i startuje flow** (`:104-108`, `:124-132`, `api/flows.js:314-315`) – nie nadaje się na tryb trwały.
- Korzystna cecha: gdy `started === false` i brak `forceStart`, `setFlows` tylko zapisuje i emituje `runtime-deploy` (`:235-240`) – wdrożenie „zapis bez startu” już istnieje. `forceStart` przekazują: `load(true)` (`reload`, przełączenie projektu) i start runtime.
- `POST /flows/state` dostępne tylko przy `runtimeState.enabled === true` (`admin/index.js:48-49`).

#### Specyfikacja
- **Cel:** instancja z edytorem wczytuje flow i pozwala je edytować i wdrażać (zapis do magazynu), ale **nigdy nie wykonuje flow** i **nie zapisuje stanu wykonania do magazynu**.
- **Wejścia:** ustawienie (D-02; poniżej `editorOnly: true`); żądania wdrożenia (Admin API v1/v2, `/flow`, `reload`), `POST /flows/state`.
- **Wyjścia:**
  - start runtime: flow wczytane (typy, poświadczenia, brakujące moduły raportowane jak dziś), **brak startu**; zdarzenie `runtime-state` `{state:'stop', error:'editor-only', type:'info', text:'notification.info.editor-only'}` (nazwy kluczy do potwierdzenia), log `nodes.flows.editor-only`;
  - wdrożenie (każdy typ, w tym `reload`): zapis do magazynu (krok 5 potoku E-01), **bez kroków 6–7** (zatrzymanie/start), `runtime-deploy` jak dziś; odpowiedź `{rev}`;
  - `POST /flows/state {state:"start"}` → **409** `editor_only` (gdy endpoint włączony); `stop` → 200 bez zmian (nic nie działa);
  - edytor: trwałe powiadomienie „Flow nie są wykonywane na tej instancji – wdrożenie zapisuje je w magazynie” (zamykalne), w menu Deploy ukryte „Start/Stop/Restart flows” (Restart = przeładowanie z magazynu bez startu – do decyzji).
- **Niezmienniki:** przy braku ustawienia zachowanie identyczne z 5.0.7 (w tym `runtimeFlowState` i `safeMode`); instancja edycyjna **nie wywołuje** `settings.set('runtimeFlowState', …)`; nie odczytuje `runtimeFlowState` (stan workerów jej nie dotyczy); węzły nie są konstruowane (brak tras HTTP `http in`, timerów `inject`, połączeń MQTT itp.).
- **Przypadki błędów:** `editorOnly` razem z `safeMode` → `editorOnly` wygrywa (wdrożenie nie wyłącza trybu); błąd zapisu do magazynu → błąd jak dziś (500/400); próba uruchomienia przez API → 409; błędna wartość ustawienia (nie-boolean) → traktowana jak `false` + ostrzeżenie w logu (do potwierdzenia: czy raczej odmowa startu).
- **Skutki uboczne / ograniczenia (do opisu w dokumentacji):**
  - **debug** – brak komunikatów (węzły nie działają); przekazywanie z workerów – wtyczka (K8S-T-003, poza zakresem);
  - **status węzłów** – brak;
  - **przycisk `inject`** – `POST /inject/:id` zwróci 404 (węzeł nie istnieje) → komunikat błędu w edytorze; rekomendacja: przycisk nieaktywny przy `editor-only` (do decyzji – zmiana w `20-inject.html` lub ogólny mechanizm);
  - **panel kontekstu** – działa, jeśli magazyn kontekstu jest wspólny (np. własny `contextStorage`); przy `memory` pusty;
  - **trasy administracyjne węzłów** (`httpAdmin`) – rejestrowane w konstruktorach węzłów → niedostępne;
  - hooki/zdarzenia `flows:started`, `nodes-started` nie są emitowane – pluginy na nich oparte nie zadziałają.

#### Projekt rozwiązania (minimalny)
1. `flows/index.js` `start()`: po kontrolach typów/modułów i przed `safeMode`/`runtimeFlowState`: `if (settings.editorOnly === true) { log; emit runtime-state editor-only; state='stop'; started=false; return }` – ścieżka analogiczna do `runtimeFlowState` (`:333-338`), bez odczytu/zapisu ustawień w magazynie.
2. `load()`/`setFlows()`: przy `editorOnly` nie usuwać `safeMode` i nie przekazywać `forceStart` dalej niż do `start()` (który i tak kończy) – zachowana gałąź „zapis bez startu” (`:235-240`); `stop()` przy `started=false` już jest no-op (`:435`).
3. `api/flows.js` `setState`: `editorOnly` → 409 `editor_only` dla `start` (przed `settings.set`).
4. `api/settings.js`: `safeSettings.editorOnly = true` (dla edytora); edytor (`red.js`, `deploy.js`): powiadomienie i ukrycie Start/Stop.
5. Model stanu (E-02): osobny stan `loaded` (flow wczytane, nieuruchomione; przejścia `starting` → `loaded` (T14), `loaded` → `deploying`/`reloadPending` → `loaded`; nigdy `ready`) – zgodnie z ANALIZA §4.2 i kartą E-02.
6. Zgodność z pakietami:
   - **Z-08:** `/ready` na instancji edycyjnej → **200 w stanie `loaded`** (D-13 – jedna propozycja, wspólna z E-02/Z-08; pytanie 3 w etapie 3), `/live` jak zwykle; `deploying` → 503 na czas zapisu;
   - **Z-09:** instancja edycyjna (przy `deploy.reload.watch: true`) obsługuje `watchFlows` przez przeładowanie konfiguracji **bez startu** (`loaded` → `reloadPending` → `reloading` → `loaded`; edytory dostają `runtime-deploy` → powiadomienie o zmianie na serwerze); `preReload` wywoływany (brak drenażu – nic nie działa) – propozycja;
   - **P-01:** `deploy.response: "started"` na instancji edycyjnej = odpowiedź po zapisie (kroku startu brak), w odpowiedzi np. `{rev, started:false}` – **do potwierdzenia** (zmiana kształtu odpowiedzi tylko w trybie `started`);
   - **Z-06:** `preDeploy`/`postDeploy` wywoływane normalnie – instancja edycyjna to naturalne miejsce walidacji i wyzwalacza publikacji (K8S-T-006);
   - **Z-10:** koordynacja niepotrzebna (brak węzłów) – wtyczka koordynacji może nie być inicjowana (do potwierdzenia).
7. `settings.js`: opis ustawienia z listą ograniczeń.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Instancja tylko edycyjna

  Scenariusz: Domyślnie flow są wykonywane jak w 5.0.7
    Zakładając settings.js bez editorOnly
    Kiedy uruchomię Node-RED
    Wtedy flow startują, a runtimeFlowState i safeMode działają jak w 5.0.7

  Scenariusz: Start instancji edycyjnej
    Zakładając editorOnly = true i flow z węzłem inject co 1 s oraz http in /test
    Kiedy uruchomię Node-RED
    Wtedy flow są wczytane i widoczne w edytorze
    I węzeł inject nie wysyła komunikatów
    I GET /test zwraca 404
    I magazyn nie otrzymuje zapisu runtimeFlowState

  Scenariusz: Wdrożenie zapisuje bez uruchamiania
    Zakładając editorOnly = true
    Kiedy wdrożę zmieniony flow (full, nodes, flows oraz POST /flow i PUT /flow/:id)
    Wtedy magazyn zawiera nową wersję flow i odpowiedź zawiera nową rewizję
    I żaden węzeł nie został utworzony ani uruchomiony
    I edytory otrzymują zdarzenie runtime-deploy

  Scenariusz: Przeładowanie z magazynu bez uruchamiania
    Zakładając editorOnly = true
    Kiedy wyślę POST /flows z Node-RED-Deployment-Type: reload
    Wtedy konfiguracja jest wczytana z magazynu, a flow nie startują

  Scenariusz: Gotowość instancji edycyjnej (D-13)
    Zakładając editorOnly = true i health.enabled = true (Z-08)
    Kiedy flow zostaną wczytane
    Wtedy stan instancji to "loaded", a GET /health/ready zwraca 200
    I w trakcie wdrożenia GET /health/ready zwraca 503, a po nim znowu 200

  Scenariusz: Tryb bezpieczny nie wyłącza trybu edycyjnego
    Zakładając editorOnly = true i uruchomienie z --safe
    Kiedy wdrożę flow
    Wtedy flow nadal nie są uruchamiane

  Scenariusz: Próba uruchomienia przez API stanu
    Zakładając editorOnly = true i runtimeState.enabled = true
    Kiedy wyślę POST /flows/state {"state":"start"}
    Wtedy odpowiedź ma status 409 i kod editor_only
    I magazyn nie otrzymuje zapisu runtimeFlowState

  Scenariusz: Komunikat w edytorze
    Zakładając editorOnly = true
    Kiedy otworzę edytor
    Wtedy widzę komunikat, że flow nie są wykonywane na tej instancji
    I menu Deploy nie zawiera pozycji Start/Stop flows

  Scenariusz: Wspólny magazyn – workery nie są zatrzymywane
    Zakładając instancję edycyjną i worker korzystające z tego samego magazynu
    Kiedy uruchomię instancję edycyjną i wdrożę na niej flow
    Wtedy worker nie odczytuje stanu "stop" z magazynu i jego flow działają dalej
```

#### Testy
- `test/unit/@node-red/runtime/lib/flows/index_spec.js`: `editorOnly: start does not start flows`, `editorOnly: emits runtime-state editor-only`, `editorOnly: does not read or write runtimeFlowState`, `editorOnly: setFlows saves without starting (full/nodes/flows)`, `editorOnly: load(true) does not start`, `editorOnly: safeMode is not cleared by deploy`, `default: unchanged start behaviour`.
- `test/unit/@node-red/runtime/lib/api/flows_spec.js`: `setState start returns 409 editor_only`, `setState stop is no-op`, `reload in editorOnly does not start`.
- `test/unit/@node-red/runtime/lib/api/settings_spec.js`: `exposes editorOnly to the editor`, `omits editorOnly when not set`.
- `test/unit/@node-red/runtime/lib/state_spec.js` / `health_spec.js`: `editorOnly start ends in loaded`, `ready 200 in loaded`, `deploy in editorOnly returns to loaded`.
- `test/unit/@node-red/editor-api/lib/admin/flows_spec.js`: kontrakt `POST /flows/state` 409 (jeśli mapowanie kodu w editor-api wymaga zmian – do sprawdzenia).
- Integracyjny (jeśli wykonalny bez nowych zależności): runtime z atrapą magazynu – brak `saveSettings` z `runtimeFlowState`.
- Edytor (wg E-03): logika powiadomienia/ukrycia pozycji Deploy; E2E (D-03) – komunikat widoczny.

#### DoD specyficzne
- [ ] Decyzja D-02 (nazwa i semantyka) zapisana przed implementacją.
- [ ] Brak jakiegokolwiek zapisu `runtimeFlowState` z instancji edycyjnej (test na atrapie magazynu).
- [ ] Ograniczenia (debug, status, inject, kontekst, trasy admin węzłów, zdarzenia) opisane w `settings.js` i dokumentacji.
- [ ] Zachowanie z P-01, Z-08, Z-09 opisane w ich kartach (odsyłacze) i pokryte testami po ich realizacji.
- [ ] Teksty w `en-US` (+ `pl` w Z-13).

#### Ryzyka i alternatywy
- **Nazwa/semantyka (D-02):** `runtimeState.autoStart: false` łączy się z istniejącym obiektem `runtimeState`, ale sugeruje możliwość ręcznego startu (sprzeczne z wymogiem); `editorOnly: true` – jednoznaczne, nowy klucz najwyższego poziomu (jak `safeMode`). Rekomendacja Wykonawcy: semantyka ścisła; nazwa do decyzji.
- **Walidacja przy wdrożeniu:** dziś część błędów (konstruktory węzłów, brakujące moduły przy starcie) ujawnia się dopiero przy starcie – instancja edycyjna ich nie wykryje; walidacja musi przejść do `preDeploy` (Z-06) lub CI.
- **Przycisk `inject` i trasy admin węzłów:** komunikaty błędów mylące dla użytkownika; alternatywa – ogólny mechanizm „węzeł niedostępny na instancji edycyjnej” (więcej zmian w węzłach core).
- **Alternatywa bez zmian w rdzeniu:** wtyczka magazynu zwracająca `runtimeFlowState='stop'` tylko dla instancji edycyjnej (obejście z ANALIZA §3) – kruche (zależne od wewnętrznego klucza), `reload` i `setState` nadal mogą wystartować flow.
- **Projekty (`editorTheme.projects`):** przełączenie projektu woła `loadFlows(true)` – przy `editorOnly` nie startuje (test), ale zachowanie Projektów na instancji edycyjnej – do potwierdzenia.

#### Podzadania
- [ ] Decyzja D-02 + opis semantyki – S
- [ ] Runtime: `start`/`load`/`setFlows` + testy (czerwone najpierw) – M
- [ ] API: `setState` 409, `settings` dla edytora + testy – S
- [ ] Edytor: powiadomienie, menu Deploy (+ test wg E-03) – S
- [ ] `settings.js`, JSDoc, CHANGELOG, dokumentacja ograniczeń – S
- [ ] Uzgodnienie z kartami P-01, Z-08, Z-09 (zachowanie instancji edycyjnej) – S

---

### E-03 – Harness testów edytora

| Pole | Wartość |
|---|---|
| Etap / typ | 0 (karta w etapie 4) / przerobienie – infrastruktura testów |
| Priorytet / ryzyko | P1 / niskie |
| Ustawienie | brak |
| Zależności | D-03 (Playwright jako `devDependency`); warunek kryteriów odbioru P-02, Z-01, Z-12 („testy edytora”) |
| Pliki | wzorce: `test/unit/@node-red/editor-client/ui/search_spec.js` (upstream), `test/unit/@node-red/editor-client/ui/view-layout_spec.js` (nasz); moduły: `editor-client/src/js/ui/search.js:764-765`, `ui/view-layout.js:476-477` (eksport CommonJS); `package.json:17-31` (skrypty), `test/unit/_spec.js` (wyłącza `editor-client` z kontroli „każdy plik ma spec”); `test/editor/` (stare testy WebdriverIO `*_uispec.js`, `wdio.conf.js`, `scripts/install-ui-test-dependencies.sh`); `test/editor/e2e/flow_layout_e2espec.js` |
| Powiązania | FL-T-003 (E2E w CI), P-02, Z-01, Z-12, Z-14, Z-15 |

#### Weryfikacja stanu (kod 5.0.7 + gałąź)
Wynik: **CZĘŚCIOWO** – mechanizm istnieje, brak standardu i E2E w zależnościach.
- **Korekta WERYFIKACJA §Z-12:** test jednostkowy klienta istnieje już upstream – `search_spec.js` (commit upstream, nie nasz); nasz jest tylko `view-layout_spec.js`. Wzorzec: moduł kończy się `if (typeof module !== "undefined" && module.exports) { module.exports = RED.x; }`, test ustawia `global.RED` (atrapa, `sinon`), czyści `require.cache`, ładuje moduł przez `NR_TEST_UTILS.resolve(...)`.
- Testy w `test/unit/**/*_spec.js` są częścią `npm run mocha` → `npm test` (`package.json:20,26`).
- **Brak DOM w Node:** `jsdom` nie jest zależnością (brak w `package.json` i `node_modules`); jQuery jest tylko w `editor-client/src/vendor/jquery` (nie w `node_modules`) → testowalna jest tylko logika bez DOM/jQuery.
- `sinon` 11.1.2, `should` 13.2.3, `mocha` 11.8.0 – dostępne.
- E2E: Playwright **nie jest zależnością**; nasz test pomija się bez niego (`describe.skip`, `flow_layout_e2espec.js:157`); skrypt `test:e2e` (`package.json:31`) poza `npm test`. Upstream ma stare testy UI WebdriverIO (`test/editor/*_uispec.js`, `wdio.conf.js` z BrowserStack) instalowane `--no-save` skryptem `install-ui-test-dependencies.sh` (webdriverio 4) – nieużywane w `npm test` ani w CI (`.github/workflows/tests.yml` uruchamia tylko `npm run test`).
- `comms.js` i `ui/deploy.js` **nie mają** eksportu CommonJS (sprawdzone `grep module.exports`).

#### Specyfikacja
- **Cel:** jednolity, udokumentowany sposób testowania logiki klienta edytora w `npm test` bez nowych zależności, plus decyzja o E2E.
- **Wejścia:** moduł edytora w stylu IIFE `RED.x = (function(){…})()`.
- **Wyjścia:** (a) konwencja: eksport CommonJS na końcu modułu + wydzielanie logiki od DOM do funkcji czystych (lub `_test`-owych eksportów wewnętrznych tylko gdy konieczne); (b) helper testowy `test/unit/@node-red/editor-client/editor_test_helper.js` (atrapa `RED`: `settings`, `events`, `_`, `notify`, `actions`; ładowanie modułu ze świeżym cache; atrapa `WebSocket`/`$.ajax` przez `sinon`); (c) szablon testu i opis w `test/unit/@node-red/editor-client/README` lub w CONTRIBUTING sekcji testów (miejsce do potwierdzenia – README to dokument, tworzony tylko jeśli Zamawiający chce); (d) decyzja E2E (D-03).
- **Niezmienniki:** zachowanie edytora w przeglądarce bez zmian (eksport CommonJS jest martwym kodem w przeglądarce); minifikacja/concat w `scripts/build` działa (`module` niezdefiniowany w przeglądarce → warunek fałszywy); lint bez nowych błędów.
- **Przypadki błędów:** moduł zależny od DOM przy ładowaniu (np. `$(...)` na poziomie modułu) → test nie może go załadować – wymaga przeniesienia inicjalizacji do `init()`; brak Playwrighta → E2E pomijane z czytelnym komunikatem (nie błąd).
- **Skutki uboczne:** drobne zmiany w modułach testowanych (eksport, wydzielenie funkcji) – w pakietach, które ich potrzebują (Z-01: `comms.js`, P-02: `deploy.js`).

#### Projekt rozwiązania (minimalny)
1. Helper `editor_test_helper.js` (`loadEditorModule(path, mockRED)`, `createMockRED(overrides)`) – na podstawie `search_spec.js`/`view-layout_spec.js`.
2. Szablon testu (komentarz w helperze + przykład) – **przykład wykonywany w Z-01** (`comms_spec.js`: `does not send subscribe while auth pending`) lub **P-02** (`deploy_spec.js`) – w tamtych pakietach, nie tutaj.
3. E2E (jeśli D-03 = tak): `playwright` w `devDependencies` (wersja przypięta), skrypt `test:e2e` (już jest), wspólny helper startu Node-RED w procesie potomnym (wydzielony z `flow_layout_e2espec.js`), workflow CI osobny od `npm test` (FL-T-003). Jeśli D-03 = nie: E2E zostają opcjonalne (`--no-save`), a kryteria „test edytora” spełniane testami logiki + ręcznym scenariuszem w raporcie.
4. Stare testy WebdriverIO – bez zmian (poza zakresem; ewentualne usunięcie to decyzja upstream).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Harness testów edytora

  Scenariusz: Test logiki klienta w npm test bez nowych zależności
    Zakładając helper editor_test_helper.js i moduł edytora z eksportem CommonJS
    Kiedy uruchomię npm test
    Wtedy test modułu jest wykonywany w mocha z atrapą RED
    I package.json nie zawiera nowych zależności

  Scenariusz: Szablon zastosowany w pakiecie
    Zakładając realizację Z-01 (lub P-02)
    Wtedy test comms_spec.js (lub deploy_spec.js) korzysta z helpera
    I test jest czerwony bez poprawki i zielony z poprawką

  Scenariusz: Eksport CommonJS nie zmienia edytora
    Kiedy zbuduję edytor (npm run build) i otworzę go w przeglądarce
    Wtedy w konsoli nie ma błędów związanych z module/exports

  Scenariusz: E2E bez Playwrighta
    Zakładając brak Playwrighta w node_modules
    Kiedy uruchomię npm run test:e2e
    Wtedy testy są pominięte, a proces kończy się kodem 0

  Scenariusz: E2E z Playwrightem (D-03 = tak)
    Zakładając Playwright w devDependencies
    Kiedy uruchomię npm run test:e2e w CI
    Wtedy testy E2E się wykonują, a npm test pozostaje bez E2E
```

#### Testy
- `test/unit/@node-red/editor-client/editor_test_helper_spec.js` (opcjonalnie): `loads module with fresh cache`, `restores global RED after test`.
- Przykłady w pakietach: `test/unit/@node-red/editor-client/comms_spec.js` (Z-01), `test/unit/@node-red/editor-client/ui/deploy_spec.js` (P-02).
- E2E: refaktoryzacja `flow_layout_e2espec.js` na wspólny helper – przypadki bez zmian.

#### DoD specyficzne
- [ ] Helper i szablon w repozytorium, opis konwencji (miejsce wg decyzji).
- [ ] Brak nowych zależności bez D-03; przy D-03 = tak – tylko `devDependencies`, przypięta wersja, `verify-deps` przechodzi.
- [ ] Przynajmniej jeden test pakietu (Z-01 lub P-02) korzysta z helpera.
- [ ] `npm test` czas wykonania bez istotnego wzrostu (pomiar w raporcie).

#### Ryzyka i alternatywy
- **Ograniczony zakres testów jednostkowych** (brak DOM) – logika UI (okna, menu) wymaga E2E; alternatywa `jsdom` jako `devDependency` – nowa zależność (wymaga zgody, jak D-03).
- **Eksport CommonJS w kodzie edytora** – upstream już go stosuje (`search.js`), więc akceptowalny; ryzyko „dryfu” – wydzielanie logiki zmienia strukturę modułów.
- **Playwright** – duża zależność (przeglądarki pobierane osobno); alternatywa: istniejący WebdriverIO (przestarzały, BrowserStack) – odrzucona.

#### Podzadania
- [ ] Helper + szablon + opis konwencji – S
- [ ] Wydzielenie wspólnego helpera E2E – S
- [ ] Przy D-03 = tak: `devDependencies`, workflow CI E2E (FL-T-003) – M

---

### E-04 – Dostosowanie istniejącej gałęzi

> **Zmiana po decyzji D-19 (2026-10-03, po załączniku A):** zamiast usuwać atrybucję z kodu – **nagłówki o modyfikacji
> „Modified by Actuna Sp. z o.o.: <opis>” (pkt 4(b) licencji Apache 2.0) zostają w forku** i są dopisywane do każdego
> pliku zmienionego przez nas (m.in. `ui/view.js`, `nodes.js`, panele edytora, `runtime/lib/flows/index.js`, `util.js`),
> w formacie zgodnym z łatkami Zamawiającego. Nowe pliki (`view-layout.js`, `flowLayout.js`) zachowują nagłówek projektu
> + informację o autorstwie. Gałęzie do ewentualnego zgłoszenia upstream (dziś zablokowane – D-04) – bez nagłówków.
> Autor i `Signed-off-by`: Wojciech Repiński <wrepinski@gmail.com> (D-21). Kryterium „grep bez nazw firmy” obowiązuje
> tylko dla gałęzi upstream; w forku – kryterium: każdy zmieniony plik ma nagłówek o modyfikacji.

| Pole | Wartość |
|---|---|
| Etap / typ | 0 (karta w etapie 4) / przerobienie – proces dostarczenia |
| Priorytet / ryzyko | P1 / niskie (bez zmian zachowania) |
| Ustawienie | brak (ustawienie `editorTheme.flowLayout` – w Z-14) |
| Zależności | D-01 (baza 5.0.7 / 5.0.6), D-04 (CLA OpenJS, DCO, oznaczanie pracy z AI) |
| Pliki | `packages/node_modules/@node-red/editor-client/src/js/ui/view-layout.js:16-17`, `ui/editors/flowLayout.js:16-17`, `CHANGELOG.md:1-20`; generowane: `editor-client/public/red/red.js`, `public/red/about`, `node-red/CHANGELOG.md` (nieśledzone); `design/**` (dokumentacja, obrazy, nagranie `node-red-flow-layout-demo.mp4`) |
| Powiązania | FL-T-007, Z-14, ANALIZA §5 (3.3, 3.8) |

#### Weryfikacja stanu (gałąź `claude/loving-fermat-ftfo9h`)
Wynik: **POTWIERDZONE** – gałąź wymaga przebudowy przed dostarczeniem.
- `grep -i` nazwy firmy/osoby w `packages`, `test`, `CHANGELOG.md`, `package.json`, `scripts`: 2 nagłówki kodu (`view-layout.js:16`, `flowLayout.js:16`), `CHANGELOG.md:3`, oraz pliki generowane z buildu (`public/red/red.js` ×2, `public/red/about:3`, `node-red/CHANGELOG.md:3`). W `test/` – brak.
- Commity od bazy `cd05a9a`: 18, wszystkie z autorem `Claude <noreply@anthropic.com>`, z trailerem `Co-Authored-By`, **bez `Signed-off-by`**; kod i `design/` przemieszane (np. `373ff93` – CHANGELOG + dokumentacja).
- Baza gałęzi: `cd05a9a` (5.0.7 + 2 commity upstream po wydaniu: CSV, dokumentacja tcp) – nie jest tagiem wydania.
- `CHANGELOG.md` wspomina narzędzie E2E z nazwy (Playwright) – czy nazwy narzędzi stron trzecich podlegają wymogowi „bez nazw produktów” – **pytanie**.

#### Specyfikacja
- **Cel:** dostarczenie zgodne z wymaganiami 3.3 (bez nazw), 3.8 (gałąź na pakiet, DCO) i 3.5 (`npm test`), z atrybucją zachowaną wyłącznie w `design/` i opisie dostarczenia.
- **Wejścia:** obecna gałąź; decyzje D-01, D-04.
- **Wyjścia:** gałęzie pakietów od bazy (tag `5.0.7` lub `5.0.6` wg D-01), m.in. `z14a-flow-layout-runtime` (nad Z-04), `z14b-flow-layout-geometry`, `z14c-flow-layout-ui` (nazewnictwo do potwierdzenia); osobna gałąź dokumentacji `design/` (nie trafia do upstream ani do gałęzi pakietów); gałąź integracyjna; raport z wynikami `npm test` dla każdej gałęzi.
- **Niezmienniki:** zawartość merytoryczna kodu identyczna z obecną (poza usunięciem atrybucji i zmianami z Z-14); historia `claude/loving-fermat-ftfo9h` zachowana (nie nadpisujemy – nowe gałęzie).
- **Przypadki błędów:** konflikt przy przenoszeniu na 5.0.6 → opis w raporcie (ANALIZA §2: obszary pakietów bez różnic – do potwierdzenia cherry-pickiem); `npm test` czerwony z przyczyn środowiskowych (`ssh-keygen`) → uruchomienie w środowisku CI (E-05).
- **Skutki uboczne:** nowe identyfikatory commitów (odsyłacze w `design/flow-layout/BACKLOG.md` §8 do `556b053`, `036dd6a`, `e564e91` – zaktualizować lub zostawić z adnotacją).

#### Projekt rozwiązania (minimalny)
1. Usunąć 2 linie atrybucji z nagłówków (`view-layout.js`, `flowLayout.js`) – nagłówek licencyjny OpenJS pozostaje; z `CHANGELOG.md` usunąć linię z nazwą firmy i odwołanie do `design/`; wpis CHANGELOG przeredagować bez nazw (w formacie projektu – zob. Ryzyka).
2. Utworzyć gałęzie pakietów od bazy (D-01), przenosząc zmiany **jako nowe commity** w stylu projektu (`Editor: …`, `Runtime: …`, `Test: …`), z autorem = osoba odpowiedzialna Wykonawcy, `Signed-off-by` tej osoby (DCO) i oznaczeniem pracy z AI wg D-04 (np. trailer `Co-Authored-By` lub informacja w opisie PR).
3. `design/` – wyłącznie w osobnej gałęzi dokumentacji (lub repozytorium Wykonawcy); `.mp4` i obrazy poza gałęziami pakietów.
4. Dla każdej gałęzi: `npm ci && npm test` w środowisku z `ssh-keygen` (E-05); wynik (liczby testów) w raporcie.
5. Kontrola automatyczna: `grep -rniE "<nazwa firmy>|<nazwisko>" packages test CHANGELOG.md package.json scripts` po `npm run build` → pusty wynik (wzorzec przekazany w zadaniu, nie w kodzie).
6. CLA OpenJS – podpis osoby odpowiedzialnej przed jakimkolwiek PR upstream (D-04).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Dostosowanie istniejącej gałęzi do wymagań zlecenia

  Scenariusz: Brak nazw firmy i produktu w kodzie i testach
    Zakładając dowolną gałąź pakietu po npm run build
    Kiedy przeszukam packages/, test/, CHANGELOG.md, package.json i scripts/ pod kątem nazwy firmy i osoby Wykonawcy
    Wtedy nie ma żadnego wystąpienia

  Scenariusz: Atrybucja zachowana w dokumentacji projektowej
    Kiedy otworzę gałąź dokumentacji design/
    Wtedy dokumenty zawierają informację o autorstwie

  Scenariusz: Każda gałąź pakietu buduje się i przechodzi testy
    Zakładając gałąź pakietu utworzoną od bazy wybranej w D-01
    Kiedy uruchomię npm ci i npm test w środowisku z ssh-keygen
    Wtedy build, verify-deps, lint i coverage przechodzą

  Scenariusz: Commity z DCO
    Kiedy sprawdzę commity gałęzi pakietu
    Wtedy każdy ma Signed-off-by osoby odpowiedzialnej Wykonawcy
    I żaden nie zawiera zmian w design/

  Scenariusz: Brak niezwiązanych zmian
    Kiedy porównam gałąź pakietu z bazą
    Wtedy diff zawiera wyłącznie pliki z karty pakietu
```

#### Testy
- Brak nowych testów kodu; weryfikacja: `npm test` na każdej gałęzi, skrypt kontroli nazw (polecenie w raporcie; ewentualnie krok CI w E-05 – bez wpisywania nazw do repozytorium upstream), `git log --format='%(trailers:key=Signed-off-by)'` dla każdej gałęzi.

#### DoD specyficzne
- [ ] Atrybucja usunięta z kodu i CHANGELOG; obecna w `design/` i opisie dostarczenia.
- [ ] Gałęzie pakietów od bazy D-01; `design/` poza nimi.
- [ ] `Signed-off-by` na każdym commicie; oznaczenie pracy z AI wg D-04.
- [ ] `npm test` zielony na każdej gałęzi (raport z liczbami testów i ewentualnymi znanymi błędami środowiskowymi).
- [ ] Odsyłacze do commitów w `design/flow-layout/BACKLOG.md` zaktualizowane lub opisane.

#### Ryzyka i alternatywy
- **CHANGELOG w PR:** upstream redaguje CHANGELOG przy wydaniu (sekcje wersji); własna sekcja „Unreleased” może kolidować z praktyką projektu – wymóg zlecenia spełniamy wpisem w gałęzi pakietu, przy PR upstream ewentualnie przenosimy go do opisu PR – **do potwierdzenia**.
- **Autorstwo commitów:** obecne commity mają autora-narzędzie; DCO wymaga certyfikacji przez osobę – dlatego nowe commity z autorem-osobą (D-04).
- **Baza 5.0.6 vs 5.0.7:** przy 5.0.6 – brak poprawek bezpieczeństwa 5.0.7; przenoszalność do potwierdzenia przy cherry-pick.
- **Alternatywa:** `git rebase` z przepisaniem historii obecnej gałęzi – odrzucona (utrata śladu prac i odsyłaczy).

#### Podzadania
- [ ] Usunięcie atrybucji + przeredagowanie CHANGELOG – S
- [ ] Gałęzie pakietów Z-14a/b/c od bazy (z Z-14) – M
- [ ] Gałąź dokumentacji `design/` – S
- [ ] `npm test` na każdej gałęzi + raport – S
- [ ] Kontrola nazw i DCO (skrypt/krok CI z E-05) – S

---

### E-05 – Środowisko weryfikacji

| Pole | Wartość |
|---|---|
| Etap / typ | 0 (karta w etapie 4) / przerobienie – infrastruktura weryfikacji (CI, raport, gałąź integracyjna) |
| Priorytet / ryzyko | P1 / niskie (bez zmian w kodzie produktu) |
| Ustawienie | brak |
| Zależności | D-03 (opcjonalne zadanie `test:e2e`), D-04 (DCO – kontrola trailerów), E-03 (helper E2E), E-04 (kontrola nazw) |
| Pliki | `.github/workflows/tests.yml:1-31` (macierz Node 22, 24; `npm ci` + `npm run test`); nowy workflow (np. `.github/workflows/verify.yml` – nazwa do potwierdzenia) lub rozszerzenie `tests.yml`; `package.json:14-31` (skrypty `test`, `test:e2e`); `test/unit/@node-red/runtime/lib/storage/localfilesystem/projects/ssh/` (`index_spec.js`, `keygen_spec.js` – testy wymagające `ssh-keygen`); szablon raportu w `design/engine-extensions/` (poza gałęziami pakietów) |
| Powiązania | ANALIZA §5 (3.5, 3.8), §6.3; ZASADY §3 (DoD: `npm test`, raport); FL-T-003 (E2E w CI); E-04 |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE** – CI istnieje, brak raportu i gałęzi integracyjnej.
- `.github/workflows/tests.yml`: wyzwalacz `push`/`pull_request` na `main`, `dev`; `ubuntu-latest`; macierz `node-version: [22, 24]`; kroki `npm ci` → `npm run test` (`run-s build verify-deps lint coverage`, `package.json:26`). Obraz `ubuntu-latest` zawiera `ssh-keygen` (OpenSSH) – testy projektów przechodzą tam bez zmian.
- W kontenerze roboczym (Node 22.22.0) brak `ssh-keygen` → pada 5 testów `storage/localfilesystem/projects/ssh` (niezwiązane z pakietami; ANALIZA §5, 3.5).
- `test:e2e` (`package.json:31`) poza `npm test`; Playwright nie jest zależnością (E-03, D-03).
- Gałęzie pakietów spoza `main`/`dev` nie uruchamiają obecnego workflow (wyzwalacze tylko dla tych gałęzi).

#### Specyfikacja
- **Cel:** powtarzalna weryfikacja każdego pakietu i ich połączenia: pełne `npm test` w środowisku zgodnym z projektem, opcjonalne E2E, jednolity raport pakietu, gałąź integracyjna.
- **Wejścia:** gałęzie pakietów (ANALIZA §5, 3.8 – warstwowo w torze A, od bazy w torze B), gałąź integracyjna, decyzje D-03, D-04.
- **Wyjścia:**
  - zadanie CI „test”: macierz Node jak w `.github/workflows/tests.yml` (22, 24), `ubuntu-latest` z `ssh-keygen` (krok kontrolny `ssh-keygen -V` lub `command -v ssh-keygen` – brak → błąd zadania, nie pominięcie testów), `npm ci` → `npm test`; wyzwalane dla gałęzi pakietów i integracyjnej;
  - opcjonalne zadanie „test:e2e” (tylko przy D-03 = tak): instalacja przeglądarki Playwright, `npm run test:e2e`; osobne od `npm test`, niewymagane do scalenia (do decyzji);
  - kontrole dostarczenia: trailery `Signed-off-by` (D-04) i brak nazw firmy/osoby w `packages/`, `test/`, `CHANGELOG.md`, `package.json`, `scripts/` po `npm run build` (wzorzec przekazany jako sekret/zmienna CI, nie w repozytorium – E-04);
  - **szablon raportu pakietu** (ZASADY §3 „Raport”): co zmieniono (pliki, zakres), nowe ustawienia (nazwa, wartość domyślna, wpis w `settings.js`), wpływ na zgodność (zachowanie domyślne, kontrakty Admin API, kody błędów wg ZASADY §2.4), dowody weryfikacji (liczby testów: przechodzące/pominięte/nieudane dla `npm test` per wersja Node, pokrycie, wynik E2E, wynik kontroli nazw i DCO, odnośnik do przebiegu CI), czego nie zweryfikowano (z uzasadnieniem), zależności od innych pakietów;
  - **gałąź integracyjna** (np. `integration/engine-extensions` – nazwa do potwierdzenia): scalenia pakietów w kolejności ANALIZA §6.2, po każdym scaleniu pełne `npm test`; konflikty w plikach wyłączonych z reguły (`settings.js`, `CHANGELOG.md`, `locales/*`) rozwiązywane na niej.
- **Niezmienniki:** brak zmian w kodzie produktu i w istniejącym zachowaniu `tests.yml` dla `main`/`dev`; brak nowych zależności npm bez zgody (Playwright tylko przy D-03 = tak, `devDependencies`); `npm test` uruchamiane w całości (bez wyłączania testów środowiskowych).
- **Przypadki błędów:** brak `ssh-keygen` w środowisku → zadanie kończy się błędem z czytelnym komunikatem (nie ciche pominięcie 5 testów); niestabilny test (flaky) → odnotowany w raporcie z numerem przebiegu, bez wyłączania; E2E nieudane przy D-03 = tak → raport, scalenie wg decyzji.
- **Skutki uboczne:** dodatkowe przebiegi CI (czas, koszt) dla każdej gałęzi pakietu; workflow w repozytorium Wykonawcy/Zamawiającego – miejsce do potwierdzenia (pytanie 18).

#### Projekt rozwiązania (minimalny)
1. Workflow weryfikacji (osobny plik, by nie zmieniać `tests.yml` upstream): wyzwalacz dla gałęzi pakietów i integracyjnej, macierz Node 22/24, krok kontrolny `ssh-keygen`, `npm ci`, `npm test`, zapis podsumowania liczby testów jako artefakt.
2. Zadanie `test:e2e` warunkowe (D-03): instalacja przeglądarki, `npm run test:e2e`, artefakty zrzutów (FL-T-003).
3. Zadanie kontroli dostarczenia: `git log --format='%(trailers:key=Signed-off-by)'` dla zakresu gałęzi; kontrola nazw (E-04) po `npm run build`.
4. Szablon raportu pakietu (Markdown w `design/engine-extensions/` – poza gałęziami pakietów) z sekcjami jak w Wyjściach.
5. Gałąź integracyjna i procedura scaleń (kolejność ANALIZA §6.2, `npm test` po każdym scaleniu).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Środowisko weryfikacji

  Scenariusz: Pełne npm test w CI
    Zakładając gałąź pakietu wypchniętą do repozytorium
    Kiedy uruchomi się workflow weryfikacji
    Wtedy npm test (build, verify-deps, lint, coverage) wykona się dla Node 22 i 24
    I testy storage/localfilesystem/projects/ssh nie zostaną pominięte ani nie padną z powodu braku ssh-keygen

  Scenariusz: Brak ssh-keygen jest błędem środowiska
    Zakładając środowisko bez ssh-keygen
    Kiedy uruchomi się zadanie test
    Wtedy zadanie zakończy się błędem z komunikatem o brakującym ssh-keygen przed uruchomieniem testów

  Scenariusz: Opcjonalne E2E (D-03 = tak)
    Zakładając Playwright w devDependencies
    Kiedy uruchomi się zadanie test:e2e
    Wtedy testy E2E się wykonają, a wynik zadania test nie zależy od E2E

  Scenariusz: Raport pakietu
    Zakładając zakończony przebieg CI dla gałęzi pakietu
    Kiedy przygotuję raport wg szablonu
    Wtedy raport zawiera: co zmieniono, nowe ustawienia, wpływ na zgodność, liczby testów (per wersja Node) i czego nie zweryfikowano

  Scenariusz: Gałąź integracyjna
    Zakładając scalenie kolejnego pakietu do gałęzi integracyjnej w kolejności ANALIZA §6.2
    Kiedy uruchomi się workflow weryfikacji
    Wtedy pełne npm test przechodzi po każdym scaleniu

  Scenariusz: Kontrola DCO i nazw
    Zakładając gałąź pakietu
    Kiedy uruchomi się zadanie kontroli dostarczenia
    Wtedy każdy commit ma Signed-off-by, a w kodzie i testach nie ma nazw firmy i osoby Wykonawcy

  Scenariusz: Workflow upstream bez zmian
    Kiedy porównam .github/workflows/tests.yml z bazą
    Wtedy plik jest niezmieniony
```

#### Testy
- Brak nowych testów kodu. Weryfikacja: przebieg workflow na gałęzi próbnej (zielony dla Node 22 i 24; liczba testów zgodna z przebiegiem lokalnym w środowisku z `ssh-keygen`); przebieg kontrolny bez `ssh-keygen` (oczekiwany błąd kroku kontrolnego); przy D-03 = tak – przebieg `test:e2e` z `flow_layout_e2espec.js`.

#### DoD specyficzne
- [ ] Workflow weryfikacji działa dla gałęzi pakietów i integracyjnej; `tests.yml` bez zmian.
- [ ] Krok kontrolny `ssh-keygen`; 5 testów projektów/ssh wykonywanych i zielonych.
- [ ] Szablon raportu pakietu zatwierdzony i użyty w pierwszym pakiecie (P-04).
- [ ] Gałąź integracyjna utworzona, procedura scaleń opisana.
- [ ] Zadanie `test:e2e` wg D-03 (albo jawnie pominięte decyzją).

#### Ryzyka i alternatywy
- **Miejsce uruchamiania CI** (repozytorium Wykonawcy vs Zamawiającego) – wpływa na sekrety (wzorzec kontroli nazw) i dostęp do przebiegów – **pytanie**.
- **Czas CI:** pełne `npm test` × 2 wersje Node × liczba gałęzi pakietów; alternatywa: jedna wersja Node dla gałęzi pakietów, pełna macierz dla integracyjnej – **do decyzji**.
- **Alternatywa:** rozszerzenie `tests.yml` o gałęzie pakietów – prostsze, ale zmienia plik upstream (konflikt przy PR).
- Kontener roboczy bez `ssh-keygen` – lokalne przebiegi raportują 5 znanych błędów środowiskowych; dowodem odbioru jest przebieg CI.

#### Podzadania
- [ ] Workflow weryfikacji (macierz Node, `ssh-keygen`, `npm test`, artefakt z liczbami testów) – S
- [ ] Zadanie `test:e2e` (wg D-03) – S
- [ ] Kontrole DCO i nazw (wspólnie z E-04) – S
- [ ] Szablon raportu pakietu – S
- [ ] Gałąź integracyjna + procedura scaleń – S

---

## Pytania do Zamawiającego (etap 4)

1. **Z-12 – załącznik B:** kiedy zostanie przekazana lista punktów? Czy propozycje `RED.header`, rozszerzenia Deploy (pozycje menu, hook/zdarzenie przed wdrożeniem w edytorze), `RED.dialog` i dokumentacja `RED.view.annotations` pokrywają Wasze potrzeby (przycisk „Publikuj”, oznaczenie środowiska)?
2. **Z-12 – hook Deploy w edytorze:** czy ma służyć tylko UX (potwierdzenie), a walidacja wiążąca pozostaje w `preDeploy` (Z-06)?
3. **Z-12 – stabilność API:** jaki okres deprecjacji akceptujecie (rekomendacja: min. jedna wersja minor z ostrzeżeniem)?
4. **Z-13 – zakres:** czy obejmuje `runtime/locales/pl/runtime.json` (141 kluczy) oraz 36 plików pomocy węzłów HTML (~13,3 tys. słów), czy tylko JSON z `editor-client` i `nodes/messages.json`?
5. **Z-13 – liczba kluczy:** zlecenie podaje 1089 kluczy edytora; czysty 5.0.7 ma 1126 (1140 z kluczami Z-14). Z jakiej wersji pochodzi Wasze częściowe tłumaczenie (332 klucze)?
6. **Z-13 – rejestr i terminologia:** forma bezosobowa czy „Ty”? Które pojęcia zostają po angielsku (flow, subflow, Deploy)? Kto zatwierdza słownik?
7. **Z-13 – automatyczny wybór języka:** czy akceptujecie, że przeglądarki z językiem `pl` domyślnie pokażą polski edytor (standardowe zachowanie projektu, bez ustawienia)?
8. **Z-13 – utrzymanie:** kto uzupełnia tłumaczenie przy kolejnych wersjach upstream (test zgodności będzie czerwony przy nowych kluczach)? Czy zgłaszamy upstream wykryty problem z `_plural` en-US przy i18next 25?
9. **Z-14 – wyłączone ustawienie:** czy akceptujecie rekomendację „flow z zapisanym układem rysują się zgodnie z danymi, ukryte są tylko kontrolki, ustawienia użytkownika ignorowane”? Alternatywa: przy wyłączonym ignorować dane przy rysowaniu.
10. **Z-14 – runtime bez bramkowania:** czy przenoszenie `layout`/`wireStyle` w API pojedynczego flow i pomijanie `o`/układu subflow w `diffNodes` może działać niezależnie od ustawienia (brak skutku dla flow bez tych pól)?
11. **Z-14 – otwarte błędy:** zgoda na zakres FL-B-005 (wymagany) i FL-B-004 (zalecany); FL-B-007/008 opcjonalnie; FL-B-006 poza zakresem (zgłoszenie upstream)?
12. **Z-15 – nazwa i semantyka (D-02):** `editorOnly: true` (flow nigdy nie startują; ZASADY §2.1) czy `runtimeState.autoStart: false` (możliwy ręczny start)? Czy odpowiedź P-01 `started` na instancji edycyjnej ma mieć postać `{rev, started:false}`? (`/ready` instancji edycyjnej – jedno pytanie: etap 3, pytanie 3.)
13. **Z-15 – przycisk `inject` i trasy admin węzłów:** wystarczy opis ograniczeń, czy przycisk ma być nieaktywny na instancji edycyjnej?
14. **E-03 / D-03:** zgoda na Playwright w `devDependencies` (osobny skrypt `test:e2e`, poza `npm test`)? Jeśli nie – czy kryteria „test edytora” (P-02, Z-01, Z-12) mogą być spełnione testami logiki + scenariuszem ręcznym w raporcie?
15. **E-04 / D-04:** kto z Wykonawcy podpisuje DCO i CLA OpenJS; jak oznaczać pracę wspomaganą AI (trailer w commicie czy opis PR)?
16. **E-04 – nazwy narzędzi:** czy wymóg „bez nazw produktów” obejmuje nazwy narzędzi stron trzecich (np. narzędzia E2E) w CHANGELOG i komentarzach testów?
17. **E-04 – CHANGELOG:** wpis w gałęzi pakietu (sekcja bez wersji) czy wyłącznie w opisie dostarczenia (upstream redaguje CHANGELOG przy wydaniu)?
18. **E-05 – miejsce CI:** w którym repozytorium uruchamiamy workflow weryfikacji i gałąź integracyjną (Wykonawcy czy Zamawiającego)? Czy gałęzie pakietów wymagają pełnej macierzy Node (22, 24), czy wystarczy ona dla gałęzi integracyjnej? Czy zadanie `test:e2e` (przy D-03 = tak) ma blokować scalenie?

---

## Zmiany po przeglądzie

Poprawki z listy w [../PRZEGLAD.md](../PRZEGLAD.md) („Lista poprawek do naniesienia”), zgodnie z ZASADY §2.1, §2.4 i ANALIZA §4.2, §6.1, §7:

- **#11** – Z-15: jedna propozycja `/ready` – stan `loaded` (E-02) i 200 (D-13); scenariusz BDD „Gotowość instancji edycyjnej”, testy; pytanie 12 odsyła do jednego pytania w etapie 3 (pytanie 3); Projekt pkt 5 – stan `loaded` zamiast „do decyzji w E-02”.
- **#13** – nowa karta **E-05 – Środowisko weryfikacji** (CI z pełnym `npm test` dla Node 22/24 wg `.github/workflows/tests.yml`, krok kontrolny `ssh-keygen`, opcjonalne zadanie `test:e2e` wg D-03, szablon raportu pakietu, gałąź integracyjna); wiersz w tabeli podsumowania, kolejność realizacji, pytanie 18.
- **#29** – szacunki wyłącznie S/M/L: Z-12 „M (spike) + S–M na każdy punkt” → „M (spike + szkielet); każdy punkt z załącznika B – osobna karta”; E-03 „S (+ M dla E2E)” → „M”; dodatkowo podzadanie Z-14 „S/M” → „M”.
- **Dodatkowo (nazwy, ZASADY §2.1)** – Z-15: ustawienie `editorOnly` (alternatywa `runtimeState.autoStart` w nawiasie), zależności uzupełnione o E-02 (T14), D-13, ZASADY §2.3 A krok 7; zgodność z Z-09 uwzględnia `deploy.reload.watch` i stan `reloadPending`.
