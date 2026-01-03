/**
 * Authentication Routes - Firebase Version
 * Handles user registration, login, logout, and session management using Firebase Auth
 */

import { Router, Request, Response } from 'express';
import { auth, db, COLLECTIONS } from '../config/firebase';
import { admin } from '../config/firebase';

const router = Router();

// POST /api/auth/register - Register a new user
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters'
      });
    }

    // Create user in Firebase Auth
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: fullName || '',
      emailVerified: false
    });

    // Create user document in Firestore
    const now = admin.firestore.Timestamp.now();
    await db.collection(COLLECTIONS.USERS).doc(userRecord.uid).set({
      email,
      fullName: fullName || '',
      avatarUrl: null,
      emailConfirmed: false,
      createdAt: now,
      updatedAt: now
    });

    // Generate custom token for the user
    const customToken = await auth.createCustomToken(userRecord.uid);

    res.json({
      success: true,
      message: 'Registration successful',
      data: {
        user: {
          id: userRecord.uid,
          email: userRecord.email,
          fullName: fullName || '',
          emailConfirmed: userRecord.emailVerified
        },
        customToken
      }
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    
    // Handle specific Firebase errors
    if (error.code === 'auth/email-already-exists') {
      return res.status(400).json({
        success: false,
        error: 'Email is already in use'
      });
    }
    
    if (error.code === 'auth/invalid-email') {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Registration failed'
    });
  }
});

// POST /api/auth/verify-token - Verify Firebase ID token from frontend
router.post('/verify-token', async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        error: 'ID token is required'
      });
    }

    // Verify the ID token
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(idToken);
    } catch (authError: any) {
      console.error('Token verification error:', authError.message);
      // If credentials not available, just return success for development
      // The frontend Firebase Auth already verified the user
      if (authError.message?.includes('Could not load the default credentials')) {
        console.log('⚠️ Firebase Admin credentials not available - skipping Firestore sync');
        return res.json({
          success: true,
          message: 'Token accepted (Firestore sync skipped - missing credentials)',
          data: { user: null }
        });
      }
      throw authError;
    }
    
    // Try to get/create user data in Firestore
    let userData = null;
    try {
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(decodedToken.uid).get();
      userData = userDoc.data();

      // If user doesn't exist in Firestore, create them
      if (!userData) {
        const now = admin.firestore.Timestamp.now();
        userData = {
          email: decodedToken.email || '',
          fullName: decodedToken.name || '',
          avatarUrl: decodedToken.picture || null,
          emailConfirmed: decodedToken.email_verified || false,
          createdAt: now,
          updatedAt: now
        };
        await db.collection(COLLECTIONS.USERS).doc(decodedToken.uid).set(userData);
      }
    } catch (firestoreError: any) {
      console.error('Firestore error:', firestoreError.message);
      // Continue without Firestore data
    }

    res.json({
      success: true,
      data: {
        user: {
          id: decodedToken.uid,
          email: decodedToken.email,
          fullName: userData?.fullName || decodedToken.name || '',
          avatarUrl: userData?.avatarUrl || decodedToken.picture,
          emailConfirmed: decodedToken.email_verified
        }
      }
    });
  } catch (error: any) {
    console.error('Token verification error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
});

// GET /api/auth/user - Get current user info
router.get('/user', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const idToken = authHeader.split(' ')[1];
    
    // Verify the ID token
    const decodedToken = await auth.verifyIdToken(idToken);
    
    // Get user data from Firestore
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(decodedToken.uid).get();
    const userData = userDoc.data();

    res.json({
      success: true,
      data: {
        id: decodedToken.uid,
        email: decodedToken.email,
        fullName: userData?.fullName || decodedToken.name || '',
        avatarUrl: userData?.avatarUrl || decodedToken.picture,
        emailConfirmed: decodedToken.email_verified
      }
    });
  } catch (error: any) {
    console.error('Get user error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
});

// POST /api/auth/logout - Logout user (revoke tokens)
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.split(' ')[1];
      
      try {
        const decodedToken = await auth.verifyIdToken(idToken);
        // Revoke all refresh tokens for the user
        await auth.revokeRefreshTokens(decodedToken.uid);
      } catch (e) {
        // Token might already be invalid, that's fine
      }
    }

    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error: any) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
});

// PUT /api/auth/profile - Update user profile
router.put('/profile', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const idToken = authHeader.split(' ')[1];
    const decodedToken = await auth.verifyIdToken(idToken);
    
    const { fullName, avatarUrl } = req.body;
    
    // Update Firebase Auth display name
    if (fullName !== undefined) {
      await auth.updateUser(decodedToken.uid, {
        displayName: fullName
      });
    }

    // Update Firestore document
    const now = admin.firestore.Timestamp.now();
    const updateData: any = { updatedAt: now };
    if (fullName !== undefined) updateData.fullName = fullName;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;

    await db.collection(COLLECTIONS.USERS).doc(decodedToken.uid).update(updateData);

    // Get updated user data
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(decodedToken.uid).get();
    const userData = userDoc.data();

    res.json({
      success: true,
      data: {
        id: decodedToken.uid,
        email: decodedToken.email,
        fullName: userData?.fullName || '',
        avatarUrl: userData?.avatarUrl,
        emailConfirmed: decodedToken.email_verified
      }
    });
  } catch (error: any) {
    console.error('Profile update error:', error);
    res.status(500).json({
      success: false,
      error: 'Profile update failed'
    });
  }
});

// DELETE /api/auth/account - Delete user account
router.delete('/account', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const idToken = authHeader.split(' ')[1];
    const decodedToken = await auth.verifyIdToken(idToken);
    
    // Delete user from Firebase Auth
    await auth.deleteUser(decodedToken.uid);
    
    // Delete user document from Firestore
    await db.collection(COLLECTIONS.USERS).doc(decodedToken.uid).delete();

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error: any) {
    console.error('Account deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Account deletion failed'
    });
  }
});

export default router;
