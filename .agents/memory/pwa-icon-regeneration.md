---
name: PWA icon regeneration pipeline
description: How to regenerate the installed-app icon sets (customer/admin) with exact brand colors and crisp text
---

AI image generation can't be trusted for exact hex backgrounds or reliable wordmark text, and the background-removal tool silently keeps *partial* text remnants (crop them out before trimming the emblem).

When no separate emblem asset exists, the emblem can be recovered from the old AI-generated 1024 icon: crop the emblem region (text-free), remove background, trim — glow remnants blend fine on a dark canvas.

**How to apply:** compose the 1024 master yourself with ImageMagick: AI-generate the emblem only → remove background → crop to the emblem region → composite onto a `canvas:#<exact-hex>` square → render the wordmark with `label:` + a real brand font (Google Fonts TTF fetchable via the css2 API; only DejaVu is installed locally). Maskable variants = master resized to ~76% centered on the same solid canvas. Monochrome badge = threshold the emblem's bright parts, then force `-colorspace sRGB -fill white -colorize 100` and write `PNG32:` — a gray-colorspace CopyOpacity composite silently collapses the fill to black. No PNG optimizers (pngquant/optipng) in the container. The sw.js precache is BUILD_ID-versioned, so icon file replacement needs no cache-bust.

**Badge white-fill collapse (two-step rule):** even with the colorize trick, appending `-trim`/`-resize`/`-extent` in the SAME magick command after `-colorize 100` can silently collapse the white fill back to RGB(0,0,0). Write the colorized composite to an intermediate `PNG32:` file first, then trim/resize/extent it in a second command. Always verify with `magick badge.png txt:- | grep -v '#00000000'` — expect `(255,255,255,…)` pixels, and note the image previewer renders white-on-transparent fine but black-on-transparent looks like a solid black square. Badge should be built from an emblem-only crop (wordmark is illegible at 96px).

**Keep manifest/meta colors in lockstep with the icon canvas:** when the icon background changes, update the app's `theme_color` + `background_color` in its manifest AND the `<meta name="theme-color">` in its HTML entry, or the installed app shows a mismatched status bar/splash.
