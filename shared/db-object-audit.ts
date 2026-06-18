// Drift detection for out-of-band Postgres triggers and functions.
//
// Background: the kb_articles search_vector trigger + function were historically
// applied out of band (db:push / manual on prod) and never tracked in
// migrations/. A refreshed DB could end up with the trigger but no matching
// column, breaking every kb_articles save with Postgres 42703. The table/column
// drift audits never looked at triggers or functions, so this whole class of
// drift went undetected until something broke at runtime.
//
// The committed migrations are the single source of truth for these objects.
// This module parses the migration SQL for the trigger/function objects it
// creates (minus any it later drops) and exposes a pure diff against whatever
// the live DB actually has, so the prebuild gate can fail closed on drift.

// Known intentional objects that may exist in the DB without being flagged as
// out-of-band extras. Mirrors the KNOWN_UNDECLARED_COLUMNS allowlist in
// script/audit-columns.ts. These two objects are also defined by
// migrations/0026_kb_search_vector.sql (so a fresh `db:migrate` recreates them);
// they are listed here as the documented known-good objects and as a safety net
// in case migration parsing ever fails to capture them.
export const KNOWN_UNDECLARED_FUNCTIONS = new Set<string>([
  "kb_articles_update_search_vector",
]);

export const KNOWN_UNDECLARED_TRIGGERS = new Set<string>([
  "kb_articles_search_vector_trigger",
]);

// Tables that intentionally exist in the DB without a corresponding
// shared/schema.ts pgTable declaration, so they are not flagged as stray
// orphans. These are infrastructure tables managed outside drizzle:
//   - __drizzle_migrations: drizzle's own migration journal table.
//   - session:              connect-pg-simple's session store.
// Mirrors the KNOWN_UNDECLARED_{FUNCTIONS,TRIGGERS} allowlists above and the
// KNOWN_UNDECLARED_COLUMNS allowlist in script/audit-columns.ts.
export const KNOWN_UNMANAGED_TABLES = new Set<string>([
  "__drizzle_migrations",
  "session",
]);

export interface MigrationDbObjects {
  functions: Set<string>;
  triggers: Set<string>;
}

// Walks every CREATE/DROP FUNCTION and CREATE/DROP TRIGGER statement across the
// supplied migration SQL texts IN ORDER, applying creates and drops as it goes.
// Order matters: 0026 does `DROP TRIGGER IF EXISTS x` immediately before
// `CREATE TRIGGER x`, and a later migration could legitimately drop an object an
// earlier one created. Processing textually keeps the net result correct.
//
// `sqlTexts` must be passed in migration order (sorted by filename).
export function parseMigrationDbObjects(sqlTexts: string[]): MigrationDbObjects {
  const functions = new Set<string>();
  const triggers = new Set<string>();

  // Captures: 1=operation (CREATE / CREATE OR REPLACE / DROP), 2=object kind
  // (FUNCTION / TRIGGER), 3=object name (optionally quoted / schema-qualified).
  const re =
    /\b(CREATE(?:\s+OR\s+REPLACE)?|DROP)\s+(FUNCTION|TRIGGER)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:"?[a-zA-Z0-9_]+"?\.)?"?([a-zA-Z0-9_]+)"?/gi;

  for (const sql of sqlTexts) {
    for (const m of sql.matchAll(re)) {
      const op = m[1].toUpperCase();
      const kind = m[2].toUpperCase();
      const name = m[3];
      const target = kind === "FUNCTION" ? functions : triggers;
      if (op.startsWith("CREATE")) {
        target.add(name);
      } else {
        target.delete(name);
      }
    }
  }

  return { functions, triggers };
}

export interface ObjectDiff {
  // Defined by a committed migration but absent from the DB. The migration did
  // not apply on this environment — drizzle expects the object to exist.
  missing: string[];
  // Present in the DB but not created by any committed migration (and not
  // allowlisted). These are the out-of-band objects this audit exists to catch.
  extra: string[];
}

export function diffDbObjects(
  expected: Set<string>,
  actual: Set<string>,
  allowlist: Set<string>,
): ObjectDiff {
  const missing = [...expected].filter((name) => !actual.has(name)).sort();
  const extra = [...actual]
    .filter((name) => !expected.has(name) && !allowlist.has(name))
    .sort();
  return { missing, extra };
}
