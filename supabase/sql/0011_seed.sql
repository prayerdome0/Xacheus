-- ══════════════════════════════════════════════════════════════════════════════
--  SEEDWEL HUB — 0011 · Storage buckets & policies, search indexes,
--                        marketplace categories, help centre, academy
--
--  No demo products, no fake businesses, no seeded orders. A real marketplace is
--  populated by real sellers. Only the platform's own reference content is
--  seeded here.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. STORAGE BUCKETS
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, public, file_size_limit, allowed_mime_types) values
  ('avatars',    true,  5242880,  array['image/jpeg','image/png','image/webp']),
  ('businesses', true, 10485760,  array['image/jpeg','image/png','image/webp']),
  ('products',   true, 10485760,  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm']),
  ('documents',  false, 20971520, array['application/pdf','image/jpeg','image/png','text/plain','application/msword',
                                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                        'application/vnd.ms-excel',
                                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                        'text/csv']),
  ('signatures', false, 2097152,  array['image/png','image/jpeg','image/webp']),
  ('imports',    false, 52428800, array['text/csv','text/plain','application/vnd.ms-excel',
                                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('support',    false, 20971520, array['image/jpeg','image/png','application/pdf']),
  ('exports',    false, 104857600,array['application/pdf','text/csv',
                                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                        'application/zip'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. STORAGE POLICIES
--    Path convention: <bucket>/<business_id|user_id>/…  — the first path segment
--    is the scope, which is what every policy checks.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.storage_scope(path text)
returns text language sql immutable set search_path = public as $$
  select nullif(split_part(coalesce(path,''), '/', 1), '');
$$;

create or replace function public.storage_business_ok(path text, permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.can(public.storage_scope(path)::uuid, permission), false);
$$;

create or replace function public.storage_self_ok(path text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.storage_scope(path) = auth.uid()::text or public.is_admin();
$$;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'storage' and tablename = 'objects' loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

alter table storage.objects enable row level security;

-- Public buckets are world-readable (logos, product photos, avatars).
create policy "public_bucket_read" on storage.objects
  for select using (
    bucket_id in ('avatars','businesses','products')
    or public.is_admin()
  );

-- Private buckets: only people with permission on the owning business.
create policy "private_bucket_read" on storage.objects
  for select using (
    (bucket_id in ('documents','signatures','exports','imports','support')
      and (
        public.storage_business_ok(name,'documents.read')
        or public.storage_self_ok(name)
        or exists (select 1 from public.profiles p where p.id = auth.uid()
                   and public.storage_scope(objects.name) = p.default_business::text)
      ))
    or public.is_admin()
  );

create policy "avatar_upload" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and public.storage_scope(name) = auth.uid()::text
  );
create policy "avatar_update" on storage.objects
  for update using (bucket_id = 'avatars' and (public.storage_scope(name) = auth.uid()::text or public.is_admin()))
  with check (bucket_id = 'avatars' and (public.storage_scope(name) = auth.uid()::text or public.is_admin()));
create policy "avatar_delete" on storage.objects
  for delete using (bucket_id = 'avatars' and (public.storage_scope(name) = auth.uid()::text or public.is_admin()));

create policy "business_media_upload" on storage.objects
  for insert with check (
    bucket_id = 'businesses' and public.storage_business_ok(name,'settings.write')
  );
create policy "business_media_update" on storage.objects
  for update using (bucket_id = 'businesses' and public.storage_business_ok(name,'settings.write'))
  with check (bucket_id = 'businesses' and public.storage_business_ok(name,'settings.write'));
create policy "business_media_delete" on storage.objects
  for delete using (bucket_id = 'businesses' and public.storage_business_ok(name,'settings.write'));

create policy "product_media_upload" on storage.objects
  for insert with check (
    bucket_id = 'products' and public.storage_business_ok(name,'products.write')
  );
create policy "product_media_update" on storage.objects
  for update using (bucket_id = 'products' and public.storage_business_ok(name,'products.write'))
  with check (bucket_id = 'products' and public.storage_business_ok(name,'products.write'));
create policy "product_media_delete" on storage.objects
  for delete using (bucket_id = 'products' and public.storage_business_ok(name,'products.write'));

create policy "document_upload" on storage.objects
  for insert with check (
    bucket_id in ('documents','signatures','exports')
    and (public.storage_business_ok(name,'documents.write') or public.storage_self_ok(name))
  );
create policy "document_delete" on storage.objects
  for delete using (
    bucket_id in ('documents','signatures','exports')
    and (public.storage_business_ok(name,'documents.write') or public.storage_self_ok(name) or public.is_admin())
  );

create policy "import_upload" on storage.objects
  for insert with check (
    bucket_id = 'imports' and public.storage_business_ok(name,'products.write')
  );
create policy "import_delete" on storage.objects
  for delete using (
    bucket_id = 'imports' and public.storage_business_ok(name,'products.write')
  );

create policy "support_upload" on storage.objects
  for insert with check (
    bucket_id = 'support' and (public.storage_scope(name) = auth.uid()::text or public.is_admin())
  );
create policy "support_read" on storage.objects
  for select using (
    bucket_id = 'support' and (public.storage_scope(name) = auth.uid()::text or public.is_admin())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. EXTRA SEARCH INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists products_created_idx on public.products (created_at desc) where deleted_at is null;
create index if not exists orders_placed_idx on public.orders (placed_at desc);
create index if not exists invoices_issue_idx on public.invoices (issue_date desc);
create index if not exists payments_received_idx on public.payments (received_at desc);
create index if not exists expenses_date_idx on public.expenses (expense_date desc);
create index if not exists reviews_created_idx on public.reviews (created_at desc);
create index if not exists notifications_created_idx on public.notifications (created_at desc);
create index if not exists messages_created_idx on public.messages (created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. MARKETPLACE CATEGORIES
-- ─────────────────────────────────────────────────────────────────────────────
with seed(name, slug, icon, kind, sort_order, is_featured, children) as (
  values
    ('Electronics','electronics','🔌','product',10,true,
      array['TVs & Home Theatre','Audio & Speakers','Cameras','Wearables','Gaming']),
    ('Phones & Tablets','phones-tablets','📱','product',11,true,
      array['Smartphones','Feature Phones','Tablets','Phone Accessories','Phone Repairs']),
    ('Computers & Office','computers-office','💻','product',12,false,
      array['Laptops','Desktops','Printers & Scanners','Networking','Office Furniture','Stationery']),
    ('Clothing & Apparel','clothing-apparel','👕','product',20,true,
      array['Men''s Clothing','Women''s Clothing','Children''s Clothing','Traditional Wear','Uniforms & Workwear']),
    ('Shoes & Bags','shoes-bags','👟','product',21,false,
      array['Men''s Shoes','Women''s Shoes','Children''s Shoes','Bags & Luggage','School Shoes']),
    ('Beauty & Health','beauty-health','💄','product',22,false,
      array['Hair Products','Skincare','Cosmetics','Fragrances','Pharmacy & Wellness','Salon Supplies']),
    ('Home & Kitchen','home-kitchen','🏠','product',30,false,
      array['Furniture','Cookware','Appliances','Bedding','Home Décor','Cleaning Supplies']),
    ('Food & Groceries','food-groceries','🛒','product',31,true,
      array['Fresh Produce','Maize & Mealie Meal','Cooking Oil','Beverages','Bakery','Butchery','Snacks']),
    ('Agriculture & Farming','agriculture-farming','🌾','product',32,false,
      array['Seeds','Fertiliser','Farm Equipment','Livestock','Poultry','Irrigation','Animal Feed']),
    ('Hardware & Building','hardware-building','🔨','product',40,true,
      array['Tools','Plumbing','Electrical Supplies','Cement & Bricks','Timber & Steel','Roofing','Paints','Fasteners']),
    ('Vehicles & Transport','vehicles-transport','🚗','product',41,false,
      array['Cars for Sale','Motorcycles','Bicycles','Vehicle Parts','Tyres & Batteries','Commercial Vehicles']),
    ('Industrial Equipment','industrial-equipment','🏭','product',42,false,
      array['Machinery','Generators','Welding','Safety Equipment','Packaging Machinery']),
    ('Wholesale','wholesale','📦','product',50,true,
      array['Wholesale Groceries','Wholesale Electronics','Wholesale Clothing','Wholesale Hardware','Bulk Building Materials']),
    ('Construction','construction','🏗️','service',60,true,
      array['Building Contractors','Roofing','Tiling','Welding & Fabrication','Painting Services']),
    ('Trades & Repairs','trades-repairs','🔧','service',61,true,
      array['Plumbing','Electrical','Appliance Repair','Phone Repair','Car Repair','Air Conditioning']),
    ('Design & Creative','design-creative','🎨','service',62,false,
      array['Graphic Design','Web Development','Photography','Videography','Printing & Branding','Signage']),
    ('Transport & Logistics','transport-logistics','🚚','service',63,false,
      array['Goods Delivery','House Moving','Courier Services','Hire Vehicles','Freight']),
    ('Professional Services','professional-services','💼','service',64,false,
      array['Accounting','Legal Services','Consulting','Company Registration','Tax Services','Insurance']),
    ('Events & Catering','events-catering','🍽️','service',65,false,
      array['Catering','Event Planning','Décor & Tents','DJ & Sound','Venue Hire']),
    ('Cleaning & Domestic','cleaning-domestic','🧹','service',66,false,
      array['Home Cleaning','Office Cleaning','Laundry','Pest Control','Gardening']),
    ('Education & Training','education-training','🎓','service',67,false,
      array['Tutoring','Skills Training','Driving School','Language Classes','Computer Training']),
    ('Health & Fitness','health-fitness','🩺','service',68,false,
      array['Clinics','Dentists','Physiotherapy','Gyms','Counselling'])
)
insert into public.categories (name, slug, icon, kind, sort_order, is_featured, path, depth, is_active)
select name, slug, icon, kind, sort_order, is_featured, '/' || slug, 0, true
from seed
on conflict (slug) do update set
  name = excluded.name, icon = excluded.icon, kind = excluded.kind,
  sort_order = excluded.sort_order, is_featured = excluded.is_featured;

-- Second level
with seed(name, slug, icon, kind, sort_order, is_featured, children) as (
  values
    ('Electronics','electronics','🔌','product',10,true,
      array['TVs & Home Theatre','Audio & Speakers','Cameras','Wearables','Gaming']),
    ('Phones & Tablets','phones-tablets','📱','product',11,true,
      array['Smartphones','Feature Phones','Tablets','Phone Accessories','Phone Repairs']),
    ('Computers & Office','computers-office','💻','product',12,false,
      array['Laptops','Desktops','Printers & Scanners','Networking','Office Furniture','Stationery']),
    ('Clothing & Apparel','clothing-apparel','👕','product',20,true,
      array['Men''s Clothing','Women''s Clothing','Children''s Clothing','Traditional Wear','Uniforms & Workwear']),
    ('Shoes & Bags','shoes-bags','👟','product',21,false,
      array['Men''s Shoes','Women''s Shoes','Children''s Shoes','Bags & Luggage','School Shoes']),
    ('Beauty & Health','beauty-health','💄','product',22,false,
      array['Hair Products','Skincare','Cosmetics','Fragrances','Pharmacy & Wellness','Salon Supplies']),
    ('Home & Kitchen','home-kitchen','🏠','product',30,false,
      array['Furniture','Cookware','Appliances','Bedding','Home Décor','Cleaning Supplies']),
    ('Food & Groceries','food-groceries','🛒','product',31,true,
      array['Fresh Produce','Maize & Mealie Meal','Cooking Oil','Beverages','Bakery','Butchery','Snacks']),
    ('Agriculture & Farming','agriculture-farming','🌾','product',32,false,
      array['Seeds','Fertiliser','Farm Equipment','Livestock','Poultry','Irrigation','Animal Feed']),
    ('Hardware & Building','hardware-building','🔨','product',40,true,
      array['Tools','Plumbing','Electrical Supplies','Cement & Bricks','Timber & Steel','Roofing','Paints','Fasteners']),
    ('Vehicles & Transport','vehicles-transport','🚗','product',41,false,
      array['Cars for Sale','Motorcycles','Bicycles','Vehicle Parts','Tyres & Batteries','Commercial Vehicles']),
    ('Industrial Equipment','industrial-equipment','🏭','product',42,false,
      array['Machinery','Generators','Welding','Safety Equipment','Packaging Machinery']),
    ('Wholesale','wholesale','📦','product',50,true,
      array['Wholesale Groceries','Wholesale Electronics','Wholesale Clothing','Wholesale Hardware','Bulk Building Materials']),
    ('Construction','construction','🏗️','service',60,true,
      array['Building Contractors','Roofing','Tiling','Welding & Fabrication','Painting Services']),
    ('Trades & Repairs','trades-repairs','🔧','service',61,true,
      array['Plumbing','Electrical','Appliance Repair','Phone Repair','Car Repair','Air Conditioning']),
    ('Design & Creative','design-creative','🎨','service',62,false,
      array['Graphic Design','Web Development','Photography','Videography','Printing & Branding','Signage']),
    ('Transport & Logistics','transport-logistics','🚚','service',63,false,
      array['Goods Delivery','House Moving','Courier Services','Hire Vehicles','Freight']),
    ('Professional Services','professional-services','💼','service',64,false,
      array['Accounting','Legal Services','Consulting','Company Registration','Tax Services','Insurance']),
    ('Events & Catering','events-catering','🍽️','service',65,false,
      array['Catering','Event Planning','Décor & Tents','DJ & Sound','Venue Hire']),
    ('Cleaning & Domestic','cleaning-domestic','🧹','service',66,false,
      array['Home Cleaning','Office Cleaning','Laundry','Pest Control','Gardening']),
    ('Education & Training','education-training','🎓','service',67,false,
      array['Tutoring','Skills Training','Driving School','Language Classes','Computer Training']),
    ('Health & Fitness','health-fitness','🩺','service',68,false,
      array['Clinics','Dentists','Physiotherapy','Gyms','Counselling'])
),
child as (
  select p.id as parent_id, p.slug as parent_slug, p.kind, p.sort_order,
         trim(c) as child_name,
         p.slug || '-' || public.slugify(trim(c)) as child_slug
  from seed s
  join public.categories p on p.slug = s.slug
  cross join lateral unnest(s.children) as c
)
insert into public.categories (parent_id, name, slug, kind, path, depth, sort_order, is_active)
select parent_id, child_name, child_slug, kind,
       '/' || parent_slug || '/' || child_slug, 1, sort_order + 1, true
from child
on conflict (slug) do update set
  name = excluded.name, parent_id = excluded.parent_id, path = excluded.path, depth = excluded.depth;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. HELP CENTRE
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.help_articles (slug, title, summary, body, section, tags, icon, audience, sort_order) values
('get-started','Get started on Seedwel Hub',
 'Create your account, set up your business and publish your first product in under ten minutes.',
 '# Get started on Seedwel Hub

Seedwel Hub is one account for the whole business: your store, your stock, your customers, your documents and your money.

## 1. Create your account
Register with your email or phone number. One account can be a **buyer**, a **seller**, a **business**, an **employee**, a **supplier** and a **service provider** at the same time — you do not need separate logins.

## 2. Create your business
Go to **Become a seller** and enter your business name, category, phone, WhatsApp and location. Seedwel Hub automatically creates:
- your **business profile**
- your **online store** at `/store/<your-name>`
- your **head office** and **main warehouse**
- your **expense categories** and **tax configuration**
- your document numbering (`INV-00001`, `QTN-00001`, `RCP-00001`, `ORD-00001`)

## 3. Add products
Add products one by one, or upload a CSV. Each product can have photos, variants (size, colour, model), a retail price, a wholesale price, cost price and stock.

## 4. Publish your store
Once you have a few products, your store is live and searchable in the marketplace.

## 5. Get verified
Upload your registration certificate or PACRA document under **Settings → Verification** to earn the ✓ Verified badge and appear higher in search.',
 'getting_started', array['start','register','store','setup'], '🚀', 'all', 1),

('selling-online','How to sell online',
 'Publish products, take orders, get paid and keep your stock correct.',
 '# How to sell online

## Publish a product
**My Business → Products → + New product.** Fill in the name, price, photos, category and stock. Set `Publish` to make it visible in the marketplace.

## Wholesale and retail
Set a **retail price** and a **wholesale price** with a minimum quantity. Example: retail K100, wholesale K75, minimum 20 units. Buyers ordering 20 or more automatically get the wholesale price, and you can issue a wholesale quotation.

## Orders
Orders arrive from your store, from the marketplace, from POS sales at your counter, or from a quotation you converted. Every status change notifies the buyer: pending → confirmed → processing → ready → shipped → delivered.

## Getting paid
Record a payment against an order or invoice. Seedwel Hub automatically:
1. updates the invoice balance,
2. marks the invoice **Partially paid** or **Paid**,
3. generates a **receipt** with a QR verification code,
4. writes the entry to the customer ledger.

## Payment links
Need money from a customer on WhatsApp? Create a payment link (**+ Create → Payment request**), send the short URL, and the invoice and receipt update themselves when it is paid.',
 'selling', array['sell','orders','payments','wholesale'], '🛍️', 'seller', 2),

('csv-import','Import and sync your inventory with CSV',
 'Upload a CSV, paste a URL, map your columns, preview, validate and import — once or on a schedule.',
 '# CSV inventory import & synchronisation

If your stock already lives in a spreadsheet or another system, do not retype it.

## Step 1 — Add a source
**My Business → Inventory → Import → New CSV source.** Upload a file or paste a URL that always points at your latest stock.

## Step 2 — Map your columns
Seedwel Hub reads your header row and suggests a mapping:

| Your column | Seedwel field |
|---|---|
| Product Name | Product |
| SKU | SKU |
| Price | Price |
| Stock | Inventory |
| Category | Category |
| Image URL | Image |
| Description | Description |

You can also map Cost, Wholesale price, Barcode, Brand and Weight.

## Step 3 — Preview and validate
You see the first rows exactly as they will be imported, plus every validation error with its row number:

> **Rows: 441 · Will create: 312 · Will update: 126 · Errors: 3**

Nothing is written until you press **Import**.

## Step 4 — Choose one-time or automatic
Pick **One-time import**, or **Sync every 30 minutes** (any interval you like). On each sync Seedwel Hub re-reads the source, updates price, stock, description and images, and records every stock change as an auditable inventory movement.

The import screen always shows:

> **Last synchronisation: 14:32**
> **Products updated: 438**
> **Errors: 3**

## Matching and conflicts
Choose how products are matched — by **SKU**, **barcode**, **name** or **external ID** — and what happens on a conflict: **skip**, **update** or **create new**. You also choose which fields the sync is allowed to change, so a scheduled sync can update stock without ever touching your prices.',
 'inventory', array['csv','import','sync','inventory'], '🔄', 'seller', 3),

('invoicing','Quotations, pro-forma invoices, invoices and receipts',
 'Create professional documents, send them by WhatsApp or email, and convert one into the next with a single click.',
 '# Documents

## Quotations
**+ Create → Quotation.** Pick the customer, add products or services with quantities, and Seedwel Hub calculates subtotal, discount, tax, delivery and total.

Then: **Generate PDF · Send WhatsApp · Send Email · Share link.**

Your customer can open the link and **Accept**, **Reject**, **Request changes** or **Sign** it. A signature captures the name, time, IP address and the exact document text — that is your audit trail.

**Convert to Invoice** turns an accepted quotation into a tax invoice in one click, copying every line.

## Pro-forma invoices
Use **Create pro-forma invoice** when a customer must pay before you issue a tax invoice. It is the same table as a quotation with `kind = proforma`, so it behaves identically.

## Invoices
Invoices carry your logo, business details, customer details, invoice number, dates, items, tax, total, amount paid, balance, terms, notes and a QR verification code.

Statuses: **Draft → Sent → Viewed → Partially paid → Paid**, plus **Overdue**, **Cancelled** and **Void**. You are told when the customer opens it.

## Receipts
Receipts are generated automatically whenever a payment is recorded, with receipt number, invoice number, customer, amount, method, date, remaining balance, signature and QR code.

## Statements, credit notes and debit notes
**Statement of account** shows opening balance, invoices, payments, credits and closing balance for any date range. **Credit notes** and **debit notes** link to the original invoice and adjust the customer balance automatically.',
 'invoicing', array['invoice','quotation','receipt','proforma','statement'], '🧾', 'seller', 4),

('pos','Using the Seedwel POS',
 'Scan, sell, take payment and print a receipt — stock decreases automatically.',
 '# Seedwel POS

The POS is built for a phone or tablet on the counter.

**My Business → POS**

1. **Scan or search** — tap the barcode button and scan with the camera, or type a name, SKU or barcode.
2. **Add quantity** — tap a product to add one, long-press to set a quantity, apply a line discount, or add a free-text line for anything you do not stock.
3. **Take payment** — cash, card, mobile money or a payment link. Split payments across methods are supported.
4. **Receipt** — the receipt is generated automatically with a QR code, and stock decreases immediately, recorded as a `sale` movement in the inventory ledger.

Cashiers see prices and can take money, but they **cannot** see cost prices, expenses, profit or company settings — that is enforced in the database, not just hidden in the interface.

Use the **Customer display** mode on a second screen so the customer sees items, quantities, prices, the total, the amount tendered and their change.',
 'pos', array['pos','barcode','scan','counter'], '🧮', 'seller', 5),

('inventory-basics','Inventory, warehouses and stock movements',
 'Track stock per warehouse, receive goods, transfer between branches, count stock and see its value.',
 '# Inventory

## Per-location stock
Every product has a stock row **per warehouse or shop**: Warehouse A, Warehouse B, Shop 1, Shop 2. The product page shows the total; the inventory screen shows the breakdown.

## Movements
Every change is a ledger entry you can audit: purchase, sale, adjustment, transfer in/out, return in/out, damaged, expired, counted, opening, import. Each entry records who did it, when, the quantity before and after, the unit cost and a reference to the order, invoice, purchase order or CSV sync that caused it.

## Stock value
Stock value = quantity on hand × unit cost, summed per warehouse, per branch and per business. It appears on your dashboard and in reports.

## Receiving goods
Purchase order → goods received note → inventory updated → supplier bill → payment. Quantities received can be less than ordered, and rejected quantities never enter stock.

## Stocktaking
Start a **stock count**, enter counted quantities, and the variance is calculated per line. Posting the count writes adjustment movements with the reason recorded.

## Low stock
Set a reorder point per product or per warehouse. When stock reaches it, owners are notified once a day per product.',
 'inventory', array['inventory','warehouse','stock','transfer','count'], '📦', 'seller', 6),

('staff-and-permissions','Staff, roles and permissions',
 'Invite employees and give each role exactly the access it needs.',
 '# Staff & permissions

**My Business → Staff → Invite.** Invite by email or phone.

## Roles
Owner · Administrator · Manager · Salesperson · Cashier · Accountant · Inventory Manager · Warehouse Manager.

## Granular by design
Permissions are individual strings (`invoices.create`, `expenses.read`, `inventory.adjust`, `payments.refund` …). A role is simply a set of them, and you can add or remove individual permissions for one person without changing the role.

The classic example:

> A **Cashier** can create receipts but cannot see company expenses.

That rule is enforced by Row Level Security in the database — a cashier reading `/expenses` receives zero rows, not an interface error.

## Approvals
Refunds, purchase orders and high-value expenses can require owner approval. The AI assistant follows the same rule: anything financial, destructive or outward-facing waits for an explicit approval.',
 'account', array['staff','roles','permissions','security'], '👥', 'business', 7),

('security','Security and protecting your business data',
 'Two-factor authentication, sessions, audit logs, verification and data export.',
 '# Security

## Your account
- **Email verification** and **phone verification**
- **Two-factor authentication** with backup codes
- **Login history** — every sign-in with time, device, IP and location
- **Session management** — see and revoke active sessions

## Your business
- **Row Level Security** on every table: the database refuses any read or write the caller is not entitled to, so a leaked link or a modified request cannot expose another business''s data
- **Role-based permissions** per member, with per-person overrides
- **Audit log** — *John changed product price*, *Mary created invoice INV-00052*, *Peter edited inventory*, *Admin approved seller*
- **Verification** with document upload and Seedwel review
- **Data export** — take your products, customers, invoices and stock with you at any time
- **Account deletion** on request

## Approvals that matter
Financial actions, refunds, deleting data, changing prices and sending sensitive documents require the business owner''s explicit approval — including when they are proposed by AI or by an automation rule.',
 'security', array['security','2fa','audit','rls','privacy'], '🛡️', 'all', 8),

('ai-assistant','Ask Seedwel AI',
 'Ask questions about your own business data and let the AI prepare documents for your approval.',
 '# Ask Seedwel AI

The assistant lives inside your dashboard and reads **your** business data — nothing else.

## Ask questions
- *"What were my sales yesterday?"*
- *"Which products are selling fastest?"*
- *"Which products are low in stock?"*
- *"Show me customers who haven''t purchased in 90 days."*
- *"Which invoices are overdue?"*
- *"Summarize my business this month."*

## Ask it to do things
- *"Create a quotation for this customer."*
- *"Write an advertisement for this product."*
- *"Create a product description."*
- *"I sold 20 chairs to ABC Company at K500 each. Create everything needed."*

The last one prepares an order, an invoice, the inventory adjustment, a payment request and — once paid — the receipt.

## Approval first
Proposed changes appear in the **AI action queue** with their impact level:

| Impact | Examples | Approval |
|---|---|---|
| Low | generate description, summarise, draft | runs immediately |
| Medium | create quotation, create order, adjust stock | queued for review |
| High | send an invoice, publish a product, create a payment link | owner approval |
| Financial | refund, change price, credit note, make payment | owner approval, always |
| Destructive | delete a record | owner approval, never fully automatic |

You can deliberately enable automation per rule — but the default is that Seedwel AI proposes and you dispose.',
 'ai', array['ai','assistant','automation','insights'], '🤖', 'seller', 9),

('marketing-content','Marketing centre & social content generator',
 'Coupons, flash sales, featured products and ready-to-post content for Facebook, WhatsApp, Instagram and TikTok.',
 '# Marketing

## Promotions
Create **coupons** (percentage, fixed amount or free delivery, with minimum spend, usage limits and date ranges), **flash sales**, **bundle deals** and **featured products** that appear at the top of your store and in the marketplace.

## Content generator
Pick a product and Seedwel AI writes:
- a **Facebook post**
- a **WhatsApp advertisement**
- an **Instagram caption** with hashtags
- a **TikTok script**
- a **promotional headline**
- an improved **product description**
- an **email campaign**

Every result can be copied, edited and shared. Nothing is posted anywhere without you pressing send.

## Campaigns
Group coupons, products and an audience into a campaign (all customers, top customers, dormant for 90 days, wholesale buyers, a city) and track sent, opened, clicked, converted and revenue attributed.',
 'selling', array['marketing','coupons','social','campaigns','ai'], '📣', 'seller', 10),

('getting-paid','Payments, mobile money and payment links',
 'Record cash, mobile money, bank transfers and card payments, and request money with a link.',
 '# Getting paid

## Record any method
Cash · Bank transfer · Card · Mobile money (Airtel, MTN, Zamtel) · Online · Cheque · Credit (sold on account) · Other.

When you record a payment Seedwel Hub updates the invoice, marks the order paid, writes the customer ledger entry and generates the receipt — one action, four records consistent.

## Payment links
**+ Create → Payment request.** Enter the amount (or attach an existing invoice), choose the allowed methods, and get a short link: `/pay/ab3f9c`. Send it by WhatsApp, SMS, email, Facebook or put it on your website. The customer taps **Pay Now**, and the invoice updates and the receipt generates itself.

## Split and partial payments
Record several payments against one invoice. Statuses move from **Partially paid** to **Paid** automatically, and the balance is always the invoice total minus payments minus credits.

## Provider integration
Payment links are provider-agnostic: the `provider` and `provider_reference` fields hold whichever gateway you connect in Phase 7, so your books do not change when the processor does.',
 'invoicing', array['payments','mobile money','payment link','cash'], '💳', 'seller', 11),

('business-verification','Business verification',
 'How verification works and what the badges mean.',
 '# Business verification

## The workflow
**Unverified → Verification submitted → Under review → Verified**

Submit your documents under **Settings → Verification**: registration certificate (PACRA or equivalent), tax registration (TPIN), a national ID, or a utility bill for the business address.

A Seedwel Hub reviewer checks them. You get a notification when the status changes, and if something is rejected you are told exactly why and can resubmit.

## Badges
| Badge | Meaning |
|---|---|
| ✓ **Verified** | Registration documents reviewed and approved by Seedwel Hub |
| ✓ **Trusted Seller** | Consistent order fulfilment, low dispute rate, good reviews |
| ✓ **Premium Business** | Active paid subscription |
| ✓ **Established Business** | Trading on the platform for an extended period with sustained activity |

Badges are granted by the platform, never self-assigned, and they improve your position in search and your buyers'' confidence.',
 'account', array['verification','badges','trust'], '🔐', 'seller', 12)
on conflict (slug) do update set
  title = excluded.title, summary = excluded.summary, body = excluded.body,
  section = excluded.section, tags = excluded.tags, icon = excluded.icon,
  audience = excluded.audience, sort_order = excluded.sort_order;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. SEEDWEL BUSINESS ACADEMY
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.academy_courses (slug, title, description, level, category, duration_minutes, lessons, sort_order) values
('start-a-business','How to start a business',
 'From idea to registered, trading business — practical steps for the Zambian and regional market.',
 'beginner','business_basics',95,
 '[{"title":"Find a problem worth solving","body":"A business is a repeatable way to solve a problem someone will pay for. Write down the problem, who has it, how often, and what they pay today. Test with ten conversations before you spend money."},
   {"title":"Choose your structure","body":"Sole proprietorship, partnership or limited company. Registration, tax registration (TPIN), licences, and when a company structure protects you."},
   {"title":"Price for profit, not for volume","body":"Cost price, operating cost per unit, margin, and the difference between cash flow and profit. Why selling at cost is the most common way to grow broke."},
   {"title":"Set up your records on day one","body":"Separate money from the business money. Record every sale, every expense, every supplier. Seedwel Hub does this for you if you use it from the first transaction."},
   {"title":"Your first ten customers","body":"WhatsApp status, church and community groups, market stalls, referrals. Ask for the sale, then ask for the review."}]'::jsonb, 1),

('sell-online','How to sell online',
 'Publish a store that converts: photos, descriptions, pricing, delivery and payment.',
 'beginner','selling',70,
 '[{"title":"Photos that sell","body":"Daylight, plain background, the whole product, then the detail, then the product in use. Five photos beats twenty blurry ones."},
   {"title":"Descriptions buyers actually read","body":"What it is, who it is for, what it solves, the specifications, what is in the box, delivery and warranty. Answer the objection before they ask."},
   {"title":"Pricing for a marketplace","body":"Compare like-for-like, position against the cheapest and the best, and use compare-at price honestly."},
   {"title":"Delivery and pickup","body":"Set a delivery fee, a free-delivery threshold, a collection point, and realistic delivery days. Most abandoned carts are delivery surprises."},
   {"title":"Getting paid and being trusted","body":"Mobile money, cash on delivery, payment links, verification badges and reviews."}]'::jsonb, 2),

('manage-inventory','How to manage inventory',
 'Stop losing money in stock you cannot find.',
 'intermediate','operations',80,
 '[{"title":"Know what you have","body":"Count everything once. Enter opening stock. From then on every movement is recorded, not remembered."},
   {"title":"Reorder points","body":"Lead time × average daily sales + safety stock. Set it per product and let the system warn you."},
   {"title":"Fast-moving vs slow-moving","body":"Fast movers need depth; slow movers need discounting or removal. Dead stock is rent you pay to house money you will never see."},
   {"title":"Stocktaking","body":"Cycle counts, variance investigation, and posting adjustments with a reason."},
   {"title":"Multiple locations","body":"Warehouses, shops and branches: transfer stock formally so the books match the shelves."}]'::jsonb, 3),

('invoicing-done-right','How to create invoices that get paid',
 'Professional documents, clear terms, and a follow-up routine.',
 'intermediate','finance',60,
 '[{"title":"What a real invoice contains","body":"Your details, tax number, the customer, invoice number, dates, items, tax, total, terms and payment instructions."},
   {"title":"Quotation first","body":"Quote, get acceptance or a signature, then convert to invoice. No surprises."},
   {"title":"Payment terms that work","body":"Due on receipt, 7 days, 30 days — and what happens when they are late."},
   {"title":"The follow-up routine","body":"Send, remind before due, remind on due, remind after due, then call. Seedwel Hub can automate the reminders while you keep the call."},
   {"title":"Statements and credit notes","body":"Monthly statements for account customers; credit notes for returns and adjustments."}]'::jsonb, 4),

('marketing-that-works','How to market your products',
 'Free and paid marketing that a small business can actually run.',
 'beginner','marketing',75,
 '[{"title":"WhatsApp is a marketing channel","body":"Status, broadcast lists, catalogues, and messages people do not block. Timing and frequency."},
   {"title":"Facebook and Instagram","body":"Marketplace listings, groups, a business page, and one clear call to action per post."},
   {"title":"Writing a post that sells","body":"Hook, benefit, proof, price, call to action. Use the Seedwel content generator, then edit it to sound like you."},
   {"title":"Coupons and flash sales","body":"Scarcity with honesty. Minimum spend to protect margin. Usage limits so it does not leak."},
   {"title":"Featured placement","body":"When paying for featured products or homepage promotion pays for itself, and how to measure it."}]'::jsonb, 5),

('grow-your-business','How to grow a business',
 'From trading to building: systems, staff, credit and expansion.',
 'advanced','growth',90,
 '[{"title":"Read your numbers","body":"Revenue, cost of goods, gross profit, expenses, net profit, receivables, stock value. Five numbers every week."},
   {"title":"Your top customers","body":"The 20% who produce most of the revenue. Serve them better, ask them for referrals, offer them terms."},
   {"title":"Hiring your first employee","body":"What to delegate first (selling, not money), how to set permissions, and how to keep an audit trail."},
   {"title":"Selling on credit safely","body":"Credit limits, terms, statements, and what to do when an invoice goes overdue."},
   {"title":"Opening a second branch","body":"Branches, warehouses, transfers, and running everything from one account."},
   {"title":"Let the AI do the reading","body":"Monthly business reports, insights that explain the charts, and recommendations you approve."}]'::jsonb, 6)
on conflict (slug) do update set
  title = excluded.title, description = excluded.description, level = excluded.level,
  category = excluded.category, duration_minutes = excluded.duration_minutes,
  lessons = excluded.lessons, sort_order = excluded.sort_order;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SYSTEM REPORT DEFINITIONS (available to every business)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.report_templates (
  key          text primary key,
  name         text not null,
  kind         text not null,
  description  text,
  icon         text not null default '📊',
  config       jsonb not null default '{}'::jsonb,
  sort_order   integer not null default 100
);

insert into public.report_templates (key, name, kind, description, icon, config, sort_order) values
  ('sales_summary','Sales summary','sales','Revenue, orders, items and profit for any period.','💰',
   '{"range":"this_month","group_by":"day","metrics":["revenue","orders","items","profit"]}',1),
  ('sales_by_product','Sales by product','sales','Every product sold, quantity, revenue and profit.','📦',
   '{"range":"this_month","group_by":"product","metrics":["quantity","revenue","profit"]}',2),
  ('sales_by_category','Sales by category','sales','Which categories carry the business.','🗂️',
   '{"range":"this_month","group_by":"category","metrics":["quantity","revenue"]}',3),
  ('sales_by_employee','Sales by employee','sales','Performance per salesperson or cashier.','👤',
   '{"range":"this_month","group_by":"served_by","metrics":["orders","revenue"]}',4),
  ('sales_by_location','Sales by location','sales','Branch, shop and warehouse comparison.','📍',
   '{"range":"this_month","group_by":"branch","metrics":["orders","revenue"]}',5),
  ('stock_value','Stock value','inventory','Value of stock per warehouse and in total.','🏷️',
   '{"group_by":"warehouse","metrics":["units","value"]}',10),
  ('stock_movement','Stock movement','inventory','Every movement in a period with reasons and references.','🔄',
   '{"range":"this_month","group_by":"movement_type"}',11),
  ('fast_slow_moving','Fast & slow moving','inventory','What is selling and what is sitting.','🐇',
   '{"range":"last_90_days","group_by":"product"}',12),
  ('low_stock','Low stock report','inventory','Items at or below their reorder point.','⚠️',
   '{"group_by":"product"}',13),
  ('new_customers','New customers','customers','Customers acquired in a period.','🆕',
   '{"range":"this_month"}',20),
  ('returning_customers','Returning customers','customers','Repeat buyers and their frequency.','🔁',
   '{"range":"last_12_months"}',21),
  ('top_customers','Top customers','customers','Ranked by revenue and by order count.','🏆',
   '{"range":"last_12_months","limit":50}',22),
  ('dormant_customers','Dormant customers','customers','No purchase in 60 / 90 / 180 days.','😴',
   '{"days_since_last_order":90}',23),
  ('revenue_expenses','Revenue & expenses','finance','Income against every expense category.','📈',
   '{"range":"this_month","group_by":"month"}',30),
  ('receivables','Accounts receivable','finance','Who owes you, how much, and how late.','📥',
   '{"group_by":"customer","ageing":true}',31),
  ('payables','Accounts payable','finance','Who you owe and when it falls due.','📤',
   '{"group_by":"supplier","ageing":true}',32),
  ('payments_received','Payments received','finance','All payments by method and date.','💳',
   '{"range":"this_month","group_by":"method"}',33),
  ('profit_estimate','Profit estimate','finance','Revenue less cost of goods less expenses.','🧮',
   '{"range":"this_month"}',34),
  ('tax_summary','Tax summary','finance','Tax collected and tax paid, ready for filing.','🧾',
   '{"range":"this_quarter"}',35)
on conflict (key) do update set
  name = excluded.name, kind = excluded.kind, description = excluded.description,
  icon = excluded.icon, config = excluded.config, sort_order = excluded.sort_order;

select public.drop_policies('report_templates');
alter table public.report_templates enable row level security;
create policy "report_templates_read" on public.report_templates for select using (true);
create policy "report_templates_admin" on public.report_templates
  for all using (public.is_admin()) with check (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. DOCUMENT TEMPLATES (platform defaults)
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.document_templates (business_id, doc_type, name, layout, is_default) values
  (null,'invoice','Standard A4 invoice',
   '{"paper":"a4","header":{"show_logo":true,"show_tagline":true,"show_business_details":true},
     "colors":{"primary":"#0f766e","accent":"#f59e0b"},
     "sections":["items","summary","payment_instructions","terms","signature"],
     "footer":{"text":"Thank you for your business.","show_qr":true,"show_page_numbers":true},
     "columns":["description","quantity","unit_price","discount","tax","total"]}'::jsonb, true),
  (null,'invoice','Compact receipt (80mm)',
   '{"paper":"receipt80","header":{"show_logo":false,"show_tagline":false,"show_business_details":true},
     "sections":["items","summary","qr"],
     "footer":{"text":"Goods sold in good faith.","show_qr":true,"show_page_numbers":false},
     "columns":["description","quantity","total"]}'::jsonb, false),
  (null,'quotation','Standard quotation',
   '{"paper":"a4","header":{"show_logo":true,"show_tagline":true},
     "colors":{"primary":"#0f766e","accent":"#f59e0b"},
     "sections":["validity","items","summary","terms","acceptance","signature"],
     "footer":{"text":"This quotation is valid for the period stated above.","show_qr":true}}'::jsonb, true),
  (null,'proforma_invoice','Pro-forma invoice',
   '{"paper":"a4","header":{"show_logo":true},
     "sections":["items","summary","payment_instructions","bank_details"],
     "footer":{"text":"This is not a tax invoice.","show_qr":true}}'::jsonb, true),
  (null,'receipt','Payment receipt',
   '{"paper":"a5","header":{"show_logo":true},
     "sections":["payment_details","summary","qr","signature"],
     "footer":{"text":"Keep this receipt for your records.","show_qr":true}}'::jsonb, true),
  (null,'purchase_order','Purchase order',
   '{"paper":"a4","header":{"show_logo":true},
     "sections":["supplier","items","summary","delivery","terms","signature"],
     "footer":{"show_qr":true}}'::jsonb, true),
  (null,'delivery_note','Delivery note',
   '{"paper":"a4","header":{"show_logo":true},
     "sections":["items","summary","recipient_signature"],
     "footer":{"text":"Received in good order and condition.","show_qr":true}}'::jsonb, true),
  (null,'statement','Statement of account',
   '{"paper":"a4","header":{"show_logo":true},
     "sections":["opening_balance","entries","closing_balance"],
     "columns":["date","reference","description","debit","credit","balance"]}'::jsonb, true),
  (null,'credit_note','Credit note',
   '{"paper":"a4","header":{"show_logo":true},
     "sections":["original_invoice","items","summary"],"footer":{"show_qr":true}}'::jsonb, true),
  (null,'contract','Business contract',
   '{"paper":"a4","header":{"show_logo":true},
     "sections":["parties","terms","signatures"]}'::jsonb, true)
on conflict (business_id, doc_type, name) do update set
  layout = excluded.layout, is_default = excluded.is_default;

select 'seedwel_hub: 0011 seed & storage ok' as status;
