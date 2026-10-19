#!/usr/bin/env bash
# Builds the showcase for the iOS Simulator, captures the oracle scenes and
# runs `mimicry oracle` against them. Used by .github/workflows/oracle.yml.
set -euxo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Newest Xcode on the runner
XCODE="$(ls -d /Applications/Xcode_*.app 2>/dev/null | sort -V | tail -1 || true)"
if [ -n "$XCODE" ]; then sudo xcode-select -s "$XCODE"; fi
xcodebuild -version
xcrun simctl list runtimes

npm ci --no-audit --no-fund

cd examples/showcase
npm install --no-audit --no-fund
CI=1 npx expo prebuild --platform ios --clean

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

curl -Ls "https://get.maestro.mobile.dev" | bash
export PATH="$PATH:$HOME/.maestro/bin"
maestro --version

cd "$ROOT"
node scripts/capture-oracle.mjs --scenes examples/showcase/scenes --out oracle/ios --bundle-id com.mimicry.showcase --simulator "$UDID"
node packages/cli/bin/mimicry.js oracle examples/showcase --scenes examples/showcase/scenes --reference oracle/ios --out oracle/report | tee oracle/summary.txt
