# Fork Actuna-Tech/node-red – specyfika

> Opracowała firma **Actuna Sp. z o.o.** (Wojciech Repiński), z użyciem narzędzi AI.
> Dokument opisuje, czym ten fork różni się od Node-RED, jak go skonfigurować i jak w nim pracować.
> Szczegóły zmian: [CHANGELOG.md](CHANGELOG.md) (sekcje „Unreleased”); pliki zmienione bez nagłówka:
> [MODIFICATIONS.md](MODIFICATIONS.md); zasady pracy: [AGENTS.md](AGENTS.md).

## 1. Wersja bazowa i gałęzie

| Element | Wartość |
|---|---|
| Wersja bazowa | Node-RED **5.0.7** (commit `cd05a9a`, decyzja D-01) |
| `main` | wydanie forka; kamień milowy F3 (`e0017f9`) + porządki dokumentacji |
| `feature/p3-database` | prace w toku: przeładowanie flow i wiele instancji (priorytet 3, sekcja 8) |
| Zgłoszenia do Node-RED | **zablokowane** (D-04): brak PR/issues/push do `node-red/node-red`; hook `design/git-hooks/pre-push` |

**Zasada nadrzędna:** każda nowa funkcja jest **domyślnie wyłączona** – bez nowych ustawień fork zachowuje się
jak Node-RED 5.0.7 (wyjątki – poprawki błędów, sekcja 6). API v1 bez zmian.

## 2. Zalecana konfiguracja naszych instalacji

```js
// settings.js – zalecane ustawienia dla instalacji Actuna (wybrane; opis każdego w sekcji 5)
module.exports = {
    adminAuth: { /* ... */ },
    httpAdminNodeRoutes: "authenticated",   // trasy admin węzłów tylko po zalogowaniu (Z-02)
    telemetry: { enabled: false, locked: true }, // telemetria wyłączona na stałe (P-03)
    deploy: {
        response: "started",                // odpowiedź API po starcie flow (P-01)
        requireRevision: true               // każde wdrożenie z aktualną rewizją (Z-05)
    },
    editorTheme: {
        flowLayout: { enabled: true },      // kontrolki układu flow (Z-14) – WYMAGANE przy aktualizacji
        deploy: { staleFlows: "reload-only" } // nieaktualny edytor tylko przeładowuje (P-02)
    }
};
```

> **Aktualizacja istniejącej instalacji:** bez `editorTheme.flowLayout.enabled: true` kontrolki układu znikają,
> a domyślny układ użytkownika jest ignorowany (flow bez własnego `layout` rysują się poziomo).
> Przy `deploy.requireRevision: true` klienci Admin API (skrypty, MCP, CI/CD) muszą używać API v2 i wysyłać
> rewizję – przewodnik: [design/engine-extensions/MIGRACJA.md](design/engine-extensions/MIGRACJA.md).

## 3. Funkcje edytora

### Układ flow (Z-14, FL-B-004…012)
- Układ flow: poziomy `LR` (domyślny), pionowy `TB`, automatyczny `auto` – dla flow (`layout` w zakładce),
  subflow lub jako domyślny w ustawieniach użytkownika; orientacja portów pojedynczego węzła (`o: "LR"|"TB"`).
- Styl połączeń: zaokrąglony `curved` (domyślny) lub prostokątny `orthogonal` (`wireStyle`), z omijaniem węzłów.
- Eksport/import i deploy przenoszą wygląd 1:1 (także domyślny układ użytkownika – FL-B-009); okno różnic pokazuje
  właściwości układu; nieznane wartości nie giną.
- Moduł geometrii `RED.viewLayout` (`ui/view-layout.js`); zmiana orientacji/układu nie restartuje węzłów.
- Dokumentacja: [design/flow-layout/DOKUMENTACJA.md](design/flow-layout/DOKUMENTACJA.md).

### Import elementów o istniejących identyfikatorach (FL-B-010)
- Flow i subflow: wybór **„zastąp”** albo **„kopia”** w oknie konfliktu (domyślnie kopia); cofnięcie przywraca stan.
- Zablokowany flow (`locked`) nie może zostać zastąpiony – tylko kopia (R-44).
- Identyczny subflow jest rozpoznawany niezależnie od kolejności właściwości (FL-B-006).

### Ochrona przed nadpisaniem (P-02)
- `editorTheme.deploy.staleFlows: "reload-only"` – nieaktualny edytor pokazuje okno z jedyną akcją
  „Przeładuj flow” (bez „Overwrite”). Pełna ochrona wymaga także `deploy.requireRevision` (serwer).

## 4. Bezpieczeństwo

| Zmiana | Pakiet | Domyślnie |
|---|---|---|
| Pakiet `auth` przez `/comms` bez `adminAuth` nie zatrzymuje procesu (odpowiedź `auth ok`) | P-04 | poprawka |
| Nazwa użytkownika wstawiana jako tekst (XSS), odświeżenie danych po ponownym logowaniu | R-08, R-41 | poprawka |
| Subskrypcje `/comms` dopiero po uwierzytelnieniu | Z-01 | poprawka |
| Trasy admin węzłów wymagają logowania: `httpAdminNodeRoutes: "authenticated"`, `RED.auth.publicRoute()` | Z-02 | `"open"` |
| Telemetria blokowana przez administratora: `telemetry.locked` (także w edytorze) | P-03 | wyłączone |

Ograniczenie Z-02: to bezpieczniejsza wartość domyślna dla poprawnie napisanych węzłów, nie piaskownica
(opis w `settings.js`).

## 5. Admin API i potok wdrożenia

### Nowe ustawienia

| Ustawienie | Domyślnie | Działanie | Pakiet |
|---|---|---|---|
| `deploy.response` | `"stopped"` | `"started"` – odpowiedź po starcie flow; błąd startu → 500 `deploy_start_failed` z `rev`, `errors[]` | P-01 |
| `deploy.startTimeout` | brak | limit czasu startu w trybie `"started"` (500 z `start_timeout`, start trwa w tle) | P-01 |
| `deploy.startTimeoutReleasesLock` | `false` | `true` – blokada wdrożeń zwalniana po limicie (ryzyko równoległego startu) | R-45 |
| `deploy.putCreatesFlow` | `false` | `PUT /flow/:id` tworzy brakujący flow pod tym id | Z-04 |
| `deploy.requireRevision` | `false` | wdrożenie bez rewizji → 409 `version_required`; v1 zawsze 409 | Z-05 |
| `httpAdminNodeRoutes` | `"open"` | `"authenticated"` – ochrona tras admin węzłów | Z-02 |
| `telemetry.locked` | brak | blokada ustawienia telemetrii | P-03 |
| `editorTheme.flowLayout.enabled` | `false` | kontrolki układu flow | Z-14 |
| `editorTheme.deploy.staleFlows` | `"prompt"` | `"reload-only"` – nieaktualny edytor tylko przeładowuje | P-02 |

### API pojedynczego flow (`/flow`, Z-04) – nagłówek `Node-RED-API-Version: v2`
- `GET /flow/:id` → `rev` (rewizja flow) + nagłówek `ETag`; `If-Match` równoważne `rev`.
- `PUT /flow/:id` → `{id, rev, revAll}`; opcjonalnie `globalConfigs[]` + `globalRev`.
- `POST /flow` → **201** `{id, rev}` (v1: 200 `{id}`); `DELETE /flow/:id?rev=`.
- Kody błędów (snake_case): `version_mismatch`, `version_required`, `invalid_revision`, `duplicate_id`,
  `invalid_flow_id`, `invalid_node_type`, `deploy_start_failed`, `deploy_stop_failed` – katalog:
  [design/engine-extensions/ZASADY.md](design/engine-extensions/ZASADY.md) §2.4.

### Potok wdrożenia (E-01)
- Wspólna blokada (`runtime/lib/flows/lock.js`) dla `POST /flows`, `/flow`, `POST /flows/state` i operacji
  Projektów (zmiana gałęzi, pull, revert, scalanie); druga operacja czeka. Blokada trwa do końca startu flow (R-43).
- Potok `runtime/lib/flows/pipeline.js` – kroki i punkty rozszerzeń: ZASADY §2.3.

## 6. Zmiany zachowania względem 5.0.7 (poprawki błędów)

- Restart flow przy 409 i przyciski „Merge”/„Ignore & deploy” nie kończą się błędem skryptu.
- Odrzucony start flow jest logowany (zamiast nieobsłużonego odrzucenia obietnicy).
- `PUT /flow/:id` z id węzła z innego flow → 400 `duplicate_id` (wcześniej zdublowane id).
- Nieprawidłowy `Node-RED-API-Version` na `/flow` – traktowany jak v1 z ostrzeżeniem w logu (R-46).
- Operacje stanu flow i Projektów czekają na trwające wdrożenie (wcześniej mogły się na nie nałożyć).

## 7. Testy i proces

| Element | Zasada |
|---|---|
| Testy jednostkowe | `npm test` / `npx mocha test/unit/_spec.js "test/unit/**/*_spec.js"`; 5 testów `projects/ssh` wymaga `ssh-keygen` |
| Testy E2E | `npm run test:e2e` – Playwright **nie** jest w repozytorium (D-03): `npm i --no-save playwright`; bez niego testy są pomijane |
| Nagłówki modyfikacji | każdy zmieniony plik: blok „Modified by Actuna Sp. z o.o.” (D-19); JSON i szablon `settings.js` – w MODIFICATIONS.md |
| Commity | autor Wojciech Repiński, `Signed-off-by` (DCO), udział AI w `Co-Authored-By` |
| Zależności npm | bez nowych zależności bez zgody Zamawiającego |
| Przegląd | każda faza: niezależny przegląd (DoD – ZASADY §3) |
| Decyzje | [design/engine-extensions/REJESTR-DECYZJI.md](design/engine-extensions/REJESTR-DECYZJI.md) (R-01…) |
| Plan i budżet | [design/PRIORYTETY.md](design/PRIORYTETY.md) |

## 8. W toku (gałąź `feature/p3-database`)

Ogólne API rdzenia do pracy wielu instancji (edytor + instancje wykonawcze); prywatne wtyczki magazynu
i koordynacji podpina się poza tym repozytorium:
- E-02 – model stanów instancji; Z-08 – sondy `/health/live`, `/health/ready`, drenaż przy SIGTERM;
- Z-09 – przeładowanie flow po zmianie w magazynie (`watchFlows`, hook `preReload` z limitem – drenaż pracy w toku,
  łączenie powiadomień), także dla `flows.json` na wspólnym wolumenie;
- Z-10 – koordynacja (`RED.coordination`, wtyczka lokalna), `inject` „tylko jedna instancja”;
- Z-11 – katalog użytkownika tylko do odczytu; Z-15 – instancja tylko do edycji (`editorOnly`).

Opis zostanie przeniesiony do sekcji 3–6 po scaleniu z `main`.
