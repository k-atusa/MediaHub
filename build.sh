#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> Building MediaHub Server..."

cd "${ROOT_DIR}/server"
VERSION="1.4.1"
OS="$(go env GOOS)"
ARCH="$(go env GOARCH)"
EXT=""
[ "${OS}" = "windows" ] && EXT=".exe"
BIN_NAME="mediahub-server-${VERSION}-${OS}-${ARCH}${EXT}"

echo "Compiling ${BIN_NAME}..."
go build -ldflags="-s -w" -trimpath -o "${BIN_NAME}" server.go
cp -f "${BIN_NAME}" server

# Also copy binary to backend/ if backend directory exists
if [ -d "${ROOT_DIR}/backend" ]; then
  cp -f "${BIN_NAME}" "${ROOT_DIR}/backend/${BIN_NAME}"
  cp -f "${BIN_NAME}" "${ROOT_DIR}/backend/server"
fi

echo "==> Build complete! Output executable: ${ROOT_DIR}/server/${BIN_NAME} (and linked to ./server)"
