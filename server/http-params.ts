import type { Request } from "express";

// Express 5's type definitions widen `req.params` values to `string | string[]`
// (to model repeatable/wildcard segments). Our path params are always single
// strings at runtime, so narrow them at the read site instead of loosening the
// call sites with `any`.
export function getParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
