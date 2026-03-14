-- 006-outreach-schema.sql
-- Outreach tables: campaigns, templates, sequences, steps, states, events, template_performance

CREATE TABLE outreach_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  target_count INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  response_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE outreach_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('initial_outreach', 'follow_up', 'meeting_request', 'referral_ask', 'content_share', 'custom')),
  subject_template TEXT,
  body_template TEXT NOT NULL,
  merge_variables TEXT[] DEFAULT '{}',
  tone TEXT DEFAULT 'professional',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE outreach_sequences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE outreach_sequence_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sequence_id UUID NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  template_id UUID NOT NULL REFERENCES outreach_templates(id),
  delay_days INTEGER DEFAULT 0,
  condition JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(sequence_id, step_order)
);

CREATE TABLE outreach_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES outreach_campaigns(id),
  sequence_id UUID REFERENCES outreach_sequences(id),
  current_step INTEGER DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'not_started'
    CHECK (state IN ('not_started', 'queued', 'sent', 'opened', 'replied', 'accepted', 'declined', 'bounced', 'opted_out')),
  last_action_at TIMESTAMPTZ,
  next_action_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(contact_id, campaign_id)
);

CREATE TABLE outreach_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outreach_state_id UUID NOT NULL REFERENCES outreach_states(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE template_performance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES outreach_templates(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  sent_count INTEGER DEFAULT 0,
  open_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  accept_count INTEGER DEFAULT 0,
  avg_response_time_hours REAL,
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  UNIQUE(template_id, period_start)
);

-- Indexes
CREATE INDEX idx_outreach_states_contact_id ON outreach_states(contact_id);
CREATE INDEX idx_outreach_states_state ON outreach_states(state);
CREATE INDEX idx_outreach_events_state_id ON outreach_events(outreach_state_id);
CREATE INDEX idx_outreach_sequences_campaign_id ON outreach_sequences(campaign_id);

-- updated_at triggers
CREATE TRIGGER trg_outreach_campaigns_updated_at
  BEFORE UPDATE ON outreach_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_outreach_templates_updated_at
  BEFORE UPDATE ON outreach_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_outreach_states_updated_at
  BEFORE UPDATE ON outreach_states
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
