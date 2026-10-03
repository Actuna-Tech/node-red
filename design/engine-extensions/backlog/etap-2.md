# Backlog – etap 2 (Z-03–Z-07)

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.
> Zasady, szablon karty i wspólne DoD: [../ZASADY.md](../ZASADY.md). Fakty z kodu: [../WERYFIKACJA.md](../WERYFIKACJA.md).
> Ścieżki kodu względem `packages/node_modules/`, ścieżki testów względem katalogu repozytorium.

## Podsumowanie

| ID | Tytuł | Typ | Priorytet | Ryzyko | Zależności | Szacunek |
|---|---|---|---|---|---|---|
| Z-03 | Aktualizacja paczki wgrywanej jako `.tgz` (zakres skorygowany) | funkcja + poprawka błędu | P3 | niskie | – | M |
| Z-04 | Pełne API pojedynczego flow (rewizja, tworzenie pod id, globalne configi) | funkcja | P1 | wysokie | E-01, FL-B-001 (zachować) | L |
| Z-05 | Wymóg rewizji przy każdym wdrożeniu | funkcja | P1 | średnie | E-01, Z-04 (rewizja flow); integracja edytora w `deploy.js` po scaleniu P-02 (etap 1) | M |
| Z-06 | Hooki wdrożenia `preDeploy` / `postDeploy` w `RED.hooks` | funkcja | P1 | średnie | E-01, P-01 (moment `postDeploy`), Z-04, Z-05 (kolejność); punkt integracji wykorzystywany przez Z-09 | L |
| Z-07 | Automatyczne zdejmowanie tras HTTP węzła przy zamknięciu | funkcja + poprawka błędu | P2 | średnie | – | M |

Kolejność realizacji (ANALIZA §6.2): E-01 (etap 0) → tor A: **Z-04 → Z-05 → Z-06** (wspólne funkcje potoku wdrożenia; Z-05 zależy od Z-04 – rewizja flow, `globalRev`, `rev:null`; część runtime Z-14 razem z Z-04); tor B (równolegle): **Z-03 → Z-07** (rozłączne plikowo z torem A).

Oznaczenie `[odbiór]` w scenariuszach BDD = kryterium odbioru ze zlecenia (konwencja jak w etapie 1); scenariusze bez oznaczenia – uzupełnienia (ANALIZA §9).

---

### Z-03 – Aktualizacja paczki wgrywanej jako `.tgz`

> **Zakres skorygowany – zatwierdzony (R-17, 2026-10-03).** Opis zlecenia („menedżer palety nie
> rozpoznaje nowszej wersji”) nie zgadza się z kodem: aktualizacja **jest** wykrywana. Karta opisuje
> to, czego faktycznie brakuje.

| Pole | Wartość |
|---|---|
| Etap / typ | 2 / funkcja + poprawka błędu (porównanie wersji, pozostawiony plik `.tgz`) |
| Priorytet / ryzyko | P3 / niskie |
| Ustawienie | brak nowego przełącznika funkcji; ujednolicenie istniejących: kanoniczne `externalModules.palette.allowUpload` (dziś także `externalModules.palette.upload`, `editorTheme.palette.upload` – przestarzałe aliasy, nadal honorowane, użycie → ostrzeżenie w logu; R-17); nowe `externalModules.palette.allowDowngrade: true` (ZASADY §2.1 – domyślnie zachowanie 5.0.6; `false` blokuje instalację starszej wersji z `.tgz`; rozstrzygnięte przed rejestrem i potwierdzone w R-17) |
| Zależności | – |
| Pliki | `registry/lib/installer.js:138-139,191-245,359-369,425-474`; `runtime/lib/api/nodes.js:174-200`; `editor-api/lib/admin/nodes.js:45-64`; `editor-client/src/js/ui/palette-editor.js:1427-1478`; `editor-client/src/js/red.js:664-666`; `editor-client/locales/en-US/editor.json` |
| Powiązania | – |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **NIEPOTWIERDZONE w zakresie głównym, CZĘŚCIOWO w szczegółach.**
- Ścieżka: `palette-editor.js:1427-1478` (`$.ajax` bez `.done`) → `editor-api/lib/admin/index.js:62-64` (multer w pamięci) → `admin/nodes.js:54-64` → `runtime/lib/api/nodes.js:174-200` → `installer.js:138-139` (`Buffer` → `installTarball`) → `installModule` (`:191-213`).
- `installModule`: moduł zainstalowany przez użytkownika i wersja różna → `isUpgrade = true` (porównanie `info.version === version`, **bez semver** – starsza wersja jest traktowana jak aktualizacja); ta sama wersja → `module_already_loaded` (`:196-199`). Po aktualizacji: `restart-required` + `setModulePendingUpdated` (`:261-262`), w edytorze komunikat `palette.event.nodeUpgraded` (`red.js:664-666`).
- `installTarball` (`:425-474`) zapisuje plik do `<userDir>/nodes/<nazwa>-<wersja>.tgz` (`:443`) **przed** jakimkolwiek sprawdzeniem wersji → przy `module_already_loaded` plik zostaje (ta sama nazwa = nadpisanie istniejącego pliku zawartością z uploadu). Fakt z kodu; skutek nieuruchamiany.
- Zmienna `isUpdate` (`:448,:456`) jest ustawiana i nieużywana.
- Hooki `preInstall`/`postInstall` (`:222-245`) dostają `{module, version, url, dir, isExisting, isUpgrade, args}` – brak poprzedniej wersji i oznaczenia źródła (upload).
- Moduł z oczekującą aktualizacją (`pending_version`, przed restartem) – porównanie robi się z `info.version`, czyli z wersją sprzed aktualizacji (`registry.js:657-662`).
- Brak potwierdzenia w edytorze przed instalacją z pliku; wynik API po sukcesie ignorowany przez edytor (brak `.done`).
- Trzy niespójne ustawienia: `externalModules.palette.allowUpload` (`installer.js:426`, jedyne w szablonie `settings.js:389`), `externalModules.palette.upload` (`api/nodes.js:175`), `editorTheme.palette.upload` (`admin/nodes.js:54`).
- Projekt **ma** zależność `semver` 7.8.5 (`registry/package.json:23`, używana w `registry/lib/util.js:18`, `loader.js:19`) – bez nowej zależności.
- Testy: brak testu ścieżki tarball w `test/unit/@node-red/registry/lib/installer_spec.js`, brak testu uploadu w `editor-api/lib/admin/nodes_spec.js` i `runtime/lib/api/nodes_spec.js`.

#### Specyfikacja
- **Cel:** wgranie `.tgz` modułu już zainstalowanego jest jednoznacznie klasyfikowane (nowsza / ta sama / starsza wersja), raportowane w wyniku API i w edytorze, a hooki znają poprzednią wersję.
- **Wejścia:** `POST /nodes` (multipart, pole `tarball`); `package.json` z archiwum (`getTarballModuleInfo`); stan rejestru (`version`, `pending_version`, `user`).
- **Wyjścia:**
  - wynik API (200) jak dziś (informacja o module) + nowe pola addytywne: `operation: "install" | "upgrade" | "downgrade"`, `previousVersion` (gdy istniał);
  - hooki `preInstall`/`postInstall`: nowe pola `previousVersion` (string \| `undefined`), `source: "upload" | "registry" | "url" | "path"`; istniejące pola bez zmian;
  - edytor: przed wysłaniem pliku – brak zmian w zakresie minimalnym (nazwa/wersja z pliku nieznana bez rozpakowania po stronie klienta; potwierdzenie przed instalacją – **bez `dryRun`**, R-17); po odpowiedzi – komunikat sukcesu zależny od `operation`; przy błędzie – czytelny komunikat z kodem.
- **Niezmienniki:** nowa instalacja (moduł nieznany) działa jak dziś; listy `allowList/denyList/allowUpdateList/denyUpdateList` i `allowUpdate` obowiązują jak dziś (aktualizacja z pliku podlega `allowUpdate`); porównanie wersji wg semver; przy odrzuceniu na dysku **nie zostaje** nowy plik `.tgz` i istniejący plik nie jest nadpisywany.
- **Przypadki błędów:**
  - ta sama wersja (także równa `pending_version`) → 400 `module_already_loaded`, komunikat „Moduł <nazwa> w wersji <wersja> jest już zainstalowany”;
  - starsza wersja → przy `allowDowngrade: true` (**domyślnie**, ZASADY §2.1, R-17) – instalacja jako `operation:"downgrade"` z ostrzeżeniem w logu i w edytorze; przy `allowDowngrade: false` → 400 `module_downgrade_not_allowed` (ZASADY §2.4), bez zapisu pliku;
  - wersja niebędąca poprawnym semver → porównanie tekstowe jak dziś (`!==`) i `operation:"upgrade"` (zachowanie dotychczasowe), ostrzeżenie w logu;
  - upload wyłączony którymkolwiek z trzech ustawień → 400 `upload_not_allowed` – **nowy kod** (ZASADY §2.4); dziś zależnie od ustawienia: `invalid_request` (`runtime/lib/api/nodes.js:175-180`), `Error("Module upload disabled")` bez kodu (`installer.js:426-428`) albo plik pomijany po cichu (`editor-api/lib/admin/nodes.js:54`); status HTTP 400 bez zmian, zmiana pola `code` opisana w kontrakcie i CHANGELOG.
- **Skutki uboczne:** zapis pliku `.tgz` przenosi się **za** klasyfikację wersji; dziennik audytu `nodes.install` dostaje `operation`.

#### Projekt rozwiązania (minimalny)
1. `installer.js`: nowa funkcja `classifyUpload(moduleInfo)` → `{operation, previousVersion}` z użyciem `semver.valid/semver.gt/semver.eq`; porównanie z `pending_version || version` z `registry.getModuleInfo`.
2. `installTarball`: kolejność `getTarballModuleInfo` → `classifyUpload` → (odrzucenie bez zapisu) → `fs.outputFile` → `installModule(..., {source:"upload", previousVersion})`; usunięcie martwej zmiennej `isUpdate`.
3. `installModule(module, version, url, opts)` – czwarty, opcjonalny parametr (stare wywołania bez zmian); `previousVersion = info && info.version`; `source` wyliczane, gdy nie podano; dodanie pól do `triggerPayload`; dla wersji niższej przy `opts.source === "upload"` – log „downgrading” (nowy klucz w `runtime/locales/en-US/runtime.json`). Wynik: dołączenie `operation`, `previousVersion` do obiektu zwracanego z `reportAddedModules` / `setModulePendingUpdated` (kopie, bez zmiany rejestru).
4. Ujednolicenie ustawień: funkcja `isUploadAllowed(settings)` w jednym miejscu (np. `registry/lib/installer.js`, eksport), honorująca wszystkie trzy nazwy (każde `false` wyłącza); odrzucenie – błąd `code:"upload_not_allowed"`, `status:400` (nowy kod, ZASADY §2.4), także w `admin/nodes.js:54` (zamiast cichego pominięcia pliku); w szablonie `settings.js` udokumentowane tylko `externalModules.palette.allowUpload`, pozostałe dwie jako przestarzałe aliasy w JSDoc i CHANGELOG; użycie aliasu → jednorazowe ostrzeżenie w logu przy starcie (R-17; nowy klucz w `runtime/locales/en-US/runtime.json`).
5. Edytor `palette-editor.js`: `.done(function(info){…})` – `RED.notify` z tekstem zależnym od `info.operation` (nowe klucze `palette.editor.uploaded.install|upgrade|downgrade` w `locales/en-US/editor.json`); w `.fail` – komunikat wg `responseJSON.code`.
6. JSDoc hooków `preInstall/postInstall` (`util/lib/hooks.js` – opis pól payloadu) i CHANGELOG.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Wgrywanie paczki .tgz modułu już zainstalowanego

  Tło:
    Zakładając, że moduł "node-red-contrib-x" w wersji "1.2.0" jest zainstalowany przez użytkownika
    I upload paczek jest dozwolony

  Scenariusz: [odbiór] Nowsza wersja jest instalowana jako aktualizacja
    Gdy wgrywam plik .tgz z package.json w wersji "1.3.0" przez POST /nodes
    Wtedy odpowiedź ma status 200 i zawiera operation "upgrade" oraz previousVersion "1.2.0"
    I hook preInstall otrzymuje previousVersion "1.2.0", isUpgrade true i source "upload"
    I hook postInstall otrzymuje te same pola
    I edytor pokazuje komunikat o aktualizacji do wersji "1.3.0" z informacją o wymaganym restarcie

  Scenariusz: [odbiór] Ta sama wersja jest odrzucana z czytelnym komunikatem
    Gdy wgrywam plik .tgz w wersji "1.2.0"
    Wtedy odpowiedź ma status 400 i kod "module_already_loaded"
    I komunikat zawiera nazwę modułu i wersję "1.2.0"
    I w katalogu nodes nie powstaje ani nie zmienia się żaden plik .tgz
    I hook preInstall nie jest wywoływany

  Scenariusz: [odbiór] Starsza wersja jest rozpoznawana (domyślnie instalowana jako obniżenie)
    Zakładając brak ustawienia externalModules.palette.allowDowngrade (domyślnie true, R-17)
    Gdy wgrywam plik .tgz w wersji "1.1.0"
    Wtedy wynik zawiera operation "downgrade" i previousVersion "1.2.0"
    I w logu jest ostrzeżenie o obniżeniu wersji
    I edytor pokazuje ostrzeżenie o obniżeniu wersji

  Scenariusz: Obniżenie wersji zablokowane ustawieniem
    Zakładając, że externalModules.palette.allowDowngrade jest false
    Gdy wgrywam plik .tgz w wersji "1.1.0"
    Wtedy odpowiedź ma status 400 i kod "module_downgrade_not_allowed"
    I komunikat zawiera wersję zainstalowaną "1.2.0" i wgrywaną "1.1.0"
    I żaden plik .tgz nie zostaje zapisany

  Scenariusz: Wersja równa oczekującej aktualizacji
    Zakładając, że moduł ma oczekującą aktualizację do "1.3.0" (przed restartem)
    Gdy wgrywam plik .tgz w wersji "1.3.0"
    Wtedy odpowiedź ma status 400 i kod "module_already_loaded"

  Scenariusz: Nowa instalacja bez zmian
    Gdy wgrywam plik .tgz modułu, który nie jest zainstalowany
    Wtedy wynik zawiera operation "install" i nie zawiera previousVersion
    I zachowanie poza nowymi polami jest takie jak w wersji bazowej

  Scenariusz: Aktualizacja z pliku podlega allowUpdate
    Zakładając, że externalModules.palette.allowUpdate jest false
    Gdy wgrywam plik .tgz w wersji "1.3.0"
    Wtedy odpowiedź ma status 400 i kod "update_not_allowed"
    I żaden plik .tgz nie zostaje zapisany

  Szablon scenariusza: Każda z nazw ustawienia wyłącza upload
    Zakładając, że ustawienie <ustawienie> ma wartość false
    Gdy wgrywam dowolny plik .tgz
    Wtedy odpowiedź ma status 400 i kod "upload_not_allowed"
    Przykłady:
      | ustawienie                              |
      | externalModules.palette.allowUpload     |
      | externalModules.palette.upload          |
      | editorTheme.palette.upload              |

  Szablon scenariusza: Użycie przestarzałego aliasu ustawienia uploadu (R-17)
    Zakładając, że w ustawieniach użyto <alias>
    Kiedy runtime się uruchomi
    Wtedy w logu pojawi się ostrzeżenie wskazujące nazwę kanoniczną externalModules.palette.allowUpload
    I wartość aliasu jest honorowana
    Przykłady:
      | alias                                   |
      | externalModules.palette.upload          |
      | editorTheme.palette.upload              |

  # Potwierdzenie w edytorze przed instalacją (tryb dryRun) – odrzucone (R-17); edytor pokazuje komunikat po instalacji
```

#### Testy
- `test/unit/@node-red/registry/lib/installer_spec.js`, nowy `describe("installs module from tarball")` (stuby `getTarballModuleInfo`/`fs.outputFile`/`exec.run`, wzorzec hooków `:287-353`):
  `installs newer version as upgrade and passes previousVersion to hooks`, `rejects same version without writing tarball`, `rejects version equal to pending_version`, `installs older version as downgrade by default (allowDowngrade true)`, `rejects downgrade when allowDowngrade is false`, `falls back to string comparison for non-semver versions`, `keeps existing tarball when same version uploaded`, `removes previous tarball after successful upgrade`, `upgrade from tarball respects allowUpdate`.
- `test/unit/@node-red/runtime/lib/api/nodes_spec.js`: `addModule with tarball returns operation and previousVersion`, `addModule with tarball rejected with upload_not_allowed when upload disabled (each setting name)`, `logs deprecation warning when alias upload setting is used` (R-17).
- `test/unit/@node-red/editor-api/lib/admin/nodes_spec.js` (kontrakt API, supertest + multipart): `POST /nodes with tarball returns upgrade result`, `POST /nodes with tarball of same version returns 400 module_already_loaded`, `POST /nodes with tarball returns 400 upload_not_allowed when editorTheme.palette.upload is false` (test `dryRun` usunięty – R-17).
- Edytor: test ręczny/E2E (brak infrastruktury testów jednostkowych `palette-editor.js`) – zrzut komunikatów dla trzech przypadków.

#### DoD specyficzne
- [ ] Zakres skorygowany zgodny z R-17 (`allowDowngrade` domyślnie `true`; bez `dryRun`).
- [ ] Brak nowej zależności (użyty istniejący `semver`).
- [ ] Odrzucenie nie zostawia plików w `<userDir>/nodes` (test).
- [ ] Hooki: nowe pola opisane w JSDoc; stare pola bez zmian (test równości kluczy + nowe).
- [ ] Aliasy ustawień uploadu opisane w CHANGELOG jako przestarzałe; ostrzeżenie w logu przy ich użyciu (R-17, test).
- [ ] Nowy kod `upload_not_allowed` (400) opisany w kontrakcie Admin API i CHANGELOG (zmiana pola `code` względem `invalid_request`).

#### Ryzyka i alternatywy
- **Wartość domyślna `allowDowngrade` – rozstrzygnięte: `true`** (zachowanie 5.0.6; ZASADY §2.1, R-17). Starsza wersja jest instalowana jak dziś, ale klasyfikowana jako `downgrade` (zamiast „upgrade”) z ostrzeżeniem; blokada przez `false` (rekomendowane w produkcji).
- **Zmiana kodu błędu przy wyłączonym uploadzie** (`invalid_request` → `upload_not_allowed`, status 400 bez zmian) – klienci sprawdzający `code` muszą uwzględnić nowy kod; opis w CHANGELOG.
- Potwierdzenie w edytorze **przed** instalacją wymagałoby rozpakowania paczki w przeglądarce albo dwuetapowego API (`POST /nodes?dryRun=true` → potwierdzenie → instalacja). **Odrzucone (R-17)** – bez `dryRun`; edytor pokazuje komunikat po instalacji.
- Moduły z wersjami spoza semver (rzadkie) – zachowanie dotychczasowe.

#### Podzadania
- [ ] Testy czerwone ścieżki tarball (installer, api, admin) – M
- [ ] `classifyUpload` + przeniesienie zapisu pliku + pola hooków – S
- [ ] Ujednolicenie ustawień uploadu + szablon + CHANGELOG – S
- [ ] Edytor: komunikaty `.done/.fail` + teksty en-US – S
- [ ] Ostrzeżenie w logu przy użyciu aliasu ustawienia uploadu (R-17) – S

---

### Z-04 – Pełne API pojedynczego flow

> **Zrealizowane (F3, 2026-10-03):** `flows/index.js` – `getFlowRevision(id)` (wg definicji; `null` dla nieistniejącego flow), `buildUpdateFlowConfig(id, flow, {create, globalConfigs})` (tworzenie pod id → `created`, `invalid_flow_id`, `duplicate_id` dla id węzłów innych flow/węzłów globalnych), `buildAddFlowConfig(flow, {globalConfigs})`, `applyGlobalConfigs` (upsert, `duplicate_id`, `invalid_node_type` dla `tab/subflow/group`); `flows/pipeline.js` `checkRevision({present, value, current, strictType})` – wspólna kontrola kroku 2 (`null` jako bieżąca = flow nie istnieje, więc `rev:null` przechodzi tylko przy tworzeniu); `api/flows.js` – wydzielenie `rev`/`globalRev`/`globalConfigs` z treści (nie trafiają do węzła `tab`), kontrola rewizji w sekcji blokady (krok `apply`), `deploy.putCreatesFlow`, wynik v2 `{id, rev, revAll, created}` / `{id, rev}`, `getFlow` v2 z `rev`; `editor-api/admin/flow.js` – walidacja `Node-RED-API-Version`, `ETag: "<rev>"`, `If-Match` (w v2, sprzeczny z `rev` → 400 `invalid_revision`, w v1 ignorowany), 201 dla `POST` v2 i `PUT` tworzącego w v2. Testy: `flows/index_spec.js` (`#getFlowRevision (Z-04)`, `single-flow configuration (Z-04)`), `api/flows_spec.js` (`single-flow api (Z-04)`), `admin/flow_spec.js` (`single-flow api v1/v2 (Z-04)` – 8 czerwonych przed zmianą `flow.js`), integracyjny `test/unit/node-red/flow-api_spec.js` (proces potomny). **Doprecyzowania/odstępstwa:** (1) `ETag` w cudzysłowie (format HTTP), `If-Match` z/bez cudzysłowu i `W/`, `*` = brak rewizji; (2) GET v1: Express dodaje własny słaby `ETag` (jak w 5.0.7) – test sprawdza brak `ETag` z rewizją flow, nie brak nagłówka; (3) `rev` w `POST /flow` ignorowany (jak dotąd), sprawdzany tylko `globalRev`; (4) `rev` w złym typie → 400 `invalid_revision` tylko w `/flow` (nowe pole); `POST /flows` bez zmian (409 jak 5.0.7, N-01); (5) wydzielanie `rev`/`globalRev`/`globalConfigs` w runtime API (nie w editor-api) – obejmuje też wywołania runtime API bez HTTP; (6) nieprawidłowy `Node-RED-API-Version` na `/flow` → 400 (wcześniej ignorowany) – drobna zmiana v1 dla błędnych klientów; (7) walidacja „węzeł konfiguracyjny” w `globalConfigs` ograniczona do `tab/subflow/group` (jak w Ryzykach); (8) nazwy `rev`/`revAll` w odpowiedzi PUT przyjęte jak w karcie („do potwierdzenia”).

> **Decyzja N-01 (2026-10-03):** pusty `rev` (`""` lub `null`): przy `deploy.requireRevision: false` – jak w 5.0.7 (409 `version_mismatch`); przy `true` – traktowany jak brak rewizji → 409 `version_required` (decyzja N-01, wariant A); `400 invalid_revision` tylko dla rewizji w złym typie. Scenariusze BDD i testy kontraktu dostosować przy realizacji.

| Pole | Wartość |
|---|---|
| Etap / typ | 2 / funkcja |
| Priorytet / ryzyko | P1 / wysokie (kontrakt Admin API, te same funkcje co P-01/Z-05/Z-06/FL-B-001) |
| Ustawienie | `deploy.putCreatesFlow: false` (propozycja zlecenia: `flows.putCreates`) |
| Zależności | E-01 (wspólny potok wdrożenia, wydzielone `build*FlowConfig`, wspólny mutex); FL-B-001 – zachować `copyFlowLayoutProperties` |
| Pliki | `runtime/lib/flows/index.js:564-570` (FL-B-001), `:572-630` (`addFlow`), `:632-734` (`getFlow`), `:736-803` (`updateFlow`), `:805-822` (`removeFlow`); `runtime/lib/api/flows.js:60-200`; `runtime/lib/storage/index.js:73-99`; `editor-api/lib/admin/flow.js:24-75`; `editor-api/lib/admin/index.js:53-56`; `node-red/settings.js` |
| Powiązania | FL-B-001 (layout/wireStyle w API pojedynczego flow); K8S – publikacja przez edytor, MCP i CI/CD (`design/k8s-postgres/ARCHITEKTURA.md` §3.6) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE (z korektą do punktu o globalnych configach).**
- Rewizja tylko dla całości: `sha256(JSON.stringify(flows))` (`storage/index.js:80,98`), `activeConfig.rev` (`flows/index.js:211-214`); `getFlow` bez rewizji (`:632-734`).
- `updateFlow` dla nieistniejącego id → `e.code = 404` (`:739-743`) → 404 `not_found` (`api/flows.js:166-170`).
- `addFlow` zawsze nadpisuje id: `flow.id = redUtil.generateId()` (`:577`); duplikat id węzła → `Error('duplicate id')` → 400 (`:598-601,:612-615`, `api/flows.js:118`).
- `updateFlow` przypisuje `z = id` wszystkim węzłom **i** `configs` (`:791-796`); `addFlow` jw. (`:606,:619`). Pole `configs` już istnieje w treści i oznacza **węzły konfiguracyjne przypisane do flow**; `getFlow` zwraca je w `result.configs` (`:690-700`).
- `updateFlow` **nie sprawdza** duplikatów id względem innych flow (filtr `node.z !== id && node.id !== id`, potem `concat`, `:774-795`) – czy `setFlows`/`parseConfig` wykrywa duplikat: **do potwierdzenia** testem.
- `PUT /flow/global` (`:749-767`) zastępuje **wszystkie** globalne configi i subflow naraz – da się wdrożyć globalne configi, ale nie przyrostowo i nie razem z flow.
- Kontrola rewizji tylko w `api/flows.js:76-86` (`setFlows`), wewnątrz `mutex.runExclusive` (`:67`); `addFlow/updateFlow/deleteFlow` też w mutexie, bez kontroli rewizji.
- FL-B-001: `copyFlowLayoutProperties` wywoływane w `addFlow` (`:593`), `getFlow` (`:657`), `updateFlow` (`:786`).

#### Specyfikacja
- **Cel:** klient (edytor, MCP, CI/CD) może bezpiecznie odczytać, utworzyć pod znanym id i zaktualizować jeden flow z kontrolą współbieżności oraz w tym samym wywołaniu wdrożyć wymagane globalne węzły konfiguracyjne.
- **Rewizja flow (definicja):** `sha256` z `JSON.stringify` tablicy: węzeł `tab` + wszystkie węzły z `z === id` (węzły, grupy, configi flow) w kolejności z `activeConfig.flows`, każdy bez właściwości `credentials`. Dla `id = "global"`: wszystkie węzły bez `z` lub z `z` wskazującym subflow / definicje subflow (zbiór zastępowany przez `PUT /flow/global`). Hex, jak rewizja całości.
- **Wejścia:**
  - `GET /flow/:id` – nagłówek `Node-RED-API-Version` (`v1` domyślnie, `v2`);
  - `PUT /flow/:id` – treść jak dziś + opcjonalnie `rev` (rewizja flow), `globalConfigs[]`, `globalRev` (rewizja `global`); w `v2` opcjonalnie nagłówek `If-Match: <ETag>` – równoważny `rev` (R-34);
  - `POST /flow` – treść jak dziś + opcjonalnie `globalConfigs[]`, `globalRev`;
  - ustawienie `deploy.putCreatesFlow`.
- **Wyjścia:**
  - `GET /flow/:id` z `v2` → obiekt flow + `rev` oraz nagłówek `ETag` z rewizją flow (R-13, D-09); z `v1` – bez zmian (bez `rev` i bez `ETag`, zob. Ryzyka – „round-trip”);
  - `PUT /flow/:id` → 200 `{id}` jak dziś; przy `v2` dodatkowo `rev` (nowa rewizja flow) i `revAll` (rewizja całości) – **nazwy do potwierdzenia**;
  - `PUT /flow/:id` tworzący (tylko przy `deploy.putCreatesFlow: true`) → **201** `{id}` w `v2`, **200** `{id}` w `v1`; bez ustawienia 404 jak dziś (R-34);
  - `POST /flow` → **201** `{id}` **tylko w `v2`** (+ `rev`); w `v1` **200** jak dziś (R-13, R-34); id nadawane przez serwer – 16 znaków hex (`generateId`).
- **Niezmienniki:**
  - wywołania bez nowych pól i bez nagłówka `v2` dają te same odpowiedzi i skutki co w 5.0.7 – bez wyjątków (status 201 tylko w `v2` – R-34);
  - właściwości układu flow (Z-14 część runtime, FL-B-001) obsługiwane w API pojedynczego flow **zawsze**, niezależnie od `editorTheme.flowLayout.enabled` (R-02);
  - rewizja flow zmienia się **wyłącznie** przy zmianie treści tego flow (zmiana innego flow, globalnego configu ani subflow jej nie zmienia); rewizja całości liczona jak dziś;
  - kontrola rewizji i zmiana stanu w **jednej** sekcji krytycznej (istniejący mutex `api/flows.js`), zgodnie z krokiem 2 E-01;
  - `copyFlowLayoutProperties` (FL-B-001) działa we wszystkich ścieżkach, także w tworzeniu pod id;
  - istniejące pole `configs` zachowuje znaczenie „configi przypisane do flow” (`z = id`).
- **Przypadki błędów:**
  - `rev` niezgodna → 409 `version_mismatch` (istniejący kod, `editor-api/lib/util.js:42-58`), bez zapisu; to samo dla niezgodnego `If-Match` w `v2` (R-34);
  - `v2`: `If-Match` i `rev` w treści obecne i sprzeczne → **400** (R-34; kod `invalid_revision` – R-43);
  - `rev`/`globalRev` w złym formacie (pusty string, nie-string, poza `rev:null` przy tworzeniu) → 400 `invalid_revision` (ZASADY §2.4; kod używany też przez Z-05);
  - `globalRev` niezgodna → 409 `version_mismatch`;
  - PUT nieistniejącego id przy `putCreatesFlow:false` → 404 `not_found` (jak dziś);
  - PUT nieistniejącego id przy `putCreatesFlow:true`, gdy id zajmuje inny węzeł (nie `tab`) lub id = `"global"`/subflow → 400 `invalid_flow_id`;
  - PUT tworzący z `rev` innym niż `null` → 409 `version_mismatch` (flow nie istnieje); `rev:null` = „utwórz tylko, jeśli nie istnieje” – przy istniejącym flow → 409;
  - `globalConfigs[i]` z id węzła należącego do **innego flow** lub do tego flow (nie-globalnego) → 400 `duplicate_id` (komunikat z id i flow); typ `tab`, `subflow`, `group` → 400 `invalid_node_type` (kod w katalogu ZASADY §2.4 – rozstrzygnięte przed rejestrem R);
  - id węzła z `nodes[]` używane w innym flow → 400 `duplicate_id` (także dla `PUT`, dziś niesprawdzane – zob. weryfikacja).
- **Skutki uboczne:** aktualizacja globalnego configu restartuje węzły go używające także w innych flow (diff typu `flows`); zapis do magazynu i zdarzenie `runtime-deploy` jak dziś; audyt `flow.update`/`flow.add` z polami `created:true`, `globalConfigs:[ids]`.

#### Kontrakt Admin API (fragment)

| Endpoint | Metoda | Treść / nagłówki | Odpowiedzi | Zmiana względem 5.0.6 |
|---|---|---|---|---|
| `/flow/:id` | GET | `Node-RED-API-Version: v1` (domyślnie) | 200 obiekt flow; 404 `not_found` | brak |
| `/flow/:id` | GET | `Node-RED-API-Version: v2` | 200 obiekt flow + `rev`, nagłówek `ETag`; 404 | **nowe** (addytywne, tylko v2; R-13) |
| `/flow/:id` | PUT | flow jak dziś | 200 `{id}`; 400; 404 `not_found` | brak |
| `/flow/:id` | PUT | + `rev` | 200 `{id[, rev, revAll]}`; 409 `version_mismatch` | **nowe** pole opcjonalne |
| `/flow/:id` | PUT | `v2` + nagłówek `If-Match: <ETag>` (zamiast lub razem z `rev`) | jak dla `rev`; `If-Match` ≠ `rev` → 400 | **nowe** (tylko v2; R-34) |
| `/flow/:id` (nieistniejące) | PUT | flow, `deploy.putCreatesFlow:true`, opcjonalnie `rev:null` | **201** `{id}` w v2 / **200** `{id}` w v1 (flow utworzony pod tym id); 400 `invalid_flow_id`; 409 | **nowe** za ustawieniem (domyślnie 404 jak dziś) (R-34) |
| `/flow/:id` | PUT | + `globalConfigs[]`, opcjonalnie `globalRev` | 200; 400 `duplicate_id` / `invalid_node_type`; 409 | **nowe** pole opcjonalne |
| `/flow` | POST | flow (+ `globalConfigs[]`, `globalRev`) | v2: **201** `{id, rev}`; v1: **200** `{id}` jak dziś (id 16 hex); 400; 409 | **201 tylko w v2** (R-13, R-34); v1 bez zmian; nowe pola opcjonalne; id nadal nadawane przez serwer |
| `/flow/global` | GET/PUT | jak dziś (+ `rev` jak wyżej) | jak dziś | rewizja jak dla każdego flow |
| `/flow/:id` | DELETE | – (opcjonalnie `?rev=` – Z-05) | 204; 404; 409 | zob. Z-05 |
| `/flows` | GET/POST | bez zmian | bez zmian | brak (rewizja całości bez zmian) |

Pełny dokument kontraktu (przykłady żądań/odpowiedzi) – w katalogu dostarczenia pakietu i w JSDoc `runtime/lib/api/flows.js`; lokalizacja docelowa **do potwierdzenia**.

#### Projekt rozwiązania (minimalny)
1. `runtime/lib/flows/index.js`:
   - `getFlowRevision(id)` – rewizja wg definicji (z `activeConfig.flows`, `jsonClone` + usunięcie `credentials`); eksport;
   - rozszerzenie funkcji budowy konfiguracji **wydzielonych w E-01** (`buildAddFlowConfig(flow)`, `buildUpdateFlowConfig(id, flow, opts)`, `buildTabNode` z `copyFlowLayoutProperties` – FL-B-001 bez zmiany zachowania) o opcję `{create}` (tworzenie pod id) i `globalConfigs`; wynik trafia do funkcji potoku E-01 `deploy(opts)` (Z-06: `preDeploy` widzi wynikową konfigurację);
   - `applyGlobalConfigs(newConfig, globalConfigs)` – upsert po id: istniejący węzeł bez `z` → zastąpienie; nowy → dodanie bez `z`; konflikt → błąd `duplicate_id`;
   - sprawdzenie duplikatów id w `updateFlow` (względem węzłów spoza flow).
2. `runtime/lib/api/flows.js`: w `addFlow`/`updateFlow` (wewnątrz mutexu): kontrola `opts.flow.rev` i `globalRev` przed budową konfiguracji; `putCreatesFlow` z `runtime.settings.get("deploy")` (bez wyjątku przy braku obiektu); mapowanie błędów (`404`, `400`, `409`) – spójnie z E-01; `getFlow` dołącza `rev` gdy `opts.apiVersion === "v2"`.
3. `editor-api/lib/admin/flow.js`: odczyt `Node-RED-API-Version` (walidacja `^v[12]$` jak `admin/flows.js:25-27`), przekazanie `apiVersion`; usunięcie `rev`, `globalRev`, `globalConfigs` z obiektu flow przed zapisem (nie trafiają do węzła `tab`); `GET` v2 – nagłówek `ETag` z `rev` (R-13); `PUT` v2 – odczyt `If-Match` jako `rev` (oba obecne i różne → 400) (R-34); `POST` i `PUT` tworzący – `res.status(apiVersion === "v2" ? 201 : 200)` (R-13, R-34).
4. `node-red/settings.js`: zakomentowany blok `deploy: { putCreatesFlow: false }` (wspólny obiekt z P-01/Z-05) w sekcji Runtime Settings z opisem.
5. JSDoc `runtime/lib/api/flows.js` (nowe opcje), CHANGELOG, dokument kontraktu.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Pełne API pojedynczego flow

  Scenariusz: [odbiór] Stare wywołania działają bez zmian
    Zakładając domyślne ustawienia
    Gdy wykonuję GET, POST, PUT i DELETE /flow tak jak w wersji 5.0.6 (bez nagłówka v2 i nowych pól)
    Wtedy statusy, treści odpowiedzi i zapisane flow są identyczne jak w wersji bazowej
    I PUT /flow/:id dla nieistniejącego id zwraca 404 "not_found"
    I POST /flow nadaje nowe id i zwraca status 200 (R-34)

  Scenariusz: POST /flow w v2 zwraca 201 i id 16 hex (R-13, R-34)
    Gdy wykonuję POST /flow z nowym flow i nagłówkiem Node-RED-API-Version "v2"
    Wtedy odpowiedź ma status 201 i {id} złożone z 16 znaków hex

  Scenariusz: POST /flow w v1 zwraca 200 jak dziś (R-34)
    Gdy wykonuję POST /flow z nowym flow bez nagłówka Node-RED-API-Version
    Wtedy odpowiedź ma status 200 i {id} złożone z 16 znaków hex

  Scenariusz: If-Match równoważny rev w v2 (R-34)
    Zakładając, że ktoś zmienił flow "t1" po moim odczycie
    Gdy wykonuję PUT /flow/t1 z nagłówkiem v2 i If-Match ze starym ETag, bez rev w treści
    Wtedy odpowiedź ma status 409 i kod "version_mismatch"

  Scenariusz: Sprzeczne If-Match i rev (R-34)
    Gdy wykonuję PUT /flow/t1 z nagłówkiem v2, If-Match równym aktualnej rewizji i inną rev w treści
    Wtedy odpowiedź ma status 400
    I flow "t1" pozostaje bez zmian

  Scenariusz: [odbiór] GET zwraca rewizję flow
    Gdy wykonuję GET /flow/t1 z nagłówkiem Node-RED-API-Version "v2"
    Wtedy odpowiedź zawiera pole rev
    I nagłówek ETag zawiera tę samą rewizję (R-13)

  Scenariusz: GET v1 bez rev i bez ETag (R-13, D-09)
    Gdy wykonuję GET /flow/t1 bez nagłówka Node-RED-API-Version
    Wtedy odpowiedź nie zawiera pola rev ani nagłówka ETag

  Scenariusz: Rewizja flow niezależna od innych flow
    Zakładając, że znam rev flow "t1"
    Gdy zmieniam flow "t2" (przez /flows lub /flow/t2)
    Wtedy rev flow "t1" się nie zmienia
    A rewizja całości się zmienia

  Scenariusz: [odbiór] Aktualizacja ze zgodną rewizją
    Gdy wykonuję PUT /flow/t1 z rev równą aktualnej rewizji "t1"
    Wtedy odpowiedź ma status 200 i flow jest zapisany

  Scenariusz: [odbiór] Aktualizacja z niezgodną rewizją
    Zakładając, że ktoś zmienił flow "t1" po moim odczycie
    Gdy wykonuję PUT /flow/t1 ze starą rev
    Wtedy odpowiedź ma status 409 i kod "version_mismatch"
    I flow "t1" oraz magazyn pozostają bez zmian

  Scenariusz: [odbiór] Tworzenie flow pod wskazanym id przy włączonym ustawieniu
    Zakładając, że deploy.putCreatesFlow jest true
    Gdy wykonuję PUT /flow/nowy1 z nagłówkiem v2 dla nieistniejącego flow z węzłami i layout "TB"
    Wtedy odpowiedź ma status 201 i {id:"nowy1"} (R-34)
    I flow "nowy1" istnieje z węzłami przypisanymi do "nowy1" i layout "TB"

  Scenariusz: Tworzenie pod id w v1 zwraca 200 (R-34)
    Zakładając, że deploy.putCreatesFlow jest true
    Gdy wykonuję PUT /flow/nowy2 bez nagłówka v2 dla nieistniejącego flow
    Wtedy odpowiedź ma status 200 i {id:"nowy2"}

  Scenariusz: Tworzenie pod id zajętym przez węzeł
    Zakładając, że deploy.putCreatesFlow jest true i istnieje węzeł "n1" w flow "t1"
    Gdy wykonuję PUT /flow/n1
    Wtedy odpowiedź ma status 400 i kod "invalid_flow_id"

  Scenariusz: Tworzenie warunkowe
    Zakładając, że deploy.putCreatesFlow jest true i flow "t1" istnieje
    Gdy wykonuję PUT /flow/t1 z rev null
    Wtedy odpowiedź ma status 409 i kod "version_mismatch"

  Scenariusz: [odbiór] Dodanie globalnego configu razem z flow
    Gdy wykonuję PUT /flow/t1 z globalConfigs zawierającym nowy węzeł "c1"
    Wtedy "c1" istnieje jako globalny węzeł konfiguracyjny (bez z)
    I GET /flow/global zawiera "c1" w configs
    I GET /flow/t1 nie zawiera "c1"

  Scenariusz: Aktualizacja istniejącego globalnego configu
    Zakładając, że istnieje globalny węzeł "c1"
    Gdy wykonuję POST /flow z globalConfigs zawierającym "c1" ze zmienioną właściwością
    Wtedy "c1" ma nową wartość i nadal jest globalny
    I węzły innych flow używające "c1" zostają zrestartowane

  Scenariusz: Konflikt id globalnego configu z węzłem innego flow
    Zakładając, że węzeł "n2" należy do flow "t2"
    Gdy wykonuję PUT /flow/t1 z globalConfigs zawierającym węzeł o id "n2"
    Wtedy odpowiedź ma status 400 i kod "duplicate_id"
    I żaden flow nie jest zmieniony

  Scenariusz: Istniejące pole configs zachowuje znaczenie
    Gdy wykonuję PUT /flow/t1 z configs zawierającym "c2"
    Wtedy "c2" jest przypisany do flow "t1" (z = "t1") jak w wersji bazowej

  Scenariusz: Właściwości układu zakładki zachowane (FL-B-001)
    Gdy wykonuję PUT /flow/t1 z layout "auto" i wireStyle "orthogonal" oraz rev
    Wtedy GET /flow/t1 zwraca layout "auto" i wireStyle "orthogonal"

  Scenariusz: Współbieżne aktualizacje są serializowane
    Gdy dwa żądania PUT /flow/t1 z tą samą rev przychodzą jednocześnie
    Wtedy dokładnie jedno kończy się 200, a drugie 409
```

#### Testy
- **Jednostkowe** `test/unit/@node-red/runtime/lib/flows/index_spec.js`: `describe('#getFlowRevision')` – `is stable for unchanged flow`, `changes when flow node changes`, `does not change when another flow changes`, `ignores credentials`, `computes global revision`; `describe('#updateFlow')` – `creates flow with given id when create flag set`, `rejects create when id used by a node`, `rejects node id used in another flow`, `upserts globalConfigs`, `rejects globalConfig id used in another flow`, `keeps configs flow-scoped`; istniejące testy FL-B-001 (`flow layout properties`, `:679-731`) bez zmian i zielone.
- **Jednostkowe** `test/unit/@node-red/runtime/lib/api/flows_spec.js` (`addFlow`, `getFlow`, `updateFlow`): `rejects stale rev with 409 version_mismatch`, `accepts matching rev`, `returns rev only for v2`, `putCreatesFlow false returns 404`, `putCreatesFlow true creates flow`, `rev null with existing flow returns 409`, `globalRev mismatch returns 409`, `concurrent updates with same rev – one 409`.
- **Kontraktowe** `test/unit/@node-red/editor-api/lib/admin/flow_spec.js` (supertest): `legacy GET/POST/PUT/DELETE unchanged` (zapis oczekiwanych odpowiedzi 5.0.7), `GET v2 returns rev and ETag header` (R-13), `GET v1 has no rev and no ETag`, `POST /flow v2 returns 201 with 16-hex id` (R-13, R-34), `POST /flow v1 returns 200` (R-34), `PUT create returns 201 in v2 and 200 in v1` (R-34), `PUT v2 If-Match acts as rev` (R-34), `PUT v2 conflicting If-Match and rev returns 400 invalid_revision` (R-34, R-43), `If-Match ignored in v1` (R-43), `invalid API version returns 400 invalid_api_version`, `PUT with stale rev returns 409`, `PUT unknown id returns 404 by default`, `PUT unknown id creates when putCreatesFlow`, `PUT with globalConfigs conflict returns 400 duplicate_id`, `rev/globalRev/globalConfigs are not stored on tab node`.
- **E2E** (opcjonalnie, jak dla FL-B-001): skrypt HTTP na uruchomionym runtime – cykl GET v2 → PUT z rev → PUT ze starą rev (409).

#### DoD specyficzne
- [ ] Zgodność z R-13/R-34: `globalConfigs[]` (D-08), `rev` tylko w v2 + `ETag` (D-09), `If-Match` w v2 równoważne `rev` (sprzeczne → 400), `POST /flow` i `PUT` tworzący → 201 tylko w v2 (v1 200), id 16 hex, `globalRev`; kontrakt i CHANGELOG.
- [ ] Dokument kontraktu Admin API (tabela + przykłady) dołączony do gałęzi pakietu.
- [ ] Testy FL-B-001 zielone; brak regresji `copyFlowLayoutProperties`.
- [ ] Wszystkie nowe ścieżki wewnątrz istniejącego mutexu; zgodność z krokami E-01.
- [ ] `deploy.putCreatesFlow` w szablonie `settings.js` (wspólny obiekt `deploy`).

#### Ryzyka i alternatywy
- **Kolizja nazwy `configs` (decyzja Zamawiającego):** zlecenie opisuje „opcjonalne `configs[]` dodające globalne configi”, ale `configs` już istnieje i znaczy „configi flow” (zwracane też przez `GET /flow/:id`). Zmiana znaczenia złamałaby klientów robiących GET → PUT. Rekomendacja: nowe pole `globalConfigs[]`. Alternatywy: flaga `configsScope: "global"` w treści albo nagłówek; odrzucona – niejawne, łatwe do pomyłki.
- **„Round-trip” GET → PUT:** gdyby `GET /flow/:id` zawsze zwracał `rev`, dotychczasowi klienci odsyłający cały obiekt zaczęliby nieświadomie wysyłać rewizję i dostawać 409 zamiast nadpisania. Dlatego `rev` w GET tylko przy `v2`; `rev` w PUT sprawdzane zawsze, gdy obecne. **Rozstrzygnięte (R-13):** `rev` w treści tylko przy v2, dodatkowo nagłówek `ETag`; v1 bez zmian (D-09). **Rozstrzygnięte (R-34):** w v2 `If-Match: <ETag>` równoważne `rev`; oba obecne i sprzeczne → 400.
- **Rewizja flow a zależności:** zmiana globalnego configu lub subflow używanego przez flow nie zmienia rewizji flow (zgodnie z wymaganiem „tylko przy zmianie tego flow”); klient chcący chronić globalne configi używa `globalRev`.
- **Kolejność węzłów:** rewizja liczona w kolejności zapisu – przestawienie węzłów zmienia rewizję (bezpieczniej niż sortowanie).
- **Status odpowiedzi przy tworzeniu – rozstrzygnięte (R-13, R-34):** `POST /flow` → 201 z id 16 hex **tylko w v2**; v1 nadal 200 – dotychczasowi klienci bez zmian. `PUT /flow/:id` tworzy tylko przy `deploy.putCreatesFlow: true` (201 w v2 / 200 w v1), bez ustawienia 404 jak dziś (R-34). Ograniczenia formatu id przy tworzeniu przez `PUT` – R-34 ich nie określa (walidacja wg `invalid_flow_id`).
- **Węzły konfiguracyjne nierozpoznawalne po stronie API:** runtime nie weryfikuje, czy typ w `globalConfigs` jest węzłem konfiguracyjnym (wiedza w definicji edytora) – walidacja ograniczona do typów `tab/subflow/group` i braku `wires`; **do potwierdzenia**.
- Wysokie ryzyko konfliktów scalania z P-01/Z-05/Z-06/FL-B-002 – łagodzone przez E-01.

#### Podzadania
- [ ] Testy kontraktowe stanu bieżącego (zapis odpowiedzi 5.0.7) – S
- [ ] `getFlowRevision` + `rev` i `ETag` w GET v2; `POST /flow` i `PUT` tworzący → 201 tylko w v2 (R-13, R-34) – S
- [ ] `If-Match` w PUT v2 (równoważne `rev`, sprzeczne → 400) (R-34) – S
- [ ] Kontrola `rev`/`globalRev` w PUT/POST (mutex) – M
- [ ] Tworzenie pod id za ustawieniem (rozszerzenie `build*FlowConfig` z E-01) – M
- [ ] `globalConfigs[]` (upsert, konflikty, duplikaty w `updateFlow`) – M
- [ ] Dokument kontraktu, szablon `settings.js`, JSDoc, CHANGELOG – S

---

### Z-05 – Wymóg rewizji przy każdym wdrożeniu

> **Zrealizowane – część serwerowa (F3, 2026-10-03):** `flows/pipeline.js` `checkRevision({…, required})` – brak/pusty `rev` (`""`, `null` – N-01) → 409 `version_required`, `null` przyjmowany tylko dla nieistniejącego celu (tworzenie), zły typ → 400 `invalid_revision`; `deploy({requireRevision, apiVersion})` – v1 przy wymogu zawsze 409 `version_required` z komunikatem wskazującym v2 (R-14), `reload` zwolniony; `api/flows.js` – macierz: `PUT /flow/:id` (także `global`, tworzenie z `rev:null`), `DELETE /flow/:id` (`opts.rev` z `?rev=`, sprawdzany zawsze, gdy podany), `POST /flow` z `globalConfigs` → `globalRev`; odczyt ustawienia przy każdym wywołaniu; audyt `flows.set`/`flow.update`/`flow.remove` z `error: "version_required"`; `api/settings.js` – `deploy: {requireRevision: true}` w ustawieniach runtime (tylko flaga, tylko gdy włączona); `editor-api` – `apiVersion` w `POST /flows`, `?rev=` w `DELETE /flow/:id`. Testy: `api/flows_spec.js` (`requireRevision (Z-05)` – oba stany), `api/settings_spec.js`, `admin/flows_spec.js`, `admin/flow_spec.js`. **Nie zrealizowane w tej gałęzi:** edytor `deploy.js` (wymuszone nadpisanie z pobraniem `rev` – D-12, komunikat `version_required`) – tor editor-client, po scaleniu P-02; test „rev check happens before preDeploy hook” – Z-06 odłożone. **Doprecyzowania:** (1) `PUT /flow/:id` nieistniejącego flow bez `putCreatesFlow` – 404 ma pierwszeństwo przed `version_required`; (2) `PUT /flow/:id` z `globalConfigs` – macierz wymaga tylko `rev` flow (bez `globalRev`); `globalRev` sprawdzany, gdy podany – **pytanie do Zamawiającego**, czy przy wymogu wymagać też `globalRev` (upsert nadpisuje globalne configi jak w `POST /flow`); (3) `DELETE` bez `?rev=` dla nieistniejącego flow – 404 (nie `version_required`).

> **Decyzja N-01 (2026-10-03):** pusty `rev` (`""` lub `null`): przy `deploy.requireRevision: false` – jak w 5.0.7 (409 `version_mismatch`); przy `true` – traktowany jak brak rewizji → 409 `version_required` (decyzja N-01, wariant A); `400 invalid_revision` tylko dla rewizji w złym typie. Scenariusze BDD i testy kontraktu dostosować przy realizacji.

| Pole | Wartość |
|---|---|
| Etap / typ | 2 / funkcja |
| Priorytet / ryzyko | P1 / średnie |
| Ustawienie | `deploy.requireRevision: false` (propozycja zlecenia: `flows.requireRevision`) |
| Zależności | E-01 (krok 2), Z-04 (rewizja flow, `globalRev`, `rev:null`, `invalid_revision`) – Z-05 realizowany **po** Z-04; integracja edytora (`deploy.js`: wymuszone nadpisanie wg D-12, `version_required`) dotyka `deploy.js` **po scaleniu P-02** (etap 1). P-02 zależy od Z-05 tylko miękko – brak cyklu |
| Pliki | `runtime/lib/api/flows.js:66-98,100-200`; `editor-api/lib/admin/flows.js:38-68`; `editor-api/lib/admin/flow.js`; `editor-client/src/js/ui/deploy.js:262-279,367-400,536-560,675-690`; `runtime/lib/api/settings.js` (przekazanie ustawienia do edytora); `node-red/settings.js` |
| Powiązania | K8S – publikacja przez edytor, MCP i CI/CD (`ARCHITEKTURA.md` §3.6: „każdy klient wysyła rewizję”) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE.**
- Kontrola tylko `if (flows.hasOwnProperty('rev'))` (`api/flows.js:76-86`); brak `rev` = nadpisanie bez kontroli.
- v1 (`admin/flows.js:56`): treść to tablica, opakowywana w `{flows: req.body}` – **nie ma miejsca na `rev`**.
- `reload` pomija kontrolę (`api/flows.js:72-74` → `loadFlows(true)`); `/flow` (POST/PUT/DELETE) – brak kontroli.
- Kod 409 `version_mismatch` (`api/flows.js:80-84`) mapowany w `editor-api/lib/util.js:42-58`.
- Edytor wysyła `rev` zawsze poza wymuszonym nadpisaniem (`deploy.js:540-543`); każde 409 → okno konfliktu (`:680-681`).
- **Błąd istniejący:** `restart()` (`deploy.js:367-400`, `:390`) – niezdefiniowane `nns` przy 409. Poprawka z testem należy do **P-02** (ANALIZA §4.9); Z-05 z niej korzysta (bez osobnej zmiany).

#### Specyfikacja
- **Cel:** przy włączonym ustawieniu żadne wdrożenie zmieniające treść flow przez Admin API nie nadpisze cudzych zmian bez jawnej rewizji.
- **Wejścia:** `deploy.requireRevision` (domyślnie `false`); `rev` w treści (v2, `/flow/:id`), `globalRev` (Z-04), `?rev=` w `DELETE /flow/:id`.
- **Wyjścia:** przy braku wymaganej rewizji → **409** `{code:"version_required", message:"..."}`; przy niezgodnej → 409 `version_mismatch` (bez zmian).
- **Macierz (przy `requireRevision: true`; przy `false` – wszystko jak dziś):**

| Ścieżka | Wymagana rewizja | Uzasadnienie |
|---|---|---|
| `POST /flows` v2 (`full`/`nodes`/`flows`) | `rev` całości | wymaganie zlecenia |
| `POST /flows` v1 | zawsze 409 `version_required` (komunikat wskazuje v2) | v1 nie ma pola na `rev`; nagłówek z rewizją odrzucony (**R-14**) |
| `POST /flows` `reload` | **nie** (**R-14**) | nie zmienia treści w magazynie, tylko przeładowuje to, co tam jest |
| `PUT /flow/:id` (istniejący) | `rev` flow | wymaganie zlecenia |
| `PUT /flow/:id` (tworzenie, Z-04) | `rev: null` (jawne „flow nie istnieje”) | brak rewizji do porównania |
| `PUT /flow/global` | `rev` flow `global` | nadpisuje wszystkie globalne configi |
| `POST /flow` | nie (id nadaje serwer, nic nie nadpisuje); **tak** – `globalRev`, gdy niesie `globalConfigs` | upsert globalnych configów nadpisuje |
| `DELETE /flow/:id` | `?rev=` flow (**R-14**) | usunięcie też niszczy cudze zmiany |
| `POST /flows/state` (start/stop) | nie | nie zmienia treści |
| wywołania wewnętrzne (`runtime.flows.*` bez Admin API) | nie | kontrola w warstwie `runtime/lib/api` |

- **Niezmienniki:** przy `false` brak zmian w zachowaniu i odpowiedziach; kontrola przed hookiem `preDeploy` (E-01 krok 2 przed 3) i w mutexie; `version_mismatch` zachowuje znaczenie (zgodność z edytorem).
- **Przypadki błędów:** brak `rev` → 409 `version_required`; `rev` pusty string / nie-string → 400 `invalid_revision` (kod z Z-04, ZASADY §2.4); niezgodna → 409 `version_mismatch`.
- **Skutki uboczne:** wpis audytu `flows.set`/`flow.update` z `error:"version_required"`; edytor przy wymuszonym nadpisaniu wysyła aktualną rewizję po potwierdzeniu w oknie (D-12, rozstrzygnięte R-12); w `reload-only` „Overwrite” ukryty (R-12).

#### Projekt rozwiązania (minimalny)
1. `runtime/lib/api/flows.js`: funkcja `checkRevision({required, provided, current})` używana przez `setFlows`, `addFlow`, `updateFlow`, `deleteFlow` (wspólna z Z-04, w kroku 2 E-01); odczyt `deploy.requireRevision` przy każdym wywołaniu (zmiana bez restartu nie jest wymagana – **do potwierdzenia**).
2. `editor-api/lib/admin/flows.js`: dla v1 przekazanie `apiVersion:"v1"`, by runtime zwrócił komunikat wskazujący v2; `admin/flow.js`: przekazanie `req.query.rev` dla DELETE.
3. Udostępnienie stanu ustawienia edytorowi: `runtime/lib/api/settings.js` – pole `deploy.requireRevision` w ustawieniach runtime dla edytora (tylko flaga).
4. Edytor `deploy.js` (zmiany **po scaleniu P-02**, na jego wersji pliku):
   - wymuszone nadpisanie (`save(true)`) przy `requireRevision` (D-12): okno potwierdzenia → `GET /flows` (v2) po aktualną `rev` → wdrożenie z nią (jawne, świadome nadpisanie; kolejny konflikt → ponowne okno); przy `editorTheme.deploy.staleFlows: "reload-only"` (P-02) wymuszone nadpisanie niedostępne;
   - obsługa `version_required` w `.fail` (komunikat zamiast okna konfliktu);
   - poprawka `restart()` (`:390`, `nns`) – w P-02 (właściciel); Z-05 tylko odwołanie.
5. Szablon `settings.js`: `deploy.requireRevision` z opisem macierzy; CHANGELOG; nowy kod błędu w dokumencie kontraktu (Z-04).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Wymóg rewizji przy wdrożeniu

  Szablon scenariusza: [odbiór] Ustawienie wyłączone – zachowanie jak dotąd
    Zakładając, że deploy.requireRevision jest false
    Gdy wdrażam przez <ścieżka> bez rewizji
    Wtedy wdrożenie się udaje jak w wersji bazowej
    Przykłady:
      | ścieżka            |
      | POST /flows v1     |
      | POST /flows v2     |
      | PUT /flow/:id      |

  Szablon scenariusza: [odbiór] Ustawienie włączone – brak rewizji odrzucony
    Zakładając, że deploy.requireRevision jest true
    Gdy wdrażam przez <ścieżka> bez rewizji
    Wtedy odpowiedź ma status 409 i kod "version_required"
    I magazyn i uruchomione flow pozostają bez zmian
    I hook preDeploy nie jest wywoływany
    Przykłady:
      | ścieżka            |
      | POST /flows v1     |
      | POST /flows v2     |
      | PUT /flow/:id      |
      | PUT /flow/global   |
      | DELETE /flow/:id   |

  Scenariusz: [odbiór] Ustawienie włączone – zgodna rewizja
    Zakładając, że deploy.requireRevision jest true
    Gdy wdrażam przez POST /flows v2 z aktualną rev
    Wtedy wdrożenie się udaje

  Scenariusz: Ustawienie włączone – niezgodna rewizja
    Zakładając, że deploy.requireRevision jest true
    Gdy wdrażam przez PUT /flow/t1 ze starą rev
    Wtedy odpowiedź ma status 409 i kod "version_mismatch"

  Scenariusz: v1 przy włączonym wymogu
    Zakładając, że deploy.requireRevision jest true
    Gdy wdrażam przez POST /flows v1
    Wtedy odpowiedź ma status 409, kod "version_required" i komunikat wskazujący API v2

  Scenariusz: Przeładowanie nie wymaga rewizji
    Zakładając, że deploy.requireRevision jest true
    Gdy wysyłam POST /flows z typem wdrożenia "reload"
    Wtedy flow są przeładowane z magazynu

  Scenariusz: Nowy flow bez globalnych configów
    Zakładając, że deploy.requireRevision jest true
    Gdy wykonuję POST /flow bez globalConfigs i bez rewizji
    Wtedy flow jest dodany

  Scenariusz: Nowy flow z globalnymi configami wymaga globalRev
    Zakładając, że deploy.requireRevision jest true
    Gdy wykonuję POST /flow z globalConfigs bez globalRev
    Wtedy odpowiedź ma status 409 i kod "version_required"

  Scenariusz: Wymuszone nadpisanie w edytorze (D-12)
    Zakładając, że deploy.requireRevision jest true i wystąpił konflikt wdrożenia
    Gdy wybieram w edytorze "Overwrite" i potwierdzam w oknie
    Wtedy edytor pobiera aktualną rewizję i wdraża z nią
    I serwer nie zwraca "version_required"

  Scenariusz: Wymuszone nadpisanie niedostępne w trybie reload-only (D-12)
    Zakładając, że deploy.requireRevision jest true i editorTheme.deploy.staleFlows = "reload-only"
    Gdy wystąpi konflikt wdrożenia
    Wtedy okno nie zawiera akcji "Overwrite"

  # Restart flow przy 409 bez ReferenceError (deploy.js:390, nns) – scenariusz i test w P-02 (etap 1)
```

#### Testy
- **Jednostkowe** `test/unit/@node-red/runtime/lib/api/flows_spec.js`: `describe("requireRevision")` z `[false, true].forEach` – `setFlows without rev`, `setFlows v1 without rev`, `setFlows reload without rev`, `updateFlow without rev`, `updateFlow create with rev null`, `addFlow without globalConfigs`, `addFlow with globalConfigs without globalRev`, `deleteFlow without rev`, `missing deploy settings object treated as false`, `rev check happens before preDeploy hook` (z Z-06).
- **Kontraktowe** `test/unit/@node-red/editor-api/lib/admin/flows_spec.js` i `flow_spec.js`: `POST /flows v1|v2 returns 409 version_required when required`, `same requests succeed when not required`, `DELETE /flow/:id?rev=`, `error body has code and message`.
- **Edytor:** E2E/ręcznie – wymuszone nadpisanie z potwierdzeniem i brak Overwrite w `reload-only` (brak testów jednostkowych `deploy.js`; ewentualnie harness z P-02/E-03). Restart przy 409 – test w P-02.

#### DoD specyficzne
- [ ] Macierz ścieżek zgodna z R-14 (v1 → 409 `version_required`, `DELETE` z `?rev=`, `reload` zwolniony).
- [ ] Testy obu stanów ustawienia dla v1, v2 i `/flow/:id` (wymóg zlecenia).
- [ ] Kod `version_required` opisany w kontrakcie Admin API i CHANGELOG.
- [ ] Zmiany `deploy.js` naniesione na wersję po scaleniu P-02 (poprawka `restart()`/`nns` dostarczona w P-02).

#### Ryzyka i alternatywy
- v1 bez możliwości wysłania rewizji: alternatywa – nagłówek `Node-RED-Revision` (lub `If-Match`) honorowany przez wszystkie ścieżki – **odrzucona (R-14)**: v1 przy wymogu → zawsze 409 `version_required`.
- Edytor z „Overwrite” formalnie spełnia wymóg, ale nadal nadpisuje (D-12: świadomie, po potwierdzeniu); jeśli celem jest zakaz nadpisań – P-02 `reload-only` (tam Overwrite niedostępny).
- Inne klienty (np. narzędzia CLI, integracje) wdrażające v1 przestaną działać przy włączonym wymogu – zamierzone; opis w dokumentacji ustawienia.
- Spójność `requireRevision` z Z-09 (obserwator magazynu używa `reload` – zwolniony z wymogu).

#### Podzadania
- [ ] `checkRevision` + macierz w runtime API – M
- [ ] Przekazanie wersji API / `?rev=` w editor-api – S
- [ ] Edytor (po scaleniu P-02): Overwrite z potwierdzeniem i pobraniem rewizji (D-12), `version_required` – M
- [ ] Testy obu stanów + kontrakt – M
- [ ] Szablon `settings.js`, CHANGELOG – S

---

### Z-06 – Hooki wdrożenia `preDeploy` / `postDeploy` w `RED.hooks`

> **Odłożone (2026-10-03, decyzja budżetowa).** Poza F3; kotwice kroków 3 i 11 w `flows/pipeline.js` (E-01) pozostają bez zmian.

| Pole | Wartość |
|---|---|
| Etap / typ | 2 / funkcja |
| Priorytet / ryzyko | P1 / średnie |
| Ustawienie | brak przełącznika (funkcja addytywna: bez zarejestrowanych hooków zachowanie jak dotąd); `deploy.hookTimeout: 30000` (ms, ZASADY §2.1 – limit `preDeploy`) |
| Zależności | E-01 (funkcja potoku `deploy(opts)`, kotwice kroków 3 i 11, mechanizm `loaded` dla `reload`), P-01 (moment odpowiedzi), Z-04, Z-05 (kontrola rewizji przed `preDeploy`). **Punkt integracji wykorzystywany przez Z-09**: wywołanie `postDeploy` z `source:"storage"` po przeładowaniu z magazynu (Z-09 zależy od Z-06, nie odwrotnie) |
| Pliki | `util/lib/hooks.js:3-17,40-65,162-235`; `runtime/lib/api/flows.js:66-200`; `runtime/lib/flows/index.js:118-242,572-822`; `editor-api/lib/admin/flows.js`, `flow.js` (źródło, użytkownik); `editor-client/src/js/ui/deploy.js:675-690` (komunikat odrzucenia); `runtime/locales/en-US/runtime.json` |
| Powiązania | K8S – publikacja przez edytor, MCP i CI/CD (`ARCHITEKTURA.md` §3.6: „walidacja przed wdrożeniem – hook w runtime”); K8S-T-006 (wydania) – `postDeploy` |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE.**
- `VALID_HOOKS` (`hooks.js:3-17`): `onSend, preRoute, preDeliver, postDeliver, onReceive, postReceive, onComplete, preInstall, postInstall, preUninstall, postUninstall`; `add()` rzuca `Invalid hook` dla innych (`:63-65`).
- `trigger()` bez handlerów → `Promise.resolve()` (`:162-171`); handler: zwrot `false` → zatrzymanie (promise **rozwiązany** wartością `false`, nie odrzucony); wyjątek synchroniczny lub promise odrzucony wartością prawdziwą → odrzucenie z `err.hook` (`:175-235`). Brak limitu czasu – handler, który nigdy nie zakończy, wstrzymuje wywołującego.
- **Pułapki `invokeStack` (`hooks.js:190-235`):** (1) promise odrzucony wartością `undefined` (lub inną fałszywą: `null`, `0`, `""`) **nie** przerywa łańcucha – `result.then(handleResolve, callNextHook)` → `callNextHook(undefined)` przechodzi do następnego handlera, a `trigger` się rozwiązuje (wdrożenie przeszłoby mimo „odrzucenia”); (2) promise rozwiązany wartością różną od `undefined` (np. `true`, obiekt) → `done(result)` → `trigger` **odrzuca** z `new Error(String(result))`; (3) handler dwuargumentowy `(payload, done)` – te same reguły dla wartości przekazanej do `done`.
- Payload przekazywany przez referencję (handler może go zmieniać).
- Wzorzec wywołania z obsługą błędu: `registry/lib/installer.js:222-275`.
- `setFlows` liczy `diff` (`flows/index.js:154`, `flows/util.js:686-691`: `added, changed, removed, rewired, linked, flowChanged`) – źródło listy zmienionych flow.
- `addFlow/updateFlow/removeFlow` budują konfigurację wewnątrz `flows/index.js` i wołają `setFlows` – wynikowa konfiguracja nie jest dziś dostępna w warstwie API (wydzielenie `build*FlowConfig` – w E-01).

#### Specyfikacja
- **Cel:** jedno miejsce w runtime do walidacji wdrożeń (np. zakazane węzły, wymagane pola) i reakcji po wdrożeniu (np. publikacja wydania), wspólne dla edytora, MCP i CI/CD.
- **Wejścia (payload `preDeploy`, zamrożona głęboka kopia):**
  `{ type: "full"|"nodes"|"flows"|"reload", source: "api"|"internal", endpoint: "/flows"|"/flow"|"/flow/:id"|null, method, flowId?, flows: [wynikowa pełna konfiguracja bez poświadczeń], currentRev, user: {username, permissions}|null }`.
- **Wejścia (payload `postDeploy`):** `{ rev, type, source: "api"|"internal"|"storage", endpoint, user, changedFlows: [id flow], started: true|false, errors?: [...] }` (`errors` – gdy P-01 je dostarcza; `source:"storage"` – przeładowanie z magazynu, Z-09).
- **Wyjścia:** `preDeploy` odrzuca przez: zwrot `false`, rzucenie błędu, odrzucony promise (**także odrzucony wartością `undefined`** – handler owinięty, zob. Projekt pkt 1) → wdrożenie przerwane **przed zapisem**, Admin API 400 `{code:"deploy_rejected", message:<komunikat z hooka lub domyślny>}`; przekroczenie `deploy.hookTimeout` → **503** `{code:"deploy_hook_timeout"}` (ZASADY §2.4, R-15); edytor pokazuje komunikat. Zwrot innej wartości niż `false` (np. `true`, obiekt) = akceptacja. `postDeploy` nie ma wpływu na wynik ani na odpowiedź.
- **Niezmienniki:**
  - kolejność (ZASADY §2.3 A): kontrola rewizji (2) → `preDeploy` (3) → stan (4) → zapis (5) → zatrzymanie (6) → start (7) → stan (8) → zdarzenie `runtime-deploy` (9) → odpowiedź HTTP (10) → `postDeploy` (11, asynchronicznie); 409 nigdy nie wywołuje `preDeploy`;
  - oba hooki dla każdej ścieżki Admin API: `/flows` (wszystkie typy), `POST /flow`, `PUT /flow/:id` (także `global` i tworzenie pod id), `DELETE /flow/:id` oraz jawny typ `reload`; przeładowanie z magazynu (Z-09, ZASADY §2.3 B) – **tylko** `postDeploy` z `source:"storage"`, bez `preDeploy` (zmianę zatwierdziła instancja, która ją zapisała);
  - bez zarejestrowanych hooków – brak zmian w zachowaniu, czasie i odpowiedziach;
  - `preDeploy` **nie może modyfikować** wdrażanej konfiguracji (kopia zamrożona; zmiany ignorowane);
  - błąd w `postDeploy` nie cofa wdrożenia – tylko wpis w logu (`log.warn`);
  - `preDeploy` w mutexie (ograniczony `deploy.hookTimeout`); `postDeploy` **poza** blokadą, asynchronicznie po odpowiedzi – kolejne wdrożenie na niego nie czeka (pole `rev` identyfikuje wdrożenie, którego dotyczy wywołanie);
  - proces działa dalej po wyjątku w dowolnym hooku.
- **Przypadki błędów:** wyjątek / odrzucenie (także wartością `undefined`) / `false` w `preDeploy` → 400 `deploy_rejected`; limit `deploy.hookTimeout` → 503 `deploy_hook_timeout` (ZASADY §2.4, R-15); wpis audytu `flows.set` z `error`; wyjątek lub odrzucenie w `postDeploy` → tylko log, odpowiedź (już wysłana) bez zmian.
- **Skutki uboczne:** dodatkowe kopiowanie konfiguracji tylko gdy `hooks.has("preDeploy")`; start wczytywania flow przy uruchomieniu runtime (`flows.load` przy starcie) **nie** jest wdrożeniem – bez hooków; przełączenie projektu i inne operacje Projektów – bez hooków (**rozstrzygnięte R-15**).

#### Projekt rozwiązania (minimalny)
1. `util/lib/hooks.js`: dopisanie `"preDeploy", "postDeploy"` do `VALID_HOOKS` (sekcja „Deploy hooks”) + JSDoc payloadów. **Owinięcie handlerów hooków wdrożenia** w `add()` (tylko `preDeploy`/`postDeploy`, inne hooki bez zmian): handler jedno- lub dwuargumentowy sprowadzany do postaci `payload => Promise`, w której: zwrot `false` → `false`; inna wartość rozwiązania → `undefined` (akceptacja, bez „błędu” `String(result)`); odrzucenie wartością fałszywą (`undefined`, `null`…) → `Error("preDeploy rejected")` z domyślnym komunikatem (`runtime.json`); odrzucenie błędem → bez zmian. Dzięki temu `trigger` odrzuca zgodnie ze Specyfikacją mimo semantyki `invokeStack` (Weryfikacja).
2. Funkcja potoku E-01 `deploy(opts)` (`runtime/lib/flows/pipeline.js`), kotwica kroku 3: po kontroli rewizji i zbudowaniu konfiguracji (`build*FlowConfig` z E-01/Z-04) → `if (hooks.has("preDeploy"))` → `await withTimeout(hooks.trigger("preDeploy", deepFreeze(clone)), deploy.hookTimeout)`; wynik `false` lub odrzucenie → błąd `deploy_rejected`; limit → `deploy_hook_timeout`.
3. Ścieżki przeładowania (ZASADY §2.3, bez osobnego mechanizmu w Z-06): **jawny `reload` przez API** – mechanizm E-01 `readFlowsFromStorage()` + `deploy({type:"reload", loaded})` (odczyt pod blokadą, `preDeploy` widzi treść, która zostanie uruchomiona) → `preDeploy` i `postDeploy`; **przeładowanie z magazynu (Z-09)** – ta sama funkcja potoku z `source:"storage"` → tylko `postDeploy` (`source:"storage"`), bez `preDeploy`. Z-06 dostarcza warunek „`preDeploy` pomijany dla `source:"storage"`” i wywołanie `postDeploy`; Z-09 jedynie z nich korzysta.
4. `postDeploy` (kotwica kroku 11): wywołanie **po odpowiedzi**, asynchronicznie, poza blokadą (`setImmediate`/`.then` bez `await` w ścieżce odpowiedzi); w trybie `stopped` – po zakończeniu startu (odpowiedź wysłana wcześniej, jak w 5.0.6), w trybie `started` (P-01) – po odpowiedzi wysłanej po kroku 9; `changedFlows` z `diff` (`z` węzłów z `added/changed/removed/rewired` + `flowChanged` + id zakładek), dla `full`/`reload` – wszystkie flow; `catch` → `log.warn(log._("deploy.hook-failed", …))` – błąd tylko w logu, wdrożenie nie jest cofane.
5. `editor-api`: przekazanie `source:"api"` (dziś rozpoznawalne po `opts.req`, rekomendacja: jawne pole) i `user` (bez tokenów).
6. Edytor `deploy.js` `.fail`: dla 400 z `responseJSON.code === "deploy_rejected"` – `RED.notify(RED._("deploy.errors.rejected",{message}))` zamiast surowego `responseText` (nowy klucz en-US).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Hooki wdrożenia

  Scenariusz: [odbiór] Brak hooków – zachowanie jak dotąd
    Zakładając, że nie zarejestrowano preDeploy ani postDeploy
    Gdy wdrażam przez /flows, /flow, /flow/:id i reload
    Wtedy odpowiedzi i skutki są takie jak w wersji bazowej

  Szablon scenariusza: [odbiór] preDeploy odrzuca wdrożenie
    Zakładając, że hook preDeploy <sposób> z komunikatem "Zakazany węzeł exec"
    Gdy wdrażam przez <ścieżka>
    Wtedy odpowiedź ma status 400 i kod "deploy_rejected" z komunikatem "Zakazany węzeł exec"
    I magazyn i uruchomione flow pozostają bez zmian
    I postDeploy nie jest wywoływany
    Przykłady:
      | sposób                    | ścieżka         |
      | rzuca błąd                | POST /flows     |
      | zwraca odrzucony promise  | PUT /flow/:id   |
      | zwraca false              | POST /flow      |
      | rzuca błąd                | reload          |
      | zwraca promise odrzucony wartością undefined | POST /flows |

  Scenariusz: Komunikat odrzucenia w edytorze
    Zakładając, że hook preDeploy odrzuca wdrożenie z komunikatem "Brak opisu flow"
    Gdy klikam Deploy w edytorze
    Wtedy edytor pokazuje powiadomienie błędu zawierające "Brak opisu flow"

  Scenariusz: [odbiór] Wyjątek w hooku nie zatrzymuje procesu
    Zakładając, że hook preDeploy rzuca nieoczekiwany TypeError
    Gdy wdrażam przez POST /flows
    Wtedy wdrożenie jest odrzucone z komunikatem
    I runtime nadal obsługuje kolejne żądania

  Scenariusz: [odbiór] Kolejność wywołań
    Zakładając, że hooki i magazyn zapisują kolejność zdarzeń
    I ustawienie deploy.response = "started"
    Gdy wdrażam przez PUT /flow/t1 z poprawną rev
    Wtedy kolejność to: kontrola rewizji, preDeploy, zapis do magazynu, zatrzymanie, start, runtime-deploy, odpowiedź HTTP, postDeploy

  Scenariusz: postDeploy nie wstrzymuje odpowiedzi ani kolejnych wdrożeń
    Zakładając, że hook postDeploy kończy się po 5 s
    Gdy wdrażam dwa razy jedno po drugim
    Wtedy odpowiedź na pierwsze wdrożenie nie czeka na postDeploy
    I drugie wdrożenie nie czeka na zakończenie postDeploy pierwszego

  Scenariusz: Hook zwracający wartość inną niż false akceptuje wdrożenie
    Zakładając, że hook preDeploy zwraca promise rozwiązany wartością true
    Gdy wdrażam przez POST /flows
    Wtedy wdrożenie się udaje

  Scenariusz: Jawny reload wywołuje oba hooki z treścią z magazynu
    Zakładając zarejestrowane preDeploy i postDeploy
    Gdy wysyłam POST /flows z typem wdrożenia "reload"
    Wtedy preDeploy otrzymuje type "reload" i konfigurację odczytaną z magazynu
    I uruchomiona zostaje dokładnie ta konfiguracja
    I postDeploy otrzymuje source "api"

  Scenariusz: Przeładowanie z magazynu wywołuje tylko postDeploy (punkt integracji dla Z-09)
    Zakładając zarejestrowane preDeploy i postDeploy
    Gdy funkcja potoku wykona przeładowanie z source "storage"
    Wtedy preDeploy nie jest wywoływany
    I postDeploy otrzymuje source "storage"

  Scenariusz: Niezgodna rewizja nie wywołuje preDeploy
    Gdy wdrażam ze starą rev
    Wtedy odpowiedź ma status 409, a preDeploy nie jest wywoływany

  Scenariusz: preDeploy otrzymuje dane wdrożenia
    Gdy użytkownik "alice" wdraża przez POST /flows typ "nodes"
    Wtedy preDeploy otrzymuje type "nodes", source "api", user.username "alice" i wynikową konfigurację

  Scenariusz: preDeploy nie może zmienić konfiguracji
    Zakładając, że hook preDeploy próbuje zmienić nazwę węzła w payloadzie
    Gdy wdrażam
    Wtedy zapisana konfiguracja jest taka, jak wysłana przez klienta

  Scenariusz: postDeploy otrzymuje rewizję i zmienione flow
    Gdy wdrażam typ "flows" zmieniając tylko flow "t1"
    Wtedy postDeploy otrzymuje nową rev, type "flows", użytkownika i changedFlows ["t1"]

  Scenariusz: Błąd postDeploy nie cofa wdrożenia
    Zakładając, że hook postDeploy rzuca błąd
    Gdy wdrażam
    Wtedy wdrożenie pozostaje zapisane i uruchomione
    I w logu jest ostrzeżenie o błędzie hooka

  Scenariusz: Przekroczenie limitu czasu preDeploy
    Zakładając, że hook preDeploy nie kończy się i deploy.hookTimeout = 1000
    Gdy wdrażam
    Wtedy po upływie limitu odpowiedź ma status 503 i kod "deploy_hook_timeout" z czytelnym komunikatem
    I mutex zostaje zwolniony, a kolejne wdrożenie jest możliwe

  Scenariusz: Wywołanie wewnętrzne
    Gdy wdrożenie jest wywołane przez runtime API bez żądania HTTP
    Wtedy preDeploy otrzymuje source "internal"

  Scenariusz: Start runtime i przełączenie projektu bez hooków (R-15)
    Zakładając zarejestrowane preDeploy i postDeploy
    Gdy runtime wczytuje flow przy starcie procesu lub przy przełączeniu projektu
    Wtedy ani preDeploy, ani postDeploy nie są wywoływane
```

#### Testy
- `test/unit/@node-red/util/lib/hooks_spec.js`: `allows preDeploy and postDeploy hooks`, `still rejects unknown hooks`, `preDeploy handler rejecting with undefined rejects trigger`, `preDeploy handler resolving true does not reject`, `callback-style preDeploy handler is wrapped`, `other hooks keep invokeStack semantics (unchanged)`.
- `test/unit/@node-red/runtime/lib/api/flows_spec.js`, `describe("deploy hooks")` (`afterEach hooks.clear()`): `setFlows calls preDeploy then postDeploy`, `preDeploy rejection returns 400 deploy_rejected and does not save`, `preDeploy false rejects`, `preDeploy throwing does not crash`, `preDeploy timeout returns 503 deploy_hook_timeout and releases mutex` (R-15), `preDeploy rejected with undefined returns 400 deploy_rejected`, `preDeploy payload is frozen copy`, `postDeploy error is logged and deploy kept`, `postDeploy runs after response and outside lock`, `hooks called for addFlow/updateFlow/deleteFlow/reload`, `reload preDeploy sees loaded config`, `storage source skips preDeploy and calls postDeploy`, `rev mismatch skips preDeploy`, `no hooks registered – identical result`, `startup load and project switch do not call deploy hooks` (R-15).
- `test/unit/@node-red/runtime/lib/flows/index_spec.js`: `changedFlows derived from diff for nodes/flows deploy`, `order: save → stop → start → runtime-deploy → response → postDeploy` (stuby `storage.saveFlows`, zdarzenia).
- Kontraktowe `test/unit/@node-red/editor-api/lib/admin/flows_spec.js`, `flow_spec.js`: `rejected deploy returns 400 with code and message`, `source api and user passed`.
- Edytor: E2E/ręcznie – komunikat odrzucenia.

#### DoD specyficzne
- [ ] Payloady opisane w JSDoc `util/lib/hooks.js` i w dokumentacji (przykład walidatora w `settings.js`? – raczej w CHANGELOG/kontrakcie; **do potwierdzenia**).
- [ ] Test „brak hooków = brak zmian” dla wszystkich ścieżek.
- [ ] Kolejność zgodna z E-01, potwierdzona testem.
- [ ] `deploy.hookTimeout` (ZASADY §2.1) w szablonie `settings.js` (wspólny obiekt `deploy`), kody `deploy_rejected`/`deploy_hook_timeout` w kontrakcie Admin API.
- [ ] Owinięcie handlerów `preDeploy`/`postDeploy` pokryte testami (odrzucenie `undefined`, rozwiązanie `true`, styl callback); inne hooki bez zmian.

#### Ryzyka i alternatywy
- **Modyfikacja w `preDeploy` – rozstrzygnięte (R-15): nie, tylko walidacja.** Uzasadnienie: (1) rewizja i diff liczone z treści klienta – modyfikacja rozjechałaby stan edytora z runtime i każde kolejne wdrożenie kończyłoby się konfliktem; (2) audyt „kto co wdrożył” traci sens; (3) wiele hooków modyfikujących to niedeterministyczna kolejność; (4) transformacje należą do klienta/CI. Alternatywa (gdyby Zamawiający wymagał): osobny hook `transformDeploy` z obowiązkowym zwrotem zmian do klienta w odpowiedzi.
- **Moment `postDeploy` (rozstrzygnięty w ZASADY §2.3 A, krok 11):** `postDeploy` asynchronicznie **po** odpowiedzi HTTP i poza blokadą; w trybie `deploy.response:"stopped"` – po zakończeniu startu (odpowiedź wysłana wcześniej), w `"started"` – po odpowiedzi wysłanej po kroku 9. Błąd tylko w logu, nie cofa wdrożenia. Skutek: kolejne wdrożenie może zacząć się przed zakończeniem `postDeploy` poprzedniego – handler identyfikuje wdrożenie po `rev`. Alternatywa (odpowiedź po `postDeploy`) odrzucona – wolny hook wydłużałby wdrożenie.
- **`reload`:** odczyt przed hookiem realizuje wspólny mechanizm E-01 (`readFlowsFromStorage` + `deploy({loaded})`), współdzielony z Z-09 – Z-06 nie zmienia `flows.load`.
- **Semantyka `hooks.trigger`:** odrzucenie wartością `undefined` nie przerywa łańcucha, a rozwiązanie wartością ≠ `undefined` jest traktowane jak błąd – bez owinięcia handlerów (Projekt pkt 1) walidator zwracający `Promise.reject()` przepuściłby wdrożenie, a zwracający `true` – je odrzucił. Owinięcie ograniczone do hooków wdrożenia (bez zmiany zachowania istniejących hooków).
- `preDeploy` trzymający mutex blokuje wszystkie wdrożenia – stąd limit `deploy.hookTimeout`; anulowanie hooka niemożliwe (działa dalej w tle).
- Kopia konfiguracji przy dużych flow – koszt tylko przy zarejestrowanym `preDeploy`.

#### Podzadania
- [ ] `VALID_HOOKS` + JSDoc – S
- [ ] Owinięcie handlerów `preDeploy`/`postDeploy` (semantyka `invokeStack`) + testy – S
- [ ] `preDeploy` w potoku E-01 dla wszystkich ścieżek (+ `deploy.hookTimeout`, kopia zamrożona) – M
- [ ] `reload` (API: oba hooki na mechanizmie `loaded` z E-01; `source:"storage"`: tylko `postDeploy`) – S
- [ ] `postDeploy` asynchronicznie po odpowiedzi + `changedFlows` z diff + log błędów – M
- [ ] Edytor: komunikat `deploy_rejected` – S
- [ ] Testy (kolejność, odrzucenie, wyjątek, brak hooków) – M

---

### Z-07 – Automatyczne zdejmowanie tras HTTP węzła przy zamknięciu

| Pole | Wartość |
|---|---|
| Etap / typ | 2 / funkcja (nowe API, addytywne) + poprawka błędu (`http in`) |
| Priorytet / ryzyko | P2 / średnie (zmiana wewnętrzna `http in`, kolejność tras) |
| Ustawienie | brak (API addytywne; zmiana `http in` bez zmiany kontraktu); **bez przełącznika awaryjnego** (R-16); `rawBodyCapture` – osobnym ustawieniem poza tym pakietem (R-16) |
| Zależności | – |
| Pliki | `runtime/lib/nodes/Node.js:42,152-161,314-372`; `runtime/lib/nodes/index.js:133-140`; nowy `runtime/lib/nodes/httpRoutes.js`; `runtime/lib/index.js:94-101,349`; `registry/lib/util.js:102` (`httpNode: runtime.nodeApp`); `nodes/core/network/21-httpin.js:129-141,242-245,343-365`; `node-red/red.js:426-435` (montowanie `httpNode`) |
| Powiązania | K8S-T-007 (strumieniowanie HTTP – własne węzły tras korzystają z nowego API) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE + błąd.**
- Węzły dostają `RED.httpNode = runtime.nodeApp` (`registry/lib/util.js:102`, aplikacja express z `runtime/lib/index.js:94`), montowaną w `node-red/red.js:435` pod `httpNodeRoot` (wcześniej `httpNodeAuth`, `:426-431`). Trasy zarejestrowane przez węzeł nie są nigdy zdejmowane przez runtime.
- `http in` rejestruje trasę przez `RED.httpNode.<metoda>(url, cookieParser(), httpMiddleware, corsHandler, metricsHandler, [parsery], this.callback, this.errorHandler)` (`21-httpin.js:343-353`) i zdejmuje w `close` przez `RED.httpNode._router.stack.forEach(... routes.splice(i,1))` (`:357-365`):
  - `splice` w `forEach` pomija element następujący po usuniętym → przy dwóch kolejnych pasujących trasach druga zostaje (podwojenie trasy po ponownych wdrożeniach);
  - dopasowanie po ścieżce i metodzie, nie po węźle → zamknięcie jednego węzła usuwa trasy **innych** węzłów `http in` z tą samą metodą i ścieżką (np. wdrożenie `nodes`, gdzie drugi węzeł się nie zmienił) – wniosek z kodu, nieuruchamiany;
  - zależność od prywatnego `_router` (Express 4.22.2; w Express 5 `router`).
- `rawBodyCapture` (`:129-141`) dodawany przez `rootApp.use()` i przesuwany na początek `rootApp._router.stack` (aplikacja nadrzędna, także osadzająca) – jednorazowo przy ładowaniu modułu.
- `RED.httpNode.options("*", corsHandler)` przy `httpNodeCors` (`:242-245`) – trasa na poziomie modułu.
- **Brak testów `http in`:** w `test/nodes/core/network/` nie ma `21-httpin_spec.js` ani testu pod inną nazwą (jest `21-httprequest_spec.js`, który własnych serwerów używa bez `http in`). Kryterium „testy http in bez zmian” wymaga najpierw **napisania** testów regresji na kodzie 5.0.7.
- `node-red-node-test-helper` wywołuje `redNodes.init(mockRuntime)` z `nodeApp: express()` (`node_modules/node-red-node-test-helper/index.js:258-271`) – rejestr tras zainicjowany w `nodes.init` zadziała w testach węzłów; dostęp testu do `nodeApp` (supertest) – **do potwierdzenia** (helper `request()` kieruje do `httpAdmin`, `:400-401`).

#### Specyfikacja
- **Cel:** węzeł rejestruje trasę HTTP w swoim kontekście; runtime zdejmuje ją przy zamknięciu węzła, bez dostępu do prywatnych struktur Express.
- **Wejścia:** `node.registerHttpRoute(method, path, ...handlers)`; `method` ∈ `get|post|put|patch|delete|options|head|all` (bez rozróżniania wielkości liter); `path` – string lub RegExp (jak w Express); `handlers` – co najmniej jedna funkcja middleware/obsługi (także obsługa błędów `(err,req,res,next)`).
- **Wyjścia:** uchwyt `{ method, path, remove() }`; `remove()` idempotentne; po `remove()` lub zamknięciu węzła trasa nie obsługuje żądań.
- **Niezmienniki:**
  - `RED.httpNode.<metoda>()` działa bez zmian (trasy legacy nie są zdejmowane automatycznie);
  - trasa węzła istnieje dokładnie raz po wdrożeniu i ponownym wdrożeniu, po usunięciu węzła – wcale;
  - zamknięcie węzła zdejmuje **tylko jego** trasy;
  - kolejność obsługi tras zarejestrowanych przez API = kolejność rejestracji; ponowna rejestracja (po restarcie węzła) trafia na koniec listy – jak dziś (trasa dopisywana na koniec stosu);
  - `httpNodeAuth`, `httpNodeMiddleware`, `httpNodeCors`, `rawBodyCapture` działają jak dziś;
  - przy `httpNodeRoot: false` rejestracja się udaje, ale trasa jest nieosiągalna (aplikacja niezamontowana) – jak dziś.
- **Przypadki błędów:** nieznana metoda / brak handlera / `path` innego typu → `TypeError` synchronicznie (błąd programisty węzła); wyjątek w handlerze – obsługa Express jak dziś.
- **Skutki uboczne:** jeden dodatkowy middleware (dyspozytor) w `nodeApp`; trasy z API **nie są widoczne** w `nodeApp._router.stack` (zob. Ryzyka).

#### Projekt rozwiązania (minimalny)
1. Nowy moduł `runtime/lib/nodes/httpRoutes.js`:
   - `init(app)` – zapamiętuje `nodeApp`; dyspozytor montowany **leniwie** przy pierwszej rejestracji: `app.use(dispatch)` (pozycja w stosie = moment pierwszej rejestracji – zachowuje dzisiejszy układ: trasy ładowane przy module przed trasami węzłów);
   - lista `entries = [{nodeId, method, path, router}]`, gdzie `router = express.Router()` z jedną trasą `router[method](path, ...handlers)` (publiczne API Express 4 i 5 – obsługa parametrów, metod, `next('route')`, handlerów błędów bez zmian);
   - `dispatch(req,res,next)` – iteruje po **migawce** listy (bezpieczne przy zdejmowaniu w trakcie żądania), wywołując kolejne `router(req,res,nextEntry)`; błąd przekazany przez `next(err)` – dalej do następnych (jak w stosie Express), na końcu `next(err)`;
   - `register(node, method, path, handlers)` → uchwyt; `removeAll(nodeId)`.
2. `runtime/lib/nodes/index.js` `init(runtime)`: `httpRoutes.init(runtime.nodeApp)`.
3. `runtime/lib/nodes/Node.js`: `Node.prototype.registerHttpRoute = function(method, path, ...handlers)` (JSDoc); w `close()` – `httpRoutes.removeAll(this.id)` **przed** callbackami `close` (trasa przestaje przyjmować nowe żądania, zanim węzeł zwolni zasoby); wyjątek w zdejmowaniu logowany.
4. `21-httpin.js`:
   - rejestracja przez `node.registerHttpRoute(this.method, this.url, ...łańcuch)` – łańcuch handlerów identyczny jak dziś; zachowanie dla nieobsługiwanych metod bez zmian (brak rejestracji);
   - `close`: tylko `rawDataRoutes.delete(routeKey)`; usunięcie pętli po `_router.stack`;
   - zabezpieczenie: gdy `typeof node.registerHttpRoute !== "function"` (inna wersja runtime) – ścieżka dotychczasowa z poprawionym usuwaniem (iteracja od końca);
   - `rawBodyCapture`: **bez zmian funkcjonalnych** w tym pakiecie (R-16: `rawBodyCapture` osobnym ustawieniem – poza Z-07); dostęp do stosu przez `rootApp._router || rootApp.router` z ostrzeżeniem, gdy brak (przygotowanie pod Express 5). Pełne usunięcie zależności wymaga mechanizmu „middleware przed parserami” w aplikacji nadrzędnej (której runtime nie posiada przy osadzeniu) – osobne zadanie z własnym ustawieniem (R-16).
5. Dokumentacja API węzłów (JSDoc), CHANGELOG (w tym poprawka `splice`/usuwania cudzych tras).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Trasy HTTP w kontekście węzła

  Scenariusz: [odbiór] Trasa po wdrożeniu istnieje raz
    Zakładając flow z węzłem http in GET "/test" i http response
    Gdy wdrażam flow
    Wtedy GET /test zwraca odpowiedź flow
    I trasa jest zarejestrowana dokładnie raz

  Scenariusz: [odbiór] Ponowne wdrożenie nie dubluje trasy
    Gdy wdrażam ten sam flow ponownie (full) 3 razy
    Wtedy trasa GET /test jest zarejestrowana dokładnie raz
    I żądanie wywołuje przepływ dokładnie raz

  Scenariusz: [odbiór] Usunięcie węzła zdejmuje trasę
    Gdy usuwam węzeł http in i wdrażam
    Wtedy GET /test zwraca 404

  Scenariusz: Zamknięcie węzła nie zdejmuje tras innego węzła z tą samą ścieżką
    Zakładając dwa węzły http in GET "/test" w różnych flow
    Gdy zmieniam i wdrażam tylko pierwszy flow (typ "flows")
    Wtedy GET /test nadal jest obsługiwany

  Scenariusz: Uchwyt zdejmuje trasę
    Gdy węzeł rejestruje trasę przez node.registerHttpRoute("get", "/x", handler) i wywołuje remove() na uchwycie
    Wtedy GET /x zwraca 404
    I ponowne remove() nie zgłasza błędu

  Scenariusz: Stare API bez zmian
    Gdy moduł rejestruje trasę przez RED.httpNode.get("/legacy", handler)
    Wtedy trasa działa jak w wersji bazowej i nie jest zdejmowana przy zamknięciu węzłów

  Scenariusz: Niepoprawne wywołanie API
    Gdy węzeł wywołuje node.registerHttpRoute("fetch", "/x", handler)
    Wtedy zgłaszany jest TypeError

  Scenariusz: [odbiór] Zachowanie http in bez zmian (regresja)
    Zakładając zestaw testów regresji http in napisany i zielony na wersji bazowej
    Gdy uruchamiam go po zmianie
    Wtedy wszystkie przypadki przechodzą bez modyfikacji testów
    # GET z query, POST JSON/urlencoded/multipart/raw, skipBodyParsing, cookies, CORS, httpNodeMiddleware, parametry ścieżki, kod 500 z errorHandler

  Scenariusz: Kolejność middleware i tras zachowana
    Zakładając ustawione httpNodeMiddleware i httpNodeCors oraz węzeł http in POST "/raw" z skipBodyParsing
    I moduł rejestrujący przy ładowaniu trasę RED.httpNode.get("/early", handler)
    Gdy wdrażam flow z węzłem http in
    Wtedy rawBodyCapture działa przed trasami węzłów (POST /raw otrzymuje surowe ciało)
    I httpNodeMiddleware oraz obsługa CORS są wywoływane przed handlerem trasy węzła
    I trasa "/early" zarejestrowana przed pierwszym wdrożeniem jest obsługiwana przed trasami z registerHttpRoute
    I nowa trasa węzła nie wyprzedza middleware zarejestrowanych wcześniej
```

#### Testy
- **Regresja najpierw (na kodzie 5.0.7):** nowy `test/nodes/core/network/21-httpin_spec.js` – `GET passes query as payload`, `POST json body`, `POST urlencoded`, `POST multipart upload`, `POST raw text/binary`, `skipBodyParsing keeps raw buffer`, `path parameters in req.params`, `cookies parsed`, `httpNodeMiddleware invoked`, `httpNodeCors handles OPTIONS`, `missing url warns`, `http response sets status and headers`. (Dostęp do `nodeApp` przez obiekt `RED` modułu / helper – **do potwierdzenia**.)
- Nowe w tym samym pliku: `redeploy keeps single route`, `removing node removes route`, `closing one node keeps same-path route of another node` (czerwony na 5.0.7), `splice skip regression – three consecutive matching routes removed` (czerwony na 5.0.7), `rawBodyCapture runs before node routes`, `httpNodeMiddleware and CORS run before node route handler`, `module-level routes registered before first deploy keep precedence`.
- `test/unit/@node-red/runtime/lib/nodes/httpRoutes_spec.js` (nowy): `registers route on first use`, `dispatches in registration order`, `remove() is idempotent`, `removeAll removes only node routes`, `removal during in-flight request is safe`, `error handlers receive errors`, `rejects invalid method/handler`.
- `test/unit/@node-red/runtime/lib/nodes/Node_spec.js`: `registerHttpRoute returns handle`, `close removes node routes before close callbacks`, `close continues when route removal throws`.

#### DoD specyficzne
- [ ] Testy regresji `http in` napisane i zielone **przed** zmianą (dowód: przebieg na 5.0.7), bez zmian po zmianie.
- [ ] Brak odwołań do `_router` w ścieżce rejestracji/zdejmowania tras (`grep`).
- [ ] JSDoc `Node.prototype.registerHttpRoute`; CHANGELOG z poprawką usuwania tras.
- [ ] Brak nowych zależności (`express` już jest zależnością runtime).

#### Ryzyka i alternatywy
- **Widoczność tras w `_router.stack`:** moduły zewnętrzne odczytujące trasy `http in` ze stosu (np. generatory dokumentacji API korzystające z właściwości `swaggerDoc`) przestaną je widzieć – **do potwierdzenia** na popularnych modułach. Łagodzenie: funkcja `httpRoutes.list()` (odczyt). Przełącznik awaryjny przywracający dotychczasową rejestrację `http in` – **odrzucony (R-16)**; ryzyko opisane w CHANGELOG.
- **Kolejność tras:** trasy z API obsługiwane w pozycji dyspozytora; trasa legacy zarejestrowana przez inny węzeł **po** pierwszym wdrożeniu znajdzie się za dyspozytorem (dziś byłaby przeplatana wg czasu rejestracji). Konflikt tej samej ścieżki między `http in` a trasą legacy może zmienić zwycięzcę – opis w CHANGELOG, test regresji.
- **Alternatywa:** osobny `express.Router` na węzeł montowany przez `app.use(router)` – nadal wymaga zdjęcia warstwy ze stosu (dostęp do `_router`); odrzucona. Alternatywa 2: dyspozytor z własnym dopasowaniem ścieżek (mapa) – duplikuje logikę Express (parametry, RegExp); odrzucona.
- `rawBodyCapture` nadal zależy od prywatnego stosu aplikacji nadrzędnej – ryzyko przy Express 5 pozostaje (osobne zadanie z osobnym ustawieniem – R-16).

#### Podzadania
- [ ] Testy regresji `http in` na 5.0.7 – M
- [ ] `httpRoutes.js` (dyspozytor, uchwyty) + testy – M
- [ ] `Node.prototype.registerHttpRoute` + zdejmowanie w `close()` – S
- [ ] Migracja `http in` + fallback + przygotowanie `rawBodyCapture` – S
- [ ] JSDoc, CHANGELOG – S

---

## Pytania do Zamawiającego (etap 2)

1. **Z-03 – zakres:** czy akceptujecie skorygowany zakres (aktualizacja jest już wykrywana; do zrobienia: semver, poprzednia wersja i źródło w hookach, brak pozostawionych plików, komunikaty, ujednolicenie ustawień uploadu)? **Rozstrzygnięte (R-17):** zakres skorygowany zaakceptowany (`upload_not_allowed`, `module_downgrade_not_allowed`, walidacja typu/semver, pola hooków, brak pozostawionych plików).
2. **Z-03 – obniżenie wersji:** ZASADY §2.1 proponuje `externalModules.palette.allowDowngrade: false` (domyślnie blokowane – zmiana względem dziś, gdy starsza wersja jest instalowana jako „upgrade”). Akceptacja wartości domyślnej `false`, czy `true` (zgodność wstecz, tylko ostrzeżenie)? **Rozstrzygnięte (R-17; wcześniej „Już rozstrzygnięte”):** `allowDowngrade` domyślnie `true` (zachowanie 5.0.6, klasyfikacja `downgrade` z ostrzeżeniem); `false` → 400 `module_downgrade_not_allowed`.
3. **Z-03 – potwierdzenie przed instalacją:** czy wymagane (wymaga dwuetapowego API `dryRun` – scenariusz warunkowy w karcie, dodatkowe podzadanie M), czy wystarczy komunikat po instalacji (zakres minimalny)? **Rozstrzygnięte (R-17):** bez `dryRun` – wystarczy komunikat po instalacji.
4. **Z-03 – ustawienia uploadu:** czy kanoniczne `externalModules.palette.allowUpload` z dwoma przestarzałymi aliasami jest akceptowalne? **Rozstrzygnięte (R-17):** kanoniczne `externalModules.palette.allowUpload` + aliasy, których użycie daje ostrzeżenie w logu.
5. **Z-04 – `configs` vs `globalConfigs`:** zgoda na nowe pole `globalConfigs[]` (istniejące `configs` = configi flow, bez zmiany znaczenia)? **Rozstrzygnięte (R-13, D-08):** nowe pole `globalConfigs[]`; `configs` bez zmiany znaczenia.
6. **Z-04 – transport rewizji:** `rev` w treści tylko przy `Node-RED-API-Version: v2` (ochrona klientów GET→PUT) czy zawsze? Czy zamiast/obok tego `ETag`/`If-Match`? **Rozstrzygnięte (R-13, D-09):** `rev` tylko przy v2 + nagłówek `ETag`; v1 bez zmian.
7. **Z-04 – tworzenie pod id:** odpowiedź 200 `{id}` czy 201? Jakie ograniczenia formatu id (np. tylko `[a-z0-9.-_]`)? **Rozstrzygnięte (R-13, R-34):** 201 tylko w v2 (v1 – 200) dla `POST /flow` i `PUT /flow/:id` tworzącego (przy `deploy.putCreatesFlow: true`); id z `POST` – 16 hex. Ograniczenia formatu id przy `PUT` – R-34 ich nie określa (zob. Ryzyka Z-04).
8. **Z-04 – `globalRev`:** czy ochrona globalnych configów osobną rewizją jest potrzebna (rewizja flow celowo ich nie obejmuje)? **Rozstrzygnięte (R-13):** `globalRev` – tak.
9. **Z-05 – macierz:** v1 przy wymogu zawsze 409 czy nagłówek z rewizją? Czy `DELETE /flow/:id` wymaga `?rev=`? Czy `reload` zwolniony? **Rozstrzygnięte (R-14):** v1 przy wymogu → zawsze 409 `version_required` (bez nagłówka); `DELETE /flow/:id` wymaga `?rev=`; `reload` zwolniony.
10. **Z-05 – edytor:** propozycja D-12 (ANALIZA §7): przy wymogu rewizji „Overwrite” wysyła aktualną rewizję po potwierdzeniu w oknie; w `reload-only` niedostępne – prosimy o zatwierdzenie. **Rozstrzygnięte (R-12, D-12):** zatwierdzone – „Overwrite” wysyła aktualną rewizję po potwierdzeniu; w `reload-only` ukryty.
11. **Z-06 – modyfikacja w `preDeploy`:** potwierdzenie rekomendacji „tylko walidacja, bez modyfikacji”. **Rozstrzygnięte (R-15):** `preDeploy` tylko walidacja (400 `deploy_rejected`).
12. **Z-06 – limit czasu i moment `postDeploy`:** czy `deploy.hookTimeout` (30 s, ZASADY §2.1) jest akceptowalny? Prosimy o zatwierdzenie propozycji ZASADY §2.3: `postDeploy` asynchronicznie po odpowiedzi (także w trybie P-01 `started`), błąd tylko w logu. **Rozstrzygnięte (R-15):** `deploy.hookTimeout` 30 s, przekroczenie → **503** `deploy_hook_timeout`; `postDeploy` asynchronicznie, błąd tylko w logu.
13. **Z-06 – zakres ścieżek:** czy start runtime i przełączenie projektu mają wywoływać hooki (rekomendacja: nie – to nie wdrożenia)? **Rozstrzygnięte (R-15):** bez hooków przy starcie procesu i operacjach Projektów.
14. **Z-07 – zgodność:** czy wymagany przełącznik awaryjny przywracający dotychczasową rejestrację `http in` (moduły czytające `_router.stack`)? Czy usunięcie zależności `rawBodyCapture` od `_router` ma być w tym pakiecie, czy osobno? **Rozstrzygnięte (R-16):** bez przełącznika awaryjnego; `rawBodyCapture` osobnym ustawieniem (poza Z-07).
15. **Z-04 – kod `invalid_node_type`:** kod nie występuje w katalogu ZASADY §2.4. Dopisać go do katalogu (400, Z-04) czy użyć istniejącego `invalid_request` dla `globalConfigs[]` z typem `tab`/`subflow`/`group`? **Rozstrzygnięte (przed rejestrem – „Już rozstrzygnięte”: kod `invalid_node_type` w katalogu):** kod dopisany do katalogu ZASADY §2.4 (400, Z-04).

## Zmiany po przeglądzie

Poprawki z [../PRZEGLAD.md](../PRZEGLAD.md) („Lista poprawek do naniesienia”), zgodnie z zaktualizowanymi ZASADY §2.1/§2.3/§2.4 i ANALIZA §4.9, §6.2, §7:

- **#1** – Z-06: Ryzyka i Projekt pkt 4 – `postDeploy` asynchronicznie po odpowiedzi, poza blokadą, błąd tylko w logu (ZASADY §2.3 A, krok 11); Niezmienniki, scenariusz „Kolejność wywołań” i test kolejności poprawione (`runtime-deploy` → odpowiedź → `postDeploy`); nowy scenariusz „postDeploy nie wstrzymuje odpowiedzi ani kolejnych wdrożeń”.
- **#3** – „Kolejność realizacji”: Z-04 → Z-05 → Z-06 (Z-05 zależy od Z-04), dwa tory wg ANALIZA §6.2 (tor B: Z-03 → Z-07); zależności Z-05 w tabeli i karcie zgodne.
- **#4** – Z-05: integracja edytora (wymuszone nadpisanie wg D-12, `version_required`) dotyka `deploy.js` po scaleniu P-02; P-02 → Z-05 tylko miękko (brak cyklu); nowy scenariusz „Overwrite niedostępny w reload-only”; Pytanie 10 → zatwierdzenie D-12.
- **#5** – Z-06: zależność od Z-09 zastąpiona „punktem integracji wykorzystywanym przez Z-09” (tabela, karta).
- **#6** – Z-06 Projekt pkt 3: jawny `reload` przez API → `preDeploy` i `postDeploy`; przeładowanie z magazynu → tylko `postDeploy` (`source:"storage"`); własny mechanizm „odczyt przed hookiem” usunięty na rzecz mechanizmu E-01 (`readFlowsFromStorage` + `deploy({loaded})`); scenariusze i testy obu ścieżek; `source` ujednolicone do `api|internal|storage`.
- **#15** – oznaczenie `[odbiór]` w scenariuszach Z-03, Z-04, Z-05, Z-06, Z-07 + objaśnienie konwencji pod „Kolejnością realizacji”.
- **#16** – Z-03: scenariusz warunkowy „Potwierdzenie w edytorze przed instalacją” (po decyzji o `dryRun`, Pytanie 3), warunkowe podzadanie i test.
- **#19 (Z-03)** – `upload_not_allowed` zdefiniowany jako nowy kod 400 (ZASADY §2.4) w Specyfikacji, Projekcie, BDD, Testach, DoD, Ryzykach; usunięte „kody bez zmian”.
- **#22** – Z-05: poprawka `deploy.js:390` (`nns`) tylko jako odwołanie do P-02 (Weryfikacja, Projekt, BDD, Testy, DoD, Podzadania).
- **#25** – Z-06: semantyka `invokeStack` (odrzucenie `undefined` nie przerywa łańcucha; rozwiązanie wartością ≠ `undefined` = błąd) w Weryfikacji; owinięcie handlerów hooków wdrożenia w Projekcie pkt 1; scenariusze, testy, DoD, Ryzyko, podzadanie.
- **#29** – Z-06: szacunek „M–L” → L.
- **#31** – Z-07: scenariusz „Kolejność middleware i tras zachowana” (rawBodyCapture przed trasami węzłów, middleware przed trasą węzła, trasy modułu przed dyspozytorem) i testy.
- **Ustawienia (ZASADY §2.1):** `deploy.hookTimeout: 30000` (Z-06, bez „opcjonalnie/do potwierdzenia”); `externalModules.palette.allowDowngrade: false` (Z-03 – wartość domyślna wg §2.1; skutek zmiany zachowania opisany w Ryzykach, Pytanie 2 przeformułowane).
- **Kody (ZASADY §2.4):** `deploy_hook_timeout` 400 (Z-06), `invalid_revision` 400 dopisany do Z-04 (używany w Z-05); `invalid_node_type` (Z-04) spoza katalogu – oznaczony „do decyzji”, Pytanie 15.
- **Spójność z E-01:** Z-04 rozszerza funkcje `build*FlowConfig` wydzielone w E-01 (Projekt pkt 1, Zależności, Podzadania); Z-06 korzysta z funkcji potoku `deploy(opts)`.

## Zmiany po decyzjach (2026-10-03)

Naniesione decyzje z [../REJESTR-DECYZJI.md](../REJESTR-DECYZJI.md):

- **Pytania 1–15** – dopisane rozstrzygnięcia (R-12, R-13, R-14, R-15, R-16, R-17; p.15 – decyzja sprzed rejestru).
- **Z-03 (R-17):** zakres skorygowany zatwierdzony; `allowDowngrade` domyślnie **`true`** (Ustawienie, Specyfikacja, BDD – scenariusz `[odbiór]` przeformułowany: domyślnie instalacja jako `downgrade` z ostrzeżeniem, blokada przy `false`; testy, Ryzyka); `dryRun` odrzucony (usunięty scenariusz warunkowy, test i podzadanie M); aliasy ustawień uploadu z ostrzeżeniem w logu (Projekt pkt 4, nowy szablon scenariusza, test, DoD, podzadanie). Szacunek bez zmian (M; odpada warunkowe M za `dryRun`).
- **Z-04 (R-13, R-02):** `GET /flow/:id` v2 – `rev` + nagłówek `ETag`, v1 bez zmian; `POST /flow` → **201** z id 16 hex (zmiana statusu względem 5.0.7 – Niezmienniki, kontrakt, BDD, testy, DoD, Ryzyka); `globalRev` potwierdzone; `invalid_node_type` w katalogu; właściwości układu w API flow niezależne od `editorTheme.flowLayout.enabled` (R-02).
- **Z-05 (R-14, R-12):** macierz – v1 → 409 `version_required` (nagłówek odrzucony), `DELETE /flow/:id` z `?rev=`, `reload` zwolniony; Overwrite wg D-12, ukryty w `reload-only`.
- **Z-06 (R-15):** `deploy_hook_timeout` **400 → 503** (Wyjścia, Przypadki błędów, BDD, testy); bez hooków przy starcie procesu i operacjach Projektów (nowy scenariusz i test); modyfikacja w `preDeploy` – odrzucona.
- **Z-07 (R-16):** bez przełącznika awaryjnego `http in`; `rawBodyCapture` – osobnym ustawieniem poza pakietem.
- **Z-04 (R-34):** 201 **tylko w v2** – v1 nadal 200 (usunięty wyjątek z Niezmienników i scenariusza `[odbiór]`); `PUT /flow/:id` tworzący tylko przy `deploy.putCreatesFlow: true` – 201 w v2 / 200 w v1, bez ustawienia 404; w v2 `If-Match: <ETag>` równoważne `rev`, sprzeczne → 400 (Wejścia, Wyjścia, Przypadki błędów, kontrakt, Projekt pkt 3, 5 scenariuszy BDD, testy kontraktowe, DoD, Ryzyka, Pytanie 7, podzadanie).
