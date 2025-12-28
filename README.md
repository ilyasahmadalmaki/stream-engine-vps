# 📡 StreamEngine PRO (v2.0 Final)

**StreamEngine PRO** adalah sistem otomatisasi Live Streaming YouTube 24/7 berbasis VPS (Linux) yang ringan dan tangguh. Sistem ini dirancang untuk mengubah VPS murah sekalipun menjadi "Stasiun TV" pribadi yang berjalan non-stop.

Dilengkapi dengan **Web Dashboard Modern** (Dark Mode) yang aman, serta **Telegram Bot Assistant** canggih untuk kontrol jarak jauh.

---

## 🔥 Fitur Utama

### 🖥️ Backend & Core System
- **Auto-Heal System:** Otomatis mendeteksi stream yang crash (error 152/224) dan menyalakannya kembali dalam 1 menit.
- **Smart Scheduler:**
  - 🔁 **Harian (Daily):** Live otomatis jam X, mati jam Y (berulang tiap hari).
  - 📅 **Sekali (Once):** Live pada tanggal & jam tertentu.
  - 🎛 **Manual:** Start/Stop sesuka hati via tombol tanpa batasan waktu.
- **FFmpeg Optimized:** Racikan script khusus untuk VPS hemat RAM (Low-Latency, Auto Reconnect, Anti-Buffer).

### 🔒 Web Dashboard (Secure)
- **Login Protection:** Akses dashboard dikunci dengan password & session (Anti-Hacker).
- **Resource Monitor:** Pantau penggunaan CPU, RAM, dan Disk secara Real-time.
- **File Manager:**
  - ⬆ **Upload Local:** Upload video dari komputer/HP.
  - ☁ **Import GDrive:** Download video langsung dari Google Drive ke VPS (Super Cepat & Hemat Kuota).
- **Video Preview:** Cek video di player sebelum dilive-kan.

### 📱 Telegram Bot (V5 - Wizard Mode)
- **Wizard Setup:** Tambah jadwal live baru lewat tanya-jawab interaktif (Tanpa perlu buka Web).
- **Remote Control:** Start, Stop, dan Hapus jadwal dari HP.
- **Status Check:** Cek kesehatan server (CPU/RAM) dari chat.
- **Realtime Notif:** Laporan otomatis saat Live dimulai, berhenti, atau jika terjadi error.

---

## 🛠️ Panduan Instalasi (VPS Ubuntu/Debian)

### 1. Persiapan System & Dependency
Update server dan install tool wajib (FFmpeg, Node.js, Git).

```bash
# Update Server
sudo apt update && sudo apt upgrade -y

# Install FFmpeg & Tools dasar
sudo apt install ffmpeg git curl unzip -y

# Install Node.js 18.x (Versi Stabil)
curl -fsSL [https://deb.nodesource.com/setup_18.x](https://deb.nodesource.com/setup_18.x) | sudo -E bash -
sudo apt install -y nodejs
2. Setup SWAP Memory (WAJIB!)
Agar VPS tidak crash (Error 152/224) saat live berjam-jam, kita buat RAM tambahan (Virtual Memory) sebesar 2GB dari Hardisk.

Bash

sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
3. Install Aplikasi
Bash

# Clone Repository (Ganti Link dengan Repo GitHub Anda)
git clone [https://github.com/USERNAME_ANDA/stream-engine-vps.git](https://github.com/USERNAME_ANDA/stream-engine-vps.git)

# Masuk folder
cd stream-engine-vps

# Install Library Pendukung
npm install
⚙️ Konfigurasi Rahasia (.env)
Buat file bernama .env di dalam folder project. File ini menyimpan password dashboard dan token bot.

Bash

nano .env
Salin dan isi data berikut:

Cuplikan kode

# --- SERVER CONFIG ---
PORT=7000
SESSION_SECRET=kunci_rahasia_acak_bebas_isi_apa_aja_biar_aman

# --- LOGIN DASHBOARD ---
ADMIN_USER=admin
ADMIN_PASS=password_rahasia_anda

# --- TELEGRAM BOT ---
# Buat bot di @BotFather untuk dapat token
TELEGRAM_BOT_TOKEN=123456789:ABCDefGhiJklMnoPqrStuVwxyz

# Biarkan kosong dulu, bot akan memberitahu ID Anda saat klik /start
TELEGRAM_CHAT_ID=
(Simpan file: Tekan Ctrl+X, lalu Y, lalu Enter)

🚀 Menjalankan Server (Auto-Start Systemd)
Gunakan Systemd agar aplikasi otomatis menyala sendiri saat VPS restart.

Buat File Service:

Bash

sudo nano /etc/systemd/system/stream-engine.service
Isi File: (Sesuaikan /root/stream-engine-vps dengan lokasi folder asli Anda)

Ini, TOML

[Unit]
Description=StreamEngine Pro Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/stream-engine-vps
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
Aktifkan Service:

Bash

sudo systemctl daemon-reload
sudo systemctl enable stream-engine
sudo systemctl start stream-engine
Cek Status:

Bash

sudo systemctl status stream-engine
📖 Cara Penggunaan
🌐 1. Web Dashboard
Akses: Buka browser HP/Laptop, ketik http://IP-VPS-ANDA:7000.

Login: Masukkan Username & Password sesuai file .env.

Menu Utama:

Active Streams: Melihat status live (Hijau=Live, Biru=Terjadwal, Abu=Offline).

Video Library: Upload video baru atau Import link GDrive.

Membuat Jadwal: Klik + New Stream -> Isi data -> Pilih Mode (Manual/Harian).

Edit Jadwal: Klik ikon pensil (✏️) -> Ubah -> Save.

📱 2. Telegram Bot
Cari bot Anda di Telegram, klik Start.

Jika ID belum terdaftar, bot akan mengirim ID Anda. Masukkan ke .env dan restart server.

Menu Tombol:

📊 Cek Status: Melihat beban CPU, RAM, dan Sisa Disk.

🎛 Dashboard: Start/Stop stream yang sudah ada.

📂 Galeri Video: Melihat daftar video & menghapus file.

➕ Tambah Stream: Wizard otomatis untuk setup live baru.

❓ Troubleshooting (Masalah Umum)
1. Bot Telegram Diam / Tidak Merespon Biasanya token salah atau server mati. Cek log error:

Bash

journalctl -u stream-engine -f
2. Web Dashboard Error "Unexpected token <" Ini terjadi jika sesi login habis tapi browser masih menyimpan cache lama.

Solusi: Refresh halaman (F5) -> Anda akan diarahkan ke Login -> Login Ulang.

3. Stream Crash (Exit Code 152 / 224)

Code 152: CPU Limit. VPS terlalu lemah atau ada proses lain yang berat.

Code 224: Koneksi RTO atau RAM Penuh. Pastikan langkah Setup SWAP di atas sudah dilakukan.

4. Update Kode dari GitHub Jika Anda melakukan perubahan kode di GitHub, update VPS dengan cara:

Bash

cd stream-engine-vps
git pull origin main
systemctl restart stream-engine
📂 Struktur Folder Project
server.js : Otak utama aplikasi (API & Server).

src/ : Folder Logika backend (Database, FFmpeg, Bot, Scheduler).

public/ : Tampilan Web (HTML/CSS/JS).

uploads/ : Folder penyimpanan video (Diabaikan oleh Git).

stream.db : Database SQLite (Menyimpan jadwal & data video).

Dibuat oleh: Ilyas Ahmad ALmaki Lisensi: Private / Personal Use
