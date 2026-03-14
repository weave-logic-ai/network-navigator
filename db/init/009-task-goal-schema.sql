-- 009-task-goal-schema.sql
-- Goal and task tables

CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  goal_type TEXT NOT NULL DEFAULT 'custom',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
  priority INTEGER DEFAULT 5,
  target_metric TEXT,
  target_value REAL,
  current_value REAL DEFAULT 0,
  deadline TIMESTAMPTZ,
  source TEXT DEFAULT 'user',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT NOT NULL DEFAULT 'manual',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped', 'failed')),
  priority INTEGER DEFAULT 5,
  url TEXT,
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  source TEXT DEFAULT 'system',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now_utc(),
  updated_at TIMESTAMPTZ DEFAULT now_utc()
);

-- Indexes
CREATE INDEX idx_tasks_goal_id ON tasks(goal_id);
CREATE INDEX idx_tasks_contact_id ON tasks(contact_id);
CREATE INDEX idx_tasks_status ON tasks(status);

-- updated_at triggers
CREATE TRIGGER trg_goals_updated_at
  BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
