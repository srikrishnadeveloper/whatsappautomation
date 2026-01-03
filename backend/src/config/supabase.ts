/**
 * Supabase Client Configuration
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

let supabase: SupabaseClient | null = null;

// Only create client if credentials are provided
if (supabaseUrl && supabaseUrl.startsWith('http') && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('✅ Supabase client initialized');
} else {
  console.warn('⚠️  Warning: Supabase credentials not configured');
  console.warn('   Set SUPABASE_URL and SUPABASE_ANON_KEY in .env');
  console.warn('   The API will run with mock data until configured.');
}

export { supabase };

// Database types
export interface Message {
  id: string;
  sender: string;
  chat_name: string | null;
  timestamp: string;
  content: string;
  message_type: string;
  classification: string | null;
  decision: string | null;
  priority: string | null;
  ai_reasoning: string | null;
  notion_page_id: string | null;
  metadata: any;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  message_id: string;
  notion_page_id: string;
  task_title: string;
  task_category: string | null;
  task_priority: string | null;
  task_status: string;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Rule {
  id: string;
  rule_type: string;
  contact_name: string | null;
  group_name: string | null;
  keywords: string[] | null;
  priority: string | null;
  category: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
