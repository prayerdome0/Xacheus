import type { MemberRole, PaymentMethod } from '@/types';

export const BRAND = {
  name: 'Seedwel Hub',
  short: 'Seedwel',
  company: 'Seedwel Investment Limited',
  companyLine: 'A product of Seedwel Investment Limited',
  tagline: 'Buy. Sell. Manage. Grow.',
  hero: 'Everything your business needs, in one place.',
  subHero:
    'Your store. Your customers. Your documents. Your inventory. Your growth — all in one platform.',
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
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
};

export const ORDER_STATUS_FLOW = [
  'pending',
  'confirmed',
  'processing',
  'ready',
  'shipped',
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

export const COUNTRY_LABELS: Record<string, string> = {
  ZM: 'Zambia', ZW: 'Zimbabwe', MW: 'Malawi', BW: 'Botswana', ZA: 'South Africa',
  TZ: 'Tanzania', KE: 'Kenya', US: 'United States', GB: 'United Kingdom',
};

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
