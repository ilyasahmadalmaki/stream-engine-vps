# 📡 StreamEngine PRO (v2.0 Final)

**StreamEngine PRO** adalah sistem otomatisasi Live Streaming YouTube 24/7 berbasis VPS (Linux). Sistem ini mengubah VPS Anda menjadi "Stasiun TV" pribadi yang bisa berjalan non-stop tanpa perlu menyalakan komputer/laptop di rumah.

Dilengkapi dengan **Web Dashboard Modern** (Dark Mode) untuk manajemen file, dan **Telegram Bot Assistant** untuk kontrol jarak jauh via HP.

---

## 🔥 Fitur Unggulan

### 🖥️ Backend & Core
- **Auto-Heal System:** Otomatis mendeteksi jika stream crash (error 152/224) dan menyalakannya kembali dalam 1 menit.
- **Smart Scheduler:**
  - 🔁 **Harian (Daily):** Live otomatis jam X, mati jam Y (berulang tiap hari).
  - 📅 **Sekali (Once):** Live pada tanggal & jam tertentu.
  - 🎛 **Manual:** Start/Stop sesuka hati via tombol.
- **FFmpeg Optimized:** Racikan khusus untuk VPS hemat RAM (Low-Latency, Reconnect, Anti-Buffer).

### 🔒 Keamanan & Dashboard
- **Secure Login:** Halaman login dengan proteksi Session (Anti-Hacker).
- **Resource Monitor:** Cek CPU, RAM, dan Disk Usage secara Real-time.
- **File Manager:**
  - ⬆ **Upload Local:** Upload video dari komputer.
  - ☁ **Import GDrive:** Download video langsung dari Google Drive ke VPS (Hemat kuota internet Anda).
- **Video Preview:** Nonton/cek video langsung di dashboard sebelum dilive-kan.

### 📱 Telegram Bot (V5)
- **Wizard Mode:** Tambah jadwal live baru lewat tanya-jawab interaktif.
- **Remote Control:** Start, Stop, dan Hapus jadwal dari HP.
- **Status Check:** Cek kesehatan server (CPU/RAM) dari chat.
- **Notifikasi:** Laporan otomatis saat Live dimulai atau jika terjadi error.

---

## 🛠️ Instalasi (VPS Baru)

Panduan ini untuk **Ubuntu 20.04 / 22.04 LTS**.

### 1. Persiapan System & Dependency
Update server dan install tool wajib (FFmpeg, Node.js, Git).

```bash
# Update Server
sudo apt update && sudo apt upgrade -y

# Install FFmpeg & Tools
sudo apt install ffmpeg git curl unzip -y

# Install Node.js 18.x (Terbaru Stabil)
curl -fsSL [https://deb.nodesource.com/setup_18.x](https://deb.nodesource.com/setup_18.x) | sudo -E bash -
sudo apt install -y nodejs

Setup SWAP Memory (WAJIB!)
Agar VPS tidak crash saat live lama, kita buat RAM tambahan (Virtual Memory) sebesar 2GB.

Bash

sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

Install Aplikasi
Bash

# Clone Repository (Ganti dengan Link GitHub Anda)
git clone [https://github.com/USERNAME_ANDA/stream-engine-vps.git](https://github.com/USERNAME_ANDA/stream-engine-vps.git)
cd stream-engine-vps

# Install Library JavaScript
npm install

⚙️ Konfigurasi (.env)
Buat file bernama .env di dalam folder project untuk menyimpan password dan token rahasia.

Bash

nano .env

Cuplikan kode

# --- SERVER CONFIG ---
PORT=7000
SESSION_SECRET=kunci_rahasia_acak_bebas_isi_apa_aja

# --- LOGIN DASHBOARD ---
ADMIN_USER=admin
ADMIN_PASS=password_rahasia_anda

# --- TELEGRAM BOT ---
# Buat bot di @BotFather untuk dapat token
TELEGRAM_BOT_TOKEN=123456789:ABCDefGhiJklMnoPqrStuVwxyz
# Biarkan kosong dulu, nanti bot akan memberitahu ID Anda saat klik /start
TELEGRAM_CHAT_ID=

Simpan dengan Ctrl+X, lalu Y, lalu Enter.

🚀 Menjalankan Server (Auto-Start)
Kita gunakan Systemd agar aplikasi otomatis nyala saat VPS restart.

Buat File Service:

Bash

sudo nano /etc/systemd/system/stream-engine.service
Isi File (Sesuaikan path /root/stream-engine-vps dengan lokasi folder Anda):

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
📖 Panduan Penggunaan
🌐 1. Web Dashboard
Akses: Buka browser dan ketik http://IP-VPS-ANDA:7000.

Login: Masukkan Username & Password sesuai file .env.

Upload Video: Klik "Import Drive" (rekomendasi) atau "Upload Local".

Buat Jadwal: Klik + New Stream -> Isi Judul, Key, Pilih Video -> Pilih Mode (Manual/Harian).

Edit Jadwal: Klik ikon pensil (✏️) pada kartu stream. Jangan lupa klik Save.

📱 2. Telegram Bot
Buka bot Anda di Telegram, klik Start.

Jika ID Anda belum terdaftar, bot akan memberikan ID. Masukkan ID tersebut ke file .env (bagian TELEGRAM_CHAT_ID), lalu restart server.

Menu:

/dashboard : Tombol kontrol Live (Start/Stop).

/add : Wizard tambah stream baru (Tanya-jawab otomatis).

/gallery : List video & hapus video.

/status : Cek beban CPU & RAM VPS.

❓ Troubleshooting (Masalah Umum)
1. Bot Telegram Tidak Merespon Biasanya token salah atau server mati. Cek log:

Bash

journalctl -u stream-engine -f
2. Error "Unexpected token <" di Web Dashboard Itu artinya sesi login habis tapi browser masih cache halaman lama.

Solusi: Refresh halaman (F5) -> Login Ulang.

3. Stream Crash (Code 152 / 224)

Code 152: CPU Limit. VPS terlalu lemah. Pastikan jangan buka aplikasi berat lain.

Code 224: Koneksi putus atau RAM penuh. Pastikan langkah Setup SWAP di atas sudah dilakukan.

4. Update Kode dari GitHub Jika Anda mengupdate kode di GitHub, cara update di VPS:

Bash

cd stream-engine-vps
git pull origin main
systemctl restart stream-engine
📂 Struktur Folder
server.js : Otak utama aplikasi (API & Server).

src/ : Logika backend (FFmpeg, Telegram, Scheduler, Database).

public/ : Tampilan Web (HTML/CSS/JS).

uploads/ : Folder penyimpanan video (Tidak di-upload ke GitHub).

stream.db : Database SQLite (Jadwal & Data Video).
