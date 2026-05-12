import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { groupServiceUpdates, SERVICE_UPDATE_GROUP_WINDOW_MS } from "./group-service-updates.ts";

const MIN = 60 * 1000;

const u = (id: string, serviceId: string, minutesAgo: number) => ({
  id,
  serviceId,
  createdAt: new Date(Date.now() - minutesAgo * MIN).toISOString(),
});

describe("groupServiceUpdates", () => {
  it("returns empty for empty/undefined input", () => {
    assert.deepEqual(groupServiceUpdates([]), []);
    assert.deepEqual(groupServiceUpdates(undefined), []);
  });

  it("keeps each update as its own group when services differ", () => {
    const updates = [u("a", "s1", 0), u("b", "s2", 5), u("c", "s3", 10)];
    const groups = groupServiceUpdates(updates);
    assert.equal(groups.length, 3);
    assert.equal(groups[0].items.length, 1);
  });

  it("collapses 3+ consecutive same-service updates within rolling 30min windows", () => {
    // 0, 20, 40 minutes ago — adjacent gaps are 20min each, all <= 30min.
    const updates = [u("a", "s1", 0), u("b", "s1", 20), u("c", "s1", 40)];
    const groups = groupServiceUpdates(updates);
    assert.equal(groups.length, 1, "should be one group, not split by 40min head distance");
    assert.equal(groups[0].items.length, 3);
    assert.equal(groups[0].head.id, "a");
  });

  it("splits a same-service chain when an adjacent gap exceeds the window", () => {
    // 0, 20, 60 minutes ago — gap between 20 and 60 is 40min > 30min.
    const updates = [u("a", "s1", 0), u("b", "s1", 20), u("c", "s1", 60)];
    const groups = groupServiceUpdates(updates);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].items.length, 2);
    assert.equal(groups[1].items.length, 1);
    assert.equal(groups[1].items[0].id, "c");
  });

  it("starts a new group when the service changes even within the window", () => {
    const updates = [u("a", "s1", 0), u("b", "s2", 5), u("c", "s1", 10)];
    const groups = groupServiceUpdates(updates);
    assert.equal(groups.length, 3);
  });

  it("respects a custom window", () => {
    const updates = [u("a", "s1", 0), u("b", "s1", 10)];
    const tight = groupServiceUpdates(updates, 5 * MIN);
    const loose = groupServiceUpdates(updates, 15 * MIN);
    assert.equal(tight.length, 2);
    assert.equal(loose.length, 1);
  });

  it("uses the documented 30-minute default", () => {
    assert.equal(SERVICE_UPDATE_GROUP_WINDOW_MS, 30 * 60 * 1000);
  });
});
