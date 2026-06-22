import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeOrderEstimate,
  priceForCycle,
  startingPriceLabel,
  startingPriceValue,
  type EstimateProduct,
} from "./store-estimate.js";

function product(overrides: Partial<EstimateProduct> = {}): EstimateProduct {
  return {
    currency: "USD",
    cycles: [
      { cycle: "monthly", price: "10.00", setupFee: null },
      { cycle: "annually", price: "100.00", setupFee: "25.00" },
    ],
    configOptions: [],
    ...overrides,
  };
}

test("term-only: just the selected cycle price", () => {
  const est = computeOrderEstimate(product(), "monthly", {});
  assert.equal(est.recurringTotal, 10);
  assert.equal(est.setupTotal, 0);
  assert.equal(est.currency, "USD");
  assert.equal(est.complete, true);
});

test("setup fee is surfaced separately, not in the recurring total", () => {
  const est = computeOrderEstimate(product(), "annually", {});
  assert.equal(est.recurringTotal, 100);
  assert.equal(est.setupTotal, 25);
  assert.equal(est.complete, true);
});

test("term + selected priced dropdown option", () => {
  const p = product({
    configOptions: [
      {
        id: 7,
        type: "dropdown",
        choices: [
          { id: 71, prices: { monthly: "5.00", annually: "50.00" } },
          { id: 72, prices: { monthly: "9.00", annually: "90.00" } },
        ],
      },
    ],
  });
  const est = computeOrderEstimate(p, "monthly", { "7": "72" });
  assert.equal(est.recurringTotal, 19); // 10 + 9
  assert.equal(est.complete, true);
});

test("yesno option only counts when switched on", () => {
  const p = product({
    configOptions: [
      { id: 3, type: "yesno", choices: [{ id: 31, prices: { monthly: "4.00" } }] },
    ],
  });
  assert.equal(computeOrderEstimate(p, "monthly", { "3": "0" }).recurringTotal, 10);
  assert.equal(computeOrderEstimate(p, "monthly", { "3": "1" }).recurringTotal, 14);
});

test("quantity option multiplies unit price by the entered quantity", () => {
  const p = product({
    configOptions: [
      { id: 9, type: "quantity", choices: [{ id: 91, prices: { monthly: "2.50" } }] },
    ],
  });
  const est = computeOrderEstimate(p, "monthly", { "9": "3" });
  assert.equal(est.recurringTotal, 17.5); // 10 + 2.50*3
  assert.equal(est.complete, true);
});

test("onetime/free cycle falls back to the option's monthly price", () => {
  const p = product({
    currency: "USD",
    cycles: [{ cycle: "onetime", price: "40.00", setupFee: null }],
    configOptions: [
      // No explicit onetime key — should read monthly per the WHMCS quirk.
      { id: 5, type: "dropdown", choices: [{ id: 51, prices: { monthly: "6.00" } }] },
    ],
  });
  const est = computeOrderEstimate(p, "onetime", { "5": "51" });
  assert.equal(est.recurringTotal, 46); // 40 + 6
  assert.equal(priceForCycle({ monthly: "6.00" }, "onetime"), "6.00");
});

test("free cycle also falls back to the option's monthly price", () => {
  const p = product({
    cycles: [{ cycle: "free", price: "0.00", setupFee: null }],
    configOptions: [
      { id: 6, type: "dropdown", choices: [{ id: 61, prices: { monthly: "3.00" } }] },
    ],
  });
  const est = computeOrderEstimate(p, "free", { "6": "61" });
  assert.equal(est.recurringTotal, 3); // 0 + 3
  assert.equal(est.complete, true);
});

test("an option with no pricing contributes nothing but stays complete", () => {
  const p = product({
    configOptions: [{ id: 2, type: "dropdown", choices: [{ id: 21 }] }],
  });
  const est = computeOrderEstimate(p, "monthly", { "2": "21" });
  assert.equal(est.recurringTotal, 10);
  assert.equal(est.complete, true);
});

test("an unparseable present price marks the estimate incomplete", () => {
  const p = product({
    configOptions: [
      { id: 8, type: "dropdown", choices: [{ id: 81, prices: { monthly: "n/a" } }] },
    ],
  });
  const est = computeOrderEstimate(p, "monthly", { "8": "81" });
  assert.equal(est.complete, false);
});

test("unknown cycle is incomplete", () => {
  const est = computeOrderEstimate(product(), "weekly", {});
  assert.equal(est.complete, false);
});

test("startingPriceLabel: multi-cycle picks the cheapest positive price", () => {
  const label = startingPriceLabel({
    currency: "USD",
    cycles: [
      { price: "100.00" },
      { price: "10.00" },
      { price: "50.00" },
    ],
  });
  assert.equal(label, "From 10.00 USD");
});

test("startingPriceLabel: ignores a 0 cycle when a positive one exists", () => {
  const label = startingPriceLabel({
    currency: "GBP",
    cycles: [{ price: "0.00" }, { price: "5.00" }],
  });
  assert.equal(label, "From 5.00 GBP");
});

test("startingPriceLabel: one-time/free single zero cycle reads Free", () => {
  assert.equal(
    startingPriceLabel({ currency: "USD", cycles: [{ price: "0.00" }] }),
    "Free",
  );
});

test("startingPriceLabel: no parseable price returns null", () => {
  assert.equal(
    startingPriceLabel({ currency: "USD", cycles: [{ price: "" }, { price: "n/a" }] }),
    null,
  );
  assert.equal(startingPriceLabel({ currency: "USD", cycles: [] }), null);
});

test("startingPriceLabel: omits currency when unknown", () => {
  assert.equal(
    startingPriceLabel({ currency: null, cycles: [{ price: "7.50" }] }),
    "From 7.50",
  );
});

test("startingPriceValue: cheapest positive price across cycles", () => {
  assert.equal(
    startingPriceValue({ cycles: [{ price: "100.00" }, { price: "10.00" }, { price: "50.00" }] }),
    10,
  );
});

test("startingPriceValue: ignores a 0 cycle when a positive one exists", () => {
  assert.equal(startingPriceValue({ cycles: [{ price: "0.00" }, { price: "5.00" }] }), 5);
});

test("startingPriceValue: free/zero-only product is 0 (sorts as cheapest)", () => {
  assert.equal(startingPriceValue({ cycles: [{ price: "0.00" }] }), 0);
});

test("startingPriceValue: no parseable price returns null (sorts last)", () => {
  assert.equal(startingPriceValue({ cycles: [{ price: "" }, { price: "n/a" }] }), null);
  assert.equal(startingPriceValue({ cycles: [] }), null);
});
