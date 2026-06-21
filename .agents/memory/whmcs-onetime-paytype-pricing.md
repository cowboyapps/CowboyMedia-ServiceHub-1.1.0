---
name: WHMCS one-time/free product pricing
description: How WHMCS encodes non-recurring product price/type in GetProducts, and how the storefront vs recurring flows must treat it.
---

# WHMCS one-time / free product pricing

WHMCS `GetProducts` has NO dedicated one-off price column. A product's billing
*type* lives in a separate `paytype` field (`"recurring"` | `"onetime"` |
`"free"`), and a one-time product's price is stored in the **`monthly`** pricing
field (a long-standing WHMCS quirk). So a parser that only reads the per-cycle
price fields will mislabel a one-time product as a recurring "Monthly" charge.

**Rule:** branch on `paytype` before reading prices.
- `onetime` → single non-recurring charge; price = `monthly` (then an explicit
  `onetime` key on some versions). Do NOT fall back to quarterly/annually/etc —
  showing a recurring price as the one-off cost misleads the customer; fail
  closed (drop the product) when no usable price.
- `free` → single $0 charge.
- else → the recurring per-cycle loop.

**Why:** a one-time product was being charged/shown as monthly recurring in the
customer storefront — a real billing-correctness bug.

**How to apply:**
- Recurring-only flows ("Order a new service", upgrade) must FILTER OUT the
  synthetic `onetime`/`free` cycles (their order/upgrade schemas reject them) so
  non-recurring products simply drop out — they belong only in the admin-curated
  storefront, which keeps those cycles.
- `AddOrder`/`UpgradeProduct` accept `billingcycle` values `onetime`/`free`
  directly, so the writer passes them through unchanged.
- Dev can't introspect live WHMCS (unreachable), so validate the live shape on
  the VPS and keep the parser defensive + unit-tested.

## Configurable-option (sub-option) pricing

Each config-option sub-option in `GetProducts` carries its own `pricing` block
keyed the same way as a product (`pricing.{CUR}.{cycle}`). Parse it with the
same currency-block resolution; keep non-negative cycles only (`-1.00` =
disabled). For a one-time/free product the option price follows the SAME quirk —
it lives in `monthly`, so the UI maps the synthetic `onetime`/`free` cycle to
`onetime ?? monthly`. Show `Free` for a `0.00` option, `+ <amt>` otherwise, and
nothing when the option has no pricing (older installs omit it entirely).

