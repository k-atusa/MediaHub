#!/usr/bin/env node
/**
 * Copies the Next.js static export (`./out`) into the Go-served public directory (`../public`).
 *
 * The Go server (`server/server.go`) serves files from `./public`. After this script runs,
 * the Next.js output lives there and the Go server can serve it as-is.
 *
 * The script preserves the legacy crypto modules (Bencrypt.js, Bencode.js, Opsec.js) that
 * are still referenced by the new frontend and the Go server does not modify them.
 * They live in `./public/crypto/` in the Next.js project and are copied to `../public/crypto/`.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'out');
const DEST = path.join(ROOT, '..', 'public');

function rimraf(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) rimraf(p);
    else fs.unlinkSync(p);
  }
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Source directory does not exist: ${src}\nDid you run "next build"?`);
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}

function emptyDestExcept(dest, keep) {
  if (!fs.existsSync(dest)) return;
  for (const entry of fs.readdirSync(dest, { withFileTypes: true })) {
    if (keep.includes(entry.name)) continue;
    const p = path.join(dest, entry.name);
    if (entry.isDirectory()) rimraf(p);
    else fs.unlinkSync(p);
  }
}

function main() {
  console.log(`[copy-to-public] src = ${SRC}`);
  console.log(`[copy-to-public] dest = ${DEST}`);

  // Preserve legacy crypto modules and favicon at the Go public root.
  // These are also emitted from ./public into ./out, so the source of truth is the Next.js
  // tree. We only keep them at DEST to avoid deleting the user-uploaded assets in dev.
  emptyDestExcept(DEST, ['users', 'data', 'certs', 'config']);

  copyDir(SRC, DEST);
  console.log('[copy-to-public] done.');
}

main();