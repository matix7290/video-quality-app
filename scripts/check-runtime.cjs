const [major, minor] = process.versions.node.split('.').map(Number);

if (major < 20 || (major === 20 && minor < 19)) {
  console.error(`Ta aplikacja wymaga Node.js 20.19 lub nowszego. Uruchomiono ${process.version}.
W terminalu projektu wykonaj:
  nvm install
  nvm use
  npm ci
Następnie uruchom ponownie npm run dev.`);
  process.exit(1);
}

if (!process.argv.includes('--node-only')) {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
  } catch (error) {
    console.error(`Nie można załadować modułu SQLite dla ${process.version}.
Po przełączeniu Node.js wykonaj npm ci, aby przygotować moduły natywne.
Projekt zawiera allowScripts dla wymaganych pakietów (również dla npm 12).
Szczegóły: ${error.message}`);
    process.exit(1);
  }
}
