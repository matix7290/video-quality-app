// Always test an isolated production copy. Never send synthetic responses to a live study.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const Database = require('better-sqlite3');
const { defaults } = require('../utils/study-config.cjs');
const { questionsForPhase } = require('../utils/questions.cjs');
const { hashPassword } = require('../utils/admin-password.cjs');
const root = path.resolve(__dirname, '..');

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}
const users = Number(option('--users', 100));
const mediaMiB = Number(option('--media-mib', 1));
const maxP95 = Number(option('--max-p95-ms', 500));
if (!Number.isInteger(users) || users < 1 || users > 1000 || !Number.isInteger(mediaMiB) || mediaMiB < 1 || mediaMiB > 128 || !Number.isFinite(maxP95) || maxP95 <= 0) {
  throw new Error('Use --users 1..1000, --media-mib 1..128 and --max-p95-ms greater than zero.');
}
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--users', '--media-mib', '--max-p95-ms', '--output', '--nginx-bin'].includes(process.argv[i]) || process.argv[i + 1] === undefined) {
    throw new Error(`Unknown/incomplete option: ${process.argv[i]}. This runner does not accept a live server URL.`);
  }
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] * 100) / 100;
  return { requests: values.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: percentile(1) };
}
async function main() {
  if (option('--nginx-bin')) fs.accessSync(path.resolve(option('--nginx-bin')), fs.constants.X_OK);
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'video-study-load-')));
  let server, proxy;
  const env = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_PATH: path.join(directory, 'video_quality.db'),
    ADMIN_PASSWORD_HASH: await hashPassword(crypto.randomBytes(24).toString('hex')),
    ADMIN_SESSION_SECRET: crypto.randomBytes(32).toString('hex'), ADMIN_ORIGIN: '' };
  delete env.ADMIN_PASSWORD;
  const expiry = String(Date.now() + 8 * 3600 * 1000);
  const passwordDigest = crypto.createHash('sha256').update(env.ADMIN_PASSWORD_HASH).digest('hex');
  const signature = crypto.createHmac('sha256', Buffer.from(env.ADMIN_SESSION_SECRET, 'hex')).update(`${expiry}:${passwordDigest}`).digest('hex');
  const adminCookie = `study_admin=${expiry}.${signature}`;
  try {
    // Explicit source allowlist excludes real .env files, settings, responses and media.
    for (const item of ['pages', 'components', 'hooks', 'utils', 'styles', 'scripts', 'database.js', 'package.json',
      'package-lock.json', 'next.config.mjs', 'next-i18next.config.js', 'jsconfig.json', 'postcss.config.js', 'tailwind.config.js', 'eslint.config.mjs']) {
      fs.cpSync(path.join(root, item), path.join(directory, item), { recursive: true });
    }
    fs.cpSync(path.join(root, 'public'), path.join(directory, 'public'), { recursive: true,
      filter: filename => !['videos', 'images'].some(folder => filename === path.join(root, 'public', folder)) });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(directory, 'config'));
    fs.mkdirSync(path.join(directory, 'public/videos'));
    fs.mkdirSync(path.join(directory, 'public/images'));
    // Synthetic transfer fixture; this tests delivery, not video decoding or visual quality.
    const media = Buffer.alloc(mediaMiB * 1024 * 1024);
    Buffer.from('000000186674797069736f6d', 'hex').copy(media);
    const mediaHash = crypto.createHash('sha256').update(media).digest('hex');
    fs.writeFileSync(path.join(directory, 'public/videos/load-one.mp4'), media);
    fs.writeFileSync(path.join(directory, 'public/videos/load-two.mp4'), media.subarray(0, 1024));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
    for (const name of ['load-one.png', 'load-two.png']) fs.writeFileSync(path.join(directory, 'public/images', name), png);
    function configure(type) {
      const selectedVideos = type === 'video' ? ['load-one.mp4', 'load-two.mp4'] : ['load-one.png', 'load-two.png'];
      const settings = { ...defaults(), stimulusType: type, selectedVideos, mode: 'both', phaseOrder: 'balanced', imageDuration: 0.5 };
      const questionsCsv = 'stimulus_name,question,correct_answer,part\n' + selectedVideos.map(name => `${name},Control question?,yes,both`).join('\n') + '\n';
      fs.writeFileSync(path.join(directory, 'config/study.json'), JSON.stringify({ settings, questionsCsv }));
    }
    configure('video');
    console.log(`Building isolated production app; ${users} participants per stimulus type.`);
    const build = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'build'], { cwd: directory, env, stdio: 'inherit' });
    const [buildCode] = await once(build, 'exit');
    if (buildCode !== 0) throw new Error(`Production build failed (${buildCode}).`);
    const port = await freePort();
    let base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [path.join(directory, 'scripts/start-production.cjs')], {
      cwd: directory, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    let serverLog = '';
    server.stdout.on('data', chunk => { serverLog = (serverLog + chunk).slice(-10000); });
    server.stderr.on('data', chunk => { serverLog = (serverLog + chunk).slice(-10000); });
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (server.exitCode !== null) throw new Error(`Server stopped: ${serverLog}`);
      try { const response = await fetch(`${base}/api/video-list`, { signal: AbortSignal.timeout(2000) }); await response.text(); if (response.ok) { ready = true; break; } }
      catch { /* Startup only. Measured requests never suppress failures. */ }
      await delay(200);
    }
    if (!ready) throw new Error(`Server did not start: ${serverLog}`);
    const nginx = option('--nginx-bin');
    if (nginx) {
      const proxyPort = await freePort();
      const config = fs.readFileSync(path.join(root, 'deploy/nginx.conf'), 'utf8')
        .replaceAll('/srv/video-quality-app', directory)
        .replaceAll('127.0.0.1:3000', `127.0.0.1:${port}`)
        .replaceAll('127.0.0.1:8080', `127.0.0.1:${proxyPort}`)
        .replaceAll('/tmp/video-quality-nginx', path.join(directory, 'nginx'));
      const filename = path.join(directory, 'nginx.conf');
      fs.writeFileSync(filename, config); fs.mkdirSync(path.join(directory, 'logs'));
      proxy = spawn(path.resolve(nginx), ['-p', directory + '/', '-c', filename, '-g', 'daemon off;'], {
        stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
      });
      proxy.stdout.on('data', () => {});
      proxy.stderr.on('data', chunk => { serverLog = (serverLog + chunk).slice(-10000); });
      base = `http://127.0.0.1:${proxyPort}`;
      ready = false;
      for (let i = 0; i < 50; i++) {
        if (proxy.exitCode !== null) throw new Error(`Nginx stopped: ${serverLog}`);
        try { const response = await fetch(`${base}/api/video-list`); await response.text(); if (response.ok) { ready = true; break; } }
        catch { /* Proxy startup only. */ }
        await delay(100);
      }
      if (!ready) throw new Error(`Nginx did not start: ${serverLog}`);
      const mediaUrl = `${base}/api/stimuli/load-one.mp4`;
      const head = await fetch(mediaUrl, { method: 'HEAD' });
      assert.equal(head.status, 200); assert.equal(Number(head.headers.get('Content-Length')), media.length);
      assert.equal(head.headers.get('Content-Type'), 'video/mp4');
      assert.match(head.headers.get('Cache-Control'), /max-age=3600/);
      const range = await fetch(mediaUrl, { headers: { Range: 'bytes=4-7' } });
      assert.equal(range.status, 206); assert.equal(await range.text(), 'ftyp');
      assert.equal((await fetch(mediaUrl, { headers: { Range: `bytes=${media.length + 1}-` } })).status, 416);
      // Use raw HTTP because Fetch can normalize/ignore the forbidden Host header.
      const unrecognizedStatus = await new Promise((resolve, reject) => {
        http.get(base + '/api/video-list', { headers: { Host: 'unrecognized.invalid' }, timeout: 5000 }, response => {
          response.resume(); response.on('end', () => resolve(response.statusCode));
        }).on('error', reject).on('timeout', function () { this.destroy(new Error('Host check timed out')); });
      });
      assert.equal(unrecognizedStatus, 404);
      fs.symlinkSync(path.join(directory, 'public/videos/load-one.mp4'), path.join(directory, 'public/videos/link.mp4'));
      const linked = await fetch(base + '/api/stimuli/link.mp4');
      assert.ok([403, 404].includes(linked.status)); await linked.text();
      console.log('Nginx media delivery, MIME, cache, HEAD, ranges, host rejection and symlink protection verified.');
    }

    const durations = {}, failures = [], scenarios = [];
    let active = 0, peakRequests = 0;
    async function request(route, body, headers = {}, category = route) {
      const start = performance.now(); active++; peakRequests = Math.max(peakRequests, active);
      try {
        const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
          headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
          body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
        const text = await response.text();
        assert.ok(response.ok, `${route}: ${response.status} ${text.slice(0, 200)}`);
        return response.headers.get('Content-Type')?.includes('application/json') ? JSON.parse(text) : text;
      } catch (error) { failures.push({ category, error: error.message }); throw error; }
      finally { active--; (durations[category] ||= []).push(performance.now() - start); }
    }
    async function parallel(items, work) {
      const results = await Promise.allSettled(items.map(work));
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      return results.map(result => result.value);
    }
    const indices = Array.from({ length: users }, (_, i) => i);
    for (const type of ['video', 'image']) {
      configure(type);
      // Warm all tested routes separately from the measured burst.
      await (await fetch(`${base}/`)).text(); await request('/api/video-list');
      const started = performance.now();
      await parallel(indices, () => request('/', undefined, {}, 'welcome'));
      const manifests = await parallel(indices, () => request('/api/video-list'));
      const sessions = await parallel(indices, i => request('/api/create-user', {
        sessionId: `load-${type}-${i}`, videoOrder: manifests[i].videos, configVersion: manifests[i].settings.version,
        clientInfo: { loadTest: true }, PROLIFIC_PID: `synthetic-${i}`,
      }));
      assert.equal(sessions.filter(s => s.settings.phaseSequence[0] === 'standard').length, Math.ceil(users / 2));
      assert.equal(sessions.filter(s => s.settings.phaseSequence[0] === 'slider').length, Math.floor(users / 2));
      await parallel(sessions, session => request('/api/create-user', { sessionId: session.sessionId, videoOrder: [], clientInfo: {} }));
      await parallel(sessions, session => request('/api/screentest', { sessionId: session.sessionId,
        payload: { screen: '1920x1080', browser: 'load-test', smallestNumber: 1, highestNumber: 8, reliability: 1 } }));
      let mediaDelivery;
      if (type === 'video') {
        const mediaStart = performance.now(), mediaTimes = [];
        await parallel(indices, async () => {
          const start = performance.now();
          const response = await fetch(base + manifests[0].videos[0], { signal: AbortSignal.timeout(60000) });
          assert.equal(response.status, 200);
          const digest = crypto.createHash('sha256'); let bytes = 0;
          for await (const chunk of response.body) { bytes += chunk.length; digest.update(chunk); }
          assert.equal(bytes, media.length); assert.equal(digest.digest('hex'), mediaHash);
          mediaTimes.push(performance.now() - start);
        });
        const seconds = (performance.now() - mediaStart) / 1000;
        mediaDelivery = { ...stats(mediaTimes), bytesPerParticipant: media.length, totalBytes: media.length * users,
          seconds: Math.round(seconds * 100) / 100, aggregateMiBPerSecond: Math.round(mediaMiB * users / seconds * 100) / 100 };
      } else await parallel(indices, () => request(manifests[0].videos[0], undefined, {}, 'image-download'));
      for (let part = 0; part < 2; part++) {
        for (let clip = 0; clip < 2; clip++) {
          const payloads = sessions.map(session => {
            const videoName = decodeURIComponent(session.videoOrder[clip].split('/').pop());
            const phase = session.settings.phaseSequence[part];
            const questions = questionsForPhase(session.questions[videoName] || [], session.settings, phase);
            return { sessionId: session.sessionId, videoName, phase, rating: phase === 'slider' ? 3.27 : 4, duration: 2,
              answers: questions.map(q => ({ questionId: q.id, answer: true })) };
          });
          await parallel(payloads, body => request('/api/rate-video', body));
          await parallel(payloads, body => request('/api/rate-video', body)); // Lost-response retry.
        }
      }
      await parallel(sessions, session => request('/api/update-end-time', { sessionId: session.sessionId }));
      await parallel(sessions, session => request('/api/update-end-time', { sessionId: session.sessionId }));
      scenarios.push({ type, participants: users, seconds: Math.round((performance.now() - started) / 10) / 100,
        firstScale: { standard: sessions.filter(s => s.settings.phaseSequence[0] === 'standard').length,
          slider: sessions.filter(s => s.settings.phaseSequence[0] === 'slider').length }, ...(mediaDelivery ? { mediaDelivery } : {}) });
    }
    const actual = await request('/api/admin/results', undefined, { Cookie: adminCookie });
    assert.deepEqual(actual, { sessions: users * 2, completed: users * 2, ratings: users * 8, answers: users * 8 });
    for (const type of ['ratings', 'answers']) {
      const csv = await request(`/api/admin/results?type=${type}&complete=1`, undefined, { Cookie: adminCookie }, 'csv-export');
      const { parseCsv } = require('../utils/questions.cjs');
      assert.equal(parseCsv(csv).length, users * 8 + 1);
    }
    const db = new Database(env.DATABASE_PATH, { readonly: true });
    let database;
    try {
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM screentests').get().n, users * 2);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM control_answers WHERE is_correct = 1').get().n, users * 8);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM ratings GROUP BY user_id, video_name, phase HAVING COUNT(*) > 1)').get().n, 0);
      database = { journalMode: db.pragma('journal_mode', { simple: true }), sqliteVersion: db.prepare('SELECT sqlite_version() AS version').get().version,
        integrity: 'ok', ...actual, screenTests: users * 2, duplicates: 0 };
    } finally { db.close(); }
    const apiTimes = Object.entries(durations).filter(([name]) => ['/api/video-list', '/api/create-user', '/api/screentest', '/api/rate-video', '/api/update-end-time'].includes(name)).flatMap(([, values]) => values);
    const api = stats(apiTimes);
    const passed = failures.length === 0 && api.p95Ms <= maxP95;
    const report = { timestamp: new Date().toISOString(), environment: { platform: os.platform(), arch: os.arch(),
      cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 1024 ** 3), node: process.version, next: require('next/package.json').version,
      server: nginx ? 'isolated Nginx + Next.js production, loopback HTTP; WAN excluded' : 'isolated Next.js production, direct loopback HTTP; Nginx and WAN excluded',
      media: 'synthetic transfer fixtures; video decoding excluded' },
      usersPerScenario: users, mediaMiB, peakApiRequests: peakRequests, scenarios, api, thresholds: { errors: 0, maxApiP95Ms: maxP95 },
      endpoints: Object.fromEntries(Object.entries(durations).map(([name, values]) => [name, stats(values)])), database, failures, passed };
    const output = option('--output');
    if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (!passed) throw new Error(`Load thresholds failed: API p95 ${api.p95Ms} ms; limit ${maxP95} ms.`);
  } finally {
    if (proxy && proxy.exitCode === null) {
      if (process.platform === 'win32') proxy.kill('SIGTERM'); else process.kill(-proxy.pid, 'SIGTERM');
      await Promise.race([once(proxy, 'exit'), delay(5000)]);
      if (proxy.exitCode === null && process.platform !== 'win32') process.kill(-proxy.pid, 'SIGKILL');
    }
    if (server && server.exitCode === null) {
      // Stop the wrapper and its Next.js child before removing the temporary database.
      if (process.platform === 'win32') server.kill('SIGTERM'); else process.kill(-server.pid, 'SIGTERM');
      await Promise.race([once(server, 'exit'), delay(5000)]);
      if (server.exitCode === null && process.platform !== 'win32') process.kill(-server.pid, 'SIGKILL');
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
