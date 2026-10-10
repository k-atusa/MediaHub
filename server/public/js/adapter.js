// MediaHub Backend & Cryptographic Adapter
// Encapsulates all network communications (fetch/XHR) and client-side E2EE cryptography
import { SHA3256, SymMaster, Random, Masker, HashMaster } from './engine/Bencrypt.js';
import { EncodeCfg, DecodeCfg, EncodeInt, DecodeInt, PadLen, Opsec } from './engine/Opsec.js';
import { NormPW, Encode64, Decode64 } from './engine/Bencode.js';
import { ToHex, FromHex, GetObjPid, GetUserPid } from './core/utils.js';

const mask = new Masker();
const SECRET_PEPPER = "_PROJECT_WHY_MEDIAHUB_PEPPER_2026_!@#$";

// In-memory data chunk provider for streaming decryption
export class NetSrc {
    constructor(buf) {
        this.buf = buf;
        this.ptr = 0;
    }
    // Read specified byte chunk slice from buffer
    async read(size) {
        if (this.ptr >= this.buf.length) return new Uint8Array(0);
        const chunk = this.buf.slice(this.ptr, this.ptr + size);
        this.ptr += chunk.length;
        return chunk;
    }
}

export class Adapter {
    // Initialize Adapter with server origin
    constructor() {
        this.serverUrl = window.location.origin;
    }

    // Derive deterministic user authentication hash and user master key using Argon2id/KDF
    async DeriveKeys(username, password) {
        const pwBytes = NormPW(password);
        const saltBytes = SHA3256(new TextEncoder().encode(username + SECRET_PEPPER));
        const hm = new HashMaster("arg2st");
        const [storeKey, userKey] = await hm.KDF(pwBytes, saltBytes);
        const userHash = GetUserPid(storeKey);
        const maskedKey = mask.XOR(userKey);
        userKey.fill(0);
        return { userHash, maskedKey };
    }

    // Check if user account exists on server by verifying status of userdata endpoint
    async CheckUserExists(userHash) {
        const res = await fetch(`${this.serverUrl}/api/userdata/${userHash}`);
        return res.status !== 404;
    }

    // Register a new user account with an optional invite code
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

    // Fetch public server announcement banner text
    async FetchNotice() {
        try {
            const res = await fetch(`${this.serverUrl}/api/notice`);
            if (!res.ok) return "";
            const data = await res.json();
            return data.notice || "";
        } catch (_) {
            return "";
        }
    }

    // Load and decrypt user folder catalog from server
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

    // Encrypt and save user folder catalog to server
    async SaveUserData(userHash, rawFldMap, maskedUserKey, oldHash = "") {
        const rawUk = mask.XOR(maskedUserKey);
        const sm = new SymMaster("gcm1", rawUk);
        rawUk.fill(0);

        const bin = EncodeCfg(rawFldMap);
        const enc = await sm.EnBin(bin);
        bin.fill(0);

        const headers = {};
        if (oldHash) headers["X-Old-Hash"] = oldHash;

        const res = await fetch(`${this.serverUrl}/api/userdata/${userHash}`, {
            method: "POST",
            headers,
            body: enc
        });
        enc.fill(0);

        if (!res.ok) throw new Error(`Failed to save userdata (HTTP ${res.status})`);
    }

    // Load and decrypt folder file catalog from server
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

    // Encrypt and save folder file catalog to server
    async SaveFolderMeta(folderId, rawFlsMap, maskedFolderKey, userHash = "") {
        const rawFk = mask.XOR(maskedFolderKey);
        const sm = new SymMaster("gcm1", rawFk.slice(0, 32));
        rawFk.fill(0);

        const bin = EncodeCfg(rawFlsMap);
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

    // Delete folder metadata from server storage
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

    // Trim orphaned files in folder storage on server
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

    // Load and decrypt thumbnail image, returning an object URL
    async LoadThumbnailUrl(folderId, filePid, maskedFileKey) {
        const res = await fetch(`${this.serverUrl}/api/media/${folderId}/${filePid}/thumb`);
        if (!res.ok) return null;

        const rawFk = mask.XOR(maskedFileKey);
        const sm = new SymMaster("gcm1", rawFk.slice(0, 32));
        rawFk.fill(0);

        const enc = new Uint8Array(await res.arrayBuffer());
        const dec = await sm.DeBin(enc);
        const blob = new Blob([dec], { type: "image/webp" });
        dec.fill(0);
        return URL.createObjectURL(blob);
    }

    // Load and decrypt media file into in-memory decrypted Blob URL
    async LoadMediaBlob(folderId, filePid, maskedFileKey, origSize = 0, mimeType = "application/octet-stream") {
        const res = await fetch(`${this.serverUrl}/api/media/${folderId}/${filePid}`);
        if (!res.ok) throw new Error(`Failed to download media (HTTP ${res.status})`);

        const rawFk = mask.XOR(maskedFileKey);
        const sm = new SymMaster("gcm1", rawFk.slice(0, 32));
        rawFk.fill(0);

        const enc = new Uint8Array(await res.arrayBuffer());
        const dec = await sm.DeBin(enc);
        const unpadded = (origSize > 0 && dec.length >= origSize) ? dec.slice(0, origSize) : dec;
        const blob = new Blob([unpadded], { type: mimeType });
        dec.fill(0);
        return URL.createObjectURL(blob);
    }

    // Delete media binary and thumbnail from server
    async DeleteMedia(folderId, filePid, userHash = "") {
        const headers = {};
        if (userHash) headers["X-User-Hash"] = userHash;

        await fetch(`${this.serverUrl}/api/media/${folderId}/${filePid}`, {
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
        if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
            return false;
        }

        const rawFk = mask.XOR(maskedFileKey);
        const hexKey = ToHex(rawFk);
        rawFk.fill(0);

        return new Promise((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = (e) => {
                if (e.data?.action === 'REGISTERED') resolve(true);
            };
            navigator.serviceWorker.controller.postMessage({
                action: 'REGISTER',
                filePid,
                folderId,
                fileKey: hexKey,
                originalSize: origSize,
                fileName
            }, [channel.port2]);

            setTimeout(() => resolve(true), 500);
        });
    }

    // Encrypt folder share token with user password
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

    // Decrypt folder share token with user password
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

    // Generate JPEG thumbnail blob from image File object
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

    // Generate JPEG thumbnail blob from video File object
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
}

// Global adapter singleton instance
export const adapter = new Adapter();
