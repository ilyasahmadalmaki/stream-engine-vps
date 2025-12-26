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
    console.log('[TELEGRAM] Bot V3 (Wizard) Started...');

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
        bot.sendMessage(msg.chat.id, "❌ Batal.");
        showMainMenu(msg.chat.id);
    });

    // --- HANDLER PESAN TEKS (WIZARD & KEYBOARD MENU) ---
    bot.on('message', (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        if (!text || !isAdmin(msg)) return;

        // 1. CEK TOMBOL MENU KEYBOARD
        if (text === "➕ Add Stream" || text === "/add") {
            userStates[chatId] = { step: 'WAITING_TITLE', temp: {} };
            return bot.sendMessage(chatId, "📝 **SETUP STREAM BARU**\n\nKetik **Judul Stream**:\n(/cancel untuk batal)");
        }
        else if (text === "/dashboard" || text.includes("Dashboard")) return sendDashboard(chatId);
        else if (text === "/gallery" || text.includes("Gallery")) return sendGallery(chatId);
        else if (text === "/status" || text.includes("Status")) return sendSystemStatus(chatId);

        // 2. CEK PROSES WIZARD
        const state = userStates[chatId];
        if (!state) return;

        if (state.step === 'WAITING_TITLE') {
            state.temp.title = text;
            state.step = 'WAITING_KEY';
            bot.sendMessage(chatId, `✅ Judul: **${text}**\n\n🔑 Sekarang ketik/paste **Stream Key**:`);
        }
        else if (state.step === 'WAITING_KEY') {
            state.temp.key = text;
            state.step = 'WAITING_VIDEO';
            
            db.all("SELECT id, title FROM videos ORDER BY id DESC LIMIT 10", [], (err, rows) => {
                if (!rows || rows.length === 0) {
                    delete userStates[chatId];
                    return bot.sendMessage(chatId, "❌ Galeri kosong. Upload video dulu.");
                }
                let keyboard = [];
                rows.forEach(r => {
                    keyboard.push([{ text: `🎬 ${r.title}`, callback_data: `SEL_VID_${r.id}` }]);
                });
                keyboard.push([{ text: '❌ Batal', callback_data: 'CANCEL_WIZARD' }]);
                bot.sendMessage(chatId, "✅ Key Oke.\n\n👇 **Pilih Video:**", { reply_markup: { inline_keyboard: keyboard } });
            });
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
            
            // WIZARD FINAL STEP
            else if (data === 'CANCEL_WIZARD') {
                delete userStates[chatId];
                bot.deleteMessage(chatId, messageId).catch(()=>{});
                bot.sendMessage(chatId, "❌ Batal.");
            }
            else if (data.startsWith('SEL_VID_')) {
                const state = userStates[chatId];
                if (!state || state.step !== 'WAITING_VIDEO') return;
                
                const vidId = data.split('_')[2];
                const { title, key } = state.temp;
                
                db.run(`INSERT INTO streams (title, rtmp_url, stream_key, video_id, schedule_type, status, is_manual_run) VALUES (?, 'rtmp://a.rtmp.youtube.com/live2', ?, ?, 'manual', 'scheduled', 0)`,
                    [title, key, vidId], (err) => {
                        delete userStates[chatId];
                        bot.deleteMessage(chatId, messageId).catch(()=>{});
                        if(err) bot.sendMessage(chatId, `❌ Gagal: ${err.message}`);
                        else {
                            bot.sendMessage(chatId, `✅ **Stream Dibuat!**\nJudul: ${title}\nMode: Manual`);
                            setTimeout(()=>sendDashboard(chatId), 1000);
                        }
                    });
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
    db.all("SELECT id, title, status FROM streams ORDER BY status DESC", [], (e,r) => {
        if(!r || r.length===0) return bot.sendMessage(chatId, "📭 Kosong.");
        let k = [];
        r.forEach(x => {
            const live = x.status==='live';
            k.push([{ text: `${live?'🟢':'⚫'} ${x.title}`, callback_data:'IGN' }]);
            k.push([live?{text:'⏹ STOP', callback_data:`STOP_${x.id}`}:{text:'▶ START', callback_data:`START_${x.id}`}, {text:'🗑', callback_data:`ASK_DEL_STR_${x.id}`}]);
        });
        k.push([{text:'🔄 Refresh', callback_data:'REFRESH_DASHBOARD'}]);
        bot.sendMessage(chatId, "🎛 **DASHBOARD**", {reply_markup:{inline_keyboard:k}});
    });
}

function sendSystemStatus(chatId) {
    getSystemStats().then(s => {
        bot.sendMessage(chatId, `🖥 CPU: ${s.cpu}%\nRAM: ${s.ram}\nDisk: ${s.disk.percent}`, {reply_markup:{inline_keyboard:[[{text:'🔄', callback_data:'REFRESH_STATUS'}]]}});
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
