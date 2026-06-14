---
name: WHMCS has no invoice-PDF-bytes API
description: WHMCS exposes no API action that returns invoice PDF bytes; get the PDF via an SSO redirect to dl.php instead.
---

WHMCS has **no** API action that returns an invoice's PDF bytes. `GetInvoicePDF`
is NOT a real WHMCS API action — calling it fails at runtime with
`Invalid API Action: "getinvoicepdf" is not a valid API action`, and no amount of
API-role permissions fixes it.

**The right way to deliver an invoice PDF in-app:** mint a one-time SSO auto-login
URL (`CreateSsoToken` with `destination: "sso:custom_redirect"`,
`sso_redirect_path: "/dl.php?type=i&id=<id>"`) and 302-redirect the browser to it.
WHMCS serves the rendered PDF from `dl.php?type=i&id=<id>` to an authenticated
client; the SSO token logs them in so they skip the client-area login wall. This
is the same mechanism as the seamless "Pay now" pay-link (`/viewinvoice.php?id=...`).

**Why:** a prior task "tested" a byte-fetch proxy only via an injected fake fetcher,
so the bogus `GetInvoicePDF` call never hit real WHMCS and shipped broken to prod.

**How to apply:**
- For any "fetch X bytes from WHMCS" feature, first confirm the API action exists in
  the WHMCS API docs — don't assume a `Get<Thing>PDF`/file action exists.
- Route/handler tests that inject the network fetcher can hide a non-existent action.
  Assert the real contract (here: the SSO/redirect URL or the documented fallback),
  not faked bytes.
- Keep the ownership check (`loadInvoiceDetail(invoiceId, clientId, baseUrl)`) BEFORE
  minting the token, and fall back to the plain login-walled `dl.php` link when SSO
  can't be minted or the ownership read is unreachable — WHMCS re-enforces ownership
  after login, so PDF access is never a dead end.
