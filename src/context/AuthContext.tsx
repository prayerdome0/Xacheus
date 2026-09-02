import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile, UserRole } from '@/types';
import { env } from '@/lib/env';

/**
 * Authentication + profile.
 *
 * One account can hold several roles at once (buyer + seller + business owner).
 * Roles live on profiles.roles and are extended by business_members when the
 * person joins or creates a business.
 */

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  phoneCountryCode?: string;
  countryCode?: string;
  roles?: UserRole[];
  primaryRole?: UserRole;
  headline?: string;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  initialised: boolean;
  isPlatformAdmin: boolean;
  roles: UserRole[];
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (input: SignUpInput) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  updateProfile: (patch: Partial<Profile>) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
  addRole: (role: UserRole) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [initialised, setInitialised] = useState(false);

  const loadProfile = useCallback(async (uid: string) => {
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .maybeSingle();
      if (error) throw error;
      setProfile((data as Profile) ?? null);
    } catch {
      // A missing profile row means the signup trigger has not run yet (or the
      // schema is not applied). We keep the session and let the UI explain.
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;

    const bootstrap = async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
      setInitialised(true);
      if (data.session?.user) await loadProfile(data.session.user.id);
    };

    void bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setUser(next?.user ?? null);
      setLoading(false);
      setInitialised(true);
      if (next?.user) void loadProfile(next.user.id);
      else setProfile(null);
    });

    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(), password,
    });
    setLoading(false);
    if (error) {
      const msg = /invalid login credentials/i.test(error.message)
        ? 'That email and password combination is not correct.'
        : /email not confirmed/i.test(error.message)
          ? 'Please confirm your email address first — check your inbox for the Seedwel Hub link.'
          : error.message;
      return { error: msg };
    }
    return { error: null };
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    setLoading(true);
    const roles = input.roles?.length ? input.roles : ['buyer'];
    const { data, error } = await supabase.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      phone: input.phone ? input.phone.replace(/[^\d]/g, '') : undefined,
      options: {
        emailRedirectTo: `${env.appUrl}/auth/confirm`,
        data: {
          full_name: input.fullName,
          display_name: input.fullName,
          phone_country_code: input.phoneCountryCode ?? '+260',
          country_code: input.countryCode ?? env.defaultCountry,
          roles,
          primary_role: input.primaryRole ?? (roles.includes('seller') ? 'seller' : 'buyer'),
          headline: input.headline,
        },
      },
    });
    setLoading(false);
    if (error) {
      const msg = /already registered/i.test(error.message)
        ? 'An account with that email already exists. Try signing in instead.'
        : error.message;
      return { error: msg, needsConfirmation: false };
    }
    if (data.session) await loadProfile(data.user!.id);
    return { error: null, needsConfirmation: !data.session };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
    setUser(null);
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${env.appUrl}/auth/reset`,
    });
    return { error: error?.message ?? null };
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error?.message ?? null };
  }, []);

  const updateProfile = useCallback(async (patch: Partial<Profile>) => {
    if (!user) return { error: 'You are not signed in.' };
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .select('*')
      .maybeSingle();
    if (error) return { error: error.message };
    setProfile((data as Profile) ?? null);
    return { error: null };
  }, [user]);

  const addRole = useCallback(async (role: UserRole) => {
    if (!profile) return;
    if (profile.roles?.includes(role)) return;
    await updateProfile({ roles: [...(profile.roles ?? []), role] });
  }, [profile, updateProfile]);

  const value = useMemo<AuthState>(() => ({
    session, user, profile, loading, profileLoading, initialised,
    isPlatformAdmin: Boolean(profile?.is_platform_admin),
    roles: profile?.roles ?? ['buyer'],
    signIn, signUp, signOut, sendPasswordReset, updatePassword, updateProfile,
    refreshProfile: async () => { if (user) await loadProfile(user.id); },
    addRole,
  }), [session, user, profile, loading, profileLoading, initialised,
       signIn, signUp, signOut, sendPasswordReset, updatePassword, updateProfile, addRole, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
