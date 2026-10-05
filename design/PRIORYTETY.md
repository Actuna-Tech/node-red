# Priorytety biznesowe i plan realizacji

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

Data: 2026-10-03 · źródło priorytetów: Zamawiający · dokument nadrzędny wobec kolejności w
[engine-extensions/ANALIZA.md](engine-extensions/ANALIZA.md) §6.2 (tam: zależności techniczne i tory),
[flow-layout/BACKLOG.md](flow-layout/BACKLOG.md).

> **Rejestr decyzji zamknięty (2026-10-03):** wszystkie punkty R-01…R-32 rozstrzygnięte –
> [engine-extensions/REJESTR-DECYZJI.md](engine-extensions/REJESTR-DECYZJI.md) (skrót: ANALIZA §7.0). Skutki dla tego planu:
> zakres FL-B-004…008 (+ 009) w priorytecie 1 (R-03); poprawka XSS w menu użytkownika w priorytecie 2 (R-08);
> P-04 bez zgłoszenia do zespołu Node-RED na tym etapie (R-04).

## Priorytety

| # | Priorytet biznesowy | Cel mierzalny (kryterium biznesowe) |
|---|---|---|
| **1** | **Pionowy i hybrydowy układ bloczków** z poprawnym eksportem i importem wyglądu flow ze wszystkimi parametrami | flow wyeksportowany z jednej instancji/od jednego użytkownika wygląda **identycznie** po imporcie na innej instancji i u innego użytkownika (układ, styl linii, orientacja bloczków, subflow) |
| **2** | **Poprawki bezpieczeństwa i API** | brak znanych dróg zdalnego zatrzymania procesu i nieuwierzytelnionego dostępu do tras administracyjnych; Admin API przewidywalne dla edytora, MCP i CI/CD (rewizje, odpowiedź po starcie, walidacja) |
| **3** | **Przeładowanie flow i praca wielu instancji w rdzeniu (ogólne API)** – punkty rozszerzeń, pod które zewnętrzne wtyczki (magazynu, koordynacji) podpina się poza tym repozytorium | instancja działa z katalogiem użytkownika tylko do odczytu; wiele instancji przeładowuje flow po zmianie we wspólnym magazynie, z drenażem i koordynacją; poprawne sondy i zamykanie |

## Priorytet 1 – układ flow i przenoszalność wyglądu

Stan: funkcja zrealizowana (pakiet **Z-14**, [flow-layout/DOKUMENTACJA.md](flow-layout/DOKUMENTACJA.md)); eksport/import
`layout`, `wireStyle`, `o` potwierdzony testami E2E. **Luki do zamknięcia** (zakres wg R-03: wszystkie FL-B-004, 005, 006,
007, 008 + FL-B-009 z B-01 – wymagane do odbioru priorytetu 1):

| ID | Zadanie | Dlaczego dla priorytetu 1 | Szacunek |
|---|---|---|---|
| **FL-B-009** (nowe) | Flow z „Editor default” nie przenosi wyglądu – układ zależy od ustawień osoby edytującej (`view.js` `getFlowLayoutOptions`; eksport pomija brakujące `layout`/`wireStyle`) | po imporcie flow może wyglądać inaczej | S |
| FL-B-004 | Okno różnic (konflikt, Projekty) nie pokazuje dodanych `layout`/`wireStyle`/`o` | scalanie przy konflikcie – użytkownik nie widzi zmian wyglądu | S |
| FL-B-005 | Nieprawidłowe wartości układu z importu znikają bez ostrzeżenia | import z innych narzędzi (MCP/CI) – cicha utrata parametru | S |
| FL-B-006 | Dopasowanie subflow przy imporcie zależy od kolejności kluczy | import subflow z układem może utworzyć duplikat | M |
| FL-B-007, FL-B-008 | Podpowiedzi portów i etykiety linków w układzie pionowym | jakość wyglądu pionowego – w zakresie (R-03) | S + S |
| E-04 / Z-14 | Dostosowanie do wymagań zlecenia: ustawienie `editorTheme.flowLayout.enabled`, nagłówki o modyfikacji wg pkt 4(b) (D-19, R-30), podpisy, podział na PR, klucze `pl` | warunek odbioru i zgłoszenia upstream | M |
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
| 1 | **P-04** | zdalne zatrzymanie procesu przez `/comms` bez `adminAuth` (+ kontrola `Origin`, D-07 – ustawienie domyślnie wyłączone, R-06) – poprawka tylko w forku; zgłoszenie prywatne wg `SECURITY.md` **nie teraz**, dopiero po zniesieniu blokady D-04 (R-04) | bezpieczeństwo, poprawka błędu |
| 1a | **XSS w menu użytkownika** | nazwa użytkownika wstawiana jako HTML (`editor-client/src/js/user.js:265`) – osobna poprawka teraz, z testem padającym bez poprawki (R-08) | bezpieczeństwo, poprawka błędu |
| 2 | **Z-02** | uwierzytelnianie tras administracyjnych bloczków (`httpAdminNodeRoutes`) | bezpieczeństwo |
| 3 | **Z-01** | wyścig subskrypcji `/comms` | poprawka błędu |
| 4 | **P-03** | telemetria blokowana przez administratora | bezpieczeństwo/prywatność (on-premise) |
| 5 | **P-01** | odpowiedź wdrożenia po starcie flow (+ zwracanie błędów zatrzymania/startu) | API |
| 6 | **Z-04 → Z-05** | API pojedynczego flow z rewizją; wymóg rewizji | API |
| 7 | **Z-06** | hooki `preDeploy`/`postDeploy` (walidacja wdrożeń z MCP/CI) | API |
| 8 | **P-02** | ochrona przed nadpisaniem przez nieaktualny edytor (+ poprawka `deploy.js:390`) | API/edytor |
| 9 | **Z-07** | trasy HTTP bloczka (+ błąd usuwania cudzych tras w `http in`) | API/poprawka błędu |
| – | Z-03 | aktualizacja `.tgz` (zakres skorygowany) | niższy priorytet |

## Priorytet 3 – przeładowanie flow i praca wielu instancji w rdzeniu (ogólne API)

Rdzeń Node-RED dostaje wyłącznie ogólne punkty rozszerzeń; implementacje wtyczek (magazyn, koordynacja) powstają poza
tym repozytorium.

| Obszar | Rozwiązanie w rdzeniu | Pozycje |
|---|---|---|
| Wiele instancji – start i gotowość | model stanu instancji (`runtime/lib/state.js`, zdarzenie `instance:state`) | **E-02** |
| Sondy zdrowia, drenaż przy SIGTERM | `health`, `shutdownTimeout` | **Z-08** (D-11) |
| Przeładowanie flow po zmianie w magazynie | `watchFlows` w API magazynu + hook `preReload`; dla magazynu plikowego `watchFlows` na wspólnym wolumenie | **Z-09** |
| Koordynacja instancji (przywództwo, sloty) | `RED.coordination` z domyślną wtyczką lokalną; wtyczka koordynacji podpinana z zewnątrz | **Z-10** |
| Gwarancja braku zapisów lokalnych | `readOnlyUserDir` (16 miejsc zapisu – WERYFIKACJA Z-11) | **Z-11** |
| Instancja tylko edycyjna | flow nie startują na instancji edycyjnej | **Z-15** |

## Plan – kolejność według priorytetów (maks. 2 równolegle, bez wspólnych plików)

| Faza | Tor 1 (edytor / układ flow) | Tor 2 (runtime / API / bezpieczeństwo) | Wynik fazy |
|---|---|---|---|
| **F1** | FL-B-009 → FL-B-004 → FL-B-005 | **P-04** → poprawka XSS `user.js:265` (R-08) → **Z-01** (inne pliki niż tor 1: `editor-api` auth/comms, `editor-client/src/js/{user,comms}.js`) | priorytet 1 domknięty funkcjonalnie; krytyczna luka bezpieczeństwa zamknięta |
| **F2** | E-04/Z-14 (ustawienie, nagłówki 4(b), podział na PR) → FL-B-006 → FL-B-007/008 | **Z-02** → **P-03** → E-01 (kontrakt potoku) | priorytet 1 gotowy do odbioru; bezpieczeństwo domknięte |
| **F3** | **P-02** (edytor `deploy.js`) | **P-01** → **Z-04** → **Z-05** → **Z-06** | priorytet 2 – API |
| **F4** | – | **E-02** + **Z-08** → **Z-11** | start priorytetu 3 – stan instancji, sondy, katalog tylko do odczytu |
| **F5** | – | **Z-10** → **Z-09** → **Z-15** | priorytet 3 – wiele instancji |
| później | Z-03, Z-12 (po załączniku B), Z-13 (język polski) | | |

Zależności techniczne zachowane z [ANALIZA.md](engine-extensions/ANALIZA.md) §6.2 (np. Z-04 przed Z-05, E-01 przed P-01,
Z-06/Z-08/Z-10 przed Z-09). Uzupełnienie zlecenia (zapowiedziane) może zmienić zakres – plan zostanie zaktualizowany.

## Stan końcowy (2026-10-03)

Wszystkie prace w budżecie zakończone i scalone do `main` (`5c2608b`): F1–F3 oraz priorytet 3 (E-02, Z-08,
Z-09, Z-10, Z-11, Z-15). Budżet: 9/250 jednostek pozostało (poniżej zapasu 5% – zużyty na poprawki po
przeglądzie priorytetu 3). Szczegóły, ograniczenia i dalsze prace: [../FORK.md](../FORK.md) §8.

## Kamień milowy F3 (2026-10-03) – zaakceptowany

Stan gałęzi `claude/loving-fermat-ftfo9h` przed scaleniem do `main` i startem F4 (osobna gałąź `feature/p3-database`).

**Zrealizowane:**
- Priorytet 1 – układ flow: Z-14 (LR/TB/auto, połączenia, ustawienie `editorTheme.flowLayout.enabled`), FL-B-004…010
  (eksport/import wyglądu, okno różnic, nieznane wartości, dopasowanie subflow, „zastąp/kopia” przy imporcie, zablokowany
  flow tylko jako kopia), FL-B-012.
- Priorytet 2 – bezpieczeństwo: P-04, XSS nazwy użytkownika (R-08/R-41), Z-01, Z-02 (`httpAdminNodeRoutes`), P-03
  (`telemetry.locked`, także w edytorze).
- Priorytet 2 – API: E-01 (wspólna blokada wdrożeń, projekty), P-01 (`deploy.response`, `deploy.startTimeout`,
  R-45), P-02 (`editorTheme.deploy.staleFlows`), Z-04 (API pojedynczego flow, rewizje v2, R-46), Z-05
  (`deploy.requireRevision`). Z-06 odłożone w F3; **zrealizowane w zgłoszeniu #10 (2026-10-05, R-50)**.
- Proces: nagłówki D-19 + `MODIFICATIONS.md`, rejestr decyzji R-01…R-46.

**Weryfikacja (HEAD `0dc5cf5`):** build i lint czyste, `verify-deps` OK; testy jednostkowe 1790 ✔ / 30 pominiętych /
5 ✘ (projects/ssh – brak `ssh-keygen`); testy węzłów 1569 ✔ / 4 ✘ (proxy, IPv6 – środowisko, tak samo na bazie);
E2E 47/47. Każda faza przeszła niezależny przegląd; uwagi naprawione lub opisane w kartach.

**Znane ograniczenia / otwarte:** FL-B-011 (dopasowanie subflow po kolejności węzłów); ograniczenia FL-B-010 (karta);
Z-02 – ochrona nie jest piaskownicą (opis w `settings.js`); edytor nie testowany w przeglądarce dla 409
`version_required` (tylko testy jednostkowe); brak `id` nowego flow w błędzie `addFlow` (P-01); Z-06, Z-03, Z-07…Z-13,
Z-15 – poza tym etapem. **Aktualizacja instalacji:** ustawić `editorTheme: { flowLayout: { enabled: true } }`.

## Budżet i zakres po F3 (2026-10-03)

Stan: z 250 jednostek pozostało 90 (z F3 w toku). Szacunki względne (kalibracja na F1–F2: pakiet M ≈ 7, L ≈ 13; ±30%);
zapas 5% całego budżetu ≈ 12,5. F3 ≈ 33 (bez Z-06) → **na F4/F5 ≈ 44**. Pełny pozostały zakres (~190) się nie mieści.

**Decyzje (Zamawiający, 2026-10-03):**
- Z-06 (hooki `preDeploy`/`postDeploy`) – **odłożone** poza F3; zrealizowane później w zgłoszeniu #10 (R-50).
- `main` = zakończony etap F3 (kamień milowy). **F4/F5 prowadzone w osobnej gałęzi** (`feature/p3-database`, od `main`
  po kamieniu milowym F3); scalenie do `main` dopiero po akceptacji.
- Zakres priorytetu 3 w budżecie (zaakceptowany): **A** (E-02, Z-08, Z-09 z `watchFlows` dla magazynu plikowego na
  wspólnym wolumenie, Z-15) + **B** (Z-10) + Z-11, łącznie **~45 jednostek**:

| # | Pakiet | Zakres | Zysk |
|---|---|---|---|
| A | E-02, Z-08, Z-09, Z-15 | stan runtime, sondy i drenaż, przeładowanie z `watchFlows` (magazyn plikowy na wspólnym wolumenie) i `preReload`, instancja tylko edycyjna | wiele instancji na wspólnym magazynie; gotowość i restart w Kubernetes |
| B | Z-10 | `RED.coordination` (domyślna wtyczka lokalna, API dla wtyczek koordynacji) | singletony i rozłożone przeładowanie przy wielu instancjach |
| – | Z-11 | katalog użytkownika tylko do odczytu | kontener bez zapisywalnego dysku |

Poza budżetem (osobny etap): Z-07, Z-06, Z-03, Z-12, Z-13, FL-B-011. Zasady oszczędności: jedna runda przeglądu na fazę
(druga tylko przy zmianach bezpieczeństwa), dokumentacja w kartach i CHANGELOG, pełna propagacja przy kamieniu milowym.

**Przeliczenie po F3 (2026-10-03):** pozostało 65/250; F3 kosztowało 25 (szacunek 33 → współczynnik 0,76). Po zapasie
12,5 → ~52 na F4/F5; zakres A + B + Z-11 ≈ 45. Implementacje wtyczek magazynu i koordynacji – poza tym repozytorium.
Tag `milestone-f3` nie wypchnięty – proxy sesji odrzuca wypychanie tagów (403); do założenia na GitHubie na commicie
`e0017f9`.

## Decyzje

| ID | Decyzja | Rekomendacja |
|---|---|---|
| B-01 | FL-B-009: jak utrwalać wygląd flow korzystających z ustawień domyślnych edytora | **przyjęte (2026-10-03, na obecnym etapie ustaleń)**: przy eksporcie i zapisie dopisywać efektywne `layout`/`wireStyle`, gdy ≠ `LR`/`curved` |
| B-02 | Czy zaczynamy F1 przed otrzymaniem uzupełnienia zlecenia | **start (2026-10-03)** – zgoda Zamawiającego po zamknięciu rejestru decyzji; F1 zrealizowane: FL-B-009 `cf95b28`, FL-B-004 `925b091`, FL-B-005 `1116d4f`, P-04 `37269da`, XSS R-08/R-41 `bac427e`, Z-01 `08dbda3` – do niezależnego przeglądu |
| D-04 | Podpisy i zgłoszenia | dane Actuna / Wojciech Repiński; **PR i push do `node-red/node-red` zablokowane** |
| D-11 | Drenaż przy SIGTERM | **przyjęte** |
