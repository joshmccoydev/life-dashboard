#!/bin/bash
set -euo pipefail
umask 077
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BRIDGE_APP="$PROJECT_DIR/.lifedash/LifeDashBridge.app"
mkdir -p "$BRIDGE_APP/Contents/MacOS"
cat > "$BRIDGE_APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.lifedash.apple-bridge</string>
<key>CFBundleName</key><string>LifeDash Bridge</string>
<key>CFBundleExecutable</key><string>LifeDashBridge</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
<key>NSCalendarsFullAccessUsageDescription</key><string>LifeDash reads upcoming events for your local dashboard. It never creates, edits, or deletes events.</string>
<key>NSRemindersFullAccessUsageDescription</key><string>LifeDash reads incomplete reminders and recent habit completions for your local dashboard. It never creates, edits, or deletes reminders.</string>
</dict></plist>
PLIST
swiftc -module-cache-path "$PROJECT_DIR/.lifedash/swift-module-cache" -parse-as-library "$PROJECT_DIR/scripts/apple-bridge.swift" -o "$BRIDGE_APP/Contents/MacOS/LifeDashBridge" -framework EventKit
codesign --force --sign - "$BRIDGE_APP" >/dev/null
open "$BRIDGE_APP" --args "$PROJECT_DIR/.lifedash/apple-bridge.json" "${HABITS_LIST_NAME:-Habits}"
echo "LifeDash Bridge started. Grant Calendar and Reminders access in the macOS prompts."
