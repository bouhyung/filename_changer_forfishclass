#!/bin/bash
# 릴리즈 파이프라인: 버전 업데이트 → 빌드 → 커밋+푸시 → GitHub Release
# 사용법:
#   ./release-to-github.sh           # build/version.json의 버전으로 릴리스
#   ./release-to-github.sh 1.0.2     # 버전 지정 시 업데이트 후 릴리스

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── 사전 점검 ────────────────────────────────────────────────

# 버전 파일 외 uncommitted 변경사항 확인
if ! git diff --quiet -- ':!build/version.json' ':!package.json' \
     ':!src-tauri/tauri.conf.json' ':!src-tauri/Cargo.toml' ':!src-tauri/Cargo.lock' || \
   ! git diff --cached --quiet -- ':!build/version.json' ':!package.json' \
     ':!src-tauri/tauri.conf.json' ':!src-tauri/Cargo.toml' ':!src-tauri/Cargo.lock'; then
  echo "오류: 커밋되지 않은 변경사항이 있습니다. 먼저 커밋 후 릴리즈하세요."
  echo ""
  git status --short
  exit 1
fi

if ! command -v gh &>/dev/null; then
  echo "오류: GitHub CLI(gh)가 설치되어 있지 않습니다. (brew install gh)"
  exit 1
fi
if ! gh auth status &>/dev/null; then
  echo "오류: gh 로그인이 필요합니다. (gh auth login)"
  exit 1
fi
if ! command -v cargo-tauri &>/dev/null; then
  echo "오류: tauri-cli가 설치되어 있지 않습니다. (cargo install tauri-cli --version '^2' --locked)"
  exit 1
fi

# ── 버전 결정 ────────────────────────────────────────────────

if [ -n "$1" ]; then
  VERSION="${1#v}"
  echo ">>> 버전 업데이트: $VERSION"
  node scripts/sync-version.js "$VERSION"
else
  VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('build/version.json')).version)")
  echo ">>> build/version.json 버전 사용: $VERSION"
  node scripts/sync-version.js
fi
TAG="v${VERSION}"

# 태그 중복 확인
if gh release view "$TAG" &>/dev/null; then
  echo "오류: $TAG 릴리즈가 이미 존재합니다. 버전을 올려주세요."
  exit 1
fi

echo ""
echo "=== 릴리즈 파이프라인: $TAG ==="

# ── 빌드 (커밋 전에 먼저 — 실패해도 원격에 영향 없음) ──────

echo ""
echo ">>> 배포판 빌드..."
unset CI CI_JOB_ID GITHUB_ACTIONS 2>/dev/null || true
DIST_DIR="${DIST_DIR:-dist}"
export DIST_DIR
bash scripts/build-release.sh

# 빌드 결과물 확인
ASSETS=()
for f in "$DIST_DIR"/*.dmg "$DIST_DIR"/*.exe; do
  [[ -e "$f" ]] && ASSETS+=("$f")
done
if [ ${#ASSETS[@]} -eq 0 ]; then
  echo "오류: 빌드 결과물이 없습니다. ($DIST_DIR/*.dmg, *.exe)"
  exit 1
fi

echo ""
echo ">>> 빌드 완료: ${#ASSETS[@]}개 파일"
for f in "${ASSETS[@]}"; do echo "  - $(basename "$f")"; done

# ── 커밋 & 푸시 ──────────────────────────────────────────────

echo ""
echo ">>> 버전 변경사항 커밋..."
git add build/version.json package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
if git diff --staged --quiet; then
  echo ">>> 버전 변경 없음 (이미 $VERSION)"
else
  git commit -m "chore: bump version to $VERSION"
fi

echo ">>> 원격 저장소에 푸시..."
git push

# ── GitHub Release ────────────────────────────────────────────

echo ""
echo ">>> GitHub Release 생성..."

RELEASE_NOTES="## 다운로드
- **Mac (Apple Silicon)**: \`*_aarch64.dmg\`
- **Windows**: \`*_x64-setup.exe\`"

gh release create "$TAG" \
  "${ASSETS[@]}" \
  --title "File Arrange for Fish Class $TAG" \
  --notes "$RELEASE_NOTES"

echo ""
echo "=== 완료 ==="
echo "→ $(gh release view "$TAG" --json url -q .url)"
