[Polski](deployment.md) | **English**

# Deployment for 100 simultaneous participants

The prepared setup uses one Next.js application instance, Nginx to deliver original
media, and SQLite on persistent local storage. Repeat the 100-participant test on
your chosen server before launching the study.

## Included changes

- SQLite uses WAL with `synchronous=FULL`. Indexes speed up session rating queries
  and 50/50 allocation. Session creation and response storage use `BEGIN IMMEDIATE`;
  ratings and their control answers are committed together.
- Retries preserve the first observation. A database trigger prevents new duplicate
  ratings without removing historical records.
- Database contention lasting over one second returns `503` with `Retry-After: 1`.
  Participants can resubmit the same form.
- Catalogs, configuration and parsed questions are cached. Panel saves and changes
  to file/directory metadata refresh new sessions; existing sessions retain snapshots.
- The browser retains up to three recent videos, with a combined 128 MiB budget.
  A single larger video remains available during playback. Older Blob URLs are
  released; repeat downloads can use the browser's HTTP cache.
- Media uses `Cache-Control: public, max-age=3600`. Imports never overwrite files.
  Use a new filename for changed material: manually replacing a file under the
  same name can leave an older cached version visible for one hour.
- CSV export reads batches of 500 rows and yields to participant requests between
  batches. Rows inserted after an export starts are excluded. The completed-session
  filter checks completion when each batch is read.

WAL allows readers during a write, but SQLite still has one writer. The database,
`-wal` and `-shm` files must be on the same local disk, without NFS/SMB.
See the [SQLite documentation](https://sqlite.org/wal.html).

## Starting the application

In the application directory on your server, using a Node.js version supported
by the README:

```sh
npm ci
npm run admin:password
npm run build
npm run start:production
```

`start:production` requires valid `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET`,
loads `.env.local` and binds the application to `127.0.0.1:3000`. Use production
mode for the study. Optional `PORT` changes the application port; update the Nginx
upstream accordingly. `DATABASE_PATH` can point to another persistent database
location; the default is `video_quality.db` in the application directory. Changing
this path without transferring the database starts a new collection of results.

On Linux, [video-quality-app.service](../deploy/video-quality-app.service) provides
a systemd process supervisor and restart after failure. Adjust the service user,
checkout directory and Node.js binary, then install the unit:

```sh
sudo cp deploy/video-quality-app.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now video-quality-app
sudo systemctl status video-quality-app
```

The service user needs write access to the database, `config` and media directories.
Nginx needs read and directory traversal access to `public/videos` and `public/images`,
including new uploads; configure permissions/groups or ACLs for your system.
Keep `.env.local` accessible only to its owner (`600`). Start with one application
instance. Multiple replicas, PM2 cluster or multiple hosts require a separate
design for sharing the database, configuration and media.

## Nginx and HTTPS

[nginx.conf](../deploy/nginx.conf) is a complete configuration template:

- videos and images are delivered directly without passing large files through Node.js;
- original bytes, MIME, `HEAD`, ranges and HTTP cache are preserved;
- `Host` and `X-Forwarded-Proto` are forwarded to the application;
- uploads retain the existing limit of 2 GiB per video;
- unrecognized hosts and media symlinks are rejected.

The template listens only on `127.0.0.1:8080`, so it does not publish the study.
Replace `/srv/video-quality-app` with the physical absolute application path.
Check and start the template locally:

```sh
nginx -t -c /absolute/path/to/video-quality-app/deploy/nginx.conf
nginx -c /absolute/path/to/video-quality-app/deploy/nginx.conf
```

If Nginx already serves other sites, integrate the upstream and server blocks
into its existing configuration and merge global settings after review.

For public deployment, set your domain in `server_name`, configure a TLS certificate
and listen on HTTPS port `443`. The default server rejecting unknown hosts must
also listen on the public address. HTTP port `80` should redirect to HTTPS.
The application backend on port `3000` remains local. Example TLS settings:

```nginx
listen 443 ssl;
server_name study.example.com;
ssl_certificate /path/to/fullchain.pem;
ssl_certificate_key /path/to/privkey.pem;
```

Set `ADMIN_ORIGIN=https://study.example.com` and restart the app for passkeys on
the deployment domain. If another proxy terminates TLS, adapt protocol forwarding
to that trusted upstream; the local template assumes TLS termination in Nginx.
On the server, run `sudo nginx -t` before `sudo nginx -s reload`.
When running the template as a separate configuration, add `-c` with the same
absolute configuration path to both commands.
See [Next.js reverse proxy guidance](https://nextjs.org/docs/15/app/guides/self-hosting)
and [Nginx directives](https://nginx.org/en/docs/http/ngx_http_core_module.html).

## Testing 100 participants

```sh
npm run test:load -- --users 100 --media-mib 32 --output /tmp/study-load.json
```

The runner builds a separate production copy on a random local port and removes
it when finished. It uses a separate database, settings and synthetic media;
it does not read the real study's `.env.local`, results or media. It does not accept
a live application URL, preventing synthetic responses from entering your study.

Each scenario creates 100 sessions with two stimuli, both scales, yes/no questions
in both parts, a screen test and 50/50 allocation. Session creation, ratings and
completion requests are retried to verify idempotency. Checks include complete
results, duplicate prevention, CSV output and SQLite integrity. Synthetic video
files test transfer; the runner does not assess video decoding or physical passkeys.

To include the prepared Nginx setup, provide the installed executable:

```sh
npm run test:load -- --users 100 --media-mib 32 --nginx-bin /usr/sbin/nginx --output /tmp/study-load-nginx.json
```

This starts a separate local proxy with a copy of the template. Additional checks
cover MIME, cache, `HEAD`, ranges, unknown hosts and symlinks. Nginx needs access
to the runner's temporary directory.

Success requires zero errors, correct record counts and API p95 below 500 ms.
Adjust the latter with `--max-p95-ms`. This tests bursts without participant think
time; it is not a multi-hour stability test or WAN benchmark. Review API and media
timings separately. Reference reports:
[direct application](performance-100-2026-10-09.json),
[through Nginx](performance-100-nginx-2026-10-09.json).

## Bandwidth and materials

100 participants downloading 30 MB each require approximately 3 GB of transfer.
A 1 Gb/s connection needs at least 24 seconds before overhead. Downloading that
amount within 10 seconds requires approximately 2.4 Gb/s in aggregate. Nginx
reduces application work but cannot increase network bandwidth. Consider a CDN
or smaller start groups if bandwidth is limited. Quality-study media should retain
their original encoding and compression.

Size CPU and RAM after repeating the test on the target machine. Monitor disk
space, response times, HTTP failures, bandwidth and the application process during
a pilot. Local Apple M4 results do not guarantee the same performance on a VPS.

## Backups

Create a consistent SQLite backup while the application is running:

```sh
npm run db:backup -- /secure/backups/study-2026-10-09.db
```

The command uses SQLite's backup API, includes committed WAL data, checks integrity,
saves with permissions `600` and never overwrites existing backups. Separately back
up `config/study.json` (or the CSV before the first panel save), media and administrator
secrets. Copying only `video_quality.db` during operation can omit committed data
in `video_quality.db-wal`. Stop the application before restoring a consistent backup;
do not mix it with old `-wal`/`-shm` files. Test recovery before the actual study.
