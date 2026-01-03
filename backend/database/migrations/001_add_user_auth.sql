-- Migration: Add user authentication and link all data to users
-- WhatsApp Task Manager - User Authentication Schema

-- ===========================================
-- 1. Create user profiles table (extends auth.users)
-- ===========================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    full_name TEXT,
    avatar_url TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view their own profile" 
    ON public.profiles FOR SELECT 
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" 
    ON public.profiles FOR UPDATE 
    USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" 
    ON public.profiles FOR INSERT 
    WITH CHECK (auth.uid() = id);

-- ===========================================
-- 2. Add user_id to messages table
-- ===========================================
ALTER TABLE public.messages 
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for user_id
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON public.messages(user_id);

-- Enable RLS on messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Messages policies
CREATE POLICY "Users can view their own messages" 
    ON public.messages FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own messages" 
    ON public.messages FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own messages" 
    ON public.messages FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own messages" 
    ON public.messages FOR DELETE 
    USING (auth.uid() = user_id);

-- ===========================================
-- 3. Add user_id to tasks table
-- ===========================================
ALTER TABLE public.tasks 
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for user_id
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON public.tasks(user_id);

-- Enable RLS on tasks
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- Tasks policies
CREATE POLICY "Users can view their own tasks" 
    ON public.tasks FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tasks" 
    ON public.tasks FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tasks" 
    ON public.tasks FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tasks" 
    ON public.tasks FOR DELETE 
    USING (auth.uid() = user_id);

-- ===========================================
-- 4. Add user_id to rules table
-- ===========================================
ALTER TABLE public.rules 
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for user_id
CREATE INDEX IF NOT EXISTS idx_rules_user_id ON public.rules(user_id);

-- Enable RLS on rules
ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;

-- Rules policies
CREATE POLICY "Users can view their own rules" 
    ON public.rules FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own rules" 
    ON public.rules FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own rules" 
    ON public.rules FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own rules" 
    ON public.rules FOR DELETE 
    USING (auth.uid() = user_id);

-- ===========================================
-- 5. Add user_id to feedback table
-- ===========================================
ALTER TABLE public.feedback 
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for user_id
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON public.feedback(user_id);

-- Enable RLS on feedback
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Feedback policies
CREATE POLICY "Users can view their own feedback" 
    ON public.feedback FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own feedback" 
    ON public.feedback FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

-- ===========================================
-- 6. Create action_items table with user_id
-- ===========================================
CREATE TABLE IF NOT EXISTS public.action_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    sender TEXT,
    chat_name TEXT,
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
    category TEXT DEFAULT 'other' CHECK (category IN ('work', 'study', 'personal', 'urgent', 'other')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'completed', 'dismissed')),
    due_date DATE,
    due_time TIME,
    tags TEXT[],
    original_message TEXT,
    ai_confidence DECIMAL(3,2),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for action_items
CREATE INDEX IF NOT EXISTS idx_action_items_user_id ON public.action_items(user_id);
CREATE INDEX IF NOT EXISTS idx_action_items_status ON public.action_items(status);
CREATE INDEX IF NOT EXISTS idx_action_items_priority ON public.action_items(priority);
CREATE INDEX IF NOT EXISTS idx_action_items_due_date ON public.action_items(due_date);

-- Enable RLS on action_items
ALTER TABLE public.action_items ENABLE ROW LEVEL SECURITY;

-- Action items policies
CREATE POLICY "Users can view their own action items" 
    ON public.action_items FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own action items" 
    ON public.action_items FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own action items" 
    ON public.action_items FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own action items" 
    ON public.action_items FOR DELETE 
    USING (auth.uid() = user_id);

-- ===========================================
-- 7. Create WhatsApp sessions table (per user)
-- ===========================================
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    session_data JSONB,
    is_connected BOOLEAN DEFAULT FALSE,
    connected_phone TEXT,
    connected_name TEXT,
    last_connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on whatsapp_sessions
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;

-- WhatsApp sessions policies
CREATE POLICY "Users can view their own session" 
    ON public.whatsapp_sessions FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own session" 
    ON public.whatsapp_sessions FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own session" 
    ON public.whatsapp_sessions FOR UPDATE 
    USING (auth.uid() = user_id);

-- ===========================================
-- 8. Create activity_logs table (per user)
-- ===========================================
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('info', 'success', 'warning', 'error', 'message')),
    icon TEXT,
    title TEXT NOT NULL,
    details TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for user_id and time
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON public.activity_logs(created_at DESC);

-- Enable RLS on activity_logs
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Activity logs policies
CREATE POLICY "Users can view their own logs" 
    ON public.activity_logs FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own logs" 
    ON public.activity_logs FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own logs" 
    ON public.activity_logs FOR DELETE 
    USING (auth.uid() = user_id);

-- ===========================================
-- 9. Trigger to create profile on user signup
-- ===========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===========================================
-- 10. Updated_at trigger for new tables
-- ===========================================
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_action_items_updated_at BEFORE UPDATE ON public.action_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_whatsapp_sessions_updated_at BEFORE UPDATE ON public.whatsapp_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
