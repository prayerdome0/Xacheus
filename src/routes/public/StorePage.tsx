import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Badge, Button, EmptyState, Input, Notice, Select, Textarea } from '@/components/ui/Primitives';
import {
  BusinessAvatar, Modal, ProductCard, ProductGrid, Rating, SkeletonCard, Tabs,
} from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import { getStore, searchProducts, searchBusinesses, type BusinessSearchRow, type StorePayload } from '@/lib/api';
import { formatMoney, toNum } from '@/lib/currency';
import { formatDate, formatTime, relativeTime } from '@/lib/dates';
import { distanceLabel, openingStatus } from '@/lib/format';
import { whatsappUrl, mailtoUrl, absoluteUrl } from '@/lib/share';
import { BRAND, DAYS, DAY_LABELS } from '@/lib/constants';
import { useGeolocation } from '@/hooks/useUi';
import { useQuery } from '@/hooks/useQuery';
import type { Business, Conversation, Product, Review, Store, UUID } from '@/types';

/**
 * Automatic online store: seedwelhub.com/store/<slug>
 *
 * Rendered from get_store() (store row + business + live stats) so a seller's
 * custom colours, cover image, opening hours and delivery settings drive the
 * page without any code change.
 */
export default function StorePage() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { add } = useCart();
  const { success } = useToast();

  const [payload, setPayload] = useState<StorePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(params.get('tab') ?? 'products');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'popular' | 'newest' | 'price_asc' | 'price_desc' | 'name'>('popular');
  const [products, setProducts] = useState<Product[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [productLoading, setProductLoading] = useState(true);
  const [contactOpen, setContactOpen] = useState(false);
  const geo = useGeolocation(false);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getStore(slug);
      if (!res?.found) { setPayload(null); return; }
      setPayload(res);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Could not load this store.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const business = payload?.business ?? null;
  const store = payload?.store as Store | undefined;
  const stats = payload?.stats;

  const loadProducts = useCallback(async () => {
    if (!business) return;
    setProductLoading(true);
    try {
      const res = await searchProducts({
        business_id: business.id, q: q || undefined, sort, limit: 48,
      });
      setProducts(res.items);
      setProductTotal(res.total);
    } catch {
      setProducts([]);
      setProductTotal(0);
    } finally {
      setProductLoading(false);
    }
  }, [business, q, sort]);

  useEffect(() => { void loadProducts(); }, [loadProducts]);

  const theme = useMemo(() => ({
    primary: business?.primary_color ?? '#0f766e',
    accent: business?.accent_color ?? '#f59e0b',
  }), [business]);

  const reviews = useQuery<Review & { profile?: { avatar_url?: string | null } }>(
    () => business
      ? supabase.from('reviews')
          .select('*, profile:profiles(id,avatar_url,display_name,full_name)')
          .eq('business_id', business.id).eq('status', 'published')
          .order('created_at', { ascending: false }).limit(20)
      : null,
    [business?.id],
  );

  const services = useQuery<{ id: UUID; name: string; description: string | null; price: number; currency: string; duration_minutes: number | null; is_published: boolean }>(
    () => business
      ? supabase.from('services')
          .select('id,name,description,price,currency,duration_minutes,is_published')
          .eq('business_id', business.id).eq('is_published', true)
          .order('created_at', { ascending: false }).limit(24)
      : null,
    [business?.id],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="sh-skeleton h-40 w-full rounded-3xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg py-8">
        <Notice tone="danger" title="Could not open this store" action={
          <Button size="sm" variant="outline" icon="refresh" onClick={() => void load()}>Try again</Button>
        }>{error}</Notice>
      </div>
    );
  }

  if (!payload?.found || !business) {
    return (
      <div className="mx-auto max-w-lg py-8">
        <EmptyState
          icon="store"
          title="This store is not available"
          description={`No published store exists at ${BRAND.domain}/store/${slug}. It may be private, renamed or closed.`}
          action={
            <>
              <Link to="/businesses"><Button size="sm" icon="building">Browse all businesses</Button></Link>
              <Link to="/business/setup"><Button size="sm" variant="outline" icon="store">Claim this name</Button></Link>
            </>
          }
        />
      </div>
    );
  }

  const open = openingStatus(business.opening_hours);
  const currency = business.base_currency ?? 'ZMW';

  return (
    <div className="space-y-5">
      {/* Cover */}
      <section className="overflow-hidden rounded-3xl border border-ink-200 bg-white">
        <div className="relative h-36 sm:h-52" style={{ backgroundColor: theme.primary }}>
          {business.cover_url ? (
            <img src={business.cover_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full opacity-90"
              style={{ backgroundImage: `linear-gradient(135deg, ${theme.primary} 0%, ${theme.accent} 140%)` }} />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950/70 via-ink-950/10 to-transparent" />

          <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-4">
            <div className="flex items-end gap-3">
              <BusinessAvatar business={business} size={68} />
              <div className="pb-1">
                <h1 className="flex flex-wrap items-center gap-2 text-lg font-extrabold text-white sm:text-2xl">
                  {business.name}
                  {business.verification_status === 'verified' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      <Icon name="check" size={11} /> Verified
                    </span>
                  )}
                </h1>
                <p className="truncate text-xs text-white/80 sm:text-sm">
                  {business.tagline ?? BRAND.tagline}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pb-1">
              {business.whatsapp && (
                <a href={whatsappUrl(business.whatsapp, `Hello ${business.name}, I found you on ${BRAND.name}.`)}
                  target="_blank" rel="noreferrer"
                  className="sh-btn sh-btn-sm bg-emerald-500 text-white hover:bg-emerald-600">
                  <Icon name="whatsapp" size={15} /> WhatsApp
                </a>
              )}
              <Button size="sm" variant="accent" icon="mail" onClick={() => setContactOpen(true)}>Contact</Button>
              <Button size="sm" className="bg-white/15 text-white hover:bg-white/25" icon="share"
                onClick={async () => {
                  const url = absoluteUrl(`/store/${business.slug}`);
                  if (navigator.share) {
                    try { await navigator.share({ title: business.name ?? '', url }); return; } catch { /* cancelled */ }
                  }
                  await navigator.clipboard.writeText(url);
                  success('Store link copied', url);
                }}>
                Share
              </Button>
            </div>
          </div>
        </div>

        {/* Facts */}
        <div className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact icon="star" label="Rating"
            value={<Rating value={toNum(business.rating_avg)} count={business.rating_count} />} />
          <Fact icon="clock" label="Open now"
            value={<span className={`text-[13px] font-bold ${open.open ? 'text-emerald-600' : 'text-ink-500'}`}>{open.text}</span>} />
          <Fact icon="pin" label="Location"
            value={<span className="text-[13px] font-semibold text-ink-800">
              {[business.address_line1, business.city, business.region].filter(Boolean).join(', ') || '—'}
            </span>} />
          <Fact icon="box" label="Catalogue"
            value={<span className="text-[13px] font-semibold text-ink-800">
              {stats?.products ?? 0} products · {stats?.services ?? 0} services
            </span>} />
          {business.phone && (
            <Fact icon="phone" label="Phone"
              value={<a className="text-[13px] font-semibold text-brand-700 hover:underline" href={`tel:${business.phone}`}>
                {business.phone_country_code ?? ''} {business.phone}
              </a>} />
          )}
          {business.email && (
            <Fact icon="mail" label="Email"
              value={<a className="truncate text-[13px] font-semibold text-brand-700 hover:underline" href={mailtoUrl(business.email, `Enquiry about ${business.name}`, '')}>
                {business.email}
              </a>} />
          )}
          {business.website && (
            <Fact icon="globe" label="Website"
              value={<a className="truncate text-[13px] font-semibold text-brand-700 hover:underline"
                href={business.website} target="_blank" rel="noreferrer">{business.website.replace(/^https?:\/\//, '')}</a>} />
          )}
          <Fact icon="truck" label="Fulfilment"
            value={<span className="flex flex-wrap gap-1">
              {business.delivery_enabled && <Badge tone="blue">Delivery</Badge>}
              {business.accepts_orders && <Badge tone="green">Online orders</Badge>}
              {business.accepts_wholesale && <Badge tone="accent">Wholesale</Badge>}
              {!business.delivery_enabled && !business.accepts_orders && <Badge tone="neutral">Collection</Badge>}
            </span>} />
        </div>

        {(business.badges?.length ?? 0) > 0 && (
          <div className="sh-rail border-t border-ink-100 px-4 py-2.5">
            {business.badges!.map((b) => <Badge key={b} tone="accent" icon="star">{b.replace(/_/g, ' ')}</Badge>)}
          </div>
        )}
      </section>

      <Tabs
        tabs={[
          { key: 'products', label: 'Products', badge: stats?.products ?? productTotal },
          { key: 'services', label: 'Services', badge: stats?.services ?? services.data.length },
          { key: 'about', label: 'About' },
          { key: 'reviews', label: 'Reviews', badge: stats?.reviews ?? reviews.data.length },
        ]}
        active={tab}
        onChange={(k) => { setTab(k); const p = new URLSearchParams(params); p.set('tab', k); }}
      />

      {tab === 'products' && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[12rem] flex-1">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${business.name}…`} />
            </div>
            <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-auto"
              options={[
                { value: 'popular', label: 'Best selling' },
                { value: 'newest', label: 'Newest' },
                { value: 'price_asc', label: 'Price: low to high' },
                { value: 'price_desc', label: 'Price: high to low' },
                { value: 'name', label: 'Name A–Z' },
              ]} />
            <span className="text-xs font-semibold text-ink-500">
              {productLoading ? 'Loading…' : `${productTotal} item${productTotal === 1 ? '' : 's'}`}
            </span>
          </div>

          {productLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : products.length === 0 ? (
            <EmptyState icon="box" title={q ? `Nothing matches “${q}”` : 'This store has no published products yet'}
              description={q ? 'Try a shorter search term.' : 'Check back soon — the seller is still setting up their catalogue.'}
              action={q ? <Button variant="outline" size="sm" icon="close" onClick={() => setQ('')}>Clear search</Button> : undefined} />
          ) : (
            <ProductGrid cols={4}>
              {products.map((p) => (
                <ProductCard key={p.id} product={{ ...p, business }}
                  onAddToCart={async (prod) => { await add(prod); success('Added to cart', prod.name); }} />
              ))}
            </ProductGrid>
          )}
        </section>
      )}

      {tab === 'services' && (
        <section>
          {services.data.length === 0 ? (
            <EmptyState icon="briefcase" title="No services listed"
              description="This business currently sells products only." />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {services.data.map((s) => (
                <li key={s.id} className="sh-card-flat flex items-start gap-3 p-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700">
                    <Icon name="briefcase" size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold">{s.name}</h3>
                    {s.description && <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{s.description}</p>}
                    <p className="sh-money mt-1.5 text-sm font-extrabold">{formatMoney(s.price, s.currency ?? currency)}</p>
                    {s.duration_minutes ? (
                      <p className="text-[11px] text-ink-500">Typically {s.duration_minutes} minutes</p>
                    ) : null}
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" icon="quote"
                        onClick={() => navigate(`/business/quotations/new?service=${s.id}`)}>Request a quote</Button>
                      {business.whatsapp && (
                        <a className="sh-btn sh-btn-sm sh-btn-outline" target="_blank" rel="noreferrer"
                          href={whatsappUrl(business.whatsapp, `Hi ${business.name}, I would like to book "${s.name}".`)}>
                          <Icon name="whatsapp" size={14} /> Book
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'about' && (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="sh-card-flat space-y-4 p-4">
            <div>
              <h2 className="text-sm font-extrabold">About {business.name}</h2>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink-700">
                {business.description ?? 'This business has not written a description yet.'}
              </p>
            </div>

            <dl className="grid gap-x-6 gap-y-3 border-t border-ink-100 pt-4 text-sm sm:grid-cols-2">
              {business.legal_name && <Info label="Legal name" value={business.legal_name} />}
              {business.business_type && <Info label="Business type" value={business.business_type.replace(/_/g, ' ')} />}
              {business.registration_number && <Info label="Registration number" value={business.registration_number} />}
              {business.tax_registered && <Info label="Tax number" value={business.tax_number ?? 'Registered'} />}
              {payload.category && <Info label="Category" value={payload.category.name} />}
              <Info label="On Seedwel Hub since" value={formatDate(business.joined_at ?? business.created_at)} />
              <Info label="Store address" value={`${BRAND.domain}/store/${business.slug}`} />
              {business.custom_domain && <Info label="Custom domain" value={business.custom_domain} />}
            </dl>
          </div>

          <div className="space-y-4">
            <div className="sh-card-flat p-4">
              <h3 className="text-sm font-extrabold">Opening hours</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {DAYS.map((d) => {
                  const h = business.opening_hours?.[d];
                  const today = new Date().toLocaleDateString('en-GB', { weekday: 'short' }).toLowerCase() === d;
                  return (
                    <li key={d} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${today ? 'bg-brand-50 font-bold' : ''}`}>
                      <span className="text-ink-700">{DAY_LABELS[d]}</span>
                      <span className={h?.closed ? 'text-ink-400' : 'text-ink-800'}>
                        {h?.closed ? 'Closed' : h ? `${formatTime(`${new Date().toISOString().slice(0, 10)}T${h.open ?? '08:00'}:00`)} – ${formatTime(`${new Date().toISOString().slice(0, 10)}T${h.close ?? '17:00'}:00`)}` : '—'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="sh-card-flat p-4">
              <h3 className="text-sm font-extrabold">Find us</h3>
              <p className="mt-1 text-sm text-ink-600">
                {[business.address_line1, business.address_line2, business.city, business.region, business.postal_code]
                  .filter(Boolean).join(', ') || 'Address not published'}
              </p>
              {business.map_url && (
                <a href={business.map_url} target="_blank" rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-brand-700 hover:underline">
                  <Icon name="map" size={15} /> Open in maps
                </a>
              )}
              {business.location?.lat && business.location?.lng && (
                <div className="mt-3">
                  <Button variant="outline" size="sm" block icon="pin" loading={geo.loading}
                    onClick={() => void geo.locate()}>
                    Distance from me
                  </Button>
                  {geo.granted && geo.lat !== null && geo.lng !== null && (
                    <p className="mt-2 text-center text-sm font-bold text-brand-700">
                      {distanceLabel(haversineKm(geo.lat, geo.lng, business.location.lat!, business.location.lng!))}
                    </p>
                  )}
                </div>
              )}
            </div>

            {store?.theme && (
              <div className="sh-card-flat p-4">
                <h3 className="text-sm font-extrabold">Storefront</h3>
                <p className="mt-1 text-xs text-ink-500">
                  Theme <span className="font-semibold text-ink-700">{store.theme}</span> ·
                  colours chosen by the seller.
                </p>
                <div className="mt-2 flex gap-2">
                  <span className="h-7 w-7 rounded-lg border border-ink-200" style={{ background: theme.primary }} />
                  <span className="h-7 w-7 rounded-lg border border-ink-200" style={{ background: theme.accent }} />
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {tab === 'reviews' && (
        <section>
          {reviews.data.length === 0 ? (
            <EmptyState icon="star" title="No reviews yet"
              description="Buyers who order from this store can leave the first review." />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {reviews.data.map((r) => (
                <li key={r.id} className="sh-card-flat p-4">
                  <div className="flex items-start gap-2.5">
                    <BusinessAvatar business={{ name: r.reviewer_name, logo_url: r.profile?.avatar_url ?? null }} size={36} showVerified={false} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold">{r.reviewer_name ?? 'Seedwel buyer'}</p>
                      <Rating value={r.rating} size="xs" showValue={false} />
                    </div>
                    <span className="shrink-0 text-[11px] text-ink-400">{relativeTime(r.created_at)}</span>
                  </div>
                  {r.is_verified_purchase && <Badge tone="green" icon="check" className="mt-2">Verified purchase</Badge>}
                  {r.title && <p className="mt-2 text-sm font-bold">{r.title}</p>}
                  {r.body && <p className="mt-1 text-sm leading-relaxed text-ink-600">{r.body}</p>}
                  {r.seller_reply && (
                    <div className="mt-2.5 rounded-xl bg-ink-50 p-2.5 text-[13px]">
                      <p className="font-bold text-ink-700">Reply from {business.name}</p>
                      <p className="mt-0.5 text-ink-600">{r.seller_reply}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} business={business} />
    </div>
  );
}

function Fact({ icon, label, value }: { icon: 'star' | 'clock' | 'pin' | 'box' | 'phone' | 'mail' | 'globe' | 'truck'; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Icon name={icon} size={16} className="mt-0.5 shrink-0 text-brand-600" />
      <div className="min-w-0">
        <p className="sh-label">{label}</p>
        <div className="mt-0.5">{value}</div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="sh-label">{label}</dt>
      <dd className="mt-0.5 font-medium capitalize text-ink-800">{value}</dd>
    </div>
  );
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Contact / message the seller ──────────────────────────────────────────── */

function ContactModal({ open, onClose, business }: { open: boolean; onClose: () => void; business: Business }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!user) { onClose(); navigate('/auth/signin'); return; }
    if (!message.trim()) { toastError('Write a message first'); return; }
    setBusy(true);
    try {
      const { data: convo, error: cErr } = await supabase.from('conversations')
        .insert({
          business_id: business.id,
          participant_user_id: user.id,
          participant_name: user.user_metadata?.display_name
            ?? user.user_metadata?.full_name
            ?? user.email?.split('@')[0]
            ?? 'Seedwel shopper',
          participant_email: user.email,
          subject: subject.trim() || `Enquiry from ${BRAND.name}`,
          kind: 'marketplace',
          status: 'open',
          last_message_preview: message.trim().slice(0, 120),
        })
        .select('id')
        .single();
      if (cErr) throw cErr;
      const id = (convo as Conversation).id;
      const { error: mErr } = await supabase.from('messages').insert({
        conversation_id: id,
        sender_id: user.id,
        sender_type: 'user',
        sender_name: user.user_metadata?.display_name
          ?? user.user_metadata?.full_name
          ?? user.email?.split('@')[0]
          ?? 'Shopper',
        body: message.trim(),
        is_read: false,
      });
      if (mErr) throw mErr;
      success('Message sent', `${business.name} will see it in their inbox.`);
      setSubject(''); setMessage('');
      onClose();
    } catch (e) {
      toastError('Could not send', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Message ${business.name}`} size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={busy} icon="send" onClick={() => void send()}>Send message</Button>
        </>
      }>
      <div className="space-y-3">
        {!user && (
          <Notice tone="info" title="Sign in to message sellers">
            Messages are tied to your account so sellers can reply and you keep the history.
          </Notice>
        )}
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)}
          placeholder="Question about your products" />
        <Textarea label="Message" required rows={5} value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder="Hi, do you deliver to Kitwe? How long does it take?" />
        {business.whatsapp && (
          <a href={whatsappUrl(business.whatsapp, message || `Hello ${business.name}, I found you on ${BRAND.name}.`)}
            target="_blank" rel="noreferrer"
            className="sh-btn sh-btn-sm w-full bg-emerald-500 text-white hover:bg-emerald-600">
            <Icon name="whatsapp" size={15} /> Or message on WhatsApp
          </a>
        )}
      </div>
    </Modal>
  );
}

/* ── Business directory ────────────────────────────────────────────────────── */

export function BusinessesPage() {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<BusinessSearchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const geo = useGeolocation(false);

  const q = params.get('q') ?? '';
  const city = params.get('city') ?? '';
  const verified = params.get('verified') === '1';
  const sort = (params.get('sort') ?? 'rating') as 'relevance' | 'rating' | 'newest' | 'name';
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const near = params.get('near') === '1';

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => { if (v === null || v === '') next.delete(k); else next.set(k, v); });
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await searchBusinesses({
        q: q || undefined,
        city: city || undefined,
        verified_only: verified,
        sort,
        limit: 24,
        offset: (page - 1) * 24,
        near_lat: near && geo.lat !== null ? geo.lat : null,
        near_lng: near && geo.lng !== null ? geo.lng : null,
        radius_km: near ? 50 : null,
      });
      setRows(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load businesses.');
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, city, verified, sort, page, near, geo.lat, geo.lng]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="sh-card-flat space-y-3 p-4">
        <div>
          <h1 className="text-xl font-extrabold sm:text-2xl">Businesses on Seedwel Hub</h1>
          <p className="mt-1 text-sm text-ink-500">
            Real shops, wholesalers and service providers — each with their own storefront.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input value={q} onChange={(e) => setParam({ q: e.target.value || null })}
            placeholder="Search businesses, e.g. hardware, bakery, plumbing" />
          <Input value={city} onChange={(e) => setParam({ city: e.target.value || null })}
            placeholder="City" className="sm:w-40" />
          <Select value={sort} onChange={(e) => setParam({ sort: e.target.value })} className="sm:w-44"
            options={[
              { value: 'rating', label: 'Top rated' },
              { value: 'relevance', label: 'Most relevant' },
              { value: 'newest', label: 'Newest' },
              { value: 'name', label: 'Name A–Z' },
            ]} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setParam({ verified: verified ? null : '1' })}
            className={`sh-pill ${verified ? 'sh-pill-brand' : 'sh-pill-neutral hover:bg-ink-200'}`}>
            <Icon name="shield" size={12} /> Verified only
          </button>
          <button type="button"
            onClick={async () => { if (!geo.granted) await geo.locate(); setParam({ near: near ? null : '1' }); }}
            className={`sh-pill ${near ? 'sh-pill-brand' : 'sh-pill-neutral hover:bg-ink-200'}`}>
            <Icon name="pin" size={12} /> Near me
          </button>
          <span className="ml-auto text-xs font-semibold text-ink-500">
            {loading ? 'Loading…' : `${total.toLocaleString()} business${total === 1 ? '' : 'es'}`}
          </span>
        </div>
      </div>

      {error && <Notice tone="danger" title="Could not load businesses">{error}</Notice>}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="sh-skeleton h-28 rounded-2xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon="building" title="No businesses match"
          description="Try removing a filter, or be the first to open a store in this category."
          action={<Link to="/business/setup"><Button size="sm" icon="store">Create your store</Button></Link>} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((b) => (
            <li key={b.id}>
              <Link to={`/store/${b.slug}`} className="sh-card-flat flex h-full flex-col gap-3 p-4 hover:shadow-card">
                <div className="flex items-start gap-3">
                  <BusinessAvatar business={b} size={48} />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-bold">{b.name}</h2>
                    <p className="truncate text-xs text-ink-500">{b.tagline ?? b.category_name ?? 'Store'}</p>
                    <div className="mt-1"><Rating value={toNum(b.rating_avg)} count={b.rating_count} size="xs" /></div>
                  </div>
                </div>
                {b.description && <p className="line-clamp-2 text-xs text-ink-600">{b.description}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-1.5">
                  <Badge tone="neutral" icon="pin">{b.city ?? '—'}</Badge>
                  {b.distance_km ? <Badge tone="brand">{distanceLabel(b.distance_km)}</Badge> : null}
                  <Badge tone="neutral" icon="box">{b.live_products ?? 0} products</Badge>
                  {b.delivery_enabled && <Badge tone="blue" icon="truck">Delivery</Badge>}
                  {b.accepts_wholesale && <Badge tone="accent">Wholesale</Badge>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {total > 24 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" icon="chevronLeft" disabled={page <= 1}
            onClick={() => setParam({ page: String(page - 1) })}>Previous</Button>
          <span className="text-sm font-semibold text-ink-600">Page {page} of {Math.ceil(total / 24)}</span>
          <Button variant="outline" size="sm" iconRight="chevronRight" disabled={page >= Math.ceil(total / 24)}
            onClick={() => setParam({ page: String(page + 1) })}>Next</Button>
        </div>
      )}
    </div>
  );
}

/** "Near me" — location-first discovery of businesses and products. */
export function NearbyPage() {
  const geo = useGeolocation(true);
  const [businesses, setBusinesses] = useState<BusinessSearchRow[]>([]);
  const [radius, setRadius] = useState(25);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (geo.lat === null || geo.lng === null) return;
    let alive = true;
    setLoading(true);
    searchBusinesses({ near_lat: geo.lat, near_lng: geo.lng, radius_km: radius, limit: 40 })
      .then((r) => { if (alive) setBusinesses(r.items); })
      .catch(() => { if (alive) setBusinesses([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [geo.lat, geo.lng, radius]);

  return (
    <div className="space-y-4">
      <div className="sh-card-flat p-4">
        <h1 className="text-xl font-extrabold sm:text-2xl">Near you</h1>
        <p className="mt-1 text-sm text-ink-500">
          Shops, wholesalers and service providers sorted by distance from your current position.
        </p>

        {geo.error && <div className="mt-3"><Notice tone="warning">{geo.error}</Notice></div>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" icon="refresh" loading={geo.loading} onClick={() => void geo.locate()}>
            {geo.granted ? 'Update my location' : 'Use my location'}
          </Button>
          <Select value={String(radius)} onChange={(e) => setRadius(Number(e.target.value))} className="w-auto"
            options={[
              { value: '5', label: 'Within 5 km' },
              { value: '10', label: 'Within 10 km' },
              { value: '25', label: 'Within 25 km' },
              { value: '50', label: 'Within 50 km' },
              { value: '100', label: 'Within 100 km' },
            ]} />
          {geo.granted && (
            <span className="text-xs text-ink-500">
              Position {geo.lat?.toFixed(4)}, {geo.lng?.toFixed(4)}
              {geo.accuracy ? ` · ±${Math.round(geo.accuracy)} m` : ''}
            </span>
          )}
        </div>
      </div>

      {!geo.granted ? (
        <EmptyState icon="pin" title="Location needed"
          description="Allow Seedwel Hub to use your location, or browse businesses by city instead."
          action={<Link to="/businesses"><Button size="sm" icon="building">Browse all businesses</Button></Link>} />
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="sh-skeleton h-24 rounded-2xl" />)}
        </div>
      ) : businesses.length === 0 ? (
        <EmptyState icon="map" title={`No businesses within ${radius} km`}
          description="Increase the radius, or shop the whole marketplace — most sellers deliver countrywide."
          action={<Button size="sm" variant="outline" onClick={() => setRadius(radius * 2)}>Double the radius</Button>} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {businesses.map((b) => (
            <li key={b.id}>
              <Link to={`/store/${b.slug}`} className="sh-card-flat flex items-center gap-3 p-3.5 hover:shadow-card">
                <BusinessAvatar business={b} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{b.name}</p>
                  <p className="truncate text-xs text-ink-500">{b.city ?? '—'} · {b.category_name ?? 'Store'}</p>
                  <div className="mt-1"><Rating value={toNum(b.rating_avg)} size="xs" /></div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-extrabold text-brand-700">{distanceLabel(b.distance_km)}</p>
                  {openingStatus(b.opening_hours).open
                    ? <Badge tone="green" className="mt-1">Open</Badge>
                    : <Badge tone="neutral" className="mt-1">Closed</Badge>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
