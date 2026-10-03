# Rewizja D-02 – nazwy ustawień i API (zestawienie)

> **Autorstwo:** opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

Data: 2026-10-03 · powód: załącznik A podaje nazwy ze zlecenia · metoda: dwie niezależne analizy (model Fable) –
[architekt](NAZWY-ARCHITEKT.md) (konwencja i kod) i [analityk](NAZWY-ANALITYK.md) (migracja, narzędzia, odbiór).

## Rekomendacja: utrzymać D-02 w całości

Obie analize niezależnie potwierdzają wszystkie nazwy z [ZASADY.md](ZASADY.md) §2.1/§2.1a oraz kod `version_required` (D-20).
Żadna nazwa nie koliduje z kodem 5.0.7.

| Różnica względem zlecenia | Charakter | Uzasadnienie (dowód) |
|---|---|---|
| `editor.staleFlowsPolicy` → `editorTheme.deploy.staleFlows` | **merytoryczna** | w edytorze `RED.settings.get()` szuka najpierw w ustawieniach użytkownika (`editor-client/src/js/settings.js:60-76`), a `ui/userSettings.js:353-356` zapisuje `get('editor')` z powrotem do profilu użytkownika → polityka serwera utrwaliłaby się w profilu i mogłaby zostać nadpisana przez klienta z `settings.write` (korekta: w runtime mapy są rozdzielone – `runtime/lib/settings.js:22-25,60-76`) |
| `node.registerRoute` → `node.registerHttpRoute` | **merytoryczna** | „route” w Node-RED oznacza też trasowanie komunikatów (hook `preRoute`, `util/lib/hooks.js:6`) |
| `flows.*` → `deploy.*` | kosmetyczna | brak kolizji w obu wariantach; `deploy.*` grupuje ustawienia wdrożenia z hookami `preDeploy/postDeploy`, `deploy.reload`, `deploy.hookTimeout` |
| `RED.auth.public()` → `RED.auth.publicRoute()` | kosmetyczna | czytelność wywołania |

**Koszt migracji:** zerowy dla konfiguracji – łatki 0002–0006 nie czytają żadnego ustawienia (działają na sztywno);
jedyne kontrakty zewnętrzne łatek to 409 `version_required` (zachowany) i klucze i18n `deploy.confirm.staleFlows*`.
**Realny koszt to zachowanie:** po przejściu na fork trzeba jawnie włączyć dotychczasowe zachowanie (wartości domyślne = 5.0.7):

```js
deploy: { response: "started", requireRevision: true },
editorTheme: { deploy: { staleFlows: "reload-only" } },
telemetry: { enabled: false, locked: true },
```
Bez tego automaty MCP/CI mogą dostawać sporadyczne 404 po wdrożeniu → **notatka migracyjna jest warunkiem odbioru P-01**.

## Uzupełnienia zapisu (nazwy bez zmian)

| # | Uzupełnienie | Gdzie |
|---|---|---|
| U1 | tabela mapowania „zlecenie / załącznik A → fork” jako oficjalna, wskazana w protokole odbioru | ZASADY §2.1 |
| U2 | odróżnienie `editorTheme.deploy` (zachowanie) od `editorTheme.deployButton` (wygląd) i od ustawień użytkownika `editor` | karta P-02, szablon `settings.js` |
| U3 | `deploy.reload.*` = to samo przeładowanie, które Admin API wykonuje typem wdrożenia `reload` | karta Z-09, `settings.js` |
| U4 | „`version` w kodach błędów oznacza rewizję flow (`rev`)”; rozstrzygnąć `rev: ""` (409 jak w łatce vs 400 `invalid_revision`) | ZASADY §2.4 – pytanie N-01 |
| U5 | `waitForDeployStart()` nie jest kontraktem (moduł wewnętrzny) – alias tylko, jeśli używany poza runtime | karta P-01 – pytanie N-02 |
| U6 | tabela „ustawienie ↔ manifest K8s” (`health.port` ↔ `readinessProbe`, `shutdownTimeout` < `terminationGracePeriodSeconds`) | karta Z-08, MIGRACJA.md §3.3 |
| U7 | bez aliasów i ostrzeżeń dla `flows.*`/`editor.*` (nigdy nie działały) – chyba że któreś środowisko już je wpisało | pytanie N-03 |
| U8 | lista kluczy zarezerwowanych: węzeł o typie `deploy`/`flows`/`health` mógłby przez regułę prefiksu `registerNodeSettings` wyeksportować cały obiekt do edytora (`runtime/lib/settings.js:127-158`) | ZASADY §2.1a |

## Dodatkowe ustalenia z kodu (poza nazwami)

- Błąd 5.0.7: `editor-api/lib/editor/theme.js:432-434` przypisuje `help` do `tours` – poprawić przy dopisywaniu kluczy `editorTheme` (Z-14, P-02).
- Istniejące `readOnly` pomija po cichu także `saveFlows`/`saveCredentials` (`storage/localfilesystem/projects/index.js:606,651`) – potwierdza ustalenie z Z-11.

## Pytania do Zamawiającego

| ID | Pytanie |
|---|---|
| N-01 | Pusty `rev: ""` – 409 `version_required` (jak łatka 0006) czy 400 `invalid_revision`? Rekomendacja: 409 (zgodność z łatką). |
| N-02 | Czy coś poza runtime woła `waitForDeployStart()`? |
| N-03 | Czy w jakimkolwiek środowisku (`settings.js`, Helm, obraz) wpisano już `flows.*`, `editor.staleFlowsPolicy`, `telemetry.locked`? |
| N-04 | Czy narzędzia MCP/CI/CD używają Admin API v2 i sprawdzają `code === "version_required"`? |
