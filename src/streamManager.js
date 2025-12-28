const { spawn, exec } = require('child_process');
const db = require('./db');
const telegram = require('./telegramBot'); 

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
    
    // Potong nama file biar ga kepanjangan di notif
    const shortVideoName = videoPath.split('/').pop().substring(0, 20) + '...';
    telegram.notify(`🔴 **LIVE STARTED**\nJudul: ${stream.title}\nMode: ${stream.schedule_type}\nVideo: ${shortVideoName}`);

    // --- RAHASIA RACIKAN FFMPEG ANTI-CRASH ---
    const args = [
        '-re', // Baca input sesuai frame rate asli (wajib buat streaming)
        '-stream_loop', '-1', // Loop video selamanya
        '-fflags', '+genpts', // Fix timestamp saat looping (biar ga error waktu seek balik ke awal)
        
        '-i', videoPath, // Input File
        
        // VIDEO SETTINGS (Copy = Paling Hemat CPU)
        '-c:v', 'copy', 
        
        // AUDIO SETTINGS (AAC LC 128k - Standar YouTube)
        '-c:a', 'aac', 
        '-b:a', '128k', 
        '-ar', '44100',
        
        // BUFFER & NETWORK SETTINGS (PENTING BIAR GA GAMPANG PUTUS)
        '-max_muxing_queue_size', '1024', // Cegah buffer overflow
        '-bufsize', '4000k', // Batasi buffer size
        
        // OUTPUT FORMAT
        '-f', 'flv',
        '-flvflags', 'no_duration_filesize', // Hapus metadata durasi (karena live stream ga ada durasinya)
        
        // TUJUAN
        `${stream.rtmp_url}/${stream.stream_key}`
    ];

    const ffmpeg = spawn('ffmpeg', args);
    activeStreams.set(stream.id, ffmpeg);

    // Mencegah crash log memenuhi server, tapi tetap dicatat
    ffmpeg.stderr.on('data', (data) => {
        // Uncomment baris bawah ini kalau mau debug lewat terminal
        // console.log(`[FFMPEG ${stream.id}] ${data}`); 
    }); 

    ffmpeg.on('close', (code) => {
        console.log(`[STREAM END] ID ${stream.id} finished/died with code ${code}.`);
        if (activeStreams.has(stream.id)) {
            activeStreams.delete(stream.id);
            
            // Jika status masih LIVE tapi proses mati, ubah jadi offline
            // Nanti Auto-Heal Scheduler yang akan menghidupkan lagi
            updateStatus(stream.id, 'offline');
            
            // Jangan lapor kalau code null/0 (manual stop)
            if (code !== 0 && code !== null && code !== 255) {
                telegram.notify(`⚠️ **STREAM ENDED/CRASHED**\nJudul: ${stream.title}\nCode: ${code}\n_(Auto-heal akan mencoba restart..)_`);
            }
        }
    });
};

const stopStreamProcess = (streamId, keepStatus = false) => {
    const ffmpeg = activeStreams.get(streamId);
    if (ffmpeg) {
        console.log(`[STOP] Mematikan ID ${streamId}...`);
        telegram.notify(`⏹ **STREAM STOPPED (MANUAL)**\nID: ${streamId}`);
        
        ffmpeg.removeAllListeners('close'); // Biar ga lapor "Crashed" saat dimatikan manual
        try { ffmpeg.kill('SIGKILL'); } catch(e) {}
        activeStreams.delete(streamId);
    }

    // Kill sisa proses zombie jika ada
    db.get("SELECT stream_key FROM streams WHERE id = ?", [streamId], (err, row) => {
        if (row && row.stream_key) {
            exec(`pkill -f "${row.stream_key}"`, () => {});
        }
    });

    if (!keepStatus) {
        updateStatus(streamId, 'offline');
    }
};

function updateStatus(id, status) {
    db.run("UPDATE streams SET status = ? WHERE id = ?", [status, id]);
}

process.on('exit', () => {
    exec('killall -9 ffmpeg');
});

module.exports = { startStreamProcess, stopStreamProcess, isRunning };
