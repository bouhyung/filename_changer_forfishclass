---
name: build-release
description: Tauri 앱의 Mac/Windows 배포판을 빌드한다. 버전 미명시 시 로컬(dist)만, 버전 명시 시 GitHub Release까지. "배포판 만들어줘" → 로컬만. "v1.0.1 배포판 만들어줘" → 빌드+GitHub.
---

# 배포판 빌드 스킬

## 중요: 버전에 따른 동작 구분

| 요청 | 동작 | GitHub Release |
|------|------|----------------|
| **배포판 만들어줘** (버전 없음) | `build:release` → dist/에만 생성 | ❌ **하지 않음** |
| **v1.0.1 배포판 만들어줘** (버전 있음) | `release` → 빌드 + 커밋 + 푸시 + 릴리스 | ✅ 실행 |

버전을 명시하지 않으면 **반드시** `build:release`만 실행하고, GitHub에 올리지 않는다.

## 트리거

- 배포판 만들어줘 / 배포판 빌드해줘 / 배포용 파일 만들어줘 (→ 로컬 빌드만)
- v1.0.1 배포판 만들어줘 / 1.0.2 릴리스해줘 (→ GitHub Release 포함)

## 실행 방법

### 버전 없이 (로컬만, GitHub 미사용)

```bash
npm run build:release
```

→ dist/ 폴더에만 배포 파일 생성. **GitHub Release에는 업로드하지 않는다.**

### 버전 명시 시 (빌드 + GitHub Release)

사용자가 "v1.0.1 배포판 만들어줘"처럼 **버전을 함께 말한 경우에만**:

```bash
npm run release -- 1.0.1
```

또는 사용자가 `build/version.json`을 직접 수정한 뒤:

```bash
npm run release   # 인자 없이 → build/version.json 읽어서 릴리스
```

1. build/version.json 업데이트 (인자 있으면)
2. 3개 설정 파일로 버전 동기화
3. 커밋 & 푸시
4. 빌드
5. GitHub Release 생성

> **사전 요구**: `gh auth login` 필요.

## 버전 추출

- "v1.0.1 배포판 만들어줘" → 1.0.1
- "1.0.2 릴리스해줘" → 1.0.2

버전이 **없으면** `build:release`만 실행 (로컬 dist/ 한정).

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

## 버전 관리

**단일 소스**: `build/version.json`에서만 버전을 관리한다.

```json
{"version": "1.0.0"}
```

`package.json`, `tauri.conf.json`, `Cargo.toml`의 version은 빌드/릴리스 시 자동 동기화된다. 수동 sync: `npm run sync-version`

## 참고

- `build:release` 실행 시 CI 환경변수가 있으면 cargo 오류가 날 수 있으므로, 스크립트 내부에서 `CI` 등은 자동으로 제거한다.
