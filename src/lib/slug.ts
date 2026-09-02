/** Slug & identifier helpers (client mirror of the SQL slugify()). */

export function slugify(input: string): string {
  return (input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length >= 2 && slug.length <= 60;
}

/** Reserved slugs that would collide with app routes. */
export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'about', 'account', 'app', 'assets', 'auth', 'business', 'businesses',
  'cart', 'categories', 'category', 'checkout', 'contact', 'deals', 'docs', 'help',
  'home', 'index', 'inventory', 'invoices', 'login', 'marketplace', 'messages', 'nearby',
  'new', 'notifications', 'orders', 'pay', 'payment', 'pricing', 'product', 'products',
  'profile', 'q', 'quotations', 'receipts', 'register', 'reports', 'search', 'seller',
  'service', 'services', 'settings', 'shop', 'signin', 'signup', 'static', 'store',
  'stores', 'support', 'terms', 'verify', 'wholesale', 'become-a-seller', 'business-solutions',
  'academy', 'privacy',
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

export function shortId(len = 6): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36)).join('').slice(0, len);
}

/** Local key for cart lines before they exist in the database. */
export function lineKey(productId: string, variantId?: string | null): string {
  return variantId ? `${productId}:${variantId}` : productId;
}

/** Normalise a Zambian/regional phone number for wa.me and tel: links. */
export function normalisePhone(phone: string, defaultCountryCode = '+260'): string {
  const digits = (phone ?? '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  const cc = defaultCountryCode.replace('+', '');
  if (digits.startsWith(cc)) return `+${digits}`;
  if (digits.startsWith('0')) return `+${cc}${digits.slice(1)}`;
  return `+${cc}${digits}`;
}

export function formatPhoneDisplay(phone: string | null | undefined, countryCode = '+260'): string {
  if (!phone) return '';
  const full = normalisePhone(phone, countryCode);
  return full;
}

/** Mask a phone/email for public views. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '•••';
  return `${user.slice(0, 2)}•••@${domain}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 5) return '•••';
  return `${phone.slice(0, phone.length - digits.length + 3)}•••${digits.slice(-2)}`;
}

/** Initials for avatars. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Deterministic pastel colour from a string (avatars, category tiles). */
export function colorFromString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) hash = input.charCodeAt(i) + ((hash << 5) - hash);
  const palette = [
    '#0f766e', '#0369a1', '#4338ca', '#7c3aed', '#be185d', '#b45309',
    '#15803d', '#0e7490', '#9333ea', '#c2410c', '#1d4ed8', '#047857',
  ];
  return palette[Math.abs(hash) % palette.length];
}

/** Truncate for previews without breaking words. */
export function truncate(text: string | null | undefined, max = 120): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : max).trimEnd()}…`;
}
