require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs-extra');

// Handlers
const { handleStart } = require('./handlers/startHandler');
const { handleCallback, handleZipUpload, initQueueCallback } = require('./handlers/callbackHandler');
const { handleMessage } = require('./handlers/messageHandler');

// Utils
const { cleanupOldFiles } = require('./utils/cleanup');
const userService = require('./utils/userService');
const licenseKeyService = require('./utils/licenseKeyService');
const { downloadTelegramFile } = require('./utils/fileDownloader');
const { startWebServer, updateNotification } = require('./server');
const maintenanceService = require('./utils/maintenance');
const { isAdmin } = require('./utils/permissions');

// Validate environment
if (!process.env.BOT_TOKEN) {
    console.error('❌ Error: BOT_TOKEN tidak ditemukan di .env');
    console.error('   Silakan copy .env.example ke .env dan isi token bot Anda');
    process.exit(1);
}

// Bot configuration with Local Bot API support
const botOptions = { polling: true };

// Use Local Bot API Server if configured (enables 2GB file limit!)
if (process.env.LOCAL_API_URL) {
    botOptions.baseApiUrl = process.env.LOCAL_API_URL;
    console.log(`🚀 Using Local Bot API Server: ${process.env.LOCAL_API_URL}`);
    console.log('   File limit: 2GB upload/download');
} else {
    console.log('ℹ️  Using standard Bot API (api.telegram.org)');
    console.log('   File limit: 20MB download, 50MB upload');
}

// Create bot instance
const bot = new TelegramBot(process.env.BOT_TOKEN, botOptions);

// Store user sessions
global.sessions = new Map();

// Ensure directories exist
const dirs = ['temp', 'output'];
dirs.forEach(dir => {
    const dirPath = path.join(__dirname, '..', dir);
    fs.ensureDirSync(dirPath);
});

// Set bot commands menu
bot.setMyCommands([
    { command: 'start', description: '🏠 Mulai menggunakan bot' },
    { command: 'help', description: '❓ Bantuan & panduan' },
    { command: 'stats', description: '📊 Statistik bot (Admin)' },
    { command: 'broadcast', description: '📢 Broadcast pesan (Admin)' }
]).catch(e => console.error('Failed to set commands:', e.message));

// Initialize queue callback for auto-starting queued builds
initQueueCallback(bot);

// --- CHANNEL MEMBERSHIP CHECK ---
async function checkChannelMembership(userId) {
    const requiredChannel = process.env.REQUIRED_CHANNEL;
    if (!requiredChannel) return true; // No channel required

    try {
        const member = await bot.getChatMember(requiredChannel, userId);
        return ['member', 'administrator', 'creator'].includes(member.status);
    } catch (error) {
        console.warn(`Channel check failed for ${userId}:`, error.message);
        return true; // Allow if check fails
    }
}

// Command handlers
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    // Maintenance Check
    if (maintenanceService.isEnabled() && !isAdmin(chatId)) {
        return bot.sendMessage(chatId, `
⚠️ <b>MAINTENANCE MODE</b>
━━━━━━━━━━━━━━━━━━

Bot sedang dalam perbaikan server.
Hanya <b>Owner</b> yang dapat mengakses saat ini.

<i>Mohon coba lagi nanti.</i>
        `.trim(), { parse_mode: 'HTML' });
    }

    // Save user to database
    userService.saveUser(chatId, bot);

    // Check channel membership
    const isMember = await checkChannelMembership(chatId);
    if (!isMember) {
        const channelUsername = process.env.REQUIRED_CHANNEL.replace('@', '');
        return bot.sendMessage(chatId, `
⚠️ <b>Verifikasi Diperlukan</b>

Silakan join channel kami terlebih dahulu:
👉 @${channelUsername}

Setelah join, tekan /start lagi.
        `.trim(), {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    { text: '📢 Join Channel', url: `https://t.me/${channelUsername}` }
                ]]
            }
        });
    }

    handleStart(bot, msg);
});

bot.onText(/\/help/, (msg) => handleStart(bot, msg));

// --- ADMIN: STATS COMMAND ---
bot.onText(/\/stats/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    const stats = `
📊 <b>BOT STATISTICS</b>
━━━━━━━━━━━━━━━━━━
👥 Total Users: <code>${userService.getCount()}</code>
🔄 Active Sessions: <code>${global.sessions.size}</code>
⏱ Uptime: <code>${Math.floor(process.uptime() / 60)} minutes</code>
━━━━━━━━━━━━━━━━━━
    `.trim();

    bot.sendMessage(msg.chat.id, stats, { parse_mode: 'HTML' });
});

// --- ADMIN: ADD LICENSE KEY ---
bot.onText(/\/addkey(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const input = match[1];
    if (!input) {
        return bot.sendMessage(msg.chat.id, `
🔑 <b>ADD LICENSE KEY</b>
━━━━━━━━━━━━━━━━━━

<b>Penggunaan:</b>
<code>/addkey username,hari,telegram_id</code>

<b>Contoh:</b>
<code>/addkey john,30,123456789</code>
<code>/addkey user123,7,987654321</code>

💡 <i>Hari harus antara 1-365</i>

⚠️ <b>PENTING:</b>
<i>Pastikan user sudah /start bot ini terlebih dahulu agar link download dapat dikirim ke Telegram mereka!</i>
        `.trim(), { parse_mode: 'HTML' });
    }

    const parts = input.split(',').map(p => p.trim());
    if (parts.length !== 3) {
        return bot.sendMessage(msg.chat.id, '❌ Format salah! Gunakan: <code>/addkey username,hari,telegram_id</code>', { parse_mode: 'HTML' });
    }

    const [username, daysStr, telegramId] = parts;
    const days = parseInt(daysStr, 10);

    if (isNaN(days)) {
        return bot.sendMessage(msg.chat.id, '❌ Jumlah hari harus berupa angka!', { parse_mode: 'HTML' });
    }

    if (!telegramId || isNaN(parseInt(telegramId, 10))) {
        return bot.sendMessage(msg.chat.id, '❌ Telegram ID harus berupa angka!', { parse_mode: 'HTML' });
    }

    const result = licenseKeyService.createKey(username, days, telegramId);

    if (result.success) {
        // Send confirmation to admin
        bot.sendMessage(msg.chat.id, `
✅ <b>LICENSE KEY CREATED</b>
━━━━━━━━━━━━━━━━━━

👤 <b>Username:</b> <code>${result.username}</code>
🔑 <b>Key:</b> <code>${result.key}</code>
📅 <b>Berlaku:</b> ${result.days} hari
⏰ <b>Expired:</b> ${new Date(result.expiresAt).toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        })}
📱 <b>Telegram ID:</b> <code>${result.telegramId}</code>

📤 <i>Mengirim data ke user...</i>
        `.trim(), { parse_mode: 'HTML' });

        // Send credentials to user's Telegram
        const loginUrl = process.env.WEB_URL || `http://139.59.108.177:${process.env.WEB_PORT || 2001}`;

        try {
            await bot.sendMessage(telegramId, `
╔═══════════════════════════════╗
     🎉  <b>AKUN ANDA TELAH DIBUAT</b>  🎉
╚═══════════════════════════════╝

Selamat! Akun Web2APK Anda telah berhasil dibuat.

━━━━━━━━━━━━━━━━━━━━━━━━━━

👤 <b>Username:</b>
<code>${result.username}</code>

🔑 <b>License Key:</b>
<code>${result.key}</code>

📅 <b>Berlaku hingga:</b>
${new Date(result.expiresAt).toLocaleDateString('id-ID', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })}

━━━━━━━━━━━━━━━━━━━━━━━━━━

🌐 <b>Link Login:</b>
${loginUrl}/login.html

📱 <b>Cara Menggunakan:</b>
1. Klik link di atas atau buka di browser
2. Login dengan username dan key
3. Mulai convert URL atau ZIP menjadi APK!

⚠️ <i>Simpan data ini dengan baik. Jangan bagikan ke orang lain.</i>

━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 <i>Web2APK Bot - Auto Generated</i>
            `.trim(), { parse_mode: 'HTML' });

            // Notify admin that credentials were sent successfully
            bot.sendMessage(msg.chat.id, `✅ Data akun berhasil dikirim ke Telegram ID <code>${telegramId}</code>`, { parse_mode: 'HTML' });
        } catch (sendError) {
            // Failed to send to user
            bot.sendMessage(msg.chat.id, `
⚠️ <b>Gagal mengirim ke user!</b>
━━━━━━━━━━━━━━━━━━
Error: ${sendError.message}

<i>Kemungkinan penyebab:</i>
• User belum pernah /start bot ini
• Telegram ID salah
• User memblokir bot

💡 <i>Silakan kirim data akun secara manual ke user.</i>
            `.trim(), { parse_mode: 'HTML' });
        }
    } else {
        bot.sendMessage(msg.chat.id, `❌ <b>Gagal:</b> ${result.error}`, { parse_mode: 'HTML' });
    }
});

// --- ADMIN: LIST LICENSE KEYS ---
const KEYS_PER_PAGE = 5;

bot.onText(/\/listkey/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    await showLicenseKeyPage(bot, msg.chat.id, 0);
});

// Handle listkey pagination callbacks
bot.on('callback_query', async (query) => {
    if (!query.data.startsWith('listkey_page_')) return;
    if (!isAdmin(query.from.id)) {
        return bot.answerCallbackQuery(query.id, { text: '⛔ Akses ditolak' });
    }

    const page = parseInt(query.data.replace('listkey_page_', ''), 10);
    await bot.answerCallbackQuery(query.id);
    await showLicenseKeyPage(bot, query.message.chat.id, page, query.message.message_id);
});

async function showLicenseKeyPage(bot, chatId, page, messageId = null) {
    const keys = licenseKeyService.listKeys();

    if (keys.length === 0) {
        const emptyMsg = `
📋 <b>LICENSE KEYS</b>
━━━━━━━━━━━━━━━━━━

<i>Belum ada license key.</i>

💡 Gunakan <code>/addkey username,hari,telegram_id</code> untuk membuat key baru.
        `.trim();

        if (messageId) {
            return bot.editMessageText(emptyMsg, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' });
        }
        return bot.sendMessage(chatId, emptyMsg, { parse_mode: 'HTML' });
    }

    const totalPages = Math.ceil(keys.length / KEYS_PER_PAGE);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIdx = currentPage * KEYS_PER_PAGE;
    const pageKeys = keys.slice(startIdx, startIdx + KEYS_PER_PAGE);

    let message = `
📋 <b>LICENSE KEYS</b> (${keys.length})
━━━━━━━━━━━━━━━━━━
`;

    pageKeys.forEach((k, i) => {
        const status = k.isExpired ? '🔴 Expired' : (k.deviceId ? '🟢 Active' : '🟡 Unused');
        message += `
${startIdx + i + 1}. <b>${k.username}</b>
   🔑 <code>${k.key}</code>
   ${status} ${!k.isExpired ? `(${k.daysLeft} hari lagi)` : ''}
   📱 ${k.deviceId ? `Device: <code>${k.deviceId.substring(0, 12)}...</code>` : 'Belum login'}
   📲 Telegram: ${k.telegramId ? `<code>${k.telegramId}</code>` : '<i>Tidak ada</i>'}
`;
    });

    message += `
━━━━━━━━━━━━━━━━━━
📄 Halaman ${currentPage + 1}/${totalPages}
💡 <code>/delkey username</code> untuk hapus
💡 <code>/extendkey user,hari</code> untuk perpanjang`;

    // Build pagination buttons
    const buttons = [];
    if (currentPage > 0) {
        buttons.push({ text: '◀️ Prev', callback_data: `listkey_page_${currentPage - 1}` });
    }
    if (currentPage < totalPages - 1) {
        buttons.push({ text: 'Next ▶️', callback_data: `listkey_page_${currentPage + 1}` });
    }

    const keyboard = buttons.length > 0 ? { inline_keyboard: [buttons] } : undefined;

    if (messageId) {
        await bot.editMessageText(message.trim(), {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    } else {
        await bot.sendMessage(chatId, message.trim(), {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    }
}

// --- ADMIN: DELETE LICENSE KEY ---
bot.onText(/\/delkey(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const username = match[1]?.trim();
    if (!username) {
        return bot.sendMessage(msg.chat.id, `
🗑️ <b>DELETE LICENSE KEY</b>
━━━━━━━━━━━━━━━━━━

<b>Penggunaan:</b>
<code>/delkey username</code>

<b>Contoh:</b>
<code>/delkey john</code>
        `.trim(), { parse_mode: 'HTML' });
    }

    const result = licenseKeyService.deleteKey(username);

    if (result.success) {
        bot.sendMessage(msg.chat.id, `✅ License key untuk <b>${result.username}</b> berhasil dihapus.`, { parse_mode: 'HTML' });
    } else {
        bot.sendMessage(msg.chat.id, `❌ <b>Gagal:</b> ${result.error}`, { parse_mode: 'HTML' });
    }
});

// --- ADMIN: EXTEND LICENSE KEY ---
bot.onText(/\/extendkey(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const input = match[1];
    if (!input) {
        return bot.sendMessage(msg.chat.id, `
📅 <b>EXTEND LICENSE KEY</b>
━━━━━━━━━━━━━━━━━━

<b>Penggunaan:</b>
<code>/extendkey username,hari</code>

<b>Contoh:</b>
<code>/extendkey john,30</code>
<code>/extendkey user123,7</code>

💡 <i>Menambah masa aktif key (1-365 hari)</i>
💡 <i>Jika key sudah expired, akan dihitung dari hari ini</i>
        `.trim(), { parse_mode: 'HTML' });
    }

    const parts = input.split(',').map(p => p.trim());
    if (parts.length !== 2) {
        return bot.sendMessage(msg.chat.id, '❌ Format salah! Gunakan: <code>/extendkey username,hari</code>', { parse_mode: 'HTML' });
    }

    const [username, daysStr] = parts;
    const days = parseInt(daysStr, 10);

    if (isNaN(days)) {
        return bot.sendMessage(msg.chat.id, '❌ Jumlah hari harus berupa angka!', { parse_mode: 'HTML' });
    }

    const result = licenseKeyService.extendKey(username, days);

    if (result.success) {
        const newExpireDate = new Date(result.newExpiresAt).toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const prevExpireDate = new Date(result.previousExpires).toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        bot.sendMessage(msg.chat.id, `
✅ <b>LICENSE KEY EXTENDED</b>
━━━━━━━━━━━━━━━━━━

👤 <b>Username:</b> <code>${result.username}</code>
➕ <b>Ditambah:</b> ${result.addedDays} hari

📅 <b>Sebelum:</b> ${prevExpireDate}${result.wasExpired ? ' (EXPIRED)' : ''}
📅 <b>Sesudah:</b> ${newExpireDate}

${result.wasExpired ? '💡 <i>Key expired telah diaktifkan kembali!</i>' : ''}
        `.trim(), { parse_mode: 'HTML' });
    } else {
        bot.sendMessage(msg.chat.id, `❌ <b>Gagal:</b> ${result.error}`, { parse_mode: 'HTML' });
    }
});

// --- ANALYZE PROJECT COMMAND ---
bot.onText(/\/analyze(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;

    // Check if admin or licensed
    const isAuthorized = isAdmin(chatId) || licenseKeyService.isUserAuthorized(chatId);
    if (!isAuthorized) {
        return bot.sendMessage(chatId, '❌ Fitur ini hanya untuk user berlisensi atau admin.');
    }

    const projectType = match[1]?.toLowerCase();

    if (!projectType || !['flutter', 'android'].includes(projectType)) {
        return bot.sendMessage(chatId, `
🔍 <b>ANALYZE PROJECT</b>
━━━━━━━━━━━━━━━━━━

<b>Penggunaan:</b>
<code>/analyze flutter</code> - Untuk project Flutter
<code>/analyze android</code> - Untuk project Android

<b>Langkah:</b>
1. Kirim command di atas
2. Upload file ZIP project anda
3. Tunggu hasil analisis

💡 <i>Akan menjalankan flutter analyze atau gradle lint</i>
        `.trim(), { parse_mode: 'HTML' });
    }

    // Set session for file upload
    global.sessions.set(chatId, {
        step: 'analyze_upload',
        projectType: projectType,
        createdAt: Date.now()
    });

    bot.sendMessage(chatId, `
📤 <b>Upload Project ZIP</b>
━━━━━━━━━━━━━━━━━━

📁 <b>Tipe:</b> ${projectType.toUpperCase()}
🔍 <b>Mode:</b> Analyze

Kirim file <b>.zip</b> project anda sekarang.

⏱ <i>Menunggu file... (timeout: 30 menit)</i>
    `.trim(), { parse_mode: 'HTML' });

    setTimeout(() => {
        const session = global.sessions.get(chatId);
        if (session?.step === 'analyze_upload') {
            global.sessions.delete(chatId);
            bot.sendMessage(chatId, '⏰ Timeout! Silakan kirim /analyze lagi.');
        }
    }, 30 * 60 * 1000);
});

// --- CLEANUP PROJECT COMMAND ---
bot.onText(/\/cleanup(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;

    // Check if admin or licensed
    const isAuthorized = isAdmin(chatId) || licenseKeyService.isUserAuthorized(chatId);
    if (!isAuthorized) {
        return bot.sendMessage(chatId, '❌ Fitur ini hanya untuk user berlisensi atau admin.');
    }

    const projectType = match[1]?.toLowerCase();

    if (!projectType || !['flutter', 'android'].includes(projectType)) {
        return bot.sendMessage(chatId, `
🧹 <b>CLEANUP PROJECT</b>
━━━━━━━━━━━━━━━━━━

<b>Penggunaan:</b>
<code>/cleanup flutter</code> - Untuk project Flutter
<code>/cleanup android</code> - Untuk project Android

<b>Langkah:</b>
1. Kirim command di atas
2. Upload file ZIP project anda
3. Dapatkan project yang sudah bersih

💡 <i>Akan menghapus cache & build files</i>
        `.trim(), { parse_mode: 'HTML' });
    }

    global.sessions.set(chatId, {
        step: 'cleanup_upload',
        projectType: projectType,
        createdAt: Date.now()
    });

    bot.sendMessage(chatId, `
📤 <b>Upload Project ZIP</b>
━━━━━━━━━━━━━━━━━━

📁 <b>Tipe:</b> ${projectType.toUpperCase()}
🧹 <b>Mode:</b> Cleanup

Kirim file <b>.zip</b> project anda sekarang.

⏱ <i>Menunggu file... (timeout: 30 menit)</i>
    `.trim(), { parse_mode: 'HTML' });

    setTimeout(() => {
        const session = global.sessions.get(chatId);
        if (session?.step === 'cleanup_upload') {
            global.sessions.delete(chatId);
            bot.sendMessage(chatId, '⏰ Timeout! Silakan kirim /cleanup lagi.');
        }
    }, 30 * 60 * 1000);
});

// --- ADMIN: BROADCAST COMMAND ---
bot.onText(/\/broadcast(?: (.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const textContent = match[1];
    const isReply = msg.reply_to_message;

    if (!isReply && !textContent) {
        return bot.sendMessage(msg.chat.id, `
╔══════════════════════════╗
     📢  <b>BROADCAST CENTER</b>  📢
╚══════════════════════════╝

<b>📝 Cara Penggunaan:</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>1️⃣ Text Broadcast:</b>
<code>/broadcast &lt;pesan anda&gt;</code>

<b>2️⃣ Forward Message:</b>
Reply pesan apapun dengan <code>/broadcast</code>

<b>3️⃣ Rich Format (HTML):</b>
<code>/broadcast &lt;b&gt;Bold&lt;/b&gt; &lt;i&gt;Italic&lt;/i&gt;</code>

━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 Total Users: <code>${userService.getCount()}</code>
        `.trim(), { parse_mode: 'HTML' });
    }

    const users = userService.getBroadcastList();
    const totalUsers = users.length;
    const estimatedTime = Math.ceil(totalUsers * 0.05); // 50ms per user

    // Confirmation message
    const confirmMsg = await bot.sendMessage(msg.chat.id, `
╔══════════════════════════╗
   ⚠️  <b>KONFIRMASI BROADCAST</b>  ⚠️
╚══════════════════════════╝

📊 <b>Statistik:</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 Target: <code>${totalUsers}</code> users
⏱ Estimasi: <code>~${estimatedTime}</code> detik
📨 Tipe: ${isReply ? 'Forward Message' : 'Text Message'}

📝 <b>Preview:</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
${isReply ? '📎 <i>(Forward dari pesan yang di-reply)</i>' : textContent?.substring(0, 200) + (textContent?.length > 200 ? '...' : '')}

━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>Klik tombol untuk melanjutkan...</i>
    `.trim(), {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ Mulai Broadcast', callback_data: 'bc_confirm' },
                    { text: '❌ Batal', callback_data: 'bc_cancel' }
                ]
            ]
        }
    });

    // Store broadcast data temporarily
    global.pendingBroadcast = {
        adminId: msg.chat.id,
        confirmMsgId: confirmMsg.message_id,
        isReply,
        textContent,
        replyMsgId: isReply ? msg.reply_to_message.message_id : null,
        users,
        timestamp: Date.now()
    };
});

// Handle broadcast confirmation
bot.on('callback_query', async (query) => {
    if (!query.data.startsWith('bc_')) return;
    if (!isAdmin(query.from.id)) return;

    const action = query.data;
    const bc = global.pendingBroadcast;

    if (!bc || bc.adminId !== query.from.id) {
        return bot.answerCallbackQuery(query.id, { text: '⚠️ Session expired', show_alert: true });
    }

    if (action === 'bc_cancel') {
        await bot.editMessageText('❌ <b>Broadcast dibatalkan.</b>', {
            chat_id: bc.adminId,
            message_id: bc.confirmMsgId,
            parse_mode: 'HTML'
        });
        global.pendingBroadcast = null;
        return bot.answerCallbackQuery(query.id);
    }

    if (action === 'bc_confirm') {
        await bot.answerCallbackQuery(query.id, { text: '🚀 Memulai broadcast...' });

        const startTime = Date.now();
        let success = 0, failed = 0;
        const total = bc.users.length;

        // Progress bar function
        const getProgressBar = (current, total) => {
            const percent = Math.round((current / total) * 100);
            const filled = Math.round(percent / 5);
            const empty = 20 - filled;
            return '█'.repeat(filled) + '░'.repeat(empty);
        };

        // Initial progress message
        await bot.editMessageText(`
╔══════════════════════════╗
   🚀  <b>BROADCAST IN PROGRESS</b>  🚀
╚══════════════════════════╝

📊 <b>Progress:</b>
<code>[${getProgressBar(0, total)}]</code> 0%

📬 Sent: <code>0</code>
❌ Failed: <code>0</code>
👥 Total: <code>${total}</code>

⏱ Elapsed: <code>0s</code>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>⏳ Mohon tunggu...</i>
        `.trim(), {
            chat_id: bc.adminId,
            message_id: bc.confirmMsgId,
            parse_mode: 'HTML'
        });

        let lastUpdate = 0;

        for (let i = 0; i < bc.users.length; i++) {
            const userId = bc.users[i];

            try {
                if (bc.isReply) {
                    // For forwarded messages, send header first then forward
                    await bot.sendMessage(userId, `
╔═══════════════════════════════╗
     📢  <b>PENGUMUMAN RESMI</b>  📢
╚═══════════════════════════════╝
`, { parse_mode: 'HTML' });
                    await bot.forwardMessage(userId, bc.adminId, bc.replyMsgId);
                } else {
                    // For text messages, wrap in professional template
                    const formattedMessage = `
╔═══════════════════════════════╗
     📢  <b>PENGUMUMAN RESMI</b>  📢
╚═══════════════════════════════╝

${bc.textContent}

━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 <i>Pesan otomatis dari Web2APK Bot</i>
📅 <i>${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</i>
`.trim();
                    await bot.sendMessage(userId, formattedMessage, { parse_mode: 'HTML' });
                }
                success++;
            } catch (e) {
                failed++;
                if (e.response?.body?.error_code === 403) {
                    userService.removeUser(userId);
                }
            }

            // Update progress every 10 users or at the end
            const current = i + 1;
            if (current - lastUpdate >= 10 || current === total) {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                const percent = Math.round((current / total) * 100);

                await bot.editMessageText(`
╔══════════════════════════╗
   🚀  <b>BROADCAST IN PROGRESS</b>  🚀
╚══════════════════════════╝

📊 <b>Progress:</b>
<code>[${getProgressBar(current, total)}]</code> ${percent}%

📬 Sent: <code>${success}</code>
❌ Failed: <code>${failed}</code>
👥 Total: <code>${total}</code>

⏱ Elapsed: <code>${elapsed}s</code>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>⏳ ${current}/${total} processed...</i>
                `.trim(), {
                    chat_id: bc.adminId,
                    message_id: bc.confirmMsgId,
                    parse_mode: 'HTML'
                }).catch(() => { });

                lastUpdate = current;
            }

            await new Promise(r => setTimeout(r, 50));
        }

        const totalTime = Math.round((Date.now() - startTime) / 1000);
        const successRate = Math.round((success / total) * 100);

        // Final result
        await bot.editMessageText(`
╔══════════════════════════╗
   ✅  <b>BROADCAST COMPLETE</b>  ✅
╚══════════════════════════╝

📊 <b>Final Result:</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<code>[████████████████████]</code> 100%

📬 Sent: <code>${success}</code> ✓
❌ Failed: <code>${failed}</code>
📈 Success Rate: <code>${successRate}%</code>

⏱ Total Time: <code>${totalTime}s</code>
📅 Completed: <code>${new Date().toLocaleString('id-ID')}</code>
━━━━━━━━━━━━━━━━━━━━━━━━━━
${failed > 0 ? `\n⚠️ <i>${failed} users telah dihapus (blocked/deleted)</i>` : '🎉 <i>Semua pesan terkirim dengan sukses!</i>'}
        `.trim(), {
            chat_id: bc.adminId,
            message_id: bc.confirmMsgId,
            parse_mode: 'HTML'
        });

        global.pendingBroadcast = null;
    }
});

// Callback query handler (for inline buttons)
bot.on('callback_query', (query) => {
    // Save user on any interaction
    userService.saveUser(query.from.id, bot);
    handleCallback(bot, query);
});

// Message handler (for user input during APK creation)
// Moved to global listener at the bottom to support maintenance mode
/*
bot.on('message', (msg) => {
    // Skip commands
    if (msg.text && msg.text.startsWith('/')) return;
    handleMessage(bot, msg);
});
*/

// Photo handler (for custom icon)
bot.on('photo', (msg) => {
    // Maintenance Check
    if (maintenanceService.isEnabled() && !isAdmin(msg.chat.id)) {
        return bot.sendMessage(msg.chat.id, '⚠️ <b>MAINTENANCE MODE:</b> Upload foto tidak aktif.', { parse_mode: 'HTML' });
    }
    handleMessage(bot, msg, 'photo');
});

// Document handler (for ZIP file uploads)
// With Local Bot API Server, files up to 2GB are supported!
bot.on('document', async (msg) => {
    const chatId = msg.chat.id;

    // Maintenance Check
    if (maintenanceService.isEnabled() && !isAdmin(chatId)) {
        return bot.sendMessage(chatId, `
⚠️ <b>MAINTENANCE MODE</b>
━━━━━━━━━━━━━━━━━━

Upload file dinonaktifkan sementara.
        `.trim(), { parse_mode: 'HTML' });
    }

    const document = msg.document;

    // Check if it's a ZIP file
    if (document.file_name?.endsWith('.zip')) {
        const session = global.sessions.get(chatId);

        // Handle different upload modes
        if (session?.step === 'zip_upload' || session?.step === 'analyze_upload' || session?.step === 'cleanup_upload') {
            const fileSize = document.file_size || 0;
            const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);

            // Check file size limit based on API type
            const MAX_SIZE = process.env.LOCAL_API_URL
                ? 2 * 1024 * 1024 * 1024  // 2GB with Local Bot API
                : 20 * 1024 * 1024;        // 20MB with standard Bot API

            if (fileSize > MAX_SIZE) {
                const limitMB = process.env.LOCAL_API_URL ? '2048' : '20';
                return bot.sendMessage(chatId, `
⚠️ <b>File Terlalu Besar!</b>
━━━━━━━━━━━━━━━━━━

📦 <b>Ukuran:</b> ${fileSizeMB} MB
❌ <b>Batas:</b> ${limitMB} MB

${!process.env.LOCAL_API_URL ? `
💡 <b>Untuk file lebih besar:</b>
Setup Local Bot API Server untuk limit 2GB!
<code>sudo ./scripts/setup-local-api.sh API_ID API_HASH</code>
` : ''}
                `.trim(), { parse_mode: 'HTML' });
            }

            try {
                console.log(`📥 Downloading file (${fileSizeMB} MB)...`);
                console.log(`   File ID: ${document.file_id}`);
                console.log(`   Mode: ${session.step}`);

                // Use custom downloader that works with Local Bot API
                const fileName = document.file_name || `file_${Date.now()}.zip`;
                const result = await downloadTelegramFile(
                    bot,
                    document.file_id,
                    path.join(__dirname, '..', 'temp'),
                    fileName
                );

                if (!result.success) {
                    return bot.sendMessage(chatId, `❌ Gagal mengunduh file: ${result.error}`);
                }

                console.log(`✅ File downloaded: ${result.path}`);

                // Route based on session step
                if (session.step === 'zip_upload') {
                    await handleZipUpload(bot, chatId, result.path);
                } else if (session.step === 'analyze_upload') {
                    await handleAnalyzeUpload(bot, chatId, result.path, session.projectType);
                } else if (session.step === 'cleanup_upload') {
                    await handleCleanupUpload(bot, chatId, result.path, session.projectType);
                }

            } catch (error) {
                console.error('Error downloading ZIP:', error);
                bot.sendMessage(chatId, `❌ Gagal mengunduh file: ${error.message}`);
            }
        } else {
            bot.sendMessage(chatId, '⚠️ Untuk menggunakan file ZIP, kirim salah satu command:\n• /analyze flutter\n• /analyze android\n• /cleanup flutter\n• /cleanup android\n• Atau klik tombol BUILD PROJECT (ZIP)');
        }
    }
});

// --- ANALYZE UPLOAD HANDLER ---
async function handleAnalyzeUpload(bot, chatId, zipPath, projectType) {
    const { analyzeProject, safeExtractZip } = require('./builder/zipBuilder');
    const { v4: uuidv4 } = require('uuid');

    const jobId = uuidv4();
    const tempDir = path.join(__dirname, '..', 'temp', 'analyze-' + jobId);

    try {
        const statusMsg = await bot.sendMessage(chatId, `
🔍 <b>ANALYZING PROJECT</b>
━━━━━━━━━━━━━━━━━━

📁 Tipe: ${projectType.toUpperCase()}
⏳ Status: Mengekstrak file...
        `.trim(), { parse_mode: 'HTML' });

        // Extract ZIP using safe extraction (handles invalid filenames)
        const extractResult = await safeExtractZip(zipPath, tempDir);

        let statusText = 'Menjalankan analyze...';
        if (extractResult.sanitized) {
            statusText = 'Beberapa nama file disanitasi. Menjalankan analyze...';
        }

        await bot.editMessageText(`
🔍 <b>ANALYZING PROJECT</b>
━━━━━━━━━━━━━━━━━━

📁 Tipe: ${projectType.toUpperCase()}
⏳ Status: ${statusText}
        `.trim(), { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });

        // Find project root
        const targetFile = projectType === 'flutter' ? 'pubspec.yaml' : 'build.gradle';
        let projectRoot = tempDir;

        if (!await fs.pathExists(path.join(tempDir, targetFile))) {
            const items = await fs.readdir(tempDir);
            for (const item of items) {
                const itemPath = path.join(tempDir, item);
                if ((await fs.stat(itemPath)).isDirectory()) {
                    if (await fs.pathExists(path.join(itemPath, targetFile))) {
                        projectRoot = itemPath;
                        break;
                    }
                }
            }
        }

        const result = await analyzeProject(projectRoot, projectType);

        // Save log file
        const logDir = path.join(__dirname, '..', 'logs', 'tools');
        await fs.ensureDir(logDir);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFileName = `analyze_${projectType}_${timestamp}.txt`;
        const logFilePath = path.join(logDir, logFileName);

        const logContent = `=== PROJECT ANALYZE LOG ===
Date: ${new Date().toLocaleString('id-ID')}
Project Type: ${projectType}
Status: ${result.success ? 'SUCCESS' : 'FAILED'}

=== OUTPUT ===
${result.output || result.error || 'No output'}
`;
        await fs.writeFile(logFilePath, logContent);

        // Send result
        if (result.success) {
            await bot.editMessageText(`
✅ <b>ANALYZE COMPLETE</b>
━━━━━━━━━━━━━━━━━━

📁 Tipe: ${projectType.toUpperCase()}
📊 Status: Berhasil

📋 <b>Hasil telah dikirim sebagai file.</b>
            `.trim(), { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
        } else {
            await bot.editMessageText(`
❌ <b>ANALYZE FAILED</b>
━━━━━━━━━━━━━━━━━━

📁 Tipe: ${projectType.toUpperCase()}
⚠️ Error: ${result.error || 'Unknown error'}

📋 <b>Log telah dikirim sebagai file.</b>
            `.trim(), { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
        }

        // Send log file
        await bot.sendDocument(chatId, logFilePath, {
            caption: `📊 Analyze Log - ${projectType.toUpperCase()}`
        });

    } catch (error) {
        bot.sendMessage(chatId, `❌ Analyze gagal: ${error.message}`);
    } finally {
        global.sessions.delete(chatId);
        await fs.remove(zipPath).catch(() => { });
        await fs.remove(tempDir).catch(() => { });
    }
}

// --- CLEANUP UPLOAD HANDLER ---
async function handleCleanupUpload(bot, chatId, zipPath, projectType) {
    const { cleanupProject, safeExtractZip } = require('./builder/zipBuilder');
    const archiver = require('archiver');
    const { v4: uuidv4 } = require('uuid');

    const jobId = uuidv4();
    const tempDir = path.join(__dirname, '..', 'temp', 'cleanup-' + jobId);
    const outputZipPath = path.join(__dirname, '..', 'temp', `cleaned-${jobId}.zip`);

    try {
        const statusMsg = await bot.sendMessage(chatId, `
🧹 <b>CLEANING PROJECT</b>
━━━━━━━━━━━━━━━━━━

📁 Tipe: ${projectType.toUpperCase()}
⏳ Status: Mengekstrak file...
        `.trim(), { parse_mode: 'HTML' });

        // Extract ZIP using safe extraction (handles invalid filenames)
        const extractResult = await safeExtractZip(zipPath, tempDir);

        let statusText = 'Menjalankan cleanup...';
        if (extractResult.sanitized) {
            statusText = 'Beberapa nama file disanitasi. Menjalankan cleanup...';
        }

        await bot.editMessageText(`
🧹 <b>CLEANING PROJECT</b>
━━━━━━━━━━━━━━━━━━

📁 Tipe: ${projectType.toUpperCase()}
⏳ Status: ${statusText}
        `.trim(), { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });

        // Find project root
        const targetFile = projectType === 'flutter' ? 'pubspec.yaml' : 'build.gradle';
        let projectRoot = tempDir;

        if (!await fs.pathExists(path.join(tempDir, targetFile))) {
            const items = await fs.readdir(tempDir);
            for (const item of items) {
                const itemPath = path.join(tempDir, item);
                if ((await fs.stat(itemPath)).isDirectory()) {
                    if (await fs.pathExists(path.join(itemPath, targetFile))) {
                        projectRoot = itemPath;
                        break;
                    }
                }
            }
        }

        const result = await cleanupProject(projectRoot, projectType);

        if (result.success) {
            await bot.editMessageText(`
🧹 <b>CLEANING PROJECT</b>
━━━━━━━━━━━━━━━━━━

📁 Tipe: ${projectType.toUpperCase()}
⏳ Status: Mengompres hasil...
            `.trim(), { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });

            // Re-zip the cleaned project
            const output = fs.createWriteStream(outputZipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            await new Promise((resolve, reject) => {
                output.on('close', resolve);
                archive.on('error', reject);
                archive.pipe(output);
                archive.directory(projectRoot, false);
                archive.finalize();
            });

            const sizeSavedMB = ((result.savedBytes || 0) / (1024 * 1024)).toFixed(2);
            const sizeBeforeMB = ((result.sizeBefore || 0) / (1024 * 1024)).toFixed(2);
            const sizeAfterMB = ((result.sizeAfter || 0) / (1024 * 1024)).toFixed(2);

            await bot.editMessageText(`
✅ <b>CLEANUP COMPLETE</b>
━━━━━━━━━━━━━━━━━━

📁 Tipe: ${projectType.toUpperCase()}
📊 Before: ${sizeBeforeMB} MB
📊 After: ${sizeAfterMB} MB
💾 Saved: ${sizeSavedMB} MB

📥 <b>Mengirim file...</b>
            `.trim(), { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });

            // Send cleaned ZIP
            await bot.sendDocument(chatId, outputZipPath, {
                caption: `📦 Cleaned Project\n\n📊 Before: ${sizeBeforeMB} MB\n📊 After: ${sizeAfterMB} MB\n💾 Saved: ${sizeSavedMB} MB`
            });

        } else {
            await bot.editMessageText(`
❌ <b>CLEANUP FAILED</b>
━━━━━━━━━━━━━━━━━━

📁 Tipe: ${projectType.toUpperCase()}
⚠️ Error: ${result.error || 'Unknown error'}
            `.trim(), { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
        }

    } catch (error) {
        bot.sendMessage(chatId, `❌ Cleanup gagal: ${error.message}`);
    } finally {
        global.sessions.delete(chatId);
        await fs.remove(zipPath).catch(() => { });
        await fs.remove(tempDir).catch(() => { });
        await fs.remove(outputZipPath).catch(() => { });
    }
}

// Error handling
bot.on('polling_error', (error) => {
    console.error('Polling error:', error.message);
});

bot.on('error', (error) => {
    console.error('Bot error:', error.message);
});

// Cleanup scheduler (every 15 minutes for old files)
setInterval(() => {
    cleanupOldFiles(path.join(__dirname, '..', 'temp'), 15); // 15 min max age
    cleanupOldFiles(path.join(__dirname, '..', 'output'), 15);
}, 15 * 60 * 1000);

// Cleanup on startup - remove any leftover temp files from previous sessions
(async () => {
    console.log('🗑️ Cleaning up leftover temp files...');
    await cleanupOldFiles(path.join(__dirname, '..', 'temp'), 1); // Anything > 1 min old
    await cleanupOldFiles(path.join(__dirname, '..', 'output'), 1);
    console.log('✅ Startup cleanup complete');
})();

console.log('🤖 Web2APK Bot berhasil dijalankan!');
console.log(`   Total users: ${userService.getCount()} `);
console.log('   Tekan Ctrl+C untuk menghentikan bot');

// --- ADMIN: NOTIFICATION COMMAND ---
bot.onText(/\/notif(?: (.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const text = match[1];
    if (!text) {
        return bot.sendMessage(msg.chat.id, '❌ Gunakan format: <code>/notif pesan anda</code>', { parse_mode: 'HTML' });
    }

    updateNotification(text);

    bot.sendMessage(msg.chat.id, `
✅ <b>Notifikasi Dikirim!</b>
━━━━━━━━━━━━━━━━━━
📝 <b>Pesan:</b>
${text}

        <i>Akan muncul di aplikasi dalam ~1 menit.</i>
        `.trim(), { parse_mode: 'HTML' });
});

// --- ADMIN: MAINTENANCE COMMAND ---
bot.onText(/\/maintenance(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const action = match[1]?.toLowerCase();
    if (!action || !['on', 'off'].includes(action)) {
        const status = maintenanceService.isEnabled() ? '✅ ON' : '❌ OFF';
        return bot.sendMessage(msg.chat.id, `
🛠 <b>MAINTENANCE MODE</b>
━━━━━━━━━━━━━━━━━━

Status: ${status}

<b>Penggunaan:</b>
<code>/maintenance on</code> - Aktifkan mode perbaikan
<code>/maintenance off</code> - Matikan mode perbaikan

⚠️ <i>Saat ON, user dan pemilik key addkey TIDAK BISA menggunakan bot. Hanya ADMIN yang terdaftar di env yang bisa.</i>
        `.trim(), { parse_mode: 'HTML' });
    }

    const enable = action === 'on';
    maintenanceService.set(enable);

    bot.sendMessage(msg.chat.id, `
${enable ? '🔴' : '🟢'} <b>MAINTENANCE MODE ${enable ? 'ACTIVATED' : 'DEACTIVATED'}</b>
━━━━━━━━━━━━━━━━━━

Bot sekarang ${enable ? 'HANYA bisa diakses oleh Owner.' : 'bisa diakses oleh semua user.'}
    `.trim(), { parse_mode: 'HTML' });
});

// Global check for other messages
bot.on('message', (msg) => {
    // Skip if maintenance is off or user is admin
    if (!maintenanceService.isEnabled() || isAdmin(msg.chat.id)) {
        // Continue to other handlers...

        // Skip commands (they are handled by onText, but we need to check maintenance there too)
        if (msg.text && msg.text.startsWith('/')) return;

        // Only trigger handleMessage if not a command
        handleMessage(bot, msg);
        return;
    }

    // If maintenance is ON and user is NOT admin
    // Only send message if it's NOT a command (to avoid double reply with onText)
    // AND if it's a private chat
    if (msg.chat.type === 'private' && (!msg.text || !msg.text.startsWith('/'))) {
        bot.sendMessage(msg.chat.id, `
⚠️ <b>MAINTENANCE MODE</b>
━━━━━━━━━━━━━━━━━━

Bot sedang dalam perbaikan.
Silakan coba lagi nanti.
        `.trim(), { parse_mode: 'HTML' });
    }
});

// Inject maintenance check for documents
const originalOnDocument = bot.on.bind(bot);
/*
  We can't easily override 'on' since it's an event emitter.
  Instead, we'll add a check inside the existing document handler.
  BUT, looking at line 817, we can wrap the logic or easier:
  Since we modify the file, let's just add the check at the top of the 'document' handler block.
*/

// Start Web Server
startWebServer();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Bot dihentikan');
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Bot dihentikan');
    bot.stopPolling();
    process.exit(0);
});
