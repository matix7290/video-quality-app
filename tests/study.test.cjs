const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const study = require('../utils/study.cjs');
const configuration = require('../utils/study-config.cjs');
const { questionsForPhase } = require('../utils/questions.cjs');
const root = path.resolve(__dirname, '..');
let directory, db, legacy;

function handler(file) {
  const source = fs.readFileSync(path.join(root, 'pages/api', file), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default function handler', 'function handler');
  return new Function('db', 'readStudy', 'publicQuestions', 'validateResponse', 'sessionSettings', 'phases', 'questionsForPhase', `${source}; return handler;`)
    (db, study.readStudy, study.publicQuestions, study.validateResponse, configuration.sessionSettings, configuration.phases, questionsForPhase);
}
function call(file, body, method = 'POST') {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }, setHeader() {} };
  handler(file)({ method, body }, response);
  return response;
}

before(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-study-'));
  fs.mkdirSync(path.join(directory, 'public/videos'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'config'));
  fs.writeFileSync(path.join(directory, 'public/videos/a_vmaf_80.mp4'), 'fixture');
  fs.writeFileSync(path.join(directory, 'public/videos/b clip.mp4'), 'fixture');
  fs.writeFileSync(path.join(directory, 'config/control-questions.csv'), 'video_name,question,correct_answer\na_vmaf_80.mp4,Czy jest samochód?,tak\na_vmaf_80.mp4,Czy jest pies?,nie\n');
  process.chdir(directory);
  // Simulate an existing deployment with one collected rating.
  const Database = require('better-sqlite3');
  legacy = new Database('video_quality.db');
  legacy.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, session_id TEXT UNIQUE, playlist TEXT,
    client_info TEXT, auto_fullscreen INTEGER, prolific_pid TEXT, prolific_study_id TEXT,
    prolific_session_id TEXT, end_time TEXT);
    CREATE TABLE ratings (id INTEGER PRIMARY KEY, user_id INTEGER, video_name TEXT, clip_name TEXT,
      vmaf INTEGER, rating INTEGER CHECK(rating BETWEEN 1 AND 5), duration INTEGER);
    INSERT INTO ratings VALUES (1, NULL, 'old.mp4', 'old', NULL, 4, 1);`);
  legacy.close();
  db = require('../database');
});
after(() => { db?.close(); process.chdir(root); fs.rmSync(directory, { recursive: true, force: true }); });

test('CSV supports BOM, escaped quotes, commas, multiline text and optional answer keys', () => {
  const questions = study.parseQuestions('\uFEFFvideo_name,question,correct_answer\r\na.mp4,"Czy \"\"kot\"\",\nśpi?",no\r\na.mp4,Drugie?,\r\n', ['a.mp4']);
  assert.equal(questions['a.mp4'][0].question, 'Czy "kot",\nśpi?');
  assert.equal(questions['a.mp4'][0].correctAnswer, false);
  assert.equal(questions['a.mp4'][1].correctAnswer, null);
  assert.deepEqual(study.publicQuestions(questions)['a.mp4'][0], { id: 'q1', question: 'Czy "kot",\nśpi?', part: 'first' });
  assert.equal(study.parseQuestions('video_name,question\na.mp4,Pytanie?', ['a.mp4'])['a.mp4'][0].correctAnswer, null);
});
test('CSV rejects unknown videos, broken quoting and invalid answer keys', () => {
  assert.throws(() => study.parseQuestions('video_name,question\nb.mp4,Pytanie?', ['a.mp4']));
  assert.throws(() => study.parseCsv('video_name,question\na.mp4,"unfinished'));
  assert.throws(() => study.parseQuestions('video_name,question,correct_answer\na.mp4,Q?,maybe', ['a.mp4']));
});
test('response validation rejects missing/duplicate answers and invalid numeric values', () => {
  const questions = [{ id: 'q1' }, { id: 'q2' }];
  const valid = { phase: 'standard', rating: 3, duration: 1, answers: [{ questionId: 'q1', answer: false }, { questionId: 'q2', answer: true }] };
  study.validateResponse(valid, questions);
  for (const update of [{ rating: 2.5 }, { rating: '3' }, { rating: NaN }, { rating: 6 }, { duration: -1 }, { answers: [] }, { answers: [valid.answers[0], valid.answers[0]] }]) {
    assert.throws(() => study.validateResponse({ ...valid, ...update }, questions));
  }
  study.validateResponse({ rating: 3.27, phase: 'slider', duration: 0, answers: [] }, []);
});
test('migration preserves existing data and assigns the standard phase', () => {
  const old = db.prepare('SELECT rating, phase, scale_type FROM ratings WHERE id = 1').get();
  assert.deepEqual(old, { rating: 4, phase: 'standard', scale_type: 'categorical' });
});
test('malformed session requests are rejected without database binding errors', () => {
  for (const body of [null, {}, { sessionId: [] }, { sessionId: 42 }, { sessionId: ' ' },
    { sessionId: 'valid', videoOrder: {}, clientInfo: {} }, { sessionId: 'valid', videoOrder: [], clientInfo: [] },
    { sessionId: 'valid', videoOrder: [], clientInfo: {}, PROLIFIC_PID: {} }]) {
    assert.equal(call('create-user.js', body).statusCode, 400);
  }
  for (const sessionId of [undefined, null, [], {}, 42, ' ']) {
    assert.equal(call('update-end-time.js', sessionId === undefined ? null : { sessionId }).statusCode, 400);
    assert.equal(call('screentest.js', { sessionId, payload: {} }).statusCode, 400);
  }
});
test('two-stage session saves decimals and answers atomically, supports retry, and ends only after both parts', () => {
  const playlist = study.readStudy().videos;
  const session = { sessionId: 'test-session', videoOrder: playlist, clientInfo: {}, autoFullscreen: 0 };
  let response = call('create-user.js', session);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body.videoOrder, playlist);
  assert.equal(Object.hasOwn(response.body.questions['a_vmaf_80.mp4'][0], 'correctAnswer'), false);
  response = call('create-user.js', { ...session, videoOrder: [...playlist].reverse() });
  assert.deepEqual(response.body.videoOrder, playlist);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  const rating = { sessionId: session.sessionId, videoName: 'a_vmaf_80.mp4', rating: 4, duration: 1, phase: 'standard', answers: [{ questionId: 'q1', answer: true }, { questionId: 'q2', answer: true }] };
  assert.equal(call('rate-video.js', { ...rating, answers: [] }).statusCode, 400);
  assert.equal(call('rate-video.js', { ...rating, phase: 'slider', rating: 3.27, answers: [] }).statusCode, 409);
  assert.equal(call('rate-video.js', rating).statusCode, 200);
  assert.equal(call('rate-video.js', rating).statusCode, 200);
  assert.deepEqual(db.prepare('SELECT is_correct FROM control_answers ORDER BY id').all().map(a => a.is_correct), [1, 0]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ratings WHERE user_id IS NOT NULL').get().n, 1);
  assert.equal(call('update-end-time.js', { sessionId: session.sessionId }).statusCode, 409);
  assert.equal(call('rate-video.js', { ...rating, videoName: 'b clip.mp4', answers: [] }).statusCode, 200);
  for (const videoName of ['a_vmaf_80.mp4', 'b clip.mp4']) {
    assert.equal(call('rate-video.js', { ...rating, videoName, phase: 'slider', rating: 3.27, answers: [] }).statusCode, 200);
  }
  assert.equal(db.prepare("SELECT rating FROM ratings WHERE phase = 'slider' LIMIT 1").get().rating, 3.27);
  assert.equal(call('update-end-time.js', { sessionId: session.sessionId }).statusCode, 200);
  assert.ok(db.prepare('SELECT end_time FROM users').get().end_time);
  db.prepare("UPDATE users SET end_time = '2020-01-01 00:00:00' WHERE session_id = ?").run(session.sessionId);
  assert.equal(call('update-end-time.js', { sessionId: session.sessionId }).statusCode, 200);
  assert.equal(db.prepare('SELECT end_time FROM users WHERE session_id = ?').get(session.sessionId).end_time, '2020-01-01 00:00:00');
});

test('saved configurations select stimuli, validate missing files and protect sessions from later edits', () => {
  const filenames = ['a_vmaf_80.mp4', 'b clip.mp4'];
  const initial = { ...configuration.defaults(), selectedVideos: filenames };
  const csv = fs.readFileSync('config/control-questions.csv', 'utf8');
  configuration.writeConfiguration(configuration.validateConfig(initial, filenames), csv);
  const manifest = study.readStudy();
  assert.equal(manifest.videos[0], '/api/stimuli/a_vmaf_80.mp4');
  const session = { sessionId: 'snapshot-session', videoOrder: manifest.videos, configVersion: manifest.settings.version, clientInfo: {}, autoFullscreen: 0 };
  assert.equal(call('create-user.js', session).statusCode, 201);
  configuration.writeConfiguration({ ...initial, mode: 'standard', selectedVideos: ['b clip.mp4'] }, 'video_name,question,correct_answer\n');
  assert.equal(call('create-user.js', { ...session, sessionId: 'stale-session' }).statusCode, 400);
  const changed = study.readStudy();
  assert.equal(call('create-user.js', { ...session, sessionId: 'stale-version', videoOrder: changed.videos }).statusCode, 409);
  const retry = call('create-user.js', { ...session, videoOrder: changed.videos });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.settings.mode, 'both');
  assert.deepEqual(retry.body.videoOrder, manifest.videos);
  assert.equal(retry.body.questions['a_vmaf_80.mp4'].length, 2);
  assert.equal(call('update-end-time.js', { sessionId: session.sessionId }).statusCode, 409);
  assert.throws(() => configuration.validateConfig({ ...initial, selectedVideos: ['missing.mp4'] }, filenames));
  assert.throws(() => configuration.validateConfig({ ...initial, sliderStep: 0.03 }, filenames));
  configuration.writeConfiguration({ ...initial, selectedVideos: ['missing.mp4'] }, csv);
  assert.ok(configuration.readConfiguration().settings);
  assert.throws(() => study.readStudy(), /nie jest już dostępny/);
  fs.unlinkSync('config/study.json');
});

test('single-part studies use their snapshotted phase, control questions and slider step', () => {
  const csv = fs.readFileSync('config/control-questions.csv', 'utf8');
  const selectedVideos = ['a_vmaf_80.mp4'];
  try {
    for (const mode of ['standard', 'slider']) {
      configuration.writeConfiguration({ ...configuration.defaults(), mode, selectedVideos, sliderStep: 0.25, screenTest: false, randomize: false }, csv);
      const manifest = study.readStudy();
      const sessionId = `single-${mode}`;
      const created = call('create-user.js', { sessionId, videoOrder: manifest.videos, configVersion: manifest.settings.version, clientInfo: {}, autoFullscreen: 0 });
      assert.equal(created.statusCode, 201);
      assert.equal(created.body.settings.mode, mode);
      const rating = { sessionId, videoName: selectedVideos[0], phase: mode, rating: mode === 'slider' ? 3.25 : 4, duration: 1,
        answers: [{ questionId: 'q1', answer: true }, { questionId: 'q2', answer: false }] };
      assert.equal(call('update-end-time.js', { sessionId }).statusCode, 409);
      assert.equal(call('rate-video.js', { ...rating, answers: [] }).statusCode, 400);
      assert.equal(call('rate-video.js', { ...rating, phase: mode === 'standard' ? 'slider' : 'standard' }).statusCode, 400);
      if (mode === 'slider') assert.equal(call('rate-video.js', { ...rating, rating: 3.27 }).statusCode, 400);
      assert.equal(call('rate-video.js', rating).statusCode, 200);
      assert.equal(call('update-end-time.js', { sessionId }).statusCode, 200);
    }
  } finally { fs.unlinkSync('config/study.json'); }
});

test('slider-first studies enforce that order, ask control questions only once and finish after both parts', () => {
  const csv = fs.readFileSync('config/control-questions.csv', 'utf8');
  const selectedVideos = ['a_vmaf_80.mp4', 'b clip.mp4'];
  configuration.writeConfiguration({ ...configuration.defaults(), selectedVideos, phaseOrder: 'slider-first', sliderStep: 0.25 }, csv);
  try {
    const manifest = study.readStudy(), sessionId = 'slider-first-session';
    const created = call('create-user.js', { sessionId, videoOrder: manifest.videos, clientInfo: {}, autoFullscreen: 0 });
    assert.deepEqual(created.body.settings.phaseSequence, ['slider', 'standard']);
    const rating = { sessionId, videoName: selectedVideos[1], rating: 4, phase: 'standard', duration: 1, answers: [] };
    assert.equal(call('rate-video.js', rating).statusCode, 409);
    const answers = [{ questionId: 'q1', answer: true }, { questionId: 'q2', answer: false }];
    assert.equal(call('rate-video.js', { ...rating, videoName: selectedVideos[0], phase: 'slider', rating: 3.25 }).statusCode, 400);
    assert.equal(call('rate-video.js', { ...rating, videoName: selectedVideos[0], phase: 'slider', rating: 3.25, answers }).statusCode, 200);
    assert.equal(call('rate-video.js', rating).statusCode, 409);
    assert.equal(call('rate-video.js', { ...rating, phase: 'slider', rating: 3.25 }).statusCode, 200);
    assert.equal(call('update-end-time.js', { sessionId }).statusCode, 409);
    assert.equal(call('rate-video.js', { ...rating, videoName: selectedVideos[0], answers }).statusCode, 400);
    assert.equal(call('rate-video.js', { ...rating, rating: 3.25 }).statusCode, 400);
    for (const videoName of selectedVideos) assert.equal(call('rate-video.js', { ...rating, videoName }).statusCode, 200);
    assert.equal(call('update-end-time.js', { sessionId }).statusCode, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM control_answers a JOIN ratings r ON r.id = a.rating_id JOIN users u ON u.id = r.user_id WHERE u.session_id = ?').get(sessionId).n, 2);
  } finally { fs.unlinkSync('config/study.json'); }
});

test('balanced starts alternate 50/50 per version; retries, failed starts and later edits preserve allocation', () => {
  const settings = { ...configuration.defaults(), selectedVideos: ['b clip.mp4'], phaseOrder: 'balanced' };
  const csv = 'video_name,question,correct_answer\n';
  configuration.writeConfiguration(settings, csv);
  try {
    const manifest = study.readStudy();
    const create = id => ({ sessionId: id, videoOrder: manifest.videos, configVersion: manifest.settings.version, clientInfo: {}, autoFullscreen: 0 });
    const sequences = [];
    for (let i = 0; i < 6; i++) {
      assert.equal(call('create-user.js', { ...create('invalid-balanced'), configVersion: 'wrong-version' }).statusCode, 409);
      const response = call('create-user.js', create(`balanced-${i}`));
      assert.equal(response.statusCode, 201);
      const assigned = response.body.settings.phaseSequence;
      assert.equal(assigned[0], i % 2 ? 'slider' : 'standard');
      assert.deepEqual(call('create-user.js', create(`balanced-${i}`)).body.settings.phaseSequence, assigned);
      sequences.push(assigned[0]);
    }
    assert.equal(sequences.filter(phase => phase === 'slider').length, 3);
    configuration.writeConfiguration({ ...settings, title: 'A new version' }, csv);
    const changed = study.readStudy();
    assert.deepEqual(call('create-user.js', { ...create('new-version'), configVersion: changed.settings.version }).body.settings.phaseSequence, ['standard', 'slider']);
    assert.deepEqual(call('create-user.js', create('balanced-1')).body.settings.phaseSequence, ['slider', 'standard']);
    configuration.writeConfiguration(settings, csv);
    assert.deepEqual(call('create-user.js', create('balanced-6')).body.settings.phaseSequence, ['standard', 'slider']);
    assert.deepEqual(call('create-user.js', create('balanced-7')).body.settings.phaseSequence, ['slider', 'standard']);
  } finally { fs.unlinkSync('config/study.json'); }
});

test('older configurations and snapshots keep their order and gain both localized transition instructions', () => {
  const older = configuration.defaults();
  delete older.phaseOrder; older.selectedVideos = ['b clip.mp4'];
  for (const locale of ['pl', 'en']) {
    delete older.texts[locale].standard_part_two; delete older.texts[locale].standard_instruction;
  }
  const normalized = configuration.validateConfig(older, older.selectedVideos);
  assert.equal(normalized.phaseOrder, 'standard-first');
  assert.ok(normalized.texts.pl.standard_instruction);
  assert.ok(normalized.texts.en.standard_instruction);
  assert.deepEqual(configuration.phases(configuration.sessionSettings({ settings_snapshot: JSON.stringify(older) })), ['standard', 'slider']);
  assert.deepEqual(configuration.phases(configuration.sessionSettings({})), ['standard', 'slider']);
  assert.deepEqual(configuration.phases({ mode: 'slider', phaseOrder: 'balanced' }), ['slider']);
  assert.throws(() => configuration.validateConfig({ ...normalized, phaseOrder: 'invalid' }, older.selectedVideos));
  const { phaseIntroKeys } = require('../utils/study-phases.cjs');
  assert.deepEqual(phaseIntroKeys('standard'), { title: 'standard_part_two', instruction: 'standard_instruction' });
  assert.deepEqual(phaseIntroKeys('slider'), { title: 'part_two', instruction: 'slider_instruction' });
});

test('per-question parts follow the assigned order, validate each part and survive configuration changes', () => {
  const csv = 'video_name,question,correct_answer,part\na_vmaf_80.mp4,Pierwsza?,tak,first\na_vmaf_80.mp4,Druga?,nie,second\na_vmaf_80.mp4,Obie?,,both\n';
  const configurations = [
    { phaseOrder: 'standard-first', sequence: ['standard', 'slider'] },
    { phaseOrder: 'slider-first', sequence: ['slider', 'standard'] },
    { phaseOrder: 'balanced', sequence: ['standard', 'slider'] },
    { phaseOrder: 'balanced', sequence: ['slider', 'standard'] },
  ];
  try {
    for (const [i, { phaseOrder, sequence }] of configurations.entries()) {
      const settings = { ...configuration.defaults(), selectedVideos: ['a_vmaf_80.mp4'], phaseOrder };
      configuration.writeConfiguration(settings, csv);
      const manifest = study.readStudy(), sessionId = `question-parts-${i}`;
      const request = { sessionId, videoOrder: manifest.videos, configVersion: manifest.settings.version, clientInfo: {}, autoFullscreen: 0 };
      const created = call('create-user.js', request);
      assert.equal(created.statusCode, 201);
      assert.deepEqual(created.body.settings.phaseSequence, sequence);
      assert.deepEqual(created.body.questions['a_vmaf_80.mp4'].map(q => q.part), ['first', 'second', 'both']);
      assert.ok(created.body.questions['a_vmaf_80.mp4'].every(q => !Object.hasOwn(q, 'correctAnswer')));
      const allQuestions = created.body.questions['a_vmaf_80.mp4'];
      assert.deepEqual(questionsForPhase(allQuestions, created.body.settings, sequence[0]).map(q => q.id), ['q1', 'q3']);
      assert.deepEqual(questionsForPhase(allQuestions, created.body.settings, sequence[1]).map(q => q.id), ['q2', 'q3']);
      // Later edits cannot change which questions this participant must answer.
      configuration.writeConfiguration({ ...settings, mode: 'slider' }, 'video_name,question,part\na_vmaf_80.mp4,Nowe?,both\n');
      assert.deepEqual(call('create-user.js', request).body.questions, created.body.questions);
      const rating = { sessionId, videoName: 'a_vmaf_80.mp4', rating: 4, duration: 1 };
      const firstAnswers = [{ questionId: 'q1', answer: true }, { questionId: 'q3', answer: true }];
      const secondAnswers = [{ questionId: 'q2', answer: false }, { questionId: 'q3', answer: false }];
      assert.equal(call('rate-video.js', { ...rating, phase: sequence[1], answers: secondAnswers }).statusCode, 409);
      for (const answers of [[], firstAnswers.slice(0, 1), secondAnswers]) {
        assert.equal(call('rate-video.js', { ...rating, phase: sequence[0], answers }).statusCode, 400);
      }
      assert.equal(call('rate-video.js', { ...rating, phase: sequence[0], answers: firstAnswers }).statusCode, 200);
      assert.equal(call('update-end-time.js', { sessionId }).statusCode, 409);
      assert.equal(call('rate-video.js', { ...rating, phase: sequence[1], answers: firstAnswers }).statusCode, 400);
      const secondResponse = { ...rating, phase: sequence[1], answers: secondAnswers };
      assert.equal(call('rate-video.js', secondResponse).statusCode, 200);
      assert.equal(call('rate-video.js', secondResponse).statusCode, 200);
      const saved = db.prepare(`SELECT r.phase, a.question_id, a.answer, a.is_correct FROM control_answers a
        JOIN ratings r ON r.id = a.rating_id JOIN users u ON u.id = r.user_id WHERE u.session_id = ? ORDER BY a.id`).all(sessionId);
      assert.deepEqual(saved, [
        { phase: sequence[0], question_id: 'q1', answer: 1, is_correct: 1 },
        { phase: sequence[0], question_id: 'q3', answer: 1, is_correct: null },
        { phase: sequence[1], question_id: 'q2', answer: 0, is_correct: 1 },
        { phase: sequence[1], question_id: 'q3', answer: 0, is_correct: null },
      ]);
      assert.equal(call('update-end-time.js', { sessionId }).statusCode, 200);
    }
  } finally { fs.unlinkSync('config/study.json'); }
});

test('single-part studies require all questions regardless of retained two-part assignments', () => {
  const csv = 'video_name,question,part\na_vmaf_80.mp4,Pierwsza?,first\na_vmaf_80.mp4,Druga?,second\na_vmaf_80.mp4,Obie?,both\n';
  try {
    for (const mode of ['standard', 'slider']) {
      configuration.writeConfiguration({ ...configuration.defaults(), selectedVideos: ['a_vmaf_80.mp4'], mode }, csv);
      const manifest = study.readStudy(), sessionId = `single-question-parts-${mode}`;
      const created = call('create-user.js', { sessionId, videoOrder: manifest.videos, clientInfo: {}, autoFullscreen: 0 });
      assert.equal(created.statusCode, 201);
      const questions = created.body.questions['a_vmaf_80.mp4'];
      assert.equal(questionsForPhase(questions, created.body.settings, mode).length, 3);
      const rating = { sessionId, videoName: 'a_vmaf_80.mp4', phase: mode, rating: 4, duration: 1 };
      const answers = questions.map(q => ({ questionId: q.id, answer: true }));
      assert.equal(call('rate-video.js', { ...rating, answers: answers.filter(a => a.questionId !== 'q2') }).statusCode, 400);
      assert.equal(call('rate-video.js', { ...rating, answers }).statusCode, 200);
      assert.equal(call('update-end-time.js', { sessionId }).statusCode, 200);
      assert.deepEqual(configuration.readConfiguration().questionsCsv, csv);
    }
  } finally { fs.unlinkSync('config/study.json'); }
});

test('legacy question snapshots stay in the first part without requiring a part field', () => {
  const questions = { 'a.mp4': [{ id: 'q1', question: 'Starsze pytanie?', correctAnswer: true }] };
  const settings = { mode: 'both', phaseSequence: ['slider', 'standard'] };
  const publicList = study.publicQuestions(questions)['a.mp4'];
  assert.deepEqual(publicList, [{ id: 'q1', question: 'Starsze pytanie?', part: 'first' }]);
  assert.equal(questionsForPhase(questions['a.mp4'], settings, 'slider').length, 1);
  assert.equal(questionsForPhase(questions['a.mp4'], settings, 'standard').length, 0);
  assert.equal(questionsForPhase(publicList, settings, 'standard').length, 0);
});

test('fullscreen is configured by the administrator and snapshotted independently of participant requests', () => {
  const initial = { ...configuration.defaults(), selectedVideos: ['b clip.mp4'] };
  const csv = 'video_name,question\n';
  try {
    for (const enabled of [true, false]) {
      const settings = configuration.validateConfig({ ...initial, autoFullscreen: enabled }, initial.selectedVideos);
      configuration.writeConfiguration(settings, csv);
      const manifest = study.readStudy(), sessionId = `admin-fullscreen-${enabled}`;
      assert.equal(manifest.settings.autoFullscreen, enabled);
      const request = { sessionId, videoOrder: manifest.videos, clientInfo: {}, configVersion: manifest.settings.version,
        autoFullscreen: enabled ? 0 : 1 };
      const created = call('create-user.js', request);
      assert.equal(created.statusCode, 201);
      assert.equal(created.body.settings.autoFullscreen, enabled);
      const stored = db.prepare('SELECT auto_fullscreen, settings_snapshot FROM users WHERE session_id = ?').get(sessionId);
      assert.equal(stored.auto_fullscreen, Number(enabled));
      assert.equal(JSON.parse(stored.settings_snapshot).autoFullscreen, enabled);
      configuration.writeConfiguration({ ...settings, autoFullscreen: !enabled }, csv);
      assert.equal(call('create-user.js', request).body.settings.autoFullscreen, enabled);
    }
    const manifest = study.readStudy();
    assert.equal(call('create-user.js', { sessionId: 'no-client-fullscreen', videoOrder: manifest.videos, clientInfo: {} }).statusCode, 201);
    assert.throws(() => configuration.validateConfig({ ...initial, autoFullscreen: 'true' }, initial.selectedVideos), /pełnoekranowego/);
    const older = { ...initial }; delete older.autoFullscreen;
    assert.equal(configuration.validateConfig(older, initial.selectedVideos).autoFullscreen, false);
  } finally { fs.unlinkSync('config/study.json'); }
});

test('legacy fullscreen choices survive session retries with or without a settings snapshot', () => {
  const settings = configuration.defaults(); delete settings.autoFullscreen;
  const insert = db.prepare(`INSERT INTO users (session_id, playlist, client_info, auto_fullscreen, settings_snapshot)
    VALUES (?, '[]', '{}', ?, ?)`);
  for (const snapshot of [null, JSON.stringify(settings)]) {
    for (const enabled of [0, 1]) {
      const sessionId = `legacy-fullscreen-${snapshot === null ? 'none' : 'settings'}-${enabled}`;
      insert.run(sessionId, enabled, snapshot);
      const retry = call('create-user.js', { sessionId, videoOrder: [], clientInfo: {}, autoFullscreen: !enabled });
      assert.equal(retry.statusCode, 200);
      assert.equal(retry.body.settings.autoFullscreen, Boolean(enabled));
    }
  }
});

test('image studies filter the catalog, snapshot exposure and questions, and save both scales without changing video sessions', () => {
  fs.mkdirSync('public/images', { recursive: true });
  fs.writeFileSync('public/images/photo.png', 'image fixture');
  fs.writeFileSync('public/images/another.jpg', 'image fixture');
  fs.writeFileSync('public/images/ignored.svg', '<svg/>');
  const csv = 'stimulus_name,question,correct_answer,part\nphoto.png,Czy widać postać?,tak,both\na_vmaf_80.mp4,Starsze pytanie?,nie,first\n';
  const settings = { ...configuration.defaults(), stimulusType: 'image', selectedVideos: ['photo.png'], imageDuration: 2.5, phaseOrder: 'slider-first' };
  try {
    const validated = configuration.validateConfig(settings, configuration.catalog().map(file => file.name));
    configuration.writeConfiguration(validated, csv);
    assert.deepEqual(configuration.catalog('image').map(file => file.name), ['another.jpg', 'photo.png']);
    assert.ok(configuration.catalog('video').every(file => file.name.endsWith('.mp4')));
    const manifest = study.readStudy();
    assert.deepEqual(manifest.videos, ['/api/stimuli/photo.png']);
    assert.deepEqual(Object.keys(manifest.questions), ['photo.png']);
    assert.equal(manifest.settings.texts.pl.rate_quality, 'Oceń jakość zdjęcia:');
    assert.equal(manifest.settings.texts.en.rate_quality, 'Rate image quality:');
    const request = { sessionId: 'image-study', videoOrder: manifest.videos, configVersion: manifest.settings.version, clientInfo: {} };
    const created = call('create-user.js', request);
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.settings.imageDuration, 2.5);
    assert.equal(created.body.settings.stimulusType, 'image');
    assert.deepEqual(created.body.settings.phaseSequence, ['slider', 'standard']);
    configuration.writeConfiguration({ ...configuration.defaults(), selectedVideos: ['a_vmaf_80.mp4'] }, csv);
    const retry = call('create-user.js', request);
    assert.deepEqual(retry.body.settings, created.body.settings);
    const rating = { sessionId: request.sessionId, videoName: 'photo.png', phase: 'slider', rating: 3.27, duration: 1 };
    assert.equal(call('rate-video.js', { ...rating, answers: [] }).statusCode, 400);
    const answers = [{ questionId: 'q1', answer: true }];
    assert.equal(call('rate-video.js', { ...rating, answers }).statusCode, 200);
    assert.equal(call('update-end-time.js', { sessionId: request.sessionId }).statusCode, 409);
    const second = { ...rating, phase: 'standard', rating: 4, answers: [{ questionId: 'q1', answer: false }] };
    assert.equal(call('rate-video.js', second).statusCode, 200);
    assert.equal(call('rate-video.js', second).statusCode, 200);
    assert.equal(call('update-end-time.js', { sessionId: request.sessionId }).statusCode, 200);
    assert.deepEqual(db.prepare(`SELECT r.stimulus_type, r.phase, r.rating, a.answer FROM ratings r JOIN users u ON u.id = r.user_id
      JOIN control_answers a ON a.rating_id = r.id WHERE u.session_id = ? ORDER BY r.id`).all(request.sessionId), [
      { stimulus_type: 'image', phase: 'slider', rating: 3.27, answer: 1 }, { stimulus_type: 'image', phase: 'standard', rating: 4, answer: 0 },
    ]);
    assert.equal(db.prepare('SELECT stimulus_type FROM ratings WHERE id = 1').get().stimulus_type, 'video');
    assert.equal(configuration.sessionSettings({ settings_snapshot: '{"mode":"both"}' }).stimulusType, 'video');
    for (const update of [{ stimulusType: 'mixed' }, { imageDuration: 0 }, { imageDuration: 301 }, { imageDuration: '5' },
      { imageDuration: 0.55 }, { selectedVideos: ['a_vmaf_80.mp4'] }, { selectedVideos: ['photo.png', 'a_vmaf_80.mp4'] }]) {
      assert.throws(() => configuration.validateConfig({ ...settings, ...update }, configuration.catalog().map(file => file.name)));
    }
    const { adaptStudyTexts } = require('../utils/study-texts.cjs');
    assert.equal(adaptStudyTexts({ pl: { instruction: 'Moja instrukcja.' } }, 'image').pl.instruction, 'Moja instrukcja.');
    assert.deepEqual(adaptStudyTexts(validated.texts, 'video'), configuration.defaults().texts);
    const videoCreated = call('create-user.js', { sessionId: 'video-after-image', videoOrder: study.readStudy().videos, clientInfo: {} });
    assert.equal(videoCreated.statusCode, 201);
    assert.equal(videoCreated.body.settings.stimulusType, 'video');
  } finally { fs.unlinkSync('config/study.json'); }
});
