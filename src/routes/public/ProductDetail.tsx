import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Badge, Button, Input, Notice, Textarea } from '@/components/ui/Primitives';
import {
  Avatar, BusinessAvatar, EmptyState, Modal, ProductCard, ProductGrid, QuantityStepper,
  Rating, Skeleton, StatusBadge,
} from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { useToast } from '@/context/ToastContext';
import { db, fetchList, addRow, patchRow, nowIso, newId } from '@/lib/db';
import { notifyBusinessMembers } from '@/lib/notifications';
import { formatMoney, toNum } from '@/lib/currency';
import { formatDate, relativeTime } from '@/lib/dates';
import { discountPercent, productImage, reviewSummary } from '@/lib/format';
import { priceForQuantity, computeTotals } from '@/lib/calc';
import {
  absoluteUrl, copyToClipboard, nativeShare, productShareText, productWhatsappText, whatsappUrl,
} from '@/lib/share';
import { BRAND } from '@/lib/constants';
import { useQuery } from '@/hooks/useQuery';
import type { Product, Review, UUID } from '@/types';

/**
 * Product page — the conversion point of the marketplace.
 *
 * Shows real stock (per warehouse rollup stored on products.stock), variant
 * selection, wholesale tiers, the seller's verification and delivery settings,
 * reviews restricted to verified purchases where applicable, and related items.
 */
export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { add, has } = useCart();
  const { success, error: toastError } = useToast();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [variantId, setVariantId] = useState<UUID | null>(null);
  const [qty, setQty] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [wishlisted, setWishlisted] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [addingToCart, setAddingToCart] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const isUuid = /^[0-9a-f-]{36}$/i.test(slug);
      let q = db
        .from('products')
        .select(`*, business:businesses(*), category:categories(id,name,slug,path,icon),
                 variants:product_variants(*)`)
        .is('deleted_at', null)
        .limit(1);
      q = isUuid ? q.eq('id', slug) : q.eq('slug', slug);
      const { data, error: fetchError } = await q.maybeSingle();
      if (fetchError) throw fetchError;
      if (!data) { setNotFound(true); setProduct(null); return; }
      const p = data as unknown as Product;
      setProduct(p);
      setNotFound(false);

      // A view is real signal for sellers: count it, but only once per session.
      // Anonymous visitors may write the daily stats row (rules verify the
      // product is published); the product's own view_count field is reserved
      // for business-side tools because Firestore rules cannot allow anonymous
      // document updates safely.
      const seen = window.sessionStorage.getItem(`viewed:${p.id}`);
      if (!seen) {
        window.sessionStorage.setItem(`viewed:${p.id}`, '1');
        void db.from('product_stats').upsert({
          id: `${p.id}_${new Date().toISOString().slice(0, 10)}`,
          product_id: p.id, date: new Date().toISOString().slice(0, 10), views: 1,
          business_id: p.business_id,
          created_at: nowIso(), updated_at: nowIso(),
        }, { onConflict: 'id' }).then(() => {});
      }

      const first = (p.variants ?? []).find((v) => v.is_active !== false) ?? null;
      setVariantId(first?.id ?? null);
      setQty(Math.max(1, p.min_purchase_qty ?? 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this product.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const reviews = useQuery<Review>(
    () => product
      ? db.from('reviews')
          .select('*, profile:profiles(id,display_name,full_name,avatar_url)')
          .eq('product_id', product.id).eq('status', 'published')
          .order('is_verified_purchase', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(30)
      : null,
    [product?.id],
  );

  const related = useQuery<Product>(
    () => product
      ? db.from('products')
          .select('*, business:businesses(id,name,slug,logo_url,city,country_code,verification_status,rating_avg,badges), category:categories(id,name,slug,path,icon)')
          .eq('is_published', true).is('deleted_at', null).neq('id', product.id)
          .eq('category_id', product.category_id)
          .order('sold_count', { ascending: false })
          .limit(8)
      : null,
    [product?.id, product?.category_id],
  );

  const wishlistedNow = useQuery<{ id: UUID }>(
    () => user && product
      ? db.from('wishlist_items').select('id').eq('user_id', user.id).eq('product_id', product.id)
      : null,
    [user?.id, product?.id],
  );

  useEffect(() => { setWishlisted(wishlistedNow.data.length > 0); }, [wishlistedNow.data]);

  const variant = useMemo(
    () => product?.variants?.find((v) => v.id === variantId) ?? null,
    [product, variantId],
  );

  const unitPrice = useMemo(() => {
    if (!product) return 0;
    const base = toNum(variant?.price ?? product.price);
    return base;
  }, [product, variant]);

  const priced = useMemo(() => {
    if (!product) return { price: 0, wholesale: false };
    return priceForQuantity(unitPrice, qty, variant?.wholesale_price ?? product.wholesale_price,
      product.wholesale_min_qty, product.is_wholesale);
  }, [product, variant, unitPrice, qty]);

  // Preview maths only — create_order() recomputes the authoritative totals.
  const lineTotal = useMemo(() => computeTotals({
    lines: [{
      product_id: product?.id, name: product?.name, quantity: qty,
      unit_price: priced.price, tax_rate: 0,
    }],
  }), [product, qty, priced]);

  const stock = toNum(variant?.stock ?? product?.stock ?? 0);
  const currency = product?.currency ?? 'ZMW';
  const images = useMemo(() => {
    if (!product) return [] as string[];
    const list = (product.media ?? []).filter((m) => (m.type ?? 'image') === 'image').map((m) => m.url);
    if (variant?.image_url && !list.includes(variant.image_url)) list.unshift(variant.image_url);
    if (product.primary_image_url && !list.includes(product.primary_image_url)) list.unshift(product.primary_image_url);
    return list.filter(Boolean);
  }, [product, variant]);

  const shareUrl = product ? absoluteUrl(`/product/${product.slug ?? product.id}`) : '';

  const toggleWishlist = async () => {
    if (!user) { navigate(`/auth/signin?next=${encodeURIComponent(`/product/${slug}`)}`); return; }
    if (!product) return;
    if (wishlisted) {
      await db.from('wishlist_items').delete().eq('user_id', user.id).eq('product_id', product.id);
      setWishlisted(false);
      success('Removed from wishlist', product.name);
    } else {
      const { error: e } = await db.from('wishlist_items').insert({
        user_id: user.id, product_id: product.id, business_id: product.business_id,
      });
      if (e) { toastError('Could not save', e.message); return; }
      setWishlisted(true);
      success('Saved for later', product.name);
    }
  };

  const addToCart = async (buyNow = false) => {
    if (!product) return;
    if (product.track_inventory && stock < qty && !product.allow_backorder) {
      toastError('Not enough stock', `Only ${Math.round(stock)} left of ${product.name}.`);
      return;
    }
    setAddingToCart(true);
    try {
      await add({ ...product, variants: product.variants }, { quantity: qty, variantId });
      success(buyNow ? 'Added — continue to checkout' : 'Added to cart',
        `${qty} × ${product.name} · ${formatMoney(lineTotal.total, currency)}`);
      if (buyNow) navigate('/cart');
    } catch (e) {
      toastError('Could not add to cart', e instanceof Error ? e.message : undefined);
    } finally {
      setAddingToCart(false);
    }
  };

  if (loading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <Skeleton className="aspect-square w-full rounded-3xl" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-8 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="mx-auto max-w-lg py-8">
        <EmptyState
          icon="search"
          title="This product is not available"
          description={error ?? 'It may have been sold out and removed by the seller, or the link is old.'}
          action={
            <>
              <Link to="/search"><Button size="sm" icon="search">Search the marketplace</Button></Link>
              <Link to="/"><Button size="sm" variant="outline" icon="home">Go home</Button></Link>
            </>
          }
        />
      </div>
    );
  }

  const business = product.business;
  const off = discountPercent(toNum(product.price), product.compare_at_price ? toNum(product.compare_at_price) : null);
  const isService = product.product_type === 'service' || product.product_type === 'both';
  const outOfStock = product.track_inventory && stock <= 0 && !product.allow_backorder;
  const summary = reviewSummary(reviews.data);

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-xs text-ink-500" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-brand-700">Home</Link>
        <Icon name="chevronRight" size={12} />
        <Link to="/search" className="hover:text-brand-700">Marketplace</Link>
        {product.category && (
          <>
            <Icon name="chevronRight" size={12} />
            <Link to={`/category/${product.category.slug}`} className="hover:text-brand-700">{product.category.name}</Link>
          </>
        )}
        <Icon name="chevronRight" size={12} />
        <span className="max-w-[16rem] truncate font-semibold text-ink-800">{product.name}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
        {/* Gallery */}
        <div className="space-y-3">
          <div className="sh-card-flat relative aspect-square overflow-hidden bg-ink-100">
            {images.length > 0 ? (
              <img
                src={images[imageIndex]} alt={`${product.name} — image ${imageIndex + 1}`}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-ink-400">
                <span className="text-6xl" aria-hidden="true">{product.category?.icon ?? '📦'}</span>
                <p className="text-sm">No photo supplied</p>
              </div>
            )}

            {off && (
              <span className="absolute left-3 top-3"><Badge tone="red">-{off}% off</Badge></span>
            )}
            {outOfStock && (
              <span className="absolute right-3 top-3"><Badge tone="neutral">Out of stock</Badge></span>
            )}

            {images.length > 1 && (
              <>
                <button type="button" onClick={() => setImageIndex((i) => (i - 1 + images.length) % images.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow hover:bg-white"
                  aria-label="Previous image">
                  <Icon name="chevronLeft" size={18} />
                </button>
                <button type="button" onClick={() => setImageIndex((i) => (i + 1) % images.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow hover:bg-white"
                  aria-label="Next image">
                  <Icon name="chevronRight" size={18} />
                </button>
              </>
            )}
          </div>

          {images.length > 1 && (
            <div className="sh-rail">
              {images.map((url, i) => (
                <button key={url} type="button" onClick={() => setImageIndex(i)}
                  className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition-colors ${
                    i === imageIndex ? 'border-brand-500' : 'border-transparent hover:border-ink-300'
                  }`}
                  aria-label={`Show image ${i + 1}`} aria-current={i === imageIndex}>
                  <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}

          {/* Seller card */}
          {business && (
            <Link to={`/store/${business.slug}`} className="sh-card-flat flex items-center gap-3 p-3.5 hover:shadow-card">
              <BusinessAvatar business={business} size={48} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-bold">
                  {business.name}
                  {business.verification_status === 'verified' && (
                    <Icon name="shield" size={14} className="shrink-0 text-sky-500" />
                  )}
                </p>
                <p className="truncate text-xs text-ink-500">
                  {business.city ?? '—'} · seedwelhub.com/store/{business.slug}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Rating value={toNum(business.rating_avg)} size="xs" />
                  {(business.badges ?? []).slice(0, 2).map((b) => <Badge key={b} tone="accent">{b}</Badge>)}
                </div>
              </div>
              <Icon name="chevronRight" size={18} className="shrink-0 text-ink-400" />
            </Link>
          )}

          {/* Description */}
          <section className="sh-card-flat p-4">
            <h2 className="text-sm font-extrabold">Description</h2>
            <div className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-700">
              {product.description || product.short_description || 'The seller has not added a description for this item.'}
            </div>

            <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-ink-100 pt-4 text-sm sm:grid-cols-2">
              <Spec label="Condition" value={product.condition} />
              <Spec label="Brand" value={product.brand} />
              <Spec label="Model" value={product.model} />
              <Spec label="SKU" value={product.sku} />
              <Spec label="Barcode" value={product.barcode} />
              <Spec label="Unit" value={product.unit} />
              {product.weight_kg ? <Spec label="Weight" value={`${product.weight_kg} kg`} /> : null}
              {product.warranty ? <Spec label="Warranty" value={product.warranty} /> : null}
              {product.category ? <Spec label="Category" value={product.category.name} /> : null}
              <Spec label="Listed" value={formatDate(product.published_at ?? product.created_at)} />
              {(product.tags ?? []).length > 0 && (
                <div className="sm:col-span-2">
                  <dt className="sh-label">Tags</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {product.tags.map((t) => (
                      <Link key={t} to={`/search?q=${encodeURIComponent(t)}`} className="sh-pill sh-pill-neutral hover:bg-ink-200">
                        {t}
                      </Link>
                    ))}
                  </dd>
                </div>
              )}
            </dl>

            {isService && (
              <div className="mt-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-900">
                <p className="font-bold flex items-center gap-1.5"><Icon name="briefcase" size={15} /> This is a service</p>
                <p className="mt-1 text-[13px]">
                  {product.service_duration_minutes ? `Typical duration ${product.service_duration_minutes} minutes. ` : ''}
                  {product.service_area ? `Service area: ${product.service_area}.` : 'Contact the provider to confirm availability and schedule.'}
                </p>
              </div>
            )}
          </section>

          {/* Reviews */}
          <section className="sh-card-flat p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-extrabold">Ratings & reviews</h2>
              <Button variant="outline" size="sm" icon="star" onClick={() => setReviewOpen(true)}>
                Write a review
              </Button>
            </div>

            {reviews.loading ? (
              <div className="space-y-2 pt-3">
                {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : summary.count === 0 ? (
              <p className="mt-3 text-sm text-ink-500">
                No reviews yet. Buyers who purchased this item can leave the first review.
              </p>
            ) : (
              <>
                <div className="mt-3 grid gap-4 sm:grid-cols-[auto_1fr]">
                  <div className="text-center">
                    <p className="text-4xl font-extrabold tabular-nums">{summary.avg.toFixed(1)}</p>
                    <Rating value={summary.avg} size="md" showValue={false} />
                    <p className="mt-1 text-xs text-ink-500">{summary.count} review{summary.count === 1 ? '' : 's'}</p>
                  </div>
                  <ul className="space-y-1">
                    {[5, 4, 3, 2, 1].map((star) => {
                      const n = summary.buckets[star] ?? 0;
                      const pct = summary.count ? Math.round((n / summary.count) * 100) : 0;
                      return (
                        <li key={star} className="flex items-center gap-2 text-xs">
                          <span className="w-8 shrink-0 font-semibold text-ink-600">{star}★</span>
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                            <span className="block h-full rounded-full bg-accent-400" style={{ width: `${pct}%` }} />
                          </span>
                          <span className="w-8 shrink-0 text-right tabular-nums text-ink-500">{n}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <ul className="mt-4 divide-y divide-ink-100">
                  {reviews.data.map((r) => (
                    <li key={r.id} className="py-3">
                      <div className="flex items-start gap-2.5">
                        <Avatar src={(r as Review & { profile?: { avatar_url?: string | null } }).profile?.avatar_url}
                          name={r.reviewer_name} size={34} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[13px] font-bold">{r.reviewer_name ?? 'Seedwel buyer'}</span>
                            {r.is_verified_purchase && <Badge tone="green" icon="check">Verified purchase</Badge>}
                            <span className="text-[11px] text-ink-400">{relativeTime(r.created_at)}</span>
                          </div>
                          <Rating value={r.rating} size="xs" showValue={false} />
                          {r.title && <p className="mt-1 text-sm font-semibold">{r.title}</p>}
                          {r.body && <p className="mt-0.5 text-sm leading-relaxed text-ink-600">{r.body}</p>}
                          {r.seller_reply && (
                            <div className="mt-2 rounded-xl bg-ink-50 p-2.5 text-[13px]">
                              <p className="font-bold text-ink-700">Reply from {business?.name ?? 'the seller'}</p>
                              <p className="mt-0.5 text-ink-600">{r.seller_reply}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        {/* Buy panel */}
        <aside className="space-y-3 lg:sticky lg:top-32 lg:self-start">
          <div className="sh-card p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {product.is_featured && <Badge tone="accent" icon="fire">Featured</Badge>}
              {product.is_wholesale && <Badge tone="brand" icon="box">Wholesale available</Badge>}
              <StatusBadge status={outOfStock ? 'out_of_stock' : 'in_stock'} />
            </div>

            <h1 className="mt-2 text-lg font-extrabold leading-snug sm:text-xl">{product.name}</h1>

            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Rating value={toNum(product.rating_avg)} count={product.rating_count} />
              <span className="text-xs text-ink-400">· {product.sold_count} sold</span>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <p className="sh-money text-2xl font-extrabold sm:text-3xl">
                {formatMoney(priced.price, currency)}
              </p>
              {product.compare_at_price && toNum(product.compare_at_price) > toNum(product.price) && (
                <p className="text-sm text-ink-400 line-through">
                  {formatMoney(product.compare_at_price, currency)}
                </p>
              )}
              <span className="text-xs text-ink-500">per {product.unit}</span>
            </div>

            {priced.wholesale && (
              <p className="mt-1 text-xs font-bold text-emerald-700">
                Wholesale price applied — {qty} × {product.unit} at {formatMoney(priced.price, currency)}
              </p>
            )}

            {product.is_wholesale && product.wholesale_price && (
              <div className="mt-2 rounded-xl bg-brand-50 p-2.5 text-xs text-brand-900">
                <p className="font-bold">Buy {product.wholesale_min_qty}+ for {formatMoney(product.wholesale_price, currency)} each</p>
                <p className="mt-0.5 opacity-80">
                  Retail {formatMoney(product.price, currency)} · you save
                  {' '}{formatMoney((toNum(product.price) - toNum(product.wholesale_price)) * qty, currency)} on {qty}
                </p>
              </div>
            )}

            {product.is_taxable && (
              <p className="mt-2 text-[11px] text-ink-500">
                {business?.tax_registered ? 'Price includes VAT where applicable.' : 'Tax may be added at checkout.'}
              </p>
            )}

            {/* Variants */}
            {(product.variants?.length ?? 0) > 0 && (
              <div className="mt-4">
                <p className="sh-field-label">Option</p>
                <div className="flex flex-wrap gap-1.5">
                  {(product.variants ?? []).map((v) => {
                    const active = v.id === variantId;
                    const vStock = toNum(v.stock ?? 0);
                    return (
                      <button key={v.id} type="button" onClick={() => { setVariantId(v.id); setImageIndex(0); }}
                        disabled={product.track_inventory && vStock <= 0}
                        className={`rounded-xl border px-3 py-2 text-left text-[13px] font-semibold transition-colors disabled:opacity-40 ${
                          active ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-ink-300 hover:border-ink-400'
                        }`}>
                        <span className="block">{v.name}</span>
                        <span className="block text-[11px] font-medium text-ink-500">
                          {formatMoney(v.price, currency)}{product.track_inventory ? ` · ${Math.round(vStock)} left` : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {variant?.sku && <p className="mt-1.5 text-[11px] text-ink-500">SKU {variant.sku}</p>}
              </div>
            )}

            {/* Stock */}
            {product.track_inventory && !outOfStock && (
              <p className={`mt-3 text-xs font-semibold ${stock <= toNum(product.stock_alert) ? 'text-amber-700' : 'text-emerald-700'}`}>
                {stock <= toNum(product.stock_alert)
                  ? `Hurry — only ${Math.round(stock)} left in stock`
                  : `${Math.round(stock)} in stock`}
                {product.allow_backorder ? ' · backorders accepted' : ''}
              </p>
            )}

            {/* Quantity */}
            <div className="mt-3 flex items-center justify-between gap-3">
              <QuantityStepper
                value={qty} onChange={setQty}
                min={Math.max(1, product.min_purchase_qty ?? 1)}
                max={product.track_inventory && !product.allow_backorder ? Math.max(1, Math.round(stock)) : undefined}
                label="Quantity"
              />
              <p className="text-right">
                <span className="block text-[11px] text-ink-500">Total</span>
                <span className="sh-money block text-lg font-extrabold">{formatMoney(lineTotal.total, currency)}</span>
              </p>
            </div>

            {product.min_purchase_qty > 1 && (
              <p className="mt-1 text-[11px] text-ink-500">Minimum order {product.min_purchase_qty} {product.unit}s</p>
            )}

            <div className="mt-4 grid gap-2">
              <Button size="lg" block icon="cart" loading={addingToCart} disabled={outOfStock}
                onClick={() => void addToCart(false)}>
                {outOfStock ? 'Out of stock' : has(product.id, variantId) ? 'Add more to cart' : 'Add to cart'}
              </Button>
              <Button size="lg" block variant="accent" icon="wallet" disabled={outOfStock}
                onClick={() => void addToCart(true)}>
                Buy now
              </Button>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" icon={wishlisted ? 'heart' : 'heart'}
                  onClick={() => void toggleWishlist()} aria-pressed={wishlisted}>
                  <span className={wishlisted ? 'text-red-500' : ''}>{wishlisted ? 'Saved' : 'Save'}</span>
                </Button>
                <Button variant="outline" size="sm" icon="share" onClick={() => setShareOpen(true)}>Share</Button>
                <a href={business?.phone ? whatsappUrl(business.phone,
                  `Hello ${business.name}, I am interested in "${product.name}" (${formatMoney(priced.price, currency)}). Is it available?`) : '#'}
                  target="_blank" rel="noreferrer"
                  className="sh-btn sh-btn-outline sh-btn-sm">
                  <Icon name="whatsapp" size={15} /> Ask
                </a>
              </div>
            </div>
          </div>

          {/* Delivery & returns */}
          <div className="sh-card-flat divide-y divide-ink-100">
            {business?.delivery_enabled && (
              <Row icon="truck" title="Delivery available"
                text={product.requires_delivery
                  ? `Dispatched by ${business.name}${product.delivery_days ? ` · arrives in about ${product.delivery_days} day${product.delivery_days === 1 ? '' : 's'}` : ''}`
                  : `${business.name} delivers this item${business.delivery_fee ? ` from ${formatMoney(business.delivery_fee, business.base_currency)}` : ''}`} />
            )}
            <Row icon="store" title="Collection available"
              text={business?.address_line1 ? `${business.address_line1}${business.city ? `, ${business.city}` : ''}` : 'Collect from the seller’s shop'} />
            <Row icon="wallet" title="Pay your way"
              text="Cash, mobile money (Airtel, MTN, Zamtel), bank transfer or card. Every payment generates a receipt." />
            <Row icon="refresh" title="Returns & terms"
              text={business?.invoice_terms
                ?? `Open a return from My orders within the seller's policy. Payment terms ${business?.payment_terms_days ?? 7} days.`} />
            {business?.tax_registered && <Row icon="shield" title="Tax registered" text={`VAT number ${business.tax_number ?? 'on file'}`} />}
          </div>
        </aside>
      </div>

      {/* Related */}
      {related.data.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-extrabold">Similar products</h2>
              <p className="text-xs text-ink-500">More from {product.category?.name ?? 'this category'}</p>
            </div>
            <Link to={`/category/${product.category?.slug ?? ''}`}>
              <Button variant="ghost" size="sm" iconRight="chevronRight">See all</Button>
            </Link>
          </div>
          <ProductGrid cols={4}>
            {related.data.map((p) => (
              <ProductCard key={p.id} product={p} onAddToCart={async (prod) => {
                await add(prod);
                success('Added to cart', prod.name);
              }} />
            ))}
          </ProductGrid>
        </section>
      )}

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} product={product}
        businessName={business?.name ?? BRAND.name} url={shareUrl} />

      <ReviewModal open={reviewOpen} onClose={() => setReviewOpen(false)} product={product}
        onSubmitted={() => { setReviewOpen(false); void reviews.refresh(); }} />
    </div>
  );
}

function Spec({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="sh-label">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-medium capitalize text-ink-800">{value.replace(/_/g, ' ')}</dd>
    </div>
  );
}

function Row({ icon, title, text }: { icon: 'truck' | 'store' | 'wallet' | 'refresh' | 'shield'; title: string; text: string }) {
  return (
    <div className="flex items-start gap-2.5 p-3">
      <Icon name={icon} size={17} className="mt-0.5 shrink-0 text-brand-600" />
      <div className="min-w-0">
        <p className="text-[13px] font-bold">{title}</p>
        <p className="text-xs leading-relaxed text-ink-500">{text}</p>
      </div>
    </div>
  );
}

function ShareModal({ open, onClose, product, businessName, url }: {
  open: boolean; onClose: () => void; product: Product; businessName: string; url: string;
}) {
  const { success } = useToast();
  const channels = [
    { key: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' as const, tone: 'bg-emerald-50 text-emerald-700' },
    { key: 'facebook', label: 'Facebook', icon: 'share' as const, tone: 'bg-sky-50 text-sky-700' },
    { key: 'x', label: 'X / Twitter', icon: 'send' as const, tone: 'bg-ink-100 text-ink-800' },
    { key: 'sms', label: 'SMS', icon: 'phone' as const, tone: 'bg-brand-50 text-brand-700' },
    { key: 'copy', label: 'Copy link', icon: 'link' as const, tone: 'bg-ink-100 text-ink-700' },
    { key: 'native', label: 'More apps…', icon: 'more' as const, tone: 'bg-accent-50 text-accent-700' },
  ];

  const go = async (key: string) => {
    const text = productShareText(product, businessName, url);
    if (key === 'copy') {
      const ok = await copyToClipboard(url);
      if (ok) success('Link copied', url);
      return;
    }
    if (key === 'native') {
      const ok = await nativeShare({ title: product.name, text, url });
      if (!ok) window.open(whatsappUrl(null, text), '_blank', 'noopener');
      return;
    }
    if (key === 'whatsapp') { window.open(whatsappUrl(null, productWhatsappText(product, businessName, url)), '_blank', 'noopener'); return; }
    if (key === 'sms') { window.open(`sms:?body=${encodeURIComponent(text)}`, '_self'); return; }
    if (key === 'facebook') {
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`, '_blank', 'noopener');
      return;
    }
    if (key === 'x') {
      window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Share this product" subtitle={product.name} size="sm">
      <div className="space-y-4">
        <div className="flex gap-3 rounded-2xl border border-ink-200 p-3">
          {productImage(product) && (
            <img src={productImage(product)!} alt="" className="h-16 w-16 rounded-xl object-cover" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{product.name}</p>
            <p className="text-xs text-ink-500">{businessName}</p>
            <p className="sh-money mt-1 text-sm font-extrabold">{formatMoney(product.price, product.currency)}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {channels.map((c) => (
            <button key={c.key} type="button" onClick={() => void go(c.key)}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-ink-200 p-3 text-[11px] font-bold text-ink-700 hover:border-brand-300 hover:bg-brand-50">
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${c.tone}`}>
                <Icon name={c.icon} size={17} />
              </span>
              {c.label}
            </button>
          ))}
        </div>

        <Input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Product link" />
      </div>
    </Modal>
  );
}

function ReviewModal({ open, onClose, product, onSubmitted }: {
  open: boolean; onClose: () => void; product: Product; onSubmitted: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);

  // "Verified Purchase" is earned, never claimed: the buyer must actually have
  // an order line for this product.
  useEffect(() => {
    if (!open || !user) { setVerified(false); return; }
    let alive = true;
    (async () => {
      const orders = await fetchList<{ id: string; status: string; items?: { product_id?: string | null }[] }>('orders', {
        where: [['buyer_user_id', '==', user.id] as never], limit: 100,
      }).catch(() => []);
      if (!alive) return;
      const bought = orders.some(
        (o) => o.status !== 'cancelled' && (o.items ?? []).some((l) => l.product_id === product.id),
      );
      setVerified(bought);
    })();
    return () => { alive = false; };
  }, [open, user, product.id]);

  const submit = async () => {
    if (!user) { onClose(); navigate(`/auth/signin?next=/product/${product.slug}`); return; }
    if (!comment.trim()) { toastError('Add a few words', 'Tell other buyers what you think.'); return; }
    setBusy(true);
    const reviewerName = user.user_metadata?.display_name
      ?? user.user_metadata?.full_name
      ?? user.email?.split('@')[0]
      ?? 'Seedwel shopper';
    try {
      const id = newId();
      await addRow<{ id: string }>('reviews', {
        business_id: product.business_id,
        product_id: product.id,
        reviewer_id: user.id,
        reviewer_name: reviewerName,
        profile: {
          id: user.id,
          avatar_url: user.photoURL ?? null,
          display_name: reviewerName,
          full_name: user.user_metadata?.full_name ?? reviewerName,
        },
        target_type: 'product',
        rating,
        title: title.trim() || null,
        body: comment.trim(),
        is_verified_purchase: verified,
        status: 'published',
        created_at: nowIso(),
        updated_at: nowIso(),
      } as never, id);
      // Keep the product's rolling rating truthful.
      const all = await fetchList<{ rating: number | string }>('reviews', {
        where: [['product_id', '==', product.id] as never, ['status', '==', 'published'] as never], limit: 300,
      }).catch(() => []);
      const avg = all.length
        ? Math.round((all.reduce((sum, r) => sum + Number(r.rating ?? 0), 0) / all.length) * 10) / 10
        : Number(rating);
      await patchRow('products', product.id, { rating_avg: avg, rating_count: all.length, updated_at: nowIso() }).catch(() => undefined);
      void notifyBusinessMembers(product.business_id, {
        type: 'review',
        title: `New ${rating}-star review`,
        body: comment.trim().slice(0, 140),
        icon: 'star',
        action_url: '/business/products/' + product.id + '/detail',
        entity_type: 'product',
        entity_id: product.id,
      });
      success('Thank you for your review', 'It is now visible on the product page.');
      setRating(5); setTitle(''); setComment('');
      onSubmitted();
    } catch (err) {
      toastError('Could not save your review', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Write a review" subtitle={product.name} size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={busy} onClick={() => void submit()}>Publish review</Button>
        </>
      }>
      <div className="space-y-4">
        {!user && (
          <Notice tone="info" title="Sign in to review">
            Reviews are attached to a real account so buyers can trust them.
          </Notice>
        )}

        <div>
          <p className="sh-field-label">Your rating</p>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star${n === 1 ? '' : 's'}`}
                className={`text-3xl transition-transform hover:scale-110 ${n <= rating ? 'text-accent-400' : 'text-ink-200'}`}>
                ★
              </button>
            ))}
          </div>
          {verified && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <Icon name="check" size={13} /> Marked as a Verified Purchase — you ordered this item.
            </p>
          )}
        </div>

        <Input label="Headline (optional)" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Great value, fast delivery" maxLength={120} />
        <Textarea label="Your review" required value={comment} onChange={(e) => setComment(e.target.value)}
          placeholder="What did you like or dislike? Was the quality as described?" rows={4} maxLength={2000} />
        <p className="text-[11px] text-ink-500">
          Reviews are public and moderated. Do not include phone numbers, addresses or payment details.
        </p>
      </div>
    </Modal>
  );
}
