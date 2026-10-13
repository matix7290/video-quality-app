const { test, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { removeStimulus } = require('../utils/remove-stimulus.cjs');
const { defaults, catalog, readConfiguration, writeConfiguration, validateConfig } = require('../utils/study-config.cjs');
const { readStudy } = require('../utils/study.cjs');
const { parseCsv, removeStimulusQuestions } = require('../utils/questions.cjs');
const { requireAdmin } = require('../utils/admin-auth.cjs');
const { translateAdmin } = require('../utils/admin-i18n.cjs');
const root = path.resolve(__dirname, '..');
let directory, db;
before(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stimulus-deletion-'));
  process.chdir(directory);
  db = require('../database');
});
beforeEach(() => {
  for (const folder of ['public', 'config']) fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync('public/videos', { recursive: true });
  fs.mkdirSync('public/images', { recursive: true });
});
after(() => {
  mock.restoreAll(); db.close(); process.chdir(root);
  fs.rmSync(directory, { recursive: true, force: true });
});
function file(name) {
  const folder = name.endsWith('.mp4') ? 'videos' : 'images';
  fs.writeFileSync(path.join('public', folder, name), `content of ${name}`);
}
function handler() {
  const source = fs.readFileSync(path.join(root, 'pages/api/admin/stimuli.js'), 'utf8').replace(/^import .*;\n/gm, '').replace('export default ', '');
  return new Function('requireAdmin', 'removeStimulus', `${source}; return handler;`)(requireAdmin, removeStimulus);
}
function request(name, extra = {}) {
  return { method: 'DELETE', body: { name }, headers: { host: 'localhost:3000' }, socket: { remoteAddress: '127.0.0.1' }, cookies: {}, ...extra };
}
function response() {
  return { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('deleting a video updates saved selection and questions, refreshes cached study data and retains results', () => {
  file('delete.mp4'); file('keep.mp4');
  writeConfiguration({ ...defaults(), selectedVideos: ['delete.mp4', 'keep.mp4'] }, 'video_name,question,correct_answer,part\ndelete.mp4,Remove?,tak,first\nkeep.mp4,Keep?,nie,both\n');
  assert.equal(readStudy().videos.length, 2);
  const user = db.prepare("INSERT INTO users (session_id, auto_fullscreen, client_info, playlist) VALUES ('deletion-result', 0, '{}', '[]')").run().lastInsertRowid;
  db.prepare("INSERT INTO ratings (user_id, video_name, clip_name, rating) VALUES (?, 'delete.mp4', 'clip', 4)").run(user);
  const result = removeStimulus('delete.mp4');
  assert.equal(fs.existsSync('public/videos/delete.mp4'), false);
  assert.deepEqual(result.catalog.map(item => item.name), ['keep.mp4']);
  assert.deepEqual(readConfiguration().settings.selectedVideos, ['keep.mp4']);
  assert.deepEqual(Object.keys(readStudy().questions), ['keep.mp4']);
  assert.deepEqual(readStudy().videos, ['/api/stimuli/keep.mp4']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ratings WHERE video_name = 'delete.mp4'").get().n, 1);
  assert.equal(fs.readdirSync('public/videos').some(name => name.endsWith('.deleted')), false);
});

test('the last selected image can be deleted and the empty study can still be opened in the admin panel', () => {
  file('last.png');
  writeConfiguration({ ...defaults(), stimulusType: 'image', selectedVideos: ['last.png'] }, 'stimulus_name,question\nlast.png,Delete?\n');
  const result = removeStimulus('last.png');
  assert.deepEqual(result.catalog, []);
  assert.deepEqual(readConfiguration().settings.selectedVideos, []);
  assert.deepEqual(parseCsv(readConfiguration().questionsCsv), [['stimulus_name', 'question']]);
  assert.throws(readStudy, /Brak wybranych bodźców/);
  assert.throws(() => validateConfig(readConfiguration().settings, []), /Wybierz przynajmniej/);
  file('new.png');
  const updated = validateConfig({ ...readConfiguration().settings, selectedVideos: ['new.png'] }, catalog().map(item => item.name));
  writeConfiguration(updated, result.questionsCsv);
  assert.deepEqual(readStudy().videos, ['/api/stimuli/new.png']);
});

test('legacy studies remain consistent after deleting an unselected image', () => {
  file('keep.mp4'); file('delete.png');
  fs.mkdirSync('config');
  fs.writeFileSync('config/control-questions.csv', 'stimulus_name,question\ndelete.png,Remove?\nkeep.mp4,Keep?\n');
  removeStimulus('delete.png');
  assert.deepEqual(readConfiguration().settings.selectedVideos, ['keep.mp4']);
  assert.deepEqual(Object.keys(readStudy().questions), ['keep.mp4']);
});

test('question cleanup preserves other columns, quoted commas, multiline questions and similar filenames', () => {
  const csv = 'question,stimulus_name,extra\n"Delete, this",a.png,remove\n"Keep, this\nquestion",aa.png,"custom, value"\n';
  assert.deepEqual(parseCsv(removeStimulusQuestions(csv, 'a.png')), [
    ['question', 'stimulus_name', 'extra'], ['Keep, this\nquestion', 'aa.png', 'custom, value'],
  ]);
  assert.equal(removeStimulusQuestions(csv, 'absent.png'), csv);
});

test('the endpoint rejects unauthorized, foreign-origin and unsupported requests without deleting files', () => {
  file('safe.mp4');
  const remove = handler();
  for (const [extra, status] of [
    [{ socket: { remoteAddress: '192.0.2.1' } }, 401],
    [{ headers: { host: 'localhost:3000', origin: 'https://other.example' } }, 403],
    [{ method: 'GET' }, 405],
  ]) {
    const res = response(); remove(request('safe.mp4', extra), res);
    assert.equal(res.statusCode, status);
    assert.equal(fs.existsSync('public/videos/safe.mp4'), true);
  }
});

test('deletion rejects traversal, unsupported filenames, directories and symbolic links', () => {
  file('safe.mp4');
  fs.symlinkSync(path.resolve('public/videos/safe.mp4'), 'public/videos/link.mp4');
  fs.mkdirSync('public/videos/folder.mp4');
  const remove = handler();
  for (const [name, status] of [['../safe.mp4', 400], ['..\\safe.mp4', 400], ['file.txt', 400], [null, 400], [['safe.mp4'], 400], ['missing.mp4', 404], ['link.mp4', 404], ['folder.mp4', 404]]) {
    const res = response(); remove(request(name), res);
    assert.equal(res.statusCode, status, JSON.stringify(name));
    assert.equal(fs.existsSync('public/videos/safe.mp4'), true);
  }
});

test('a failed configuration save restores the stimulus and leaves the configuration unchanged', () => {
  file('safe.mp4');
  writeConfiguration({ ...defaults(), selectedVideos: ['safe.mp4'] }, 'video_name,question\n');
  const original = fs.readFileSync('config/study.json');
  const rename = fs.renameSync;
  mock.method(fs, 'renameSync', (from, to) => {
    if (to === path.resolve('config/study.json')) throw new Error('simulated save failure');
    return rename(from, to);
  });
  try { assert.throws(() => removeStimulus('safe.mp4'), /simulated save failure/); }
  finally { mock.restoreAll(); }
  assert.deepEqual(fs.readFileSync('config/study.json'), original);
  assert.equal(fs.readFileSync('public/videos/safe.mp4', 'utf8'), 'content of safe.mp4');
  assert.deepEqual(fs.readdirSync('public/videos'), ['safe.mp4']);
});

test('a failed file removal rolls back the saved configuration as well as the file', () => {
  file('safe.png');
  writeConfiguration({ ...defaults(), stimulusType: 'image', selectedVideos: ['safe.png'] }, 'stimulus_name,question\nsafe.png,Keep?\n');
  const original = fs.readFileSync('config/study.json');
  const unlink = fs.unlinkSync;
  mock.method(fs, 'unlinkSync', filename => {
    if (filename.endsWith('.deleted')) throw new Error('simulated delete failure');
    return unlink(filename);
  });
  try { assert.throws(() => removeStimulus('safe.png'), /simulated delete failure/); }
  finally { mock.restoreAll(); }
  assert.deepEqual(fs.readFileSync('config/study.json'), original);
  assert.deepEqual(readStudy().videos, ['/api/stimuli/safe.png']);
  assert.deepEqual(fs.readdirSync('public/images'), ['safe.png']);
});

test('the deletion endpoint returns updated data and its messages are available in English', () => {
  file('delete.mp4'); file('keep.mp4');
  writeConfiguration({ ...defaults(), selectedVideos: ['delete.mp4', 'keep.mp4'] }, 'video_name,question\n');
  const res = response(); handler()(request('delete.mp4'), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.settings.selectedVideos, ['keep.mp4']);
  assert.equal(typeof res.body.version, 'string');
  assert.equal(translateAdmin('en', 'Usunąć bodziec?'), 'Delete this stimulus?');
  assert.equal(translateAdmin('en', 'Usunięto bodziec: delete.mp4.'), 'Stimulus deleted: delete.mp4.');
});
