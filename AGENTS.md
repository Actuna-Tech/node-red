# AGENTS.md – zasady pracy na gałęzi roboczej

Instrukcje dla agentów i osób pracujących na tej gałęzi (fork `node-red/node-red`).
Ten plik i katalog `design/` **nie trafiają do zgłoszeń upstream** – gałęzie pakietów są wydzielane od wersji bazowej.

## Kontekst – przeczytaj przed zmianą kodu

| Temat | Dokument |
|---|---|
| **Priorytety biznesowe i kolejność faz (nadrzędne)** | `design/PRIORYTETY.md` |
| **Przewodnik dostosowania innych rozwiązań (nazwy, kontrakty API, ustawienia)** | `design/engine-extensions/MIGRACJA.md` |
| Zlecenie rozszerzeń silnika (P-01…P-04, Z-01…Z-15): analiza, plan, decyzje (podjęte: §7.0) | `design/engine-extensions/ANALIZA.md` |
| Zasady wspólne: nazwy ustawień, kontrakt potoku wdrożenia, DoD, szablon karty, role agentów | `design/engine-extensions/ZASADY.md` |
| Fakty z kodu (plik:linia) dla każdego pakietu | `design/engine-extensions/WERYFIKACJA.md` |
| Karty pakietów (specyfikacja, BDD, testy, DoD) | `design/engine-extensions/backlog/etap-*.md` |
| Układ flow (Z-14): dokumentacja, backlog FL-* | `design/flow-layout/` |
| Kubernetes / PostgreSQL / Redis: architektura, backlog K8S-* | `design/k8s-postgres/` |

## Architektura repozytorium (skrót)

- `packages/node_modules/@node-red/runtime` – runtime (flow, magazyn, API runtime), `@node-red/editor-api` – Admin API i serwer edytora,
  `@node-red/editor-client` – edytor (przeglądarka), `@node-red/registry` – rejestr i instalator węzłów, `@node-red/util` – hooki, i18n, log,
  `@node-red/nodes` – węzły podstawowe, `node-red` – CLI i szablon `settings.js`.
- Kierunek zależności: `editor-api` → `runtime` API; węzły dostają API przez `registry/lib/util.js` (`createNodeApi`); edytor komunikuje się wyłącznie przez Admin API i `/comms`.
- Potok wdrożenia: kolejność kroków wg `design/engine-extensions/ZASADY.md` §2.3 – nie zmieniać bez aktualizacji kontraktu E-01.

## Weryfikacja (używaj komend projektu)

```bash
npm ci
npm run build                 # wymagane przed testami edytora i E2E
npm run lint                  # eslint editor-client
npx mocha test/unit/_spec.js "test/unit/@node-red/<pakiet>/**/*_spec.js"   # szybkie testy obszaru
npm test                      # pełne: build, verify-deps, lint, coverage (wymaga ssh-keygen dla testów projektów)
npm run test:e2e              # osobny podzbiór E2E (D-03: Playwright NIE jest w repozytorium – narzędzie instalowane poza nim; bez niego testy są pomijane; nie wchodzi do gałęzi pakietów)
```

## Zasady

1. **Najpierw zrozum** (kod + `WERYFIKACJA.md`), potem specyfikacja w karcie, potem test (czerwony), potem implementacja.
2. **Zgodność wstecz:** nowe zachowanie domyślnie wyłączone i włączane ustawieniem; ustawienie opisane w `packages/node_modules/node-red/settings.js`. Wyjątek: poprawki błędów.
3. **Poprawka błędu = test, który pada bez poprawki.**
4. **Testy** w `test/unit/...` (mocha/should), oba stany ustawienia i ścieżki błędów; kontrakty Admin API – testy kontraktu.
5. **Bez nazw produktów** w kodzie, testach i komunikatach. **Wyjątek (D-19):** nagłówki o modyfikacji „Modified by Actuna Sp. z o.o.: …” w zmienionych plikach (pkt 4(b) licencji Apache 2.0) – zachowywane w forku i dopisywane do każdego modyfikowanego pliku; gałęzie do ewentualnego zgłoszenia upstream – bez nich.
6. **Bez nowych zależności npm** bez zgody Zamawiającego.
7. **Małe zmiany:** jeden pakiet = jedna gałąź; bez niezwiązanych refaktoryzacji.
8. **Nie twierdź, że działa, bez dowodu** – raport z liczbą testów i listą niezweryfikowanych rzeczy.
9. **Commity:** styl projektu; `Signed-off-by` osoby odpowiedzialnej (DCO – zob. pkt 11); CLA OpenJS dopiero przy ewentualnym zgłoszeniu (obecnie zablokowane).
10. **ZAKAZ zgłoszeń do upstream (decyzja D-04):** żadnych pull requestów, issues ani wypychania do `node-red/node-red` do odwołania przez Zamawiającego. Pull requesty tylko w obrębie forka `Actuna-Tech/node-red` i tylko na wyraźną prośbę. Uwaga: interfejs GitHub dla forka domyślnie proponuje PR do repozytorium źródłowego – zawsze sprawdzić repozytorium docelowe.
11. **Tożsamość commitów (D-04):** autor `Wojciech Repiński <wrepinski@gmail.com>` (Actuna Sp. z o.o.), linia `Signed-off-by` w każdym commicie, udział AI oznaczony `Co-Authored-By`. Konfiguracja: `git config user.name "Wojciech Repiński"; git config user.email "wrepinski@gmail.com"`; commit: `git commit -s`.
12. **Blokada wypychania:** zainstaluj hook `cp design/git-hooks/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push` (odrzuca push do `node-red/node-red`).

## Równoległa praca agentów

- Maksymalnie **2 funkcjonalności (pakiety) jednocześnie**, bez wspólnych plików w parze (plan par: `ANALIZA.md` §6.2).
- Każde zadanie dla agenta: rola, zakres plików, wejścia, ograniczenia, oczekiwany wynik, sposób weryfikacji, warunek eskalacji (`ZASADY.md` §5).
- Po implementacji – niezależny agent przeglądu (DoD `ZASADY.md` §3, ewaluacje).
