#!/bin/bash
# 버전 동기화 → 빌드 → GitHub Release 생성
# 사용법:
#   ./release-to-github.sh           # build/version.json의 버전으로 릴리스
#   ./release-to-github.sh 1.0.1     # 버전 지정 시 build/version.json 업데이트 후 릴리스

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 버전: 인자 있으면 build/version.json 업데이트, 없으면 기존 값 사용
if [ -n "$1" ]; then
  VERSION_RAW="$1"
  VERSION="${VERSION_RAW#v}"
  echo ">>> 버전 업데이트: $VERSION"
  node scripts/sync-version.js "$VERSION"
else
  VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('build/version.json')).version)")
  echo ">>> build/version.json 버전 사용: $VERSION"
  node scripts/sync-version.js
fi
TAG="v${VERSION}"

# gh CLI 확인
if ! command -v gh &>/dev/null; then
  echo "오류: GitHub CLI(gh)가 설치되어 있지 않습니다."
  echo "설치: brew install gh"
  echo "인증: gh auth login"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "오류: gh 로그인이 필요합니다. 'gh auth login' 실행"
  exit 1
fi

echo "=== GitHub 릴리스: $TAG ==="

# 1. 커밋 & 푸시 (버전 변경사항: build/version.json + 동기화된 3개 파일)
echo ">>> 버전 변경사항 커밋..."
git add build/version.json package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
if git diff --staged --quiet; then
  echo ">>> 버전 변경 없음 (이미 $VERSION)"
else
  git commit -m "chore: bump version to $VERSION"
  echo ">>> 원격 저장소에 푸시..."
  git push
fi

# 4. 빌드
echo ""
echo ">>> 배포판 빌드..."
unset CI CI_JOB_ID GITHUB_ACTIONS 2>/dev/null || true
bash scripts/build-release.sh

# 5. GitHub Release 생성
echo ""
echo ">>> GitHub Release 생성..."
DIST_DIR="${DIST_DIR:-dist}"
ASSETS=()
for f in "$DIST_DIR"/*.dmg "$DIST_DIR"/*.exe; do
  [[ -e "$f" ]] && ASSETS+=("$f")
done

if [ ${#ASSETS[@]} -eq 0 ]; then
  echo "오류: 업로드할 파일이 없습니다. ($DIST_DIR/*.dmg, *.exe)"
  exit 1
fi

gh release create "$TAG" \
  "${ASSETS[@]}" \
  --title "File Arrange for Fish Class $TAG" \
  --notes "## 다운로드
- **Mac (Apple Silicon)**: \`*_aarch64.dmg\`
- **Mac (Intel)**: \`*_x64.dmg\`
- **Windows**: \`*_x64-setup.exe\`"

echo ""
echo "=== 완료 ==="
echo "→ https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/tag/$TAG"
