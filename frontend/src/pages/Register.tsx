/**
 * Register Page - Notion-style
 * Minimal, centered, calm
 */

import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2, Check } from 'lucide-react';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const { register, error: authError, clearError } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();
    
    if (!email || !password || !confirmPassword) {
      setLocalError('Please fill in all required fields');
      return;
    }
    
    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters');
      return;
    }
    
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }
    
    setIsSubmitting(true);
    const result = await register(email, password, fullName);
    
    if (result) {
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    }
    setIsSubmitting(false);
  };

  const error = localError || authError;

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] px-4">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
            <Check className="w-6 h-6 text-green-600" />
          </div>
          <h2 className="text-xl font-medium text-[var(--text-primary)] mb-2">
            Account created
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mb-6">
            Check your email to verify your account. Redirecting to login...
          </p>
          <Link
            to="/login"
            className="text-sm text-[var(--accent)] hover:underline"
          >
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/mindline-logo.png" alt="Mindline Logo" className="w-16 h-16 mx-auto mb-4 object-contain" />
          <h1 className="text-xl font-medium text-[var(--text-primary)]">Create your account</h1>
        </div>
        
        {/* Error */}
        {error && (
          <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded">
            {error}
          </div>
        )}
        
        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-1">
              Name <span className="text-[var(--text-muted)]">(optional)</span>
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Enter your name..."
              className="notion-input"
              disabled={isSubmitting}
            />
          </div>
          
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
              placeholder="Create a password..."
              className="notion-input"
              disabled={isSubmitting}
              autoComplete="new-password"
              required
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">At least 6 characters</p>
          </div>
          
          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-1">
              Confirm password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password..."
              className="notion-input"
              disabled={isSubmitting}
              autoComplete="new-password"
              required
            />
          </div>
          
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2 px-4 bg-[var(--text-primary)] text-[var(--bg-primary)] rounded font-medium text-sm hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSubmitting ? 'Creating account...' : 'Continue'}
          </button>
        </form>
        
        {/* Divider */}
        <div className="my-6 border-t border-[var(--border-color)]" />
        
        {/* Sign In Link */}
        <p className="text-center text-sm text-[var(--text-secondary)]">
          Already have an account?{' '}
          <Link to="/login" className="text-[var(--accent)] hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
