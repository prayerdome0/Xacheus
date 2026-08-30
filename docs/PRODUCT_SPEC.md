# Xacheus — Product Specification

**Version 1.0 · 2026-08-30 · status: living document**

This is the specification the codebase is measured against. It exists so that
"is this done?" is answered by a table, not by a feeling. Every feature below
carries one of three states:

| State | Meaning |
| --- | --- |
| ✅ **Built** | Wired to Firestore/Storage today. Writes real documents, survives a refresh and a second device. |
| ⚠️ **Partial** | Real, but with a stated limit (usually a Firestore constraint or a missing deploy). |
| ⛔ **Not built** | Deliberately absent. The UI says so rather than faking it. |

Xacheus's rule: **if it isn't backed by a write, it doesn't ship.** No demo
data, no hardcoded counts, no button that only animates.

---

## 1. Product identity

Xacheus is a **mobile-first social platform built in Zambia**, organised around
short vertical video, photo sets, text posts, licensed music, real-time
messaging and communities (churches, businesses, creatives).

Three things separate it from a Facebook clone:

1. **Everything is real or absent.** A counter is a Firestore counter; an empty
   state is an honest empty state.
2. **Music is licensed.** The catalogue comes from the Internet Archive's
   open-licence audio, and every track shows its licence and attribution.
   Non-reusable licences are marked *Listen only* and cannot be attached to a
   post.
3. **Privacy is enforced in `firestore.rules`, not in CSS.** Private accounts,
   blocks, mutes and "who can message me" are server-side checks.

### Positioning

| | Facebook | X (Twitter) | TikTok | **Xacheus** |
| --- | --- | --- | --- | --- |
| Feed | Algorithmic | Chronological | Algorithmic | **Recency + reactions, with a Following tab** |
| Media | Mixed | Text-led | Video-led | **Video-led, photo sets, text, licensed audio** |
| Music | None | None | Licensed + viral | **Licensed, attributed, listener-visible licence** |
| Commerce | Marketplace | None | Shops | **Planned: Xacheus Marketplace (Phase 4)** |
| Communities | Groups | Communities | None | **Planned: Xacheus Pages (Phase 3)** |

---

## 2. Information architecture

```
HOME ──────────────── #/home
  ├─ Stories tray (24h)
  ├─ For You / Following tabs
  ├─ New-posts pill + pull-to-refresh
  └─ Infinite scroll (10 per page, sentinel-triggered)

EXPLORE ───────────── #/discover
  ├─ Search bar (people, posts, #hashtags, sounds)
  ├─ Recent searches (local, per account, clearable)
  └─ Tabs: Trending posts · Search posts · Trending sounds · People · Hashtags

CREATE ────────────── #/create
  ├─ Video (upload or record, 15–180s, ≤100 MB)
  ├─ Photo set (1–6 images)
  ├─ Text (≤1000 chars)
  ├─ Story toggle (24h)
  └─ Licensed sound picker

MESSAGES ──────────── #/messages · #/dm/{handle} · #/messages/{cid}
  ├─ Conversation list with unread badges + presence
  └─ Thread: text, attachments, typing, read receipts, unsend, reactions

NOTIFICATIONS ─────── #/notifications
  └─ Filters: All · Reactions · Comments · Followers · Mentions · Messages · Live
     Per-item mark read/unread + delete; mark all read

PROFILE ───────────── #/u/{handle} · #/profile
  └─ Tabs: Posts · Photos · Videos · Reposts · Music · Activity · Saved
           · Liked · Followers · Following · About

SAVED ─────────────── #/saved
  ├─ All saved posts
  └─ Collections (create, rename, delete, remove items)

MUSIC ─────────────── #/music · #/sound/{id}
  └─ Library · Discover · Your uploads · Favourites · Recently played

LIVE ──────────────── #/live · #/live/go · #/live/{id}

MENU ──────────────── #/settings · #/admin
```

---

## 3. Database structure

Collections as they exist today. Types are as stored; `ts` is a Firestore
`Timestamp`; `map` denotes a fixed-key object; `↓` marks a subcollection.

### 3.1 Identity

```
users/{uid}
  uid, email, username, usernameLower, displayName, displayNameLower
  photoURL, coverURL, bio, location, website
  role            "user" | "creator" | "business" | "church" | "admin"   (admin-only write)
  verified        bool                                                    (admin-only write)
  banned          bool                                                    (admin-only write)
  private         bool      ← mirrored from prefs.privacy.privateAccount
  prefs { notifications{7 keys}, privacy{whoCanMessage, whoCanComment,
                                         showActivity, showLiked, showSaved,
                                         privateAccount},
          playback{autoplayPreviews, dataSaver, reducedMotion} }
  followersCount, followingCount, videosCount, profileViews
  createdAt, updatedAt
  ↓ likedVideos/{videoId}        { createdAt }
  ↓ savedVideos/{videoId}        { videoId, createdAt, collection }
  ↓ savedCollections/{id}        { name, count, createdAt }
      ↓ items/{videoId}          { videoId, createdAt }
  ↓ postReactions/{videoId}      { reaction }
  ↓ mediaReactions/{mediaId}     { reaction }
  ↓ reposts/{videoId}            { videoId }
  ↓ favoriteSounds/{soundId}
  ↓ playHistory/{soundId}
  ↓ blocks/{blockedUid}          { uid, username, displayName, photoURL, createdAt }
  ↓ mutes/{mutedUid}             { uid, username, displayName, photoURL, createdAt }
  ↓ profileViews/{viewId}        { uid, createdAt }
  ↓ storyViews/{storyId}
```

`usernames/{handle}` — one reservation document per handle (`{ uid, createdAt }`),
which is what makes handles globally unique without a query.

### 3.2 Content

```
videos/{videoId}                    ← the POSTS collection (name is historical)
  uid, username, displayName, photoURL        (denormalised author copy)
  mediaType       "video" | "photo" | "text"
  videoUrl, thumbnailUrl, images[] (≤6), duration, width, height
  caption, captionLower, hashtags[], mentions[]
  soundId, soundTitle, soundUrl, musicSource
  licenceUrl, licenceLabel, sourceUrl, attribution
  likeCount, commentCount, viewCount, shareCount, repostCount
  reactions { love, like, amen, laugh, wow, support }
  isPublic, storagePath, createdAt, updatedAt
  ↓ comments/{cid}
      uid, username, displayName, photoURL, text
      parentId, replyToUsername, likeCount, replyCount, createdAt
      ↓ likes/{likerUid}

profileMedia/{mediaId}              ← avatar / cover / photo gallery history
  uid, username, kind ("avatar"|"cover"|"photo"), url, storagePath, caption
  isCurrent, likeCount, commentCount, shareCount, viewCount, reactions{}, createdAt
  ↓ comments, ↓ likes

stories/{storyId}                   ← 24h, expiry enforced by rules
  uid, username, kind, url, storagePath, text, link, createdAt, expiresAt
  ↓ views/{viewerUid}, ↓ reactions/{reactorUid}

reposts/{repostId}                  uid, videoId, note, createdAt
sounds/{soundId}                    title, artist, artistUid, genre, duration,
                                    audioUrl, storagePath, external, sourceIdentifier,
                                    licenceUrl, licenceLabel, useCount, playCount
hashtags/{tag}                      tag, count, lastUsedAt
```

### 3.3 Social graph, messaging, moderation

```
follows/{uid}/following/{targetUid}     { uid, username, displayName, photoURL, createdAt }
follows/{uid}/followers/{followerUid}   { … }
followRequests/{ownerUid}/requests/{requesterUid}
                                        { uid, username, displayName, photoURL,
                                          status "pending"|"accepted", createdAt }
presence/{uid}                          { online, lastSeen }   (45s heartbeat, 75s window)

conversations/{cid}                     cid = sorted(uidA, uidB).join("__")
  participants[2], lastMessage, lastMessageAt, lastMessageSenderUid
  unreadCount { uidA: n, uidB: n }, typing { uid: ts }, hiddenBy { uid: ts }
  ↓ messages/{mid}
      senderUid, text, attachment { kind, url, name, size, storagePath }
      readBy { uid: ts }, reactions { uid: emoji }, deleted, createdAt

notifications/{nid}
  toUid, fromUid, fromName, fromUsername, fromPhoto, type, read
  videoId | mediaId | conversationId | commentId, text, thumbnailUrl, createdAt

reports/{id}          reporterUid/Name/Username, targetType, targetId,
                      targetOwnerUid, reason, details, status, resolvedBy, resolvedAt
lives/{liveId}        + ↓ segments, ↓ chat, ↓ gifts, ↓ reactions
```

### 3.4 Indexes

`firestore.indexes.json` holds **32** composite indexes — one for every
non-trivial query the client runs (feed by author, by `mediaType`, trending by
`likeCount`, DM threads, follow requests, stories by expiry, notifications by
recipient, and now `captionLower` + `createdAt` for post search).

### 3.5 Storage layout

`uploads/{uid}/{kind}/{file}` where `kind` ∈ `videos · images · audio ·
thumbnails · stories · chat · documents`. Size ceilings: image 10 MB, video
100 MB, audio 40 MB, chat attachment 30 MB. Writes are owner-scoped to the
`{uid}` in the path; reads are public; deletes are owner-only.

---

## 4. Page-by-page functionality

### 4.1 Auth — `#/` (overlay)

| Capability | State | Notes |
| --- | --- | --- |
| Email + password sign-up / sign-in | ✅ | `friendlyAuthError()` maps every Firebase code to plain language. |
| Google sign-in | ✅ | New Google users pick a handle + role before the profile is created. |
| Handle reservation | ✅ | `usernames/{handle}`, 3–20 chars, lowercase, unique. |
| Email verification | ✅ | Resend from Settings. |
| Password reset | ✅ | |
| Delete account | ✅ | Re-auth (password or Google popup) → `purgeUserData` → `deleteUser`. |
| Guest browsing | ✅ | Rules allow public reads; interactions prompt sign-in. |

### 4.2 Home — `#/home`

| Capability | State | Notes |
| --- | --- | --- |
| For You / Following | ✅ | Recency + reaction ordering — explicitly *not* a model. |
| Autoplay on scroll | ✅ | IntersectionObserver at ≥0.7 visibility; respects Data saver. |
| Stories tray | ✅ | 24h, progress bars, tap-nav, hold-pause, viewer list, reply → real DM. |
| **New-posts pill** | ✅ | Live snapshots hold new posts while you're scrolled down; the pill releases them. |
| **Pull-to-refresh** | ✅ | Touch-only, armed at scroll-top, 70px threshold. |
| **Infinite scroll** | ✅ | Sentinel 400px ahead; the button remains for no-IO / a11y. |
| View counts | ✅ | Counted only after 2s of continuous playback; guests don't count. |
| Muted authors filtered | ✅ | Their posts and stories are dropped client-side (Firestore can't express "author not in my mutes" with `orderBy`). |

### 4.3 Create — `#/create`

| Capability | State | Notes |
| --- | --- | --- |
| Video upload / camera record | ✅ | Progress bar, real client-side poster frame. |
| Photo set (1–6) | ✅ | Preview before posting; swipeable carousel; dots. |
| **Text post** | ✅ | ≤1000 chars, hashtags + mentions linked. |
| Story toggle | ✅ | Also posts to `stories`, expires in 24h. |
| Licensed sound picker | ✅ | Reusable licences only; NC/ND are *Listen only*. |
| Deep link `#/create?tab=photos` | ✅ | Honours `?tab=photos` and `?tab=text`. |

### 4.4 Post card (shared component)

| Capability | State | Notes |
| --- | --- | --- |
| React (6-reaction set) | ✅ | Tap = toggle, hold/right-click = picker. |
| Comment / reply / like a comment | ✅ | Threaded, `parentId` + `replyToUsername`. |
| Delete own comment | ✅ | Author or post owner or admin. |
| Repost | ✅ | Appears on your profile with a byline. |
| Save / collect | ✅ | |
| Share (link, DM, surfaces) | ✅ | Increments `shareCount`. |
| Report | ✅ | One open report per user per target. |
| Follow from card | ✅ | |
| **Edit your own post** | ✅ | Caption (and derived hashtags/mentions) — author-only in rules. |
| **Delete your own post** | ✅ | Removes the post, its Storage object and counters. |

### 4.5 Profile — `#/u/{handle}`

| Capability | State | Notes |
| --- | --- | --- |
| Avatar + cover, bio, location, website | ✅ | |
| Follower / following / post counts | ✅ | Computed from real documents. |
| Tabs: Posts · Photos · Videos · Reposts · Music · Activity · Saved · Liked · Followers · Following · About | ✅ | |
| Avatar/cover open in the full-screen viewer | ✅ | React, comment, reply, share, delete own. |
| Private accounts | ✅ | Content locked by rules; follows become requests. |
| Block | ✅ | Ends the connection both ways; enforced server-side. |
| **Mute** | ✅ | Hides their posts + notifications without unfollowing. |
| Report | ✅ | |
| Profile view history | ✅ | Once per visitor per day, visible only to the owner. |
| Verification request | ⛔ | Badge is admin-granted today; see Phase 3. |

### 4.6 Explore / Search — `#/discover`

| Capability | State | Notes |
| --- | --- | --- |
| Search people | ✅ | Prefix match on `username` and `displayNameLower`. |
| **Search posts** | ⚠️ | Prefix match on `captionLower` **and** exact `#hashtag`. Not full-text: Firestore has no substring search, and the UI says so. |
| Search sounds | ✅ | Local library + live Internet Archive catalogue. |
| Trending hashtags | ✅ | |
| Suggested users | ✅ | Sidebar rail + Discover. |
| **Recent searches** | ✅ | localStorage, per account, 8 max, clearable. |
| Search businesses / pages | ⛔ | No Page entity yet — Phase 3. |

### 4.7 Notifications — `#/notifications`

| Capability | State | Notes |
| --- | --- | --- |
| Like, comment, reply, follow, follow-request, mention, repost, message, live, gift, story reply | ✅ | Written in the same batch as the action. |
| Category filters + unread badges | ✅ | |
| Accept / decline follow requests inline | ✅ | |
| Mark all read · delete one | ✅ | |
| **Mark one read / unread** | ✅ | `read` is the only recipient-writable field. |
| Per-category mute | ✅ | Checked on the *sender's* write, so it applies on every device. |
| Web push | ⛔ | In-app badges only. |

### 4.8 Messaging — `#/messages`

| Capability | State | Notes |
| --- | --- | --- |
| 1:1 threads | ✅ | Deterministic `cid`, Firestore-only (no optimistic bubbles). |
| Online/offline presence | ✅ | 45s heartbeat, 75s window. |
| Typing indicator | ✅ | Real timestamped field. |
| Read receipts | ✅ | Per-message `readBy` + per-thread unread counters. |
| Attachments (photo, video, audio, file ≤30 MB) | ✅ | Resumable uploads. |
| Tapback reactions, unsend, hide thread, report, block | ✅ | |
| Search within the loaded window | ⚠️ | Filters what's loaded, not the whole history. |
| Group chats | ⛔ | |
| Audio/video calls | ⛔ | |

### 4.9 Saved — `#/saved`

| Capability | State | Notes |
| --- | --- | --- |
| All saved posts | ✅ | Realtime. |
| Collections (create / rename / delete / remove item) | ✅ | |
| Add to collection from a post | ⚠️ | Available from the share sheet; not yet a card action. |

### 4.10 Settings — `#/settings`

Account · Appearance (dark / light / system) · Notification categories ·
Privacy (private account, who can message, who can comment, activity/liked/saved
visibility) · Playback & data · **Muted accounts** · Blocked accounts · Sign out
· Delete account.

Stated as not built on the page itself: language/region, data export,
two-factor sign-in, email digests.

### 4.11 Admin — `#/admin`

Users (role, verify, ban) · Videos · Comments (collection-group across all
posts) · Reports (resolve / reopen, link to target) · Sounds · Platform stats.
Gated by `role === "admin"` in the UI **and** in the rules.

---

## 5. Security model

Principles, in order of importance:

1. **Guests read, members write, banned accounts write nothing.** `canWrite()`
   gates every content write.
2. **Owners edit their own content.** Counters move in steps of ±1
   (`counterStepsOk`), so no client can invent a follower or like count.
3. **Field whitelists, not document whitelists.** An author may update
   `caption, captionLower, hashtags, mentions, thumbnailUrl, sound*, licence*,
   isPublic, updatedAt` — and nothing else.
4. **`role`, `verified` and `banned` are never client-writable.**
5. **Privacy is server-side.** `canViewOwnersContent()` checks
   `private` + the follow graph; `blockedEither()` is consulted on DMs,
   comments, reactions, story views and follow requests.
6. **Shape checks on writes.** Lengths, enums and key sets are validated in
   rules so a tampered tab can't turn the database into a dumping ground.
7. **Mute is a notification rule, not just a filter** — checked in
   `notifyUser()`, so it holds on every device, and applied to the feed and the
   story tray.

Known honest limits, stated rather than papered over:

- Muted-author filtering happens **client-side** in the feed; Firestore cannot
  combine `where(uid, not-in, …)` with `orderBy(createdAt)` in one indexed
  query. The mute is still enforced server-side for notifications.
- Rules are **not compiler-verified in this repo** — `firebase-tools` has no
  offline emulator here. They are written conservatively and must be validated
  by deploying and exercising the app.
- There is no server-side rate limiting; spam protection is currently
  one-open-report-per-target plus client-side guards. Real abuse control needs
  Cloud Functions (Phase 5).

---

## 6. Roadmap

### Phase 1–2 — Core (done)
Auth, profiles + roles, video/photo/text posts, likes, comments, follows,
notifications, DMs, stories, licensed music, moderation, hardened rules.

### Phase 3 — Xacheus Pages (designed, not built)

A Page is a first-class entity owned by an account, so a church, business or
community can have admins and a presence distinct from a personal profile.

```
pages/{pageId}
  ownerUid, handle (unique, reserved in pageHandles/{handle})
  name, category  "church"|"business"|"organization"|"community"|"public_figure"
  about, avatarUrl, coverUrl, location, website, phone, whatsapp
  verified, followersCount, postsCount, rating { sum, count }
  hours { mon: "08:00-17:00", … }, serviceArea
  createdAt
  ↓ admins/{uid}     { role "owner"|"editor", addedAt }
  ↓ followers/{uid}  { createdAt }
```

Posts gain an optional `pageId`; a post authored **as** a page carries
`authorType: "page"` and `pageId`, and the profile tab for a page reads
`videos where pageId == …`. Verification becomes a request flow:

```
verificationRequests/{id}
  uid, pageId?, category, reason, links[], documentUrl (Storage),
  status "pending"|"approved"|"declined", reviewedBy, reviewedAt, createdAt
```

### Phase 4 — Xacheus Marketplace (designed, not built)

```
listings/{listingId}
  pageId, sellerUid, title, description, price { amount, currency "ZMW" },
  negotiable, category, condition, images[], location, status "active"|"sold"|"hidden",
  createdAt, updatedAt
  ↓ inquiries/{id}       fromUid, message, createdAt  (→ opens a real DM thread)
pageReviews/{reviewId}
  pageId, authorUid, rating 1-5, text, reply { text, at }, createdAt
```

Business pages get **Contact** (WhatsApp / call / DM), **reviews with an
owner reply**, and **business posts** that surface in the feed like any other
post. Payments stay out of scope until there is a payment provider.

### Phase 5 — Creator tools & platform hardening (designed, not built)

- **Analytics**: `postStats/{videoId}` (views, watch-time, reactions, comments,
  shares, saves) written by a Cloud Function on the existing counter writes, so
  creators get real numbers without a second client write per event.
- **Audience**: follower growth, top posts, best posting times.
- **Server-side validation**: move notification fan-out, follow counters and
  report triage into Cloud Functions; add rate limiting and a spam classifier.
- **Push notifications** (FCM) and group conversations.

---

## 7. Non-goals

Stated so nobody mistakes them for gaps: full-text search across the whole
corpus, a machine-learning feed ranker, video effects/trimming, audio or video
calls, fiat payments, and cross-posting to other networks.

---

## 8. Definition of done

A feature ships when all five are true:

1. It writes to (or reads from) Firestore/Storage — nothing is local-only
   unless the UI says it is.
2. It survives a refresh **and** a sign-in on a second device.
3. `firestore.rules` and `storage.rules` allow the write and deny the wrong
   actor, and any needed composite index is in `firestore.indexes.json`.
4. Loading, empty and error states all exist.
5. It is listed in this document with the correct state.
