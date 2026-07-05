# MediaHub v1.4.0

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

## Build Executable

```bash
go mod init example.com
go mod tidy
go build -ldflags="-s -w" -trimpath server.go
```
