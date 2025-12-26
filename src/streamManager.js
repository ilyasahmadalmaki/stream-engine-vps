const { spawn, exec } = require('child_process');
const db = require('./db');
const telegram = require('./telegramBot'); // IMPORT INI

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
    
    // NOTIFIKASI TELEGRAM
    telegram.notify(`🔴 **LIVE STARTED**\nJudul: ${stream.title}\nMode: ${stream.schedule_type}\nVideo: ${videoPath.split('/').pop()}`);

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

    ffmpeg.stderr.on('data', () => {}); 

    ffmpeg.on('close', (code) => {
        console.log(`[STREAM END] ID ${stream.id} finished.`);
        if (activeStreams.has(stream.id)) {
            activeStreams.delete(stream.id);
            updateStatus(stream.id, 'offline');
            // NOTIFIKASI MATI (Crash/Selesai)
            telegram.notify(`⚠️ **STREAM ENDED/CRASHED**\nJudul: ${stream.title}\nCode: ${code}`);
        }
    });
};

const stopStreamProcess = (streamId, keepStatus = false) => {
    const ffmpeg = activeStreams.get(streamId);
    if (ffmpeg) {
        console.log(`[STOP] Mematikan ID ${streamId}...`);
        
        // NOTIFIKASI STOP
        telegram.notify(`⏹ **STREAM STOPPED (MANUAL)**\nID: ${streamId}`);

        ffmpeg.removeAllListeners('close');
        try { ffmpeg.kill('SIGKILL'); } catch(e) {}
        activeStreams.delete(streamId);
    }

    db.get("SELECT stream_key FROM streams WHERE id = ?", [streamId], (err, row) => {
        if (row && row.stream_key) {
            exec(`pkill -f "${row.stream_key}"`);
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
