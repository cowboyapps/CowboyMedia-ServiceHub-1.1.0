import type { Request, Response } from "express";
import {
  hasWhmcsCredentials as defaultHasWhmcsCredentials,
  normalizeBaseUrl as defaultNormalizeBaseUrl,
} from "./whmcs";

// Handler factory for the admin billing-link adoption READ:
//   GET /api/admin/whmcs/link-stats
//
// Powers the "Customer link adoption" card on Admin Portal → WHMCS Billing.
// Answers "is the post-signup link prompt working?" with a customer-only
// linked / dismissed / unlinked breakdown (staff excluded; buckets are
// mutually exclusive — see storage.getWhmcsLinkStats).
//
// Contract:
//   { configured, stats } where stats = { linked, dismissed, unlinked, total }
//   - configured: WHMCS credentials present AND a usable base URL is set.
//   - stats: null when not configured (the frontend hides the card) —
//     counts are only meaningful when linking is actually possible.
// Pure read: never writes, and DB failures surface as a 500 (no silent zeros).

export interface LinkStatsSettings {
  baseUrl?: string | null;
}

export interface LinkStatsRouteDeps {
  getWhmcsSettings: () => Promise<LinkStatsSettings | null | undefined>;
  getWhmcsLinkStats: () => Promise<{ linked: number; dismissed: number; unlinked: number }>;
  /** Defaults to the real implementations; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  normalizeBaseUrl?: (url: string | null | undefined) => string | null;
}

export function createWhmcsLinkStatsHandler(deps: LinkStatsRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? defaultHasWhmcsCredentials;
  const normalizeBaseUrl = deps.normalizeBaseUrl ?? defaultNormalizeBaseUrl;

  return async (_req: Request, res: Response) => {
    try {
      const settings = await deps.getWhmcsSettings();
      const configured = credentials() && !!normalizeBaseUrl(settings?.baseUrl);
      if (!configured) {
        return res.json({ configured: false, stats: null });
      }
      const { linked, dismissed, unlinked } = await deps.getWhmcsLinkStats();
      res.json({
        configured: true,
        stats: { linked, dismissed, unlinked, total: linked + dismissed + unlinked },
      });
    } catch (e) {
      res.status(500).json({ message: e instanceof Error ? e.message : String(e) });
    }
  };
}
