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

// Indexes that intentionally exist in the DB without being created by a
// committed migration, so they are not flagged as out-of-band extras. Mirrors
// the KNOWN_UNDECLARED_{FUNCTIONS,TRIGGERS} allowlists above.
//   - IDX_session_expire: created by connect-pg-simple on its `session` store
//     table (which is itself allowlisted in KNOWN_UNMANAGED_TABLES). Managed by
//     the session library, not drizzle/migrations.
// NOTE: this allowlist only covers index NAMES that are diffed by
// parseMigrationIndexDefs' key set; constraint-backed indexes (PRIMARY KEY /
// UNIQUE constraints declared in shared/schema.ts) are filtered out at the SQL
// level in audit-columns.ts before the diff, so they never need listing here.
export const KNOWN_UNDECLARED_INDEXES = new Set<string>([
  "IDX_session_expire",
]);

// CHECK / FOREIGN KEY / UNIQUE constraints that intentionally exist in the DB
// without being created by a committed migration, so they are not flagged as
// out-of-band extras. Mirrors KNOWN_UNDECLARED_INDEXES above. Currently empty:
// the infra tables (session, __drizzle_migrations) carry only PRIMARY KEY
// constraints, which this audit does not cover (see the constraint-drift block
// below). Add a constraint name here only if it is genuinely managed outside
// drizzle/migrations.
export const KNOWN_UNDECLARED_CONSTRAINTS = new Set<string>([]);

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

// ---------------------------------------------------------------------------
// Index drift
// ---------------------------------------------------------------------------
// Raw-SQL indexes created in migrations (e.g. the GIN index
// `kb_articles_search_vector_idx` in 0026, or every `CREATE INDEX` drizzle emits
// for `index()`/`uniqueIndex()` schema declarations) are not modelled by
// drizzle's column/trigger/function audits. An index a migration creates but
// that is missing on an environment silently degrades query performance, and an
// index redefined out of band with different columns/opclass/predicate is the
// same "works in dev, slow/wrong on a fresh migrate" drift one level deeper.
//
// The committed migrations are the source of truth. We parse every
// CREATE INDEX (net of later DROP INDEX, textually ordered like the
// trigger/function parsers) and compare both NAMES (missing/extra via
// diffDbObjects) and NORMALISED definitions (drift via diffObjectDefinitions)
// against the live DB's `pg_get_indexdef`.
//
// Constraint-backed indexes (PRIMARY KEY / UNIQUE constraints declared in
// shared/schema.ts) are NOT created via `CREATE INDEX` in migrations, so the DB
// side filters them out before diffing (see audit-columns.ts) — they are
// covered by the column audit instead.

// Canonicalises a CREATE INDEX statement so a hand/drizzle-written migration
// and Postgres' `pg_get_indexdef` form compare equal when they describe the
// same index. pg_get_indexdef emits no `IF NOT EXISTS`, schema-qualifies the
// table (`public.foo`), drops quotes, parenthesises WHERE predicates and bare
// column references, and never table-qualifies predicate columns; the migration
// text does the opposite of several of those. We therefore:
//   - drop `IF NOT EXISTS` / `CONCURRENTLY` (never present in pg_get_indexdef)
//   - drop double quotes
//   - strip every `<identifier>.` qualifier — covers the `public.` table prefix
//     AND the `"tbl"."col"` predicate qualifiers drizzle emits in partial-index
//     WHERE clauses, which pg renders as bare `(col ...)`
//   - drop all parentheses so pg's `WHERE ((a) AND (b))` folds to the migration's
//     `WHERE a AND b`, and the column-list parens fold equally on both sides
//   - collapse comma spacing, drop trailing semicolons, collapse whitespace
//   - uppercase (identifiers here are lowercase snake_case, so uppercasing both
//     sides equally keeps identifier comparison intact while absorbing keyword
//     case). A genuine change (different column, order, opclass, predicate)
//     still differs after normalisation.
export function normalizeIndexDef(def: string): string {
  return def
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, " ")
    .replace(/\bCONCURRENTLY\b/gi, " ")
    .replace(/"/g, "")
    .replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\./g, "")
    .replace(/[()]/g, " ")
    .replace(/\s*,\s*/g, ",")
    .replace(/;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// Walks the migration SQL IN ORDER and returns the NORMALISED CREATE INDEX
// definition for each index still defined at the end. A `DROP INDEX` removes it
// (0010 drops + recreates tickets indexes, 0012 drops one and creates another);
// a later `CREATE INDEX` after a drop wins. Mirrors parseMigrationTriggerDefs.
// The key set of the returned map is the authoritative list of index NAMES the
// migrations expect, used directly by the name-level diff.
//
// Captures `CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] <name>` up to
// the statement-terminating `;`. Index statements never contain an inner
// semicolon, so the non-greedy match to the first `;` is safe.
export function parseMigrationIndexDefs(
  sqlTexts: string[],
): Map<string, string> {
  const defs = new Map<string, string>();
  const createRe =
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?[\s\S]*?;/gi;
  const dropRe =
    /\bDROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(?:"?[a-zA-Z0-9_]+"?\.)?"?([a-zA-Z0-9_]+)"?/gi;

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
      if (e.def !== undefined) defs.set(e.name, normalizeIndexDef(e.def));
      else defs.delete(e.name);
    }
  }

  return defs;
}

// ---------------------------------------------------------------------------
// Constraint drift
// ---------------------------------------------------------------------------
// CHECK / FOREIGN KEY / UNIQUE constraints declared in shared/schema.ts are
// emitted into the migrations (inline `CONSTRAINT "x" UNIQUE(...)` inside
// CREATE TABLE, or `ALTER TABLE ... ADD CONSTRAINT "x" FOREIGN KEY ...` for
// references). They encode data-integrity guarantees: a UNIQUE that's missing
// lets duplicates in, a FOREIGN KEY redefined with a different ON DELETE rule
// silently changes cascade behaviour, a relaxed CHECK lets bad rows through.
// None of that is modelled by drizzle's column audit, so a constraint a
// migration creates but that is missing on an environment — or one redefined
// out of band — drifts undetected until data integrity is already compromised.
//
// The committed migrations are the source of truth. We parse every c/f/u
// constraint they create (net of later DROP CONSTRAINT, textually ordered like
// the index/trigger/function parsers) and compare both NAMES (missing/extra via
// diffDbObjects) and NORMALISED definitions (drift via diffObjectDefinitions)
// against the live DB's `pg_get_constraintdef`.
//
// PRIMARY KEY (contype 'p') constraints are deliberately NOT audited here: they
// are declared via the column/`PRIMARY KEY` modifier in shared/schema.ts and
// already covered by the column audit, and the DB query filters to contype
// IN ('c','f','u') to match. The parser likewise skips `PRIMARY KEY` so the two
// sides stay symmetric.

// Canonicalises a constraint definition so a hand/drizzle-written migration and
// Postgres' `pg_get_constraintdef` form compare equal when they describe the
// same constraint. pg_get_constraintdef emits uppercase keywords, no quotes
// (for unreserved identifiers), no schema prefix for same-schema FK targets,
// and OMITS the defaults `ON UPDATE NO ACTION` / `ON DELETE NO ACTION` /
// `MATCH SIMPLE`; drizzle's migration text spells several of those out. We
// therefore:
//   - drop trailing semicolons and double quotes
//   - strip the default `ON UPDATE/DELETE NO ACTION` and `MATCH SIMPLE` clauses
//     drizzle emits but pg_get_constraintdef hides (a real, non-default
//     ON DELETE CASCADE / SET NULL is kept and still compared)
//   - strip a leading `public.` schema qualifier on the FK's referenced table
//   - drop all parentheses so the column-list parens fold equally on both
//     sides (`UNIQUE("a")` vs `UNIQUE (a)`, `FOREIGN KEY ("c")` vs
//     `FOREIGN KEY (c)`), and pg's extra `CHECK ((expr))` wrapping folds too
//   - collapse comma spacing, drop a trailing comma left by an inline
//     constraint that wasn't the last table element, collapse whitespace
//   - uppercase (identifiers here are lowercase snake_case, so uppercasing both
//     sides equally keeps identifier comparison intact while absorbing keyword
//     case). A genuine change (different columns, referenced table, or a
//     loosened ON DELETE rule) still differs after normalisation.
// NOTE: CHECK expressions are inherently lossy to compare — Postgres rewrites
// them (e.g. `x IN ('a','b')` becomes `x = ANY (ARRAY['a'::text, ...])`), so a
// future CHECK that trips a false positive should be reconciled via a migration
// or, if intentionally unmanaged, allowlisted in KNOWN_UNDECLARED_CONSTRAINTS.
export function normalizeConstraintDef(def: string): string {
  return def
    .replace(/;/g, " ")
    .replace(/"/g, "")
    .replace(/\bON\s+UPDATE\s+NO\s+ACTION\b/gi, " ")
    .replace(/\bON\s+DELETE\s+NO\s+ACTION\b/gi, " ")
    .replace(/\bMATCH\s+SIMPLE\b/gi, " ")
    .replace(/\bpublic\./gi, "")
    .replace(/[()]/g, " ")
    .replace(/\s*,\s*/g, ",")
    .replace(/,+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// Walks the migration SQL IN ORDER and returns the NORMALISED definition for
// each c/f/u constraint still defined at the end. An `ALTER TABLE ... DROP
// CONSTRAINT` removes it; a later `ADD CONSTRAINT` of the same name wins.
// Mirrors parseMigrationIndexDefs' net-presence logic. The key set of the
// returned map is the authoritative list of constraint NAMES the migrations
// expect, used directly by the name-level diff.
//
// Captures both constraint forms drizzle emits:
//   - inline:  `CONSTRAINT "name" UNIQUE(...)` inside CREATE TABLE
//   - altered: `ALTER TABLE ... ADD CONSTRAINT "name" FOREIGN KEY (...) ...;`
// The definition runs from the type keyword to the first `;` (ALTER form, one
// statement per line) or end-of-line (inline form, one constraint per line);
// neither a column list nor an FK clause contains an inner `;` or newline, so
// the `[^;\n]*` capture is safe. PRIMARY KEY is intentionally excluded to match
// the DB-side contype IN ('c','f','u') filter.
export function parseMigrationConstraintDefs(
  sqlTexts: string[],
): Map<string, string> {
  const defs = new Map<string, string>();
  const createRe =
    /\b(?:ADD\s+)?CONSTRAINT\s+"?([a-zA-Z0-9_]+)"?\s+((?:FOREIGN\s+KEY|UNIQUE|CHECK)[^;\n]*)/gi;
  const dropRe =
    /\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/gi;

  for (const sql of sqlTexts) {
    const events: Array<{ index: number; name: string; def?: string }> = [];
    for (const m of sql.matchAll(createRe)) {
      events.push({ index: m.index ?? 0, name: m[1], def: m[2] });
    }
    for (const m of sql.matchAll(dropRe)) {
      events.push({ index: m.index ?? 0, name: m[1] });
    }
    events.sort((a, b) => a.index - b.index);
    for (const e of events) {
      if (e.def !== undefined) defs.set(e.name, normalizeConstraintDef(e.def));
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
