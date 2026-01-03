/**
 * Login Page - Notion-style
 * Minimal, centered, calm
 */

import { useState, FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2 } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const { login, error: authError, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from?.pathname || '/';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    
    if (!email || !password) return;
    
    setIsSubmitting(true);
    const success = await login(email, password);
    
    if (success) {
      navigate(from, { replace: true });
    }
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/mindline-logo.png" alt="Mindline Logo" className="w-16 h-16 mx-auto mb-4 object-contain" />
          <h1 className="text-xl font-medium text-[var(--text-primary)]">Log in to Mindline</h1>
        </div>
        
        {/* Error */}
        {authError && (
          <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded">
            {authError}
          </div>
        )}
        
        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email..."
              className="notion-input"
              disabled={isSubmitting}
              autoComplete="email"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password..."
              className="notion-input"
              disabled={isSubmitting}
              autoComplete="current-password"
              required
            />
          </div>
          
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2 px-4 bg-[var(--text-primary)] text-[var(--bg-primary)] rounded font-medium text-sm hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSubmitting ? 'Signing in...' : 'Continue with email'}
          </button>
        </form>
        
        {/* Divider */}
        <div className="my-6 border-t border-[var(--border-color)]" />
        
        {/* Sign Up Link */}
        <p className="text-center text-sm text-[var(--text-secondary)]">
          No account?{' '}
          <Link to="/register" className="text-[var(--accent)] hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
