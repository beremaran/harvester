import type { ProxySettings } from "../../domain/proxy.js";

/**
 * Playwright's context proxy options, ready to spread into `newContext`.
 * Empty when there is no proxy, so the browser goes out direct.
 */
export function proxyContextOptions(
    proxy: ProxySettings | undefined
): {
    proxy?: {
        server: string;
        username?: string;
        password?: string;
        bypass?: string;
    };
} {
    if (!proxy) {
        return {};
    }

    return {
        proxy: {
            server: proxy.server,
            ...(proxy.username ? { username: proxy.username } : {}),
            ...(proxy.password ? { password: proxy.password } : {}),
            ...(proxy.bypass ? { bypass: proxy.bypass } : {})
        }
    };
}
