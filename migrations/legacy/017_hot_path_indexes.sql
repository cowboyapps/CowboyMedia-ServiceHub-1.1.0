-- Indexes on hot read paths. Uses IF NOT EXISTS + CONCURRENTLY so it is safe
-- to re-run and does not lock production tables. Each statement runs outside a
-- transaction (psql's default for `-f` without -1).

CREATE INDEX CONCURRENTLY IF NOT EXISTS user_notifications_user_id_created_at_idx
  ON user_notifications (user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS user_notifications_user_id_unread_idx
  ON user_notifications (user_id)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS ticket_messages_ticket_id_created_at_idx
  ON ticket_messages (ticket_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ticket_notifications_user_id_unread_idx
  ON ticket_notifications (user_id)
  WHERE read_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS report_notifications_user_id_unread_idx
  ON report_notifications (user_id)
  WHERE read_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS content_notifications_user_category_read_idx
  ON content_notifications (user_id, category, read_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS push_subscriptions_user_id_idx
  ON push_subscriptions (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS thread_messages_thread_id_created_at_idx
  ON thread_messages (thread_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS admin_chat_messages_thread_id_created_at_idx
  ON admin_chat_messages (thread_id, created_at);
