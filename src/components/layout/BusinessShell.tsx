import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Logo, LogoMark } from './Logo';
import { NotificationBell } from './NotificationBell';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Badge, Button } from '@/components/ui/Primitives';
import { Avatar, BusinessAvatar, Modal, SearchBar, Sheet } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useBusiness } from '@/context/BusinessContext';
import { useMode } from '@/context/ModeContext';
import { BUSINESS_NAV, QUICK_ACTIONS, BRAND, ROLE_LABELS } from '@/lib/constants';
import { displayName } from '@/lib/format';
import { formatMoney, toNum } from '@/lib/currency';
import { useEscape, useScrollLock } from '@/hooks/useUi';

/**
 * The business dashboard shell.
 *
 * Phone-first: a drawer for the full grouped navigation, a bottom nav for the
 * four things a seller touches constantly, and the floating + Create button.
 * Desktop gets the persistent sidebar instead.
 */

const MOBILE_NAV: { to: string; label: string; icon: IconName; permission?: string }[] = [
  { to: '/business', label: 'Home', icon: 'dashboard', permission: 'dashboard.read' },
  { to: '/business/pos', label: 'POS', icon: 'scan', permission: 'pos.use' },
  { to: '/business/orders', label: 'Orders', icon: 'cart', permission: 'orders.read' },
  { to: '/business/invoices', label: 'Invoices', icon: 'invoice', permission: 'invoices.read' },
];

export function BusinessShell({ children }: { children?: ReactNode }) {
  const { user } = useAuth();
  const { activeBusiness, activeMembership, can, loading } = useBusiness();
  const { toggle } = useMode();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  useScrollLock(drawerOpen || fabOpen || searchOpen);
  useEscape(drawerOpen, () => setDrawerOpen(false));
  useEscape(fabOpen, () => setFabOpen(false));
  useEscape(searchOpen, () => setSearchOpen(false));

  useEffect(() => { setDrawerOpen(false); setFabOpen(false); setSearchOpen(false); }, [location.pathname]);

  const groups = useMemo(
    () => BUSINESS_NAV
      .map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || can(i.permission)) }))
      .filter((g) => g.items.length > 0),
    [can],
  );

  const quickActions = useMemo(() => QUICK_ACTIONS.filter((a) => !a.permission || can(a.permission)), [can]);
  const mobileNav = useMemo(() => {
    const allowed = MOBILE_NAV.filter((i) => !i.permission || can(i.permission));
    return [...allowed, { to: '/business/more', label: 'More', icon: 'menu' as IconName }].slice(0, 5);
  }, [can]);

  const currency = activeBusiness?.base_currency ?? 'ZMW';
  const owed = toNum((activeBusiness as { outstanding_balance?: number | string } | null)?.outstanding_balance ?? 0);

  const runSearch = () => {
    const term = q.trim();
    setSearchOpen(false);
    if (term) navigate(`/business/search?q=${encodeURIComponent(term)}`);
  };

  if (!user) return null;

  const sidebar = (
    <div className="flex h-full flex-col bg-ink-950 text-white">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-3">
        <div className="min-w-0 flex-1"><BusinessSwitcher /></div>
        <button type="button" onClick={() => setDrawerOpen(false)}
          className="rounded-lg p-2 text-white/70 hover:bg-white/10 lg:hidden" aria-label="Close menu">
          <Icon name="close" size={18} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3 sh-no-scrollbar" aria-label="Business">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="px-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-white/35">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/business'}
                    className={({ isActive }) => `flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-semibold transition-colors ${
                      isActive ? 'bg-brand-600 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <span aria-hidden="true" className="w-5 text-center text-[15px] leading-none">{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <Link to="/business/growth" className="mb-2 flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2.5 hover:bg-white/10">
          <span className="text-lg" aria-hidden="true">🏆</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-white/50">Business health</span>
            <span className="block text-[13px] font-extrabold">Growth score</span>
          </span>
          <Icon name="chevronRight" size={16} className="text-white/50" />
        </Link>
        <button type="button" onClick={toggle}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-400 px-3 py-2.5 text-[13px] font-extrabold text-ink-950 hover:bg-accent-300">
          <Icon name="cart" size={16} /> Switch to Shop mode
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-ink-50 lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 lg:block no-print">{sidebar}</aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50 animate-fade" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 w-[86vw] max-w-[320px] shadow-pop animate-rise">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/95 backdrop-blur-md pt-safe no-print">
          <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
            <button type="button" onClick={() => setDrawerOpen(true)}
              className="rounded-xl p-2 text-ink-700 hover:bg-ink-100 lg:hidden" aria-label="Open menu">
              <Icon name="menu" size={22} />
            </button>

            <Link to="/" className="shrink-0 lg:hidden" aria-label={BRAND.name}><LogoMark size={30} /></Link>
            <Link to="/" className="hidden shrink-0 lg:inline-flex"><Logo height={26} /></Link>

            <span className="hidden h-5 w-px bg-ink-200 lg:block" aria-hidden="true" />

            <div className="hidden min-w-0 flex-1 lg:block">
              <SearchBar
                value={q}
                onChange={setQ}
                onSubmit={runSearch}
                placeholder="Search products, customers, invoices, orders…"
              />
            </div>

            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => setSearchOpen(true)}
                className="rounded-xl p-2.5 text-ink-600 hover:bg-ink-100 lg:hidden" aria-label="Search">
                <Icon name="search" size={20} />
              </button>

              <Link to="/business/ai"
                className="hidden items-center gap-1.5 rounded-xl bg-accent-50 px-3 py-2 text-xs font-bold text-accent-700 hover:bg-accent-100 sm:inline-flex"
                title="Ask Seedwel AI">
                <Icon name="sparkles" size={15} /> AI
              </Link>

              <NotificationBell scope="business" compact />

              <button type="button" onClick={toggle}
                className="rounded-xl p-2 text-ink-600 hover:bg-ink-100" aria-label="Switch to Shop mode" title="Switch to Shop mode">
                <Icon name="cart" size={20} />
              </button>

              <BusinessMenu />
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto border-t border-ink-100 px-3 py-1.5 text-[11px] sh-no-scrollbar sm:px-4">
            <span className="inline-flex items-center gap-1.5 font-semibold text-ink-700">
              <BusinessAvatar business={activeBusiness} size={18} showVerified={false} />
              <span className="max-w-[12rem] truncate">{activeBusiness?.name ?? 'No business selected'}</span>
            </span>
            {activeMembership && (
              <Badge tone="neutral">{ROLE_LABELS[activeMembership.role] ?? activeMembership.role}</Badge>
            )}
            {activeBusiness?.verification_status === 'verified'
              ? <Badge tone="blue" icon="shield">Verified</Badge>
              : <Badge tone="amber" icon="warning">Unverified</Badge>}
            {activeBusiness && (
              <>
                <Dot />
                <span className="whitespace-nowrap text-ink-500">{activeBusiness.city ?? '—'}</span>
                <Dot />
                <span className="whitespace-nowrap font-semibold text-ink-600">{currency}</span>
                <Dot />
                <Link to="/business/subscription" className="whitespace-nowrap font-semibold text-brand-700 hover:underline">
                  {(activeBusiness as { plan_name?: string }).plan_name ?? 'Free plan'}
                </Link>
                {owed > 0 && (
                  <>
                    <Dot />
                    <Link to="/business/finance" className="whitespace-nowrap font-bold text-red-600 hover:underline">
                      Owed to you {formatMoney(owed, currency)}
                    </Link>
                  </>
                )}
              </>
            )}
          </div>
        </header>

        <main className="min-w-0 flex-1 px-3 pb-28 pt-4 sm:px-4 lg:px-6 lg:pb-10">
          <div className="mx-auto w-full max-w-[1400px]">
            {loading && !activeBusiness
              ? <div className="sh-card-flat p-8 text-center text-sm text-ink-500">Loading your business…</div>
              : (children ?? <Outlet />)}
          </div>
        </main>
      </div>

      <nav className="sh-bottomnav no-print" aria-label="Business">
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {mobileNav.map((item) => {
            const active = item.to === '/business'
              ? location.pathname === '/business'
              : location.pathname.startsWith(item.to);
            return (
              <li key={item.to}>
                <NavLink to={item.to} end={item.to === '/business'} data-active={active}
                  className="sh-bottomnav-item w-full" aria-current={active ? 'page' : undefined}>
                  <Icon name={item.icon} size={21} filled={active} />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {quickActions.length > 0 && (
        <>
          <button type="button" onClick={() => setFabOpen(true)} className="sh-fab no-print" aria-label="Create">
            <Icon name="plus" size={26} />
          </button>
          <Sheet open={fabOpen} onClose={() => setFabOpen(false)} title="Create">
            <div className="grid grid-cols-2 gap-2 pb-2 sm:grid-cols-3">
              {quickActions.map((a) => (
                <Link key={a.label} to={a.to}
                  className="flex items-center gap-2.5 rounded-xl border border-ink-200 px-3 py-3 text-[13px] font-semibold text-ink-800 hover:border-brand-300 hover:bg-brand-50">
                  <span aria-hidden="true" className="text-lg">{a.icon}</span>
                  <span className="truncate">{a.label}</span>
                </Link>
              ))}
            </div>
          </Sheet>
        </>
      )}

      <Sheet open={searchOpen} onClose={() => setSearchOpen(false)} title="Search your business">
        <form onSubmit={(e) => { e.preventDefault(); runSearch(); }} className="space-y-3 pb-2">
          <SearchBar value={q} onChange={setQ} onSubmit={runSearch} autoFocus
            placeholder="Products, customers, invoices, SKUs…" />
          <Button block type="submit" icon="search">Search</Button>
        </form>
      </Sheet>
    </div>
  );
}

function Dot() {
  return <span className="text-ink-300" aria-hidden="true">·</span>;
}

/* ── Business switcher ─────────────────────────────────────────────────────── */

export function BusinessSwitcher() {
  const { businesses, activeBusiness, setActiveBusinessId, can } = useBusiness();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-white/10">
        <BusinessAvatar business={activeBusiness} size={30} showVerified={false} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold text-white">
            {activeBusiness?.name ?? 'Select business'}
          </span>
          <span className="block truncate text-[11px] text-white/50">
            seedwelhub.com/store/{activeBusiness?.slug ?? '—'}
          </span>
        </span>
        <Icon name="chevronDown" size={15} className="text-white/50" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Switch business">
        <div className="space-y-2 pb-2">
          <p className="sh-label">Your businesses</p>
          <ul className="space-y-1">
            {businesses.map((b) => (
              <li key={b.id}>
                <button type="button"
                  onClick={() => { setActiveBusinessId(b.id); setOpen(false); }}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors ${
                    b.id === activeBusiness?.id ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-ink-100'
                  }`}>
                  <BusinessAvatar business={b} size={32} showVerified={false} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-ink-900">{b.name}</span>
                    <span className="block truncate text-xs text-ink-500">{b.city ?? '—'} · {b.base_currency}</span>
                  </span>
                  {b.id === activeBusiness?.id && <Icon name="check" size={16} className="text-brand-600" />}
                </button>
              </li>
            ))}
            {businesses.length === 0 && (
              <li className="rounded-xl bg-ink-50 px-3 py-4 text-center text-sm text-ink-500">No businesses yet.</li>
            )}
          </ul>

          {can('settings.read') && activeBusiness && (
            <div className="grid grid-cols-2 gap-2 border-t border-ink-200 pt-3">
              <Button variant="outline" size="sm" icon="settings"
                onClick={() => { setOpen(false); navigate('/business/settings'); }}>
                Settings
              </Button>
              <Button variant="outline" size="sm" icon="external"
                onClick={() => { setOpen(false); navigate(`/store/${activeBusiness.slug}`); }}>
                View store
              </Button>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}

/* ── Account menu inside the business top bar ──────────────────────────────── */

function BusinessMenu() {
  const { user, profile, signOut } = useAuth();
  const { activeMembership } = useBusiness();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const rows: { label: string; icon: IconName; to: string }[] = [
    { label: 'My account', icon: 'user', to: '/account' },
    { label: 'Shop mode', icon: 'cart', to: '/' },
    { label: 'Notifications', icon: 'bell', to: '/notifications' },
    { label: 'Help centre', icon: 'book', to: '/help' },
  ];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-xl p-1 hover:bg-ink-100" aria-label="Account menu">
        <Avatar src={profile?.avatar_url} name={displayName(profile)} size={30} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Account" size="sm">
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-2xl border border-ink-200 p-3">
            <Avatar src={profile?.avatar_url} name={displayName(profile)} size={44} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{displayName(profile)}</p>
              <p className="truncate text-xs text-ink-500">{profile?.email}</p>
              {activeMembership && <Badge tone="brand" className="mt-1">{ROLE_LABELS[activeMembership.role]}</Badge>}
            </div>
          </div>
          <ul className="divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-200">
            {rows.map((r) => (
              <li key={r.to}>
                <button type="button" onClick={() => { setOpen(false); navigate(r.to); }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium text-ink-700 hover:bg-ink-50">
                  <Icon name={r.icon} size={17} className="text-ink-500" />
                  {r.label}
                  <Icon name="chevronRight" size={15} className="ml-auto text-ink-300" />
                </button>
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" block icon="logout" className="text-red-600"
            onClick={async () => { setOpen(false); await signOut(); navigate('/'); }}>
            Sign out
          </Button>
          <p className="text-center text-[11px] text-ink-400">Signed in as {user?.email}</p>
        </div>
      </Modal>
    </>
  );
}

/* ── Page header used by every business screen ─────────────────────────────── */

export function PageHeader({ title, subtitle, icon, actions, backTo, tabs }: {
  title: ReactNode; subtitle?: ReactNode; icon?: IconName | string;
  actions?: ReactNode; backTo?: string; tabs?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {backTo && (
            <button type="button" onClick={() => navigate(backTo)}
              className="mt-0.5 rounded-xl border border-ink-200 bg-white p-2 text-ink-600 hover:bg-ink-50"
              aria-label="Go back">
              <Icon name="arrowLeft" size={17} />
            </button>
          )}
          {icon && (
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              {typeof icon === 'string' && icon.length <= 4 && !/^[a-z]+$/i.test(icon)
                ? <span className="text-lg" aria-hidden="true">{icon}</span>
                : <Icon name={icon as IconName} size={20} />}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold leading-tight sm:text-xl">{title}</h1>
            {subtitle && <p className="mt-0.5 text-xs text-ink-500 sm:text-sm">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="mt-3">{tabs}</div>}
    </div>
  );
}
