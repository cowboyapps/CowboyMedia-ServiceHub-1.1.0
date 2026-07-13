---
name: PWA icon regeneration pipeline
description: How to regenerate the installed-app icon sets (customer/admin) with exact brand colors and crisp text
---

AI image generation can't be trusted for exact hex backgrounds or reliable wordmark text, and the background-removal tool silently keeps *partial* text remnants (crop them out before trimming the emblem).

**How to apply:** compose the 1024 master yourself with ImageMagick: AI-generate the emblem only → remove background → crop to the emblem region → composite onto a `canvas:#<exact-hex>` square → render the wordmark with `label:` + a real brand font (Google Fonts TTF fetchable via the css2 API; only DejaVu is installed locally). Maskable variants = master resized to ~76% centered on the same solid canvas. Monochrome badge = threshold the emblem's bright parts, then force `-colorspace sRGB -fill white -colorize 100` and write `PNG32:` — a gray-colorspace CopyOpacity composite silently collapses the fill to black. No PNG optimizers (pngquant/optipng) in the container. The sw.js precache is BUILD_ID-versioned, so icon file replacement needs no cache-bust.
