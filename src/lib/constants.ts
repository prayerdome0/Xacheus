import type { MemberRole, PaymentMethod } from '@/types';

export const BRAND = {
  name: 'Seedwel Hub',
  short: 'Seedwel',
  company: 'Seedwel Investment Limited',
  companyLine: 'A product of Seedwel Investment Limited',
  tagline: 'Buy. Sell. Manage. Grow.',
  hero: 'Everything Your Business Needs. In One Place.',
  subHero:
    'Buy, sell, connect, manage your business and grow with Seedwel Hub.',
  searchPlaceholder: 'Search products, services, businesses…',
  domain: 'seedwelhub.com',
  supportEmail: 'support@seedwelhub.com',
  supportWhatsApp: '260970000000',
} as const;

// ── Navigation ──────────────────────────────────────────────────────────────
export interface NavItem {
  label: string;
  to: string;
  icon: string;
  description?: string;
}

/** Public site navigation (header). */
export const PUBLIC_NAV: NavItem[] = [
  { label: 'Home', to: '/', icon: '🏠' },
  { label: 'Marketplace', to: '/marketplace', icon: '🛍️' },
  { label: 'Products', to: '/products', icon: '📦' },
  { label: 'Services', to: '/services', icon: '🛠️' },
  { label: 'Businesses', to: '/businesses', icon: '🏢' },
  { label: 'Wholesale', to: '/wholesale', icon: '📦' },
  { label: 'Categories', to: '/categories', icon: '🗂️' },
  { label: 'Deals', to: '/deals', icon: '🔥' },
  { label: 'Nearby', to: '/nearby', icon: '📍' },
];

export const MORE_NAV: NavItem[] = [
  { label: 'Become a seller', to: '/become-a-seller', icon: '🚀' },
  { label: 'Business solutions', to: '/business-solutions', icon: '🧰' },
  { label: 'Pricing', to: '/pricing', icon: '💎' },
  { label: 'Business Academy', to: '/academy', icon: '🎓' },
  { label: 'About Seedwel Hub', to: '/about', icon: 'ℹ️' },
  { label: 'Help centre', to: '/help', icon: '🆘' },
  { label: 'Contact', to: '/contact', icon: '✉️' },
];

/** Phone-first bottom navigation (buyer / shopper mode). */
export const BOTTOM_NAV: NavItem[] = [
  { label: 'Home', to: '/', icon: 'home' },
  { label: 'Search', to: '/search', icon: 'search' },
  { label: 'Cart', to: '/cart', icon: 'cart' },
  { label: 'Orders', to: '/orders', icon: 'receipt' },
  { label: 'Account', to: '/account', icon: 'user' },
];

/** Seller/business dashboard navigation — grouped like the blueprint. */
export interface BusinessNavGroup {
  label: string;
  items: (NavItem & { permission?: string; badge?: string })[];
}

export const BUSINESS_NAV: BusinessNavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', to: '/business', icon: '📊', permission: 'dashboard.read' },
      { label: 'Ask Seedwel AI', to: '/business/ai', icon: '🤖', permission: 'ai.use' },
      { label: 'POS', to: '/business/pos', icon: '🧮', permission: 'pos.use' },
    ],
  },
  {
    label: 'Sell',
    items: [
      { label: 'Orders', to: '/business/orders', icon: '📦', permission: 'orders.read' },
      { label: 'Quotations', to: '/business/quotations', icon: '🧾', permission: 'quotations.read' },
      { label: 'Invoices', to: '/business/invoices', icon: '💳', permission: 'invoices.read' },
      { label: 'Receipts', to: '/business/receipts', icon: '🧾', permission: 'receipts.read' },
      { label: 'Payments', to: '/business/payments', icon: '💰', permission: 'payments.read' },
      { label: 'Payment links', to: '/business/payment-links', icon: '🔗', permission: 'payments.read' },
      { label: 'Returns & refunds', to: '/business/returns', icon: '↩️', permission: 'returns.read' },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { label: 'Products', to: '/business/products', icon: '🏷️', permission: 'products.read' },
      { label: 'Services', to: '/business/services', icon: '🛠️', permission: 'services.read' },
      { label: 'Store', to: '/business/store', icon: '🏪', permission: 'settings.read' },
      { label: 'Categories', to: '/business/categories', icon: '🗂️' },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { label: 'Stock', to: '/business/inventory', icon: '📦', permission: 'inventory.read' },
      { label: 'Movements', to: '/business/inventory/movements', icon: '🔄', permission: 'inventory.read' },
      { label: 'Warehouses', to: '/business/warehouses', icon: '🏭', permission: 'inventory.read' },
      { label: 'Transfers', to: '/business/inventory/transfers', icon: '🚚', permission: 'inventory.read' },
      { label: 'Stocktakes', to: '/business/inventory/counts', icon: '🧮', permission: 'inventory.read' },
      { label: 'CSV import & sync', to: '/business/import', icon: '🔄', permission: 'products.read' },
      { label: 'Barcodes & labels', to: '/business/barcodes', icon: '🏷️', permission: 'products.read' },
    ],
  },
  {
    label: 'Buy',
    items: [
      { label: 'Suppliers', to: '/business/suppliers', icon: '🏭', permission: 'suppliers.read' },
      { label: 'Purchase orders', to: '/business/purchases', icon: '📥', permission: 'purchases.read' },
      { label: 'Goods received', to: '/business/purchases/receiving', icon: '✅', permission: 'purchases.read' },
      { label: 'Bills', to: '/business/purchases/bills', icon: '🧾', permission: 'purchases.read' },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Customers', to: '/business/customers', icon: '👥', permission: 'customers.read' },
      { label: 'Staff & roles', to: '/business/staff', icon: '👨‍💼', permission: 'staff.read' },
      { label: 'Branches', to: '/business/branches', icon: '🏪', permission: 'settings.read' },
    ],
  },
  {
    label: 'Money',
    items: [
      { label: 'Expenses', to: '/business/expenses', icon: '💸', permission: 'expenses.read' },
      { label: 'Finance overview', to: '/business/finance', icon: '🏦', permission: 'reports.read' },
      { label: 'Statements', to: '/business/statements', icon: '📋', permission: 'customers.read' },
      { label: 'Taxes', to: '/business/taxes', icon: '🏷️', permission: 'settings.read' },
    ],
  },
  {
    label: 'Documents',
    items: [
      { label: 'My documents', to: '/business/documents', icon: '📑', permission: 'documents.read' },
      { label: 'Signatures', to: '/business/documents/signatures', icon: '✍️', permission: 'documents.read' },
      { label: 'Delivery notes', to: '/business/delivery', icon: '🚚', permission: 'delivery.read' },
      { label: 'Business files', to: '/business/files', icon: '🗄️', permission: 'documents.read' },
    ],
  },
  {
    label: 'Grow',
    items: [
      { label: 'Reports', to: '/business/reports', icon: '📈', permission: 'reports.read' },
      { label: 'Marketing', to: '/business/marketing', icon: '🎯', permission: 'marketing.read' },
      { label: 'Content generator', to: '/business/marketing/content', icon: '📣', permission: 'marketing.read' },
      { label: 'Reviews', to: '/business/reviews', icon: '⭐' },
      { label: 'Messages', to: '/business/messages', icon: '💬' },
      { label: 'Automation', to: '/business/automation', icon: '🤖', permission: 'ai.use' },
      { label: 'Business health', to: '/business/growth', icon: '🏆' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { label: 'Notifications', to: '/business/notifications', icon: '🔔' },
      { label: 'Audit log', to: '/business/audit', icon: '🧾', permission: 'audit.read' },
      { label: 'Subscription', to: '/business/subscription', icon: '💎', permission: 'settings.read' },
      { label: 'Settings', to: '/business/settings', icon: '⚙️', permission: 'settings.read' },
    ],
  },
];

/** The "+ Create" quick action menu present on every dashboard screen. */
export const QUICK_ACTIONS: { label: string; to: string; icon: string; permission?: string }[] = [
  { label: 'Product', to: '/business/products/new', icon: '🏷️', permission: 'products.write' },
  { label: 'Service', to: '/business/services/new', icon: '🛠️', permission: 'services.write' },
  { label: 'Quotation', to: '/business/quotations/new', icon: '🧾', permission: 'quotations.write' },
  { label: 'Pro-forma invoice', to: '/business/quotations/new?kind=proforma', icon: '📄', permission: 'quotations.write' },
  { label: 'Invoice', to: '/business/invoices/new', icon: '💳', permission: 'invoices.write' },
  { label: 'Receipt', to: '/business/receipts/new', icon: '🧾', permission: 'receipts.create' },
  { label: 'Customer', to: '/business/customers/new', icon: '👤', permission: 'customers.write' },
  { label: 'Supplier', to: '/business/suppliers/new', icon: '🏭', permission: 'suppliers.write' },
  { label: 'Expense', to: '/business/expenses/new', icon: '💸', permission: 'expenses.write' },
  { label: 'Purchase order', to: '/business/purchases/new', icon: '📥', permission: 'purchases.write' },
  { label: 'Payment request', to: '/business/payment-links/new', icon: '🔗', permission: 'payments.record' },
  { label: 'Document', to: '/business/documents/new', icon: '📑', permission: 'documents.write' },
];

// ── Roles & permissions ─────────────────────────────────────────────────────
export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  administrator: 'Administrator',
  manager: 'Manager',
  salesperson: 'Salesperson',
  cashier: 'Cashier',
  accountant: 'Accountant',
  inventory_manager: 'Inventory Manager',
  warehouse_manager: 'Warehouse Manager',
};

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: 'Full control of the business, billing, staff and data.',
  administrator: 'Everything except transferring ownership or deleting the business.',
  manager: 'Runs day-to-day operations: sales, stock, documents and staff oversight.',
  salesperson: 'Sells: customers, quotations, orders, invoices and payments.',
  cashier: 'Takes money at the counter. No access to costs, expenses or reports.',
  accountant: 'Books: invoices, payments, expenses, purchases, statements and reports.',
  inventory_manager: 'Stock, warehouses, suppliers, purchasing and stocktaking.',
  warehouse_manager: 'Receiving, picking, transfers, delivery notes and counts.',
};

/** Every permission string the platform understands (mirrors role_permissions() in SQL). */
export const PERMISSION_GROUPS: { group: string; items: { key: string; label: string }[] }[] = [
  {
    group: 'Overview',
    items: [
      { key: 'dashboard.read', label: 'View dashboard' },
      { key: 'reports.read', label: 'View reports' },
      { key: 'reports.export', label: 'Export reports' },
    ],
  },
  {
    group: 'Catalogue',
    items: [
      { key: 'products.read', label: 'View products' },
      { key: 'products.write', label: 'Create & edit products' },
      { key: 'products.delete', label: 'Delete products' },
      { key: 'services.read', label: 'View services' },
      { key: 'services.write', label: 'Create & edit services' },
    ],
  },
  {
    group: 'Inventory',
    items: [
      { key: 'inventory.read', label: 'View inventory' },
      { key: 'inventory.write', label: 'Receive & edit stock' },
      { key: 'inventory.adjust', label: 'Adjust stock' },
      { key: 'inventory.transfer', label: 'Transfer stock' },
      { key: 'inventory.count', label: 'Stocktake' },
    ],
  },
  {
    group: 'Selling',
    items: [
      { key: 'pos.use', label: 'Use the POS' },
      { key: 'orders.read', label: 'View orders' },
      { key: 'orders.write', label: 'Create & edit orders' },
      { key: 'orders.fulfil', label: 'Fulfil & ship orders' },
      { key: 'quotations.read', label: 'View quotations' },
      { key: 'quotations.write', label: 'Create & edit quotations' },
      { key: 'quotations.send', label: 'Send quotations' },
      { key: 'quotations.approve', label: 'Approve & void quotations' },
      { key: 'invoices.read', label: 'View invoices' },
      { key: 'invoices.write', label: 'Create & edit invoices' },
      { key: 'invoices.send', label: 'Send invoices' },
      { key: 'invoices.void', label: 'Void invoices' },
      { key: 'receipts.read', label: 'View receipts' },
      { key: 'receipts.create', label: 'Create receipts' },
      { key: 'returns.read', label: 'View returns' },
      { key: 'returns.write', label: 'Process returns' },
      { key: 'returns.approve', label: 'Approve returns' },
    ],
  },
  {
    group: 'Money',
    items: [
      { key: 'payments.read', label: 'View payments' },
      { key: 'payments.record', label: 'Record payments' },
      { key: 'payments.refund', label: 'Refund payments' },
      { key: 'expenses.read', label: 'View expenses' },
      { key: 'expenses.write', label: 'Record expenses' },
      { key: 'expenses.approve', label: 'Approve expenses' },
    ],
  },
  {
    group: 'Purchasing',
    items: [
      { key: 'suppliers.read', label: 'View suppliers' },
      { key: 'suppliers.write', label: 'Manage suppliers' },
      { key: 'purchases.read', label: 'View purchase orders' },
      { key: 'purchases.write', label: 'Create purchase orders' },
      { key: 'purchases.approve', label: 'Approve purchase orders' },
    ],
  },
  {
    group: 'People',
    items: [
      { key: 'customers.read', label: 'View customers' },
      { key: 'customers.write', label: 'Manage customers' },
      { key: 'customers.delete', label: 'Delete customers' },
      { key: 'staff.read', label: 'View staff' },
      { key: 'staff.invite', label: 'Invite staff' },
      { key: 'staff.manage', label: 'Manage staff & roles' },
    ],
  },
  {
    group: 'Documents & delivery',
    items: [
      { key: 'documents.read', label: 'View documents' },
      { key: 'documents.write', label: 'Create documents' },
      { key: 'documents.send', label: 'Send documents' },
      { key: 'documents.delete', label: 'Delete documents' },
      { key: 'delivery.read', label: 'View deliveries' },
      { key: 'delivery.write', label: 'Manage deliveries' },
    ],
  },
  {
    group: 'Growth & AI',
    items: [
      { key: 'marketing.read', label: 'View marketing' },
      { key: 'marketing.write', label: 'Run promotions' },
      { key: 'ai.use', label: 'Use Seedwel AI' },
      { key: 'ai.approve', label: 'Approve AI actions' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { key: 'settings.read', label: 'View settings' },
      { key: 'settings.write', label: 'Change settings' },
      { key: 'audit.read', label: 'View audit log' },
    ],
  },
];

// ── Enum labels for the UI ──────────────────────────────────────────────────
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  mobile_money: 'Mobile money',
  online: 'Online payment',
  cheque: 'Cheque',
  credit: 'Sold on credit',
  other: 'Other',
};

export const PAYMENT_METHOD_ICONS: Record<PaymentMethod, string> = {
  cash: '💵',
  bank_transfer: '🏦',
  card: '💳',
  mobile_money: '📱',
  online: '🌐',
  cheque: '📝',
  credit: '📒',
  other: '🔖',
};

export const MOBILE_MONEY_PROVIDERS = ['Airtel Money', 'MTN MoMo', 'Zamtel Kwacha', 'Orange Money', 'M-Pesa'] as const;

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  processing: 'Processing',
  ready: 'Ready for collection',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
};

/** The buyer-facing tracking timeline (spec #18). */
export const ORDER_STATUS_FLOW = [
  'pending',
  'confirmed',
  'processing',
  'ready',
  'shipped',
  'out_for_delivery',
  'delivered',
] as const;

export const DOC_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  change_requested: 'Changes requested',
  signed: 'Signed',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
  void: 'Void',
  approved: 'Approved',
};

export const DOC_TYPE_LABELS: Record<string, string> = {
  quotation: 'Quotation',
  proforma_invoice: 'Pro-forma invoice',
  invoice: 'Invoice',
  receipt: 'Receipt',
  purchase_order: 'Purchase order',
  delivery_note: 'Delivery note',
  contract: 'Contract',
  agreement: 'Agreement',
  statement: 'Statement of account',
  credit_note: 'Credit note',
  debit_note: 'Debit note',
  payment_voucher: 'Payment voucher',
  expense_document: 'Expense document',
  return_note: 'Return note',
  other: 'Document',
};

export const MOVEMENT_LABELS: Record<string, string> = {
  purchase: 'Stock received',
  sale: 'Sold',
  adjustment: 'Adjustment',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  return_in: 'Return received',
  return_out: 'Return sent',
  damaged: 'Damaged',
  expired: 'Expired',
  counted: 'Stocktake',
  opening: 'Opening stock',
  import: 'CSV import',
};

export const EXPENSE_REASONS = [
  'Rent', 'Salaries', 'Transport', 'Fuel', 'Electricity', 'Internet',
  'Advertising', 'Packaging', 'Repairs', 'Supplies', 'Bank charges', 'Other',
] as const;

export const UNITS = [
  'piece', 'kg', 'g', 'litre', 'ml', 'metre', 'cm', 'box', 'bag', 'pack',
  'dozen', 'roll', 'pair', 'set', 'hour', 'day', 'job', 'visit', 'session', 'tonne',
] as const;

export const BUSINESS_TYPES: Record<string, string> = {
  sole_proprietorship: 'Sole proprietorship',
  partnership: 'Partnership',
  llc: 'Limited liability company',
  company: 'Registered company',
  cooperative: 'Cooperative',
  ngo: 'NGO / Church / Association',
  informal: 'Informal trader',
  other: 'Other',
};

export const VERIFICATION_LABELS: Record<string, string> = {
  unverified: 'Unverified',
  submitted: 'Submitted',
  under_review: 'Under review',
  verified: 'Verified',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

export const BADGES: Record<string, { label: string; icon: string; hint: string }> = {
  verified: { label: 'Verified', icon: '✓', hint: 'Registration documents reviewed by Seedwel Hub' },
  trusted_seller: { label: 'Trusted Seller', icon: '★', hint: 'Consistent fulfilment and good reviews' },
  premium_business: { label: 'Premium Business', icon: '💎', hint: 'Active paid subscription' },
  established_business: { label: 'Established', icon: '🏛️', hint: 'Long-standing activity on the platform' },
};

export interface CountryInfo {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  dial: string; // international dial code, e.g. +260
  currency: string; // ISO 4217
  timeZone: string; // IANA time zone
  language: string; // default BCP-47 language
  continent: string;
}

/** Turn a 2-letter ISO country code into a flag emoji (no per-country data). */
export function flagEmoji(code: string): string {
  if (code.length !== 2) return '🌐';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Worldwide country registry — Seedwel Hub is global, not Zambia-only. */
export const COUNTRIES: CountryInfo[] = [
  { code: 'ZM', name: 'Zambia', dial: '+260', currency: 'ZMW', timeZone: 'Africa/Lusaka', language: 'en', continent: 'Africa' },
  { code: 'ZA', name: 'South Africa', dial: '+27', currency: 'ZAR', timeZone: 'Africa/Johannesburg', language: 'en', continent: 'Africa' },
  { code: 'MW', name: 'Malawi', dial: '+265', currency: 'MWK', timeZone: 'Africa/Blantyre', language: 'en', continent: 'Africa' },
  { code: 'ZW', name: 'Zimbabwe', dial: '+263', currency: 'USD', timeZone: 'Africa/Harare', language: 'en', continent: 'Africa' },
  { code: 'NG', name: 'Nigeria', dial: '+234', currency: 'NGN', timeZone: 'Africa/Lagos', language: 'en', continent: 'Africa' },
  { code: 'KE', name: 'Kenya', dial: '+254', currency: 'KES', timeZone: 'Africa/Nairobi', language: 'en', continent: 'Africa' },
  { code: 'GH', name: 'Ghana', dial: '+233', currency: 'GHS', timeZone: 'Africa/Accra', language: 'en', continent: 'Africa' },
  { code: 'UG', name: 'Uganda', dial: '+256', currency: 'UGX', timeZone: 'Africa/Kampala', language: 'en', continent: 'Africa' },
  { code: 'TZ', name: 'Tanzania', dial: '+255', currency: 'TZS', timeZone: 'Africa/Dar_es_Salaam', language: 'en', continent: 'Africa' },
  { code: 'BW', name: 'Botswana', dial: '+267', currency: 'BWP', timeZone: 'Africa/Gaborone', language: 'en', continent: 'Africa' },
  { code: 'MZ', name: 'Mozambique', dial: '+258', currency: 'MZN', timeZone: 'Africa/Maputo', language: 'pt', continent: 'Africa' },
  { code: 'AO', name: 'Angola', dial: '+244', currency: 'AOA', timeZone: 'Africa/Luanda', language: 'pt', continent: 'Africa' },
  { code: 'CD', name: 'DR Congo', dial: '+243', currency: 'CDF', timeZone: 'Africa/Kinshasa', language: 'fr', continent: 'Africa' },
  { code: 'ET', name: 'Ethiopia', dial: '+251', currency: 'ETB', timeZone: 'Africa/Addis_Ababa', language: 'am', continent: 'Africa' },
  { code: 'EG', name: 'Egypt', dial: '+20', currency: 'EGP', timeZone: 'Africa/Cairo', language: 'ar', continent: 'Africa' },
  { code: 'MA', name: 'Morocco', dial: '+212', currency: 'MAD', timeZone: 'Africa/Casablanca', language: 'ar', continent: 'Africa' },
  { code: 'SN', name: 'Senegal', dial: '+221', currency: 'XOF', timeZone: 'Africa/Dakar', language: 'fr', continent: 'Africa' },
  { code: 'CM', name: 'Cameroon', dial: '+237', currency: 'XAF', timeZone: 'Africa/Douala', language: 'fr', continent: 'Africa' },
  { code: 'RW', name: 'Rwanda', dial: '+250', currency: 'RWF', timeZone: 'Africa/Kigali', language: 'en', continent: 'Africa' },
  { code: 'US', name: 'United States', dial: '+1', currency: 'USD', timeZone: 'America/New_York', language: 'en', continent: 'North America' },
  { code: 'CA', name: 'Canada', dial: '+1', currency: 'CAD', timeZone: 'America/Toronto', language: 'en', continent: 'North America' },
  { code: 'MX', name: 'Mexico', dial: '+52', currency: 'MXN', timeZone: 'America/Mexico_City', language: 'es', continent: 'North America' },
  { code: 'GB', name: 'United Kingdom', dial: '+44', currency: 'GBP', timeZone: 'Europe/London', language: 'en', continent: 'Europe' },
  { code: 'IE', name: 'Ireland', dial: '+353', currency: 'EUR', timeZone: 'Europe/Dublin', language: 'en', continent: 'Europe' },
  { code: 'DE', name: 'Germany', dial: '+49', currency: 'EUR', timeZone: 'Europe/Berlin', language: 'de', continent: 'Europe' },
  { code: 'FR', name: 'France', dial: '+33', currency: 'EUR', timeZone: 'Europe/Paris', language: 'fr', continent: 'Europe' },
  { code: 'ES', name: 'Spain', dial: '+34', currency: 'EUR', timeZone: 'Europe/Madrid', language: 'es', continent: 'Europe' },
  { code: 'IT', name: 'Italy', dial: '+39', currency: 'EUR', timeZone: 'Europe/Rome', language: 'it', continent: 'Europe' },
  { code: 'NL', name: 'Netherlands', dial: '+31', currency: 'EUR', timeZone: 'Europe/Amsterdam', language: 'nl', continent: 'Europe' },
  { code: 'BE', name: 'Belgium', dial: '+32', currency: 'EUR', timeZone: 'Europe/Brussels', language: 'nl', continent: 'Europe' },
  { code: 'PT', name: 'Portugal', dial: '+351', currency: 'EUR', timeZone: 'Europe/Lisbon', language: 'pt', continent: 'Europe' },
  { code: 'CH', name: 'Switzerland', dial: '+41', currency: 'CHF', timeZone: 'Europe/Zurich', language: 'de', continent: 'Europe' },
  { code: 'SE', name: 'Sweden', dial: '+46', currency: 'SEK', timeZone: 'Europe/Stockholm', language: 'sv', continent: 'Europe' },
  { code: 'NO', name: 'Norway', dial: '+47', currency: 'NOK', timeZone: 'Europe/Oslo', language: 'nb', continent: 'Europe' },
  { code: 'DK', name: 'Denmark', dial: '+45', currency: 'DKK', timeZone: 'Europe/Copenhagen', language: 'da', continent: 'Europe' },
  { code: 'PL', name: 'Poland', dial: '+48', currency: 'PLN', timeZone: 'Europe/Warsaw', language: 'pl', continent: 'Europe' },
  { code: 'TR', name: 'Türkiye', dial: '+90', currency: 'TRY', timeZone: 'Europe/Istanbul', language: 'tr', continent: 'Asia' },
  { code: 'AU', name: 'Australia', dial: '+61', currency: 'AUD', timeZone: 'Australia/Sydney', language: 'en', continent: 'Oceania' },
  { code: 'NZ', name: 'New Zealand', dial: '+64', currency: 'NZD', timeZone: 'Pacific/Auckland', language: 'en', continent: 'Oceania' },
  { code: 'IN', name: 'India', dial: '+91', currency: 'INR', timeZone: 'Asia/Kolkata', language: 'en', continent: 'Asia' },
  { code: 'PK', name: 'Pakistan', dial: '+92', currency: 'PKR', timeZone: 'Asia/Karachi', language: 'en', continent: 'Asia' },
  { code: 'BD', name: 'Bangladesh', dial: '+880', currency: 'BDT', timeZone: 'Asia/Dhaka', language: 'bn', continent: 'Asia' },
  { code: 'CN', name: 'China', dial: '+86', currency: 'CNY', timeZone: 'Asia/Shanghai', language: 'zh', continent: 'Asia' },
  { code: 'JP', name: 'Japan', dial: '+81', currency: 'JPY', timeZone: 'Asia/Tokyo', language: 'ja', continent: 'Asia' },
  { code: 'KR', name: 'South Korea', dial: '+82', currency: 'KRW', timeZone: 'Asia/Seoul', language: 'ko', continent: 'Asia' },
  { code: 'SG', name: 'Singapore', dial: '+65', currency: 'SGD', timeZone: 'Asia/Singapore', language: 'en', continent: 'Asia' },
  { code: 'MY', name: 'Malaysia', dial: '+60', currency: 'MYR', timeZone: 'Asia/Kuala_Lumpur', language: 'ms', continent: 'Asia' },
  { code: 'AE', name: 'United Arab Emirates', dial: '+971', currency: 'AED', timeZone: 'Asia/Dubai', language: 'ar', continent: 'Asia' },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966', currency: 'SAR', timeZone: 'Asia/Riyadh', language: 'ar', continent: 'Asia' },
  { code: 'QA', name: 'Qatar', dial: '+974', currency: 'QAR', timeZone: 'Asia/Qatar', language: 'ar', continent: 'Asia' },
  { code: 'BR', name: 'Brazil', dial: '+55', currency: 'BRL', timeZone: 'America/Sao_Paulo', language: 'pt', continent: 'South America' },
  { code: 'AR', name: 'Argentina', dial: '+54', currency: 'ARS', timeZone: 'America/Argentina/Buenos_Aires', language: 'es', continent: 'South America' },
  { code: 'CL', name: 'Chile', dial: '+56', currency: 'CLP', timeZone: 'America/Santiago', language: 'es', continent: 'South America' },
  { code: 'CO', name: 'Colombia', dial: '+57', currency: 'COP', timeZone: 'America/Bogota', language: 'es', continent: 'South America' },
  { code: 'PE', name: 'Peru', dial: '+51', currency: 'PEN', timeZone: 'America/Lima', language: 'es', continent: 'South America' },
];

export const COUNTRY_BY_CODE: Record<string, CountryInfo> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c]),
);

export const COUNTRY_LABELS: Record<string, string> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c.name]),
);

/** Convenience lookups used to auto-configure a profile from a country. */
export function countryDial(code: string): string {
  return COUNTRY_BY_CODE[code]?.dial ?? '+260';
}
export function countryCurrency(code: string): string {
  return COUNTRY_BY_CODE[code]?.currency ?? 'ZMW';
}
export function countryTimeZone(code: string): string {
  return COUNTRY_BY_CODE[code]?.timeZone ?? 'Africa/Lusaka';
}
export function countryLanguage(code: string): string {
  return COUNTRY_BY_CODE[code]?.language ?? 'en';
}

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const DAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

/** AI impact levels and whether they need the owner's approval by default. */
export const AI_IMPACT: Record<string, { label: string; tone: string; approval: string }> = {
  low: { label: 'Low impact', tone: 'green', approval: 'Runs immediately' },
  medium: { label: 'Medium impact', tone: 'blue', approval: 'Queued for review' },
  high: { label: 'High impact', tone: 'amber', approval: 'Owner approval required' },
  financial: { label: 'Financial', tone: 'red', approval: 'Owner approval — always' },
  destructive: { label: 'Destructive', tone: 'red', approval: 'Owner approval — never automatic' },
};

export const AI_EXAMPLE_PROMPTS = [
  'What were my sales yesterday?',
  'Which products are selling fastest?',
  'Which products are low in stock?',
  'Which invoices are overdue?',
  'Show me customers who haven\u2019t purchased in 90 days.',
  'Summarize my business this month.',
  'Write an advertisement for my best-selling product.',
  'I sold 20 chairs to ABC Company at K500 each. Create everything needed.',
] as const;

/** Date-range picker labels used by the dashboard and every report. */
export const RANGE_PICKER: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  last_90_days: 'Last 90 days',
  this_year: 'This year',
};

export const PAGE_SIZE = 24;
