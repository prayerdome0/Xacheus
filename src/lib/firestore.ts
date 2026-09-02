import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  type DocumentData,
} from 'firebase/firestore';
import type { Profile, UserRole } from '@/types';
import { getFirebaseDb, type AppUser } from './firebase';
import { env } from './env';

/**
 * Firestore identity data layer — Phase 1.
 *
 * Collection: `users/{uid}` stores the user profile. It intentionally keeps the
 * same field names as the Postgres `profiles` table used before the migration,
 * so the React screens need no changes while the data moves.
 *
 * Security is enforced by `firebase/firestore.rules` (owner-scoped reads and
 * writes) plus custom claims for platform admins. Never treat a `true` field on
 * the doc itself as proof of admin access — the rules and Cloud Functions use
 * `request.auth.token.admin`.
 */

const EMPTY_ROLES: UserRole[] = ['buyer'];

export function profileDefaults(user: AppUser): Profile {
  const now = new Date().toISOString();
  return {
    id: user.id,
    email: user.email ?? '',
    phone: user.phoneNumber,
    phone_country_code: '+260',
    full_name: user.displayName,
    display_name: user.displayName,
    avatar_url: user.photoURL,
    country_code: env.defaultCountry,
    language: 'en',
    currency: env.defaultCurrency,
    time_zone: 'Africa/Lusaka',
    roles: EMPTY_ROLES,
    primary_role: 'buyer',
    headline: null,
    bio: null,
    website: null,
    social: {},
    address_line1: null,
    address_line2: null,
    city: null,
    region: null,
    postal_code: null,
    location: null,
    default_business: null,
    email_verified_at: user.emailVerified ? now : null,
    phone_verified_at: null,
    two_factor_enabled: false,
    is_platform_admin: false,
    is_suspended: false,
    marketing_opt_in: false,
    onboarding_completed_at: null,
    last_seen_at: now,
    created_at: now,
    updated_at: now,
  };
}

export async function getProfile(uid: string): Promise<Profile | null> {
  const ref = doc(getFirebaseDb(), 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return profileFromDoc(uid, snap.data());
}

/** Create or refresh a profile for a newly signed-up user. */
export async function createProfile(user: AppUser): Promise<Profile> {
  const data = profileData(profileDefaults(user));
  await setDoc(doc(getFirebaseDb(), 'users', user.id), data, { merge: true });
  return profileFromDoc(user.id, data);
}

/** Merge a partial patch into the profile document. */
export async function saveProfile(uid: string, patch: Partial<Profile>): Promise<Profile> {
  const ref = doc(getFirebaseDb(), 'users', uid);
  const update: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  // Identity fields must never be writeable from the browser as profile data.
  // Admin is a custom claim, enforced by rules + Cloud Functions.
  delete update.id;
  delete update.is_platform_admin;
  delete update.email;
  await updateDoc(ref, update);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Profile was removed while updating.');
  return profileFromDoc(uid, snap.data());
}

export async function deleteProfile(uid: string): Promise<void> {
  await deleteDoc(doc(getFirebaseDb(), 'users', uid));
}

export function profileFromDoc(uid: string, data: DocumentData): Profile {
  const defaults = profileDefaults({
    id: uid,
    uid,
    email: String(data.email ?? ''),
    emailVerified: Boolean(data.email_verified_at),
    displayName: data.display_name ? String(data.display_name) : null,
    photoURL: data.avatar_url ? String(data.avatar_url) : null,
    phoneNumber: data.phone ? String(data.phone) : null,
    phone: data.phone ? String(data.phone) : null,
    createdAt: data.created_at ? String(data.created_at) : null,
    user_metadata: {
      display_name: data.display_name ? String(data.display_name) : null,
      full_name: data.display_name ? String(data.display_name) : null,
      phone: data.phone ? String(data.phone) : null,
    },
  });
  return withDefaults(defaults, data);
}

function profileData(p: Profile): Record<string, unknown> {
  return {
    ...p,
    social: p.social ?? {},
    roles: p.roles ?? EMPTY_ROLES,
    location: p.location ?? null,
  };
}

function withDefaults(defaults: Profile, data: DocumentData): Profile {
  const value: Record<string, unknown> = { ...defaults, ...data };
  return {
    ...(value as unknown as Profile),
    roles: Array.isArray(value.roles) && value.roles.length > 0 ? (value.roles as UserRole[]) : EMPTY_ROLES,
    social: (value.social as Record<string, string>) ?? {},
    created_at: value.created_at ? String(value.created_at) : defaults.created_at,
    updated_at: value.updated_at ? String(value.updated_at) : defaults.updated_at,
    email_verified_at: value.email_verified_at ? String(value.email_verified_at) : defaults.email_verified_at,
    last_seen_at: value.last_seen_at ? String(value.last_seen_at) : defaults.last_seen_at,
  } as Profile;
}
