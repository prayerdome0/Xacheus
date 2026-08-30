# Xacheus — Foundation Audit (before social features)

Audited on 2026-08-30 at commit `dea6dad`. Read top-down: `js/firebase.js`,
`js/auth.js`, `js/data.js`, `js/storage.js`, `firestore.rules`, `storage.rules`,
`js/views/*`.

## What is genuinely real (keep)

| Area | Verdict |
| --- | --- |
| Auth (email/password + Google), profile bootstrap, handle reservation | Real Firebase Auth + `users/{uid}` + `usernames/{handle}`. Solid. |
| Media storage | Real Firebase Storage via `js/storage.js` (resumable, progress, `strict` mode so a `blob:` URL can never be persisted). |
| Posts (`videos/{id}` incl. photo posts), likes, saves, comments, follows, view/share counters | Real Firestore reads/writes, owner-scoped in rules. |
| Live streaming, gifts, chat | Real (MediaRecorder → Storage segments → Firestore cursor). |
| DMs (`conversations/{cid}` + `messages/{mid}`) | Real 1:1 storage, deterministic cid, unread counters. |
| Reports + admin moderation | Real `reports/{id}`, admin-gated writes. |

## Gaps and fakes found (fixed in this pass)

1. **Fake music catalogue.** `CURATED_FREE_SOUNDS` in `js/data.js` listed 20
   tracks with invented titles/artists ("Zambian Sunset" by "Zed Beats Free"),
   **fabricated `useCount` numbers** (42, 38, 55 …) and `audioUrl`s pointing at
   `assets.mixkit.co/music/preview/*.mp3`, which now answer `AccessDenied`
   (verified 2026-08-30). Four entries pointed at `soundhelix.com` demo tones.
   → Removed entirely. Replaced with a real, licence-cleared catalogue
   (Internet Archive, JSONP, no API key) plus the user's own uploads.
2. **Profile was a poster grid, not a profile.** No photos tab, no activity, no
   music, no way to view the profile picture, and the "Liked" tab ran a raw
   Firestore query *from the view* with a `// placeholder` comment.
3. **Requirement-1 features that did not exist at all:** profile-picture
   viewing/liking/commenting, photo gallery, profile activity, profile views.
4. **Messaging was text-only.** No attachments, no per-message read receipts,
   no typing indicator, no online/offline presence, and the `message`
   notification type was declared in `firestore.rules` but **never written**.
5. **Rules blocked the features.** `conversations/{cid}/messages/{mid}` required
   non-empty `text` (so attachments were impossible) and was fully immutable
   (so read receipts and unsend were impossible).
6. **`hashtags` collection was write-open:** `allow create, update: if canWrite()`
   with no field validation — any signed-in user could set any tag count to any
   number.
7. **Fake/placeholder UI:** `Settings → Data saver — Coming soon`, and a dead
   `Videos` button on profiles pointing at `#/discover?q=<handle>`.
8. **`js/data.js` `changeUsername`** updated `users/{uid}.username` but not the
   denormalised `username`/`displayName`/`photoURL` copies on the user's own
   videos, comments and profile media — old content kept showing the old handle
   and old avatar forever.
9. **Client-side only privacy.** No blocking, no mute, no report-and-block, and
   nothing enforced in rules — a blocked user could still DM/comment/react.

## Fixes applied in this pass

- `firestore.rules`: new `profileMedia`, `blocks`, `presence`, `stories`
  matches; DM messages accept attachments + `readBy` receipts + unsend;
  `hashtags` writes validated; banned-account guard reused everywhere.
- `storage.rules`: added `stories` + `documents` kinds, per-kind size limits.
- `js/data.js`: profile media (like/react/comment/reply), blocking, presence,
  story API, message attachments/receipts/typing, reposts, profile views,
  `changeUsername` propagation, `markAllNotificationsRead`.
- New modules: `js/music.js` (real catalogue client), `js/player.js`
  (persistent player), `js/views/mediaViewer.js` (profile media viewer).
- Views: profile rebuilt with tabs, messaging upgraded, reactions/reposts on
  posts, stories tray, notification categories, settings that actually save.

---

## How this was checked in a terminal

| Check | Method | Result |
| --- | --- | --- |
| Every module parses | `node --check` on a `.mjs` copy of all of `js/**` | clean |
| Every named import exists | script resolving `import { … } from "./…js"` against the target's `export` list | clean — caught `bumpSoundPlayLocal`, `toggleFollow`/`updateProfile` imported from the wrong module, and `CURATED_FREE_SOUNDS` (deleted) |
| Called-but-not-imported helpers | script comparing call sites with the union of exports of the modules each file imports | clean — caught `getProfile` in the share sheet |
| Static assets served | `python3 -m http.server` + `curl` for every `js/**`, `index.html`, `styles.css`, `sw.js`, `manifest.json`, and each `assets/*` referenced from HTML/CSS | all 200 |
| Indexes cover the queries | script extracting `where(...)`/`orderBy(...)` from every `query(...)` in the client and diffing against `firestore.indexes.json` | no gaps |
| Rules are structurally sound | brace balance + per-path review against each client write | balanced; **not compiler-verified** (see below) |

**Not verifiable in this sandbox:** `firestore.rules` / `storage.rules` cannot be
compiled or unit-tested here — `firebase-tools` has no local emulator/rules parser
available offline and `firebase deploy` stops at an interactive login. The rules
are therefore written conservatively (allow-lists, field whitelists, bounded
counters) and must be validated by deploying them and exercising the app.

## Manual pass (do this after `firebase deploy --only firestore:rules,firestore:indexes,storage,hosting`)

1. **Fresh account** — sign up, pick a handle, land on your profile. Set bio +
   avatar + cover. Reload: all four must survive.
2. **Media viewer** — tap your avatar → full screen; react, comment, reply to
   your comment, like the comment, delete it. Open the same viewer from
   `#/media/{id}` in a second tab (cold link) — it must redirect to your profile
   with the viewer open.
3. **Photos tab** — upload two photos from the Photos tab, mark one "current",
   delete the other; Storage object must be removed with it.
4. **Post + music** — `#/music → Discover`, play a track, "Use in a post" an
   item with a reusable licence, post a video with it. The post's sound line and
   the player dock must both show the real artist and licence; the sound's use
   count and play count must move (plays only after 20 s).
5. **Try to attach a "Listen only" item** — the button must not exist for it.
6. **Second account** — follow, comment, react, repost, DM with a photo, watch
   the ticks go double when the first account opens the thread, unsend, block,
   confirm messaging and commenting are refused, unblock.
7. **Private account** — flip the switch, from account B follow (request), accept
   on A, confirm B then sees the posts and the story tray.
8. **Stories** — post a photo story from the composer, view it as B (reactions +
   reply → real DM), check the viewer list on A, and confirm it is gone from the
   tray after expiry (or delete it).
9. **Notifications + prefs** — like/comment/follow as B; A's bell and Messages
   badges update without a reload. Turn a category off in Settings and repeat:
   the notification must not be created at all.
10. **Rules negative test** — from the console, try writing another user's
    profile or a stranger's `likedVideos`; both must be denied.

11. **Logo plate, both ways** — on every screen the logo appears (top bar,
    sidebar, account menu, auth hero, profile cover corner, share preview,
    settings footer, boot screen, and the installed/PWA splash) it must sit on
    its own light plate, and stay readable in both light and dark mode. Then
    force the other variant from the console — `XacheusBrand.apply({ plate:
    "dark" })` — and confirm the light ink appears on the near-black plate with
    no broken/blank images anywhere, and `XacheusBrand.report()` shows the
    measured `inkLum` plus `measured: true`.
12. **Plate survives a refresh** — reload the profile and the auth screen twice:
    `document.documentElement.dataset.logoPlate` must already be correct in the
    first frame (that is the pre-paint script reading
    `localStorage["xacheus.brand.plate.v1"]`), i.e. no flash of the logo on the
    wrong background. Replacing `assets/logo.png` with a white mark and reloading
    must flip every plate by itself (`XacheusBrand.use("assets/logo.png")` does
    the same on demand), and `node tools/check-brand.mjs` +
    `python3 tools/build-brand.py --check` must stay green.
