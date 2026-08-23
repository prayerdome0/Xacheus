# Xacheus

Xacheus is an AI-powered business, website, and e-commerce platform created by Zacheus Simbaya to help entrepreneurs and organizations build, launch, manage, and grow online.

## Platform core (current build)

The main product flow is now a real store-builder workspace rather than a landing-page-only demo:

- `auth.html` — Firebase email/password registration, login, Google sign-in, email verification, and password reset.
- `dashboard.html` — authenticated Xacheus store admin with Home, Theme editor, Navigation, Products, Collections, Inventory, Orders, Customers, Marketing, and Settings.
- `dashboard.html?demo=1` — a fully interactive demo workspace for exploring the platform before creating an account.
- `storefront.html` — storefront renderer for previews and published stores, including responsive layout, real product cards, cart, and WhatsApp checkout hand-off.
- `store-builder.css` and `storefront.css` — responsive admin and storefront interfaces.

### Theme editor capabilities

The theme editor stores a structured page model and renders the same model into the preview and storefront:

- Add, remove, edit, enable/disable, and reorder sections.
- Banner editor with heading, description, image upload or URL, button text/link, and layout.
- Product grid, image-with-text, testimonials, newsletter, announcement bar, and footer sections.
- Theme settings for store name, colors, font, spacing, and announcement message.
- Desktop/mobile preview switcher.
- Save changes locally immediately and sync them to Firestore when signed in.
- Publish a copy to `publicStores/{slug}` for the public storefront renderer.

### Store management

- Products with title, AI-assisted description drafting, multi-image Cloudinary uploads, price, compare-at price, inventory, SKU, category, and variants.
- Collections/categories with names and descriptions.
- Editable navigation labels and links.
- Orders, customers, inventory, marketing, payment-provider settings, and custom-domain setup surfaces.
- Export orders and customers as JSON.
- Manual payments admin page for WhatsApp checkout setup, including store WhatsApp number, customer instructions, delivery fees, free-delivery threshold, and a preview link.
- Cart and WhatsApp checkout hand-off on the storefront using the store owner's configured WhatsApp number.
- Storefront search, category filters, sorting, product detail modal, image gallery, related products, multiple-image product indicators, variant selection, and a manual checkout form that captures customer name, phone, delivery location, and notes before WhatsApp hand-off.
- Public checkout orders can be saved under `publicStores/{storeSlug}/orders` for store-owner/admin review when Firestore rules are deployed.
- Orders dashboard supports details, payment/fulfillment status updates, WhatsApp customer replies, printable receipts, local checkout imports, and real dashboard metrics.
- Customers dashboard derives customer profiles from checkout/order history with WhatsApp follow-up actions.
- Publishing controls include published/draft state, copy public store link, unpublish, custom domain notes, and delivery settings.

### Cloudinary store image uploads

Store product and banner image uploads use a browser-safe unsigned Cloudinary preset:

- Cloud name: `dhad95cch`
- Upload preset: `website_store`
- Asset folder configured in Cloudinary: `samples/ecommerce`

Only the unsigned preset name and cloud name are included in client code (`cloudinary.js`). Do not expose `CLOUDINARY_URL`, API keys, or API secrets in the browser.

This is the platform foundation: the structured store data is the source of truth, the theme editor changes that data, and the storefront renderer reads it. Payment providers, domain provisioning, and server-side order processing should be connected to the existing settings surfaces as their production credentials and backend endpoints become available.

## Existing product tools

- `ai-studio.html` — **Xacheus AI Studio**: one unified multimodal workspace on `gen.pollinations.ai` (OpenAI-compatible). Text chat with streaming, image generation, video generation (with image-to-video reference frames via `media.pollinations.ai` uploads), text-to-speech/music and speech-to-text, realtime voice conversations over the OpenAI Realtime WebSocket protocol (PCM16 + echo-safe `<audio>` playback), and embeddings with a cosine-similarity matrix — plus a live model catalog browser. The Pollinations API key is entered in the UI and stored per-browser in localStorage (`xacheus_pollinations_key`); it is never committed to the repo.
- `builder.html` — AI-style website/store brief generator with free Pollinations AI, preview, copy, SEO, launch checklist, export, and Firebase save.
- `ai-assistant.html` — business and marketing assistant.
- `admin.html` — admin dashboard for manual store orders, payment confirmations, leads, and older saved website plans.
- Public pages for About, Features, Pricing, Contact, Solutions, Blog, Help, FAQ, Terms, and Privacy.

### Pollinations unified API

`ai-config.js` now targets the unified `https://gen.pollinations.ai` gateway for text and images whenever a key is saved (OpenAI-compatible `POST /v1/chat/completions`, `GET /image/{prompt}`), falling back to the legacy keyless Pollinations endpoints when no key is present. Get a key at [enter.pollinations.ai/keys](https://enter.pollinations.ai/keys). Keep secret `sk_` keys out of client-side bundles in production — for public apps use Connect User Wallets (BYOP).

## Firebase setup required

In Firebase Console for project `xacheus`, enable:

1. Authentication → Sign-in method → Email/Password
2. Optional: Authentication → Google provider
3. Firestore Database
4. Publish `firestore.rules`

Important collections and paths:

- `users/{uid}`
- `users/{uid}/store/main` — structured store, theme, catalog, navigation, order, and customer state
- `users/{uid}/blueprints`
- `users/{uid}/paymentConfirmations`
- `publicStores/{storeSlug}` — published storefront copy
- `publicStores/{storeSlug}/orders/{orderId}` — public manual WhatsApp checkout orders for store-owner/admin review
- `contact_messages`
- `payment_confirmations`
- collection group `orders` — admin can review manual WhatsApp checkout orders across stores

The admin email remains `zacheussimbaya@gmail.com`. Firebase client configuration is in `firebase.js`; do not put server secrets in the browser.

### Store image uploads

Store product and banner images upload directly from the browser to Cloudinary using the unsigned `website_store` preset on cloud `dhad95cch`. The preset owns the `samples/ecommerce` asset folder, so no Cloudinary API secret is exposed in the app. Public upload settings live in `cloudinary.js`; keep the preset unsigned only for the intended image formats and size limits.

## Run locally

```bash
npm run dev
```

Then open <http://localhost:5173>. To preview the builder without signing in, use <http://localhost:5173/dashboard.html?demo=1>.

No install step is required because this is a static HTML/CSS/JavaScript site served by Python.
