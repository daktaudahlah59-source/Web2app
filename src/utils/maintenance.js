const fs = require('fs-extra');
const path = require('path');

const MAINTENANCE_FILE = path.join(__dirname, '../../data/maintenance.json');

// Ensure data directory exists
fs.ensureDirSync(path.dirname(MAINTENANCE_FILE));

/**
 * Get maintenance status
 * @returns {boolean}
 */
function isMaintenanceEnabled() {
    try {
        if (!fs.existsSync(MAINTENANCE_FILE)) {
            return false;
        }
        const data = fs.readJsonSync(MAINTENANCE_FILE);
        return !!data.enabled;
    } catch (error) {
        console.error('Error reading maintenance file:', error);
        return false;
    }
}

/**
 * Set maintenance status
 * @param {boolean} enabled 
 */
function setMaintenance(enabled) {
    try {
        fs.writeJsonSync(MAINTENANCE_FILE, { enabled, updatedAt: Date.now() });
        return true;
    } catch (error) {
        console.error('Error writing maintenance file:', error);
        return false;
    }
}

module.exports = {
    isEnabled: isMaintenanceEnabled,
    set: setMaintenance
};
