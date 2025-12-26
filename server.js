const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('./src/db');
const { getSystemStats } = require('./src/systemStats');
const scheduler = require('./src/scheduler');
const streamManager = require('./src/streamManager');
const fs = require('fs-extra');
const { spawn, exec } = require('child_process'); 
const gdrive = require('./src/gdriveDownloader'); 
const storage = require('./src/storage');
const mediaUtils = require('./src/mediaUtils');

require('dotenv').config();

// --- INIT: PASTIKAN DIRECTORY ADA ---
storage.ensureDirectories();
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log("[INIT] Folder 'uploads' berhasil dibuat.");
}

// --- DATABASE MIGRATION (AUTO ADD COLUMN) ---
// Menambahkan kolom 'is_manual_run' jika belum ada
const initDb = () => {
    db.run("ALTER TABLE streams ADD COLUMN is_manual_run BOOLEAN DEFAULT 0", (err) => {
        // Error diabaikan karena berarti kolom sudah ada (aman)
        if (!err) console.log("[DB] Kolom 'is_manual_run' siap.");
    });
};
setTimeout(initDb, 2000);

const app = express();
const PORT = process.env.PORT || 7000;

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// --- MULTER CONFIG ---
const multerStorage = multer.diskStorage({
    destination: storage.paths.videos,
    filename: (req, file, cb) => {
        cb(null, storage.getUniqueFilename(file.originalname));
    }
});
const upload = multer({ storage: multerStorage });

// --- SYSTEM ROUTES ---

app.get('/api/system/stats', async (req, res) => {
    const stats = await getSystemStats();
    res.json(stats);
});

// --- VIDEO ROUTES ---

app.get('/api/videos', (req, res) => {
    db.all("SELECT * FROM videos ORDER BY created_at DESC", [], (err, rows) => {
        res.json(rows);
    });
});

app.post('/api/videos/upload', upload.single('video'), async (req, res) => {
    try {
        const { originalname, size, path: filePath, filename } = req.file;
        const thumbName = filename.replace(path.extname(filename), '.jpg');
        const thumbPathFull = await mediaUtils.generateThumbnail(filePath, thumbName);
        const thumbPathRel = thumbPathFull ? path.join('uploads', thumbName) : null;

        db.run(`INSERT INTO videos (title, file_path, thumbnail_path, source_type, file_size) VALUES (?, ?, ?, 'local', ?)`,
            [originalname, filePath, thumbPathRel, size],
            function(err) {
                if(err) return res.status(500).json({error: err.message});
                res.json({success: true, id: this.lastID});
            }
        );
    } catch (e) {
        res.status(500).json({error: e.message});
    }
});

// ROUTE IMPORT BARU (SUPPORT CODE AXIOS YANG BARU)
app.post('/api/videos/import', async (req, res) => {
    try {
        const { url } = req.body;
        
        // 1. Validasi URL & ID
        const fileId = gdrive.extractFileId(url);
        if (!fileId) return res.status(400).json({error: "Link Google Drive tidak valid/tidak ditemukan ID."});

        console.log(`[IMPORT] Request import ID: ${fileId}`);

        // 2. Download File (Dengan Callback Progress Log)
        // Kita log progress di console VPS agar terpantau
        const result = await gdrive.downloadFile(fileId, (progress) => {
            if (progress % 10 === 0) { // Log tiap kelipatan 10%
                console.log(`[GDRIVE PROGRESS] ${progress}%`);
            }
        });
        
        // 3. Generate Thumbnail
        const thumbName = result.filename.replace(path.extname(result.filename), '.jpg');
        const thumbPathFull = await mediaUtils.generateThumbnail(result.localFilePath, thumbName);
        const thumbPathRel = thumbPathFull ? path.join('uploads', thumbName) : null;

        // 4. Simpan ke Database
        db.run(`INSERT INTO videos (title, file_path, thumbnail_path, source_type, file_size) VALUES (?, ?, ?, 'imported', ?)`,
            [result.filename, result.localFilePath, thumbPathRel, result.fileSize],
            function(err) {
                if(err) return res.status(500).json({error: err.message});
                console.log(`[IMPORT] Database updated for ${result.filename}`);
                res.json({success: true});
            }
        );
    } catch (error) {
        console.error("[IMPORT ROUTE ERROR]", error.message);
        res.status(500).json({error: error.message}); // Kirim pesan error detail ke frontend
    }
});

app.post('/api/videos/:id/convert', (req, res) => {
    const id = req.params.id;
    db.get("SELECT * FROM videos WHERE id = ?", [id], (err, video) => {
        if (!video || !fs.existsSync(video.file_path)) return res.status(404).json({error: "File missing"});
        
        const inputPath = video.file_path;
        const tempPath = inputPath + '_temp_convert.mp4';
        
        const ffmpeg = spawn('ffmpeg', [
            '-y', '-i', inputPath, 
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
            '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-force_key_frames', 'expr:gte(t,n_forced*2)',
            '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
            '-movflags', '+faststart', tempPath
        ]);

        ffmpeg.on('close', async (code) => {
            if (code === 0) {
                try {
                    fs.unlinkSync(inputPath);
                    fs.renameSync(tempPath, inputPath);
                    const newStats = fs.statSync(inputPath);
                    const thumbName = path.basename(inputPath).replace(path.extname(inputPath), '.jpg');
                    await mediaUtils.generateThumbnail(inputPath, thumbName);
                    db.run("UPDATE videos SET file_size = ? WHERE id = ?", [newStats.size, id]);
                    res.json({success: true});
                } catch (e) { res.status(500).json({error: "File swap failed"}); }
            } else {
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                res.status(500).json({error: "Convert failed"});
            }
        });
    });
});

app.delete('/api/videos/:id', (req, res) => {
    const id = req.params.id;
    db.get("SELECT file_path, thumbnail_path FROM videos WHERE id = ?", [id], (err, row) => {
        if (!row) return res.status(404).json({error: "Not found"});
        if (fs.existsSync(row.file_path)) fs.unlinkSync(row.file_path);
        if (row.thumbnail_path && fs.existsSync(row.thumbnail_path)) fs.unlinkSync(row.thumbnail_path);
        db.run("DELETE FROM videos WHERE id = ?", [id], (err) => res.json({success: true}));
    });
});

app.put('/api/videos/:id', (req, res) => {
    db.run("UPDATE videos SET title = ? WHERE id = ?", [req.body.title, req.params.id], (err) => res.json({success: true}));
});

// --- STREAM ROUTES ---

app.get('/api/streams', (req, res) => {
    db.all("SELECT s.*, v.title as video_title FROM streams s LEFT JOIN videos v ON s.video_id = v.id ORDER BY s.created_at DESC", [], (err, rows) => {
        res.json(rows);
    });
});

app.get('/api/streams/:id', (req, res) => {
    db.get("SELECT * FROM streams WHERE id = ?", [req.params.id], (err, row) => {
        if(err || !row) return res.status(404).json({error: "Stream not found"});
        res.json(row);
    });
});

app.post('/api/streams', (req, res) => {
    const { 
        title, stream_key, video_id, schedule_type, 
        start_time, end_time, daily_start_time, 
        duration_hours, duration_minutes 
    } = req.body;

    db.get("SELECT id FROM streams WHERE title = ?", [title], (err, rowTitle) => {
        if (rowTitle) return res.status(400).json({error: "Nama Stream sudah dipakai! Gunakan nama lain."});

        db.get("SELECT id FROM streams WHERE stream_key = ?", [stream_key], (err, rowKey) => {
            if (rowKey) return res.status(400).json({error: "Stream Key ini sudah dipakai di jadwal lain!"});

            const rtmp_url = "rtmp://a.rtmp.youtube.com/live2";
            const totalMinutes = (parseInt(duration_hours || 0) * 60) + parseInt(duration_minutes || 0);

            let nextStart = null, nextEnd = null;
            
            // LOGIKA NEXT START BERDASARKAN TIPE JADWAL
            if (schedule_type === 'once') {
                nextStart = start_time;
                nextEnd = end_time;
            } else if (schedule_type === 'daily') {
                const [h, m] = daily_start_time.split(':');
                const now = new Date();
                const d = new Date();
                d.setHours(h, m, 0, 0);
                if (d < now) d.setDate(d.getDate() + 1);
                nextStart = d.toISOString();
                
                const endD = new Date(d);
                endD.setMinutes(endD.getMinutes() + totalMinutes);
                nextEnd = endD.toISOString();
            }
            // Jika Manual, nextStart & nextEnd biarkan null

            const query = `INSERT INTO streams (
                title, rtmp_url, stream_key, video_id, schedule_type, 
                start_time, end_time, daily_start_time, daily_duration_minutes,
                next_start_time, next_end_time, status, is_manual_run
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 0)`;

            db.run(query, [
                title, rtmp_url, stream_key, video_id, schedule_type,
                start_time, end_time, daily_start_time, totalMinutes,
                nextStart, nextEnd
            ], function(err) {
                if(err) return res.status(500).json({error: err.message});
                res.json({success: true});
            });
        });
    });
});

app.put('/api/streams/:id', (req, res) => {
    const id = req.params.id;
    const { 
        title, stream_key, video_id, schedule_type, 
        start_time, end_time, daily_start_time, 
        duration_hours, duration_minutes 
    } = req.body;

    db.get("SELECT status FROM streams WHERE id = ?", [id], (err, row) => {
        if(err || !row) return res.status(404).json({error: "Stream not found"});
        if(row.status === 'live') return res.status(400).json({error: "Tidak bisa edit saat stream sedang LIVE!"});

        db.get("SELECT id FROM streams WHERE title = ? AND id != ?", [title, id], (err, dupTitle) => {
            if (dupTitle) return res.status(400).json({error: "Nama Stream sudah dipakai jadwal lain!"});

            db.get("SELECT id FROM streams WHERE stream_key = ? AND id != ?", [stream_key, id], (err, dupKey) => {
                if (dupKey) return res.status(400).json({error: "Stream Key ini sudah dipakai jadwal lain!"});

                const totalMinutes = (parseInt(duration_hours || 0) * 60) + parseInt(duration_minutes || 0);
                
                let nextStart = null, nextEnd = null;
                if (schedule_type === 'once') {
                    nextStart = start_time;
                    nextEnd = end_time;
                } else if (schedule_type === 'daily') {
                    const [h, m] = daily_start_time.split(':');
                    const now = new Date();
                    const d = new Date();
                    d.setHours(h, m, 0, 0);
                    if (d < now) d.setDate(d.getDate() + 1);
                    nextStart = d.toISOString();
                    const endD = new Date(d);
                    endD.setMinutes(endD.getMinutes() + totalMinutes);
                    nextEnd = endD.toISOString();
                }

                const query = `UPDATE streams SET 
                    title=?, stream_key=?, video_id=?, schedule_type=?, 
                    start_time=?, end_time=?, daily_start_time=?, daily_duration_minutes=?,
                    next_start_time=?, next_end_time=?,
                    status = 'scheduled', is_manual_run = 0 
                    WHERE id=?`;

                db.run(query, [
                    title, stream_key, video_id, schedule_type,
                    start_time, end_time, daily_start_time, totalMinutes,
                    nextStart, nextEnd, id
                ], function(err) {
                    if(err) return res.status(500).json({error: err.message});
                    res.json({success: true});
                });
            });
        });
    });
});

// START STREAM (DENGAN LOGIKA PERMANENT MANUAL SWITCH)
app.post('/api/streams/:id/start', (req, res) => {
    const id = req.params.id;
    const { manual, permanent } = req.body; // Terima flag dari frontend

    db.get("SELECT s.*, v.file_path FROM streams s LEFT JOIN videos v ON s.video_id = v.id WHERE s.id = ?", [id], (err, stream) => {
        if(stream) {
            if (!fs.existsSync(stream.file_path)) return res.status(400).json({error: "Video file missing!"});
            
            db.get("SELECT id FROM streams WHERE stream_key = ? AND status = 'live' AND id != ?", [stream.stream_key, id], (err, conflict) => {
                if(conflict) return res.status(400).json({error: "CRITICAL: Stream Key ini sedang dipakai LIVE!"});
                
                streamManager.startStreamProcess(stream, stream.file_path);
                
                // Tentukan Query Update
                let query = "";
                let params = [];

                if (permanent) {
                    // KASUS 1: Ubah Permanen jadi Manual (Hapus Jadwal)
                    // Kita set semua waktu jadi NULL biar bersih
                    query = `UPDATE streams SET 
                        status = 'live', 
                        is_manual_run = 1, 
                        schedule_type = 'manual',
                        daily_start_time = NULL,
                        start_time = NULL,
                        end_time = NULL,
                        next_start_time = NULL,
                        next_end_time = NULL
                        WHERE id = ?`;
                    params = [id];
                } else {
                    // KASUS 2: Manual Biasa / Memang sudah manual dari awal
                    const isManual = (manual || stream.schedule_type === 'manual') ? 1 : 0;
                    query = "UPDATE streams SET status = 'live', is_manual_run = ? WHERE id = ?";
                    params = [isManual, id];
                }

                db.run(query, params, function(err) {
                    if(err) return res.status(500).json({error: err.message});
                    res.json({success: true});
                });
            });
        } else res.status(404).json({error: "Not found"});
    });
});

app.post('/api/streams/:id/stop', (req, res) => {
    const id = req.params.id;

    db.get("SELECT * FROM streams WHERE id = ?", [id], (err, stream) => {
        if(err || !stream) return res.status(404).json({error: "Stream not found"});

        streamManager.stopStreamProcess(id, true);

        // Reset Manual Flag jika masih Daily/Once (untuk hitung jadwal berikutnya)
        if (stream.schedule_type === 'daily') {
            const timeParts = stream.daily_start_time.split(':');
            const targetHour = parseInt(timeParts[0]);
            const targetMinute = parseInt(timeParts[1]);
            const now = new Date();
            const nextStart = new Date(now);
            nextStart.setHours(targetHour, targetMinute, 0, 0);
            
            // Logika Midnight Crossing
            if (now < nextStart) {
                // Next run is today
            } else {
                nextStart.setDate(nextStart.getDate() + 1); // Besok
            }
            
            const durationMinutes = parseInt(stream.daily_duration_minutes) || 0;
            const nextEndDate = new Date(nextStart);
            nextEndDate.setMinutes(nextEndDate.getMinutes() + durationMinutes);

            db.run("UPDATE streams SET next_start_time = ?, next_end_time = ?, status = 'scheduled', is_manual_run = 0 WHERE id = ?",
                [nextStart.toISOString(), nextEndDate.toISOString(), id],
                (err) => { res.json({success: true}); });

        } else if (stream.schedule_type === 'once') {
            db.run("UPDATE streams SET status = 'scheduled', is_manual_run = 0 WHERE id = ?", [id], (err) => { res.json({success: true}); });
        } else {
            // MANUAL TYPE: Cukup set scheduled/offline (is_manual_run 0 agar bersih)
            db.run("UPDATE streams SET status = 'scheduled', is_manual_run = 0 WHERE id = ?", [id], (err) => { res.json({success: true}); });
        }
    });
});

app.delete('/api/streams/:id', (req, res) => {
    const id = req.params.id;
    streamManager.stopStreamProcess(id);
    db.run("DELETE FROM streams WHERE id = ?", [id], (err) => res.json({success: true}));
});

// START SERVER
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    exec('killall -9 ffmpeg', (err) => { if(!err) console.log("[INIT] Cleared zombie streams."); });
    scheduler.runScheduler();
});
