# Analiza: układ flow góra–dół / lewo–prawo / automatyczny oraz routing linii

> **Autorstwo:** rozwiązanie opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

## 1. Cel

Węzły (bloczki) Node-RED mają zawsze wejście po lewej i wyjścia po prawej, a linie
(wires) są rysowane poziomymi krzywymi Béziera. W części projektów (procesy
sekwencyjne, drzewa decyzyjne, schematy technologiczne) wygodniejszy jest układ
pionowy. Wymagania:

1. Możliwość wyboru układu rysowania:
   - **lewo → prawo** (dotychczasowy, domyślny),
   - **góra → dół**,
   - **mieszany / uniwersalny** (automatyczny).
2. Ustawienie **globalne** (domyślne dla edytora), **per flow** (zakładka / subflow)
   oraz **opcjonalnie per węzeł**.
3. Poprawne położenie portów (wejść/wyjść) w węźle zależnie od układu.
4. Linie łączące muszą się dostosować do układu — dowolna kombinacja kierunków
   portów, omijanie węzłów przy liniach „wstecz”, opcjonalnie linie prostokątne
   (auto‑routing).
5. Pełna zgodność wstecz: istniejące flow wyglądają i eksportują się identycznie.

## 2. Stan obecny (przed zmianą)

Cała geometria jest w `packages/node_modules/@node-red/editor-client/src/js/ui/view.js`
i ma „zaszyty” układ poziomy:

| Miejsce | Co robi | Założenie poziome |
|---|---|---|
| `_redraw` – aktualizacja węzła | rozmiar `d.w`/`d.h` | wysokość rośnie z liczbą wyjść (`outputs*15`) |
| `_redraw` – porty | `translate(-5, h/2-5)` dla wejścia, `translate(w-5, y)` dla wyjść | wejście lewa krawędź, wyjścia prawa, rozstaw pionowy 13px |
| `_redraw` – linie | `x1 = source.x + w/2`, `x2 = target.x - w/2` | linia zawsze wychodzi w prawo i wchodzi z lewej |
| `generateLinkPath()` | krzywa Béziera z parametrem `sc = ±1` | tylko kierunek poziomy (prawo/lewo) |
| `canvasMouseMove` – przeciąganie linii | `generateLinkPath(node.x + sc*w/2, …)` | jw. |
| `showQuickAddDialog` | linia do „ducha” węzła, kolejne węzły dodawane w prawo | jw. |
| `redrawStatus()` | status pod węzłem (`translate(3, h+3)`) | pod węzłem nie ma portów |
| linki „off‑flow” (link out do innej zakładki) | ścieżka `M 0 0 h 30` | poziomo |
| porty węzłów subflow (input/output/status) | port z lewej / prawej | poziomo |
| `calculateNodeDimensions()` | wymiary przy eksporcie | poziomo |

Model danych (`nodes.js`):
- węzeł eksportuje tylko `defaults` + wybrane pola (`x`, `y`, `z`, `wires`, `l`, `d`, `g`, …);
- lista zarezerwowanych jednoliterowych właściwości zawiera nieużywane `o`;
- zakładka (`tab`) eksportuje tylko swoje `defaults` (`label`, `disabled`, `locked`, `info`, `env`);
- subflow eksportuje wybrane pola.

Runtime (`@node-red/runtime/lib/flows/util.js` → `diffNodes`) przy deployu
„tylko zmienione węzły” ignoruje wyłącznie `x`, `y`, `wires`.

## 3. Projekt rozwiązania

### 3.1 Model danych

| Obiekt | Właściwość | Wartości | Brak wartości oznacza |
|---|---|---|---|
| zakładka / subflow | `layout` | `"LR"`, `"TB"`, `"auto"` | ustawienie z preferencji użytkownika |
| zakładka / subflow | `wireStyle` | `"curved"`, `"orthogonal"` | ustawienie z preferencji użytkownika |
| węzeł (także junction) | `o` | `"LR"`, `"TB"` | układ flow |
| ustawienia użytkownika | `editor.view["view-flow-layout"]` | jw. | `"LR"` |
| ustawienia użytkownika | `editor.view["view-wire-style"]` | jw. | `"curved"` |

Decyzje:
- **`o` dla węzła** – litera była już zarezerwowana w `nodes.js`, więc nie
  koliduje z właściwościami żadnego typu węzła (tak jak `l` dla etykiety).
  Nazwa w stylu `layout` mogłaby kolidować z węzłami zewnętrznymi (np. dashboard).
- Właściwości są eksportowane **tylko gdy ustawione** – istniejące flow się nie zmieniają,
  a starsze wersje Node-RED po prostu je ignorują.
- Hierarchia: węzeł (`o`) → flow (`layout`) → preferencje użytkownika → `LR`.

### 3.2 Tryb automatyczny („mieszany / uniwersalny”)

Każdy węzeł bez własnego `o` dostaje orientację na podstawie podłączonych linii:
każda linia „głosuje” – jeśli jest bardziej pionowa (`|dy| > |dx|`) to na `TB`,
w przeciwnym razie na `LR`. Remis → `LR`. Wirtualne linie węzłów `link` są pomijane.
Orientacje są przeliczane przy każdym odrysowaniu, ale **zamrażane podczas
przeciągania węzłów**, żeby porty nie „skakały”.

### 3.3 Geometria portów

| Orientacja | Wejście | Wyjścia | Rozmiar węzła |
|---|---|---|---|
| LR | środek lewej krawędzi | prawa krawędź, rozstaw pionowy 13px | jak dotąd (wysokość rośnie z wyjściami) |
| TB | środek górnej krawędzi | dolna krawędź, rozstaw poziomy 20px | wysokość stała, szerokość ≥ `wyjścia × 20` |

W TB status węzła jest przenoszony na prawą stronę (pod węzłem są wyjścia).

### 3.4 Routing linii

Port opisuje `{x, y, dir, box}`, gdzie `dir ∈ {r, l, t, b}` to kierunek wyjścia
linii z portu, a `box` – obrys węzła (do omijania).

**Styl `curved` (domyślny):**
- `r → l` (LR–LR): dotychczasowa funkcja `generateLinkPath` – **bez zmian piksel w piksel**;
- `b → t` (TB–TB) w dół: ta sama krzywa z zamienionymi osiami x/y (`transposePath`);
- `b → t` „wstecz” (cel nad źródłem): obejście węzłów prostokątną linią z dużym zaokrągleniem;
- porty prostopadłe (np. `r → t`), skierowane do siebie: krzywa Béziera z punktami
  kontrolnymi wzdłuż kierunków portów;
- porty prostopadłe skierowane od siebie: obejście jak wyżej (zwykła krzywa przecinałaby węzeł).

**Styl `orthogonal` (auto‑routing prostokątny):**
- od każdego portu krótki odcinek (15px) w kierunku portu,
- porty równoległe naprzeciw siebie: przejście przez środek odległości (2 załamania),
- linia „wstecz”: obejście przez przerwę między węzłami albo poza obrysem obu węzłów
  (z zapasem na status),
- porty prostopadłe: 1 załamanie, jeśli możliwe, inaczej obejście,
- zaokrąglone narożniki (promień ograniczony do połowy długości odcinka).

Routing omija węzły **na końcach linii**; pełne omijanie dowolnych przeszkód
(np. A*/libavoid) jest opisane jako dalszy krok.

### 3.5 Runtime

Endpointy pojedynczego flow (`POST /flow`, `GET /flow/:id`, `PUT /flow/:id`) budują obiekt
zakładki z wybranych pól (`label`, `info`, `disabled`, `env`) – muszą też przenosić
`layout` i `wireStyle`, inaczej układ ginie przy imporcie/eksporcie przez API.

Zmiana `o` węzła lub `layout`/`wireStyle` subflow jest czysto wizualna – `diffNodes`
musi ją ignorować, inaczej deploy „tylko zmienione” restartowałby węzły.
Zmiana `layout` zakładki niczego nie restartuje (dla zakładek porównywane jest tylko `env`).

## 4. Lista zmian w plikach

| Plik | Zmiana |
|---|---|
| `editor-client/src/js/ui/view-layout.js` (nowy) | czysta geometria: pozycje portów, rozmiary, routing linii, tryb auto (`RED.viewLayout`) – testowalna bez DOM |
| `editor-client/src/js/ui/view.js` | stan układu aktywnego flow, `getNodeOrientation`, porty/rozmiar/status w `_redraw`, linie, przeciąganie, quick‑add (kolejne węzły w dół w TB), linki off‑flow, porty subflow, API `RED.view.layout` |
| `editor-client/src/js/nodes.js` | eksport/import `o`, `layout`, `wireStyle`; `o` chronione w zablokowanych flow |
| `editor-client/src/js/ui/editors/flowLayout.js` (nowy) | wspólny formularz „Układ / Linie” dla flow i subflow |
| `editor-client/src/js/ui/editors/panes/flowProperties.js` | pola układu we właściwościach flow |
| `editor-client/src/js/ui/editors/panes/appearance.js` | „Porty” węzła; układ wewnątrz subflow |
| `editor-client/src/js/ui/userSettings.js` | sekcja „Flow layout” w ustawieniach użytkownika |
| `editor-client/src/js/ui/view-tools.js`, `contextMenu.js` | akcje `core:set-selected-node-ports-horizontal/vertical`, `core:reset-selected-node-ports` + menu kontekstowe |
| `editor-client/locales/en-US/editor.json` | teksty (pozostałe języki dziedziczą angielskie) |
| `runtime/lib/flows/util.js` | `diffNodes` ignoruje `o` oraz `layout`/`wireStyle` subflow |
| `runtime/lib/flows/index.js` | API pojedynczego flow (`addFlow`, `getFlow`, `updateFlow` → `POST/GET/PUT /flow`) przenosi `layout`/`wireStyle` |
| `scripts/build/config.js` | dołączenie `view-layout.js` przed `view.js` |
| `package.json` | skrypt `test:e2e` |

## 5. Ryzyka i ograniczenia

- **Zgodność wstecz** – układ LR i styl `curved` używają niezmienionego kodu; brak nowych
  właściwości w eksporcie, jeśli nie są ustawione. Potwierdzone testami i zrzutami.
- **Węzły zewnętrzne** – porty są rysowane przez edytor, więc działają dla wszystkich typów.
  Węzeł, który w `defaults` ma własną właściwość `o`, nie dostaje opcji orientacji.
- **Tooltipy etykiet portów** w TB nadal pokazują się po lewej/prawej stronie portu.
- **Etykiety linków off‑flow** w TB są obrócone o 90°.
- **Tryb auto** jest heurystyką – przy nietypowych układach można wymusić orientację węzła (`o`).
- **Brak automatycznego rozmieszczania węzłów** – zmiana układu nie przesuwa węzłów.
- **Routing** omija tylko węzły na końcach linii.

## 6. Dalsze kroki (propozycje)

1. Automatyczne rozmieszczenie węzłów zgodnie z układem (np. dagre/ELK) – akcja „Uporządkuj flow”.
2. Routing omijający wszystkie węzły (A* na siatce lub libavoid).
3. Domyślna orientacja w definicji typu węzła (np. `_def.orientation`).
4. Tłumaczenia tekstów na pozostałe języki.

## 7. Testy

| Rodzaj | Plik | Zakres |
|---|---|---|
| jednostkowe (edytor) | `test/unit/@node-red/editor-client/ui/view-layout_spec.js` | pozycje portów, rozmiary, każda kombinacja kierunków, styl prostokątny, obejścia, tryb auto (46 testów) |
| jednostkowe (runtime) | `test/unit/@node-red/runtime/lib/flows/util_spec.js`, `index_spec.js` | brak restartu przy zmianach wizualnych, zachowanie właściwości przy zapisie oraz w API pojedynczego flow |
| E2E (przeglądarka) | `test/editor/e2e/flow_layout_e2espec.js` | wszystkie układy, przeciąganie linii, status, akcje, dialogi, undo, ustawienia użytkownika, eksport/import (bieżący flow, wszystkie flow, zaznaczenie, subflow), Admin API, deploy (22 testy) |
| lint | `npm run lint` | cały kod edytora |
