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
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
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
    return { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/mp4', mkv: 'video/x-matroska' }[ext] || 'video/mp4';
}

// Handle SW messages.
self.addEventListener('message', async (e) => {
    const d = e.data;
    if (d.action === 'REGISTER') {
        const raw = hexToU8(d.fileKey);
        const cryptoKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
        raw.fill(0);
        regMap.set(d.filePid, {
            fldId: d.folderId,
            gIV: null,
            gIVPromise: null,
            cryptoKey,
            origSize: d.originalSize,
            mime: vidMime(d.fileName)
        });

        // ACK key stored.
        if (e.source) e.source.postMessage({ action: 'REGISTERED', filePid: d.filePid });
    } else if (d.action === 'UNREGISTER') {
        const info = regMap.get(d.filePid);
        if (info) { if (info.gIV) info.gIV.fill(0); }
        regMap.delete(d.filePid);
        cchPurg(d.filePid);
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
    e.respondWith(hndlStrm(e.request, m[1], m[2]));
});

async function hndlStrm(req, fldId, flPid) {
    const info = await getInfo(flPid);
    if (!info) return new Response('Not registered', { status: 404 });

    const { origSize, mime } = info;

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
    // Cap open-ended requests.
    if (openEnd && rEnd - rStart + 1 > MAX_RESPONSE) rEnd = rStart + MAX_RESPONSE - 1;
    rEnd = Math.min(rEnd, origSize - 1);
    if (rStart > rEnd || rStart >= origSize) {
        return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${origSize}` }
        });
    }

    // Get chunk indices.
    const firstIdx = Math.floor(rStart / PLAIN_CHUNK);
    const lastIdx = Math.floor(rEnd / PLAIN_CHUNK);

    const len = rEnd - rStart + 1;

    // Stream bytes with backpressure.
    let curIdx = firstIdx;
    const abortCtrl = new AbortController();
    const stream = new ReadableStream({
        async pull(ctrl) {
            if (curIdx > lastIdx) {
                ctrl.close();
                return;
            }
            try {
                let plnProm = cchGet(flPid, curIdx);
                if (!plnProm) {
                    // Cache promise to avoid dupes.
                    plnProm = fetchChk(info, fldId, flPid, curIdx, abortCtrl.signal).catch(err => {
                        // Remove failed promise from cache.
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
                    ctrl.enqueue(plain.subarray(from, to + 1));
                }
                curIdx++;
            } catch (err) {
                if (err.name === 'AbortError') {
                    console.log(`Stream cancelled, discarding chunk ${curIdx}`);
                } else {
                    console.error("Stream error:", err);
                    ctrl.error(err);
                }
            }
        },
        cancel(reason) {
            console.log(`Stream cancel requested: ${reason}`);
            abortCtrl.abort();
        }
    });

    return new Response(stream, {
        status: 206,
        headers: {
            'Content-Type': mime,
            'Content-Length': len.toString(),
            'Content-Range': `bytes ${rStart}-${rEnd}/${origSize}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
        }
    });
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
            // Abort instantly.
            if (err.name === 'AbortError') throw err;
            lastErr = err;
            console.warn(`Chunk ${chkIdx} fetch attempt ${attempt} failed:`, err);
            if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
    throw lastErr;
}

// Service Worker Lifecycle.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
