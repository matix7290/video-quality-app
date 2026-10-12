**Polski** | [English](deployment.en.md)

# Wdrożenie dla 100 równoczesnych uczestników

Przygotowany wariant używa jednej instancji aplikacji Next.js, Nginx do serwowania
oryginalnych materiałów oraz SQLite na lokalnym, trwałym dysku. Test 100 równoczesnych
uczestników należy powtórzyć na wybranym serwerze przed uruchomieniem badania.

Instrukcja dla konkretnego systemu: [AlmaLinux 9 z Nginx, SELinux i HTTPS](deployment-almalinux9.md).
Przy już podłączonej domenie dostępny jest również [wariant usługi HTTP na porcie 80](deployment-almalinux9-http.md).

## Przygotowane zmiany

- SQLite działa w WAL z `synchronous=FULL`. Indeksy przyspieszają odczyt ocen sesji
  i przydział kolejności 50/50. Transakcje rozpoczynające sesje i zapisujące oceny
  używają `BEGIN IMMEDIATE`; odpowiedzi i pytania zapisują się razem.
- Ponowienie żądania zachowuje pierwszą ocenę. Dodatkowy wyzwalacz blokuje nowe
  duplikaty na poziomie bazy; historyczne rekordy pozostają bez zmian.
- Blokada bazy przekraczająca 1 sekundę zwraca `503` z `Retry-After: 1`.
  Uczestnik może ponowić zapis tego samego formularza.
- Katalog, konfiguracja i pytania są buforowane. Zapis w panelu i zmiany metadanych
  plików/folderów odświeżają konfigurację nowych sesji; rozpoczęte sesje zachowują
  swoje ustawienia.
- Przeglądarka zachowuje do 3 ostatnich filmów, z limitem 128 MiB łącznie.
  Pojedynczy większy film pozostaje dostępny do końca odtwarzania. Starsze adresy
  Blob są zwalniane, a kolejne pobrania mogą korzystać z pamięci podręcznej HTTP.
- Materiały mają `Cache-Control: public, max-age=3600`. Import nie nadpisuje plików.
  Dla zmienionego materiału używaj nowej nazwy; ręczne zastąpienie pliku pod tą samą
  nazwą może przez godzinę wyświetlać poprzednią wersję.
- Eksport CSV pobiera po 500 rekordów i oddaje czas procesora żądaniom uczestników
  pomiędzy partiami. Nowe rekordy dodane po rozpoczęciu eksportu nie trafiają do
  tego pliku. Filtr ukończonych sesji sprawdza stan sesji w chwili odczytu partii.

WAL pozwala odczytywać dane podczas zapisu, ale SQLite nadal ma jednego piszącego.
Baza, pliki `-wal` i `-shm` muszą być na tym samym lokalnym dysku, bez NFS/SMB.
Zobacz [dokumentację SQLite](https://sqlite.org/wal.html).

## Uruchomienie aplikacji

W katalogu aplikacji na serwerze, korzystając z Node.js zgodnego z README:

```sh
npm ci
npm run admin:password
npm run build
npm run start:production
```

`start:production` wymaga poprawnych `ADMIN_PASSWORD_HASH` i
`ADMIN_SESSION_SECRET`, ładuje `.env.local` i wiąże aplikację z `127.0.0.1:3000`.
Nie używaj `npm run dev` do badania. Opcjonalna zmienna `PORT` zmienia port
aplikacji; odpowiednio zmień adres upstream w Nginx. `DATABASE_PATH` może wskazywać
inną ścieżkę do trwałej bazy; domyślnie to `video_quality.db` w katalogu aplikacji.
Nie zmieniaj tej ścieżki bez przeniesienia bazy — pusty katalog oznacza nowe wyniki.

Na Linuxie szablon [video-quality-app.service](../deploy/video-quality-app.service)
umożliwia nadzorowanie procesu i restart po awarii. Dostosuj użytkownika, katalog
oraz ścieżkę do Node.js, następnie zainstaluj jednostkę w systemd:

```sh
sudo cp deploy/video-quality-app.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now video-quality-app
sudo systemctl status video-quality-app
```

Użytkownik usługi potrzebuje prawa zapisu do bazy, `config` i katalogów materiałów.
Nginx potrzebuje odczytu i przejścia przez katalogi `public/videos` i `public/images`
(również dla nowych importów); skonfiguruj uprawnienia/grupę lub ACL odpowiednio do
swojego systemu. `.env.local` powinien pozostać dostępny tylko dla właściciela (`600`).
Na początek użyj jednej instancji aplikacji. Wiele replik, PM2 cluster lub serwerów
wymaga osobnego projektu współdzielenia bazy, konfiguracji i plików.

## Nginx i HTTPS

[nginx.conf](../deploy/nginx.conf) jest kompletnym szablonem konfiguracji:

- obsługuje filmy i zdjęcia bez przekazywania dużych plików przez Node.js;
- zachowuje oryginalne bajty, MIME, `HEAD`, zakresy i cache HTTP;
- przekazuje `Host` i `X-Forwarded-Proto` do aplikacji;
- pozwala importować pliki do dotychczasowego limitu 2 GiB;
- odrzuca nieznany `Host` i blokuje dowiązania symboliczne materiałów.

Domyślnie nasłuchuje tylko na `127.0.0.1:8080`, więc nie udostępnia badania publicznie.
Zamień `/srv/video-quality-app` na fizyczną, absolutną ścieżkę do aplikacji.
Możesz sprawdzić szablon lokalnie:

```sh
nginx -t -c /absolute/path/to/video-quality-app/deploy/nginx.conf
nginx -c /absolute/path/to/video-quality-app/deploy/nginx.conf
```

Jeśli na serwerze działa już Nginx, przenieś upstream i bloki `server` do jego
konfiguracji, a ustawienia globalne połącz z istniejącymi. Nie zastępuj konfiguracji
innych stron bez jej sprawdzenia.

Dla publicznego wdrożenia ustaw własną domenę w `server_name`, skonfiguruj certyfikat
TLS i nasłuch HTTPS na `443`. Domyślny serwer odrzucający nieznany `Host` także musi
nasłuchiwać na publicznym adresie. HTTP na `80` powinien przekierowywać do HTTPS.
Backend `3000` pozostaje dostępny tylko lokalnie. Przykład ustawień serwera TLS:

```nginx
listen 443 ssl;
server_name study.example.com;
ssl_certificate /path/to/fullchain.pem;
ssl_certificate_key /path/to/privkey.pem;
```

Ustaw `ADMIN_ORIGIN=https://study.example.com` i zrestartuj aplikację, aby passkeys
korzystały z docelowej domeny. Jeśli TLS kończy inne proxy, dostosuj forwarding
protokołu do zaufanego upstream; lokalny szablon zakłada terminację TLS w Nginx.
Weryfikacja i reload na serwerze: `sudo nginx -t`, następnie `sudo nginx -s reload`.
Jeśli uruchamiasz szablon jako osobną konfigurację, w obu komendach dodaj `-c`
z tą samą absolutną ścieżką do pliku.
Zobacz [zalecenia Next.js dotyczące reverse proxy](https://nextjs.org/docs/15/app/guides/self-hosting)
oraz [dyrektywy Nginx](https://nginx.org/en/docs/http/ngx_http_core_module.html).

## Test 100 uczestników

```sh
npm run test:load -- --users 100 --media-mib 32 --output /tmp/study-load.json
```

Test buduje osobną kopię produkcyjną, uruchamia ją na losowym lokalnym porcie i
usuwa ją po zakończeniu. Używa osobnej bazy, konfiguracji i sztucznych materiałów;
nie czyta `.env.local`, wyników ani materiałów właściwego badania. Nie obsługuje
adresu istniejącej aplikacji, więc nie dodaje testowych odpowiedzi do badania.

Każdy scenariusz rozpoczyna 100 sesji, po 2 stymuli w obu częściach, pytań tak/nie
w obu częściach, testu ekranu i przydziału 50/50. Żądania startu, ocen i zakończenia
są ponawiane, aby sprawdzić idempotencję. Test kontroluje kompletność danych,
brak duplikatów, poprawność CSV i integralność SQLite. Filmy są sztucznymi plikami
do testu transferu; test nie sprawdza dekodowania obrazu ani fizycznych passkeys.

Aby sprawdzić także przygotowany Nginx, podaj ścieżkę do zainstalowanego programu:

```sh
npm run test:load -- --users 100 --media-mib 32 --nginx-bin /usr/sbin/nginx --output /tmp/study-load-nginx.json
```

Program uruchamia oddzielne lokalne proxy ze skopiowanym szablonem. Sprawdza też
MIME, cache, `HEAD`, zakresy, odrzucanie nieznanych hostów i dowiązań. Nginx musi
mieć prawo odczytu katalogu tymczasowego użytkownika uruchamiającego test.

Warunki sukcesu to brak błędów, poprawne liczby wyników i p95 API do 500 ms.
Można dostosować `--max-p95-ms`. To test serii równoczesnych żądań bez czasu
namysłu uczestników, a nie wielogodzinny test stabilności ani pomiar łącza WAN.
Odczytuj osobno czasy API i transferu. Raporty referencyjne:
[bez proxy](performance-100-2026-10-09.json),
[przez Nginx](performance-100-nginx-2026-10-09.json).

## Łącze i materiały

100 osób pobierających jednocześnie po 30 MB wymaga przesłania około 3 GB.
Na łączu 1 Gb/s minimalny czas takiego transferu to około 24 sekundy, przed
narzutami. Dla pobrania w 10 sekund potrzeba około 2,4 Gb/s łącznie.
Nginx odciąża aplikację, ale nie zwiększa przepustowości łącza. Przy ograniczonym
łączu rozważ CDN lub rozpoczęcie sesji w mniejszych grupach. Materiałów używanych
w badaniu jakości nie należy automatycznie przekodowywać ani kompresować.

Dobierz CPU/RAM po powtórzeniu testu na docelowej maszynie. Monitoruj zajętość
dysku, czas odpowiedzi, błędy HTTP, wykorzystanie łącza i proces aplikacji podczas
pilotażu. Wynik z lokalnego Apple M4 nie gwarantuje tego samego na VPS.

## Kopie zapasowe

Przy działającej aplikacji wykonaj spójną kopię SQLite:

```sh
npm run db:backup -- /secure/backups/study-2026-10-09.db
```

Komenda korzysta z API backup SQLite, uwzględnia zatwierdzone dane z WAL, sprawdza
integralność, zapisuje plik z uprawnieniami `600` i nie nadpisuje wcześniejszych
kopii. Osobno zabezpiecz `config/study.json` (lub CSV przed pierwszym zapisem),
materiały i sekrety administratora. Samo kopiowanie `video_quality.db` podczas
pracy aplikacji może pominąć dane z `video_quality.db-wal`.
Przy odtwarzaniu zatrzymaj aplikację i przywróć spójną kopię; nie mieszaj jej ze
starymi plikami `-wal`/`-shm`. Przetestuj odzyskiwanie przed właściwym badaniem.
