# MediaHub R1

project WHY(Web Hub Yard): Media Hub

> MediaHub is encrypted media streaming service for users who want to share data with others

## Usage

- Make your folder and upload files. You can share your folder with others.
- MediaHub supports editing text, watching pdf, image, and video.
- File bigger than 500MB is hard to process. Consider cutting media before uploading with ffmpeg.

## Architecture

- All cryptographic works on client browser memory, based on project USAG.
- Server holds userdata, filenames, thumbnails, media encrypted.
- userdata is Map[folderName]folderKey, and Hash(folderKey)[0:16] is Physical ID.
- filenames is Map[fileName]fileKey, and Hash(fileKey)[0:16] is Physical ID.
- userdata is encrypted with userKey. filenames is encrypted with folderKey. Thumbnails and media are encrypted with fileKey.

```python
server
config.json
cert.pem
key.pem
users/
  ...
data/
  ...
public/
  ...
```

## Build Executable

```bash
go mod init example.com
go mod tidy
go build -ldflags="-s -w" -trimpath server.go
```
