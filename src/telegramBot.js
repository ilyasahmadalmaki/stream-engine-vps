const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const fs = require('fs'); // Tambahan untuk hapus file
const { getSystemStats } = require('./systemStats');

let bot = null;
let adminChatId = process.env.TELEGRAM_CHAT_ID;
let streamManagerRef = null;

const init = (token, manager) => {
    if (!token) return console.log('[TELEGRAM] Token kosong.');
    
    streamManagerRef = manager;
    bot = new TelegramBot(token, { polling: true });
    console.log('[TELEGRAM] Bot V2 (Gallery & Delete) Started...');

    // --- MENU PERMANEN ---
    bot.setMyCommands([
        { command: '/dashboard', description: '🎛 Kontrol Stream' },
        { command: '/gallery', description: '📂 Manajer Video' },
        { command: '/status', description: '📊 Cek Server' }
    ]);

    // --- COMMAND: /start ---
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        if (!adminChatId) {
            adminChatId = chatId;
            bot.sendMessage(chatId, `✅ **Admin Terdaftar!**\nID: \`${chatId}\``);
        } else if (chatId.toString() !== adminChatId.toString()) {
            bot.sendMessage(chatId, "⛔ Akses Ditolak.");
        } else {
            showMainMenu(chatId);
        }
    });

    // --- COMMAND HANDLERS ---
    bot.onText(/\/dashboard/, (msg) => { if(isAdmin(msg)) sendDashboard(msg.chat.id); });
    bot.onText(/\/status/, (msg) => { if(isAdmin(msg)) sendSystemStatus(msg.chat.id); });
    bot.onText(/\/gallery/, (msg) => { if(isAdmin(msg)) sendGallery(msg.chat.id); });

    // --- CALLBACK QUERY (HANDLER TOMBOL) ---
    bot.on('callback_query', async (query) => {
        if (query.from.id.toString() !== adminChatId?.toString()) return;

        const data = query.data;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;

        // --- NAVIGASI ---
        if (data === 'REFRESH_DASHBOARD') {
            bot.deleteMessage(chatId, messageId).catch(()=>{});
            sendDashboard(chatId);
        }
        else if (data === 'REFRESH_GALLERY') {
            bot.deleteMessage(chatId, messageId).catch(()=>{});
            sendGallery(chatId);
        }
        else if (data === 'REFRESH_STATUS') {
            const stats = await getSystemStats();
            const text = `🖥 **SYSTEM STATUS**\nLast: ${new Date().toLocaleTimeString()}\n\nCPU: ${stats.cpu}%\nRAM: ${stats.ram}\nDisk: ${stats.disk.percent} (${stats.disk.used}/${stats.disk.total})`;
            bot.editMessageText(text, {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '🔄 Refresh', callback_data: 'REFRESH_STATUS' }]] }
            }).catch(()=>{});
        }

        // --- LOGIKA STREAM (START/STOP/DELETE) ---
        else if (data.startsWith('START_')) {
            const id = data.split('_')[1];
            db.get("SELECT s.*, v.file_path FROM streams s LEFT JOIN videos v ON s.video_id = v.id WHERE s.id = ?", [id], (err, stream) => {
                if (stream) {
                    streamManagerRef.startStreamProcess(stream, stream.file_path);
                    db.run("UPDATE streams SET status='live', is_manual_run=1 WHERE id=?", [id], () => {
                        bot.answerCallbackQuery(query.id, { text: `🚀 ${stream.title} ON!` });
                        setTimeout(() => sendDashboard(chatId), 1000);
                    });
                } else bot.answerCallbackQuery(query.id, { text: 'Stream tidak ditemukan' });
            });
        }
        else if (data.startsWith('STOP_')) {
            const id = data.split('_')[1];
            streamManagerRef.stopStreamProcess(id, true);
            db.run("UPDATE streams SET status='scheduled', is_manual_run=0 WHERE id=?", [id], () => {
                bot.answerCallbackQuery(query.id, { text: `🛑 Stream OFF.` });
                setTimeout(() => sendDashboard(chatId), 1000);
            });
        }
        
        // KONFIRMASI HAPUS STREAM
        else if (data.startsWith('ASK_DEL_STR_')) {
            const id = data.split('_')[3];
            bot.editMessageText(`⚠️ **Yakin Hapus Jadwal ID ${id}?**\nIni tidak bisa dibatalkan.`, {
                chat_id: chatId, message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ YA, HAPUS', callback_data: `EXEC_DEL_STR_${id}` }],
                        [{ text: '❌ BATAL', callback_data: 'REFRESH_DASHBOARD' }]
                    ]
                }
            });
        }
        // EKSEKUSI HAPUS STREAM
        else if (data.startsWith('EXEC_DEL_STR_')) {
            const id = data.split('_')[3];
            streamManagerRef.stopStreamProcess(id); // Matikan dulu kalau hidup
            db.run("DELETE FROM streams WHERE id = ?", [id], () => {
                bot.answerCallbackQuery(query.id, { text: 'Jadwal dihapus.' });
                sendDashboard(chatId); // Balik ke dashboard
            });
        }

        // --- LOGIKA VIDEO (DELETE) ---
        
        // KONFIRMASI HAPUS VIDEO
        else if (data.startsWith('ASK_DEL_VID_')) {
            const id = data.split('_')[3];
            db.get("SELECT title FROM videos WHERE id=?", [id], (err, vid) => {
                if(!vid) return bot.answerCallbackQuery(query.id, {text:'Video hilang'});
                bot.editMessageText(`⚠️ **Hapus File Video?**\n\nJudul: ${vid.title}\n\nFile fisik di server akan dihapus permanen.`, {
                    chat_id: chatId, message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🗑 YA, HAPUS PERMANEN', callback_data: `EXEC_DEL_VID_${id}` }],
                            [{ text: '❌ BATAL', callback_data: 'REFRESH_GALLERY' }]
                        ]
                    }
                });
            });
        }
        // EKSEKUSI HAPUS VIDEO
        else if (data.startsWith('EXEC_DEL_VID_')) {
            const id = data.split('_')[3];
            db.get("SELECT file_path, thumbnail_path FROM videos WHERE id = ?", [id], (err, row) => {
                if (row) {
                    if (fs.existsSync(row.file_path)) fs.unlinkSync(row.file_path);
                    if (row.thumbnail_path && fs.existsSync(row.thumbnail_path)) fs.unlinkSync(row.thumbnail_path);
                    db.run("DELETE FROM videos WHERE id = ?", [id], () => {
                        bot.answerCallbackQuery(query.id, { text: 'File video dihapus.' });
                        sendGallery(chatId);
                    });
                } else {
                    bot.answerCallbackQuery(query.id, { text: 'Data tidak ditemukan.' });
                    sendGallery(chatId);
                }
            });
        }
    });
};

// --- HELPERS & UI BUILDERS ---

function isAdmin(msg) { return msg.chat.id.toString() === adminChatId?.toString(); }

function showMainMenu(chatId) {
    bot.sendMessage(chatId, "👋 **StreamEngine PRO**\nPilih menu di bawah:", {
        reply_markup: {
            keyboard: [[{ text: "/dashboard" }, { text: "/gallery" }], [{ text: "/status" }]],
            resize_keyboard: true
        }
    });
}

function sendSystemStatus(chatId) {
    getSystemStats().then(stats => {
        const text = `🖥 **SYSTEM STATUS**\n\nCPU: ${stats.cpu}%\nRAM: ${stats.ram}\nDisk: ${stats.disk.percent} (${stats.disk.used}/${stats.disk.total})`;
        bot.sendMessage(chatId, text, {
            reply_markup: { inline_keyboard: [[{ text: '🔄 Refresh', callback_data: 'REFRESH_STATUS' }]] }
        });
    });
}

function sendDashboard(chatId) {
    db.all("SELECT id, title, status, schedule_type FROM streams ORDER BY status DESC", [], (err, rows) => {
        if (!rows || rows.length === 0) return bot.sendMessage(chatId, "📭 Belum ada jadwal stream.");

        let keyboard = [];
        rows.forEach(r => {
            const isLive = r.status === 'live';
            const icon = isLive ? '🟢' : '⚫';
            
            // Baris Info
            keyboard.push([{ text: `${icon} ${r.title} (${r.schedule_type})`, callback_data: 'IGNORE' }]);
            
            // Baris Tombol (Start/Stop + Hapus)
            let btnAction = isLive 
                ? { text: '⏹ STOP', callback_data: `STOP_${r.id}` }
                : { text: '▶ START', callback_data: `START_${r.id}` };
                
            keyboard.push([
                btnAction,
                { text: '🗑 Hapus', callback_data: `ASK_DEL_STR_${r.id}` }
            ]);
        });
        
        keyboard.push([{ text: '🔄 Refresh Dashboard', callback_data: 'REFRESH_DASHBOARD' }]);

        bot.sendMessage(chatId, "🎛 **STREAM DASHBOARD**\nKlik tombol untuk aksi:", {
            reply_markup: { inline_keyboard: keyboard }
        });
    });
}

function sendGallery(chatId) {
    db.all("SELECT id, title, file_size FROM videos ORDER BY id DESC LIMIT 10", [], (err, rows) => {
        if (!rows || rows.length === 0) return bot.sendMessage(chatId, "📭 Galeri Kosong. Upload dulu via Web.");

        let keyboard = [];
        rows.forEach(r => {
            const sizeMB = (r.file_size / 1024 / 1024).toFixed(1);
            // Tombol 1 Baris per Video: [ Judul (50MB) 🗑 ]
            keyboard.push([
                { text: `🎬 ${r.title.substring(0, 20)}.. (${sizeMB}MB)`, callback_data: 'IGNORE' },
                { text: '🗑', callback_data: `ASK_DEL_VID_${r.id}` }
            ]);
        });

        keyboard.push([{ text: '🔄 Refresh Galeri', callback_data: 'REFRESH_GALLERY' }]);

        bot.sendMessage(chatId, "📂 **VIDEO GALLERY (10 Terbar)**\nKlik tong sampah untuk hapus file.", {
            reply_markup: { inline_keyboard: keyboard }
        });
    });
}

const notify = (message) => {
    if (bot && adminChatId) bot.sendMessage(adminChatId, message).catch(() => {});
};

module.exports = { init, notify };
