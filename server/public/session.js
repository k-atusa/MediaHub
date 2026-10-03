// MediaHub SafeSession Module
// Implements RAM vs Disk Boundary Architecture (Zero Disk Plaintext)
// RAM Boundary: window.name stores KEK (32B ephemeral key), JS Runtime Heap stores plaintext.
// Disk Boundary: sessionStorage stores ONLY AES-GCM-256 encrypted ciphertext (__mh_enc_session__).

const STORAGE_KEY = '__mh_enc_session__';
const KEK_HEX_REGEX = /^[0-9a-fA-F]{64}$/;

function toHex(buf) {
    return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
    if (!hex || hex.length % 2 !== 0) return new Uint8Array(0);
    const matches = hex.match(/.{1,2}/g);
    if (!matches) return new Uint8Array(0);
    return new Uint8Array(matches.map(b => parseInt(b, 16)));
}

// Retrieve or generate ephemeral KEK from window.name (RAM only)
function getOrGenerateKEK() {
    let kekHex = window.name;
    if (typeof kekHex === 'string' && KEK_HEX_REGEX.test(kekHex)) {
        return kekHex;
    }
    const rand = new Uint8Array(32);
    crypto.getRandomValues(rand);
    kekHex = toHex(rand);
    rand.fill(0);
    window.name = kekHex;
    return kekHex;
}

// Import raw 32-byte hex key for Web Crypto AES-GCM
async function importKEK(hexKey) {
    const rawKey = fromHex(hexKey);
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        rawKey,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
    );
    rawKey.fill(0);
    return cryptoKey;
}

// Encrypt plaintext JS object to IV(12B hex) + Ciphertext(hex)
async function encryptSession(dataObj, hexKey) {
    const cryptoKey = await importKEK(hexKey);
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);

    const jsonStr = JSON.stringify(dataObj);
    const plainBytes = new TextEncoder().encode(jsonStr);

    const cipherBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        cryptoKey,
        plainBytes
    );

    const cipherBytes = new Uint8Array(cipherBuffer);
    const resultHex = toHex(iv) + toHex(cipherBytes);
    iv.fill(0);
    return resultHex;
}

// Decrypt IV(12B hex) + Ciphertext(hex) to JS object
async function decryptSession(payloadHex, hexKey) {
    if (!payloadHex || payloadHex.length < 24) return null;
    const ivHex = payloadHex.slice(0, 24);
    const cipherHex = payloadHex.slice(24);

    const iv = fromHex(ivHex);
    const cipherBytes = fromHex(cipherHex);
    const cryptoKey = await importKEK(hexKey);

    const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        cryptoKey,
        cipherBytes
    );

    iv.fill(0);
    const text = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(text);
}

class SafeSessionManager {
    constructor() {
        this.ram = {};
        this._initPromise = null;
        this.isInitialized = false;
        this._saveTimer = null;
    }

    async init() {
        if (this._initPromise) return this._initPromise;

        this._initPromise = (async () => {
            const kek = getOrGenerateKEK();
            const encPayload = sessionStorage.getItem(STORAGE_KEY);

            if (encPayload) {
                try {
                    const decrypted = await decryptSession(encPayload, kek);
                    if (decrypted && typeof decrypted === 'object') {
                        this.ram = decrypted;
                    }
                } catch (err) {
                    console.warn('[SafeSession] Decryption failed (invalid KEK or expired tab):', err);
                    this.ram = {};
                }
            }

            // Migration & Disk Cleansing:
            // Absorb any plaintext keys into RAM and immediately PURGE them from disk (LevelDB)
            const legacyKeys = [
                'userHash', 'userKey', 'username',
                'currentFolderId', 'currentFolderKey', 'currentFileKey', 'currentFileName',
                'oldFold', 'oldPage', 'redirectAfterLogin', 'noticeShown'
            ];
            let migrated = false;
            for (const k of legacyKeys) {
                const val = sessionStorage.getItem(k);
                if (val !== null) {
                    if (this.ram[k] === undefined) {
                        this.ram[k] = val;
                    }
                    sessionStorage.removeItem(k);
                    migrated = true;
                }
            }

            // Also clean legacy client-local unlinked folder tracking from localStorage
            try {
                localStorage.removeItem('mh_unlinked_folders');
            } catch (_) {}

            if (migrated || !encPayload) {
                await this.save();
            }

            this.isInitialized = true;
            return this.ram;
        })();

        return this._initPromise;
    }

    // 0ms high-speed memory lookup (RAM Boundary)
    getItem(key) {
        if (!this.ram) return null;
        const val = this.ram[key];
        return val !== undefined ? val : null;
    }

    // Write to RAM immediately, schedule encrypted disk flush
    setItem(key, value) {
        if (!this.ram) this.ram = {};
        this.ram[key] = String(value);
        this.scheduleSave();
    }

    // Remove from RAM, schedule encrypted disk flush
    removeItem(key) {
        if (this.ram && key in this.ram) {
            delete this.ram[key];
            this.scheduleSave();
        }
    }

    // Clear both RAM and disk storage, erase ephemeral KEK
    clear() {
        this.ram = {};
        try {
            sessionStorage.clear();
            window.name = '';
        } catch (_) {}
    }

    scheduleSave() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this.save().catch(e => console.error('[SafeSession] Encrypted save error:', e));
        }, 50);
    }

    // Single-pass serialization crossing RAM -> Disk boundary
    async save() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        try {
            const kek = getOrGenerateKEK();
            const encryptedHex = await encryptSession(this.ram, kek);
            sessionStorage.setItem(STORAGE_KEY, encryptedHex);
        } catch (e) {
            console.error('[SafeSession] Failed to encrypt session to disk:', e);
        }
    }

    // Safe navigation helper: ensures disk encryption flush completes before redirect
    async navigate(url) {
        await this.save();
        window.location.href = url;
    }
}

export const SafeSession = new SafeSessionManager();

// Expose globally for inline scripts and compatibility
if (typeof window !== 'undefined') {
    window.SafeSession = SafeSession;
}
