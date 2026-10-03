# Zlecenie „Rozszerzenia silnika Node-RED 5.0.6” – analiza zgodności, analiza przekrojowa i plan

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

Data: 2026-10-03 · status: **analiza i plan – bez zmian w kodzie silnika** ·
dokumenty powiązane: [ZASADY.md](ZASADY.md) (nazwy, kontrakt potoku wdrożenia, DoD, szablon),
[WERYFIKACJA.md](WERYFIKACJA.md) (fakty z kodu), karty: [backlog/](backlog/).

## 0. Wnioski w skrócie

1. **Zlecenie jest spójne z naszym kierunkiem** (edytor + workery w Kubernetes, magazyn w bazie,
   publikacja przez edytor/MCP/CI-CD). Większość pakietów to brakujące w rdzeniu „punkty zaczepienia”,
   które w naszym planie K8S zakładaliśmy jako obejścia (sekcja 3).
2. **Weryfikacja kodu koryguje 6 opisów stanu** – najważniejsze:
   - **P-04 jest poważniejszy:** przy wyłączonym `adminAuth` dowolny klient websocket może prawdopodobnie
     zatrzymać proces (`process.exit(1)`) – do obsłużenia trybem zgłoszeń bezpieczeństwa;
   - **Z-03 w większości nieaktualny:** aktualizacja z `.tgz` jest wykrywana; brakuje semver, potwierdzenia i poprzedniej wersji w hookach;
   - **Z-01:** subskrypcja nie ginie po cichu – serwer zamyka połączenie; poprawka jest prostsza;
   - **Z-04:** pole `configs` już istnieje (z zasięgiem flow) – nowe znaczenie „globalne” koliduje z kontraktem;
   - **Z-13:** 1126 kluczy edytora w czystym 5.0.7 (nie 1089), łącznie ~2300 tekstów + 36 plików pomocy; polska liczba mnoga wymaga innych sufiksów niż en-US.
3. **Sześć pakietów zmienia ten sam potok wdrożenia** (P-01, Z-04, Z-05, Z-06, Z-08, Z-09 + nasze FL-B-001/002).
   Bez wspólnego kontraktu (zadanie **E-01**) etapy 1–3 będą się wzajemnie przerabiać.
4. **Proponujemy etap 0** (decyzje + zadania przekrojowe E-01…E-05) i dodatkowe pakiety
   **Z-14** (układ flow – już zrealizowany, do dostosowania) i **Z-15** (instancja tylko edycyjna – wymóg z rozmowy:
   „edytor produkcyjny nie jest workerem”).
5. **Uwagi do wymagań ogólnych:** wersja bazowa (rekomendacja 5.0.7 – poprawki bezpieczeństwa),
   projekt Node-RED wymaga **CLA OpenJS** (nie tylko DCO), brak infrastruktury testów jednostkowych edytora,
   nasze dotychczasowe zmiany wymagają usunięcia atrybucji z nagłówków kodu (wymóg „bez nazw produktów”).

## 1. Metoda

Zgodnie z praktyką *Explore → Specify → Plan*:
1. Cztery niezależne przeglądy kodu tylko do odczytu (każdy z zakresem i formatem wyniku) – wynik w [WERYFIKACJA.md](WERYFIKACJA.md).
2. Porównanie z dotychczasowym planem: [układ flow](../flow-layout/BACKLOG.md), [K8s/PostgreSQL](../k8s-postgres/ARCHITEKTURA.md) (wersja 3, z odpowiedziami zespołu).
3. Analiza przekrojowa (miejsca w kodzie zmieniane przez wiele pakietów).
4. Karty backlogu wg wspólnego szablonu ([ZASADY.md](ZASADY.md) §4) – czterech autorów (agentów), w parach (maks. 2 jednocześnie), na wspólnych faktach z weryfikacji.
5. Niezależny przegląd spójności ([PRZEGLAD.md](PRZEGLAD.md)): 33 uwagi (5 krytycznych), 15 z 17 twierdzeń o kodzie potwierdzonych; poprawki naniesione (rozstrzygnięcia K-1…K-3 w [ZASADY.md](ZASADY.md) §2.3, katalog kodów §2.4).

## 2. Wersja bazowa

| | 5.0.6 | 5.0.7 (+2 commity – baza naszej gałęzi) |
|---|---|---|
| Różnice | – | migracja na załataną bibliotekę JSONata, aktualizacja `body-parser`, poprawka `typedInput`, `file in`, widoczność wyłączonych linii w ciemnym motywie, dokumentacja; po wydaniu: CSV, dokumentacja tcp |
| Obszary pakietów | – | **żadna różnica nie dotyka plików zmienianych przez pakiety P/Z** (sprawdzone na liście zmienionych plików) |

**Rekomendacja:** baza 5.0.7 (bezpieczeństwo). Pakiety przygotowane na 5.0.7 przenoszą się na 5.0.6 bez zmian
merytorycznych (do potwierdzenia przy cherry-pick). Decyzja Zamawiającego – D-01.

## 3. Zgodność z naszym dotychczasowym planem

Legenda: **=** zgodne (ten sam cel) · **+** uzupełnia (zlecenie dostarcza fundament dla naszego zadania) ·
**≠** koliduje (wymaga uzgodnienia) · **→** zmienia nasz plan.

| Pakiet | Nasze pozycje | Relacja | Komentarz / działanie |
|---|---|---|---|
| P-01 odpowiedź po starcie | K8S §3.6 (publikacja CI/CD, MCP) | **+** | automaty dostają odpowiedź, gdy flow faktycznie działa – warunek wiarygodnych testów po wdrożeniu w CI/CD |
| P-02 nieaktualny edytor | FL-B-004 (okno różnic) | **=** / **≠** | w trybie `reload-only` scalanie znika; FL-B-004 nadal potrzebne w trybie `prompt` |
| P-03 telemetria | on-premise (K8S v3) | **+** | on-premise: zalecane `locked: true` |
| P-04 tokens przed init | K8S-T-005 (workery) | **+** | dotyczy instancji z edytorem (`/comms` nie startuje przy `disableEditor`); workery z `disableEditor` nadal wystawiają **Admin API** (`editor-api/lib/index.js:83-95`) |
| Z-01 wyścig /comms | – | = | edytor; brak kolizji |
| Z-02 trasy admin bloczków | K8S-T-005 (bezpieczeństwo) | **+** | dodatkowo zalecenie dla workerów: `httpAdminRoot: false` + sondy na osobnym porcie (Z-08) |
| Z-03 aktualizacja .tgz | K8S-T-004 (obraz, paleta tylko do odczytu) | = | w docelowym K8s upload wyłączony; pakiet nadal uniwersalnie przydatny – niższy priorytet dla nas |
| Z-04 API pojedynczego flow | **FL-B-001** (layout w API flow), K8S §3.6 | **+ / ≠** | te same funkcje (`addFlow/getFlow/updateFlow`) – Z-04 musi zachować `copyFlowLayoutProperties`; MCP/CI pracują per flow |
| Z-05 wymóg rewizji | K8S §3.6 (409 przy konflikcie) | **=** | dokładnie nasz wymóg dla edytor/MCP/CI |
| Z-06 hooki wdrożenia | K8S §3.6 (walidacja w jednym miejscu), K8S-T-006 | **+** | `preDeploy` = nasza walidacja; `postDeploy` = wyzwalacz publikacji rewizji / rolling update |
| Z-07 trasy węzła | K8S-T-007 (strumieniowanie HTTP) | **+** | nasze węzły strumieniowe użyją `registerHttpRoute` |
| Z-08 sondy | K8S-T-005, ARCHITEKTURA §3.5 (drenaż) | **=** | wymagamy: 503 od SIGTERM, osobny port, zamykanie serwera HTTP |
| Z-09 przeładowanie z magazynu | ARCHITEKTURA §3.2–3.3, K8S-T-001 | **→** | Zamawiający wybiera **przeładowanie w miejscu z drenażem przez `preReload`**. Zmiana planu: Z-09 jako mechanizm podstawowy, wydania niezmienne (K8S-T-006) jako opcja operacyjna; nasza wtyczka magazynu (K8S-T-001) implementuje `watchFlows` (PostgreSQL LISTEN/NOTIFY lub Redis). Przy rozmowach do ~15 min limit `preReload` ≥ 20 min |
| Z-10 koordynacja | K8S-T-013 (singletony), K8S-T-014 (kolejki) | **→ / +** | koordynacja w rdzeniu zastępuje nasze obejście z K8S-T-013; implementacja wtyczki (PostgreSQL advisory lock / Redis) po naszej stronie; kolejki pozostają uzupełnieniem |
| Z-11 userDir tylko do odczytu | K8S-T-004, K8S-A-002, ANALIZA K8s §1.2 | **=** | lista zapisów z weryfikacji (16 miejsc) = podstawa dokumentacji |
| Z-12 punkty rozszerzeń edytora | K8S-T-006 (przycisk publikacji), K8S-T-003 | **+** | API nagłówka/Deploy umożliwi przycisk „Publikuj” i oznaczenie środowiska bez wstrzykiwania skryptów |
| Z-13 język polski | FL-T-004 | **=** | klucze `layout.*` (Z-14) w zakresie tłumaczenia |
| – | **Z-14** układ flow (zrealizowany) | **propozycja** | dostosować do wymagań zlecenia (sekcja 6.4) |
| – | **K8S-T-002** rola editor (flow nie startują) | **luka → Z-15** | wymóg rozmowy: edytor produkcyjny nie jest workerem; dziś tylko obejście przez magazyn (`runtimeFlowState`), które zapisuje stan we wspólnych ustawieniach |
| – | K8S-T-003 debug/status z workerów | luka (bez zmian w rdzeniu) | realizowalne wtyczką (`RED.events`/`RED.comms` dostępne dla wtyczek); poza zakresem zlecenia – zostaje w naszym backlogu |
| – | K8S-T-007 strumieniowanie HTTP | luka (paleta) | pakiet węzłów, nie zmiana rdzenia |

**Wniosek:** brak sprzeczności blokujących; jedna zmiana kierunku (Z-09 zamiast wydań niezmiennych jako
mechanizm podstawowy – akceptujemy, z warunkiem długiego limitu `preReload`) i dwie luki (Z-15, Z-14).

## 4. Analiza przekrojowa silnika

### 4.1 Potok wdrożenia – miejsce o największym ryzyku konfliktów

| Funkcja / plik | P-01 | Z-04 | Z-05 | Z-06 | Z-08 | Z-09 | FL-B-001/002 |
|---|---|---|---|---|---|---|---|
| `runtime/lib/api/flows.js` `setFlows` (mutex, kontrola rev) | ● | ● | ● | ● | | ● | |
| `runtime/lib/flows/index.js` `setFlows/start/stop/load` | ● | | | ● | ● | ● | |
| `runtime/lib/flows/index.js` `addFlow/getFlow/updateFlow` | ● | ● | ● | ● | | | ● |
| `editor-api/lib/admin/flows.js`, `flow.js` | ● | ● | ● | ● | | | |
| `runtime/lib/flows/util.js` `diffConfigs/diffNodes` | | | | ● (lista zmienionych flow) | | ● | ● |

**Działanie:** zadanie **E-01** – kontrakt potoku wdrożenia ([ZASADY.md](ZASADY.md) §2.3) zatwierdzony przed
P-01; wszystkie pakiety implementują swoje kroki w tej kolejności. Dodatkowo naprawa ujawniona w weryfikacji:
pusty `.catch` połykający błędy zatrzymania (`flows/index.js:233`) – w ramach P-01 (tryb `started`) i jako
osobna poprawka błędu dla trybu domyślnego → **D-05**: w trybie domyślnym zachowujemy 5.0.6 (zgodność), w trybie `started` błąd zatrzymania jest zwracany (`deploy_stop_failed`, [ZASADY.md](ZASADY.md) §2.3–2.4); poprawkę trybu domyślnego proponujemy upstream osobno.

### 4.2 Model stanu instancji (E-02)

P-01, Z-08 i Z-09 potrzebują jednego, wiarygodnego stanu runtime:

```
init ──▶ starting ──▶ ready ──▶ deploying ──────────────▶ ready
            │           │  └──▶ reloadPending ──▶ reloading ──▶ ready
            │           │        (preReload, drenaż;   (pod blokadą)
            │           │         unieważniane przez wdrożenie)
            │           └──────────▶ stopping (SIGTERM/SIGINT, nieodwracalny) ──▶ stopped
            └─▶ failed (start / odczyt flow się nie powiódł)
            idle – flow świadomie zatrzymane (runtimeState „stop”), zgodnie z kartą E-02
instancja tylko edycyjna (Z-15): init ──▶ loaded (flow wczytane, nie uruchomione)
```
Szczegóły przejść (T1–T13) i niezmienniki – karta E-02 w [backlog/etap-3.md](backlog/etap-3.md);
kolejność kroków wdrożenia/przeładowania/zatrzymania – [ZASADY.md](ZASADY.md) §2.3.

- Źródło: zdarzenia już istniejące (`flows:starting/started/stopping/stopped`, `runtime-state`) + nowe przejścia
  (`deploying`, `reloading`, `stopping` od sygnału).
- Fakt z weryfikacji: `RED.start()` kończy się **przed** startem flow, a serwer HTTP nie jest zamykany przy SIGTERM –
  bez modelu stanu sonda `/ready` byłaby fałszywie pozytywna.
- Jeden moduł (np. `runtime/lib/state.js`) zamiast logiki rozproszonej po pakietach; testy przejść.

### 4.3 Bezpieczeństwo

| Problem | Pakiet | Rekomendacja |
|---|---|---|
| Zdalne zatrzymanie procesu bez uwierzytelnienia (wniosek z kodu) | P-04 | potwierdzić testem; zgłoszenie **prywatnie** wg `SECURITY.md` projektu, nie publiczny PR; do czasu wydania – poprawka w naszym obrazie |
| Połączenie `/comms` (upgrade websocket) pomija `httpAdminMiddleware` i nie sprawdza nagłówka `Origin` (`editor/comms.js:222-245`) – atak może przyjść z obcej strony otwartej w przeglądarce użytkownika (wniosek z kodu, karta P-04) | P-04 | kontrola `Origin` dla `/comms` jako osobna decyzja (D-07); dołączyć do zgłoszenia bezpieczeństwa |
| Trasy admin węzłów bez uprawnień | Z-02 | tryb `authenticated`; przegląd publicznych widoków core (`21-debug.js:286,310`) |
| Admin API dostępne na workerach (`disableEditor` go nie wyłącza) | – (konfiguracja) | workery: `httpAdminRoot: false`; sondy z Z-08 niezależne od `httpAdminRoot` (osobny port) |
| Telemetria wbrew administratorowi | P-03 | `telemetry.locked` |
| Wymuszone nadpisanie flow | P-02, Z-05 | `reload-only` w edytorze + `requireRevision` po stronie serwera (sama polityka edytora nie chroni przed innymi klientami) |

### 4.4 Ustawienia i nazwy
Spójny zestaw: obiekt `deploy` (P-01, Z-04, Z-05), `editorTheme.deploy` (P-02), `telemetry.locked`,
`httpAdminNodeRoutes`, `health`, `readOnlyUserDir`, `editorTheme.flowLayout` (Z-14). Szczegóły i uzasadnienia –
[ZASADY.md](ZASADY.md) §2.1 (decyzja **D-02**).

### 4.5 Hooki i wtyczki
- Nowe hooki: `preDeploy`, `postDeploy`, `preReload` – rozszerzenie białej listy `VALID_HOOKS` (`util/lib/hooks.js:3-17`) i dokumentacji.
- Nowy typ wtyczki `node-red-coordination` – wzorzec `node-red-library-source`; koordynacja gotowa przed `startFlows` (`runtime/lib/index.js:239-243`).
- Wtyczki magazynu: opcjonalne `watchFlows` (Z-09) – kontrakt opcjonalny, wykrywany jak `getSettings`.

### 4.6 Edytor i testy edytora
- Pakiety edytora: P-02, Z-01, Z-12, Z-13, Z-14. **Testy jednostkowe edytora prawie nie istnieją** – jest `search_spec.js` (upstream)
  i nasz `view-layout_spec.js`, oba ładujące moduł przez `require` z atrapą `RED`.
- **E-03:** uzgodnić harness testów edytora: (a) jednostkowe w stylu istniejących `search_spec.js`/`view-layout_spec.js`
  dla logiki wydzielonej z DOM; (b) E2E (Playwright – **nie jest zależnością projektu**; nasze testy pomijają się bez niego) →
  decyzja **D-03**: czy Playwright może być zależnością deweloperską (wymóg 3.7 zlecenia).
- Kryteria odbioru P-02, Z-01, Z-12 zakładają „test edytora” – bez E-03 nie da się ich spełnić w `npm test`.

### 4.7 Zgodność z przyszłymi wersjami
- Z-07: obecny kod `http in` zależy od wewnętrznego `_router` Express 4 – nowe API uniezależnia od Express 5.
- Z-10, Z-12: nowe publiczne API = zobowiązanie utrzymaniowe; projektować minimalnie, z dokumentacją.

### 4.8 Ocena pod kątem zgłoszenia do projektu Node-RED (ocena, nie stanowisko projektu)

| Pakiet | Ocena szans / ryzyko | Alternatywa |
|---|---|---|
| P-04, Z-01, błąd `splice` w Z-07 | wysoka – poprawki błędów | osobne, małe PR (P-04 przez kanał bezpieczeństwa) |
| P-03, Z-08, Z-11, Z-06 | średnio-wysoka – ogólne potrzeby wdrożeń | najpierw dyskusja na forum/issue |
| P-01, Z-04, Z-05 | średnia – zmiany kontraktu Admin API | opcjonalne, domyślnie wyłączone – zgodnie ze zleceniem |
| Z-02 | średnia – może łamać istniejące węzły po włączeniu | tylko opt-in + ostrzeżenia w logu (tryb „report-only” jako etap pośredni) |
| P-02 `reload-only` | średnio-niska – polityka specyficzna dla wdrożeń wieloklientowych | jeśli odrzucone – zostaje jako łatka w naszym obrazie |
| Z-09, Z-10 | niska-średnia – klastrowanie w rdzeniu to duża decyzja projektowa | minimalne punkty zaczepienia w rdzeniu (opcjonalne `watchFlows`, typ wtyczki), implementacje poza rdzeniem |
| Z-12 | zależy od listy z załącznika B | każdy punkt osobno |
| Z-13 | wysoka (tłumaczenia są przyjmowane), wymaga przeglądu językowego | – |
| Z-14 | średnia – duża zmiana edytora | dyskusja z opiekunami przed PR; podział na mniejsze PR |

### 4.9 Dodatkowe błędy ujawnione przy pisaniu kart (wnioski z kodu, nieuruchamiane)

| Błąd | Miejsce | Karta | Propozycja |
|---|---|---|---|
| `restart()` używa niezdefiniowanej zmiennej `nns` – przy 409 możliwy `ReferenceError` | `editor-client/src/js/ui/deploy.js:390` | **P-02** (właściciel `deploy.js`) | poprawka z testem w P-02 |
| `installTarball` zapisuje `.tgz` przed sprawdzeniem wersji (ta sama wersja → plik zostaje/nadpisuje); pomija `pending_version` | `registry/lib/installer.js:443` | Z-03 | w zakresie skorygowanego Z-03 |
| Zamknięcie jednego węzła `http in` usuwa trasy innych węzłów z tą samą ścieżką i metodą; `splice` w `forEach` | `nodes/core/network/21-httpin.js:356-365` | Z-07 | testy regresji na 5.0.7 przed zmianą (brak testów `http in` w repozytorium) |
| `updateFlow` nie sprawdza duplikatów id względem innych flow | `runtime/lib/flows/index.js` | Z-04 | do potwierdzenia, test kontraktu |
| Błąd startu zapisuje konfigurację – odpowiedź z błędem musi zawierać `rev`, inaczej kolejne wdrożenie edytora dostanie 409 | `runtime/lib/flows/index.js` | P-01 | w specyfikacji P-01 |
| Hook `preDeploy` wykonywany pod blokadą API – długi hook blokuje wszystkie wdrożenia | `runtime/lib/api/flows.js:67` | Z-06 | limit czasu hooka |

### 4.10 Przeładowanie i zatrzymanie w wielu replikach (ryzyko z karty Z-09/Z-08)

| Problem | Skutek | Propozycja |
|---|---|---|
| Powiadomienie `watchFlows` trafia **jednocześnie do wszystkich workerów**; każdy w drenażu zwraca `/ready` 503 | przy rozmowach do ~15–20 min **cały Deployment wypada z load balancera** | (1) **przeładowanie rozłożone w czasie** – runtime przed przeładowaniem zajmuje „slot przeładowania” przez koordynację Z-10 (`claim("reload:<rev>", T)` z limitem równoległości, np. 1 lub 25% replik); domyślna wtyczka lokalna = brak ograniczeń (jak dziś); (2) **przeładowanie różnicowe** – restart tylko zmienionych flow, `/ready` 503 tylko gdy przeładowanie dotyczy flow obsługujących ruch (do decyzji); (3) alternatywa operacyjna: wydania niezmienne + rolling update (K8S-T-006) |
| SIGTERM natychmiast zatrzymuje flow (`node-red/red.js:543-558` → `RED.stop()`) | `terminationGracePeriodSeconds` nie chroni rozmów – flow giną na początku okresu | Z-08: po SIGTERM najpierw `/ready` 503 i **drenaż** (hook `preShutdown` lub ten sam mechanizm co `preReload`, z limitem), dopiero potem `RED.stop()`; zamknięcie serwera HTTP; globalny limit czasu |
| `readOnly` istniejącego magazynu plikowego pomija zapis flow po cichu – wdrożenie „udaje się”, zmiany giną po restarcie | utrata zmian | Z-11: przy `readOnlyUserDir` z magazynem plikowym – wdrożenie zwraca błąd zamiast cichego pominięcia (decyzja) |
| Błąd odczytu flow przy starcie połykany (`runtime/lib/index.js:245`, `.catch` obejmuje tylko `loadFlows`) | instancja „działa” bez flow | E-02: stan `failed` i `/ready` 503 |
| Zmiana samych poświadczeń nie zmienia rewizji (`storage/index.js:80`) | przeładowanie pominięte jako „własny zapis” | Z-09: pole `credentialsChanged` w powiadomieniu |
| Odrzucenie promise ze `startFlows()` nie jest przechwytywane (`runtime/lib/index.js:241-245`) | nieobsłużone odrzucenie przy starcie | E-02/Z-08: stan `failed`, log, `/ready` 503 |
| Treść odczytana pod blokadą (krok B4) zmienia flow, które nie były drenowane w `preReload` | przerwanie rozmów w flow spoza drenażu | Z-09: ponowny `preReload` dla dodatkowych flow (z limitem) – D-17 |

## 5. Uwagi do wymagań ogólnych zlecenia

| # | Wymaganie | Uwaga | Propozycja |
|---|---|---|---|
| 3.1 | baza 5.0.6 | 5.0.7 zawiera poprawki bezpieczeństwa | baza 5.0.7 (D-01) |
| 3.2 | domyślnie jak 5.0.6 | spełnione przez ustawienia; wyjątek: poprawki błędów (P-04, Z-01) i nasze Z-14 (wymaga ustawienia `editorTheme.flowLayout.enabled`) | E-04 |
| 3.3 | brak nazw produktów | nasze pliki `view-layout.js` i `flowLayout.js` mają atrybucję w nagłówku; CHANGELOG zawiera nazwę firmy | E-04: atrybucja tylko w dokumentacji projektowej (`design/`) i opisie dostarczenia |
| 3.5 | `npm test` bez błędów | w środowisku bez `ssh-keygen` 5 testów projektów pada (niezwiązane) | środowisko CI z `ssh-keygen` (jak w `.github/workflows/tests.yml`) |
| 3.5 | testy edytora | brak harnessu jednostkowego edytora | E-03, D-03 |
| 3.8 | DCO `Signed-off-by` | projekt Node-RED wymaga podpisania **CLA OpenJS** (`CONTRIBUTING.md:48`); podpis DCO musi złożyć osoba odpowiedzialna za wkład (praca z AI – osoba z Wykonawcy przegląda i podpisuje) | D-04: kto podpisuje CLA/DCO; polityka oznaczania pracy wspomaganej AI |
| 3.8 | jeden pakiet = jedna gałąź | pakiety potoku wdrożenia zależą od siebie | gałęzie pakietów toru A **warstwowo** (E-01 → P-04 → P-01 → Z-04 → Z-05 → Z-06 → Z-08 → Z-10 → Z-09 → Z-11 → Z-15), tor B od bazy; gałąź integracyjna z pełnym `npm test` |
| 7 | poza zakresem: wiele replik edytora | zgodne z naszą architekturą (1 pod edytora na tenanta) | – |

## 6. Plan

### 6.1 Etap 0 (proponowany) – decyzje i zadania przekrojowe

| ID | Zadanie | Wynik |
|---|---|---|
| D-01…D-16 | decyzje Zamawiającego (sekcja 7) | zapis decyzji w tym pliku |
| E-01 | kontrakt potoku wdrożenia (ADR) | zatwierdzona kolejność kroków, punkty hooków, stany, mutex |
| E-02 | model stanu instancji | specyfikacja przejść + testy (implementacja w Z-08) |
| E-03 | harness testów edytora | szablon testu jednostkowego klienta + decyzja E2E |
| E-04 | dostosowanie istniejącej gałęzi | usunięcie atrybucji z kodu, podział na gałęzie pakietów, ustawienie `editorTheme.flowLayout.enabled` |
| E-05 | środowisko weryfikacji | CI z pełnym `npm test` (w tym `ssh-keygen`), szablon raportu pakietu – karta w [backlog/etap-4.md](backlog/etap-4.md) |

> **Priorytety biznesowe (2026-10-03)** zmieniają kolejność faz – obowiązuje [../PRIORYTETY.md](../PRIORYTETY.md); poniższe tory i zależności techniczne pozostają w mocy.

### 6.2 Kolejność realizacji – dwa tory (maks. 2 pakiety równolegle, bez wspólnych plików)

Zasada: tor **A** = potok wdrożenia i runtime (zmiany w `runtime/lib/api/flows.js`, `runtime/lib/flows/*`,
`runtime/lib/index.js`, `node-red/red.js` – **sekwencyjnie**); tor **B** = pakiety rozłączne plikowo z torem A.
Wspólne pliki dokumentacyjne (`packages/node_modules/node-red/settings.js`, `CHANGELOG.md`, `locales/*`) są wyłączone
z reguły – scalane w kolejności zakończenia pakietów.

| Etap odbioru | Tor A (sekwencyjnie) | Tor B (równolegle do A) |
|---|---|---|
| 0 | E-01, E-02 (dokumenty) | E-03 (harness testów edytora), E-05 (środowisko CI) |
| 1 | **P-04** → **P-01** | **Z-01** → **P-03** → **Z-02** → **P-02** (właściciel `deploy.js`, poprawka `nns`) |
| 2 | **Z-04** → **Z-05** → **Z-06** (Z-05 zależy od Z-04; Z-14 część runtime – razem z Z-04) | **Z-03** → **Z-07** → **E-04/Z-14** (część edytora) |
| 3 | **Z-08** (z implementacją E-02) → **Z-10** → **Z-09** (po Z-06, Z-08, Z-10 – limit równoległości przeładowań) → **Z-11** | **Z-13** (tłumaczenie – start) |
| 4 | **Z-15** | **Z-13** (domknięcie, w tym klucze nowych pakietów) → **Z-12** (po załączniku B) |

Zależności miękkie (bez cykli): P-02 → Z-05 (po dostarczeniu Z-05 edytor w `reload-only` korzysta z wymogu
rewizji; integracja edytora w Z-05 dotyka `deploy.js` po scaleniu P-02); Z-06 i Z-08 udostępniają punkty
integracji, z których korzysta Z-09 (nie odwrotnie).

### 6.3 Weryfikacja na każdym kroku
Test czerwony → implementacja → testy pakietu → `npm test` → niezależny przegląd diffu (agent przeglądu wg [ZASADY.md](ZASADY.md) §5)
→ raport pakietu (co, ustawienia, zgodność, dowody, czego nie zweryfikowano) → gałąź integracyjna → `npm test`.

### 6.4 Pakiety proponowane

**Z-14 – Układ flow (góra–dół, automatyczny, routing linii)** – zrealizowany na gałęzi `claude/loving-fermat-ftfo9h`
([dokumentacja](../flow-layout/DOKUMENTACJA.md)). Dostosowanie (E-04): ustawienie `editorTheme.flowLayout.enabled` (domyślnie
`false` → brak nowych elementów UI), usunięcie atrybucji z kodu i CHANGELOG, `Signed-off-by`, podział na PR
(runtime `diffNodes` + API flow → razem z Z-04; geometria `view-layout.js`; UI), klucze `layout.*` w `pl` (Z-13),
otwarte błędy FL-B-004…008 według priorytetów.

**Z-15 – Instancja tylko edycyjna** – ustawienie (propozycja: `runtimeState.autoStart: false` lub `editorOnly: true` – D-02),
przy którym runtime wczytuje flow, ale ich nie uruchamia, **bez zapisu stanu do magazynu** (dziś `runtimeFlowState`
trafia do wspólnych ustawień i zatrzymałby workery). Funkcje zależne od działającego runtime (debug, status, przycisk
`inject`) – opis ograniczeń; przekazywanie zdarzeń z workerów pozostaje wtyczką (K8S-T-003).

## 7. Decyzje Zamawiającego

### 7.0 Podjęte (2026-10-03)

| ID | Decyzja | Skutek w planie |
|---|---|---|
| **D-01** | baza **5.0.7** | gałęzie pakietów od znacznika/commita wydania 5.0.7 |
| **D-02** | rekomendacje nazw przyjęte **po krytycznym sprawdzeniu** | wynik i korekty w [ZASADY.md](ZASADY.md) §2.1a: `shutdownTimeout` (płasko, zamiast `health.shutdownTimeout`), relacja `readOnlyUserDir` ↔ istniejące `readOnly`, `editorOnly` wyklucza się z `disableEditor` |
| **D-03** | **bez Playwright w repozytorium**; E2E to osobny podzbiór testów | kryteria „test edytora” spełniane testami jednostkowymi logiki wydzielonej z DOM (E-03) w `npm test`; E2E – osobny podzbiór uruchamiany poza `npm test`, z narzędziem instalowanym poza repozytorium, **nie wchodzi do gałęzi pakietów** |
| **D-10** | przyjęte: przeładowanie różnicowe + limit równoległości przez koordynację | Z-09: `deploy.reload.type` (`"full"` domyślnie dla zgodności, `"diff"` rekomendowane), `deploy.reload.concurrency` |
| **D-04** | commity i podpisy **danymi Actuna Sp. z o.o. i Wojciecha Repińskiego**; **zgłoszenia do `node-red/node-red` (PR, push) zablokowane** do odwołania | autor commitów `Wojciech Repiński <tech@actuna.pl>` + `Signed-off-by` (od 2026-10-03; wcześniejsze commity – autor „Claude”, porządkowane w E-04 przy tworzeniu gałęzi pakietów); udział AI oznaczany w commitach (`Co-Authored-By`); CLA OpenJS – podpis dopiero przy ewentualnym zgłoszeniu; lokalna blokada `pre-push` (`design/git-hooks/pre-push`) |
| **D-11** | **przyjęte**: drenaż przy SIGTERM w rdzeniu (hook `preShutdown`, `shutdownTimeout`, domyślnie wyłączony) | Z-08 – scenariusze drenażu w karcie |

### 7.1 Do podjęcia

| ID | Decyzja | Rekomendacja |
|---|---|---|
| D-04 | CLA OpenJS / DCO, polityka oznaczania pracy z AI | podpis osoby odpowiedzialnej; informacja o wspomaganiu AI w opisie PR |
| D-05 | poprawki ujawnione w weryfikacji, ale spoza zakresu (połykanie błędów zatrzymania, `splice` w `http in`, niespójne nazwy ustawień uploadu, zamykanie serwera HTTP przy SIGTERM) | dołączyć do pakietów, których dotyczą (P-01, Z-07, Z-03, Z-08), jako poprawki błędów z testami regresji |
| D-06 | Z-14 i Z-15 w zakresie zlecenia | tak |
| D-07 | kontrola nagłówka `Origin` dla `/comms` (ochrona przed obcymi stronami) | tak, jako ustawienie z bezpieczną listą domyślną (do uzgodnienia w zgłoszeniu bezpieczeństwa) |
| D-08 | Z-04: kolizja pola `configs` (dziś z zasięgiem flow) – nowe pole `globalConfigs[]` vs zmiana znaczenia | `globalConfigs[]` (zgodność wstecz) |
| D-09 | Z-04: `rev` w `GET /flow/:id` tylko dla `Node-RED-API-Version: v2` (klienci v1 robiący GET→PUT nie dostaną nagle 409) | tak |
| ~~D-10~~ (podjęta, §7.0) | Z-09: przeładowanie rozłożone w czasie i/lub różnicowe | `deploy.reload.type` domyślnie `"full"` (jak dziś), **rekomendowane `"diff"`** dla wdrożeń z długimi rozmowami; limit równoległości `deploy.reload.concurrency` przez koordynację (Z-10) |
| D-12 | P-02/Z-05: „Overwrite” w edytorze przy `deploy.requireRevision` | wymuszone nadpisanie wysyła aktualną rewizję po potwierdzeniu w oknie; w `reload-only` niedostępne |
| D-13 | Z-08/Z-15: `/ready` instancji tylko edycyjnej | 200 po wczytaniu flow (stan `loaded`) – instancja gotowa do edycji |
| D-14 | Z-10: semantyka „tylko jedna instancja” w `inject` | harmonogram cron: zajęcie klucza `<id>:<czas zaplanowany>` (dokładnie raz); interwał: lider |
| D-15 | Z-11: kontekst `localfilesystem` przy `readOnlyUserDir` | błąd startu z czytelnym komunikatem (bez cichej zmiany na `memory`) |
| D-16 | Z-13: zakres – `runtime.json` i pomoc HTML węzłów (~13,3 tys. słów) | `runtime.json` tak; pomoc HTML – osobna wycena |
| D-17 | Z-09: flow zmienione po drenażu (odczyt pod blokadą) | ponowny `preReload` tylko dla dodatkowych flow, w ramach pozostałego limitu czasu |
| D-18 | Z-09: ponawianie odczytu magazynu po błędzie (`deploy.reload.retry`) | tak – wykładniczo, z limitem; stan `failed` po wyczerpaniu |

Pozostałe pytania z kart (ok. 35, pogrupowane i bez duplikatów) – [PRZEGLAD.md](PRZEGLAD.md) §7; każda karta
ma też sekcję „Pytania do Zamawiającego”.

## 8. Backlog

| Etap | Plik | Karty |
|---|---|---|
| 1 | [backlog/etap-1.md](backlog/etap-1.md) | E-01, P-01, P-02, P-03, P-04, Z-01, Z-02 |
| 2 | [backlog/etap-2.md](backlog/etap-2.md) | Z-03, Z-04, Z-05, Z-06, Z-07 |
| 3 | [backlog/etap-3.md](backlog/etap-3.md) | E-02, Z-08, Z-09, Z-10, Z-11 |
| 4 | [backlog/etap-4.md](backlog/etap-4.md) | Z-12, Z-13, Z-14, Z-15, E-03, E-04, E-05 |

Każda karta zawiera: weryfikację stanu, specyfikację, projekt, kryteria akceptacji BDD (kryteria odbioru ze
zlecenia + uzupełnienia), testy, DoD specyficzne, ryzyka, podzadania. Wspólne DoD i ewaluacje – [ZASADY.md](ZASADY.md) §3.

## 9. Potwierdzenie kryteriów odbioru ze zlecenia

| Pakiet | Kryteria ze zlecenia | Ocena | Uzupełnienia (w kartach) |
|---|---|---|---|
| P-01 | test 200 po odpowiedzi, tryb domyślny, reload | **wystarczające, niekompletne** | błąd startu zwracany w odpowiedzi; `addFlow/updateFlow/removeFlow`; wywołania wewnętrzne bez zmiany kolejności |
| P-02 | E2E reload-only, tryb domyślny | **wymaga E-03** | oba wejścia do okna (409, powiadomienie w tle), blokada wymuszonego wdrożenia |
| P-03 | locked + zapisane true → brak wysyłki; bez locked | wystarczające | API ustawień przy `locked`; UI zablokowane; zmienna środowiskowa |
| P-04 | test przed `init()` pada bez poprawki | **niewystarczające** | scenariusz bez `adminAuth` z pakietem `auth`; brak `process.exit`; `.catch` w obsłudze pakietu auth |
| Z-01 | subskrypcja przed `auth ok` dostarczona po | **do korekty** | rzeczywisty objaw: zamknięcie połączenia bez użytkownika anonimowego |
| Z-02 | 401/200, needsPermission, publiczna, domyślny | wystarczające | widoki debug core, log przy starcie, brak `adminAuth` |
| Z-03 | nowsza/ta sama/starsza + API | **do korekty zakresu** | semver, poprzednia wersja w hookach, potwierdzenie w edytorze, spójne nazwy ustawień |
| Z-04 | kontrakt: stare, rev, tworzenie, configs | wystarczające po decyzji | rozstrzygnięcie kolizji `configs`; zachowanie FL-B-001 |
| Z-05 | oba stany v1, v2, /flow/:id | niekompletne | `POST /flow`, `DELETE /flow/:id`, `reload`, wymuszone nadpisanie w edytorze |
| Z-06 | odrzucenie, kolejność, wyjątek, brak hooków | wystarczające | limit czasu hooka; błąd `postDeploy` nie cofa wdrożenia |
| Z-07 | trasa raz / wcale; http in bez zmian | wystarczające | regresja błędu `splice`; kolejność middleware |
| Z-08 | przejścia stanów | niekompletne | 503 od SIGTERM przed zamknięciem flow; serwer nasłuchuje przed startem flow; osobny port |
| Z-09 | powiadomienie, opóźnienie, limit, brak watch | niekompletne | wspólny mutex z Admin API; zbiegające się powiadomienia (koalescencja); błąd odczytu magazynu |
| Z-10 | dwa runtime'y, przejęcie, wtyczka lokalna | niekompletne | wygaśnięcie dzierżawy, utrata połączenia z koordynatorem, ręczny przycisk `inject` niegatkowany |
| Z-11 | start i wdrożenie bez zapisu, lista | wystarczające | `userDir` nieustawiony przy własnym magazynie; kopia `settings.js` przez CLI |
| Z-12 | przykład pluginu na punkt, testy edytora | **wymaga E-03** i załącznika B | – |
| Z-13 | zgodność kluczy, przegląd językowy | wystarczające | automatyczny test zgodności kluczy pl↔en-US w `npm test` |
