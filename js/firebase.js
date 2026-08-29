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
  getFirestore,
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
export const db = getFirestore(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Keep people signed in between visits.
setPersistence(auth, browserLocalPersistence).catch(() => {});

export { serverTimestamp };
export const PROJECT_ID = firebaseConfig.projectId;
