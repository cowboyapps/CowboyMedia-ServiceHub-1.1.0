#!/bin/bash
# Apply the current shared/schema.ts to the database non-interactively.
#
# WHY THIS EXISTS
#   `drizzle-kit push` is interactive. Without intervention it can stall
#   on prompts like "is X a rename of Y?" or "truncate to add this
#   constraint?". Without a tty those prompts hang forever and abort
#   the whole run, leaving every other column add unapplied — that's
#   how dev DB drifted on totp_secret, totp_enabled_at, and
#   discord_webhook_url despite scripts/post-merge.sh "running".
#
# HOW WE MAKE IT NON-INTERACTIVE
#   1. drizzle.config.ts excludes `session` (owned by connect-pg-simple,
#      not declared in shared/schema.ts) so drizzle has no unknown
#      table to ask rename questions about.
#   2. `--force` auto-approves data-loss statements that would
#      otherwise prompt for confirmation.
#
# TRADEOFF
#   `--force` will TRUNCATE a table or DROP a column without asking if
#   a schema change requires it. Treat schema changes as deploy-gating:
#   review every column removal / type change before merging. For
#   purely additive changes (new tables, new nullable columns) there
#   is no risk.
#
# WHERE THIS RUNS
#   - the .replit deploy build step (`build = [... "bash scripts/db-sync.sh"]`),
#     once per Replit deployment build.
#
#   NOTE: scripts/post-merge.sh deliberately does NOT call this anymore. A bare
#   `drizzle-kit push` applies the schema WITHOUT recording the drizzle migration
#   journal (drizzle.__drizzle_migrations), so a new table created here strands
#   the journal and the next boot's migrator (server/migrate.ts) replays its
#   CREATE TABLE and crashes with `relation already exists` (42P07). Post-merge
#   now runs the journaling migrator (`npm run db:migrate`) instead. The VPS
#   production deploy (deploy/update.sh) does not use this script either — it
#   relies on the in-process migrator at boot plus prebuild's db:check.

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "scripts/db-sync.sh: DATABASE_URL is not set; refusing to run." >&2
  echo "  This script must be invoked with the target database's" >&2
  echo "  connection string in DATABASE_URL." >&2
  exit 1
fi

npx --yes drizzle-kit push --force
