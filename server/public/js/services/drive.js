// MediaHub Drive Service (Domain State Management, Upload Pipeline & Orchestration)
import { Masker, Random, SymMaster } from './engine/Bencrypt.js';
import { DecodeInt, EncodeInt, PadLen } from './engine/Opsec.js';
import { SafeSession } from './core/session.js';
import { ToHex, FromHex, GetObjPid, FormatBytes } from './core/utils.js';
import { adapter } from './adapter.js';

const mask = new Masker();
const BRACKET_PATTERN = /[\[\(]([^\]\)]+)[\]\)]/g;
const SPLIT_PATTERN = /[._\-\s]+/;

// File chunk stream source reader for client-side file encryption
class FileSrc {
    constructor(file) {
        this.file = file;
        this.off = 0;
    }
    // Read specified chunk byte slice from underlying File object
    async read(size) {
        if (this.off >= this.file.size) return new Uint8Array(0);
        const chunk = this.file.slice(this.off, this.off + size);
        const buf = await chunk.arrayBuffer();
        this.off += buf.byteLength;
        return new Uint8Array(buf);
    }
}

export class DriveService {
    // Initialize DriveService domain state containers, upload flags and caches
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

        // Upload pipeline state
        this.isUploadCancelled = false;
        this.currentUploadXhr = null;
        this.activeUploadFileIdx = -1;
        this.isUploading = false;
    }

    // Mask raw cryptographic key buffer with XOR mask
    MaskKey(rawKey) {
        if (!rawKey) return null;
        return mask.XOR(rawKey);
    }

    // Unmask XOR-masked key into a fresh raw key buffer
    UnmaskKey(maskedKey) {
        if (!maskedKey) return null;
        return mask.XOR(maskedKey);
    }

    // Initialize authenticated user session from SafeSession store
    async InitSession() {
        await SafeSession.Init();
        this.usrHsh = SafeSession.GetItem("userHash");
        const rawUkHex = SafeSession.GetItem("userKey");
        if (rawUkHex) {
            const raw = FromHex(rawUkHex);
            this.usrKey = mask.XOR(raw);
            raw.fill(0);
        } else {
            this.usrKey = null;
        }
        return Boolean(this.usrHsh && this.usrKey);
    }

    // Clear active session memory and reset all local state
    ClearSession() {
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
        SafeSession.Clear();
    }

    // Load and decrypt user folder catalog through backend adapter
    async LoadUser() {
        if (!this.usrHsh || !this.usrKey) return false;
        const map = await adapter.LoadUserData(this.usrHsh, this.usrKey);
        this.fldMap = {};
        for (const [k, v] of Object.entries(map)) {
            this.fldMap[k] = mask.XOR(v);
            v.fill(0);
        }
        return true;
    }

    // Encrypt and persist user folder catalog through backend adapter
    async SaveUser() {
        if (!this.usrHsh || !this.usrKey) return false;
        const rawMap = {};
        for (const [k, v] of Object.entries(this.fldMap)) {
            rawMap[k] = mask.XOR(v);
        }
        try {
            await adapter.SaveUserData(this.usrHsh, rawMap, this.usrKey);
            return true;
        } finally {
            for (const v of Object.values(rawMap)) if (v?.fill) v.fill(0);
        }
    }

    // Create a new folder with cryptographically random key
    async CreateFolder(name) {
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
        await this.SaveUser();
        this.InvalidateCache();
        return trimmed;
    }

    // Rename existing folder in local map and save user metadata
    async RenameFolder(rawOldName, rawNewName) {
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
                SafeSession.SetItem("oldFold", newName);
            }

            await this.SaveUser();
            this.InvalidateCache();
        } catch (err) {
            this.fldMap = origFldMap;
            this.currentFolderName = origCurrentName;
            throw err;
        }
    }

    // Unlink folder from current user catalog without deleting remote files
    async UnlinkFolder(rawFolderName) {
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
            SafeSession.RemoveItem("oldFold");
        }

        await this.SaveUser();
        this.InvalidateCache();
    }

    // Permanently delete folder metadata and binary content from server
    async DeleteFolder(rawFolderName) {
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
        const fldId = GetObjPid(rawK);
        rawK.fill(0);

        await adapter.DeleteFolderMeta(fldId, this.usrHsh);

        delete this.fldMap[actualKey];
        if (this.currentFolderName === actualKey || (this.currentFolderName && this.currentFolderName.normalize('NFC') === actualKey.normalize('NFC'))) {
            this.currentFolderName = "";
            this.currentFolderId = "";
            this.currentFolderKey = null;
            this.flsMap = {};
            SafeSession.RemoveItem("oldFold");
        }

        await this.SaveUser();
        this.InvalidateCache();
    }

    // Trim orphan file objects from folder repository
    async TrimFolder(rawFolderName) {
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
        const fldId = GetObjPid(rawK);
        rawK.fill(0);

        const pids = [];
        if (this.currentFolderName === actualKey && this.currentFolderId === fldId && Object.keys(this.flsMap).length > 0) {
            for (const [, fileKey] of Object.entries(this.flsMap)) {
                const rawFk = mask.XOR(fileKey);
                pids.push(GetObjPid(rawFk.slice(0, 44)));
                rawFk.fill(0);
            }
        } else {
            const map = await adapter.LoadFolderMeta(fldId, maskedKey);
            for (const [, fileKey] of Object.entries(map)) {
                pids.push(GetObjPid(fileKey.slice(0, 44)));
            }
        }

        const text = await adapter.TrimFolder(fldId, { pids }, this.usrHsh);
        if (this.currentFolderName === actualKey) {
            await this.LoadFolderFiles();
        }
        this.InvalidateCache();
        return { text, pidsCount: pids.length };
    }

    // Select active folder by name and load associated file metadata
    async SelectFolder(folderName) {
        if (!folderName) {
            this.currentFolderName = "";
            this.currentFolderId = "";
            this.currentFolderKey = null;
            this.flsMap = {};
            SafeSession.RemoveItem("oldFold");
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
        this.currentFolderId = GetObjPid(rawK);
        rawK.fill(0);

        SafeSession.SetItem("oldFold", actualKey);
        await this.LoadFolderFiles();
        return true;
    }

    // Load and decrypt file catalog for the currently selected folder
    async LoadFolderFiles() {
        if (!this.currentFolderId || !this.currentFolderKey) {
            this.flsMap = {};
            return;
        }
        this.keywordsBuilt = false;
        this.selectKeywords.clear();

        const map = await adapter.LoadFolderMeta(this.currentFolderId, this.currentFolderKey);
        this.flsMap = {};
        for (const [k, v] of Object.entries(map)) {
            this.flsMap[k] = mask.XOR(v);
            v.fill(0);
        }
        this.BuildKeywords();
    }

    // Rename a file within the current folder
    async RenameFile(rawOldName, rawNewName) {
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

            const rawMap = {};
            for (const [k, v] of Object.entries(this.flsMap)) {
                rawMap[k] = mask.XOR(v);
            }
            await adapter.SaveFolderMeta(this.currentFolderId, rawMap, this.currentFolderKey, this.usrHsh);
            for (const v of Object.values(rawMap)) if (v?.fill) v.fill(0);

            this.keywordsBuilt = false;
            this.BuildKeywords();
            this.InvalidateCache();
        } catch (err) {
            this.flsMap = origFlsMap;
            throw err;
        }
    }

    // Delete a file and its associated binary blobs from the server
    async DeleteFile(fileName) {
        const target = (fileName || "").trim();
        if (!target || !this.flsMap[target]) return;

        const rawFk = mask.XOR(this.flsMap[target]);
        const flPid = GetObjPid(rawFk.slice(0, 44));
        rawFk.fill(0);

        try {
            await adapter.DeleteMedia(this.currentFolderId, flPid, this.usrHsh);
        } catch (e) {
            console.warn("Error deleting media binaries:", e);
        }

        delete this.flsMap[target];

        const rawMap = {};
        for (const [k, v] of Object.entries(this.flsMap)) {
            rawMap[k] = mask.XOR(v);
        }
        await adapter.SaveFolderMeta(this.currentFolderId, rawMap, this.currentFolderKey, this.usrHsh);
        for (const v of Object.values(rawMap)) if (v?.fill) v.fill(0);

        this.keywordsBuilt = false;
        this.BuildKeywords();
        this.InvalidateCache();
    }

    // Load and decrypt thumbnail image for a file through backend adapter
    async LoadThumbnail(folderId, filePid, ext, imgEl, fileKeyRaw) {
        try {
            const maskedFk = mask.XOR(fileKeyRaw);
            const thumbUrl = await adapter.LoadThumbnailUrl(folderId, filePid, maskedFk);
            fileKeyRaw.fill(0);
            if (thumbUrl) {
                imgEl.src = thumbUrl;
            } else {
                imgEl.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='%23333'><rect width='24' height='24' rx='2'/><text x='50%' y='60%' font-family='sans-serif' font-size='5' font-weight='bold' fill='%23aaa' text-anchor='middle'>${ext}</text></svg>`;
            }
        } catch (e) {
            fileKeyRaw.fill(0);
            imgEl.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='%23333'><rect width='24' height='24' rx='2'/><text x='50%' y='60%' font-family='sans-serif' font-size='5' font-weight='bold' fill='%23aaa' text-anchor='middle'>${ext}</text></svg>`;
        }
    }

    // Extract decoded original file size from masked file key
    GetEntrySize(flKeyMasked) {
        if (!flKeyMasked) return 0;
        const raw = mask.XOR(flKeyMasked);
        let sz = 0;
        if (raw.length >= 52) {
            sz = DecodeInt(raw.slice(44, 52));
        }
        raw.fill(0);
        return sz;
    }

    // Extract search keyword tokens from raw filename string
    ExtractTokens(nameOnly) {
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

    // Validate if keyword token meets minimum length and character requirements
    IsValidKeyword(token) {
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

    // Build keyword frequency index for keyword filtering
    BuildKeywords() {
        this.availKeywords.length = 0;
        Object.keys(this.keywordCounts).forEach(k => delete this.keywordCounts[k]);
        this.tokenCache.clear();
        const wordCount = {};

        const allFiles = Object.keys(this.flsMap);
        for (const fileName of allFiles) {
            let nameOnly = fileName;
            const dotIdx = fileName.lastIndexOf('.');
            if (dotIdx > 0) nameOnly = fileName.substring(0, dotIdx);

            const tokens = this.ExtractTokens(nameOnly);
            const unique = new Set(tokens);
            this.tokenCache.set(fileName, unique);

            for (const t of unique) {
                if (this.IsValidKeyword(t)) {
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

    // Fetch and cache file sizes across a specific folder
    async FetchFolderFileSizes(folderName) {
        if (!folderName) return {};
        if (this.fileSizeCache[folderName]) return this.fileSizeCache[folderName];

        try {
            const fldKey = this.fldMap[folderName];
            if (!fldKey) return {};

            const rawK = mask.XOR(fldKey);
            const fldId = GetObjPid(rawK);
            rawK.fill(0);

            const flsMap = await adapter.LoadFolderMeta(fldId, fldKey);
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

    // Fetch all files across all user folders with caching
    async FetchAllFiles(forceRefresh = false) {
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
                    const fldId = GetObjPid(rawK);
                    rawK.fill(0);

                    const flsMap = await adapter.LoadFolderMeta(fldId, fldKey);
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

    // Invalidate local in-memory caches
    InvalidateCache() {
        this.fileSizeCache = {};
        this.allFoldersFilesCache = null;
        this.allFoldersFilesCacheTime = 0;
    }

    // Change master account password and migrate user encrypted data
    async ChangePassword(newPw) {
        if (!newPw) throw new Error("Enter new password");
        const username = SafeSession.GetItem("username");
        if (!username) throw new Error("Session invalid. Please login again.");

        const { userHash: newHash, maskedKey: maskedNewKey } = await adapter.DeriveKeys(username, newPw);
        if (newHash === this.usrHsh) {
            throw new Error("New password must be different");
        }

        const exists = await adapter.CheckUserExists(newHash);
        if (exists) throw new Error("User already exists with this password");

        const rawMap = {};
        for (const [k, v] of Object.entries(this.fldMap)) {
            rawMap[k] = mask.XOR(v);
        }

        await adapter.SaveUserData(newHash, rawMap, maskedNewKey, this.usrHsh);
        for (const v of Object.values(rawMap)) if (v?.fill) v.fill(0);

        await fetch(`${this.serverUrl}/api/userdata/${this.usrHsh}`, { method: "DELETE" });

        const rawNewKey = mask.XOR(maskedNewKey);
        SafeSession.SetItem("userHash", newHash);
        SafeSession.SetItem("userKey", ToHex(rawNewKey));
        rawNewKey.fill(0);
        await SafeSession.Save();

        this.usrHsh = newHash;
        this.usrKey = maskedNewKey;
    }

    // Export folder share token using password
    async ExportShareToken(folderName, password) {
        const maskedKey = this.fldMap[folderName];
        if (!maskedKey) return null;
        return adapter.ExportShareToken(folderName, maskedKey, password);
    }

    // Import folder share token using password
    async ImportShareToken(tokenText, password) {
        return adapter.ImportShareToken(tokenText, password);
    }

    // Cancel current active upload pipeline
    CancelUpload(fileIdx) {
        this.isUploadCancelled = true;
        if (this.currentUploadXhr) {
            try {
                this.currentUploadXhr.abort();
            } catch (_) { }
        }
    }

    // Prepare and sanitize file list for upload
    PrepareFiles(fileList) {
        const dt = new DataTransfer();
        const ignoredNames = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
        const seenNames = new Set();

        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            if (file.name.startsWith("._") || ignoredNames.has(file.name)) continue;

            let finalName = file.name;
            if (seenNames.has(finalName)) {
                if (file.webkitRelativePath) {
                    const parts = file.webkitRelativePath.split('/');
                    if (parts.length > 1) {
                        parts.shift();
                        finalName = parts.join('_');
                    }
                }
                let counter = 1;
                const origName = finalName;
                const lastDot = origName.lastIndexOf('.');
                const base = lastDot > 0 ? origName.slice(0, lastDot) : origName;
                const ext = lastDot > 0 ? origName.slice(lastDot) : '';
                while (seenNames.has(finalName)) {
                    finalName = `${base} (${counter})${ext}`;
                    counter++;
                }
            }
            seenNames.add(finalName);

            const uploadFile = (finalName === file.name)
                ? file
                : new File([file], finalName, { type: file.type, lastModified: file.lastModified });

            dt.items.add(uploadFile);
        }
        return Array.from(dt.files);
    }

    // Encrypt and upload files to server storage with progress reporting
    async UploadFiles(files, callbacks = {}) {
        if (!files || files.length === 0) return;
        if (!this.currentFolderId || !this.currentFolderKey) {
            throw new Error("No folder selected for upload");
        }

        const {
            onStart,
            onFileProgress,
            onFileComplete,
            onSyncing,
            onComplete,
            onCancel
        } = callbacks;

        this.isUploadCancelled = false;
        this.isUploading = true;
        this.activeUploadFileIdx = -1;

        if (onStart) onStart(files);

        const folderId = this.currentFolderId;
        const userHash = this.usrHsh;
        let uploadedCount = 0;

        try {
            for (let i = 0; i < files.length; i++) {
                if (this.isUploadCancelled) break;
                this.activeUploadFileIdx = i;
                const file = files[i];

                if (onFileProgress) onFileProgress(i, 0, files.length);

                // Delete existing duplicate binary on overwrite
                if (this.flsMap[file.name]) {
                    const oldRaw = mask.XOR(this.flsMap[file.name]);
                    const oldFlPid = GetObjPid(oldRaw.slice(0, 44));
                    oldRaw.fill(0);
                    try {
                        await adapter.DeleteMedia(folderId, oldFlPid, userHash);
                    } catch (e) {
                        console.warn("Failed to delete existing file binary", e);
                    }
                }

                const fileKey = new Uint8Array(44);
                fileKey.set(Random(32), 0);
                fileKey.set(Random(12), 32);
                const filePid = GetObjPid(fileKey);

                // Make thumbnail
                let thumb = null;
                if (file.type.startsWith("image/") || file.name.toLowerCase().endsWith(".svg")) {
                    thumb = await adapter.MakeImageThumb(file);
                } else if (file.type.startsWith("video/")) {
                    thumb = await adapter.MakeVideoThumb(file);
                }

                if (this.isUploadCancelled) throw new Error("UPLOAD_CANCELLED");

                // Encrypt file with progress (0% -> 50%)
                let encryptedBytes = 0;
                const smx = new SymMaster("gcmx1", fileKey.slice(0, 32));
                const encChks = [];

                await smx.EnFile(new FileSrc(file), file.size, {
                    write: async (c) => {
                        if (this.isUploadCancelled) throw new Error("UPLOAD_CANCELLED");
                        encChks.push(c);
                        encryptedBytes += c.length;
                        if (onFileProgress) {
                            const percent = Math.min(50, Math.round((encryptedBytes / (file.size || 1)) * 50));
                            onFileProgress(i, percent, files.length);
                        }
                    }
                });

                if (this.isUploadCancelled) throw new Error("UPLOAD_CANCELLED");

                // Padding
                const encSize = encChks.reduce((a, c) => a + c.length, 0);
                const padSize = PadLen(encSize);
                const totSize = encSize + padSize;
                const medBuf = new Uint8Array(totSize);
                let offset = 0;
                for (const c of encChks) {
                    medBuf.set(c, offset);
                    offset += c.length;
                }

                if (padSize > 0) {
                    let pOff = offset;
                    const pEnd = offset + padSize;
                    while (pOff < pEnd) {
                        const chunk = Math.min(32768, pEnd - pOff);
                        medBuf.set(Random(chunk), pOff);
                        pOff += chunk;
                    }
                }

                if (this.isUploadCancelled) throw new Error("UPLOAD_CANCELLED");

                // Network upload via XHR (50% -> 95%)
                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    this.currentUploadXhr = xhr;
                    xhr.open("POST", `${this.serverUrl}/api/media/${folderId}/${filePid}/dat`);
                    xhr.setRequestHeader("X-User-Hash", userHash);
                    xhr.upload.onprogress = (e) => {
                        if (e.lengthComputable && onFileProgress) {
                            const uploadPercent = 50 + Math.min(45, Math.round((e.loaded / e.total) * 45));
                            onFileProgress(i, uploadPercent, files.length);
                        }
                    };
                    xhr.onload = () => {
                        if (xhr.status >= 200 && xhr.status < 300) resolve();
                        else reject(new Error(`Upload failed with status ${xhr.status}`));
                    };
                    xhr.onabort = () => reject(new Error("UPLOAD_CANCELLED"));
                    xhr.onerror = () => reject(new Error("Network upload failed"));
                    xhr.send(medBuf);
                });
                this.currentUploadXhr = null;

                // Upload thumbnail
                if (thumb) {
                    const thmSm = new SymMaster("gcm1", fileKey.slice(0, 32));
                    await fetch(`${this.serverUrl}/api/media/${folderId}/${filePid}/thumb`, {
                        method: "POST",
                        headers: { "X-User-Hash": userHash },
                        body: await thmSm.EnBin(new Uint8Array(await thumb.arrayBuffer()))
                    });
                }

                if (onFileProgress) onFileProgress(i, 100, files.length);
                if (onFileComplete) onFileComplete(i, file.name);

                const flInfo = new Uint8Array(52);
                flInfo.set(fileKey, 0);
                flInfo.set(EncodeInt(file.size, 8), 44);
                this.flsMap[file.name] = mask.XOR(flInfo);
                fileKey.fill(0);
                flInfo.fill(0);
                uploadedCount++;
            }

            // Sync metadata
            if (uploadedCount > 0 && !this.isUploadCancelled) {
                if (onSyncing) onSyncing();
                const rawMap = {};
                for (const [k, v] of Object.entries(this.flsMap)) {
                    rawMap[k] = mask.XOR(v);
                }
                await adapter.SaveFolderMeta(folderId, rawMap, this.currentFolderKey, userHash);
                for (const v of Object.values(rawMap)) if (v?.fill) v.fill(0);

                this.keywordsBuilt = false;
                this.BuildKeywords();
                this.InvalidateCache();
            }

            if (onComplete) onComplete(uploadedCount);
        } catch (err) {
            if (err.message === "UPLOAD_CANCELLED") {
                if (onCancel) onCancel(this.activeUploadFileIdx);
            } else {
                throw err;
            }
        } finally {
            this.isUploadCancelled = false;
            this.isUploading = false;
            this.currentUploadXhr = null;
            this.activeUploadFileIdx = -1;
        }
    }
}

// Global drive service singleton instance
export const driveService = new DriveService();
