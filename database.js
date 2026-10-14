const Database = require("better-sqlite3");

const db = new Database(process.env.DATABASE_PATH || "video_quality.db", { timeout: 1000 });
// Readers can continue during a write. FULL retains commit durability on power loss.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = FULL');

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

// Additive migration preserves previously collected records.
function addColumn(table, name, definition) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
}
addColumn('users', 'settings_snapshot', 'TEXT');
addColumn('users', 'questions_snapshot', "TEXT NOT NULL DEFAULT '{}'");
addColumn('ratings', 'phase', "TEXT NOT NULL DEFAULT 'standard'");
addColumn('ratings', 'scale_type', "TEXT NOT NULL DEFAULT 'categorical'");
addColumn('ratings', 'stimulus_type', "TEXT NOT NULL DEFAULT 'video'");
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ratings_session_phase_video
        ON ratings(user_id, phase, video_name);
    CREATE INDEX IF NOT EXISTS idx_users_balanced_version
        ON users(json_extract(settings_snapshot, '$.version'))
        WHERE json_valid(settings_snapshot)
          AND json_extract(settings_snapshot, '$.mode') = 'both'
          AND json_extract(settings_snapshot, '$.phaseOrder') = 'balanced';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_screentests_session ON screentests(session_id);
    -- Preserve historical duplicates while preventing any new duplicate observations.
    CREATE TRIGGER IF NOT EXISTS trg_ratings_no_duplicates
    BEFORE INSERT ON ratings
    WHEN NEW.user_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM ratings WHERE user_id = NEW.user_id
          AND phase = NEW.phase AND video_name = NEW.video_name
    )
    BEGIN
        SELECT RAISE(ABORT, 'Duplicate session stimulus phase');
    END;
    CREATE TABLE IF NOT EXISTS control_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rating_id INTEGER NOT NULL REFERENCES ratings(id),
        question_id TEXT NOT NULL,
        question TEXT NOT NULL,
        answer INTEGER NOT NULL CHECK (answer IN (0, 1)),
        correct_answer INTEGER,
        is_correct INTEGER,
        UNIQUE(rating_id, question_id)
    );
`);

// Administrator credentials are separate from participant study records.
db.exec(`
    CREATE TABLE IF NOT EXISTS admin_passkeys (
        id TEXT PRIMARY KEY,
        rp_id TEXT NOT NULL,
        user_handle TEXT NOT NULL,
        public_key BLOB NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        transports TEXT NOT NULL DEFAULT '[]',
        name TEXT NOT NULL,
        device_type TEXT NOT NULL,
        backed_up INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS admin_webauthn_challenges (
        token_hash TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        challenge TEXT NOT NULL,
        origin TEXT NOT NULL,
        rp_id TEXT NOT NULL,
        user_handle TEXT,
        name TEXT,
        session_binding TEXT,
        expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_totp (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        secret TEXT,
        key_id TEXT,
        last_counter INTEGER NOT NULL DEFAULT -1,
        pending_secret TEXT,
        pending_binding TEXT,
        pending_expires_at INTEGER
    );
`);
