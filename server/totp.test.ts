import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ChallengeStore,
  generateBackupCodes,
  hashBackupCode,
  normalizeBackupCode,
  generateTotpSecret,
  buildOtpAuthUri,
  verifyTotpCode,
  generateTotpForTest,
} from "./totp.js";

describe("ChallengeStore", () => {
  it("creates challenges with unique ids", () => {
    const store = new ChallengeStore();
    const a = store.create("u1");
    const b = store.create("u2");
    assert.notEqual(a.id, b.id);
    assert.equal(store.size(), 2);
  });

  it("returns not_found for unknown id", () => {
    const store = new ChallengeStore();
    const r = store.attempt("nope");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "not_found");
  });

  it("locks after maxAttempts (5) and rejects further attempts", () => {
    const store = new ChallengeStore({ maxAttempts: 5 });
    const ch = store.create("u1");
    for (let i = 0; i < 5; i++) {
      const r = store.attempt(ch.id);
      assert.equal(r.ok, true, `attempt ${i + 1} should be allowed`);
    }
    const locked = store.attempt(ch.id);
    assert.equal(locked.ok, false);
    if (!locked.ok) assert.equal(locked.reason, "locked");
  });

  it("expires challenges after ttl", () => {
    let now = 1_000_000;
    const store = new ChallengeStore({ ttlMs: 5 * 60 * 1000, now: () => now });
    const ch = store.create("u1");
    now += 4 * 60 * 1000;
    assert.equal(store.attempt(ch.id).ok, true);
    now += 2 * 60 * 1000;
    const r = store.attempt(ch.id);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "expired");
  });

  it("sweepExpired removes expired entries", () => {
    let now = 1_000;
    const store = new ChallengeStore({ ttlMs: 1000, now: () => now });
    store.create("u1");
    store.create("u2");
    assert.equal(store.size(), 2);
    now += 5000;
    store.sweepExpired();
    assert.equal(store.size(), 0);
  });

  it("delete removes the entry", () => {
    const store = new ChallengeStore();
    const ch = store.create("u1");
    store.delete(ch.id);
    assert.equal(store.size(), 0);
    assert.equal(store.attempt(ch.id).ok, false);
  });
});

describe("Backup codes", () => {
  it("generates 10 codes by default with XXXXX-XXXXX format", () => {
    const codes = generateBackupCodes();
    assert.equal(codes.length, 10);
    for (const c of codes) {
      assert.match(c, /^[0-9A-F]{5}-[0-9A-F]{5}$/);
    }
  });

  it("generates the requested count of codes", () => {
    assert.equal(generateBackupCodes(3).length, 3);
  });

  it("produces unique codes per call", () => {
    const codes = generateBackupCodes(20);
    assert.equal(new Set(codes).size, codes.length);
  });

  it("normalizeBackupCode strips dashes/spaces and uppercases", () => {
    assert.equal(normalizeBackupCode("ab-cd ef"), "ABCDEF");
    assert.equal(normalizeBackupCode("ABCDE-12345"), "ABCDE12345");
  });

  it("hashBackupCode is stable and case/format insensitive", () => {
    const h1 = hashBackupCode("ABCDE-12345");
    const h2 = hashBackupCode("abcde12345");
    const h3 = hashBackupCode(" ABCDE - 12345 ");
    assert.equal(h1, h2);
    assert.equal(h1, h3);
    assert.equal(h1.length, 64);
  });

  it("hashBackupCode differs for different codes", () => {
    assert.notEqual(hashBackupCode("AAAAA-AAAAA"), hashBackupCode("BBBBB-BBBBB"));
  });
});

describe("TOTP", () => {
  it("generates a valid base32 secret", () => {
    const s = generateTotpSecret();
    assert.ok(s.length >= 16);
    assert.match(s, /^[A-Z2-7]+$/);
  });

  it("buildOtpAuthUri encodes issuer and account", () => {
    const uri = buildOtpAuthUri("JBSWY3DPEHPK3PXP", "alice@example.com", "ServiceHub");
    assert.match(uri, /^otpauth:\/\/totp\//);
    assert.match(uri, /ServiceHub/);
    assert.match(uri, /alice/);
    assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
  });

  it("verifyTotpCode accepts a freshly generated code", () => {
    const secret = generateTotpSecret();
    const code = generateTotpForTest(secret);
    assert.equal(verifyTotpCode(secret, code), true);
  });

  it("verifyTotpCode rejects malformed input", () => {
    const secret = generateTotpSecret();
    assert.equal(verifyTotpCode(secret, ""), false);
    assert.equal(verifyTotpCode(secret, "abcdef"), false);
    assert.equal(verifyTotpCode(secret, "12345"), false);
    assert.equal(verifyTotpCode(secret, "1234567"), false);
  });

  it("verifyTotpCode rejects an obviously wrong code", () => {
    const secret = generateTotpSecret();
    const real = generateTotpForTest(secret);
    const wrong = real === "000000" ? "111111" : "000000";
    assert.equal(verifyTotpCode(secret, wrong), false);
  });
});
