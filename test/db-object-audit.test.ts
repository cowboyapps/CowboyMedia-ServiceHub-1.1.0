import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KNOWN_UNDECLARED_FUNCTIONS,
  KNOWN_UNDECLARED_TRIGGERS,
  KNOWN_UNMANAGED_TABLES,
  diffDbObjects,
  diffObjectDefinitions,
  normalizeFunctionBody,
  normalizeTriggerDef,
  parseMigrationDbObjects,
  parseMigrationFunctionBodies,
  parseMigrationTriggerDefs,
} from "../shared/db-object-audit";

test("parses CREATE FUNCTION and CREATE TRIGGER names", () => {
  const sql = `
    CREATE OR REPLACE FUNCTION kb_articles_update_search_vector() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS kb_articles_search_vector_trigger ON "kb_articles";
    CREATE TRIGGER kb_articles_search_vector_trigger BEFORE INSERT OR UPDATE ON "kb_articles" FOR EACH ROW EXECUTE FUNCTION kb_articles_update_search_vector();
  `;
  const { functions, triggers } = parseMigrationDbObjects([sql]);
  assert.deepEqual([...functions], ["kb_articles_update_search_vector"]);
  assert.deepEqual([...triggers], ["kb_articles_search_vector_trigger"]);
});

test("DROP after CREATE removes the object (textual order honored)", () => {
  const earlier = `CREATE FUNCTION foo() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;`;
  const later = `DROP FUNCTION IF EXISTS foo;`;
  const { functions } = parseMigrationDbObjects([earlier, later]);
  assert.deepEqual([...functions], []);
});

test("DROP IF EXISTS before CREATE still nets to created", () => {
  const sql = `
    DROP TRIGGER IF EXISTS t1 ON "x";
    CREATE TRIGGER t1 BEFORE INSERT ON "x" FOR EACH ROW EXECUTE FUNCTION f();
  `;
  const { triggers } = parseMigrationDbObjects([sql]);
  assert.deepEqual([...triggers], ["t1"]);
});

test("handles quoted and schema-qualified names", () => {
  const sql = `
    CREATE FUNCTION public."my_fn"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER "my_trig" BEFORE INSERT ON "t" FOR EACH ROW EXECUTE FUNCTION public."my_fn"();
  `;
  const { functions, triggers } = parseMigrationDbObjects([sql]);
  assert.ok(functions.has("my_fn"));
  assert.ok(triggers.has("my_trig"));
});

test("diff reports missing (in migrations, not in DB)", () => {
  const diff = diffDbObjects(new Set(["a", "b"]), new Set(["a"]), new Set());
  assert.deepEqual(diff.missing, ["b"]);
  assert.deepEqual(diff.extra, []);
});

test("diff reports extra out-of-band objects (in DB, not in migrations)", () => {
  const diff = diffDbObjects(new Set(["a"]), new Set(["a", "rogue"]), new Set());
  assert.deepEqual(diff.missing, []);
  assert.deepEqual(diff.extra, ["rogue"]);
});

test("allowlist suppresses extra-in-DB findings only", () => {
  const diff = diffDbObjects(
    new Set(["a"]),
    new Set(["a", "kb_articles_update_search_vector"]),
    KNOWN_UNDECLARED_FUNCTIONS,
  );
  assert.deepEqual(diff.extra, []);
});

test("kb objects are present in the allowlists", () => {
  assert.ok(KNOWN_UNDECLARED_FUNCTIONS.has("kb_articles_update_search_vector"));
  assert.ok(KNOWN_UNDECLARED_TRIGGERS.has("kb_articles_search_vector_trigger"));
});

test("diff reports stray tables (in DB, not in schema)", () => {
  const diff = diffDbObjects(
    new Set(["users", "tickets"]),
    new Set(["users", "tickets", "old_orphan_table"]),
    new Set(),
  );
  assert.deepEqual(diff.missing, []);
  assert.deepEqual(diff.extra, ["old_orphan_table"]);
});

test("unmanaged-table allowlist suppresses infra tables", () => {
  const diff = diffDbObjects(
    new Set(["users"]),
    new Set(["users", "__drizzle_migrations", "session"]),
    KNOWN_UNMANAGED_TABLES,
  );
  assert.deepEqual(diff.extra, []);
});

test("infra tables are present in the unmanaged-table allowlist", () => {
  assert.ok(KNOWN_UNMANAGED_TABLES.has("__drizzle_migrations"));
  assert.ok(KNOWN_UNMANAGED_TABLES.has("session"));
});

// ---- Body / definition drift ---------------------------------------------

test("normalizeFunctionBody collapses whitespace, preserves content/case", () => {
  const a = normalizeFunctionBody("\n  BEGIN\n    RETURN NEW;\n  END;\n");
  const b = normalizeFunctionBody("BEGIN RETURN NEW; END;");
  assert.equal(a, b);
  assert.equal(a, "BEGIN RETURN NEW; END;");
});

test("normalizeTriggerDef folds migration text and pg_get_triggerdef equal", () => {
  const migration = `CREATE TRIGGER t1
    BEFORE INSERT OR UPDATE ON "kb_articles"
    FOR EACH ROW EXECUTE FUNCTION kb_articles_update_search_vector();`;
  const pgForm = `CREATE TRIGGER t1 BEFORE INSERT OR UPDATE ON kb_articles FOR EACH ROW EXECUTE PROCEDURE public.kb_articles_update_search_vector()`;
  assert.equal(normalizeTriggerDef(migration), normalizeTriggerDef(pgForm));
});

test("parseMigrationFunctionBodies captures the dollar-quoted body", () => {
  const sql = `
    CREATE OR REPLACE FUNCTION f() RETURNS trigger AS $$
    BEGIN
      NEW.x := 1;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;
  const bodies = parseMigrationFunctionBodies([sql]);
  assert.equal(bodies.get("f"), "BEGIN NEW.x := 1; RETURN NEW; END;");
});

test("parseMigrationFunctionBodies: later CREATE OR REPLACE wins", () => {
  const earlier = `CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN RETURN OLD; END; $$ LANGUAGE plpgsql;`;
  const later = `CREATE OR REPLACE FUNCTION f() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;`;
  const bodies = parseMigrationFunctionBodies([earlier, later]);
  assert.equal(bodies.get("f"), "BEGIN RETURN NEW; END;");
});

test("parseMigrationFunctionBodies: DROP removes the body", () => {
  const create = `CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;`;
  const drop = `DROP FUNCTION IF EXISTS f;`;
  const bodies = parseMigrationFunctionBodies([create, drop]);
  assert.equal(bodies.has("f"), false);
});

test("parseMigrationTriggerDefs captures and normalises the statement", () => {
  const sql = `
    DROP TRIGGER IF EXISTS t1 ON "x";
    CREATE TRIGGER t1 BEFORE INSERT ON "x" FOR EACH ROW EXECUTE FUNCTION f();
  `;
  const defs = parseMigrationTriggerDefs([sql]);
  assert.equal(
    defs.get("t1"),
    "CREATE TRIGGER T1 BEFORE INSERT ON X FOR EACH ROW EXECUTE FUNCTION F()",
  );
});

test("diffObjectDefinitions flags a redefined (drifted) body", () => {
  const expected = new Map([["f", "BEGIN RETURN NEW; END;"]]);
  const actual = new Map([["f", "BEGIN RETURN OLD; END;"]]);
  const mismatches = diffObjectDefinitions(expected, actual);
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].name, "f");
});

test("diffObjectDefinitions passes when bodies match", () => {
  const expected = new Map([["f", "BEGIN RETURN NEW; END;"]]);
  const actual = new Map([["f", "BEGIN RETURN NEW; END;"]]);
  assert.deepEqual(diffObjectDefinitions(expected, actual), []);
});

test("diffObjectDefinitions ignores objects missing from the DB", () => {
  const expected = new Map([["f", "BEGIN RETURN NEW; END;"]]);
  const actual = new Map<string, string>();
  assert.deepEqual(diffObjectDefinitions(expected, actual), []);
});

// Regression: a migration-managed object that ALSO appears in the
// KNOWN_UNDECLARED_* allowlist (as a parsing safety net, like the kb search
// function) must STILL be body-checked. Body drift must not be suppressed just
// because the name is allowlisted — the allowlist only governs out-of-band
// extras, which never appear in `expected`.
test("diffObjectDefinitions still flags drift for allowlisted-but-managed names", () => {
  const expected = new Map([
    ["kb_articles_update_search_vector", "BEGIN RETURN NEW; END;"],
  ]);
  const actual = new Map([
    ["kb_articles_update_search_vector", "BEGIN RETURN OLD; END;"],
  ]);
  assert.ok(KNOWN_UNDECLARED_FUNCTIONS.has("kb_articles_update_search_vector"));
  const mismatches = diffObjectDefinitions(expected, actual);
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].name, "kb_articles_update_search_vector");
});

test("0026 migration parses to a matchable kb function body + trigger def", () => {
  const sql = readFileSync(
    join(process.cwd(), "migrations", "0026_kb_search_vector.sql"),
    "utf-8",
  );
  const bodies = parseMigrationFunctionBodies([sql]);
  const defs = parseMigrationTriggerDefs([sql]);

  const body = bodies.get("kb_articles_update_search_vector");
  assert.ok(body, "kb function body should be captured");
  assert.match(body!, /NEW\.search_vector :=/);
  assert.match(body!, /setweight/);

  const def = defs.get("kb_articles_search_vector_trigger");
  assert.ok(def, "kb trigger def should be captured");
  // The captured def, re-normalised, equals the pg_get_triggerdef shape Postgres
  // would emit for the same trigger — so a fresh migrate produces no drift.
  const pgForm = normalizeTriggerDef(
    "CREATE TRIGGER kb_articles_search_vector_trigger BEFORE INSERT OR UPDATE ON kb_articles FOR EACH ROW EXECUTE FUNCTION kb_articles_update_search_vector()",
  );
  assert.equal(def, pgForm);
});
