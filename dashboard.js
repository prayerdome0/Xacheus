import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, doc, getDoc, onSnapshot, orderBy, query, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { ADMIN_WHATSAPP, auth, db, serverTimestamp } from "./firebase.js";
import { CLOUDINARY_STORE_UPLOAD } from "./cloudinary.js";

const demoMode = new URLSearchParams(window.location.search).get("demo") === "1";
const LOCAL_KEY = demoMode ? "xacheus-demo-store" : "xacheus-store";
let currentUser = null;
let state = null;
let toastTimer;
let ordersUnsubscribe = null;

const CLOUDINARY_MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_STORE_UPLOAD.cloudName}/image/upload`;

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
    whatsapp: ADMIN_WHATSAPP,
    manualPaymentEnabled: true,
    manualPaymentTitle: "Manual payment via WhatsApp",
    manualPaymentInstructions: "Send your order on WhatsApp. We will confirm availability, delivery fees, and mobile money or bank payment details before you pay.",
    deliveryMode: "Local delivery + pickup",
    deliveryFee: 35,
    freeDeliveryThreshold: 500,
    deliveryInstructions: "Delivery is confirmed on WhatsApp after we check your location and stock availability.",
    customDomain: "",
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
function normalizeWhatsAppNumber(value = ADMIN_WHATSAPP) { const digits = String(value || "").replace(/\D/g, ""); if (!digits) return "260973028342"; return digits.startsWith("0") ? `260${digits.slice(1)}` : digits; }
function buildWhatsAppUrl(phone, message) { return `https://wa.me/${normalizeWhatsAppNumber(phone)}?text=${encodeURIComponent(message)}`; }
function samplePaymentMessage(store = state?.store || {}) { return `Hello ${store.name || "Store"}, I would like to place an order from your online store. Please confirm availability and send me manual payment instructions. Total: ${money(0)}`; }
function productImage(product = {}) { return product.images?.find(Boolean) || product.image || ""; }
function productThumb(product, fallback = "purple") { const image = productImage(product); const fallbackClass = image ? "" : product.category === "Bags" ? "blue" : fallback; return `<span class="product-thumb ${fallbackClass}" ${image ? `style="background-image:url('${esc(image)}')"` : ""}></span>`; }
function splitImageUrls(value = "") { return String(value).split(/[
,]+/).map((url) => url.trim()).filter(Boolean); }
function uniqueImages(images = []) { return [...new Set(images.map((image) => String(image || "").trim()).filter(Boolean))]; }
function aiProductDescription(values = {}) { const title = values.title || "This product"; const category = values.category || "collection"; const variants = values.variants ? ` Available options: ${values.variants}.` : ""; return `${title} is a quality ${category.toLowerCase()} item selected for customers who want style, value, and everyday reliability.${variants} Add it to your order and contact us on WhatsApp for availability, delivery details, and manual payment instructions.`; }
function parseVariantStock(value = "") { return Object.fromEntries(String(value || "").split(/[\n,]+/).map((line) => line.split(":").map((part) => part.trim())).filter(([name, qty]) => name && qty !== undefined).map(([name, qty]) => [name, Number(qty || 0)])); }
function formatVariantStock(stock = {}) { return Object.entries(stock || {}).map(([name, qty]) => `${name}: ${qty}`).join("\n"); }
function orderTotal(order = {}) { return order.subtotal !== undefined ? Number(order.subtotal || 0) + Number(order.deliveryFee || 0) : Number(order.total || 0); }
function isPaid(order = {}) { return ["Paid", "Payment received", "Approved"].includes(order.payment); }
function orderStatusClass(value = "") { if (["Paid", "Payment received", "Fulfilled", "Delivered"].includes(value)) return "green-chip"; if (["Manual pending", "Pending", "Payment requested", "Packed", "Out for delivery", "New", "Unfulfilled"].includes(value)) return "yellow-chip"; if (["Cancelled", "Rejected", "Failed", "Refunded"].includes(value)) return "neutral-chip"; return "purple-chip"; }
function publicStoreUrl() { return `${location.origin}${location.pathname.replace(/dashboard\.html$/, "storefront.html")}?store=${encodeURIComponent(state?.store?.slug || "sage-co")}`; }
function orderItems(order = {}) { return order.rawItems || order.itemsList || (Array.isArray(order.items) ? order.items : []); }
function orderItemsCount(order = {}) { const items = orderItems(order); return items.length ? items.reduce((sum, item) => sum + Number(item.quantity || 1), 0) : Number(order.items || 0); }
function orderCustomerPhone(order = {}) { return order.customerPhone || order.phone || ""; }
function orderCustomerLocation(order = {}) { return order.deliveryLocation || order.location || ""; }
function orderMessage(order = {}) { const items = orderItems(order).map((item) => `- ${item.quantity || 1} × ${item.title || item.name} (${money(Number(item.price || 0) * Number(item.quantity || 1))})`).join("\n") || `${orderItemsCount(order)} item(s)`; return `Hello ${order.customer || order.customerName || "customer"}, update for order ${order.id || order.orderNumber}.\n\nItems:\n${items}\n\nTotal: ${money(orderTotal(order))}.\nPayment status: ${order.payment || order.paymentStatus || "Manual pending"}.\nFulfillment: ${order.fulfillment || "New"}.`; }
function analytics() { const orders = state?.orders || []; const paidOrders = orders.filter(isPaid); const sales = paidOrders.reduce((sum, order) => sum + orderTotal(order), 0); const pendingPayments = orders.filter((order) => !isPaid(order)).length; const lowStock = (state?.products || []).filter((product) => Number(product.inventory || 0) < 10).length; const visitors = Math.max(1284, orders.length * 90); return { orders, paidOrders, sales, pendingPayments, lowStock, visitors, conversion: visitors ? ((orders.length / visitors) * 100).toFixed(2) : "0.00" }; }
function derivedCustomers() { const map = new Map((state?.customers || []).map((customer) => [customer.name, { ...customer }])); (state?.orders || []).forEach((order) => { const name = order.customer || order.customerName; if (!name) return; const existing = map.get(name) || { name, email: order.customerEmail || "WhatsApp customer", initials: initials(name), color: "green", orders: 0, spent: 0, location: orderCustomerLocation(order) || "—", lastOrder: order.date || "Recent", phone: orderCustomerPhone(order), notes: "" }; existing.orders = Number(existing.orders || 0) + (map.has(name) ? 0 : 0); existing.spent = Number(existing.spent || 0); if (!map.has(name)) { existing.orders = 0; existing.spent = 0; } existing.orders += 1; existing.spent += orderTotal(order); existing.location = orderCustomerLocation(order) || existing.location || "—"; existing.lastOrder = order.date || existing.lastOrder || "Recent"; existing.phone = orderCustomerPhone(order) || existing.phone || ""; map.set(name, existing); }); return [...map.values()]; }

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

function importLocalCheckoutOrders() {
  const saved = JSON.parse(localStorage.getItem(`xacheus-orders-${state.store.slug}`) || "[]");
  const localOrders = saved.map((item) => ({ id: item.orderNumber || `#WA-${String(item.createdAt || Date.now()).slice(-6)}`, customer: item.customerName || "WhatsApp customer", initials: initials(item.customerName || "WC"), color: "green", date: item.createdAt ? new Date(item.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Local checkout", rawItems: item.items || [], items: (item.items || []).reduce((sum, entry) => sum + Number(entry.quantity || 1), 0), subtotal: Number(item.subtotal ?? item.total ?? 0), deliveryFee: Number(item.deliveryFee || 0), total: Number(item.total || 0), payment: item.paymentStatus || "Manual pending", fulfillment: item.fulfillment || "New", customerPhone: item.customerPhone || "", deliveryLocation: item.deliveryLocation || "", notes: item.notes || "", source: "local-checkout" }));
  if (localOrders.length) { const existing = new Set(state.orders.map((order) => order.id)); state.orders = [...localOrders.filter((order) => !existing.has(order.id)), ...state.orders]; }
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
  importLocalCheckoutOrders();
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
  $("#orders-nav-count").textContent = state.orders.filter((order) => !["Fulfilled", "Delivered", "Cancelled"].includes(order.fulfillment)).length;
  $("#order-total").textContent = state.orders.length;
  renderOverview(); renderTheme(); renderNavigation(); renderProducts(); renderCollections(); renderInventory(); renderOrders(); renderCustomers(); renderPayments(); renderSettings();
}

function renderOverview() {
  const userName = currentUser?.displayName?.split(" ")[0] || "Maya";
  $("#greeting-name").textContent = userName;
  $("#sidebar-user-name").textContent = currentUser?.displayName || userName;
  $("#sidebar-user-email").textContent = currentUser?.email || (demoMode ? "Demo workspace" : "Store owner");
  const initialsText = initials(currentUser?.displayName || userName);
  $("#sidebar-user-avatar").textContent = initialsText; $("#top-avatar").textContent = initialsText;
  const stats = analytics();
  $("#metric-sales").textContent = money(stats.sales);
  $("#metric-orders").textContent = stats.orders.length.toLocaleString();
  $("#metric-visits").textContent = stats.visitors.toLocaleString();
  const conversionMetric = $(".metric-tile:nth-child(4) > strong"); if (conversionMetric) conversionMetric.textContent = `${stats.conversion}%`;
  const body = $("#recent-orders-body");
  body.innerHTML = state.orders.slice(0, 4).map((order) => `<tr><td><span class="order-id">${esc(order.id)}</span></td><td><span class="customer-cell"><span class="customer-avatar ${esc(order.color || "green")}">${esc(order.initials || initials(order.customer))}</span>${esc(order.customer)}</span></td><td>${esc(order.date)}</td><td><strong>${money(orderTotal(order))}</strong></td><td><span class="status-chip ${orderStatusClass(order.fulfillment)}">${esc(order.fulfillment)}</span></td><td><button class="row-menu" type="button" data-view-order="${esc(order.id)}">View</button></td></tr>`).join("");
}

function orderRow(order) {
  const itemCount = orderItemsCount(order);
  return `<tr data-order-id="${esc(order.id)}"><td><span class="order-id">${esc(order.id)}</span></td><td><span class="customer-cell"><span class="customer-avatar ${esc(order.color || "green")}">${esc(order.initials || initials(order.customer))}</span>${esc(order.customer)}</span></td><td>${esc(order.date)}</td><td>${itemCount} item${itemCount === 1 ? "" : "s"}</td><td><strong>${money(orderTotal(order))}</strong></td><td><span class="status-chip ${orderStatusClass(order.payment)}">${esc(order.payment || "Manual pending")}</span></td><td><span class="status-chip ${orderStatusClass(order.fulfillment)}">${esc(order.fulfillment || "New")}</span></td><td><button class="row-action-button" type="button" data-view-order="${esc(order.id)}">View</button></td></tr>`;
}

function checkoutOrderFromDoc(docSnap) {
  const item = docSnap.data();
  const created = item.createdAt?.toDate?.();
  const date = created ? created.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "New checkout";
  return { id: item.orderNumber || `#WA-${docSnap.id.slice(-5).toUpperCase()}`, customer: item.customerName || "WhatsApp customer", initials: initials(item.customerName || "WC"), color: "green", date, items: (item.items || []).reduce((sum, entry) => sum + Number(entry.quantity || 1), 0), rawItems: item.items || [], subtotal: Number(item.subtotal ?? item.total ?? 0), total: Number(item.total || 0), deliveryFee: Number(item.deliveryFee || 0), payment: item.paymentStatus || "Manual pending", fulfillment: item.fulfillment || "New", customerPhone: item.customerPhone || "", deliveryLocation: item.deliveryLocation || "", notes: item.notes || "", source: "storefront", firestoreId: docSnap.id };
}

function startOrderListener() {
  if (!currentUser || demoMode || !state?.store?.slug) return;
  if (ordersUnsubscribe) ordersUnsubscribe();
  try {
    ordersUnsubscribe = onSnapshot(query(collection(db, "publicStores", state.store.slug, "orders"), orderBy("createdAt", "desc")), (snapshot) => {
      const liveOrders = snapshot.docs.map(checkoutOrderFromDoc);
      if (!liveOrders.length) return;
      state.orders = [...liveOrders, ...state.orders.filter((order) => order.source !== "storefront")];
      renderOrders(); renderOverview();
      $("#orders-nav-count").textContent = state.orders.filter((order) => order.fulfillment !== "Fulfilled").length;
      $("#order-total").textContent = state.orders.length;
    }, (error) => console.info("Storefront order sync unavailable", error.code || error.message));
  } catch (error) { console.info("Storefront order listener unavailable", error.code || error.message); }
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
    if (section.type === "products") return `<section class="preview-products-block"><div class="preview-block-heading"><div><h3>${esc(d.heading || "Shop our favorites")}</h3><p>${esc(d.description || "A few things you’ll love.")}</p></div><span>View all →</span></div><div class="preview-product-grid">${state.products.slice(0, 3).map((product) => { const image = productImage(product); return `<article class="preview-product"><div class="preview-product-image ${image ? "image" : ""}" ${image ? `style="background-image:url('${esc(image)}')"` : ""}></div><div class="preview-product-copy"><h4>${esc(product.title)}</h4><p>${money(product.price)}</p><small>${product.inventory} in stock</small></div></article>`; }).join("")}</div></section>`;
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
  $("#products-body").innerHTML = products.map((product) => `<tr><td><input type="checkbox" aria-label="Select ${esc(product.title)}" /></td><td><span class="product-name-cell">${productThumb(product)}<span><strong>${esc(product.title)}</strong><small>${esc(product.sku || "No SKU")}</small></span></span></td><td><span class="status-chip ${product.status === "Active" ? "green-chip" : "neutral-chip"}">${esc(product.status || "Draft")}</span></td><td class="${product.inventory < 10 ? "stock-low" : "stock-good"}">${product.inventory} in stock</td><td><strong>${money(product.price)}</strong>${product.compareAt ? ` <del class="old-price">${money(product.compareAt)}</del>` : ""}</td><td>${esc(product.category || "Uncategorized")}</td><td><button class="row-action-button" type="button" data-edit-product="${esc(product.id)}">•••</button></td></tr>`).join("") || `<tr><td colspan="7"><div class="empty-table">No products found.</div></td></tr>`;
}

function renderCollections() {
  $("#collection-grid").innerHTML = state.collections.map((collection) => `<article class="collection-card"><div class="collection-art ${esc(collection.color)}"></div><div class="collection-body"><h2>${esc(collection.title)}</h2><p>${esc(collection.description)}</p><div class="collection-meta"><span>${collection.count || 0} products</span><button type="button" data-edit-collection="${esc(collection.id)}">Edit collection →</button></div></div></article>`).join("");
}

function renderInventory() {
  $("#inventory-body").innerHTML = state.products.map((product) => `<tr><td><span class="product-name-cell">${productThumb(product, "purple")}<span><strong>${esc(product.title)}</strong><small>${esc(product.category || "Uncategorized")}</small></span></span></td><td>${esc(product.sku || "—")}</td><td><strong>${product.inventory}</strong></td><td>—</td><td><span class="status-chip ${product.inventory < 10 ? "yellow-chip" : "green-chip"}">${product.inventory < 10 ? "Low stock" : "In stock"}</span></td><td><button class="row-action-button" data-edit-product="${esc(product.id)}" type="button">Adjust</button></td></tr>`).join("");
}

function renderOrders() {
  $("#orders-body").innerHTML = state.orders.map(orderRow).join("");
}
function renderCustomers() {
  const customers = derivedCustomers();
  $("#customers-body").innerHTML = customers.map((customer) => `<tr><td><span class="customer-cell"><span class="customer-avatar ${esc(customer.color || "green")}">${esc(customer.initials || initials(customer.name))}</span><span><strong>${esc(customer.name)}</strong><small class="muted-cell">${esc(customer.phone || customer.email || "WhatsApp customer")}</small></span></span></td><td>${customer.orders}</td><td><strong>${money(customer.spent)}</strong></td><td>${esc(customer.location)}</td><td>${esc(customer.lastOrder)}</td><td><button class="row-action-button" type="button" data-view-customer="${esc(customer.name)}">View</button></td></tr>`).join("");
  const totalCustomers = $(".customer-stats .mini-stat:nth-child(1) strong"); if (totalCustomers) totalCustomers.textContent = customers.length.toLocaleString();
  const returning = $(".customer-stats .mini-stat:nth-child(2) strong"); if (returning) returning.textContent = `${Math.round((customers.filter((customer) => Number(customer.orders || 0) > 1).length / Math.max(customers.length, 1)) * 100)}%`;
  const average = $(".customer-stats .mini-stat:nth-child(3) strong"); if (average) average.textContent = money(customers.reduce((sum, customer) => sum + Number(customer.spent || 0), 0) / Math.max(customers.reduce((sum, customer) => sum + Number(customer.orders || 0), 0), 1));
}
function renderPayments() {
  if (!state?.store) return;
  const enabled = state.store.manualPaymentEnabled !== false;
  const whatsapp = state.store.whatsapp || ADMIN_WHATSAPP;
  const title = state.store.manualPaymentTitle || "Manual payment via WhatsApp";
  const instructions = state.store.manualPaymentInstructions || "Send your order on WhatsApp. We will confirm availability, delivery fees, and payment details before you pay.";
  if ($("#payment-manual-enabled")) $("#payment-manual-enabled").value = String(enabled);
  if ($("#payment-whatsapp")) $("#payment-whatsapp").value = whatsapp;
  if ($("#payment-title")) $("#payment-title").value = title;
  if ($("#payment-instructions")) $("#payment-instructions").value = instructions;
  updatePaymentPreview({ enabled, whatsapp, title, instructions });
}

function updatePaymentPreview(values = {}) {
  const store = state?.store || {};
  const enabled = values.enabled ?? ($("#payment-manual-enabled")?.value !== "false");
  const whatsapp = values.whatsapp ?? $("#payment-whatsapp")?.value ?? store.whatsapp ?? ADMIN_WHATSAPP;
  const title = values.title ?? $("#payment-title")?.value ?? store.manualPaymentTitle ?? "Manual payment via WhatsApp";
  const instructions = values.instructions ?? $("#payment-instructions")?.value ?? store.manualPaymentInstructions ?? "Send your order on WhatsApp. We will confirm availability, delivery fees, and payment details before you pay.";
  const statusChip = $("#payment-status-chip");
  if (statusChip) { statusChip.textContent = enabled ? "Enabled" : "Disabled"; statusChip.className = `status-chip ${enabled ? "green-chip" : "neutral-chip"}`; }
  if ($("#payment-preview-title")) $("#payment-preview-title").textContent = title || "Manual payment via WhatsApp";
  if ($("#payment-preview-copy")) $("#payment-preview-copy").textContent = enabled ? instructions : "Manual WhatsApp payment is currently disabled for customers.";
  const previewLink = $("#payment-preview-link");
  if (previewLink) previewLink.href = buildWhatsAppUrl(whatsapp, samplePaymentMessage({ ...store, name: store.name || "Store" }));
  if ($("#settings-payment-summary")) { $("#settings-payment-summary").textContent = enabled ? "Manual" : "Disabled"; $("#settings-payment-summary").className = `status-chip ${enabled ? "green-chip" : "neutral-chip"}`; }
  if ($("#settings-payment-title")) $("#settings-payment-title").textContent = title || "Manual payment via WhatsApp";
  if ($("#settings-payment-whatsapp")) $("#settings-payment-whatsapp").textContent = whatsapp;
  if ($("#settings-payment-toggle")) $("#settings-payment-toggle").checked = enabled;
}

function readPaymentSettings() {
  state.store.manualPaymentEnabled = $("#payment-manual-enabled")?.value !== "false";
  state.store.whatsapp = $("#payment-whatsapp")?.value.trim() || ADMIN_WHATSAPP;
  state.store.manualPaymentTitle = $("#payment-title")?.value.trim() || "Manual payment via WhatsApp";
  state.store.manualPaymentInstructions = $("#payment-instructions")?.value.trim() || "Send your order on WhatsApp. We will confirm availability, delivery fees, and payment details before you pay.";
}

function renderSettings() {
  const name = state.store.name || "Sage & Co.";
  $("#settings-store-name").value = name;
  $("#settings-store-slug").value = state.store.slug || "sage-co";
  $("#settings-store-description").value = state.store.description || "";
  if ($("#settings-currency")) $("#settings-currency").value = state.store.currency || "Zambian Kwacha (K)";
  if ($("#settings-delivery-mode")) $("#settings-delivery-mode").value = state.store.deliveryMode || "Local delivery + pickup";
  if ($("#settings-delivery-fee")) $("#settings-delivery-fee").value = Number(state.store.deliveryFee || 0);
  if ($("#settings-free-delivery")) $("#settings-free-delivery").value = Number(state.store.freeDeliveryThreshold || 0);
  if ($("#settings-delivery-instructions")) $("#settings-delivery-instructions").value = state.store.deliveryInstructions || "";
  if ($("#settings-custom-domain")) $("#settings-custom-domain").value = state.store.customDomain || "";
  const publishStatus = $("#publish-status-chip"); if (publishStatus) { publishStatus.textContent = state.published ? "Published" : "Draft"; publishStatus.className = `status-chip ${state.published ? "green-chip" : "neutral-chip"}`; }
  if ($("#public-store-url")) $("#public-store-url").textContent = publicStoreUrl();
  if ($("#publish-helper")) $("#publish-helper").textContent = state.published ? `Last published ${state.publishedAt ? new Date(state.publishedAt).toLocaleString() : "recently"}` : "Publish to make this storefront public.";
  if ($("#publish-store")) $("#publish-store").textContent = state.published ? "Publish updates" : "Publish";
  updatePaymentPreview({ enabled: state.store.manualPaymentEnabled !== false, whatsapp: state.store.whatsapp || ADMIN_WHATSAPP, title: state.store.manualPaymentTitle, instructions: state.store.manualPaymentInstructions });
}

function openModal(title, content, overline = "Edit") { $("#modal-overline").textContent = overline; $("#modal-title").textContent = title; $("#modal-content").innerHTML = content; $("#modal-backdrop").hidden = false; document.body.classList.add("modal-open"); }
function closeModal() { $("#modal-backdrop").hidden = true; document.body.classList.remove("modal-open"); }
function formActions(cancelLabel = "Cancel", saveLabel = "Save") { return `<div class="modal-form-actions"><button type="button" class="secondary-button" id="modal-cancel">${cancelLabel}</button><button type="submit" class="primary-button">${saveLabel}</button></div>`; }

function orderById(id) { return state.orders.find((order) => String(order.id) === String(id)); }
function orderItemsMarkup(order) { const items = orderItems(order); return items.length ? items.map((item) => `<div class="order-item-line"><span>${item.image ? `<img src="${esc(item.image)}" alt="" />` : ""}</span><div><strong>${esc(item.title || item.name || "Item")}</strong><small>${Number(item.quantity || 1)} × ${money(item.price || 0)}</small></div><b>${money(Number(item.price || 0) * Number(item.quantity || 1))}</b></div>`).join("") : `<p class="modal-hint">No item details were captured for this older order.</p>`; }
function receiptHtml(order) { return `<!doctype html><html><head><title>Receipt ${esc(order.id)}</title><style>body{font-family:Inter,Arial,sans-serif;color:#20283a;margin:0;padding:32px;background:#f7f7fb}.receipt{max-width:760px;margin:auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 20px 50px rgba(20,25,45,.08)}h1{margin:0 0 6px;font-size:28px}.muted{color:#7b8496}.row{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #eceff5;padding:12px 0}.total{font-size:22px;font-weight:800}.badge{display:inline-block;padding:6px 9px;border-radius:8px;background:#eff8f3;color:#20855e;font-weight:800;font-size:12px}@media print{body{background:#fff}.receipt{box-shadow:none}}</style></head><body><main class="receipt"><h1>${esc(state.store.name)} receipt</h1><p class="muted">Order ${esc(order.id)} • ${esc(order.date || "")}</p><p><span class="badge">${esc(order.payment || "Manual pending")}</span> <span class="badge">${esc(order.fulfillment || "New")}</span></p><h3>Customer</h3><p>${esc(order.customer || "Customer")}<br>${esc(orderCustomerPhone(order) || "") }<br>${esc(orderCustomerLocation(order) || "")}</p><h3>Items</h3>${orderItems(order).map((item) => `<div class="row"><span>${esc(item.quantity || 1)} × ${esc(item.title || item.name || "Item")}</span><strong>${money(Number(item.price || 0) * Number(item.quantity || 1))}</strong></div>`).join("") || `<div class="row"><span>${orderItemsCount(order)} item(s)</span><strong>${money(order.total || 0)}</strong></div>`}<div class="row"><span>Subtotal</span><strong>${money(order.subtotal ?? order.total ?? 0)}</strong></div><div class="row"><span>Delivery</span><strong>${money(order.deliveryFee || 0)}</strong></div><div class="row total"><span>Total</span><strong>${money(orderTotal(order))}</strong></div><p class="muted">Manual payment confirmed by ${esc(state.store.name)}. Built with Xacheus.</p></main><script>print()</script></body></html>`; }
function printReceipt(order) { const win = window.open("", "_blank"); if (!win) return showToast("Allow popups to print receipt"); win.document.write(receiptHtml(order)); win.document.close(); }
async function syncOrderStatus(order) { if (order.source === "storefront" && order.firestoreId && currentUser && !demoMode) { try { await updateDoc(doc(db, "publicStores", state.store.slug, "orders", order.firestoreId), { paymentStatus: order.payment, fulfillment: order.fulfillment, updatedAt: serverTimestamp() }); } catch (error) { console.info("Order status saved locally; Firestore update unavailable", error.code || error.message); } } await saveStore("Order updated"); }
function openOrderDetails(id) { const order = orderById(id); if (!order) return showToast("Order not found"); openModal(`Order ${esc(order.id)}`, `<div class="order-detail-grid"><section><p class="overline">Customer</p><h3>${esc(order.customer || "Customer")}</h3><p class="modal-hint">${esc(orderCustomerPhone(order) || "No phone captured")}<br>${esc(orderCustomerLocation(order) || "No delivery location captured")}</p><p>${esc(order.notes || "No notes")}</p></section><section><p class="overline">Payment & fulfillment</p><label>Payment status<select id="order-payment-status"><option>Manual pending</option><option>Payment requested</option><option>Paid</option><option>Failed</option><option>Refunded</option></select></label><label>Fulfillment status<select id="order-fulfillment-status"><option>New</option><option>Packed</option><option>Out for delivery</option><option>Delivered</option><option>Cancelled</option><option>Fulfilled</option></select></label></section></div><div class="order-items-panel"><p class="overline">Items</p>${orderItemsMarkup(order)}<div class="order-total-line"><span>Total</span><strong>${money(orderTotal(order))}</strong></div></div><div class="modal-form-actions wide-actions"><button type="button" class="secondary-button" id="modal-cancel">Close</button><button type="button" class="secondary-button" id="whatsapp-order-customer">WhatsApp customer</button><button type="button" class="secondary-button" id="print-order-receipt">Print receipt</button><button type="button" class="primary-button" id="save-order-status">Save status</button></div>`, "Order management"); $("#modal-cancel").addEventListener("click", closeModal); $("#order-payment-status").value = order.payment || "Manual pending"; $("#order-fulfillment-status").value = order.fulfillment || "New"; $("#whatsapp-order-customer").addEventListener("click", () => window.open(buildWhatsAppUrl(orderCustomerPhone(order) || state.store.whatsapp, orderMessage(order)), "_blank", "noreferrer")); $("#print-order-receipt").addEventListener("click", () => printReceipt(order)); $("#save-order-status").addEventListener("click", async () => { order.payment = $("#order-payment-status").value; order.fulfillment = $("#order-fulfillment-status").value; closeModal(); renderAll(); await syncOrderStatus(order); }); }
function openCustomerDetails(name) { const customer = derivedCustomers().find((item) => item.name === name); if (!customer) return showToast("Customer not found"); const orders = state.orders.filter((order) => (order.customer || order.customerName) === customer.name); openModal(customer.name, `<div class="customer-profile"><div class="customer-avatar green">${esc(customer.initials || initials(customer.name))}</div><div><p class="overline">Customer profile</p><h3>${esc(customer.name)}</h3><p>${esc(customer.phone || customer.email || "WhatsApp customer")}<br>${esc(customer.location || "No location")}</p></div></div><div class="customer-stat-grid"><div><span>Orders</span><strong>${customer.orders}</strong></div><div><span>Total spent</span><strong>${money(customer.spent)}</strong></div><div><span>Last order</span><strong>${esc(customer.lastOrder)}</strong></div></div><div class="order-items-panel"><p class="overline">Order history</p>${orders.map((order) => `<button class="customer-order-link" data-view-order="${esc(order.id)}"><span>${esc(order.id)}</span><strong>${money(orderTotal(order))}</strong><small>${esc(order.fulfillment)}</small></button>`).join("") || `<p class="modal-hint">No orders yet.</p>`}</div><div class="modal-form-actions"><button type="button" class="secondary-button" id="modal-cancel">Close</button><button type="button" class="primary-button" id="whatsapp-customer-profile">WhatsApp customer</button></div>`, "CRM"); $("#modal-cancel").addEventListener("click", closeModal); $("#whatsapp-customer-profile").addEventListener("click", () => window.open(buildWhatsAppUrl(customer.phone || state.store.whatsapp, `Hello ${customer.name}, thank you for shopping with ${state.store.name}.`), "_blank", "noreferrer")); $$(".customer-order-link").forEach((button) => button.addEventListener("click", () => { const orderId = button.dataset.viewOrder; closeModal(); openOrderDetails(orderId); })); }

function openSectionEditor(id) {
  const section = state.sections.find((item) => item.id === id); if (!section) return;
  const d = section.data || {};
  if (section.type === "banner") {
    openModal("Banner settings", `<form class="modal-form" id="section-form"><label>Eyebrow <input name="eyebrow" value="${esc(d.eyebrow)}" placeholder="NEW SEASON / 2026" /></label><label>Heading <input name="heading" value="${esc(d.heading)}" placeholder="Summer collection" required /></label><label>Description <textarea name="description" placeholder="Tell customers what makes this collection special.">${esc(d.description)}</textarea></label><div class="form-row"><label>Button text <input name="buttonText" value="${esc(d.buttonText)}" placeholder="Shop now" /></label><label>Button link <input name="buttonLink" value="${esc(d.buttonLink)}" placeholder="/collections/summer" /></label></div><label>Layout<select name="layout"><option ${d.layout === "Full width" ? "selected" : ""}>Full width</option><option ${d.layout === "Split" ? "selected" : ""}>Split</option><option ${d.layout === "Centered" ? "selected" : ""}>Centered</option></select></label><label class="file-field">Image <span>Upload to Cloudinary (${esc(CLOUDINARY_STORE_UPLOAD.assetFolder)}) or paste a URL</span><input type="file" id="section-image-file" accept="image/*" /><input name="image" value="${esc(d.image)}" placeholder="https://res.cloudinary.com/..." /></label><img class="image-preview" src="${esc(d.image || "")}" alt="Current banner" ${d.image ? "" : "hidden"} />${formActions("Cancel", "Save section")}</form>`, "Banner settings");
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
    event.preventDefault();
    const form = event.currentTarget;
    const hasImageUpload = section.type === "banner" && Boolean($("#section-image-file")?.files?.[0]);
    await submitWithBusyState(form, hasImageUpload ? "Uploading image…" : "Saving…", async () => {
      const values = Object.fromEntries(new FormData(form).entries());
      if (section.type === "banner") { const file = $("#section-image-file")?.files?.[0]; if (file) values.image = await uploadStoreImage(file); }
      section.data = { ...section.data, ...values }; if (section.type === "announcement") state.store.announcement = values.text;
      closeModal(); renderAll(); await saveStore("Section saved");
    });
  });
  $("#section-image-file")?.addEventListener("change", (event) => { const file = event.target.files?.[0]; if (!file) return; try { previewImageFile(file); } catch (error) { showToast(error.message); event.target.value = ""; } });
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
  const product = id ? state.products.find((item) => item.id === id) : { title: "", description: "", price: "", compareAt: "", inventory: 0, sku: "", category: "New arrivals", image: "", images: [], variants: "", variantStock: {} };
  const productImages = uniqueImages([...(product.images || []), product.image]);
  openModal(id ? "Edit product" : "Add product", `<form class="modal-form" id="product-form"><label>Product name <input name="title" value="${esc(product.title)}" placeholder="Product name" required /></label><div class="form-row"><label>Price <input name="price" type="number" min="0" step="1" value="${esc(product.price)}" placeholder="0" required /></label><label>Compare-at price <input name="compareAt" type="number" min="0" value="${esc(product.compareAt || "")}" placeholder="Optional" /></label></div><div class="form-row"><label>Inventory <input name="inventory" type="number" min="0" value="${esc(product.inventory)}" required /></label><label>SKU <input name="sku" value="${esc(product.sku)}" placeholder="SKU-001" /></label></div><label>Category <input name="category" value="${esc(product.category)}" placeholder="New arrivals" /></label><label>Variants <input name="variants" value="${esc(product.variants)}" placeholder="S, M, L, XL" /></label><label>Stock per variant <textarea name="variantStock" placeholder="S: 5
M: 8
L: 4">${esc(formatVariantStock(product.variantStock))}</textarea></label><label>Description <textarea name="description" placeholder="Describe this product.">${esc(product.description)}</textarea></label><button type="button" class="secondary-button ai-draft-button" id="generate-product-description">✦ Write description with AI</button><label class="file-field">Product images <span>Upload one or more images to Cloudinary (${esc(CLOUDINARY_STORE_UPLOAD.assetFolder)}) or paste image URLs, one per line. The first image is the main product image.</span><input type="file" id="product-image-file" accept="image/*" multiple /><textarea name="images" placeholder="https://res.cloudinary.com/...">${esc(productImages.join("\n"))}</textarea></label><img class="image-preview" src="${esc(productImages[0] || "")}" alt="Current product" ${productImages.length ? "" : "hidden"} /><div class="modal-form-actions">${id ? `<button type="button" class="danger-button" id="delete-product-modal">Delete product</button>` : ""}<span></span><button type="button" class="secondary-button" id="modal-cancel">Cancel</button><button type="submit" class="primary-button">${id ? "Save product" : "Add product"}</button></div></form>`, "Catalog");
  $("#modal-cancel").addEventListener("click", closeModal);
  $("#delete-product-modal")?.addEventListener("click", async () => { state.products = state.products.filter((item) => item.id !== id); closeModal(); renderAll(); await saveStore("Product deleted"); });
  $("#product-image-file")?.addEventListener("change", (event) => { const files = [...(event.target.files || [])]; if (!files.length) return; try { files.forEach(validateStoreImage); previewImageFile(files[0]); } catch (error) { showToast(error.message); event.target.value = ""; } });
  $("#generate-product-description")?.addEventListener("click", () => { const form = $("#product-form"); const values = Object.fromEntries(new FormData(form).entries()); form.elements.description.value = aiProductDescription(values); showToast("Product description drafted"); });
  $("#product-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const files = [...($("#product-image-file")?.files || [])];
    await submitWithBusyState(form, files.length ? "Uploading images…" : "Saving…", async () => {
      const values = Object.fromEntries(new FormData(form).entries()); const uploadedImages = files.length ? await Promise.all(files.map(uploadStoreImage)) : []; values.images = uniqueImages([...uploadedImages, ...splitImageUrls(values.images)]); values.image = values.images[0] || ""; values.variantStock = parseVariantStock(values.variantStock); values.price = Number(values.price || 0); values.compareAt = Number(values.compareAt || 0); values.inventory = Number(values.inventory || 0); values.status = "Active"; if (id) Object.assign(product, values); else state.products.unshift({ ...product, ...values, id: uid("product") }); closeModal(); renderAll(); await saveStore(id ? "Product updated" : "Product added");
    });
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

function validateStoreImage(file) {
  if (!file) return;
  if (!file.type?.startsWith("image/")) throw new Error("Please choose a JPG, PNG, WebP, or another image file.");
  if (file.size > CLOUDINARY_MAX_IMAGE_SIZE) throw new Error("Please choose an image smaller than 10MB.");
}

async function uploadStoreImage(file) {
  validateStoreImage(file);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_STORE_UPLOAD.uploadPreset);
  const response = await fetch(CLOUDINARY_UPLOAD_URL, { method: "POST", body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || "Cloudinary image upload failed.");
  const imageUrl = payload.secure_url || payload.url;
  if (!imageUrl) throw new Error("Cloudinary did not return an image URL.");
  return imageUrl;
}

function previewImageFile(file) {
  validateStoreImage(file);
  const preview = $(".image-preview");
  if (!preview) return;
  const previewUrl = URL.createObjectURL(file);
  preview.onload = () => URL.revokeObjectURL(previewUrl);
  preview.src = previewUrl;
  preview.hidden = false;
}

async function submitWithBusyState(form, busyLabel, action) {
  const submitButton = form.querySelector('button[type="submit"]');
  const buttons = [...form.querySelectorAll("button")];
  const originalLabel = submitButton?.textContent;
  buttons.forEach((button) => { button.disabled = true; });
  if (submitButton) submitButton.textContent = busyLabel;
  try { return await action(); }
  catch (error) { showToast(error.message || "Image upload failed. Please try again."); return null; }
  finally { buttons.forEach((button) => { button.disabled = false; }); if (submitButton && originalLabel) submitButton.textContent = originalLabel; }
}

function exportData(filename, data) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }

function navigate(view) {
  if (!view) return;
  $$(".store-nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === view));
  $$(".store-view").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === view));
  $("#breadcrumb-parent").textContent = ["products", "collections", "inventory"].includes(view) ? "Catalog" : ["payments", "orders", "customers", "marketing"].includes(view) ? "Sell" : view === "overview" ? "" : "Online store";
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
$("#publish-store").addEventListener("click", async () => { const button = $("#publish-store"); button.disabled = true; button.textContent = "Publishing…"; state.published = true; state.publishedAt = new Date().toISOString(); await saveStore("Your store is live"); localStorage.setItem(`xacheus-published-${state.store.slug}`, JSON.stringify(state)); if (currentUser && !demoMode) { try { await setDoc(doc(db, "publicStores", state.store.slug), { ...state, publishedBy: currentUser.uid, published: true, publishedAt: serverTimestamp() }); } catch (error) { console.info("Local publish complete; public Firebase copy unavailable", error.code || error.message); } } startOrderListener(); button.disabled = false; button.textContent = "Published ✓"; setTimeout(() => { button.textContent = "Publish"; }, 2400); });
$("#add-product-button").addEventListener("click", () => openProductEditor()); $("#add-collection-button").addEventListener("click", () => openCollectionEditor()); $("#add-menu-item").addEventListener("click", () => { state.menu.push({ id: uid("menu"), title: "New link", url: "/" }); renderNavigation(); }); $("#save-navigation").addEventListener("click", () => saveStore("Menu saved"));
$("#save-settings").addEventListener("click", async () => { state.store.name = $("#settings-store-name").value.trim() || "Your store"; state.store.slug = $("#settings-store-slug").value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"); state.store.description = $("#settings-store-description").value.trim(); state.store.currency = $("#settings-currency")?.value || state.store.currency; state.store.deliveryMode = $("#settings-delivery-mode")?.value || state.store.deliveryMode; state.store.deliveryFee = Number($("#settings-delivery-fee")?.value || 0); state.store.freeDeliveryThreshold = Number($("#settings-free-delivery")?.value || 0); state.store.deliveryInstructions = $("#settings-delivery-instructions")?.value.trim() || ""; state.store.customDomain = $("#settings-custom-domain")?.value.trim() || ""; renderAll(); await saveStore("Store settings saved"); });
$("#copy-store-link")?.addEventListener("click", async () => { await navigator.clipboard?.writeText(publicStoreUrl()); showToast("Store link copied"); });
$("#unpublish-store")?.addEventListener("click", async () => { state.published = false; state.unpublishedAt = new Date().toISOString(); if (currentUser && !demoMode) { try { await setDoc(doc(db, "publicStores", state.store.slug), { published: false, unpublishedAt: serverTimestamp() }, { merge: true }); } catch (error) { console.info("Local unpublish complete; Firebase unavailable", error.code || error.message); } } renderAll(); await saveStore("Store unpublished"); });
$("#save-payments")?.addEventListener("click", async () => { readPaymentSettings(); renderAll(); await saveStore("Manual payment setup saved"); });
$("#test-whatsapp-payment")?.addEventListener("click", () => { const phone = $("#payment-whatsapp")?.value || state.store.whatsapp || ADMIN_WHATSAPP; window.open(buildWhatsAppUrl(phone, samplePaymentMessage(state.store)), "_blank", "noreferrer"); });
["payment-manual-enabled", "payment-whatsapp", "payment-title", "payment-instructions"].forEach((id) => { const field = $("#" + id); field?.addEventListener("input", () => updatePaymentPreview()); field?.addEventListener("change", () => updatePaymentPreview()); });
$("#product-search").addEventListener("input", renderProducts); $("#connect-domain").addEventListener("click", () => showToast("Domain connection setup is ready for your custom domain")); $("#create-campaign")?.addEventListener("click", () => showToast("AI campaign workspace is coming next — your store data is ready")); $("#export-orders")?.addEventListener("click", () => exportData("xacheus-orders.json", state.orders)); $("#export-customers")?.addEventListener("click", () => exportData("xacheus-customers.json", state.customers)); $("#add-page-button")?.addEventListener("click", () => showToast("Page editor added to your workspace"));
$("#modal-content").addEventListener("click", (event) => { const addType = event.target.closest("[data-add-type]"); if (addType) addSection(addType.dataset.addType); });
$("#section-stack").addEventListener("click", async (event) => { const item = event.target.closest(".section-item"); if (!item) return; const id = item.dataset.sectionId; const move = event.target.closest("[data-move-section]"); const edit = event.target.closest("[data-edit-section]"); const remove = event.target.closest("[data-remove-section]"); if (remove) { if (state.sections.length <= 1) return showToast("Keep at least one section on your page"); state.sections = state.sections.filter((section) => section.id !== id); renderAll(); await saveStore("Section removed"); return; } if (move) { const index = state.sections.findIndex((section) => section.id === id); const next = move.dataset.moveSection === "up" ? index - 1 : index + 1; if (next >= 0 && next < state.sections.length) [state.sections[index], state.sections[next]] = [state.sections[next], state.sections[index]]; renderAll(); await saveStore("Sections reordered"); return; } if (edit) { openSectionEditor(id); return; } openSectionEditor(id); });
$("#menu-editor").addEventListener("input", (event) => { const row = event.target.closest(".menu-row"); const item = state.menu.find((menu) => menu.id === row?.dataset.menuId); if (item && event.target.dataset.menuField) item[event.target.dataset.menuField] = event.target.value; }); $("#menu-editor").addEventListener("click", async (event) => { const button = event.target.closest("[data-delete-menu]"); if (!button) return; state.menu = state.menu.filter((item) => item.id !== button.dataset.deleteMenu); renderNavigation(); await saveStore("Menu item removed"); });
$("#orders-body").addEventListener("click", (event) => { const button = event.target.closest("[data-view-order]"); if (button) openOrderDetails(button.dataset.viewOrder); });
$("#recent-orders-body").addEventListener("click", (event) => { const button = event.target.closest("[data-view-order]"); if (button) openOrderDetails(button.dataset.viewOrder); });
$("#customers-body").addEventListener("click", (event) => { const button = event.target.closest("[data-view-customer]"); if (button) openCustomerDetails(button.dataset.viewCustomer); });
$("#products-body").addEventListener("click", (event) => { const button = event.target.closest("[data-edit-product]"); if (button) openProductEditor(button.dataset.editProduct); }); $("#inventory-body").addEventListener("click", (event) => { const button = event.target.closest("[data-edit-product]"); if (button) openProductEditor(button.dataset.editProduct); }); $("#collection-grid").addEventListener("click", (event) => { const button = event.target.closest("[data-edit-collection]"); if (button) openCollectionEditor(button.dataset.editCollection); });
$$('[data-device]').forEach((button) => button.addEventListener("click", () => { $$('[data-device]').forEach((item) => item.classList.toggle("active", item === button)); $("#store-preview-frame").classList.toggle("mobile", button.dataset.device === "mobile"); }));
$("#logout-button").addEventListener("click", async () => { if (demoMode) { window.location.href = "auth.html"; return; } await signOut(auth); window.location.href = "index.html"; });

onAuthStateChanged(auth, async (user) => { currentUser = user; if (!user && !demoMode) { window.location.href = "auth.html?next=dashboard.html"; return; } await loadStore(user); startOrderListener(); const hash = window.location.hash.slice(1); if (hash && $(`[data-view-panel="${hash}"]`)) navigate(hash); });

// Allow the app to render in a browser even if Firebase authentication is still resolving.
if (demoMode) { currentUser = null; loadStore(null); }
