/**
 * Runtime configuration.
 *
 * The platform is being migrated from Supabase to Firebase. Phase 1 wires
 * Firebase Authentication + Cloud Firestore for identity and user profiles,
 * and moves media toward Cloudinary. Only PUBLIC client values belong here:
 *
 * - Firebase web API key is a public identifier, not a secret. Access control
 *   lives in Firestore/Storage security rules + Firebase custom claims.
 * - Cloudinary API secret must NEVER appear here or anywhere in browser code.
 *   Use an unsigned upload preset or a signed upload endpoint in a Cloud
 *   Function. `VITE_CLOUDINARY_PRESET` is the public preset name only.
 */

function readBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return value !== '' && value !== '0' && value !== 'false' && value !== 'no';
}

/* ── Firebase (current backend) ───────────────────────────────────────────── */

const firebaseApiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
const firebaseAuthDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined;
const firebaseProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
const firebaseStorageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined;
const firebaseMessagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined;
const firebaseAppId = import.meta.env.VITE_FIREBASE_APP_ID as string | undefined;
const firebaseMeasurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined;
const firebaseVapidPublicKey = import.meta.env.VITE_FIREBASE_VAPID_PUBLIC_KEY as string | undefined;

export const firebaseConfig = {
  apiKey: firebaseApiKey ?? '',
  authDomain: firebaseAuthDomain ?? '',
  projectId: firebaseProjectId ?? '',
  storageBucket: firebaseStorageBucket ?? '',
  messagingSenderId: firebaseMessagingSenderId ?? '',
  appId: firebaseAppId ?? '',
  measurementId: firebaseMeasurementId ?? '',
};

/** Public Web Push key. The private key must stay in Cloud Functions. */
export const vapidPublicKey = firebaseVapidPublicKey ?? '';

/** True when the app has enough Firebase public config to start. */
export const isFirebaseConfigured =
  Boolean(firebaseProjectId && firebaseAuthDomain && firebaseAppId && firebaseApiKey);

/** Human-readable guidance shown by <FirebaseGate/> when config is missing. */
export const firebaseSetupHint = !firebaseApiKey
  ? 'VITE_FIREBASE_API_KEY is missing.'
  : !firebaseAuthDomain
    ? 'VITE_FIREBASE_AUTH_DOMAIN is missing.'
    : !firebaseProjectId
      ? 'VITE_FIREBASE_PROJECT_ID is missing.'
      : !firebaseAppId
        ? 'VITE_FIREBASE_APP_ID is missing.'
        : 'The Firebase config in .env is incomplete. Copy the web app config from the Firebase console.';

/* ── Cloudinary (public client values only) ────────────────────────────────── */

export const cloudinaryConfig = {
  cloudName: (import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined) ?? '',
  unsignedPreset: (import.meta.env.VITE_CLOUDINARY_PRESET as string | undefined) ?? '',
};

/** True when enough public Cloudinary config is present to do unsigned uploads. */
export const isCloudinaryConfigured = Boolean(cloudinaryConfig.cloudName && cloudinaryConfig.unsignedPreset);

/** Shared upload endpoint. The API secret is never needed here (unsigned preset). */
export const cloudinaryUploadUrl = cloudinaryConfig.cloudName
  ? `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/image/upload`
  : '';

/* ── Locale / feature flags ────────────────────────────────────────────────── */

export const env = {
  defaultCountry: (import.meta.env.VITE_DEFAULT_COUNTRY as string | undefined) ?? 'ZM',
  defaultCurrency: (import.meta.env.VITE_DEFAULT_CURRENCY as string | undefined) ?? 'ZMW',
  isDev: import.meta.env.DEV,
  /** Public site origin, used to build shareable document/payment links. */
  appUrl: typeof window !== 'undefined' ? window.location.origin : '',
  /** Firebase requires a "signed in as a brand new user" profile after signup. */
  requireEmailVerification: readBool(import.meta.env.VITE_REQUIRE_EMAIL_VERIFICATION, true),
};

/**
 * Legacy Supabase client configuration.
 *
 * These remain exported only because the marketplace, business and document
 * modules still import the old data layer while Phase 2+ moves each module to
 * Firestore. Do NOT ship new work through these. Each migrated module removes
 * its Supabase import and these exports can then be deleted entirely.
 */
const legacySupabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const legacySupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const legacySupabase = {
  url: legacySupabaseUrl ?? '',
  anonKey: legacySupabaseAnonKey ?? '',
};

/** Kept in the legacy module until the last Supabase data query is migrated. */
export const isSupabaseConfigured =
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(legacySupabase.url) &&
  legacySupabase.anonKey.length > 20;

/** Kept in the legacy module until the last Supabase data query is migrated. */
export const supabaseSetupHint = !legacySupabase.url
  ? 'VITE_SUPABASE_URL is missing (legacy Supabase data layer).'
  : !legacySupabase.anonKey
    ? 'VITE_SUPABASE_ANON_KEY is missing (legacy Supabase data layer).'
    : !isSupabaseConfigured
      ? 'The Supabase URL does not look like https://<project-ref>.supabase.co.'
      : '';

/**
 * @deprecated Supabase is replaced by Firebase. This alias is used by the not
 * yet migrated market/business modules and will be removed after Phase 2+.
 */
export const supabaseUrl = legacySupabase.url;
/**
 * @deprecated Supabase is replaced by Firebase. This alias is used by the not
 * yet migrated market/business modules and will be removed after Phase 2+.
 */
export const supabaseAnonKey = legacySupabase.anonKey;
