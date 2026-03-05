/**
 * Hybrid Message Store
 * Uses Supabase when credentials are available, falls back to in-memory storage
 */

import { StoredMessage } from './message-store';
import { hasSupabaseCredentials } from '../config/supabase';
import { encryptContent, decryptContent, isEncryptionEnabled } from './encryption';

/** Decrypt the content field on a message (no-op if not encrypted). */
function decryptMessage<T extends { content?: string }>(msg: T): T {
  if (!msg.content) return msg;
  return { ...msg, content: decryptContent(msg.content) };
}

// In-memory fallback store
class InMemoryMessageStore {
  private messages: Map<string, StoredMessage> = new Map();
  private idCounter: number = 1;

  add(message: Omit<StoredMessage, 'id' | 'created_at'>): StoredMessage {
    const id = `msg-${Date.now()}-${this.idCounter++}`;
    const storedMessage: StoredMessage = {
      ...message,
      id,
      created_at: new Date().toISOString()
    };
    this.messages.set(id, storedMessage);
    
    // Keep only last 1000 messages
    if (this.messages.size > 1000) {
      const firstKey = this.messages.keys().next().value;
      if (firstKey) this.messages.delete(firstKey);
    }
    
    return storedMessage;
  }

  get(id: string): StoredMessage | undefined {
    return this.messages.get(id);
  }

  getAll(filters?: {
    classification?: string;
    decision?: string;
    priority?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): { data: StoredMessage[]; total: number } {
    let messages = Array.from(this.messages.values()).reverse();

    if (filters?.classification) {
      messages = messages.filter(m => m.classification === filters.classification);
    }
    if (filters?.decision) {
      messages = messages.filter(m => m.decision === filters.decision);
    }
    if (filters?.priority) {
      messages = messages.filter(m => m.priority === filters.priority);
    }
    if (filters?.search) {
      const searchTerms = filters.search.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
      messages = messages.filter(m => {
        // Build a comprehensive search blob from all fields
        const blob = [
          m.content,
          m.sender,
          m.chat_name || '',
          m.metadata?.document?.fileName || '',
          m.metadata?.imageAnalysis?.description || '',
          m.metadata?.imageAnalysis?.extractedText || '',
          m.metadata?.documentAnalysis?.summary || '',
          m.metadata?.documentAnalysis?.extractedText || '',
          m.metadata?.documentAnalysis?.topics?.join(' ') || '',
          m.metadata?.documentAnalysis?.keyEntities?.join(' ') || '',
        ].join(' ').toLowerCase();
        // Match if ANY search term appears in the blob
        return searchTerms.some(term => blob.includes(term));
      });
    }

    const total = messages.length;
    const offset = filters?.offset || 0;
    const limit = filters?.limit || 50;
    messages = messages.slice(offset, offset + limit);

    return { data: messages, total };
  }

  update(id: string, updates: Partial<StoredMessage>): StoredMessage | null {
    const message = this.messages.get(id);
    if (!message) return null;
    const updated = { ...message, ...updates };
    this.messages.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.messages.delete(id);
  }

  getStats(): any {
    const messages = Array.from(this.messages.values());
    const stats = {
      total: messages.length,
      byClassification: {} as Record<string, number>,
      byDecision: {} as Record<string, number>,
      byPriority: {} as Record<string, number>,
      bySender: {} as Record<string, number>,
      recentMessages: messages.slice(-10).reverse()
    };

    messages.forEach(m => {
      if (m.classification) {
        stats.byClassification[m.classification] = (stats.byClassification[m.classification] || 0) + 1;
      }
      if (m.decision) {
        stats.byDecision[m.decision] = (stats.byDecision[m.decision] || 0) + 1;
      }
      if (m.priority) {
        stats.byPriority[m.priority] = (stats.byPriority[m.priority] || 0) + 1;
      }
      stats.bySender[m.sender] = (stats.bySender[m.sender] || 0) + 1;
    });

    return stats;
  }

  clear(): void {
    this.messages.clear();
  }

  /** Return all raw messages for flushing to Supabase, then clear the map */
  drainAll(): StoredMessage[] {
    const all = Array.from(this.messages.values());
    this.messages.clear();
    return all;
  }

  get size(): number {
    return this.messages.size;
  }
}

// Create the hybrid store — tries Supabase first, falls back to in-memory
class HybridMessageStore {
  private inMemoryStore = new InMemoryMessageStore();
  private supabaseStore: any = null;
  private useSupabase: boolean = false;
  private initialized: boolean = false;

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (hasSupabaseCredentials()) {
      try {
        const { supabaseMessageStore } = await import('./supabase-message-store');
        this.supabaseStore = supabaseMessageStore;
        this.useSupabase = true;
        console.log('✅ Hybrid Store: Using Supabase for messages');
      } catch (error) {
        console.log('⚠️ Hybrid Store: Supabase failed, using in-memory storage');
        this.useSupabase = false;
      }
    } else {
      console.log('📦 Hybrid Store: Using in-memory storage (no Supabase credentials)');
      this.useSupabase = false;
    }
  }

  async add(message: Omit<StoredMessage, 'id' | 'created_at'>, userId?: string, jwt?: string): Promise<StoredMessage> {
    await this.initialize();

    if (this.useSupabase && this.supabaseStore && userId) {
      try {
        // Encrypt content at rest (only when ENCRYPTION_SECRET is configured)
        const msgToStore = isEncryptionEnabled()
          ? { ...message, content: encryptContent(message.content) }
          : message;
        const result = await this.supabaseStore.add(msgToStore, userId, jwt);
        console.log(`💾 Message SAVED to Supabase (ID: ${result.id}, User: ${userId}${isEncryptionEnabled() ? ', encrypted' : ''})`);

        // Generate and store embedding (fire-and-forget, non-blocking)
        try {
          const { embedMessage } = require('./embedding-service');
          embedMessage({
            id: result.id,
            sender: message.sender,
            chat_name: message.chat_name,
            content: message.content,
            metadata: message.metadata,
          }).catch(() => {});
        } catch { /* embedding service not available */ }

        // Return with decrypted content so callers see plaintext
        return decryptMessage(result);
      } catch (error: any) {
        console.error('❌ Supabase save failed (will retry next message):', error.message);
        // Don't permanently disable Supabase – transient errors (JWT expiry, network) should not kill persistence.
      }
    }

    const result = this.inMemoryStore.add(message);
    console.log(`📦 Message saved to IN-MEMORY (ID: ${result.id}) - Will be lost on restart!`);
    return result;
  }

  async existsByMessageKey(messageKey: string, userId?: string, jwt?: string): Promise<boolean> {
    await this.initialize();

    if (this.useSupabase && this.supabaseStore) {
      try {
        return await this.supabaseStore.existsByMessageKey(messageKey, userId, jwt);
      } catch {
        return false;
      }
    }
    return false;
  }

  async get(id: string, userId?: string, jwt?: string): Promise<StoredMessage | undefined> {
    await this.initialize();

    if (this.useSupabase && this.supabaseStore) {
      try {
        const result = await this.supabaseStore.get(id, userId, jwt);
        return result ? decryptMessage(result) : result;
      } catch (error: any) {
        console.error('Supabase get failed:', error.message);
      }
    }

    return this.inMemoryStore.get(id);
  }

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
    await this.initialize();

    if (this.useSupabase && this.supabaseStore) {
      try {
        const raw = await this.supabaseStore.getAll(filters);
        // Decrypt content on every message returned (no-op if not encrypted)
        return { ...raw, data: raw.data.map(decryptMessage) };
      } catch (error: any) {
        console.error('Supabase getAll failed (falling back to in-memory):', error.message);
      }
    }

    return this.inMemoryStore.getAll(filters);
  }

  async update(id: string, updates: Partial<StoredMessage>, userId?: string, jwt?: string): Promise<StoredMessage | null> {
    await this.initialize();
    
    if (this.useSupabase && this.supabaseStore) {
      try {
        return await this.supabaseStore.update(id, updates, userId, jwt);
      } catch (error: any) {
        console.error('Supabase update failed:', error.message);
      }
    }
    
    return this.inMemoryStore.update(id, updates);
  }

  async delete(id: string, userId?: string, jwt?: string): Promise<boolean> {
    await this.initialize();
    
    if (this.useSupabase && this.supabaseStore) {
      try {
        return await this.supabaseStore.delete(id, userId, jwt);
      } catch (error: any) {
        console.error('Supabase delete failed:', error.message);
      }
    }
    
    return this.inMemoryStore.delete(id);
  }

  async getStats(userId?: string, jwt?: string): Promise<any> {
    await this.initialize();
    
    if (this.useSupabase && this.supabaseStore) {
      try {
        return await this.supabaseStore.getStats(userId, jwt);
      } catch (error: any) {
        console.error('Supabase getStats failed:', error.message);
      }
    }
    
    return this.inMemoryStore.getStats();
  }

  async clear(userId?: string, jwt?: string): Promise<void> {
    await this.initialize();
    
    if (this.useSupabase && this.supabaseStore && userId) {
      try {
        await this.supabaseStore.clear(userId, jwt);
        return;
      } catch (error: any) {
        console.error('Supabase clear failed:', error.message);
      }
    }
    
    this.inMemoryStore.clear();
  }

  async clearAll(userId?: string, jwt?: string): Promise<number> {
    await this.initialize();
    
    if (this.useSupabase && this.supabaseStore && userId) {
      try {
        const countBefore = await this.supabaseStore.count(userId, jwt);
        await this.supabaseStore.clear(userId, jwt);
        console.log(`🗑️ Cleared ${countBefore} messages from Supabase`);
        return countBefore;
      } catch (error: any) {
        console.error('Supabase clearAll failed:', error.message);
      }
    }
    
    // In-memory clear
    const messages = this.inMemoryStore.getAll({ limit: 10000 });
    const count = messages.total;
    this.inMemoryStore.clear();
    console.log(`🗑️ Cleared ${count} messages from in-memory`);
    return count;
  }

  getStorageType(): string {
    return this.useSupabase ? 'supabase' : 'in-memory';
  }

  /**
   * Flush any in-memory messages to Supabase.
   * Called when a JWT becomes available after server auto-start.
   */
  async flushInMemoryToSupabase(userId: string, jwt: string): Promise<number> {
    await this.initialize();
    if (!this.useSupabase || !this.supabaseStore) return 0;

    const pending = this.inMemoryStore.drainAll();
    if (pending.length === 0) return 0;

    console.log(`🔄 Flushing ${pending.length} in-memory messages to Supabase...`);
    let flushed = 0;
    for (const msg of pending) {
      try {
        const { id, created_at, ...data } = msg;
        const msgToStore = isEncryptionEnabled()
          ? { ...data, content: encryptContent(data.content) }
          : data;
        await this.supabaseStore.add(msgToStore, userId, jwt);
        flushed++;
      } catch (err: any) {
        // Put unflushed messages back
        this.inMemoryStore.add(msg);
        console.error(`⚠️ Flush failed for message ${msg.id}: ${err.message}`);
      }
    }
    if (flushed > 0) {
      console.log(`✅ Flushed ${flushed}/${pending.length} messages to Supabase`);
    }
    return flushed;
  }
}

// Export singleton instance
export const hybridMessageStore = new HybridMessageStore();
