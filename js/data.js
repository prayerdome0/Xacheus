/**
 * Xacheus — Firestore data layer (Phase 1: video platform)
 *
 * Collections
 *   users/{uid}                              profile + role + counters
 *   usernames/{username}                     unique handle reservation
 *   videos/{videoId}                         vertical short videos
 *   videos/{videoId}/comments/{cid}          video comments
 *   users/{uid}/likedVideos/{videoId}        liked videos lookup
 *   users/{uid}/savedVideos/{videoId}        saved/bookmarked
 *   sounds/{soundId}                         sounds/songs library (free + original)
 *   users/{uid}/favoriteSounds/{soundId}     saved sounds
 *   follows/{uid}/following/{targetUid}
 *   follows/{uid}/followers/{followerUid}
 *   notifications/{nid}
 *   hashtags/{tag}                           trending counters
 *   conversations/{cid}                      1:1 direct messages (participants[2])
 *   conversations/{cid}/messages/{mid}      chat messages
 *   lives/{liveId}                           live broadcasts (status live/ended)
 *   lives/{liveId}/segments/{sid}           ordered video segments (seq)
 *   lives/{liveId}/chat/{mid}               live chat messages (text/sticker/gift)
 *   lives/{liveId}/gifts/{gid}              paid gifts sent during stream
 *   lives/{liveId}/reactions/{rid}          floating emoji reactions
 *   posts/{postId}                           removed (legacy reads dropped)
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { db } from "./firebase.js";
import { removeObject } from "./storage.js";

export const PAGE_SIZE = 20;
export const VIDEO_PAGE_SIZE = 10;

export const ROLES = ["user", "creator", "business", "church", "admin"];
export const DEFAULT_ROLE = "user";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export function ts(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return 0;
}

export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const RESERVED = new Set([
  "admin", "root", "xacheus", "support", "help", "settings", "home",
  "explore", "discover", "messages", "notifications", "login", "signup",
  "about", "me", "profile", "post", "search", "api", "www", "null",
  "undefined", "video", "videos", "sound", "sounds", "church", "churches",
  "opportunity", "opportunities", "business", "creator",
]);

export function normaliseUsername(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
}

export function usernameError(username) {
  const value = normaliseUsername(username);
  if (value.length < 3) return "Handles need at least 3 characters.";
  if (value.length > 20) return "Handles can be at most 20 characters.";
  if (!/^[a-z0-9_]+$/.test(value)) return "Use letters, numbers and underscores only.";
  if (RESERVED.has(value)) return "That handle is reserved.";
  return null;
}

export function extractHashtags(text) {
  const found = String(text || "").toLowerCase().match(/#([a-z0-9_]{2,30})/g);
  return found ? [...new Set(found.map((t) => t.slice(1)))] : [];
}
export function extractMentions(text) {
  const found = String(text || "").toLowerCase().match(/@([a-z0-9_]{3,20})/g);
  return found ? [...new Set(found.map((n) => n.slice(1)))] : [];
}

/* ------------------------------------------------------------------ */
/* profiles + roles                                                    */
/* ------------------------------------------------------------------ */

async function withRetry(fn, attempts = 4) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const code = String(error?.code || "");
      const msg = String(error?.message || "");
      const retryable =
        code === "unavailable" ||
        code === "deadline-exceeded" ||
        msg.includes("client is offline") ||
        msg.includes("Failed to get document");
      if (!retryable || i === attempts - 1) throw error;
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
  throw lastError;
}

export async function isUsernameTaken(username) {
  const handle = normaliseUsername(username);
  if (!handle) return true;
  try {
    const snap = await withRetry(() => getDoc(doc(db, "usernames", handle)));
    return snap.exists();
  } catch (error) {
    console.warn("[xacheus] username check", error);
    return false;
  }
}

export async function suggestUsername(base) {
  const stem = normaliseUsername(base) || "user";
  for (let i = 0; i < 60; i += 1) {
    const candidate = i === 0 ? stem.slice(0, 20) : `${stem.slice(0, 15)}${Math.floor(100 + Math.random() * 900)}`;
    if (!usernameError(candidate) && !(await isUsernameTaken(candidate))) return candidate;
  }
  return `${stem.slice(0, 10)}${Date.now().toString().slice(-6)}`;
}

/**
 * Registration coordination.
 *
 * During sign-up two things race to create the profile: the code that just
 * called createUserWithEmailAndPassword / signInWithPopup, AND the global
 * onAuthStateChanged listener (which fires the instant the user is signed in).
 * If both create the doc, the chosen username/role gets clobbered by whichever
 * call had no context, and duplicate username reservations are written.
 *
 * Two guards fix this:
 *  - `pendingDefaults`: the username/displayName/role the user picked, so ANY
 *    ensureProfile that ends up doing the creation writes the right data.
 *  - `inFlight`: dedupes concurrent ensureProfile calls for the same uid to a
 *    single promise, so only one creation ever runs.
 *  - `deferCreate`: lets an onboarding flow (Google's handle/role form) tell the
 *    background listener "don't auto-create yet, I'll create with the chosen
 *    role" — a non-admin can only set a role at CREATE time (see rules).
 */
let pendingDefaults = null;
let deferCreate = false;
const inFlight = new Map();

export function setPendingProfileDefaults(defaults) {
  pendingDefaults = defaults ? { ...defaults } : null;
}

export function setDeferProfileCreation(value) {
  deferCreate = Boolean(value);
}

export function isDeferringProfileCreation() {
  return deferCreate;
}

async function createProfile(user, extra) {
  const ref = doc(db, "users", user.uid);
  const seed =
    normaliseUsername(
      extra.username || user.displayName || (user.email || "").split("@")[0] || "user"
    ) || "user";
  const seedIsUsable = !usernameError(seed) && !(await isUsernameTaken(seed));
  const username = seedIsUsable ? seed : await suggestUsername(seed);
  const displayName = extra.displayName || user.displayName || username;

  const profile = {
    uid: user.uid,
    username,
    displayNameLower: displayName.toLowerCase(),
    displayName,
    email: user.email || "",
    photoURL: user.photoURL || "",
    coverURL: "",
    bio: extra.bio || "",
    location: "",
    website: "",
    role: extra.role && ROLES.includes(extra.role) && extra.role !== "admin" ? extra.role : DEFAULT_ROLE,
    verified: false,
    followersCount: 0,
    followingCount: 0,
    videosCount: 0,
    postsCount: 0,
    likesCount: 0,
    createdAt: serverTimestamp(),
  };

  // Reserve the handle first: if it collides mid-flight the whole creation
  // fails cleanly rather than leaving a profile with an unclaimed username.
  await withRetry(() =>
    setDoc(doc(db, "usernames", username), { uid: user.uid, createdAt: serverTimestamp() })
  );
  await withRetry(() => setDoc(ref, profile));
  return profile;
}

export async function ensureProfile(user, extra = {}) {
  if (!user) return null;

  // Merge in any defaults stashed by the sign-up flow (chosen handle/role).
  const merged = { ...(pendingDefaults || {}), ...extra };

  // Collapse concurrent calls for the same user into one.
  if (inFlight.has(user.uid)) return inFlight.get(user.uid);

  const run = (async () => {
    const ref = doc(db, "users", user.uid);
    const snap = await withRetry(() => getDoc(ref));

    if (snap.exists()) {
      const data = snap.data();
      if (!data.role) {
        await updateDoc(ref, { role: DEFAULT_ROLE }).catch(() => {});
        data.role = DEFAULT_ROLE;
      }
      return { id: snap.id, ...data };
    }

    // Missing profile. If an onboarding flow asked us to wait (so it can create
    // with the chosen role), don't auto-create — unless this call is the commit.
    if (deferCreate && !merged.__commit) return null;

    const profile = await createProfile(user, merged);
    // Defaults consumed — clear so later calls don't reapply them.
    pendingDefaults = null;
    deferCreate = false;
    return profile;
  })();

  inFlight.set(user.uid, run);
  try {
    return await run;
  } finally {
    inFlight.delete(user.uid);
  }
}

export async function getProfile(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getProfileByUsername(username) {
  const handle = normaliseUsername(username);
  if (!handle) return null;
  const reserved = await getDoc(doc(db, "usernames", handle));
  if (!reserved.exists()) return null;
  return getProfile(reserved.data().uid);
}

export function watchProfile(uid, callback) {
  if (!uid) return () => {};
  return onSnapshot(doc(db, "users", uid), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

export async function updateProfile(uid, patch) {
  // Prevent role escalation via this helper unless admin - check handled in rules, but also client guard
  const safePatch = { ...patch };
  if ("role" in safePatch) delete safePatch.role;
  if ("uid" in safePatch) delete safePatch.uid;
  await updateDoc(doc(db, "users", uid), { ...safePatch, updatedAt: serverTimestamp() });
}

export async function changeUsername(uid, nextRaw) {
  const next = normaliseUsername(nextRaw);
  const problem = usernameError(next);
  if (problem) throw new Error(problem);
  const current = await getProfile(uid);
  if (!current) throw new Error("Profile not found.");
  if (current.username === next) return next;
  const taken = await getDoc(doc(db, "usernames", next));
  if (taken.exists() && taken.data().uid !== uid) throw new Error("That handle is already taken.");
  await setDoc(doc(db, "usernames", next), { uid, createdAt: serverTimestamp() });
  await updateDoc(doc(db, "users", uid), { username: next });
  if (current.username && current.username !== next) {
    await deleteDoc(doc(db, "usernames", current.username)).catch(() => {});
  }
  return next;
}

export function isAdminProfile(profile) {
  return profile?.role === "admin";
}

/* ------------------------------------------------------------------ */
/* videos                                                              */
/* ------------------------------------------------------------------ */

export async function createVideo(author, {
  videoUrl,
  images = [],
  mediaType = "video",
  thumbnailUrl = "",
  caption = "",
  soundId = null,
  soundTitle = "",
  soundUrl = null,
  duration = 0,
  width = 0,
  height = 0,
  storagePath = "",
}) {
  const cap = String(caption || "").trim().slice(0, 1000);

  const isPhoto = mediaType === "photo";
  const photos = isPhoto ? (Array.isArray(images) ? images.filter((u) => u && !String(u).startsWith("blob:")).slice(0, 6) : []) : [];
  if (isPhoto) {
    if (!photos.length) throw new Error("Add at least one photo.");
  } else if (!videoUrl) {
    throw new Error("Video URL missing");
  }

  const hashtags = extractHashtags(cap);
  const mentions = extractMentions(cap);

  const payload = {
    uid: author.uid,
    username: author.username,
    displayName: author.displayName,
    photoURL: author.photoURL || "",
    mediaType: isPhoto ? "photo" : "video",
    images: photos,
    videoUrl: isPhoto ? "" : videoUrl,
    thumbnailUrl: isPhoto ? photos[0] : thumbnailUrl || "",
    caption: cap,
    hashtags,
    mentions,
    soundId: soundId || null,
    soundTitle: soundTitle || (soundId ? "Original sound" : ""),
    soundUrl: soundUrl || null,
    duration: Number(duration) || 0,
    width: Number(width) || 0,
    height: Number(height) || 0,
    storagePath: storagePath || "",
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    shareCount: 0,
    isPublic: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, "videos"), payload);
  await updateDoc(doc(db, "users", author.uid), {
    videosCount: increment(1),
  }).catch(() => {});

  // trending hashtags
  Promise.all(
    hashtags.map((tag) =>
      setDoc(doc(db, "hashtags", tag), { tag, count: increment(1), lastUsedAt: serverTimestamp() }, { merge: true }).catch(() => {})
    )
  ).catch(() => {});

  // mention notifications
  Promise.all(
    mentions.map(async (name) => {
      const target = await getProfileByUsername(name);
      if (target && target.uid !== author.uid) {
        await notify(target.uid, {
          type: "mention",
          fromUid: author.uid,
          fromName: author.displayName,
          fromPhoto: author.photoURL || "",
          fromUsername: author.username,
          videoId: ref.id,
          text: cap.slice(0, 180),
        });
      }
    })
  ).catch(() => {});

  // increment sound useCount (skips curated free_* ids)
  if (soundId) bumpSoundUse(soundId).catch(() => {});

  return ref.id;
}

export async function getVideo(videoId) {
  const snap = await getDoc(doc(db, "videos", videoId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function watchVideo(videoId, cb) {
  return onSnapshot(doc(db, "videos", videoId), (snap) => {
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

export async function deleteVideo(videoId, uid) {
  const snap = await getDoc(doc(db, "videos", videoId));
  if (!snap.exists()) return;
  if (snap.data().uid !== uid) throw new Error("You can only delete your own videos.");
  const data = snap.data();
  // Best-effort: remove the hosted media object so Storage isn't littered.
  if (data.storagePath) removeObject(data.storagePath).catch(() => {});
  await deleteDoc(doc(db, "videos", videoId));
  await updateDoc(doc(db, "users", uid), { videosCount: increment(-1) }).catch(() => {});
}

export function watchVideoFeed({ mode = "foryou", uid = null, followingIds = [], onData, pageSize = VIDEO_PAGE_SIZE } = {}) {
  let q;
  if (mode === "following" && uid && followingIds.length) {
    // Firestore IN limited to 10, so we chunk but for live we just take first 10
    const ids = followingIds.slice(0, 10);
    q = query(
      collection(db, "videos"),
      where("uid", "in", ids),
      orderBy("createdAt", "desc"),
      limit(pageSize)
    );
  } else {
    q = query(collection(db, "videos"), orderBy("createdAt", "desc"), limit(pageSize));
  }
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() })), snap.docs),
    (err) => {
      console.warn("[xacheus] video feed", err);
      onData([], []);
    }
  );
}

export async function fetchVideoPage({ mode = "foryou", uid = null, followingIds = [], afterDoc = null, pageSize = VIDEO_PAGE_SIZE } = {}) {
  const constraints = [orderBy("createdAt", "desc"), limit(pageSize)];
  if (mode === "following" && followingIds.length) {
    constraints.unshift(where("uid", "in", followingIds.slice(0, 10)));
  }
  if (afterDoc) constraints.push(startAfter(afterDoc));
  const snap = await getDocs(query(collection(db, "videos"), ...constraints));
  return { docs: snap.docs, items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
}

export function watchUserVideos(uid, onData, pageSize = 30) {
  return onSnapshot(
    query(collection(db, "videos"), where("uid", "==", uid), orderBy("createdAt", "desc"), limit(pageSize)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => onData([])
  );
}

export function watchTrendingVideos(onData, pageSize = 20) {
  // Trending by likeCount desc then createdAt desc requires composite index, fallback to likeCount query
  return onSnapshot(
    query(collection(db, "videos"), orderBy("likeCount", "desc"), limit(pageSize)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.warn("[xacheus] trending videos", err);
      // fallback to recent
      onSnapshot(
        query(collection(db, "videos"), orderBy("createdAt", "desc"), limit(pageSize)),
        (s) => onData(s.docs.map((d) => ({ id: d.id, ...d.data() })))
      );
    }
  );
}

/* ------------------------------------------------------------------ */
/* likes / saves for videos                                            */
/* ------------------------------------------------------------------ */

export async function getLikedVideoIds(uid, videoIds) {
  const liked = new Set();
  const ids = videoIds.filter(Boolean);
  if (!uid || !ids.length) return liked;
  await Promise.all(
    chunk(ids, 10).map(async (group) => {
      const snap = await getDocs(query(collection(db, "users", uid, "likedVideos"), where(documentId(), "in", group)));
      snap.forEach((d) => liked.add(d.id));
    })
  );
  return liked;
}

export async function toggleVideoLike(uid, actor, video) {
  const ref = doc(db, "users", uid, "likedVideos", video.id);
  const snap = await getDoc(ref);
  const videoRef = doc(db, "videos", video.id);

  if (snap.exists()) {
    await deleteDoc(ref);
    await updateDoc(videoRef, { likeCount: increment(-1) });
    await updateDoc(doc(db, "users", uid), { likesCount: increment(-1) }).catch(() => {});
    return false;
  }
  await setDoc(ref, { createdAt: serverTimestamp(), videoId: video.id });
  await updateDoc(videoRef, { likeCount: increment(1) });
  await updateDoc(doc(db, "users", uid), { likesCount: increment(1) }).catch(() => {});
  if (video.uid !== uid) {
    notify(video.uid, {
      type: "like",
      fromUid: uid,
      fromName: actor.displayName,
      fromPhoto: actor.photoURL || "",
      fromUsername: actor.username,
      videoId: video.id,
      text: (video.caption || "").slice(0, 180),
    }).catch(() => {});
  }
  return true;
}

export async function getSavedVideoIds(uid, videoIds) {
  const set = new Set();
  const ids = videoIds.filter(Boolean);
  if (!uid || !ids.length) return set;
  await Promise.all(
    chunk(ids, 10).map(async (group) => {
      const snap = await getDocs(query(collection(db, "users", uid, "savedVideos"), where(documentId(), "in", group)));
      snap.forEach((d) => set.add(d.id));
    })
  );
  return set;
}

export async function toggleVideoSave(uid, video) {
  const ref = doc(db, "users", uid, "savedVideos", video.id);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await deleteDoc(ref);
    return false;
  }
  await setDoc(ref, { createdAt: serverTimestamp(), videoId: video.id });
  return true;
}

export function watchSavedVideos(uid, onData) {
  return onSnapshot(
    query(collection(db, "users", uid, "savedVideos"), orderBy("createdAt", "desc"), limit(60)),
    async (snap) => {
      const vids = await Promise.all(snap.docs.map(async (d) => await getVideo(d.id)));
      onData(vids.filter(Boolean));
    },
    () => onData([])
  );
}

/* ------------------------------------------------------------------ */
/* comments for videos                                                 */
/* ------------------------------------------------------------------ */

export function watchVideoComments(videoId, onData) {
  return onSnapshot(
    query(collection(db, "videos", videoId, "comments"), orderBy("createdAt", "asc"), limit(100)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => onData([])
  );
}

export async function addVideoComment(uid, actor, video, text) {
  const body = String(text || "").trim();
  if (!body) throw new Error("Write a comment first.");
  if (body.length > 500) throw new Error("Comments limited to 500 chars.");
  await addDoc(collection(db, "videos", video.id, "comments"), {
    uid,
    username: actor.username,
    displayName: actor.displayName,
    photoURL: actor.photoURL || "",
    text: body,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, "videos", video.id), { commentCount: increment(1) });
  if (video.uid !== uid) {
    await notify(video.uid, {
      type: "comment",
      fromUid: uid,
      fromName: actor.displayName,
      fromPhoto: actor.photoURL || "",
      fromUsername: actor.username,
      videoId: video.id,
      text: body.slice(0, 180),
    }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* sounds & songs                                                      */
/* ------------------------------------------------------------------ */

/**
 * Curated royalty-free catalogue (always available offline of Firestore).
 * Sources: Mixkit free music + SoundHelix demos — attribution-free for app use.
 * No copyrighted YouTube rips.
 */
export const SOUND_GENRES = Object.freeze([
  "all",
  "lofi",
  "afrobeat",
  "gospel",
  "afro",
  "pop",
  "hiphop",
  "ambient",
  "cinematic",
  "dance",
  "acoustic",
  "jazz",
  "electronic",
  "original",
]);

export const CURATED_FREE_SOUNDS = [
  {
    id: "free_001",
    title: "Lo-Fi Chill",
    artist: "Mixkit Free",
    genre: "lofi",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-tech-house-vibes-130.mp3",
    coverUrl: "",
    duration: 95,
    bpm: 118,
    isFree: true,
    isOriginal: false,
    useCount: 42,
  },
  {
    id: "free_002",
    title: "Afrobeat Drive",
    artist: "Mixkit Free",
    genre: "afrobeat",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-hip-hop-02-738.mp3",
    coverUrl: "",
    duration: 88,
    bpm: 96,
    isFree: true,
    isOriginal: false,
    useCount: 38,
  },
  {
    id: "free_003",
    title: "Gospel Light",
    artist: "Mixkit Free",
    genre: "gospel",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-spirit-in-the-woods-piano-ambient-68.mp3",
    coverUrl: "",
    duration: 110,
    bpm: 72,
    isFree: true,
    isOriginal: false,
    useCount: 55,
  },
  {
    id: "free_004",
    title: "Zambian Sunset",
    artist: "Zed Beats Free",
    genre: "afro",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-serene-view-443.mp3",
    coverUrl: "",
    duration: 100,
    bpm: 90,
    isFree: true,
    isOriginal: false,
    useCount: 29,
  },
  {
    id: "free_005",
    title: "Upbeat Pop Energy",
    artist: "Mixkit Free",
    genre: "pop",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-driving-ambition-32.mp3",
    coverUrl: "",
    duration: 92,
    bpm: 124,
    isFree: true,
    isOriginal: false,
    useCount: 61,
  },
  {
    id: "free_006",
    title: "Night Ride",
    artist: "SoundHelix",
    genre: "electronic",
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    coverUrl: "",
    duration: 372,
    bpm: 128,
    isFree: true,
    isOriginal: false,
    useCount: 17,
  },
  {
    id: "free_007",
    title: "Deep Focus",
    artist: "SoundHelix",
    genre: "ambient",
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    coverUrl: "",
    duration: 372,
    bpm: 80,
    isFree: true,
    isOriginal: false,
    useCount: 22,
  },
  {
    id: "free_008",
    title: "City Lights",
    artist: "Mixkit Free",
    genre: "lofi",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-dreaming-big-31.mp3",
    coverUrl: "",
    duration: 98,
    bpm: 85,
    isFree: true,
    isOriginal: false,
    useCount: 33,
  },
  {
    id: "free_009",
    title: "Dance Floor",
    artist: "Mixkit Free",
    genre: "dance",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-hazy-after-hours-132.mp3",
    coverUrl: "",
    duration: 105,
    bpm: 122,
    isFree: true,
    isOriginal: false,
    useCount: 44,
  },
  {
    id: "free_010",
    title: "Soft Acoustic",
    artist: "Mixkit Free",
    genre: "acoustic",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-a-very-happy-christmas-897.mp3",
    coverUrl: "",
    duration: 90,
    bpm: 100,
    isFree: true,
    isOriginal: false,
    useCount: 19,
  },
  {
    id: "free_011",
    title: "Cinematic Rise",
    artist: "Mixkit Free",
    genre: "cinematic",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-valley-sunset-127.mp3",
    coverUrl: "",
    duration: 115,
    bpm: 70,
    isFree: true,
    isOriginal: false,
    useCount: 27,
  },
  {
    id: "free_012",
    title: "Hip-Hop Bounce",
    artist: "Mixkit Free",
    genre: "hiphop",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-life-is-a-dream-837.mp3",
    coverUrl: "",
    duration: 94,
    bpm: 92,
    isFree: true,
    isOriginal: false,
    useCount: 48,
  },
  {
    id: "free_013",
    title: "Jazz Lounge",
    artist: "SoundHelix",
    genre: "jazz",
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    coverUrl: "",
    duration: 360,
    bpm: 110,
    isFree: true,
    isOriginal: false,
    useCount: 14,
  },
  {
    id: "free_014",
    title: "Sunday Praise",
    artist: "Mixkit Free",
    genre: "gospel",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-beautiful-dream-493.mp3",
    coverUrl: "",
    duration: 108,
    bpm: 78,
    isFree: true,
    isOriginal: false,
    useCount: 36,
  },
  {
    id: "free_015",
    title: "Lusaka Nights",
    artist: "Zed Beats Free",
    genre: "afrobeat",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-cat-walk-863.mp3",
    coverUrl: "",
    duration: 96,
    bpm: 108,
    isFree: true,
    isOriginal: false,
    useCount: 31,
  },
  {
    id: "free_016",
    title: "Electro Pulse",
    artist: "SoundHelix",
    genre: "electronic",
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",
    coverUrl: "",
    duration: 340,
    bpm: 130,
    isFree: true,
    isOriginal: false,
    useCount: 21,
  },
  {
    id: "free_017",
    title: "Warm Morning",
    artist: "Mixkit Free",
    genre: "ambient",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-sleepy-cat-135.mp3",
    coverUrl: "",
    duration: 102,
    bpm: 68,
    isFree: true,
    isOriginal: false,
    useCount: 25,
  },
  {
    id: "free_018",
    title: "Party Starter",
    artist: "Mixkit Free",
    genre: "dance",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-games-worldbeat-466.mp3",
    coverUrl: "",
    duration: 88,
    bpm: 126,
    isFree: true,
    isOriginal: false,
    useCount: 40,
  },
  {
    id: "free_019",
    title: "Street Flow",
    artist: "Mixkit Free",
    genre: "hiphop",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-raising-me-higher-34.mp3",
    coverUrl: "",
    duration: 99,
    bpm: 94,
    isFree: true,
    isOriginal: false,
    useCount: 35,
  },
  {
    id: "free_020",
    title: "Golden Hour",
    artist: "Mixkit Free",
    genre: "cinematic",
    audioUrl: "https://assets.mixkit.co/music/preview/mixkit-sun-and-his-daughter-580.mp3",
    coverUrl: "",
    duration: 112,
    bpm: 75,
    isFree: true,
    isOriginal: false,
    useCount: 28,
  },
];

const CURATED_BY_ID = Object.fromEntries(CURATED_FREE_SOUNDS.map((s) => [s.id, s]));

function isCuratedId(id) {
  return Boolean(id && String(id).startsWith("free_"));
}

function mergeSounds(dbList = [], { includeCurated = true, genre = "", onlyFree = false, onlyOriginal = false } = {}) {
  const map = new Map();
  if (includeCurated) {
    CURATED_FREE_SOUNDS.forEach((s) => map.set(s.id, { ...s }));
  }
  dbList.forEach((s) => {
    if (!s?.id) return;
    // DB wins over curated for same id; otherwise add.
    map.set(s.id, { ...s });
  });
  let list = [...map.values()];
  if (onlyFree) list = list.filter((s) => s.isFree);
  if (onlyOriginal) list = list.filter((s) => s.isOriginal);
  if (genre && genre !== "all") {
    const g = genre.toLowerCase();
    list = list.filter((s) => String(s.genre || "").toLowerCase() === g);
  }
  list.sort((a, b) => (b.useCount || 0) - (a.useCount || 0) || String(a.title).localeCompare(String(b.title)));
  return list;
}

function matchSoundQuery(sound, term) {
  const q = String(term || "").trim().toLowerCase();
  if (!q) return true;
  const hay = [sound.title, sound.artist, sound.artistUsername, sound.genre, sound.id]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q) || q.split(/\s+/).every((t) => hay.includes(t));
}

/** List sounds — merges Firestore + curated free catalogue. */
export async function getSounds({
  limitCount = 40,
  onlyFree = false,
  onlyOriginal = false,
  genre = "",
  includeCurated = true,
} = {}) {
  let dbList = [];
  try {
    let q = query(collection(db, "sounds"), orderBy("useCount", "desc"), limit(Math.max(limitCount, 40)));
    if (onlyFree) {
      q = query(
        collection(db, "sounds"),
        where("isFree", "==", true),
        orderBy("useCount", "desc"),
        limit(Math.max(limitCount, 40))
      );
    } else if (onlyOriginal) {
      q = query(
        collection(db, "sounds"),
        where("isOriginal", "==", true),
        orderBy("useCount", "desc"),
        limit(Math.max(limitCount, 40))
      );
    }
    const snap = await getDocs(q);
    dbList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    // Fallback without composite index / order.
    try {
      const snap = await getDocs(query(collection(db, "sounds"), limit(80)));
      dbList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch {
      dbList = [];
    }
  }
  return mergeSounds(dbList, { includeCurated, genre, onlyFree, onlyOriginal }).slice(0, limitCount);
}

/** Live trending list (useCount desc) with curated fallback. */
export function watchTrendingSounds(onData, pageSize = 30) {
  return onSnapshot(
    query(collection(db, "sounds"), orderBy("useCount", "desc"), limit(pageSize)),
    (snap) => {
      const dbList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onData(mergeSounds(dbList).slice(0, pageSize));
    },
    () => onData(mergeSounds([]).slice(0, pageSize))
  );
}

/** Newest originals + free catalogue. */
export function watchSounds(onData, pageSize = 40) {
  return onSnapshot(
    query(collection(db, "sounds"), orderBy("createdAt", "desc"), limit(pageSize)),
    (snap) => {
      const dbList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onData(mergeSounds(dbList).slice(0, pageSize + CURATED_FREE_SOUNDS.length));
    },
    () => onData(mergeSounds([]))
  );
}

/** Publish an original sound (audioUrl already uploaded to Firebase Storage). */
export async function createSound(author, {
  title,
  audioUrl,
  coverUrl = "",
  duration = 0,
  genre = "original",
  isFree = false,
  bpm = 0,
  storagePath = "",
}) {
  if (!author?.uid) throw new Error("Sign in to upload a sound.");
  if (!title || !audioUrl) throw new Error("Sound needs a title and audio file.");
  if (String(audioUrl).startsWith("blob:")) throw new Error("Audio upload incomplete — try again.");
  const g = String(genre || "original").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24) || "original";
  const payload = {
    title: String(title).trim().slice(0, 80),
    artist: author.displayName || author.username || "Artist",
    artistUid: author.uid,
    artistUsername: author.username || "",
    audioUrl,
    storagePath: storagePath || "",
    coverUrl: coverUrl || author.photoURL || "",
    duration: Number(duration) || 0,
    bpm: Number(bpm) || 0,
    genre: g,
    useCount: 0,
    favoriteCount: 0,
    isFree: Boolean(isFree),
    isOriginal: true,
    createdAt: serverTimestamp(),
    lastUsedAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, "sounds"), payload);
  return { id: ref.id, ...payload };
}

/** Single sound by id (curated or Firestore). */
export async function getSound(soundId) {
  if (!soundId) return null;
  if (CURATED_BY_ID[soundId]) return { ...CURATED_BY_ID[soundId] };
  try {
    const snap = await getDoc(doc(db, "sounds", soundId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch {
    return null;
  }
}

/** Search free + DB catalogue by title / artist / genre. */
export async function searchSounds(term, { limitCount = 40, genre = "" } = {}) {
  const all = await getSounds({ limitCount: 120, genre, includeCurated: true });
  const q = String(term || "").trim();
  if (!q) return all.slice(0, limitCount);
  return all.filter((s) => matchSoundQuery(s, q)).slice(0, limitCount);
}

/** Sounds for a genre chip. */
export async function getSoundsByGenre(genre, limitCount = 40) {
  return getSounds({ limitCount, genre: genre === "all" ? "" : genre, includeCurated: true });
}

/** Distinct genres present in catalogue. */
export function getSoundGenres() {
  const set = new Set(SOUND_GENRES.filter((g) => g !== "all" && g !== "original"));
  CURATED_FREE_SOUNDS.forEach((s) => {
    if (s.genre) set.add(String(s.genre).toLowerCase());
  });
  return ["all", ...[...set].sort(), "original"];
}

/** Videos that used a given soundId. */
export async function getVideosBySound(soundId, max = 30) {
  if (!soundId) return [];
  try {
    const snap = await getDocs(
      query(collection(db, "videos"), where("soundId", "==", soundId), orderBy("createdAt", "desc"), limit(max))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    // Index may not exist yet — unordered fallback.
    try {
      const snap = await getDocs(query(collection(db, "videos"), where("soundId", "==", soundId), limit(max)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
    } catch {
      return [];
    }
  }
}

/** Bump useCount when a video is posted with this sound. */
export async function bumpSoundUse(soundId) {
  if (!soundId || isCuratedId(soundId)) return; // curated stays client-side
  await updateDoc(doc(db, "sounds", soundId), {
    useCount: increment(1),
    lastUsedAt: serverTimestamp(),
  }).catch(() => {});
}

/** Soft-delete own original sound (or admin). */
export async function deleteSound(soundId, uid, { asAdmin = false } = {}) {
  if (!soundId || isCuratedId(soundId)) throw new Error("Built-in free sounds can't be deleted.");
  const snap = await getDoc(doc(db, "sounds", soundId));
  if (!snap.exists()) return;
  const data = snap.data();
  if (!asAdmin && data.artistUid !== uid) throw new Error("You can only delete your own sounds.");
  if (data.storagePath) removeObject(data.storagePath).catch(() => {});
  await deleteDoc(doc(db, "sounds", soundId));
}

/* ---- favorites ---- */

export async function isSoundFavorited(uid, soundId) {
  if (!uid || !soundId) return false;
  const snap = await getDoc(doc(db, "users", uid, "favoriteSounds", soundId));
  return snap.exists();
}

export async function getFavoriteSoundIds(uid) {
  if (!uid) return new Set();
  const snap = await getDocs(query(collection(db, "users", uid, "favoriteSounds"), limit(200)));
  return new Set(snap.docs.map((d) => d.id));
}

export async function toggleSoundFavorite(uid, sound) {
  if (!uid || !sound?.id) throw new Error("Sign in to save sounds.");
  const ref = doc(db, "users", uid, "favoriteSounds", sound.id);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await deleteDoc(ref);
    if (!isCuratedId(sound.id)) {
      await updateDoc(doc(db, "sounds", sound.id), { favoriteCount: increment(-1) }).catch(() => {});
    }
    return false;
  }
  await setDoc(ref, {
    soundId: sound.id,
    title: sound.title || "",
    artist: sound.artist || "",
    audioUrl: sound.audioUrl || "",
    genre: sound.genre || "",
    createdAt: serverTimestamp(),
  });
  if (!isCuratedId(sound.id)) {
    await updateDoc(doc(db, "sounds", sound.id), { favoriteCount: increment(1) }).catch(() => {});
  }
  return true;
}

export function watchFavoriteSounds(uid, onData) {
  if (!uid) return () => onData([]);
  return onSnapshot(
    query(collection(db, "users", uid, "favoriteSounds"), orderBy("createdAt", "desc"), limit(100)),
    async (snap) => {
      const ids = snap.docs.map((d) => d.id);
      const sounds = await Promise.all(ids.map((id) => getSound(id)));
      onData(sounds.filter(Boolean));
    },
    () => onData([])
  );
}

/** Artist's original uploads. */
export async function getUserSounds(uid, max = 40) {
  if (!uid) return [];
  try {
    const snap = await getDocs(
      query(collection(db, "sounds"), where("artistUid", "==", uid), orderBy("createdAt", "desc"), limit(max))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(query(collection(db, "sounds"), where("artistUid", "==", uid), limit(max)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
    } catch {
      return [];
    }
  }
}

/** Format mm:ss for sound rows. */
export function formatSoundDuration(sec) {
  const n = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* follows                                                             */
/* ------------------------------------------------------------------ */

export function followingRef(uid, targetUid) {
  return doc(db, "follows", uid, "following", targetUid);
}
export function followerRef(targetUid, uid) {
  return doc(db, "follows", targetUid, "followers", uid);
}
export async function isFollowing(uid, targetUid) {
  if (!uid || !targetUid || uid === targetUid) return false;
  const snap = await getDoc(followingRef(uid, targetUid));
  return snap.exists();
}
export async function getFollowingIds(uid) {
  const snap = await getDocs(query(collection(db, "follows", uid, "following"), limit(500)));
  return snap.docs.map((d) => d.id);
}
export async function toggleFollow(uid, actor, target) {
  if (!uid || !target?.uid || uid === target.uid) return false;
  const ref = followingRef(uid, target.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await deleteDoc(ref);
    await deleteDoc(followerRef(target.uid, uid));
    await updateDoc(doc(db, "users", uid), { followingCount: increment(-1) }).catch(() => {});
    await updateDoc(doc(db, "users", target.uid), { followersCount: increment(-1) }).catch(() => {});
    return false;
  }
  await setDoc(ref, { createdAt: serverTimestamp(), uid: target.uid });
  await setDoc(followerRef(target.uid, uid), { createdAt: serverTimestamp(), uid });
  await updateDoc(doc(db, "users", uid), { followingCount: increment(1) }).catch(() => {});
  await updateDoc(doc(db, "users", target.uid), { followersCount: increment(1) }).catch(() => {});
  await notify(target.uid, {
    type: "follow",
    fromUid: uid,
    fromName: actor.displayName,
    fromPhoto: actor.photoURL || "",
    fromUsername: actor.username,
    text: "",
  }).catch(() => {});
  return true;
}
export async function getFollowers(uid, max = 50) {
  const snap = await getDocs(query(collection(db, "follows", uid, "followers"), limit(max)));
  return Promise.all(snap.docs.map((d) => getProfile(d.id)));
}
export async function getFollowing(uid, max = 50) {
  const snap = await getDocs(query(collection(db, "follows", uid, "following"), limit(max)));
  return Promise.all(snap.docs.map((d) => getProfile(d.id)));
}
export async function getSuggestedUsers(uid, max = 6) {
  const [following, recent] = await Promise.all([
    uid ? getFollowingIds(uid) : Promise.resolve([]),
    getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(40))),
  ]);
  const skip = new Set([uid, ...following]);
  return recent.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => !skip.has(u.uid)).slice(0, max);
}

/* ------------------------------------------------------------------ */
/* notifications                                                       */
/* ------------------------------------------------------------------ */

export async function notify(toUid, payload) {
  if (!toUid) return;
  await addDoc(collection(db, "notifications"), {
    toUid,
    read: false,
    createdAt: serverTimestamp(),
    ...payload,
  });
}
export function watchNotifications(uid, onData) {
  return onSnapshot(
    query(collection(db, "notifications"), where("toUid", "==", uid), orderBy("createdAt", "desc"), limit(50)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => onData([])
  );
}
export async function markNotificationsRead(uid, items) {
  await Promise.all(items.filter((i) => !i.read).map((i) => updateDoc(doc(db, "notifications", i.id), { read: true })));
}

/* ------------------------------------------------------------------ */
/* content moderation: reports + bans                                  */
/* ------------------------------------------------------------------ */

export const REPORT_TYPES = Object.freeze(["video", "user", "comment", "sound", "live"]);
export const REPORT_REASONS = Object.freeze([
  "Spam",
  "Harassment or bullying",
  "Hate speech",
  "Nudity or sexual content",
  "Violence or dangerous content",
  "Copyright violation",
  "Scam or misleading",
  "Impersonation",
  "Other",
]);

/**
 * Submit a moderation report. Guards against duplicate open reports from the
 * same user for the same target (single-field query, filtered client-side so
 * no composite index is required).
 */
export async function submitReport({
  reporterUid,
  reporterName = "",
  reporterUsername = "",
  targetType,
  targetId,
  targetOwnerUid = "",
  reason,
  details = "",
}) {
  if (!reporterUid) throw new Error("Sign in to report content.");
  if (!targetType || !targetId) throw new Error("Missing report target.");
  if (!REPORT_TYPES.includes(targetType)) throw new Error("Invalid report type.");
  const reasonText = String(reason || "").trim();
  if (!reasonText) throw new Error("Pick a reason to report.");
  if (reasonText.length > 160) throw new Error("That reason is too long.");

  // Prevent spam: one open report per user per target.
  try {
    const existing = await getDocs(
      query(collection(db, "reports"), where("reporterUid", "==", reporterUid), limit(20))
    );
    const dup = existing.docs.some((d) => {
      const data = d.data();
      return data.targetId === targetId && data.status === "open";
    });
    if (dup) throw new Error("You already reported this. Our team is reviewing it.");
  } catch (err) {
    if (err?.message?.includes("already reported")) throw err;
  }

  await addDoc(collection(db, "reports"), {
    reporterUid,
    reporterName: reporterName || "",
    reporterUsername: reporterUsername || "",
    targetType,
    targetId,
    targetOwnerUid: targetOwnerUid || "",
    reason: reasonText,
    details: String(details || "").slice(0, 500),
    status: "open",
    resolvedBy: "",
    resolvedAt: null,
    createdAt: serverTimestamp(),
  });
}

/** Admin: resolve (or reopen) a report. */
export async function resolveReport(reportId, { status = "resolved", by = "" }) {
  if (!reportId) return;
  await updateDoc(doc(db, "reports", reportId), {
    status: status === "open" ? "open" : "resolved",
    resolvedBy: status === "open" ? "" : String(by || ""),
    resolvedAt: status === "open" ? null : serverTimestamp(),
  });
}

/** Admin: ban / unban an account. */
export async function setUserBan(uid, banned) {
  if (!uid) return;
  await updateDoc(doc(db, "users", uid), { banned: Boolean(banned) });
}

/** Whether any videos by a user are publicly visible (used for cleanup). */
export async function countByCollection(collectionName, max = 5000) {
  try {
    const snap = await getDocs(query(collection(db, collectionName), limit(max)));
    return snap.size;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* trending + search                                                   */
/* ------------------------------------------------------------------ */

export async function getTrending(max = 8) {
  try {
    const snap = await getDocs(query(collection(db, "hashtags"), orderBy("count", "desc"), limit(max)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}
export async function searchUsers(term, max = 12) {
  const q = String(term || "").trim().toLowerCase();
  if (!q) return [];
  const handle = normaliseUsername(q);
  const queries = [];
  if (handle) {
    queries.push(
      getDocs(query(collection(db, "users"), where("username", ">=", handle), where("username", "<=", handle + "\uf8ff"), orderBy("username"), limit(max)))
    );
  }
  queries.push(
    getDocs(query(collection(db, "users"), where("displayNameLower", ">=", q), where("displayNameLower", "<=", q + "\uf8ff"), orderBy("displayNameLower"), limit(max)))
  );
  const results = await Promise.all(queries.map((p) => p.catch(() => null)));
  const seen = new Set();
  const users = [];
  results.forEach((snap) => {
    if (!snap) return;
    snap.docs.forEach((d) => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      users.push({ id: d.id, ...d.data() });
    });
  });
  return users.slice(0, max);
}

export async function searchVideos(term, max = 12) {
  const q = String(term || "").trim().toLowerCase();
  if (!q) return [];
  // Search by caption prefix? For simplicity search hashtags
  const tag = normaliseUsername(q.replace(/^#/, ""));
  if (!tag) return [];
  const snap = await getDocs(query(collection(db, "videos"), where("hashtags", "array-contains", tag), orderBy("createdAt", "desc"), limit(max))).catch(() => null);
  return snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
}

/* ------------------------------------------------------------------ */
/* account                                                             */
/* ------------------------------------------------------------------ */

export async function purgeUserData(uid) {
  const [videos, following, followers] = await Promise.all([
    getDocs(query(collection(db, "videos"), where("uid", "==", uid), limit(200))),
    getDocs(query(collection(db, "follows", uid, "following"), limit(500))),
    getDocs(query(collection(db, "follows", uid, "followers"), limit(500))),
  ]);
  await Promise.all(videos.docs.map((d) => deleteDoc(d.ref)));
  await Promise.all(following.docs.map((d) => deleteDoc(d.ref)));
  await Promise.all(followers.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
  await runTransaction(db, async () => {
    const profileRef = doc(db, "users", uid);
    const snap = await getDoc(profileRef);
    if (snap.exists() && snap.data().username) {
      deleteDoc(doc(db, "usernames", snap.data().username)).catch(() => {});
    }
    deleteDoc(profileRef).catch(() => {});
  });
}

/* Legacy posts helpers removed — the post/thread phase is gone. */

/* ------------------------------------------------------------------ */
/* direct messages                                                     */
/* ------------------------------------------------------------------ */

/**
 * Deterministic conversation id for a pair of users, so both sides and
 * every device agree on one doc — no query needed to find "our" chat.
 */
export function conversationIdFor(uidA, uidB) {
  return [String(uidA), String(uidB)].sort().join("__");
}

/**
 * Get or create the 1:1 conversation between two profiles.
 * `me` and `other` are profile objects ({ uid, ... }). Returns the cid.
 */
export async function openConversation(me, other) {
  if (!me?.uid || !other?.uid) throw new Error("Sign in to start a chat.");
  if (me.uid === other.uid) throw new Error("You can't message yourself.");
  const cid = conversationIdFor(me.uid, other.uid);
  const ref = doc(db, "conversations", cid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) return;
    tx.set(ref, {
      participants: [me.uid, other.uid].sort(),
      lastMessage: "",
      lastSenderId: "",
      lastMessageAt: serverTimestamp(),
      unreadCount: {},
      createdAt: serverTimestamp(),
    });
  });
  return cid;
}

export async function getConversationMeta(cid) {
  const snap = await getDoc(doc(db, "conversations", cid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Live list of my conversations, newest message first.
 *
 * Tries the composite-indexed query (participants contains + lastMessageAt
 * desc) and, if that index isn't built/deployed yet, falls back to an
 * un-ordered query sorted client-side so DMs still work out of the box.
 */
export function watchConversations(uid, onData) {
  let stopped = false;
  let unsubMain = null;
  let unsubFallback = null;
  const baseFilter = where("participants", "array-contains", uid);

  const sortDocs = (docs) =>
    docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ts(b.lastMessageAt) - ts(a.lastMessageAt));

  const emit = (list) => {
    if (!stopped) onData(list);
  };

  const startFallback = () => {
    if (stopped || unsubFallback) return;
    unsubFallback = onSnapshot(
      query(collection(db, "conversations"), baseFilter, limit(50)),
      (snap) => emit(sortDocs(snap.docs)),
      () => emit([])
    );
  };

  unsubMain = onSnapshot(
    query(collection(db, "conversations"), baseFilter, orderBy("lastMessageAt", "desc"), limit(50)),
    (snap) => emit(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    startFallback
  );

  return () => {
    stopped = true;
    unsubMain?.();
    unsubFallback?.();
  };
}

export function watchMessages(cid, onData) {
  return onSnapshot(
    query(collection(db, "conversations", cid, "messages"), orderBy("createdAt", "asc"), limit(300)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => onData([])
  );
}

/** Send a message and update the conversation preview + unread counter. */
export async function sendDirectMessage(cid, sender, otherUid, text) {
  const body = String(text || "").trim();
  if (!cid || !sender?.uid || !otherUid) throw new Error("You can't send that message.");
  if (!body) throw new Error("Write a message first.");
  if (body.length > 1000) throw new Error("Messages are limited to 1000 characters.");

  await addDoc(collection(db, "conversations", cid, "messages"), {
    senderId: sender.uid,
    senderUsername: sender.username || "",
    senderName: sender.displayName || "",
    senderPhoto: sender.photoURL || "",
    text: body,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, "conversations", cid), {
    lastMessage: body.slice(0, 120),
    lastSenderId: sender.uid,
    lastMessageAt: serverTimestamp(),
    [`unreadCount.${otherUid}`]: increment(1),
  });
}

/** Zero my unread counter once I've seen the thread. */
export async function markConversationRead(cid, uid) {
  if (!cid || !uid) return;
  await updateDoc(doc(db, "conversations", cid), { [`unreadCount.${uid}`]: 0 }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* engagement counters (views / shares)                                */
/* ------------------------------------------------------------------ */

/** Count one view (rules allow anyone signed in to bump counters only). */
export async function bumpVideoView(videoId) {
  if (!videoId) return;
  await updateDoc(doc(db, "videos", videoId), { viewCount: increment(1) });
}

/** Count one share (Web Share API success or link copy). */
export async function bumpVideoShare(videoId) {
  if (!videoId) return;
  await updateDoc(doc(db, "videos", videoId), { shareCount: increment(1) });
}

/* ------------------------------------------------------------------ */
/* live streaming (browser camera -> Firebase Storage segments -> Firestore) */
/* ------------------------------------------------------------------ */

// Broadcaster records segments of roughly this length; viewer latency is
// about one segment plus upload time (roughly 5–15 seconds end to end).
export const LIVE_SEGMENT_MS = 4000;
// A live doc whose lastPingAt is older than this is considered dead
// (broadcaster closed the tab without ending the stream).
export const LIVE_STALE_MS = 90_000;

export async function createLive(author, title = "") {
  const ref = await addDoc(collection(db, "lives"), {
    uid: author.uid,
    username: author.username,
    displayName: author.displayName,
    photoURL: author.photoURL || "",
    title: String(title || "").trim().slice(0, 120),
    status: "live",
    viewerCount: 0,
    latestSeq: 0,
    segmentCount: 0,
    thumbnailUrl: "",
    giftCount: 0,
    giftCoins: 0,
    likeCount: 0,
    shareCount: 0,
    pinnedChatId: null,
    startedAt: serverTimestamp(),
    lastPingAt: serverTimestamp(),
    endedAt: null,
  });
  return ref.id;
}

export async function getLive(liveId) {
  if (!liveId) return null;
  const snap = await getDoc(doc(db, "lives", liveId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function watchLive(liveId, cb) {
  if (!liveId) return () => {};
  return onSnapshot(
    doc(db, "lives", liveId),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    () => cb(null)
  );
}

export async function endLive(liveId, expectedUid) {
  if (!liveId) return;
  const snap = await getDoc(doc(db, "lives", liveId)).catch(() => null);
  if (!snap || !snap.exists() || snap.data().uid !== expectedUid) return;
  await updateDoc(doc(db, "lives", liveId), { status: "ended", endedAt: serverTimestamp() }).catch(() => {});
}

/** Broadcaster heartbeat so the list can hide dead streams. */
export async function pingLive(liveId) {
  if (!liveId) return;
  await updateDoc(doc(db, "lives", liveId), { lastPingAt: serverTimestamp() }).catch(() => {});
}

/** Broadcaster only: set the stream poster/thumbnail. */
export async function setLiveThumbnail(liveId, url) {
  if (!liveId || !url) return;
  await updateDoc(doc(db, "lives", liveId), { thumbnailUrl: url }).catch(() => {});
}

/** Broadcaster only: publish an uploaded segment and advance the cursor. */
export async function addLiveSegment(liveId, { seq, url, duration = 0, thumbnailUrl = "" }) {
  if (!liveId || !seq || !url) throw new Error("Invalid live segment.");
  await addDoc(collection(db, "lives", liveId, "segments"), {
    seq,
    url,
    duration: Number(duration) || 0,
    thumbnailUrl: thumbnailUrl || "",
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, "lives", liveId), {
    latestSeq: seq,
    segmentCount: increment(1),
    lastPingAt: serverTimestamp(),
  });
}

/** Fetch segments after a sequence number, in order. */
export async function fetchLiveSegments(liveId, fromSeq = 0, max = 4) {
  const snap = await getDocs(
    query(collection(db, "lives", liveId, "segments"), where("seq", ">", fromSeq), orderBy("seq"), limit(max))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Live list, newest first. Tries the composite-indexed query and falls
 * back to an un-ordered query sorted client-side if the index isn't
 * built yet — same pattern as watchConversations.
 */
export function watchActiveLives(onData) {
  let stopped = false;
  let unsubMain = null;
  let unsubFallback = null;
  const baseFilter = where("status", "==", "live");

  const emit = (list) => {
    if (!stopped) onData(list);
  };
  const sortDocs = (docs) =>
    docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ts(b.startedAt) - ts(a.startedAt));

  unsubMain = onSnapshot(
    query(collection(db, "lives"), baseFilter, orderBy("startedAt", "desc"), limit(20)),
    (snap) => emit(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => {
      if (stopped || unsubFallback) return;
      unsubFallback = onSnapshot(
        query(collection(db, "lives"), baseFilter, limit(20)),
        (snap) => emit(sortDocs(snap.docs)),
        () => emit([])
      );
    }
  );

  return () => {
    stopped = true;
    unsubMain?.();
    unsubFallback?.();
  };
}

export async function bumpLiveViewers(liveId, delta) {
  if (!liveId || !delta) return;
  await updateDoc(doc(db, "lives", liveId), { viewerCount: increment(delta) }).catch(() => {});
}

export function watchLiveChat(liveId, onData) {
  return onSnapshot(
    query(collection(db, "lives", liveId, "chat"), orderBy("createdAt", "asc"), limit(150)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => onData([])
  );
}

export async function sendLiveChat(liveId, actor, text) {
  const body = String(text || "").trim();
  if (!liveId || !body) return;
  if (body.length > 300) throw new Error("Chat messages are limited to 300 characters.");
  await addDoc(collection(db, "lives", liveId, "chat"), {
    uid: actor.uid,
    username: actor.username || "",
    displayName: actor.displayName || "",
    photoURL: actor.photoURL || "",
    text: body.slice(0, 300),
    kind: "text",
    createdAt: serverTimestamp(),
  });
}

/* ------------------------------------------------------------------ */
/* live gifts, stickers, reactions                                     */
/* ------------------------------------------------------------------ */

/** Coin-priced gifts viewers can send during a live stream. */
export const LIVE_GIFTS = Object.freeze([
  { id: "rose",      emoji: "🌹", label: "Rose",      coins: 1,   anim: "float" },
  { id: "heart",     emoji: "💖", label: "Heart",     coins: 5,   anim: "float" },
  { id: "fire",      emoji: "🔥", label: "Fire",      coins: 10,  anim: "burst" },
  { id: "star",      emoji: "⭐", label: "Star",      coins: 20,  anim: "burst" },
  { id: "diamond",   emoji: "💎", label: "Diamond",   coins: 50,  anim: "rain" },
  { id: "crown",     emoji: "👑", label: "Crown",     coins: 100, anim: "rain" },
  { id: "lion",      emoji: "🦁", label: "Lion",      coins: 200, anim: "rain" },
  { id: "rocket",    emoji: "🚀", label: "Rocket",    coins: 500, anim: "burst" },
  { id: "trophy",    emoji: "🏆", label: "Trophy",    coins: 1000, anim: "rain" },
  { id: "universe",  emoji: "🌌", label: "Universe",  coins: 2500, anim: "rain" },
]);

/** Stickers that drop into live chat (free). */
export const LIVE_STICKERS = Object.freeze([
  { id: "wave",     emoji: "👋", label: "Wave" },
  { id: "clap",     emoji: "👏", label: "Clap" },
  { id: "love",     emoji: "😍", label: "Love" },
  { id: "lol",      emoji: "😂", label: "LOL" },
  { id: "pray",     emoji: "🙏", label: "Pray" },
  { id: "fire_s",   emoji: "🔥", label: "Fire" },
  { id: "party",    emoji: "🎉", label: "Party" },
  { id: "muscle",   emoji: "💪", label: "Strong" },
  { id: "think",    emoji: "🤔", label: "Hmm" },
  { id: "cry",      emoji: "😢", label: "Sad" },
  { id: "mindblown",emoji: "🤯", label: "Mind blown" },
  { id: "zambia",   emoji: "🇿🇲", label: "Zambia" },
  { id: "gospel",   emoji: "✝️", label: "Gospel" },
  { id: "music",    emoji: "🎵", label: "Music" },
  { id: "camera",   emoji: "📸", label: "Camera" },
  { id: "mic",      emoji: "🎤", label: "Mic" },
]);

/** Quick floating reactions (free, high-frequency). */
export const LIVE_REACTIONS = Object.freeze([
  { id: "heart_r", emoji: "❤️" },
  { id: "fire_r",  emoji: "🔥" },
  { id: "clap_r",  emoji: "👏" },
  { id: "wow_r",   emoji: "😮" },
  { id: "laugh_r", emoji: "😂" },
  { id: "pray_r",  emoji: "🙏" },
]);

export function getGiftById(id) {
  return LIVE_GIFTS.find((g) => g.id === id) || null;
}

export function getStickerById(id) {
  return LIVE_STICKERS.find((s) => s.id === id) || null;
}

/**
 * Send a paid gift during a live stream.
 * Writes to lives/{id}/gifts and bumps giftCoins / giftCount on the live doc.
 * Also posts a chat system line so everyone sees it in the chat feed.
 */
export async function sendLiveGift(liveId, actor, giftId) {
  if (!liveId || !actor?.uid) throw new Error("Sign in to send a gift.");
  const gift = getGiftById(giftId);
  if (!gift) throw new Error("Unknown gift.");

  const payload = {
    uid: actor.uid,
    username: actor.username || "",
    displayName: actor.displayName || "",
    photoURL: actor.photoURL || "",
    giftId: gift.id,
    emoji: gift.emoji,
    label: gift.label,
    coins: gift.coins,
    anim: gift.anim || "float",
    createdAt: serverTimestamp(),
  };

  await addDoc(collection(db, "lives", liveId, "gifts"), payload);
  // Counters only — lastPingAt is host-only per rules.
  await updateDoc(doc(db, "lives", liveId), {
    giftCount: increment(1),
    giftCoins: increment(gift.coins),
  }).catch(() => {});

  // Mirror into chat so the stream feed shows the gift.
  await addDoc(collection(db, "lives", liveId, "chat"), {
    uid: actor.uid,
    username: actor.username || "",
    displayName: actor.displayName || "",
    photoURL: actor.photoURL || "",
    text: `sent ${gift.emoji} ${gift.label}`,
    kind: "gift",
    giftId: gift.id,
    giftEmoji: gift.emoji,
    giftLabel: gift.label,
    giftCoins: gift.coins,
    createdAt: serverTimestamp(),
  }).catch(() => {});

  // Notify the broadcaster (best-effort).
  try {
    const live = await getLive(liveId);
    if (live?.uid && live.uid !== actor.uid) {
      await notify(live.uid, {
        type: "gift",
        fromUid: actor.uid,
        fromName: actor.displayName,
        fromPhoto: actor.photoURL || "",
        fromUsername: actor.username,
        liveId,
        text: `${gift.emoji} ${gift.label} (${gift.coins} coins)`,
      });
    }
  } catch {}

  return gift;
}

/** Free sticker into live chat. */
export async function sendLiveSticker(liveId, actor, stickerId) {
  if (!liveId || !actor?.uid) throw new Error("Sign in to send a sticker.");
  const sticker = getStickerById(stickerId);
  if (!sticker) throw new Error("Unknown sticker.");
  await addDoc(collection(db, "lives", liveId, "chat"), {
    uid: actor.uid,
    username: actor.username || "",
    displayName: actor.displayName || "",
    photoURL: actor.photoURL || "",
    text: sticker.emoji,
    kind: "sticker",
    stickerId: sticker.id,
    stickerEmoji: sticker.emoji,
    stickerLabel: sticker.label,
    createdAt: serverTimestamp(),
  });
  return sticker;
}

/** High-frequency floating reaction (no chat spam). */
export async function sendLiveReaction(liveId, actor, reactionId) {
  if (!liveId || !actor?.uid) throw new Error("Sign in to react.");
  const reaction = LIVE_REACTIONS.find((r) => r.id === reactionId) || LIVE_REACTIONS[0];
  await addDoc(collection(db, "lives", liveId, "reactions"), {
    uid: actor.uid,
    username: actor.username || "",
    emoji: reaction.emoji,
    reactionId: reaction.id,
    createdAt: serverTimestamp(),
  });
  return reaction;
}

/** Live gift feed (newest first, capped). */
export function watchLiveGifts(liveId, onData) {
  if (!liveId) return () => {};
  return onSnapshot(
    query(collection(db, "lives", liveId, "gifts"), orderBy("createdAt", "desc"), limit(40)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => onData([])
  );
}

/** Live reactions stream for floating animation. */
export function watchLiveReactions(liveId, onData) {
  if (!liveId) return () => {};
  return onSnapshot(
    query(collection(db, "lives", liveId, "reactions"), orderBy("createdAt", "desc"), limit(30)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => onData([])
  );
}

/** Top gifters for a stream (client-side aggregate of recent gifts). */
export async function getLiveTopGifters(liveId, max = 10) {
  if (!liveId) return [];
  try {
    const snap = await getDocs(
      query(collection(db, "lives", liveId, "gifts"), orderBy("createdAt", "desc"), limit(200))
    );
    const byUid = new Map();
    snap.docs.forEach((d) => {
      const g = d.data();
      const cur = byUid.get(g.uid) || {
        uid: g.uid,
        username: g.username,
        displayName: g.displayName,
        photoURL: g.photoURL,
        coins: 0,
        count: 0,
      };
      cur.coins += Number(g.coins) || 0;
      cur.count += 1;
      byUid.set(g.uid, cur);
    });
    return [...byUid.values()].sort((a, b) => b.coins - a.coins).slice(0, max);
  } catch {
    return [];
  }
}

/** Soft-like a live (bump likeCount). One bump per call — client throttles. */
export async function bumpLiveLike(liveId) {
  if (!liveId) return;
  await updateDoc(doc(db, "lives", liveId), { likeCount: increment(1) }).catch(() => {});
}

/** Broadcaster can pin a chat message id for highlight. */
export async function pinLiveChat(liveId, messageId, expectedUid) {
  if (!liveId) return;
  const snap = await getDoc(doc(db, "lives", liveId)).catch(() => null);
  if (!snap?.exists() || snap.data().uid !== expectedUid) return;
  await updateDoc(doc(db, "lives", liveId), {
    pinnedChatId: messageId || null,
    updatedAt: serverTimestamp(),
  }).catch(() => {});
}

/** Share counter for lives. */
export async function bumpLiveShare(liveId) {
  if (!liveId) return;
  await updateDoc(doc(db, "lives", liveId), { shareCount: increment(1) }).catch(() => {});
}

/** Update stream title while live (host only). */
export async function updateLiveTitle(liveId, title, expectedUid) {
  if (!liveId) return;
  const snap = await getDoc(doc(db, "lives", liveId)).catch(() => null);
  if (!snap?.exists() || snap.data().uid !== expectedUid) return;
  await updateDoc(doc(db, "lives", liveId), {
    title: String(title || "").trim().slice(0, 120),
    updatedAt: serverTimestamp(),
  }).catch(() => {});
}
