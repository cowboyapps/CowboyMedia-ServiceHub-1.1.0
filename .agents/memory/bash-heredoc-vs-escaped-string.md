---
name: bash heredoc vs escaped -lc string
description: Why deploy/update.sh builds remote-shell scripts as single-quoted heredocs, not escaped double-quoted strings, and why full-file `bash -n` is not a sufficient check.
---

# Building scripts to run via `sudo ... bash`

When passing a multi-line script to a remote/elevated shell in `deploy/update.sh`
(e.g. `sudo -u "$APP_USER" -H bash ...`), prefer a **single-quoted heredoc piped
to `bash -l -s -- <args>`** over a backslash-escaped `bash -lc "..."` string.

- Heredoc form: no `\$`, `\"`, `` \` `` escaping; pass outer values (`$APP_DIR`,
  `$ENV_FILE`) as positional args and read them as `$1`, `$2` inside. Reads like
  normal bash, so nested functions / `[[ "$(...)" ]]` / quotes are safe.
- The escaped-string form is extremely error-prone: one mis-escaped quote silently
  ends the string early.

**Why (the real gotcha):** `bash -n deploy/update.sh` on the WHOLE file can PASS
even when the inner string has an unbalanced quote, because content later in the
file rebalances the quote count. The bug only surfaces at deploy time. To actually
catch it, syntax-check the function in ISOLATION (`sed -n '<start>,<end>p' file >
/tmp/f.sh && bash -n /tmp/f.sh`) — but extract by exact line numbers, not by
`awk '/^}/'`, since a `}` closing a nested function inside the heredoc will
truncate the range.

**How to apply:** Any time you build a script string for another shell here, use
the heredoc+positional-args pattern and validate by isolating the function and/or
running it against stubbed `npm`/tools, not just full-file `bash -n`.
