#!/usr/bin/env bash
# Pull, build, push schema, reload PM2. Zero downtime via `pm2 reload`.
#
# Usage:
#   sudo bash update.sh                # deploy origin/main
#   sudo bash update.sh --ref <sha>    # deploy specific commit (hotfix)
#
# Behaviour:
#   - Takes a pre-update DB snapshot to /var/backups/servicehub/pre-update-<ts>.dump
#   - Fails loudly (no destructive prompts answered "y") if drizzle wants to drop columns
#   - On post-update health check failure: rolls back code + restores snapshot
#
# IMPORTANT — why the entire body is wrapped in `{ ... } && exit`:
#
# This script does `git reset --hard $NEW_SHA` partway through, which
# atomically replaces /opt/servicehub/deploy/update.sh on disk with the
# version from the new commit. WITHOUT this brace wrap, bash holds an
# open file descriptor to the OLD inode (now unlinked but kept alive by
# the FD) and continues reading the pre-deploy script content from there
# — so any edits to update.sh in the new commit DON'T TAKE EFFECT until
# the NEXT deploy, AND if the new commit's gates would have passed but
# the old commit's gates would have failed, you get a permanent
# stuck-loop (rollback resets disk back to the old version, next deploy
# fails the same way, forever).
#
# Wrapping the executable body in a `{ ... }` compound command forces
# bash to read all the way to the matching `}` before executing line 1,
# slurping the entire script into the in-memory AST. After that, on-disk
# changes to update.sh are irrelevant for the current execution — but
# they DO land on disk in time for the NEXT deploy.
#
# Lost a deploy to this on 20-May-2026. Don't unwrap it.
{
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must be run as root (try: sudo bash $0)"
  exit 1
fi

REF=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

APP_USER=servicehub
APP_DIR=/opt/servicehub
ENV_FILE="$APP_DIR/.env"
BACKUP_DIR=/var/backups/servicehub
TS="$(date -u +%Y%m%d-%H%M%S)"
SNAPSHOT="$BACKUP_DIR/pre-update-$TS.dump"

# ----------------------------------------------------------------------------
# Single source of truth for `npm ci && npm run build` as the app user.
#
# Called 4x (primary deploy + 3 rollback paths). Task #218 had to fix three
# of these at once because they had silently drifted out of sync with the
# primary path — the NODE_ENV=test override was added to the primary but
# missed on the rollbacks, turning recoverable rollbacks into hard deploy
# failures. Task #219 extracted the helper so the next env tweak (a new
# override, a different bash flag, an extra step) only has to land in one
# place.
#
# NODE_ENV override rationale: $ENV_FILE sets NODE_ENV=production, which
# would (a) make the chained `npm test` load React's production build and
# crash on `act() is not supported in production builds of React`, and (b)
# make any future `npm install` fall back to --omit=dev. Override it back
# to `test` JUST for `npm run build` — the production runtime constant is
# baked into dist/ by esbuild's define in script/build.ts, independent of
# this var.
#
# Install-integrity gate (Task #338): npm 10.8.2 on the VPS intermittently
# hits the `Exit handler never called!` bug and produces an INCOMPLETE
# node_modules — e.g. the `eslint` binary never gets linked into
# node_modules/.bin. The deploy then walked into `npm run build` (whose
# first gate is `npm run lint`) and died with a cryptic `exit 127 /
# sh: 1: eslint: not found` AFTER the snapshot but before any useful error.
# So after `npm ci` we verify every CLI the prebuild/build chain shells out
# to (eslint, tsc, tsx, drizzle-kit, vite, esbuild) is actually present. A
# failed `npm ci`, the `Exit handler never called!` signature, OR a missing
# binary all trigger a single clean-slate recovery (cache clean + rm
# node_modules + re-`npm ci`). If the integrity check STILL fails we abort
# loudly — naming the missing tool — BEFORE the build/PM2 are touched, so
# the Discord post and per-delivery log show the real cause. The cache
# clean runs in the app user's `-H` context so it targets
# /home/servicehub/.npm, not root's cache.
# ----------------------------------------------------------------------------
# Body is a single-quoted heredoc (no outer expansion / escaping) piped to a
# login shell via `bash -l -s`; $APP_DIR and $ENV_FILE are passed as positional
# args so the inner script stays free of fragile backslash-escaping.
run_build_as_app_user() {
  sudo -u "$APP_USER" -H bash -l -s -- "$APP_DIR" "$ENV_FILE" <<'INNER'
set -euo pipefail
APP_DIR="$1"
ENV_FILE="$2"
cd "$APP_DIR"

# CLIs the prebuild/build chain shells out to. A clean `npm ci` always links
# these into node_modules/.bin; a missing one == an incomplete install.
REQUIRED_BINS='eslint tsc tsx drizzle-kit vite esbuild'

missing_bins() {
  local b m=''
  for b in $REQUIRED_BINS; do
    [[ -x node_modules/.bin/$b ]] || m="${m:+$m, }$b"
  done
  printf '%s' "$m"
}

# Non-zero on a failed `npm ci` OR the npm 10.8.2 'Exit handler never called!'
# signature (which can exit 0 yet leave an incomplete node_modules).
npm_ci_verified() {
  local log
  log="$(mktemp)"
  if ! npm ci 2>&1 | tee "$log"; then
    rm -f "$log"; return 1
  fi
  if grep -q 'Exit handler never called' "$log"; then
    rm -f "$log"; return 1
  fi
  rm -f "$log"; return 0
}

if npm_ci_verified && [[ -z "$(missing_bins)" ]]; then
  : # clean install, proceed straight to build
else
  echo '==> npm ci produced an incomplete node_modules; retrying once with a clean cache...'
  npm cache clean --force || true
  rm -rf node_modules
  npm_ci_verified || true
  miss="$(missing_bins)"
  if [[ -n "$miss" ]]; then
    echo "FATAL: npm ci produced an incomplete node_modules: $miss binary missing (aborting before build)" >&2
    exit 1
  fi
fi

set -a && . "$ENV_FILE" && set +a && NODE_ENV=test npm run build
INNER
}

# ----------------------------------------------------------------------------
# /home/$APP_USER permission self-heal (run FIRST, before any `bash -lc`).
#
# Every recurring deploy failure of the form `EACCES on /home/servicehub/.npm`
# or `bash: /home/servicehub/.bash_profile: Permission denied` traces back to
# files in the app user's home directory ending up root-owned — typically
# because someone ran `npm` or `pm2` as bare root during a manual recovery,
# or a forgotten cron/systemd-unit invokes a node tool as root. The previous
# version of this script self-healed only `~/.npm`, and only AFTER pg_dump
# and `git fetch` had already run a login shell as the app user (which is
# what surfaces the `.bash_profile: Permission denied` warning).
#
# We now run the self-heal as the very first action AFTER arg parsing and
# BEFORE any `sudo -u $APP_USER -H bash -lc ...`, so a bad dotfile can't
# poison the login shell and a bad npm cache can't trip up a future
# `npm ci`. We also widen the scope from `~/.npm` to the entire home dir,
# since the offender list now includes `.bash_profile`, `.bashrc`, and
# `.npmrc`.
# ----------------------------------------------------------------------------
HOME_DIR="/home/$APP_USER"
echo "==> Self-heal: ensuring $APP_USER owns everything under $HOME_DIR..."
# Belt-and-braces: never silently skip the self-heal based on a single
# shell test. The previous version used `if [[ -d "$HOME_DIR" ]]; then ...
# else WARN; fi`, which produced a fatal-looking-but-non-fatal `WARN:
# /home/servicehub does not exist; skipping self-heal` in a real outage
# (May 2026) where `[[ -d ]]` returned false even though the directory
# clearly existed (a later `bash -lc` successfully sourced .bash_profile
# from inside it). Most likely culprits for that false-negative: the home
# is a symlink to a momentarily-unreachable mount, SELinux/AppArmor
# scoping, or a transient stat() error. Either way, the self-heal MUST
# NOT bail out silently on a stale `-d` reading and let `npm ci` walk
# straight into the EACCES wall it was meant to prevent.
#
# The new logic: (1) mkdir -p the home dir (idempotent — no-op if it's
# really there, recreates it if it's not), (2) always run the offender
# scan + chown, (3) treat ANY error from chown as fatal so on-call sees
# a loud failure with the actual stat()/chown error instead of a
# whitewashed "skipped" line.
mkdir -p "$HOME_DIR"
# If mkdir -p succeeded but the path STILL isn't a directory from a real
# stat() (broken symlink, dangling mount), abort loudly. ls -ld surfaces
# the underlying error from the kernel verbatim.
if ! ls -ld "$HOME_DIR" >/dev/null 2>&1; then
  echo "ERROR: $HOME_DIR is not stat-able after mkdir -p."
  echo "       ls -ld output:"
  ls -ld "$HOME_DIR" 2>&1 | sed 's/^/         /'
  echo "       PM2 was NOT touched. Investigate (broken symlink? dangling mount? SELinux?)."
  exit 1
fi
# Count + show the first few offenders so the deploy log captures what
# was wrong (silent self-heal makes future incidents harder to debug).
OFFENDERS_FILE="$(mktemp)"
find "$HOME_DIR" -not -user "$APP_USER" -printf '%u %p\n' > "$OFFENDERS_FILE" 2>/dev/null || true
OFFENDER_COUNT="$(wc -l < "$OFFENDERS_FILE" | tr -d ' ')"
if [[ "$OFFENDER_COUNT" -gt 0 ]]; then
  echo "    found $OFFENDER_COUNT non-$APP_USER-owned path(s); first 5:"
  head -n 5 "$OFFENDERS_FILE" | sed 's/^/      /'
  echo "    chowning $HOME_DIR -R to $APP_USER:$APP_USER..."
  if ! chown -R "$APP_USER:$APP_USER" "$HOME_DIR"; then
    echo "ERROR: chown -R $APP_USER:$APP_USER $HOME_DIR returned non-zero."
    echo "       PM2 was NOT touched. Investigate (immutable attr? bad mount? SELinux?)."
    rm -f "$OFFENDERS_FILE"
    exit 1
  fi
  # Pre-flight assertion: even if chown returned 0, verify nothing slipped
  # through (a partial walk, a hidden filesystem boundary, etc).
  REMAINING="$(find "$HOME_DIR" -not -user "$APP_USER" -print -quit 2>/dev/null || true)"
  if [[ -n "$REMAINING" ]]; then
    echo "ERROR: chown -R $APP_USER:$APP_USER $HOME_DIR did not stick."
    echo "       still non-$APP_USER-owned: $REMAINING"
    echo "       PM2 was NOT touched. Investigate (immutable attr? bad mount? SELinux?)."
    rm -f "$OFFENDERS_FILE"
    exit 1
  fi
else
  echo "    OK — all paths already owned by $APP_USER."
fi
# Belt-and-braces #2: explicitly chown the home dir itself + the two
# dotfiles that have caused real outages, even when no offender was
# found. Cheap insurance against a `find` that walks past a hidden
# mount and reports "clean" while a root-owned .bash_profile sits at
# the top level on a different filesystem.
chown "$APP_USER:$APP_USER" "$HOME_DIR" 2>/dev/null || true
for f in "$HOME_DIR/.bash_profile" "$HOME_DIR/.bashrc" "$HOME_DIR/.npmrc" "$HOME_DIR/.profile"; do
  [[ -e "$f" ]] && chown "$APP_USER:$APP_USER" "$f" 2>/dev/null || true
done
rm -f "$OFFENDERS_FILE"

PREV_SHA="$(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse HEAD)"

echo "==> Pre-update DB snapshot -> $SNAPSHOT"
mkdir -p "$BACKUP_DIR"
sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
  pg_dump --format=custom --no-owner --no-acl --clean --if-exists \
    --dbname=\"\$DATABASE_URL\" --file=\"$SNAPSHOT\""

# ----------------------------------------------------------------------------
# Self-heal #2: .git object-store ownership.
#
# Symmetric to the $HOME_DIR self-heal above, but for $APP_DIR/.git. A
# root-run git operation anywhere in $APP_DIR (e.g. a manual `sudo git
# pull` during recovery, a forgotten cron that runs `git fsck` as root,
# or even a `sudo bash update.sh` with FORCE_DEPLOY=1 that hits an old
# rollback path) can leave root-owned blobs/packs under .git/objects/.
# The next `sudo -u servicehub git fetch` then dies with:
#   error: insufficient permission for adding an object to repository
#   database .git/objects
#   fatal: failed to write object
#   fatal: unpack-objects failed
# and the deploy aborts BEFORE reaching the snapshot, so there's nothing
# to roll back to — just a stuck deploy until someone SSHes in and
# chowns by hand. Lost a deploy to this on 20-May-2026.
#
# Scope is intentionally $APP_DIR/.git only (not the whole $APP_DIR) to
# keep the chown cheap: the rest of $APP_DIR is owned correctly already
# (npm ci, vite build, etc. all run as $APP_USER), and a recursive
# chown on the full tree would walk through node_modules/ for no reason.
# ----------------------------------------------------------------------------
if [[ -d "$APP_DIR/.git" ]]; then
  GIT_OFFENDER="$(find "$APP_DIR/.git" -not -user "$APP_USER" -print -quit 2>/dev/null || true)"
  if [[ -n "$GIT_OFFENDER" ]]; then
    echo "==> Self-heal: chowning $APP_DIR/.git to $APP_USER (found root-owned: $GIT_OFFENDER)..."
    if ! chown -R "$APP_USER:$APP_USER" "$APP_DIR/.git"; then
      echo "ERROR: chown -R $APP_USER:$APP_USER $APP_DIR/.git returned non-zero."
      echo "       git fetch would fail. PM2 was NOT touched. Investigate."
      exit 1
    fi
  fi
fi

echo "==> Fetching latest..."
sudo -u "$APP_USER" git -C "$APP_DIR" fetch --all --tags --prune

TARGET="${REF:-origin/main}"
echo "==> Checking out $TARGET (was $PREV_SHA)..."
TARGET_SHA="$(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse "$TARGET")"
sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "$TARGET"
NEW_SHA="$(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse HEAD)"

# HEAD-moved assertion. Catches the failure mode behind today's outage:
# `git reset --hard` ran, exited 0, but the working tree HEAD never advanced
# (silent fetch failure earlier had left origin/main itself stale, or a
# disk/perms quirk left HEAD pinned). Without this check, the rest of the
# script keeps going and pm2 reload happily reloads the same old build.
if [[ "$NEW_SHA" != "$TARGET_SHA" ]]; then
  echo "ERROR: git HEAD did not move to expected SHA after reset."
  echo "       expected: $TARGET_SHA"
  echo "       actual:   $NEW_SHA"
  echo "       PM2 was NOT touched. Investigate the working tree on disk."
  exit 1
fi

if [[ "$PREV_SHA" == "$NEW_SHA" ]]; then
  # Working tree is already at NEW_SHA — but that DOESN'T mean PM2 is
  # serving NEW_SHA. A previous deploy can advance HEAD via `git reset
  # --hard` and then fail before `pm2 reload` (e.g. the May 2026 perm-
  # drift outage: HEAD moved to cce46be, npm ci EACCES'd, script exited,
  # PM2 still serving the old build). The next deploy attempt would then
  # see "Already at SHA" and exit without ever reloading — leaving prod
  # stuck on the old build forever.
  #
  # Cross-check against the running app's /api/health.gitSha. If PM2 is
  # already on NEW_SHA, we're truly done. If not, fall through and run
  # the full pipeline so build artifacts + PM2 catch up. FORCE_DEPLOY=1
  # always falls through.
  RUNNING_SHA="$(curl -fsS http://127.0.0.1:5000/api/health 2>/dev/null \
    | sed -nE 's/.*"gitSha":"([^"]+)".*/\1/p')"
  if [[ "$RUNNING_SHA" == "$NEW_SHA" && "${FORCE_DEPLOY:-0}" != "1" ]]; then
    echo "==> Already at $NEW_SHA (working tree + PM2). Nothing to do."
    exit 0
  fi
  echo "==> Working tree at $NEW_SHA but PM2 reports gitSha=${RUNNING_SHA:-<unknown>}."
  echo "    Continuing with full build + reload to bring PM2 in sync."
fi

# Sanity check before we keep going: the running app's APP_VERSION is what
# /api/health will report after restart, and we'll assert it matches the
# version baked into the just-checked-out shared/version.ts. Capture it now.
NEW_APP_VERSION="$(grep -E 'APP_VERSION\s*=' "$APP_DIR/shared/version.ts" \
  | head -n1 | sed -E 's/.*=\s*"([^"]+)".*/\1/')"
if [[ -z "$NEW_APP_VERSION" ]]; then
  echo "ERROR: could not parse APP_VERSION from $APP_DIR/shared/version.ts."
  echo "       Refusing to deploy without a known target version. Aborting."
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "$PREV_SHA"
  exit 1
fi
echo "    target version: $NEW_APP_VERSION (sha $NEW_SHA)"

echo "==> Schema column drift check (table-aware additive columns between $PREV_SHA and $NEW_SHA)..."
# For every new (table, column) pair declared in shared/schema.ts between
# PREV_SHA and NEW_SHA, verify the column actually exists ON THE RIGHT TABLE
# in the live DB after the in-process drizzle migrator runs at startup.
# Catches the failure mode where a migration silently failed to land the
# column (the original "is_internal column does not exist" outage). Pure
# additive — only ADDITIONS are checked.
#
# Strategy: walk shared/schema.ts at each SHA tracking the enclosing
# pgTable("<sql_name>", { ... }) block, emit "<table>:<column>" pairs,
# then take the set difference. Far more reliable than diffing raw lines:
# moving a column between tables, reordering, or whitespace changes don't
# create false positives, and a missing column on table A doesn't pass just
# because the same column name exists on table B.
NEW_COLUMNS_FILE="$(mktemp)"
PREV_PAIRS="$(mktemp)"
NEW_PAIRS="$(mktemp)"
trap 'rm -f "$NEW_COLUMNS_FILE" "$PREV_PAIRS" "$NEW_PAIRS"' EXIT

extract_table_columns() {
  local sha="$1"
  sudo -u "$APP_USER" git -C "$APP_DIR" show "$sha:shared/schema.ts" 2>/dev/null | awk '
    {
      line = $0
      # Track the enclosing table when we see pgTable("<name>",
      tmp = line
      if (match(tmp, /pgTable\("[a-zA-Z0-9_]+"/)) {
        s = substr(tmp, RSTART, RLENGTH)
        sub(/.*pgTable\("/, "", s)
        sub(/"$/, "", s)
        current = s
      }
      # Top-level }); ends the current table block
      if (match(line, /^\}\)/)) current = ""
      # Drizzle column: <ident>: <type>("<sql_name>")
      if (current != "" && match(line, /(text|varchar|boolean|integer|timestamp|jsonb|uuid|serial|numeric|date|bigint|smallint|real|doublePrecision)\("[a-zA-Z0-9_]+"/)) {
        col = substr(line, RSTART, RLENGTH)
        sub(/.*\("/, "", col)
        sub(/"$/, "", col)
        print current ":" col
      }
    }
  ' | sort -u
}

extract_table_columns "$PREV_SHA" > "$PREV_PAIRS"
extract_table_columns "$NEW_SHA"  > "$NEW_PAIRS"
# Pairs present in NEW but not in PREV = additive new columns to verify.
comm -13 "$PREV_PAIRS" "$NEW_PAIRS" > "$NEW_COLUMNS_FILE"
NEW_COL_COUNT="$(wc -l < "$NEW_COLUMNS_FILE" | tr -d ' ')"
echo "    detected $NEW_COL_COUNT new (table:column) pair(s) in schema diff"
if [[ "$NEW_COL_COUNT" -gt 0 ]]; then
  sed 's/^/      + /' "$NEW_COLUMNS_FILE"
fi

echo "==> npm ci && npm run build (prebuild runs db:check for schema/migration drift)..."
# `npm run build` chains prebuild → `npm run db:check && npm test`, so a
# committed schema change without a matching migration file fails the build
# here before PM2 is ever touched. The legacy db:push schema-push gates
# (4 + 5 in the runbook) are gone — drizzle-orm's in-process migrator runs
# at server boot, inside a transaction, and aborts startup on failure. The
# downstream /api/health gate (6) and table-aware column-drift check (7)
# below still confirm the migrations actually landed on prod.
#
# See run_build_as_app_user() near the top for the NODE_ENV override
# rationale and the single source of truth for this invocation.
run_build_as_app_user

echo "==> Reloading PM2 (zero downtime — migrator runs at startup before serving traffic)..."
# Source $ENV_FILE so --update-env actually has fresh vars to propagate
# (--update-env reads from the calling shell's environment, not from disk).
# Re-save afterwards so PM2's resurrect dump matches running state.
sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
  pm2 reload servicehub --update-env && pm2 save"

echo "==> Post-update health gate (sha + version must match what we just deployed)..."
# Poll /api/health for up to 30s. Each pass must confirm:
#   - ok:true and db:up                       (app reachable, DB reachable)
#   - gitSha === NEW_SHA                      (the new code is the running code)
#   - version === NEW_APP_VERSION             (matches shared/version.ts on disk)
# Anything else after the timeout triggers a full rollback (code + data).
# Override with FORCE_DEPLOY=1 only for genuine emergency hotfixes.
sleep 3
HEALTH_OK=0
HEALTH_BODY=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  HEALTH_BODY="$(curl -fsS "http://127.0.0.1:5000/api/health" || true)"
  if [[ -n "$HEALTH_BODY" ]] \
    && echo "$HEALTH_BODY" | grep -q '"ok":true' \
    && echo "$HEALTH_BODY" | grep -q "\"gitSha\":\"$NEW_SHA\"" \
    && echo "$HEALTH_BODY" | grep -q "\"version\":\"$NEW_APP_VERSION\""; then
    HEALTH_OK=1
    break
  fi
  echo "   attempt $i: health not yet matching (sha=$NEW_SHA, version=$NEW_APP_VERSION)"
  echo "             body: ${HEALTH_BODY:-<empty>}"
  sleep 3
done

if [[ "$HEALTH_OK" -ne 1 && "${FORCE_DEPLOY:-0}" != "1" ]]; then
  echo "ERROR: post-update health gate failed."
  echo "       expected gitSha=$NEW_SHA version=$NEW_APP_VERSION"
  echo "       last body:    ${HEALTH_BODY:-<empty>}"
  echo "       Rolling back code AND data. Snapshot: $SNAPSHOT"
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "$PREV_SHA"
  run_build_as_app_user
  sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
    pg_restore --clean --if-exists --no-owner --no-acl \
      --dbname=\"\$DATABASE_URL\" \"$SNAPSHOT\""
  sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
    pm2 reload servicehub --update-env && pm2 save"
  echo "Rolled back to $PREV_SHA."
  exit 1
fi

echo "==> Schema column drift verification (new (table:column) pairs must exist on prod DB)..."
# Table-aware verification: for every new (table, column) pair, query
# information_schema.columns scoped to the target table. A column missing
# on the right table fails even if the same column name exists elsewhere.
COLUMN_DRIFT_OK=1
MISSING_COLUMNS=()
if [[ -s "$NEW_COLUMNS_FILE" ]]; then
  LIVE_PAIRS="$(sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
    psql \"\$DATABASE_URL\" -At -F: -c \"SELECT table_name||':'||column_name FROM information_schema.columns WHERE table_schema='public'\"" 2>/dev/null | sort -u)"
  while IFS= read -r pair; do
    [[ -z "$pair" ]] && continue
    if ! echo "$LIVE_PAIRS" | grep -qx "$pair"; then
      COLUMN_DRIFT_OK=0
      MISSING_COLUMNS+=("$pair")
    fi
  done < "$NEW_COLUMNS_FILE"
fi

if [[ "$COLUMN_DRIFT_OK" -ne 1 && "${FORCE_DEPLOY:-0}" != "1" ]]; then
  echo "ERROR: schema column drift detected — db:push reported success but"
  echo "       these new columns from shared/schema.ts are NOT present on prod:"
  for c in "${MISSING_COLUMNS[@]}"; do echo "         - $c"; done
  echo "       Rolling back code AND data. Snapshot: $SNAPSHOT"
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "$PREV_SHA"
  run_build_as_app_user
  sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
    pg_restore --clean --if-exists --no-owner --no-acl \
      --dbname=\"\$DATABASE_URL\" \"$SNAPSHOT\""
  sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
    pm2 reload servicehub --update-env && pm2 save"
  echo "Rolled back to $PREV_SHA."
  exit 1
fi

echo "==> Log-tail error gate (last 200 lines of pm2 logs)..."
# Catches errors that don't fail /api/health but break user-facing routes.
# E.g. a missing column on a non-health table will only show up in the logs
# the first time a customer hits that route. We grep for known signatures
# and abort if any hit.
#
# IMPORTANT: strip the express request-logger lines (prefixed `[express]`)
# BEFORE grepping. Those lines include the HTTP response body for short
# JSON responses (e.g. `GET /api/admin/health/errors` returns the admin
# error history, which itself contains old "column ... does not exist"
# strings as resolved error summaries). Without this filter, a single
# admin dashboard poll during the post-deploy window rolls a perfectly
# healthy deploy. Real crashes print as unprefixed `console.error`
# output (see server/index.ts: "Internal Server Error:", "Seed error:",
# etc.) so dropping `[express]` lines costs us no real signal.
LOG_TAIL="$(sudo -u "$APP_USER" -H bash -lc "pm2 logs servicehub --lines 200 --nostream --raw" 2>/dev/null || true)"
# Strip:
#   (a) lines prefixed `[express]` — the express request logger embeds
#       response bodies after `:: `, and bodies for admin endpoints like
#       `/api/admin/health/errors` legitimately contain old "column ...
#       does not exist" strings from the resolved-errors history.
#   (b) JSON-continuation lines from (a) that pm2 split off into their
#       own physical line because the body exceeded pm2's ~1KB per-line
#       buffer — those have no `[express]` prefix, but they always
#       start with a JSON glyph (`"`, `,`, `:`, `{`, `}`).
#       Real crash output starts with `Error:`, `    at `, `(node:...`,
#       a timestamp, `[migrate]`, `[seed]`, or plain text — never one
#       of those JSON glyphs. (We deliberately do NOT strip lines
#       starting with `[` or `]`: `[migrate]`/`[seed]` source prefixes
#       are real signal, and JSON wouldn't naturally split right on a
#       bracket.)
# Without (b), a single admin dashboard poll during the post-deploy window
# can land enough wrapped JSON in pm2's log to roll a healthy deploy. We
# also capped the embedded body length in the source logger (see
# server/index.ts) so new occurrences never split; (b) covers residue
# already on disk from before that fix shipped.
LOG_TAIL_FILTERED="$(echo "$LOG_TAIL" | grep -v "\[express\]" | grep -vE '^("|,|:|\{|\})' || true)"
if echo "$LOG_TAIL_FILTERED" | grep -E "Migration error|column .* does not exist|relation .* does not exist|ECONNREFUSED" >/dev/null \
   && [[ "${FORCE_DEPLOY:-0}" != "1" ]]; then
  echo "ERROR: pm2 log tail contains schema/connection errors after restart:"
  echo "$LOG_TAIL_FILTERED" | grep -E "Migration error|column .* does not exist|relation .* does not exist|ECONNREFUSED" | head -n 10
  echo "       Rolling back code AND data. Snapshot: $SNAPSHOT"
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "$PREV_SHA"
  run_build_as_app_user
  sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
    pg_restore --clean --if-exists --no-owner --no-acl \
      --dbname=\"\$DATABASE_URL\" \"$SNAPSHOT\""
  sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
    pm2 reload servicehub --update-env && pm2 save"
  echo "Rolled back to $PREV_SHA."
  exit 1
fi

echo "==> Update complete: $PREV_SHA  ->  $NEW_SHA  (version $NEW_APP_VERSION)"
echo "    Snapshot kept at $SNAPSHOT (rollback: deploy/rollback.sh)"

# Matching `}` for the opening brace at the top of the file (see comment
# block there for why). The trailing `exit 0` is inside the block so bash
# never tries to read past `}` — defends against EOF mid-parse if the
# file gets truncated by a concurrent edit.
exit 0
}
