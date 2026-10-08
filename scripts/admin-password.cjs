const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashPassword, verifyPassword, parseHash } = require('../utils/admin-password.cjs');
const names = ['ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET'];
function replaceCredentials(contents, hash, secret) {
  parseHash(hash);
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Nieprawidłowy klucz sesji.');
  // Match complete dotenv assignments, including quoted multiline passwords.
  const assignment = /^[\t ]*(?:export[\t ]+)?([\w.-]+)[\t ]*=[\t ]*(?:'[^']*'|"(?:\\.|[^"\\])*"|`[^`]*`|[^'"`\r\n]*)(?:[\t ]*#[^\r\n]*)?[\t ]*(?:\r?\n|$)/gm;
  const remaining = contents.replace(assignment, (line, name) => names.includes(name) ? '' : line);
  if (/^[\t ]*(?:export[\t ]+)?(?:ADMIN_PASSWORD|ADMIN_PASSWORD_HASH|ADMIN_SESSION_SECRET)[\t ]*=/m.test(contents.replace(assignment, ''))) throw new Error('Nie udało się bezpiecznie zastąpić konfiguracji hasła.');
  return `${remaining}${remaining && !remaining.endsWith('\n') ? '\n' : ''}ADMIN_PASSWORD_HASH=${hash}\nADMIN_SESSION_SECRET=${secret}\n`;
}
function saveCredentials(filename, contents) {
  const temporary = path.join(path.dirname(filename), `.admin-password-${crypto.randomBytes(12).toString('hex')}.tmp`);
  try {
    // The temporary file contains only the hash, never a plaintext password backup.
    fs.writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
    const descriptor = fs.openSync(temporary, 'r');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, filename);
  } finally { fs.rmSync(temporary, { force: true }); }
}
async function migrateFile(filename, password, existingHash, existingSecret) {
  const contents = fs.readFileSync(filename, 'utf8');
  if (password === undefined) {
    parseHash(existingHash);
    if (!/^[a-f0-9]{64}$/.test(existingSecret || '')) throw new Error('Brak poprawnego klucza sesji. Uruchom npm run admin:password.');
    const updated = replaceCredentials(contents, existingHash, existingSecret);
    saveCredentials(filename, updated);
    return false;
  }
  const hash = await hashPassword(password);
  if (!await verifyPassword(password, hash)) throw new Error('Weryfikacja migracji nie powiodła się.');
  saveCredentials(filename, replaceCredentials(contents, hash, crypto.randomBytes(32).toString('hex')));
  return true;
}
function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Uruchom polecenie w zwykłym terminalu; hasło nie może być przekazywane w argumentach ani potoku.');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(prompt);
    process.stdin.setRawMode(true); process.stdin.setEncoding('utf8'); process.stdin.resume();
    function finish(error) {
      process.stdin.removeListener('data', onData); process.stdin.setRawMode(false); process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    }
    function onData(data) {
      for (const char of data) {
        if (char === '\u0003' || char === '\u0004') return finish(new Error('Anulowano.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') value = Array.from(value).slice(0, -1).join('');
        else if (char >= ' ') value += char;
      }
    }
    process.stdin.on('data', onData);
  });
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && args[0] !== '--migrate')) throw new Error('Użycie: npm run admin:password [-- --migrate]. Nie podawaj hasła jako argumentu.');
  const root = path.resolve(__dirname, '..'), filename = path.join(root, '.env.local');
  if (args[0] === '--migrate') {
    const overrides = names.some(name => process.env[name] !== undefined);
    if (overrides) throw new Error('Usuń zmienne hasła z otoczenia polecenia przed migracją .env.local.');
    const { loadEnvConfig } = require('@next/env');
    const loaded = loadEnvConfig(root, process.env.NODE_ENV !== 'production', { info() {}, error() {} }, true);
    const local = loaded.loadedEnvFiles.find(file => file.path === '.env.local');
    if (!local) throw new Error('Brak .env.local. Ustaw hasło przez npm run admin:password.');
    if (loaded.loadedEnvFiles.some(file => file.path !== '.env.local' && names.some(name => file.env[name] !== undefined))) throw new Error('Usuń konfigurację hasła z pozostałych plików .env przed migracją.');
    if (names.some(name => local.env[name] !== loaded.combinedEnv[name])) throw new Error('Konfiguracja z innego pliku przesłania .env.local. Usuń konflikt przed migracją.');
    await migrateFile(filename, local.env.ADMIN_PASSWORD, local.env.ADMIN_PASSWORD_HASH, local.env.ADMIN_SESSION_SECRET);
    console.log('Konfiguracja zabezpieczona. Dotychczasowe hasło pozostaje ważne. Zrestartuj serwer.');
  } else {
    const password = await readHidden('Nowe hasło administratora (ukryte): ');
    if (password.length < 12) throw new Error('Użyj hasła o długości co najmniej 12 znaków.');
    if (password !== await readHidden('Powtórz hasło (ukryte): ')) throw new Error('Hasła są różne. Nic nie zapisano.');
    const hash = await hashPassword(password);
    const contents = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '';
    saveCredentials(filename, replaceCredentials(contents, hash, crypto.randomBytes(32).toString('hex')));
    console.log('Hasło zapisane jako solony hash. Zrestartuj serwer; dotychczasowe sesje wygasną.');
  }
}
if (require.main === module) main().catch(() => {
  // Do not print parser/filesystem exceptions which could contain secrets.
  console.error('Nie zapisano konfiguracji. Sprawdź pliki .env, uprawnienia i użycie polecenia. Hasło podawaj w terminalu bez argumentów; musi mieć co najmniej 12 znaków.');
  process.exitCode = 1;
});
module.exports = { replaceCredentials, saveCredentials, migrateFile };
