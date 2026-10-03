# Zlecenie rozszerzeń silnika – zasady wspólne dla backlogu

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.
> Dokument towarzyszy [ANALIZA.md](ANALIZA.md) (analiza zgodności i plan). Karty pakietów: [backlog/](backlog/).

## 1. Identyfikatory i powiązania

- Pakiety zlecenia: `P-01`…`P-04`, `Z-01`…`Z-13`; nasz pakiet proponowany: `Z-14` (układ flow).
- Zadania przekrojowe: `E-nn` (np. `E-01` – kontrakt potoku wdrożenia).
- Powiązania z istniejącymi backlogami: `FL-*` ([../flow-layout/BACKLOG.md](../flow-layout/BACKLOG.md)), `K8S-*` ([../k8s-postgres/BACKLOG.md](../k8s-postgres/BACKLOG.md)).
- Statusy i priorytety jak w backlogu układu flow (§1).

## 2. Decyzje (pkt 3.4 zlecenia)

> **Decyzje Zamawiającego z 2026-10-03:** D-01 baza **5.0.7**; D-02 rekomendacje nazw **przyjęte po krytycznym
> sprawdzeniu** (wynik w §2.1a); D-03 **bez Playwright w repozytorium** – E2E to osobny podzbiór testów;
> D-10 przyjęte. Szczegóły i pozostałe decyzje: [ANALIZA.md](ANALIZA.md) §7.

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
| Z-15 | – | `editorOnly: false` (alternatywa: `runtimeState.autoStart`) | jedno znaczenie: instancja wczytuje flow, nie uruchamia ich i nie zapisuje stanu w magazynie |
| Z-06 | – | `deploy.hookTimeout: 30000` (ms) | hook `preDeploy` działa pod blokadą wdrożeń – limit chroni przed zablokowaniem API |
| Z-09 | – | `deploy.reload: { watch: false, type: "full" \| "diff", preReloadTimeout: 1200000, concurrency: <opcjonalnie> }` | `type` domyślnie `"full"` (jak dzisiejszy `reload`); dla długich rozmów rekomendowane `"diff"`; `concurrency` wymaga wtyczki koordynacji (Z-10) |
| Z-10 | – | `coordination: { plugin, options }`; właściwość węzła `inject`: `singleInstance` | wybór wtyczki jak `contextStorage`; domyślnie wtyczka lokalna |
| Z-03 | – | `externalModules.palette.allowDowngrade: true` (domyślnie = zachowanie 5.0.6) | `false` blokuje instalację starszej wersji z `.tgz` (rekomendowane w produkcji); domyślna wartość nie zmienia dzisiejszego zachowania (DoD §3) |
| Z-08 | – | `health.host` (opcjonalnie); **`shutdownTimeout`** (płasko, domyślnie wyłączony drenaż – zachowanie 5.0.6); API osadzających `RED.health` | drenaż przy SIGTERM (D-11); nazwa płaska jak `nodeCloseTimeout`/`functionTimeout` – to cykl życia procesu, nie sonda |
| E-02 | – | zdarzenie `instance:state`, odczyt `runtime.state` | jedno źródło stanu dla P-01, Z-08, Z-09, Z-15 |
| Z-12 | – | `RED.header`, `RED.dialog`, `RED.deploy.addMenuItem`, hook edytora `deployPre` | robocze – do potwierdzenia po załączniku B |

### 2.1a Krytyczne sprawdzenie nazw (D-02, wynik)

Sprawdzone w szablonie `packages/node_modules/node-red/settings.js` i w kodzie (runtime, editor-api, editor-client, registry):

| Nazwa | Kolizja / konwencja | Wynik |
|---|---|---|
| `deploy.*` | brak klucza `deploy` w ustawieniach i kodzie runtime; obiekty grupujące mają precedensy (`runtimeState`, `telemetry`, `externalModules`) | **przyjęte** |
| `editorTheme.deploy.staleFlows` | `editorTheme` ma już m.in. `palette`, `projects`, `codeEditor`, `deployButton` (wygląd przycisku) – `deploy` jako osobny obiekt zachowania, nie wyglądu | **przyjęte**; w dokumentacji odróżnić od `deployButton` |
| `telemetry.locked` | obiekt `telemetry` istnieje w szablonie | **przyjęte** |
| `httpAdminNodeRoutes` | spójne z rodziną `httpAdmin*` (`httpAdminRoot`, `httpAdminMiddleware`, `httpAdminCookieOptions`) | **przyjęte** |
| `health: {enabled, path, port, host}` | brak kolizji; struktura jak `diagnostics: {enabled, ui}` | **przyjęte** |
| `health.shutdownTimeout` | zatrzymanie procesu to nie sonda; płaskie limity czasu w projekcie: `nodeCloseTimeout`, `functionTimeout`, `globalFunctionTimeout` | **zmienione na `shutdownTimeout`** |
| `readOnlyUserDir` | **istnieje nieudokumentowane `readOnly`** używane przez magazyn plikowy (`storage/localfilesystem/index.js:49,59`, `library.js:148`) – po cichu pomija zapis | **przyjęte**; zmiana znaczenia `readOnly` złamałaby zgodność – w Z-11 opisać relację: `readOnlyUserDir` obejmuje cały runtime i zgłasza błąd zamiast cichego pominięcia; `readOnly` bez zmian |
| `editorOnly` | symetryczne do istniejącego `disableEditor` (płaskie, boolean) | **przyjęte**; `editorOnly` + `disableEditor` jednocześnie = błąd konfiguracji przy starcie |
| `coordination: {plugin, options}` | wzorzec jak `contextStorage`; typ wtyczki jak `node-red-library-source` | **przyjęte** |
| `externalModules.palette.allowDowngrade` | spójne z `allowInstall`, `allowUpdate`, `allowUpload` | **przyjęte** (domyślnie `true` = 5.0.6) |
| `editorTheme.flowLayout` | spójne z `editorTheme.codeEditor`, `markdownEditor` | **przyjęte** |
| hooki `preDeploy`, `postDeploy`, `preReload`, `preShutdown` | konwencja `pre*/post*` jak `preInstall/postInstall` | **przyjęte** (rozszerzenie `VALID_HOOKS`) |
| `RED.auth.publicRoute()`, `node.registerHttpRoute()`, `RED.coordination` | brak kolizji w API węzłów (`registry/lib/util.js`) | **przyjęte** |
| kody błędów `snake_case` | jak istniejące `version_mismatch`, `module_already_loaded`, `invalid_request` | **przyjęte** |

### 2.2 Wersja bazowa
Zlecenie wskazuje `5.0.6`. Wydanie `5.0.7` zawiera poprawki bezpieczeństwa (migracja na załataną
bibliotekę JSONata, aktualizacja `body-parser`). **Decyzja D-01: baza `5.0.7`.**

### 2.3 Kontrakt potoku wdrożenia (zadanie E-01)
Pakiety P-01, Z-04, Z-05, Z-06, Z-08, Z-09, Z-15 oraz nasze FL-B-001/FL-B-002 zmieniają te same funkcje
(`runtime/lib/api/flows.js`, `runtime/lib/flows/index.js`, `editor-api/lib/admin/flow(s).js`).
Wspólna kolejność kroków (rozstrzygnięcia K-1…K-3 z [PRZEGLAD.md](PRZEGLAD.md) – **propozycja do zatwierdzenia**):

**A. Wdrożenie przez Admin API lub wywołanie wewnętrzne** (`/flows`, `/flow`, `/flow/:id`, typ `reload`):
```
 1. przyjęcie żądania (źródło: api | internal)
 ── blokada wdrożeń (mutex, runtime/lib/api/flows.js) ──────────────────────────
 2. kontrola rewizji            – istniejące 409 version_mismatch; Z-05 version_required; Z-04 rewizja flow
       (typ reload: odczyt magazynu tutaj, pod blokadą – preDeploy w kroku 3 widzi treść, która zostanie uruchomiona)
 3. hook preDeploy              – Z-06; tylko walidacja, limit deploy.hookTimeout; odrzucenie → 400 deploy_rejected
 4. stan = "deploying"          – E-02 / Z-08 (/ready → 503)
 5. zapis do magazynu           – (typ reload: brak zapisu – treść odczytana w kroku 2)
 6. zatrzymanie zmienionych węzłów
       tryb domyślny: jak 5.0.6 (błędy zatrzymania połykane – D-05);
       tryb deploy.response="started": błąd zatrzymania → 500 deploy_stop_failed (z rev)
 7. start nowych węzłów         – Z-15 editorOnly: krok pominięty
 8. stan = "ready" (lub "failed" przy błędzie startu)
 ── koniec blokady ─────────────────────────────────────────────────────────────
 9. zdarzenie runtime-deploy (edytory)
10. ODPOWIEDŹ HTTP
       deploy.response="stopped" (domyślnie): odpowiedź już po kroku 6, kroki 7–9 kończą się asynchronicznie (jak 5.0.6)
       deploy.response="started": odpowiedź po kroku 9; błąd startu → 500 deploy_start_failed (z rev – konfiguracja jest zapisana)
11. hook postDeploy             – Z-06; asynchronicznie, nie wstrzymuje odpowiedzi, błąd tylko w logu (nie cofa wdrożenia)
```

**B. Przeładowanie po zmianie w magazynie** (Z-09, `watchFlows`):
```
 1. powiadomienie (rewizja != aktywna lub credentialsChanged) – koalescencja: kolejne powiadomienia w trakcie = jedno następne przeładowanie
 2. stan = "reloadPending" (bez blokady); koordynacja: zajęcie slotu przeładowania (deploy.reload.concurrency, Z-10)
 3. hook preReload (bez blokady) – czeka na zakończenie pracy w toku, limit deploy.reload.preReloadTimeout;
       /ready → 503 od tej chwili (drenaż)
    Jeśli w tym czasie przyjdzie wdrożenie (A) na tej instancji – oczekujące przeładowanie jest unieważniane
    (wdrożenie samo ustala nową konfigurację).
 ── blokada wdrożeń ─────────────────────────────────────────────────────────────
 4. ponowny odczyt magazynu (najnowsza rewizja)
 5. stan = "reloading"; kroki A6–A8 (type "full": wszystkie flow; "diff": tylko zmienione)
 ── koniec blokady ──
 6. zdarzenie runtime-deploy; hook postDeploy (source: "storage"); BEZ preDeploy
    (zmianę zatwierdziła instancja, która ją zapisała – jej preDeploy już się wykonał)
```

**C. Zatrzymanie procesu** (Z-08, D-11): SIGTERM/SIGINT → stan `stopping` (/ready 503, nieodwracalny) →
hook `preShutdown` / oczekiwanie do `shutdownTimeout` → `RED.stop()` → zamknięcie serwera HTTP → wyjście.
Bez ustawionego `shutdownTimeout` – zachowanie 5.0.6 (natychmiastowe zatrzymanie).

### 2.4 Katalog kodów błędów (propozycja)

Konwencja: `snake_case` we wszystkich polach `code` (także `errors[].code` z E-01); odpowiedź
`{ code, message, rev? }`; istniejące kody bez zmian.

| Kod | HTTP | Pakiet | Kiedy |
|---|---|---|---|
| `version_mismatch` | 409 | istniejący, Z-04 | rewizja w żądaniu ≠ aktualna (całość lub flow) |
| `version_required` | 409 | Z-05 | `deploy.requireRevision: true` i brak rewizji (nazwa jak w łatce 0006 Zamawiającego – decyzja D-20) |
| `invalid_revision` | 400 | Z-04 | rewizja w złym formacie |
| `deploy_rejected` | 400 | Z-06 | `preDeploy` odrzucił wdrożenie (komunikat z hooka) |
| `deploy_hook_timeout` | 400 | Z-06 | `preDeploy` przekroczył `deploy.hookTimeout` |
| `deploy_stop_failed` | 500 | P-01 | tryb `started`: błąd zatrzymania węzłów |
| `deploy_start_failed` | 500 | P-01 | tryb `started`: błąd startu (zawiera `rev` i `errors[]`) |
| `invalid_flow_id` | 400 | Z-04 | `PUT /flow/:id` z niedozwolonym id przy `deploy.putCreatesFlow` |
| `duplicate_id` | 400 | Z-04 | id węzła/konfiguracji należy do innego flow |
| `module_downgrade_not_allowed` | 400 | Z-03 | `.tgz` ze starszą wersją przy `allowDowngrade: false` |
| `invalid_node_type` | 400 | Z-04 | węzeł w `globalConfigs[]` nie jest węzłem konfiguracyjnym |
| `upload_not_allowed` | 400 | **Z-03 (nowy kod)** | upload wyłączony – dziś `Error` bez kodu / `invalid_request` |
| `read_only_user_dir` | 400 | Z-11 | operacja wymagająca zapisu przy `readOnlyUserDir: true` |
| `editor_only` | 409 | Z-15 | operacja wymagająca działających flow (np. `inject`) na instancji edycyjnej |
| `state_operation_in_progress` | 409 | E-02 | (wewnętrzny) próba drugiej operacji stanu pod blokadą |

## 3. Wspólne Definition of Done (każdy pakiet)

Łączy wymagania zlecenia (§3) z praktykami pracy:

- [ ] **Specyfikacja** w karcie zatwierdzona (cel, wejścia/wyjścia, niezmienniki, błędy, skutki uboczne, kryteria BDD).
- [ ] **Zgodność wstecz:** nowe zachowanie domyślnie wyłączone; przy domyślnych ustawieniach wszystkie istniejące testy przechodzą bez zmian (wyjątek: pakiety „poprawka błędu”).
- [ ] **Testy najpierw:** test odtwarzający problem / wymaganie (czerwony) przed implementacją; dla poprawek błędów – test, który pada bez poprawki.
- [ ] **Testy obu stanów ustawienia** i ścieżek błędów, w strukturze `test/unit/...` (mocha/should).
- [ ] **`npm test` przechodzi** (build, verify-deps, lint, coverage). Uruchamiane w środowisku z `ssh-keygen` (testy projektów); każdy pominięty/środowiskowy błąd wymieniony z uzasadnieniem.
- [ ] **Brak nazw produktów** w kodzie, komunikatach, ustawieniach i testach; **nagłówki o modyfikacji** „Modified by Actuna Sp. z o.o.: <opis>” w każdym zmienionym pliku forka (pkt 4(b) licencji Apache 2.0 – D-19; gałęzie do ewentualnego zgłoszenia upstream bez nich); brak nowych zależności npm bez zgody.
- [ ] **Dokumentacja:** ustawienie w szablonie `packages/node_modules/node-red/settings.js` (zakomentowane, z opisem); JSDoc dla nowego API; wpis do CHANGELOG (bez nazw produktów); teksty UI w `locales/en-US` (+ `pl` po Z-13).
- [ ] **Kontrakty:** zmiany Admin API opisane i pokryte testami kontraktu (stare wywołania bez zmian).
- [ ] **Dostarczenie:** osobna gałąź pakietu względem wersji bazowej (5.0.7) w forku `Actuna-Tech/node-red`; commity w stylu projektu, autor i `Signed-off-by`: Wojciech Repiński (Actuna Sp. z o.o.) – D-04; **bez PR/push do `node-red/node-red`**; zależności między pakietami jawnie opisane.
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
  - name: modification_notices          # D-19
    requirement: present_in_every_modified_file_of_the_fork
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
