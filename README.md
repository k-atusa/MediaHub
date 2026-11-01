# MediaHub v1.6.0

project WHY(Web Hub Yard): Media Hub

> MediaHub is encrypted media streaming service for users who want to share data with others

## 사용법

- 서버에 폴더를 생성하고 파일을 업로드하세요. 폴더를 공유할 수 있습니다.
- 텍스트, pdf, 이미지, 동영상의 재생을 지원합니다.
- 제로 트러스트 구조라 동시성 제어가 없습니다. **같은 폴더에서는 각 사람의 업로드가 끝난 뒤에 사용하세요**
- 미디어허브는 가벼운 미디어 감상용입니다. 별도의 백업 이용을 권장합니다.
- **폴더 라이프사이클 관리**: 중앙 권한 서버가 없으므로 폴더별 "소유자(Owner)"를 정하고, 공유받은 참여자는 `Unlink(참조 해제)`를, 최종 소유자만 `Delete(영구 삭제)`를 사용해야 합니다.

## Usage

- Make your folder and upload files. You can share your folder with others.
- MediaHub supports views of text, pdf, image, and video.
- System does not care about concurrency: **Each user must upload after other user's session is cleared.**
- Focus of MediaHub is lightweight media share/watch. Making your own backup drive with other service is recommended.
- **Folder Lifecycle Management**: Due to the absence of a central ACL server, designate a specific "Owner" per folder. Peers must use `Unlink`, and only the final owner should execute `Delete`.

## 주의사항

- 콘텐츠를 보여주기 위해 전체 파일을 다운로드하고 복호화하는데 시간이 걸립니다.
- 동영상의 경우 전체 다운로드 대신 실시간 스트리밍을 사용합니다.
- 브라우저 상에서의 업로드는 파일 크기가 2GiB로 제한됩니다. 대량 업로드는 다른 클라이언트(데스크탑/안드로이드)를 사용하십시오.
- 브라우저 간 웹 표준 준수 호환성이 다릅니다. 파이어폭스 사용을 권장하지만 크로미움 기반 브라우저도 괜찮습니다.
- 사설 TLS 인증서를 사용한다면 크롬에서 동영상 스트리밍을 할 수 없습니다. 일부 브라우저는 fmp4(분할 mp4)를 지원하지 않으니 표준 mp4 형식을 사용하십시오.

## Limitation

- It takes time to download and decrypt whole file and show. (Except for videos)
- For video, it uses real-time streaming. Still, buffering can take time several seconds.
- Uploading with browser limits file size to 2GiB. Use other clients(desktop/android) to large-scale upload.
- There is some differences about following web standards among the browsers. Recommended is FireFox, but Chromium based are also good.
- With private TLS certificate, you cannot use streaming in Chrome. Some browser doesn't support fmp4(fragmented mp4), so use standard mp4 instead.

---

## Zero-Trust Operational Protocol

Because MediaHub strictly operates under a client-side Zero-Knowledge / E2EE architecture, the backend server retains zero identity keys and does not enforce centralized Access Control Lists (ACL) to differentiate between an "owner" and a "shared peer".

To prevent premature data destruction in a decentralized trust environment, all participants must adhere to the following operational lifecycle protocol:

1. **Designated Ownership Model**: Establish a single designated **Owner** per shared folder by explicit mutual agreement among peers. The owner assumes operational responsibility for the folder's end-of-life cycle.
2. **Peers Must Only `Unlink`**: When a peer no longer needs access to a shared folder, they must exclusively use **Unlink**. This cleanly drops the cryptographic key from their personal `userdata` without mutating backend storage or disrupting other peers.
3. **Hard Deletion (`Delete`) by Owner Only**: The **Delete** operation permanently wipes physical encrypted blobs and directory structures on the host server. The designated owner should execute `Delete` only after verifying that all shared participants have unlinked and the folder has reached its final retirement.

## Server API

- All cryptographic works on client browser memory, based on project USAG.
- Server holds userdata, filenames, thumbnails, media encrypted.
- userdata is Map[folderName]folderKey, and filenames is Map[fileName]fileKey.
- userdata is encrypted with userKey. filenames is encrypted with folderKey. Thumbnails and media are encrypted with fileKey.

- **GET** `/api/userdata/{user_hash}`
  - Header: -
  - Returns: `200` Binary
  - Returns userdata.

- **POST** `/api/userdata/{user_hash}`
  - Header: `X-User-Hash` (required for existing users), `X-Old-Hash` (optional), `X-Invite-Code` (required for new users), `X-Upload-Offset` (optional, default: 0)
  - Body: Binary
  - Returns: `200` Success
  - Create or update userdata. Existing users require authentication. New users require an invite code if configured. `X-Old-Hash` verifies the existence of a previous user file.

- **DELETE** `/api/userdata/{user_hash}`
  - Header: `X-User-Hash`
  - Returns: `200` OK
  - Delete userdata. Returns 200 even if the target file does not exist.

- **GET** `/api/storage/{folder_pid}/names`
  - Header: -
  - Returns: `200` Binary
  - Returns folder metadata (names).

- **POST** `/api/storage/{folder_pid}/names`
  - Header: `X-User-Hash`, `X-Upload-Offset` (optional, default: 0)
  - Body: Binary
  - Returns: `200` Success
  - Create or update folder metadata.

- **DELETE** `/api/storage/{folder_pid}/names`
  - Header: `X-User-Hash`
  - Returns: `200` OK
  - Recursively delete the entire folder and its contents.

- **GET** `/api/media/{folder_pid}/{file_pid}/{type}`
  - Header: `Range` (optional)
  - Returns: `200` Binary / `206` Partial Content
  - Download media data. `type`: `dat` or `thumb`. Supports HTTP byte-range requests.

- **POST** `/api/media/{folder_pid}/{file_pid}/{type}`
  - Header: `X-User-Hash`, `X-Upload-Offset` (optional, default: 0)
  - Body: Binary
  - Returns: `200` Success
  - Create or update a media file. Automatically creates the folder if missing.

- **DELETE** `/api/media/{folder_pid}/{file_pid}/{type}`
  - Header: `X-User-Hash`
  - Returns: `200` OK
  - Delete the specified `dat` or `thumb` file. Returns 200 even if the target file does not exist.

- **POST** `/api/trim/{folder_pid}`
  - Header: `X-User-Hash`, `Content-Type: application/json`
  - Body: JSON `{"pids":["aabb","ccdd"]}`
  - Returns: `200` Text / `409` Conflict
  - Delete orphan media files whose PIDs are not included in the provided list. At least 50% of existing unique PIDs must be retained.

- **GET** `/api/notice`
  - Header: -
  - Returns: `200` JSON `{"notice":"..."}`
  - Returns the server notice.

- **GET, HEAD** `/.well-known/acme-challenge/{token}`
  - Header: -
  - Returns: `200` Text
  - Returns the ACME challenge token file. Available only when `acme` is configured.

---

## Build & Run

MediaHub requires [Go](https://go.dev/) 1.22 or higher

### Quick Build (Recommended)

Run the build script. It automatically detects your OS and CPU, compiling a single standalone Go binary with the embedded Web client (`server/public`).

The compiled binary is saved to `server/mediahub-server-{version}-{os}-{arch}` and copied to `server/server`.

```bash
cd server
./build.sh
```

### Manual Build

Compile directly within the `server` directory.

```bash
cd server
go build -ldflags="-s -w" -trimpath -o server server.go
```

Cross-compile builds without external C dependencies are also available.

```bash
cd server

# Windows (x86_64)
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -trimpath -o mediahub-server-windows-amd64.exe server.go

# Windows (ARM64)
CGO_ENABLED=0 GOOS=windows GOARCH=arm64 go build -ldflags="-s -w" -trimpath -o mediahub-server-windows-arm64.exe server.go

# macOS (Apple Silicon ARM64)
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -trimpath -o mediahub-server-darwin-arm64 server.go

# Linux (x86_64)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -trimpath -o mediahub-server-linux-amd64 server.go

# Linux (ARM64)
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -trimpath -o mediahub-server-linux-arm64 server.go
```

### Running the Server

The server automatically generates required files and directories. Edit configuration, then start the server.

```
server
config/
  config.json
certs/
  cert.pem
  key.pem
users/
data/
```

```bash
cd server
./server
```

| Option | Type | Info | 정보 |
| :-- | :-- | :-- | :-- |
| storage | string | data storage path | 데이터 저장폴더 경로 |
| invite | string | invitation auth code | 가입 권한 코드 |
| notice | string | public notification | 접속 시 보이는 공지 |
| port | int | server port | 서버 포트 |
| http | bool | enables HTTP mode | HTTP 모드 사용 |
| loopback | bool | allows only loopback ip to connect | 루프백 IP만 연결 허용 |
| acme | string | ACME token respond path | ACME 인증토큰 응답 경로 |
| cert | string | TLS certificate path | TLS 인증서 파일 경로 |
| key | string | TLS keyfile path | TLS 키 파일 경로 |