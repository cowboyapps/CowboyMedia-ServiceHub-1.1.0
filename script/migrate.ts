// Standalone CLI entry point for the boot-time migrator. Used by
// `npm run db:migrate` to apply pending migrations BEFORE the column-drift
// audit runs in `prebuild`. Without this, every deploy that introduces a
// new column would fail closed: `audit-columns.ts` compares shared/schema.ts
// against the live DB, but migrations don't normally apply until the new
// app boots — so the gate sees the new columns as "missing" and exits 1
// before the new build is even handed to pm2.
//
// Safe to run repeatedly: drizzle's migrator is a no-op once every entry in
// migrations/meta/_journal.json is recorded in __drizzle_migrations.
import { runMigrations } from "../server/migrate";

await runMigrations();
process.exit(0);
