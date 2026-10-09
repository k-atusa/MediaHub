// MediaHub SPA Master Application Entry
import { SafeSession } from './core/session.js';
import { router } from './core/router.js';
import { driveService } from './services/drive.js';
import { uploadService } from './services/upload.js';
import { loginView } from './views/login.js';
import { driveView } from './views/drive.js';
import { viewerView } from './views/viewer.js';
import { showNotice, showAlert, disableAllAutocomplete, getObjPid } from './core/utils.js';

// Expose notice & cancelUpload globally for backward safety & inline compatibility
window.showNotice = showNotice;
window.alert = showAlert;
window.cancelUpload = (idx) => uploadService.cancelUpload(idx);

// View switcher helper
function activateView(viewId) {
    document.querySelectorAll('.view-container').forEach(el => {
        el.classList.remove('active');
    });
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.add('active');
    }
}

async function bootstrap() {
    await SafeSession.init();
    const hasAuth = await driveService.initSession();

    // Theme initialization
    const savedTheme = localStorage.getItem('theme') || 'system';
    if (savedTheme === 'dark' || savedTheme === 'light') {
        document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
        document.documentElement.removeAttribute('data-theme');
    }

    // System dark mode listener
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if ((localStorage.getItem("theme") || "system") === "system") {
            driveView.updateThemeUI();
        }
    });

    // Navigation Guards
    router.beforeEach(async (path, query) => {
        const isAuth = Boolean(SafeSession.getItem("userHash") && SafeSession.getItem("userKey"));

        // If not logged in and attempting to access drive/viewer
        if (!isAuth && path !== '/login') {
            const redirectUrl = path + (window.location.hash.includes('?') ? '?' + window.location.hash.split('?')[1] : '');
            SafeSession.setItem("redirectAfterLogin", redirectUrl);
            return '/login';
        }

        // If logged in and attempting to access login page
        if (isAuth && path === '/login') {
            return '/drive';
        }

        return null;
    });

    // Register Routes
    router.on('/login', async () => {
        activateView('view-login');
        loginView.mount();
    });

    router.on('/drive/:folderName', async ({ params, query }) => {
        activateView('view-drive');
        await driveView.mount(params.folderName);
        if (query.file) {
            driveView.openFileInViewer(query.file);
        }
    });

    router.on('/drive', async ({ query }) => {
        activateView('view-drive');
        let targetFolder = "";
        if (query.folder) {
            targetFolder = query.folder;
            for (const [name, key] of Object.entries(driveService.fldMap)) {
                if (getObjPid(key) === query.folder || name === query.folder) {
                    targetFolder = name;
                    break;
                }
            }
        }
        await driveView.mount(targetFolder);
        if (query.file) {
            driveView.openFileInViewer(query.file);
        }
    });

    router.on('/viewer', async ({ query }) => {
        activateView('view-viewer');
        await viewerView.mount(query);
    });

    disableAllAutocomplete();

    // Start router
    await router.init();
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
