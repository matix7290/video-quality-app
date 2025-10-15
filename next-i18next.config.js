// next-i18next.config.js
/** @type {import('next-i18next').UserConfig} */
module.exports = {
  i18n: {
    defaultLocale: "en", // <-- domyślnie EN
    locales: ["en", "pl"],
    localeDetection: true, // <-- wykrywanie języka przeglądarki
  },
  localePath: "./public/locales",
  reloadOnPrerender: process.env.NODE_ENV === "development",

  // Opcje i18next (ważne dla fallbacków kluczy):
  fallbackLng: "en", // <-- brakujący klucz -> EN
  supportedLngs: ["en", "pl"],
  nonExplicitSupportedLngs: true, // 'pl-PL' -> 'pl', 'en-US' -> 'en'
  load: "languageOnly", // ignoruj region (PL/US)
  defaultNS: "common",
  ns: ["common"],

  // Dzięki temu puste/NULL nie blokują fallbacku:
  returnEmptyString: false,
  returnNull: false,

  interpolation: { escapeValue: false },
};
