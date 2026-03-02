#!/bin/bash
# 버전 업데이트 → 빌드 → GitHub Release 생성
# 사용법: ./release-to-github.sh 1.0.1  또는  ./release-to-github.sh v1.0.1

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 버전 인자 확인
VERSION_RAW="${1:?Usage: $0 <version>   예: $0 1.0.1}"
VERSION="${VERSION_RAW#v}"  # v1.0.1 → 1.0.1
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

# 1. 버전 업데이트
echo ">>> 버전 업데이트 중..."
node -e "
const fs = require('fs');
const v = process.argv[1];

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = v;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));

const tauri = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
tauri.version = v;
fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(tauri, null, 2));

const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');
const updated = cargo.replace(/^version = \"[^\"]+\"/m, 'version = \"' + v + '\"');
fs.writeFileSync('src-tauri/Cargo.toml', updated);
" "$VERSION"

# 2. 커밋 & 푸시
echo ">>> 버전 변경사항 커밋..."
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
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
