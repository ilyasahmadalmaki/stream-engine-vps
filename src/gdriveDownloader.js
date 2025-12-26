const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Import modul storage yang baru kita buat
const { paths, getUniqueFilename, ensureDirectories } = require('./storage');

// Pastikan folder ada saat modul dimuat
ensureDirectories();

function extractFileId(driveUrl) {
  let match = driveUrl.match(/\/file\/d\/([^\/]+)/);
  if (match) return match[1];

  match = driveUrl.match(/\?id=([^&]+)/);
  if (match) return match[1];

  match = driveUrl.match(/\/d\/([^\/]+)/);
  if (match) return match[1];

  if (/^[a-zA-Z0-9_-]{25,}$/.test(driveUrl.trim())) {
    return driveUrl.trim();
  }

  throw new Error('Invalid Google Drive URL format');
}

async function downloadFile(fileId, progressCallback = null) {
  try {
    // Gunakan folder dari storage.js
    const tempFilename = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;
    const tempPath = path.join(paths.videos, tempFilename);
    
    let response;
    let retryCount = 0;
    const maxRetries = 3;
    let downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
    
    while (retryCount < maxRetries) {
      try {
        console.log(`[GDRIVE] Attempting download from: ${downloadUrl}`);
        
        const headResponse = await axios.head(downloadUrl, {
          timeout: 30000,
          maxRedirects: 10,
          validateStatus: () => true,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        
        const contentType = headResponse.headers['content-type'] || '';
        
        if (contentType.includes('text/html')) {
          console.log('[GDRIVE] Received HTML response, trying alternative...');
          downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;
          
          if (retryCount === 1) {
            downloadUrl = `https://docs.google.com/uc?export=download&id=${fileId}&confirm=t`;
          }
          
          retryCount++;
          if (retryCount >= maxRetries) {
            throw new Error('File appears to be private or requires auth.');
          }
          continue;
        }
        
        response = await axios({
          method: 'GET',
          url: downloadUrl,
          responseType: 'stream',
          timeout: 600000,
          maxRedirects: 10,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Connection': 'keep-alive'
          }
        });
        break;
      } catch (error) {
        retryCount++;
        console.log(`[GDRIVE] Attempt ${retryCount} failed:`, error.message);
        
        if (retryCount >= maxRetries) throw error;
        
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') {
          downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
      }
    }

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: Failed to download file`);
    }
    
    const totalSize = parseInt(response.headers['content-length'] || '0');
    let downloadedSize = 0;
    let lastProgress = 0;

    const writer = fs.createWriteStream(tempPath);

    response.data.on('data', (chunk) => {
      downloadedSize += chunk.length;
      
      if (totalSize > 0 && progressCallback) {
        const progress = Math.round((downloadedSize / totalSize) * 100);
        if (progress > lastProgress && progress <= 100) {
          lastProgress = progress;
          progressCallback(progress);
        }
      }
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        try {
          if (!fs.existsSync(tempPath)) {
            reject(new Error('Downloaded file not found'));
            return;
          }

          const stats = fs.statSync(tempPath);
          const fileSize = stats.size;

          if (fileSize < 1024) {
             fs.unlinkSync(tempPath);
             reject(new Error('File too small (<1KB). Likely HTML error.'));
             return;
          }
          
          // Rename menggunakan fungsi dari storage.js
          const originalFilename = `gdrive_${fileId}.mp4`;
          const uniqueFilename = getUniqueFilename(originalFilename);
          const finalPath = path.join(paths.videos, uniqueFilename);
          
          fs.renameSync(tempPath, finalPath);
          
          console.log(`[GDRIVE] Success: ${uniqueFilename}`);
          resolve({
            filename: uniqueFilename,
            localFilePath: finalPath,
            fileSize: fileSize
          });
        } catch (error) {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          reject(new Error(`Processing error: ${error.message}`));
        }
      });

      writer.on('error', (error) => {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        reject(error);
      });
    });
  } catch (error) {
    throw error;
  }
}

module.exports = { extractFileId, downloadFile };
