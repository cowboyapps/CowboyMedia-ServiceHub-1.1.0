---
name: Ticket message edit scope
description: Customers and admins edit only their own public replies.
---

Customers and admins may edit their own public support-ticket replies, including older replies.
This never grants the ability to rewrite another person's message. Keep
internal-note editing rules separate.

**Why:** The user requested sent-message editing for both admins and customers, with a small edited label near the receipt.
Author-only editing preserves the integrity of customer and staff statements;
broader moderation would be a different product decision.

**How to apply:** Retain this scope unless the user explicitly requests broader
editing rights. Reuse existing ticket-access and support permissions rather than
treating an admin role alone as permission to manage every ticket.
