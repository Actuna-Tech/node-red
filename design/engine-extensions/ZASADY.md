# Zlecenie rozszerzeń silnika – zasady wspólne dla backlogu

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.
> Dokument towarzyszy [ANALIZA.md](ANALIZA.md) (analiza zgodności i plan). Karty pakietów: [backlog/](backlog/).

## 1. Identyfikatory i powiązania

- Pakiety zlecenia: `P-01`…`P-04`, `Z-01`…`Z-13`; nasz pakiet proponowany: `Z-14` (układ flow).
- Zadania przekrojowe: `E-nn` (np. `E-01` – kontrakt potoku wdrożenia).
- Powiązania z istniejącymi backlogami: `FL-*` ([../flow-layout/BACKLOG.md](../flow-layout/BACKLOG.md)), `K8S-*` ([../k8s-postgres/BACKLOG.md](../k8s-postgres/BACKLOG.md)).
- Statusy i priorytety jak w backlogu układu flow (§1).

## 2. Decyzje wstępne (do potwierdzenia przez Zamawiającego – pkt 3.4 zlecenia)

### 2.1 Nazwy ustawień

| Pakiet | Propozycja zlecenia | **Rekomendacja** | Uzasadnienie |
|---|---|---|---|
| P-01 | `flows.deployResponse` | `deploy.response: "stopped" \| "started"` | wspólny obiekt `deploy` dla P-01/Z-04/Z-05; w `settings.js` nie ma przestrzeni `flows` (są `flowFile`, `flowFilePretty`), a `flows` myli się z plikiem flow |
| P-02 | `editor.staleFlowsPolicy` | `editorTheme.deploy.staleFlows: "prompt" \| "reload-only"` | ustawienia funkcjonalne edytora są w `editorTheme` (`projects`, `multiplayer`); klucz `editor` jest używany przez **ustawienia użytkownika** w runtime (`RED.settings.get('editor')`) – kolizja znaczeń |
| P-03 | `telemetry.locked` | `telemetry.locked` (bez zmian) | obiekt `telemetry` już istnieje w `settings.js` |
| Z-02 | `httpAdminNodeRoutes` | `httpAdminNodeRoutes: "open" \| "authenticated"` (bez zmian) | spójne z `httpAdminRoot`, `httpAdminMiddleware`; API: `RED.auth.publicRoute()` zamiast `RED.auth.public()` (czytelne jako wywołanie, nie właściwość) |
| Z-04 | `flows.putCreates` | `deploy.putCreatesFlow: false` | jw. – obiekt `deploy` |
| Z-05 | `flows.requireRevision` | `deploy.requireRevision: false` | jw. |
| Z-07 | `node.registerRoute` | `node.registerHttpRoute(method, path, ...handlers)` | jednoznaczne (trasa HTTP węzła), odróżnia od tras administracyjnych |
| Z-08 | `health: {enabled, path}` | `health: { enabled:false, path:"/health", port: <opcjonalnie> }` | sondy muszą działać także przy `httpAdminRoot: false` i nie powinny być wystawiane przez publiczny Ingress – opcjonalny osobny port |
| Z-09 | `watchFlows(callback)`, hook `preReload` | bez zmian | spójne z API magazynu i nazwami hooków `pre*`/`post*` |
| Z-10 | typ wtyczki „koordynacja” | typ `node-red-coordination`, API węzłów `RED.coordination` | spójne z istniejącym typem `node-red-library-source` |
| Z-11 | `readOnlyUserDir` | `readOnlyUserDir` (bez zmian) | |
| Z-14 | – | `editorTheme.flowLayout: { enabled: false }` | wymóg zlecenia 3.2: domyślnie zachowanie jak oficjalne wydanie (bez nowych elementów UI) |

### 2.2 Wersja bazowa
Zlecenie wskazuje `5.0.6`. Wydanie `5.0.7` zawiera poprawki bezpieczeństwa (migracja na załataną
bibliotekę JSONata, aktualizacja `body-parser`). **Rekomendacja:** baza `5.0.7` (każdy pakiet
przenaszalny na `5.0.6` bez zmian merytorycznych – lista różnic w ANALIZA.md).

### 2.3 Kontrakt potoku wdrożenia (zadanie E-01)
Pakiety P-01, Z-04, Z-05, Z-06, Z-08, Z-09 oraz nasze FL-B-001/FL-B-002 zmieniają te same funkcje
(`runtime/lib/api/flows.js`, `runtime/lib/flows/index.js`, `editor-api/lib/admin/flow(s).js`).
Jedna, wspólna kolejność kroków **przed** implementacją pakietów:

```
1. przyjęcie żądania (Admin API: /flows, /flow, /flow/:id, reload; wywołanie wewnętrzne)
2. kontrola rewizji            – Z-05 (wymóg), Z-04 (rewizja flow), istniejące 409
3. hook preDeploy              – Z-06 (może odrzucić → 400)
4. stan gotowości = "deploying" – Z-08 (/ready → 503)
5. zapis do magazynu
6. zatrzymanie zmienionych węzłów (błędy zatrzymania NIE są połykane)
7. start nowych węzłów          – P-01: w trybie "started" odpowiedź czeka na ten krok i zwraca błędy startu
8. stan gotowości = "ready"
9. hook postDeploy              – Z-06
10. zdarzenie runtime-deploy (edytory)
```
Przeładowanie z magazynu (Z-09) przechodzi tę samą ścieżkę z krokiem `preReload` przed 6
i bez kroku 5; korzysta z tej samej blokady (mutex) co Admin API.

## 3. Wspólne Definition of Done (każdy pakiet)

Łączy wymagania zlecenia (§3) z praktykami pracy:

- [ ] **Specyfikacja** w karcie zatwierdzona (cel, wejścia/wyjścia, niezmienniki, błędy, skutki uboczne, kryteria BDD).
- [ ] **Zgodność wstecz:** nowe zachowanie domyślnie wyłączone; przy domyślnych ustawieniach wszystkie istniejące testy przechodzą bez zmian (wyjątek: pakiety „poprawka błędu”).
- [ ] **Testy najpierw:** test odtwarzający problem / wymaganie (czerwony) przed implementacją; dla poprawek błędów – test, który pada bez poprawki.
- [ ] **Testy obu stanów ustawienia** i ścieżek błędów, w strukturze `test/unit/...` (mocha/should).
- [ ] **`npm test` przechodzi** (build, verify-deps, lint, coverage). Uruchamiane w środowisku z `ssh-keygen` (testy projektów); każdy pominięty/środowiskowy błąd wymieniony z uzasadnieniem.
- [ ] **Brak nazw produktów** w kodzie, komunikatach, ustawieniach, testach i nagłówkach plików; brak nowych zależności npm bez zgody.
- [ ] **Dokumentacja:** ustawienie w szablonie `packages/node_modules/node-red/settings.js` (zakomentowane, z opisem); JSDoc dla nowego API; wpis do CHANGELOG (bez nazw produktów); teksty UI w `locales/en-US` (+ `pl` po Z-13).
- [ ] **Kontrakty:** zmiany Admin API opisane i pokryte testami kontraktu (stare wywołania bez zmian).
- [ ] **Dostarczenie:** osobna gałąź pakietu względem wersji bazowej; commity w stylu projektu z `Signed-off-by` (DCO) osoby odpowiedzialnej; zależności między pakietami jawnie opisane.
- [ ] **Przegląd:** niezależny przegląd diffu (poprawność, zakres, zgodność wstecz, bezpieczeństwo); brak niezwiązanych zmian.
- [ ] **Raport:** co zmieniono, nowe ustawienia, wpływ na zgodność, dowody weryfikacji (liczby testów), czego nie zweryfikowano.

### Ewaluacje wspólne (dla agentów i przeglądu)

```yaml
evals:
  - name: existing_tests_default_settings
    requirement: pass
  - name: new_tests_both_setting_states
    requirement: present_and_pass
  - name: regression_test_fails_without_fix   # tylko poprawki błędów
    requirement: demonstrated
  - name: public_contracts
    requirement: unchanged_unless_documented
  - name: product_names
    requirement: none_in_code_tests_messages
  - name: new_dependencies
    requirement: none_without_approval
  - name: settings_template_documented
    requirement: true
  - name: scope
    requirement: no_unrelated_changes
```

## 4. Szablon karty pakietu

```markdown
### <ID> – <tytuł>

| Pole | Wartość |
|---|---|
| Etap / typ | 1–4 / funkcja \| poprawka błędu \| przerobienie |
| Priorytet / ryzyko | P1–P4 / niskie–wysokie |
| Ustawienie | rekomendowana nazwa (propozycja zlecenia) |
| Zależności | inne pakiety, E-01 |
| Pliki | ścieżki (+ linie z weryfikacji) |
| Powiązania | FL-*, K8S-* |

#### Weryfikacja stanu (kod 5.0.7)
Wynik: POTWIERDZONE / CZĘŚCIOWO / NIEPOTWIERDZONE + fakty z plik:linia; różnice względem opisu zlecenia.

#### Specyfikacja
Cel · Wejścia · Wyjścia · Niezmienniki · Przypadki błędów · Skutki uboczne

#### Projekt rozwiązania (minimalny)

#### Kryteria akceptacji (BDD)
Scenariusze Gherkin (po polsku); obejmują kryteria odbioru ze zlecenia + uzupełnienia.

#### Testy
Jednostkowe / integracyjne / kontraktowe / E2E – pliki i nazwy przypadków.

#### DoD specyficzne
Lista kontrolna ponad wspólne DoD (§3).

#### Ryzyka i alternatywy

#### Podzadania
Lista z szacunkiem S/M/L.
```

## 5. Role agentów (przy realizacji)

| Rola | Zakres | Wynik | Weryfikacja |
|---|---|---|---|
| Weryfikator (Explore) | odczyt kodu, potwierdzenie stanu | raport plik:linia | cytaty kodu |
| Implementacja (jeden pakiet) | tylko pliki z karty pakietu | gałąź pakietu | testy z karty, `npm test` |
| Testy | brakujące przypadki, regresja | testy (czerwone przed zmianą) | uruchomienie bez/z poprawką |
| Przegląd | niezależna ocena diffu | lista uwag | DoD §3, ewaluacje |

Zasada eskalacji: niejasność wpływająca na zachowanie lub kontrakt → pytanie do Zamawiającego, nie założenie.
