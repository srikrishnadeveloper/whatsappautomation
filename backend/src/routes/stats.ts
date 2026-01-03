/**
 * Statistics API Route
 * Get analytics and stats about messages
 */

import { Router } from 'express';
import { supabase } from '../config/supabase';
import { messageStore } from '../services/message-store';

const router = Router();

// GET /api/stats - Get overall statistics
router.get('/', async (req, res) => {
  try {
    // Memory mode - use message store
    if (!supabase) {
      const stats = messageStore.getStats();
      return res.json({
        success: true,
        data: {
          ...stats,
          timestamp: new Date().toISOString()
        },
        storage: 'memory'
      });
    }

    // Get total count
    const { count: totalCount } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true });

    // Get counts by classification
    const { data: classificationCounts } = await supabase
      .from('messages')
      .select('classification');

    // Get counts by decision
    const { data: decisionCounts } = await supabase
      .from('messages')
      .select('decision');

    // Get counts by priority
    const { data: priorityCounts } = await supabase
      .from('messages')
      .select('priority');

    // Calculate distributions
    const classificationDist: Record<string, number> = {};
    const decisionDist: Record<string, number> = {};
    const priorityDist: Record<string, number> = {};

    classificationCounts?.forEach((m: any) => {
      const key = m.classification || 'unclassified';
      classificationDist[key] = (classificationDist[key] || 0) + 1;
    });

    decisionCounts?.forEach((m: any) => {
      const key = m.decision || 'pending';
      decisionDist[key] = (decisionDist[key] || 0) + 1;
    });

    priorityCounts?.forEach((m: any) => {
      const key = m.priority || 'none';
      priorityDist[key] = (priorityDist[key] || 0) + 1;
    });

    // Get recent messages count (last 24 hours)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', yesterday);

    // Get tasks created count
    const { count: tasksCount } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('decision', 'create');

    res.json({
      success: true,
      data: {
        overview: {
          total_messages: totalCount || 0,
          recent_24h: recentCount || 0,
          tasks_created: tasksCount || 0,
          pending_review: decisionDist['review'] || 0
        },
        by_classification: classificationDist,
        by_decision: decisionDist,
        by_priority: priorityDist,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/stats/timeline - Get message counts by date
router.get('/timeline', async (req, res) => {
  try {
    // Memory mode - generate timeline from message store
    if (!supabase) {
      const { data: messages } = messageStore.getAll({ limit: 1000 });
      const timeline: Record<string, { total: number; work: number; study: number; ignore: number }> = {};
      
      messages.forEach((m: any) => {
        const date = m.created_at.split('T')[0];
        if (!timeline[date]) {
          timeline[date] = { total: 0, work: 0, study: 0, ignore: 0 };
        }
        timeline[date].total++;
        if (m.classification === 'work') timeline[date].work++;
        if (m.classification === 'study') timeline[date].study++;
        if (m.classification === 'ignore') timeline[date].ignore++;
      });

      return res.json({
        success: true,
        data: Object.entries(timeline).map(([date, counts]) => ({
          date,
          ...counts
        })),
        storage: 'memory'
      });
    }

    const { days = 7 } = req.query;
    const daysAgo = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

    const { data } = await supabase
      .from('messages')
      .select('created_at, classification')
      .gte('created_at', daysAgo.toISOString())
      .order('created_at', { ascending: true });

    // Group by date
    const timeline: Record<string, { total: number; work: number; study: number; ignore: number }> = {};
    
    data?.forEach((m: any) => {
      const date = m.created_at.split('T')[0];
      if (!timeline[date]) {
        timeline[date] = { total: 0, work: 0, study: 0, ignore: 0 };
      }
      timeline[date].total++;
      if (m.classification === 'work') timeline[date].work++;
      if (m.classification === 'study') timeline[date].study++;
      if (m.classification === 'ignore') timeline[date].ignore++;
    });

    res.json({
      success: true,
      data: Object.entries(timeline).map(([date, counts]) => ({
        date,
        ...counts
      }))
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/stats/top-senders - Get top message senders
router.get('/top-senders', async (req, res) => {
  try {
    // Memory mode
    if (!supabase) {
      const { limit = 10 } = req.query;
      const { data: messages } = messageStore.getAll({ limit: 1000 });
      
      const senderCounts: Record<string, number> = {};
      messages.forEach((m: any) => {
        senderCounts[m.sender] = (senderCounts[m.sender] || 0) + 1;
      });

      const sorted = Object.entries(senderCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, Number(limit))
        .map(([sender, count]) => ({ sender, count }));

      return res.json({
        success: true,
        data: sorted,
        storage: 'memory'
      });
    }

    const { limit = 10 } = req.query;

    const { data } = await supabase
      .from('messages')
      .select('sender');

    // Count by sender
    const senderCounts: Record<string, number> = {};
    data?.forEach((m: any) => {
      senderCounts[m.sender] = (senderCounts[m.sender] || 0) + 1;
    });

    // Sort and limit
    const sorted = Object.entries(senderCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, Number(limit))
      .map(([sender, count]) => ({ sender, count }));

    res.json({
      success: true,
      data: sorted
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
