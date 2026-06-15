// MediaHub Viewer Module
import { SymMaster, SHA3256, Masker } from './Bencrypt.js';
import { EncodeCfg, DecodeCfg } from './Opsec.js';
import { NetSrc } from './media.js';
const mask = new Masker();

const SERVER = window.location.origin;
const fromHex = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
const toHex = (buf) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');

let folderId = sessionStorage.getItem("currentFolderId");
let folderKey = null;
let fileKey = null;
{
    const rawFK = sessionStorage.getItem("currentFolderKey") ? fromHex(sessionStorage.getItem("currentFolderKey")) : null;
    const rawFileK = sessionStorage.getItem("currentFileKey") ? fromHex(sessionStorage.getItem("currentFileKey")) : null;
    if (rawFK) { folderKey = mask.XOR(rawFK); rawFK.fill(0); }
    if (rawFileK) { fileKey = mask.XOR(rawFileK); rawFileK.fill(0); }
}
let fileName = sessionStorage.getItem("currentFileName");
let rawBuf = null;

if (!fileKey || !fileName || !folderId || !folderKey) window.location.href = "./folder.html";
document.getElementById("txName").value = fileName;

// Detect media type by extension
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

// Download, decrypt, and render file
async function start() {
    const rawFK = mask.XOR(fileKey);
    const filePid = toHex(SHA3256(rawFK).slice(0, 16));
    rawFK.fill(0);
    const body = document.getElementById("viewBody");

    // Get total size via Range header
    const head = await fetch(`${SERVER}/api/media/${folderId}/${filePid}/dat`, {
        headers: { 'Range': 'bytes=0-0' }
    });
    const totalSize = parseInt(head.headers.get("Content-Range").split('/')[1], 10);

    let loaded = 0;
    const chunks = [];
    const prog = document.createElement("div");
    prog.style.position = "fixed"; prog.style.top = "50%"; prog.style.width = "100%"; prog.style.textAlign = "center";
    body.appendChild(prog);

    // Resumable download loop
    while (loaded < totalSize) {
        try {
            const res = await fetch(`${SERVER}/api/media/${folderId}/${filePid}/dat`, {
                headers: { 'Range': `bytes=${loaded}-${totalSize - 1}` }
            });
            const reader = res.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loaded += value.length;
                prog.textContent = `📥 ${Math.round((loaded / totalSize) * 100)}%`;
            }
        } catch (e) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Decrypt
    prog.textContent = "🔒 Decrypting...";
    const encBuf = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) { encBuf.set(c, offset); offset += c.length; }

    const rawFK2 = mask.XOR(fileKey);
    const plainChunks = [];
    const smx = new SymMaster("gcmx1", rawFK2);
    rawFK2.fill(0);
    await smx.DeFile(new NetSrc(encBuf), encBuf.length, { write: async (c) => plainChunks.push(c) });
    rawBuf = new Uint8Array(plainChunks.reduce((a, c) => a + c.length, 0));
    let fOff = 0;
    for (const c of plainChunks) { rawBuf.set(c, fOff); fOff += c.length; }

    body.removeChild(prog);
    render(rawBuf, body);
}

// Rename file in folder metadata
async function editName() {
    const newName = document.getElementById("txName").value.trim();
    if (!newName || newName === fileName) return;
    try {
        const res = await fetch(`${SERVER}/api/storage/${folderId}/names`);
        const rawSK = mask.XOR(folderKey);
        const sm = new SymMaster("gcm1", rawSK);
        rawSK.fill(0);
        const dec = await sm.DeBin(new Uint8Array(await res.arrayBuffer()));
        const fileMap = DecodeCfg(dec);
        dec.fill(0);
        const rawFK = mask.XOR(fileKey);
        fileMap[newName] = rawFK; delete fileMap[fileName];
        const encoded = EncodeCfg(fileMap);
        for (const v of Object.values(fileMap)) if (v?.fill) v.fill(0);
        await fetch(`${SERVER}/api/storage/${folderId}/names`, { method: "POST", body: await sm.EnBin(encoded) });
        encoded.fill(0);
        sessionStorage.setItem("currentFileName", newName); fileName = newName; alert("✅ Renamed");
    } catch (e) { alert("❌ Rename failed"); }
}

// Download decrypted file
async function downFile() {
    if (!rawBuf) return alert("⚠️ Wait for decryption");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rawBuf], { type: getMime(fileName) }));
    a.download = fileName; a.click();
}

// Delete file from server and metadata
async function delFile() {
    if (!confirm("Delete this file?")) return;
    try {
        const rawFK = mask.XOR(fileKey);
        const filePid = toHex(SHA3256(rawFK).slice(0, 16));
        rawFK.fill(0);
        await fetch(`${SERVER}/api/media/${folderId}/${filePid}/dat`, { method: "DELETE" });
        await fetch(`${SERVER}/api/media/${folderId}/${filePid}/thumb`, { method: "DELETE" });
        const res = await fetch(`${SERVER}/api/storage/${folderId}/names`);
        const rawSK = mask.XOR(folderKey);
        const sm = new SymMaster("gcm1", rawSK);
        rawSK.fill(0);
        const dec = await sm.DeBin(new Uint8Array(await res.arrayBuffer()));
        const fileMap = DecodeCfg(dec);
        dec.fill(0);
        if (fileMap[fileName]?.fill) fileMap[fileName].fill(0);
        delete fileMap[fileName];
        const encoded = EncodeCfg(fileMap);
        for (const v of Object.values(fileMap)) if (v?.fill) v.fill(0);
        await fetch(`${SERVER}/api/storage/${folderId}/names`, { method: "POST", body: await sm.EnBin(encoded) });
        encoded.fill(0);
        window.location.href = "./folder.html";
    } catch (e) { alert("❌ Delete failed"); }
}

// Render media content to DOM
function render(buf, body) {
    const url = URL.createObjectURL(new Blob([buf], { type: getMime(fileName) }));
    const kind = getKind(fileName);
    body.innerHTML = "";
    if (kind === 'video') { const v = document.createElement("video"); v.controls = true; v.src = url; v.style.width = "100%"; body.appendChild(v); }
    else if (kind === 'image') { const i = document.createElement("img"); i.src = url; i.style.width = "100%"; body.appendChild(i); }
    else if (kind === 'pdf') { const f = document.createElement("iframe"); f.src = url; f.style.width = "100%"; f.style.height = "90vh"; body.appendChild(f); }
    else { const t = document.createElement("textarea"); t.value = new TextDecoder().decode(buf); t.style.width = "100%"; t.style.height = "90vh"; body.appendChild(t); }
}

document.getElementById("btnEdit").addEventListener("click", editName);
document.getElementById("btnDown").addEventListener("click", downFile);
document.getElementById("btnDelete").addEventListener("click", delFile);

// Setup prev/next file navigation
async function setupNav() {
    try {
        const res = await fetch(`${SERVER}/api/storage/${folderId}/names`);
        if (res.status === 404) return;
        const rawSK = mask.XOR(folderKey);
        const sm = new SymMaster("gcm1", rawSK);
        rawSK.fill(0);
        const dec = await sm.DeBin(new Uint8Array(await res.arrayBuffer()));
        const fileMap = DecodeCfg(dec);
        dec.fill(0);
        const entries = Object.entries(fileMap);
        const idx = entries.findIndex(([name]) => name === fileName);
        if (idx === -1) { for (const [,v] of entries) if (v?.fill) v.fill(0); return; }

        if (idx > 0) {
            const [prevName, prevKey] = entries[idx - 1];
            const prevHex = toHex(prevKey);
            const btnPrev = document.getElementById("btnPrevFile");
            btnPrev.classList.remove("hidden");
            btnPrev.onclick = () => {
                sessionStorage.setItem("currentFileName", prevName);
                sessionStorage.setItem("currentFileKey", prevHex);
                window.location.reload();
            };
        }
        if (idx < entries.length - 1) {
            const [nextName, nextKey] = entries[idx + 1];
            const nextHex = toHex(nextKey);
            const btnNext = document.getElementById("btnNextFile");
            btnNext.classList.remove("hidden");
            btnNext.onclick = () => {
                sessionStorage.setItem("currentFileName", nextName);
                sessionStorage.setItem("currentFileKey", nextHex);
                window.location.reload();
            };
        }
        // Wipe all raw keys from decoded fileMap
        for (const [,v] of entries) if (v?.fill) v.fill(0);
    } catch (e) {
        console.error(e);
    }
}

start();
setupNav();