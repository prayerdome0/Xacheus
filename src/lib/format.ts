import { initials, truncate } from './slug';
import type { OrderStatus, Product, Review } from '@/types';

/** Small display helpers shared across screens. */

export function displayName(obj?: { display_name?: string | null; full_name?: string | null; email?: string | null } | null): string {
  if (!obj) return 'Account';
  return obj.display_name || obj.full_name || (obj.email ? obj.email.split('@')[0] : 'Account');
}

export function avatarText(name?: string | null): string {
  return initials(name ?? '');
}

export function productImage(p: Pick<Product, 'primary_image_url' | 'media' | 'name'> | null | undefined): string | null {
  if (!p) return null;
  if (p.primary_image_url) return p.primary_image_url;
  const first = (p.media ?? []).find((m) => (m.type ?? 'image') === 'image');
  return first?.url ?? null;
}

export function discountPercent(price: number, compareAt: number | null): number | null {
  if (!compareAt || compareAt <= price || price <= 0) return null;
  return Math.round(((compareAt - price) / compareAt) * 100);
}

export function stockLabel(stock: number, alert: number, track = true): { text: string; tone: 'green' | 'amber' | 'red' | 'neutral' } {
  if (!track) return { text: 'Not tracked', tone: 'neutral' };
  if (stock <= 0) return { text: 'Out of stock', tone: 'red' };
  if (stock <= alert) return { text: `Low stock · ${stock} left`, tone: 'amber' };
  return { text: `${stock} in stock`, tone: 'green' };
}

export function orderStatusTone(status: OrderStatus | string): 'green' | 'amber' | 'red' | 'blue' | 'neutral' {
  switch (status) {
    case 'delivered': case 'paid': case 'completed': case 'accepted': return 'green';
    case 'cancelled': case 'returned': case 'rejected': case 'void': case 'overdue': return 'red';
    case 'pending': case 'processing': case 'confirmed': case 'partially_paid': return 'amber';
    case 'ready': case 'shipped': return 'blue';
    default: return 'neutral';
  }
}

export function ratingStars(rating: number): string {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

export function reviewSummary(reviews: Review[]): { avg: number; count: number; buckets: Record<number, number> } {
  const buckets: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  (reviews ?? []).forEach((r) => {
    buckets[r.rating] = (buckets[r.rating] ?? 0) + 1;
    sum += r.rating;
  });
  const count = (reviews ?? []).length;
  return { avg: count ? Number((sum / count).toFixed(2)) : 0, count, buckets };
}

/** "3 items · K1,250" style summary line for lists. */
export function itemsSummary(count: number, noun = 'item'): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function fileSize(bytes: number | null | undefined): string {
  const n = Number(bytes ?? 0);
  if (n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function pluralise(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? `${one}s`)}`;
}

/** Distance label for "businesses near me". */
export function distanceLabel(km: number | null | undefined): string {
  const n = Number(km ?? 0);
  if (!n) return '';
  if (n < 1) return `${Math.round(n * 1000)} m away`;
  if (n < 10) return `${n.toFixed(1)} km away`;
  return `${Math.round(n)} km away`;
}

/** Opening hours → "Open now · closes 17:00" / "Closed · opens Mon 08:00". */
export function openingStatus(hours: Record<string, { open?: string; close?: string; closed?: boolean }> | null | undefined, now = new Date()): {
  open: boolean; text: string;
} {
  if (!hours || Object.keys(hours).length === 0) return { open: false, text: 'Hours not set' };
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const today = hours[keys[now.getDay()]];
  if (!today || today.closed) return { open: false, text: 'Closed today' };

  const [oh, om] = (today.open ?? '08:00').split(':').map(Number);
  const [ch, cm] = (today.close ?? '17:00').split(':').map(Number);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const openMin = oh * 60 + om;
  const closeMin = ch * 60 + cm;

  if (minutes < openMin) return { open: false, text: `Closed · opens ${today.open}` };
  if (minutes > closeMin) return { open: false, text: `Closed · opened ${today.open}–${today.close}` };
  return { open: true, text: `Open now · closes ${today.close}` };
}

export function excerpt(text: string | null | undefined, max = 140): string {
  return truncate(text ?? '', max);
}

export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Readable action label from an audit-log action key: products.price_changed */
export function auditLabel(action: string): string {
  const [entity, verb] = action.split('.');
  const verbs: Record<string, string> = {
    created: 'created', updated: 'updated', deleted: 'deleted', approved: 'approved',
    rejected: 'rejected', sent: 'sent', paid: 'paid', recorded: 'recorded',
    price_changed: 'changed the price of', imported: 'imported', converted: 'converted',
    received: 'received', adjusted: 'adjusted', transferred: 'transferred',
    invited: 'invited', removed: 'removed', verified: 'verified',
  };
  const v = verbs[verb ?? ''] ?? (verb ?? '').replace(/_/g, ' ');
  return `${entity.replace(/_/g, ' ')} ${v}`;
}
