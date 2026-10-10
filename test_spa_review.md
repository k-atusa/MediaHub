# MediaHub SPA 아키텍처 리뷰 및 개선 계획서

## 1. 현재 상태 진단

### 1.1. 특수 문자 이름 처리 (Issue #1)

#### 진단 결과: ❌ **심각한 결함 다수 존재**

**문제가 되는 문자들**: `/`, `<`, `>`, `?`, `#`, `&`, `"`, `'`, `\`, `%`, 공백, 유니코드 등

| 위치 | 파일 | 문제점 | 심각도 |
|------|------|--------|--------|
| **라우터 URL 패턴** | `router.js:20-21` | `/drive/:folderName`에서 `([^/?]+)` 패턴 사용 → 폴더명에 `/`가 있으면 라우팅 자체가 깨짐 | 🔴 Critical |
| **라우터 hash 파싱** | `router.js:35` | `hash.split('?')` 사용 → 폴더명에 `?`가 있으면 쿼리로 잘못 파싱 | 🔴 Critical |
| **사이드바 렌더링** | `drive.js:1513` | `title="${name}"` — 이름에 `"` 있으면 HTML attribute injection | 🟡 High |
| **사이드바 렌더링** | `drive.js:1513` | `>${name}</span>` — 이름에 `<`/`>` 있으면 XSS, DOM 깨짐 | 🔴 Critical |
| **루트 폴더 카드** | `drive.js:1562-1563` | `>${name}</span>` — 동일한 escapeHtml 미적용 | 🔴 Critical |
| **전역 검색 결과** | `drive.js:1622-1623, 1666` | 동일 문제 | 🔴 Critical |
| **업로드 위젯** | `drive.js:1330-1331` | `title="${f.name}"`, `>${f.name}<` — 이스케이프 없음 | 🟡 High |
| **viewer 공유 URL** | `viewer.js:555` | `encodeURIComponent(oldFold)` → 올바르게 인코딩하지만 `#drive/...` 구조에서 `#` 자체가 hash이므로 중첩 문제 | 🟡 High |
| **drive 공유 URL** | `drive.js:2007` | 동일 문제 | 🟡 High |
| **viewer 네비게이션** | `app.js:52` | `window.location.hash.split('?')` — 내부 `?` 파싱 깨짐 | 🟡 High |
| **컨텍스트 메뉴** | `drive.js:633, 686` | `dataset.targetFolder = folderName` — dataset은 안전하지만, 이후 사용처에서 escapeHtml 없이 innerHTML에 삽입 | 🟡 Medium |

#### 구체적인 시나리오:
```
폴더명: "test/folder"
→ URL: #/drive/test%2Ffolder  
→ router regex: ([^/?]+) 매칭 실패 → 404

폴더명: '<script>alert(1)</script>'
→ 사이드바: <span class="folder-name-label">[실행됨]</span>
→ XSS 취약점

폴더명: 'folder?name=value'
→ router.parseHash(): path="folder", query={name: "value"}
→ 완전히 잘못된 파싱

파일명: 'file"name.txt'
→ title="file"name.txt" → HTML attribute 깨짐
```

### 1.2. URL에서 # 사용과 민감 정보 (Issue #1-1)

#### 현재 URL 구조 분석:

| 라우트 | 현재 URL 예시 | 민감 정보 포함? |
|--------|-------------|----------------|
| 로그인 | `#/login` | ❌ 없음 |
| 드라이브 루트 | `#/drive` | ❌ 없음 |
| 폴더 내부 | `#/drive/내사진` | ⚠️ **폴더 이름 노출** |
| 뷰어 | `#/viewer?folder=abc123&file=사진.jpg` | ⚠️ **folderId + 파일 이름 노출** |

#### 결론:
- **`/login`, `/drive`**: 민감 정보 없음 → `#` 해제 가능
- **`/drive/:folderName`**: **폴더 이름은 민감 정보** → `#` 유지 또는 이름 대신 PID 사용
- **`/viewer?...`**: `folder` 파라미터에 folderId(hex PID)가 들어감 → 이것은 서버에서도 이미 사용하는 공개 식별자이므로 비민감. 단 `file` 파라미터에 **실제 파일 이름**이 들어가므로 민감.
- 추가. file 이름에 <>? 등이 들어갈 수도 있는데 이를 고려하고 있는지?
- 아예 #을 다 해제하고 /folder /viewer 만 사용하고 내부 변수로만 현재 폴더와 파일을 구분하는 방안?

### 1.3. Wails 데스크톱 재사용성 (Issue #2)

#### 현재 레이어 분석:

```
┌─────────────────────────────────┐
│  views/  (UI 렌더링 + DOM 조작) │ ← 재사용 가능 (HTML/CSS/JS UI)
├─────────────────────────────────┤
│  services/  (비즈니스 로직)      │ ← 🔴 문제: fetch() 직접 호출, 암호화 로직 내장
├─────────────────────────────────┤
│  engine/   (암호 라이브러리)     │ ← Web 전용 (Wails에서는 Go가 대체)
├─────────────────────────────────┤
│  core/     (라우터/세션/유틸)    │ ← 부분 재사용 가능
└─────────────────────────────────┘
```

#### 문제점:
1. **`services/drive.js`**: 674줄 — `fetch()` API 호출과 E2EE 암복호화가 한 클래스에 혼재
   - Web: `fetch()` → Go 서버로 HTTP 요청
   - Wails Desktop: `window.go.app.Method()` → Go 함수 직접 호출 (암호화도 Go에서 처리)
   - 현재 구조로는 두 환경을 동시에 지원할 수 없음

2. **`services/upload.js`**: XHR 기반 업로드 + 클라이언트측 암호화
   - Desktop에서는 Go가 파일을 직접 읽고 암호화 → 완전히 다른 파이프라인

3. **`core/session.js`**: `window.name` + `sessionStorage` 기반
   - Desktop에서는 Go 메모리에 세션 저장 → 완전히 다른 메커니즘

4. **`core/media.js`**: `makeImg`/`makeVid` → 브라우저 Canvas API 의존
   - Desktop에서는 Go의 이미지 라이브러리 사용 가능

---

## 2. 개선 계획

### Phase 1: 특수 문자 안전성 수정 (라우팅 + 렌더링)

#### 1-A: 라우터 URL 구조 재설계

**핵심 결정: 라우트 경로에서 이름 제거, 쿼리 파라미터 사용**

```
변경 전:  #/drive/폴더이름        (이름이 path segment → 특수문자 파싱 불가)
변경 후:  #/drive?f=<folderPID>   (PID는 hex → 항상 안전)
```

| 라우트 | 변경 전 | 변경 후 | 설명 |
|--------|---------|---------|------|
| 로그인 | `#/login` | `#/login` | 변경 없음 |
| 드라이브 루트 | `#/drive` | `#/drive` | 변경 없음 |
| 폴더 내부 | `#/drive/폴더이름` | `#/drive?f=<hex PID>` | 이름→PID로 교체 |
| 뷰어 | `#/viewer?folder=abc&file=이름` | `#/viewer?f=<folderPID>&p=<filePID>` | 이름→PID로 교체 |

**장점**:
- PID는 항상 hex 문자열 → `/`, `?`, `#`, `<`, `>` 등 **절대 포함 안 됨**
- URL에 민감한 사용자 이름 정보가 노출되지 않음 → **Issue 1-1 자동 해결**
- 라우터 파싱이 극도로 단순해짐 (path만 매칭, 쿼리는 표준 URLSearchParams)
- 서버에 어떤 이름 정보도 전송되지 않음 (PID는 서버가 이미 아는 공개값)

**고려사항**:
- PID 없이 접근 시 (직접 URL 입력) → 드라이브 루트로 리다이렉트
- 공유 링크에도 PID 사용 → 수신자의 fldMap에 해당 PID가 있어야 접근 가능 (E2EE 유지)

#### 1-B: 라우터 parseHash 안전성 강화

```javascript
// 변경 전: hash.split('?') → 이름에 ? 있으면 깨짐
// 변경 후: path는 첫 번째 ? 이전만, query는 이후 전체
parseHash() {
    let hash = window.location.hash.slice(1) || '/drive';
    if (!hash.startsWith('/')) hash = '/' + hash;
    const qIdx = hash.indexOf('?');
    const path = qIdx >= 0 ? hash.slice(0, qIdx) : hash;
    const query = {};
    if (qIdx >= 0) {
        new URLSearchParams(hash.slice(qIdx + 1)).forEach((v, k) => { query[k] = v; });
    }
    return { path, query };
}
```

#### 1-C: 렌더링 XSS/DOM 안전성 수정

모든 사용자 입력 문자열이 DOM에 들어가는 곳에 `escapeHtml()` 적용 또는 `textContent` 사용:

```javascript
// 변경 전 (drive.js 사이드바):
item.innerHTML = `
    <span class="folder-name-label" title="${name}">${name}</span>
`;

// 변경 후:
const label = document.createElement('span');
label.className = 'folder-name-label';
label.textContent = name;
label.title = name;
```

**수정 대상 전체 목록**:
1. `drive.js` renderSidebarFolderList() — L1511-1517
2. `drive.js` renderRootFolderGrid() — L1559-1566, L1618-1627
3. `drive.js` renderRootFolderGrid() global search results — L1648-1666
4. `drive.js` showUploadProgressWidget() — L1329-1335
5. `drive.js` renderKeywordDropdownItems() — L1928-1934
6. `drive.js` updateKeywordFilterUI() — L1968
7. `drive.js` openShareFolderModal() — L957 (이미 `replace` 사용, escapeHtml로 교체)
8. `drive.js` openUnlinkFolderModal() — L1078
9. `drive.js` openDeleteFolderModal() — L1100

### Phase 2: 서비스 레이어 모듈화 (Wails 재사용 대비)

#### 2-A: Backend Adapter 패턴 도입

```
┌────────────────────────────────────────────┐
│          views/ (UI 컨트롤러)              │  ← 공통 재사용
│   login.js, drive.js, viewer.js            │
├────────────────────────────────────────────┤
│        services/ (비즈니스 오케스트레이터)   │  ← 공통 재사용
│   drive.js, upload.js                      │
│   Backend Adapter 인터페이스만 호출          │
├────────────────────────────────────────────┤
│      adapters/ (백엔드 통신 추상화)         │  ← 환경별 교체
│   ├── web-adapter.js   (fetch + JS 암호화)  │
│   └── wails-adapter.js (Go binding 호출)    │
├────────────────────────────────────────────┤
│      engine/ (암호 라이브러리)              │  ← Web 전용
│   Bencode.js, Bencrypt.js, Opsec.js        │
└────────────────────────────────────────────┘
```

#### 2-B: Adapter 인터페이스 설계

```javascript
// adapters/adapter-interface.js (규약 문서)
/**
 * Backend Adapter Interface
 * Web에서는 fetch+JS crypto, Wails에서는 Go binding으로 구현
 */
export const IBackendAdapter = {
    // === Auth ===
    checkUserExists(userHash) → Promise<boolean>,
    createUser(userHash, encryptedData, inviteCode) → Promise<void>,
    deleteUser(userHash) → Promise<void>,

    // === User Data (E2EE folder map) ===
    loadUserData(userHash) → Promise<Uint8Array|null>,
    saveUserData(userHash, encryptedData, oldHash?) → Promise<void>,

    // === Folder Metadata (E2EE file map) ===
    loadFolderMeta(folderId) → Promise<Uint8Array|null>,
    saveFolderMeta(folderId, encryptedData, userHash) → Promise<void>,
    deleteFolderMeta(folderId, userHash) → Promise<void>,

    // === Media Binary ===
    loadMediaBinary(folderId, filePid, type) → Promise<Uint8Array|null>,
    saveMediaBinary(folderId, filePid, type, data, userHash) → Promise<void>,
    deleteMediaBinary(folderId, filePid, type) → Promise<void>,
    getMediaSize(folderId, filePid) → Promise<number>,

    // === Crypto (암호화/복호화 위임) ===
    deriveKeys(username, password) → Promise<{userHash, userKey}>,
    encryptUserData(rawMap, userKey) → Promise<Uint8Array>,
    decryptUserData(encData, userKey) → Promise<Object>,
    encryptFolderMeta(rawMap, folderKey) → Promise<Uint8Array>,
    decryptFolderMeta(encData, folderKey) → Promise<Object>,
    encryptFile(fileData, fileKey) → Promise<Uint8Array>,
    decryptFile(encData, fileKey, origSize) → Promise<Uint8Array>,
    encryptThumbnail(thumbData, fileKey) → Promise<Uint8Array>,
    decryptThumbnail(encData, fileKey) → Promise<Uint8Array>,

    // === Misc ===
    fetchNotice() → Promise<string>,
    trimFolder(folderId, pids, userHash) → Promise<string>,
};
```

#### 2-C: services/drive.js 분리

현재 `DriveService` 클래스의 메서드를 3개 카테고리로 분류:

| 카테고리 | 메서드들 | 처리 |
|---------|---------|------|
| **순수 상태 관리** (Keep) | `selectFolder`, `buildKeywords`, `extractTokens`, `isValidKeyword`, `invalidateCache`, `getEntrySize` | 그대로 유지 — 어댑터 불필요 |
| **서버 통신 + 암호화** (Extract) | `loadUser`, `saveUser`, `loadFolderFiles`, `createFolder`, `renameFile`, `deleteFile`, `loadThumbnail`, `changePassword` | adapter 호출로 교체 |
| **복합 로직** (Refactor) | `fetchAllFoldersAndFiles`, `fetchFolderFileSizes`, `trimFolder` | 서버 통신 부분만 adapter로 위임 |

---

## 3. 수행 순서 및 체크리스트

### Step 1: 라우터 URL 구조 변경 ✅→☐
- [ ] `router.js` — `/drive/:folderName` 라우트 제거, `/drive` 하나로 통합
- [ ] `router.js` — `parseHash()` 안전 파싱으로 교체
- [ ] `app.js` — 라우트 핸들러 수정: `query.f` (folderPID)로 폴더 식별
- [ ] `drive.js` — `renderSidebarFolderList()` 네비게이션: `router.navigate('/drive?f=<PID>')`)
- [ ] `drive.js` — `renderRootFolderGrid()` 네비게이션 동일 수정
- [ ] `drive.js` — `openFileInViewer()`: `/viewer?f=<folderId>&p=<filePID>` 형태로 변경
- [ ] `viewer.js` — `mount()`: query에서 folderId, filePID로 파일 식별
- [ ] `viewer.js` — `shareCurrentFile()`: 공유 URL PID 기반으로 변경
- [ ] `viewer.js` — `btnViewerBack`: 뒤로가기 URL PID 기반으로 변경

### Step 2: DOM XSS/특수문자 안전성 ✅→☐
- [ ] `drive.js` — 모든 `innerHTML` 내 사용자 이름에 `escapeHtml()` 적용 또는 `textContent` 사용
- [ ] `drive.js` — `title="${name}"` 패턴 전부 DOM API로 교체
- [ ] `drive.js` — 업로드 위젯 파일 이름 이스케이프
- [ ] `drive.js` — 키워드 필터 칩 이스케이프
- [ ] `viewer.js` — 파일 이름 표시 부분 이스케이프 (이미 `escapeHtml` 일부 사용 중)

### Step 3: Backend Adapter 추상화 ✅→☐
- [ ] `js/adapters/web-adapter.js` 생성 — 현재 fetch+crypto 로직 추출
- [ ] `js/services/drive.js` — adapter 호출로 리팩토링
- [ ] `js/services/upload.js` — adapter 호출로 리팩토링
- [ ] `js/views/login.js` — adapter 호출로 리팩토링 (makeKeys, checkUserExists)
- [ ] `js/app.js` — 부트스트랩 시 adapter 주입

### Step 4: 검증 ✅→☐
- [ ] 폴더명 `test/folder`, `<script>`, `a?b=c`, `a#b`, `a&b` 등으로 라우팅 테스트
- [ ] 기존 모든 기능 정상 동작 확인 (폴더 CRUD, 파일 업로드/다운로드/삭제, 뷰어 등)
- [ ] Go 서버 SPA fallback 동작 확인

---

## 4. Phase 2 상세: Wails 데스크톱 대응 구조

### 4-1. 파일 구조 (향후)

```
server/public/
├── js/
│   ├── adapters/
│   │   ├── types.js              # Adapter 인터페이스 JSDoc 타입 정의
│   │   └── web-adapter.js        # Web 환경용 (fetch + JS crypto)
│   ├── core/       (공통)
│   ├── services/   (공통 — adapter 인터페이스만 호출)
│   ├── views/      (공통)
│   ├── engine/     (Web 전용)
│   └── app.js      (공통 — adapter 주입점)

wails-frontend/  (Wails 프로젝트)
├── js/
│   ├── adapters/
│   │   └── wails-adapter.js      # Wails 환경용 (Go binding 호출)
│   ├── core/       → symlink 또는 복사 (router는 Wails 전용 교체)
│   ├── services/   → 재사용
│   ├── views/      → 재사용
│   └── app.js      → wails-adapter 주입
```

### 4-2. 교체 포인트 정리

| 모듈 | Web | Wails Desktop | 비고 |
|------|-----|---------------|------|
| `adapters/*` | `web-adapter.js` | `wails-adapter.js` | **유일한 교체 대상** |
| `core/router.js` | Hash router | Wails router (Go측 or 자체) | 교체 필요 |
| `core/session.js` | window.name + sessionStorage | Go 메모리 | 교체 필요 |
| `core/media.js` | Canvas API 썸네일 | Go 이미지 라이브러리 | 교체 가능 |
| `core/utils.js` | 공용 | 공용 | ✅ 재사용 |
| `services/*` | 공용 | 공용 | ✅ 재사용 |
| `views/*` | 공용 | 공용 | ✅ 재사용 |
| `engine/*` | JS 암호화 | 미사용 (Go 대체) | Web 전용 |

---

## 5. 위험 요소 및 주의사항

1. **기존 공유 링크 호환성**: URL 구조가 `#/drive/이름` → `#/drive?f=PID`로 변경되면 기존에 공유된 링크가 깨짐. 마이그레이션 핸들러로 구 URL을 감지하여 리다이렉트하는 것을 고려. 하위 호환성은 전혀 고려하지 않아도 됨
2. **암호 엔진 불변**: `Bencrypt.js`, `Bencode.js`, `Opsec.js` 내부 로직 절대 수정 금지.
3. **서버 코드 수정 최소화**: `server.go`는 이미 SPA fallback이 구현되어 있으므로 추가 수정 불필요.
4. **Phase 2 (Adapter 패턴)**: 인터페이스 안정화가 선행되어야 하므로, Phase 1 완료 후 Phase 2 진행 권장.
5. **Phase 3**: 프론트 코드베이스에 주석 처리. 함수와 변수 등의 네이밍이 공개 인터페이스는 파스칼, 비공개 인터페이스는 캐멀케이스인지 확인. 문단으로 나뉜 각 로직과 함수 위에 영문 한 줄로 주석이 작성되었는지 확인.
