/**
 * Pure pricing helpers for the customer "Order a new product" flow. Kept out of
 * the React page so the maths can be unit-tested without pulling in the UI. All
 * amounts are the bare decimal strings WHMCS quotes (e.g. "5.00"); currency is a
 * code like "USD".
 */

export interface EstimateCycle {
  cycle: string;
  price: string;
  setupFee: string | null;
}

export interface EstimateChoice {
  id: number;
  prices?: Record<string, string>;
}

export interface EstimateConfigOption {
  id: number;
  type: "dropdown" | "radio" | "yesno" | "quantity";
  choices: EstimateChoice[];
}

export interface EstimateProduct {
  currency: string | null;
  cycles: EstimateCycle[];
  configOptions: EstimateConfigOption[];
}

export interface OrderEstimate {
  recurringTotal: number;
  setupTotal: number;
  currency: string | null;
  complete: boolean;
}

/**
 * The "From <price>" label shown on a catalogue card. The starting price is the
 * lowest *positive* recurring price across the product's billing cycles (so a
 * customer sees the cheapest entry point, e.g. monthly rather than annual). When
 * a product has no positive price — a free product, or one whose only cycle is
 * priced at 0 — it reads "Free". Returns null when no cycle price can be parsed
 * at all (older WHMCS installs / unpriced products), so the card can omit the
 * line rather than show a wrong figure.
 */
export function startingPriceLabel(product: {
  currency: string | null;
  cycles: { price: string }[];
}): string | null {
  const parsed = product.cycles
    .map((c) => parseFloat(c.price))
    .filter((n) => Number.isFinite(n));
  if (parsed.length === 0) return null;
  const positive = parsed.filter((n) => n > 0);
  const amount = positive.length > 0 ? Math.min(...positive) : Math.min(...parsed);
  if (amount <= 0) return "Free";
  const cur = product.currency ? ` ${product.currency}` : "";
  return `From ${amount.toFixed(2)}${cur}`;
}

/**
 * The price string to use for the selected billing cycle. WHMCS stores a
 * one-time product's option price under the recurring "monthly" key (the same
 * quirk as the product itself), so the synthetic onetime/free cycles fall back
 * to monthly. Returns undefined when no usable price is known.
 */
export function priceForCycle(
  prices: Record<string, string> | undefined,
  cycle: string,
): string | undefined {
  if (!prices) return undefined;
  return cycle === "onetime" || cycle === "free"
    ? prices.onetime ?? prices.monthly
    : prices[cycle];
}

/**
 * Sum the running estimate for an in-progress order: the selected billing term's
 * recurring price plus every selected configurable option's price for that term,
 * with one-off setup fees totalled separately. Pure → unit-tested.
 *
 * `complete` is false ONLY when a price that is present fails to parse — a
 * genuinely absent price (older WHMCS installs omit option pricing) contributes
 * nothing and keeps the estimate complete, mirroring the per-choice label. The
 * caller hides the figure when `complete` is false rather than show a
 * silently-wrong number.
 */
export function computeOrderEstimate(
  product: EstimateProduct,
  cycle: string,
  configValues: Record<string, string>,
): OrderEstimate {
  const result: OrderEstimate = {
    recurringTotal: 0,
    setupTotal: 0,
    currency: product.currency,
    complete: true,
  };

  const cyc = product.cycles.find((c) => c.cycle === cycle);
  if (!cyc) {
    result.complete = false;
    return result;
  }

  const addRecurring = (raw: string | undefined, multiplier = 1): void => {
    if (raw == null) return; // price genuinely unknown → contributes nothing
    const n = parseFloat(raw);
    if (Number.isFinite(n)) result.recurringTotal += n * multiplier;
    else result.complete = false;
  };

  // Base billing-term price.
  const base = parseFloat(cyc.price);
  if (Number.isFinite(base)) result.recurringTotal += base;
  else result.complete = false;

  // One-off setup fee (shown on its own line).
  if (cyc.setupFee != null) {
    const s = parseFloat(cyc.setupFee);
    if (Number.isFinite(s)) result.setupTotal += s;
    else result.complete = false;
  }

  // Selected configurable options.
  for (const opt of product.configOptions) {
    const val = configValues[String(opt.id)];
    if (val == null || val === "") continue;
    if (opt.type === "dropdown" || opt.type === "radio") {
      const choice = opt.choices.find((ch) => String(ch.id) === String(val));
      if (choice) addRecurring(priceForCycle(choice.prices, cycle));
    } else if (opt.type === "yesno") {
      if (val === "1") addRecurring(priceForCycle(opt.choices[0]?.prices, cycle));
    } else if (opt.type === "quantity") {
      const qty = parseInt(val, 10);
      if (Number.isFinite(qty) && qty > 0) {
        addRecurring(priceForCycle(opt.choices[0]?.prices, cycle), qty);
      }
    }
  }

  return result;
}
