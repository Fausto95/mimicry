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
# Any Pixel profile will do: the screen is set to Pixel 9's below (older
# command-line tools on the runners don't know newer device ids).
"$BIN/avdmanager" list device -c | tee /tmp/avd-devices.txt
PROFILE="${PROFILE:-$(grep -xm1 -E 'pixel_9|pixel_8|pixel_7|pixel_6|pixel_5|pixel' /tmp/avd-devices.txt || true)}"
echo "hardware profile: ${PROFILE:-none}"
AVD_DIR="$HOME/oracle.avd"
echo no | "$BIN/avdmanager" create avd -n oracle -k "$IMAGE" ${PROFILE:+-d "$PROFILE"} -p "$AVD_DIR" --force
CONFIG="$AVD_DIR/config.ini"
# Pixel 9: 1080×2424 at 420 dpi (411×923 dp)
sed -i -e '/^hw.lcd.width/d' -e '/^hw.lcd.height/d' -e '/^hw.lcd.density/d' -e '/^skin./d' -e '/^showDeviceFrame/d' "$CONFIG"
printf 'hw.lcd.width=1080\nhw.lcd.height=2424\nhw.lcd.density=420\nskin.dynamic=yes\nshowDeviceFrame=no\nhw.keyboard=yes\n' >> "$CONFIG"
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
