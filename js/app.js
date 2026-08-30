/** Xacheus — App shell, router and session state (Phase 1: video platform) */

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { auth, db } from "./firebase.js";
import {
  ensureProfile,
  getSuggestedUsers,
  getTrending,
  isDeferringProfileCreation,
  watchConversations,
  watchProfile,
  isAdminProfile,
} from "./data.js";
import { avatar, clear, esc, formatCount, openModal, toast } from "./ui.js";
import { friendlyAuthError, mountAuth } from "./auth.js";
import { canInstall, initPwa, isIos, onPwaChange, promptInstall } from "./pwa.js";
import { homeView } from "./views/home.js";
import { discoverView } from "./views/discover.js";
import { createView } from "./views/create.js";
import { notificationsView } from "./views/notifications.js";
import { profileView } from "./views/profile.js";
import { settingsView } from "./views/settings.js";
import { adminView } from "./views/admin.js";
import { soundsView, soundDetailView } from "./views/sounds.js";
import { messagesView, chatView } from "./views/messages.js";
import { liveListView, liveBroadcastView, liveWatchView } from "./views/live.js";

// Mobile tab bar keeps Create dead-centre (5 items). Desktop sidebar
// shows the fuller set including Live + Messages + Inbox.
const TAB_NAV = [
  { href: "#/home", label: "Home", icon: "home", match: ["home", ""] },
  { href: "#/discover", label: "Discover", icon: "search", match: ["discover", "tag", "search"] },
  { href: "#/create", label: "Create", icon: "plus", match: ["create"], special: true },
  { href: "#/live", label: "Live", icon: "live", match: ["live"] },
  { href: "#/profile", label: "Profile", icon: "user", match: ["profile", "u"] },
];

const SIDE_NAV = [
  { href: "#/home", label: "Home", icon: "home", match: ["home", ""] },
  { href: "#/discover", label: "Discover", icon: "search", match: ["discover", "tag", "search"] },
  { href: "#/create", label: "Create", icon: "plus", match: ["create"], special: true },
  { href: "#/live", label: "Live", icon: "live", match: ["live"] },
  { href: "#/messages", label: "Messages", icon: "chat", match: ["messages", "dm"] },
  { href: "#/notifications", label: "Inbox", icon: "bell", match: ["notifications"] },
  { href: "#/profile", label: "Profile", icon: "user", match: ["profile", "u"] },
];

const ICONS = {
  home: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  search: '<path d="M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm11 17-5.2-5.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M12 3a6 6 0 0 1 6 6v4l2 3H4l2-3V9a6 6 0 0 1 6-6zm-3 15a3 3 0 0 0 6 0z"/>',
  user: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8a7 7 0 0 1 14 0v1H5v-1z"/>',
  gear: '<path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm9 3l2 1.5-2 3.5-2.4-.8-1.6 1.8-.2 2.5h-4l-.2-2.5-1.6-1.8-2.4.8-2-3.5L5.9 12l-2-1.5 2-3.5 2.4.8 1.6-1.8.2-2.5h4l.2 2.5 1.6 1.8 2.4-.8 2 3.5z"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.2 0-2.4-.25-3.4-.7L4 21l1.7-4.6A8.5 8.5 0 1 1 21 11.5z"/>',
  live: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M19.1 4.9a10 10 0 0 1 0 14.2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4"/><path d="M4.9 19.1a10 10 0 0 1 0-14.2"/>',
  admin: '<path d="M12 2l2.5 5 5.5.8-4 3.9.9 5.3L12 14.8l-4.9 2.2.9-5.3-4-3.9 5.5-.8L12 2z"/>',
};

const state = {
  user: null,
  profile: null,
  theme: "dark",
  themePref: localStorage.getItem("xacheus_theme") || "dark",
  feedMode: localStorage.getItem("xacheus_feedMode") || "foryou",
};

const videoCache = new Map();
const countedViews = new Set(); // one view-count bump per video per session
let currentView = null;
let unsubProfile = null;
let unsubConversations = null;
let authController = null;

const ctx = {
  state,
  videoCache,
  postCache: videoCache, // compat
  countedViews,
  navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  },
  requireAuth() {
    openAuthOverlay();
  },
  setNotificationCount(count) {
    setBadge("notifications", count);
  },
  setMessageUnread(count) {
    setBadge("messages", count);
  },
  setThemePref(pref) {
    state.themePref = pref;
    localStorage.setItem("xacheus_theme", pref);
    applyTheme();
  },
  async refreshProfile() {
    if (!state.user) return;
    const fresh = await ensureProfile(state.user).catch(() => null);
    if (fresh) state.profile = fresh;
  },
  onVideosChanged() {
    render();
  },
};

/* theme */
function applyTheme() {
  const prefersLight =
    state.themePref === "light" ||
    (state.themePref === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  state.theme = prefersLight ? "light" : "dark";
  document.documentElement.classList.toggle("light", prefersLight);
  document.documentElement.classList.toggle("dark", !prefersLight);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", prefersLight ? "#f4f6fb" : "#0a0b12");
  document.querySelectorAll("[data-theme-icon]").forEach((node) => {
    node.textContent = prefersLight ? "🌙" : "☀️";
  });
}

/* shell */
function navItem(item, { iconOnly = false, isAdmin = false } = {}) {
  if (item.special) {
    return `
      <a class="nav-item nav-create" href="${item.href}" data-nav="${item.match[0]}" aria-label="${item.label}">
        <span class="nav-create-inner"><svg viewBox="0 0 24 24">${ICONS[item.icon]}</svg></span>
        ${iconOnly ? "" : `<span class="nav-label">${item.label}</span>`}
      </a>`;
  }
  return `
    <a class="nav-item ${isAdmin ? "nav-admin" : ""}" href="${item.href}" data-nav="${item.match[0]}">
      <span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[item.icon]}</svg></span>
      ${iconOnly ? "" : `<span class="nav-label">${item.label}</span>`}
      <span class="nav-badge" data-badge-for="${item.match[0]}" hidden></span>
    </a>`;
}

function buildShell() {
  const shell = document.querySelector("#app");
  const isAdmin = isAdminProfile(state.profile);
  const extraNav = isAdmin ? [{ href: "#/admin", label: "Admin", icon: "admin", match: ["admin"] }] : [];

  const sideNav = [...SIDE_NAV, ...extraNav];
  // Keep Create dead-centre on mobile: Home · Discover · Create · Live · Profile
  // Messages + Inbox stay reachable from the topbar icons + account menu.
  const tabNav = [...TAB_NAV];

  shell.innerHTML = `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="#/home" aria-label="Xacheus home">
          <img class="brand-logo" src="assets/icon-dark.svg" alt="Xacheus" />
          <span class="brand-text">Xacheus</span>
        </a>

        <div class="topbar-tabs" id="topbar-tabs">
          <button class="top-tab ${state.feedMode === "foryou" ? "is-active" : ""}" data-feed="foryou">For You</button>
          <button class="top-tab ${state.feedMode === "following" ? "is-active" : ""}" data-feed="following">Following</button>
        </div>

        <div class="topbar-right">
          <a class="icon-btn" href="#/live" aria-label="Live" title="Live">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4"/></svg>
          </a>
          <a class="icon-btn" href="#/messages" aria-label="Messages" data-nav-icon="messages">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.2 0-2.4-.25-3.4-.7L4 21l1.7-4.6A8.5 8.5 0 1 1 21 11.5z"/></svg>
            <span class="nav-badge topbar-badge" data-badge-for="messages" hidden></span>
          </a>
          <a class="icon-btn" href="#/notifications" aria-label="Inbox" data-nav-icon="notifications">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6 6 0 0 1 6 6v4l2 3H4l2-3V9a6 6 0 0 1 6-6zm-3 15a3 3 0 0 0 6 0z"/></svg>
            <span class="nav-badge topbar-badge" data-badge-for="notifications" hidden></span>
          </a>
          <button class="icon-btn theme-toggle" type="button" data-act="theme" aria-label="Toggle theme">
            <span data-theme-icon>☀️</span>
          </button>
          <button class="topbar-me" type="button" data-act="me" aria-label="Account menu"></button>
        </div>
      </div>
    </header>

    <div class="layout layout-video">
      <nav class="sidebar sidebar-video" aria-label="Primary">
        <a class="brand sidebar-brand" href="#/home" aria-label="Xacheus home">
          <img class="brand-logo" src="assets/icon-dark.svg" alt="Xacheus" />
        </a>
        ${sideNav.map((item) => navItem(item)).join("")}
        <div class="sidebar-me" data-role="sidebar-me"></div>
        <div class="sidebar-foot">
          <button class="install-btn" type="button" data-act="install" hidden>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
            <span>Install app</span>
          </button>
          <p>Built in Zambia 🌍</p>
        </div>
      </nav>

      <main class="main main-video" id="view" tabindex="-1"></main>

      <aside class="rail rail-video" aria-label="Discover">
        <section class="panel" id="rail-trends">
          <h2 class="panel-title">Trending hashtags</h2>
          <div class="loader-row"><span class="spinner"></span></div>
        </section>
        <section class="panel" id="rail-people">
          <h2 class="panel-title">Suggested creators</h2>
          <div class="loader-row"><span class="spinner"></span></div>
        </section>
        <section class="panel">
          <h2 class="panel-title">On Xacheus</h2>
          <ul class="tip-list">
            <li>🎬 Vertical videos & photo posts</li>
            <li>📡 Go live — gifts, stickers & chat</li>
            <li>🎵 Free royalty-free sounds</li>
            <li>👤 Roles for creators, businesses & churches</li>
          </ul>
        </section>
        <p class="rail-foot">
          <a class="link" href="#/discover">Discover</a> ·
          <a class="link" href="#/live">Live</a> ·
          <a class="link" href="#/sounds">Sounds</a> ·
          <a class="link" href="#/settings">Settings</a>
        </p>
      </aside>
    </div>

    <nav class="tabbar tabbar-video" aria-label="Primary mobile">
      ${tabNav.map((item) => navItem(item, { iconOnly: true })).join("")}
    </nav>

    <div class="account-menu" id="account-menu" hidden></div>`;

  shell.removeAttribute("hidden");
  wireShell();
}

function wireShell() {
  const shell = document.querySelector("#app");

  shell.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-act],[data-feed]");
    if (!trigger) return;
    const act = trigger.dataset.act;
    const feed = trigger.dataset.feed;

    if (feed) {
      state.feedMode = feed;
      localStorage.setItem("xacheus_feedMode", feed);
      shell.querySelectorAll(".top-tab").forEach((t) => t.classList.toggle("is-active", t.dataset.feed === feed));
      if (location.hash.startsWith("#/home") || location.hash === "" || location.hash === "#/") {
        render();
      } else {
        location.hash = "#/home";
      }
      return;
    }

    if (act === "install") {
      runInstall();
      return;
    }
    if (act === "theme") {
      const next = state.theme === "light" ? "dark" : "light";
      ctx.setThemePref(next);
      return;
    }
    if (act === "me") return toggleAccountMenu(trigger);
  });

  document.addEventListener("click", (event) => {
    const menu = document.querySelector("#account-menu");
    if (!menu || menu.hidden) return;
    if (event.target.closest("#account-menu") || event.target.closest('[data-act="me"]')) return;
    menu.hidden = true;
  });

  syncInstallUi();
}

/** Show the sidebar install button only when an install is actually possible. */
function syncInstallUi() {
  const installable = canInstall();
  document.querySelectorAll('.install-btn[data-act="install"]').forEach((node) => {
    node.hidden = !installable;
    // iOS has no native prompt — the button opens instructions instead.
    node.title = isIos() ? "Add Xacheus to your home screen" : "Install Xacheus";
  });
}

function toggleAccountMenu(anchor) {
  const menu = document.querySelector("#account-menu");
  if (!menu) return;
  if (!state.profile) return openAuthOverlay();

  const rect = anchor.getBoundingClientRect();
  const isAdmin = isAdminProfile(state.profile);
  menu.innerHTML = `
    <div class="account-head">
      ${avatar(state.profile, "md")}
      <div>
        <strong>${esc(state.profile.displayName)}</strong>
        <em>@${esc(state.profile.username)} · ${esc(state.profile.role || "user")}</em>
      </div>
    </div>
    <a class="account-item" href="#/u/${esc(state.profile.username)}">View profile</a>
    <a class="account-item" href="#/settings">Settings</a>
    ${isAdmin ? `<a class="account-item" href="#/admin">Admin panel</a>` : ""}
    ${canInstall() ? `<button class="account-item" type="button" data-act="install">Install app</button>` : ""}
    <button class="account-item" type="button" data-act="signout">Sign out</button>`;

  menu.hidden = false;
  menu.style.top = `${rect.bottom + 8}px`;
  menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;

  menu.onclick = async (event) => {
    if (event.target.closest('[data-act="install"]')) {
      menu.hidden = true;
      await runInstall();
    } else if (event.target.closest('[data-act="signout"]')) {
      menu.hidden = true;
      await signOut(auth).catch(() => {});
      toast("Signed out", "success");
    } else if (event.target.closest("a")) {
      menu.hidden = true;
    }
  };
}

/**
 * Install the PWA. Chrome/Edge/Android get the native prompt; iOS Safari never
 * fires `beforeinstallprompt`, so it gets the manual Add-to-Home-Screen steps.
 */
async function runInstall() {
  const outcome = await promptInstall();
  if (outcome === "ios") {
    openModal({
      title: "Install Xacheus",
      body: `
        <p class="muted">Add Xacheus to your home screen for full-screen video and faster launches.</p>
        <ol class="install-steps">
          <li>Tap the <strong>Share</strong> button in Safari's toolbar.</li>
          <li>Scroll down and choose <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong>.</li>
        </ol>`,
    });
  } else if (outcome === "unavailable") {
    toast("Xacheus is already installed, or your browser can't install apps.", "info");
  }
}

function setBadge(key, count) {
  document.querySelectorAll(`[data-badge-for="${key}"]`).forEach((node) => {
    const value = Number(count) || 0;
    node.hidden = value === 0;
    node.textContent = value > 9 ? "9+" : String(value);
  });
}

/* auth overlay */
function openAuthOverlay() {
  const overlay = document.querySelector("#auth-overlay");
  overlay.hidden = false;
  document.body.classList.add("no-scroll");
  if (!authController) {
    authController = mountAuth(overlay, {
      onAuthenticated(user, profile) {
        // Fully activate the session from the auth flow too. For deferred
        // sign-ups (new Google user) the global onAuthStateChanged listener
        // won't fire again, so we must paint the session here.
        if (user && profile) activateSession(user, profile);
        else closeAuthOverlay();
      },
    });
  } else {
    authController.show("login");
  }
  requestAnimationFrame(() => overlay.classList.add("is-open"));
}

function closeAuthOverlay() {
  const overlay = document.querySelector("#auth-overlay");
  overlay.classList.remove("is-open");
  document.body.classList.remove("no-scroll");
  setTimeout(() => {
    overlay.hidden = true;
  }, 220);
}

/* router */
function parseHash() {
  const raw = (location.hash || "").replace(/^#/, "") || "/home";
  const [path, queryString] = raw.split("?");
  const segments = path.split("/").filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(queryString || "").entries());
  return { segments, params };
}

function resolveRoute() {
  const { segments, params } = parseHash();
  const [first, second, third] = segments;

  switch (first) {
    case undefined:
    case "home":
      return { view: homeView(ctx), key: "home" };
    case "discover":
      return { view: discoverView(ctx, { tab: params.tab, q: params.q }), key: "discover" };
    case "sounds":
      return { view: soundsView(ctx, { q: params.q, tab: params.tab }), key: "sounds" };
    case "sound":
      if (second) return { view: soundDetailView(ctx, { soundId: second }), key: `sound:${second}` };
      return { view: soundsView(ctx, { q: params.q, tab: params.tab }), key: "sounds" };
    case "create":
      return { view: createView(ctx, { soundId: params.sound || "" }), key: "create" };
    case "tag":
      return { view: discoverView(ctx, { q: `#${second}` }), key: `tag:${second}` };
    case "notifications":
    case "inbox":
      return { view: notificationsView(ctx), key: "notifications" };
    case "messages":
      if (second) return { view: chatView(ctx, { cid: second }), key: `dm:${second}` };
      return { view: messagesView(ctx), key: "messages" };
    case "dm":
      return { view: chatView(ctx, { username: second }), key: `dm:${second}` };
    case "live":
      if (second === "go") return { view: liveBroadcastView(ctx), key: "live:go" };
      if (second) return { view: liveWatchView(ctx, { liveId: second }), key: `live:${second}` };
      return { view: liveListView(ctx), key: "live" };
    case "u":
      return { view: profileView(ctx, { username: second, tab: params.tab || third }), key: `u:${second}` };
    case "video":
    case "v":
      return { view: homeView(ctx, { focusVideoId: second }), key: `video:${second}` };
    case "profile":
      return { view: profileView(ctx, { username: state.profile?.username, tab: params.tab }), key: "me" };
    case "settings":
      return { view: settingsView(ctx), key: "settings" };
    case "admin":
      if (!isAdminProfile(state.profile)) {
        return { view: homeView(ctx), key: "home" };
      }
      return { view: adminView(ctx), key: "admin" };
    default:
      return { view: homeView(ctx), key: "home" };
  }
}

const AUTH_ROUTES = new Set(["create", "notifications", "inbox", "messages", "dm", "settings", "admin"]);
// live/go is handled inside the broadcast view itself (camera + host identity)

function render() {
  const viewHost = document.querySelector("#view");
  if (!viewHost) return;

  const { segments } = parseHash();
  const needsAuth = AUTH_ROUTES.has(segments[0]);

  if (needsAuth && !state.profile) {
    if (currentView?.destroy) currentView.destroy();
    currentView = null;
    clear(viewHost);
    viewHost.innerHTML = `
      <div class="locked-view">
        <div class="locked-card">
          <h2>Sign in to continue</h2>
          <p>${segments[0] === "create" ? "You need an account to post videos." : "This section is private to your account."}</p>
          <button class="btn btn-primary" type="button" data-act="login">Log in or sign up</button>
          <a class="btn btn-ghost" href="#/home">Browse videos instead</a>
        </div>
      </div>`;
    viewHost.querySelector('[data-act="login"]')?.addEventListener("click", openAuthOverlay);
    markActiveNav(segments[0]);
    return;
  }

  const { view } = resolveRoute();
  if (currentView?.destroy) currentView.destroy();
  currentView = view;

  clear(viewHost);
  viewHost.dataset.viewKey = view.key || "";
  viewHost.innerHTML = view.html;
  document.title = `${view.title || "Home"} · Xacheus`;
  markActiveNav(segments[0]);

  try {
    view.mount?.(viewHost);
  } catch (error) {
    console.error("[xacheus] view mount failed", error);
    viewHost.innerHTML = `
      <div class="locked-view">
        <div class="locked-card">
          <h2>Something broke</h2>
          <p>${esc(error?.message || "This screen failed to load.")}</p>
          <button class="btn btn-primary" type="button" data-act="retry">Try again</button>
        </div>
      </div>`;
    viewHost.querySelector('[data-act="retry"]')?.addEventListener("click", () => render());
  }

  window.scrollTo(0, 0);
}

function markActiveNav(segment) {
  const seg = segment === "sound" ? "discover" : segment || "home";
  document.querySelectorAll("[data-nav]").forEach((node) => {
    const matches = node.dataset.nav?.split(",") || [node.dataset.nav];
    const isActive = node.dataset.nav === seg || (seg === "" && node.dataset.nav === "home") || matches.includes(seg);
    node.classList.toggle("is-active", isActive);
  });
}

async function refreshRail() {
  const trends = document.querySelector("#rail-trends");
  const people = document.querySelector("#rail-people");
  if (!trends || !people) return;

  const [trendList, peopleList] = await Promise.all([
    getTrending(5).catch(() => []),
    getSuggestedUsers(state.profile?.uid, 3).catch(() => []),
  ]);

  trends.innerHTML = `
    <h2 class="panel-title">Trending</h2>
    ${
      trendList.length
        ? trendList
            .map(
              (tag) => `
        <a class="trend-row" href="#/tag/${esc(tag.tag || tag.id)}">
          <span class="trend-meta">
            <strong>#${esc(tag.tag || tag.id)}</strong>
            <em>${formatCount(tag.count)} ${tag.count === 1 ? "video" : "videos"}</em>
          </span>
          <span class="trend-arrow" aria-hidden="true">→</span>
        </a>`
            )
            .join("")
        : `<p class="panel-empty">Post a video with a #hashtag to start a trend.</p>`
    }`;

  people.innerHTML = `
    <h2 class="panel-title">Suggested creators</h2>
    ${
      peopleList.length
        ? peopleList
            .map(
              (user) => `
        <a class="rail-user" href="#/u/${esc(user.username)}">
          ${avatar(user, "sm")}
          <span>
            <strong>${esc(user.displayName || user.username)}</strong>
            <em>@${esc(user.username)} · ${esc(user.role || "user")}</em>
          </span>
        </a>`
            )
            .join("")
        : `<p class="panel-empty">You're following everyone here already.</p>`
    }`;
}

function paintSession() {
  const me = document.querySelector(".topbar-me");
  const sidebarMe = document.querySelector('[data-role="sidebar-me"]');

  if (!state.profile) {
    if (me) me.innerHTML = `<span class="btn btn-primary btn-sm">Log in</span>`;
    if (sidebarMe) {
      sidebarMe.innerHTML = `
        <p class="sidebar-guest">Sign in to post videos, follow and interact.</p>
        <button class="btn btn-outline btn-sm" type="button" data-act="login">Log in</button>`;
      sidebarMe.querySelector('[data-act="login"]')?.addEventListener("click", openAuthOverlay);
    }
    // rebuild shell to hide admin if needed
    const app = document.querySelector("#app");
    if (app && !app.hidden) {
      // only rebuild if admin visibility changed? For simplicity rebuild nav badges but not whole shell
      document.querySelectorAll('[data-nav="admin"]').forEach((n) => n.remove());
    }
    return;
  }

  if (me) me.innerHTML = avatar(state.profile, "sm");
  if (sidebarMe) {
    sidebarMe.innerHTML = `
      <a class="sidebar-me-card" href="#/u/${esc(state.profile.username)}">
        ${avatar(state.profile, "md")}
        <span>
          <strong>${esc(state.profile.displayName)}</strong>
          <em>@${esc(state.profile.username)} · ${esc(state.profile.role || "user")}</em>
        </span>
        <span class="sidebar-more" aria-hidden="true">⋯</span>
      </a>`;
  }

  // If admin, ensure admin nav exists - rebuild shell if needed
  if (isAdminProfile(state.profile)) {
    const hasAdmin = document.querySelector('[data-nav="admin"]');
    if (!hasAdmin) {
      buildShell();
      paintSession();
      refreshRail();
    }
  }
}

function activateSession(user, profile) {
  state.user = user;
  state.profile = profile;
  paintSession();
  refreshRail();
  closeAuthOverlay();

  unsubProfile?.();
  unsubProfile = watchProfile(user.uid, (fresh) => {
    if (fresh) state.profile = fresh;
    paintSession();
  });

  // Global DM unread badge — runs for the whole session, any route.
  unsubConversations?.();
  unsubConversations = watchConversations(user.uid, (items) => {
    const total = items.reduce((sum, c) => sum + (c.unreadCount?.[user.uid] || 0), 0);
    ctx.setMessageUnread(total);
  });

  render();
}

function finishBoot() {
  const bootScreen = document.querySelector("#boot");
  if (!bootScreen || bootScreen.hidden) return;
  bootScreen.classList.add("is-done");
  window.setTimeout(() => {
    bootScreen.hidden = true;
  }, 180);
}

function boot() {
  applyTheme();
  initPwa();
  // The install prompt can arrive at any time after load; re-sync when it does.
  onPwaChange(syncInstallUi);
  window.matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => {
    if (state.themePref === "system") applyTheme();
  });

  buildShell();
  paintSession();
  refreshRail();

  window.addEventListener("hashchange", () => {
    render();
    if (location.hash.startsWith("#/home") || location.hash.startsWith("#/discover")) refreshRail();
  });

  onAuthStateChanged(auth, async (user) => {
    state.user = user;
    if (!user) {
      state.profile = null;
      unsubProfile?.();
      unsubConversations?.();
      unsubConversations = null;
      setBadge("notifications", 0);
      setBadge("messages", 0);
      paintSession();
      // rebuild shell to hide admin
      buildShell();
      paintSession();
      render();
      return;
    }

    let profile = null;
    try {
      profile = await ensureProfile(user);
    } catch (error) {
      console.warn("[xacheus] profile load", error);
      toast(`Could not load your profile. ${friendlyAuthError(error)}`, "error", 9000);
    }

    if (!profile) {
      // No profile yet. If an onboarding flow is deliberately deferring
      // creation (new Google user still choosing a handle/role), do NOT sign
      // them out — the handle form will finish creating the profile and call
      // activateSession itself. Only sign out on a genuine failure.
      if (isDeferringProfileCreation()) return;
      await signOut(auth).catch(() => {});
      return;
    }

    activateSession(user, profile);
  });

  render();
  finishBoot();
}

window.addEventListener("unhandledrejection", (event) => {
  const error = event.reason;
  if (!error) return;
  const code = error?.code || "";
  if (code === "permission-denied" || code === "firestore/permission-denied") {
    toast("Permission denied — deploy firestore.rules to your Firebase project.", "error", 8000);
  }
});

boot();

export { ctx, state };
