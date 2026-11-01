// Drive service state management !! CHANGE DRIVE FOR OTHER VERSIONS !!
import { Masker, Random, SymMaster } from '../engine/Bencrypt.js';
import { DecodeInt, EncodeInt, PadLen } from '../engine/Opsec.js';
import { SafeSession, ToHex, FromHex, GetObjPid } from './utils.js';
import { Adapter } from './adapter.js';

// ===== Common Constants and Helpers =====
const mask = new Masker();
const bracketPattern = /[\[\(]([^\]\)]+)[\]\)]/g;
const splitPattern = /[._\-\s]+/;

// File stream reader
class FileSrc {
    constructor(file) {
        this.file = file;
        this.off = 0;
    }

    // Read byte chunk slice from File object
    async read(size) {
        if (this.off >= this.file.size) return new Uint8Array(0);
        const chunk = this.file.slice(this.off, this.off + size);
        const buf = await chunk.arrayBuffer();
        this.off += buf.byteLength;
        return new Uint8Array(buf);
    }
}

// Drive service state management
export class DriveService {
    // Initialize state containers, search filters, and upload flags
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

        this.keywordsBuilt = false;
        this.availKeywords = [];
        this.keywordCounts = {};
        this.selectKeywords = new Set();
        this.tokenCache = new Map();

        this.isUploadCancelled = false;
        this.currentUploadXhr = null;
        this.activeUploadFileIdx = -1;
        this.isUploading = false;
    }

    // ===== Basic Functions =====
    // Mask raw key buffer
    MaskKey(rawKey) {
        if (!rawKey) return null;
        return mask.XOR(rawKey);
    }

    // Unmask raw key buffer
    UnmaskKey(maskedKey) {
        if (!maskedKey) return null;
        return mask.XOR(maskedKey);
    }

    // Get filesize from filekey
    GetEntrySize(flKey, isRaw = false) {
        if (!flKey) return 0;
        const raw = isRaw ? flKey : mask.XOR(flKey);
        let sz = 0;
        if (raw.length >= 52) {
            sz = DecodeInt(raw.slice(44, 52));
        }
        if (!isRaw) raw.fill(0);
        return sz;
    }

    // Get filePID from filekey
    GetEntryPid(flKey, isRaw = false) {
        if (!flKey) return "";
        const raw = isRaw ? flKey : mask.XOR(flKey);
        let pid = "";
        try {
            if (raw.length >= 44) {
                pid = GetObjPid(raw.slice(0, 44));
            }
            return pid;
        } finally {
            if (!isRaw) raw.fill(0);
        }
    }

    // ===== User Authentication =====
    // Initialize session
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

    // Reset all session in memory and storage
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

    // Fetch and decrypt folder map
    async LoadUser() {
        if (!this.usrHsh || !this.usrKey) return false;
        const map = await Adapter.LoadUserData(this.usrHsh, this.usrKey);
        this.fldMap = {};
        for (const [k, v] of Object.entries(map)) {
            this.fldMap[k] = mask.XOR(v);
            v.fill(0);
        }
        return true;
    }

    // Encrypt and save folder map
    async SaveUser() {
        if (!this.usrHsh || !this.usrKey) return false;
        const rawMap = {};
        for (const [k, v] of Object.entries(this.fldMap)) {
            rawMap[k] = mask.XOR(v);
        }
        try {
            await Adapter.SaveUserData(this.usrHsh, rawMap, this.usrKey);
            return true;
        } finally {
            for (const v of Object.values(rawMap)) if (v?.fill) v.fill(0);
        }
    }

    // Update account password and re-encrypt userdata
    async ChangePassword(newPw) {
        // Check if valid password and account
        if (!newPw) throw new Error("Enter new password");
        const username = SafeSession.GetItem("username");
        if (!username) throw new Error("Session invalid. Please login again.");

        const { userHash: newHash, maskedKey: maskedNewKey } = await Adapter.DeriveKeys(username, newPw);
        if (newHash === this.usrHsh) {
            throw new Error("New password must be different");
        }
        const exists = await Adapter.CheckUserExists(newHash);
        if (exists) throw new Error("User already exists with this password");

        // Copy and encrypt all data
        const rawMap = {};
        for (const [k, v] of Object.entries(this.fldMap)) {
            rawMap[k] = mask.XOR(v);
        }

        await Adapter.SaveUserData(newHash, rawMap, maskedNewKey, this.usrHsh);
        for (const v of Object.values(rawMap)) if (v?.fill) v.fill(0);

        // Delete old user data
        await fetch(`${this.serverUrl}/api/userdata/${this.usrHsh}`, {
            method: "DELETE",
            headers: { "X-User-Hash": this.usrHsh }
        });

        // Update session
        const rawNewKey = mask.XOR(maskedNewKey);
        SafeSession.SetItem("userHash", newHash);
        SafeSession.SetItem("userKey", ToHex(rawNewKey));
        rawNewKey.fill(0);
        await SafeSession.Save();

        this.usrHsh = newHash;
        this.usrKey = maskedNewKey;
    }

    // ===== Folder Management =====
    // Create a new empty folder entry
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

    // Rename folder in userdata and persist changes
    async RenameFolder(rawOldName, rawNewName) {
        const oldName = (rawOldName || "").trim();
        const newName = (rawNewName || "").trim();
        if (!oldName || !newName) throw new Error("Folder name cannot be empty.");
        if (oldName.normalize('NFC') === newName.normalize('NFC')) return;

        // Find target folder
        let actualOldKey = oldName;
        if (!this.fldMap[actualOldKey]) {
            const found = Object.keys(this.fldMap).find(k => k.normalize('NFC') === oldName.normalize('NFC'));
            if (found) actualOldKey = found;
            else throw new Error(`Original folder "${oldName}" not found.`);
        }

        // Check for duplicate folder name
        const duplicate = Object.keys(this.fldMap).find(k => k.normalize('NFC') === newName.normalize('NFC') && k !== actualOldKey);
        if (duplicate) throw new Error(`A folder named "${newName}" already exists.`);
        const origFldMap = { ...this.fldMap };
        const origCurrentName = this.currentFolderName;

        try { // update folder map
            const maskedKey = this.fldMap[actualOldKey];
            this.fldMap[newName] = maskedKey;
            delete this.fldMap[actualOldKey];

            if (this.currentFolderName === actualOldKey || (this.currentFolderName && this.currentFolderName.normalize('NFC') === actualOldKey.normalize('NFC'))) {
                this.currentFolderName = newName;
                SafeSession.SetItem("oldFold", newName);
            }
            await this.SaveUser();
            this.InvalidateCache();

        } catch (err) { // restore folder map when error
            this.fldMap = origFldMap;
            this.currentFolderName = origCurrentName;
            throw err;
        }
    }

    // Unlink folder from userdata
    async UnlinkFolder(rawFolderName) {
        const target = (rawFolderName || this.currentFolderName || "").trim();
        if (!target) return;

        // Find target folder
        let actualKey = target;
        if (!this.fldMap[actualKey]) {
            const found = Object.keys(this.fldMap).find(k => k.normalize('NFC') === target.normalize('NFC'));
            if (found) actualKey = found;
            else return;
        }

        // Delete from map
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

    // Delete folder from both userdata and server
    async DeleteFolder(rawFolderName) {
        const target = (rawFolderName || this.currentFolderName || "").trim();
        if (!target) return;

        // Find target folder
        let actualKey = target;
        if (!this.fldMap[actualKey]) {
            const found = Object.keys(this.fldMap).find(k => k.normalize('NFC') === target.normalize('NFC'));
            if (found) actualKey = found;
            else return;
        }

        // Delete from server
        const maskedKey = this.fldMap[actualKey];
        const rawK = mask.XOR(maskedKey);
        const fldId = GetObjPid(rawK);
        rawK.fill(0);
        await Adapter.DeleteFolderMeta(fldId, this.usrHsh);

        // Delete from map
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

    // Trim unmapped orphan files
    async TrimFolder(rawFolderName) {
        const target = (rawFolderName || this.currentFolderName || "").trim();
        if (!target) throw new Error("No folder specified");

        // Find target folder
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

        // Get file PID list
        const pids = [];
        if (this.currentFolderName === actualKey && this.currentFolderId === fldId && Object.keys(this.flsMap).length > 0) {
            for (const [, fileKey] of Object.entries(this.flsMap)) {
                const rawFk = mask.XOR(fileKey);
                pids.push(GetObjPid(rawFk.slice(0, 44)));
                rawFk.fill(0);
            }
        } else {
            const map = await Adapter.LoadFolderMeta(fldId, maskedKey);
            for (const [, fileKey] of Object.entries(map)) {
                pids.push(GetObjPid(fileKey.slice(0, 44)));
            }
        }

        // Send trim signal
        const text = await Adapter.TrimFolder(fldId, { pids }, this.usrHsh);
        if (this.currentFolderName === actualKey) {
            await this.LoadFolderFiles();
        }
        this.InvalidateCache();
        return { text, pidsCount: pids.length };
    }

    // Export folder share token
    async ExportShareToken(folderName, password) {
        const maskedKey = this.fldMap[folderName];
        if (!maskedKey) return null;
        return Adapter.ExportShareToken(folderName, maskedKey, password);
    }

    // Import folder share token
    async ImportShareToken(tokenText, password) {
        return Adapter.ImportShareToken(tokenText, password);
    }

    // Select active folder and load its file map
    async SelectFolder(folderName) {
        if (!folderName) { // no folder name, go to root
            this.currentFolderName = "";
            this.currentFolderId = "";
            this.currentFolderKey = null;
            this.flsMap = {};
            SafeSession.RemoveItem("oldFold");
            return false;
        }

        // Find target folder
        let actualKey = folderName;
        if (!this.fldMap[actualKey]) {
            const found = Object.keys(this.fldMap).find(k => k.normalize('NFC') === folderName.normalize('NFC'));
            if (found) actualKey = found;
            else return false;
        }

        // Set active folder
        this.currentFolderName = actualKey;
        this.currentFolderKey = this.fldMap[actualKey];
        const rawK = mask.XOR(this.currentFolderKey);
        this.currentFolderId = GetObjPid(rawK);
        rawK.fill(0);

        SafeSession.SetItem("oldFold", actualKey);
        await this.LoadFolderFiles();
        return true;
    }

    // ===== File Management =====
    // Load and decrypt file map for selected folder
    async LoadFolderFiles() {
        if (!this.currentFolderId || !this.currentFolderKey) {
            this.flsMap = {};
            return;
        }
        this.keywordsBuilt = false;
        this.selectKeywords.clear();

        // Generate file map
        try {
            const map = await Adapter.LoadFolderMeta(this.currentFolderId, this.currentFolderKey);
            this.flsMap = {};
            for (const [k, v] of Object.entries(map || {})) {
                this.flsMap[k] = mask.XOR(v);
                v.fill(0);
            }
        } catch (err) {
            console.warn("Could not load folder map:", err);
            this.flsMap = {};
        }
        this.BuildKeywords();
    }

    // Encrypt and upload files to server
    async UploadFiles(files, callbacks = {}) {
        // Check if valid files and folder
        if (!files || files.length === 0) return;
        if (!this.currentFolderId || !this.currentFolderKey) {
            throw new Error("No folder selected for upload");
        }

        // Set callbacks and variables
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

        try { // upload all file
            for (let i = 0; i < files.length; i++) {
                if (this.isUploadCancelled) break;
                this.activeUploadFileIdx = i;
                const file = files[i];
                if (onFileProgress) onFileProgress(i, 0, files.length); // update progress

                if (this.flsMap[file.name]) { // if file already exists, delete it
                    const oldRaw = mask.XOR(this.flsMap[file.name]);
                    const oldFlPid = GetObjPid(oldRaw.slice(0, 44));
                    oldRaw.fill(0);
                    try {
                        await Adapter.DeleteMedia(folderId, oldFlPid, userHash);
                    } catch (err) {
                        console.warn("Failed to delete existing file binary", err);
                    }
                }

                // Generate new file key
                const fileKey = new Uint8Array(44);
                fileKey.set(Random(32), 0);
                fileKey.set(Random(12), 32);
                const filePid = GetObjPid(fileKey);

                // Generate thumbnail
                let thumb = null;
                const lowerName = file.name.toLowerCase();
                const isImage = (file.type && file.type.startsWith("image/")) || /\.(jpe?g|png|gif|webp|bmp|ico|svg|avif|heic)$/i.test(lowerName);
                const isVideo = (file.type && file.type.startsWith("video/")) || /\.(mp4|webm|mov|mkv|avi|ts|m4v|3gp|flv)$/i.test(lowerName);
                if (isImage) {
                    thumb = await Adapter.MakeImageThumb(file);
                } else if (isVideo) {
                    thumb = await Adapter.MakeVideoThumb(file);
                }
                if (this.isUploadCancelled) throw new Error("UPLOAD_CANCELLED");

                // Encrypt file
                let encryptedBytes = 0;
                const smx = new SymMaster("gcmx1", fileKey.slice(0, 32));
                const encChunks = [];

                await smx.EnFile(new FileSrc(file), file.size, {
                    write: async (chunk) => {
                        if (this.isUploadCancelled) throw new Error("UPLOAD_CANCELLED");
                        encChunks.push(chunk);
                        encryptedBytes += chunk.length;
                        if (onFileProgress) {
                            const percent = Math.min(50, Math.round((encryptedBytes / (file.size || 1)) * 50));
                            onFileProgress(i, percent, files.length);
                        }
                    }
                });
                if (this.isUploadCancelled) throw new Error("UPLOAD_CANCELLED");

                // Create buffer
                const encSize = encChunks.reduce((a, c) => a + c.length, 0);
                const padSize = PadLen(encSize);
                const totSize = encSize + padSize;
                const medBuf = new Uint8Array(totSize);
                let offset = 0;
                for (const chunk of encChunks) {
                    medBuf.set(chunk, offset);
                    offset += chunk.length;
                }

                // Add padding
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

                // Chunked upload (16MB)
                const uploadChunkSize = 16 * 1024 * 1024;
                let uploadOffset = 0;
                do {
                    // Determine offset
                    if (this.isUploadCancelled) throw new Error("UPLOAD_CANCELLED");
                    const nextOffset = Math.min(uploadOffset + uploadChunkSize, totSize);
                    const chunkData = medBuf.subarray(uploadOffset, nextOffset);
                    const curOffset = uploadOffset;

                    // Try up to 3 times
                    let lastErr;
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        if (this.isUploadCancelled) throw new Error("UPLOAD_CANCELLED");

                        try { // POST chunk
                            await new Promise((resolve, reject) => {
                                const xhr = new XMLHttpRequest();
                                this.currentUploadXhr = xhr;
                                xhr.open("POST", `${this.serverUrl}/api/media/${folderId}/${filePid}/dat`);
                                xhr.setRequestHeader("X-User-Hash", userHash);
                                xhr.setRequestHeader("X-Upload-Offset", curOffset.toString());
                                xhr.upload.onprogress = (e) => {
                                    if (e.lengthComputable && onFileProgress) {
                                        const loadedBytes = curOffset + e.loaded;
                                        const uploadPercent = 50 + Math.min(45, Math.round((loadedBytes / (totSize || 1)) * 45));
                                        onFileProgress(i, uploadPercent, files.length);
                                    }
                                };
                                xhr.onload = () => {
                                    if (xhr.status >= 200 && xhr.status < 300) resolve();
                                    else reject(new Error(`Upload failed with status ${xhr.status}`));
                                };
                                xhr.onabort = () => reject(new Error("UPLOAD_CANCELLED"));
                                xhr.onerror = () => reject(new Error("Network upload failed"));
                                xhr.send(chunkData);
                            });
                            lastErr = null;
                            break;

                        } catch (err) { // handle fail/abort error
                            if (this.isUploadCancelled || err.message === "UPLOAD_CANCELLED") throw err;
                            lastErr = err;
                            console.warn(`Upload chunk at offset ${curOffset} attempt ${attempt} failed:`, err);
                            if (attempt < 3) await new Promise(r => setTimeout(r, 300 * attempt));

                        } finally { // clear current upload xhr
                            this.currentUploadXhr = null;
                        }
                    }

                    // Abort if 3rd error, update offset
                    if (lastErr) throw lastErr;
                    uploadOffset = nextOffset;
                } while (uploadOffset < totSize);

                // Upload thumbnail if available
                if (thumb) {
                    const thmSm = new SymMaster("gcm1", fileKey.slice(0, 32));
                    await fetch(`${this.serverUrl}/api/media/${folderId}/${filePid}/thumb`, {
                        method: "POST",
                        headers: { "X-User-Hash": userHash },
                        body: await thmSm.EnBin(new Uint8Array(await thumb.arrayBuffer()))
                    });
                }

                // Update progress
                if (onFileProgress) onFileProgress(i, 100, files.length);
                if (onFileComplete) onFileComplete(i, file.name);

                // Update file map
                const flInfo = new Uint8Array(52);
                flInfo.set(fileKey, 0);
                flInfo.set(EncodeInt(file.size, 8), 44);
                this.flsMap[file.name] = mask.XOR(flInfo);
                fileKey.fill(0);
                flInfo.fill(0);
                uploadedCount++;
            }

            // Update folder map on server
            if (uploadedCount > 0 && !this.isUploadCancelled) {
                if (onSyncing) onSyncing();
                const rawMap = {};
                for (const [k, v] of Object.entries(this.flsMap)) {
                    rawMap[k] = mask.XOR(v);
                }
                try {
                    await Adapter.SaveFolderMeta(folderId, rawMap, this.currentFolderKey, userHash);
                } catch (saveErr) {
                    console.warn('SaveFolderMeta failed (may be first upload):', saveErr); // SaveFolderMeta may fail on first upload
                } finally {
                    for (const v of Object.values(rawMap)) if (v?.fill) v.fill(0);
                }

                this.keywordsBuilt = false;
                this.BuildKeywords();
                this.InvalidateCache();
            }
            if (onComplete) onComplete(uploadedCount);

        } catch (err) { // catch upload error
            if (err.message === "UPLOAD_CANCELLED") {
                if (onCancel) onCancel(this.activeUploadFileIdx);
            } else {
                throw err;
            }

        } finally { // reset upload state
            this.isUploadCancelled = false;
            this.isUploading = false;
            this.currentUploadXhr = null;
            this.activeUploadFileIdx = -1;
        }
    }

    // Cancel in-flight upload operation
    CancelUpload(fileIdx) {
        this.isUploadCancelled = true;
        if (this.currentUploadXhr) {
            try { this.currentUploadXhr.abort(); } catch { }
        }
    }

    // Rename file in active folder and sync metadata
    async RenameFile(rawOldName, rawNewName) {
        // Check if valid names
        const oldName = (rawOldName || "").trim();
        const newName = (rawNewName || "").trim();
        if (!oldName || !newName) throw new Error("File name cannot be empty.");
        if (oldName.normalize('NFC') === newName.normalize('NFC')) return;

        // Find target file
        let actualOldName = oldName;
        if (!this.flsMap[actualOldName]) {
            const found = Object.keys(this.flsMap).find(k => k.normalize('NFC') === oldName.normalize('NFC'));
            if (found) actualOldName = found;
            else throw new Error(`Original file "${oldName}" not found.`);
        }

        // Check if duplicate
        const duplicate = Object.keys(this.flsMap).find(k => k.normalize('NFC') === newName.normalize('NFC') && k !== actualOldName);
        if (duplicate) throw new Error(`A file named "${newName}" already exists in this folder.`);
        const origFlsMap = { ...this.flsMap };

        try { // update file map
            this.flsMap[newName] = this.flsMap[actualOldName];
            delete this.flsMap[actualOldName];

            const rawMap = {};
            for (const [k, v] of Object.entries(this.flsMap)) {
                rawMap[k] = mask.XOR(v);
            }
            await Adapter.SaveFolderMeta(this.currentFolderId, rawMap, this.currentFolderKey, this.usrHsh);
            for (const v of Object.values(rawMap)) if (v?.fill) v.fill(0);

            this.keywordsBuilt = false;
            this.BuildKeywords();
            this.InvalidateCache();

        } catch (err) { // restore file map when error
            this.flsMap = origFlsMap;
            throw err;
        }
    }

    // Delete file and associated binaries from server
    async DeleteFile(fileName) {
        // Check if valid name
        const target = (fileName || "").trim();
        if (!target || !this.flsMap[target]) return;

        const rawFk = mask.XOR(this.flsMap[target]);
        const flPid = GetObjPid(rawFk.slice(0, 44));
        rawFk.fill(0);

        // Delete file from server
        try {
            await Adapter.DeleteMedia(this.currentFolderId, flPid, this.usrHsh);
        } catch (err) {
            console.warn("Error deleting file:", err);
        }

        // Delete file from file map
        delete this.flsMap[target];
        const rawMap = {};
        for (const [k, v] of Object.entries(this.flsMap)) {
            rawMap[k] = mask.XOR(v);
        }
        await Adapter.SaveFolderMeta(this.currentFolderId, rawMap, this.currentFolderKey, this.usrHsh);
        for (const v of Object.values(rawMap)) if (v?.fill) v.fill(0);

        this.keywordsBuilt = false;
        this.BuildKeywords();
        this.InvalidateCache();
    }

    // ===== File Helpers =====
    // Reset cached file sizes and file lists
    InvalidateCache() {
        this.fileSizeCache = {};
        this.allFoldersFilesCache = null;
        this.allFoldersFilesCacheTime = 0;
    }

    // Fetch and render thumbnail for file item
    async LoadThumbnail(folderId, filePid, ext, imgEl, maskedFileKey) {
        try {
            const thumbUrl = await Adapter.LoadThumbnailUrl(folderId, filePid, maskedFileKey);
            if (thumbUrl) {
                imgEl.src = thumbUrl;
            } else {
                imgEl.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='%23333'><rect width='24' height='24' rx='2'/><text x='50%' y='60%' font-family='sans-serif' font-size='5' font-weight='bold' fill='%23aaa' text-anchor='middle'>${ext}</text></svg>`;
            }
        } catch (err) {
            imgEl.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='%23333'><rect width='24' height='24' rx='2'/><text x='50%' y='60%' font-family='sans-serif' font-size='5' font-weight='bold' fill='%23aaa' text-anchor='middle'>${ext}</text></svg>`;
        }
    }

    // Extract search keywords from file name
    ExtractTokens(nameOnly) {
        const tokens = [];
        const lower = (nameOnly || "").normalize('NFC').toLowerCase();
        const remaining = lower.replace(bracketPattern, (_, group) => {
            const trimmed = group.trim();
            if (trimmed) tokens.push(trimmed);
            return " ";
        });
        const parts = remaining.split(splitPattern);
        for (const p of parts) {
            const trimmed = p.trim();
            if (trimmed) tokens.push(trimmed);
        }
        return tokens;
    }

    // Check if token qualifies as a search keyword
    IsValidKeyword(token) {
        let byteLen = 0;
        for (let i = 0; i < token.length; i++) {
            const code = token.charCodeAt(i);
            if (code <= 0x7F) byteLen += 1;
            else if (code <= 0x7FF) byteLen += 2;
            else byteLen += 3;
        }
        if (byteLen < 4) return false; // invalid if shorter than 4B
        for (let i = 0; i < token.length; i++) {
            const c = token.charAt(i);
            if (c < '0' || c > '9') return true;
        } // invalid if all number
        return false;
    }

    // Build keyword index for tag filtering
    BuildKeywords() {
        this.availKeywords.length = 0;
        Object.keys(this.keywordCounts).forEach(k => delete this.keywordCounts[k]);
        this.tokenCache.clear();
        const wordCount = {};

        // Collect file name tokens
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

        // Select keywords that appear 4+ times
        for (const [kw, count] of Object.entries(wordCount)) {
            if (count >= 4) {
                this.availKeywords.push(kw);
                this.keywordCounts[kw] = count;
            }
        }
        this.availKeywords.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        // Remove keywords that are no longer available
        const availSet = new Set(this.availKeywords);
        for (const kw of Array.from(this.selectKeywords)) {
            if (!availSet.has(kw)) this.selectKeywords.delete(kw);
        }
        this.keywordsBuilt = true;
    }

    // Fetch and cache file sizes for specified folder
    async FetchFolderFileSizes(folderName) {
        if (!folderName) return {};
        if (this.fileSizeCache[folderName]) return this.fileSizeCache[folderName];

        try { // fetch all filesize from filemap
            const fldKey = this.fldMap[folderName];
            if (!fldKey) return {};
            const rawK = mask.XOR(fldKey);
            const fldId = GetObjPid(rawK);
            rawK.fill(0);

            const flsMap = await Adapter.LoadFolderMeta(fldId, fldKey);
            const sizes = {};
            for (const [name, flInfo] of Object.entries(flsMap)) {
                if (flInfo && flInfo.length >= 52) {
                    sizes[name] = DecodeInt(flInfo.slice(44, 52));
                }
            }
            this.fileSizeCache[folderName] = sizes;
            return sizes;

        } catch (err) {
            console.warn("Could not load file sizes:", err);
            return {};
        }
    }

    // Fetch all files across all folders with caching
    async FetchAllFiles(forceRefresh = false) {
        const now = Date.now(); // TTL 30s
        if (!forceRefresh && this.allFoldersFilesCache && (now - this.allFoldersFilesCacheTime < 30000)) {
            return this.allFoldersFilesCache;
        }

        try { // load all folders
            const folderEntries = Object.entries(this.fldMap);
            const allFiles = [];

            await Promise.all(folderEntries.map(async ([fName, fldKey]) => {
                try {
                    const rawK = mask.XOR(fldKey);
                    const fldId = GetObjPid(rawK);
                    rawK.fill(0);

                    // Load all files in this folder
                    const flsMap = await Adapter.LoadFolderMeta(fldId, fldKey);
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
                            fileKey: mask.XOR(flKey),
                            size: size
                        });
                    }
                } catch (err) {
                    console.warn(`Error fetching files for folder ${fName}:`, err);
                }
            }));

            this.allFoldersFilesCache = allFiles;
            this.allFoldersFilesCacheTime = Date.now();
            return allFiles;
        } catch (err) {
            console.warn("Could not fetch files:", err);
            return [];
        }
    }

    // Sanitize file list and deduplicate names
    PrepareFiles(fileList) {
        const dt = new DataTransfer();
        const ignoredNames = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]); // OS related files
        const seenNames = new Set();

        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            if (file.name.startsWith("._") || ignoredNames.has(file.name)) continue; // ignore MacOS resource fork files

            let finalName = file.name;
            if (seenNames.has(finalName)) { // handle duplicate file names
                if (file.webkitRelativePath) {
                    const parts = file.webkitRelativePath.split('/'); // handle nested folder
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
                    finalName = `${base} (${counter})${ext}`; // add counter to filename to make it unique
                    counter++;
                }
            }
            seenNames.add(finalName);

            const uploadFile = (finalName === file.name) ? file : new File([file], finalName, { type: file.type, lastModified: file.lastModified });
            dt.items.add(uploadFile);
        }
        return Array.from(dt.files);
    }
}

// Global drive service instance
export const Drive = new DriveService();
