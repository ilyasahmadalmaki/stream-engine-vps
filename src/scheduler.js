const cron = require('node-cron');
const db = require('./db');
const streamManager = require('./streamManager');

const runScheduler = () => {
    // Jalankan pengecekan setiap 1 menit
    cron.schedule('* * * * *', () => {
        console.log('--- Scheduler Tick ---');
        const now = new Date();

        // Ambil stream yang statusnya BUKAN offline
        db.all("SELECT * FROM streams WHERE status != 'offline'", [], (err, streams) => {
            if (err) return console.error("[SCHEDULER DB ERROR]", err);
            if (!streams) return;

            streams.forEach(stream => {
                const start = new Date(stream.next_start_time);
                const end = new Date(stream.next_end_time);

                // ===============================================
                // LOGIKA 1: WAKTUNYA MULAI (START)
                // ===============================================
                if (now >= start && now < end) {
                    if (stream.status !== 'live') {
                        db.get("SELECT file_path FROM videos WHERE id = ?", [stream.video_id], (err, video) => {
                            if (video && video.file_path) {
                                // Cek agar tidak double start
                                if (!streamManager.isRunning(stream.id)) {
                                    console.log(`[SCHEDULER] Auto-Starting: ${stream.title}`);
                                    streamManager.startStreamProcess(stream, video.file_path);
                                    
                                    // Update status jadi live
                                    db.run("UPDATE streams SET status = 'live' WHERE id = ?", [stream.id]);
                                }
                            } else {
                                console.error(`[SCHEDULER] Gagal start ${stream.title}: File video hilang.`);
                            }
                        });
                    }
                } 
                
                // ===============================================
                // LOGIKA 2: WAKTUNYA BERHENTI (STOP & RESCHEDULE)
                // ===============================================
                else if (now >= end) {
                    
                    if (stream.schedule_type === 'daily') {
                        // --- DAILY MODE (Harian) ---
                        
                        // 1. Matikan Stream (Silent Stop = True)
                        // Agar status di DB tidak berubah jadi 'offline' oleh streamManager
                        if (streamManager.isRunning(stream.id)) {
                            console.log(`[SCHEDULER] Stopping Daily Stream (Rescheduling...)`);
                            streamManager.stopStreamProcess(stream.id, true);
                        }

                        // 2. Hitung Jadwal Berikutnya (Smart Midnight Logic)
                        const timeParts = stream.daily_start_time.split(':');
                        const targetHour = parseInt(timeParts[0]);
                        const targetMinute = parseInt(timeParts[1]);

                        // Mulai hitung dari "Sekarang"
                        const nextStart = new Date(now); 
                        nextStart.setHours(targetHour, targetMinute, 0, 0);

                        // LOGIKA PINTAR:
                        // Kasus: Sekarang jam 00:30, Jadwal jam 23:30.
                        // 00:30 < 23:30? YA. Berarti jadwalnya HARI INI (Nanti malam).
                        // Kasus: Sekarang jam 09:00, Jadwal jam 08:00.
                        // 09:00 < 08:00? TIDAK. Berarti jadwalnya BESOK.
                        
                        if (now < nextStart) {
                            console.log(`[SCHEDULER] Next run is TODAY at ${stream.daily_start_time}`);
                            // Tanggal tetap hari ini
                        } else {
                            console.log(`[SCHEDULER] Next run is TOMORROW at ${stream.daily_start_time}`);
                            nextStart.setDate(nextStart.getDate() + 1); // Tambah 1 hari
                        }

                        // Hitung Waktu Selesai (End Time) Baru
                        const durationMinutes = parseInt(stream.daily_duration_minutes) || 0;
                        const nextEnd = new Date(nextStart);
                        nextEnd.setMinutes(nextEnd.getMinutes() + durationMinutes);

                        // Update DB: Set waktu baru & status 'scheduled'
                        db.run("UPDATE streams SET next_start_time = ?, next_end_time = ?, status = 'scheduled' WHERE id = ?",
                            [nextStart.toISOString(), nextEnd.toISOString(), stream.id]);
                    
                    } else {
                        // --- ONCE MODE (Sekali Jalan) ---
                        if (streamManager.isRunning(stream.id)) {
                            console.log(`[SCHEDULER] Stopping Once Stream`);
                            streamManager.stopStreamProcess(stream.id, false); 
                        }
                        // Kembalikan ke 'scheduled' (bukan offline) agar user bisa start manual lagi kapan saja
                        db.run("UPDATE streams SET status = 'scheduled' WHERE id = ?", [stream.id]);
                    }
                }
            });
        });
    });
};

module.exports = { runScheduler };
