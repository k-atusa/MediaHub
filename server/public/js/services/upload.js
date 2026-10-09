// MediaHub Upload Pipeline Service (Chunk Encryption, Padding & XHR Progress Upload)
import { SymMaster, Random, Masker } from '../engine/Bencrypt.js';
import { EncodeCfg, EncodeInt, PadLen } from '../engine/Opsec.js';
import { makeImg, makeVid } from '../core/media.js';
import { getObjPid } from '../core/utils.js';
import { driveService } from './drive.js';

const mask = new Masker();

class FileSrc {
    constructor(file) {
        this.file = file;
        this.off = 0;
    }
    async read(size) {
        if (this.off >= this.file.size) return new Uint8Array(0);
        const chunk = this.file.slice(this.off, this.off + size);
        const buf = await chunk.arrayBuffer();
        this.off += buf.byteLength;
        return new Uint8Array(buf);
    }
}

class UploadService {
    constructor() {
        this.isCancelled = false;
        this.currentXHR = null;
        this.activeFileIdx = -1;
        this.isUploading = false;
    }

    cancelUpload(fileIdx) {
        this.isCancelled = true;
        if (this.currentXHR) {
            try {
                this.currentXHR.abort();
            } catch (_) { }
        }
    }

    // Filter OS junk and disambiguate duplicate names
    prepareFiles(fileList) {
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

    async uploadFiles(files, callbacks = {}) {
        if (!files || files.length === 0) return;
        if (!driveService.currentFolderId || !driveService.currentFolderKey) {
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

        this.isCancelled = false;
        this.isUploading = true;
        this.activeFileIdx = -1;

        if (onStart) onStart(files);

        const folderId = driveService.currentFolderId;
        const userHash = driveService.usrHsh;
        let uploadedCount = 0;

        try {
            for (let i = 0; i < files.length; i++) {
                if (this.isCancelled) break;
                this.activeFileIdx = i;
                const file = files[i];

                if (onFileProgress) onFileProgress(i, 0, files.length);

                // Overwrite cleanup
                if (driveService.flsMap[file.name]) {
                    const oldRaw = mask.XOR(driveService.flsMap[file.name]);
                    const oldFlPid = getObjPid(oldRaw.slice(0, 44));
                    oldRaw.fill(0);
                    try {
                        await fetch(`${driveService.serverUrl}/api/media/${folderId}/${oldFlPid}/dat`, { method: "DELETE" });
                        await fetch(`${driveService.serverUrl}/api/media/${folderId}/${oldFlPid}/thumb`, { method: "DELETE" });
                    } catch (e) {
                        console.warn("Failed to delete existing file binary", e);
                    }
                }

                const fileKey = new Uint8Array(44);
                fileKey.set(Random(32), 0);
                fileKey.set(Random(12), 32);
                const filePid = getObjPid(fileKey);

                // Make thumbnail
                let thumb = null;
                if (file.type.startsWith("image/") || file.name.toLowerCase().endsWith(".svg")) {
                    thumb = await makeImg(file);
                } else if (file.type.startsWith("video/")) {
                    thumb = await makeVid(file);
                }

                if (this.isCancelled) throw new Error("UPLOAD_CANCELLED");

                // Encrypt file with progress (0% -> 50%)
                let encryptedBytes = 0;
                const smx = new SymMaster("gcmx1", fileKey.slice(0, 32));
                const encChks = [];

                await smx.EnFile(new FileSrc(file), file.size, {
                    write: async (c) => {
                        if (this.isCancelled) throw new Error("UPLOAD_CANCELLED");
                        encChks.push(c);
                        encryptedBytes += c.length;
                        if (onFileProgress) {
                            const percent = Math.min(50, Math.round((encryptedBytes / (file.size || 1)) * 50));
                            onFileProgress(i, percent, files.length);
                        }
                    }
                });

                if (this.isCancelled) throw new Error("UPLOAD_CANCELLED");

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

                if (this.isCancelled) throw new Error("UPLOAD_CANCELLED");

                // Network upload via XHR (50% -> 95%)
                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    this.currentXHR = xhr;
                    xhr.open("POST", `${driveService.serverUrl}/api/media/${folderId}/${filePid}/dat`);
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
                this.currentXHR = null;

                // Upload thumbnail if available
                if (thumb) {
                    const thmSm = new SymMaster("gcm1", fileKey.slice(0, 32));
                    await fetch(`${driveService.serverUrl}/api/media/${folderId}/${filePid}/thumb`, {
                        method: "POST",
                        headers: { "X-User-Hash": userHash },
                        body: await thmSm.EnBin(new Uint8Array(await thumb.arrayBuffer()))
                    });
                }

                if (onFileProgress) onFileProgress(i, 100, files.length);
                if (onFileComplete) onFileComplete(i, file.name);

                // Save file key to memory map
                const flInfo = new Uint8Array(52);
                flInfo.set(fileKey, 0);
                flInfo.set(EncodeInt(file.size, 8), 44);
                driveService.flsMap[file.name] = mask.XOR(flInfo);
                fileKey.fill(0);
                flInfo.fill(0);
                uploadedCount++;
            }

            // Sync metadata
            if (uploadedCount > 0 && !this.isCancelled) {
                if (onSyncing) onSyncing();
                const rawSK = mask.XOR(driveService.currentFolderKey);
                const metSm = new SymMaster("gcm1", rawSK.slice(0, 32));
                rawSK.fill(0);

                const rawMap = {};
                for (const [k, v] of Object.entries(driveService.flsMap)) {
                    rawMap[k] = mask.XOR(v);
                }
                const encoded = EncodeCfg(rawMap);
                for (const v of Object.values(rawMap)) if (v?.fill) v.fill(0);

                await fetch(`${driveService.serverUrl}/api/storage/${folderId}/names`, {
                    method: "POST",
                    headers: { "X-User-Hash": userHash },
                    body: await metSm.EnBin(encoded)
                });
                encoded.fill(0);

                driveService.keywordsBuilt = false;
                driveService.buildKeywords();
                driveService.invalidateCache();
            }

            if (onComplete) onComplete(uploadedCount);
        } catch (err) {
            if (err.message === "UPLOAD_CANCELLED") {
                if (onCancel) onCancel(this.activeFileIdx);
            } else {
                throw err;
            }
        } finally {
            this.isCancelled = false;
            this.isUploading = false;
            this.currentXHR = null;
            this.activeFileIdx = -1;
        }
    }
}

export const uploadService = new UploadService();
