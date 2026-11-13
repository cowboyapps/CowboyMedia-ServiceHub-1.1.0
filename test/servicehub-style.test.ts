import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Card, CardContent, CardHeader, CardTitle } from "../client/src/components/ui/card";
import { Button } from "../client/src/components/ui/button";
import { Badge } from "../client/src/components/ui/badge";
import { Input } from "../client/src/components/ui/input";

// Existing components must keep their customization and form behavior when the
// shared visual defaults change. These tests don't require a signed-in browser.
test("shared cards preserve semantic surfaces and explicit dense-admin overrides", () => {
  const html = renderToStaticMarkup(React.createElement(Card, {
    className: "bg-destructive/10 border-destructive/30",
  }, React.createElement(CardHeader, { className: "p-2 sm:p-2" },
    React.createElement(CardTitle, { className: "text-xl" }, "Incident tools")),
  React.createElement(CardContent, { className: "p-0 sm:p-0" }, "Controls stay reachable")));
  assert.match(html, /sh-panel/);
  assert.match(html, /bg-destructive\/10/);
  assert.match(html, /border-destructive\/30/);
  assert.doesNotMatch(html, /\bbg-card\b/);
  assert.match(html, /p-0 sm:p-0/);
  assert.match(html, /text-xl/);
  assert.doesNotMatch(html, /max-w-/);
});

test("compact message actions and admin forms keep explicit geometry and native behavior", () => {
  const button = renderToStaticMarkup(React.createElement(Button, {
    type: "button", size: "icon", variant: "ghost",
    className: "h-6 w-6 rounded-full", "aria-label": "Copy message", disabled: true,
  }));
  assert.match(button, /type="button"/);
  assert.match(button, /h-6 w-6 rounded-full/);
  assert.doesNotMatch(button, /\bh-9\b|\bw-9\b/);
  assert.match(button, /disabled=""/);
  assert.match(button, /aria-label="Copy message"/);
  const input = renderToStaticMarkup(React.createElement(Input, {
    type: "number", min: 1, max: 365, defaultValue: 7, required: true, className: "h-8",
  }));
  assert.match(input, /type="number"/);
  assert.match(input, /min="1" max="365"/);
  assert.match(input, /value="7"/);
  assert.match(input, /\bh-8\b/);
  assert.match(input, /required=""/);
});

test("status badges retain visible wording and allow explicit custom shapes", () => {
  const pill = renderToStaticMarkup(React.createElement(Badge, { variant: "secondary" }, "Monitoring"));
  assert.match(pill, /rounded-full/);
  assert.match(pill, />Monitoring</);
  const custom = renderToStaticMarkup(React.createElement(Badge, { className: "rounded-md" }, "Internal"));
  assert.match(custom, /rounded-md/);
  assert.doesNotMatch(custom, /rounded-full/);
});

type RGB = [number, number, number];
function hsl(value: string): RGB {
  const [degrees, saturation, lightness] = value.replaceAll("%", "").split(/\s+/).map(Number);
  const s = saturation / 100, l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + degrees / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}
function luminance(rgb: RGB) {
  const channels = rgb.map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(a: RGB, b: RGB) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}

test("status text is readable on dashboard pill backgrounds in light and dark themes", () => {
  const css = readFileSync("client/src/components/servicehub-style.css", "utf8");
  const light = css.match(/:root\s*\{([^}]+)\}/)![1];
  const dark = css.match(/\.dark\s*\{([^}]+)\}/)![1];
  const fills: RGB[] = [[34 / 255, 197 / 255, 94 / 255], [245 / 255, 158 / 255, 11 / 255], [239 / 255, 68 / 255, 68 / 255]];
  for (const [name, declarations, card] of [
    ["light", light, hsl("0 0% 98%")], ["dark", dark, hsl("0 0% 11%")],
  ] as const) {
    ["positive", "warning", "danger"].forEach((tone, i) => {
      const text = hsl(declarations.match(new RegExp(`--sh-${tone}-text:\\s*([^;]+);`))![1]);
      const pill = fills[i].map((c, channel) => c * .15 + card[channel] * .85) as RGB;
      assert.ok(contrast(text, pill) >= 4.5, `${name} ${tone} pill must meet normal text contrast`);
    });
  }
});
