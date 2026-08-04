import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "./firebase.js";

const params = new URLSearchParams(window.location.search);
const slug = params.get("store") || "sage-co";
let storeState;
let cart = JSON.parse(localStorage.getItem(`xacheus-cart-${slug}`) || "[]");
const $ = (selector) => document.querySelector(selector);
const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const money = (value) => `${storeState?.store?.currency?.startsWith("US") ? "$" : "K"} ${Number(value || 0).toLocaleString()}`;

function getLocalStore() {
  const keys = [`xacheus-published-${slug}`, "xacheus-demo-store", "xacheus-store-guest"];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith("xacheus-store-") && !keys.includes(key)) keys.push(key);
  }
  for (const key of keys) { try { const saved = JSON.parse(localStorage.getItem(key)); if (saved?.store && (saved.store.slug === slug || key.includes(slug))) return saved; } catch { /* Try the next local copy. */ } }
  return null;
}

async function loadStore() {
  storeState = getLocalStore();
  try {
    const snapshot = await getDoc(doc(db, "publicStores", slug));
    if (snapshot.exists()) storeState = snapshot.data();
  } catch (error) { console.info("Using local storefront copy", error.code || error.message); }
  if (!storeState) {
    storeState = getLocalStore();
  }
  if (!storeState) {
    document.title = "Store not found — Xacheus";
    $("#storefront-loading").innerHTML = `<div><span class="loading-mark">?</span><h2>Storefront not found</h2><p>This store has not been published yet.</p><a href="index.html">Build with Xacheus →</a></div>`;
    return;
  }
  renderStore();
}

function renderStore() {
  const store = storeState.store || {};
  document.title = `${store.name || "Store"} — Online store`;
  document.documentElement.style.setProperty("--live-primary", store.primary || "#6a5cff");
  document.documentElement.style.setProperty("--live-dark", store.dark || "#191b2d");
  $("#storefront-loading").remove(); $("#live-store").hidden = false;
  $("#live-logo").textContent = store.name || "Your store"; $("#footer-logo").textContent = store.name || "Your store"; $("#footer-name").textContent = store.name || "Your store"; $("#footer-description").textContent = store.description || "Thoughtfully made essentials for everyday living."; $("#footer-year").textContent = new Date().getFullYear();
  $("#live-menu").innerHTML = (storeState.menu || []).map((item) => `<a href="${esc(item.url || "#")}">${esc(item.title)}</a>`).join("");
  $("#storefront-main").innerHTML = (storeState.sections || []).filter((section) => section.enabled !== false).map(sectionMarkup).join("");
  updateCart();
}

function sectionMarkup(section) {
  const data = section.data || {}; const store = storeState.store || {};
  if (section.type === "announcement") return `<div class="live-announcement">${esc(data.text || store.announcement || "Welcome to our store")}</div>`;
  if (section.type === "banner") { const layoutClass = String(data.layout || "Full width").toLowerCase().replace(/\s+/g, "-"); return `<section class="live-hero layout-${layoutClass} ${data.image ? "image" : ""}" ${data.image ? `style="background-image:url('${esc(data.image)}')"` : ""}><div class="live-hero-inner"><div class="live-hero-copy"><p class="store-kicker">${esc(data.eyebrow || "WELCOME TO OUR STORE")}</p><h1>${esc(data.heading || "Your story starts here.")}</h1><p>${esc(data.description || "Thoughtfully made essentials for your everyday.")}</p><a class="live-cta" href="${esc(data.buttonLink || "#products")}">${esc(data.buttonText || "Shop now")} ↗</a></div></div><div class="live-hero-shape"></div></section>`; }
  if (section.type === "products") return `<section class="live-products" id="products"><div class="live-container"><div class="live-section-heading"><div><p class="store-kicker">THE COLLECTION</p><h2>${esc(data.heading || "Shop our favorites")}</h2><p>${esc(data.description || "A few things you’ll love.")}</p></div><a class="view-all" href="#products">View all products →</a></div><div class="live-product-grid">${(storeState.products || []).slice(0, 12).map(productMarkup).join("")}</div></div></section>`;
  if (section.type === "story") return `<section class="live-story"><div class="live-story-art"></div><div><p class="store-kicker">OUR STORY</p><h2>${esc(data.heading || "Made for your everyday.")}</h2><p>${esc(data.text || "Beautiful things, made to last.")}</p><a class="live-cta" href="${esc(data.buttonLink || "#")}">${esc(data.buttonText || "Learn more")} →</a></div></section>`;
  if (section.type === "newsletter") return `<section class="live-newsletter"><p class="store-kicker">KEEP IN TOUCH</p><h2>${esc(data.heading || "Stay in the loop")}</h2><p>${esc(data.text || "New arrivals and thoughtful notes, occasionally.")}</p><form class="live-newsletter-form" id="newsletter-form"><input type="email" placeholder="Your email address" required /><button type="submit">Join →</button></form></section>`;
  if (section.type === "testimonials") return `<section class="live-newsletter"><p class="store-kicker">FROM OUR CUSTOMERS</p><h2>“Beautiful, useful, and made with care.”</h2><p>★★★★★ &nbsp; Our community loves the little details.</p></section>`;
  return "";
}

function productMarkup(product) {
  return `<article class="live-product"><div class="live-product-image" ${product.image ? `style="background-image:url('${esc(product.image)}')"` : ""}><button class="quick-add" data-add-product="${esc(product.id)}" type="button">Add to bag +</button></div><div class="live-product-body"><h3>${esc(product.title)}</h3><p>${money(product.price)}${product.compareAt ? `<del class="compare">${money(product.compareAt)}</del>` : ""}</p><small>${esc(product.description || "Made with care.")}</small></div></article>`;
}

function updateCart() {
  $("#cart-count").textContent = cart.reduce((sum, item) => sum + item.quantity, 0);
  $("#cart-total").textContent = money(cart.reduce((sum, item) => sum + item.price * item.quantity, 0));
  $("#cart-items").innerHTML = cart.length ? cart.map((item) => `<div class="cart-item"><div class="cart-item-image" ${item.image ? `style="background-image:url('${esc(item.image)}')"` : ""}></div><div><strong>${esc(item.title)}</strong><small>${item.quantity} × ${money(item.price)}</small></div><button type="button" data-remove-cart="${esc(item.id)}">×</button></div>`).join("") : `<div class="cart-empty">Your bag is waiting for something thoughtful.</div>`;
  localStorage.setItem(`xacheus-cart-${slug}`, JSON.stringify(cart));
}
function openCart() { $("#cart-drawer").classList.add("open"); $("#cart-overlay").classList.add("open"); }
function closeCart() { $("#cart-drawer").classList.remove("open"); $("#cart-overlay").classList.remove("open"); }
function addToCart(id) { const product = (storeState.products || []).find((item) => item.id === id); if (!product) return; const existing = cart.find((item) => item.id === id); if (existing) existing.quantity += 1; else cart.push({ id, title: product.title, price: Number(product.price || 0), image: product.image, quantity: 1 }); updateCart(); openCart(); const toast = $("#store-toast"); toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 1800); }

$("#cart-button").addEventListener("click", openCart); $("#cart-close").addEventListener("click", closeCart); $("#cart-overlay").addEventListener("click", closeCart); $("#live-menu-button").addEventListener("click", () => $("#live-menu").classList.toggle("open"));
$("#storefront-main").addEventListener("click", (event) => { const button = event.target.closest("[data-add-product]"); if (button) addToCart(button.dataset.addProduct); }); $("#cart-items").addEventListener("click", (event) => { const button = event.target.closest("[data-remove-cart]"); if (!button) return; cart = cart.filter((item) => item.id !== button.dataset.removeCart); updateCart(); });
$("#checkout-button").addEventListener("click", () => { const message = cart.map((item) => `${item.quantity}x ${item.title}`).join(", "); window.open(`https://wa.me/260973028342?text=${encodeURIComponent(`Hello ${storeState.store.name}, I would like to order: ${message}. Total: ${$("#cart-total").textContent}`)}`, "_blank"); });
document.addEventListener("submit", (event) => { if (event.target.id === "newsletter-form") { event.preventDefault(); event.target.innerHTML = `<p>Thanks for joining our list ✦</p>`; } }); $("#subscribe-button").addEventListener("click", () => { $("#subscribe-button").textContent = "✓"; });
loadStore();
