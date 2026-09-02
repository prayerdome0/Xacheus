import type { Money } from '@/types';

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  decimals: number;
}

/**
 * Currencies the platform supports. Rates are CONFIGURABLE (exchange_rates
 * table) — the numbers below are only the display metadata and the fallback
 * symbol. Converted amounts are always labelled as estimates in the UI, and
 * settlement amounts are stored per transaction, never derived live.
 */
export const CURRENCIES: Record<string, CurrencyInfo> = {
  ZMW: { code: 'ZMW', symbol: 'K', name: 'Zambian Kwacha', decimals: 2 },
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', decimals: 2 },
  ZAR: { code: 'ZAR', symbol: 'R', name: 'South African Rand', decimals: 2 },
  BWP: { code: 'BWP', symbol: 'P', name: 'Botswana Pula', decimals: 2 },
  MWK: { code: 'MWK', symbol: 'MK', name: 'Malawian Kwacha', decimals: 2 },
  TZS: { code: 'TZS', symbol: 'TSh', name: 'Tanzanian Shilling', decimals: 0 },
  KES: { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', decimals: 2 },
  GBP: { code: 'GBP', symbol: '£', name: 'Pound Sterling', decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', decimals: 2 },
};

export const currencyInfo = (code?: string | null): CurrencyInfo =>
  CURRENCIES[(code ?? 'ZMW').toUpperCase()] ?? CURRENCIES.ZMW;

/** Postgres `numeric` arrives as a string; coerce safely without float drift. */
export function toNum(v: Money | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Round to the currency's decimal places using half-up (money maths). */
export function roundMoney(v: number, code = 'ZMW'): number {
  const d = currencyInfo(code).decimals;
  const f = 10 ** d;
  return Math.round((v + Number.EPSILON) * f) / f;
}

/** "K1,500.00" — the canonical money string used across the whole product. */
export function formatMoney(v: Money | null | undefined, code = 'ZMW', opts: { decimals?: boolean } = {}): string {
  const info = currencyInfo(code);
  const n = toNum(v);
  const showDecimals = opts.decimals ?? info.decimals > 0;
  const formatted = Math.abs(n).toLocaleString('en-ZM', {
    minimumFractionDigits: showDecimals ? info.decimals : 0,
    maximumFractionDigits: showDecimals ? info.decimals : 0,
  });
  return `${n < 0 ? '-' : ''}${info.symbol}${formatted}`;
}

/** Compact for dashboard tiles: K25.4k, K1.2m */
export function formatMoneyCompact(v: Money | null | undefined, code = 'ZMW'): string {
  const info = currencyInfo(code);
  const n = Math.abs(toNum(v));
  const sign = toNum(v) < 0 ? '-' : '';
  if (n >= 1_000_000_000) return `${sign}${info.symbol}${(n / 1_000_000_000).toFixed(1)}b`;
  if (n >= 1_000_000) return `${sign}${info.symbol}${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 10_000) return `${sign}${info.symbol}${(n / 1_000).toFixed(1)}k`;
  return `${sign}${info.symbol}${n.toLocaleString('en-ZM', { maximumFractionDigits: 0 })}`;
}

/** Plain amount for inputs: 1500.00 (no symbol, no thousand separators). */
export function moneyInputValue(v: Money | null | undefined): string {
  const n = toNum(v);
  return n === 0 ? '' : String(n);
}

export function formatNumber(v: number | null | undefined, decimals = 0): string {
  return toNum(v).toLocaleString('en-ZM', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPercent(v: number | null | undefined, decimals = 1): string {
  const n = toNum(v);
  return `${n > 0 ? '' : ''}${n.toFixed(decimals)}%`;
}

export function formatSignedPercent(v: number | null | undefined): string {
  const n = toNum(v);
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

/** Parse "K1,500.00" / "1500" / "1 500,00" typed by a human into a number. */
export function parseMoney(input: string): number {
  const cleaned = input.replace(/[^0-9.,\-]/g, '');
  if (!cleaned) return 0;
  // If both . and , exist, the last one is the decimal separator.
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalised = cleaned;
  if (lastDot > -1 && lastComma > -1) {
    if (lastComma > lastDot) {
      normalised = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalised = cleaned.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    // A single comma with exactly 2 digits after it is a decimal separator.
    normalised = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  } else {
    normalised = cleaned.replace(/,/g, '');
  }
  const n = Number(normalised);
  return Number.isFinite(n) ? n : 0;
}

/** Convert between currencies using a supplied rate table (never a live guess). */
export function convert(amount: Money, rate: number, code = 'ZMW'): number {
  return roundMoney(toNum(amount) * (rate || 1), code);
}
