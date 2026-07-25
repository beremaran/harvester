/**
 * TLS/HTTP2 fingerprint shapes and the fallback profile table.
 *
 * A non-browser scraper that replays our headers and cookies still gets
 * blocked when its TLS ClientHello and HTTP/2 preface do not look like the
 * Chrome those headers claim to come from. Everything here describes that
 * transport layer so the caller can reproduce it.
 *
 * Two sources feed the same shape:
 *  - `measured` — read back from a fingerprinting endpoint hit by the very
 *    Chrome that rendered the page. Authoritative.
 *  - `profile` — derived from the Chrome major version when no measurement is
 *    available. Correct in structure, approximate in the exact hashes, because
 *    Chrome randomises its extension order (and injects GREASE) per
 *    connection.
 */

export type TlsFingerprintSource = "measured" | "profile";

export interface Http2Fingerprint {
    /**
     * Akamai HTTP/2 fingerprint:
     * `settings|window-update|priority|pseudo-header-order`.
     */
    fingerprint: string;
    settings: string;
    windowUpdate: string;
    priority: string;
    /** Chrome sends `:method :authority :scheme :path` — "m,a,s,p". */
    pseudoHeaderOrder: string;
}

export interface TlsFingerprint {
    source: TlsFingerprintSource;
    chromeMajorVersion: number;
    tlsVersion: string;
    alpn: string[];
    ja3?: string;
    ja3Hash?: string;
    ja4?: string;
    ja4r?: string;
    peetprintHash?: string;
    ciphers: string[];
    curves: string[];
    signatureAlgorithms: string[];
    http2: Http2Fingerprint;
    /** Caveats a consumer needs before treating the values above as exact. */
    notes: string[];
}

/**
 * Chrome's TLS 1.3 cipher list. Stable across every modern release; the
 * ClientHello also carries GREASE values that change per connection.
 */
const CHROME_CIPHERS = [
    "TLS_AES_128_GCM_SHA256",
    "TLS_AES_256_GCM_SHA384",
    "TLS_CHACHA20_POLY1305_SHA256",
    "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
    "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
    "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
    "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
    "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
    "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
    "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA",
    "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
    "TLS_RSA_WITH_AES_128_GCM_SHA256",
    "TLS_RSA_WITH_AES_256_GCM_SHA384",
    "TLS_RSA_WITH_AES_128_CBC_SHA",
    "TLS_RSA_WITH_AES_256_CBC_SHA"
];

const CHROME_SIGNATURE_ALGORITHMS = [
    "ecdsa_secp256r1_sha256",
    "rsa_pss_rsae_sha256",
    "rsa_pkcs1_sha256",
    "ecdsa_secp384r1_sha384",
    "rsa_pss_rsae_sha384",
    "rsa_pkcs1_sha384",
    "rsa_pss_rsae_sha512",
    "rsa_pkcs1_sha512"
];

/**
 * Post-quantum key share rollout: X25519Kyber768Draft00 landed enabled by
 * default in Chrome 124 and was replaced by the standardised
 * X25519MLKEM768 in Chrome 131.
 */
function chromeCurves(majorVersion: number): string[] {
    if (majorVersion >= 131) {
        return ["X25519MLKEM768", "X25519", "P-256", "P-384"];
    }
    if (majorVersion >= 124) {
        return ["X25519Kyber768Draft00", "X25519", "P-256", "P-384"];
    }
    return ["X25519", "P-256", "P-384"];
}

/** Chrome's HTTP/2 preface. Unchanged since Chrome 106. */
export const CHROME_HTTP2: Http2Fingerprint = {
    fingerprint: "1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p",
    settings: "1:65536;2:0;4:6291456;6:262144",
    windowUpdate: "15663105",
    priority: "0",
    pseudoHeaderOrder: "m,a,s,p"
};

export function profileFingerprint(
    chromeMajorVersion: number
): TlsFingerprint {
    return {
        source: "profile",
        chromeMajorVersion,
        tlsVersion: "TLS 1.3",
        alpn: ["h2", "http/1.1"],
        ciphers: CHROME_CIPHERS,
        curves: chromeCurves(chromeMajorVersion),
        signatureAlgorithms: CHROME_SIGNATURE_ALGORITHMS,
        http2: CHROME_HTTP2,
        notes: [
            "Derived from the Chrome major version, not measured on the wire.",
            "Chrome shuffles TLS extension order per connection and inserts GREASE values, so a single JA3 hash is not stable for it — match on JA4 or on the cipher/curve lists instead.",
            "Set TLS_FINGERPRINT_PROBE_URL to have the renderer measure its own fingerprint and report source=measured."
        ]
    };
}

/**
 * `bogdanfinn/tls-client` ships one profile per Chrome release. Pin to the
 * newest profile that is not ahead of the browser we are actually running.
 */
export const TLS_CLIENT_CHROME_PROFILES = [
    103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 116, 117, 120, 124,
    131, 132, 133
] as const;

export function tlsClientProfile(chromeMajorVersion: number): string {
    const supported = TLS_CLIENT_CHROME_PROFILES.filter(
        (version) => version <= chromeMajorVersion
    );
    const match = supported.at(-1)
        ?? TLS_CLIENT_CHROME_PROFILES[0];

    return `chrome_${match}`;
}

export function chromeMajorVersion(userAgent: string): number {
    const match = /Chrome\/(\d+)\./.exec(userAgent);
    return match?.[1] ? Number(match[1]) : 0;
}
