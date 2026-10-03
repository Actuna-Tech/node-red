# Backupy, eksport, import – audyt i lista problemów

> **Autorstwo:** rozwiązanie opracowała firma **Actuna Sp. z o.o.** w osobie **Wojciecha Repińskiego** (developer), z użyciem narzędzi AI.

Audyt z 2026-10-03: sprawdzono, czy właściwości układu (`layout`, `wireStyle` na flow
i subflow, `o` na węźle) przechodzą przez wszystkie ścieżki zapisu, kopii, eksportu,
importu i scalania. Każdy punkt oznaczono, jak został zweryfikowany.

## 1. Problemy do poprawienia

Pozycje są prowadzone w [BACKLOG.md](BACKLOG.md): P1 = FL-B-001 (zamknięte), P2 = FL-B-004, P3 = FL-B-005, P4 = FL-B-006.

| # | Problem | Status | Waga | Weryfikacja |
|---|---|---|---|---|
| P1 | Admin API pojedynczego flow (`POST /flow`, `GET /flow/:id`, `PUT /flow/:id`) gubiło `layout`/`wireStyle` | **naprawione** (`556b053`) | wysoka | testy jednostkowe runtime (bez poprawki padały) + test E2E przez HTTP |
| P2 | Okno **Review Changes** (konflikt przy deployu) oraz różnice commitów w **Projektach** nie pokazują wiersza `layout`/`wireStyle`/`o`, jeśli właściwość nie istniała w wersji bazowej. Element jest oznaczony jako „changed”, ale nie widać, co się zmieniło | **otwarte** | średnia (tylko prezentacja – scalanie działa poprawnie) | odtworzone w przeglądarce (lokalna zmiana + zdalny deploy dodający `layout` i `o`) |
| P3 | Nieprawidłowa wartość z importu (np. `layout: "XY"`, `o: "XY"`) jest zachowywana w pliku flow; rysowanie ją ignoruje (domyślny układ), a pole wyboru we właściwościach jest puste i po zapisie dialogu wartość jest po cichu usuwana | **otwarte** | niska | analiza kodu (`getFlowLayoutOptions`, `getNodeOrientation`, `RED.editor.flowLayout`) |
| P4 | Dopasowanie identycznego subflow przy imporcie porównuje tekst JSON, więc zależy od kolejności kluczy. Plik z `layout` w innym miejscu obiektu (edycja ręczna, inne narzędzia) nie zostanie rozpoznany jako ten sam subflow | **naprawione – do weryfikacji** (`6feb771`, FL-B-006; problem istniejący w Node-RED; kolejność węzłów – FL-B-011) | niska | analiza kodu + testy jednostkowe (`checkForMatchingSubflow` w `nodes.js`) |

### P2 – szczegóły

- Przyczyna: `createNodePropertiesTable` w `ui/diff.js` buduje listę wierszy z kluczy
  **wersji bazowej** węzła/zakładki (`Object.keys(node)`) i z `defaults` typu. Właściwość
  dodana lokalnie lub zdalnie (a nie istniejąca wcześniej) nie dostaje wiersza.
- Dotyczy też innych właściwości spoza `defaults` (np. `l`, `d`, `icon`) – to błąd istniejący
  w Node-RED, ale nowe właściwości układu go uwidaczniają, bo zwykle są **dodawane**.
- Skutek: przy konflikcie użytkownik widzi „Flow Properties – changed” bez wskazania zmiany.
  Wynik scalania jest poprawny (sprawdzone: zdalny `layout`/`o` trafia do edytora,
  lokalne przesunięcie węzła zostaje).
- Proponowana poprawka: lista wierszy jako suma kluczy wersji bazowej, lokalnej i zdalnej
  (z pominięciem `x`, `y`, `w`, `h`, `z`, `wires`, `id`, `type`) + test E2E scenariusza konfliktu.

### P3 – proponowana poprawka

- przy imporcie i wczytywaniu flow odrzucać (lub ostrzegać o) wartościach spoza
  `LR`/`TB`/`auto` i `curved`/`orthogonal`,
- w polu wyboru pokazywać nieznaną wartość jako osobną opcję, żeby nie znikała po cichu.

### P4 – proponowana poprawka

- porównywać subflow po znormalizowanych obiektach (np. `RED.utils.compareObjects`
  lub JSON z posortowanymi kluczami) zamiast surowego tekstu.

## 2. Ścieżki sprawdzone – działają

| Ścieżka | Wynik | Weryfikacja |
|---|---|---|
| Deploy → plik flow | właściwości zapisane | test E2E, test jednostkowy runtime |
| Kopia zapasowa `.flows.json.backup` | to poprzednia wersja pliku, z właściwościami układu w poprzednim stanie; przywrócenie przywraca też układ | sprawdzone na plikach serwera demo |
| Deploy „Modified nodes/flows” | zmiana tylko układu nie restartuje węzłów | testy jednostkowe runtime |
| Eksport „bieżący flow” / „wszystkie flow” / „zaznaczone” | zgodnie z [DOKUMENTACJA.md](DOKUMENTACJA.md#eksport-import-i-przenoszalność) | testy E2E przez okno eksportu |
| Import przez okno Import (tekst, plik) | właściwości odtworzone, flow rysuje się w zapisanym układzie | testy E2E |
| Kopiuj/wklej | `o` zachowane, pozostałe węzły przyjmują układ flow docelowego | test E2E |
| Subflow z instancją | `layout`/`wireStyle` subflow przeniesione | test E2E |
| Import „zastąp” (konflikt id) | subflow i węzły konfiguracyjne są zastępowane całym obiektem – układ przechodzi; dla zakładek nie ma opcji „zastąp” | analiza kodu (`replaceNodes`) |
| Scalanie przy konflikcie (Merge) | zdalne i lokalne zmiany układu scalone poprawnie | sprawdzone w przeglądarce |
| Biblioteka (zapis/wczytanie flow) | używa tego samego JSON co eksport/import | analiza kodu (`clipboard.js`) |
| Admin API `GET`/`POST /flows` | właściwości zachowane | test E2E |
| Admin API `POST`/`GET`/`PUT /flow` | właściwości zachowane po poprawce P1 | testy jednostkowe + E2E |
| Undo importu / scalania | przywraca poprzedni stan razem z układem | analiza kodu (zdarzenia historii `add`/`replace`) |

## 3. Ograniczenia (nie są błędami)

- Ustawienie domyślne użytkownika nie jest częścią flow – flow bez własnego `layout`
  wygląda na innej instancji zgodnie z ustawieniami tamtego użytkownika.
- Starsze wersje Node-RED wczytają flow (w układzie lewo → prawo), ale przy ponownym
  eksporcie z nich właściwości układu zostaną pominięte.
- Układ flow można zmienić także w zablokowanym flow – tak jak inne właściwości zakładki
  (w tym samą blokadę). To zmiana wyłącznie wizualna; orientacja pojedynczych węzłów w
  zablokowanym flow jest chroniona.
