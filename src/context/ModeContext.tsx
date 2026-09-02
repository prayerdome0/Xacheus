import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useBusiness } from './BusinessContext';

/**
 * Shop mode ↔ My Business mode.
 *
 * The switch is the single most used control for a seller, so it is always one
 * tap away. Mode is derived from the current route (single source of truth) and
 * remembered per account so a returning owner lands on their dashboard.
 */

export type AppMode = 'shop' | 'business';

const STORAGE_KEY = 'seedwel-mode';

interface ModeState {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  toggle: () => void;
  canUseBusinessMode: boolean;
  reason?: string;
}

const ModeContext = createContext<ModeState | null>(null);

export function ModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { activeBusiness, businesses } = useBusiness();
  const location = useLocation();
  const navigate = useNavigate();
  const [remembered, setRemembered] = useState<AppMode>('shop');

  useEffect(() => {
    const stored = window.localStorage.getItem(`${STORAGE_KEY}:${user?.id ?? 'anon'}`);
    if (stored === 'business' || stored === 'shop') setRemembered(stored);
  }, [user?.id]);

  const canUseBusinessMode = Boolean(activeBusiness);

  const mode: AppMode = location.pathname.startsWith('/business')
    ? 'business'
    : location.pathname.startsWith('/pos')
      ? 'business'
      : remembered;

  const setMode = useCallback((m: AppMode) => {
    setRemembered(m);
    try { window.localStorage.setItem(`${STORAGE_KEY}:${user?.id ?? 'anon'}`, m); } catch { /* ignore */ }
    if (m === 'business') {
      navigate(activeBusiness ? '/business' : '/business/setup');
    } else if (location.pathname.startsWith('/business') || location.pathname.startsWith('/pos')) {
      navigate('/');
    }
  }, [navigate, activeBusiness, location.pathname, user?.id]);

  const toggle = useCallback(() => {
    setMode(mode === 'business' ? 'shop' : 'business');
  }, [mode, setMode]);

  // If the user has no business yet but lands on /business/*, the route guard
  // sends them to setup; here we just keep the remembered mode honest.
  useEffect(() => {
    if (remembered === 'business' && businesses.length === 0 && user) {
      setRemembered('shop');
    }
  }, [remembered, businesses.length, user]);

  const value = useMemo<ModeState>(() => ({
    mode, setMode, toggle, canUseBusinessMode,
    reason: canUseBusinessMode ? undefined : 'Create your business to unlock My Business mode.',
  }), [mode, setMode, toggle, canUseBusinessMode]);

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeState {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error('useMode must be used inside <ModeProvider>');
  return ctx;
}
