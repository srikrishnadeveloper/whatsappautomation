/**
 * Supabase Message Store
 * Stores and retrieves WhatsApp messages using Supabase (Postgres)
 * Every operation requires a userId for data isolation
 */

import { getSupabaseClient, createAuthenticatedClient } from '../config/supabase';
import { StoredMessage } from './message-store';

class SupabaseMessageStore {
  private getDb(jwt?: string) {
    return jwt ? createAuthenticatedClient(jwt) : getSupabaseClient();
  }

  // Add a message (userId required, jwt enables RLS-passing writes)
  async add(message: Omit<StoredMessage, 'id' | 'created_at'>, userId: string, jwt?: string): Promise<StoredMessage> {
    const row = {
      user_id: userId,
      sender: message.sender,
      chat_name: message.chat_name,
      timestamp: message.timestamp,
      content: message.content,
      message_type: message.message_type,
      classification: message.classification,
      decision: message.decision,
      priority: message.priority,
      ai_reasoning: message.ai_reasoning,
      metadata: message.metadata || null,
    };

    const { data, error } = await this.getDb(jwt)
      .from('messages')
      .insert(row)
      .select()
      .single();

    if (error) throw new Error(`Supabase insert failed: ${error.message}`);

    return this.rowToMessage(data);
  }

  // Get a single message
  async get(id: string, userId?: string, jwt?: string): Promise<StoredMessage | undefined> {
    let query = this.getDb(jwt).from('messages').select('*').eq('id', id);
    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query.single();
    if (error || !data) return undefined;
    return this.rowToMessage(data);
  }

  // Get all messages with filters (userId required for isolation)
  async getAll(filters?: {
    classification?: string;
    decision?: string;
    priority?: string;
    search?: string;
    limit?: number;
    offset?: number;
    userId?: string;
    jwt?: string;
  }): Promise<{ data: StoredMessage[]; total: number }> {
    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    // Build count query
    let countQuery = this.getDb(filters?.jwt).from('messages').select('*', { count: 'exact', head: true });
    if (filters?.userId) countQuery = countQuery.eq('user_id', filters.userId);
    if (filters?.classification) countQuery = countQuery.eq('classification', filters.classification);
    if (filters?.decision) countQuery = countQuery.eq('decision', filters.decision);
    if (filters?.priority) countQuery = countQuery.eq('priority', filters.priority);
    if (filters?.search) {
      // Search individual keywords across content, sender, and chat_name.
      // Support up to 6 keywords for broad coverage; in-memory re-rank does the rest.
      const searchTerms = filters.search.toLowerCase().split(/\s+/).filter((t: string) => t.length >= 2).slice(0, 6);
      if (searchTerms.length > 0) {
        const orClauses = searchTerms.flatMap(term => [
          `content.ilike.%${term}%`,
          `sender.ilike.%${term}%`,
          `chat_name.ilike.%${term}%`,
        ]).join(',');
        countQuery = countQuery.or(orClauses);
      }
    }

    const { count } = await countQuery;

    // Build data query
    let query = this.getDb(filters?.jwt)
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (filters?.userId) query = query.eq('user_id', filters.userId);
    if (filters?.classification) query = query.eq('classification', filters.classification);
    if (filters?.decision) query = query.eq('decision', filters.decision);
    if (filters?.priority) query = query.eq('priority', filters.priority);
    if (filters?.search) {
      const searchTerms = filters.search.toLowerCase().split(/\s+/).filter((t: string) => t.length >= 2).slice(0, 6);
      if (searchTerms.length > 0) {
        const orClauses = searchTerms.flatMap(term => [
          `content.ilike.%${term}%`,
          `sender.ilike.%${term}%`,
          `chat_name.ilike.%${term}%`,
        ]).join(',');
        query = query.or(orClauses);
      }
    }

    const { data, error } = await query;
    if (error) throw new Error(`Supabase query failed: ${error.message}`);

    return {
      data: (data || []).map(row => this.rowToMessage(row)),
      total: count || 0,
    };
  }

  // Update a message
  async update(id: string, updates: Partial<StoredMessage>, userId?: string, jwt?: string): Promise<StoredMessage | null> {
    const updateData: any = {};
    if (updates.classification !== undefined) updateData.classification = updates.classification;
    if (updates.decision !== undefined) updateData.decision = updates.decision;
    if (updates.priority !== undefined) updateData.priority = updates.priority;
    if (updates.ai_reasoning !== undefined) updateData.ai_reasoning = updates.ai_reasoning;
    if (updates.metadata !== undefined) updateData.metadata = updates.metadata;
    updateData.updated_at = new Date().toISOString();

    let query = this.getDb(jwt).from('messages').update(updateData).eq('id', id);
    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query.select().single();
    if (error || !data) return null;
    return this.rowToMessage(data);
  }

  // Delete a message
  async delete(id: string, userId?: string, jwt?: string): Promise<boolean> {
    let query = this.getDb(jwt).from('messages').delete().eq('id', id);
    if (userId) query = query.eq('user_id', userId);

    const { error, count } = await query;
    return !error && (count ?? 0) > 0;
  }

  // Check if a message with given messageKey already exists (dedup)
  async existsByMessageKey(messageKey: string, userId?: string, jwt?: string): Promise<boolean> {
    let query = this.getDb(jwt)
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .contains('metadata', { messageKey });

    if (userId) query = query.eq('user_id', userId);

    const { count } = await query;
    return (count ?? 0) > 0;
  }

  // Get statistics for a user
  async getStats(userId?: string, jwt?: string): Promise<{
    overview: {
      total_messages: number;
      recent_24h: number;
      tasks_created: number;
      pending_review: number;
    };
    by_classification: Record<string, number>;
    by_decision: Record<string, number>;
    by_priority: Record<string, number>;
  }> {
    let query = this.getDb(jwt).from('messages').select('classification, decision, priority, created_at');
    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) throw new Error(`Stats query failed: ${error.message}`);

    const messages = data || [];
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const by_classification: Record<string, number> = {};
    const by_decision: Record<string, number> = {};
    const by_priority: Record<string, number> = {};
    let recent_24h = 0;
    let tasks_created = 0;
    let pending_review = 0;

    messages.forEach((m: any) => {
      const createdAt = new Date(m.created_at);
      if (createdAt > oneDayAgo) recent_24h++;

      const cat = m.classification || 'unclassified';
      by_classification[cat] = (by_classification[cat] || 0) + 1;

      const dec = m.decision || 'pending';
      by_decision[dec] = (by_decision[dec] || 0) + 1;
      if (dec === 'create') tasks_created++;
      if (dec === 'review') pending_review++;

      const pri = m.priority || 'none';
      by_priority[pri] = (by_priority[pri] || 0) + 1;
    });

    return {
      overview: {
        total_messages: messages.length,
        recent_24h,
        tasks_created,
        pending_review,
      },
      by_classification,
      by_decision,
      by_priority,
    };
  }

  // Clear all messages for a specific user only
  async clear(userId: string, jwt?: string): Promise<void> {
    const { error } = await this.getDb(jwt).from('messages').delete().eq('user_id', userId);
    if (error) throw new Error(`Clear failed: ${error.message}`);
  }

  // Count all messages for a user
  async count(userId: string, jwt?: string): Promise<number> {
    const { count } = await this.getDb(jwt)
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    return count || 0;
  }

  private rowToMessage(row: any): StoredMessage {
    return {
      id: row.id,
      sender: row.sender,
      chat_name: row.chat_name,
      timestamp: row.timestamp,
      content: row.content,
      message_type: row.message_type || 'text',
      classification: row.classification,
      decision: row.decision,
      priority: row.priority,
      ai_reasoning: row.ai_reasoning,
      created_at: row.created_at,
      metadata: row.metadata,
    };
  }
}

export const supabaseMessageStore = new SupabaseMessageStore();
export default supabaseMessageStore;
