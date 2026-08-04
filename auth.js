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
let submitMode = "register";

document.querySelectorAll("[data-auth-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-auth-tab]").forEach((tab) => tab.classList.remove("active"));
    button.classList.add("active");
    submitMode = button.dataset.authTab;
  });
});

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    submitMode = button.dataset.mode;
  });
});

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

async function saveUserProfile(user, name = "") {
  await setDoc(
    doc(db, "users", user.uid),
    {
      uid: user.uid,
      name: name || user.displayName || "Xacheus user",
      email: user.email,
      role: user.email === "zacheussimbaya@gmail.com" ? "admin" : "user",
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const name = data.get("name")?.trim();
  const email = data.get("email")?.trim();
  const password = data.get("password");

  try {
    setStatus("Please wait…");
    let credential;
    if (submitMode === "login") {
      credential = await signInWithEmailAndPassword(auth, email, password);
    } else {
      credential = await createUserWithEmailAndPassword(auth, email, password);
      if (name) await updateProfile(credential.user, { displayName: name });
      await sendEmailVerification(credential.user);
    }
    await saveUserProfile(credential.user, name);
    setStatus("Success. Opening dashboard…");
    window.location.href = "dashboard.html";
  } catch (error) {
    setStatus(error.message.replace("Firebase: ", ""), true);
  }
});

googleButton.addEventListener("click", async () => {
  try {
    setStatus("Opening Google sign in…");
    const credential = await signInWithPopup(auth, googleProvider);
    await saveUserProfile(credential.user);
    window.location.href = "dashboard.html";
  } catch (error) {
    setStatus(error.message.replace("Firebase: ", ""), true);
  }
});

resetButton.addEventListener("click", async () => {
  const email = document.querySelector("#email").value.trim();
  if (!email) {
    setStatus("Enter your email first, then click forgot password.", true);
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    setStatus("Password reset email sent.");
  } catch (error) {
    setStatus(error.message.replace("Firebase: ", ""), true);
  }
});
