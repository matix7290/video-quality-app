const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { phases } = require('./study-phases.cjs');
const { stimulusInfo } = require('./stimuli.cjs');
const { adaptStudyTexts } = require('./study-texts.cjs');
const dictionaries = {
  pl: require('../public/locales/pl/common.json'),
  en: require('../public/locales/en/common.json'),
};
const TEXT_KEYS = ['welcome', 'instruction', 'instruction_loadings', 'instruction_scoring', 'two_parts_instruction', 'thanks', 'end_info', 'part_two', 'slider_instruction', 'standard_part_two', 'standard_instruction', 'rate_quality'];
const LABEL_KEYS = ['bad', 'poor', 'average', 'good', 'excellent'];
const LEGACY_TWO_PARTS_INSTRUCTIONS = [
  'Badanie ma dwie części: ocenę na skali standardowej oraz ocenę tych samych filmów na suwaku. Po wybranych filmach w pierwszej części pojawią się pytania tak/nie.',
  'Badanie ma dwie części: ocenę na skali dyskretnej (przyciski 1–5) i ocenę tych samych filmów na suwaku. Po wybranych filmach w pierwszej części pojawią się pytania tak/nie.',
  'The study has two parts: rating on a discrete scale (buttons 1–5) and rating the same videos using a slider. Selected videos in the first part are followed by yes/no questions.',
  'The study has two parts: a standard rating scale followed by a slider rating of the same videos. Selected videos in the first part are followed by yes/no questions.',
];
function defaults() {
  return {
    title: 'Badanie jakości wideo', mode: 'both', phaseOrder: 'standard-first', selectedVideos: null,
    randomize: true, screenTest: true, autoFullscreen: false, sliderStep: 0.01,
    stimulusType: 'video', imageDuration: 5,
    texts: Object.fromEntries(Object.entries(dictionaries).map(([locale, dictionary]) => [locale,
      Object.fromEntries(TEXT_KEYS.map(key => [key, dictionary[key]]))])),
    labels: Object.fromEntries(Object.entries(dictionaries).map(([locale, dictionary]) => [locale, LABEL_KEYS.map(key => dictionary[key])])),
  };
}
function catalog(type) {
  return ['videos', 'images'].flatMap(folder => {
    const directory = path.join(process.cwd(), 'public', folder);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile() && stimulusInfo(entry.name)?.directory === folder)
      .map(entry => ({ name: entry.name, type: stimulusInfo(entry.name).type, size: fs.statSync(path.join(directory, entry.name)).size,
        url: `/api/stimuli/${encodeURIComponent(entry.name)}` }));
  }).filter(file => !type || file.type === type).sort((a, b) => a.name.localeCompare(b.name));
}
function validateConfig(input, filenames) {
  if (!input || typeof input !== 'object') throw new Error('Brak konfiguracji.');
  const settings = defaults();
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200) throw new Error('Podaj nazwę badania (do 200 znaków).');
  settings.title = input.title.trim();
  if (!['video', 'image'].includes(input.stimulusType ?? 'video')) throw new Error('Nieprawidłowy rodzaj stymulów.');
  settings.stimulusType = input.stimulusType ?? 'video';
  const imageDuration = input.imageDuration ?? 5;
  if (typeof imageDuration !== 'number' || !Number.isFinite(imageDuration) || imageDuration < 0.5 || imageDuration > 300 ||
      Math.abs(imageDuration * 10 - Math.round(imageDuration * 10)) > 1e-7) throw new Error('Czas wyświetlania zdjęcia musi wynosić od 0,5 do 300 sekund, z krokiem 0,1.');
  settings.imageDuration = imageDuration;
  if (!['both', 'standard', 'slider'].includes(input.mode)) throw new Error('Nieprawidłowy typ badania.');
  settings.mode = input.mode;
  if (!['standard-first', 'slider-first', 'balanced'].includes(input.phaseOrder ?? 'standard-first')) throw new Error('Nieprawidłowa kolejność skal.');
  settings.phaseOrder = input.phaseOrder ?? 'standard-first';
  if (typeof input.randomize !== 'boolean' || typeof input.screenTest !== 'boolean') throw new Error('Nieprawidłowe ustawienia przebiegu.');
  settings.randomize = input.randomize; settings.screenTest = input.screenTest;
  // Configurations saved before the setting moved to the admin panel default to off.
  if (input.autoFullscreen !== undefined && typeof input.autoFullscreen !== 'boolean') throw new Error('Nieprawidłowe ustawienie trybu pełnoekranowego.');
  settings.autoFullscreen = input.autoFullscreen ?? false;
  if (![0.01, 0.1, 0.25, 0.5, 1].includes(input.sliderStep)) throw new Error('Nieprawidłowy krok suwaka.');
  settings.sliderStep = input.sliderStep;
  if (!Array.isArray(input.selectedVideos) || !input.selectedVideos.length || new Set(input.selectedVideos).size !== input.selectedVideos.length ||
      input.selectedVideos.some(name => !filenames.includes(name) || stimulusInfo(name)?.type !== settings.stimulusType)) throw new Error('Wybierz przynajmniej jeden dostępny stymulus wybranego rodzaju; każdy plik może wystąpić raz.');
  settings.selectedVideos = [...input.selectedVideos];
  for (const locale of ['pl', 'en']) {
    for (const key of TEXT_KEYS) {
      let value = input.texts?.[locale]?.[key];
      // Older saved configurations did not have text for a discrete second part.
      if (value === undefined && ['standard_part_two', 'standard_instruction'].includes(key)) value = settings.texts[locale][key];
      if (key === 'two_parts_instruction' && LEGACY_TWO_PARTS_INSTRUCTIONS.includes(value)) value = dictionaries[locale].two_parts_instruction;
      if (typeof value !== 'string' || value.length > 10000) throw new Error(`Nieprawidłowy tekst: ${locale}/${key}.`);
      settings.texts[locale][key] = value.trim();
    }
    if (!Array.isArray(input.labels?.[locale]) || input.labels[locale].length !== 5 ||
        input.labels[locale].some(label => typeof label !== 'string' || !label.trim() || label.length > 100)) throw new Error(`Podaj pięć opisów skali (${locale}).`);
    settings.labels[locale] = input.labels[locale].map(label => label.trim());
  }
  settings.texts = adaptStudyTexts(settings.texts, settings.stimulusType);
  return settings;
}
function readConfiguration() {
  const files = catalog();
  const location = path.join(process.cwd(), 'config/study.json');
  if (fs.existsSync(location)) {
    const saved = JSON.parse(fs.readFileSync(location, 'utf8'));
    return { settings: validateConfig(saved.settings, [...files.map(file => file.name), ...(saved.settings?.selectedVideos || [])]), questionsCsv: saved.questionsCsv };
  }
  const csvPath = path.join(process.cwd(), 'config/control-questions.csv');
  return { settings: defaults(), questionsCsv: fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf8') : 'video_name,question,correct_answer\n' };
}
function versionOf(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12); }
function writeConfiguration(settings, questionsCsv) {
  const directory = path.join(process.cwd(), 'config');
  fs.mkdirSync(directory, { recursive: true });
  const temp = path.join(directory, `study-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify({ settings, questionsCsv }, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temp, path.join(directory, 'study.json'));
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function sessionSettings(user) {
  const settings = user.settings_snapshot ? JSON.parse(user.settings_snapshot) : { ...defaults(), version: 'legacy' };
  // Previously the participant's choice was stored only in the user record.
  return { ...settings, stimulusType: settings.stimulusType ?? 'video', imageDuration: settings.imageDuration ?? 5,
    autoFullscreen: user.settings_snapshot && typeof settings.autoFullscreen === 'boolean' ? settings.autoFullscreen : !!user.auto_fullscreen };
}
module.exports = { defaults, catalog, validateConfig, readConfiguration, phases, versionOf, writeConfiguration, sessionSettings, TEXT_KEYS };
