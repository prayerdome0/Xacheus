import { roundMoney, toNum } from './currency';
import type { DraftLine, Money } from '@/types';

/**
 * Client-side preview maths for documents and the POS.
 *
 * The authoritative totals are computed by Postgres (recalculate_invoice_totals,
 * recalculate_quotation_totals, create_order). These helpers exist so the seller
 * sees the number change as they type — never so the client can dictate a total.
 */

export interface TotalsInput {
  lines: DraftLine[];
  currency?: string;
  deliveryFee?: number;
  tip?: number;
  couponDiscount?: number;
  /** Default tax rate applied to lines that do not specify one. */
  defaultTaxRate?: number;
  /** Prices already include tax (inclusive VAT configuration). */
  taxInclusive?: boolean;
}

export interface Totals {
  subtotal: number;
  discount: number;
  tax: number;
  delivery: number;
  tip: number;
  couponDiscount: number;
  total: number;
  itemCount: number;
  profit: number;
  lines: (DraftLine & {
    lineSubtotal: number;
    lineTax: number;
    lineTotal: number;
    lineDiscount: number;
    effectiveTaxRate: number;
  })[];
}

export function computeTotals(input: TotalsInput): Totals {
  const code = input.currency ?? 'ZMW';
  const defaultTax = toNum(input.defaultTaxRate);
  const inclusive = input.taxInclusive ?? false;

  const lines = (input.lines ?? []).map((raw) => {
    const qty = Math.max(toNum(raw.quantity) || 0, 0);
    const price = toNum(raw.unit_price);
    const taxRate = raw.tax_rate === undefined || raw.tax_rate === null ? defaultTax : toNum(raw.tax_rate);
    const discountPct = toNum(raw.discount_percent);
    const explicitDiscount = toNum(raw.discount_amount);

    const gross = roundMoney(qty * price, code);
    const discount = roundMoney(explicitDiscount + (gross * discountPct) / 100, code);
    const net = roundMoney(Math.max(gross - discount, 0), code);
    const tax = inclusive
      ? roundMoney(net - net / (1 + taxRate / 100), code)
      : roundMoney((net * taxRate) / 100, code);
    const lineTotal = inclusive ? net : roundMoney(net + tax, code);

    return {
      ...raw,
      quantity: qty,
      unit_price: price,
      lineSubtotal: net,
      lineTax: tax,
      lineTotal,
      lineDiscount: discount,
      effectiveTaxRate: taxRate,
    };
  });

  const subtotal = roundMoney(lines.reduce((s, l) => s + l.lineSubtotal, 0), code);
  const discount = roundMoney(lines.reduce((s, l) => s + l.lineDiscount, 0), code);
  const tax = roundMoney(lines.reduce((s, l) => s + l.lineTax, 0), code);
  const delivery = roundMoney(toNum(input.deliveryFee), code);
  const tip = roundMoney(toNum(input.tip), code);
  const couponDiscount = roundMoney(Math.min(toNum(input.couponDiscount), subtotal), code);
  const itemCount = lines.reduce((s, l) => s + toNum(l.quantity), 0);

  const total = roundMoney(subtotal - couponDiscount + tax + delivery + tip, code);

  return { lines, subtotal, discount, tax, delivery, tip, couponDiscount, total, itemCount, profit: 0 };
}

/** Percentage discount for a coupon against a subtotal. */
export function couponDiscount(
  type: 'percent' | 'fixed' | 'free_delivery' | 'bogo',
  value: number,
  subtotal: number,
  delivery = 0,
  maxDiscount?: number | null,
  currency = 'ZMW',
): number {
  switch (type) {
    case 'percent': {
      const raw = roundMoney((subtotal * toNum(value)) / 100, currency);
      return maxDiscount ? Math.min(raw, toNum(maxDiscount)) : raw;
    }
    case 'fixed':
      return Math.min(roundMoney(toNum(value), currency), subtotal);
    case 'free_delivery':
      return delivery;
    default:
      return 0;
  }
}

/** Wholesale price applies once the quantity crosses the minimum. */
/** Accepts Money (number | string) because that is what the DB returns. */
export function priceForQuantity(
  price: Money | null | undefined,
  quantity: number,
  wholesalePrice?: Money | null,
  wholesaleMinQty = 1,
  isWholesale = false,
): { price: number; wholesale: boolean } {
  if (isWholesale && wholesalePrice != null && quantity >= Math.max(1, wholesaleMinQty)) {
    return { price: toNum(wholesalePrice), wholesale: true };
  }
  return { price: toNum(price), wholesale: false };
}

/** Margin & markup helpers for the product form. */
export function marginPercent(price: Money | null | undefined, cost: Money | null | undefined): number {
  if (toNum(price) <= 0) return 0;
  return roundMoney(((toNum(price) - toNum(cost)) / toNum(price)) * 100, 'ZMW');
}

export function markupPercent(price: number, cost: number): number {
  if (toNum(cost) <= 0) return 0;
  return roundMoney(((toNum(price) - toNum(cost)) / toNum(cost)) * 100, 'ZMW');
}

export function profitPerUnit(price: number, cost: number): number {
  return roundMoney(toNum(price) - toNum(cost), 'ZMW');
}

/** Reorder point = lead-time demand + safety stock. */
export function suggestedReorderPoint(avgDailySales: number, leadTimeDays: number, safetyDays = 3): number {
  return Math.ceil(toNum(avgDailySales) * (toNum(leadTimeDays) + toNum(safetyDays)));
}

/** Stock value at cost, for the inventory dashboard. */
export function stockValue(quantity: number, unitCost: number, currency = 'ZMW'): number {
  return roundMoney(toNum(quantity) * toNum(unitCost), currency);
}

/** Ageing buckets for receivables/payables reports. */
export function ageingBucket(daysOverdue: number): 'current' | '1-30' | '31-60' | '61-90' | '90+' {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

export const AGEING_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'] as const;

/** Change due at the till. */
export function changeDue(total: number, tendered: number, currency = 'ZMW'): number {
  return roundMoney(Math.max(toNum(tendered) - toNum(total), 0), currency);
}
