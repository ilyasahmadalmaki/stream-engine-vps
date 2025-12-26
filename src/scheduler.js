const cron = require('node-cron');
const db = require('./db');
const streamManager = require('./streamManager');

const runScheduler = () => {
    // Jalankan setiap 1 menit
    cron.schedule('* * * * *', () => {
        console.log('--- Scheduler Tick (Health Check) ---');
        const now = new Date();

        // Ambil SEMUA stream yang statusnya BUKAN offline
        // Termasuk yang statusnya 'live' juga kita cek (Dokter Jaga)
        db.all("SELECT * FROM streams WHERE status != 'offline'", [], (err, streams) => {
            if (err) return console.error("[SCHEDULER DB ERROR]", err);
            if (!streams) return;

            streams.forEach(stream => {
                const start = new Date(stream.next_start_time);
                const end = new Date(stream.next_end_time);

                // ===============================================
                // FASE 1: APAKAH SEKARANG WAKTUNYA LIVE?
                // ===============================================
                if (now >= start && now < end) {
                    
                    // Cek Video Path dulu
                    db.get("SELECT file_path FROM videos WHERE id = ?", [stream.video_id], (err, video) => {
                        if (video && video.file_path) {
                            
                            // === LOGIKA AUTO-HEAL (PERBAIKAN UTAMA) ===
                            // Cek apakah prosesnya BENAR-BENAR jalan di sistem?
                            const isRunningReal = streamManager.isRunning(stream.id);

                            if (stream.status === 'live' && !isRunningReal) {
                                // KASUS: Di DB 'Live', tapi Proses Mati (Crash/Kena Kill)
                                console.warn(`[DOCTOR] ⚠️ Stream ID ${stream.id} mati mendadak! Mencoba restart...`);
                                streamManager.startStreamProcess(stream, video.file_path);
                            
                            } else if (stream.status !== 'live' && !isRunningReal) {
                                // KASUS: Jadwalnya mulai, tapi belum jalan
                                console.log(`[SCHEDULER] Starting: ${stream.title}`);
                                streamManager.startStreamProcess(stream, video.file_path);
                                db.run("UPDATE streams SET status = 'live' WHERE id = ?", [stream.id]);
                            }

                        } else {
                            console.error(`[SCHEDULER] Gagal start ${stream.title}: File video hilang.`);
                        }
                    });
                } 
                
                // ===============================================
                // FASE 2: WAKTUNYA STOP / RESCHEDULE
                // ===============================================
                else if (now >= end) {
                    
                    if (stream.schedule_type === 'daily') {
                        // --- DAILY MODE ---
                        if (streamManager.isRunning(stream.id)) {
                            console.log(`[SCHEDULER] Stopping Daily Stream for Reschedule`);
                            streamManager.stopStreamProcess(stream.id, true); // Keep status true sementara
                        }

                        // Logika Midnight Crossing
                        const timeParts = stream.daily_start_time.split(':');
                        const targetHour = parseInt(timeParts[0]);
                        const targetMinute = parseInt(timeParts[1]);

                        const nextStart = new Date(now); 
                        nextStart.setHours(targetHour, targetMinute, 0, 0);

                        if (now < nextStart) {
                            // Jadwal hari ini
                        } else {
                            nextStart.setDate(nextStart.getDate() + 1); // Besok
                        }

                        const durationMinutes = parseInt(stream.daily_duration_minutes) || 0;
                        const nextEnd = new Date(nextStart);
                        nextEnd.setMinutes(nextEnd.getMinutes() + durationMinutes);

                        db.run("UPDATE streams SET next_start_time = ?, next_end_time = ?, status = 'scheduled' WHERE id = ?",
                            [nextStart.toISOString(), nextEnd.toISOString(), stream.id]);
                    
                    } else {
                        // --- ONCE MODE ---
                        if (streamManager.isRunning(stream.id)) {
                            streamManager.stopStreamProcess(stream.id, false); 
                        }
                        db.run("UPDATE streams SET status = 'scheduled' WHERE id = ?", [stream.id]);
                    }
                }
            });
        });
    });
};

module.exports = { runScheduler };
