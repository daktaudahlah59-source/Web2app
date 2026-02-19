#!/bin/bash

# ============================================
# Web2APK Gen 3 - VPS Setup Script
# For Ubuntu/Debian VPS
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

# ============================================
# OS Detection Function
# ============================================
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_NAME=$ID
        OS_VERSION=$VERSION_ID
        OS_CODENAME=$VERSION_CODENAME
    else
        OS_NAME="unknown"
        OS_CODENAME="unknown"
    fi
}

detect_os

echo ""
echo -e "${CYAN}=========================================${NC}"
echo -e "${CYAN}  Web2APK Gen 3 - VPS Setup${NC}"
echo -e "${CYAN}=========================================${NC}"
echo -e "${CYAN}  Detected OS: ${GREEN}$OS_NAME $OS_VERSION ($OS_CODENAME)${NC}"
echo ""

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}Note: Some commands may require sudo password${NC}"
fi

# ============================================
# PART 1: System Update & Node.js
# ============================================

echo -e "${MAGENTA}[1/7] Updating system...${NC}"
sudo apt update && sudo apt upgrade -y

echo -e "${MAGENTA}[2/7] Installing Node.js 20...${NC}"
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 18 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi
echo -e "${GREEN}  Node.js $(node -v)${NC}"
echo -e "${GREEN}  npm v$(npm -v)${NC}"

# ============================================
# PART 2: Java & Gradle
# ============================================

echo -e "${MAGENTA}[3/7] Installing Java 17...${NC}"

# Choose JDK based on OS - Debian (especially Trixie+) needs Temurin JDK
if [ "$OS_NAME" = "debian" ]; then
    echo -e "${YELLOW}  Debian detected - Installing Eclipse Temurin JDK 17...${NC}"
    
    # Install dependencies for adding repository
    sudo apt install -y wget apt-transport-https gnupg
    
    # Add Adoptium GPG key and repository
    if [ ! -f /usr/share/keyrings/adoptium.gpg ]; then
        wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public | sudo gpg --dearmor -o /usr/share/keyrings/adoptium.gpg
    fi
    
    if [ ! -f /etc/apt/sources.list.d/adoptium.list ]; then
        echo "deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb $OS_CODENAME main" | sudo tee /etc/apt/sources.list.d/adoptium.list
    fi
    
    sudo apt update
    sudo apt install -y temurin-17-jdk
    
    # Set JAVA_HOME for Temurin
    export JAVA_HOME=/usr/lib/jvm/temurin-17-jdk-amd64
else
    echo -e "${YELLOW}  Ubuntu/Other detected - Installing OpenJDK 17...${NC}"
    sudo apt install -y openjdk-17-jdk
    
    # Set JAVA_HOME for OpenJDK
    export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
fi

# Verify Java installation
if ! java -version &>/dev/null; then
    echo -e "${RED}  ERROR: Java installation failed!${NC}"
    echo -e "${RED}  Please install Java 17 manually and re-run this script.${NC}"
    exit 1
fi
echo -e "${GREEN}  $(java -version 2>&1 | head -n1)${NC}"
echo -e "${GREEN}  JAVA_HOME=$JAVA_HOME${NC}"

echo -e "${MAGENTA}[4/7] Installing Gradle 8.7...${NC}"
# apt gradle is too old (4.x), we need 8.7+ for modern Android projects
GRADLE_VERSION="8.7"
if ! gradle -v 2>/dev/null | grep -q "$GRADLE_VERSION"; then
    cd /tmp
    wget -q "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -O gradle.zip
    sudo rm -rf /opt/gradle-${GRADLE_VERSION}
    sudo unzip -q -d /opt gradle.zip
    sudo ln -sf /opt/gradle-${GRADLE_VERSION}/bin/gradle /usr/bin/gradle
    rm gradle.zip
fi
echo -e "${GREEN}  Gradle $(gradle -v | grep Gradle | awk '{print $2}')${NC}"

# ============================================
# PART 3: Android SDK
# ============================================

echo -e "${MAGENTA}[5/7] Setting up Android SDK...${NC}"
sudo apt install -y wget unzip zip lib32z1 lib32stdc++6

ANDROID_HOME=/opt/android-sdk
sudo mkdir -p $ANDROID_HOME/cmdline-tools
cd $ANDROID_HOME/cmdline-tools

if [ ! -d "latest" ]; then
    sudo wget -q "https://dl.google.com/android/repository/commandlinetools-linux-10406996_latest.zip" -O tools.zip
    sudo unzip -q tools.zip
    
    if [ -d "cmdline-tools" ]; then
        sudo mv cmdline-tools latest
    fi
    sudo rm -f tools.zip
fi

sudo chmod -R 777 $ANDROID_HOME

# JAVA_HOME is already set during Java installation (dynamic based on OS)
export ANDROID_HOME=/opt/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

# Install SDK components including NDK
echo -e "${YELLOW}  Installing SDK components (this may take a while)...${NC}"
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses > /dev/null 2>&1 || true

# Install platforms, build-tools, and NDK (required for Flutter native plugins like video_player)
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager \
    "platforms;android-36" \
    "platforms;android-35" \
    "platforms;android-34" \
    "build-tools;36.0.0" \
    "build-tools;35.0.0" \
    "build-tools;34.0.0" \
    "build-tools;28.0.3" \
    "platform-tools" \
    "ndk;27.0.12077973" \
    "cmake;3.22.1"

# Set NDK path
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/27.0.12077973
echo -e "${GREEN}  NDK 27.0.12077973 installed${NC}"

# ============================================
# PART 4: Flutter SDK
# ============================================

echo -e "${MAGENTA}[6/7] Installing Flutter SDK...${NC}"
FLUTTER_HOME=/opt/flutter

# Install required dependencies for Flutter
sudo apt install -y curl git xz-utils libglu1-mesa clang cmake ninja-build pkg-config libgtk-3-dev

if [ ! -d "$FLUTTER_HOME" ]; then
    echo -e "${YELLOW}  Downloading Flutter SDK (this may take a while)...${NC}"
    cd /opt
    sudo git clone https://github.com/flutter/flutter.git -b stable --depth 1
    sudo chmod -R 777 $FLUTTER_HOME
fi

# Add Flutter to PATH temporarily
export PATH=$PATH:$FLUTTER_HOME/bin

# Pre-download Dart SDK and other dependencies
echo -e "${YELLOW}  Running flutter doctor...${NC}"
flutter precache --android 2>/dev/null || true
flutter doctor 2>/dev/null || true

echo -e "${GREEN}  Flutter $(flutter --version | head -n1 | awk '{print $2}')${NC}"

# ============================================
# PART 5: Environment Variables
# ============================================

echo -e "${MAGENTA}[7/7] Setting environment variables...${NC}"

# Clean old entries
sudo sed -i '/JAVA_HOME/d' /etc/environment
sudo sed -i '/ANDROID_HOME/d' /etc/environment
sudo sed -i '/FLUTTER_HOME/d' /etc/environment

# Add new entries
echo "JAVA_HOME=$JAVA_HOME" | sudo tee -a /etc/environment
echo "ANDROID_HOME=$ANDROID_HOME" | sudo tee -a /etc/environment
echo "FLUTTER_HOME=$FLUTTER_HOME" | sudo tee -a /etc/environment

# Add to bashrc if not exists
if ! grep -q "export FLUTTER_HOME" $HOME/.bashrc; then
    echo "" >> $HOME/.bashrc
    echo "# Web2APK Environment" >> $HOME/.bashrc
    echo "export JAVA_HOME=$JAVA_HOME" >> $HOME/.bashrc
    echo "export ANDROID_HOME=$ANDROID_HOME" >> $HOME/.bashrc
    echo "export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/27.0.12077973" >> $HOME/.bashrc
    echo "export FLUTTER_HOME=$FLUTTER_HOME" >> $HOME/.bashrc
    echo "export PATH=\$PATH:\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$FLUTTER_HOME/bin" >> $HOME/.bashrc
fi

# ============================================
# PART 6: Install PM2
# ============================================

echo -e "${MAGENTA}Installing PM2...${NC}"
sudo npm install -g pm2

# Source bashrc to apply changes
source $HOME/.bashrc 2>/dev/null || true

# ============================================
# COMPLETE
# ============================================

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  VPS Setup Complete!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo -e "${CYAN}Installed:${NC}"
echo "  • Node.js $(node -v)"
echo "  • npm v$(npm -v)"
if [ "$OS_NAME" = "debian" ]; then
    echo "  • Java 17 (Eclipse Temurin)"
else
    echo "  • Java 17 (OpenJDK)"
fi
echo "  • Gradle $GRADLE_VERSION"
echo "  • Android SDK 34-36 + Build Tools + NDK"
echo "  • Flutter SDK"
echo "  • PM2"
echo ""
echo -e "${YELLOW}IMPORTANT: Run this command to apply PATH changes:${NC}"
echo -e "${GREEN}  source ~/.bashrc${NC}"
echo ""
echo -e "${CYAN}Verify installations:${NC}"
echo "  flutter doctor"
echo "  gradle -v"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo "  1. Clone repo: git clone <your-repo-url>"
echo "  2. cd web2apk"
echo "  3. npm install"
echo "  4. cp .env.example .env"
echo "  5. nano .env  # Add BOT_TOKEN"
echo "  6. pm2 start src/bot.js --name web2apk"
echo ""

