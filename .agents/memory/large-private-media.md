---
name: Large private media durability
description: Preserve VPS backup guarantees for large private attachments; inclusive multipart-size boundary quirk.
---

Large private attachments must retain the existing database backup/restore
guarantees. Temporary disk files are upload staging, not durable media storage.

**Why:** The VPS deployment/rollback process snapshots PostgreSQL. Moving durable
videos to local disk without designing matching backups would silently exclude
them from restores.

**How to apply:** Keep large file handling bounded-memory. Any future move to
object/disk storage must address backup, restore, access revocation and deletion
before replacing the current durable representation.

Multer/Busboy's file-size threshold fires at equality, not only above it.

**Why:** A parser threshold equal to the advertised maximum rejects a file exactly
at that maximum; a real 250 MB multipart boundary check confirmed the inclusive
application validation needs a one-byte parser allowance.

**How to apply:** Set the parser threshold one byte above the intended maximum,
then explicitly reject actual file sizes above the maximum. Keep regression
checks for both the exact boundary and one byte above it.
