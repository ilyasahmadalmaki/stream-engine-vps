const fs = require('fs-extra');
const path = require('path');
const db = require('./db');
const { paths } = require('./storage');
const { generateThumbnail } = require('./mediaUtils');

console.log("\n============================================");
console.log("   DIAGNOSTIC & RECOVERY TOOL v2.0");
console.log("============================================");
console.log(`📂 Target Folder: ${paths.videos}`);

// Cek apakah folder ada?
if (!fs.existsSync(paths.videos)) {
    console.error("❌ ERROR CRITICAL: Folder uploads tidak ditemukan!");
    console.log("   Solusi: Buat folder manual dengan 'mkdir uploads'");
    process.exit(1);
}

fs.readdir(paths.videos, async (err, files) => {
    if (err) return console.error("❌ Gagal baca folder:", err);

    const videoFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.mp4', '.mkv', '.mov', '.avi', '.flv'].includes(ext);
    });

    console.log(`📊 Status: Ditemukan ${videoFiles.length} video fisik.`);

    if (videoFiles.length === 0) {
        console.log("⚠️  Folder kosong. Silakan upload video dulu.");
        return;
    }

    let successCount = 0;

    for (const filename of videoFiles) {
        const fullPath = path.join(paths.videos, filename);
        
        // Cek DB
        const row = await new Promise((resolve) => {
            db.get("SELECT id, thumbnail_path FROM videos WHERE file_path = ?", [fullPath], (err, row) => resolve(row));
        });

        if (!row) {
            process.stdout.write(`➕ New: ${filename} ... `);
            
            // Generate Thumb
            const thumbName = filename.replace(path.extname(filename), '.jpg');
            const thumbPathFull = await generateThumbnail(fullPath, thumbName);
            const thumbPathRel = thumbPathFull ? path.join('uploads', thumbName) : null;
            
            const stats = fs.statSync(fullPath);

            await new Promise(resolve => {
                db.run(`INSERT INTO videos (title, file_path, thumbnail_path, source_type, file_size) VALUES (?, ?, ?, 'recovered', ?)`,
                    [filename, fullPath, thumbPathRel, stats.size],
                    (e) => {
                        if(e) console.log("❌ DB Error: " + e.message);
                        else { console.log("✅ OK"); successCount++; }
                        resolve();
                    }
                );
            });

        } else {
            // Cek Thumb yang hilang
            const thumbName = filename.replace(path.extname(filename), '.jpg');
            const thumbFullPath = path.join(paths.videos, thumbName);

            if (!fs.existsSync(thumbFullPath)) {
                process.stdout.write(`🔧 Fix Thumb: ${filename} ... `);
                await generateThumbnail(fullPath, thumbName);
                
                // Update DB path just in case
                const relPath = path.join('uploads', thumbName);
                db.run("UPDATE videos SET thumbnail_path = ? WHERE id = ?", [relPath, row.id]);
                console.log("✅ Fixed");
            }
        }
    }
    console.log("\n✅ Selesai! Refresh browser Anda.");
});
