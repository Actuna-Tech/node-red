# Log pracy – układ flow i routing linii

> **Autorstwo:** rozwiązanie opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

Gałąź: `claude/loving-fermat-ftfo9h`

Godziny kroków przed pierwszym commitem są orientacyjne; godziny commitów pochodzą z historii git.

## 2026-10-03

| Godz. | Krok | Wynik |
|---|---|---|
| 08:15 | Analiza kodu edytora (`view.js`, `nodes.js`, panele edycji, ustawienia użytkownika, historia undo) | zmapowane wszystkie miejsca z poziomą geometrią – patrz [ANALIZA.md](ANALIZA.md) §2 |
| 08:20 | Projekt modelu danych | `o` na węźle (zarezerwowana litera), `layout`/`wireStyle` na zakładce i subflow, preferencje użytkownika; eksport tylko gdy ustawione |
| 08:25 | Implementacja w `nodes.js` | eksport/import `o`, `layout`, `wireStyle`; ochrona `o` w zablokowanych flow |
| 08:30 | Implementacja geometrii i routingu w `view.js` | pozycje portów, rozmiar węzła, status w TB, linie, przeciąganie, quick‑add, linki off‑flow, porty subflow; styl prostokątny; tryb auto |
| 08:35 | UI ustawień | właściwości flow, wygląd węzła/subflow, ustawienia użytkownika, menu kontekstowe i akcje |
| 08:40 | Weryfikacja w przeglądarce (Playwright, zrzuty 6 flow testowych) | LR bez zmian; poprawka: linie między portami prostopadłymi skierowanymi od siebie przecinały węzeł → obejście |
| 08:44 | Test interakcji: przeciąganie, dialogi, undo, eksport, deploy przez API | wszystko działa; runtime zachowuje właściwości |
| 08:46 | Commit `e564e91` | implementacja |
| 08:49 | Refaktor: czysta geometria do `view-layout.js` (`RED.viewLayout`) | zrzuty po refaktorze identyczne bajt w bajt; commit `b23a125` |
| 08:50 | Testy jednostkowe geometrii (46) | commit `21e79c6` |
| 08:52 | Znaleziony problem: deploy „Modified nodes” restartowałby węzły po zmianie `o` lub układu subflow | poprawka `diffNodes` + testy runtime (sprawdzone, że bez poprawki padają); commit `036dd6a` |
| 08:58 | Testy E2E w Playwright (17) + `npm run test:e2e` | commit `9cb0ae8` |
| 09:05 | Dokumentacja (`design/flow-layout/` – katalog `docs/` jest ignorowany przez git), log pracy, CHANGELOG, oznaczenie autorstwa | ten commit |
| 09:22 | Nagranie demonstracyjne (Playwright + ffmpeg, podpisy i widoczny kursor) | `node-red-flow-layout-demo.mp4`, skrypt `demo/record-demo.js` |
| 09:35 | Weryfikacja przenoszalności (eksport/import, schowek, subflow, Admin API) | eksport/import w edytorze działał; **znaleziona luka**: `POST/GET/PUT /flow` gubiły `layout`/`wireStyle` → poprawka w `runtime/lib/flows/index.js` |
| 09:45 | Testy przenoszalności | 3 testy jednostkowe runtime (bez poprawki padają) + 5 testów E2E (okna eksportu/importu, kopiuj/wklej, subflow, Admin API) |
| 10:00 | Audyt backupów, eksportu, importu, scalania i biblioteki | wyniki w [PROBLEMY.md](PROBLEMY.md): P1 naprawione wcześniej; **P2 otwarte** – okno Review Changes nie pokazuje dodanych `layout`/`o` (odtworzone w przeglądarce, scalanie działa); P3, P4 – drobne, otwarte |
| 10:15 | Backlog błędów i zadań z Definition of Done/Ready i szablonami zgłoszeń | [BACKLOG.md](BACKLOG.md): 5 otwartych błędów, 7 zadań, 4 pozycje zamknięte; sekcja na tematy do analizy |
| 10:40 | Analiza przeniesienia stanu poza lokalne pliki (na podstawie kodu runtime, registry, editor-api) | karta FL-A-001 w backlogu (wynik poza repozytorium) |
| F2 | Z-14: ustawienie `editorTheme.flowLayout.enabled` (test-first: 2 + 22 testy czerwone) | commit `405e844`; E2E obu stanów ustawienia |
| F2 | E-04: `MODIFICATIONS.md` (pliki bez nagłówka, szablon) | commit `2e961c9` |
| F2 | FL-B-006: analiza i poprawka dopasowania subflow (2 testy czerwone) | commit `6feb771`; pokrewne FL-B-011 |
| F2 | FL-B-007: podpowiedzi portów w TB (4 jednostkowe + 1 E2E czerwone) | commit `d28848d` |
| F2 | FL-B-008: etykiety linków do innych zakładek w TB (6 jednostkowych + 1 E2E czerwone) | commit `122cfdc`; znaleziony FL-B-012 |

## Wyniki testów (ostatnie uruchomienie)

Faza F2 (2026-10-03, po `122cfdc`):

| Zestaw | Wynik |
|---|---|
| `npm run lint` | bez błędów |
| jednostkowe edytora (`test/unit/@node-red/editor-client`) | 161 ✔ |
| jednostkowe editor-client + editor-api | 412 ✔, 1 pending |
| E2E (`npm run test:e2e`, Playwright spoza repozytorium) | 38 ✔ (33 z `flowLayout.enabled: true`, 5 bez ustawienia) |
| build (`npm run build`) | OK |
| runtime | nie uruchamiane w F2 (brak zmian w runtime) |

Wcześniejsze uruchomienie (implementacja): lint bez błędów; editor-client 54 ✔; runtime + editor-api + editor-client
953 ✔, 8 pending, 5 ✘ (testy SSH projektów – brak `ssh-keygen`); E2E 22 ✔.

## Otwarte tematy

Prowadzone w [BACKLOG.md](BACKLOG.md).

- problemy P2–P4 z [PROBLEMY.md](PROBLEMY.md),

- automatyczne rozmieszczanie węzłów zgodnie z układem,
- routing omijający wszystkie węzły (nie tylko końcowe),
- tooltipy etykiet portów w układzie TB, obrócone etykiety linków off‑flow,
- tłumaczenia tekstów na pozostałe języki.
