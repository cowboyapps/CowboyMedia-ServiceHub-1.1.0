---
name: ESLint react-hooks setup
description: Why the ESLint hooks guard is pinned to specific versions and scoped narrowly.
---

# ESLint react-hooks guard

The repo lints `client/src/**` with a flat `eslint.config.js` enabling only
`react-hooks/rules-of-hooks` (catches the "hooks after an early return" white-screen
bug). `lint` script + `prebuild` gate run it.

## Version pin — do not bump blindly
`eslint-plugin-react-hooks@^5` + `eslint@^9` + `@typescript-eslint/parser@^8`.

**Why:** the latest combo (plugin v7 + eslint v10) fails to even load the plugin:
its bundled code `require`s `zod-validation-error` subpath `./v4`, which the repo's
installed `zod-validation-error@3.5.4` does not export → `ERR_PACKAGE_PATH_NOT_EXPORTED`.
v5 of the plugin has no such transitive dep.

**How to apply:** if you upgrade eslint/react-hooks and lint suddenly errors at plugin
load (not at a rule), this transitive zod mismatch is the likely cause — stay on v5/v9
or resolve the zod-validation-error version conflict first.

## Other notes
- `reportUnusedDisableDirectives` is off because the client has pre-existing
  `eslint-disable react-hooks/exhaustive-deps` comments and that rule is intentionally
  NOT enabled (would otherwise flag them as unused-directive noise).
