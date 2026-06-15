import type { Request, Response } from "express";
import {
  hasWhmcsCredentials,
  normalizeBaseUrl,
  getClientProducts as defaultGetClientProducts,
  normalizeListField,
  type WhmcsRawFetch,
} from "./whmcs";
import { parseProduct, selectActiveServices, type ActiveService } from "./whmcs-billing";

// Handler factory for the customer "My Services" endpoint:
//   GET /api/my/services   (the session user's OWN active WHMCS services)
//
// Extracted from registerRoutes so the security-critical contract can be unit-
// tested directly against the production handler (same pattern as
// createGetProfileHandler / createCustomerInvoiceDetailHandler). The two
// guarantees this route must keep:
//   1. The WHMCS client id is ALWAYS resolved from the SESSION user, never from
//      request input — a customer only ever sees their own services.
//   2. This is the ONLY surface that returns service login credentials
//      (username/password). They go to the customer alone: there is no admin
//      twin (admins get the credential-free billing summary), and the request
//      logger in server/index.ts is configured to NEVER embed this route's body
//      in the logs (see SENSITIVE_BODY_PATHS in server/request-log.ts).
// Never 500s; every failure degrades to a stable, fully-keyed empty shape so the
// page always renders.

export interface ServicesRouteUser {
  whmcsClientId?: number | null;
}

export interface ServicesRouteSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
}

export interface ServicesRouteDeps {
  getWhmcsSettings: () => Promise<ServicesRouteSettings | null | undefined>;
  getUser: (id: string) => Promise<ServicesRouteUser | null | undefined>;
  /** Defaults to the real credential check; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  /** Defaults to the real base-url normalizer; injectable for tests. */
  normalizeBaseUrl?: (raw: string | null) => string | null;
  /** Defaults to the real products fetcher; injectable for tests. */
  getClientProducts?: (clientId: number) => Promise<WhmcsRawFetch>;
  /**
   * Admin-set per-product DNS rows (Task #473). Optional: when absent or failing,
   * services still render — the DNS line is simply omitted. Keyed by WHMCS pid.
   */
  listProductDns?: () => Promise<Array<{ whmcsProductId: number; dns: string }>>;
}

/** The locked degraded shape every "My Services" response carries. */
export function emptyActiveServices(over: Record<string, unknown>) {
  return {
    configured: false,
    enabled: false,
    linked: false,
    unreachable: false,
    services: [] as ActiveService[],
    ...over,
  };
}

/**
 * Customer self-view: list the logged-in user's OWN active WHMCS services,
 * including the per-service login credentials. The client id is ALWAYS derived
 * from the session user — never request input. Never 500s; degrades to a clean
 * unconfigured / disabled / unlinked / unreachable state.
 */
export function createMyServicesHandler(deps: ServicesRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const fetchProducts = deps.getClientProducts ?? defaultGetClientProducts;
  return async (req: Request, res: Response) => {
    try {
      const settings = await deps.getWhmcsSettings();
      const configured = credentials() && !!normalize(settings?.baseUrl ?? null);
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) return res.json(emptyActiveServices({ configured, enabled }));
      const user = await deps.getUser(req.session.userId!);
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) return res.json(emptyActiveServices({ configured, enabled, linked: false }));
      const productsResult = await fetchProducts(clientId);
      if (!productsResult.ok) {
        return res.json(emptyActiveServices({ configured, enabled, linked: true, unreachable: true }));
      }
      const products = normalizeListField(productsResult.data?.products, "product").map(parseProduct);
      let dnsByPid: Map<number, string> | undefined;
      if (deps.listProductDns) {
        try {
          const rows = await deps.listProductDns();
          dnsByPid = new Map(rows.map((r) => [r.whmcsProductId, r.dns]));
        } catch {
          // DNS is a non-critical enrichment — never let it break the services list.
          dnsByPid = undefined;
        }
      }
      const services = selectActiveServices(products, dnsByPid);
      return res.json({ configured, enabled, linked: true, unreachable: false, services });
    } catch {
      return res.json(emptyActiveServices({ configured: true, enabled: true, linked: true, unreachable: true }));
    }
  };
}
