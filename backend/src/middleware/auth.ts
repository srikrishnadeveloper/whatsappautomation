/**
 * Authentication Middleware
 * Verifies JWT tokens and attaches user to request
 */

import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        fullName?: string;
      };
      userId?: string;
    }
  }
}

/**
 * Middleware to verify JWT and attach user to request
 * Use this for routes that REQUIRE authentication
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const token = authHeader.split(' ')[1];

    if (!supabase) {
      return res.status(503).json({
        success: false,
        error: 'Database not configured'
      });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email || '',
      fullName: user.user_metadata?.full_name
    };
    req.userId = user.id;

    next();
  } catch (error: any) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
}

/**
 * Middleware to optionally attach user to request
 * Use this for routes that work with or without authentication
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token, continue without user
      return next();
    }

    const token = authHeader.split(' ')[1];

    if (!supabase) {
      return next();
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (!error && user) {
      req.user = {
        id: user.id,
        email: user.email || '',
        fullName: user.user_metadata?.full_name
      };
      req.userId = user.id;
    }

    next();
  } catch (error: any) {
    // Silently continue without user on error
    next();
  }
}

/**
 * Creates a Supabase client authenticated as the user
 * Use this when making database queries that should respect RLS
 */
export async function getAuthenticatedClient(token: string) {
  if (!supabase) {
    throw new Error('Database not configured');
  }

  // For Supabase, we need to create a client with the user's token
  // The existing client will use the service key, so we need to set auth
  const { data, error } = await supabase.auth.getUser(token);
  
  if (error || !data.user) {
    throw new Error('Invalid token');
  }

  return { supabase, user: data.user };
}
