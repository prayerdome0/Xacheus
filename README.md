# Xacheus — a social platform for video, photos, music, messaging and people

Xacheus is a **working social app**, not a mockup: one account, one database, one
set of security rules, and no demo data anywhere. If a feature is on screen it
writes to Firestore or Firebase Storage and comes back after a refresh, a
re-login, or on another device. Anything that is *not* built is labelled as not
built (see [Not implemented](#not-implemented)) instead of being faked.

Stack: vanilla ES modules (no build step), Firebase Auth + Firestore + Storage
(v10.12.5 CDN modules), a hash router, and the Internet Archive's open-licence
audio catalog for music.

---

## What is real today

### Accounts and profiles
- Email/password and Google sign-in; `users/{uid}` profile documents created by
  `ensureProfile`, handle reservations in `usernames/{handle}` (3–20 chars,
  lowercase, unique), roles `user · creator · business · church · admin`.
- Profile page (`#/u/{handle}`, `#/profile`): cover photo, avatar, display name,
  bio, links, location, role badge, verification mark, follower/following/post
  counts (all computed from real documents), join date, profile-view count.
- Tabs: **Posts · Photos · Videos · Reposts · Music · Activity · Saved · Liked ·
  Followers · Following · About**. Deep-linkable: `#/u/you?tab=photos`,
  `#/u/you?media={profileMediaId}` opens the viewer straight onto that item.
- **Avatar and cover are interactive**: tap either to open the full-screen media
  viewer, where you can react, comment, reply to a comment, like a comment,
  share, copy the link, see view/like/comment counts, and delete your own
  comments. Uploading a new picture writes a real `profileMedia` document, so a
  profile keeps a picture *history* rather than one floating URL. If a profile's
  current avatar/cover has no gallery entry yet, the viewer says so plainly and
  offers to add it — it never invents a document.
- Editing your own profile: display name, bio, links, avatar, cover, handle
  change (propagates to every denormalised copy), private-account switch.
- Private accounts: content is locked to approved followers (enforced in
  `firestore.rules`, not just hidden in the UI) and follows become requests that
  the owner accepts or declines.

### Posts
- One `videos` collection for everything: vertical video, camera recordings,
  photo sets (up to 6) and **text posts** — `mediaType` distinguishes them.
- Your own post has a ⋯ menu: **edit the caption** (hashtags and mentions are
  re-derived from it) or **delete the post** (the Storage object goes with it).
- Reactions (like + the six-reaction set), comments with replies, per-comment
  likes, own-comment deletion, save to collections, reposts, share (link copy,
  DM, other surfaces), hashtag and mention extraction with real `#tag` routes,
  view counts that only tick after 2 s of actual playback.
- Story posts (24 h, `stories/{id}`) with a tray on the home feed, per-story
  progress bars, tap-to-navigate, hold-to-pause, reactions, viewer list, reply
  (which sends a real direct message), and delete.

### Messaging
- `conversations/{cid}` + `conversations/{cid}/messages/{id}`: 1:1 threads,
  optimistic-free (every bubble is a Firestore read), realtime via `onSnapshot`.
- Read receipts (per-message `readBy` + per-thread unread counters), typing
  indicator (a real timestamped field both clients write), presence
  (`presence/{uid}`, 45 s heartbeat, "Active now" / "Active 12 min ago"),
  attachments (photo, video, audio, generic file ≤ 30 MB via resumable uploads),
  image expansion in the media viewer, audio/video through the global player,
  tapback reactions, unsend (tombstone + file delete), hide/restore a thread,
  report the thread or a single message, block from the thread, and a search box
  that filters the loaded window of the conversation.
- The Message button on a profile respects `privacy.whoCanMessage`
  (`everyone / people I follow back / nobody`) and blocking, and the same checks
  are enforced server-side.

### Music (real, licensed)
- `sounds/{id}` holds members' uploads and catalogue imports. Play counts,
  favourite counts and "uses in posts" come from Firestore — nothing is
  hardcoded.
- `#/music` (alias `#/sounds`) has **Library · Discover · Your uploads ·
  Favourites · Recently played**. Discover searches the Internet Archive's
  open-licence music (netlabels / audio_music) live: releases, real track
  lists, artwork from `archive.org/services/img/{identifier}`, playback from
  `archive.org/download/{identifier}/{file}`.
- Every catalogue row shows its **licence** (CC0 / Public Domain / CC BY /
  CC BY-SA / BY-NC / BY-ND …) and links to both the licence deed and the
  original item. Only licences that permit reuse can be attached to a post;
  NC/ND items are listen-and-credit only and the UI says "Listen only".
- Importing writes a `sounds` document with `external: true`, the source
  identifier, `licenceUrl`, and the real artist credit, and that credit is
  rendered again on the post's sound line and in the player's licence row.
- Global player (`js/player.js`): persistent dock with play/pause, previous,
  next, seek bar, volume, mute, shuffle, repeat, queue panel, Media Session
  (lock-screen controls), keyboard shortcuts, restore-on-reload, and a play
  counted only after 20 s of listening.

### Discovery, notifications, moderation
- Global search (people, post captions, hashtags, sounds) with **recent
  searches**, trending hashtags, suggested creators, tag pages, notifications
  grouped by category with unread badges and a **per-item read/unread toggle**,
  per-category mute in Settings, reporting for posts, profiles, comments, media,
  sounds and conversations, **muting** (hides someone's posts and notifications
  without unfollowing), plus an admin panel for reports/bans and the moderation
  trail.
- Feed quality-of-life: a **new-posts pill** so a live update never moves the
  post you're reading, **pull-to-refresh** on touch, and **infinite scroll**
  with the "load more" button kept as the fallback.

---

## How the pieces fit

```
index.html            boot shell + watchdog
js/app.js             router, session, badges, presence heartbeat, player mount
js/firebase.js        config (public keys only), long polling, memory-local cache
js/data.js            Firestore layer: users, videos, comments, sounds, DMs, follows
js/social.js          reactions, prefs, privacy gates, blocks, profile media,
                      stories, presence, follow requests, reposts, activity
js/music.js           Internet Archive client (search, item tracks, licences)
js/player.js          the one <audio> element everything shares
js/storage.js         Storage uploads (image/video/audio/story/chat) + metadata
js/brand.js           logo plate: measures the artwork, decides light or dark plate
tools/build-brand.py  regenerates the brand PNGs + the social card from the artwork
tools/check-brand.mjs structural guard for every logo slot (see below)
js/views/*.js         home, profile, mediaViewer, stories, messages, sounds,
                      create, discover, notifications, settings, admin, live,
                      components (shared cards, modals, pickers)
docs/PRODUCT_SPEC.md    the spec: IA, database, page-by-page status, roadmap
docs/CORE_FLOWS_AUDIT.md  the ten core flows, traced to the write
firestore.rules       every collection + subcollection the client touches
storage.rules         owner-scoped writes, public reads, size/type limits
firestore.indexes.json 31 composite indexes matching the queries above
```

Naming note: `videos` is the *posts* collection (it predates photo posts) and
`profileMedia` is the per-profile photo/video gallery. Both are intentional.

---

## Logo visibility (the brand plate)

The rule the app follows: **the logo never sits on a background that swallows
it.** Dark ink (black, or a deep green) gets a light plate; light ink (white)
gets a dark plate. That is contrast, not theme — the logo looks the same in dark
mode and light mode, because the surface behind the logo is its own plate.

This is decided by measurement, not by a hardcoded colour per page:

1. `js/brand.js` loads the artwork (`assets/logo.png`), samples it on a canvas,
   separates ink from background (the artwork's own border defines the matte),
   and computes the ink's WCAG relative luminance.
2. `inkLum < 0.55` → **light plate** (`#ffffff`), otherwise → **dark plate**
   (`#05060a`). One threshold is what makes both "black logo on white" and
   "white logo on black" fall out of the same rule. One guard sits on top of it:
   if the ruled plate would leave a mid-tone logo below 3:1 (WCAG's floor for a
   graphic), the more legible plate is used instead — the rule exists to make the
   logo visible, not to honour a swatch. Measured today: **16.77:1** (navy ink on white)
   and **17.15:1** (the light build on near-black) — the wrong pairings sit at
   ~1.2:1, i.e. invisible.
3. `tools/build-brand.py` writes that same decision to `assets/brand-manifest.json`,
   and `initBrand()` reads it first — so the normal path needs no canvas at all,
   and it cannot be pinned to an old bitmap (the file is `.json`, which `sw.js`
   serves network-first, as it does for the logo artwork itself). Measuring the
   image is the fallback for anything the build does not know about.
4. The result is cached in `localStorage` under `xacheus.brand.plate.v1` (keyed
   by file + pixel size, so replacing the artwork re-measures) and applied to
   `<html data-logo-plate>` by a tiny inline script *before first paint*, so the
   logo never flashes onto the wrong background. The same cache also sets
   `--logo-accent`, which Safari's tab icon and the plate's focus ring use.

Every place the logo appears goes through one builder, so the rule can't be
applied in one screen and forgotten in another:

| slot | where | helper |
| --- | --- | --- |
| boot screen + boot-failure screen | `index.html` | `.logo-plate` markup with both inks |
| top bar wordmark, sidebar mark, account-menu row | `js/app.js` | `brandSlotHtml()` |
| auth hero | `js/auth.js` | `brandSlotHtml({ size: "xl" })` |
| profile cover corner | `js/views/profile.js` | `brandSlotHtml()` + `.logo-plate--watermark` |
| share-preview card | `js/views/components.js` | `brandSlotHtml()` |
| settings footer | `js/views/settings.js` | `brandSlotHtml()` |
| PWA icons, favicons, social card | `manifest.json`, `index.html`, `assets/` | already ink-on-plate by build |

`brandSlotHtml()` emits **both** ink variants inside the plate and lets CSS pick
(`.logo-ink--light` is shown only under `html[data-logo-plate="dark"]`), which
is why there is no "wait for the measurement" gap in any slot.

The assets are derived, not hand-painted — `assets/logo.png` / `assets/logo1.png`
ship as ink over a translucent noise wash, so `tools/build-brand.py` strips that
wash, trims, snaps the ink to the brand colours, and writes:

- `assets/logo-wordmark.png` — navy ink for the light plate
- `assets/logo-wordmark-dark.png` — light ink for the dark plate
- `assets/brand-card.png` — 1200×630 link-preview card, plate baked in (a social
  preview can't run CSS, so it gets the decision as pixels)

```bash
python3 tools/build-brand.py --check   # measure only: fails if any logo is below AA on its own plate
python3 tools/build-brand.py           # regenerate the three files above
node tools/check-brand.mjs             # no bare logo tags, both inks shipped, plate classes styled, SW cache complete
node tools/plate-rule.test.mjs         # the rule itself, on synthetic ink/background pairs
```

New logo file? Drop it in `assets/`, point `BRAND_SOURCE` (and `SOURCES` in the
tool) at it, run `python3 tools/build-brand.py`, and reload — the build writes
both ink variants and the plate decision, and nothing else is hardcoded. In a
console, `XacheusBrand.report()` shows what was decided and where it came from
(`origin: "manifest"` or `"measured"`), and `XacheusBrand.use("assets/new.png")`
measures an untracked file on the spot.

---

## Run it

```bash
npm run dev       # python3 -m http.server 5173 --bind 0.0.0.0
# open http://localhost:5173/#/home
```

There is no build step, so a plain static server is enough. Firebase config lives
in `js/firebase.js` (public web config — the security rules are what protect it).

## Deploy the backend

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage,hosting
```

Rules and indexes **must** be deployed: the app degrades to
"permission denied" toasts when they are missing, and several list queries need
the composite indexes in `firestore.indexes.json`.

## Making someone an admin

Set `users/{uid}.role = "admin"` in the Firestore console once (only an existing
admin can do it through the app). The admin panel then appears at `#/admin`.

---

## Not implemented

Stated so it is not mistaken for a bug or, worse, for working behaviour:

- **Audio/video calls** inside a conversation (text + files only).
- Group conversations (1:1 threads only).
- Per-thread mute and push-notification delivery (web push is not wired;
  in-app badges and the notification feed are).
- Full-text search over messages or the whole post corpus — message search filters
  the loaded window, and post search matches handles/captions/hashtags in
  Firestore fields.
- Language/region settings, data export, two-factor sign-in, digest email
  preferences (Settings says this on-screen).
- Live streaming is a broadcast/chat prototype: no real media server, so the
  "stream" is presence + chat + gifts, not a video transport.
- Video *filters/effects* editor, and trimming (the composer records, uploads and
  posts; it does not edit).
- Algorithmic ranking: "For You" is recency + like-count ordering, not a model.

---

## Roadmap

- **Phase 1** — auth, profiles + roles, vertical video, Storage, likes/comments/
  follows/notifications, create, sounds.
- **Phase 2 (this pass)** — full profiles with media galleries and stories,
  Messenger-grade DMs, licensed music with a real player, privacy controls,
  blocking/reporting, reactions/reposts/saved collections, activity feed,
  hardened rules and indexes.
- **Phase 3** — Xacheus Pages (churches, businesses, organisations,
  communities, public figures) + verification requests.
- **Phase 4** — Xacheus Marketplace (listings, inquiries, business reviews).
- **Phase 5** — creator analytics, server-side fan-out, rate limiting, push.

All three are specified — schemas, routes and acceptance — in
`docs/PRODUCT_SPEC.md §6`, before a line of UI is written.

Built in Zambia 🌍
