const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const { generateProject } = require('./projectGenerator');

/**
 * Build APK from user configuration
 * @param {Object} config - User configuration
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Object>} Build result
 */
async function buildApk(config, onProgress = () => { }) {
    const buildId = uuidv4();
    const buildDir = path.join(__dirname, '..', '..', 'temp', buildId);

    try {
        onProgress('📋 Menyiapkan project...');

        // Generate Android project from template
        await generateProject(buildDir, config);

        onProgress('🔨 Mengompilasi APK...');

        // Build APK with Gradle
        const gradleResult = await runGradle(buildDir, onProgress);

        if (!gradleResult.success) {
            throw new Error(gradleResult.error);
        }

        // Find the output APK
        const apkPath = await findApk(buildDir);

        if (!apkPath) {
            throw new Error('APK tidak ditemukan setelah build');
        }

        // Copy APK to output directory with proper name
        const outputDir = path.join(__dirname, '..', '..', 'output');
        await fs.ensureDir(outputDir);

        const sanitizedName = config.appName.replace(/[^a-zA-Z0-9]/g, '_');
        const finalApkPath = path.join(outputDir, `${sanitizedName}_${Date.now()}.apk`);
        await fs.copy(apkPath, finalApkPath);

        onProgress('✅ APK berhasil dibuat!');

        return {
            success: true,
            apkPath: finalApkPath,
            buildDir: buildDir
        };

    } catch (error) {
        console.error('Build error:', error);

        // Cleanup on error
        await fs.remove(buildDir).catch(() => { });

        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Run Gradle build
 */
async function runGradle(projectDir, onProgress) {
    return new Promise(async (resolve) => {
        const isWindows = process.platform === 'win32';

        // Use gradlew wrapper to ensure correct Gradle version (7.5) for AGP 7.4.2
        const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';

        // Ensure gradlew is executable on Unix systems
        if (!isWindows) {
            try {
                const gradlewPath = path.join(projectDir, 'gradlew');
                await fs.chmod(gradlewPath, 0o755);
            } catch (e) {
                console.warn('[Gradle] Warning: Could not set gradlew executable:', e.message);
            }
        }

        // Ensure gradle-wrapper.jar exists (critical for wrapper to work)
        const wrapperJarPath = path.join(projectDir, 'gradle', 'wrapper', 'gradle-wrapper.jar');
        if (!await fs.pathExists(wrapperJarPath)) {
            onProgress('📥 Downloading Gradle wrapper...');
            try {
                await downloadGradleWrapper(wrapperJarPath);
                console.log('[Gradle] Downloaded gradle-wrapper.jar successfully');
            } catch (e) {
                console.error('[Gradle] Failed to download wrapper:', e.message);
                resolve({
                    success: false,
                    error: 'Gagal download Gradle wrapper. Periksa koneksi internet.'
                });
                return;
            }
        }

        onProgress('🔨 Building with Gradle 7.5 (via wrapper)...');

        // Standard build flags for VPS/Desktop - optimized for low CPU usage
        const args = [
            'assembleDebug',
            '--no-daemon',
            '--no-watch-fs',
            '--no-build-cache',
            '--no-parallel',           // Disable parallel to reduce CPU load
            '-Dorg.gradle.workers.max=1',  // Limit worker threads
            '--stacktrace'
        ];

        // Use nice/ionice on Linux to lower process priority (prevent CPU overload)
        const isLinux = process.platform === 'linux';
        let spawnCmd = gradleCmd;
        let spawnArgs = args;

        if (isLinux) {
            spawnCmd = 'nice';
            spawnArgs = ['-n', '10', 'ionice', '-c', '2', '-n', '4', gradleCmd, ...args];
        }

        const gradle = spawn(spawnCmd, spawnArgs, {
            cwd: projectDir,
            shell: true,
            env: {
                ...process.env,
                JAVA_HOME: process.env.JAVA_HOME || '',
                ANDROID_HOME: process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '',
                // REDUCED: 1.5GB heap + SerialGC to prevent CPU overload + 1GB Metaspace
                GRADLE_OPTS: (process.env.GRADLE_OPTS || '') + ' -Dfile.encoding=UTF-8 -Xmx1536m -XX:MaxMetaspaceSize=1024m -XX:+UseSerialGC -XX:ParallelGCThreads=1',
                _JAVA_OPTIONS: '-Xmx1536m -Dfile.encoding=UTF-8 -XX:+UseSerialGC'
            }
        });

        let stdout = '';
        let stderr = '';

        gradle.stdout.on('data', (data) => {
            stdout += data.toString();
            // Parse progress if available
            const output = data.toString();
            if (output.includes('BUILD')) {
                onProgress('🔨 Building...');
            }
        });

        gradle.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        gradle.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true });
            } else {
                // Log full output for debugging
                console.error('=== GRADLE BUILD FAILED ===');
                console.error('STDOUT:', stdout);
                console.error('STDERR:', stderr);
                console.error('===========================');

                // Extract meaningful error message
                let errorMsg = 'Build gagal';
                const allOutput = stdout + stderr;
                const lines = allOutput.split('\n');

                if (allOutput.includes('SDK location not found')) {
                    errorMsg = 'Android SDK tidak ditemukan. Pastikan ANDROID_HOME sudah diset.';
                } else if (allOutput.includes('JAVA_HOME')) {
                    errorMsg = 'Java tidak ditemukan. Pastikan JAVA_HOME sudah diset.';
                } else if (allOutput.includes('Could not find com.android.tools')) {
                    errorMsg = 'Android Gradle Plugin tidak ditemukan. Periksa koneksi internet.';
                } else {
                    // Try to find the actual error message in order of priority
                    let foundError = false;

                    // 1. Look for lines starting with "> " after "FAILURE:" (Gradle's actual error description)
                    const failureIndex = lines.findIndex(l => l.includes('FAILURE:'));
                    if (failureIndex !== -1) {
                        const errorDetails = [];
                        for (let i = failureIndex + 1; i < lines.length && i < failureIndex + 10; i++) {
                            const line = lines[i].trim();
                            if (line.startsWith('> ')) {
                                errorDetails.push(line.substring(2).trim());
                            } else if (line.startsWith('* ')) {
                                // Stop at next section
                                break;
                            }
                        }
                        if (errorDetails.length > 0) {
                            errorMsg = errorDetails.join(' - ');
                            foundError = true;
                        }
                    }

                    // 2. Look for "error:" pattern (compiler errors)
                    if (!foundError) {
                        const errorLines = lines.filter(l => l.toLowerCase().includes('error:') && !l.includes('help.gradle.org'));
                        if (errorLines.length > 0) {
                            // Get first meaningful error, limit length
                            errorMsg = errorLines[0].substring(0, 200);
                            foundError = true;
                        }
                    }

                    // 3. Look for "Exception" lines
                    if (!foundError) {
                        const exceptionLines = lines.filter(l => l.includes('Exception') || l.includes('exception'));
                        if (exceptionLines.length > 0) {
                            errorMsg = exceptionLines[0].substring(0, 200);
                            foundError = true;
                        }
                    }

                    // 4. Fallback: find any line with "failed" but not generic ones
                    if (!foundError) {
                        const failedLines = lines.filter(l =>
                            l.toLowerCase().includes('failed') &&
                            !l.includes('BUILD FAILED') &&
                            !l.includes('help.gradle.org') &&
                            l.trim().length > 10
                        );
                        if (failedLines.length > 0) {
                            errorMsg = failedLines[0].substring(0, 200);
                            foundError = true;
                        }
                    }

                    // 5. Last resort: get context around BUILD FAILED
                    if (!foundError) {
                        const buildFailedIndex = lines.findIndex(l => l.includes('BUILD FAILED'));
                        if (buildFailedIndex > 1) {
                            // Get 2 lines before BUILD FAILED, skip empty lines
                            for (let i = buildFailedIndex - 1; i >= 0 && i > buildFailedIndex - 5; i--) {
                                const line = lines[i].trim();
                                if (line && !line.startsWith('*') && line.length > 5) {
                                    errorMsg = line.substring(0, 200);
                                    break;
                                }
                            }
                        }
                    }
                }
                resolve({
                    success: false,
                    error: errorMsg
                });
            }
        });

        gradle.on('error', (error) => {
            resolve({
                success: false,
                error: error.message
            });
        });

        // Timeout: 30 minutes absolute maximum
        const TIMEOUT_MS = 30 * 60 * 1000;
        const buildStartTime = Date.now();

        const timeoutCheck = setInterval(() => {
            const elapsed = Date.now() - buildStartTime;
            if (elapsed > TIMEOUT_MS) {
                clearInterval(timeoutCheck);
                try {
                    gradle.kill('SIGKILL'); // Force kill
                } catch (e) {
                    console.error('[Gradle] Failed to kill process:', e.message);
                }
                resolve({
                    success: false,
                    error: 'Build timeout (exceeded 30 minutes). Server mungkin overloaded, coba lagi nanti.'
                });
            }
        }, 30000); // Check every 30 seconds

        // Clear timeout when process ends
        gradle.on('close', () => clearInterval(timeoutCheck));
    });
}

/**
 * Find the built APK file
 */
async function findApk(projectDir) {
    const apkDir = path.join(projectDir, 'app', 'build', 'outputs', 'apk', 'release');

    if (!await fs.pathExists(apkDir)) {
        // Try debug folder
        const debugDir = path.join(projectDir, 'app', 'build', 'outputs', 'apk', 'debug');
        if (await fs.pathExists(debugDir)) {
            const files = await fs.readdir(debugDir);
            const apk = files.find(f => f.endsWith('.apk'));
            if (apk) return path.join(debugDir, apk);
        }
        return null;
    }

    const files = await fs.readdir(apkDir);
    const apk = files.find(f => f.endsWith('.apk'));

    return apk ? path.join(apkDir, apk) : null;
}

/**
 * Download gradle-wrapper.jar
 */
async function downloadGradleWrapper(targetPath) {
    const https = require('https');
    const http = require('http');

    // Ensure directory exists
    await fs.ensureDir(path.dirname(targetPath));

    // Gradle wrapper URLs to try (reliable, actively maintained repositories)
    const urls = [
        // Spring's gradle-wrapper repository (official Spring project)
        'https://raw.githubusercontent.com/spring-io/gradle-wrapper/main/gradle/wrapper/gradle-wrapper.jar',
        // Gradle official repository (always up to date)
        'https://raw.githubusercontent.com/gradle/gradle/v7.5.0/gradle/wrapper/gradle-wrapper.jar',
        // Android nowinandroid sample (maintained by Google)
        'https://raw.githubusercontent.com/android/nowinandroid/main/gradle/wrapper/gradle-wrapper.jar',
        // JetBrains Space repository
        'https://raw.githubusercontent.com/nicbou/markdown-notes/master/gradle/wrapper/gradle-wrapper.jar'
    ];

    for (const url of urls) {
        try {
            console.log(`[Gradle] Trying to download from: ${url}`);
            await downloadFile(url, targetPath);
            const stats = await fs.stat(targetPath);
            if (stats.size > 50000) { // Should be at least 50KB
                console.log(`[Gradle] Successfully downloaded from ${url} (${stats.size} bytes)`);
                return true;
            } else {
                console.warn(`[Gradle] Downloaded file too small (${stats.size} bytes), trying next source...`);
            }
        } catch (err) {
            console.error(`[Gradle] Failed to download from ${url}:`, err.message);
        }
    }

    throw new Error('Failed to download gradle wrapper from all sources. Check internet connection or firewall settings.');
}

/**
 * Download a file from URL
 */
function downloadFile(url, targetPath) {
    return new Promise((resolve, reject) => {
        const https = require('https');
        const file = fs.createWriteStream(targetPath);

        https.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                // Follow redirect
                downloadFile(res.headers.location, targetPath)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(targetPath, () => { });
            reject(err);
        });
    });
}

module.exports = { buildApk };
