# File Arrange for Fish Class

양양 물고기반 공유 폴더 업로드용 파일 이름 일괄 변경 앱입니다.

자세한 사용 방법은 [사용설명서.md](./사용설명서.md)를 참고하세요. (배포, 설치, 사용법, 파일명 규칙 등)

## 기술 스택

- **프론트엔드**: HTML / CSS / JavaScript (vanilla)
- **백엔드**: Rust (Tauri v2)
- **패키징**: Tauri Bundler (DMG, App, MSI, NSIS)

## 실행 방법

### 사전 요구 사항

- [Rust](https://rustup.rs/) 설치
- [Tauri CLI](https://tauri.app/) 설치: `cargo install tauri-cli --version "^2"`

### 개발 모드 실행

```bash
cargo tauri dev
```

### 빌드 (배포용)

```bash
npm run build
```

또는:

```bash
cargo tauri build && bash scripts/copy-to-dist.sh
```

생성 파일 위치: `dist/` 폴더

**macOS:**
- `File Arrange for Fish Class.app` — macOS 앱 번들
- `File Arrange for Fish Class_1.0.0_aarch64.dmg` — 설치용 디스크 이미지

**Windows:**
- `File Arrange for Fish Class_1.0.0_x64-setup.exe` — NSIS 설치 프로그램
- `File Arrange for Fish Class_1.0.0_x64_en-US.msi` — MSI 설치 프로그램 (Windows에서만 생성)

### Windows 배포판 빌드

#### 방법 1: Windows에서 직접 빌드 (권장)

Windows PC에서 다음을 실행하면 MSI와 NSIS 설치 파일이 모두 생성됩니다:

```bash
npm run build
```

#### 방법 2: macOS에서 크로스 컴파일 (NSIS만)

NSIS 설치 프로그램은 macOS에서 크로스 컴파일 가능합니다. 사전 준비:

1. **NSIS 설치**: `brew install nsis`
2. **LLVM/LLD 설치**: `brew install llvm` (링커용)
3. **Rust Windows 타겟**: `rustup target add x86_64-pc-windows-msvc`
4. **cargo-xwin 설치**: `cargo install --locked cargo-xwin`

빌드:

```bash
npm run build:windows
```

생성 파일: `dist/` 폴더의 `*-x64-setup.exe`

### GitHub Releases (자동 배포)

**방법 A: 한 번에 (권장)**

버전을 지정하면 빌드 → 커밋 → 푸시 → GitHub Release까지 자동 실행:

```bash
# gh CLI 설치 및 로그인: brew install gh && gh auth login
npm run release -- 1.0.1
```

**방법 B: GitHub Actions**

태그 또는 release 브랜치 푸시 시 Actions가 빌드 후 릴리스를 생성:

```bash
git tag v1.0.0
git push origin v1.0.0
```

- [Actions](https://github.com/사용자명/저장소명/actions)에서 빌드 진행 상황 확인
- [Releases](https://github.com/사용자명/저장소명/releases)에서 다운로드

> **권한 설정**: `Settings > Actions > General > Workflow permissions`에서 **Read and write permissions** 선택 필요

---

## 참고

- **macOS 빌드**: macOS에서만 가능
- **Windows MSI**: WiX 툴셋이 Windows 전용이므로 Windows에서만 빌드 가능
- **Windows NSIS**: 크로스 컴파일 지원 (macOS/Linux → Windows)
- 코드 서명 없이 빌드한 앱은 macOS에서 "개발자 확인 불가" 경고가 뜰 수 있음. `시스템 설정 > 개인 정보 보호 및 보안`에서 "열기"를 눌러 실행 가능
