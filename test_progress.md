# MediaHub SPA 전환 및 모듈화 작업 진행 기록 (test_progress.md)

## 작업 상태 대시보드

| 단계 | 항목 | 상태 | 완료 시각 | 비고 |
| :--- | :--- | :---: | :---: | :--- |
| **Step 1** | Go 서버 SPA Fallback 최소 수정 | ✅ 완료 | 2026-10-09 11:32 | `server/server.go` `serveFrontend()` 약 15줄 추가, `go build` 검증 완료 |
| **Step 2** | 암호 엔진 이동 & CSS 3개 분리 | ✅ 완료 | 2026-10-09 11:34 | `js/engine/` 이동 (해시 100% 일치), `app.css`, `drive.css`, `viewer.css` 분리 구성 |
| **Step 3** | Core 인프라 모듈 구현 | ✅ 완료 | 2026-10-09 11:36 | `session.js` (RAM/Disk 경계 AES-GCM), `router.js`, `media.js`, `utils.js` 구현 |
| **Step 4** | Services 모듈 구현 | ✅ 완료 | 2026-10-09 11:38 | `drive.js` (E2EE 메타데이터 및 CRUD), `upload.js` (다중 청크 암호화 및 업로드) |
| **Step 5** | Views 모듈 & App 엔트리 구현 | ✅ 완료 | 2026-10-09 11:40 | `login.js`, `drive.js`, `viewer.js`, `app.js` (부트스트랩 및 라우트 가드) |
| **Step 6** | 단일 `index.html` 통합 & 레거시 정리 | ✅ 완료 | 2026-10-09 11:44 | 단일 SPA HTML 마운트, 11개 레거시 파일 완전 삭제 (`folder.html`, `viewer.html` 등) |
| **Step 7** | 최종 빌드 및 무결성 검증 | ✅ 완료 | 2026-10-09 11:45 | Go 1.26.3 컴파일 무결성 및 암호 해시(SHA-256) 전수 일치 확인 |

---

## 세부 작업 내역

### 1. Go 서버 경량 SPA Fallback 구현 (`server/server.go`)
- `serveFrontend()` 함수에 SPA 라우팅 지원 추가:
  - 파일 시스템 상에 요청된 정적 파일이 실존하면 해당 파일 서빙 (`/css/...`, `/js/...`, `/favicon.png` 등).
  - 존재하지 않는 SPA 가상 경로(예: `/`, `/drive`, `/viewer`) 접근 시 `index.html`을 서빙하여 브라우저 새로고침 및 직접 URL 접근 보장.
  - API 라우트 (`/api/...`) 및 미디어 스트리밍 파이프라인에는 일절 간섭하지 않음.

### 2. 암호 엔진 디렉토리 이전 및 무결성 보존 (`server/public/js/engine/`)
- 대상 파일: `Bencode.js`, `Bencrypt.js`, `Opsec.js`
- SHA-256 체크섬 검증 결과:
  - `Bencode.js`: `21E5B6E1DAA04FF8F2EEA4C42E9C5DDFF659C6366E6EB124A0336E70DF7CBA40` (일치)
  - `Bencrypt.js`: `657FF380504820B207B4CE658B8DF514087F7027F018A7A4AB49609B70829630` (일치)
  - `Opsec.js`: `B8B7562204830688141A1508C85A8E15BA614AFCDC57C264DC3D0E0F0195288D` (일치)
- `Opsec.js`의 `const BencryptURL = './Bencrypt.js';` 상대 경로가 동일 폴더 내에서 완벽하게 해석되도록 구조화.

### 3. 스타일시트 구조 간소화 (`server/public/css/`)
기존 거대 단일/중복 CSS를 3개의 역할별 파일로 깔끔하게 정리:
- `css/app.css`: Google Material 3 디자인 토큰, Light/Dark 테마, 리셋, 공통 다이얼로그(Alert/Confirm/Notice/Invite), 플로팅 업로드 위젯, 로그인 화면 스타일.
- `css/drive.css`: 상단 헤더, 사이드바, 드라이브 작업공간, 브레드크럼, 폴더 카드 그리드, 미디어 5대 뷰(그리드 3종, 리스트 2종), 키워드 필터 칩, 드래그앤드롭 오버레이.
- `css/viewer.css`: 미디어 미리보기 캔버스, 상단 툴바, 이전/다음 네비게이션 버튼, 오디오 플레이어 카드, 비디오 컨테이너, 코드/텍스트 뷰어, 미지원 파일 카드.

### 4. 핵심 인프라 계층 구현 (`server/public/js/core/`)
- `session.js` (`SafeSession`):
  - RAM vs Disk 경계 보안 아키텍처 계승.
  - `window.name`에 32바이트 랜덤 에페머럴 KEK 보관 (RAM).
  - `sessionStorage`에는 오직 AES-GCM-256 암호문(`__mh_enc_session__`)만 보관 (Disk).
  - 디스크 평문 누출 0% 보장 및 디바운스 암호화 저장.
- `router.js`:
  - Hash 기반 경량 SPA 라우터 (`#/login`, `#/drive`, `#/drive/:folderName`, `#/viewer`).
  - 네비게이션 가드(`beforeEach`)를 통해 인증되지 않은 사용자의 접근 차단 및 로그인 후 복귀 URL 저장.
- `media.js`:
  - 브라우저 인메모리 썸네일 생성 (`makeImg`, `makeVid`).
  - 파일 다운로드 및 스트리밍 데이터 소스 프로바이더 (`RangeSrc`, `NetSrc`).
  - Bencode 기반 공유 토큰 인코딩/디코딩 (`makeToken`, `loadToken`).
- `utils.js`:
  - Hex/U8 변환, 바이트 포맷팅, HTML 이스케이프, PID 추출 (`getObjPid`, `getUserPid`).
  - Google Material You 스타일 커스텀 다이얼로그 (`showAlert`, `showConfirmModal`, `showNotice`).

### 5. 서비스 및 데이터 파이프라인 (`server/public/js/services/`)
- `drive.js` (`driveService`):
  - Zero-Knowledge E2EE 메타데이터 암복호화 (AES-256-GCM + SHA3-256).
  - 폴더/파일 CRUD, 휴지통 및 트리밍 API 연동.
  - 브래킷 `[tag]` 및 구분자 기반 클라이언트 사이드 키워드 토큰 필터링 & 검색 캐시.
- `upload.js` (`uploadService`):
  - 다중 파일 청크 암호화 (0% ~ 50% 진행률 계산).
  - XHR 프로그레스 업로드 (50% ~ 95% 진행률 계산).
  - 이미지/비디오 클라이언트 사이드 썸네일 자동 추출 및 암호화 업로드.
  - 진행 중인 업로드 취소(Abort) 기능.

### 6. 화면별 뷰 컨트롤러 & 진입점 (`server/public/js/views/` & `app.js`)
- `views/login.js`: 로그인/신규가입 UI, PBKDF2/Argon 기반 인증 키 파생, 공지사항 확인.
- `views/drive.js`: 드라이브 탐색기 UI, 폴더 카드 탐색, 무한 스크롤, 5대 뷰 모드 전환, 컨텍스트 메뉴, 플로팅 업로드 위젯 연동.
- `views/viewer.js`: 미디어 미리보기 UI, Service Worker HTTP 206 스트리밍 연동, ViewerJS 이미지 확대/회전, 0ms 인메모리 이전/다음 파일 전환.
- `app.js`: 앱 초기화 부트스트랩, 다크 모드 동기화, 라우트 가드 등록, 자동완성 비활성화.

### 7. 단일 `index.html` 통합 및 레거시 파일 정리
- `folder.html`과 `viewer.html`의 모든 UI 템플릿과 모달을 `index.html` 단일 문서로 통합.
- 과거 호환용 DOM 브릿지(`<div id="hiddenControls">`)를 완전히 제거하고 모듈 직접 호출 구조로 전환.
- 불필요해진 레거시 파일 11개 완전 삭제:
  - `folder.html`, `viewer.html`
  - `folder.js`, `viewer.js`, `login.js`, `session.js`, `storage.js`, `media.js`
  - `Bencode.js`, `Bencrypt.js`, `Opsec.js` (루트 위치의 구형 사본)

### 8. 최종 빌드 및 검증
- Go 컴파일러 (`go build -ldflags="-s -w" -trimpath server.go`) 무결성 검증 완료 (Exit Code 0).
- `//go:embed all:public` 지시어를 통한 정적 에셋 임베딩 무결성 확인.
