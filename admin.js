import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  collectionGroup,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { ADMIN_EMAIL, auth, db } from "./firebase.js";

const adminUser = document.querySelector("#admin-user");
const logout = document.querySelector("#admin-logout");
const paymentsList = document.querySelector("#payments-list");
const messagesList = document.querySelector("#messages-list");
const plansList = document.querySelector("#plans-list");
const paymentsCount = document.querySelector("#payments-count");
const messagesCount = document.querySelector("#messages-count");
const plansCount = document.querySelector("#plans-count");

function empty(label) {
  return `<p class="placeholder">No ${label} yet.</p>`;
}

function card(title, body, meta = "", badge = "") {
  return `<article class="saved-card"><div><small>${meta}</small><h3>${title}</h3><p>${body}</p></div>${badge ? `<span>${badge}</span>` : ""}</article>`;
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "auth.html";
    return;
  }
  if (user.email !== ADMIN_EMAIL) {
    adminUser.textContent = "Not authorized";
    document.querySelector(".app-main").innerHTML = `<section class="dashboard-panel"><h1>Admin access required</h1><p class="placeholder">Please log in with ${ADMIN_EMAIL}.</p><a class="btn btn-primary" href="auth.html">Log in as admin</a></section>`;
    return;
  }

  adminUser.textContent = user.email;

  onSnapshot(query(collection(db, "payment_confirmations"), orderBy("createdAt", "desc")), (snapshot) => {
    paymentsCount.textContent = snapshot.size;
    paymentsList.innerHTML = snapshot.empty
      ? empty("payment confirmations")
      : snapshot.docs.map((docSnap) => {
          const item = docSnap.data();
          return `<article class="saved-card"><div><small>${item.userEmail || "Customer"} • ${item.method || "Payment"}</small><h3>${item.customerName || "Unnamed"} paid ${item.amount || "amount not set"}</h3><p>Reference: ${item.reference || "None"}<br>${item.message || "No message"}</p></div><div class="admin-actions"><button class="btn btn-primary payment-action" data-status="Approved" data-user="${item.userId || ""}" data-id="${docSnap.id}">Approve</button><button class="btn btn-secondary payment-action" data-status="Rejected" data-user="${item.userId || ""}" data-id="${docSnap.id}">Reject</button><span>${item.status || "Submitted"}</span></div></article>`;
        }).join("");
  });

  onSnapshot(query(collection(db, "contact_messages"), orderBy("createdAt", "desc")), (snapshot) => {
    messagesCount.textContent = snapshot.size;
    messagesList.innerHTML = snapshot.empty
      ? empty("messages")
      : snapshot.docs.map((docSnap) => {
          const item = docSnap.data();
          return `<article class="saved-card"><div><small>${item.email || "No email"} • ${item.phone || "No phone"}</small><h3>${item.name || "New lead"}</h3><p>${item.message || "No message"}</p></div><div class="admin-actions"><button class="btn btn-primary lead-action" data-status="Contacted" data-id="${docSnap.id}">Contacted</button><button class="btn btn-secondary lead-action" data-status="Converted" data-id="${docSnap.id}">Converted</button><span>${item.status || "New"}</span></div></article>`;
        }).join("");
  });

  onSnapshot(query(collectionGroup(db, "blueprints"), orderBy("createdAt", "desc")), (snapshot) => {
    plansCount.textContent = snapshot.size;
    plansList.innerHTML = snapshot.empty
      ? empty("website plans")
      : snapshot.docs.map((docSnap) => {
          const item = docSnap.data();
          return card(item.businessName || "Untitled", item.prompt || item.businessType || "No prompt", `${item.userEmail || "User"} • ${item.region || "Region"}`, item.status || "Draft");
        }).join("");
  });
});

document.addEventListener("click", async (event) => {
  const paymentButton = event.target.closest(".payment-action");
  if (paymentButton) {
    await updateDoc(doc(db, "payment_confirmations", paymentButton.dataset.id), { status: paymentButton.dataset.status });
    if (paymentButton.dataset.user) {
      const userPayments = await getDocs(query(collection(db, "users", paymentButton.dataset.user, "paymentConfirmations"), where("userId", "==", paymentButton.dataset.user)));
      userPayments.forEach(async (snap) => updateDoc(doc(db, "users", paymentButton.dataset.user, "paymentConfirmations", snap.id), { status: paymentButton.dataset.status }));
    }
    paymentButton.textContent = paymentButton.dataset.status;
    return;
  }
  const leadButton = event.target.closest(".lead-action");
  if (leadButton) {
    await updateDoc(doc(db, "contact_messages", leadButton.dataset.id), { status: leadButton.dataset.status });
    leadButton.textContent = leadButton.dataset.status;
  }
});

logout.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});
