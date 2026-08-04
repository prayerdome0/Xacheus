import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBLmss9pTbT5dI5LWl-sQY7zADTZ9dWz3s",
  authDomain: "xacheus.firebaseapp.com",
  projectId: "xacheus",
  storageBucket: "xacheus.firebasestorage.app",
  messagingSenderId: "369059308122",
  appId: "1:369059308122:web:19f9da4b4354c2c269ae63",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
export { serverTimestamp };

export const ADMIN_EMAIL = "zacheussimbaya@gmail.com";
export const ADMIN_WHATSAPP = "+260 973 028 342";
export const ADMIN_WHATSAPP_LINK = "https://wa.me/260973028342";

window.xacheusFirebase = {
  app: firebaseApp,
  auth,
  db,
  projectId: firebaseConfig.projectId,
};

console.info("Xacheus Firebase initialized", firebaseConfig.projectId);
