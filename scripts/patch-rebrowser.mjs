/**
 * Post-install patch for the vendored rebrowser-playwright-core fork.
 *
 * Playwright evaluates page functions through an internal wrapper class named
 * `UtilityScript`, so `UtilityScript.evaluate` shows up in any Error stack a
 * page captures during an evaluate. bot-detector.rebrowser.net's `sourceUrlLeak`
 * test reads exactly that: a stack containing `UtilityScript.` is flagged as
 * "unpatched Playwright". The fork does not rename it, so we do — the export key
 * stays `UtilityScript` (Playwright looks it up by that name), only the class
 * *binding* is renamed, which is all the stack frame reflects. Behaviour is
 * unchanged; the tell is gone.
 *
 * npm aliases `playwright-core` -> `rebrowser-playwright-core`, which defeats
 * patch-package (it fetches upstream Playwright as the baseline and produces a
 * huge, wrong diff). A tiny idempotent script sidesteps that entirely and runs
 * from `postinstall` so a fresh `npm ci` — including inside Docker — stays
 * patched.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(
    here,
    "../node_modules/playwright-core/lib/generated/utilityScriptSource.js"
);

const NEW_NAME = "PwEvaluator";
const replacements = [
    { from: "() => UtilityScript", to: `() => ${NEW_NAME}` },
    { from: "var UtilityScript = class", to: `var ${NEW_NAME} = class` }
];

if (!existsSync(target)) {
    console.warn(`[patch-rebrowser] ${target} not found — skipping`);
    process.exit(0);
}

const original = readFileSync(target, "utf8");

if (original.includes(`var ${NEW_NAME} = class`)) {
    console.log("[patch-rebrowser] UtilityScript wrapper already renamed");
    process.exit(0);
}

let patched = original;
for (const { from, to } of replacements) {
    if (!patched.includes(from)) {
        console.warn(
            `[patch-rebrowser] expected snippet not found: ${JSON.stringify(from)}` +
            " — the fork may have changed; leaving the file untouched"
        );
        process.exit(0);
    }
    patched = patched.split(from).join(to);
}

writeFileSync(target, patched);
console.log(
    `[patch-rebrowser] renamed UtilityScript wrapper to ${NEW_NAME} ` +
    "(sourceUrlLeak no longer sees it in stacks)"
);
