# Seedwel Hub — Supabase → Firebase Migration

**Status:** Phase 1 (Authentication + user profiles + security) is scaffolded on
this branch. The rest of the marketplace still runs on the legacy
Supabase/Postgres data layer and is migrated module-by-module below.

**Product line:** Seedwel Hub — *Buy. Sell. Manage. Grow.* A product of Seedwel
Investment Limited.

---

## Why this migration

The platform is being repositioned as a low-cost, scalable marketplace + back
office. The architecture keeps the first version free-tier friendly:

- Firebase Authentication → identity, verification, password reset.
- Cloud Firestore → all platform records (users, businesses, products, orders,
  payments, messages, documents…).
- Cloudinary → public images/videos; the API secret stays server-side.
- Firebase Cloud Messaging / Web Push → notifications.
- Firebase Cloud Functions → secure backend work, audit, admin, automation.
- Firebase Security Rules → deny-by-default data access.
- Firebase Admin SDK + custom claims → true admin authorization.
- Hosting: Firebase Hosting or Vercel.
- Payments: manual payment proof in Phase 5; Pesapal integration comes later and
  stays separate from business records.

---

## What Phase 1 does on this branch

| Area | Done | Files |
| --- | --- | --- |
| Firebase web SDK | Installed `firebase` and lazy-initialised the app | `src/lib/firebase.ts` |
| Runtime config | Firebase + Cloudinary public vars | `.env`, `.env.example`, `src/lib/env.ts` |
| Authentication | Sign up, sign in, password reset, email verification, session restore | `src/context/AuthContext.tsx`, `src/routes/auth/AuthPages.tsx` |
| User profile | `users/{uid}` Firestore doc, same field names as old `profiles` | `src/lib/firestore.ts` |
| Backend gate | `FirebaseGate` replaces the Supabase setup screen | `src/routes/auth/AuthGate.tsx`, `src/App.tsx` |
| Security rules | Owner-readable/writable profiles + deny-by-default catch-all | `firebase/firestore.rules`, `firebase/storage.rules` |
| Firebase config | CLI config for Firestore rules, Storage rules, Hosting | `firebase.json`, `firebase/firestore.indexes.json` |
| Docs | This plan | `docs/FIREBASE_MIGRATION.md` |

### Important non-goal in Phase 1

Admin access is **not** a doc field such as `is_platform_admin: true` that a
user could write in their own `users/{uid}`. It is a **Firebase custom claim**
(`admin: true`). In Firestore rules:

```text
function isAdmin() {
  return request.auth != null && request.auth.token.admin == true;
}
```

The Cloud Functions layer uses the same claim (or makes an Admin SDK lookup)
before any privileged operation. The frontend reads the claim via
`getIdTokenResult()` only to show/hide UI.

---

## Phase 1 setup steps

### 1. Firebase project

1. Create/open a Firebase project.
2. Add a **Web app** and copy the `firebaseConfig` into `.env`.
3. **Authentication** → enable **Email/Password**.
4. **Cloud Firestore** → create in production mode.
5. Deploy the Phase 1 rules:

```bash
npx firebase deploy --only firestore:rules,storage:rules
```

### 2. Client env

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=

# Public Cloudinary values only
VITE_CLOUDINARY_CLOUD_NAME=...
VITE_CLOUDINARY_PRESET=...

VITE_DEFAULT_COUNTRY=ZM
VITE_DEFAULT_CURRENCY=ZMW
VITE_REQUIRE_EMAIL_VERIFICATION=true
```

### 3. Grant the first admin (custom claim)

Use the Firebase Admin SDK from a trusted place (Cloud Function/CLI script):

```ts
import { getAuth } from 'firebase-admin/auth';

await getAuth().setCustomUserClaims(uid, { admin: true, role: 'admin' });
```

The same script can create `users/{uid}` if a profile is missing.

---

## Credential rules

- **Firebase web API keys** are public identifiers. They are safe in the
  browser only if rules and claims are correct.
- **Firebase service-account private key** must never be in the repo. It is
  used by Cloud Functions / Admin SDK deployments only.
- **Cloudinary API secret** must never be in the browser. Use:
  - unsigned upload preset for low-risk public uploads, or
  - a signed upload endpoint in a Cloud Function for controlled media.
- **Web Push/VAPID public key** may be exposed to the browser. The **private key**
  stays server-side.
- `.gitignore` already blocks `*.service_role*` and secret files; keep Firebase
  private keys out of `.env` too.

---

## Firestore target structure

This is the Phase-by-Phase target. Phase 1 ships only `users`.

```text
users
profiles

businesses
businessMembers
businessBranches

products
productVariants
categories
services

stores
orders
orderItems

customers
suppliers

quotations
quotationItems

invoices
invoiceItems

receipts
payments
paymentMethods
paymentProofs
paymentDisputes

inventory
inventoryMovements
warehouses

expenses
purchaseOrders

conversations
messages
groups
groupMembers

notifications
deviceSessions

reviews
wishlists
follows

documents
signatures

subscriptions
plans

reports
auditLogs
securityEvents

adminActions
supportTickets
```

Every collection gets its own scoped rules. Public storefront collections get
limited read access; private records require ownership/membership; platform
operations require `isAdmin()` and are recorded in `adminActions` + `auditLogs`.

---

## Rules strategy

- Specific `match /users/{uid}` rules for Phase 1.
- A **deny-by-default catch-all** stays last so anything not explicitly opened
  is closed.
- Phase 2+ adds scoped matches for `businesses`, `products`, `orders`, etc.
- Storage stays closed until media moves to Cloudinary (or limited signed
  access is added).

```text
match /users/{uid} {
  allow read: if isOwner(uid) || isAdmin();
  allow create: if isOwner(uid);
  allow update: if isOwner(uid) || isAdmin();
  allow delete: if isAdmin();
}
```

---

## Migration phases

### Phase 1 — Firebase + Authentication + user profiles + security ✅ (scaffolded)

- Firebase app + config, Auth context, `users/{uid}` profile, rules, gate.
- `src/context/AuthContext.tsx` no longer imports Supabase.
- Email confirmation and password reset use Firebase ActionCodeSettings.

### Phase 2 — Businesses + stores + products + Cloudinary

- Migrate `BusinessContext`, products/categories/store pages to Firestore.
- Cloudinary uploader replaces Supabase Storage for media.
- Rules: business owners/members, public storefront reads.

### Phase 3 — Marketplace + search + orders

- Migrate search/listing/detail and checkout/cart/orders.
- Firestore queries + indexes; server-side search keeps reads cheap.
- Remove the first Supabase consumer modules.

### Phase 4 — Customers + quotations + invoices + receipts

- Migrate document generation to keep the same PDF/thermal outputs, sourced
  from Firestore.
- Business identity populates every doc from the same profile.

### Phase 5 — Manual payments + payment proof + transaction monitoring

- `paymentMethods`, `paymentProofs`, `payments`, `paymentsDisputes`.
- Buyer submits reference/proof; seller confirms/rejects; admin dispute review.

### Phase 6 — Messaging + groups + notifications

- conversations/messages/groups/groupMembers + FCM/Web Push.
- Notification center with filters.

### Phase 7 — Inventory + suppliers + expenses + reports

- Stock movements, warehouses, purchase orders, expenses, dashboards.

### Phase 8 — Admin Command Center + verification + disputes + security

- `/admin` route, global search, audit logs, security alerts, verification
  workflows, platform admin custom claims.

### Phase 9 — Subscriptions + watermark removal + paid plans

- Plan limits, subscription state, watermark on free-generated documents,
  upgrade path.

### Phase 10 — AI + automation + Pesapal/API integrations

- Seedwel AI, automation, external payments.

---

## What gets removed as phases land

Each phase should remove the matching Supabase usage:

- Phase 2: Supabase storage + products/business queries.
- Phase 3: orders/marketplace `rpc` calls.
- Phase 4: document/invoice/receipt `rpc` calls.
- Phase 5: payment `rpc` calls.
- Phase 6: conversations/messages `rpc` calls.
- Phase 7: inventory/finance/report `rpc` calls.
- Phase 8: admin `rpc` calls.
- Final pass:
  - delete `@supabase/supabase-js` from `package.json`.
  - delete `src/lib/supabase.ts`, `src/lib/api.ts`, and the legacy wrappers.
  - delete `supabase/sql/` after the last legacy module is migrated.

---

## Free-tier discipline

- Paginate every Firestore list; avoid `get()` of whole collections.
- Prefer document refs/compound queries over wide scans.
- Cache rarely-changing public data; invalidate on write.
- Compress Cloudinary media; use responsive transforms/`f_auto,q_auto`.
- Keep expensive/large operations in Cloud Functions, not the browser.
- Avoid background jobs that run continuously.
- Fan-out notifications via FCM, not by reading every user doc.
- Use a single Firestore write/trigger for denormalised counters rather than
  recomputing totals on read.
