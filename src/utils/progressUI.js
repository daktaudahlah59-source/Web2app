/**
 * Progress Bar & Formatting Utilities for Telegram
 */

// Progress bar characters
const PROGRESS_CHARS = {
    filled: '█',
    empty: '░',
    // Alternative styles:
    // filled: '▓', empty: '░',
    // filled: '●', empty: '○',
    // filled: '▰', empty: '▱',
};

/**
 * Escape HTML special characters to prevent parse errors
 */
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Generate a visual progress bar
 * @param {number} percent - Percentage (0-100)
 * @param {number} length - Bar length (default 15)
 * @returns {string} Progress bar string
 */
function progressBar(percent, length = 15) {
    const filled = Math.round((percent / 100) * length);
    const empty = length - filled;
    return PROGRESS_CHARS.filled.repeat(filled) + PROGRESS_CHARS.empty.repeat(empty);
}

/**
 * Format build progress message
 * @param {number} percent - Progress percentage
 * @param {string} status - Current status text
 * @param {string} appName - Application name (optional, should be pre-escaped)
 * @returns {string} Formatted message
 */
function formatBuildProgress(percent, status, appName = '') {
    const bar = progressBar(percent);
    const safeStatus = escapeHtml(status);
    const header = appName ? `🔨 <b>Building: ${appName}</b>` : '🔨 <b>Building APK</b>';

    return `
${header}
━━━━━━━━━━━━━━━━━━

${bar} <b>${percent}%</b>

<code>${safeStatus}</code>

⏳ <i>Mohon tunggu...</i>
    `.trim();
}

/**
 * Format ZIP build progress message
 * @param {number} percent - Progress percentage
 * @param {string} status - Current status text
 * @param {string} projectType - Project type (flutter/android)
 * @param {string} buildType - Build type (debug/release)
 * @returns {string} Formatted message
 */
function formatZipBuildProgress(percent, status, projectType, buildType) {
    const bar = progressBar(percent);
    const typeIcon = projectType === 'flutter' ? '💙' : '🤖';
    const buildIcon = buildType === 'release' ? '🚀' : '🐛';
    const safeStatus = escapeHtml(status);

    return `
🔨 <b>Building Project</b>
━━━━━━━━━━━━━━━━━━

${bar} <b>${percent}%</b>

${typeIcon} <b>Type:</b> ${projectType === 'flutter' ? 'Flutter' : 'Android'}
${buildIcon} <b>Build:</b> ${buildType === 'release' ? 'Release' : 'Debug'}

📍 <code>${safeStatus}</code>

⏳ <i>Harap tunggu, proses ini membutuhkan waktu...</i>
    `.trim();
}

/**
 * Format success message
 * @param {string} appName - Application name (should be pre-escaped)
 * @param {string} url - Target URL (optional)
 * @returns {string} Formatted message
 */
function formatSuccessMessage(appName, url = '') {
    const safeUrl = escapeHtml(url);
    const urlLine = safeUrl ? `\n🌐 <code>${safeUrl}</code>` : '';
    return `
✅ <b>APK Berhasil Dibuat!</b>
━━━━━━━━━━━━━━━━━━

📱 <b>${appName}</b>${urlLine}

🎉 <i>File APK sedang dikirim...</i>
    `.trim();
}

/**
 * Format error message
 * @param {string} error - Error message
 * @returns {string} Formatted message
 */
function formatErrorMessage(error) {
    // Truncate error if too long
    const truncatedError = error.length > 500 ? error.substring(0, 500) + '...' : error;
    const safeError = escapeHtml(truncatedError);

    return `
❌ <b>Build Gagal</b>
━━━━━━━━━━━━━━━━━━

<b>Error:</b>
<code>${safeError}</code>

💡 <i>Periksa project Anda dan coba lagi.</i>
    `.trim();
}

/**
 * Get animated spinner (for variety)
 * @param {number} step - Animation step
 * @returns {string} Spinner character
 */
function getSpinner(step) {
    const spinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    return spinners[step % spinners.length];
}

/**
 * Format initial build message
 * @param {string} appName - App name (should be pre-escaped)
 * @param {string} url - Target URL
 * @returns {string} Formatted message
 */
function formatBuildStartMessage(appName, url) {
    const safeUrl = escapeHtml(url);
    return `
🚀 <b>Memulai Build</b>
━━━━━━━━━━━━━━━━━━

📱 <b>Aplikasi:</b> ${appName}
🌐 <b>URL:</b> <code>${safeUrl}</code>

${progressBar(0)} <b>0%</b>

⏳ <i>Mempersiapkan environment...</i>
    `.trim();
}

module.exports = {
    progressBar,
    formatBuildProgress,
    formatZipBuildProgress,
    formatSuccessMessage,
    formatErrorMessage,
    formatBuildStartMessage,
    getSpinner
};
