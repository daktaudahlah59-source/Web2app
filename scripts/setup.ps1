# ============================================
# Web2APK Gen 3 - Complete Setup Script
# For Windows PowerShell (Run as Administrator)
# ============================================

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Web2APK Gen 3 - Complete Setup" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Continue"

# Navigate to project root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
Set-Location $projectRoot

# ============================================
# PART 1: Install Node.js Dependencies
# ============================================

Write-Host "================================================" -ForegroundColor Magenta
Write-Host "  PART 1: Installing Node.js Dependencies" -ForegroundColor Magenta
Write-Host "================================================" -ForegroundColor Magenta
Write-Host ""

# Check if Node.js is installed
Write-Host "[1/3] Checking Node.js..." -ForegroundColor Yellow
$nodeVersion = node --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] Node.js not found!" -ForegroundColor Red
    Write-Host "  Please install Node.js 18+ from: https://nodejs.org/" -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Node.js $nodeVersion" -ForegroundColor Green

# Check npm version
Write-Host "[2/3] Checking npm..." -ForegroundColor Yellow
$npmVersion = npm --version 2>$null
Write-Host "  [OK] npm v$npmVersion" -ForegroundColor Green

# Check if package.json exists
if (-not (Test-Path "package.json")) {
    Write-Host "  [ERROR] package.json not found!" -ForegroundColor Red
    exit 1
}

# Install npm dependencies
Write-Host "[3/3] Installing npm dependencies..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to install npm dependencies!" -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Dependencies installed" -ForegroundColor Green

Write-Host ""

# ============================================
# PART 2: Setup Android SDK
# ============================================

Write-Host "================================================" -ForegroundColor Magenta
Write-Host "  PART 2: Setting up Android SDK" -ForegroundColor Magenta
Write-Host "================================================" -ForegroundColor Magenta
Write-Host ""

# Define paths
$AndroidHome = "$env:LOCALAPPDATA\Android\Sdk"
$CmdlineToolsDir = "$AndroidHome\cmdline-tools"
$toolsZip = "$env:TEMP\cmdline-tools.zip"
$downloadUrl = "https://dl.google.com/android/repository/commandlinetools-win-9477386_latest.zip"

# Check for Java
Write-Host "[1/5] Checking for Java..." -ForegroundColor Yellow
try {
    $javaVersion = (java -version 2>&1) | Select-String -Pattern "version"
    if ($javaVersion) {
        Write-Host "  [OK] Java found" -ForegroundColor Green
    }
    else {
        throw "Java not found"
    }
}
catch {
    Write-Host "  [ERROR] Java not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Please install OpenJDK 17 or later from:" -ForegroundColor Yellow
    Write-Host "  https://adoptium.net/" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

# Create directories
Write-Host "[2/5] Creating directories..." -ForegroundColor Yellow
try {
    if (-not (Test-Path $CmdlineToolsDir)) {
        New-Item -ItemType Directory -Force -Path $CmdlineToolsDir | Out-Null
    }
    Write-Host "  [OK] Directories created" -ForegroundColor Green
}
catch {
    Write-Host "  [ERROR] Failed to create directories" -ForegroundColor Red
    exit 1
}

# Download command-line tools
Write-Host "[3/5] Downloading Android SDK command-line tools..." -ForegroundColor Yellow
Write-Host "  This may take a few minutes..." -ForegroundColor Gray

# Remove old zip if exists
if (Test-Path $toolsZip) {
    Remove-Item $toolsZip -Force
}

try {
    $webClient = New-Object System.Net.WebClient
    $webClient.DownloadFile($downloadUrl, $toolsZip)
    
    if (Test-Path $toolsZip) {
        $fileSize = (Get-Item $toolsZip).Length / 1MB
        Write-Host "  [OK] Downloaded ($([math]::Round($fileSize, 2)) MB)" -ForegroundColor Green
    }
    else {
        throw "Download failed"
    }
}
catch {
    Write-Host "  [ERROR] Download failed: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Please download manually from:" -ForegroundColor Yellow
    Write-Host "  $downloadUrl" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Extract to: $CmdlineToolsDir\latest" -ForegroundColor Cyan
    exit 1
}

# Extract
Write-Host "[4/5] Extracting tools..." -ForegroundColor Yellow
try {
    $latestDir = "$CmdlineToolsDir\latest"
    if (Test-Path $latestDir) {
        Remove-Item $latestDir -Recurse -Force
    }
    
    $tempExtract = "$env:TEMP\android-sdk-extract"
    if (Test-Path $tempExtract) {
        Remove-Item $tempExtract -Recurse -Force
    }
    
    Expand-Archive -Path $toolsZip -DestinationPath $tempExtract -Force
    Move-Item -Path "$tempExtract\cmdline-tools" -Destination $latestDir -Force
    
    Remove-Item $toolsZip -Force -ErrorAction SilentlyContinue
    Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
    
    Write-Host "  [OK] Extracted successfully" -ForegroundColor Green
}
catch {
    Write-Host "  [ERROR] Extraction failed: $_" -ForegroundColor Red
    exit 1
}

# Set environment variables
Write-Host "[5/5] Setting environment variables..." -ForegroundColor Yellow
try {
    [Environment]::SetEnvironmentVariable("ANDROID_HOME", $AndroidHome, "User")
    
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $sdkPaths = "$AndroidHome\cmdline-tools\latest\bin;$AndroidHome\platform-tools"
    
    if ($currentPath -notlike "*cmdline-tools*") {
        [Environment]::SetEnvironmentVariable("Path", "$currentPath;$sdkPaths", "User")
    }
    
    $env:ANDROID_HOME = $AndroidHome
    $env:Path = "$env:Path;$sdkPaths"
    
    Write-Host "  [OK] Environment variables set" -ForegroundColor Green
}
catch {
    Write-Host "  [WARNING] Could not set environment variables" -ForegroundColor Yellow
}

# ============================================
# PART 3: Setup Flutter SDK
# ============================================

Write-Host ""
Write-Host "================================================" -ForegroundColor Magenta
Write-Host "  PART 3: Setting up Flutter SDK" -ForegroundColor Magenta
Write-Host "================================================" -ForegroundColor Magenta
Write-Host ""

$FlutterHome = "$env:LOCALAPPDATA\flutter"
$FlutterZip = "$env:TEMP\flutter.zip"
$FlutterUrl = "https://storage.googleapis.com/flutter_infra_release/releases/stable/windows/flutter_windows_3.24.0-stable.zip"

Write-Host "[1/3] Checking for existing Flutter installation..." -ForegroundColor Yellow

if (Get-Command flutter -ErrorAction SilentlyContinue) {
    $flutterVersion = flutter --version 2>&1 | Select-String -Pattern "Flutter"
    Write-Host "  [OK] Flutter already installed: $flutterVersion" -ForegroundColor Green
}
else {
    Write-Host "[2/3] Downloading Flutter SDK..." -ForegroundColor Yellow
    Write-Host "  This may take several minutes..." -ForegroundColor Gray
    
    try {
        if (-not (Test-Path $FlutterHome)) {
            $webClient = New-Object System.Net.WebClient
            $webClient.DownloadFile($FlutterUrl, $FlutterZip)
            
            Write-Host "  [OK] Downloaded Flutter SDK" -ForegroundColor Green
            
            Write-Host "[3/3] Extracting Flutter SDK..." -ForegroundColor Yellow
            
            $extractPath = Split-Path $FlutterHome -Parent
            Expand-Archive -Path $FlutterZip -DestinationPath $extractPath -Force
            
            Remove-Item $FlutterZip -Force -ErrorAction SilentlyContinue
            
            Write-Host "  [OK] Flutter extracted to $FlutterHome" -ForegroundColor Green
        }
        
        # Add Flutter to PATH
        $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
        $flutterBin = "$FlutterHome\bin"
        
        if ($currentPath -notlike "*flutter*") {
            [Environment]::SetEnvironmentVariable("Path", "$currentPath;$flutterBin", "User")
            $env:Path = "$env:Path;$flutterBin"
        }
        
        Write-Host "  [OK] Flutter added to PATH" -ForegroundColor Green
        
        # Run flutter doctor
        Write-Host ""
        Write-Host "Running flutter doctor..." -ForegroundColor Yellow
        & "$flutterBin\flutter.bat" doctor 2>&1 | Out-Null
        Write-Host "  [OK] Flutter configured" -ForegroundColor Green
    }
    catch {
        Write-Host "  [WARNING] Could not install Flutter: $_" -ForegroundColor Yellow
        Write-Host "  Please install Flutter manually from: https://flutter.dev/docs/get-started/install" -ForegroundColor Cyan
    }
}

# ============================================
# COMPLETE
# ============================================

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "ANDROID_HOME = $AndroidHome" -ForegroundColor Cyan
Write-Host "FLUTTER_HOME = $FlutterHome" -ForegroundColor Cyan
Write-Host ""
Write-Host "IMPORTANT: Restart your terminal for changes to take effect." -ForegroundColor Yellow
Write-Host ""
Write-Host "Verify installations:" -ForegroundColor Cyan
Write-Host "  flutter doctor"
Write-Host "  sdkmanager --list"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Copy .env: cp .env.example .env"
Write-Host "  2. Edit .env and add BOT_TOKEN"
Write-Host "  3. Start bot: npm run dev"
Write-Host ""

