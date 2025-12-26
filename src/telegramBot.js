const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const { getSystemStats } = require('./systemStats');

let bot = null;
let adminChatId = process.env.TELEGRAM_CHAT_ID;
let streamManagerRef = null;

const init = (token, manager) => {
    if (!token) return console.log('[TELEGRAM] Token kosong.');
    
    streamManagerRef = manager;
    bot = new TelegramBot(token, { polling: true });
    console.log('[TELEGRAM] Bot Modern UI Started...');

    // --- SETUP MENU PERMANEN (TOMBOL DI BAWAH KOLOM KETIK) ---
    bot.setMyCommands([
        { command: '/dashboard', description: '🎛 Buka Panel Kontrol' },
        { command: '/status', description: '📊 Cek Resource Server' }
    ]);

    // --- COMMAND: /start ---
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        if (!adminChatId) {
            adminChatId = chatId;
            bot.sendMessage(chatId, `✅ **Admin Terdaftar!**\nID: \`${chatId}\`\nSimpan ke .env ya!`);
        } else if (chatId.toString() !== adminChatId.toString()) {
            bot.sendMessage(chatId, "⛔ Akses Ditolak.");
        } else {
            bot.sendMessage(chatId, "👋 **Selamat Datang di StreamEngine PRO**\nTekan /dashboard untuk mulai mengontrol.", {
                reply_markup: {
                    keyboard: [[{ text: "/dashboard" }, { text: "/status" }]],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            });
        }
    });

    // --- COMMAND: /status (Dengan Tombol Refresh) ---
    bot.onText(/\/status/, async (msg) => {
        if (!isAdmin(msg)) return;
        sendSystemStatus(msg.chat.id);
    });

    // --- COMMAND: /dashboard (Menu Utama Stream) ---
    bot.onText(/\/dashboard/, (msg) => {
        if (!isAdmin(msg)) return;
        sendDashboard(msg.chat.id);
    });

    // --- HANDLER KLIK TOMBOL (CALLBACK QUERY) ---
    bot.on('callback_query', async (query) => {
        if (query.from.id.toString() !== adminChatId?.toString()) return;

        const data = query.data;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;

        // 1. REFRESH STATUS
        if (data === 'REFRESH_STATUS') {
            const stats = await getSystemStats();
            const text = `🖥 **SYSTEM STATUS**\nLast Update: ${new Date().toLocaleTimeString()}\n\nCPU: ${stats.cpu}%\nRAM: ${stats.ram}\nDisk: ${stats.disk.percent} (${stats.disk.used}/${stats.disk.total})`;
            
            // Edit pesan lama (biar ga nyepam)
            bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [[{ text: '🔄 Refresh Data', callback_data: 'REFRESH_STATUS' }]]
                }
            }).catch(() => {}); // Catch error kalau isi sama persis
            
            bot.answerCallbackQuery(query.id, { text: 'Data diperbarui!' });
        }

        // 2. REFRESH DASHBOARD
        else if (data === 'REFRESH_DASHBOARD') {
            bot.deleteMessage(chatId, messageId).catch(()=>{}); // Hapus menu lama
            sendDashboard(chatId); // Kirim menu baru
            bot.answerCallbackQuery(query.id);
        }

        // 3. START STREAM
        else if (data.startsWith('START_')) {
            const id = data.split('_')[1];
            db.get("SELECT s.*, v.file_path FROM streams s LEFT JOIN videos v ON s.video_id = v.id WHERE s.id = ?", [id], (err, stream) => {
                if (stream) {
                    streamManagerRef.startStreamProcess(stream, stream.file_path);
                    db.run("UPDATE streams SET status='live', is_manual_run=1 WHERE id=?", [id], () => {
                        bot.answerCallbackQuery(query.id, { text: `🚀 ${stream.title} dinyalakan!` });
                        // Update tampilan tombol jadi STOP
                        setTimeout(() => sendDashboard(chatId), 1000); // Delay dikit biar DB update
                    });
                }
            });
        }

        // 4. STOP STREAM
        else if (data.startsWith('STOP_')) {
            const id = data.split('_')[1];
            streamManagerRef.stopStreamProcess(id, true);
            db.run("UPDATE streams SET status='scheduled', is_manual_run=0 WHERE id=?", [id], () => {
                bot.answerCallbackQuery(query.id, { text: `🛑 Stream dimatikan.` });
                setTimeout(() => sendDashboard(chatId), 1000);
            });
        }
    });
};

// --- HELPERS ---

function isAdmin(msg) {
    return msg.chat.id.toString() === adminChatId?.toString();
}

async function sendSystemStatus(chatId) {
    const stats = await getSystemStats();
    const text = `🖥 **SYSTEM STATUS**\n\nCPU: ${stats.cpu}%\nRAM: ${stats.ram}\nDisk: ${stats.disk.percent} (${stats.disk.used}/${stats.disk.total})`;
    
    bot.sendMessage(chatId, text, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔄 Refresh Data', callback_data: 'REFRESH_STATUS' }]
            ]
        }
    });
}

function sendDashboard(chatId) {
    db.all("SELECT id, title, status, schedule_type FROM streams", [], (err, rows) => {
        if (!rows || rows.length === 0) return bot.sendMessage(chatId, "Belum ada jadwal stream.");

        let keyboard = [];
        
        // Loop setiap stream untuk bikin tombol
        rows.forEach(r => {
            const isLive = r.status === 'live';
            const statusIcon = isLive ? '🟢 LIVE' : '⚫ OFF';
            const modeIcon = r.schedule_type === 'manual' ? '🎛 Manual' : '📅 Jadwal';

            // Baris 1: Judul & Status
            // (Kita pakai tombol dummy biar rapi)
            keyboard.push([{ text: `${statusIcon} | ${r.title} (${modeIcon})`, callback_data: 'IGNORE' }]);

            // Baris 2: Tombol Aksi
            if (isLive) {
                keyboard.push([{ text: '⏹ MATIKAN STREAM', callback_data: `STOP_${r.id}` }]);
            } else {
                keyboard.push([{ text: '▶ NYALAKAN STREAM', callback_data: `START_${r.id}` }]);
            }
        });

        // Tombol Refresh Global
        keyboard.push([{ text: '🔄 Refresh Dashboard', callback_data: 'REFRESH_DASHBOARD' }]);

        bot.sendMessage(chatId, "🎛 **STREAM CONTROL DASHBOARD**\nKlik tombol di bawah untuk mengontrol:", {
            reply_markup: { inline_keyboard: keyboard }
        });
    });
}

// Fungsi notifikasi (export)
const notify = (message) => {
    if (bot && adminChatId) {
        bot.sendMessage(adminChatId, message).catch(() => {});
    }
};

module.exports = { init, notify };
