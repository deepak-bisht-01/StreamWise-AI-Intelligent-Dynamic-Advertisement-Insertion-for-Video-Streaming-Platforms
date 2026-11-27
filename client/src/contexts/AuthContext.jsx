import { createContext, useContext, useEffect, useState } from 'react';
import api, { readStoredSession, SESSION_STORAGE_KEY } from '../services/api.js';

const AuthContext = createContext(null);

function persistSession(session) {
  if (session) window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  else window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readStoredSession);
  const [profile, setProfile] = useState(null);
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(Boolean(readStoredSession()));

  useEffect(() => {
    let cancelled = false;
    async function loadAccount() {
      if (!session?.access_token) {
        setProfile(null);
        setAuthError('');
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const response = await api.get('/auth/me');
        if (!cancelled) {
          setProfile(response.data.data.profile);
          setAuthError('');
        }
      } catch (error) {
        if (!cancelled) {
          setProfile(null);
          if (error.response?.status === 401) {
            persistSession(null);
            setSession(null);
          } else {
            setAuthError(error.response?.data?.message || 'Could not load your profile. Check that the personalization migration is installed.');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadAccount();
    return () => { cancelled = true; };
  }, [session?.access_token]);

  useEffect(() => {
    if (!session?.expires_at) return undefined;
    const expiresAt = Number(session.expires_at) * 1000;
    const timeout = window.setTimeout(() => {
      persistSession(null);
      setSession(null);
      setProfile(null);
    }, Math.max(1000, expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [session?.access_token, session?.expires_at]);

  async function signIn(email, password) {
    const response = await api.post('/auth/sign-in', { email, password });
    const nextSession = response.data.data.session;
    persistSession(nextSession);
    setSession(nextSession);
    return response.data.data;
  }

  async function signUp(displayName, email, password) {
    const response = await api.post('/auth/sign-up', { displayName, email, password });
    const result = response.data.data;
    persistSession(result.session);
    setSession(result.session);
    return result;
  }

  async function signOut() {
    try { await api.post('/auth/sign-out'); } catch { /* Clear the local session even if the network is unavailable. */ }
    persistSession(null);
    setSession(null);
    setProfile(null);
    setAuthError('');
  }

  async function reloadProfile() {
    const response = await api.get('/profile');
    setProfile(response.data.data);
    return response.data.data;
  }

  return (
    <AuthContext.Provider value={{ session, user: session?.user || null, profile, setProfile, authError, loading, signIn, signUp, signOut, reloadProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
