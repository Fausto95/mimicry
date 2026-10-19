#!/usr/bin/env bash
# Builds a project for the iOS Simulator, captures its oracle scenes and runs
# `mimicry oracle` against them. Used by .github/workflows/oracle.yml.
#   PROJECT=examples/showcase bash scripts/oracle-ios.sh
set -euxo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${PROJECT:-examples/showcase}"
NAME="$(basename "$PROJECT")"
OUT="$ROOT/oracle/$NAME"
cd "$ROOT"

# Newest Xcode on the runner
XCODE="$(ls -d /Applications/Xcode_*.app 2>/dev/null | sort -V | tail -1 || true)"
if [ -n "$XCODE" ]; then sudo xcode-select -s "$XCODE"; fi
xcodebuild -version
xcrun simctl list runtimes

[ -d node_modules ] || npm ci --no-audit --no-fund

cd "$PROJECT"
npm install --no-audit --no-fund
CI=1 npx expo prebuild --platform ios --clean
APP_ID="$(node -p 'require("./app.json").expo.ios.bundleIdentifier')"

# iPhone 17 Pro if the runtime has it, else iPhone 16 Pro (same 402×874 @3x geometry)
UDID="$(xcrun simctl list devices available -j | node -e '
  const d = JSON.parse(require("fs").readFileSync(0, "utf8")).devices;
  const all = Object.values(d).flat();
  const pick = (n) => all.filter((x) => x.name === n).pop();
  const dev = pick("iPhone 17 Pro") || pick("iPhone 16 Pro");
  if (!dev) { console.error("no suitable simulator"); process.exit(1); }
  console.error("simulator:", dev.name);
  console.log(dev.udid);
')"
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b

WORKSPACE="$(ls -d ios/*.xcworkspace | head -1)"
SCHEME="$(basename "$WORKSPACE" .xcworkspace)"
xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release -sdk iphonesimulator \
  -destination "id=$UDID" -derivedDataPath build CODE_SIGNING_ALLOWED=NO -quiet build
APP="$(find build/Build/Products -maxdepth 2 -name '*.app' | head -1)"
xcrun simctl install "$UDID" "$APP"

command -v maestro || { curl -Ls "https://get.maestro.mobile.dev" | bash; }
export PATH="$PATH:$HOME/.maestro/bin"
maestro --version

cd "$ROOT"
node scripts/capture-oracle.mjs --platform ios --scenes "$PROJECT/scenes" --out "$OUT/ios" --app-id "$APP_ID" --device "$UDID"
if [ "${MOTION:-0}" = "1" ]; then
  command -v ffmpeg || brew install ffmpeg
  node scripts/capture-motion.mjs --platform ios --scenes "$PROJECT/scenes" --out "$OUT/ios-motion" --app-id "$APP_ID" --device "$UDID"
fi
node packages/cli/bin/mimicry.js oracle "$PROJECT" --scenes "$PROJECT/scenes" --reference "$OUT/ios" --out "$OUT/ios-report" | tee "$OUT/ios-summary.txt"
if [ "${MOTION:-0}" = "1" ]; then
  node packages/cli/bin/mimicry.js oracle "$PROJECT" --motion --scenes "$PROJECT/scenes/motion" --reference "$OUT/ios-motion" --out "$OUT/ios-motion-report" | tee "$OUT/ios-motion-summary.txt"
fi
