import Papa from 'papaparse';

/**
 * CSV import & synchronisation.
 *
 * Flow: read (upload or URL) → detect headers → suggest a column mapping →
 * preview → validate → import. The database performs the actual write through
 * import_csv_rows() so stock changes stay in the auditable inventory ledger.
 */

/** Every Seedwel field a CSV column can be mapped to. */
export const MAPPABLE_FIELDS = [
  { key: 'name', label: 'Product name', required: true, example: 'Black leather shoes' },
  { key: 'sku', label: 'SKU', required: false, example: 'SHOE-BLK-42' },
  { key: 'barcode', label: 'Barcode', required: false, example: '6001234567890' },
  { key: 'price', label: 'Price', required: true, example: '499.00' },
  { key: 'cost', label: 'Cost price', required: false, example: '310.00' },
  { key: 'wholesale_price', label: 'Wholesale price', required: false, example: '425.00' },
  { key: 'stock', label: 'Stock / quantity', required: false, example: '24' },
  { key: 'category', label: 'Category', required: false, example: 'Shoes & Bags' },
  { key: 'brand', label: 'Brand', required: false, example: 'Bata' },
  { key: 'description', label: 'Description', required: false, example: 'Genuine leather…' },
  { key: 'image', label: 'Image URL', required: false, example: 'https://…/shoe.jpg' },
  { key: 'weight', label: 'Weight (kg)', required: false, example: '0.8' },
  { key: 'unit', label: 'Unit', required: false, example: 'pair' },
  { key: 'condition', label: 'Condition', required: false, example: 'new' },
] as const;

export type MappableField = (typeof MAPPABLE_FIELDS)[number]['key'];

/** Header spellings recognised when auto-suggesting a mapping. */
const HEADER_ALIASES: Record<MappableField, string[]> = {
  name: ['name', 'product', 'product name', 'productname', 'title', 'item', 'item name', 'description short', 'artikel', 'item description'],
  sku: ['sku', 'code', 'product code', 'item code', 'article', 'article number', 'articleno', 'product id', 'item id', 'stock code'],
  barcode: ['barcode', 'bar code', 'ean', 'ean13', 'upc', 'gtin', 'isbn'],
  price: ['price', 'selling price', 'sell price', 'retail price', 'retail', 'unit price', 'amount', 'sale price', 'rrp', 'mrp'],
  cost: ['cost', 'cost price', 'buy price', 'purchase price', 'unit cost', 'cogs', 'costprice'],
  wholesale_price: ['wholesale', 'wholesale price', 'bulk price', 'trade price', 'dealer price'],
  stock: ['stock', 'qty', 'quantity', 'on hand', 'onhand', 'stock on hand', 'available', 'inventory', 'balance', 'count'],
  category: ['category', 'cat', 'group', 'product category', 'department', 'type', 'collection'],
  brand: ['brand', 'make', 'manufacturer', 'vendor', 'supplier'],
  description: ['description', 'desc', 'details', 'long description', 'product description', 'notes'],
  image: ['image', 'image url', 'img', 'photo', 'photo url', 'picture', 'picture url', 'images', 'imageurl'],
  weight: ['weight', 'weight kg', 'mass', 'kg'],
  unit: ['unit', 'uom', 'unit of measure', 'pack size', 'measure'],
  condition: ['condition', 'state', 'new or used'],
};

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
  delimiter: string;
  /** First N rows for the preview table. */
  preview: Record<string, string>[];
  raw: string;
}

export interface CsvMapping {
  [field: string]: string;
}

export interface ValidationIssue {
  row: number;
  field: string;
  value: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  total: number;
  valid: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** Row number → normalised record ready for the import RPC. */
  normalised: Record<string, unknown>[];
}

const PREVIEW_ROWS = 8;
const MAX_PREVIEW_ERRORS = 200;

/** Detect the delimiter from the first non-empty line. */
export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const c of candidates) {
    const count = line.split(c).length - 1;
    if (count > bestCount) { bestCount = count; best = c; }
  }
  return bestCount > 0 ? best : ',';
}

export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const delim = delimiter ?? detectDelimiter(text);
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    delimiter: delim,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });

  const headers = result.meta.fields ?? [];
  const rows = result.data ?? [];
  return {
    headers,
    rows,
    totalRows: rows.length,
    delimiter: delim,
    preview: rows.slice(0, PREVIEW_ROWS),
    raw: text,
  };
}

export async function parseCsvFile(file: File, delimiter?: string): Promise<ParsedCsv> {
  const text = await file.text();
  return parseCsv(text, delimiter);
}

/** Fetch a remote CSV (seller's own system) and parse it. */
export async function parseCsvUrl(url: string, delimiter?: string): Promise<ParsedCsv> {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`Could not fetch ${url} (HTTP ${res.status})`);
  const text = await res.text();
  return parseCsv(text, delimiter);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Suggest a mapping from the header row. */
export function suggestMapping(headers: string[]): CsvMapping {
  const mapping: CsvMapping = {};
  const used = new Set<string>();

  for (const field of MAPPABLE_FIELDS) {
    const aliases = HEADER_ALIASES[field.key].map(norm);
    // Exact match first, then "contains".
    let match = headers.find((h) => !used.has(h) && aliases.includes(norm(h)));
    if (!match) match = headers.find((h) => !used.has(h) && aliases.some((a) => norm(h).includes(a)));
    if (match) {
      mapping[field.key] = match;
      used.add(match);
    }
  }
  return mapping;
}

export function unmappedRequiredFields(mapping: CsvMapping): MappableField[] {
  return MAPPABLE_FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.key);
}

/** Strip currency symbols, spaces and thousand separators. */
export function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  const cleaned = s.replace(/[^0-9.,\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalised = cleaned;
  if (lastComma > -1 && lastDot > -1) {
    normalised = lastComma > lastDot
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (lastComma > -1) {
    normalised = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  } else {
    normalised = cleaned.replace(/,/g, '');
  }
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

export function parseInteger(value: unknown): number | null {
  const n = parseNumeric(value);
  return n === null ? null : Math.round(n);
}

/** Validate + normalise every row against the mapping. */
export function validateRows(
  parsed: ParsedCsv,
  mapping: CsvMapping,
  opts: { matchStrategy?: string; currency?: string } = {},
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const normalised: Record<string, unknown>[] = [];
  const seenKeys = new Map<string, number>();
  const matchStrategy = opts.matchStrategy ?? 'sku';

  parsed.rows.forEach((row, index) => {
    const rowNum = index + 2; // +1 for the header row, +1 for 1-based display
    const get = (field: MappableField) => {
      const col = mapping[field];
      return col ? (row[col] ?? '') : '';
    };

    const name = String(get('name')).trim();
    const sku = String(get('sku')).trim();
    const priceRaw = get('price');
    const price = parseNumeric(priceRaw);
    const stock = parseInteger(get('stock')) ?? 0;
    const cost = parseNumeric(get('cost')) ?? 0;

    const push = (field: string, value: string, message: string, severity: 'error' | 'warning') => {
      const issue = { row: rowNum, field, value, message, severity };
      if (severity === 'error') {
        if (errors.length < MAX_PREVIEW_ERRORS) errors.push(issue);
      } else if (warnings.length < MAX_PREVIEW_ERRORS) {
        warnings.push(issue);
      }
    };

    let rowHasError = false;
    if (!name && !sku) {
      push('name', name, 'Row has neither a product name nor a SKU.', 'error');
      rowHasError = true;
    }
    if (price === null) {
      push('price', String(priceRaw), priceRaw ? `"${priceRaw}" is not a number.` : 'Price is missing.', 'error');
      rowHasError = true;
    } else if (price < 0) {
      push('price', String(priceRaw), 'Price cannot be negative.', 'error');
      rowHasError = true;
    } else if (price === 0) {
      push('price', String(priceRaw), 'Price is 0 — the product will be free.', 'warning');
    }

    if (cost && price !== null && cost > price) {
      push('cost', String(get('cost')), `Cost (${cost}) is above the selling price (${price}).`, 'warning');
    }

    const matchKey = matchStrategy === 'barcode' ? String(get('barcode')).trim()
      : matchStrategy === 'name' ? name.toLowerCase()
        : sku;
    if (matchKey) {
      if (seenKeys.has(matchKey)) {
        push(matchStrategy, matchKey, `Duplicate ${matchStrategy} — also on row ${seenKeys.get(matchKey)}.`, 'warning');
      } else {
        seenKeys.set(matchKey, rowNum);
      }
    } else if (matchStrategy === 'sku') {
      push('sku', '', 'No SKU: matching will fall back to the product name.', 'warning');
    }

    const image = String(get('image')).trim();
    if (image && !/^https?:\/\//i.test(image) && !image.startsWith('data:')) {
      push('image', image, 'Image URL must start with http(s)://', 'warning');
    }

    if (rowHasError) {
      normalised.push({ __row: rowNum, __invalid: true });
      return;
    }

    normalised.push({
      __row: rowNum,
      name: name || sku,
      sku: sku || undefined,
      barcode: String(get('barcode')).trim() || undefined,
      price: price ?? 0,
      cost,
      wholesale_price: parseNumeric(get('wholesale_price')) ?? undefined,
      stock,
      category: String(get('category')).trim() || undefined,
      brand: String(get('brand')).trim() || undefined,
      description: String(get('description')).trim() || undefined,
      image,
      weight: parseNumeric(get('weight')) ?? undefined,
      unit: String(get('unit')).trim() || undefined,
      condition: String(get('condition')).trim().toLowerCase() || undefined,
      currency: opts.currency ?? 'ZMW',
    });
  });

  return {
    total: parsed.totalRows,
    valid: normalised.filter((r) => !r.__invalid).length,
    errors,
    warnings,
    normalised: normalised.filter((r) => !r.__invalid),
  };
}

/** Rows are sent in batches so a 10,000-line CSV does not blow one request. */
export function chunk<T>(items: T[], size = 250): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Build a downloadable CSV template with the canonical Seedwel headers. */
export function templateCsv(): string {
  const headers = ['Product Name', 'SKU', 'Barcode', 'Price', 'Cost', 'Wholesale Price',
    'Stock', 'Category', 'Brand', 'Description', 'Image URL', 'Weight', 'Unit', 'Condition'];
  const example = ['Black leather formal shoes', 'SHOE-BLK-42', '6001234567890', '499.00',
    '310.00', '425.00', '24', 'Shoes & Bags', 'Bata', 'Genuine leather formal shoes, size 42.',
    'https://example.com/shoe.jpg', '0.8', 'pair', 'new'];
  return Papa.unparse({ fields: headers, data: [example] });
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Export any array of objects to CSV (reports, product lists, ledgers). */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '';
  const fields = columns ?? Object.keys(rows[0]);
  return Papa.unparse({
    fields,
    data: rows.map((r) => fields.map((f) => {
      const v = r[f];
      if (v === null || v === undefined) return '';
      if (Array.isArray(v)) return v.join('; ');
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    })),
  });
}

/** Export to Excel-compatible XML (opens directly in Excel/LibreOffice/Sheets). */
export function toExcelXml(sheetName: string, rows: Record<string, unknown>[], columns?: string[]): string {
  const fields = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const body = rows.map((r) => {
    const cells = fields.map((f) => {
      const v = r[f];
      const isNum = typeof v === 'number' && Number.isFinite(v);
      const text = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v);
      return isNum
        ? `<Cell><Data ss:Type="Number">${text}</Data></Cell>`
        : `<Cell><Data ss:Type="String">${esc(text)}</Data></Cell>`;
    }).join('');
    return `<Row>${cells}</Row>`;
  }).join('');

  const header = `<Row>${fields.map((f) => `<Cell><Data ss:Type="String">${esc(f)}</Data></Cell>`).join('')}</Row>`;

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${esc(sheetName.slice(0, 30))}">
  <Table>${header}${body}</Table>
 </Worksheet>
</Workbook>`;
}

export function downloadExcel(sheetName: string, filename: string, rows: Record<string, unknown>[], columns?: string[]): void {
  downloadText(filename.endsWith('.xls') ? filename : `${filename}.xls`,
    toExcelXml(sheetName, rows, columns), 'application/vnd.ms-excel');
}
