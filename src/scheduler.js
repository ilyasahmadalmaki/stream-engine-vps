const cron = require('node-cron');
const db = require('./db');
const streamManager = require('./streamManager');

const runScheduler = () => {
    cron.schedule('* * * * *', () => {
        console.log('--- Scheduler Tick (Health Check) ---');
        const now = new Date();

        db.all("SELECT * FROM streams WHERE status != 'offline'", [], (err, streams) => {
            if (err) return console.error("[SCHEDULER DB ERROR]", err);
            if (!streams) return;

            streams.forEach(stream => {
                
                // --- SPECIAL CHECK FOR MANUAL TYPE ---
                // Jika tipe stream adalah manual, Scheduler hanya boleh melakukan Auto-Heal (jika live mati).
                // Tapi tidak boleh melakukan Auto-Start (karena gak ada jadwal).
                if (stream.schedule_type === 'manual') {
                     // Auto-Heal Logic Only
                     if (stream.status === 'live') {
                         const isRunningReal = streamManager.isRunning(stream.id);
                         if (!isRunningReal) {
                             console.warn(`[DOCTOR] ⚠️ Manual Stream ID ${stream.id} mati mendadak! Restarting...`);
                             db.get("SELECT file_path FROM videos WHERE id = ?", [stream.video_id], (err, video) => {
                                 if (video) streamManager.startStreamProcess(stream, video.file_path);
                             });
                         }
                     }
                     return; // Skip sisa logika jadwal
                }

                // --- NORMAL SCHEDULER LOGIC (DAILY/ONCE) ---
                const start = new Date(stream.next_start_time);
                const end = new Date(stream.next_end_time);

                // FASE 1: START
                if (now >= start && now < end) {
                    db.get("SELECT file_path FROM videos WHERE id = ?", [stream.video_id], (err, video) => {
                        if (video && video.file_path) {
                            const isRunningReal = streamManager.isRunning(stream.id);
                            if (stream.status === 'live' && !isRunningReal) {
                                console.warn(`[DOCTOR] ⚠️ Stream ID ${stream.id} mati mendadak! Restarting...`);
                                streamManager.startStreamProcess(stream, video.file_path);
                            } else if (stream.status !== 'live' && !isRunningReal) {
                                console.log(`[SCHEDULER] Starting: ${stream.title}`);
                                streamManager.startStreamProcess(stream, video.file_path);
                                db.run("UPDATE streams SET status = 'live' WHERE id = ?", [stream.id]);
                            }
                        }
                    });
                } 
                
                // FASE 2: STOP
                else if (now >= end) {
                    
                    if (stream.is_manual_run === 1) {
                        console.log(`[SCHEDULER] Skipping Auto-Stop for ${stream.title} (Manual Override)`);
                        return; 
                    }

                    if (stream.schedule_type === 'daily') {
                        if (streamManager.isRunning(stream.id)) {
                            streamManager.stopStreamProcess(stream.id, true);
                        }
                        const timeParts = stream.daily_start_time.split(':');
                        const targetHour = parseInt(timeParts[0]);
                        const targetMinute = parseInt(timeParts[1]);
                        const nextStart = new Date(now); 
                        nextStart.setHours(targetHour, targetMinute, 0, 0);

                        if (now < nextStart) {} else { nextStart.setDate(nextStart.getDate() + 1); }
                        
                        const durationMinutes = parseInt(stream.daily_duration_minutes) || 0;
                        const nextEnd = new Date(nextStart);
                        nextEnd.setMinutes(nextEnd.getMinutes() + durationMinutes);

                        db.run("UPDATE streams SET next_start_time = ?, next_end_time = ?, status = 'scheduled' WHERE id = ?",
                            [nextStart.toISOString(), nextEnd.toISOString(), stream.id]);
                    
                    } else {
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
