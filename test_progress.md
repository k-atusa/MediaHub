# MediaHub SPA 프론트엔드 개편 진행 상황

## 1. 개요 및 목표
- History API 기반 라우팅 구축 (`#` 완전 제거, `/login`, `/drive`, `/viewer`)
- Wails 데스크톱 100% 무수정 재사용을 위한 UI 계층 순수화 및 통신/암호화 분리 (`adapter.js`)
- DOM XSS 취약점 및 특수문자 파일/폴더명 버그 전면 해결
- 소스 파일 개수 최소화 및 외부 라이브러리 격리 (`viewerjs` -> `engine/`)
- 하위 호환 alias 일체 제거 및 코드 컨벤션 표준화 (공개: PascalCase, 비공개: camelCase, 영문 한 줄 주석)

---

## 2. 작업 체크리스트

### [Step 1] History API 라우터 개편 및 딥링크 복원
- [x] `core/router.js`: popstate 기반 History API 라우터로 재작성 (`Navigate`, `Replace`, `ParseUrl`, `On`, `BeforeEach`, `Init`)
- [x] `core/utils.js`: `EscapeHtml`에 작은따옴표(`&#39;`) 이스케이프 추가, 모든 alias 제거
- [x] `app.js`: History API 라우트 등록 (`/login`, `/drive`, `/viewer`) 및 딥링크(`f`, `p`) 파싱/정규화 처리

### [Step 2] UI 계층 보안 및 XSS 패치
- [x] `views/drive.js`: 사이드바, 루트 그리드, 전역 검색, 파일 칩 등 `innerHTML` 동적 변수 삽입부를 `textContent` 및 `EscapeHtml`로 전면 교체
- [x] `views/drive.js`: 네비게이션 호출부를 History API (`/drive`, `/viewer`)로 교체
- [x] `views/viewer.js`: 네비게이션 및 공유 링크 규격을 History API 및 PID 딥링크(`/drive?f=<PID>&p=<PID>`)로 교체

### [Step 3] 통신 및 암호화 완전 분리 & 파일 최소화
- [x] `adapter.js` 단일화: HTTP 통신(`fetch`), `engine/`(`Bencrypt`, `Opsec`) 암복호화, 썸네일 생성, 공유 토큰 암복호화 일체를 캡슐화 (`core/media.js` 및 `adapters/` 폴더 완전 제거)
- [x] `services/drive.js` 단일화: 업로드 파이프라인(`services/upload.js`)을 흡수 통합하여 단일 서비스로 최소화 (`services/upload.js` 완전 제거)
- [x] `engine/` 격리: `viewerjs.min.js`, `viewerjs.min.css`를 `engine/` 디렉토리로 이동 및 `index.html` 경로 반영
- [x] `views/` 100% 순수 UI화: `login.js`, `drive.js`, `viewer.js`에 `fetch` 0개, `engine` import 0개 달성

### [Step 4] 코드베이스 표준화 및 alias 전면 제거
- [x] 하위 호환 alias 일체 제거 (오직 정규 PascalCase 공개 인터페이스만 유지)
- [x] 공개 인터페이스 `PascalCase`, 비공개 인터페이스 `camelCase` 네이밍 통일
- [x] 모든 함수 및 문단 상단 영문 한 줄 주석(`// Single-line English comment`) 작성

### [Step 5] 검증 및 빌드 확인
- [x] Go 컴파일 검증 (`go build -trimpath server.go`) 통과 (자산 임베딩 및 무결성 확인)
- [x] SafeSession 및 브라우저 호환성/새로고침 시뮬레이션 완료

---

## 3. 최종 정돈된 파일 구조
```
server/public/
├── css/
│   ├── app.css
│   ├── drive.css
│   └── viewer.css
├── js/
│   ├── adapter.js      # 백엔드 통신 & E2EE 암복호화 & 토큰 & 썸네일 (단일 어댑터)
│   ├── app.js          # SPA 진입점 & History API 라우터 바인딩
│   ├── core/
│   │   ├── router.js   # History API SPA 라우터
│   │   ├── session.js  # RAM/Disk AES-GCM SafeSession
│   │   └── utils.js    # 공용 유틸리티 & 모달
│   ├── services/
│   │   └── drive.js    # 도메인 상태 관리 & 업로드 파이프라인 (단일 서비스)
│   ├── views/          # 100% 순수 UI 프리젠테이션 (Wails 무수정 재사용)
│   │   ├── drive.js
│   │   ├── login.js
│   │   └── viewer.js
│   └── engine/         # 외부 및 핵심 암호 라이브러리 격리 (불변)
│       ├── Bencode.js
│       ├── Bencrypt.js
│       ├── Opsec.js
│       ├── viewerjs.min.css
│       └── viewerjs.min.js
```
