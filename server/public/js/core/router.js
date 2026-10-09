// MediaHub Lightweight SPA Router
export class Router {
    constructor() {
        this.routes = [];
        this.beforeHooks = [];
        this.currentPath = '';
        this.isNavigating = false;

        window.addEventListener('hashchange', () => this.handleRoute());
    }

    beforeEach(hook) {
        this.beforeHooks.push(hook);
    }

    on(pattern, handler) {
        const paramNames = [];
        const regexStr = pattern.replace(/:([a-zA-Z0-9_]+)/g, (_, paramName) => {
            paramNames.push(paramName);
            return '([^/?]+)';
        });
        const regex = new RegExp(`^${regexStr}(?:\\?(.*))?$`);
        this.routes.push({ pattern, regex, paramNames, handler });
        return this;
    }

    parseHash() {
        let hash = window.location.hash.slice(1);
        if (!hash || hash === '/') {
            hash = '/drive';
        }
        if (!hash.startsWith('/')) {
            hash = '/' + hash;
        }
        const [path, queryString] = hash.split('?');
        const query = {};
        if (queryString) {
            new URLSearchParams(queryString).forEach((val, key) => {
                query[key] = val;
            });
        }
        return { fullHash: hash, path, query };
    }

    async navigate(path) {
        let cleanPath = path;
        if (cleanPath.startsWith('#')) cleanPath = cleanPath.slice(1);
        if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;
        if (window.location.hash !== '#' + cleanPath) {
            window.location.hash = cleanPath;
        } else {
            await this.handleRoute();
        }
    }

    async handleRoute() {
        if (this.isNavigating) return;
        this.isNavigating = true;

        try {
            const { fullHash, path, query } = this.parseHash();

            // Run beforeEach guards
            for (const hook of this.beforeHooks) {
                const redirect = await hook(path, query);
                if (redirect && redirect !== path) {
                    this.isNavigating = false;
                    return this.navigate(redirect);
                }
            }

            this.currentPath = path;

            // Find matching route
            for (const route of this.routes) {
                const match = path.match(route.regex);
                if (match) {
                    const params = {};
                    route.paramNames.forEach((name, idx) => {
                        params[name] = decodeURIComponent(match[idx + 1] || '');
                    });
                    await route.handler({ params, query, path });
                    break;
                }
            }
        } finally {
            this.isNavigating = false;
        }
    }

    init() {
        return this.handleRoute();
    }
}

export const router = new Router();
