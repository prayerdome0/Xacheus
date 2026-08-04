import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
  sendPasswordResetEmail,
  sendEmailVerification,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth, db, googleProvider, serverTimestamp } from "./firebase.js";

const form = document.querySelector("#auth-form");
const statusEl = document.querySelector("#auth-status");
const googleButton = document.querySelector("#google-login");
const resetButton = document.querySelector("#reset-password");
const nameField = document.querySelector("#name");
const submitButtons = document.querySelectorAll("[data-mode]");
let submitMode = "register";
const nextPage = new URLSearchParams(window.location.search).get("next") || "dashboard.html";

function setMode(mode) {
  submitMode = mode;
  document.querySelectorAll("[data-auth-tab]").forEach((tab) => tab.classList.toggle("active", tab.dataset.authTab === mode));
  nameField.closest("label").style.display = mode === "register" ? "grid" : "none";
  submitButtons.forEach((button) => { button.classList.toggle("btn-primary", button.dataset.mode === mode); button.classList.toggle("btn-secondary", button.dataset.mode !== mode); });
}

document.querySelectorAll("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.authTab)));
submitButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
setMode("register");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function readableError(error) {
  const code = error?.code || "";
  const messages = {
    "auth/email-already-in-use": "An account already exists with this email. Choose Login instead.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password": "Use a stronger password with at least 6 characters.",
    "auth/popup-closed-by-user": "The Google sign-in window was closed.",
    "auth/network-request-failed": "Network error. Check your connection and try again.",
  };
  return messages[code] || (error?.message || "Something went wrong. Please try again.").replace("Firebase: ", "");
}

async function saveUserProfile(user, name = "") {
  try {
    await setDoc(doc(db, "users", user.uid), { uid: user.uid, name: name || user.displayName || "Xacheus user", email: user.email, role: user.email === "zacheussimbaya@gmail.com" ? "admin" : "user", updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
  } catch (error) {
    // Authentication is still successful when Firestore has not been configured;
    // the store workspace keeps a local copy and syncs on the next save.
    console.info("Profile sync pending", error.code || error.message);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const name = data.get("name")?.trim(); const email = data.get("email")?.trim(); const password = data.get("password");
  try {
    setStatus(submitMode === "register" ? "Creating your workspace…" : "Signing you in…");
    let credential;
    if (submitMode === "login") {
      credential = await signInWithEmailAndPassword(auth, email, password);
    } else {
      credential = await createUserWithEmailAndPassword(auth, email, password);
      if (name) await updateProfile(credential.user, { displayName: name });
      try { await sendEmailVerification(credential.user); } catch (verificationError) { console.info("Email verification is not configured yet", verificationError.code); }
    }
    await saveUserProfile(credential.user, name);
    setStatus("Success. Opening your store workspace…");
    window.location.href = nextPage;
  } catch (error) { setStatus(readableError(error), true); }
});

googleButton.addEventListener("click", async () => {
  try { setStatus("Opening Google sign in…"); const credential = await signInWithPopup(auth, googleProvider); await saveUserProfile(credential.user); window.location.href = nextPage; }
  catch (error) { setStatus(readableError(error), true); }
});

resetButton.addEventListener("click", async () => {
  const email = document.querySelector("#email").value.trim();
  if (!email) { setStatus("Enter your email first, then click forgot password.", true); return; }
  try { await sendPasswordResetEmail(auth, email); setStatus("Password reset email sent. Check your inbox."); }
  catch (error) { setStatus(readableError(error), true); }
});
