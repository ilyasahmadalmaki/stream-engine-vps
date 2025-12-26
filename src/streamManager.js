const { spawn } = require('child_process');
const db = require('./db');

// Menyimpan proses FFmpeg yang sedang jalan: Map<ID, Process>
const activeStreams = new Map();

// Cek Status
const isRunning = (streamId) => {
    return activeStreams.has(streamId);
};

const startStreamProcess = (stream, videoPath) => {
    if (activeStreams.has(stream.id)) {
        console.log(`[STREAM WARNING] ID ${stream.id} sudah berjalan.`);
        return;
    }

    console.log(`[STREAM START] ${stream.title} (ID: ${stream.id})`);

    const args = [
        // --- FITUR LOOPING (Video Pendek -> Stream Panjang) ---
        '-stream_loop', '-1',   // Artinya: Ulangi terus (Infinite) sampai distop Scheduler
        
        '-re',                  // Realtime reading
        '-i', videoPath,        // Input File
        
        // VIDEO: COPY MENTAH-MENTAH (Ringan CPU)
        '-c:v', 'copy',      
        
        // AUDIO: RE-ENCODE KE AAC (Safety)
        '-c:a', 'aac',          
        '-b:a', '128k',         
        '-ar', '44100',         
        
        '-f', 'flv',            // Format streaming
        `${stream.rtmp_url}/${stream.stream_key}`
    ];

    const ffmpeg = spawn('ffmpeg', args);
    activeStreams.set(stream.id, ffmpeg);

    ffmpeg.stderr.on('data', (data) => {
        // console.log(`[FFMPEG] ${data}`);
    });

    ffmpeg.on('error', (err) => {
        console.error(`[STREAM ERROR] Gagal spawn FFmpeg: ${err.message}`);
        killStream(stream.id);
    });

    ffmpeg.on('close', (code) => {
        console.log(`[STREAM STOP] ID ${stream.id} finished (Code: ${code})`);
        
        // Hapus dari memory
        if (activeStreams.has(stream.id)) {
            activeStreams.delete(stream.id);
            // Default behavior: Jika mati sendiri/error, set Offline
            setTimeout(() => updateStatus(stream.id, 'offline'), 1000);
        }
    });
};

// MODIFIKASI: Tambah parameter 'keepStatus'
const stopStreamProcess = (streamId, keepStatus = false) => {
    killStream(streamId, keepStatus);
};

const killStream = (streamId, keepStatus = false) => {
    const ffmpeg = activeStreams.get(streamId);
    if (ffmpeg) {
        console.log(`[STREAM KILL] Mematikan paksa ID ${streamId} (KeepStatus: ${keepStatus})`);
        
        // PENTING: Hapus listener 'close' agar tidak memicu updateStatus 'offline' otomatis
        ffmpeg.removeAllListeners('close');
        
        try {
            ffmpeg.stdin.pause();
            ffmpeg.kill('SIGKILL');
        } catch(e) {}
        
        activeStreams.delete(streamId);

        // Hanya update jadi offline jika TIDAK disuruh keepStatus
        if (!keepStatus) {
            updateStatus(streamId, 'offline');
        }
    }
}

function updateStatus(id, status) {
    db.run("UPDATE streams SET status = ? WHERE id = ?", [status, id], (err) => {
        if(err) console.error(`[DB ERROR] Status update failed:`, err.message);
    });
}

process.on('exit', () => {
    for (const [id, ffmpeg] of activeStreams) ffmpeg.kill('SIGKILL');
});

module.exports = { startStreamProcess, stopStreamProcess, isRunning };
