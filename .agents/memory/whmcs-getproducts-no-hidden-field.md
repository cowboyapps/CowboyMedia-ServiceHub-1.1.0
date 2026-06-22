---
name: WHMCS GetProducts omits Hidden/Retired
description: The WHMCS GetProducts API never returns a product's Hidden/Retired status; gate orderable products by the admin mapping allowlist instead.
---

The standard WHMCS `GetProducts` API does **not** return a `hidden` or `retired`
field. Those columns exist in `tblproducts` but are silently omitted from the API
response, and GetProducts returns ALL products regardless of hidden/retired
status. Confirmed against the official WHMCS developer docs (response schema
through v8.12) and the long-standing developer-docs issue #121. Retired products
can even still be ordered via the API — WHMCS itself does not block them.

**Why:** A first attempt hid products by checking `raw.hidden` / `raw.retired`
on each GetProducts row (`isHiddenOrderableProduct`). That filter is a no-op on a
stock WHMCS because those keys are never present, so hidden products would still
appear in (and be orderable from) the customer "order a new service" picker. This
could not be reproduced in Replit dev (its IP is blocked by the WHMCS allowlist —
`Invalid IP`), only on the production VPS.

**How to apply:** Do NOT rely on any GetProducts response field to determine
product visibility. The real gate for the customer orderable catalogue is the
admin product→service mapping allowlist (`whmcs_product_mappings`): only products
an admin has explicitly mapped are offerable. `loadOrderableProducts` takes an
`allowedPids` arg; the order routes pass the mapped pids. An empty allowlist =>
nothing orderable (intentional). The field-based `isHiddenOrderableProduct` check
is kept only as defense-in-depth for a customised WHMCS that injects such a field.

**Corollary — snapshot names, don't resolve them live.** Hidden/Retired
products ARE still omitted from GetProducts on real installs (the "returns ALL"
claim above is about the missing status field, not visibility — a genuinely
hidden product can drop out of the list entirely). So any admin UI that must
keep showing a *mapped or curated* product's name cannot rely on a live
GetProducts lookup — it will fall back to a useless `Product #<id>`. Capture the
product name (and any other needed display fields) at the moment the admin
selects it from the live picker and persist it on the row; prefer the stored
snapshot at render time, falling back to live → id. `whmcs_product_mappings`
carries a denormalised `whmcs_product_name` for exactly this reason.
