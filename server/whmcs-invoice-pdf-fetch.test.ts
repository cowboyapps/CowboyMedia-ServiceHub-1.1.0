import { test } from "node:test";
import assert from "node:assert/strict";
import { storage } from "./storage";
import { getInvoicePdf } from "./whmcs";

// End-to-end test for the getInvoicePdf network fetcher (Task #376).
//
// Unlike server/whmcs-invoice-pdf-route.test.ts (which mocks the loader + pdf
// fetcher to drive the express route branches) and server/whmcs.test.ts (which
// only covers the pure helpers), this exercises the REAL getInvoicePdf against a
// stubbed WHMCS HTTP layer. It is the first network-test of any WHMCS fetcher
// and establishes the pattern: set credentials in env, point storage at a fake
// base URL, and replace global fetch with a recorder that returns a canned
// WHMCS GetInvoicePDF response.
//
// What it pins down:
//   - getInvoicePdf POSTs to `${baseUrl}/includes/api.php`
//   - the form body carries action=GetInvoicePDF + invoiceid + responsetype=json
//   - the base64 `pdf` field is returned verbatim (the route decodes it to bytes)
//   - WHMCS result:error / non-2xx / network errors degrade to a tagged failure

const REAL_FETCH = globalThis.fetch;
const ENV_KEYS = ["WHMCS_API_IDENTIFIER", "WHMCS_API_SECRET"] as const;

interface FetchCall {
  url: string;
  method: string;
  body: URLSearchParams;
}

interface StubOptions {
  /** JSON object the fake WHMCS returns (defaults to a success PDF payload). */
  json?: Record<string, unknown>;
  /** HTTP status (defaults to 200). */
  status?: number;
  /** Throw instead of responding (simulates a network failure). */
  throwError?: Error;
}

/**
 * Install the stubbed environment around a single getInvoicePdf call and return
 * what was captured. Always restores env + global fetch + storage afterwards so
 * tests stay isolated even on assertion failure.
 */
async function withStubbedWhmcs(
  opts: StubOptions,
  run: (calls: FetchCall[]) => Promise<void>,
): Promise<void> {
  const savedEnv: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  const savedGetSettings = (storage as any).getWhmcsSettings;

  process.env.WHMCS_API_IDENTIFIER = "test-identifier";
  process.env.WHMCS_API_SECRET = "test-secret";
  (storage as any).getWhmcsSettings = async () => ({ baseUrl: "https://billing.example.com" });

  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: any, init: any) => {
    calls.push({
      url: String(input),
      method: String(init?.method ?? "GET"),
      body: new URLSearchParams(String(init?.body ?? "")),
    });
    if (opts.throwError) throw opts.throwError;
    const status = opts.status ?? 200;
    const payload = opts.json ?? { result: "success", pdf: "" };
    const text = JSON.stringify(payload);
    return {
      ok: status >= 200 && status < 300,
      status,
      redirected: false,
      url: "https://billing.example.com/includes/api.php",
      text: async () => text,
    } as any;
  }) as any;

  try {
    await run(calls);
  } finally {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    globalThis.fetch = REAL_FETCH;
    (storage as any).getWhmcsSettings = savedGetSettings;
  }
}

test("getInvoicePdf: issues GetInvoicePDF with the right params and decodes the base64 pdf", async () => {
  const pdfB64 = Buffer.from("%PDF-1.7 hello invoice").toString("base64");
  await withStubbedWhmcs({ json: { result: "success", pdf: pdfB64 } }, async (calls) => {
    const r = await getInvoicePdf(4242);

    assert.equal(r.ok, true);
    // The raw base64 is passed back verbatim; the route turns it into bytes.
    assert.equal(r.data, pdfB64);
    assert.equal(Buffer.from(r.data!, "base64").toString("utf8"), "%PDF-1.7 hello invoice");

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.url, "https://billing.example.com/includes/api.php");
    assert.equal(call.method, "POST");
    assert.equal(call.body.get("action"), "GetInvoicePDF");
    assert.equal(call.body.get("invoiceid"), "4242");
    assert.equal(call.body.get("responsetype"), "json");
    // Credentials are forwarded from env (never hard-coded into the fetcher).
    assert.equal(call.body.get("identifier"), "test-identifier");
    assert.equal(call.body.get("secret"), "test-secret");
  });
});

test("getInvoicePdf: empty pdf field yields ok:true with an empty data string", async () => {
  // WHMCS occasionally answers success with no pdf payload; the fetcher must not
  // crash and must surface an empty string so the route's `!dl.data` 502 fires.
  await withStubbedWhmcs({ json: { result: "success" } }, async () => {
    const r = await getInvoicePdf(7);
    assert.equal(r.ok, true);
    assert.equal(r.data, "");
  });
});

test("getInvoicePdf: WHMCS result:error degrades to a tagged whmcs_error failure", async () => {
  await withStubbedWhmcs({ json: { result: "error", message: "Invoice ID Not Found" } }, async () => {
    const r = await getInvoicePdf(999);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "whmcs_error");
    assert.match(r.error ?? "", /Invoice ID Not Found/);
  });
});

test("getInvoicePdf: non-2xx HTTP degrades to a network failure", async () => {
  await withStubbedWhmcs({ status: 500, json: { result: "error" } }, async () => {
    const r = await getInvoicePdf(7);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "network");
  });
});

test("getInvoicePdf: a thrown fetch (network down) degrades to a network failure, never throws", async () => {
  await withStubbedWhmcs({ throwError: new Error("ECONNREFUSED") }, async () => {
    const r = await getInvoicePdf(7);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "network");
  });
});
