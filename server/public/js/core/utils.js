// Core utility functions, encrypted session storage, and UI dialogs
// NOTE: Adapter is NOT imported here to avoid circular dependency (utils <-> adapter).
// Call setSessionAdapter(adapterInstance) from app.js after both modules are loaded.

let _sessionAdapter = null;
export function setSessionAdapter(adapter) { _sessionAdapter = adapter; }

// Convert Uint8Array buffer to lowercase hexadecimal string
export const ToHex = (buf) => {
    if (!buf) return '';
    return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
};

// Convert hexadecimal string to Uint8Array buffer
export const FromHex = (hex) => {
    if (!hex || hex.length % 2 !== 0) return new Uint8Array(0);
    const matches = hex.match(/.{1,2}/g);
    if (!matches) return new Uint8Array(0);
    return new Uint8Array(matches.map(b => parseInt(b, 16)));
};

// Format byte count to human-readable size string
export const FormatBytes = (bytes) => {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return '-';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = parseFloat((bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1));
    return `${val} ${sizes[i]}`;
};

// Escape HTML special characters
export const EscapeHtml = (str) => {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// Extract 24-byte object PID from key slice
export const GetObjPid = (key) => {
    if (!key || key.length < 44) return '';
    return ToHex(key.slice(32, 44));
};

const videoExts = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'ts', 'm4v', '3gp', 'flv'];
const audioExts = ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'opus', 'wma'];
const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'avif'];
const pdfExts = ['pdf'];
const textExts = [
    'txt', 'log', 'md', 'json', 'csv', 'xml', 'html', 'css', 'js', 'ts', 'jsx', 'tsx',
    'yaml', 'yml', 'sh', 'py', 'sql', 'ini', 'conf', 'c', 'cpp', 'h', 'hpp', 'go', 'rs',
    'java', 'kt', 'kts', 'swift', 'rb', 'php', 'cs', 'scala', 'dart', 'lua', 'r',
    'bat', 'cmd', 'ps1', 'zsh', 'bash', 'toml', 'env', 'properties', 'graphql', 'gql',
    'proto', 'diff', 'patch', 'vue', 'svelte', 'lock', 'json5',
    'readme', 'license', 'makefile', 'dockerfile'
];

// Determine media category by file name extension
export const GetKind = (name) => {
    const ext = ((name || '').split('.').pop() || '').toLowerCase();
    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'audio';
    if (imageExts.includes(ext)) return 'image';
    if (pdfExts.includes(ext)) return 'pdf';
    if (textExts.includes(ext)) return 'text';
    return 'unsupported';
};

// Get MIME type by file name extension
export const GetMime = (name) => {
    const ext = ((name || '').split('.').pop() || '').toLowerCase();
    const map = {
        pdf: 'application/pdf',
        txt: 'text/plain;charset=utf-8',
        log: 'text/plain;charset=utf-8',
        md: 'text/markdown;charset=utf-8',
        json: 'application/json',
        csv: 'text/csv;charset=utf-8',
        xml: 'application/xml',
        html: 'text/html;charset=utf-8',
        css: 'text/css;charset=utf-8',
        js: 'text/javascript;charset=utf-8',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        bmp: 'image/bmp',
        ico: 'image/x-icon',
        mp4: 'video/mp4',
        webm: 'video/webm',
        mov: 'video/quicktime',
        mkv: 'video/x-matroska',
        mp3: 'audio/mpeg',
        ogg: 'audio/ogg',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
        flac: 'audio/flac',
        opus: 'audio/opus'
    };
    return map[ext] || 'application/octet-stream';
};

// Get file type icon and theme color
export const GetGoogleFileIcon = (filename) => {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'ts', 'm4v', '3gp', 'flv'].includes(ext)) {
        return { icon: 'movie', color: '#e06d53' };
    }
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif'].includes(ext)) {
        return { icon: 'image', color: '#ea4335' };
    }
    if (['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma'].includes(ext)) {
        return { icon: 'audiotrack', color: '#f29900' };
    }
    if (['pdf'].includes(ext)) {
        return { icon: 'picture_as_pdf', color: '#ea4335' };
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
        return { icon: 'folder_zip', color: '#5f6368' };
    }
    return { icon: 'description', color: '#4285f4' };
};

// In-memory session state manager backed by Adapter secure session vault
export class SafeSessionManager {
    constructor() {
        this.ram = {};
        this.initPromise = null;
        this.isInitialized = false;
        this.saveTimer = null;
    }

    // Initialize session by loading and decoding decrypted bytes from adapter vault
    async Init() {
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                if (_sessionAdapter) {
                    const bytes = await _sessionAdapter.LoadSessionBytes();
                    if (bytes && bytes.length > 0) {
                        const text = new TextDecoder().decode(bytes);
                        const parsed = JSON.parse(text);
                        if (parsed && typeof parsed === 'object') {
                            this.ram = parsed;
                        }
                    }
                }
            } catch (err) {
                console.warn('[SafeSession] Failed to load session from vault:', err);
                this.ram = {};
            }
            this.isInitialized = true;
            return this.ram;
        })();

        return this.initPromise;
    }

    // Read item from RAM cache
    GetItem(key) {
        if (!this.ram) return null;
        const val = this.ram[key];
        return val !== undefined ? val : null;
    }

    // Store item in RAM cache and schedule vault persist
    SetItem(key, value) {
        if (!this.ram) this.ram = {};
        this.ram[key] = String(value);
        this.scheduleSave();
    }

    // Delete item from RAM cache and schedule vault persist
    RemoveItem(key) {
        if (this.ram && key in this.ram) {
            delete this.ram[key];
            this.scheduleSave();
        }
    }

    // Wipe session from RAM and purge adapter vault
    Clear() {
        this.ram = {};
        if (_sessionAdapter) {
            _sessionAdapter.ClearSessionBytes().catch(() => {});
        }
    }

    // Schedule debounced vault flush
    scheduleSave() {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.Save().catch(err => console.error('[SafeSession] Save error:', err));
        }, 50);
    }

    // Serialize RAM state to bytes and persist via adapter vault
    async Save() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (!_sessionAdapter) return;
        try {
            const jsonStr = JSON.stringify(this.ram);
            const bytes = new TextEncoder().encode(jsonStr);
            await _sessionAdapter.SaveSessionBytes(bytes);
        } catch (err) {
            console.error('[SafeSession] Persist failed:', err);
        }
    }
}

// Global SafeSession instance
export const SafeSession = new SafeSessionManager();

// Show alert notice dialog modal
export const ShowNotice = (msg, title = 'Notice', icon = 'campaign') => {
    const modal = document.getElementById('noticeModal');
    if (!modal) {
        alert(msg);
        return Promise.resolve();
    }
    const textEl = document.getElementById('noticeText');
    const titleEl = document.getElementById('noticeTitle');
    const iconEl = document.getElementById('noticeIcon');
    const btn = document.getElementById('btnConfirmNotice');

    if (textEl) textEl.textContent = msg;
    if (titleEl) titleEl.textContent = title;
    if (iconEl) {
        iconEl.textContent = icon;
        if (icon === 'error' || icon === 'delete') {
            iconEl.style.color = 'var(--g-danger, #b3261e)';
        } else if (icon === 'warning') {
            iconEl.style.color = '#ea8600';
        } else if (icon === 'check_circle' || icon === 'check') {
            iconEl.style.color = '#137333';
        } else {
            iconEl.style.color = 'var(--g-primary-blue, #0b57d0)';
        }
    }

    modal.showModal();
    return new Promise(resolve => {
        const handler = () => {
            btn.removeEventListener('click', handler);
            modal.close();
            resolve();
        };
        btn.addEventListener('click', handler);
        modal.addEventListener('close', () => {
            btn.removeEventListener('click', handler);
            resolve();
        }, { once: true });
    });
};

// Show notice dialog with dynamic severity icon
export const ShowAlert = (msg) => {
    let title = 'Notice';
    let icon = 'campaign';
    if (typeof msg === 'string') {
        const lower = msg.toLowerCase();
        if (msg.includes('❌') || lower.includes('fail') || lower.includes('error') || lower.includes('invalid')) {
            title = 'Error';
            icon = 'error';
        } else if (msg.includes('⚠️') || lower.includes('warning') || lower.includes('fill')) {
            title = 'Notice';
            icon = 'warning';
        } else if (msg.includes('✅') || lower.includes('success')) {
            title = 'Success';
            icon = 'check_circle';
        }
    }
    return ShowNotice(msg, title, icon);
};

// Show confirmation modal dialog
export const ShowConfirmModal = (msg, title = 'Confirm', icon = 'help', confirmText = 'Confirm', isDanger = false) => {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        if (!modal) {
            return resolve(confirm(msg));
        }
        const textEl = document.getElementById('confirmModalText');
        const titleEl = document.getElementById('confirmModalTitle');
        const iconEl = document.getElementById('confirmModalIcon');
        const btnCancel = document.getElementById('btnCancelConfirmModal');
        const btnConfirm = document.getElementById('btnActionConfirmModal');

        if (textEl) textEl.innerHTML = msg;
        if (titleEl) titleEl.textContent = title;
        if (iconEl) {
            iconEl.textContent = icon;
            iconEl.style.color = isDanger ? 'var(--g-danger, #b3261e)' : 'var(--g-primary-blue, #0b57d0)';
        }
        if (btnConfirm) {
            btnConfirm.textContent = confirmText;
            btnConfirm.className = isDanger ? 'btn-dialog-danger' : 'btn-dialog-primary';
        }

        modal.showModal();

        const cleanup = () => {
            btnConfirm.removeEventListener('click', onConfirm);
            btnCancel.removeEventListener('click', onCancel);
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

        modal.addEventListener('close', () => { cleanup(); resolve(false); }, { once: true });
        btnConfirm.addEventListener('click', onConfirm);
        btnCancel.addEventListener('click', onCancel);
    });
};

// Disable browser autocomplete on text input elements
export const DisableAllAutocomplete = () => {
    document.querySelectorAll('input:not([type="checkbox"]):not([type="file"]):not([type="radio"])').forEach(input => {
        if (!input.hasAttribute('autocomplete') || input.getAttribute('autocomplete') !== 'new-password') {
            input.setAttribute('autocomplete', 'off');
        }
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('data-lpignore', 'true');
    });
};

// Floating download progress toast manager
export class DownloadProgressController {
    constructor(fileName) {
        this.fileName = fileName;
        this.el = null;
        this.iconEl = null;
        this.percentText = null;
        this.statusText = null;
        this.progressBar = null;
        this.create();
    }

    create() {
        const existing = document.getElementById("mhDownloadToast");
        if (existing) existing.remove();

        const toast = document.createElement("div");
        toast.id = "mhDownloadToast";
        toast.className = "download-progress-toast";
        toast.innerHTML = `
            <div class="download-toast-icon-wrap">
                <span class="material-symbols-outlined download-toast-icon" id="mhDownloadToastIcon">downloading</span>
            </div>
            <div class="download-toast-body">
                <div class="download-toast-header">
                    <span class="download-toast-name" title="${EscapeHtml(this.fileName)}">${EscapeHtml(this.fileName)}</span>
                    <span class="download-toast-percent" id="mhDownloadToastPercent">0%</span>
                </div>
                <div class="download-toast-meta" id="mhDownloadToastMeta">Preparing download…</div>
                <div class="download-toast-bar-track">
                    <div class="download-toast-bar-fill" id="mhDownloadToastFill" style="width: 0%;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(toast);

        this.el = toast;
        this.iconEl = document.getElementById("mhDownloadToastIcon");
        this.percentText = document.getElementById("mhDownloadToastPercent");
        this.statusText = document.getElementById("mhDownloadToastMeta");
        this.progressBar = document.getElementById("mhDownloadToastFill");
    }

    update(progress) {
        if (!this.el) return;
        const { phase, loaded, total, percent } = progress;
        if (phase === 'downloading') {
            const p = Math.max(0, Math.min(100, percent || 0));
            if (this.percentText) this.percentText.textContent = `${p}%`;
            if (this.progressBar) this.progressBar.style.width = `${p}%`;
            if (this.statusText) {
                if (total > 0) {
                    this.statusText.textContent = `Downloading • ${FormatBytes(loaded)} / ${FormatBytes(total)}`;
                } else {
                    this.statusText.textContent = `Downloading • ${FormatBytes(loaded)}`;
                }
            }
        } else if (phase === 'decrypting') {
            if (this.iconEl) {
                this.iconEl.textContent = 'lock_open';
            }
            if (this.percentText) this.percentText.textContent = '100%';
            if (this.progressBar) this.progressBar.style.width = '100%';
            if (this.statusText) this.statusText.textContent = 'Decrypting file…';
        } else if (phase === 'complete') {
            if (this.iconEl) {
                this.iconEl.textContent = 'check_circle';
                this.iconEl.style.color = '#137333';
            }
            if (this.percentText) this.percentText.textContent = 'Done';
            if (this.progressBar) this.progressBar.style.width = '100%';
            if (this.statusText) this.statusText.textContent = 'Download ready!';
            setTimeout(() => this.dismiss(), 2000);
        }
    }

    fail(err) {
        if (!this.el) return;
        if (this.iconEl) {
            this.iconEl.textContent = 'error';
            this.iconEl.style.color = 'var(--g-danger, #b3261e)';
        }
        if (this.percentText) this.percentText.textContent = 'Failed';
        if (this.statusText) this.statusText.textContent = (err?.message || 'Download failed');
        setTimeout(() => this.dismiss(), 4000);
    }

    dismiss() {
        if (this.el) {
            this.el.style.opacity = '0';
            this.el.style.transform = 'translate(-50%, 12px)';
            setTimeout(() => {
                this.el?.remove();
                this.el = null;
            }, 300);
        }
    }
}
