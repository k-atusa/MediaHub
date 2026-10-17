#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SERVER_DIR}/.." && pwd)"

VERSION="${1:-${VERSION:-}}"

if [ -n "${VERSION}" ]; then
  # Strip leading 'v' if present (e.g. v1.5.2 -> 1.5.2)
  VERSION="${VERSION#v}"
  OUTPUT_DIR="${ROOT_DIR}/build"
  mkdir -p "${OUTPUT_DIR}"

  echo "==> Building Multi-Platform Binaries for version ${VERSION}..."

  PLATFORMS=(
    "windows/amd64/mediahub-server-${VERSION}-windows-amd64.exe"
    "windows/arm64/mediahub-server-${VERSION}-windows-arm64.exe"
    "darwin/arm64/mediahub-server-${VERSION}-darwin-arm64"
    "linux/amd64/mediahub-server-${VERSION}-linux-amd64"
    "linux/arm64/mediahub-server-${VERSION}-linux-arm64"
  )

  cd "${SERVER_DIR}"
  for ITEM in "${PLATFORMS[@]}"; do
    IFS="/" read -r OS ARCH OUT_NAME <<< "${ITEM}"
    echo "==> Building ${OS}/${ARCH} -> ${OUTPUT_DIR}/${OUT_NAME}..."
    CGO_ENABLED=0 GOOS="${OS}" GOARCH="${ARCH}" go build \
      -ldflags="-s -w" \
      -trimpath \
      -o "${OUTPUT_DIR}/${OUT_NAME}" \
      server.go
  done

  echo "==> Generating SHA256 Checksums..."
  cd "${OUTPUT_DIR}"
  sha256sum mediahub-server-* > checksums.txt
  cat checksums.txt
  cd "${SERVER_DIR}"

  echo "==> Multi-platform build complete! Artifacts located in: ${OUTPUT_DIR}"
else
  # Local single-platform development build
  echo "==> Building MediaHub Server (local)..."
  cd "${SERVER_DIR}"
  LOCAL_VERSION="1.5.0"
  OS="$(go env GOOS)"
  ARCH="$(go env GOARCH)"
  EXT=""
  [ "${OS}" = "windows" ] && EXT=".exe"
  BIN_NAME="mediahub-server-${LOCAL_VERSION}-${OS}-${ARCH}${EXT}"

  echo "Compiling ${BIN_NAME}..."
  go build -ldflags="-s -w" -trimpath -o "${BIN_NAME}" server.go
  cp -f "${BIN_NAME}" server

  if [ -d "${ROOT_DIR}/backend" ]; then
    cp -f "${BIN_NAME}" "${ROOT_DIR}/backend/${BIN_NAME}"
    cp -f "${BIN_NAME}" "${ROOT_DIR}/backend/server"
  fi

  echo "==> Build complete! Output executable: ${SERVER_DIR}/${BIN_NAME} (and linked to ./server)"
fi
