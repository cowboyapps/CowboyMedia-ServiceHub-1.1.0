import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ZoomIn, ZoomOut, Crop } from "lucide-react";
import {
  CROP_ASPECTS as ASPECTS,
  MIN_ZOOM,
  MAX_ZOOM,
  aspectValue,
  coverScale,
  clampOffset,
  computeCropRegion,
  type CropAspectKey,
} from "@/lib/image-crop";

export type { CropAspectKey };

interface Props {
  file: File | null;
  open: boolean;
  aspect: CropAspectKey;
  onAspectChange: (a: CropAspectKey) => void;
  // Title context for multi-image (gallery) batches, e.g. "Image 2 of 4".
  position?: { index: number; total: number };
  onConfirm: (cropped: File) => void;
  onCancel: () => void;
}

// A dependency-free crop/resize step: load the chosen file, let the admin
// zoom + drag to frame it inside a fixed-aspect window, then draw the framed
// region to a canvas and hand back a resized blob as a File. Pan/zoom is
// constrained so the image always fully covers the crop window (no gaps).
export function ImageCropDialog({
  file,
  open,
  aspect,
  onAspectChange,
  position,
  onConfirm,
  onCancel,
}: Props) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const ratio = aspectValue(aspect);
  // Display window: fixed width, height derived from the chosen aspect ratio.
  const VW = 320;
  const VH = Math.round(VW / ratio);

  // Load the file into an <img> whenever it changes.
  useEffect(() => {
    if (!file) {
      setImg(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => setImg(el);
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Cover scale: smallest scale so the image fully covers the crop window.
  const baseScale = img ? coverScale(img.naturalWidth, img.naturalHeight, VW, VH) : 1;
  const scale = baseScale * zoom;
  const dW = img ? img.naturalWidth * scale : 0;
  const dH = img ? img.naturalHeight * scale : 0;

  const clamp = useCallback(
    (o: { x: number; y: number }) => clampOffset(o, VW, VH, dW, dH),
    [VW, VH, dW, dH],
  );

  // Recentre whenever the image, aspect, or zoom changes so the framed region
  // stays valid (and starts centred for a fresh image).
  useEffect(() => {
    if (!img) return;
    setOffset(clamp({ x: (VW - dW) / 2, y: (VH - dH) / 2 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, aspect]);

  useEffect(() => {
    // Keep the window centre fixed when zooming.
    setOffset((prev) => clamp({ x: prev.x, y: prev.y }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // Reset zoom for each new file.
  useEffect(() => {
    setZoom(1);
  }, [file]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!img) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset(clamp({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const handleConfirm = async () => {
    if (!img || !file) return;
    setBusy(true);
    try {
      // Map the crop window back into source-image pixels + pick output size.
      const { sx, sy, sW, sH, outW, outH } = computeCropRegion({ offset, scale, vw: VW, vh: VH, ratio });
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, sW, sH, 0, 0, outW, outH);
      const isPng = file.type === "image/png";
      const outType = isPng ? "image/png" : "image/jpeg";
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob(resolve, outType, isPng ? undefined : 0.9),
      );
      if (!blob) throw new Error("Could not render image");
      const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
      const ext = isPng ? "png" : "jpg";
      const cropped = new File([blob], `${baseName}-cropped.${ext}`, { type: outType });
      onConfirm(cropped);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-image-crop">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crop className="w-4 h-4" />
            Crop image
            {position && position.total > 1 ? ` · ${position.index + 1} of ${position.total}` : ""}
          </DialogTitle>
          <DialogDescription>
            Drag to reposition and zoom to frame the photo. All photos are saved at the same shape so the catalogue and gallery stay uniform.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Aspect ratio picker */}
          <div className="flex flex-wrap gap-2" data-testid="group-crop-aspect">
            {ASPECTS.map((a) => (
              <Button
                key={a.key}
                type="button"
                size="sm"
                variant={a.key === aspect ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => onAspectChange(a.key)}
                data-testid={`button-crop-aspect-${a.key.replace(":", "-")}`}
              >
                {a.label}
              </Button>
            ))}
          </div>

          {/* Crop viewport */}
          <div className="flex justify-center">
            <div
              ref={viewportRef}
              className="relative overflow-hidden rounded-md border bg-muted touch-none select-none"
              style={{ width: VW, height: VH, cursor: img ? "move" : "default" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              data-testid="crop-viewport"
            >
              {img ? (
                <img
                  src={img.src}
                  alt=""
                  draggable={false}
                  className="absolute max-w-none origin-top-left pointer-events-none"
                  style={{
                    width: dW,
                    height: dH,
                    transform: `translate(${offset.x}px, ${offset.y}px)`,
                  }}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                  Loading…
                </div>
              )}
            </div>
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-3">
            <ZoomOut className="w-4 h-4 text-muted-foreground shrink-0" />
            <Slider
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={[zoom]}
              onValueChange={(v) => setZoom(v[0] ?? 1)}
              data-testid="slider-crop-zoom"
            />
            <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} data-testid="button-crop-cancel">
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!img || busy} data-testid="button-crop-confirm">
            {busy ? "Saving…" : "Use this crop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
