// MediaHub Media Viewer View Controller
import { SymMaster, Masker } from '../engine/Bencrypt.js';
import { DecodeCfg, DecodeInt, EncodeInt } from '../engine/Opsec.js';
import { NetSrc } from '../core/media.js';
import { SafeSession } from '../core/session.js';
import { router } from '../core/router.js';
import { driveService } from '../services/drive.js';
import { showNotice, showConfirmModal, formatBytes, escapeHtml, toHex, fromHex, getObjPid } from '../core/utils.js';

const mask = new Masker();

const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv'];
const AUDIO_EXTS = ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'opus', 'wma'];
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
const PDF_EXTS = ['pdf'];
const TEXT_EXTS = [
    'txt', 'log', 'md', 'json', 'csv', 'xml', 'html', 'css', 'js', 'ts', 'jsx', 'tsx',
    'yaml', 'yml', 'sh', 'py', 'sql', 'ini', 'conf', 'c', 'cpp', 'h', 'hpp', 'go', 'rs',
    'java', 'kt', 'kts', 'swift', 'rb', 'php', 'cs', 'scala', 'dart', 'lua', 'r',
    'bat', 'cmd', 'ps1', 'zsh', 'bash', 'toml', 'env', 'properties', 'graphql', 'gql',
    'proto', 'diff', 'patch', 'vue', 'svelte', 'lock', 'json5',
    'readme', 'license', 'makefile', 'dockerfile'
];

export class ViewerView {
    constructor() {
        this.container = document.getElementById('view-viewer');
        this.initialized = false;
        this.serverUrl = window.location.origin;

        this.fldId = null;
        this.fldKey = null;
        this.flKey = null;
        this.flName = null;
        this.origSize = 0;
        this.rawBuf = null;
        this.currentBlobUrl = null;
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;

        const btnBack = document.getElementById("btnViewerBack");
        if (btnBack) {
            btnBack.addEventListener("click", () => {
                const oldFold = SafeSession.getItem("oldFold");
                if (oldFold) {
                    router.navigate(`/drive/${encodeURIComponent(oldFold)}`);
                } else {
                    router.navigate('/drive');
                }
            });
        }

        const btnShare = document.getElementById("btnViewerShare");
        const btnEdit = document.getElementById("btnViewerEdit");
        const btnDown = document.getElementById("btnViewerDown");
        const btnDelete = document.getElementById("btnViewerDelete");
        const btnViewerMore = document.getElementById("btnViewerMore");
        const viewerActionMenu = document.getElementById("viewerActionMenu");

        if (btnShare) btnShare.addEventListener("click", () => this.shareCurrentFile());
        if (btnEdit) btnEdit.addEventListener("click", () => this.openRenameModal());
        if (btnDown) btnDown.addEventListener("click", () => this.downloadCurrentFile());
        if (btnDelete) btnDelete.addEventListener("click", () => this.deleteCurrentFile());

        if (btnViewerMore && viewerActionMenu) {
            btnViewerMore.addEventListener("click", (e) => {
                e.stopPropagation();
                const isOpen = viewerActionMenu.classList.toggle("open");
                btnViewerMore.classList.toggle("open", isOpen);
                viewerActionMenu.style.display = isOpen ? "block" : "none";
            });

            document.addEventListener("click", (e) => {
                if (viewerActionMenu.classList.contains("open")) {
                    if (!viewerActionMenu.contains(e.target) && !btnViewerMore.contains(e.target)) {
                        viewerActionMenu.classList.remove("open");
                        btnViewerMore.classList.remove("open");
                        viewerActionMenu.style.display = "none";
                    }
                }
            });
        }

        document.getElementById("viewerMenuShare")?.addEventListener("click", () => {
            this.closeViewerMenu();
            this.shareCurrentFile();
        });
        document.getElementById("viewerMenuRename")?.addEventListener("click", () => {
            this.closeViewerMenu();
            this.openRenameModal();
        });
        document.getElementById("viewerMenuDownload")?.addEventListener("click", () => {
            this.closeViewerMenu();
            this.downloadCurrentFile();
        });
        document.getElementById("viewerMenuDelete")?.addEventListener("click", () => {
            this.closeViewerMenu();
            this.deleteCurrentFile();
        });

        // Rename modal
        const renameFileModal = document.getElementById("renameFileModal");
        const btnConfirmRenameFile = document.getElementById("btnConfirmRenameFile");
        const btnCancelRenameFile = document.getElementById("btnCancelRenameFile");
        const modalRenameFileInput = document.getElementById("modalRenameFileInput");
        const renameFileErrorText = document.getElementById("renameFileErrorText");

        if (btnConfirmRenameFile) {
            btnConfirmRenameFile.addEventListener("click", async () => {
                const newName = modalRenameFileInput?.value.trim();
                if (!newName) {
                    if (renameFileErrorText) {
                        renameFileErrorText.textContent = "Please enter a file name.";
                        renameFileErrorText.style.display = "block";
                    }
                    return;
                }
                const ok = await this.performRename(newName);
                if (ok) renameFileModal?.close();
                else if (renameFileErrorText) {
                    renameFileErrorText.textContent = "Rename failed. A file with this name might already exist.";
                    renameFileErrorText.style.display = "block";
                }
            });
        }
        if (btnCancelRenameFile) btnCancelRenameFile.addEventListener("click", () => renameFileModal?.close());
    }

    closeViewerMenu() {
        const viewerActionMenu = document.getElementById("viewerActionMenu");
        const btnViewerMore = document.getElementById("btnViewerMore");
        if (viewerActionMenu) {
            viewerActionMenu.classList.remove("open");
            viewerActionMenu.style.display = "none";
        }
        if (btnViewerMore) btnViewerMore.classList.remove("open");
    }

    async mount(query = {}) {
        this.init();
        this.cleanupCurrentMedia();

        this.fldId = SafeSession.getItem("currentFolderId");
        this.flName = SafeSession.getItem("currentFileName");

        const rawFK = SafeSession.getItem("currentFolderKey") ? fromHex(SafeSession.getItem("currentFolderKey")) : null;
        const rawFlK = SafeSession.getItem("currentFileKey") ? fromHex(SafeSession.getItem("currentFileKey")) : null;

        if (rawFK) {
            this.fldKey = mask.XOR(rawFK);
            rawFK.fill(0);
        } else {
            this.fldKey = null;
        }

        if (rawFlK) {
            this.origSize = rawFlK.length >= 52 ? DecodeInt(rawFlK.slice(44, 52)) : 0;
            const keyPart = rawFlK.slice(0, 44);
            this.flKey = mask.XOR(keyPart);
            keyPart.fill(0);
            rawFlK.fill(0);
        } else {
            this.flKey = null;
            this.origSize = 0;
        }

        if (!this.flKey || !this.flName || !this.fldId || !this.fldKey) {
            return router.navigate('/drive');
        }

        const txName = document.getElementById("txName");
        if (txName) {
            txName.textContent = this.flName;
            txName.title = this.flName;
        }

        await this.renderFilePreview();
        await this.setupNeighborNavigation();
    }

    cleanupCurrentMedia() {
        if (window.currentViewer) {
            try { window.currentViewer.destroy(); } catch (_) { }
            window.currentViewer = null;
        }
        if (this.currentBlobUrl) {
            try { URL.revokeObjectURL(this.currentBlobUrl); } catch (_) { }
            this.currentBlobUrl = null;
        }
        this.rawBuf = null;
    }

    getKind(name) {
        const ext = ((name || '').split('.').pop() || '').toLowerCase();
        if (VIDEO_EXTS.includes(ext)) return 'video';
        if (AUDIO_EXTS.includes(ext)) return 'audio';
        if (IMAGE_EXTS.includes(ext)) return 'image';
        if (PDF_EXTS.includes(ext)) return 'pdf';
        if (TEXT_EXTS.includes(ext)) return 'text';
        return 'unsupported';
    }

    getMime(name) {
        const ext = ((name || '').split('.').pop() || '').toLowerCase();
        const map = {
            'pdf': 'application/pdf',
            'txt': 'text/plain;charset=utf-8',
            'log': 'text/plain;charset=utf-8',
            'md': 'text/markdown;charset=utf-8',
            'json': 'application/json',
            'csv': 'text/csv;charset=utf-8',
            'xml': 'application/xml',
            'html': 'text/html;charset=utf-8',
            'css': 'text/css;charset=utf-8',
            'js': 'text/javascript;charset=utf-8',
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
            'mp4': 'video/mp4', 'webm': 'video/webm', 'mov': 'video/quicktime', 'mkv': 'video/x-matroska',
            'mp3': 'audio/mpeg', 'ogg': 'audio/ogg', 'wav': 'audio/wav', 'm4a': 'audio/mp4', 'aac': 'audio/aac', 'flac': 'audio/flac'
        };
        return map[ext] || 'application/octet-stream';
    }

    async renderFilePreview() {
        const rawFK = mask.XOR(this.flKey);
        const flPid = getObjPid(rawFK);
        rawFK.fill(0);

        const body = document.getElementById("viewBody");
        if (!body) return;
        const kind = this.getKind(this.flName);

        if (kind === 'unsupported' && this.origSize > 4096) {
            return this.renderUnsupported(body);
        }

        if (kind === 'video' || kind === 'audio') {
            body.innerHTML = `<p style="color:var(--preview-subtext);font-size:13px;margin:20px 0">Preparing ${kind} stream…</p>`;
            try {
                const reg = await navigator.serviceWorker.register('./sw.js?v=2.5', { updateViaCache: 'none' });
                try { await reg.update(); } catch (_) { }
                await navigator.serviceWorker.ready;

                if (!navigator.serviceWorker.controller) {
                    await new Promise(resolve => {
                        const onCtrl = () => {
                            navigator.serviceWorker.removeEventListener('controllerchange', onCtrl);
                            resolve();
                        };
                        navigator.serviceWorker.addEventListener('controllerchange', onCtrl);
                        setTimeout(resolve, 500);
                    });
                }

                const rawKey = mask.XOR(this.flKey);
                const keyHex = toHex(rawKey);
                rawKey.fill(0);

                const ack = new Promise(resolve => {
                    const h = (e) => {
                        if (e.data?.action === 'REGISTERED' && e.data.filePid === flPid) {
                            navigator.serviceWorker.removeEventListener('message', h);
                            resolve();
                        }
                    };
                    navigator.serviceWorker.addEventListener('message', h);
                });

                navigator.serviceWorker.addEventListener('message', (e) => {
                    if (e.data?.action === 'REQUEST_KEY' && e.data.filePid === flPid) {
                        const rk = mask.XOR(this.flKey);
                        reg.active?.postMessage({
                            action: 'REGISTER',
                            folderId: this.fldId,
                            filePid: flPid,
                            fileKey: toHex(rk),
                            originalSize: this.origSize,
                            fileName: this.flName
                        });
                        rk.fill(0);
                    }
                });

                reg.active?.postMessage({
                    action: 'REGISTER',
                    folderId: this.fldId,
                    filePid: flPid,
                    fileKey: keyHex,
                    originalSize: this.origSize,
                    fileName: this.flName
                });
                await ack;

                let fallbackTriggered = false;
                const fallbackToFullDown = async (reason) => {
                    if (fallbackTriggered) return;
                    fallbackTriggered = true;
                    console.warn(`SW stream failed (${reason}). Falling back to full download...`);
                    await this.fullDownloadAndRender(flPid, body);
                };

                body.innerHTML = '';
                if (kind === 'audio') {
                    this.renderAudioPlayer(`/sw-stream/${this.fldId}/${flPid}`, body, fallbackToFullDown);
                } else {
                    const v = document.createElement('video');
                    v.controls = true;
                    v.crossOrigin = 'anonymous';
                    v.playsInline = true;
                    v.preload = 'metadata';
                    v.style.width = '100%';
                    v.src = `/sw-stream/${this.fldId}/${flPid}`;
                    v.addEventListener('error', () => fallbackToFullDown(v.error ? `Code ${v.error.code}` : "Video error"));
                    body.appendChild(v);
                }
                return;
            } catch (e) {
                console.warn('SW streaming error, fallback to full download:', e);
                await this.fullDownloadAndRender(flPid, body);
                return;
            }
        }

        await this.fullDownloadAndRender(flPid, body);
    }

    renderAudioPlayer(srcUrl, body, onError) {
        const sizeStr = this.origSize > 0 ? formatBytes(this.origSize) : '';
        body.innerHTML = `
            <div class="audio-player-card">
                <div class="audio-hero-icon-box">
                    <span class="material-symbols-outlined audio-hero-icon">graphic_eq</span>
                </div>
                <div class="audio-title" title="${escapeHtml(this.flName)}">${escapeHtml(this.flName)}</div>
                <div class="audio-meta">${sizeStr}</div>
                <audio controls autoplay class="audio-element" id="audioPlayer" src="${srcUrl}"></audio>
            </div>
        `;
        if (onError) {
            body.querySelector('#audioPlayer')?.addEventListener('error', () => onError('Audio playback error'));
        }
    }

    renderUnsupported(body) {
        const sizeStr = this.origSize > 0 ? formatBytes(this.origSize) : '';
        body.innerHTML = `
            <div class="unsupported-preview-card">
                <div class="unsupported-icon-box">
                    <span class="material-symbols-outlined unsupported-icon">draft</span>
                </div>
                <h2 class="unsupported-title">No preview available</h2>
                <p class="unsupported-msg">Preview is not supported for this file.</p>
                <div class="unsupported-meta">
                    <span class="unsupported-filename" title="${escapeHtml(this.flName)}">${escapeHtml(this.flName)}</span>
                    ${sizeStr ? `<span class="unsupported-filesize">${sizeStr}</span>` : ''}
                </div>
                <button type="button" class="btn-unsupported-download" id="btnUnsupportedDownload">
                    <span class="material-symbols-outlined">download</span>
                    <span>Download</span>
                </button>
            </div>
        `;
        document.getElementById("btnUnsupportedDownload")?.addEventListener("click", () => this.downloadCurrentFile());
    }

    async fullDownloadAndRender(flPid, body) {
        const head = await fetch(`${this.serverUrl}/api/media/${this.fldId}/${flPid}/dat`, {
            headers: { 'Range': 'bytes=0-0' }
        });
        const contentRange = head.headers.get("Content-Range");
        if (!head.ok || !contentRange) {
            body.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--preview-subtext);">
                    <span class="material-symbols-outlined" style="font-size: 48px; color: var(--preview-danger); margin-bottom: 12px; display: block;">error_outline</span>
                    <h3 style="margin: 0 0 8px 0; color: var(--preview-text);">Unable to load file</h3>
                    <p style="margin: 0 0 20px 0; font-size: 14px;">The requested file binary was not found or is corrupted (HTTP ${head.status}).</p>
                </div>
            `;
            return;
        }

        const totSize = parseInt(contentRange.split('/')[1], 10);
        let loaded = 0;
        const chunks = [];
        const prog = document.createElement("div");
        prog.style.position = "fixed";
        prog.style.top = "50%";
        prog.style.width = "100%";
        prog.style.textAlign = "center";
        body.appendChild(prog);

        while (loaded < totSize) {
            try {
                const res = await fetch(`${this.serverUrl}/api/media/${this.fldId}/${flPid}/dat`, {
                    headers: { 'Range': `bytes=${loaded}-${totSize - 1}` }
                });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    loaded += value.length;
                    prog.textContent = `📥 ${Math.round((loaded / totSize) * 100)}%`;
                }
            } catch (e) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        prog.textContent = "🔒 Decrypting...";
        const fullBuf = new Uint8Array(loaded);
        let offset = 0;
        for (const c of chunks) { fullBuf.set(c, offset); offset += c.length; }

        const rawFK2 = mask.XOR(this.flKey);
        const smx = new SymMaster("gcmx1", rawFK2.slice(0, 32));
        rawFK2.fill(0);
        const ciphSize = smx.AfterSize(this.origSize);
        const encBuf = fullBuf.slice(0, ciphSize);

        const plnChks = [];
        await smx.DeFile(new NetSrc(encBuf), encBuf.length, { write: async (c) => plnChks.push(c) });
        this.rawBuf = new Uint8Array(plnChks.reduce((a, c) => a + c.length, 0));
        let fOff = 0;
        for (const c of plnChks) { this.rawBuf.set(c, fOff); fOff += c.length; }

        body.removeChild(prog);
        this.renderDecryptedBuffer(this.rawBuf, body);
    }

    renderDecryptedBuffer(buf, body) {
        this.currentBlobUrl = URL.createObjectURL(new Blob([buf], { type: this.getMime(this.flName) }));
        const kind = this.getKind(this.flName);
        body.innerHTML = "";

        if (kind === 'video') {
            const v = document.createElement("video");
            v.controls = true;
            v.src = this.currentBlobUrl;
            v.style.width = "100%";
            body.appendChild(v);
        } else if (kind === 'image') {
            const img = document.createElement("img");
            img.src = this.currentBlobUrl;
            img.alt = this.flName;
            img.style.display = "none";
            body.appendChild(img);

            window.currentViewer = new window.Viewer(img, {
                inline: true,
                button: false,
                navbar: false,
                title: false,
                toolbar: {
                    zoomIn: 1, zoomOut: 1, oneToOne: 1, reset: 1, prev: 0, play: 0, next: 0,
                    rotateLeft: 1, rotateRight: 1, flipHorizontal: 1, flipVertical: 1,
                },
                tooltip: true,
                movable: true,
                zoomable: true,
                rotatable: true,
                scalable: true,
                transition: true,
                backdrop: false,
                minZoomRatio: 0.05,
                maxZoomRatio: 50,
                zoomRatio: 0.15,
            });
        } else if (kind === 'audio') {
            this.renderAudioPlayer(this.currentBlobUrl, body);
        } else if (kind === 'pdf') {
            const f = document.createElement("iframe");
            f.src = this.currentBlobUrl;
            f.style.width = "100%";
            f.style.height = "90vh";
            body.appendChild(f);
        } else if (kind === 'text' || buf.length <= 4096) {
            const t = document.createElement("textarea");
            t.value = new TextDecoder().decode(buf);
            t.style.width = "100%";
            t.style.height = "90vh";
            t.readOnly = true;
            t.spellcheck = false;
            body.appendChild(t);
        } else {
            this.renderUnsupported(body);
        }
    }

    async setupNeighborNavigation() {
        const btnPrev = document.getElementById("btnPrevFile");
        const btnNext = document.getElementById("btnNextFile");
        if (btnPrev) btnPrev.classList.add("hidden");
        if (btnNext) btnNext.classList.add("hidden");

        try {
            const res = await fetch(`${this.serverUrl}/api/storage/${this.fldId}/names`);
            if (!res.ok) return;

            const rawSK = mask.XOR(this.fldKey);
            const sm = new SymMaster("gcm1", rawSK.slice(0, 32));
            rawSK.fill(0);

            const dec = await sm.DeBin(new Uint8Array(await res.arrayBuffer()));
            const flsMap = DecodeCfg(dec);
            dec.fill(0);

            const entries = Object.entries(flsMap).sort((a, b) => a[0].localeCompare(b[0]));
            const idx = entries.findIndex(([name]) => name === this.flName);
            if (idx === -1) {
                for (const [, v] of entries) if (v?.fill) v.fill(0);
                return;
            }

            if (idx > 0 && btnPrev) {
                const [prevNm, prevKy] = entries[idx - 1];
                btnPrev.classList.remove("hidden");
                btnPrev.onclick = () => {
                    SafeSession.setItem("currentFileName", prevNm);
                    SafeSession.setItem("currentFileKey", toHex(prevKy));
                    SafeSession.save();
                    this.mount();
                };
            }

            if (idx < entries.length - 1 && btnNext) {
                const [nxtNm, nxtKy] = entries[idx + 1];
                btnNext.classList.remove("hidden");
                btnNext.onclick = () => {
                    SafeSession.setItem("currentFileName", nxtNm);
                    SafeSession.setItem("currentFileKey", toHex(nxtKy));
                    SafeSession.save();
                    this.mount();
                };
            }

            for (const [, v] of entries) if (v?.fill) v.fill(0);
        } catch (e) {
            console.error("Neighbor navigation error:", e);
        }
    }

    async shareCurrentFile() {
        if (!this.fldId || !this.flKey) return;
        let fileParam = this.flName;
        try {
            const rawFK = mask.XOR(this.flKey);
            fileParam = getObjPid(rawFK);
            rawFK.fill(0);
        } catch (_) { }

        const oldFold = SafeSession.getItem("oldFold") || "";
        const url = `${window.location.origin}/#drive/${encodeURIComponent(oldFold)}?file=${encodeURIComponent(fileParam)}`;
        try {
            await navigator.clipboard.writeText(url);
            showNotice("Link copied to clipboard.", "Share", "check_circle");
        } catch {
            prompt("Copy link:", url);
        }
    }

    openRenameModal() {
        const modal = document.getElementById("renameFileModal");
        const input = document.getElementById("modalRenameFileInput");
        const errText = document.getElementById("renameFileErrorText");
        if (errText) errText.style.display = "none";
        if (input) {
            input.value = this.flName;
            const lastDot = this.flName.lastIndexOf('.');
            if (lastDot > 0) input.setSelectionRange(0, lastDot);
            else input.select();
        }
        modal?.showModal();
    }

    async performRename(newNm) {
        if (!newNm || newNm === this.flName) return false;
        try {
            const res = await fetch(`${this.serverUrl}/api/storage/${this.fldId}/names`);
            if (!res.ok) throw new Error("Failed to load folder map");

            const rawSK = mask.XOR(this.fldKey);
            const sm = new SymMaster("gcm1", rawSK.slice(0, 32));
            rawSK.fill(0);

            const dec = await sm.DeBin(new Uint8Array(await res.arrayBuffer()));
            const flsMap = DecodeCfg(dec);
            dec.fill(0);

            const duplicate = Object.keys(flsMap).find(k => k.normalize('NFC') === newNm.normalize('NFC') && k !== this.flName);
            if (duplicate) {
                for (const v of Object.values(flsMap)) if (v?.fill) v.fill(0);
                throw new Error("Duplicate filename");
            }

            const rawFK = mask.XOR(this.flKey);
            const flInfo = new Uint8Array(52);
            flInfo.set(rawFK, 0);
            flInfo.set(EncodeInt(this.origSize, 8), 44);
            rawFK.fill(0);

            flsMap[newNm] = flInfo;
            delete flsMap[this.flName];

            const encoded = EncodeCfg(flsMap);
            for (const v of Object.values(flsMap)) if (v?.fill) v.fill(0);

            await fetch(`${this.serverUrl}/api/storage/${this.fldId}/names`, {
                method: "POST",
                body: await sm.EnBin(encoded)
            });
            encoded.fill(0);

            SafeSession.setItem("currentFileName", newNm);
            await SafeSession.save();

            this.flName = newNm;
            const tx = document.getElementById("txName");
            if (tx) { tx.textContent = newNm; tx.title = newNm; }
            showNotice(`Renamed to "${newNm}"`, "Success", "check_circle");
            return true;
        } catch (e) {
            showNotice("Rename failed: " + e.message, "Error", "error");
            return false;
        }
    }

    async downloadCurrentFile() {
        if (this.rawBuf) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([this.rawBuf], { type: this.getMime(this.flName) }));
            a.download = this.flName;
            a.click();
            return;
        }

        const rawFK = mask.XOR(this.flKey);
        const flPid = getObjPid(rawFK);
        rawFK.fill(0);

        showNotice(`Preparing download for "${this.flName}"...`, "Downloading", "download");
        const prog = document.createElement('div');
        prog.className = "download-progress-toast";
        prog.innerHTML = `<span class="material-symbols-outlined spin-icon">sync</span><span id="downloadProgressText">Downloading… 0%</span>`;
        document.body.appendChild(prog);
        const progText = document.getElementById("downloadProgressText");

        try {
            const head = await fetch(`${this.serverUrl}/api/media/${this.fldId}/${flPid}/dat`, { headers: { 'Range': 'bytes=0-0' } });
            const contentRange = head.headers.get('Content-Range');
            if (!head.ok || !contentRange) {
                prog.remove();
                return showNotice("Download failed: file corrupted or not found.", "Error", "error");
            }
            const totSize = parseInt(contentRange.split('/')[1], 10);
            let loaded = 0; const chunks = [];
            while (loaded < totSize) {
                const res = await fetch(`${this.serverUrl}/api/media/${this.fldId}/${flPid}/dat`, { headers: { 'Range': `bytes=${loaded}-${totSize - 1}` } });
                const reader = res.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    loaded += value.length;
                    if (progText) progText.textContent = `Downloading… ${Math.round((loaded / totSize) * 100)}%`;
                }
            }
            if (progText) progText.textContent = 'Decrypting…';
            const fullBuf = new Uint8Array(loaded); let off = 0;
            for (const c of chunks) { fullBuf.set(c, off); off += c.length; }

            const rawFK2 = mask.XOR(this.flKey);
            const smx = new SymMaster('gcmx1', rawFK2.slice(0, 32)); rawFK2.fill(0);
            const ciphSize = smx.AfterSize(this.origSize);
            const encBuf = fullBuf.slice(0, ciphSize);

            const plain = []; await smx.DeFile(new NetSrc(encBuf), encBuf.length, { write: async (c) => plain.push(c) });
            this.rawBuf = new Uint8Array(plain.reduce((a, c) => a + c.length, 0)); let fo = 0;
            for (const c of plain) { this.rawBuf.set(c, fo); fo += c.length; }

            prog.remove();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([this.rawBuf], { type: this.getMime(this.flName) }));
            a.download = this.flName;
            a.click();
        } catch (e) {
            prog.remove();
            showNotice("Download failed: " + e.message, "Error", "error");
        }
    }

    async deleteCurrentFile() {
        const ok = await showConfirmModal(
            `Are you sure you want to delete "<strong>${escapeHtml(this.flName)}</strong>"? This action cannot be undone.`,
            "Delete file?",
            "delete",
            "Delete",
            true
        );
        if (!ok) return;

        try {
            const rawFK = mask.XOR(this.flKey);
            const flPid = getObjPid(rawFK);
            rawFK.fill(0);

            await fetch(`${this.serverUrl}/api/media/${this.fldId}/${flPid}/dat`, { method: "DELETE" });
            await fetch(`${this.serverUrl}/api/media/${this.fldId}/${flPid}/thumb`, { method: "DELETE" });

            const res = await fetch(`${this.serverUrl}/api/storage/${this.fldId}/names`);
            const rawSK = mask.XOR(this.fldKey);
            const sm = new SymMaster("gcm1", rawSK.slice(0, 32));
            rawSK.fill(0);

            const dec = await sm.DeBin(new Uint8Array(await res.arrayBuffer()));
            const flsMap = DecodeCfg(dec);
            dec.fill(0);
            if (flsMap[this.flName]?.fill) flsMap[this.flName].fill(0);
            delete flsMap[this.flName];

            const encoded = EncodeCfg(flsMap);
            for (const v of Object.values(flsMap)) if (v?.fill) v.fill(0);

            await fetch(`${this.serverUrl}/api/storage/${this.fldId}/names`, { method: "POST", body: await sm.EnBin(encoded) });
            encoded.fill(0);

            const oldFold = SafeSession.getItem("oldFold");
            if (oldFold) router.navigate(`/drive/${encodeURIComponent(oldFold)}`);
            else router.navigate('/drive');
            showNotice(`Deleted "${this.flName}"`, "Success", "check_circle");
        } catch (e) {
            showNotice("Delete failed: " + e.message, "Error", "error");
        }
    }
}

export const viewerView = new ViewerView();
