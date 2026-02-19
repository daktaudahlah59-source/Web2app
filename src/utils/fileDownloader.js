/**
 * Local Bot API File Downloader
 * 
 * When using Telegram Local Bot API Server, the standard downloadFile
 * method from node-telegram-bot-api may not work correctly.
 * 
 * This module provides a direct HTTP download approach.
 */

const https = require('https');
const http = require('http');
const fs = require('fs-extra');
const path = require('path');

/**
 * Download file from Telegram using Local Bot API or standard Bot API
 * 
 * @param {Object} bot - TelegramBot instance
 * @param {string} fileId - Telegram file_id
 * @param {string} destDir - Destination directory
 * @param {string} fileName - File name to save as
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
async function downloadTelegramFile(bot, fileId, destDir, fileName) {
    const localApiUrl = process.env.LOCAL_API_URL;
    const botToken = process.env.BOT_TOKEN;

    try {
        // Ensure destination directory exists
        await fs.ensureDir(destDir);
        const destPath = path.join(destDir, fileName);

        // Get file info first
        const fileInfo = await bot.getFile(fileId);
        console.log(`   File path from API: ${fileInfo.file_path}`);

        if (localApiUrl) {
            // LOCAL BOT API: Files are stored locally on the filesystem!
            // The file_path is an absolute path like: /opt/telegram-bot-api/.../file.zip
            // We just need to copy it directly

            const localFilePath = fileInfo.file_path;

            // Check if file exists locally
            if (await fs.pathExists(localFilePath)) {
                console.log(`   Copying local file: ${localFilePath}`);
                await fs.copy(localFilePath, destPath);

                const stats = await fs.stat(destPath);
                console.log(`   Copied ${stats.size} bytes to ${destPath}`);

                return { success: true, path: destPath, size: stats.size };
            } else {
                // Fallback: try HTTP download (for compatibility)
                console.log(`   Local file not found, trying HTTP...`);
                const downloadUrl = `${localApiUrl}/file/bot${botToken}/${fileInfo.file_path}`;
                console.log(`   Download URL: ${downloadUrl.substring(0, 80)}...`);

                await downloadFileViaHttp(downloadUrl, destPath);
                const stats = await fs.stat(destPath);
                return { success: true, path: destPath, size: stats.size };
            }
        } else {
            // Standard Bot API - download via HTTP
            const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;
            console.log(`   Download URL: ${downloadUrl.substring(0, 80)}...`);

            await downloadFileViaHttp(downloadUrl, destPath);
            const stats = await fs.stat(destPath);
            console.log(`   Downloaded ${stats.size} bytes to ${destPath}`);

            return { success: true, path: destPath, size: stats.size };
        }

    } catch (error) {
        console.error('Download error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Download file via HTTP/HTTPS
 */
function downloadFileViaHttp(url, destPath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(destPath);

        const request = protocol.get(url, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                file.close();
                fs.unlink(destPath, () => { });
                return downloadFileViaHttp(response.headers.location, destPath)
                    .then(resolve)
                    .catch(reject);
            }

            // Check for errors
            if (response.statusCode !== 200) {
                file.close();
                fs.unlink(destPath, () => { });

                // Try to read error body
                let body = '';
                response.on('data', chunk => body += chunk);
                response.on('end', () => {
                    reject(new Error(`HTTP ${response.statusCode}: ${body || response.statusMessage}`));
                });
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                resolve();
            });
        });

        request.on('error', (error) => {
            file.close();
            fs.unlink(destPath, () => { });
            reject(error);
        });

        file.on('error', (error) => {
            file.close();
            fs.unlink(destPath, () => { });
            reject(error);
        });

        // Set timeout
        request.setTimeout(300000, () => { // 5 minutes
            request.abort();
            file.close();
            fs.unlink(destPath, () => { });
            reject(new Error('Download timeout'));
        });
    });
}

module.exports = {
    downloadTelegramFile
};
