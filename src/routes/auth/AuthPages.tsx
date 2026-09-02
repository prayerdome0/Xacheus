import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { Icon } from '@/components/ui/Icon';
import { Button, Checkbox, Input, Notice, Select } from '@/components/ui/Primitives';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  BRAND,
  COUNTRIES,
  flagEmoji,
  countryDial,
  countryCurrency,
  countryLanguage,
  countryTimeZone,
} from '@/lib/constants';
import { normalisePhone } from '@/lib/slug';
import type { UserRole } from '@/types';

/**
 * Authentication screens.
 *
 * One account, many roles: the same email can shop, sell and run a business.
 * Signup captures the intent ("I want to sell") and the database extends
 * profiles.roles automatically when the business is created.
 */

const ROLE_OPTIONS: { key: UserRole; label: string; hint: string; emoji: string }[] = [
  { key: 'buyer', label: 'Shop & buy', hint: 'Browse, order, pay and review', emoji: '🛍️' },
  { key: 'seller', label: 'Sell products or services', hint: 'Your own store, catalogue and orders', emoji: '🏷️' },
  { key: 'business', label: 'Run a business', hint: 'Invoices, stock, expenses, staff and reports', emoji: '🏢' },
  { key: 'service_provider', label: 'Provide services', hint: 'Bookings, quotes and job tracking', emoji: '🛠️' },
  { key: 'supplier', label: 'Supply other businesses', hint: 'Wholesale catalogue and purchase orders', emoji: '🚚' },
];

function AuthLayout({ title, subtitle, children, footer }: {
  title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-ink-50">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/"><Logo height={28} /></Link>
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-brand-700">
          <Icon name="arrowLeft" size={16} /> Back to marketplace
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-2 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">
          <div className="sh-card p-5 sm:p-7">
            <h1 className="text-xl font-extrabold sm:text-2xl">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-ink-500">{subtitle}</p>}
            <div className="mt-5">{children}</div>
          </div>
          {footer}
          <p className="mt-6 text-center text-[11px] leading-relaxed text-ink-400">
            {BRAND.companyLine}
            <br />
            <Link to="/legal/terms" className="hover:text-brand-700">Terms</Link>
            {' · '}
            <Link to="/legal/privacy" className="hover:text-brand-700">Privacy</Link>
            {' · '}
            <Link to="/help" className="hover:text-brand-700">Help</Link>
          </p>
        </div>
      </main>
    </div>
  );
}

/* ── Sign in ───────────────────────────────────────────────────────────────── */

export function SignInPage() {
  const { signIn } = useAuth();
  const { success } = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true);
    const res = await signIn(email, password);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    success('Welcome back', 'You are signed in to Seedwel Hub.');
    navigate(next, { replace: true });
  };

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Shop, sell and manage your business from one account."
      footer={
        <p className="mt-4 text-center text-sm text-ink-600">
          New to {BRAND.name}?{' '}
          <Link to={`/auth/signup?next=${encodeURIComponent(next)}`} className="font-bold text-brand-700 hover:underline">
            Create a free account
          </Link>
        </p>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="danger" title="Could not sign in">{error}</Notice>}

        <Input
          label="Email address" type="email" required autoComplete="email" autoFocus
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
        />
        <div className="relative">
          <Input
            label="Password" type={show ? 'text' : 'password'} required autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
          />
          <button type="button" onClick={() => setShow((v) => !v)}
            className="absolute right-3 top-[34px] rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            aria-label={show ? 'Hide password' : 'Show password'}>
            <Icon name={show ? 'eyeOff' : 'eye'} size={17} />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <Link to="/auth/forgot" className="text-sm font-semibold text-brand-700 hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" size="lg" block loading={busy}>Sign in</Button>
      </form>
    </AuthLayout>
  );
}

/* ── Sign up ───────────────────────────────────────────────────────────────── */

export function SignUpPage() {
  const { signUp } = useAuth();
  const { success } = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';
  const intent = params.get('intent');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+260');
  const [country, setCountry] = useState('ZM');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [roles, setRoles] = useState<UserRole[]>(
    intent === 'sell' ? ['buyer', 'seller'] : ['buyer'],
  );
  const [businessName, setBusinessName] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wantsToSell = roles.includes('seller') || roles.includes('business') || roles.includes('service_provider') || roles.includes('supplier');

  const strength = useMemo(() => scorePassword(password), [password]);

  const toggleRole = (role: UserRole) => {
    setRoles((prev) => {
      if (role === 'buyer') return prev; // every account can shop
      return prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role];
    });
  };

  /** Picking a country auto-selects its dial code and the profile locale. */
  const onCountryChange = (value: string) => {
    setCountry(value);
    setCountryCode(countryDial(value));
  };

  const countryInfo = COUNTRIES.find((c) => c.code === country);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (fullName.trim().length < 2) { setError('Please enter your full name.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
    if (password.length < 8) { setError('Use at least 8 characters for your password.'); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    if (!agree) { setError('Please accept the Terms and Privacy Policy to continue.'); return; }

    setBusy(true);
    const res = await signUp({
      email: email.trim(),
      password,
      fullName: fullName.trim(),
      phone: phone ? normalisePhone(phone, countryCode) : undefined,
      phoneCountryCode: countryCode,
      countryCode: country,
      currency: countryCurrency(country),
      language: countryLanguage(country),
      timeZone: countryTimeZone(country),
      city: city.trim() || undefined,
      region: region.trim() || undefined,
      postalCode: postalCode.trim() || undefined,
      roles,
      primaryRole: wantsToSell ? 'seller' : 'buyer',
      headline: businessName.trim() || undefined,
    });
    setBusy(false);

    if (res.error) { setError(res.error); return; }

    if (res.needsConfirmation) {
      success('Check your email', `We sent a confirmation link to ${email.trim()}.`);
      navigate('/auth/confirm', { state: { email: email.trim() }, replace: true });
    } else {
      success('Welcome to Seedwel Hub', wantsToSell ? 'Let’s set up your store.' : 'Start exploring the marketplace.');
      navigate(wantsToSell ? '/business/setup' : next, { replace: true });
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Free to join. One account for shopping, selling and running your business."
      footer={
        <p className="mt-4 text-center text-sm text-ink-600">
          Already have an account?{' '}
          <Link to={`/auth/signin?next=${encodeURIComponent(next)}`} className="font-bold text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="danger" title="Could not create the account">{error}</Notice>}

        <div>
          <p className="sh-field-label">I want to…</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLE_OPTIONS.map((r) => {
              const active = roles.includes(r.key);
              const locked = r.key === 'buyer';
              return (
                <button
                  key={r.key} type="button" onClick={() => toggleRole(r.key)}
                  disabled={locked}
                  aria-pressed={active}
                  className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors ${
                    active ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-200' : 'border-ink-200 hover:border-ink-300'
                  } ${locked ? 'cursor-default' : ''}`}
                >
                  <span className="text-lg leading-none" aria-hidden="true">{r.emoji}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold text-ink-900">{r.label}</span>
                    <span className="block text-[11px] leading-snug text-ink-500">{r.hint}</span>
                  </span>
                  {active && <Icon name="check" size={15} className="ml-auto shrink-0 text-brand-600" />}
                </button>
              );
            })}
          </div>
        </div>

        {wantsToSell && (
          <Input
            label="Business or shop name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g. Lusaka Fresh Produce"
            hint="You can change this later, and your store address is created from it."
          />
        )}

        <Input label="Full name" required autoComplete="name" value={fullName}
          onChange={(e) => setFullName(e.target.value)} placeholder="Chanda Mulenga" />

        <Input label="Email address" type="email" required autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />

        <div className="grid grid-cols-[7.5rem_1fr] gap-2">
          <Select label="Dial code" value={countryCode} onChange={(e) => setCountryCode(e.target.value)}
            options={COUNTRIES.map((c) => ({ value: c.dial, label: `${flagEmoji(c.code)} ${c.dial}` }))} />
          <Input label="Phone (for order updates)" type="tel" autoComplete="tel" value={phone}
            onChange={(e) => setPhone(e.target.value)} placeholder="97 123 4567" />
        </div>

        <Select label="Country" value={country} onChange={(e) => onCountryChange(e.target.value)}
          options={COUNTRIES.map((c) => ({ value: c.code, label: `${flagEmoji(c.code)} ${c.name}` }))} />

        {/* Location — worldwide: state/region, city, and postal/ZIP are optional. */}
        <div className="space-y-3">
          <p className="sh-label">Location (optional)</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input label="State / province / region" value={region}
              onChange={(e) => setRegion(e.target.value)} placeholder="e.g. Lusaka Province, Gauteng, Lagos" />
            <Input label="City" value={city}
              onChange={(e) => setCity(e.target.value)} placeholder="e.g. Lusaka, Johannesburg" />
          </div>
          <Input label="Postal / ZIP code" value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)} placeholder="e.g. 10101" />
          {countryInfo && (
            <p className="flex items-center gap-1.5 rounded-xl bg-ink-50 px-3 py-2 text-[11px] text-ink-500">
              <Icon name="info" size={13} className="shrink-0" />
              {flagEmoji(countryInfo.code)} {countryInfo.name} · currency {countryInfo.currency} · {countryInfo.timeZone.replace(/_/g, ' ')} · Auto-applied to your profile.
            </p>
          )}
        </div>

        <div>
          <Input label="Password" type="password" required autoComplete="new-password" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
          {password && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-200">
                <div className={`h-full rounded-full transition-all ${
                  strength.score <= 1 ? 'bg-red-500 w-1/4'
                    : strength.score === 2 ? 'bg-amber-400 w-2/4'
                    : strength.score === 3 ? 'bg-sky-500 w-3/4' : 'bg-emerald-500 w-full'
                }`} />
              </div>
              <span className="text-[11px] font-semibold text-ink-500">{strength.label}</span>
            </div>
          )}
          {strength.tips.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {strength.tips.map((t) => (
                <li key={t} className="flex items-center gap-1.5 text-[11px] text-ink-500">
                  <Icon name="info" size={11} /> {t}
                </li>
              ))}
            </ul>
          )}
        </div>

        <Input label="Confirm password" type="password" required autoComplete="new-password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} error={confirm && confirm !== password ? 'Passwords do not match' : null} />

        <Checkbox checked={agree} onChange={setAgree}
          label={
            <>
              I agree to the <Link to="/legal/terms" className="font-semibold text-brand-700 hover:underline">Terms of use</Link> and
              {' '}<Link to="/legal/privacy" className="font-semibold text-brand-700 hover:underline">Privacy policy</Link>
            </>
          }
          hint="We never sell your data. You can request a full export or deletion at any time."
        />

        <Button type="submit" size="lg" block loading={busy}>Create account</Button>

        <p className="text-center text-xs text-ink-500">
          Selling on Seedwel Hub is free to start — upgrade when you need more staff, branches or automation.
        </p>
      </form>
    </AuthLayout>
  );
}

function scorePassword(pw: string): { score: number; label: string; tips: string[] } {
  const tips: string[] = [];
  let score = 0;
  if (pw.length >= 8) score++; else tips.push('Use at least 8 characters');
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++; else tips.push('Mix upper and lower case');
  if (/\d/.test(pw)) score++; else tips.push('Add a number');
  if (/[^\w\s]/.test(pw)) score++; else tips.push('Add a symbol for extra strength');
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score, label: labels[score], tips: tips.slice(0, 2) };
}

/* ── Email confirmation ────────────────────────────────────────────────────── */

export function ConfirmEmailPage() {
  const navigate = useNavigate();
  const { user, resendVerificationEmail } = useAuth();
  const [email, setEmail] = useState<string>(
    (window.history.state?.usr?.email as string) ?? '',
  );
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  // A Firebase sign-up keeps a temporary session, but we do not let the user
  // move on until the address is verified.
  useEffect(() => { if (user?.emailVerified) navigate('/', { replace: true }); }, [user, navigate]);

  const resend = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setResendError(null);
    const res = await resendVerificationEmail(email.trim());
    setBusy(false);
    if (res.error) setResendError(res.error);
    else setSent(true);
  };

  return (
    <AuthLayout title="Confirm your email" subtitle="One more step before you can start selling.">
      <div className="space-y-4">
        <Notice tone="info" title="Check your inbox" icon="mail">
          We sent a confirmation link to <span className="font-bold">{email || 'your email address'}</span>.
          Open it on this device to finish creating your account.
        </Notice>
        {resendError && <Notice tone="danger">{resendError}</Notice>}

        <Input label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

        <Button block variant="outline" icon="refresh" loading={busy} onClick={() => void resend()}>
          {sent ? 'Send again' : 'Resend confirmation email'}
        </Button>

        <div className="grid grid-cols-2 gap-2">
          <Link to="/auth/signin"><Button block variant="ghost" size="md">Sign in instead</Button></Link>
          <Link to="/"><Button block variant="ghost" size="md">Browse marketplace</Button></Link>
        </div>

        <p className="text-center text-xs text-ink-500">
          Nothing arrived? Check spam, or contact {BRAND.supportEmail}.
        </p>
      </div>
    </AuthLayout>
  );
}

/* ── Password reset ────────────────────────────────────────────────────────── */

export function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await sendPasswordReset(email);
    setBusy(false);
    if (res.error) setError(res.error);
    else setDone(true);
  };

  return (
    <AuthLayout title="Reset your password" subtitle="We will email you a secure link to choose a new one.">
      {done ? (
        <div className="space-y-4">
          <Notice tone="success" title="Reset link sent" icon="mail">
            If an account exists for <span className="font-bold">{email}</span>, a reset link is on its way.
            The link expires after one hour.
          </Notice>
          <Link to="/auth/signin"><Button block variant="outline">Back to sign in</Button></Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <Input label="Email address" type="email" required autoFocus value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <Button type="submit" size="lg" block loading={busy}>Send reset link</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const { success } = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    const res = await updatePassword(password);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    success('Password updated', 'You can now sign in with your new password.');
    navigate('/account/settings', { replace: true });
  };

  return (
    <AuthLayout title="Choose a new password" subtitle="Pick something you have not used before.">
      <form onSubmit={submit} className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <Input label="New password" type="password" required autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.target.value)} />
        <Input label="Confirm new password" type="password" required autoComplete="new-password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} />
        <Button type="submit" size="lg" block loading={busy}>Update password</Button>
      </form>
    </AuthLayout>
  );
}

/** Landing page for OAuth/email redirect handling — bounces once a session exists. */
export function AuthCallbackPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (user) navigate('/', { replace: true });
    else setError('That sign-in link is no longer valid. Please try again.');
  }, [user, loading, navigate]);

  return (
    <AuthLayout title={loading ? 'Signing you in…' : 'Link expired'}>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-ink-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          Completing sign-in
        </div>
      ) : (
        <div className="space-y-4">
          {error && <Notice tone="warning">{error}</Notice>}
          <Link to="/auth/signin"><Button block variant="outline">Sign in again</Button></Link>
        </div>
      )}
    </AuthLayout>
  );
}
