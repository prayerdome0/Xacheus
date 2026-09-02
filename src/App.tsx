import { Component, Suspense, lazy, useState, type ErrorInfo, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';

import { ToastViewport } from '@/components/ui/Overlays';
import { BareShell, PublicShell } from '@/components/layout/PublicShell';
import { BusinessShell } from '@/components/layout/BusinessShell';
import { BrandSplash, BrandLoader } from '@/components/layout/BrandSplash';
import { NotFound, RedirectIfAuthed, RequireAuth, RequireBusiness } from '@/components/layout/Guards';
import { AuthProvider } from '@/context/AuthContext';
import { BusinessProvider } from '@/context/BusinessContext';
import { CartProvider } from '@/context/CartContext';
import { ModeProvider } from '@/context/ModeContext';
import { ToastProvider } from '@/context/ToastContext';
import { isFirebaseConfigured } from '@/lib/env';

/* ── Route modules ─────────────────────────────────────────────────────────── */
/* Every screen is lazy. A shopper on a phone in Lusaka should download the
   storefront and nothing else: the POS, the PDF writer (jsPDF + html2canvas),
   the charts and the account centre all arrive only when they are opened.
   `FirebaseGate` stays eager because it is what renders when nothing else can. */

import { FirebaseGate } from '@/routes/auth/AuthGate';

/** Route components take no props — everything comes from the URL, the session
 *  or a context — but React's `lazy` needs `ComponentType<any>`, so the cast is
 *  deliberate rather than loose typing. */
type RouteComponent = React.ComponentType<any>;

/** `lazy()` for a named export, so one module can still split into a chunk. */
const lazyNamed = (factory: () => Promise<Record<string, unknown>>, name: string) =>
  lazy(() => factory().then((m) => ({ default: m[name] as RouteComponent })));

const Landing = lazy(() => import('@/routes/public/Landing'));
const Search = lazy(() => import('@/routes/public/Search'));
const CategoryPage = lazyNamed(() => import('@/routes/public/Search'), 'CategoryPage');
const WholesalePage = lazyNamed(() => import('@/routes/public/Search'), 'WholesalePage');
const ProductDetail = lazy(() => import('@/routes/public/ProductDetail'));
const Store = lazy(() => import('@/routes/public/StorePage'));
const BusinessesPage = lazyNamed(() => import('@/routes/public/StorePage'), 'BusinessesPage');
const NearbyPage = lazyNamed(() => import('@/routes/public/StorePage'), 'NearbyPage');
const CartPage = lazy(() => import('@/routes/public/Cart'));
const CheckoutPage = lazyNamed(() => import('@/routes/public/Cart'), 'CheckoutPage');

const SignInPage = lazyNamed(() => import('@/routes/auth/AuthPages'), 'SignInPage');
const SignUpPage = lazyNamed(() => import('@/routes/auth/AuthPages'), 'SignUpPage');
const ConfirmEmailPage = lazyNamed(() => import('@/routes/auth/AuthPages'), 'ConfirmEmailPage');
const ForgotPasswordPage = lazyNamed(() => import('@/routes/auth/AuthPages'), 'ForgotPasswordPage');
const ResetPasswordPage = lazyNamed(() => import('@/routes/auth/AuthPages'), 'ResetPasswordPage');
const AuthCallbackPage = lazyNamed(() => import('@/routes/auth/AuthPages'), 'AuthCallbackPage');

const AccountLayout = lazy(() => import('@/routes/account/Account'));
const AccountOverview = lazyNamed(() => import('@/routes/account/Account'), 'AccountOverview');
const MyOrdersPage = lazyNamed(() => import('@/routes/account/Account'), 'MyOrdersPage');
const OrderDetailPage = lazyNamed(() => import('@/routes/account/Account'), 'OrderDetailPage');
const WishlistPage = lazyNamed(() => import('@/routes/account/Account'), 'WishlistPage');
const AddressesPage = lazyNamed(() => import('@/routes/account/Account'), 'AddressesPage');
const MyReviewsPage = lazyNamed(() => import('@/routes/account/Account'), 'MyReviewsPage');
const MyMessagesPage = lazyNamed(() => import('@/routes/account/Account'), 'MyMessagesPage');
const AccountSettingsPage = lazyNamed(() => import('@/routes/account/Account'), 'AccountSettingsPage');
const NotificationsPage = lazyNamed(() => import('@/routes/account/Account'), 'NotificationsPage');

const SharedDocumentPage = lazyNamed(() => import('@/routes/shared/SharedDoc'), 'SharedDocumentPage');
const PayPage = lazyNamed(() => import('@/routes/shared/SharedDoc'), 'PayPage');
const VerifyPage = lazyNamed(() => import('@/routes/shared/SharedDoc'), 'VerifyPage');

const BusinessSetupPage = lazyNamed(() => import('@/routes/business/Setup'), 'BusinessSetupPage');
const BecomeASellerPage = lazyNamed(() => import('@/routes/business/Setup'), 'BecomeASellerPage');
const BusinessDashboard = lazy(() => import('@/routes/business/Dashboard'));
const ProductsPage = lazyNamed(() => import('@/routes/business/Products'), 'ProductsPage');
const ProductEditorPage = lazyNamed(() => import('@/routes/business/Products'), 'ProductEditorPage');
const ProductDetailBusinessPage = lazyNamed(() => import('@/routes/business/Products'), 'ProductDetailBusinessPage');
const OrdersPage = lazy(() => import('@/routes/business/Orders'));
const BusinessOrderDetailPage = lazyNamed(() => import('@/routes/business/Orders'), 'OrderDetailPage');
const OrderReturnPage = lazyNamed(() => import('@/routes/business/Orders'), 'OrderReturnPage');
const QuotationsModule = lazy(() => import('@/routes/business/Quotations'));
const QuotationEditorPage = lazyNamed(() => import('@/routes/business/Quotations'), 'QuotationEditorPage');
const QuotationDetailPage = lazyNamed(() => import('@/routes/business/Quotations'), 'QuotationDetailPage');
const InvoicesModule = lazy(() => import('@/routes/business/Invoices'));
const InvoiceEditorPage = lazyNamed(() => import('@/routes/business/Invoices'), 'InvoiceEditorPage');
const InvoiceDetailPage = lazyNamed(() => import('@/routes/business/Invoices'), 'InvoiceDetailPage');
const ReceiptsModule = lazy(() => import('@/routes/business/Receipts'));
const ReceiptEditorPage = lazyNamed(() => import('@/routes/business/Receipts'), 'ReceiptEditorPage');
const PosPage = lazy(() => import('@/routes/business/Pos'));
const CustomerDisplayPage = lazyNamed(() => import('@/routes/business/Pos'), 'CustomerDisplayPage');

/* Scaffolded modules — one chunk for the whole placeholder set. */
const modules = () => import('@/routes/business/ComingSoon');
const ComingSoon = lazyNamed(modules, 'ComingSoon');
const AiModule = lazyNamed(modules, 'AiModule');
const AuditModule = lazyNamed(modules, 'AuditModule');
const BarcodesModule = lazyNamed(modules, 'BarcodesModule');
const BranchesModule = lazyNamed(modules, 'BranchesModule');
const CustomersModule = lazyNamed(modules, 'CustomersModule');
const DocumentsModule = lazyNamed(modules, 'DocumentsModule');
const ExpensesModule = lazyNamed(modules, 'ExpensesModule');
const FinanceModule = lazyNamed(modules, 'FinanceModule');
const GrowthModule = lazyNamed(modules, 'GrowthModule');
const ImportModule = lazyNamed(modules, 'ImportModule');
const InventoryModule = lazyNamed(modules, 'InventoryModule');
const MarketingModule = lazyNamed(modules, 'MarketingModule');
const MessagesModule = lazyNamed(modules, 'MessagesModule');
const MoreModule = lazyNamed(modules, 'MoreModule');
const PaymentLinksModule = lazyNamed(modules, 'PaymentLinksModule');
const PaymentsModule = lazyNamed(modules, 'PaymentsModule');
const ReportsModule = lazyNamed(modules, 'ReportsModule');
const ReturnsModule = lazyNamed(modules, 'ReturnsModule');
const ServicesModule = lazyNamed(modules, 'ServicesModule');
const SettingsModule = lazyNamed(modules, 'SettingsModule');
const StaffModule = lazyNamed(modules, 'StaffModule');
const StoreSettingsModule = lazyNamed(modules, 'StoreSettingsModule');
const SuppliersModule = lazyNamed(modules, 'SuppliersModule');

/* ── Error boundary ────────────────────────────────────────────────────────── */

interface BoundaryState { error: Error | null; info: string | null }

/**
 * A crashed screen must explain itself rather than leave a white page. The
 * component stack is shown because Seedwel Hub's failures are almost always
 * data-shaped (a column the migration has not added yet), and the message is
 * what makes that obvious.
 */
class RouteErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info: info.componentStack?.split('\n').slice(0, 6).join('\n') ?? null });
    // eslint-disable-next-line no-console
    console.error('[Seedwel Hub] route error', error, info.componentStack);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink-50 px-4 py-12">
        <div className="w-full max-w-xl space-y-4">
          <div className="sh-card-flat p-5">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">⚠️</span>
            <h1 className="mt-3 text-lg font-extrabold">This screen broke</h1>
            <p className="mt-1 text-sm text-ink-600">
              Nothing you entered was lost, but this page could not render. Reload it, and if it keeps happening the
              message below says which part failed.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-white/90">
              {error.message}
              {info ? `\n${info}` : ''}
            </pre>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => window.location.reload()}
                className="sh-btn-primary rounded-xl px-4 py-2 text-sm font-bold">
                Reload
              </button>
              <a href="/" className="sh-btn-outline rounded-xl px-4 py-2 text-sm font-bold">Go home</a>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

/* ── Small helpers ─────────────────────────────────────────────────────────── */

function PageFallback() {
  return <BrandLoader label="Loading…" />;
}

/** Routes that exist in the navigation but not yet in this build. */
function StubModule({ title, subtitle, icon, items }: {
  title: string; subtitle: string; icon?: string; items: string[];
}) {
  return <ComingSoon title={title} subtitle={subtitle} icon={icon} items={items} />;
}

/** `/share/:kind/:token` was the first naming we used; keep old links working. */
function LegacyShareRedirect() {
  const { kind, token } = useParams<{ kind: string; token: string }>();
  const type = kind === 'receipt' || kind === 'quotation' ? kind : 'invoice';
  return <Navigate to={`/d/${type}/${token ?? ''}`} replace />;
}

/* ── App ───────────────────────────────────────────────────────────────────── */

export default function App() {
  const location = useLocation();
  const [booted, setBooted] = useState(false);

  // Application-wide boot splash: particles converge into the wordmark, which
  // sharpens and glows before fading into the app. Plays once per hard load.
  if (!booted) {
    return (
      <BrandSplash
        onDone={() => setBooted(true)}
        label="Welcome to Seedwel Hub — Buy. Sell. Manage. Grow."
      />
    );
  }

  if (!isFirebaseConfigured) return <FirebaseGate />;

  return (
    <RouteErrorBoundary key={location.pathname}>
      <ToastProvider>
        <AuthProvider>
          <BusinessProvider>
            <ModeProvider>
              <CartProvider>
                <Suspense fallback={<PageFallback />}>
                  <Routes>
                    {/* ── Public storefront ─────────────────────────────── */}
                    <Route element={<PublicShell />}>
                      <Route index element={<Landing />} />
                      <Route path="search" element={<Search />} />
                      <Route path="categories" element={<CategoryPage />} />
                      <Route path="category/:slug" element={<CategoryPage />} />
                      <Route path="wholesale" element={<WholesalePage />} />
                      <Route path="product/:id" element={<ProductDetail />} />
                      <Route path="product/:id/:slug" element={<ProductDetail />} />
                      <Route path="store/:slug" element={<Store />} />
                      <Route path="stores" element={<BusinessesPage />} />
                      <Route path="businesses" element={<BusinessesPage />} />
                      <Route path="nearby" element={<NearbyPage />} />
                      <Route path="cart" element={<CartPage />} />
                      <Route path="notifications" element={<RequireAuth><NotificationsPage /></RequireAuth>} />
                      <Route path="*" element={<NotFound />} />
                    </Route>

                    {/* ── Full-bleed screens (no storefront chrome) ─────── */}
                    <Route element={<BareShell />}>
                      {/* Auth — signed-in users are bounced away. */}
                      <Route path="auth/signin" element={<RedirectIfAuthed><SignInPage /></RedirectIfAuthed>} />
                      <Route path="auth/signup" element={<RedirectIfAuthed><SignUpPage /></RedirectIfAuthed>} />
                      <Route path="auth/confirm" element={<ConfirmEmailPage />} />
                      <Route path="auth/forgot-password" element={<ForgotPasswordPage />} />
                      <Route path="auth/reset-password" element={<ResetPasswordPage />} />
                      <Route path="auth/callback" element={<AuthCallbackPage />} />
                      <Route path="signin" element={<Navigate to="/auth/signin" replace />} />
                      <Route path="login" element={<Navigate to="/auth/signin" replace />} />

                      {/* Checkout keeps the header but drops the bottom nav. */}
                      <Route path="checkout" element={<CheckoutPage />} />

                      {/* Links a seller sends on WhatsApp — no account needed. */}
                      <Route path="d/:kind/:token" element={<SharedDocumentPage />} />
                      <Route path="pay/:code" element={<PayPage />} />
                      <Route path="verify/:kind/:token" element={<VerifyPage />} />
                      <Route path="share/:kind/:token" element={<LegacyShareRedirect />} />

                      {/* Business onboarding runs before a business exists. */}
                      <Route path="business/setup" element={<RequireAuth><BusinessSetupPage /></RequireAuth>} />
                      <Route path="business/become-a-seller" element={<RequireAuth><BecomeASellerPage /></RequireAuth>} />
                      <Route path="sell" element={<Navigate to="/business/become-a-seller" replace />} />
                    </Route>

                    {/* ── Buyer account ─────────────────────────────────── */}
                    <Route path="account" element={<RequireAuth><PublicShell /></RequireAuth>}>
                      <Route element={<AccountLayout />}>
                        <Route index element={<AccountOverview />} />
                        <Route path="orders" element={<MyOrdersPage />} />
                        <Route path="orders/:id" element={<OrderDetailPage />} />
                        <Route path="wishlist" element={<WishlistPage />} />
                        <Route path="addresses" element={<AddressesPage />} />
                        <Route path="reviews" element={<MyReviewsPage />} />
                        <Route path="messages" element={<MyMessagesPage />} />
                        <Route path="settings" element={<AccountSettingsPage />} />
                        <Route path="notifications" element={<NotificationsPage />} />
                        <Route path="*" element={<NotFound title="That account page does not exist" />} />
                      </Route>
                    </Route>

                    {/* ── Business workspace ────────────────────────────── */}
                    <Route
                      path="pos-display"
                      element={
                        <RequireBusiness>
                          <BusinessShell><CustomerDisplayPage /></BusinessShell>
                        </RequireBusiness>
                      }
                    />

                    <Route path="business" element={<RequireBusiness><BusinessShell /></RequireBusiness>}>
                      <Route index element={<BusinessDashboard />} />

                      {/* Catalogue — built */}
                      <Route path="products" element={<ProductsPage />} />
                      <Route path="products/new" element={<ProductEditorPage />} />
                      <Route path="products/:id" element={<ProductEditorPage />} />
                      <Route path="products/:id/detail" element={<ProductDetailBusinessPage />} />

                      {/* Selling — built */}
                      <Route path="orders" element={<OrdersPage />} />
                      <Route path="orders/:id" element={<BusinessOrderDetailPage />} />
                      <Route path="orders/:id/return" element={<OrderReturnPage />} />
                      <Route path="pos" element={<PosPage />} />
                      <Route path="pos/display" element={<CustomerDisplayPage />} />

                      {/* Scaffolded: the database work is applied, the screens are not */}
                      <Route path="quotations" element={<QuotationsModule />} />
                      <Route path="quotations/new" element={<QuotationEditorPage />} />
                      <Route path="quotations/:id" element={<QuotationDetailPage />} />
                      <Route path="invoices" element={<InvoicesModule />} />
                      <Route path="invoices/new" element={<InvoiceEditorPage />} />
                      <Route path="invoices/:id" element={<InvoiceDetailPage />} />
                      <Route path="receipts" element={<ReceiptsModule />} />
                      <Route path="receipts/new" element={<ReceiptEditorPage />} />
                      <Route path="payments/*" element={<PaymentsModule />} />
                      <Route path="payment-links/*" element={<PaymentLinksModule />} />
                      <Route path="returns/*" element={<ReturnsModule />} />
                      <Route path="customers/*" element={<CustomersModule />} />
                      <Route path="inventory" element={<InventoryModule />} />
                      <Route path="inventory/*" element={<InventoryModule />} />
                      <Route path="warehouses" element={<BranchesModule />} />
                      <Route path="import" element={<ImportModule />} />
                      <Route path="barcodes" element={<BarcodesModule />} />
                      <Route path="suppliers/*" element={<SuppliersModule />} />
                      <Route path="purchases/*" element={<SuppliersModule />} />
                      <Route path="expenses/*" element={<ExpensesModule />} />
                      <Route path="finance" element={<FinanceModule />} />
                      <Route path="statements" element={<FinanceModule />} />
                      <Route path="taxes" element={<FinanceModule />} />
                      <Route path="reports/*" element={<ReportsModule />} />
                      <Route path="staff/*" element={<StaffModule />} />
                      <Route path="branches" element={<BranchesModule />} />
                      <Route path="settings/*" element={<SettingsModule />} />
                      <Route path="store" element={<StoreSettingsModule />} />
                      <Route path="services/*" element={<ServicesModule />} />
                      <Route path="categories" element={<StoreSettingsModule />} />
                      <Route path="marketing/*" element={<MarketingModule />} />
                      <Route path="messages/*" element={<MessagesModule />} />
                      <Route path="reviews" element={<MarketingModule />} />
                      <Route path="ai/*" element={<AiModule />} />
                      <Route path="automation" element={<AiModule />} />
                      <Route path="growth" element={<GrowthModule />} />
                      <Route path="documents/*" element={<DocumentsModule />} />
                      <Route path="delivery" element={<DocumentsModule />} />
                      <Route path="files" element={<DocumentsModule />} />
                      <Route path="audit" element={<AuditModule />} />
                      <Route path="notifications" element={<NotificationsModule />} />
                      <Route path="subscription" element={<SubscriptionModule />} />
                      <Route path="more" element={<MoreModule />} />
                      <Route path="*" element={<NotFound title="That module does not exist" message="Check the sidebar — the link may have moved." />} />
                    </Route>
                  </Routes>
                </Suspense>

                {/* ToastProvider only owns state; the viewport lives here so it
                    floats above every shell, including modals and the POS. */}
                <ToastViewport />
              </CartProvider>
            </ModeProvider>
          </BusinessProvider>
        </AuthProvider>
      </ToastProvider>
    </RouteErrorBoundary>
  );
}

/* ── Two small local modules that did not need their own file ──────────────── */

function NotificationsModule() {
  return (
    <StubModule
      title="Notifications"
      subtitle="Everything your business needs to see"
      icon="🔔"
      items={[
        'Orders, payments, low stock, overdue invoices and messages in one feed',
        'The bell in the header already shows these — this screen adds filters and bulk actions',
        'Priority and read state are stored per business and per user',
        'Push and email delivery preferences',
      ]}
    />
  );
}

function SubscriptionModule() {
  return (
    <StubModule
      title="Subscription"
      subtitle="Free, Starter, Business, Professional and Enterprise"
      icon="💎"
      items={[
        'All five plans and their limits are already seeded in the database',
        'Your business was created on the Free plan',
        'This screen adds plan comparison, upgrade, billing history and limits reporting',
      ]}
    />
  );
}
