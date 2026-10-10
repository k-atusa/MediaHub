// MediaHub Media Viewer View Controller (Pure UI)
import { SafeSession } from '../core/session.js';
import { router } from '../core/router.js';
import { driveService } from '../services/drive.js';
import { adapter } from '../adapter.js';
import { ShowNotice, ShowConfirmModal, FormatBytes, EscapeHtml, ToHex, FromHex, GetObjPid } from '../core/utils.js';

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
    // Initialize ViewerView with DOM container and runtime state
    constructor() {
        this.container = document.getElementById('view-viewer');
        this.initialized = false;

        this.fldId = null;
        this.fldKey = null;
        this.flKey = null;
        this.flName = null;
        this.origSize = 0;
        this.rawBuf = null;
        this.currentBlobUrl = null;
    }

    // Initialize UI controls, toolbar buttons, and context menu event listeners
    Init() {
        if (this.initialized) return;
        this.initialized = true;

        const btnBack = document.getElementById("btnViewerBack");
        if (btnBack) {
            btnBack.addEventListener("click", () => {
                router.Navigate('/drive');
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

    // Close viewer dropdown action menu
    closeViewerMenu() {
        const viewerActionMenu = document.getElementById("viewerActionMenu");
        const btnViewerMore = document.getElementById("btnViewerMore");
        if (viewerActionMenu) {
            viewerActionMenu.classList.remove("open");
            viewerActionMenu.style.display = "none";
        }
        if (btnViewerMore) btnViewerMore.classList.remove("open");
    }

    // Mount viewer from active SafeSession cache
    async Mount() {
        this.Init();
        this.CleanupCurrentMedia();

        this.fldId = SafeSession.GetItem("currentFolderId");
        this.flName = SafeSession.GetItem("currentFileName");

        const rawFkHex = SafeSession.GetItem("currentFolderKey");
        const rawFlkHex = SafeSession.GetItem("currentFileKey");

        if (rawFkHex) {
            this.fldKey = driveService.MaskKey(FromHex(rawFkHex));
        } else {
            this.fldKey = null;
        }

        if (rawFlkHex) {
            const rawFlk = FromHex(rawFlkHex);
            this.origSize = driveService.GetEntrySize(rawFlk);
            this.flKey = driveService.MaskKey(rawFlk);
            rawFlk.fill(0);
        } else {
            this.flKey = null;
            this.origSize = 0;
        }

        if (!this.flKey || !this.flName || !this.fldId || !this.fldKey) {
            return router.Navigate('/drive', true);
        }

        const txName = document.getElementById("txName");
        if (txName) {
            txName.textContent = this.flName;
            txName.title = this.flName;
        }

        await this.renderFilePreview();
        await this.setupNeighborNavigation();
    }

    // Mount viewer using deep link query parameters (folder PID & file PID)
    async MountWithQuery(query = {}) {
        this.Init();
        const fldPid = query.f;
        const filePid = query.p;

        if (!fldPid || !filePid) {
            return this.Mount();
        }

        let targetFolderName = "";
        let targetFolderKey = null;
        for (const [name, key] of Object.entries(driveService.fldMap)) {
            const raw = driveService.UnmaskKey(key);
            if (GetObjPid(raw) === fldPid) {
                targetFolderName = name;
                targetFolderKey = key;
                raw.fill(0);
                break;
            }
            raw.fill(0);
        }

        if (!targetFolderName || !targetFolderKey) {
            await ShowNotice("Folder not found or you lack permission to access it.", "Access Denied", "error");
            return router.Navigate('/drive', true);
        }

        const filesMap = await adapter.LoadFolderMeta(fldPid, targetFolderKey);
        let foundFileName = "";
        let foundFileKey = null;

        for (const [name, key] of Object.entries(filesMap)) {
            if (GetObjPid(key.slice(0, 44)) === filePid) {
                foundFileName = name;
                foundFileKey = key;
                break;
            }
        }

        if (!foundFileName || !foundFileKey) {
            await ShowNotice("The requested file was not found in this folder.", "File Not Found", "error");
            return router.Navigate('/drive', true);
        }

        const rawFldK = driveService.UnmaskKey(targetFolderKey);
        SafeSession.SetItem("currentFolderName", targetFolderName);
        SafeSession.SetItem("currentFolderId", fldPid);
        SafeSession.SetItem("currentFolderKey", ToHex(rawFldK));
        SafeSession.SetItem("currentFileName", foundFileName);
        SafeSession.SetItem("currentFileKey", ToHex(foundFileKey));
        SafeSession.SetItem("oldFold", targetFolderName);
        rawFldK.fill(0);
        foundFileKey.fill(0);
        await SafeSession.Save();

        return this.Mount();
    }

    // Release current media player, image viewer, and blob URL resources
    CleanupCurrentMedia() {
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

    // Determine media category kind based on file extension
    getKind(name) {
        const ext = ((name || '').split('.').pop() || '').toLowerCase();
        if (VIDEO_EXTS.includes(ext)) return 'video';
        if (AUDIO_EXTS.includes(ext)) return 'audio';
        if (IMAGE_EXTS.includes(ext)) return 'image';
        if (PDF_EXTS.includes(ext)) return 'pdf';
        if (TEXT_EXTS.includes(ext)) return 'text';
        return 'unsupported';
    }

    // Map file extension to standard MIME type
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

    // Render file preview using streaming Service Worker or in-memory blob decryption
    async renderFilePreview() {
        const rawFk = driveService.UnmaskKey(this.flKey);
        const flPid = GetObjPid(rawFk.slice(0, 44));
        rawFk.fill(0);

        const body = document.getElementById("viewBody");
        if (!body) return;
        const kind = this.getKind(this.flName);

        if (kind === 'unsupported' && this.origSize > 4096) {
            return this.renderUnsupported(body);
        }

        if (kind === 'video' || kind === 'audio') {
            body.innerHTML = `<p style="color:var(--preview-subtext);font-size:13px;margin:20px 0">Preparing ${kind} stream…</p>`;
            try {
                await adapter.RegisterStreaming(this.fldId, flPid, this.flKey, this.origSize, this.flName);

                const fallbackToFullDown = async (reason) => {
                    console.warn(`Streaming failed (${reason}). Falling back to full download...`);
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

    // Render audio player card
    renderAudioPlayer(srcUrl, body, onError) {
        const sizeStr = this.origSize > 0 ? FormatBytes(this.origSize) : '';
        body.innerHTML = `
            <div class="audio-player-card">
                <div class="audio-hero-icon-box">
                    <span class="material-symbols-outlined audio-hero-icon">graphic_eq</span>
                </div>
                <div class="audio-title" title="${EscapeHtml(this.flName)}">${EscapeHtml(this.flName)}</div>
                <div class="audio-meta">${sizeStr}</div>
                <audio controls autoplay class="audio-element" id="audioPlayer" src="${srcUrl}"></audio>
            </div>
        `;
        if (onError) {
            body.querySelector('#audioPlayer')?.addEventListener('error', () => onError('Audio playback error'));
        }
    }

    // Render unsupported file preview card with direct download button
    renderUnsupported(body) {
        const sizeStr = this.origSize > 0 ? FormatBytes(this.origSize) : '';
        body.innerHTML = `
            <div class="unsupported-preview-card">
                <div class="unsupported-icon-box">
                    <span class="material-symbols-outlined unsupported-icon">draft</span>
                </div>
                <h2 class="unsupported-title">No preview available</h2>
                <p class="unsupported-msg">Preview is not supported for this file.</p>
                <div class="unsupported-meta">
                    <span class="unsupported-filename" title="${EscapeHtml(this.flName)}">${EscapeHtml(this.flName)}</span>
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

    // Download and decrypt entire media file into in-memory blob
    async fullDownloadAndRender(flPid, body) {
        const prog = document.createElement("div");
        prog.style.position = "fixed";
        prog.style.top = "50%";
        prog.style.width = "100%";
        prog.style.textAlign = "center";
        prog.textContent = "🔒 Loading & Decrypting…";
        body.appendChild(prog);

        try {
            const blobUrl = await adapter.LoadMediaBlob(
                this.fldId,
                flPid,
                this.flKey,
                this.origSize,
                this.getMime(this.flName)
            );
            this.currentBlobUrl = blobUrl;
            body.removeChild(prog);
            this.renderDecryptedMedia(blobUrl, body);
        } catch (e) {
            if (prog.parentNode) body.removeChild(prog);
            body.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--preview-subtext);">
                    <span class="material-symbols-outlined" style="font-size: 48px; color: var(--preview-danger); margin-bottom: 12px; display: block;">error_outline</span>
                    <h3 style="margin: 0 0 8px 0; color: var(--preview-text);">Unable to load file</h3>
                    <p style="margin: 0 0 20px 0; font-size: 14px;">${EscapeHtml(e.message || "Failed to load media")}</p>
                </div>
            `;
        }
    }

    // Render media element from decrypted blob URL
    renderDecryptedMedia(blobUrl, body) {
        const kind = this.getKind(this.flName);
        body.innerHTML = "";

        if (kind === 'video') {
            const v = document.createElement("video");
            v.controls = true;
            v.src = blobUrl;
            v.style.width = "100%";
            body.appendChild(v);
        } else if (kind === 'image') {
            const img = document.createElement("img");
            img.src = blobUrl;
            img.alt = this.flName;
            img.style.display = "none";
            body.appendChild(img);

            if (window.Viewer) {
                window.currentViewer = new window.Viewer(img, {
                    inline: true,
                    button: false,
                    navbar: false,
                    title: false,
                    toolbar: {
                        zoomIn: 1, zoomOut: 1, oneToOne: 1, reset: 1, prev: 0, play: 0, next: 0, rotateLeft: 1, rotateRight: 1, flipHorizontal: 1, flipVertical: 1,
                    },
                    backdrop: 'static'
                });
            }
        } else if (kind === 'audio') {
            this.renderAudioPlayer(blobUrl, body);
        } else if (kind === 'pdf') {
            const obj = document.createElement("object");
            obj.data = blobUrl;
            obj.type = "application/pdf";
            obj.style.width = "100%";
            obj.style.height = "90vh";
            body.appendChild(obj);
        } else {
            this.renderUnsupported(body);
        }
    }

    // Setup previous/next neighbor navigation buttons within folder
    async setupNeighborNavigation() {
        const btnPrev = document.getElementById("btnPrevFile");
        const btnNext = document.getElementById("btnNextFile");
        if (btnPrev) btnPrev.classList.add("hidden");
        if (btnNext) btnNext.classList.add("hidden");

        try {
            const flsMap = await adapter.LoadFolderMeta(this.fldId, this.fldKey);
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
                    SafeSession.SetItem("currentFileName", prevNm);
                    SafeSession.SetItem("currentFileKey", ToHex(prevKy));
                    SafeSession.Save();
                    this.Mount();
                };
            }

            if (idx < entries.length - 1 && btnNext) {
                const [nxtNm, nxtKy] = entries[idx + 1];
                btnNext.classList.remove("hidden");
                btnNext.onclick = () => {
                    SafeSession.SetItem("currentFileName", nxtNm);
                    SafeSession.SetItem("currentFileKey", ToHex(nxtKy));
                    SafeSession.Save();
                    this.Mount();
                };
            }

            for (const [, v] of entries) if (v?.fill) v.fill(0);
        } catch (e) {
            console.error("Neighbor navigation error:", e);
        }
    }

    // Generate PID-based deep link and copy to clipboard
    async shareCurrentFile() {
        if (!this.fldId || !this.flKey) return;
        const rawFk = driveService.UnmaskKey(this.flKey);
        const filePid = GetObjPid(rawFk.slice(0, 44));
        rawFk.fill(0);

        const url = `${window.location.origin}/drive?f=${encodeURIComponent(this.fldId)}&p=${encodeURIComponent(filePid)}`;
        try {
            await navigator.clipboard.writeText(url);
            ShowNotice("Deep link copied to clipboard.", "Share", "check_circle");
        } catch {
            prompt("Copy link:", url);
        }
    }

    // Open file rename modal dialog
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

    // Perform file rename through DriveService
    async performRename(newNm) {
        if (!newNm || newNm === this.flName) return false;
        try {
            await driveService.RenameFile(this.flName, newNm);
            SafeSession.SetItem("currentFileName", newNm);
            await SafeSession.Save();

            this.flName = newNm;
            const tx = document.getElementById("txName");
            if (tx) { tx.textContent = newNm; tx.title = newNm; }
            ShowNotice(`Renamed to "${newNm}"`, "Success", "check_circle");
            return true;
        } catch (e) {
            ShowNotice("Rename failed: " + e.message, "Error", "error");
            return false;
        }
    }

    // Download current file through blob URL trigger
    async downloadCurrentFile() {
        if (this.currentBlobUrl) {
            const a = document.createElement('a');
            a.href = this.currentBlobUrl;
            a.download = this.flName;
            a.click();
            return;
        }

        const rawFk = driveService.UnmaskKey(this.flKey);
        const flPid = GetObjPid(rawFk.slice(0, 44));
        rawFk.fill(0);

        ShowNotice(`Preparing download for "${this.flName}"...`, "Downloading", "download");
        try {
            const blobUrl = await adapter.LoadMediaBlob(
                this.fldId,
                flPid,
                this.flKey,
                this.origSize,
                this.getMime(this.flName)
            );
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = this.flName;
            a.click();
            URL.revokeObjectURL(blobUrl);
        } catch (e) {
            ShowNotice("Download failed: " + e.message, "Error", "error");
        }
    }

    // Permanently delete current file from folder and return to drive
    async deleteCurrentFile() {
        const ok = await ShowConfirmModal(
            `Are you sure you want to delete "<strong>${EscapeHtml(this.flName)}</strong>"?`,
            "Delete file?",
            "delete",
            "Delete",
            true
        );
        if (!ok) return;

        try {
            await driveService.DeleteFile(this.flName);
            ShowNotice(`Deleted "${this.flName}"`, "Success", "check_circle");
            router.Navigate('/drive');
        } catch (e) {
            ShowNotice("Delete failed: " + e.message, "Error", "error");
        }
    }
}

// Global viewer view singleton instance
export const viewerView = new ViewerView();
