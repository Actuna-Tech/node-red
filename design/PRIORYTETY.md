# Priorytety biznesowe i plan realizacji

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

Data: 2026-10-03 · źródło priorytetów: Zamawiający · dokument nadrzędny wobec kolejności w
[engine-extensions/ANALIZA.md](engine-extensions/ANALIZA.md) §6.2 (tam: zależności techniczne i tory),
[flow-layout/BACKLOG.md](flow-layout/BACKLOG.md), [k8s-postgres/BACKLOG.md](k8s-postgres/BACKLOG.md).

## Priorytety

| # | Priorytet biznesowy | Cel mierzalny (kryterium biznesowe) |
|---|---|---|
| **1** | **Pionowy i hybrydowy układ bloczków** z poprawnym eksportem i importem wyglądu flow ze wszystkimi parametrami | flow wyeksportowany z jednej instancji/od jednego użytkownika wygląda **identycznie** po imporcie na innej instancji i u innego użytkownika (układ, styl linii, orientacja bloczków, subflow) |
| **2** | **Poprawki bezpieczeństwa i API** | brak znanych dróg zdalnego zatrzymania procesu i nieuwierzytelnionego dostępu do tras administracyjnych; Admin API przewidywalne dla edytora, MCP i CI/CD (rewizje, odpowiedź po starcie, walidacja) |
| **3** | **Niezależność od lokalnych plików** – konfiguracja, ustawienia flow i bloczków oraz dane zbierane przez bloczki w bazie | pod Node-RED działa z systemem plików tylko do odczytu; restart/przeniesienie poda nie traci flow, ustawień, sesji, kontekstu ani plików zapisanych przez bloczki |

## Priorytet 1 – układ flow i przenoszalność wyglądu

Stan: funkcja zrealizowana (pakiet **Z-14**, [flow-layout/DOKUMENTACJA.md](flow-layout/DOKUMENTACJA.md)); eksport/import
`layout`, `wireStyle`, `o` potwierdzony testami E2E. **Luki do zamknięcia:**

| ID | Zadanie | Dlaczego dla priorytetu 1 | Szacunek |
|---|---|---|---|
| **FL-B-009** (nowe) | Flow z „Editor default” nie przenosi wyglądu – układ zależy od ustawień osoby edytującej (`view.js` `getFlowLayoutOptions`; eksport pomija brakujące `layout`/`wireStyle`) | po imporcie flow może wyglądać inaczej | S |
| FL-B-004 | Okno różnic (konflikt, Projekty) nie pokazuje dodanych `layout`/`wireStyle`/`o` | scalanie przy konflikcie – użytkownik nie widzi zmian wyglądu | S |
| FL-B-005 | Nieprawidłowe wartości układu z importu znikają bez ostrzeżenia | import z innych narzędzi (MCP/CI) – cicha utrata parametru | S |
| FL-B-006 | Dopasowanie subflow przy imporcie zależy od kolejności kluczy | import subflow z układem może utworzyć duplikat | M |
| FL-B-007, FL-B-008 | Podpowiedzi portów i etykiety linków w układzie pionowym | jakość wyglądu pionowego | S + S |
| E-04 / Z-14 | Dostosowanie do wymagań zlecenia: ustawienie `editorTheme.flowLayout.enabled`, usunięcie atrybucji z kodu, podpisy, podział na PR, klucze `pl` | warunek odbioru i zgłoszenia upstream | M |
| Z-04 (część) | API pojedynczego flow zachowuje układ (FL-B-001 – już naprawione) – utrzymać w Z-04 | eksport/import przez API (MCP, CI/CD) | – |

**Rekomendacja dla FL-B-009:** przy eksporcie (i przy zapisie przez Admin API z edytora) flow bez własnych wartości
dostaje **efektywne** `layout`/`wireStyle`, jeśli różnią się od domyślnych Node-RED (`LR`, `curved`); alternatywa: przy
włączeniu funkcji edytor zapisuje jawne wartości w każdym nowym flow. Decyzja **B-01**.

**Kryterium odbioru priorytetu 1 (biznesowe, test E2E/kontraktowy):** dla zestawu flow wzorcowych (LR, TB, auto,
mieszany, z subflow, prostokątne linie) eksport z instancji A z innymi ustawieniami domyślnymi użytkownika → import na
instancji B → identyczne `layout`/`wireStyle`/`o` i identyczna geometria portów (porównanie pozycji portów i ścieżek linii).

## Priorytet 2 – bezpieczeństwo i API

| Kolejność | ID | Zadanie | Typ |
|---|---|---|---|
| 1 | **P-04** | zdalne zatrzymanie procesu przez `/comms` bez `adminAuth` (+ kontrola `Origin`, D-07) – zgłoszenie prywatne wg `SECURITY.md` | bezpieczeństwo, poprawka błędu |
| 2 | **Z-02** | uwierzytelnianie tras administracyjnych bloczków (`httpAdminNodeRoutes`) | bezpieczeństwo |
| 3 | **Z-01** | wyścig subskrypcji `/comms` | poprawka błędu |
| 4 | **P-03** | telemetria blokowana przez administratora | bezpieczeństwo/prywatność (on-premise) |
| 5 | **P-01** | odpowiedź wdrożenia po starcie flow (+ zwracanie błędów zatrzymania/startu) | API |
| 6 | **Z-04 → Z-05** | API pojedynczego flow z rewizją; wymóg rewizji | API |
| 7 | **Z-06** | hooki `preDeploy`/`postDeploy` (walidacja wdrożeń z MCP/CI) | API |
| 8 | **P-02** | ochrona przed nadpisaniem przez nieaktualny edytor (+ poprawka `deploy.js:390`) | API/edytor |
| 9 | **Z-07** | trasy HTTP bloczka (+ błąd usuwania cudzych tras w `http in`) | API/poprawka błędu |
| – | Z-03 | aktualizacja `.tgz` (zakres skorygowany) | niższy priorytet – w docelowym K8s upload wyłączony |

## Priorytet 3 – niezależność od lokalnych plików (baza danych)

| Obszar | Co dziś w plikach | Rozwiązanie | Pozycje |
|---|---|---|---|
| Flow, poświadczenia, sesje, biblioteka | `flows.json`, `flows_cred.json`, `.sessions.json`, `lib/` | wtyczka magazynu PostgreSQL | **K8S-T-001** (+ `watchFlows` dla Z-09) |
| Ustawienia runtime, rejestr bloczków, ustawienia użytkowników (w tym domyślny układ) | `.config.*.json` | ustawienia w bazie z rolą editor/worker | **K8S-T-002**, **Z-15** (instancja tylko edycyjna) |
| Dane zbierane przez bloczki – kontekst | `context/**.json` (gdy `localfilesystem`) | magazyn kontekstu PostgreSQL + cache Redis | **K8S-T-004** |
| Dane zbierane przez bloczki – pliki (`file`, `file in`, …) | katalog roboczy | zamienniki węzłów plikowych z magazynem w bazie/S3 | **K8S-T-009** (+ K8S-A-002 – inwentaryzacja bloczków piszących na dysk) |
| Własne bloczki | – | wspólny węzeł konfiguracyjny bazy tenanta | **K8S-T-008** |
| Bloczki z palety (kod) | `node_modules` | w obrazie, paleta tylko do odczytu | **K8S-T-004** (obraz), Z-11 |
| Gwarancja braku zapisów lokalnych | 16 miejsc zapisu (WERYFIKACJA Z-11) | `readOnlyUserDir` | **Z-11** |
| Wiele instancji | – | przeładowanie z bazy, koordynacja, sondy, drenaż | **Z-09, Z-10, Z-08** (D-11) |

Uwaga: w zleceniu implementacje wtyczek (magazyn, koordynacja) są po stronie Zamawiającego – zlecenie dostarcza
punkty rozszerzeń (Z-09, Z-10, Z-11, Z-15). Nasze K8S-T-* to te implementacje.

## Plan – kolejność według priorytetów (maks. 2 równolegle, bez wspólnych plików)

| Faza | Tor 1 (edytor / układ flow) | Tor 2 (runtime / API / bezpieczeństwo) | Wynik fazy |
|---|---|---|---|
| **F1** | FL-B-009 → FL-B-004 → FL-B-005 | **P-04** → **Z-01** (inne pliki niż tor 1: `editor-api` auth/comms, `editor-client/src/js/comms.js`) | priorytet 1 domknięty funkcjonalnie; krytyczna luka bezpieczeństwa zamknięta |
| **F2** | E-04/Z-14 (ustawienie, atrybucja, podział na PR) → FL-B-006 → FL-B-007/008 | **Z-02** → **P-03** → E-01 (kontrakt potoku) | priorytet 1 gotowy do odbioru; bezpieczeństwo domknięte |
| **F3** | **P-02** (edytor `deploy.js`) | **P-01** → **Z-04** → **Z-05** → **Z-06** | priorytet 2 – API |
| **F4** | **Z-07** | K8S-T-001 (magazyn + `watchFlows`) → K8S-T-002 / **Z-15** | start priorytetu 3 |
| **F5** | K8S-T-004 (kontekst), K8S-T-009 (pliki bloczków) | **Z-11** → **Z-08** → **Z-10** → **Z-09** | priorytet 3 – pełna niezależność od plików, wiele instancji |
| później | Z-03, Z-12 (po załączniku B), Z-13 (język polski) | K8S-T-005…015 | |

Zależności techniczne zachowane z [ANALIZA.md](engine-extensions/ANALIZA.md) §6.2 (np. Z-04 przed Z-05, E-01 przed P-01,
Z-06/Z-08/Z-10 przed Z-09). Uzupełnienie zlecenia (zapowiedziane) może zmienić zakres – plan zostanie zaktualizowany.

## Decyzje

| ID | Decyzja | Rekomendacja |
|---|---|---|
| B-01 | FL-B-009: jak utrwalać wygląd flow korzystających z ustawień domyślnych edytora | **przyjęte (2026-10-03, na obecnym etapie ustaleń)**: przy eksporcie i zapisie dopisywać efektywne `layout`/`wireStyle`, gdy ≠ `LR`/`curved` |
| B-02 | Czy zaczynamy F1 przed otrzymaniem uzupełnienia zlecenia | **wstrzymane (2026-10-03)** – start po otrzymaniu uzupełnienia zlecenia |
| D-04 | Podpisy i zgłoszenia | dane Actuna / Wojciech Repiński; **PR i push do `node-red/node-red` zablokowane** |
| D-11 | Drenaż przy SIGTERM | **przyjęte** |
