import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { ADMIN_EMAIL, auth, db, serverTimestamp } from "./firebase.js";

const userPill = document.querySelector("#user-pill");
const adminLink = document.querySelector("#admin-link");
const logoutButton = document.querySelector("#logout-button");
const builderForm = document.querySelector("#dashboard-builder");
const builderStatus = document.querySelector("#builder-status");
const paymentForm = document.querySelector("#payment-form");
const paymentMessage = document.querySelector("#payment-message");
const savedList = document.querySelector("#saved-list");
const websiteCount = document.querySelector("#website-count");
const paymentStatus = document.querySelector("#payment-status");
const premiumTitle = document.querySelector("#premium-title");
const premiumCopy = document.querySelector("#premium-copy");
let currentUser;

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function renderPlans(snapshot) {
  websiteCount.textContent = snapshot.size;
  if (snapshot.empty) {
    savedList.innerHTML = '<p class="placeholder">No website plans saved yet.</p>';
    return;
  }
  savedList.innerHTML = snapshot.docs
    .map((docSnap) => {
      const item = docSnap.data();
      return `<article class="saved-card"><div><small>${item.region || "Xacheus"}</small><h3>${item.businessName || "Untitled business"}</h3><p>${item.prompt || item.businessType || "AI website plan"}</p></div><span>${item.status || "Draft"}</span></article>`;
    })
    .join("");
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "auth.html";
    return;
  }
  currentUser = user;
  userPill.textContent = user.displayName || user.email;
  adminLink.hidden = user.email !== ADMIN_EMAIL;

  await setDoc(
    doc(db, "users", user.uid),
    { uid: user.uid, email: user.email, name: user.displayName || "", lastLoginAt: serverTimestamp() },
    { merge: true },
  );

  const pendingGenerated = localStorage.getItem("xacheusGeneratedSite");
  if (pendingGenerated) {
    try {
      await addDoc(collection(db, "users", user.uid, "blueprints"), {
        ...JSON.parse(pendingGenerated),
        userId: user.uid,
        userEmail: user.email,
        importedAfterLogin: true,
        createdAt: serverTimestamp(),
      });
      localStorage.removeItem("xacheusGeneratedSite");
    } catch (error) {
      console.warn("Could not import generated site", error);
    }
  }

  const plansQuery = query(collection(db, "users", user.uid, "blueprints"), orderBy("createdAt", "desc"));
  onSnapshot(plansQuery, renderPlans);

  const paymentsQuery = query(collection(db, "payment_confirmations"), where("userId", "==", user.uid));
  onSnapshot(paymentsQuery, (snapshot) => {
    if (!snapshot.empty) {
      const latest = snapshot.docs
        .map((docSnap) => docSnap.data())
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))[0];
      paymentStatus.textContent = latest.status || "Submitted";
      if (latest.status === "Approved") {
        premiumTitle.textContent = "Premium approved";
        premiumCopy.textContent = "Your account has admin approval. You can use the AI Builder, assistant tools, website plans, and advanced launch workflow.";
      }
    }
  });
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

builderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  builderStatus.textContent = "Saving plan…";
  const data = formObject(builderForm);
  await addDoc(collection(db, "users", currentUser.uid, "blueprints"), {
    ...data,
    userId: currentUser.uid,
    userEmail: currentUser.email,
    status: "Draft",
    createdAt: serverTimestamp(),
  });
  builderForm.reset();
  builderStatus.textContent = "Saved. Your AI website plan is now in My Websites.";
});

paymentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  paymentMessage.textContent = "Submitting confirmation…";
  const data = {
    ...formObject(paymentForm),
    userId: currentUser.uid,
    userEmail: currentUser.email,
    status: "Submitted",
    createdAt: serverTimestamp(),
  };
  await addDoc(collection(db, "users", currentUser.uid, "paymentConfirmations"), data);
  await addDoc(collection(db, "payment_confirmations"), data);
  paymentForm.reset();
  paymentMessage.textContent = "Submitted. Please also message WhatsApp admin for faster confirmation.";
});
