import type { Request, Response } from "express";

// Admin endpoints for the per-WHMCS-product DNS (connection address) feature
// (Task #473). Extracted as injectable handler factories — mirroring
// whmcs-services-route / whmcs-upgrade-route — so the validation, persistence,
// and clear semantics are unit-tested against the SAME handlers routes.ts
// mounts (behind the shared `requireAdmin` guard). The DNS is keyed by WHMCS
// product id (pid): it belongs to the product TYPE, so every customer holding
// that product — including brand-new signups — sees the same address.

export interface ProductDnsRow {
  whmcsProductId: number;
  dns: string;
}

export interface ProductDnsRouteDeps {
  listProductDns: () => Promise<ProductDnsRow[]>;
  /** Upsert; an empty/whitespace dns clears the row and resolves to undefined. */
  setProductDns: (whmcsProductId: number, dns: string) => Promise<{ dns: string } | undefined>;
  /** Optional audit hook. `set` is true on upsert, false on clear. */
  logActivity?: (opts: { actorId?: string; whmcsProductId: number; set: boolean }) => void;
  /** Defaults to a plain message extractor; injectable for tests. */
  getErrorMessage?: (e: unknown) => string;
}

const defaultGetErrorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createListProductDnsHandler(deps: ProductDnsRouteDeps) {
  const getErrorMessage = deps.getErrorMessage ?? defaultGetErrorMessage;
  return async function listProductDnsHandler(_req: Request, res: Response) {
    try {
      const rows = await deps.listProductDns();
      res.json({ entries: rows.map((r) => ({ whmcsProductId: r.whmcsProductId, dns: r.dns })) });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  };
}

export function createSetProductDnsHandler(deps: ProductDnsRouteDeps) {
  const getErrorMessage = deps.getErrorMessage ?? defaultGetErrorMessage;
  return async function setProductDnsHandler(req: Request, res: Response) {
    try {
      const whmcsProductId = Number((req.body as any)?.whmcsProductId);
      if (!Number.isInteger(whmcsProductId) || whmcsProductId <= 0) {
        return res.status(400).json({ message: "A valid WHMCS product id is required" });
      }
      const dns = typeof (req.body as any)?.dns === "string" ? (req.body as any).dns : "";
      const row = await deps.setProductDns(whmcsProductId, dns);
      deps.logActivity?.({
        actorId: (req as any).session?.userId,
        whmcsProductId,
        set: Boolean(row),
      });
      res.json({ ok: true, whmcsProductId, dns: row?.dns ?? "" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  };
}
