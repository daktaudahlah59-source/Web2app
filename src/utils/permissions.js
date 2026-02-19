require('dotenv').config();

/**
 * Check if a user is an admin
 * @param {string|number} userId 
 * @returns {boolean}
 */
function isAdmin(userId) {
    const adminIds = process.env.ADMIN_IDS?.split(',').map(id => id.trim()) || [];
    return adminIds.includes(String(userId));
}

module.exports = { isAdmin };
