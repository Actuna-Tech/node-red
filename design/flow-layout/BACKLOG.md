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
| [FL-B-004](#fl-b-004--okno-różnic-nie-pokazuje-dodanych-właściwości-układu) | Okno różnic nie pokazuje dodanych właściwości układu | błąd | Gotowe | P3 | Średnia | edytor – okna |
| [FL-B-005](#fl-b-005--nieprawidłowe-wartości-układu-z-importu) | Nieprawidłowe wartości układu z importu | błąd | Gotowe | P4 | Mała | eksport-import |
| [FL-B-006](#fl-b-006--dopasowanie-subflow-zależne-od-kolejności-kluczy) | Dopasowanie subflow zależne od kolejności kluczy | błąd (istniejący w Node-RED) | Do analizy | P4 | Mała | eksport-import |
| [FL-B-007](#fl-b-007--podpowiedzi-etykiet-portów-w-układzie-tb) | Podpowiedzi etykiet portów w układzie TB | błąd | Gotowe | P4 | Mała | edytor – widok |
| [FL-B-008](#fl-b-008--obrócone-etykiety-linków-do-innych-zakładek-w-tb) | Obrócone etykiety linków do innych zakładek w TB | błąd | Gotowe | P4 | Mała | edytor – widok |
| [FL-T-001](#fl-t-001--automatyczne-rozmieszczanie-węzłów) | Automatyczne rozmieszczanie węzłów | funkcja | Nowe | P3 | – | edytor – widok |
| [FL-T-002](#fl-t-002--routing-omijający-wszystkie-węzły) | Routing omijający wszystkie węzły | funkcja | Nowe | P3 | – | edytor – widok |
| [FL-T-003](#fl-t-003--testy-e2e-w-ci) | Testy E2E w CI | dług techniczny | Gotowe | P2 | – | testy |
| [FL-T-004](#fl-t-004--tłumaczenia-tekstów) | Tłumaczenia tekstów | zadanie | Gotowe | P4 | – | edytor – okna |
| [FL-T-005](#fl-t-005--domyślna-orientacja-w-definicji-typu-węzła) | Domyślna orientacja w definicji typu węzła | funkcja | Nowe | P4 | – | edytor / API węzłów |
| [FL-T-006](#fl-t-006--szybka-zmiana-układu-z-menu-zakładki) | Szybka zmiana układu z menu zakładki | funkcja | Nowe | P4 | – | edytor – okna |
| [FL-T-007](#fl-t-007--przygotowanie-zmian-do-zgłoszenia-w-node-rednode-red) | Przygotowanie zmian do zgłoszenia w node-red/node-red | zadanie | Nowe | P4 | – | proces |

Sekcja 7 (tematy do analizy) czeka na listę do przeanalizowania.

---

## 5. Karty – błędy (`FL-B`)

### FL-B-004 – Okno różnic nie pokazuje dodanych właściwości układu

| Pole | Wartość |
|---|---|
| Status / Priorytet / Waga | Gotowe / P3 / Średnia |
| Obszar | edytor – okna (Review Changes, różnice commitów w Projektach) |
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

### FL-B-005 – Nieprawidłowe wartości układu z importu

| Pole | Wartość |
|---|---|
| Status / Priorytet / Waga | Gotowe / P4 / Mała |
| Obszar | eksport-import, edytor – okna |
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

### FL-B-006 – Dopasowanie subflow zależne od kolejności kluczy

| Pole | Wartość |
|---|---|
| Status / Priorytet / Waga | Do analizy / P4 / Mała |
| Obszar | eksport-import |
| Wykryto | 2026-10-03, przegląd kodu ([PROBLEMY.md](PROBLEMY.md) P4) |
| Pliki | `editor-client/src/js/nodes.js` – `checkForMatchingSubflow` |
| Powiązania | błąd istniejący w Node-RED – nowe właściwości go nie powodują |

**Opis:** przy imporcie edytor szuka istniejącego, identycznego subflow, porównując tekst JSON. Ten sam subflow z kluczami w innej kolejności (np. `layout` przed `color` – edycja ręczna, inne narzędzia) nie zostanie rozpoznany i powstanie duplikat / konflikt.
**Do ustalenia w analizie:** odtworzenie, czy to realny problem dla użytkowników (pliki generowane przez narzędzia), czy zgłosić do node-red/node-red zamiast poprawiać lokalnie.
**Proponowane rozwiązanie:** porównanie po znormalizowanych obiektach (`RED.utils.compareObjects` lub JSON z posortowanymi kluczami).
**DoD specyficzne:** - [ ] Wynik analizy w karcie; - [ ] jeśli poprawka: test jednostkowy/E2E z odwróconą kolejnością kluczy.

### FL-B-007 – Podpowiedzi etykiet portów w układzie TB

| Pole | Wartość |
|---|---|
| Status / Priorytet / Waga | Gotowe / P4 / Mała |
| Obszar | edytor – widok |
| Wykryto | 2026-10-03, przegląd kodu przy implementacji |
| Pliki | `ui/view.js` – `portMouseOver` (pozycja i kierunek `showTooltip`) |

**Kroki odtworzenia:** 1. Flow w układzie *Top to bottom*. 2. Węzeł z etykietami portów (Appearance → Port labels). 3. Najedź na port.
**Oczekiwane:** podpowiedź nad wejściem (u góry) i pod wyjściem (u dołu), nie zasłania węzła.
**Rzeczywiste (wg kodu):** podpowiedź pojawia się z lewej (wejście) / prawej (wyjście) strony portu – jak w układzie poziomym.
**DoD specyficzne:** - [ ] Odtworzyć i dołączyć zrzut; - [ ] pozycja zależna od kierunku portu (`dir`) z `getPortPosition`; - [ ] LR bez zmian.
**Testy:** E2E – pozycja elementu `.red-ui-flow-port-tooltip` względem portu w TB i LR.

### FL-B-008 – Obrócone etykiety linków do innych zakładek w TB

| Pole | Wartość |
|---|---|
| Status / Priorytet / Waga | Gotowe / P4 / Mała |
| Obszar | edytor – widok |
| Wykryto | 2026-10-03, przy implementacji (świadome uproszczenie) |
| Pliki | `ui/view.js` – rysowanie `.red-ui-flow-link-off-flow` (transformacja `rotate(90)`) |

**Kroki odtworzenia:** 1. Flow w układzie TB z węzłem `link out` połączonym z `link in` na innej zakładce. 2. Zaznacz węzeł `link out`.
**Oczekiwane:** odgałęzienie wychodzi z dołu, nazwy zakładek docelowych czytelne poziomo.
**Rzeczywiste:** całe odgałęzienie jest obrócone o 90°, razem z tekstem nazw zakładek (tekst pionowy).
**Proponowane rozwiązanie:** obracać tylko geometrię linii, a etykiety pozycjonować poziomo (osobna transformacja tekstu).
**DoD specyficzne:** - [ ] Tekst poziomy w TB; - [ ] klikanie w etykietę dalej przenosi do zakładki; - [ ] LR bez zmian.

---

## 6. Karty – zadania i funkcjonalności (`FL-T`)

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

---

## 8. Zamknięte

| ID | Tytuł | Typ | Zamknięte | Commit | Weryfikacja |
|---|---|---|---|---|---|
| FL-B-001 | Admin API `POST/GET/PUT /flow` gubiło `layout`/`wireStyle` | błąd | 2026-10-03 | `556b053` | testy jednostkowe runtime (padały bez poprawki) + E2E przez HTTP |
| FL-B-002 | Deploy „Modified nodes” restartował węzły po zmianie samej orientacji (`o`) lub układu subflow | błąd | 2026-10-03 | `036dd6a` | testy jednostkowe runtime (padały bez poprawki) |
| FL-B-003 | Linia między portami prostopadłymi skierowanymi od siebie (np. dół → lewo) przecinała węzeł | błąd | 2026-10-03 | `e564e91` | zrzuty przed/po, testy jednostkowe geometrii |
| FL-T-000 | Układy LR/TB/auto, style linii, ustawienia, testy, dokumentacja, nagranie demo | funkcja | 2026-10-03 | `e564e91`…`14de67f` | zob. [LOG-PRACY.md](LOG-PRACY.md) |
