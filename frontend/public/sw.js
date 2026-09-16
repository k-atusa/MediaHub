// MediaHub Service Worker – Chunked AES-GCM Video Streaming
const PLAIN_CHUNK = 1048576;
const CIPHER_CHUNK = PLAIN_CHUNK + 16;
const MAX_RESPONSE = 2 * 1048576;
const CACHE_MAX = 8;

const regMap = new Map();
const cchMap = new Map();

// cache map functions
function cchGet(flPid, idx) {
    const k = `${flPid}_${idx}`;
    const entry = cchMap.get(k);
    if (entry) { entry.ts = Date.now(); return entry.dataPromise; }
    return null;
}
function cchSet(flPid, idx, dataPromise) {
    const k = `${flPid}_${idx}`;
    cchMap.set(k, { dataPromise, ts: Date.now() });
    if (cchMap.size > CACHE_MAX) {
        let oldest = null, oldKey = null;
        for (const [key, val] of cchMap) {
            if (!oldest || val.ts < oldest) { oldest = val.ts; oldKey = key; }
        }
        if (oldKey) cchMap.delete(oldKey);
    }
}
function cchPurg(flPid) {
    for (const k of [...cchMap.keys()]) {
        if (k.startsWith(flPid + '_')) cchMap.delete(k);
    }
}

function hexToU8(hex) {
    const clean = hex.replace(/[^0-9a-f]/gi, '');
    const arr = new Uint8Array(clean.length / 2);
    for (let i = 0; i < arr.length; i++) arr[i] = parseInt(clean.substr(i * 2, 2), 16);
    return arr;
}

// XOR counter into IV.
function mkiv(gIV, count) {
    const iv = new Uint8Array(gIV);
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigUint64(0, BigInt(count), true);
    const cb = new Uint8Array(buf);
    for (let i = 0; i < 8; i++) iv[4 + i] ^= cb[i];
    return iv;
}

function vidMime(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    const map = {
        mp4: 'video/mp4',
        m4v: 'video/mp4',
        mov: 'video/mp4',
        webm: 'video/webm',
        mkv: 'video/x-matroska',
        ogv: 'video/ogg'
    };
    return map[ext] || 'video/mp4';
}

// Handle SW messages.
self.addEventListener('message', async (e) => {
    const d = e.data;
    if (!d) return;
    if (d.action === 'REGISTER') {
        try {
            const raw = hexToU8(d.fileKey);
            const aesKey = raw.slice(0, 32);
            const cryptoKey = await crypto.subtle.importKey('raw', aesKey, 'AES-GCM', false, ['decrypt']);
            aesKey.fill(0);
            raw.fill(0);
            regMap.set(d.filePid, {
                fldId: d.folderId,
                gIV: null,
                gIVPromise: null,
                cryptoKey,
                origSize: d.originalSize || 0,
                mime: vidMime(d.fileName)
            });

            // ACK key stored using MessagePort if available, fallback to e.source
            if (e.ports && e.ports[0]) {
                e.ports[0].postMessage({ action: 'REGISTERED', filePid: d.filePid });
            } else if (e.source) {
                e.source.postMessage({ action: 'REGISTERED', filePid: d.filePid });
            }
        } catch (err) {
            console.error('[SW] Failed to register key for', d.filePid, err);
            if (e.ports && e.ports[0]) {
                e.ports[0].postMessage({ action: 'ERROR', error: String(err) });
            }
        }
    } else if (d.action === 'UNREGISTER') {
        const info = regMap.get(d.filePid);
        if (info) { if (info.gIV) info.gIV.fill(0); }
        regMap.delete(d.filePid);
        cchPurg(d.filePid);
        if (e.ports && e.ports[0]) {
            e.ports[0].postMessage({ action: 'UNREGISTERED', filePid: d.filePid });
        }
    }
});

async function getInfo(flPid) {
    if (regMap.has(flPid)) return regMap.get(flPid);

    // Ask clients for key if missing.
    const wClients = await clients.matchAll({ type: 'window' });
    if (wClients.length === 0) return null;

    wClients.forEach(c => c.postMessage({ action: 'REQUEST_KEY', filePid: flPid }));

    // Wait up to 3s for client.
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (regMap.has(flPid)) return regMap.get(flPid);
    }
    return null;
}

// Fetch interceptor.
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    const m = url.pathname.match(/^\/sw-stream\/([^/]+)\/([^/]+)$/);
    if (!m) return;
    e.respondWith(hndlStrm(e.request, decodeURIComponent(m[1]), decodeURIComponent(m[2])));
});

async function ensureOrigSize(info, fldId, flPid) {
    if (info.origSize && info.origSize > 0) return info.origSize;
    try {
        const res = await fetch(`/api/media/${fldId}/${flPid}/dat`, { method: 'HEAD' });
        const lenStr = res.headers.get('Content-Length');
        if (lenStr) {
            const cipherLen = parseInt(lenStr, 10);
            if (cipherLen > 12) {
                const rem = cipherLen - 12;
                const full = Math.floor(rem / CIPHER_CHUNK);
                const last = rem % CIPHER_CHUNK;
                const plain = full * PLAIN_CHUNK + (last > 16 ? last - 16 : 0);
                info.origSize = plain;
                return plain;
            }
        }
    } catch (err) {
        console.warn('[SW] Failed to deduce original size from HEAD:', err);
    }
    return info.origSize || 0;
}

async function hndlStrm(req, fldId, flPid) {
    const info = await getInfo(flPid);
    if (!info) {
        console.warn('[SW] Stream requested but not registered:', flPid);
        return new Response('Not registered', { status: 404 });
    }

    const origSize = await ensureOrigSize(info, fldId, flPid);
    if (!origSize || origSize <= 0) {
        return new Response('Invalid file size', { status: 500 });
    }

    const { mime } = info;

    // Parse Range header.
    let rStart = 0, rEnd = origSize - 1;
    let openEnd = true;
    const rh = req.headers.get('Range');
    if (rh) {
        const p = rh.match(/bytes=(\d+)-(\d*)/);
        if (p) {
            rStart = parseInt(p[1], 10);
            if (p[2]) { rEnd = parseInt(p[2], 10); openEnd = false; }
        }
    }
    // Cap open-ended requests to at most MAX_RESPONSE (2MB).
    if (openEnd && rEnd - rStart + 1 > MAX_RESPONSE) rEnd = rStart + MAX_RESPONSE - 1;
    rEnd = Math.min(rEnd, origSize - 1);
    if (rStart > rEnd || rStart >= origSize) {
        return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${origSize}` }
        });
    }

    const totalLen = rEnd - rStart + 1;
    const firstIdx = Math.floor(rStart / PLAIN_CHUNK);
    const lastIdx = Math.floor(rEnd / PLAIN_CHUNK);

    try {
        const outBytes = new Uint8Array(totalLen);
        let outOffset = 0;

        for (let curIdx = firstIdx; curIdx <= lastIdx; curIdx++) {
            let plnProm = cchGet(flPid, curIdx);
            if (!plnProm) {
                plnProm = fetchChk(info, fldId, flPid, curIdx).catch(err => {
                    cchMap.delete(`${flPid}_${curIdx}`);
                    throw err;
                });
                cchSet(flPid, curIdx, plnProm);
            }
            const plain = await plnProm;

            const chunkBase = curIdx * PLAIN_CHUNK;
            const from = Math.max(rStart, chunkBase) - chunkBase;
            const to = Math.min(rEnd, chunkBase + plain.length - 1) - chunkBase;

            if (from <= to) {
                outBytes.set(plain.subarray(from, to + 1), outOffset);
                outOffset += (to - from + 1);
            }
        }

        return new Response(outBytes, {
            status: 206,
            headers: {
                'Content-Type': mime,
                'Content-Length': totalLen.toString(),
                'Content-Range': `bytes ${rStart}-${rEnd}/${origSize}`,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-store, no-cache, must-revalidate'
            }
        });
    } catch (err) {
        console.error('[SW] Stream error for chunk range:', err);
        return new Response('Stream decryption failed', { status: 500 });
    }
}

// Lazy-load globalIV from file header (first 12 bytes).
async function ensureGIV(info, fldId, flPid) {
    if (info.gIV) return info.gIV;
    if (!info.gIVPromise) {
        info.gIVPromise = (async () => {
            const res = await fetch(`/api/media/${fldId}/${flPid}/dat`, {
                headers: { 'Range': 'bytes=0-11' }
            });
            info.gIV = new Uint8Array(await res.arrayBuffer());
            return info.gIV;
        })();
    }
    return info.gIVPromise;
}

// Fetch and decrypt chunk.
async function fetchChk(info, fldId, flPid, chkIdx, signal) {
    const { origSize, cryptoKey } = info;

    // Ensure globalIV is loaded from file header.
    const gIV = await ensureGIV(info, fldId, flPid);

    // Calc plain size of chunk.
    const plainLen = Math.min(PLAIN_CHUNK, origSize - chkIdx * PLAIN_CHUNK);
    const cipherLen = plainLen + 16;

    // Offset by 12 to skip globalIV prefix in encrypted file.
    const cStart = 12 + chkIdx * CIPHER_CHUNK;
    const cEnd = cStart + cipherLen - 1;

    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(`/api/media/${fldId}/${flPid}/dat`, {
                headers: { 'Range': `bytes=${cStart}-${cEnd}` },
                signal
            });
            if (!res.ok && res.status !== 206 && res.status !== 200) {
                throw new Error(`HTTP ${res.status}`);
            }
            const cipherBuf = await res.arrayBuffer();
            if (cipherBuf.byteLength !== cipherLen) {
                throw new Error(`Length mismatch: got ${cipherBuf.byteLength}, expected ${cipherLen}`);
            }

            // Decrypt chunk payload.
            const iv = mkiv(gIV, chkIdx);
            const plain = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                cryptoKey,
                cipherBuf
            );
            return new Uint8Array(plain);
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            lastErr = err;
            console.warn(`[SW] Chunk ${chkIdx} fetch attempt ${attempt} failed:`, err);
            if (attempt < 3) await new Promise(r => setTimeout(r, 600 * attempt));
        }
    }
    throw lastErr;
}

// Service Worker Lifecycle.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
