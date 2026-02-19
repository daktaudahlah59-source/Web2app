const fs = require('fs-extra');
const path = require('path');

// Folders to preserve (never delete)
const PROTECTED_FOLDERS = ['uploads'];

/**
 * Clean up old files in a directory
 * @param {string} directory - Directory to clean
 * @param {number} maxAgeMinutes - Maximum age in minutes
 */
async function cleanupOldFiles(directory, maxAgeMinutes = 30) {
    try {
        if (!await fs.pathExists(directory)) return;

        const files = await fs.readdir(directory);
        const now = Date.now();
        const maxAge = maxAgeMinutes * 60 * 1000;

        for (const file of files) {
            // Skip protected folders
            if (PROTECTED_FOLDERS.includes(file)) {
                continue;
            }

            const filePath = path.join(directory, file);
            const stats = await fs.stat(filePath);
            const age = now - stats.mtimeMs;

            if (age > maxAge) {
                await fs.remove(filePath);
                console.log(`🗑️ Cleaned up: ${file}`);
            }
        }
    } catch (error) {
        console.error('Cleanup error:', error.message);
    }
}

/**
 * Clean up temp folder immediately, preserving only protected folders
 * @param {string} directory - Directory to clean
 */
async function cleanupTempNow(directory) {
    try {
        if (!await fs.pathExists(directory)) return;

        const files = await fs.readdir(directory);
        let cleaned = 0;

        for (const file of files) {
            // Skip protected folders
            if (PROTECTED_FOLDERS.includes(file)) {
                continue;
            }

            const filePath = path.join(directory, file);
            await fs.remove(filePath);
            cleaned++;
            console.log(`🗑️ Cleaned: ${file}`);
        }

        if (cleaned > 0) {
            console.log(`✅ Cleaned ${cleaned} items from temp folder`);
        }
    } catch (error) {
        console.error('Cleanup error:', error.message);
    }
}

/**
 * Delete a specific file or directory
 * @param {string} targetPath - Path to delete
 */
async function deleteFile(targetPath) {
    try {
        if (await fs.pathExists(targetPath)) {
            await fs.remove(targetPath);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Delete error:', error.message);
        return false;
    }
}

module.exports = {
    cleanupOldFiles,
    cleanupTempNow,
    deleteFile
};
