# File Arrange for Fish Class

양양 물고기반 공유 폴더 업로드용 파일 이름 일괄 변경 앱입니다.

자세한 사용 방법은 [사용설명서.md](./사용설명서.md)를 참고하세요. (배포, 설치, 사용법, 파일명 규칙 등)

## 기술 스택

- **프론트엔드**: HTML / CSS / JavaScript (vanilla)
- **백엔드**: Rust (Tauri v2)
- **패키징**: Tauri Bundler (DMG, App)

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

생성 파일 위치: `dist/` 폴더 (앱 번들, DMG 등)
- `File Arrange for Fish Class.app` — macOS 앱 번들
- `File Arrange for Fish Class_1.0.0_aarch64.dmg` — 설치용 디스크 이미지

---

## 참고

- **macOS 빌드**: macOS에서만 가능
- **Windows 빌드**: Tauri는 크로스 컴파일을 지원하지 않으므로 Windows에서 빌드 필요
- 코드 서명 없이 빌드한 앱은 macOS에서 "개발자 확인 불가" 경고가 뜰 수 있음. `시스템 설정 > 개인 정보 보호 및 보안`에서 "열기"를 눌러 실행 가능
