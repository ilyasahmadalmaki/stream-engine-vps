const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

// Tentukan lokasi database (Default: di root project)
const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../stream_engine.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
    }
});

db.serialize(() => {
    // 1. TABEL VIDEOS
    // Menyimpan data video, lokasi file, dan thumbnail
    db.run(`CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        file_path TEXT,
        thumbnail_path TEXT,
        source_type TEXT,
        file_size TEXT,
        duration TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 2. TABEL STREAMS
    // Menyimpan jadwal streaming
    // Perubahan: daily_duration_hours -> daily_duration_minutes (agar lebih presisi)
    db.run(`CREATE TABLE IF NOT EXISTS streams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        rtmp_url TEXT,
        stream_key TEXT,
        video_id INTEGER,
        schedule_type TEXT,       -- 'once' atau 'daily'
        start_time DATETIME,      -- Untuk 'once'
        end_time DATETIME,        -- Untuk 'once'
        daily_start_time TEXT,    -- Untuk 'daily' (Format HH:mm)
        daily_duration_minutes INTEGER, -- Durasi dalam menit (Total Jam * 60 + Menit)
        next_start_time DATETIME, -- Jadwal jalan berikutnya (Otomatis dihitung)
        next_end_time DATETIME,   -- Jadwal berhenti berikutnya
        status TEXT DEFAULT 'scheduled', -- 'scheduled', 'live', 'offline', 'error'
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
    )`);
});

module.exports = db;
