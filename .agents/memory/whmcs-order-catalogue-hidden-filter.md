---
name: WHMCS order catalogue hides hidden/retired products
description: Why the customer "order a new service" catalogue filters hidden/retired WHMCS products but admin listProducts must not.
---

The customer "order a new service" catalogue (`/api/billing/products` →
`loadOrderableProducts` in `server/whmcs-billing.ts`) must EXCLUDE products an
admin marked **Hidden** (hide from order forms) or **retired** (no new orders) in
WHMCS. The admin product-mapping picker (`listProducts` in `server/whmcs.ts`) must
KEEP showing every product — admins map hidden ones too. Do not share a filter
between the two paths.

**Why:** customers were being offered products WHMCS meant to keep off the order
form. WHMCS `GetProducts` returns hidden products with no documented per-product
field list, and serializes booleans loosely across versions (`"1"`/`1`/`true`/
`"yes"`/`"on"`). So the filter (`isHiddenOrderableProduct`) coerces loosely and
treats an ABSENT flag as visible — a no-op when WHMCS omits the field, no
regression. **The actual upstream flag name (`hidden`/`retired`) can only be
confirmed on the VPS** — the Replit dev IP is rejected by the WHMCS API allowlist
(`Invalid IP`), so GetProducts can't be introspected locally.

**How to apply:** filtering belongs in `loadOrderableProducts` on the raw row
before parse, never in the admin `listProducts`/`toProductSummary` path. The order
catalogue is also fetched fresh on each dialog open client-side (`staleTime: 0` +
`refetchOnMount: "always"` in `my-services-page.tsx`) because the global React
Query `staleTime` is `Infinity` and would otherwise serve a session-stale copy.
