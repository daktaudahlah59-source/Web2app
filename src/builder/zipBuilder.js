const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');

/**
 * Sanitize filename/path to remove invalid characters
 * Handles Unicode characters and special symbols that cause ADM-ZIP errors
 */
function sanitizePath(filePath) {
    if (!filePath) return filePath;

    // Replace backslashes with forward slashes for consistency
    let sanitized = filePath.replace(/\\/g, '/');

    // Remove or replace invalid characters for filesystem
    // Keep only alphanumeric, dash, underscore, dot, and forward slash
    sanitized = sanitized.replace(/[^\w\-./]/g, (char) => {
        // Keep common safe characters
        if (char === ' ') return '_';
        if (char === '(' || char === ')') return '';
        if (char === '[' || char === ']') return '';
        if (char === '{' || char === '}') return '';
        // For other characters, try to keep if ASCII printable, otherwise remove
        const code = char.charCodeAt(0);
        if (code >= 32 && code <= 126) return char;
        return '';
    });

    // Remove leading/trailing spaces and dots from path segments
    sanitized = sanitized.split('/').map(segment =>
        segment.trim().replace(/^\.+|\.+$/g, '') || segment
    ).join('/');

    // Remove double slashes
    sanitized = sanitized.replace(/\/+/g, '/');

    return sanitized;
}

/**
 * Safely extract ZIP file with filename sanitization
 * Handles ZIP files with invalid filenames that cause "ADM-ZIP: Invalid filename" error
 */
async function safeExtractZip(zipPath, targetDir) {
    await fs.ensureDir(targetDir);

    // 1. Try system 'unzip' command (Most native/robust for VPS)
    try {
        console.log('[ZIP] Attempting system unzip...');
        // -o: overwrite, -q: quiet, -d: destination
        // Use child_process directly to avoid circular dependency if runCommand isn't hoisted or available yet
        // But we have spawn imported. Let's use a simple promise wrapper.
        await new Promise((resolve, reject) => {
            const unzip = spawn('unzip', ['-o', '-q', zipPath, '-d', targetDir]);

            unzip.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`unzip process exited with code ${code}`));
            });

            unzip.on('error', (err) => {
                reject(err);
            });
        });

        console.log('[ZIP] System unzip success');
        return { success: true };
    } catch (sysError) {
        console.log(`[ZIP] System unzip failed (${sysError.message}), falling back to AdmZip...`);
    }

    // 2. Fallback to AdmZip with sanitization
    try {
        const zip = new AdmZip(zipPath);
        const entries = zip.getEntries();
        // ... existing AdmZip logic continues below via copy-paste or we just reuse the block
        // Since we are replacing the whole function, we need to provide the full fallback implementation

        let sanitized = false;

        for (const entry of entries) {
            try {
                // Sanitize the entry name
                const originalName = entry.entryName;
                const sanitizedName = sanitizePath(originalName);

                if (!sanitizedName || sanitizedName === '/') {
                    continue; // Skip invalid
                }

                const targetPath = path.join(targetDir, sanitizedName);

                // Security check
                const resolvedPath = path.resolve(targetPath);
                if (!resolvedPath.startsWith(path.resolve(targetDir))) {
                    continue; // Skip traversal
                }

                if (entry.isDirectory) {
                    await fs.ensureDir(targetPath);
                } else {
                    await fs.ensureDir(path.dirname(targetPath));
                    const content = entry.getData();
                    await fs.writeFile(targetPath, content);
                }

                if (originalName !== sanitizedName) {
                    sanitized = true;
                    console.log(`[ZIP] Renamed: "${originalName}" -> "${sanitizedName}"`);
                }
            } catch (entryError) {
                console.log(`[ZIP] Error extracting entry: ${entryError.message}`);
            }
        }

        return { success: true, sanitized };

    } catch (admError) {
        console.error('[ZIP] Safe extraction failed:', admError.message);
        throw new Error(`ZIP extraction failed: ${admError.message} (Try checking your ZIP file)`);
    }
}

/**
 * Build APK from ZIP project (Flutter or Android Studio)
 */
async function buildFromZip(zipPath, projectType, buildType, onProgress) {
    const jobId = uuidv4();
    const tempDir = path.join(__dirname, '..', '..', 'temp', jobId);

    try {
        // Extract ZIP with safe extraction (handles invalid filenames)
        onProgress('📂 Extracting project files...');
        const extractResult = await safeExtractZip(zipPath, tempDir);

        if (extractResult.sanitized) {
            onProgress('⚠️ Some filenames were sanitized during extraction');
        }

        // Find project root (look for build.gradle or pubspec.yaml)
        const projectRoot = await findProjectRoot(tempDir, projectType);
        if (!projectRoot) {
            throw new Error(`Invalid ${projectType} project. Required files not found.`);
        }

        onProgress('🔍 Project detected: ' + projectType);

        // Build based on project type
        let apkPath;
        if (projectType === 'flutter') {
            apkPath = await buildFlutter(projectRoot, buildType, onProgress);
        } else {
            apkPath = await buildAndroid(projectRoot, buildType, onProgress);
        }

        // Clean up ZIP file
        await fs.remove(zipPath).catch(() => { });

        return {
            success: true,
            apkPath: apkPath,
            buildDir: tempDir
        };

    } catch (error) {
        // Cleanup on error
        await fs.remove(tempDir).catch(() => { });
        await fs.remove(zipPath).catch(() => { });

        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Find project root directory
 */
async function findProjectRoot(dir, projectType) {
    const targetFile = projectType === 'flutter' ? 'pubspec.yaml' : 'build.gradle';

    // Check current directory
    if (await fs.pathExists(path.join(dir, targetFile))) {
        return dir;
    }

    // Check subdirectories (in case ZIP has a root folder)
    const items = await fs.readdir(dir);
    for (const item of items) {
        const itemPath = path.join(dir, item);
        const stat = await fs.stat(itemPath);
        if (stat.isDirectory()) {
            if (await fs.pathExists(path.join(itemPath, targetFile))) {
                return itemPath;
            }
        }
    }

    return null;
}

/**
 * Validate and fix corrupt asset files
 * Detects corrupt images that cause "Failed to bundle asset files" error
 */
async function validateAssets(projectDir, onProgress) {
    onProgress('🔍 Validating asset files...');

    const assetsDir = path.join(projectDir, 'assets');
    const imagesDir = path.join(projectDir, 'images');
    const corruptFiles = [];
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

    // Directories to check for images
    const dirsToCheck = [assetsDir, imagesDir];

    // Also check common asset subdirectories
    if (await fs.pathExists(assetsDir)) {
        try {
            const assetSubdirs = await fs.readdir(assetsDir);
            for (const subdir of assetSubdirs) {
                const subdirPath = path.join(assetsDir, subdir);
                const stat = await fs.stat(subdirPath).catch(() => null);
                if (stat?.isDirectory()) {
                    dirsToCheck.push(subdirPath);
                }
            }
        } catch (e) { /* ignore */ }
    }

    // Check each directory for images
    for (const dir of dirsToCheck) {
        if (!await fs.pathExists(dir)) continue;

        try {
            const files = await fs.readdir(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                const ext = path.extname(file).toLowerCase();

                if (!imageExtensions.includes(ext)) continue;

                try {
                    const stat = await fs.stat(filePath);

                    // Check if file is too small (likely corrupt)
                    if (stat.size < 10) {
                        console.log(`[VALIDATE] Corrupt file (too small): ${filePath}`);
                        corruptFiles.push(filePath);
                        continue;
                    }

                    // Check file header for valid image signature
                    // Read only first 12 bytes for header check
                    const fileBuffer = await fs.readFile(filePath);
                    const buffer = fileBuffer.slice(0, 12);

                    const isValidImage =
                        // PNG signature: 89 50 4E 47
                        (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) ||
                        // JPEG signature: FF D8 FF
                        (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) ||
                        // GIF signature: GIF87a or GIF89a
                        (buffer.toString('ascii', 0, 3) === 'GIF') ||
                        // WebP signature: RIFF....WEBP
                        (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') ||
                        // BMP signature: BM
                        (buffer[0] === 0x42 && buffer[1] === 0x4D);

                    if (!isValidImage) {
                        console.log(`[VALIDATE] Invalid image header: ${filePath}`);
                        corruptFiles.push(filePath);
                    }
                } catch (e) {
                    console.log(`[VALIDATE] Cannot read file: ${filePath} - ${e.message}`);
                    corruptFiles.push(filePath);
                }
            }
        } catch (e) {
            console.log(`[VALIDATE] Cannot scan directory: ${dir} - ${e.message}`);
        }
    }

    // Also check android res folders for corrupt images
    const androidResDir = path.join(projectDir, 'android', 'app', 'src', 'main', 'res');
    if (await fs.pathExists(androidResDir)) {
        try {
            // Directory scanning
            const resDirs = await fs.readdir(androidResDir);
            for (const resDir of resDirs) {
                if (!resDir.startsWith('mipmap') && !resDir.startsWith('drawable')) continue;

                const resDirPath = path.join(androidResDir, resDir);
                const stat = await fs.stat(resDirPath).catch(() => null);
                if (!stat?.isDirectory()) continue;

                const resFiles = await fs.readdir(resDirPath);
                for (const file of resFiles) {
                    const filePath = path.join(resDirPath, file);
                    const ext = path.extname(file).toLowerCase();

                    // Skip non-image files for now, unless they are xmls which checks strictness too? 
                    // Android strictness applies to ALL resources.
                    // But we focus on images for "failed to bundle asset".

                    // 1. SANITIZE FILENAME (Critical for 'Failed to bundle asset' error)
                    // Android requires: only [a-z0-9_.]
                    const nameWithoutExt = path.basename(file, ext); // file name without ext

                    // Check if name is invalid
                    if (!/^[a-z0-9_]+$/.test(nameWithoutExt)) {
                        // Fix: Lowercase, replace invalid chars with _, remove repeating _
                        let safeName = nameWithoutExt.toLowerCase()
                            .replace(/[^a-z0-9_]/g, '_')
                            .replace(/_+/g, '_')
                            .replace(/^_|_$/g, '');

                        // Ensure it's not empty, fallback to 'res'
                        if (!safeName) safeName = 'res_item';

                        // Check if it starts with number (not allowed)
                        if (/^[0-9]/.test(safeName)) {
                            safeName = 'img_' + safeName;
                        }

                        const newFileName = safeName + ext;
                        const newFilePath = path.join(resDirPath, newFileName);

                        if (file !== newFileName) {
                            try {
                                await fs.rename(filePath, newFilePath);
                                console.log(`[FIX] Renamed invalid resource: ${file} -> ${newFileName}`);
                                // Update filePath for further checks
                                // filePath = newFilePath; // (Can't reassign const, but loop continues)

                                // Recurse/continue with new file not needed immediately, just validation next
                                // But since we moved it, the old filePath is gone. 
                                // Let's check the *new* file for corruption if it's an image.
                                if (imageExtensions.includes(ext)) {
                                    // Check corruption on NEW path
                                    try {
                                        const newStat = await fs.stat(newFilePath);
                                        if (newStat.size < 10) {
                                            console.log(`[VALIDATE] Corrupt Android res file: ${newFilePath}`);
                                            corruptFiles.push(newFilePath);
                                        }
                                    } catch (e) { /* ignore */ }
                                }
                                continue; // Skip to next file in loop
                            } catch (e) {
                                console.log(`[FIX] Failed to rename ${file}: ${e.message}`);
                            }
                        }
                    }

                    // 2. CHECK CORRUPTION (Existing logic)
                    if (!imageExtensions.includes(ext)) continue;

                    try {
                        const stat = await fs.stat(filePath);
                        if (stat.size < 10) {
                            console.log(`[VALIDATE] Corrupt Android res file: ${filePath}`);
                            corruptFiles.push(filePath);
                        }
                    } catch (e) {
                        corruptFiles.push(filePath);
                    }
                }
            }
        } catch (e) { /* ignore */ }
    }

    // Remove corrupt files
    if (corruptFiles.length > 0) {
        onProgress(`⚠️ Found ${corruptFiles.length} corrupt image(s), removing...`);
        for (const file of corruptFiles) {
            try {
                await fs.remove(file);
                console.log(`[VALIDATE] Removed corrupt file: ${file}`);
            } catch (e) {
                console.log(`[VALIDATE] Failed to remove: ${file} - ${e.message}`);
            }
        }
    } else {
        console.log('[VALIDATE] All asset files are valid');
    }

    return { corruptFiles: corruptFiles.length };
}

/**
 * Fix settings.gradle for Flutter 3.x compatibility
 * Prevents "Failed to apply plugin 'dev.flutter.flutter-plugin-loader'" error
 */
async function fixSettingsGradle(projectDir, onProgress) {
    const settingsPath = path.join(projectDir, 'android', 'settings.gradle');

    if (!await fs.pathExists(settingsPath)) {
        console.log('[FIX] settings.gradle not found, skipping');
        return;
    }

    try {
        let content = await fs.readFile(settingsPath, 'utf8');
        let modified = false;

        // Check if using old format (include ':app' style) - support both ' and " quotes
        const includeAppRegex = /include\s+['"]:app['"]/;
        const hasOldFormat = includeAppRegex.test(content) &&
            !content.includes('pluginManagement');

        if (hasOldFormat) {
            onProgress('⚙️ Updating settings.gradle to Flutter 3.x format...');

            // New Flutter 3.x settings.gradle format
            const newContent = `pluginManagement {
    def flutterSdkPath = {
        def properties = new Properties()
        file("local.properties").withInputStream { properties.load(it) }
        def flutterSdkPath = properties.getProperty("flutter.sdk")
        assert flutterSdkPath != null, "flutter.sdk not set in local.properties"
        return flutterSdkPath
    }()

    includeBuild("\${flutterSdkPath}/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id "dev.flutter.flutter-gradle-plugin" version "1.0.0" apply false
    id "com.android.application" version "7.3.0" apply false
    id "org.jetbrains.kotlin.android" version "1.7.10" apply false
}

include ":app"
`;
            await fs.writeFile(settingsPath, newContent);
            console.log('[FIX] Updated settings.gradle to new Flutter format');
            modified = true;
        }

        // Also check for missing pluginManagement block (common in older Flutters but required for new Gradle)
        // We add it if it's missing, even if we didn't do the full rewrite above
        if (!content.includes('pluginManagement')) {
            onProgress('⚙️ Fixing settings.gradle plugin management...');

            // Add pluginManagement at the beginning
            const pluginMgmt = `pluginManagement {
    def flutterSdkPath = {
        def properties = new Properties()
        file("local.properties").withInputStream { properties.load(it) }
        def flutterSdkPath = properties.getProperty("flutter.sdk")
        assert flutterSdkPath != null, "flutter.sdk not set in local.properties"
        return flutterSdkPath
    }()

    includeBuild("\${flutterSdkPath}/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

`;
            content = pluginMgmt + content;
            await fs.writeFile(settingsPath, content);
            console.log('[FIX] Added pluginManagement block to settings.gradle');
            modified = true;
        }

        if (modified) {
            console.log('[FIX] settings.gradle has been updated');
            // Re-read content to ensure we have latest version for next check
            content = await fs.readFile(settingsPath, 'utf8');
        }

        // AGGRESSIVE FIX: Force replace deprecated plugin ID if it exists anywhere in the file
        // Previously we only did this if we rewrote the whole file, but user might have valid format with INVALID plugin ID
        if (content.includes('dev.flutter.flutter-plugin-loader')) {
            onProgress('⚙️ Replacing deprecated Flutter plugin loader ID...');
            // Replace with new ID and ensure 'apply false' if inside plugins block
            // Simple replace might be risky if syntax differs, but usually it's `id "..." version "..."`
            // We replace the ID and assume version is handled or we enforce version too?
            // Safest is to just replace the ID string if we trust the rest.
            // BUT, the old one might NOT have 'apply false'. The new one usually needs it in settings.gradle.

            // Regex to match: id "dev.flutter.flutter-plugin-loader" version "X.Y.Z"
            // Replace with: id "dev.flutter.flutter-gradle-plugin" version "1.0.0" apply false

            content = content.replace(
                /id\s+['"]dev\.flutter\.flutter-plugin-loader['"]\s+version\s+['"][^'"]+['"]/g,
                `id "dev.flutter.flutter-gradle-plugin" version "1.0.0" apply false`
            );

            await fs.writeFile(settingsPath, content);
            console.log('[FIX] Force replaced deprecated plugin ID');
            modified = true;
        }

    } catch (e) {
        console.log('[FIX] Could not update settings.gradle:', e.message);
    }
}

/**
 * Fix android/build.gradle for Kotlin version compatibility
 * Upgrades Kotlin to 1.7.10 if it's too old
 */
async function fixBuildGradle(projectDir, onProgress) {
    const buildGradlePath = path.join(projectDir, 'android', 'build.gradle');

    if (!await fs.pathExists(buildGradlePath)) {
        return;
    }

    try {
        let content = await fs.readFile(buildGradlePath, 'utf8');
        let modified = false;

        // Pattern for ext.kotlin_version = 'x.y.z'
        const kotlinVersionRegex = /ext\.kotlin_version\s*=\s*['"]([^'"]+)['"]/;
        const match = content.match(kotlinVersionRegex);

        if (match) {
            const version = match[1];
            // Check if version is old (starts with 1.3, 1.4, 1.5, 1.6)
            if (/^1\.[3-6]\./.test(version)) {
                onProgress(`⚙️ Upgrading Kotlin from ${version} to 1.9.0 (Standard for Flutter 3.x)...`);
                content = content.replace(kotlinVersionRegex, "ext.kotlin_version = '1.9.0'");
                modified = true;
            }
        }

        // Pattern for classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlin_version"
        // Ensure it uses the variable or correct version
        if (content.includes("org.jetbrains.kotlin:kotlin-gradle-plugin") && !content.includes("$kotlin_version")) {
            // Logic to force update hardcoded version if needed, but usually ext.kotlin_version is key
        }

        // Inject global lint options to prevent "unexpected lint return value -1" crashing build
        // This applies to ALL subprojects (including plugins like permission_handler)
        if (!content.includes('allprojects') && !content.includes('subprojects {')) {
            // Standard flutter build.gradle usually ends with rootProject.buildDir...
            // We can append this block at the end
            content += `
subprojects {
    afterEvaluate { project ->
        if (project.hasProperty("android")) {
            android {
                lintOptions {
                    checkReleaseBuilds false
                    abortOnError false
                }
            }
        }
    }
}
`;
            modified = true;
            onProgress('⚙️ Applied global lint suppression to all subprojects...');
        } else if (content.includes('subprojects {') && !content.includes('checkReleaseBuilds false')) {
            // If subprojects exists but strict linting isn't disabled, try to inject it? 
            // Too risky to parse complex gradle. safe appends are better or valid regex replaces.
            // Let's Just append our specific block as a separate subprojects call (Gradle allows multiple)
            content += `
subprojects {
    afterEvaluate { project ->
        if (project.hasProperty("android")) {
            android {
                lintOptions {
                    checkReleaseBuilds false
                    abortOnError false
                }
            }
        }
    }
}
`;
            modified = true;
            onProgress('⚙️ Applied global lint suppression (appended)...');
        }

        if (modified) {
            await fs.writeFile(buildGradlePath, content);
            console.log('[FIX] Updated build.gradle Kotlin version & Lint options');
        }

    } catch (e) {
        console.log('[FIX] Could not update build.gradle:', e.message);
    }
}

/**
 * Fix android/app/build.gradle for SDK version compatibility
 * Upgrades compileSdkVersion/targetSdkVersion to 34 if < 34
 */
async function fixAppBuildGradle(projectDir, onProgress) {
    const appBuildGradlePath = path.join(projectDir, 'android', 'app', 'build.gradle');

    if (!await fs.pathExists(appBuildGradlePath)) {
        return;
    }

    try {
        let content = await fs.readFile(appBuildGradlePath, 'utf8');
        let modified = false;

        // Function to replace version if numeric and old
        const checkAndReplace = (regex, type, minVersion = 34) => {
            const match = content.match(regex);
            if (match) {
                const version = parseInt(match[1]);
                if (!isNaN(version) && version < minVersion) {
                    onProgress(`⚙️ Upgrading ${type} from ${version} to ${minVersion}...`);
                    content = content.replace(regex, `${type} ${minVersion}`);
                    return true;
                }
            }
            return false;
        };

        // Check compileSdkVersion
        if (checkAndReplace(/compileSdkVersion\s+(\d+)/, 'compileSdkVersion')) modified = true;

        // Check targetSdkVersion
        if (checkAndReplace(/targetSdkVersion\s+(\d+)/, 'targetSdkVersion')) modified = true;

        // Check minSdkVersion (Upgrade to 21 if lower, required by many modern plugins)
        if (checkAndReplace(/minSdkVersion\s+(\d+)/, 'minSdkVersion', 21)) modified = true;

        // Force disable minifyEnabled and shrinkResources to prevent R8/ProGuard errors
        // Common issue: User enables minification but doesn't provide proper rules
        if (content.includes('minifyEnabled true')) {
            onProgress('⚙️ Disabling R8 minification to prevent known errors...');
            content = content.replace(/minifyEnabled\s+true/g, 'minifyEnabled false');
            modified = true;
        }

        if (content.includes('shrinkResources true')) {
            content = content.replace(/shrinkResources\s+true/g, 'shrinkResources false');
            modified = true;
        }

        // Disable Lint checks (Fix for: lintVitalAnalyzeRelease)
        if (!content.includes('lintOptions')) {
            onProgress('⚙️ Disabling strict lint checks...');
            // Insert inside android { ... } block
            // We search for 'defaultConfig {' or 'buildTypes {' which are usually inside android {}
            // But safest is to search for 'android {' provided the file is standard.
            // A safer regex replacement for end of android block might be complex.
            // Let's appending it to the end of the android block if we can find it, 
            // or just replace 'defaultConfig {' -> 'lintOptions { checkReleaseBuilds false \n abortOnError false } \n defaultConfig {'

            content = content.replace('defaultConfig {', `
    lintOptions {
        checkReleaseBuilds false
        abortOnError false
    }
    defaultConfig {`);
            modified = true;
        }

        if (modified) {
            await fs.writeFile(appBuildGradlePath, content);
            console.log('[FIX] Updated android/app/build.gradle SDK versions');
        }

    } catch (e) {
        console.log('[FIX] Could not update app/build.gradle:', e.message);
    }
}

/**
 * Build Flutter project
 */
async function buildFlutter(projectDir, buildType, onProgress) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/root';

    // ============================================
    // STEP 0: Validate asset files (fix corrupt images)
    // This prevents "Failed to bundle asset files" error
    // ============================================
    await validateAssets(projectDir, onProgress);

    // ============================================
    // STEP 0.5: Fix settings.gradle for Flutter 3.x
    // This prevents "Failed to apply plugin 'dev.flutter.flutter-plugin-loader'" error
    // ============================================
    await fixSettingsGradle(projectDir, onProgress);

    // ============================================
    // STEP 0.6: Fix build.gradle Kotlin version
    // This prevents "failed for task ':network_info_plus:compileReleaseKotlin'" error
    // ============================================
    await fixBuildGradle(projectDir, onProgress);

    // ============================================
    // STEP 0.7: Fix android/app/build.gradle SDK versions
    // This prevents "Cannot access 'FlutterPlugin'" error (requires SDK 33/34)
    // ============================================
    await fixAppBuildGradle(projectDir, onProgress);

    // ============================================
    // STEP 1: Aggressive Gradle cache cleanup using shell command
    // This fixes JetifyTransform failures with Flutter engine JARs
    // ============================================
    onProgress('🗑️ Cleaning Gradle caches (aggressive)...');

    try {
        // Use shell command for guaranteed deletion on Linux
        // Clean ALL Flutter-related caches to prevent JAR corruption issues
        await runCommand('rm', ['-rf',
            `${homeDir}/.gradle/caches/transforms-3`,
            `${homeDir}/.gradle/caches/transforms-4`,
            `${homeDir}/.gradle/caches/modules-2/files-2.1/io.flutter`,
            `${homeDir}/.gradle/caches/modules-2/metadata-*`,
            `${homeDir}/.gradle/caches/jars-8`,
            `${homeDir}/.gradle/caches/jars-9`,
            `${homeDir}/.gradle/caches/journal-1`,
            `${homeDir}/.pub-cache/hosted/pub.dev/webview_flutter*`, // Targeted cleanup for corrupt webview lib
            `${projectDir}/.gradle`,
            `${projectDir}/android/.gradle`,
            `${projectDir}/build`,
            `${projectDir}/android/app/build`,
            `${projectDir}/android/build`
        ], projectDir).catch(() => { });
    } catch (e) {
        console.log('[CLEAN] Shell cleanup partial:', e.message);
    }

    // Also try fs-based cleanup as fallback
    const gradleCacheDirs = [
        path.join(homeDir, '.gradle', 'caches', 'transforms-3'),
        path.join(homeDir, '.gradle', 'caches', 'transforms-4'),
        path.join(homeDir, '.gradle', 'caches', 'modules-2', 'files-2.1', 'io.flutter'),
        path.join(homeDir, '.gradle', 'caches', 'jars-8'),
        path.join(homeDir, '.gradle', 'caches', 'jars-9'),
        path.join(homeDir, '.gradle', 'caches', 'journal-1'),
        path.join(projectDir, '.gradle'),
        path.join(projectDir, 'android', '.gradle'),
        path.join(projectDir, 'build'),
        path.join(projectDir, 'android', 'app', 'build'),
        path.join(projectDir, 'android', 'build')
    ];

    for (const cacheDir of gradleCacheDirs) {
        try {
            await fs.remove(cacheDir);
        } catch (e) { /* ignore */ }
    }

    // ============================================
    // STEP 2: Disable Jetifier in gradle.properties
    // This prevents JetifyTransform from running on Flutter JARs
    // ============================================
    onProgress('⚙️ Configuring Gradle properties...');
    const gradlePropsPath = path.join(projectDir, 'android', 'gradle.properties');
    try {
        let gradleProps = '';
        if (await fs.pathExists(gradlePropsPath)) {
            gradleProps = await fs.readFile(gradlePropsPath, 'utf8');
        }

        // Add/update critical properties
        // Add/update critical properties
        // STABLE MODE: 2GB Heap + 2 Workers + No Daemon. Solves "Stream closed" / OOM.
        const propsToSet = {
            // Memory: 2GB heap (Safe for most VPS)
            'org.gradle.jvmargs': '-Xmx2048m -XX:MaxMetaspaceSize=512m -XX:+UseParallelGC -Dfile.encoding=UTF-8',
            'android.useAndroidX': 'true',
            'android.enableJetifier': 'false',
            'org.gradle.daemon': 'false',       // MUST be false to prevent background memory usage
            'org.gradle.parallel': 'true',      // Enabled but limited by workers
            'org.gradle.caching': 'true',       // Keep cache
            'org.gradle.workers.max': '2',      // MAX 2 Workers to prevent CPU/RAM overload
            'kotlin.compiler.execution.strategy': 'in-process'
        };

        for (const [key, value] of Object.entries(propsToSet)) {
            const regex = new RegExp(`^${key}=.*$`, 'm');
            if (regex.test(gradleProps)) {
                gradleProps = gradleProps.replace(regex, `${key}=${value}`);
            } else {
                gradleProps += `\n${key}=${value}`;
            }
        }

        await fs.writeFile(gradlePropsPath, gradleProps.trim() + '\n');
        console.log('[CONFIG] Updated gradle.properties with Jetifier disabled');
    } catch (e) {
        console.log('[CONFIG] Could not update gradle.properties:', e.message);
    }

    // ============================================
    // STEP 3: Flutter clean and pub get
    // ============================================
    onProgress('🧹 Running flutter clean...');
    await runCommand('flutter', ['clean'], projectDir).catch(() => { });

    onProgress('📦 Getting Flutter dependencies...');
    await runCommand('flutter', ['pub', 'get'], projectDir, onProgress);

    // ============================================
    // STEP 4: Build APK
    // ============================================
    onProgress('🔨 Building Flutter APK (this may take a while)...');
    const buildArgs = buildType === 'release'
        ? ['build', 'apk', '--release', '--no-tree-shake-icons']
        : ['build', 'apk', '--debug'];

    // Start keep-alive progress updates during build
    let keepAliveStep = 0;
    const buildingMessages = [
        '🔨 Compiling Dart code...',
        '⚙️ Processing resources...',
        '📦 Packaging APK...',
        '🔧 Optimizing assets...',
        '🚀 Building native code...',
        '📱 Generating APK bundle...'
    ];

    const keepAliveInterval = setInterval(() => {
        keepAliveStep++;
        const message = buildingMessages[keepAliveStep % buildingMessages.length];
        onProgress(message);
    }, 15000); // Update every 15 seconds

    // Retry mechanism for race condition with concurrent builds
    let buildAttempt = 0;
    const maxAttempts = 2;
    let lastError = null;

    while (buildAttempt < maxAttempts) {
        buildAttempt++;

        try {
            await runCommand('flutter', buildArgs, projectDir, (output) => {
                // Pass real output to progress callback
                if (output && output.trim()) {
                    onProgress(output);
                }
            });

            // Success - break out of retry loop
            lastError = null;
            break;

        } catch (buildError) {
            lastError = buildError;
            clearInterval(keepAliveInterval);

            // Check if error is JAR/cache related (race condition)
            const errorMsg = buildError.message || '';

            // SPECIFIC FIX: Corrupt Pub Cache (e.g. webview_flutter_android missing build.gradle)
            const pubCacheMatch = errorMsg.match(/Could not read build file '(.*\.pub-cache\/hosted\/pub\.dev\/[^']*)'/);
            if (pubCacheMatch && buildAttempt < maxAttempts) {
                const corruptPath = pubCacheMatch[1];
                console.log(`[BUILD] Corrupt pub cache detected: ${corruptPath}`);

                // Extract package root (folder after pub.dev)
                // Path: /root/.pub-cache/hosted/pub.dev/package_name-1.0.0/android/build.gradle
                const pathParts = corruptPath.split('/');
                const pubDevIndex = pathParts.indexOf('pub.dev');

                if (pubDevIndex !== -1 && pathParts[pubDevIndex + 1]) {
                    const packageName = pathParts[pubDevIndex + 1];
                    const packageRoot = pathParts.slice(0, pubDevIndex + 2).join('/');

                    onProgress(`⚠️ Corrupt library detected: ${packageName}`);
                    onProgress(`🗑️ Auto-healing: Deleting corrupt cache...`);

                    try {
                        await fs.remove(packageRoot);
                        console.log(`[HEAL] Deleted corrupt package: ${packageRoot}`);
                    } catch (e) {
                        // Try shell force delete if fs fails
                        await runCommand('rm', ['-rf', packageRoot], projectDir).catch(() => { });
                    }

                    // Proceed to retry loop (which performs flutter pub get)
                    continue;
                }
            }

            const isJarError = errorMsg.includes('flutter_embedding') ||
                errorMsg.includes('FileNotFoundException') ||
                errorMsg.includes('Could not read file') ||
                errorMsg.includes('No such file or directory') ||
                errorMsg.includes('.jar');

            if (isJarError && buildAttempt < maxAttempts) {
                console.log(`[BUILD] JAR error detected, retry ${buildAttempt}/${maxAttempts}...`);
                onProgress(`⚠️ Cache error, retrying (${buildAttempt}/${maxAttempts})...`);

                // Re-download dependencies
                onProgress('📦 Re-downloading Flutter dependencies...');
                // Delete lockfile to force fresh resolution compatible with SDK
                await fs.remove(path.join(projectDir, 'pubspec.lock')).catch(() => { });

                await runCommand('flutter', ['pub', 'get', '--enforce-lockfile'], projectDir).catch(() => { });
                await runCommand('flutter', ['pub', 'cache', 'repair'], projectDir).catch(() => { });

                // Restart keep-alive interval
                keepAliveStep = 0;
                continue;
            }

            // Not a JAR error or max retries reached
            throw buildError;
        }
    }

    clearInterval(keepAliveInterval);

    if (lastError) {
        throw lastError;
    }

    onProgress('✅ Build complete! Locating APK...');

    // Find APK
    const apkDir = path.join(projectDir, 'build', 'app', 'outputs', 'flutter-apk');
    const apkName = buildType === 'release' ? 'app-release.apk' : 'app-debug.apk';
    const apkPath = path.join(apkDir, apkName);

    if (!await fs.pathExists(apkPath)) {
        throw new Error('APK file not found after build');
    }

    // Copy to output
    const outputDir = path.join(__dirname, '..', '..', 'output');
    await fs.ensureDir(outputDir);
    const finalPath = path.join(outputDir, `flutter_${Date.now()}.apk`);
    await fs.copy(apkPath, finalPath);

    return finalPath;
}

/**
 * Build Android (Gradle) project
 */
async function buildAndroid(projectDir, buildType, onProgress) {
    const isWindows = process.platform === 'win32';
    const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';
    const gradlePath = path.join(projectDir, gradleCmd);

    // Check if gradlew exists, if not use global gradle
    let useGlobalGradle = false;
    if (!await fs.pathExists(gradlePath)) {
        useGlobalGradle = true;
    } else if (!isWindows) {
        // Make gradlew executable on Unix
        await fs.chmod(gradlePath, '755');
    }

    onProgress('🔨 Running Gradle build...');
    const buildTask = buildType === 'release' ? 'assembleRelease' : 'assembleDebug';

    // Stable build flags
    const gradleFlags = [
        buildTask,
        '--no-daemon',          // Essential for VPS stability
        '--build-cache',
        '--parallel',           // Parallel is fine with limited workers (max=2)
        '--max-workers=2',      // Explicitly limit workers via CLI too
        '--stacktrace'
    ];

    if (useGlobalGradle) {
        await runCommand('gradle', gradleFlags, projectDir);
    } else {
        await runCommand(gradlePath, gradleFlags, projectDir);
    }

    // Find APK
    onProgress('📦 Locating APK file...');
    const apkPath = await findApk(projectDir, buildType);

    if (!apkPath) {
        throw new Error('APK file not found after build');
    }

    // Copy to output
    const outputDir = path.join(__dirname, '..', '..', 'output');
    await fs.ensureDir(outputDir);
    const finalPath = path.join(outputDir, `android_${Date.now()}.apk`);
    await fs.copy(apkPath, finalPath);

    return finalPath;
}

/**
 * Find APK file in build outputs
 */
async function findApk(projectDir, buildType) {
    const possiblePaths = [
        path.join(projectDir, 'app', 'build', 'outputs', 'apk', buildType, `app-${buildType}.apk`),
        path.join(projectDir, 'build', 'outputs', 'apk', buildType, `app-${buildType}.apk`),
        path.join(projectDir, 'app', 'build', 'outputs', 'apk', buildType, 'app-debug.apk'),
        path.join(projectDir, 'build', 'outputs', 'apk', buildType, 'app-debug.apk'),
    ];

    for (const p of possiblePaths) {
        if (await fs.pathExists(p)) {
            return p;
        }
    }

    // Recursive search as fallback
    return await findFileRecursive(projectDir, '.apk');
}

/**
 * Recursive file search
 */
async function findFileRecursive(dir, ext, maxDepth = 5, depth = 0) {
    if (depth > maxDepth) return null;

    try {
        const items = await fs.readdir(dir);
        for (const item of items) {
            const itemPath = path.join(dir, item);
            const stat = await fs.stat(itemPath);

            if (stat.isFile() && item.endsWith(ext)) {
                return itemPath;
            }

            if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
                const found = await findFileRecursive(itemPath, ext, maxDepth, depth + 1);
                if (found) return found;
            }
        }
    } catch (e) { }

    return null;
}

/**
 * Run command with promise
 * @param {string} cmd - Command to run
 * @param {string[]} args - Command arguments
 * @param {string} cwd - Working directory
 * @param {function} onOutput - Optional callback for streaming output
 */
function runCommand(cmd, args, cwd, onOutput = null) {
    return new Promise((resolve, reject) => {
        // Create log file for debugging
        const logDir = path.join(__dirname, '..', '..', 'logs');
        fs.ensureDirSync(logDir);
        const logFile = path.join(logDir, `build_${Date.now()}.log`);

        // Use nice/ionice on Linux to lower process priority (reduce CPU overload)
        const isLinux = process.platform === 'linux';
        let finalCmd = cmd;
        let finalArgs = args;

        if (isLinux && (cmd === 'flutter' || cmd.includes('gradle'))) {
            // nice -n 10: lower CPU priority, ionice -c 2 -n 4: best-effort IO with lower priority
            finalCmd = 'nice';
            finalArgs = ['-n', '10', 'ionice', '-c', '2', '-n', '4', cmd, ...args];
        }

        const proc = spawn(finalCmd, finalArgs, {
            cwd,
            shell: true,
            // Ignore stdin to prevent "Stream closed" errors if process dies early
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                // SAFE MEMORY LIMITS: 2GB Total (heap + meta + overhead)
                GRADLE_OPTS: '-Dorg.gradle.native=false -Dfile.encoding=UTF-8 -Xmx2048m -XX:MaxMetaspaceSize=512m -XX:+UseParallelGC',
                _JAVA_OPTIONS: '-Xmx2048m -Dfile.encoding=UTF-8',
                // Ensure NDK path is set
                ANDROID_NDK_HOME: process.env.ANDROID_NDK_HOME || '/opt/android-sdk/ndk/27.0.12077973'
            }
        });

        let stdout = '';
        let stderr = '';
        let lastActivity = Date.now();

        proc.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            fs.appendFileSync(logFile, text); // Log to file
            lastActivity = Date.now();
            if (onOutput) {
                const lines = text.split('\n').filter(l => l.trim());
                if (lines.length > 0) {
                    onOutput(lines[lines.length - 1].substring(0, 150));
                }
            }
        });

        proc.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            fs.appendFileSync(logFile, '[STDERR] ' + text); // Log stderr too
            lastActivity = Date.now();
            // Also forward important stderr to progress
            if (onOutput && (text.includes('error') || text.includes('Error') || text.includes('Exception'))) {
                onOutput('[!] ' + text.substring(0, 150));
            }
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                // Extract meaningful error message from both stdout and stderr
                const allOutput = stdout + '\n' + stderr;

                // Save full output for debugging
                fs.writeFileSync(logFile + '.error', allOutput);
                console.log(`[DEBUG] Full error log saved to: ${logFile}.error`);

                // Better error extraction - look for more patterns
                const errorPatterns = [
                    /FAILURE:.*$/gm,
                    /error:.*$/gmi,
                    /Error:.*$/gm,
                    /Exception:.*$/gm,
                    /\* What went wrong:[\s\S]*?(?=\* Try:|\* Get more help|$)/gm,
                    /Could not.*$/gmi,
                    /Cannot.*$/gmi,
                    /failed.*$/gmi,
                    /not found.*$/gmi
                ];

                let errorLines = [];
                for (const pattern of errorPatterns) {
                    const matches = allOutput.match(pattern);
                    if (matches) {
                        errorLines.push(...matches);
                    }
                }

                // Remove duplicates and limit
                errorLines = [...new Set(errorLines)].slice(0, 10);

                let errorMsg;
                if (errorLines.length > 0) {
                    errorMsg = errorLines.join('\n');
                } else {
                    // Get last 20 lines as fallback
                    const lastLines = allOutput.split('\n').filter(l => l.trim()).slice(-20);
                    errorMsg = lastLines.join('\n') || `Build failed with code ${code}`;
                }

                // Include log file path in error
                errorMsg = errorMsg.substring(0, 1500) + `\n\n[Debug log: ${logFile}.error]`;
                reject(new Error(errorMsg));
            }
        });

        proc.on('error', (err) => {
            reject(err);
        });

        // Timeout after 30 minutes (increased from 10)
        const TIMEOUT_MS = 30 * 60 * 1000;
        const timeoutCheck = setInterval(() => {
            if (Date.now() - lastActivity > TIMEOUT_MS) {
                clearInterval(timeoutCheck);
                proc.kill();
                reject(new Error('Build timeout (30 minutes of inactivity)'));
            }
        }, 60000); // Check every minute

        proc.on('close', () => clearInterval(timeoutCheck));
    });
}

/**
 * Analyze project (flutter analyze or gradlew lint)
 * @param {string} projectDir - Project directory path
 * @param {string} projectType - 'flutter' or 'android'
 * @returns {Promise<{success: boolean, output?: string, error?: string}>}
 */
async function analyzeProject(projectDir, projectType) {
    try {
        let output;

        if (projectType === 'flutter') {
            output = await runCommand('flutter', ['analyze', '--no-fatal-infos'], projectDir);
        } else {
            const isWindows = process.platform === 'win32';
            const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';
            const gradlePath = path.join(projectDir, gradleCmd);

            if (!isWindows && await fs.pathExists(gradlePath)) {
                await fs.chmod(gradlePath, '755');
            }

            const cmd = await fs.pathExists(gradlePath) ? gradlePath : 'gradle';
            output = await runCommand(cmd, ['lint', '--no-daemon'], projectDir);
        }

        return { success: true, output };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Cleanup project (flutter clean or gradlew clean)
 * @param {string} projectDir - Project directory path  
 * @param {string} projectType - 'flutter' or 'android'
 * @returns {Promise<{success: boolean, output?: string, error?: string, sizeBefore?: number, sizeAfter?: number}>}
 */
async function cleanupProject(projectDir, projectType) {
    try {
        // Get size before
        const sizeBefore = await getDirectorySize(projectDir);

        let output;

        if (projectType === 'flutter') {
            output = await runCommand('flutter', ['clean'], projectDir);

            // Also remove .dart_tool and build folders
            await fs.remove(path.join(projectDir, '.dart_tool')).catch(() => { });
            await fs.remove(path.join(projectDir, 'build')).catch(() => { });
            await fs.remove(path.join(projectDir, '.flutter-plugins')).catch(() => { });
            await fs.remove(path.join(projectDir, '.flutter-plugins-dependencies')).catch(() => { });
        } else {
            const isWindows = process.platform === 'win32';
            const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';
            const gradlePath = path.join(projectDir, gradleCmd);

            if (!isWindows && await fs.pathExists(gradlePath)) {
                await fs.chmod(gradlePath, '755');
            }

            const cmd = await fs.pathExists(gradlePath) ? gradlePath : 'gradle';
            output = await runCommand(cmd, ['clean', '--no-daemon'], projectDir);

            // Also remove build folders
            await fs.remove(path.join(projectDir, 'build')).catch(() => { });
            await fs.remove(path.join(projectDir, 'app', 'build')).catch(() => { });
            await fs.remove(path.join(projectDir, '.gradle')).catch(() => { });
        }

        // Get size after
        const sizeAfter = await getDirectorySize(projectDir);

        return {
            success: true,
            output,
            sizeBefore,
            sizeAfter,
            savedBytes: sizeBefore - sizeAfter
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Get directory size in bytes
 */
async function getDirectorySize(dir) {
    let size = 0;
    try {
        const files = await fs.readdir(dir, { withFileTypes: true });
        for (const file of files) {
            const filePath = path.join(dir, file.name);
            if (file.isDirectory()) {
                size += await getDirectorySize(filePath);
            } else {
                const stat = await fs.stat(filePath);
                size += stat.size;
            }
        }
    } catch (e) { /* ignore */ }
    return size;
}

module.exports = { buildFromZip, analyzeProject, cleanupProject, safeExtractZip };
