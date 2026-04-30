#!/bin/bash
# Mac + Windows 배포판을 모두 빌드하여 dist/ 폴더에 담기
# macOS에서 실행: Mac 빌드 + Windows NSIS 크로스 컴파일
# Windows에서 실행: Windows MSI/NSIS 빌드만

set -e
DIST_DIR="${DIST_DIR:-dist}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Cursor CI 환경 변수 제거 (cargo tauri --ci 오류 방지)
unset CI CI_JOB_ID GITHUB_ACTIONS 2>/dev/null || true

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
export DIST_DIR

# build/version.json → package.json, tauri.conf.json, Cargo.toml 동기화
echo ">>> 버전 동기화 (build/version.json)..."
node scripts/sync-version.js

# Windows 크로스 컴파일 도구 설치 (macOS 전용)
setup_windows_cross_compile() {
  echo ">>> Windows 빌드 도구 설치 중..."
  local need_setup=false
  set +e

  if ! command -v makensis &>/dev/null; then
    echo "  - NSIS 설치..."
    brew install nsis && need_setup=true
  fi

  if ! brew list llvm &>/dev/null 2>&1; then
    echo "  - LLVM/LLD 설치..."
    brew install llvm && need_setup=true
  fi

  if ! rustup target list --installed 2>/dev/null | grep -q x86_64-pc-windows-msvc; then
    echo "  - Rust Windows 타겟 추가..."
    rustup target add x86_64-pc-windows-msvc && need_setup=true
  fi

  if ! command -v cargo-xwin &>/dev/null; then
    echo "  - cargo-xwin 설치 (수 분 소요)..."
    cargo install --locked cargo-xwin && need_setup=true
  fi

  set -e
  if [ "$need_setup" = true ]; then
    echo "  → Windows 빌드 도구 설치 완료"
  fi
}

echo "=== 배포판 빌드 시작 ==="

# 1. 현재 플랫폼용 빌드
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo ">>> Mac 빌드 (Apple Silicon)..."
  cargo tauri build --target aarch64-apple-darwin
  bash scripts/copy-to-dist.sh aarch64-apple-darwin

  # 2. Windows 크로스 컴파일 (도구 없으면 자동 설치 후 빌드)
  echo ""
  echo ">>> Windows NSIS 크로스 컴파일..."
  if ! command -v makensis &>/dev/null || ! rustup target list --installed 2>/dev/null | grep -q x86_64-pc-windows-msvc || ! command -v cargo-xwin &>/dev/null; then
    setup_windows_cross_compile
  fi
  set +e
  # macOS 호스트에서는 --config로 Windows 설정 병합 (nsis만, msi는 Windows 전용)
  cargo tauri build --config '{"bundle":{"targets":["nsis"]}}' --runner cargo-xwin --target x86_64-pc-windows-msvc
  if [ $? -eq 0 ]; then
    bash scripts/copy-to-dist.sh x86_64-pc-windows-msvc --append
  else
    echo "⚠ Windows 크로스 컴파일 실패. Mac 배포판은 dist/에 있습니다."
  fi
  set -e

elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
  echo ">>> Windows 빌드..."
  cargo tauri build
  bash scripts/copy-to-dist.sh
fi

echo ""
echo "=== 배포판 빌드 완료 ==="
echo "→ $DIST_DIR/ 폴더 확인:"
ls -la "$DIST_DIR"
