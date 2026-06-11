// Helpers for safely reading Express `req.query` values. Query values are typed
// `string | ParsedQs | (string | ParsedQs)[] | undefined`, so a bare
// `req.query.x as string` cast lies to the type checker when a client sends an
// array (e.g. `?x=a&x=b`) or nested object. These narrow honestly instead.

import type { ParsedQs } from "qs";

type QueryValue = string | ParsedQs | (string | ParsedQs)[] | undefined;

export function queryString(value: QueryValue): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === "string") return first;
  }
  return undefined;
}

export function queryInt(value: QueryValue, fallback: number): number {
  const s = queryString(value);
  if (s === undefined) return fallback;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? fallback : n;
}
