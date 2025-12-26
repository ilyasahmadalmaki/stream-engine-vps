const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const fs = require('fs');
const { getSystemStats } = require('./systemStats');

let bot = null;
let adminChatId = null;
let streamManagerRef = null;

// STATE MANAGEMENT
const userStates = {};

const init = (token, manager) => {
    if (!token) return console.log('[TELEGRAM] Token kosong.');
    adminChatId = process.env.TELEGRAM_CHAT_ID;
    streamManagerRef = manager;
    bot = new TelegramBot(token, { polling: true });
    console.log('[TELEGRAM] Bot Started...');

    // SET MENU SLASH (Yang muncul kalau ketik /)
    bot.setMyCommands([
        { command: '/start', description: '🏠 Reset Menu' },
        { command: '/add', description: '➕ Tambah Stream' },
        { command: '/dashboard', description: '🎛 Dashboard' }
    ]).catch(()=>{});

    // --- COMMAND: /start ---
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        if (!adminChatId) adminChatId = chatId;
        
        // Reset state wizard jika ada
        delete userStates[chatId];
        
        // TAMPILKAN MENU BAWAH YANG BARU
        showMainMenu(chatId);
    });

    bot.onText(/\/cancel/, (msg) => {
        delete userStates[msg.chat.id];
        bot.sendMessage(msg.chat.id, "❌ Batal.");
        showMainMenu(msg.chat.id);
    });

    // --- HANDLER PESAN TEKS (UTAMA) ---
    // Ini yang menangkap pencetan tombol keyboard
    bot.on('message', (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        
        if (!text || !isAdmin(msg)) return;

        // --- 1. DETEKSI TOMBOL MENU UTAMA ---
        
        // Tombol Status
        if (text === "📊 Cek Status" || text === "/status") {
            return sendSystemStatus(chatId);
        }
        // Tombol Dashboard
        else if (text === "🎛 Dashboard" || text === "/dashboard") {
            return sendDashboard(chatId);
        }
        // Tombol Gallery
        else if (text === "📂 Galeri Video" || text === "/gallery") {
            return sendGallery(chatId);
        }
        // Tombol Add
        else if (text === "➕ Tambah Stream" || text === "/add") {
            userStates[chatId] = { step: 'WAITING_TITLE', temp: {} };
            return bot.sendMessage(chatId, "📝 **SETUP STREAM BARU**\n\n1️⃣ Ketik **Judul Stream**:\n(/cancel untuk batal)");
        }

        // --- 2. LOGIKA WIZARD (INPUT DATA) ---
        const state = userStates[chatId];
        if (!state) return; // Kalau bukan perintah tombol & bukan wizard, abaikan

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
        // STEP 4: WAKTU (INPUT MANUAL)
        else if (state.step === 'WAITING_TIME') {
            handleTimeInput(chatId, text, state);
        }
    });

    // --- HANDLER TOMBOL CALLBACK (KLIK DI CHAT) ---
    bot.on('callback_query', async (query) => {
        if (!isAdmin(query.message)) return;
        const data = query.data;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;

        try {
            // NAVIGASI REFRESH
            if (data === 'REFRESH_DASHBOARD') { bot.deleteMessage(chatId, messageId).catch(()=>{}); sendDashboard(chatId); }
            else if (data === 'REFRESH_GALLERY') { bot.deleteMessage(chatId, messageId).catch(()=>{}); sendGallery(chatId); }
            else if (data === 'REFRESH_STATUS') { 
                // Efek loading
                bot.answerCallbackQuery(query.id, { text: 'Mengambil data...' });
                const stats = await getSystemStats();
                const cpu = stats.cpu || 0;
                const ram = stats.ram || '0/0';
                const disk = stats.disk ? `${stats.disk.percent} (${stats.disk.used}/${stats.disk.total})` : '?';
                
                const t = `🖥 **SYSTEM STATUS**\nLast Update: ${new Date().toLocaleTimeString('id-ID')}\n\n🧠 CPU: ${cpu}%\n💾 RAM: ${ram}\n💿 Disk: ${disk}`;
                
                bot.editMessageText(t, { chatId, messageId, reply_markup: { inline_keyboard: [[{ text: '🔄 Refresh Data', callback_data: 'REFRESH_STATUS' }]] } }).catch(()=>{});
            }
            
            // WIZARD
            else if (data === 'CANCEL_WIZARD') {
                delete userStates[chatId];
                bot.deleteMessage(chatId, messageId).catch(()=>{});
                bot.sendMessage(chatId, "❌ Batal.");
            }
            else if (data.startsWith('SEL_VID_')) {
                const state = userStates[chatId];
                if (!state || state.step !== 'WAITING_VIDEO') return;
                state.temp.videoId = data.split('_')[2];
                state.step = 'WAITING_TYPE';
                bot.editMessageText("✅ Video Dipilih.\n\n4️⃣ **Mau dijalankan kapan?**", {
                    chat_id: chatId, message_id: messageId,
                    reply_markup: { inline_keyboard: [
                        [{ text: '🎛 MANUAL (Start Sendiri)', callback_data: 'TYPE_MANUAL' }],
                        [{ text: '🔁 HARIAN (Jam Tertentu)', callback_data: 'TYPE_DAILY' }],
                        [{ text: '📅 SEKALI (Tanggal Tertentu)', callback_data: 'TYPE_ONCE' }],
                        [{ text: '❌ Batal', callback_data: 'CANCEL_WIZARD' }]
                    ]}
                });
            }
            else if (data.startsWith('TYPE_')) {
                const state = userStates[chatId];
                if (!state || state.step !== 'WAITING_TYPE') return;
                const type = data.split('_')[1].toLowerCase();
                state.temp.scheduleType = type;

                if (type === 'manual') {
                    saveStreamToDb(chatId, state.temp);
                } else if (type === 'daily') {
                    state.step = 'WAITING_TIME';
                    bot.editMessageText("🔁 **Jadwal Harian**\n\nKetik jam mulai (Format 24 Jam):\nContoh: `18:30`", { chat_id: chatId, message_id: messageId });
                } else if (type === 'once') {
                    state.step = 'WAITING_TIME';
                    bot.editMessageText("📅 **Jadwal Sekali**\n\nKetik Tanggal & Jam:\nFormat: `YYYY-MM-DD HH:MM`\nContoh: `2024-12-31 23:59`", { chat_id: chatId, message_id: messageId });
                }
            }

            // ACTIONS
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
            // DELETE
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

// --- LOGIC TAMBAHAN ---

function handleTimeInput(chatId, text, state) {
    const type = state.temp.scheduleType;
    let startSql=null, endSql=null, dailySql=null, nextStart=null, nextEnd=null;
    const durationMinutes = 120; // Default 2 jam

    try {
        if (type === 'daily') {
            if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(text.trim())) return bot.sendMessage(chatId, "❌ Format salah. Gunakan HH:MM (Cth: 18:30)");
            dailySql = text.trim();
            const [h, m] = dailySql.split(':');
            const d = new Date(); d.setHours(h,m,0,0);
            if(d<new Date()) d.setDate(d.getDate()+1);
            nextStart=d.toISOString();
        } else if (type === 'once') {
            const d = new Date(text.trim());
            if (isNaN(d.getTime())) return bot.sendMessage(chatId, "❌ Format salah. Gunakan YYYY-MM-DD HH:MM");
            if (d < new Date()) return bot.sendMessage(chatId, "❌ Waktu sudah lewat.");
            startSql = d.toISOString(); nextStart = startSql;
        }

        saveStreamToDb(chatId, state.temp, {startSql, endSql, dailySql, nextStart, durationMinutes});

    } catch (e) { bot.sendMessage(chatId, "Error: "+e.message); }
}

function saveStreamToDb(chatId, temp, timeData={}) {
    const { title, key, videoId, scheduleType } = temp;
    const { startSql, dailySql, nextStart, durationMinutes } = timeData;
    
    // Hitung nextEnd sederhana
    let nextEnd = null;
    if(nextStart) {
        const d = new Date(nextStart);
        d.setMinutes(d.getMinutes() + (durationMinutes || 120));
        nextEnd = d.toISOString();
    }

    db.run(`INSERT INTO streams 
        (title, rtmp_url, stream_key, video_id, schedule_type, start_time, daily_start_time, daily_duration_minutes, next_start_time, next_end_time, status, is_manual_run) 
        VALUES (?, 'rtmp://a.rtmp.youtube.com/live2', ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 0)`,
        [title, key, videoId, scheduleType, startSql, dailySql, durationMinutes, nextStart, nextEnd],
        (err) => {
            delete userStates[chatId];
            if (err) bot.sendMessage(chatId, `❌ DB Error: ${err.message}`);
            else {
                bot.sendMessage(chatId, `✅ **SUKSES!**\nStream "${title}" (${scheduleType}) tersimpan.`);
                setTimeout(() => sendDashboard(chatId), 1000);
            }
        }
    );
}

function isAdmin(msg) { return msg.chat && adminChatId && msg.chat.id.toString() === adminChatId.toString(); }

function showMainMenu(chatId) {
    bot.sendMessage(chatId, "🎛 **MENU UTAMA**", {
        reply_markup: {
            // LABEL TOMBOL KITA UBAH BIAR JELAS
            keyboard: [
                [{ text: "➕ Tambah Stream" }], 
                [{ text: "🎛 Dashboard" }, { text: "📂 Galeri Video" }],
                [{ text: "📊 Cek Status" }]
            ],
            resize_keyboard: true
        }
    });
}

function sendSystemStatus(chatId) {
    bot.sendChatAction(chatId, 'typing'); // Efek ngetik
    getSystemStats().then(stats => {
        const cpu = stats.cpu || 0;
        const ram = stats.ram || '0/0';
        const disk = stats.disk ? `${stats.disk.percent} (${stats.disk.used}/${stats.disk.total})` : '?';
        const text = `🖥 **SYSTEM STATUS**\n\n🧠 CPU: ${cpu}%\n💾 RAM: ${ram}\n💿 Disk: ${disk}`;
        bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: [[{ text: '🔄 Refresh Data', callback_data: 'REFRESH_STATUS' }]] }});
    }).catch(e => bot.sendMessage(chatId, "Gagal baca status: "+e.message));
}

const notify = (msg) => { if (bot && adminChatId) bot.sendMessage(adminChatId, msg).catch(()=>{}); };
module.exports = { init, notify };
