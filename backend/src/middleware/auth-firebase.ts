/**
 * Authentication Middleware - Firebase Version
 * Verifies Firebase ID tokens and attaches user to request
 */

import { Request, Response, NextFunction } from 'express';
import { auth, db, COLLECTIONS } from '../config/firebase';

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
 * Middleware to verify Firebase ID token and attach user to request
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

    const idToken = authHeader.split(' ')[1];

    // Verify the Firebase ID token
    const decodedToken = await auth.verifyIdToken(idToken);

    // Get user data from Firestore for additional info
    let fullName = decodedToken.name;
    try {
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(decodedToken.uid).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        fullName = userData?.fullName || fullName;
      }
    } catch (e) {
      // Continue with token data if Firestore fails
    }

    // Attach user to request
    req.user = {
      id: decodedToken.uid,
      email: decodedToken.email || '',
      fullName: fullName
    };
    req.userId = decodedToken.uid;

    next();
  } catch (error: any) {
    console.error('Auth middleware error:', error);
    
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        success: false,
        error: 'Token expired'
      });
    }
    
    if (error.code === 'auth/argument-error') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token format'
      });
    }

    return res.status(401).json({
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

    const idToken = authHeader.split(' ')[1];

    try {
      const decodedToken = await auth.verifyIdToken(idToken);

      // Get user data from Firestore
      let fullName = decodedToken.name;
      try {
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(decodedToken.uid).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          fullName = userData?.fullName || fullName;
        }
      } catch (e) {
        // Continue with token data
      }

      req.user = {
        id: decodedToken.uid,
        email: decodedToken.email || '',
        fullName: fullName
      };
      req.userId = decodedToken.uid;
    } catch (e) {
      // Token invalid, continue without user
    }

    next();
  } catch (error: any) {
    // Continue without user on any error
    next();
  }
}

export default { requireAuth, optionalAuth };
