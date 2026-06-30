#!/bin/bash
set -e
npm install

# Reconcile the dev database after a merge by APPLYING THE COMMITTED MIGRATIONS,
# not by running `drizzle-kit push`.
#
# WHY (this fixes a recurring boot crash)
#   `drizzle-kit push` (scripts/db-sync.sh) applies shared/schema.ts straight to
#   the DB but does NOT record anything in the drizzle migration journal
#   (drizzle.__drizzle_migrations). So when a merged task added a new table, push
#   created the table here without journaling it, and the NEXT boot's migrator
#   (server/migrate.ts) replayed that migration's CREATE TABLE and crashed with
#   `relation "<table>" already exists` (42P07) — taking the whole app down until
#   the journal was reconciled by hand. This happened on two table-adding merges
#   in a row.
#
#   `npm run db:migrate` runs the same in-process migrator the app uses at boot
#   (script/migrate.ts -> runMigrations). It applies each pending committed
#   migration AND writes its journal row, so the journal stays in lockstep with
#   the DB and the next boot is a clean no-op. It is idempotent: when the journal
#   is already in sync it does nothing. This also matches how production (the VPS
#   deploy + prebuild's db:check) reconciles schema — committed migrations only,
#   never an out-of-band push.
npm run db:migrate
