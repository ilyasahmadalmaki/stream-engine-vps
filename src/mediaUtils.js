const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { paths } = require('./storage');

const generateThumbnail = (videoPath, outputFilename) => {
    return new Promise((resolve, reject) => {
        // Output path lengkap
        const thumbPath = path.join(paths.thumbnails, outputFilename);
        
        // Cek apakah FFmpeg terinstall?
        const ffmpeg = spawn('ffmpeg', ['-version']);
        ffmpeg.on('error', (err) => {
            console.error("❌ FFmpeg tidak ditemukan! Install dengan: sudo apt install ffmpeg");
            resolve(null); // Resolve null agar sistem tidak crash
        });

        // Perintah ambil screenshot di detik ke-3
        const args = [
            '-y',               // Overwrite file lama
            '-ss', '00:00:03',  // Seek ke detik 3
            '-i', videoPath,    // Input video
            '-vframes', '1',    // Ambil 1 frame
            '-q:v', '2',        // Kualitas JPG (2-31, 2 = terbaik)
            thumbPath           // Output file
        ];

        const proc = spawn('ffmpeg', args);

        proc.on('close', (code) => {
            if (code === 0) {
                // Pastikan file benar-benar terbentuk
                if (fs.existsSync(thumbPath)) {
                    // console.log(`[THUMB] Created: ${outputFilename}`);
                    resolve(thumbPath);
                } else {
                    console.error(`[THUMB] FFmpeg sukses tapi file tidak ada: ${thumbPath}`);
                    resolve(null);
                }
            } else {
                console.error(`[THUMB] FFmpeg failed with code ${code}`);
                resolve(null);
            }
        });

        proc.on('error', (err) => {
            console.error(`[THUMB] Error spawning process: ${err.message}`);
            resolve(null);
        });
    });
};

module.exports = { generateThumbnail };
