# File Arrange for Fish Class

양양 물고기반 공유 폴더 업로드용 파일 이름 일괄 변경 앱입니다.

자세한 사용 방법은 [사용설명서.md](./사용설명서.md)를 참고하세요.

---

## 빠른 시작

```bash
# 개발 모드
cargo tauri dev

# 배포판 빌드 (Mac + Windows, dist/에 생성)
npm run build:release
```

---

## npm 스크립트 요약

| 명령 | 설명 |
|------|------|
| `npm run build:release` | Mac + Windows 배포판 빌드 → `dist/` |
| `npm run build` | 현재 플랫폼만 빌드 (Mac 또는 Windows) |
| `npm run build:mac` | Mac만 빌드 |
| `npm run build:windows` | Windows NSIS만 (macOS 크로스 컴파일) |
| `npm run release` | 빌드 + GitHub Release 생성 |
| `npm run release -- 1.0.1` | 버전 지정 후 빌드 + GitHub Release |
| `npm run sync-version` | `build/version.json` → 3개 설정 파일 동기화 |

---

## 버전 관리

버전은 **`build/version.json`**에서만 관리합니다.

```json
{
  "version": "1.0.0"
}
```

`package.json`, `tauri.conf.json`, `Cargo.toml`의 version은 빌드/릴리스 시 자동 동기화됩니다. 직접 수정하지 마세요.

```bash
# 수동 동기화 (필요 시)
npm run sync-version

# 버전 업데이트 후 동기화
npm run sync-version -- 1.0.1
```

---

## 빌드 (배포용)

### Mac + Windows 한 번에 (권장)

```bash
npm run build:release
```

- **macOS에서**: Mac(.app, .dmg) + Windows(.exe) 모두 빌드
- **Windows에서**: Windows(.msi, .exe) 빌드
- 결과물: `dist/` 폴더

Windows 도구가 없으면 `build:release` 실행 시 NSIS, LLVM, cargo-xwin을 자동 설치합니다.

### 플랫폼별 빌드

```bash
npm run build:mac      # Mac만
npm run build:windows  # Windows만 (macOS에서 크로스 컴파일)
npm run build          # 현재 OS에 맞는 빌드
```

### 생성 파일

| 플랫폼 | 파일 |
|--------|------|
| Mac (Apple Silicon) | `*_aarch64.dmg`, `.app` |
| Mac (Intel) | `*_x64.dmg` (Windows 빌드 또는 GitHub Actions) |
| Windows | `*_x64-setup.exe`, `*.msi` (Windows에서만) |

---

## GitHub Releases

### 방법 1: 로컬에서 릴리스 (권장)

```bash
# gh CLI 설치 및 로그인
brew install gh
gh auth login

# build/version.json 기준으로 릴리스
npm run release

# 또는 버전 지정
npm run release -- 1.0.1
```

`build/version.json` 업데이트 → 3개 파일 동기화 → 커밋 & 푸시 → 빌드 → GitHub Release 생성

### 방법 2: GitHub Actions

태그 또는 `release` 브랜치 푸시 시 자동 빌드 및 릴리스:

```bash
git tag v1.0.0
git push origin v1.0.0
```

- [Actions](https://github.com/사용자명/저장소명/actions)에서 빌드 진행 확인
- [Releases](https://github.com/사용자명/저장소명/releases)에서 다운로드

> **권한**: `Settings > Actions > General > Workflow permissions` → **Read and write permissions** 선택

---

## Cursor 스킬 (배포판 만들어줘)

`.cursor/skills/build-release` 스킬을 사용하면:

| 말하기 | 동작 |
|--------|------|
| **배포판 만들어줘** | `build:release` → dist/에만 (GitHub 미업로드) |
| **v1.0.1 배포판 만들어줘** | `release` → 빌드 + GitHub Release |

버전을 명시하지 않으면 로컬 빌드만, 버전을 말하면 GitHub Release까지 진행됩니다.

---

## 사전 요구 사항

- [Rust](https://rustup.rs/)
- [Tauri CLI](https://tauri.app/): `cargo install tauri-cli --version "^2"`
- GitHub Release 사용 시: `brew install gh` 후 `gh auth login`

---

## 참고

- **macOS 빌드**: macOS에서만 가능
- **Windows MSI**: WiX 툴셋이 Windows 전용 → Windows에서만 빌드
- **Windows NSIS**: macOS에서 크로스 컴파일 가능
- 코드 서명 없는 앱: macOS에서 **"File Arrange for Fish Class is damaged"** 메시지가 뜨면 터미널에서 아래 명령어 실행 후 재시도

```bash
xattr -cr "/Applications/File Arrange for Fish Class.app"
```
