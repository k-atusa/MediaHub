# MediaHub v1.4.1

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

```
mediahub/
├── frontend/               # Next.js 14 + Material You 웹 프론트엔드
│   ├── src/
│   ├── public/
│   └── package.json
├── backend/                # Go 백엔드 서버 (프론트엔드 내장 단일 바이너리)
│   ├── server.go
│   ├── go.mod
│   ├── dist/               # 프론트엔드 정적 빌드 산출물 (embed.FS 내장)
│   ├── config/
│   │   └── config.json
│   ├── certs/
│   ├── users/
│   └── data/
├── build.sh                # 프론트엔드 빌드 + 백엔드 바이너리 단일 패키징 스크립트
└── icons/
```

| Option | Type | Info | 정보 |
| :-- | :-- | :-- | :-- |
| storage | string | data storage path | 데이터 저장폴더 경로 |
| port | int | HTTPS server port | HTTPS 서버 포트 |
| cert | string | TLS certificate path | TLS 인증서 파일 경로 |
| key | string | TLS keyfile path | TLS 키 파일 경로 |
| invite | string | invitation auth code | 가입 권한 코드 |
| notice | string | public notification | 접속 시 보이는 공지 |

## Build & Run

### 1. 원클릭 빌드 (프론트엔드 HTML 빌드 + 바이너리 내장)

```bash
./build.sh
```

### 2. 단계별 빌드

**프론트엔드 빌드 (Next.js export -> backend/dist):**
```bash
cd frontend
npm install
npm run build
```

**백엔드 바이너리 빌드 (Go 단일 바이너리):**
```bash
cd backend
go build -ldflags="-s -w" -trimpath -o server server.go
```

### 3. 서버 실행

`server` 바이너리 단일 파일만으로 프론트엔드 HTML 웹 UI와 백엔드 API가 동시에 실행됩니다.

```bash
cd backend
./server
```
