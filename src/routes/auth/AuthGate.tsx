import { Link } from 'react-router-dom';
import { BrandLockup } from '@/components/layout/Logo';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Primitives';
import { firebaseSetupHint, isFirebaseConfigured } from '@/lib/env';

/**
 * Shown instead of the app when Firebase config is missing or malformed.
 *
 * Seedwel Hub must never render invented data, so with no backend we stop and
 * explain exactly what to do.
 */
export function FirebaseGate() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-ink-50 px-5 py-12">
      <BrandLockup />

      <div className="w-full max-w-xl space-y-4">
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <Icon name="warning" size={22} className="mt-0.5 shrink-0 text-amber-600" />
            <div>
              <h1 className="text-base font-extrabold text-amber-900">Connect your Firebase project</h1>
              <p className="mt-1 text-sm text-amber-900/85">
                {firebaseSetupHint || 'The Firebase config in .env could not be used.'}
              </p>
            </div>
          </div>
        </div>

        <ol className="sh-card-flat divide-y divide-ink-100 text-sm">
          <Step n={1} title="Create or open your Firebase project">
            <p>
              Go to <a className="font-semibold text-brand-700 underline" href="https://console.firebase.google.com" target="_blank" rel="noreferrer">console.firebase.google.com</a>,
              add a <strong>Web app</strong>, then copy the official <code className="rounded bg-ink-100 px-1 font-mono text-xs">firebaseConfig</code>.
            </p>
          </Step>
          <Step n={2} title="Enable Authentication + Firestore">
            <p>
              Turn on <strong>Email/Password</strong> in Authentication, create a <strong>Cloud Firestore</strong>
              database, then deploy the rules in
              <code className="mx-1 rounded bg-ink-100 px-1 font-mono text-xs">firebase/firestore.rules</code> and
              <code className="mx-1 rounded bg-ink-100 px-1 font-mono text-xs">firebase/storage.rules</code>.
            </p>
          </Step>
          <Step n={3} title="Set the environment variables">
            <pre className="mt-2 overflow-x-auto rounded-xl bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-white/90">
{`VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=...
VITE_CLOUDINARY_CLOUD_NAME=...
VITE_CLOUDINARY_PRESET=...
VITE_DEFAULT_COUNTRY=ZM
VITE_DEFAULT_CURRENCY=ZMW`}
            </pre>
            <p className="mt-2">
              Copy <code className="rounded bg-ink-100 px-1 font-mono text-xs">.env.example</code> to
              <code className="mx-1 rounded bg-ink-100 px-1 font-mono text-xs">.env</code>, paste the values, then
              restart the dev server.
            </p>
          </Step>
          <Step n={4} title="Deploy/verify the security rules">
            <p>
              Use <code className="rounded bg-ink-100 px-1 font-mono text-xs">firebase deploy --only firestore:rules,storage:rules</code>.
              The web API key and upload preset are public identifiers — Firestore rules and custom claims are what
              protect the data. Never put the Cloudinary API secret or Firebase service-account key in this repo.
            </p>
          </Step>
        </ol>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button icon="refresh" onClick={() => window.location.reload()}>Reload the app</Button>
          <Link to="/legal/privacy">
            <Button variant="ghost" size="md">Privacy policy</Button>
          </Link>
        </div>

        <p className="text-center text-xs text-ink-500">
          A product of Seedwel Investment Limited
        </p>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 p-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-extrabold text-white">
        {n}
      </span>
      <div className="min-w-0 space-y-1">
        <h2 className="text-sm font-bold text-ink-900">{title}</h2>
        <div className="text-[13px] leading-relaxed text-ink-600">{children}</div>
      </div>
    </li>
  );
}

export { isFirebaseConfigured };
