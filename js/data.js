/**
 * Xacheus Social — Firestore data layer.
 *
 * Collections
 *   users/{uid}                              profile + counters
 *   usernames/{username}                     unique handle reservation
 *   posts/{postId}                           feed posts
 *   posts/{postId}/comments/{cid}            replies
 *   users/{uid}/liked/{postId}               "I liked this" (fast lookup)
 *   users/{uid}/reposted/{postId}
 *   users/{uid}/saved/{postId}
 *   follows/{uid}/following/{targetUid}      directed follow graph
 *   follows/{uid}/followers/{followerUid}
 *   notifications/{nid}                      toUid + type + payload
 *   hashtags/{tag}                           trending counters
 *   conversations/{cid}/messages/{mid}       direct messages
 */

import {
  addDoc,
  arrayRemove,
  arrayUnion,
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
  "explore", "messages", "notifications", "login", "signup", "about",
  "me", "profile", "post", "search", "api", "www", "null", "undefined",
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

/* ------------------------------------------------------------------ */
/* profiles                                                            */
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

/**
 * Create the Firestore profile for a freshly authenticated user.
 * Safe to call on every sign-in — it only writes when the profile is missing.
 */
export async function ensureProfile(user, extra = {}) {
  if (!user) return null;
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return { id: snap.id, ...snap.data() };

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
    displayName: extra.displayName || user.displayName || username,
    email: user.email || "",
    photoURL: user.photoURL || "",
    bio: extra.bio || "",
    location: "",
    website: "",
    verified: false,
    private: false,
    theme: "dark",
    followersCount: 0,
    followingCount: 0,
    postsCount: 0,
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
  await updateDoc(doc(db, "users", uid), { ...patch, updatedAt: serverTimestamp() });
}

/** Change a handle, keeping the reservation collection in sync. */
export async function changeUsername(uid, nextRaw) {
  const next = normaliseUsername(nextRaw);
  const problem = usernameError(next);
  if (problem) throw new Error(problem);

  const current = await getProfile(uid);
  if (!current) throw new Error("Profile not found.");
  if (current.username === next) return next;

  const taken = await getDoc(doc(db, "usernames", next));
  if (taken.exists() && taken.data().uid !== uid) throw new Error("That handle is already taken.");

  // Claim the new handle first, then release the old one, so we never hold zero.
  await setDoc(doc(db, "usernames", next), { uid, createdAt: serverTimestamp() });
  await updateDoc(doc(db, "users", uid), { username: next });
  if (current.username && current.username !== next) {
    await deleteDoc(doc(db, "usernames", current.username)).catch(() => {});
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* posts                                                               */
/* ------------------------------------------------------------------ */

export function extractHashtags(text) {
  const found = String(text || "")
    .toLowerCase()
    .match(/#([a-z0-9_]{2,30})/g);
  return found ? [...new Set(found.map((tag) => tag.slice(1)))] : [];
}

export function extractMentions(text) {
  const found = String(text || "")
    .toLowerCase()
    .match(/@([a-z0-9_]{3,20})/g);
  return found ? [...new Set(found.map((name) => name.slice(1)))] : [];
}

export async function createPost(author, { text, imageUrl = "", replyTo = null }) {
  const body = String(text || "").trim();
  if (!body && !imageUrl) throw new Error("Write something or add an image.");
  if (body.length > 500) throw new Error("Posts are limited to 500 characters.");

  const hashtags = extractHashtags(body);
  const mentions = extractMentions(body);

  const payload = {
    uid: author.uid,
    username: author.username,
    displayName: author.displayName,
    photoURL: author.photoURL || "",
    text: body,
    imageUrl: imageUrl || "",
    hashtags,
    mentions,
    replyTo: replyTo || null,
    likeCount: 0,
    commentCount: 0,
    repostCount: 0,
    createdAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, "posts"), payload);
  await updateDoc(doc(db, "users", author.uid), { postsCount: increment(1) });

  // Trending counters (best-effort, never blocks the post).
  Promise.all(
    hashtags.map((tag) =>
      setDoc(
        doc(db, "hashtags", tag),
        { tag, count: increment(1), lastUsedAt: serverTimestamp() },
        { merge: true }
      ).catch(() => {})
    )
  ).catch(() => {});

  // Mention + reply notifications (best-effort).
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
          postId: ref.id,
          text: body.slice(0, 180),
        });
      }
    })
  ).catch(() => {});

  return ref.id;
}

export async function getPost(postId) {
  const snap = await getDoc(doc(db, "posts", postId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function watchPost(postId, callback) {
  return onSnapshot(doc(db, "posts", postId), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

export async function deletePost(postId, uid) {
  const snap = await getDoc(doc(db, "posts", postId));
  if (!snap.exists()) return;
  if (snap.data().uid !== uid) throw new Error("You can only delete your own posts.");
  await deleteDoc(doc(db, "posts", postId));
  await updateDoc(doc(db, "users", uid), { postsCount: increment(-1) });
}

/**
 * Live feed. Pass `authors` (max 30 uids) to scope it to people you follow.
 * The listener receives `(posts, docs)` so callers can paginate from the last doc.
 */
export function watchFeed({ authors = null, onData, pageSize = PAGE_SIZE } = {}) {
  const constraints = [orderBy("createdAt", "desc"), limit(pageSize)];
  if (authors && authors.length) constraints.unshift(where("uid", "in", authors.slice(0, 30)));
  return onSnapshot(
    query(collection(db, "posts"), ...constraints),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() })), snap.docs),
    (error) => {
      console.warn("[xacheus] feed listener:", error);
      onData([], []);
    }
  );
}

export async function fetchFeedPage({ authors = null, afterDoc = null, pageSize = PAGE_SIZE } = {}) {
  const constraints = [orderBy("createdAt", "desc"), limit(pageSize)];
  if (authors && authors.length) constraints.unshift(where("uid", "in", authors.slice(0, 30)));
  if (afterDoc) constraints.push(startAfter(afterDoc));
  const snap = await getDocs(query(collection(db, "posts"), ...constraints));
  return { docs: snap.docs, items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
}

export function watchUserPosts(uid, onData, pageSize = PAGE_SIZE) {
  return onSnapshot(
    query(collection(db, "posts"), where("uid", "==", uid), orderBy("createdAt", "desc"), limit(pageSize)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (error) => {
      console.warn("[xacheus] user posts listener:", error);
      onData([]);
    }
  );
}

export function watchHashtag(tag, onData, pageSize = PAGE_SIZE) {
  return onSnapshot(
    query(
      collection(db, "posts"),
      where("hashtags", "array-contains", normaliseUsername(tag)),
      orderBy("createdAt", "desc"),
      limit(pageSize)
    ),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (error) => {
      console.warn("[xacheus] hashtag listener:", error);
      onData([]);
    }
  );
}

/* ------------------------------------------------------------------ */
/* likes · reposts · saves                                             */
/* ------------------------------------------------------------------ */

export async function getLikedIds(uid, postIds) {
  const liked = new Set();
  const ids = postIds.filter(Boolean);
  if (!uid || !ids.length) return liked;
  await Promise.all(
    chunk(ids, 10).map(async (group) => {
      const snap = await getDocs(
        query(collection(db, "users", uid, "liked"), where(documentId(), "in", group))
      );
      snap.forEach((d) => liked.add(d.id));
    })
  );
  return liked;
}

export async function toggleLike(uid, actor, post) {
  const ref = doc(db, "users", uid, "liked", post.id);
  const snap = await getDoc(ref);
  const postRef = doc(db, "posts", post.id);

  if (snap.exists()) {
    await deleteDoc(ref);
    await updateDoc(postRef, { likeCount: increment(-1) });
    return false;
  }

  await setDoc(ref, { createdAt: serverTimestamp(), postId: post.id });
  await updateDoc(postRef, { likeCount: increment(1) });
  if (post.uid !== uid) {
    notify(post.uid, {
      type: "like",
      fromUid: uid,
      fromName: actor.displayName,
      fromPhoto: actor.photoURL || "",
      fromUsername: actor.username,
      postId: post.id,
      text: (post.text || "").slice(0, 180),
    }).catch(() => {});
  }
  return true;
}

export async function getRepostedIds(uid, postIds) {
  const set = new Set();
  const ids = postIds.filter(Boolean);
  if (!uid || !ids.length) return set;
  await Promise.all(
    chunk(ids, 10).map(async (group) => {
      const snap = await getDocs(
        query(collection(db, "users", uid, "reposted"), where(documentId(), "in", group))
      );
      snap.forEach((d) => set.add(d.id));
    })
  );
  return set;
}

export async function toggleRepost(uid, actor, post) {
  const ref = doc(db, "users", uid, "reposted", post.id);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await deleteDoc(ref);
    await updateDoc(doc(db, "posts", post.id), { repostCount: increment(-1) });
    return false;
  }
  await setDoc(ref, { createdAt: serverTimestamp(), postId: post.id });
  await updateDoc(doc(db, "posts", post.id), { repostCount: increment(1) });
  if (post.uid !== uid) {
    notify(post.uid, {
      type: "repost",
      fromUid: uid,
      fromName: actor.displayName,
      fromPhoto: actor.photoURL || "",
      fromUsername: actor.username,
      postId: post.id,
      text: (post.text || "").slice(0, 180),
    }).catch(() => {});
  }
  return true;
}

export async function getSavedIds(uid, postIds) {
  const set = new Set();
  const ids = postIds.filter(Boolean);
  if (!uid || !ids.length) return set;
  await Promise.all(
    chunk(ids, 10).map(async (group) => {
      const snap = await getDocs(
        query(collection(db, "users", uid, "saved"), where(documentId(), "in", group))
      );
      snap.forEach((d) => set.add(d.id));
    })
  );
  return set;
}

export async function toggleSave(uid, post) {
  const ref = doc(db, "users", uid, "saved", post.id);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await deleteDoc(ref);
    return false;
  }
  await setDoc(ref, { createdAt: serverTimestamp(), postId: post.id });
  return true;
}

export function watchSaved(uid, onData) {
  return onSnapshot(
    query(collection(db, "users", uid, "saved"), orderBy("createdAt", "desc"), limit(60)),
    async (snap) => {
      const posts = await Promise.all(
        snap.docs.map(async (d) => {
          const post = await getPost(d.id);
          return post;
        })
      );
      onData(posts.filter(Boolean));
    },
    () => onData([])
  );
}

/* ------------------------------------------------------------------ */
/* comments                                                            */
/* ------------------------------------------------------------------ */

export function watchComments(postId, onData) {
  return onSnapshot(
    query(collection(db, "posts", postId, "comments"), orderBy("createdAt", "asc"), limit(100)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (error) => {
      console.warn("[xacheus] comments listener:", error);
      onData([]);
    }
  );
}

export async function addComment(uid, actor, post, text) {
  const body = String(text || "").trim();
  if (!body) throw new Error("Write a reply first.");
  if (body.length > 500) throw new Error("Replies are limited to 500 characters.");

  await addDoc(collection(db, "posts", post.id, "comments"), {
    uid,
    username: actor.username,
    displayName: actor.displayName,
    photoURL: actor.photoURL || "",
    text: body,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, "posts", post.id), { commentCount: increment(1) });

  if (post.uid !== uid) {
    await notify(post.uid, {
      type: "comment",
      fromUid: uid,
      fromName: actor.displayName,
      fromPhoto: actor.photoURL || "",
      fromUsername: actor.username,
      postId: post.id,
      text: body.slice(0, 180),
    }).catch(() => {});
  }
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
    await updateDoc(doc(db, "users", uid), { followingCount: increment(-1) });
    await updateDoc(doc(db, "users", target.uid), { followersCount: increment(-1) });
    return false;
  }

  await setDoc(ref, { createdAt: serverTimestamp(), uid: target.uid });
  await setDoc(followerRef(target.uid, uid), { createdAt: serverTimestamp(), uid });
  await updateDoc(doc(db, "users", uid), { followingCount: increment(1) });
  await updateDoc(doc(db, "users", target.uid), { followersCount: increment(1) });

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

/** People you don't follow yet, newest accounts first. */
export async function getSuggestedUsers(uid, max = 6) {
  const [following, recent] = await Promise.all([
    uid ? getFollowingIds(uid) : Promise.resolve([]),
    getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(40))),
  ]);
  const skip = new Set([uid, ...following]);
  return recent.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((user) => !skip.has(user.uid))
    .slice(0, max);
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
    (error) => {
      console.warn("[xacheus] notifications listener:", error);
      onData([]);
    }
  );
}

export async function markNotificationsRead(uid, items) {
  await Promise.all(
    items
      .filter((item) => !item.read)
      .map((item) => updateDoc(doc(db, "notifications", item.id), { read: true }))
  );
}

/* ------------------------------------------------------------------ */
/* trending + search                                                   */
/* ------------------------------------------------------------------ */

export async function getTrending(max = 8) {
  try {
    const snap = await getDocs(query(collection(db, "hashtags"), orderBy("count", "desc"), limit(max)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.warn("[xacheus] trending:", error);
    return [];
  }
}

/** Prefix search across handles and display names. */
export async function searchUsers(term, max = 12) {
  const q = String(term || "").trim().toLowerCase();
  if (!q) return [];
  const handle = normaliseUsername(q);
  const queries = [];
  if (handle) {
    queries.push(
      getDocs(
        query(
          collection(db, "users"),
          where("username", ">=", handle),
          where("username", "<=", handle + "\uf8ff"),
          orderBy("username"),
          limit(max)
        )
      )
    );
  }
  queries.push(
    getDocs(
      query(
        collection(db, "users"),
        where("displayNameLower", ">=", q),
        where("displayNameLower", "<=", q + "\uf8ff"),
        orderBy("displayNameLower"),
        limit(max)
      )
    )
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

/* ------------------------------------------------------------------ */
/* direct messages                                                     */
/* ------------------------------------------------------------------ */

export function conversationId(a, b) {
  return [a, b].sort().join("_");
}

export async function openConversation(me, other) {
  const cid = conversationId(me.uid, other.uid);
  const ref = doc(db, "conversations", cid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      participants: [me.uid, other.uid],
      info: {
        [me.uid]: { username: me.username, displayName: me.displayName, photoURL: me.photoURL || "" },
        [other.uid]: {
          username: other.username,
          displayName: other.displayName,
          photoURL: other.photoURL || "",
        },
      },
      lastMessage: "",
      lastMessageAt: serverTimestamp(),
      unread: { [me.uid]: 0, [other.uid]: 0 },
      createdAt: serverTimestamp(),
    });
  }
  return cid;
}

export function watchConversations(uid, onData) {
  return onSnapshot(
    query(
      collection(db, "conversations"),
      where("participants", "array-contains", uid),
      orderBy("lastMessageAt", "desc"),
      limit(50)
    ),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (error) => {
      console.warn("[xacheus] conversations listener:", error);
      onData([]);
    }
  );
}

export function watchMessages(cid, onData) {
  return onSnapshot(
    query(collection(db, "conversations", cid, "messages"), orderBy("createdAt", "asc"), limit(200)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (error) => {
      console.warn("[xacheus] messages listener:", error);
      onData([]);
    }
  );
}

export async function sendMessage(cid, sender, recipients, text) {
  const body = String(text || "").trim();
  if (!body) return;
  const ref = doc(db, "conversations", cid);
  const unread = {};
  recipients.forEach((uid) => {
    if (uid !== sender.uid) unread[`unread.${uid}`] = increment(1);
  });

  await addDoc(collection(db, "conversations", cid, "messages"), {
    senderId: sender.uid,
    text: body,
    createdAt: serverTimestamp(),
  });

  await updateDoc(ref, {
    lastMessage: body.slice(0, 140),
    lastMessageAt: serverTimestamp(),
    ...unread,
  });
}

export async function markConversationRead(cid, uid) {
  await updateDoc(doc(db, "conversations", cid), { [`unread.${uid}`]: 0 });
}

/* ------------------------------------------------------------------ */
/* account                                                             */
/* ------------------------------------------------------------------ */

/**
 * Remove a user's public content. Auth deletion happens in settings.js.
 *
 * The reverse edges (follows/{them}/following/{me}) stay behind because a
 * client is not allowed to write inside another user's follow document; the
 * app hides profiles that no longer exist, so they are harmless.
 */
export async function purgeUserData(uid) {
  const [posts, following, followers] = await Promise.all([
    getDocs(query(collection(db, "posts"), where("uid", "==", uid), limit(200))),
    getDocs(query(collection(db, "follows", uid, "following"), limit(500))),
    getDocs(query(collection(db, "follows", uid, "followers"), limit(500))),
  ]);

  await Promise.all(posts.docs.map((d) => deleteDoc(d.ref)));
  await Promise.all(following.docs.map((d) => deleteDoc(d.ref)));
  // These are our own follower records (follows/{me}/followers/{them}), which we may delete.
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
