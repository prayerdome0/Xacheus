# Xacheus Social

Xacheus Social is a real-time social app: a live feed, profiles with follow graphs,
replies, likes, reposts, bookmarks, trending hashtags, notifications and private
1:1 direct messages.

It's a static, dependency-free web app (no build step) backed by Firebase Auth and
Cloud Firestore. Everything renders live — post a message and it appears in other
people's feeds without a refresh.

---

## What was here before

This repository previously held the Xacheus AI website/ecommerce builder — a
landing page plus `dashboard.html`, `builder.html`, `ai-studio.html`,
`storefront.html` and their scripts. That product has been **removed entirely**
and replaced by this social app.

## Features

**Feed**
- Two timelines: *For you* (global, newest first) and *Following* (people you follow).
- Text posts up to 500 characters with optional image.
- `#hashtags` and `@handles` are parsed out and linked automatically.
- Like, reply, repost, bookmark and copy-link on every post, with live counters.
- Infinite "load more" pagination; real-time updates via Firestore listeners.

**Profiles**
- Cover photo, avatar, bio, location, website and join date.
- Live follower / following / posts counters.
- Tabs for Posts, Media (image posts only) and Likes (bookmarked posts).
- Follower and following lists.
- In-place profile editing, including changing your `@handle` and uploading
  an avatar or cover image.

**Explore**
- Trending hashtags ranked by post volume.
- Suggested people to follow, filtered to accounts you don't already follow.
- Prefix search across both handle and display name; `#hashtag` search opens a
  live stream of matching posts.

**Notifications**
- Likes, replies, reposts, mentions and new followers, in real time.
- Unread dot plus a nav badge that clears as you read.

**Direct messages**
- Private 1:1 conversations that update live.
- Unread counters per conversation and a total badge in the nav.
- Start a chat from any profile, or from an `@handle` prompt in the inbox.

**Account**
- Email + password signup and login, Google sign-in, password reset, email
  verification, and full account deletion (with re-authentication).

**Experience**
- Dark and light themes (plus "system"), persisted per browser.
- Responsive: three-column desktop, icon-rail tablet, bottom tab bar + FAB on mobile.
- Installable PWA with an offline app shell.
- Keyboard accessible, ARIA labels, reduced-motion support.

---

## Run it locally

```bash
npm run dev      # serves on http://0.0.0.0:5173
```

Any static server works — this is plain HTML/CSS/ES modules, no bundler.

## Firebase setup

The app points at project **`xacheus-7c98b`** (config in `js/firebase.js`).

### 0. Make sure Firestore itself is enabled (required)

Signup and login **fail** if the Cloud Firestore API is disabled: Firebase Auth
accepts the credentials, then the profile load throws and the app signs you
straight back out. In the Google Cloud Console → **APIs & Services** for the
project, enable **Cloud Firestore API**, then create the database
(Firebase Console → **Build → Firestore Database → Create database**).

### 1. Deploy the rules and indexes (required)

Nothing works until the security rules and composite indexes are live:

```bash
firebase login
firebase use xacheus-7c98b
npm run deploy
# or individually:
#   firebase deploy --only firestore:rules
#   firebase deploy --only firestore:indexes
```

The four composite indexes in `firestore.indexes.json` back these queries:

| Query | Index |
| --- | --- |
| Profile timeline | `posts`: `uid` ASC, `createdAt` DESC |
| Hashtag streams | `posts`: `hashtags` CONTAINS, `createdAt` DESC |
| Notifications inbox | `notifications`: `toUid` ASC, `createdAt` DESC |
| Conversation list | `conversations`: `participants` CONTAINS, `lastMessageAt` DESC |

Indexes take a couple of minutes to build. Until they finish, Firestore logs a
link in the browser console that creates the missing index directly.

### 2. Enable sign-in methods

In Firebase Console → **Authentication** → **Sign-in method**, enable
**Email/Password** and **Google**.

### 3. Authorized domains

Add every host you serve from (including local and preview domains) under
**Authentication → Settings → Authorized domains**, or Google sign-in and
password resets will be blocked. Email/password login works from any domain.

## Image uploads

Avatars, covers and post photos upload straight from the browser to Cloudinary
using an unsigned preset:

- Cloud name: `dhad95cch`
- Upload preset: `xacheus` (unsigned)

Only the cloud name and preset name live in client code (`js/cloudinary.js`).
Never commit an API key, API secret or `CLOUDINARY_URL`. If the upload fails the
app falls back to a local object URL so posting still works.

## Data model

```
users/{uid}                          profile + counters
  ├─ liked/{postId}                  "I liked this" (fast per-viewer lookup)
  ├─ reposted/{postId}
  └─ saved/{postId}
usernames/{username}                 unique handle reservation
posts/{postId}
  └─ comments/{cid}
follows/{uid}/following/{targetUid}  directed follow graph
follows/{uid}/followers/{followerUid}
notifications/{nid}                  toUid + type + payload
hashtags/{tag}                       trending counters
conversations/{cid}
  └─ messages/{mid}
```

## Security notes

- `firestore.rules` is the real protection; the Firebase web config is public by design.
- Profiles and posts are world-readable so signed-out visitors can browse.
- Every write is scoped to the signed-in owner, except **counter updates**
  (`followersCount` / `followingCount` / `postsCount`) and post counters
  (`likeCount` / `commentCount` / `repostCount`), which any signed-in user can
  move by ±1 because the client has to bump another user's counter when you
  follow them. Moving that to a Cloud Function is the recommended hardening step.

## Project layout

```
index.html          app shell + boot screen
styles.css          design system and all component styles
js/
  app.js            shell, router, session state, right rail
  auth.js           login / signup / reset / Google / handle onboarding
  data.js           Firestore data layer (all reads and writes)
  ui.js             rendering helpers (avatars, time-ago, modals, toasts)
  firebase.js       Firebase bootstrap
  cloudinary.js     unsigned browser uploads
  views/
    components.js   post card, composer, user rows, reply box
    home.js         feed
    explore.js      search, trending, people
    notifications.js
    messages.js     inbox + conversation
    profile.js      profile pages + edit profile
    thread.js       single post and replies
    settings.js     theme, session, account deletion
firestore.rules
firestore.indexes.json
firebase.json
sw.js               offline app shell
manifest.json
```
