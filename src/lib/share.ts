import { formatMoney } from './currency';
import type { Invoice, PaymentLink, Product, Quotation } from '@/types';

/**
 * Sharing helpers: WhatsApp, SMS, email, Facebook, X, copy-link and the native
 * Web Share API. Every commercial document and every payment link can be sent
 * through any of them — the blueprint calls this out for quotations, invoices,
 * receipts and payment requests.
 */

const enc = encodeURIComponent;

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function whatsappUrl(phone: string | null | undefined, message: string): string {
  const digits = (phone ?? '').replace(/[^\d]/g, '');
  const base = 'https://wa.me/';
  return digits ? `${base}${digits}?text=${enc(message)}` : `${base}?text=${enc(message)}`;
}

export function smsUrl(phone: string | null | undefined, message: string): string {
  const digits = (phone ?? '').replace(/[^\d]/g, '');
  return `sms:${digits}?&body=${enc(message)}`;
}

export function mailtoUrl(email: string | null | undefined, subject: string, body: string): string {
  return `mailto:${email ?? ''}?subject=${enc(subject)}&body=${enc(body)}`;
}

export function facebookShareUrl(url: string, quote?: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}${quote ? `&quote=${enc(quote)}` : ''}`;
}

export function xShareUrl(url: string, text: string): string {
  return `https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(text)}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export async function nativeShare(data: { title: string; text: string; url?: string }): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.share) return false;
  try {
    await navigator.share(data);
    return true;
  } catch {
    return false; // user dismissed
  }
}

export function openShareWindow(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer,width=640,height=720');
}

// ── Document messages ────────────────────────────────────────────────────────
export function invoiceMessage(invoice: Invoice, businessName: string, link?: string): string {
  const due = invoice.due_date
    ? ` It is due on ${new Date(invoice.due_date).toLocaleDateString()}.`
    : '';
  const balance = Number(invoice.balance_due) > 0
    ? ` Balance due: ${formatMoney(invoice.balance_due, invoice.currency)}.`
    : ' This invoice is fully paid. Thank you.';
  return `Hello${invoice.customer?.name ? ` ${invoice.customer.name}` : ''}, here is invoice ${invoice.invoice_number} from ${businessName} for ${formatMoney(invoice.total, invoice.currency)}.${due}${balance}${link ? `\n\nView and pay: ${link}` : ''}\n\nThank you for your business.`;
}

export function quotationMessage(quotation: Quotation, businessName: string, link?: string): string {
  const valid = quotation.valid_until
    ? ` This quotation is valid until ${new Date(quotation.valid_until).toLocaleDateString()}.`
    : '';
  return `Hello${quotation.customer?.name ? ` ${quotation.customer.name}` : ''}, thank you for your enquiry. Please find quotation ${quotation.quotation_number} from ${businessName} for ${formatMoney(quotation.total, quotation.currency)}.${valid}${link ? `\n\nView, accept or sign it here: ${link}` : ''}\n\nWe are happy to adjust anything — just reply to this message.`;
}

export function receiptMessage(args: {
  receiptNumber: string;
  amount: number;
  currency: string;
  businessName: string;
  balance?: number;
  link?: string;
}): string {
  const balance = args.balance && args.balance > 0
    ? ` Remaining balance: ${formatMoney(args.balance, args.currency)}.`
    : '';
  return `Receipt ${args.receiptNumber} from ${args.businessName}. We received ${formatMoney(args.amount, args.currency)}.${balance}${args.link ? `\n\nView your receipt: ${args.link}` : ''}\n\nThank you.`;
}

export function paymentRequestMessage(link: PaymentLink, businessName: string, url: string): string {
  return `Hello${link.customer_name ? ` ${link.customer_name}` : ''}, ${businessName} is requesting ${formatMoney(link.amount, link.currency)}${link.label ? ` for ${link.label}` : ''}.\n\nPay securely here: ${url}\n\nOnce paid, your invoice and receipt update automatically.`;
}

export function orderUpdateMessage(args: {
  orderNumber: string;
  status: string;
  businessName: string;
  total: number;
  currency: string;
  tracking?: string | null;
}): string {
  const statusText = args.status.replace(/_/g, ' ');
  return `Update on your order ${args.orderNumber} from ${args.businessName}: ${statusText}. Total ${formatMoney(args.total, args.currency)}.${args.tracking ? ` Tracking: ${args.tracking}.` : ''}`;
}

// ── Product / marketing sharing ──────────────────────────────────────────────
export function productShareText(product: Product, businessName: string, url: string): string {
  const price = product.is_quotation_only
    ? 'Contact us for a price'
    : formatMoney(product.price, product.currency);
  const wholesale = product.is_wholesale && product.wholesale_price
    ? ` · Wholesale ${formatMoney(product.wholesale_price, product.currency)} from ${product.wholesale_min_qty} ${product.unit}s`
    : '';
  return `${product.name} — ${price}${wholesale}\n${product.short_description ?? ''}\nAvailable from ${businessName} on Seedwel Hub: ${url}`;
}

export function productWhatsappText(product: Product, businessName: string, url: string): string {
  return productShareText(product, businessName, url);
}

/** Share a product card (image + title) via the Web Share API when available. */
export async function shareProduct(product: Product, businessName: string, url: string): Promise<boolean> {
  return nativeShare({
    title: `${product.name} — ${businessName}`,
    text: productShareText(product, businessName, url),
    url,
  });
}

export const SHARE_CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp', icon: '💬' },
  { key: 'sms', label: 'SMS', icon: '✉️' },
  { key: 'email', label: 'Email', icon: '📧' },
  { key: 'facebook', label: 'Facebook', icon: '📘' },
  { key: 'x', label: 'X', icon: '🐦' },
  { key: 'copy', label: 'Copy link', icon: '🔗' },
  { key: 'native', label: 'More…', icon: '📲' },
] as const;

export type ShareChannel = (typeof SHARE_CHANNELS)[number]['key'];

/** Resolve a channel + contact into the URL to open. */
export function channelUrl(
  channel: ShareChannel,
  args: { url: string; text: string; subject?: string; phone?: string | null; email?: string | null },
): string | null {
  switch (channel) {
    case 'whatsapp': return whatsappUrl(args.phone, `${args.text}\n\n${args.url}`);
    case 'sms': return smsUrl(args.phone, `${args.text} ${args.url}`);
    case 'email': return mailtoUrl(args.email, args.subject ?? args.text.slice(0, 60), `${args.text}\n\n${args.url}`);
    case 'facebook': return facebookShareUrl(args.url, args.text);
    case 'x': return xShareUrl(args.url, args.text);
    default: return null;
  }
}
