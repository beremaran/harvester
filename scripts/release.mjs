#!/usr/bin/env node
/**
 * Cuts a release: bumps the version, rolls CHANGELOG.md's Unreleased section
 * into a dated heading, commits, and creates an annotated `vX.Y.Z` tag.
 *
 *   npm run release -- patch
 *   npm run release -- minor --dry-run
 *   npm run release -- 2.0.0 --skip-checks
 *
 * Pushing is left to you: `git push --follow-tags`. The tag is what triggers
 * the image publish in .github/workflows/release.yml.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "package.json");
const changelogPath = join(repoRoot, "CHANGELOG.md");
const RELEASE_BRANCH = "main";

function run(command, args, { capture = true } = {}) {
    return execFileSync(command, args, {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
}

function fail(message) {
    console.error(`release: ${message}`);
    process.exit(1);
}

function parseArguments(argv) {
    const options = {
        bump: undefined,
        dryRun: false,
        skipChecks: false,
        allowEmptyChangelog: false,
        allowAnyBranch: false
    };

    for (const argument of argv) {
        switch (argument) {
            case "--dry-run":
                options.dryRun = true;
                break;
            case "--skip-checks":
                options.skipChecks = true;
                break;
            case "--allow-empty-changelog":
                options.allowEmptyChangelog = true;
                break;
            case "--allow-any-branch":
                options.allowAnyBranch = true;
                break;
            default:
                if (argument.startsWith("-")) {
                    fail(`unknown flag ${argument}`);
                }
                if (options.bump) {
                    fail("give exactly one version argument");
                }
                options.bump = argument;
        }
    }

    if (!options.bump) {
        fail("usage: npm run release -- <patch|minor|major|X.Y.Z> [flags]");
    }
    return options;
}

function parseVersion(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match) {
        fail(`cannot parse version "${version}" — expected X.Y.Z`);
    }
    return match.slice(1, 4).map(Number);
}

function nextVersion(current, bump) {
    const [major, minor, patch] = parseVersion(current);
    switch (bump) {
        case "major":
            return `${major + 1}.0.0`;
        case "minor":
            return `${major}.${minor + 1}.0`;
        case "patch":
            return `${major}.${minor}.${patch + 1}`;
        default: {
            parseVersion(bump);
            return bump;
        }
    }
}

/** Turns either remote form into `https://github.com/owner/repo`. */
function repositoryUrl() {
    let remote;
    try {
        remote = run("git", ["remote", "get-url", "origin"]).trim();
    } catch {
        return undefined;
    }
    const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(remote);
    if (ssh) {
        return `https://${ssh[1]}/${ssh[2]}`;
    }
    return remote.replace(/\.git$/, "");
}

function assertReleasableWorkingTree(options) {
    if (run("git", ["status", "--porcelain"]).trim()) {
        fail("working tree is dirty — commit or stash first");
    }

    const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    if (branch !== RELEASE_BRANCH && !options.allowAnyBranch) {
        fail(
            `on branch "${branch}"; release from ${RELEASE_BRANCH} ` +
                "or pass --allow-any-branch"
        );
    }
}

function assertTagIsFree(tag) {
    const existing = run("git", ["tag", "--list", tag]).trim();
    if (existing) {
        fail(`tag ${tag} already exists`);
    }
}

/**
 * Moves everything under `## [Unreleased]` into a dated `## [version]`
 * heading and rewrites the comparison links at the bottom of the file.
 */
function rollChangelog(changelog, version, previousVersion, date, options) {
    const heading = "## [Unreleased]";
    const start = changelog.indexOf(heading);
    if (start === -1) {
        fail(`CHANGELOG.md has no "${heading}" section`);
    }

    const bodyStart = start + heading.length;
    const nextHeading = changelog.indexOf("\n## ", bodyStart);
    const bodyEnd = nextHeading === -1 ? changelog.length : nextHeading;
    const body = changelog.slice(bodyStart, bodyEnd).trim();

    if (!body && !options.allowEmptyChangelog) {
        fail(
            "the Unreleased section is empty — describe the release or pass " +
                "--allow-empty-changelog"
        );
    }

    const released = body || "_No user-facing changes._";
    const rolled =
        changelog.slice(0, start) +
        `${heading}\n\n## [${version}] - ${date}\n\n${released}\n` +
        changelog.slice(bodyEnd);

    const repository = repositoryUrl();
    if (!repository) {
        return rolled;
    }

    const unreleasedLink =
        `[unreleased]: ${repository}/compare/v${version}...HEAD`;
    const versionLink =
        `[${version}]: ${repository}/compare/` +
        `v${previousVersion}...v${version}`;

    if (/^\[unreleased\]:.*$/m.test(rolled)) {
        return rolled.replace(
            /^\[unreleased\]:.*$/m,
            `${unreleasedLink}\n${versionLink}`
        );
    }
    return `${rolled.trimEnd()}\n\n${unreleasedLink}\n${versionLink}\n`;
}

const options = parseArguments(process.argv.slice(2));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const previousVersion = manifest.version;
const version = nextVersion(previousVersion, options.bump);
const tag = `v${version}`;

assertReleasableWorkingTree(options);
assertTagIsFree(tag);

console.log(`release: ${previousVersion} -> ${version}`);

if (options.skipChecks) {
    console.log("release: skipping typecheck/tests (--skip-checks)");
} else {
    console.log("release: running npm run check");
    run("npm", ["run", "check"], { capture: false });
    console.log("release: running npm test");
    run("npm", ["test"], { capture: false });
}

const date = new Date().toISOString().slice(0, 10);
const changelog = rollChangelog(
    readFileSync(changelogPath, "utf8"),
    version,
    previousVersion,
    date,
    options
);

if (options.dryRun) {
    console.log(
        `release: dry run — would write ${tag}, roll CHANGELOG.md, ` +
            "commit and tag"
    );
    process.exit(0);
}

writeFileSync(changelogPath, changelog);
// npm keeps package.json and package-lock.json in step for us.
run("npm", ["version", version, "--no-git-tag-version", "--allow-same-version"]);

const staged = ["package.json", "package-lock.json", "CHANGELOG.md"].filter(
    (file) => existsSync(join(repoRoot, file))
);
run("git", ["add", ...staged]);
run("git", ["commit", "-m", `chore(release): ${tag}`]);
run("git", ["tag", "-a", tag, "-m", tag]);

console.log(`release: committed and tagged ${tag}`);
console.log("release: publish with  git push --follow-tags");
