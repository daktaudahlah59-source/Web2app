#!/bin/bash
# Gradle Wrapper Script for Unix/Linux/macOS

# Determine the Java command to use
if [ -n "$JAVA_HOME" ]; then
    JAVACMD="$JAVA_HOME/bin/java"
else
    JAVACMD="java"
fi

# Check if Java is installed
if ! command -v $JAVACMD &> /dev/null; then
    echo "Error: JAVA_HOME is not set and no 'java' command found in PATH."
    exit 1
fi

# Resolve the script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_BASE_NAME=$(basename "$0")
APP_HOME=$(cd "$SCRIPT_DIR" && pwd)

# Gradle wrapper jar path
CLASSPATH="$APP_HOME/gradle/wrapper/gradle-wrapper.jar"

# Check if wrapper jar exists, if not download it
if [ ! -f "$CLASSPATH" ]; then
    echo "Downloading Gradle wrapper..."
    mkdir -p "$APP_HOME/gradle/wrapper"
    curl -L -o "$CLASSPATH" "https://github.com/AkaGiant/gradle-wrapper/raw/main/gradle-wrapper.jar" 2>/dev/null || \
    wget -O "$CLASSPATH" "https://github.com/AkaGiant/gradle-wrapper/raw/main/gradle-wrapper.jar" 2>/dev/null
fi

# Execute Gradle
exec "$JAVACMD" \
    -Dorg.gradle.appname="$APP_BASE_NAME" \
    -classpath "$CLASSPATH" \
    org.gradle.wrapper.GradleWrapperMain \
    "$@"
