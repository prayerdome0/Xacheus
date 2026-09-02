import { memo, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { Badge, Button, Input, type BadgeTone } from './Primitives';
import { avatarText, discountPercent, productImage, ratingStars } from '@/lib/format';
import { colorFromString } from '@/lib/slug';
import { formatMoney } from '@/lib/currency';
import { CURRENCIES } from '@/lib/currency';
import { toNum } from '@/lib/currency';
import type { Product, UUID } from '@/types';

/* ── Avatar ────────────────────────────────────────────────────────────────── */

export function Avatar({ src, name, size = 40, rounded = 'full', ring, className = '' }: {
  src?: string | null; name?: string | null; size?: number;
  rounded?: 'full' | 'xl' | 'lg'; ring?: boolean; className?: string;
}) {
  const radius = rounded === 'full' ? '9999px' : rounded === 'xl' ? '1rem' : '0.75rem';
  const bg = colorFromString(name ?? 'S');
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden font-bold text-white ${ring ? 'ring-2 ring-white' : ''} ${className}`}
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: src ? undefined : bg }}
    >
      {src
        ? <img src={src} alt={name ?? ''} loading="lazy" className="h-full w-full object-cover" />
        : <span style={{ fontSize: Math.max(10, size * 0.38) }}>{avatarText(name ?? '?')}</span>}
    </span>
  );
}

export function BusinessAvatar({ business, size = 40, showVerified = true }: {
  business?: { name?: string | null; slug?: string | null; logo_url?: string | null; verification_status?: string | null } | null;
  size?: number; showVerified?: boolean;
}) {
  const verified = business?.verification_status === 'verified';
  return (
    <span className="relative inline-flex shrink-0">
      <Avatar src={business?.logo_url ?? null} name={business?.name} size={size} rounded="xl" />
      {showVerified && verified && (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-sky-500 text-white ring-2 ring-white"
          style={{ width: Math.max(12, size * 0.34), height: Math.max(12, size * 0.34) }}
          title="Verified business"
        >
          <Icon name="check" size={Math.max(7, size * 0.2)} />
        </span>
      )}
    </span>
  );
}

/* ── Rating ────────────────────────────────────────────────────────────────── */

export function Rating({ value, count, size = 'sm', showValue = true }: {
  value?: number | null; count?: number | null; size?: 'xs' | 'sm' | 'md'; showValue?: boolean;
}) {
  const v = Number(value ?? 0);
  if (!v && !count) {
    return <span className="text-xs text-ink-400">No reviews yet</span>;
  }
  const px = size === 'xs' ? 11 : size === 'md' ? 17 : 13;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-accent-400 leading-none" style={{ fontSize: px }} aria-hidden="true">
        {ratingStars(v)}
      </span>
      {showValue && <span className="text-xs font-bold text-ink-800 tabular-nums">{v.toFixed(1)}</span>}
      {count !== undefined && count !== null && (
        <span className="text-xs text-ink-500">({count})</span>
      )}
    </span>
  );
}

/* ── Status badge ──────────────────────────────────────────────────────────── */

const STATUS_TONES: Record<string, BadgeTone> = {
  // documents
  draft: 'neutral', sent: 'blue', viewed: 'blue', accepted: 'green', declined: 'red',
  expired: 'neutral', paid: 'green', partially_paid: 'amber', unpaid: 'red', overdue: 'red',
  void: 'neutral', cancelled: 'red',
  // orders
  pending: 'amber', confirmed: 'amber', processing: 'amber', ready: 'blue', shipped: 'blue',
  out_for_delivery: 'blue', delivered: 'green', completed: 'green', returned: 'red', rejected: 'red', refunded: 'red',
  // misc
  active: 'green', inactive: 'neutral', suspended: 'red', pending_verification: 'amber',
  verified: 'green', archived: 'neutral', open: 'blue', in_transit: 'blue', received: 'green',
  partially_received: 'amber', closed: 'neutral', approved: 'green', awaiting_approval: 'amber',
  trial: 'blue', trialing: 'blue', past_due: 'amber', unpaid_subscription: 'red',
  published: 'green', out_of_stock: 'red', low_stock: 'amber', in_stock: 'green',
  new: 'brand', read: 'neutral', unread: 'brand', resolved: 'green', escalated: 'red',
};

const STATUS_LABELS: Record<string, string> = {
  partially_paid: 'Partially paid', pending_verification: 'Pending verification',
  partially_received: 'Partially received', awaiting_approval: 'Awaiting approval',
  past_due: 'Past due', out_of_stock: 'Out of stock', low_stock: 'Low stock',
  in_stock: 'In stock', in_transit: 'In transit', credit_note: 'Credit note',
  debit_note: 'Debit note', proforma: 'Pro-forma',
};

export function StatusBadge({ status, icon }: { status?: string | null; icon?: IconName }) {
  if (!status) return null;
  const tone = STATUS_TONES[status] ?? 'neutral';
  const label = STATUS_LABELS[status] ?? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return <Badge tone={tone} icon={icon}>{label}</Badge>;
}

/* ── Product card ──────────────────────────────────────────────────────────── */

export interface ProductCardProps {
  product: Product;
  onAddToCart?: (p: Product) => void;
  onWishlist?: (p: Product) => void;
  wishlisted?: boolean;
  currency?: string;
  compact?: boolean;
  badge?: ReactNode;
}

export const ProductCard = memo(function ProductCard({
  product, onAddToCart, onWishlist, wishlisted, currency = 'ZMW', compact, badge,
}: ProductCardProps) {
  const image = productImage(product);
  const price = toNum(product.price);
  const compare = product.compare_at_price ? toNum(product.compare_at_price) : null;
  const off = discountPercent(price, compare);
  const stockQty = toNum(product.stock ?? 0);
  const out = product.track_inventory && !product.allow_backorder ? stockQty <= 0 : false;
  const storeSlug = product.business?.slug ?? '';
  const currencyInfo = CURRENCIES[(product.currency ?? currency).toUpperCase()] ?? CURRENCIES.ZMW;

  return (
    <article className="sh-card-flat group relative flex flex-col overflow-hidden transition-shadow hover:shadow-card">
      <Link
        to={`/product/${product.slug ?? product.id}`}
        className="relative block aspect-square overflow-hidden bg-ink-100"
        aria-label={product.name}
      >
        {image ? (
          <img
            src={image} alt={product.name} loading="lazy" decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-4xl opacity-40">
            {product.category?.icon ?? '📦'}
          </span>
        )}

        {(off || out || product.is_featured || badge) && (
          <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
            {off ? <Badge tone="red">-{off}%</Badge> : null}
            {out ? <Badge tone="neutral">Out of stock</Badge> : null}
            {product.is_featured && !out ? <Badge tone="accent" icon="fire">Hot</Badge> : null}
            {badge}
          </div>
        )}

        {product.track_inventory && !out && stockQty <= toNum(product.stock_alert ?? 5) && (
          <span className="absolute bottom-2 left-2 rounded-md bg-ink-950/75 px-1.5 py-0.5 text-[10px] font-bold text-white">
            Only {Math.round(stockQty)} left
          </span>
        )}
      </Link>

      {onWishlist && (
        <button
          type="button"
          onClick={() => onWishlist(product)}
          aria-label={wishlisted ? 'Remove from wishlist' : 'Save for later'}
          className={`absolute right-2 top-2 rounded-full bg-white/90 p-1.5 shadow transition-colors ${
            wishlisted ? 'text-red-500' : 'text-ink-500 hover:text-red-500'
          }`}
        >
          <Icon name="heart" size={16} filled={wishlisted} />
        </button>
      )}

      <div className={`flex flex-1 flex-col ${compact ? 'p-2.5' : 'p-3'}`}>
        {storeSlug && !compact && (
          <Link
            to={`/store/${storeSlug}`}
            className="mb-1 inline-flex items-center gap-1 truncate text-[11px] font-semibold text-ink-500 hover:text-brand-700"
          >
            {product.business?.verification_status === 'verified' && <Icon name="shield" size={11} className="text-sky-500" />}
            <span className="truncate">{product.business?.name ?? 'Seedwel Hub'}</span>
          </Link>
        )}

        <Link to={`/product/${product.slug ?? product.id}`} className="min-w-0">
          <h3 className={`line-clamp-2 font-semibold leading-snug text-ink-900 hover:text-brand-700 ${compact ? 'text-[13px]' : 'text-sm'}`}>
            {product.name}
          </h3>
        </Link>

        {!compact && product.short_description && (
          <p className="mt-1 line-clamp-2 text-xs text-ink-500">{product.short_description}</p>
        )}

        <div className="mt-1.5">
          <Rating value={toNum(product.rating_avg)} count={product.rating_count} size="xs" showValue={false} />
        </div>

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            <p className="sh-money text-[15px] font-extrabold text-ink-950">
              {formatMoney(price, currencyInfo.code)}
            </p>
            {compare && compare > price && (
              <p className="text-[11px] text-ink-400 line-through">{formatMoney(compare, currencyInfo.code)}</p>
            )}
            {product.is_wholesale && product.wholesale_price && (
              <p className="text-[10px] font-semibold text-brand-700">
                Wholesale {formatMoney(toNum(product.wholesale_price), currencyInfo.code)} from {product.wholesale_min_qty}
              </p>
            )}
          </div>
          {onAddToCart && (
            <button
              type="button"
              disabled={out}
              onClick={() => onAddToCart(product)}
              aria-label={`Add ${product.name} to cart`}
              className="sh-btn sh-btn-primary sh-btn-icon h-9 w-9 rounded-xl"
            >
              <Icon name="plus" size={17} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
});

export function ProductGrid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const grid = cols === 4 ? 'sm:grid-cols-3 lg:grid-cols-4' : cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-3 lg:grid-cols-4';
  return <div className={`grid grid-cols-2 gap-3 ${grid}`}>{children}</div>;
}

/* ── Search bar ────────────────────────────────────────────────────────────── */

export function SearchBar({ value, onChange, onSubmit, placeholder, icon = 'search', autoFocus, clearable = true, rightSlot }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  icon?: IconName;
  autoFocus?: boolean;
  clearable?: boolean;
  rightSlot?: ReactNode;
}) {
  return (
    <form
      className="relative flex-1"
      onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}
      role="search"
    >
      <Icon name={icon} size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search products, shops and services…'}
        aria-label="Search"
        className="sh-input h-11 pl-10 pr-20 text-[15px]"
      />
      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {clearable && value && (
          <button type="button" onClick={() => onChange('')} aria-label="Clear search"
            className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <Icon name="close" size={15} />
          </button>
        )}
        {rightSlot}
      </div>
    </form>
  );
}

/** Natural-language search hint chips: "Black shoes under K500". */
export function SearchSuggestions({ suggestions, onPick }: { suggestions: string[]; onPick: (s: string) => void }) {
  if (suggestions.length === 0) return null;
  return (
    <div className="sh-rail py-1">
      {suggestions.map((s) => (
        <button key={s} type="button" onClick={() => onPick(s)}
          className="sh-pill sh-pill-neutral hover:border-brand-300 hover:bg-brand-50">
          <Icon name="search" size={11} /> {s}
        </button>
      ))}
    </div>
  );
}

/* ── Quantity stepper ──────────────────────────────────────────────────────── */

export function QuantityStepper({ value, onChange, min = 1, max, size = 'md', label }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number;
  size?: 'sm' | 'md'; label?: string;
}) {
  const dim = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10';
  const clamp = (n: number) => Math.max(min, max ? Math.min(max, n) : n);
  return (
    <div className="inline-flex items-center rounded-xl border border-ink-300 bg-white" role="group" aria-label={label ?? 'Quantity'}>
      <button type="button" className={`${dim} flex items-center justify-center text-ink-600 hover:bg-ink-100 disabled:opacity-40`}
        onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label="Decrease quantity">
        <Icon name={value - 1 < min ? 'trash' : 'minus'} size={15} />
      </button>
      <input
        type="number" value={value} min={min} max={max} inputMode="numeric"
        onChange={(e) => onChange(clamp(Number(e.target.value) || min))}
        aria-label={label ?? 'Quantity'}
        className={`${size === 'sm' ? 'w-10' : 'w-12'} bg-transparent text-center text-sm font-bold tabular-nums focus:outline-none`}
      />
      <button type="button" className={`${dim} flex items-center justify-center text-ink-600 hover:bg-ink-100 disabled:opacity-40`}
        onClick={() => onChange(clamp(value + 1))} disabled={max !== undefined && value >= max} aria-label="Increase quantity">
        <Icon name="plus" size={15} />
      </button>
    </div>
  );
}

/* ── Money input ───────────────────────────────────────────────────────────── */

export function MoneyInput({ value, onChange, currency = 'ZMW', label, hint, error, min = 0, required, disabled, step = '0.01', id }: {
  value: number | string;
  onChange: (n: number) => void;
  currency?: string;
  label?: ReactNode; hint?: ReactNode; error?: string | null;
  min?: number; required?: boolean; disabled?: boolean; step?: string; id?: string;
}) {
  const [text, setText] = useState(String(value ?? ''));
  const info = CURRENCIES[currency] ?? CURRENCIES.ZMW;

  // Keep the typed text in sync when the value is changed from outside
  // (currency switch, discount applied, line recalculated).
  const numValue = toNum(value);
  const typedValue = Number(String(text).replace(/[^\d.\-]/g, ''));
  const outOfSync = text !== '' && Number.isFinite(typedValue) && Math.abs(typedValue - numValue) > 0.001;
  if (outOfSync && String(numValue) !== String(typedValue)) {
    // Derive during render is safe here: it only normalises display text.
    setText(String(value ?? ''));
  }

  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      label={label}
      hint={hint}
      error={error}
      required={required}
      disabled={disabled}
      lead={<span className="text-xs font-bold text-ink-500">{info.symbol}</span>}
      value={text}
      step={step}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d.\-]/g, '');
        setText(raw);
        const n = Number(raw);
        onChange(Number.isFinite(n) ? Math.max(min, n) : 0);
      }}
      onBlur={() => {
        const n = Math.max(min, Number(text.replace(/[^\d.\-]/g, '')) || 0);
        setText(String(Number(n.toFixed(2))));
        onChange(n);
      }}
      placeholder="0.00"
    />
  );
}

/* ── Tabs ──────────────────────────────────────────────────────────────────── */

export interface TabItem { key: string; label: string; icon?: IconName; badge?: number | string; }

export function Tabs({ tabs, active, onChange, variant = 'underline' }: {
  tabs: TabItem[]; active: string; onChange: (key: string) => void; variant?: 'underline' | 'pill' | 'segment';
}) {
  if (variant === 'segment') {
    return (
      <div className="inline-flex rounded-xl bg-ink-100 p-1">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => onChange(t.key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              active === t.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
            }`}>
            {t.icon && <Icon name={t.icon} size={15} />}
            {t.label}
            {t.badge !== undefined && <span className="rounded-full bg-ink-200 px-1.5 text-[10px]">{t.badge}</span>}
          </button>
        ))}
      </div>
    );
  }

  if (variant === 'pill') {
    return (
      <div className="sh-rail">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => onChange(t.key)}
            className={`sh-pill ${active === t.key ? 'sh-pill-brand' : 'sh-pill-neutral hover:bg-ink-200'}`}>
            {t.icon && <Icon name={t.icon} size={12} />}
            {t.label}
            {t.badge !== undefined && <span className="font-bold">· {t.badge}</span>}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="sh-rail border-b border-ink-200">
      {tabs.map((t) => (
        <button key={t.key} type="button" onClick={() => onChange(t.key)}
          className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-semibold transition-colors ${
            active === t.key ? 'text-brand-700' : 'text-ink-500 hover:text-ink-800'
          }`}>
          {t.icon && <Icon name={t.icon} size={15} />}
          {t.label}
          {t.badge !== undefined && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              active === t.key ? 'bg-brand-100 text-brand-800' : 'bg-ink-100 text-ink-600'
            }`}>{t.badge}</span>
          )}
          {active === t.key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600" />}
        </button>
      ))}
    </div>
  );
}

/* ── Pagination ────────────────────────────────────────────────────────────── */

export function Pagination({ page, pageCount, onPage, total, pageSize }: {
  page: number; pageCount: number; onPage: (p: number) => void; total?: number; pageSize?: number;
}) {
  const pages = useMemo(() => {
    const out: (number | 'gap')[] = [];
    const push = (n: number) => { if (!out.includes(n)) out.push(n); };
    push(1);
    for (let n = page - 1; n <= page + 1; n++) if (n >= 1 && n <= pageCount) push(n);
    if (pageCount > 0) push(pageCount);
    const sorted = (out.filter((n) => typeof n === 'number') as number[]).sort((a, b) => a - b);
    const withGaps: (number | 'gap')[] = [];
    sorted.forEach((n, i) => {
      if (i > 0 && n - sorted[i - 1] > 1) withGaps.push('gap');
      withGaps.push(n);
    });
    return withGaps;
  }, [page, pageCount]);

  if (pageCount <= 1) {
    return total ? <p className="py-2 text-center text-xs text-ink-500">{total} result{total === 1 ? '' : 's'}</p> : null;
  }

  return (
    <nav className="flex flex-wrap items-center justify-center gap-1.5 py-4" aria-label="Pagination">
      <Button variant="outline" size="sm" icon="chevronLeft" onClick={() => onPage(page - 1)} disabled={page <= 1}>
        <span className="sr-only sm:not-sr-only">Prev</span>
      </Button>
      {pages.map((p, i) => p === 'gap'
        ? <span key={`g${i}`} className="px-1 text-ink-400">…</span>
        : (
          <button key={p} type="button" onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined}
            className={`h-9 min-w-9 rounded-xl px-2.5 text-sm font-semibold transition-colors ${
              p === page ? 'bg-brand-600 text-white' : 'border border-ink-300 bg-white text-ink-700 hover:bg-ink-50'
            }`}>
            {p}
          </button>
        ))}
      <Button variant="outline" size="sm" iconRight="chevronRight" onClick={() => onPage(page + 1)} disabled={page >= pageCount}>
        <span className="sr-only sm:not-sr-only">Next</span>
      </Button>
      {total !== undefined && pageSize && (
        <p className="w-full pt-1 text-center text-xs text-ink-500">
          Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
        </p>
      )}
    </nav>
  );
}

/* ── Stat tile ─────────────────────────────────────────────────────────────── */

export function StatTile({ label, value, sub, icon, tone = 'brand', trend, onClick }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: IconName;
  tone?: 'brand' | 'accent' | 'green' | 'amber' | 'red' | 'blue' | 'neutral';
  trend?: { value: number; label?: string }; onClick?: () => void;
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700', accent: 'bg-accent-50 text-accent-700',
    green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700', blue: 'bg-sky-50 text-sky-700',
    neutral: 'bg-ink-100 text-ink-700',
  } as const;

  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`sh-card-flat flex flex-col p-3.5 text-left ${onClick ? 'transition-shadow hover:shadow-card' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="sh-label">{label}</span>
        {icon && (
          <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tones[tone]}`}>
            <Icon name={icon} size={16} />
          </span>
        )}
      </div>
      <span className="mt-2 text-xl font-extrabold tabular-nums text-ink-950 sm:text-2xl">{value}</span>
      {(sub || trend) && (
        <span className="mt-1 flex items-center gap-1.5 text-xs">
          {trend && (
            <span className={`inline-flex items-center gap-0.5 font-bold ${trend.value >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              <Icon name={trend.value >= 0 ? 'arrowUp' : 'arrowDown'} size={12} />
              {Math.abs(trend.value).toFixed(trend.value % 1 === 0 ? 0 : 1)}%
            </span>
          )}
          {sub && <span className="truncate text-ink-500">{sub}</span>}
          {trend?.label && <span className="text-ink-400">{trend.label}</span>}
        </span>
      )}
    </Comp>
  );
}

/* ── Barcode display ───────────────────────────────────────────────────────── */

export function BarcodeImage({ svg, alt, className = '', height = 56 }: { svg?: string | null; alt: string; className?: string; height?: number }) {
  if (!svg) return null;
  return (
    <span
      className={`inline-block overflow-hidden ${className}`}
      style={{ height }}
      // Rendered by bwip-js from our own value, not user HTML.
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
      aria-label={alt}
    />
  );
}

/* ── Empty / denied panels shared by seller screens ────────────────────────── */

export function DeniedPanel({ message }: { message: string }) {
  return (
    <div className="sh-card-flat flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
        <Icon name="lock" size={26} />
      </span>
      <h3 className="text-base font-bold">You do not have access</h3>
      <p className="mt-1.5 max-w-md text-sm text-ink-500">{message}</p>
    </div>
  );
}

/* ── Copy-to-clipboard value ───────────────────────────────────────────────── */

export function CopyValue({ value, label, onCopied }: { value: string; label?: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-ink-200 bg-ink-50 px-2 py-1 text-xs font-medium text-ink-700 hover:border-brand-300 hover:bg-brand-50"
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); } catch { /* ignore */ }
        setCopied(true);
        onCopied?.();
        window.setTimeout(() => setCopied(false), 1600);
      }}
      title={label ?? value}
    >
      <Icon name={copied ? 'check' : 'copy'} size={13} className={copied ? 'text-emerald-600' : ''} />
      <span className="truncate">{label ?? value}</span>
    </button>
  );
}

/* ── Re-export so screens import from one place ────────────────────────────── */

export { Icon, Spinner } from './Icon';
export { Button, Input, Select, Textarea, Switch, Checkbox, Badge, Card, SectionHeader,
         Skeleton, SkeletonCard, SkeletonRows, EmptyState, ErrorState, Notice, Money, formatAmount } from './Primitives';
export { Modal, Sheet, ActionSheet, ConfirmDialog, useConfirm, ToastViewport, Dropdown, BusyOverlay,
         type ActionItem, type ConfirmOptions } from './Overlays';
export { ImageUploader, AvatarUploader, downscaleImage, type UploadedImage } from './ImageUploader';

/** Convenience: which businesses own which UUIDs — used by cross-seller views. */
export function businessKey(id: UUID): string { return String(id); }
