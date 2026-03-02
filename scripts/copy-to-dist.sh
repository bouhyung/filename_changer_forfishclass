#!/bin/bash
# Tauri 빌드 결과물을 dist/ 폴더로 복사
# 사용법: ./copy-to-dist.sh [target] [--append]
#   target: 크로스 컴파일 시 (예: x86_64-pc-windows-msvc), 생략 시 release
#   --append: 기존 dist 내용 유지하고 추가만 (Mac+Windows 동시 배포 시 사용)

APPEND=false
TARGET="release"
for arg in "$@"; do
  if [ "$arg" = "--append" ]; then
    APPEND=true
  elif [ "$arg" != "" ] && [ "$TARGET" = "release" ]; then
    TARGET="$arg"
  fi
done

# CARGO_TARGET_DIR 지원 (Cursor 등에서 사용)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_BASE="${CARGO_TARGET_DIR:-$ROOT/src-tauri/target}"
if [ "$TARGET" = "release" ]; then
  BUNDLE_DIR="$TARGET_BASE/release/bundle"
else
  BUNDLE_DIR="$TARGET_BASE/$TARGET/release/bundle"
fi
DIST_DIR="${DIST_DIR:-dist}"

if [ ! -d "$BUNDLE_DIR" ]; then
  echo "오류: 빌드 결과물을 찾을 수 없습니다. ($BUNDLE_DIR)"
  exit 1
fi

mkdir -p "$DIST_DIR"
if [ "$APPEND" = false ]; then
  rm -rf "$DIST_DIR"/*
fi

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
