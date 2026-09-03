import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Badge, Button, EmptyState, Notice, Select, Skeleton } from '@/components/ui/Primitives';
import { BusinessAvatar, StatTile, StatusBadge } from '@/components/ui';
import { PageHeader } from '@/components/layout/BusinessShell';
import { useAuth } from '@/context/AuthContext';
import { useBusiness } from '@/context/BusinessContext';
import { db } from '@/lib/db';
import {
  dashboardSummary, salesSeries, topProducts, lowStockAlerts, overdueInvoices,
  type DashboardSummary, type TopProductRow, type LowStockRow, type OverdueInvoiceRow,
} from '@/lib/api';
import { formatMoney, formatMoneyCompact, toNum } from '@/lib/currency';
import { formatDate, relativeTime, resolveRange, type RangeKey } from '@/lib/dates';
import { displayName } from '@/lib/format';
import { BRAND, QUICK_ACTIONS } from '@/lib/constants';
import { RANGE_LABELS } from '@/lib/dates';
import type { Order } from '@/types';

/**
 * Business dashboard — banking-style.
 *
 * Money in, money out, what is owed to you, what you owe, stock value and what
 * needs a decision today. Every figure comes from dashboard_summary() so the
 * numbers match the reports and the ledger exactly.
 */
export default function BusinessDashboard() {
  const { profile } = useAuth();
  const { activeBusiness, can, plan } = useBusiness();
  const navigate = useNavigate();

  const [range, setRange] = useState<RangeKey>('last_30_days');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<{ date: string; revenue: number; orders: number; profit: number }[]>([]);
  const [best, setBest] = useState<TopProductRow[]>([]);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [overdue, setOverdue] = useState<OverdueInvoiceRow[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [tasks, setTasks] = useState<{ label: string; to: string; icon: IconName; count: number; tone: string }[]>([]);

  const currency = activeBusiness?.base_currency ?? 'ZMW';
  const { from, to } = resolveRange(range);

  const load = useCallback(async () => {
    if (!activeBusiness) return;
    setLoading(true);
    setError(null);
    try {
      const id = activeBusiness.id;
      const [sum, ser, tp, ls, oi, orders] = await Promise.all([
        dashboardSummary(id, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)),
        can('reports.read')
          ? salesSeries(id, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10),
              range === 'last_90_days' || range === 'this_year' || range === 'this_quarter' ? 'week' : 'day')
              .catch(() => ({ series: [] as { bucket: string; revenue: number; orders: number; profit: number; items: number }[] }))
          : Promise.resolve({ series: [] as { bucket: string; revenue: number; orders: number; profit: number; items: number }[] }),
        can('reports.read')
          ? topProducts(id, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10), 6).catch(() => ({ items: [] as TopProductRow[] }))
          : Promise.resolve({ items: [] as TopProductRow[] }),
        can('inventory.read')
          ? lowStockAlerts(id, 8).catch(() => ({ items: [] as LowStockRow[], count: 0 }))
          : Promise.resolve({ items: [] as LowStockRow[], count: 0 }),
        can('invoices.read')
          ? overdueInvoices(id, 6).catch(() => ({ items: [] as OverdueInvoiceRow[], total_outstanding: 0 }))
          : Promise.resolve({ items: [] as OverdueInvoiceRow[], total_outstanding: 0 }),
        can('orders.read')
          ? db.from('orders').select('*, customer:customers(id,name), business:businesses(id,name,slug)')
              .eq('business_id', id).order('placed_at', { ascending: false }).limit(6)
          : Promise.resolve({ data: [], error: null }),
      ]);

      setSummary(sum);
      setSeries((ser.series ?? []).map((p) => ({
        date: p.bucket, revenue: toNum(p.revenue), orders: Number(p.orders ?? 0), profit: toNum(p.profit),
      })));
      setBest(tp.items ?? []);
      setLowStock(ls.items ?? []);
      setOverdue(oi.items ?? []);
      setRecentOrders((orders.data ?? []) as Order[]);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Could not load the dashboard.');
    } finally {
      setLoading(false);
    }
  }, [activeBusiness, from, to, range, can]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!summary) { setTasks([]); return; }
    const list: typeof tasks = [];
    const c = summary.counts;
    const p = summary.pending_approvals;
    if (c.orders_pending > 0) list.push({ label: 'Orders to process', to: '/business/orders?status=pending', icon: 'cart', count: c.orders_pending, tone: 'amber' });
    if (p.expenses > 0 && can('expenses.approve')) list.push({ label: 'Expenses awaiting approval', to: '/business/expenses?filter=approval', icon: 'wallet', count: p.expenses, tone: 'amber' });
    if (p.purchase_orders > 0 && can('purchases.approve')) list.push({ label: 'Purchase orders to approve', to: '/business/purchases?filter=approval', icon: 'package', count: p.purchase_orders, tone: 'amber' });
    if (p.refunds > 0 && can('payments.refund')) list.push({ label: 'Refunds to approve', to: '/business/returns', icon: 'refresh', count: p.refunds, tone: 'red' });
    if (p.returns > 0 && can('returns.approve')) list.push({ label: 'Returns requested', to: '/business/returns', icon: 'truck', count: p.returns, tone: 'red' });
    if (p.ai_actions > 0 && can('ai.approve')) list.push({ label: 'AI actions needing approval', to: '/business/ai', icon: 'sparkles', count: p.ai_actions, tone: 'brand' });
    if (summary.overdue.count > 0 && can('invoices.read')) list.push({ label: 'Overdue invoices to chase', to: '/business/invoices?status=overdue', icon: 'invoice', count: summary.overdue.count, tone: 'red' });
    if (summary.stock.low > 0 && can('inventory.read')) list.push({ label: 'Products below reorder point', to: '/business/inventory?filter=low', icon: 'box', count: summary.stock.low, tone: 'amber' });
    if (c.drafts > 0 && can('products.write')) list.push({ label: 'Draft products to publish', to: '/business/products?status=draft', icon: 'tag', count: c.drafts, tone: 'neutral' });
    if (c.unread_messages > 0) list.push({ label: 'Unread customer messages', to: '/business/messages', icon: 'mail', count: c.unread_messages, tone: 'brand' });
    if (activeBusiness?.verification_status !== 'verified') list.push({ label: 'Complete verification for the badge', to: '/business/settings?tab=verification', icon: 'shield', count: 0, tone: 'blue' });
    setTasks(list.slice(0, 6));
  }, [summary, can, activeBusiness]);

  const quick = useMemo(() => QUICK_ACTIONS.filter((a) => !a.permission || can(a.permission)).slice(0, 6), [can]);

  if (!activeBusiness) return null;

  const period = summary?.period;
  const todayFig = summary?.today;
  const grossMargin = period && toNum(period.revenue) > 0
    ? (toNum(period.profit) / toNum(period.revenue)) * 100
    : 0;
  const netPosition = period
    ? toNum(period.profit) - toNum(summary?.expenses ?? 0)
    : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${greeting()}, ${displayName(profile).split(' ')[0]}`}
        subtitle={`${activeBusiness.name} · ${RANGE_LABELS[range]} · ${formatDate(from)} – ${formatDate(to)}`}
        actions={
          <>
            <Select value={range} onChange={(e) => setRange(e.target.value as RangeKey)} className="w-auto"
              options={Object.entries(RANGE_LABELS)
                .filter(([k]) => k !== 'custom')
                .map(([value, label]) => ({ value, label }))} />
            <Button size="sm" variant="outline" icon="refresh" loading={loading} onClick={() => void load()}>
              Refresh
            </Button>
            {can('reports.read') && (
              <Button size="sm" variant="outline" icon="chart" onClick={() => navigate('/business/reports')}>
                Reports
              </Button>
            )}
          </>
        }
      />

      {error && (
        <Notice tone="danger" title="Dashboard could not load" action={
          <Button size="sm" variant="outline" icon="refresh" onClick={() => void load()}>Retry</Button>
        }>{error}</Notice>
      )}

      {/* Money at a glance */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loading && !summary ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
        ) : (
          <>
            <BankTile
              label="Money in (all time)"
              amount={toNum(summary?.available ?? 0)}
              currency={currency}
              icon="wallet"
              tone="green"
              sub={`${todayFig?.orders ?? 0} orders · ${formatMoney(todayFig?.sales ?? 0, currency)} today`}
              to="/business/payments"
            />
            <BankTile
              label="Owed to you"
              amount={toNum(summary?.receivable ?? 0)}
              currency={currency}
              icon="invoice"
              tone={toNum(summary?.overdue?.amount ?? 0) > 0 ? 'red' : 'brand'}
              sub={toNum(summary?.overdue?.amount ?? 0) > 0
                ? `${formatMoney(summary?.overdue?.amount ?? 0, currency)} overdue · ${summary?.overdue?.count} invoices`
                : `${summary?.counts.invoices_unpaid ?? 0} unpaid invoices`}
              to="/business/invoices?status=unpaid"
            />
            <BankTile
              label="You owe (supplier bills)"
              amount={toNum(summary?.payable ?? 0)}
              currency={currency}
              icon="package"
              tone="amber"
              sub="Purchase bills not yet settled"
              to="/business/purchases/bills"
            />
            <BankTile
              label="Stock value"
              amount={toNum(summary?.stock?.value ?? 0)}
              currency={currency}
              icon="box"
              tone="neutral"
              sub={`${Math.round(toNum(summary?.stock?.units ?? 0))} units · ${summary?.stock?.low ?? 0} below reorder · ${summary?.stock?.out ?? 0} out`}
              to="/business/inventory"
            />
          </>
        )}
      </section>

      {/* Performance */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Revenue" icon="chart" tone="brand"
          value={loading && !period ? '—' : formatMoney(period?.revenue ?? 0, currency)}
          sub={`${period?.orders ?? 0} orders · ${Math.round(toNum(period?.items_sold ?? 0))} items`} />
        <StatTile label="Gross profit" icon="wallet" tone={grossMargin >= 25 ? 'green' : 'amber'}
          value={loading && !period ? '—' : formatMoney(period?.profit ?? 0, currency)}
          sub={can('reports.read') ? `${grossMargin.toFixed(1)}% margin on sales` : 'Hidden for your role'} />
        <StatTile label="Expenses" icon="cash" tone="red"
          value={loading && !summary ? '—' : formatMoney(summary?.expenses ?? 0, currency)}
          sub={can('expenses.read') ? 'Recorded in this period' : 'Your role cannot see expenses'} />
        <StatTile label="Net position" icon="target" tone={netPosition >= 0 ? 'green' : 'red'}
          value={loading && !period ? '—' : formatMoney(netPosition, currency)}
          sub="Gross profit minus expenses" />
      </section>

      {/* Needs a decision */}
      {tasks.length > 0 && (
        <section className="sh-card-flat p-4">
          <h2 className="flex items-center gap-2 text-sm font-extrabold">
            <Icon name="bell" size={16} className="text-accent-500" /> Needs your attention
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tasks.map((t) => (
              <li key={t.label}>
                <Link to={t.to} className="flex items-center gap-2.5 rounded-xl border border-ink-200 px-3 py-2.5 hover:border-brand-300 hover:bg-brand-50">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    t.tone === 'red' ? 'bg-red-50 text-red-600'
                      : t.tone === 'amber' ? 'bg-amber-50 text-amber-600'
                      : t.tone === 'blue' ? 'bg-sky-50 text-sky-600'
                      : t.tone === 'brand' ? 'bg-brand-50 text-brand-700' : 'bg-ink-100 text-ink-600'
                  }`}>
                    <Icon name={t.icon} size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{t.label}</span>
                    {t.count > 0 && <span className="block text-[11px] text-ink-500">{t.count} waiting</span>}
                  </span>
                  <Icon name="chevronRight" size={16} className="shrink-0 text-ink-300" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Chart + quick actions */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="sh-card-flat p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-extrabold">Sales trend</h2>
            <div className="flex items-center gap-3 text-[11px] font-semibold text-ink-500">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-brand-500" /> Revenue</span>
              {can('reports.read') && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent-400" /> Profit</span>}
            </div>
          </div>

          {loading && series.length === 0 ? (
            <Skeleton className="h-56 w-full rounded-xl" />
          ) : series.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center gap-2 text-center">
              <Icon name="chart" size={28} className="text-ink-300" />
              <p className="text-sm font-semibold text-ink-600">No sales in this period</p>
              <p className="max-w-sm text-xs text-ink-500">
                Record a sale from the POS or create an invoice — the chart fills in as soon as there is data.
              </p>
              {can('pos.use') && (
                <Button size="sm" icon="scan" onClick={() => navigate('/business/pos')}>Open the POS</Button>
              )}
            </div>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0f766e" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0f766e" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="prof" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e6eaee" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#667c8b' }} tickFormatter={(v: string) => formatDate(v, { day: 'numeric', month: 'short' })} />
                  <YAxis tick={{ fontSize: 11, fill: '#667c8b' }} tickFormatter={(v: number) => formatMoneyCompact(v, currency)} width={64} />
                  <Tooltip
                    formatter={(v: number | string, name: string) => [formatMoney(toNum(v), currency), name === 'revenue' ? 'Revenue' : 'Profit']}
                    labelFormatter={(l: string) => formatDate(l)}
                    contentStyle={{ borderRadius: 12, border: '1px solid #d5dbe0', fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#0f766e" strokeWidth={2.2} fill="url(#rev)" />
                  {can('reports.read') && (
                    <Area type="monotone" dataKey="profit" stroke="#f59e0b" strokeWidth={2} fill="url(#prof)" />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {summary && (
            <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-ink-100 pt-3 text-sm sm:grid-cols-4">
              <Mini label="Today" value={formatMoney(todayFig?.sales ?? 0, currency)} />
              <Mini label="Payments today" value={formatMoney(todayFig?.payments ?? 0, currency)} />
              <Mini label="Avg order" value={formatMoney(
                (period?.orders ?? 0) > 0 ? toNum(period?.revenue ?? 0) / Number(period?.orders ?? 1) : 0, currency)} />
              <Mini label="New customers" value={String(summary.counts.new_customers ?? 0)} />
            </dl>
          )}
        </div>

        <div className="space-y-4">
          <div className="sh-card-flat p-4">
            <h2 className="text-sm font-extrabold">Quick actions</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {quick.map((a) => (
                <Link key={a.label} to={a.to}
                  className="flex items-center gap-2 rounded-xl border border-ink-200 px-2.5 py-2.5 text-[12px] font-bold hover:border-brand-300 hover:bg-brand-50">
                  <span aria-hidden="true" className="text-base">{a.icon}</span>
                  <span className="truncate">{a.label}</span>
                </Link>
              ))}
            </div>
            {can('pos.use') && (
              <Button block className="mt-3" icon="scan" onClick={() => navigate('/business/pos')}>
                Open the point of sale
              </Button>
            )}
          </div>

          <div className="sh-card-flat p-4">
            <h2 className="text-sm font-extrabold">Your business</h2>
            <div className="mt-3 flex items-center gap-3">
              <BusinessAvatar business={activeBusiness} size={46} />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{activeBusiness.name}</p>
                <Link to={`/store/${activeBusiness.slug}`} className="truncate text-xs text-brand-700 hover:underline">
                  {BRAND.domain}/store/{activeBusiness.slug}
                </Link>
              </div>
            </div>
            <div className="mt-3 space-y-2 text-xs">
              <ProgressLine label="Growth score" value={activeBusiness.growth_score} suffix="/100" to="/business/growth" />
              <Row2 label="Plan" value={plan?.name ?? 'Free'} to="/business/subscription" />
              <Row2 label="Products" value={`${summary?.counts.published ?? 0} published · ${summary?.counts.drafts ?? 0} drafts`} to="/business/products" />
              <Row2 label="Customers" value={String(summary?.counts.customers ?? 0)} to="/business/customers" />
              <Row2 label="Staff" value={String(summary?.counts.staff ?? 0)} to="/business/staff" />
              <Row2 label="Verification" value={activeBusiness.verification_status.replace(/_/g, ' ')} to="/business/settings?tab=verification" />
            </div>
          </div>
        </div>
      </section>

      {/* Best sellers + low stock */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Best sellers" icon="fire" to="/business/reports" emptyText="No sales in this period yet.">
          {best.length > 0 && (
            <ul className="divide-y divide-ink-100">
              {best.map((row, i) => (
                <li key={`${row.product_id ?? row.name}-${i}`} className="flex items-center gap-3 py-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-xs font-extrabold text-ink-600">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link to={`/business/products/${row.product_id ?? ''}`} className="block truncate text-[13px] font-bold hover:text-brand-700">
                      {row.name}
                    </Link>
                    <span className="block text-[11px] text-ink-500">
                      {Math.round(toNum(row.quantity))} sold
                      {can('reports.read') ? ` · profit ${formatMoney(row.profit, currency)}` : ''}
                    </span>
                  </span>
                  <span className="sh-money shrink-0 text-sm font-extrabold">{formatMoney(row.revenue, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Low stock" icon="warning" to="/business/inventory?filter=low" emptyText="Every product is above its reorder point.">
          {lowStock.length > 0 && (
            <ul className="divide-y divide-ink-100">
              {lowStock.map((row) => {
                const qty = Math.round(toNum(row.quantity_on_hand));
                return (
                  <li key={`${row.product_id}-${row.warehouse_id}`} className="flex items-center gap-3 py-2.5">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${qty <= 0 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                      <Icon name={qty <= 0 ? 'close' : 'warning'} size={15} />
                    </span>
                    <Link to={`/business/products/${row.product_id}`} className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold hover:text-brand-700">{row.name}</span>
                      <span className="block text-[11px] text-ink-500">
                        {row.warehouse} · reorder at {Math.round(toNum(row.reorder_point))}
                        {row.bin_location ? ` · bin ${row.bin_location}` : ''}
                      </span>
                    </Link>
                    <Badge tone={qty <= 0 ? 'red' : 'amber'}>{qty <= 0 ? 'Out of stock' : `${qty} left`}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </section>

      {/* Overdue + recent orders */}
      <section className="grid gap-4 lg:grid-cols-2">
        {can('invoices.read') && (
          <Panel title="Overdue invoices" icon="invoice" to="/business/invoices?status=overdue"
            emptyText="Nothing overdue — every invoice is inside its terms.">
            {overdue.length > 0 && (
              <ul className="divide-y divide-ink-100">
                {overdue.map((inv) => (
                  <li key={inv.id}>
                    <Link to={`/business/invoices/${inv.id}`} className="flex items-center gap-3 py-2.5 hover:bg-ink-50">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold">{inv.invoice_number}</span>
                        <span className="block truncate text-[11px] text-ink-500">
                          {inv.customer_name ?? 'Customer'} · {inv.days_overdue} day{inv.days_overdue === 1 ? '' : 's'} overdue
                        </span>
                      </span>
                      <StatusBadge status={inv.status} />
                      <span className="sh-money shrink-0 text-sm font-extrabold text-red-600">
                        {formatMoney(inv.balance_due, inv.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {can('orders.read') && (
          <Panel title="Recent orders" icon="cart" to="/business/orders" emptyText="No orders yet — your first sale will appear here.">
            {recentOrders.length > 0 && (
              <ul className="divide-y divide-ink-100">
                {recentOrders.map((o) => (
                  <li key={o.id}>
                    <Link to={`/business/orders/${o.id}`} className="flex items-center gap-3 py-2.5 hover:bg-ink-50">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold">{o.order_number}</span>
                        <span className="block truncate text-[11px] text-ink-500">
                          {(o as Order & { customer?: { name: string } }).customer?.name ?? o.channel.replace(/_/g, ' ')} · {relativeTime(o.placed_at)}
                        </span>
                      </span>
                      <StatusBadge status={o.status} />
                      <span className="sh-money shrink-0 text-sm font-extrabold">{formatMoney(o.total, o.currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </section>

      {/* Onboarding */}
      {summary && summary.counts.products === 0 && (
        <OnboardingCard />
      )}
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function BankTile({ label, amount, currency, icon, tone, sub, to }: {
  label: string; amount: number; currency: string; icon: IconName;
  tone: 'green' | 'red' | 'amber' | 'brand' | 'neutral'; sub?: string; to?: string;
}) {
  const tones = {
    green: 'from-emerald-50 to-white border-emerald-200 text-emerald-700',
    red: 'from-red-50 to-white border-red-200 text-red-700',
    amber: 'from-amber-50 to-white border-amber-200 text-amber-700',
    brand: 'from-brand-50 to-white border-brand-200 text-brand-700',
    neutral: 'from-ink-50 to-white border-ink-200 text-ink-700',
  } as const;

  const body = (
    <div className={`flex flex-col rounded-2xl border bg-gradient-to-b p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="sh-label">{label}</span>
        <Icon name={icon} size={18} />
      </div>
      <span className="mt-2 text-2xl font-extrabold tabular-nums text-ink-950">
        {formatMoney(amount, currency)}
      </span>
      {sub && <span className="mt-1 text-[11px] leading-snug text-ink-500">{sub}</span>}
    </div>
  );

  return to ? <Link to={to} className="block transition-transform hover:-translate-y-0.5">{body}</Link> : body;
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="sh-money mt-0.5 text-sm font-extrabold">{value}</dd>
    </div>
  );
}

function Panel({ title, icon, to, emptyText, children }: {
  title: string; icon: IconName; to: string; emptyText: string; children: React.ReactNode;
}) {
  const hasContent = Array.isArray(children) ? children.some(Boolean) : Boolean(children);
  return (
    <div className="sh-card-flat p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-extrabold">
          <Icon name={icon} size={16} className="text-brand-600" /> {title}
        </h2>
        <Link to={to}><Button variant="ghost" size="sm" iconRight="chevronRight">All</Button></Link>
      </div>
      {hasContent ? children : <p className="py-6 text-center text-sm text-ink-500">{emptyText}</p>}
    </div>
  );
}

function ProgressLine({ label, value, suffix, to }: { label: string; value: number; suffix?: string; to: string }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <Link to={to} className="block">
      <div className="flex items-center justify-between text-[11px] font-bold">
        <span className="text-ink-500">{label}</span>
        <span className="text-ink-800">{pct}{suffix ?? '%'}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div className={`h-full rounded-full ${pct >= 65 ? 'bg-emerald-500' : pct >= 40 ? 'bg-accent-400' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }} />
      </div>
    </Link>
  );
}

function Row2({ label, value, to }: { label: string; value: string; to: string }) {
  return (
    <Link to={to} className="flex items-center justify-between gap-2 rounded-lg px-1 py-0.5 hover:bg-ink-50">
      <span className="text-ink-500">{label}</span>
      <span className="flex items-center gap-1 font-bold capitalize text-ink-800">
        {value} <Icon name="chevronRight" size={12} className="text-ink-300" />
      </span>
    </Link>
  );
}

function OnboardingCard() {
  const navigate = useNavigate();
  const steps = [
    { label: 'Add your first products', to: '/business/products/new', icon: 'tag' as IconName, hint: 'Photos, price and stock — or import a CSV.' },
    { label: 'Set your tax rate', to: '/business/taxes', icon: 'wallet' as IconName, hint: 'VAT 16% is created for you; edit or add rates.' },
    { label: 'Record a sale', to: '/business/pos', icon: 'scan' as IconName, hint: 'The POS creates the order, payment and receipt.' },
    { label: 'Invite your staff', to: '/business/staff', icon: 'users' as IconName, hint: 'Give each person only the permissions they need.' },
  ];

  return (
    <section className="sh-card-flat overflow-hidden">
      <div className="sh-gradient-brand px-4 py-3">
        <h2 className="text-sm font-extrabold text-white">Get set up</h2>
        <p className="text-xs text-white/75">Four steps and your business is running on Seedwel Hub.</p>
      </div>
      <ul className="grid gap-2 p-4 sm:grid-cols-2">
        {steps.map((s) => (
          <li key={s.label}>
            <button type="button" onClick={() => navigate(s.to)}
              className="flex w-full items-start gap-3 rounded-xl border border-ink-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <Icon name={s.icon} size={17} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold">{s.label}</span>
                <span className="block text-[11px] leading-snug text-ink-500">{s.hint}</span>
              </span>
              <Icon name="chevronRight" size={15} className="ml-auto mt-2 shrink-0 text-ink-300" />
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-ink-100 px-4 py-3">
        <Button size="sm" variant="outline" icon="book" onClick={() => navigate('/academy')}>
          Learn in the Business Academy
        </Button>
      </div>
    </section>
  );
}

/** Simple category revenue split — used by Reports, exported here to reuse. */
export function RevenueSplitChart({ data, currency }: {
  data: { name: string; value: number }[]; currency: string;
}) {
  const colours = ['#0f766e', '#f59e0b', '#0ea5e9', '#10b981', '#8b5cf6', '#ef4444', '#64748b'];
  if (data.length === 0) {
    return <EmptyState icon="chart" title="Nothing to chart yet" description="Record sales to see the split." />;
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="75%" paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={colours[i % colours.length]} />)}
          </Pie>
          <Tooltip formatter={(v: number | string) => formatMoney(toNum(v), currency)}
            contentStyle={{ borderRadius: 12, border: '1px solid #d5dbe0', fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Orders-per-day bar chart reused on the Reports page. */
export function OrdersBarChart({ data, currency }: {
  data: { date: string; orders: number; revenue: number }[]; currency: string;
}) {
  if (data.length === 0) return <EmptyState icon="chart" title="No orders in this period" />;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6eaee" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#667c8b' }} tickFormatter={(v: string) => formatDate(v, { day: 'numeric', month: 'short' })} />
          <YAxis tick={{ fontSize: 11, fill: '#667c8b' }} tickFormatter={(v: number) => formatMoneyCompact(v, currency)} width={64} />
          <Tooltip formatter={(v: number | string) => formatMoney(toNum(v), currency)}
            labelFormatter={(l: string) => formatDate(l)}
            contentStyle={{ borderRadius: 12, border: '1px solid #d5dbe0', fontSize: 12 }} />
          <Bar dataKey="revenue" name="Revenue" fill="#0f766e" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

