CREATE TABLE IF NOT EXISTS message_threads (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id VARCHAR NOT NULL,
  customer_id VARCHAR NOT NULL,
  subject TEXT NOT NULL,
  last_message_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS thread_messages (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id VARCHAR NOT NULL,
  sender_id VARCHAR NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_id ON thread_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_message_threads_admin_id ON message_threads(admin_id);
CREATE INDEX IF NOT EXISTS idx_message_threads_customer_id ON message_threads(customer_id);
