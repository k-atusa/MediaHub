// MediaHub Lightweight SPA History API Router
export class Router {
    // Initialize router instance with routes, navigation guards, and history listener
    constructor() {
        this.routes = [];
        this.beforeHooks = [];
        this.currentPath = '';
        this.isNavigating = false;

        // Listen to browser forward and back popstate events
        window.addEventListener('popstate', () => this.handleRoute());
    }

    // Register a navigation guard executed before each transition
    BeforeEach(hook) {
        this.beforeHooks.push(hook);
    }

    // Register a route pattern with an associated handler function
    On(pattern, handler) {
        const paramNames = [];
        const regexStr = pattern.replace(/:([a-zA-Z0-9_]+)/g, (_, paramName) => {
            paramNames.push(paramName);
            return '([^/?]+)';
        });
        const regex = new RegExp(`^${regexStr}$`);
        this.routes.push({ pattern, regex, paramNames, handler });
        return this;
    }

    // Parse current location pathname and search query parameters
    ParseUrl() {
        let path = window.location.pathname;
        if (!path || path === '/') {
            path = '/drive';
        }

        const query = {};
        const search = window.location.search;
        if (search) {
            new URLSearchParams(search.slice(1)).forEach((val, key) => {
                query[key] = val;
            });
        }
        return { path, query, fullPath: path + search };
    }

    // Navigate to a new route using HTML5 History pushState
    async Navigate(targetUrl, replace = false) {
        let cleanUrl = targetUrl;
        if (cleanUrl.startsWith('#')) cleanUrl = cleanUrl.slice(1);
        if (!cleanUrl.startsWith('/')) cleanUrl = '/' + cleanUrl;

        const currentFull = window.location.pathname + window.location.search;
        if (currentFull !== cleanUrl) {
            if (replace) {
                window.history.replaceState(null, '', cleanUrl);
            } else {
                window.history.pushState(null, '', cleanUrl);
            }
        }
        await this.handleRoute();
    }

    // Replace current history entry without pushing a new history state
    async Replace(targetUrl) {
        return this.Navigate(targetUrl, true);
    }

    // Execute route matching, navigation guards, and target view handler
    async handleRoute() {
        if (this.isNavigating) return;
        this.isNavigating = true;

        try {
            const { path, query } = this.ParseUrl();

            // Run registered beforeEach navigation guards
            for (const hook of this.beforeHooks) {
                const redirect = await hook(path, query);
                if (redirect && redirect !== path) {
                    this.isNavigating = false;
                    return this.Navigate(redirect);
                }
            }

            this.currentPath = path;

            // Find matching route pattern and execute handler
            let matched = false;
            for (const route of this.routes) {
                const match = path.match(route.regex);
                if (match) {
                    matched = true;
                    const params = {};
                    route.paramNames.forEach((name, idx) => {
                        params[name] = decodeURIComponent(match[idx + 1] || '');
                    });
                    await route.handler({ params, query, path });
                    break;
                }
            }

            // Fallback to /drive if no route matches
            if (!matched && path !== '/drive') {
                return this.Navigate('/drive', true);
            }
        } finally {
            this.isNavigating = false;
        }
    }

    // Initialize router and trigger handler for initial document URL
    Init() {
        return this.handleRoute();
    }
}

// Global router singleton instance
export const router = new Router();
