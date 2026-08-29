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
 *   sounds/{soundId}                         sounds library (free + original)
 *   follows/{uid}/following/{targetUid}
 *   follows/{uid}/followers/{followerUid}
 *   notifications/{nid}
 *   hashtags/{tag}                           trending counters
 *   posts/{postId}                           legacy (kept for compat, read-only)
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

export async function isUsernameTaken(username) {
  const handle = normaliseUsername(username);
  if (!handle) return true;
  const snap = await getDoc(doc(db, "usernames", handle));
  return snap.exists();
}

export async function suggestUsername(base) {
  const stem = normaliseUsername(base) || "user";
  for (let i = 0; i < 60; i += 1) {
    const candidate = i === 0 ? stem.slice(0, 20) : `${stem.slice(0, 15)}${Math.floor(100 + Math.random() * 900)}`;
    if (!usernameError(candidate) && !(await isUsernameTaken(candidate))) return candidate;
  }
  return `${stem.slice(0, 10)}${Date.now().toString().slice(-6)}`;
}

export async function ensureProfile(user, extra = {}) {
  if (!user) return null;
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    // Ensure role field exists (migration)
    if (!data.role) {
      await updateDoc(ref, { role: DEFAULT_ROLE }).catch(() => {});
      data.role = DEFAULT_ROLE;
    }
    return { id: snap.id, ...data };
  }

  const seed = normaliseUsername(extra.username || user.displayName || (user.email || "").split("@")[0] || "user") || "user";
  const seedIsUsable = !usernameError(seed) && !(await isUsernameTaken(seed));
  const username = seedIsUsable ? seed : await suggestUsername(seed);
  const displayName = extra.displayName || user.displayName || username;

  const profile = {
    uid: user.uid,
    username,
    displayNameLower: displayName.toLowerCase(),
    displayName: extra.displayName || user.displayName || username,
    email: user.email || "",
    photoURL: user.photoURL || "",
    coverURL: "",
    bio: extra.bio || "",
    location: "",
    website: "",
    role: extra.role && ROLES.includes(extra.role) ? extra.role : DEFAULT_ROLE,
    verified: false,
    followersCount: 0,
    followingCount: 0,
    videosCount: 0,
    postsCount: 0,
    likesCount: 0,
    createdAt: serverTimestamp(),
  };

  await setDoc(ref, profile);
  await setDoc(doc(db, "usernames", username), { uid: user.uid, createdAt: serverTimestamp() });
  return profile;
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
  thumbnailUrl = "",
  caption = "",
  soundId = null,
  soundTitle = "",
  soundUrl = null,
  duration = 0,
  width = 0,
  height = 0,
  cloudinaryPublicId = "",
}) {
  const cap = String(caption || "").trim().slice(0, 1000);
  if (!videoUrl) throw new Error("Video URL missing");

  const hashtags = extractHashtags(cap);
  const mentions = extractMentions(cap);

  const payload = {
    uid: author.uid,
    username: author.username,
    displayName: author.displayName,
    photoURL: author.photoURL || "",
    videoUrl,
    thumbnailUrl: thumbnailUrl || "",
    caption: cap,
    hashtags,
    mentions,
    soundId: soundId || null,
    soundTitle: soundTitle || (soundId ? "Original sound" : ""),
    soundUrl: soundUrl || null,
    duration: Number(duration) || 0,
    width: Number(width) || 0,
    height: Number(height) || 0,
    cloudinaryPublicId: cloudinaryPublicId || "",
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

  // increment sound useCount
  if (soundId) {
    updateDoc(doc(db, "sounds", soundId), { useCount: increment(1), lastUsedAt: serverTimestamp() }).catch(() => {});
  }

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
/* sounds                                                              */
/* ------------------------------------------------------------------ */

// Curated royalty-free sounds (properly usable, not copyrighted)
// These are from Pixabay / Mixkit free library - attribution free, usable for this app.
// We store them as seed data if sounds collection empty.
export const CURATED_FREE_SOUNDS = [
  {
    id: "free_001",
    title: "Lo-Fi Chill",
    artist: "Free Music",
    genre: "lofi",
    audioUrl: "https://cdn.pixabay.com/download/audio/2022/03/10/audio_c8c8a650cd.mp3?filename=lofi-study-112191.mp3",
    coverUrl: "",
    duration: 140,
    isFree: true,
    isOriginal: false,
    useCount: 0,
  },
  {
    id: "free_002",
    title: "Afrobeat Vibe",
    artist: "Afro Free",
    genre: "afrobeat",
    audioUrl: "https://cdn.pixabay.com/download/audio/2022/06/07/audio_b9bd4170e8.mp3?filename=african-drums-112198.mp3",
    coverUrl: "",
    duration: 90,
    isFree: true,
    isOriginal: false,
    useCount: 0,
  },
  {
    id: "free_003",
    title: "Gospel Uplift",
    artist: "Church Free",
    genre: "gospel",
    audioUrl: "https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c2d1b6.mp3?filename=happy-ukulele-101225.mp3",
    coverUrl: "",
    duration: 110,
    isFree: true,
    isOriginal: false,
    useCount: 0,
  },
  {
    id: "free_004",
    title: "Zambian Sunset",
    artist: "Zed Beats Free",
    genre: "afro",
    audioUrl: "https://cdn.pixabay.com/download/audio/2022/10/30/audio_8e2b3e0b8c.mp3?filename=african-village-134939.mp3",
    coverUrl: "",
    duration: 95,
    isFree: true,
    isOriginal: false,
    useCount: 0,
  },
  {
    id: "free_005",
    title: "Upbeat Pop",
    artist: "Pop Free",
    genre: "pop",
    audioUrl: "https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c6fa4e.mp3?filename=energetic-101247.mp3",
    coverUrl: "",
    duration: 120,
    isFree: true,
    isOriginal: false,
    useCount: 0,
  },
];

export async function getSounds({ limitCount = 30, onlyFree = false } = {}) {
  let q = query(collection(db, "sounds"), orderBy("useCount", "desc"), limit(limitCount));
  if (onlyFree) {
    q = query(collection(db, "sounds"), where("isFree", "==", true), orderBy("useCount", "desc"), limit(limitCount));
  }
  const snap = await getDocs(q);
  if (snap.empty) {
    // return curated if DB empty
    return CURATED_FREE_SOUNDS.slice(0, limitCount);
  }
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function watchTrendingSounds(onData, pageSize = 20) {
  return onSnapshot(
    query(collection(db, "sounds"), orderBy("useCount", "desc"), limit(pageSize)),
    (snap) => {
      if (snap.empty) {
        onData(CURATED_FREE_SOUNDS);
      } else {
        onData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    },
    () => onData(CURATED_FREE_SOUNDS)
  );
}

export async function createSound(author, { title, audioUrl, coverUrl = "", duration = 0, genre = "original" }) {
  if (!title || !audioUrl) throw new Error("Sound needs title and audio");
  const payload = {
    title: String(title).slice(0, 80),
    artist: author.displayName || author.username,
    artistUid: author.uid,
    artistUsername: author.username,
    audioUrl,
    coverUrl: coverUrl || author.photoURL || "",
    duration: Number(duration) || 0,
    genre,
    useCount: 0,
    isFree: false,
    isOriginal: true,
    createdAt: serverTimestamp(),
    lastUsedAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, "sounds"), payload);
  return ref.id;
}

export async function getSound(soundId) {
  if (!soundId) return null;
  // Check curated first
  const curated = CURATED_FREE_SOUNDS.find((s) => s.id === soundId);
  if (curated) return curated;
  const snap = await getDoc(doc(db, "sounds", soundId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function watchSounds(onData, pageSize = 30) {
  return onSnapshot(
    query(collection(db, "sounds"), orderBy("createdAt", "desc"), limit(pageSize)),
    (snap) => {
      if (snap.empty) onData(CURATED_FREE_SOUNDS);
      else onData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    () => onData(CURATED_FREE_SOUNDS)
  );
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

/* Legacy posts kept for migration - read only helpers */
export async function getPost(postId) {
  const snap = await getDoc(doc(db, "posts", postId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
