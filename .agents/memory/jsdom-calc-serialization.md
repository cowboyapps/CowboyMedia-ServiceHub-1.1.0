---
name: jsdom calc() serialization quirk
description: jsdom's cssstyle re-serializes calc() expressions (e.g. "- 2rem" becomes "+ 2rem"), breaking literal string assertions on inline styles.
---
jsdom's cssstyle normalizes/simplifies `calc()` on inline style read-back — a source value like `calc(100dvh - 320px - 2rem)` can come back as `calc(100dvh - 320px + 2rem)`.

**Why:** Asserting the literal source calc string against `el.style.maxHeight` fails even when the component set exactly that value.

**How to apply:** In jsdom tests, round-trip the expected calc string through a scratch element's style setter and compare serialized-to-serialized (see `serializedMaxHeight` in `test/report-dialog-keyboard-inset.test.ts`).
