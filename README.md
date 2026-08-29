# Xacheus — Short Video Platform (Phase 1)

Xacheus is a **real production-oriented short vertical video platform** (TikTok-style), not a mockup. Built with vanilla JS, Firebase Auth, Firestore and Cloudinary for media.

This is **Phase 1** — real auth, profiles with roles, vertical video feed, Cloudinary uploads, likes, comments, follows, notifications, create (record/upload), captions, hashtags, and a **free sounds system** (no copyrighted YouTube tracks).

---

## Phase 1 Features (Implemented Now)

### Real Authentication
- Email/password + Google sign-in (real Firebase Auth)
- Profiles auto-created in `users/{uid}` with `ensureProfile`
- Roles: `user`, `creator`, `business`, `church`, `admin` (default `user`)
- Handle reservation via `usernames/{handle}` — unique, lowercase, 3-20 chars
- Admin panel visible **only if Firestore `role == "admin"`** (client checks `isAdminProfile`, rules enforce admin-only writes)

### Media — Firebase + Cloudinary
- Cloud name: `dhad95cch`
- Upload preset: `xacheus` (unsigned, no extra folders per instruction)
- Uses `auto` resource type so images, videos, audio all work via same preset
- No secrets in frontend — only cloudName + preset
- `js/cloudinary.js` has:
  - `uploadImage(file)` → URL
  - `uploadVideo(file)` → { url, thumbnailUrl, duration, width, height, publicId }
  - `uploadAudio(file)` → { url, duration }

### Video Feed — No Fake Videos
- Collection `videos/{videoId}` — real Firestore docs only
- Fields: `uid`, `username`, `displayName`, `photoURL`, `videoUrl`, `thumbnailUrl`, `caption`, `hashtags`, `mentions`, `soundId`, `soundTitle`, `soundUrl`, `duration`, `likeCount`, `commentCount`, `viewCount`, `createdAt`
- Vertical feed: full-screen cards, `IntersectionObserver` auto-play when 70% visible, pause others, progress bar
- Right actions: avatar + follow (+), like + count, comment + count, save, share, sound disc
- Bottom: @handle, caption with linked #hashtags/@mentions, sound marquee
- Modes: **For You** (global `createdAt desc`) and **Following** (where `uid in followingIds.slice(0,10)`)
- Pagination via `startAfter(lastDoc)`
- No mock data — empty state if no videos

### Interactions — All Buttons Work
- **Like**: `users/{uid}/likedVideos/{videoId}` + `videos/{id}.likeCount` ±1, notification to owner
- **Save**: `users/{uid}/savedVideos/{videoId}`
- **Comment**: `videos/{videoId}/comments/{cid}` + `commentCount`, notification
- **Follow**: `follows/{uid}/following/{target}` + `follows/{target}/followers/{uid}` + counters, notification
- **Share**: copies link `/#/video/{id}`
- **Mute**: toggles video.muted
- All writes guarded by Firestore rules

### Create — Record or Upload
- `/#/create` — real working page
- Upload: drag-drop or file picker, video/*, ≤100MB, shows preview, duration
- Record: `getUserMedia` + `MediaRecorder`, live preview, timer, 180s max, cancel/stop
- Caption: 0-1000 chars, hashtags/mentions auto-parsed
- Sounds: choose from free library or original audio
- Upload progress bar via XHR `onProgress`
- On submit: `uploadVideo()` → `createVideo()` Firestore doc, then navigate to `/#/home`

### Sounds System — Free Music Only
- Collection `sounds/{soundId}` — `title`, `artist`, `audioUrl`, `useCount`, `isFree`, `isOriginal`, `genre`
- Curated free sounds (royalty-free, not YouTube):
  - Lo-Fi Chill, Afrobeat Vibe, Gospel Uplift, Zambian Sunset, Upbeat Pop — URLs from Pixabay free library
  - If `sounds` collection empty, curated list is returned as fallback
- Trending sounds: `orderBy(useCount desc)`
- Users can upload original sounds via video's own audio (or future audio upload)
- Every time a video uses a sound, `useCount` increments

### Discover
- `/#/discover` — tabs: Trending videos (by `likeCount desc`), Trending sounds, Creators (search users), Hashtags
- Search: `#tag` → videos with `hashtags array-contains`, `@handle` or name → users
- Video grid (3 cols) with like/comment counts, click → `/#/video/{id}`

### Sounds Library
- `/#/sounds` — free music explanation, tabs free/trending/original/all, search, audio preview, link to videos using sound

### Profiles
- `/#/u/{username}` — cover, avatar, role badge, verified, bio, location, website, followers/following/videos/likes counts
- Tabs: Videos (user's videos), Liked (likedVideos), Followers, Following
- Edit profile: avatar/cover via Cloudinary, displayName, handle (with reservation), bio, location, website — role change only via admin

### Notifications / Inbox
- `/#/notifications` — likes, comments, follows, mentions — unread dot, mark read after 1.5s, tabs all/likes/comments/follows

### Admin Panel
- `/#/admin` — visible only if `profile.role == "admin"`
- Tabs: Users (change role, verify/unverify), Videos (delete), Sounds (delete)
- Rules: only admin can change `role`, `verified`, delete any video/sound

### Settings
- Theme: dark/light/system persisted
- Account info, email verification, sign out, delete account with re-auth

---

## Data Model

```
users/{uid}
  - uid, username, displayName, displayNameLower, email, photoURL, coverURL
  - bio, location, website, role (user|creator|business|church|admin), verified
  - followersCount, followingCount, videosCount, likesCount, createdAt, updatedAt
  - likedVideos/{videoId}, savedVideos/{videoId}

usernames/{handle} -> { uid }

videos/{videoId}
  - uid, username, displayName, photoURL
  - videoUrl, thumbnailUrl, caption, hashtags[], mentions[]
  - soundId, soundTitle, soundUrl, duration, width, height, cloudinaryPublicId
  - likeCount, commentCount, viewCount, shareCount, isPublic, createdAt, updatedAt
  - comments/{cid}: uid, username, displayName, photoURL, text, createdAt

sounds/{soundId}
  - title, artist, artistUid, audioUrl, coverUrl, duration, genre, useCount
  - isFree, isOriginal, createdAt, lastUsedAt

follows/{uid}/following/{targetUid}
follows/{uid}/followers/{followerUid}

notifications/{nid}
  - toUid, fromUid, fromName, fromPhoto, fromUsername, type, videoId?, text?, read, createdAt

hashtags/{tag}: count, lastUsedAt
```

---

## Firestore Rules — Strict

- Public read for `users`, `usernames`, `videos`, `sounds`, `hashtags`
- `users` create: must be self, role in [user,creator,business,church] (not admin)
- `users` update: owners can edit profile fields but not role/counters; admin can change role/verified; counters ±1 allowed for follows
- `videos`: create if signedIn and owner, counters start 0; update: owner can edit caption/hashtags/sound, anyone can bump counters; delete owner or admin
- `sounds`: create owner, update owner or counter bump, delete owner/admin
- `follows`: self only
- `notifications`: recipient read only, create if fromUid==auth.uid and toUid!=self
- `opportunities`, `churches`, `products`: admin-only write (future phases)
- No secrets in frontend — all protection in rules

Deploy:
```bash
firebase use xacheus-7c98b
firebase deploy --only firestore:rules,firestore:indexes
```

Indexes in `firestore.indexes.json`:
- videos: uid+createdAt, createdAt, likeCount+createdAt, hashtags contains+createdAt, soundId+createdAt
- sounds: useCount, isFree+useCount
- users: username, displayNameLower
- plus legacy indexes

---

## Run Locally

```bash
npm run dev   # http://0.0.0.0:5173
```

- Enable Email/Password + Google in Firebase Console → Authentication → Sign-in method
- Add preview domains to Authorized domains
- Ensure Cloud Firestore API enabled and database created

---

## Cloudinary

- Cloud: `dhad95cch`
- Preset: `xacheus` unsigned
- Endpoint: `https://api.cloudinary.com/v1_1/dhad95cch/auto/upload`
- No folders per instruction

---

## Roadmap

- **Phase 1 (now)**: Auth, profiles+roles, video feed, Cloudinary, likes/comments/follows/notifications, create (record/upload), sounds (free)
- **Phase 2**: Discover (trending videos/sounds), opportunities (jobs/services posted by admins), churches/communities (sermons/updates)
- **Phase 3**: Business accounts, advertising
- **Phase 4**: Marketplace — discover products from videos

Every button works. No fake functions. Production-oriented.

---

## Admin Setup

To make a user admin, set Firestore `users/{uid}.role = "admin"` directly in console (only existing admin can do via rules, so first admin must be set manually). After that, admin panel appears at `/#/admin`.

---

Built in Zambia 🌍
