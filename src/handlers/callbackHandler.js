const { getMainKeyboard, getConfirmKeyboard, getCancelKeyboard, getZipTypeKeyboard, getZipBuildTypeKeyboard } = require('../utils/keyboard');
const { buildApk } = require('../builder/apkBuilder');
const { buildFromZip } = require('../builder/zipBuilder');
const { sendBuildReport } = require('../utils/adminReporter');
const { formatBuildProgress, formatBuildStartMessage, formatSuccessMessage, formatErrorMessage, formatZipBuildProgress } = require('../utils/progressUI');
const { buildQueue } = require('../utils/buildQueue');
const licenseKeyService = require('../utils/licenseKeyService');
const path = require('path');
const fs = require('fs-extra');

/**
 * Escape HTML special characters to prevent parse errors
 */
function escapeHtml(text) {
    if (!text) return 'User';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Handle callback queries from inline buttons
 */
async function handleCallback(bot, query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Extract user information from query
    const userInfo = {
        id: query.from.id,
        firstName: query.from.first_name || 'User',
        lastName: query.from.last_name || '',
        username: query.from.username || null
    };

    // Acknowledge callback
    await bot.answerCallbackQuery(query.id);

    switch (data) {
        case 'create_apk':
            await startCreateApk(bot, chatId, messageId, userInfo);
            break;

        case 'help':
            await showHelp(bot, chatId, messageId);
            break;

        case 'back_main':
            await backToMain(bot, chatId, messageId);
            break;

        case 'cancel':
            await cancelProcess(bot, chatId, messageId);
            break;

        case 'skip_icon':
            await skipIcon(bot, chatId, messageId);
            break;

        case 'confirm_build':
            await confirmBuild(bot, chatId, messageId);
            break;

        case 'build_zip':
            await startBuildZip(bot, chatId, messageId);
            break;

        case 'zip_android':
            await selectZipType(bot, chatId, messageId, 'android', userInfo);
            break;

        case 'zip_flutter':
            await selectZipType(bot, chatId, messageId, 'flutter', userInfo);
            break;

        case 'zipbuild_debug':
            await selectZipBuildType(bot, chatId, messageId, 'debug', userInfo);
            break;

        case 'zipbuild_release':
            await selectZipBuildType(bot, chatId, messageId, 'release', userInfo);
            break;

        case 'server_status':
            await showServerStatus(bot, chatId, messageId);
            break;

        case 'check_queue':
            await showQueueStatus(bot, chatId, messageId);
            break;

        case 'thanks_to':
            await showThanksTo(bot, chatId, messageId);
            break;

        case 'show_commands':
            await showCommandsMenu(bot, chatId, messageId, query.from);
            break;

        case 'cancel_queue':
            await cancelQueuedBuild(bot, chatId, messageId);
            break;
    }
}

/**
 * Start APK creation flow
 */
async function startCreateApk(bot, chatId, messageId, userInfo = {}) {
    // Initialize session with user info
    const fullName = [userInfo.firstName, userInfo.lastName].filter(Boolean).join(' ').trim() || 'Unknown';

    // Get license username if user is a member
    const licenseUsername = licenseKeyService.getUsernameByTelegramId(chatId);

    // Build display name: "Name (@username) [license]"
    let displayName = fullName;
    if (userInfo.username) {
        displayName += ` (@${userInfo.username})`;
    }
    if (licenseUsername) {
        displayName += ` [${licenseUsername}]`;
    }

    global.sessions.set(chatId, {
        step: 'url',
        userName: displayName,
        userUsername: userInfo.username || null,
        licenseUsername: licenseUsername,
        data: {
            url: null,
            appName: null,
            iconPath: null,
            themeColor: '#2196F3'
        }
    });

    // Delete old photo message
    await bot.deleteMessage(chatId, messageId).catch(() => { });

    const message = `
📱 <b>Buat APK Baru</b>
━━━━━━━━━━━━━━━━━━

<b>Langkah 1/3: URL Website</b>

Silakan kirim URL website yang ingin dikonversi menjadi APK.

<i>Contoh: https://example.com</i>
    `.trim();

    await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: getCancelKeyboard()
    });
}

/**
 * Show help message
 */
async function showHelp(bot, chatId, messageId) {
    const helpMessage = `
📚 <b>PANDUAN WEB2APK BOT</b>
━━━━━━━━━━━━━━━━━━

<b>📱 Cara Membuat APK:</b>
1. Klik tombol "BUAT APLIKASI SEKARANG"
2. Masukkan URL website target
3. Masukkan nama aplikasi
4. Upload icon (opsional)
5. Tunggu proses build (~1-3 menit)

<b>💡 Tips:</b>
• URL harus dimulai dengan http:// atau https://
• Nama aplikasi maksimal 30 karakter
• Icon sebaiknya ukuran 512x512 px
• Format icon: JPG/PNG

<b>❓ Butuh Bantuan?</b>
Hubungi: @ItsNixcaL
    `.trim();

    // Delete old message (photo) and send new text message
    await bot.deleteMessage(chatId, messageId).catch(() => { });

    await bot.sendMessage(chatId, helpMessage, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '◀️ Kembali ke Menu', callback_data: 'back_main' }]
            ]
        }
    });
}

/**
 * Show server status (queue status)
 */
async function showServerStatus(bot, chatId, messageId) {
    const queueInfo = buildQueue.getQueueInfo();
    const activeBuilds = buildQueue.getActiveBuilds();
    const stats = buildQueue.getStats();

    let statusMessage;
    if (activeBuilds.length > 0) {
        const build = activeBuilds[0];
        const minutes = Math.floor(build.duration / 60);
        const seconds = build.duration % 60;

        statusMessage = `
📊 <b>Status Server</b>
━━━━━━━━━━━━━━━━━━

🔴 <b>Status:</b> Sedang Build
📊 <b>Slot:</b> ${queueInfo.processing}/${queueInfo.maxConcurrent}
⏱️ <b>Build pertama:</b> ${minutes}m ${seconds}s
⏳ <b>Antrian:</b> ${queueInfo.waiting} menunggu

💡 <i>Build baru akan masuk antrian otomatis.</i>
        `.trim();
    } else {
        statusMessage = `
📊 <b>Status Server</b>
━━━━━━━━━━━━━━━━━━

🟢 <b>Status:</b> Tersedia
📊 <b>Slot:</b> ${queueInfo.processing}/${queueInfo.maxConcurrent}
✅ <b>Antrian:</b> Kosong

<b>📈 Statistik:</b>
✅ ${stats.success} berhasil | ❌ ${stats.failed} gagal

💡 <i>Server siap menerima build baru!</i>
        `.trim();
    }

    // Delete old message (may be photo) and send new text message
    await bot.deleteMessage(chatId, messageId).catch(() => { });

    await bot.sendMessage(chatId, statusMessage, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔄 Refresh', callback_data: 'server_status' }],
                [{ text: '◀️ Kembali ke Menu', callback_data: 'back_main' }]
            ]
        }
    });
}

/**
 * Show Queue Status - Professional Edition
 * Shows queue list with user names, positions, and statistics
 */
async function showQueueStatus(bot, chatId, messageId) {
    const queueInfo = buildQueue.getQueueInfo();
    const stats = buildQueue.getStats();
    const userPosition = buildQueue.getUserPosition(chatId);
    const isActive = buildQueue.hasActiveBuild(chatId);
    const activeBuilds = buildQueue.getActiveBuilds();
    const queueList = buildQueue.getQueueList();
    const session = global.sessions.get(chatId);

    // Status indicator
    let statusIcon = '🟢';
    let statusText = 'Siap';
    if (queueInfo.processing >= queueInfo.maxConcurrent) {
        statusIcon = '🔴';
        statusText = 'Penuh';
    } else if (queueInfo.processing > 0) {
        statusIcon = '🟡';
        statusText = 'Aktif';
    }

    let queueMessage = `📋 <b>Status Antrian Build</b>\n━━━━━━━━━━━━━━━━━━\n\n`;
    queueMessage += `${statusIcon} <b>Server:</b> ${statusText}\n`;
    queueMessage += `📊 <b>Slot:</b> ${queueInfo.processing}/${queueInfo.maxConcurrent}\n`;

    // Show active builds with user names
    if (activeBuilds.length > 0) {
        queueMessage += `\n<b>🔨 Sedang Berjalan:</b>\n`;
        for (const build of activeBuilds) {
            const mins = Math.floor(build.duration / 60);
            const secs = build.duration % 60;
            const isMe = build.chatId === chatId;
            queueMessage += `${isMe ? '👉 ' : '• '}<b>${escapeHtml(build.userName)}</b> - ${escapeHtml(build.projectName)} (${mins}m ${secs}s)${isMe ? ' ← Anda' : ''}\n`;
        }
    }

    // Show queue with user names
    if (queueList.length > 0) {
        queueMessage += `\n<b>⏳ Antrian (${queueList.length}):</b>\n`;
        for (const item of queueList.slice(0, 8)) {
            const isMe = item.chatId === chatId;
            const priority = item.priority ? '👑 ' : '';
            queueMessage += `${item.position}. ${priority}<b>${escapeHtml(item.userName)}</b> - ${escapeHtml(item.projectName)}${isMe ? ' ← Anda' : ''}\n`;
        }
        if (queueList.length > 8) {
            queueMessage += `<i>...dan ${queueList.length - 8} lainnya</i>\n`;
        }
    }

    // Statistics
    queueMessage += `\n<b>📈 Statistik:</b>\n`;
    queueMessage += `✅ ${stats.success} berhasil | ❌ ${stats.failed} gagal | ⏱ ~${stats.avgTime}s\n`;

    // User's personal status
    if (isActive) {
        const myBuild = activeBuilds.find(b => b.chatId === chatId);
        if (myBuild) {
            queueMessage += `\n🔄 <b>Build Anda sedang berjalan!</b>`;
        }
    } else if (userPosition > 0) {
        const estimatedWait = buildQueue.getEstimatedWait(userPosition);
        queueMessage += `\n🎫 <b>Anda di posisi #${userPosition}</b> (~${estimatedWait} menit)`;
        queueMessage += `\n✅ <i>Build otomatis dimulai saat giliran tiba!</i>`;
    } else if (session && session.step) {
        queueMessage += `\n📝 <b>Anda sedang:</b> ${getStepDescription(session.step)}`;
    } else {
        queueMessage += `\n💡 <i>Klik menu untuk mulai build!</i>`;
    }

    // Buttons
    let replyMarkup;
    if (isActive) {
        replyMarkup = {
            inline_keyboard: [
                [{ text: '🔄 Refresh', callback_data: 'check_queue' }]
            ]
        };
    } else if (userPosition > 0) {
        replyMarkup = {
            inline_keyboard: [
                [{ text: '🔄 Refresh', callback_data: 'check_queue' }],
                [{ text: '❌ Batalkan Antrian', callback_data: 'cancel_queue' }]
            ]
        };
    } else {
        replyMarkup = {
            inline_keyboard: [
                [{ text: '🔄 Refresh', callback_data: 'check_queue' }],
                [{ text: '◀️ Kembali ke Menu', callback_data: 'back_main' }]
            ]
        };
    }

    await bot.deleteMessage(chatId, messageId).catch(() => { });

    await bot.sendMessage(chatId, queueMessage, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup
    });
}

/**
 * Cancel queued build
 */
async function cancelQueuedBuild(bot, chatId, messageId) {
    const session = global.sessions.get(chatId);

    // Remove from pending queue
    buildQueue.removeFromQueue(chatId);

    // Clean up icon if exists
    if (session?.data?.iconPath) {
        await fs.remove(session.data.iconPath).catch(() => { });
    }

    // Clear session
    global.sessions.delete(chatId);

    await bot.deleteMessage(chatId, messageId).catch(() => { });

    await bot.sendMessage(chatId, `
✅ <b>Antrian Dibatalkan</b>
━━━━━━━━━━━━━━━━━━

Build Anda telah dihapus dari antrian.

💡 <i>Klik tombol di bawah untuk memulai build baru.</i>
    `.trim(), {
        parse_mode: 'HTML',
        reply_markup: getMainKeyboard()
    });
}

/**
 * Helper: Get step description
 */
function getStepDescription(step) {
    const descriptions = {
        'url': 'Input URL',
        'app_name': 'Input nama aplikasi',
        'icon': 'Upload icon',
        'confirm': 'Konfirmasi build',
        'zip_upload': 'Upload file ZIP',
        'zip_type': 'Pilih tipe project',
        'analyze_upload': 'Upload untuk Analyze',
        'cleanup_upload': 'Upload untuk Cleanup'
    };
    return descriptions[step] || step;
}

/**
 * Show Commands Menu - role-based command list
 */
async function showCommandsMenu(bot, chatId, messageId, userInfo) {
    const adminIds = process.env.ADMIN_IDS?.split(',').map(id => id.trim()) || [];
    const isOwner = adminIds.includes(String(userInfo.id));
    const isLicensed = licenseKeyService.isUserAuthorized(userInfo.id);

    let menuMessage = `
📜 <b>DAFTAR PERINTAH</b>
━━━━━━━━━━━━━━━━━━
`;

    if (isOwner) {
        // Owner sees ALL commands
        menuMessage += `
👑 <b>OWNER COMMANDS</b>
━━━━━━━━━━━━━━━━━━

<b>📊 Admin Commands:</b>
/stats - Statistik bot
/broadcast - Broadcast pesan
/listkey - Daftar license keys
/addkey - Tambah license key
/delkey - Hapus license key
/extendkey - Perpanjang license
/maintenance - Mode Maintenance

<b>🔧 Project Tools:</b>
/analyze flutter - Analyze Flutter project
/analyze android - Analyze Android project
/cleanup flutter - Cleanup Flutter project
/cleanup android - Cleanup Android project

<b>📋 General:</b>
/start - Mulai bot
/help - Bantuan
`;
    } else if (isLicensed) {
        // Licensed member sees tools
        menuMessage += `
🎫 <b>MEMBER COMMANDS</b>
━━━━━━━━━━━━━━━━━━

<b>🔧 Project Tools:</b>
/analyze flutter - Analyze Flutter project
/analyze android - Analyze Android project
/cleanup flutter - Cleanup Flutter project
/cleanup android - Cleanup Android project

<b>📋 General:</b>
/start - Mulai bot
/help - Bantuan

💡 <i>Upload file ZIP setelah mengirim command</i>
`;
    } else {
        // Regular user
        menuMessage += `
👤 <b>USER COMMANDS</b>
━━━━━━━━━━━━━━━━━━

<b>📋 General:</b>
/start - Mulai bot
/help - Bantuan

⚠️ <i>Dapatkan license untuk akses tools!</i>
`;
    }

    await bot.deleteMessage(chatId, messageId).catch(() => { });

    await bot.sendMessage(chatId, menuMessage.trim(), {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '◀️ Kembali ke Menu', callback_data: 'back_main' }]
            ]
        }
    });
}

/**
 * Show Thanks To - credits and support
 */
async function showThanksTo(bot, chatId, messageId) {
    const thanksMessage = `
🙏 <b>Thanks You To (TQTO)</b>
━━━━━━━━━━━━━━━━━━

Terima kasih kepada:

👤 <b>Pengguna setia Web2APK</b>
   Kalian yang selalu support kami!

👥 <b>Member komunitas</b>
   Terus berkembang bersama!

⭐ <b>Special thanks to:</b>
   @Otapengenkawin
   <i>Sebagai support development</i>

━━━━━━━━━━━━━━━━━━
💙 <i>Terima kasih sudah menggunakan Web2APK!</i>
    `.trim();

    await bot.deleteMessage(chatId, messageId).catch(() => { });

    await bot.sendMessage(chatId, thanksMessage, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '◀️ Kembali ke Menu', callback_data: 'back_main' }]
            ]
        }
    });
}

/**
 * Back to main menu
 */
async function backToMain(bot, chatId, messageId) {
    global.sessions.delete(chatId);

    // Delete old message and send new photo with menu
    await bot.deleteMessage(chatId, messageId).catch(() => { });

    const welcomeCaption = `
🤖 <b>Web2Apk Pro Bot Gen 3</b>

Konversi website menjadi aplikasi Android native dengan mudah!

👇 <b>Klik tombol di bawah untuk memulai:</b>
    `.trim();

    await bot.sendPhoto(chatId, 'https://files.catbox.moe/5z33zb.jpg', {
        caption: welcomeCaption,
        parse_mode: 'HTML',
        reply_markup: getMainKeyboard()
    }).catch(async () => {
        // Fallback if photo fails
        await bot.sendMessage(chatId, welcomeCaption, {
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
        });
    });
}

/**
 * Cancel current process
 */
async function cancelProcess(bot, chatId, messageId) {
    const session = global.sessions.get(chatId);

    // Clean up icon if exists
    if (session?.data?.iconPath) {
        await fs.remove(session.data.iconPath).catch(() => { });
    }

    global.sessions.delete(chatId);

    await bot.editMessageText('❌ Proses dibatalkan.\n\nKlik tombol di bawah untuk memulai lagi.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: getMainKeyboard()
    });
}

/**
 * Skip icon upload
 */
async function skipIcon(bot, chatId, messageId) {
    const session = global.sessions.get(chatId);
    if (!session) return;

    session.step = 'confirm';
    global.sessions.set(chatId, session);

    const message = `
📱 *Konfirmasi Pembuatan APK*

*Detail Aplikasi:*
🌐 URL: ${session.data.url}
📝 Nama: ${session.data.appName}
🖼️ Icon: Default

Klik "✅ Buat APK" untuk memulai proses build.
    `.trim();

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: getConfirmKeyboard()
    });
}

/**
 * Confirm and start build (with auto-queue)
 */
async function confirmBuild(bot, chatId, messageId) {
    const session = global.sessions.get(chatId);
    if (!session) return;

    // Get user name for queue display
    const userName = session.userName || session.userUsername || 'User';

    // Prepare build data for queue
    const buildData = {
        ...session.data,
        userName: userName,
        userUsername: session.userUsername,
        messageId: messageId
    };

    // Try to add to queue (will auto-queue if busy)
    const queueResult = buildQueue.addToQueue(chatId, buildData, 'url', userName);

    if (!queueResult.immediate) {
        // Added to pending queue - show position with queue list
        const queueList = buildQueue.getQueueList();
        const activeBuilds = buildQueue.getActiveBuilds();

        let queueMessage = `📋 <b>Build Masuk Antrian</b>\n━━━━━━━━━━━━━━━━━━\n\n`;

        // Show priority badge if admin
        if (queueResult.isPriority) {
            queueMessage += `👑 <b>PRIORITAS!</b>\n\n`;
        }

        queueMessage += `🎫 <b>Posisi Anda:</b> #${queueResult.position}\n`;
        queueMessage += `⏱ <b>Estimasi:</b> ~${queueResult.estimatedWait} menit\n\n`;

        // Show active builds
        if (activeBuilds.length > 0) {
            queueMessage += `<b>🔨 Sedang Berjalan:</b>\n`;
            for (const build of activeBuilds) {
                const mins = Math.floor(build.duration / 60);
                queueMessage += `• ${escapeHtml(build.userName)} (${mins}m)\n`;
            }
            queueMessage += `\n`;
        }

        // Show queue ahead of user
        const aheadOfMe = queueList.filter(q => q.position < queueResult.position);
        if (aheadOfMe.length > 0) {
            queueMessage += `<b>⏳ Di Depan Anda:</b>\n`;
            for (const item of aheadOfMe.slice(0, 5)) {
                const priority = item.priority ? '👑 ' : '';
                queueMessage += `${item.position}. ${priority}${escapeHtml(item.userName)}\n`;
            }
            if (aheadOfMe.length > 5) {
                queueMessage += `<i>...${aheadOfMe.length - 5} lainnya</i>\n`;
            }
            queueMessage += `\n`;
        }

        queueMessage += `<b>📝 Aplikasi Anda:</b>\n`;
        queueMessage += `📱 ${escapeHtml(session.data.appName)}\n`;
        queueMessage += `🌐 <code>${session.data.url}</code>\n\n`;
        queueMessage += `✅ <i>Build otomatis dimulai saat giliran tiba!</i>\n`;
        queueMessage += `💡 <i>Anda akan dinotifikasi saat build dimulai.</i>`;

        await bot.editMessageText(queueMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Cek Status Antrian', callback_data: 'check_queue' }],
                    [{ text: '❌ Batalkan Antrian', callback_data: 'cancel_queue' }]
                ]
            }
        });

        // Keep session for when build starts from queue
        return;
    }

    // Slot available - start build immediately
    let currentProgress = 0;
    let buildResult = null;
    let buildSuccess = false; // Track success for queue stats

    // Initial build message with progress bar
    await bot.editMessageText(formatBuildStartMessage(escapeHtml(session.data.appName), session.data.url), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML'
    });

    try {
        // Build APK with progress updates
        buildResult = await buildApk(session.data, (status) => {
            // Update queue activity timestamp to prevent false inactivity timeout
            buildQueue.updateActivity();

            // Update progress (estimate based on status)
            if (status.includes('Preparing')) currentProgress = 10;
            else if (status.includes('Generating')) currentProgress = 25;
            else if (status.includes('Copying')) currentProgress = 40;
            else if (status.includes('Configuring')) currentProgress = 55;
            else if (status.includes('Building') || status.includes('Gradle')) currentProgress = 70;
            else if (status.includes('Packaging')) currentProgress = 85;
            else if (status.includes('Complete') || status.includes('Success')) currentProgress = 100;
            else currentProgress = Math.min(currentProgress + 5, 95);

            bot.editMessageText(formatBuildProgress(currentProgress, status, escapeHtml(session.data.appName)), {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML'
            }).catch(() => { });
        });

        if (buildResult.success) {
            // Success message
            await bot.editMessageText(formatSuccessMessage(escapeHtml(session.data.appName), session.data.url), {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML'
            });

            await bot.sendDocument(chatId, buildResult.apkPath, {
                caption: `✅ <b>${escapeHtml(session.data.appName)}</b>\n\n🌐 <code>${session.data.url}</code>\n\n<i>Generated by Web2APK Bot</i>`,
                parse_mode: 'HTML'
            });

            // Show success message with main menu
            await bot.sendMessage(chatId, '🎉 APK berhasil dikirim!\n\nIngin membuat APK lagi?', {
                reply_markup: getMainKeyboard()
            });

            // Send report to admin
            sendBuildReport(bot, {
                id: chatId,
                name: session.userName || 'Unknown',
                username: session.userUsername || null
            }, session.data);

            buildSuccess = true; // Mark as success for stats

        } else {
            throw new Error(buildResult.error);
        }

    } catch (error) {
        console.error('Build error:', error);

        // Save error log to file
        const logDir = path.join(__dirname, '..', '..', 'logs', 'errors');
        await fs.ensureDir(logDir);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFileName = `build_error_${timestamp}.txt`;
        const logFilePath = path.join(logDir, logFileName);

        const logContent = `=== BUILD ERROR LOG ===
Date: ${new Date().toLocaleString('id-ID')}
User: ${session?.userName || 'Unknown'} (@${session?.userUsername || 'N/A'}) (ID: ${chatId})

=== APP INFO ===
Name: ${session?.data?.appName || 'N/A'}
URL: ${session?.data?.url || 'N/A'}
Icon: ${session?.data?.iconPath ? 'Custom' : 'Default'}

=== ERROR ===
${error.message || error}

=== STACK TRACE ===
${error.stack || 'No stack trace available'}
`;
        await fs.writeFile(logFilePath, logContent);

        // Send error message
        await bot.editMessageText(formatErrorMessage(error.message), {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
        });

        // Send error log file
        await bot.sendDocument(chatId, logFilePath, {
            caption: `📋 Error Log - ${session?.data?.appName || 'Build'} \n\n💡 Kirim file ini ke admin jika butuh bantuan.`
        }).catch(() => { });
    } finally {
        // ALWAYS cleanup - this runs whether success or error

        // Clean up APK file
        if (buildResult?.apkPath) {
            await fs.remove(buildResult.apkPath).catch(() => { });
            console.log(`🗑️ Cleaned APK: ${buildResult.apkPath} `);
        }

        // Clean up temp build directory
        if (buildResult?.buildDir) {
            await fs.remove(buildResult.buildDir).catch(() => { });
            console.log(`🗑️ Cleaned temp dir: ${buildResult.buildDir} `);
        }

        // Clean up uploaded icon
        if (session?.data?.iconPath) {
            await fs.remove(session.data.iconPath).catch(() => { });
        }

        // Release build queue lock with success/fail status
        buildQueue.release(chatId, buildSuccess);

        // Clean up session
        global.sessions.delete(chatId);
    }
}

/**
 * Start ZIP project build flow
 */
async function startBuildZip(bot, chatId, messageId) {
    // Check if user has access to ZIP build feature
    const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const licenseKeyService = require('../utils/licenseKeyService');

    const isAdmin = ADMIN_IDS.includes(String(chatId));
    const hasLicense = licenseKeyService.isUserAuthorized(chatId);

    if (!isAdmin && !hasLicense) {
        await bot.deleteMessage(chatId, messageId).catch(() => { });
        await bot.sendMessage(chatId, `
🔒 <b>Fitur Khusus Member</b>
━━━━━━━━━━━━━━━━━━

Fitur <b>Build Project ZIP</b> hanya tersedia untuk:
• Admin / Owner
• Member dengan License Key

💡 Hubungi @ItsNixcal untuk mendapatkan akses.
        `.trim(), {
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
        });
        return; // Important: stop execution here
    }

    await bot.deleteMessage(chatId, messageId).catch(() => { });

    const message = `
📦 <b>Build APK dari Project ZIP</b>
━━━━━━━━━━━━━━━━━━

Pilih jenis project yang akan di-build:

<b>🤖 Android Studio</b>
Project dengan <code>build.gradle</code>

<b>💙 Flutter</b>
Project dengan <code>pubspec.yaml</code>
    `.trim();

    await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: getZipTypeKeyboard()
    });
}

/**
 * Handle ZIP type selection
 */
async function selectZipType(bot, chatId, messageId, projectType, userInfo = {}) {
    const fullName = [userInfo.firstName, userInfo.lastName].filter(Boolean).join(' ').trim() || 'User';

    // Get license username if user is a member
    const licenseUsername = licenseKeyService.getUsernameByTelegramId(chatId);

    // Build display name: "Name (@username) [license]"
    let displayName = fullName;
    if (userInfo.username) {
        displayName += ` (@${userInfo.username})`;
    }
    if (licenseUsername) {
        displayName += ` [${licenseUsername}]`;
    }

    global.sessions.set(chatId, {
        step: 'zip_buildtype',
        userName: displayName,
        userUsername: userInfo.username || null,
        licenseUsername: licenseUsername,
        data: {
            projectType: projectType,
            buildType: null,
            zipPath: null
        }
    });

    await bot.deleteMessage(chatId, messageId).catch(() => { });

    const typeName = projectType === 'flutter' ? 'Flutter' : 'Android Studio';
    const message = `
📦 <b>Project: ${typeName}</b>
━━━━━━━━━━━━━━━━━━

Pilih tipe build:

<b>🐛 Debug</b> - Build cepat untuk testing
<b>🚀 Release</b> - Build untuk produksi
    `.trim();

    await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: getZipBuildTypeKeyboard()
    });
}

/**
 * Handle build type selection
 */
async function selectZipBuildType(bot, chatId, messageId, buildType, userInfo = {}) {
    const session = global.sessions.get(chatId);
    if (!session) return;

    // Update session with user info if not set
    if (!session.userName && userInfo.firstName) {
        session.userName = [userInfo.firstName, userInfo.lastName].filter(Boolean).join(' ').trim();
        session.userUsername = userInfo.username || null;
    }

    session.data.buildType = buildType;
    session.step = 'zip_upload';
    global.sessions.set(chatId, session);

    await bot.deleteMessage(chatId, messageId).catch(() => { });

    const typeName = session.data.projectType === 'flutter' ? 'Flutter' : 'Android';
    const message = `
📤 <b>Upload Project ZIP</b>
━━━━━━━━━━━━━━━━━━

<b>Project:</b> ${typeName}
<b>Build:</b> ${buildType === 'release' ? '🚀 Release' : '🐛 Debug'}

Silakan kirim file <b>.zip</b> project Anda.

<i>⚠️ Pastikan project sudah bisa di-build sebelumnya.</i>
    `.trim();

    await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: getCancelKeyboard()
    });
}

/**
 * Handle ZIP file upload and build
 */
async function handleZipUpload(bot, chatId, filePath) {
    const session = global.sessions.get(chatId);
    if (!session || session.step !== 'zip_upload') return false;

    const { projectType, buildType } = session.data;

    // Get user name for queue
    const userName = session.userName || session.userUsername || 'User';

    // Prepare build data
    const buildData = {
        projectType,
        buildType,
        filePath,
        appName: `${projectType}-${buildType}`,
        userName
    };

    // Try to add to queue (will auto-queue if busy)
    const queueResult = buildQueue.addToQueue(chatId, buildData, 'zip', userName);

    if (!queueResult.immediate) {
        // Added to pending queue - show position
        const queueList = buildQueue.getQueueList();
        const activeBuilds = buildQueue.getActiveBuilds();

        let queueMessage = `📋 <b>Build ZIP Masuk Antrian</b>\n━━━━━━━━━━━━━━━━━━\n\n`;

        if (queueResult.isPriority) {
            queueMessage += `� <b>PRIORITAS!</b>\n\n`;
        }

        queueMessage += `🎫 <b>Posisi Anda:</b> #${queueResult.position}\n`;
        queueMessage += `⏱ <b>Estimasi:</b> ~${queueResult.estimatedWait} menit\n\n`;

        queueMessage += `<b>📦 Project:</b> ${projectType === 'flutter' ? 'Flutter' : 'Android'}\n`;
        queueMessage += `<b>� Build:</b> ${buildType === 'release' ? '🚀 Release' : '🐛 Debug'}\n\n`;
        queueMessage += `✅ <i>Build otomatis dimulai saat giliran tiba!</i>`;

        await bot.sendMessage(chatId, queueMessage, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Cek Status Antrian', callback_data: 'check_queue' }],
                    [{ text: '❌ Batalkan Antrian', callback_data: 'cancel_queue' }]
                ]
            }
        });

        // Keep session and file for when build starts
        session.data.filePath = filePath;
        global.sessions.set(chatId, session);
        return true;
    }

    // Slot available - start build immediately
    let currentProgress = 0;
    let zipBuildSuccess = false; // Track success for queue stats

    const statusMsg = await bot.sendMessage(chatId,
        formatZipBuildProgress(0, 'Memulai proses build...', projectType, buildType),
        { parse_mode: 'HTML' }
    );

    try {
        const result = await buildFromZip(
            filePath,
            projectType,
            buildType,
            (status) => {
                // Update progress based on status
                if (status.includes('Extracting')) currentProgress = 10;
                else if (status.includes('Cleaning')) currentProgress = 20;
                else if (status.includes('dependencies') || status.includes('Getting')) currentProgress = 35;
                else if (status.includes('Building') || status.includes('Gradle')) currentProgress = 60;
                else if (status.includes('Locating') || status.includes('APK')) currentProgress = 90;
                else currentProgress = Math.min(currentProgress + 5, 95);

                bot.editMessageText(
                    formatZipBuildProgress(currentProgress, status, projectType, buildType), {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                    parse_mode: 'HTML'
                }).catch(() => { });
            }
        );

        if (result.success) {
            const typeName = projectType === 'flutter' ? 'Flutter' : 'Android';
            const buildName = buildType === 'release' ? 'Release' : 'Debug';

            // Check file size before sending
            // Local Bot API: 2GB limit, Standard Bot API: 50MB limit
            const MAX_FILE_SIZE = process.env.LOCAL_API_URL
                ? 2 * 1024 * 1024 * 1024  // 2GB with Local Bot API
                : 50 * 1024 * 1024;        // 50MB with standard Bot API
            const apkStats = await fs.stat(result.apkPath);
            const fileSizeMB = (apkStats.size / (1024 * 1024)).toFixed(2);

            if (apkStats.size > MAX_FILE_SIZE) {
                // APK too large for Telegram - provide download link via web server
                const WEB_URL = process.env.WEB_URL || `http://139.59.108.177:${process.env.WEB_PORT || 2001}`;
                const buildId = `tg-zip-${Date.now()}`;

                // Register APK for download (expiry: 5 minutes for large files)
                const { registerBuildForDownload } = require('../server');
                registerBuildForDownload(buildId, result.apkPath, result.buildDir, `${typeName}_${buildName}.apk`, 5 * 60 * 1000);

                const downloadUrl = `${WEB_URL}/api/download/${buildId}`;

                await bot.editMessageText(`
✅ <b>Build Berhasil!</b>
━━━━━━━━━━━━━━━━━━

📱 <b>Type:</b> ${typeName}
🏷️ <b>Build:</b> ${buildName}
📦 <b>Ukuran:</b> ${fileSizeMB} MB

⚠️ <b>File terlalu besar untuk Telegram (>50MB)</b>

🔗 <b>Download via Link:</b>
<code>${downloadUrl}</code>

⏰ <i>Link berlaku 5 menit</i>
                `.trim(), {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📥 Download APK', url: downloadUrl }],
                            [{ text: '◀️ Kembali ke Menu', callback_data: 'back_main' }]
                        ]
                    }
                });

                return true;
            }

            await bot.editMessageText(`
✅ <b>Build Berhasil!</b>
━━━━━━━━━━━━━━━━━━

📱 <b>Type:</b> ${typeName}
🏷️ <b>Build:</b> ${buildName}
📦 <b>Ukuran:</b> ${fileSizeMB} MB

🎉 <i>Mengirim file APK...</i>
            `.trim(), {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'HTML'
            });

            await bot.sendDocument(chatId, result.apkPath, {
                caption: `✅ <b>APK Build Success</b>\n\n📱 <b>Type:</b> ${typeName}\n🏷️ <b>Build:</b> ${buildName}\n📦 <b>Size:</b> ${fileSizeMB} MB\n\n<i>Generated by Web2APK Bot</i>`,
                parse_mode: 'HTML'
            });

            // Cleanup
            await fs.remove(result.apkPath).catch(() => { });
            await fs.remove(result.buildDir).catch(() => { });

            await bot.sendMessage(chatId, '🎉 APK berhasil di-build!\n\nIngin build lagi?', {
                reply_markup: getMainKeyboard()
            });

            zipBuildSuccess = true; // Mark as success for stats
        } else {
            throw new Error(result.error);
        }

    } catch (error) {
        console.error('ZIP Build error:', error);

        // Save error log to file
        const logDir = path.join(__dirname, '..', '..', 'logs', 'errors');
        await fs.ensureDir(logDir);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFileName = `zip_build_error_${timestamp}.txt`;
        const logFilePath = path.join(logDir, logFileName);

        const logContent = `=== ZIP BUILD ERROR LOG ===
Date: ${new Date().toLocaleString('id-ID')}
User ID: ${chatId}

=== PROJECT INFO ===
Type: ${projectType || 'N/A'}
Build: ${buildType || 'N/A'}
File: ${filePath || 'N/A'}

=== ERROR ===
${error.message || error}

=== STACK TRACE ===
${error.stack || 'No stack trace available'}
`;
        await fs.writeFile(logFilePath, logContent);

        await bot.editMessageText(formatErrorMessage(error.message), {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
        });

        // Send error log file
        await bot.sendDocument(chatId, logFilePath, {
            caption: `📋 Error Log - ZIP Build\n\n💡 Kirim file ini ke admin jika butuh bantuan.`
        }).catch(() => { });
    }

    // Release build queue lock with success/fail status
    buildQueue.release(chatId, zipBuildSuccess);
    global.sessions.delete(chatId);
    return true;
}

/**
 * Initialize queue callback for auto-starting builds
 * Call this when bot is initialized
 */
function initQueueCallback(bot) {
    buildQueue.onBuildStart = async (chatId, buildData, type, userName) => {
        console.log(`[Queue Callback] 🚀 Auto-starting ${type} build for ${userName} (${chatId})`);

        try {
            // Notify user that their queued build is starting
            await bot.sendMessage(chatId, `
🚀 <b>Giliran ${escapeHtml(userName) || 'Anda'} Tiba!</b>
━━━━━━━━━━━━━━━━━━

🎉 Antrian Anda telah tiba!
🔄 Memulai proses build...

📝 <b>Nama:</b> ${escapeHtml(buildData.appName) || 'Project'}
            `.trim(), { parse_mode: 'HTML' });

            if (type === 'url') {
                // URL Build - get session or create from buildData
                let session = global.sessions.get(chatId);
                if (!session) {
                    session = {
                        step: 'building',
                        data: buildData,
                        userName: buildData.userName,
                        userUsername: buildData.userUsername
                    };
                    global.sessions.set(chatId, session);
                }

                // Start URL build
                const result = await buildApk(buildData, (status) => {
                    buildQueue.updateActivity(chatId);
                });

                if (result.success) {
                    const apkSizeMB = (await fs.stat(result.apkPath)).size / 1024 / 1024;

                    await bot.sendMessage(chatId, formatSuccessMessage(escapeHtml(buildData.appName), apkSizeMB.toFixed(1)), {
                        parse_mode: 'HTML'
                    });

                    await bot.sendDocument(chatId, result.apkPath, {
                        caption: `✅ <b>${escapeHtml(buildData.appName)}</b>\n\n🌐 <code>${buildData.url}</code>\n\n<i>Generated by Web2APK Bot</i>`,
                        parse_mode: 'HTML'
                    });

                    await bot.sendMessage(chatId, '🎉 APK berhasil dikirim!\n\nIngin membuat APK lagi?', {
                        reply_markup: getMainKeyboard()
                    });

                    // Send admin report
                    sendBuildReport(bot, {
                        id: chatId,
                        name: buildData.userName || 'Unknown',
                        username: buildData.userUsername || null
                    }, buildData);

                    // Cleanup
                    await fs.remove(result.apkPath).catch(() => { });
                    if (result.buildDir) await fs.remove(result.buildDir).catch(() => { });

                    // Release with success
                    buildQueue.release(chatId, true);
                } else {
                    await bot.sendMessage(chatId, formatErrorMessage(result.error || 'Build failed'), {
                        parse_mode: 'HTML',
                        reply_markup: getMainKeyboard()
                    });

                    // Release with failure
                    buildQueue.release(chatId, false);
                }

                // Cleanup icon
                if (buildData.iconPath) {
                    await fs.remove(buildData.iconPath).catch(() => { });
                }

            } else if (type === 'zip') {
                // ZIP Build from queue
                const { projectType, buildType, filePath } = buildData;
                const typeName = projectType === 'flutter' ? 'Flutter' : 'Android';
                const buildName = buildType === 'release' ? 'Release' : 'Debug';

                console.log(`[Queue Callback] 📦 Starting ZIP build: ${projectType} ${buildType}`);

                // Send progress message
                const statusMsg = await bot.sendMessage(chatId,
                    formatZipBuildProgress(0, 'Memulai proses build...', projectType, buildType),
                    { parse_mode: 'HTML' }
                );

                let currentProgress = 0;

                const result = await buildFromZip(filePath, projectType, buildType, (status) => {
                    buildQueue.updateActivity(chatId);

                    // Update progress based on status
                    if (status.includes('Extracting')) currentProgress = 10;
                    else if (status.includes('Cleaning')) currentProgress = 20;
                    else if (status.includes('dependencies') || status.includes('Getting')) currentProgress = 35;
                    else if (status.includes('Building') || status.includes('Gradle')) currentProgress = 60;
                    else if (status.includes('Locating') || status.includes('APK')) currentProgress = 90;
                    else currentProgress = Math.min(currentProgress + 5, 95);

                    bot.editMessageText(
                        formatZipBuildProgress(currentProgress, status, projectType, buildType), {
                        chat_id: chatId,
                        message_id: statusMsg.message_id,
                        parse_mode: 'HTML'
                    }).catch(() => { });
                });

                if (result.success) {
                    const apkStats = await fs.stat(result.apkPath);
                    const fileSizeMB = (apkStats.size / (1024 * 1024)).toFixed(2);

                    // Check file size limit
                    const MAX_FILE_SIZE = process.env.LOCAL_API_URL
                        ? 2 * 1024 * 1024 * 1024  // 2GB with Local Bot API
                        : 50 * 1024 * 1024;        // 50MB with standard Bot API

                    if (apkStats.size > MAX_FILE_SIZE) {
                        // APK too large - provide download link
                        const WEB_URL = process.env.WEB_URL || `http://139.59.108.177:${process.env.WEB_PORT || 2001}`;
                        const buildId = `tg-zip-queue-${Date.now()}`;

                        const { registerBuildForDownload } = require('../server');
                        registerBuildForDownload(buildId, result.apkPath, result.buildDir, `${typeName}_${buildName}.apk`, 5 * 60 * 1000);

                        const downloadUrl = `${WEB_URL}/api/download/${buildId}`;

                        await bot.editMessageText(`
✅ <b>Build Berhasil!</b>
━━━━━━━━━━━━━━━━━━

📱 <b>Type:</b> ${typeName}
🏷️ <b>Build:</b> ${buildName}
📦 <b>Ukuran:</b> ${fileSizeMB} MB

⚠️ <b>File terlalu besar untuk Telegram (>50MB)</b>

🔗 <b>Download via Link:</b>
<code>${downloadUrl}</code>

⏰ <i>Link berlaku 5 menit</i>
                        `.trim(), {
                            chat_id: chatId,
                            message_id: statusMsg.message_id,
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '📥 Download APK', url: downloadUrl }],
                                    [{ text: '◀️ Kembali ke Menu', callback_data: 'back_main' }]
                                ]
                            }
                        });
                    } else {
                        // Normal size - send via Telegram
                        await bot.editMessageText(`
✅ <b>Build Berhasil!</b>
━━━━━━━━━━━━━━━━━━

📱 <b>Type:</b> ${typeName}
🏷️ <b>Build:</b> ${buildName}
📦 <b>Ukuran:</b> ${fileSizeMB} MB

🎉 <i>Mengirim file APK...</i>
                        `.trim(), {
                            chat_id: chatId,
                            message_id: statusMsg.message_id,
                            parse_mode: 'HTML'
                        });

                        await bot.sendDocument(chatId, result.apkPath, {
                            caption: `✅ <b>APK Build Success</b>\n\n📱 <b>Type:</b> ${typeName}\n🏷️ <b>Build:</b> ${buildName}\n📦 <b>Size:</b> ${fileSizeMB} MB\n\n<i>Generated by Web2APK Bot</i>`,
                            parse_mode: 'HTML'
                        });

                        // Cleanup
                        await fs.remove(result.apkPath).catch(() => { });
                        if (result.buildDir) await fs.remove(result.buildDir).catch(() => { });
                    }

                    await bot.sendMessage(chatId, '🎉 APK berhasil di-build!\n\nIngin build lagi?', {
                        reply_markup: getMainKeyboard()
                    });

                    // Release with success
                    buildQueue.release(chatId, true);
                } else {
                    await bot.editMessageText(formatErrorMessage(result.error || 'Build failed'), {
                        chat_id: chatId,
                        message_id: statusMsg.message_id,
                        parse_mode: 'HTML',
                        reply_markup: getMainKeyboard()
                    });

                    // Release with failure
                    buildQueue.release(chatId, false);
                }

                // Cleanup uploaded ZIP file
                if (filePath) {
                    await fs.remove(filePath).catch(() => { });
                }

            } else {
                // Unknown build type
                console.error(`[Queue Callback] ❌ Unknown build type: ${type}`);
                await bot.sendMessage(chatId, `❌ Tipe build tidak dikenali: ${type}`, {
                    reply_markup: getMainKeyboard()
                });
                buildQueue.release(chatId, false);
            }

            // Cleanup session
            global.sessions.delete(chatId);

        } catch (error) {
            console.error('[Queue Callback] Build error:', error);

            // Save error log to file
            const logDir = path.join(__dirname, '..', '..', 'logs', 'errors');
            await fs.ensureDir(logDir);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logFileName = `queue_error_${timestamp}.txt`;
            const logFilePath = path.join(logDir, logFileName);

            const logContent = `=== QUEUE BUILD ERROR LOG ===
Date: ${new Date().toLocaleString('id-ID')}
User: ${buildData?.userName || 'Unknown'} (ID: ${chatId})
Type: ${type}

=== APP INFO ===
Name: ${buildData?.appName || 'N/A'}
URL: ${buildData?.url || 'N/A'}

=== ERROR ===
${error.message || error}

=== STACK TRACE ===
${error.stack || 'No stack trace available'}
`;
            await fs.writeFile(logFilePath, logContent);

            await bot.sendMessage(chatId, formatErrorMessage(error.message), {
                parse_mode: 'HTML',
                reply_markup: getMainKeyboard()
            }).catch(() => { });

            // Send error log file
            await bot.sendDocument(chatId, logFilePath, {
                caption: `📋 Error Log - ${buildData?.appName || 'Build'}\n\n💡 Kirim file ini ke admin jika butuh bantuan.`
            }).catch(() => { });

            buildQueue.release(chatId, false); // Failed build
            global.sessions.delete(chatId);
        }
    };

    console.log('✅ Queue callback initialized');
}

module.exports = { handleCallback, handleZipUpload, initQueueCallback };
