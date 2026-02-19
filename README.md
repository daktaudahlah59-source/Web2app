# Web2APK Pro Bot Gen 3 - VPS Edition

Bot Telegram + Web Dashboard untuk konversi website menjadi aplikasi Android (APK) native.

## ✨ Fitur Baru Gen 3

| Fitur | Telegram Bot | Web Dashboard |
|-------|:------------:|:-------------:|
| **URL to APK** | ✅ | ✅ |
| **ZIP Build (Flutter/Android)** | ✅ | ✅ |
| **Custom Icon** | ✅ | ✅ |
| **Server Status** | ✅ | ✅ |
| **Build Queue** | ✅ | ✅ |
| **Auto IP Detection** | - | ✅ |
| **Server Specs Display** | - | ✅ |
| **File Limit 2GB** | ✅* | ✅ |

> *Dengan Local Bot API Server

---

## 📋 Requirements

| Requirement | Version | Keterangan |
|-------------|---------|------------|
| **Node.js** | 18+ | Runtime JavaScript |
| **Java JDK** | 17+ | Untuk compile Android |
| **Gradle** | 9.x | Build tool |
| **Android SDK** | 34 | SDK & Build Tools |
| **Flutter** | 3.x | Untuk ZIP build Flutter |
| **Storage** | 2GB+ | Untuk SDK & dependencies |

**OS Support:** Windows 10/11, Ubuntu/Debian (VPS)

---

## 🚀 Instalasi Cepat

### Windows (PowerShell sebagai Admin)

```powershell
.\scripts\setup.ps1
```

### Linux/VPS (Ubuntu/Debian)

```bash
chmod +x scripts/setup-vps.sh
./scripts/setup-vps.sh
```

> ℹ️ **Script akan otomatis:**
>
> - Install npm dependencies
> - Download & Install Android SDK
> - Set JAVA_HOME & ANDROID_HOME
> - Install Build Tools & Platform
> - Install Flutter SDK

### Install Gradle (jika belum ada)

**Windows:**

```powershell
choco install gradle
# atau download dari https://gradle.org/releases/
```

**Linux:**

```bash
sudo apt install gradle
```

---

## 🖥️ Deploy di VPS (Ubuntu/Debian)

### 1. Download & Run Setup Script

```bash
# Download script
wget https://raw.githubusercontent.com/yourusername/web2apk/main/scripts/setup-vps.sh

# Jalankan
chmod +x setup-vps.sh
./setup-vps.sh
```

> ℹ️ **Script akan otomatis install:**
>
> - Node.js 20, Java 17, Gradle
> - Android SDK 34 + Build Tools
> - Flutter SDK
> - PM2 untuk process manager

### 2. Clone & Setup Project

```bash
git clone https://github.com/yourusername/web2apk.git
cd web2apk
npm install
cp .env.example .env
nano .env  # Edit dan isi BOT_TOKEN
```

### 3. Konfigurasi Anti-Clone Protection

> ⚠️ **WAJIB untuk keamanan!** Ini mencegah source code Anda di-clone dan dijalankan oleh orang lain.

**1. Generate License Key:**

```bash
node -e "console.log(require('crypto').randomUUID())"
```

Contoh output: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`

**2. Generate Anti-Clone Secret:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Contoh output: `8f7a3b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a`

**3. Edit file `.env`:**

```env
# Anti-Clone Protection
ALLOWED_DOMAINS=localhost,127.0.0.1,yourdomain.com
SERVER_LICENSE_KEY=a1b2c3d4-e5f6-7890-abcd-ef1234567890
ANTI_CLONE_SECRET=8f7a3b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a
```

| Variable | Keterangan |
|----------|------------|
| `ALLOWED_DOMAINS` | Domain yang diizinkan akses (pisah dengan koma) |
| `SERVER_LICENSE_KEY` | **WAJIB** - Key unik dari `randomUUID()` |
| `ANTI_CLONE_SECRET` | **WAJIB** - Secret dari `randomBytes(32)` |

> 💡 **Tips:**
> - Simpan kedua key di tempat aman
> - Jangan share ke siapapun
> - Jika diganti, semua instance yang berjalan akan berhenti

### 4. Jalankan dengan PM2

```bash
pm2 start src/bot.js --name "web2apk"
pm2 startup && pm2 save

# Monitoring
pm2 logs web2apk
```

### 5. Setup Local Bot API Server (Untuk File 2GB)

> ⚠️ **Optional** - Hanya diperlukan jika ingin menerima/mengirim file >20MB/50MB

Local Bot API Server memungkinkan bot menerima dan mengirim file hingga **2GB**!

**1. Dapatkan API credentials dari [my.telegram.org](https://my.telegram.org)**

**2. Jalankan script setup:**

```bash
chmod +x scripts/setup-local-api.sh
sudo ./scripts/setup-local-api.sh 25805438 a47c79aa127d0214ceb4cc7aaab578c6
```

> Script akan otomatis install dependencies, build server, dan membuat systemd service.

**3. Tambahkan ke `.env`:**

```env
LOCAL_API_URL=http://139.59.108.177:2001
API_ID=your_api_id
API_HASH=your_api_hash
```

**4. Restart bot:**

```bash
pm2 restart web2apk
```

**Useful Commands:**

```bash
# Check status
systemctl status telegram-bot-api

# View logs
journalctl -u telegram-bot-api -f

# Restart
systemctl restart telegram-bot-api
```

### 6. Setup Nginx Reverse Proxy (Optional)

```bash
# Install Nginx
sudo apt install -y nginx

# Create config
sudo nano /etc/nginx/sites-available/web2apk
```

Isi dengan (ganti `yourdomain.com` dengan domain Anda):

```nginx
server {
    server_name yourdomain.com;  # Ganti dengan domain, atau _ untuk akses via IP VPS

    # Allow large file uploads (50MB for ZIP projects)
    client_max_body_size 100m;
    client_body_timeout 300s;

    location / {
        proxy_pass http://139.59.108.177:2001;
        proxy_http_version 1.1;
        
        # WebSocket & SSE support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # CRITICAL: Extended timeouts for long builds (30 minutes)
        proxy_connect_timeout 1800s;
        proxy_send_timeout 1800s;
        proxy_read_timeout 1800s;
        
        # CRITICAL: Disable buffering for SSE streaming
        proxy_buffering off;
        proxy_cache off;
        
        # Chunked transfer encoding for SSE
        chunked_transfer_encoding on;
    }

    # SSL configuration - will be added by Certbot
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = yourdomain.com) {
        return 301 https://$host$request_uri;
    }

    listen 80;
    server_name yourdomain.com;
    return 404;
}
```

Aktifkan:

```bash
sudo ln -s /etc/nginx/sites-available/web2apk /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Nginx untuk Akses via IP (Tanpa Domain)

Jika Anda **tidak punya domain** dan ingin akses via IP VPS, gunakan konfigurasi ini:

```bash
sudo nano /etc/nginx/sites-available/web2apk
```

```nginx
server {
    listen 80;
    server_name _;  # Akses via IP VPS

    # Allow large file uploads (100MB for ZIP projects)
    client_max_body_size 100m;
    client_body_timeout 300s;

    location / {
        proxy_pass http://139.59.108.177:2001;
        proxy_http_version 1.1;

        # WebSocket & SSE support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # CRITICAL: Extended timeouts for long builds (30 minutes)
        proxy_connect_timeout 1800s;
        proxy_send_timeout 1800s;
        proxy_read_timeout 1800s;

        # CRITICAL: Disable buffering for SSE streaming
        proxy_buffering off;
        proxy_cache off;

        # Chunked transfer encoding for SSE
        chunked_transfer_encoding on;
    }
}
```

Aktifkan:

```bash
sudo ln -s /etc/nginx/sites-available/web2apk /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

> ℹ️ Akses dashboard via `http://IP_VPS_ANDA` (port 80).

### 7. Jika Menggunakan Cloudflare

> ⚠️ **PENTING:** Cloudflare memiliki timeout **100 detik** yang TIDAK bisa diubah di free plan!

Build APK membutuhkan waktu 5-15 menit, sehingga koneksi akan terputus jika menggunakan proxy Cloudflare.

**Solusi:**

1. Buka **Cloudflare Dashboard** → **DNS**
2. Cari record domain/subdomain Anda
3. Klik awan **oranye** → ubah ke awan **abu-abu (DNS Only)**
4. Ini akan bypass Cloudflare dan koneksi langsung ke VPS

| Mode | Awan | Timeout | Cocok untuk |
|------|------|---------|-------------|
| Proxied | 🟠 Oranye | 100 detik | Website biasa |
| DNS Only | ⚪ Abu-abu | Unlimited | Build APK |

### 8. Setup SSL dengan Certbot (Optional)

> ⚠️ **Hanya jika punya domain!** SSL tidak bisa untuk akses via IP.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

### 9. Firewall

```bash
sudo ufw allow 22      # SSH (WAJIB!)
sudo ufw allow 80      # HTTP (jika pakai Nginx)
sudo ufw allow 3000    # Dashboard (jika TIDAK pakai Nginx)
sudo ufw enable
```

> ⚠️ **Jangan lupa buka port 22!** Jika tidak, Anda tidak bisa SSH ke VPS lagi.

### 10. Minimum VPS Specs

| Spec | Minimum | Recommended |
|------|---------|-------------|
| **RAM** | 2 GB | 4 GB |
| **CPU** | 1 Core | 2 Core |
| **Storage** | 20 GB | 40 GB |
| **OS** | Ubuntu 20.04+ | Ubuntu 22.04 |

> ⚠️ **Catatan:** Build Flutter membutuhkan RAM lebih besar. Untuk VPS dengan RAM kecil, gunakan swap:
>
> ```bash
> sudo fallocate -l 4G /swapfile
> sudo chmod 600 /swapfile
> sudo mkswap /swapfile
> sudo swapon /swapfile
> echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
> ```

---

## ▶️ Menjalankan Bot

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

Setelah berjalan, Anda akan melihat:

```
🤖 Web2APK Bot berhasil dijalankan!
   Total users: X

🌐 Web Dashboard:
   Local:   http://139.59.108.177:2001
   Network: http://192.168.x.x:2001
```

---

## 📱 Cara Pakai - Telegram Bot

1. Buka bot di Telegram
2. Kirim `/start`
3. Klik **📱 BUAT APLIKASI (URL)**
4. Masukkan URL website
5. Masukkan nama aplikasi
6. Upload icon (opsional) atau skip
7. Pilih warna tema
8. Konfirmasi dan tunggu build selesai

---

## 🌐 Cara Pakai - Web Dashboard

### Build dari URL

1. Buka `http://139.59.108.177:2001`
2. Isi form **Build APK**:
   - Website URL
   - App Name
   - Upload Icon (opsional)
   - Pilih Theme Color
3. Klik **Build APK**
4. Download APK (link expires dalam 1 menit)

### Build dari ZIP (Flutter/Android Studio)

1. Buka `http://139.59.108.177:2001`
2. Scroll ke **Build Project (ZIP)**
3. Pilih Project Type: **Flutter** atau **Android Studio**
4. Pilih Build Type: **Debug** atau **Release**
5. Upload file ZIP project
6. Klik **Build Project**
7. Download APK (link expires dalam 1 menit)

---

## 📁 Struktur Project

```
├── src/
│   ├── bot.js              # Telegram bot entry point
│   ├── server.js           # Express web server
│   ├── handlers/           # Telegram handlers
│   ├── builder/            # APK builder engine
│   └── utils/              # Utilities
├── web/
│   ├── index.html          # Dashboard page
│   ├── css/style.css       # Styling
│   └── js/app.js           # Frontend logic
├── android-template/       # Template Android native
├── scripts/                # Setup scripts
├── package.json
└── .env.example
```

---

## 🔧 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/specs` | GET | Server specifications |
| `/api/stats` | GET | Bot statistics & queue status |
| `/api/build` | POST | Build APK from URL |
| `/api/build-zip` | POST | Build APK from ZIP project |
| `/api/download/:id` | GET | Download built APK |

---

## ❓ Troubleshooting

| Error | Solusi |
|-------|--------|
| `JAVA_HOME not set` | Jalankan ulang setup script atau restart terminal |
| `ANDROID_HOME not set` | Jalankan ulang setup script atau restart terminal |
| `Gradle not found` | Windows: `choco install gradle`, Linux: `sudo apt install gradle` |
| `Flutter not found` | Install Flutter SDK dan tambahkan ke PATH |
| `Build timeout` | Cek koneksi internet, build pertama butuh download dependencies |
| `APK too large (>50MB)` | Gunakan ProGuard, split per ABI, atau optimize assets |
| `Build Failed - Server error` (via domain) | **Cloudflare:** Ubah DNS ke "DNS Only" (awan abu). **Nginx:** Tambahkan `proxy_read_timeout 1800s;` |

---

## 📄 License

MIT License - Free to use and modify.

---

## 👤 Author

**KING NIXCAL** - [@ItsNixcaL](https://t.me/ItsNixcaL)
