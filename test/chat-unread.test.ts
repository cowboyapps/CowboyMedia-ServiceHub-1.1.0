import test from "node:test";
import assert from "node:assert/strict";
import { computeNewArrivals } from "../client/src/lib/chat-unread";

const ids = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i + offset}` }));

test("first load (empty prev set) yields no unread arrivals", () => {
  assert.deepEqual(computeNewArrivals(new Set(), ids(50)), []);
});

test("undefined message list yields no arrivals", () => {
  assert.deepEqual(computeNewArrivals(new Set(["m1"]), undefined), []);
});

test("detects a new message when the list grows", () => {
  const prev = new Set(ids(3).map((m) => m.id));
  assert.deepEqual(computeNewArrivals(prev, [...ids(3), { id: "new1" }]), ["new1"]);
});

test("capped list: new arrival detected even when length stays constant", () => {
  // Room at the 50-message cap: one old message rolls off, one new rolls in.
  const prevList = ids(50); // m0..m49
  const prev = new Set(prevList.map((m) => m.id));
  const next = [...ids(49, 1), { id: "m50" }]; // m1..m49 + m50 (still length 50)
  assert.equal(next.length, prevList.length);
  assert.deepEqual(computeNewArrivals(prev, next), ["m50"]);
});

test("capped list: multiple arrivals in one refetch are all reported in order", () => {
  const prev = new Set(ids(50).map((m) => m.id));
  const next = [...ids(47, 3), { id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(computeNewArrivals(prev, next), ["a", "b", "c"]);
});

test("edits/deletions (no new IDs) yield no arrivals", () => {
  const prev = new Set(ids(50).map((m) => m.id));
  assert.deepEqual(computeNewArrivals(prev, ids(49)), []);
  assert.deepEqual(computeNewArrivals(prev, ids(50)), []);
});
