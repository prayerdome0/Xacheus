import { useAuth } from '@/context/AuthContext';
import { Notice } from '@/components/ui/Primitives';

export default function AdminPage() {
  const { user, profile, isPlatformAdmin } = useAuth();

  if (!isPlatformAdmin) {
    return (
      <div className="mx-auto max-w-lg py-8">
        <Notice tone="warning" title="Access denied">
          This area is reserved for platform administrators. If you believe this is an error, contact support.
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold">Admin Center</h1>
      <p className="text-sm text-ink-500">
        Welcome, {profile?.display_name ?? user?.email}. You have platform administrator privileges.
      </p>
      <Notice tone="info" title="Platform admin">
        Your account carries the Firebase custom claim <code>admin: true</code>.
        This grants access to protected admin functionality and overrides standard permissions.
      </Notice>
    </div>
  );
}
