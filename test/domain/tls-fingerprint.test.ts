import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    chromeMajorVersion,
    profileFingerprint,
    tlsClientProfile
} from "../../src/domain/tls-fingerprint.js";

describe("TLS profiles", () => {
    it("reads the Chrome major version from a user agent", () => {
        assert.equal(
            chromeMajorVersion(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML,"
                + " like Gecko) Chrome/126.0.6478.126 Safari/537.36"
            ),
            126
        );
        assert.equal(chromeMajorVersion("curl/8.4.0"), 0);
    });

    it("pins the newest tls-client profile at or below the browser", () => {
        assert.equal(tlsClientProfile(133), "chrome_133");
        assert.equal(tlsClientProfile(140), "chrome_133");
        assert.equal(tlsClientProfile(126), "chrome_124");
        assert.equal(tlsClientProfile(0), "chrome_103");
    });

    it("tracks Chrome's post-quantum key share rollout", () => {
        assert.ok(profileFingerprint(120).curves.includes("X25519"));
        assert.equal(
            profileFingerprint(120).curves.includes("X25519MLKEM768"),
            false
        );
        assert.ok(
            profileFingerprint(126).curves.includes("X25519Kyber768Draft00")
        );
        assert.ok(profileFingerprint(133).curves.includes("X25519MLKEM768"));
    });

    it("flags a version-derived fingerprint as unmeasured", () => {
        const fingerprint = profileFingerprint(133);

        assert.equal(fingerprint.source, "profile");
        assert.equal(fingerprint.ja3, undefined);
        assert.ok(fingerprint.notes.length > 0);
    });
});
