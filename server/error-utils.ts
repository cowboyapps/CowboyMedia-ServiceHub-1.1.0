// Helpers for safely reading properties off values caught in `catch` blocks.
// Caught values are typed `unknown` under strict mode; these narrow them
// without resorting to `any`, so the type checker keeps verifying the rest of
// the handler body.

export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
}

export function getErrorStatusCode(e: unknown): number | undefined {
  if (e && typeof e === "object" && "statusCode" in e) {
    const code = (e as { statusCode?: unknown }).statusCode;
    if (typeof code === "number") return code;
  }
  return undefined;
}

export function getErrorCode(e: unknown): string | undefined {
  if (e && typeof e === "object" && "code" in e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

export function getErrorName(e: unknown): string | undefined {
  if (e instanceof Error) return e.name;
  if (e && typeof e === "object" && "name" in e) {
    const n = (e as { name?: unknown }).name;
    if (typeof n === "string") return n;
  }
  return undefined;
}
