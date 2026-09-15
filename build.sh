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
cd "${ROOT_DIR}/backend"
go build -ldflags="-s -w" -trimpath -o server server.go

echo "==> Build complete! Output executable: ${ROOT_DIR}/backend/server"
