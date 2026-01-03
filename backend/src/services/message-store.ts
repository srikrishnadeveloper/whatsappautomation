/**
 * In-Memory Message Store
 * Used when Supabase is not configured - provides full functionality without database
 */

export interface StoredMessage {
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
  created_at: string;
  metadata?: any;
}

class MessageStore {
  private messages: Map<string, StoredMessage> = new Map();
  private idCounter: number = 1;

  // Add a message
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

  // Get a single message
  get(id: string): StoredMessage | undefined {
    return this.messages.get(id);
  }

  // Get all messages with optional filters
  getAll(filters?: {
    classification?: string;
    decision?: string;
    priority?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): { data: StoredMessage[]; total: number } {
    let messages = Array.from(this.messages.values()).reverse(); // Newest first

    // Apply filters
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
      const search = filters.search.toLowerCase();
      messages = messages.filter(m => 
        m.content.toLowerCase().includes(search) ||
        m.sender.toLowerCase().includes(search)
      );
    }

    const total = messages.length;

    // Apply pagination
    const offset = filters?.offset || 0;
    const limit = filters?.limit || 50;
    messages = messages.slice(offset, offset + limit);

    return { data: messages, total };
  }

  // Update a message
  update(id: string, updates: Partial<StoredMessage>): StoredMessage | null {
    const message = this.messages.get(id);
    if (!message) return null;

    const updated = { ...message, ...updates };
    this.messages.set(id, updated);
    return updated;
  }

  // Delete a message
  delete(id: string): boolean {
    return this.messages.delete(id);
  }

  // Get statistics
  getStats(): {
    overview: {
      total_messages: number;
      recent_24h: number;
      tasks_created: number;
      pending_review: number;
    };
    by_classification: Record<string, number>;
    by_decision: Record<string, number>;
    by_priority: Record<string, number>;
  } {
    const messages = Array.from(this.messages.values());
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const by_classification: Record<string, number> = {};
    const by_decision: Record<string, number> = {};
    const by_priority: Record<string, number> = {};
    let recent_24h = 0;
    let tasks_created = 0;
    let pending_review = 0;

    messages.forEach(m => {
      // Recent count
      if (new Date(m.created_at) > oneDayAgo) recent_24h++;

      // Classification counts
      const cat = m.classification || 'unclassified';
      by_classification[cat] = (by_classification[cat] || 0) + 1;

      // Decision counts
      const dec = m.decision || 'pending';
      by_decision[dec] = (by_decision[dec] || 0) + 1;
      if (dec === 'create') tasks_created++;
      if (dec === 'review') pending_review++;

      // Priority counts
      const pri = m.priority || 'none';
      by_priority[pri] = (by_priority[pri] || 0) + 1;
    });

    return {
      overview: {
        total_messages: messages.length,
        recent_24h,
        tasks_created,
        pending_review
      },
      by_classification,
      by_decision,
      by_priority
    };
  }

  // Clear all messages
  clear(): void {
    this.messages.clear();
    this.idCounter = 1;
  }

  // Get count
  count(): number {
    return this.messages.size;
  }
}

// Singleton instance
export const messageStore = new MessageStore();
export default messageStore;
