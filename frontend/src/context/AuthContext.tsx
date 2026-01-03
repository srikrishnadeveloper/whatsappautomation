/**
 * Authentication Context - Firebase Version
 * Manages user authentication state using Firebase Auth
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  User as FirebaseUser
} from 'firebase/auth';
import { auth } from '../config/firebase';
import { API_BASE } from '../services/api';

interface User {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  emailConfirmed: boolean;
}

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, fullName?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        setFirebaseUser(fbUser);
        setUser({
          id: fbUser.uid,
          email: fbUser.email || '',
          fullName: fbUser.displayName || '',
          avatarUrl: fbUser.photoURL || undefined,
          emailConfirmed: fbUser.emailVerified
        });

        // Verify token with backend to sync user data
        try {
          const idToken = await fbUser.getIdToken();
          await fetch(`${API_BASE}/auth/verify-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken })
          });
        } catch (e) {
          console.error('Backend sync failed:', e);
        }
      } else {
        setFirebaseUser(null);
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Login function
  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setError(null);
    setLoading(true);

    // Dev bypass
    if (email === 'dev@local') {
      setUser({
        id: 'dev-user',
        email: 'dev@local',
        fullName: 'Dev User',
        emailConfirmed: true
      });
      setLoading(false);
      return true;
    }
    
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const fbUser = userCredential.user;
      
      setFirebaseUser(fbUser);
      setUser({
        id: fbUser.uid,
        email: fbUser.email || '',
        fullName: fbUser.displayName || '',
        avatarUrl: fbUser.photoURL || undefined,
        emailConfirmed: fbUser.emailVerified
      });

      // Sync with backend
      try {
        const idToken = await fbUser.getIdToken();
        await fetch(`${API_BASE}/auth/verify-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken })
        });
      } catch (e) {
        console.error('Backend sync failed:', e);
      }
      
      setLoading(false);
      return true;
    } catch (e: any) {
      console.error('Login error:', e);
      
      // Map Firebase error codes to user-friendly messages
      const errorMessages: Record<string, string> = {
        'auth/user-not-found': 'No account found with this email',
        'auth/wrong-password': 'Incorrect password',
        'auth/invalid-email': 'Invalid email format',
        'auth/user-disabled': 'This account has been disabled',
        'auth/too-many-requests': 'Too many failed attempts. Please try again later',
        'auth/invalid-credential': 'Invalid email or password'
      };
      
      setError(errorMessages[e.code] || e.message || 'Login failed');
      setLoading(false);
      return false;
    }
  }, []);

  // Register function
  const register = useCallback(async (email: string, password: string, fullName?: string): Promise<boolean> => {
    setError(null);
    setLoading(true);
    
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const fbUser = userCredential.user;

      // Update display name if provided
      if (fullName) {
        await updateProfile(fbUser, { displayName: fullName });
      }
      
      setFirebaseUser(fbUser);
      setUser({
        id: fbUser.uid,
        email: fbUser.email || '',
        fullName: fullName || '',
        avatarUrl: fbUser.photoURL || undefined,
        emailConfirmed: fbUser.emailVerified
      });

      // Sync with backend to create user document
      try {
        const idToken = await fbUser.getIdToken();
        await fetch(`${API_BASE}/auth/verify-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken })
        });
      } catch (e) {
        console.error('Backend sync failed:', e);
      }
      
      setLoading(false);
      return true;
    } catch (e: any) {
      console.error('Registration error:', e);
      
      // Map Firebase error codes to user-friendly messages
      const errorMessages: Record<string, string> = {
        'auth/email-already-in-use': 'An account with this email already exists',
        'auth/invalid-email': 'Invalid email format',
        'auth/weak-password': 'Password should be at least 6 characters',
        'auth/operation-not-allowed': 'Email/password accounts are not enabled'
      };
      
      setError(errorMessages[e.code] || e.message || 'Registration failed');
      setLoading(false);
      return false;
    }
  }, []);

  // Logout function
  const logout = useCallback(async () => {
    try {
      // Notify backend
      if (firebaseUser) {
        try {
          const idToken = await firebaseUser.getIdToken();
          await fetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${idToken}`
            }
          });
        } catch (e) {
          console.error('Backend logout failed:', e);
        }
      }
      
      await signOut(auth);
      setUser(null);
      setFirebaseUser(null);
    } catch (e) {
      console.error('Logout error:', e);
    }
  }, [firebaseUser]);

  // Get ID token for API calls
  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (!firebaseUser) return null;
    try {
      return await firebaseUser.getIdToken();
    } catch (e) {
      console.error('Error getting ID token:', e);
      return null;
    }
  }, [firebaseUser]);

  const clearError = useCallback(() => setError(null), []);

  const value = {
    user,
    firebaseUser,
    loading,
    isLoading: loading,
    error,
    login,
    register,
    logout,
    getIdToken,
    clearError
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Helper hook to get auth headers for API calls
export function useAuthHeaders() {
  const { firebaseUser } = useAuth();
  const [headers, setHeaders] = useState<Record<string, string>>({});

  useEffect(() => {
    const getHeaders = async () => {
      if (firebaseUser) {
        try {
          const token = await firebaseUser.getIdToken();
          setHeaders({ 'Authorization': `Bearer ${token}` });
        } catch (e) {
          setHeaders({});
        }
      } else {
        setHeaders({});
      }
    };
    getHeaders();
  }, [firebaseUser]);

  return headers;
}
