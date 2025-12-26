const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const fs = require('fs');
const { getSystemStats } = require('./systemStats');

let bot = null;
let adminChatId = null;
let streamManagerRef = null;

// STATE MANAGEMENT
// step: WAITING_TITLE -> WAITING_KEY -> WAITING_VIDEO -> WAITING_TYPE -> WAITING_TIME
const userStates = {};

const init = (token, manager) => {
    if (!token) return console.log('[TELEGRAM] Token kosong.');
    adminChatId = process.env.TELEGRAM_CHAT_ID;
    streamManagerRef = manager;
    bot = new TelegramBot(token, { polling: true });
    console.log('[TELEGRAM] Bot V4 (Schedule Support) Started...');

    bot.setMyCommands([
        { command: '/start', description: '🏠 Menu Utama' },
        { command: '/add', description: '➕ Tambah Stream' },
        { command: '/cancel', description: '❌ Batal' }
    ]).catch(()=>{});

    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        if (!adminChatId) adminChatId = chatId;
        delete userStates[chatId];
        showMainMenu(chatId);
    });

    bot.onText(/\/cancel/, (msg) => {
        delete userStates[msg.chat.id];
        bot.sendMessage(msg.chat.id, "❌ Proses dibatalkan.");
        showMainMenu(msg.chat.id);
    });

    // --- HANDLER PESAN TEKS (INPUT USER) ---
    bot.on('message', (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        if (!text || !isAdmin(msg)) return;

        // 1. CEK MENU UTAMA
        if (text === "➕ Add Stream" || text === "/add") {
            userStates[chatId] = { step: 'WAITING_TITLE', temp: {} };
            return bot.sendMessage(chatId, "📝 **SETUP STREAM BARU**\n\n1️⃣ Ketik **Judul Stream**:\n(/cancel untuk batal)");
        }
        else if (text === "/dashboard" || text.includes("Dashboard")) return sendDashboard(chatId);
        else if (text === "/gallery" || text.includes("Gallery")) return sendGallery(chatId);
        else if (text === "/status" || text.includes("Status")) return sendSystemStatus(chatId);

        // 2. CEK PROSES WIZARD
        const state = userStates[chatId];
        if (!state) return;

        // STEP 1: JUDUL
        if (state.step === 'WAITING_TITLE') {
            state.temp.title = text;
            state.step = 'WAITING_KEY';
            bot.sendMessage(chatId, `✅ Judul: **${text}**\n\n2️⃣ Ketik/Paste **Stream Key**:`);
        }
        // STEP 2: KEY
        else if (state.step === 'WAITING_KEY') {
            state.temp.key = text;
            state.step = 'WAITING_VIDEO';
            
            db.all("SELECT id, title FROM videos ORDER BY id DESC LIMIT 10", [], (err, rows) => {
                if (!rows || rows.length === 0) {
                    delete userStates[chatId];
                    return bot.sendMessage(chatId, "❌ Galeri kosong. Upload video dulu via Web.");
                }
                let keyboard = [];
                rows.forEach(r => {
                    keyboard.push([{ text: `🎬 ${r.title}`, callback_data: `SEL_VID_${r.id}` }]);
                });
                keyboard.push([{ text: '❌ Batal', callback_data: 'CANCEL_WIZARD' }]);
                bot.sendMessage(chatId, "✅ Key Oke.\n\n3️⃣ **Pilih Video:**", { reply_markup: { inline_keyboard: keyboard } });
            });
        }
        // STEP 4: WAKTU (JIKA PILIH HARIAN/SEKALI)
        else if (state.step === 'WAITING_TIME') {
            const timeInput = text.trim();
            const type = state.temp.scheduleType; // 'daily' atau 'once'

            let startSql = null;
            let endSql = null;
            let dailySql = null;
            let nextStart = null;
            let nextEnd = null;

            // --- LOGIKA HITUNG WAKTU ---
            try {
                // Ambil durasi video dulu dari DB untuk estimasi end_time
                const vidId = state.temp.videoId;
                // Kita defaultkan durasi 2 jam dulu karena bot tidak tau durasi asli video tanpa ffprobe rumit
                // Atau biarkan logic server yang handle next loop.
                const durationMinutes = 120; // Default 2 jam

                if (type === 'daily') {
                    // Validasi Format HH:MM
                    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(timeInput)) {
                        return bot.sendMessage(chatId, "❌ Format Salah!\nGunakan format 24 jam: `HH:MM`\nContoh: `18:30`");
                    }
                    
                    dailySql = timeInput;
                    const [h, m] = timeInput.split(':');
                    const now = new Date();
                    const d = new Date();
                    d.setHours(h, m, 0, 0);
                    if (d < now) d.setDate(d.getDate() + 1); // Besok kalau jam sudah lewat
                    
                    nextStart = d.toISOString();
                    const endD = new Date(d);
                    endD.setMinutes(endD.getMinutes() + durationMinutes);
                    nextEnd = endD.toISOString();

                } else if (type === 'once') {
                    // Validasi Format YYYY-MM-DD HH:MM
                    // Kita coba parse pakai Date()
                    const d = new Date(timeInput);
                    if (isNaN(d.getTime())) {
                        return bot.sendMessage(chatId, "❌ Format Salah!\nGunakan: `YYYY-MM-DD HH:MM`\nContoh: `2024-12-31 23:00`");
                    }
                    
                    if (d < new Date()) {
                        return bot.sendMessage(chatId, "❌ Waktu sudah lewat! Masukkan waktu masa depan.");
                    }

                    startSql = d.toISOString();
                    nextStart = startSql;
                    const endD = new Date(d);
                    endD.setMinutes(endD.getMinutes() + durationMinutes);
                    endSql = endD.toISOString();
                    nextEnd = endSql;
                }

                // SIMPAN KE DB
                const { title, key } = state.temp;
                const rtmp = "rtmp://a.rtmp.youtube.com/live2";
                
                db.run(`INSERT INTO streams 
                    (title, rtmp_url, stream_key, video_id, schedule_type, start_time, end_time, daily_start_time, daily_duration_minutes, next_start_time, next_end_time, status, is_manual_run) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 0)`,
                    [title, rtmp, key, vidId, type, startSql, endSql, dailySql, durationMinutes, nextStart, nextEnd],
                    (err) => {
                        delete userStates[chatId];
                        if (err) bot.sendMessage(chatId, `❌ DB Error: ${err.message}`);
                        else {
                            bot.sendMessage(chatId, `✅ **Jadwal Tersimpan!**\n\nJudul: ${title}\nTipe: ${type.toUpperCase()}\nWaktu: ${timeInput}`);
                            setTimeout(() => sendDashboard(chatId), 1000);
                        }
                    }
                );

            } catch (e) {
                bot.sendMessage(chatId, `❌ Error: ${e.message}`);
            }
        }
    });

    // --- HANDLER TOMBOL CALLBACK ---
    bot.on('callback_query', async (query) => {
        if (!isAdmin(query.message)) return;
        const data = query.data;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;

        try {
            if (data === 'REFRESH_DASHBOARD') { bot.deleteMessage(chatId, messageId).catch(()=>{}); sendDashboard(chatId); }
            else if (data === 'REFRESH_GALLERY') { bot.deleteMessage(chatId, messageId).catch(()=>{}); sendGallery(chatId); }
            else if (data === 'REFRESH_STATUS') { 
                const stats = await getSystemStats();
                const t = `🖥 CPU: ${stats.cpu}% | RAM: ${stats.ram}`;
                bot.editMessageText(t, { chatId, messageId, reply_markup: { inline_keyboard: [[{ text: '🔄', callback_data: 'REFRESH_STATUS' }]] } }).catch(()=>{});
            }
            
            else if (data === 'CANCEL_WIZARD') {
                delete userStates[chatId];
                bot.deleteMessage(chatId, messageId).catch(()=>{});
                bot.sendMessage(chatId, "❌ Batal.");
            }

            // STEP 3: PILIH VIDEO -> LANJUT KE PILIH TIPE JADWAL
            else if (data.startsWith('SEL_VID_')) {
                const state = userStates[chatId];
                if (!state || state.step !== 'WAITING_VIDEO') return;

                state.temp.videoId = data.split('_')[2];
                state.step = 'WAITING_TYPE';

                // Tampilkan Pilihan Tipe Jadwal
                bot.editMessageText("✅ Video Dipilih.\n\n4️⃣ **Mau dijalankan kapan?**", {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🎛 MANUAL (Start Sendiri)', callback_data: 'TYPE_MANUAL' }],
                            [{ text: '🔁 HARIAN (Jam Tertentu)', callback_data: 'TYPE_DAILY' }],
                            [{ text: '📅 SEKALI (Tanggal Tertentu)', callback_data: 'TYPE_ONCE' }],
                            [{ text: '❌ Batal', callback_data: 'CANCEL_WIZARD' }]
                        ]
                    }
                });
            }

            // STEP 4: PILIH TIPE JADWAL
            else if (data.startsWith('TYPE_')) {
                const state = userStates[chatId];
                if (!state || state.step !== 'WAITING_TYPE') return;

                const type = data.split('_')[1].toLowerCase(); // manual, daily, once
                state.temp.scheduleType = type;

                if (type === 'manual') {
                    // LANGSUNG SIMPAN
                    const { title, key, videoId } = state.temp;
                    const rtmp = "rtmp://a.rtmp.youtube.com/live2";
                    db.run(`INSERT INTO streams (title, rtmp_url, stream_key, video_id, schedule_type, status, is_manual_run) VALUES (?, ?, ?, ?, 'manual', 'scheduled', 0)`,
                        [title, rtmp, key, videoId], (err) => {
                            delete userStates[chatId];
                            bot.deleteMessage(chatId, messageId).catch(()=>{});
                            if (err) bot.sendMessage(chatId, "❌ Gagal simpan DB");
                            else {
                                bot.sendMessage(chatId, `✅ **Sukses!**\nStream "${title}" (Manual) dibuat.`);
                                setTimeout(() => sendDashboard(chatId), 1000);
                            }
                        });
                } 
                else if (type === 'daily') {
                    // MINTA INPUT JAM
                    state.step = 'WAITING_TIME';
                    bot.editMessageText("🔁 **Jadwal Harian**\n\nKetik jam mulai (Format 24 Jam):\nContoh: `18:30` atau `07:00`", {
                        chat_id: chatId, message_id: messageId
                    });
                }
                else if (type === 'once') {
                    // MINTA INPUT TANGGAL
                    state.step = 'WAITING_TIME';
                    bot.editMessageText("📅 **Jadwal Sekali Jalan**\n\nKetik Tanggal & Jam:\nFormat: `YYYY-MM-DD HH:MM`\nContoh: `2024-12-31 23:59`", {
                        chat_id: chatId, message_id: messageId
                    });
                }
            }

            // ACTIONS START/STOP/DELETE (SAMA SEPERTI SEBELUMNYA)
            else if (data.startsWith('START_')) {
                const id = data.split('_')[1];
                db.get("SELECT s.*, v.file_path FROM streams s LEFT JOIN videos v ON s.video_id = v.id WHERE s.id=?", [id], (e,s)=>{
                    if(s && streamManagerRef) {
                        streamManagerRef.startStreamProcess(s, s.file_path);
                        db.run("UPDATE streams SET status='live', is_manual_run=1 WHERE id=?", [id], ()=>{
                            bot.answerCallbackQuery(query.id, {text:'ON!'}); setTimeout(()=>sendDashboard(chatId), 1000);
                        });
                    }
                });
            }
            else if (data.startsWith('STOP_')) {
                const id = data.split('_')[1];
                if(streamManagerRef) streamManagerRef.stopStreamProcess(id, true);
                db.run("UPDATE streams SET status='scheduled', is_manual_run=0 WHERE id=?", [id], ()=>{
                    bot.answerCallbackQuery(query.id, {text:'OFF.'}); setTimeout(()=>sendDashboard(chatId), 1000);
                });
            }
            else if (data.startsWith('ASK_DEL_STR_')) {
                bot.editMessageText(`Hapus Stream ID ${data.split('_')[3]}?`, {chat_id:chatId, message_id:messageId, reply_markup:{inline_keyboard:[[{text:'YA', callback_data:`EXEC_DEL_STR_${data.split('_')[3]}`},{text:'NO', callback_data:'REFRESH_DASHBOARD'}]]}});
            }
            else if (data.startsWith('EXEC_DEL_STR_')) {
                const id = data.split('_')[3]; if(streamManagerRef) streamManagerRef.stopStreamProcess(id);
                db.run("DELETE FROM streams WHERE id=?", [id], ()=>{ bot.answerCallbackQuery(query.id,{text:'Dihapus'}); sendDashboard(chatId); });
            }
            else if (data.startsWith('ASK_DEL_VID_')) {
                bot.editMessageText(`Hapus Video ID ${data.split('_')[3]}?`, {chat_id:chatId, message_id:messageId, reply_markup:{inline_keyboard:[[{text:'YA', callback_data:`EXEC_DEL_VID_${data.split('_')[3]}`},{text:'NO', callback_data:'REFRESH_GALLERY'}]]}});
            }
            else if (data.startsWith('EXEC_DEL_VID_')) {
                const id = data.split('_')[3];
                db.get("SELECT file_path, thumbnail_path FROM videos WHERE id=?", [id], (e,r)=>{
                    if(r){ if(fs.existsSync(r.file_path)) fs.unlinkSync(r.file_path); if(r.thumbnail_path && fs.existsSync(r.thumbnail_path)) fs.unlinkSync(r.thumbnail_path); }
                    db.run("DELETE FROM videos WHERE id=?", [id], ()=>{ bot.answerCallbackQuery(query.id,{text:'Dihapus'}); sendGallery(chatId); });
                });
            }

        } catch(e){}
    });
};

function isAdmin(msg) { return msg.chat && adminChatId && msg.chat.id.toString() === adminChatId.toString(); }

function showMainMenu(chatId) {
    bot.sendMessage(chatId, "🎛 **MENU UTAMA**", {
        reply_markup: {
            keyboard: [[{ text: "➕ Add Stream" }], [{ text: "/dashboard" }, { text: "/gallery" }], [{ text: "/status" }]],
            resize_keyboard: true
        }
    });
}

function sendDashboard(chatId) {
    db.all("SELECT id, title, status, schedule_type FROM streams ORDER BY status DESC", [], (e,r) => {
        if(!r || r.length===0) return bot.sendMessage(chatId, "📭 Kosong.");
        let k = [];
        r.forEach(x => {
            const live = x.status==='live';
            k.push([{ text: `${live?'🟢':'⚫'} ${x.title} (${x.schedule_type})`, callback_data:'IGN' }]);
            k.push([live?{text:'⏹ STOP', callback_data:`STOP_${x.id}`}:{text:'▶ START', callback_data:`START_${x.id}`}, {text:'🗑', callback_data:`ASK_DEL_STR_${x.id}`}]);
        });
        k.push([{text:'🔄 Refresh', callback_data:'REFRESH_DASHBOARD'}]);
        bot.sendMessage(chatId, "🎛 **DASHBOARD**", {reply_markup:{inline_keyboard:k}});
    });
}

function sendGallery(chatId) {
    db.all("SELECT id, title, file_size FROM videos ORDER BY id DESC LIMIT 10", [], (e,r)=>{
        if(!r || r.length===0) return bot.sendMessage(chatId, "📭 Kosong.");
        let k = [];
        r.forEach(x => {
            k.push([{text:`🎬 ${x.title.substring(0,15)}`, callback_data:'IGN'}, {text:'🗑', callback_data:`ASK_DEL_VID_${x.id}`}]);
        });
        k.push([{text:'🔄', callback_data:'REFRESH_GALLERY'}]);
        bot.sendMessage(chatId, "📂 **GALERI**", {reply_markup:{inline_keyboard:k}});
    });
}

const notify = (msg) => { if(bot && adminChatId) bot.sendMessage(adminChatId, msg).catch(()=>{}); };
module.exports = { init, notify };
