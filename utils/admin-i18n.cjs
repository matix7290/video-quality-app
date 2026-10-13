const english = require('../public/locales/en/admin.json');

// Polish source strings identify messages, including errors returned by the API.
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.keys(english).filter(text => /\{\w+\}/.test(text)).map(text => {
  const names = [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
  const expression = text.split(/\{\w+\}/).map(escapeRegex).join('([\\s\\S]*?)');
  return { text, names, regex: new RegExp(`^${expression}$`) };
});

function adminMessage(text, values = {}) { return { text, values }; }

function translateAdmin(locale, message, values = {}) {
  if (Array.isArray(message)) return message.map(item => translateAdmin(locale, item)).join('\n');
  if (message && typeof message === 'object') return translateAdmin(locale, message.text, message.values);
  if (typeof message !== 'string') return '';
  let source = message;
  if (locale === 'en' && !Object.hasOwn(english, source)) {
    for (const pattern of patterns) {
      const match = pattern.regex.exec(source);
      if (!match) continue;
      source = pattern.text;
      values = Object.fromEntries(pattern.names.map((name, index) => [name, match[index + 1]]));
      break;
    }
    if (!Object.hasOwn(english, source) && source.includes('\n')) {
      return source.split('\n').map(line => translateAdmin(locale, line)).join('\n');
    }
  }
  const template = locale === 'en' ? (english[source] ?? source) : source;
  return template.replace(/\{(\w+)\}/g, (placeholder, name) => {
    if (!Object.hasOwn(values, name)) return placeholder;
    return values[name] && typeof values[name] === 'object' ? translateAdmin(locale, values[name]) : String(values[name]);
  });
}

module.exports = { adminMessage, translateAdmin };
