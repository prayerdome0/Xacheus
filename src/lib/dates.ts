/** Date helpers. Everything is displayed in the viewer's locale but stored in UTC. */

const MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000 };

export function parseDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(v: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = parseDate(v);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric', ...opts });
}

export function formatDateTime(v: string | Date | null | undefined): string {
  const d = parseDate(v);
  if (!d) return '—';
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function formatTime(v: string | Date | null | undefined): string {
  const d = parseDate(v);
  if (!d) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** "14:32" — the format used by the CSV sync panel ("Last synchronisation: 14:32"). */
export function formatClock(v: string | Date | null | undefined): string {
  const d = parseDate(v);
  if (!d) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function relativeTime(v: string | Date | null | undefined): string {
  const d = parseDate(v);
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const fmt = (n: number, unit: string) => (future ? `in ${n} ${unit}` : `${n} ${unit} ago`);

  if (abs < MS.minute) return 'just now';
  if (abs < MS.hour) return fmt(Math.floor(abs / MS.minute), 'min');
  if (abs < MS.day) return fmt(Math.floor(abs / MS.hour), 'h');
  if (abs < MS.day * 7) return fmt(Math.floor(abs / MS.day), 'd');
  if (abs < MS.day * 30) return fmt(Math.floor(abs / (MS.day * 7)), 'w');
  if (abs < MS.day * 365) return fmt(Math.floor(abs / (MS.day * 30)), 'mo');
  return fmt(Math.floor(abs / (MS.day * 365)), 'y');
}

export function toISODate(d: Date | string | null | undefined): string {
  const date = parseDate(d) ?? new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(days: number, from: Date | string = new Date()): Date {
  const d = parseDate(from) ?? new Date();
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function startOfDay(d: Date | string = new Date()): Date {
  const date = parseDate(d) ?? new Date();
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function endOfDay(d: Date | string = new Date()): Date {
  const date = parseDate(d) ?? new Date();
  const copy = new Date(date.getTime());
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export function startOfMonth(monthsAgo = 0): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + monthsAgo, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysBetween(a: Date | string, b: Date | string): number {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / MS.day);
}

export function isOverdue(dueDate: string | null | undefined, status?: string | null): boolean {
  const d = parseDate(dueDate);
  if (!d) return false;
  if (status && ['paid', 'cancelled', 'void'].includes(status)) return false;
  return d.getTime() < startOfDay().getTime();
}

export function daysOverdue(dueDate: string | null | undefined): number {
  const d = parseDate(dueDate);
  if (!d) return 0;
  return Math.max(0, daysBetween(d, new Date()));
}

/** Named ranges used by the reports and dashboard screens. */
export type RangeKey = 'today' | 'yesterday' | 'last_7_days' | 'last_30_days' | 'last_90_days'
  | 'this_week' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'custom';

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  this_week: 'This week',
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  this_year: 'This year',
  custom: 'Custom range',
};

export function resolveRange(key: RangeKey, custom?: { from?: string; to?: string }): { from: Date; to: Date } {
  const now = new Date();
  const from = startOfDay();
  switch (key) {
    case 'today':
      return { from, to: endOfDay() };
    case 'yesterday': {
      const y = addDays(-1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case 'last_7_days':
      return { from: startOfDay(addDays(-6)), to: endOfDay() };
    case 'last_30_days':
      return { from: startOfDay(addDays(-29)), to: endOfDay() };
    case 'last_90_days':
      return { from: startOfDay(addDays(-89)), to: endOfDay() };
    case 'this_week': {
      const day = (now.getDay() + 6) % 7; // Monday-first
      return { from: startOfDay(addDays(-day)), to: endOfDay() };
    }
    case 'this_month':
      return { from: startOfMonth(0), to: endOfDay() };
    case 'last_month': {
      const s = startOfMonth(-1);
      const e = addDays(-1, startOfMonth(0));
      return { from: s, to: endOfDay(e) };
    }
    case 'this_quarter': {
      const q = Math.floor(now.getMonth() / 3) * 3;
      const s = new Date(now.getFullYear(), q, 1);
      return { from: startOfDay(s), to: endOfDay() };
    }
    case 'this_year':
      return { from: startOfDay(new Date(now.getFullYear(), 0, 1)), to: endOfDay() };
    case 'custom':
    default:
      return {
        from: startOfDay(custom?.from ?? now),
        to: endOfDay(custom?.to ?? now),
      };
  }
}

/** "14 days left" / "3 days overdue" for documents. */
export function dueLabel(dueDate: string | null | undefined, status?: string | null): string {
  const d = parseDate(dueDate);
  if (!d) return '';
  if (status && ['paid', 'cancelled', 'void'].includes(status)) return '';
  const days = daysBetween(new Date(), d);
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}
