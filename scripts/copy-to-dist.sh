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

# build/version.json 기준 현재 버전 — bundle 디렉토리에 남아있는 옛 버전 결과물은 제외
VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ROOT/build/version.json')).version)" 2>/dev/null)

copy_matching() {
  local src_dir="$1"
  local pattern="$2"
  [ -d "$src_dir" ] || return 0
  if [ -n "$VERSION" ]; then
    for f in "$src_dir"/*_${VERSION}_*${pattern} "$src_dir"/*_${VERSION}${pattern}; do
      [ -e "$f" ] && cp -R "$f" "$DIST_DIR/"
    done
  else
    cp -R "$src_dir"/*${pattern} "$DIST_DIR/" 2>/dev/null
  fi
}

# macOS 앱 번들 (.app은 버전 접미사 없음 — 그대로 복사)
if [ -d "$BUNDLE_DIR/macos" ]; then
  cp -R "$BUNDLE_DIR/macos/"*.app "$DIST_DIR/" 2>/dev/null
fi

# DMG
copy_matching "$BUNDLE_DIR/dmg" ".dmg"

# DMG 후처리 — .VolumeIcon.icns 등에 hidden flag(kIsInvisible) 부여
# Tauri의 bundle_dmg.sh가 이 플래그를 안 줘서 Finder의 "숨김 파일 보기"가 켜진
# 사용자에게는 .VolumeIcon.icns가 노출됨.
if [[ "$OSTYPE" == "darwin"* ]] && [ -d "$BUNDLE_DIR/dmg" ]; then
  for dmg in "$DIST_DIR"/*.dmg; do
    [ -e "$dmg" ] && bash "$ROOT/scripts/post-process-dmg.sh" "$dmg"
  done
fi

# Windows
copy_matching "$BUNDLE_DIR/msi" ".msi"
copy_matching "$BUNDLE_DIR/nsis" ".exe"

echo "→ dist/ 폴더에 복사 완료"
ls -la "$DIST_DIR"
