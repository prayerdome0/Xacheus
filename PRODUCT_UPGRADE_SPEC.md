# Xacheus — Product Upgrade Specification

> Upgrade the existing Xacheus HTML into a production-style social media web
> application. Preserve the existing Xacheus design and structure, but convert
> static/demo interactions into real working functionality. Connect the
> application to Firebase Authentication, Firestore and Firebase Storage.

This document is the acceptance spec: what was rebuilt, how each requirement is
met, and how to deploy it. The application is a **real** short-vertical-video
social network, not a mockup — every button performs a real write/read or shows
an honest empty state.

---

## 1. Branding — image assets only

**Requirement:** Remove all text-based logo/wordmark branding; use only
`logo1.png` and `logo.png` as branding image assets. Preserve the Xacheus look.

**Done:**
- Topbar brand is now the `logo1.png` wordmark image (the HTML `<span
  class="brand-text">Xacheus</span>` text was removed).
- Boot screen, sidebar, and account screens use `logo.png` (square mark).
- The `content: url(...)` SVG override in `.brand-logo` was removed so the
  element renders its real `src`.
- Social preview (`og:image` / `twitter:image`) now points at `logo1.png`.
- Old text-wordmark PNGs (`logo-wordmark*.png`) deleted; nothing references them.
- Optimized web copies added: `assets/logo.png` (320×320), `assets/logo1.png` (768×284).

---

## 2. Accounts (Firebase Authentication)

**Already real, kept:** email/password + Google sign-in, profile auto-creation in
`users/{uid}`, unique handle reservation via `usernames/{handle}`, roles
(`user`, `creator`, `business`, `church`, `admin`), edit profile (display name,
handle, bio, location, website), avatar/cover upload, settings, sign out, delete
account with re-auth, email verification.

---

## 3. Media — Firebase Storage (was Cloudinary)

**Requirement:** Uploads actually work (upload images/videos/photos, profile
photo, validation, progress, preview, delete/edit).

**Done:** New `js/storage.js` uploads all media to **Firebase Storage** under
`uploads/{uid}/{kind}/{file}`:
- `uploadImage(file, { strict })` → URL (throws when strict; default true)
- `uploadVideo(file, { onProgress, noThumbnail })` → `{ url, path, duration,
  width, height, thumbnailUrl }`
- `uploadAudio(file, { onProgress })` → `{ url, path, duration }`
- `removeObject(path)` → storage cleanup on delete

Call sites migrated: create video/record (`#/create`), photo posts (1–6 images),
profile avatar/cover, sound uploads, live segments + live poster. `uploadVideo`
now generates a real client-side poster frame (uploaded to
`uploads/{uid}/thumbnails`) so video cards always show a thumbnail. Client-side
type/size guards block bad uploads before they hit the network. Failed uploads
never persist a `blob:` URL. `js/cloudinary.js` was removed; the
`cloudinaryPublicId` field is now `storagePath`.

---

## 4. Social feed, short videos, engagement

**Already real, kept:** vertical `For You` / `Following` feed on
`videos/{id}`, auto-play via IntersectionObserver, real like/save/comment/share
with counter updates, follow/unfollow, `viewCount`/`shareCount`, hashtags &
mentions, photo-post carousels, comment modal. No mock data — honest empty
states everywhere.

---

## 5. Live (Go Live) + Sounds + Discover + Messages

**Already real, kept:** live streaming (camera → segmented Firebase Storage
uploads → Firestore cursor, ~5–15s latency, live chat, gifts, stickers,
reactions, replay), free royal‍ty-free sounds library + original uploads,
Discover (trending videos/sounds/creators/hashtags, search), and 1:1 direct
messages with live Firestore snapshots and per-participant unread counts.

---

## 6. Reporting + Admin moderation (NEW)

**Requirement:** Admin interface for users, posts, videos, reports, comments,
banned accounts, verification, platform statistics; content/report moderation.

**Done:**
- **Report** action on every video card, profile and sound detail; writes to
  `reports/{id}` via `submitReport` (one open report per user per target, reason
  list + optional details). Covers video, user, comment, sound, live.
- **Admin panel** (`#/admin`, visible only when `role == "admin"`):
  - **Users** — change role, verify/unverify, **ban/unban** accounts
  - **Videos** — delete any video
  - **Comments** — collection-group list of comments across all videos, delete any
  - **Reports** — review open reports, link to the target, resolve/reopen, delete
  - **Sounds** — delete any sound
  - **Stats** — platform counts (users, videos, comments, sounds, lives,
    notifications, open reports, banned accounts)

---

## 7. Security (production rules)

**Requirement:** Auth-based rules, user ownership, admin permissions, upload
restrictions, rate-limiting-adjacent guards, content/moderation. No test/open
rules.

**Done:**
- `firestore.rules` rewritten: public read for browse; writes owner-scoped;
  `role`/`verified`/`banned` admin-only; counters ±1 only; messages immutable;
  **banned accounts cannot post, comment, follow, notify, go live or report**
  (via `canWrite`/`isBanned` helpers, null-safe for brand-new users); `reports`
  collection is create-by-user, admin-read/resolvable.
- `storage.rules` (new, production): public read of media, owner-scoped writes
  matched to the uploader's uid in the path, content-type + size limits, owner
  deletes, everything else denied.
- `firebase.json` now targets `storage` and `firebase deploy` deploys
  `firestore:rules, firestore:indexes, storage, hosting` together.

---

## 8. Mobile-first & responsive

**Already real, kept + reinforced:** bottom tab bar, full-screen vertical video,
touch-friendly buttons, responsive profile pages, mobile upload UI, desktop
column layout. The new report/flag UI and admin stats are responsive.

---

## Data model additions

```
videos/{id}
  + storagePath                     (replaces cloudinaryPublicId)
sounds/{id}
  + storagePath
reports/{id}
  reporterUid, reporterName, reporterUsername
  targetType (video|user|comment|sound|live), targetId, targetOwnerUid
  reason, details, status (open|resolved), resolvedBy, resolvedAt, createdAt
```

---

## Run & deploy

```bash
npm run dev                         # http://0.0.0.0:5173

firebase use xacheus-7c98b
firebase deploy --only firestore:rules,firestore:indexes,storage,hosting
```

> Enable **Firebase Storage** in the Firebase console before first deploy. To
> make a user admin, set `users/{uid}.role = "admin"` directly in the console
> (rules require an existing admin to change roles, so the first admin is set
> manually).

---

## Map of requirement → implementation

| Area | Where |
| --- | --- |
| Accounts (auth, Google, profiles, settings, logout) | `js/auth.js`, `js/firebase.js`, `js/views/profile.js`, `js/views/settings.js` |
| Social feed, likes, comments, follows, shares, saves | `js/data.js`, `js/views/components.js`, `js/views/home.js` |
| Short-video feed, autoplay, view counts, creator profile | `js/views/home.js`, `js/views/profile.js` |
| Messaging (DMs, unread, search) | `js/data.js`, `js/views/messages.js` |
| Notifications (likes/comments/follows/mentions/gifts) | `js/data.js`, `js/views/notifications.js` |
| Search & discovery | `js/views/discover.js`, `js/data.js` |
| Professional profiles, follow counts, verification, public/private | `js/views/profile.js`, `js/data.js` |
| Upload system (image/video/photo/progress/preview/delete) | `js/storage.js`, `js/views/create.js`, `js/views/profile.js`, `js/views/sounds.js` |
| Backend (Auth / Firestore / Storage / notifications) | `js/firebase.js`, `js/data.js`, `js/storage.js`, `firestore.rules`, `storage.rules` |
| Admin panel (users/videos/comments/reports/sounds/stats/bans) | `js/views/admin.js` |
| Security rules | `firestore.rules`, `storage.rules` |
| Mobile-first | `styles.css` |
| Branding via logo.png / logo1.png only | `index.html`, `js/app.js`, `js/auth.js`, `styles.css`, `manifest.json` |
