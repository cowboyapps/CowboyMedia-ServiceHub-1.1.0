---
name: Required runtime assets
description: Why a healthy Replit preview can hide missing branding assets in deployment checkouts
---

Replit's global Git ignore excludes files under `attached_assets`, even when a locally present upload is imported by the application.

**Why:** A preview and a normal local build can succeed using files on disk that a fresh deployment checkout does not contain. Required branding files were removed from tracking while remaining available locally, hiding a production-build failure.

**How to apply:** Keep required shipped branding explicitly tracked and allowlisted without tracking unrelated screenshots or uploads. When checking deployment readiness after asset cleanup, verify a clean checkout or archive of tracked files rather than relying only on the current workspace. Restore original asset blobs instead of introducing replacement branding.
