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
number on screen comes from a real database — Cloud Firestore, through the
single data layer in `src/lib/db.ts`. Empty collections render
"No items available yet", and every unfinished screen says so out loud
instead of pretending otherwise.

The database is the product. The screens are how you reach it.

---

> **Backend:** every module runs on Firebase — Authentication, Cloud Firestore
> (deny-by-default rules in `firebase/firestore.rules`), Cloud Messaging push —
> with Cloudinary for media. The previous Supabase backend has been removed
> from the application entirely; the story of the move is recorded in
> [`docs/FIREBASE_MIGRATION.md`](docs/FIREBASE_MIGRATION.md).

---

## Stack

| Layer | Choice (current) |
| --- | --- |
| Auth | Firebase Authentication (Email/Password, verification, reset) |
| Identity | Cloud Firestore `users/{uid}` + `firebase/firestore.rules` + custom admin claims |
| Media | Cloudinary (public upload preset in the browser; secret only in Cloud Functions) |
| Database | Cloud Firestore through the central `src/lib/db.ts` layer; related rows are embedded as snapshots on the document at write time |
| Push | Firebase Cloud Messaging — web push via the service worker, one token document per device in `push_tokens` |
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

The rules deny by default: anonymous visitors can only read published
catalogue rows and pay or verify shared documents; everything else requires
the owning user or an active membership of the owning business. Platform admin
is the `admin: true` custom claim — no client-writable field ever grants
access. `firebase/firestore.indexes.json` declares the composite indexes the
screens query.

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
  session restore with an explicit auth-loading state, sign-out.
- One person can hold many roles at once: `buyer`, `seller`, `business`,
  `employee`, `supplier`, `service_provider`, `admin`.
- **Shop / My Business mode toggle** — the whole interface changes around it.
  The admin tab appears on the profile only for a user holding the platform
  admin claim (never from a doc field).
- Account centre: profile and avatar, orders with live status, wishlist,
  addresses, my reviews, messages, notifications, security settings, and the
  data-privacy controls (export my data, delete my account) which write real
  rows to `data_requests`. Two-factor is a profile setting with
  sign-out-of-all-sessions — a real TOTP challenge is Phase 4 work, not a
  claim this build makes.

### The marketplace (buyer side)
- Homepage with categories, trending searches, best sellers, featured and
  verified businesses, deals, nearby.
- **Search over the real catalogue**: queries Firestore for published
  products, services and businesses, and narrows client-side — SKU and barcode
  hits match exactly, free text is a case-insensitive substring match, so
  "black shoes under 500" filters on colour and price. Sort by price, rating,
  newest, discount.
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
  validation and delivery fees, then checkout, which writes the Firestore
  order with its embedded business/product snapshots, deducts tracked stock
  through a matching `inventory_movements` audit row, applies
  `free_delivery_over`, and records the status history.

### The business workspace (seller side)
- **Onboarding wizard** (`/business/setup`) creates the business document,
  the owner membership (a deterministic `business_members/{businessId}__{uid}`
  row), a head-office branch, a main warehouse and a starter subscription in
  one setup run. A separate "Become a seller" flow registers an existing buyer
  account as a seller.
- **Dashboard**: today / period revenue, orders, profit, cost of goods,
  receivables, overdue invoices, stock value, low-stock and out-of-stock counts,
  revenue-split and orders charts, top products, top customers, a task list
  generated from real overdue invoices and low stock, and the growth score.
- **Products**: list with search and filters, create and edit with images,
  variants, SKU, barcode (generated if you do not have one), cost price, tax,
  units, wholesale price and MOQ, per-product stock adjustment with a reason,
  publish / archive, duplicate, delete, CSV export, and printable **price label
  sheets** with barcodes.
- **Orders**: filter by status, channel, payment state and date range; detail
  view with items, timeline from `status_history`, payments and documents;
  status transitions that follow the real flow and refuse impossible ones
  (cancelling a paid order is refused; allowed cancellations and returns
  restock through the order flow); assign delivery; record a payment; create
  an invoice from the order; start a return; share the invoice or receipt.
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
  `payment_submissions`; the seller confirms it, and only then the app writes
  the payment, updates the invoice and generates the receipt. **Nothing is
  marked as received from the public internet.**
- `/verify/<kind>/<token>` — the QR code on every printed document resolves
  here and proves it is genuine.

### Security model
- **Deny-by-default Firestore rules** (`firebase/firestore.rules`): every
  collection is granted only what the real screens need — there is no broad
  "authenticated can read" rule — and rules deploy with the app.
- Platform admin is the **`admin: true` custom claim** on the Auth token, set
  by an Admin SDK / Cloud Function. Role fields on `users/{uid}` are not
  user-writable; registration always creates a normal buyer and no
  `is_platform_admin`-style field on a document ever grants access.
- Business access is membership-based: `business_members/{businessId}__{uid}`
  carries the role (`owner`, `administrator`, `manager`, `staff`, …) and
  status, and the deterministic id is checked inside the rules. Only active
  members of the owning business can read or write its products, orders,
  customers, invoices and stock. Granular role permissions gate the UI through
  `src/lib/permissions.ts` (`can()`).
- Buyers own their profile, addresses, wishlist, cart, conversations, messages
  and notifications. Sellers may only notify users who belong to a linked
  order or conversation — notification rules check the link.
- Sharing is token-gated: creating a share stamps `share_token` and
  `share_expires_at` on the document itself, and rules make exactly those
  documents readable anonymously until they expire. Printed documents carry QR
  codes that resolve to `/verify`.
- Money: order lines are snapshots of what the buyer's client sent, and
  identity/ownership are enforced strictly by rules. Server-side validation of
  prices (a Cloud Function) is the remaining piece, tracked in
  [`docs/FIREBASE_MIGRATION.md`](docs/FIREBASE_MIGRATION.md).
- Order status changes and stock movements each leave a `status_history` /
  `inventory_movements` trail in Firestore, and destructive AI actions require
  explicit owner approval (`OWNER_APPROVAL_ACTIONS` in `src/lib/permissions.ts`).

## What is built, and what honestly says "in progress"

Screens fully wired to Firestore today: the marketplace (Home, Search,
Products, Product detail, Stores, Businesses, Services, Cart & checkout,
Messages, Groups, Orders & tracking, Profile, Notifications with push) and the
business workspace — Dashboard, Setup / Become a seller, Products (editor,
variants, stock adjustments), Orders (list, detail, return), POS with customer
display, Invoices, Quotations, Receipts and Payments.

Modules without their own screen yet render an "In progress" page
(`src/routes/business/ComingSoon.tsx`) that lists exactly what will land there
and links to the flows that already cover part of the need: payment links,
returns, customers (CRM), stock & warehouses, CSV import, barcodes & labels,
suppliers & purchases, expenses, finance & statements, reports, staff & roles,
store settings & categories, services, marketing, audit log and the AI
assistant.

The authoritative map of collections — and of who may read or write each — is
`firebase/firestore.rules`; the composite indexes the screens query are in
`firebase/firestore.indexes.json`.

## Repository layout

```
firebase/              firestore.rules, firestore.indexes.json, storage.rules
src/
  main.tsx             entry: StrictMode + BrowserRouter + App
  App.tsx              providers, every route, error boundary
  index.css            Tailwind v4 theme + sh-* design system
  lib/                 firebase.ts (init), db.ts (the Firestore data layer),
                       api.ts (domain services), messaging.ts, groups.ts,
                       notifications.ts, push.ts, media.ts, plus currency dates
                       calc barcode pdf csv share slug permissions format constants env
  types/index.ts       domain types matching the Firestore documents
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
    business/          Setup, Dashboard, Products, Orders, Pos, Invoices,
                       Quotations, Receipts, Payments, ComingSoon
    shared/SharedDoc.tsx  /d/:kind/:token, /pay/:code, /verify/:kind/:token
public/brand/          logos, icons, manifest, service worker
assets/                original artwork (the 12 MB master logo is gitignored)
```

### Conventions worth knowing before you edit
- **Never invent data.** If a query fails, show the error. If a module is not
  built, say it is not built.
- Money: `toNum()` before any arithmetic; `formatMoney()` before any display.
- Firestore errors are wrapped by the data layer into friendly messages
  (`friendlyFirestoreError`); screens branch on `isPermissionError()` and
  `isNotFound()` — users never see raw SDK errors or stack traces.
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

ZMW, `+260` and VAT at 16% are seeded defaults, not constants. Registration
captures the buyer's country, currency, language and time zone; a business
chooses its base currency, taxes and document number prefixes; and
`formatMoney()` renders any of them. Launching in Botswana or Malawi is a data
change, not a code change.

---

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 — Foundation | Firebase backend, auth & roles, businesses, stores, products, search, cart, checkout, orders, messages, notifications | **working** |
| 2 — Selling | POS, receipts, quotations, invoices, payments | **working** |
| 3 — Business management | inventory, suppliers, purchases, expenses, dashboard, reports, staff | **dashboard and stock adjustments working**; module screens pending |
| 4 — Advanced | returns & customers CRM, marketing, subscriptions, multi-branch | data model + rules ready; screens pending |
| 5 — Automation | CSV sync, recurring invoices, approval workflows | data model ready |
| 6 — AI | assistant, content generator, insights, monthly report | approval gate designed; screens pending |
| 7 — Scale | API, help centre, academy, mobile apps | not started |

---

© Seedwel Investment Limited.
