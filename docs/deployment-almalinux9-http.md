# AlmaLinux 9 — usługa na porcie 80

Domena już wskazuje na serwer. Ta instrukcja uruchamia aplikację pod
`http://study.example.com`, z Nginx na porcie **80** i jedną instancją Next.js
na `127.0.0.1:3000`. Zamień `study.example.com` na własną domenę.
Komendy wykonuj przez SSH na serwerze jako użytkownik z `sudo`.
Nie zastosowano ich na zdalnym serwerze podczas przygotowywania instrukcji.

## 1. Sprawdź obecną usługę na porcie 80

```sh
sudo ss -ltnp '( sport = :80 )'
```

Jeśli działa Nginx, sprawdź aktualne bloki domen:

```sh
sudo nginx -T
```

Dla tej samej domeny i portu edytuj istniejący blok `server`, zamiast dodawać
drugi blok z tym samym `server_name`. Przełączenie `location /` na aplikację
zastąpi dotychczasową stronę pod tą domeną. Jeśli obie strony mają zostać
dostępne, przypisz badaniu osobną subdomenę i osobny blok `server`.
Różne domeny mogą współdzielić port 80 w jednym Nginx.
Opisuje to [dokumentacja Nginx](https://nginx.org/en/docs/http/server_names.html).

Jeśli port zajmuje Apache lub inny proces, najpierw ustal sposób współpracy
z obecną stroną; drugi serwer nie może zająć tej samej pary adres/port.

## 2. Pakiety, kod i użytkownik

Jeśli aplikacja jest już zbudowana w `/srv/video-quality-app`, działa jako
użytkownik `study` i ma skonfigurowaną bazę oraz hasło, przejdź do kroku 3.
W przeciwnym razie:

```sh
sudo dnf install -y nginx git curl nano acl policycoreutils-python-utils gcc-c++ make python3
node --version
command -v node
```

Jeśli nie masz zgodnej wersji Node.js, sprawdź dostępne moduły:

```sh
sudo dnf module list nodejs
sudo dnf module install -y nodejs:22/common
node --version
npm --version
```

Na serwerze obsługującym inne aplikacje zachowaj ich zgodną wersję Node.js.
Poniższa usługa zakłada binarkę `/usr/bin/node`; zmień `ExecStart`, jeśli
Node.js jest zainstalowany gdzie indziej. Nie kopiuj macOS `node_modules`
ani `.next` — zależności i build przygotuj na Linuxie.

Przed klonowaniem prześlij aktualne zmiany do repozytorium albo skopiuj
źródła przez SSH. Przy przygotowaniu instrukcji pliki `deploy` i skrypty
produkcyjne pozostają lokalne; muszą znaleźć się na serwerze.

Jeśli konto `study` i katalogi jeszcze nie istnieją:

```sh
sudo useradd --system --create-home --home-dir /var/lib/video-study --shell /usr/sbin/nologin study
sudo install -d -o study -g study -m 0750 /srv/video-quality-app
sudo install -d -o study -g study -m 0700 /var/lib/video-quality-app
sudo -u study -H git clone https://github.com/matix7290/video-quality-app.git /srv/video-quality-app
sudo -u study -H mkdir -p /srv/video-quality-app/public/videos /srv/video-quality-app/public/images
```

Zainstaluj zależności i ustaw hasło, jeśli nie było jeszcze skonfigurowane:

```sh
sudo -u study -H /bin/bash
cd /srv/video-quality-app
npm ci
npm run admin:password
nano .env.local
```

Zachowaj wygenerowane `ADMIN_PASSWORD_HASH` i `ADMIN_SESSION_SECRET`, a także
istniejące ustawienia bazy przy aktualizacji. Dla nowej instalacji dodaj:

```dotenv
DATABASE_PATH=/var/lib/video-quality-app/video_quality.db
```

Dla publicznego HTTP pozostaw `ADMIN_ORIGIN` nieustawione. Ta zmienna służy
passkeys i nie akceptuje `http://` dla domeny publicznej. Dokończ przygotowanie:

```sh
chmod 600 .env.local
npm run build
exit
```

Zaimportuj materiały do `public/videos` albo `public/images`; wybór materiałów
i ustawienia badania przygotuj w panelu `/admin`. Przeniesienie dotychczasowej
konfiguracji oraz spójnej kopii bazy opisuje krok 5
[pełnej instrukcji](deployment-almalinux9.md#5-materiały-ustawienia-i-istniejące-wyniki).

## 3. Uprawnienia i SELinux

Poniższe ACL zakładają użytkownika `nginx` z pakietu systemowego i fizyczny
katalog aplikacji bez symlinków. Dają Nginx dostęp do materiałów:

```sh
sudo setfacl -m u:nginx:--x /srv/video-quality-app /srv/video-quality-app/public
sudo setfacl -R -m u:nginx:r-X /srv/video-quality-app/public/videos /srv/video-quality-app/public/images
sudo setfacl -m d:u:nginx:r-x /srv/video-quality-app/public/videos /srv/video-quality-app/public/images
sudo setsebool -P httpd_can_network_connect on
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/video-quality-app'
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/video-quality-app/public'
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/video-quality-app/public/(videos|images)(/.*)?'
sudo restorecon -v /srv/video-quality-app /srv/video-quality-app/public
sudo restorecon -Rv /srv/video-quality-app/public/videos /srv/video-quality-app/public/images
```

Jeśli reguły `fcontext` już istnieją, użyj `-m` zamiast `-a`.
`httpd_can_network_connect` pozwala Nginx połączyć się z backendem przy
włączonym SELinux; zobacz [dokumentację reverse proxy na RHEL 9](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/deploying_web_servers_and_reverse_proxies/setting-up-and-configuring-nginx_deploying-web-servers-and-reverse-proxies).

## 4. Uruchom aplikację jako usługę

```sh
sudo cp /srv/video-quality-app/deploy/video-quality-app.service /etc/systemd/system/video-quality-app.service
sudo systemctl daemon-reload
sudo systemctl enable --now video-quality-app
sudo systemctl status video-quality-app --no-pager
curl -I http://127.0.0.1:3000/
```

Oczekiwane: `active (running)` i odpowiedź HTTP backendu. Usługa uruchamia
aplikację automatycznie po restarcie serwera. Przy aktualizacji już działającej
usługi wykonaj `sudo systemctl restart video-quality-app` po nowym buildzie.

## 5. Podłącz Nginx na porcie 80

Dla domeny bez istniejącego bloku `server`:

```sh
sudo cp /srv/video-quality-app/deploy/almalinux9-http.conf /etc/nginx/conf.d/video-quality-app.conf
sudo nano /etc/nginx/conf.d/video-quality-app.conf
```

Zastąp **oba** wystąpienia `study.example.com` własną domeną. Szablon zawiera
proxy, obsługę dużych importów oraz serwowanie filmów i zdjęć bezpośrednio
przez Nginx. Zachowaj systemowy `/etc/nginx/nginx.conf`.

Jeśli domena ma już konfigurację, zachowaj jej kopię i przenieś dyrektywy
szablonu do istniejącego bloku. `upstream` umieść raz, na poziomie `http`,
np. w pliku `conf.d`. Zastąp istniejące `location /` oraz ewentualne reguły
przekierowania tej domeny. Instaluj **jeden** wariant: `almalinux9-http.conf`
albo `almalinux9.conf`; definiują ten sam upstream.

Sprawdź konfigurację przed przeładowaniem:

```sh
sudo nginx -t
```

Kontynuuj, gdy test zakończy się sukcesem bez ostrzeżeń o konfliktach domen.
Dla już działającego Nginx:

```sh
sudo systemctl enable nginx
sudo systemctl reload nginx
```

Dla zainstalowanego, ale jeszcze nieuruchomionego Nginx:

```sh
sudo systemctl enable --now nginx
```

## 6. Dostęp sieciowy i sprawdzenie

Jeśli firewalld działa, sprawdź aktywną strefę:

```sh
sudo firewall-cmd --get-active-zones
```

Przykład dla interfejsu w strefie `public`; zamień nazwę na właściwą strefę:

```sh
sudo firewall-cmd --permanent --zone=public --add-service=http
sudo firewall-cmd --reload
```

Uwzględnij również reguły dostawcy serwera dla TCP 80. Port 3000 pozostaje
lokalny. Jeśli port 80 obsługiwał już stronę, jego reguły prawdopodobnie są gotowe.

Test Nginx lokalnie z właściwą domeną w nagłówku:

```sh
curl -I -H 'Host: study.example.com' http://127.0.0.1/
curl -I -H 'Host: study.example.com' http://127.0.0.1/admin
```

Następnie z komputera uczestnika otwórz `http://study.example.com` oraz
`http://study.example.com/admin`. Sprawdź logowanie, odczyt materiału i zapis
odpowiedzi. Przy `502` sprawdź backend i SELinux; przy `403` materiału — ACL
oraz jego etykietę. Logi:

```sh
sudo journalctl -u video-quality-app -n 100 --no-pager
sudo tail -n 100 /var/log/nginx/video-quality-app.error.log
```

## HTTP i passkeys

Przy bezpośrednim dostępie przez publiczne `http://` passkeys nie działają;
WebAuthn wymaga bezpiecznego kontekstu. Logowanie hasłem i odpowiedzi uczestników
są przesyłane bez szyfrowania transportu.
Zobacz [wymagania WebAuthn](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API).

Jeśli istniejąca infrastruktura zapewnia HTTPS przed tym serwerem, port 80
może być portem połączenia między nią a Nginx. Wtedy `ADMIN_ORIGIN` ma wskazywać
publiczny adres `https://...`, a konfiguracja proxy musi przekazywać poprawny
schemat połączenia od zaufanego pośrednika. Powyższy szablon zakłada bezpośredni
HTTP; nie odtwarza automatycznie konfiguracji zewnętrznego proxy.
