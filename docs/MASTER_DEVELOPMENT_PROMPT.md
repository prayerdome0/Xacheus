# XACHEUS CONNECT — MASTER DEVELOPMENT PROMPT

> This is the single, self-contained instruction document for building Xacheus
> Connect. It contains: the product truth, the engineering contract, the iron
> rules (real vs. faked), what is **already built**, the screen map (how every
> screen connects), the full Firebase data model, per-feature specifications
> (screens, buttons, data, rules, acceptance tests), the build order, and the
> definition of done.
>
> Give this one document to the developer (human or AI). Do not split it. Do not
> "improve" the baseline — read §4 first.

---

## 0. How to work this prompt

1. **One phase at a time, in the order in §10.** Do not start Phase 2 work while
   Phase 1 has failing acceptance tests.
2. **One feature at a time within a phase.** Each feature is a small, shippable
   unit: screen(s) + data layer + rules + indexes + wiring + tests.
3. **After every feature:** run the Definition of Done checklist (§11), append an
   entry to `CHANGES.md`, update `README.md` (What is real today / Not
   implemented), bump the `sw.js` cache version, and commit.
4. **When the plan and this document disagree, this document wins** — it is the
   plan reconciled against the codebase. When the codebase and this document
   disagree about *what exists*, the codebase wins: read the code, then correct
   your mental model, then build.
5. Never delete, rewrite, or "modernise" existing modules. Extend them.

---

## 1. Product truth

**Xacheus = People + Circles + Creators + Businesses + Marketplace.**
Tagline: **"Create. Watch. Connect."**

- Xacheus is **not** "another Facebook". Facebook-style social networking is the
  *foundation*; the differentiators are **Circles** (identity: churches, schools,
  communities, neighbourhoods, professional and interest groups), **Xacheus
  Play** (the vertical video engine), and the **direct connection between people
  and local businesses** (profiles + marketplace).
- Zambia first, global later. Default currency in the marketplace is **ZMW**.
  Phone numbers, locations and city names are self-reported user data.
- Every feature must survive: a refresh, a re-login, and a second device.
  Anything that does not is not done.

---

## 2. Engineering contract (hard constraints of this repository)

### 2.1 Stack — fixed, do not change

- **Vanilla ES modules, no build step, no bundler, no npm runtime dependency.**
  `package.json` scripts run a plain static server
  (`python3 -m http.server 5173 --bind 0.0.0.0`).
- **Firebase v10.12.5** (Auth + Firestore + Storage) loaded as CDN ES modules,
  configured in `js/firebase.js`. Public web config only; security lives in the
  rules.
- **Hash router** in `js/app.js` (`#/route?a=b`). Routes are declared in
  `resolveRoute()` and guarded by `AUTH_ROUTES`.
- **PWA** with service worker `sw.js` (precache list — bump the version
  constant on any JS/CSS change) and `manifest.json`.
- **Mobile-first.** Bottom tab bar on phones, sidebar on desktop. Dialogs become
  bottom sheets ≤ 640 px. Respect `--safe-top` / safe areas. `dvh` units.
- **Guest browsing is real and stays:** signed-out users can watch feeds,
  stories, profiles, comments, sounds and live. Every interaction prompts
  sign-in. Private accounts stay locked by *rules*, not by hidden buttons.

### 2.2 File map — who owns what

| File | Ownership |
| --- | --- |
| `index.html` | Boot shell, pre-paint brand script, PWA meta. |
| `js/app.js` | Router, shell (topbar/tabbar/sidebar), session, badges, presence heartbeat, player mount, brand slots. **New routes are added here.** |
| `js/firebase.js` | Firebase config + helpers only. |
| `js/data.js` | Firestore layer: users, videos (posts), comments, sounds, DMs, follows, notifications, reports, lives, trending, search. |
| `js/social.js` | Social graph & state: reactions, prefs, privacy gates, blocks, profile media, stories, presence, follow requests, reposts, activity. **New: circles, mutes, restricts, message requests, group chats.** |
| `js/storage.js` | All Storage uploads (resumable, progress, `strict` mode so a `blob:` URL can never be persisted). |
| `js/music.js` | Internet Archive catalogue client (search, tracks, licences). **Licence rules are sacred** — only reuse-permitting licences may attach to posts. |
| `js/player.js` | The one shared `<audio>` element (dock, queue, Media Session). |
| `js/ui.js` | Shared UI helpers (modal, toast, esc, timeAgo, emptyState, avatar…). |
| `js/brand.js` | Logo plate measurement. **Do not touch** — the brand plate rule is its own contract (see `tools/check-brand.mjs`). |
| `js/views/*.js` | One view module per screen. Each exports `xxxView(ctx, opts)` returning `{ html, mount(root), destroy?() }`. |
| `firestore.rules` | **The security boundary.** Every collection the client touches has a match. |
| `storage.rules` | Owner-scoped `uploads/{uid}/{kind}/…` with size/type ceilings. |
| `firestore.indexes.json` | Composite indexes — **every** `where()+orderBy()` query in the client must be covered (the audit diffed this; keep it green). |
| `CHANGES.md`, `README.md` | Change log and the "what is real / not implemented" contract. |

### 2.3 Code rules

- Views render **honest empty states** (icon + one line + one action). Never
  demo data, never skeleton "sample" content that lingers.
- All counters are `increment(n)` writes, bounded in rules (±1 or a sane range).
  No read-then-write counters except in transactions where the rules allow it.
- Timestamps are `serverTimestamp()` and compared against `request.time` in
  rules. Clients never stamp `createdAt`.
- **Never trust the frontend.** Every permission that matters appears in
  `firestore.rules` (or `storage.rules`). Hiding a button in the UI is UX, not
  security.
- Denormalised user copies (`displayName`, `username`, `photoURL`) are
  propagated on rename/refresh exactly like `changeUsername` does today —
  extend that mechanism, don't bypass it.
- New client queries **must** add their composite index to
  `firestore.indexes.json`.
- Banned accounts (`banned: true`) can read their own profile and nothing else —
  the `isBanned`/`canWrite` helpers already enforce this everywhere; new
  collections must reuse them.
- Keep every module importable: no circular imports, `node --check` clean,
  every named import exists in the target's export list.

### 2.4 Per-feature change checklist (do all of these for every feature)

1. View module (`js/views/*.js`) or extension of an existing one.
2. Route(s) in `js/app.js` (+ `AUTH_ROUTES` if private).
3. Data functions in `js/data.js` / `js/social.js` with exports.
4. `firestore.rules` matches + `storage.rules` kinds if it uploads.
5. `firestore.indexes.json` entries.
6. `styles.css` (follow existing tokens, light + dark mode, mobile breakpoints).
7. Notifications (if the event warrants one — §8).
8. Acceptance tests run (§11) — two-account manual pass where social.
9. `CHANGES.md` entry, `README.md` update, `sw.js` cache bump.

---

## 3. Iron rules — what must be REAL, what must NEVER be faked

### 3.1 Must be real (write → read back → survives refresh & second device)

Auth, profiles, posts of every type, every reaction/comment/save/repost/follow,
every counter that is shown (views tick only after real playback; sound plays
count only after 20 s of listening — keep this behaviour), stories + viewer
lists, DMs + receipts + typing + presence, reports, admin actions, search
results, trending lists, marketplace listings, circle membership, notifications.

### 3.2 Must NEVER be faked (no exceptions)

- Users, follower counts, view counts, like counts, "people nearby",
  businesses, products, reviews, messages, story viewers, group members,
  circle members, engagement stats.
- **Trending** is a computation over real documents (recency + engagement),
  never a curated list of fake entries.
- **Payments.** There is no payment provider in scope. "Buy Now → Checkout →
  Payment → Order tracking" must NOT be built as simulated UI. The real
  commerce path today is **Message the seller** (and Call, for businesses with
  a public phone). Anything labelled "Buy now" that leads to a fake checkout
  is a rule violation.
- **AI.** No model output may be fabricated, and nothing may be published
  without explicit user approval (see P6 spec). The AI module is a labelled
  on-device suggestion engine until a real model endpoint is provided by the
  owner.
- **Sessions.** Firebase Web cannot list active sessions — do not build a fake
  "active sessions" screen; it stays in "Not built yet" with an honest note.
- **Live** is a segment-assembly broadcast (presence + chat + gifts + real
  video segments via Storage). Do not pretend it is low-latency live video.

### 3.3 May exist only as explicitly-labelled prototype

- Anything new that cannot yet be backed by data or a provider gets an on-
  screen label: "Prototype" / "Not built yet — this button will do X". A
  labelled honest stub is allowed; a silent fake is not.

---

## 4. Baseline — what is ALREADY real (do not rebuild)

### 4.1 Current routes (all working)

| Route | Screen |
| --- | --- |
| `#/home` | Vertical video feed — **For You / Following** tabs, story tray, autoplay deck. *(P0 moves this deck to `#/play`; `#/home` becomes the card feed.)* |
| `#/discover` | Trending videos / sounds / creators / hashtags + search. |
| `#/sounds`, `#/music` | Library · Discover (Internet Archive) · Your uploads · Favourites · Recently played. |
| `#/sound/{id}` | Sound detail (plays, uses, licence, "Use in a post"). |
| `#/create` | Composer: vertical video (upload or camera record), photo set (1–6), "also as story", caption, hashtags, sound. |
| `#/media/{id}` | Full-screen media viewer (profile pictures & media). |
| `#/tag/{tag}` | Hashtag page. |
| `#/notifications`, `#/inbox` | Notifications grouped by category, unread badges. |
| `#/messages`, `#/messages/{cid}`, `#/dm/{username}` | 1:1 messaging. |
| `#/live`, `#/live/{id}`, `#/live/go` | Live list / watch / broadcast (segments + chat + gifts). |
| `#/u/{handle}?tab=…&media=…` | Profile with tabs: Posts · Photos · Videos · Reposts · Music · Activity · Saved · Liked · Followers · Following · About. |
| `#/video/{id}` | Feed focused on one video. |
| `#/profile` | Own profile. |
| `#/settings` | Account, appearance, notification prefs, privacy, blocked list, sign out, delete account, honest "Not built yet". |
| `#/admin` | Users (role/verify/ban) · Videos · Comments · Reports · Sounds · Stats. |

### 4.2 Current collections (all rule-covered)

```
users/{uid}                (+ likedVideos, savedVideos, favoriteSounds,
                            postReactions, mediaReactions, reposts, playHistory,
                            savedCollections(+items), storyViews, blocks, profileViews)
usernames/{handle}
presence/{uid}
videos/{id}                one collection for ALL posts: vertical video, camera
                           recording, photo sets (mediaType distinguishes)
                           (+ comments/{cid} (+likes/{uid}))
profileMedia/{id}          (+ comments, likes) — profile picture & photo history
reposts/{id}
stories/{id}               (+ views/{viewerUid}, +reactions/{reactorUid})
sounds/{id}
follows/{uid}/following|followers/{targetUid}
followRequests/{ownerUid}/requests/{requesterUid}
notifications/{nid}
hashtags/{tag}
reports/{id}
lives/{liveId}             (+ segments, chat, gifts, reactions)
conversations/{cid}        (+ messages/{mid} — attachments, readBy, typing, unsend)
blocks via users/{uid}/blocks
(posts, products, churches, opportunities exist in rules only — legacy/unused,
except `products` which P5 reclaims as the marketplace collection)
```

### 4.3 Feature status vs. the Xacheus Connect plan

| Plan section | Status | Gaps this prompt fills |
| --- | --- | --- |
| 1 Home / feed | Partial | Card feed, "What's on your mind?" composer, text/poll/location/feeling/GIF/background post types, full post page |
| 2 Profile | Most of it | Share profile, More menu (restrict/block/report), Reels naming, full post page |
| 3 Discover | Partial | People You May Know UI, Businesses section, Circles section, multi-target search |
| 4 Circles | **Not built** | Entire feature (P2) |
| 5 Messaging | Most of it | Message Requests inbox, group chats, voice message recorder, forward, per-thread mute |
| 6 Notifications | Mostly there | New kinds (circles, business, system/trending) + categories |
| 7 Stories | Mostly there | Text stories, music on stories, poll/question stickers, Highlights, story privacy |
| 8 Xacheus Play | Deck exists on home | Dedicated `#/play` experience, action rail, deep links |
| 9 Creator profiles | Role only | Creator dashboard (real stats), tips framing |
| 10 Business profiles | Role only | Business fields, Call/Visit/Shop buttons, reviews |
| 11 Marketplace | **Not built** | Listings, categories, detail page, Message seller (P5) |
| 12 Xacheus AI | **Not built** | On-device suggestion engine with human approval (P6) |
| 13 Privacy & safety | Partial | Mute, restrict, hide post/comment, mention & story controls, 2FA |
| 14 Account & security | Partial | 2FA (TOTP), password/email change UI, honest session note |
| 15 Settings | Mostly there | 2FA section, password change, data export stays honestly "not built" |
| 16 Admin | Mostly there | Circles, Products, Businesses, X Plus, message stats |
| 17 X Plus | **Not built** | Admin-granted flag + feature gates (no checkout) |
| 18 Navigation | Mostly there | + sheet expands (Poll, Circle Post, Marketplace Listing) |
| 19 Journey / phases | — | §10 build order |

---

## 5. Screen map — how every screen connects

### 5.1 Navigation shell (after P0)

- **Topbar (all screens):** brand wordmark (logo plate rules apply — never
  modify `js/brand.js`) · feed tabs (on home) · 🔔 Inbox · 💬 Messages · theme
  toggle · avatar → account menu (Profile, Settings, Admin if role, Sign out).
- **Mobile bottom tabs:** `Home · Discover · (+) · Play · Profile`.
  - `+` opens the Create sheet (§5.3).
  - **Decision (deviation from plan §18, deliberate):** the plan lists
    *Messages* as the 5th tab. We keep **Play** there because Xacheus is
    video-first — the vertical deck is the product engine and must be one tap
    away — while **Messages stays one tap away via the topbar icon with its
    unread badge** (the plan's own home spec puts 💬 in the topbar too).
    **Live** (currently a mobile tab) drops to the account menu + the
    "Live now" strip on home; it is not removed. If the owner overrides this,
    it is a one-line swap in `TAB_NAV`.
- **Desktop sidebar:** Home, Discover, Play, Live, Music, Messages,
  Notifications, (Admin), Settings + account card.

### 5.2 Route table with button behaviour

Existing routes keep their current behaviour. New routes and changed buttons:

| Screen | Route | Buttons → where they go |
| --- | --- | --- |
| **Home (card feed)** | `#/home` | Composer → create sheet. Story tray bubbles → `#/stories/{id}` viewer. Post card: avatar/name → `#/u/{handle}`; Follow/Following toggles (private accounts send a request); ❤️ like/reaction, 💬 → comment modal or `#/post/{id}`, ↗️ share (copy link / DM / system), 🔖 save (collections menu), ⋯ More (Copy link, Hide post, Report, Delete if own). Card media → full-screen viewer. `#/post/{id}` deep link lands on the full post page. |
| **Full post page** | `#/post/{id}` | Same action rail as the card + complete comment thread (replies, comment likes, report, own-comment delete). Back → previous screen. |
| **Xacheus Play** | `#/play` | Vertical swipe deck (the current home deck, moved as-is). Right rail: avatar + Follow, ❤️, 💬 (opens `#/post/{id}`), ↗️, 🔖. Swipe ↑ next / ↓ previous. Tap → focus; long-press → pause. |
| **Create sheet** | from `+` | See §5.3. |
| **Create composer** | `#/create?type=…` | Types: Video, Photo, Post (text/poll), Story. Circle Post → circle picker. Publish → `videos/{id}` (+ `circleId` if set) or `stories/{id}`. Music picker attaches a `sounds` doc (licence rules intact). |
| **Circles home** | `#/circles` | Joined circles list; Discover circles (Recommended = category + size, Popular = memberCount, Local = city match). Card: logo, name, members, category chip, Join/Joined. |
| **Circle page** | `#/circle/{handle}` | Header: cover, logo, name, member count, verified, Join/Leave, Invite (copy `#/circle/{handle}?invite=1` link, or DM link), More (Report, Leave, if mod: Manage). Tabs: **Posts** (circle feed) · **About** (description, rules, category, moderators, member count, created) · **Members** (moderators section first) · **Events** · **Announcements**. Moderator extras on circle posts: Approve (if approval on), Remove. Member extras: remove member (mod+). |
| **Marketplace** | `#/marketplace?cat=…&seller=…` | Category chips (All, Products, Services, Jobs, Properties, Vehicles, Electronics, Clothing, Food, Other), search, sort (Newest / Price ↑ / Price ↓), "My listings" (own), `+ New listing` → `#/marketplace/new`. Listing card: photo, title, price (ZMW), location, seller. |
| **New listing** | `#/marketplace/new` | Photo(s) → Title → Price → Location → Description → Category. Publish → `products/{id}`. |
| **Listing detail** | `#/product/{id}` | Photos carousel → Title → Price → Location → Description → Seller card (avatar, name, verified, follow). Buttons: **Message Seller** (real DM), **Call** (business with public phone only), Share, Report. Seller: Edit, Mark as sold, Remove. No Buy Now (no payment provider — §3.2). |
| **Creator dashboard** | `#/creator` | Own stats only: Followers, Reach (profile views), Views, Likes, Comments, Shares, Engagement (computed), Top videos table (real numbers, 30-day), Follower growth (from follow timestamps). No invented audience data. |
| **Message Requests** | `#/messages?tab=requests` | Incoming pending DM threads (from non-connections when messaging is gated): **Accept** (thread moves to inbox, sender notified) · **Delete** · **Block**. |
| **Group chat** | `#/messages/{cid}` (group thread) | Same chat shell; group header with member avatars; ⋯ menu: Add member (DM picker), Rename (admin), Leave, Report, Hide. |
| **Admin (extended)** | `#/admin` | Existing tabs + **Circles** (verify/remove) + **Products** (remove) + **Businesses** (verify, list) + **X Plus** (grant/revoke, labelled "manual grant until payments exist"). |

### 5.3 The `+` (Create) sheet — six entries

| Entry | Action |
| --- | --- |
| Create Post | `#/create?type=post` — text, up to 6 photos, poll, location, feeling, background |
| Story | `#/create?type=story` — photo/video + text overlay, music, poll/question sticker |
| Video | `#/create?type=video` — upload or camera record (existing) |
| Poll | `#/create?type=poll` — text post with 2–4 options, optional end date |
| Circle Post | `#/create?type=video&circle=…` — any post type + circle picker (circles you own/moderate/member of) |
| Marketplace Listing | `#/marketplace/new` |

---

## 6. Data model

### 6.1 Existing collections — key fields (reference)

```
users/{uid}
  uid, username, displayName, email, photoURL, coverUrl, bio, links[], location,
  website, role ("user"|"creator"|"business"|"church"|"admin"), verified, banned,
  privateAccount, joinedAt, profileViewCount, prefs {notifications, privacy, playback}
  privacy: whoCanMessage ("everyone"|"followers"|"nobody"),
           whoCanComment ("everyone"|"followers"|"nobody")
videos/{id}
  uid, username, displayName, photoURL, mediaType ("video"|"photo"),
  url, storagePath, thumbnailUrl, duration, width, height, photos[] (photo posts),
  caption, hashtags[], mentions[], soundId?, soundTitle?, soundArtist?, soundLicence?,
  location?, circleId?, circleStatus?, likeCount, commentCount, shareCount, viewCount,
  repostCount, createdAt
stories/{id}
  uid, username, displayName, photoURL, kind ("photo"|"video"), url, storagePath,
  caption, createdAt, expiresAt (= createdAt + 24h, enforced in rules),
  viewCount, reactions {love, laugh, wow, support}, poll? (new in P4)
conversations/{cid}
  uidA, uidB, participants[], createdAt, unreadA, unreadB,
  hiddenA, hiddenB, lastMessageAt, lastMessagePreview, typingBy?, typingAt?
  (+ group: true, title, groupMembers[] — new in P3, §6.2)
products/{id}   (legacy admin-only match — RECLAIMED in P5)
```

### 6.2 New & extended collections

> Every block below is authoritative for its phase: fields, owner, rules,
> indexes. Add them to `firestore.rules`, `firestore.indexes.json`, and the
> client data layer exactly as specified.

#### P0 — post types (extends `videos`)

```
videos/{id} + (new fields)
  postType: "video" | "photo" | "text" | "poll"      (default: existing = video|photo)
  background?: string          // text posts: one of a fixed CSS gradient set, "none"
  feeling?: string             // free text ≤ 60 chars, "Feeling X" line on the card
  loop?: boolean               // GIF = short looping clip (stored as video, muted, looped)
  poll?: {
    question: string,
    options: string[2..4],
    endsAt?: timestamp         // open-ended if absent
  }
  circleId?: string            // set for circle posts (P2)
  circleStatus?: "pending" | "approved"   // only when circle requires approval

videos/{id}/pollVotes/{uid}    (NEW — one doc per voter, top-level subcollection
                                so ANY user can write their own vote)
  posterUid: string, optionIndex: int, votedAt: timestamp
  votesCount?: number on parent? NO — aggregate via query at read time
  (displayed count = getDocs(pollVotes) length + pre-computed counter:
   add parent field pollVoteCount: int, incremented in the SAME batch as the vote)
```

Rules for `pollVotes`:
- read: voter themselves, OR the poster (`posterUid == auth.uid`), OR any signed-in user may read the *count* only if the vote doc is public — simplest correct shape: `allow read: if request.auth != null && (request.auth.uid == uid || resource.data.posterUid == request.auth.uid);` and the poster reads all votes for tallying; public tallies are computed from the parent's `pollVoteCount` + per-option counters `pollOptionCounts[]` maintained in the same batch.
- create: `request.auth.uid == uid && pollVoteCount < 3000`
- delete: voter or poster.
- Index: `(posterUid ASC, votedAt DESC)` if you list "who voted" (optional, owner-only).

#### P1 — discover (no new collections)

People You May Know = `getSuggestedUsers` (already real: follows-of-follows
heuristic over real docs). Businesses section queries
`users where role == "business" order by joinedAt`. Local = `location` string
match on city token — label it "in your city (from your profile)".

#### P2 — Circles (NEW collections)

```
circles/{id}
  handle (3-30, unique, reserved via circlesHandles/{handle}),
  name, description, category (church|school|university|community|business|
                              sports|gaming|professional|neighborhood|interest),
  coverUrl, coverPath, logoUrl, logoPath,
  uid (owner), verified: false, banned: false,
  isPublic: "open" | "private",
  requiresApproval: bool          // posts need moderator approval
  rulesText: string               // the circle's rules
  memberCount: int, eventCount: int,
  createdAt

circlesHandles/{handle}           { handle, circleId, createdAt }
  (unique reservation, same pattern as usernames/{handle})

circles/{id}/members/{uid}        (NEW subcollection)
  role: "owner" | "moderator" | "member"
  status: "pending" | "active"    // pending when isPrivate and not yet approved
  joinedAt, invitedBy?

circles/{id}/announcements/{aid}
  title, body, uid, createdAt

circles/{id}/events/{eid}
  title, location, at (timestamp), description, uid, createdAt
```

- **Circle feed** = `videos where circleId == id [and circleStatus == "approved"] order by createdAt desc`. No separate post store — a circle post is a normal post tagged with `circleId`.
- `videos/{id}` gains `circleId?`, `circleStatus?` (see P0 block).
- **Join flow:** `isPublic: open` → member doc created (`status: active`), `memberCount +1`, notification to owner if `requiresApproval == false`. `isPublic: private` → `status: pending`; owner/mods see a request list (Members tab, "Requests" chip) with Accept/Decline.
- **Leave:** owner cannot leave (must transfer or delete the circle); leaving a private circle with pending status just deletes the request.
- **Invite:** link `#/circle/{handle}?invite=1` (page shows Join with "invited by X" prefill) or DM containing the link. No invite-only email — none.
- **Reports:** `reports/{id}` gains `targetType: "circle" | "circlePost"` (extend the frozen `REPORT_TYPES` list).

Rules (summary — write them in full in `firestore.rules`):
- `circles/{id}` read: public circles `true`; private circles: member (status active) or admin.
- create: `canWrite()` && `data.uid == auth.uid` && handle valid.
- update: owner OR admin (field whitelist; `banned` admin-only; `memberCount` ±1 bounded).
- delete: owner or admin.
- `members/{uid}` read: member or circle member (query the member doc) or admin.
  write: the member themselves (leave / join-request), circle owner or moderator (role/status changes), admin. Owner row is immutable except by owner/admin.
- `announcements`, `events`: read per circle visibility; create/update/delete:
  owner, moderators (own docs for delete; moderators may delete any), admin.
- Circle-post delete by moderators: extend `videos/{id}` delete rule with
  `|| isCircleModerator(video.circleId)` — a `get()` on
  `circles/{circleId}/members/{auth.uid}` checking `role in ["owner","moderator"] && status == "active"` (guard: `circleId` non-null).

Indexes (new):
- `videos`: (circleId ASC, createdAt DESC); (circleId ASC, circleStatus ASC, createdAt DESC)
- `circles`: (category ASC, memberCount DESC); (isPublic ASC, createdAt DESC)
- `circles/{id}/members`: (status ASC, joinedAt DESC) — single-field on subcollection, no composite needed.

#### P3 — Messaging completion

```
conversations/{cid} + (new fields)
  group: bool (default false)
  title?: string                 // group only
  pending?: bool                 // message request state (1:1 only)
  pendingBy?: string             // the side waiting for acceptance
  groupMembers?: [uid]           // group: full participant list
conversations/{cid}/groupMembers/{uid}   (NEW subcollection, group only)
  role: "admin" | "member", joinedAt, invitedBy?
```

- **Message request:** when a user messages someone they are not connected with
  (no mutual follow AND the target's `whoCanMessage != "everyone"`), the
  conversation is created with `pending: true, pendingBy: senderUid`. The
  sender's thread shows a banner "Your message is waiting to be accepted".
  Recipient sees it under **Message Requests** (`#/messages?tab=requests`).
  Accept → `pending: false` + notification to sender. Delete → soft-hides for
  recipient (messages stay; new message re-creates request). Block → deletes
  pending state, applies block (messaging then refused by rules).
- **Group chat:** create from a 1:1 thread ("Add people") or from a profile
  ("Group chat" in the More menu). Creating: `group: true`, `title`,
  `groupMembers` docs for creator + added users, each added user notified
  (kind `groupInvite`). Members read/write; non-members cannot (rules check
  subcollection membership via `get(.../groupMembers/{auth.uid})`).
- **Voice message:** composer mic button → `MediaRecorder` → audio upload
  (existing `chat` Storage kind, ≤ 30 MB) → `sendDirectMessage` with
  `attachment.kind = "audio"` (the renderer already plays audio attachments —
  this only adds the recorder UI).
- **Forward:** message ⋯ menu → "Forward" → conversation picker → resends the
  text (+ attachment URL) to the target thread (a normal new message,
  `forwardedFrom: {uid, at}`).
- **Per-thread mute:** `users/{uid}/conversationPrefs/{cid}`
  `{ muted: bool, updatedAt }` — suppresses badge increment for that thread
  (client), owner-scoped.

Rules additions:
- `messages/{mid}` create: participant (existing) AND when `group` — must be a
  group member via the subcollection `get`. `pending` conversations: only
  `pendingBy` may write messages until accepted.
- `groupMembers/{uid}`: write by group admin (role change, remove), by the
  member (leave), by creator at creation. Read: group members.

#### P4 — Stories completion, Xacheus Play, creator dashboard

```
stories/{id} + (new fields)
  mediaType: "photo" | "video" | "text"     (text stories: background gradient + caption)
  background?: string
  soundId?: string                          // music on story (licence rules apply)
  poll?: { question, options[2..4], endsAt? }
  question?: { prompt }                     // question box → replies become DMs
  pollVoteCount?: int, pollOptionCounts?: [int]
  whoCanSee: "everyone" | "followers" | "nobody"   (default everyone; private accounts: followers)

stories/{id}/pollVotes/{uid}                same shape as post pollVotes

users/{uid}/highlights/{hid}                 (NEW)
  title, storyId, createdAt, coverUrl
  (Highlights are PERSISTENT: the story doc itself is copied? NO — the
   highlight references a story snapshot: `snapshot: {kind,url,storagePath,
   caption,background,soundId}` saved at pin time, so a highlight survives
   the 24 h expiry. Viewer list does NOT survive; highlights are read-only
   media + caption.)
```

- **Story privacy:** `whoCanSee` is enforced in the `stories` read rule
  (`followers` mode → reader must follow the poster: `get(follows/{reader}/following/{poster})` exists).
- **Xacheus Play** reuses `videos` — no new collection. `#/play` renders the
  current vertical deck (moved from `#/home`). Deep links: `#/play?focus={id}`,
  `#/post/{id}` is the full post page (P0).
- **Creator dashboard** computes everything from existing real collections
  (no new storage): followers (`follows/{uid}/followers`), reach
  (`users/{uid}/profileViews` count, capped query), per-video
  viewCount/likeCount/commentCount/shareCount (own `videos`), engagement =
  (likes+comments+shares)/max(followers,1) over the window, growth from
  `joinedAt` timestamps of follower docs.

#### P5 — Business profiles & Marketplace

```
users/{uid} (role "business") + (new fields)
  businessName?, phone? (public if business), openingHours?: { "mon": "08:00-17:00", ... },
  address?, services?: string[], about?

products/{id}  (RECLAIM the legacy match — replace admin-only rules)
  uid (seller), isBusiness: bool,
  title (≤ 100), description (≤ 2000),
  category: "products"|"services"|"jobs"|"properties"|"vehicles"|"electronics"
           |"clothing"|"food"|"other",
  price: number (≥ 0), currency: "ZMW",
  photos: [url] (1–6), photoPaths: [path],
  location: string,
  status: "active" | "sold" | "removed",
  viewCount: int, createdAt
```

- **Business profile page:** existing profile view gains a business section
  (hours table, phone, address, services chips, About) and the button row
  **Follow | Message | Call | Visit | Shop** —
  Call → `tel:` (only when public phone), Visit → external `https://maps.google.com/?q={address+city}`, Shop → `#/marketplace?seller={handle}`.
- **Reviews** (P5, simple & real): `products/{id}/reviews/{uid}` — one review
  per user per product: `{ rating: 1..5, text ≤ 500, createdAt }`. Shown on
  listing detail; seller replies: `reply { text, createdAt }` on the review
  doc (seller-only field). No anonymous reviews, no fake ratings — if there
  are none, show "No reviews yet".
- **No payments.** "Message Seller" is the commerce path. Listing detail shows
  seller's verified badge when present.

Rules:
- `products/{id}` read: `true`.
  create: `canWrite() && data.uid == auth.uid && data.title.size() in [3..100]
  && data.price >= 0 && data.status == "active" && photos ≤ 6`.
  update: owner (whitelist; `status` may go active→sold→removed; price editable)
  OR admin (any, incl. `removed`).
  delete: owner or admin.
- `reviews/{uid}`: create by any signed-in non-seller, non-banned user, one per
  uid (doc key = reviewer uid); update: reviewer (text/rating) or seller
  (`reply` fields only); delete: reviewer, seller, or admin.
- Business fields on `users`: only editable by the user themselves when
  `role == "business"` (extend the existing users update whitelist).
- Indexes: `products` (category ASC, createdAt DESC), (status ASC, createdAt DESC),
  (uid ASC, createdAt DESC) for "my listings" / seller shop.

#### P6 — Xacheus AI, X Plus, admin extensions

- **AI:** no collection. `js/ai.js` exports pure functions (see P6 spec).
  Optionally store `users/{uid}.aiAssistUsed: int` (incremented once per
  session where the user applied a suggestion) for the admin stats panel.
- **X Plus:** `users/{uid}.xPlus: bool, xPlusSince?: timestamp` —
  **admin-only** writes (extend the users rule: `xPlus` may only be set by an
  admin; users cannot touch it). Gated features (each a simple client check
  + the storage rule where upload size is involved):
  - 💎 badge next to display name (rendered wherever names render).
  - Larger uploads: `storage.rules` — X Plus users: image ≤ 25 MB, video ≤ 400 MB.
  - Advanced creator dashboard (follower-growth chart window + top cities from
    followers' self-reported locations).
  - Extended AI suggestion sets.
  - Profile accent colour + one extra link slot.
  - Reduced advertising — **no ads exist yet; the gate is a no-op and the
    settings row is not shown** (do not show a fake "ads reduced" state).
- **Admin panel** gains tabs: Circles, Products, Businesses (verify toggle),
  X Plus (grant/revoke with on-screen note "manual grant — payments coming"),
  plus message stats (conversations, messages counts via `countByCollection`).

---

## 7. Feature specifications, phase by phase

Format per feature: **WHAT** (user-visible) · **SCREENS & BUTTONS** · **DATA** ·
**RULES** · **TESTS** (acceptance, two-account where social).

---

### PHASE 0 — Home card feed & post types  *(foundation for everything else)*

**F0.1 — Home becomes the card feed; deck moves to Play**
- WHAT: `#/home` shows: top bar (logo, search, 🔔, 💬, avatar — existing),
  **story tray** (existing component, unchanged), **composer** ("What's on
  your mind?" — opens the create sheet), then a feed of **post cards**.
  The current vertical deck (incl. For You / Following tabs) moves to
  `#/play` untouched. Bottom tabs become Home · Discover · + · Play ·
  Profile (see the nav decision note in §5.1 — Live drops to the account
  menu + a "Live now" strip on home).
- BUTTONS: see §5.2 route table. Card More menu: Copy link · Share to… ·
  Hide post (new `users/{uid}/hiddenVideos/{videoId}` — your view only) ·
  Report · Delete (own).
- DATA: `videos` unchanged for reading; feed query = existing `fetchVideoPage`
  (foryou: recent + likes; following: follows-based) minus `hiddenVideos`
  (client filter) minus muted users (P3, client filter for now).
- RULES: none new (Hide post subcollection: owner-only write, same pattern as
  `likedVideos`).
- TESTS: 1) Publish a video post as A. B (following A) sees the card with A's
  avatar, name, time, caption, hashtags, media. 2) Every card button works and
  lands on the right screen. 3) A's `#/play` still autoplays the same videos.
  4) Refresh → card persists. 5) Guest sees the feed, sees "Log in" on actions.

**F0.2 — Post types: text, poll, location, feeling, GIF, background**
- WHAT: composer gains a **Post** type: text (≤ 2000) + optional 1–6 photos +
  optional **background** (fixed CSS gradient set, no external assets) +
  optional **feeling** (free text ≤ 60) + optional **location** (free text) +
  optional **poll** (2–4 options, optional end date). **GIF** = record or
  upload a short clip (≤ 15 s), stored as a muted looping video
  (`loop: true`), labelled "GIF" on the card. Music attachment stays as-is.
- DATA: `videos` new fields per §6.2-P0 (`postType`, `background`, `feeling`,
  `location`, `loop`, `poll`, `pollVoteCount`, `pollOptionCounts`).
  Vote writes: `videos/{id}/pollVotes/{uid}` (batch: vote doc +
  `pollVoteCount +1` + `pollOptionCounts[i] +1`).
- RULES: pollVotes per §6.2-P0; `videos` create rule extends the field
  whitelist (poll.options size 2..4, background in the fixed set, caption ≤ 2000).
- BUTTONS: Poll on a card renders options with % bars after voting; "Vote" →
  write (once; can change vote before endsAt by delete+create batch); expired
  poll is read-only.
- TESTS: 1) A posts a poll with 3 options + background. B votes → B's card
  shows bars + "You voted"; A sees the tally. 2) B re-votes before expiry →
  counts move correctly (no double count on refresh: one doc per uid). 3)
  Expired poll: no vote button, tallies frozen. 4) GIF post loops muted,
  labelled GIF. 5) Poll vote from console as C → rules deny.

**F0.3 — Full post page**
- WHAT: `#/post/{id}` — media large (carousel for photo sets, autoplay video),
  author row (avatar, name, verified, Follow), caption + hashtags (clickable
  `#/tag/{tag}`), feeling/location line, action rail (like, comment, share,
  save, more), complete comment thread (existing comment component, inline).
- BUTTONS: 💬 on card → same page. Back button returns to previous hash.
- DATA/RULES: none new.
- TESTS: cold link `#/post/{id}` works (fresh tab, logged out → still readable
  for public posts); own-post delete removes page (redirect to home); comment
  posted on the page appears in the card's comment modal too.

---

### PHASE 1 — MVP completion

**F1.1 — Discover: People & Businesses**
- WHAT: Discover tabs become **Trending · People · Businesses · Circles
  (placeholder until P2) · Hashtags**. People: "People you may know"
  (`getSuggestedUsers`), "Suggested" (recent verified/active), "Nearby"
  (same city token as your profile location — labelled), "Popular" (most
  followers among public users). Businesses: `role == "business"` sorted by
  newest, verified first; card has Follow + Message + View profile.
- DATA: existing (`users`, `follows`). No new collections.
- TESTS: B follows 3 users; A appears in B's "you may know" only if real
  overlap exists; empty sections show honest empty states.

**F1.2 — Profile: actions & share**
- WHAT: profile header action row gains **Share profile** (copy link + system
  share + DM) and a complete **More** menu: Copy profile link · Restrict (P3
  — stub until then, labelled) · Block/Unblock (exists in settings; add here)
  · Report (exists) · Message (gated as today). Verified badge + join date +
  website already render — verify parity with spec (name, username, bio,
  location, website, joined date, stats, Follow/Following, Message).
- TESTS: share link opens the profile cold; block from profile works and
  blocks DMs (rule-verified).

**F1.3 — Notification taxonomy completion**
- WHAT: add categories **Circles** (P2), **Business**, **System** to the
  settings category list and to `NOTIFICATION_CATEGORIES`. System kind
  `trending` fires when one of your videos crosses the trending threshold
  (same threshold `getTrending` uses) — at most one per video (store
  `trendingNotified: true` on the video in the same batch).
- TESTS: threshold cross produces exactly one notification; turning the
  category off in settings stops creation at the source (not just display).

**F1.4 — Search across all targets**
- WHAT: the topbar search and Discover search cover
  `People | Posts | Videos | Circles (P2) | Businesses | Hashtags` as
  tabbed results, each a real Firestore query (existing `searchUsers`,
  `searchVideos`, `searchSounds` + new `searchProducts` (P5) + tag prefix).
- TESTS: typing a handle, a caption word, a #tag, and (P5) a product title
  each return the right rows; nothing fabricated.

---

### PHASE 2 — Circles (the differentiator)

**F2.1 — Circle core (create / join / leave / page)**
- WHAT & SCREENS: `#/circles` (joined + discover), `#/circle/{handle}` (tabs
  Posts · About · Members · Events · Announcements), composer "Circle Post".
  Create circle: name, handle (unique via `circlesHandles`), category,
  description, rules text, logo/cover upload (existing Storage `circles` kind
  — add to `storage.rules`), open or private.
- BUTTONS (from §5.2) with exact behaviour:
  - **Join/Leave** — per §6.2-P2 flow; private → pending until approved.
  - **Invite** — copy link / DM link.
  - **Circle Post** (composer) — picker lists circles where you are
    owner/moderator/active-member; published post gets `circleId`
    (+ `circleStatus: "pending"` when `requiresApproval`).
  - Circle feed card shows a small circle chip (logo + name) linking to the
    circle; the post ALSO appears in the normal home feed (it is a normal
    post) — this is intentional (reach), note it in README.
- DATA: `circles`, `circlesHandles`, `circles/{id}/members`, subcollections
  per §6.2-P2; `videos.circleId/circleStatus`.
- RULES: per §6.2-P2, incl. moderator delete on circle posts.
- TESTS (two accounts + one moderator): 1) A creates open circle; B joins →
  memberCount 2 (no double-increment on retry: doc-key idempotency). 2) B
  posts into the circle → appears in circle feed AND home feed with chip. 3)
  A (owner) removes B's post. 4) Private circle: B's join sits in Requests;
  A accepts → B sees posts; A declines → B sees a declined notice. 5) Member
  list, About rules, member counts all survive refresh. 6) Non-member C
  cannot read private circle (console read denied).

**F2.2 — Moderation, events, announcements**
- WHAT: Members tab shows owner + moderators (role chips) and "Requests"
  (private circles). Mod buttons: **Approve** (pending post), **Remove**
  (post), **Remove member** (non-owner), **Add moderator / Remove moderator**
  (owner only). Events tab: create (title, location, date/time, description),
  upcoming sorted; Announcements tab: pinned list, create/edit/delete (owner +
  mods).
- DATA/RULES: per §6.2-P2.
- TESTS: mod can approve a pending post (circle feed query with
  `circleStatus == "approved"` only) and remove a member; owner cannot leave
  (button hidden + rule: owner member doc delete denied); events render
  chronologically; announcement appears on circle page top strip.

**F2.3 — Circle notifications & Discover integration**
- WHAT: kinds `circleInvite` (DM/link join), `circleRequest`, `circleJoined`,
  `circlePost` (members get a notification when a post is approved in the
  circle, except the poster), `circleEvent`. Discover gains a **Circles** tab
  (Recommended = your category + size band; Popular = memberCount desc; Local
  = city token match, labelled).
- TESTS: each kind produced by the real trigger, category "Circles" mutable in
  settings, off = not created.

---

### PHASE 3 — Connection (messaging completion)

**F3.1 — Message Requests**
- WHAT: per §6.2-P3. Inbox header gains a **Requests** chip (count of pending
  conversations where `pendingBy != me`). Request row: avatar, name, preview,
  **Accept | Delete | Block**.
- RULES: pending conversation — only `pendingBy` writes messages; accept
  (update `pending: false`) by the other participant or admin; delete hides
  for the recipient.
- TESTS: A (whoCanMessage = followers) ← B messages A → B's thread shows
  waiting banner; A sees request; Accept → A's inbox + notification to B;
  Delete → B's next message re-creates the request; Block → all further DMs
  rule-denied.

**F3.2 — Group chats**
- WHAT: create from 1:1 thread ("Add people…" picker of your mutual
  connections) or profile More menu ("Group chat"). Group thread: title,
  member avatar strip, per-user sender names above bubbles, ⋯ menu (Add
  member, Rename [admin], Leave, Report, Hide).
- DATA/RULES: per §6.2-P3.
- TESTS: 3-member group: all see messages in real time; added member is
  notified; non-member read denied (console); admin renames; a member leaves
  (their doc removed, remaining members unaffected); group message from a
  leaver is denied.

**F3.3 — Voice messages, forward, thread mute**
- WHAT: mic button in composer → recorder (record/stop/cancel, duration cap
  2:00) → audio bubble (existing audio renderer). Forward: message ⋯ →
  picker → new message in target thread with `forwardedFrom`. Thread ⋯ →
  Mute notifications (per-thread; badge suppressed, messages still arrive).
- TESTS: voice message plays on both devices; forwarded message shows "From
  {name}" caption; muted thread increments nothing in the badge while the
  thread's unread count still grows (visible on open).

---

### PHASE 4 — Media (Stories completion, Xacheus Play, Creators)

**F4.1 — Stories: text, music, poll, question, privacy**
- WHAT: story composer (from tray "+" or create sheet) gains: **Text** story
  (background + text), **Music** (sound picker, licence rules intact),
  **Poll sticker** (2–4 options, tap → vote, owner sees tally in the viewer),
  **Question box** (tap → pre-filled DM reply), **Who can see** (everyone /
  my followers / nobody).
- DATA/RULES: per §6.2-P4, incl. `stories` read rule for `whoCanSee:
  followers`.
- TESTS: text story renders with background; poll vote persists (one per
  viewer); question reply arrives as a real DM with the question in a
  caption; `whoCanSee: nobody` → story only for owner (rule-verified);
  follower-only story: non-follower read denied, follower reads fine.

**F4.2 — Highlights**
- WHAT: story viewer "⋯" → **Save to Highlights** (own stories; any story you
  can see → a copy you own). Profile gains a **Highlights** row under the
  cover: circle tiles (title, cover). Tap → read-only viewer (snapshot, no
  viewer list, no expiry). Delete highlight (owner).
- DATA: `users/{uid}/highlights/{hid}` with embedded snapshot per §6.2-P4.
- TESTS: pin A's story as a highlight from B's profile view; after 24 h the
  story is gone from the tray but the highlight still plays; highlight delete
  removes only the doc (never the original story).

**F4.3 — Xacheus Play polish**
- WHAT: `#/play` is the dedicated vertical experience (moved deck): full-
  bleed swipe ↑/↓, right rail (avatar + Follow, ❤️ with reaction picker, 💬 →
  `#/post/{id}`, ↗️, 🔖), creator/caption/hashtags/music line with real
  view/like/comment counts, sound line with licence. `#/play?focus={id}`
  deep link.
- TESTS: deck autoplay honours data-saver (existing); focus deep link lands on
  that video; rail actions all real; guest can swipe but actions prompt
  sign-in.

**F4.4 — Creator dashboard**
- WHAT: `#/creator` (visible for role `creator` — or any user with ≥ 1 post,
  entry point in the account menu as "Creator tools"): Followers · Reach
  (profile views, last 30/90 d) · Views · Likes · Comments · Shares ·
  Engagement % · Top 5 videos (real per-video numbers) · Follower growth
  (weekly buckets from follower `joinedAt`). Bars/charts are simple CSS on
  real numbers — no invented data, and every number links to its source list.
- TESTS: every number on the dashboard reconciles with the underlying
  collection (spot-check 3); new follower/comment after load moves the number
  (refresh).

**F4.5 — Tips (framing)**
- WHAT: live gifts are renamed in the UI to **Tips & Gifts** (the gift picker
  already exists and is the only real tip mechanic). Roadmap note only for
  paid content / subscriptions / ad revenue — **no UI, no fake buttons**.

---

### PHASE 5 — Business & Marketplace

**F5.1 — Business profile fields**
- WHAT: profile edit (own, role business) gains: business name, phone,
  address, opening hours (7-day picker), services (chips, ≤ 8), about.
  Business profile page: business section + button row **Follow | Message |
  Call | Visit | Shop** per §5.2.
- DATA/RULES: per §6.2-P5.
- TESTS: all fields survive refresh; Call button absent without a public
  phone; Shop button lands on that seller's listings.

**F5.2 — Marketplace**
- WHAT & SCREENS: `#/marketplace` (category chips, search, sort, My listings),
  `#/marketplace/new` (photo(s) → title → price → location → description →
  category), `#/product/{id}` (photo → title → price → location → description
  → seller → **Message Seller** / Call / Share / Report; seller: Edit / Mark
  sold / Remove).
- DATA/RULES: per §6.2-P5 (including `products/{id}/reviews/{uid}`).
- BUTTONS: Message Seller opens a real DM to the seller (first message
  prefills "Hi, I'm interested in: {title}" — the user can edit before
  sending; respect the seller's `whoCanMessage` — if gated, the message
  becomes a Message Request on the seller's side).
- TESTS: 1) A lists a product (ZMW 5,000, 2 photos) → appears in browse, in
  A's My listings, and in A's business shop. 2) B messages the seller → real
  DM thread. 3) B leaves a 4★ review with text; A replies. 4) A marks sold →
  card shows "SOLD" chip, removed from default browse sort position. 5)
  Non-owner cannot update the listing (console denied). 6) No "Buy now"
  button exists anywhere.

**F5.3 — Business notifications**
- WHAT: kinds `productMessage` (you messaged a listing's seller → they get a
  notification with the listing link) and `businessPost` (you follow a
  business and they publish). Category **Business**.
- TESTS: both fire once each, category toggle works.

---

### PHASE 6 — AI, X Plus, monetization groundwork

**F6.1 — Xacheus AI (on-device, approval-only)**
- WHAT: `js/ai.js` — pure, deterministic, labelled **"On-device suggestions —
  you approve everything. Nothing is published without you."** Functions:
  - `suggestHashtags(text)` — extracted tags + top real tags from the
    `hashtags` collection (frequency) + a small curated seed list.
  - `draftPost({ postType, topic, tone, hasPhotos, hasPoll })` — template
    drafts (2 variants) from the user's own inputs.
  - `improveCaption(text)` — trims, fixes spacing/capitalisation, offers a
    hook line + keeps the user's hashtags.
  - `summarize(text)` — extractive: leading sentences ≤ 2, clearly "Summary: …".
  - `suggestReplies(text)` — 3 context-appropriate templates (thank-you /
    question / invite).
  - `improveBio(bio)`, `adCopy(businessProfile)` — template variants.
- SCREENS: ✨ button in the composer (hashtag + caption), in Post type
  (draft/summarize), in profile edit (bio), in business edit (ad copy), in
  the comment modal (suggest replies). Each result renders as a **draft
  card**: Apply / Edit (copies into the field) / Discard. **Apply never
  publishes** — it only fills the user's own input fields; the user presses
  Publish.
- HONESTY RULE: the UI never says "AI wrote this" as if a model did — it says
  "Suggestions". If the owner later supplies a real model endpoint, add
  `aiComplete(prompt)` as the single integration point behind the same
  interfaces; until then no external calls, no API keys, no pretending.
- TESTS: each function returns a draft from real inputs (incl. the real
  hashtags collection); no draft can reach Firestore without the user's
  publish action; console: no network calls from `js/ai.js`.

**F6.2 — X Plus**
- WHAT: per §6.2-P6. Admin tab **X Plus**: list of users with the flag,
  grant/revoke (note: "manual grant — self-serve checkout comes with
  payments"). User-facing: settings "X Plus" panel showing what the flag
  unlocks **today** (badge, larger uploads, advanced analytics, extended AI)
  and what is **not yet applicable** (reduced ads — no ads in the product
  today). 💎 badge renders next to the name everywhere names render (feed
  card, profile header, chat bubbles, comments).
- TESTS: admin grants A → A's badge appears to B on refresh; A's 30 MB video
  uploads (storage rule), B's still capped at 100 MB; users cannot set
  `xPlus` on themselves (console denied); revoke removes the badge.

**F6.3 — Monetization groundwork (roadmap-only, honest)**
- Paid content, creator subscriptions, brand partnerships, ad revenue:
  **not built, no UI.** Documented in README roadmap with the exact trigger
  for each ("when a payment provider is integrated" / "when ads launch").
  Tips & gifts (F4.5) is the only money-adjacent feature live.

---

### CROSS-CUTTING — Privacy, safety, security, settings, admin

**X.1 — Privacy & safety (build alongside P3, before P4)**
- **Mute** (`users/{uid}/mutes/{mutedUid}`): profile More menu → Mute/Unmute.
  Muted users' posts are filtered from your home feed (client filter;
  server-side `not-in` up to 30 mutes if you want it in the feed query —
  either way, label in README which mode is live). Comments by muted users
  on YOUR posts are collapsed behind "View hidden comment".
- **Restrict** (`users/{uid}/restricts/{mutedUid}` — same shape): restricted
  users' comments on your posts are visible only to them (comment rule:
  `allow read: if !(resource.data.postOwnerUid == request.auth.uid &&
  request.auth.uid != resource.data.uid && inRestrictedSet) || true` →
  implement as: read allowed unless (poster == reader && commenter !=
  reader && restricted) — keep the rule explicit and tested); restricted
  users' DMs to you enter Message Requests even if `whoCanMessage: everyone`.
- **Hide post** (F0.1) and **Hide comment** (post owner hides a comment →
  visible only to its author; field `hiddenFor` array ≤ 3 uids on the comment
  doc, read rule: `!(resource.data.hiddenFor has request.auth.uid)`).
- **Controls** in Settings → Privacy: who can message (exists) · who can
  comment (exists) · **who can mention me** (everyone/followers/nobody —
  enforced where mentions render: mentions from non-followers still work but
  do not notify when set to followers) · **who can see my stories**
  (`stories.whoCanSee`, P4).
- **Blocking** (exists) + report flows (exist) stay unchanged.
- TESTS (3 accounts): mute hides posts from feed only for the muter; restrict
  makes A's comment on B's post invisible to C but visible to A; hide comment
  behaves per spec; each rule negative-tested from the console.

**X.2 — Account & security**
- **2FA (TOTP)** — Firebase web `enrollFactor`/`enableFactor`: Settings →
  Security → Set up two-factor (QR/secret, confirm code), disable (re-auth).
  This is real and works — move it out of "Not built yet".
- **Change password** (re-auth + `updatePassword`) and **change email**
  (re-auth + `updateEmail` + re-verification) in Settings → Account.
- **Active sessions:** not possible in Firebase Web — the honest note stays.
- **Phone number** field on profile (self-reported, displayed on business
  profiles via the public phone rule) — no SMS auth in scope.

**X.3 — Settings completeness**
- Add: Security section (2FA, password, email), Privacy additions (X.1),
  Notifications categories incl. Circles/Business/System. Keep the existing
  honest "Not built yet" panel — it now lists only: language/region, data
  export, email digest frequency, active sessions.

**X.4 — Admin panel extensions**
- Tabs (per P6): Circles (verify, remove — removal soft: `banned: true` hides
  it everywhere, data kept), Products (remove), Businesses (verify),
  X Plus (grant/revoke). Stats tab gains: conversations, messages, circles,
  products, X Plus users. **System errors: not possible** in a
  serverless-static architecture — the honest note says so (client errors
  console-only).
- TESTS: each admin action works from the UI and the same action from the
  console is allowed only for admins (denied for a regular user).

---

## 8. Notification taxonomy (full)

| Kind | Trigger (real event) | Category | Destination route |
| --- | --- | --- | --- |
| like, reaction | post reaction | Likes | `#/post/{id}` |
| comment, reply | comment / reply | Comments | `#/post/{id}` |
| follow | new follower | Followers | `#/u/{handle}` |
| followRequest | follow request (private) | Followers | `#/profile` |
| mention | @ you (respecting mention control) | Mentions | `#/post/{id}` |
| repost | your post reposted | Mentions | `#/post/{id}` |
| message | DM (incl. pending) | Messages | `#/messages/{cid}` |
| mediaLike, mediaComment | profile photo | Profile & stories | `#/u/{handle}?media={id}` |
| story | someone reacted to / replied to your story | Profile & stories | `#/stories/{id}` |
| gift, sticker, live | live events | Live | `#/live/{id}` |
| circleInvite, circleRequest, circleJoined | circle membership | Circles | `#/circle/{handle}` |
| circlePost | approved post in a circle you're in | Circles | `#/post/{id}` |
| circleEvent | new event in a circle you're in | Circles | `#/circle/{handle}` |
| productMessage | listing DM | Business | `#/product/{id}` |
| businessPost | followed business published | Business | `#/post/{id}` |
| trending | your video entered trending (once, flag on doc) | System | `#/video/{id}` |
| reportResolved | your report was actioned (when appropriate) | System | `#/settings` |

Rules: a category switched off in settings → **the notification document is
never created** (enforced at the writer, already the pattern).

---

## 9. Build order & dependencies

```
P0  Feed & post types        F0.1 → F0.2 → F0.3          (unblocks everything)
P1  MVP completion           F1.1 → F1.2 → F1.3 → F1.4
P2  Circles                  F2.1 → F2.2 → F2.3          (uses F0.3 post page)
X.1 Privacy & safety         (build with P3; needs P1 for profile menus)
P3  Connection               F3.1 → F3.2 → F3.3          (needs X.1 for restrict)
P4  Media                    F4.1 → F4.2 → F4.3 → F4.4 → F4.5
P5  Business & Marketplace   F5.1 → F5.2 → F5.3          (needs F3.1 for gated DMs)
P6  AI, X Plus, monetization F6.1 → F6.2 → F6.3
X.2/X.3/X.4  Security, settings, admin extensions  (interleaved as needed)
```

Dependencies to respect: F0.3 (post page) before F2.3 (circlePost
notifications); F3.1 (message requests) before F5.2 (Message Seller);
X.1 before F3.2 (group DMs respect restrict/block); storage `circles` kind
before F2.1; `products` rules before F5.2.

---

## 10. Definition of done

### 10.1 Per feature

- [ ] Acceptance tests (§7 for that feature) pass, **two-account manual
      pass** where the feature is social.
- [ ] `node --check` on every touched module; all named imports exist;
      no circular imports.
- [ ] Every new `where()+orderBy()` query has its composite index in
      `firestore.indexes.json`.
- [ ] Rules negative-tested from the console: a non-owner / non-admin /
      non-member attempt is **denied** (read the actual denial, don't assume).
- [ ] Guest behaviour verified where the screen is public (viewable,
      actions prompt sign-in).
- [ ] Light + dark mode, 320 px and 1440 px viewports, no layout shift.
- [ ] `sw.js` cache bumped; installed PWA picks the change.
- [ ] `CHANGES.md` entry + `README.md` ("What is real today" / "Not
      implemented") updated — the README's honesty contract is part of the
      feature, not paperwork.

### 10.2 Per phase

- [ ] Static server + `curl` 200 on every route asset; `node
      tools/check-brand.mjs` + `python3 tools/build-brand.py --check` still
      green (the brand plate is never touched by feature work).
- [ ] Full two-account social pass: every cross-account interaction in the
      phase's features, refresh in between each step.
- [ ] Rules + indexes deployed: `firebase deploy --only
      firestore:rules,firestore:indexes,storage,hosting` (first deploy of any
      new collection = deploy rules BEFORE the client ships).
- [ ] One clean commit per feature, `CHANGES.md` first line names the
      feature.

---

## 11. Do-not-touch list

1. `js/brand.js` + the logo plate contract + `tools/check-brand.mjs` — the
   plate rule is its own spec; features never re-style logo slots.
2. `js/music.js` licence logic — only reuse-permitting licences attach to
   posts; NC/ND stay "Listen only".
3. `js/storage.js` `strict` mode — a `blob:` URL must never reach Firestore.
4. `docs/FOUNDATION_AUDIT.md` — history, append-only.
5. View counts (2 s playback gate) and sound play counts (20 s gate).
6. Guest browsing semantics (§2.1).
7. The counter rules in `firestore.rules` (bounded increments, `serverTimestamp()`
   comparisons).

---

## Appendix A — quick reference: plan section → phase → spec

| Plan § | Phase | Spec |
| --- | --- | --- |
| 1 Home/feed | P0 | F0.1–F0.3 |
| 2 Profile | P1 | F1.2 |
| 3 Discover | P1 + P2 | F1.1, F1.4, F2.3 |
| 4 Circles | P2 | F2.1–F2.3 |
| 5 Messaging | P3 | F3.1–F3.3 |
| 6 Notifications | P1/P2/P5 | F1.3, F2.3, F5.3 + §8 |
| 7 Stories | P4 | F4.1–F4.2 |
| 8 Xacheus Play | P0/P4 | F0.1, F4.3 |
| 9 Creators | P4 | F4.4–F4.5 |
| 10 Business | P5 | F5.1 |
| 11 Marketplace | P5 | F5.2–F5.3 |
| 12 Xacheus AI | P6 | F6.1 |
| 13 Privacy & safety | X.1 | X.1 |
| 14 Account & security | X.2 | X.2 |
| 15 Settings | X.3 | X.3 |
| 16 Admin | X.4 + P6 | X.4, F6.2 |
| 17 X Plus | P6 | F6.2 |
| 18 Navigation | P0 | §5.1, §5.3 |
| 19 Journey / build order | — | §9 |
