import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for drizzle-kit (db:check, db:generate, prebuild). In deploy scripts, source $ENV_FILE before running `npm run build` (set -a && . $ENV_FILE && set +a). DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // `session` is owned by connect-pg-simple (express-session) and is
  // intentionally not declared in shared/schema.ts. Excluding it keeps
  // `drizzle-kit push` from prompting "is X a rename of session?",
  // which would hang non-interactive runs (post-merge, deploy startup).
  tablesFilter: ["!session"],
});
