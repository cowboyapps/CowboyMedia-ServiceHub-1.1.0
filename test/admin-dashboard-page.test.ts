import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Frontend "smoke" tests for the admin dashboard page. We can't render
// React in this Node test runner without adding a DOM dependency, so we
// assert the page exposes the structural elements the task requires:
// the responsive 1/2/4 grid breakpoints, every required card section
// with stable testids, the ChartContainer wrapper (not raw Recharts
// ResponsiveContainer), the websocket invalidation hook, and the
// permission-keyed default landing wiring inside the admin portal.
const PAGE = readFileSync(join(process.cwd(), "client/src/pages/admin-dashboard.tsx"), "utf8");
const PORTAL = readFileSync(join(process.cwd(), "client/src/pages/admin-portal.tsx"), "utf8");

test("admin dashboard page: uses 1/2/4 responsive grid", () => {
  assert.match(PAGE, /grid-cols-1 md:grid-cols-2 xl:grid-cols-4/);
});

test("admin dashboard page: includes every required card testid", () => {
  for (const id of [
    "card-dashboard-tickets",
    "card-dashboard-services",
    "card-dashboard-notifications",
    "card-dashboard-kb",
    "card-dashboard-community",
    "card-dashboard-users",
  ]) {
    assert.ok(PAGE.includes(`data-testid="${id}"`), `missing testid ${id}`);
  }
});

test("admin dashboard page: uses Shadcn ChartContainer wrapper", () => {
  assert.match(PAGE, /from "@\/components\/ui\/chart"/);
  assert.match(PAGE, /<ChartContainer\b/);
  // Bars reference the wrapper-managed CSS variables, not raw colors.
  assert.match(PAGE, /var\(--color-opened\)/);
  assert.match(PAGE, /var\(--color-resolved\)/);
});

test("admin dashboard page: subscribes to ws ticket + alert events for live invalidation", () => {
  // Migrated off inline `new WebSocket(` to the shared reconnect hook (task #250) —
  // assert the page still wires its live subscription, just through the hook now.
  assert.match(PAGE, /useReconnectingWebSocket\(/);
  assert.match(PAGE, /ticket_/);
  assert.match(PAGE, /new_alert/);
  assert.match(PAGE, /alert_update\b/);
  assert.match(PAGE, /invalidateQueries\(\{\s*queryKey:\s*\["\/api\/admin\/dashboard"\]\s*\}\)/);
});

test("admin dashboard page: surfaces push success/fail split, online users fallback, and zero-result KB section", () => {
  assert.match(PAGE, /pushFailed24h/);
  assert.match(PAGE, /Online now/);
  assert.match(PAGE, /presence unavailable/);
  assert.match(PAGE, /Top zero-result searches/);
});

test("admin portal: makes Overview the default landing for admins with dashboard.view", () => {
  // The active tab is derived from the URL via the extracted helper,
  // which falls back to "overview" when no tab param is present and
  // dashboard.view permission has resolved (covers both first paint
  // and the async permission-load case in a single derivation).
  assert.match(PORTAL, /computeInitialActiveSection\(\{[\s\S]*hasDashboardView:\s*hasPermission\("dashboard\.view"\)/);
});
