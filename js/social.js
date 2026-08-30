/**
 * Xacheus — Social layer (reactions, comment threads, reposts, blocks,
 * presence, follow requests, stories, profile views, notification settings).
 *
 * Everything in this file writes to Firestore: there are no optimistic-only
 * counters, no localStorage "likes", and no demo data. Counts are maintained
 * with `increment()` and the per-user documents are the source of truth for
 * "have I already done this", so a refresh (or a new device) always shows the
 * truth from the database.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { auth, db } from "./firebase.js";
import {
  notify,
  setDmNotifier,
  setNotifyHook,
  writeNotification,
  ts,
  chunk,
  extractHashtags,
  extractMentions,
  getProfile,
  getVideo,
} from "./data.js";
import { removeObject } from "./storage.js";

/* ------------------------------------------------------------------ */
/* constants shared with firestore.rules                               */
/* ------------------------------------------------------------------ */

/** Xacheus reaction set — familiar, but not Facebook's. */
export const REACTIONS = Object.freeze([
  { key: "love", emoji: "❤️", label: "Love" },
  { key: "like", emoji: "👍", label: "Like" },
  { key: "amen", emoji: "🙏", label: "Amen" },
  { key: "laugh", emoji: "😂", label: "Funny" },
  { key: "wow", emoji: "😮", label: "Wow" },
  { key: "support", emoji: "💪", label: "Support" },
]);
export const REACTION_KEYS = REACTIONS.map((r) => r.key);
export const REACTION_BY_KEY = Object.fromEntries(REACTIONS.map((r) => [r.key, r]));

export const MEDIA_KINDS = Object.freeze(["avatar", "cover", "photo"]);
export const STORY_TTL_MS = 24 * 60 * 60 * 1000;
export const PRESENCE_ONLINE_MS = 75 * 1000;
export const PRESENCE_HEARTBEAT_MS = 45 * 1000;
export const TYPING_WINDOW_MS = 7000;

export const NOTIFICATION_CATEGORIES = Object.freeze([
  { key: "reactions", label: "Reactions", types: ["like", "reaction"] },
  { key: "comments", label: "Comments & replies", types: ["comment", "reply"] },
  { key: "follows", label: "Followers & requests", types: ["follow", "followRequest"] },
  { key: "messages", label: "Messages", types: ["message"] },
  { key: "media", label: "Profile photo & stories", types: ["mediaLike", "mediaComment", "story"] },
  { key: "reposts", label: "Reposts & mentions", types: ["repost", "mention"] },
  { key: "live", label: "Live streams", types: ["gift", "live"] },
]);

export const DEFAULT_PREFS = Object.freeze({
  playback: Object.freeze({
    dataSaver: false,
    autoplayPreviews: true,
    reducedMotion: false,
  }),
  notifications: Object.freeze({
    reactions: true,
    comments: true,
    follows: true,
    messages: true,
    media: true,
    reposts: true,
    live: true,
  }),
  privacy: Object.freeze({
    privateAccount: false,
    showActivity: true,
    showSaved: false,
    showLiked: false,
    whoCanMessage: "everyone", // everyone | followers | nobody
    whoCanComment: "everyone", // everyone | followers
  }),
});

/** Maps a notification `type` to the preference that can switch it off. */
export function categoryForType(type) {
  const found = NOTIFICATION_CATEGORIES.find((c) => c.types.includes(type));
  return found ? found.key : null;
}

/* ------------------------------------------------------------------ */
/* preference-aware notifications                                      */
/* ------------------------------------------------------------------ */

let prefsCache = new Map(); // uid -> { at, prefs }

/**
 * Read a user's stored prefs (cached for a minute — notifications fire often
 * and this keeps a like from costing two reads).
 */
export async function getUserPrefs(uid) {
  if (!uid) return { ...DEFAULT_PREFS };
  const hit = prefsCache.get(uid);
  if (hit && Date.now() - hit.at < 60_000) return hit.prefs;
  let prefs = { ...DEFAULT_PREFS, notifications: { ...DEFAULT_PREFS.notifications }, privacy: { ...DEFAULT_PREFS.privacy } };
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      const data = snap.data().prefs || {};
      prefs = {
        notifications: { ...prefs.notifications, ...(data.notifications || {}) },
        privacy: { ...prefs.privacy, ...(data.privacy || {}) },
      };
    }
  } catch {
    /* treat a read failure as defaults rather than blocking the action */
  }
  prefsCache.set(uid, { at: Date.now(), prefs });
  return prefs;
}

export function clearPrefsCache(uid) {
  if (uid) prefsCache.delete(uid);
  else prefsCache = new Map();
}

/**
 * `notify()` with the recipient's notification settings applied, and a guard
 * for blocks. Silently skips when the recipient muted that category.
 */
export async function notifyUser(toUid, payload) {
  if (!toUid || !payload?.type) return false;
  const fromUid = payload.fromUid || "";
  if (fromUid && (await isBlocking(fromUid, toUid)).blocked) return false;

  const category = categoryForType(payload.type);
  if (category) {
    const prefs = await getUserPrefs(toUid);
    if (prefs.notifications[category] === false) return false;
  }
  await writeNotification(toUid, payload);
  return true;
}

/** Persist my prefs (owner-only write, validated in rules). */
export async function savePrefs(uid, patch) {
  if (!uid) throw new Error("Sign in to change settings.");
  const current = await getUserPrefs(uid);
  const next = {
    notifications: { ...current.notifications, ...(patch.notifications || {}) },
    privacy: { ...current.privacy, ...(patch.privacy || {}) },
    playback: { ...current.playback, ...(patch.playback || {}) },
  };
  // Whitelist: never let an arbitrary key reach the document.
  const allowedMsg = ["everyone", "followers", "nobody"];
  const allowedComment = ["everyone", "followers"];
  next.privacy.whoCanMessage = allowedMsg.includes(next.privacy.whoCanMessage) ? next.privacy.whoCanMessage : "everyone";
  next.privacy.whoCanComment = allowedComment.includes(next.privacy.whoCanComment) ? next.privacy.whoCanComment : "everyone";
  for (const key of Object.keys(next.notifications)) {
    next.notifications[key] = Boolean(next.notifications[key]);
  }
  for (const key of Object.keys(next.playback)) {
    next.playback[key] = Boolean(next.playback[key]);
  }
  // Only the keys we understand reach the document.
  next.playback = pickKnown(next.playback, DEFAULT_PREFS.playback);
  next.notifications = pickKnown(next.notifications, DEFAULT_PREFS.notifications);
  next.privacy = pickKnown(next.privacy, DEFAULT_PREFS.privacy);
  next.privacy.privateAccount = Boolean(next.privacy.privateAccount);
  next.privacy.showActivity = Boolean(next.privacy.showActivity);
  next.privacy.showSaved = Boolean(next.privacy.showSaved);
  next.privacy.showLiked = Boolean(next.privacy.showLiked);

  // `users.private` is the flag firestore.rules checks for content privacy;
  // keep it in lockstep with the pref so the two can never disagree.
  await updateDoc(doc(db, "users", uid), {
    prefs: next,
    private: Boolean(next.privacy.privateAccount),
    updatedAt: serverTimestamp(),
  });
  prefsCache.set(uid, { at: Date.now(), prefs: next });
  return next;
}

function pickKnown(source, template) {
  const out = {};
  for (const key of Object.keys(template)) {
    const value = source[key];
    out[key] = typeof template[key] === "boolean" ? Boolean(value) : value === undefined ? template[key] : value;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* blocking                                                            */
/* ------------------------------------------------------------------ */

export function blockRef(blockerUid, blockedUid) {
  return doc(db, "users", blockerUid, "blocks", blockedUid);
}

export async function blockUser(blockerUid, blocked) {
  if (!blockerUid || !blocked?.uid) throw new Error("Nothing to block.");
  if (blockerUid === blocked.uid) throw new Error("You can't block yourself.");
  await setDoc(blockRef(blockerUid, blocked.uid), {
    uid: blocked.uid,
    username: blocked.username || "",
    displayName: blocked.displayName || "",
    photoURL: blocked.photoURL || "",
    createdAt: serverTimestamp(),
  });
  // A block also ends the connection both ways.
  await Promise.all([
    deleteDoc(doc(db, "follows", blockerUid, "following", blocked.uid)).catch(() => {}),
    deleteDoc(doc(db, "follows", blocked.uid, "followers", blockerUid)).catch(() => {}),
    deleteDoc(doc(db, "follows", blockerUid, "followers", blocked.uid)).catch(() => {}),
    deleteDoc(doc(db, "follows", blocked.uid, "following", blockerUid)).catch(() => {}),
    deleteDoc(doc(db, "followRequests", blockerUid, "requests", blocked.uid)).catch(() => {}),
  ]);
  return true;
}

export async function unblockUser(blockerUid, blockedUid) {
  if (!blockerUid || !blockedUid) return false;
  await deleteDoc(blockRef(blockerUid, blockedUid));
  return true;
}

export async function getBlockList(uid) {
  if (!uid) return [];
  try {
    const snap = await getDocs(query(collection(db, "users", uid, "blocks"), orderBy("createdAt", "desc"), limit(200)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const snap = await getDocs(collection(db, "users", uid, "blocks"));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}

export async function getBlockedIds(uid) {
  const list = await getBlockList(uid);
  return new Set(list.map((b) => b.uid || b.id).filter(Boolean));
}

/**
 * Is either side blocking the other? One read per direction — used before
 * DMs, follows, comments and reactions so blocking is more than a UI filter.
 */
export async function isBlocking(aUid, bUid) {
  if (!aUid || !bUid || aUid === bUid) return { blocked: false, blockedBy: false };
  const [mine, theirs] = await Promise.all([
    getDoc(blockRef(aUid, bUid)).catch(() => null),
    getDoc(blockRef(bUid, aUid)).catch(() => null),
  ]);
  return {
    blocked: Boolean(mine?.exists()),
    blockedBy: Boolean(theirs?.exists()),
  };
}

export async function assertCanInteract(myUid, targetUid) {
  const { blocked, blockedBy } = await isBlocking(myUid, targetUid);
  if (blocked) throw new Error("You've blocked this account. Unblock them first.");
  if (blockedBy) throw new Error("You can't interact with this account.");
  return true;
}

/* ------------------------------------------------------------------ */
/* profile media (avatars, covers, photos)                             */
/* ------------------------------------------------------------------ */

/**
 * `profileMedia/{id}`
 *   uid, username, displayName, kind(avatar|cover|photo), url, storagePath,
 *   caption, isCurrent, likeCount, commentCount, shareCount, viewCount,
 *   reactions {love,like,...}, createdAt, takenAt
 * `profileMedia/{id}/likes/{uid}`     { reaction, createdAt }
 * `profileMedia/{id}/comments/{cid}`  { text, parentId, replyCount, likeCount }
 */
export async function addProfileMedia(author, { kind = "photo", url, storagePath = "", caption = "", takenAt = 0 }) {
  if (!author?.uid) throw new Error("Sign in first.");
  if (!url || String(url).startsWith("blob:")) throw new Error("The image didn't finish uploading — try again.");
  const safeKind = MEDIA_KINDS.includes(kind) ? kind : "photo";

  const ref = await addDoc(collection(db, "profileMedia"), {
    uid: author.uid,
    username: author.username || "",
    displayName: author.displayName || "",
    kind: safeKind,
    url,
    storagePath: storagePath || "",
    caption: String(caption || "").slice(0, 300),
    isCurrent: true,
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    viewCount: 0,
    reactions: Object.fromEntries(REACTION_KEYS.map((k) => [k, 0])),
    createdAt: serverTimestamp(),
    takenAt: Number(takenAt) || 0,
  });

  // Only one "current" avatar/cover per kind — retire the previous ones.
  if (safeKind !== "photo") {
    await retireCurrentMedia(author.uid, safeKind, ref.id);
  }
  return ref.id;
}

async function retireCurrentMedia(uid, kind, keepId) {
  try {
    const snap = await getDocs(
      query(collection(db, "profileMedia"), where("uid", "==", uid), where("kind", "==", kind), where("isCurrent", "==", true), limit(20))
    );
    await Promise.all(
      snap.docs.filter((d) => d.id !== keepId).map((d) => updateDoc(d.ref, { isCurrent: false }).catch(() => {}))
    );
  } catch {
    /* index not built yet: being non-current only affects a badge, so ignore */
  }
}

export async function listProfileMedia(uid, { kind = "", max = 60 } = {}) {
  if (!uid) return [];
  const build = () => {
    const constraints = [where("uid", "==", uid)];
    if (kind) constraints.push(where("kind", "==", kind));
    constraints.push(orderBy("createdAt", "desc"), limit(max));
    return query(collection(db, "profileMedia"), ...constraints);
  };
  try {
    const snap = await getDocs(build());
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    // Unordered fallback so the tab still works before indexes are deployed.
    try {
      const constraints = [where("uid", "==", uid)];
      if (kind) constraints.push(where("kind", "==", kind));
      const snap = await getDocs(query(collection(db, "profileMedia"), ...constraints, limit(max)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
    } catch {
      return [];
    }
  }
}

export async function getProfileMediaItem(id) {
  if (!id) return null;
  const snap = await getDoc(doc(db, "profileMedia", id)).catch(() => null);
  return snap && snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function watchProfileMediaItem(id, onData) {
  if (!id) return () => onData(null);
  return onSnapshot(
    doc(db, "profileMedia", id),
    (snap) => onData(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    () => onData(null)
  );
}

export function watchProfileMedia(uid, onData, { kind = "", max = 60 } = {}) {
  if (!uid) return () => onData([]);
  const constraints = [where("uid", "==", uid)];
  if (kind) constraints.push(where("kind", "==", kind));
  constraints.push(orderBy("createdAt", "desc"), limit(max));
  return onSnapshot(
    query(collection(db, "profileMedia"), ...constraints),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => onData([])
  );
}

export async function setProfileMediaCaption(uid, id, caption) {
  const snap = await getDoc(doc(db, "profileMedia", id));
  if (!snap.exists()) throw new Error("That photo is gone.");
  if (snap.data().uid !== uid) throw new Error("You can only edit your own photos.");
  await updateDoc(doc(db, "profileMedia", id), { caption: String(caption || "").slice(0, 300) });
}

export async function deleteProfileMedia(uid, { asAdmin = false } = {}, id) {
  const snap = await getDoc(doc(db, "profileMedia", id));
  if (!snap.exists()) return false;
  if (!asAdmin && snap.data().uid !== uid) throw new Error("You can only delete your own photos.");
  const data = snap.data();
  if (data.storagePath) await removeObject(data.storagePath).catch(() => {});
  await deleteDoc(doc(db, "profileMedia", id));
  return true;
}

export async function bumpProfileMediaView(id) {
  if (!id) return;
  await updateDoc(doc(db, "profileMedia", id), { viewCount: increment(1) }).catch(() => {});
}

export async function bumpProfileMediaShare(id) {
  if (!id) return;
  await updateDoc(doc(db, "profileMedia", id), { shareCount: increment(1) }).catch(() => {});
}

/* ---- media reactions ---- */

/**
 * Which of these media items have I reacted to, and with what?
 * Per-user state lives at `users/{uid}/mediaReactions/{mediaId}` (document id
 * = media id) so a single read answers "is this mine" and the counter on the
 * media doc answers "how many people reacted".
 */
export async function getMyMediaReactions(uid, mediaIds) {
  const out = new Map();
  if (!uid || !mediaIds.length) return out;
  mediaIds = mediaIds.slice(0, 60);
  await Promise.all(
    chunk(mediaIds, 24).flatMap((group) =>
      group.map(async (id) => {
        const snap = await getDoc(doc(db, "users", uid, "mediaReactions", id)).catch(() => null);
        if (snap && snap.exists()) out.set(id, snap.data().reaction || "like");
      })
    )
  );
  return out;
}

/**
 * React (or un-react) to a profile photo. Writes two things atomically enough
 * for our needs: the per-user record and the aggregate counters on the media
 * doc, so the numbers survive a refresh and are identical on every device.
 */
export async function reactToProfileMedia(uid, actor, media, reactionKey = "love") {
  if (!uid) throw new Error("Sign in to react.");
  if (!media?.id) throw new Error("Nothing to react to.");
  const key = REACTION_KEYS.includes(reactionKey) ? reactionKey : "like";
  if (uid === media.uid) throw new Error("You can't react to your own photo — but it looks great.");
  await assertCanInteract(uid, media.uid);

  const mineRef = doc(db, "users", uid, "mediaReactions", media.id);
  const mineSnap = await getDoc(mineRef);
  const mediaRef = doc(db, "profileMedia", media.id);
  const previous = mineSnap.exists() ? mineSnap.data().reaction : null;

  if (previous === key) {
    await deleteDoc(mineRef);
    await updateDoc(mediaRef, {
      likeCount: increment(-1),
      [`reactions.${key}`]: increment(-1),
    }).catch(() => {});
    return null;
  }

  await setDoc(mineRef, { mediaId: media.id, reaction: key, createdAt: serverTimestamp() });
  const patch = { likeCount: increment(previous ? 0 : 1) };
  patch[`reactions.${key}`] = increment(1);
  if (previous) patch[`reactions.${previous}`] = increment(-1);
  await updateDoc(mediaRef, patch).catch(() => {});

  if (!previous) {
    notifyUser(media.uid, {
      type: "reaction",
      subtype: "media",
      fromUid: uid,
      fromName: actor?.displayName || "",
      fromPhoto: actor?.photoURL || "",
      fromUsername: actor?.username || "",
      mediaId: media.id,
      reaction: key,
      text: media.caption || "",
    }).catch(() => {});
  }
  return key;
}

export async function getMediaReactionCount(uid, mediaId) {
  if (!uid || !mediaId) return null;
  const snap = await getDoc(doc(db, "users", uid, "mediaReactions", mediaId)).catch(() => null);
  return snap && snap.exists() ? snap.data().reaction : null;
}

/**
 * Make a photo the account's avatar or cover: writes the profile field, marks
 * this media current and retires the previous one, so "profile picture history"
 * and the profile header always agree.
 */
export async function setAsCurrentMedia(uid, media) {
  if (!uid || !media?.id) throw new Error("Nothing to set.");
  if (media.uid !== uid) throw new Error("You can only use your own photos.");
  if (!["avatar", "cover"].includes(media.kind)) throw new Error("Only photos you posted can become your picture.");
  const field = media.kind === "cover" ? "coverURL" : "photoURL";
  await updateDoc(doc(db, "users", uid), { [field]: media.url, updatedAt: serverTimestamp() });
  await updateDoc(doc(db, "profileMedia", media.id), { isCurrent: true }).catch(() => {});
  await retireCurrentMedia(uid, media.kind, media.id);
  return true;
}

/** Forget a media item from the history (avatar/cover stays where it is). */
export async function removeFromHistory(uid, mediaId) {
  return deleteProfileMedia(uid, {}, mediaId);
}

/* ---- media comments (threaded) ---- */

export function watchProfileMediaComments(mediaId, onData) {
  if (!mediaId) return () => onData([]);
  return onSnapshot(
    query(collection(db, "profileMedia", mediaId, "comments"), orderBy("createdAt", "asc"), limit(200)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => onData([])
  );
}

export async function addProfileMediaComment(uid, actor, media, text, parentId = "") {
  const body = String(text || "").trim();
  if (!uid) throw new Error("Sign in to comment.");
  if (!body) throw new Error("Write something first.");
  if (body.length > 500) throw new Error("Comments are limited to 500 characters.");
  if (media?.uid) await assertCanInteract(uid, media.uid);

  const replyTo = parentId ? await getDoc(doc(db, "profileMedia", media.id, "comments", parentId)).catch(() => null) : null;

  await addDoc(collection(db, "profileMedia", media.id, "comments"), {
    uid,
    username: actor.username || "",
    displayName: actor.displayName || "",
    photoURL: actor.photoURL || "",
    text: body,
    parentId: parentId || null,
    replyToUsername: replyTo && replyTo.exists() ? replyTo.data().username : null,
    likeCount: 0,
    createdAt: serverTimestamp(),
  });

  const patch = { commentCount: increment(1) };
  if (parentId) {
    await updateDoc(doc(db, "profileMedia", media.id, "comments", parentId), { replyCount: increment(1) }).catch(() => {});
  }
  await updateDoc(doc(db, "profileMedia", media.id), patch).catch(() => {});

  const mentions = extractMentions(body);
  const targets = new Set();
  if (media.uid && media.uid !== uid) targets.add(media.uid);
  if (replyTo && replyTo.exists()) {
    const rUid = replyTo.data().uid;
    if (rUid && rUid !== uid) targets.add(rUid);
  }

  await Promise.all(
    [...targets].map((toUid) =>
      notifyUser(toUid, {
        type: parentId && replyTo && replyTo.data().uid === toUid ? "reply" : "mediaComment",
        fromUid: uid,
        fromName: actor.displayName || "",
        fromPhoto: actor.photoURL || "",
        fromUsername: actor.username || "",
        mediaId: media.id,
        text: body.slice(0, 180),
      }).catch(() => {})
    )
  );

  // @mentions inside a comment notify the mentioned people too.
  mentions
    .map((name) => name)
    .forEach(async (name) => {
      const handle = String(name).toLowerCase();
      if (handle === (media.username || "").toLowerCase()) return;
      try {
        const reserved = await getDoc(doc(db, "usernames", handle));
        if (!reserved.exists()) return;
        const targetUid = reserved.data().uid;
        if (!targetUid || targetUid === uid || targets.has(targetUid)) return;
        await notifyUser(targetUid, {
          type: "mention",
          fromUid: uid,
          fromName: actor.displayName || "",
          fromPhoto: actor.photoURL || "",
          fromUsername: actor.username || "",
          mediaId: media.id,
          text: body.slice(0, 180),
        }).catch(() => {});
      } catch {
        /* mention notification is best-effort */
      }
    });
}

export async function deleteProfileMediaComment(uid, mediaId, commentId, { isAdmin = false } = {}) {
  const ref = doc(db, "profileMedia", mediaId, "comments", commentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const data = snap.data();
  const allowed = isAdmin || data.uid === uid || data.uid === (await getProfileMediaOwner(mediaId));
  if (!allowed) throw new Error("You can only delete your own comments.");
  await deleteDoc(ref);
  const parentActive = !data.parentId;
  await updateDoc(doc(db, "profileMedia", mediaId), { commentCount: increment(parentActive ? -1 : 0) }).catch(() => {});
  return true;
}

async function getProfileMediaOwner(mediaId) {
  const snap = await getDoc(doc(db, "profileMedia", mediaId)).catch(() => null);
  return snap && snap.exists() ? snap.data().uid : "";
}

export async function likeProfileMediaComment(uid, mediaId, commentId) {
  if (!uid) throw new Error("Sign in first.");
  const likeRef = doc(db, "profileMedia", mediaId, "comments", commentId, "likes", uid);
  const snap = await getDoc(likeRef);
  if (snap.exists()) {
    await deleteDoc(likeRef);
    await updateDoc(doc(db, "profileMedia", mediaId, "comments", commentId), { likeCount: increment(-1) }).catch(() => {});
    return false;
  }
  await setDoc(likeRef, { createdAt: serverTimestamp() });
  await updateDoc(doc(db, "profileMedia", mediaId, "comments", commentId), { likeCount: increment(1) }).catch(() => {});
  return true;
}

export async function getLikedMediaCommentIds(uid, mediaId, commentIds) {
  const liked = new Set();
  if (!uid || !mediaId || !commentIds.length) return liked;
  await Promise.all(
    commentIds.slice(0, 120).map(async (cid) => {
      const snap = await getDoc(doc(db, "profileMedia", mediaId, "comments", cid, "likes", uid)).catch(() => null);
      if (snap && snap.exists()) liked.add(cid);
    })
  );
  return liked;
}

/* ------------------------------------------------------------------ */
/* post reactions (videos + photo posts)                               */
/* ------------------------------------------------------------------ */

/**
 * React to a post. `users/{uid}/postReactions/{videoId}` is the single source
 * of truth for "did I react and with what"; the aggregate counters live on the
 * post so every viewer sees the same numbers.
 *
 * Passing the existing `like` behaviour: a `love`/`like` reaction keeps
 * `likeCount` in step so the rest of the app (feed cards, profile grids) stays
 * consistent without a migration.
 */
export async function reactToPost(uid, actor, post, reactionKey) {
  if (!uid) throw new Error("Sign in to react.");
  if (!post?.id) throw new Error("Nothing to react to.");
  const key = REACTION_KEYS.includes(reactionKey) ? reactionKey : "like";
  if (post.uid) await assertCanInteract(uid, post.uid);

  const mineRef = doc(db, "users", uid, "postReactions", post.id);
  const mineSnap = await getDoc(mineRef);
  const previous = mineSnap.exists() ? mineSnap.data().reaction : null;
  const postRef = doc(db, "videos", post.id);

  if (previous === key) {
    await deleteDoc(mineRef);
    await updateDoc(postRef, {
      likeCount: increment(-1),
      [`reactions.${key}`]: increment(-1),
    }).catch(() => {});
    await updateDoc(doc(db, "users", uid), { likesCount: increment(-1) }).catch(() => {});
    // Keep the legacy per-user list in sync so the "Liked" tab stays correct.
    await deleteDoc(doc(db, "users", uid, "likedVideos", post.id)).catch(() => {});
    return null;
  }

  await setDoc(mineRef, { videoId: post.id, reaction: key, createdAt: serverTimestamp() });
  await setDoc(doc(db, "users", uid, "likedVideos", post.id), {
    createdAt: serverTimestamp(),
    videoId: post.id,
    reaction: key,
  });

  const patch = { likeCount: increment(previous ? 0 : 1) };
  patch[`reactions.${key}`] = increment(1);
  if (previous) patch[`reactions.${previous}`] = increment(-1);
  await updateDoc(postRef, patch).catch(() => {});
  if (!previous) await updateDoc(doc(db, "users", uid), { likesCount: increment(1) }).catch(() => {});

  if (!previous && post.uid && post.uid !== uid) {
    notifyUser(post.uid, {
      type: "reaction",
      fromUid: uid,
      fromName: actor?.displayName || "",
      fromPhoto: actor?.photoURL || "",
      fromUsername: actor?.username || "",
      videoId: post.id,
      reaction: key,
      text: (post.caption || "").slice(0, 180),
    }).catch(() => {});
  }
  return key;
}

export async function getMyPostReactions(uid, postIds) {
  const out = new Map();
  if (!uid || !postIds.length) return out;
  await Promise.all(
    chunk(postIds, 20).map(async (group) => {
      await Promise.all(
        group.map(async (id) => {
          const snap = await getDoc(doc(db, "users", uid, "postReactions", id)).catch(() => null);
          if (snap && snap.exists()) out.set(id, snap.data().reaction || "like");
        })
      );
    })
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* threaded comments on posts                                          */
/* ------------------------------------------------------------------ */

/**
 * Reply to a comment on a post. Root comments keep using the existing
 * `addVideoComment` path; replies store `parentId` and bump `replyCount`.
 */
export async function replyToPostComment(uid, actor, post, parentId, text) {
  const body = String(text || "").trim();
  if (!uid) throw new Error("Sign in to reply.");
  if (!post?.id || !parentId) throw new Error("That comment is gone.");
  if (!body) throw new Error("Write a reply first.");
  if (body.length > 500) throw new Error("Replies are limited to 500 characters.");
  if (post.uid) await assertCanInteract(uid, post.uid);

  const parentRef = doc(db, "videos", post.id, "comments", parentId);
  const parentSnap = await getDoc(parentRef).catch(() => null);
  if (!parentSnap || !parentSnap.exists()) throw new Error("The comment you replied to was deleted.");
  const parent = parentSnap.data();

  await addDoc(collection(db, "videos", post.id, "comments"), {
    uid,
    username: actor.username || "",
    displayName: actor.displayName || "",
    photoURL: actor.photoURL || "",
    text: body,
    parentId,
    replyToUsername: parent.username || "",
    likeCount: 0,
    replyCount: 0,
    createdAt: serverTimestamp(),
  });

  await updateDoc(parentRef, { replyCount: increment(1) }).catch(() => {});
  await updateDoc(doc(db, "videos", post.id), { commentCount: increment(1) }).catch(() => {});

  if (parent.uid && parent.uid !== uid) {
    await notifyUser(parent.uid, {
      type: "reply",
      fromUid: uid,
      fromName: actor.displayName || "",
      fromPhoto: actor.photoURL || "",
      fromUsername: actor.username || "",
      videoId: post.id,
      text: body.slice(0, 180),
    }).catch(() => {});
  }
  if (post.uid && post.uid !== uid && post.uid !== parent.uid) {
    await notifyUser(post.uid, {
      type: "comment",
      fromUid: uid,
      fromName: actor.displayName || "",
      fromPhoto: actor.photoURL || "",
      fromUsername: actor.username || "",
      videoId: post.id,
      text: body.slice(0, 180),
    }).catch(() => {});
  }
}

export async function likePostComment(uid, actor, post, commentId) {
  if (!uid) throw new Error("Sign in first.");
  if (post?.uid) await assertCanInteract(uid, post.uid);
  const likeRef = doc(db, "videos", post.id, "comments", commentId, "likes", uid);
  const snap = await getDoc(likeRef);
  if (snap.exists()) {
    await deleteDoc(likeRef);
    await updateDoc(doc(db, "videos", post.id, "comments", commentId), { likeCount: increment(-1) }).catch(() => {});
    return false;
  }
  await setDoc(likeRef, { createdAt: serverTimestamp() });
  await updateDoc(doc(db, "videos", post.id, "comments", commentId), { likeCount: increment(1) }).catch(() => {});

  const commentSnap = await getDoc(doc(db, "videos", post.id, "comments", commentId)).catch(() => null);
  const authorUid = commentSnap && commentSnap.exists() ? commentSnap.data().uid : "";
  if (authorUid && authorUid !== uid) {
    notifyUser(authorUid, {
      type: "reaction",
      subtype: "comment",
      fromUid: uid,
      fromName: actor?.displayName || "",
      fromUsername: actor?.username || "",
      fromPhoto: actor?.photoURL || "",
      videoId: post.id,
      reaction: "like",
      text: commentSnap.data().text?.slice(0, 180) || "",
    }).catch(() => {});
  }
  return true;
}

/** All comments (roots + replies) newest-last; the view builds the threads. */
export function watchPostComments(postId, onData) {
  if (!postId) return () => onData([]);
  return onSnapshot(
    query(collection(db, "videos", postId, "comments"), orderBy("createdAt", "asc"), limit(300)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => onData([])
  );
}

export async function deletePostComment(uid, post, commentId, { isAdmin = false } = {}) {
  const ref = doc(db, "videos", post.id, "comments", commentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const data = snap.data();
  const isPostOwner = post.uid && post.uid === uid;
  if (!(isAdmin || data.uid === uid || isPostOwner)) throw new Error("You can only delete your own comments.");
  await deleteDoc(ref);
  await updateDoc(doc(db, "videos", post.id), { commentCount: increment(-1) }).catch(() => {});
  if (data.parentId) {
    await updateDoc(doc(db, "videos", post.id, "comments", data.parentId), { replyCount: increment(-1) }).catch(() => {});
  }
  return true;
}

export async function getLikedCommentIds(uid, postId, commentIds) {
  const liked = new Set();
  if (!uid || !postId || !commentIds.length) return liked;
  await Promise.all(
    commentIds.slice(0, 120).map(async (cid) => {
      const snap = await getDoc(doc(db, "videos", postId, "comments", cid, "likes", uid)).catch(() => null);
      if (snap && snap.exists()) liked.add(cid);
    })
  );
  return liked;
}

/* ------------------------------------------------------------------ */
/* reposts                                                             */
/* ------------------------------------------------------------------ */

/**
 * Reposting writes a copy into `reposts/` that references the original, plus a
 * counter on the original. The feed renders repost cards from this collection,
 * so the original keeps its own likes/comments and the author gets credit.
 */
export async function repostPost(uid, actor, post, note = "") {
  if (!uid) throw new Error("Sign in to repost.");
  if (!post?.id) throw new Error("Nothing to repost.");
  if (post.uid === uid) throw new Error("You don't need to repost your own content — it's already on your profile.");
  await assertCanInteract(uid, post.uid);

  const mine = await getDoc(doc(db, "users", uid, "reposts", post.id)).catch(() => null);
  if (mine && mine.exists()) {
    await deleteDoc(doc(db, "users", uid, "reposts", post.id));
    await deleteDoc(doc(db, "reposts", mine.data().repostId || post.id)).catch(() => {});
    await updateDoc(doc(db, "videos", post.id), { repostCount: increment(-1) }).catch(() => {});
    return false;
  }

  const repostRef = await addDoc(collection(db, "reposts"), {
    uid,
    username: actor.username || "",
    displayName: actor.displayName || "",
    photoURL: actor.photoURL || "",
    videoId: post.id,
    ownerId: post.uid || "",
    ownerUsername: post.username || "",
    note: String(note || "").slice(0, 300),
    createdAt: serverTimestamp(),
  });
  await setDoc(doc(db, "users", uid, "reposts", post.id), {
    videoId: post.id,
    repostId: repostRef.id,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, "videos", post.id), { repostCount: increment(1) }).catch(() => {});

  if (post.uid) {
    notifyUser(post.uid, {
      type: "repost",
      fromUid: uid,
      fromName: actor.displayName || "",
      fromPhoto: actor.photoURL || "",
      fromUsername: actor.username || "",
      videoId: post.id,
      text: String(note || "").slice(0, 180),
    }).catch(() => {});
  }
  return true;
}

export async function getMyRepostedIds(uid, postIds) {
  const out = new Set();
  if (!uid || !postIds.length) return out;
  await Promise.all(
    postIds.slice(0, 60).map(async (id) => {
      const snap = await getDoc(doc(db, "users", uid, "reposts", id)).catch(() => null);
      if (snap && snap.exists()) out.add(id);
    })
  );
  return out;
}

/** Reposts made by a list of people (the feed), newest first. */
export async function getRepostsByPeople(uids, max = 20) {
  if (!uids || !uids.length) return [];
  try {
    const snap = await getDocs(
      query(collection(db, "reposts"), where("uid", "in", uids.slice(0, 10)), orderBy("createdAt", "desc"), limit(max))
    );
    return hydrateReposts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch {
    try {
      const snap = await getDocs(query(collection(db, "reposts"), where("uid", "in", uids.slice(0, 10)), limit(max)));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
      return hydrateReposts(list);
    } catch {
      return [];
    }
  }
}

async function hydrateReposts(list) {
  const posts = await Promise.all(list.map((r) => getVideo(r.videoId).catch(() => null)));
  return list
    .map((r, i) => ({ ...r, reposted: posts[i] }))
    .filter((r) => r.reposted && !r.deleted);
}

/** Reposts made *by me* — the "Reposts" filter on my own profile. */
export function watchMyReposts(uid, onData) {
  if (!uid) return () => onData([]);
  return onSnapshot(
    query(collection(db, "users", uid, "reposts"), orderBy("createdAt", "desc"), limit(40)),
    async (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const posts = await Promise.all(list.map((r) => getVideo(r.videoId).catch(() => null)));
      onData(list.map((r, i) => ({ ...r, reposted: posts[i] })).filter((r) => r.reposted));
    },
    () => onData([])
  );
}

/* ------------------------------------------------------------------ */
/* presence + typing                                                   */
/* ------------------------------------------------------------------ */

/**
 * `presence/{uid}` — one small doc per account, written by its owner only.
 * Kept out of the user profile so the heartbeat doesn't rewrite (and
 * invalidate) the profile document everyone watches.
 */
export async function heartbeat(uid, { online = true } = {}) {
  if (!uid) return;
  const ref = doc(db, "presence", uid);
  try {
    await setDoc(
      ref,
      { uid, online: Boolean(online), lastActiveAt: serverTimestamp(), updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch {
    /* presence is advisory — never surface an error for it */
  }
}

export async function goOffline(uid) {
  if (!uid) return;
  try {
    await updateDoc(doc(db, "presence", uid), { online: false, updatedAt: serverTimestamp() });
  } catch {
    /* ignore */
  }
}

export async function getPresence(uid) {
  if (!uid) return { online: false, lastActiveAt: 0 };
  const snap = await getDoc(doc(db, "presence", uid)).catch(() => null);
  if (!snap || !snap.exists()) return { online: false, lastActiveAt: 0 };
  const data = snap.data();
  const at = ts(data.lastActiveAt);
  return { online: Boolean(data.online) && Date.now() - at < PRESENCE_ONLINE_MS, lastActiveAt: at };
}

export async function getPresenceMany(uids) {
  const map = new Map();
  const list = [...new Set((uids || []).filter(Boolean))].slice(0, 30);
  await Promise.all(
    list.map(async (uid) => {
      map.set(uid, await getPresence(uid));
    })
  );
  return map;
}

export function watchPresence(uid, onData) {
  if (!uid) return () => onData({ online: false, lastActiveAt: 0 });
  return onSnapshot(
    doc(db, "presence", uid),
    (snap) => {
      const data = snap.exists() ? snap.data() : {};
      const at = ts(data.lastActiveAt);
      onData({ online: Boolean(data.online) && Date.now() - at < PRESENCE_ONLINE_MS, lastActiveAt: at });
    },
    () => onData({ online: false, lastActiveAt: 0 })
  );
}

/** Live "typing…" state stored on the conversation doc (participants only). */
export async function setTyping(cid, uid, isTyping) {
  if (!cid || !uid) return;
  try {
    if (isTyping) {
      await updateDoc(doc(db, "conversations", cid), { [`typing.${uid}`]: serverTimestamp() });
    } else {
      await updateDoc(doc(db, "conversations", cid), { [`typing.${uid}`]: null });
    }
  } catch {
    /* never block sending a message because typing state failed */
  }
}

export function isConversationTyping(conversation, myUid, now = Date.now()) {
  const typing = conversation?.typing || {};
  const otherUid = Object.keys(typing).find((uid) => uid !== myUid);
  if (!otherUid) return false;
  return now - ts(typing[otherUid]) < TYPING_WINDOW_MS;
}

/* ------------------------------------------------------------------ */
/* follow requests (private accounts)                                  */
/* ------------------------------------------------------------------ */

/**
 * `followRequests/{uid}/requests/{fromUid}` — the recipient accepts or
 * ignores. Accepting writes the real follow documents.
 */
export async function requestFollow(uid, actor, target) {
  if (!uid) throw new Error("Sign in to follow.");
  if (!target?.uid || uid === target.uid) throw new Error("Can't follow this account.");
  await assertCanInteract(uid, target.uid);
  await setDoc(doc(db, "followRequests", target.uid, "requests", uid), {
    uid,
    username: actor.username || "",
    displayName: actor.displayName || "",
    photoURL: actor.photoURL || "",
    status: "pending",
    createdAt: serverTimestamp(),
    resolvedAt: null,
  });
  await notifyUser(target.uid, {
    type: "followRequest",
    fromUid: uid,
    fromName: actor.displayName || "",
    fromPhoto: actor.photoURL || "",
    fromUsername: actor.username || "",
    text: "",
  }).catch(() => {});
  return "requested";
}

export async function cancelFollowRequest(uid, targetUid) {
  if (!uid || !targetUid) return false;
  await deleteDoc(doc(db, "followRequests", targetUid, "requests", uid)).catch(() => {});
  return true;
}

/** Remove a follower from one of my (private or open) accounts. */
export async function removeFollower(ownerUid, followerUid) {
  if (!ownerUid || !followerUid || ownerUid === followerUid) return false;
  await Promise.all([
    deleteDoc(doc(db, "follows", followerUid, "following", ownerUid)).catch(() => {}),
    deleteDoc(doc(db, "follows", ownerUid, "followers", followerUid)).catch(() => {}),
  ]);
  return true;
}

export async function listFollowRequests(uid) {
  if (!uid) return [];
  try {
    const snap = await getDocs(
      query(collection(db, "followRequests", uid, "requests"), where("status", "==", "pending"), orderBy("createdAt", "desc"), limit(50))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const snap = await getDocs(query(collection(db, "followRequests", uid, "requests"), limit(50))).catch(() => null);
    if (!snap) return [];
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => r.status === "pending")
      .sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
  }
}

/** Accept a request -> real follow docs + counters + notification. */
export async function acceptFollowRequest(ownerUid, request, { source } = {}) {
  if (!ownerUid || !request?.uid) throw new Error("That request is gone.");
  const requester = await getProfile(request.uid);
  if (!requester) throw new Error("We couldn't load that account.");

  const batch = writeBatch(db);
  batch.set(doc(db, "follows", requester.uid, "following", ownerUid), {
    uid: ownerUid,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, "follows", ownerUid, "followers", requester.uid), {
    uid: requester.uid,
    createdAt: serverTimestamp(),
  });
  batch.update(doc(db, "users", requester.uid), { followingCount: increment(1) });
  batch.update(doc(db, "users", ownerUid), { followersCount: increment(1) });
  batch.set(doc(db, "followRequests", ownerUid, "requests", requester.uid), {
    status: "accepted",
    resolvedAt: serverTimestamp(),
  });
  await batch.commit();

  notifyUser(requester.uid, {
    type: "followAccepted",
    fromUid: ownerUid,
    fromName: source?.displayName || "",
    fromPhoto: source?.photoURL || "",
    fromUsername: source?.username || "",
    text: "",
  }).catch(() => {});
  return true;
}

export async function declineFollowRequest(ownerUid, requesterUid) {
  if (!ownerUid || !requesterUid) return false;
  await updateDoc(doc(db, "followRequests", ownerUid, "requests", requesterUid), {
    status: "declined",
    resolvedAt: serverTimestamp(),
  }).catch(async () => {
    await deleteDoc(doc(db, "followRequests", ownerUid, "requests", requesterUid)).catch(() => {});
  });
  return true;
}

/** Everything waiting on my approval, for the profile badge + inbox tab. */
export function watchFollowRequests(uid, onData) {
  if (!uid) return () => onData([]);
  return onSnapshot(
    query(collection(db, "followRequests", uid, "requests"), limit(80)),
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => r.status === "pending")
        .sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
      onData(list);
    },
    () => onData([])
  );
}

/* ------------------------------------------------------------------ */
/* stories (24 hours)                                                  */
/* ------------------------------------------------------------------ */

/**
 * `stories/{id}` with `expiresAt` written by the client and enforced in rules.
 * Views keep `stories/{id}/views/{uid}` so a view is counted once per person.
 */
export async function addStory(author, { kind = "photo", url, storagePath = "", text = "", link = "" }) {
  if (!author?.uid) throw new Error("Sign in first.");
  if (!url || String(url).startsWith("blob:")) throw new Error("Your story media didn't finish uploading.");
  const expiresAt = new Date(Date.now() + STORY_TTL_MS);
  const payload = {
    uid: author.uid,
    username: author.username || "",
    displayName: author.displayName || "",
    photoURL: author.photoURL || "",
    kind: kind === "video" ? "video" : "photo",
    url,
    storagePath: storagePath || "",
    text: String(text || "").slice(0, 280),
    link: String(link || "").slice(0, 200),
    viewCount: 0,
    replyCount: 0,
    reactions: Object.fromEntries(REACTION_KEYS.map((k) => [k, 0])),
    createdAt: serverTimestamp(),
    expiresAt,
  };
  const ref = await addDoc(collection(db, "stories"), payload);
  return ref.id;
}

export async function listActiveStories(uids, { max = 40, includeUid = "", everyone = false } = {}) {
  const constraints = [where("expiresAt", ">", new Date()), orderBy("createdAt", "desc"), limit(max)];
  const fetchFor = async (filter) => {
    try {
      const snap = await getDocs(query(collection(db, "stories"), ...(filter ? [filter] : []), ...constraints));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch {
      try {
        const snap = await getDocs(
          query(collection(db, "stories"), ...(filter ? [filter] : []), where("expiresAt", ">", new Date()), limit(max))
        );
        return snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
      } catch {
        return [];
      }
    }
  };

  const all = [];
  if (includeUid) all.push(...(await fetchFor(where("uid", "==", includeUid))).filter((s) => s.uid === includeUid));
  const list = await fetchFor(null);
  const allowed = new Set(uids || []);
  for (const story of list) {
    if (all.some((s) => s.id === story.id)) continue;
    // `everyone` is the guest mode: no follow graph to filter by, so the tray
    // shows every active story Firestore lets it read (public accounts only —
    // private-account stories are cut by the security rules).
    if (everyone || allowed.has(story.uid) || story.uid === includeUid) all.push(story);
  }
  return all.sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
}

export async function markStoryViewed(storyId, uid) {
  if (!storyId || !uid) return false;
  const ref = doc(db, "stories", storyId, "views", uid);
  const snap = await getDoc(ref).catch(() => null);
  if (snap && snap.exists()) return false;
  await setDoc(ref, { createdAt: serverTimestamp() }).catch(() => {});
  // A mirror on my own account so the story tray can tell seen from unseen
  // with one read instead of one per story.
  await setDoc(doc(db, "users", uid, "storyViews", storyId), { storyId, at: serverTimestamp() }, { merge: true }).catch(() => {});
  await updateDoc(doc(db, "stories", storyId), { viewCount: increment(1) }).catch(() => {});
  return true;
}

export async function getSeenStoryIds(uid, max = 120) {
  if (!uid) return new Set();
  const snap = await getDocs(query(collection(db, "users", uid, "storyViews"), limit(max))).catch(() => null);
  return new Set((snap?.docs || []).map((d) => d.id));
}

/** Flag which of these stories I have already opened (real read, no guessing). */
export async function attachSeenState(stories, uid) {
  const seen = await getSeenStoryIds(uid);
  return (stories || []).map((s) => ({ ...s, viewedByMe: seen.has(s.id) }));
}

export async function getStoryViewers(storyId, max = 50) {
  if (!storyId) return [];
  const snap = await getDocs(query(collection(db, "stories", storyId, "views"), limit(max))).catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

export async function reactToStory(uid, actor, story, reactionKey = "love") {
  if (!uid) throw new Error("Sign in to react.");
  const key = REACTION_KEYS.includes(reactionKey) ? reactionKey : "like";
  const ref = doc(db, "stories", story.id, "reactions", uid);
  const snap = await getDoc(ref).catch(() => null);
  if (snap && snap.exists() && snap.data().reaction === key) {
    await deleteDoc(ref);
    await updateDoc(doc(db, "stories", story.id), { [`reactions.${key}`]: increment(-1) }).catch(() => {});
    return null;
  }
  await setDoc(ref, { reaction: key, createdAt: serverTimestamp() }).catch(() => {});
  await updateDoc(doc(db, "stories", story.id), { [`reactions.${key}`]: increment(1) }).catch(() => {});
  if (story.uid && story.uid !== uid) {
    notifyUser(story.uid, {
      type: "reaction",
      subtype: "story",
      fromUid: uid,
      fromName: actor?.displayName || "",
      fromPhoto: actor?.photoURL || "",
      fromUsername: actor?.username || "",
      storyId: story.id,
      reaction: key,
      text: (story.text || "").slice(0, 120),
    }).catch(() => {});
  }
  return key;
}

export async function deleteStory(uid, storyId, { asAdmin = false } = {}) {
  const snap = await getDoc(doc(db, "stories", storyId)).catch(() => null);
  if (!snap || !snap.exists()) return false;
  if (!asAdmin && snap.data().uid !== uid) throw new Error("You can only delete your own stories.");
  if (snap.data().storagePath) removeObject(snap.data().storagePath).catch(() => {});
  await deleteDoc(doc(db, "stories", storyId));
  return true;
}

export async function storyReplyToMessage(uid, actor, story, text) {
  const body = String(text || "").trim();
  if (!body) throw new Error("Write a reply first.");
  if (!story.uid || story.uid === uid) throw new Error("You can't reply to yourself.");
  await assertCanInteract(uid, story.uid);
  const cid = [uid, story.uid].sort().join("__");
  await updateDoc(doc(db, "conversations", cid), { updatedAt: serverTimestamp() }).catch(() => {});
  return cid;
}

/* ------------------------------------------------------------------ */
/* profile views + activity                                            */
/* ------------------------------------------------------------------ */

/** Count a profile visit once per visitor per day. */
export async function recordProfileView(viewerUid, ownerUid) {
  if (!viewerUid || !ownerUid || viewerUid === ownerUid) return false;
  const day = new Date().toISOString().slice(0, 10);
  const ref = doc(db, "users", ownerUid, "profileViews", `${viewerUid}_${day}`);
  const snap = await getDoc(ref).catch(() => null);
  if (snap && snap.exists()) return false;
  await setDoc(
    ref,
    {
      uid: viewerUid,
      username: (await getProfile(viewerUid).catch(() => null))?.username || "",
      createdAt: serverTimestamp(),
    },
    { merge: true }
  ).catch(() => {});
  await updateDoc(doc(db, "users", ownerUid), { profileViewCount: increment(1) }).catch(() => {});
  return true;
}

export async function listProfileViewers(uid, max = 30) {
  if (!uid) return [];
  try {
    const snap = await getDocs(query(collection(db, "users", uid, "profileViews"), orderBy("createdAt", "desc"), limit(max)));
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const seen = new Set();
    const people = [];
    for (const row of rows) {
      if (seen.has(row.uid)) continue;
      seen.add(row.uid);
      const profile = await getProfile(row.uid).catch(() => null);
      if (profile) people.push({ ...profile, viewedAt: ts(row.createdAt) });
    }
    return people;
  } catch {
    return [];
  }
}

/**
 * Profile activity — the things a person did that are public by nature:
 * their posts, their profile media, and their comments (the "show my activity"
 * privacy switch is respected in `buildActivity`).
 */
export async function buildActivity(uid, { includeComments = true, max = 24 } = {}) {
  const [posts, media, comments] = await Promise.all([
    getDocs(query(collection(db, "videos"), where("uid", "==", uid), orderBy("createdAt", "desc"), limit(max)))
      .then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })))
      .catch(() => []),
    listProfileMedia(uid, { max }),
    includeComments ? fetchUserComments(uid, max) : Promise.resolve([]),
  ]);

  const events = [
    ...posts.map((p) => ({
      id: `post_${p.id}`,
      type: p.mediaType === "photo" ? "photo_post" : "video",
      at: ts(p.createdAt),
      videoId: p.id,
      text: (p.caption || "").slice(0, 160),
      thumb: p.thumbnailUrl || (Array.isArray(p.images) ? p.images[0] : ""),
      counts: { likes: Number(p.likeCount) || 0, comments: Number(p.commentCount) || 0 },
    })),
    ...media.map((m) => ({
      id: `media_${m.id}`,
      type: m.kind === "avatar" ? "avatar" : m.kind === "cover" ? "cover" : "photo",
      at: ts(m.createdAt),
      mediaId: m.id,
      text: (m.caption || "").slice(0, 160),
      thumb: m.url,
      counts: { likes: Number(m.likeCount) || 0, comments: Number(m.commentCount) || 0 },
    })),
    ...comments.map((c) => ({
      id: `comment_${c.id}`,
      type: "comment",
      at: ts(c.createdAt),
      videoId: c.postId,
      text: (c.text || "").slice(0, 160),
      thumb: c.postThumb || "",
      counts: {},
    })),
  ];

  return events.sort((a, b) => b.at - a.at).slice(0, max);
}

/** Comments the user wrote (across posts + profile media), best-effort. */
async function fetchUserComments(uid, max) {
  const out = [];
  try {
    const snap = await getDocs(
      query(collection(db, "videos"), where("uid", "==", uid), orderBy("commentCount", "desc"), limit(12))
    );
    for (const d of snap.docs) {
      const cs = await getDocs(query(collection(db, "videos", d.id, "comments"), where("uid", "==", uid), limit(6))).catch(() => null);
      cs?.forEach((c) => out.push({ id: c.id, postId: d.id, postThumb: d.data().thumbnailUrl || "", text: c.data().text, createdAt: c.data().createdAt }));
      if (out.length >= max * 2) break;
    }
  } catch {
    /* activity just shows less when a query fails */
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* saved collections                                                   */
/* ------------------------------------------------------------------ */

/**
 * `users/{uid}/savedVideos/{videoId}` stays the flat "Saved" list; collections
 * add folders so people can organise what they keep.
 */
export async function listSavedCollections(uid) {
  if (!uid) return [];
  const snap = await getDocs(collection(db, "users", uid, "savedCollections")).catch(() => null);
  if (!snap) return [];
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function createSavedCollection(uid, name) {
  const clean = String(name || "").trim().slice(0, 40);
  if (!clean) throw new Error("Give the collection a name.");
  if (!uid) throw new Error("Sign in first.");
  const ref = doc(db, "users", uid, "savedCollections", clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40));
  await setDoc(ref, { name: clean, createdAt: serverTimestamp(), count: 0 });
  return { id: ref.id, name: clean };
}

export async function deleteSavedCollection(uid, collectionId) {
  if (!uid || !collectionId) return false;
  await deleteDoc(doc(db, "users", uid, "savedCollections", collectionId)).catch(() => {});
  return true;
}

export async function saveToCollection(uid, videoId, collectionId) {
  if (!uid) throw new Error("Sign in first.");
  await setDoc(doc(db, "users", uid, "savedCollections", collectionId, "items", videoId), {
    videoId,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, "users", uid, "savedCollections", collectionId), { count: increment(1) }).catch(() => {});
  await setDoc(doc(db, "users", uid, "savedVideos", videoId), { videoId, createdAt: serverTimestamp(), collection: collectionId }, { merge: true });
  return true;
}

export async function removeFromCollection(uid, videoId, collectionId) {
  if (!uid) throw new Error("Sign in first.");
  await deleteDoc(doc(db, "users", uid, "savedCollections", collectionId, "items", videoId)).catch(() => {});
  await updateDoc(doc(db, "users", uid, "savedCollections", collectionId), { count: increment(-1) }).catch(() => {});
  return true;
}

/* ------------------------------------------------------------------ */
/* notifications: mark-all-read + follow-request badge                 */
/* ------------------------------------------------------------------ */

export async function markAllNotificationsRead(uid) {
  if (!uid) return 0;
  const snap = await getDocs(
    query(collection(db, "notifications"), where("toUid", "==", uid), where("read", "==", false), limit(200))
  ).catch(() => null);
  if (!snap) return 0;
  const docs = snap.docs;
  let count = 0;
  for (const group of chunk(docs, 25)) {
    const batch = writeBatch(db);
    group.forEach((d) => {
      batch.update(d.ref, { read: true });
      count += 1;
    });
    await batch.commit().catch(() => {});
  }
  return count;
}

export async function deleteNotification(uid, id) {
  const snap = await getDoc(doc(db, "notifications", id)).catch(() => null);
  if (!snap || !snap.exists() || snap.data().toUid !== uid) throw new Error("You can only delete your own notifications.");
  await deleteDoc(doc(db, "notifications", id));
  return true;
}

/* ------------------------------------------------------------------ */
/* misc helpers used by views                                          */
/* ------------------------------------------------------------------ */

/** Can `visitor` open a DM with `target`? (privacy setting + blocks) */
export async function canMessage(target) {
  if (!target?.uid) return { ok: false, reason: "This account doesn't exist." };
  const viewerUid = auth?.currentUser?.uid || "";
  if (!viewerUid) return { ok: false, reason: "Sign in to send messages.", needAuth: true };
  if (viewerUid === target.uid) return { ok: false, reason: "You can't message yourself." };
  const { blocked, blockedBy } = await isBlocking(viewerUid, target.uid);
  if (blocked) return { ok: false, reason: "You've blocked this account. Unblock them to talk again." };
  if (blockedBy) return { ok: false, reason: "You can't message this account." };
  const prefs = await getUserPrefs(target.uid);
  const mode = prefs.privacy.whoCanMessage;
  if (mode === "nobody") return { ok: false, reason: "This account doesn't accept messages." };
  if (mode === "followers") {
    const following = await isFollowingTarget(target.uid, viewerUid);
    if (!following) return { ok: false, reason: "This account only accepts messages from people who follow them." };
  }
  return { ok: true };
}

/** Can `visitor` comment on `target`'s content? */
export async function canComment(target) {
  if (!target?.uid) return { ok: false, reason: "This account doesn't exist." };
  const viewerUid = auth?.currentUser?.uid || "";
  if (!viewerUid) return { ok: false, reason: "Sign in to comment.", needAuth: true };
  const prefs = await getUserPrefs(target.uid);
  if (prefs.privacy.whoCanComment === "followers" && target.uid !== viewerUid) {
    const following = await isFollowingTarget(target.uid, viewerUid);
    if (!following) return { ok: false, reason: "This account only allows comments from followers." };
  }
  return { ok: true };
}

async function isFollowingTarget(ownerUid, visitorUid) {
  if (!ownerUid || !visitorUid) return false;
  const snap = await getDoc(doc(db, "follows", visitorUid, "following", ownerUid)).catch(() => null);
  return Boolean(snap && snap.exists());
}

/** Is this profile private, and am I not allowed to see its content? */
export async function getAccessState(profile, myUid) {
  if (!profile?.uid) return { locked: true, reason: "Profile not found." };
  if (myUid === profile.uid) return { locked: false, reason: "" };
  const prefs = await getUserPrefs(profile.uid);
  const isPrivate = Boolean(profile.private ?? prefs.privacy.privateAccount);
  if (!isPrivate) return { locked: false, reason: "" };
  if (!myUid) return { locked: true, reason: "This account is private. Sign in to send a follow request.", needAuth: true };
  const following = await isFollowingTarget(profile.uid, myUid);
  if (following) return { locked: false, reason: "" };
  const req = await getDoc(doc(db, "followRequests", profile.uid, "requests", myUid)).catch(() => null);
  const status = req && req.exists() ? req.data().status : "";
  if (status === "pending") return { locked: true, reason: "Your follow request is pending approval.", requested: true };
  if (status === "declined") return { locked: true, reason: "This account is private.", declined: true };
  return { locked: true, reason: "This account is private.", canRequest: true };
}

export function hashtagsOf(text) {
  return extractHashtags(text);
}

export function relTimeOrDate(value) {
  const at = ts(value);
  if (!at) return "";
  return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Direct messages need the same rules as everything else: respect the
 * recipient's notification settings and refuse to notify through a block.
 * `sendDirectMessage` calls whatever is installed here.
 */
setDmNotifier(notifyUser);
setNotifyHook(notifyUser);

export { getVideo };
