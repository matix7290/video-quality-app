[Polski](README.md) | **English**

# Video quality study

This Next.js application stores ratings and responses in a local SQLite database,
`video_quality.db`.

## Getting started

Use Node.js 20.19 or later. Run these commands in the project directory:

```sh
npm ci
npm run dev
```

The application is available at `http://localhost:3000`. To use another port, run
`npm run dev -- --port 3001` (the same option works with `npm start`).
Optionally, `nvm install` and `nvm use` select the LTS version specified in `.nvmrc`.
You can keep an already installed, compatible Node.js version.
After changing the Node.js major version, run `npm ci` again because SQLite uses
a native module.

The project checks the Node.js version and SQLite availability before starting.
The `allowScripts` setting in `package.json` permits installation scripts for
specific versions of the required modules. This prevents npm 12 from skipping
SQLite setup; see the [npm documentation](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/).
Place MP4 videos in `public/videos` and JPG/PNG/WebP images in `public/images`, or
import them through the administrator panel. Run `npm run build`, `npm run lint`
and `npm test` to check compilation, code, CSV import, migrations and response storage.

## Videos or images as stimuli

In **Administrator panel → Stimuli → Stimulus type**
(**Panel administratora → Stymuli → Rodzaj stymulów**), select MP4 videos or
JPG/JPEG, PNG or WebP images. Each study configuration uses one type of material.
The file list, select-all action and folder import follow the selected type.
Imported images are stored in `public/images` (50 MB per file), and videos in
`public/videos` (2 GB per file). Import checks that file contents match the format
and does not overwrite existing files. Switching the stimulus type does not
delete materials or questions; sessions already started retain their selected files.

In **Flow and scales → Image display duration (s)**
(**Przebieg i skale → Czas wyświetlania zdjęcia (s)**), set the exposure time from
0.5 to 300 seconds, in 0.1-second increments; the default is 5 seconds. Timing
starts after the image loads. Images retain their aspect ratio and are displayed
without cropping or file optimization. The rating scale and any assigned control
questions appear after the exposure. A loading error stops progression and offers
a retry; no rating is saved automatically. Automatic fullscreen also applies to
images on supported devices.

Image studies support one or two parts, both rating scales and a 50/50 allocation
of scale order. In the second part, participants see the same images in the same
order and for the same duration. Default Polish and English instructions adapt
to the stimulus type. Custom text is preserved and can be edited under
**Screen text** (**Teksty ekranów**). Stimulus type and exposure duration are copied
into the session when it starts, so later configuration changes do not affect
that session. Older configurations and results retain the `video` type.

Question CSV files accept `stimulus_name` for an image or video filename, as well
as the existing `video_name` column. Use one of these columns. Question exports
for images use `stimulus_name`; yes/no answers, optional answer keys and `part`
assignments work the same way for both stimulus types. Result exports include
`stimulus_type` (`video`/`image`). The `video_name` column also contains filenames
for images, preserving compatibility with existing analyses.

## Study flow

The default study flow is:

1. Instructions and a screen test.
2. All videos in random order, rated using buttons (1–5). After rating a video
   with assigned control questions, participants must provide yes/no answers.
3. A transition screen before the second part.
4. The same videos in the same order, rated using a continuous 1–5 slider with
   a step of 0.01. Points 1–5 have labels matching the discrete scale. Participants
   must select a value before submitting; the initial value of 3 is not treated
   as an answer automatically.
5. A thank-you screen after both parts have been saved successfully.

Each control question can appear in the first part, second part or both parts.
In a study with one part, all questions assigned to a stimulus are shown.
Correct answers are hidden from participants. A save error stops progression and
allows the same response to be submitted again. The screen test must be saved
before rating begins. After a connection error, its form stays open and
participants can click the finish button again. A video download or playback
failure shows an error message and a reload button; participants cannot rate
material that has not been displayed.
Refreshing the page starts a new session; resuming an interrupted study is not
yet supported.

## Control questions from CSV

Before saving the configuration in the panel for the first time, you can edit
`config/control-questions.csv` (UTF-8, comma-separated). The panel uses the same
format for imports:

```csv
video_name,question,correct_answer,part
example_vmaf_80.mp4,Did a car appear in the video?,yes,first
example_vmaf_80.mp4,"Was there a person, who was running?",no,second
another_vmaf_60.mp4,Was the scene filmed outdoors?,,both
```

- `video_name` or `stimulus_name`: the exact filename in `public/videos` or
  `public/images`, including its extension.
- `question`: the yes/no question text. Multiple rows for the same stimulus
  create multiple questions.
- `correct_answer`: an optional `yes`/`no` or `tak`/`nie` answer key. Leave it
  empty to collect an answer without checking correctness. You can also omit
  this column.
- `part`: `first`, `second` or `both`. Part numbers refer to presentation order
  for each participant, regardless of scale type or 50/50 allocation. An omitted
  column or empty value means `first`, preserving the behavior of older CSV
  files. New questions added in the panel default to `both`.
- Enclose questions containing commas in double quotes. Represent a double
  quote within the question text as `""`.
- An unknown stimulus, empty question, invalid answer key or invalid part
  assignment prevents the study from starting and shows a configuration error.

The working CSV initially contains only a header, meaning there are no questions.
The separate `config/control-questions.example.csv` provides a template and is
not loaded by the application. Question settings are copied into each session
when it is created. CSV edits apply to new sessions. Question text is displayed
exactly as entered; provide English questions for an English-language study.

## Data

The database migration adds columns and tables without deleting existing data.

- `users.questions_snapshot`: the questions and answer keys used in the session.
- `ratings.phase`: `standard` or `slider`.
- `ratings.stimulus_type`: `video` or `image`; older ratings use `video`.
- `ratings.scale_type`: `categorical` or `continuous`.
- `ratings.rating`: a number from 1 to 5; slider ratings retain their fractional
  part. SQLite also stores fractional values in the existing column with INTEGER
  affinity.
- `ratings.duration`: time from the end of a video or image exposure until the
  response is submitted, including control questions when present.
- `control_answers`: the associated rating via `rating_id`, question ID and text,
  a 0/1 response, the correct answer and `is_correct` (NULL when no key is provided).

Resubmitting a response for the same session, stimulus and part does not create
a duplicate or change the first saved response. Existing ratings are assigned
the `standard` phase.

## Administrator panel

Open the [administrator panel](http://localhost:3000/admin). Panel controls are
currently labeled in Polish; participant screens support Polish and English.
The panel includes:

- **Stimuli** (**Stymuli**): video or image selection, folder and file import,
  selection of study materials and preview.
- **Flow and scales** (**Przebieg i skale**): buttons, slider or two parts, slider
  step, labels for 1–5, random or selection order, screen test and automatic fullscreen.
- **Screen text** (**Teksty ekranów**): instructions, transitions and thank-you
  text in Polish and English.
- **Control questions** (**Pytania kontrolne**): table editing, part assignments
  for each question, optional answer keys and CSV import/export.
- **Preview** (**Podgląd**): screens and scales using editor settings, without
  creating sessions or saving responses.
- **Results** (**Wyniki**): session statistics and CSV exports of ratings and
  answers, optionally limited to completed sessions.

**Save configuration** (**Zapisz konfigurację**) applies settings to new sessions.
Viewing the preview does not publish changes. Settings and questions are saved
atomically in `config/study.json`. This local configuration file is excluded from
Git and should be included in backups. Before the first save, the panel uses the
existing `config/control-questions.csv`. After the first save, edit questions in
the panel or import a CSV; the separate CSV file is no longer loaded automatically.
CSV import replaces the editor's question table, and saving is required to apply
the changes. Questions for unselected stimuli remain in the configuration and
return when those stimuli are selected again.

Folder import copies files of the selected type to `public/videos` or
`public/images` on the application server, skipping other formats. Each video
can be up to 2 GB, and each image up to 50 MB. Subfolders are flattened to
filenames; duplicate names produce a conflict message without overwriting
existing stimuli. Videos are served through an API supporting range requests,
so imported files work without rebuilding the application. Removing a stimulus
from the study selection does not delete it from disk, and earlier sessions
retain access. The server needs writable, persistent storage for configuration,
stimuli and the SQLite database.

Each new session receives `users.settings_snapshot` with its settings and version
identifier. Configuration edits do not affect a study already in progress.
Exports include `study_version`; older sessions without a settings snapshot use
`legacy` and retain their existing two-part flow.
In a study with one part, the question part selector is disabled and displays
**Only study part** (**Jedyna część badania**). All questions assigned to a stimulus
are required, regardless of their CSV `part` value. Earlier assignments are
preserved and restored when two parts are enabled again. This also applies to
imported questions. Sessions started before part assignments were introduced
continue to show questions only in the first part. In answer exports,
`phase_position` identifies the part number, `phase` identifies the rating scale,
and `scale_type` distinguishes `categorical` from `continuous`.

### Automatic fullscreen

Under **Flow and scales** (**Przebieg i skale**), the administrator configures
automatic fullscreen presentation of stimuli. Participants do not choose this
setting on the welcome screen. It applies to all devices and is stored in both
the configuration and the session snapshot; existing sessions are unaffected.
`users.auto_fullscreen` receives the server configuration value regardless of
what the participant request contains. Older configurations without this setting
default to fullscreen off; older sessions retain the value stored in
`users.auto_fullscreen`. The browser must support and permit the Fullscreen API;
if it denies the request, the stimulus is still displayed.

### Scale order

Under **Flow and scales → Scale order** (**Przebieg i skale → Kolejność skal**),
select discrete scale first, slider first, or **Alternate between participants
(50/50)** (**Na zmianę między uczestnikami (50/50)**). This setting applies to
studies with both scales. Each participant rates all selected stimuli in the
first part, then sees the same stimuli in the same order in the second part.
Control questions follow the assignment configured for each question.

With 50/50 allocation, successive new sessions of the same configuration version
alternate between starting with the discrete scale and starting with the slider.
With an odd number of sessions, one group has one more participant. Allocation
counts started sessions, including unfinished ones, so the ratio among completed
studies may differ. Allocation is atomic and stored in
`settings_snapshot.phaseSequence`; retrying a start does not change the assigned
group. Configuration edits do not change the order for sessions already started.
Older sessions retain the discrete → slider order.

Preview allows both orders to be checked without adding sessions. Under
**Screen text** (**Teksty ekranów**), separate second-part instructions can be
edited for the slider and buttons. Rating and answer exports include `first_phase`
and `phase_position` (1 or 2) to distinguish the assigned orders.

### Panel access

By default, the panel and its API are available only through a local connection
using `localhost`, `127.0.0.1` or `::1`. To protect the panel locally as well and
make it available over the network, run this command in the application directory:

```bash
npm run admin:password
```

The command asks for the password twice without displaying it or storing it in
terminal history. Use at least 12 characters. It stores only `ADMIN_PASSWORD_HASH`
(scrypt: N=131072, r=8, p=1, a random 16-byte salt) and a separate random
`ADMIN_SESSION_SECRET` in `.env.local`. The file has permissions `600` and is
ignored by Git. Keep the session secret private: file permissions do not protect
against the system administrator or a compromised user account.

If `.env.local` still contains the old `ADMIN_PASSWORD`, migrate it to retain your
existing password:

```bash
npm run admin:password -- --migrate
```

Migration removes the plaintext value while preserving the password previously
used by Next.js. It does not create a plaintext password backup. Other file
settings are preserved. An old configuration or invalid hash does not allow login
or a localhost authentication bypass. For hosting, configure the same two
variables in your secrets manager and remove `ADMIN_PASSWORD`.

Restart the server after each change. The panel will request a password; login
expires after eight hours. Changing the password or session secret invalidates
existing logins. Use `npm run admin:password` to change the password; registered
passkeys are retained. When deploying behind a reverse proxy, use HTTPS and
forward `Host` and `X-Forwarded-Proto`. The panel blocks requests from other
websites. Set a password when using a local reverse proxy as well.

Possible future additions include training clips, breaks between blocks,
restoring saved configuration versions and Prolific completion settings.

### Passkey login (WebAuthn)

1. Set a password using `npm run admin:password`, restart the server and log in
   to `/admin`.
2. Open **Access** (**Dostęp**), name the key and select **Add passkey**
   (**Dodaj passkey**).
3. Confirm key creation in the browser using Touch ID, a PIN, a phone or a
   hardware security key.
4. For subsequent logins, select **Log in with passkey** (**Zaloguj się passkey**).
   The password remains available as a recovery method.

For local use, open `http://localhost:3000` (or your chosen port), even if you
previously accessed the application through `127.0.0.1`. For deployment, set the
full HTTPS origin in `.env.local`:

```dotenv
ADMIN_ORIGIN=https://study.example.com
```

The origin must not include the `/admin` path. A passkey is bound to its domain,
so a key created on localhost must be registered again on the deployment domain.
HTTPS is required outside localhost. An embedded editor browser may not support
the system passkey manager; use Chrome or Safari in that case. Restart the server
after changing environment settings. The implementation uses
[SimpleWebAuthn](https://simplewebauthn.dev/docs/packages/server).

Public keys, device names and signature counters are stored in `admin_passkeys`
in the same SQLite database. Private keys and biometric data remain on the device
or in its passkey manager. Registration requires an existing administrator
session. Responses are checked for a valid signature, domain, random challenge
and user verification. Each attempt is bound to the browser, can be used once and
expires after five minutes. Panel sessions last eight hours.

Keep `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET` after registering a passkey.
The hash enables password login, and the separate secret signs sessions. If keys
exist in the database, removing authentication configuration does not enable
access without login. Removing a key under **Access** (**Dostęp**) blocks future
logins with that key, but does not end existing sessions or remove the entry from
the device's passkey manager. Database backups also include administrator public
keys; recovering the password alone does not remove registered keys.
