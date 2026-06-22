import type { Request, Response } from "express";
import {
  hasWhmcsCredentials,
  normalizeBaseUrl,
  addOrder as defaultAddOrder,
  type WhmcsRawFetch,
} from "./whmcs";
import {
  loadPaymentMethods as defaultLoadPaymentMethods,
  buildInvoicePayUrl,
  extractInvoiceId,
  type StoreCatalogueData,
  type StoreCatalogueProduct,
  type PaymentMethodsData,
} from "./whmcs-billing";
import { isUnlinkedStaff } from "./roles";
import { placeProductOrderSchema, type InsertStoreProduct, type StoreProduct } from "@shared/schema";

// Cap additional gallery images per storefront product (beyond the primary
// `imageUrl`). Multer enforces this as the `images` field's maxCount on the admin
// create/update routes; exported so the cap lives next to the handler logic it
// guards and so tests can assert the same value the routes wire in.
export const STORE_PRODUCT_MAX_GALLERY_IMAGES = 8;

// Handler factories for the customer storefront endpoints (Task #518):
//   GET  /api/billing/store-products  — the admin-curated product catalogue
//   POST /api/billing/store-order     — place a new product order (with config
//                                       options + custom fields)
//
// These mirror the in-app ordering endpoints (createListOrderableProductsHandler
// / createPlaceOrderHandler) but read the ADMIN-CURATED storefront catalogue
// instead of the service mapping allowlist, and carry the product's configurable
// options + custom field answers through to AddOrder. Same security contracts:
//   1. Ownership — the WHMCS client id is ALWAYS resolved from the SESSION user.
//      Unlinked staff are blocked. The order is placed for that client only.
//   2. Validity — the product id, billing cycle, configurable options, and custom
//      fields are validated against the live curated catalogue before any write.
//   3. Never 500s — every failure degrades to a stable tagged JSON shape; on
//      success the response carries the new invoice id + pay URL for the existing
//      single-use SSO pay handoff.

export interface StoreRouteUser {
  whmcsClientId?: number | null;
  role?: string | null;
}

export interface StoreRouteSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
}

export interface StoreRouteDeps {
  getWhmcsSettings: () => Promise<StoreRouteSettings | null | undefined>;
  getUser: (id: string) => Promise<StoreRouteUser | null | undefined>;
  /** Loads the admin-curated catalogue merged with the live WHMCS data. Required. */
  loadStoreCatalogue: () => Promise<StoreCatalogueData>;
  /** Defaults to the real credential check; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  /** Defaults to the real base-url normalizer; injectable for tests. */
  normalizeBaseUrl?: (raw: string | null) => string | null;
  /** Defaults to the real payment-method loader; injectable for tests. */
  loadPaymentMethods?: () => Promise<PaymentMethodsData>;
  /** Defaults to the real AddOrder writer; injectable for tests. */
  addOrder?: (input: {
    clientId: number;
    pid: number;
    billingCycle: string;
    paymentMethod: string;
    configOptions?: Record<number, number>;
    customFields?: Record<number, string>;
  }) => Promise<WhmcsRawFetch>;
  /** Best-effort hook to track the order for the "service ready" notifier. */
  recordPendingOrder?: (userId: string, pid: number, invoiceId: number | null) => Promise<void>;
}

async function resolveAvailability(deps: StoreRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const settings = await deps.getWhmcsSettings();
  const baseUrl = normalize(settings?.baseUrl ?? null);
  const configured = credentials() && !!baseUrl;
  const enabled = !!settings?.enabled;
  return { configured, enabled, baseUrl };
}

/**
 * Validate the customer's configurable-option + custom-field answers against the
 * product's live catalogue definition, returning the clean maps to send to
 * AddOrder. Unknown ids are dropped; invalid choices / missing required answers
 * are rejected. Pure → unit-tested.
 */
export function validateStoreOrderInputs(
  product: StoreCatalogueProduct,
  configInput: Record<string, number> | undefined,
  customInput: Record<string, string> | undefined,
): { ok: true; configOptions: Record<number, number>; customFields: Record<number, string> } | { ok: false; message: string } {
  const configOptions: Record<number, number> = {};
  for (const opt of product.configOptions) {
    const provided = configInput?.[String(opt.id)];
    if (opt.type === "dropdown" || opt.type === "radio") {
      if (provided === undefined) {
        if (opt.required) return { ok: false, message: `Please choose an option for "${opt.name}".` };
        continue;
      }
      if (!opt.choices.some((c) => c.id === provided)) {
        return { ok: false, message: `That isn't a valid choice for "${opt.name}".` };
      }
      configOptions[opt.id] = provided;
    } else {
      // quantity / yesno: a value of 0 means "none"; only send positive values.
      if (provided === undefined) continue;
      if (provided < 0) return { ok: false, message: `That isn't a valid value for "${opt.name}".` };
      if (provided > 0) configOptions[opt.id] = provided;
    }
  }
  const customFields: Record<number, string> = {};
  for (const field of product.customFields) {
    const provided = (customInput?.[String(field.id)] ?? "").trim();
    if (!provided) {
      if (field.required) return { ok: false, message: `Please fill in "${field.name}".` };
      continue;
    }
    if (field.fieldType === "dropdown" && field.options.length > 0 && !field.options.includes(provided)) {
      return { ok: false, message: `That isn't a valid value for "${field.name}".` };
    }
    customFields[field.id] = provided;
  }
  return { ok: true, configOptions, customFields };
}

/**
 * Customer self-view: the admin-curated storefront catalogue. Locked shape
 * `{ configured, enabled, linked, unreachable, hasGateway, products }` so the
 * frontend never branches on missing keys. Browsing doesn't require a linked
 * account (the UI prompts to link); unlinked staff are blocked. Never 500s.
 */
export function createListStoreProductsHandler(deps: StoreRouteDeps) {
  const loadMethods = deps.loadPaymentMethods ?? (() => defaultLoadPaymentMethods());
  const empty = (over: Partial<{ configured: boolean; enabled: boolean; linked: boolean }> = {}) => ({
    configured: false,
    enabled: false,
    linked: false,
    unreachable: false,
    hasGateway: false,
    products: [] as StoreCatalogueData["products"],
    ...over,
  });
  return async (req: Request, res: Response) => {
    try {
      const { configured, enabled } = await resolveAvailability(deps);
      if (!configured || !enabled) return res.json(empty({ configured, enabled }));

      const user = await deps.getUser(req.session.userId!);
      if (isUnlinkedStaff(user?.role, user?.whmcsClientId)) {
        return res.status(403).json({ ...empty({ configured, enabled }), message: "Staff accounts can't use customer billing actions." });
      }
      const linked = !!user?.whmcsClientId;

      const [catalogue, methods] = await Promise.all([deps.loadStoreCatalogue(), loadMethods()]);
      if (catalogue.unreachable) {
        return res.json(empty({ configured, enabled, linked }));
      }
      return res.json({
        configured,
        enabled,
        linked,
        unreachable: false,
        hasGateway: !methods.unreachable && methods.methods.length > 0,
        products: catalogue.products,
      });
    } catch {
      return res.json(empty({ configured: true, enabled: true }));
    }
  };
}

/**
 * Customer self-action: place a new storefront product order for the logged-in
 * user's OWN linked client. The client id is ALWAYS derived from the session
 * user. The product, cycle, configurable options, and custom fields are all
 * validated against the live curated catalogue before AddOrder. Never 500s.
 */
export function createPlaceProductOrderHandler(deps: StoreRouteDeps) {
  const loadMethods = deps.loadPaymentMethods ?? (() => defaultLoadPaymentMethods());
  const submit = deps.addOrder ?? defaultAddOrder;
  return async (req: Request, res: Response) => {
    try {
      const parsed = placeProductOrderSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ ok: false, message: "Please check the highlighted fields.", errors: parsed.error.flatten() });
      }

      const { configured, enabled, baseUrl } = await resolveAvailability(deps);
      if (!configured || !enabled) {
        return res.status(409).json({ ok: false, message: "Ordering isn't available right now." });
      }

      const user = await deps.getUser(req.session.userId!);
      if (isUnlinkedStaff(user?.role, user?.whmcsClientId)) {
        return res.status(403).json({ ok: false, message: "Staff accounts can't use customer billing actions." });
      }
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.status(409).json({ ok: false, message: "Your account isn't linked to billing yet." });
      }

      // Validity gate: the product must exist in the curated catalogue AND offer
      // the requested cycle. A bad/disabled combo is rejected before any write.
      const catalogue = await deps.loadStoreCatalogue();
      if (catalogue.unreachable) {
        return res.status(502).json({ ok: false, message: "We couldn't reach the billing system right now. Please try again shortly." });
      }
      const product = catalogue.products.find((p) => p.pid === parsed.data.pid);
      if (!product || !product.cycles.some((c) => c.cycle === parsed.data.billingCycle)) {
        return res.status(404).json({ ok: false, message: "That product or billing cycle isn't available." });
      }

      // Validate the configurable-option + custom-field answers against the live
      // product definition before any write.
      const inputs = validateStoreOrderInputs(product, parsed.data.configOptions, parsed.data.customFields);
      if (!inputs.ok) {
        return res.status(400).json({ ok: false, message: inputs.message });
      }

      // AddOrder REQUIRES a payment method — pick the first active gateway.
      const methods = await loadMethods();
      if (methods.unreachable) {
        return res.status(502).json({ ok: false, message: "We couldn't reach the billing system right now. Please try again shortly." });
      }
      const gateway = methods.methods[0]?.module;
      if (!gateway) {
        return res.status(409).json({ ok: false, message: "Online ordering isn't available right now because no payment method is set up. Please contact support." });
      }

      const result = await submit({
        clientId,
        pid: parsed.data.pid,
        billingCycle: parsed.data.billingCycle,
        paymentMethod: gateway,
        configOptions: inputs.configOptions,
        customFields: inputs.customFields,
      });
      if (!result.ok) {
        const msg = result.reason === "whmcs_error" && result.error
          ? result.error
          : "Couldn't place your order right now. Please try again shortly.";
        const status = result.reason === "whmcs_error" ? 400 : 502;
        return res.status(status).json({ ok: false, message: msg });
      }

      const invoiceId = extractInvoiceId(result.data);
      const payUrl = invoiceId ? buildInvoicePayUrl(baseUrl, invoiceId) : null;

      if (deps.recordPendingOrder) {
        try {
          await deps.recordPendingOrder(req.session.userId!, parsed.data.pid, invoiceId);
        } catch {
          /* pending-order tracking is best-effort; ignore */
        }
      }

      return res.json({
        ok: true,
        message: "Your order has been placed.",
        invoiceId,
        payUrl,
      });
    } catch {
      return res.status(502).json({ ok: false, message: "Couldn't place your order right now. Please try again shortly." });
    }
  };
}

// ---- Admin-curated storefront product CRUD (Task #518 / gallery in #534) ----
//
// Handler factories for the ADMIN store-product management endpoints:
//   POST   /api/admin/store-products       — add a WHMCS product to the store
//   PATCH  /api/admin/store-products/:id    — edit metadata + gallery images
//   DELETE /api/admin/store-products/:id    — remove a product + its blobs
//
// These mirror the storefront factories above so the production handlers wired
// into routes.ts can be exercised with the storage layer, the upload writer, and
// the orphan-cleanup helper injected — no live DB, WHMCS, or multer needed. The
// gallery contract they enforce:
//   1. Persist — new `images` uploads are saved as `uploaded_files` blobs and
//      their `/uploads/<uuid>` paths land in `image_urls` (POST appends to an
//      empty list; PATCH appends to whatever survives the removal step).
//   2. Remove — `removeImageUrls` drops exactly the matching entries from
//      `image_urls`, and only blobs that genuinely leave the row are cleaned up.
//   3. Don't orphan — a failed insert/update rolls back the just-saved blobs, and
//      DELETE cleans up the primary + every gallery blob the row owned.

// Pulls the bare filename out of a `/uploads/<filename>` URL — null for empty.
const cleanStoreStr = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
};

const parseStoreSortOrder = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

const parseStoreBool = (v: unknown, dflt: boolean): boolean => {
  if (v === undefined || v === null || v === "") return dflt;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "on" || s === "yes";
};

// Split the multi-field upload (primary `image` + additional `images`) coming
// from withUploadFields, where req.files is keyed by field name.
export function storeProductUploads(req: Request): {
  primary?: Express.Multer.File;
  gallery: Express.Multer.File[];
} {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  return { primary: files.image?.[0], gallery: files.images ?? [] };
}

// Parse the JSON array of gallery image URLs the admin asked to remove. Anything
// that isn't a JSON array of strings degrades to an empty list (remove nothing).
export function parseRemoveImageUrls(v: unknown): string[] {
  if (typeof v !== "string" || !v.trim()) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

// Explicit ordered list of existing gallery URLs (admin drag-to-reorder).
// Returns null when the field is absent so callers can tell "no reorder
// requested" apart from "reorder to empty".
export function parseImageUrlsOrder(v: unknown): string[] | null {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((u): u is string => typeof u === "string");
  } catch {
    return null;
  }
}

export interface AdminStoreRouteDeps {
  listStoreProducts: () => Promise<StoreProduct[]>;
  getStoreProductByPid: (whmcsProductId: number) => Promise<StoreProduct | undefined>;
  getStoreProduct: (id: string) => Promise<StoreProduct | undefined>;
  createStoreProduct: (data: InsertStoreProduct) => Promise<StoreProduct>;
  updateStoreProduct: (id: string, data: Partial<InsertStoreProduct>) => Promise<StoreProduct | undefined>;
  deleteStoreProduct: (id: string) => Promise<StoreProduct | undefined>;
  reorderStoreProducts: (orderedIds: string[]) => Promise<void>;
  saveUploadedFile: (file: Express.Multer.File) => Promise<string>;
  deleteUploadedFileIfUnreferenced: (url: string | null | undefined) => Promise<void>;
  logActivity?: (category: string, action: string, opts: { actorId?: string; targetType?: string; summary: string }) => void;
  getErrorMessage?: (e: unknown) => string;
}

const defaultErrorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Admin self-view: every curated store product (pure DB read). */
export function createListAdminStoreProductsHandler(deps: AdminStoreRouteDeps) {
  const getErrorMessage = deps.getErrorMessage ?? defaultErrorMessage;
  return async (_req: Request, res: Response) => {
    try {
      const products = await deps.listStoreProducts();
      res.json({ products });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  };
}

/**
 * Add a WHMCS product to the store. Saves the primary image + every gallery
 * upload as `uploaded_files` blobs first, then inserts the row; a failed insert
 * (e.g. the unique-pid race) rolls back exactly those just-saved blobs so they
 * can't be orphaned.
 */
export function createCreateStoreProductHandler(deps: AdminStoreRouteDeps) {
  const getErrorMessage = deps.getErrorMessage ?? defaultErrorMessage;
  return async (req: Request, res: Response) => {
    try {
      const whmcsProductId = Number(req.body?.whmcsProductId);
      if (!Number.isInteger(whmcsProductId) || whmcsProductId <= 0) {
        return res.status(400).json({ message: "A valid WHMCS product id is required" });
      }
      const existing = await deps.getStoreProductByPid(whmcsProductId);
      if (existing) {
        return res.status(409).json({ message: "That WHMCS product is already in the store." });
      }
      const { primary, gallery } = storeProductUploads(req);
      const imageUrl = primary ? await deps.saveUploadedFile(primary) : null;
      const imageUrls: string[] = [];
      for (const file of gallery) imageUrls.push(await deps.saveUploadedFile(file));
      const savedBlobs = [imageUrl, ...imageUrls].filter((u): u is string => !!u);
      let product;
      try {
        product = await deps.createStoreProduct({
          whmcsProductId,
          name: cleanStoreStr(req.body?.name),
          description: cleanStoreStr(req.body?.description),
          imageUrl,
          imageUrls,
          category: cleanStoreStr(req.body?.category),
          sortOrder: parseStoreSortOrder(req.body?.sortOrder),
          enabled: parseStoreBool(req.body?.enabled, true),
        });
      } catch (e) {
        // The blobs were persisted before the row; a failed insert (e.g. a race
        // on the unique pid, or a transient DB error) would otherwise orphan them.
        for (const url of savedBlobs) await deps.deleteUploadedFileIfUnreferenced(url);
        throw e;
      }
      deps.logActivity?.("setting", "store_product_created", {
        actorId: req.session.userId,
        targetType: "setting",
        summary: `Added WHMCS product #${whmcsProductId} to the store`,
      });
      res.json({ product });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  };
}

/**
 * Edit a store product's metadata + gallery. Gallery edits drop the URLs in
 * `removeImageUrls` from `image_urls`, then append any new uploads. New blobs are
 * rolled back if the update throws; blobs that genuinely leave the row (removed
 * gallery entries / replaced primary) are cleaned up only once the row no longer
 * references them.
 */
export function createUpdateStoreProductHandler(deps: AdminStoreRouteDeps) {
  const getErrorMessage = deps.getErrorMessage ?? defaultErrorMessage;
  return async (req: Request, res: Response) => {
    try {
      const id = String((req.params as Record<string, string>).id ?? "");
      const existing = await deps.getStoreProduct(id);
      if (!existing) return res.status(404).json({ message: "Store product not found" });

      const update: Partial<InsertStoreProduct> = {};
      if (req.body?.name !== undefined) update.name = cleanStoreStr(req.body.name);
      if (req.body?.description !== undefined) update.description = cleanStoreStr(req.body.description);
      if (req.body?.category !== undefined) update.category = cleanStoreStr(req.body.category);
      if (req.body?.sortOrder !== undefined) update.sortOrder = parseStoreSortOrder(req.body.sortOrder);
      if (req.body?.enabled !== undefined) update.enabled = parseStoreBool(req.body.enabled, existing.enabled);

      const { primary, gallery } = storeProductUploads(req);

      // Primary image handling: a new upload replaces the old blob; `removeImage=true`
      // clears it. The previous blob is removed only when nothing else still
      // references it (shared `uploaded_files` store).
      const oldImagesToCleanup: string[] = [];
      const newBlobsToRollback: string[] = [];
      if (primary) {
        update.imageUrl = await deps.saveUploadedFile(primary);
        newBlobsToRollback.push(update.imageUrl);
        if (existing.imageUrl) oldImagesToCleanup.push(existing.imageUrl);
      } else if (parseStoreBool(req.body?.removeImage, false)) {
        update.imageUrl = null;
        if (existing.imageUrl) oldImagesToCleanup.push(existing.imageUrl);
      }

      // Promotion: swap an existing gallery image into the primary slot WITHOUT a
      // re-upload, demoting the current primary into the gallery. Only honoured
      // when no new primary was uploaded (a fresh upload always wins) and the
      // target is a current gallery image that survives the removal step.
      const removeUrls = parseRemoveImageUrls(req.body?.removeImageUrls);
      const orderUrls = parseImageUrlsOrder(req.body?.imageUrlsOrder);
      const promoteUrl = !primary ? cleanStoreStr(req.body?.promotePrimaryImageUrl) : null;
      const promoteValid =
        promoteUrl != null &&
        (existing.imageUrls ?? []).includes(promoteUrl) &&
        !removeUrls.includes(promoteUrl);

      // Gallery handling: drop any URLs the admin removed, optionally reorder the
      // kept ones (drag-to-reorder), append new uploads, and apply any promotion.
      // Only recompute when something actually changed (removals, reorder, new
      // uploads, or a promotion).
      if (removeUrls.length > 0 || gallery.length > 0 || orderUrls || promoteValid) {
        let kept = (existing.imageUrls ?? []).filter((u) => !removeUrls.includes(u));
        for (const url of removeUrls) {
          if ((existing.imageUrls ?? []).includes(url)) oldImagesToCleanup.push(url);
        }
        // Reorder the surviving existing images per the admin's explicit order.
        // Only URLs still kept are honoured; any kept URL the client omitted is
        // appended afterwards so nothing is silently dropped.
        if (orderUrls) {
          const keptSet = new Set(kept);
          const ordered: string[] = [];
          for (const url of orderUrls) {
            if (keptSet.has(url) && !ordered.includes(url)) ordered.push(url);
          }
          for (const url of kept) {
            if (!ordered.includes(url)) ordered.push(url);
          }
          kept = ordered;
        }
        for (const file of gallery) {
          const url = await deps.saveUploadedFile(file);
          newBlobsToRollback.push(url);
          kept.push(url);
        }
        // Apply the promotion last so it sees the reordered/appended gallery: pull
        // the promoted image out of the gallery into the primary slot, and demote
        // whatever primary the row would otherwise keep to the head of the gallery
        // (unless it was just cleared via removeImage). Neither side is cleaned up
        // — both stay referenced by the row, just in swapped slots.
        if (promoteValid) {
          kept = kept.filter((u) => u !== promoteUrl);
          const demote = update.imageUrl !== undefined ? update.imageUrl : existing.imageUrl;
          update.imageUrl = promoteUrl;
          if (demote && demote !== promoteUrl && !kept.includes(demote)) {
            kept = [demote, ...kept];
          }
        }
        update.imageUrls = kept;
      }

      let product;
      try {
        product = await deps.updateStoreProduct(id, update);
      } catch (e) {
        // New blobs were persisted before the row update; a failed update would
        // otherwise orphan them (the old blobs stay referenced and untouched).
        for (const url of newBlobsToRollback) await deps.deleteUploadedFileIfUnreferenced(url);
        throw e;
      }
      const stillReferenced = new Set<string>([
        ...(product?.imageUrl ? [product.imageUrl] : []),
        ...(product?.imageUrls ?? []),
      ]);
      for (const url of oldImagesToCleanup) {
        if (!stillReferenced.has(url)) await deps.deleteUploadedFileIfUnreferenced(url);
      }
      deps.logActivity?.("setting", "store_product_updated", {
        actorId: req.session.userId,
        targetType: "setting",
        summary: `Updated store product #${existing.whmcsProductId}`,
      });
      res.json({ product });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  };
}

/** Remove a store product and clean up its primary + every gallery blob. */
export function createDeleteStoreProductHandler(deps: AdminStoreRouteDeps) {
  const getErrorMessage = deps.getErrorMessage ?? defaultErrorMessage;
  return async (req: Request, res: Response) => {
    try {
      const id = String((req.params as Record<string, string>).id ?? "");
      const removed = await deps.deleteStoreProduct(id);
      if (!removed) return res.status(404).json({ message: "Store product not found" });
      for (const url of [removed.imageUrl, ...(removed.imageUrls ?? [])]) {
        if (url) await deps.deleteUploadedFileIfUnreferenced(url);
      }
      deps.logActivity?.("setting", "store_product_deleted", {
        actorId: req.session.userId,
        targetType: "setting",
        summary: `Removed store product #${removed.whmcsProductId}`,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  };
}

/**
 * Persist the admin's drag-reordered curated product list. The body carries the
 * full ordered list of store-product ids; their `sortOrder` is rewritten to the
 * new index so the customer catalogue (sorted by sortOrder) follows suit.
 */
export function createReorderStoreProductsHandler(deps: AdminStoreRouteDeps) {
  const getErrorMessage = deps.getErrorMessage ?? defaultErrorMessage;
  return async (req: Request, res: Response) => {
    try {
      const { orderedIds } = (req.body ?? {}) as Record<string, unknown>;
      if (!Array.isArray(orderedIds) || !orderedIds.every((x) => typeof x === "string")) {
        return res.status(400).json({ message: "orderedIds must be an array of strings" });
      }
      await deps.reorderStoreProducts(orderedIds as string[]);
      deps.logActivity?.("setting", "store_products_reordered", {
        actorId: req.session.userId,
        targetType: "setting",
        summary: `Reordered the storefront product list (${orderedIds.length} products)`,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  };
}
