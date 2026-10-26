// !! CHANGE ADAPTER FOR OTHER VERSIONS !!
// Backend network communication and client-side encryption adapter
import { SHA3256, SymMaster, Random, Masker, HashMaster } from '../engine/Bencrypt.js';
import { EncodeCfg, DecodeCfg, EncodeInt, DecodeInt, PadLen, Opsec } from '../engine/Opsec.js';
import { NormPW, Encode64, Decode64 } from '../engine/Bencode.js';
import { ToHex, FromHex, GetObjPid, ShowNotice, DownloadProgressController } from './utils.js';

// Derive 16-byte user public identifier from store key
const getUserPid = (key) => {
    if (!key) return '';
    return ToHex(SHA3256(key).slice(0, 16));
};

const mask = new Masker();
const secretPepper = "_PROJECT_WHY_MEDIAHUB_PEPPER_2026_!@#$";

// Ephemeral session storage encryption helpers (Web implementation)
const sessionVaultKey = '__mh_enc_session__';
const kekHexRegex = /^[0-9a-fA-F]{64}$/;

const getOrGenerateSessionKek = () => {
    let hex = window.name;
    if (typeof hex === 'string' && kekHexRegex.test(hex)) {
        return hex;
    }
    const rand = new Uint8Array(32);
    crypto.getRandomValues(rand);
    hex = ToHex(rand);
    rand.fill(0);
    window.name = hex;
    return hex;
};

const importSessionKek = async (hexKey) => {
    const raw = FromHex(hexKey);
    const key = await crypto.subtle.importKey(
        'raw',
        raw,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
    );
    raw.fill(0);
    return key;
};

// Web platform backend adapter service
export class AdapterService {
    // Initialize adapter with window origin
    constructor() {
        this.serverUrl = window.location.origin;
    }

    // Derive deterministic authentication user hash and masked master key
    async DeriveKeys(username, password) {
        const pwBytes = NormPW(password);
        const saltBytes = SHA3256(new TextEncoder().encode(username + secretPepper));
        const hm = new HashMaster("arg2st");
        const [storeKey, userKey] = await hm.KDF(pwBytes, saltBytes);
        const userHash = getUserPid(storeKey);
        const maskedKey = mask.XOR(userKey);
        userKey.fill(0);
        return { userHash, maskedKey };
    }

    // Check if user account exists on server
    async CheckUserExists(userHash) {
        const res = await fetch(`${this.serverUrl}/api/userdata/${userHash}`);
        return res.status !== 404;
    }

    // Register user account on server with optional invite code
    async RegisterUser(userHash, inviteCode = "") {
        const res = await fetch(`${this.serverUrl}/api/userdata/${userHash}`, {
            method: "POST",
            headers: inviteCode ? { "X-Invite-Code": inviteCode } : {},
            body: new Uint8Array(0)
        });
        if (!res.ok) {
            if (res.status === 403) throw new Error("Invalid invite code");
            throw new Error(`Registration failed (HTTP ${res.status})`);
        }
    }

    // Fetch server notification banner text
    async FetchNotice() {
        try {
            const res = await fetch(`${this.serverUrl}/api/notice`);
            if (!res.ok) return "";
            const data = await res.json();
            return data.notice || "";
        } catch {
            return "";
        }
    }

    // Fetch and decrypt user folder map from server
    async LoadUserData(userHash, maskedUserKey) {
        const res = await fetch(`${this.serverUrl}/api/userdata/${userHash}`);
        if (res.status === 404) return {};
        if (!res.ok) throw new Error(`Failed to load userdata (HTTP ${res.status})`);

        const rawUk = mask.XOR(maskedUserKey);
        const sm = new SymMaster("gcm1", rawUk);
        rawUk.fill(0);

        const enc = new Uint8Array(await res.arrayBuffer());
        if (enc.length === 0) return {};

        const dec = await sm.DeBin(enc);
        const map = DecodeCfg(dec);
        dec.fill(0);
        return map;
    }

    // Encrypt and persist user folder map to server
    async SaveUserData(userHash, rawFolderMap, maskedUserKey, oldHash = "") {
        const rawUk = mask.XOR(maskedUserKey);
        const sm = new SymMaster("gcm1", rawUk);
        rawUk.fill(0);

        const bin = EncodeCfg(rawFolderMap);
        const enc = await sm.EnBin(bin);
        bin.fill(0);

        const headers = { "X-User-Hash": oldHash || userHash };
        if (oldHash) headers["X-Old-Hash"] = oldHash;

        const res = await fetch(`${this.serverUrl}/api/userdata/${userHash}`, {
            method: "POST",
            headers,
            body: enc
        });
        enc.fill(0);

        if (!res.ok) throw new Error(`Failed to save userdata (HTTP ${res.status})`);
    }

    // Fetch and decrypt folder file map from server
    async LoadFolderMeta(folderId, maskedFolderKey) {
        const res = await fetch(`${this.serverUrl}/api/storage/${folderId}/names`);
        if (res.status === 404) return {};
        if (!res.ok) throw new Error(`Failed to load folder map (HTTP ${res.status})`);

        const rawFk = mask.XOR(maskedFolderKey);
        const sm = new SymMaster("gcm1", rawFk.slice(0, 32));
        rawFk.fill(0);

        const enc = new Uint8Array(await res.arrayBuffer());
        if (enc.length === 0) return {};

        const dec = await sm.DeBin(enc);
        const map = DecodeCfg(dec);
        dec.fill(0);
        return map;
    }

    // Encrypt and persist folder file map to server
    async SaveFolderMeta(folderId, rawFilesMap, maskedFolderKey, userHash = "") {
        const rawFk = mask.XOR(maskedFolderKey);
        const sm = new SymMaster("gcm1", rawFk.slice(0, 32));
        rawFk.fill(0);

        const bin = EncodeCfg(rawFilesMap);
        const enc = await sm.EnBin(bin);
        bin.fill(0);

        const headers = {};
        if (userHash) headers["X-User-Hash"] = userHash;

        const res = await fetch(`${this.serverUrl}/api/storage/${folderId}/names`, {
            method: "POST",
            headers,
            body: enc
        });
        enc.fill(0);

        if (!res.ok) throw new Error(`Failed to save folder map (HTTP ${res.status})`);
    }

    // Delete folder catalog entry on server
    async DeleteFolderMeta(folderId, userHash = "") {
        const headers = {};
        if (userHash) headers["X-User-Hash"] = userHash;

        const res = await fetch(`${this.serverUrl}/api/storage/${folderId}/names`, {
            method: "DELETE",
            headers
        });
        if (!res.ok && res.status !== 404) {
            throw new Error(`Failed to delete folder meta (HTTP ${res.status})`);
        }
    }

    // Trim orphan files from folder storage
    async TrimFolder(folderId, activePids, userHash = "") {
        const headers = { "Content-Type": "application/json" };
        if (userHash) headers["X-User-Hash"] = userHash;

        const res = await fetch(`${this.serverUrl}/api/trim/${folderId}`, {
            method: "POST",
            headers,
            body: JSON.stringify(activePids)
        });
        if (!res.ok) throw new Error(`Trim failed (HTTP ${res.status})`);
        return await res.text();
    }

    // Load and decrypt thumbnail blob URL
    async LoadThumbnailUrl(folderId, filePid, maskedFileKey) {
        const res = await fetch(`${this.serverUrl}/api/media/${folderId}/${filePid}/thumb`);
        if (!res.ok) return null;

        const rawFk = mask.XOR(maskedFileKey);
        const sm = new SymMaster("gcm1", rawFk.slice(0, 32));
        rawFk.fill(0);

        const enc = new Uint8Array(await res.arrayBuffer());
        if (enc.length === 0) return null;
        try {
            const dec = await sm.DeBin(enc);
            const blob = new Blob([dec], { type: "image/jpeg" });
            dec.fill(0);
            return URL.createObjectURL(blob);
        } catch (err) {
            console.warn("[Adapter] Failed to decrypt thumbnail:", err);
            return null;
        }
    }

    // Download and decrypt media payload to blob URL with live progress tracking
    async LoadMediaBlob(folderId, filePid, maskedFileKey, origSize = 0, mimeType = "application/octet-stream", onProgress = null) {
        const downloadChunkSize = 16 * 1024 * 1024;
        const url = `${this.serverUrl}/api/media/${folderId}/${filePid}/dat`;

        // Fetch a range with up to 3 attempts from the same offset
        const fetchChunk = async (start, end, allowFull = false) => {
            let lastErr;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const res = await fetch(url, {
                        headers: { 'Range': `bytes=${start}-${end}` }
                    });
                    if (res.status !== 206 && !(allowFull && res.status === 200)) {
                        throw new Error(`Failed to download media chunk (HTTP ${res.status})`);
                    }
                    const chunk = new Uint8Array(await res.arrayBuffer());
                    const contentRange = res.headers.get('Content-Range');
                    if (res.status === 206) {
                        const match = contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
                        if (!match || Number(match[1]) !== start || Number(match[2]) !== start + chunk.length - 1 || chunk.length !== Math.min(end - start + 1, Number(match[3]) - start)) {
                            throw new Error(`Invalid media chunk at offset ${start}`);
                        }
                    }
                    return { chunk, totalSize: contentRange ? Number(contentRange.split('/')[1]) : chunk.length };
                } catch (err) {
                    lastErr = err;
                    console.warn(`Download chunk at offset ${start} attempt ${attempt} failed:`, err);
                    if (attempt < 3) await new Promise(r => setTimeout(r, 300 * attempt));
                }
            }
            throw lastErr;
        };

        // Fetch first chunk to determine total file size from Content-Range
        const first = await fetchChunk(0, downloadChunkSize - 1, true);
        const totalSize = first.totalSize;
        const enc = new Uint8Array(totalSize);
        enc.set(first.chunk, 0);
        let downloaded = first.chunk.length;
        if (onProgress) {
            onProgress({ phase: 'downloading', loaded: downloaded, total: totalSize, percent: Math.round((downloaded / totalSize) * 100) });
        }

        // Assemble full ciphertext buffer from range chunks
        while (downloaded < totalSize) {
            const rangeEnd = Math.min(downloaded + downloadChunkSize, totalSize) - 1;
            const { chunk } = await fetchChunk(downloaded, rangeEnd);
            enc.set(chunk, downloaded);
            downloaded += chunk.length;
            if (onProgress) {
                onProgress({ phase: 'downloading', loaded: downloaded, total: totalSize, percent: Math.round((downloaded / totalSize) * 100) });
            }
        }

        // Decrypt assembled ciphertext using gcmx1 chunked stream decryption
        if (onProgress) {
            onProgress({ phase: 'decrypting', loaded: totalSize, total: totalSize, percent: 100 });
        }
        const rawFk = mask.XOR(maskedFileKey);
        const sm = new SymMaster("gcmx1", rawFk.slice(0, 32));
        rawFk.fill(0);

        // Strip random padding added during upload using AfterSize(origSize)
        let expectedEncSize = enc.length;
        if (typeof origSize === 'number' && origSize >= 0) {
            const calculated = sm.AfterSize(origSize);
            if (calculated > 0 && calculated <= enc.length) {
                expectedEncSize = calculated;
            }
        }
        const cipherData = enc.subarray(0, expectedEncSize);

        const dec = await sm.DeBin(cipherData);
        const unpadded = (origSize > 0 && dec.length >= origSize) ? dec.slice(0, origSize) : dec;
        const blob = new Blob([unpadded], { type: mimeType });
        dec.fill(0);

        if (onProgress) {
            onProgress({ phase: 'complete', loaded: totalSize, total: totalSize, percent: 100 });
        }
        return URL.createObjectURL(blob);
    }

    // Download, decrypt, and trigger browser file save with live progress toast
    async DownloadFile(folderId, filePid, maskedFileKey, fileName, origSize = 0) {
        const toast = new DownloadProgressController(fileName);
        try {
            const blobUrl = await this.LoadMediaBlob(
                folderId,
                filePid,
                maskedFileKey,
                origSize,
                "application/octet-stream",
                (p) => toast.update(p)
            );
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        } catch (err) {
            toast.fail(err);
            throw err;
        }
    }

    // Delete media binary and thumbnail from server
    async DeleteMedia(folderId, filePid, userHash = "") {
        const headers = {};
        if (userHash) headers["X-User-Hash"] = userHash;

        await fetch(`${this.serverUrl}/api/media/${folderId}/${filePid}/dat`, {
            method: "DELETE",
            headers
        });
        await fetch(`${this.serverUrl}/api/media/${folderId}/${filePid}/thumb`, {
            method: "DELETE",
            headers
        });
    }

    // Register video streaming credentials with Service Worker
    async RegisterStreaming(folderId, filePid, maskedFileKey, origSize, fileName) {
        if (!('serviceWorker' in navigator)) {
            return false;
        }

        // Wait for active service worker controller if not immediately claimed
        if (!navigator.serviceWorker.controller) {
            try {
                await Promise.race([
                    navigator.serviceWorker.ready,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('SW ready timeout')), 2500))
                ]);
            } catch (err) {
                console.warn('[Adapter] SW ready wait warning:', err);
            }
        }

        const controller = navigator.serviceWorker.controller;
        if (!controller) {
            console.warn('[Adapter] No ServiceWorker controller available for streaming');
            return false;
        }

        const rawFk = mask.XOR(maskedFileKey);
        const hexKey = ToHex(rawFk);
        rawFk.fill(0);

        return new Promise((resolve) => {
            const channel = new MessageChannel();
            let resolved = false;
            channel.port1.onmessage = (e) => {
                if (e.data?.action === 'REGISTERED') {
                    resolved = true;
                    resolve(true);
                }
            };
            controller.postMessage({
                action: 'REGISTER',
                filePid,
                folderId,
                fileKey: hexKey,
                originalSize: origSize,
                fileName
            }, [channel.port2]);

            setTimeout(() => {
                if (!resolved) resolve(true);
            }, 800);
        });
    }

    // Register streaming credentials and return SW stream endpoint URL
    async GetStreamUrl(folderId, filePid, maskedFileKey, origSize, fileName) {
        const ok = await this.RegisterStreaming(folderId, filePid, maskedFileKey, origSize, fileName);
        if (!ok) {
            throw new Error('Service Worker streaming is unavailable');
        }
        return `/sw-stream/${folderId}/${filePid}`;
    }

    // Retrieve saved user credentials
    async GetSavedCredentials() {
        return null;
    }

    // Persist user credentials
    async SaveCredentials(username, password) { }

    // Export password-encrypted folder share token
    async ExportShareToken(folderName, maskedKey, password) {
        if (!password) return null;
        const rawKey = mask.XOR(maskedKey);
        const op = new Opsec();
        op.Smsg = folderName;
        op.SmsgInfo = rawKey;
        const head = await op.Encpw('arg2st', NormPW(password));
        rawKey.fill(0);
        return Encode64(head, '#');
    }

    // Import and decrypt password-protected folder share token
    async ImportShareToken(tokenText, password) {
        try {
            if (!password || !tokenText) return null;
            const raw = Decode64(tokenText.trim(), '#');
            const op = new Opsec();
            op.View(raw);
            await op.Decpw(NormPW(password));
            if (!op.Smsg || op.SmsgInfo.length === 0) return null;
            const maskedKey = mask.XOR(op.SmsgInfo);
            op.SmsgInfo.fill(0);
            return { name: op.Smsg, key: maskedKey };
        } catch {
            return null;
        }
    }

    // Generate JPEG thumbnail blob from image File
    async MakeImageThumb(file) {
        try {
            const bmp = await createImageBitmap(file);
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const ratio = bmp.width / bmp.height;
            if (ratio >= 0.6666 && ratio <= 1.5) {
                if (bmp.width >= bmp.height) {
                    canvas.width = 256;
                    canvas.height = Math.round(256 / ratio);
                } else {
                    canvas.height = 256;
                    canvas.width = Math.round(256 * ratio);
                }
                ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
            } else {
                const size = Math.min(bmp.width, bmp.height);
                canvas.width = 256;
                canvas.height = 256;
                ctx.drawImage(bmp, 0, 0, size, size, 0, 0, 256, 256);
            }
            bmp.close();
            return new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.7));
        } catch {
            return null;
        }
    }

    // Generate JPEG thumbnail blob from video File
    MakeVideoThumb(file) {
        return new Promise((resolve) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            video.src = URL.createObjectURL(file);
            video.onloadeddata = () => video.currentTime = 1;
            video.onseeked = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const ratio = video.videoWidth / video.videoHeight;
                if (video.videoWidth >= video.videoHeight) {
                    canvas.width = 256;
                    canvas.height = Math.round(256 / ratio);
                } else {
                    canvas.height = 256;
                    canvas.width = Math.round(256 * ratio);
                }
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((b) => {
                    URL.revokeObjectURL(video.src);
                    resolve(b);
                }, 'image/jpeg', 0.7);
            };
            video.onerror = () => {
                URL.revokeObjectURL(video.src);
                resolve(null);
            };
        });
    }

    // ==========================================
    // Session Byte Storage (Secure Vault)
    // ==========================================
    // Securely encrypt and persist session bytes (Web: AES-GCM + sessionStorage; Desktop: backed by backend/keychain)
    async SaveSessionBytes(plainBytes) {
        if (!plainBytes || plainBytes.length === 0) {
            await this.ClearSessionBytes();
            return;
        }
        const kek = getOrGenerateSessionKek();
        const key = await importSessionKek(kek);
        const iv = new Uint8Array(12);
        crypto.getRandomValues(iv);

        const cipherBuf = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            plainBytes
        );

        const cipherBytes = new Uint8Array(cipherBuf);
        const payload = ToHex(iv) + ToHex(cipherBytes);
        iv.fill(0);
        sessionStorage.setItem(sessionVaultKey, payload);
    }

    // Retrieve and decrypt persisted session bytes
    async LoadSessionBytes() {
        const payload = sessionStorage.getItem(sessionVaultKey);
        if (!payload || payload.length < 24) return null;

        try {
            const kek = getOrGenerateSessionKek();
            const iv = FromHex(payload.slice(0, 24));
            const cipher = FromHex(payload.slice(24));
            const key = await importSessionKek(kek);

            const buf = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                key,
                cipher
            );
            iv.fill(0);
            return new Uint8Array(buf);
        } catch (err) {
            console.warn('[Adapter] Failed to decrypt session bytes:', err);
            return null;
        }
    }

    // Clear persisted session bytes and ephemeral key
    async ClearSessionBytes() {
        try {
            sessionStorage.removeItem(sessionVaultKey);
            sessionStorage.clear();
            window.name = '';
        } catch { }
    }

    // ==========================================
    // Share Link Generation
    // ==========================================
    // Generate shareable file link (Web: uses folderId and filePid; Desktop/Session variants can create server session)
    async CreateShareLink(folderId, filePid, maskedFileKey = null) {
        return `${this.serverUrl || window.location.origin}/viewer?f=${encodeURIComponent(folderId)}&p=${encodeURIComponent(filePid)}`;
    }

    // ==========================================
    // Application Info (for multi-platform app identification)
    // ==========================================
    // Retrieve application descriptor
    GetAppInfo() {
        return {
            name: "MediaHub Web",
            version: "1.0.0",
            platform: "Web Browser",
            description: "Zero-Knowledge End-to-End Encrypted Cloud Storage & Media Hub",
            build: "Vanilla Web Client"
        };
    }

    // Display application information dialog
    async ShowAppInfo() {
        const info = this.GetAppInfo();
        const lines = [
            `${info.name} v${info.version}`,
            `Platform: ${info.platform}`,
            `Build: ${info.build || 'Standard'}`,
            '',
            info.description
        ];
        await ShowNotice(lines.join('\n'), "About MediaHub", "info");
    }

    // Verify public route and restore share session context
    async IsPublicRoute(path, query) {
        return Boolean(query?.s);
    }
}

// Global adapter singleton instance
export const Adapter = new AdapterService();
