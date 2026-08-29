/** Xacheus Social — app shell, router and session state. */

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { auth, db } from "./firebase.js";
import {
  ensureProfile,
  getSuggestedUsers,
  getTrending,
  watchProfile,
} from "./data.js";
import { avatar, clear, esc, formatCount, toast } from "./ui.js";
import { mountAuth } from "./auth.js";
import { openComposer } from "./views/components.js";
import { homeView } from "./views/home.js";
import { exploreView } from "./views/explore.js";
import { notificationsView } from "./views/notifications.js";
import { conversationView, messagesView } from "./views/messages.js";
import { profileView } from "./views/profile.js";
import { threadView } from "./views/thread.js";
import { settingsView } from "./views/settings.js";

const NAV = [
  { href: "#/home", label: "Home", icon: "home", match: ["home"] },
  { href: "#/explore", label: "Explore", icon: "search", match: ["explore", "tag"] },
  { href: "#/notifications", label: "Notifications", icon: "bell", match: ["notifications"] },
  { href: "#/messages", label: "Messages", icon: "mail", match: ["messages"] },
  { href: "#/settings", label: "Settings", icon: "gear", match: ["settings"] },
];

const ICONS = {
  home: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  search: '<path d="M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm11 17-5.2-5.2"/>',
  bell: '<path d="M12 3a6 6 0 0 1 6 6v4l2 3H4l2-3V9a6 6 0 0 1 6-6zm-3 15a3 3 0 0 0 6 0z"/>',
  mail: '<path d="M3 6h18v12H3zM3 6l9 7 9-7"/>',
  gear: '<path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm9 3l2 1.5-2 3.5-2.4-.8-1.6 1.8-.2 2.5h-4l-.2-2.5-1.6-1.8-2.4.8-2-3.5L5.9 12l-2-1.5 2-3.5 2.4.8 1.6-1.8.2-2.5h4l.2 2.5 1.6 1.8 2.4-.8 2 3.5z"/>',
  compose: '<path d="M12 5v14M5 12h14"/>',
};

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

const state = {
  user: null,
  profile: null,
  theme: "dark",
  themePref: localStorage.getItem("xacheus_theme") || "dark",
  feedMode: "foryou",
};

const postCache = new Map();
let currentView = null;
let unsubProfile = null;
let authController = null;
const conversationCache = new Map();

const ctx = {
  state,
  postCache,
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
  async loadConversation(cid) {
    if (conversationCache.has(cid)) return conversationCache.get(cid);
    const snap = await getDoc(doc(db, "conversations", cid));
    const value = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    conversationCache.set(cid, value);
    return value;
  },
  onPostsChanged() {
    render();
  },
};

/* ------------------------------------------------------------------ */
/* theme                                                               */
/* ------------------------------------------------------------------ */

function applyTheme() {
  const prefersLight =
    state.themePref === "light" ||
    (state.themePref === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  state.theme = prefersLight ? "light" : "dark";
  document.documentElement.classList.toggle("light", prefersLight);
  document.documentElement.classList.toggle("dark", !prefersLight);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", prefersLight ? "#f4f6fb" : "#0a0b12");
  document.querySelectorAll("[data-theme-icon]").forEach((node) => {
    node.textContent = prefersLight ? "🌙" : "☀️";
  });
}

/* ------------------------------------------------------------------ */
/* shell                                                               */
/* ------------------------------------------------------------------ */

function navItem(item, { iconOnly = false } = {}) {
  return `
    <a class="nav-item" href="${item.href}" data-nav="${item.match[0]}">
      <span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[item.icon]}</svg></span>
      ${iconOnly ? "" : `<span class="nav-label">${item.label}</span>`}
      <span class="nav-badge" data-badge-for="${item.match[0]}" hidden></span>
    </a>`;
}

function buildShell() {
  const shell = document.querySelector("#app");
  shell.innerHTML = `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="#/home" aria-label="Xacheus home">
          <span class="brand-mark" aria-hidden="true">X</span>
          <span class="brand-text">Xacheus</span>
        </a>

        <form class="topbar-search" id="topbar-search" role="search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm11 17-5.2-5.2"/></svg>
          <input type="search" placeholder="Search Xacheus" aria-label="Search Xacheus" autocomplete="off" />
        </form>

        <div class="topbar-right">
          <button class="icon-btn theme-toggle" type="button" data-act="theme" aria-label="Toggle theme">
            <span data-theme-icon>☀️</span>
          </button>
          <button class="btn btn-primary btn-sm topbar-post" type="button" data-act="compose">Post</button>
          <button class="topbar-me" type="button" data-act="me" aria-label="Account menu"></button>
        </div>
      </div>
    </header>

    <div class="layout">
      <nav class="sidebar" aria-label="Primary">
        <a class="brand sidebar-brand" href="#/home">
          <span class="brand-mark" aria-hidden="true">X</span>
        </a>
        ${NAV.map((item) => navItem(item)).join("")}
        <button class="btn btn-primary btn-block sidebar-post" type="button" data-act="compose">Post</button>
        <div class="sidebar-me" data-role="sidebar-me"></div>
      </nav>

      <main class="main" id="view" tabindex="-1"></main>

      <aside class="rail" aria-label="Discover">
        <section class="panel" id="rail-trends">
          <h2 class="panel-title">Trending</h2>
          <div class="loader-row"><span class="spinner"></span></div>
        </section>
        <section class="panel" id="rail-people">
          <h2 class="panel-title">Who to follow</h2>
          <div class="loader-row"><span class="spinner"></span></div>
        </section>
        <p class="rail-foot">
          <a class="link" href="#/explore">Explore</a> ·
          <a class="link" href="#/settings">Settings</a> · Built in Zambia 🌍
        </p>
      </aside>
    </div>

    <nav class="tabbar" aria-label="Primary mobile">
      ${NAV.map((item) => navItem(item, { iconOnly: true })).join("")}
    </nav>

    <button class="fab" type="button" data-act="compose" aria-label="Create post">
      <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.compose}</svg>
    </button>

    <div class="account-menu" id="account-menu" hidden></div>`;

  shell.removeAttribute("hidden");
  wireShell();
}

function wireShell() {
  const shell = document.querySelector("#app");

  shell.querySelector("#topbar-search").addEventListener("submit", (event) => {
    event.preventDefault();
    const term = event.target.querySelector("input").value.trim();
    if (!term) return;
    location.hash = `#/explore?q=${encodeURIComponent(term)}`;
  });

  shell.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-act]");
    if (!trigger) return;
    const act = trigger.dataset.act;

    if (act === "theme") {
      const next = state.theme === "light" ? "dark" : "light";
      ctx.setThemePref(next);
      return;
    }
    if (act === "compose") {
      if (!state.profile) return openAuthOverlay();
      return openComposer(ctx, { onPosted: () => render() });
    }
    if (act === "me") return toggleAccountMenu(trigger);
  });

  document.addEventListener("click", (event) => {
    const menu = document.querySelector("#account-menu");
    if (!menu || menu.hidden) return;
    if (event.target.closest("#account-menu") || event.target.closest('[data-act="me"]')) return;
    menu.hidden = true;
  });
}

function toggleAccountMenu(anchor) {
  const menu = document.querySelector("#account-menu");
  if (!menu) return;
  if (!state.profile) return openAuthOverlay();

  const rect = anchor.getBoundingClientRect();
  menu.innerHTML = `
    <div class="account-head">
      ${avatar(state.profile, "md")}
      <div>
        <strong>${esc(state.profile.displayName)}</strong>
        <em>@${esc(state.profile.username)}</em>
      </div>
    </div>
    <a class="account-item" href="#/u/${esc(state.profile.username)}">View profile</a>
    <a class="account-item" href="#/settings">Settings</a>
    <button class="account-item" type="button" data-act="signout">Sign out</button>`;

  menu.hidden = false;
  menu.style.top = `${rect.bottom + 8}px`;
  menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;

  menu.onclick = async (event) => {
    if (event.target.closest('[data-act="signout"]')) {
      menu.hidden = true;
      await signOut(auth).catch(() => {});
      toast("Signed out", "success");
    } else if (event.target.closest("a")) {
      menu.hidden = true;
    }
  };
}

function setBadge(key, count) {
  document.querySelectorAll(`[data-badge-for="${key}"]`).forEach((node) => {
    const value = Number(count) || 0;
    node.hidden = value === 0;
    node.textContent = value > 9 ? "9+" : String(value);
  });
}

/* ------------------------------------------------------------------ */
/* auth overlay                                                        */
/* ------------------------------------------------------------------ */

function openAuthOverlay() {
  const overlay = document.querySelector("#auth-overlay");
  overlay.hidden = false;
  document.body.classList.add("no-scroll");
  if (!authController) {
    authController = mountAuth(overlay, {
      onAuthenticated() {
        closeAuthOverlay();
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

/* ------------------------------------------------------------------ */
/* router                                                              */
/* ------------------------------------------------------------------ */

function parseHash() {
  const raw = (location.hash || "").replace(/^#/, "") || "/home";
  const [path, queryString] = raw.split("?");
  const segments = path.split("/").filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(queryString || "").entries());
  return { segments, params };
}

function resolveRoute() {
  const { segments, params } = parseHash();
  const [first, second] = segments;

  switch (first) {
    case undefined:
    case "home":
      return { view: homeView(ctx), key: "home" };
    case "explore":
      return { view: exploreView(ctx, { tab: params.tab, q: params.q }), key: "explore" };
    case "tag":
      return { view: exploreView(ctx, { q: `#${second}` }), key: `tag:${second}` };
    case "notifications":
      return { view: notificationsView(ctx), key: "notifications" };
    case "messages":
      return second
        ? { view: conversationView(ctx, { cid: second }), key: `messages:${second}` }
        : { view: messagesView(ctx), key: "messages" };
    case "u":
      return { view: profileView(ctx, { username: second, tab: params.tab }), key: `u:${second}` };
    case "post":
      return { view: threadView(ctx, { id: second, focus: params.focus }), key: `post:${second}` };
    case "settings":
      return { view: settingsView(ctx), key: "settings" };
    case "profile":
      return { view: profileView(ctx, { username: state.profile?.username, tab: params.tab }), key: "me" };
    default:
      return { view: homeView(ctx), key: "home" };
  }
}

const AUTH_ROUTES = new Set(["notifications", "messages", "settings"]);

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
          <p>Notifications, messages and settings are private to your account.</p>
          <button class="btn btn-primary" type="button" data-act="login">Log in or sign up</button>
          <a class="btn btn-ghost" href="#/home">Browse the public feed instead</a>
        </div>
      </div>`;
    viewHost.querySelector('[data-act="login"]').addEventListener("click", openAuthOverlay);
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
    viewHost.querySelector('[data-act="retry"]').addEventListener("click", () => render());
  }

  window.scrollTo(0, 0);
}

function markActiveNav(segment) {
  document.querySelectorAll("[data-nav]").forEach((node) => {
    node.classList.toggle("is-active", node.dataset.nav === (segment || "home"));
  });
}

/* ------------------------------------------------------------------ */
/* right rail                                                          */
/* ------------------------------------------------------------------ */

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
            <em>${formatCount(tag.count)} ${tag.count === 1 ? "post" : "posts"}</em>
          </span>
          <span class="trend-arrow" aria-hidden="true">→</span>
        </a>`
            )
            .join("")
        : `<p class="panel-empty">Post with a #hashtag to start a trend.</p>`
    }`;

  people.innerHTML = `
    <h2 class="panel-title">Who to follow</h2>
    ${
      peopleList.length
        ? peopleList
            .map(
              (user) => `
        <a class="rail-user" href="#/u/${esc(user.username)}">
          ${avatar(user, "sm")}
          <span>
            <strong>${esc(user.displayName || user.username)}</strong>
            <em>@${esc(user.username)}</em>
          </span>
        </a>`
            )
            .join("")
        : `<p class="panel-empty">You're following everyone here already.</p>`
    }`;
}

/* ------------------------------------------------------------------ */
/* session chrome                                                      */
/* ------------------------------------------------------------------ */

function paintSession() {
  const me = document.querySelector(".topbar-me");
  const sidebarMe = document.querySelector('[data-role="sidebar-me"]');

  if (!state.profile) {
    if (me) me.innerHTML = `<span class="btn btn-primary btn-sm">Log in</span>`;
    if (sidebarMe) {
      sidebarMe.innerHTML = `
        <p class="sidebar-guest">Sign in to post, follow and message.</p>
        <button class="btn btn-outline btn-sm" type="button" data-act="login">Log in</button>`;
      sidebarMe.querySelector('[data-act="login"]')?.addEventListener("click", openAuthOverlay);
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
          <em>@${esc(state.profile.username)}</em>
        </span>
        <span class="sidebar-more" aria-hidden="true">⋯</span>
      </a>`;
  }
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

function finishBoot() {
  const bootScreen = document.querySelector("#boot");
  if (!bootScreen || bootScreen.hidden) return;

  // Never make the first paint wait for Firebase/Auth or the right rail. The
  // shell is usable immediately; those services hydrate it in the background.
  bootScreen.classList.add("is-done");
  window.setTimeout(() => {
    bootScreen.hidden = true;
  }, 180);
}

function boot() {
  applyTheme();
  window.matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => {
    if (state.themePref === "system") applyTheme();
  });

  buildShell();
  paintSession();
  refreshRail();

  window.addEventListener("hashchange", () => {
    render();
    if (location.hash.startsWith("#/home")) refreshRail();
  });

  onAuthStateChanged(auth, async (user) => {
    state.user = user;
    if (!user) {
      state.profile = null;
      unsubProfile?.();
      setBadge("notifications", 0);
      setBadge("messages", 0);
      paintSession();
      render();
      return;
    }

    let profile = null;
    try {
      profile = await ensureProfile(user);
    } catch (error) {
      console.warn("[xacheus] profile load", error);
      toast("Could not load your profile. Check that Firestore rules are deployed.", "error", 8000);
    }

    if (!profile) {
      await signOut(auth).catch(() => {});
      return;
    }

    state.profile = profile;
    paintSession();
    refreshRail();
    closeAuthOverlay();

    unsubProfile?.();
    unsubProfile = watchProfile(user.uid, (fresh) => {
      if (fresh) state.profile = fresh;
      paintSession();
    });

    render();
  });

  // Kick off the first paint for guests; signed-in users get a render from onAuthStateChanged.
  // Do this synchronously so a slow Firebase request cannot hold the app behind
  // the loading screen.
  render();
  finishBoot();
}

/* ------------------------------------------------------------------ */
/* global error hints                                                  */
/* ------------------------------------------------------------------ */

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
