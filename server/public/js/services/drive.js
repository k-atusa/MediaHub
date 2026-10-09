// MediaHub Drive Service (E2EE Metadata, Folder/File Operations & Search)
import { SHA3256, SymMaster, Random, Masker, HashMaster } from '../engine/Bencrypt.js';
import { EncodeCfg, DecodeCfg, EncodeInt, DecodeInt } from '../engine/Opsec.js';
import { NormPW } from '../engine/Bencode.js';
import { SafeSession } from '../core/session.js';
import { toHex, fromHex, getObjPid, getUserPid, formatBytes } from '../core/utils.js';
import { NetSrc } from '../core/media.js';

const mask = new Masker();
const maskMap = (m) => {
    for (const k of Object.keys(m)) {
        const r = m[k];
        m[k] = mask.XOR(r);
        r.fill(0);
    }
};
const rawMap = (m) => {
    const c = {};
    for (const [k, v] of Object.entries(m)) c[k] = mask.XOR(v);
    return c;
};
const wipeMap = (m) => {
    for (const v of Object.values(m)) if (v?.fill) v.fill(0);
};

const SECRET_PEPPER = "_PROJECT_WHY_MEDIAHUB_PEPPER_2026_!@#$";
const BRACKET_PATTERN = /[\[\(]([^\]\)]+)[\]\)]/g;
const SPLIT_PATTERN = /[._\-\s]+/;

class DriveService {
    constructor() {
        this.serverUrl = window.location.origin;
        this.usrHsh = null;
        this.usrKey = null;

        this.fldMap = {};
        this.currentFolderName = "";
        this.currentFolderKey = null;
        this.currentFolderId = "";
        this.flsMap = {};

        this.sortMode = localStorage.getItem("mediahub_sort") || "name-asc";
        this.fileSizeCache = {};
        this.allFoldersFilesCache = null;
        this.allFoldersFilesCacheTime = 0;

        // Keyword filter engine
        this.keywordsBuilt = false;
        this.availKeywords = [];
        this.keywordCounts = {};
        this.selectKeywords = new Set();
        this.tokenCache = new Map();
    }

    async initSession() {
        await SafeSession.init();
        this.usrHsh = SafeSession.getItem("userHash");
        const rawUkHex = SafeSession.getItem("userKey");
        if (rawUkHex) {
            const raw = fromHex(rawUkHex);
            this.usrKey = mask.XOR(raw);
            raw.fill(0);
        } else {
            this.usrKey = null;
        }
        return Boolean(this.usrHsh && this.usrKey);
    }

    clearSession() {
        if (this.usrKey) {
            const raw = mask.XOR(this.usrKey);
            raw.fill(0);
            this.usrKey = null;
        }
        this.usrHsh = null;
        this.fldMap = {};
        this.flsMap = {};
        this.currentFolderName = "";
        this.currentFolderKey = null;
        this.currentFolderId = "";
        this.fileSizeCache = {};
        this.allFoldersFilesCache = null;
        SafeSession.clear();
    }

    async loadUser() {
        if (!this.usrHsh || !this.usrKey) return false;
        const res = await fetch(`${this.serverUrl}/api/userdata/${this.usrHsh}`);
        if (res.status === 404) {
            this.fldMap = {};
            return true;
        }
        if (!res.ok) throw new Error(`Failed to load userdata (HTTP ${res.status})`);

        const rawUK = mask.XOR(this.usrKey);
        const sm = new SymMaster("gcm1", rawUK);
        rawUK.fill(0);

        const dec = await sm.DeBin(new Uint8Array(await res.arrayBuffer()));
        this.fldMap = DecodeCfg(dec);
        dec.fill(0);
        maskMap(this.fldMap);
        return true;
    }

    async saveUser() {
        if (!this.usrHsh || !this.usrKey) return false;
        const rawUK = mask.XOR(this.usrKey);
        const sm = new SymMaster("gcm1", rawUK);
        rawUK.fill(0);

        const um = rawMap(this.fldMap);
        const encoded = EncodeCfg(um);
        wipeMap(um);

        const res = await fetch(`${this.serverUrl}/api/userdata/${this.usrHsh}`, {
            method: "POST",
            body: await sm.EnBin(encoded)
        });
        encoded.fill(0);
        if (!res.ok) {
            throw new Error(`Failed to save userdata to server (HTTP ${res.status})`);
        }
        return true;
    }

    async createFolder(name) {
        const trimmed = (name || "").trim();
        if (!trimmed || this.fldMap[trimmed]) {
            throw new Error("Invalid or duplicate folder name");
        }
        const rk = new Uint8Array(44);
        rk.set(Random(32), 0);
        rk.set(Random(12), 32);
        const maskedKey = mask.XOR(rk);
        rk.fill(0);

        this.fldMap[trimmed] = maskedKey;
        await this.saveUser();
        this.invalidateCache();
        return trimmed;
    }

    async renameFolder(rawOldName, rawNewName) {
        const oldName = (rawOldName || "").trim();
        const newName = (rawNewName || "").trim();
        if (!oldName || !newName) throw new Error("Folder name cannot be empty.");
        if (oldName.normalize('NFC') === newName.normalize('NFC')) return;

        let actualOldKey = oldName;
        if (!this.fldMap[actualOldKey]) {
            const found = Object.keys(this.fldMap).find(k => k.normalize('NFC') === oldName.normalize('NFC'));
            if (found) actualOldKey = found;
            else throw new Error(`Original folder "${oldName}" not found.`);
        }

        const duplicate = Object.keys(this.fldMap).find(k => k.normalize('NFC') === newName.normalize('NFC') && k !== actualOldKey);
        if (duplicate) throw new Error(`A folder named "${newName}" already exists.`);

        const origFldMap = { ...this.fldMap };
        const origCurrentName = this.currentFolderName;

        try {
            const maskedKey = this.fldMap[actualOldKey];
            this.fldMap[newName] = maskedKey;
            delete this.fldMap[actualOldKey];

            if (this.currentFolderName === actualOldKey || (this.currentFolderName && this.currentFolderName.normalize('NFC') === actualOldKey.normalize('NFC'))) {
                this.currentFolderName = newName;
                SafeSession.setItem("oldFold", newName);
            }

            await this.saveUser();
            this.invalidateCache();
        } catch (err) {
            this.fldMap = origFldMap;
            this.currentFolderName = origCurrentName;
            throw err;
        }
    }

    async unlinkFolder(rawFolderName) {
        const target = (rawFolderName || this.currentFolderName || "").trim();
        if (!target) return;

        let actualKey = target;
        if (!this.fldMap[actualKey]) {
            const found = Object.keys(this.fldMap).find(k => k.normalize('NFC') === target.normalize('NFC'));
            if (found) actualKey = found;
            else return;
        }

        delete this.fldMap[actualKey];
        if (this.currentFolderName === actualKey || (this.currentFolderName && this.currentFolderName.normalize('NFC') === actualKey.normalize('NFC'))) {
            this.currentFolderName = "";
            this.currentFolderId = "";
            this.currentFolderKey = null;
            this.flsMap = {};
            SafeSession.removeItem("oldFold");
        }

        await this.saveUser();
        this.invalidateCache();
    }

    async deleteFolderPermanently(rawFolderName) {
        const target = (rawFolderName || this.currentFolderName || "").trim();
        if (!target) return;

        let actualKey = target;
        if (!this.fldMap[actualKey]) {
            const found = Object.keys(this.fldMap).find(k => k.normalize('NFC') === target.normalize('NFC'));
            if (found) actualKey = found;
            else return;
        }

        const maskedKey = this.fldMap[actualKey];
        const rawK = mask.XOR(maskedKey);
        const fldId = getObjPid(rawK);
        rawK.fill(0);

        await fetch(`${this.serverUrl}/api/storage/${fldId}/names`, {
            method: "DELETE",
            headers: { "X-User-Hash": this.usrHsh }
        });

        delete this.fldMap[actualKey];
        if (this.currentFolderName === actualKey || (this.currentFolderName && this.currentFolderName.normalize('NFC') === actualKey.normalize('NFC'))) {
            this.currentFolderName = "";
            this.currentFolderId = "";
            this.currentFolderKey = null;
            this.flsMap = {};
            SafeSession.removeItem("oldFold");
        }

        await this.saveUser();
        this.invalidateCache();
    }

    async trimFolder(rawFolderName) {
        const target = (rawFolderName || this.currentFolderName || "").trim();
        if (!target) throw new Error("No folder specified");

        let actualKey = target;
        if (!this.fldMap[actualKey]) {
            const found = Object.keys(this.fldMap).find(k => k.normalize('NFC') === target.normalize('NFC'));
            if (found) actualKey = found;
            else throw new Error(`Folder "${target}" not found`);
        }

        const maskedKey = this.fldMap[actualKey];
        const rawK = mask.XOR(maskedKey);
        const fldId = getObjPid(rawK);

        let pids = [];
        if (this.currentFolderName === actualKey && this.currentFolderId === fldId && Object.keys(this.flsMap).length > 0) {
            for (const [, fileKey] of Object.entries(this.flsMap)) {
                const rawFK = mask.XOR(fileKey);
                pids.push(getObjPid(rawFK.slice(0, 44)));
                rawFK.fill(0);
            }
        } else {
            const fldSm = new SymMaster("gcm1", rawK.slice(0, 32));
            const res = await fetch(`${this.serverUrl}/api/storage/${fldId}/names`, {
                headers: { "X-User-Hash": this.usrHsh }
            });
            if (res.ok) {
                const encBytes = new Uint8Array(await res.arrayBuffer());
                if (encBytes.length > 0) {
                    const dec = await fldSm.DeBin(encBytes);
                    const map = DecodeCfg(dec);
                    dec.fill(0);
                    for (const [, fileKey] of Object.entries(map)) {
                        const rawFK = mask.XOR(fileKey);
                        pids.push(getObjPid(rawFK.slice(0, 44)));
                        rawFK.fill(0);
                    }
                }
            }
        }
        rawK.fill(0);

        const res = await fetch(`${this.serverUrl}/api/trim/${fldId}`, {
            method: "POST",
            headers: { "X-User-Hash": this.usrHsh, "Content-Type": "application/json" },
            body: JSON.stringify({ pids })
        });
        const text = await res.text();
        if (!res.ok) throw new Error(text || res.statusText);

        if (this.currentFolderName === actualKey) {
            await this.loadFolderFiles();
        }
        this.invalidateCache();
        return { text, pidsCount: pids.length };
    }

    async selectFolder(folderName) {
        if (!folderName) {
            this.currentFolderName = "";
            this.currentFolderId = "";
            this.currentFolderKey = null;
            this.flsMap = {};
            SafeSession.removeItem("oldFold");
            return false;
        }

        let actualKey = folderName;
        if (!this.fldMap[actualKey]) {
            const found = Object.keys(this.fldMap).find(k => k.normalize('NFC') === folderName.normalize('NFC'));
            if (found) actualKey = found;
            else return false;
        }

        this.currentFolderName = actualKey;
        this.currentFolderKey = this.fldMap[actualKey];
        const rawK = mask.XOR(this.currentFolderKey);
        this.currentFolderId = getObjPid(rawK);
        rawK.fill(0);

        SafeSession.setItem("oldFold", actualKey);
        await this.loadFolderFiles();
        return true;
    }

    async loadFolderFiles() {
        if (!this.currentFolderId || !this.currentFolderKey) {
            this.flsMap = {};
            return;
        }
        this.keywordsBuilt = false;
        this.selectKeywords.clear();

        const res = await fetch(`${this.serverUrl}/api/storage/${this.currentFolderId}/names`);
        if (res.status === 404) {
            this.flsMap = {};
        } else {
            const rawK = mask.XOR(this.currentFolderKey);
            const sm = new SymMaster("gcm1", rawK.slice(0, 32));
            rawK.fill(0);
            const dec = await sm.DeBin(new Uint8Array(await res.arrayBuffer()));
            this.flsMap = DecodeCfg(dec);
            dec.fill(0);
            maskMap(this.flsMap);
        }
        this.buildKeywords();
    }

    async renameFile(rawOldName, rawNewName) {
        const oldName = (rawOldName || "").trim();
        const newName = (rawNewName || "").trim();
        if (!oldName || !newName) throw new Error("File name cannot be empty.");
        if (oldName.normalize('NFC') === newName.normalize('NFC')) return;

        let actualOldName = oldName;
        if (!this.flsMap[actualOldName]) {
            const found = Object.keys(this.flsMap).find(k => k.normalize('NFC') === oldName.normalize('NFC'));
            if (found) actualOldName = found;
            else throw new Error(`Original file "${oldName}" not found.`);
        }

        const duplicate = Object.keys(this.flsMap).find(k => k.normalize('NFC') === newName.normalize('NFC') && k !== actualOldName);
        if (duplicate) throw new Error(`A file named "${newName}" already exists in this folder.`);

        const origFlsMap = { ...this.flsMap };
        try {
            this.flsMap[newName] = this.flsMap[actualOldName];
            delete this.flsMap[actualOldName];

            const rawSK = mask.XOR(this.currentFolderKey);
            const sm = new SymMaster("gcm1", rawSK.slice(0, 32));
            rawSK.fill(0);

            const um = rawMap(this.flsMap);
            const encoded = EncodeCfg(um);
            wipeMap(um);

            const cipherBin = await sm.EnBin(encoded);
            encoded.fill(0);

            const res = await fetch(`${this.serverUrl}/api/storage/${this.currentFolderId}/names`, {
                method: "POST",
                headers: { "X-User-Hash": this.usrHsh },
                body: cipherBin
            });
            if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);

            this.keywordsBuilt = false;
            this.buildKeywords();
            this.invalidateCache();
        } catch (err) {
            this.flsMap = origFlsMap;
            throw err;
        }
    }

    async deleteFile(fileName) {
        const target = (fileName || "").trim();
        if (!target || !this.flsMap[target]) return;

        const rawFK = mask.XOR(this.flsMap[target]);
        const flPid = getObjPid(rawFK.slice(0, 44));
        rawFK.fill(0);

        try {
            await fetch(`${this.serverUrl}/api/media/${this.currentFolderId}/${flPid}/dat`, { method: "DELETE" });
            await fetch(`${this.serverUrl}/api/media/${this.currentFolderId}/${flPid}/thumb`, { method: "DELETE" });
        } catch (e) {
            console.warn("Error deleting media binaries:", e);
        }

        delete this.flsMap[target];

        const rawSK = mask.XOR(this.currentFolderKey);
        const sm = new SymMaster("gcm1", rawSK.slice(0, 32));
        rawSK.fill(0);

        const um = rawMap(this.flsMap);
        const encoded = EncodeCfg(um);
        wipeMap(um);

        const cipherBin = await sm.EnBin(encoded);
        encoded.fill(0);

        const res = await fetch(`${this.serverUrl}/api/storage/${this.currentFolderId}/names`, {
            method: "POST",
            headers: { "X-User-Hash": this.usrHsh },
            body: cipherBin
        });
        if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);

        this.keywordsBuilt = false;
        this.buildKeywords();
        this.invalidateCache();
    }

    async loadThumbnail(folderId, filePid, ext, imgEl, fileKeyRaw) {
        try {
            const res = await fetch(`${this.serverUrl}/api/media/${folderId}/${filePid}/thumb`);
            if (res.status === 404 || !res.ok) {
                imgEl.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='%23333'><rect width='24' height='24' rx='2'/><text x='50%' y='60%' font-family='sans-serif' font-size='5' font-weight='bold' fill='%23aaa' text-anchor='middle'>${ext}</text></svg>`;
                fileKeyRaw.fill(0);
                return;
            }
            const sm = new SymMaster("gcm1", fileKeyRaw.slice(0, 32));
            fileKeyRaw.fill(0);
            imgEl.src = URL.createObjectURL(new Blob([await sm.DeBin(new Uint8Array(await res.arrayBuffer()))]));
        } catch (e) {
            fileKeyRaw.fill(0);
            imgEl.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='%23333'><rect width='24' height='24' rx='2'/><text x='50%' y='60%' font-family='sans-serif' font-size='5' font-weight='bold' fill='%23aaa' text-anchor='middle'>${ext}</text></svg>`;
        }
    }

    getEntrySize(flKeyMasked) {
        if (!flKeyMasked) return 0;
        const raw = mask.XOR(flKeyMasked);
        let sz = 0;
        if (raw.length >= 52) {
            sz = DecodeInt(raw.slice(44, 52));
        }
        raw.fill(0);
        return sz;
    }

    extractTokens(nameOnly) {
        const tokens = [];
        const lower = (nameOnly || "").normalize('NFC').toLowerCase();
        const remaining = lower.replace(BRACKET_PATTERN, (_, group) => {
            const trimmed = group.trim();
            if (trimmed) tokens.push(trimmed);
            return " ";
        });
        const parts = remaining.split(SPLIT_PATTERN);
        for (const p of parts) {
            const trimmed = p.trim();
            if (trimmed) tokens.push(trimmed);
        }
        return tokens;
    }

    isValidKeyword(token) {
        let byteLen = 0;
        for (let i = 0; i < token.length; i++) {
            const code = token.charCodeAt(i);
            if (code <= 0x7F) byteLen += 1;
            else if (code <= 0x7FF) byteLen += 2;
            else byteLen += 3;
        }
        if (byteLen < 4) return false;
        for (let i = 0; i < token.length; i++) {
            const c = token.charAt(i);
            if (c < '0' || c > '9') return true;
        }
        return false;
    }

    buildKeywords() {
        this.availKeywords.length = 0;
        Object.keys(this.keywordCounts).forEach(k => delete this.keywordCounts[k]);
        this.tokenCache.clear();
        const wordCount = {};

        const allFiles = Object.keys(this.flsMap);
        for (const fileName of allFiles) {
            let nameOnly = fileName;
            const dotIdx = fileName.lastIndexOf('.');
            if (dotIdx > 0) nameOnly = fileName.substring(0, dotIdx);

            const tokens = this.extractTokens(nameOnly);
            const unique = new Set(tokens);
            this.tokenCache.set(fileName, unique);

            for (const t of unique) {
                if (this.isValidKeyword(t)) {
                    wordCount[t] = (wordCount[t] || 0) + 1;
                }
            }
        }

        for (const [kw, count] of Object.entries(wordCount)) {
            if (count >= 4) {
                this.availKeywords.push(kw);
                this.keywordCounts[kw] = count;
            }
        }
        this.availKeywords.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        const availSet = new Set(this.availKeywords);
        for (const kw of Array.from(this.selectKeywords)) {
            if (!availSet.has(kw)) this.selectKeywords.delete(kw);
        }
        this.keywordsBuilt = true;
    }

    async fetchFolderFileSizes(folderName) {
        if (!folderName) return {};
        if (this.fileSizeCache[folderName]) return this.fileSizeCache[folderName];

        try {
            const fldKey = this.fldMap[folderName];
            if (!fldKey) return {};

            const rawK = mask.XOR(fldKey);
            const fldId = getObjPid(rawK);
            const fldSm = new SymMaster("gcm1", rawK.slice(0, 32));
            rawK.fill(0);

            const flsRes = await fetch(`${this.serverUrl}/api/storage/${fldId}/names`);
            if (!flsRes.ok) return {};
            const flsDec = await fldSm.DeBin(new Uint8Array(await flsRes.arrayBuffer()));
            const flsMap = DecodeCfg(flsDec);
            flsDec.fill(0);

            const sizes = {};
            for (const [name, flInfo] of Object.entries(flsMap)) {
                if (flInfo && flInfo.length >= 52) {
                    sizes[name] = DecodeInt(flInfo.slice(44, 52));
                }
            }
            this.fileSizeCache[folderName] = sizes;
            return sizes;
        } catch (e) {
            console.warn("Could not load file sizes:", e);
            return {};
        }
    }

    async fetchAllFoldersAndFiles(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this.allFoldersFilesCache && (now - this.allFoldersFilesCacheTime < 30000)) {
            return this.allFoldersFilesCache;
        }

        try {
            const folderEntries = Object.entries(this.fldMap);
            const allFiles = [];

            await Promise.all(folderEntries.map(async ([fName, fldKey]) => {
                try {
                    const rawK = mask.XOR(fldKey);
                    const fldId = getObjPid(rawK);
                    const fldSm = new SymMaster("gcm1", rawK.slice(0, 32));
                    rawK.fill(0);

                    const flsRes = await fetch(`${this.serverUrl}/api/storage/${fldId}/names`);
                    if (!flsRes.ok) return;
                    const flsDec = await fldSm.DeBin(new Uint8Array(await flsRes.arrayBuffer()));
                    const flsMap = DecodeCfg(flsDec);
                    flsDec.fill(0);

                    for (const [flName, flKey] of Object.entries(flsMap)) {
                        let size = 0;
                        if (flKey && flKey.length >= 52) {
                            size = DecodeInt(flKey.slice(44, 52));
                        }
                        allFiles.push({
                            folderName: fName,
                            folderKey: fldKey,
                            folderId: fldId,
                            fileName: flName,
                            fileKey: flKey,
                            size: size
                        });
                    }
                } catch (e) {
                    console.warn(`Error fetching files for folder ${fName}:`, e);
                }
            }));

            this.allFoldersFilesCache = allFiles;
            this.allFoldersFilesCacheTime = Date.now();
            return allFiles;
        } catch (err) {
            console.warn("Could not fetch all folders files:", err);
            return [];
        }
    }

    invalidateCache() {
        this.fileSizeCache = {};
        this.allFoldersFilesCache = null;
        this.allFoldersFilesCacheTime = 0;
    }

    async changePassword(newPw) {
        if (!newPw) throw new Error("Enter new password");
        const username = SafeSession.getItem("username");
        if (!username) throw new Error("Session invalid. Please login again.");

        const pwBytes = NormPW(newPw);
        const saltBytes = SHA3256(new TextEncoder().encode(username + SECRET_PEPPER));
        const hm = new HashMaster("arg2st");
        const [storeKey, newUserKeyRaw] = await hm.KDF(pwBytes, saltBytes);

        const newHash = await getUserPid(storeKey);
        const maskedNewKey = mask.XOR(newUserKeyRaw);
        newUserKeyRaw.fill(0);

        if (newHash === this.usrHsh) {
            throw new Error("New password must be different");
        }

        const check = await fetch(`${this.serverUrl}/api/userdata/${newHash}`);
        if (check.status !== 404) throw new Error("User already exists with this password");

        const rawUK = mask.XOR(maskedNewKey);
        const sm = new SymMaster("gcm1", rawUK);
        rawUK.fill(0);
        const um = rawMap(this.fldMap);
        const encoded = EncodeCfg(um);
        wipeMap(um);

        const saveRes = await fetch(`${this.serverUrl}/api/userdata/${newHash}`, {
            method: "POST",
            headers: { "X-Old-Hash": this.usrHsh },
            body: await sm.EnBin(encoded)
        });
        encoded.fill(0);
        if (!saveRes.ok) throw new Error("Failed to create new user data");

        await fetch(`${this.serverUrl}/api/userdata/${this.usrHsh}`, { method: "DELETE" });

        SafeSession.setItem("userHash", newHash);
        SafeSession.setItem("userKey", toHex(mask.XOR(maskedNewKey)));
        await SafeSession.save();

        this.usrHsh = newHash;
        if (this.usrKey) mask.XOR(this.usrKey).fill(0);
        this.usrKey = maskedNewKey;
    }
}

export const driveService = new DriveService();
