import type { Request, Response, NextFunction } from "express";
import rateLimit, {
  ipKeyGenerator,
  type Options,
  type RateLimitInfo,
  type RateLimitRequestHandler,
} from "express-rate-limit";
import { storage } from "./storage";

declare module "express-serve-static-core" {
  interface Request {
    skipRateLimit?: boolean;
    rateLimit?: RateLimitInfo;
  }
}

function buildHandler(options: Partial<Options> = {}): RateLimitRequestHandler {
  return rateLimit({
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: (req: Request) => req.skipRateLimit === true,
    handler: (req: Request, res: Response, _next: NextFunction, opts) => {
      const resetTime = req.rateLimit?.resetTime;
      const resetMs =
        resetTime instanceof Date ? resetTime.getTime() - Date.now() : opts.windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: "Too many requests. Please slow down and try again shortly.",
        retryAfterSeconds,
      });
    },
    ...options,
  });
}

const ipKey = (req: Request) => ipKeyGenerator(req.ip || "unknown");
const userOrIpKey = (req: Request) =>
  req.session?.userId
    ? `user:${req.session.userId}`
    : `ip:${ipKeyGenerator(req.ip || "unknown")}`;

export function createLoginLimiter(): RateLimitRequestHandler {
  return buildHandler({
    windowMs: 60 * 1000,
    limit: 5,
    keyGenerator: (req: Request) => {
      const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
      return `login:${ipKeyGenerator(req.ip || "unknown")}:${username}`;
    },
    skipSuccessfulRequests: true,
  });
}

export function createRegisterLimiter(): RateLimitRequestHandler {
  return buildHandler({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    keyGenerator: ipKey,
  });
}

export function createPasswordResetLimiter(): RateLimitRequestHandler {
  return buildHandler({
    windowMs: 60 * 60 * 1000,
    limit: 3,
    keyGenerator: ipKey,
  });
}

export function createTicketLimiter(): RateLimitRequestHandler {
  return buildHandler({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    keyGenerator: userOrIpKey,
  });
}

export function createCommunityChatPostLimiter(): RateLimitRequestHandler {
  return buildHandler({
    windowMs: 60 * 1000,
    limit: 10,
    keyGenerator: userOrIpKey,
  });
}

export function createCommunityChatReactionLimiter(): RateLimitRequestHandler {
  return buildHandler({
    windowMs: 60 * 1000,
    limit: 60,
    keyGenerator: userOrIpKey,
  });
}

export function createReportLimiter(): RateLimitRequestHandler {
  return buildHandler({
    windowMs: 60 * 1000,
    limit: 10,
    keyGenerator: userOrIpKey,
  });
}

export function createWhmcsLinkRequestLimiter(): RateLimitRequestHandler {
  return buildHandler({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    keyGenerator: userOrIpKey,
  });
}

export function createWhmcsLinkVerifyLimiter(): RateLimitRequestHandler {
  return buildHandler({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    keyGenerator: userOrIpKey,
  });
}

// Customer-initiated service-cancellation request. A deliberate, low-frequency
// action — keep a light cap (5 / hr / user) consistent with other customer
// WHMCS write routes. Admin/master_admin sessions bypass via
// bypassRateLimitForAdmins like every other limiter.
export function createWhmcsCancelLimiter(): RateLimitRequestHandler {
  return buildHandler({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    keyGenerator: userOrIpKey,
  });
}

export async function bypassRateLimitForAdmins(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.session?.userId;
    if (userId) {
      const user = await storage.getUser(userId);
      if (user && (user.role === "admin" || user.role === "master_admin")) {
        req.skipRateLimit = true;
      }
    }
  } catch {
    // best-effort: never block the request because of bypass lookup
  }
  next();
}
