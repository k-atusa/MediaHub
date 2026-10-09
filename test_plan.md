# MediaHub SPA 전환 및 프론트엔드 모듈화 리팩토링 계획서 (test_plan.md)

## 1. 개요 및 목적

본 프로젝트는 MediaHub 웹 클라이언트를 기존의 분리된 3개 HTML 페이지 구조(`index.html`, `folder.html`, `viewer.html`)에서 **단일 페이지 애플리케이션(Single Page Application, SPA)**으로 완전히 전환하고, 파일 구조를 **간결하고 직관적인 모듈형 아키텍처**로 재설계하는 것을 목적으로 합니다.

### 핵심 요구사항 반영
1. **하위 호환성 배제 & 모듈화 우선**:
   - 레거시 리다이렉트(`folder.html`, `viewer.html`) 및 과거 DOM 브릿지(`<div id="hiddenControls">`)를 완전히 제거하고, 순수하고 간결한 SPA 구조로 통일.
2. **암호 엔진 위치**:
   - `Bencode.js`, `Bencrypt.js`, `Opsec.js`는 `js/engine/`에 배치하며, 내부 암호 알고리즘 코드는 일절 수정하지 않고 원형을 보존.
3. **파일 구조 대폭 간소화**:
   - 지나친 파일 파편화를 지양하고 CSS 3개, JS 핵심 모듈군으로 통합 및 슬림화.
4. **철저한 보안성 계승**:
   - RAM vs Disk Boundary: `window.name`을 활용한 RAM 에페머럴 KEK(32B), `sessionStorage`에는 오직 AES-GCM-256 암호문만 저장.
   - Zero-Knowledge & E2EE 원칙 철저 유지.
5. **서버 코드 최소 수정**:
   - `server/server.go`의 `serveFrontend()`에 약 15줄 수준의 초경량 SPA Fallback(존재하지 않는 정적 파일 요청 시 `index.html` 응답)을 적용하여 새로고침 및 직접 URL 접근 보장.

---

## 2. 간소화된 디렉토리 및 파일 구조

```
server/public/
├── index.html                   # 단일 SPA HTML 엔트리포인트
├── favicon.png
├── icons/                       # 앱 아이콘 (icon.ico, icon.png, icon_fg.png)
├── sw.js                        # 비디오/오디오 AES-GCM HTTP 206 스트리밍 Service Worker
├── viewerjs.min.css             # 이미지 뷰어 라이브러리 리소스
├── viewerjs.min.js
│
├── css/                         # 3개로 간소화된 스타일시트
│   ├── app.css                  # 디자인 토큰(M3), 테마(Light/Dark), 기본 레이아웃, 공통 다이얼로그/위젯, 로그인
│   ├── drive.css                # 상단 헤더, 사이드바, 드라이브 탐색기(그리드/리스트 뷰), 검색, 키워드 필터
│   └── viewer.css               # 미디어 미리보기 캔버스, 툴바, 플레이어(오디오/비디오/코드/PDF)
│
└── js/                          # 간결하고 명확한 ES 모듈
    ├── engine/                  # [핵심 암호 엔진] 로직 불변
    │   ├── Bencode.js
    │   ├── Bencrypt.js
    │   └── Opsec.js
    │
    ├── core/                    # 공통 인프라 계층
    │   ├── session.js           # SafeSession (RAM vs Encrypted Disk AES-GCM 보안 세션)
    │   ├── router.js            # 경량 SPA 라우터 (Hash & Path 기반, 라우트 가드)
    │   ├── media.js             # 썸네일 생성(makeImg/makeVid) + 공유 토큰(makeToken/loadToken)
    │   └── utils.js             # 공통 유틸리티 (Hex/U8, 포맷팅, 다이얼로그/토스트 통합 헬퍼)
    │
    ├── services/                # 비즈니스 & E2EE 데이터 파이프라인
    │   ├── drive.js             # 메타데이터 E2EE 암복호화, 폴더/파일 CRUD, 검색, 키워드 필터 엔진
    │   └── upload.js            # 청크 암호화 및 XHR 프로그레스 업로드 관리자
    │
    ├── views/                   # 화면별 뷰 컨트롤러
    │   ├── login.js             # 로그인 및 신규 회원가입 뷰
    │   ├── drive.js             # 드라이브 탐색기 뷰 (폴더 카드, 파일 그리드/리스트, 무한스크롤, 메뉴)
    │   └── viewer.js            # 파일 미리보기 뷰 (ViewerJS, 스트리밍, 인메모리 이전/다음 전환)
    │
    └── app.js                   # SPA 애플리케이션 엔트리포인트 (부트스트랩, 테마, 라우팅 마운트)
```

---

## 3. 세부 설계 및 리팩토링 전략

### 3.1. Go 서버 경량 SPA Fallback 핸들링 (`server/server.go`)
- 현재의 `serveFrontend()`를 다음과 같이 최소한으로 보완:
  - 요청된 정적 파일이 `./public` (또는 임베디드 `publicFS`)에 존재하면 해당 파일 서빙
  - 파일이 존재하지 않는 SPA 경로(예: `/`, `/drive`, `/viewer` 등)인 경우 `index.html`을 서빙
  - API 라우트 (`/api/...`) 및 미디어 스트리밍에는 전혀 영향을 주지 않음

### 3.2. 단일 SPA HTML (`server/public/index.html`)
- 레거시 `folder.html`과 `viewer.html`에 중복 분산되어 있던 HTML 템플릿을 `index.html` 하나로 통합:
  - `#view-login`: 로그인 & 회원가입 컨테이너
  - `#view-drive`: 드라이브 탐색기 (헤더, 사이드바, 워크스페이스) 컨테이너
  - `#view-viewer`: 파일 미리보기 캔버스 컨테이너
  - 공통 모달 및 위젯: M3 다이얼로그들, 플로팅 업로드 프로그레스 위젯, 컨텍스트 메뉴, 드래그&드롭 오버레이
- 기존의 불필요한 `<div id="hiddenControls">` 제거. 뷰 컨트롤러가 서비스를 직접 호출하도록 직관적 연동.

### 3.3. 라우팅 설계 (`js/core/router.js`)
- **라우트 정의**:
  - `#/login`: 인증 화면 (로그인/회원가입)
  - `#/drive`: 루트 My Drive (폴더 카드 그리드)
  - `#/drive/:folderName`: 특정 폴더 내부 파일 목록
  - `#/viewer`: 파일 미리보기 화면
- **상태 보존 & 0ms 전환**:
  - 뷰어에서 드라이브로 돌아올 때 DOM과 인메모리 캐시를 재사용하므로 로딩 및 깜빡임 0ms.
  - 뷰어에서 이전/다음 파일 이동 시 전체 페이지 리로드 없이 즉시 다음 미디어 복호화/재생.
- **인증 가드**:
  - `SafeSession`에 `userHash`, `userKey`가 없으면 자동으로 `#/login` 이동 및 원래 가려던 경로 저장.
  - 로그인 성공 시 저장된 경로 또는 `#/drive`로 자동 전환.

### 3.4. 보안성 보존 (`js/core/session.js`)
- RAM 경계: `window.name`에 32바이트 랜덤 에페머럴 KEK 유지.
- Disk 경계: `sessionStorage`에는 반드시 AES-GCM-256 암호문(`__mh_enc_session__`)만 보관.
- 메모리 제로화(Zeroize): 민감한 키 데이터 사용 후 즉시 `fill(0)`으로 메모리 소거.

---

## 4. 단계별 실행 계획

- **Step 1: Go 서버 SPA Fallback 핸들러 최소 수정**
  - `server/server.go`의 `serveFrontend()` 수정 및 `go build` 검증
- **Step 2: 암호 엔진 이동 및 CSS 3개 파일 통합 작성**
  - `js/engine/` 디렉토리로 `Bencode.js`, `Bencrypt.js`, `Opsec.js` 이동
  - `css/app.css`, `css/drive.css`, `css/viewer.css` 분리 구성
- **Step 3: Core 인프라 모듈 구현**
  - `js/core/session.js`, `js/core/router.js`, `js/core/media.js`, `js/core/utils.js`
- **Step 4: Services 모듈 구현**
  - `js/services/drive.js` (E2EE 메타데이터 암복호화, CRUD, 키워드 필터)
  - `js/services/upload.js` (다중 청크 암호화 및 XHR 프로그레스)
- **Step 5: Views 및 UI 컨트롤러 모듈 구현**
  - `js/views/login.js`
  - `js/views/drive.js`
  - `js/views/viewer.js`
  - `js/app.js` (메인 애플리케이션 엔트리)
- **Step 6: 단일 `index.html` 작성 및 레거시 파일 정리**
  - 단일 SPA 마운트 컨테이너로 `index.html` 갱신
  - 레거시 중복 파일(`folder.html`, `viewer.html`, `folder.js`, `viewer.js`, `login.js`, `storage.js` 등) 정리
- **Step 7: 빌드 검증 및 작업 기록 업데이트**
  - `go build` 컴파일 무결성 검증
  - `test_progress.md`에 최종 결과 및 검증 내역 기록
