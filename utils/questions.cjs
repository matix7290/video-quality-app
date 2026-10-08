const { phases } = require('./study-phases.cjs');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === ',' || c === '\n') {
      row.push(field.trim()); field = ''; closed = false;
      if (c === '\n') { if (row.some(Boolean)) rows.push(row); row = []; }
    } else if (c === '"' && !field.trim() && !closed) {
      field = ''; quoted = true;
    } else {
      if (closed && c.trim()) throw new Error('Nieprawidłowy tekst po cudzysłowie w CSV.');
      if (c === '"') throw new Error('Nieprawidłowy cudzysłów w CSV.');
      field += c;
    }
  }
  if (quoted) throw new Error('Niezamknięty cudzysłów w CSV.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseQuestions(text, filenames) {
  const [header, ...rows] = parseCsv(text);
  if (!header || !header.includes('question') || !['video_name', 'stimulus_name'].some(key => header.includes(key))) {
    throw new Error('CSV musi zawierać kolumny stimulus_name (lub video_name) i question; opcjonalnie correct_answer i part.');
  }
  if (new Set(header).size !== header.length) throw new Error('Powtórzone kolumny w CSV.');
  if (header.includes('video_name') && header.includes('stimulus_name')) throw new Error('CSV: użyj tylko jednej kolumny nazwy stymulusu: stimulus_name lub video_name.');
  const nameColumn = header.includes('stimulus_name') ? 'stimulus_name' : 'video_name';
  const questions = {};
  rows.forEach((row, i) => {
    if (row.length !== header.length) throw new Error(`CSV: nieprawidłowa liczba kolumn w rekordzie ${i + 2}.`);
    const name = row[header.indexOf(nameColumn)];
    const question = row[header.indexOf('question')];
    if (!filenames.includes(name)) throw new Error(`CSV: nieznany stymulus ${name}.`);
    if (!question) throw new Error(`CSV: puste pytanie w rekordzie ${i + 2}.`);
    const raw = header.includes('correct_answer') ? row[header.indexOf('correct_answer')].toLowerCase() : '';
    const answers = { yes: true, tak: true, no: false, nie: false };
    if (raw && !Object.hasOwn(answers, raw)) throw new Error(`CSV: correct_answer musi być tak/nie lub yes/no (rekord ${i + 2}).`);
    // Older CSV files and session snapshots asked questions in the first part only.
    const part = (header.includes('part') ? row[header.indexOf('part')] : '') || 'first';
    if (!['first', 'second', 'both'].includes(part)) throw new Error(`CSV: part musi być first, second lub both (rekord ${i + 2}).`);
    (questions[name] ||= []).push({ id: `q${i + 1}`, question, correctAnswer: raw ? answers[raw] : null, part });
  });
  return questions;
}

function questionsToCsv(rows, { stimulusType = 'video' } = {}) {
  const escape = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return `${stimulusType === 'image' ? 'stimulus_name' : 'video_name'},question,correct_answer,part\n` + rows.map(row => [row.video_name, row.question, row.correct_answer, row.part ?? 'first'].map(escape).join(',')).join('\n') + (rows.length ? '\n' : '');
}
function questionRows(csv, filenames) {
  return Object.entries(parseQuestions(csv, filenames)).flatMap(([video_name, questions]) => questions.map(q => ({ video_name, question: q.question, correct_answer: q.correctAnswer === null ? '' : q.correctAnswer ? 'tak' : 'nie', part: q.part })));
}
function questionsForPhase(questions, settings, phase) {
  const sequence = phases(settings);
  const position = sequence.indexOf(phase);
  if (position === -1) return [];
  // Preserve the two-part assignments when switching modes; all questions apply in a single part.
  if (sequence.length === 1) return questions;
  return questions.filter(question => {
    const part = question.part ?? 'first';
    return part === 'both' || part === (position === 0 ? 'first' : 'second');
  });
}
module.exports = { parseCsv, parseQuestions, questionsToCsv, questionRows, questionsForPhase };
