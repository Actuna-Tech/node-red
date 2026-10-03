# Analiza: przeniesienie stanu Node-RED do PostgreSQL pod Kubernetes

> **Autorstwo:** analizę opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

Data: 2026-10-03 · wersja Node-RED: 5.0.7 (gałąź `claude/loving-fermat-ftfo9h`) ·
status: **analiza – bez zmian w kodzie**.

## 0. Wnioski w skrócie

1. **Cały trwały stan zapisywany przez Node-RED da się przenieść do PostgreSQL bez zmian w rdzeniu.**
   Node-RED ma dwa punkty rozszerzeń: *storage module* (flow, poświadczenia, ustawienia,
   sesje, biblioteka) i *context store* (kontekst węzłów/flow/globalny). Wystarczy
   napisać dwa moduły i wskazać je w `settings.js`.
2. **Nie wszystko należy do bazy:** zainstalowane węzły (`node_modules`), moduły zewnętrzne
   funkcji i repozytoria Projektów (git) to kod, a nie dane – powinny być częścią obrazu
   kontenera, a nie bazy.
3. **Baza nie czyni Node-RED w pełni bezstanowym.** Działające flow trzymają stan w pamięci
   (kolejki `delay`/`join`/`batch`, timery `inject`, połączenia MQTT/TCP, sesje edytora
   *multiplayer*, kontekst `memory`). Po przeniesieniu danych do bazy pod można dowolnie
   restartować i przenosić, ale **kilka replik wykonujących te same flow wymaga dodatkowych
   decyzji architektonicznych** (sekcja 4).
4. **Rekomendacja:** etap 1 – jedna replika + PostgreSQL (pod w pełni odtwarzalny);
   etap 2 – aktywny/zapasowy z wyborem lidera; skalowanie poziome tylko dla flow
   bezstanowych (HTTP), z podziałem na pod edytora i pody wykonawcze.

---

## 1. Inwentaryzacja stanu

Na podstawie kodu runtime (`@node-red/runtime`, `@node-red/registry`, `@node-red/editor-api`).

### 1.1 Stan trwały zapisywany przez Node-RED

| # | Stan | Gdzie dziś (domyślny `localfilesystem`) | Kod | Interfejs rozszerzenia | Do PostgreSQL? |
|---|---|---|---|---|---|
| S1 | Flow (w tym nasze `layout`/`wireStyle`/`o`) | `flows.json` + `.flows.json.backup` | `runtime/lib/storage/index.js` → `getFlows`/`saveFlows` | storage module | **tak** |
| S2 | Poświadczenia węzłów (zaszyfrowane `credentialSecret`) | `flows_cred.json` | `saveCredentials`, `runtime/lib/nodes/credentials.js` | storage module | **tak** (klucz w K8s Secret, nie w bazie) |
| S3 | Ustawienia runtime: `_credentialSecret`, `instanceId`, `runtimeFlowState`, telemetria | `.config.runtime.json` | `runtime/lib/storage/localfilesystem/settings.js`, `runtime/lib/settings.js` | `getSettings`/`saveSettings` | **tak**, z wyjątkami (1.4) |
| S4 | Rejestr węzłów (włączone/wyłączone zestawy) | `.config.nodes.json` | `@node-red/registry` | jw. | tak, ale powiązany z obrazem (1.4) |
| S5 | Ustawienia użytkowników edytora (np. domyślny układ flow `view-flow-layout`) | `.config.users.json` | `runtime/lib/api/settings.js` | jw. | **tak** |
| S6 | Ustawienia Projektów | `.config.projects.json` | storage `projects` | jw. | nie dotyczy, jeśli Projekty wyłączone |
| S7 | Lista modułów zewnętrznych | `.config.modules.json` | `registry/lib/externalModules.js` | jw. | tak (lista), same moduły – nie |
| S8 | Sesje / tokeny logowania (`adminAuth`) | `.sessions.json` | `editor-api/lib/auth/tokens.js` | `getSessions`/`saveSessions` | **tak**, z problemem cache (4.3) |
| S9 | Biblioteka (zapisane flow, funkcje, szablony) | `lib/` | `getLibraryEntry`/`saveLibraryEntry` | storage module | **tak** |
| S10 | Kontekst trwały (`contextStorage` typu `localfilesystem`) | `context/` | `runtime/lib/nodes/context/*` | context store | **tak** |

### 1.2 Kod i artefakty – do obrazu kontenera, nie do bazy

| # | Element | Gdzie | Kod | Rekomendacja |
|---|---|---|---|---|
| K1 | Zainstalowane węzły z palety | `<userDir>/node_modules`, `package.json`, `nodes/*.tgz` | `registry/lib/installer.js` | wbudować w obraz (`npm install` w Dockerfile); w produkcji wyłączyć instalację z palety (`externalModules.palette.allowInstall/allowUpdate/allowUpload: false`) |
| K2 | Moduły zewnętrzne węzła `function` | `<userDir>/externalModules` | `registry/lib/externalModules.js` | wbudować w obraz; `externalModules.modules.allowInstall: false`, `externalModules.autoInstall: false` (lub `functionExternalModules: false`) |
| K3 | Repozytoria Projektów (git, klucze SSH) | `<userDir>/projects` | `storage/localfilesystem/projects` | wyłączyć Projekty; wersjonowanie flow przez CI/CD lub historię w bazie (5.1) |
| K4 | `settings.js` | plik | – | ConfigMap + Secret (zmienne środowiskowe) |

### 1.3 Stan, który pozostaje w pamięci procesu

| # | Stan | Kod / przykład | Skutek przy restarcie | Skutek przy wielu replikach |
|---|---|---|---|---|
| M1 | Działające flow, wczytane z magazynu tylko przy starcie i deployu | `runtime/lib/flows/index.js` | odtwarzane z bazy | deploy trafia tylko do jednego poda – inne nie wiedzą |
| M2 | Wewnętrzny stan węzłów: kolejki `delay`, bufory `join`/`batch`, `trigger`, `rbe` | węzły core | **utrata** wiadomości w locie | każdy pod ma własny stan |
| M3 | Timery `inject`, harmonogramy | węzeł `inject` | odtwarzane | **każda replika wyzwala** – duplikaty |
| M4 | Połączenia wychodzące (MQTT, TCP, WebSocket, bazy) | węzły | ponowne połączenie | duplikaty subskrypcji, konflikty `clientId` |
| M5 | Kontekst `memory` (domyślny) | `nodes/context/memory.js` | **utrata** | każdy pod ma inny kontekst |
| M6 | Połączenia edytora (comms WebSocket), sesje *multiplayer* | `editor-api/lib/editor/comms.js`, `runtime/lib/multiplayer/index.js` (`Map` w pamięci) | ponowne połączenie | edytor musi trafiać zawsze do tego samego poda |
| M7 | Cache sesji logowania (wczytany raz) | `tokens.js` – `loadSessions()` | odtwarzany z bazy | token z poda A nieznany podowi B do restartu |
| M8 | Cache ustawień i blokada zapisu ustawień | `runtime/lib/settings.js`, `settingsSaveMutex` (w procesie) | odtwarzany | zapis ustawień na jednym podzie nadpisuje zmiany z innego |

### 1.4 Pułapki w ustawieniach (S3–S5)

- **`runtimeFlowState`** (zatrzymanie/uruchomienie flow z edytora, `runtimeState`) jest
  zapisywany w ustawieniach. Przy wspólnej bazie zatrzymanie flow na jednym podzie
  zatrzyma je na wszystkich po ich restarcie, a w modelu aktywny/zapasowy koliduje z
  wyborem lidera. → trzymać per pod (poza bazą) albo wyłączyć `runtimeState`.
- **`_credentialSecret`** generowany automatycznie i zapisywany w ustawieniach. →
  ustawić `credentialSecret` jawnie z K8s Secret; wtedy klucz nie trafia do bazy.
- **Rejestr węzłów (S4)** opisuje węzły obecne w `node_modules` obrazu. Po zmianie obrazu
  wpisy mogą wskazywać na nieistniejące moduły. → odtwarzać rejestr przy starcie
  (rejestr i tak skanuje moduły), traktować wpis w bazie tylko jako preferencję włącz/wyłącz.
- Moduł `localfilesystem` dzieli ustawienia na kilka plików; własny moduł dostaje i zapisuje
  **cały obiekt** – w bazie można go podzielić analogicznie (sekcje jako osobne wiersze).

---

## 2. Punkty rozszerzeń (bez zmian w rdzeniu)

### 2.1 Storage module

`settings.storageModule` przyjmuje **obiekt** (`runtime/lib/storage/index.js` – `moduleSelector`):

| Metoda | Odpowiada za | Uwagi |
|---|---|---|
| `init(settings, runtime)` | połączenie z bazą, migracje schematu | wywoływane z `runtime.settings` i obiektem runtime |
| `getFlows()` / `saveFlows(flows, user)` | S1 | cały JSON flow przy każdym deployu |
| `getCredentials()` / `saveCredentials(creds)` | S2 | dane już zaszyfrowane przez runtime |
| `getSettings()` / `saveSettings(settings)` | S3–S7 | opcjonalne, ale bez nich ustawienia nie przetrwają restartu |
| `getSessions()` / `saveSessions(sessions)` | S8 | opcjonalne |
| `getLibraryEntry(type, path)` / `saveLibraryEntry(type, path, meta, body)` | S9 | |
| `projects` | Projekty | nie implementować → Projekty wyłączone |

### 2.2 Context store

`settings.contextStorage` z własnym modułem (wzorzec: `runtime/lib/nodes/context/memory.js`,
`localfilesystem.js`): `open`, `close`, `get(scope, key, cb)`, `set(scope, key, value, cb)`,
`keys(scope, cb)`, `delete(scope)`, `clean(activeNodes)`.

- Można mieć kilka magazynów jednocześnie (np. `default: memory`, `db: postgres`) – flow
  wybierają magazyn jawnie (`flow.get("x", "db")`).
- API kontekstu **nie ma operacji atomowych** (np. inkrementacji) – przy wielu replikach
  wzorzec `get` → `set` to wyścig. Liczniki/blokady realizować w węzłach bazodanowych
  (SQL), nie w kontekście.

---

## 3. Proponowany schemat bazy

```sql
-- S1: flow – jeden aktualny wiersz + historia (zastępuje .flows.json.backup)
CREATE TABLE nr_flows (
    instance    text PRIMARY KEY,            -- pozwala na wiele instancji w jednej bazie
    flows       jsonb NOT NULL,
    rev         text NOT NULL,               -- skrót treści, do kontroli konfliktów
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text
);
CREATE TABLE nr_flows_history (
    id          bigserial PRIMARY KEY,
    instance    text NOT NULL,
    flows       jsonb NOT NULL,
    rev         text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text
);

-- S2: poświadczenia – zaszyfrowany blob od runtime
CREATE TABLE nr_credentials (
    instance    text PRIMARY KEY,
    credentials jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- S3–S7: ustawienia w sekcjach (runtime, nodes, users, modules)
CREATE TABLE nr_settings (
    instance    text NOT NULL,
    section     text NOT NULL,
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (instance, section)
);

-- S8: sesje logowania
CREATE TABLE nr_sessions (
    instance    text NOT NULL,
    token       text NOT NULL,
    session     jsonb NOT NULL,              -- user, client, scope, expires
    expires_at  timestamptz NOT NULL,
    PRIMARY KEY (instance, token)
);
CREATE INDEX ON nr_sessions (expires_at);

-- S9: biblioteka
CREATE TABLE nr_library (
    instance    text NOT NULL,
    type        text NOT NULL,               -- flows, functions, ...
    path        text NOT NULL,
    meta        jsonb NOT NULL DEFAULT '{}',
    body        text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (instance, type, path)
);

-- S10: kontekst
CREATE TABLE nr_context (
    instance    text NOT NULL,
    store       text NOT NULL,
    scope       text NOT NULL,               -- 'global', id flow, 'nodeId:flowId'
    key         text NOT NULL,
    value       jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (instance, store, scope, key)
);

-- Powiadomienie innych podów o deployu (model 4.3)
-- po saveFlows: NOTIFY nr_flows_changed, '<instance>:<rev>';
```

Uwagi:
- `jsonb` dla flow pozwala na zapytania (np. „które flow używają węzła X”, audyt układu),
  ale runtime i tak zapisuje i czyta cały dokument.
- Historia flow w bazie daje kopie zapasowe i wersjonowanie niezależne od plików;
  retencja np. N ostatnich wersji lub X dni.
- `instance` umożliwia wiele niezależnych instancji Node-RED (np. środowiska, klienci) w jednej bazie.

---

## 4. Modele wdrożenia w Kubernetes

### 4.1 Model A – jedna replika + PostgreSQL (rekomendowany na start)

```
Deployment (replicas: 1, strategy: Recreate)
  └─ pod: Node-RED (obraz z węzłami) ── storage/context ──▶ PostgreSQL
       ConfigMap: settings.js   Secret: credentialSecret, hasło DB, adminAuth
```

- Pod jest **odtwarzalny**: restart, przeniesienie na inny węzeł, aktualizacja obrazu bez PVC.
- `Recreate` zamiast `RollingUpdate` – dwa pody nie wykonują flow jednocześnie.
- Utrata przy restarcie: tylko stan M2–M5 (wiadomości w locie, kontekst `memory`).
- Przestój: czas startu poda (sekundy–kilkadziesiąt sekund).
- Probes: `readinessProbe` na `httpAdminRoot` (lub dedykowany endpoint), `livenessProbe` łagodny
  (długi start przy wielu węzłach).

### 4.2 Model B – aktywny / zapasowy

- 2 repliki; **jedna** wykonuje flow, druga czeka.
- Wybór lidera: blokada doradcza PostgreSQL (`pg_try_advisory_lock`) w module storage
  lub K8s `Lease`.
- Pod zapasowy: nie startuje flow (wymaga mechanizmu startu flow „na żądanie” –
  `runtimeState` istnieje, ale zapisuje stan we wspólnych ustawieniach → potrzebna mała
  zmiana lub start z flow zatrzymanymi poza ustawieniami, zob. 1.4).
- Service kieruje ruch (HTTP flow i edytor) tylko do lidera – `readinessProbe` zwraca
  gotowość wyłącznie u lidera.
- Przełączenie: czas wykrycia utraty lidera + start flow (bez startu procesu Node.js).

### 4.3 Model C – skalowanie poziome

```
Deployment "editor" (replicas: 1)        Deployment "workers" (replicas: N)
  edytor + Admin API, flow zatrzymane       disableEditor / httpAdminRoot: false
          │  saveFlows + NOTIFY                     │  LISTEN → przeładowanie flow
          └──────────────▶ PostgreSQL ◀─────────────┘
```

Warunki konieczne:
1. **Propagacja deployu:** po `saveFlows` `NOTIFY`; pody wykonawcze nasłuchują (`LISTEN`)
   i przeładowują flow (odpowiednik deployu typu `reload` – istnieje w `runtime/lib/api/flows.js`).
2. **Flow muszą być bezstanowe lub idempotentne:** HTTP/webhooki za Service działają;
   `inject`/harmonogramy, subskrypcje MQTT (bez *shared subscriptions*), kolejki `delay`/`join`
   dadzą duplikaty lub rozjechany stan. Potrzebny podział flow na „wykonywane wszędzie”
   i „tylko u lidera” (np. konwencja w nazwie/zmiennej środowiskowej + `disabled`)
   albo osobne Deploymenty dla flow singletonowych.
3. **Kontekst współdzielony** tylko przez magazyn PostgreSQL; brak atomowości (2.2).
4. **Edytor jeden** (sesje *multiplayer*, comms, cache tokenów i ustawień – M6–M8).
   Przy kilku podach edytora potrzebne: sticky sessions **oraz** zmiany w cache tokenów/ustawień.

---

## 5. Spójność, kopie zapasowe, bezpieczeństwo

### 5.1 Spójność i współbieżność
- `saveFlows` w transakcji: zapis aktualnego wiersza + wpis do historii.
- Kontrola konfliktów: edytor już przekazuje `rev`; moduł może dodatkowo odrzucić zapis,
  gdy `rev` w bazie zmienił się w międzyczasie (ochrona przy kilku edytorach).
- Ustawienia: zapis per sekcja (`INSERT … ON CONFLICT DO UPDATE`) zamiast całości –
  ogranicza nadpisywanie zmian (M8). Blokada `settingsSaveMutex` działa tylko w procesie.
- Kontekst: zapisy częste – bufor w pamięci i okresowy zapis (jak `flushInterval`
  w magazynie `localfilesystem`), z kompromisem: utrata ostatnich sekund przy awarii.

### 5.2 Kopie zapasowe i odtwarzanie
- Kopie bazy (`pg_dump`, PITR / WAL) zastępują pliki `.backup`; historia flow w `nr_flows_history`
  pozwala cofnąć deploy bez odtwarzania całej bazy.
- Eksport flow (JSON) dalej działa z edytora i Admin API – zachowuje układ flow
  (zob. `design/flow-layout/PROBLEMY.md`).
- Do ustalenia: RPO/RTO, retencja historii, test odtworzenia.

### 5.3 Bezpieczeństwo
- `credentialSecret` tylko w K8s Secret (zmienna środowiskowa w `settings.js`), nie w bazie –
  zrzut bazy bez klucza nie ujawnia poświadczeń.
- Osobny użytkownik bazy z prawami tylko do tabel `nr_*`; TLS do bazy.
- `adminAuth` obowiązkowy; sesje w bazie z indeksem po `expires_at` i sprzątaniem.

---

## 6. Wpływ na funkcję układu flow

- `layout`, `wireStyle` (zakładka, subflow) i `o` (węzeł) są częścią JSON flow → trafiają do
  `nr_flows` bez dodatkowej pracy.
- Domyślny układ użytkownika (`view-flow-layout`, `view-wire-style`) jest w ustawieniach
  użytkownika (S5) → sekcja `users` w `nr_settings`.
- Zmiana wyłącznie układu nie restartuje węzłów (poprawka `036dd6a`), więc w modelu C
  przeładowanie flow na podach wykonawczych po zmianie samego układu może być pominięte
  (porównanie bez właściwości wizualnych – do rozważenia przy implementacji).

---

## 7. Ryzyka

| Ryzyko | Wpływ | Ograniczenie |
|---|---|---|
| Node-RED nie jest projektowany jako system wieloaktywny | duplikaty, niespójny stan w modelu C | model A/B; w C tylko flow bezstanowe |
| Węzły zewnętrzne zapisujące pliki lokalnie | ukryty stan na dysku poda | przegląd używanych węzłów; PVC lub magazyn obiektowy dla plików |
| Niezgodność rejestru węzłów z obrazem | ostrzeżenia, brakujące węzły po aktualizacji | rejestr z obrazu, baza tylko jako preferencje |
| Utrata wiadomości w locie przy restarcie | biznesowa | kolejki zewnętrzne (np. broker) zamiast `delay`/`join` dla krytycznych danych |
| Wydajność zapisów kontekstu | obciążenie bazy | buforowanie, osobny magazyn tylko dla danych trwałych |
| Moduły społeczności o niepewnej jakości | błędy, brak wsparcia | własny moduł z testami lub audyt istniejącego |

---

## 8. Plan i zadania (propozycja do backlogu)

Identyfikatory `K8S-T-nnn`; DoD wspólne jak w `design/flow-layout/BACKLOG.md` §2.0 i §2.2,
plus kryteria poniżej.

| ID | Zadanie | Kryteria akceptacji (DoD specyficzne) |
|---|---|---|
| K8S-T-001 | Moduł storage PostgreSQL (S1, S2, S8, S9) + migracje schematu | testy jednostkowe z prawdziwą bazą (kontener); deploy/restart odtwarza flow, poświadczenia i sesje; historia flow; kontrola `rev` |
| K8S-T-002 | Ustawienia w bazie (S3–S7) z sekcjami i wyjątkiem `runtimeFlowState` | zapis per sekcja; `credentialSecret` z Secret; rejestr węzłów odtwarzany z obrazu |
| K8S-T-003 | Context store PostgreSQL | implementuje pełne API (2.2); buforowanie z konfigurowalnym `flushInterval`; testy jednostkowe |
| K8S-T-004 | Obraz kontenera z węzłami, paleta tylko do odczytu, Projekty wyłączone | brak zapisów do `userDir` w trakcie pracy (system plików tylko do odczytu, poza `/tmp`) |
| K8S-T-005 | Manifesty K8s / Helm dla modelu A | `Recreate`, probes, ConfigMap/Secret, test: usunięcie poda → flow i układ odtworzone |
| K8S-T-006 | Model B: wybór lidera + start flow tylko u lidera | test przełączenia; brak dwóch aktywnych podów jednocześnie |
| K8S-T-007 | Model C: NOTIFY/LISTEN i przeładowanie flow na podach wykonawczych | deploy w edytorze widoczny na wszystkich podach w < X s; konwencja flow singletonowych |
| K8S-T-008 | Kopie zapasowe i odtwarzanie | procedura i test odtworzenia; retencja historii flow |

## 9. Pytania do ustalenia przed implementacją

> Odpowiedzi zespołu i wynikająca z nich architektura docelowa: [ARCHITEKTURA.md](ARCHITEKTURA.md) (wersja 2).
> Zadania: [BACKLOG.md](BACKLOG.md) – zastępują wstępną listę z §8.

1. Wymagana dostępność (RTO/RPO) – czy wystarczy model A, czy potrzebny B/C?
2. Jakie typy flow dominują (HTTP, MQTT, harmonogramy, przetwarzanie wsadowe)?
3. Ile osób edytuje jednocześnie i czy edytor ma być dostępny w produkcji?
4. Jakie węzły z palety są używane (czy któreś zapisują pliki lokalnie)?
5. Jedna instancja Node-RED na bazę czy wiele (kolumna `instance`)?
6. Własny moduł storage/context czy ocena istniejących modułów społeczności?
