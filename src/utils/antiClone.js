/**
 * Anti-Clone Protection System
 * Prevents unauthorized copies of the website
 */

const crypto = require('crypto');

class AntiCloneProtection {
    constructor() {
        this.allowedDomains = this.parseAllowedDomains();
        this.serverLicenseKey = process.env.SERVER_LICENSE_KEY || '';
        this.antiCloneSecret = process.env.ANTI_CLONE_SECRET || this.generateSecret();
        this.violations = new Map(); // IP -> violation count
        this.blockedIPs = new Set();

        // Auto-block after 5 violations
        this.MAX_VIOLATIONS = 5;
        this.VIOLATION_RESET_TIME = 60 * 60 * 1000; // 1 hour

        console.log(`🛡️ Anti-Clone: ${this.allowedDomains.length} domains allowed`);

        if (!this.serverLicenseKey) {
            console.warn('⚠️ SERVER_LICENSE_KEY not set! Anti-clone protection weakened.');
        }
    }

    parseAllowedDomains() {
        const domains = process.env.ALLOWED_DOMAINS || 'localhost,127.0.0.1';
        return domains.split(',')
            .map(d => d.trim().toLowerCase())
            .filter(d => d.length > 0);
    }

    generateSecret() {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Generate server fingerprint for validation
     */
    generateFingerprint() {
        const data = [
            this.serverLicenseKey,
            this.antiCloneSecret,
            process.env.BOT_TOKEN?.substring(0, 10) || 'no-token'
        ].join(':');

        return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
    }

    /**
     * Check if request is from allowed domain
     */
    isDomainAllowed(req) {
        // Skip check if no domains configured
        if (this.allowedDomains.length === 0) return true;

        const host = req.get('host') || '';
        const origin = req.get('origin') || '';
        const referer = req.get('referer') || '';

        // Extract hostname from various headers
        const hostnames = [
            host.split(':')[0], // Remove port
            this.extractHostname(origin),
            this.extractHostname(referer)
        ].filter(h => h);

        return hostnames.some(hostname =>
            this.allowedDomains.some(allowed =>
                hostname === allowed ||
                hostname.endsWith('.' + allowed)
            )
        );
    }

    extractHostname(url) {
        if (!url) return '';
        try {
            return new URL(url).hostname.toLowerCase();
        } catch {
            return '';
        }
    }

    /**
     * Record violation for an IP
     */
    recordViolation(ip, reason) {
        const now = Date.now();
        let record = this.violations.get(ip);

        if (!record || now - record.lastViolation > this.VIOLATION_RESET_TIME) {
            record = { count: 0, lastViolation: now };
        }

        record.count++;
        record.lastViolation = now;
        this.violations.set(ip, record);

        console.warn(`🚨 [AntiClone] Violation from ${ip}: ${reason} (${record.count}/${this.MAX_VIOLATIONS})`);

        if (record.count >= this.MAX_VIOLATIONS) {
            this.blockedIPs.add(ip);
            console.error(`🚫 [AntiClone] IP BLOCKED: ${ip}`);
        }

        return record.count;
    }

    /**
     * Check if IP is blocked
     */
    isBlocked(ip) {
        return this.blockedIPs.has(ip);
    }

    /**
     * Express middleware for anti-clone protection
     */
    middleware() {
        return (req, res, next) => {
            const ip = req.ip || req.connection.remoteAddress || 'unknown';

            // Check if IP is blocked
            if (this.isBlocked(ip)) {
                return res.status(403).json({
                    error: 'Access denied',
                    code: 'BLOCKED'
                });
            }

            // Skip validation for static files
            if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|woff|woff2)$/i)) {
                return next();
            }

            // Check domain for API calls
            if (req.path.startsWith('/api/')) {
                if (!this.isDomainAllowed(req)) {
                    this.recordViolation(ip, 'Invalid domain');
                    return res.status(403).json({
                        error: 'Unauthorized domain',
                        code: 'INVALID_DOMAIN'
                    });
                }
            }

            // Add fingerprint to response headers for validation
            res.set('X-Server-FP', this.generateFingerprint());

            next();
        };
    }

    /**
     * Validate client-side integrity check
     */
    validateIntegrity(req) {
        const clientFP = req.headers['x-client-fp'];
        const expectedFP = this.generateFingerprint();

        if (!clientFP) return { valid: false, reason: 'Missing fingerprint' };
        if (clientFP !== expectedFP) return { valid: false, reason: 'Invalid fingerprint' };

        return { valid: true };
    }

    /**
     * Get protection status
     */
    getStatus() {
        return {
            enabled: this.allowedDomains.length > 0,
            allowedDomains: this.allowedDomains,
            hasLicenseKey: !!this.serverLicenseKey,
            blockedIPs: this.blockedIPs.size,
            violations: this.violations.size
        };
    }
}

// Singleton instance
const antiClone = new AntiCloneProtection();

module.exports = antiClone;
