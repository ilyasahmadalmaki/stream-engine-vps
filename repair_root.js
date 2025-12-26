const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { spawn } = require('child_process');

// 1. CARI LOKASI FOLDER UPLOADS
let uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    console.log("⚠️  Folder 'uploads' tidak ditemukan di root.");
    // Coba cari di level public
    uploadDir = path.join(__dirname, 'public/uploads');
    if (!fs.existsSync(uploadDir)) {
        console.error("❌ FATAL: Folder uploads video TIDAK DITEMUKAN dimanapun!");
        process.exit(1);
    }
}
console.log(`✅ Folder Video Ditemukan: ${uploadDir}`);

// 2. KONEKSI DATABASE
const dbPath = path.join(__dirname, 'stream_engine.sqlite');
console.log(`🔌 Menghubungkan ke DB: ${dbPath}`);
const db = new sqlite3.Database(dbPath);

// FUNGSI BUAT THUMBNAIL MANUAL
function createThumb(videoPath, thumbName) {
    return new Promise((resolve) => {
        const thumbPath = path.join(uploadDir, thumbName);
        if (fs.existsSync(thumbPath)) return resolve(true); // Sudah ada

        const ffmpeg = spawn('ffmpeg', [
            '-y', '-ss', '00:00:03', '-i', videoPath,
            '-vframes', '1', '-q:v', '2', thumbPath
        ]);

        ffmpeg.on('close', (code) => {
            resolve(code === 0);
        });
    });
}

// 3. EKSEKUSI
db.serialize(() => {
    // Pastikan tabel ada
    db.run(`CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT, file_path TEXT, thumbnail_path TEXT, source_type TEXT, 
        file_size TEXT, duration TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    fs.readdir(uploadDir, async (err, files) => {
        if (err) return console.error(err);

        const videos = files.filter(f => ['.mp4','.mkv','.avi','.mov'].includes(path.extname(f).toLowerCase()));
        console.log(`🔍 Mendeteksi ${videos.length} file video fisik.`);

        if (videos.length === 0) {
            console.log("⚠️  Tidak ada video untuk dipulihkan.");
            return;
        }

        for (const file of videos) {
            const fullPath = path.join(uploadDir, file);
            const thumbName = file.replace(path.extname(file), '.jpg');
            const relThumbPath = 'uploads/' + thumbName;

            // Generate Thumbnail
            process.stdout.write(`🛠  Processing: ${file}... `);
            await createThumb(fullPath, thumbName);

            // Cek DB
            db.get("SELECT id FROM videos WHERE file_path = ?", [fullPath], (err, row) => {
                const size = fs.statSync(fullPath).size;
                
                if (!row) {
                    // INSERT
                    db.run(`INSERT INTO videos (title, file_path, thumbnail_path, source_type, file_size) VALUES (?, ?, ?, 'recovered', ?)`,
                        [file, fullPath, relThumbPath, size],
                        (e) => {
                            if(e) console.log("❌ DB Error");
                            else console.log("✅ Inserted");
                        }
                    );
                } else {
                    // UPDATE (Jaga-jaga kalau thumb belum masuk)
                    db.run(`UPDATE videos SET thumbnail_path = ?, file_size = ? WHERE id = ?`,
                        [relThumbPath, size, row.id],
                        (e) => {
                            if(e) console.log("❌ DB Error");
                            else console.log("✅ Updated");
                        }
                    );
                }
            });
        }
    });
});
