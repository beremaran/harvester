/**
 * Classifies a render into a bot-defence outcome.
 *
 * This exists to document *where* a request was stopped, which is the
 * deliverable for an external posture assessment. It reads the evidence a
 * defence leaves behind in plain sight -- status codes, vendor cookies,
 * response headers, interstitial titles -- and does not attempt to influence
 * any of them.
 */

export type BlockOutcome = "served" | "challenged" | "blocked";

export interface BlockSignal {
    /** Where the evidence came from: status, cookie, header, or body. */
    source: "status" | "cookie" | "header" | "body";
    /** The specific thing observed, e.g. `_abck` or `server: AkamaiGHost`. */
    detail: string;
}

export interface BlockAssessment {
    outcome: BlockOutcome;
    /** Best guess at the defence vendor, or `unknown` when nothing matched. */
    vendor: string;
    signals: BlockSignal[];
}

export interface BlockEvidence {
    status: number;
    title: string;
    responseHeaders: Record<string, string>;
    cookieNames: string[];
}

interface VendorFingerprint {
    vendor: string;
    cookiePrefixes: string[];
    headers: string[];
    titles: string[];
}

const VENDORS: VendorFingerprint[] = [
    {
        vendor: "Akamai Bot Manager",
        cookiePrefixes: ["_abck", "ak_bmsc", "bm_sz", "bm_sv", "bm_mi"],
        headers: ["akamai-grn", "x-akamai-transformed"],
        titles: ["access denied", "reference #"]
    },
    {
        vendor: "Imperva",
        cookiePrefixes: ["visid_incap_", "incap_ses_", "nlbi_"],
        headers: ["x-iinfo", "x-cdn"],
        titles: ["request unsuccessful", "incapsula"]
    },
    {
        vendor: "Cloudflare Bot Management",
        cookiePrefixes: ["cf_clearance", "__cf_bm", "__cfruid"],
        headers: ["cf-ray", "cf-mitigated"],
        titles: ["just a moment", "attention required"]
    },
    {
        vendor: "DataDome",
        cookiePrefixes: ["datadome"],
        headers: ["x-datadome", "x-dd-b"],
        titles: []
    },
    {
        vendor: "PerimeterX / HUMAN",
        cookiePrefixes: ["_px", "_pxhd", "_pxvid"],
        headers: ["x-px"],
        titles: ["press & hold", "pardon our interruption"]
    }
];

/** Statuses a defence uses to refuse outright. */
const REFUSAL_STATUSES = new Set([401, 403, 405, 406, 429, 503]);

export function assessBlocking(evidence: BlockEvidence): BlockAssessment {
    const signals: BlockSignal[] = [];
    const headers = new Map(
        Object.entries(evidence.responseHeaders).map(
            ([name, value]) => [name.toLowerCase(), value]
        )
    );
    const cookieNames = evidence.cookieNames.map(
        (name) => name.toLowerCase()
    );
    const title = evidence.title.toLowerCase();
    const vendors = new Set<string>();

    for (const fingerprint of VENDORS) {
        const matches: BlockSignal[] = [];

        for (const prefix of fingerprint.cookiePrefixes) {
            const hit = cookieNames.find((name) => name.startsWith(prefix));
            if (hit) {
                matches.push({ source: "cookie", detail: hit });
            }
        }

        for (const header of fingerprint.headers) {
            if (headers.has(header)) {
                matches.push({
                    source: "header",
                    detail: `${header}: ${headers.get(header) ?? ""}`.trim()
                });
            }
        }

        for (const marker of fingerprint.titles) {
            if (title.includes(marker)) {
                matches.push({
                    source: "body",
                    detail: `page title: ${evidence.title}`
                });
            }
        }

        if (matches.length > 0) {
            vendors.add(fingerprint.vendor);
            signals.push(...matches);
        }
    }

    if (REFUSAL_STATUSES.has(evidence.status)) {
        signals.push({
            source: "status",
            detail: `HTTP ${evidence.status}`
        });
    }

    return {
        outcome: classify(evidence, signals),
        vendor: vendors.size > 0 ? [...vendors].join(", ") : "unknown",
        signals
    };
}

function classify(
    evidence: BlockEvidence,
    signals: BlockSignal[]
): BlockOutcome {
    if (REFUSAL_STATUSES.has(evidence.status)) {
        return "blocked";
    }

    // A vendor cookie on a 200 is routine -- the defence is present and let us
    // through. Only an interstitial in the body means we were held.
    if (signals.some((signal) => signal.source === "body")) {
        return "challenged";
    }

    return "served";
}
