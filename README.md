# MediaHub R1

project WHY(Web Hub Yard): Media Hub

> MediaHub is encrypted media streaming service for users who want to share data with others

## Architecture

- All cryptographic works on client browser memory.
- Server holds userdata, filenames, thumbnails, media encrypted.
- userdata is Map<folderName>folderKey, and Hash(folderKey)[0:12] is Physical ID.
- filenames is Map<fileName>fileKey, and Hash(fileKey)[0:12] is Physical ID.
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
  index.html
  app.js
  Bencode.js
  Bencrypt.js
  Opsec.js
```

## Build Executable

```bash
go mod init example.com
go mod tidy
go build -ldflags="-s -w" -trimpath server.go
```
