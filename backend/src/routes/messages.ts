/**
 * Messages API Routes
 * CRUD operations for WhatsApp messages
 * Supports both Supabase and in-memory storage
 */

import { Router } from 'express';
import { supabase, Message } from '../config/supabase';
import { messageStore } from '../services/message-store';

const router = Router();

// GET /api/messages - List all messages with filtering
router.get('/', async (req, res) => {
  try {
    // If Supabase not configured, use in-memory store
    if (!supabase) {
      const { classification, decision, priority, search, limit = 50, offset = 0 } = req.query;
      
      const result = messageStore.getAll({
        classification: classification as string,
        decision: decision as string,
        priority: priority as string,
        search: search as string,
        limit: Number(limit),
        offset: Number(offset)
      });
      
      return res.json({
        success: true,
        data: result.data,
        pagination: {
          total: result.total,
          limit: Number(limit),
          offset: Number(offset),
          hasMore: result.total > Number(offset) + Number(limit)
        },
        storage: 'memory'
      });
    }

    const { 
      classification, 
      decision, 
      priority,
      search,
      limit = 50, 
      offset = 0,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    let query = supabase
      .from('messages')
      .select('*', { count: 'exact' });

    // Apply filters
    if (classification) {
      query = query.eq('classification', classification);
    }
    if (decision) {
      query = query.eq('decision', decision);
    }
    if (priority) {
      query = query.eq('priority', priority);
    }
    if (search) {
      query = query.ilike('content', `%${search}%`);
    }

    // Sorting and pagination
    query = query
      .order(sortBy as string, { ascending: sortOrder === 'asc' })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      success: true,
      data: data || [],
      pagination: {
        total: count || 0,
        limit: Number(limit),
        offset: Number(offset),
        hasMore: (count || 0) > Number(offset) + Number(limit)
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/messages/:id - Get single message
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Memory mode
    if (!supabase) {
      const msg = messageStore.get(id);
      if (!msg) {
        return res.status(404).json({ success: false, error: 'Message not found' });
      }
      return res.json({ success: true, data: msg, storage: 'memory' });
    }

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    res.json({
      success: true,
      data
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/messages - Create new message
router.post('/', async (req, res) => {
  try {
    const {
      sender,
      chat_name,
      content,
      message_type = 'text',
      classification,
      decision,
      priority,
      ai_reasoning,
      metadata
    } = req.body;

    if (!sender || !content) {
      return res.status(400).json({
        success: false,
        error: 'sender and content are required'
      });
    }

    // Memory mode
    if (!supabase) {
      const newMsg = messageStore.add({
        sender,
        chat_name,
        timestamp: new Date().toISOString(),
        content,
        message_type,
        classification,
        decision,
        priority,
        ai_reasoning,
        metadata: metadata || {}
      });
      return res.status(201).json({ success: true, data: newMsg, storage: 'memory' });
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({
        sender,
        chat_name,
        content,
        message_type,
        classification,
        decision,
        priority,
        ai_reasoning,
        metadata: metadata || {},
        timestamp: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      data
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// PATCH /api/messages/:id - Update message (e.g., change classification)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Only allow certain fields to be updated
    const allowedFields = ['classification', 'decision', 'priority', 'notion_page_id', 'ai_reasoning'];
    const filteredUpdates: any = {};
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    // Memory mode
    if (!supabase) {
      const updated = messageStore.update(id, filteredUpdates);
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Message not found' });
      }
      return res.json({ success: true, data: updated, storage: 'memory' });
    }

    const { data, error } = await supabase
      .from('messages')
      .update(filteredUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// DELETE /api/messages/:id - Delete message
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Memory mode
    if (!supabase) {
      const deleted = messageStore.delete(id);
      if (!deleted) {
        return res.status(404).json({ success: false, error: 'Message not found' });
      }
      return res.json({ success: true, message: 'Message deleted', storage: 'memory' });
    }

    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Message deleted'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
