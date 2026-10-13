const { test } = require('node:test');
const assert = require('node:assert/strict');
const { adminMessage, translateAdmin } = require('../utils/admin-i18n.cjs');
const { questionRows } = require('../utils/questions.cjs');
const english = require('../public/locales/en/admin.json');

test('stored notifications can change language without losing their values', () => {
  const message = adminMessage('Dodane pliki: {count} z {total}. Zapisz ustawienia, aby użyć ich w badaniu.', { count: 2, total: 3 });
  assert.equal(translateAdmin('en', message), 'Files added: 2 of 3. Save the settings to use them in the study.');
  assert.equal(translateAdmin('pl', message), 'Dodane pliki: 2 z 3. Zapisz ustawienia, aby użyć ich w badaniu.');
  const error = adminMessage('Nie udało się pobrać wyników ({status}).', { status: adminMessage('błąd połączenia') });
  assert.equal(translateAdmin('en', error), 'Could not download results (connection error).');
  assert.equal(translateAdmin('pl', error), 'Nie udało się pobrać wyników (błąd połączenia).');
});

test('CSV validation errors are translated while preserving filenames and row numbers', () => {
  const name = 'zdjęcie (1) [test] $& {name}.png';
  let error;
  try { questionRows(`stimulus_name,question\n${name},Q?\n`, []); }
  catch (caught) { error = caught.message; }
  assert.equal(translateAdmin('en', error), `CSV: unknown stimulus ${name}.`);
  assert.equal(translateAdmin('pl', error), error);
  try { questionRows('stimulus_name,question\na.png\n', ['a.png']); }
  catch (caught) { error = caught.message; }
  assert.equal(translateAdmin('en', error), 'CSV: incorrect number of columns in row 2.');
});

test('batch upload errors are translated individually and retain file details', () => {
  const errors = [
    'Plik zdjęcie.png już istnieje. Zmień nazwę pliku przed dodaniem.',
    'Nie udało się dodać pliku film.mp4',
  ];
  assert.equal(translateAdmin('en', errors), 'File zdjęcie.png already exists. Rename it before adding it.\nCould not add file film.mp4');
  assert.equal(translateAdmin('pl', errors), errors.join('\n'));
  assert.equal(translateAdmin('en', 'Nieprawidłowe hasło.'), 'Incorrect password.');
  assert.equal(translateAdmin('en', 'Network Error'), 'Network Error');
});

test('translations retain every dynamic value in the source message', () => {
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [polish, translation] of Object.entries(english)) {
    assert.ok(translation.trim(), `Empty translation: ${polish}`);
    assert.deepEqual(placeholders(translation), placeholders(polish), polish);
  }
});
