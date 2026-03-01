# 파일 이름 변경 앱

양양 물고기반 공유 폴더 업로드용 파일 이름 일괄 변경 앱입니다.

## 실행 방법

### 1. 의존성 설치

```bash
npm install
```

### 2. 앱 실행

```bash
npm start
```

또는

```bash
npx electron .
```

---

## 설치형 배포 (설치 파일 만들기)

### macOS용 빌드

```bash
npm run build:mac
```

생성 파일 위치: `dist/` 폴더
- `파일 이름 변경-1.0.0.dmg` — 설치용 디스크 이미지
- `파일 이름 변경-1.0.0-mac.zip` — 압축 앱 (설치 없이 실행 가능)

### Windows용 빌드

```bash
npm run build:win
```

생성 파일 위치: `dist/` 폴더
- `파일 이름 변경 Setup 1.0.0.exe` — NSIS 설치 프로그램
- `파일 이름 변경 1.0.0.exe` — 포터블 실행 파일 (설치 불필요)

### 현재 OS에 맞게 빌드

```bash
npm run build
```

---

## 참고

- **macOS 빌드**: macOS에서만 가능
- **Windows 빌드**: Windows에서만 가능 (또는 Wine 사용)
- 코드 서명 없이 빌드한 앱은 macOS에서 "개발자 확인 불가" 경고가 뜰 수 있음. `시스템 설정 > 개인 정보 보호 및 보안`에서 "열기"를 눌러 실행 가능
