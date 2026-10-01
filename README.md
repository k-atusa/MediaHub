# MediaHub v1.5.0

project WHY(Web Hub Yard): Media Hub

> MediaHub is encrypted media streaming service for users who want to share data with others

## Usage

- Make your folder and upload files. You can share your folder with others.
- MediaHub supports views of text, pdf, image, and video.
- System does not care about concurrency: **Each user must upload after other user's session is cleared.**
- Focus of MediaHub is lightweight media share/watch. Making your own backup drive with other service is recommended.

## Architecture

- All cryptographic works on client browser memory, based on project USAG.
- Server holds userdata, filenames, thumbnails, media encrypted.
- userdata is Map[folderName]folderKey, and filenames is Map[fileName]fileKey.
- userdata is encrypted with userKey. filenames is encrypted with folderKey. Thumbnails and media are encrypted with fileKey.

```python
server
config/
  config.json
certs/
  cert.pem
  key.pem
users/
  ...
data/
  ...
public/
  ...
```

| Option | Type | Info | 정보 |
| :-- | :-- | :-- | :-- |
| storage | string | data storage path | 데이터 저장폴더 경로 |
| port | int | HTTPS server port | HTTPS 서버 포트 |
| cert | string | TLS certificate path | TLS 인증서 파일 경로 |
| key | string | TLS keyfile path | TLS 키 파일 경로 |
| invite | string | invitation auth code | 가입 권한 코드 |
| notice | string | public notification | 접속 시 보이는 공지 |

## Limitation

- It takes time to download and decrypt whole file and show. (Except for videos)
- For video, it uses real-time streaming. Still, buffering can take time up to 1 minute.
- With private TLS certificate, you cannot use streaming in Chrome. Streaming is disabled for all WebKit browsers due to its limitation.
- Uploading with browser limits file size to 2GiB. Use python client to large-scale upload.
- Python client requires USAG-Lib and OpenCV dependency.

## Build & Run

### Prerequisites
- [Go](https://go.dev/) 1.22 or higher

### Quick Build (Recommended)
Run the root build script. It automatically detects your current operating system and CPU architecture, compiling a single standalone Go binary with the embedded Web client (`server/public`):

```bash
./build.sh
```

- The compiled binary is saved to `server/mediahub-server-{version}-{os}-{arch}` and copied to `server/server`.

### Manual Build
You can also compile directly within the `server` directory using the standard Go toolchain:

```bash
cd server
go build -ldflags="-s -w" -trimpath -o server server.go
```

### Cross-Compilation (Multi-Platform)
Cross-compile for any target platform without external C dependencies:

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
Place your TLS certificates (`certs/cert.pem`, `certs/key.pem`) and configuration (`config/config.json`) in the `server` directory, then start the server:

```bash
cd server
./server
```
