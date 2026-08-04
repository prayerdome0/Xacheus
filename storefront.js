import { addDoc, collection, doc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { ADMIN_WHATSAPP, db } from "./firebase.js";

const params = new URLSearchParams(window.location.search);
const slug = params.get("store") || "sage-co";
let storeState;
let productFilters = { search: "", category: "all", sort: "featured" };
let cart = JSON.parse(localStorage.getItem(`xacheus-cart-${slug}`) || "[]");
const $ = (selector) => document.querySelector(selector);
const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const money = (value) => `${storeState?.store?.currency?.startsWith("US") ? "$" : "K"} ${Number(value || 0).toLocaleString()}`;
const normalizeWhatsAppNumber = (value = ADMIN_WHATSAPP) => { const digits = String(value || "").replace(/\D/g, ""); if (!digits) return "260973028342"; return digits.startsWith("0") ? `260${digits.slice(1)}` : digits; };
const whatsappUrl = (message) => `https://wa.me/${normalizeWhatsAppNumber(storeState?.store?.whatsapp || ADMIN_WHATSAPP)}?text=${encodeURIComponent(message)}`;
const manualPaymentsEnabled = () => storeState?.store?.manualPaymentEnabled !== false;
const productImage = (product = {}) => product.images?.find(Boolean) || product.image || "";
const subtotal = () => cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
const deliveryFee = () => { const store = storeState?.store || {}; const fee = Number(store.deliveryFee || 0); const threshold = Number(store.freeDeliveryThreshold || 0); if (!cart.length) return 0; return threshold && subtotal() >= threshold ? 0 : fee; };
const cartTotal = () => subtotal() + deliveryFee();
const productVariants = (product = {}) => String(product.variants || "").split(",").map((item) => item.trim()).filter(Boolean);
function setMeta(selector, attr, content) { let tag = document.head.querySelector(selector); if (!tag) { tag = document.createElement("meta"); if (attr === "property") tag.setAttribute("property", selector.match(/\[property=\"(.+?)\"\]/)?.[1] || ""); else tag.setAttribute("name", selector.match(/\[name=\"(.+?)\"\]/)?.[1] || ""); document.head.appendChild(tag); } tag.setAttribute("content", content); }

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
  const description = store.description || "Shop this Xacheus-powered online store.";
  setMeta('meta[name="description"]', "name", description);
  setMeta('meta[property="og:title"]', "property", `${store.name || "Store"} — Online store`);
  setMeta('meta[property="og:description"]', "property", description);
  const shareImage = productImage((storeState.products || [])[0]); if (shareImage) setMeta('meta[property="og:image"]', "property", shareImage);
  document.documentElement.style.setProperty("--live-primary", store.primary || "#6a5cff");
  document.documentElement.style.setProperty("--live-dark", store.dark || "#191b2d");
  $("#storefront-loading").remove(); $("#live-store").hidden = false;
  $("#live-logo").textContent = store.name || "Your store"; $("#footer-logo").textContent = store.name || "Your store"; $("#footer-name").textContent = store.name || "Your store"; $("#footer-description").textContent = store.description || "Thoughtfully made essentials for everyday living."; $("#footer-year").textContent = new Date().getFullYear();
  $("#live-menu").innerHTML = (storeState.menu || []).map((item) => `<a href="${esc(item.url || "#")}">${esc(item.title)}</a>`).join("");
  $("#storefront-main").innerHTML = (storeState.sections || []).filter((section) => section.enabled !== false).map(sectionMarkup).join("");
  $("#checkout-button").textContent = manualPaymentsEnabled() ? "Send order on WhatsApp ↗" : "Contact store on WhatsApp ↗";
  $("#checkout-note").textContent = manualPaymentsEnabled() ? `${store.manualPaymentInstructions || "Manual payment: the store owner will confirm your order and send payment instructions on WhatsApp."} ${store.deliveryInstructions || ""}`.trim() : "Contact the store owner on WhatsApp for payment and delivery details.";
  const contactMessage = `Hello ${store.name || "Store"}, I have a question about your products.`;
  const footerContactLink = $("#footer-contact-link"); if (footerContactLink) footerContactLink.href = whatsappUrl(contactMessage);
  updateCart();
}

function productCategories() { return [...new Set((storeState.products || []).map((product) => product.category).filter(Boolean))].sort(); }
function filteredProducts() {
  let products = [...(storeState.products || [])];
  const search = productFilters.search.trim().toLowerCase();
  if (search) products = products.filter((product) => `${product.title} ${product.description} ${product.category}`.toLowerCase().includes(search));
  if (productFilters.category !== "all") products = products.filter((product) => product.category === productFilters.category);
  if (productFilters.sort === "price-low") products.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  if (productFilters.sort === "price-high") products.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
  if (productFilters.sort === "newest") products = products.reverse();
  return products;
}
function renderProductGrid() { const grid = $("#live-product-grid"); if (!grid) return; const products = filteredProducts(); grid.innerHTML = products.length ? products.slice(0, 24).map(productMarkup).join("") : `<div class="live-empty-products">No products match your filters.</div>`; }

function sectionMarkup(section) {
  const data = section.data || {}; const store = storeState.store || {};
  if (section.type === "announcement") return `<div class="live-announcement">${esc(data.text || store.announcement || "Welcome to our store")}</div>`;
  if (section.type === "banner") { const layoutClass = String(data.layout || "Full width").toLowerCase().replace(/\s+/g, "-"); return `<section class="live-hero layout-${layoutClass} ${data.image ? "image" : ""}" ${data.image ? `style="background-image:url('${esc(data.image)}')"` : ""}><div class="live-hero-inner"><div class="live-hero-copy"><p class="store-kicker">${esc(data.eyebrow || "WELCOME TO OUR STORE")}</p><h1>${esc(data.heading || "Your story starts here.")}</h1><p>${esc(data.description || "Thoughtfully made essentials for your everyday.")}</p><a class="live-cta" href="${esc(data.buttonLink || "#products")}">${esc(data.buttonText || "Shop now")} ↗</a></div></div><div class="live-hero-shape"></div></section>`; }
  if (section.type === "products") return `<section class="live-products" id="products"><div class="live-container"><div class="live-section-heading"><div><p class="store-kicker">THE COLLECTION</p><h2>${esc(data.heading || "Shop our favorites")}</h2><p>${esc(data.description || "A few things you’ll love.")}</p></div><a class="view-all" href="#products">View all products →</a></div><div class="store-filters"><label>Search <input id="product-filter" type="search" placeholder="Search products" value="${esc(productFilters.search)}" /></label><label>Category <select id="category-filter"><option value="all">All categories</option>${productCategories().map((category) => `<option value="${esc(category)}" ${productFilters.category === category ? "selected" : ""}>${esc(category)}</option>`).join("")}</select></label><label>Sort <select id="sort-filter"><option value="featured">Featured</option><option value="newest" ${productFilters.sort === "newest" ? "selected" : ""}>Newest</option><option value="price-low" ${productFilters.sort === "price-low" ? "selected" : ""}>Price: low to high</option><option value="price-high" ${productFilters.sort === "price-high" ? "selected" : ""}>Price: high to low</option></select></label></div><div class="live-product-grid" id="live-product-grid">${filteredProducts().slice(0, 24).map(productMarkup).join("")}</div></div></section>`;
  if (section.type === "story") return `<section class="live-story"><div class="live-story-art"></div><div><p class="store-kicker">OUR STORY</p><h2>${esc(data.heading || "Made for your everyday.")}</h2><p>${esc(data.text || "Beautiful things, made to last.")}</p><a class="live-cta" href="${esc(data.buttonLink || "#")}">${esc(data.buttonText || "Learn more")} →</a></div></section>`;
  if (section.type === "newsletter") return `<section class="live-newsletter"><p class="store-kicker">KEEP IN TOUCH</p><h2>${esc(data.heading || "Stay in the loop")}</h2><p>${esc(data.text || "New arrivals and thoughtful notes, occasionally.")}</p><form class="live-newsletter-form" id="newsletter-form"><input type="email" placeholder="Your email address" required /><button type="submit">Join →</button></form></section>`;
  if (section.type === "testimonials") return `<section class="live-newsletter"><p class="store-kicker">FROM OUR CUSTOMERS</p><h2>“Beautiful, useful, and made with care.”</h2><p>★★★★★ &nbsp; Our community loves the little details.</p></section>`;
  return "";
}

function productMarkup(product) {
  const image = productImage(product);
  const galleryCount = product.images?.length || (image ? 1 : 0);
  return `<article class="live-product"><div class="live-product-image" ${image ? `style="background-image:url('${esc(image)}')"` : ""}>${galleryCount > 1 ? `<span class="gallery-count">${galleryCount} photos</span>` : ""}<button class="quick-add" data-add-product="${esc(product.id)}" type="button">Add to bag +</button></div><div class="live-product-body"><h3>${esc(product.title)}</h3><p>${money(product.price)}${product.compareAt ? `<del class="compare">${money(product.compareAt)}</del>` : ""}</p><small>${esc(product.description || "Made with care.")}</small>${product.variants ? `<em>${esc(product.variants)}</em>` : ""}<button class="product-detail-link" data-view-product="${esc(product.id)}" type="button">View details →</button></div></article>`;
}

function openProductDetail(id) {
  const product = (storeState.products || []).find((item) => item.id === id);
  if (!product) return;
  const images = [...new Set([...(product.images || []), product.image].filter(Boolean))];
  const variants = productVariants(product);
  const related = (storeState.products || []).filter((item) => item.id !== id && item.category === product.category).slice(0, 3);
  let modal = $("#product-detail-modal");
  if (!modal) { modal = document.createElement("div"); modal.id = "product-detail-modal"; modal.className = "product-modal"; document.body.appendChild(modal); }
  modal.innerHTML = `<div class="product-modal-card"><button class="product-modal-close" type="button" aria-label="Close">×</button><div class="product-modal-gallery"><div class="product-modal-image" ${images[0] ? `style="background-image:url('${esc(images[0])}')"` : ""}></div><div class="product-thumbs">${images.map((image, index) => `<button type="button" data-gallery-image="${esc(image)}" class="${index === 0 ? "active" : ""}" style="background-image:url('${esc(image)}')"></button>`).join("")}</div></div><div class="product-modal-copy"><p class="store-kicker">${esc(product.category || "Product")}</p><h2>${esc(product.title)}</h2><p class="product-modal-price">${money(product.price)}${product.compareAt ? `<del>${money(product.compareAt)}</del>` : ""}</p><p>${esc(product.description || "Made with care.")}</p>${variants.length ? `<label>Choose option<select id="detail-variant">${variants.map((variant) => { const stock = product.variantStock?.[variant]; const soldOut = stock !== undefined && Number(stock) <= 0; return `<option ${soldOut ? "disabled" : ""} value="${esc(variant)}">${esc(variant)}${stock !== undefined ? ` — ${soldOut ? "sold out" : `${stock} left`}` : ""}</option>`; }).join("")}</select></label>` : ""}<label>Quantity<input id="detail-quantity" type="number" min="1" value="1" /></label><div class="product-modal-actions"><button class="checkout-button" id="detail-add-cart" type="button">Add to bag +</button><button class="share-product" id="share-product-whatsapp" type="button">Share on WhatsApp</button></div>${related.length ? `<div class="related-products"><strong>Related products</strong>${related.map((item) => `<button type="button" data-view-product="${esc(item.id)}">${esc(item.title)} <span>${money(item.price)}</span></button>`).join("")}</div>` : ""}</div></div>`;
  modal.classList.add("open");
  modal.querySelector(".product-modal-close").addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", (event) => { if (event.target === modal) modal.classList.remove("open"); });
  modal.querySelectorAll("[data-gallery-image]").forEach((button) => button.addEventListener("click", () => { modal.querySelector(".product-modal-image").style.backgroundImage = `url('${button.dataset.galleryImage}')`; modal.querySelectorAll("[data-gallery-image]").forEach((item) => item.classList.toggle("active", item === button)); }));
  modal.querySelector("#detail-add-cart").addEventListener("click", () => { const variant = modal.querySelector("#detail-variant")?.value || ""; const quantity = Number(modal.querySelector("#detail-quantity")?.value || 1); if (variant && product.variantStock?.[variant] !== undefined && quantity > Number(product.variantStock[variant])) { const toast = $("#store-toast"); toast.textContent = `Only ${product.variantStock[variant]} left for ${variant}`; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 1800); return; } const cartId = variant ? `${product.id}:${variant}` : product.id; const existing = cart.find((item) => item.id === cartId); if (existing) existing.quantity += quantity; else cart.push({ id: cartId, productId: product.id, title: variant ? `${product.title} - ${variant}` : product.title, price: Number(product.price || 0), image: productImage(product), variant, quantity }); updateCart(); modal.classList.remove("open"); openCart(); });
  modal.querySelector("#share-product-whatsapp").addEventListener("click", () => window.open(whatsappUrl(`Hello ${storeState.store.name}, I am interested in ${product.title} (${money(product.price)}).`), "_blank", "noreferrer"));
  modal.querySelectorAll(".related-products [data-view-product]").forEach((button) => button.addEventListener("click", () => openProductDetail(button.dataset.viewProduct)));
}

function updateCart() {
  $("#cart-count").textContent = cart.reduce((sum, item) => sum + item.quantity, 0);
  if ($("#cart-subtotal")) $("#cart-subtotal").textContent = money(subtotal());
  if ($("#cart-delivery")) $("#cart-delivery").textContent = money(deliveryFee());
  $("#cart-total").textContent = money(cartTotal());
  $("#cart-items").innerHTML = cart.length ? cart.map((item) => `<div class="cart-item"><div class="cart-item-image" ${item.image ? `style="background-image:url('${esc(item.image)}')"` : ""}></div><div><strong>${esc(item.title)}</strong><small>${item.quantity} × ${money(item.price)}</small></div><button type="button" data-remove-cart="${esc(item.id)}">×</button></div>`).join("") : `<div class="cart-empty">Your bag is waiting for something thoughtful.</div>`;
  localStorage.setItem(`xacheus-cart-${slug}`, JSON.stringify(cart));
}
function openCart() { $("#cart-drawer").classList.add("open"); $("#cart-overlay").classList.add("open"); }
function closeCart() { $("#cart-drawer").classList.remove("open"); $("#cart-overlay").classList.remove("open"); }
function addToCart(id) { const product = (storeState.products || []).find((item) => item.id === id); if (!product) return; if (productVariants(product).length > 1) { openProductDetail(id); return; } const existing = cart.find((item) => item.id === id); if (existing) existing.quantity += 1; else cart.push({ id, productId: id, title: product.title, price: Number(product.price || 0), image: productImage(product), variant: productVariants(product)[0] || "", quantity: 1 }); updateCart(); openCart(); const toast = $("#store-toast"); toast.textContent = "Added to your bag ✓"; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 1800); }
function checkoutDetails() {
  const form = $("#checkout-form");
  if (!form.reportValidity()) return null;
  const data = Object.fromEntries(new FormData(form).entries());
  return { name: data.name?.trim(), phone: data.phone?.trim(), location: data.location?.trim(), notes: data.notes?.trim() };
}
function checkoutMessage(details = {}) {
  const store = storeState.store || {};
  const items = cart.map((item) => `- ${item.quantity} × ${item.title} (${money(Number(item.price || 0) * Number(item.quantity || 1))})`).join("\n");
  const customer = `Customer: ${details.name || ""}\nPhone: ${details.phone || ""}\nDelivery location: ${details.location || ""}${details.notes ? `\nNotes: ${details.notes}` : ""}`;
  return manualPaymentsEnabled() ? `Hello ${store.name || "Store"}, I would like to place an order.\n\nItems:\n${items}\n\nSubtotal: ${money(subtotal())}\nDelivery: ${money(deliveryFee())}\nTotal: ${$("#cart-total").textContent}\n\n${customer}\n\nPayment: ${store.manualPaymentTitle || "Manual payment via WhatsApp"}\nPlease confirm availability, delivery fee, and send me payment instructions.` : `Hello ${store.name || "Store"}, I need help with this order.\n\nItems:\n${items}\n\nSubtotal: ${money(subtotal())}\nDelivery: ${money(deliveryFee())}\nTotal: ${$("#cart-total").textContent}\n\n${customer}`;
}
async function saveCheckoutOrder(details = {}) {
  const store = storeState.store || {};
  const order = { storeSlug: slug, storeName: store.name || "Store", customerName: details.name || "", customerPhone: details.phone || "", deliveryLocation: details.location || "", notes: details.notes || "", items: cart.map((item) => ({ id: item.id, title: item.title, price: Number(item.price || 0), quantity: Number(item.quantity || 1), variant: item.variant || "", image: item.image || "" })), subtotal: subtotal(), deliveryFee: deliveryFee(), total: cartTotal(), currency: store.currency || "Zambian Kwacha (K)", paymentStatus: "Manual pending", fulfillment: "New", source: "whatsapp_manual", orderNumber: `#WA-${Date.now().toString().slice(-6)}` };
  const localKey = `xacheus-orders-${slug}`;
  const localOrders = JSON.parse(localStorage.getItem(localKey) || "[]");
  localStorage.setItem(localKey, JSON.stringify([{ ...order, createdAt: new Date().toISOString() }, ...localOrders].slice(0, 25)));
  try { await addDoc(collection(db, "publicStores", slug, "orders"), { ...order, createdAt: serverTimestamp() }); }
  catch (error) { console.info("Order saved locally; Firestore order capture unavailable", error.code || error.message); }
}
async function startWhatsAppCheckout() {
  const toast = $("#store-toast");
  if (!cart.length) { toast.textContent = "Add an item before checkout"; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 1800); openCart(); return; }
  const details = checkoutDetails();
  if (!details) return;
  await saveCheckoutOrder(details);
  window.open(whatsappUrl(checkoutMessage(details)), "_blank", "noreferrer");
}


$("#cart-button").addEventListener("click", openCart); $("#cart-close").addEventListener("click", closeCart); $("#cart-overlay").addEventListener("click", closeCart); $("#live-menu-button").addEventListener("click", () => $("#live-menu").classList.toggle("open"));
$("#storefront-main").addEventListener("click", (event) => { const button = event.target.closest("[data-add-product]"); if (button) addToCart(button.dataset.addProduct); const detailButton = event.target.closest("[data-view-product]"); if (detailButton) openProductDetail(detailButton.dataset.viewProduct); });
$("#storefront-main").addEventListener("input", (event) => { if (event.target.id === "product-filter") { productFilters.search = event.target.value; renderProductGrid(); } });
$("#storefront-main").addEventListener("change", (event) => { if (event.target.id === "category-filter") { productFilters.category = event.target.value; renderProductGrid(); } if (event.target.id === "sort-filter") { productFilters.sort = event.target.value; renderProductGrid(); } });
$("#cart-items").addEventListener("click", (event) => { const button = event.target.closest("[data-remove-cart]"); if (!button) return; cart = cart.filter((item) => item.id !== button.dataset.removeCart); updateCart(); });
$("#checkout-button").addEventListener("click", startWhatsAppCheckout);
document.addEventListener("submit", (event) => { if (event.target.id === "newsletter-form") { event.preventDefault(); event.target.innerHTML = `<p>Thanks for joining our list ✦</p>`; } }); $("#subscribe-button").addEventListener("click", () => { $("#subscribe-button").textContent = "✓"; });
loadStore();
