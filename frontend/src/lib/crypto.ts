// MediaHub crypto integration layer.
//
// This module wraps the unmodified USAG-Lib crypto modules (Bencrypt.js,
// Bencode.js, Opsec.js) in a small, type-safe TypeScript surface that the
// rest of the web app can call. The crypto modules themselves are vendored
// verbatim from `server/public/` and live next to this file so that webpack
// can bundle them. The user said not to modify the crypto code; this file
// only orchestrates calls into it.

import { SHA3256, Random, Masker, HashMaster, SymMaster } from './crypto/Bencrypt.js';
import { Encode64, Decode64, NormPW } from './crypto/Bencode.js';
import { EncodeCfg, DecodeCfg, DecodeInt, EncodeInt, Opsec } from './crypto/Opsec.js';

const SECRET_PEPPER = '_PROJECT_WHY_MEDIAHUB_PEPPER_2026_!@#$';
export const mask = new Masker();

// ---------- helpers ----------

function toHex(buf: Uint8Array): string {
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    out += buf[i].toString(16).padStart(2, '0');
  }
  return out;
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function wipe(buf: Uint8Array | undefined): void {
  if (buf && buf.length > 0 && typeof buf.fill === 'function') {
    buf.fill(0);
  }
}

export function wipeMap(map: Record<string, Uint8Array>): void {
  for (const v of Object.values(map)) {
    if (v && typeof v.fill === 'function') v.fill(0);
  }
}

export function maskMap(map: Record<string, Uint8Array>): void {
  for (const k of Object.keys(map)) {
    const r = map[k];
    if (r) {
      map[k] = mask.XOR(r);
      if (typeof r.fill === 'function') r.fill(0);
    }
  }
}

export function rawMap(map: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const c: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(map)) {
    c[k] = mask.XOR(v);
  }
  return c;
}

async function readFileBytes(file: Blob): Promise<Uint8Array> {
  const ab = await file.arrayBuffer();
  return new Uint8Array(ab);
}

// ---------- types ----------

export interface KeyMaterial {
  /** Hex of first 16 bytes of SHA3-256(storeKey). */
  userHash: string;
  /** XOR-masked userKey, persisted in session storage as hex. */
  maskedUserKey: string;
  username: string;
}

export type FolderMap = Record<string, Uint8Array>;
export type FileMap = Record<string, Uint8Array>;

// 44 bytes: [AES-256 key 32][IV 12]
export const KEY_LEN = 44;

// ---------- session ----------

export async function makeSession(username: string, password: string): Promise<KeyMaterial> {
  if (!username || !password) throw new Error('Username and password are required');
  const pwBytes = NormPW(password);
  const saltBytes = SHA3256(new TextEncoder().encode(username + SECRET_PEPPER));
  const hm = new HashMaster('arg2st');
  const [storeKey, userKey] = await hm.KDF(pwBytes, saltBytes);
  wipe(pwBytes);
  const userHash = toHex(SHA3256(storeKey).slice(0, 16));
  const masked = mask.XOR(userKey);
  wipe(userKey);
  const maskedUserKey = toHex(masked);
  wipe(masked);
  return { userHash, maskedUserKey, username };
}

export function recoverSessionKey(maskedUserKeyHex: string): Uint8Array {
  const masked = fromHex(maskedUserKeyHex);
  const raw = mask.XOR(masked);
  wipe(masked);
  return raw;
}

// ---------- user blobs ----------

export async function saveUserBlob(
  userHash: string,
  userKey: Uint8Array,
  folders: FolderMap
): Promise<Uint8Array> {
  const sm = new SymMaster('gcm1', userKey.slice(0, 32));
  const um = rawMap(folders);
  const encoded = EncodeCfg(um);
  wipeMap(um);
  const out = await sm.EnBin(encoded);
  wipe(encoded);
  return out;
}

export async function decryptUserBlobAsync(userKey: Uint8Array, blob: Uint8Array): Promise<FolderMap> {
  const sm = new SymMaster('gcm1', userKey.slice(0, 32));
  const dec = await sm.DeBin(blob);
  const map = DecodeCfg(dec) as Record<string, Uint8Array>;
  wipe(dec);
  maskMap(map);
  return map;
}

// ---------- folder / file keys ----------

export function createFolderKey(): Uint8Array {
  const k = new Uint8Array(KEY_LEN);
  k.set(Random(32), 0);
  k.set(Random(12), 32);
  return k;
}

export function createFileKey(): Uint8Array {
  const k = new Uint8Array(KEY_LEN);
  k.set(Random(32), 0);
  k.set(Random(12), 32);
  return k;
}

export function getPidFromRawKey(rawKey: Uint8Array): string {
  return toHex(rawKey.slice(32, 44));
}

export function getFolderPid(maskedFolderKey: Uint8Array): string {
  const rawK = mask.XOR(maskedFolderKey);
  const pid = toHex(rawK.slice(32, 44));
  rawK.fill(0);
  return pid;
}

export function getFilePid(maskedFileKey: Uint8Array): string {
  const rawK = mask.XOR(maskedFileKey);
  const pid = toHex(rawK.slice(32, 44));
  rawK.fill(0);
  return pid;
}

export function getOriginalSize(fileKey: Uint8Array): number {
  if (fileKey.length < 52) return 0;
  const sizeBytes = fileKey.slice(44, 52);
  const v = new DataView(sizeBytes.buffer, sizeBytes.byteOffset, 8);
  return Number(v.getBigUint64(0, true));
}

export function setOriginalSize(fileKey: Uint8Array, size: number): void {
  if (fileKey.length < 52) return;
  const sizeBytes = fileKey.slice(44, 52);
  const v = new DataView(sizeBytes.buffer, sizeBytes.byteOffset, 8);
  v.setBigUint64(0, BigInt(size), true);
}

// Allocate a 52-byte key (32 key + 12 iv + 8 size). Used for file keys so we
// preserve the original (plaintext) size inside the key itself, matching
// the commit 92ac2ec4 / legacy convention.
export function createFileKeyWithSize(size: number): Uint8Array {
  const k = new Uint8Array(52);
  k.set(Random(32), 0);
  k.set(Random(12), 32);
  const v = new DataView(k.slice(44, 52).buffer, k.slice(44, 52).byteOffset, 8);
  v.setBigUint64(0, BigInt(size), true);
  return k;
}

// ---------- folder names (file map) ----------

export async function saveFolderBlob(folderPid: string, maskedFolderKey: Uint8Array, fileMap: FileMap): Promise<Uint8Array> {
  const rawK = mask.XOR(maskedFolderKey);
  const sm = new SymMaster('gcm1', rawK.slice(0, 32));
  rawK.fill(0);
  const um = rawMap(fileMap);
  const encoded = EncodeCfg(um);
  wipeMap(um);
  const out = await sm.EnBin(encoded);
  wipe(encoded);
  return out;
}

export async function decryptFolderBlobAsync(maskedFolderKey: Uint8Array, blob: Uint8Array): Promise<FileMap> {
  const rawK = mask.XOR(maskedFolderKey);
  const sm = new SymMaster('gcm1', rawK.slice(0, 32));
  rawK.fill(0);
  const dec = await sm.DeBin(blob);
  const map = DecodeCfg(dec) as Record<string, Uint8Array>;
  wipe(dec);
  maskMap(map);
  return map;
}

// ---------- file encryption (chunked AES-GCM via gcmx1) ----------

class BlobSrc {
  private offset = 0;
  constructor(private blob: Blob) {}
  async read(size: number): Promise<Uint8Array> {
    if (this.offset >= this.blob.size) return new Uint8Array(0);
    const chunk = this.blob.slice(this.offset, this.offset + size);
    this.offset += chunk.size;
    const ab = await chunk.arrayBuffer();
    return new Uint8Array(ab);
  }
}

export class BlobWriter {
  chunks: Uint8Array[] = [];
  async write(chunk: Uint8Array): Promise<void> {
    if (chunk && chunk.length > 0) this.chunks.push(chunk);
  }
  getBytes(): Uint8Array {
    const total = this.chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

export async function encryptFileBlob(file: Blob, fileKey: Uint8Array): Promise<Uint8Array> {
  const sm = new SymMaster('gcmx1', fileKey.slice(0, 32));
  const src = new BlobSrc(file);
  const dst = new BlobWriter();
  await sm.EnFile(src, file.size, dst);
  return dst.getBytes();
}

export async function decryptFileBytes(datBytes: Uint8Array, fileKey: Uint8Array, originalSize: number): Promise<Uint8Array> {
  const sm = new SymMaster('gcmx1', fileKey.slice(0, 32));
  const smx = sm as unknown as { AfterSize: (n: number) => number };
  const cipherSize = typeof smx.AfterSize === 'function' ? smx.AfterSize(originalSize) : datBytes.length;
  const enc = datBytes.slice(0, cipherSize);
  const dst = new BlobWriter();
  await sm.DeFile(new NetSrc(enc), enc.length, dst);
  return dst.getBytes();
}

export class NetSrc {
  private ptr = 0;
  constructor(private buf: Uint8Array) {}
  async read(size: number): Promise<Uint8Array> {
    if (this.ptr >= this.buf.length) return new Uint8Array(0);
    const end = Math.min(this.ptr + size, this.buf.length);
    const chunk = this.buf.slice(this.ptr, end);
    this.ptr = end;
    return chunk;
  }
}

// ---------- thumbnails ----------

export async function encryptThumbBytes(thumbBlob: Blob, fileKey: Uint8Array): Promise<Uint8Array> {
  const sm = new SymMaster('gcm1', fileKey.slice(0, 32));
  const buf = new Uint8Array(await thumbBlob.arrayBuffer());
  return await sm.EnBin(buf);
}

export async function decryptThumbBytes(thumbBytes: Uint8Array, fileKey: Uint8Array): Promise<Uint8Array> {
  const sm = new SymMaster('gcm1', fileKey.slice(0, 32));
  return await sm.DeBin(thumbBytes);
}

export async function makeImageThumb(file: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap === 'undefined') return null;
  try {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const ratio = bmp.width / bmp.height;
    if (ratio >= 0.6666 && ratio <= 1.5) {
      if (bmp.width >= bmp.height) {
        canvas.width = 256;
        canvas.height = Math.round(256 / ratio);
      } else {
        canvas.height = 256;
        canvas.width = Math.round(256 * ratio);
      }
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    } else {
      const size = Math.min(bmp.width, bmp.height);
      canvas.width = 256;
      canvas.height = 256;
      ctx.drawImage(bmp, 0, 0, size, size, 0, 0, 256, 256);
    }
    bmp.close();
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.7));
  } catch (e) {
    return null;
  }
}

export async function makeVideoThumb(file: Blob): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = URL.createObjectURL(file);
    video.onloadeddata = () => {
      video.currentTime = 1;
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(video.src);
        resolve(null);
        return;
      }
      const ratio = video.videoWidth / video.videoHeight;
      if (video.videoWidth >= video.videoHeight) {
        canvas.width = 256;
        canvas.height = Math.round(256 / ratio);
      } else {
        canvas.height = 256;
        canvas.width = Math.round(256 * ratio);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (b) => {
          URL.revokeObjectURL(video.src);
          resolve(b);
        },
        'image/jpeg',
        0.7
      );
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      resolve(null);
    };
  });
}

export async function makeThumb(file: Blob): Promise<Blob | null> {
  const mime = file.type;
  if (mime.startsWith('image/')) return makeImageThumb(file);
  if (mime.startsWith('video/')) return makeVideoThumb(file);
  return null;
}

// ---------- share tokens (Opsec password-encrypted) ----------

export async function makeShareToken(name: string, maskedFolderKey: Uint8Array, password: string): Promise<string> {
  const rawK = mask.XOR(maskedFolderKey);
  const op = new Opsec();
  op.Smsg = name;
  op.SmsgInfo = rawK;
  const head = await op.Encpw('arg2st', NormPW(password));
  rawK.fill(0);
  return Encode64(head, '#');
}

export async function loadShareToken(token: string, password: string): Promise<{ name: string; folderKey: Uint8Array } | null> {
  try {
    const raw = Decode64(token, '#');
    const op = new Opsec();
    op.View(raw);
    await op.Decpw(NormPW(password));
    if (!op.Smsg || op.SmsgInfo.length === 0) return null;
    const maskedFolderKey = mask.XOR(op.SmsgInfo);
    wipe(op.SmsgInfo);
    return { name: op.Smsg, folderKey: maskedFolderKey };
  } catch (e) {
    return null;
  }
}

// ---------- file kind helpers ----------

export function detectKind(name: string): 'text' | 'image' | 'video' | 'pdf' | 'binary' {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return 'video';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['txt', 'md', 'json', 'csv', 'log', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx'].includes(ext)) return 'text';
  return 'binary';
}

export function mimeForKind(kind: ReturnType<typeof detectKind>, name?: string): string {
  if (kind === 'video') return 'video/mp4';
  if (kind === 'image') return 'image/jpeg';
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'text') return 'text/plain';
  if (name) {
    const ext = name.split('.').pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      txt: 'text/plain',
      md: 'text/markdown',
      json: 'application/json',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      webm: 'video/webm',
    };
    if (ext && mimeMap[ext]) return mimeMap[ext];
  }
  return 'application/octet-stream';
}

// Export raw helpers for advanced use cases
export { toHex, fromHex, wipe, DecodeInt, EncodeInt, EncodeCfg, DecodeCfg, SymMaster };