import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeUserBadges, computeAccountAgeDays } from "./badges";

describe("computeAccountAgeDays", () => {
  it("returns 0 for null", () => {
    assert.equal(computeAccountAgeDays(null), 0);
  });
  it("returns floored days", () => {
    const now = new Date("2026-05-12T00:00:00Z");
    const created = new Date("2026-05-02T12:00:00Z");
    assert.equal(computeAccountAgeDays(created, now), 9);
  });
});

describe("computeUserBadges", () => {
  const now = new Date("2026-05-12T00:00:00Z");

  it("returns admin badge for admin role", () => {
    const out = computeUserBadges({ role: "admin", email: "a@b.c" }, { ticketCount: 0, accountAgeDays: 1 }, { betaCutoff: null, now });
    assert.ok(out.find((b) => b.key === "admin"));
  });

  it("returns master admin badge for master_admin role", () => {
    const out = computeUserBadges({ role: "master_admin", email: "a@b.c" }, { ticketCount: 0, accountAgeDays: 1 }, { betaCutoff: null, now });
    assert.ok(out.find((b) => b.key === "master_admin"));
    assert.ok(!out.find((b) => b.key === "admin"));
  });

  it("returns silver veteran for >=1y but <3y", () => {
    const out = computeUserBadges({ role: "customer", email: "x@y.z" }, { ticketCount: 0, accountAgeDays: 400 }, { betaCutoff: null, now });
    assert.ok(out.find((b) => b.key === "veteran_silver"));
    assert.ok(!out.find((b) => b.key === "veteran_gold"));
  });

  it("returns gold veteran for >=3y", () => {
    const out = computeUserBadges({ role: "customer", email: "x@y.z" }, { ticketCount: 0, accountAgeDays: 365 * 3 + 5 }, { betaCutoff: null, now });
    assert.ok(out.find((b) => b.key === "veteran_gold"));
    assert.ok(!out.find((b) => b.key === "veteran_silver"));
  });

  it("returns top asker for 10+ tickets", () => {
    const out = computeUserBadges({ role: "customer", email: "x@y.z" }, { ticketCount: 10, accountAgeDays: 1 }, { betaCutoff: null, now });
    assert.ok(out.find((b) => b.key === "top_asker"));
  });

  it("does not return top asker for <10 tickets", () => {
    const out = computeUserBadges({ role: "customer", email: "x@y.z" }, { ticketCount: 9, accountAgeDays: 1 }, { betaCutoff: null, now });
    assert.ok(!out.find((b) => b.key === "top_asker"));
  });

  it("returns beta tester when joined before cutoff", () => {
    const cutoff = new Date("2026-01-01T00:00:00Z");
    const out = computeUserBadges(
      { role: "customer", email: "x@y.z", createdAt: new Date("2025-06-01T00:00:00Z") },
      { ticketCount: 0, accountAgeDays: 400 },
      { betaCutoff: cutoff, now },
    );
    assert.ok(out.find((b) => b.key === "beta_tester"));
  });

  it("does not return beta tester when joined after cutoff", () => {
    const cutoff = new Date("2026-01-01T00:00:00Z");
    const out = computeUserBadges(
      { role: "customer", email: "x@y.z", createdAt: new Date("2026-02-01T00:00:00Z") },
      { ticketCount: 0, accountAgeDays: 100 },
      { betaCutoff: cutoff, now },
    );
    assert.ok(!out.find((b) => b.key === "beta_tester"));
  });

  it("returns verified email when email present", () => {
    const out = computeUserBadges({ role: "customer", email: "a@b.c" }, { ticketCount: 0, accountAgeDays: 1 }, { betaCutoff: null, now });
    assert.ok(out.find((b) => b.key === "verified_email"));
  });

  it("does not return verified email when email blank", () => {
    const out = computeUserBadges({ role: "customer", email: "" }, { ticketCount: 0, accountAgeDays: 1 }, { betaCutoff: null, now });
    assert.ok(!out.find((b) => b.key === "verified_email"));
  });
});
