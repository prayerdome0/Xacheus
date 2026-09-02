# Seedwel Hub

**Buy. Sell. Manage. Grow.** — A product of Seedwel Investment Limited.

Seedwel Hub is a marketplace *and* the back office behind it. A trader in Lusaka
can create an account, get an online store at `seedwelhub.com/store/<slug>`, list
products, sell over the counter with the POS, record what a customer owes, and
send an invoice on WhatsApp that the customer can open, verify and pay — without
ever leaving one login.

This repository replaces Xacheus (the Firebase social app). Nothing from that
codebase is reused except the brand artwork in `assets/`.

---

## What this is not

It is not a demo and it has no fake data. There are no mock JSON files, no
hard-coded product lists and no `setTimeout` pretending to be an API. Every
number on screen comes from a real database — Firestore for Phase 1 identity,
and the legacy Supabase/Postgres layer for modules that have not migrated yet.
Every screen that is not finished says so out loud instead of rendering an
empty state that looks like "no records yet".

The database is the product. The screens are how you reach it.

---

> **Migration status:** Seedwel Hub is being moved from Supabase to Firebase.
> Phase 1 (this branch) replaces authentication and user profiles with Firebase
> Auth + Cloud Firestore and ships the deny-by-default Firestore/Storage rules.
> Marketplace, business, orders, documents etc. still use the legacy Supabase
> data layer until Phase 2+ has migrated each module. See
> [`docs/FIREBASE_MIGRATION.md`](docs/FIREBASE_MIGRATION.md) for the plan.

---

## Stack

| Layer | Choice (current) |
| --- | --- |
| Auth | Firebase Authentication (Email/Password, verification, reset) |
| Identity | Cloud Firestore `users/{uid}` + `firebase/firestore.rules` + custom admin claims |
| Media phase 2 | Cloudinary (public upload preset in the browser; secret only in Cloud Functions) |
| Marketplace/business data | Legacy Supabase data layer (Postgres + RLS) — being migrated to Firestore |
| Frontend | React 18 + Vite 5 + TypeScript (strict) |
| Routing | react-router-dom 6, every route lazy-loaded |
| Styling | Tailwind CSS v4 (`@theme`, `sh-*` component classes, phone-first) |
| Documents | jsPDF + jspdf-autotable (A4 and 80 mm thermal), bwip-js barcodes |
| Charts | recharts |
| CSV | papaparse |

Money is stored/decimal at the data layer and `number | string` in TypeScript.
Every calculation goes through `toNum()` in `src/lib/currency.ts`; no floats
reach a total.

---

## Running it

### 1. Create the Firebase project

Open the [Firebase console](https://console.firebase.google.com), create a
project, register a **Web app**, then copy the official `firebaseConfig`.

- **Authentication** → enable **Email/Password**.
- **Cloud Firestore** → create a database (start in production mode).
- Deploy the Phase 1 rules:

```bash
npx firebase deploy --only firestore:rules,storage:rules
```

The rules live in `firebase/firestore.rules` and `firebase/storage.rules`.
Admin access must use a **custom claim** (`admin: true`) set by an Admin SDK /
Cloud Function — never a browser-writable field.

> The old `supabase/sql/` files remain only as the transitional schema for the
> not-yet-migrated marketplace/business modules. Do not run them in a project
> that has been replaced; they are being removed module-by-module.

### 2. Configure the client

```bash
cp .env.example .env
```

```dotenv
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=

VITE_CLOUDINARY_CLOUD_NAME=
VITE_CLOUDINARY_PRESET=

VITE_DEFAULT_COUNTRY=ZM
VITE_DEFAULT_CURRENCY=ZMW
```

The Firebase web API key and Cloudinary **unsigned upload preset** are public
identifiers. No secret belongs in the browser: the Cloudinary API secret and
Firebase service-account key must stay in Cloud Functions and never in `.env`
or the repo.

If the Firebase config is missing or malformed the app renders `FirebaseGate`,
which explains exactly which values to set.

### 3. Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build → dist/
```

---

## What works today

### Accounts and roles
- Email + password sign-up and sign-in, email confirmation, password reset,
  session restore, sign-out.
- One person can hold many roles at once: `buyer`, `seller`, `business`,
  `employee`, `supplier`, `service_provider`, `admin`.
- **Shop / My Business mode toggle** — the whole interface changes around it.
- Account centre: profile and avatar, orders with live status, wishlist,
  addresses, my reviews, messages, notifications, security settings, and the
  data-privacy controls (export my data, delete my account) which write real
  rows to `data_requests`. Two-factor is a profile setting with
  sign-out-of-all-sessions — a real TOTP challenge is Phase 4 work, not a
  claim this build makes.

### The marketplace (buyer side)
- Homepage with categories, trending searches, best sellers, featured and
  verified businesses, deals, nearby.
- **Search that understands a sentence**: `search_products()` combines
  full-text, trigram similarity, SKU/barcode exact match and parsed filters, so
  "black shoes under 500" filters on colour and price. Sort by relevance, price,
  rating, newest, discount.
- Filters: category, price range, rating, business, city, in stock, on sale,
  wholesale, delivery, verified, attributes.
- Product page: gallery, variants, wholesale tiers and minimum order quantity,
  stock, business card with verification badges, reviews (with a **Verified
  Purchase** mark where the reviewer actually bought it), Q&A, similar products,
  wishlist, share.
- Store pages at `/store/<slug>` with the seller's own colours and layout, plus
  `/businesses`, `/nearby` (haversine over the stored location) and
  `/wholesale`.
- Cart across multiple sellers, grouped and totalled per business, with coupon
  validation and delivery fees, then checkout → `create_order()`, which
  re-reads live prices server-side, deducts stock, applies
  `free_delivery_over`, and writes the status history.

### The business workspace (seller side)
- **Onboarding wizard** (`/business/setup`) → `create_business()` creates the
  business, the owner membership, a head-office branch, a main warehouse, an
  online store, default expense categories, document number prefixes and the
  base currency — in one transaction. A separate "Become a seller" flow registers
  an existing buyer account as a seller.
- **Dashboard**: today / period revenue, orders, profit, cost of goods,
  receivables, overdue invoices, stock value, low-stock and out-of-stock counts,
  revenue-split and orders charts, top products, top customers, a task list
  generated from real overdue invoices and low stock, and the growth score from
  `compute_growth_score()`.
- **Products**: list with search and filters, create and edit with images,
  variants, SKU, barcode (generated if you do not have one), cost price, tax,
  units, wholesale price and MOQ, per-product stock adjustment with a reason,
  publish / archive, duplicate, delete, CSV export, and printable **price label
  sheets** with barcodes.
- **Orders**: filter by status, channel, payment state and date range; detail
  view with items, timeline from `status_history`, payments and documents;
  status transitions that follow the real flow and refuse impossible ones
  (cancelling a paid order is blocked in the database and restocks correctly
  when it is allowed); assign delivery; record a payment; create an invoice from
  the order; start a return; share the invoice or receipt.
- **POS** (`/business/pos`): scan or search, add by barcode, custom item,
  per-line discount, whole-sale discount, customer picker that searches or
  creates a customer, split tenders across cash / mobile money / card / bank
  transfer with change due, credit sales (no tender → the order is confirmed and
  the balance is owed), 80 mm thermal receipt PDF that prints, and a
  **customer display** on `/business/pos/display` for a second screen — the till
  publishes the running cart through `localStorage`.

### Public documents and payments
These run without an account, because the person opening them usually does not
have one:

- `/d/invoice/<token>` — the invoice with its items, totals, payments and your
  bank details; PDF download; the view is recorded (`viewed_at`,
  `viewed_count`, IP, user agent) and the seller is notified.
- `/d/receipt/<token>` — the receipt, verifiable.
- `/d/quotation/<token>` — the quotation, and the customer can **accept,
  request changes or decline**, signing with their name. The response is
  timestamped and the seller sees it immediately.
- `/pay/<code>` — a payment page showing the amount, the seller's mobile-money
  numbers and bank account. The payer declares the payment; it lands in
  `payment_link_submissions`; the seller confirms it, and only then
  `record_payment()` writes the payment, updates the invoice and generates the
  receipt. **Nothing is marked as received from the public internet.**
- `/verify/<kind>/<token>` — the QR code on every printed document resolves
  here and proves it is genuine.

### Security model
- **Row Level Security on every table**, with `SECURITY DEFINER` helper
  functions that are `STABLE` and have a pinned `search_path`.
- `can(business_id, 'permission')` → `member_permissions()` →
  `role_permissions()`. Eight member roles with granular permissions; a
  **cashier can sell but cannot read costs, expenses or profits** — that rule is
  in the database, so it holds even if someone calls the API directly.
- Financial and destructive AI actions require explicit owner approval
  (`OWNER_APPROVAL_ACTIONS` in `src/lib/permissions.ts`, enforced by
  `requiresOwnerApproval()` and by the `ai_actions` approval gate).
- `audit_logs` records who did what, when, with changes and metadata.
- Sharing is token-gated: a share token can be revoked and expires, and
  `get_shared_document` returns only the fields a customer should see.

---

## What is scaffolded but has no screen yet

The database side of these is **applied and working**; only the interface is
missing. Each route renders a "In progress" screen that lists exactly what will
land there and links to what already covers part of the need — see
`src/routes/business/ComingSoon.tsx`.

| Module | Already in the database |
| --- | --- |
| Invoices | `create_invoice`, `void_invoice`, numbering, credit/debit notes, reminders, `documents` mirror |
| Quotations | `create_quotation`, pro-forma kind, `respond_to_quotation`, `convert_quotation_to_invoice` |
| Receipts | `create_receipt`, thermal and A4 PDFs, verify tokens |
| Payments | `record_payment` with direction, overpay rules, refunds, reconciliation |
| Payment links | `create_payment_link` (callable from the console; the creation screen is not built) |
| Returns & refunds | `create_return`, `process_return` with restock and automatic credit note |
| Customers (CRM) | `upsert_customer`, statements, credit limits, groups, loyalty |
| Inventory | `adjust_stock`, `transfer_stock`, warehouses, movements, stocktakes, valuation |
| CSV import & sync | `import_csv_rows`, `sync_csv_source`, `due_csv_sources`, saved column mappings |
| Suppliers & purchases | suppliers, purchase orders, goods received, bills |
| Expenses | expense categories (seeded per business), approvals, receipts |
| Reports | 19 report templates seeded; `sales_series`, `top_products`, `top_customers`, `low_stock_alerts`, `overdue_invoices` already power the dashboard |
| Staff & roles | memberships, invites, the eight roles and their permissions |
| Settings | profile, branding, taxes, currencies, rates, numbering prefixes, branches |
| Marketing | coupons (`validate_coupon` already runs at checkout), flash sales, campaigns, AI content |
| Messages | conversations, messages, WhatsApp hand-off |
| Ask Seedwel AI | `propose_ai_action`, `ai_action_impact`, `resolve_ai_action` with owner approval |
| Growth | `compute_growth_score` (the dashboard already shows the score) |
| Documents | contracts, delivery notes, statements, digital signatures with audit trail |
| Services | `services` table: fixed, hourly, daily, per-job or quote pricing |
| Subscriptions | Free / Starter (K150) / Business (K450) / Professional (K1,200) / Enterprise, with limits |
| Ads, help centre, academy, API | tables seeded, no screens |

Phases 4–7 of the roadmap (advanced automation, AI, scale) are scaffolded in the
schema and deliberately not wired to a UI yet.

---

## Repository layout

```
supabase/sql/          12 ordered migrations — apply these first
src/
  main.tsx             entry: StrictMode + BrowserRouter + App
  App.tsx              providers, every route, error boundary
  index.css            Tailwind v4 theme + sh-* design system
  lib/                 supabase client, api (RPC wrappers), types live in src/types
    currency dates calc barcode pdf csv share slug permissions format constants env
  types/index.ts       domain types mirroring the Postgres schema
  context/             Mode, Toast, Auth, Business, Cart
  hooks/               useQuery, useBusinessQuery, useUi, useCategories, useNotifications
  components/
    ui/                Icon, Primitives, Overlays, ImageUploader, index (cards, tables, product grid)
    layout/            Logo, SiteHeader + BottomNav + Footer, PublicShell, BareShell,
                       BusinessShell, NotificationBell, Guards
    business/Shared.tsx  order & document components, DocumentLinesEditor, CustomerField
  routes/
    public/            Landing, Search, ProductDetail, StorePage, Cart + Checkout
    auth/              AuthGate, AuthPages
    account/           Account layout and its nine screens
    business/          Setup, Dashboard, Products, Orders, Pos, ComingSoon
    shared/SharedDoc.tsx  /d/:kind/:token, /pay/:code, /verify/:kind/:token
public/brand/          logos, icons, manifest, service worker
assets/                original artwork (the 12 MB master logo is gitignored)
```

### Conventions worth knowing before you edit
- **Never invent data.** If a query fails, show the error. If a module is not
  built, say it is not built.
- Money: `toNum()` before any arithmetic; `formatMoney()` before any display.
- RPC errors arrive as `"exception: <message>"`. `RpcError.reason` strips the
  prefix; `isPermission()` and `isNotFound()` branch the UX.
- Icons are a fixed `IconName` union in `src/components/ui/Icon.tsx` — there is
  no `monitor` and no `percent`.
- Tailwind v4 resolves `@apply` against *utilities only*: you cannot
  `@apply sh-btn` inside another custom class, and a data URI containing spaces
  (an SVG `viewBox`) inside `@apply` breaks the build. Both traps are commented
  where they occur in `src/index.css`.
- `ToastProvider` owns state only; `App.tsx` mounts `<ToastViewport/>` so toasts
  float above every shell, modal and the POS.

---

## Multi-country by design, Zambia first

ZMW, `+260` and VAT at 16% are seeded defaults, not constants. `countries`,
`currencies` (with configurable `exchange_rate`) and `taxes` are tables; a
business chooses its `base_currency`, its taxes and its number prefixes; and
`format_money()` renders any of them. Launching in Botswana or Malawi is a data
change, not a code change.

---

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 — Foundation | schema, auth, roles, businesses, stores, products, search, cart, checkout, orders | **working** |
| 2 — Selling | POS, receipts, customers, quotations, invoices, payments, returns | **working at the counter and from an order**; standalone module screens pending |
| 3 — Business management | inventory, suppliers, purchases, expenses, dashboard, reports, staff | **dashboard working**; module screens pending |
| 4 — Advanced | marketing, messaging, subscriptions, ads, multi-branch | schema ready |
| 5 — Automation | CSV sync, recurring invoices, approval workflows | schema ready |
| 6 — AI | assistant, content generator, insights, monthly report | schema ready, approval gate designed |
| 7 — Scale | API, help centre, academy, mobile apps | not started |

---

© Seedwel Investment Limited.
