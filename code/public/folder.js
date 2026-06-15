// MediaHub Folder Module
import { SHA3256, SymMaster, Random, Masker } from './Bencrypt.js';
import { EncodeCfg, DecodeCfg } from './Opsec.js';
import { makeImg, makeVid } from './media.js';
import { makeToken, loadToken } from './storage.js';

const SERVER = window.location.origin;
const fromHex = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
const toHex = (buf) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
const getPid = (key) => toHex(SHA3256(key).slice(0, 16));

const mask = new Masker();
const maskMap = (m) => { for (const k of Object.keys(m)) { const r = m[k]; m[k] = mask.XOR(r); r.fill(0); } };
const rawMap = (m) => { const c = {}; for (const [k, v] of Object.entries(m)) c[k] = mask.XOR(v); return c; };
const wipeMap = (m) => { for (const v of Object.values(m)) if (v?.fill) v.fill(0); };

// load session
let userHash = sessionStorage.getItem("userHash");
let userKey = null;
{
    const raw = sessionStorage.getItem("userKey") ? fromHex(sessionStorage.getItem("userKey")) : null;
    if (raw) { userKey = mask.XOR(raw); raw.fill(0); }
}
let state = { folderMap: {}, name: "", key: null, id: "", fileMap: {}, page: 1, limit: 30 };
if (!userHash || !userKey) window.location.href = "./index.html";

// Chunked file reader for encryption
class FileSrc {
    constructor(file) { this.file = file; this.off = 0; }
    async read(size) {
        if (this.off >= this.file.size) return new Uint8Array(0);
        const chunk = this.file.slice(this.off, this.off + size);
        const buf = await chunk.arrayBuffer(); this.off += buf.byteLength;
        return new Uint8Array(buf);
    }
}

// Save user folder map
async function saveUser() {
    const rawUK = mask.XOR(userKey);
    const sm = new SymMaster("gcm1", rawUK);
    rawUK.fill(0);
    const um = rawMap(state.folderMap);
    const encoded = EncodeCfg(um);
    wipeMap(um);
    await fetch(`${SERVER}/api/userdata/${userHash}`, { method: "POST", body: await sm.EnBin(encoded) });
    encoded.fill(0);
}

// Load user folder map
async function loadUser() {
    const res = await fetch(`${SERVER}/api/userdata/${userHash}`);
    if (res.status === 404) return;
    const rawUK = mask.XOR(userKey);
    const sm = new SymMaster("gcm1", rawUK);
    rawUK.fill(0);
    const dec = await sm.DeBin(new Uint8Array(await res.arrayBuffer()));
    state.folderMap = DecodeCfg(dec);
    dec.fill(0);
    maskMap(state.folderMap);
    showFold();
}

// Render folder dropdown
function showFold() {
    const select = document.getElementById("folderSelect");
    select.innerHTML = '<option value="">-- Folder --</option>';
    Object.keys(state.folderMap).forEach(name => {
        const opt = document.createElement("option"); opt.value = name; opt.textContent = name; select.appendChild(opt);
    });
}

// --- Event: Create folder ---
document.getElementById("btnCreateFolder").addEventListener("click", async () => {
    const name = document.getElementById("newFolderName").value.trim();
    if (!name || state.folderMap[name]) return alert("⚠️ Invalid name");
    const rk = Random(44); state.folderMap[name] = mask.XOR(rk); rk.fill(0);
    await saveUser(); showFold();
    document.getElementById("newFolderName").value = "";
});

// --- Event: Export share token ---
document.getElementById("btnExport").addEventListener("click", async () => {
    if (!state.name) return alert("⚠️ Select a folder");
    const token = await makeToken(state.name, state.key);
    if (!token) return;
    const blob = new Blob([token], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `${state.name}_share.txt`; a.click();
    URL.revokeObjectURL(url);
});

// --- Event: Import share token ---
document.getElementById("btnImport").addEventListener("click", () => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".txt";
    input.onchange = async () => {
        if (!input.files[0]) return;
        const info = await loadToken((await input.files[0].text()).trim());
        if (!info) return alert("❌ Invalid token");
        if (state.folderMap[info.name]) {
            if (!confirm("Overwrite existing?")) return;
            const oldRaw = mask.XOR(state.folderMap[info.name]);
            const oldFolderId = getPid(oldRaw);
            oldRaw.fill(0);
            try {
                await fetch(`${SERVER}/api/storage/${oldFolderId}/names`, { method: "DELETE" });
            } catch (e) {
                console.warn("Failed to delete old folder storage", e);
            }
        }
        state.folderMap[info.name] = info.key;
        await saveUser(); loadUser();
    };
    input.click();
});

// --- Event: Folder select ---
document.getElementById("folderSelect").addEventListener("change", async (e) => {
    state.name = e.target.value; if (!state.name) return;
    state.key = state.folderMap[state.name];
    const rawK = mask.XOR(state.key); state.id = getPid(rawK); rawK.fill(0);
    state.page = 1;
    document.getElementById("btnDeleteFolder").classList.remove("hidden");
    await loadFold();
});

// Load folder file list
async function loadFold() {
    document.getElementById("uploadContainer").classList.remove("hidden");
    document.getElementById("mediaContainer").classList.remove("hidden");
    const res = await fetch(`${SERVER}/api/storage/${state.id}/names`);
    if (res.status === 404) state.fileMap = {};
    else {
        const rawK = mask.XOR(state.key);
        const sm = new SymMaster("gcm1", rawK);
        rawK.fill(0);
        const dec = await sm.DeBin(new Uint8Array(await res.arrayBuffer()));
        state.fileMap = DecodeCfg(dec);
        dec.fill(0);
        maskMap(state.fileMap);
    }
    showFiles();
}

// Render media grid with pagination
function showFiles() {
    const grid = document.getElementById("mediaGrid"); grid.innerHTML = "";
    const entries = Object.entries(state.fileMap);
    const total = Math.ceil(entries.length / state.limit) || 1;
    document.getElementById("pageIndicator").textContent = `${state.page} / ${total}`;

    // Persist page state for session restore
    sessionStorage.setItem("oldPage", state.page);

    const start = (state.page - 1) * state.limit;
    entries.slice(start, start + state.limit).forEach(([name, fileKey]) => {
        const card = document.createElement("div"); card.className = "media-card";
        const img = document.createElement("img"); img.className = "thumb-img"; img.alt = "Loading...";
        const rawFK = mask.XOR(fileKey);
        loadThumb(getPid(rawFK), name.split('.').pop().toUpperCase(), img);
        rawFK.fill(0);

        const title = document.createElement("div"); title.className = "file-title"; title.textContent = name;
        card.appendChild(img); card.appendChild(title);

        card.addEventListener("click", () => {
            const rFK = mask.XOR(fileKey);
            const rSK = mask.XOR(state.key);
            sessionStorage.setItem("currentFileKey", toHex(rFK));
            sessionStorage.setItem("currentFileName", name);
            sessionStorage.setItem("currentFolderId", state.id);
            sessionStorage.setItem("currentFolderKey", toHex(rSK));
            sessionStorage.setItem("oldFold", state.name);
            rFK.fill(0); rSK.fill(0);
            window.location.href = "./viewer.html";
        });
        grid.appendChild(card);
    });
}

// Load and decrypt thumbnail
async function loadThumb(filePid, ext, imgEl) {
    const res = await fetch(`${SERVER}/api/media/${state.id}/${filePid}/thumb`);
    if (res.status === 404) {
        imgEl.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='%23333'><rect width='24' height='24' rx='2'/><text x='50%' y='60%' font-family='sans-serif' font-size='5' font-weight='bold' fill='%23aaa' text-anchor='middle'>" + ext + "</text></svg>";
        return;
    }
    const rawK = mask.XOR(state.key);
    const sm = new SymMaster("gcm1", rawK);
    rawK.fill(0);
    imgEl.src = URL.createObjectURL(new Blob([await sm.DeBin(new Uint8Array(await res.arrayBuffer()))]));
}

// --- Event: Upload files ---
document.getElementById("btnUpload").addEventListener("click", async () => {
    const fileInput = document.getElementById("fileInput");
    const btnUpload = document.getElementById("btnUpload");
    const files = fileInput.files;
    if (files.length === 0) return alert("⚠️ Select files");

    fileInput.disabled = true;
    btnUpload.disabled = true;
    const origText = btnUpload.textContent;

    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (state.fileMap[file.name]) {
                if (!confirm(`⚠️ File "${file.name}" already exists. Overwrite?`)) {
                    continue;
                }
                const oldRaw = mask.XOR(state.fileMap[file.name]);
                const oldFilePid = getPid(oldRaw);
                oldRaw.fill(0);
                try {
                    await fetch(`${SERVER}/api/media/${state.id}/${oldFilePid}/dat`, { method: "DELETE" });
                    await fetch(`${SERVER}/api/media/${state.id}/${oldFilePid}/thumb`, { method: "DELETE" });
                } catch (e) {
                    console.warn("Failed to delete old file/thumbnail", e);
                }
            }
            btnUpload.textContent = `🚀 ${i + 1}/${files.length}`;

            const fileKey = Random(44); const filePid = getPid(fileKey);

            // Auto-generate thumbnail by type
            let thumb = null;
            if (file.type.startsWith("image/")) thumb = await makeImg(file);
            else if (file.type.startsWith("video/")) thumb = await makeVid(file);

            // Encrypt file
            const smx = new SymMaster("gcmx1", fileKey);
            const chunks = [];
            await smx.EnFile(new FileSrc(file), file.size, { write: async (c) => chunks.push(c) });

            let mediaBuf = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0)); let offset = 0;
            for (const c of chunks) { mediaBuf.set(c, offset); offset += c.length; }

            await fetch(`${SERVER}/api/media/${state.id}/${filePid}/dat`, { method: "POST", body: mediaBuf });

            if (thumb) {
                const rawSK = mask.XOR(state.key);
                const folderSm = new SymMaster("gcm1", rawSK);
                rawSK.fill(0);
                await fetch(`${SERVER}/api/media/${state.id}/${filePid}/thumb`, { method: "POST", body: await folderSm.EnBin(new Uint8Array(await thumb.arrayBuffer())) });
            }

            state.fileMap[file.name] = mask.XOR(fileKey);
            fileKey.fill(0);
        }

        // Sync metadata
        btnUpload.textContent = "🔄 Syncing...";
        const rawSK = mask.XOR(state.key);
        const metaSm = new SymMaster("gcm1", rawSK);
        rawSK.fill(0);
        const um = rawMap(state.fileMap);
        const encoded = EncodeCfg(um);
        wipeMap(um);
        await fetch(`${SERVER}/api/storage/${state.id}/names`, { method: "POST", body: await metaSm.EnBin(encoded) });
        encoded.fill(0);

        fileInput.value = "";
        await loadFold();
    } catch (err) {
        console.error(err);
        alert("❌ Upload error: " + err.message);
    } finally {
        fileInput.disabled = false;
        btnUpload.disabled = false;
        btnUpload.textContent = origText;
    }
});

// --- Event: Delete folder ---
document.getElementById("btnDeleteFolder").addEventListener("click", async () => {
    if (!confirm("Delete this folder?")) return;
    await fetch(`${SERVER}/api/storage/${state.id}/names`, { method: "DELETE" });
    delete state.folderMap[state.name]; await saveUser(); loadUser();
    document.getElementById("uploadContainer").classList.add("hidden"); document.getElementById("mediaContainer").classList.add("hidden");
});

// --- Events: Pagination & sync ---
document.getElementById("btnPrevPage").addEventListener("click", () => { if (state.page > 1) { state.page--; showFiles(); } });
document.getElementById("btnNextPage").addEventListener("click", () => { if (state.page < Math.ceil(Object.keys(state.fileMap).length / state.limit)) { state.page++; showFiles(); } });
document.getElementById("btnRefresh").addEventListener("click", () => { sessionStorage.removeItem("oldFold"); loadUser(); });
document.getElementById("lblUserHash").textContent = userHash;

// Session restore on return
async function boot() {
    await loadUser();
    const oldFold = sessionStorage.getItem("oldFold");
    const oldPage = sessionStorage.getItem("oldPage");
    if (oldFold && state.folderMap[oldFold]) {
        document.getElementById("folderSelect").value = oldFold;
        state.name = oldFold; state.key = state.folderMap[oldFold];
        const rawK = mask.XOR(state.key); state.id = getPid(rawK); rawK.fill(0);
        state.page = oldPage ? parseInt(oldPage, 10) : 1;
        document.getElementById("btnDeleteFolder").classList.remove("hidden");
        await loadFold();
    }
}
boot();