/**
 * Web2APK Dashboard - JavaScript App
 */

// State
// let selectedColor = '#2196F3'; // Removed
let selectedIcon = null;
let expireCountdown = null;

// ZIP Build State
let selectedProjectType = 'flutter';
let selectedBuildType = 'release';
let selectedZipFile = null;
let zipExpireCountdown = null;

// Session ID - unique per browser tab for per-session logs
const sessionId = (function () {
    // Try to get from sessionStorage first
    let id = sessionStorage.getItem('buildSessionId');
    if (!id) {
        // Generate new session ID
        id = 'sess-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
        sessionStorage.setItem('buildSessionId', id);
    }
    return id;
})();
console.log('[Session] ID:', sessionId);

// ==================== ANTI-CLONE PROTECTION ====================
(function () {
    const EXPECTED_PATHS = ['/api/', '/login.html', '/index.html', '/'];
    const serverFP = document.querySelector('meta[name="server-fp"]')?.content;

    // Validate server response
    async function validateServer() {
        try {
            const response = await fetch('/api/specs', { method: 'GET' });
            const fp = response.headers.get('X-Server-FP');

            if (!fp) {
                console.warn('[Security] Server fingerprint missing');
                return false;
            }

            // Store fingerprint for API calls
            window._serverFP = fp;
            return true;
        } catch (e) {
            console.error('[Security] Validation failed:', e);
            return false;
        }
    }

    // Run validation on page load
    validateServer().then(valid => {
        if (!valid) {
            console.warn('[Security] Running in unverified mode');
        }
    });

    // Add fingerprint to all fetch requests
    const originalFetch = window.fetch;
    window.fetch = function (url, options = {}) {
        if (window._serverFP && typeof url === 'string' && url.startsWith('/api/')) {
            options.headers = {
                ...options.headers,
                'X-Client-FP': window._serverFP
            };
        }
        return originalFetch.call(this, url, options);
    };
})();

// ==================== BUILD STATE PERSISTENCE ====================

/**
 * Save build state to localStorage
 * This allows users to close browser and return to see their build status
 */
function saveBuildState(type, state) {
    const key = `web2apk_build_${type}`;
    const data = {
        ...state,
        savedAt: Date.now(),
        sessionId: sessionId
    };
    localStorage.setItem(key, JSON.stringify(data));
    console.log(`[BuildState] Saved ${type}:`, state.status);
}

/**
 * Get saved build state from localStorage
 */
function getBuildState(type) {
    const key = `web2apk_build_${type}`;
    const data = localStorage.getItem(key);
    if (!data) return null;

    try {
        const state = JSON.parse(data);
        // Expire state after 5 minutes (in case build was interrupted)
        const maxAge = 5 * 60 * 1000;
        if (Date.now() - state.savedAt > maxAge && state.status !== 'result') {
            localStorage.removeItem(key);
            return null;
        }
        return state;
    } catch (e) {
        localStorage.removeItem(key);
        return null;
    }
}

/**
 * Clear build state
 */
function clearBuildState(type) {
    const key = `web2apk_build_${type}`;
    localStorage.removeItem(key);
    console.log(`[BuildState] Cleared ${type}`);
}

/**
 * Save logs to localStorage
 */
function saveLogsToLocal(logs) {
    const key = `web2apk_logs_${sessionId}`;
    localStorage.setItem(key, JSON.stringify({
        logs: logs.slice(0, 50), // Keep last 50 logs
        savedAt: Date.now()
    }));
}

/**
 * Get logs from localStorage
 */
function getLogsFromLocal() {
    const key = `web2apk_logs_${sessionId}`;
    const data = localStorage.getItem(key);
    if (!data) return [];

    try {
        const parsed = JSON.parse(data);
        // Expire logs after 10 minutes
        if (Date.now() - parsed.savedAt > 10 * 60 * 1000) {
            localStorage.removeItem(key);
            return [];
        }
        return parsed.logs || [];
    } catch (e) {
        return [];
    }
}

/**
 * Clear local logs
 */
function clearLocalLogs() {
    const key = `web2apk_logs_${sessionId}`;
    localStorage.removeItem(key);
}

// ==================== AUTH SESSION MANAGEMENT ====================

/**
 * Get stored session from localStorage
 */
function getAuthSession() {
    const sessionData = localStorage.getItem('web2apk_session');
    if (!sessionData) return null;

    try {
        const session = JSON.parse(sessionData);
        // Check if expired
        if (new Date(session.expiresAt) <= new Date()) {
            localStorage.removeItem('web2apk_session');
            return null;
        }
        return session;
    } catch (e) {
        localStorage.removeItem('web2apk_session');
        return null;
    }
}

/**
 * Get Authorization header for API calls
 */
function getAuthHeader() {
    const session = getAuthSession();
    if (!session) return {};
    return {
        'Authorization': `Bearer ${session.username}:${session.deviceId}`
    };
}

/**
 * Check if user is logged in, redirect to login if not
 */
async function checkAuthRequired() {
    const session = getAuthSession();

    if (!session) {
        console.log('[Auth] No session, redirecting to login');
        window.location.href = 'login.html';
        return false;
    }

    // Verify session with server
    try {
        const response = await fetch(`/api/auth/verify?username=${encodeURIComponent(session.username)}&deviceId=${encodeURIComponent(session.deviceId)}`);
        const data = await response.json();

        if (!data.valid) {
            console.log('[Auth] Session invalid:', data.reason);
            localStorage.removeItem('web2apk_session');
            window.location.href = 'login.html';
            return false;
        }

        console.log('[Auth] Session valid for:', session.username);
        return true;
    } catch (e) {
        console.error('[Auth] Verify error:', e);
        // Allow offline access if can't reach server
        return true;
    }
}

/**
 * Logout and redirect to login page
 */
async function logout() {
    const session = getAuthSession();

    if (session) {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: session.username,
                    deviceId: session.deviceId
                })
            });
        } catch (e) {
            console.error('[Auth] Logout error:', e);
        }
    }

    localStorage.removeItem('web2apk_session');
    window.location.href = 'login.html';
}

// Check auth immediately when page loads
checkAuthRequired().then(isValid => {
    if (isValid) {
        // Show username in header
        const session = getAuthSession();
        if (session) {
            const userDisplay = document.getElementById('userDisplay');
            const loggedInUser = document.getElementById('loggedInUser');
            if (userDisplay && loggedInUser) {
                loggedInUser.textContent = session.username;
                userDisplay.style.display = 'inline-flex';
                userDisplay.style.alignItems = 'center';
                userDisplay.style.gap = '6px';
                userDisplay.style.padding = '6px 12px';
                userDisplay.style.background = 'rgba(99, 102, 241, 0.1)';
                userDisplay.style.borderRadius = '8px';
                userDisplay.style.marginRight = '8px';
            }
        }
    }
});


// ==================== WEBVIEW COMPATIBILITY HELPERS ====================

/**
 * WebView-safe function to toggle element visibility
 * CSS .hidden uses !important, so we must remove class BEFORE setting inline styles
 */
function setElementVisible(element, visible) {
    if (!element) {
        console.warn('[setElementVisible] Element is null');
        return;
    }

    if (visible) {
        // CRITICAL: Remove hidden class FIRST (before setting display)
        element.classList.remove('hidden');
        // Use !important to override any CSS rules
        element.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important;';
        // Force repaint for WebView
        forceRepaint(element);
        console.log('[setElementVisible] Made visible:', element.id || element.className);
    } else {
        element.style.cssText = '';
        element.classList.add('hidden');
        console.log('[setElementVisible] Made hidden:', element.id || element.className);
    }
}

/**
 * Force browser/WebView to repaint an element
 * Uses multiple techniques for maximum compatibility
 */
function forceRepaint(element) {
    if (!element) return;

    // Technique 1: Read offsetHeight to trigger reflow
    void element.offsetHeight;

    // Technique 2: GPU layer promotion
    element.style.transform = 'translateZ(0)';
    void element.offsetWidth;
    element.style.transform = '';

    // Technique 3: Use requestAnimationFrame for next paint cycle
    requestAnimationFrame(() => {
        void element.offsetHeight;
    });
}

/**
 * Verify element is actually visible in DOM
 * Returns true if element is displayed
 */
function isElementVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

// DOM Elements
const elements = {
    // Stats
    serverStatus: document.getElementById('serverStatus'),
    totalUsers: document.getElementById('totalUsers'),
    uptime: document.getElementById('uptime'),
    queueStatus: document.getElementById('queueStatus'),
    activeSessions: document.getElementById('activeSessions'),

    // Specs
    osInfo: document.getElementById('osInfo'),
    cpuInfo: document.getElementById('cpuInfo'),
    memInfo: document.getElementById('memInfo'),
    memoryBar: document.getElementById('memoryBar'),
    memoryText: document.getElementById('memoryText'),
    nodeInfo: document.getElementById('nodeInfo'),

    // Form
    buildForm: document.getElementById('buildForm'),
    urlInput: document.getElementById('urlInput'),
    appNameInput: document.getElementById('appNameInput'),
    buildBtn: document.getElementById('buildBtn'),

    // Icon upload
    iconUploadZone: document.getElementById('iconUploadZone'),
    iconInput: document.getElementById('iconInput'),
    uploadPlaceholder: document.getElementById('uploadPlaceholder'),
    uploadPreview: document.getElementById('uploadPreview'),
    iconPreviewImg: document.getElementById('iconPreviewImg'),
    removeIconBtn: document.getElementById('removeIconBtn'),

    // Progress
    buildProgress: document.getElementById('buildProgress'),
    progressText: document.getElementById('progressText'),
    progressFill: document.getElementById('progressFill'),

    // Result
    buildResult: document.getElementById('buildResult'),
    downloadBtn: document.getElementById('downloadBtn'),
    expireTime: document.getElementById('expireTime'),

    // Error
    buildError: document.getElementById('buildError'),
    errorMessage: document.getElementById('errorMessage'),
    retryBtn: document.getElementById('retryBtn'),

    // ZIP Build Form
    zipBuildForm: document.getElementById('zipBuildForm'),
    zipUploadZone: document.getElementById('zipUploadZone'),
    zipInput: document.getElementById('zipInput'),
    zipPlaceholder: document.getElementById('zipPlaceholder'),
    zipPreview: document.getElementById('zipPreview'),
    zipFileName: document.getElementById('zipFileName'),
    removeZipBtn: document.getElementById('removeZipBtn'),
    zipBuildBtn: document.getElementById('zipBuildBtn'),

    // ZIP Build Progress/Result/Error
    zipBuildProgress: document.getElementById('zipBuildProgress'),
    zipProgressText: document.getElementById('zipProgressText'),
    zipProgressFill: document.getElementById('zipProgressFill'),
    zipBuildResult: document.getElementById('zipBuildResult'),
    zipDownloadBtn: document.getElementById('zipDownloadBtn'),
    zipExpireTime: document.getElementById('zipExpireTime'),
    zipBuildError: document.getElementById('zipBuildError'),
    zipErrorMessage: document.getElementById('zipErrorMessage'),
    zipRetryBtn: document.getElementById('zipRetryBtn'),

    // Actions
    refreshBtn: document.getElementById('refreshBtn')
};

// Build card elements
const urlBuildCard = document.getElementById('urlBuildCard');
const zipBuildCard = document.getElementById('zipBuildCard');

// Logs elements
const logsCard = document.querySelector('.logs-card');
const logsToggle = document.getElementById('logsToggle');
const logsContainer = document.getElementById('logsContainer');
const logsRefreshBtn = document.getElementById('logsRefreshBtn');
const logsClearBtn = document.getElementById('logsClearBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadSpecs();
    // setupColorPicker(); // Removed
    setupIconUpload();
    setupForm();
    setupRefresh();
    setupTabs();

    // ZIP Build setup
    setupProjectTypePicker();
    setupBuildTypePicker();
    setupZipUpload();
    setupZipForm();

    // Logs setup
    setupLogs();
    loadLogs();

    // Restore any saved build state (for browser close/refresh recovery)
    restoreBuildState();

    // Auto-refresh stats every 10 seconds
    setInterval(loadStats, 10000);
});

/**
 * Restore build state from localStorage on page load
 * This allows users to close browser and return to see their build results
 */
function restoreBuildState() {
    // Restore URL build state
    const urlState = getBuildState('url');
    if (urlState) {
        console.log('[RestoreState] Found URL build state:', urlState.status);

        if (urlState.status === 'result' && urlState.downloadUrl) {
            // Calculate remaining time
            const elapsedSeconds = Math.floor((Date.now() - urlState.savedAt) / 1000);
            const remainingTime = Math.max(0, (urlState.expiresIn || 120) - elapsedSeconds);

            if (remainingTime > 0) {
                showResult(urlState.downloadUrl, remainingTime);
            } else {
                // Expired, clear state
                clearBuildState('url');
            }
        } else if (urlState.status === 'progress') {
            // Build was in progress - show message that it may have been interrupted
            showError('Build sebelumnya terinterupsi. Silakan mulai build baru.');
            clearBuildState('url');
        }
    }

    // Restore ZIP build state
    const zipState = getBuildState('zip');
    if (zipState) {
        console.log('[RestoreState] Found ZIP build state:', zipState.status);

        // Switch to ZIP tab if there's a ZIP build state
        const zipTabBtn = document.querySelector('.tab-btn[data-tab="zip"]');
        if (zipTabBtn) {
            zipTabBtn.click();
        }

        if (zipState.status === 'result' && zipState.downloadUrl) {
            // Calculate remaining time
            const elapsedSeconds = Math.floor((Date.now() - zipState.savedAt) / 1000);
            const remainingTime = Math.max(0, (zipState.expiresIn || 120) - elapsedSeconds);

            if (remainingTime > 0) {
                showZipResult(zipState.downloadUrl, remainingTime);
            } else {
                // Expired, clear state
                clearBuildState('zip');
            }
        } else if (zipState.status === 'progress') {
            // Build was in progress - show message
            showZipError('Build sebelumnya terinterupsi. Silakan mulai build baru.');
            clearBuildState('zip');
        }
    }
}

// Setup build mode tabs
function setupTabs() {
    const tabBtns = document.querySelectorAll('.build-tabs .tab-btn');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const tab = btn.dataset.tab;

            if (tab === 'url') {
                urlBuildCard.classList.remove('hidden');
                zipBuildCard.classList.add('hidden');
            } else {
                urlBuildCard.classList.add('hidden');
                zipBuildCard.classList.remove('hidden');
            }
        });
    });
}

// Load server stats
async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();

        elements.totalUsers.textContent = data.totalUsers;
        elements.activeSessions.textContent = data.activeSessions;
        elements.uptime.textContent = formatUptime(data.uptime);

        // Queue status
        const isBusy = data.queueStatus === 'busy';
        elements.queueStatus.textContent = isBusy ? 'Busy' : 'Ready';
        elements.serverStatus.className = `status-badge ${isBusy ? 'busy' : ''}`;
        elements.serverStatus.querySelector('span:last-child').textContent =
            isBusy ? 'Building...' : 'Online';

    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

// Load server specs
async function loadSpecs() {
    try {
        const response = await fetch('/api/specs');
        const data = await response.json();

        // OS Info
        const osName = getOSName(data.os.platform);
        elements.osInfo.textContent = `${osName} (${data.os.arch})`;

        // CPU Info
        const cpuModel = data.cpu.model.split('@')[0].trim();
        elements.cpuInfo.textContent = `${cpuModel} • ${data.cpu.cores} Cores`;

        // Memory Info
        elements.memInfo.textContent = `${data.memory.used} GB / ${data.memory.total} GB`;

        const memPercent = Math.round((data.memory.used / data.memory.total) * 100);
        elements.memoryBar.style.width = `${memPercent}%`;
        elements.memoryText.textContent = `${memPercent}% used`;

        // Node Info
        elements.nodeInfo.textContent = data.node;

    } catch (error) {
        console.error('Failed to load specs:', error);
    }
}

// Format uptime
function formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

// Get OS name from platform
function getOSName(platform) {
    const names = {
        'win32': 'Windows',
        'darwin': 'macOS',
        'linux': 'Linux (VPS)'
    };
    return names[platform] || platform;
}

// Setup color picker removed

// Setup icon upload
function setupIconUpload() {
    const zone = elements.iconUploadZone;
    const input = elements.iconInput;

    // Click to upload
    zone.addEventListener('click', () => {
        if (!selectedIcon) {
            input.click();
        }
    });

    // File selected
    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            handleIconFile(file);
        }
    });

    // Drag and drop
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            handleIconFile(file);
        }
    });

    // Remove button
    elements.removeIconBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeIcon();
    });
}

// Handle icon file
function handleIconFile(file) {
    if (!file.type.startsWith('image/')) {
        showError('Please select an image file (PNG or JPG)');
        return;
    }

    selectedIcon = file;

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
        elements.iconPreviewImg.src = e.target.result;
        elements.uploadPlaceholder.classList.add('hidden');
        elements.uploadPreview.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

// Remove icon
function removeIcon() {
    selectedIcon = null;
    elements.iconInput.value = '';
    elements.iconPreviewImg.src = '';
    elements.uploadPlaceholder.classList.remove('hidden');
    elements.uploadPreview.classList.add('hidden');
}

// Setup form
function setupForm() {
    elements.buildForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await startBuild();
    });

    elements.retryBtn.addEventListener('click', () => {
        resetForm();
    });
}

// Setup refresh button
function setupRefresh() {
    elements.refreshBtn.addEventListener('click', () => {
        loadStats();
        loadSpecs();
    });
}

// Start build
async function startBuild() {
    const url = elements.urlInput.value.trim();
    const appName = elements.appNameInput.value.trim();

    if (!url || !appName) return;

    // Validate URL
    try {
        new URL(url);
    } catch {
        showError('URL tidak valid. Pastikan dimulai dengan http:// atau https://');
        return;
    }

    // Show progress
    showProgress();

    try {
        // Simulate progress
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress = Math.min(progress + Math.random() * 15, 90);
            elements.progressFill.style.width = `${progress}%`;

            // Update text based on progress
            if (progress < 20) {
                elements.progressText.textContent = 'Preparing project...';
            } else if (progress < 40) {
                elements.progressText.textContent = 'Configuring Android project...';
            } else if (progress < 60) {
                elements.progressText.textContent = 'Building APK...';
            } else if (progress < 80) {
                elements.progressText.textContent = 'Compiling resources...';
            } else {
                elements.progressText.textContent = 'Finalizing...';
            }
        }, 500);

        // Use FormData for file upload
        const formData = new FormData();
        formData.append('url', url);
        formData.append('appName', appName);
        formData.append('themeColor', '#2196F3'); // Default Blue
        if (selectedIcon) {
            formData.append('icon', selectedIcon);
        }

        const response = await fetch('/api/build', {
            method: 'POST',
            headers: getAuthHeader(),
            body: formData
        });

        clearInterval(progressInterval);

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Build failed');
        }

        // Success
        elements.progressFill.style.width = '100%';
        elements.progressText.textContent = 'Build complete!';

        setTimeout(() => {
            showResult(data.downloadUrl, data.expiresIn);
        }, 500);

    } catch (error) {
        showError(error.message);
    }
}

// Show progress
function showProgress() {
    elements.buildBtn.disabled = true;
    elements.buildProgress.classList.remove('hidden');
    elements.buildResult.classList.add('hidden');
    elements.buildError.classList.add('hidden');
    elements.progressFill.style.width = '0%';
    elements.progressText.textContent = 'Starting build...';

    // Save progress state
    saveBuildState('url', { status: 'progress' });
}

// Show result - WebView compatible version
function showResult(downloadUrl, expiresIn) {
    console.log('[showResult] Called with URL:', downloadUrl, 'expiresIn:', expiresIn);

    // Validate download URL
    if (!downloadUrl) {
        console.error('[showResult] No download URL provided!');
        showError('Download link not available. Please try again.');
        return;
    }

    // Store URL for fallback
    const savedUrl = downloadUrl;

    // Save result state for browser close/refresh recovery
    saveBuildState('url', {
        status: 'result',
        downloadUrl: downloadUrl,
        expiresIn: expiresIn || 120
    });

    // Hide progress and error, show result using WebView-safe method
    setElementVisible(elements.buildProgress, false);
    setElementVisible(elements.buildError, false);
    setElementVisible(elements.buildResult, true);

    // Set download button href
    const downloadBtn = elements.downloadBtn;
    if (downloadBtn) {
        downloadBtn.href = downloadUrl;
        downloadBtn.setAttribute('download', '');
        console.log('[showResult] Download button href set to:', downloadBtn.href);
    } else {
        console.error('[showResult] Download button element not found!');
    }

    // Set countdown timer
    let timeLeft = expiresIn || 60;
    if (elements.expireTime) {
        elements.expireTime.textContent = timeLeft;
    }

    // Clear any existing countdown
    if (expireCountdown) {
        clearInterval(expireCountdown);
        expireCountdown = null;
    }

    // Start countdown
    expireCountdown = setInterval(() => {
        timeLeft--;
        if (elements.expireTime) {
            elements.expireTime.textContent = timeLeft;
        }

        if (timeLeft <= 0) {
            clearInterval(expireCountdown);
            expireCountdown = null;
            resetForm();
        }
    }, 1000);

    console.log('[showResult] Result panel should now be visible');

    // FALLBACK: Check if result is actually visible after 1 second
    // If not, show alert with download URL so user can still download
    setTimeout(() => {
        if (!isElementVisible(elements.buildResult)) {
            console.warn('[showResult] Result panel still not visible! Showing fallback alert.');
            alert('Build berhasil! 🎉\n\nDownload APK Anda di:\n' + savedUrl + '\n\n(Salin link ini jika tombol tidak muncul)');
        }
    }, 1000);
}

// Show error
function showError(message) {
    elements.buildProgress.classList.add('hidden');
    elements.buildResult.classList.add('hidden');
    elements.buildError.classList.remove('hidden');
    elements.errorMessage.textContent = message;
    elements.buildBtn.disabled = false;
}

// Reset form
function resetForm() {
    elements.buildBtn.disabled = false;
    elements.buildProgress.classList.add('hidden');
    elements.buildResult.classList.add('hidden');
    elements.buildError.classList.add('hidden');
    elements.progressFill.style.width = '0%';
    removeIcon();

    if (expireCountdown) {
        clearInterval(expireCountdown);
        expireCountdown = null;
    }

    // Clear saved state
    clearBuildState('url');
}

// ==================== ZIP BUILD ====================

// Setup project type picker
function setupProjectTypePicker() {
    const typeBtns = document.querySelectorAll('.type-btn');

    // Always force set the initial active state based on variable
    typeBtns.forEach(btn => {
        if (btn.dataset.type === selectedProjectType) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }

        btn.addEventListener('click', () => {
            typeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedProjectType = btn.dataset.type;
        });
    });
}

// Setup build type picker
function setupBuildTypePicker() {
    const buildBtns = document.querySelectorAll('.build-type-btn');

    // Always force set the initial active state based on variable
    buildBtns.forEach(btn => {
        if (btn.dataset.build === selectedBuildType) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }

        btn.addEventListener('click', () => {
            buildBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedBuildType = btn.dataset.build;
        });
    });
}

// Setup ZIP upload
function setupZipUpload() {
    const zone = elements.zipUploadZone;
    const input = elements.zipInput;

    zone.addEventListener('click', () => {
        if (!selectedZipFile) {
            input.click();
        }
    });

    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleZipFile(file);
    });

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.zip')) {
            handleZipFile(file);
        }
    });

    elements.removeZipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeZip();
    });
}

function handleZipFile(file) {
    if (!file.name.endsWith('.zip')) {
        showZipError('Please select a ZIP file');
        return;
    }

    if (file.size > 2 * 1024 * 1024 * 1024) {
        showZipError('File too large. Max 2GB.');
        return;
    }

    selectedZipFile = file;
    elements.zipFileName.textContent = file.name;
    elements.zipPlaceholder.classList.add('hidden');
    elements.zipPreview.classList.remove('hidden');
}

function removeZip() {
    selectedZipFile = null;
    elements.zipInput.value = '';
    elements.zipFileName.textContent = '';
    elements.zipPlaceholder.classList.remove('hidden');
    elements.zipPreview.classList.add('hidden');
}

// Setup ZIP form
function setupZipForm() {
    elements.zipBuildForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await startZipBuild();
    });

    elements.zipRetryBtn.addEventListener('click', () => {
        resetZipForm();
    });
}

async function startZipBuild() {
    if (!selectedZipFile) {
        showZipError('Please select a ZIP file');
        return;
    }

    showZipProgress();
    elements.zipProgressText.textContent = 'Uploading project...';
    elements.zipProgressFill.style.width = '5%';

    // Create abort controller for timeout (30 minutes for Flutter builds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000); // 30 minute timeout

    // Store interval reference for cleanup
    let progressInterval = null;

    try {
        const formData = new FormData();
        formData.append('zipFile', selectedZipFile);
        formData.append('projectType', selectedProjectType);
        formData.append('buildType', selectedBuildType);
        formData.append('sessionId', sessionId);

        // Start progress animation
        let progress = 5;
        progressInterval = setInterval(() => {
            progress = Math.min(progress + Math.random() * 8, 90);
            elements.zipProgressFill.style.width = `${progress}%`;

            if (progress < 15) {
                elements.zipProgressText.textContent = 'Uploading project...';
            } else if (progress < 25) {
                elements.zipProgressText.textContent = 'Extracting files...';
            } else if (progress < 40) {
                elements.zipProgressText.textContent = 'Installing dependencies...';
            } else if (progress < 70) {
                elements.zipProgressText.textContent = 'Building APK (this may take a while)...';
            } else {
                elements.zipProgressText.textContent = 'Finalizing build...';
            }
        }, 2000);

        console.log('[ZIP Build] Starting build request...');

        // Use legacy endpoint which is more reliable
        const response = await fetch('/api/build-zip', {
            method: 'POST',
            headers: getAuthHeader(),
            body: formData,
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (progressInterval) clearInterval(progressInterval);

        console.log('[ZIP Build] Response status:', response.status);

        if (!response.ok) {
            const data = await response.json().catch(() => ({ error: 'Server error' }));
            throw new Error(data.error || `Build failed (HTTP ${response.status})`);
        }

        const data = await response.json();
        console.log('[ZIP Build] Response data:', data);

        if (data.success && data.downloadUrl) {
            console.log('[ZIP Build] Build successful! Calling showZipResult immediately...');

            // PRIORITY 1: Show result UI immediately
            try {
                // Try direct call
                showZipResult(data.downloadUrl, data.expiresIn || 120);

                // Backup: force it via timeout just in case the execution stack was busy
                setTimeout(() => {
                    showZipResult(data.downloadUrl, data.expiresIn || 120);
                }, 100);
            } catch (e) {
                console.error('[ZIP Build] Formatting error in showZipResult:', e);
            }

            // PRIORITY 2: Update progress indicators
            if (elements.zipProgressFill) elements.zipProgressFill.style.width = '100%';
            if (elements.zipProgressText) elements.zipProgressText.textContent = 'Build complete!';

            console.log('[ZIP Build] UI updated. Now refreshing logs...');

            // PRIORITY 3: Logs (can fail without blocking UI)
            loadLogs().catch(err => console.error('Failed to load logs:', err));

        } else if (data.success && !data.downloadUrl) {
            // Build claimed success but no download URL - this is a bug
            console.error('[ZIP Build] Build succeeded but no downloadUrl in response!');
            throw new Error('Build succeeded but download link was not generated. Check server logs.');
        } else {
            throw new Error(data.error || 'Build failed');
        }

    } catch (error) {
        clearTimeout(timeoutId);
        if (progressInterval) clearInterval(progressInterval);

        console.error('[ZIP Build] Error:', error);

        let errorMessage = error.message;
        if (error.name === 'AbortError') {
            errorMessage = 'Build timeout (30 minutes). Check PM2 logs - build may still be running in background.';
        } else if (error.message === 'Failed to fetch') {
            errorMessage = 'Network error. Check your connection and try again.';
        }

        showZipError(errorMessage);
        loadLogs(); // Show error logs
    }
}

function handleSSEEvent(event, data) {
    switch (event) {
        case 'progress':
            elements.zipProgressFill.style.width = `${data.progress}%`;
            elements.zipProgressText.textContent = data.status;
            loadLogs(); // Auto-refresh logs
            break;
        case 'complete':
            elements.zipProgressFill.style.width = '100%';
            elements.zipProgressText.textContent = 'Build complete!';
            loadLogs(); // Final logs refresh
            setTimeout(() => {
                showZipResult(data.downloadUrl, data.expiresIn);
            }, 500);
            break;
        case 'error':
            showZipError(data.error);
            loadLogs(); // Show error in logs
            break;
    }
}

function showZipProgress() {
    elements.zipBuildBtn.disabled = true;
    elements.zipBuildProgress.classList.remove('hidden');
    elements.zipBuildResult.classList.add('hidden');
    elements.zipBuildError.classList.add('hidden');
    elements.zipProgressFill.style.width = '0%';
    elements.zipProgressText.textContent = 'Starting build...';

    // Save progress state
    saveBuildState('zip', { status: 'progress' });
}

function showZipResult(downloadUrl, expiresIn) {
    console.log('[showZipResult] Called with URL:', downloadUrl, 'expiresIn:', expiresIn);

    // Validate download URL
    if (!downloadUrl) {
        console.error('[showZipResult] No download URL provided!');
        showZipError('Download link not available. Please try again.');
        return;
    }

    // Store URL for fallback
    const savedUrl = downloadUrl;

    // Save result state for browser close/refresh recovery
    saveBuildState('zip', {
        status: 'result',
        downloadUrl: downloadUrl,
        expiresIn: expiresIn || 120
    });

    try {
        // Hide progress, show result using WebView-safe method
        setElementVisible(elements.zipBuildProgress, false);
        setElementVisible(elements.zipBuildError, false);
        setElementVisible(elements.zipBuildResult, true);

        // Set download button href
        const downloadBtn = elements.zipDownloadBtn;
        if (downloadBtn) {
            downloadBtn.href = downloadUrl;
            downloadBtn.setAttribute('download', '');
            console.log('[showZipResult] Download button href set to:', downloadBtn.href);
        } else {
            console.error('[showZipResult] Download button element not found!');
        }

        // Set countdown timer
        let timeLeft = expiresIn || 60;
        if (elements.zipExpireTime) {
            elements.zipExpireTime.textContent = timeLeft;
        }

        // Clear any existing countdown
        if (zipExpireCountdown) {
            clearInterval(zipExpireCountdown);
            zipExpireCountdown = null;
        }

        // Start countdown
        zipExpireCountdown = setInterval(() => {
            timeLeft--;
            if (elements.zipExpireTime) {
                elements.zipExpireTime.textContent = timeLeft;
            }

            if (timeLeft <= 0) {
                clearInterval(zipExpireCountdown);
                zipExpireCountdown = null;
                resetZipForm();
            }
        }, 1000);

        console.log('[showZipResult] Result panel should now be visible');

        // Force scroll to result for mobile/WebView
        const resultEl = elements.zipBuildResult;
        if (resultEl) {
            requestAnimationFrame(() => {
                resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        }

        // FALLBACK: Check if result is actually visible after 1 second
        // If not, show alert with download URL so user can still download
        setTimeout(() => {
            if (!isElementVisible(elements.zipBuildResult)) {
                console.warn('[showZipResult] Result panel still not visible! Showing fallback alert.');
                alert('Build berhasil! 🎉\n\nDownload APK Anda di:\n' + savedUrl + '\n\n(Salin link ini jika tombol tidak muncul)');
            }
        }, 1000);

    } catch (e) {
        console.error('[showZipResult] Error showing result:', e);
        alert('Build berhasil! 🎉\n\nDownload APK Anda di:\n' + savedUrl);
    }
}

function showZipError(message) {
    elements.zipBuildProgress.classList.add('hidden');
    elements.zipBuildResult.classList.add('hidden');
    elements.zipBuildError.classList.remove('hidden');
    elements.zipErrorMessage.textContent = message;
    elements.zipBuildBtn.disabled = false;
}

function resetZipForm() {
    elements.zipBuildBtn.disabled = false;
    elements.zipBuildProgress.classList.add('hidden');
    elements.zipBuildResult.classList.add('hidden');
    elements.zipBuildError.classList.add('hidden');
    elements.zipProgressFill.style.width = '0%';
    removeZip();

    if (zipExpireCountdown) {
        clearInterval(zipExpireCountdown);
        zipExpireCountdown = null;
    }

    // Clear saved state
    clearBuildState('zip');
}

// ==================== LOGS PANEL ====================

let logsAutoRefreshInterval = null;
let isBuildInProgress = false;
let logsEventSource = null;
let cachedLogs = []; // Store logs for rendering

function setupLogs() {
    // Toggle logs panel
    logsToggle.addEventListener('click', (e) => {
        // Ignore if clicking the refresh or clear button
        if (e.target.closest('.logs-refresh') || e.target.closest('.logs-clear')) return;
        logsCard.classList.toggle('collapsed');
    });

    // Refresh logs button
    if (logsRefreshBtn) {
        logsRefreshBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Add spinning animation
            const icon = logsRefreshBtn.querySelector('i');
            if (icon) {
                icon.style.animation = 'spin 0.5s linear';
                setTimeout(() => icon.style.animation = '', 500);
            }
            loadLogs();
            showToast('Log refreshed!', 'success');
        });
    }

    // Clear logs button
    if (logsClearBtn) {
        logsClearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearLogs();
        });
    }

    // Start real-time SSE log streaming
    startLogsSSE();

    // Fallback: Also keep polling as backup
    startLogsAutoRefresh();
}

// Start Server-Sent Events for real-time logs
function startLogsSSE() {
    if (logsEventSource) {
        logsEventSource.close();
    }

    try {
        logsEventSource = new EventSource(`/api/logs/stream?sessionId=${sessionId}`);

        logsEventSource.addEventListener('connected', (e) => {
            console.log('[Logs SSE] Connected:', JSON.parse(e.data));
        });

        logsEventSource.addEventListener('initial', (e) => {
            const logs = JSON.parse(e.data);
            cachedLogs = logs;
            renderLogs(logs);
            console.log('[Logs SSE] Received initial logs:', logs.length);
        });

        logsEventSource.addEventListener('log', (e) => {
            const log = JSON.parse(e.data);
            // Add new log to the beginning (newest first)
            cachedLogs.unshift(log);
            // Keep only last 100 logs
            if (cachedLogs.length > 100) cachedLogs.pop();
            // Re-render immediately for real-time effect
            renderLogs(cachedLogs);
            console.log('[Logs SSE] New log:', log.message);
        });

        logsEventSource.addEventListener('heartbeat', (e) => {
            // Connection is alive, no action needed
        });

        logsEventSource.onerror = (e) => {
            console.error('[Logs SSE] Error, reconnecting in 3s...', e);
            logsEventSource.close();
            logsEventSource = null;
            // Reconnect after delay
            setTimeout(startLogsSSE, 3000);
        };
    } catch (error) {
        console.error('[Logs SSE] Failed to start:', error);
    }
}

async function clearLogs() {
    try {
        const response = await fetch(`/api/logs?sessionId=${sessionId}`, { method: 'DELETE' });
        if (response.ok) {
            cachedLogs = [];
            logsContainer.innerHTML = `
                <div class="log-empty">
                    <i class="ri-inbox-line"></i>
                    <span>No build logs yet</span>
                </div>
            `;
        }
    } catch (error) {
        console.error('Failed to clear logs:', error);
    }
}

function startLogsAutoRefresh() {
    if (logsAutoRefreshInterval) {
        clearInterval(logsAutoRefreshInterval);
    }

    // Use longer interval as backup (SSE is primary)
    logsAutoRefreshInterval = setInterval(() => {
        // Only poll if SSE is not connected
        if (!logsEventSource || logsEventSource.readyState !== EventSource.OPEN) {
            loadLogs();
        }
    }, 10000); // 10 seconds backup
}

function setBuildInProgress(inProgress) {
    isBuildInProgress = inProgress;
}

// Render logs from cache
function renderLogs(logs) {
    if (!logs || logs.length === 0) {
        logsContainer.innerHTML = `
            <div class="log-empty">
                <i class="ri-inbox-line"></i>
                <span>No build logs yet</span>
            </div>
        `;
        return;
    }

    // Check if there's an active build based on recent logs
    const recentLog = logs[0];
    const isRecent = (Date.now() - new Date(recentLog.timestamp).getTime()) < 30000;
    const isBuilding = isRecent && !['success', 'error'].includes(recentLog.level);

    if (isBuilding !== isBuildInProgress) {
        setBuildInProgress(isBuilding);
    }

    logsContainer.innerHTML = logs.map(log => {
        const time = new Date(log.timestamp).toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const detailsHtml = log.details
            ? `<div class="log-details">${typeof log.details === 'object' ? JSON.stringify(log.details) : log.details}</div>`
            : '';

        return `
            <div class="log-entry level-${log.level}">
                <span class="log-time">${time}</span>
                <span class="log-level">${log.level}</span>
                <div class="log-message">
                    ${escapeHtml(log.message)}
                    ${detailsHtml}
                </div>
            </div>
        `;
    }).join('');

    // Auto-scroll to top (newest logs first)
    logsContainer.scrollTop = 0;
}

async function loadLogs() {
    try {
        const response = await fetch(`/api/logs?sessionId=${sessionId}`);
        const logs = await response.json();
        cachedLogs = logs;
        renderLogs(logs);
    } catch (error) {
        console.error('Failed to load logs:', error);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== ANALYZE & CLEANUP BUTTONS ====================

// Helper to show alert/toast
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        padding: 12px 24px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 9999;
        animation: slideUp 0.3s ease;
        max-width: 90%;
        text-align: center;
    `;

    if (type === 'success') toast.style.background = 'rgba(16, 185, 129, 0.95)';
    else if (type === 'error') toast.style.background = 'rgba(239, 68, 68, 0.95)';
    else toast.style.background = 'rgba(99, 102, 241, 0.95)';

    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideDown 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==================== TOOL ELEMENTS ====================
const toolElements = {
    resultArea: document.getElementById('toolResultArea'),
    logContent: document.getElementById('toolLogContent'),
    resultStats: document.getElementById('toolResultStats'),
    status: document.getElementById('toolStatus'),
    hint: document.getElementById('toolHint'),
    downloadLogBtn: document.getElementById('downloadLogBtn'),
    clearLogBtn: document.getElementById('clearLogBtn'),
    statSaved: document.getElementById('statSaved'),
    statBefore: document.getElementById('statBefore'),
    statAfter: document.getElementById('statAfter')
};

let currentToolLog = '';
let currentToolType = '';

function setToolStatus(status, text) {
    if (!toolElements.status) return;

    const colors = {
        ready: { bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981', icon: 'ri-checkbox-circle-fill' },
        processing: { bg: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', icon: 'ri-loader-4-line' },
        success: { bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981', icon: 'ri-checkbox-circle-fill' },
        error: { bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171', icon: 'ri-error-warning-fill' }
    };

    const c = colors[status] || colors.ready;
    toolElements.status.style.background = c.bg;
    toolElements.status.style.color = c.color;
    toolElements.status.innerHTML = `<i class="${c.icon}" ${status === 'processing' ? 'style="animation: spin 1s linear infinite;"' : ''}></i> ${text}`;
}

function showToolLog(log, type = 'info') {
    if (!toolElements.resultArea || !toolElements.logContent) return;

    toolElements.resultArea.classList.remove('hidden');
    toolElements.hint?.classList.add('hidden');

    currentToolLog = log;
    currentToolType = type;

    // Colorize log output
    let formattedLog = log
        .replace(/error/gi, '<span style="color: #f87171;">error</span>')
        .replace(/warning/gi, '<span style="color: #fbbf24;">warning</span>')
        .replace(/info/gi, '<span style="color: #60a5fa;">info</span>')
        .replace(/success|✓|passed/gi, '<span style="color: #10b981;">$&</span>');

    toolElements.logContent.innerHTML = formattedLog || '<span style="color: #10b981;">✓ No issues found!</span>';
}

function showToolStats(saved, before, after) {
    if (!toolElements.resultStats) return;

    toolElements.resultStats.classList.remove('hidden');
    toolElements.statSaved.textContent = saved;
    toolElements.statBefore.textContent = before;
    toolElements.statAfter.textContent = after;
}

function hideToolResults() {
    toolElements.resultArea?.classList.add('hidden');
    toolElements.resultStats?.classList.add('hidden');
    toolElements.hint?.classList.remove('hidden');
    setToolStatus('ready', 'Ready');
}

function downloadToolLog() {
    if (!currentToolLog) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${currentToolType}_log_${timestamp}.txt`;
    const blob = new Blob([currentToolLog], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
    showToast('Log downloaded!', 'success');
}

// Setup log buttons
toolElements.downloadLogBtn?.addEventListener('click', downloadToolLog);
toolElements.clearLogBtn?.addEventListener('click', hideToolResults);

// Setup Analyze button
document.getElementById('analyzeBtn')?.addEventListener('click', async () => {
    if (!selectedZipFile) {
        showToast('Upload file ZIP terlebih dahulu!', 'error');
        return;
    }

    const btn = document.getElementById('analyzeBtn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line" style="animation: spin 1s linear infinite;"></i> <span>Analyzing...</span>';

    setToolStatus('processing', 'Analyzing...');
    hideToolResults();

    try {
        const formData = new FormData();
        formData.append('zipFile', selectedZipFile);
        formData.append('projectType', selectedProjectType);

        const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: getAuthHeader(),
            body: formData
        });

        // Check content type before parsing
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error(`Server error: ${response.status}. Check server logs.`);
        }

        const data = await response.json();

        if (data.success) {
            const output = data.output || 'No issues found!';
            showToolLog(output, 'analyze');
            setToolStatus('success', 'Complete');
            showToast('Analyze selesai!', 'success');
        } else {
            showToolLog(data.error || 'Analyze failed', 'analyze');
            setToolStatus('error', 'Failed');
            showToast(data.error || 'Analyze failed', 'error');
        }
    } catch (error) {
        showToolLog(error.message, 'analyze');
        setToolStatus('error', 'Error');
        showToast(error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
});

// Setup Cleanup button
document.getElementById('cleanupBtn')?.addEventListener('click', async () => {
    if (!selectedZipFile) {
        showToast('Upload file ZIP terlebih dahulu!', 'error');
        return;
    }

    const btn = document.getElementById('cleanupBtn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line" style="animation: spin 1s linear infinite;"></i> <span>Cleaning...</span>';

    setToolStatus('processing', 'Cleaning...');
    hideToolResults();

    try {
        const formData = new FormData();
        formData.append('zipFile', selectedZipFile);
        formData.append('projectType', selectedProjectType);

        const response = await fetch('/api/cleanup', {
            method: 'POST',
            headers: getAuthHeader(),
            body: formData
        });

        // Check content type before parsing
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error(`Server error: ${response.status}. Check server logs.`);
        }

        const data = await response.json();

        if (data.success) {
            const beforeMB = (data.sizeBefore / (1024 * 1024)).toFixed(2);
            const afterMB = (data.sizeAfter / (1024 * 1024)).toFixed(2);

            const logMessage = `✓ Cleanup completed successfully!

Project Type: ${selectedProjectType}
Before: ${beforeMB} MB
After: ${afterMB} MB
Saved: ${data.savedMB} MB (${((data.savedBytes / data.sizeBefore) * 100).toFixed(1)}%)

Download link ready for 2 minutes.`;

            showToolLog(logMessage, 'cleanup');
            showToolStats(data.savedMB, beforeMB, afterMB);
            setToolStatus('success', 'Complete');
            showToast(`✅ Cleanup selesai! Hemat ${data.savedMB} MB`, 'success');

            // Auto download cleaned project
            if (data.downloadUrl) {
                setTimeout(() => {
                    const a = document.createElement('a');
                    a.href = data.downloadUrl;
                    a.download = 'cleaned_project.zip';
                    a.click();
                }, 500);
            }
        } else {
            showToolLog(data.error || 'Cleanup failed', 'cleanup');
            setToolStatus('error', 'Failed');
            showToast(data.error || 'Cleanup failed', 'error');
        }
    } catch (error) {
        showToolLog(error.message, 'cleanup');
        setToolStatus('error', 'Error');
        showToast(error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
});

// Add CSS animation for toast
const style = document.createElement('style');
style.textContent = `
    @keyframes slideUp {
        from { transform: translateX(-50%) translateY(100px); opacity: 0; }
        to { transform: translateX(-50%) translateY(0); opacity: 1; }
    }
    @keyframes slideDown {
        from { transform: translateX(-50%) translateY(0); opacity: 1; }
        to { transform: translateX(-50%) translateY(100px); opacity: 0; }
    }
`;
document.head.appendChild(style);
