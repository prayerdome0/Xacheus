import { addDoc, collection } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, serverTimestamp } from "./firebase.js";

const contactForm = document.querySelector("#contact-form");
const contactStatus = document.querySelector("#contact-status");

contactForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  contactStatus.textContent = "Sending message…";
  const data = Object.fromEntries(new FormData(contactForm).entries());
  try {
    await addDoc(collection(db, "contact_messages"), {
      ...data,
      source: "xacheus-homepage",
      status: "New",
      createdAt: serverTimestamp(),
    });
    contactForm.reset();
    contactStatus.textContent = "Message sent. Xacheus admin will contact you soon.";
  } catch (error) {
    contactStatus.textContent = error.message.replace("Firebase: ", "");
    contactStatus.classList.add("error");
  }
});
