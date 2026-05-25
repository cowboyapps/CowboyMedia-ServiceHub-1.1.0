const TTL_MS = 30_000;

let cached: { payload: unknown; expiresAt: number } | null = null;

export function getCachedPublicStatus(): unknown | null {
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    cached = null;
    return null;
  }
  return cached.payload;
}

export function setCachedPublicStatus(payload: unknown): void {
  cached = { payload, expiresAt: Date.now() + TTL_MS };
}

export function invalidatePublicStatusCache(): void {
  cached = null;
}
