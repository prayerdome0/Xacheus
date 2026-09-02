import { Outlet, useLocation } from 'react-router-dom';
import { SiteHeader, SiteFooter, BottomNav } from './SiteHeader';
import { useEffect } from 'react';

/**
 * Public/marketplace layout: sticky header, content, footer, and the phone
 * bottom nav. Screens that bring their own chrome (checkout, POS, the document
 * viewer) opt out via <Outlet context> or by living outside this shell.
 */
export function PublicShell() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);

  const hideFooterNav = pathname.startsWith('/checkout') || pathname.startsWith('/cart/checkout');

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="min-w-0 flex-1 px-3 pb-24 pt-4 sm:px-4 lg:px-6 lg:pb-10">
        <div className="mx-auto w-full max-w-[1400px]">
          <Outlet />
        </div>
      </main>
      <SiteFooter />
      {!hideFooterNav && <BottomNav />}
    </div>
  );
}

/** Full-bleed layout for shared documents, payment pages and auth. */
export function BareShell() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [pathname]);
  return (
    <div className="min-h-dvh bg-ink-50">
      <Outlet />
    </div>
  );
}
