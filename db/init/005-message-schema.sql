-- 005-message-schema.sql
-- Message tables: messages, message_stats

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('sent', 'received')),
  subject TEXT,
  content TEXT NOT NULL,
  conversation_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL DEFAULT 'csv',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE message_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  total_messages INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  received_count INTEGER DEFAULT 0,
  first_message_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  avg_response_time_hours REAL,
  conversation_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id)
);

-- Indexes
CREATE INDEX idx_messages_contact_id ON messages(contact_id);
CREATE INDEX idx_messages_sent_at ON messages(sent_at);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);

-- updated_at trigger
CREATE TRIGGER trg_message_stats_updated_at
  BEFORE UPDATE ON message_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
