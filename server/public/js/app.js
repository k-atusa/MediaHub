// MediaHub SPA Master Application Entry
import { SafeSession } from './core/session.js';
import { router } from './core/router.js';
import { driveService } from './services/drive.js';
import { loginView } from './views/login.js';
import { driveView } from './views/drive.js';
import { viewerView } from './views/viewer.js';
import { ShowNotice, ShowAlert, DisableAllAutocomplete, GetObjPid } from './core/utils.js';

// Expose notice & cancelUpload globally for template modal and inline button access
window.showNotice = ShowNotice;
window.alert = ShowAlert;
window.cancelUpload = (idx) => driveService.CancelUpload(idx);

// Switch active view DOM container visibility
function activateView(viewId) {
    document.querySelectorAll('.view-container').forEach(el => {
        el.classList.remove('active');
    });
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.add('active');
    }
}

// Bootstrap master application, initialize session and register History API routes
async function bootstrap() {
    await SafeSession.Init();
    await driveService.InitSession();

    // Theme initialization
    const savedTheme = localStorage.getItem('theme') || 'system';
    if (savedTheme === 'dark' || savedTheme === 'light') {
        document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
        document.documentElement.removeAttribute('data-theme');
    }

    // System dark mode preference change listener
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if ((localStorage.getItem("theme") || "system") === "system") {
            driveView.UpdateThemeUI();
        }
    });

    // Navigation Guards for authentication checking
    router.BeforeEach(async (path, query) => {
        const isAuth = Boolean(SafeSession.GetItem("userHash") && SafeSession.GetItem("userKey"));

        // If not authenticated and attempting to access protected views
        if (!isAuth && path !== '/login') {
            const redirectUrl = window.location.pathname + window.location.search;
            SafeSession.SetItem("redirectAfterLogin", redirectUrl);
            return '/login';
        }

        // If authenticated and attempting to access login view
        if (isAuth && path === '/login') {
            return '/drive';
        }

        return null;
    });

    // Register View: Login
    router.On('/login', async () => {
        activateView('view-login');
        await loginView.Mount();
    });

    // Register View: Drive Workspace
    router.On('/drive', async ({ query }) => {
        activateView('view-drive');

        let targetFolderName = "";
        const fldPid = query.f;
        const filePid = query.p;

        if (fldPid) {
            for (const [name, key] of Object.entries(driveService.fldMap)) {
                const raw = driveService.UnmaskKey(key);
                if (GetObjPid(raw) === fldPid) {
                    targetFolderName = name;
                    raw.fill(0);
                    break;
                }
                raw.fill(0);
            }
        }

        await driveView.Mount(targetFolderName);

        // Handle file deep link restoration
        if (filePid && targetFolderName) {
            const opened = await driveView.openFileByPid(filePid);
            if (opened) {
                await router.Replace('/viewer');
                return;
            }
        }

        // Normalize URL if parameters were present
        if (fldPid || filePid) {
            window.history.replaceState(null, '', '/drive');
        }
    });

    // Register View: Media Viewer
    router.On('/viewer', async ({ query }) => {
        activateView('view-viewer');

        if (query.f || query.p) {
            await viewerView.MountWithQuery(query);
            window.history.replaceState(null, '', '/viewer');
            return;
        }

        await viewerView.Mount();
    });

    DisableAllAutocomplete();

    // Start router and handle initial document path
    await router.Init();
}

// Start application after DOM is ready
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
