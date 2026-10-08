const fs = require('node:fs');
const { catalog, readConfiguration, versionOf } = require('./study-config.cjs');

const { parseCsv, parseQuestions } = require('./questions.cjs');

function readStudy() {
  const files = catalog();
  const filenames = files.map(file => file.name);
  const configuration = readConfiguration();
  const selected = configuration.settings.selectedVideos || files.filter(file => file.type === configuration.settings.stimulusType).map(file => file.name);
  if (selected.some(name => !filenames.includes(name))) throw new Error('Wybrany stymulus nie jest już dostępny. Popraw wybór w panelu administratora.');
  const allQuestions = parseQuestions(configuration.questionsCsv, filenames);
  const questions = Object.fromEntries(Object.entries(allQuestions).filter(([name]) => selected.includes(name)));
  const settings = { ...configuration.settings, selectedVideos: selected };
  settings.version = versionOf({ settings, questions });
  // Legacy sessions continue to accept the existing public URLs.
  const configured = fs.existsSync(require('node:path').join(process.cwd(), 'config/study.json'));
  return { videos: selected.map(name => `${configured ? '/api/stimuli' : '/videos'}/${encodeURIComponent(name)}`), questions, settings };
}

function publicQuestions(questions) {
  return Object.fromEntries(Object.entries(questions).map(([name, list]) =>
    [name, list.map(({ id, question, part }) => ({ id, question, part: part ?? 'first' }))]));
}

function validateResponse({ rating, phase, duration, answers }, questions, settings = { sliderStep: 0.01 }) {
  if (!['standard', 'slider'].includes(phase)) throw new Error('Invalid phase');
  if (typeof rating !== 'number' || !Number.isFinite(rating) || rating < 1 || rating > 5 ||
      (phase === 'standard' && !Number.isInteger(rating)) ||
      Math.abs(rating * 100 - Math.round(rating * 100)) > 1e-7 ||
      (phase === 'slider' && Math.abs((rating - 1) / settings.sliderStep - Math.round((rating - 1) / settings.sliderStep)) > 1e-7)) throw new Error('Invalid rating');
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) throw new Error('Invalid duration');
  if (!Array.isArray(answers) || answers.length !== questions.length ||
      new Set(answers.map(a => a?.questionId)).size !== questions.length ||
      questions.some(q => !answers.some(a => a?.questionId === q.id && typeof a.answer === 'boolean'))) {
    throw new Error('Answer every control question');
  }
}
module.exports = { parseCsv, parseQuestions, readStudy, publicQuestions, validateResponse };
