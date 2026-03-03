-- Migration 002: Persistent AI chat history + media file references
-- Apply via Supabase dashboard or CLI

-- ── AI Chat History ──────────────────────────────────────────────────────────
-- Stores the full chat conversation per user as JSONB so it survives server restarts.
CREATE TABLE IF NOT EXISTS ai_chat_history (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  messages   JSONB       NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- One row per user
CREATE UNIQUE INDEX IF NOT EXISTS ai_chat_history_user_idx ON ai_chat_history(user_id);

ALTER TABLE ai_chat_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own chat history" ON ai_chat_history;
CREATE POLICY "Users manage own chat history"
  ON ai_chat_history FOR ALL TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Media Cache References ────────────────────────────────────────────────────
-- Records every media file that passed through the in-memory cache so users can
-- see what files they received even after server restart (buffer is gone but the
-- metadata remains).
CREATE TABLE IF NOT EXISTS media_cache_refs (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_key TEXT        NOT NULL,
  message_id  TEXT,
  mime_type   TEXT,
  file_name   TEXT,
  file_size   BIGINT      DEFAULT 0,
  media_type  TEXT,         -- 'image' | 'video' | 'audio' | 'sticker' | 'document'
  cached_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS media_cache_refs_key_idx ON media_cache_refs(user_id, message_key);
CREATE INDEX IF NOT EXISTS media_cache_refs_user_idx ON media_cache_refs(user_id);

ALTER TABLE media_cache_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own media refs" ON media_cache_refs;
CREATE POLICY "Users manage own media refs"
  ON media_cache_refs FOR ALL TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
