import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Badge, Button, Notice } from '@/components/ui/Primitives';
import { Avatar, BusinessAvatar, ProductCard, ProductGrid, Rating, SearchBar } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { useToast } from '@/context/ToastContext';
import { useCategories } from '@/hooks/useCategories';
import { useQuery } from '@/hooks/useQuery';
import { supabase } from '@/lib/supabase';
import { searchBusinesses, type BusinessSearchRow } from '@/lib/api';
import { BRAND } from '@/lib/constants';
import { formatMoney, toNum } from '@/lib/currency';
import { distanceLabel, openingStatus } from '@/lib/format';
import { useGeolocation } from '@/hooks/useUi';
import { isFirebaseConfigured, isSupabaseConfigured } from '@/lib/env';
import type { Deal, Product, UUID } from '@/types';

/**
 * Public homepage.
 *
 * Everything rendered here is read from the database: featured deals, live
 * product rows, real store profiles and actual category counts. When the schema
 * has not been applied yet we say so instead of showing invented listings.
 */
export default function LandingPage() {
  const { user, profile } = useAuth();
  const { add } = useCart();
  const { success: toast } = useToast();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { categories, topLevel, loading: catLoading } = useCategories('both');
  const geo = useGeolocation(false);

  const featured = useQuery<Product>(
    () => supabase
      .from('products')
      .select('*, business:businesses(id,name,slug,logo_url,city,country_code,verification_status,rating_avg,badges), category:categories(id,name,slug,path,icon)')
      .eq('is_published', true).eq('is_featured', true).is('deleted_at', null)
      .order('sold_count', { ascending: false })
      .limit(10),
    [],
  );

  const newest = useQuery<Product>(
    () => supabase
      .from('products')
      .select('*, business:businesses(id,name,slug,logo_url,city,country_code,verification_status,rating_avg,badges), category:categories(id,name,slug,path,icon)')
      .eq('is_published', true).is('deleted_at', null)
      .order('published_at', { ascending: false })
      .limit(10),
    [],
  );

  const deals = useQuery<Deal & { product?: Product }>(
    () => supabase
      .from('deals')
      .select('*, product:products(id,name,slug,price,compare_at_price,currency,primary_image_url,stock,rating_avg,rating_count,business_id)')
      .eq('is_active', true)
      .lte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: false })
      .limit(6),
    [],
  );

  // Top stores come from the search RPC (it exposes ratings, badges and counts).
  const [storeRows, setStoreRows] = useState<BusinessSearchRow[]>([]);
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    searchBusinesses({ sort: 'rating', limit: 6, verified_only: false })
      .then((res) => setStoreRows(res.items))
      .catch(() => setStoreRows([]));
  }, []);

  const suggestions = useMemo(() => {
    const list = ['Black shoes under K500', 'Laptops in Lusaka', 'Maize meal 25kg', 'Plumber near me', 'Phones under K2000'];
    return list;
  }, []);

  const addToCart = async (p: Product) => {
    await add(p);
    toast('Added to cart', `${p.name} is in your basket.`);
  };

  return (
    <div className="space-y-10">
      {!isFirebaseConfigured ? (
        <Notice tone="warning" title="Seedwel Hub is waiting for its Firebase project" icon="warning">
          Add your Firebase web config to <code className="rounded bg-white/70 px-1 font-mono text-[11px]">.env</code> and
          deploy <code className="rounded bg-white/70 px-1 font-mono text-[11px]">firebase/firestore.rules</code>. Auth and profiles are live on
          Firebase; marketplace, orders and documents move over in the next phases. Nothing here is simulated.
        </Notice>
      ) : !isSupabaseConfigured ? (
        <Notice tone="info" title="Phase 1 is live — marketplace data is migrating next" icon="sparkles">
          Firebase Authentication and user profiles are connected. Business, products, orders and documents are
          moving to Cloud Firestore in the next phases; until then their sections use the legacy data layer and
          will show a clear setup/migration message instead of fake records.
        </Notice>
      ) : null}

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="sh-gradient-brand overflow-hidden rounded-3xl px-5 py-8 text-white sm:px-8 sm:py-12">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-accent-200">
            <Icon name="sparkles" size={13} /> {BRAND.tagline}
          </span>
          <h1 className="mt-4 text-2xl font-extrabold leading-tight text-white sm:text-4xl">
            {BRAND.hero}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/75 sm:text-base">
            {BRAND.subHero}
          </p>

          <form
            className="mx-auto mt-6 flex max-w-xl items-center gap-2 rounded-2xl bg-white p-1.5 shadow-pop"
            onSubmit={(e) => { e.preventDefault(); navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search'); }}
          >
            <div className="flex-1 [&_.sh-input]:border-0 [&_.sh-input]:bg-transparent [&_.sh-input]:focus:ring-0">
              <SearchBar value={q} onChange={setQ} onSubmit={() => navigate(`/search?q=${encodeURIComponent(q.trim())}`)} />
            </div>
            <Button type="submit" icon="search" className="hidden sm:inline-flex">Search</Button>
            <Button type="submit" size="icon" icon="search" className="sm:hidden" aria-label="Search" />
          </form>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
            <span className="text-[11px] font-semibold text-white/60">Try:</span>
            {suggestions.map((s) => (
              <button key={s} type="button"
                onClick={() => navigate(`/search?q=${encodeURIComponent(s)}`)}
                className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/20">
                {s}
              </button>
            ))}
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
            {!user ? (
              <>
                <Link to="/auth/signup?intent=sell">
                  <Button variant="accent" size="lg" icon="store">Start selling free</Button>
                </Link>
                <Link to="/auth/signin">
                  <Button size="lg" className="bg-white/10 text-white hover:bg-white/20">Sign in</Button>
                </Link>
              </>
            ) : (
              <>
                <Link to="/business/setup">
                  <Button variant="accent" size="lg" icon="store">Open my business</Button>
                </Link>
                <Link to="/account">
                  <Button size="lg" className="bg-white/10 text-white hover:bg-white/20">
                    Hi, {profile?.display_name ?? profile?.full_name ?? 'there'}
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Value strip ─────────────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ValueTile icon="store" title="Your store in 2 minutes"
          text={`A live storefront at ${BRAND.domain}/store/your-name — no website skills needed.`} />
        <ValueTile icon="invoice" title="Quote → invoice → receipt"
          text="Send on WhatsApp, get it signed, convert to an invoice in one tap." />
        <ValueTile icon="box" title="Stock that stays correct"
          text="Multiple warehouses, CSV auto-sync, low-stock alerts and stocktakes." />
        <ValueTile icon="robot" title="AI that asks first"
          text="Seedwel AI drafts work for you, but money and deletions always need your approval." />
      </section>

      {/* ── Categories ──────────────────────────────────────────────────── */}
      <section>
        <SectionHead title="Shop by category" subtitle="Everything from fresh produce to professional services"
          action={<Link to="/categories"><Button variant="ghost" size="sm" iconRight="chevronRight">All categories</Button></Link>} />

        {catLoading ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => <div key={i} className="sh-skeleton h-20 rounded-2xl" />)}
          </div>
        ) : topLevel.length === 0 ? (
          <Notice tone="info" title="No categories yet" icon="info">
            Categories are seeded by <code className="rounded bg-white/70 px-1 font-mono text-[11px]">0011_seed.sql</code>.
            Run it to populate the marketplace taxonomy.
          </Notice>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {topLevel.slice(0, 18).map((c) => {
              const count = categories.filter((x) => x.parent_id === c.id).length;
              return (
                <Link key={c.id} to={`/category/${c.slug}`}
                  className="sh-card-flat flex flex-col items-center gap-1.5 p-3 text-center transition-shadow hover:shadow-card">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-xl" aria-hidden="true">
                    {c.icon ?? '📦'}
                  </span>
                  <span className="line-clamp-2 text-[12px] font-bold leading-tight text-ink-800">{c.name}</span>
                  {count > 0 && <span className="text-[10px] text-ink-400">{count} subcategories</span>}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Deals ───────────────────────────────────────────────────────── */}
      {deals.data.length > 0 && (
        <section>
          <SectionHead title="🔥 Deals & flash sales" subtitle="Limited-time prices from verified sellers"
            action={<Link to="/deals"><Button variant="ghost" size="sm" iconRight="chevronRight">See all deals</Button></Link>} />
          <ProductGrid cols={3}>
            {deals.data.map((d) => d.product && (
              <ProductCard key={d.id} product={d.product as Product} onAddToCart={(p) => void addToCart(p)}
                badge={<Badge tone="accent">{d.deal_type === 'flash' ? 'Flash sale' : 'Deal'}</Badge>} />
            ))}
          </ProductGrid>
        </section>
      )}

      {/* ── Featured products ───────────────────────────────────────────── */}
      <section>
        <SectionHead title="Featured products" subtitle="Hand-picked by sellers across the marketplace"
          action={<Link to="/products"><Button variant="ghost" size="sm" iconRight="chevronRight">Browse all</Button></Link>} />
        {featured.loading ? <GridSkeleton /> : featured.error ? <QueryError message={featured.error} onRetry={featured.refresh} />
          : featured.data.length === 0 ? <NoProducts yet />
          : (
            <ProductGrid cols={4}>
              {featured.data.map((p) => <ProductCard key={p.id} product={p} onAddToCart={(x) => void addToCart(x)} />)}
            </ProductGrid>
          )}
      </section>

      {/* ── Stores ──────────────────────────────────────────────────────── */}
      <section>
        <SectionHead title="Popular stores" subtitle="Real businesses selling on Seedwel Hub right now"
          action={<Link to="/businesses"><Button variant="ghost" size="sm" iconRight="chevronRight">All businesses</Button></Link>} />

        {storeRows.length === 0 ? (
          <NoStores />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {storeRows.map((b) => {
              const open = openingStatus(b.opening_hours);
              return (
                <Link key={b.id} to={`/store/${b.slug}`} className="sh-card-flat flex gap-3 p-3.5 transition-shadow hover:shadow-card">
                  <BusinessAvatar business={b} size={52} />
                  <div className="min-w-0 flex-1">
                    <h3 className="flex items-center gap-1.5 truncate text-sm font-bold text-ink-900">
                      {b.name}
                      {b.verification_status === 'verified' && <Icon name="shield" size={13} className="shrink-0 text-sky-500" />}
                    </h3>
                    <p className="truncate text-xs text-ink-500">
                      {b.city ?? '—'}{b.category_name ? ` · ${b.category_name}` : ''}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Rating value={toNum(b.rating_avg)} count={b.rating_count} size="xs" />
                      <span className="text-[11px] text-ink-400">· {b.live_products ?? b.product_count ?? 0} products</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {open.open
                        ? <Badge tone="green" icon="clock">{open.text}</Badge>
                        : <Badge tone="neutral">{open.text}</Badge>}
                      {b.delivery_enabled && <Badge tone="blue" icon="truck">Delivery</Badge>}
                      {b.accepts_wholesale && <Badge tone="accent" icon="box">Wholesale</Badge>}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Nearby ──────────────────────────────────────────────────────── */}
      <section>
        <SectionHead title="Near you" subtitle="Find shops and service providers close to your location"
          action={
            <Button variant="outline" size="sm" icon="pin" loading={geo.loading} onClick={() => void geo.locate()}>
              {geo.granted ? 'Update location' : 'Use my location'}
            </Button>
          } />
        {geo.error && <Notice tone="warning">{geo.error}</Notice>}
        {geo.granted && geo.lat !== null && geo.lng !== null ? (
          <NearbyList lat={geo.lat} lng={geo.lng} />
        ) : (
          <div className="sh-card-flat p-5 text-center">
            <p className="text-sm text-ink-600">
              Allow location access to see businesses, products and services sorted by distance — or browse by city instead.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {['Lusaka', 'Ndola', 'Kitwe', 'Livingstone', 'Kabwe'].map((city) => (
                <Link key={city} to={`/search?city=${encodeURIComponent(city)}`}>
                  <Button variant="outline" size="sm">{city}</Button>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Newest ──────────────────────────────────────────────────────── */}
      <section>
        <SectionHead title="Just listed" subtitle="Fresh stock from sellers this week"
          action={<Link to="/products?sort=newest"><Button variant="ghost" size="sm" iconRight="chevronRight">See newest</Button></Link>} />
        {newest.loading ? <GridSkeleton /> : newest.error ? <QueryError message={newest.error} onRetry={newest.refresh} />
          : newest.data.length === 0 ? <NoProducts />
          : (
            <ProductGrid cols={4}>
              {newest.data.map((p) => <ProductCard key={p.id} product={p} onAddToCart={(x) => void addToCart(x)} />)}
            </ProductGrid>
          )}
      </section>

      {/* ── Sell with us ────────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-3xl border border-ink-200 bg-white">
        <div className="grid lg:grid-cols-2">
          <div className="p-6 sm:p-9">
            <Badge tone="brand" icon="store">For business owners</Badge>
            <h2 className="mt-3 text-xl font-extrabold sm:text-2xl">
              Turn your shop into a system
            </h2>
            <p className="mt-2 text-sm text-ink-600">
              Seedwel Hub is not only a marketplace — it is the back office behind it. Sell in person with the POS,
              quote and invoice from your phone, keep stock honest across branches, and let the AI assistant handle the
              paperwork you would otherwise do at night.
            </p>
            <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {[
                ['🧮', 'Point of sale with barcode scanning'],
                ['🧾', 'Quotations, invoices, receipts, statements'],
                ['📦', 'Multi-warehouse stock & CSV sync'],
                ['👥', 'Customers, suppliers & purchase orders'],
                ['💸', 'Expenses with staff approval limits'],
                ['📈', 'Reports, profit & a monthly AI summary'],
                ['👨‍💼', 'Staff roles — a cashier cannot see expenses'],
                ['🔗', 'Payment links paid by mobile money or card'],
              ].map(([emoji, text]) => (
                <li key={text} className="flex items-start gap-2 text-[13px] text-ink-700">
                  <span aria-hidden="true">{emoji}</span><span>{text}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link to="/become-a-seller"><Button size="lg" icon="store">Create your store</Button></Link>
              <Link to="/pricing"><Button size="lg" variant="outline" icon="tag">See plans & pricing</Button></Link>
            </div>
          </div>
          <div className="sh-gradient-brand flex items-center justify-center p-6 sm:p-9">
            <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-pop">
              <p className="sh-label">Today at your shop</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <MiniStat label="Sales" value="K 4,820.00" tone="text-emerald-600" />
                <MiniStat label="Orders" value="31" />
                <MiniStat label="Stock alerts" value="4" tone="text-amber-600" />
                <MiniStat label="Unpaid invoices" value="K 1,250.00" tone="text-red-600" />
              </div>
              <p className="mt-3 rounded-xl bg-ink-50 p-2.5 text-[11px] leading-relaxed text-ink-500">
                Illustrative layout — your dashboard shows your own live figures from the database, in your currency.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust ───────────────────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-3">
        <TrustTile icon="shield" title="Verified businesses"
          text="Registration and tax details are checked before the Verified badge is issued." />
        <TrustTile icon="lock" title="Your data is protected"
          text="Row-level security, optional 2FA and a full audit trail of who changed what." />
        <TrustTile icon="wallet" title="Pay your way"
          text="Cash, bank transfer, card and mobile money — every payment links to a receipt." />
      </section>
    </div>
  );
}

/* ── Small pieces ──────────────────────────────────────────────────────────── */

function SectionHead({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-lg font-extrabold sm:text-xl">{title}</h2>
        {subtitle && <p className="text-xs text-ink-500 sm:text-sm">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function ValueTile({ icon, title, text }: { icon: 'store' | 'invoice' | 'box' | 'robot'; title: string; text: string }) {
  return (
    <div className="sh-card-flat flex gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-bold">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{text}</p>
      </div>
    </div>
  );
}

function TrustTile({ icon, title, text }: { icon: 'shield' | 'lock' | 'wallet'; title: string; text: string }) {
  return (
    <div className="sh-card-flat flex gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700">
        <Icon name={icon} size={19} />
      </span>
      <div>
        <h3 className="text-sm font-bold">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{text}</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone = 'text-ink-950' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-ink-200 p-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`mt-0.5 text-sm font-extrabold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="sh-card-flat overflow-hidden">
          <div className="sh-skeleton aspect-square rounded-none" />
          <div className="space-y-2 p-3">
            <div className="sh-skeleton h-3.5 w-4/5" />
            <div className="sh-skeleton h-3 w-3/5" />
            <div className="sh-skeleton h-4 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function QueryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/60 p-5">
      <p className="text-sm font-bold text-red-800">Could not load listings</p>
      <p className="mt-1 text-sm text-red-700/90 break-words">{message}</p>
      <Button variant="outline" size="sm" icon="refresh" className="mt-3" onClick={onRetry}>Try again</Button>
    </div>
  );
}

function NoProducts({ yet = false }: { yet?: boolean }) {
  return (
    <div className="sh-card-flat p-6 text-center">
      <p className="text-4xl" aria-hidden="true">🛍️</p>
      <h3 className="mt-2 text-base font-bold">{yet ? 'No featured products yet' : 'No products published yet'}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
        As soon as a seller publishes stock it appears here in real time. Be the first —
        creating a store takes about two minutes.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link to="/become-a-seller"><Button size="sm" icon="store">Start selling</Button></Link>
        <Link to="/help"><Button size="sm" variant="outline" icon="book">How it works</Button></Link>
      </div>
    </div>
  );
}

function NoStores() {
  return (
    <div className="sh-card-flat p-6 text-center">
      <p className="text-4xl" aria-hidden="true">🏪</p>
      <h3 className="mt-2 text-base font-bold">No public stores yet</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
        Stores appear here once businesses publish them. Claim yours and get a free storefront at
        seedwelhub.com/store/your-name.
      </p>
      <Link to="/business/setup" className="mt-4 inline-block"><Button size="sm" icon="store">Create your store</Button></Link>
    </div>
  );
}

function NearbyList({ lat, lng }: { lat: number; lng: number }) {
  const [rows, setRows] = useState<BusinessSearchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    searchBusinesses({ near_lat: lat, near_lng: lng, radius_km: 50, sort: 'relevance', limit: 8 })
      .then((r) => { if (alive) { setRows(r.items); setLoading(false); } })
      .catch((e: Error) => { if (alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [lat, lng]);

  if (loading) return <GridSkeleton />;
  if (error) return <QueryError message={error} onRetry={() => window.location.reload()} />;
  if (rows.length === 0) {
    return (
      <div className="sh-card-flat p-6 text-center">
        <h3 className="text-base font-bold">No businesses within 50 km</h3>
        <p className="mt-1 text-sm text-ink-500">
          Try a bigger radius, or browse the whole marketplace — sellers ship countrywide.
        </p>
        <Link to="/businesses" className="mt-3 inline-block"><Button size="sm" variant="outline">Browse all businesses</Button></Link>
      </div>
    );
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {rows.map((b) => (
        <li key={b.id}>
          <Link to={`/store/${b.slug}`} className="sh-card-flat flex items-center gap-3 p-3 hover:shadow-card">
            <BusinessAvatar business={b} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{b.name}</p>
              <p className="truncate text-xs text-ink-500">{b.city ?? '—'} · {b.category_name ?? 'Store'}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-bold text-brand-700">{distanceLabel(b.distance_km)}</p>
              <Rating value={toNum(b.rating_avg)} size="xs" showValue={false} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Trending searches — derived from real product rows, not a hard-coded list. */
export function TrendingRail({ onPick }: { onPick: (term: string) => void }) {
  const [terms, setTerms] = useState<{ term: string; hits: number }[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('products')
        .select('brand,name,view_count,sold_count')
        .eq('is_published', true).is('deleted_at', null)
        .order('view_count', { ascending: false })
        .limit(60);
      if (!alive) return;
      const counts = new Map<string, number>();
      (data ?? []).forEach((r: { brand?: string | null; name?: string; view_count?: number }) => {
        const key = (r.brand || (r.name ?? '').split(' ')[0] || '').trim();
        if (!key || key.length < 3) return;
        counts.set(key, (counts.get(key) ?? 0) + Number(r.view_count ?? 0));
      });
      setTerms(Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([term, hits]) => ({ term, hits })));
    })();
    return () => { alive = false; };
  }, []);

  if (terms.length === 0) return null;
  return (
    <div className="sh-rail">
      {terms.map((t) => (
        <button key={t.term} type="button" onClick={() => onPick(t.term)}
          className="sh-pill sh-pill-neutral hover:border-brand-300 hover:bg-brand-50">
          <Icon name="fire" size={11} /> {t.term}
        </button>
      ))}
    </div>
  );
}

/** Best-selling products for a store page or category page. */
export function useBestSellers(businessId: UUID | null, limit = 8) {
  return useQuery<Product>(
    () => {
      if (!businessId) return null;
      return supabase
        .from('products')
        .select('*, business:businesses(id,name,slug,logo_url,city,country_code,verification_status,rating_avg,badges)')
        .eq('business_id', businessId).eq('is_published', true).is('deleted_at', null)
        .order('sold_count', { ascending: false })
        .limit(limit);
    },
    [businessId, limit],
  );
}

export function priceLabel(p: Product): string {
  return formatMoney(p.price, p.currency);
}

export function AvatarRow({ items }: { items: { name: string; url?: string | null }[] }) {
  return (
    <div className="flex -space-x-2">
      {items.slice(0, 5).map((it, i) => (
        <Avatar key={i} src={it.url} name={it.name} size={28} ring />
      ))}
    </div>
  );
}
