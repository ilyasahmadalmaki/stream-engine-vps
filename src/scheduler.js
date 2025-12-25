const db = require('./db');
const streamManager = require('./streamManager');

// Helper: Tambah Jam ke Date
function addHours(date, hours) {
    return new Date(date.getTime() + (hours * 60 * 60 * 1000));
}

// Helper: Set waktu spesifik untuk "Besok"
function getTomorrowAt(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(hours, minutes, 0, 0);
    return tomorrow;
}

const runScheduler = () => {
    console.log('--- Scheduler Tick ---');
    const now = new Date();

    db.all(`SELECT s.*, v.file_path FROM streams s LEFT JOIN videos v ON s.video_id = v.id`, [], (err, streams) => {
        if (err) return console.error(err);

        streams.forEach(stream => {
            const nextStart = new Date(stream.next_start_time);
            const nextEnd = new Date(stream.next_end_time);

            // 1. LOGIKA START
            if (stream.status === 'scheduled' && now >= nextStart && now < nextEnd) {
                console.log(`[SCHEDULER] Starting Stream ${stream.title}`);
                streamManager.startStreamProcess(stream, stream.file_path);
                
                db.run("UPDATE streams SET status = 'live' WHERE id = ?", [stream.id]);
            }

            // 1.b LOGIKA RECOVERY (Jika app restart saat harusnya live)
            if (stream.status === 'live') {
                if (!streamManager.isRunning(stream.id)) {
                     // Cek apakah masih dalam rentang waktu live
                     if (now < nextEnd) {
                        console.log(`[SCHEDULER] Recovering Stream ${stream.title}`);
                        streamManager.startStreamProcess(stream, stream.file_path);
                     } else {
                        // Waktunya sudah lewat, paksa stop
                        db.run("UPDATE streams SET status = 'offline' WHERE id = ?", [stream.id]);
                     }
                }
            }

            // 2. LOGIKA STOP
            if (stream.status === 'live' && now >= nextEnd) {
                console.log(`[SCHEDULER] Stopping Stream ${stream.title}`);
                streamManager.stopStreamProcess(stream.id);

                // 3. LOGIKA RESCHEDULE (DAILY ONLY)
                if (stream.schedule_type === 'daily') {
                    const nextDayStart = getTomorrowAt(stream.daily_start_time);
                    const nextDayEnd = addHours(nextDayStart, stream.daily_duration_hours);
                    
                    console.log(`[SCHEDULER] Rescheduling Daily Stream ${stream.title} to ${nextDayStart}`);

                    db.run(`UPDATE streams SET 
                        status = 'scheduled', 
                        next_start_time = ?, 
                        next_end_time = ? 
                        WHERE id = ?`, 
                        [nextDayStart.toISOString(), nextDayEnd.toISOString(), stream.id]
                    );
                } else {
                    // Mode ONCE
                    db.run("UPDATE streams SET status = 'offline' WHERE id = ?", [stream.id]);
                }
            }
        });
    });
};

// Jalankan interval 30 detik
setInterval(runScheduler, 30000);

module.exports = { runScheduler };