-- WhatsApp to Notion Task Manager - Database Schema
-- Created: 2025-09-30

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Messages table: Store all incoming WhatsApp messages
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender TEXT NOT NULL,
    chat_name TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    content TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text', -- text, image, video, audio, document, sticker, etc.
    classification TEXT, -- work, study, personal, ignore
    decision TEXT, -- create, ignore, review
    notion_page_id TEXT, -- Link to created Notion task
    ai_reasoning TEXT, -- Why AI made this decision
    metadata JSONB, -- Additional data (attachments, quoted messages, etc.)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rules table: Custom filtering preferences
CREATE TABLE IF NOT EXISTS rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_type TEXT NOT NULL, -- always-important, always-ignore, keyword, contact, group
    contact_name TEXT,
    group_name TEXT,
    keywords TEXT[], -- Array of keywords
    priority TEXT, -- urgent, high, medium, low
    category TEXT, -- work, study, personal
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tasks table: Track created Notion tasks
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    notion_page_id TEXT NOT NULL UNIQUE,
    notion_database_id TEXT NOT NULL,
    task_title TEXT NOT NULL,
    task_category TEXT, -- work, study, personal
    task_priority TEXT, -- urgent, high, medium, low
    task_status TEXT DEFAULT 'To Do', -- To Do, In Progress, Done
    due_date TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feedback table: Track user corrections for AI learning
CREATE TABLE IF NOT EXISTS feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    original_decision TEXT NOT NULL,
    corrected_decision TEXT NOT NULL,
    user_comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_classification ON messages(classification);
CREATE INDEX IF NOT EXISTS idx_messages_decision ON messages(decision);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
CREATE INDEX IF NOT EXISTS idx_rules_type ON rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_rules_active ON rules(is_active);
CREATE INDEX IF NOT EXISTS idx_tasks_notion_page ON tasks(notion_page_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(task_status);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to all tables
CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rules_updated_at BEFORE UPDATE ON rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert some default rules
INSERT INTO rules (rule_type, keywords, category, priority) VALUES
    ('keyword', ARRAY['meeting', 'deadline', 'project', 'report', 'presentation'], 'work', 'high'),
    ('keyword', ARRAY['assignment', 'exam', 'homework', 'lecture', 'study', 'thesis'], 'study', 'high'),
    ('keyword', ARRAY['good morning', 'good night', 'how are you', 'thanks', 'ok', 'lol'], 'ignore', 'low'),
    ('keyword', ARRAY['offer', 'discount', 'sale', 'buy now', 'click here', 'forwarded'], 'ignore', 'low')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE messages IS 'Stores all WhatsApp messages for processing and analysis';
COMMENT ON TABLE rules IS 'Custom filtering rules and preferences';
COMMENT ON TABLE tasks IS 'Tracks Notion tasks created from messages';
COMMENT ON TABLE feedback IS 'User corrections for AI learning and improvement';
