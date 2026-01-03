/**
 * Statistics API Route - Firebase Version
 * Get analytics and stats about messages using Firestore
 */

import { Router } from 'express';
import { firestoreMessageStore } from '../services/firestore-message-store';

const router = Router();

// GET /api/stats - Get overall statistics
router.get('/', async (req, res) => {
  try {
    const stats = await firestoreMessageStore.getStats();
    
    res.json({
      success: true,
      data: {
        overview: stats.overview,
        by_classification: stats.by_classification || {},
        by_decision: stats.by_decision || {},
        by_priority: stats.by_priority || {},
        timestamp: new Date().toISOString()
      },
      storage: 'firestore'
    });
  } catch (error: any) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/stats/timeline - Get message counts by date
router.get('/timeline', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const daysAgo = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
    
    const { data: messages } = await firestoreMessageStore.getAll({ 
      limit: 1000
    });
    
    // Filter for recent messages and build timeline
    const timeline: Record<string, { total: number; work: number; study: number; ignore: number }> = {};
    
    messages
      .filter((m: any) => m.created_at >= daysAgo || m.timestamp >= daysAgo)
      .forEach((m: any) => {
        const dateStr = m.created_at || m.timestamp;
        const date = dateStr.split('T')[0];
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
      data: Object.entries(timeline)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, counts]) => ({
          date,
          ...counts
        })),
      storage: 'firestore'
    });
  } catch (error: any) {
    console.error('Error fetching timeline:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/stats/top-senders - Get top message senders
router.get('/top-senders', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const { data: messages } = await firestoreMessageStore.getAll({ limit: 1000 });
    
    // Count by sender
    const senderCounts: Record<string, number> = {};
    messages.forEach((m: any) => {
      const sender = m.sender || 'Unknown';
      senderCounts[sender] = (senderCounts[sender] || 0) + 1;
    });

    // Sort and limit
    const sorted = Object.entries(senderCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, Number(limit))
      .map(([sender, count]) => ({ sender, count }));

    res.json({
      success: true,
      data: sorted,
      storage: 'firestore'
    });
  } catch (error: any) {
    console.error('Error fetching top senders:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/stats/summary - Quick summary for dashboard
router.get('/summary', async (req, res) => {
  try {
    const stats = await firestoreMessageStore.getStats();
    
    res.json({
      success: true,
      data: {
        messages: {
          total: stats.overview.total_messages,
          today: stats.overview.recent_24h
        },
        classifications: stats.by_classification || {},
        priorities: stats.by_priority || {},
        decisions: stats.by_decision || {},
        timestamp: new Date().toISOString()
      },
      storage: 'firestore'
    });
  } catch (error: any) {
    console.error('Error fetching summary:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
