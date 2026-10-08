# Weryfikacja aplikacji — 8 października 2026

Sprawdzono kod, automatyczne testy, kompilację produkcyjną, działające API oraz
przebieg badania w przeglądarce. Testy działania wykonywano w osobnej kopii
aplikacji z własnymi materiałami, konfiguracją, hasłem i bazą SQLite. Nie zmieniano
konfiguracji użytkownika, jego pliku `.env.local`, stymulów ani zebranych wyników.

## Wynik

- `npm test`: 44 testy zakończone poprawnie.
- `npm run lint`: brak błędów i ostrzeżeń.
- `npm run build`: kompilacja produkcyjna zakończona poprawnie.
- Działające API: 16 ukończonych sesji w macierzy konfiguracji, 56 ocen i 60
  odpowiedzi kontrolnych; liczby potwierdzone bezpośrednio w bazie.
- Przeglądarka: dodatkowe ukończone sesje z filmem, zdjęciem i ponownym
  pobraniem filmu po błędzie 404. Łącznie testowa baza zawierała 19 ukończonych
  sesji, 60 ocen i 65 odpowiedzi. Te liczby dotyczą wyłącznie danych testowych.
- Brak błędów i ostrzeżeń konsoli w sprawdzonych poprawnych przebiegach
  uczestnika po polsku i angielsku. Serwer nie zgłosił nieobsługiwanych wyjątków.

## Zakres

| Funkcja | Weryfikacja |
| --- | --- |
| Filmy i zdjęcia | Import MP4/JPEG/PNG/WebP, poprawność nagłówków, brak nadpisywania, poprawny MIME, oryginalne bajty, HEAD i zakresy HTTP |
| Przebieg | Jedna lub dwie części, najpierw przyciski lub suwak, podział 50/50 dla obu rodzajów stymulów |
| Skale | Wartości całkowite i dziesiętne, walidacja kroku i zakresu, wymóg wybrania wartości suwaka; krok 0,5 również w podglądzie |
| Pytania kontrolne | CSV z przecinkami i wielowierszową treścią, oba nagłówki nazwy stymulusu, części first/second/both, osobne odpowiedzi w obu częściach |
| Jedna część | Wszystkie pytania przypisane do stymulusu oraz zablokowany wybór części w panelu |
| Test ekranu | Formularz w iframe, zapis powiązany z uczestnikiem, ochrona źródła postMessage, oczekiwanie na zapis i możliwość ponowienia po błędzie |
| Konfiguracja i podgląd | Zapis ustawień, podgląd obu skal, brak zapisywania ocen z podglądu, odporność rozpoczętej sesji na późniejszą zmianę ustawień |
| Języki i układ | Przebieg PL/EN, pytania na ekranie o szerokości 390 px bez poziomego przepełnienia |
| Wyniki | Statystyki, eksport ocen i odpowiedzi, filtr ukończonych sesji, typ stymulusu, faktyczna pozycja skali; walidacja pobranego CSV przez API |
| Logowanie hasłem | Odrzucenie złego hasła i ponowienie w tym samym formularzu, poprawne logowanie, wylogowanie, ochrona API i obcych źródeł |
| Passkey | Opcje rejestracji na localhost, prawdziwe podpisy ECDSA w testach serwera, weryfikacja challenge/origin/RP ID, wygaśnięcie i ponowne użycie odpowiedzi |
| Prolific | Zapis identyfikatorów z adresu uczestnika w jego rekordzie |
| Błędy i ponowienia | 404/403/500, pusty plik, błąd sieci i timeout pobierania; błędy zapisu; ponowienia bez duplikowania wyników |

## Naprawione błędy

1. Po złym haśle znikał formularz logowania. Formularz pozostaje dostępny i
   pokazuje komunikat, więc poprawne hasło można wpisać bez odświeżania strony.
2. Pobieranie filmu traktowało odpowiedzi błędów HTTP jak zawartość MP4 i nie
   obsługiwało awarii sieci. Dodano kontrolę odpowiedzi, komunikat oraz ponowne
   pobranie, także po błędzie dekodowania filmu. Pobrania są przerywane, a Blob
   URL zwalniane przy opuszczaniu badania.
3. Badanie przechodziło dalej przed potwierdzeniem zapisu testu ekranu. Teraz
   czeka na zapis, blokuje równoległe wysłania i po błędzie pozostawia formularz
   do ponowienia.
4. Niepoprawne typy danych sesji mogły wywołać błędy powiązania parametrów
   SQLite. API odrzuca je odpowiedzią 400 przed operacją na bazie.
5. Ponowienie zakończenia sesji zmieniało czas jej zakończenia. Pierwszy
   zapisany czas jest teraz zachowany.
6. Po zmianie trybu badania podgląd mógł pokazywać wyłączoną skalę. Podgląd
   przechodzi do powitania i czyści poprzednią próbną ocenę.

## Granice sprawdzenia

Testy nie zastępują próby z fizycznym Touch ID, telefonem lub kluczem sprzętowym.
Nie rejestrowano kluczy na urządzeniu użytkownika. Również automatyczny pełny
ekran należy potwierdzić w docelowej przeglądarce i na docelowym urządzeniu;
sprawdzono walidację, zapis i zachowanie ustawienia w sesji. Wbudowana przeglądarka
nie zwróciła zdarzenia pobrania po kliknięciu eksportu CSV; format, zawartość oraz
filtry obu eksportów potwierdzono przez działające API i testy automatyczne.

Brak wykrytych błędów w wymienionych zakończonych scenariuszach nie oznacza
gwarancji dla każdej przeglądarki, urządzenia i kombinacji danych.
