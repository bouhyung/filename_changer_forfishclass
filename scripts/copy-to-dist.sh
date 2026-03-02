#!/bin/bash
# Tauri 빌드 결과물을 dist/ 폴더로 복사

BUNDLE_DIR="src-tauri/target/release/bundle"
DIST_DIR="dist"

if [ ! -d "$BUNDLE_DIR" ]; then
  echo "오류: 빌드 결과물을 찾을 수 없습니다. ($BUNDLE_DIR)"
  exit 1
fi

mkdir -p "$DIST_DIR"
rm -rf "$DIST_DIR"/*

# macOS 앱 번들
if [ -d "$BUNDLE_DIR/macos" ]; then
  cp -R "$BUNDLE_DIR/macos/"*.app "$DIST_DIR/" 2>/dev/null
fi

# DMG
if [ -d "$BUNDLE_DIR/dmg" ]; then
  cp "$BUNDLE_DIR/dmg/"*.dmg "$DIST_DIR/" 2>/dev/null
fi

# Windows (나중에 Windows 빌드 시)
if [ -d "$BUNDLE_DIR/msi" ]; then
  cp "$BUNDLE_DIR/msi/"*.msi "$DIST_DIR/" 2>/dev/null
fi
if [ -d "$BUNDLE_DIR/nsis" ]; then
  cp "$BUNDLE_DIR/nsis/"*.exe "$DIST_DIR/" 2>/dev/null
fi

echo "→ dist/ 폴더에 복사 완료"
ls -la "$DIST_DIR"
