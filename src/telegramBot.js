const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const { getSystemStats } = require('./systemStats');
// Kita import streamManager nanti di dalam fungsi biar tidak circular dependency error

let bot = null;
let adminChatId = process.env.TELEGRAM_CHAT_ID; // ID Telegram Anda

const init = (token, streamManagerRef) => {
    if (!token) return console.log('[TELEGRAM] Token tidak ditemukan, bot nonaktif.');
    
    bot = new TelegramBot(token, { polling: true });
    console.log('[TELEGRAM] Bot Started & Polling...');

    // --- COMMAND: /start (Cek ID) ---
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        if (!adminChatId) {
            adminChatId = chatId;
            bot.sendMessage(chatId, `✅ Konfigurasi Berhasil!\nChat ID Anda: ${chatId}\nSilakan simpan di .env: TELEGRAM_CHAT_ID=${chatId}`);
            console.log(`[TELEGRAM] Admin Chat ID set to: ${chatId}`);
        } else if (chatId.toString() !== adminChatId.toString()) {
            bot.sendMessage(chatId, "⛔ Akses Ditolak. Anda bukan admin.");
        } else {
            bot.sendMessage(chatId, "👋 Halo Bos! StreamEngine siap diperintah.\n\nMenu:\n/status - Cek CPU/RAM & Live\n/list - Daftar Stream\n/live [id] - Start Stream\n/kill [id] - Stop Stream");
        }
    });

    // --- COMMAND: /status ---
    bot.onText(/\/status/, async (msg) => {
        if (msg.chat.id.toString() !== adminChatId?.toString()) return;
        
        const stats = await getSystemStats();
        let message = `🖥 **SYSTEM STATUS**\n`;
        message += `CPU: ${stats.cpu}%\nRAM: ${stats.ram}\nDisk: ${stats.disk.percent}\n\n`;
        
        db.all("SELECT title, status FROM streams", [], (err, rows) => {
            if (rows) {
                message += `📡 **STREAMS:**\n`;
                rows.forEach(r => {
                    const icon = r.status === 'live' ? '🟢' : '⚫';
                    message += `${icon} ${r.title} (${r.status})\n`;
                });
            }
            bot.sendMessage(adminChatId, message);
        });
    });

    // --- COMMAND: /list ---
    bot.onText(/\/list/, (msg) => {
        if (msg.chat.id.toString() !== adminChatId?.toString()) return;
        
        db.all("SELECT id, title, status, schedule_type FROM streams", [], (err, rows) => {
            if (!rows || rows.length === 0) return bot.sendMessage(adminChatId, "Belum ada jadwal stream.");
            
            let msg = "📋 **DAFTAR JADWAL:**\n\n";
            rows.forEach(r => {
                msg += `ID: ${r.id} | ${r.title}\nMode: ${r.schedule_type} | Status: ${r.status}\n------------------\n`;
            });
            msg += "\nGunakan: `/live ID` atau `/kill ID`";
            bot.sendMessage(adminChatId, msg);
        });
    });

    // --- COMMAND: /live [id] ---
    bot.onText(/\/live (.+)/, (msg, match) => {
        if (msg.chat.id.toString() !== adminChatId?.toString()) return;
        const id = match[1];

        db.get("SELECT s.*, v.file_path FROM streams s LEFT JOIN videos v ON s.video_id = v.id WHERE s.id = ?", [id], (err, stream) => {
            if (!stream) return bot.sendMessage(adminChatId, "❌ Stream ID tidak ditemukan.");
            
            // Logic start manual
            streamManagerRef.startStreamProcess(stream, stream.file_path);
            
            // Update DB jadi manual mode
            db.run("UPDATE streams SET status='live', is_manual_run=1 WHERE id=?", [id]);
            bot.sendMessage(adminChatId, `🚀 Perintah diterima. Menyalakan: ${stream.title}`);
        });
    });

    // --- COMMAND: /kill [id] ---
    bot.onText(/\/kill (.+)/, (msg, match) => {
        if (msg.chat.id.toString() !== adminChatId?.toString()) return;
        const id = match[1];
        
        streamManagerRef.stopStreamProcess(id, true);
        
        // Reset manual flag
        db.run("UPDATE streams SET status='scheduled', is_manual_run=0 WHERE id=?", [id]);
        bot.sendMessage(adminChatId, `🛑 Perintah diterima. Mematikan ID ${id}.`);
    });
};

// Fungsi untuk kirim notifikasi dari modul lain
const notify = (message) => {
    if (bot && adminChatId) {
        bot.sendMessage(adminChatId, message).catch(e => console.error("Gagal kirim TG:", e.message));
    }
};

module.exports = { init, notify };
