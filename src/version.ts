import { createRequire } from "node:module";

// The manifest sits one directory above both `src/` and `dist/`, so the same
// relative path resolves in development and in the built image.
const manifest = createRequire(import.meta.url)("../package.json") as {
    version?: string;
};

/**
 * Semantic version of the running service. `APP_VERSION` lets an image built
 * from a tag report that tag even if package.json was not re-stamped.
 */
export const APP_VERSION: string =
    process.env.APP_VERSION?.trim() || manifest.version || "0.0.0";
