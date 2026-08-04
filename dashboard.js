import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth, db, serverTimestamp } from "./firebase.js";
import { uploadStoreImage } from "./cloudinary.js";

const demoMode = new URLSearchParams(window.location.search).get("demo") === "1";
const LOCAL_KEY = demoMode ? "xacheus-demo-store" : "xacheus-store";
let currentUser = null;
let state = null;
let toastTimer;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const DEFAULT_STORE = {
  store: {
    name: "Sage & Co.",
    slug: "sage-co",
    description: "Thoughtfully made essentials for everyday living.",
    currency: "Zambian Kwacha (K)",
    primary: "#6a5cff",
    dark: "#191b2d",
    font: "DM Sans",
    spacing: "comfortable",
    announcement: "Free delivery on orders over K500 — Shop the new collection",
  },
  menu: [
    { id: "menu-home", title: "Home", url: "/" },
    { id: "menu-shop", title: "Shop", url: "/collections/all" },
    { id: "menu-about", title: "About us", url: "/pages/about" },
    { id: "menu-contact", title: "Contact", url: "/pages/contact" },
  ],
  sections: [
    { id: "section-announcement", type: "announcement", label: "Announcement bar", enabled: true, data: { text: "Free delivery on orders over K500 — Shop the new collection" } },
    { id: "section-banner", type: "banner", label: "Hero banner", enabled: true, data: { eyebrow: "NEW SEASON / 2026", heading: "Small details. Big difference.", description: "Thoughtfully made essentials designed to bring more beauty to your everyday.", buttonText: "Shop the collection", buttonLink: "/collections/all", image: "", layout: "Full width" } },
    { id: "section-products", type: "products", label: "Featured products", enabled: true, data: { heading: "Shop our favorites", description: "A few things we think you’ll love.", collection: "all" } },
    { id: "section-story", type: "story", label: "Image with text", enabled: true, data: { heading: "Made for your everyday.", text: "We believe the objects you use every day should be useful, beautiful, and made to last.", buttonText: "Our story", buttonLink: "/pages/about" } },
    { id: "section-footer", type: "footer", label: "Footer", enabled: true, data: { text: "Thoughtfully made essentials for everyday living." } },
  ],
  products: [
    { id: "p-001", title: "Linen Everyday Shirt", description: "An easy, breathable layer made for warm days.", price: 420, compareAt: 0, inventory: 24, sku: "SC-LIN-01", status: "Active", category: "New arrivals", image: "https://images.unsplash.com/photo-1596755389378-c31d21fd1273?auto=format&fit=crop&w=500&q=80", variants: "S, M, L, XL" },
    { id: "p-002", title: "Handwoven Market Tote", description: "A sturdy carry-all woven by local makers.", price: 285, compareAt: 340, inventory: 8, sku: "SC-TOT-02", status: "Active", category: "Bags", image: "https://images.unsplash.com/photo-1594223274512-ad4803739b7c?auto=format&fit=crop&w=500&q=80", variants: "One size" },
    { id: "p-003", title: "Cedar & Sage Candle", description: "A warm, grounding scent for slow evenings.", price: 180, compareAt: 0, inventory: 46, sku: "SC-CAN-03", status: "Active", category: "Home", image: "https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=500&q=80", variants: "250g" },
  ],
  collections: [
    { id: "c-001", title: "New arrivals", description: "The latest additions to Sage & Co.", count: 12, color: "purple" },
    { id: "c-002", title: "Everyday essentials", description: "Made for the rhythm of everyday life.", count: 18, color: "green" },
    { id: "c-003", title: "Gifts under K300", description: "Thoughtful little things for someone special.", count: 9, color: "orange" },
  ],
  orders: [
    { id: "#1048", customer: "Amara Banda", initials: "AB", color: "purple", date: "Today, 10:42 AM", items: 2, total: 705, payment: "Paid", fulfillment: "Unfulfilled" },
    { id: "#1047", customer: "Thandiwe Moyo", initials: "TM", color: "green", date: "Today, 09:18 AM", items: 1, total: 420, payment: "Paid", fulfillment: "Fulfilled" },
    { id: "#1046", customer: "Nchimunya Phiri", initials: "NP", color: "orange", date: "Yesterday", items: 3, total: 1_080, payment: "Paid", fulfillment: "Fulfilled" },
    { id: "#1045", customer: "Mwaka Zulu", initials: "MZ", color: "purple", date: "Yesterday", items: 1, total: 285, payment: "Pending", fulfillment: "Unfulfilled" },
    { id: "#1044", customer: "Luyando Tembo", initials: "LT", color: "green", date: "31 Jul 2026", items: 2, total: 600, payment: "Paid", fulfillment: "Fulfilled" },
  ],
  customers: [
    { name: "Amara Banda", email: "amara.banda@email.com", initials: "AB", color: "purple", orders: 4, spent: 1830, location: "Lusaka, ZM", lastOrder: "Today" },
    { name: "Thandiwe Moyo", email: "thandiwe.m@email.com", initials: "TM", color: "green", orders: 2, spent: 840, location: "Kitwe, ZM", lastOrder: "Today" },
    { name: "Nchimunya Phiri", email: "nphiri@email.com", initials: "NP", color: "orange", orders: 6, spent: 3240, location: "Lusaka, ZM", lastOrder: "Yesterday" },
    { name: "Mwaka Zulu", email: "mwakaz@email.com", initials: "MZ", color: "purple", orders: 1, spent: 285, location: "Ndola, ZM", lastOrder: "Yesterday" },
  ],
  published: false,
  updatedAt: null,
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function uid(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function esc(value = "") { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function money(value) { return `${state?.store?.currency?.startsWith("US") ? "$" : "K"} ${Number(value || 0).toLocaleString()}`; }
function initials(name = "Maya") { return name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "M"; }
function titleFromType(type) { return ({ announcement: "Announcement bar", banner: "Hero banner", products: "Featured products", story: "Image with text", testimonials: "Testimonials", newsletter: "Newsletter", footer: "Footer" })[type] || "Section"; }

function mergeState(saved) {
  const base = clone(DEFAULT_STORE);
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    store: { ...base.store, ...(saved.store || {}) },
    menu: saved.menu?.length ? saved.menu : base.menu,
    sections: saved.sections?.length ? saved.sections : base.sections,
    products: saved.products || base.products,
    collections: saved.collections || base.collections,
    orders: saved.orders || base.orders,
    customers: saved.customers || base.customers,
  };
}

function readLocal() {
  try { return mergeState(JSON.parse(localStorage.getItem(demoMode ? "xacheus-demo-store" : `${LOCAL_KEY}-${currentUser?.uid || "guest"}`))); }
  catch { return mergeState(); }
}

async function loadStore(user) {
  state = readLocal();
  if (user && !demoMode) {
    try {
      const snapshot = await getDoc(doc(db, "users", user.uid, "store", "main"));
      if (snapshot.exists()) state = mergeState(snapshot.data());
    } catch (error) { console.info("Using local store while Firebase loads", error.code || error.message); }
  }
  if (user?.displayName && state.store.name === DEFAULT_STORE.store.name) state.store.name = `${user.displayName.split(" ")[0]}'s Store`;
  localStorage.setItem(demoMode ? "xacheus-demo-store" : `${LOCAL_KEY}-${user?.uid || "guest"}`, JSON.stringify(state));
  renderAll();
}

function setSaveIndicator(saving = false) {
  const indicator = $("#save-indicator");
  if (!indicator) return;
  indicator.classList.toggle("saving", saving);
  indicator.innerHTML = saving ? "<i></i> Saving changes…" : "<i></i> All changes saved";
}

async function saveStore(message = "Changes saved") {
  if (!state) return;
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(demoMode ? "xacheus-demo-store" : `${LOCAL_KEY}-${currentUser?.uid || "guest"}`, JSON.stringify(state));
  setSaveIndicator(true);
  if (currentUser && !demoMode) {
    try { await setDoc(doc(db, "users", currentUser.uid, "store", "main"), { ...state, updatedAt: serverTimestamp() }, { merge: true }); }
    catch (error) { console.info("Local save complete; Firebase sync unavailable", error.code || error.message); }
  }
  setSaveIndicator(false);
  showToast(message);
}

function showToast(message = "Changes saved") {
  const toast = $("#toast");
  if (!toast) return;
  toast.querySelector("p").textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function renderAll() {
  if (!state) return;
  const storeName = state.store.name || "Your store";
  $("#switcher-name").textContent = storeName;
  $(".preview-link").href = `storefront.html?store=${encodeURIComponent(state.store.slug || "sage-co")}`;
  $("#store-avatar").textContent = initials(storeName);
  $("#products-nav-count").textContent = state.products.length;
  $("#product-total").textContent = state.products.length;
  $("#products-footer").textContent = `Showing ${state.products.length} product${state.products.length === 1 ? "" : "s"}`;
  $("#orders-nav-count").textContent = state.orders.filter((order) => order.fulfillment === "Unfulfilled").length;
  $("#order-total").textContent = state.orders.length;
  renderOverview(); renderTheme(); renderNavigation(); renderProducts(); renderCollections(); renderInventory(); renderOrders(); renderCustomers(); renderSettings();
}

function renderOverview() {
  const userName = currentUser?.displayName?.split(" ")[0] || "Maya";
  $("#greeting-name").textContent = userName;
  $("#sidebar-user-name").textContent = currentUser?.displayName || userName;
  $("#sidebar-user-email").textContent = currentUser?.email || (demoMode ? "Demo workspace" : "Store owner");
  const initialsText = initials(currentUser?.displayName || userName);
  $("#sidebar-user-avatar").textContent = initialsText; $("#top-avatar").textContent = initialsText;
  $("#metric-orders").textContent = (48 + state.orders.length - DEFAULT_STORE.orders.length).toLocaleString();
  const body = $("#recent-orders-body");
  body.innerHTML = state.orders.slice(0, 4).map((order) => `<tr><td><span class="order-id">${esc(order.id)}</span></td><td><span class="customer-cell"><span class="customer-avatar ${esc(order.color)}">${esc(order.initials)}</span>${esc(order.customer)}</span></td><td>${esc(order.date)}</td><td><strong>${money(order.total)}</strong></td><td><span class="status-chip ${order.fulfillment === "Fulfilled" ? "green-chip" : "purple-chip"}">${esc(order.fulfillment)}</span></td><td><button class="row-menu" type="button">•••</button></td></tr>`).join("");
}

function orderRow(order) {
  return `<tr><td><span class="order-id">${esc(order.id)}</span></td><td><span class="customer-cell"><span class="customer-avatar ${esc(order.color)}">${esc(order.initials)}</span>${esc(order.customer)}</span></td><td>${esc(order.date)}</td><td>${order.items} item${order.items === 1 ? "" : "s"}</td><td><strong>${money(order.total)}</strong></td><td><span class="status-chip ${order.payment === "Paid" ? "green-chip" : "yellow-chip"}">${esc(order.payment)}</span></td><td><span class="status-chip ${order.fulfillment === "Fulfilled" ? "green-chip" : "purple-chip"}">${esc(order.fulfillment)}</span></td><td><button class="row-menu" type="button">•••</button></td></tr>`;
}

function renderTheme() {
  const stack = $("#section-stack");
  stack.innerHTML = state.sections.map((section, index) => `<div class="section-item ${index === 1 ? "selected" : ""}" data-section-id="${esc(section.id)}"><span class="drag-icon">⋮⋮</span><span class="section-label"><b>${esc(section.label)}</b><small>${section.enabled === false ? "Hidden" : "Visible"}</small></span><span class="section-actions"><button type="button" data-move-section="up" data-section-id="${esc(section.id)}" title="Move up">↑</button><button type="button" data-move-section="down" data-section-id="${esc(section.id)}" title="Move down">↓</button><button type="button" data-edit-section="${esc(section.id)}" title="Edit">✎</button><button type="button" data-remove-section="${esc(section.id)}" title="Remove">×</button></span></div>`).join("");
  $("#theme-preview").innerHTML = previewMarkup();
  $("#theme-preview").style.setProperty("--preview-primary", state.store.primary);
  $("#theme-preview").style.setProperty("--preview-dark", state.store.dark);
}

function previewMarkup() {
  const visibleSections = state.sections.filter((section) => section.enabled !== false);
  return `<div class="storefront-preview" data-spacing="${esc(state.store.spacing || "comfortable")}" style="--preview-primary:${esc(state.store.primary)};--preview-dark:${esc(state.store.dark)};font-family:${esc(state.store.font || "DM Sans")}, sans-serif">${visibleSections.map((section) => {
    const d = section.data || {};
    if (section.type === "announcement") return `<div class="preview-announcement">${esc(d.text || state.store.announcement)}</div>`;
    if (section.type === "banner") { const layoutClass = String(d.layout || "Full width").toLowerCase().replace(/\s+/g, "-"); return `<section class="preview-banner layout-${layoutClass} ${d.image ? "has-image" : ""}" ${d.image ? `style="background-image:url('${esc(d.image)}')"` : ""}><div class="preview-banner-content"><small>${esc(d.eyebrow || "WELCOME TO OUR STORE")}</small><h2>${esc(d.heading || "Your story starts here.")}</h2><p>${esc(d.description || "A thoughtful collection made for your everyday.")}</p><span class="preview-cta">${esc(d.buttonText || "Shop now")} <b>↗</b></span></div><div class="preview-visual"></div></section>`; }
    if (section.type === "products") return `<section class="preview-products-block"><div class="preview-block-heading"><div><h3>${esc(d.heading || "Shop our favorites")}</h3><p>${esc(d.description || "A few things you’ll love.")}</p></div><span>View all →</span></div><div class="preview-product-grid">${state.products.slice(0, 3).map((product) => `<article class="preview-product"><div class="preview-product-image ${product.image ? "image" : ""}" ${product.image ? `style="background-image:url('${esc(product.image)}')"` : ""}></div><div class="preview-product-copy"><h4>${esc(product.title)}</h4><p>${money(product.price)}</p><small>${product.inventory} in stock</small></div></article>`).join("")}</div></section>`;
    if (section.type === "story") return `<section class="preview-story-block"><div><h3>${esc(d.heading || "Made for your everyday.")}</h3><p>${esc(d.text || "Beautiful things, made to last.")}</p><span class="preview-cta">${esc(d.buttonText || "Learn more")} →</span></div><div class="preview-story-art"></div></section>`;
    if (section.type === "testimonials") return `<section class="preview-story-block"><div><h3>“Beautiful, useful, and made with care.”</h3><p>What our customers are saying about the collection.</p></div></section>`;
    if (section.type === "newsletter") return `<section class="preview-story-block"><div><h3>${esc(d.heading || "Stay in the loop")}</h3><p>${esc(d.text || "New arrivals and thoughtful notes, occasionally.")}</p></div></section>`;
    return `<footer class="preview-footer">${esc(d.text || state.store.description)} <span>© ${new Date().getFullYear()} ${esc(state.store.name)}</span></footer>`;
  }).join("")}</div>`;
}

function renderNavigation() {
  $("#menu-editor").innerHTML = state.menu.map((item, index) => `<div class="menu-row" data-menu-id="${esc(item.id)}"><span>⋮⋮</span><label><small>Menu name</small><input data-menu-field="title" value="${esc(item.title)}" /></label><label><small>Link</small><input data-menu-field="url" value="${esc(item.url)}" /></label><button type="button" data-delete-menu="${esc(item.id)}" aria-label="Remove menu item">×</button></div>`).join("");
}

function renderProducts() {
  const query = $("#product-search")?.value?.toLowerCase() || "";
  const products = state.products.filter((product) => `${product.title} ${product.category} ${product.sku}`.toLowerCase().includes(query));
  $("#products-body").innerHTML = products.map((product) => `<tr><td><input type="checkbox" aria-label="Select ${esc(product.title)}" /></td><td><span class="product-name-cell"><span class="product-thumb ${product.image ? "" : product.category === "Bags" ? "blue" : "purple"}" ${product.image ? `style="background-image:url('${esc(product.image)}')"` : ""}></span><span><strong>${esc(product.title)}</strong><small>${esc(product.sku || "No SKU")}</small></span></span></td><td><span class="status-chip ${product.status === "Active" ? "green-chip" : "neutral-chip"}">${esc(product.status || "Draft")}</span></td><td class="${product.inventory < 10 ? "stock-low" : "stock-good"}">${product.inventory} in stock</td><td><strong>${money(product.price)}</strong>${product.compareAt ? ` <del class="old-price">${money(product.compareAt)}</del>` : ""}</td><td>${esc(product.category || "Uncategorized")}</td><td><button class="row-action-button" type="button" data-edit-product="${esc(product.id)}">•••</button></td></tr>`).join("") || `<tr><td colspan="7"><div class="empty-table">No products found.</div></td></tr>`;
}

function renderCollections() {
  $("#collection-grid").innerHTML = state.collections.map((collection) => `<article class="collection-card"><div class="collection-art ${esc(collection.color)}"></div><div class="collection-body"><h2>${esc(collection.title)}</h2><p>${esc(collection.description)}</p><div class="collection-meta"><span>${collection.count || 0} products</span><button type="button" data-edit-collection="${esc(collection.id)}">Edit collection →</button></div></div></article>`).join("");
}

function renderInventory() {
  $("#inventory-body").innerHTML = state.products.map((product) => `<tr><td><span class="product-name-cell"><span class="product-thumb ${product.image ? "" : "purple"}" ${product.image ? `style="background-image:url('${esc(product.image)}')"` : ""}></span><span><strong>${esc(product.title)}</strong><small>${esc(product.category || "Uncategorized")}</small></span></span></td><td>${esc(product.sku || "—")}</td><td><strong>${product.inventory}</strong></td><td>—</td><td><span class="status-chip ${product.inventory < 10 ? "yellow-chip" : "green-chip"}">${product.inventory < 10 ? "Low stock" : "In stock"}</span></td><td><button class="row-action-button" data-edit-product="${esc(product.id)}" type="button">Adjust</button></td></tr>`).join("");
}

function renderOrders() {
  $("#orders-body").innerHTML = state.orders.map(orderRow).join("");
}
function renderCustomers() {
  $("#customers-body").innerHTML = state.customers.map((customer) => `<tr><td><span class="customer-cell"><span class="customer-avatar ${esc(customer.color)}">${esc(customer.initials)}</span><span><strong>${esc(customer.name)}</strong><small class="muted-cell">${esc(customer.email)}</small></span></span></td><td>${customer.orders}</td><td><strong>${money(customer.spent)}</strong></td><td>${esc(customer.location)}</td><td>${esc(customer.lastOrder)}</td><td><button class="row-menu" type="button">•••</button></td></tr>`).join("");
}
function renderSettings() {
  const name = state.store.name || "Sage & Co.";
  $("#settings-store-name").value = name;
  $("#settings-store-slug").value = state.store.slug || "sage-co";
  $("#settings-store-description").value = state.store.description || "";
}

function openModal(title, content, overline = "Edit") { $("#modal-overline").textContent = overline; $("#modal-title").textContent = title; $("#modal-content").innerHTML = content; $("#modal-backdrop").hidden = false; document.body.classList.add("modal-open"); }
function closeModal() { $("#modal-backdrop").hidden = true; document.body.classList.remove("modal-open"); }
function formActions(cancelLabel = "Cancel", saveLabel = "Save") { return `<div class="modal-form-actions"><button type="button" class="secondary-button" id="modal-cancel">${cancelLabel}</button><button type="submit" class="primary-button">${saveLabel}</button></div>`; }

function openSectionEditor(id) {
  const section = state.sections.find((item) => item.id === id); if (!section) return;
  const d = section.data || {};
  if (section.type === "banner") {
    openModal("Banner settings", `<form class="modal-form" id="section-form"><label>Eyebrow <input name="eyebrow" value="${esc(d.eyebrow)}" placeholder="NEW SEASON / 2026" /></label><label>Heading <input name="heading" value="${esc(d.heading)}" placeholder="Summer collection" required /></label><label>Description <textarea name="description" placeholder="Tell customers what makes this collection special.">${esc(d.description)}</textarea></label><div class="form-row"><label>Button text <input name="buttonText" value="${esc(d.buttonText)}" placeholder="Shop now" /></label><label>Button link <input name="buttonLink" value="${esc(d.buttonLink)}" placeholder="/collections/summer" /></label></div><label>Layout<select name="layout"><option ${d.layout === "Full width" ? "selected" : ""}>Full width</option><option ${d.layout === "Split" ? "selected" : ""}>Split</option><option ${d.layout === "Centered" ? "selected" : ""}>Centered</option></select></label><label class="file-field">Image <span>Upload a JPG, PNG, or use an image URL</span><input type="file" id="section-image-file" accept="image/*" /><input name="image" value="${esc(d.image)}" placeholder="https://images.unsplash.com/..." /></label><p class="modal-hint" id="section-image-upload-status">Uploads securely to your store media library.</p><img class="image-preview" src="${esc(d.image)}" alt="Banner preview" ${d.image ? "" : "hidden"} />${formActions("Cancel", "Save section")}</form>`, "Banner settings");
  } else if (section.type === "products") {
    openModal("Featured products", `<form class="modal-form" id="section-form"><label>Section heading <input name="heading" value="${esc(d.heading)}" required /></label><label>Supporting text <textarea name="description">${esc(d.description)}</textarea></label><label>Show products from<select name="collection"><option value="all">All products</option>${state.collections.map((collection) => `<option value="${esc(collection.id)}" ${d.collection === collection.id ? "selected" : ""}>${esc(collection.title)}</option>`).join("")}</select></label>${formActions("Cancel", "Save section")}</form>`, "Section settings");
  } else if (section.type === "story") {
    openModal("Image with text", `<form class="modal-form" id="section-form"><label>Heading <input name="heading" value="${esc(d.heading)}" required /></label><label>Text <textarea name="text">${esc(d.text)}</textarea></label><div class="form-row"><label>Button text <input name="buttonText" value="${esc(d.buttonText)}" /></label><label>Button link <input name="buttonLink" value="${esc(d.buttonLink)}" /></label></div>${formActions("Cancel", "Save section")}</form>`, "Section settings");
  } else if (section.type === "announcement") {
    openModal("Announcement bar", `<form class="modal-form" id="section-form"><label>Announcement text <input name="text" value="${esc(d.text)}" placeholder="Free delivery this week" required /></label><p class="modal-hint">This message appears at the top of your storefront.</p>${formActions("Cancel", "Save section")}</form>`, "Section settings");
  } else {
    openModal(section.label, `<form class="modal-form" id="section-form"><label>Footer text <textarea name="text">${esc(d.text || state.store.description)}</textarea></label>${formActions("Cancel", "Save section")}</form>`, "Section settings");
  }
  $("#modal-cancel").addEventListener("click", closeModal);
  $("#section-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (section.type === "banner") {
      const file = $("#section-image-file")?.files?.[0];
      if (file) {
        const uploadStatus = $("#section-image-upload-status");
        try {
          if (uploadStatus) uploadStatus.textContent = "Uploading image…";
          values.image = await uploadStoreImage(file);
          if (uploadStatus) uploadStatus.textContent = "Image uploaded.";
        } catch (error) {
          if (uploadStatus) uploadStatus.textContent = error.message;
          return;
        }
      }
    }
    section.data = { ...section.data, ...values }; if (section.type === "announcement") state.store.announcement = values.text;
    closeModal(); renderAll(); await saveStore("Section saved");
  });
  $("#section-image-file")?.addEventListener("change", (event) => previewSelectedImage(event.target.files?.[0]));
}

function openAddSection() {
  openModal("Add section", `<div class="section-choice-grid"><button type="button" data-add-type="banner"><span>▣</span><strong>Banner</strong><small>Hero image, text &amp; button</small></button><button type="button" data-add-type="products"><span>▦</span><strong>Product grid</strong><small>Showcase your products</small></button><button type="button" data-add-type="story"><span>◩</span><strong>Image with text</strong><small>Tell your brand story</small></button><button type="button" data-add-type="newsletter"><span>✉</span><strong>Newsletter</strong><small>Grow your audience</small></button><button type="button" data-add-type="testimonials"><span>❞</span><strong>Testimonials</strong><small>Build customer trust</small></button><button type="button" data-add-type="footer"><span>▰</span><strong>Footer</strong><small>Store info &amp; links</small></button></div>`, "Build your page");
}

function addSection(type) {
  const data = type === "banner" ? { eyebrow: "NEW SEASON / 2026", heading: "Your story starts here.", description: "Tell customers what makes your products special.", buttonText: "Shop now", buttonLink: "/collections/all", image: "", layout: "Full width" } : type === "products" ? { heading: "Shop our favorites", description: "A few things you’ll love.", collection: "all" } : type === "story" ? { heading: "Made for your everyday.", text: "Share what makes your brand special.", buttonText: "Learn more", buttonLink: "/pages/about" } : type === "newsletter" ? { heading: "Stay in the loop", text: "New arrivals and thoughtful notes, occasionally." } : type === "testimonials" ? {} : { text: state.store.description };
  const newSection = { id: uid("section"), type, label: titleFromType(type), enabled: true, data };
  const footerIndex = state.sections.findIndex((section) => section.type === "footer");
  state.sections.splice(footerIndex < 0 ? state.sections.length : footerIndex, 0, newSection);
  closeModal(); renderAll(); openSectionEditor(newSection.id);
}

function openProductEditor(id = null) {
  const product = id ? state.products.find((item) => item.id === id) : { title: "", description: "", price: "", compareAt: "", inventory: 0, sku: "", category: "New arrivals", image: "", variants: "" };
  openModal(id ? "Edit product" : "Add product", `<form class="modal-form" id="product-form"><label>Product name <input name="title" value="${esc(product.title)}" placeholder="Product name" required /></label><div class="form-row"><label>Price <input name="price" type="number" min="0" step="1" value="${esc(product.price)}" placeholder="0" required /></label><label>Compare-at price <input name="compareAt" type="number" min="0" value="${esc(product.compareAt || "")}" placeholder="Optional" /></label></div><div class="form-row"><label>Inventory <input name="inventory" type="number" min="0" value="${esc(product.inventory)}" required /></label><label>SKU <input name="sku" value="${esc(product.sku)}" placeholder="SKU-001" /></label></div><label>Category <input name="category" value="${esc(product.category)}" placeholder="New arrivals" /></label><label>Variants <input name="variants" value="${esc(product.variants)}" placeholder="S, M, L, XL" /></label><label>Description <textarea name="description" placeholder="Describe this product.">${esc(product.description)}</textarea></label><label class="file-field">Product image <span>Upload a real product image or paste a URL</span><input type="file" id="product-image-file" accept="image/*" /><input name="image" value="${esc(product.image)}" placeholder="https://..." /></label><p class="modal-hint" id="product-image-upload-status">Uploads securely to your store media library.</p><img class="image-preview" src="${esc(product.image)}" alt="Product preview" ${product.image ? "" : "hidden"} /><div class="modal-form-actions">${id ? `<button type="button" class="danger-button" id="delete-product-modal">Delete product</button>` : ""}<span></span><button type="button" class="secondary-button" id="modal-cancel">Cancel</button><button type="submit" class="primary-button">${id ? "Save product" : "Add product"}</button></div></form>`, "Catalog");
  $("#modal-cancel").addEventListener("click", closeModal);
  $("#delete-product-modal")?.addEventListener("click", async () => { state.products = state.products.filter((item) => item.id !== id); closeModal(); renderAll(); await saveStore("Product deleted"); });
  $("#product-image-file")?.addEventListener("change", (event) => previewSelectedImage(event.target.files?.[0]));
  $("#product-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const file = $("#product-image-file")?.files?.[0];
    if (file) {
      const uploadStatus = $("#product-image-upload-status");
      const submitButton = event.currentTarget.querySelector('[type="submit"]');
      try {
        if (uploadStatus) uploadStatus.textContent = "Uploading image…";
        if (submitButton) { submitButton.disabled = true; submitButton.textContent = "Uploading…"; }
        values.image = await uploadStoreImage(file);
        if (uploadStatus) uploadStatus.textContent = "Image uploaded.";
      } catch (error) {
        if (uploadStatus) uploadStatus.textContent = error.message;
        if (submitButton) { submitButton.disabled = false; submitButton.textContent = id ? "Save product" : "Add product"; }
        return;
      }
    }
    values.price = Number(values.price || 0); values.compareAt = Number(values.compareAt || 0); values.inventory = Number(values.inventory || 0); values.status = "Active"; if (id) Object.assign(product, values); else state.products.unshift({ ...product, ...values, id: uid("product") }); closeModal(); renderAll(); await saveStore(id ? "Product updated" : "Product added");
  });
}

function openCollectionEditor(id = null) {
  const collection = id ? state.collections.find((item) => item.id === id) : { title: "", description: "", count: 0, color: "purple" };
  openModal(id ? "Edit collection" : "Create collection", `<form class="modal-form" id="collection-form"><label>Collection name <input name="title" value="${esc(collection.title)}" placeholder="Summer collection" required /></label><label>Description <textarea name="description">${esc(collection.description)}</textarea></label><label>Collection color<select name="color"><option value="purple">Lavender</option><option value="green">Sage green</option><option value="orange">Warm orange</option></select></label>${formActions("Cancel", id ? "Save collection" : "Create collection")}</form>`, "Catalog");
  $("#modal-cancel").addEventListener("click", closeModal); $("#collection-form").addEventListener("submit", async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget).entries()); if (id) Object.assign(collection, values); else state.collections.push({ ...values, id: uid("collection"), count: 0 }); closeModal(); renderAll(); await saveStore(id ? "Collection updated" : "Collection created"); });
}

function openThemeSettings() {
  openModal("Theme settings", `<form class="modal-form" id="theme-settings-form"><label>Store name <input name="name" value="${esc(state.store.name)}" required /></label><div class="form-row"><label>Primary color <input name="primary" type="color" value="${esc(state.store.primary)}" /></label><label>Dark color <input name="dark" type="color" value="${esc(state.store.dark)}" /></label></div><div class="form-row"><label>Font<select name="font"><option ${state.store.font === "DM Sans" ? "selected" : ""}>DM Sans</option><option ${state.store.font === "Inter" ? "selected" : ""}>Inter</option><option ${state.store.font === "Plus Jakarta Sans" ? "selected" : ""}>Plus Jakarta Sans</option></select></label><label>Section spacing<select name="spacing"><option ${state.store.spacing === "comfortable" ? "selected" : ""}>comfortable</option><option ${state.store.spacing === "compact" ? "selected" : ""}>compact</option><option ${state.store.spacing === "spacious" ? "selected" : ""}>spacious</option></select></label></div><label>Announcement message <input name="announcement" value="${esc(state.store.announcement)}" /></label>${formActions("Cancel", "Save theme")}</form>`, "Theme settings");
  $("#modal-cancel").addEventListener("click", closeModal); $("#theme-settings-form").addEventListener("submit", async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget).entries()); Object.assign(state.store, values); state.sections.find((section) => section.type === "announcement")?.data && (state.sections.find((section) => section.type === "announcement").data.text = values.announcement); closeModal(); renderAll(); await saveStore("Theme settings saved"); });
}

function previewSelectedImage(file) {
  if (!file) return;
  const preview = $(".image-preview");
  if (!preview) return;
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
}
function exportData(filename, data) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }

function navigate(view) {
  if (!view) return;
  $$(".store-nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === view));
  $$(".store-view").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === view));
  $("#breadcrumb-parent").textContent = ["products", "collections", "inventory"].includes(view) ? "Catalog" : ["orders", "customers", "marketing"].includes(view) ? "Sell" : view === "overview" ? "" : "Online store";
  $("#breadcrumb-current").textContent = view[0].toUpperCase() + view.slice(1);
  history.replaceState(null, "", `#${view}`);
  $("#store-sidebar").classList.remove("open"); $("#sidebar-overlay").classList.remove("open");
}

$$('[data-view]').forEach((element) => element.addEventListener("click", (event) => { event.preventDefault(); navigate(element.dataset.view); }));
$("#sidebar-open").addEventListener("click", () => { $("#store-sidebar").classList.add("open"); $("#sidebar-overlay").classList.add("open"); });
$("#sidebar-close").addEventListener("click", () => { $("#store-sidebar").classList.remove("open"); $("#sidebar-overlay").classList.remove("open"); });
$("#sidebar-overlay").addEventListener("click", () => { $("#store-sidebar").classList.remove("open"); $("#sidebar-overlay").classList.remove("open"); });
$("#modal-close").addEventListener("click", closeModal); $("#modal-backdrop").addEventListener("click", (event) => { if (event.target.id === "modal-backdrop") closeModal(); });
$("#add-section-button").addEventListener("click", openAddSection); $("#open-theme-settings").addEventListener("click", openThemeSettings); $("#open-theme-settings-2").addEventListener("click", openThemeSettings); $("#theme-save-button").addEventListener("click", () => saveStore("Theme saved")); $("#theme-preview-button").addEventListener("click", () => window.open(`storefront.html?store=${encodeURIComponent(state.store.slug)}`, "_blank"));
$("#publish-store").addEventListener("click", async () => { const button = $("#publish-store"); button.disabled = true; button.textContent = "Publishing…"; state.published = true; state.publishedAt = new Date().toISOString(); await saveStore("Your store is live"); localStorage.setItem(`xacheus-published-${state.store.slug}`, JSON.stringify(state)); if (currentUser && !demoMode) { try { await setDoc(doc(db, "publicStores", state.store.slug), { ...state, publishedBy: currentUser.uid, published: true, publishedAt: serverTimestamp() }); } catch (error) { console.info("Local publish complete; public Firebase copy unavailable", error.code || error.message); } } button.disabled = false; button.textContent = "Published ✓"; setTimeout(() => { button.textContent = "Publish"; }, 2400); });
$("#add-product-button").addEventListener("click", () => openProductEditor()); $("#add-collection-button").addEventListener("click", () => openCollectionEditor()); $("#add-menu-item").addEventListener("click", () => { state.menu.push({ id: uid("menu"), title: "New link", url: "/" }); renderNavigation(); }); $("#save-navigation").addEventListener("click", () => saveStore("Menu saved"));
$("#save-settings").addEventListener("click", async () => { state.store.name = $("#settings-store-name").value.trim() || "Your store"; state.store.slug = $("#settings-store-slug").value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"); state.store.description = $("#settings-store-description").value.trim(); renderAll(); await saveStore("Store settings saved"); });
$("#product-search").addEventListener("input", renderProducts); $("#connect-domain").addEventListener("click", () => showToast("Domain connection setup is ready for your custom domain")); $("#create-campaign")?.addEventListener("click", () => showToast("AI campaign workspace is coming next — your store data is ready")); $("#export-orders")?.addEventListener("click", () => exportData("xacheus-orders.json", state.orders)); $("#export-customers")?.addEventListener("click", () => exportData("xacheus-customers.json", state.customers)); $("#add-page-button")?.addEventListener("click", () => showToast("Page editor added to your workspace"));
$("#modal-content").addEventListener("click", (event) => { const addType = event.target.closest("[data-add-type]"); if (addType) addSection(addType.dataset.addType); });
$("#section-stack").addEventListener("click", async (event) => { const item = event.target.closest(".section-item"); if (!item) return; const id = item.dataset.sectionId; const move = event.target.closest("[data-move-section]"); const edit = event.target.closest("[data-edit-section]"); const remove = event.target.closest("[data-remove-section]"); if (remove) { if (state.sections.length <= 1) return showToast("Keep at least one section on your page"); state.sections = state.sections.filter((section) => section.id !== id); renderAll(); await saveStore("Section removed"); return; } if (move) { const index = state.sections.findIndex((section) => section.id === id); const next = move.dataset.moveSection === "up" ? index - 1 : index + 1; if (next >= 0 && next < state.sections.length) [state.sections[index], state.sections[next]] = [state.sections[next], state.sections[index]]; renderAll(); await saveStore("Sections reordered"); return; } if (edit) { openSectionEditor(id); return; } openSectionEditor(id); });
$("#menu-editor").addEventListener("input", (event) => { const row = event.target.closest(".menu-row"); const item = state.menu.find((menu) => menu.id === row?.dataset.menuId); if (item && event.target.dataset.menuField) item[event.target.dataset.menuField] = event.target.value; }); $("#menu-editor").addEventListener("click", async (event) => { const button = event.target.closest("[data-delete-menu]"); if (!button) return; state.menu = state.menu.filter((item) => item.id !== button.dataset.deleteMenu); renderNavigation(); await saveStore("Menu item removed"); });
$("#products-body").addEventListener("click", (event) => { const button = event.target.closest("[data-edit-product]"); if (button) openProductEditor(button.dataset.editProduct); }); $("#inventory-body").addEventListener("click", (event) => { const button = event.target.closest("[data-edit-product]"); if (button) openProductEditor(button.dataset.editProduct); }); $("#collection-grid").addEventListener("click", (event) => { const button = event.target.closest("[data-edit-collection]"); if (button) openCollectionEditor(button.dataset.editCollection); });
$$('[data-device]').forEach((button) => button.addEventListener("click", () => { $$('[data-device]').forEach((item) => item.classList.toggle("active", item === button)); $("#store-preview-frame").classList.toggle("mobile", button.dataset.device === "mobile"); }));
$("#logout-button").addEventListener("click", async () => { if (demoMode) { window.location.href = "auth.html"; return; } await signOut(auth); window.location.href = "index.html"; });

onAuthStateChanged(auth, async (user) => { currentUser = user; if (!user && !demoMode) { window.location.href = "auth.html?next=dashboard.html"; return; } await loadStore(user); const hash = window.location.hash.slice(1); if (hash && $(`[data-view-panel="${hash}"]`)) navigate(hash); });

// Allow the app to render in a browser even if Firebase authentication is still resolving.
if (demoMode) { currentUser = null; loadStore(null); }
