// --- LOAD ENV PALING ATAS (WAJIB) ---
require('dotenv').config();

const express = require('express');
const session = require('express-session'); // Library session
const multer = require('multer');
const path = require('path');
const db = require('./src/db');
const { getSystemStats } = require('./src/systemStats');
const scheduler = require('./src/scheduler');
const streamManager = require('./src/streamManager');
const telegram = require('./src/telegramBot');
const fs = require('fs-extra');
const { spawn, exec } = require('child_process'); 
const gdrive = require('./src/gdriveDownloader'); 
const storage = require('./src/storage');
const mediaUtils = require('./src/mediaUtils');

// --- CONFIG ---
const PORT = process.env.PORT || 7000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'rahasia_super_aman_123';

// --- INIT SYSTEM ---
storage.ensureDirectories();
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

setTimeout(() => {
    db.run("ALTER TABLE streams ADD COLUMN is_manual_run BOOLEAN DEFAULT 0", () => {});
}, 2000);

const app = express();

// --- MIDDLEWARE ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. SETUP SESSION (SATPAM)
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000, // Login berlaku 24 jam
        httpOnly: true 
    }
}));

// 2. FUNGSI CEK LOGIN
const requireAuth = (req, res, next) => {
    if (req.session.loggedIn) {
        next(); // Boleh lewat
    } else {
        // Kalau akses API tapi belum login -> Error 401
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: "Unauthorized. Please login." });
        }
        // Kalau akses Web tapi belum login -> Tendang ke Login Page
        res.redirect('/login.html');
    }
};

// 3. ROUTE PUBLIC (Bisa diakses tanpa login)
app.use('/login.html', express.static(path.join(__dirname, 'public', 'login.html')));

app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.loggedIn = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Username atau Password salah!' });
    }
});

app.post('/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// 4. ROUTE PROTECTED (Harus Login Dulu)
// Semua di bawah baris ini diproteksi oleh requireAuth
app.use('/uploads', requireAuth, express.static('uploads')); // Video tidak bisa dibuka orang asing
app.use('/', requireAuth, express.static('public')); // Dashboard terkunci

// --- API ROUTES (Protected by requireAuth via middleware urutan di atas atau eksplisit) ---
const upload = multer({ storage: multer.diskStorage({
    destination: storage.paths.videos,
    filename: (req, f, cb) => cb(null, storage.getUniqueFilename(f.originalname))
})});

// System
app.get('/api/system/stats', requireAuth, async (req, res) => { res.json(await getSystemStats()); });

// Videos
app.get('/api/videos', requireAuth, (req, res) => { db.all("SELECT * FROM videos ORDER BY created_at DESC", [], (e, r) => res.json(r)); });

app.post('/api/videos/upload', requireAuth, upload.single('video'), async (req, res) => {
    try {
        const { originalname, size, path: fp, filename } = req.file;
        const tn = filename.replace(path.extname(filename), '.jpg');
        const tp = await mediaUtils.generateThumbnail(fp, tn);
        db.run(`INSERT INTO videos (title, file_path, thumbnail_path, source_type, file_size) VALUES (?, ?, ?, 'local', ?)`, 
            [originalname, fp, tp ? path.join('uploads', tn) : null, size], (e) => {
            if(e) res.status(500).json({error:e.message}); else res.json({success:true});
        });
    } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/videos/import', requireAuth, async (req, res) => {
    try {
        const fileId = gdrive.extractFileId(req.body.url);
        if(!fileId) return res.status(400).json({error:"Link invalid"});
        const r = await gdrive.downloadFile(fileId, (p) => { if(p%10===0) console.log(`[DL] ${p}%`); });
        const tn = r.filename.replace(path.extname(r.filename), '.jpg');
        const tp = await mediaUtils.generateThumbnail(r.localFilePath, tn);
        db.run(`INSERT INTO videos (title, file_path, thumbnail_path, source_type, file_size) VALUES (?, ?, ?, 'imported', ?)`,
            [r.filename, r.localFilePath, tp ? path.join('uploads', tn) : null, r.fileSize], (e) => {
            if(e) res.status(500).json({error:e.message}); else res.json({success:true});
        });
    } catch(e) { res.status(500).json({error:e.message}); }
});

app.delete('/api/videos/:id', requireAuth, (req, res) => {
    db.get("SELECT file_path, thumbnail_path FROM videos WHERE id = ?", [req.params.id], (err, row) => {
        if (row) {
            if(fs.existsSync(row.file_path)) fs.unlinkSync(row.file_path);
            if(row.thumbnail_path && fs.existsSync(row.thumbnail_path)) fs.unlinkSync(row.thumbnail_path);
            db.run("DELETE FROM videos WHERE id=?", [req.params.id], () => res.json({success:true}));
        } else res.status(404).json({error:"Not found"});
    });
});

// Streams
app.get('/api/streams', requireAuth, (req, res) => { db.all("SELECT s.*, v.title as video_title FROM streams s LEFT JOIN videos v ON s.video_id = v.id ORDER BY s.created_at DESC", [], (e,r)=>res.json(r)); });

app.post('/api/streams', requireAuth, (req, res) => {
    const { title, stream_key, video_id, schedule_type, start_time, daily_start_time, duration_hours, duration_minutes } = req.body;
    
    db.get("SELECT id FROM streams WHERE title = ? OR stream_key = ?", [title, stream_key], (e, r) => {
        if(r) return res.status(400).json({error:"Judul/Key sudah ada!"});
        const tm = (parseInt(duration_hours||0)*60) + parseInt(duration_minutes||0);
        let ns=null, ne=null;
        
        if(schedule_type==='daily'){
            const [h,m] = daily_start_time.split(':'); const d = new Date(); d.setHours(h,m,0,0);
            if(d<new Date()) d.setDate(d.getDate()+1);
            ns=d.toISOString(); const ed=new Date(d); ed.setMinutes(ed.getMinutes()+tm); ne=ed.toISOString();
        } else if (schedule_type === 'once') {
             ns=start_time; const ed=new Date(ns); ed.setMinutes(ed.getMinutes()+tm); ne=ed.toISOString();
        }

        db.run(`INSERT INTO streams (title, rtmp_url, stream_key, video_id, schedule_type, start_time, daily_start_time, daily_duration_minutes, next_start_time, next_end_time, status, is_manual_run) VALUES (?, 'rtmp://a.rtmp.youtube.com/live2', ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 0)`,
        [title, stream_key, video_id, schedule_type, start_time, daily_start_time, tm, ns, ne], (e) => {
            if(e)res.status(500).json({error:e.message}); else res.json({success:true});
        });
    });
});

// --- PERBAIKAN: MENAMBAHKAN ROUTE UPDATE/EDIT ---
app.put('/api/streams/:id', requireAuth, (req, res) => {
    const { title, stream_key, video_id, schedule_type, start_time, daily_start_time, duration_hours, duration_minutes } = req.body;
    const id = req.params.id;

    const tm = (parseInt(duration_hours||0)*60) + parseInt(duration_minutes||0);
    let ns=null, ne=null;

    try {
        if(schedule_type === 'daily' && daily_start_time) {
            const [h,m] = daily_start_time.split(':'); 
            const d = new Date(); d.setHours(h,m,0,0);
            if(d < new Date()) d.setDate(d.getDate()+1);
            ns = d.toISOString(); 
            const ed = new Date(d); ed.setMinutes(ed.getMinutes()+tm); ne = ed.toISOString();
        } 
        else if (schedule_type === 'once' && start_time) {
            ns = start_time; 
            const ed = new Date(ns); ed.setMinutes(ed.getMinutes()+tm); ne = ed.toISOString();
        }
    } catch (e) {
        return res.status(400).json({error: "Format waktu salah"});
    }

    const sql = `UPDATE streams SET 
        title=?, stream_key=?, video_id=?, schedule_type=?, 
        start_time=?, daily_start_time=?, daily_duration_minutes=?, 
        next_start_time=?, next_end_time=? 
        WHERE id=?`;

    const params = [title, stream_key, video_id, schedule_type, start_time, daily_start_time, tm, ns, ne, id];

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Stream updated" });
    });
});
// ------------------------------------------------

app.post('/api/streams/:id/start', requireAuth, (req, res) => {
    const { manual, permanent } = req.body; const id = req.params.id;
    db.get("SELECT s.*, v.file_path FROM streams s LEFT JOIN videos v ON s.video_id = v.id WHERE s.id = ?", [id], (e, s) => {
        if(!s) return res.status(404).json({error:"Not found"});
        if(!fs.existsSync(s.file_path)) return res.status(400).json({error:"Video missing"});
        
        streamManager.startStreamProcess(s, s.file_path);
        let q = permanent ? `UPDATE streams SET status='live', is_manual_run=1, schedule_type='manual' WHERE id=?` : `UPDATE streams SET status='live', is_manual_run=? WHERE id=?`;
        db.run(q, permanent ? [id] : [(manual||s.schedule_type==='manual')?1:0, id], () => res.json({success:true}));
    });
});

app.post('/api/streams/:id/stop', requireAuth, (req, res) => {
    streamManager.stopStreamProcess(req.params.id, true);
    db.run("UPDATE streams SET status='scheduled', is_manual_run=0 WHERE id=?", [req.params.id], ()=>res.json({success:true}));
});

app.delete('/api/streams/:id', requireAuth, (req, res) => {
    streamManager.stopStreamProcess(req.params.id);
    db.run("DELETE FROM streams WHERE id=?", [req.params.id], ()=>res.json({success:true}));
});

// START SERVER
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Init Telegram
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if(botToken) {
        telegram.init(botToken, streamManager);
        setTimeout(() => telegram.notify("🔐 **SERVER SECURE**\nLogin System Activated!"), 3000);
    }

    exec('killall -9 ffmpeg', (err) => { if(!err) console.log("Zombies cleared."); });
    scheduler.runScheduler();
});
