/**
 * Xacheus Social — Firebase bootstrap.
 *
 * The web config below is public by design (it only identifies the project).
 * All real protection lives in `firestore.rules`, which must be deployed.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore,
  getFirestore,
  memoryLocalCache,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCiegAwXYmA3k0zxYZLna4Rla1Gt269GH4",
  authDomain: "xacheus-7c98b.firebaseapp.com",
  projectId: "xacheus-7c98b",
  storageBucket: "xacheus-7c98b.firebasestorage.app",
  messagingSenderId: "494969268895",
  appId: "1:494969268895:web:1729fe174f7b8490b410aa",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

/**
 * True when the page was opened with `?lp=1` / `?longpolling=1`, or when a
 * previous session had to fall back (stored in `xacheus_longPolling`).
 *
 * Long-polling is slower than the default WebChannel stream, so it is only
 * forced on request — everything else lets the SDK auto-detect a blocked
 * stream and switch on its own.
 */
function wantsForcedLongPolling() {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get("lp") === "1" || params.get("longpolling") === "1") return true;
    return localStorage.getItem("xacheus_longPolling") === "1";
  } catch {
    return false;
  }
}

export function rememberLongPollingFallback() {
  try {
    localStorage.setItem("xacheus_longPolling", "1");
  } catch {
    /* private mode — ignore */
  }
}

/**
 * Firestore transport.
 *
 * Some networks, proxies, VPNs, browser extensions and in-app browsers block
 * the default WebChannel streaming connection. When that happens every read
 * fails with "Failed to get document because the client is offline", even
 * though the device clearly has internet.
 *
 * `experimentalAutoDetectLongPolling` lets the SDK notice a blocked stream and
 * fall back to HTTP long-polling, which fixes that class of failure without
 * paying the latency cost on networks where streaming works fine.
 *
 * The cache is kept in memory: IndexedDB is another thing that can hang or be
 * unavailable (private windows, blocked storage, multi-tab contention), and a
 * hang there is indistinguishable from "the app never loads".
 *
 * Every step is defensive. This module runs at import time, before anything is
 * on screen — if it throws, the whole app fails to boot and the user is left
 * staring at the boot spinner.
 */
export const db = (() => {
  const forced = wantsForcedLongPolling();

  const build = (settings) => {
    try {
      return initializeFirestore(firebaseApp, settings);
    } catch {
      try {
        return initializeFirestore(firebaseApp, {});
      } catch {
        return getFirestore(firebaseApp);
      }
    }
  };

  try {
    if (forced) {
      return build({
        experimentalForceLongPolling: true,
        useFetchStreams: false,
        localCache: memoryLocalCache(),
      });
    }

    return build({
      experimentalAutoDetectLongPolling: true,
      localCache: memoryLocalCache(),
    });
  } catch {
    // Last resort: the SDK still works with default settings, it just loses
    // the blocked-network fallbacks.
    try {
      return getFirestore(firebaseApp);
    } catch {
      return null;
    }
  }
})();

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Keep people signed in between visits.
setPersistence(auth, browserLocalPersistence).catch(() => {});

export { serverTimestamp };
export const PROJECT_ID = firebaseConfig.projectId;
