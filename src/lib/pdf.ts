import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { renderBarcode } from './barcode';
import { currencyInfo, formatMoney, toNum } from './currency';
import { formatDate } from './dates';
import { BRAND } from './constants';
import type {
  Business, Invoice, InvoiceItem, Order, OrderItem, Payment, PaymentMethod,
  Quotation, QuotationItem, Receipt,
} from '@/types';
import { PAYMENT_METHOD_LABELS } from './constants';

/**
 * Branded PDF generation for every commercial document.
 *
 * All documents share one layout system so a quotation, pro-forma invoice,
 * invoice, credit note, statement or receipt looks like it came from the same
 * business: logo, business block, document block, party block, items table,
 * totals, payment details, terms, signature line and a QR verification code.
 */

const TEAL: [number, number, number] = [15, 118, 110];
const DARK: [number, number, number] = [17, 24, 39];
const MUTED: [number, number, number] = [107, 114, 128];
const LIGHT: [number, number, number] = [243, 244, 246];
const RED: [number, number, number] = [185, 28, 28];
const GREEN: [number, number, number] = [4, 120, 87];

export interface DocBusiness {
  name: string;
  logo_url?: string | null;
  tagline?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  website?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  region?: string | null;
  country_code?: string;
  tax_number?: string | null;
  registration_number?: string | null;
  bank_details?: {
    bank?: string;
    branch?: string;
    account_name?: string;
    account_number?: string;
    swift?: string;
    mobile_money?: { provider: string; number: string; name?: string }[];
  };
  invoice_terms?: string | null;
  invoice_footer?: string | null;
  primary_color?: string;
}

export interface DocParty {
  name: string;
  company_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country_code?: string;
  tax_number?: string | null;
}

export interface DocLine {
  description: string;
  quantity: number | string;
  unit?: string;
  unit_price: number;
  discount?: number;
  tax_rate?: number;
  tax_amount?: number;
  line_total: number;
  notes?: string | null;
}

export interface PdfOptions {
  title: string;
  documentNumber: string;
  status?: string | null;
  statusTone?: 'neutral' | 'green' | 'red' | 'amber';
  issueDate?: string;
  dueDate?: string | null;
  currency: string;
  business: DocBusiness;
  party?: { label: string; data: DocParty } | null;
  lines: DocLine[];
  subtotal: number;
  discount?: number;
  tax?: number;
  delivery?: number;
  tip?: number;
  total: number;
  amountPaid?: number;
  balance?: number;
  payments?: { date: string; method: string; reference?: string; amount: number }[];
  terms?: string | null;
  notes?: string | null;
  headerExtra?: [string, string][];
  showPaymentDetails?: boolean;
  signature?: { label: string; name?: string | null; imageData?: string | null; date?: string | null } | null;
  qr?: { value: string; caption: string } | null;
  footer?: string | null;
  columns?: { discount?: boolean; tax?: boolean; unit?: boolean };
  compact?: boolean;
  /** Seedwel Hub branding control. When `show` is true (free plan default) a
   *  small "Powered by Seedwel Hub" watermark wordmark appears in the footer.
   *  Paid plans pass `{ show: false }` to remove it. */
  branding?: { show?: boolean };
}

/** Fetch an image as a data URL so jsPDF can embed it (avoids CORS tainting). */
async function imageToDataUrl(url: string | null | undefined): Promise<{ data: string; w: number; h: number } | null> {
  if (!url) return null;
  if (url.startsWith('data:')) {
    const img = await loadImage(url);
    return img ? { data: url, w: img.width, h: img.height } : null;
  }
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('read error'));
      reader.readAsDataURL(blob);
    });
    const img = await loadImage(dataUrl);
    return img ? { data: dataUrl, w: img.width, h: img.height } : { data: dataUrl, w: 1, h: 1 };
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function hexToRgb(hex?: string | null): [number, number, number] {
  if (!hex) return TEAL;
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return TEAL;
  const n = parseInt(clean, 16);
  if (Number.isNaN(n)) return TEAL;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function wrap(doc: jsPDF, text: string, width: number, size = 8.5): string[] {
  doc.setFontSize(size);
  return doc.splitTextToSize(text || '', width) as string[];
}

/**
 * Build any commercial document. Returns the jsPDF instance so callers can
 * .save(), .output('blob') for upload, or .output('datauristring') for preview.
 */
export async function buildDocumentPdf(opts: PdfOptions): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const CW = W - M * 2;
  const accent = hexToRgb(opts.business.primary_color);
  const cur = opts.currency || 'ZMW';
  const money = (v: number) => formatMoney(v, cur);
  const showDiscount = opts.columns?.discount ?? true;
  const showTax = opts.columns?.tax ?? true;
  const showUnit = opts.columns?.unit ?? true;

  // ── Header band ─────────────────────────────────────────────────────────────
  doc.setFillColor(...accent);
  doc.rect(0, 0, W, 3, 'F');

  let y = M + 4;
  const logo = await imageToDataUrl(opts.business.logo_url);
  let textX = M;
  if (logo) {
    const maxH = 18;
    const ratio = logo.w / Math.max(logo.h, 1);
    const h = Math.min(maxH, 18);
    const w = Math.min(52, h * ratio);
    try {
      doc.addImage(logo.data, 'PNG', M, y - 4, w, h);
      textX = M + w + 5;
    } catch {
      /* unsupported image type — fall back to text-only header */
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...DARK);
  doc.text(opts.business.name || BRAND.name, textX, y + 1);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  const contactBits = [
    opts.business.tagline,
    [opts.business.address_line1, opts.business.city, opts.business.region].filter(Boolean).join(', '),
    [opts.business.phone, opts.business.email].filter(Boolean).join(' · '),
    opts.business.website,
    opts.business.tax_number ? `Tax No. ${opts.business.tax_number}` : null,
    opts.business.registration_number ? `Reg. No. ${opts.business.registration_number}` : null,
  ].filter(Boolean) as string[];
  let cy = y + 6;
  contactBits.forEach((line) => {
    doc.text(line, textX, cy);
    cy += 3.8;
  });

  // ── Document title block (right) ────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...accent);
  doc.text(opts.title.toUpperCase(), W - M, M + 6, { align: 'right' });

  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.text(opts.documentNumber, W - M, M + 13, { align: 'right' });

  let ry = M + 19;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  const rightRows: [string, string][] = [
    ...(opts.issueDate ? ([['Date', formatDate(opts.issueDate)]] as [string, string][]) : []),
    ...(opts.dueDate ? ([['Due date', formatDate(opts.dueDate)]] as [string, string][]) : []),
    ...(opts.headerExtra ?? []),
  ];
  rightRows.forEach(([label, value]) => {
    doc.setTextColor(...MUTED);
    doc.text(`${label}:`, W - M - 40, ry);
    doc.setTextColor(...DARK);
    doc.setFont('helvetica', 'bold');
    doc.text(value, W - M, ry, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    ry += 4.4;
  });

  // Status stamp
  if (opts.status) {
    const tone = opts.statusTone ?? 'neutral';
    const color: [number, number, number] =
      tone === 'green' ? GREEN : tone === 'red' ? RED : tone === 'amber' ? [180, 83, 9] : accent;
    const label = opts.status.replace(/_/g, ' ').toUpperCase();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const tw = doc.getTextWidth(label) + 8;
    doc.setDrawColor(...color);
    doc.setLineWidth(0.4);
    doc.setTextColor(...color);
    doc.roundedRect(W - M - tw, ry + 1, tw, 6.5, 1.4, 1.4, 'S');
    doc.text(label, W - M - tw / 2, ry + 5.4, { align: 'center' });
    ry += 10;
  }

  y = Math.max(cy, ry) + 6;

  // ── Party block ─────────────────────────────────────────────────────────────
  if (opts.party) {
    const boxW = CW / 2 - 3;
    doc.setFillColor(...LIGHT);
    doc.roundedRect(M, y, boxW, 30, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(opts.party.label.toUpperCase(), M + 4, y + 6);
    doc.setFontSize(10.5);
    doc.setTextColor(...DARK);
    doc.text(opts.party.data.company_name || opts.party.data.name, M + 4, y + 12);
    if (opts.party.data.company_name) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text(opts.party.data.name, M + 4, y + 16.5);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const lines = [
      [opts.party.data.address_line1, opts.party.data.address_line2].filter(Boolean).join(', '),
      [opts.party.data.city, opts.party.data.region, opts.party.data.postal_code].filter(Boolean).join(', '),
      opts.party.data.phone,
      opts.party.data.email,
      opts.party.data.tax_number ? `Tax No. ${opts.party.data.tax_number}` : null,
    ].filter(Boolean) as string[];
    let py = y + (opts.party.data.company_name ? 21 : 17);
    lines.slice(0, 3).forEach((l) => {
      doc.text(l, M + 4, py);
      py += 3.6;
    });

    // Right box: reference / verification
    const rx = M + boxW + 6;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(229, 231, 235);
    doc.roundedRect(rx, y, boxW, 30, 2, 2, 'FD');
    if (opts.qr) {
      const svg = await renderBarcode(opts.qr.value, { format: 'qrcode', scale: 2 });
      if (svg) {
        const qrData = await imageToDataUrl(await svgToDataUrl(svg));
        if (qrData) {
          try { doc.addImage(qrData.data, 'PNG', rx + boxW - 26, y + 3, 22, 22); } catch { /* ignore */ }
        }
      }
    }
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const qrLines = wrap(doc, opts.qr?.caption ?? `Scan to verify ${opts.documentNumber}`, boxW - 30);
    qrLines.slice(0, 5).forEach((l, i) => doc.text(l, rx + 4, y + 8 + i * 3.8));
    y += 36;
  } else {
    y += 2;
  }

  // ── Items table ─────────────────────────────────────────────────────────────
  const head: string[] = ['#'];
  head.push('Description');
  if (showUnit) head.push('Qty');
  head.push('Unit price');
  if (showDiscount) head.push('Discount');
  if (showTax) head.push('Tax');
  head.push('Amount');

  const body = opts.lines.map((l, i) => {
    const row: string[] = [String(i + 1)];
    const desc = l.notes ? `${l.description}\n${l.notes}` : l.description;
    row.push(desc);
    if (showUnit) row.push(`${toNum(l.quantity)}${l.unit && l.unit !== 'piece' ? ` ${l.unit}` : ''}`);
    row.push(money(l.unit_price));
    if (showDiscount) row.push(toNum(l.discount) > 0 ? `-${money(toNum(l.discount))}` : '—');
    if (showTax) row.push(toNum(l.tax_rate) ? `${toNum(l.tax_rate)}%` : '—');
    row.push(money(l.line_total));
    return row;
  });

  if (body.length === 0) {
    body.push(['—', 'No items', '', '', '', money(0)]);
  }

  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica', fontSize: 8.5, cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 },
      lineColor: [229, 231, 235], lineWidth: 0.1, textColor: DARK, valign: 'middle',
    },
    headStyles: {
      fillColor: accent, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8,
      halign: 'left', cellPadding: { top: 2.6, bottom: 2.6, left: 2.5, right: 2.5 },
    },
    alternateRowStyles: { fillColor: [250, 250, 251] },
    columnStyles: {
      0: { cellWidth: 8, textColor: MUTED, halign: 'center' },
      1: { cellWidth: 'auto' },
      ...(showUnit ? { 2: { cellWidth: 18, halign: 'right' as const } } : {}),
      [head.length - 4]: { cellWidth: 24, halign: 'right' },
      [head.length - 3]: { cellWidth: 22, halign: 'right' },
      [head.length - 2]: { cellWidth: 18, halign: 'right' },
      [head.length - 1]: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: M, right: M },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 1 && data.cell.raw) {
        const text = String(data.cell.raw);
        if (text.includes('\n')) {
          data.cell.styles.fontSize = 8;
          data.cell.styles.textColor = DARK;
        }
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let afterTable = ((doc as any).lastAutoTable?.finalY ?? y) + 6;

  // ── Totals ──────────────────────────────────────────────────────────────────
  const totalsW = 78;
  const totalsX = W - M - totalsW;
  const totalRows: [string, string, boolean][] = [
    ['Subtotal', money(opts.subtotal), false],
  ];
  if (toNum(opts.discount) > 0) totalRows.push(['Discount', `-${money(toNum(opts.discount))}`, false]);
  if (toNum(opts.tax) > 0) totalRows.push([`Tax (${currencyInfo(cur).code})`, money(toNum(opts.tax)), false]);
  if (toNum(opts.delivery) > 0) totalRows.push(['Delivery', money(toNum(opts.delivery)), false]);
  if (toNum(opts.tip) > 0) totalRows.push(['Tip', money(toNum(opts.tip)), false]);
  totalRows.push(['TOTAL', money(opts.total), true]);
  if (opts.amountPaid !== undefined) totalRows.push(['Amount paid', money(toNum(opts.amountPaid)), false]);
  if (opts.balance !== undefined) {
    totalRows.push(['BALANCE DUE', money(toNum(opts.balance)), toNum(opts.balance) > 0]);
  }

  let ty = afterTable;
  totalRows.forEach(([label, value, strong]) => {
    if (strong) {
      doc.setFillColor(...accent);
      doc.roundedRect(totalsX, ty - 4.4, totalsW, 8.4, 1.4, 1.4, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(255, 255, 255);
      doc.text(label, totalsX + 3.5, ty + 1.4);
      doc.text(value, totalsX + totalsW - 3.5, ty + 1.4, { align: 'right' });
      ty += 10;
      return;
    }
    const isBalance = label === 'BALANCE DUE';
    doc.setFont('helvetica', isBalance ? 'bold' : 'normal');
    doc.setFontSize(isBalance ? 9.5 : 8.5);
    doc.setTextColor(...(isBalance && toNum(opts.balance) > 0 ? RED : MUTED));
    doc.text(label, totalsX + 3.5, ty);
    doc.setTextColor(...(isBalance && toNum(opts.balance) > 0 ? RED : DARK));
    doc.setFont('helvetica', isBalance ? 'bold' : 'normal');
    doc.text(value, totalsX + totalsW - 3.5, ty, { align: 'right' });
    ty += 5;
  });

  // ── Left column: payment details, notes, terms ──────────────────────────────
  let ly = afterTable;
  const leftW = totalsX - M - 8;
  if (leftW > 40) {
    if (opts.showPaymentDetails !== false && opts.business.bank_details) {
      const bd = opts.business.bank_details;
      const hasBank = bd.bank || bd.account_number;
      const hasMomo = (bd.mobile_money ?? []).length > 0;
      if (hasBank || hasMomo) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...DARK);
        doc.text('PAYMENT DETAILS', M, ly);
        ly += 4.4;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        if (hasBank) {
          [
            bd.bank && `Bank: ${bd.bank}`,
            bd.branch && `Branch: ${bd.branch}`,
            bd.account_name && `Account name: ${bd.account_name}`,
            bd.account_number && `Account number: ${bd.account_number}`,
            bd.swift && `SWIFT: ${bd.swift}`,
          ].filter(Boolean).forEach((l) => { doc.text(String(l), M, ly); ly += 3.6; });
        }
        if (hasMomo) {
          (bd.mobile_money ?? []).slice(0, 3).forEach((m) => {
            doc.text(`${m.provider}: ${m.number}${m.name ? ` (${m.name})` : ''}`, M, ly);
            ly += 3.6;
          });
        }
        ly += 2;
      }
    }

    if (opts.notes) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...DARK);
      doc.text('NOTES', M, ly);
      ly += 4.2;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      wrap(doc, opts.notes, leftW).slice(0, 5).forEach((l) => { doc.text(l, M, ly); ly += 3.6; });
      ly += 2;
    }

    if (opts.payments && opts.payments.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...DARK);
      doc.text('PAYMENT HISTORY', M, ly);
      ly += 4.2;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      opts.payments.slice(0, 6).forEach((p) => {
        doc.text(`${formatDate(p.date)} · ${p.method}${p.reference ? ` · ${p.reference}` : ''}`, M, ly);
        doc.setTextColor(...DARK);
        doc.text(money(p.amount), M + leftW, ly, { align: 'right' });
        doc.setTextColor(...MUTED);
        ly += 3.6;
      });
      ly += 2;
    }

    if (opts.terms) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...DARK);
      doc.text('TERMS', M, ly);
      ly += 4.2;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      wrap(doc, opts.terms, leftW).slice(0, 6).forEach((l) => { doc.text(l, M, ly); ly += 3.6; });
    }
  }

  afterTable = Math.max(ty, ly) + 8;

  // ── Signature ───────────────────────────────────────────────────────────────
  if (opts.signature) {
    if (afterTable > H - 46) { doc.addPage(); afterTable = M; }
    const sigY = afterTable;
    doc.setDrawColor(209, 213, 219);
    doc.setLineWidth(0.3);
    doc.line(M, sigY + 18, M + 70, sigY + 18);
    doc.line(M + 86, sigY + 18, M + 156, sigY + 18);

    if (opts.signature.imageData) {
      const sig = await imageToDataUrl(opts.signature.imageData);
      if (sig) {
        try { doc.addImage(sig.data, 'PNG', M + 4, sigY + 2, 38, 15); } catch { /* ignore */ }
      }
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(opts.signature.label || 'Authorised signature', M, sigY + 22);
    doc.text(opts.signature.name ?? '', M, sigY + 26);
    doc.text('Received / accepted by', M + 86, sigY + 22);
    if (opts.signature.date) doc.text(`Date: ${formatDate(opts.signature.date)}`, M + 86, sigY + 26);
    afterTable = sigY + 32;
  }

  // ── Footer on every page ────────────────────────────────────────────────────
  // Fetch the real Seedwel Hub wordmark once so the "Powered by Seedwel Hub"
  // watermark is the supplied asset, not a recreated logo.
  const showBranding = opts.branding?.show ?? true;
  const brandLogo = showBranding ? await imageToDataUrl('/brand/wordmarklogo.png') : null;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    const pH = doc.internal.pageSize.getHeight();
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.2);
    doc.line(M, pH - 14, W - M, pH - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    const footerText =
      opts.footer ??
      opts.business.invoice_footer ??
      `${BRAND.name} — ${BRAND.companyLine}`;
    doc.text(wrap(doc, footerText, CW - 30, 7)[0] ?? footerText, M, pH - 9.5);

    if (showBranding && brandLogo) {
      // Small wordmark watermark bottom-left: "Powered by Seedwel Hub" from the
      // real asset. Kept subtle so it never obscures the document.
      const bw = 34;
      const bh = 34 / (brandLogo.w / Math.max(brandLogo.h, 1));
      try {
        doc.addImage(brandLogo.data, 'PNG', M, pH - 5.2, bw, bh);
      } catch { /* fall back to text below */ }
      // "Powered by Seedwel Hub" is baked into the wordmark image, but add a
      // crisp text label next to it in case the image is unavailable.
      doc.setTextColor(107, 114, 128);
      doc.setFontSize(6.5);
      doc.text('Powered by Seedwel Hub', M + bw + 2, pH - 4.2);
    } else {
      doc.text(`${BRAND.name} · ${BRAND.domain}`, M, pH - 6);
    }
    doc.text(`Page ${p} of ${pages}`, W - M, pH - 9.5, { align: 'right' });
    doc.text(opts.documentNumber, W - M, pH - 6, { align: 'right' });
  }

  return doc;
}

async function svgToDataUrl(svg: string): Promise<string | null> {
  try {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = await loadImage(url);
    if (!img) { URL.revokeObjectURL(url); return null; }
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 120;
    canvas.height = img.naturalHeight || 120;
    const ctx = canvas.getContext('2d');
    if (!ctx) { URL.revokeObjectURL(url); return null; }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Document-specific builders
// ─────────────────────────────────────────────────────────────────────────────
const businessToDoc = (b: Business | DocBusiness): DocBusiness => b as DocBusiness;

const invoiceLines = (items: InvoiceItem[]): DocLine[] =>
  (items ?? []).map((i) => ({
    description: i.description,
    quantity: toNum(i.quantity),
    unit: i.unit,
    unit_price: toNum(i.unit_price),
    discount: toNum(i.discount_amount),
    tax_rate: toNum(i.tax_rate),
    tax_amount: toNum(i.tax_amount),
    line_total: toNum(i.line_total),
    notes: i.notes,
  }));

const quotationLines = (items: QuotationItem[]): DocLine[] =>
  (items ?? []).map((i) => ({
    description: i.description,
    quantity: toNum(i.quantity),
    unit: i.unit,
    unit_price: toNum(i.unit_price),
    discount: toNum(i.discount_amount),
    tax_rate: toNum(i.tax_rate),
    tax_amount: toNum(i.tax_amount),
    line_total: toNum(i.line_total),
    notes: i.notes,
  }));

const statusTone = (status?: string | null): 'neutral' | 'green' | 'red' | 'amber' => {
  switch (status) {
    case 'paid': case 'accepted': case 'signed': case 'approved': return 'green';
    case 'overdue': case 'rejected': case 'void': case 'cancelled': return 'red';
    case 'partially_paid': case 'sent': case 'viewed': case 'change_requested': return 'amber';
    default: return 'neutral';
  }
};

export interface InvoicePdfInput {
  invoice: Invoice;
  business: Business;
  items: InvoiceItem[];
  payments?: Payment[];
  origin?: string;
  branding?: { show?: boolean };
}

export async function buildInvoicePdf({ invoice, business, items, payments, origin, branding }: InvoicePdfInput): Promise<jsPDF> {
  const isCredit = invoice.kind === 'credit_note';
  const isDebit = invoice.kind === 'debit_note';
  const title = isCredit ? 'Credit note' : isDebit ? 'Debit note' : invoice.kind === 'proforma' ? 'Pro-forma invoice' : 'Invoice';

  return buildDocumentPdf({
    title,
    documentNumber: invoice.invoice_number,
    status: invoice.status,
    statusTone: statusTone(invoice.status),
    issueDate: invoice.issue_date,
    dueDate: invoice.due_date,
    currency: invoice.currency,
    business: businessToDoc(business),
    party: invoice.customer
      ? { label: isCredit ? 'Credited to' : 'Bill to', data: invoice.customer as DocParty }
      : null,
    lines: invoiceLines(items),
    subtotal: toNum(invoice.subtotal),
    discount: toNum(invoice.discount_total),
    tax: toNum(invoice.tax_total),
    delivery: toNum(invoice.delivery_fee),
    total: toNum(invoice.total),
    amountPaid: toNum(invoice.amount_paid) + toNum(invoice.amount_credited),
    balance: toNum(invoice.balance_due),
    payments: (payments ?? []).map((p) => ({
      date: p.received_at,
      method: PAYMENT_METHOD_LABELS[p.method] ?? p.method,
      reference: p.provider_reference ?? p.payment_number ?? undefined,
      amount: toNum(p.amount),
    })),
    terms: invoice.terms ?? business.invoice_terms,
    notes: invoice.notes,
    headerExtra: [
      ...(invoice.reference ? ([['Reference', invoice.reference]] as [string, string][]) : []),
      ...(invoice.terms_days ? ([['Payment terms', `${invoice.terms_days} days`]] as [string, string][]) : []),
    ],
    showPaymentDetails: !isCredit && toNum(invoice.balance_due) > 0,
    qr: invoice.qr_token || invoice.share_token
      ? {
          value: `${origin ?? ''}/verify/invoice/${invoice.qr_token ?? invoice.share_token}`,
          caption: `Scan to verify ${invoice.invoice_number}`,
        }
      : null,
    footer: isCredit
      ? `This credit note adjusts ${invoice.reference ?? 'the original invoice'}. ${BRAND.companyLine}`
      : business.invoice_footer,
    branding,
  });
}

export interface QuotationPdfInput {
  quotation: Quotation;
  business: Business;
  items: QuotationItem[];
  origin?: string;
  branding?: { show?: boolean };
}

export async function buildQuotationPdf({ quotation, business, items, origin, branding }: QuotationPdfInput): Promise<jsPDF> {
  const isProforma = quotation.kind === 'proforma';
  return buildDocumentPdf({
    title: isProforma ? 'Pro-forma invoice' : 'Quotation',
    documentNumber: quotation.quotation_number,
    status: quotation.status,
    statusTone: statusTone(quotation.status),
    issueDate: quotation.issue_date,
    dueDate: quotation.valid_until,
    currency: quotation.currency,
    business: businessToDoc(business),
    party: quotation.customer ? { label: 'Prepared for', data: quotation.customer as DocParty } : null,
    lines: quotationLines(items),
    subtotal: toNum(quotation.subtotal),
    discount: toNum(quotation.discount_total),
    tax: toNum(quotation.tax_total),
    delivery: toNum(quotation.delivery_fee),
    total: toNum(quotation.total),
    terms: quotation.terms ?? business.invoice_terms,
    notes: quotation.notes,
    headerExtra: [
      ['Valid until', formatDate(quotation.valid_until)],
      ...(quotation.delivery_method ? ([['Delivery', quotation.delivery_method]] as [string, string][]) : []),
    ],
    showPaymentDetails: isProforma,
    signature: quotation.signed_at
      ? { label: 'Accepted by', name: quotation.signer_name, date: quotation.signed_at }
      : { label: 'Authorised by' },
    qr: quotation.share_token
      ? {
          value: `${origin ?? ''}/q/${quotation.share_token}`,
          caption: `Scan to view, accept or sign ${quotation.quotation_number}`,
        }
      : null,
    footer: isProforma
      ? `This pro-forma invoice is not a tax invoice. ${BRAND.companyLine}`
      : `This quotation is valid for ${quotation.validity_days} days. ${BRAND.companyLine}`,
    branding,
  });
}

/**
 * Order confirmation / packing slip.
 *
 * Not a tax document — the invoice is. This is what the warehouse packs from
 * and what the customer receives with the goods, so it carries delivery detail,
 * the item list and the payment position.
 */
export interface OrderPdfInput {
  order: Order;
  items: OrderItem[];
  business: Business;
  customer?: { name?: string | null; email?: string | null; phone?: string | null } | null;
  payments?: Payment[];
  origin?: string;
  /** Hide prices — useful for a packing slip handed to a driver. */
  pricesOnly?: boolean;
}

export async function buildOrderPdf({ order, items, business, customer, payments, origin }: OrderPdfInput): Promise<jsPDF> {
  const cancelled = order.status === 'cancelled';
  const lines: DocLine[] = (items ?? []).map((i) => ({
    description: i.name,
    quantity: Math.round(toNum(i.quantity)),
    unit: i.unit,
    unit_price: toNum(i.unit_price),
    discount: toNum(i.discount_amount),
    tax_rate: toNum(i.tax_rate),
    tax_amount: toNum(i.tax_amount),
    line_total: toNum(i.line_total),
    notes: i.notes ?? (i.sku ? `SKU ${i.sku}` : null),
  }));

  const deliverTo = order.delivery_method === 'pickup'
    ? null
    : {
        name: order.shipping_name ?? customer?.name ?? 'Customer',
        phone: order.shipping_phone ?? customer?.phone ?? null,
        address_line1: order.shipping_line1 ?? null,
        city: order.shipping_city ?? null,
        region: order.shipping_region ?? null,
        country_code: order.shipping_country ?? business.country_code,
      };

  return buildDocumentPdf({
    title: cancelled ? 'Cancelled order' : order.delivery_method === 'pickup' ? 'Collection order' : 'Order confirmation',
    documentNumber: order.order_number,
    status: order.status,
    statusTone: cancelled ? 'red' : order.status === 'delivered' ? 'green' : 'amber',
    issueDate: order.placed_at,
    currency: order.currency,
    business: businessToDoc(business),
    party: deliverTo
      ? { label: 'Deliver to', data: deliverTo }
      : customer
        ? { label: 'Customer', data: { name: customer.name ?? 'Customer', email: customer.email ?? null, phone: customer.phone ?? null } }
        : null,
    lines,
    subtotal: toNum(order.subtotal),
    discount: toNum(order.discount_total),
    tax: toNum(order.tax_total),
    delivery: toNum(order.delivery_fee),
    tip: toNum(order.tip_amount),
    total: toNum(order.total),
    amountPaid: toNum(order.amount_paid),
    balance: toNum(order.balance_due),
    payments: (payments ?? []).map((p) => ({
      date: p.received_at,
      method: PAYMENT_METHOD_LABELS[p.method] ?? p.method,
      reference: p.provider_reference ?? p.payment_number ?? undefined,
      amount: toNum(p.amount),
    })),
    headerExtra: [
      ['Channel', (order.channel ?? 'manual').replace(/_/g, ' ')],
      ...(order.reference ? ([['Reference', order.reference]] as [string, string][]) : []),
      ...(order.tracking_number ? ([['Tracking', order.tracking_number]] as [string, string][]) : []),
      ...(order.driver_name ? ([['Driver', `${order.driver_name}${order.driver_phone ? ` · ${order.driver_phone}` : ''}`]] as [string, string][]) : []),
      ...(order.estimated_delivery_at ? ([['Estimated delivery', formatDate(order.estimated_delivery_at)]] as [string, string][]) : []),
      ...(order.served_by_name ? ([['Served by', order.served_by_name]] as [string, string][]) : []),
    ],
    notes: cancelled
      ? `Cancelled${order.cancellation_reason ? `: ${order.cancellation_reason}` : ''}`
      : (order.delivery_notes ?? order.customer_note ?? order.notes),
    terms: business.invoice_terms,
    showPaymentDetails: !cancelled && toNum(order.balance_due) > 0,
    qr: order.id ? {
      value: `${origin ?? ''}/orders/${order.id}`,
      caption: `Order ${order.order_number}`,
    } : null,
    footer: business.invoice_footer ?? BRAND.companyLine,
    columns: { discount: true, tax: true, unit: true },
  });
}

export async function buildReceiptPdf(args: {
  receipt: Receipt;
  business: Business;
  invoiceNumber?: string | null;
  orderNumber?: string | null;
  origin?: string;
  branding?: { show?: boolean };
}): Promise<jsPDF> {
  const { receipt, business, invoiceNumber, orderNumber, origin, branding } = args;
  const doc = new jsPDF({ unit: 'mm', format: [80, 200], compress: true });
  const W = doc.internal.pageSize.getWidth();
  const M = 5;
  let y = M + 2;

  const logo = await imageToDataUrl(business.logo_url);
  if (logo) {
    try { doc.addImage(logo.data, 'PNG', W / 2 - 9, y, 18, 18); y += 20; } catch { /* ignore */ }
  }

  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...DARK);
  doc.text(business.name.toUpperCase(), W / 2, y, { align: 'center' });
  y += 4;
  doc.setFont('courier', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  [
    [business.address_line1, business.city].filter(Boolean).join(', '),
    [business.phone, business.email].filter(Boolean).join(' · '),
    business.tax_number ? `Tax No. ${business.tax_number}` : null,
  ].filter(Boolean).forEach((l) => { doc.text(String(l), W / 2, y, { align: 'center' }); y += 3.2; });

  y += 1;
  doc.setDrawColor(200, 200, 200);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(M, y, W - M, y);
  doc.setLineDashPattern([], 0);
  y += 4;

  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...DARK);
  doc.text('RECEIPT', W / 2, y, { align: 'center' });
  y += 5;

  const rows: [string, string][] = [
    ['Receipt No', receipt.receipt_number],
    ...(invoiceNumber ? ([['Invoice No', invoiceNumber]] as [string, string][]) : []),
    ...(orderNumber ? ([['Order No', orderNumber]] as [string, string][]) : []),
    ['Date', formatDate(receipt.received_at)],
    ['Customer', receipt.customer_name ?? 'Walk-in'],
    ['Method', (PAYMENT_METHOD_LABELS[receipt.method as PaymentMethod] ?? receipt.method).replace('_', ' ')],
  ];

  doc.setFontSize(8);
  rows.forEach(([label, value]) => {
    doc.setFont('courier', 'normal');
    doc.setTextColor(...MUTED);
    doc.text(label, M, y);
    doc.setFont('courier', 'bold');
    doc.setTextColor(...DARK);
    doc.text(String(value).slice(0, 26), W - M, y, { align: 'right' });
    y += 3.6;
  });

  y += 1;
  doc.setDrawColor(200, 200, 200);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(M, y, W - M, y);
  doc.setLineDashPattern([], 0);
  y += 6;

  doc.setFont('courier', 'bold');
  doc.setFontSize(13);
  doc.text('AMOUNT PAID', M, y);
  doc.text(formatMoney(receipt.amount, receipt.currency), W - M, y, { align: 'right' });
  y += 5;
  if (toNum(receipt.balance_after) > 0) {
    doc.setFontSize(8.5);
    doc.setTextColor(...RED);
    doc.text('Balance due', M, y);
    doc.text(formatMoney(receipt.balance_after, receipt.currency), W - M, y, { align: 'right' });
    y += 4;
  } else {
    doc.setFontSize(8.5);
    doc.setTextColor(...GREEN);
    doc.text('Paid in full — thank you', M, y);
    y += 4;
  }

  doc.setTextColor(...MUTED);
  if (receipt.notes) {
    y += 1;
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.5);
    wrap(doc, receipt.notes, W - M * 2, 7.5).slice(0, 3).forEach((l) => { doc.text(l, M, y); y += 3.2; });
  }

  // Verification QR
  const token = receipt.qr_token ?? receipt.share_token;
  if (token) {
    const svg = await renderBarcode(`${origin ?? ''}/verify/receipt/${token}`, { format: 'qrcode', scale: 2 });
    const dataUrl = svg ? await imageToDataUrl(await svgToDataUrl(svg)) : null;
    if (dataUrl) {
      y += 2;
      try { doc.addImage(dataUrl.data, 'PNG', W / 2 - 13, y, 26, 26); y += 28; } catch { /* ignore */ }
      doc.setFont('courier', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...MUTED);
      doc.text('Scan to verify this receipt', W / 2, y, { align: 'center' });
      y += 4;
    }
  }

  if (receipt.signed_by_name || receipt.created_by_name) {
    y += 2;
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`Served by: ${receipt.signed_by_name ?? receipt.created_by_name ?? ''}`, W / 2, y, { align: 'center' });
    y += 4;
  }

  doc.setLineDashPattern([1, 1], 0);
  doc.line(M, y, W - M, y);
  doc.setLineDashPattern([], 0);
  y += 4;
  doc.setFontSize(7);
  doc.text('Thank you for your business.', W / 2, y, { align: 'center' });
  y += 3.4;

  const showBranding = branding?.show ?? true;
  if (showBranding) {
    // "Powered by Seedwel Hub" watermark from the real wordmark asset.
    const brandLogo = await imageToDataUrl('/brand/wordmarklogo.png');
    if (brandLogo) {
      const bw = 26;
      const bh = 26 / (brandLogo.w / Math.max(brandLogo.h, 1));
      try { doc.addImage(brandLogo.data, 'PNG', W / 2 - bw / 2, y, bw, bh); y += bh + 2; } catch { /* fall through */ }
    }
    doc.setFontSize(6);
    doc.setTextColor(...MUTED);
    doc.text('Powered by Seedwel Hub', W / 2, y, { align: 'center' });
    y += 3;
  }
  doc.setFontSize(6);
  doc.text(`${BRAND.name} · ${BRAND.domain}`, W / 2, y, { align: 'center' });
  y += 3;
  doc.text(BRAND.companyLine, W / 2, y, { align: 'center' });

  // Trim the page to the used height so it prints like a real till roll.
  const finalH = Math.max(90, y + 6);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).internal.pageSize.setHeight(finalH);
  return doc;
}

/**
 * Counter (POS) receipt — 80 mm till roll with the item list, tax breakdown,
 * tenders and change. Printed straight from the POS after a sale.
 */
export async function buildPosReceiptPdf(args: {
  order: Order;
  items: OrderItem[];
  business: Business;
  receipt?: { receipt_number?: string | null; received_at?: string } | null;
  payments?: { method: string; provider?: string | null; reference?: string | null; amount: number }[];
  tendered?: number | null;
  change?: number | null;
  customerName?: string | null;
  servedBy?: string | null;
  origin?: string;
}): Promise<jsPDF> {
  const { order, items, business, receipt, payments, tendered, change, customerName, servedBy, origin } = args;
  const cur = order.currency;
  const height = Math.max(120, 70 + (items?.length ?? 0) * 9 + (payments?.length ?? 0) * 5);
  const doc = new jsPDF({ unit: 'mm', format: [80, height], compress: true });
  const W = doc.internal.pageSize.getWidth();
  const M = 5;
  let y = M + 2;

  const dash = () => {
    doc.setDrawColor(200, 200, 200);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(M, y, W - M, y);
    doc.setLineDashPattern([], 0);
    y += 3.5;
  };
  const left = (label: string, value: string, bold = false, size = 8) => {
    doc.setFont('courier', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(bold ? 17 : 107, bold ? 24 : 114, bold ? 39 : 128);
    doc.text(label, M, y);
    doc.text(value, W - M, y, { align: 'right' });
    y += size > 9 ? 5 : 3.6;
  };
  const centre = (text: string, bold = false, size = 8) => {
    doc.setFont('courier', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(17, 24, 39);
    const lines = wrap(doc, text, W - M * 2, size);
    lines.forEach((l) => { doc.text(l, W / 2, y, { align: 'center' }); y += size * 0.45; });
    y += 1;
  };

  const logo = await imageToDataUrl(business.logo_url);
  if (logo) {
    try { doc.addImage(logo.data, 'PNG', W / 2 - 9, y, 18, 18); y += 20; } catch { /* ignore */ }
  }

  centre(business.name.toUpperCase(), true, 11);
  doc.setFont('courier', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  ([
    [business.address_line1, business.city].filter(Boolean).join(', '),
    [business.phone, business.email].filter(Boolean).join(' · '),
    business.tax_number ? `Tax No. ${business.tax_number}` : null,
  ].filter(Boolean) as string[]).forEach((l) => { doc.text(l, W / 2, y, { align: 'center' }); y += 3.2; });

  y += 1;
  dash();
  centre(receipt?.receipt_number ? 'SALES RECEIPT' : 'SALES SLIP', true, 10);

  left('Receipt', receipt?.receipt_number ?? '—', true);
  left('Order', order.order_number);
  left('Date', formatDate(receipt?.received_at ?? order.placed_at));
  left('Served by', servedBy ?? order.served_by_name ?? '—');
  left('Customer', customerName ?? order.shipping_name ?? 'Walk-in');
  dash();

  // Items
  (items ?? []).forEach((it) => {
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(17, 24, 39);
    const nameLines = wrap(doc, it.name, W - M * 2 - 18, 8);
    doc.text(nameLines[0] ?? it.name, M, y);
    doc.text(formatMoney(it.line_total, cur), W - M, y, { align: 'right' });
    y += 3.6;
    nameLines.slice(1, 3).forEach((l) => { doc.text(l, M, y); y += 3.4; });
    doc.setFontSize(7);
    doc.setTextColor(107, 114, 128);
    doc.text(`  ${Math.round(toNum(it.quantity))} ${it.unit ?? ''} @ ${formatMoney(it.unit_price, cur)}`, M, y);
    y += 3.2;
    if (toNum(it.discount_amount) > 0) {
      doc.text(`  discount -${formatMoney(it.discount_amount, cur)}`, M, y);
      y += 3.2;
    }
  });

  dash();
  left('Subtotal', formatMoney(order.subtotal, cur));
  if (toNum(order.discount_total) > 0) left('Discount', `-${formatMoney(order.discount_total, cur)}`);
  if (toNum(order.tax_total) > 0) left('Tax', formatMoney(order.tax_total, cur));
  if (toNum(order.delivery_fee) > 0) left('Delivery', formatMoney(order.delivery_fee, cur));
  if (toNum(order.tip_amount) > 0) left('Tip', formatMoney(order.tip_amount, cur));
  y += 1;
  left('TOTAL', formatMoney(order.total, cur), true, 12);
  y += 1;
  dash();

  (payments ?? []).forEach((p) => {
    const method = (PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method).replace('_', ' ');
    left(method, formatMoney(p.amount, cur), false, 8);
    if (p.reference) {
      doc.setFont('courier', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(107, 114, 128);
      doc.text(`  ref ${p.reference}`.slice(0, 40), M, y);
      y += 3;
    }
  });
  if (payments?.length) dash();

  if (toNum(order.amount_paid) > 0) left('Paid', formatMoney(order.amount_paid, cur), true);
  if (tendered && tendered > 0) left('Tendered', formatMoney(tendered, cur));
  if (change && change > 0) left('CHANGE', formatMoney(change, cur), true, 11);
  if (toNum(order.balance_due) > 0) left('Balance due', formatMoney(order.balance_due, cur), true);

  y += 1;
  dash();

  // Verify QR — the buyer can scan to check the receipt is genuine.
  try {
    const svg = await renderBarcode(`${origin ?? ''}/verify/receipt/${order.order_number}`, { format: 'qrcode', scale: 1.6 });
    const dataUrl = svg ? await imageToDataUrl(await svgToDataUrl(svg)) : null;
    if (dataUrl) { doc.addImage(dataUrl.data, 'PNG', W / 2 - 11, y, 22, 22); y += 24; }
  } catch { /* a receipt must still print without the QR */ }

  centre('Thank you for your business.', false, 7.5);
  if (business.invoice_footer) centre(business.invoice_footer, false, 6.5);
  centre(`${BRAND.name} · ${BRAND.domain}`, false, 6);
  centre(BRAND.companyLine, false, 5.5);

  const finalH = Math.max(90, y + 6);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).internal.pageSize.setHeight(finalH);
  return doc;
}

export interface StatementRow {
  date: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export async function buildStatementPdf(args: {
  business: Business;
  customer: DocParty;
  from: string;
  to: string;
  opening: number;
  closing: number;
  rows: StatementRow[];
  currency: string;
}): Promise<jsPDF> {
  const { business, customer, from, to, opening, closing, rows, currency } = args;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;

  doc.setFillColor(...hexToRgb(business.primary_color));
  doc.rect(0, 0, W, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...hexToRgb(business.primary_color));
  doc.text('STATEMENT OF ACCOUNT', M, 22);
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.setFont('helvetica', 'normal');
  doc.text(`${formatDate(from)} — ${formatDate(to)}`, M, 28);
  doc.text(business.name, W - M, 22, { align: 'right' });
  doc.text([business.phone, business.email].filter(Boolean).join(' · '), W - M, 27, { align: 'right' });

  doc.setFillColor(...LIGHT);
  doc.roundedRect(M, 34, 90, 26, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('STATEMENT FOR', M + 4, 40);
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.text(customer.company_name || customer.name, M + 4, 46);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  let py = 50.5;
  [customer.address_line1, [customer.city, customer.region].filter(Boolean).join(', '), customer.phone, customer.email]
    .filter(Boolean)
    .forEach((l) => { doc.text(String(l), M + 4, py); py += 3.4; });

  autoTable(doc, {
    startY: 66,
    head: [['Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance']],
    body: [
      ['', '', 'Opening balance', '', '', formatMoney(opening, currency)],
      ...rows.map((r) => [
        formatDate(r.date), r.reference, r.description,
        r.debit ? formatMoney(r.debit, currency) : '',
        r.credit ? formatMoney(r.credit, currency) : '',
        formatMoney(r.balance, currency),
      ]),
      ['', '', 'Closing balance', '', '', formatMoney(closing, currency)],
    ],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, lineColor: [229, 231, 235], lineWidth: 0.1 },
    headStyles: { fillColor: hexToRgb(business.primary_color), textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: [250, 250, 251] },
    columnStyles: {
      0: { cellWidth: 22 }, 1: { cellWidth: 26 }, 2: { cellWidth: 'auto' },
      3: { cellWidth: 24, halign: 'right' }, 4: { cellWidth: 24, halign: 'right' },
      5: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && (data.row.index === 0 || data.row.index === rows.length + 1)) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [236, 253, 245];
      }
    },
    margin: { left: M, right: M },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fy = ((doc as any).lastAutoTable?.finalY ?? 80) + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.text('CLOSING BALANCE', M, fy);
  doc.setTextColor(...(toNum(closing) > 0 ? RED : GREEN));
  doc.text(formatMoney(closing, currency), W - M, fy, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    toNum(closing) > 0
      ? 'Please settle the outstanding balance according to the agreed terms.'
      : 'This account is settled. Thank you for your business.',
    M, fy + 6,
  );

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    const pH = doc.internal.pageSize.getHeight();
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(`${BRAND.name} · ${BRAND.domain}`, M, pH - 8);
    doc.text(`Page ${p} of ${pages}`, W - M, pH - 8, { align: 'right' });
  }
  return doc;
}

/** Printable price tags / barcode labels (A4 sheet or single label). */
export async function buildLabelSheet(args: {
  labels: {
    name: string;
    price: number;
    currency: string;
    sku?: string | null;
    barcode?: string | null;
    barcodeFormat?: string;
    businessName?: string;
    unit?: string;
    compareAt?: number | null;
  }[];
  size?: { w: number; h: number };
  perRow?: number;
  showBarcode?: boolean;
}): Promise<jsPDF> {
  const { labels, size = { w: 70, h: 37 }, perRow = 2, showBarcode = true } = args;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 8;
  const gap = 3;
  const usable = pageW - margin * 2;
  const cols = Math.max(1, Math.min(perRow, Math.floor((usable + gap) / (size.w + gap))));
  const labelW = cols === 1 ? usable : size.w;
  const rows = Math.max(1, Math.floor((pageH - margin * 2 + gap) / (size.h + gap)));

  for (let i = 0; i < labels.length; i += 1) {
    const pageIdx = Math.floor(i / (cols * rows));
    if (pageIdx > 0 && i % (cols * rows) === 0) doc.addPage();
    const inPage = i % (cols * rows);
    const col = inPage % cols;
    const row = Math.floor(inPage / cols);
    const x = margin + col * (labelW + gap);
    const y = margin + row * (size.h + gap);
    const l = labels[i];

    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1.2, 1.2], 0);
    doc.roundedRect(x, y, labelW, size.h, 1.5, 1.5, 'S');
    doc.setLineDashPattern([], 0);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    const nameLines = wrap(doc, l.name.toUpperCase(), labelW - 6, 7.5);
    nameLines.slice(0, 2).forEach((line, li) => doc.text(line, x + 3, y + 5.5 + li * 3.4));

    doc.setFontSize(13);
    doc.setTextColor(...TEAL);
    doc.text(formatMoney(l.price, l.currency), x + 3, y + 16);

    if (l.compareAt && toNum(l.compareAt) > toNum(l.price)) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
      const old = formatMoney(l.compareAt, l.currency);
      doc.text(old, x + 3 + doc.getTextWidth(formatMoney(l.price, l.currency)) + 2, y + 16);
      const w = doc.getTextWidth(old);
      doc.setDrawColor(...MUTED);
      doc.setLineWidth(0.25);
      doc.line(x + 3 + doc.getTextWidth(formatMoney(l.price, l.currency)) + 2, y + 14.6,
        x + 3 + doc.getTextWidth(formatMoney(l.price, l.currency)) + 2 + w, y + 14.6);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    const meta = [l.sku && `SKU ${l.sku}`, l.unit && l.unit !== 'piece' ? `per ${l.unit}` : null, l.businessName]
      .filter(Boolean).join(' · ');
    if (meta) doc.text(wrap(doc, meta, labelW - 6, 6.5)[0] ?? '', x + 3, y + 21);

    if (showBarcode && l.barcode) {
      const svg = await renderBarcode(l.barcode, {
        format: (l.barcodeFormat as never) ?? 'code128',
        height: 8, scale: 2, showText: true,
      });
      const dataUrl = svg ? await imageToDataUrl(await svgToDataUrl(svg)) : null;
      if (dataUrl) {
        const bw = labelW - 8;
        const bh = 11;
        try { doc.addImage(dataUrl.data, 'PNG', x + 4, y + size.h - bh - 3, bw, bh); } catch { /* ignore */ }
      }
    }
  }
  return doc;
}

// ── Helpers shared by the UI ─────────────────────────────────────────────────
export function savePdf(doc: jsPDF, filename: string): void {
  doc.save(filename.replace(/[^\w.\-]+/g, '_'));
}

export async function pdfBlob(doc: jsPDF): Promise<Blob> {
  return doc.output('blob') as Blob;
}

export function pdfDataUrl(doc: jsPDF): string {
  return doc.output('datauristring');
}

export function printPdf(doc: jsPDF, title: string): void {
  const url = doc.output('bloburl') as URL;
  const win = window.open(String(url), '_blank', 'noopener');
  if (win) {
    win.addEventListener('load', () => {
      try { win.focus(); win.print(); } catch { /* browser blocked */ }
    });
  } else {
    window.open(String(url), '_blank', 'noopener');
  }
  document.title = title;
}
