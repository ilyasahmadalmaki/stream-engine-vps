# 📡 StreamEngine PRO

StreamEngine PRO adalah sistem otomatisasi Live Streaming 24/7 berbasis Node.js dan FFmpeg. Mengubah VPS biasa menjadi stasiun TV pribadi yang bisa dikontrol lewat Web Dashboard maupun Telegram.

## 🔥 Fitur Utama

- **Schedule & Manual Mode:** Atur jadwal harian, sekali jalan, atau start/stop manual sesuka hati.
- **Auto-Heal:** Scheduler otomatis mendeteksi stream mati dan menghidupkannya kembali dalam 1 menit.
- **Web Dashboard:**
  - Upload Video (Local & GDrive Import).
  - Monitoring CPU, RAM, dan Disk Space.
  - Preview Video Player.
- **Telegram Bot Assistant:**
  - Start/Stop stream dari HP.
  - Notifikasi Realtime (Live, Crash, Server Up).
  - Wizard "Add Stream" tanpa buka laptop.
  - Manajemen File (Hapus video/jadwal).

## 🛠 Instalasi (VPS Linux)

1. **Persiapan System:**
   Install FFmpeg dan Node.js terlebih dahulu.
   ```bash
   sudo apt update
   sudo apt install ffmpeg
Clone & Install:

Bash

git clone [https://github.com/username/stream-engine.git](https://github.com/username/stream-engine.git)
cd stream-engine
npm install
Konfigurasi Environment: Buat file .env (lihat contoh di bawah).

Jalankan:

Bash

node server.js
# Atau gunakan PM2/Systemd untuk production
🔐 Konfigurasi (.env)
Buat file bernama .env di root folder:

Cuplikan kode

PORT=7000
ADMIN_USER=admin
ADMIN_PASS=rahasia123
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_CHAT_ID= (Biarkan kosong, bot akan memberi tahu saat /start)
📱 Cara Pakai Bot Telegram
Cari bot di Telegram dan klik Start.

Bot akan memberikan ID Anda. Masukkan ID tersebut ke .env dan restart server.

Menu yang tersedia:

Dashboard: Lihat status stream & tombol kontrol (Start/Stop/Hapus).

Galeri: Lihat daftar video & hapus file.

Status: Cek beban CPU/RAM VPS.

Add Stream: Wizard interaktif untuk membuat jadwal baru.

📂 Struktur Project
public/ -> Frontend Web (HTML/CSS/JS).

src/ -> Logic Backend (Database, FFmpeg Manager, Telegram Bot).

uploads/ -> Tempat penyimpanan video (Local).

server.js -> Entry point aplikasi.


---

### 4. Cek Struktur Folder Terakhir

Pastikan susunan folder di VPS Anda terlihat rapi seperti ini:

```text
/root/stream-engine/
├── .env                  <-- File rahasia (JANGAN DIHAPUS/DIPINDAH)
├── .gitignore            <-- Baru dibuat
├── package.json          <-- Baru diupdate
├── README.md             <-- Baru dibuat
├── server.js
├── uploads/              <-- Folder video
├── public/
│   ├── index.html
│   └── login.html
└── src/
    ├── db.js
    ├── gdriveDownloader.js
    ├── mediaUtils.js
    ├── scheduler.js
    ├── storage.js
    ├── streamManager.js
    ├── systemStats.js
    └── telegramBot.js
