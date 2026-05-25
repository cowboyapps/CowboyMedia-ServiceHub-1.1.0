// Bearer-token middleware for "agent" endpoints — automated callers that
// run outside an authenticated browser session (e.g. the Replit agent
// appending a changelog bullet straight at production over HTTPS).
//
// Fails closed: missing env var → 503, missing/malformed header → 401,
// mismatch → 401. Comparison is constant-time so the response time of
// a wrong token doesn't leak how many leading bytes were correct.
//
// Each protected route picks its own env var name so we can rotate
// tokens independently per surface (changelog vs. anything we add
// later) without one rotation invalidating unrelated callers.

import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

export function requireAgentToken(envVarName: string) {
  return function agentTokenGuard(req: Request, res: Response, next: NextFunction) {
    const expected = process.env[envVarName];
    if (!expected) {
      return res.status(503).json({
        message: `${envVarName} not configured on the app server`,
      });
    }
    const header = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    const match = /^Bearer\s+(.+)$/.exec(header);
    if (!match) {
      return res.status(401).json({ message: "Bearer token required" });
    }
    const provided = match[1];
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
      return res.status(401).json({ message: "Invalid token" });
    }
    if (!crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ message: "Invalid token" });
    }
    next();
  };
}
