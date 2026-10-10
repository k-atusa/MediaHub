// MediaHub Core Utilities & Modals
import { SHA3256 } from '../engine/Bencrypt.js';

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

// Escape special HTML characters to prevent XSS attacks
export const EscapeHtml = (str) => {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// Extract 24-byte object PID from a 44-byte raw cryptographic key slice
export const GetObjPid = (key) => {
    if (!key || key.length < 44) return '';
    return ToHex(key.slice(32, 44));
};

// Compute 16-byte user PID hash from user master key
export const GetUserPid = (key) => {
    if (!key) return '';
    return ToHex(SHA3256(key).slice(0, 16));
};

// Display unified Material You notice alert modal
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

// Smart Alert wrapper that chooses icon and title based on message content
export const ShowAlert = (msg) => {
    let title = 'Notice';
    let icon = 'campaign';
    if (typeof msg === 'string') {
        if (msg.includes('❌') || msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error') || msg.toLowerCase().includes('invalid')) {
            title = 'Error';
            icon = 'error';
        } else if (msg.includes('⚠️') || msg.toLowerCase().includes('warning') || msg.toLowerCase().includes('fill')) {
            title = 'Notice';
            icon = 'warning';
        } else if (msg.includes('✅') || msg.toLowerCase().includes('success')) {
            title = 'Success';
            icon = 'check_circle';
        }
    }
    return ShowNotice(msg, title, icon);
};

// Display confirmation modal with action buttons
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

// Disable browser autocomplete and autocorrect on all text inputs
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
