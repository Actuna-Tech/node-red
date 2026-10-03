# Nazwy ustawień i API – ponowna analiza (D-02, rewizja) – perspektywa analityka

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.
> Dotyczy: [ZASADY.md](ZASADY.md) §2.1/§2.1a, [ANALIZA.md](ANALIZA.md) §7 (D-02, D-20), [ZALACZNIK-A-ANALIZA.md](ZALACZNIK-A-ANALIZA.md),
> załącznik A (`Zalacznik-A/0001…0006-*.patch`, `README.md`). Równoległa ocena konwencji kodu – agent-architekt (osobny dokument);
> tu: koszt migracji, czytelność dla administratora, dokumentacja, narzędzia zewnętrzne (MCP, CI/CD, automaty Admin API), szansa upstream.
> „Do potwierdzenia” = wymaga odpowiedzi Zamawiającego, nie da się ustalić z kodu.

## 1. Metoda

1. Przeczytano README załącznika A i każdą łatkę 0002–0006 (0001 to tłumaczenie – bez ustawień i API). Dla każdej linii dodanej
   sprawdzono, czy wprowadza: klucz ustawień (`settings.*`), kod/status HTTP, pole odpowiedzi, funkcję eksportowaną, klucz i18n,
   zmianę zachowania widoczną z zewnątrz.
2. Sprawdzono w kodzie 5.0.7, co jest dostępne klientom zewnętrznym (Admin API, API węzłów `RED.*`, API osadzających
   `require('node-red').runtime`), a co jest modułem wewnętrznym.
3. Sprawdzono szablon `packages/node_modules/node-red/settings.js` i kod pod kątem istniejących kluczy `flows`, `deploy`, `editor`,
   `health` oraz kolizji z ustawieniami użytkownika edytora.
4. Policzono wystąpienia obu zestawów nazw w dokumentacji projektu (`design/**/*.md`) – miara kosztu zmiany dokumentacji.
5. Ocena per wiersz według sześciu kryteriów (§4) i rekomendacja (§5). Nie powtarzam dowodów architekta o konwencji kodu
   poza tym, co potrzebne do wniosków biznesowych.

## 2. Kontrakty zewnętrzne w łatkach (z dowodami)

### 2.1 Czy łatki mają ustawienia? – **Nie.**

| Łatka | Odwołania do `settings` w liniach dodanych | Wniosek |
|---|---|---|
| 0002 (`tokens.js`) | brak – `if (!storage) return Promise.resolve(null);` | poprawka błędu, bez ustawienia (zgodnie z README: P-04 „—”) |
| 0003 (`telemetry/index.js`) | brak – `return false` na początku `isTelemetryEnabled()` | na sztywno; README sam proponuje `telemetry.locked` |
| 0004 (`api/flows.js`, `flows/index.js`) | brak – `afterStart()` wywoływane **zawsze**; w teście `flows.init({... settings:{} ...})` | na sztywno |
| 0005 (testy) | brak | – |
| 0006 (`admin/flows.js`, `deploy.js`, locale) | brak – 409 **zawsze** dla v2 bez `rev`; w edytorze brak `RED.settings.*` dla nowej logiki | na sztywno |

README (sekcja „Łatki zmieniają zachowanie **na sztywno**”) potwierdza to wprost i podaje nazwy `flows.deployResponse`,
`editor.staleFlowsPolicy`, `flows.requireRevision` jako **„propozycję”** – nie jako nazwy użyte w jakimkolwiek `settings.js`.

**Skutek:** żaden plik konfiguracyjny Zamawiającego (środowiska, Helm, obrazy) nie może dziś zawierać tych kluczy w sposób
działający – nie ma kodu, który by je czytał. Koszt migracji nazw ustawień po stronie konfiguracji = **zero** niezależnie od
wybranego zestawu; w obu wariantach Zamawiający **musi dopisać** nowe ustawienia, bo domyślne wartości (zgodnie ze zleceniem
3.2 i DoD §3) odtwarzają zachowanie 5.0.7, nie zachowanie łatek. Patrz notatka migracyjna §6.3.

### 2.2 Co w łatkach jest kontraktem zewnętrznym

| # | Element | Łatka | Widoczny dla | Dowód | Kwalifikacja |
|---|---|---|---|---|---|
| K1 | **409 `{code:"version_required", message:"Deploy rejected: …"}`** dla `POST /flows` z `Node-RED-API-Version: v2` bez `rev` (`undefined`/`null`/`""`) | 0006, testy 0005 | klienci Admin API v2 (edytor; narzędzia Zamawiającego, jeśli używają v2) | `admin/flows.js` hunk `@@ -55,6 +61,14`; `flows_spec.js`: `res.body.should.have.property("code","version_required")` | **kontrakt API** – kod i status. Treść `message` – nie traktować jako kontraktu (zmieni się przy i18n/`rejectHandler`). Przyjęte D-20. |
| K2 | **Odpowiedź Admin API po starcie flow** (`POST /flows`, `reload`, `POST/PUT/DELETE /flow`) | 0004 | klienci Admin API (MCP, CI/CD, automaty) | `api/flows.js`: `return afterStart().then(() => ({rev:flowId}))` na 4 ścieżkach | **kontrakt zachowania bez nazwy** – klienci Zamawiającego mogą już polegać na tym, że po 200 trasy HTTP istnieją. Nazwa ustawienia go nie dotyczy; dotyczy go **wartość domyślna** (w forku `"stopped"` = powrót do 5.0.7, dopóki Zamawiający nie ustawi `"started"`). |
| K3 | `runtime.flows.waitForDeployStart()` | 0004 | **tylko kod wewnątrz `@node-red/runtime`** | `flows/index.js` `module.exports.waitForDeployStart`; wewnętrzny obiekt `runtime` (`runtime/lib/index.js:331-346`) ma `flows: flows` (moduł wewnętrzny), a eksport dla osadzających (`:377`) to `flows: externalAPI.flows` (api/flows.js) – funkcji tam **nie ma**. API węzłów (`registry/lib/util.js`) też jej nie wystawia. | **szczegół implementacji.** Kontraktem byłaby tylko wtedy, gdyby kod Zamawiającego sięgał do modułu po ścieżce pliku (Pytanie 2 w ZALACZNIK-A-ANALIZA) – do potwierdzenia. |
| K4 | Klucze i18n `deploy.confirm.staleFlows`, `deploy.confirm.staleFlowsLost`, `deploy.confirm.button.reload` (en-US, pl) | 0006 | tłumacze, motywy edytora nadpisujące teksty | `locales/*/editor.json` | **kontrakt słaby** (klucze locale są de facto publiczne dla tłumaczeń). Zachować nazwy kluczy – zerowy koszt, spójne z D-02 (`staleFlows`). |
| K5 | Zachowanie edytora: blokujące okno, brak „Scal/Nadpisz” | 0006 | użytkownicy edytora Zamawiającego | `deploy.js` (−`resolveConflict`) | kontrakt UX produktu – w forku dostępny za `editorTheme.deploy.staleFlows: "reload-only"`; domyślnie wraca zachowanie 5.0.7 (DoD §3). |
| K6 | Telemetria zawsze wyłączona | 0003 | administratorzy (on-premise) | `return false` | zachowanie produktu – w forku `telemetry: {enabled:false, locked:true}`. |
| K7 | Nagłówki „Modified by Actuna Sp. z o.o.” | 0002, 0003, 0006 | odbiorcy dystrybucji forka | komentarze blokowe | obowiązek licencyjny (D-19), nie nazwa – poza zakresem tej analizy. |

**Wniosek:** jedyne nazwane kontrakty, na których klienci Zamawiającego mogą już polegać, to **K1 (`version_required`, 409)** –
zachowany decyzją D-20 – oraz nazwy kluczy i18n (K4) – zgodne z D-02. Pozostałe nazwy ze zlecenia/README (`flows.*`,
`editor.staleFlowsPolicy`, `RED.auth.public()`, `node.registerRoute`, `health:{enabled,path}`) **nie istnieją w żadnym kodzie**
ani konfiguracji – są wyłącznie tekstem dokumentu zlecenia. Ich zmiana to zmiana w dokumentach, nie migracja.

### 2.3 Fakty z kodu 5.0.7 istotne dla oceny nazw (uzupełnienie §2.1a ZASADY)

- `settings.js` (szablon) nie ma kluczy `flows`, `deploy`, `editor`, `health`; ma `flowFile` (`:35`), `runtimeState` (`:311`),
  `diagnostics` (`:298`), `telemetry` (`:317`), `externalModules` (`:383`), `editorTheme` (`:419`, opisane jako „Customising the
  editor” z odsyłaczem do dokumentacji „configuration#editor-themes”), `functionTimeout` (`:541`), `disableEditor` (`:413`).
- W kodzie runtime/editor-api **brak** `settings.flows`, `settings.deploy`, `settings.editor`, `settings.health` – żaden z zestawów
  nie koliduje z istniejącym ustawieniem runtime.
- Klucz **`editor` jest zajęty w ustawieniach użytkownika**: `RED.settings.get('editor')` w `userSettings.js:265,353,368,403`,
  `view.js:1003,1551,1754`, `subflow.js:626` (obiekt `{view:{...}}` zapisywany przez `/settings/user`). Administrator czytający
  dokumentację forka i kod edytora widziałby dwa różne „`editor`” – to realne ryzyko pomyłki, nie tylko estetyka.
- `editorTheme` jest **już kanałem przekazywania ustawień funkcjonalnych do klienta** (`editor-api/lib/admin/settings.js:58-65`,
  `theme.js` – `projects`, `codeEditor`, `deployButton`, `header`, `tours`, `multiplayer`). Ustawienie P-02 musi dotrzeć do
  edytora – `editorTheme` daje to bez nowego mechanizmu; `editor.*` wymagałoby nowego kanału albo ręcznego dopisania do `/settings`.
- Słowo „deploy” jest słownictwem produktu widocznym dla klientów API: nagłówek `Node-RED-Deployment-Type` (`admin/flows.js:54`,
  `deploy.js:376`), przycisk „Deploy”, zdarzenie `runtime-deploy`. Obiekt `deploy.*` w ustawieniach jest dla autora narzędzi
  MCP/CI tym samym pojęciem, z którym pracuje w API. `flows.*` kojarzy się z zasobem `/flows` **i** z plikiem `flows.json`
  (`flowFile`), a Z-04 dodaje jeszcze `/flow/:id` – „flows.putCreates” nie mówi, że chodzi o `PUT /flow/:id`.
- Dokumentacja projektu (`design/**/*.md`) używa już nazw D-02 w ok. 32 (`deploy.response`), 26 (`deploy.requireRevision`),
  18 (`editorTheme.deploy.staleFlows`), 23 (`publicRoute`), 15 (`registerHttpRoute`), 20 (`shutdownTimeout`) miejscach;
  nazw ze zlecenia – po 1–4 (wyłącznie w tabelach „propozycja zlecenia” i w analizie załącznika). Powrót do nazw zlecenia
  to ok. 130 edycji w dokumentach i kartach; pozostanie przy D-02 – zero.

## 3. Ocena per wiersz

Skala: koszt migracji dla Zamawiającego (0 = brak; konfiguracja / kod / dokumenty), czytelność dla administratora piszącego
`settings.js` (A–C), spójność dokumentacji (A–C), ryzyko pomyłki (niskie/średnie/wysokie), szansa upstream (ocena względna: wyższa /
równa / niższa – **ocena analityka, nie stanowisko projektu Node-RED**), wpływ na narzędzia zewnętrzne (MCP/CI/CD/automaty).

| Wiersz | Zlecenie / zał. A | D-02 | Koszt migracji | Czytelność admin | Spójność dok. | Ryzyko pomyłki | Upstream | Narzędzia zewn. | Ocena |
|---|---|---|---|---|---|---|---|---|---|
| **P-01** | `flows.deployResponse` | `deploy.response` | **0** (brak ustawienia w łatce; K2 to zachowanie, nie nazwa) | D-02: **A** – „deploy.response: 'started'” czyta się jako „odpowiadaj po starcie”; zlecenie: **B** – „flows.deployResponse” miesza zasób z czynnością | D-02 **A** (jedno `deploy` dla P-01/Z-04/Z-05/Z-06/Z-09); zlecenie **B** (`flows.*` tylko dla 3 kluczy, `flowFile` obok) | zlecenie: **średnie** – `flows` ↔ `flowFile`/`flows.json`; D-02: **niskie** (`deploy` ↔ `editorTheme.deployButton` – inny obiekt, inna warstwa) | D-02 wyższa (precedens obiektów grupujących `runtimeState`, `externalModules`) | neutralny – narzędzia widzą zachowanie, nie klucz; ważna jest **wartość domyślna** (§6.3) | **D-02** |
| **P-02** | `editor.staleFlowsPolicy` | `editorTheme.deploy.staleFlows` | **0** (łatka bez ustawienia; klucze i18n `staleFlows*` zostają) | zlecenie **B+** – krótkie, intuicyjne; D-02 **B** – dłuższe, `editorTheme` sugeruje wygląd (choć szablon mówi „Customising the editor”) | D-02 **A** – tam, gdzie `projects.enabled`, `multiplayer`, `codeEditor`; zlecenie **C** – nowa przestrzeń dla jednego klucza | zlecenie: **wysokie** – `editor` = ustawienia użytkownika (`RED.settings.get('editor')`, 8 miejsc); D-02: **niskie** – wymaga akapitu „`deploy` ≠ `deployButton`” | D-02 wyższa – upstream nie przyjmie nowej przestrzeni `editor` obok istniejącego znaczenia | brak (ustawienie edytora) | **D-02**, z zapisem w dokumentacji odróżniającym od `deployButton` i od ustawień użytkownika |
| **Z-04** | `flows.putCreates` | `deploy.putCreatesFlow` | **0** (brak implementacji) | D-02 **A** – mówi, co powstaje (flow) i przy jakim wywołaniu (PUT); zlecenie **C** – „putCreates” co? | D-02 **A** | zlecenie **średnie** (`flows.` a dotyczy `/flow/:id`) | równa (oba nietypowe; upstream raczej dyskutowałby samo zachowanie) | **istotny** – to narzędzia MCP/CI robią `PUT /flow/:id`; nazwa w dokumentacji API musi odpowiadać na pytanie „czy PUT na nieistniejący id tworzy flow” – `putCreatesFlow` odpowiada | **D-02** |
| **Z-05** | `flows.requireRevision` | `deploy.requireRevision` | **0** dla nazwy; **K1 zachowany** (`version_required`) | obie **A** | D-02 **A** (obok `putCreatesFlow`, `response`) | niskie w obu | równa | **istotny** – włączenie zmienia kontrakt dla klientów v2 bez `rev`; nazwa obojętna, dokumentacja kodu 409 kluczowa | **D-02**; w dokumentacji Z-05 jawnie: „odpowiada łatce 0006; kod `version_required`” |
| **Z-02** | `RED.auth.public()` | `RED.auth.publicRoute()` | **0** (brak w kodzie; `RED.auth` ma dziś tylko `needsPermission`) | dla autora węzła: `public()` krótsze, ale czyta się jak właściwość/stan; `publicRoute()` jak middleware (para z `needsPermission()`) | D-02 **A** | zlecenie **średnie** – `public` to słowo zarezerwowane w wielu językach/lintach, mylące w `RED.auth.public` (publiczny obiekt auth?) | D-02 wyższa (nazwa opisowa jak `needsPermission`) | dotyczy autorów węzłów, nie MCP/CI | **D-02** |
| **Z-07** | `node.registerRoute` | `node.registerHttpRoute` | **0** | D-02 **A**; zlecenie **B** (trasa czego? admin? http in?) | D-02 **A** – odróżnia od tras `httpAdmin`/`RED.httpAdmin` | zlecenie **średnie** | D-02 wyższa | dotyczy autorów węzłów | **D-02** |
| **Z-08** | `health: {enabled, path}` | + `port`, `host`; `shutdownTimeout` płasko | **0**; rozszerzenie zgodne wstecz (zlecenie ⊂ D-02) | **A** – operator K8s rozumie `port`/`host` sondy od razu; `shutdownTimeout` obok `nodeCloseTimeout`/`functionTimeout` | **A** | niskie; uwaga: `health.port` bez `host` nasłuchuje na wszystkich interfejsach – opisać | wyższa (sondy na osobnym porcie to norma w Helm chartach) | **istotny dla K8s** – `readinessProbe` na porcie innym niż Ingress; `terminationGracePeriodSeconds` ↔ `shutdownTimeout` do opisania w dokumentacji wdrożeniowej | **D-02** |
| **Z-09/Z-06/Z-15/Z-03/Z-14** | – (brak w zleceniu) | `deploy.reload.*`, `deploy.hookTimeout`, `editorOnly`, `externalModules.palette.allowDowngrade`, `editorTheme.flowLayout.enabled` | **0** (nazwy tylko nasze) | **A/B** – uwaga na `deploy.reload` (Z-09: przeładowanie po zmianie w magazynie) vs typ wdrożenia `reload` w API (`Node-RED-Deployment-Type: reload` – przeładowanie z magazynu na żądanie): to samo pojęcie, inny wyzwalacz – **zbieg nazw korzystny**, ale wymaga jednego zdania w dokumentacji | **A** | `deploy.reload` – **średnie** bez tego zdania; reszta niskie | równa | `deploy.reload.*`, `editorOnly` – istotne dla operatora wielu instancji; `allowDowngrade` – dla CI (upload `.tgz`) | **D-02**; dopisać relację `deploy.reload` ↔ typ `reload` |
| **kod błędu** | `version_required` (0006) | `version_required` (D-20) | **0** – zachowany | – | **B** – „version” obok `rev`/`invalid_revision` (ZALACZNIK-A-ANALIZA, pkt „Kod błędu”) | średnie – „version” ↔ wersja API; łagodzone zdaniem w §2.4 | równa | **kluczowy** – jedyny nazwany kontrakt, który klienci Zamawiającego (edytor po 0006, ewentualne testy/narzędzia) już znają | **zachować** (D-20); doprecyzować `rev: ""` (Pytanie 1) |
| (K3) | `waitForDeployStart()` | opcja na wywołanie `waitForStart` (karta P-01) | **0, jeśli** nikt poza `@node-red/runtime` jej nie woła (do potwierdzenia); inaczej – zmiana w kodzie Zamawiającego | – | – | – | brak znaczenia (moduł wewnętrzny) | brak | nie jest kontraktem; nie utrzymywać nazwy „na zapas” |

## 4. Kryteria decyzji (proponowany zestaw, do użycia także przy przyszłych sporach o nazwy)

1. **Kontrakt już używany przez klientów ma pierwszeństwo.** Nazwa (kod błędu, pole odpowiedzi, klucz ustawień, funkcja API) jest
   kontraktem, gdy istnieje kod – u Zamawiającego lub w upstream – który ją czyta. Taką nazwę zachowujemy, chyba że jest
   błędna merytorycznie; wtedy alias + ostrzeżenie. (Dziś spełnia to tylko `version_required` – zachowane.)
2. **Nazwa, która nie istnieje w żadnym kodzie, nie ma kosztu migracji.** Tekst zlecenia i README załącznika to specyfikacja, nie
   konfiguracja; zmiana nazwy wymaga tabeli mapowania w protokole odbioru, nic więcej. (Dotyczy wszystkich pozostałych wierszy.)
3. **Konwencja projektu Node-RED przed konwencją zlecenia** – dla ustawień: istniejące obiekty (`editorTheme`, `externalModules`,
   `telemetry`) albo nowy obiekt grupujący nazwany pojęciem z API produktu (`deploy`); płaskie klucze dla cyklu życia procesu
   (`shutdownTimeout`, `editorOnly`, `readOnlyUserDir`). Uzasadnienie biznesowe: dokumentacja forka ma być czytelna dla
   administratora znającego oficjalną dokumentację, a gałęzie mają mieć szansę w upstream (choć zgłoszenia są dziś zablokowane – D-04).
4. **Brak kolizji znaczeń w jednym pliku lub jednym API.** Odrzucamy nazwy, które w `settings.js`/edytorze/API węzłów mają już inne
   znaczenie (`editor` = ustawienia użytkownika; `flows` ≈ `flowFile`/zasób `/flows` przy ustawieniach dotyczących `/flow/:id`).
5. **Nazwa ma odpowiadać na pytanie operatora narzędzi zewnętrznych** („czy PUT tworzy flow?”, „kiedy dostaję 200?”, „na którym
   porcie sonda?”) – kryterium rozstrzygające między równoważnymi konwencjami (`putCreatesFlow`, `response`, `health.port`).
6. **Jedna decyzja, jedna tabela.** Po zatwierdzeniu nazwy są zamrożone w ZASADY §2.1 (kolumna „nazwa w zleceniu/zał. A” zostaje
   jako mapowanie); kolejne zmiany tylko przez nową decyzję D-nn, nie przez dokumenty pochodne.

## 5. Rekomendacja

**Utrzymać D-02 w całości** (wszystkie nazwy ustawień i API z ZASADY §2.1/§2.1a) oraz **D-20** (`version_required`).
Załącznik A nie dostarcza argumentu za powrotem do nazw zlecenia: README powtarza je jako propozycję, łatki ich nie implementują,
a jedyny nazwany kontrakt (`version_required`) jest już zachowany. Z perspektywy Zamawiającego koszt obu wariantów nazw ustawień
jest identyczny (musi dopisać nowe klucze, bo domyślne odtwarzają 5.0.7), natomiast wariant D-02 ma niższe ryzyko pomyłki
(`editor`, `flows`) i tańszą dokumentację (nazwy już użyte w ok. 130 miejscach kart i analiz).

Różnice/uzupełnienia względem D-02 (nie zmieniają nazw, zmieniają zapis):

| # | Uzupełnienie | Gdzie |
|---|---|---|
| U1 | W §2.1 zachować kolumnę „Propozycja zlecenia / zał. A” jako **oficjalną tabelę mapowania** i wskazać ją w protokole odbioru („ustawienie `flows.deployResponse` ze zlecenia = `deploy.response`”). | ZASADY §2.1 (jeden akapit nad tabelą) |
| U2 | Dokumentacja P-02: akapit odróżniający `editorTheme.deploy` (zachowanie) od `editorTheme.deployButton` (wygląd) i od ustawień użytkownika `editor` (zapisywanych przez `/settings/user`). | karta P-02, szablon `settings.js` |
| U3 | Dokumentacja Z-09: jedno zdanie „`deploy.reload.*` steruje przeładowaniem po zmianie w magazynie – tym samym, które Admin API wykonuje na żądanie typem wdrożenia `reload`”. | karta Z-09, `settings.js` |
| U4 | Z-05/§2.4: zdanie „`version` w kodach błędów oznacza rewizję flow (`rev`), nie wersję API” (już rekomendowane w ZALACZNIK-A-ANALIZA) i rozstrzygnięcie `rev: ""` (Pytanie 1). | ZASADY §2.4 |
| U5 | `waitForDeployStart()` **nie** jest kontraktem – nie rezerwować nazwy; jeśli Zamawiający potwierdzi użycie poza runtime (Pytanie 2), wprowadzić ją jako cienki alias do mechanizmu z karty P-01, z JSDoc `@deprecated`. | karta P-01 |
| U6 | Z-08: w dokumentacji wdrożeniowej (K8S backlog) tabela „ustawienie ↔ pole manifestu” (`health.port` ↔ `readinessProbe.httpGet.port`, `shutdownTimeout` ↔ `terminationGracePeriodSeconds` – limit krótszy niż grace period). | karta Z-08, `k8s-postgres/BACKLOG.md` |
| U7 | **Bez aliasów starych nazw w kodzie i bez ostrzeżeń w logu** o kluczach `flows.*`/`editor.*` – te klucze nigdy nie działały, więc ostrzeżenie chroniłoby tylko przed przepisaniem nazwy z tekstu zlecenia; to zadanie dla walidacji konfiguracji po stronie Zamawiającego (schemat `values.yaml`/`settings.js` w CI), nie dla silnika (szum i rozbieżność z upstream). Wyjątek – kryterium 1: gdyby okazało się, że jakieś środowisko ma już `flows.*` w `settings.js` (do potwierdzenia, §6.2 pkt 1). | – |

## 6. Ryzyka i migracja

### 6.1 Ryzyka decyzji w obu kierunkach

| Kierunek | Ryzyko | Prawdopodobieństwo / skutek | Ograniczenie |
|---|---|---|---|
| **Utrzymać D-02** | Rozbieżność między tekstem zlecenia/README a dostarczonymi nazwami → spór przy odbiorze („zlecenie mówi `flows.deployResponse`”) | średnie / niski (formalny) | U1 – tabela mapowania w ZASADY i w raporcie odbioru; zapis w zleceniu, że nazwy końcowe wynikają z D-02 |
| Utrzymać D-02 | Administrator szuka ustawienia polityki edytora poza `editorTheme` („to przecież nie motyw”) | średnie / niski | U2; wpis w szablonie `settings.js` w sekcji `editorTheme` obok `projects` |
| Utrzymać D-02 | `deploy.reload` mylone z typem wdrożenia `reload` | niskie / niski | U3 |
| Utrzymać D-02 | Narzędzia Zamawiającego (MCP/CI) zbudowane na zachowaniu łatki 0004 (odpowiedź po starcie) dostają po migracji na fork zachowanie 5.0.7, jeśli ktoś zapomni ustawić `deploy.response: "started"` → sporadyczne 404 po wdrożeniu | **wysokie bez notatki migracyjnej** / średni (błędy przejściowe w automatach) | §6.3 – notatka migracyjna jako warunek odbioru P-01; test kontraktowy w pipeline Zamawiającego |
| **Wrócić do nazw zlecenia** | `editor.staleFlowsPolicy` koliduje znaczeniowo z ustawieniami użytkownika `editor`; dokumentacja i kod edytora używają tego słowa w dwu znaczeniach | wysokie / średni (błędne zgłoszenia, pytania wsparcia) | brak dobrego – to powód odrzucenia |
| Wrócić do nazw zlecenia | `flows.*` czytane jako ustawienia pliku flow; `putCreates` niezrozumiałe w dokumentacji API dla autorów MCP | średnie / niski–średni | opis w dokumentacji – ale nazwa nadal nie mówi, czego dotyczy |
| Wrócić do nazw zlecenia | Ok. 130 edycji w kartach/analizach, ryzyko niespójności (część dokumentów z jednym zestawem) | pewne / niski | mechaniczna zamiana + przegląd |
| Wrócić do nazw zlecenia | Mniejsza szansa akceptacji upstream (nowa przestrzeń `editor`, `flows`) | ocena: średnie / niski dziś (D-04 blokuje zgłoszenia), średni długofalowo (koszt utrzymania forka) | – |
| **Oba** | `version_required` vs rodzina `*_revision` – niespójność kodów | niskie / niski | U4 |

### 6.2 Do potwierdzenia przez Zamawiającego (warunkują kryterium 1)

1. Czy w jakimkolwiek środowisku (`settings.js`, Helm, obraz) występują już klucze `flows.deployResponse`, `editor.staleFlowsPolicy`,
   `flows.requireRevision`, `telemetry.locked`? (Z łatek wynika, że nie mogą działać – ale mogły zostać wpisane „na przyszłość”.)
   Jeśli tak: aliasy z ostrzeżeniem w logu przez jedno wydanie forka; jeśli nie: U7.
2. Czy jakikolwiek kod poza `@node-red/runtime` (wtyczki, testy, skrypty) woła `waitForDeployStart()`? (= Pytanie 2 ZALACZNIK-A-ANALIZA.)
3. Czy narzędzia MCP/CI/CD używają Admin API w wersji v2 (`Node-RED-API-Version: v2`) i czy sprawdzają `code === "version_required"`
   lub status 409 dla `rev: ""`? (= Pytanie 1.)
4. Czy automaty polegają na zachowaniu 0004 (żądanie do trasy HTTP natychmiast po 200 z wdrożenia)? Jeśli tak – `deploy.response: "started"`
   jest obowiązkowe w każdym środowisku (§6.3).

### 6.3 Plan komunikacji i migracji (załącznik A → fork)

1. **Tabela mapowania nazw** (U1) w ZASADY §2.1 i w dokumentacji forka (`CHANGELOG`/przewodnik administratora): kolumny
   „nazwa w zleceniu / zał. A”, „nazwa w forku”, „domyślnie”, „wartość odtwarzająca zachowanie łatki”.
2. **Notatka migracyjna „łatki → ustawienia”** (jedna strona, warunek odbioru pakietów P-01…P-03, Z-05):

   | Łatka (zachowanie dziś) | Ustawienie w forku odtwarzające zachowanie | Domyślnie (bez wpisu) |
   |---|---|---|
   | 0004 – odpowiedź po starcie | `deploy: { response: "started" }` | `"stopped"` = 5.0.7 |
   | 0006 (serwer) – 409 bez `rev` | `deploy: { requireRevision: true }` | `false` = 5.0.7 |
   | 0006 (edytor) – blokujące okno, bez Scal/Nadpisz | `editorTheme: { deploy: { staleFlows: "reload-only" } }` | `"prompt"` = 5.0.7 |
   | 0003 – telemetria wyłączona | `telemetry: { enabled: false, locked: true }` | brak blokady |
   | 0002 – strażnik `tokens.get()` | brak ustawienia (poprawka błędu) | zawsze aktywne |

   Zalecenie: jeden wspólny fragment `settings.js` (lub `values.yaml`) dla wszystkich środowisk Zamawiającego, dołączony do
   raportu odbioru i sprawdzany testem kontraktowym w CI Zamawiającego (deploy → natychmiastowe `GET` na trasę `http in` → 200;
   v2 bez `rev` → 409 `version_required`).
3. **Ostrzeżenia w logu** – tylko warunkowo (§6.2 pkt 1); domyślnie nie (U7).
4. **Komunikacja do użytkowników edytora**: zmiana jest dla nich neutralna, jeśli środowiska dostaną `"reload-only"`; bez tego
   wrócą „Scal/Nadpisz” – zaznaczyć w notatce jako skutek braku wpisu, nie regresję.
5. **Dokumentacja Admin API dla autorów MCP/CI** (jedna strona w forku): kody błędów (§2.4) z sekcją „`version` = rewizja flow”;
   kiedy przychodzi 200 w zależności od `deploy.response`; `PUT /flow/:id` a `deploy.putCreatesFlow`; `rev` w v2.
6. **Zamrożenie nazw**: po akceptacji tej rewizji – zapis w ANALIZA §7.0 (D-02 rewizja: „utrzymane”) i zamknięcie wiersza
   „NAZWY-ANALIZA.md (w przygotowaniu)”.
