// Pure crop/resize math shared by the admin product-image crop dialog. Kept
// free of React + DOM so it can be unit-tested without jsdom/canvas.

export type CropAspectKey = "16:9" | "1:1" | "4:3";

export const CROP_ASPECTS: { key: CropAspectKey; label: string; value: number }[] = [
  { key: "16:9", label: "Wide 16:9", value: 16 / 9 },
  { key: "1:1", label: "Square 1:1", value: 1 },
  { key: "4:3", label: "Standard 4:3", value: 4 / 3 },
];

// Largest dimension (px) the cropped/resized blob is written at. Caps huge
// camera photos so saved blobs stay small while staying crisp on retina cards.
export const MAX_OUTPUT_LONG_EDGE = 1280;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export function aspectValue(key: CropAspectKey): number {
  return CROP_ASPECTS.find((a) => a.key === key)?.value ?? 16 / 9;
}

// Smallest scale so the image fully covers the crop window (no gaps).
export function coverScale(iw: number, ih: number, vw: number, vh: number): number {
  if (iw <= 0 || ih <= 0) return 1;
  return Math.max(vw / iw, vh / ih);
}

// Keep the displayed image's top-left offset within bounds so the crop window
// is always fully covered: offset.x in [vw - dw, 0], offset.y in [vh - dh, 0].
export function clampOffset(
  offset: { x: number; y: number },
  vw: number,
  vh: number,
  dw: number,
  dh: number,
): { x: number; y: number } {
  return {
    x: Math.min(0, Math.max(vw - dw, offset.x)),
    y: Math.min(0, Math.max(vh - dh, offset.y)),
  };
}

export interface CropRegion {
  // Source-image rectangle to sample from.
  sx: number;
  sy: number;
  sW: number;
  sH: number;
  // Output canvas dimensions (respect the chosen aspect, capped long edge).
  outW: number;
  outH: number;
}

// Map the crop window (0,0)-(vw,vh) back into source-image pixels and pick an
// output size that keeps the aspect ratio, caps the long edge, and never
// upscales beyond the framed source region.
export function computeCropRegion(params: {
  offset: { x: number; y: number };
  scale: number;
  vw: number;
  vh: number;
  ratio: number;
  maxLongEdge?: number;
}): CropRegion {
  const { offset, scale, vw, vh, ratio } = params;
  const maxLongEdge = params.maxLongEdge ?? MAX_OUTPUT_LONG_EDGE;
  const sx = -offset.x / scale;
  const sy = -offset.y / scale;
  const sW = vw / scale;
  const sH = vh / scale;
  const longEdge = Math.min(maxLongEdge, Math.round(Math.max(sW, sH)));
  const outW = ratio >= 1 ? longEdge : Math.round(longEdge * ratio);
  const outH = ratio >= 1 ? Math.round(longEdge / ratio) : longEdge;
  return { sx, sy, sW, sH, outW, outH };
}
