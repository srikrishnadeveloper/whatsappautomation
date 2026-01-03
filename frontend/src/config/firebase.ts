/**
 * Firebase Client SDK Configuration
 * Frontend Firebase initialization for auth and client-side operations
 */

import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getAnalytics, isSupported } from 'firebase/analytics';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDD4B16pYZIR7ROBTs-7v15f-EadPS8jVs",
  authDomain: "mindlineforai.firebaseapp.com",
  projectId: "mindlineforai",
  storageBucket: "mindlineforai.firebasestorage.app",
  messagingSenderId: "645950537376",
  appId: "1:645950537376:web:ecda424100a737e35a93c5",
  measurementId: "G-DSG8SJEQ91"
};

// Initialize Firebase (only once)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Initialize Firebase Auth
export const auth = getAuth(app);

// Initialize Firestore
export const firestore = getFirestore(app);

// Initialize Analytics (only in browser and if supported)
export const initAnalytics = async () => {
  if (typeof window !== 'undefined' && await isSupported()) {
    return getAnalytics(app);
  }
  return null;
};

// Connect to emulators in development (optional)
// @ts-ignore - Vite provides import.meta.env
const isDev = typeof window !== 'undefined' && window.location.hostname === 'localhost';
// @ts-ignore
const useEmulators = typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_USE_FIREBASE_EMULATORS === 'true';

if (isDev && useEmulators) {
  connectAuthEmulator(auth, 'http://localhost:9099');
  connectFirestoreEmulator(firestore, 'localhost', 8080);
}

export { app };
export default app;
