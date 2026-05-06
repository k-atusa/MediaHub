# 미디어 허브 설계도

- 본 프로젝트는 USAG-Lib의 알고리즘 또는 그와 호환되는 형식을 따른다.
- 공개키 알고리즘: `pqc1`, 대칭키 알고리즘: `gcmx1`, 키유도 알고리즘: `arg2`, 해시: `SHA3-256`

## 서버

서버는 여러 개의 폴더와 사용자 계정 파일을 저장한다.

### 공통 동작
- 클라이언트는 로그인 시 서버가 제공한 Nonce를 자신의 개인키로 서명하여 본인임을 증명하고, 세션 토큰(JWT 등)을 발급받아 API 요청 헤더에 포함
- 폴더명은 폴더 키를 해시하여 사용, 접근 관리
- 폴더의 이름과 포함된 파일들은 모두 폴더 키로 암호화

### 계정 관리

계정 파일: {publicKey, (privateKey, 폴더 키들): 사용자 PW 암호화}

- POST /api/account/register
	- username으로 새 사용자가 회원가입
	- 요청: {username: string, accountFile: bytes}
- GET /api/account/nonce
	- 서명용 Nonce 요청
	- 요청 쿼리: ?username={string}
	- 응답: {nonce: string}
- POST /api/account/login
	- 사용자 로그인 및 검증
	- 요청: {username: string, signature: bytes}
	- 응답: {token: string, accountFile: bytes}
- GET /api/account/publickey
	- 공유 대상의 공개키 조회
	- 요청 쿼리: ?username={string}
	- 응답: {publicKey: bytes}
- PUT /api/account
	- 계정 파일 갱신 (새로운 폴더 생성 및 공유받은 폴더 추가 시)
	- 요청: {accountFile: bytes}
- DELETE /api/account
	- 회원 탈퇴 (계정 파일 삭제 및 관련 세션 만료)

### 폴더 관리

폴더 표시명과 파일 메타데이터는 다음 형태로 저장: {folderName: string, files: list{id: string, name: string, size: number, time: number} }(폴더 키로 암호화)

서버의 물리 폴더는 내부에 meta, id, id.thumb으로 구성

- POST /api/folders
	- 새 폴더 생성 공간 할당
	- 요청: {folderId: string} (폴더 키의 해시값)
- GET /api/folders/{folderId}
	- 폴더 정보 및 포함된 파일 목록 조회
	- 응답: {encMeta: bytes, metaHash: bytes}
- POST /api/folders/{folderId}/trim
	- 폴더 안에서 고아 파일 삭제
	- 요청: {validIds: string[]}
- PUT /api/folders/{folderId}/meta
	- 폴더 메타데이터 갱신 (파일 업로드 완료, 파일명 변경, 파일 삭제 시 클라이언트가 호출), 서버는 원본 메타데이터 해시가 일치해야 받아줌
	- 요청: {encMeta: bytes, metaHash: bytes}
- DELETE /api/folders/{folderId}
	- 폴더 및 내부에 포함된 모든 파일 영구 삭제

### 미디어 파일 관리 및 업로드

청크 암호화 사양: 키는 IV 생성 시드를 통합하여 44B, 분할된 각 청크 데이터는 1048576B + 16B (Auth Tag)

- POST /api/folders/{folderId}/files
	- 파일 업로드 초기화 및 썸네일(선택) 저장
	- 요청: {fileId: string, totalChunks: number, encThumb: bytes (optional)}
	- 응답: 201 Created (업로드 세션 생성)

- GET /api/folders/{folderId}/files/{fileId}/chunks/status
	- 업로드 상태 조회 (이어올리기 시 사용)
	- 동작: 네트워크 끊김 후 재연결 시, 서버가 성공적으로 수신한 청크 인덱스 목록을 반환
	- 응답: {uploadedIndices: number[]} (예: [0, 1, 2, 4, 5])

- PUT /api/folders/{folderId}/files/{fileId}/chunks/{chunkIndex}
	- 미디어 청크 업로드 (병렬 업로드 지원)
	- 동작: 특정 인덱스의 암호화된 청크 데이터를 업로드.
	- 요청: 바이너리 청크 데이터 (Content-Type: application/octet-stream)
	- 응답: 200 OK (성공 시)

- POST /api/folders/{folderId}/files/{fileId}/commit
	- 업로드 최종 완료 및 병합 승인
	- 동작: 클라이언트가 모든 청크(totalChunks)를 전송했다고 판단할 때 호출. 서버는 누락된 청크가 없는지 검증 후 폴더 메타데이터 업데이트.
	- 요청: {encMeta: bytes, metaHash: bytes} (최종 확정된 폴더 메타데이터)
	- 응답: 200 OK

- GET /api/folders/{folderId}/files/{fileId}/stream
	- 미디어 파일 보기 및 스트리밍 (클라이언트의 Range 요청에 따라 정확한 청크 오프셋 계산 후 반환)
	- 요청 헤더: Range: bytes=start-end
	- 응답: 206 Partial Content, 청크 데이터 바이트

- DELETE /api/folders/{folderId}/files/{fileId}
	- 물리적 파일 및 썸네일, 연결된 미디어 청크 삭제
	-삭제 후 폴더 meta 갱신 API 호출 필요

### 폴더 공유 관리

- POST /api/shares
	- 특정 사용자 이름(username)으로 암호화된 폴더 키 전송 (서버 공유 큐에 적재)
	- 요청: {targetUsername: string, encFk: bytes}
- GET /api/shares/pending
	- 서버 로그인 시 자신을 타겟으로 한 대기 중인 공유 큐 내용 모두 받아오기
	- 응답: { pending: list{shareId: string, encFk: bytes} }
- POST /api/shares/ack
	- 클라이언트가 성공적으로 폴더 키를 복호화하고 저장했음을 서버에 알림. 서버는 확인 후 공유 큐에서 해당 항목 삭제
	- 요청: {shareIds: string[]}

## 클라이언트

- 암호화 모듈: USAG-Lib + 단일 청크 암복호화기 추가
- 세션과 인증 모듈
- 폴더와 파일 메타데이터 모듈
- 대용량 업로드 다운로드 모듈
- 공유 관리 모듈