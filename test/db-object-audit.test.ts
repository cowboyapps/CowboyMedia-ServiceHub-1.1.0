import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KNOWN_UNDECLARED_FUNCTIONS,
  KNOWN_UNDECLARED_TRIGGERS,
  KNOWN_UNMANAGED_TABLES,
  diffDbObjects,
  parseMigrationDbObjects,
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
