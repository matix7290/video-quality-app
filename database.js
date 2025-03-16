const Database = require('better-sqlite3');

const db = new Database('video_quality.db', { verbose: console.log });

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT UNIQUE NOT NULL,
        auto_fullscreen BOOLEAN NOT NULL,
        client_info TEXT NOT NULL,
        playlist TEXT NOT NULL,
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        video_name TEXT NOT NULL,
        clip_name TEXT NOT NULL,
        vmaf INTEGER,
        rating INTEGER CHECK (rating BETWEEN 1 AND 5),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        duration INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);

module.exports = db;