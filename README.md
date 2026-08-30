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
- One `videos` collection for everything: vertical video, camera recordings, and
  photo sets (up to 6) — `mediaType` distinguishes them.
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
- Global search (people, hashtags, posts), trending hashtags, suggested
  creators, tag pages, notifications grouped by category with unread badges,
  per-category mute in Settings, reporting for posts, profiles, comments, media,
  sounds and conversations, plus an admin panel for reports/bans and the
  moderation trail.

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
js/views/*.js         home, profile, mediaViewer, stories, messages, sounds,
                      create, discover, notifications, settings, admin, live,
                      components (shared cards, modals, pickers)
firestore.rules       every collection + subcollection the client touches
storage.rules         owner-scoped writes, public reads, size/type limits
firestore.indexes.json 31 composite indexes matching the queries above
```

Naming note: `videos` is the *posts* collection (it predates photo posts) and
`profileMedia` is the per-profile photo/video gallery. Both are intentional.

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
- **Phase 3** — communities/pages, business accounts, opportunities board.
- **Phase 4** — marketplace discovery from posts.

Built in Zambia 🌍
