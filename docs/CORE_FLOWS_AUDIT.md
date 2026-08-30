# The ten core flows — audited

**Audited 2026-08-30 on branch `arena/01a05328-xacheus`, from commit `7558147`.**

The brief was: *before adding anything else, make these ten things completely
real* — **Login → Profile → Create Post → Feed → Like → Comment → Follow →
Notifications → Search → Messaging**.

So each flow was traced from the click to the write and back to the snapshot.
This document records what was already real, what was a stub dressed up as a
feature, and what this pass changed. Evidence is a file and a line, not an
impression.

---

## Summary

| # | Flow | Verdict before | After this pass |
| --- | --- | --- | --- |
| 1 | Login | ✅ Real | unchanged |
| 2 | Profile | ✅ Real | + real mute |
| 3 | Create post | ⚠️ Video + photo only | + **text posts**, + `?tab=` deep links |
| 4 | Feed | ⚠️ Live, but no refresh UX | + **new-posts pill, pull-to-refresh, infinite scroll, mute filter** |
| 5 | Like | ✅ Real (6 reactions) | unchanged |
| 6 | Comment | ✅ Real (threaded) | unchanged |
| 7 | Follow | ✅ Real (+ requests, blocks) | unchanged |
| 8 | Notifications | ⚠️ Mark-all-read only | + **per-item read/unread** |
| 9 | Search | ⚠️ Hashtags + handles only | + **post search, recent searches, Posts tab** |
| 10 | Messaging | ✅ Real | unchanged |

Six of the ten were already genuinely real. The four that weren't are the whole
of this pass, plus two bugs found on the way.

---

## 1 · Login — ✅ real

`js/auth.js` → Firebase Auth (`onAuthStateChanged` in `js/app.js:760`) →
`ensureProfile()` writes `users/{uid}` and reserves `usernames/{handle}`.
Every Firebase error code has a plain-language mapping
(`friendlyAuthError`, `js/auth.js:55`). Deleting an account re-authenticates
first (`js/views/settings.js:299`) and then runs `purgeUserData`.

Nothing to change.

## 2 · Profile — ✅ real, mute was a stub

Real: cover, avatar, bio, location, website, role badge, verification mark,
counts computed from documents, eleven deep-linkable tabs, avatar/cover opening
in the full-screen viewer with reactions and threaded comments.

**Found:** the overflow menu offered *"Mute notifications from this account"*
and answered with `toast("Account-wide muting isn't built yet — blocking works
today.")` (`js/views/profile.js:1180`). That is a button advertising a feature
that does not exist, which is exactly what this platform says it doesn't do.

**Fixed:** a real mute.

- `users/{uid}/mutes/{mutedUid}` — added to `js/social.js` (`muteUser`,
  `unmuteUser`, `getMuteList`, `getMutedIds`, `isMuted`) and to
  `firestore.rules` (owner-only, no updates).
- It is enforced in **three** places, because one is not enough: the feed
  filters muted authors (`js/views/home.js`), the story tray drops their
  stories (`listActiveStories(…, { excludeUids })`), and `notifyUser()` refuses
  to write a notification from a muted account (`js/social.js:149`) — so a mute
  holds on every device, not just the tab where you pressed it.
- Settings gained a **Muted accounts** panel next to Blocked
  (`js/views/settings.js`), and the profile menu now explains the difference:
  muting hides posts and notifications, blocking also stops follows and DMs.

**Honest limit:** the feed filter is client-side. Firestore cannot combine
`where("uid", "not-in", myMutes)` with `orderBy("createdAt")` in a single
indexed query, and per-card `get()` calls would cost a read each. The
notification half *is* server-side.

## 3 · Create post — ⚠️ → ✅

Real before: video upload and camera recording (with a real client-side poster
frame), photo sets of 1–6, story toggle, licensed sound picker with licence
gating.

**Found:** no text posts. `createVideo` threw `"Video URL missing"` unless a
video or photos were attached, and the rules mirrored that.

**Fixed:** `mediaType: "text"`.

- `js/data.js` — `createVideo` accepts `text` and requires a caption instead of
  media; `js/views/create.js` gains a ✍️ Text tab with the same
  hashtag/mention handling.
- `js/views/components.js` — a `.video-card.is-text` variant renders the caption
  as the body and drops the audio row (a text post has no sound).
- `firestore.rules` — a third branch on create: `mediaType == 'text'`,
  non-empty caption, and *no* smuggled `videoUrl` or `images`.
- `#/create?tab=photos` (linked from the profile's empty state) used to be
  ignored, landing you on the Video tab. It is now honoured, as is `?tab=text`.

## 4 · Feed — ⚠️ → ✅

Real before: live `onSnapshot` feed, For You / Following, IntersectionObserver
autoplay, view counts after 2s of real playback, data-saver and autoplay
preferences.

**Found:** three gaps between "live" and "feels alive".

1. A new post appeared *underneath* the reader, moving the post they were
   reading. Fixed with a **new-posts pill**: when a snapshot arrives while
   you're scrolled past 400px, the update is held and a pill offers
   *"3 new posts"*; tapping it paints and scrolls to top.
2. **No pull-to-refresh** on touch. Added: armed only at scroll-top, 70px
   threshold, never intercepts carousel or comment scrolling.
3. **"Load more videos" was a button.** Replaced with an IntersectionObserver
   sentinel 400px ahead of the foot; the button remains as the fallback, so it
   still works with JS observers disabled and for keyboard users.

All three are in `js/views/home.js`. Rendering was refactored into one
`renderVideos(root, videos, { force, append })` so the pill, the refresh, the
pager and the live snapshot all paint through the same path — previously the
button pager duplicated the append logic, which is how the two would have
drifted.

## 5 · Like — ✅ real

Six reactions (`love, like, amen, laugh, wow, support`), tap-to-toggle and
hold/right-click for the picker, stored in `users/{uid}/postReactions/{videoId}`
with a `reactions{}` tally on the post. Counters move by ±1 in a transaction and
the rules reject any other step (`counterStepsOk`). Nothing to change.

## 6 · Comment — ✅ real

`videos/{id}/comments` with `parentId` / `replyToUsername` for threading,
per-comment likes, author deletion, `canComment()` enforcing the
`whoCanComment` privacy setting, and blocks checked before a comment is
accepted. Nothing to change.

## 7 · Follow — ✅ real

`follows/{uid}/following` + `followers` written as a pair, follow *requests*
for private accounts with accept/decline from the notification itself, blocks
that sever the connection both ways. Nothing to change.

## 8 · Notifications — ⚠️ → ✅

Real before: written in the same batch as the action, seven category filters
with unread badges, inline accept/decline for follow requests, mark-all-read,
delete one, and per-category muting that is applied on the *sender's* write.

**Found:** no way to mark a single notification **unread**. You could mark
everything read and delete items, but you couldn't leave yourself a reminder.

**Fixed:** a per-item read/unread toggle (`data-act="toggle-read"`) backed by
`setNotificationRead()` in `js/data.js`. The rules already allowed the
recipient to write `read` and only `read`, so no rules change was needed. The
row repaints optimistically and the bell badge follows immediately; a failed
write reverts and re-renders.

## 9 · Search — ⚠️ → ✅

Real before: people by handle/display-name prefix, hashtags, trending tags,
suggested users, and a live Internet Archive sound search.

**Found:**

- `searchVideos` only ever matched a hashtag (`js/data.js:1299`). Searching a
  word found nothing, so "search posts" did not exist in any useful sense.
- No recent searches.

**Fixed:**

- `searchVideos` now unions two real queries: `hashtags array-contains <tag>`
  and a prefix range on a new `captionLower` field. Needs the
  `captionLower ASC, createdAt DESC` composite index, added to
  `firestore.indexes.json`. The Discover UI states the limit plainly — captions
  are matched **from the first word**, because Firestore has no substring
  search and pretending otherwise would be the exact fake this platform avoids.
- **Recent searches**: last 8 terms, per account, in `localStorage`, with a
  Clear button. Deliberately *not* in Firestore — it's a convenience, not
  platform data, and the code says so.
- Discover gained a **Search posts** tab, and the tabs were renamed to match
  what they actually do (*Trending posts*, *People*).

## 10 · Messaging — ✅ real

Deterministic 1:1 conversation ids, Firestore-only bubbles (no optimistic
rows), presence heartbeat, typing indicator, per-message read receipts,
attachments, tapbacks, unsend, hide, report, block. Nothing to change.

---

## Two bugs found on the way

1. **`#/saved` was a dead link.** It is linked from the account menu on every
   profile (`js/views/profile.js:1130`), but the router had no `saved` case —
   so it fell through to `default:` and silently rendered the Home feed. There
   is now a real `#/saved` screen (`js/views/saved.js`) with saved posts and
   collections, registered in the router and added to `AUTH_ROUTES`.
2. **`sw.js` did not precache three modules** — `stories.js`, `mediaViewer.js`
   (and now `saved.js`). An installed PWA could fail on a cold start offline.
   All three added; cache bumped `v12 → v13`.

---

## How this was checked

| Check | Method | Result |
| --- | --- | --- |
| Every module parses | `node --check` on a `.mjs` copy of all 25 modules under `js/` | clean |
| Every named import resolves | script parsing each `import { … } from "./…"` against the target's real `export` list | clean |
| Every module is served | `python3 -m http.server` + `curl` for all of `js/**` | all 200 |
| JSON well-formed | `firestore.indexes.json`, `firebase.json`, `manifest.json` | valid |
| Brand guard | `node tools/check-brand.mjs` | green — 16.77:1 / 17.15:1 |

**Still not verifiable here:** `firestore.rules` cannot be compiled or unit
tested in this sandbox (no offline emulator, and `firebase deploy` stops at an
interactive login). The rules changes in this pass — the `mutes` subcollection,
the `text` post branch, and `captionLower` in the author-update whitelist —
follow the existing patterns exactly, but they must be deployed and exercised
before they are trusted.

## Manual pass after `firebase deploy --only firestore:rules,firestore:indexes,storage,hosting`

1. **Mute** — mute someone from their profile; their posts vanish from your
   feed; have them like your post and confirm no notification arrives; confirm
   they can still follow you and DM you; unmute from Settings.
2. **Text post** — `#/create?tab=text`, post, see it in the feed, edit it from
   its ⋯ menu, check a `#hashtag` in the caption became a link, delete it.
3. **Feed** — scroll down, have a second account post, confirm the pill counts
   it and that tapping it doesn't move the post you were on; pull-to-refresh on
   a touch device; scroll to the bottom and confirm the next page loads without
   a tap.
4. **Post search** — post a caption starting "Sunday service", then search
   "Sunday" on the *Search posts* tab. (Searching "service" will not match —
   that is the documented prefix limit, not a bug.)
5. **Notifications** — mark one read, mark it unread again, confirm the bell
   badge counts it.
6. **Saved** — open `#/saved` from a profile menu, create a collection, add and
   remove a post.
7. **Rules negative test** — from the console, try writing another user's
   `mutes` subcollection and a text post with a `videoUrl`: both must be denied.
