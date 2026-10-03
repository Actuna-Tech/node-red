# Backlog – etap 2 (Z-03–Z-07)

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.
> Zasady, szablon karty i wspólne DoD: [../ZASADY.md](../ZASADY.md). Fakty z kodu: [../WERYFIKACJA.md](../WERYFIKACJA.md).
> Ścieżki kodu względem `packages/node_modules/`, ścieżki testów względem katalogu repozytorium.

## Podsumowanie

| ID | Tytuł | Typ | Priorytet | Ryzyko | Zależności | Szacunek |
|---|---|---|---|---|---|---|
| Z-03 | Aktualizacja paczki wgrywanej jako `.tgz` (zakres skorygowany) | funkcja + poprawka błędu | P3 | niskie | – | M |
| Z-04 | Pełne API pojedynczego flow (rewizja, tworzenie pod id, globalne configi) | funkcja | P1 | wysokie | E-01, FL-B-001 (zachować) | L |
| Z-05 | Wymóg rewizji przy każdym wdrożeniu | funkcja | P1 | średnie | E-01, Z-04 (rewizja flow), P-02 (edytor) | M |
| Z-06 | Hooki wdrożenia `preDeploy` / `postDeploy` w `RED.hooks` | funkcja | P1 | średnie | E-01, P-01 (moment `postDeploy`), Z-04/Z-05 (kolejność) | M–L |
| Z-07 | Automatyczne zdejmowanie tras HTTP węzła przy zamknięciu | funkcja + poprawka błędu | P2 | średnie | – | M |

Kolejność realizacji: E-01 → Z-04 → Z-05 → Z-06 (wspólne funkcje potoku wdrożenia); Z-03 i Z-07 niezależne.

---

### Z-03 – Aktualizacja paczki wgrywanej jako `.tgz`

> **Zakres skorygowany – do potwierdzenia przez Zamawiającego.** Opis zlecenia („menedżer palety nie
> rozpoznaje nowszej wersji”) nie zgadza się z kodem: aktualizacja **jest** wykrywana. Karta opisuje
> to, czego faktycznie brakuje.

| Pole | Wartość |
|---|---|
| Etap / typ | 2 / funkcja + poprawka błędu (porównanie wersji, pozostawiony plik `.tgz`) |
| Priorytet / ryzyko | P3 / niskie |
| Ustawienie | brak nowego przełącznika funkcji; ujednolicenie istniejących: kanoniczne `externalModules.palette.allowUpload` (dziś także `externalModules.palette.upload`, `editorTheme.palette.upload`); opcjonalnie `externalModules.palette.allowDowngrade` (domyślnie `true` = zachowanie jak dziś) – **do decyzji** |
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
  - edytor: przed wysłaniem pliku – brak zmian (nazwa/wersja z pliku nieznana bez rozpakowania po stronie klienta); po odpowiedzi – komunikat sukcesu zależny od `operation`; przy błędzie – czytelny komunikat z kodem.
- **Niezmienniki:** nowa instalacja (moduł nieznany) działa jak dziś; listy `allowList/denyList/allowUpdateList/denyUpdateList` i `allowUpdate` obowiązują jak dziś (aktualizacja z pliku podlega `allowUpdate`); porównanie wersji wg semver; przy odrzuceniu na dysku **nie zostaje** nowy plik `.tgz` i istniejący plik nie jest nadpisywany.
- **Przypadki błędów:**
  - ta sama wersja (także równa `pending_version`) → 400 `module_already_loaded`, komunikat „Moduł <nazwa> w wersji <wersja> jest już zainstalowany”;
  - starsza wersja → przy `allowDowngrade !== false` – instalacja jako `operation:"downgrade"` z ostrzeżeniem w logu i w edytorze; przy `allowDowngrade:false` → 400 `module_downgrade_not_allowed` (**do decyzji**, zob. pytania);
  - wersja niebędąca poprawnym semver → porównanie tekstowe jak dziś (`!==`) i `operation:"upgrade"` (zachowanie dotychczasowe), ostrzeżenie w logu;
  - upload wyłączony którymkolwiek z trzech ustawień → 400 jak dziś (kody bez zmian).
- **Skutki uboczne:** zapis pliku `.tgz` przenosi się **za** klasyfikację wersji; dziennik audytu `nodes.install` dostaje `operation`.

#### Projekt rozwiązania (minimalny)
1. `installer.js`: nowa funkcja `classifyUpload(moduleInfo)` → `{operation, previousVersion}` z użyciem `semver.valid/semver.gt/semver.eq`; porównanie z `pending_version || version` z `registry.getModuleInfo`.
2. `installTarball`: kolejność `getTarballModuleInfo` → `classifyUpload` → (odrzucenie bez zapisu) → `fs.outputFile` → `installModule(..., {source:"upload", previousVersion})`; usunięcie martwej zmiennej `isUpdate`.
3. `installModule(module, version, url, opts)` – czwarty, opcjonalny parametr (stare wywołania bez zmian); `previousVersion = info && info.version`; `source` wyliczane, gdy nie podano; dodanie pól do `triggerPayload`; dla wersji niższej przy `opts.source === "upload"` – log „downgrading” (nowy klucz w `runtime/locales/en-US/runtime.json`). Wynik: dołączenie `operation`, `previousVersion` do obiektu zwracanego z `reportAddedModules` / `setModulePendingUpdated` (kopie, bez zmiany rejestru).
4. Ujednolicenie ustawień: funkcja `isUploadAllowed(settings)` w jednym miejscu (np. `registry/lib/installer.js`, eksport), honorująca wszystkie trzy nazwy (każde `false` wyłącza); w szablonie `settings.js` udokumentowane tylko `externalModules.palette.allowUpload`, pozostałe dwie jako przestarzałe aliasy w JSDoc i CHANGELOG.
5. Edytor `palette-editor.js`: `.done(function(info){…})` – `RED.notify` z tekstem zależnym od `info.operation` (nowe klucze `palette.editor.uploaded.install|upgrade|downgrade` w `locales/en-US/editor.json`); w `.fail` – komunikat wg `responseJSON.code`.
6. JSDoc hooków `preInstall/postInstall` (`util/lib/hooks.js` – opis pól payloadu) i CHANGELOG.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Wgrywanie paczki .tgz modułu już zainstalowanego

  Tło:
    Zakładając, że moduł "node-red-contrib-x" w wersji "1.2.0" jest zainstalowany przez użytkownika
    I upload paczek jest dozwolony

  Scenariusz: Nowsza wersja jest instalowana jako aktualizacja
    Gdy wgrywam plik .tgz z package.json w wersji "1.3.0" przez POST /nodes
    Wtedy odpowiedź ma status 200 i zawiera operation "upgrade" oraz previousVersion "1.2.0"
    I hook preInstall otrzymuje previousVersion "1.2.0", isUpgrade true i source "upload"
    I hook postInstall otrzymuje te same pola
    I edytor pokazuje komunikat o aktualizacji do wersji "1.3.0" z informacją o wymaganym restarcie

  Scenariusz: Ta sama wersja jest odrzucana z czytelnym komunikatem
    Gdy wgrywam plik .tgz w wersji "1.2.0"
    Wtedy odpowiedź ma status 400 i kod "module_already_loaded"
    I komunikat zawiera nazwę modułu i wersję "1.2.0"
    I w katalogu nodes nie powstaje ani nie zmienia się żaden plik .tgz
    I hook preInstall nie jest wywoływany

  Scenariusz: Starsza wersja jest rozpoznawana jako obniżenie wersji
    Gdy wgrywam plik .tgz w wersji "1.1.0"
    Wtedy wynik zawiera operation "downgrade" i previousVersion "1.2.0"
    I edytor pokazuje ostrzeżenie o obniżeniu wersji

  Scenariusz: Obniżenie wersji zablokowane ustawieniem
    Zakładając, że externalModules.palette.allowDowngrade jest false
    Gdy wgrywam plik .tgz w wersji "1.1.0"
    Wtedy odpowiedź ma status 400 i kod "module_downgrade_not_allowed"
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
    Wtedy odpowiedź ma status 400
    Przykłady:
      | ustawienie                              |
      | externalModules.palette.allowUpload     |
      | externalModules.palette.upload          |
      | editorTheme.palette.upload              |
```

#### Testy
- `test/unit/@node-red/registry/lib/installer_spec.js`, nowy `describe("installs module from tarball")` (stuby `getTarballModuleInfo`/`fs.outputFile`/`exec.run`, wzorzec hooków `:287-353`):
  `installs newer version as upgrade and passes previousVersion to hooks`, `rejects same version without writing tarball`, `rejects version equal to pending_version`, `classifies older version as downgrade`, `rejects downgrade when allowDowngrade is false`, `falls back to string comparison for non-semver versions`, `keeps existing tarball when same version uploaded`, `removes previous tarball after successful upgrade`, `upgrade from tarball respects allowUpdate`.
- `test/unit/@node-red/runtime/lib/api/nodes_spec.js`: `addModule with tarball returns operation and previousVersion`, `addModule with tarball rejected when upload disabled (each setting name)`.
- `test/unit/@node-red/editor-api/lib/admin/nodes_spec.js` (kontrakt API, supertest + multipart): `POST /nodes with tarball returns upgrade result`, `POST /nodes with tarball of same version returns 400 module_already_loaded`, `POST /nodes with tarball ignored when editorTheme.palette.upload is false`.
- Edytor: test ręczny/E2E (brak infrastruktury testów jednostkowych `palette-editor.js`) – zrzut komunikatów dla trzech przypadków.

#### DoD specyficzne
- [ ] Zakres skorygowany zatwierdzony przez Zamawiającego (w tym decyzja o `allowDowngrade`).
- [ ] Brak nowej zależności (użyty istniejący `semver`).
- [ ] Odrzucenie nie zostawia plików w `<userDir>/nodes` (test).
- [ ] Hooki: nowe pola opisane w JSDoc; stare pola bez zmian (test równości kluczy + nowe).
- [ ] Aliasy ustawień uploadu opisane w CHANGELOG jako przestarzałe.

#### Ryzyka i alternatywy
- Odrzucanie obniżenia wersji domyślnie byłoby zmianą zachowania – stąd propozycja ustawienia z wartością domyślną zgodną z dziś (`true`). Alternatywa: brak ustawienia, tylko klasyfikacja i ostrzeżenie.
- Potwierdzenie w edytorze **przed** instalacją wymagałoby rozpakowania paczki w przeglądarce albo dwuetapowego API (`POST /nodes?dryRun=true` → potwierdzenie → instalacja). Poza zakresem minimalnym – **pytanie** do Zamawiającego.
- Moduły z wersjami spoza semver (rzadkie) – zachowanie dotychczasowe.

#### Podzadania
- [ ] Testy czerwone ścieżki tarball (installer, api, admin) – M
- [ ] `classifyUpload` + przeniesienie zapisu pliku + pola hooków – S
- [ ] Ujednolicenie ustawień uploadu + szablon + CHANGELOG – S
- [ ] Edytor: komunikaty `.done/.fail` + teksty en-US – S

---

### Z-04 – Pełne API pojedynczego flow

| Pole | Wartość |
|---|---|
| Etap / typ | 2 / funkcja |
| Priorytet / ryzyko | P1 / wysokie (kontrakt Admin API, te same funkcje co P-01/Z-05/Z-06/FL-B-001) |
| Ustawienie | `deploy.putCreatesFlow: false` (propozycja zlecenia: `flows.putCreates`) |
| Zależności | E-01 (wspólny potok wdrożenia); FL-B-001 – zachować `copyFlowLayoutProperties` |
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
  - `PUT /flow/:id` – treść jak dziś + opcjonalnie `rev` (rewizja flow), `globalConfigs[]`, `globalRev` (rewizja `global`);
  - `POST /flow` – treść jak dziś + opcjonalnie `globalConfigs[]`, `globalRev`;
  - ustawienie `deploy.putCreatesFlow`.
- **Wyjścia:**
  - `GET /flow/:id` z `v2` → obiekt flow + `rev`; z `v1` – bez zmian (bez `rev`, zob. Ryzyka – „round-trip”);
  - `PUT /flow/:id` → 200 `{id}` jak dziś; przy `v2` dodatkowo `rev` (nowa rewizja flow) i `revAll` (rewizja całości) – **nazwy do potwierdzenia**;
  - `POST /flow` → 200 `{id}` jak dziś (+ `rev` przy `v2`).
- **Niezmienniki:**
  - wywołania bez nowych pól i bez nagłówka `v2` dają te same odpowiedzi i skutki co w 5.0.7;
  - rewizja flow zmienia się **wyłącznie** przy zmianie treści tego flow (zmiana innego flow, globalnego configu ani subflow jej nie zmienia); rewizja całości liczona jak dziś;
  - kontrola rewizji i zmiana stanu w **jednej** sekcji krytycznej (istniejący mutex `api/flows.js`), zgodnie z krokiem 2 E-01;
  - `copyFlowLayoutProperties` (FL-B-001) działa we wszystkich ścieżkach, także w tworzeniu pod id;
  - istniejące pole `configs` zachowuje znaczenie „configi przypisane do flow” (`z = id`).
- **Przypadki błędów:**
  - `rev` niezgodna → 409 `version_mismatch` (istniejący kod, `editor-api/lib/util.js:42-58`), bez zapisu;
  - `globalRev` niezgodna → 409 `version_mismatch`;
  - PUT nieistniejącego id przy `putCreatesFlow:false` → 404 `not_found` (jak dziś);
  - PUT nieistniejącego id przy `putCreatesFlow:true`, gdy id zajmuje inny węzeł (nie `tab`) lub id = `"global"`/subflow → 400 `invalid_flow_id`;
  - PUT tworzący z `rev` innym niż `null` → 409 `version_mismatch` (flow nie istnieje); `rev:null` = „utwórz tylko, jeśli nie istnieje” – przy istniejącym flow → 409;
  - `globalConfigs[i]` z id węzła należącego do **innego flow** lub do tego flow (nie-globalnego) → 400 `duplicate_id` (komunikat z id i flow); typ `tab`, `subflow`, `group` → 400 `invalid_node_type`;
  - id węzła z `nodes[]` używane w innym flow → 400 `duplicate_id` (także dla `PUT`, dziś niesprawdzane – zob. weryfikacja).
- **Skutki uboczne:** aktualizacja globalnego configu restartuje węzły go używające także w innych flow (diff typu `flows`); zapis do magazynu i zdarzenie `runtime-deploy` jak dziś; audyt `flow.update`/`flow.add` z polami `created:true`, `globalConfigs:[ids]`.

#### Kontrakt Admin API (fragment)

| Endpoint | Metoda | Treść / nagłówki | Odpowiedzi | Zmiana względem 5.0.6 |
|---|---|---|---|---|
| `/flow/:id` | GET | `Node-RED-API-Version: v1` (domyślnie) | 200 obiekt flow; 404 `not_found` | brak |
| `/flow/:id` | GET | `Node-RED-API-Version: v2` | 200 obiekt flow + `rev`; 404 | **nowe** (addytywne, tylko v2) |
| `/flow/:id` | PUT | flow jak dziś | 200 `{id}`; 400; 404 `not_found` | brak |
| `/flow/:id` | PUT | + `rev` | 200 `{id[, rev, revAll]}`; 409 `version_mismatch` | **nowe** pole opcjonalne |
| `/flow/:id` (nieistniejące) | PUT | flow, `deploy.putCreatesFlow:true`, opcjonalnie `rev:null` | 200 `{id}` (flow utworzony pod tym id); 400 `invalid_flow_id`; 409 | **nowe** za ustawieniem (domyślnie 404 jak dziś) |
| `/flow/:id` | PUT | + `globalConfigs[]`, opcjonalnie `globalRev` | 200; 400 `duplicate_id` / `invalid_node_type`; 409 | **nowe** pole opcjonalne |
| `/flow` | POST | flow (+ `globalConfigs[]`, `globalRev`) | 200 `{id[, rev]}`; 400; 409 | **nowe** pola opcjonalne; id nadal nadawane przez serwer |
| `/flow/global` | GET/PUT | jak dziś (+ `rev` jak wyżej) | jak dziś | rewizja jak dla każdego flow |
| `/flow/:id` | DELETE | – (opcjonalnie `?rev=` – Z-05) | 204; 404; 409 | zob. Z-05 |
| `/flows` | GET/POST | bez zmian | bez zmian | brak (rewizja całości bez zmian) |

Pełny dokument kontraktu (przykłady żądań/odpowiedzi) – w katalogu dostarczenia pakietu i w JSDoc `runtime/lib/api/flows.js`; lokalizacja docelowa **do potwierdzenia**.

#### Projekt rozwiązania (minimalny)
1. `runtime/lib/flows/index.js`:
   - `getFlowRevision(id)` – rewizja wg definicji (z `activeConfig.flows`, `jsonClone` + usunięcie `credentials`); eksport;
   - wydzielenie budowania konfiguracji z `addFlow`/`updateFlow` do czystych funkcji `buildAddFlowConfig(flow)` / `buildUpdateFlowConfig(id, flow, {create})` (krok potrzebny także dla E-01/Z-06 – hook `preDeploy` widzi wynikową konfigurację); wspólne `buildTabNode(id, flow)` z `copyFlowLayoutProperties` (FL-B-001 bez zmiany zachowania);
   - `applyGlobalConfigs(newConfig, globalConfigs)` – upsert po id: istniejący węzeł bez `z` → zastąpienie; nowy → dodanie bez `z`; konflikt → błąd `duplicate_id`;
   - sprawdzenie duplikatów id w `updateFlow` (względem węzłów spoza flow).
2. `runtime/lib/api/flows.js`: w `addFlow`/`updateFlow` (wewnątrz mutexu): kontrola `opts.flow.rev` i `globalRev` przed budową konfiguracji; `putCreatesFlow` z `runtime.settings.get("deploy")` (bez wyjątku przy braku obiektu); mapowanie błędów (`404`, `400`, `409`) – spójnie z E-01; `getFlow` dołącza `rev` gdy `opts.apiVersion === "v2"`.
3. `editor-api/lib/admin/flow.js`: odczyt `Node-RED-API-Version` (walidacja `^v[12]$` jak `admin/flows.js:25-27`), przekazanie `apiVersion`; usunięcie `rev`, `globalRev`, `globalConfigs` z obiektu flow przed zapisem (nie trafiają do węzła `tab`).
4. `node-red/settings.js`: zakomentowany blok `deploy: { putCreatesFlow: false }` (wspólny obiekt z P-01/Z-05) w sekcji Runtime Settings z opisem.
5. JSDoc `runtime/lib/api/flows.js` (nowe opcje), CHANGELOG, dokument kontraktu.

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Pełne API pojedynczego flow

  Scenariusz: Stare wywołania działają bez zmian
    Zakładając domyślne ustawienia
    Gdy wykonuję GET, POST, PUT i DELETE /flow tak jak w wersji 5.0.6 (bez nagłówka v2 i nowych pól)
    Wtedy statusy, treści odpowiedzi i zapisane flow są identyczne jak w wersji bazowej
    I PUT /flow/:id dla nieistniejącego id zwraca 404 "not_found"
    I POST /flow nadaje nowe id

  Scenariusz: GET zwraca rewizję flow
    Gdy wykonuję GET /flow/t1 z nagłówkiem Node-RED-API-Version "v2"
    Wtedy odpowiedź zawiera pole rev

  Scenariusz: Rewizja flow niezależna od innych flow
    Zakładając, że znam rev flow "t1"
    Gdy zmieniam flow "t2" (przez /flows lub /flow/t2)
    Wtedy rev flow "t1" się nie zmienia
    A rewizja całości się zmienia

  Scenariusz: Aktualizacja ze zgodną rewizją
    Gdy wykonuję PUT /flow/t1 z rev równą aktualnej rewizji "t1"
    Wtedy odpowiedź ma status 200 i flow jest zapisany

  Scenariusz: Aktualizacja z niezgodną rewizją
    Zakładając, że ktoś zmienił flow "t1" po moim odczycie
    Gdy wykonuję PUT /flow/t1 ze starą rev
    Wtedy odpowiedź ma status 409 i kod "version_mismatch"
    I flow "t1" oraz magazyn pozostają bez zmian

  Scenariusz: Tworzenie flow pod wskazanym id przy włączonym ustawieniu
    Zakładając, że deploy.putCreatesFlow jest true
    Gdy wykonuję PUT /flow/nowy1 dla nieistniejącego flow z węzłami i layout "TB"
    Wtedy odpowiedź ma status 200 i {id:"nowy1"}
    I flow "nowy1" istnieje z węzłami przypisanymi do "nowy1" i layout "TB"

  Scenariusz: Tworzenie pod id zajętym przez węzeł
    Zakładając, że deploy.putCreatesFlow jest true i istnieje węzeł "n1" w flow "t1"
    Gdy wykonuję PUT /flow/n1
    Wtedy odpowiedź ma status 400 i kod "invalid_flow_id"

  Scenariusz: Tworzenie warunkowe
    Zakładając, że deploy.putCreatesFlow jest true i flow "t1" istnieje
    Gdy wykonuję PUT /flow/t1 z rev null
    Wtedy odpowiedź ma status 409 i kod "version_mismatch"

  Scenariusz: Dodanie globalnego configu razem z flow
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
- **Kontraktowe** `test/unit/@node-red/editor-api/lib/admin/flow_spec.js` (supertest): `legacy GET/POST/PUT/DELETE unchanged` (zapis oczekiwanych odpowiedzi 5.0.7), `GET v2 returns rev`, `invalid API version returns 400 invalid_api_version`, `PUT with stale rev returns 409`, `PUT unknown id returns 404 by default`, `PUT unknown id creates when putCreatesFlow`, `PUT with globalConfigs conflict returns 400 duplicate_id`, `rev/globalRev/globalConfigs are not stored on tab node`.
- **E2E** (opcjonalnie, jak dla FL-B-001): skrypt HTTP na uruchomionym runtime – cykl GET v2 → PUT z rev → PUT ze starą rev (409).

#### DoD specyficzne
- [ ] Decyzja o rozróżnieniu `configs` / `globalConfigs` i o bramkowaniu `rev` nagłówkiem `v2` zatwierdzona przez Zamawiającego.
- [ ] Dokument kontraktu Admin API (tabela + przykłady) dołączony do gałęzi pakietu.
- [ ] Testy FL-B-001 zielone; brak regresji `copyFlowLayoutProperties`.
- [ ] Wszystkie nowe ścieżki wewnątrz istniejącego mutexu; zgodność z krokami E-01.
- [ ] `deploy.putCreatesFlow` w szablonie `settings.js` (wspólny obiekt `deploy`).

#### Ryzyka i alternatywy
- **Kolizja nazwy `configs` (decyzja Zamawiającego):** zlecenie opisuje „opcjonalne `configs[]` dodające globalne configi”, ale `configs` już istnieje i znaczy „configi flow” (zwracane też przez `GET /flow/:id`). Zmiana znaczenia złamałaby klientów robiących GET → PUT. Rekomendacja: nowe pole `globalConfigs[]`. Alternatywy: flaga `configsScope: "global"` w treści albo nagłówek; odrzucona – niejawne, łatwe do pomyłki.
- **„Round-trip” GET → PUT:** gdyby `GET /flow/:id` zawsze zwracał `rev`, dotychczasowi klienci odsyłający cały obiekt zaczęliby nieświadomie wysyłać rewizję i dostawać 409 zamiast nadpisania. Dlatego `rev` w GET tylko przy `v2`; `rev` w PUT sprawdzane zawsze, gdy obecne. Alternatywa: `ETag`/`If-Match` (standard HTTP) – spójne z HTTP, ale niespójne z `/flows` (rev w treści) – **pytanie**.
- **Rewizja flow a zależności:** zmiana globalnego configu lub subflow używanego przez flow nie zmienia rewizji flow (zgodnie z wymaganiem „tylko przy zmianie tego flow”); klient chcący chronić globalne configi używa `globalRev`.
- **Kolejność węzłów:** rewizja liczona w kolejności zapisu – przestawienie węzłów zmienia rewizję (bezpieczniej niż sortowanie).
- **Status odpowiedzi przy tworzeniu:** 200 `{id}` (spójne z dzisiejszym PUT) zamiast 201 – **do potwierdzenia**.
- **Węzły konfiguracyjne nierozpoznawalne po stronie API:** runtime nie weryfikuje, czy typ w `globalConfigs` jest węzłem konfiguracyjnym (wiedza w definicji edytora) – walidacja ograniczona do typów `tab/subflow/group` i braku `wires`; **do potwierdzenia**.
- Wysokie ryzyko konfliktów scalania z P-01/Z-05/Z-06/FL-B-002 – łagodzone przez E-01.

#### Podzadania
- [ ] Testy kontraktowe stanu bieżącego (zapis odpowiedzi 5.0.7) – S
- [ ] `getFlowRevision` + `rev` w GET v2 – S
- [ ] Kontrola `rev`/`globalRev` w PUT/POST (mutex) – M
- [ ] Wydzielenie `build*FlowConfig` + tworzenie pod id za ustawieniem – M
- [ ] `globalConfigs[]` (upsert, konflikty, duplikaty w `updateFlow`) – M
- [ ] Dokument kontraktu, szablon `settings.js`, JSDoc, CHANGELOG – S

---

### Z-05 – Wymóg rewizji przy każdym wdrożeniu

| Pole | Wartość |
|---|---|
| Etap / typ | 2 / funkcja |
| Priorytet / ryzyko | P1 / średnie |
| Ustawienie | `deploy.requireRevision: false` (propozycja zlecenia: `flows.requireRevision`) |
| Zależności | E-01 (krok 2), Z-04 (rewizja flow, `globalRev`, `rev:null`), P-02 (zachowanie „Overwrite” w edytorze) |
| Pliki | `runtime/lib/api/flows.js:66-98,100-200`; `editor-api/lib/admin/flows.js:38-68`; `editor-api/lib/admin/flow.js`; `editor-client/src/js/ui/deploy.js:262-279,367-400,536-560,675-690`; `runtime/lib/api/settings.js` (przekazanie ustawienia do edytora); `node-red/settings.js` |
| Powiązania | K8S – publikacja przez edytor, MCP i CI/CD (`ARCHITEKTURA.md` §3.6: „każdy klient wysyła rewizję”) |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE.**
- Kontrola tylko `if (flows.hasOwnProperty('rev'))` (`api/flows.js:76-86`); brak `rev` = nadpisanie bez kontroli.
- v1 (`admin/flows.js:56`): treść to tablica, opakowywana w `{flows: req.body}` – **nie ma miejsca na `rev`**.
- `reload` pomija kontrolę (`api/flows.js:72-74` → `loadFlows(true)`); `/flow` (POST/PUT/DELETE) – brak kontroli.
- Kod 409 `version_mismatch` (`api/flows.js:80-84`) mapowany w `editor-api/lib/util.js:42-58`.
- Edytor wysyła `rev` zawsze poza wymuszonym nadpisaniem (`deploy.js:540-543`); każde 409 → okno konfliktu (`:680-681`).
- **Błąd istniejący:** `restart()` (`deploy.js:367-400`) przy 409 wywołuje `resolveConflict(nns, true)` (`:390`), a `nns` nie jest zdefiniowane w tym zakresie (`const nns` tylko w `save`, `:536`) → `ReferenceError`. Dziś nieosiągalne (reload nie zwraca 409); stałoby się osiągalne, gdyby reload wymagał rewizji.

#### Specyfikacja
- **Cel:** przy włączonym ustawieniu żadne wdrożenie zmieniające treść flow przez Admin API nie nadpisze cudzych zmian bez jawnej rewizji.
- **Wejścia:** `deploy.requireRevision` (domyślnie `false`); `rev` w treści (v2, `/flow/:id`), `globalRev` (Z-04), `?rev=` w `DELETE /flow/:id`.
- **Wyjścia:** przy braku wymaganej rewizji → **409** `{code:"revision_required", message:"..."}`; przy niezgodnej → 409 `version_mismatch` (bez zmian).
- **Macierz (przy `requireRevision: true`; przy `false` – wszystko jak dziś):**

| Ścieżka | Wymagana rewizja | Uzasadnienie |
|---|---|---|
| `POST /flows` v2 (`full`/`nodes`/`flows`) | `rev` całości | wymaganie zlecenia |
| `POST /flows` v1 | zawsze 409 `revision_required` (komunikat wskazuje v2) | v1 nie ma pola na `rev`; alternatywa – nagłówek (pytanie) |
| `POST /flows` `reload` | **nie** | nie zmienia treści w magazynie, tylko przeładowuje to, co tam jest |
| `PUT /flow/:id` (istniejący) | `rev` flow | wymaganie zlecenia |
| `PUT /flow/:id` (tworzenie, Z-04) | `rev: null` (jawne „flow nie istnieje”) | brak rewizji do porównania |
| `PUT /flow/global` | `rev` flow `global` | nadpisuje wszystkie globalne configi |
| `POST /flow` | nie (id nadaje serwer, nic nie nadpisuje); **tak** – `globalRev`, gdy niesie `globalConfigs` | upsert globalnych configów nadpisuje |
| `DELETE /flow/:id` | `?rev=` flow | usunięcie też niszczy cudze zmiany – **do potwierdzenia** |
| `POST /flows/state` (start/stop) | nie | nie zmienia treści |
| wywołania wewnętrzne (`runtime.flows.*` bez Admin API) | nie | kontrola w warstwie `runtime/lib/api` |

- **Niezmienniki:** przy `false` brak zmian w zachowaniu i odpowiedziach; kontrola przed hookiem `preDeploy` (E-01 krok 2 przed 3) i w mutexie; `version_mismatch` zachowuje znaczenie (zgodność z edytorem).
- **Przypadki błędów:** brak `rev` → 409 `revision_required`; `rev` pusty string / nie-string → 400 `invalid_revision`; niezgodna → 409 `version_mismatch`.
- **Skutki uboczne:** wpis audytu `flows.set`/`flow.update` z `error:"revision_required"`; edytor z wymuszonym nadpisaniem pobiera aktualną rewizję.

#### Projekt rozwiązania (minimalny)
1. `runtime/lib/api/flows.js`: funkcja `checkRevision({required, provided, current})` używana przez `setFlows`, `addFlow`, `updateFlow`, `deleteFlow` (wspólna z Z-04, w kroku 2 E-01); odczyt `deploy.requireRevision` przy każdym wywołaniu (zmiana bez restartu nie jest wymagana – **do potwierdzenia**).
2. `editor-api/lib/admin/flows.js`: dla v1 przekazanie `apiVersion:"v1"`, by runtime zwrócił komunikat wskazujący v2; `admin/flow.js`: przekazanie `req.query.rev` dla DELETE.
3. Udostępnienie stanu ustawienia edytorowi: `runtime/lib/api/settings.js` – pole `deploy.requireRevision` w ustawieniach runtime dla edytora (tylko flaga).
4. Edytor `deploy.js`:
   - wymuszone nadpisanie (`save(true)`) przy `requireRevision` → `GET /flows` (v2) po aktualną `rev`, potem wdrożenie z nią (jawne, świadome nadpisanie; kolejny konflikt → ponowne okno); przy `editorTheme.deploy.staleFlows: "reload-only"` (P-02) opcja Overwrite i tak ukryta;
   - obsługa `revision_required` w `.fail` (komunikat zamiast okna konfliktu);
   - poprawka `restart()` (`:390`) – zdefiniowanie zbioru węzłów przed `resolveConflict` lub komunikat błędu (poprawka niezależna od ustawienia).
5. Szablon `settings.js`: `deploy.requireRevision` z opisem macierzy; CHANGELOG; nowy kod błędu w dokumencie kontraktu (Z-04).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Wymóg rewizji przy wdrożeniu

  Szablon scenariusza: Ustawienie wyłączone – zachowanie jak dotąd
    Zakładając, że deploy.requireRevision jest false
    Gdy wdrażam przez <ścieżka> bez rewizji
    Wtedy wdrożenie się udaje jak w wersji bazowej
    Przykłady:
      | ścieżka            |
      | POST /flows v1     |
      | POST /flows v2     |
      | PUT /flow/:id      |

  Szablon scenariusza: Ustawienie włączone – brak rewizji odrzucony
    Zakładając, że deploy.requireRevision jest true
    Gdy wdrażam przez <ścieżka> bez rewizji
    Wtedy odpowiedź ma status 409 i kod "revision_required"
    I magazyn i uruchomione flow pozostają bez zmian
    I hook preDeploy nie jest wywoływany
    Przykłady:
      | ścieżka            |
      | POST /flows v1     |
      | POST /flows v2     |
      | PUT /flow/:id      |
      | PUT /flow/global   |
      | DELETE /flow/:id   |

  Scenariusz: Ustawienie włączone – zgodna rewizja
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
    Wtedy odpowiedź ma status 409, kod "revision_required" i komunikat wskazujący API v2

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
    Wtedy odpowiedź ma status 409 i kod "revision_required"

  Scenariusz: Wymuszone nadpisanie w edytorze
    Zakładając, że deploy.requireRevision jest true i wystąpił konflikt wdrożenia
    Gdy wybieram w edytorze "Overwrite"
    Wtedy edytor pobiera aktualną rewizję i wdraża z nią
    I serwer nie zwraca "revision_required"

  Scenariusz: Restart flow z edytora przy błędzie 409 nie powoduje błędu skryptu
    Gdy przeładowanie zwraca 409
    Wtedy edytor pokazuje komunikat, a w konsoli nie ma ReferenceError
```

#### Testy
- **Jednostkowe** `test/unit/@node-red/runtime/lib/api/flows_spec.js`: `describe("requireRevision")` z `[false, true].forEach` – `setFlows without rev`, `setFlows v1 without rev`, `setFlows reload without rev`, `updateFlow without rev`, `updateFlow create with rev null`, `addFlow without globalConfigs`, `addFlow with globalConfigs without globalRev`, `deleteFlow without rev`, `missing deploy settings object treated as false`, `rev check happens before preDeploy hook` (z Z-06).
- **Kontraktowe** `test/unit/@node-red/editor-api/lib/admin/flows_spec.js` i `flow_spec.js`: `POST /flows v1|v2 returns 409 revision_required when required`, `same requests succeed when not required`, `DELETE /flow/:id?rev=`, `error body has code and message`.
- **Edytor:** E2E/ręcznie – wymuszone nadpisanie i restart przy 409 (brak testów jednostkowych `deploy.js`).

#### DoD specyficzne
- [ ] Macierz ścieżek zatwierdzona przez Zamawiającego (v1, DELETE, POST /flow, reload).
- [ ] Testy obu stanów ustawienia dla v1, v2 i `/flow/:id` (wymóg zlecenia).
- [ ] Kod `revision_required` opisany w kontrakcie Admin API i CHANGELOG.
- [ ] Poprawka `restart()` w edytorze z opisem w CHANGELOG.

#### Ryzyka i alternatywy
- v1 bez możliwości wysłania rewizji: alternatywa – nagłówek `Node-RED-Revision` (lub `If-Match`) honorowany przez wszystkie ścieżki; zwiększa powierzchnię kontraktu – **pytanie**.
- Edytor z „Overwrite” formalnie spełnia wymóg, ale nadal nadpisuje; jeśli celem jest zakaz nadpisań – połączyć z P-02 `reload-only` (decyzja Zamawiającego).
- Inne klienty (np. narzędzia CLI, integracje) wdrażające v1 przestaną działać przy włączonym wymogu – zamierzone; opis w dokumentacji ustawienia.
- Spójność `requireRevision` z Z-09 (obserwator magazynu używa `reload` – zwolniony z wymogu).

#### Podzadania
- [ ] `checkRevision` + macierz w runtime API – M
- [ ] Przekazanie wersji API / `?rev=` w editor-api – S
- [ ] Edytor: Overwrite z pobraniem rewizji, `revision_required`, poprawka `restart()` – M
- [ ] Testy obu stanów + kontrakt – M
- [ ] Szablon `settings.js`, CHANGELOG – S

---

### Z-06 – Hooki wdrożenia `preDeploy` / `postDeploy` w `RED.hooks`

| Pole | Wartość |
|---|---|
| Etap / typ | 2 / funkcja |
| Priorytet / ryzyko | P1 / średnie |
| Ustawienie | brak przełącznika (funkcja addytywna: bez zarejestrowanych hooków zachowanie jak dotąd); opcjonalnie `deploy.hookTimeout` (ms, domyślnie 30000) – **do potwierdzenia** |
| Zależności | E-01 (kroki 3 i 9), P-01 (moment startu/odpowiedzi), Z-04/Z-05 (kontrola rewizji przed `preDeploy`), Z-09 (`preReload` przed krokiem 6) |
| Pliki | `util/lib/hooks.js:3-17,40-65,162-235`; `runtime/lib/api/flows.js:66-200`; `runtime/lib/flows/index.js:118-242,572-822`; `editor-api/lib/admin/flows.js`, `flow.js` (źródło, użytkownik); `editor-client/src/js/ui/deploy.js:675-690` (komunikat odrzucenia); `runtime/locales/en-US/runtime.json` |
| Powiązania | K8S – publikacja przez edytor, MCP i CI/CD (`ARCHITEKTURA.md` §3.6: „walidacja przed wdrożeniem – hook w runtime”); K8S-T-006 (wydania) – `postDeploy` |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: **POTWIERDZONE.**
- `VALID_HOOKS` (`hooks.js:3-17`): `onSend, preRoute, preDeliver, postDeliver, onReceive, postReceive, onComplete, preInstall, postInstall, preUninstall, postUninstall`; `add()` rzuca `Invalid hook` dla innych (`:63-65`).
- `trigger()` bez handlerów → `Promise.resolve()` (`:162-171`); handler: zwrot `false` → zatrzymanie (promise **rozwiązany** wartością `false`, nie odrzucony); wyjątek synchroniczny lub odrzucony promise → odrzucenie z `err.hook` (`:175-235`). Brak limitu czasu – handler, który nigdy nie zakończy, wstrzymuje wywołującego.
- Payload przekazywany przez referencję (handler może go zmieniać).
- Wzorzec wywołania z obsługą błędu: `registry/lib/installer.js:222-275`.
- `setFlows` liczy `diff` (`flows/index.js:154`, `flows/util.js:686-691`: `added, changed, removed, rewired, linked, flowChanged`) – źródło listy zmienionych flow.
- `addFlow/updateFlow/removeFlow` budują konfigurację wewnątrz `flows/index.js` i wołają `setFlows` – wynikowa konfiguracja nie jest dziś dostępna w warstwie API (potrzebne wydzielenie z Z-04/E-01).

#### Specyfikacja
- **Cel:** jedno miejsce w runtime do walidacji wdrożeń (np. zakazane węzły, wymagane pola) i reakcji po wdrożeniu (np. publikacja wydania), wspólne dla edytora, MCP i CI/CD.
- **Wejścia (payload `preDeploy`, zamrożona głęboka kopia):**
  `{ type: "full"|"nodes"|"flows"|"reload", source: "admin-api"|"internal", endpoint: "/flows"|"/flow"|"/flow/:id"|null, method, flowId?, flows: [wynikowa pełna konfiguracja bez poświadczeń], currentRev, user: {username, permissions}|null }`.
- **Wejścia (payload `postDeploy`):** `{ rev, type, source, endpoint, user, changedFlows: [id flow], started: true|false, errors?: [...] }` (`errors` – gdy P-01 je dostarcza).
- **Wyjścia:** `preDeploy` odrzuca przez: zwrot `false`, rzucenie błędu, odrzucony promise lub przekroczenie limitu czasu → wdrożenie przerwane **przed zapisem**, Admin API 400 `{code:"deploy_rejected", message:<komunikat z hooka lub domyślny>}`; edytor pokazuje komunikat. `postDeploy` nie ma wpływu na wynik.
- **Niezmienniki:**
  - kolejność (E-01): kontrola rewizji → `preDeploy` → zapis → zatrzymanie → start → `postDeploy` → zdarzenie `runtime-deploy`; 409 nigdy nie wywołuje `preDeploy`;
  - oba hooki dla każdej ścieżki: `/flows` (wszystkie typy), `POST /flow`, `PUT /flow/:id` (także `global` i tworzenie pod id), `DELETE /flow/:id`, `reload`;
  - bez zarejestrowanych hooków – brak zmian w zachowaniu, czasie i odpowiedziach;
  - `preDeploy` **nie może modyfikować** wdrażanej konfiguracji (kopia zamrożona; zmiany ignorowane);
  - błąd lub przekroczenie czasu w `postDeploy` nie cofa wdrożenia – tylko `log.warn`;
  - wszystko w mutexie API (kolejne wdrożenie czeka na zakończenie `postDeploy` lub limit czasu);
  - proces działa dalej po wyjątku w dowolnym hooku.
- **Przypadki błędów:** wyjątek / odrzucenie / `false` / limit w `preDeploy` → 400 `deploy_rejected` (dla limitu – kod `deploy_hook_timeout`, **do potwierdzenia**), wpis audytu `flows.set` z `error`; wyjątek w `postDeploy` → log, odpowiedź bez zmian.
- **Skutki uboczne:** dodatkowe kopiowanie konfiguracji tylko gdy `hooks.has("preDeploy")`; start wczytywania flow przy uruchomieniu runtime (`flows.load` przy starcie) **nie** jest wdrożeniem – bez hooków (**do potwierdzenia**; przełączenie projektu – jw.).

#### Projekt rozwiązania (minimalny)
1. `util/lib/hooks.js`: dopisanie `"preDeploy", "postDeploy"` do `VALID_HOOKS` (sekcja „Deploy hooks”) + JSDoc payloadów.
2. Wspólny potok E-01 (np. funkcja `deploy(opts)` w `runtime/lib/api/flows.js` lub nowym module – nazwa w E-01): po `checkRevision` i zbudowaniu konfiguracji (`build*FlowConfig` z Z-04) → `if (hooks.has("preDeploy"))` → `await withTimeout(hooks.trigger("preDeploy", deepFreeze(clone)), timeout)`; wynik `false` → błąd `deploy_rejected`.
3. `reload`: odczyt z magazynu **przed** `preDeploy` (hook widzi treść, która zostanie uruchomiona), potem start tej samej treści bez ponownego odczytu – wymaga parametru w `flows.load`/`setFlows("load")` (**do potwierdzenia przy E-01**; alternatywa: `flows: null` dla reload).
4. `postDeploy`: wywołanie po zakończeniu startu (krok 7–8 E-01), niezależnie od trybu odpowiedzi P-01 (w trybie `stopped` odpowiedź HTTP jest już wysłana; w `started` – po odpowiedzi? zob. Ryzyka); `changedFlows` z `diff` (`z` węzłów z `added/changed/removed/rewired` + `flowChanged` + id zakładek), dla `full`/`reload` – wszystkie flow; `catch` → `log.warn(log._("deploy.hook-failed", …))`.
5. `editor-api`: przekazanie `source:"admin-api"` (dziś rozpoznawalne po `opts.req`, rekomendacja: jawne pole) i `user` (bez tokenów).
6. Edytor `deploy.js` `.fail`: dla 400 z `responseJSON.code === "deploy_rejected"` – `RED.notify(RED._("deploy.errors.rejected",{message}))` zamiast surowego `responseText` (nowy klucz en-US).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Hooki wdrożenia

  Scenariusz: Brak hooków – zachowanie jak dotąd
    Zakładając, że nie zarejestrowano preDeploy ani postDeploy
    Gdy wdrażam przez /flows, /flow, /flow/:id i reload
    Wtedy odpowiedzi i skutki są takie jak w wersji bazowej

  Szablon scenariusza: preDeploy odrzuca wdrożenie
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

  Scenariusz: Komunikat odrzucenia w edytorze
    Zakładając, że hook preDeploy odrzuca wdrożenie z komunikatem "Brak opisu flow"
    Gdy klikam Deploy w edytorze
    Wtedy edytor pokazuje powiadomienie błędu zawierające "Brak opisu flow"

  Scenariusz: Wyjątek w hooku nie zatrzymuje procesu
    Zakładając, że hook preDeploy rzuca nieoczekiwany TypeError
    Gdy wdrażam przez POST /flows
    Wtedy wdrożenie jest odrzucone z komunikatem
    I runtime nadal obsługuje kolejne żądania

  Scenariusz: Kolejność wywołań
    Zakładając, że hooki i magazyn zapisują kolejność zdarzeń
    Gdy wdrażam przez PUT /flow/t1 z poprawną rev
    Wtedy kolejność to: kontrola rewizji, preDeploy, zapis do magazynu, zatrzymanie, start, postDeploy, runtime-deploy

  Scenariusz: Niezgodna rewizja nie wywołuje preDeploy
    Gdy wdrażam ze starą rev
    Wtedy odpowiedź ma status 409, a preDeploy nie jest wywoływany

  Scenariusz: preDeploy otrzymuje dane wdrożenia
    Gdy użytkownik "alice" wdraża przez POST /flows typ "nodes"
    Wtedy preDeploy otrzymuje type "nodes", source "admin-api", user.username "alice" i wynikową konfigurację

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
    Zakładając, że hook preDeploy nie kończy się
    Gdy wdrażam
    Wtedy po upływie limitu wdrożenie jest odrzucone z czytelnym komunikatem
    I mutex zostaje zwolniony, a kolejne wdrożenie jest możliwe

  Scenariusz: Wywołanie wewnętrzne
    Gdy wdrożenie jest wywołane przez runtime API bez żądania HTTP
    Wtedy preDeploy otrzymuje source "internal"
```

#### Testy
- `test/unit/@node-red/util/lib/hooks_spec.js`: `allows preDeploy and postDeploy hooks`, `still rejects unknown hooks`.
- `test/unit/@node-red/runtime/lib/api/flows_spec.js`, `describe("deploy hooks")` (`afterEach hooks.clear()`): `setFlows calls preDeploy then postDeploy`, `preDeploy rejection returns 400 deploy_rejected and does not save`, `preDeploy false rejects`, `preDeploy throwing does not crash`, `preDeploy timeout rejects and releases mutex`, `preDeploy payload is frozen copy`, `postDeploy error is logged and deploy kept`, `hooks called for addFlow/updateFlow/deleteFlow/reload`, `rev mismatch skips preDeploy`, `no hooks registered – identical result`.
- `test/unit/@node-red/runtime/lib/flows/index_spec.js`: `changedFlows derived from diff for nodes/flows deploy`, `order: save → stop → start → postDeploy → runtime-deploy` (stuby `storage.saveFlows`, zdarzenia).
- Kontraktowe `test/unit/@node-red/editor-api/lib/admin/flows_spec.js`, `flow_spec.js`: `rejected deploy returns 400 with code and message`, `source admin-api and user passed`.
- Edytor: E2E/ręcznie – komunikat odrzucenia.

#### DoD specyficzne
- [ ] Payloady opisane w JSDoc `util/lib/hooks.js` i w dokumentacji (przykład walidatora w `settings.js`? – raczej w CHANGELOG/kontrakcie; **do potwierdzenia**).
- [ ] Test „brak hooków = brak zmian” dla wszystkich ścieżek.
- [ ] Kolejność zgodna z E-01, potwierdzona testem.
- [ ] Limit czasu udokumentowany (jeśli zatwierdzony).

#### Ryzyka i alternatywy
- **Modyfikacja w `preDeploy` – rekomendacja: nie.** Uzasadnienie: (1) rewizja i diff liczone z treści klienta – modyfikacja rozjechałaby stan edytora z runtime i każde kolejne wdrożenie kończyłoby się konfliktem; (2) audyt „kto co wdrożył” traci sens; (3) wiele hooków modyfikujących to niedeterministyczna kolejność; (4) transformacje należą do klienta/CI. Alternatywa (gdyby Zamawiający wymagał): osobny hook `transformDeploy` z obowiązkowym zwrotem zmian do klienta w odpowiedzi.
- **Moment `postDeploy` względem P-01:** w trybie `deploy.response:"stopped"` odpowiedź wychodzi przed startem, `postDeploy` po starcie (asynchronicznie); w trybie `"started"` – rekomendacja: odpowiedź **nie czeka** na `postDeploy` (wolny hook nie wydłuża wdrożenia), ale mutex czeka (kolejne wdrożenie nie wyprzedzi `postDeploy`). Alternatywa: odpowiedź po `postDeploy` – **pytanie**.
- **`reload`:** wymaga odczytu z magazynu przed hookiem – zmiana w `flows.load` (współdzielona z Z-09).
- Hook trzymający mutex blokuje wszystkie wdrożenia – stąd limit czasu; anulowanie hooka niemożliwe (działa dalej w tle).
- Kopia konfiguracji przy dużych flow – koszt tylko przy zarejestrowanym `preDeploy`.

#### Podzadania
- [ ] `VALID_HOOKS` + JSDoc – S
- [ ] `preDeploy` w potoku E-01 dla wszystkich ścieżek (+ limit czasu, kopia zamrożona) – M
- [ ] `reload` z odczytem przed hookiem – M
- [ ] `postDeploy` + `changedFlows` z diff + log błędów – M
- [ ] Edytor: komunikat `deploy_rejected` – S
- [ ] Testy (kolejność, odrzucenie, wyjątek, brak hooków) – M

---

### Z-07 – Automatyczne zdejmowanie tras HTTP węzła przy zamknięciu

| Pole | Wartość |
|---|---|
| Etap / typ | 2 / funkcja (nowe API, addytywne) + poprawka błędu (`http in`) |
| Priorytet / ryzyko | P2 / średnie (zmiana wewnętrzna `http in`, kolejność tras) |
| Ustawienie | brak (API addytywne; zmiana `http in` bez zmiany kontraktu) – zob. Ryzyka (pytanie o przełącznik awaryjny) |
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
   - `rawBodyCapture`: **bez zmian funkcjonalnych** w tym pakiecie; dostęp do stosu przez `rootApp._router || rootApp.router` z ostrzeżeniem, gdy brak (przygotowanie pod Express 5). Pełne usunięcie zależności wymaga mechanizmu „middleware przed parserami” w aplikacji nadrzędnej (której runtime nie posiada przy osadzeniu) – osobne zadanie.
5. Dokumentacja API węzłów (JSDoc), CHANGELOG (w tym poprawka `splice`/usuwania cudzych tras).

#### Kryteria akceptacji (BDD)
```gherkin
Funkcja: Trasy HTTP w kontekście węzła

  Scenariusz: Trasa po wdrożeniu istnieje raz
    Zakładając flow z węzłem http in GET "/test" i http response
    Gdy wdrażam flow
    Wtedy GET /test zwraca odpowiedź flow
    I trasa jest zarejestrowana dokładnie raz

  Scenariusz: Ponowne wdrożenie nie dubluje trasy
    Gdy wdrażam ten sam flow ponownie (full) 3 razy
    Wtedy trasa GET /test jest zarejestrowana dokładnie raz
    I żądanie wywołuje przepływ dokładnie raz

  Scenariusz: Usunięcie węzła zdejmuje trasę
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

  Scenariusz: Zachowanie http in bez zmian (regresja)
    Zakładając zestaw testów regresji http in napisany i zielony na wersji bazowej
    Gdy uruchamiam go po zmianie
    Wtedy wszystkie przypadki przechodzą bez modyfikacji testów
    # GET z query, POST JSON/urlencoded/multipart/raw, skipBodyParsing, cookies, CORS, httpNodeMiddleware, parametry ścieżki, kod 500 z errorHandler
```

#### Testy
- **Regresja najpierw (na kodzie 5.0.7):** nowy `test/nodes/core/network/21-httpin_spec.js` – `GET passes query as payload`, `POST json body`, `POST urlencoded`, `POST multipart upload`, `POST raw text/binary`, `skipBodyParsing keeps raw buffer`, `path parameters in req.params`, `cookies parsed`, `httpNodeMiddleware invoked`, `httpNodeCors handles OPTIONS`, `missing url warns`, `http response sets status and headers`. (Dostęp do `nodeApp` przez obiekt `RED` modułu / helper – **do potwierdzenia**.)
- Nowe w tym samym pliku: `redeploy keeps single route`, `removing node removes route`, `closing one node keeps same-path route of another node` (czerwony na 5.0.7), `splice skip regression – three consecutive matching routes removed` (czerwony na 5.0.7).
- `test/unit/@node-red/runtime/lib/nodes/httpRoutes_spec.js` (nowy): `registers route on first use`, `dispatches in registration order`, `remove() is idempotent`, `removeAll removes only node routes`, `removal during in-flight request is safe`, `error handlers receive errors`, `rejects invalid method/handler`.
- `test/unit/@node-red/runtime/lib/nodes/Node_spec.js`: `registerHttpRoute returns handle`, `close removes node routes before close callbacks`, `close continues when route removal throws`.

#### DoD specyficzne
- [ ] Testy regresji `http in` napisane i zielone **przed** zmianą (dowód: przebieg na 5.0.7), bez zmian po zmianie.
- [ ] Brak odwołań do `_router` w ścieżce rejestracji/zdejmowania tras (`grep`).
- [ ] JSDoc `Node.prototype.registerHttpRoute`; CHANGELOG z poprawką usuwania tras.
- [ ] Brak nowych zależności (`express` już jest zależnością runtime).

#### Ryzyka i alternatywy
- **Widoczność tras w `_router.stack`:** moduły zewnętrzne odczytujące trasy `http in` ze stosu (np. generatory dokumentacji API korzystające z właściwości `swaggerDoc`) przestaną je widzieć – **do potwierdzenia** na popularnych modułach. Łagodzenie: funkcja `httpRoutes.list()` (odczyt) lub przełącznik awaryjny przywracający dotychczasową rejestrację `http in` – **pytanie** (wymaganie „domyślnie wyłączone” formalnie nie dotyczy, bo kontrakt się nie zmienia, ale zmienia się sposób rejestracji).
- **Kolejność tras:** trasy z API obsługiwane w pozycji dyspozytora; trasa legacy zarejestrowana przez inny węzeł **po** pierwszym wdrożeniu znajdzie się za dyspozytorem (dziś byłaby przeplatana wg czasu rejestracji). Konflikt tej samej ścieżki między `http in` a trasą legacy może zmienić zwycięzcę – opis w CHANGELOG, test regresji.
- **Alternatywa:** osobny `express.Router` na węzeł montowany przez `app.use(router)` – nadal wymaga zdjęcia warstwy ze stosu (dostęp do `_router`); odrzucona. Alternatywa 2: dyspozytor z własnym dopasowaniem ścieżek (mapa) – duplikuje logikę Express (parametry, RegExp); odrzucona.
- `rawBodyCapture` nadal zależy od prywatnego stosu aplikacji nadrzędnej – ryzyko przy Express 5 pozostaje (osobne zadanie).

#### Podzadania
- [ ] Testy regresji `http in` na 5.0.7 – M
- [ ] `httpRoutes.js` (dyspozytor, uchwyty) + testy – M
- [ ] `Node.prototype.registerHttpRoute` + zdejmowanie w `close()` – S
- [ ] Migracja `http in` + fallback + przygotowanie `rawBodyCapture` – S
- [ ] JSDoc, CHANGELOG – S

---

## Pytania do Zamawiającego (etap 2)

1. **Z-03 – zakres:** czy akceptujecie skorygowany zakres (aktualizacja jest już wykrywana; do zrobienia: semver, poprzednia wersja i źródło w hookach, brak pozostawionych plików, komunikaty, ujednolicenie ustawień uploadu)?
2. **Z-03 – obniżenie wersji:** dozwolone z ostrzeżeniem (dziś de facto dozwolone jako „upgrade”) czy blokowane? Czy dodać `externalModules.palette.allowDowngrade` (domyślnie `true`)?
3. **Z-03 – potwierdzenie przed instalacją:** czy wymagane (wymaga dwuetapowego API `dryRun`), czy wystarczy komunikat po instalacji?
4. **Z-03 – ustawienia uploadu:** czy kanoniczne `externalModules.palette.allowUpload` z dwoma przestarzałymi aliasami jest akceptowalne?
5. **Z-04 – `configs` vs `globalConfigs`:** zgoda na nowe pole `globalConfigs[]` (istniejące `configs` = configi flow, bez zmiany znaczenia)?
6. **Z-04 – transport rewizji:** `rev` w treści tylko przy `Node-RED-API-Version: v2` (ochrona klientów GET→PUT) czy zawsze? Czy zamiast/obok tego `ETag`/`If-Match`?
7. **Z-04 – tworzenie pod id:** odpowiedź 200 `{id}` czy 201? Jakie ograniczenia formatu id (np. tylko `[a-z0-9.-_]`)?
8. **Z-04 – `globalRev`:** czy ochrona globalnych configów osobną rewizją jest potrzebna (rewizja flow celowo ich nie obejmuje)?
9. **Z-05 – macierz:** v1 przy wymogu zawsze 409 czy nagłówek z rewizją? Czy `DELETE /flow/:id` wymaga `?rev=`? Czy `reload` zwolniony?
10. **Z-05 – edytor:** czy przy wymogu rewizji „Overwrite” ma pobierać aktualną rewizję (świadome nadpisanie), czy być niedostępny (powiązanie z P-02 `reload-only`)?
11. **Z-06 – modyfikacja w `preDeploy`:** potwierdzenie rekomendacji „tylko walidacja, bez modyfikacji”.
12. **Z-06 – limit czasu i moment `postDeploy`:** czy `deploy.hookTimeout` (30 s) akceptowalny; czy odpowiedź HTTP w trybie P-01 `started` ma czekać na `postDeploy`?
13. **Z-06 – zakres ścieżek:** czy start runtime i przełączenie projektu mają wywoływać hooki (rekomendacja: nie – to nie wdrożenia)?
14. **Z-07 – zgodność:** czy wymagany przełącznik awaryjny przywracający dotychczasową rejestrację `http in` (moduły czytające `_router.stack`)? Czy usunięcie zależności `rawBodyCapture` od `_router` ma być w tym pakiecie, czy osobno?
