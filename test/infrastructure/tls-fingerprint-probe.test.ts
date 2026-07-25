import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    toFingerprint
} from "../../src/infrastructure/playwright/tls-fingerprint-probe.js";

const payload = {
    http_version: "h2",
    tls: {
        ciphers: [
            "TLS_GREASE (0x9a9a)",
            "TLS_AES_128_GCM_SHA256",
            "TLS_AES_256_GCM_SHA384"
        ],
        extensions: [
            {
                name: "supported_groups (10)",
                supported_groups: [
                    "TLS_GREASE (0x3a3a)",
                    "X25519MLKEM768 (4588)",
                    "X25519 (29)"
                ]
            },
            {
                name: "signature_algorithms (13)",
                signature_algorithms: ["ecdsa_secp256r1_sha256"]
            }
        ],
        ja3: "771,4865-4866,0-23-65281,29-23-24,0",
        ja3_hash: "cd08e31494f9531f560d64c695473da9",
        ja4: "t13d1516h2_8daaf6152771_02713d6af862",
        ja4_r: "t13d1516h2_002f,0035_0005,000a",
        peetprint_hash: "7c9c9a1b4d1f2e3a",
        tls_version_negotiated: "772"
    },
    http2: {
        akamai_fingerprint: "1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p"
    }
};

describe("TLS fingerprint probe parsing", () => {
    it("maps a probe response onto the fingerprint shape", () => {
        const fingerprint = toFingerprint(payload);

        assert.ok(fingerprint);
        assert.equal(fingerprint.source, "measured");
        assert.equal(fingerprint.tlsVersion, "TLS 1.3");
        assert.equal(fingerprint.ja4, "t13d1516h2_8daaf6152771_02713d6af862");
        assert.equal(
            fingerprint.ja3Hash,
            "cd08e31494f9531f560d64c695473da9"
        );
        assert.equal(fingerprint.http2.pseudoHeaderOrder, "m,a,s,p");
        assert.equal(fingerprint.http2.windowUpdate, "15663105");
        assert.deepEqual(fingerprint.signatureAlgorithms, [
            "ecdsa_secp256r1_sha256"
        ]);
    });

    it("drops the per-connection GREASE values", () => {
        const fingerprint = toFingerprint(payload);

        assert.deepEqual(fingerprint?.ciphers, [
            "TLS_AES_128_GCM_SHA256",
            "TLS_AES_256_GCM_SHA384"
        ]);
        assert.deepEqual(fingerprint?.curves, [
            "X25519MLKEM768 (4588)",
            "X25519 (29)"
        ]);
    });

    it("rejects a response with no fingerprint in it", () => {
        assert.equal(toFingerprint({ tls: {} }), undefined);
        assert.equal(toFingerprint(null), undefined);
    });
});
