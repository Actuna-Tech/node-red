# Backlog – układ flow i routing linii

> **Autorstwo:** rozwiązanie opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

Jeden plik, w którym prowadzimy błędy i zadania dla funkcjonalności układu flow.
Powiązane dokumenty: [ANALIZA.md](ANALIZA.md) · [DOKUMENTACJA.md](DOKUMENTACJA.md) ·
[PROBLEMY.md](PROBLEMY.md) (audyt backup/eksport/import) · [LOG-PRACY.md](LOG-PRACY.md).

---

## 1. Jak korzystać

### Identyfikatory

| Prefiks | Znaczenie | Przykład |
|---|---|---|
| `FL-B-nnn` | błąd (bug) | `FL-B-004` |
| `FL-T-nnn` | zadanie / nowa funkcjonalność / dług techniczny | `FL-T-002` |
| `FL-A-nnn` | temat do analizy (jeszcze nie wiadomo, czy to błąd lub zadanie) | `FL-A-001` |

Numerów nie używamy ponownie. Zamknięta pozycja zostaje w pliku (sekcja 8) z commitem, który ją zamknął.
W commitach i opisach PR podajemy identyfikator, np. `Fix diff rows for added properties (FL-B-004)`.

### Statusy

| Status | Znaczenie |
|---|---|
| **Nowe** | zgłoszone, nie przejrzane |
| **Do analizy** | wymaga ustalenia przyczyny lub zakresu |
| **Gotowe** | spełnia Definition of Ready (sekcja 2.1) – można brać do pracy |
| **W toku** | ktoś nad tym pracuje (wpisz kto) |
| **Do weryfikacji** | kod gotowy, czeka na przegląd / testy akceptacyjne |
| **Zamknięte** | spełnia Definition of Done (sekcja 2) |
| **Odrzucone** | nie będzie realizowane – z uzasadnieniem |

### Priorytety

| Priorytet | Kiedy |
|---|---|
| **P1 – krytyczny** | utrata danych lub układu, awaria edytora/runtime, brak obejścia |
| **P2 – wysoki** | błędne działanie funkcji, obejście uciążliwe |
| **P3 – średni** | błąd prezentacji lub UX, jest obejście; ważne usprawnienie |
| **P4 – niski** | kosmetyka, rzadki przypadek, pomysł na przyszłość |

### Waga (dla błędów)

**Krytyczna** (dane/układ tracone) · **Duża** (funkcja nie działa) · **Średnia** (działa, ale myli użytkownika) · **Mała** (kosmetyka).

---

## 2. Definition of Done (DoD)

### 2.0 Wspólne dla każdej pozycji

- [ ] Zmiana jest w gałęzi roboczej, zacommitowana z identyfikatorem pozycji i wypchnięta.
- [ ] `npm run lint` bez błędów, `npm run build` przechodzi.
- [ ] Testy jednostkowe edytora i runtime przechodzą
      (`npx mocha test/unit/_spec.js "test/unit/@node-red/editor-client/**/*_spec.js" "test/unit/@node-red/runtime/**/*_spec.js"`).
      Dopuszczalne są wyłącznie znane błędy środowiskowe (np. brak `ssh-keygen`) – wymienione w opisie.
- [ ] Testy E2E przechodzą (`npm run test:e2e`).
- [ ] Brak regresji układu lewo → prawo i stylu `curved`: istniejące flow rysują się i eksportują identycznie.
- [ ] Zaktualizowane: ten backlog (status, commit), [LOG-PRACY.md](LOG-PRACY.md), `CHANGELOG.md`;
      [DOKUMENTACJA.md](DOKUMENTACJA.md) / [ANALIZA.md](ANALIZA.md), jeśli zmienia się zachowanie lub architektura.
- [ ] Autorstwo oznaczone zgodnie z przyjętą formułą (nowe pliki, dokumentacja).

### 2.1 Definition of Ready (zanim pozycja trafi do „W toku”)

- [ ] Jasny opis problemu lub celu i zakres („co wchodzi / co nie wchodzi”).
- [ ] Dla błędu: kroki odtworzenia, wynik oczekiwany i rzeczywisty.
- [ ] Kryteria akceptacji / DoD specyficzne dla pozycji są spisane.
- [ ] Znane zależności i ryzyka są wpisane.

### 2.2 DoD – nowa funkcjonalność (`FL-T`)

- [ ] Spełnione kryteria akceptacji z karty zadania.
- [ ] Działa w układach `LR`, `TB` i `auto` oraz w stylach `curved` i `orthogonal` (lub karta mówi, czemu nie dotyczy).
- [ ] Działa w zakładce i w subflow; uwzględnia flow zablokowane.
- [ ] Ustawienia (jeśli są) przechodzą przez eksport, import, deploy, Admin API i undo/redo.
- [ ] Logika bez DOM jest w `RED.viewLayout` (lub innym module testowalnym) i ma testy jednostkowe.
- [ ] Scenariusz użytkownika pokryty testem E2E.
- [ ] Teksty UI w `locales/en-US/editor.json` (pozostałe języki – osobne zadanie lub w tej samej zmianie).
- [ ] Opis w [DOKUMENTACJA.md](DOKUMENTACJA.md) (dla użytkownika i API), w razie potrzeby nowe zrzuty / nagranie.

### 2.3 DoD – naprawa błędu (`FL-B`)

- [ ] Błąd odtworzony przed poprawką; kroki odtworzenia są w karcie.
- [ ] Ustalona i opisana przyczyna źródłowa (nie tylko objaw).
- [ ] Test, który **pada bez poprawki** i przechodzi z nią (jednostkowy lub E2E – najniższy możliwy poziom).
- [ ] Poprawka minimalna – bez zmian poza zakresem błędu.
- [ ] Sprawdzone pokrewne przypadki (ta sama przyczyna w innych miejscach) – naprawione albo zgłoszone jako osobne pozycje.
- [ ] Karta uzupełniona o commit i wynik weryfikacji; pozycja przeniesiona do sekcji 8.

### 2.4 DoD – analiza (`FL-A`)

- [ ] Wynik zapisany w karcie: co sprawdzono, jak (kod / przeglądarka / test), wniosek.
- [ ] Z analizy powstały pozycje `FL-B` / `FL-T` albo uzasadnienie, że nic nie trzeba robić.

---

## 3. Szablony

### 3.1 Błąd

```markdown
### FL-B-nnn – <krótki tytuł>

| Pole | Wartość |
|---|---|
| Status / Priorytet / Waga | Nowe / P3 / Średnia |
| Obszar | edytor – widok / edytor – okna / runtime / API / eksport-import / testy / dokumentacja |
| Wykryto | data, commit/wersja, kto, jak (test, przegląd kodu, użytkownik) |
| Środowisko | przeglądarka, system, wersja Node.js, ustawienia (układ, styl linii) |
| Pliki | ścieżki i funkcje |
| Powiązania | inne pozycje, commity, zgłoszenia |

**Kroki odtworzenia:** 1. … 2. … 3. …
**Oczekiwane:** …
**Rzeczywiste:** … (zrzut / log / fragment JSON)
**Przyczyna:** …
**Proponowane rozwiązanie:** …
**Obejście:** …
**DoD specyficzne:** - [ ] …
**Testy:** …
```

### 3.2 Zadanie / funkcjonalność

```markdown
### FL-T-nnn – <krótki tytuł>

| Pole | Wartość |
|---|---|
| Status / Priorytet | Nowe / P3 |
| Obszar | … |
| Zależności | … |

**Cel (dla kogo, po co):** …
**Zakres:** wchodzi … / nie wchodzi …
**Kryteria akceptacji:** - [ ] …
**Projekt / uwagi techniczne:** …
**Testy:** …
**Ryzyka:** …
```

---

## 4. Podsumowanie otwartych pozycji

| ID | Tytuł | Typ | Status | Priorytet | Waga | Obszar |
|---|---|---|---|---|---|---|
| [FL-B-004](#fl-b-004--okno-różnic-nie-pokazuje-dodanych-właściwości-układu) | Okno różnic nie pokazuje dodanych właściwości układu | błąd | Do weryfikacji (zrobione: `925b091`) | P3 | Średnia | edytor – okna |
| [FL-B-005](#fl-b-005--nieprawidłowe-wartości-układu-z-importu) | Nieprawidłowe wartości układu z importu | błąd | Do weryfikacji (zrobione: `1116d4f`) | P4 | Mała | eksport-import |
| [FL-B-006](#fl-b-006--dopasowanie-subflow-zależne-od-kolejności-kluczy) | Dopasowanie subflow zależne od kolejności kluczy | błąd (istniejący w Node-RED) | Do weryfikacji (zrobione: `6feb771`) | P4 | Mała | eksport-import |
| [FL-B-007](#fl-b-007--podpowiedzi-etykiet-portów-w-układzie-tb) | Podpowiedzi etykiet portów w układzie TB | błąd | Do weryfikacji (zrobione: `d28848d`) | P4 | Mała | edytor – widok |
| [FL-B-008](#fl-b-008--obrócone-etykiety-linków-do-innych-zakładek-w-tb) | Obrócone etykiety linków do innych zakładek w TB | błąd | Do weryfikacji (zrobione: `122cfdc`) | P4 | Mała | edytor – widok |
| [FL-B-009](#fl-b-009--flow-z-ustawieniem-domyślnym-edytora-nie-przenosi-wyglądu) | Flow z ustawieniem domyślnym edytora nie przenosi wyglądu | błąd | Do weryfikacji (zrobione: `cf95b28`) | **P2 (biznes: priorytet 1)** | Średnia | eksport-import |
| [FL-B-011](#fl-b-011--dopasowanie-subflow-zależne-od-kolejności-węzłów) | Dopasowanie subflow zależne od kolejności węzłów | błąd (istniejący w Node-RED) | Nowe | P4 | Mała | eksport-import |
| [FL-B-012](#fl-b-012--błąd-w-konsoli-przy-starcie-edytora-z-włączonym-układem) | Błąd w konsoli przy starcie edytora z włączonym układem | błąd | Do weryfikacji (zrobione 2026-10-03) | P4 | Mała | edytor – ustawienia |
| [FL-B-010](#fl-b-010--import-flow-o-tym-samym-identyfikatorze-tylko-jako-kopia) | Import flow o tym samym identyfikatorze – tylko jako kopia (brak „zastąp”) | funkcja | Do weryfikacji (zrobione: `bcf672a`) | P2 (biznes: priorytet 1) | Średnia | eksport-import |
| [FL-T-001](#fl-t-001--automatyczne-rozmieszczanie-węzłów) | Automatyczne rozmieszczanie węzłów | funkcja | Nowe | P3 | – | edytor – widok |
| [FL-T-002](#fl-t-002--routing-omijający-wszystkie-węzły) | Routing omijający wszystkie węzły | funkcja | Nowe | P3 | – | edytor – widok |
| [FL-T-003](#fl-t-003--testy-e2e-w-ci) | Testy E2E w CI | dług techniczny | Gotowe | P2 | – | testy |
| [FL-T-004](#fl-t-004--tłumaczenia-tekstów) | Tłumaczenia tekstów | zadanie | Gotowe | P4 | – | edytor – okna |
| [FL-T-005](#fl-t-005--domyślna-orientacja-w-definicji-typu-węzła) | Domyślna orientacja w definicji typu węzła | funkcja | Nowe | P4 | – | edytor / API węzłów |
| [FL-T-006](#fl-t-006--szybka-zmiana-układu-z-menu-zakładki) | Szybka zmiana układu z menu zakładki | funkcja | Nowe | P4 | – | edytor – okna |
| [FL-T-007](#fl-t-007--przygotowanie-zmian-do-zgłoszenia-w-node-rednode-red) | Przygotowanie zmian do zgłoszenia w node-red/node-red | zadanie | Nowe | P4 | – | proces |

**Zakres po decyzjach (2026-10-03, [REJESTR-DECYZJI](../engine-extensions/REJESTR-DECYZJI.md)):** FL-B-004, 005, 006, 007, 008 oraz FL-B-009 (z decyzji B-01) – **wszystkie w zakresie Z-14** (R-03). Przy `editorTheme.flowLayout.enabled: false` flow z zapisanym układem rysują się wg danych, ukryte są tylko kontrolki (R-01); części runtime (API flow, `diffNodes`) działają zawsze (R-02).

Sekcja 7 (tematy do analizy) czeka na listę do przeanalizowania.

---

## 5. Karty – błędy (`FL-B`)

### FL-B-004 – Okno różnic nie pokazuje dodanych właściwości układu

| Pole | Wartość |
|---|---|
| Status / Priorytet / Waga | Do weryfikacji (zrobione 2026-10-03, commit `925b091`) / P3 / Średnia |
| Obszar | edytor – okna (Review Changes, różnice commitów w Projektach) |
| Zakres | **w zakresie Z-14** (R-03, 2026-10-03) |
| Wykryto | 2026-10-03, audyt eksport/import ([PROBLEMY.md](PROBLEMY.md) P2), odtworzone w przeglądarce |
| Środowisko | Chromium, Node.js 22, flow demo `design/flow-layout/demo/demo-flows.json` |
| Pliki | `editor-client/src/js/ui/diff.js` – `createNodePropertiesTable` |
| Powiązania | dotyczy też innych właściwości spoza `defaults` (`l`, `d`, `icon`) – błąd istniejący w Node-RED |

**Kroki odtworzenia:**
1. Uruchom Node-RED z flow demo, otwórz edytor.
2. Przesuń dowolny węzeł (lokalna, niewdrożona zmiana – bez niej edytor sam wczyta zmiany z serwera).
3. Z innego klienta (lub `POST /flows`) wdroż flow, w którym zakładka `d1` ma `"layout": "TB"`, a węzeł `a3` ma `"o": "LR"`.
4. W edytorze: powiadomienie o zmianach na serwerze → *Review changes*.

**Oczekiwane:** w „Flow Properties” wiersz `layout` (brak → `"TB"`), w węźle „modify” wiersz `o` (brak → `"LR"`).
**Rzeczywiste:** oba elementy oznaczone jako „changed” po stronie zdalnej, ale bez wierszy z tymi właściwościami – nie widać, co się zmieniło.
**Przyczyna:** lista wierszy powstaje z `Object.keys(node)` wersji **bazowej** i `def.defaults`; właściwość, której nie było w wersji bazowej, nie dostaje wiersza.
**Proponowane rozwiązanie:** lista wierszy jako suma kluczy wersji bazowej, lokalnej i zdalnej (z pominięciem `x`, `y`, `w`, `h`, `z`, `wires`, `id`, `type`, `inputLabels`, `outputLabels` – te mają osobną obsługę).
**Obejście:** scalanie działa poprawnie; zmianę można sprawdzić w eksporcie JSON.
**DoD specyficzne:**
- [ ] Wiersze `layout`, `wireStyle` (zakładka, subflow) i `o` (węzeł) widoczne, gdy właściwość dodano, zmieniono lub usunięto lokalnie lub zdalnie.
- [ ] Liczniki zmian i oznaczenia konfliktów uwzględniają te wiersze.
- [ ] Wynik scalania bez zmian (test potwierdza, że zdalny `layout`/`o` i lokalne przesunięcie są zachowane).
- [ ] Sprawdzony widok różnic commitów w Projektach (ten sam komponent).

**Testy:** E2E – scenariusz z kroków odtworzenia (pada bez poprawki), asercje na wiersze tabeli i wynik Merge.

**Wynik (2026-10-03, `925b091`):** lista wierszy wydzielona do `RED.diff.getNodePropertyNames` – suma kluczy wersji
bazowej, definicji typu oraz wersji lokalnej i zdalnej (bez `credentials` i właściwości z osobnymi wierszami); kolejność
dotychczasowych wierszy bez zmian. Liczniki zmian i konflikty liczone w tej samej pętli, więc obejmują nowe wiersze.
Testy jednostkowe `test/unit/@node-red/editor-client/ui/diff_spec.js`: 5 testów padało na dotychczasowej logice (wydzielonej
bez zmian), przechodzą z poprawką; test scalania (zdalne `layout`/`o` + lokalne przesunięcie) potwierdza wynik Merge bez
zmian. Widok różnic commitów w Projektach używa tej samej funkcji (`createNodePropertiesTable`) – nie sprawdzony w
przeglądarce. E2E nie uruchomione (brak Playwrighta w środowisku).

### FL-B-005 – Nieprawidłowe wartości układu z importu

| Pole | Wartość |
|---|---|
| Status / Priorytet / Waga | Do weryfikacji (zrobione 2026-10-03, commit `1116d4f`) / P4 / Mała |
| Obszar | eksport-import, edytor – okna |
| Zakres | **w zakresie Z-14** (R-03, 2026-10-03) |
| Wykryto | 2026-10-03, przegląd kodu ([PROBLEMY.md](PROBLEMY.md) P3) – nie odtworzone w przeglądarce |
| Pliki | `ui/view.js` – `getFlowLayoutOptions`, `getNodeOrientation`; `ui/editors/flowLayout.js`; `ui/editors/panes/appearance.js` |

**Kroki odtworzenia:** 1. Zaimportuj flow z `"layout": "XY"` na zakładce (lub `"o": "XY"` na węźle). 2. Otwórz właściwości flow. 3. Kliknij *Done* bez zmian.
**Oczekiwane:** ostrzeżenie o nieznanej wartości; wartość nie znika bez wiedzy użytkownika.
**Rzeczywiste (wg kodu):** flow rysuje się w układzie domyślnym, pole wyboru jest puste, po *Done* wartość zostaje usunięta (zapis w historii zmian).
**Przyczyna:** brak walidacji przy imporcie; pole wyboru nie ma opcji dla nieznanej wartości.
**Proponowane rozwiązanie:** w polu wyboru pokazać nieznaną wartość jako osobną opcję „(nieznana: XY)”; opcjonalnie ostrzeżenie w konsoli/powiadomieniu przy imporcie.
**DoD specyficzne:**
- [ ] Najpierw odtworzyć w przeglądarce i zapisać wynik w karcie.
- [ ] Nieznana wartość nie jest usuwana bez akcji użytkownika.
- [ ] Rysowanie dalej używa układu domyślnego dla nieznanej wartości.

**Testy:** E2E – import z błędną wartością, otwarcie i zamknięcie właściwości, eksport zawiera tę samą wartość.

**Wynik (2026-10-03, `1116d4f`):** odtworzone na poziomie jednostkowym (nie w przeglądarce – brak Playwrighta/przeglądarki
w środowisku): atrapa `select` zachowująca się jak przeglądarka (brak pasującej opcji → `val()` = `null`) – *Done* bez
zmian usuwał `layout`/`wireStyle`. Poprawka: `RED.viewLayout.addUnknownOption` dodaje opcję „Unknown value: XY”
(`layout.unknownValue`), formularz porównuje wartości jako tekst – właściwość zmienia się tylko po wyborze innej wartości.
Dotyczy właściwości flow, wyglądu subflow i orientacji portów węzła (`appearance.js`). Rysowanie bez zmian (nieznana
wartość → układ domyślny); eksport zachowuje wartość. Testy: `ui/editors/flowLayout_spec.js` (3 padały bez poprawki),
`ui/view-layout_spec.js` – `addUnknownOption`. Ostrzeżenie przy imporcie (opcjonalne) – nie realizowane.

### FL-B-006 – Dopasowanie subflow zależne od kolejności kluczy

| Pole | Wartość |
|---|---|
| Status / Priorytet / Waga | Do weryfikacji (zrobione 2026-10-03, commit `6feb771`) / P4 / Mała |
| Obszar | eksport-import |
| Zakres | **w zakresie Z-14** (R-03, 2026-10-03) – analiza i poprawka w forku |
| Wykryto | 2026-10-03, przegląd kodu ([PROBLEMY.md](PROBLEMY.md) P4) |
| Pliki | `editor-client/src/js/nodes.js` – `checkForMatchingSubflow` |
| Powiązania | błąd istniejący w Node-RED – nowe właściwości go nie powodują |

**Opis:** przy imporcie edytor szuka istniejącego, identycznego subflow, porównując tekst JSON. Ten sam subflow z kluczami w innej kolejności (np. `layout` przed `color` – edycja ręczna, inne narzędzia) nie zostanie rozpoznany i powstanie duplikat / konflikt.
**Do ustalenia w analizie:** odtworzenie i skala problemu dla użytkowników (pliki generowane przez narzędzia). **Po R-03:** błąd w zakresie – poprawka w forku; zgłoszenie do node-red/node-red niemożliwe do czasu zniesienia blokady D-04.
**Proponowane rozwiązanie:** porównanie po znormalizowanych obiektach (`RED.utils.compareObjects` lub JSON z posortowanymi kluczami).
**DoD specyficzne:** - [x] Wynik analizy w karcie; - [x] poprawka (R-03) z testem jednostkowym/E2E z odwróconą kolejnością kluczy.

**Wynik analizy (2026-10-03):** potwierdzone w kodzie i testem jednostkowym. `checkForMatchingSubflow` (`nodes.js`)
jest wywoływane przy imporcie subflow, którego identyfikator **nie** koliduje z istniejącym (inna instancja, wklejenie
z nowymi id, biblioteka, MCP/CI) – przy kolizji decyduje okno konfliktu (`importMap`). Funkcja porównuje
`JSON.stringify` importowanego subflow z eksportem istniejącego, więc ta sama treść z kluczami w innej kolejności
(np. `layout` przed `color`, plik edytowany ręcznie lub generowany przez narzędzie) nie jest rozpoznana i powstaje
duplikat subflow. Skala: eksporty z edytora mają stałą kolejność (`convertSubflow`), więc problem dotyczy plików
spoza edytora – w priorytecie 1 (import z MCP/CI) realny. Błąd wersji bazowej 5.0.7; ryzyko regresji poprawki niskie
(porównanie staje się niezależne tylko od kolejności kluczy obiektów – kolejność elementów tablic, wartości i
zestaw właściwości nadal muszą się zgadzać).
**Wynik (2026-10-03, `6feb771`):** poprawka minimalna – obie strony porównania przez `stringifySorted` (JSON z
posortowanymi kluczami obiektów, tablice bez zmian); podmiana identyfikatorów węzłów bez zmian. Testy
`nodes_spec.js` „matching an imported subflow with properties in another order (FL-B-006)”: 2 padały bez poprawki
(odwrócona kolejność kluczy, także w `in`/`out`; `layout` przed pozostałymi), 2 strażnicze (brak modyfikacji
importowanego obiektu, brak dopasowania przy innej wartości). Pokrewny przypadek – kolejność **węzłów** wewnątrz
subflow (podmiana id po pozycji) – osobna pozycja FL-B-011. E2E – nie dodano (logika w całości w teście jednostkowym).

### FL-B-007 – Podpowiedzi etykiet portów w układzie TB

| Pole | Wartość |
|---|---|
| Status / Priorytet / Waga | Do weryfikacji (zrobione 2026-10-03, commit `d28848d`) / P4 / Mała |
| Obszar | edytor – widok |
| Wykryto | 2026-10-03, przegląd kodu przy implementacji |
| Pliki | `ui/view.js` – `portMouseOver` (pozycja i kierunek `showTooltip`) |
| Zakres | **w zakresie Z-14** (R-03, 2026-10-03); po R-01 widoczny także przy `flowLayout.enabled: false` dla flow z zapisanym układem TB |

**Kroki odtworzenia:** 1. Flow w układzie *Top to bottom*. 2. Węzeł z etykietami portów (Appearance → Port labels). 3. Najedź na port.
**Oczekiwane:** podpowiedź nad wejściem (u góry) i pod wyjściem (u dołu), nie zasłania węzła.
**Rzeczywiste (wg kodu):** podpowiedź pojawia się z lewej (wejście) / prawej (wyjście) strony portu – jak w układzie poziomym.
**DoD specyficzne:** - [x] Odtworzyć (test E2E – zrzut nie dołączony); - [x] pozycja zależna od orientacji węzła (`getNodeOrientation`, równoważne kierunkowi `dir` z `getPortPosition`); - [x] LR bez zmian.
**Testy:** E2E – pozycja elementu `.red-ui-flow-port-tooltip` względem portu w TB i LR.

**Wynik (2026-10-03, `d28848d`):** odtworzone testem E2E (podpowiedź wyjścia w TB nad dolną krawędzią portu –
padał bez poprawki). Przyczyna: `portMouseOver` zawsze wywoływał `showTooltip` z kierunkiem `left`/`right`.
Poprawka: `RED.viewLayout.getPortTooltipPosition(pos, portType, orientation)` – LR jak dotąd (`-2/+12`, `left`/`right`),
TB: wejście `top` (nad portem), wyjście `bottom` (pod portem); `showTooltip` dostał kierunek `bottom` (lustrzane
odbicie `top`). Dotyczy też portów subflow (orientacja z `getNodeOrientation`). Testy: `view-layout_spec.js` (4,
padały bez poprawki), E2E „port label tooltips (FL-B-007)” – TB (pozycja, wyśrodkowanie, etykieta wewnątrz) i LR.

### FL-B-008 – Obrócone etykiety linków do innych zakładek w TB

| Pole | Wartość |
|---|---|
| Status / Priorytet / Waga | Do weryfikacji (zrobione 2026-10-03, commit `122cfdc`) / P4 / Mała |
| Obszar | edytor – widok |
| Wykryto | 2026-10-03, przy implementacji (świadome uproszczenie) |
| Pliki | `ui/view.js` – rysowanie `.red-ui-flow-link-off-flow` (transformacja `rotate(90)`) |
| Zakres | **w zakresie Z-14** (R-03, 2026-10-03); po R-01 widoczny także przy `flowLayout.enabled: false` dla flow z zapisanym układem TB |

**Kroki odtworzenia:** 1. Flow w układzie TB z węzłem `link out` połączonym z `link in` na innej zakładce. 2. Zaznacz węzeł `link out`.
**Oczekiwane:** odgałęzienie wychodzi z dołu, nazwy zakładek docelowych czytelne poziomo.
**Rzeczywiste:** całe odgałęzienie jest obrócone o 90°, razem z tekstem nazw zakładek (tekst pionowy).
**Proponowane rozwiązanie:** obracać tylko geometrię linii, a etykiety pozycjonować poziomo (osobna transformacja tekstu).
**DoD specyficzne:** - [x] Tekst poziomy w TB; - [x] klikanie w etykietę dalej przenosi do zakładki; - [x] LR bez zmian.

**Wynik (2026-10-03, `122cfdc`):** odtworzone w przeglądarce (zrzut: tekst „Horizontal” pionowo pod węzłem
`link out`) i testem E2E (padał bez poprawki). **Odstępstwo od proponowanego rozwiązania:** samo obrócenie tekstu
z powrotem dawałoby poziome etykiety rozstawione w poziomie co 30 px (nakładające się przy kilku zakładkach)
w obróconych ramkach – zamiast tego w TB nic nie jest obracane: odgałęzienie wychodzi z dołu (`link out`) / od góry
(`link in`) węzła i skręca do etykiet narysowanych jak w LR, ułożonych jedna pod drugą (od węzła na zewnątrz).
Geometria w `RED.viewLayout.getOffFlowLinkGeometry(s, count, orientation)`; dla LR identyczna z wersją bazową
(test porównuje ścieżki z oryginalnym wzorem). Klucz danych grupy zawiera orientację węzła – po zmianie orientacji
odgałęzienie jest rysowane od nowa. Testy: `view-layout_spec.js` (6, padały bez poprawki), E2E „links to other flows
(FL-B-008)” – TB (brak obrotu, tekst poziomy pod węzłem, kliknięcie przenosi do zakładki) i LR.

---

### FL-B-009 – Flow z ustawieniem domyślnym edytora nie przenosi wyglądu

| Pole | Wartość |
|---|---|
| Status / Priorytet / Waga | Do weryfikacji (zrobione 2026-10-03, commit `cf95b28`) / P2 (priorytet biznesowy 1 – [../PRIORYTETY.md](../PRIORYTETY.md)) / Średnia |
| Obszar | eksport-import, edytor |
| Zakres | **w zakresie Z-14** (R-03, decyzja B-01); przy `flowLayout.enabled: false` ustawienia użytkownika są ignorowane (R-01), więc wartości efektywne = domyślne Node-RED i eksport nie dostaje nowych pól |
| Wykryto | 2026-10-03, analiza wymagania „eksport/import wyglądu ze wszystkimi parametrami” (przegląd kodu) |
| Pliki | `editor-client/src/js/ui/view.js` – `getFlowLayoutOptions`; `editor-client/src/js/nodes.js` – `convertWorkspace`, `convertSubflow` (eksport tylko ustawionych `layout`/`wireStyle`) |

**Kroki odtworzenia:** 1. Użytkownik A ustawia w Settings → View domyślny układ „Top to bottom”. 2. Tworzy flow z opcją układu „Editor default” – flow rysuje się pionowo. 3. Eksportuje flow. 4. Użytkownik B (domyślnie „Left to right”) lub inna instancja importuje flow.
**Oczekiwane:** flow wygląda tak samo jak u użytkownika A.
**Rzeczywiste (wg kodu):** eksport nie zawiera `layout` (flow nie ma własnej wartości) – u B flow rysuje się poziomo.
**Przyczyna:** domyślny układ użytkownika nie jest częścią flow (świadoma decyzja projektowa – [DOKUMENTACJA.md](DOKUMENTACJA.md) „Eksport, import i przenoszalność”), ale wymaganie biznesowe oczekuje pełnej przenoszalności.
**Proponowane rozwiązanie (decyzja B-01):** przy eksporcie oraz przy wdrożeniu z edytora flow/subflow bez własnych wartości dostaje efektywne `layout`/`wireStyle`, jeśli różnią się od wartości domyślnych Node-RED (`LR`, `curved`); flow z wartościami domyślnymi bez zmian w JSON (zgodność wstecz).
**DoD specyficzne:** - [ ] test E2E: eksport u użytkownika z domyślnym TB → import u użytkownika z domyślnym LR → identyczny układ i geometria portów; - [x] flow bez zmian domyślnych eksportuje się bez nowych pól; - [x] dokumentacja zaktualizowana.

**Wynik (2026-10-03, `cf95b28`):** `RED.viewLayout.getPersistedFlowOptions(flow, viewSettings)` – własne wartości flow bez
zmian (także nieznane), brakujące uzupełniane z ustawień użytkownika, gdy znane i ≠ `LR`/`curved`. W `nodes.js` opcja
`flowLayoutDefaults` (domyślnie wyłączona) w `createExportableNodeSet`/`createCompleteNodeSet`; włączona w oknie eksportu
(wszystkie zakresy) i przy deployu. Po udanym deployu wdrożone wartości są wpisywane do flow w edytorze (stan jak po
ponownym wczytaniu). Bez zmian: kopiuj/wklej, okno różnic, dopasowanie subflow przy imporcie, historia. Testy:
`editor-client/nodes_spec.js` (3 padały bez poprawki), `ui/view-layout_spec.js` – `getPersistedFlowOptions`. Test E2E –
nie uruchomiony (brak Playwrighta). Uwaga: ustawienie `editorTheme.flowLayout.enabled` (E-04) jeszcze nie istnieje – przy
jego wprowadzeniu wyłączenie funkcji musi dawać puste `viewSettings` w eksporcie (R-01).
**Uzupełnienie (Z-14, 2026-10-03):** ustawienie wprowadzone – przy wyłączonym `exportFlowLayoutOptions` dostaje puste
ustawienia użytkownika (`RED.viewLayout.getUserViewSettings()`), więc eksport/deploy nie dopisuje wartości domyślnych;
testy `nodes_spec.js` „…with flow layout disabled (Z-14, R-01)”.

**Poprawka po przeglądzie (2026-10-03, `3a95e1d`):** eksport z domyślnym układem edytora psuł rozpoznanie identycznego
subflow przy imporcie (powstawał duplikat). `checkForMatchingSubflow` porównuje teraz z eksportem z i bez wartości
domyślnych; test `nodes_spec.js` „matching an imported subflow (FL-B-009)” padał bez poprawki.

### FL-B-011 – Dopasowanie subflow zależne od kolejności węzłów

| Pole | Wartość |
|---|---|
| Status / Priorytet / Waga | Nowe / P4 / Mała |
| Obszar | eksport-import |
| Wykryto | 2026-10-03, analiza FL-B-006 (przegląd kodu – nie odtworzone testem) |
| Pliki | `editor-client/src/js/nodes.js` – `checkForMatchingSubflow` |
| Powiązania | FL-B-006; błąd istniejący w wersji bazowej 5.0.7 |

**Opis:** po FL-B-006 kolejność kluczy nie ma znaczenia, ale identyfikatory węzłów importowanego subflow są
podmieniane na identyfikatory istniejącego **po pozycji** (`subflowNodes[i]` → `sfNodes[i]`), a tablice są porównywane
z kolejnością elementów. Ten sam subflow z węzłami w innej kolejności w pliku nie zostanie rozpoznany – powstanie duplikat.
**Proponowane rozwiązanie:** dopasowanie węzłów po treści (np. typ + właściwości bez `id`/`z`/`wires`) przed podmianą
identyfikatorów; poprawka bardziej inwazyjna niż FL-B-006 – do decyzji, czy w zakresie Z-14.

### FL-B-012 – Błąd w konsoli przy starcie edytora z włączonym układem

| Pole | Wartość |
|---|---|
| Status / Priorytet / Waga | Do weryfikacji (zrobione 2026-10-03) / P4 / Mała |
| Obszar | edytor – ustawienia |
| Wykryto | 2026-10-03, przy testach FL-B-008 (konsola przeglądarki) |
| Pliki | `editor-client/src/js/ui/userSettings.js` – `init()` |

**Opis:** przy `editorTheme.flowLayout.enabled: true` `RED.userSettings.init()` wywołuje `onchange` ustawień
„Layout”/„Wires” (`RED.view.redraw(true)`) zanim panel informacji jest gotowy; zdarzenie `view:selection-changed`
kończy się w konsoli błędem `Cannot read properties of undefined (reading 'treeList')` (przechwyconym przez
`RED.events.emit` – edytor działa). Przy wyłączonym ustawieniu (domyślnie) błąd nie występuje (sekcja nie istnieje).
**Proponowane rozwiązanie:** nie wywoływać przerysowania przy inicjalizacji (widok i tak czyta ustawienia przy rysowaniu).
**Rozwiązanie (2026-10-03, przegląd F2):** opcje „Layout”/„Wires” mają `skipInitOnchange: true` – `init()` zapisuje wartości
domyślne, ale nie wywołuje `onchange`; przerysowanie tylko przy zmianie przez użytkownika. Kolejność inicjalizacji edytora
bez zmian. Testy: `test/unit/@node-red/editor-client/ui/userSettings_spec.js` (1 czerwony → zielony), E2E
„starts the editor without errors in the console (FL-B-012)” (czerwony → zielony).

### FL-B-010 – Import flow o tym samym identyfikatorze tylko jako kopia

| Pole | Wartość |
|---|---|
| Status / Priorytet / Waga | Do weryfikacji (zrobione 2026-10-03, commit `bcf672a`) / P2 (priorytet biznesowy 1) / Średnia |
| Obszar | eksport-import, edytor |
| Źródło | wymaganie Zamawiającego (2026-10-03): „przy imporcie istniejącego flow decydujemy, czy nadpisujemy, czy robimy duplikat – gdy identyfikatory flow i subflow są takie same” |
| Pliki | `editor-client/src/js/ui/clipboard.js` – `getNodeElement` (przełącznik „replace” ukryty dla `tab`), `editor-client/src/js/nodes.js` – `importNodes` (`importMap`), `replaceNodes` (obsługuje tylko subflow i węzły konfiguracyjne), `ui/view.js`/historia (`t: "replace"`) |

**Stan (zweryfikowany E2E, `flow_layout_e2espec.js` „importing a flow and subflow with the same ids”):** przy imporcie
elementów o istniejących identyfikatorach edytor pyta (Cancel / View nodes / Import copy). **Subflow:** można wybrać
„zastąp” albo „kopia” – działa, układ (`layout`, `wireStyle`) przenoszony. **Flow (zakładka):** przełącznik „zastąp” jest
ukryty – możliwa tylko kopia (nowe identyfikatory) albo pominięcie. Wymuszenie „replace” dla zakładki (`importMap`)
powoduje ciche pominięcie flow i jego węzłów (`replaceNodes` nie obsługuje zakładek) – nie jest dostępne z UI.
**Oczekiwane:** dla flow o tym samym identyfikatorze wybór „zastąp” (właściwości zakładki – etykieta, opis, `env`,
`disabled`, `layout`, `wireStyle` – oraz cała zawartość zastąpiona importowaną) albo „kopia”.
**Proponowane rozwiązanie:** pokazać przełącznik „replace” dla `tab`; `replaceNodes` – dla zakładki: migawka do historii
(cofnięcie przywraca poprzednią zakładkę i węzły), usunięcie węzłów/grup/junction w zakładce, aktualizacja właściwości
zakładki, import nowej zawartości z tym samym `z`; łącza `link in/out` z innych flow zachowane, jeśli identyfikatory się
zgadzają. Zmiana zachowania tylko po jawnym wyborze „zastąp” – domyślne zachowanie bez zmian.
**DoD:** test E2E: eksport flow z układem TB → lokalna zmiana → import z „zastąp” → jeden flow z układem i zawartością
z importu; cofnięcie (undo) przywraca stan sprzed importu; testy jednostkowe `replaceNodes` dla zakładki; wariant „kopia” bez zmian.

**Wynik (2026-10-03, `bcf672a`):** okno konfliktu importu pokazuje przełącznik „replace” także dla flow (domyślnie
niezaznaczony – bez wyboru flow importuje się jako kopia, jak dotąd). `nodes.js`: `replaceNodes` rozpoznaje zakładki
(wcześniej zakładka trafiała do gałęzi węzłów konfiguracyjnych i import się wywracał) i woła nowe `replaceWorkspace`:
migawka (zakładka + grupy, junction, węzły, węzły konfiguracyjne z `z` = id) do `removedNodes`, usunięcie zawartości
(`removeWorkspaceContents`, wydzielone z `removeWorkspace`), podmiana właściwości zakładki (brakujące w imporcie usuwane:
`label`, `info`, `env`, `disabled`, `locked`, `layout`, `wireStyle`, `credentials`), import zawartości z `reimport: true`
do tej samej zakładki (kolejność zakładek i obiekt zakładki bez zmian), zdarzenie `flows:change`. Cofnięcie – istniejące
zdarzenie historii `t: "replace"` (import migawki z `importMap` = `replace`); ponowienie działa symetrycznie. Węzeł
z importu, którego id jest używane poza zastępowaną zakładką, dostaje nowe id (odwołania w imporcie – `wires`, `links`,
`g`, `nodes`, odwołania do konfiguracji, `scope` – przemapowane); węzeł w innej zakładce bez zmian. Zablokowana zakładka:
zastąpienie jest dozwolone (jawny wybór), stan `locked` z importu. `workspaces.js`: `flows:change` odświeża klasy
`disabled`/`locked` zakładki. Łącza `link in/out` z innych flow działają, gdy import zachowuje id węzłów; instancje
subflow w zakładce są poprawnie przypisane do (także zastępowanej) definicji.
Testy: `nodes_spec.js` „replacing a flow on import (FL-B-010)” – 8 testów (7 padało bez poprawki, wariant „kopia” bez
zmian); E2E `flow_layout_e2espec.js` – nowy scenariusz „replaces the existing flow … undo restores it”, test zastąpienia
subflow zaktualizowany (przełącznik oferowany dla `sfImp` i `tImp`, domyślnie „copy”; zaznaczenie subflow jak w UI –
najpierw pole wyboru elementu). Uwaga: poprzednia wersja tego testu zaznaczała zablokowany przełącznik subflow, co dawało
import „as-is” zamiast „replace” (nadpisanie definicji bez przypisania instancji) – ścieżka niedostępna z UI.

**Poprawki po przeglądzie (2026-10-03):**
- **B1 (blokujące) – kolejność:** zakładki są zastępowane **po** głównym imporcie (`replaceNodes` obsługuje jak dotąd
  subflow i węzły konfiguracyjne, a zakładki zwraca w `flows`; `importNodes` woła `replaceWorkspace` na końcu, przed
  `RED.workspaces.refresh`). Zawartość zastępowanej zakładki widzi nowe subflow i nowe globalne węzły konfiguracyjne
  z tego samego importu (instancja ma typ `subflow:…` i jest w `instances`; konfiguracja ma węzeł w `users`). Uwaga:
  w przeglądarce instancja nowego subflow była „naprawiana” przez mechanizm podmiany nieznanych typów
  (`registry:node-type-added`), więc błąd był widoczny E2E tylko dla konfiguracji (`users` puste).
- **Historia (skutek B1):** w `view.js` przy zastąpieniu zakładki zdarzenie `replace` jest umieszczane w `multi` **po**
  zdarzeniu `add` (cofnięcie: najpierw przywrócenie flow, potem usunięcie nowych subflow/konfiguracji; ponowienie:
  najpierw ponowne dodanie, potem zastąpienie). Bez tego ponowienie (redo) zostawiało w `users` konfiguracji nieaktualny
  obiekt węzła. Kolejność dla zastąpienia samego subflow – bez zmian (upstream).
- **W2 – kopie:** zawartość zastępowanej zakładki wskazuje kopię, gdy dla konfiguracji/subflow wybrano „kopia”
  (mapy `node_map`, `subflow_map` i `subflow_denylist` – dopasowany istniejący subflow – przekazywane do `replaceWorkspace`).
- **D1 – flagi `changed`:** migawka zapisuje `changed`/`moved` zakładki i węzłów; bez `markChanged` (cofnięcie/ponowienie
  – `history.js` woła `RED.nodes.import(config, {importMap})` bez `markChanged`, a import użytkownika z `view.js` – z
  `markChanged: true`) flagi są odtwarzane z migawki zamiast ustawiania `changed = true`. `history.js` bez zmian.
- **D2 – błąd importu:** gdy wewnętrzny import zawartości rzuci wyjątek, zawartość i właściwości flow są przywracane
  z migawki, a wyjątek rzucany dalej (flow nie zostaje pusty bez wpisu w historii). Węzły głównego importu dodane przed
  błędem zostają (zachowanie jak dotąd dla każdego błędu importu).
- **D3 – przemapowanie id:** tylko pola referencyjne: `id`, `wires`, `g`, `nodes` (grupa), `links` (węzły `link`),
  `scope` (tablica), właściwości z `_def.defaults[x].type`, wartości `conf-type` w `env` instancji subflow oraz typ
  instancji subflow. Inne napisy (np. `name`, `topic`) bez zmian. Odwołania w nieznanych typach węzłów (brak definicji)
  nie są przemapowywane poza polami wymienionymi wyżej.
- **D5:** usunięte zdublowane przełączanie klas `#red-ui-workspace` w `workspaces.js` (robi to `view.js`); zostało
  odświeżanie klas zakładki.
- **W1** (zablokowana zakładka) – bez zmian, czeka na decyzję Zamawiającego.

Testy: `nodes_spec.js` – 6 nowych (wszystkie padały przed poprawką): nowe subflow i nowa konfiguracja z tego samego
importu, kopia konfiguracji/subflow, przemapowanie tylko odwołań, flagi `changed` po cofnięciu i ponowieniu,
przywrócenie flow po błędzie. E2E – 2 nowe scenariusze: „zastąp flow z nowym subflow z innej instancji” (z cofnięciem
i ponowieniem; przechodził też przed poprawką dzięki podmianie nieznanych typów) oraz „zastąp flow z nowym węzłem
konfiguracyjnym z innej instancji” (padał przed poprawką: `users` puste; ponowienie padało przed zmianą kolejności
w `view.js`: nieaktualny obiekt w `users`).

## 6. Karty – zadania i funkcjonalności (`FL-T`)

**Drugi przegląd (2026-10-03, `d9527e2..ea6d8a2`):** brak blokujących; scalone do `main`. Znane ograniczenia (do
rozważenia w kolejnym pakiecie):
- błąd walidacji w zawartości zastępowanej zakładki po głównym imporcie: zakładka przywracana, ale pozostałe elementy
  tego importu (nowe zakładki/subflow/konfiguracje, wcześniej zastąpione zakładki) zostają bez wpisu w historii;
- cofnięcie rozpoznawane po braku `markChanged` przy `importMap` z `"replace"` (rdzeń: tylko `view.js` i `history.js`);
  zewnętrzny kod wołający `RED.nodes.import` z `"replace"` bez `markChanged` dostanie flagi z migawki;
- węzeł nieznanego typu w zastępowanym flow – odwołania do konfiguracji nie są przemapowywane przy kolizji id;
- przemianowanie przy kolizji id działa w jedną stronę (`links` w innych zakładkach tego importu nie są aktualizowane);
- pusty wpis `replace` w historii, gdy zastępowana zakładka nie istnieje; przywracanie po błędzie może samo rzucić;
- instancja subflow zastępowanego razem z zakładką ma po cofnięciu `changed: true` (jak w wersji bazowej);
- W1 – zastępowanie zablokowanej zakładki: **rozstrzygnięte (R-44, wariant B)** – przełącznik „zastąp” nieaktywny z podpowiedzią,
  flow importowany jako kopia; ochrona także w `RED.nodes.import` (import użytkownika z `markChanged`); cofnięcie/ponowienie bez zmian.
  Przy okazji naprawiony błąd okna konfliktu: zablokowany przełącznik dawał „skip” zamiast kopii.

### FL-T-001 – Automatyczne rozmieszczanie węzłów

| Pole | Wartość |
|---|---|
| Status / Priorytet | Nowe / P3 |
| Obszar | edytor – widok, narzędzia (`view-tools.js`) |
| Zależności | wybór biblioteki (dagre / elkjs) – licencja i rozmiar |

**Cel:** po zmianie układu (np. LR → TB) węzły zostają na miejscu, więc flow wygląda chaotycznie. Akcja „Uporządkuj flow / zaznaczenie” rozmieści węzły zgodnie z układem.
**Zakres:** wchodzi – akcja dla zaznaczenia i całego flow, kierunek zgodny z `layout`, undo jednym krokiem; nie wchodzi – automatyczne porządkowanie przy każdej zmianie.
**Kryteria akceptacji:** - [ ] akcja w menu kontekstowym i liście akcji; - [ ] grupy zachowują spójność; - [ ] undo przywraca pozycje; - [ ] działa w subflow.
**Ryzyka:** rozmiar biblioteki w paczce edytora; zachowanie grup i węzłów `link`.

### FL-T-002 – Routing omijający wszystkie węzły

| Pole | Wartość |
|---|---|
| Status / Priorytet | Nowe / P3 |
| Obszar | edytor – widok (`view-layout.js`) |

**Cel:** linie w stylu `orthogonal` omijają dziś tylko węzły na swoich końcach; linia może przechodzić przez inne węzły.
**Zakres:** wchodzi – omijanie wszystkich węzłów w stylu `orthogonal`; nie wchodzi – zmiana stylu `curved`.
**Kryteria akceptacji:** - [ ] linia nie przecina obrysu żadnego węzła, jeśli istnieje droga; - [ ] płynne przeciąganie przy ~200 węzłach i ~300 liniach (pomiar czasu `_redraw`); - [ ] fallback do obecnego routingu, gdy brak drogi.
**Projekt:** A* na siatce widoku lub biblioteka (libavoid-js); przeliczanie tylko linii, których obszar się zmienił.
**Ryzyka:** wydajność przy dużych flow.

### FL-T-003 – Testy E2E w CI

| Pole | Wartość |
|---|---|
| Status / Priorytet | Gotowe / P2 |
| Obszar | testy, `.github/workflows` |

**Cel:** testy E2E (`npm run test:e2e`) uruchamiają się dziś tylko lokalnie; bez Playwrighta są pomijane, więc regresja może przejść niezauważona.
**Kryteria akceptacji:** - [ ] workflow CI instaluje Playwright + Chromium, buduje edytor, uruchamia `test:e2e`; - [ ] przy błędzie zapisuje zrzuty ekranu jako artefakt; - [ ] czas < 5 min.
**Uwagi:** nie dodawać Playwrighta do `dependencies` – tylko w CI (`npm install --no-save`).

### FL-T-004 – Tłumaczenia tekstów

| Pole | Wartość |
|---|---|
| Status / Priorytet | Gotowe / P4 |
| Obszar | `editor-client/locales/*/editor.json` |

**Cel:** sekcja `layout` jest tylko w `en-US`; pozostałe języki pokazują tekst angielski.
**Kryteria akceptacji:** - [ ] klucze `layout.*` w `de`, `es-ES`, `fr`, `ja`, `ko`, `pt-BR`, `ru`, `zh-CN`, `zh-TW`; - [ ] pliki przechodzą walidację JSON w buildzie.
**Uwagi:** w Node-RED nie ma lokalizacji `pl` – dodanie polskiej to osobna decyzja.

### FL-T-005 – Domyślna orientacja w definicji typu węzła

| Pole | Wartość |
|---|---|
| Status / Priorytet | Nowe / P4 |
| Obszar | edytor, API definicji węzłów |

**Cel:** autor węzła może zadeklarować np. `orientation: "TB"` w `RED.nodes.registerType`, gdy węzeł zawsze lepiej wygląda pionowo.
**Kryteria akceptacji:** - [ ] kolejność: `o` węzła → definicja typu → układ flow; - [ ] tryb `auto` respektuje definicję; - [ ] udokumentowane w API.

### FL-T-006 – Szybka zmiana układu z menu zakładki

| Pole | Wartość |
|---|---|
| Status / Priorytet | Nowe / P4 |
| Obszar | edytor – okna (`workspaces.js`, menu zakładki) |

**Cel:** zmiana układu flow bez otwierania okna właściwości – pozycje w menu kontekstowym zakładki i akcje (do przypisania skrótu).
**Kryteria akceptacji:** - [ ] akcje `core:set-flow-layout-*`; - [ ] undo; - [ ] nie działa w zablokowanym flow (lub zgodnie z decyzją z FL-A).

### FL-T-007 – Przygotowanie zmian do zgłoszenia w node-red/node-red

| Pole | Wartość |
|---|---|
| Status / Priorytet | Nowe / P4 |
| Obszar | proces |

**Cel:** ewentualne przekazanie funkcji do projektu Node-RED.
**Zakres:** podział na mniejsze PR (np. runtime `diffNodes`, Admin API, `view-layout.js`, UI), zgodność z wytycznymi projektu (CONTRIBUTING.md, CLA), dyskusja na forum Node-RED przed PR.

---

## 7. Tematy do analizy (`FL-A`)

_Miejsce na dodatkową listę do przeanalizowania – każdy punkt dostaje kartę `FL-A-nnn` i jest przenoszony do błędów / zadań po analizie._

### FL-A-001 – Stan Node-RED poza lokalnymi plikami (wiele instancji)

| Pole | Wartość |
|---|---|
| Status | **Zamknięte (analiza wykonana)** – 2026-10-03 |
| Wynik | poza tym repozytorium (decyzja Zamawiającego, 2026-10-03) |
| Powstałe zadania | w rdzeniu – ogólne punkty rozszerzeń: E-02, Z-08, Z-09, Z-10, Z-11 ([../engine-extensions/backlog/etap-3.md](../engine-extensions/backlog/etap-3.md)), Z-15 ([etap-4.md](../engine-extensions/backlog/etap-4.md)) |

**Wniosek:** cały trwały stan (flow z układem, poświadczenia, ustawienia, sesje, biblioteka,
kontekst) da się przenieść do zewnętrznej wtyczki magazynu przez istniejące punkty rozszerzeń, bez zmian w rdzeniu.
Węzły z palety, moduły zewnętrzne i Projekty należą do obrazu kontenera. Pełna bezstanowość
przy kilku aktywnych replikach wymaga przeładowania i koordynacji instancji (Z-09, Z-10) – stan
działających flow pozostaje w pamięci.

---

## 8. Zamknięte

| ID | Tytuł | Typ | Zamknięte | Commit | Weryfikacja |
|---|---|---|---|---|---|
| FL-B-001 | Admin API `POST/GET/PUT /flow` gubiło `layout`/`wireStyle` | błąd | 2026-10-03 | `556b053` | testy jednostkowe runtime (padały bez poprawki) + E2E przez HTTP |
| FL-B-002 | Deploy „Modified nodes” restartował węzły po zmianie samej orientacji (`o`) lub układu subflow | błąd | 2026-10-03 | `036dd6a` | testy jednostkowe runtime (padały bez poprawki) |
| FL-B-003 | Linia między portami prostopadłymi skierowanymi od siebie (np. dół → lewo) przecinała węzeł | błąd | 2026-10-03 | `e564e91` | zrzuty przed/po, testy jednostkowe geometrii |
| FL-T-000 | Układy LR/TB/auto, style linii, ustawienia, testy, dokumentacja, nagranie demo | funkcja | 2026-10-03 | `e564e91`…`14de67f` | zob. [LOG-PRACY.md](LOG-PRACY.md) |
