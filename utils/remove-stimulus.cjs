const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { stimulusInfo } = require('./stimuli.cjs');
const { catalog, readConfiguration, writeConfiguration } = require('./study-config.cjs');
const { removeStimulusQuestions } = require('./questions.cjs');
const { readStudy } = require('./study.cjs');

function removeStimulus(name) {
  const info = stimulusInfo(name);
  if (!info || name !== path.basename(name)) throw Object.assign(new Error('Nieprawidłowa nazwa bodźca.'), { status: 400 });
  const publicDirectory = path.join(process.cwd(), 'public');
  const directory = path.join(publicDirectory, info.directory);
  const filename = path.join(directory, name);
  try {
    if (!fs.lstatSync(publicDirectory).isDirectory() || !fs.lstatSync(directory).isDirectory() || !fs.lstatSync(filename).isFile()) {
      throw Object.assign(new Error('Bodziec nie jest dostępny.'), { status: 404 });
    }
  } catch (error) {
    if (error.code === 'ENOENT') throw Object.assign(new Error('Bodziec nie jest dostępny.'), { status: 404 });
    throw error;
  }

  const configuration = readConfiguration();
  const selected = configuration.settings.selectedVideos ?? catalog(configuration.settings.stimulusType).map(file => file.name);
  const settings = { ...configuration.settings, selectedVideos: selected.filter(item => item !== name) };
  const questionsCsv = removeStimulusQuestions(configuration.questionsCsv, name);
  const configPath = path.join(process.cwd(), 'config', 'study.json');
  const previousConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath) : null;
  const staged = path.join(directory, `.${crypto.randomUUID()}.deleted`);
  let configWritten = false;

  // Keep file and configuration changes synchronous so another request cannot
  // observe a partial deletion. Restore both if saving or removing the file fails.
  fs.renameSync(filename, staged);
  try {
    writeConfiguration(settings, questionsCsv);
    configWritten = true;
    fs.unlinkSync(staged);
  } catch (error) {
    fs.renameSync(staged, filename);
    if (configWritten) {
      if (previousConfig) fs.writeFileSync(configPath, previousConfig);
      else fs.unlinkSync(configPath);
    }
    throw error;
  }

  let version = null;
  try { version = readStudy().settings.version; } catch { /* An empty study remains editable in the panel. */ }
  return { settings, questionsCsv, catalog: catalog(), version };
}

module.exports = { removeStimulus };
