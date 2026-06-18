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

// This module is the single home for every schema-audit "known exception"
// allowlist (unmanaged tables, undeclared columns, out-of-band functions and
// triggers), so they live together and can't quietly drift apart. script/audit-columns.ts
// imports all of them rather than defining any inline.

// Known intentional objects that may exist in the DB without being flagged as
// out-of-band extras. Mirrors the KNOWN_UNDECLARED_COLUMNS allowlist below.
// These two objects are also defined by
// migrations/0026_kb_search_vector.sql (so a fresh `db:migrate` recreates them);
// they are listed here as the documented known-good objects and as a safety net
// in case migration parsing ever fails to capture them.
export const KNOWN_UNDECLARED_FUNCTIONS = new Set<string>([
  "kb_articles_update_search_vector",
]);

export const KNOWN_UNDECLARED_TRIGGERS = new Set<string>([
  "kb_articles_search_vector_trigger",
]);

// Columns that intentionally exist in the DB without a corresponding
// shared/schema.ts declaration. Drizzle's type system doesn't model these
// well (e.g. Postgres tsvector for full-text search), so we manage them via
// raw SQL in storage.ts and exclude them from the drift check. Mirrors the
// KNOWN_UNDECLARED_{FUNCTIONS,TRIGGERS} allowlists above.
export const KNOWN_UNDECLARED_COLUMNS: Record<string, Set<string>> = {
  kb_articles: new Set(["search_vector"]),
};

// Tables that intentionally exist in the DB without a corresponding
// shared/schema.ts pgTable declaration, so they are not flagged as stray
// orphans. These are infrastructure tables managed outside drizzle:
//   - __drizzle_migrations: drizzle's own migration journal table.
//   - session:              connect-pg-simple's session store.
// Mirrors the KNOWN_UNDECLARED_{FUNCTIONS,TRIGGERS,COLUMNS} allowlists above.
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

// ---------------------------------------------------------------------------
// Body / definition drift
// ---------------------------------------------------------------------------
// Comparing objects by NAME only misses the case where someone redefines a
// trigger or function out of band with the SAME name but a CHANGED body or
// signature (e.g. `CREATE OR REPLACE FUNCTION kb_articles_update_search_vector`
// applied manually on prod with different logic). The name matches a migration
// so the name-level diff passes, yet a fresh `db:migrate` would produce a
// different definition — the same "works in dev, breaks on a fresh migrate"
// class of drift the name audit set out to prevent, one level deeper.
//
// To catch it we compare the live definition against what the committed
// migrations would produce:
//   - functions: the dollar-quoted body (== Postgres `pg_proc.prosrc`)
//   - triggers:  the full CREATE TRIGGER statement (== `pg_get_triggerdef`)
// Both sides are normalised first so harmless formatting differences
// (indentation, newlines, quoting, the EXECUTE PROCEDURE/FUNCTION synonym, a
// schema prefix, a trailing semicolon) never produce a false positive.

// Collapses every run of whitespace to a single space and trims. Postgres
// stores a function body in `prosrc` verbatim (exactly what sat between the
// dollar quotes), so a fresh migrate yields a body that is identical to the
// migration's once both are whitespace-normalised. Case is preserved: a
// keyword/literal/identifier change is real out-of-band drift we want to flag.
export function normalizeFunctionBody(src: string): string {
  return src.replace(/\s+/g, " ").trim();
}

// Canonicalises a CREATE TRIGGER statement so the migration text and the
// Postgres `pg_get_triggerdef` form compare equal when they describe the same
// trigger. pg_get_triggerdef emits uppercase keywords, no trailing semicolon,
// and may quote/qualify differently than the hand-written migration, so we:
//   - drop trailing semicolons and double quotes
//   - fold the `EXECUTE PROCEDURE` legacy synonym to `EXECUTE FUNCTION`
//     (pg_get_triggerdef always emits FUNCTION on PG11+)
//   - strip a leading `public.` schema qualifier on the table / function
//   - collapse whitespace and uppercase the whole thing
// Identifiers in this codebase are lowercase snake_case, so uppercasing both
// sides equally keeps identifier comparison intact while absorbing keyword-case
// differences. A genuine change (different table, timing, event, or function)
// still differs after normalisation.
export function normalizeTriggerDef(def: string): string {
  return def
    .replace(/;/g, " ")
    .replace(/"/g, "")
    .replace(/\bEXECUTE\s+PROCEDURE\b/gi, "EXECUTE FUNCTION")
    .replace(/\bpublic\./gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// Walks the migration SQL IN ORDER and returns the NORMALISED body for each
// function that is still defined at the end (a later DROP removes it, a later
// CREATE OR REPLACE wins). Mirrors parseMigrationDbObjects' net-presence logic.
//
// Captures: 1=name, 2=opening dollar tag ($$ or $tag$), 3=body up to the
// matching closing tag (backreference \2). Args are matched as a single
// non-nested `(...)` group, which is all the trigger functions here use.
export function parseMigrationFunctionBodies(
  sqlTexts: string[],
): Map<string, string> {
  const bodies = new Map<string, string>();
  const createRe =
    /\bCREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+(?:"?[a-zA-Z0-9_]+"?\.)?"?([a-zA-Z0-9_]+)"?\s*\([^)]*\)[\s\S]*?\bAS\s+(\$[a-zA-Z0-9_]*\$)([\s\S]*?)\2/gi;
  const dropRe =
    /\bDROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:"?[a-zA-Z0-9_]+"?\.)?"?([a-zA-Z0-9_]+)"?/gi;

  for (const sql of sqlTexts) {
    // Process creates and drops in the order they appear in this file by
    // scanning each independently and merging on a single ordered token list.
    const events: Array<{ index: number; name: string; body?: string }> = [];
    for (const m of sql.matchAll(createRe)) {
      events.push({ index: m.index ?? 0, name: m[1], body: m[3] });
    }
    for (const m of sql.matchAll(dropRe)) {
      events.push({ index: m.index ?? 0, name: m[1] });
    }
    events.sort((a, b) => a.index - b.index);
    for (const e of events) {
      if (e.body !== undefined) bodies.set(e.name, normalizeFunctionBody(e.body));
      else bodies.delete(e.name);
    }
  }

  return bodies;
}

// Walks the migration SQL IN ORDER and returns the NORMALISED CREATE TRIGGER
// definition for each trigger still defined at the end. A `DROP TRIGGER`
// removes it; a later `CREATE TRIGGER` (after the customary DROP IF EXISTS)
// wins.
export function parseMigrationTriggerDefs(
  sqlTexts: string[],
): Map<string, string> {
  const defs = new Map<string, string>();
  const createRe =
    /\bCREATE\s+(?:OR\s+REPLACE\s+|CONSTRAINT\s+)?TRIGGER\s+"?([a-zA-Z0-9_]+)"?[\s\S]*?;/gi;
  const dropRe =
    /\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/gi;

  for (const sql of sqlTexts) {
    const events: Array<{ index: number; name: string; def?: string }> = [];
    for (const m of sql.matchAll(createRe)) {
      events.push({ index: m.index ?? 0, name: m[1], def: m[0] });
    }
    for (const m of sql.matchAll(dropRe)) {
      events.push({ index: m.index ?? 0, name: m[1] });
    }
    events.sort((a, b) => a.index - b.index);
    for (const e of events) {
      if (e.def !== undefined) defs.set(e.name, normalizeTriggerDef(e.def));
      else defs.delete(e.name);
    }
  }

  return defs;
}

export interface DefinitionMismatch {
  name: string;
  expected: string;
  actual: string;
}

// Compares NORMALISED definitions for every object present in BOTH the
// migrations and the DB. Missing/extra objects are handled by diffDbObjects;
// this only flags same-name objects whose body/definition has drifted. Both
// maps MUST already be normalised (migration side via the parsers above, DB
// side via normalizeFunctionBody / normalizeTriggerDef).
//
// NOTE: the KNOWN_UNDECLARED_* allowlists are deliberately NOT consulted here.
// They suppress *out-of-band extras* — objects that live in the DB but no
// migration creates, which by definition never appear in `expected` and so are
// never iterated below. A name in `expected` is, by contrast, MANAGED by a
// committed migration (kb_articles_update_search_vector among them), so its body
// must be checked even though it is also listed in the allowlist as a parsing
// safety net. Skipping allowlisted names here would silently exempt the very
// object this audit exists to protect.
export function diffObjectDefinitions(
  expected: Map<string, string>,
  actual: Map<string, string>,
): DefinitionMismatch[] {
  const mismatched: DefinitionMismatch[] = [];
  for (const [name, expectedDef] of expected) {
    const actualDef = actual.get(name);
    if (actualDef === undefined) continue; // missing — reported by name diff
    if (actualDef !== expectedDef) {
      mismatched.push({ name, expected: expectedDef, actual: actualDef });
    }
  }
  return mismatched.sort((a, b) => a.name.localeCompare(b.name));
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
