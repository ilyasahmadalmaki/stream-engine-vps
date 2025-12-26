const { spawn, exec } = require('child_process');
const db = require('./db');

// Map Process
const activeStreams = new Map();

const isRunning = (streamId) => {
    return activeStreams.has(streamId);
};

const startStreamProcess = (stream, videoPath) => {
    if (activeStreams.has(stream.id)) {
        console.log(`[STREAM WARNING] ID ${stream.id} sudah jalan.`);
        return;
    }

    console.log(`[STREAM START] ${stream.title} (ID: ${stream.id})`);

    const args = [
        '-stream_loop', '-1',
        '-re',
        '-i', videoPath,
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
        '-f', 'flv',
        `${stream.rtmp_url}/${stream.stream_key}`
    ];

    const ffmpeg = spawn('ffmpeg', args);
    activeStreams.set(stream.id, ffmpeg);

    ffmpeg.stderr.on('data', () => {}); // Silent log

    ffmpeg.on('close', (code) => {
        console.log(`[STREAM END] ID ${stream.id} finished.`);
        if (activeStreams.has(stream.id)) {
            activeStreams.delete(stream.id);
            // Default: Jika mati sendiri, set offline
            updateStatus(stream.id, 'offline');
        }
    });
};

// --- FUNGSI STOP YANG DIPERBAIKI (Search & Destroy) ---
const stopStreamProcess = (streamId, keepStatus = false) => {
    
    // 1. Coba matikan lewat Memory (Cara Normal)
    const ffmpeg = activeStreams.get(streamId);
    if (ffmpeg) {
        console.log(`[STOP] Mematikan ID ${streamId} dari Memory...`);
        ffmpeg.removeAllListeners('close');
        try { ffmpeg.kill('SIGKILL'); } catch(e) {}
        activeStreams.delete(streamId);
    }

    // 2. FAILSAFE: Matikan lewat System Command (Cara Paksa)
    // Berguna jika Server habis restart (Lupa Memory)
    db.get("SELECT stream_key FROM streams WHERE id = ?", [streamId], (err, row) => {
        if (row && row.stream_key) {
            console.log(`[FORCE KILL] Mencari proses dengan Key: ...${row.stream_key.slice(-4)}`);
            
            // Perintah Linux: pkill -f "kunci_stream"
            // Ini akan membunuh proses APAPUN yang mengandung stream key tersebut
            exec(`pkill -f "${row.stream_key}"`, (err) => {
                if(!err) console.log("[FORCE KILL] Sukses membunuh Ghost Process.");
            });
        }
    });

    // 3. Pastikan Status Database Berubah (PENTING!)
    // Jangan pedulikan prosesnya ketemu atau tidak, DB harus update.
    if (!keepStatus) {
        updateStatus(streamId, 'offline');
    }
};

function updateStatus(id, status) {
    db.run("UPDATE streams SET status = ? WHERE id = ?", [status, id]);
}

// Bersih-bersih saat server mati
process.on('exit', () => {
    exec('killall -9 ffmpeg');
});

module.exports = { startStreamProcess, stopStreamProcess, isRunning };

