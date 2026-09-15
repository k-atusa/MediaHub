#!/usr/bin/env node
/**
 * Copies the Next.js static export (`./out`) into the Go backend distribution directory (`../backend/dist`).
 *
 * The Go server (`backend/server.go`) embeds this directory via `//go:embed all:dist`.
 * After this script runs, the Next.js static output is ready to be compiled into the single Go binary
 * or served directly as static files.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'out');
const DEST = path.join(ROOT, '..', 'backend', 'dist');

function rimraf(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') continue;
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

function main() {
  console.log(`[copy-to-backend] src  = ${SRC}`);
  console.log(`[copy-to-backend] dest = ${DEST}`);

  if (fs.existsSync(DEST)) {
    rimraf(DEST);
  }
  copyDir(SRC, DEST);
  console.log('[copy-to-backend] successfully copied static frontend build to backend/dist.');
}

main();
