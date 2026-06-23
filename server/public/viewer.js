// MediaHub Viewer Module
import { SymMaster, Masker, HashMaster } from './Bencrypt.js';
import { EncodeCfg, DecodeCfg, DecodeInt, EncodeInt } from './Opsec.js';
import { NetSrc } from './media.js';
const mask = new Masker();

// Option: Disable ServiceWorker for WebKit (Safari).
const OPT_NOSW_WEBKIT = true;

const SERVER = window.location.origin;
const fromHex = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
const toHex = (buf) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
const getObjPid = (key) => toHex(key.slice(32, 44));

// Get folder and file keys from session storage.
let fldId = sessionStorage.getItem("currentFolderId");
let fldKey = null;
let flKey = null;
let origSize = 0;
{
    const rawFK = sessionStorage.getItem("currentFolderKey") ? fromHex(sessionStorage.getItem("currentFolderKey")) : null;
    const rawFlK = sessionStorage.getItem("currentFileKey") ? fromHex(sessionStorage.getItem("currentFileKey")) : null;
    if (rawFK) { fldKey = mask.XOR(rawFK); rawFK.fill(0); }
    if (rawFlK) {
        origSize = DecodeInt(rawFlK.slice(44, 52));
        const keyPrt = rawFlK.slice(0, 44);
        flKey = mask.XOR(keyPrt);
        keyPrt.fill(0);
        rawFlK.fill(0);
    }
}
let flName = sessionStorage.getItem("currentFileName");
let rawBuf = null;

if (!flKey || !flName || !fldId || !fldKey) window.location.href = "./folder.html";
document.getElementById("txName").value = flName;

// Get media type by ext.
function getKind(name) {
    const ext = name.split('.').pop().toLowerCase();
    if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return 'video';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
    if (['pdf'].includes(ext)) return 'pdf';
    return 'text';
}

function getMime(name) {
    const ext = name.split('.').pop().toLowerCase();
    return ext === 'pdf' ? 'application/pdf' : 'image/jpeg';
}

// Load and render file.
async function start() {
    const rawFK = mask.XOR(flKey);
    const flPid = getObjPid(rawFK);
    rawFK.fill(0);
    const body = document.getElementById("viewBody");
    const kind = getKind(flName);

    // Video: Stream via SW.
    if (kind === 'video') {
        const isWebkit = /AppleWebKit/i.test(navigator.userAgent) && (!/Chrome/i.test(navigator.userAgent) || /CriOS/i.test(navigator.userAgent));
        if (OPT_NOSW_WEBKIT && isWebkit) {
            console.log("WebKit detected. Fallback to full down.");
            await fullDown(flPid, body);
            return;
        }

        body.innerHTML = '<p style="color:#666;font-size:12px;margin:20px 0">Preparing stream…</p>';
        try {
            await navigator.serviceWorker.register('./sw.js');
            const reg = await navigator.serviceWorker.ready;

            const rawKey = mask.XOR(flKey);
            const keyHex = toHex(rawKey);
            rawKey.fill(0);

            // Wait for SW ready ACK.
            const ack = new Promise(resolve => {
                const h = (e) => {
                    if (e.data?.action === 'REGISTERED' && e.data.filePid === flPid) {
                        navigator.serviceWorker.removeEventListener('message', h);
                        resolve();
                    }
                };
                navigator.serviceWorker.addEventListener('message', h);
            });

            // Handle SW key request.
            navigator.serviceWorker.addEventListener('message', (e) => {
                if (e.data?.action === 'REQUEST_KEY' && e.data.filePid === flPid) {
                    const rk = mask.XOR(flKey);
                    reg.active.postMessage({
                        action: 'REGISTER', folderId: fldId, filePid: flPid, fileKey: toHex(rk), originalSize: origSize, fileName: flName
                    });
                    rk.fill(0);
                }
            });

            reg.active.postMessage({
                action: 'REGISTER',
                folderId: fldId,
                filePid: flPid,
                fileKey: keyHex,
                originalSize: origSize,
                fileName: flName
            });
            await ack;

            // Set virtual video source.
            body.innerHTML = '';
            const v = document.createElement('video');
            v.controls = true;
            v.style.width = '100%';
            v.src = `/sw-stream/${fldId}/${flPid}`;
            body.appendChild(v);
        } catch (err) {
            console.warn('SW streaming failed', err);
            await fullDown(flPid, body);
        }
        return;
    }

    // Non-video: Download and decrypt.
    await fullDown(flPid, body);
}

// Download file directly.
async function fullDown(flPid, body) {
    // Get total file size.
    const head = await fetch(`${SERVER}/api/media/${fldId}/${flPid}/dat`, {
        headers: { 'Range': 'bytes=0-0' }
    });
    const totSize = parseInt(head.headers.get("Content-Range").split('/')[1], 10);

    let loaded = 0;
    const chunks = [];
    const prog = document.createElement("div");
    prog.style.position = "fixed"; prog.style.top = "50%"; prog.style.width = "100%"; prog.style.textAlign = "center";
    body.appendChild(prog);

    // Download loop.
    while (loaded < totSize) {
        try {
            const res = await fetch(`${SERVER}/api/media/${fldId}/${flPid}/dat`, {
                headers: { 'Range': `bytes=${loaded}-${totSize - 1}` }
            });
            const reader = res.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loaded += value.length;
                prog.textContent = `📥 ${Math.round((loaded / totSize) * 100)}%`;
            }
        } catch (e) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Decrypt chunks.
    prog.textContent = "🔒 Decrypting...";
    const fullBuf = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) { fullBuf.set(c, offset); offset += c.length; }

    // Get exact cipher size.
    const rawFK2 = mask.XOR(flKey);
    const smx = new SymMaster("gcmx1", rawFK2.slice(0, 32));
    rawFK2.fill(0);
    const ciphSize = smx.AfterSize(origSize);

    // Extract cipher without padding.
    const encBuf = fullBuf.slice(0, ciphSize);

    const plnChks = [];
    await smx.DeFile(new NetSrc(encBuf), encBuf.length, { write: async (c) => plnChks.push(c) });
    rawBuf = new Uint8Array(plnChks.reduce((a, c) => a + c.length, 0));
    let fOff = 0;
    for (const c of plnChks) { rawBuf.set(c, fOff); fOff += c.length; }

    body.removeChild(prog);
    render(rawBuf, body);
}

// Rename current file.
async function editNm() {
    const newNm = document.getElementById("txName").value.trim();
    if (!newNm || newNm === flName) return;
    try {
        const res = await fetch(`${SERVER}/api/storage/${fldId}/names`);
        const rawSK = mask.XOR(fldKey);
        const sm = new SymMaster("gcm1", rawSK.slice(0, 32));
        rawSK.fill(0);
        const dec = await sm.DeBin(new Uint8Array(await res.arrayBuffer()));
        const flsMap = DecodeCfg(dec);
        dec.fill(0);
        const rawFK = mask.XOR(flKey);
        // Build new map info.
        const flInfo = new Uint8Array(52);
        flInfo.set(rawFK, 0);
        flInfo.set(EncodeInt(origSize, 8), 44);
        flsMap[newNm] = flInfo; delete flsMap[flName];
        const encoded = EncodeCfg(flsMap);
        for (const v of Object.values(flsMap)) if (v?.fill) v.fill(0);
        await fetch(`${SERVER}/api/storage/${fldId}/names`, { method: "POST", body: await sm.EnBin(encoded) });
        encoded.fill(0);
        sessionStorage.setItem("currentFileName", newNm); flName = newNm; alert("✅ Renamed");
    } catch (e) { alert("❌ Rename failed"); }
}

// Save decrypted file.
async function downFl() {
    const kind = getKind(flName);
    // Full download for video save.
    if (kind === 'video' && !rawBuf) {
        const rawFK = mask.XOR(flKey);
        const flPid = getObjPid(rawFK);
        rawFK.fill(0);
        const body = document.getElementById("viewBody");
        const prog = document.createElement('div');
        prog.style.cssText = 'position:fixed;top:50%;width:100%;text-align:center;z-index:999;background:rgba(0,0,0,0.7);padding:10px';
        body.appendChild(prog);
        prog.textContent = '📥 Downloading for save…';
        try {
            // Download inline.
            const head = await fetch(`${SERVER}/api/media/${fldId}/${flPid}/dat`, { headers: { 'Range': 'bytes=0-0' } });
            const totSize = parseInt(head.headers.get('Content-Range').split('/')[1], 10);
            let loaded = 0; const chunks = [];
            while (loaded < totSize) {
                const res = await fetch(`${SERVER}/api/media/${fldId}/${flPid}/dat`, { headers: { 'Range': `bytes=${loaded}-${totSize - 1}` } });
                const reader = res.body.getReader();
                while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); loaded += value.length; prog.textContent = `📥 ${Math.round((loaded / totSize) * 100)}%`; }
            }
            prog.textContent = '🔒 Decrypting…';
            const fullBuf = new Uint8Array(loaded); let off = 0;
            for (const c of chunks) { fullBuf.set(c, off); off += c.length; }
            const rawFK2 = mask.XOR(flKey);
            const smx = new SymMaster('gcmx1', rawFK2.slice(0, 32)); rawFK2.fill(0);
            const ciphSize = smx.AfterSize(origSize);
            const encBuf = fullBuf.slice(0, ciphSize);
            const plain = []; await smx.DeFile(new NetSrc(encBuf), encBuf.length, { write: async (c) => plain.push(c) });
            rawBuf = new Uint8Array(plain.reduce((a, c) => a + c.length, 0)); let fo = 0;
            for (const c of plain) { rawBuf.set(c, fo); fo += c.length; }
        } catch (e) { body.removeChild(prog); return alert('❌ Download failed'); }
        body.removeChild(prog);
    }
    if (!rawBuf) return alert('⚠️ Wait for decryption');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rawBuf], { type: getMime(flName) }));
    a.download = flName; a.click();
}

// Delete file and metadata.
async function delFl() {
    if (!confirm("Delete this file?")) return;
    try {
        const rawFK = mask.XOR(flKey);
        const flPid = getObjPid(rawFK);
        rawFK.fill(0);
        await fetch(`${SERVER}/api/media/${fldId}/${flPid}/dat`, { method: "DELETE" });
        await fetch(`${SERVER}/api/media/${fldId}/${flPid}/thumb`, { method: "DELETE" });
        const res = await fetch(`${SERVER}/api/storage/${fldId}/names`);
        const rawSK = mask.XOR(fldKey);
        const sm = new SymMaster("gcm1", rawSK.slice(0, 32));
        rawSK.fill(0);
        const dec = await sm.DeBin(new Uint8Array(await res.arrayBuffer()));
        const flsMap = DecodeCfg(dec);
        dec.fill(0);
        if (flsMap[flName]?.fill) flsMap[flName].fill(0);
        delete flsMap[flName];
        const encoded = EncodeCfg(flsMap);
        for (const v of Object.values(flsMap)) if (v?.fill) v.fill(0);
        await fetch(`${SERVER}/api/storage/${fldId}/names`, { method: "POST", body: await sm.EnBin(encoded) });
        encoded.fill(0);
        window.location.href = "./folder.html";
    } catch (e) { alert("❌ Delete failed"); }
}

// Render decrypted content.
function render(buf, body) {
    const url = URL.createObjectURL(new Blob([buf], { type: getMime(flName) }));
    const kind = getKind(flName);
    body.innerHTML = "";
    if (kind === 'video') { const v = document.createElement("video"); v.controls = true; v.src = url; v.style.width = "100%"; body.appendChild(v); }
    else if (kind === 'image') { const i = document.createElement("img"); i.src = url; i.style.width = "100%"; body.appendChild(i); }
    else if (kind === 'pdf') { const f = document.createElement("iframe"); f.src = url; f.style.width = "100%"; f.style.height = "90vh"; body.appendChild(f); }
    else { const t = document.createElement("textarea"); t.value = new TextDecoder().decode(buf); t.style.width = "100%"; t.style.height = "90vh"; body.appendChild(t); }
}

document.getElementById("btnEdit").addEventListener("click", editNm);
document.getElementById("btnDown").addEventListener("click", downFl);
document.getElementById("btnDelete").addEventListener("click", delFl);

// Setup prev/next navigation.
async function setNav() {
    try {
        const res = await fetch(`${SERVER}/api/storage/${fldId}/names`);
        if (res.status === 404) return;
        const rawSK = mask.XOR(fldKey);
        const sm = new SymMaster("gcm1", rawSK.slice(0, 32));
        rawSK.fill(0);
        const dec = await sm.DeBin(new Uint8Array(await res.arrayBuffer()));
        const flsMap = DecodeCfg(dec);
        dec.fill(0);
        const entries = Object.entries(flsMap);
        const idx = entries.findIndex(([name]) => name === flName);
        if (idx === -1) { for (const [, v] of entries) if (v?.fill) v.fill(0); return; }

        if (idx > 0) {
            const [prevNm, prevKy] = entries[idx - 1];
            const prevHx = toHex(prevKy);
            const btnPrv = document.getElementById("btnPrevFile");
            btnPrv.classList.remove("hidden");
            btnPrv.onclick = () => {
                sessionStorage.setItem("currentFileName", prevNm);
                sessionStorage.setItem("currentFileKey", prevHx);
                window.location.reload();
            };
        }
        if (idx < entries.length - 1) {
            const [nxtNm, nxtKy] = entries[idx + 1];
            const nxtHx = toHex(nxtKy);
            const btnNxt = document.getElementById("btnNextFile");
            btnNxt.classList.remove("hidden");
            btnNxt.onclick = () => {
                sessionStorage.setItem("currentFileName", nxtNm);
                sessionStorage.setItem("currentFileKey", nxtHx);
                window.location.reload();
            };
        }
        // Wipe keys from memory.
        for (const [, v] of entries) if (v?.fill) v.fill(0);
    } catch (e) {
        console.error(e);
    }
}

start();
setNav();