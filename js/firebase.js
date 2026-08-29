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
  persistentLocalCache,
  persistentMultipleTabManager,
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
 * Firestore transport.
 *
 * Some networks, proxies, VPNs, browser extensions and in-app browsers block
 * the default WebChannel streaming connection. When that happens every read
 * fails with "Failed to get document because the client is offline", even
 * though the device clearly has internet.
 *
 * `experimentalAutoDetectLongPolling` lets the SDK notice a blocked stream and
 * fall back to HTTP long-polling, which fixes that class of failure. We also
 * enable a persistent local cache so a temporary blip serves cached data
 * instead of throwing.
 */
export const db = (() => {
  // Preview iframes, VPNs and some browsers block Firestore's WebChannel
  // stream, which surfaces as "client is offline". Force HTTP long-polling
  // and keep the cache in memory so IndexedDB never poisons the client.
  const settings = {
    experimentalForceLongPolling: true,
    useFetchStreams: false,
    localCache: memoryLocalCache(),
  };
  try {
    return initializeFirestore(firebaseApp, settings);
  } catch {
    try {
      return initializeFirestore(firebaseApp, { experimentalForceLongPolling: true });
    } catch {
      return getFirestore(firebaseApp);
    }
  }
})();
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Keep people signed in between visits.
setPersistence(auth, browserLocalPersistence).catch(() => {});

export { serverTimestamp };
export const PROJECT_ID = firebaseConfig.projectId;
