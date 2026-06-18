# MediaHub v1.0.0

project WHY(Web Hub Yard): Media Hub

> MediaHub is encrypted media streaming service for users who want to share data with others

## Usage

- Make your folder and upload files. You can share your folder with others.
- MediaHub supports views of text, pdf, image, and video.
- File bigger than 500MB is hard to process. Consider cutting media before uploading with ffmpeg.
- System does not care about concurrency: Each user must upload after other user's session is cleared.
- Focus of MediaHub is lightweight media share/watch. Making your own backup drive with other service is recommended.

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
