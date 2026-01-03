/**
 * Firestore Message Store
 * Stores and retrieves WhatsApp messages using Firebase Firestore
 */

import { db, COLLECTIONS, admin, timestampToISO } from '../config/firebase';

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
  userId?: string;
}

class FirestoreMessageStore {
  private collection = db.collection(COLLECTIONS.MESSAGES);

  // Add a message
  async add(message: Omit<StoredMessage, 'id' | 'created_at'>, userId?: string): Promise<StoredMessage> {
    const now = admin.firestore.Timestamp.now();
    const docRef = this.collection.doc();
    
    const messageData = {
      ...message,
      userId: userId || null,
      createdAt: now,
      updatedAt: now
    };

    await docRef.set(messageData);
    
    return {
      ...message,
      id: docRef.id,
      created_at: now.toDate().toISOString()
    };
  }

  // Get a single message
  async get(id: string): Promise<StoredMessage | undefined> {
    const doc = await this.collection.doc(id).get();
    if (!doc.exists) return undefined;

    const data = doc.data()!;
    return this.docToMessage(doc.id, data);
  }

  // Get all messages with optional filters
  async getAll(filters?: {
    classification?: string;
    decision?: string;
    priority?: string;
    search?: string;
    limit?: number;
    offset?: number;
    userId?: string;
  }): Promise<{ data: StoredMessage[]; total: number }> {
    let query: FirebaseFirestore.Query = this.collection.orderBy('createdAt', 'desc');

    // Apply filters
    if (filters?.classification) {
      query = query.where('classification', '==', filters.classification);
    }
    if (filters?.decision) {
      query = query.where('decision', '==', filters.decision);
    }
    if (filters?.priority) {
      query = query.where('priority', '==', filters.priority);
    }
    if (filters?.userId) {
      query = query.where('userId', '==', filters.userId);
    }

    // Get total count (limited approach due to Firestore limitations)
    const countSnapshot = await query.limit(1000).get();
    const total = countSnapshot.size;

    // Apply pagination
    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    let paginatedQuery = query.limit(limit);
    
    // Skip offset documents (Firestore doesn't support offset, so we use startAfter)
    if (offset > 0) {
      const skipDocs = await query.limit(offset).get();
      if (!skipDocs.empty) {
        const lastDoc = skipDocs.docs[skipDocs.docs.length - 1];
        paginatedQuery = query.startAfter(lastDoc).limit(limit);
      }
    }

    const snapshot = await paginatedQuery.get();
    let messages = snapshot.docs.map(doc => this.docToMessage(doc.id, doc.data()));

    // Apply search filter client-side (Firestore doesn't support full-text search)
    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      messages = messages.filter(m =>
        m.content.toLowerCase().includes(searchLower) ||
        m.sender.toLowerCase().includes(searchLower)
      );
    }

    return { data: messages, total };
  }

  // Update a message
  async update(id: string, updates: Partial<StoredMessage>): Promise<StoredMessage | null> {
    const docRef = this.collection.doc(id);
    const doc = await docRef.get();
    
    if (!doc.exists) return null;

    const updateData: any = { ...updates, updatedAt: admin.firestore.Timestamp.now() };
    
    // Remove fields that shouldn't be updated directly
    delete updateData.id;
    delete updateData.created_at;

    await docRef.update(updateData);
    
    const updated = await docRef.get();
    return this.docToMessage(id, updated.data()!);
  }

  // Delete a message
  async delete(id: string): Promise<boolean> {
    try {
      await this.collection.doc(id).delete();
      return true;
    } catch (e) {
      return false;
    }
  }

  // Get statistics
  async getStats(userId?: string): Promise<{
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
    let query: FirebaseFirestore.Query = this.collection;
    
    if (userId) {
      query = query.where('userId', '==', userId);
    }

    const snapshot = await query.limit(1000).get();
    const messages = snapshot.docs.map(doc => doc.data());

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
      const createdAt = m.createdAt?.toDate?.() || new Date(m.created_at);
      if (createdAt > oneDayAgo) recent_24h++;

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

  // Clear all messages (for a user or all)
  async clear(userId?: string): Promise<void> {
    let query: FirebaseFirestore.Query = this.collection;
    
    if (userId) {
      query = query.where('userId', '==', userId);
    }

    const snapshot = await query.get();
    const batch = db.batch();
    
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
  }

  // Helper to convert Firestore doc to StoredMessage
  private docToMessage(id: string, data: FirebaseFirestore.DocumentData): StoredMessage {
    return {
      id,
      sender: data.sender,
      chat_name: data.chat_name || data.chatName,
      timestamp: timestampToISO(data.timestamp) || data.timestamp,
      content: data.content,
      message_type: data.message_type || data.messageType || 'text',
      classification: data.classification,
      decision: data.decision,
      priority: data.priority,
      ai_reasoning: data.ai_reasoning || data.aiReasoning,
      created_at: timestampToISO(data.createdAt) || data.created_at,
      metadata: data.metadata,
      userId: data.userId
    };
  }
}

// Export singleton instance
export const firestoreMessageStore = new FirestoreMessageStore();
export default firestoreMessageStore;
