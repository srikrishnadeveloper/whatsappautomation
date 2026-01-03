/**
 * Firebase Admin SDK Configuration
 * Server-side Firebase initialization for backend services
 */

import * as admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';

// Check for service account file
const serviceAccountPath = path.join(__dirname, '../../firebase-service-account.json');
const hasServiceAccount = fs.existsSync(serviceAccountPath);

// Check for environment variables
const hasEnvCredentials = process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY;

// Initialize Firebase Admin
if (!admin.apps.length) {
  if (hasServiceAccount) {
    // Use service account file if available (local development)
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || 'mindlineforai',
    });
    console.log('✅ Firebase Admin SDK initialized with service account file');
  } else if (hasEnvCredentials) {
    // Use environment variables (production on Render)
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID || 'mindlineforai',
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Handle escaped newlines in private key
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      projectId: process.env.FIREBASE_PROJECT_ID || 'mindlineforai',
    });
    console.log('✅ Firebase Admin SDK initialized with environment variables');
  } else {
    // Fallback: Initialize without credentials (limited functionality)
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || 'mindlineforai',
    });
    console.log('⚠️ Firebase Admin SDK initialized without credentials');
    console.log('   Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY env vars');
  }
}

// Get Firestore database instance
export const db = admin.firestore();

// Get Firebase Auth instance
export const auth = admin.auth();

// Collection names (matching previous schema)
export const COLLECTIONS = {
  USERS: 'users',
  MESSAGES: 'messages',
  ACTION_ITEMS: 'action_items',
  ACTIVITY_LOGS: 'activity_logs',
  RULES: 'rules',
  TASKS: 'tasks',
  FEEDBACK: 'feedback',
  WHATSAPP_SESSIONS: 'whatsapp_sessions'
} as const;

// Database types (matching previous schema)
export interface FirebaseUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  emailConfirmed: boolean;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

export interface FirebaseMessage {
  id: string;
  sender: string;
  chatName: string | null;
  timestamp: admin.firestore.Timestamp;
  content: string;
  messageType: string;
  classification: string | null;
  decision: string | null;
  priority: string | null;
  aiReasoning: string | null;
  notionPageId: string | null;
  metadata: any;
  userId?: string;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

export interface FirebaseActionItem {
  id: string;
  title: string;
  description: string | null;
  originalMessage: string | null;
  sender: string | null;
  chatName: string | null;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  category: 'work' | 'study' | 'personal' | 'urgent' | 'other';
  dueDate: admin.firestore.Timestamp | null;
  dueTime: string | null;
  tags: string[];
  aiConfidence: number | null;
  messageId: string | null;
  userId?: string;
  completedAt: admin.firestore.Timestamp | null;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

export interface FirebaseActivityLog {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'message';
  icon: string;
  title: string;
  details: string | null;
  userId?: string;
  timestamp: admin.firestore.Timestamp;
}

export interface FirebaseRule {
  id: string;
  ruleType: string;
  contactName: string | null;
  groupName: string | null;
  keywords: string[] | null;
  priority: string | null;
  category: string | null;
  isActive: boolean;
  userId?: string;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

// Helper to convert Firestore Timestamp to ISO string
export function timestampToISO(timestamp: admin.firestore.Timestamp | null): string | null {
  return timestamp ? timestamp.toDate().toISOString() : null;
}

// Helper to convert ISO string to Firestore Timestamp  
export function isoToTimestamp(isoString: string | null): admin.firestore.Timestamp | null {
  return isoString ? admin.firestore.Timestamp.fromDate(new Date(isoString)) : null;
}

// Export admin for direct access if needed
export { admin };
