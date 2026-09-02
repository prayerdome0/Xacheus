import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, type Auth, type User as FirebaseUser } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { firebaseConfig } from './env';

/**
 * Firebase bootstrap.
 *
 * The app must never start against an empty/invalid config, so <FirebaseGate/>
 * blocks the UI before any auth or Firestore call can run. These accessors are
 * deliberately lazy: importing firebase.ts does not create the app, which keeps
 * the large Firebase SDK out of the initial module evaluation until the config
 * gate has passed (and keeps the lazy route chunks from breaking a fresh clone
 * that still needs setup).
 */

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

function app(): FirebaseApp {
  if (!appInstance) appInstance = initializeApp(firebaseConfig as FirebaseOptions);
  return appInstance;
}

export function getFirebaseApp(): FirebaseApp {
  return app();
}

export function getFirebaseAuth(): Auth {
  if (!authInstance) authInstance = getAuth(app());
  return authInstance;
}

export function getFirebaseDb(): Firestore {
  if (!dbInstance) dbInstance = getFirestore(app());
  return dbInstance;
}

export function buildHttpError(message: string, code?: string): Error {
  const err = new Error(message);
  (err as Error & { code?: string }).code = code;
  return err;
}

/** Normalised user shape used by the React auth context. */
export interface AppUser {
  /** Firebase uid. Aliased as `id` so existing `user.id` call sites keep working. */
  id: string;
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  photoURL: string | null;
  phoneNumber: string | null;
  /** Legacy alias used by account screens. */
  phone: string | null;
  createdAt: string | null;
  /** Compatibility metadata used by the not-yet-migrated modules. */
  user_metadata: {
    display_name: string | null;
    full_name: string | null;
    phone: string | null;
  };
}

export function toAppUser(user: FirebaseUser): AppUser {
  const display = user.displayName;
  return {
    id: user.uid,
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: display,
    photoURL: user.photoURL,
    phoneNumber: user.phoneNumber,
    phone: user.phoneNumber,
    createdAt: user.metadata.creationTime ?? null,
    user_metadata: {
      display_name: display,
      full_name: display,
      phone: user.phoneNumber,
    },
  };
}

export const FIREBASE_COLLECTIONS = {
  users: 'users',
} as const;

/** Firestore document path for a user profile. */
export function userProfilePath(uid: string): string {
  return `users/${uid}`;
}
