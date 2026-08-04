# Xacheus

Xacheus is an AI-powered business, website, and e-commerce platform created by Zacheus Simbaya to help entrepreneurs and organizations build, launch, manage, and grow online.

## Built in this version

### Public website

- Xacheus branded homepage using the blue/cyan/teal logo direction
- AI Website Builder and AI Store Builder sections
- Solutions, roadmap, pricing, founder, and contact sections
- Contact form connected to Firebase Firestore
- Public pages for About, Features, Pricing, Contact, Solutions, Blog, Help, FAQ, Terms, and Privacy

### Real product flow

- `builder.html` — real AI-style website/store builder flow
- Generates a live website preview from a business idea
- Generates homepage copy, SEO package, WhatsApp sales message, and launch checklist
- Saves generated website plans to the user dashboard in Firebase
- `ai-assistant.html` — generates WhatsApp replies, Facebook posts, Instagram captions, TikTok ideas, email campaigns, product descriptions, business summaries, and SEO blog ideas

### Authentication and dashboards

- `auth.html` — Firebase login/register
- Email/password sign-up
- Google sign-in support when enabled in Firebase
- Email verification after registration
- Forgot-password reset
- `dashboard.html` — user dashboard for saved AI website plans and payment confirmations
- `admin.html` — admin dashboard for payment approvals, lead CRM status updates, and saved website plans

### Payment / admin confirmation

- WhatsApp admin/payment number: +260 973 028 342
- Customers submit payment confirmation from their dashboard
- Admin can approve or reject confirmations
- Dashboard shows premium approval status after admin approval

### Firebase security

- `firestore.rules` included for production setup
- Admin email: zacheussimbaya@gmail.com
- Users can read/write their own data
- Admin can manage leads, payments, and platform data

## Main pages

- `index.html` — public website
- `builder.html` — AI website/store preview generator
- `ai-assistant.html` — AI business and marketing assistant
- `auth.html` — login/register
- `dashboard.html` — user dashboard
- `admin.html` — admin dashboard
- `about.html`, `features.html`, `pricing.html`, `contact.html`, `solutions.html`, `blog.html`, `help.html`, `faq.html`, `terms.html`, `privacy.html`

## Firebase setup required

In Firebase Console for project `xacheus`, enable:

1. Authentication → Sign-in method → Email/Password
2. Optional: Authentication → Google provider
3. Firestore Database
4. Publish the rules from `firestore.rules`

Recommended Firestore collections:

- `users`
- `contact_messages`
- `payment_confirmations`
- `users/{uid}/blueprints`
- `users/{uid}/paymentConfirmations`

## Run locally

```bash
npm run dev
```

Then open <http://localhost:5173>.

No install step is required because this is a static HTML/CSS/JavaScript site served by Python.
