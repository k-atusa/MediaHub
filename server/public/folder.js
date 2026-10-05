// MediaHub Folder Module
import { SHA3256, SymMaster, Random, Masker, HashMaster } from './Bencrypt.js';
import { EncodeCfg, DecodeCfg, EncodeInt, DecodeInt, PadLen } from './Opsec.js';
import { NormPW } from './Bencode.js';
import { makeImg, makeVid, NetSrc } from './media.js';
import { makeToken, loadToken } from './storage.js';
import { SafeSession } from './session.js';

await SafeSession.init();

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
let usrHsh = SafeSession.getItem("userHash");
let usrKey = null;
{
    const raw = SafeSession.getItem("userKey") ? fromHex(SafeSession.getItem("userKey")) : null;
    if (raw) { usrKey = mask.XOR(raw); raw.fill(0); }
}
let state = { fldMap: {}, name: "", key: null, id: "", flsMap: {}, page: 1, limit: 30, sort: localStorage.getItem("mediahub_sort") || "name-asc" };
if (!usrHsh || !usrKey) {
    const query = window.location.search || window.location.hash;
    if (query) {
        SafeSession.setItem("redirectAfterLogin", window.location.href);
    }
    await SafeSession.navigate("./index.html");
}

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
const saveUsr = async () => {
    const rawUK = mask.XOR(usrKey);
    const sm = new SymMaster("gcm1", rawUK);
    rawUK.fill(0);
    const um = rawMap(state.fldMap);
    const encoded = EncodeCfg(um);
    wipeMap(um);
    const res = await fetch(`${SERVER}/api/userdata/${usrHsh}`, { method: "POST", body: await sm.EnBin(encoded) });
    encoded.fill(0);
    if (!res.ok) {
        throw new Error(`Failed to save userdata to server (HTTP ${res.status})`);
    }
}

// No-op for backward compatibility
window.syncCanonicalFolderNames = () => { };

// Load map from server.
const loadUsr = async () => {
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
const showFld = () => {
    const select = document.getElementById("folderSelect");
    select.innerHTML = '<option value="">-- Folder --</option>';
    Object.keys(state.fldMap).forEach(name => {
        const opt = document.createElement("option"); opt.value = name; opt.textContent = name; select.appendChild(opt);
    });
    if (state.name && state.fldMap[state.name]) {
        select.value = state.name;
    }
    if (window.syncSidebarFolderList) window.syncSidebarFolderList();
    if (window.syncRootFolderGrid) window.syncRootFolderGrid();
    if (window.updateFolderDisplay) window.updateFolderDisplay();
}

// Create new folder.
document.getElementById("btnCreateFolder").addEventListener("click", async () => {
    const name = document.getElementById("newFolderName").value.trim();
    if (!name || state.fldMap[name]) return alert("⚠️ Invalid name");
    const rk = new Uint8Array(44); rk.set(Random(32), 0); rk.set(Random(12), 32);
    const maskedKey = mask.XOR(rk);
    rk.fill(0);
    state.fldMap[name] = maskedKey;
    await saveUsr(); showFld();
    document.getElementById("newFolderName").value = "";
});

// Rename folder implementation
const doRenameFolder = async (rawOldName, rawNewName) => {
    const oldName = (rawOldName || "").trim();
    const newName = (rawNewName || "").trim();

    if (!oldName || !newName) {
        throw new Error("Folder name cannot be empty.");
    }
    if (oldName.normalize('NFC') === newName.normalize('NFC')) {
        return;
    }

    // Match original folder in state.fldMap using exact or NFC-normalized comparison
    let actualOldKey = oldName;
    if (!state.fldMap[actualOldKey]) {
        const found = Object.keys(state.fldMap).find(k => k.normalize('NFC') === oldName.normalize('NFC'));
        if (found) {
            actualOldKey = found;
        } else {
            throw new Error(`Original folder "${oldName}" not found.`);
        }
    }

    // Check if new name already exists
    const duplicate = Object.keys(state.fldMap).find(k => k.normalize('NFC') === newName.normalize('NFC') && k !== actualOldKey);
    if (duplicate) {
        throw new Error(`A folder named "${newName}" already exists.`);
    }

    const origFldMap = { ...state.fldMap };
    const origStateName = state.name;

    try {
        const maskedKey = state.fldMap[actualOldKey];

        // Folder rename operates locally in user's userdata map
        state.fldMap[newName] = maskedKey;
        delete state.fldMap[actualOldKey];

        const isActiveFolder = (state.name === actualOldKey || (state.name && state.name.normalize('NFC') === actualOldKey.normalize('NFC')));
        if (isActiveFolder) {
            state.name = newName;
            SafeSession.setItem("oldFold", newName);
        }

        await saveUsr();
        showFld();

        if (isActiveFolder) {
            const select = document.getElementById("folderSelect");
            if (select) select.value = newName;
        } else if (state.name && state.fldMap[state.name]) {
            const select = document.getElementById("folderSelect");
            if (select) select.value = state.name;
        }

        if (window.syncSidebarFolderList) window.syncSidebarFolderList();
        if (window.syncRootFolderGrid) window.syncRootFolderGrid();
        if (window.updateFolderDisplay) window.updateFolderDisplay();

        if (window.showNotice) {
            window.showNotice(`✅ Folder renamed to "${newName}"`, "Success", "check_circle");
        }
    } catch (err) {
        console.error("Failed to rename folder:", err);
        state.fldMap = origFldMap;
        state.name = origStateName;
        if (state.name === actualOldKey) {
            SafeSession.setItem("oldFold", actualOldKey);
        }
        showFld();
        throw err;
    }
}
window.renameFolder = doRenameFolder;

// Rename folder button listener (compatibility)
const btnRenameFolder = document.getElementById("btnRenameFolder");
if (btnRenameFolder) {
    btnRenameFolder.addEventListener("click", async () => {
        const oldName = (document.getElementById("renameOldFolderName").value || "").trim();
        const newName = (document.getElementById("renameNewFolderName").value || "").trim();
        try {
            await doRenameFolder(oldName, newName);
        } catch (err) {
            if (window.showNotice) window.showNotice("❌ " + err.message, "Error", "error");
            else alert("❌ " + err.message);
        }
    });
}

const promptSharePassword = () => {
    return new Promise((resolve) => {
        const modal = document.getElementById("importShareModal");
        if (!modal) {
            const pw = prompt("Enter share password:");
            return resolve(pw);
        }
        const pwInput = document.getElementById("importPasswordInput");
        const btnConfirm = document.getElementById("btnConfirmImportShare");
        const btnCancel = document.getElementById("btnCancelImportShare");
        const errText = document.getElementById("importErrorText");

        pwInput.value = "";
        if (errText) {
            errText.style.display = "none";
            errText.textContent = "";
        }

        modal.showModal();
        pwInput.focus();

        const cleanup = () => {
            btnConfirm.removeEventListener("click", onConfirm);
            btnCancel.removeEventListener("click", onCancel);
            pwInput.removeEventListener("keydown", onKeyDown);
        };

        const onCancel = () => {
            cleanup();
            modal.close();
            resolve(null);
        };

        const onConfirm = () => {
            const val = pwInput.value;
            if (!val) {
                if (errText) {
                    errText.textContent = "Please enter the password.";
                    errText.style.display = "block";
                }
                pwInput.focus();
                return;
            }
            cleanup();
            modal.close();
            resolve(val);
        };

        const onKeyDown = (e) => {
            if (e.key === "Enter") onConfirm();
        };

        modal.addEventListener("close", () => { cleanup(); resolve(null); }, { once: true });
        btnConfirm.addEventListener("click", onConfirm);
        btnCancel.addEventListener("click", onCancel);
        pwInput.addEventListener("keydown", onKeyDown);
    });
}

const showConfirmModal = (msg, title = "Confirm", icon = "help", confirmText = "Confirm", isDanger = false) => {
    return new Promise((resolve) => {
        const modal = document.getElementById("confirmModal");
        if (!modal) {
            return resolve(confirm(msg));
        }
        const textEl = document.getElementById("confirmModalText");
        const titleEl = document.getElementById("confirmModalTitle");
        const iconEl = document.getElementById("confirmModalIcon");
        const btnCancel = document.getElementById("btnCancelConfirmModal");
        const btnConfirm = document.getElementById("btnActionConfirmModal");

        if (textEl) textEl.textContent = msg;
        if (titleEl) titleEl.textContent = title;
        if (iconEl) {
            iconEl.textContent = icon;
            iconEl.style.color = isDanger ? "var(--g-danger, #b3261e)" : "var(--g-primary-blue, #0b57d0)";
        }
        if (btnConfirm) {
            btnConfirm.textContent = confirmText;
            btnConfirm.className = isDanger ? "btn-dialog-danger" : "btn-dialog-primary";
        }

        modal.showModal();

        const cleanup = () => {
            btnConfirm.removeEventListener("click", onConfirm);
            btnCancel.removeEventListener("click", onCancel);
        };

        const onCancel = () => {
            cleanup();
            modal.close();
            resolve(false);
        };

        const onConfirm = () => {
            cleanup();
            modal.close();
            resolve(true);
        };

        modal.addEventListener("close", () => { cleanup(); resolve(false); }, { once: true });
        btnConfirm.addEventListener("click", onConfirm);
        btnCancel.addEventListener("click", onCancel);
    });
}

// Export share token.
document.getElementById("btnExport").addEventListener("click", () => {
    if (!state.name) {
        if (window.showNotice) window.showNotice("⚠️ Please select a folder first to share.", "Notice", "warning");
        else alert("⚠️ Select a folder");
        return;
    }
    const modal = document.getElementById("shareModal");
    if (!modal) return;
    const descEl = document.getElementById("shareModalDesc");
    const pwInput = document.getElementById("sharePasswordInput");
    const errText = document.getElementById("shareErrorText");
    const btnConfirm = document.getElementById("btnConfirmShare");
    const btnCancel = document.getElementById("btnCancelShare");

    if (descEl) {
        descEl.innerHTML = `Set a password to encrypt this folder's share token for "<strong>${state.name.replace(/</g, "&lt;")}</strong>". Anyone with the token file and password can access the folder.`;
    }
    pwInput.value = "";
    if (errText) {
        errText.style.display = "none";
        errText.textContent = "";
    }

    modal.showModal();
    pwInput.focus();

    const cleanup = () => {
        btnConfirm.removeEventListener("click", onConfirm);
        btnCancel.removeEventListener("click", onCancel);
        pwInput.removeEventListener("keydown", onKeyDown);
    };

    const onCancel = () => {
        cleanup();
        modal.close();
    };

    const onConfirm = async () => {
        const pw = pwInput.value;
        if (!pw) {
            if (errText) {
                errText.textContent = "Please enter a password.";
                errText.style.display = "block";
            }
            pwInput.focus();
            return;
        }
        cleanup();
        modal.close();

        const shareName = state.name;

        const token = await makeToken(shareName, state.key, pw);
        if (!token) return;
        const blob = new Blob([token], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safeName = shareName.replace(/[\\/:*?"<>|]/g, "_");
        a.download = `${safeName}_share.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const onKeyDown = (e) => {
        if (e.key === "Enter") onConfirm();
    };

    modal.addEventListener("close", cleanup, { once: true });
    btnConfirm.addEventListener("click", onConfirm);
    btnCancel.addEventListener("click", onCancel);
    pwInput.addEventListener("keydown", onKeyDown);
});

// Import share token.
document.getElementById("btnImport").addEventListener("click", () => {
    const newDriveMenu = document.getElementById("newDriveMenu");
    if (newDriveMenu) newDriveMenu.classList.remove("open");
    const input = document.createElement("input"); input.type = "file"; input.accept = ".txt";
    input.onchange = async () => {
        if (!input.files[0]) return;
        const fileText = (await input.files[0].text()).trim();

        const pw = await promptSharePassword();
        if (!pw) return;

        const info = await loadToken(fileText, pw);
        if (!info) {
            if (window.showNotice) window.showNotice("❌ Invalid token or wrong password.", "Error", "error");
            else alert("❌ Invalid token");
            return;
        }

        const rawK = mask.XOR(info.key);
        const fldId = getObjPid(rawK);
        rawK.fill(0);

        const effectiveName = info.name;

        if (state.fldMap[effectiveName]) {
            const shouldOverwrite = await showConfirmModal(
                `A folder named "${effectiveName}" already exists. Overwrite?`,
                "Overwrite Folder?",
                "warning",
                "Overwrite",
                true
            );
            if (!shouldOverwrite) return;
            const oldRaw = mask.XOR(state.fldMap[effectiveName]);
            const oldFldId = getObjPid(oldRaw);
            oldRaw.fill(0);
            if (oldFldId !== fldId) {
                try {
                    await fetch(`${SERVER}/api/storage/${oldFldId}/names`, { method: "DELETE", headers: { "X-User-Hash": usrHsh } });
                } catch (e) {
                    console.warn("Failed to delete old folder storage", e);
                }
            }
        }
        state.fldMap[effectiveName] = info.key;
        await saveUsr();
        await loadUsr();
        if (window.showNotice) window.showNotice(`✅ Folder "${effectiveName}" imported successfully.`, "Success", "check_circle");
    };
    input.click();
});

// Handle folder select.
document.getElementById("folderSelect").addEventListener("change", async (e) => {
    state.name = e.target.value; if (!state.name) return;
    state.key = state.fldMap[state.name];
    const rawK = mask.XOR(state.key); state.id = getObjPid(rawK); rawK.fill(0);
    state.page = 1;
    SafeSession.setItem("oldFold", state.name);
    SafeSession.setItem("oldPage", 1);
    SafeSession.removeItem("lastViewedFile");
    document.getElementById("btnDeleteFolder").classList.remove("hidden");
    await loadFld();
});

// Fetch folder files.
const loadFld = async () => {
    keywordsBuilt = false;
    selectKeywords.clear();
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
    buildKeywords();
    await showFls();
}

// Helper to extract file size from masked flInfo
const getEntrySize = (flKeyMasked) => {
    if (!flKeyMasked) return 0;
    const raw = mask.XOR(flKeyMasked);
    let sz = 0;
    if (raw.length >= 52) {
        sz = DecodeInt(raw.slice(44, 52));
    }
    raw.fill(0);
    return sz;
}

// Keyword Filter Engine (Matches MediaHub-android)
const BRACKET_PATTERN = /[\[\(]([^\]\)]+)[\]\)]/g;
const SPLIT_PATTERN = /[._\-\s]+/;

let keywordsBuilt = false;
const availKeywords = [];
const keywordCounts = {};
const selectKeywords = new Set();
const tokenCache = new Map();

const extractTokens = (nameOnly) => {
    const tokens = [];
    const lower = (nameOnly || "").normalize('NFC').toLowerCase();

    // Extract bracket contents and replace with spaces
    const remaining = lower.replace(BRACKET_PATTERN, (_, group) => {
        const trimmed = group.trim();
        if (trimmed) tokens.push(trimmed);
        return " ";
    });

    // Split remaining string
    const parts = remaining.split(SPLIT_PATTERN);
    for (const p of parts) {
        const trimmed = p.trim();
        if (trimmed) tokens.push(trimmed);
    }
    return tokens;
}

const isValidKeyword = (token) => {
    let byteLen = 0;
    for (let i = 0; i < token.length; i++) {
        const code = token.charCodeAt(i);
        if (code <= 0x7F) byteLen += 1;
        else if (code <= 0x7FF) byteLen += 2;
        else byteLen += 3;
    }
    if (byteLen < 4) return false;

    // Must have at least one non-digit character
    for (let i = 0; i < token.length; i++) {
        const c = token.charAt(i);
        if (c < '0' || c > '9') return true;
    }
    return false;
}

const buildKeywords = () => {
    availKeywords.length = 0;
    Object.keys(keywordCounts).forEach(k => delete keywordCounts[k]);
    tokenCache.clear();
    const wordCount = {};

    const allFiles = Object.keys(state.flsMap);
    for (const fileName of allFiles) {
        let nameOnly = fileName;
        const dotIdx = fileName.lastIndexOf('.');
        if (dotIdx > 0) nameOnly = fileName.substring(0, dotIdx);

        const tokens = extractTokens(nameOnly);
        const unique = new Set(tokens);
        tokenCache.set(fileName, unique);

        for (const t of unique) {
            if (isValidKeyword(t)) {
                wordCount[t] = (wordCount[t] || 0) + 1;
            }
        }
    }

    for (const [kw, count] of Object.entries(wordCount)) {
        if (count >= 4) {
            availKeywords.push(kw);
            keywordCounts[kw] = count;
        }
    }
    availKeywords.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const availSet = new Set(availKeywords);
    for (const kw of Array.from(selectKeywords)) {
        if (!availSet.has(kw)) selectKeywords.delete(kw);
    }
    keywordsBuilt = true;
}

// Open file in viewer
const openFileByName = async (name) => {
    if (!state.flsMap || !state.key) return false;
    let targetKey = state.flsMap[name];
    let actualName = name;
    if (!targetKey) {
        const found = Object.keys(state.flsMap).find(k => k.normalize('NFC') === (name || "").normalize('NFC'));
        if (found) {
            targetKey = state.flsMap[found];
            actualName = found;
        }
    }
    if (!targetKey) {
        if (typeof loadFld === "function") {
            loadFld().then(async () => {
                let retryKey = state.flsMap[actualName] || state.flsMap[Object.keys(state.flsMap).find(k => k.normalize('NFC') === (name || "").normalize('NFC'))];
                if (retryKey) {
                    const rFK = mask.XOR(retryKey);
                    const rSK = mask.XOR(state.key);
                    SafeSession.setItem("currentFileKey", toHex(rFK));
                    SafeSession.setItem("currentFileName", actualName);
                    SafeSession.setItem("currentFolderId", state.id);
                    SafeSession.setItem("currentFolderKey", toHex(rSK));
                    SafeSession.setItem("oldFold", state.name);
                    SafeSession.setItem("oldPage", state.page);
                    SafeSession.setItem("lastViewedFile", actualName);
                    rFK.fill(0); rSK.fill(0);
                    await SafeSession.navigate("./viewer.html");
                }
            });
        }
        return false;
    }
    const rFK = mask.XOR(targetKey);
    const rSK = mask.XOR(state.key);
    SafeSession.setItem("currentFileKey", toHex(rFK));
    SafeSession.setItem("currentFileName", actualName);
    SafeSession.setItem("currentFolderId", state.id);
    SafeSession.setItem("currentFolderKey", toHex(rSK));
    SafeSession.setItem("oldFold", state.name);
    SafeSession.setItem("oldPage", state.page);
    SafeSession.setItem("lastViewedFile", actualName);
    rFK.fill(0); rSK.fill(0);
    await SafeSession.navigate("./viewer.html");
    return true;
}
window.openFileByName = openFileByName;

// Render files grid.
const showFls = async (isAppend = false) => {
    const isAppending = isAppend || window.isInfiniteScrollLoading === true;
    const grid = document.getElementById("mediaGrid");
    if (!isAppending) {
        grid.innerHTML = "";
    }
    let entries = Object.entries(state.flsMap);

    // Search query filtering (case-insensitive & NFC normalized for Korean/multilingual)
    const searchInput = document.getElementById("topSearchInput");
    const query = (searchInput ? searchInput.value || "" : "").normalize('NFC').trim().toLowerCase();
    if (query) {
        entries = entries.filter(([name]) => (name || "").normalize('NFC').toLowerCase().includes(query));
    }

    // Keyword filtering (AND condition across all selected keywords)
    if (selectKeywords.size > 0) {
        if (!keywordsBuilt) buildKeywords();
        entries = entries.filter(([name]) => {
            const tokenSet = tokenCache.get(name);
            if (!tokenSet) return false;
            for (const kw of selectKeywords) {
                if (!tokenSet.has(kw)) return false;
            }
            return true;
        });
    }

    const sortMode = state.sort || localStorage.getItem("mediahub_sort") || "name-asc";

    if (sortMode === "name-desc") {
        entries.sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true, sensitivity: 'base' }));
    } else if (sortMode === "size-asc") {
        entries.sort((a, b) => {
            const szA = getEntrySize(a[1]);
            const szB = getEntrySize(b[1]);
            return (szA - szB) || a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' });
        });
    } else if (sortMode === "size-desc") {
        entries.sort((a, b) => {
            const szA = getEntrySize(a[1]);
            const szB = getEntrySize(b[1]);
            return (szB - szA) || a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' });
        });
    } else {
        // Default: name-asc
        entries.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }));
    }

    const total = Math.ceil(entries.length / state.limit) || 1;
    if (state.page > total) state.page = total;
    if (state.page < 1) state.page = 1;

    document.getElementById("pageIndicator").textContent = `${state.page} / ${total}`;

    // Save page state.
    SafeSession.setItem("oldPage", state.page);

    const start = isAppending ? (state.page - 1) * state.limit : 0;
    const end = Math.min(state.page * state.limit, entries.length);
    for (const [name, fileKey] of entries.slice(start, end)) {
        const card = document.createElement("div"); card.className = "media-card";
        card.dataset.fileName = name;
        const img = document.createElement("img"); img.className = "thumb-img"; img.alt = "Loading...";
        const rawFK = mask.XOR(fileKey);
        const fkSlice = rawFK.slice(0, 44);
        loadThm(getObjPid(fkSlice), name.split('.').pop().toUpperCase(), img, fkSlice);
        rawFK.fill(0);

        const title = document.createElement("div"); title.className = "file-title"; title.textContent = name;
        title.title = name;
        card.appendChild(img); card.appendChild(title);

        const moreBtn = document.createElement("button");
        moreBtn.type = "button";
        moreBtn.className = "file-more-btn";
        moreBtn.title = "More options";
        moreBtn.setAttribute("aria-label", "More options");
        moreBtn.innerHTML = '<span class="material-symbols-outlined">more_vert</span>';
        moreBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (window.openFileContextMenu) {
                window.openFileContextMenu(e, name, moreBtn);
            }
        });
        card.appendChild(moreBtn);

        card.addEventListener("click", () => {
            openFileByName(name);
        });
        grid.appendChild(card);
    }

    if (window.updateKeywordFilterUI) {
        window.updateKeywordFilterUI();
    }
}

// Rename file implementation
const renameFile = async (rawOldName, rawNewName) => {
    const oldName = (rawOldName || "").trim();
    const newName = (rawNewName || "").trim();

    if (!oldName || !newName) {
        throw new Error("File name cannot be empty.");
    }
    if (oldName.normalize('NFC') === newName.normalize('NFC')) {
        return;
    }

    let actualOldName = oldName;
    if (!state.flsMap[actualOldName]) {
        const found = Object.keys(state.flsMap).find(k => k.normalize('NFC') === oldName.normalize('NFC'));
        if (found) actualOldName = found;
        else throw new Error(`Original file "${oldName}" not found.`);
    }

    const duplicate = Object.keys(state.flsMap).find(k => k.normalize('NFC') === newName.normalize('NFC') && k !== actualOldName);
    if (duplicate) {
        throw new Error(`A file named "${newName}" already exists in this folder.`);
    }

    const origFlsMap = { ...state.flsMap };

    try {
        state.flsMap[newName] = state.flsMap[actualOldName];
        delete state.flsMap[actualOldName];

        const rawSK = mask.XOR(state.key);
        const sm = new SymMaster("gcm1", rawSK.slice(0, 32));
        rawSK.fill(0);

        const um = rawMap(state.flsMap);
        const encoded = EncodeCfg(um);
        wipeMap(um);

        const cipherBin = await sm.EnBin(encoded);
        encoded.fill(0);

        const res = await fetch(`${SERVER}/api/storage/${state.id}/names`, {
            method: "POST",
            headers: { "X-User-Hash": usrHsh },
            body: cipherBin
        });
        if (!res.ok) {
            throw new Error(`Server returned HTTP ${res.status}`);
        }

        keywordsBuilt = false;
        selectKeywords.clear();
        buildKeywords();
        await showFls();

        if (window.showNotice) {
            window.showNotice(`✅ Renamed to "${newName}"`, "Success", "check_circle");
        }
    } catch (err) {
        console.error("Failed to rename file:", err);
        state.flsMap = origFlsMap;
        throw err;
    }
}
window.renameFile = renameFile;
// Share file link
const shareFile = async (fileName) => {
    const targetFile = (fileName || "").trim();
    if (!state.id || !targetFile) return;

    let flPid = null;
    let fileKey = state.flsMap[targetFile];
    if (!fileKey) {
        const found = Object.keys(state.flsMap).find(k => k.normalize('NFC') === targetFile.normalize('NFC'));
        if (found) fileKey = state.flsMap[found];
    }
    if (fileKey) {
        const rawFK = mask.XOR(fileKey);
        flPid = getObjPid(rawFK.slice(0, 44));
        rawFK.fill(0);
    }

    const fileParam = flPid || targetFile;
    const shareUrl = `${window.location.origin}/folder.html?folder=${encodeURIComponent(state.id)}&file=${encodeURIComponent(fileParam)}`;
    try {
        await navigator.clipboard.writeText(shareUrl);
        if (window.showNotice) {
            window.showNotice("Link copied to clipboard", "Share", "check_circle");
        } else {
            alert("🔗 Link copied to clipboard");
        }
    } catch (err) {
        try {
            const input = document.createElement("input");
            input.value = shareUrl;
            document.body.appendChild(input);
            input.select();
            document.execCommand("copy");
            document.body.removeChild(input);
            if (window.showNotice) {
                window.showNotice("Link copied to clipboard", "Share", "check_circle");
            } else {
                alert("🔗 Link copied to clipboard");
            }
        } catch (_) {
            prompt("Copy this share link:", shareUrl);
        }
    }
}
window.shareFile = shareFile;

// Download decrypted file directly from folder list
const downloadFileDirectly = async (fileName) => {
    const targetFile = (fileName || "").trim();
    const fileKey = state.flsMap[targetFile];
    if (!fileKey) return;

    if (window.showNotice) {
        window.showNotice(`📥 Preparing download: "${targetFile}"...`, "Downloading", "download");
    }

    try {
        const rawFK = mask.XOR(fileKey);
        const flPid = getObjPid(rawFK.slice(0, 44));
        const origSize = rawFK.length >= 52 ? DecodeInt(rawFK.slice(44, 52)) : 0;
        const keySlice = rawFK.slice(0, 32);
        rawFK.fill(0);

        const head = await fetch(`${SERVER}/api/media/${state.id}/${flPid}/dat`, {
            headers: { 'Range': 'bytes=0-0' }
        });
        const contentRange = head.headers.get("Content-Range");
        if (!head.ok || !contentRange) {
            throw new Error(`File binary not found on server (HTTP ${head.status})`);
        }
        const totSize = parseInt(contentRange.split('/')[1], 10);

        let loaded = 0;
        const chunks = [];
        while (loaded < totSize) {
            const res = await fetch(`${SERVER}/api/media/${state.id}/${flPid}/dat`, {
                headers: { 'Range': `bytes=${loaded}-${totSize - 1}` }
            });
            const reader = res.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loaded += value.length;
            }
        }

        const fullBuf = new Uint8Array(loaded);
        let offset = 0;
        for (const c of chunks) { fullBuf.set(c, offset); offset += c.length; }

        const smx = new SymMaster("gcmx1", keySlice);
        keySlice.fill(0);
        const ciphSize = origSize > 0 ? smx.AfterSize(origSize) : fullBuf.length;
        const encBuf = fullBuf.slice(0, ciphSize);

        const plnChks = [];
        await smx.DeFile(new NetSrc(encBuf), encBuf.length, { write: async (c) => plnChks.push(c) });
        const rawBuf = new Uint8Array(plnChks.reduce((a, c) => a + c.length, 0));
        let fOff = 0;
        for (const c of plnChks) { rawBuf.set(c, fOff); fOff += c.length; }

        const ext = targetFile.split('.').pop().toLowerCase();
        const mimeMap = {
            'pdf': 'application/pdf', 'txt': 'text/plain', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
            'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp', 'mp4': 'video/mp4',
            'webm': 'video/webm', 'mov': 'video/quicktime', 'mkv': 'video/x-matroska'
        };
        const mime = mimeMap[ext] || 'application/octet-stream';

        const a = document.createElement('a');
        const blobUrl = URL.createObjectURL(new Blob([rawBuf], { type: mime }));
        a.href = blobUrl;
        a.download = targetFile;
        a.click();
        URL.revokeObjectURL(blobUrl);

        if (window.showNotice) {
            window.showNotice(`✅ Download complete: "${targetFile}"`, "Success", "check_circle");
        }
    } catch (e) {
        console.error("Direct download failed:", e);
        if (window.showNotice) {
            window.showNotice(`❌ Download failed: ${e.message}`, "Error", "error");
        } else {
            alert("❌ Download failed: " + e.message);
        }
    }
}
window.downloadFile = downloadFileDirectly;

// Delete file implementation
const deleteFile = async (fileName) => {
    const targetFile = (fileName || "").trim();
    if (!targetFile || !state.flsMap[targetFile]) return;

    const ok = await showConfirmModal(
        `Are you sure you want to delete "<strong>${targetFile.replace(/</g, "&lt;")}</strong>"? This action cannot be undone.`,
        "Delete file?",
        "delete",
        "Delete",
        true
    );
    if (!ok) return;

    try {
        const rawFK = mask.XOR(state.flsMap[targetFile]);
        const flPid = getObjPid(rawFK.slice(0, 44));
        rawFK.fill(0);

        try {
            await fetch(`${SERVER}/api/media/${state.id}/${flPid}/dat`, { method: "DELETE" });
            await fetch(`${SERVER}/api/media/${state.id}/${flPid}/thumb`, { method: "DELETE" });
        } catch (e) {
            console.warn("Error deleting media binaries:", e);
        }

        delete state.flsMap[targetFile];

        const rawSK = mask.XOR(state.key);
        const sm = new SymMaster("gcm1", rawSK.slice(0, 32));
        rawSK.fill(0);

        const um = rawMap(state.flsMap);
        const encoded = EncodeCfg(um);
        wipeMap(um);

        const cipherBin = await sm.EnBin(encoded);
        encoded.fill(0);

        const res = await fetch(`${SERVER}/api/storage/${state.id}/names`, {
            method: "POST",
            headers: { "X-User-Hash": usrHsh },
            body: cipherBin
        });
        if (!res.ok) {
            throw new Error(`Server returned HTTP ${res.status}`);
        }

        keywordsBuilt = false;
        selectKeywords.clear();
        buildKeywords();
        await showFls();

        if (window.showNotice) {
            window.showNotice(`🗑️ Deleted "${targetFile}"`, "Success", "check_circle");
        }
    } catch (err) {
        console.error("Delete file failed:", err);
        if (window.showNotice) {
            window.showNotice(`❌ Delete failed: ${err.message}`, "Error", "error");
        } else {
            alert("❌ Delete failed: " + err.message);
        }
    }
}
window.deleteFile = deleteFile;

window.setFileSort = async (mode) => {
    state.sort = mode;
    localStorage.setItem("mediahub_sort", mode);
    state.page = 1;
    await showFls();
};
window.getFileSort = () => state.sort;
window.refreshFilesView = async () => {
    state.page = 1;
    await showFls();
};

// Global keyword filter API for UI
window.getKeywordFilterState = () => {
    if (!keywordsBuilt) buildKeywords();
    return {
        availKeywords: [...availKeywords],
        keywordCounts: { ...keywordCounts },
        selectKeywords: Array.from(selectKeywords),
        totalFiles: Object.keys(state.flsMap).length
    };
};

window.applyKeywordFilter = async (newKeywordsSet) => {
    selectKeywords.clear();
    if (newKeywordsSet) {
        for (const kw of newKeywordsSet) selectKeywords.add(kw);
    }
    state.page = 1;
    await showFls();
    const mediaContainer = document.getElementById("mediaContainer");
    if (mediaContainer) mediaContainer.scrollTop = 0;
};

window.clearKeywordFilter = async () => {
    await window.applyKeywordFilter(new Set());
};

window.toggleKeywordFilter = async (kw) => {
    const s = new Set(selectKeywords);
    if (s.has(kw)) s.delete(kw);
    else s.add(kw);
    await window.applyKeywordFilter(s);
};

// Hook live search on topSearchInput
const searchInputEl = document.getElementById("topSearchInput");
if (searchInputEl) {
    let searchDebounce = null;
    const triggerSearch = (immediate = false) => {
        clearTimeout(searchDebounce);
        const doSearch = async () => {
            if (state.id) {
                state.page = 1;
                await showFls();
                const mediaContainer = document.getElementById("mediaContainer");
                if (mediaContainer) mediaContainer.scrollTop = 0;
            }
        };
        if (immediate) {
            doSearch();
        } else {
            searchDebounce = setTimeout(doSearch, 100);
        }
    };

    searchInputEl.addEventListener("input", () => triggerSearch(false));
    searchInputEl.addEventListener("compositionend", () => triggerSearch(true));
}

// Fetch thumb file.
const loadThm = async (filePid, ext, imgEl, fileKeyRaw) => {
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

// Upload cancellation state
let currentUploadState = {
    isCancelled: false,
    currentXHR: null,
    activeFileIdx: -1,
};

window.cancelUpload = (fileIdx) => {
    currentUploadState.isCancelled = true;
    if (currentUploadState.currentXHR) {
        try {
            currentUploadState.currentXHR.abort();
        } catch (e) { }
    }
    if (window.markUploadCancelled) {
        window.markUploadCancelled(fileIdx !== undefined ? fileIdx : currentUploadState.activeFileIdx);
    }
};

// Handle file upload.
document.getElementById("btnUpload").addEventListener("click", async () => {
    const fileIn = document.getElementById("fileInput");
    const btnUp = document.getElementById("btnUpload");
    const rawFiles = Array.from(fileIn.files);
    if (rawFiles.length === 0) {
        if (window.showNotice) {
            window.showNotice("Please select files to upload.", "Upload", "info");
        } else {
            alert("⚠️ Select files");
        }
        return;
    }

    // 1. Pre-check for existing files & confirm overwrite BEFORE disabling buttons or showing upload widget
    const filesToUpload = [];
    for (const file of rawFiles) {
        if (state.flsMap[file.name]) {
            const shouldOverwrite = await showConfirmModal(
                `File "${file.name}" already exists. Overwrite?`,
                "File Exists",
                "warning",
                "Overwrite",
                true
            );
            if (shouldOverwrite) {
                filesToUpload.push(file);
            }
        } else {
            filesToUpload.push(file);
        }
    }

    // If user cancelled all overwrites or no files left to upload
    if (filesToUpload.length === 0) {
        fileIn.value = "";
        return;
    }

    // 2. Open upload widget ONLY for confirmed files
    if (window.showUploadProgressWidget) {
        window.showUploadProgressWidget(filesToUpload);
    }

    fileIn.disabled = true;
    btnUp.disabled = true;
    const origTxt = btnUp.textContent;
    currentUploadState.isCancelled = false;

    try {
        for (let i = 0; i < filesToUpload.length; i++) {
            if (currentUploadState.isCancelled) {
                break;
            }
            currentUploadState.activeFileIdx = i;
            const file = filesToUpload[i];

            // If overwriting, remove old file from server first
            if (state.flsMap[file.name]) {
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

            btnUp.textContent = `🚀 ${i + 1}/${filesToUpload.length}`;
            if (window.updateFileProgress) {
                window.updateFileProgress(i, 0, filesToUpload.length);
            }

            const fileKey = new Uint8Array(44); fileKey.set(Random(32), 0); fileKey.set(Random(12), 32); const filePid = getObjPid(fileKey);

            // Make thumb by type.
            let thumb = null;
            if (file.type.startsWith("image/") || file.name.toLowerCase().endsWith(".svg")) thumb = await makeImg(file);
            else if (file.type.startsWith("video/")) thumb = await makeVid(file);

            if (currentUploadState.isCancelled) throw new Error("UPLOAD_CANCELLED");

            // Encrypt file with real-time chunk progress (0% - 50%).
            let encryptedBytes = 0;
            const smx = new SymMaster("gcmx1", fileKey.slice(0, 32));
            const encChks = [];
            await smx.EnFile(new FileSrc(file), file.size, {
                write: async (c) => {
                    if (currentUploadState.isCancelled) throw new Error("UPLOAD_CANCELLED");
                    encChks.push(c);
                    encryptedBytes += c.length;
                    if (window.updateFileProgress) {
                        const filePercent = Math.min(50, Math.round((encryptedBytes / (file.size || 1)) * 50));
                        window.updateFileProgress(i, filePercent, filesToUpload.length);
                    }
                }
            });

            if (currentUploadState.isCancelled) throw new Error("UPLOAD_CANCELLED");

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

            if (currentUploadState.isCancelled) throw new Error("UPLOAD_CANCELLED");

            // Upload via XHR with real-time network transfer progress (50% - 95%)
            await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                currentUploadState.currentXHR = xhr;
                xhr.open("POST", `${SERVER}/api/media/${state.id}/${filePid}/dat`);
                xhr.setRequestHeader("X-User-Hash", usrHsh);
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable && window.updateFileProgress) {
                        const uploadPercent = 50 + Math.min(45, Math.round((e.loaded / e.total) * 45));
                        window.updateFileProgress(i, uploadPercent, filesToUpload.length);
                    }
                };
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve();
                    } else {
                        reject(new Error(`Upload failed with status ${xhr.status}`));
                    }
                };
                xhr.onabort = () => reject(new Error("UPLOAD_CANCELLED"));
                xhr.onerror = () => reject(new Error("Network upload failed"));
                xhr.send(medBuf);
            });
            currentUploadState.currentXHR = null;

            if (thumb) {
                const thmSm = new SymMaster("gcm1", fileKey.slice(0, 32));
                await fetch(`${SERVER}/api/media/${state.id}/${filePid}/thumb`, { method: "POST", headers: { "X-User-Hash": usrHsh }, body: await thmSm.EnBin(new Uint8Array(await thumb.arrayBuffer())) });
            }

            // Mark this file 100% complete
            if (window.updateFileProgress) {
                window.updateFileProgress(i, 100, filesToUpload.length);
            }

            // Save key to map.
            const flInfo = new Uint8Array(52);
            flInfo.set(fileKey, 0);
            flInfo.set(EncodeInt(file.size, 8), 44);
            state.flsMap[file.name] = mask.XOR(flInfo);
            fileKey.fill(0);
            flInfo.fill(0);
        }

        // Sync metadata if any files were uploaded.
        if (filesToUpload.length > 0 && !currentUploadState.isCancelled) {
            btnUp.textContent = "🔄 Syncing...";
            const rawSK = mask.XOR(state.key);
            const metSm = new SymMaster("gcm1", rawSK.slice(0, 32));
            rawSK.fill(0);
            const um = rawMap(state.flsMap);
            const encoded = EncodeCfg(um);
            wipeMap(um);
            await fetch(`${SERVER}/api/storage/${state.id}/names`, { method: "POST", headers: { "X-User-Hash": usrHsh }, body: await metSm.EnBin(encoded) });
            encoded.fill(0);
        }

        fileIn.value = "";
        await loadFld();
    } catch (err) {
        if (err.message === "UPLOAD_CANCELLED") {
            console.log("Upload was cancelled by user.");
            if (fileIn) fileIn.value = "";
            await loadFld();
        } else {
            console.error(err);
            alert("❌ Upload error: " + err.message);
        }
    } finally {
        currentUploadState.isCancelled = false;
        currentUploadState.currentXHR = null;
        currentUploadState.activeFileIdx = -1;
        fileIn.disabled = false;
        btnUp.disabled = false;
        btnUp.textContent = origTxt;
    }
});

// Unlink folder (참조 해제 - remove from this user's account only)
const executeUnlinkFolder = async (rawFolderName) => {
    const target = (rawFolderName || state.name || "").trim();
    if (!target) return;

    let actualKey = target;
    if (!state.fldMap[actualKey]) {
        const found = Object.keys(state.fldMap).find(k => k.normalize('NFC') === target.normalize('NFC'));
        if (found) actualKey = found;
        else return;
    }

    try {
        delete state.fldMap[actualKey];

        const isActive = (state.name === actualKey || (state.name && state.name.normalize('NFC') === actualKey.normalize('NFC')));
        if (isActive) {
            state.name = "";
            state.id = "";
            state.key = null;
            SafeSession.removeItem("oldFold");
        }

        await saveUsr();
        await loadUsr();

        if (isActive && window.navToRoot) {
            window.navToRoot();
        } else {
            if (window.syncSidebarFolderList) window.syncSidebarFolderList();
            if (window.syncRootFolderGrid) window.syncRootFolderGrid();
            if (window.updateFolderDisplay) window.updateFolderDisplay();
        }

        if (window.showNotice) {
            window.showNotice(`✅ Removed "${actualKey}" from your account`, "Success", "check_circle");
        }
    } catch (e) {
        console.error("Failed to unlink folder:", e);
        if (window.showNotice) window.showNotice("❌ Failed to remove folder: " + e.message, "Error", "error");
    }
}
window.unlinkFolder = executeUnlinkFolder;

// Permanently delete folder from server (영구 삭제)
const executeDeleteFolder = async (rawFolderName) => {
    const target = (rawFolderName || state.name || "").trim();
    if (!target) return;

    let actualKey = target;
    if (!state.fldMap[actualKey]) {
        const found = Object.keys(state.fldMap).find(k => k.normalize('NFC') === target.normalize('NFC'));
        if (found) actualKey = found;
        else return;
    }

    try {
        const maskedKey = state.fldMap[actualKey];
        const rawK = mask.XOR(maskedKey);
        const fldId = getObjPid(rawK);
        rawK.fill(0);

        await fetch(`${SERVER}/api/storage/${fldId}/names`, { method: "DELETE", headers: { "X-User-Hash": usrHsh } });

        delete state.fldMap[actualKey];

        const isActive = (state.name === actualKey || (state.name && state.name.normalize('NFC') === actualKey.normalize('NFC')));
        if (isActive) {
            state.name = "";
            state.id = "";
            state.key = null;
            SafeSession.removeItem("oldFold");
        }

        await saveUsr();
        await loadUsr();

        if (isActive && window.navToRoot) {
            window.navToRoot();
        } else {
            if (window.syncSidebarFolderList) window.syncSidebarFolderList();
            if (window.syncRootFolderGrid) window.syncRootFolderGrid();
            if (window.updateFolderDisplay) window.updateFolderDisplay();
        }

        if (window.showNotice) {
            window.showNotice(`🗑️ Folder "${actualKey}" permanently deleted`, "Deleted", "delete");
        }
    } catch (e) {
        console.error("Failed to delete folder:", e);
        if (window.showNotice) window.showNotice("❌ Failed to delete folder: " + e.message, "Error", "error");
    }
}
window.deleteFolder = executeDeleteFolder;

// Delete/Unlink folder button listeners (compatibility)
const btnDeleteFolder = document.getElementById("btnDeleteFolder");
if (btnDeleteFolder) {
    btnDeleteFolder.addEventListener("click", () => {
        if (!state.name) return;
        if (window.openDeleteFolderDialog) {
            window.openDeleteFolderDialog(state.name);
        } else {
            executeDeleteFolder(state.name);
        }
    });
}

const btnUnlinkFolder = document.getElementById("btnUnlinkFolder");
if (btnUnlinkFolder) {
    btnUnlinkFolder.addEventListener("click", () => {
        if (!state.name) return;
        if (window.openUnlinkFolderDialog) {
            window.openUnlinkFolderDialog(state.name);
        } else {
            executeUnlinkFolder(state.name);
        }
    });
}

// Handle pagination.
document.getElementById("btnPrevPage").addEventListener("click", async () => { if (state.page > 1) { state.page--; await showFls(false); } });
document.getElementById("btnNextPage").addEventListener("click", async () => { if (state.page < Math.ceil(Object.keys(state.flsMap).length / state.limit)) { state.page++; await showFls(true); } });
// Trim orphan files in folder
const executeTrimFolder = async (rawFolderName) => {
    const target = (rawFolderName || state.name || "").trim();
    if (!target) {
        throw new Error("No folder specified");
    }

    let actualKey = target;
    if (!state.fldMap[actualKey]) {
        const found = Object.keys(state.fldMap).find(k => k.normalize('NFC') === target.normalize('NFC'));
        if (found) actualKey = found;
        else throw new Error(`Folder "${target}" not found`);
    }

    const maskedKey = state.fldMap[actualKey];
    const rawK = mask.XOR(maskedKey);
    const fldId = getObjPid(rawK);

    let pids = [];
    if (state.name === actualKey && state.id === fldId && Object.keys(state.flsMap).length > 0) {
        for (const [, fileKey] of Object.entries(state.flsMap)) {
            const rawFK = mask.XOR(fileKey);
            const pid = getObjPid(rawFK.slice(0, 44));
            rawFK.fill(0);
            pids.push(pid);
        }
    } else {
        const fldSm = new SymMaster("gcm1", rawK.slice(0, 32));
        const res = await fetch(`${SERVER}/api/storage/${fldId}/names`, {
            headers: { "X-User-Hash": usrHsh }
        });
        if (res.ok) {
            const encBytes = new Uint8Array(await res.arrayBuffer());
            if (encBytes.length > 0) {
                const dec = await fldSm.DeBin(encBytes);
                const flsMap = DecodeCfg(dec);
                dec.fill(0);
                for (const [, fileKey] of Object.entries(flsMap)) {
                    const rawFK = mask.XOR(fileKey);
                    const pid = getObjPid(rawFK.slice(0, 44));
                    rawFK.fill(0);
                    pids.push(pid);
                }
            }
        }
    }
    rawK.fill(0);

    const res = await fetch(`${SERVER}/api/trim/${fldId}`, {
        method: "POST",
        headers: { "X-User-Hash": usrHsh, "Content-Type": "application/json" },
        body: JSON.stringify({ pids })
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(text || res.statusText);
    }

    if (state.name === actualKey) {
        await loadFld();
    }
    if (window.syncRootFolderGrid) {
        window.syncRootFolderGrid();
    }

    return { text, pidsCount: pids.length };
}
window.executeTrimFolder = executeTrimFolder;

const btnTrim = document.getElementById("btnTrim");
if (btnTrim) {
    btnTrim.addEventListener("click", async () => {
        if (!state.name || !state.id) {
            if (window.showNotice) window.showNotice("⚠️ Select a folder first", "Notice", "warning");
            else alert("⚠️ Select a folder first");
            return;
        }
        if (window.openTrimFolderDialog) {
            window.openTrimFolderDialog(state.name);
        } else {
            try {
                const result = await executeTrimFolder(state.name);
                alert("✅ " + result.text);
            } catch (e) {
                alert("❌ Trim error: " + e.message);
            }
        }
    });
}
document.getElementById("lblUserHash").textContent = usrHsh;

// Change Password
document.getElementById("btnConfirmPw").addEventListener("click", async () => {
    // get username and password
    const newPw = document.getElementById("newPassword").value;
    const confirmPw = document.getElementById("newPasswordConfirm").value;
    if (!newPw) return alert("⚠️ Enter new password");
    if (newPw !== confirmPw) return alert("⚠️ Passwords do not match");
    const username = SafeSession.getItem("username");
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
    SafeSession.setItem("userHash", newHash);
    SafeSession.setItem("userKey", toHex(mask.XOR(maskedNewKey)));
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

// Restore session or open shared link.
const boot = async () => {
    await loadUsr();

    // Check URL parameters for direct file or folder link
    const urlParams = new URLSearchParams(window.location.search);
    const targetFolderId = urlParams.get("folder") || urlParams.get("fld");
    const targetFileName = urlParams.get("file");

    if (targetFolderId) {
        let matchingFolderName = null;
        let matchingFolderKey = null;

        for (const [fName, maskedKey] of Object.entries(state.fldMap)) {
            const rawK = mask.XOR(maskedKey);
            const id = getObjPid(rawK);
            rawK.fill(0);
            if (id === targetFolderId) {
                matchingFolderName = fName;
                matchingFolderKey = maskedKey;
                break;
            }
        }

        if (matchingFolderName) {
            document.getElementById("folderSelect").value = matchingFolderName;
            state.name = matchingFolderName;
            state.key = matchingFolderKey;
            state.id = targetFolderId;
            state.page = 1;
            SafeSession.setItem("oldFold", matchingFolderName);
            SafeSession.setItem("oldPage", "1");
            document.getElementById("btnDeleteFolder").classList.remove("hidden");
            if (window.updateFolderDisplay) window.updateFolderDisplay();
            await loadFld();

            if (targetFileName) {
                // targetFileName can be a file PID (24-hex) or legacy plaintext filename
                let resolvedFileName = null;

                // 1. Try matching by file PID
                for (const [fName, fKey] of Object.entries(state.flsMap)) {
                    const rawFK = mask.XOR(fKey);
                    const pid = getObjPid(rawFK.slice(0, 44));
                    rawFK.fill(0);
                    if (pid === targetFileName) {
                        resolvedFileName = fName;
                        break;
                    }
                }

                // 2. Fallback: match by plaintext filename (backward compatibility)
                if (!resolvedFileName) {
                    if (state.flsMap[targetFileName]) {
                        resolvedFileName = targetFileName;
                    } else {
                        const found = Object.keys(state.flsMap).find(k => k.normalize('NFC') === targetFileName.normalize('NFC'));
                        if (found) resolvedFileName = found;
                    }
                }

                // Remove query parameters from URL to keep address bar clean
                window.history.replaceState({}, document.title, window.location.pathname);

                if (resolvedFileName) {
                    await openFileByName(resolvedFileName);
                } else {
                    if (window.showNotice) {
                        window.showNotice("⚠️ Shared file was not found in this folder.", "Notice", "warning");
                    }
                }
            }
            return;
        } else {
            // Target folder not found in user's fldMap
            if (window.showNotice) {
                window.showNotice("⚠️ You do not have access to this folder. Please make sure the folder has been shared with and imported to your account.", "Folder Not Found", "warning");
            }
        }
    }

    const oldFold = SafeSession.getItem("oldFold");
    const oldPage = SafeSession.getItem("oldPage");
    if (oldFold && state.fldMap[oldFold]) {
        document.getElementById("folderSelect").value = oldFold;
        state.name = oldFold; state.key = state.fldMap[oldFold];
        const rawK = mask.XOR(state.key); state.id = getObjPid(rawK); rawK.fill(0);
        state.page = oldPage ? parseInt(oldPage, 10) : 1;
        document.getElementById("btnDeleteFolder").classList.remove("hidden");
        if (window.updateFolderDisplay) window.updateFolderDisplay();
        await loadFld();

        const lastViewed = SafeSession.getItem("lastViewedFile");
        if (lastViewed) {
            SafeSession.removeItem("lastViewedFile");
            setTimeout(() => {
                const targetCard = Array.from(document.querySelectorAll(".media-card")).find(c => c.dataset.fileName === lastViewed);
                if (targetCard) {
                    targetCard.scrollIntoView({ block: "center", behavior: "smooth" });
                    targetCard.style.outline = "2px solid var(--g-primary-blue, #1a73e8)";
                    targetCard.style.transition = "outline 0.5s ease";
                    setTimeout(() => {
                        targetCard.style.outline = "";
                    }, 1500);
                }
            }, 100);
        }
    }
}
boot();
