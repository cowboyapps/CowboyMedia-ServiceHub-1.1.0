---
name: Automatic Telegram imports
description: User-approved scope and account-security decisions for imported service updates
---

Use a dedicated Telegram user account to import source channel posts fully
automatically. Manual forwarding is not an acceptable substitute.

**Why:** The user explicitly rejected forwarding because it requires the same
manual work as pasting into ServiceHub, and selected a dedicated account.

**How to apply:** Import new post text into admin-only service-update drafts,
notify authorized admins with a direct draft link, and require manual approval
before publishing or notifying customers. Keep existing appearance and outbound
announcements unchanged.

Prefer the maintained Teleproto account client over archived GramJS.

**Why:** GramJS's documentation explicitly redirected ongoing development to
Teleproto when this integration was researched.

**How to apply:** Consult current client documentation before extending login
or MTProto behavior; do not substitute the Bot API, which cannot read a source
channel where its bot has not been added.

A successful Telegram connection and `help.GetConfig` check does not prove the
API ID/hash pair is valid for requesting an account login code.

**Why:** During live setup, the VPS connection check succeeded while ServiceHub's
code-request step still failed; treating connectivity as credential validation
would lead to the wrong diagnosis.

**How to apply:** Distinguish network connection, code request, and code/password
verification when troubleshooting. Do not repeatedly request codes to test basic
connectivity, and never ask for raw provider payloads containing credentials.

Teleproto's request retry budget counts total attempts and also gates normal
data-center migration recovery; it is not just a network-error retry setting.

**Why:** The installed SDK throws before running its migration policy when no
attempt remains. A one-attempt configuration blocked real sign-in with
`PHONE_MIGRATE`, despite successful connectivity. An offline test using the
actual SDK reproduced the failure.

**How to apply:** Preserve a bounded multi-attempt budget for account operations.
Keep flood-wait sleeping disabled independently; do not suppress Telegram rate
limits or repeatedly request login codes to compensate for a migration error.
