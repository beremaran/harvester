import type { Browser, BrowserContext } from "playwright";

import { DEFAULT_TLS_FINGERPRINT_PROBE_URL } from "../../config.js";

import {
    CHROME_HTTP2,
    chromeMajorVersion,
    profileFingerprint,
    type TlsFingerprint
} from "../../domain/tls-fingerprint.js";
import type { BrowserProvider } from "./browser-manager.js";

/**
 * Reads back the TLS/HTTP2 fingerprint of the browser we render with, by
 * having that browser hit a fingerprinting endpoint itself. The handshake
 * measured is the same handshake target sites see, which is the only way to
 * report exact JA3/JA4 values — Chrome randomises extension order per
 * connection, so they cannot be derived from the version alone.
 *
 * Default endpoint is `tls.peet.ws`; any endpoint returning the same JSON
 * shape works (`TLS_FINGERPRINT_PROBE_URL`).
 */
export interface TlsFingerprintProvider {
    fingerprint(userAgent: string): Promise<TlsFingerprint>;
}

export interface TlsFingerprintProbeOptions {
    probeUrl: string | undefined;
    timeoutMs: number;
}

const DEFAULT_OPTIONS: TlsFingerprintProbeOptions = {
    probeUrl: DEFAULT_TLS_FINGERPRINT_PROBE_URL,
    timeoutMs: 15_000
};

export class PlaywrightTlsFingerprintProbe implements TlsFingerprintProvider {
    private measurement: Promise<TlsFingerprint | undefined> | undefined;
    private context: Promise<BrowserContext> | undefined;
    private readonly options: TlsFingerprintProbeOptions;

    constructor(
        private readonly browsers: BrowserProvider,
        options: Partial<TlsFingerprintProbeOptions> = {},
        private readonly onError: (error: unknown) => void = () => undefined
    ) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    async fingerprint(userAgent: string): Promise<TlsFingerprint> {
        const majorVersion = chromeMajorVersion(userAgent);

        if (!this.options.probeUrl) {
            return profileFingerprint(majorVersion);
        }

        this.measurement ??= this.measure().catch((error: unknown) => {
            this.onError(error);
            // A probe failure must never fail a render: the version profile
            // is still a usable answer, just flagged as unmeasured.
            this.measurement = undefined;
            return undefined;
        });

        const measured = await this.measurement;

        return measured
            ? { ...measured, chromeMajorVersion: majorVersion }
            : profileFingerprint(majorVersion);
    }

    private async measure(): Promise<TlsFingerprint | undefined> {
        const context = await this.contextFor();
        const page = await context.newPage();

        try {
            const response = await page.goto(this.options.probeUrl ?? "", {
                waitUntil: "domcontentloaded",
                timeout: this.options.timeoutMs
            });

            if (!response?.ok()) {
                throw new Error(
                    `TLS probe returned ${response?.status() ?? 0}`
                );
            }

            return toFingerprint(await response.json());
        } finally {
            await page.close();
        }
    }

    private contextFor(): Promise<BrowserContext> {
        this.context ??= this.browsers.getBrowser()
            .then((browser: Browser) => browser.newContext())
            .catch((error: unknown) => {
                this.context = undefined;
                throw error;
            });

        return this.context;
    }

    async close(): Promise<void> {
        const context = this.context;
        this.context = undefined;
        this.measurement = undefined;
        await (await context?.catch(() => undefined))?.close();
    }
}

interface ProbePayload {
    http_version?: string;
    tls?: {
        ciphers?: string[];
        extensions?: { name?: string; supported_groups?: string[];
            signature_algorithms?: string[] }[];
        ja3?: string;
        ja3_hash?: string;
        ja4?: string;
        ja4_r?: string;
        peetprint_hash?: string;
        tls_version_negotiated?: string;
    };
    http2?: {
        akamai_fingerprint?: string;
    };
}

const TLS_VERSIONS: Record<string, string> = {
    "771": "TLS 1.2",
    "772": "TLS 1.3"
};

export function toFingerprint(payload: unknown): TlsFingerprint | undefined {
    const body = payload as ProbePayload | null;
    const tls = body?.tls;

    if (!tls?.ja3 && !tls?.ja4) {
        return undefined;
    }

    const negotiated = tls.tls_version_negotiated ?? "772";
    const extensions = tls.extensions ?? [];
    const curves = extensions.flatMap(
        (extension) => extension.supported_groups ?? []
    );
    const signatureAlgorithms = extensions.flatMap(
        (extension) => extension.signature_algorithms ?? []
    );
    const fallback = profileFingerprint(0);

    return {
        source: "measured",
        chromeMajorVersion: 0,
        tlsVersion: TLS_VERSIONS[negotiated] ?? negotiated,
        alpn: ["h2", "http/1.1"],
        ...optional("ja3", tls.ja3),
        ...optional("ja3Hash", tls.ja3_hash),
        ...optional("ja4", tls.ja4),
        ...optional("ja4r", tls.ja4_r),
        ...optional("peetprintHash", tls.peetprint_hash),
        ciphers: dropGrease(tls.ciphers ?? fallback.ciphers),
        curves: curves.length ? dropGrease(curves) : fallback.curves,
        signatureAlgorithms: signatureAlgorithms.length
            ? signatureAlgorithms
            : fallback.signatureAlgorithms,
        http2: parseAkamai(body?.http2?.akamai_fingerprint),
        notes: [
            "Measured from this renderer's own Chrome against the probe endpoint.",
            "JA3 changes between connections because Chrome shuffles extension order and inserts GREASE — JA4 is the stable one to match on."
        ]
    };
}

function optional<K extends string>(
    key: K,
    value: string | undefined
): Record<K, string> | Record<string, never> {
    return value ? ({ [key]: value } as Record<K, string>) : {};
}

/** GREASE values are per-connection noise; reporting them invites copying. */
function dropGrease(values: string[]): string[] {
    return values.filter((value) => !/GREASE/i.test(value));
}

function parseAkamai(fingerprint: string | undefined) {
    const parts = fingerprint?.split("|") ?? [];

    if (parts.length !== 4) {
        return CHROME_HTTP2;
    }

    const [settings = "", windowUpdate = "", priority = "", order = ""] =
        parts;

    return {
        fingerprint: fingerprint ?? CHROME_HTTP2.fingerprint,
        settings,
        windowUpdate,
        priority,
        pseudoHeaderOrder: order
    };
}
