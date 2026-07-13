---
name: Logo asset alpha speckles
description: CowboyMedia logo PNGs have noisy semi-transparent speckles across the "transparent" background that defeat ImageMagick -trim and derived-variant work.
---

The uploaded CowboyMedia logo PNGs are not cleanly transparent — the background is full of small semi-opaque speckles (visible as static on previews), so `-trim` returns nearly the full canvas.

**How to clean before trimming or recoloring:**
```
magick in.png \( +clone -channel A -threshold 45% +channel -morphology Open Disk:2.5 -channel A -separate +channel \) -alpha off -compose CopyOpacity -composite out.png
```
(threshold the alpha, morphology-Open to kill isolated dots, use the result as the new alpha mask), then `-trim +repage`.

**Light-bg variant recipe:** split at the x boundary between the TV/hat mark and the wordmark, recolor only the text crop with `-fuzz 18% -fill "#1f1b18" -opaque white` (leaves the orange "Media" untouched; white antialias remnants are invisible on light backgrounds), composite back, add a small transparent border.

**Why:** doing a plain `-fuzz -opaque white` on the whole image also recolors the white cowboy hat and play triangle inside the mark.
