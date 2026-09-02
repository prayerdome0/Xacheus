import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Badge, Button, EmptyState, Input, Notice } from '@/components/ui/Primitives';
import { Avatar, BusinessAvatar, QuantityStepper } from '@/components/ui';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { CURRENCIES, formatMoney, roundMoney, toNum } from '@/lib/currency';
import { computeTotals } from '@/lib/calc';
import { productImage } from '@/lib/format';
import { BRAND } from '@/lib/constants';
import type { UUID } from '@/types';

/**
 * Cart.
 *
 * One basket can hold items from several sellers, and each seller fulfils and
 * invoices their own order — so the cart is presented as groups, and checkout
 * creates one order per business inside a single transaction per group.
 */
export default function CartPage() {
  const { lines, groups, setQuantity, remove, clear, applyCoupon, couponCode, couponDiscount,
          setDelivery, delivery, count } = useCart();
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [applying, setApplying] = useState(false);

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-6">
        <EmptyState
          icon="cart"
          title="Your cart is empty"
          description="Browse the marketplace, add what you need, and it will be waiting here — even if you close the app."
          action={
            <>
              <Link to="/search"><Button size="sm" icon="search">Start shopping</Button></Link>
              <Link to="/deals"><Button size="sm" variant="outline" icon="fire">See today's deals</Button></Link>
            </>
          }
        />
      </div>
    );
  }

  const submitCoupon = async () => {
    setApplying(true);
    const res = await applyCoupon(code);
    setApplying(false);
    if (res.ok) { success('Coupon applied', `You saved ${formatMoney(res.discount)}.`); setCode(''); }
    else toastError('Coupon not applied', res.message);
  };

  const groupSum = groups.reduce((s, g) => s + g.totals.total, 0);
  const grand = roundMoney(Math.max(groupSum - (couponCode ? couponDiscount : 0), 0));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold sm:text-2xl">Your cart</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {count} item{count === 1 ? '' : 's'} from {groups.length} seller{groups.length === 1 ? '' : 's'}
          </p>
        </div>
        <Button variant="ghost" size="sm" icon="trash" className="text-red-600" onClick={clear}>
          Empty cart
        </Button>
      </div>

      {groups.length > 1 && (
        <Notice tone="info" title="Several sellers in one basket" icon="info">
          Each business prepares and invoices its own order, so you will see one confirmation per seller.
          Delivery is arranged separately for each.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.businessId} className="sh-card-flat overflow-hidden">
              <header className="flex items-center gap-2.5 border-b border-ink-100 bg-ink-50/60 px-3.5 py-2.5">
                <BusinessAvatar business={{ name: g.businessName, slug: g.businessSlug }} size={30} showVerified={false} />
                <Link to={`/store/${g.businessSlug}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold hover:text-brand-700">{g.businessName}</p>
                  <p className="truncate text-[11px] text-ink-500">seedwelhub.com/store/{g.businessSlug}</p>
                </Link>
                <Badge tone="neutral">{g.lines.length} line{g.lines.length === 1 ? '' : 's'}</Badge>
              </header>

              <ul className="divide-y divide-ink-100">
                {g.lines.map((line) => {
                  const img = line.image_url ?? productImage(line.product);
                  const maxStock = line.product?.track_inventory && !line.product.allow_backorder
                    ? Math.max(1, Math.round(toNum(line.product.stock)))
                    : undefined;
                  return (
                    <li key={line.key} className="flex gap-3 p-3.5">
                      <Link to={`/product/${line.product?.slug ?? line.product_id}`} className="shrink-0">
                        {img
                          ? <img src={img} alt="" className="h-20 w-20 rounded-xl border border-ink-200 object-cover" loading="lazy" />
                          : <span className="flex h-20 w-20 items-center justify-center rounded-xl bg-ink-100 text-2xl">📦</span>}
                      </Link>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <Link to={`/product/${line.product?.slug ?? line.product_id}`}
                            className="line-clamp-2 text-sm font-bold leading-snug hover:text-brand-700">
                            {line.name}
                          </Link>
                          <button type="button" onClick={() => remove(line.key)}
                            className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"
                            aria-label={`Remove ${line.name}`}>
                            <Icon name="trash" size={16} />
                          </button>
                        </div>

                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-500">
                          {line.sku && <span>SKU {line.sku}</span>}
                          {line.product?.brand && <span>· {line.product.brand}</span>}
                          {line.unit && <span>· per {line.unit}</span>}
                          {line.is_wholesale && <Badge tone="accent">Wholesale price</Badge>}
                          {line.product?.track_inventory && maxStock !== undefined && line.quantity > maxStock && (
                            <Badge tone="red">Only {maxStock} in stock</Badge>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <QuantityStepper
                            size="sm" value={line.quantity} max={maxStock}
                            min={Math.max(1, line.product?.min_purchase_qty ?? 1)}
                            onChange={(n) => setQuantity(line.key, n)}
                            label={`Quantity of ${line.name}`}
                          />
                          <div className="text-right">
                            <p className="sh-money text-sm font-extrabold">
                              {formatMoney(roundMoney(line.unit_price * line.quantity), line.product?.currency ?? 'ZMW')}
                            </p>
                            <p className="text-[11px] text-ink-500">
                              {formatMoney(line.unit_price, line.product?.currency ?? 'ZMW')} each
                            </p>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <footer className="space-y-2 border-t border-ink-100 bg-ink-50/40 p-3.5">
                {/* Fulfilment choice per seller */}
                <div className="flex flex-wrap gap-2">
                  <FulfilButton
                    active={(delivery[g.businessId]?.method ?? 'pickup') === 'pickup'}
                    icon="store" label="Collect from store"
                    onClick={() => setDelivery(g.businessId, 'pickup', 0)}
                  />
                  <FulfilButton
                    active={delivery[g.businessId]?.method === 'delivery'}
                    icon="truck"
                    label={deliveryFeeFor(g) > 0 ? `Delivery · ${formatMoney(deliveryFeeFor(g))}` : 'Delivery'}
                    onClick={() => setDelivery(g.businessId, 'delivery', deliveryFeeFor(g))}
                  />
                </div>

                <dl className="space-y-1 text-sm">
                  <Row label="Subtotal" value={formatMoney(g.totals.subtotal)} />
                  {g.totals.discount > 0 && <Row label="Line discounts" value={`− ${formatMoney(g.totals.discount)}`} tone="text-emerald-600" />}
                  {g.totals.tax > 0 && <Row label="Tax" value={formatMoney(g.totals.tax)} />}
                  {g.totals.delivery > 0 && <Row label="Delivery" value={formatMoney(g.totals.delivery)} />}
                  <div className="flex items-center justify-between border-t border-ink-200 pt-1.5">
                    <dt className="text-sm font-extrabold">Group total</dt>
                    <dd className="sh-money text-base font-extrabold">{formatMoney(g.totals.total)}</dd>
                  </div>
                </dl>
              </footer>
            </section>
          ))}

          <Link to="/search" className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-700 hover:underline">
            <Icon name="arrowLeft" size={16} /> Continue shopping
          </Link>
        </div>

        {/* Summary */}
        <aside className="space-y-3 lg:sticky lg:top-32 lg:self-start">
          <div className="sh-card p-4">
            <h2 className="text-sm font-extrabold">Order summary</h2>

            <div className="mt-3 space-y-2">
              <label className="sh-field-label" htmlFor="coupon">Coupon code</label>
              <div className="flex gap-2">
                <Input id="coupon" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. WELCOME10" className="flex-1" />
                <Button variant="outline" size="md" loading={applying} onClick={() => void submitCoupon()}>Apply</Button>
              </div>
              {couponCode && (
                <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                  <Icon name="check" size={13} /> {couponCode} applied — you save {formatMoney(couponDiscount)}
                </p>
              )}
            </div>

            <dl className="mt-4 space-y-1.5 border-t border-ink-100 pt-3 text-sm">
              <Row label={`Subtotal (${count} items)`} value={formatMoney(groups.reduce((s, g) => s + g.totals.subtotal, 0))} />
              {groups.some((g) => g.totals.discount > 0) && (
                <Row label="Discounts" value={`− ${formatMoney(groups.reduce((s, g) => s + g.totals.discount, 0))}`} tone="text-emerald-600" />
              )}
              {couponDiscount > 0 && <Row label={`Coupon ${couponCode}`} value={`− ${formatMoney(couponDiscount)}`} tone="text-emerald-600" />}
              {groups.some((g) => g.totals.tax > 0) && (
                <Row label="Tax" value={formatMoney(groups.reduce((s, g) => s + g.totals.tax, 0))} />
              )}
              {groups.some((g) => g.totals.delivery > 0) && (
                <Row label="Delivery" value={formatMoney(groups.reduce((s, g) => s + g.totals.delivery, 0))} />
              )}
              <div className="flex items-center justify-between border-t border-ink-200 pt-2">
                <dt className="text-base font-extrabold">Total</dt>
                <dd className="sh-money text-xl font-extrabold">{formatMoney(grand)}</dd>
              </div>
            </dl>

            <Button size="lg" block className="mt-4" icon="wallet"
              onClick={() => navigate(user ? '/checkout' : `/auth/signin?next=${encodeURIComponent('/checkout')}`)}>
              {user ? 'Proceed to checkout' : 'Sign in to checkout'}
            </Button>

            <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-500">
              <Icon name="shield" size={13} className="mt-0.5 shrink-0 text-brand-600" />
              Stock is reserved when the order is placed. Pay by cash, mobile money, bank transfer or card —
              you receive a receipt for every payment.
            </p>
          </div>

          <div className="sh-card-flat divide-y divide-ink-100">
            <Trust icon="truck" text="Delivery or collection — you choose per seller" />
            <Trust icon="wallet" text="Cash, Airtel Money, MTN MoMo, Zamtel Kwacha, bank or card" />
            <Trust icon="refresh" text="Returns handled through your order history" />
            <Trust icon="shield" text={`Buyer protection by ${BRAND.company}`} />
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * Delivery fee advertised by the seller's business row.
 *
 * The cart line carries a copy of the product, which carries the seller — that
 * is the only place the buyer-side code can read the fee from without an extra
 * query. create_order() re-reads it server-side and applies free_delivery_over,
 * so this value is a preview only.
 */
function deliveryFeeFor(g: { lines: { product?: { business?: { delivery_fee?: number | string | null } } | null }[] }): number {
  return toNum(g.lines[0]?.product?.business?.delivery_fee ?? 0);
}

function Row({ label, value, tone = 'text-ink-900' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-600">{label}</dt>
      <dd className={`sh-money font-bold ${tone}`}>{value}</dd>
    </div>
  );
}

function FulfilButton({ active, icon, label, onClick }: {
  active: boolean; icon: 'store' | 'truck'; label: string; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${
        active ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-ink-300 text-ink-600 hover:border-ink-400'
      }`}>
      <Icon name={icon} size={15} /> {label}
    </button>
  );
}

function Trust({ icon, text }: { icon: 'truck' | 'wallet' | 'refresh' | 'shield'; text: string }) {
  return (
    <div className="flex items-start gap-2.5 p-3">
      <Icon name={icon} size={16} className="mt-0.5 shrink-0 text-brand-600" />
      <p className="text-xs leading-relaxed text-ink-600">{text}</p>
    </div>
  );
}

/* ── Checkout ──────────────────────────────────────────────────────────────── */

export { CheckoutPage };

function CheckoutPage() {
  const { user } = useAuth();
  const { groups, lines, couponCode, delivery, clearBusiness, clear } = useCart();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<{ business: string; number: string; total: number; currency: string; id: UUID }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: (user?.user_metadata?.display_name ?? user?.user_metadata?.full_name ?? '') as string,
    phone: (user?.user_metadata?.phone ?? '') as string,
    email: user?.email ?? '',
    line1: '', line2: '', city: '', region: '', postal: '', country: 'ZM',
    notes: '',
    method: 'mobile_money' as 'cash' | 'mobile_money' | 'card' | 'bank_transfer',
    provider: 'Airtel Money',
    reference: '',
    payNow: false,
  });

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const grand = roundMoney(groups.reduce((s, g) => s + g.totals.total, 0));

  const validate = (): string | null => {
    if (!form.name.trim()) return 'Enter the name for this order.';
    if (!/^[+\d][\d\s-]{6,}$/.test(form.phone.trim())) return 'Enter a phone number sellers can reach you on.';
    if (groups.some((g) => (delivery[g.businessId]?.method ?? 'pickup') === 'delivery')) {
      if (!form.line1.trim()) return 'Enter a delivery address.';
      if (!form.city.trim()) return 'Enter the city or town for delivery.';
    }
    if (form.method === 'bank_transfer' && form.payNow && !form.reference.trim()) {
      return 'Add your bank reference so the seller can match the payment.';
    }
    return null;
  };

  const placeOrders = async () => {
    const problem = validate();
    if (problem) { setError(problem); setStep(2); return; }
    setError(null);
    setBusy(true);

    const { createOrder } = await import('@/lib/api');
    const results: typeof placed = [];

    try {
      for (const group of groups) {
        const method = delivery[group.businessId]?.method ?? 'pickup';
        const res = await createOrder({
          business_id: group.businessId,
          channel: 'marketplace',
          buyer_user_id: user?.id ?? null,
          customer: {
            name: form.name.trim(),
            phone: form.phone.trim(),
            email: form.email.trim() || undefined,
            city: form.city.trim() || undefined,
            country_code: form.country,
          },
          items: group.lines.map((l) => ({
            product_id: l.product_id ?? null,
            variant_id: l.variant_id ?? null,
            quantity: l.quantity,
            unit_price: l.unit_price,
            unit: l.unit,
            tax_rate: l.tax_rate ?? 0,
            name: l.name,
            sku: l.sku,
            image_url: l.image_url,
          })),
          currency: group.lines[0]?.product?.currency ?? 'ZMW',
          delivery_method: method === 'delivery' ? 'delivery' : 'pickup',
          delivery_fee: method === 'delivery' ? delivery[group.businessId]?.fee ?? 0 : 0,
          coupon_code: couponCode ?? null,
          shipping_name: form.name.trim(),
          shipping_phone: form.phone.trim(),
          shipping_line1: form.line1.trim() || undefined,
          shipping_line2: form.line2.trim() || undefined,
          shipping_city: form.city.trim() || undefined,
          shipping_region: form.region.trim() || undefined,
          shipping_postal_code: form.postal.trim() || undefined,
          shipping_country: form.country,
          customer_note: form.notes.trim() || undefined,
        });

        results.push({
          business: group.businessName,
          number: res.order_number,
          total: Number(res.total),
          currency: res.currency,
          id: res.order_id,
        });

        // Record the payment when the buyer chose to pay immediately online.
        if (form.payNow && res.total > 0) {
          const { recordPayment } = await import('@/lib/api');
          try {
            await recordPayment({
              business_id: group.businessId,
              order_id: res.order_id,
              amount: Number(res.total),
              method: form.method,
              direction: 'inbound',
              currency: res.currency,
              reference: form.reference.trim() || undefined,
              provider: form.method === 'mobile_money' ? form.provider : undefined,
              notes: `Online checkout · ${res.order_number}`,
              generate_receipt: true,
            });
          } catch (payErr) {
            // The order exists; the payment did not. Be explicit about that
            // rather than pretending the money arrived.
            const detail = payErr instanceof Error
                ? payErr.message.replace(/^.*?exception:\s*/i, '')
                : 'unknown error';
            setError(`Order ${res.order_number} was placed, but the payment could not be recorded (${detail}). `
              + 'Pay the seller directly or retry from My orders.');
            toastError('Payment not recorded', detail);
          }
        }

        clearBusiness(group.businessId);
      }

      setPlaced(results);
      if (lines.length === groups.reduce((s, g) => s + g.lines.length, 0)) clear();
      success('Order placed', results.length === 1
        ? `Order ${results[0].number} confirmed.`
        : `${results.length} orders confirmed.`);
      setStep(3);
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Checkout failed.';
      if (results.length > 0) {
        setPlaced(results);
        setError(`Some orders were placed before this failure: ${msg}`);
        setStep(3);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  if (lines.length === 0 && placed.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-6">
        <EmptyState icon="cart" title="Nothing to check out"
          description="Add products to your cart first."
          action={<Link to="/search"><Button size="sm" icon="search">Browse the marketplace</Button></Link>} />
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-4">
        <div className="sh-card p-6 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <Icon name="check" size={32} />
          </span>
          <h1 className="mt-4 text-xl font-extrabold sm:text-2xl">
            {placed.length === 1 ? 'Order confirmed' : `${placed.length} orders confirmed`}
          </h1>
          <p className="mt-1.5 text-sm text-ink-600">
            The {placed.length === 1 ? 'seller has' : 'sellers have'} been notified. You can track status, message the
            seller and download receipts from My orders.
          </p>
        </div>

        {error && <Notice tone="warning" title="Payment not recorded">{error}</Notice>}

        <ul className="space-y-2">
          {placed.map((p) => (
            <li key={p.id}>
              <Link to={`/orders/${p.id}`} className="sh-card-flat flex items-center gap-3 p-3.5 hover:shadow-card">
                <Avatar name={p.business} size={40} rounded="xl" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{p.business}</p>
                  <p className="text-xs text-ink-500">Order {p.number}</p>
                </div>
                <p className="sh-money shrink-0 text-sm font-extrabold">{formatMoney(p.total, p.currency)}</p>
                <Icon name="chevronRight" size={17} className="shrink-0 text-ink-400" />
              </Link>
            </li>
          ))}
        </ul>

        <div className="grid gap-2 sm:grid-cols-3">
          {placed.length === 1 && (
            <Button block icon="receipt" onClick={() => navigate(`/orders/${placed[0].id}`)}>Open the order</Button>
          )}
          <Link to="/orders"><Button block variant={placed.length === 1 ? 'outline' : undefined} icon="wallet">
            Track my orders
          </Button></Link>
          <Link to="/search"><Button block variant="outline" icon="search">Continue shopping</Button></Link>
        </div>
      </div>
    );
  }

  const needsAddress = groups.some((g) => (delivery[g.businessId]?.method ?? 'pickup') === 'delivery');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold sm:text-2xl">Checkout</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Step {step} of 2 · {groups.length} seller{groups.length === 1 ? '' : 's'} · {lines.length} line{lines.length === 1 ? '' : 's'}
          </p>
        </div>
        <Link to="/cart"><Button variant="ghost" size="sm" icon="arrowLeft">Back to cart</Button></Link>
      </div>

      {/* Stepper */}
      <ol className="flex items-center gap-2 text-xs font-bold">
        {[['1', 'Details'], ['2', 'Payment']].map(([n, label], i) => (
          <li key={n} className="flex flex-1 items-center gap-2">
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] ${
              step > i ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-600'
            }`}>{n}</span>
            <span className={step > i ? 'text-brand-700' : 'text-ink-500'}>{label}</span>
            {i === 0 && <span className="h-px flex-1 bg-ink-200" />}
          </li>
        ))}
      </ol>

      {error && <Notice tone="danger" title="Could not complete checkout">{error}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="sh-card space-y-4 p-4">
          {step === 1 && (
            <>
              <h2 className="text-sm font-extrabold">Contact & delivery</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Full name" required value={form.name} onChange={(e) => set({ name: e.target.value })} />
                <Input label="Phone" required type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })}
                  placeholder="097 123 4567" />
              </div>
              <Input label="Email (for receipts)" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />

              {needsAddress ? (
                <div className="space-y-3 border-t border-ink-100 pt-4">
                  <h3 className="text-sm font-extrabold">Delivery address</h3>
                  <Input label="Address line 1" required value={form.line1} onChange={(e) => set({ line1: e.target.value })}
                    placeholder="Plot 123, Leopards Hill Road" />
                  <Input label="Address line 2" value={form.line2} onChange={(e) => set({ line2: e.target.value })}
                    placeholder="Apartment, landmark" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label="City / town" required value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="Lusaka" />
                    <Input label="Province / region" value={form.region} onChange={(e) => set({ region: e.target.value })} placeholder="Lusaka Province" />
                    <Input label="Postal code" value={form.postal} onChange={(e) => set({ postal: e.target.value })} />
                    <Input label="Country" value={form.country} onChange={(e) => set({ country: e.target.value })} />
                  </div>
                </div>
              ) : (
                <Notice tone="brand" title="Collecting from the store" icon="store">
                  You chose collection, so no delivery address is needed. The seller will confirm when your order is ready.
                </Notice>
              )}

              <Input label="Note for the seller (optional)" value={form.notes} onChange={(e) => set({ notes: e.target.value })}
                placeholder="Deliver after 17:00, call on arrival" />

              <div className="flex justify-end gap-2 border-t border-ink-100 pt-4">
                <Button size="lg" iconRight="arrowRight" onClick={() => setStep(2)}>Continue to payment</Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-sm font-extrabold">How would you like to pay?</h2>

              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ['mobile_money', 'Mobile money', '📱', 'Airtel Money, MTN MoMo, Zamtel Kwacha'],
                  ['cash', 'Cash on collection / delivery', '💵', 'Pay the seller directly'],
                  ['bank_transfer', 'Bank transfer', '🏦', 'Get the seller’s account details'],
                  ['card', 'Card', '💳', 'Visa / Mastercard'],
                ] as const).map(([key, label, emoji, hint]) => (
                  <button key={key} type="button" onClick={() => set({ method: key })}
                    aria-pressed={form.method === key}
                    className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                      form.method === key ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-200' : 'border-ink-200 hover:border-ink-300'
                    }`}>
                    <span className="text-xl leading-none" aria-hidden="true">{emoji}</span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-bold">{label}</span>
                      <span className="block text-[11px] leading-snug text-ink-500">{hint}</span>
                    </span>
                    {form.method === key && <Icon name="check" size={15} className="ml-auto shrink-0 text-brand-600" />}
                  </button>
                ))}
              </div>

              {form.method === 'mobile_money' && (
                <div className="space-y-3 rounded-xl border border-ink-200 p-3">
                  <div>
                    <p className="sh-field-label">Provider</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['Airtel Money', 'MTN MoMo', 'Zamtel Kwacha', 'Orange Money', 'M-Pesa'].map((p) => (
                        <button key={p} type="button" onClick={() => set({ provider: p })}
                          className={`sh-pill ${form.provider === p ? 'sh-pill-brand' : 'sh-pill-neutral hover:bg-ink-200'}`}>
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Input label="Reference (optional)" value={form.reference} onChange={(e) => set({ reference: e.target.value })}
                    placeholder="Transaction ID once you have paid" hint="The seller confirms the payment and your receipt is generated." />
                </div>
              )}

              {form.method === 'bank_transfer' && (
                <Notice tone="info" title="Bank transfer" icon="bank">
                  After you place the order, the seller’s bank details appear on the order page and on the invoice PDF.
                  Add your name as the reference so the payment can be matched.
                </Notice>
              )}

              {form.method === 'cash' && (
                <Notice tone="info" title="Cash payment" icon="cash">
                  Pay the seller when you collect or when the order arrives. They will record the payment and issue a receipt.
                </Notice>
              )}

              {form.method === 'card' && (
                <Notice tone="warning" title="Card payments need a gateway" icon="card">
                  Card acceptance is enabled per plan once the business connects a payment provider. Until then choose
                  mobile money, bank transfer or cash — the order still records correctly.
                </Notice>
              )}

              <label className="flex items-start gap-2.5 rounded-xl bg-ink-50 p-3">
                <input type="checkbox" checked={form.payNow} onChange={(e) => set({ payNow: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600" />
                <span className="text-[13px] text-ink-700">
                  <span className="block font-bold">I have paid / will pay immediately</span>
                  Records the payment now and generates your receipt. Leave unticked to pay the seller later.
                </span>
              </label>

              <div className="flex justify-between gap-2 border-t border-ink-100 pt-4">
                <Button variant="outline" size="lg" icon="arrowLeft" onClick={() => setStep(1)}>Back</Button>
                <Button size="lg" icon="check" loading={busy} onClick={() => void placeOrders()}>
                  Place {groups.length > 1 ? `${groups.length} orders` : 'order'} · {formatMoney(grand)}
                </Button>
              </div>
            </>
          )}
        </div>

        <aside className="sh-card h-fit p-4 lg:sticky lg:top-32">
          <h2 className="text-sm font-extrabold">Summary</h2>
          <ul className="mt-3 space-y-3">
            {groups.map((g) => (
              <li key={g.businessId} className="border-b border-ink-100 pb-3 last:border-0 last:pb-0">
                <p className="truncate text-xs font-bold text-ink-800">{g.businessName}</p>
                <ul className="mt-1 space-y-1">
                  {g.lines.map((l) => (
                    <li key={l.key} className="flex items-start justify-between gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-ink-600">
                        {l.quantity} × {l.name}
                      </span>
                      <span className="sh-money shrink-0 font-semibold">
                        {formatMoney(roundMoney(l.unit_price * l.quantity), l.product?.currency ?? 'ZMW')}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 flex justify-between text-xs">
                  <span className="text-ink-500">
                    {(delivery[g.businessId]?.method ?? 'pickup') === 'delivery' ? 'Delivery' : 'Collection'}
                  </span>
                  <span className="sh-money font-bold">{formatMoney(g.totals.total, g.lines[0]?.product?.currency ?? 'ZMW')}</span>
                </p>
              </li>
            ))}
          </ul>

          <dl className="mt-3 space-y-1.5 border-t border-ink-200 pt-3 text-sm">
            {couponCode && (
              <div className="flex justify-between text-xs text-emerald-700">
                <dt>Coupon {couponCode}</dt><dd className="font-bold">applied</dd>
              </div>
            )}
            <div className="flex items-center justify-between">
              <dt className="text-base font-extrabold">Total</dt>
              <dd className="sh-money text-lg font-extrabold">{formatMoney(grand)}</dd>
            </div>
          </dl>

          <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
            Prices are in {CURRENCIES[lines[0]?.product?.currency ?? 'ZMW']?.name ?? 'Zambian Kwacha'}. By placing this
            order you agree to the seller’s terms and the {BRAND.name} buyer policy.
          </p>
        </aside>
      </div>
    </div>
  );
}

/** Order totals preview helper reused by POS: same math, different surface. */
export function previewGroupTotals(groups: ReturnType<typeof computeTotals>[]) {
  return roundMoney(groups.reduce((s, g) => s + g.total, 0));
}
