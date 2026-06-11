import type { Express, Request, Response, RequestHandler } from "express";
import {
  ChallengeStore,
  generateBackupCodes,
  generateQrDataUrl,
  generateTotpSecret,
  buildOtpAuthUri,
  hashBackupCode,
  verifyTotpCode,
} from "./totp";
import type { User, TotpBackupCode } from "@shared/schema";

export interface TotpRoutesStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  updateUser(id: string, data: Partial<User>): Promise<User | undefined>;
  listTotpBackupCodes(userId: string): Promise<TotpBackupCode[]>;
  replaceTotpBackupCodes(userId: string, codeHashes: string[]): Promise<void>;
  markTotpBackupCodeUsed(id: string): Promise<void>;
  deleteTotpBackupCodes(userId: string): Promise<void>;
}

export interface TotpRoutesDeps {
  storage: TotpRoutesStorage;
  challenges: ChallengeStore;
  verifyPassword: (password: string, hash: string) => Promise<boolean>;
  isAdminRole: (role: string | null | undefined) => boolean;
  sanitizeUser: (user: User) => any;
  logActivity: (
    category: string,
    action: string,
    opts: {
      actorId?: string;
      targetId?: string;
      targetType?: string;
      summary: string;
      details?: string;
    },
  ) => void;
  requireAuth: RequestHandler;
  requireMasterAdmin: RequestHandler;
  loginMiddleware?: RequestHandler[];
}

export function registerAuth2FARoutes(app: Express, deps: TotpRoutesDeps): void {
  const {
    storage,
    challenges,
    verifyPassword,
    isAdminRole,
    sanitizeUser,
    logActivity,
    requireAuth,
    requireMasterAdmin,
    loginMiddleware = [],
  } = deps;

  app.post("/api/auth/login", ...loginMiddleware, async (req: Request, res: Response) => {
    try {
      const username = req.body.username?.trim();
      const { password } = req.body;
      const user = await storage.getUserByUsername(username);
      if (!user || !(await verifyPassword(password, user.password))) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      if (user.totpEnabledAt && user.totpSecret) {
        const challenge = challenges.create(user.id);
        return res.json({ twoFactorRequired: true, challengeId: challenge.id });
      }
      req.session.userId = user.id;
      res.json(sanitizeUser(user));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/auth/2fa/verify", async (req: Request, res: Response) => {
    try {
      const { challengeId, code } = req.body ?? {};
      if (typeof challengeId !== "string" || typeof code !== "string") {
        return res.status(400).json({ message: "challengeId and code are required" });
      }
      const result = challenges.attempt(challengeId);
      if (!result.ok) {
        if (result.reason === "not_found") return res.status(400).json({ message: "Invalid or expired challenge" });
        if (result.reason === "expired") return res.status(400).json({ message: "Challenge expired. Please sign in again." });
        return res.status(429).json({ message: "Too many attempts. Please sign in again." });
      }
      const user = await storage.getUser(result.challenge.userId);
      if (!user || !user.totpEnabledAt || !user.totpSecret) {
        challenges.delete(challengeId);
        return res.status(400).json({ message: "Invalid challenge" });
      }
      const cleaned = code.replace(/[\s-]/g, "");
      let success = false;
      if (/^\d{6}$/.test(cleaned)) {
        success = verifyTotpCode(user.totpSecret, cleaned);
      }
      if (!success) {
        const upper = cleaned.toUpperCase();
        const codes = await storage.listTotpBackupCodes(user.id);
        const targetHash = hashBackupCode(upper);
        const match = codes.find((c) => c.codeHash === targetHash && !c.usedAt);
        if (match) {
          await storage.markTotpBackupCodeUsed(match.id);
          success = true;
        }
      }
      if (!success) {
        return res.status(401).json({ message: "Invalid 6-digit code" });
      }
      challenges.delete(challengeId);
      req.session.userId = user.id;
      res.json(sanitizeUser(user));
      logActivity("user", "two_factor_login", {
        actorId: user.id,
        targetId: user.id,
        targetType: "user",
        summary: `${user.fullName} (${user.username}) signed in with 2FA`,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/auth/2fa/setup", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || !isAdminRole(user.role)) return res.status(403).json({ message: "Forbidden" });
      const secret = generateTotpSecret();
      await storage.updateUser(user.id, { totpSecret: secret, totpEnabledAt: null });
      await storage.deleteTotpBackupCodes(user.id);
      const otpauth = buildOtpAuthUri(secret, `${user.username}`);
      const qrDataUrl = await generateQrDataUrl(otpauth);
      res.json({ secret, otpauth, qrDataUrl });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/auth/2fa/activate", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || !isAdminRole(user.role)) return res.status(403).json({ message: "Forbidden" });
      if (!user.totpSecret) return res.status(400).json({ message: "Run setup first" });
      if (user.totpEnabledAt) return res.status(400).json({ message: "2FA is already enabled" });
      const code = String(req.body?.code ?? "").replace(/\s/g, "");
      if (!verifyTotpCode(user.totpSecret, code)) {
        return res.status(401).json({ message: "Invalid code. Try again." });
      }
      const backupCodes = generateBackupCodes(10);
      const hashes = backupCodes.map(hashBackupCode);
      await storage.replaceTotpBackupCodes(user.id, hashes);
      await storage.updateUser(user.id, { totpEnabledAt: new Date() });
      logActivity("user", "two_factor_enabled", {
        actorId: user.id,
        targetId: user.id,
        targetType: "user",
        summary: `${user.fullName} (${user.username}) enabled 2FA`,
      });
      res.json({ backupCodes });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/auth/2fa/disable", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || !isAdminRole(user.role)) return res.status(403).json({ message: "Forbidden" });
      if (!user.totpEnabledAt || !user.totpSecret) return res.status(400).json({ message: "2FA is not enabled" });
      const password = String(req.body?.password ?? "");
      const code = String(req.body?.code ?? "").replace(/\s/g, "");
      if (!password || !(await verifyPassword(password, user.password))) {
        return res.status(401).json({ message: "Password is incorrect" });
      }
      if (!verifyTotpCode(user.totpSecret, code)) {
        return res.status(401).json({ message: "Invalid 6-digit code" });
      }
      await storage.updateUser(user.id, { totpSecret: null, totpEnabledAt: null });
      await storage.deleteTotpBackupCodes(user.id);
      logActivity("user", "two_factor_disabled", {
        actorId: user.id,
        targetId: user.id,
        targetType: "user",
        summary: `${user.fullName} (${user.username}) disabled 2FA`,
      });
      res.json({ message: "2FA disabled" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/auth/2fa/backup-codes/regenerate", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || !isAdminRole(user.role)) return res.status(403).json({ message: "Forbidden" });
      if (!user.totpEnabledAt || !user.totpSecret) return res.status(400).json({ message: "2FA is not enabled" });
      const password = String(req.body?.password ?? "");
      const code = String(req.body?.code ?? "").replace(/\s/g, "");
      if (!password || !(await verifyPassword(password, user.password))) {
        return res.status(401).json({ message: "Password is incorrect" });
      }
      if (!verifyTotpCode(user.totpSecret, code)) {
        return res.status(401).json({ message: "Invalid 6-digit code" });
      }
      const backupCodes = generateBackupCodes(10);
      const hashes = backupCodes.map(hashBackupCode);
      await storage.replaceTotpBackupCodes(user.id, hashes);
      logActivity("user", "two_factor_backup_codes_regenerated", {
        actorId: user.id,
        targetId: user.id,
        targetType: "user",
        summary: `${user.fullName} (${user.username}) regenerated 2FA backup codes`,
      });
      res.json({ backupCodes });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/auth/2fa/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const remainingBackupCodes = user.totpEnabledAt
        ? (await storage.listTotpBackupCodes(user.id)).filter((c) => !c.usedAt).length
        : 0;
      res.json({
        enabled: !!user.totpEnabledAt,
        enabledAt: user.totpEnabledAt,
        setupPending: !!user.totpSecret && !user.totpEnabledAt,
        remainingBackupCodes,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/users/:id/disable-2fa", requireMasterAdmin, async (req: Request, res: Response) => {
    try {
      const target = await storage.getUser(req.params.id as string);
      if (!target) return res.status(404).json({ message: "User not found" });
      if (!target.totpEnabledAt && !target.totpSecret) {
        return res.status(400).json({ message: "2FA is not enabled for this user" });
      }
      await storage.updateUser(target.id, { totpSecret: null, totpEnabledAt: null });
      await storage.deleteTotpBackupCodes(target.id);
      const actor = await storage.getUser(req.session.userId!);
      logActivity("user", "two_factor_force_disabled", {
        actorId: req.session.userId,
        targetId: target.id,
        targetType: "user",
        summary: `${actor?.fullName || "Master admin"} force-disabled 2FA for ${target.fullName} (${target.username})`,
      });
      res.json({ message: "2FA disabled for user" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
