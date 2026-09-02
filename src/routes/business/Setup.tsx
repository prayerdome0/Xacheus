import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Badge, Button, Checkbox, Input, Notice, Select, Switch, Textarea } from '@/components/ui/Primitives';
import { AvatarUploader, ImageUploader, type UploadedImage } from '@/components/ui/ImageUploader';
import { useAuth } from '@/context/AuthContext';
import { useBusiness } from '@/context/BusinessContext';
import { useToast } from '@/context/ToastContext';
import { useCategories } from '@/hooks/useCategories';
import { BUCKETS } from '@/lib/supabase';
import { createBusiness, isSlugAvailable, suggestSlug } from '@/lib/api';
import { slugify, isReservedSlug, isValidSlug, normalisePhone } from '@/lib/slug';
import { BRAND, BUSINESS_TYPES, COUNTRY_LABELS, DAYS, DAY_LABELS } from '@/lib/constants';
import { displayName } from '@/lib/format';
import type { UUID } from '@/types';

/**
 * Create your business + automatic online store.
 *
 * One RPC (create_business) creates, inside a single transaction: the business
 * row, its store at /store/<slug>, the default branch, the default warehouse,
 * the default VAT tax row, the owner membership and a trial subscription.
 * The client only collects the details — it never writes those rows itself.
 */

const STEPS = [
  { n: 1, title: 'Basics', hint: 'What do you trade as?' },
  { n: 2, title: 'Where & how', hint: 'Contact, location, hours' },
  { n: 3, title: 'Your store', hint: 'Address, colours, selling rules' },
  { n: 4, title: 'Confirm', hint: 'Check and create' },
];

export default function BusinessSetupPage() {
  const { user, profile, addRole } = useAuth();
  const { businesses, refresh, setActiveBusinessId } = useBusiness();
  const { success, error: toastError } = useToast();
  const { topLevel } = useCategories('both');
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugState, setSlugState] = useState<{ status: 'idle' | 'checking' | 'free' | 'taken' | 'invalid'; message?: string }>({ status: 'idle' });

  const [logo, setLogo] = useState<UploadedImage | null>(null);
  const [cover, setCover] = useState<UploadedImage | null>(null);

  const [form, setForm] = useState({
    name: profile?.headline ?? '',
    slug: '',
    slugTouched: false,
    tagline: '',
    description: '',
    business_type: 'sole_proprietorship',
    category_id: '' as UUID | '',
    legal_name: '',
    registration_number: '',
    tax_number: '',
    tax_registered: false,
    phone: profile?.phone ?? '',
    phone_country_code: profile?.phone_country_code ?? '+260',
    whatsapp: '',
    email: profile?.email ?? '',
    website: '',
    address_line1: '',
    address_line2: '',
    city: 'Lusaka',
    region: 'Lusaka Province',
    country_code: profile?.country_code ?? 'ZM',
    base_currency: 'ZMW',
    primary_color: '#0f766e',
    accent_color: '#f59e0b',
    accepts_orders: true,
    delivery_enabled: false,
    delivery_fee: 0,
    free_delivery_over: '',
    accepts_wholesale: false,
    opening_hours: defaultHours(),
    is_public: true,
  });

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // Already have a business? Send the owner straight to the dashboard.
  useEffect(() => {
    if (businesses.length > 0) navigate('/business', { replace: true });
  }, [businesses.length, navigate]);

  // Suggest a slug from the trading name until the seller edits it manually.
  useEffect(() => {
    if (form.slugTouched || !form.name.trim()) return;
    const t = window.setTimeout(async () => {
      try {
        const suggested = await suggestSlug(form.name.trim());
        setForm((f) => (f.slugTouched ? f : { ...f, slug: suggested }));
        setSlugState({ status: 'free' });
      } catch {
        setForm((f) => (f.slugTouched ? f : { ...f, slug: slugify(f.name) }));
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [form.name, form.slugTouched]);

  const checkSlug = async (value: string) => {
    const slug = value.trim().toLowerCase();
    if (!slug) { setSlugState({ status: 'idle' }); return; }
    if (isReservedSlug(slug)) {
      setSlugState({ status: 'invalid', message: `“${slug}” is reserved by ${BRAND.name}.` });
      return;
    }
    if (!isValidSlug(slug)) {
      setSlugState({ status: 'invalid', message: 'Use lowercase letters, numbers and single dashes.' });
      return;
    }
    setSlugState({ status: 'checking' });
    try {
      const free = await isSlugAvailable(slug);
      setSlugState(free
        ? { status: 'free', message: `seedwelhub.com/store/${slug} is available.` }
        : { status: 'taken', message: `seedwelhub.com/store/${slug} is taken. Try ${slug}-zm or ${slug}shop.` });
    } catch {
      setSlugState({ status: 'idle' });
    }
  };

  useEffect(() => {
    if (!form.slug) return;
    const t = window.setTimeout(() => void checkSlug(form.slug), 500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.slug]);

  const canContinue = useMemo(() => {
    if (step === 1) return form.name.trim().length >= 2 && Boolean(form.business_type);
    if (step === 2) return Boolean(form.phone.trim() || form.email.trim());
    if (step === 3) return slugState.status === 'free';
    return true;
  }, [step, form, slugState.status]);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await createBusiness({
        name: form.name.trim(),
        slug: form.slug.trim().toLowerCase(),
        tagline: form.tagline.trim() || undefined,
        description: form.description.trim() || undefined,
        business_type: form.business_type,
        category_id: form.category_id || undefined,
        legal_name: form.legal_name.trim() || undefined,
        registration_number: form.registration_number.trim() || undefined,
        tax_number: form.tax_number.trim() || undefined,
        tax_registered: form.tax_registered,
        phone: form.phone ? normalisePhone(form.phone, form.phone_country_code) : undefined,
        phone_country_code: form.phone_country_code,
        whatsapp: form.whatsapp ? normalisePhone(form.whatsapp, form.phone_country_code) : undefined,
        email: form.email.trim() || undefined,
        website: form.website.trim() || undefined,
        address_line1: form.address_line1.trim() || undefined,
        address_line2: form.address_line2.trim() || undefined,
        city: form.city.trim() || undefined,
        region: form.region.trim() || undefined,
        country_code: form.country_code,
        base_currency: form.base_currency,
        primary_color: form.primary_color,
        accent_color: form.accent_color,
        logo_url: logo?.url,
        cover_url: cover?.url,
        accepts_orders: form.accepts_orders,
        delivery_enabled: form.delivery_enabled,
        delivery_fee: Number(form.delivery_fee) || 0,
        free_delivery_over: form.free_delivery_over ? Number(form.free_delivery_over) : undefined,
        accepts_wholesale: form.accepts_wholesale,
        opening_hours: form.opening_hours,
        is_public: form.is_public,
      });

      await addRole('seller');
      await refresh();
      setActiveBusinessId(res.business_id);
      success('Your store is live', `${BRAND.domain}/store/${res.slug}`);
      navigate('/business?onboarded=1', { replace: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Could not create the business.';
      setError(msg);
      toastError('Could not create your business', msg);
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-extrabold sm:text-3xl">Create your business</h1>
        <p className="mt-1.5 text-sm text-ink-600">
          Your online store, catalogue, invoices and stock system — set up in about two minutes.
          Free to start; no card required.
        </p>
      </div>

      {/* Stepper */}
      <ol className="sh-card-flat flex items-center gap-1 overflow-x-auto p-2 sh-no-scrollbar">
        {STEPS.map((s) => (
          <li key={s.n} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => s.n < step && setStep(s.n)}
              disabled={s.n > step}
              className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
                step === s.n ? 'bg-brand-50' : s.n < step ? 'hover:bg-ink-50' : 'opacity-45'
              }`}
            >
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${
                step > s.n ? 'bg-emerald-500 text-white' : step === s.n ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-600'
              }`}>
                {step > s.n ? <Icon name="check" size={13} /> : s.n}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-bold">{s.title}</span>
                <span className="hidden truncate text-[11px] text-ink-500 sm:block">{s.hint}</span>
              </span>
            </button>
            {s.n < STEPS.length && <span className="hidden h-px w-4 shrink-0 bg-ink-200 sm:block" />}
          </li>
        ))}
      </ol>

      {error && <Notice tone="danger" title="Could not create your business">{error}</Notice>}

      <div className="sh-card p-4 sm:p-6">
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-base font-extrabold">What do you trade as?</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <AvatarUploader
                bucket={BUCKETS.businesses}
                scope="logos"
                value={logo}
                onChange={setLogo}
                size={84}
                rounded="xl"
                label="Business logo"
              />
              <div>
                <ImageUploader
                  bucket={BUCKETS.businesses}
                  scope="covers"
                  value={cover}
                  onChange={setCover}
                  aspect="wide"
                  label="Cover photo"
                  hint="Shown at the top of your store page"
                />
              </div>
            </div>

            <Input label="Business name" required value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. Lusaka Fresh Produce" autoFocus
              hint="This is what buyers see. You can add a legal name for invoices below." />

            <Input label="Legal / registered name (for invoices)" value={form.legal_name}
              onChange={(e) => set({ legal_name: e.target.value })} placeholder="Lusaka Fresh Produce Ltd" />

            <Select label="Business type" required value={form.business_type}
              onChange={(e) => set({ business_type: e.target.value })}
              options={Object.entries(BUSINESS_TYPES).map(([value, label]) => ({ value, label }))} />

            <Select label="Main category" placeholder="Choose the closest match" value={String(form.category_id)}
              onChange={(e) => set({ category_id: e.target.value as UUID })}
              options={topLevel.map((c) => ({ value: c.id, label: `${c.icon ?? ''} ${c.name}`.trim() }))} />

            <Input label="Tagline" value={form.tagline} onChange={(e) => set({ tagline: e.target.value })}
              placeholder="Farm-fresh vegetables delivered in Lusaka" maxLength={120} />

            <Textarea label="Describe your business" rows={4} value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="What you sell, who you serve, what makes you different. Buyers read this on your store page." />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-base font-extrabold">How customers reach you</h2>

            <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
              <Select label="Code" value={form.phone_country_code}
                onChange={(e) => set({ phone_country_code: e.target.value })}
                options={['+260', '+27', '+267', '+265', '+255', '+254', '+44', '+1'].map((c) => ({ value: c, label: c }))} />
              <Input label="Business phone" type="tel" value={form.phone}
                onChange={(e) => set({ phone: e.target.value })} placeholder="97 123 4567" />
            </div>

            <Input label="WhatsApp number (for orders, quotes and receipts)" type="tel" value={form.whatsapp}
              onChange={(e) => set({ whatsapp: e.target.value })}
              hint="Leave blank to use the business phone. Buyers get a WhatsApp button on your store." />

            <Input label="Business email" type="email" value={form.email}
              onChange={(e) => set({ email: e.target.value })} placeholder="sales@yourbusiness.com" />

            <Input label="Website (optional)" value={form.website}
              onChange={(e) => set({ website: e.target.value })} placeholder="https://yourbusiness.com" />

            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Street address" value={form.address_line1}
                onChange={(e) => set({ address_line1: e.target.value })} placeholder="Plot 123, Leopards Hill Road" />
              <Input label="Address line 2" value={form.address_line2}
                onChange={(e) => set({ address_line2: e.target.value })} />
              <Input label="City / town" value={form.city} onChange={(e) => set({ city: e.target.value })} />
              <Input label="Province / region" value={form.region} onChange={(e) => set({ region: e.target.value })} />
              <Select label="Country" value={form.country_code} onChange={(e) => set({ country_code: e.target.value })}
                options={Object.entries(COUNTRY_LABELS).map(([value, label]) => ({ value, label }))} />
              <Select label="Base currency" value={form.base_currency} onChange={(e) => set({ base_currency: e.target.value })}
                options={['ZMW', 'USD', 'ZAR', 'BWP', 'MWK', 'TZS', 'KES', 'GBP', 'EUR'].map((c) => ({ value: c, label: c }))}
                hint="You can still invoice in other currencies per document." />
            </div>

            <div className="rounded-2xl border border-ink-200 p-3">
              <p className="sh-field-label">Opening hours</p>
              <ul className="space-y-1.5">
                {DAYS.map((d) => {
                  const h = form.opening_hours[d] ?? { open: '08:00', close: '17:00', closed: false };
                  return (
                    <li key={d} className="flex flex-wrap items-center gap-2">
                      <span className="w-24 shrink-0 text-[13px] font-semibold text-ink-700">{DAY_LABELS[d]}</span>
                      <input type="time" value={h.closed ? '' : (h.open ?? '08:00')}
                        disabled={h.closed}
                        onChange={(e) => setHours(form.opening_hours, d, { ...h, open: e.target.value }, set)}
                        className="sh-input sh-input-sm w-28" aria-label={`${DAY_LABELS[d]} opening time`} />
                      <span className="text-ink-400">–</span>
                      <input type="time" value={h.closed ? '' : (h.close ?? '17:00')}
                        disabled={h.closed}
                        onChange={(e) => setHours(form.opening_hours, d, { ...h, close: e.target.value }, set)}
                        className="sh-input sh-input-sm w-28" aria-label={`${DAY_LABELS[d]} closing time`} />
                      <label className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-ink-600">
                        <input type="checkbox" checked={Boolean(h.closed)}
                          onChange={(e) => setHours(form.opening_hours, d, { ...h, closed: e.target.checked }, set)}
                          className="h-4 w-4 rounded border-ink-300 text-brand-600" />
                        Closed
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-base font-extrabold">Your online store</h2>

            <div>
              <Input label="Store address" required
                lead={<span className="text-xs font-semibold text-ink-500">/store/</span>}
                value={form.slug}
                onChange={(e) => { set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'), slugTouched: true }); }}
                error={slugState.status === 'taken' || slugState.status === 'invalid' ? slugState.message : null}
                hint={slugState.status === 'checking' ? 'Checking availability…' : slugState.message}
                placeholder="lusaka-fresh-produce"
              />
              {slugState.status === 'free' && (
                <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                  <Icon name="check" size={13} /> {BRAND.domain}/store/{form.slug} is yours
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="sh-field-label">Brand colour</p>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.primary_color} onChange={(e) => set({ primary_color: e.target.value })}
                    className="h-11 w-14 cursor-pointer rounded-xl border border-ink-300 bg-white p-1" aria-label="Brand colour" />
                  <Input value={form.primary_color} onChange={(e) => set({ primary_color: e.target.value })} />
                </div>
                <p className="sh-hint">Used on your store header, invoices and receipts.</p>
              </div>
              <div>
                <p className="sh-field-label">Accent colour</p>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.accent_color} onChange={(e) => set({ accent_color: e.target.value })}
                    className="h-11 w-14 cursor-pointer rounded-xl border border-ink-300 bg-white p-1" aria-label="Accent colour" />
                  <Input value={form.accent_color} onChange={(e) => set({ accent_color: e.target.value })} />
                </div>
                <p className="sh-hint">Buttons, prices and highlights.</p>
              </div>
            </div>

            <div className="rounded-2xl border border-ink-200 p-3">
              <p className="sh-label mb-2">Preview</p>
              <div className="overflow-hidden rounded-xl border border-ink-200">
                <div className="h-16" style={{ background: `linear-gradient(135deg, ${form.primary_color}, ${form.accent_color})` }} />
                <div className="flex items-center gap-2 p-2.5">
                  {logo?.url
                    ? <img src={logo.url} alt="" className="h-9 w-9 rounded-lg object-cover" />
                    : <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-100 text-sm">🏪</span>}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold">{form.name || 'Your business name'}</p>
                    <p className="truncate text-[11px] text-ink-500">{form.tagline || BRAND.tagline}</p>
                  </div>
                  <span className="ml-auto rounded-lg px-2.5 py-1 text-[11px] font-bold text-white"
                    style={{ background: form.primary_color }}>Follow</span>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-ink-200 p-3">
              <Switch checked={form.is_public} onChange={(v) => set({ is_public: v })}
                label="List my store in the marketplace"
                hint="Buyers can find you in search, categories and Nearby." />
              <Switch checked={form.accepts_orders} onChange={(v) => set({ accepts_orders: v })}
                label="Accept online orders"
                hint="Buyers can check out and pay through your store." />
              <Switch checked={form.delivery_enabled} onChange={(v) => set({ delivery_enabled: v })}
                label="Offer delivery" />
              {form.delivery_enabled && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="Delivery fee" type="number" min={0} step="0.01" value={String(form.delivery_fee)}
                    onChange={(e) => set({ delivery_fee: Number(e.target.value) || 0 })} />
                  <Input label="Free delivery over (optional)" type="number" min={0} step="0.01"
                    value={form.free_delivery_over}
                    onChange={(e) => set({ free_delivery_over: e.target.value })}
                    hint="Orders above this amount get free delivery." />
                </div>
              )}
              <Switch checked={form.accepts_wholesale} onChange={(v) => set({ accepts_wholesale: v })}
                label="Sell wholesale"
                hint="Set a bulk price and minimum quantity per product." />
            </div>

            <div className="rounded-2xl border border-ink-200 p-3">
              <p className="sh-field-label">Tax & registration (shown on invoices)</p>
              <div className="space-y-3">
                <Checkbox checked={form.tax_registered} onChange={(v) => set({ tax_registered: v })}
                  label="Registered for VAT"
                  hint="Adds a 16% VAT tax row you can edit later. Zambia's standard rate." />
                {form.tax_registered && (
                  <Input label="TPIN / VAT number" value={form.tax_number}
                    onChange={(e) => set({ tax_number: e.target.value })} placeholder="1234567890" />
                )}
                <Input label="PACRA registration number (optional)" value={form.registration_number}
                  onChange={(e) => set({ registration_number: e.target.value })} />
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-base font-extrabold">Check your details</h2>

            <dl className="divide-y divide-ink-100 rounded-2xl border border-ink-200 text-sm">
              <Review label="Business name" value={form.name} onEdit={() => setStep(1)} />
              <Review label="Type" value={BUSINESS_TYPES[form.business_type] ?? form.business_type} onEdit={() => setStep(1)} />
              <Review label="Category" value={topLevel.find((c) => c.id === form.category_id)?.name ?? '—'} onEdit={() => setStep(1)} />
              <Review label="Phone" value={form.phone ? `${form.phone_country_code} ${form.phone}` : '—'} onEdit={() => setStep(2)} />
              <Review label="WhatsApp" value={form.whatsapp || 'Same as phone'} onEdit={() => setStep(2)} />
              <Review label="Email" value={form.email || '—'} onEdit={() => setStep(2)} />
              <Review label="Location" value={[form.address_line1, form.city, form.region, COUNTRY_LABELS[form.country_code]].filter(Boolean).join(', ') || '—'} onEdit={() => setStep(2)} />
              <Review label="Currency" value={form.base_currency} onEdit={() => setStep(2)} />
              <Review label="Store address" value={`${BRAND.domain}/store/${form.slug || '—'}`} onEdit={() => setStep(3)} />
              <Review label="Selling" value={[
                form.is_public ? 'Marketplace listing' : 'Private store',
                form.accepts_orders ? 'Online orders' : null,
                form.delivery_enabled ? `Delivery (${form.delivery_fee || 'free'})` : 'Collection',
                form.accepts_wholesale ? 'Wholesale' : null,
                form.tax_registered ? 'VAT registered' : null,
              ].filter(Boolean).join(' · ')} onEdit={() => setStep(3)} />
            </dl>

            <Notice tone="brand" title="What gets created" icon="sparkles">
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[13px]">
                <li>Your business record and store at /store/{form.slug || '…'}</li>
                <li>A default branch and a default warehouse for stock</li>
                {form.tax_registered && <li>A 16% VAT tax rate applied to taxable products</li>}
                <li>Document numbering (INV-0001, QTN-0001, RCP-0001, ORD-0001)</li>
                <li>Your owner membership with full permissions</li>
                <li>A 14-day trial of the Business plan — no card needed</li>
              </ul>
            </Notice>

            <p className="text-xs text-ink-500">
              Signed in as <span className="font-semibold">{displayName(profile)}</span> ({user.email}).
              You can add staff, branches and warehouses from Settings after creation.
            </p>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-2 border-t border-ink-100 pt-4">
          <Button variant="ghost" icon="arrowLeft" disabled={step === 1 || busy}
            onClick={() => setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3 | 4)}>
            Back
          </Button>
          {step < 4 ? (
            <Button iconRight="arrowRight" disabled={!canContinue} onClick={() => setStep((s) => (s + 1) as 2 | 3 | 4)}>
              Continue
            </Button>
          ) : (
            <Button icon="store" size="lg" loading={busy} disabled={!canContinue || busy} onClick={() => void submit()}>
              Create my business
            </Button>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-ink-500">
        Need help? <Link to="/help" className="font-semibold text-brand-700 hover:underline">Read the setup guide</Link> or
        {' '}message us on <a className="font-semibold text-brand-700 hover:underline"
          href={`https://wa.me/${BRAND.supportWhatsApp}`} target="_blank" rel="noreferrer">WhatsApp</a>.
      </p>
    </div>
  );
}

function defaultHours(): Record<string, { open: string; close: string; closed: boolean }> {
  const hours: Record<string, { open: string; close: string; closed: boolean }> = {};
  DAYS.forEach((d) => {
    hours[d] = d === 'sun' ? { open: '08:00', close: '13:00', closed: false } : { open: '08:00', close: '17:00', closed: false };
  });
  return hours;
}

function setHours(
  hours: Record<string, { open: string; close: string; closed: boolean }>,
  day: string,
  patch: { open: string; close: string; closed: boolean },
  set: (p: { opening_hours: Record<string, { open: string; close: string; closed: boolean }> }) => void,
) {
  set({ opening_hours: { ...hours, [day]: patch } });
}

function Review({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <dt className="w-32 shrink-0 text-[11px] font-bold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="min-w-0 flex-1 truncate font-medium text-ink-800">{value}</dd>
      <button type="button" onClick={onEdit} className="shrink-0 text-xs font-bold text-brand-700 hover:underline">
        Edit
      </button>
    </div>
  );
}

/** "Become a seller" marketing page → funnels into setup. */
export function BecomeASellerPage() {
  const { user } = useAuth();
  const { businesses } = useBusiness();

  return (
    <div className="space-y-8">
      <section className="sh-gradient-brand overflow-hidden rounded-3xl px-5 py-10 text-center text-white sm:py-14">
        <Badge tone="accent" icon="store">Become a seller</Badge>
        <h1 className="mx-auto mt-3 max-w-2xl text-2xl font-extrabold leading-tight text-white sm:text-4xl">
          Your shop, online and organised — free to start
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-white/80 sm:text-base">
          Get a storefront, a catalogue with barcodes, quotations and invoices, stock across branches,
          and a point of sale for the counter. All from one login.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link to={user ? (businesses.length ? '/business' : '/business/setup') : '/auth/signup?intent=sell'}>
            <Button variant="accent" size="lg" icon="store">
              {user ? (businesses.length ? 'Open my business' : 'Create my store') : 'Create free account'}
            </Button>
          </Link>
          <Link to="/pricing">
            <Button size="lg" className="bg-white/10 text-white hover:bg-white/20">See plans</Button>
          </Link>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          ['🏪', 'A store in minutes', 'Pick a name, choose your colours and your page is live at seedwelhub.com/store/your-name.'],
          ['📦', 'Catalogue & barcodes', 'Variants, SKUs, barcodes and QR codes. Print price labels in sheets.'],
          ['🧾', 'Quote → invoice → receipt', 'Send a quotation on WhatsApp, let the buyer accept and sign, convert to an invoice in one tap.'],
          ['🏭', 'Stock that stays true', 'Multiple warehouses, transfers, stocktakes, adjustments and CSV auto-sync.'],
          ['🧮', 'Point of sale', 'Scan, take payment by cash or mobile money, print or WhatsApp the receipt.'],
          ['👥', 'Customers & credit', 'Full purchase history, statements, balances and ageing per customer.'],
          ['💸', 'Expenses & profit', 'Record expenses with approval limits so a cashier never touches company money.'],
          ['📈', 'Reports', 'Sales, profit, best sellers, stock value — export to CSV or Excel.'],
          ['🤖', 'AI that asks first', 'Draft products, chase invoices and summarise the month. Money actions need your approval.'],
        ].map(([emoji, title, text]) => (
          <div key={title} className="sh-card-flat p-4">
            <span className="text-2xl" aria-hidden="true">{emoji}</span>
            <h2 className="mt-2 text-sm font-extrabold">{title}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-600">{text}</p>
          </div>
        ))}
      </section>

      <section className="sh-card-flat p-5">
        <h2 className="text-lg font-extrabold">What you need</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            'A business or trading name',
            'A phone number buyers can reach (WhatsApp works best)',
            'Photos of what you sell — a phone camera is enough',
            'Your prices; cost prices are optional but unlock profit reporting',
            'TPIN / VAT number if you are registered (adds VAT to invoices)',
            'PACRA registration for the Verified badge',
          ].map((t) => (
            <li key={t} className="flex items-start gap-2 text-sm text-ink-700">
              <Icon name="check" size={16} className="mt-0.5 shrink-0 text-emerald-600" /> {t}
            </li>
          ))}
        </ul>
        <div className="mt-5">
          <Link to={user ? '/business/setup' : '/auth/signup?intent=sell'}>
            <Button size="lg" icon="store">Start now — it is free</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
