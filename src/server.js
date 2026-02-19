/**
 * Web Server for Web2APK Dashboard
 * Auto-detects domain and displays server specs
 */

const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const multer = require('multer');
const cors = require('cors');
const licenseKeyService = require('./utils/licenseKeyService');

const app = express();
const HOST = process.env.WEB_HOST || '0.0.0.0';

// Trust proxy for reverse proxy support (Nginx, Cloudflare, etc.)
app.set('trust proxy', 1);
const PORT = process.env.WEB_PORT || 2001;

// Configure multer for icon uploads
const uploadDir = path.join(__dirname, '..', 'temp', 'uploads');
fs.ensureDirSync(uploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `icon-${Date.now()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// Middleware
// CORS configuration for custom domain access
app.use(cors({
    origin: true,  // Allow all origins (for flexibility with custom domains)
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Request timeout for long build operations (30 minutes)
app.use((req, res, next) => {
    req.setTimeout(30 * 60 * 1000);
    res.setTimeout(30 * 60 * 1000);
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== ANTI-CLONE PROTECTION ==========
const antiClone = require('./utils/antiClone');
app.use(antiClone.middleware());

// Anti-clone status endpoint (admin only)
app.get('/api/security/status', (req, res) => {
    // Only allow from localhost or admin
    const ip = req.ip || req.connection.remoteAddress;
    if (!ip.includes('127.0.0.1') && !ip.includes('::1')) {
        return res.status(403).json({ error: 'Access denied' });
    }
    res.json(antiClone.getStatus());
});


// ========== RATE LIMITING ==========
const loginAttempts = new Map(); // IP -> { count, resetTime }
const RATE_LIMIT_MAX = 5;  // Max 5 attempts
const RATE_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes

function rateLimitLogin(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();

    let attempt = loginAttempts.get(ip);

    // Reset if window expired
    if (attempt && now > attempt.resetTime) {
        loginAttempts.delete(ip);
        attempt = null;
    }

    if (!attempt) {
        attempt = { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
        loginAttempts.set(ip, attempt);
    }

    attempt.count++;

    if (attempt.count > RATE_LIMIT_MAX) {
        const remainingTime = Math.ceil((attempt.resetTime - now) / 60000);
        return res.status(429).json({
            success: false,
            error: `Terlalu banyak percobaan. Coba lagi dalam ${remainingTime} menit.`
        });
    }

    next();
}

// ========== AUTH MIDDLEWARE ==========
const licenseKeyServiceForMiddleware = require('./utils/licenseKeyService');

function authMiddleware(req, res, next) {
    // Get auth from header or body
    const authHeader = req.headers['authorization'];
    let username, deviceId;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        // Parse: Bearer username:deviceId
        const token = authHeader.substring(7);
        const parts = token.split(':');
        if (parts.length >= 2) {
            username = parts[0];
            deviceId = parts.slice(1).join(':');
        }
    }

    // Also check body for backwards compatibility
    if (!username && req.body) {
        username = req.body.authUsername;
        deviceId = req.body.authDeviceId;
    }

    // Skip auth check for some requests (like icon uploads without session)
    if (!username || !deviceId) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized - silakan login terlebih dahulu'
        });
    }

    // Verify session
    const result = licenseKeyServiceForMiddleware.verifySession(username, deviceId);

    if (!result.valid) {
        return res.status(401).json({
            success: false,
            error: result.reason || 'Session tidak valid'
        });
    }

    // Attach user info to request
    req.authUser = {
        username,
        deviceId,
        expiresAt: result.expiresAt
    };

    next();
}

app.use(express.static(path.join(__dirname, '..', 'web')));

// Store for web builds (with 1-minute auto-cleanup)
const webBuilds = new Map();

// ========== TELEGRAM NOTIFICATION HELPER ==========
/**
 * Send download link to user's Telegram
 * @param {string} username - Username of the logged-in user
 * @param {string} downloadUrl - Full download URL
 * @param {string} appName - Name of the built app
 * @param {string} buildType - Type of build (url/zip)
 */
async function sendDownloadLinkToTelegram(username, downloadUrl, appName, buildType = 'url') {
    try {
        const telegramId = licenseKeyService.getTelegramIdByUsername(username);

        if (!telegramId) {
            console.log(`[Telegram] No Telegram ID for user: ${username}`);
            return { sent: false, reason: 'No Telegram ID' };
        }

        const botToken = process.env.BOT_TOKEN;
        if (!botToken) {
            console.log('[Telegram] BOT_TOKEN not configured');
            return { sent: false, reason: 'Bot not configured' };
        }

        const message = `
📦 <b>BUILD APK SELESAI!</b>
━━━━━━━━━━━━━━━━━━

📱 <b>Nama Aplikasi:</b> ${appName}
🔧 <b>Tipe Build:</b> ${buildType === 'zip' ? 'ZIP Project' : 'URL to APK'}

🔗 <b>Link Download:</b>
<code>${downloadUrl}</code>

⏰ <i>Link berlaku 2 menit</i>
━━━━━━━━━━━━━━━━━━
🤖 <i>Web2APK Bot</i>
        `.trim();

        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegramId,
                text: message,
                parse_mode: 'HTML'
            })
        });

        const result = await response.json();

        if (result.ok) {
            console.log(`[Telegram] Download link sent to user: ${username} (${telegramId})`);
            return { sent: true };
        } else {
            console.log(`[Telegram] Failed to send: ${result.description}`);
            return { sent: false, reason: result.description };
        }
    } catch (error) {
        console.error('[Telegram] Error sending download link:', error.message);
        return { sent: false, reason: error.message };
    }
}

// Get local IP addresses
function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }

    return ips;
}

// Get server specifications
function getServerSpecs() {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    return {
        os: {
            platform: os.platform(),
            release: os.release(),
            type: os.type(),
            arch: os.arch()
        },
        cpu: {
            model: cpus[0]?.model || 'Unknown',
            cores: cpus.length,
            speed: cpus[0]?.speed || 0
        },
        memory: {
            total: Math.round(totalMem / (1024 * 1024 * 1024) * 100) / 100,
            free: Math.round(freeMem / (1024 * 1024 * 1024) * 100) / 100,
            used: Math.round((totalMem - freeMem) / (1024 * 1024 * 1024) * 100) / 100
        },
        node: process.version,
        uptime: Math.floor(os.uptime())
    };
}

// API Routes
app.get('/api/specs', (req, res) => {
    res.json(getServerSpecs());
});

app.get('/api/stats', (req, res) => {
    const userService = require('./utils/userService');
    const { buildQueue } = require('./utils/buildQueue');

    const queueInfo = buildQueue.getQueueInfo();
    const activeBuilds = buildQueue.getActiveBuilds();

    res.json({
        totalUsers: userService.getCount(),
        activeSessions: global.sessions?.size || 0,
        queueStatus: buildQueue.isBusy() ? 'busy' : 'available',
        queueInfo: queueInfo,
        activeBuilds: activeBuilds.length,
        pendingBuilds: queueInfo.waiting,
        uptime: Math.floor(process.uptime())
    });
});

// ========== AUTH API ENDPOINTS ==========

// Login - validate credentials and bind device (with rate limiting)
app.post('/api/auth/login', rateLimitLogin, (req, res) => {
    const { username, key, deviceId } = req.body;

    if (!username || !key || !deviceId) {
        return res.status(400).json({
            success: false,
            error: 'Username, key, dan deviceId diperlukan'
        });
    }

    const result = licenseKeyService.validateLogin(username, key, deviceId);

    if (result.success) {
        res.json({
            success: true,
            username: result.username,
            expiresAt: result.expiresAt
        });
    } else {
        res.status(401).json({
            success: false,
            error: result.error
        });
    }
});

// Verify session - check if session is still valid
app.get('/api/auth/verify', (req, res) => {
    const { username, deviceId } = req.query;

    if (!username || !deviceId) {
        return res.status(400).json({
            valid: false,
            reason: 'Username dan deviceId diperlukan'
        });
    }

    const result = licenseKeyService.verifySession(username, deviceId);
    res.json(result);
});

// Logout - clear device binding
app.post('/api/auth/logout', (req, res) => {
    const { username, deviceId } = req.body;

    if (!username || !deviceId) {
        return res.status(400).json({
            success: false,
            error: 'Username dan deviceId diperlukan'
        });
    }

    const result = licenseKeyService.logout(username, deviceId);
    res.json(result);
});

// Build from web (URL to APK) with optional icon upload
app.post('/api/build', upload.single('icon'), async (req, res) => {
    const { url, appName, themeColor } = req.body;
    const iconFile = req.file;
    const { buildQueue } = require('./utils/buildQueue');
    const { buildApk } = require('./builder/apkBuilder');

    // Get username from auth header for Telegram notification
    let authUsername = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        authUsername = token.split(':')[0];
    }

    // Validate input
    if (!url || !appName) {
        if (iconFile) await fs.remove(iconFile.path).catch(() => { });
        return res.status(400).json({ error: 'URL dan nama aplikasi diperlukan' });
    }

    // Check queue
    if (!buildQueue.acquire('web-' + Date.now())) {
        if (iconFile) await fs.remove(iconFile.path).catch(() => { });
        return res.status(503).json({ error: 'Server sedang sibuk. Coba lagi nanti.' });
    }

    try {
        const buildData = {
            url,
            appName,
            themeColor: themeColor || '#2196F3',
            iconPath: iconFile ? iconFile.path : null
        };

        const result = await buildApk(buildData, (status) => {
            console.log('[Web Build]', status);
        });

        // Cleanup uploaded icon
        if (iconFile) {
            await fs.remove(iconFile.path).catch(() => { });
        }

        if (result.success) {
            // Generate unique ID for download
            const buildId = 'web-' + Date.now();

            webBuilds.set(buildId, {
                path: result.apkPath,
                buildDir: result.buildDir,
                fileName: `${appName}.apk`,
                createdAt: Date.now()
            });

            // Auto-delete after 1 minute
            setTimeout(async () => {
                const build = webBuilds.get(buildId);
                if (build) {
                    await fs.remove(build.path).catch(() => { });
                    await fs.remove(build.buildDir).catch(() => { });
                    webBuilds.delete(buildId);
                    clearBuildLogs(); // Clear logs when build expires
                    console.log(`[Web Build] Auto-deleted: ${buildId}`);
                }
            }, 2 * 60 * 1000); // 2 minutes

            const downloadUrl = `/api/download/${buildId}`;

            // Send download link to Telegram
            if (authUsername) {
                const fullDownloadUrl = `${req.protocol}://${req.get('host')}${downloadUrl}`;
                sendDownloadLinkToTelegram(authUsername, fullDownloadUrl, appName, 'url').catch(err => {
                    console.error('[Telegram] Error:', err.message);
                });
            }

            res.json({
                success: true,
                buildId,
                downloadUrl,
                expiresIn: 120 // 2 minutes
            });
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        // Cleanup on error
        if (iconFile) {
            await fs.remove(iconFile.path).catch(() => { });
        }
        res.status(500).json({ error: error.message });
    } finally {
        buildQueue.release();
    }
});

// Download APK (cleanup handled by 1-minute auto-delete timeout)
app.get('/api/download/:buildId', async (req, res) => {
    const { buildId } = req.params;
    const build = webBuilds.get(buildId);

    if (!build) {
        return res.status(404).json({ error: 'File tidak ditemukan atau sudah kadaluarsa' });
    }

    if (!await fs.pathExists(build.path)) {
        webBuilds.delete(buildId);
        return res.status(404).json({ error: 'File sudah dihapus' });
    }

    res.download(build.path, build.fileName);
});

// Configure multer for ZIP uploads (larger files)
const zipStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `project-${Date.now()}.zip`);
    }
});

const zipUpload = multer({
    storage: zipStorage,
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB max
    fileFilter: (req, file, cb) => {
        if (file.originalname.endsWith('.zip')) {
            cb(null, true);
        } else {
            cb(new Error('Only ZIP files are allowed'));
        }
    }
});

// Build logs storage - per session with real-time SSE support
const EventEmitter = require('events');
const sessionLogs = new Map(); // sessionId -> { logs: [], createdAt: timestamp }
const logEmitter = new EventEmitter(); // For real-time log streaming
logEmitter.setMaxListeners(100); // Allow many concurrent SSE connections
const MAX_LOGS = 100;
const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// Cleanup old sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessionLogs.entries()) {
        if (now - session.createdAt > SESSION_TIMEOUT) {
            sessionLogs.delete(sessionId);
            console.log(`[Logs] Session ${sessionId} expired and removed`);
        }
    }
}, 60 * 1000); // Check every minute

function getSessionLogs(sessionId) {
    if (!sessionLogs.has(sessionId)) {
        sessionLogs.set(sessionId, { logs: [], createdAt: Date.now() });
    }
    const session = sessionLogs.get(sessionId);
    session.createdAt = Date.now(); // Refresh timeout
    return session.logs;
}

function addBuildLog(level, message, details = null, sessionId = null) {
    const log = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        level,
        message,
        details
    };

    // Add to session-specific logs
    if (sessionId) {
        const logs = getSessionLogs(sessionId);
        logs.unshift(log);
        if (logs.length > MAX_LOGS) logs.pop();

        // Emit log event for real-time SSE streaming
        logEmitter.emit(`log:${sessionId}`, log);
    }

    console.log(`[${level.toUpperCase()}] ${message}`, details || '');
    return log;
}

// Clear session build logs
function clearBuildLogs(sessionId = null) {
    if (sessionId && sessionLogs.has(sessionId)) {
        sessionLogs.get(sessionId).logs = [];
        console.log(`[INFO] Session ${sessionId} logs cleared`);
    }
}

// Get build logs (per session)
app.get('/api/logs', (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId) {
        return res.json([]); // No logs without session
    }
    const logs = getSessionLogs(sessionId);
    res.json(logs.slice(0, 50));
});

// Clear build logs endpoint (per session)
app.delete('/api/logs', (req, res) => {
    const sessionId = req.query.sessionId;
    clearBuildLogs(sessionId);
    res.json({ success: true, message: 'Logs cleared' });
});

// SSE endpoint for real-time log streaming
app.get('/api/logs/stream', (req, res) => {
    const sessionId = req.query.sessionId;

    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Send initial connection event
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ sessionId, timestamp: new Date().toISOString() })}\n\n`);

    // Send existing logs
    const existingLogs = getSessionLogs(sessionId);
    if (existingLogs.length > 0) {
        res.write(`event: initial\n`);
        res.write(`data: ${JSON.stringify(existingLogs)}\n\n`);
    }

    // Listen for new logs
    const logHandler = (log) => {
        try {
            res.write(`event: log\n`);
            res.write(`data: ${JSON.stringify(log)}\n\n`);
        } catch (e) {
            // Client disconnected
        }
    };

    logEmitter.on(`log:${sessionId}`, logHandler);

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
        try {
            res.write(`event: heartbeat\n`);
            res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
        } catch (e) {
            clearInterval(heartbeat);
        }
    }, 15000); // Every 15 seconds

    // Clean up on disconnect
    req.on('close', () => {
        logEmitter.off(`log:${sessionId}`, logHandler);
        clearInterval(heartbeat);
        console.log(`[Logs SSE] Client disconnected: ${sessionId}`);
    });
});

// SSE endpoint for ZIP build with real-time progress
app.post('/api/build-zip-stream', zipUpload.single('zipFile'), async (req, res) => {
    const { projectType, buildType, sessionId } = req.body;
    const zipFile = req.file;
    const { buildQueue } = require('./utils/buildQueue');
    const { buildFromZip } = require('./builder/zipBuilder');

    // Get username from auth header for Telegram notification
    let authUsername = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        authUsername = token.split(':')[0];
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendEvent = (event, data) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    if (!zipFile) {
        sendEvent('error', { error: 'ZIP file diperlukan' });
        return res.end();
    }

    if (!['flutter', 'android'].includes(projectType)) {
        await fs.remove(zipFile.path).catch(() => { });
        sendEvent('error', { error: 'Project type tidak valid' });
        return res.end();
    }

    if (!buildQueue.acquire('web-zip-' + Date.now())) {
        await fs.remove(zipFile.path).catch(() => { });
        sendEvent('error', { error: 'Server sedang sibuk. Coba lagi nanti.' });
        return res.end();
    }

    try {
        addBuildLog('info', `Starting ${projectType} ${buildType} build`, { fileName: zipFile.originalname }, sessionId);
        sendEvent('progress', { progress: 5, status: 'Memulai proses build...' });

        const result = await buildFromZip(
            zipFile.path,
            projectType,
            buildType || 'release',
            (status) => {
                addBuildLog('info', status, null, sessionId);

                // Estimate progress based on status
                let progress = 10;
                if (status.includes('Extracting')) progress = 15;
                else if (status.includes('Cleaning')) progress = 20;
                else if (status.includes('dependencies') || status.includes('Getting')) progress = 30;
                else if (status.includes('Compiling') || status.includes('Building')) progress = 50;
                else if (status.includes('Packaging') || status.includes('Processing')) progress = 70;
                else if (status.includes('Locating') || status.includes('complete')) progress = 90;

                sendEvent('progress', { progress, status });
            }
        );

        if (result.success) {
            const buildId = 'zip-' + Date.now();

            webBuilds.set(buildId, {
                path: result.apkPath,
                buildDir: result.buildDir,
                fileName: `${projectType}_${buildType}.apk`,
                createdAt: Date.now()
            });

            setTimeout(async () => {
                const build = webBuilds.get(buildId);
                if (build) {
                    await fs.remove(build.path).catch(() => { });
                    await fs.remove(build.buildDir).catch(() => { });
                    webBuilds.delete(buildId);
                    clearBuildLogs(sessionId); // Clear logs when build expires
                    addBuildLog('info', `Auto-deleted build: ${buildId}`, null, sessionId);
                }
            }, 2 * 60 * 1000); // 2 minutes

            addBuildLog('success', 'Build completed successfully', { buildId }, sessionId);

            const downloadUrl = `/api/download/${buildId}`;

            // Send download link to Telegram
            if (authUsername) {
                const fullDownloadUrl = `${req.protocol}://${req.get('host')}${downloadUrl}`;
                sendDownloadLinkToTelegram(authUsername, fullDownloadUrl, `${projectType}_${buildType}`, 'zip').catch(err => {
                    console.error('[Telegram] Error:', err.message);
                });
            }

            sendEvent('complete', {
                success: true,
                buildId,
                downloadUrl,
                expiresIn: 60
            });
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        addBuildLog('error', 'Build failed', { error: error.message }, sessionId);
        sendEvent('error', { error: error.message });
    } finally {
        await fs.remove(zipFile.path).catch(() => { });
        buildQueue.release();
        res.end();
    }
});

// Legacy endpoint (fallback)
app.post('/api/build-zip', zipUpload.single('zipFile'), async (req, res) => {
    const { projectType, buildType, sessionId } = req.body;
    const zipFile = req.file;
    const { buildQueue } = require('./utils/buildQueue');
    const { buildFromZip } = require('./builder/zipBuilder');

    // Get username from auth header for Telegram notification
    let authUsername = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        authUsername = token.split(':')[0];
    }

    console.log('[API build-zip] Request received:', { projectType, buildType, sessionId, fileName: zipFile?.originalname });

    if (!zipFile) {
        console.log('[API build-zip] Error: No ZIP file');
        return res.status(400).json({ error: 'ZIP file diperlukan' });
    }

    if (!['flutter', 'android'].includes(projectType)) {
        await fs.remove(zipFile.path).catch(() => { });
        console.log('[API build-zip] Error: Invalid project type:', projectType);
        return res.status(400).json({ error: 'Project type tidak valid' });
    }

    if (!buildQueue.acquire('web-zip-' + Date.now())) {
        await fs.remove(zipFile.path).catch(() => { });
        console.log('[API build-zip] Error: Server busy');
        return res.status(503).json({ error: 'Server sedang sibuk. Coba lagi nanti.' });
    }

    try {
        addBuildLog('info', `Starting ${projectType} ${buildType} build`, { fileName: zipFile.originalname }, sessionId);

        const result = await buildFromZip(
            zipFile.path,
            projectType,
            buildType || 'release',
            (status) => {
                addBuildLog('info', status, null, sessionId);
            }
        );

        console.log('[API build-zip] Build result:', { success: result.success, apkPath: result.apkPath, error: result.error });

        if (result.success) {
            // Validate APK file exists
            if (!result.apkPath || !await fs.pathExists(result.apkPath)) {
                console.error('[API build-zip] Error: APK file not found at path:', result.apkPath);
                throw new Error('APK file was not created successfully. Build may have failed silently.');
            }

            const buildId = 'zip-' + Date.now();
            const downloadUrl = `/api/download/${buildId}`;

            console.log('[API build-zip] Registering build:', { buildId, downloadUrl, apkPath: result.apkPath });

            webBuilds.set(buildId, {
                path: result.apkPath,
                buildDir: result.buildDir,
                fileName: `${projectType}_${buildType}.apk`,
                createdAt: Date.now()
            });

            // Schedule cleanup after 1 minute
            setTimeout(async () => {
                const build = webBuilds.get(buildId);
                if (build) {
                    console.log('[API build-zip] Auto-cleanup:', buildId);
                    await fs.remove(build.path).catch(() => { });
                    await fs.remove(build.buildDir).catch(() => { });
                    webBuilds.delete(buildId);
                    clearBuildLogs(sessionId);
                }
            }, 2 * 60 * 1000); // 2 minutes

            addBuildLog('success', 'Build completed successfully', { buildId, downloadUrl }, sessionId);

            // Send download link to Telegram
            if (authUsername) {
                const fullDownloadUrl = `${req.protocol}://${req.get('host')}${downloadUrl}`;
                sendDownloadLinkToTelegram(authUsername, fullDownloadUrl, `${projectType}_${buildType}`, 'zip').catch(err => {
                    console.error('[Telegram] Error:', err.message);
                });
            }

            // Prepare response with explicit fields
            const responseData = {
                success: true,
                buildId: buildId,
                downloadUrl: downloadUrl,
                expiresIn: 120 // 2 minutes
            };

            console.log('[API build-zip] Sending success response:', responseData);
            res.json(responseData);
        } else {
            console.error('[API build-zip] Build failed:', result.error);
            throw new Error(result.error || 'Build failed with unknown error');
        }
    } catch (error) {
        console.error('[API build-zip] Exception:', error.message);
        addBuildLog('error', 'Build failed', { error: error.message }, sessionId);
        res.status(500).json({ error: error.message });
    } finally {
        await fs.remove(zipFile.path).catch(() => { });
        buildQueue.release();
    }
});

// ========== PROJECT ANALYZE & CLEANUP ENDPOINTS ==========

// Analyze project (flutter analyze or gradle lint)
app.post('/api/analyze', zipUpload.single('zipFile'), async (req, res) => {
    const { projectType } = req.body;
    const zipFile = req.file;
    const { analyzeProject, safeExtractZip } = require('./builder/zipBuilder');
    const { v4: uuidv4 } = require('uuid');

    if (!zipFile) {
        return res.status(400).json({ success: false, error: 'ZIP file diperlukan' });
    }

    if (!['flutter', 'android'].includes(projectType)) {
        await fs.remove(zipFile.path).catch(() => { });
        return res.status(400).json({ success: false, error: 'Project type tidak valid' });
    }

    const jobId = uuidv4();
    const tempDir = path.join(__dirname, '..', 'temp', 'analyze-' + jobId);

    try {
        // Extract ZIP using safe extraction
        await fs.ensureDir(tempDir);
        await safeExtractZip(zipFile.path, tempDir);

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

        // Save log to file
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

        // Send to Telegram admin if configured
        const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').filter(Boolean);
        if (ADMIN_IDS.length > 0 && global.bot) {
            try {
                for (const adminId of ADMIN_IDS) {
                    await global.bot.sendDocument(adminId.trim(), logFilePath, {
                        caption: `📊 *Analyze Report*\nType: ${projectType}\nStatus: ${result.success ? '✅ Success' : '❌ Failed'}`,
                        parse_mode: 'Markdown'
                    });
                }
            } catch (e) {
                console.error('Failed to send analyze log to Telegram:', e.message);
            }
        }

        res.json({
            success: result.success,
            output: result.output || null,
            error: result.error || null,
            projectType,
            logFile: logFileName
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        await fs.remove(zipFile.path).catch(() => { });
        await fs.remove(tempDir).catch(() => { });
    }
});

// Cleanup project (flutter clean or gradle clean)
app.post('/api/cleanup', zipUpload.single('zipFile'), async (req, res) => {
    const { projectType } = req.body;
    const zipFile = req.file;
    const { cleanupProject, safeExtractZip } = require('./builder/zipBuilder');
    const { v4: uuidv4 } = require('uuid');

    if (!zipFile) {
        return res.status(400).json({ success: false, error: 'ZIP file diperlukan' });
    }

    if (!['flutter', 'android'].includes(projectType)) {
        await fs.remove(zipFile.path).catch(() => { });
        return res.status(400).json({ success: false, error: 'Project type tidak valid' });
    }

    const jobId = uuidv4();
    const tempDir = path.join(__dirname, '..', 'temp', 'cleanup-' + jobId);
    const outputZipPath = path.join(__dirname, '..', 'temp', `cleaned-${jobId}.zip`);

    try {
        // Extract ZIP using safe extraction
        await fs.ensureDir(tempDir);
        await safeExtractZip(zipFile.path, tempDir);

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
            // Re-zip the cleaned project
            const archiver = require('archiver');
            const output = fs.createWriteStream(outputZipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            await new Promise((resolve, reject) => {
                output.on('close', resolve);
                archive.on('error', reject);
                archive.pipe(output);
                archive.directory(projectRoot, false);
                archive.finalize();
            });

            // Register for download
            const downloadId = 'cleanup-' + Date.now();
            webBuilds.set(downloadId, {
                path: outputZipPath,
                buildDir: tempDir,
                fileName: 'cleaned_project.zip',
                createdAt: Date.now()
            });

            // Auto-cleanup after 2 minutes
            setTimeout(async () => {
                const build = webBuilds.get(downloadId);
                if (build) {
                    await fs.remove(build.path).catch(() => { });
                    await fs.remove(build.buildDir).catch(() => { });
                    webBuilds.delete(downloadId);
                }
            }, 2 * 60 * 1000);

            const sizeSavedMB = ((result.savedBytes || 0) / (1024 * 1024)).toFixed(2);
            const sizeBeforeMB = ((result.sizeBefore || 0) / (1024 * 1024)).toFixed(2);
            const sizeAfterMB = ((result.sizeAfter || 0) / (1024 * 1024)).toFixed(2);

            // Save log to file
            const logDir = path.join(__dirname, '..', 'logs', 'tools');
            await fs.ensureDir(logDir);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logFileName = `cleanup_${projectType}_${timestamp}.txt`;
            const logFilePath = path.join(logDir, logFileName);

            const logContent = `=== PROJECT CLEANUP LOG ===
Date: ${new Date().toLocaleString('id-ID')}
Project Type: ${projectType}
Status: SUCCESS

=== SIZE STATISTICS ===
Before: ${sizeBeforeMB} MB
After: ${sizeAfterMB} MB
Saved: ${sizeSavedMB} MB (${result.sizeBefore > 0 ? ((result.savedBytes / result.sizeBefore) * 100).toFixed(1) : 0}%)

Download expires in 2 minutes.
`;
            await fs.writeFile(logFilePath, logContent);

            // Send to Telegram admin if configured
            const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').filter(Boolean);
            if (ADMIN_IDS.length > 0 && global.bot) {
                try {
                    for (const adminId of ADMIN_IDS) {
                        await global.bot.sendDocument(adminId.trim(), logFilePath, {
                            caption: `🧹 *Cleanup Report*\nType: ${projectType}\n📦 Before: ${sizeBeforeMB} MB\n📦 After: ${sizeAfterMB} MB\n💾 Saved: ${sizeSavedMB} MB`,
                            parse_mode: 'Markdown'
                        });
                    }
                } catch (e) {
                    console.error('Failed to send cleanup log to Telegram:', e.message);
                }
            }

            res.json({
                success: true,
                downloadUrl: `/api/download/${downloadId}`,
                sizeBefore: result.sizeBefore,
                sizeAfter: result.sizeAfter,
                savedBytes: result.savedBytes,
                savedMB: sizeSavedMB,
                expiresIn: 120,
                logFile: logFileName
            });
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        await fs.remove(tempDir).catch(() => { });
        res.status(500).json({ success: false, error: error.message });
    } finally {
        await fs.remove(zipFile.path).catch(() => { });
    }
});

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
});

// ========== GLOBAL ERROR HANDLER ==========
// Catch detailed errors (like Multer limits) and return JSON
app.use((err, req, res, next) => {
    console.error('[ServerError]', err);

    // Handle Multer errors (File too large, etc)
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'Ukuran file terlalu besar. Maksimum upload adalah 200MB untuk ZIP dan 10MB untuk Icon.'
            });
        }
        return res.status(400).json({
            success: false,
            error: `Upload Error: ${err.message}`
        });
    }

    // Handle other errors
    res.status(500).json({
        success: false,
        error: err.message || 'Internal Server Error'
    });
});

// Start server
function startWebServer() {
    const server = app.listen(PORT, HOST, () => {
        const ips = getLocalIPs();

        console.log('');
        console.log('🌐 Web Dashboard:');
        console.log(`   Local:   http://139.59.108.177:${PORT}`);
        console.log(`   Binding: http://139.59.108.177:${HOST}:${PORT}`);

        ips.forEach(ip => {
            console.log(`   Network: http://139.59.108.177:${ip}:${PORT}`);
        });

        console.log('   Custom domain akan bekerja dengan reverse proxy');
        console.log('');
    });

    // Set server timeout for long-running build operations
    server.timeout = 30 * 60 * 1000; // 30 minutes
    server.keepAliveTimeout = 65 * 1000; // 65 seconds (longer than typical LB timeout)
    server.headersTimeout = 66 * 1000; // Slightly longer than keepAliveTimeout
}

// Notification system
let latestNotification = null;

app.get('/api/notification', (req, res) => {
    res.json(latestNotification || {});
});

function updateNotification(text) {
    latestNotification = {
        id: Date.now(),
        text: text,
        timestamp: new Date().toISOString()
    };
    return latestNotification;
}

/**
 * Register a build for download (used by bot handler for large APK files)
 * @param {string} buildId - Unique build ID
 * @param {string} apkPath - Path to APK file
 * @param {string} buildDir - Path to build directory (for cleanup)
 * @param {string} fileName - Download filename
 * @param {number} expiryMs - Expiry time in milliseconds (default: 5 minutes)
 */
function registerBuildForDownload(buildId, apkPath, buildDir, fileName, expiryMs = 5 * 60 * 1000) {
    webBuilds.set(buildId, {
        path: apkPath,
        buildDir: buildDir,
        fileName: fileName,
        createdAt: Date.now()
    });

    // Auto-delete after expiry
    setTimeout(async () => {
        const build = webBuilds.get(buildId);
        if (build) {
            const fs = require('fs-extra');
            await fs.remove(build.path).catch(() => { });
            await fs.remove(build.buildDir).catch(() => { });
            webBuilds.delete(buildId);
            console.log(`[Download] Auto-deleted: ${buildId}`);
        }
    }, expiryMs);

    console.log(`[Download] Registered: ${buildId} (expires in ${expiryMs / 1000}s)`);
}

module.exports = { startWebServer, getServerSpecs, getLocalIPs, updateNotification, registerBuildForDownload };

