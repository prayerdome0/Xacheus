import type { Business, BusinessMember, MemberRole } from '@/types';

/**
 * Client-side mirror of the role → permission table used by BusinessContext.
 *
 * IMPORTANT: this is only for hiding UI the user cannot use. Firestore
 * security rules (firebase/firestore.rules) enforce the real rule server-side,
 * so a modified client can never read or write data it is not entitled to.
 */

const ALL = '*';

export const ROLE_PERMISSIONS: Record<MemberRole, string[]> = {
  owner: [ALL],
  administrator: [ALL],
  manager: [
    'dashboard.read', 'reports.read', 'reports.export',
    'products.read', 'products.write', 'products.delete',
    'services.read', 'services.write',
    'inventory.read', 'inventory.write', 'inventory.adjust', 'inventory.transfer', 'inventory.count',
    'orders.read', 'orders.write', 'orders.fulfil',
    'customers.read', 'customers.write', 'customers.delete',
    'suppliers.read', 'suppliers.write',
    'purchases.read', 'purchases.write', 'purchases.approve',
    'quotations.read', 'quotations.write', 'quotations.send', 'quotations.approve',
    'invoices.read', 'invoices.write', 'invoices.send', 'invoices.void',
    'receipts.read', 'receipts.create',
    'payments.read', 'payments.record', 'payments.refund',
    'expenses.read', 'expenses.write', 'expenses.approve',
    'documents.read', 'documents.write', 'documents.send',
    'delivery.read', 'delivery.write',
    'returns.read', 'returns.write', 'returns.approve',
    'marketing.read', 'marketing.write',
    'pos.use', 'ai.use', 'ai.approve',
    'staff.read', 'staff.invite', 'settings.read', 'audit.read',
  ],
  accountant: [
    'dashboard.read', 'reports.read', 'reports.export',
    'invoices.read', 'invoices.write', 'invoices.send', 'invoices.void',
    'quotations.read', 'quotations.write', 'quotations.send',
    'receipts.read', 'receipts.create',
    'payments.read', 'payments.record',
    'expenses.read', 'expenses.write', 'expenses.approve',
    'purchases.read', 'purchases.write',
    'suppliers.read', 'suppliers.write',
    'customers.read', 'customers.write',
    'documents.read', 'documents.write', 'documents.send',
    'returns.read', 'returns.approve',
    'orders.read', 'ai.use', 'settings.read', 'audit.read',
  ],
  salesperson: [
    'dashboard.read',
    'products.read', 'services.read',
    'inventory.read',
    'customers.read', 'customers.write',
    'quotations.read', 'quotations.write', 'quotations.send',
    'orders.read', 'orders.write',
    'invoices.read', 'invoices.write', 'invoices.send',
    'receipts.read', 'receipts.create',
    'payments.read', 'payments.record',
    'documents.read', 'documents.write',
    'delivery.read', 'marketing.read', 'pos.use', 'ai.use', 'suppliers.read',
  ],
  // A cashier can create receipts but cannot see company expenses, costs,
  // profits, staff or settings. That rule lives in the database too.
  cashier: [
    'products.read', 'services.read',
    'inventory.read',
    'customers.read', 'customers.write',
    'orders.read', 'orders.write',
    'receipts.read', 'receipts.create',
    'payments.read', 'payments.record',
    'invoices.read',
    'pos.use', 'documents.read',
  ],
  inventory_manager: [
    'dashboard.read', 'reports.read',
    'products.read', 'products.write',
    'services.read',
    'inventory.read', 'inventory.write', 'inventory.adjust', 'inventory.transfer', 'inventory.count',
    'suppliers.read', 'suppliers.write',
    'purchases.read', 'purchases.write',
    'orders.read', 'orders.fulfil',
    'delivery.read', 'delivery.write',
    'returns.read', 'returns.write',
    'pos.use', 'ai.use', 'customers.read', 'documents.read',
  ],
  warehouse_manager: [
    'products.read',
    'inventory.read', 'inventory.write', 'inventory.adjust', 'inventory.transfer', 'inventory.count',
    'purchases.read',
    'orders.read', 'orders.fulfil',
    'delivery.read', 'delivery.write',
    'returns.read', 'returns.write',
    'suppliers.read', 'pos.use', 'documents.read',
  ],
};

export interface PermissionContext {
  userId?: string | null;
  business?: Business | null;
  membership?: BusinessMember | null;
  isPlatformAdmin?: boolean;
}

/** Resolve the effective permission set for a member of a business. */
export function effectivePermissions(ctx: PermissionContext): Set<string> {
  const out = new Set<string>();
  const { business, membership, userId, isPlatformAdmin } = ctx;

  if (isPlatformAdmin) { out.add(ALL); return out; }
  if (!business) return out;
  if (userId && business.owner_id === userId) { out.add(ALL); return out; }

  const rolePerms = membership ? ROLE_PERMISSIONS[membership.role] ?? [] : [];
  const custom = membership?.permissions_override ?? [];
  const denied = new Set(membership?.denied_permissions ?? []);

  [...rolePerms, ...custom].forEach((p) => {
    if (!denied.has(p)) out.add(p);
  });
  return out;
}

export function hasPermission(perms: Set<string>, permission: string): boolean {
  return perms.has(ALL) || perms.has(permission);
}

export function hasAnyPermission(perms: Set<string>, permissions: string[]): boolean {
  return perms.has(ALL) || permissions.some((p) => perms.has(p));
}

/**
 * Actions that must never run without the business owner's explicit approval —
 * even when automation or the AI assistant proposes them.
 */
export const OWNER_APPROVAL_ACTIONS = new Set([
  'refund', 'change_price', 'issue_credit_note', 'write_off', 'adjust_stock_value',
  'make_payment', 'approve_purchase_order', 'change_bank_details', 'void_invoice',
  'delete_record', 'delete_product', 'delete_customer', 'delete_business', 'purge_data',
  'send_invoice', 'send_reminder', 'send_email', 'send_sms', 'send_whatsapp',
  'publish_product', 'share_document', 'create_payment_link', 'run_campaign',
]);

export function requiresOwnerApproval(action: string): boolean {
  return OWNER_APPROVAL_ACTIONS.has(action);
}

/** Human-readable reason when a screen or button is hidden. */
export function missingPermissionMessage(permission: string, role?: MemberRole | null): string {
  const area = permission.split('.')[0];
  const names: Record<string, string> = {
    expenses: 'company expenses',
    reports: 'business reports',
    invoices: 'invoices',
    payments: 'payments',
    inventory: 'inventory',
    products: 'products',
    customers: 'customers',
    suppliers: 'suppliers',
    purchases: 'purchasing',
    staff: 'staff management',
    settings: 'business settings',
    audit: 'the audit log',
    documents: 'documents',
    marketing: 'marketing',
    ai: 'Seedwel AI',
    dashboard: 'the dashboard',
    delivery: 'deliveries',
    returns: 'returns',
    quotations: 'quotations',
    receipts: 'receipts',
    orders: 'orders',
    services: 'services',
    pos: 'the point of sale',
  };
  const what = names[area] ?? area;
  const who = role ? ` (${role.replace('_', ' ')})` : '';
  return `Your role${who} does not include access to ${what}. Ask the business owner to grant “${permission}”.`;
}
