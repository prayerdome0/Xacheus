# Logo Visibility — Auto-Matching Backgrounds

## Date: 2026-08-30

## Changes Made

### Logo ink now adapts to the surface it sits on
The logo assets previously shipped with a baked light-grey background, which
looked muddy on dark surfaces and clashed with the theme. The logo art is now
transparent and rendered in the ink variant that guarantees contrast:

- **Dark artwork** (navy X + blue, dark wordmark) on **light surfaces** — the
  variant chosen automatically for light theme.
- **Light artwork** on **dark surfaces** — chosen automatically for dark theme.
- App/PWA icons live on a clean white rounded plate (`assets/logo-plate.png`)
  so they stay legible in launchers, task bars and home screens.

### New assets
- `assets/logo-wordmark.png` — transparent dark-ink wordmark (light surfaces)
- `assets/logo-wordmark-light.png` — transparent light-ink wordmark (dark surfaces)
- `assets/logo-plate.png` — 320×320 white-plate mark for PWA icons
- Reuses existing transparent marks: `assets/logo-mark.png` (dark ink),
  `assets/logo-mark-dark.png` (light ink)

### Where it's applied
- Topbar wordmark, sidebar mark (`js/app.js`)
- Boot screen + boot-failure screen (`index.html`; failure screen picks the
  correct variant even if the app never boots)
- Auth/sign-in overlay wordmark (`js/auth.js`)
- PWA manifest 320px icon (`manifest.json`)
- Service worker shell cache refreshed (`sw.js` cache v8)

### How it stays correct at runtime
`applyTheme()` now calls `syncLogoVariants()`, which retints every
`img[data-logo]` on the screen whenever theme switches (dark/light/system), so
no logo is ever left with poor contrast — including after a live theme change.

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

## Deployment

```bash
firebase use xacheus-7c98b
firebase deploy --only firestore:rules,firestore:indexes,storage,hosting
```
Enable **Firebase Storage** in the console before first deploy.
