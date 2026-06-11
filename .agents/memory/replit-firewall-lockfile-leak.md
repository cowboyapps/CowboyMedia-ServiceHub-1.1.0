---
name: Replit package-firewall URLs leak into package-lock.json
description: Why external (VPS) `npm ci` dies with "Exit handler never called!" and how to sanitize the lockfile before deploying off-Replit.
---

# Replit package-firewall leak breaks off-Replit `npm ci`

When a package is added/updated **on Replit**, Replit's package-firewall proxy host
can get baked into `package-lock.json` `resolved` fields as
`http://package-firewall.replit.local/npm/<pkg>/-/<file>.tgz` instead of
`https://registry.npmjs.org/<pkg>/-/<file>.tgz`. A lockfile can end up *mixed* —
most entries public, only the newly-touched ones contaminated.

**Symptom (the trap):** on any non-Replit host (e.g. the production VPS),
`npm ci` reads those `resolved` URLs, tries to reach `package-firewall.replit.local`
(which only resolves inside Replit), and dies with the **misleading**:

```
npm error Exit handler never called!
```

This is NOT a disk-full, RAM/OOM, npm-version, or cache-corruption problem — those
are all red herrings that will waste days. Upgrading npm, `npm cache clean --force`,
and `rm -rf node_modules` do nothing because the bad URL is in the committed lockfile.
The tell is in the npm debug log (`~/.npm/_logs/*-debug-0.log`): grep it for
`package-firewall.replit.local` in the `http cache`/`http fetch` lines.

**Fix (safe, surgical):**
```bash
sed -i 's#http://package-firewall\.replit\.local/npm/#https://registry.npmjs.org/#g' package-lock.json
rg -c package-firewall package-lock.json   # must print 0
```
Path layout is identical (`/npm/<pkg>` ↔ `/<pkg>`) and `integrity` hashes are the
same tarballs, so only the URL strings change — diff should be exactly N added / N
removed lines and nothing structural. Commit + push; the VPS `npm ci` then resolves
from the public registry.

**Why it recurs:** every time deps are added on Replit and the lockfile is committed,
new firewall URLs can leak back in. Re-check before each off-Replit deploy.

**Validation caveat:** the Replit agent bash sandbox blocks running `npm ci` / `npm install`
directly (and blocks `cd`, `rm -rf`), so you cannot fully install-test the fix locally.
Rely on the structural proof (rewritten entries identical in form to the working
`registry.npmjs.org` entries) and confirm on the VPS deploy.
