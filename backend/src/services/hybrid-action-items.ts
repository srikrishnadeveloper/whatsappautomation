/**
 * Hybrid Action Items Store
 * Uses Firestore when credentials are available, falls back to in-memory storage
 */

export interface ActionItem {
  id: string;
  messageId: string | null;
  title: string;
  description: string | null;
  sender: string | null;
  chatName: string | null;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  category: 'work' | 'study' | 'personal' | 'urgent' | 'other';
  dueDate: string | null;
  dueTime: string | null;
  tags: string[];
  originalMessage: string | null;
  aiConfidence: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ActionItemStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  byPriority: Record<string, number>;
  byCategory: Record<string, number>;
  todayDue: number;
  overdue: number;
}

// In-memory fallback store
class InMemoryActionItemsStore {
  private items: Map<string, ActionItem> = new Map();
  private idCounter: number = 1;

  async add(item: Omit<ActionItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<ActionItem> {
    const id = `action-${Date.now()}-${this.idCounter++}`;
    const now = new Date().toISOString();
    const actionItem: ActionItem = {
      ...item,
      id,
      createdAt: now,
      updatedAt: now
    };
    this.items.set(id, actionItem);
    return actionItem;
  }

  async get(id: string): Promise<ActionItem | undefined> {
    return this.items.get(id);
  }

  async getAll(filters?: {
    status?: string;
    priority?: string;
    category?: string;
    search?: string;
    dueBefore?: string;
    dueAfter?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: ActionItem[]; total: number }> {
    let items = Array.from(this.items.values());

    // Apply filters
    if (filters?.status) {
      items = items.filter(i => i.status === filters.status);
    }
    if (filters?.priority) {
      items = items.filter(i => i.priority === filters.priority);
    }
    if (filters?.category) {
      items = items.filter(i => i.category === filters.category);
    }
    if (filters?.search) {
      const search = filters.search.toLowerCase();
      items = items.filter(i => 
        i.title.toLowerCase().includes(search) ||
        (i.description?.toLowerCase().includes(search))
      );
    }

    // Sort by created date (newest first)
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = items.length;
    const offset = filters?.offset || 0;
    const limit = filters?.limit || 50;
    items = items.slice(offset, offset + limit);

    return { data: items, total };
  }

  async update(id: string, updates: Partial<ActionItem>): Promise<ActionItem | null> {
    const item = this.items.get(id);
    if (!item) return null;
    const updated = { 
      ...item, 
      ...updates, 
      updatedAt: new Date().toISOString() 
    };
    this.items.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.items.delete(id);
  }

  async complete(id: string): Promise<ActionItem | null> {
    const item = this.items.get(id);
    if (!item) return null;
    const now = new Date().toISOString();
    const updated = { 
      ...item, 
      status: 'completed' as const,
      completedAt: now,
      updatedAt: now
    };
    this.items.set(id, updated);
    return updated;
  }

  async getStats(): Promise<ActionItemStats> {
    const items = Array.from(this.items.values());
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const stats: ActionItemStats = {
      total: items.length,
      pending: items.filter(i => i.status === 'pending').length,
      inProgress: items.filter(i => i.status === 'in_progress').length,
      completed: items.filter(i => i.status === 'completed').length,
      cancelled: items.filter(i => i.status === 'cancelled').length,
      byPriority: {},
      byCategory: {},
      todayDue: 0,
      overdue: 0
    };

    items.forEach(item => {
      stats.byPriority[item.priority] = (stats.byPriority[item.priority] || 0) + 1;
      stats.byCategory[item.category] = (stats.byCategory[item.category] || 0) + 1;
      
      if (item.dueDate && item.status !== 'completed') {
        const dueDate = new Date(item.dueDate);
        if (dueDate < today) {
          stats.overdue++;
        } else if (dueDate.toDateString() === today.toDateString()) {
          stats.todayDue++;
        }
      }
    });

    return stats;
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

// Hybrid store that tries Firestore first, then falls back to in-memory
class HybridActionItemsStore {
  private inMemoryStore = new InMemoryActionItemsStore();
  private firestoreStore: any = null;
  private useFirestore: boolean = false;
  private initialized: boolean = false;

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (hasFirebaseCredentials()) {
      try {
        const { firestoreActionItems } = await import('./firestore-action-items');
        this.firestoreStore = firestoreActionItems;
        this.useFirestore = true;
        console.log('✅ Hybrid Store: Using Firestore for action items');
      } catch (error) {
        console.log('⚠️ Hybrid Store: Firestore action items failed, using in-memory');
        this.useFirestore = false;
      }
    } else {
      console.log('📦 Hybrid Store: Using in-memory storage for action items');
      this.useFirestore = false;
    }
  }

  private async handleFirestoreError(error: any): Promise<boolean> {
    if (error.message?.includes('Could not load the default credentials')) {
      console.log('⚠️ Firestore credentials issue, falling back to in-memory');
      this.useFirestore = false;
      return true;
    }
    return false;
  }

  async add(item: Omit<ActionItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<ActionItem> {
    await this.initialize();
    
    if (this.useFirestore && this.firestoreStore) {
      try {
        return await this.firestoreStore.add(item);
      } catch (error: any) {
        if (await this.handleFirestoreError(error)) {
          return this.inMemoryStore.add(item);
        }
        throw error;
      }
    }
    
    return this.inMemoryStore.add(item);
  }

  async get(id: string): Promise<ActionItem | undefined> {
    await this.initialize();
    
    if (this.useFirestore && this.firestoreStore) {
      try {
        return await this.firestoreStore.get(id);
      } catch (error: any) {
        await this.handleFirestoreError(error);
      }
    }
    
    return this.inMemoryStore.get(id);
  }

  async getAll(filters?: {
    status?: string;
    priority?: string;
    category?: string;
    search?: string;
    dueBefore?: string;
    dueAfter?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: ActionItem[]; total: number }> {
    await this.initialize();
    
    if (this.useFirestore && this.firestoreStore) {
      try {
        return await this.firestoreStore.getAll(filters);
      } catch (error: any) {
        if (await this.handleFirestoreError(error)) {
          return this.inMemoryStore.getAll(filters);
        }
        throw error;
      }
    }
    
    return this.inMemoryStore.getAll(filters);
  }

  async update(id: string, updates: Partial<ActionItem>): Promise<ActionItem | null> {
    await this.initialize();
    
    if (this.useFirestore && this.firestoreStore) {
      try {
        return await this.firestoreStore.update(id, updates);
      } catch (error: any) {
        await this.handleFirestoreError(error);
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
        await this.handleFirestoreError(error);
      }
    }
    
    return this.inMemoryStore.delete(id);
  }

  async complete(id: string): Promise<ActionItem | null> {
    await this.initialize();
    
    if (this.useFirestore && this.firestoreStore) {
      try {
        return await this.firestoreStore.complete(id);
      } catch (error: any) {
        await this.handleFirestoreError(error);
      }
    }
    
    return this.inMemoryStore.complete(id);
  }

  async getStats(): Promise<ActionItemStats> {
    await this.initialize();
    
    if (this.useFirestore && this.firestoreStore) {
      try {
        return await this.firestoreStore.getStats();
      } catch (error: any) {
        if (await this.handleFirestoreError(error)) {
          return this.inMemoryStore.getStats();
        }
      }
    }
    
    return this.inMemoryStore.getStats();
  }

  getStorageType(): string {
    return this.useFirestore ? 'firestore' : 'in-memory';
  }
}

// Export singleton
export const hybridActionItems = new HybridActionItemsStore();
