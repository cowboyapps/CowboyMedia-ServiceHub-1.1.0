import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aspectValue,
  coverScale,
  clampOffset,
  computeCropRegion,
  CROP_ASPECTS,
} from "./image-crop.js";

test("aspectValue maps each key to its ratio and defaults to 16:9", () => {
  assert.equal(aspectValue("1:1"), 1);
  assert.equal(aspectValue("4:3"), 4 / 3);
  assert.equal(aspectValue("16:9"), 16 / 9);
  // @ts-expect-error - exercising the fallback for an unknown key
  assert.equal(aspectValue("bogus"), 16 / 9);
});

test("CROP_ASPECTS exposes exactly the three supported ratios", () => {
  assert.deepEqual(CROP_ASPECTS.map((a) => a.key), ["16:9", "1:1", "4:3"]);
});

test("coverScale picks the larger of width/height ratios so the window is filled", () => {
  // Wide image into a square window: height is the binding dimension.
  assert.equal(coverScale(200, 100, 100, 100), 1); // max(0.5, 1)
  // Tall image into a square window: width is the binding dimension.
  assert.equal(coverScale(100, 200, 100, 100), 1); // max(1, 0.5)
  // Small image scaled UP to cover.
  assert.equal(coverScale(50, 50, 100, 100), 2);
});

test("coverScale is defensive against zero-size images", () => {
  assert.equal(coverScale(0, 0, 320, 180), 1);
});

test("clampOffset keeps the image covering the window (no gaps)", () => {
  // Image 400x400 displayed, window 320x180. Valid x in [-80, 0], y in [-220, 0].
  assert.deepEqual(clampOffset({ x: 50, y: 50 }, 320, 180, 400, 400), { x: 0, y: 0 });
  assert.deepEqual(clampOffset({ x: -999, y: -999 }, 320, 180, 400, 400), { x: -80, y: -220 });
  assert.deepEqual(clampOffset({ x: -40, y: -100 }, 320, 180, 400, 400), { x: -40, y: -100 });
});

test("computeCropRegion maps the window back to source pixels", () => {
  // scale 2 means each window px covers half a source px.
  const r = computeCropRegion({ offset: { x: -40, y: -20 }, scale: 2, vw: 320, vh: 180, ratio: 16 / 9 });
  assert.equal(r.sx, 20); // 40/2
  assert.equal(r.sy, 10); // 20/2
  assert.equal(r.sW, 160); // 320/2
  assert.equal(r.sH, 90); // 180/2
});

test("computeCropRegion output respects aspect and caps the long edge", () => {
  // Huge framed region (scale 0.1 → sW=3200) caps long edge at maxLongEdge.
  const wide = computeCropRegion({ offset: { x: 0, y: 0 }, scale: 0.1, vw: 320, vh: 180, ratio: 16 / 9, maxLongEdge: 1280 });
  assert.equal(wide.outW, 1280);
  assert.equal(wide.outH, 720); // 1280 / (16/9)

  const square = computeCropRegion({ offset: { x: 0, y: 0 }, scale: 0.1, vw: 320, vh: 320, ratio: 1, maxLongEdge: 1000 });
  assert.equal(square.outW, 1000);
  assert.equal(square.outH, 1000);

  // Portrait ratio (<1): long edge is the height.
  const portrait = computeCropRegion({ offset: { x: 0, y: 0 }, scale: 0.1, vw: 180, vh: 320, ratio: 3 / 4, maxLongEdge: 1200 });
  assert.equal(portrait.outH, 1200);
  assert.equal(portrait.outW, Math.round(1200 * (3 / 4)));
});

test("computeCropRegion never upscales beyond the framed source region", () => {
  // Small framed region (scale 4 → sW=80, sH=45) keeps output at source size.
  const r = computeCropRegion({ offset: { x: 0, y: 0 }, scale: 4, vw: 320, vh: 180, ratio: 16 / 9, maxLongEdge: 1280 });
  assert.equal(r.outW, 80); // min(1280, round(80))
  assert.equal(r.outH, 45);
});
