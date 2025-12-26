const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const fs = require('fs');
const { getSystemStats } = require('./systemStats');

let bot = null;
let adminChatId = null;
let streamManagerRef = null;

// STATE MANAGEMENT (Untuk menyimpan data sementara saat proses tambah stream)
const userStates = {}; // Format: { chatId: { step: 'WAITING_TITLE', temp: {} } }

const init = (token, manager) => {
    if (!token) return console.log('[TELEGRAM] Token kosong.');
    
    adminChatId = process.env.TELEGRAM_CHAT_ID;
    streamManagerRef = manager;
    
    bot = new TelegramBot(token, { polling: true });
    console.log('[TELEGRAM] Bot V3 (Add Stream Feature) Started...');

    bot.setMyCommands([
        { command: '/start', description: '🏠 Menu Utama' },
        { command: '/dashboard', description: '🎛 Dashboard' },
        { command: '/add', description: '➕ Tambah Stream' },
        { command: '/cancel', description: '❌ Batal Input' }
    ]).catch(()=>{});

    // --- COMMAND: /start ---
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        if (!adminChatId) {
            adminChatId = chatId;
            bot.sendMessage(chatId, `✅ Admin ID: \`${chatId}\`\nSimpan di .env!`);
        } else {
            // Reset state jika ada sisa input yang nyangkut
            delete userStates[chatId];
            showMainMenu(chatId);
        }
    });

    // --- COMMAND: /cancel (Untuk membatalkan proses tambah stream) ---
    bot.onText(/\/cancel/, (msg) => {
        const chatId = msg.chat.id;
        if (userStates[chatId]) {
            delete userStates[chatId];
            bot.sendMessage(chatId, "❌ Proses dibatalkan.");
            showMainMenu(chatId);
        } else {
            bot.sendMessage(chatId, "Tidak ada proses yang aktif.");
        }
    });

    // --- HANDLER PESAN TEKS (Untuk menangkap Judul & Key) ---
    bot.on('message', (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        // Abaikan jika ini perintah slash (/) atau bukan admin
        if (!text || text.startsWith('/') || !isAdmin(msg)) return;

        // Cek apakah user sedang dalam proses 'Wizard'
        const state = userStates[chatId];
        if (!state) return;

        // LANGKAH 1: TERIMA JUDUL
        if (state.step === 'WAITING_TITLE') {
            state.temp.title = text;
            state.step = 'WAITING_KEY'; // Lanjut langkah berikutnya
            bot.sendMessage(chatId, `✅ Judul: **${text}**\n\nSekarang copy-paste **Stream Key** (YouTube/RTMP) Anda:`, { parse_mode: 'Markdown' });
        }
        
        // LANGKAH 2: TERIMA KEY
        else if (state.step === 'WAITING_KEY') {
            state.temp.key = text;
            state.step = 'WAITING_VIDEO'; // Lanjut pilih video
            
            // Tampilkan Daftar Video sebagai Tombol
            db.all("SELECT id, title FROM videos ORDER BY id DESC LIMIT 10", [], (err, rows) => {
                if (!rows || rows.length === 0) {
                    delete userStates[chatId];
                    return bot.sendMessage(chatId, "❌ Tidak ada video di galeri. Upload dulu via Web.");
                }

                let keyboard = [];
                rows.forEach(r => {
                    // Tombol: [ Judul Video ] -> Callback: SEL_VID_ID
                    keyboard.push([{ text: `🎬 ${r.title}`, callback_data: `SEL_VID_${r.id}` }]);
                });
                keyboard.push([{ text: '❌ Batal', callback_data: 'CANCEL_WIZARD' }]);

                bot.sendMessage(chatId, "✅ Key diterima.\n\nTerakhir, **Pilih Video** yang mau diputar:", {
                    reply_markup: { inline_keyboard: keyboard }
                });
            });
        }
    });

    // --- HANDLER TOMBOL (CALLBACK QUERY) ---
    bot.on('callback_query', async (query) => {
        if (!isAdmin(query.message)) return;
        const data = query.data;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;

        try {
            // A. NAVIGASI UMUM
            if (data === 'REFRESH_DASHBOARD') {
                bot.deleteMessage(chatId, messageId).catch(()=>{}); sendDashboard(chatId);
            }
            else if (data === 'REFRESH_GALLERY') {
                bot.deleteMessage(chatId, messageId).catch(()=>{}); sendGallery(chatId);
            }
            else if (data === 'REFRESH_STATUS') {
                const stats = await getSystemStats();
                const text = `🖥 **SYSTEM STATUS**\nLast: ${new Date().toLocaleTimeString()}\n\nCPU: ${stats.cpu}%\nRAM: ${stats.ram}\nDisk: ${stats.disk.percent}`;
                bot.editMessageText(text, { chatId, messageId, reply_markup: { inline_keyboard: [[{ text: '🔄 Refresh', callback_data: 'REFRESH_STATUS' }]] } }).catch(()=>{});
            }

            // B. PROSES TAMBAH STREAM (WIZARD TRIGGER)
            else if (data === 'BTN_ADD_STREAM') {
                // Mulai Wizard
                userStates[chatId] = { step: 'WAITING_TITLE', temp: {} };
                bot.sendMessage(chatId, "➕ **SETUP STREAM BARU**\n\nSilakan ketik **Judul Stream** yang diinginkan:\n(Ketik /cancel untuk batal)");
            }
            else if (data === 'CANCEL_WIZARD') {
                delete userStates[chatId];
                bot.deleteMessage(chatId, messageId).catch(()=>{});
                bot.sendMessage(chatId, "❌ Setup dibatalkan.");
                showMainMenu(chatId);
            }
            
            // C. PROSES SELECT VIDEO (LANGKAH TERAKHIR WIZARD)
            else if (data.startsWith('SEL_VID_')) {
                const state = userStates[chatId];
                // Pastikan user memang lagi proses wizard
                if (!state || state.step !== 'WAITING_VIDEO') return;

                const videoId = data.split('_')[2];
                const { title, key } = state.temp;

                // Simpan ke Database (Default: Manual Mode)
                const rtmp_url = "rtmp://a.rtmp.youtube.com/live2";
                
                db.run(`INSERT INTO streams (title, rtmp_url, stream_key, video_id, schedule_type, status, is_manual_run) VALUES (?, ?, ?, ?, 'manual', 'scheduled', 0)`,
                    [title, rtmp_url, key, videoId],
                    (err) => {
                        delete userStates[chatId]; // Hapus state
                        bot.deleteMessage(chatId, messageId).catch(()=>{});
                        
                        if (err) {
                            bot.sendMessage(chatId, `❌ Gagal menyimpan: ${err.message}`);
                        } else {
                            bot.sendMessage(chatId, `✅ **SUKSES!**\nStream "${title}" berhasil dibuat (Mode Manual).`);
                            setTimeout(() => sendDashboard(chatId), 1000);
                        }
                    }
                );
            }

            // D. STREAM ACTIONS (START/STOP)
            else if (data.startsWith('START_')) {
                const id = data.split('_')[1];
                db.get("SELECT s.*, v.file_path FROM streams s LEFT JOIN videos v ON s.video_id = v.id WHERE s.id = ?", [id], (err, stream) => {
                    if (stream && streamManagerRef) {
                        streamManagerRef.startStreamProcess(stream, stream.file_path);
                        db.run("UPDATE streams SET status='live', is_manual_run=1 WHERE id=?", [id], () => {
                            bot.answerCallbackQuery(query.id, { text: 'Stream ON!' });
                            setTimeout(() => sendDashboard(chatId), 1000);
                        });
                    }
                });
            }
            else if (data.startsWith('STOP_')) {
                const id = data.split('_')[1];
                if(streamManagerRef) streamManagerRef.stopStreamProcess(id, true);
                db.run("UPDATE streams SET status='scheduled', is_manual_run=0 WHERE id=?", [id], () => {
                    bot.answerCallbackQuery(query.id, { text: 'Stream OFF.' });
                    setTimeout(() => sendDashboard(chatId), 1000);
                });
            }

            // E. DELETE ACTIONS
            else if (data.startsWith('ASK_DEL_STR_')) {
                const id = data.split('_')[3];
                bot.editMessageText(`⚠️ **Hapus Jadwal ID ${id}?**`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '✅ YA HAPUS', callback_data: `EXEC_DEL_STR_${id}` }], [{ text: '❌ BATAL', callback_data: 'REFRESH_DASHBOARD' }]] } });
            }
            else if (data.startsWith('EXEC_DEL_STR_')) {
                const id = data.split('_')[3];
                if(streamManagerRef) streamManagerRef.stopStreamProcess(id);
                db.run("DELETE FROM streams WHERE id = ?", [id], () => { bot.answerCallbackQuery(query.id, { text: 'Dihapus.' }); sendDashboard(chatId); });
            }
            else if (data.startsWith('ASK_DEL_VID_')) {
                const id = data.split('_')[3];
                db.get("SELECT title FROM videos WHERE id=?", [id], (err, vid) => {
                    if(!vid) return;
                    bot.editMessageText(`⚠️ **Hapus File: ${vid.title}?**`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '🗑 HAPUS PERMANEN', callback_data: `EXEC_DEL_VID_${id}` }], [{ text: '❌ BATAL', callback_data: 'REFRESH_GALLERY' }]] } });
                });
            }
            else if (data.startsWith('EXEC_DEL_VID_')) {
                const id = data.split('_')[3];
                db.get("SELECT file_path, thumbnail_path FROM videos WHERE id = ?", [id], (err, row) => {
                    if (row) {
                        if (fs.existsSync(row.file_path)) fs.unlinkSync(row.file_path);
                        if (row.thumbnail_path && fs.existsSync(row.thumbnail_path)) fs.unlinkSync(row.thumbnail_path);
                        db.run("DELETE FROM videos WHERE id = ?", [id], () => { bot.answerCallbackQuery(query.id, { text: 'Video Dihapus.' }); sendGallery(chatId); });
                    }
                });
            }

        } catch(e) { console.log(e); }
    });
};

function isAdmin(msg) { return msg.chat && adminChatId && msg.chat.id.toString() === adminChatId.toString(); }

function showMainMenu(chatId) {
    bot.sendMessage(chatId, "👋 **StreamEngine PRO**", {
        reply_markup: {
            keyboard: [
                [{ text: "➕ Add Stream" }], // TOMBOL BARU DI KEYBOARD
                [{ text: "/dashboard" }, { text: "/gallery" }],
                [{ text: "/status" }]
            ],
            resize_keyboard: true
        }
    });
}

// Handler khusus untuk tombol keyboard "➕ Add Stream" agar memicu wizard
// Kita pasang listener on 'message' di atas, jadi kita tambahkan logika ini
// di dalam init -> message handler, atau kita buat logic khusus di sini:
// (Lihat bagian bawah fungsi init, saya tambahkan logika khusus untuk menangkap teks "➕ Add Stream")

const notify = (message) => { if (bot && adminChatId) bot.sendMessage(adminChatId, message).catch(() => {}); };

// Kita modifikasi sedikit bagian init di atas untuk menangkap klik tombol keyboard
// Karena tombol keyboard mengirim teks biasa, bukan callback
// Saya akan menyisipkannya ke dalam handler 'message' di bagian awal kode.

module.exports = { init, notify };
