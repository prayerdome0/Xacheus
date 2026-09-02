import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword,
  getIdTokenResult,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updatePassword as updateFirebasePassword,
  updateProfile as updateFirebaseProfile,
  type ActionCodeSettings,
  type User as FirebaseUser,
  type UserCredential,
} from 'firebase/auth';
import { getFirebaseAuth, toAppUser, type AppUser } from '@/lib/firebase';
import { createProfile, getProfile, saveProfile } from '@/lib/firestore';
import type { Profile, UserRole } from '@/types';
import { env } from '@/lib/env';

/**
 * Authentication + profile — Firebase Auth + Firestore (`users/{uid}`).
 *
 * This is the Phase 1 replacement for the Supabase auth stack. It exposes the
 * same shape the app already uses so the screens and guards keep working.
 *
 * Security boundaries:
 *  - Roles live in Firestore (`profiles.roles`) and are extended by business
 *    memberships, exactly as before.
 *  - Platform-admin is a Firebase custom claim (`admin: true`), never a safe
 *    bool the browser can set. Firestore rules and Cloud Functions check
 *    `request.auth.token.admin`.
 *  - `is_platform_admin` on the profile is only a display copy; privilege is
 *    decided by the claim.
 */

export interface AuthSession {
  user: AppUser;
}

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
  session: AuthSession | null;
  user: AppUser | null;
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
  resendVerificationEmail: (email?: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthState | null>(null);

function friendlyFirebaseError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const code = e.code ?? '';
  if (code === 'auth/email-already-in-use') {
    return 'An account with that email already exists. Try signing in instead.';
  }
  if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
    return 'That email and password combination is not correct.';
  }
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  if (code === 'auth/weak-password') return 'Use at least 8 characters for your password.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a moment and try again.';
  if (code === 'permission-denied') return 'Your profile could not be created. Check Firestore security rules.';
  return e.message ?? 'Something went wrong. Please try again.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [initialised, setInitialised] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  const loadProfile = useCallback(async (uid: string) => {
    setProfileLoading(true);
    try {
      let next = await getProfile(uid);
      if (!next) {
        const current = getFirebaseAuth().currentUser;
        if (!current || current.uid !== uid) throw new Error('Account profile not found.');
        next = await createProfile(toAppUser(current));
      }
      setProfile(next);
    } catch {
      // A missing profile means Firestore is not yet provisioned or the rules
      // rejected the read/write. We keep the auth session and let the UI tell
      // the user what to do instead of pretending the account has no data.
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const loadClaims = useCallback(async () => {
    const current = getFirebaseAuth().currentUser;
    if (!current) {
      setIsPlatformAdmin(false);
      return;
    }
    try {
      const token = await getIdTokenResult(current);
      const admin = token.claims.admin === true || token.claims.role === 'admin';
      setIsPlatformAdmin(admin);
      setProfile((prev) => (prev ? { ...prev, is_platform_admin: admin } : prev));
    } catch {
      setIsPlatformAdmin(false);
    }
  }, []);

  const adoptUser = useCallback((fbUser: FirebaseUser | null) => {
    const next = fbUser ? toAppUser(fbUser) : null;
    setUser(next);
    setSession(next ? { user: next } : null);
    setLoading(false);
    setInitialised(true);
    if (!next) {
      setProfile(null);
      setIsPlatformAdmin(false);
      return;
    }
    void Promise.all([loadProfile(next.id), loadClaims()]);
  }, [loadProfile, loadClaims]);

  useEffect(() => {
    const unsub = onAuthStateChanged(getFirebaseAuth(), (fbUser) => adoptUser(fbUser));
    return () => unsub();
  }, [adoptUser]);

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
      adoptUser(credential.user);
      return { error: null };
    } catch (e) {
      return { error: friendlyFirebaseError(e) };
    } finally {
      setLoading(false);
    }
  }, [adoptUser]);

  const signUp = useCallback(async (input: SignUpInput) => {
    setLoading(true);
    let credential: UserCredential | undefined;
    try {
      credential = await createUserWithEmailAndPassword(
        getFirebaseAuth(),
        input.email.trim(),
        input.password,
      );
    } catch (e) {
      return { error: friendlyFirebaseError(e), needsConfirmation: false };
    } finally {
      setLoading(false);
    }

    if (!credential) return { error: 'We could not create the account. Please try again.', needsConfirmation: false };

    const fbUser = credential.user;
    const appUser: AppUser = {
      ...toAppUser(fbUser),
      displayName: input.fullName,
      email: fbUser.email ?? input.email.trim(),
      user_metadata: {
        display_name: input.fullName,
        full_name: input.fullName,
        phone: input.phone ?? null,
      },
    };

    try {
      if (fbUser.displayName !== input.fullName) {
        await updateFirebaseProfile(fbUser, { displayName: input.fullName });
      }
      await createProfile(appUser);
    } catch (e) {
      // Best-effort: do not leave a half-created account behind.
      await fbUser.delete().catch(() => {});
      return { error: friendlyFirebaseError(e), needsConfirmation: false };
    }

    if (env.requireEmailVerification && !fbUser.emailVerified) {
      const actionCodeSettings: ActionCodeSettings = {
        url: `${env.appUrl}/auth/confirm`,
        handleCodeInApp: true,
      };
      await sendEmailVerification(fbUser, actionCodeSettings).catch(() => {});
    }

    adoptUser(fbUser);
    return {
      error: null,
      needsConfirmation: env.requireEmailVerification && !fbUser.emailVerified,
    };
  }, [adoptUser]);

  const signOut = useCallback(async () => {
    await firebaseSignOut(getFirebaseAuth());
    setUser(null);
    setSession(null);
    setProfile(null);
    setIsPlatformAdmin(false);
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    try {
      const actionCodeSettings: ActionCodeSettings = {
        url: `${env.appUrl}/auth/reset-password`,
        handleCodeInApp: true,
      };
      await sendPasswordResetEmail(getFirebaseAuth(), email.trim(), actionCodeSettings);
      return { error: null };
    } catch (e) {
      return { error: friendlyFirebaseError(e) };
    }
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const current = getFirebaseAuth().currentUser;
    if (!current) return { error: 'Your password reset session has expired. Request a new link.' };
    try {
      await updateFirebasePassword(current, password);
      return { error: null };
    } catch (e) {
      return { error: friendlyFirebaseError(e) };
    }
  }, []);

  const resendVerificationEmail = useCallback(async (email?: string) => {
    const current = getFirebaseAuth().currentUser;
    if (!current) {
      // A non-signed-in user cannot be emailed by the browser SDK. After the
      // Phase 1 sign-up flow the account stays signed in, so this path is only
      // hit after a logout.
      return {
        error: email
          ? 'Sign in again first, then we can resend the verification link.'
          : 'You are signed out. Sign in again to resend the verification link.',
      };
    }
    try {
      const actionCodeSettings: ActionCodeSettings = {
        url: `${env.appUrl}/auth/confirm`,
        handleCodeInApp: true,
      };
      await sendEmailVerification(current, actionCodeSettings);
      return { error: null };
    } catch (e) {
      return { error: friendlyFirebaseError(e) };
    }
  }, []);

  const updateProfile = useCallback(async (patch: Partial<Profile>) => {
    if (!user) return { error: 'You are not signed in.' };
    try {
      const next = await saveProfile(user.id, patch);
      const current = getFirebaseAuth().currentUser;
      if (current) {
        const authPatch: { displayName?: string; photoURL?: string } = {};
        if (patch.display_name) authPatch.displayName = patch.display_name;
        if (patch.avatar_url) authPatch.photoURL = patch.avatar_url;
        if (Object.keys(authPatch).length > 0) {
          await updateFirebaseProfile(current, authPatch).catch(() => {});
        }
      }
      setProfile({ ...next, is_platform_admin: isPlatformAdmin });
      return { error: null };
    } catch (e) {
      return { error: friendlyFirebaseError(e) };
    }
  }, [user, isPlatformAdmin]);

  const addRole = useCallback(async (role: UserRole) => {
    if (!profile) return;
    if (profile.roles?.includes(role)) return;
    await updateProfile({ roles: [...(profile.roles ?? []), role] });
  }, [profile, updateProfile]);

  const value = useMemo<AuthState>(() => ({
    session, user, profile, loading, profileLoading, initialised,
    isPlatformAdmin,
    roles: profile?.roles ?? ['buyer'],
    signIn, signUp, signOut, sendPasswordReset, updatePassword,
    updateProfile, refreshProfile: async () => { if (user) await loadProfile(user.id); },
    addRole, resendVerificationEmail,
  }), [session, user, profile, loading, profileLoading, initialised, isPlatformAdmin,
       signIn, signUp, signOut, sendPasswordReset, updatePassword, updateProfile,
       addRole, loadProfile, resendVerificationEmail]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
