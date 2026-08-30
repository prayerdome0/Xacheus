/** Xacheus Social — shared rendering helpers. */

import { ts } from "./data.js";

/* ------------------------------------------------------------------ */
/* escaping + formatting                                               */
/* ------------------------------------------------------------------ */

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Anything usable as an href. Only http(s), protocol-relative-free `#` routes
 * and `mailto:` survive — a profile's "website" field is user input, so it can
 * never become a `javascript:` link.
 */
export function safeUrl(value, { allowRoutes = true } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (allowRoutes && /^#[a-z0-9_./?=&%-]{1,200}$/i.test(raw)) return raw;
  if (/^(https?:)?\/\//i.test(raw)) {
    const withScheme = raw.startsWith("//") ? `https:${raw}` : raw;
    return /^https?:\/\/[a-z0-9@:._%+#!?\/&=~,;'-]+$/i.test(withScheme) ? withScheme.replace(/"/g, "%22") : "";
  }
  if (/^mailto:[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw)) return raw;
  return "";
}

/** Escape, then linkify #hashtags, @handles and safe https:// links. */
export function richText(value) {
  let out = esc(value ?? "");
  out = out.replace(/(https?:\/\/[^\s<]+)/g, (match) => {
    const safe = safeUrl(match);
    if (!safe) return esc(match);
    return `<a class="link" href="${safe}" target="_blank" rel="noopener noreferrer nofollow">${match.replace(/^https?:\/\//, "")}</a>`;
  });
  out = out.replace(/#([a-z0-9_]{2,30})/gi, (_, tag) => `<a class="link" href="#/tag/${tag.toLowerCase()}">#${tag}</a>`);
  out = out.replace(/@([a-z0-9_]{3,20})/gi, (_, name) => `<a class="link" href="#/u/${name}">@${name}</a>`);
  return out.replace(/\n/g, "<br />");
}

export function timeAgo(value) {
  const millis = ts(value);
  if (!millis) return "just now";
  const seconds = Math.floor((Date.now() - millis) / 1000);
  if (seconds < 45) return "now";
  if (seconds < 90) return "1m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  const date = new Date(millis);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function fullDate(value) {
  const millis = ts(value);
  if (!millis) return "";
  return new Date(millis).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatCount(value) {
  const n = Number(value) || 0;
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, "")}K`;
  if (n < 1000000) return `${Math.round(n / 1000)}K`;
  return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
}

/* ------------------------------------------------------------------ */
/* avatars                                                             */
/* ------------------------------------------------------------------ */

const AVATAR_GRADIENTS = [
  ["#7c5cff", "#ff4d8d"],
  ["#00c2ff", "#7c5cff"],
  ["#ff8a3d", "#ff4d8d"],
  ["#12d6a0", "#00c2ff"],
  ["#ffd166", "#ff8a3d"],
  ["#a78bfa", "#6366f1"],
  ["#f472b6", "#a855f7"],
  ["#34d399", "#0ea5e9"],
];

export function gradientFor(seed) {
  const key = String(seed || "x");
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

export function initials(name) {
  const parts = String(name || "?")
    .trim()
    .split(/[\s_.-]+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Avatar markup. `size` maps to a CSS class: sm | md | lg | xl. */
export function avatar(user, size = "md", extraClass = "") {
  const name = user?.displayName || user?.username || "Xacheus user";
  const photo = user?.photoURL || "";
  const [from, to] = gradientFor(user?.username || user?.uid || name);
  const style = `background-image:linear-gradient(135deg,${from},${to})`;
  const img = photo
    ? `<img src="${esc(photo)}" alt="${esc(name)}" loading="lazy" onerror="this.style.display='none'" />`
    : "";
  return `<span class="avatar avatar-${size} ${extraClass}" style="${style}" aria-hidden="${img ? "false" : "true"}">${img}${
    img ? "" : `<span class="avatar-initials">${esc(initials(name))}</span>`
  }</span>`;
}

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function fromHTML(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html).trim();
  return template.content.firstElementChild;
}

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
}

export function emptyState(icon, title, body, actionHtml = "") {
  return `
    <div class="empty-state">
      <div class="empty-icon" aria-hidden="true">${icon}</div>
      <h3>${esc(title)}</h3>
      ${body ? `<p>${esc(body)}</p>` : ""}
      ${actionHtml}
    </div>`;
}

export function skeletonPosts(count = 3) {
  return Array.from({ length: count })
    .map(
      () => `
      <article class="post skeleton" aria-hidden="true">
        <div class="sk sk-avatar"></div>
        <div class="post-body">
          <div class="sk sk-line" style="width:38%"></div>
          <div class="sk sk-line" style="width:88%"></div>
          <div class="sk sk-line" style="width:64%"></div>
          <div class="sk sk-block"></div>
        </div>
      </article>`
    )
    .join("");
}

/* ------------------------------------------------------------------ */
/* toasts                                                              */
/* ------------------------------------------------------------------ */

let toastHost;

export function toast(message, type = "info", timeout = 3600) {
  if (!toastHost) {
    toastHost = document.createElement("div");
    toastHost.className = "toast-host";
    toastHost.setAttribute("role", "status");
    toastHost.setAttribute("aria-live", "polite");
    document.body.appendChild(toastHost);
  }
  const node = fromHTML(
    `<div class="toast toast-${type}"><span class="toast-dot"></span><span>${esc(message)}</span></div>`
  );
  toastHost.appendChild(node);
  requestAnimationFrame(() => node.classList.add("is-in"));
  setTimeout(() => {
    node.classList.remove("is-in");
    setTimeout(() => node.remove(), 260);
  }, timeout);
}

/* ------------------------------------------------------------------ */
/* modals                                                              */
/* ------------------------------------------------------------------ */

let modalRoot;
let lastFocused = null;

export function openModal({ title = "", body = "", size = "", onMount, onClose } = {}) {
  closeModal(true);
  lastFocused = document.activeElement;

  modalRoot = fromHTML(`
    <div class="modal-backdrop" role="presentation">
      <div class="modal ${size ? `modal-${size}` : ""}" role="dialog" aria-modal="true" aria-label="${esc(title || "Dialog")}">
        <header class="modal-head">
          <h2>${esc(title)}</h2>
          <button class="icon-btn" type="button" data-close aria-label="Close">✕</button>
        </header>
        <div class="modal-body"></div>
      </div>
    </div>
  `);

  $(".modal-body", modalRoot).innerHTML = body;
  modalRoot.addEventListener("click", (event) => {
    if (event.target === modalRoot || event.target.closest("[data-close]")) closeModal();
  });
  document.addEventListener("keydown", onEscape);
  document.body.appendChild(modalRoot);
  document.body.classList.add("no-scroll");
  requestAnimationFrame(() => modalRoot.classList.add("is-in"));

  modalRoot.dataset.dismissed = "";
  if (onClose) modalRoot._onClose = onClose;
  if (onMount) onMount(modalRoot, () => closeModal());
  const focusable = modalRoot.querySelector("input,textarea,button:not([data-close])");
  if (focusable) focusable.focus({ preventScroll: true });
  return modalRoot;
}

function onEscape(event) {
  if (event.key === "Escape") closeModal();
}

export function closeModal(silent = false) {
  if (!modalRoot) return;
  document.removeEventListener("keydown", onEscape);
  modalRoot.classList.remove("is-in");
  const node = modalRoot;
  modalRoot = null;
  // Snapshot listeners and intervals are torn down here, not by polling, so a
  // closed modal can never keep writing to a detached DOM node.
  try {
    node._onClose?.();
  } catch (err) {
    console.warn("[modal] onClose failed", err);
  }
  document.body.classList.remove("no-scroll");
  setTimeout(() => node.remove(), 220);
  if (!silent && lastFocused && document.contains(lastFocused)) lastFocused.focus({ preventScroll: true });
}

export function confirmDialog({ title = "Are you sure?", body = "", confirmLabel = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openModal({
      title,
      size: "sm",
      body: `
        ${body ? `<p class="modal-text">${esc(body)}</p>` : ""}
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-act="no">Cancel</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" type="button" data-act="yes">${esc(confirmLabel)}</button>
        </div>`,
      onMount(root, close) {
        root.querySelector('[data-act="no"]').addEventListener("click", () => {
          finish(false);
          close();
        });
        root.querySelector('[data-act="yes"]').addEventListener("click", () => {
          finish(true);
          close();
        });
      },
    });
  });
}

/* ------------------------------------------------------------------ */
/* misc                                                                */
/* ------------------------------------------------------------------ */

export function copyText(text) {
  const done = () => toast("Link copied", "success");
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    return;
  }
  fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand("copy");
    done();
  } catch {
    toast("Copy failed — select the link manually", "error");
  }
  area.remove();
}

export async function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

/** Attach a lightweight image lightbox to any <img data-zoom>. */
export function bindZoom(root) {
  root.addEventListener("click", (event) => {
    const img = event.target.closest("img[data-zoom]");
    if (!img) return;
    if (event.target.closest("[data-no-zoom]")) return;
    openModal({
      title: "",
      size: "media",
      body: `<figure class="lightbox-fig">
        <img class="lightbox-img" src="${esc(img.src)}" alt="${esc(img.alt || "Expanded media")}" />
        ${img.dataset.caption ? `<figcaption>${esc(img.dataset.caption)}</figcaption>` : ""}
      </figure>`,
    });
  });
}
