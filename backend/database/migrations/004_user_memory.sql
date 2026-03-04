-- 004: User memory / long-term fact store for AI chat
-- Stores extracted per-user facts so the chatbot remembers them across sessions.

CREATE TABLE IF NOT EXISTS user_memory (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users NOT NULL,
  key          text NOT NULL,          -- e.g. "user_name", "user_language", "preference_tone"
  value        text NOT NULL,
  confidence   float DEFAULT 1.0,     -- 0.0–1.0 how confident we are about this fact
  source       text DEFAULT 'chat',   -- 'chat' | 'explicit' | 'inferred'
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, key)
);

-- Row Level Security
ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_memory_select" ON user_memory FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_memory_insert" ON user_memory FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_memory_update" ON user_memory FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "user_memory_delete" ON user_memory FOR DELETE USING (auth.uid() = user_id);

-- Index for fast per-user lookups
CREATE INDEX IF NOT EXISTS user_memory_user_id_idx ON user_memory (user_id);
