// Single page application entry point and routing orchestration
import { AppRouter } from './core/router.js';
import { Drive } from './core/drive.js';
import { LoginView } from './views/login.js';
import { DriveView } from './views/drive.js';
import { ViewerView } from './views/viewer.js';
import { SafeSession, ShowNotice, ShowAlert, DisableAllAutocomplete, GetObjPid, setSessionAdapter } from './core/utils.js';
import { Adapter } from './core/adapter.js';

window.alert = ShowAlert;
window.cancelUpload = (idx) => Drive.CancelUpload(idx);

// Toggle visibility of target view container
function activateView(viewId) {
    document.querySelectorAll('.view-container').forEach(el => {
        el.classList.remove('active');
    });
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.add('active');
    }
}

// Bootstrap application, session state, and route handlers
async function bootstrap() {
    // Inject adapter into session manager (breaks circular dependency)
    setSessionAdapter(Adapter);

    await SafeSession.Init();
    await Drive.InitSession();

    const savedTheme = localStorage.getItem('theme') || 'system';
    if (savedTheme === 'dark' || savedTheme === 'light') {
        document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
        document.documentElement.removeAttribute('data-theme');
    }

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if ((localStorage.getItem("theme") || "system") === "system") {
            DriveView.UpdateThemeUI();
            LoginView.UpdateThemeUI();
        }
    });

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => {
            console.warn('[App] ServiceWorker registration failed:', err);
        });
    }

    AppRouter.BeforeEach(async (path, query) => {
        // Stop audio/video playback and release media resources whenever navigating away from viewer
        if (AppRouter.currentPath === '/viewer' && path !== '/viewer') {
            ViewerView.CleanupCurrentMedia();
        }

        const isAuth = Boolean(SafeSession.GetItem("userHash") && SafeSession.GetItem("userKey"));

        // Allow public access if Adapter or route allows (e.g. shared session token query)
        const isPublic = (typeof Adapter.IsPublicRoute === 'function')
            ? await Adapter.IsPublicRoute(path, query)
            : Boolean(query?.s);

        if (!isAuth && !isPublic && path !== '/login') {
            const redirectUrl = window.location.pathname + window.location.search;
            SafeSession.SetItem("redirectAfterLogin", redirectUrl);
            return '/login';
        }

        if (isAuth && path === '/login') {
            return '/drive';
        }

        return null;
    });

    AppRouter.On('/login', async () => {
        activateView('view-login');
        await LoginView.Mount();
    });

    AppRouter.On('/drive', async ({ query }) => {
        const fldPid = query.f;
        const filePid = query.p;

        if (filePid && fldPid) {
            await AppRouter.Replace(`/viewer?f=${encodeURIComponent(fldPid)}&p=${encodeURIComponent(filePid)}`);
            return;
        }

        activateView('view-drive');

        let targetFolderName = "";

        if (fldPid) {
            await Drive.LoadUser();
            for (const [name, key] of Object.entries(Drive.fldMap)) {
                const raw = Drive.UnmaskKey(key);
                if (GetObjPid(raw) === fldPid) {
                    targetFolderName = name;
                    raw.fill(0);
                    break;
                }
                raw.fill(0);
            }
        } else if (Drive.currentFolderName) {
            targetFolderName = Drive.currentFolderName;
        } else {
            const savedFold = SafeSession.GetItem("oldFold");
            if (savedFold) {
                targetFolderName = savedFold;
            }
        }

        await DriveView.Mount(targetFolderName);

        if (filePid && targetFolderName) {
            const opened = await DriveView.OpenFileByPid(filePid);
            if (opened) {
                await AppRouter.Replace('/viewer');
                return;
            }
        }

        if (fldPid || filePid) {
            window.history.replaceState(null, '', '/drive');
        }
    });

    AppRouter.On('/viewer', async ({ query }) => {
        activateView('view-viewer');

        if (query.f || query.p || query.s) {
            await ViewerView.MountWithQuery(query);
            window.history.replaceState(null, '', '/viewer');
            return;
        }

        await ViewerView.Mount();
    });

    DisableAllAutocomplete();
    await AppRouter.Init();
    document.body.classList.add('app-ready');
    document.documentElement.classList.remove('boot-pending');
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
