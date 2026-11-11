# Custom analytics events

These client-side events use Replit's injected analytics tracker. Do not install a tracker script, set a website ID, or add analytics environment variables. Enable analytics in Publishing settings and publish or republish to collect events on the supported Replit deployment. A separate VPS deployment does not receive Replit's publishing-proxy injection; calls there remain no-ops unless a compatible tracker is separately provided.

| Event | When it fires | Properties |
| --- | --- | --- |
| `support_ticket_created` | Ticket creation succeeds | `has_attachment` |
| `support_message_sent` | Public reply or internal note succeeds | `actor_type`, `has_attachment`, `internal` |
| `support_ticket_closed` | A customer or staff manual closure succeeds | `actor_type` |
| `private_conversation_started` | A new private conversation succeeds | `has_attachment` |
| `private_message_sent` | A reply in an existing private conversation succeeds | `actor_type`, `has_attachment` |
| `service_alert_viewed` | An alert successfully loads for a visit | None |
| `knowledge_article_viewed` | A knowledge article successfully loads for a visit | None |
| `knowledge_feedback_submitted` | An article helpfulness vote succeeds | `helpful` |
| `attachment_viewer_opened` | An attachment viewer opens | `attachment_kind`, `message_channel` |
| `attachment_download_requested` | An authenticated attachment fetch succeeds and the browser download is requested | `attachment_kind`, `message_channel` |
| `attachment_shared` | The native share operation resolves successfully | `attachment_kind`, `message_channel` |

## Semantics and privacy

- Do not attach names, email addresses, message text, ticket subjects, search terms, filenames, URLs, or user/resource identifiers.
- Properties are runtime-allowlisted booleans and fixed categories. Local IDs deduplicate successful retries in a bounded in-memory set; IDs are never sent or persisted.
- Refetches and React StrictMode effect replay are not extra content views. Reopening a viewer or returning to a page is a new visit.
- Opening a private conversation and sending its initial message counts as `private_conversation_started`, not an additional `private_message_sent`.
- Downloads measure browser requests, not confirmation that an operating system saved a file.
- Manual closures are instrumented; background automatic closures are not browser events. Use the permanent ticket audit history for automatic closures.
- No tracker, blocked tracking, navigation away, network loss or tracker errors may undercount outcomes. Analytics is not a financial or operational audit trail.
- Pageviews are handled by the injected tracker; do not manually duplicate them.
