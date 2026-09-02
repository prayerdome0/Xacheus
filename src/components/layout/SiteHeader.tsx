import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Logo, LogoMark } from './Logo';
import { NotificationBell } from './NotificationBell';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Primitives';
import { Avatar, BusinessAvatar } from '@/components/ui';
import { Dropdown, Sheet } from '@/components/ui/Overlays';
import { SearchBar } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useBusiness } from '@/context/BusinessContext';
import { useCart } from '@/context/CartContext';
import { useMode } from '@/context/ModeContext';
import { MORE_NAV, PUBLIC_NAV, BRAND } from '@/lib/constants';
import { displayName } from '@/lib/format';
import { useEscape, useScrollLock } from '@/hooks/useUi';

/**
 * Public marketplace header.
 *
 * Three things must always be one tap away on a phone: search, cart and
 * account. On desktop we add the full category rail and the Shop / My Business
 * mode switch.
 */
export function SiteHeader() {
  const { user, profile, signOut } = useAuth();
  const { activeBusiness, businesses } = useBusiness();
  const { count } = useCart();
  const { mode, toggle, canUseBusinessMode } = useMode();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  useScrollLock(menuOpen);
  useEscape(menuOpen, () => setMenuOpen(false));

  useEffect(() => { setMenuOpen(false); setSearchOpen(false); }, [location.pathname]);

  const submit = () => {
    const term = q.trim();
    navigate(term ? `/search?q=${encodeURIComponent(term)}` : '/search');
    setSearchOpen(false);
  };

  const accountItems = user ? [
    { label: 'My account', icon: <Icon name="user" size={16} />, onSelect: () => navigate('/account') },
    { label: 'My orders', icon: <Icon name="receipt" size={16} />, onSelect: () => navigate('/orders') },
    { label: 'Wishlist', icon: <Icon name="heart" size={16} />, onSelect: () => navigate('/account/wishlist') },
    { label: 'Addresses', icon: <Icon name="pin" size={16} />, onSelect: () => navigate('/account/addresses') },
    'divider' as const,
    ...(canUseBusinessMode ? [{
      label: mode === 'business' ? 'Switch to Shop mode' : 'My Business',
      icon: <Icon name={mode === 'business' ? 'cart' : 'store'} size={16} />,
      onSelect: toggle,
    }] : [{
      label: 'Sell on Seedwel Hub',
      icon: <Icon name="store" size={16} />,
      onSelect: () => navigate('/business/setup'),
    }]),
    { label: 'Help centre', icon: <Icon name="book" size={16} />, onSelect: () => navigate('/help') },
    'divider' as const,
    { label: 'Sign out', icon: <Icon name="logout" size={16} />, tone: 'danger' as const, onSelect: () => void signOut() },
  ] : [
    { label: 'Sign in', icon: <Icon name="user" size={16} />, onSelect: () => navigate('/auth/signin') },
    { label: 'Create account', icon: <Icon name="plus" size={16} />, onSelect: () => navigate('/auth/signup') },
    { label: 'Sell on Seedwel Hub', icon: <Icon name="store" size={16} />, onSelect: () => navigate('/become-a-seller') },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-ink-200 bg-white/95 backdrop-blur-md pt-safe no-print">
      {/* Announcement strip */}
      <div className="sh-gradient-brand px-3 py-1.5 text-center text-[11px] font-semibold text-white/90 sm:text-xs">
        <span className="hidden sm:inline">{BRAND.tagline} · </span>
        Free to start selling — create your online store in under 2 minutes
        <Link to="/become-a-seller" className="ml-1.5 underline underline-offset-2 hover:text-white">
          Start now
        </Link>
      </div>

      <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="rounded-xl p-2 text-ink-700 hover:bg-ink-100 lg:hidden"
          aria-label="Open menu"
        >
          <Icon name="menu" size={22} />
        </button>

        <Link to="/" className="hidden shrink-0 lg:inline-flex">
          <Logo height={30} />
        </Link>
        <Link to="/" className="shrink-0 lg:hidden" aria-label={BRAND.name}>
          <LogoMark size={32} />
        </Link>

        {/* Desktop search */}
        <div className="hidden flex-1 lg:block">
          <SearchBar
            value={q}
            onChange={setQ}
            onSubmit={submit}
            placeholder={BRAND.searchPlaceholder}
            rightSlot={
              <button type="submit" className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700">
                Search
              </button>
            }
          />
        </div>

        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="rounded-xl p-2.5 text-ink-600 hover:bg-ink-100 lg:hidden"
            aria-label="Search"
          >
            <Icon name="search" size={20} />
          </button>

          {canUseBusinessMode && (
            <button
              type="button"
              onClick={toggle}
              className="hidden items-center gap-1.5 rounded-xl border border-ink-200 px-3 py-2 text-xs font-bold text-ink-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 sm:inline-flex"
              title={mode === 'business' ? 'Switch to shopping' : 'Switch to your business dashboard'}
            >
              <Icon name={mode === 'business' ? 'cart' : 'store'} size={15} />
              {mode === 'business' ? 'Shop' : 'My Business'}
            </button>
          )}

          {activeBusiness && (
            <Link to={`/store/${activeBusiness.slug}`} className="hidden items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-ink-100 md:inline-flex"
              title="View your public store">
              <BusinessAvatar business={activeBusiness} size={26} />
              <span className="max-w-[9rem] truncate text-xs font-semibold text-ink-700">{activeBusiness.name}</span>
            </Link>
          )}

          <Link
            to="/cart"
            className="relative rounded-xl p-2.5 text-ink-600 hover:bg-ink-100"
            aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
          >
            <Icon name="cart" size={21} />
            {count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-400 px-1 text-[10px] font-extrabold text-ink-950 ring-2 ring-white">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>

          {user && <NotificationBell compact />}

          <Dropdown
            align="right"
            width="w-60"
            items={accountItems}
            trigger={({ toggle: t }) => (
              <button type="button" onClick={t} aria-label="Account"
                className="rounded-xl p-1 hover:bg-ink-100">
                {user
                  ? <Avatar src={profile?.avatar_url} name={displayName(profile)} size={32} />
                  : (
                    <span className="hidden items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 sm:inline-flex">
                      <Icon name="user" size={15} /> Sign in
                    </span>
                  )}
                {!user && (
                  <span className="ml-1.5 inline-flex rounded-xl bg-brand-600 p-2 text-white sm:hidden" aria-hidden="true">
                    <Icon name="user" size={18} />
                  </span>
                )}
              </button>
            )}
          />
        </div>
      </div>

      {/* Desktop category rail */}
      <nav className="mx-auto hidden max-w-[1400px] items-center gap-1 overflow-x-auto px-4 pb-2 sh-no-scrollbar lg:flex" aria-label="Main">
        {PUBLIC_NAV.map((item) => {
          const active = location.pathname === item.to || (item.to !== '/' && location.pathname.startsWith(item.to));
          return (
            <Link key={item.to} to={item.to}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                active ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
              }`}>
              <span className="mr-1.5" aria-hidden="true">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
        <span className="mx-1 h-4 w-px bg-ink-200" aria-hidden="true" />
        {MORE_NAV.slice(0, 3).map((item) => (
          <Link key={item.to} to={item.to}
            className="whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-semibold text-ink-600 hover:bg-ink-100 hover:text-ink-900">
            {item.label}
          </Link>
        ))}
        <Link to="/business/ai"
          className="ml-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent-50 px-3 py-1.5 text-[13px] font-bold text-accent-700 hover:bg-accent-100">
          <Icon name="sparkles" size={14} /> Ask Seedwel AI
        </Link>
      </nav>

      {/* Mobile menu */}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <div className="space-y-4 pb-2">
          {user && (
            <Link to="/account" className="flex items-center gap-3 rounded-2xl border border-ink-200 p-3 hover:bg-ink-50">
              <Avatar src={profile?.avatar_url} name={displayName(profile)} size={44} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{displayName(profile)}</span>
                <span className="block truncate text-xs text-ink-500">{profile?.email}</span>
              </span>
              <Icon name="chevronRight" size={18} className="ml-auto text-ink-400" />
            </Link>
          )}

          {canUseBusinessMode && (
            <button type="button" onClick={() => { setMenuOpen(false); toggle(); }}
              className="flex w-full items-center gap-3 rounded-2xl bg-brand-600 p-3 text-left text-white">
              <Icon name="store" size={22} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">
                  {mode === 'business' ? 'Switch to Shop mode' : 'Open My Business'}
                </span>
                <span className="block truncate text-xs text-white/80">
                  {businesses.length} business{businesses.length === 1 ? '' : 'es'} · {activeBusiness?.name ?? 'No active business'}
                </span>
              </span>
              <Icon name="arrowRight" size={18} />
            </button>
          )}

          <nav className="grid grid-cols-2 gap-2" aria-label="Marketplace">
            {PUBLIC_NAV.map((item) => (
              <MenuTile key={item.to} to={item.to} label={item.label} emoji={item.icon} />
            ))}
            {MORE_NAV.map((item) => (
              <MenuTile key={item.to} to={item.to} label={item.label} emoji={item.icon} />
            ))}
            <MenuTile to="/notifications" label="Notifications" emoji="🔔" />
            <MenuTile to="/help" label="Help centre" emoji="🆘" />
          </nav>

          {!user && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => { setMenuOpen(false); navigate('/auth/signin'); }}>Sign in</Button>
              <Button onClick={() => { setMenuOpen(false); navigate('/auth/signup'); }}>Create account</Button>
            </div>
          )}
        </div>
      </Sheet>

      {/* Mobile search sheet */}
      <Sheet open={searchOpen} onClose={() => setSearchOpen(false)} title="Search Seedwel Hub">
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3 pb-2">
          <SearchBar value={q} onChange={setQ} onSubmit={submit} autoFocus />
          <div className="flex flex-wrap gap-2">
            {['Black shoes under K500', 'Laptops in Lusaka', 'Maize meal 25kg', 'Plumber near me'].map((s) => (
              <button key={s} type="button" onClick={() => { setQ(s); submit(); }}
                className="sh-pill sh-pill-neutral hover:border-brand-300 hover:bg-brand-50">
                {s}
              </button>
            ))}
          </div>
          <Button block type="submit" icon="search">Search</Button>
        </form>
      </Sheet>
    </header>
  );
}

function MenuTile({ to, label, emoji }: { to: string; label: string; emoji: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 rounded-xl border border-ink-200 px-3 py-2.5 text-[13px] font-semibold text-ink-800 hover:border-brand-300 hover:bg-brand-50">
      <span aria-hidden="true" className="text-base">{emoji}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** Phone-first bottom navigation for shoppers. */
export function BottomNav() {
  const { count } = useCart();
  const location = useLocation();
  const { user } = useAuth();

  const items: { to: string; label: string; icon: IconName }[] = [
    { to: '/', label: 'Home', icon: 'home' },
    { to: '/search', label: 'Search', icon: 'search' },
    { to: '/cart', label: 'Cart', icon: 'cart' },
    { to: user ? '/orders' : '/auth/signin', label: 'Orders', icon: 'receipt' },
    { to: user ? '/account' : '/auth/signin', label: 'Account', icon: 'user' },
  ];

  return (
    <nav className="sh-bottomnav no-print" aria-label="Bottom">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {items.map((item) => {
          const active = item.to === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.to);
          return (
            <li key={item.to}>
              <Link to={item.to} data-active={active} className="sh-bottomnav-item relative w-full"
                aria-current={active ? 'page' : undefined}>
                <Icon name={item.icon} size={21} filled={active} />
                <span>{item.label}</span>
                {item.to === '/cart' && count > 0 && (
                  <span className="absolute right-[22%] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-400 px-1 text-[9px] font-extrabold text-ink-950">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Public site footer. */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-12 border-t border-ink-200 bg-white pb-24 lg:pb-8 no-print">
      <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Logo height={30} />
          <p className="mt-3 max-w-sm text-sm text-ink-600">{BRAND.hero}</p>
          <p className="mt-1 text-xs text-ink-500">{BRAND.companyLine}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/become-a-seller" className="sh-pill sh-pill-brand">🚀 Become a seller</Link>
            <Link to="/pricing" className="sh-pill sh-pill-neutral">💎 Pricing</Link>
            <Link to="/academy" className="sh-pill sh-pill-neutral">🎓 Business Academy</Link>
          </div>
        </div>

        <FooterCol title="Marketplace" links={[
          { to: '/products', label: 'All products' },
          { to: '/services', label: 'Services' },
          { to: '/businesses', label: 'Businesses' },
          { to: '/deals', label: 'Deals & flash sales' },
          { to: '/wholesale', label: 'Wholesale' },
          { to: '/nearby', label: 'Near me' },
          { to: '/categories', label: 'Categories' },
        ]} />
        <FooterCol title="For business" links={[
          { to: '/business-solutions', label: 'Business solutions' },
          { to: '/business/setup', label: 'Create your store' },
          { to: '/business/pos', label: 'Point of sale' },
          { to: '/business/inventory', label: 'Inventory' },
          { to: '/business/invoices', label: 'Invoicing' },
          { to: '/pricing', label: 'Plans & limits' },
        ]} />
        <FooterCol title="Support" links={[
          { to: '/help', label: 'Help centre' },
          { to: '/academy', label: 'Business Academy' },
          { to: '/contact', label: 'Contact us' },
          { to: '/about', label: 'About' },
          { to: '/legal/terms', label: 'Terms of use' },
          { to: '/legal/privacy', label: 'Privacy policy' },
        ]} />
      </div>

      <div className="border-t border-ink-200 px-4 py-5">
        <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-between gap-2 text-xs text-ink-500 sm:flex-row">
          <p>© {year} {BRAND.company}. All rights reserved.</p>
          <p className="flex items-center gap-3">
            <span>🇿🇲 Lusaka, Zambia</span>
            <span aria-hidden="true">·</span>
            <a href={`mailto:${BRAND.supportEmail}`} className="hover:text-brand-700">{BRAND.supportEmail}</a>
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { to: string; label: string }[] }) {
  return (
    <div>
      <h3 className="sh-label mb-3">{title}</h3>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="text-sm text-ink-600 hover:text-brand-700">{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
