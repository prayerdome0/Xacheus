import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { addDoc, collection } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth, db, serverTimestamp } from "./firebase.js";

const form = document.querySelector("#real-builder-form");
const saveButton = document.querySelector("#save-generated-site");
const statusEl = document.querySelector("#builder-save-status");
let currentUser = null;
let generatedSite = null;

onAuthStateChanged(auth, (user) => { currentUser = user; });

const colors = {
  "Premium Tech": ["#02070d", "#00b8f4", "#12e1b2"],
  "Clean Business": ["#ffffff", "#1457ff", "#0f172a"],
  "Bold E-commerce": ["#111827", "#ff7a18", "#ffe082"],
  "Warm Community": ["#15100b", "#f59e0b", "#84cc16"],
};

function esc(value) {
  return String(value || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function title(value) {
  return esc(value).trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

function generate(data) {
  const name = title(data.businessName);
  const offer = esc(data.offer).toLowerCase();
  const audience = esc(data.audience).toLowerCase();
  const region = esc(data.region);
  const cta = esc(data.cta);
  const [bg, accent, second] = colors[data.style] || colors["Premium Tech"];
  const headline = `${name} helps ${audience} find ${offer} faster.`;
  const subheadline = `A professional ${esc(data.businessType).toLowerCase()} experience built for ${region}, with mobile-first design, WhatsApp conversion, SEO, and customer trust sections.`;
  const products = [
    `Featured ${offer}`,
    `Premium ${offer} package`,
    `Custom ${offer} solution`,
  ];
  const sections = ["Hero", "Benefits", "Products/Services", "Testimonials", "FAQ", "WhatsApp Contact"];
  const launch = [
    "Confirm logo, colors, and business name",
    "Add 3–12 products or service packages",
    "Connect WhatsApp admin +260 973 028 342",
    "Add payment confirmation instructions",
    "Publish contact form and customer inquiry flow",
    "Share launch post on Facebook, WhatsApp, Instagram, and TikTok",
    "Track leads in the Xacheus admin dashboard",
  ];
  return { ...data, name, headline, subheadline, products, sections, launch, bg, accent, second,
    seoTitle: `${name} | ${title(data.offer)} in ${region}`,
    seoDescription: `${name} provides ${offer} for ${audience}. Order, contact, and grow with a mobile-ready website powered by Xacheus AI.`,
    whatsapp: `Hello ${name}, I am interested in ${offer}. Please send me prices and details.`,
    status: "Generated",
  };
}

function render(site) {
  document.querySelector("#tab-preview").innerHTML = `
    <article class="site-preview" style="--preview-bg:${site.bg};--preview-accent:${site.accent};--preview-second:${site.second}">
      <header><b>${site.name}</b><nav><span>Home</span><span>Shop</span><span>Contact</span></nav></header>
      <section class="preview-hero"><div><small>Built with Xacheus AI</small><h2>${site.headline}</h2><p>${site.subheadline}</p><a>${site.cta}</a></div></section>
      <section class="preview-products">${site.products.map((p, i) => `<div><span>0${i + 1}</span><h3>${p}</h3><p>Clear description, benefits, price placeholder, and WhatsApp order action.</p></div>`).join("")}</section>
      <footer>WhatsApp: +260 973 028 342 • ${site.region}</footer>
    </article>`;
  document.querySelector("#tab-copy").innerHTML = `
    <div class="generated-doc"><h3>Homepage copy</h3><p><b>Headline:</b> ${site.headline}</p><p><b>Subheadline:</b> ${site.subheadline}</p><p><b>Sections:</b> ${site.sections.join(" → ")}</p><p><b>WhatsApp message:</b> ${site.whatsapp}</p></div>`;
  document.querySelector("#tab-seo").innerHTML = `
    <div class="generated-doc"><h3>SEO package</h3><p><b>Title:</b> ${site.seoTitle}</p><p><b>Description:</b> ${site.seoDescription}</p><p><b>Keywords:</b> ${site.offer}, ${site.businessType}, ${site.region}, WhatsApp orders, online business</p></div>`;
  document.querySelector("#tab-launch").innerHTML = `
    <div class="generated-doc"><h3>Launch checklist</h3><ol>${site.launch.map((i) => `<li>${i}</li>`).join("")}</ol></div>`;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  generatedSite = generate(Object.fromEntries(new FormData(form).entries()));
  render(generatedSite);
  statusEl.textContent = "Generated. Log in and save this site to your dashboard.";
});

saveButton.addEventListener("click", async () => {
  if (!generatedSite) {
    statusEl.textContent = "Generate a website preview first.";
    return;
  }
  if (!currentUser) {
    localStorage.setItem("xacheusGeneratedSite", JSON.stringify(generatedSite));
    window.location.href = "auth.html";
    return;
  }
  statusEl.textContent = "Saving to Firebase…";
  await addDoc(collection(db, "users", currentUser.uid, "blueprints"), {
    ...generatedSite,
    userId: currentUser.uid,
    userEmail: currentUser.email,
    createdAt: serverTimestamp(),
  });
  statusEl.textContent = "Saved to your Xacheus dashboard.";
});

document.querySelectorAll(".generation-tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".generation-tabs button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".generation-output").forEach((p) => p.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#tab-${button.dataset.tab}`).classList.add("active");
  });
});

const saved = localStorage.getItem("xacheusGeneratedSite");
if (saved) {
  generatedSite = JSON.parse(saved);
  render(generatedSite);
}
