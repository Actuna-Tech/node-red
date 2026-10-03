# AGENTS.md – zasady pracy na gałęzi roboczej

Instrukcje dla agentów i osób pracujących na tej gałęzi (fork `node-red/node-red`).
Ten plik i katalog `design/` **nie trafiają do zgłoszeń upstream** – gałęzie pakietów są wydzielane od wersji bazowej.

## Kontekst – przeczytaj przed zmianą kodu

| Temat | Dokument |
|---|---|
| Zlecenie rozszerzeń silnika (P-01…P-04, Z-01…Z-15): analiza, plan, decyzje | `design/engine-extensions/ANALIZA.md` |
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
npm run test:e2e              # opcjonalne E2E (Playwright – nie jest zależnością; bez niego testy są pomijane)
```

## Zasady

1. **Najpierw zrozum** (kod + `WERYFIKACJA.md`), potem specyfikacja w karcie, potem test (czerwony), potem implementacja.
2. **Zgodność wstecz:** nowe zachowanie domyślnie wyłączone i włączane ustawieniem; ustawienie opisane w `packages/node_modules/node-red/settings.js`. Wyjątek: poprawki błędów.
3. **Poprawka błędu = test, który pada bez poprawki.**
4. **Testy** w `test/unit/...` (mocha/should), oba stany ustawienia i ścieżki błędów; kontrakty Admin API – testy kontraktu.
5. **Bez nazw produktów i firm** w kodzie, testach, komunikatach, nagłówkach plików i CHANGELOG (atrybucja tylko w `design/`).
6. **Bez nowych zależności npm** bez zgody Zamawiającego.
7. **Małe zmiany:** jeden pakiet = jedna gałąź; bez niezwiązanych refaktoryzacji.
8. **Nie twierdź, że działa, bez dowodu** – raport z liczbą testów i listą niezweryfikowanych rzeczy.
9. **Commity:** styl projektu; `Signed-off-by` osoby odpowiedzialnej (DCO); projekt wymaga też CLA OpenJS.
10. **Zgłoszenia upstream** (PR, issues) wyłącznie po pisemnej zgodzie Zamawiającego; problemy bezpieczeństwa – prywatnie wg `SECURITY.md`.

## Równoległa praca agentów

- Maksymalnie **2 funkcjonalności (pakiety) jednocześnie**, bez wspólnych plików w parze (plan par: `ANALIZA.md` §6.2).
- Każde zadanie dla agenta: rola, zakres plików, wejścia, ograniczenia, oczekiwany wynik, sposób weryfikacji, warunek eskalacji (`ZASADY.md` §5).
- Po implementacji – niezależny agent przeglądu (DoD `ZASADY.md` §3, ewaluacje).
