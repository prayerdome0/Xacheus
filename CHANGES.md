# Phase 2 — profiles, media, stories, messaging, licensed music

## Date: 2026-08-30

Everything below is wired to Firestore/Storage. No placeholder data was added;
the curated "free sounds" fallback list from Phase 1 was **deleted**, because it
displayed songs the app could not license or count.

### Foundation (audited and rewritten first)
- `docs/FOUNDATION_AUDIT.md` — what the foundation actually looked like, what was
  broken, and the schema/collection decisions the rest of the app now follows.
- `firestore.rules` — rewritten to match the client exactly: per-collection
  whitelists, `serverTimestamp()` fields compared against `request.time`,
  owner-only subcollections (`mediaReactions`, `postReactions`, `likedVideos`,
  `savedVideos`, `savedCollections`, `blocks`, `presence`, `storyViews`,
  `profileViews`, `playHistory`, `favoriteSounds`), participant-only DM reads,
  `stories` expiry enforced by rules, follow-request documents, repost pair
  writes, and counter increments bounded to sane ranges.
- `storage.rules` — owner-scoped `uploads/{uid}/{kind}/…` writes with content-type
  and size ceilings (image 10 MB, video 100 MB, audio 40 MB, chat attachment
  30 MB), public read, delete restricted to the owner's own prefix.
- `firestore.indexes.json` — 31 composite indexes, one per non-trivial query in
  `js/data.js` / `js/social.js` (verified by extracting every `query(...)` from
  the source and diffing against the file).
- `js/data.js` — batch/transaction correctness (`batch.set(..., {merge:true})`,
  500-op chunking, no cross-parent subcollection queries), comment threads gain
  `parentId`/`replyToUsername`/`likeCount`/`replyCount`, `bumpVideoShare`,
  `bumpVideoView`, `getLikedVideos`, `watchConversation`, `reactToMessage`,
  provenance fields on `createVideo`, and username propagation on rename.
- `js/social.js` — reaction state as the source of truth, `DEFAULT_PREFS`
  (`notifications`, `privacy`, `playback`) validated on write, `canMessage` /
  `canComment` / `getAccessState` gates, blocks, presence, typing, follow
  requests, stories, profile media + comments + replies, reposts, saved
  collections, activity, `removeFollower`, and a fixed `savePrefs` (it was about
  to throw on the `playback` group it never built).

### Profiles
- `js/views/profile.js` rewritten: cover + avatar (both tappable → full-screen
  media viewer), stats, follow/request-follow/cancel/accept flow, message button
  gated by privacy + blocking, share/report/block/mute menu, eleven tabs,
  private-account lock panel, realtime repaints (`watchProfile`,
  `watchUserVideos`, `watchProfileMedia`, `watchSavedVideos`, `watchMyReposts`,
  `watchPresence`, `watchFollowRequests`) all torn down on unmount, edit-profile
  modal (avatar, cover, name, bio, links, location, handle change, private
  toggle), media uploader for photos/covers, follow-requests inbox.
- `js/views/mediaViewer.js` — full-screen viewer for any `profileMedia` item with
  reactions, comments, threaded replies, comment likes, own-comment delete,
  share, caption editing, set-as-current, delete, and honest "not in your
  gallery" synthetic mode for a bare avatar/cover URL.
- `js/views/stories.js` — story tray (seen/unseen rings derived from a real
  `users/{uid}/storyViews` read), viewer with per-story progress, 5 s photo timer
  or video-end advance, tap-thirds nav, hold-to-pause, keyboard nav, reactions
  (`reactToStory`), viewer list, owner delete, and a reply box that sends a real
  DM; composer uploads through `uploadStoryMedia` + `addStory`.

### Messaging
- `js/views/messages.js` rewritten: inbox with realtime unread badges, presence
  dots, follow-request panel, new-chat finder, hide/restore/report; thread view
  with realtime bubbles, date grouping, typing indicator, presence label,
  read receipts (single tick = sent, double tick = the other side wrote a
  `readBy` stamp), attachments with progress, image expansion, audio/video via
  the global player, tapback reactions, unsend, per-message report, block,
  and in-thread search.

### Music
- `js/music.js` — Internet Archive client: `advancedsearch.php` + `/metadata/`
  with JSONP fallback, LRU + 30-minute cache, licence allow-list, mood presets,
  seed items, `describeLicence`/`attributionLine`/`trackToSoundDoc`.
- `js/player.js` — the shared dock (queue, shuffle/repeat, Media Session,
  shortcuts, restore, licence line, 20-second play attribution).
- `js/views/sounds.js` — `#/music` with Library / Discover / Your uploads /
  Favourites / Recently played, real per-row counts, licence chips on every
  catalogue row, "Listen only" for NC/ND items, import-then-attach flow.

### Composer, settings, shell
- `js/views/create.js` — photo posts, video upload/record, story opt-in on both,
  sound picker backed by the real library plus live catalogue search (no
  per-row `<audio controls>` any more; preview goes through the player).
- `js/views/settings.js` — notification categories, privacy (private account,
  who-can-message, who-can-comment, show activity/saved/liked), playback prefs
  that actually change behaviour (feed autoplay, `preload`, player options),
  blocked-accounts list with unblock, and an on-screen list of what isn't built.
- `js/app.js` — routes `#/music`, `#/media/{id}`, `?tab=`/`?media=` params;
  presence heartbeat + honest offline on `pagehide`; notification badge watcher;
  prefs hydration; `mountPlayer()`; `ctx.refreshVideoCounts` / `ctx.openMedia` /
  `ctx.refreshStories`.
- `js/views/home.js` — story tray above the feed, tap-to-play when autoplay is
  off, data-saver preload handling, in-place counter patches after modal actions.
- `styles.css` — ~800 lines for the new surfaces (profile hero, tabs, grids,
  activity, stories, media viewer, inbox, chat bubbles, sound rows, catalogue
  cards, player dock, switches) plus light-theme and mobile rules.
- `sw.js` — cache bumped to `xacheus-video-v8`.

### Verification done in this environment
- `node --check` on every module; a named-import resolver run over `js/**`
  (caught three fatal import mistakes, all fixed); a "called but not imported"
  pass (caught `getProfile` in the share sheet); static HTML/asset fetch smoke
  test through a local server; index heuristic over every `query(...)` vs
  `firestore.indexes.json`.
- Not verifiable here: Firestore/Storage rule compilation and real browser
  behaviour. Deploy rules/indexes and click through the flows in
  `docs/FOUNDATION_AUDIT.md` → "Manual pass".

---

# Firebase Authentication Fixes and Real Logo Implementation

## Date: 2026-08-29

## Changes Made

### 1. New Professional Logo System

#### SVG Logo (`assets/icon.svg`)
- **Previous**: Generic gradient rectangle with a play button icon
- **New**: Distinctive "X" logo representing Xacheus on a purple-to-pink gradient background
- Features:
  - Circular gradient background using brand colors (#7c5cff to #ff4d8d)
  - Bold white "X" shape made from two diagonal rectangles
  - Small purple play button in the center to indicate video platform
  - Proper SVG structure with comments and accessibility attributes

#### PNG Icons (`assets/icon-192.png`, `assets/icon-512.png`)
- **Previous**: Placeholder PNG icons (9.8KB and 13.6KB)
- **New**: High-quality generated PNG icons (1.2MB and 1.3MB)
- Features:
  - Professional design matching the SVG logo
  - Proper dimensions (192x192 and 512x512)
  - Suitable for app icons on all platforms

### 2. Enhanced Authentication Error Handling (`js/auth.js`)

#### Added Error Messages
Added 10 new Firebase Auth error codes to the MESSAGES object:
- `auth/invalid-verification-code`
- `auth/invalid-verification-id`
- `auth/app-deleted`
- `auth/app-not-authorized`
- `auth/argument-error`
- `auth/invalid-api-key`
- `auth/user-disabled`
- `auth/user-token-expired`
- `auth/requires-recent-login`

#### Improved `friendlyAuthError()` Function
- Better detection of network and offline errors
- Enhanced Firestore-specific error handling
- Added handling for `firestore/permission-denied` code
- Extracts error codes from FirebaseError messages
- More specific error messages for different scenarios

#### Google Sign-In Improvements
- More robust new user detection with multiple checks:
  - Checks for missing `lastSignInTime`
  - Compares `creationTime` with `lastSignInTime`
  - Handles edge cases with recent creation times
- Added null safety with `.catch(() => null)` for profile loading
- Better error logging with `console.warn()`

#### Signup Flow Enhancements
- Added proper error logging for display name updates
- Improved email verification flow:
  - Wrapped in try-catch to prevent signup failure if verification email fails
  - Still shows verification message to user
- Added error logging for signup failures

#### Login Flow Improvements
- Added basic email validation (checks for @ and .)
- Added error logging for login failures

#### Password Reset Improvements
- Enhanced email validation
- Security improvement: Doesn't reveal if email exists in system
- For `auth/user-not-found`, shows generic message instead of error
- More informative success message

#### Profile Update Improvements
- Better error handling with proper error propagation
- Added console warnings for failed updates
- Maintains immutability of role for non-admins

### 3. Files Modified

1. **assets/icon.svg** - New professional logo
2. **assets/icon-192.png** - New high-quality 192x192 icon
3. **assets/icon-512.png** - New high-quality 512x512 icon
4. **js/auth.js** - Enhanced authentication with better error handling

### 4. Testing

All changes have been validated:
- No syntax errors in JavaScript files
- SVG is valid and well-formed
- PNG files are properly sized and formatted
- All logo references in HTML and CSS remain unchanged and compatible

### 5. Brand Consistency

The new logo maintains brand consistency:
- Uses the existing brand colors (#7c5cff and #ff4d8d)
- Fits within the existing styling framework
- Works with all existing logo references in:
  - `index.html` (favicon, boot screen)
  - `js/app.js` (topbar, sidebar)
  - `js/auth.js` (auth overlay)
  - `manifest.json` (PWA icons)

## Impact

### User Experience
- More professional and distinctive app icon
- Better error messages for all authentication scenarios
- More robust handling of edge cases
- Improved security for password reset flow

### Developer Experience
- Better error logging for debugging
- More comprehensive error handling
- Clearer code comments

### Performance
- SVG remains lightweight (788 bytes)
- PNG files are larger but provide better quality for app icons
- No performance impact on authentication flow

## Backward Compatibility

All changes are backward compatible:
- Logo files maintain the same names and locations
- JavaScript changes only enhance existing functionality
- No breaking changes to the API or user flow

# Xacheus — Production Upgrade (Firebase Storage, Moderation, Branding)

## Date: 2026-08-30

## What changed

### 1. Media moved from Cloudinary to Firebase Storage
- New `js/storage.js`: `uploadImage` / `uploadVideo` / `uploadAudio` / `removeObject`.
- All call sites (create video/photo, profile avatar/cover, sounds, live segments/posters) now upload to Firebase Storage under `uploads/{uid}/{kind}/{file}`.
- `uploadVideo` now generates a real client-side poster frame and uploads it to `uploads/{uid}/thumbnails`, so video cards always have a thumbnail.
- Removed `js/cloudinary.js`; `cloudinaryPublicId` field replaced by `storagePath`.
- New `storage.rules` (production): public read, owner-scoped writes matched by the uid in the path, content-type + size limits. `firebase.json` now targets `storage`.

### 2. Branding uses only logo.png / logo1.png
- Removed all text wordmark branding from the topbar (`brand-text` span removed, replaced by the `logo1.png` wordmark image).
- Boot screen, sidebar, auth hero and social preview image now use `assets/logo.png` (square mark) and `assets/logo1.png` (wordmark).
- The SVG `content: url(...)` override in `.brand-logo` was removed so the element uses its real `src`.
- Added optimized web copies: `assets/logo.png` (320×320) and `assets/logo1.png` (768×284). Root `logo.png`/`logo1.png` are ignored by hosting.

### 3. Content reporting + admin moderation
- **Report** actions added to every video card, profile page and sound detail (new reusable `openReportModal` in `js/views/components.js`).
- Reports are written to `reports/{id}` with a one-open-report-per-user-per-target guard (`js/data.js` `submitReport`).
- Admin panel expanded (`js/views/admin.js`): Users (role, verify, **ban/unban**), Videos, **Comments** (cross-video collection-group + delete), **Reports** (review/resolve/reopen/delete), Sounds, **Stats** (platform counts).
- Firestore rules gained `canWrite`/`isBanned` so **banned accounts cannot post, comment, follow, notify, go live or report**; the `reports` collection is create-by-user, admin-read/resolvable.
- Added `storage.rules` and wired `firebase deploy --only firestore:rules,firestore:indexes,storage,hosting`.

### 4. Upload hardening
- Client-side file validation (type + size) added to avatar/cover and kept for video/photo/sound uploads.
- `uploadImage` now defaults to `strict: true` so a failed upload can never persist a `blob:` URL.
- Deleting a video or sound also best-effort removes its media object from Storage.

## Logo visibility — the brand plate

The reported bug: the logo sat on backgrounds that swallowed it (navy ink on the
dark app shell in the top bar, on profile covers, in the sidebar, on the auth
hero). Requirement: dark logo → light background, light logo → dark background,
everywhere, consistently.

### Rule, not colour-per-page
- The plate is **measured from the artwork** instead of being picked per screen,
  so a new logo file automatically gets the right plate. `js/brand.js` samples
  the image on a canvas, separates ink from background (the artwork's own border
  defines the matte — a mostly-unpainted border means the file is already
  ink-on-transparent), averages the ink's WCAG relative luminance, and picks:
  `inkLum < 0.55` → light plate `#ffffff`, else dark plate `#05060a`.
- Both pairings were verified against the actual artwork: **16.77:1** (navy ink
  on white) and **17.15:1** (light build on near-black); the inverted pairings
  are ~1.2:1, i.e. invisible. All above WCAG AA and AAA for a logo.
- A mid-tone logo whose luminance sits between the two plates would otherwise land
  on a low-contrast surface, so `plateForLuminance()` falls back to whichever plate
  reads better when the ruled one cannot reach 3:1. `tools/plate-rule.test.mjs`
  pins that behaviour (`L=0.45` → dark plate; `L=0.3` → still white, because white
  gives exactly 3.0:1 there, which is the legibility floor for a graphic).
- The decision is theme-independent: dark mode and light mode both show the same
  plate, because the plate is the logo's own surface, not the page's.

### Assets (new)
- `assets/logo-wordmark.png` / `assets/logo-wordmark-dark.png` — 702×149,
  transparent ink in the two brand colours, produced by `tools/build-brand.py`.
  The source PNGs (`logo.png`, `logo1.png`) ship as ink over a ~27 % alpha noise
  wash, which is exactly what made them look like a gray rectangle when dropped
  on a solid background; the wash is now stripped at build time.
- `assets/brand-card.png` — 1200×630 link-preview card with the plate baked in
  (social previews cannot run CSS). `og:image` / `twitter:image` now point here
  instead of at `assets/logo1.png`.
- PWA icons and favicons were measured too: `icon-192/512`, the maskables,
  `apple-touch-icon` and the favicon PNGs are already navy ink on white, i.e.
  already on the correct plate — nothing was regenerated. `assets/icon.svg`
  (transparent ink) and `assets/icon-dark.svg` are the two runtime variants.
- `manifest.json`: the `assets/logo.png` icon entry was removed (raw artwork with
  a translucent wash is not a PWA icon; `icon-192/512` are), and
  `background_color` became `#ffffff` so the install splash puts the logo on its
  measured plate instead of floating a white square on `#0a0b12`. `theme_color`
  stays `#0a0b12` (that colours browser chrome, not the logo).

### Tooling + runtime (new)
- `tools/build-brand.py` — stdlib-only PNG read/write (no Pillow in this repo's
  environment), does the wash removal, trim, ink snap and luminance report;
  `--check` measures and **fails if any artwork drops below 4.5:1 on its chosen
  plate, or if the other plate would read better** (catches inverted logic).
- `tools/check-brand.mjs` — structural guard: no bare `<img src="assets/logo…">`
  outside a plate, every slot emits both inks, every `.logo-plate--*` used in JS
  is styled, the pre-paint script is still in `index.html`, and `sw.js` caches
  every brand file the runtime loads.
- `js/brand.js` — `analysePixels` / `measureImage` / `plateForLuminance` /
  `relativeLuminance` / `contrastRatio` / `brandSlotHtml` / `syncBrandSlots` /
  `applyPlate` / `initBrand` / `report`, cached in `localStorage` under
  `xacheus.brand.plate.v1` keyed by file + size so a replaced artwork
  re-measures, and broadcast to `xacheus:brand-plate`. `window.XacheusBrand.use(src)`
  re-measures a candidate file live.
- `index.html` applies the cached plate in an inline script before first paint
  (no FOUC); `app.js` calls `initBrand()` during boot and `syncBrandSlots()`
  after every view render so hand-written markup is corrected too.

### Slots now plated
`index.html` boot + boot-failure, top bar wordmark, sidebar mark, account-menu
row, auth hero, profile cover corner (`.logo-plate--watermark`, the *mark* — a
wordmark's tagline is unreadable at that size), share-preview card, settings
footer. `.logo-plate--*` modifiers own sizing; the watermark keeps a solid
`background` fallback before `color-mix()`.

### Also
- `styles.css`: old brand rules (`.brand-logo`, `.brand-wordmark`, `.brand-lg`,
  fixed-size `.brand-auth-logo`, which was clipping the hero artwork) replaced by
  the plate system.
- `sw.js`: cache bumped `xacheus-video-v8` → `v9`; `SHELL` gained `js/brand.js`
  and lost `assets/logo1.png` (281 KB the runtime never loads), and `js/music.js`,
  `js/player.js`, `js/social.js` were added — they were missing from the shell
  list since Phase 2, so the offline app could not have booted from cache.
- Verified statically here: `node --check` on all modules, import audit, the
  7-case plate harness (black/green/navy ink → white plate, white/pale ink →
  black plate), both new tools, and an HTTP pass over every changed file.
  **Not** yet opened in a browser — that pass is still on the user's side.

## Deployment

```bash
firebase use xacheus-7c98b
firebase deploy --only firestore:rules,firestore:indexes,storage,hosting
```
Enable **Firebase Storage** in the console before first deploy.
