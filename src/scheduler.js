const cron = require('node-cron');
const db = require('./db');
const streamManager = require('./streamManager');
const telegram = require('./telegramBot');

const runScheduler = () => {
    // Cek setiap menit
    cron.schedule('* * * * *', () => {
        const now = new Date();

        db.all("SELECT * FROM streams WHERE status != 'offline'", [], (err, streams) => {
            if (err || !streams) return;

            streams.forEach(stream => {
                const isRunningReal = streamManager.isRunning(stream.id);

                // --- 1. ZOMBIE KILLER (PENTING) ---
                // Kalau di DB status 'live', tapi aslinya tidak jalan -> Reset status
                if (stream.status === 'live' && !isRunningReal) {
                    console.log(`[SCHEDULER] 🧟 Zombie Stream detected (ID: ${stream.id}). Resetting status...`);
                    
                    // Jika tipe manual, set offline. Jika jadwal, kembalikan ke scheduled agar bisa di-heal
                    const newStatus = stream.schedule_type === 'manual' ? 'offline' : 'scheduled';
                    db.run("UPDATE streams SET status = ?, is_manual_run = 0 WHERE id = ?", [newStatus, stream.id]);
                    
                    // Skip iterasi ini, tunggu menit depan biar bersih
                    return;
                }

                // Cek Manual Mode Murni
                if (stream.schedule_type === 'manual') {
                     if (stream.status === 'live' && !isRunningReal) {
                         // Auto-heal khusus manual mode (jika diinginkan)
                         // logic ini sudah dihandle zombie killer di atas sebenarnya
                     }
                     return;
                }

                // --- LOGIKA JADWAL (Daily & Once) ---
                const start = new Date(stream.next_start_time);
                const end = new Date(stream.next_end_time);

                // FASE 1: WAKTUNYA START
                if (now >= start && now < end) {
                    db.get("SELECT file_path FROM videos WHERE id = ?", [stream.video_id], (err, video) => {
                        if (video && video.file_path) {
                            
                            // A. AUTO HEAL (Status Live, Process Mati -> Nyalakan)
                            // (Zombie killer di atas sudah handle status reset, jadi di sini kita start ulang)
                            if (stream.status !== 'live' && !isRunningReal) {
                                console.log(`[SCHEDULER] ⏰ Starting Scheduled Stream: ${stream.title}`);
                                streamManager.startStreamProcess(stream, video.file_path);
                                db.run("UPDATE streams SET status = 'live', is_manual_run = 0 WHERE id = ?", [stream.id]);
                            }
                        }
                    });
                } 
                
                // FASE 2: WAKTUNYA STOP (DURASI HABIS)
                else if (now >= end) {
                    // PERUBAHAN PENTING DI SINI:
                    // Dulu: if (stream.is_manual_run === 1) return;
                    // Sekarang: Kita HAPUS baris itu.
                    // Artinya: Walaupun Anda klik Start manual, kalau tipe jadwalnya 'Daily/Once' dan waktunya habis, DIA AKAN MATI.
                    
                    if (isRunningReal) {
                        console.log(`[SCHEDULER] 🛑 Stopping Scheduled Stream (Time's up): ${stream.title}`);
                        streamManager.stopStreamProcess(stream.id, true); // true = jangan ubah jadi offline dulu, biar logic bawah yg handle
                    }

                    // UPDATE WAKTU BERIKUTNYA
                    if (stream.schedule_type === 'daily') {
                        const timeParts = stream.daily_start_time.split(':');
                        const targetHour = parseInt(timeParts[0]);
                        const targetMinute = parseInt(timeParts[1]);
                        
                        // Hitung start besok
                        const nextStart = new Date(now); 
                        nextStart.setHours(targetHour, targetMinute, 0, 0);
                        if (nextStart <= now) nextStart.setDate(nextStart.getDate() + 1);
                        
                        const durationMinutes = parseInt(stream.daily_duration_minutes) || 0;
                        const nextEnd = new Date(nextStart);
                        nextEnd.setMinutes(nextEnd.getMinutes() + durationMinutes);

                        db.run("UPDATE streams SET next_start_time = ?, next_end_time = ?, status = 'scheduled', is_manual_run = 0 WHERE id = ?",
                            [nextStart.toISOString(), nextEnd.toISOString(), stream.id]);
                    
                    } else {
                        // Once: Matikan dan set offline/scheduled
                         db.run("UPDATE streams SET status = 'scheduled', is_manual_run = 0 WHERE id = ?", [stream.id]);
                    }
                }
            });
        });
    });
};

module.exports = { runScheduler };
