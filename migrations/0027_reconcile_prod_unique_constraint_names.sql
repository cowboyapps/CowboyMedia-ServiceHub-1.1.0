-- Custom SQL migration file, put your code below! --

-- Reconcile legacy UNIQUE constraint NAMES on production.
--
-- These tables predate the drizzle baseline; their tables were originally
-- created with bare inline `UNIQUE`, so Postgres auto-named the constraints
-- `<table>_<col>_key`. The drizzle baseline (and every fresh/dev DB built from
-- migrations) instead names them `<table>_<col>_unique`. The constraints are
-- logically identical (same table, same column, UNIQUE) — only the NAME drifts.
--
-- The prebuild constraint-drift audit (script/audit-columns.ts) compares by
-- name, so on prod the `_key` names show up as OUT-OF-BAND while the migration's
-- `_unique` names show up as MISSING, failing the deploy gate even though the
-- guarantees are intact.
--
-- This rename brings prod's names in line with the migrations. It is fully
-- idempotent and catalog-driven: the table name is read from pg_constraint (no
-- hardcoding), only constraints that actually exist AND are still named `_key`
-- are touched, and the loop body runs zero times on any DB that already has the
-- `_unique` names (dev / fresh / re-run). PRIMARY KEYs and the unmanaged
-- composite hidden_service_updates_..._key (allowlisted in db-object-audit.ts)
-- are deliberately excluded.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname AS old_name,
           rel.relname AS tbl,
           regexp_replace(con.conname, '_key$', '_unique') AS new_name
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE con.contype = 'u'
       AND con.conname IN (
         'admin_roles_name_key',
         'chat_word_filters_word_key',
         'email_templates_template_key_key',
         'kb_articles_slug_key',
         'kb_categories_slug_key',
         'password_reset_tokens_token_hash_key',
         'public_status_subscribers_email_key',
         'public_status_subscribers_unsubscribe_token_key',
         'service_subscribers_unsubscribe_token_key',
         'ticket_categories_name_key',
         'uploaded_files_filename_key'
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint existing
          WHERE existing.conrelid = con.conrelid
            AND existing.conname = regexp_replace(con.conname, '_key$', '_unique')
       )
  LOOP
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.tbl, r.old_name, r.new_name);
  END LOOP;
END $$;
