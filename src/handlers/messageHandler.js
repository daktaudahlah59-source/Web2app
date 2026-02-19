const { getCancelKeyboard, getIconKeyboard } = require('../utils/keyboard');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

/**
 * Handle user messages during APK creation flow
 */
async function handleMessage(bot, msg, type = 'text') {
    const chatId = msg.chat.id;
    const session = global.sessions.get(chatId);

    // Ignore if no active session
    if (!session) return;

    const messageId = msg.message_id;

    switch (session.step) {
        case 'url':
            await handleUrlInput(bot, chatId, msg, session);
            break;

        case 'name':
            await handleNameInput(bot, chatId, msg, session);
            break;

        case 'icon':
            if (type === 'photo') {
                await handleIconUpload(bot, chatId, msg, session);
            }
            break;
    }
}

/**
 * Handle URL input
 */
async function handleUrlInput(bot, chatId, msg, session) {
    const url = msg.text?.trim();

    // Validate URL
    if (!url || !isValidUrl(url)) {
        await bot.sendMessage(chatId, '❌ URL tidak valid!\n\nMasukkan URL yang valid (contoh: https://example.com)', {
            reply_markup: getCancelKeyboard()
        });
        return;
    }

    session.data.url = url;
    session.step = 'name';
    global.sessions.set(chatId, session);

    const message = `
📱 *Buat APK Baru*

*Langkah 2/3: Nama Aplikasi*

✅ URL: ${url}

Sekarang, kirim nama untuk aplikasi Anda.

_Contoh: My App_
    `.trim();

    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: getCancelKeyboard()
    });
}

/**
 * Handle app name input
 */
async function handleNameInput(bot, chatId, msg, session) {
    const name = msg.text?.trim();

    // Validate name
    if (!name || name.length < 2 || name.length > 30) {
        await bot.sendMessage(chatId, '❌ Nama tidak valid!\n\nNama harus 2-30 karakter.', {
            reply_markup: getCancelKeyboard()
        });
        return;
    }

    session.data.appName = name;
    session.step = 'icon';
    global.sessions.set(chatId, session);

    const message = `
📱 *Buat APK Baru*

*Langkah 3/3: Icon Aplikasi*

✅ URL: ${session.data.url}
✅ Nama: ${name}

Kirim gambar untuk icon aplikasi (rasio 1:1 disarankan).

Atau klik "⏭️ Lewati" untuk menggunakan icon default.
    `.trim();

    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: getIconKeyboard()
    });
}

/**
 * Handle icon upload
 */
async function handleIconUpload(bot, chatId, msg, session) {
    try {
        const { downloadTelegramFile } = require('../utils/fileDownloader');

        // Get the largest photo
        const photo = msg.photo[msg.photo.length - 1];
        const fileId = photo.file_id;

        // Create temp directory
        const tempDir = path.join(__dirname, '..', '..', 'temp', uuidv4());
        await fs.ensureDir(tempDir);

        // Download using custom downloader (works with Local Bot API)
        const result = await downloadTelegramFile(bot, fileId, tempDir, 'icon.png');

        if (!result.success) {
            throw new Error(result.error || 'Download failed');
        }

        session.data.iconPath = result.path;
        session.step = 'confirm';
        global.sessions.set(chatId, session);

        const message = `
📱 *Konfirmasi Pembuatan APK*

*Detail Aplikasi:*
🌐 URL: ${session.data.url}
📝 Nama: ${session.data.appName}
🖼️ Icon: ✅ Custom (${Math.round(result.size / 1024)} KB)

Klik "✅ Buat APK" untuk memulai proses build.
        `.trim();

        const { getConfirmKeyboard } = require('../utils/keyboard');
        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: getConfirmKeyboard()
        });

    } catch (error) {
        console.error('Icon upload error:', error);
        const { getIconKeyboard } = require('../utils/keyboard');
        await bot.sendMessage(chatId, `❌ Gagal mengupload icon: ${error.message}\n\nSilakan coba lagi atau lewati.`, {
            reply_markup: getIconKeyboard()
        });
    }
}

/**
 * Validate URL
 */
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

module.exports = { handleMessage };
