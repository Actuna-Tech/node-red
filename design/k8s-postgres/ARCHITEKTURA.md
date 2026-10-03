# Architektura docelowa: Node-RED w Kubernetes – edytor, workery, PostgreSQL, Redis

> **Autorstwo:** analizę opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

Data: 2026-10-03 · status: **analiza, wersja 3** (wersja 2: odpowiedzi z [ANALIZA.md](ANALIZA.md) §9; wersja 3: odpowiedzi z §11 – sekcja 0.1, kolejkowanie – sekcja 12) ·
bez zmian w kodzie.

## 0. Założenia (odpowiedzi zespołu)

| # | Pytanie | Odpowiedź | Konsekwencja |
|---|---|---|---|
| 1 | Ciągłość czego? | Pytanie dotyczyło **workerów** (obsługa ruchu). Edytor to osobna rola – jego chwilowa niedostępność nie przerywa ruchu | ciągłość workerów projektujemy osobno od edytora |
| 2 | Rodzaj flow | HTTP turowe + **streaming** (sesje czatów AI) | workery bezstanowe względem żądań; długie połączenia; łagodne zamykanie podów |
| 3 | Edytorzy | 2–3 osoby; edytor produkcyjny **tylko do edycji/zarządzania**, nie jest workerem | edytor nie wykonuje flow; 1 pod edytora na tenanta |
| 4 | Węzły | własne węzły korzystają z bazy; węzły uniwersalne (bez wpływu) – najlepiej, żeby ich „pliki” też były w bazie | warstwa plików tenanta (sekcja 7) |
| 5 | Tenanci | 1 instancja PostgreSQL = wiele instancji Node-RED = wielu tenantów; otwarte: jedna baza czy wiele baz | porównanie w sekcji 6 |
| 6 | Moduły | do analizy, uniwersalne dla ekosystemu Node-RED | pakiety npm + Helm (sekcja 9) |
| – | Cache | Redis | role Redis w sekcji 8 |

### 0.1 Odpowiedzi na pytania z §11 (wersja 3)

| # | Pytanie | Odpowiedź | Konsekwencja w projekcie |
|---|---|---|---|
| 1 | Czas strumienia | voicebot: ~90% do 3–4 min; czatbot: zwykle do ~15 min; to nie są limity twarde | drenaż podów do **20 min** (`terminationGracePeriodSeconds: 1200`) + **wznowienie rozmowy** dla dłuższych (stan w Redis/PostgreSQL, klient łączy się ponownie) – sekcja 3.5 |
| 2 | Tenanci na instancję | 10–20 | **wariant C (baza na tenanta) potwierdzony** – sekcja 6 |
| 3 | Publikacja rewizji | ręcznie (edytor), przez **MCP** i przez **CI/CD** | jedna ścieżka: **Admin API** z kontrolą rewizji i walidacją przed wdrożeniem; MCP i CI/CD to klienci Admin API – sekcja 3.6 |
| 4 | Środowisko | **on-premise** | operatory w klastrze: PostgreSQL (np. CloudNativePG), Redis (Sentinel), MinIO; kopie na lokalny magazyn obiektowy |
| 5 | Zarządzane usługi / kolejki | dowolny wariant; kolejkowanie przewidzieć już teraz | sekcja 12 |

## 1. Werdykt technologiczny

**PostgreSQL jest dobrym wyborem jako magazyn trwały – zostajemy przy nim**, uzupełniony o
Redis (cache, komunikacja między podami, stan sesji czatów) i opcjonalnie magazyn obiektowy
zgodny z S3 dla dużych plików.

| Kandydat | Za | Przeciw | Rola |
|---|---|---|---|
| **PostgreSQL** | transakcje, JSONB (flow to dokument JSON), izolacja tenantów (bazy/schematy/RLS), dojrzałe operatory K8s (np. CloudNativePG) z PITR i replikami | długie połączenia i ich liczba – potrzebny pooler (PgBouncer) | **źródło prawdy**: flow, poświadczenia, ustawienia, biblioteka, kontekst trwały, metadane plików, dane własnych węzłów |
| **Redis** | bardzo szybki, pub/sub, Streams, TTL, blokady | dane w pamięci; trwałość opcjonalna | **cache i szyna**: zdarzenia między podami, cache kontekstu, stan rozmów AI z TTL, limity, blokady |
| Magazyn obiektowy S3 (MinIO, chmura) | tani dla dużych plików, strumieniowanie | brak transakcji, inna semantyka niż system plików | **duże pliki** węzłów (powyżej progu, np. 10 MB) – metadane w PostgreSQL |
| MongoDB | naturalny dla dokumentów JSON | drugi system bazodanowy obok PostgreSQL, słabsza izolacja tenantów niż osobne bazy PG | nie rekomendowane |
| etcd / K8s API | natywne dla klastra | limity rozmiaru wartości, nie do danych aplikacji | nie |
| Tylko Redis | prostota | ryzyko utraty danych, brak zapytań | nie jako źródło prawdy |

## 2. Architektura docelowa

```
                         Ingress
        edytor.<tenant>.example     api.<tenant>.example
                │                          │
   ┌────────────▼───────────┐   ┌──────────▼───────────────────────┐
   │ Deployment: editor     │   │ Deployment: workers (HPA, N)     │
   │ replicas: 1            │   │ disableEditor: true              │
   │ rola: editor           │   │ rola: worker                     │
   │ flow NIE są wykonywane │   │ wykonują flow, HTTP + streaming  │
   └───┬──────────┬─────────┘   └───┬──────────────┬───────────────┘
       │          │  Redis pub/sub  │              │
       │          └──────┬──────────┘              │
       │           ┌─────▼─────┐                   │
       │           │  Redis    │  cache kontekstu, stan rozmów AI,
       │           └───────────┘  zdarzenia debug/status, polecenia
       │                                           │
   ┌───▼───────────────────────────────────────────▼───┐
   │ PostgreSQL (jedna instancja, osobna baza na tenanta)│
   │   schemat nodered: flow, historia, poświadczenia,   │
   │   ustawienia, sesje, biblioteka, kontekst, pliki    │
   │   schematy własnych węzłów: dane biznesowe          │
   └─────────────────────────────────────────────────────┘
        (opcjonalnie) S3/MinIO – duże pliki tenanta
```

- Każdy tenant to: 1 pod edytora + Deployment workerów + baza w PostgreSQL + prefiks kluczy w Redis.
- Obraz kontenera jest wspólny (Node-RED + zatwierdzone węzły + nasze moduły); rola i tenant
  przychodzą ze zmiennych środowiskowych.
- Pod edytora może być skalowany do zera, gdy nikt nie edytuje (opcjonalnie).

## 3. Cykl życia flow i ciągłość workerów

### 3.1 Problem
Deploy w Node-RED zatrzymuje i uruchamia węzły (typ `full` – wszystkie, `flows`/`nodes` – zmienione;
`runtime/lib/flows/index.js`). Na workerze oznacza to **przerwanie trwających strumieni czatów**
w zmienionych flow.

### 3.2 Rekomendacja: niezmienne wydania flow (release)

1. Edytor zapisuje flow do PostgreSQL (`saveFlows`) – powstaje nowa **rewizja** (`nr_flows_history`).
2. „Publikacja” rewizji (przycisk/akcja w edytorze lub pipeline CI) uruchamia **rolling update**
   Deploymentu workerów z rewizją przypiętą w zmiennej (np. `FLOW_REV`).
3. Nowe pody startują z nową rewizją i dopiero gdy są gotowe, przyjmują ruch.
4. Stare pody: `readiness` → false, nie dostają nowych żądań, **kończą trwające strumienie**
   (`terminationGracePeriodSeconds` ≥ maks. czas strumienia), potem się zamykają.

Efekt: brak przerwanych rozmów przy zmianie flow, możliwość szybkiego wycofania (poprzednia rewizja),
spójna wersja flow na wszystkich podach w danym momencie (poza krótkim oknem przejścia).

### 3.3 Alternatywa: gorące przeładowanie
Edytor publikuje zdarzenie w Redis; workery przeładowują flow (deploy typu `reload`/`flows`).
Szybsze, prostsze, ale przerywa strumienie w zmienionych flow. Dopuszczalne dla środowisk
testowych.

### 3.5 Długie rozmowy a wymiana podów

- Okres drenażu: `terminationGracePeriodSeconds: 1200` (20 min) – obejmuje typowe rozmowy czatbota
  i z dużym zapasem voicebota.
- Rozmowy dłuższe niż okres drenażu: **wznowienie** zamiast utrzymywania poda w nieskończoność –
  stan rozmowy (kontekst, historia, pozycja w strumieniu) w Redis z TTL + trwała historia w PostgreSQL;
  klient (aplikacja czatu / bramka głosowa) po zamknięciu połączenia łączy się ponownie z identyfikatorem
  sesji i trafia na nowy pod.
- Voicebot (połączenia głosowe): sprawdzić, czy bramka/telefonia pozwala na przeniesienie
  sesji; jeśli nie – drenaż musi objąć najdłuższe rozmowy (zgłoszone jako pytanie w sekcji 11).
- Przeładowanie flow w miejscu (bez wymiany podów) – hook „przed przeładowaniem” czekający na
  zakończenie rozmów z limitem czasu (pakiet Z-09 zlecenia rozszerzeń silnika, zob.
  `design/engine-extensions/`).

### 3.6 Publikacja: edytor, MCP, CI/CD

```
edytor ─┐
MCP ────┼──▶ Admin API (/flows, /flow/:id) ──▶ walidacja przed wdrożeniem (hook) ──▶ zapis rewizji ──▶ workery
CI/CD ──┘        kontrola rewizji (409 przy konflikcie)                                  (przeładowanie lub rolling update)
```

- Każdy klient wysyła rewizję, na której pracował; konflikt = 409, klient pobiera aktualny stan.
- Walidacja przed wdrożeniem (np. zakazane węzły, wymagane pola, testy flow) w jednym miejscu –
  hook w runtime, a nie w każdym kliencie.
- Serwer MCP nie ma osobnego dostępu do bazy – korzysta z Admin API z własnym kontem i uprawnieniami
  (audyt: kto/co wdrożył).

### 3.4 Wymagania dla workerów
- Flow obsługujące ruch muszą być **bezstanowe** między żądaniami: stan rozmowy w Redis
  (z TTL) i/lub PostgreSQL – nie w kontekście `memory`.
- **Strumieniowanie:** wbudowany węzeł `http response` wysyła odpowiedź jednorazowo
  (`nodes/core/network/21-httpin.js`) – potrzebne własne węzły: otwarcie strumienia (SSE lub
  `chunked`), wysłanie fragmentu, zamknięcie; z obsługą rozłączenia klienta.
- Ingress: wyłączone buforowanie odpowiedzi dla SSE, wydłużone limity czasu odczytu.
- HPA według liczby aktywnych połączeń/żądań (metryka własna), nie tylko CPU – strumienie AI
  głównie czekają na model.
- Flow „singletonowe” (harmonogramy `inject`, subskrypcje MQTT): osobny Deployment z 1 repliką
  albo blokada w Redis/PostgreSQL (tylko posiadacz blokady uruchamia flow).

## 4. Rola edytora

### 4.1 Edytor nie wykonuje flow – bez zmian w rdzeniu
Runtime przy starcie czyta `runtimeFlowState` z ustawień (`runtime/lib/flows/index.js`) i przy `stop`
nie uruchamia flow. Moduł storage w roli `editor`:
- przy `getSettings()` zwraca `runtimeFlowState: "stop"`,
- przy `saveSettings()` **nie zapisuje** tej wartości do wspólnej bazy (inaczej zatrzymałaby workery –
  pułapka z [ANALIZA.md](ANALIZA.md) §1.4).

Workery mają `disableEditor: true` (edytor i Admin API niedostępne z zewnątrz).

### 4.2 Funkcje edytora, które zależą od działającego runtime

| Funkcja | Bez rozwiązania | Rozwiązanie |
|---|---|---|
| Panel debug | pusty – wiadomości powstają na workerach | plugin w workerze nasłuchuje zdarzeń `comms` (`RED.events`, dostępne dla pluginów – `registry/lib/util.js`) i publikuje w Redis; plugin w edytorze odbiera i emituje je lokalnie |
| Status węzłów (kropki pod węzłami) | brak | jw. (tematy `status/<id>`); agregacja z wielu workerów (np. ostatni status) |
| Przycisk węzła `inject` | wysyła do edytora, gdzie flow nie działa | polecenie przez Redis do jednego workera (kolejka/Streams) – do potwierdzenia w prototypie |
| Panel kontekstu | działa, jeśli kontekst w PostgreSQL/Redis | magazyn kontekstu z sekcji 8 |
| Testowanie endpointów HTTP | adres edytora nie obsługuje flow | wywołanie adresu workerów (`api.<tenant>`) |
| Współpraca 2–3 osób (*multiplayer*) | działa | jeden pod edytora – stan w pamięci wystarcza |

Zalecenie: przy 2–3 edytorach **jeden pod edytora na tenanta** (bez sticky sessions i bez
problemu cache tokenów/ustawień – [ANALIZA.md](ANALIZA.md) M6–M8).

## 5. Bezpieczeństwo ruchu i dostępu

- Edytor tylko z sieci administracyjnej (osobny Ingress, `adminAuth`, najlepiej SSO).
- Workery: tylko endpointy flow; `httpNodeAuth`/uwierzytelnianie w flow.
- `credentialSecret` z K8s Secret per tenant; poświadczenia w bazie zaszyfrowane.
- Każdy tenant ma własną rolę w PostgreSQL (dostęp tylko do swojej bazy) i prefiks/ACL w Redis.

## 6. Wielu tenantów w jednej instancji PostgreSQL

| Kryterium | A. Wspólne tabele + `tenant_id` + RLS | B. Schemat na tenanta (jedna baza) | C. **Baza na tenanta** |
|---|---|---|---|
| Izolacja danych | logiczna (polityki RLS – ryzyko błędu konfiguracji) | dobra (uprawnienia do schematu) | **najlepsza** (osobna baza, osobna rola) |
| Kopia / odtworzenie jednego tenanta | trudne (filtrowanie wierszy) | `pg_dump -n` | **`pg_dump` bazy, proste** |
| Usunięcie tenanta (np. RODO) | `DELETE` w wielu tabelach | `DROP SCHEMA` | **`DROP DATABASE`** |
| Pule połączeń (PgBouncer) | jedna pula | jedna baza, pule per rola | pula per baza – więcej połączeń; wymaga strojenia |
| Migracje schematu | raz | dla każdego schematu | dla każdej bazy (job/operator) |
| Skala (liczba tenantów) | tysiące+ | setki–tysiące | **dziesiątki–setki** na instancję |
| Własne węzły (dane biznesowe) | muszą pilnować `tenant_id` | `search_path` per tenant | **zwykłe połączenie do bazy tenanta** |
| Hałaśliwy sąsiad | wspólne tabele i indeksy | wspólna baza | osobne bazy, wspólna instancja |
| Przeniesienie tenanta na inną instancję | trudne | średnie | **łatwe** (dump/restore, replikacja logiczna) |

**Rekomendacja: C – baza na tenanta**, w niej schemat `nodered` (stan Node-RED) i schematy
własnych węzłów. Uzasadnienie: każdy tenant i tak ma własne pody (proces Node-RED na tenanta),
więc liczba tenantów na instancję będzie raczej w dziesiątkach–setkach; najprostsza izolacja,
kopie, usuwanie i przenoszenie. Próg ostrzegawczy: przy setkach tenantów na jednej instancji
rozważyć podział na kilka instancji PostgreSQL lub wariant B.

Moduły (sekcja 9) przyjmują **adres bazy i nazwę schematu z konfiguracji**, więc wariant B
(lub A dla bardzo małych tenantów) pozostaje możliwy bez zmiany kodu.

## 7. Pliki dla węzłów uniwersalnych (punkt 4)

Węzły uniwersalne mogą zapisywać pliki (`file`, `file in`, `watch`, `tail`, węzły zewnętrzne z
lokalnymi plikami). W podach bez stanu te pliki znikają lub są niewidoczne dla innych replik.

| Wariant | Jak | Pokrywa | Za | Przeciw |
|---|---|---|---|---|
| **W1. Podmiana węzłów plikowych core** | `nodesExcludes` (obsługiwane – `registry/lib/localfilesystem.js`) wyłącza `10-file.js` itp.; nasz moduł rejestruje te same typy (`file`, `file in`) z magazynem tenanta (PostgreSQL ≤ próg, S3 powyżej) | flow używające węzłów core – **bez zmian w flow** | dane w bazie, transakcje, kopie razem z bazą | nie obejmuje węzłów zewnętrznych piszących przez `fs` |
| **W2. Wolumen RWX na tenanta** (NFS/CephFS/EFS) + `fileWorkingDirectory` | każdy pod montuje ten sam katalog | **każdy węzeł** używający `fs` | uniwersalne, zero kodu | stan znów w systemie plików; blokady plików przez sieć; osobne kopie zapasowe |
| W3. Montaż S3 przez FUSE (np. Mountpoint/rclone) | katalog = bucket tenanta | każdy węzeł (z ograniczeniami) | dane poza podem | słaba semantyka (brak blokad, dopisywanie), opóźnienia – ryzykowne dla węzłów zakładających zwykły dysk |
| W4. „System plików w PostgreSQL” przez FUSE | – | – | – | niedojrzałe, wydajność – **odradzane** |

**Rekomendacja – warstwy:**
1. **Własne węzły**: korzystają z bazy tenanta przez wspólny węzeł konfiguracyjny (sekcja 9) – bez plików.
2. **Węzły plikowe core**: W1 – magazyn plików tenanta w PostgreSQL (`nr_files`: ścieżka, metadane,
   `bytea`/large object do progu) + S3 dla dużych plików.
3. **Węzły zewnętrzne korzystające z `fs`**: W2 jako bezpiecznik dla zatwierdzonych węzłów
   + **lista dozwolonych węzłów** w palecie (`externalModules.palette.allowList`) i przegląd,
   które węzły piszą na dysk.

## 8. Redis – role i zasady

| Rola | Mechanizm | Uwagi |
|---|---|---|
| Zdarzenia edytor ↔ workery (publikacja rewizji, debug, status, polecenia `inject`) | pub/sub lub Streams | Streams, gdy potrzebne potwierdzenie/odtworzenie; pub/sub dla debug |
| Cache kontekstu | odczyt przez cache, zapis do PostgreSQL (synchronicznie lub z buforem) | PostgreSQL jest źródłem prawdy |
| Stan rozmów AI | klucze/Streams z TTL per sesja | ewentualnie wznowienie przerwanego strumienia; historia trwała w PostgreSQL |
| Limity (rate limiting), klucze idempotencji | liczniki z TTL | operacje atomowe, których brakuje w API kontekstu |
| Blokady (flow singletonowe, migracje) | `SET NX PX` / Redlock | lub `pg_advisory_lock` |
| Cache sesji logowania | opcjonalnie | przy jednym podzie edytora niepotrzebne |

Zasady: Redis **nigdy nie jest jedyną kopią danych trwałych**; każdy klucz z prefiksem tenanta i TTL
(poza celowymi wyjątkami); HA przez Sentinel lub zarządzaną usługę; utrata Redis = degradacja
(wolniej, brak debug), a nie utrata danych.

## 9. Moduły – uniwersalne dla ekosystemu Node-RED

Wszystkie jako osobne pakiety npm, konfigurowane w `settings.js` / zmiennymi środowiskowymi,
**bez zmian w rdzeniu Node-RED**:

| Pakiet (robocza nazwa) | Typ w Node-RED | Zakres |
|---|---|---|
| `node-red-storage-postgres` | `storageModule` | flow + historia rewizji, poświadczenia, ustawienia (sekcje, rola editor/worker, wyjątek `runtimeFlowState`), sesje, biblioteka; migracje; konfigurowalna baza/schemat |
| `node-red-context-postgres` | `contextStorage` | kontekst w PostgreSQL z opcjonalnym cache Redis i buforem zapisu |
| `node-red-cluster` | plugin | szyna Redis: przekazywanie debug/status do edytora, polecenia `inject`, publikacja rewizji, blokady singletonów |
| `node-red-tenant-store` | węzeł konfiguracyjny | pula połączeń PostgreSQL i klient Redis tenanta dla **własnych węzłów** (jedno miejsce konfiguracji, wspólna pula) |
| `node-red-file-store` | węzły (`file`, `file in`, …) | zamienniki węzłów plikowych core z magazynem w PostgreSQL/S3 (W1) |
| `node-red-http-stream` | węzły | strumieniowanie odpowiedzi HTTP (SSE/chunked) dla czatów AI |
| Helm chart | – | Deploymenty edytora i workerów, HPA, PDB, probes, `preStop`, Ingress, Secret/ConfigMap, job migracji |

Istniejące moduły społeczności (storage/context dla różnych baz) – do przeglądu przed decyzją
„piszemy własne”: jakość, utrzymanie, licencja, zgodność z rolą editor/worker. Kryteria w K8S-A-001.

Ewentualne propozycje do projektu Node-RED (nie są warunkiem wdrożenia): `runtimeFlowState`
per instancja, hook unieważniania cache tokenów, strumieniowa odpowiedź HTTP w core.

## 10. Ryzyka

| Ryzyko | Ograniczenie |
|---|---|
| Przekazywanie debug/status przez plugin zależy od wewnętrznych zdarzeń (`comms`) | prototyp na początku (K8S-T-003); testy przy aktualizacji Node-RED |
| Polecenie `inject` z edytora – brak gotowego punktu rozszerzenia | prototyp; w razie problemów – własny endpoint w pluginie |
| Węzły zewnętrzne z ukrytym stanem na dysku | lista dozwolonych węzłów, W2 jako bezpiecznik, przegląd |
| Liczba połączeń przy bazie na tenanta | PgBouncer, małe pule na pod, limity |
| Długie strumienie a aktualizacje | wydania niezmienne + drenaż, `terminationGracePeriodSeconds` |
| Spójność cache Redis | PostgreSQL źródłem prawdy, TTL, unieważnianie przez zdarzenia |

## 12. Kolejkowanie

### 12.1 Po co już teraz
- **Rozdzielenie przyjęcia żądania od pracy**: długie operacje (wywołania modeli AI, transkrypcja,
  integracje) nie blokują workera HTTP; worker przyjmuje, odkłada zadanie, zwraca identyfikator lub strumień.
- **Odporność na wymianę podów**: zadanie w kolejce przeżywa restart poda – inny worker je dokończy.
- **Kontrola obciążenia**: limity równoległości per tenant/model, ponawianie z opóźnieniem, kolejka błędów (DLQ).
- **Zadania jednorazowe w klastrze**: harmonogram wrzuca zadanie raz, wykonuje je dokładnie jeden konsument
  (uzupełnia koordynację z pakietu Z-10).

### 12.2 Propozycja: dwie warstwy, bez nowego systemu

| Warstwa | Technologia | Gwarancje | Do czego |
|---|---|---|---|
| **Kolejka trwała** | PostgreSQL (tabela zadań, `SELECT … FOR UPDATE SKIP LOCKED`, baza tenanta) | co najmniej raz, transakcyjnie z danymi biznesowymi (wzorzec *outbox*), przeżywa awarię Redis | zadania biznesowe, wywołania zewnętrzne z ponawianiem, harmonogramy |
| **Kolejka szybka / zdarzenia** | Redis Streams (grupy konsumentów, `XAUTOCLAIM` dla porzuconych) | co najmniej raz, w pamięci (z AOF – ograniczona trwałość) | fragmenty strumieni, zdarzenia rozmów, powiadomienia edytor↔workery, zadania krótkotrwałe |

Zasady: każde zadanie ma klucz idempotencji; konsument potwierdza po wykonaniu; limit prób → DLQ;
identyfikator tenanta w nazwie kolejki/strumienia; metryki długości kolejek → HPA workerów (KEDA lub metryka własna).

### 12.3 Dlaczego nie RabbitMQ / Kafka / NATS (na teraz)
Przy 10–20 tenantach i on-premise każdy dodatkowy system to operator, kopie, monitoring i aktualizacje.
PostgreSQL + Redis pokrywają potrzeby; interfejs kolejki w węzłach projektujemy jako **port** (sekcja 12.4),
więc przejście na NATS JetStream / RabbitMQ później nie zmienia flow.

### 12.4 Węzły (uniwersalne, pakiet `node-red-queue`)
- węzeł konfiguracyjny „kolejka” (adapter: `postgres` | `redis-streams`, później inne),
- `queue out` (odłóż zadanie, z kluczem idempotencji i opóźnieniem),
- `queue in` (konsument: równoległość, potwierdzenie po zakończeniu flow przez `complete`, ponawianie, DLQ),
- współpraca z koordynacją (Z-10): konsumenci działają na wielu instancjach bez duplikatów dzięki semantyce kolejki.

## 11. Pytania nadal otwarte

Odpowiedzi na pytania 1–5 – sekcja 0.1. Pozostaje:

1. Voicebot: czy bramka głosowa/telefonia pozwala wznowić rozmowę na innym podzie (jeśli nie – drenaż musi objąć najdłuższe połączenia).
2. Wymagania prawne (lokalizacja danych, retencja, RODO) – wpływ na kopie i usuwanie tenantów.
3. Maksymalny akceptowalny czas niedostępności edytora (pod edytora jest pojedynczy).

Plan zadań: [BACKLOG.md](BACKLOG.md).
