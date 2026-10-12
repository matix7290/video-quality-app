process.env.NODE_ENV = 'production';
require('./check-runtime.cjs');
require('@next/env').loadEnvConfig(process.cwd(), false);
const { spawn } = require('node:child_process');
const { passwordConfigured, authConfiguration } = require('../utils/admin-password.cjs');

try {
  if (!passwordConfigured()) throw new Error('Administrator credentials are required behind a reverse proxy.');
  authConfiguration();
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(`${error.message}\nSet credentials with npm run admin:password before starting production.`);
  process.exitCode = 1;
}
