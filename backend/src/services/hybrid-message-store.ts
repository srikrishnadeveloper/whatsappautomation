/**
 * Hybrid Message Store
 * Uses Firestore when credentials are available, falls back to in-memory storage
 */

import { StoredMessage } from './message-store';

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
      const search = filters.search.toLowerCase();
      messages = messages.filter(m => 
        m.content.toLowerCase().includes(search) ||
        m.sender.toLowerCase().includes(search)
      );
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
}

// Check if Firebase credentials are available
function hasFirebaseCredentials(): boolean {
  try {
    const fs = require('fs');
    const path = require('path');
    const serviceAccountPath = path.join(__dirname, '../../firebase-service-account.json');
    return fs.existsSync(serviceAccountPath) || !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
  } catch {
    return false;
  }
}

// Create the hybrid store
class HybridMessageStore {
  private inMemoryStore = new InMemoryMessageStore();
  private firestoreStore: any = null;
  private useFirestore: boolean = false;
  private initialized: boolean = false;

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (hasFirebaseCredentials()) {
      try {
        // Dynamically import Firestore store only if credentials exist
        const { firestoreMessageStore } = await import('./firestore-message-store');
        this.firestoreStore = firestoreMessageStore;
        this.useFirestore = true;
        console.log('✅ Hybrid Store: Using Firestore for messages');
      } catch (error) {
        console.log('⚠️ Hybrid Store: Firestore failed, using in-memory storage');
        this.useFirestore = false;
      }
    } else {
      console.log('📦 Hybrid Store: Using in-memory storage (no Firebase credentials)');
      this.useFirestore = false;
    }
  }

  async add(message: Omit<StoredMessage, 'id' | 'created_at'>, userId?: string): Promise<StoredMessage> {
    await this.initialize();
    
    if (this.useFirestore && this.firestoreStore) {
      try {
        return await this.firestoreStore.add(message, userId);
      } catch (error: any) {
        // If Firestore fails at runtime, fall back to in-memory
        if (error.message?.includes('Could not load the default credentials')) {
          console.log('⚠️ Firestore credentials expired, falling back to in-memory');
          this.useFirestore = false;
        } else {
          throw error;
        }
      }
    }
    
    return this.inMemoryStore.add(message);
  }

  async get(id: string): Promise<StoredMessage | undefined> {
    await this.initialize();
    
    if (this.useFirestore && this.firestoreStore) {
      try {
        return await this.firestoreStore.get(id);
      } catch (error: any) {
        if (error.message?.includes('Could not load the default credentials')) {
          this.useFirestore = false;
        }
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
  }): Promise<{ data: StoredMessage[]; total: number }> {
    await this.initialize();
    
    if (this.useFirestore && this.firestoreStore) {
      try {
        return await this.firestoreStore.getAll(filters);
      } catch (error: any) {
        if (error.message?.includes('Could not load the default credentials')) {
          console.log('⚠️ Firestore credentials issue, falling back to in-memory');
          this.useFirestore = false;
        } else {
          throw error;
        }
      }
    }
    
    return this.inMemoryStore.getAll(filters);
  }

  async update(id: string, updates: Partial<StoredMessage>): Promise<StoredMessage | null> {
    await this.initialize();
    
    if (this.useFirestore && this.firestoreStore) {
      try {
        return await this.firestoreStore.update(id, updates);
      } catch (error: any) {
        if (error.message?.includes('Could not load the default credentials')) {
          this.useFirestore = false;
        }
      }
    }
    
    return this.inMemoryStore.update(id, updates);
  }

  async delete(id: string): Promise<boolean> {
    await this.initialize();
    
    if (this.useFirestore && this.firestoreStore) {
      try {
        return await this.firestoreStore.delete(id);
      } catch (error: any) {
        if (error.message?.includes('Could not load the default credentials')) {
          this.useFirestore = false;
        }
      }
    }
    
    return this.inMemoryStore.delete(id);
  }

  async getStats(): Promise<any> {
    await this.initialize();
    
    if (this.useFirestore && this.firestoreStore) {
      try {
        return await this.firestoreStore.getStats();
      } catch (error: any) {
        if (error.message?.includes('Could not load the default credentials')) {
          this.useFirestore = false;
        }
      }
    }
    
    return this.inMemoryStore.getStats();
  }

  async clear(): Promise<void> {
    await this.initialize();
    
    if (this.useFirestore && this.firestoreStore) {
      try {
        await this.firestoreStore.clear();
        return;
      } catch (error: any) {
        if (error.message?.includes('Could not load the default credentials')) {
          this.useFirestore = false;
        }
      }
    }
    
    this.inMemoryStore.clear();
  }

  getStorageType(): string {
    return this.useFirestore ? 'firestore' : 'in-memory';
  }
}

// Export singleton instance
export const hybridMessageStore = new HybridMessageStore();
