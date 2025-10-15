const Database = require("better-sqlite3");

const db = new Database("video_quality.db", { verbose: console.log });

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT UNIQUE NOT NULL,
        prolific_pid TEXT,
        prolific_study_id TEXT,
        prolific_session_id TEXT,
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

    CREATE TABLE IF NOT EXISTS screentests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT UNIQUE NOT NULL,
        user_id INTEGER,
        screen_resolution TEXT,
        browser_ua TEXT,
        smallest_number INTEGER,
        highest_number INTEGER,
        black_stars TEXT,
        focustime INTEGER,
        click_no INTEGER,
        click_counter INTEGER,
        reliability REAL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TRIGGER IF NOT EXISTS trg_screentests_updated_at
    AFTER UPDATE ON screentests
    FOR EACH ROW
    BEGIN
        UPDATE screentests SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;
`);

module.exports = db;
