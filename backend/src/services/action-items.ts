/**
 * Action Items Service
 * Manages action items extracted from WhatsApp messages using AI
 */

import { classifyWithAI } from './ai-classifier';
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

class ActionItemsService extends EventEmitter {
  private items: Map<string, ActionItem> = new Map();
  private idCounter: number = 1;

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
    }
  ): Promise<ActionItem | null> {
    // Only create action items for messages that should become tasks
    if (classification.decision === 'ignore') {
      return null;
    }

    const id = `action-${Date.now()}-${this.idCounter++}`;
    
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

    const actionItem: ActionItem = {
      id,
      messageId,
      title: classification.suggestedTask || this.generateTitle(content),
      description: content.length > 100 ? content : null,
      sender,
      chatName,
      priority: this.mapPriority(classification.priority),
      status: 'pending',
      category: this.mapCategory(classification.category),
      dueDate,
      dueTime,
      tags,
      originalMessage: content,
      aiConfidence: classification.decision === 'create' ? 0.9 : 0.6,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };

    this.items.set(id, actionItem);
    this.emit('created', actionItem);
    
    log.success('Action Item Created', actionItem.title, { 
      id, 
      priority: actionItem.priority,
      category: actionItem.category 
    });

    return actionItem;
  }

  // Create action item manually
  create(data: Partial<ActionItem> & { title: string }): ActionItem {
    const id = `action-${Date.now()}-${this.idCounter++}`;
    
    const actionItem: ActionItem = {
      id,
      messageId: data.messageId || null,
      title: data.title,
      description: data.description || null,
      sender: data.sender || 'Manual',
      chatName: data.chatName || null,
      priority: data.priority || 'medium',
      status: data.status || 'pending',
      category: data.category || 'other',
      dueDate: data.dueDate || null,
      dueTime: data.dueTime || null,
      tags: data.tags || [],
      originalMessage: data.originalMessage || '',
      aiConfidence: data.aiConfidence || 1.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };

    this.items.set(id, actionItem);
    this.emit('created', actionItem);
    
    return actionItem;
  }

  // Get single action item
  get(id: string): ActionItem | undefined {
    return this.items.get(id);
  }

  // Get all action items with filters
  getAll(filters?: {
    status?: string;
    priority?: string;
    category?: string;
    search?: string;
    dueBefore?: string;
    dueAfter?: string;
    limit?: number;
    offset?: number;
  }): { data: ActionItem[]; total: number } {
    let items = Array.from(this.items.values()).reverse(); // Newest first

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
    const limit = filters?.limit || 100;
    items = items.slice(offset, offset + limit);

    return { data: items, total };
  }

  // Update action item
  update(id: string, updates: Partial<ActionItem>): ActionItem | null {
    const item = this.items.get(id);
    if (!item) return null;

    const wasCompleted = item.status !== 'completed' && updates.status === 'completed';

    const updated: ActionItem = {
      ...item,
      ...updates,
      updatedAt: new Date().toISOString(),
      completedAt: wasCompleted ? new Date().toISOString() : item.completedAt
    };

    this.items.set(id, updated);
    this.emit('updated', updated);

    return updated;
  }

  // Delete action item
  delete(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;

    this.items.delete(id);
    this.emit('deleted', { id });

    return true;
  }

  // Mark as complete
  complete(id: string): ActionItem | null {
    return this.update(id, { 
      status: 'completed',
      completedAt: new Date().toISOString()
    });
  }

  // Get statistics
  getStats(): ActionItemStats {
    const items = Array.from(this.items.values());
    const today = new Date().toISOString().split('T')[0];

    const stats: ActionItemStats = {
      total: items.length,
      pending: items.filter(i => i.status === 'pending').length,
      inProgress: items.filter(i => i.status === 'in_progress').length,
      completed: items.filter(i => i.status === 'completed').length,
      cancelled: items.filter(i => i.status === 'cancelled').length,
      byPriority: {
        urgent: items.filter(i => i.priority === 'urgent').length,
        high: items.filter(i => i.priority === 'high').length,
        medium: items.filter(i => i.priority === 'medium').length,
        low: items.filter(i => i.priority === 'low').length
      },
      byCategory: {
        work: items.filter(i => i.category === 'work').length,
        study: items.filter(i => i.category === 'study').length,
        personal: items.filter(i => i.category === 'personal').length,
        urgent: items.filter(i => i.category === 'urgent').length,
        other: items.filter(i => i.category === 'other').length
      },
      todayDue: items.filter(i => i.dueDate === today && i.status !== 'completed').length,
      overdue: items.filter(i => i.dueDate && i.dueDate < today && i.status !== 'completed').length
    };

    return stats;
  }

  // Helper: Parse deadline string to date/time
  private parseDeadline(deadline: string): { date: string | null; time: string | null } {
    const lower = deadline.toLowerCase();
    const now = new Date();
    
    // Relative dates
    if (lower.includes('today')) {
      return { date: now.toISOString().split('T')[0], time: null };
    }
    if (lower.includes('tomorrow')) {
      now.setDate(now.getDate() + 1);
      return { date: now.toISOString().split('T')[0], time: null };
    }
    if (lower.includes('next week')) {
      now.setDate(now.getDate() + 7);
      return { date: now.toISOString().split('T')[0], time: null };
    }

    // Try to extract time
    const timeMatch = deadline.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    let time: string | null = null;
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3]?.toLowerCase();
      
      if (period === 'pm' && hours < 12) hours += 12;
      if (period === 'am' && hours === 12) hours = 0;
      
      time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    // Try to parse date
    const dateMatch = deadline.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    let date: string | null = null;
    if (dateMatch) {
      const month = parseInt(dateMatch[1]);
      const day = parseInt(dateMatch[2]);
      const year = dateMatch[3] ? parseInt(dateMatch[3]) : now.getFullYear();
      const fullYear = year < 100 ? 2000 + year : year;
      date = `${fullYear}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    }

    return { date, time };
  }

  // Helper: Generate title from content
  private generateTitle(content: string): string {
    // Take first sentence or first 60 chars
    const firstSentence = content.split(/[.!?]/)[0].trim();
    if (firstSentence.length <= 60) return firstSentence;
    return content.substring(0, 57).trim() + '...';
  }

  // Helper: Extract relevant tags
  private extractTags(content: string, category: string): string[] {
    const tags: string[] = [];
    const lower = content.toLowerCase();

    // Category tag
    if (category !== 'other') tags.push(category);

    // Common action tags
    if (lower.includes('meeting')) tags.push('meeting');
    if (lower.includes('call')) tags.push('call');
    if (lower.includes('email')) tags.push('email');
    if (lower.includes('deadline')) tags.push('deadline');
    if (lower.includes('review')) tags.push('review');
    if (lower.includes('submit')) tags.push('submit');
    if (lower.includes('presentation')) tags.push('presentation');
    if (lower.includes('report')) tags.push('report');
    if (lower.includes('exam') || lower.includes('test')) tags.push('exam');
    if (lower.includes('assignment')) tags.push('assignment');
    if (lower.includes('reminder')) tags.push('reminder');

    return [...new Set(tags)]; // Remove duplicates
  }

  // Helper: Map priority string
  private mapPriority(priority: string): 'urgent' | 'high' | 'medium' | 'low' {
    const map: Record<string, 'urgent' | 'high' | 'medium' | 'low'> = {
      'high': 'high',
      'medium': 'medium',
      'low': 'low',
      'none': 'low',
      'urgent': 'urgent'
    };
    return map[priority] || 'medium';
  }

  // Helper: Map category string
  private mapCategory(category: string): 'work' | 'study' | 'personal' | 'urgent' | 'other' {
    const map: Record<string, 'work' | 'study' | 'personal' | 'urgent' | 'other'> = {
      'work': 'work',
      'study': 'study',
      'personal': 'personal',
      'urgent': 'urgent',
      'casual': 'other',
      'spam': 'other'
    };
    return map[category] || 'other';
  }

  // Clear all (for testing)
  clear(): void {
    this.items.clear();
    this.idCounter = 1;
  }
}

// Singleton instance
export const actionItems = new ActionItemsService();
export default actionItems;
