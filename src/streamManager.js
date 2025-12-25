const { spawn } = require('child_process');
const path = require('path');

// Peta untuk menyimpan proses yang berjalan: { streamId: processObject }
const activeProcesses = {};

const startStreamProcess = (stream, videoPath) => {
    if (activeProcesses[stream.id]) {
        console.log(`Stream ${stream.id} is already running.`);
        return;
    }

    console.log(`Starting Stream ID: ${stream.id} | Video: ${videoPath}`);

    const rtmpFull = `${stream.rtmp_url}/${stream.stream_key}`;
    
    // FFMPEG Command: Full Copy, Loop, Native
    const args = [
        '-re',
        '-stream_loop', '-1',
        '-i', videoPath,
        '-c:v', 'copy',
        '-c:a', 'copy', // Bisa diubah ke 'aac' jika audio bermasalah
        '-f', 'flv',
        rtmpFull
    ];

    const ffmpeg = spawn('ffmpeg', args);

    ffmpeg.stdout.on('data', (data) => {
        // Uncomment untuk debug output FFmpeg
        // console.log(`FFmpeg stdout: ${data}`);
    });

    ffmpeg.stderr.on('data', (data) => {
        // FFmpeg mengirim log ke stderr
        // console.error(`FFmpeg stderr: ${data}`);
    });

    ffmpeg.on('close', (code) => {
        console.log(`Stream ${stream.id} exited with code ${code}`);
        delete activeProcesses[stream.id];
    });

    activeProcesses[stream.id] = ffmpeg;
};

const stopStreamProcess = (streamId) => {
    const process = activeProcesses[streamId];
    if (process) {
        console.log(`Stopping Stream ID: ${streamId} via SIGTERM`);
        process.kill('SIGTERM');
        delete activeProcesses[streamId];
        return true;
    }
    return false;
};

const isRunning = (streamId) => {
    return !!activeProcesses[streamId];
};

module.exports = { startStreamProcess, stopStreamProcess, isRunning };