**Polski** | [English](README.en.md)

# Badanie jakości wideo

Aplikacja Next.js zapisuje oceny i odpowiedzi w lokalnej bazie SQLite `video_quality.db`.

## Uruchomienie

Użyj Node.js 20.19 lub nowszego. W terminalu projektu wykonaj:

```sh
npm ci
npm run dev
```

Aplikacja jest dostępna na `http://localhost:3000`. Inny port można ustawić przez
`npm run dev -- --port 3001` (analogicznie dla `npm start`).
Opcjonalnie `nvm install` i `nvm use` wybierają wersję LTS z `.nvmrc`.
Nie trzeba przełączać już zainstalowanej zgodnej wersji Node.js.
Po zmianie głównej wersji Node.js ponownie wykonaj `npm ci`, ponieważ SQLite ma moduł natywny.

Projekt sprawdza wersję Node.js i dostępność SQLite przed uruchomieniem. `allowScripts`
w `package.json` dopuszcza skrypty instalacyjne konkretnych wersji wymaganych modułów.
Zapobiega to pominięciu przygotowania SQLite przez npm 12; opis mechanizmu jest w
[dokumentacji npm](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/).
Filmy MP4 umieść w `public/videos`, a zdjęcia JPG/PNG/WebP w `public/images` albo importuj je w panelu. `npm run build`, `npm run lint` i `npm test`
sprawdzają kompilację, kod oraz import CSV, migrację i zapis odpowiedzi.

## Filmy lub zdjęcia jako stymuli

W **Panel administratora → Stymuli → Rodzaj stymulów** wybierz filmy MP4 albo zdjęcia
JPG/JPEG, PNG lub WebP. Jedna wersja badania korzysta z jednego rodzaju materiałów.
Lista, wybór wszystkich i import folderu uwzględniają wybrany rodzaj. Importowane zdjęcia
trafiają do `public/images` (limit 50 MB na plik), a filmy do `public/videos` (limit 2 GB).
Import nie nadpisuje istniejących plików i sprawdza zgodność formatu z zawartością.
Zmiana rodzaju nie usuwa materiałów ani pytań; wcześniej rozpoczęte sesje zachowują swoje pliki.

W **Przebieg i skale → Czas wyświetlania zdjęcia (s)** ustaw ekspozycję od 0,5 do
300 sekund, z krokiem 0,1; domyślnie 5 sekund. Czas zaczyna się po wczytaniu zdjęcia.
Zdjęcie jest wyświetlane z zachowaniem proporcji, bez przycinania i bez optymalizacji pliku.
Po ekspozycji pojawia się ocena oraz przypisane pytania kontrolne. Błąd wczytania
zatrzymuje przejście i udostępnia ponowienie; nie zapisuje automatycznej oceny.
Automatyczny pełny ekran działa również dla zdjęć na obsługujących go urządzeniach.

Zdjęcia obsługują jedną lub dwie części, obie skale i przydział kolejności 50/50.
W drugiej części uczestnik ogląda te same zdjęcia w tej samej kolejności i przez ten sam czas.
Domyślne instrukcje PL/EN dostosowują się do rodzaju stymulów; własne teksty są zachowane
— można je zmienić w zakładce **Teksty ekranów**. Rodzaj oraz czas ekspozycji są kopiowane
przy starcie sesji, więc późniejsze edycje konfiguracji nie zmieniają jej przebiegu.
Starsze konfiguracje oraz wyniki zachowują rodzaj `video`.

CSV pytań przyjmuje kolumnę `stimulus_name` z nazwą pliku zdjęcia lub filmu,
a także dotychczasową `video_name`. Użyj jednej z nich. Eksport pytań dla zdjęć
używa `stimulus_name`; format odpowiedzi tak/nie, klucz i przypisanie `part` są wspólne.
Eksport wyników dodaje `stimulus_type` (`video`/`image`); kolumna `video_name`
zachowuje nazwę pliku także dla zdjęć, aby utrzymać zgodność wcześniejszych analiz.

## Przebieg badania

1. Ekran instrukcji i test ekranu.
2. Wszystkie filmy w losowej kolejności, oceniane dotychczasowymi przyciskami (1–5).
   Po ocenie filmu z przypisanymi pytaniami wyświetlane są wymagane odpowiedzi tak/nie.
3. Ekran przejścia do drugiej części.
4. Te same filmy w tej samej kolejności, oceniane ciągłym suwakiem 1–5 z krokiem 0,01.
   Punkty 1–5 mają opisy odpowiadające standardowej skali. Przed zatwierdzeniem trzeba
   zaznaczyć wartość na suwaku; początkowe 3 nie jest automatycznie odpowiedzią.
5. Podziękowanie po potwierdzeniu zapisu obu części.

Każde pytanie kontrolne może pojawić się w pierwszej, drugiej lub obu częściach.
W badaniu z jedną częścią wyświetlane są wszystkie pytania przypisane do danego filmu.
Nie pokazujemy uczestnikowi poprawnej odpowiedzi. Błąd zapisu zatrzymuje przejście i pozwala ponowić ten sam zapis.
Test ekranu musi zostać zapisany przed rozpoczęciem oceny. Po błędzie połączenia
formularz pozostaje otwarty i można ponownie kliknąć jego przycisk kończący.
Nieudane pobranie lub odtworzenie filmu pokazuje komunikat i przycisk ponownego
wczytania; w tym stanie nie można ocenić niewyświetlonego materiału.
Odświeżenie strony rozpoczyna nową sesję; wznawianie przerwanego badania nie jest jeszcze obsługiwane.

## Pytania kontrolne z CSV

Przed pierwszym zapisem w panelu można edytować `config/control-questions.csv`
(UTF-8, separator przecinek). W panelu ten sam format służy do importu:

```csv
video_name,question,correct_answer,part
example_vmaf_80.mp4,Czy w filmie pojawił się samochód?,tak,first
example_vmaf_80.mp4,"Czy widoczny był człowiek, który biegł?",nie,second
another_vmaf_60.mp4,Czy scena była nagrana na zewnątrz?,,both
```

- `video_name` lub `stimulus_name`: dokładna nazwa pliku w `public/videos` lub `public/images`, wraz z rozszerzeniem.
- `question`: treść pytania tak/nie. Wiele wierszy dla jednego filmu oznacza wiele pytań.
- `correct_answer`: opcjonalny klucz `tak`/`nie` lub `yes`/`no`. Puste pole pozwala
  tylko zebrać odpowiedź, bez sprawdzania poprawności. Można też pominąć tę kolumnę.
- `part`: `first` (pierwsza część), `second` (druga) lub `both` (obie).
  Numer części oznacza kolejność dla danego uczestnika, niezależnie od rodzaju skali
  i przydziału 50/50. Brak kolumny lub puste pole oznacza `first`, zachowując
  działanie starszych plików CSV. Nowe pytania dodane w panelu mają domyślnie `both`.
- Pytania zawierające przecinek ujmij w cudzysłowy. Cudzysłów w treści zapisuj jako `""`.
- Nieznany film, puste pytanie, błędny klucz lub przypisanie części blokują start z komunikatem o konfiguracji.

Plik roboczy ma początkowo sam nagłówek, czyli brak pytań. Osobny
`config/control-questions.example.csv` zawiera wzór i nie jest ładowany przez aplikację.
Konfiguracja pytań jest kopiowana do sesji przy jej utworzeniu. Edycja CSV dotyczy nowych sesji.
Pytania w CSV są wyświetlane dosłownie; dla angielskiego badania przygotuj angielską treść.

## Dane

Migracja bazy dodaje kolumny i tabelę bez usuwania starych danych.

- `users.questions_snapshot`: zestaw pytań wraz z kluczem odpowiedzi użyty w sesji.
- `ratings.phase`: `standard` albo `slider`.
- `ratings.stimulus_type`: `video` albo `image`; starsze oceny mają `video`.
- `ratings.scale_type`: `categorical` albo `continuous`.
- `ratings.rating`: liczba 1–5; suwak zachowuje część ułamkową. SQLite przechowuje
  wartości ułamkowe także w istniejącej kolumnie o powinowactwie INTEGER.
- `ratings.duration`: czas od zakończenia filmu do zatwierdzenia odpowiedzi,
  wliczający pytania kontrolne, jeśli występują.
- `control_answers`: powiązanie z oceną przez `rating_id`, identyfikator i treść pytania,
  odpowiedź 0/1, poprawna odpowiedź oraz `is_correct` (NULL przy braku klucza).

Ponowienie zapisu tej samej sesji, filmu i części nie tworzy duplikatu ani nie zmienia
pierwszej zapisanej odpowiedzi. Dotychczasowe oceny otrzymują etap `standard`.

## Panel administratora

Otwórz [panel administratora](http://localhost:3000/admin). Panel zawiera:

- **Stymuli**: wybór filmów lub zdjęć, import folderu i plików, wybór materiałów do badania oraz podgląd;
- **Przebieg i skale**: przyciski, suwak lub dwie części, krok suwaka, opisy 1–5,
  losową kolejność albo kolejność wyboru oraz włączenie testu ekranu i automatycznego trybu pełnoekranowego;
- **Teksty ekranów**: instrukcje, przejście między częściami i podziękowanie w PL/EN;
- **Pytania kontrolne**: edycję tabeli, wybór części dla każdego pytania, opcjonalny klucz odpowiedzi i import/eksport CSV;
- **Podgląd**: ekrany i skale z ustawieniami edytora, bez tworzenia sesji i zapisu odpowiedzi;
- **Wyniki**: statystyki sesji oraz eksport CSV ocen i odpowiedzi, opcjonalnie tylko z ukończonych sesji.

Przycisk **Zapisz konfigurację** publikuje ustawienia dla nowych sesji. Przeglądanie podglądu
nie publikuje zmian. Ustawienia i pytania są zapisane atomowo w `config/study.json`.
Ten plik jest lokalną konfiguracją, wyłączoną z Gita; należy uwzględnić go w kopiach zapasowych.
Przed pierwszym zapisem panel korzysta z dotychczasowego `config/control-questions.csv`.
Po pierwszym zapisie pytania edytuj w panelu albo importuj CSV — osobny plik CSV nie jest
wtedy automatycznie wczytywany. Import CSV zastępuje tabelę w edytorze, a publikacja wymaga zapisu.
Pytania dla niewybranych filmów pozostają w konfiguracji i wracają po ponownym wybraniu filmu.

Import folderu kopiuje pliki wybranego rodzaju do `public/videos` lub `public/images` na serwerze, z pominięciem innych formatów.
Limit jednego filmu wynosi 2 GB, a zdjęcia 50 MB. Podfoldery są spłaszczane do nazw plików; identyczne nazwy
powodują komunikat o konflikcie, bez nadpisania istniejących stymulów. Filmy są udostępniane
przez API obsługujące żądania zakresowe, więc import działa także bez ponownej kompilacji aplikacji.
Wyłączenie filmu z badania nie usuwa go z dysku i zachowuje dostęp dla wcześniejszych sesji.
Serwer wymaga zapisywalnego, trwałego dysku na konfigurację, filmy i bazę SQLite.

Każda nowa sesja otrzymuje `users.settings_snapshot` z ustawieniami i identyfikatorem wersji.
Edycja konfiguracji nie zmienia sesji w trakcie badania. Eksport zawiera kolumnę `study_version`;
stare sesje bez zapisu konfiguracji mają wersję `legacy` i zachowują dotychczasowy przebieg dwóch części.
W badaniu z jedną częścią wybór części dla pytań jest zablokowany i wyświetlany jako
„Jedyna część badania”. Wszystkie przypisane do filmu pytania są wtedy wymagane,
niezależnie od wartości `part` w CSV. Wcześniejsze przypisania są zachowane
i wracają po ponownym włączeniu dwóch części. Dotyczy to również importowanych pytań.
Sesje rozpoczęte przed dodaniem przypisań nadal wyświetlają pytania tylko w pierwszej części.
W eksporcie odpowiedzi `phase_position` wskazuje numer części, `phase` rodzaj skali,
a `scale_type` rozróżnia `categorical` i `continuous`.

### Automatyczny tryb pełnoekranowy

W **Przebieg i skale** administrator ustawia automatyczne otwieranie stymulów na pełnym ekranie.
Ekran powitalny nie udostępnia tego wyboru uczestnikowi. Ustawienie dotyczy wszystkich urządzeń,
jest zapisywane w konfiguracji oraz kopii ustawień sesji i nie zmienia rozpoczętych sesji.
Pole `users.auto_fullscreen` otrzymuje wartość z konfiguracji serwera, niezależnie od treści
żądania uczestnika. Starsze konfiguracje bez tego pola domyślnie mają tryb wyłączony;
starsze sesje zachowują wartość zapisaną w `users.auto_fullscreen`.
Przeglądarka musi obsługiwać i zezwalać na Fullscreen API; w razie odmowy film nadal się odtwarza.

### Kolejność skal

W **Przebieg i skale → Kolejność skal** wybierz: najpierw skalę dyskretną, najpierw suwak
albo **Na zmianę między uczestnikami (50/50)**. Ustawienie dotyczy badania z obiema skalami.
Każdy uczestnik ocenia wszystkie wybrane filmy w pierwszej części, a następnie te same filmy
w tej samej kolejności w drugiej części. Pytania kontrolne pojawiają się zgodnie
z przypisaniem ustawionym dla każdego pytania.

W wariancie 50/50 kolejne nowe sesje danej wersji konfiguracji rozpoczynają się naprzemiennie
od skali dyskretnej i suwaka. Przy nieparzystej liczbie sesji jedna grupa ma o jedną osobę więcej.
Liczone są rozpoczęte sesje, również nieukończone, więc odsetek ukończonych badań może być inny.
Przydział jest atomowy i zapisany w `settings_snapshot.phaseSequence`; ponowienie startu
nie zmienia grupy. Edycja konfiguracji nie zmienia kolejności wcześniej rozpoczętych sesji.
Starsze sesje zachowują dotychczasową kolejność dyskretna → suwak.

Podgląd pozwala sprawdzić oba warianty bez naliczania sesji. W zakładce **Teksty ekranów**
można edytować osobne instrukcje drugiej części dla suwaka i przycisków. Eksport ocen i odpowiedzi
zawiera `first_phase` i `phase_position` (1 lub 2), aby rozróżnić przydzielone kolejności.

### Dostęp do panelu

Domyślnie panel i jego API działają tylko z lokalnego połączenia przez `localhost`,
`127.0.0.1` lub `::1`. Aby zabezpieczyć panel również lokalnie i udostępnić go przez sieć,
uruchom w katalogu aplikacji:

```bash
npm run admin:password
```

Polecenie pyta o hasło dwukrotnie, bez wyświetlania i zapisywania go w historii terminala.
Użyj co najmniej 12 znaków. W `.env.local` zapisuje wyłącznie `ADMIN_PASSWORD_HASH`
(scrypt: N=131072, r=8, p=1, losowa sól 16 bajtów) i osobny losowy `ADMIN_SESSION_SECRET`.
Plik otrzymuje uprawnienia `600` i jest ignorowany przez Git. Nie udostępniaj klucza sesji:
uprawnienia pliku nie chronią przed administratorem systemu ani przejęciem Twojego konta.

Jeśli masz już stare `ADMIN_PASSWORD` w `.env.local`, zachowaj obecne hasło przez migrację:

```bash
npm run admin:password -- --migrate
```

Migracja usuwa jawną wartość, zachowując hasło używane dotychczas przez Next.js. Nie tworzy
kopii jawnego hasła. Pozostałe ustawienia pliku zostają zachowane. Stara konfiguracja ani
niepoprawny hash nie umożliwiają logowania lub obejścia zabezpieczeń przez localhost.
Dla hostingu skonfiguruj te same dwie zmienne w menedżerze sekretów i usuń `ADMIN_PASSWORD`.

Po każdej zmianie uruchom ponownie serwer. Panel poprosi o hasło; logowanie wygasa po 8 godzinach.
Zmiana hasła lub klucza sesji unieważnia istniejące logowania. Hasło zmieniasz tym samym
poleceniem `npm run admin:password`; passkey pozostają zarejestrowane.
Przy wdrożeniu za reverse proxy używaj HTTPS oraz przekazuj `Host` i `X-Forwarded-Proto`.
Panel blokuje żądania z obcych stron. Ustaw hasło również przy lokalnym reverse proxy.

Możliwe kolejne rozszerzenia: klipy treningowe, przerwy między blokami,
przywracanie zapisanych wersji konfiguracji oraz ustawienia zakończenia w Prolific.

### Logowanie passkey (WebAuthn)

1. Ustaw hasło przez `npm run admin:password`, zrestartuj serwer i zaloguj się do `/admin`.
2. Otwórz zakładkę **Dostęp**, nadaj nazwę kluczowi i wybierz **Dodaj passkey**.
3. Potwierdź utworzenie klucza w przeglądarce przez Touch ID, PIN, telefon lub klucz sprzętowy.
4. Przy kolejnych logowaniach wybierz **Zaloguj się passkey**. Hasło nadal umożliwia odzyskanie dostępu.

Dla pracy lokalnej używaj `http://localhost:3000` (albo swojego portu), również gdy wcześniej
otwierałeś aplikację przez `127.0.0.1`. Przy wdrożeniu ustaw w `.env.local` pełny adres HTTPS:

```dotenv
ADMIN_ORIGIN=https://badanie.example.com
```

Adres nie zawiera ścieżki `/admin`. Passkey jest powiązany z domeną, więc klucz utworzony
na localhost należy ponownie dodać na domenie wdrożenia. HTTPS jest wymagany poza localhost;
przeglądarka osadzona w edytorze może nie obsługiwać systemowego menedżera passkey — wtedy
otwórz panel w Chrome lub Safari. Po zmianie ustawień środowiska zrestartuj serwer.
Implementacja używa [SimpleWebAuthn](https://simplewebauthn.dev/docs/packages/server).

Klucze publiczne, nazwy urządzeń i liczniki podpisów są przechowywane w `admin_passkeys`
w tej samej bazie SQLite. Klucz prywatny i dane biometryczne pozostają na urządzeniu lub
w jego menedżerze passkey. Rejestracja wymaga istniejącej sesji administratora; odpowiedzi
sprawdzają podpis, domenę, losowe wyzwanie oraz potwierdzenie użytkownika. Próba jest
powiązana z przeglądarką, jednorazowa i wygasa po pięciu minutach. Sesja panelu trwa osiem godzin.

Nie usuwaj `ADMIN_PASSWORD_HASH` ani `ADMIN_SESSION_SECRET` po rejestracji passkey.
Hash umożliwia logowanie hasłem, a osobny klucz podpisuje sesje. Jeśli w bazie są klucze,
brak konfiguracji nie włącza dostępu bez logowania.
Usunięcie klucza w zakładce Dostęp blokuje kolejne logowania, ale nie kończy już wydanych sesji
ani nie usuwa wpisu z menedżera passkey urządzenia. Kopie zapasowe bazy obejmują również
klucze publiczne administratora; odzyskanie samego hasła nie usuwa zarejestrowanych kluczy.
