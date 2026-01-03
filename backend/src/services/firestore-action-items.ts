/**
 * Firestore Action Items Service
 * Manages action items extracted from WhatsApp messages using Firebase Firestore
 */

import { db, COLLECTIONS, admin, timestampToISO, isoToTimestamp } from '../config/firebase';
import log from './activity-log';
import { EventEmitter } from 'events';

export interface ActionItem {
  id: string;
  messageId: string | null;
  title: string;
  description: string | null;
  sender: string;
  chatName: string | null;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  category: 'work' | 'study' | 'personal' | 'urgent' | 'other';
  dueDate: string | null;
  dueTime: string | null;
  tags: string[];
  originalMessage: string;
  aiConfidence: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  userId?: string;
}

export interface ActionItemStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  byPriority: {
    urgent: number;
    high: number;
    medium: number;
    low: number;
  };
  byCategory: {
    work: number;
    study: number;
    personal: number;
    urgent: number;
    other: number;
  };
  todayDue: number;
  overdue: number;
}

class FirestoreActionItemsService extends EventEmitter {
  private collection = db.collection(COLLECTIONS.ACTION_ITEMS);

  constructor() {
    super();
  }

  // Create action item from message
  async createFromMessage(
    messageId: string | null,
    content: string,
    sender: string,
    chatName: string | null,
    classification: {
      category: string;
      priority: string;
      decision: string;
      suggestedTask?: string;
      deadline?: string;
    },
    userId?: string
  ): Promise<ActionItem | null> {
    // Only create action items for messages that should become tasks
    if (classification.decision === 'ignore') {
      return null;
    }

    // Parse deadline if provided
    let dueDate: string | null = null;
    let dueTime: string | null = null;
    if (classification.deadline) {
      const parsed = this.parseDeadline(classification.deadline);
      dueDate = parsed.date;
      dueTime = parsed.time;
    }

    // Extract tags from content
    const tags = this.extractTags(content, classification.category);

    const now = admin.firestore.Timestamp.now();
    const docRef = this.collection.doc();

    const actionItemData = {
      messageId,
      title: classification.suggestedTask || this.generateTitle(content),
      description: content.length > 100 ? content : null,
      sender,
      chatName,
      priority: this.mapPriority(classification.priority),
      status: 'pending',
      category: this.mapCategory(classification.category),
      dueDate: dueDate ? isoToTimestamp(dueDate) : null,
      dueTime,
      tags,
      originalMessage: content,
      aiConfidence: classification.decision === 'create' ? 0.9 : 0.6,
      userId: userId || null,
      completedAt: null,
      createdAt: now,
      updatedAt: now
    };

    await docRef.set(actionItemData);

    const actionItem = this.docToActionItem(docRef.id, actionItemData);
    this.emit('created', actionItem);
    
    log.success('Action Item Created', actionItem.title, { 
      id: docRef.id, 
      priority: actionItem.priority,
      category: actionItem.category 
    });

    return actionItem;
  }

  // Create action item manually
  async create(data: Partial<ActionItem> & { title: string }, userId?: string): Promise<ActionItem> {
    const now = admin.firestore.Timestamp.now();
    const docRef = this.collection.doc();

    const actionItemData = {
      messageId: data.messageId || null,
      title: data.title,
      description: data.description || null,
      sender: data.sender || 'Manual',
      chatName: data.chatName || null,
      priority: data.priority || 'medium',
      status: data.status || 'pending',
      category: data.category || 'other',
      dueDate: data.dueDate ? isoToTimestamp(data.dueDate) : null,
      dueTime: data.dueTime || null,
      tags: data.tags || [],
      originalMessage: data.originalMessage || '',
      aiConfidence: data.aiConfidence || 1.0,
      userId: userId || null,
      completedAt: null,
      createdAt: now,
      updatedAt: now
    };

    await docRef.set(actionItemData);

    const actionItem = this.docToActionItem(docRef.id, actionItemData);
    this.emit('created', actionItem);
    
    return actionItem;
  }

  // Get single action item
  async get(id: string): Promise<ActionItem | undefined> {
    const doc = await this.collection.doc(id).get();
    if (!doc.exists) return undefined;
    return this.docToActionItem(doc.id, doc.data()!);
  }

  // Get all action items with filters
  async getAll(filters?: {
    status?: string;
    priority?: string;
    category?: string;
    search?: string;
    dueBefore?: string;
    dueAfter?: string;
    limit?: number;
    offset?: number;
    userId?: string;
  }): Promise<{ data: ActionItem[]; total: number }> {
    let query: FirebaseFirestore.Query = this.collection.orderBy('createdAt', 'desc');

    // Apply filters
    if (filters?.status) {
      query = query.where('status', '==', filters.status);
    }
    if (filters?.priority) {
      query = query.where('priority', '==', filters.priority);
    }
    if (filters?.category) {
      query = query.where('category', '==', filters.category);
    }
    if (filters?.userId) {
      query = query.where('userId', '==', filters.userId);
    }

    // Get documents
    const snapshot = await query.limit(500).get();
    let items = snapshot.docs.map(doc => this.docToActionItem(doc.id, doc.data()));

    // Apply client-side filters
    if (filters?.search) {
      const search = filters.search.toLowerCase();
      items = items.filter(i =>
        i.title.toLowerCase().includes(search) ||
        i.sender.toLowerCase().includes(search) ||
        i.originalMessage.toLowerCase().includes(search) ||
        i.tags.some(t => t.toLowerCase().includes(search))
      );
    }
    if (filters?.dueBefore) {
      items = items.filter(i => i.dueDate && i.dueDate <= filters.dueBefore!);
    }
    if (filters?.dueAfter) {
      items = items.filter(i => i.dueDate && i.dueDate >= filters.dueAfter!);
    }

    const total = items.length;

    // Apply pagination
    const offset = filters?.offset || 0;
    const limit = filters?.limit || 50;
    items = items.slice(offset, offset + limit);

    return { data: items, total };
  }

  // Update action item
  async update(id: string, updates: Partial<ActionItem>): Promise<ActionItem | null> {
    const docRef = this.collection.doc(id);
    const doc = await docRef.get();
    
    if (!doc.exists) return null;

    const updateData: any = {
      ...updates,
      updatedAt: admin.firestore.Timestamp.now()
    };

    // Convert date strings to Timestamps
    if (updates.dueDate !== undefined) {
      updateData.dueDate = updates.dueDate ? isoToTimestamp(updates.dueDate) : null;
    }
    if (updates.completedAt !== undefined) {
      updateData.completedAt = updates.completedAt ? isoToTimestamp(updates.completedAt) : null;
    }

    // Remove fields that shouldn't be updated
    delete updateData.id;
    delete updateData.createdAt;

    await docRef.update(updateData);

    const updated = await docRef.get();
    const actionItem = this.docToActionItem(id, updated.data()!);
    this.emit('updated', actionItem);

    return actionItem;
  }

  // Mark complete
  async complete(id: string): Promise<ActionItem | null> {
    return this.update(id, { 
      status: 'completed', 
      completedAt: new Date().toISOString() 
    });
  }

  // Delete action item
  async delete(id: string): Promise<boolean> {
    try {
      const doc = await this.collection.doc(id).get();
      if (!doc.exists) return false;
      
      await this.collection.doc(id).delete();
      this.emit('deleted', { id });
      return true;
    } catch (e) {
      return false;
    }
  }

  // Get statistics
  async getStats(userId?: string): Promise<ActionItemStats> {
    let query: FirebaseFirestore.Query = this.collection;
    
    if (userId) {
      query = query.where('userId', '==', userId);
    }

    const snapshot = await query.get();
    const items = snapshot.docs.map(doc => this.docToActionItem(doc.id, doc.data()));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const stats: ActionItemStats = {
      total: items.length,
      pending: 0,
      inProgress: 0,
      completed: 0,
      cancelled: 0,
      byPriority: { urgent: 0, high: 0, medium: 0, low: 0 },
      byCategory: { work: 0, study: 0, personal: 0, urgent: 0, other: 0 },
      todayDue: 0,
      overdue: 0
    };

    items.forEach(item => {
      // Status counts
      switch (item.status) {
        case 'pending': stats.pending++; break;
        case 'in_progress': stats.inProgress++; break;
        case 'completed': stats.completed++; break;
        case 'cancelled': stats.cancelled++; break;
      }

      // Priority counts
      if (stats.byPriority[item.priority] !== undefined) {
        stats.byPriority[item.priority]++;
      }

      // Category counts
      if (stats.byCategory[item.category] !== undefined) {
        stats.byCategory[item.category]++;
      }

      // Due date analysis
      if (item.dueDate) {
        const dueDate = item.dueDate.split('T')[0];
        if (dueDate === todayStr) {
          stats.todayDue++;
        } else if (dueDate < todayStr && item.status !== 'completed') {
          stats.overdue++;
        }
      }
    });

    return stats;
  }

  // Helper methods
  private parseDeadline(deadline: string): { date: string | null; time: string | null } {
    try {
      const date = new Date(deadline);
      if (isNaN(date.getTime())) return { date: null, time: null };
      
      return {
        date: date.toISOString(),
        time: date.toTimeString().slice(0, 5)
      };
    } catch {
      return { date: null, time: null };
    }
  }

  private extractTags(content: string, category: string): string[] {
    const tags: string[] = [];
    if (category) tags.push(category);
    
    const words = content.toLowerCase().split(/\s+/);
    const keywords = ['urgent', 'asap', 'important', 'deadline', 'meeting', 'call', 'email', 'review'];
    words.forEach(word => {
      if (keywords.includes(word) && !tags.includes(word)) {
        tags.push(word);
      }
    });
    
    return tags.slice(0, 5);
  }

  private generateTitle(content: string): string {
    const cleaned = content.replace(/\n/g, ' ').trim();
    if (cleaned.length <= 80) return cleaned;
    return cleaned.slice(0, 77) + '...';
  }

  private mapPriority(priority: string): 'urgent' | 'high' | 'medium' | 'low' {
    const map: Record<string, 'urgent' | 'high' | 'medium' | 'low'> = {
      urgent: 'urgent',
      high: 'high',
      medium: 'medium',
      low: 'low'
    };
    return map[priority?.toLowerCase()] || 'medium';
  }

  private mapCategory(category: string): 'work' | 'study' | 'personal' | 'urgent' | 'other' {
    const map: Record<string, 'work' | 'study' | 'personal' | 'urgent' | 'other'> = {
      work: 'work',
      study: 'study',
      personal: 'personal',
      urgent: 'urgent',
      other: 'other'
    };
    return map[category?.toLowerCase()] || 'other';
  }

  private docToActionItem(id: string, data: FirebaseFirestore.DocumentData): ActionItem {
    return {
      id,
      messageId: data.messageId,
      title: data.title,
      description: data.description,
      sender: data.sender,
      chatName: data.chatName,
      priority: data.priority,
      status: data.status,
      category: data.category,
      dueDate: timestampToISO(data.dueDate),
      dueTime: data.dueTime,
      tags: data.tags || [],
      originalMessage: data.originalMessage,
      aiConfidence: data.aiConfidence,
      createdAt: timestampToISO(data.createdAt) || new Date().toISOString(),
      updatedAt: timestampToISO(data.updatedAt) || new Date().toISOString(),
      completedAt: timestampToISO(data.completedAt),
      userId: data.userId
    };
  }
}

// Export singleton instance
export const firestoreActionItems = new FirestoreActionItemsService();
export default firestoreActionItems;
