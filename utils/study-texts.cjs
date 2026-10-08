const dictionaries = { pl: require('../public/locales/pl/common.json'), en: require('../public/locales/en/common.json') };
function adaptStudyTexts(texts, stimulusType) {
  return Object.fromEntries(Object.entries(texts).map(([locale, values]) => [locale,
    Object.fromEntries(Object.entries(values).map(([key, value]) => {
      const dictionary = dictionaries[locale];
      const imageDefault = dictionary?.[`image_${key}`];
      // Preserve custom wording; only switch the built-in video/image texts.
      if (imageDefault && (value === dictionary[key] || value === imageDefault)) {
        value = stimulusType === 'image' ? imageDefault : dictionary[key];
      }
      return [key, value];
    }))]));
}
module.exports = { adaptStudyTexts };
