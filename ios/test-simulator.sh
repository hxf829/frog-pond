#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEVICE=${1:?请提供 iPad 模拟器的 UDID}
BUILD="$ROOT/build/DerivedData"

xcodebuild -quiet -project "$ROOT/FrogPond.xcodeproj" -scheme FrogPond \
  -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$BUILD" CODE_SIGNING_ALLOWED=NO build
xcrun simctl boot "$DEVICE" 2>/dev/null || true
xcrun simctl bootstatus "$DEVICE" -b
xcrun simctl install "$DEVICE" "$BUILD/Build/Products/Debug-iphonesimulator/FrogPond.app"
CONTAINER=$(xcrun simctl get_app_container "$DEVICE" com.frogpond.game data)
RESULT="$CONTAINER/Documents/FrogPondSmokeTest.json"
rm -f "$RESULT"
xcrun simctl launch --terminate-running-process "$DEVICE" com.frogpond.game --frog-smoke-test
for attempt in $(seq 1 30); do
  if [ -f "$RESULT" ]; then break; fi
  sleep 1
done
python3 - "$RESULT" <<'PY'
import json
import sys

with open(sys.argv[1], encoding='utf-8') as result_file:
    result = json.load(result_file)
assert result.get('protocol') == 'file:', result
assert result.get('frogs') == 1 and result.get('cells', 0) > 0, result
assert result.get('blocks') == 1 and result.get('pc') == 1, result
assert result.get('localAudio') and .3 < result.get('audioDuration', 0) < 2, result
assert result.get('canvasWidth', 0) > 0 and result.get('canvasHeight', 0) > 0, result
print('PASS: iPad 模拟器中的离线页面、积木执行和蛙鸣加载正常')
PY
