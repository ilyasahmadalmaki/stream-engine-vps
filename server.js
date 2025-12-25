const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('./src/db');
const { getSystemStats } = require('./src/systemStats');
const scheduler = require('./src/scheduler'); // Init scheduler
const streamManager = require('./src/streamManager');
const fs = require('fs');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 7000;

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Upload Config
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// --- API ROUTES ---

// 1. System Stats
app.get('/api/system/stats', async (req, res) => {
    const stats = await getSystemStats();
    res.json(stats);
});

// 2. Videos CRUD
app.get('/api/videos', (req, res) => {
    db.all("SELECT * FROM videos ORDER BY created_at DESC", [], (err, rows) => {
        res.json(rows);
    });
});

app.post('/api/videos/upload', upload.single('video'), (req, res) => {
    // Di real production, gunakan ffprobe untuk ambil durasi
    const { originalname, size, path: filePath } = req.file;
    db.run(`INSERT INTO videos (title, file_path, source_type, file_size) VALUES (?, ?, 'local', ?)`,
        [originalname, filePath, size],
        function(err) {
            if(err) return res.status(500).json({error: err.message});
            res.json({success: true, id: this.lastID});
        }
    );
});

app.post('/api/videos/import', (req, res) => {
    const { title, url } = req.body;
    db.run(`INSERT INTO videos (title, file_path, source_type) VALUES (?, ?, 'gdrive')`,
        [title, url],
        function(err) {
            if(err) return res.status(500).json({error: err.message});
            res.json({success: true});
        }
    );
});

// 3. Streams CRUD
app.get('/api/streams', (req, res) => {
    db.all("SELECT s.*, v.title as video_title FROM streams s LEFT JOIN videos v ON s.video_id = v.id ORDER BY s.created_at DESC", [], (err, rows) => {
        res.json(rows);
    });
});

app.post('/api/streams', (req, res) => {
    const { 
        title, rtmp_url, stream_key, video_id, schedule_type, 
        start_time, end_time, daily_start_time, daily_duration_hours 
    } = req.body;

    let nextStart, nextEnd;

    // Hitung waktu awal berdasarkan tipe
    if (schedule_type === 'once') {
        nextStart = start_time;
        nextEnd = end_time;
    } else {
        // Daily: Hitung "Hari Ini" jam segitu
        const [h, m] = daily_start_time.split(':');
        const now = new Date();
        const d = new Date();
        d.setHours(h, m, 0, 0);
        
        // Jika jam sudah lewat hari ini, mulai besok? 
        // Atau mulai hari ini jika belum lewat? 
        // Asumsi: Mulai hari ini jika belum lewat, kalau lewat mulai besok.
        if (d < now) {
            d.setDate(d.getDate() + 1);
        }
        
        nextStart = d.toISOString();
        const endD = new Date(d);
        endD.setHours(endD.getHours() + parseInt(daily_duration_hours));
        nextEnd = endD.toISOString();
    }

    const query = `INSERT INTO streams (
        title, rtmp_url, stream_key, video_id, schedule_type, 
        start_time, end_time, daily_start_time, daily_duration_hours,
        next_start_time, next_end_time, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`;

    db.run(query, [
        title, rtmp_url, stream_key, video_id, schedule_type,
        start_time, end_time, daily_start_time, daily_duration_hours,
        nextStart, nextEnd
    ], function(err) {
        if(err) return res.status(500).json({error: err.message});
        res.json({success: true});
    });
});

app.post('/api/streams/:id/stop', (req, res) => {
    const id = req.params.id;
    const stopped = streamManager.stopStreamProcess(id);
    db.run("UPDATE streams SET status = 'offline' WHERE id = ?", [id]);
    res.json({success: stopped});
});

app.post('/api/streams/:id/start', (req, res) => {
    const id = req.params.id;
    db.get("SELECT s.*, v.file_path FROM streams s LEFT JOIN videos v ON s.video_id = v.id WHERE s.id = ?", [id], (err, stream) => {
        if(stream) {
            streamManager.startStreamProcess(stream, stream.file_path);
            db.run("UPDATE streams SET status = 'live' WHERE id = ?", [id]);
            res.json({success: true});
        } else {
            res.status(404).json({error: "Not found"});
        }
    });
});

app.delete('/api/streams/:id', (req, res) => {
    const id = req.params.id;
    streamManager.stopStreamProcess(id); // Kill if running
    db.run("DELETE FROM streams WHERE id = ?", [id], (err) => {
        res.json({success: true});
    });
});

// Jalankan Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // Trigger scheduler check immediately on start
    scheduler.runScheduler();
});