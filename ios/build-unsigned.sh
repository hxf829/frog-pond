#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUILD="$ROOT/build"
mkdir -p "$BUILD"

xcodebuild -quiet -project "$ROOT/FrogPond.xcodeproj" -scheme FrogPond \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath "$BUILD/DerivedData" CODE_SIGNING_ALLOWED=NO build

PACKAGE=$(mktemp -d "$BUILD/package.XXXXXX")
trap 'rm -rf "$PACKAGE"' EXIT HUP INT TERM
mkdir -p "$PACKAGE/Payload"
ditto "$BUILD/DerivedData/Build/Products/Release-iphoneos/FrogPond.app" "$PACKAGE/Payload/FrogPond.app"
rm -f "$BUILD/FrogPond-unsigned.ipa"
(cd "$PACKAGE" && zip -qry "$BUILD/FrogPond-unsigned.ipa" Payload)
printf '\n未签名安装包：%s\n此文件不能直接安装，需使用 Xcode 和 Apple 账号签名。\n' "$BUILD/FrogPond-unsigned.ipa"
