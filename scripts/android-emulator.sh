#!/usr/bin/env bash
# Boots a headless Android emulator for the oracle (Linux with KVM).
#   PROFILE=pixel_9 API=36 bash scripts/android-emulator.sh
set -euxo pipefail
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
API="${API:-36}"
IMAGE="system-images;android-$API;google_apis;x86_64"
BIN="$SDK/cmdline-tools/latest/bin"
export PATH="$SDK/platform-tools:$SDK/emulator:$PATH"

yes | "$BIN/sdkmanager" --licenses > /dev/null || true
"$BIN/sdkmanager" --install "platform-tools" "emulator" "$IMAGE" > /dev/null
PROFILE="${PROFILE:-}"
if [ -z "$PROFILE" ]; then
  if "$BIN/avdmanager" list device -c | grep -qx pixel_9; then PROFILE=pixel_9; else PROFILE=pixel_8; fi
fi
echo "hardware profile: $PROFILE"
echo no | "$BIN/avdmanager" create avd -n oracle -k "$IMAGE" -d "$PROFILE" --force
LOG="${EMULATOR_LOG:-${RUNNER_TEMP:-/tmp}/emulator.log}"
nohup emulator -avd oracle -no-window -gpu swiftshader_indirect -noaudio -no-boot-anim -no-snapshot -no-metrics -camera-back none > "$LOG" 2>&1 &
adb wait-for-device
for i in $(seq 1 180); do
  if [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then break; fi
  sleep 2
done
adb shell getprop sys.boot_completed
adb shell settings put global window_animation_scale 1
adb shell settings put global transition_animation_scale 1
adb shell settings put global animator_duration_scale 1
adb shell wm size
adb shell wm density
