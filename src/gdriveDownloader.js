const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { paths, getUniqueFilename } = require('./storage');

function extractFileId(driveUrl) {
    // Pola 1: /file/d/ID
    let match = driveUrl.match(/\/file\/d\/([^\/]+)/);
    if (match) return match[1];

    // Pola 2: ?id=ID
    match = driveUrl.match(/\?id=([^&]+)/);
    if (match) return match[1];

    // Pola 3: /d/ID
    match = driveUrl.match(/\/d\/([^\/]+)/);
    if (match) return match[1];

    // Pola 4: ID Langsung
    if (/^[a-zA-Z0-9_-]{25,}$/.test(driveUrl.trim())) {
        return driveUrl.trim();
    }

    return null; // Return null jika tidak ketemu, biar server.js yang handle errornya
}

async function downloadFile(fileId, progressCallback = null) {
    try {
        // Buat nama sementara
        const tempFilename = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const tempPath = path.join(paths.videos, tempFilename);
        
        let response;
        let retryCount = 0;
        const maxRetries = 3;
        
        // URL Awal
        let downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
        
        console.log(`[GDRIVE] Memulai proses download untuk ID: ${fileId}`);

        // --- FASE 1: MENDAPATKAN STREAM (RETRY LOGIC) ---
        while (retryCount < maxRetries) {
            try {
                console.log(`[GDRIVE] Percobaan ${retryCount + 1}/${maxRetries}: ${downloadUrl}`);
                
                // Cek Head dulu (biar hemat bandwidth kalau ternyata HTML)
                const headResponse = await axios.head(downloadUrl, {
                    timeout: 30000,
                    maxRedirects: 10,
                    validateStatus: () => true, // Jangan throw error dulu
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
                });
                
                const contentType = headResponse.headers['content-type'] || '';
                
                // Jika HTML, biasanya minta konfirmasi atau redirect manual
                if (contentType.includes('text/html')) {
                    console.log('[GDRIVE] Terdeteksi HTML, mencoba URL alternatif...');
                    downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;
                    
                    if (retryCount === 1) {
                        downloadUrl = `https://docs.google.com/uc?export=download&id=${fileId}&confirm=t`;
                    }
                    
                    retryCount++;
                    if (retryCount >= maxRetries) throw new Error('Gagal mendapatkan link video langsung (Private/Auth Required).');
                    continue;
                }
                
                // Request File Asli (Stream)
                response = await axios({
                    method: 'GET',
                    url: downloadUrl,
                    responseType: 'stream',
                    timeout: 600000, // 10 Menit timeout
                    maxRedirects: 10,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Connection': 'keep-alive'
                    }
                });
                
                break; // Berhasil dapat stream

            } catch (error) {
                retryCount++;
                console.log(`[GDRIVE] Error pada percobaan ${retryCount}:`, error.message);
                
                if (retryCount >= maxRetries) throw error;
                
                // Ganti strategi URL jika error koneksi
                if (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') {
                    downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;
                }
                
                await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
            }
        }

        if (!response || response.status !== 200) {
            throw new Error(`Gagal download. HTTP Status: ${response ? response.status : 'Unknown'}`);
        }
        
        // Cek lagi Content Type dari response asli
        const responseContentType = response.headers['content-type'] || '';
        if (responseContentType.includes('text/html')) {
            throw new Error('Server mengirim halaman HTML, bukan video. Cek izin akses file (Anyone with the link).');
        }

        // --- FASE 2: MENULIS FILE (PIPING) ---
        const totalSize = parseInt(response.headers['content-length'] || '0');
        let downloadedSize = 0;
        let lastProgress = 0;

        const writer = fs.createWriteStream(tempPath);

        response.data.on('data', (chunk) => {
            downloadedSize += chunk.length;
            
            if (totalSize > 0 && progressCallback) {
                const progress = Math.round((downloadedSize / totalSize) * 100);
                if (progress > lastProgress) {
                    lastProgress = progress;
                    progressCallback(progress);
                }
            }
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                try {
                    // Validasi File Fisik
                    if (!fs.existsSync(tempPath)) { return reject(new Error('File hasil download hilang.')); }
                    const stats = fs.statSync(tempPath);
                    const fileSize = stats.size;

                    // 1. Cek Ukuran (Min 1KB)
                    if (fileSize < 1024) {
                        fs.unlinkSync(tempPath);
                        return reject(new Error('File terlalu kecil (bukan video).'));
                    }

                    // 2. Cek Magic Bytes (Header File) - PENTING!
                    const buffer = Buffer.alloc(512);
                    const fd = fs.openSync(tempPath, 'r');
                    fs.readSync(fd, buffer, 0, 512, 0);
                    fs.closeSync(fd);
                    
                    const fileHeader = buffer.toString('utf8', 0, 100).toLowerCase();
                    
                    // Kalau isinya HTML (<!doctype html...) -> Hapus!
                    if (fileHeader.includes('<!doctype html') || fileHeader.includes('<html') || fileHeader.includes('<head>')) {
                        fs.unlinkSync(tempPath);
                        return reject(new Error('Isi file adalah kode HTML (Halaman Web), bukan Video.'));
                    }
                    
                    // Kalau Header Video Valid (MP4/MKV/FLV signatures)
                    // (Simplifikasi: kita anggap kalau bukan HTML dan size besar, kemungkinan video. 
                    // Kode asli Anda punya pengecekan hex yang bagus, saya pertahankan logikanya).
                    const validVideoHeaders = [
                        [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], // ftyp
                        [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70],
                        [0x1A, 0x45, 0xDF, 0xA3], // MKV
                        [0x00, 0x00, 0x01, 0xBA], // MPG
                        [0x46, 0x4C, 0x56, 0x01]   // FLV
                    ];
                    
                    let isValidVideo = false;
                    for (const header of validVideoHeaders) {
                        let matches = true;
                        for (let i = 0; i < header.length && i < buffer.length; i++) {
                            if (buffer[i] !== header[i]) { matches = false; break; }
                        }
                        if (matches) { isValidVideo = true; break; }
                    }
                    
                    // Fallback cek string 'ftyp'
                    if (!isValidVideo && !buffer.includes(Buffer.from('ftyp'))) {
                        // Strict mode: Uncomment baris bawah jika ingin menolak file yang headernya aneh
                        // fs.unlinkSync(tempPath); 
                        // return reject(new Error('Format file video tidak dikenali.'));
                    }

                    // 3. Rename ke Final
                    const originalFilename = `gdrive_import.mp4`; // Kita pakai nama generik, user bisa rename nanti
                    const uniqueFilename = getUniqueFilename(originalFilename);
                    const finalPath = path.join(paths.videos, uniqueFilename);
                    
                    fs.renameSync(tempPath, finalPath);
                    
                    console.log(`[GDRIVE] Sukses! Tersimpan sebagai: ${uniqueFilename} (${(fileSize/1024/1024).toFixed(2)} MB)`);
                    
                    resolve({
                        filename: uniqueFilename,
                        localFilePath: finalPath,
                        fileSize: fileSize
                    });

                } catch (error) {
                    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                    reject(new Error(`Error pemrosesan file: ${error.message}`));
                }
            });

            writer.on('error', (err) => {
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                reject(err);
            });
        });

    } catch (error) {
        console.error('[GDRIVE CRITICAL]', error.message);
        throw error; // Lempar ke server.js
    }
}

module.exports = { extractFileId, downloadFile };
