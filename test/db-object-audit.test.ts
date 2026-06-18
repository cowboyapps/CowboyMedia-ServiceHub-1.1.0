import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KNOWN_UNDECLARED_CONSTRAINTS,
  KNOWN_UNDECLARED_FUNCTIONS,
  KNOWN_UNDECLARED_INDEXES,
  KNOWN_UNDECLARED_TRIGGERS,
  KNOWN_UNMANAGED_TABLES,
  diffDbObjects,
  diffObjectDefinitions,
  normalizeConstraintDef,
  normalizeFunctionBody,
  normalizeIndexDef,
  normalizeTriggerDef,
  parseMigrationConstraintDefs,
  parseMigrationDbObjects,
  parseMigrationFunctionBodies,
  parseMigrationIndexDefs,
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

// ---- Index drift ----------------------------------------------------------

test("normalizeIndexDef folds migration text and pg_get_indexdef equal (quotes, schema, IF NOT EXISTS)", () => {
  const migration = `CREATE INDEX IF NOT EXISTS "kb_articles_search_vector_idx" ON "kb_articles" USING gin ("search_vector");`;
  const pgForm = `CREATE INDEX kb_articles_search_vector_idx ON public.kb_articles USING gin (search_vector)`;
  assert.equal(normalizeIndexDef(migration), normalizeIndexDef(pgForm));
});

test("normalizeIndexDef folds multi-column DESC NULLS LAST equal across comma spacing", () => {
  const migration = `CREATE INDEX "tickets_status_created_at_idx" ON "tickets" USING btree ("status","created_at" DESC NULLS LAST);`;
  const pgForm = `CREATE INDEX tickets_status_created_at_idx ON public.tickets USING btree (status, created_at DESC NULLS LAST)`;
  assert.equal(normalizeIndexDef(migration), normalizeIndexDef(pgForm));
});

test("normalizeIndexDef folds a partial index's WHERE clause (table-qualified vs parenthesised)", () => {
  // drizzle emits table-qualified, unparenthesised predicates; pg_get_indexdef
  // emits bare, parenthesised columns. Both must normalise equal.
  const migration = `CREATE INDEX "report_notifications_user_id_unread_idx" ON "report_notifications" USING btree ("user_id") WHERE "report_notifications"."read_at" IS NULL;`;
  const pgForm = `CREATE INDEX report_notifications_user_id_unread_idx ON public.report_notifications USING btree (user_id) WHERE (read_at IS NULL)`;
  assert.equal(normalizeIndexDef(migration), normalizeIndexDef(pgForm));
});

test("normalizeIndexDef folds a multi-predicate partial index equal", () => {
  const migration = `CREATE INDEX "user_notifications_user_id_unread_idx" ON "user_notifications" USING btree ("user_id") WHERE "user_notifications"."read_at" IS NULL AND "user_notifications"."dismissed_at" IS NULL;`;
  const pgForm = `CREATE INDEX user_notifications_user_id_unread_idx ON public.user_notifications USING btree (user_id) WHERE ((read_at IS NULL) AND (dismissed_at IS NULL))`;
  assert.equal(normalizeIndexDef(migration), normalizeIndexDef(pgForm));
});

test("normalizeIndexDef still differs for a genuinely changed column/opclass", () => {
  const a = normalizeIndexDef(`CREATE INDEX i ON "t" USING btree ("a")`);
  const b = normalizeIndexDef(`CREATE INDEX i ON public.t USING btree (b)`);
  assert.notEqual(a, b);
  const gin = normalizeIndexDef(`CREATE INDEX i ON "t" USING gin ("a")`);
  const btree = normalizeIndexDef(`CREATE INDEX i ON public.t USING btree (a)`);
  assert.notEqual(gin, btree);
});

test("parseMigrationIndexDefs captures CREATE INDEX and CREATE UNIQUE INDEX names", () => {
  const sql = `
    CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");
    CREATE UNIQUE INDEX "users_whmcs_client_id_idx" ON "users" USING btree ("whmcs_client_id");
  `;
  const defs = parseMigrationIndexDefs([sql]);
  assert.deepEqual(
    [...defs.keys()].sort(),
    ["tickets_status_idx", "users_whmcs_client_id_idx"],
  );
});

test("parseMigrationIndexDefs: DROP INDEX nets out the index (textual order)", () => {
  const earlier = `CREATE INDEX foo ON "t" USING btree ("a");`;
  const later = `DROP INDEX foo;`;
  const defs = parseMigrationIndexDefs([earlier, later]);
  assert.equal(defs.has("foo"), false);
});

test("parseMigrationIndexDefs: DROP + recreate with new columns keeps the new def", () => {
  // Mirrors 0010: drop tickets_status_idx + tickets_created_at_idx, create a
  // combined tickets_status_created_at_idx.
  const original = `
    CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");
    CREATE INDEX "tickets_created_at_idx" ON "tickets" USING btree ("created_at" DESC NULLS LAST);
  `;
  const later = `
    DROP INDEX "tickets_status_idx";
    DROP INDEX "tickets_created_at_idx";
    CREATE INDEX "tickets_status_created_at_idx" ON "tickets" USING btree ("status","created_at" DESC NULLS LAST);
  `;
  const defs = parseMigrationIndexDefs([original, later]);
  assert.deepEqual([...defs.keys()], ["tickets_status_created_at_idx"]);
});

test("session store index is present in the index allowlist", () => {
  assert.ok(KNOWN_UNDECLARED_INDEXES.has("IDX_session_expire"));
});

test("prod-only legacy indexes are allowlisted so the deploy gate passes", () => {
  // These pre-drizzle indexes exist only on production (created by
  // migrations/legacy/ + db:push, never by a committed migration). Without the
  // allowlist the constraint/index audit flags every one as out-of-band and
  // fails the deploy gate. See KNOWN_UNDECLARED_INDEXES for the full rationale.
  for (const name of [
    "idx_monitor_incidents_monitor_id",
    "idx_thread_messages_thread_id",
    "idx_user_notifications_user_created",
    "idx_user_notifications_user_unread",
    "idx_news_reactions_story_id",
    "idx_password_reset_tokens_expires_at",
    "idx_password_reset_tokens_user_id",
    "idx_service_subscribers_email_service",
    "idx_service_subscribers_service",
    "poll_options_poll_idx",
    "poll_votes_single_choice_uq",
    "poll_votes_user_idx",
    "polls_parent_idx",
    "uq_news_reactions_story_user_emoji",
    "error_logs_created_at_idx",
    "error_logs_resolved_idx",
    "idx_announcement_dismissals_user",
    "idx_announcements_active_created_at",
    "idx_kb_articles_category",
    "idx_kb_articles_published",
    "idx_kb_articles_search",
    "idx_message_threads_admin_id",
    "idx_message_threads_customer_id",
  ]) {
    assert.ok(
      KNOWN_UNDECLARED_INDEXES.has(name),
      `${name} must stay allowlisted or the prod deploy gate breaks`,
    );
  }
});

test("index allowlist suppresses extra-in-DB findings only", () => {
  const diff = diffDbObjects(
    new Set(["users_role_idx"]),
    new Set(["users_role_idx", "IDX_session_expire"]),
    KNOWN_UNDECLARED_INDEXES,
  );
  assert.deepEqual(diff.extra, []);
  assert.deepEqual(diff.missing, []);
});

test("0026 GIN index parses to a def matching its pg_get_indexdef form", () => {
  const sql = readFileSync(
    join(process.cwd(), "migrations", "0026_kb_search_vector.sql"),
    "utf-8",
  );
  const defs = parseMigrationIndexDefs([sql]);
  const def = defs.get("kb_articles_search_vector_idx");
  assert.ok(def, "kb GIN index def should be captured");
  const pgForm = normalizeIndexDef(
    "CREATE INDEX kb_articles_search_vector_idx ON public.kb_articles USING gin (search_vector)",
  );
  assert.equal(def, pgForm);
});

// ---- Constraint drift -----------------------------------------------------

test("normalizeConstraintDef folds inline UNIQUE migration text and pg_get_constraintdef equal", () => {
  const migration = `UNIQUE("name")`;
  const pgForm = `UNIQUE (name)`;
  assert.equal(normalizeConstraintDef(migration), normalizeConstraintDef(pgForm));
});

test("normalizeConstraintDef folds a composite UNIQUE equal across comma spacing", () => {
  const migration = `UNIQUE("user_id","whmcs_ticket_id")`;
  const pgForm = `UNIQUE (user_id, whmcs_ticket_id)`;
  assert.equal(normalizeConstraintDef(migration), normalizeConstraintDef(pgForm));
});

test("normalizeConstraintDef folds an FK with ON DELETE CASCADE equal (quotes, schema, default ON UPDATE)", () => {
  // drizzle spells out `ON UPDATE no action` (the default) and schema-qualifies
  // the referenced table; pg_get_constraintdef hides the default and drops the
  // public. prefix. Both must normalise equal.
  const migration = `FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action`;
  const pgForm = `FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE`;
  assert.equal(normalizeConstraintDef(migration), normalizeConstraintDef(pgForm));
});

test("normalizeConstraintDef folds an FK with ON DELETE SET NULL equal", () => {
  const migration = `FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action`;
  const pgForm = `FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL`;
  assert.equal(normalizeConstraintDef(migration), normalizeConstraintDef(pgForm));
});

test("normalizeConstraintDef folds a fully-default FK equal (both ON clauses omitted by pg)", () => {
  const migration = `FOREIGN KEY ("a") REFERENCES "public"."t"("id") ON DELETE no action ON UPDATE no action`;
  const pgForm = `FOREIGN KEY (a) REFERENCES t(id)`;
  assert.equal(normalizeConstraintDef(migration), normalizeConstraintDef(pgForm));
});

test("normalizeConstraintDef strips a trailing comma left by a non-last inline constraint", () => {
  const withComma = `UNIQUE("email"),`;
  const without = `UNIQUE("email")`;
  assert.equal(normalizeConstraintDef(withComma), normalizeConstraintDef(without));
});

test("normalizeConstraintDef still differs for a loosened ON DELETE rule", () => {
  const cascade = normalizeConstraintDef(
    `FOREIGN KEY ("a") REFERENCES "public"."t"("id") ON DELETE cascade ON UPDATE no action`,
  );
  const setNull = normalizeConstraintDef(
    `FOREIGN KEY (a) REFERENCES t(id) ON DELETE SET NULL`,
  );
  assert.notEqual(cascade, setNull);
});

test("normalizeConstraintDef still differs for a changed UNIQUE column", () => {
  const a = normalizeConstraintDef(`UNIQUE("email")`);
  const b = normalizeConstraintDef(`UNIQUE (username)`);
  assert.notEqual(a, b);
});

test("parseMigrationConstraintDefs captures inline UNIQUE and ALTER ADD FOREIGN KEY", () => {
  const createTable = `
    CREATE TABLE "admin_roles" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    CONSTRAINT "admin_roles_name_unique" UNIQUE("name")
    );
  `;
  const alter = `ALTER TABLE "changelog_entries" ADD CONSTRAINT "changelog_entries_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;`;
  const defs = parseMigrationConstraintDefs([createTable, alter]);
  assert.deepEqual(
    [...defs.keys()].sort(),
    [
      "admin_roles_name_unique",
      "changelog_entries_published_by_users_id_fk",
    ],
  );
});

test("parseMigrationConstraintDefs skips PRIMARY KEY constraints (covered by column audit)", () => {
  const sql = `
    CREATE TABLE "alert_services" (
    "alert_id" varchar NOT NULL,
    "service_id" varchar NOT NULL,
    CONSTRAINT "alert_services_alert_id_service_id_pk" PRIMARY KEY("alert_id","service_id")
    );
  `;
  const defs = parseMigrationConstraintDefs([sql]);
  assert.equal(defs.has("alert_services_alert_id_service_id_pk"), false);
  assert.equal(defs.size, 0);
});

test("parseMigrationConstraintDefs: DROP CONSTRAINT nets out the constraint (textual order)", () => {
  const earlier = `ALTER TABLE "t" ADD CONSTRAINT "t_a_unique" UNIQUE("a");`;
  const later = `ALTER TABLE "t" DROP CONSTRAINT "t_a_unique";`;
  const defs = parseMigrationConstraintDefs([earlier, later]);
  assert.equal(defs.has("t_a_unique"), false);
});

test("parseMigrationConstraintDefs: DROP + re-ADD with a new rule keeps the new def", () => {
  const original = `ALTER TABLE "t" ADD CONSTRAINT "t_a_fk" FOREIGN KEY ("a") REFERENCES "public"."u"("id") ON DELETE cascade ON UPDATE no action;`;
  const later = `
    ALTER TABLE "t" DROP CONSTRAINT "t_a_fk";
    ALTER TABLE "t" ADD CONSTRAINT "t_a_fk" FOREIGN KEY ("a") REFERENCES "public"."u"("id") ON DELETE set null ON UPDATE no action;
  `;
  const defs = parseMigrationConstraintDefs([original, later]);
  assert.equal(
    defs.get("t_a_fk"),
    normalizeConstraintDef(`FOREIGN KEY (a) REFERENCES u(id) ON DELETE SET NULL`),
  );
});

test("constraint allowlist holds only the unmanaged prod composite and suppresses extra-in-DB findings", () => {
  // Exactly one intentional exception: the prod-only composite UNIQUE on
  // hidden_service_updates, which no migration creates and schema.ts doesn't
  // model (see KNOWN_UNDECLARED_CONSTRAINTS in shared/db-object-audit.ts).
  assert.deepEqual(
    [...KNOWN_UNDECLARED_CONSTRAINTS],
    ["hidden_service_updates_user_id_service_update_id_key"],
  );
  const diff = diffDbObjects(
    new Set(["users_username_unique"]),
    new Set(["users_username_unique", "rogue_constraint"]),
    new Set(["rogue_constraint"]),
  );
  assert.deepEqual(diff.extra, []);
  assert.deepEqual(diff.missing, []);
});

test("baseline + later migrations parse to constraint defs matching their pg_get_constraintdef form", () => {
  const migrationsDir = join(process.cwd(), "migrations");
  const baseline = readFileSync(
    join(migrationsDir, "0000_baseline.sql"),
    "utf-8",
  );
  const fk = readFileSync(
    join(migrationsDir, "0016_lyrical_stryfe.sql"),
    "utf-8",
  );
  const defs = parseMigrationConstraintDefs([baseline, fk]);

  const unique = defs.get("users_username_unique");
  assert.ok(unique, "users_username_unique should be captured");
  assert.equal(unique, normalizeConstraintDef("UNIQUE (username)"));

  const fkDef = defs.get("whmcs_product_mappings_service_id_services_id_fk");
  assert.ok(fkDef, "the whmcs FK should be captured");
  assert.equal(
    fkDef,
    normalizeConstraintDef(
      "FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE",
    ),
  );

  // PRIMARY KEY constraints in the baseline are not parsed (contype excluded).
  assert.equal(defs.has("poll_votes_poll_id_option_id_user_id_pk"), false);
});
