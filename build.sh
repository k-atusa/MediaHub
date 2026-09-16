#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> Building MediaHub..."

echo "==> 1. Building Frontend (HTML/CSS/JS)..."
cd "${ROOT_DIR}/frontend"
if [ ! -d "node_modules" ]; then
  echo "Installing npm dependencies..."
  npm ci || npm install
fi
npm run build

echo "==> 2. Building Backend (Go binary with embedded frontend)..."
VERSION=$(node -p "require('${ROOT_DIR}/frontend/package.json').version" 2>/dev/null || echo "1.5.0")
OS="$(go env GOOS)"
ARCH="$(go env GOARCH)"
EXT=""
[ "${OS}" = "windows" ] && EXT=".exe"
BIN_NAME="mediahub-server-${VERSION}-${OS}-${ARCH}${EXT}"

cd "${ROOT_DIR}/backend"
echo "Compiling ${BIN_NAME}..."
go build -ldflags="-s -w" -trimpath -o "${BIN_NAME}" server.go
cp -f "${BIN_NAME}" server

echo "==> Build complete! Output executable: ${ROOT_DIR}/backend/${BIN_NAME} (and linked to ./server)"
