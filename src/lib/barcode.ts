// The browser build exposes toSVG/toCanvas; the package root resolves to the
// Node build under moduleResolution=bundler, which has neither.
import bwipjs from 'bwip-js/browser';

export type BarcodeFormat = 'code128' | 'ean13' | 'upca' | 'ean8' | 'code39' | 'itf' | 'qrcode';

const BWIP_NAMES: Record<BarcodeFormat, string> = {
  code128: 'code128',
  ean13: 'ean13',
  upca: 'upca',
  ean8: 'ean8',
  code39: 'code39',
  itf: 'itf',
  qrcode: 'qrcode',
};

export interface BarcodeOptions {
  format?: BarcodeFormat;
  height?: number;
  width?: number;
  scale?: number;
  showText?: boolean;
  text?: string;
  background?: string;
  color?: string;
}

/**
 * Render a barcode or QR code to a PNG data URL.
 *
 * Used for: product barcodes, shelf/price labels, QR codes on invoices,
 * receipts, quotations, payment links and business cards.
 */
export async function renderBarcode(value: string, opts: BarcodeOptions = {}): Promise<string | null> {
  if (!value) return null;
  const format = opts.format ?? 'code128';
  const isQr = format === 'qrcode';

  try {
    return await bwipjs.toSVG({
      bcid: BWIP_NAMES[format] ?? 'code128',
      text: value,
      scale: opts.scale ?? 3,
      height: isQr ? undefined : (opts.height ?? 12),
      width: isQr ? undefined : opts.width,
      includetext: !isQr && (opts.showText ?? true),
      textxalign: 'center',
      textsize: 9,
      backgroundcolor: opts.background ? opts.background.replace('#', '') : undefined,
      barcolor: opts.color ? opts.color.replace('#', '') : undefined,
      // QR error correction so labels survive a scruffy counter.
      eclevel: isQr ? 'M' : undefined,
    } as never);
  } catch {
    return null;
  }
}

/** Draw into a canvas element (for label previews and printing). */
export async function renderBarcodeToCanvas(
  canvas: HTMLCanvasElement,
  value: string,
  opts: BarcodeOptions = {},
): Promise<boolean> {
  if (!value) return false;
  const format = opts.format ?? 'code128';
  try {
    await bwipjs.toCanvas(canvas, {
      bcid: BWIP_NAMES[format] ?? 'code128',
      text: value,
      scale: opts.scale ?? 2,
      height: format === 'qrcode' ? undefined : (opts.height ?? 12),
      includetext: format !== 'qrcode' && (opts.showText ?? true),
      textxalign: 'center',
      backgroundcolor: opts.background ? opts.background.replace('#', '') : 'ffffff',
    } as never);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a barcode value for a product that does not have one.
 * Seedwel-internal codes are prefixed SH so they never collide with a real
 * EAN/UPC assigned by a standards body — printing a fake EAN is illegal.
 */
export function generateInternalBarcode(prefix = 'SH'): string {
  const body = String(Date.now()).slice(-8) + String(Math.floor(Math.random() * 100)).padStart(2, '0');
  const raw = `${prefix}${body}`;
  return `${raw}${mod10CheckDigit(raw)}`;
}

/** Mod-10 (Luhn) check digit, as used by EAN/UPC/ITF. */
export function mod10CheckDigit(digits: string): number {
  const only = digits.replace(/\D/g, '');
  let sum = 0;
  for (let i = 0; i < only.length; i += 1) {
    const d = Number(only[only.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 13) return false;
  return Number(digits[12]) === mod10CheckDigit(digits.slice(0, 12));
}

/** Guess the symbology from the shape of a scanned/typed code. */
export function detectFormat(code: string): BarcodeFormat {
  const digits = code.replace(/\D/g, '');
  if (/^https?:\/\//i.test(code) || code.length > 40) return 'qrcode';
  if (digits.length === 13 && digits === code) return 'ean13';
  if (digits.length === 12 && digits === code) return 'upca';
  if (digits.length === 8 && digits === code) return 'ean8';
  if (/^[A-Z0-9-]+$/.test(code.toUpperCase())) return 'code128';
  return 'code128';
}

/** Payload embedded in the QR code printed on documents for verification. */
/**
 * Payload embedded in the QR code printed on documents. The document number is
 * part of the verify URL so a printed page is self-describing.
 */
export function documentQrPayload(kind: string, number: string, token: string, origin: string): string {
  return `${origin}/verify/${kind}/${encodeURIComponent(number)}?t=${token}`;
}

export const LABEL_SIZES = [
  { key: '40x25', label: '40 × 25 mm (small shelf tag)', w: 40, h: 25 },
  { key: '50x30', label: '50 × 30 mm (standard)', w: 50, h: 30 },
  { key: '60x40', label: '60 × 40 mm (large)', w: 60, h: 40 },
  { key: '70x50', label: '70 × 50 mm (price tag)', w: 70, h: 50 },
  { key: 'a4-24', label: 'A4 sheet · 24 labels', w: 70, h: 37 },
] as const;

export type LabelSize = (typeof LABEL_SIZES)[number];
