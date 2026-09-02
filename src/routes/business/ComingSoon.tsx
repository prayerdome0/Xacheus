import { Link } from 'react-router-dom';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Primitives';
import { PageHeader } from '@/components/layout/BusinessShell';
import { BRAND } from '@/lib/constants';

/**
 * Placeholder screen for modules that are wired into the navigation but land in
 * a later build.
 *
 * Seedwel Hub never invents data, so an unfinished module says so plainly and
 * points at what already works instead of rendering an empty shell that looks
 * like "no records yet".
 */
export function ComingSoon({ title, subtitle, icon = 'settings', items, working }: {
  title: string;
  subtitle: string;
  icon?: IconName | string;
  /** What this module will do once it lands. */
  items: string[];
  /** Screens that already work and cover part of the need today. */
  working?: { label: string; to: string }[];
}) {
  return (
    <div className="space-y-4">
      <PageHeader title={title} subtitle={subtitle} icon={icon} />

      <div className="sh-card-flat p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-50 text-accent-700">
            <Icon name="clock" size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-extrabold">In progress — not in this build yet</h2>
            <p className="mt-1 text-sm text-ink-600">
              The database tables, row-level security policies and stored functions for this module are already
              applied by <code className="rounded bg-ink-100 px-1 font-mono text-xs">supabase/sql/</code>, so nothing
              about the data model changes when the screens land. What is missing is this interface.
            </p>
          </div>
        </div>

        <div className="mt-5">
          <p className="sh-field-label">What lands here</p>
          <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {items.map((i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-ink-700">
                <Icon name="check" size={14} className="mt-0.5 shrink-0 text-brand-600" />
                {i}
              </li>
            ))}
          </ul>
        </div>

        {working && working.length > 0 && (
          <div className="mt-5 rounded-2xl border border-brand-200 bg-brand-50 p-3">
            <p className="sh-field-label text-brand-800">Working today</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {working.map((w) => (
                <Link key={w.to} to={w.to}>
                  <Button size="sm" variant="outline" iconRight="chevronRight">{w.label}</Button>
                </Link>
              ))}
            </div>
          </div>
        )}

        <p className="mt-5 text-xs text-ink-500">
          {BRAND.name} · {BRAND.companyLine}
        </p>
      </div>
    </div>
  );
}

/* ── Business modules that are scaffolded but not yet built ─────────────────── */

const products = [
  { label: 'Products', to: '/business/products' },
  { label: 'Orders', to: '/business/orders' },
  { label: 'POS', to: '/business/pos' },
  { label: 'Dashboard', to: '/business' },
];

export function InvoicesModule() {
  return (
    <ComingSoon
      title="Invoices"
      subtitle="Tax invoices, pro-formas, credit and debit notes"
      icon="💳"
      items={[
        'Create an invoice from an order or from scratch, with per-line tax and discounts',
        'Numbering from your own prefix (INV-0001) via next_document_number',
        'Branded A4 PDF with your logo, bank details and a verification QR code',
        'Share link (/d/invoice/<token>) that records who viewed it and when',
        'Record payments, send reminders, track draft → sent → partially paid → paid → overdue',
        'Void with a reason, and raise credit notes that adjust the original',
      ]}
      working={[
        { label: 'Create an invoice from an order', to: '/business/orders' },
        { label: 'Take a payment at the counter', to: '/business/pos' },
        ...products.slice(2),
      ]}
    />
  );
}

export function QuotationsModule() {
  return (
    <ComingSoon
      title="Quotations"
      subtitle="Quotes and pro-forma invoices that convert to invoices in one click"
      icon="🧾"
      items={[
        'Build a quote from your catalogue with validity days from your business settings',
        'Send as PDF, WhatsApp or email with a signable share link',
        'Customer accepts, requests changes or declines — each response is timestamped and signed',
        'One click converts an accepted quote to an invoice or an order',
        'Pro-forma invoices use the same flow with kind = proforma',
      ]}
      working={products}
    />
  );
}

export function ReceiptsModule() {
  return (
    <ComingSoon
      title="Receipts"
      subtitle="Every payment produces a numbered receipt"
      icon="🧾"
      items={[
        'Receipts are already generated automatically by record_payment — this screen lists and reprints them',
        '80 mm thermal PDF and A4 versions',
        'Public verify link so a customer can check a receipt is genuine',
        'Refund and reversal receipts',
      ]}
      working={[{ label: 'Take a payment (creates the receipt)', to: '/business/pos' }, ...products]}
    />
  );
}

export function PaymentsModule() {
  return (
    <ComingSoon
      title="Payments"
      subtitle="Cash, bank transfer, card and mobile money in one ledger"
      icon="💰"
      items={[
        'Every inbound and outbound payment with method, provider and reference',
        'Order → invoice → payment → receipt chain on one screen',
        'Payment links (/pay/<code>) you can send on WhatsApp',
        'Reconciliation against bank and mobile-money statements',
      ]}
      working={[{ label: 'POS payments', to: '/business/pos' }, { label: 'Order payments', to: '/business/orders' }]}
    />
  );
}

export function PaymentLinksModule() {
  return (
    <ComingSoon
      title="Payment links"
      subtitle="Send a link, get paid — no invoice needed"
      icon="🔗"
      items={[
        'create_payment_link is already in the database and returns /pay/<code>',
        'Fixed or customer-chosen amounts, expiry dates, allowed methods',
        'Public payment page with your branding and mobile-money instructions',
        'Links back to the invoice or order they settle',
      ]}
      working={[{ label: 'Orders', to: '/business/orders' }]}
    />
  );
}

export function ReturnsModule() {
  return (
    <ComingSoon
      title="Returns & refunds"
      subtitle="Approve, receive, restock and refund"
      icon="↩️"
      items={[
        'create_return and process_return are already implemented in the database',
        'Approve or reject with a note the customer sees',
        'Receive the goods and restock them with a return_in movement',
        'Refund with an automatic credit note against the original invoice',
        'Refunds need payments.refund — the owner-approval gate for money movements',
      ]}
      working={[{ label: 'Start a return from an order', to: '/business/orders' }]}
    />
  );
}

export function CustomersModule() {
  return (
    <ComingSoon
      title="Customers"
      subtitle="Your CRM: contacts, balances, statements and loyalty"
      icon="👥"
      items={[
        'upsert_customer already de-duplicates by phone and email',
        'Orders, quotes, invoices and payments per customer',
        'customer_statement gives opening balance → documents → payments → closing',
        'Credit limits, payment terms, groups, tags and loyalty points',
        'WhatsApp and SMS straight from the record',
      ]}
      working={[{ label: 'Pick a customer in the POS', to: '/business/pos' }]}
    />
  );
}

export function InventoryModule() {
  return (
    <ComingSoon
      title="Stock & warehouses"
      subtitle="Multi-warehouse inventory, movements, transfers and stocktakes"
      icon="📦"
      items={[
        'adjust_stock and transfer_stock are already implemented and write every movement',
        'Per-warehouse quantities, reserved stock and reorder points',
        'Stock valuation at cost (hidden from cashiers and salespeople by RLS)',
        'Transfers between warehouses and counted stocktakes',
        'Low-stock alerts feed the dashboard task list today',
      ]}
      working={[{ label: 'Adjust stock on a product', to: '/business/products' }, { label: 'Dashboard alerts', to: '/business' }]}
    />
  );
}

export function ImportModule() {
  return (
    <ComingSoon
      title="CSV import & sync"
      subtitle="Bring a whole catalogue in, then keep it in sync"
      icon="🔄"
      items={[
        'import_csv_rows and sync_csv_source are already implemented with per-row error reporting',
        'Map your columns once; the mapping is saved on the source',
        'Scheduled re-sync every N minutes with last-sync statistics',
        'Create, update and skip rules keyed on SKU or barcode',
      ]}
      working={[{ label: 'Add products manually', to: '/business/products/new' }]}
    />
  );
}

export function BarcodesModule() {
  return (
    <ComingSoon
      title="Barcodes & labels"
      subtitle="Shelf labels, price tags and scannable codes"
      icon="🏷️"
      items={[
        'Label sheets already generate from Products → select items → Price labels',
        'This screen adds bulk generation, label-size templates and reprints',
        'Internal Seedwel barcodes for products with no EAN',
        'QR codes that link to the product page',
      ]}
      working={[{ label: 'Generate labels from products', to: '/business/products' }]}
    />
  );
}

export function SuppliersModule() {
  return (
    <ComingSoon
      title="Suppliers & purchase orders"
      subtitle="Buy stock in, track bills and outstanding amounts"
      icon="🏭"
      items={[
        'Supplier records with outstanding balances and lead times',
        'Purchase orders that receive into a warehouse and write purchase movements',
        'Supplier bills paid through the same record_payment ledger',
        'Reorder suggestions from sales velocity and reorder points',
      ]}
      working={[{ label: 'Stock levels', to: '/business/products' }]}
    />
  );
}

export function ExpensesModule() {
  return (
    <ComingSoon
      title="Expenses"
      subtitle="Every cost that is not stock"
      icon="💸"
      items={[
        'Expense categories were seeded when your business was created',
        'Record, approve and attach receipts',
        'Cashiers cannot see expenses — that rule is enforced in the database',
        'Feeds the profit figure on the dashboard and reports',
      ]}
      working={[{ label: 'Dashboard', to: '/business' }]}
    />
  );
}

export function ReportsModule() {
  return (
    <ComingSoon
      title="Reports & analytics"
      subtitle="Sales, stock, customers and money — exportable"
      icon="📈"
      items={[
        'sales_series, top_products, top_customers, low_stock_alerts and overdue_invoices already power the dashboard',
        '19 report templates were seeded into the database',
        'Date-range filters, branch filters and CSV/Excel export',
        'Profit reports stay hidden from roles without reports.read',
      ]}
      working={[{ label: 'Dashboard charts', to: '/business' }, { label: 'Export orders', to: '/business/orders' }]}
    />
  );
}

export function StaffModule() {
  return (
    <ComingSoon
      title="Staff & roles"
      subtitle="Invite your team and give each person only what they need"
      icon="👨‍💼"
      items={[
        'Eight roles are already defined in the database with granular permissions',
        'Invite by email, change roles, suspend access instantly',
        'A cashier can sell but cannot see costs, expenses or profits',
        'Every action is written to the audit log with who and when',
      ]}
      working={[{ label: 'Business settings', to: '/business/settings' }]}
    />
  );
}

export function SettingsModule() {
  return (
    <ComingSoon
      title="Business settings"
      subtitle="Profile, branding, taxes, currencies, branches and numbering"
      icon="⚙️"
      items={[
        'Business profile, logo, colours and contact details',
        'Store settings: theme, layout, domain, what shoppers can do',
        'Taxes, currencies and exchange rates — configurable, never hard-coded',
        'Document number prefixes, invoice terms, payment terms, bank details',
        'Branches, warehouses and opening hours',
      ]}
      working={[{ label: 'Your account settings', to: '/account/settings' }, { label: 'Dashboard', to: '/business' }]}
    />
  );
}

export function StoreSettingsModule() {
  return (
    <ComingSoon
      title="Your online store"
      subtitle={`${BRAND.domain}/store/… — already live, this is the control panel`}
      icon="🏪"
      items={[
        'Your store page is live the moment you create a business — shoppers can browse and order now',
        'This screen adds theme, colours, layout, banner and announcement editing',
        'Featured categories and products, custom domain, SEO',
        'Toggle prices, stock, reviews, wishlist, enquiries and checkout',
      ]}
      working={[{ label: 'Products shown in your store', to: '/business/products' }, { label: 'Browse the marketplace', to: '/businesses' }]}
    />
  );
}

export function MarketingModule() {
  return (
    <ComingSoon
      title="Marketing centre"
      subtitle="Coupons, flash sales, campaigns and social content"
      icon="📣"
      items={[
        'validate_coupon already runs at checkout, so coupons work end to end',
        'This screen adds coupon creation, limits, scheduling and usage reports',
        'Flash sales and deals that appear on the public homepage',
        'AI-written social posts and broadcast messages to your customers',
      ]}
      working={[{ label: 'Deals on the homepage', to: '/' }, { label: 'Products', to: '/business/products' }]}
    />
  );
}

export function MessagesModule() {
  return (
    <ComingSoon
      title="Messages"
      subtitle="Buyer conversations, WhatsApp and internal notes"
      icon="💬"
      items={[
        'Buyers can already open a conversation about a product or an order',
        'This screen adds the seller inbox: unread counts, assignment, priority',
        'Canned replies, WhatsApp hand-off and attachment support',
        'Conversation linked to the customer, product and order',
      ]}
      working={[{ label: 'Orders', to: '/business/orders' }, { label: 'Your messages as a buyer', to: '/account/messages' }]}
    />
  );
}

export function AiModule() {
  return (
    <ComingSoon
      title="Ask Seedwel AI"
      subtitle="Your business assistant — with owner approval for anything that moves money"
      icon="🤖"
      items={[
        'propose_ai_action, ai_action_impact and resolve_ai_action are already in the database',
        'Financial and destructive actions always require the owner to approve',
        '"I sold 20 chairs to Mama Roses for K12,000 on credit" → order, invoice, customer and stock, reviewed before applying',
        'AI product import from a photo or a link, AI insights and a monthly report',
      ]}
      working={[{ label: 'Record the sale yourself in the POS', to: '/business/pos' }]}
    />
  );
}

export function GrowthModule() {
  return (
    <ComingSoon
      title="Growth score"
      subtitle="How ready your business is to sell, and what to do next"
      icon="🌱"
      items={[
        'compute_growth_score already returns the weighted breakdown used on the dashboard',
        'This screen adds the full checklist, history and the monthly AI report',
        'Badges and verification milestones',
      ]}
      working={[{ label: 'Dashboard score card', to: '/business' }]}
    />
  );
}

export function DocumentsModule() {
  return (
    <ComingSoon
      title="Document centre"
      subtitle="Every document in one place"
      icon="🗂️"
      items={[
        'Invoices, quotations and receipts are mirrored into the documents table automatically',
        'This screen adds contracts, agreements, delivery notes and statements',
        'Digital signatures with an audit trail of who signed, from which IP, when',
        'Share links with view tracking and expiry',
      ]}
      working={[{ label: 'Orders', to: '/business/orders' }, { label: 'POS receipts', to: '/business/pos' }]}
    />
  );
}

export function ServicesModule() {
  return (
    <ComingSoon
      title="Services"
      subtitle="Bookable and professional offerings"
      icon="🛠️"
      items={[
        'The services table is applied: fixed, hourly, daily, per-job or quote pricing',
        'Coverage area, travel radius, remote delivery and duration',
        'Booking requests, scheduling and service orders',
      ]}
      working={[{ label: 'Sell a service as a custom item', to: '/business/pos' }]}
    />
  );
}

export function BranchesModule() {
  return (
    <ComingSoon
      title="Branches & warehouses"
      subtitle="Multiple locations, one ledger"
      icon="🏪"
      items={[
        'A head office branch and main warehouse were created with your business',
        'This screen adds branches, per-branch stock, staff assignment and reporting',
        'Orders and the POS already record which branch and warehouse they used',
      ]}
      working={[{ label: 'POS', to: '/business/pos' }]}
    />
  );
}

export function FinanceModule() {
  return (
    <ComingSoon
      title="Money"
      subtitle="Taxes, currencies, statements and what you are owed"
      icon="💳"
      items={[
        'Taxes and currencies are configurable in the database, never hard-coded',
        'VAT 16% was seeded for Zambia and copied to your business on creation',
        'This screen adds tax rates, currency rates, statements, credit and debit notes',
      ]}
      working={[{ label: 'Dashboard', to: '/business' }, { label: 'Orders', to: '/business/orders' }]}
    />
  );
}

export function MoreModule() {
  return (
    <ComingSoon
      title="More"
      subtitle="Everything else in the business menu"
      icon="☰"
      items={[
        'Use the sidebar on desktop, or the menu button at the top, to reach any module',
        'Modules that are not built yet explain exactly what they will do',
      ]}
      working={[{ label: 'Dashboard', to: '/business' }, ...products]}
    />
  );
}

export function AuditModule() {
  return (
    <ComingSoon
      title="Audit log & security"
      subtitle="Who did what, and when"
      icon="🛡️"
      items={[
        'Fifteen tables already write to audit_logs through database triggers',
        'This screen adds search, filters and export',
        'Two-factor authentication, sessions and suspension controls',
      ]}
      working={[{ label: 'Account security', to: '/account/settings' }]}
    />
  );
}
