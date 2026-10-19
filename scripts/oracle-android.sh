#!/usr/bin/env bash
# Builds a project for Android, boots an emulator (unless one is running),
# captures the oracle scenes and runs `mimicry oracle` against them.
#   PROJECT=examples/showcase bash scripts/oracle-android.sh
set -euxo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${PROJECT:-examples/showcase}"
NAME="$(basename "$PROJECT")"
OUT="$ROOT/oracle/$NAME"
cd "$ROOT"

[ -d node_modules ] || npm ci --no-audit --no-fund

cd "$PROJECT"
npm install --no-audit --no-fund
CI=1 npx expo prebuild --platform android --clean
APP_ID="$(node -p 'require("./app.json").expo.android.package')"
(cd android && ./gradlew --no-daemon -q assembleRelease -PreactNativeArchitectures=x86_64)
APK="$(find android/app/build/outputs/apk/release -name '*.apk' | head -1)"

export PATH="${ANDROID_HOME:-}/platform-tools:$PATH"
if ! adb get-state > /dev/null 2>&1; then bash "$ROOT/scripts/android-emulator.sh"; fi
# Gesture navigation, like a Pixel out of the box
adb shell cmd overlay enable com.android.internal.systemui.navbar.gestural || true
adb install -r "$APK"

command -v maestro || { curl -Ls "https://get.maestro.mobile.dev" | bash; }
export PATH="$PATH:$HOME/.maestro/bin"
maestro --version

cd "$ROOT"
node scripts/capture-oracle.mjs --platform android --scenes "$PROJECT/scenes" --out "$OUT/android" --app-id "$APP_ID"
if [ "${MOTION:-0}" = "1" ]; then
  node scripts/capture-motion.mjs --platform android --scenes "$PROJECT/scenes" --out "$OUT/android-motion" --app-id "$APP_ID"
fi
node packages/cli/bin/mimicry.js oracle "$PROJECT" --scenes "$PROJECT/scenes" --reference "$OUT/android" --out "$OUT/android-report" | tee "$OUT/android-summary.txt"
if [ "${MOTION:-0}" = "1" ]; then
  node packages/cli/bin/mimicry.js oracle "$PROJECT" --motion --scenes "$PROJECT/scenes" --reference "$OUT/android-motion" --out "$OUT/android-motion-report" | tee "$OUT/android-motion-summary.txt"
fi
