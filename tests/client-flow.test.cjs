const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function xhrFixture() {
  let xhr, created = 0, finished = 0, failed = 0;
  class FakeXHR {
    constructor() { xhr = this; this.status = 200; this.response = new ArrayBuffer(4); }
    open(method, url) { this.method = method; this.url = url; }
    send() {}
    abort() { this.aborted = true; }
    getResponseHeader() { return 'video/mp4; charset=binary'; }
  }
  const source = fs.readFileSync(path.join(__dirname, '../utils/xhr.js'), 'utf8').replace('export function', 'function');
  const getBinary = new Function('XMLHttpRequest', 'URL', 'Blob', `${source}; return getBinaryAsBlobUrl;`)
    (FakeXHR, { createObjectURL() { created++; return 'blob:test'; } }, Blob);
  const progress = [];
  const request = getBinary({ url: '/api/stimuli/clip.mp4', onProgress: value => progress.push(value),
    onDone: value => { finished++; assert.deepEqual(value, { mime: 'video/mp4', blobUrl: 'blob:test' }); }, onError: () => failed++ });
  request.onProgress(true);
  return { xhr, request, progress, counts: () => ({ created, finished, failed }) };
}

test('video downloads report progress and only prepare a blob for successful nonempty responses', () => {
  const fixture = xhrFixture();
  assert.equal(fixture.xhr.method, 'GET');
  fixture.xhr.onprogress({ lengthComputable: true, loaded: 1, total: 4 });
  fixture.xhr.onload({ target: fixture.xhr });
  assert.deepEqual(fixture.progress, [25]);
  assert.deepEqual(fixture.counts(), { created: 1, finished: 1, failed: 0 });
});
test('missing, forbidden, failed and empty video downloads stop playback without creating a blob', () => {
  for (const status of [404, 403, 500, 200]) {
    const fixture = xhrFixture();
    fixture.xhr.status = status;
    if (status === 200) fixture.xhr.response = new ArrayBuffer(0);
    fixture.xhr.onload({ target: fixture.xhr });
    assert.deepEqual(fixture.counts(), { created: 0, finished: 0, failed: 1 });
  }
});
test('network errors and timeouts expose retry while cancelled video requests remain silent', () => {
  for (const event of ['onerror', 'ontimeout']) {
    const fixture = xhrFixture(); fixture.xhr[event]();
    assert.deepEqual(fixture.counts(), { created: 0, finished: 0, failed: 1 });
  }
  const fixture = xhrFixture(); fixture.request.controller.abort();
  fixture.xhr.onload({ target: fixture.xhr }); fixture.xhr.onerror();
  assert.equal(fixture.xhr.aborted, true);
  assert.deepEqual(fixture.counts(), { created: 0, finished: 0, failed: 0 });
});

function screenFixture(post, sessionId = 'screen-session') {
  let listener, finished = 0, failed = 0, removed = false;
  const sourceWindow = {};
  const window = { location: { origin: 'http://localhost:3000' }, addEventListener(type, fn) { listener = fn; },
    removeEventListener(type, fn) { assert.equal(fn, listener); removed = true; } };
  const document = { querySelector: () => ({ contentWindow: sourceWindow }) };
  let cleanup;
  const source = fs.readFileSync(path.join(__dirname, '../hooks/useScreentestListener.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default ', '');
  const hook = new Function('useEffect', 'useRef', 'axios', 'window', 'document', `${source}; return useScreentestListener;`)
    (effect => { cleanup = effect(); }, value => ({ current: value }), { post }, window, document);
  const saving = [];
  hook(sessionId, () => finished++, { onSaving: value => saving.push(value), onError: () => failed++ });
  const event = { origin: window.location.origin, source: sourceWindow, data: { type: 'SCREENTEST_RESULT', payload: { smallestNumber: '1' } } };
  return { event, send: message => listener(message), cleanup: () => cleanup(), saving, counts: () => ({ finished, failed, removed }) };
}
test('screen test advances only after its save succeeds and ignores duplicate or foreign messages', async () => {
  let resolve, calls = 0;
  const fixture = screenFixture((url, body) => {
    assert.equal(url, '/api/screentest'); assert.equal(body.sessionId, 'screen-session'); calls++;
    return new Promise(done => { resolve = done; });
  });
  await fixture.send({ ...fixture.event, origin: 'http://foreign.example' });
  await fixture.send({ ...fixture.event, source: {} });
  assert.equal(calls, 0);
  const pending = fixture.send(fixture.event);
  await fixture.send(fixture.event);
  assert.equal(calls, 1); assert.equal(fixture.counts().finished, 0);
  resolve(); await pending;
  assert.equal(fixture.counts().finished, 1); assert.deepEqual(fixture.saving, [true, false]);
  fixture.cleanup(); assert.equal(fixture.counts().removed, true);
});
test('screen test failures keep the test open and allow resubmitting the same payload', async () => {
  let calls = 0;
  const fixture = screenFixture(async () => { if (++calls === 1) throw new Error('Network failure'); });
  await fixture.send(fixture.event);
  assert.deepEqual(fixture.counts(), { finished: 0, failed: 1, removed: false });
  await fixture.send(fixture.event);
  assert.deepEqual(fixture.counts(), { finished: 1, failed: 1, removed: false });
  const withoutSession = screenFixture(() => assert.fail('Cannot save without a session'), null);
  await withoutSession.send(withoutSession.event);
  assert.equal(withoutSession.counts().finished, 0);
});
