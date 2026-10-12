# Wdrożenie na AlmaLinux 9 z Nginx

Jeśli domena jest już podłączona i chcesz uruchomić usługę na porcie 80,
użyj [wariantu HTTP](deployment-almalinux9-http.md). Poniższy wariant dodaje HTTPS.

Instrukcja dotyczy nowego serwera AlmaLinux 9, jednej instancji aplikacji i domeny
`study.example.com`. Zamień tę domenę wszędzie na swoją. Komendy wykonuj przez SSH
jako użytkownik z `sudo`; bloki **na Macu** dotyczą komputera ze źródłami.
Żadne ustawienia z tej instrukcji nie zostały zastosowane na zdalnym serwerze.

Uczestnik → HTTPS/Nginx → Next.js na `127.0.0.1:3000`. Nginx serwuje oryginalne
materiały z dysku, a Next.js zapisuje odpowiedzi do SQLite.

## 1. DNS i kod aplikacji

Ustaw rekord DNS **A** domeny na publiczny IPv4 serwera. Rekord **AAAA** dodawaj,
gdy serwer obsługuje IPv6. Do wydania certyfikatu potrzebujesz działającego DNS
i dostępu z Internetu do portu 80. Na serwerze sprawdź system:

```sh
cat /etc/almalinux-release
```

Przed klonowaniem wypchnij aktualną wersję kodu do repozytorium. Przy pisaniu
instrukcji zmiany dla 100 uczestników oraz nowe pliki `deploy`/`docs` pozostają
lokalne. Wdrożona wersja musi zawierać `scripts/start-production.cjs`,
`scripts/load-test.cjs` i `deploy/almalinux9.conf`.
Możesz też przesłać źródła przez SSH. `node_modules` i `.next` przygotuj na Linuxie.

## 2. Pakiety i Node.js

```sh
sudo dnf upgrade --refresh -y
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --set-enabled crb
sudo dnf install -y epel-release
sudo dnf install -y nginx git rsync curl nano acl firewalld policycoreutils-python-utils gcc-c++ make python3 certbot
sudo dnf module list nodejs
sudo dnf module install -y nodejs:22/common
node --version
npm --version
command -v node
```

Oczekiwane: Node.js `v22.x` i `/usr/bin/node`. Na istniejącym serwerze sprawdź
użycie wcześniejszego strumienia Node.js przed jego zmianą. Kompilator i Python
umożliwiają przygotowanie natywnego modułu SQLite.
CRB/EPEL opisuje [AlmaLinux Wiki](https://wiki.almalinux.org/repos/Extras),
a moduły — [dokumentacja DNF](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_software_with_the_dnf_tool/assembly_installing-rhel-9-content_managing-software-with-the-dnf-tool).

## 3. Użytkownik i katalogi

```sh
sudo useradd --system --create-home --home-dir /var/lib/video-study --shell /usr/sbin/nologin study
sudo install -d -o study -g study -m 0750 /srv/video-quality-app
sudo install -d -o study -g study -m 0700 /var/lib/video-quality-app
sudo install -d -o study -g study -m 0700 /var/backups/video-quality-app
sudo -u study -H git clone https://github.com/matix7290/video-quality-app.git /srv/video-quality-app
sudo -u study -H mkdir -p /srv/video-quality-app/public/videos /srv/video-quality-app/public/images
```

Kod i ustawienia: `/srv/video-quality-app`. Baza: `/var/lib/video-quality-app`.
Backup: `/var/backups/video-quality-app`. Używaj fizycznej ścieżki checkoutu,
bez symlinku do katalogu aplikacji, ponieważ Nginx blokuje symlinki materiałów.
Dla prywatnego repozytorium skonfiguruj Git/deploy key; nie wpisuj tokenu w URL.

## 4. Zależności, hasło i build

```sh
sudo -u study -H /bin/bash
cd /srv/video-quality-app
npm ci
npm run admin:password
nano .env.local
```

Komenda hasła zapisze `ADMIN_PASSWORD_HASH` oraz `ADMIN_SESSION_SECRET`.
Pozostaw te wartości i dopisz:

```dotenv
ADMIN_ORIGIN=https://study.example.com
DATABASE_PATH=/var/lib/video-quality-app/video_quality.db
```

Nie dodawaj `ADMIN_PASSWORD`. W tej samej powłoce:

```sh
chmod 600 .env.local
npm run build
npm run lint
npm test
exit
```

Panel będzie pod `https://study.example.com/admin`. Passkeys utworzone na
localhost trzeba ponownie zarejestrować na domenie serwera.

## 5. Materiały, ustawienia i istniejące wyniki

Git nie zawiera filmów, zdjęć, `config/study.json`, `.env.local` ani bazy.
Możesz zaimportować materiały przez panel po uruchomieniu HTTPS lub przenieść
je przez SSH. Przykład: na serwerze jako swój użytkownik SSH:

```sh
mkdir -p ~/study-import/videos ~/study-import/images
```

**Na Macu**, zastępując `admin@ADRES_SERWERA` swoim kontem:

```sh
rsync -av --progress /Users/molszewski/GitHub/video-quality-app/public/videos/ admin@ADRES_SERWERA:~/study-import/videos/
```

Analogicznie przenieś `public/images`, jeśli masz zdjęcia. Jeżeli chcesz zachować
ustawienia panelu, prześlij istniejący `config/study.json` jako `~/study-import/study.json`.
Na serwerze:

```sh
sudo rsync -av --chown=study:study ~/study-import/videos/ /srv/video-quality-app/public/videos/
sudo rsync -av --chown=study:study ~/study-import/images/ /srv/video-quality-app/public/images/
```

Opcjonalnie, jeżeli przesłano ustawienia:

```sh
sudo install -o study -g study -m 0600 ~/study-import/study.json /srv/video-quality-app/config/study.json
```

Jeśli potrzebujesz historycznych wyników, **na Macu** wykonaj spójny backup:

```sh
cd /Users/molszewski/GitHub/video-quality-app
npm run db:backup -- /private/tmp/video-study-transfer.db
scp /private/tmp/video-study-transfer.db admin@ADRES_SERWERA:~/study-import/video_quality.db
```

Przed pierwszym uruchomieniem usługi zainstaluj kopię na serwerze:

```sh
sudo install -o study -g study -m 0600 ~/study-import/video_quality.db /var/lib/video-quality-app/video_quality.db
```

Przy istniejącej bazie najpierw zatrzymaj usługę i zachowaj kopię jej danych.
Nie zastępuj działającej bazy i nie łącz kopii ze starymi WAL/SHM. Backup obejmuje
dane z chwili jego wykonania; przy ostatecznym przeniesieniu zakończ zapisy w starej
instalacji. Katalog bazy musi być lokalny i trwały.

## 6. Uprawnienia Nginx i nowe importy

Pakiet Nginx używa użytkownika `nginx`; potwierdź dyrektywę `user` w
`/etc/nginx/nginx.conf`, jeśli konfiguracja była już zmieniana.

```sh
sudo setfacl -m u:nginx:--x /srv/video-quality-app /srv/video-quality-app/public
sudo setfacl -R -m u:nginx:r-X /srv/video-quality-app/public/videos /srv/video-quality-app/public/images
sudo setfacl -m d:u:nginx:r-x /srv/video-quality-app/public/videos /srv/video-quality-app/public/images
```

ACL pozwalają przejść przez katalog aplikacji i czytać materiały. Domyślne ACL
obejmują nowe importy. Nginx nie potrzebuje dostępu do `.env.local` ani bazy;
nie dodawaj go do grupy `study`.

## 7. SELinux

```sh
getenforce
sudo setsebool -P httpd_can_network_connect on
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/video-quality-app'
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/video-quality-app/public'
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/video-quality-app/public/(videos|images)(/.*)?'
sudo restorecon -v /srv/video-quality-app /srv/video-quality-app/public
sudo restorecon -Rv /srv/video-quality-app/public/videos /srv/video-quality-app/public/images
```

Boolean pozwala Nginx łączyć się z backendem; etykiety pozwalają odczytywać
materiały. SELinux pozostaje Enforcing. Jeśli reguła `fcontext` już istnieje,
zmień ją przez `-m` zamiast `-a`. Zobacz [dokumentację Nginx na RHEL](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/deploying_web_servers_and_reverse_proxies/setting-up-and-configuring-nginx_deploying-web-servers-and-reverse-proxies).

## 8. Aplikacja jako usługa systemd

```sh
sudo cp /srv/video-quality-app/deploy/video-quality-app.service /etc/systemd/system/video-quality-app.service
sudo systemctl daemon-reload
sudo systemctl enable --now video-quality-app
sudo systemctl status video-quality-app --no-pager
curl -I http://127.0.0.1:3000/
sudo ss -ltnp
```

Oczekiwane: `active (running)` i nasłuch tylko na `127.0.0.1:3000`.
Jedna instancja aplikacji, bez PM2 cluster. Błędy startu:

```sh
sudo journalctl -u video-quality-app -n 100 --no-pager
```

## 9. Firewall

Przed pierwszym włączeniem firewalld sprawdź reguły SSH, zwłaszcza przy
niestandardowym porcie. Na nowym serwerze ze standardowym SSH:

```sh
sudo systemctl enable --now firewalld
sudo firewall-cmd --get-active-zones
```

Dla interfejsu w strefie `public`:

```sh
sudo firewall-cmd --permanent --zone=public --add-service=ssh
sudo firewall-cmd --permanent --zone=public --add-service=http
sudo firewall-cmd --permanent --zone=public --add-service=https
sudo firewall-cmd --reload
sudo firewall-cmd --zone=public --list-services
```

Jeśli interfejs używa innej strefy, zastąp `public`. Zasady opisuje
[firewalld](https://firewalld.org/documentation/howto/open-a-port-or-service).
W firewallu dostawcy VPS także otwórz TCP 80 i 443. Port 3000 pozostaje lokalny.

## 10. HTTP do uzyskania certyfikatu

Zachowaj główny `/etc/nginx/nginx.conf` z pakietu. Sprawdź, czy jego blok `http`
zawiera `include /etc/nginx/conf.d/*.conf;`. Możesz ustawić `worker_processes auto;`
i `worker_connections 2048;` w bloku `events`.

```sh
sudo install -d -m 0755 /var/www/letsencrypt /var/www/letsencrypt/.well-known/acme-challenge
sudo semanage fcontext -a -t httpd_sys_content_t '/var/www/letsencrypt(/.*)?'
sudo restorecon -Rv /var/www/letsencrypt
sudo nano /etc/nginx/conf.d/video-quality-app.conf
```

Zawartość początkowa, po zamianie domeny:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name study.example.com;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type text/plain;
    }
    location / { return 404; }
}
```

Na tym etapie dostępny jest katalog weryfikacji certyfikatu. W istniejącym
domyślnym serwerze HTTP w `/etc/nginx/nginx.conf` możesz ustawić `return 404;`
zamiast strony powitalnej. Zachowaj jeden `default_server` na adres/port.

```sh
sudo nginx -t
sudo systemctl enable --now nginx
```

Jeśli Nginx już działał, po `nginx -t` wykonaj `sudo systemctl reload nginx`.
Sprawdź DNS i dostęp do katalogu ACME z urządzenia poza serwerem.

## 11. Certyfikat i konfiguracja HTTPS

```sh
sudo certbot certonly --webroot -w /var/www/letsencrypt -d study.example.com
```

Podaj e-mail i zaakceptuj wymagane warunki. Webroot korzysta z działającego
Nginx na porcie 80. Sposób działania opisuje [Certbot](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot).

Po uzyskaniu certyfikatu zastąp konfigurację początkową:

```sh
sudo cp /srv/video-quality-app/deploy/almalinux9.conf /etc/nginx/conf.d/video-quality-app.conf
sudo nano /etc/nginx/conf.d/video-quality-app.conf
```

Zamień **wszystkie** `study.example.com` na swoją domenę, także ścieżki certyfikatów.
Jeśli Certbot nadał inną nazwę certyfikatowi, odczytaj ścieżki przez
`sudo certbot certificates`.

```sh
sudo nginx -t
sudo systemctl reload nginx
curl -I https://study.example.com/
```

`deploy/almalinux9.conf` zawiera upstream i serwery, więc pasuje do `conf.d`.
Ogólny `deploy/nginx.conf` z projektu zawiera też `http`/`events` i nie pasuje
do tego katalogu. Nginx będzie obsługiwał filmy/zdjęcia, zakresy i import do 2 GiB.

## 12. Odnawianie certyfikatu

Dodaj hook reloadu po odnowieniu:

```sh
sudo install -d /etc/letsencrypt/renewal-hooks/deploy
sudo nano /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

Zawartość:

```sh
#!/bin/sh
set -e
/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
```

```sh
sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo restorecon -Rv /etc/letsencrypt/renewal-hooks
sudo systemctl enable --now certbot-renew.timer
sudo certbot renew --dry-run
sudo systemctl list-timers certbot-renew.timer
```

EPEL 9 dostarcza `certbot-renew.timer` — [lista plików pakietu](https://packages.fedoraproject.org/pkgs/certbot/certbot/epel-9.html).
`--dry-run` sprawdza odnowienie. Hook możesz dodatkowo uruchomić ręcznie,
aby sprawdzić reload Nginx.

## 13. Panel, import i pilotaż

Otwórz `https://study.example.com/admin`. Zaloguj się, wybierz materiały,
skale/kolejność, instrukcje i pytania, następnie zapisz konfigurację.
Zaimportuj nowy plik i sprawdź jego dostępność przez Nginx. Przejdź pełny test
obu części, pytań i eksportu CSV. Opcjonalnie zarejestruj passkey na domenie.

Dla prawdziwej nazwy materiału z panelu:

```sh
curl -I https://study.example.com/api/stimuli/example.mp4
curl -sS -D - -o /dev/null -H 'Range: bytes=0-1023' https://study.example.com/api/stimuli/example.mp4
```

Oczekiwane: `video/mp4`, cache, rozmiar pliku oraz `206`/`Content-Range` dla
fragmentu. Zakoduj spacje i znaki specjalne w nazwie URL.

## 14. Test 100 sesji na sprzęcie serwera

```sh
sudo -u study -H /bin/bash
cd /srv/video-quality-app
npm run test:load -- --users 100 --media-mib 32 --output /var/lib/video-study/load-100.json
exit
```

Test tworzy osobną kopię i bazę. Oczekiwane: `passed: true`, brak błędów,
p95 API do 500 ms, 200 ukończonych sesji, 800 ocen i 800 odpowiedzi bez duplikatów.
To pomiar sprzętu przez loopback. Transfer przez docelowy Nginx/HTTPS i Internet
sprawdź z urządzeń zewnętrznych w pilotażu. Test obciążenia uruchamiaj przed
właściwym badaniem, gdy serwer nie obsługuje uczestników.

100 osób pobierających po 30 MB to około 3 GB: minimum około 24 s przy 1 Gb/s,
przed narzutami. Materiały badania jakości zachowują oryginalne kodowanie.

## 15. Backup i aktualizacje

```sh
sudo -u study -H /bin/bash
cd /srv/video-quality-app
npm run db:backup -- /var/backups/video-quality-app/study-2026-10-09.db
exit
```

Dla każdej kolejnej kopii wybierz nową nazwę. Osobno zabezpiecz `.env.local`,
`config/study.json`, materiały i kopię poza serwerem. Samo kopiowanie otwartego
pliku `.db` może pominąć dane WAL.

Aktualizacja poza badaniem, po wykonaniu kopii bazy i ustawień:

```sh
sudo systemctl stop video-quality-app
sudo -u study -H /bin/bash
cd /srv/video-quality-app
git pull --ff-only
npm ci
npm run build
npm test
exit
sudo systemctl start video-quality-app
sudo systemctl status video-quality-app --no-pager
```

Po zmianie konfiguracji Nginx uruchom `sudo nginx -t` przed reloadem.

## Diagnostyka

| Objaw | Sprawdź |
| --- | --- |
| `502 Bad Gateway` | Stan aplikacji, port 3000, logi systemd i `httpd_can_network_connect`. |
| `403` dla materiałów | ACL, etykiety SELinux, przejście przez katalogi i symlinki w ścieżce. |
| Materiał działa w backendzie, ale nie w Nginx | Ścieżka `alias`, użytkownik `nginx` i `httpd_sys_content_t`. |
| Import nie zapisuje pliku | Właściciel katalogów, wolny dysk, limit uploadu. |
| Certbot nie wydaje certyfikatu | DNS A/AAAA, port 80, firewall VPS i katalog ACME. |
| Login/passkey nie działa | `ADMIN_ORIGIN`, HTTPS, hash/sekret i restart aplikacji po edycji `.env.local`. |

```sh
sudo journalctl -u video-quality-app -n 100 --no-pager
sudo tail -n 100 /var/log/nginx/video-quality-app.error.log
sudo ausearch -m AVC -ts recent
sudo ls -lZ /srv/video-quality-app/public/videos
sudo getfacl /srv/video-quality-app/public/videos
df -h
```

Napraw wskazane uprawnienia/konteksty przy pozostawionym SELinux Enforcing.
