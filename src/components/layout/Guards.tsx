import { type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useBusiness } from '@/context/BusinessContext';
import { BrandLockup } from './Logo';
import { Button, EmptyState, Notice } from '@/components/ui/Primitives';
import { Icon } from '@/components/ui/Icon';
import { missingPermissionMessage } from '@/lib/permissions';
import { BRAND } from '@/lib/constants';

/** Redirect to sign-in, remembering where the user was heading. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullScreenLoader label="Checking your session…" />;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth/signin?next=${next}`} replace />;
  }
  return <>{children}</>;
}

/** Public-only screens (sign in / sign up) bounce a signed-in user home. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { user, loading, profile } = useAuth();
  if (loading) return <FullScreenLoader label="Checking your session…" />;
  if (user) {
    const hasBusiness = Boolean(profile?.default_business);
    return <Navigate to={hasBusiness ? '/business' : '/'} replace />;
  }
  return <>{children}</>;
}

/**
 * Business screens need three things in order:
 *   1. a signed-in account
 *   2. at least one business (else: the create-your-store flow)
 *   3. the permission for that screen (else: an honest "you cannot" panel)
 */
export function RequireBusiness({ children, permission, permissions }: {
  children: ReactNode; permission?: string; permissions?: string[];
}) {
  const { user, loading } = useAuth();
  const { activeBusiness, businesses, loading: businessLoading, error } = useBusiness();
  const location = useLocation();

  if (loading || businessLoading) return <FullScreenLoader label="Loading your business…" />;

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth/signin?next=${next}`} replace />;
  }

  if (businesses.length === 0) {
    return <Navigate to="/business/setup" replace state={{ from: location.pathname }} />;
  }

  if (!activeBusiness) return <FullScreenLoader label="Selecting your business…" />;

  if (error) {
    return (
      <div className="mx-auto max-w-xl py-8">
        <Notice tone="danger" title="Could not load your business">{error}</Notice>
      </div>
    );
  }

  if (permission || permissions?.length) {
    return <RequirePermission permission={permission} permissions={permissions}>{children}</RequirePermission>;
  }

  return <>{children}</>;
}

/** Permission gate with an explanation instead of a blank screen. */
export function RequirePermission({ children, permission, permissions }: {
  children: ReactNode; permission?: string; permissions?: string[];
}) {
  const { can, canAny, activeMembership } = useBusiness();
  const ok = permissions?.length ? canAny(permissions) : permission ? can(permission) : true;

  if (ok) return <>{children}</>;

  return (
    <div className="mx-auto max-w-xl py-6">
      <EmptyState
        icon="lock"
        title="You do not have access to this"
        description={missingPermissionMessage(permission ?? permissions?.[0] ?? '', activeMembership?.role)}
        action={
          <>
            <Link to="/business"><Button variant="outline" size="sm" icon="dashboard">Back to dashboard</Button></Link>
            <Link to="/business/staff"><Button size="sm" icon="users">See roles & permissions</Button></Link>
          </>
        }
      />
      <p className="mt-4 text-center text-xs text-ink-500">
        Seedwel Hub enforces this rule in the database too — a cashier cannot read company expenses
        even by calling the API directly.
      </p>
    </div>
  );
}

export function FullScreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-ink-50 px-6">
      <BrandLockup />
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
        {label}
      </div>
    </div>
  );
}

/** 404 — honest, useful, never fake. */
export function NotFound({ title = 'We could not find that page', message }: { title?: string; message?: string }) {
  return (
    <div className="mx-auto max-w-lg py-12">
      <EmptyState
        icon="search"
        title={title}
        description={message ?? 'The link may be old, or the item may have been removed by its owner.'}
        action={
          <>
            <Link to="/"><Button variant="outline" size="sm" icon="home">Go home</Button></Link>
            <Link to="/search"><Button size="sm" icon="search">Search the marketplace</Button></Link>
          </>
        }
      />
    </div>
  );
}

/** Route for platform-admin-only screens (verification queue, ads review). */
export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const { isPlatformAdmin, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!isPlatformAdmin) {
    return (
      <div className="mx-auto max-w-xl py-8">
        <Notice tone="warning" title="Seedwel Hub staff only">
          This area is reserved for {BRAND.name} platform administrators who review business
          verification, reported content and advertisements.
        </Notice>
        <div className="mt-4 flex justify-center">
          <Link to="/"><Button variant="outline" size="sm" icon="home">Back to marketplace</Button></Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * Shown by not-yet-migrated modules while their data layer can still detect a
 * missing/legacy backend. Phase 2+ replaces this with Firestore-scoped screens.
 */
export function SchemaHint({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <Notice tone="warning" title="This module is waiting for its Firebase migration" icon="warning">
        <div className="space-y-2">
          <p>
            Auth and profiles are on Firebase. This screen still expects the legacy
            Supabase data layer, which is being moved to Cloud Firestore phase by
            phase — see <code className="rounded bg-white/70 px-1 font-mono text-[11px]">docs/FIREBASE_MIGRATION.md</code>.
          </p>
          <p className="flex items-center gap-1.5 text-xs opacity-80">
            <Icon name="info" size={13} /> Nothing on this screen is simulated — real Firestore data appears once its collection is migrated.
          </p>
        </div>
      </Notice>
      {children}
    </div>
  );
}
