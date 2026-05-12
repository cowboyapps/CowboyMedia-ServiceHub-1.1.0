export type BadgeTone = "silver" | "gold" | "blue" | "purple" | "green" | "amber";

export interface Badge {
  key: string;
  label: string;
  tone: BadgeTone;
  description: string;
}

export interface BadgeUserInput {
  role?: string | null;
  email?: string | null;
  createdAt?: Date | string | null;
}

export interface BadgeStats {
  ticketCount: number;
  accountAgeDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseEnvDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

let cachedBetaCutoff: { raw: string | undefined; date: Date | null } | null = null;

export function getBetaTesterCutoff(): Date | null {
  const raw = (typeof process !== "undefined" ? process.env?.BETA_TESTER_CUTOFF : undefined) as string | undefined;
  if (!cachedBetaCutoff || cachedBetaCutoff.raw !== raw) {
    cachedBetaCutoff = { raw, date: parseEnvDate(raw) };
  }
  return cachedBetaCutoff.date;
}

export function computeAccountAgeDays(createdAt: Date | string | null | undefined, now: Date = new Date()): number {
  if (!createdAt) return 0;
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(created.getTime())) return 0;
  const diff = now.getTime() - created.getTime();
  return Math.max(0, Math.floor(diff / DAY_MS));
}

export function computeUserBadges(
  user: BadgeUserInput,
  stats: BadgeStats,
  opts?: { betaCutoff?: Date | null; now?: Date },
): Badge[] {
  const badges: Badge[] = [];
  const betaCutoff = opts?.betaCutoff !== undefined ? opts.betaCutoff : getBetaTesterCutoff();

  if (user.role === "master_admin") {
    badges.push({ key: "master_admin", label: "Master Admin", tone: "purple", description: "Master administrator" });
  } else if (user.role === "admin") {
    badges.push({ key: "admin", label: "Admin", tone: "blue", description: "Administrator" });
  }

  if (stats.accountAgeDays >= 365 * 3) {
    badges.push({ key: "veteran_gold", label: "Veteran (3y)", tone: "gold", description: "Member for 3+ years" });
  } else if (stats.accountAgeDays >= 365) {
    badges.push({ key: "veteran_silver", label: "Veteran (1y)", tone: "silver", description: "Member for 1+ year" });
  }

  if (stats.ticketCount >= 10) {
    badges.push({ key: "top_asker", label: "Top Asker", tone: "amber", description: "Opened 10+ support tickets" });
  }

  if (betaCutoff && user.createdAt) {
    const created = user.createdAt instanceof Date ? user.createdAt : new Date(user.createdAt);
    if (!Number.isNaN(created.getTime()) && created.getTime() < betaCutoff.getTime()) {
      badges.push({ key: "beta_tester", label: "Beta Tester", tone: "purple", description: "Joined during the beta period" });
    }
  }

  if (user.email && user.email.trim().length > 0) {
    badges.push({ key: "verified_email", label: "Verified Email", tone: "green", description: "Email on file (placeholder until email verification ships)" });
  }

  return badges;
}
