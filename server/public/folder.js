// MediaHub Folder Module
import { SHA3256, SymMaster, Random, Masker, HashMaster } from './Bencrypt.js';
import { EncodeCfg, DecodeCfg, EncodeInt, PadLen } from './Opsec.js';
import { NormPW } from './Bencode.js';
import { makeImg, makeVid } from './media.js';
import { makeToken, loadToken } from './storage.js';

const SERVER = window.location.origin;
const fromHex = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
const toHex = (buf) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
const getUserPid = async (key) => {
    return toHex(SHA3256(key).slice(0, 16));
};
const getObjPid = (key) => toHex(key.slice(32, 44));

const mask = new Masker();
const maskMap = (m) => { for (const k of Object.keys(m)) { const r = m[k]; m[k] = mask.XOR(r); r.fill(0); } };
const rawMap = (m) => { const c = {}; for (const [k, v] of Object.entries(m)) c[k] = mask.XOR(v); return c; };
const wipeMap = (m) => { for (const v of Object.values(m)) if (v?.fill) v.fill(0); };

const SECRET_PEPPER = "_PROJECT_WHY_MEDIAHUB_PEPPER_2026_!@#$";

// Load session.
let usrHsh = sessionStorage.getItem("userHash");
let usrKey = null;
{
    const raw = sessionStorage.getItem("userKey") ? fromHex(sessionStorage.getItem("userKey")) : null;
    if (raw) { usrKey = mask.XOR(raw); raw.fill(0); }
}
let state = { fldMap: {}, name: "", key: null, id: "", flsMap: {}, page: 1, limit: 30 };
if (!usrHsh || !usrKey) window.location.href = "./index.html";

// Read file chunks.
class FileSrc {
    constructor(file) { this.file = file; this.off = 0; }
    async read(size) {
        if (this.off >= this.file.size) return new Uint8Array(0);
        const chunk = this.file.slice(this.off, this.off + size);
        const buf = await chunk.arrayBuffer(); this.off += buf.byteLength;
        return new Uint8Array(buf);
    }
}

// Save map to server.
async function saveUsr() {
    const rawUK = mask.XOR(usrKey);
    const sm = new SymMaster("gcm1", rawUK);
    rawUK.fill(0);
    const um = rawMap(state.fldMap);
    const encoded = EncodeCfg(um);
    wipeMap(um);
    await fetch(`${SERVER}/api/userdata/${usrHsh}`, { method: "POST", body: await sm.EnBin(encoded) });
    encoded.fill(0);
}

// Load map from server.
async function loadUsr() {
    const res = await fetch(`${SERVER}/api/userdata/${usrHsh}`);
    if (res.status === 404) return;
    const rawUK = mask.XOR(usrKey);
    const sm = new SymMaster("gcm1", rawUK);
    rawUK.fill(0);
    const dec = await sm.DeBin(new Uint8Array(await res.arrayBuffer()));
    state.fldMap = DecodeCfg(dec);
    dec.fill(0);
    maskMap(state.fldMap);
    showFld();
}

// Render folder list.
function showFld() {
    const select = document.getElementById("folderSelect");
    select.innerHTML = '<option value="">-- Folder --</option>';
    Object.keys(state.fldMap).forEach(name => {
        const opt = document.createElement("option"); opt.value = name; opt.textContent = name; select.appendChild(opt);
    });
}

// Create new folder.
document.getElementById("btnCreateFolder").addEventListener("click", async () => {
    const name = document.getElementById("newFolderName").value.trim();
    if (!name || state.fldMap[name]) return alert("⚠️ Invalid name");
    const rk = new Uint8Array(44); rk.set(Random(32), 0); rk.set(Random(12), 32); state.fldMap[name] = mask.XOR(rk); rk.fill(0);
    await saveUsr(); showFld();
    document.getElementById("newFolderName").value = "";
});

// Export share token.
document.getElementById("btnExport").addEventListener("click", async () => {
    if (!state.name) return alert("⚠️ Select a folder");
    const token = await makeToken(state.name, state.key);
    if (!token) return;
    const blob = new Blob([token], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    const safeName = state.name.replace(/[\\/:*?"<>|]/g, "_");
    a.download = `${safeName}_share.txt`; a.click();
    URL.revokeObjectURL(url);
});

// Import share token.
document.getElementById("btnImport").addEventListener("click", () => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".txt";
    input.onchange = async () => {
        if (!input.files[0]) return;
        const info = await loadToken((await input.files[0].text()).trim());
        if (!info) return alert("❌ Invalid token");
        if (state.fldMap[info.name]) {
            if (!confirm("Overwrite existing?")) return;
            const oldRaw = mask.XOR(state.fldMap[info.name]);
            const oldFldId = getObjPid(oldRaw);
            oldRaw.fill(0);
            try {
                await fetch(`${SERVER}/api/storage/${oldFldId}/names`, { method: "DELETE", headers: { "X-User-Hash": usrHsh } });
            } catch (e) {
                console.warn("Failed to delete old folder storage", e);
            }
        }
        state.fldMap[info.name] = info.key;
        await saveUsr(); loadUsr();
    };
    input.click();
});

// Handle folder select.
document.getElementById("folderSelect").addEventListener("change", async (e) => {
    state.name = e.target.value; if (!state.name) return;
    state.key = state.fldMap[state.name];
    const rawK = mask.XOR(state.key); state.id = getObjPid(rawK); rawK.fill(0);
    state.page = 1;
    document.getElementById("btnDeleteFolder").classList.remove("hidden");
    await loadFld();
});

// Fetch folder files.
async function loadFld() {
    document.getElementById("uploadContainer").classList.remove("hidden");
    document.getElementById("mediaContainer").classList.remove("hidden");
    const res = await fetch(`${SERVER}/api/storage/${state.id}/names`);
    if (res.status === 404) state.flsMap = {};
    else {
        const rawK = mask.XOR(state.key);
        const sm = new SymMaster("gcm1", rawK.slice(0, 32));
        rawK.fill(0);
        const dec = await sm.DeBin(new Uint8Array(await res.arrayBuffer()));
        state.flsMap = DecodeCfg(dec);
        dec.fill(0);
        maskMap(state.flsMap);
    }
    await showFls();
}

// Render files grid.
async function showFls() {
    const grid = document.getElementById("mediaGrid"); grid.innerHTML = "";
    const entries = Object.entries(state.flsMap).sort((a, b) => a[0].localeCompare(b[0]));
    const total = Math.ceil(entries.length / state.limit) || 1;
    document.getElementById("pageIndicator").textContent = `${state.page} / ${total}`;

    // Save page state.
    sessionStorage.setItem("oldPage", state.page);

    const start = (state.page - 1) * state.limit;
    for (const [name, fileKey] of entries.slice(start, start + state.limit)) {
        const card = document.createElement("div"); card.className = "media-card";
        const img = document.createElement("img"); img.className = "thumb-img"; img.alt = "Loading...";
        const rawFK = mask.XOR(fileKey);
        const fkSlice = rawFK.slice(0, 44);
        loadThm(getObjPid(fkSlice), name.split('.').pop().toUpperCase(), img, fkSlice);
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
    }
}

// Fetch thumb file.
async function loadThm(filePid, ext, imgEl, fileKeyRaw) {
    const res = await fetch(`${SERVER}/api/media/${state.id}/${filePid}/thumb`);
    if (res.status === 404) {
        imgEl.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='%23333'><rect width='24' height='24' rx='2'/><text x='50%' y='60%' font-family='sans-serif' font-size='5' font-weight='bold' fill='%23aaa' text-anchor='middle'>" + ext + "</text></svg>";
        fileKeyRaw.fill(0);
        return;
    }
    const sm = new SymMaster("gcm1", fileKeyRaw.slice(0, 32));
    fileKeyRaw.fill(0);
    imgEl.src = URL.createObjectURL(new Blob([await sm.DeBin(new Uint8Array(await res.arrayBuffer()))]));
}

// Handle file upload.
document.getElementById("btnUpload").addEventListener("click", async () => {
    const fileIn = document.getElementById("fileInput");
    const btnUp = document.getElementById("btnUpload");
    const files = fileIn.files;
    if (files.length === 0) return alert("⚠️ Select files");

    fileIn.disabled = true;
    btnUp.disabled = true;
    const origTxt = btnUp.textContent;

    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (state.flsMap[file.name]) {
                if (!confirm(`⚠️ File "${file.name}" already exists. Overwrite?`)) {
                    continue;
                }
                const oldRaw = mask.XOR(state.flsMap[file.name]);
                const oldFlPid = getObjPid(oldRaw.slice(0, 44));
                oldRaw.fill(0);
                try {
                    await fetch(`${SERVER}/api/media/${state.id}/${oldFlPid}/dat`, { method: "DELETE" });
                    await fetch(`${SERVER}/api/media/${state.id}/${oldFlPid}/thumb`, { method: "DELETE" });
                } catch (e) {
                    console.warn("Failed to delete old file/thumbnail", e);
                }
            }
            btnUp.textContent = `🚀 ${i + 1}/${files.length}`;

            const fileKey = new Uint8Array(44); fileKey.set(Random(32), 0); fileKey.set(Random(12), 32); const filePid = getObjPid(fileKey);

            // Make thumb by type.
            let thumb = null;
            if (file.type.startsWith("image/")) thumb = await makeImg(file);
            else if (file.type.startsWith("video/")) thumb = await makeVid(file);

            // Encrypt file.
            const smx = new SymMaster("gcmx1", fileKey.slice(0, 32));
            const encChks = [];
            await smx.EnFile(new FileSrc(file), file.size, { write: async (c) => encChks.push(c) });

            const encSize = encChks.reduce((a, c) => a + c.length, 0);
            const padSize = PadLen(encSize);
            const totSize = encSize + padSize;
            let medBuf = new Uint8Array(totSize);
            let offset = 0;
            for (const c of encChks) { medBuf.set(c, offset); offset += c.length; }

            // Add random padding.
            if (padSize > 0) {
                let pOff = offset;
                const pEnd = offset + padSize;
                while (pOff < pEnd) {
                    const chunk = Math.min(32768, pEnd - pOff);
                    medBuf.set(Random(chunk), pOff);
                    pOff += chunk;
                }
            }

            await fetch(`${SERVER}/api/media/${state.id}/${filePid}/dat`, { method: "POST", headers: { "X-User-Hash": usrHsh }, body: medBuf });

            if (thumb) {
                const thmSm = new SymMaster("gcm1", fileKey.slice(0, 32));
                await fetch(`${SERVER}/api/media/${state.id}/${filePid}/thumb`, { method: "POST", headers: { "X-User-Hash": usrHsh }, body: await thmSm.EnBin(new Uint8Array(await thumb.arrayBuffer())) });
            }

            // Save key to map.
            const flInfo = new Uint8Array(52);
            flInfo.set(fileKey, 0);
            flInfo.set(EncodeInt(file.size, 8), 44);
            state.flsMap[file.name] = mask.XOR(flInfo);
            fileKey.fill(0);
            flInfo.fill(0);
        }

        // Sync metadata.
        btnUp.textContent = "🔄 Syncing...";
        const rawSK = mask.XOR(state.key);
        const metSm = new SymMaster("gcm1", rawSK.slice(0, 32));
        rawSK.fill(0);
        const um = rawMap(state.flsMap);
        const encoded = EncodeCfg(um);
        wipeMap(um);
        await fetch(`${SERVER}/api/storage/${state.id}/names`, { method: "POST", headers: { "X-User-Hash": usrHsh }, body: await metSm.EnBin(encoded) });
        encoded.fill(0);

        fileIn.value = "";
        await loadFld();
    } catch (err) {
        console.error(err);
        alert("❌ Upload error: " + err.message);
    } finally {
        fileIn.disabled = false;
        btnUp.disabled = false;
        btnUp.textContent = origTxt;
    }
});

// Delete folder.
document.getElementById("btnDeleteFolder").addEventListener("click", async () => {
    if (!confirm("Delete this folder?")) return;
    await fetch(`${SERVER}/api/storage/${state.id}/names`, { method: "DELETE", headers: { "X-User-Hash": usrHsh } });
    delete state.fldMap[state.name]; await saveUsr(); loadUsr();
    document.getElementById("uploadContainer").classList.add("hidden"); document.getElementById("mediaContainer").classList.add("hidden");
});

// Handle pagination.
document.getElementById("btnPrevPage").addEventListener("click", async () => { if (state.page > 1) { state.page--; await showFls(); } });
document.getElementById("btnNextPage").addEventListener("click", async () => { if (state.page < Math.ceil(Object.keys(state.flsMap).length / state.limit)) { state.page++; await showFls(); } });
document.getElementById("btnRefresh").addEventListener("click", () => { sessionStorage.removeItem("oldFold"); loadUsr(); });
document.getElementById("lblUserHash").textContent = usrHsh;

// Change Password
document.getElementById("btnConfirmPw").addEventListener("click", async () => {
    // get username and password
    const newPw = document.getElementById("newPassword").value;
    const confirmPw = document.getElementById("newPasswordConfirm").value;
    if (!newPw) return alert("⚠️ Enter new password");
    if (newPw !== confirmPw) return alert("⚠️ Passwords do not match");
    const username = sessionStorage.getItem("username");
    if (!username) return alert("⚠️ Session invalid (no username). Please login again.");

    const pwBytes = NormPW(newPw);
    const saltBytes = SHA3256(new TextEncoder().encode(username + SECRET_PEPPER));
    const hm = new HashMaster("arg2st");
    const [storeKey, newUserKeyRaw] = await hm.KDF(pwBytes, saltBytes);

    const newHash = await getUserPid(storeKey);
    const maskedNewKey = mask.XOR(newUserKeyRaw);
    newUserKeyRaw.fill(0);
    if (newHash === usrHsh) {
        return alert("⚠️ New password must be different");
    }

    const check = await fetch(`${SERVER}/api/userdata/${newHash}`);
    if (check.status !== 404) return alert("❌ User already exists with this password");

    // encrypt old folder
    const rawUK = mask.XOR(maskedNewKey);
    const sm = new SymMaster("gcm1", rawUK);
    rawUK.fill(0);
    const um = rawMap(state.fldMap);
    const encoded = EncodeCfg(um);
    wipeMap(um);

    const saveRes = await fetch(`${SERVER}/api/userdata/${newHash}`, {
        method: "POST",
        headers: { "X-Old-Hash": usrHsh },
        body: await sm.EnBin(encoded)
    });
    encoded.fill(0);
    if (!saveRes.ok) {
        return alert("❌ Failed to create new user");
    }

    await fetch(`${SERVER}/api/userdata/${usrHsh}`, { method: "DELETE" });

    // update session
    sessionStorage.setItem("userHash", newHash);
    sessionStorage.setItem("userKey", toHex(mask.XOR(maskedNewKey)));
    usrHsh = newHash;
    if (usrKey) mask.XOR(usrKey).fill(0);
    usrKey = maskedNewKey;

    document.getElementById("pwModal").close();
    document.getElementById("lblUserHash").textContent = usrHsh;
    alert("✅ Password changed successfully");
});

document.getElementById("btnCancelPw").addEventListener("click", () => {
    document.getElementById("pwModal").close();
});
document.getElementById("btnChangePassword").addEventListener("click", () => {
    document.getElementById("newPassword").value = "";
    document.getElementById("newPasswordConfirm").value = "";
    document.getElementById("pwModal").showModal();
});

// Restore session.
async function boot() {
    await loadUsr();
    const oldFold = sessionStorage.getItem("oldFold");
    const oldPage = sessionStorage.getItem("oldPage");
    if (oldFold && state.fldMap[oldFold]) {
        document.getElementById("folderSelect").value = oldFold;
        state.name = oldFold; state.key = state.fldMap[oldFold];
        const rawK = mask.XOR(state.key); state.id = getObjPid(rawK); rawK.fill(0);
        state.page = oldPage ? parseInt(oldPage, 10) : 1;
        document.getElementById("btnDeleteFolder").classList.remove("hidden");
        await loadFld();
    }
}
boot();