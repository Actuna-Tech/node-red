# Backlog – Node-RED w Kubernetes (PostgreSQL + Redis)

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

Zasady (identyfikatory, statusy, priorytety, szablony, Definition of Ready/Done) – jak w
[../flow-layout/BACKLOG.md](../flow-layout/BACKLOG.md) §1–§3, z prefiksami:
`K8S-B` (błąd), `K8S-T` (zadanie), `K8S-A` (analiza).
Kontekst: [ANALIZA.md](ANALIZA.md) (inwentaryzacja stanu), [ARCHITEKTURA.md](ARCHITEKTURA.md) (architektura docelowa).

## Powiązanie ze zleceniem rozszerzeń silnika (2026-10-03)

Zlecenie `design/engine-extensions/` dostarcza w rdzeniu punkty zaczepienia, które tu zakładaliśmy jako obejścia:

| Pozycja K8S | Pakiet zlecenia | Zmiana |
|---|---|---|
| K8S-T-001 storage | Z-09 (`watchFlows`), Z-04/Z-05 (rewizje) | wtyczka **musi** implementować `watchFlows` (PostgreSQL LISTEN/NOTIFY lub Redis) |
| K8S-T-002 rola editor | **Z-15** (instancja tylko edycyjna) | obejście przez `runtimeFlowState` zastąpione ustawieniem rdzenia |
| K8S-T-003 debug/status | – | bez zmian (wtyczka) |
| K8S-T-005 Helm/probes | Z-08 (sondy, drenaż SIGTERM), Z-11 (read-only), Z-02 | sondy z rdzenia; workery `httpAdminRoot: false` |
| K8S-T-006 wydania niezmienne | Z-09 + `preReload`, Z-06 `postDeploy` | **opcja operacyjna**; podstawowy mechanizm: przeładowanie w miejscu z drenażem i limitem równoległości (ANALIZA zlecenia §4.10) |
| K8S-T-007 strumieniowanie | Z-07 (`registerHttpRoute`) | węzły strumieniowe na nowym API tras |
| K8S-T-013 singletony | **Z-10** (koordynacja) | **zastąpione** – po naszej stronie implementacja wtyczki koordynacji (pg advisory lock / Redis) |
| K8S-T-014 kolejki | Z-10 | uzupełnienie, bez zmian |

## DoD – dodatkowe dla zadań K8S

Oprócz DoD wspólnego i dla funkcjonalności z backlogu układu flow:
- [ ] Testy z **prawdziwym** PostgreSQL i Redis (kontenery w testach), nie tylko atrapy.
- [ ] Moduł działa bez zmian w rdzeniu Node-RED (albo zmiana rdzenia jest osobną, opisaną pozycją).
- [ ] Konfiguracja przez `settings.js` i zmienne środowiskowe; brak sekretów w obrazie i w bazie
      (`credentialSecret`, hasła – tylko K8s Secret).
- [ ] Izolacja tenantów sprawdzona testem (tenant A nie widzi danych tenanta B – baza, Redis).
- [ ] Zachowanie przy niedostępności PostgreSQL / Redis opisane i przetestowane (start, praca, powrót).
- [ ] Dokumentacja instalacji i konfiguracji pakietu (README pakietu) + wpis w [ARCHITEKTURA.md](ARCHITEKTURA.md), jeśli zmienia się projekt.

## Podsumowanie

| ID | Tytuł | Typ | Status | Priorytet | Zależy od |
|---|---|---|---|---|---|
| K8S-A-001 | Przegląd istniejących modułów storage/context społeczności | analiza | Gotowe | P2 | – |
| K8S-A-002 | Inwentaryzacja węzłów uniwersalnych używających `fs` | analiza | Gotowe | P2 | – |
| K8S-T-001 | `node-red-storage-postgres` – flow, historia, poświadczenia, sesje, biblioteka | zadanie | Gotowe | P1 | K8S-A-001 |
| K8S-T-002 | Ustawienia w bazie z rolą editor/worker | zadanie | Gotowe | P1 | K8S-T-001 |
| K8S-T-003 | Prototyp `node-red-cluster`: debug/status z workerów do edytora | zadanie (prototyp) | Gotowe | P1 | – |
| K8S-T-004 | `node-red-context-postgres` z cache Redis | zadanie | Nowe | P2 | K8S-T-001 |
| K8S-T-005 | Obraz kontenera i Helm chart (editor + workers) | zadanie | Nowe | P1 | K8S-T-001, 002 |
| K8S-T-006 | Wydania niezmienne flow i drenaż workerów | zadanie | Nowe | P1 | K8S-T-005 |
| K8S-T-007 | `node-red-http-stream` – strumieniowanie SSE/chunked | zadanie | Nowe | P1 | – |
| K8S-T-008 | `node-red-tenant-store` – węzeł konfiguracyjny PG/Redis dla własnych węzłów | zadanie | Nowe | P2 | – |
| K8S-T-009 | `node-red-file-store` – zamienniki węzłów plikowych core | zadanie | Nowe | P2 | K8S-A-002 |
| K8S-T-010 | Polecenie `inject` z edytora do workera | zadanie | Nowe | P3 | K8S-T-003 |
| K8S-T-011 | Provisioning tenanta (baza, rola, Redis ACL, Secret) i usuwanie | zadanie | Nowe | P2 | K8S-T-005 |
| K8S-T-012 | Kopie zapasowe i odtwarzanie per tenant | zadanie | Nowe | P2 | K8S-T-011 |
| K8S-T-013 | ~~Flow singletonowe~~ → wtyczka koordynacji dla Z-10 (pg advisory lock / Redis) | zadanie | Nowe | P2 | Z-10 |
| K8S-T-014 | `node-red-queue` – kolejka trwała (PostgreSQL SKIP LOCKED) i szybka (Redis Streams) | zadanie | Nowe | P2 | K8S-T-008 |
| K8S-T-015 | Wznowienie rozmów (czat/voice) po wymianie poda | zadanie | Nowe | P2 | K8S-T-007 |

## Karty

### K8S-A-001 – Przegląd istniejących modułów społeczności
**Cel:** decyzja „piszemy własne / rozwijamy istniejące” dla storage i context.
**Kryteria oceny:** pokrycie API (2.1/2.2 w [ANALIZA.md](ANALIZA.md)), utrzymanie (ostatnie wydania, zgłoszenia),
licencja, testy, obsługa wielu tenantów i roli editor/worker, zgodność z Node-RED 4/5.
**DoD:** tabela porównawcza i rekomendacja w tym pliku.

### K8S-A-002 – Inwentaryzacja węzłów używających `fs`
**Cel:** lista węzłów (core i z palety tenantów), które zapisują/czytają pliki lokalne – podstawa decyzji W1/W2 ([ARCHITEKTURA.md](ARCHITEKTURA.md) §7).
**Metoda:** przegląd kodu zatwierdzonych pakietów (`require('fs')`, ścieżki `userDir`), test w podzie z systemem plików tylko do odczytu.
**DoD:** lista węzłów z wariantem obsługi (W1 / W2 / zakaz) i aktualizacja listy dozwolonych węzłów.

### K8S-T-001 – `node-red-storage-postgres`
**Kryteria akceptacji:**
- [ ] `getFlows`/`saveFlows` w transakcji z historią rewizji; kontrola `rev` (odrzucenie zapisu przy zmianie w międzyczasie).
- [ ] Poświadczenia, sesje, biblioteka; migracje schematu przy starcie (z blokadą).
- [ ] Konfigurowalny adres bazy i schemat (warianty A/B/C z [ARCHITEKTURA.md](ARCHITEKTURA.md) §6).
- [ ] Flow z układem (`layout`, `wireStyle`, `o`) zachowane 1:1 (test z flow z `design/flow-layout/demo`).
- [ ] Test: usunięcie poda → nowy pod odtwarza flow, poświadczenia i zalogowane sesje.

### K8S-T-002 – Ustawienia z rolą editor/worker
**Kryteria akceptacji:**
- [ ] Ustawienia w sekcjach (`runtime`, `nodes`, `users`, `modules`) – zapis per sekcja.
- [ ] Rola `editor`: `runtimeFlowState` zwracany jako `stop`, nigdy nie zapisywany do bazy; flow nie startują.
- [ ] Rola `worker`: ignoruje `runtimeFlowState` z bazy; `disableEditor`.
- [ ] `credentialSecret` tylko z konfiguracji – `_credentialSecret` nie trafia do bazy.

### K8S-T-003 – Prototyp przekazywania debug/status
**Cel:** potwierdzić, że plugin (API z `RED.events` / `RED.comms.publish`) wystarcza, by panel debug i statusy węzłów w edytorze pokazywały zdarzenia z workerów.
**Kryteria akceptacji:** - [ ] debug z 2 workerów widoczny w edytorze z oznaczeniem poda; - [ ] statusy węzłów aktualne; - [ ] przy braku Redis workery działają dalej.
**Ryzyko:** zależność od wewnętrznych tematów `comms` – opisać wersje Node-RED, z którymi testowano.

### K8S-T-004 – Kontekst w PostgreSQL z cache Redis
- [ ] Pełne API context store; buforowanie zapisów z `flushInterval`; cache odczytów w Redis z unieważnianiem.
- [ ] Dokumentacja braku atomowości (`get`→`set`) i zalecenie liczników w SQL/Redis.

### K8S-T-005 – Obraz i Helm chart
- [ ] Obraz z zatwierdzonymi węzłami; paleta tylko do odczytu; Projekty wyłączone; system plików tylko do odczytu (poza `/tmp`).
- [ ] Deploymenty `editor` (1 replika) i `workers` (HPA), PDB, probes, `preStop`, Ingress (edytor i API osobno).
- [ ] Test: rolling update workerów bez błędów dla trwającego ruchu HTTP.

### K8S-T-006 – Wydania niezmienne i drenaż
- [ ] Publikacja rewizji → rolling update z `FLOW_REV`; workery ładują przypiętą rewizję.
- [ ] Drenaż: `readiness` false po SIGTERM, oczekiwanie na zakończenie strumieni do limitu.
- [ ] Wycofanie do poprzedniej rewizji jedną akcją.
- [ ] Test: trwający strumień czatu nie jest przerwany przez publikację nowej rewizji.

### K8S-T-007 – Strumieniowanie HTTP
- [ ] Węzły: start strumienia (SSE / chunked), fragment, koniec; obsługa rozłączenia klienta (zdarzenie w flow).
- [ ] Działa przez Ingress (bez buforowania), testy E2E strumienia.

### K8S-T-008 – Węzeł konfiguracyjny tenanta
- [ ] Wspólna pula PostgreSQL i klient Redis dla własnych węzłów; konfiguracja z env; metryki puli.

### K8S-T-009 – Zamienniki węzłów plikowych
- [ ] `nodesExcludes` wyłącza węzły core; zamienniki rejestrują te same typy i właściwości (flow bez zmian).
- [ ] Pliki ≤ próg w PostgreSQL, większe w S3; test zgodności z flow używającymi węzłów core.

### K8S-T-010 – `inject` z edytora
- [ ] Kliknięcie przycisku `inject` w edytorze wyzwala węzeł na dokładnie jednym workerze; informacja zwrotna w edytorze.

### K8S-T-011 – Provisioning tenanta
- [ ] Utworzenie: baza, rola, migracje, Secret, prefiks/ACL Redis, release Helm. Usunięcie: odwrotnie, z potwierdzeniem i kopią.

### K8S-T-012 – Kopie zapasowe
- [ ] Kopie per tenant + PITR instancji; retencja historii flow; udokumentowany i przećwiczony test odtworzenia.

### K8S-T-013 – Flow singletonowe
- [ ] Mechanizm oznaczenia flow jako singleton; tylko jeden pod je wykonuje (blokada lub osobny Deployment); test przełączenia.

### K8S-T-014 – Kolejki
- [ ] Port kolejki w węźle konfiguracyjnym; adaptery `postgres` i `redis-streams` ([ARCHITEKTURA.md](ARCHITEKTURA.md) §12).
- [ ] `queue out`/`queue in`: idempotencja, potwierdzenie po `complete`, ponawianie z opóźnieniem, DLQ, limit równoległości.
- [ ] Test: zabicie poda w trakcie zadania → zadanie dokończone przez inny pod dokładnie raz (efekt idempotentny).
- [ ] Metryka długości kolejki dostępna dla HPA/KEDA.

### K8S-T-015 – Wznowienie rozmów
- [ ] Stan rozmowy w Redis (TTL) + historia w PostgreSQL; identyfikator sesji po stronie klienta.
- [ ] Test: pod zamknięty w trakcie strumienia → klient łączy się ponownie, rozmowa kontynuowana bez utraty kontekstu.
- [ ] Wyjaśnione możliwości bramki głosowej (pytanie §11.1).
