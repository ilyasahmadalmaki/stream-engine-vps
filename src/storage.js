const fs = require('fs-extra');
const path = require('path');

// Menggunakan path.resolve untuk mendapatkan Absolute Path yang akurat
const baseDir = path.resolve(__dirname, '../'); // Root project
const uploadDir = path.join(baseDir, 'uploads');

const ensureDirectories = () => {
    // Pastikan folder uploads ada
    fs.ensureDirSync(uploadDir);
    console.log(`[STORAGE] Upload directory confirmed at: ${uploadDir}`);
};

const getUniqueFilename = (originalFilename) => {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    const ext = path.extname(originalFilename);
    const basename = path.basename(originalFilename, ext)
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase();
    return `${basename}_${timestamp}_${random}${ext}`;
};

module.exports = {
    ensureDirectories,
    getUniqueFilename,
    paths: {
        videos: uploadDir,
        thumbnails: uploadDir // Kita satukan di folder uploads biar tidak ribet
    }
};
