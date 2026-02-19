/**
 * License Key Service
 * Manages license keys with single device binding
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', '..', 'license_keys.json');

class LicenseKeyService {
    constructor() {
        this.keys = {};
        this.loadDatabase();
    }

    loadDatabase() {
        if (fs.existsSync(DB_PATH)) {
            try {
                const data = fs.readFileSync(DB_PATH, 'utf8');
                this.keys = JSON.parse(data);
                console.log(`🔑 License keys loaded: ${Object.keys(this.keys).length} keys`);
            } catch (e) {
                console.error('Failed to load license keys:', e.message);
                this.keys = {};
            }
        }
    }

    persist() {
        try {
            fs.writeFileSync(DB_PATH, JSON.stringify(this.keys, null, 2));
        } catch (e) {
            console.error('Failed to save license keys:', e.message);
        }
    }

    /**
     * Generate a new license key
     * @param {string} username - Username for the key
     * @param {number} days - Number of days until expiration
     * @param {string} telegramId - Telegram User ID for sending download links
     * @returns {object} - { success, key, expiresAt } or { success, error }
     */
    createKey(username, days, telegramId = null) {
        if (!username || typeof username !== 'string') {
            return { success: false, error: 'Username tidak valid' };
        }

        if (!days || days < 1 || days > 365) {
            return { success: false, error: 'Hari harus antara 1-365' };
        }

        // Normalize username
        const normalizedUsername = username.toLowerCase().trim();

        // Check if username already exists
        if (this.keys[normalizedUsername]) {
            return { success: false, error: `Username "${normalizedUsername}" sudah ada` };
        }

        // Generate random key
        const key = crypto.randomUUID().replace(/-/g, '').substring(0, 16).toUpperCase();

        // Calculate expiration
        const now = new Date();
        const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

        // Store key with telegramId
        this.keys[normalizedUsername] = {
            key: key,
            expiresAt: expiresAt.toISOString(),
            deviceId: null,
            telegramId: telegramId ? String(telegramId).trim() : null,
            createdAt: now.toISOString()
        };

        this.persist();

        return {
            success: true,
            username: normalizedUsername,
            key: key,
            expiresAt: expiresAt.toISOString(),
            telegramId: telegramId ? String(telegramId).trim() : null,
            days: days
        };
    }

    /**
     * Delete a license key
     * @param {string} username - Username to delete
     * @returns {object} - { success } or { success, error }
     */
    deleteKey(username) {
        const normalizedUsername = username.toLowerCase().trim();

        if (!this.keys[normalizedUsername]) {
            return { success: false, error: `Username "${normalizedUsername}" tidak ditemukan` };
        }

        delete this.keys[normalizedUsername];
        this.persist();

        return { success: true, username: normalizedUsername };
    }

    /**
     * Extend license key expiration
     * @param {string} username - Username to extend
     * @param {number} days - Number of days to add
     * @returns {object} - { success, newExpiresAt } or { success, error }
     */
    extendKey(username, days) {
        const normalizedUsername = username.toLowerCase().trim();

        if (!this.keys[normalizedUsername]) {
            return { success: false, error: `Username "${normalizedUsername}" tidak ditemukan` };
        }

        if (!days || days < 1 || days > 365) {
            return { success: false, error: 'Hari harus antara 1-365' };
        }

        const userData = this.keys[normalizedUsername];
        const currentExpires = new Date(userData.expiresAt);
        const now = new Date();

        // If already expired, start from now. Otherwise extend from current expiration
        const baseDate = currentExpires < now ? now : currentExpires;
        const newExpires = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

        userData.expiresAt = newExpires.toISOString();
        this.persist();

        return {
            success: true,
            username: normalizedUsername,
            previousExpires: currentExpires.toISOString(),
            newExpiresAt: newExpires.toISOString(),
            addedDays: days,
            wasExpired: currentExpires < now
        };
    }

    /**
     * Get all license keys
     * @returns {array} - Array of { username, expiresAt, deviceId, telegramId, isActive }
     */
    listKeys() {
        const now = new Date();
        return Object.entries(this.keys).map(([username, data]) => {
            const expiresAt = new Date(data.expiresAt);
            const isExpired = expiresAt < now;
            const daysLeft = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));

            return {
                username,
                key: data.key,
                expiresAt: data.expiresAt,
                deviceId: data.deviceId,
                telegramId: data.telegramId || null,
                isExpired,
                daysLeft: isExpired ? 0 : daysLeft,
                createdAt: data.createdAt
            };
        });
    }

    /**
     * Get Telegram ID by username
     * @param {string} username - Username to lookup
     * @returns {string|null} - Telegram ID or null if not found
     */
    getTelegramIdByUsername(username) {
        const normalizedUsername = username.toLowerCase().trim();
        const userData = this.keys[normalizedUsername];
        return userData?.telegramId || null;
    }

    /**
     * Validate login attempt
     * Allows 1 APK device + 1 Web device per account
     * @param {string} username - Username
     * @param {string} key - License key
     * @param {string} deviceId - Device ID (prefixed with 'web-' for web)
     * @returns {object} - { success, expiresAt } or { success, error }
     */
    validateLogin(username, key, deviceId) {
        const normalizedUsername = username.toLowerCase().trim();
        const userData = this.keys[normalizedUsername];

        // Check if user exists
        if (!userData) {
            return { success: false, error: 'Username tidak ditemukan' };
        }

        // Check key
        if (userData.key !== key) {
            return { success: false, error: 'License key salah' };
        }

        // Check expiration
        const expiresAt = new Date(userData.expiresAt);
        if (expiresAt < new Date()) {
            return { success: false, error: 'License key sudah expired' };
        }

        // Determine device type from deviceId prefix
        const isWebDevice = deviceId.startsWith('web-');
        const deviceType = isWebDevice ? 'web' : 'apk';

        // Initialize devices object if not exists (migration from old format)
        if (!userData.devices) {
            userData.devices = {};
            // Migrate old single deviceId to new format
            if (userData.deviceId) {
                const oldIsWeb = userData.deviceId.startsWith('web-');
                userData.devices[oldIsWeb ? 'web' : 'apk'] = userData.deviceId;
            }
        }

        // Check if this device type slot is already taken by different device
        const existingDevice = userData.devices[deviceType];
        if (existingDevice && existingDevice !== deviceId) {
            return {
                success: false,
                error: `Akun sudah login di ${deviceType === 'web' ? 'browser' : 'HP'} lain. Logout dari ${deviceType === 'web' ? 'browser' : 'HP'} sebelumnya terlebih dahulu.`
            };
        }

        // Bind device to its slot
        userData.devices[deviceType] = deviceId;
        // Keep old format for backwards compatibility
        userData.deviceId = userData.devices['apk'] || userData.devices['web'];
        this.persist();

        return {
            success: true,
            username: normalizedUsername,
            expiresAt: userData.expiresAt
        };
    }

    /**
     * Verify session is still valid
     * Supports multi-device (APK + Web)
     * @param {string} username - Username
     * @param {string} deviceId - Device ID
     * @returns {object} - { valid, expiresAt } or { valid, reason }
     */
    verifySession(username, deviceId) {
        const normalizedUsername = username.toLowerCase().trim();
        const userData = this.keys[normalizedUsername];

        if (!userData) {
            return { valid: false, reason: 'User tidak ditemukan' };
        }

        // Determine device type
        const isWebDevice = deviceId.startsWith('web-');
        const deviceType = isWebDevice ? 'web' : 'apk';

        // Check device in multi-device format
        if (userData.devices) {
            if (userData.devices[deviceType] !== deviceId) {
                return { valid: false, reason: 'Device tidak cocok' };
            }
        } else {
            // Fallback to old single device format
            if (userData.deviceId !== deviceId) {
                return { valid: false, reason: 'Device tidak cocok' };
            }
        }

        // Check expiration
        const expiresAt = new Date(userData.expiresAt);
        if (expiresAt < new Date()) {
            return { valid: false, reason: 'License expired' };
        }

        return {
            valid: true,
            username: normalizedUsername,
            expiresAt: userData.expiresAt
        };
    }

    /**
     * Logout - clear device binding for specific device type
     * @param {string} username - Username
     * @param {string} deviceId - Device ID (for verification)
     * @returns {object} - { success } or { success, error }
     */
    logout(username, deviceId) {
        const normalizedUsername = username.toLowerCase().trim();
        const userData = this.keys[normalizedUsername];

        if (!userData) {
            return { success: false, error: 'User tidak ditemukan' };
        }

        // Determine device type
        const isWebDevice = deviceId.startsWith('web-');
        const deviceType = isWebDevice ? 'web' : 'apk';

        // Handle multi-device format
        if (userData.devices) {
            if (userData.devices[deviceType] !== deviceId) {
                return { success: false, error: 'Device tidak cocok' };
            }
            // Clear only this device type slot
            delete userData.devices[deviceType];
            // Update legacy field
            userData.deviceId = userData.devices['apk'] || userData.devices['web'] || null;
        } else {
            // Fallback to old single device format
            if (userData.deviceId !== deviceId) {
                return { success: false, error: 'Device tidak cocok' };
            }
            userData.deviceId = null;
        }

        this.persist();
        return { success: true };
    }

    /**
     * Get key info
     * @param {string} username - Username
     * @returns {object|null} - Key data or null
     */
    getKeyInfo(username) {
        const normalizedUsername = username.toLowerCase().trim();
        return this.keys[normalizedUsername] || null;
    }

    /**
     * Check if a Telegram user has a valid license
     * @param {number|string} telegramId - Telegram User ID
     * @returns {boolean} - True if user has valid license
     */
    isUserAuthorized(telegramId) {
        const tgId = String(telegramId);
        const now = new Date();

        return Object.values(this.keys).some(data => {
            if (data.telegramId !== tgId) return false;
            // Also check if not expired
            const expiresAt = new Date(data.expiresAt);
            return expiresAt > now;
        });
    }

    /**
     * Get license username by Telegram ID
     * @param {number|string} telegramId - Telegram User ID
     * @returns {string|null} - License username or null if not found
     */
    getUsernameByTelegramId(telegramId) {
        const tgId = String(telegramId);
        const now = new Date();

        for (const [username, data] of Object.entries(this.keys)) {
            if (data.telegramId === tgId) {
                const expiresAt = new Date(data.expiresAt);
                if (expiresAt > now) {
                    return username;
                }
            }
        }
        return null;
    }
}

module.exports = new LicenseKeyService();
