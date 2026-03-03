-- Migration 003: Multi-session AI Chat Support
-- Each user can have multiple named chat sessions (like ChatGPT)
-- Apply via Supabase dashboard SQL editor

-- 1. Add new columns to ai_chat_history
ALTER TABLE ai_chat_history
  ADD COLUMN IF NOT EXISTS session_id  UUID        DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS title       TEXT        NOT NULL DEFAULT 'New Chat',
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Populate session_id for any existing rows that don't have one
UPDATE ai_chat_history SET session_id = gen_random_uuid() WHERE session_id IS NULL;

-- 3. Drop the old UNIQUE index (one-per-user) and create the new ones
DROP INDEX IF EXISTS ai_chat_history_user_idx;

-- New: each session_id is globally unique
CREATE UNIQUE INDEX IF NOT EXISTS ai_chat_history_session_idx
  ON ai_chat_history(session_id);

-- New: allow many sessions per user; index for fast listing
CREATE INDEX IF NOT EXISTS ai_chat_history_user_list_idx
  ON ai_chat_history(user_id, last_message_at DESC);

-- 4. RLS policy remains unchanged (auth.uid() = user_id covers all sessions)
