---
name: build-release
description: Tauri 앱의 Mac/Windows 배포판을 빌드하고, 버전이 명시되면 GitHub Release까지 생성한다. "배포판 만들어줘", "v1.0.1 배포판 만들어줘", "1.0.2 릴리스해줘" 요청 시 적용.
---

# 배포판 빌드 스킬

## 트리거

다음과 같은 요청 시 이 스킬을 적용한다:
- 배포판 만들어줘 / 만들어줘
- 배포판 빌드해줘 / 빌드해줘
- 배포용 파일 만들어줘
- **v1.0.1 배포판 만들어줘** / **1.0.2 릴리스해줘** (버전 명시 시 → 빌드 + GitHub Release)
- 릴리스 빌드 / release 빌드

## 실행 방법

### 버전 없이 (빌드만)

```bash
npm run build:release
```

### 버전 명시 (빌드 + GitHub Release)

사용자가 "v1.0.1 배포판 만들어줘", "1.0.2 릴리스해줘"처럼 **버전을 함께 말하면**:

```bash
npm run release -- 1.0.1
```

또는:

```bash
bash scripts/release-to-github.sh 1.0.1
```

이 경우 다음이 **자동으로** 진행된다:
1. tauri.conf.json, Cargo.toml, package.json 버전 업데이트
2. 버전 변경사항 커밋 & 푸시
3. Mac/Windows 배포판 빌드
4. GitHub Release 생성 (DMG, exe 업로드)

> **사전 요구**: `gh auth login`으로 GitHub 로그인 필요. `brew install gh`로 설치.

## 버전 추출

사용자 요청에서 버전을 찾는다:
- "v1.0.1 배포판 만들어줘" → 1.0.1
- "1.0.2 릴리스해줘" → 1.0.2
- "배포판 v2.0.0으로 만들어줘" → 2.0.0

`v` 접두사는 제거하고 `x.y.z` 형식만 사용한다. 버전이 없으면 `build:release`만 실행.

## 동작

1. **macOS에서 실행 시**
   - Mac용 `.app`, `.dmg` 빌드 → `dist/`에 복사
   - Windows용 NSIS `.exe` 크로스 컴파일 → `dist/`에 추가
   - Windows 빌드 도구(NSIS, LLVM, cargo-xwin)가 없으면 **자동 설치** 후 빌드
   - Windows 빌드 실패 시에도 Mac 결과물은 `dist/`에 유지됨

2. **Windows에서 실행 시**
   - Windows용 `.msi`, `.exe` 빌드 → `dist/`에 복사

## 출력 위치

생성 파일은 `dist/` 폴더에 담긴다.

| 플랫폼 | 파일 |
|--------|------|
| Mac | `File Arrange for Fish Class.app`, `*.dmg` |
| Windows | `*-x64-setup.exe` (NSIS), `*.msi` (Windows에서만) |

## 배포 폴더 변경

다른 폴더에 넣고 싶으면:

```bash
DIST_DIR=./release npm run build:release
```

## 참고

- `build:release` 실행 시 CI 환경변수가 있으면 cargo 오류가 날 수 있으므로, 스크립트 내부에서 `CI` 등은 자동으로 제거한다.
