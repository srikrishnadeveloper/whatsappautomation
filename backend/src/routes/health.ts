/**
 * Health Check Route
 */

import { Router } from 'express';
import { supabase } from '../config/supabase';

const router = Router();

router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      api: 'ok',
      supabase: 'not configured',
      gemini: process.env.GOOGLE_AI_API_KEY ? 'configured' : 'not configured'
    }
  };

  // Test Supabase connection if client exists
  if (supabase) {
    try {
      const { error } = await supabase.from('messages').select('id').limit(1);
      health.services.supabase = error ? 'error' : 'ok';
    } catch (err) {
      health.services.supabase = 'error';
    }
  }

  res.json(health);
});

export default router;
