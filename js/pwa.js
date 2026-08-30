/**
 * Xacheus — PWA glue.
 *
 * Owns everything install/update related so app.js stays about the app:
 *
 *   • registers the service worker
 *   • captures `beforeinstallprompt` and exposes a real "Install app" action
 *   • shows a non-destructive "Update available" bar when a new SW is waiting
 *     (never reloads under the user — a silent reload mid-upload would lose work)
 *   • surfaces online/offline transitions
 *
 * iOS Safari never fires `beforeinstallprompt`, so `canInstall()` also reports
 * true there when the app is not already running standalone; the UI then shows
 * the manual "Share -> Add to Home Screen" instructions instead.
 */

import { toast } from "./ui.js";

let deferredPrompt = null;
let registration = null;
let updateReady = false;
const listeners = new Set();

/* ------------------------------------------------------------------ */
/* environment                                                         */
/* ------------------------------------------------------------------ */

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    window.navigator.standalone === true
  );
}

export function isIos() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as desktop Safari but has a touch screen.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** True when we can offer *some* install path (native prompt or iOS manual). */
export function canInstall() {
  if (isStandalone()) return false;
  return Boolean(deferredPrompt) || isIos();
}

export function hasNativePrompt() {
  return Boolean(deferredPrompt);
}

export function hasUpdate() {
  return updateReady;
}

/** Subscribe to install/update state changes. Returns an unsubscribe fn. */
export function onPwaChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a bad listener must not break the others */
    }
  });
}

/* ------------------------------------------------------------------ */
/* install                                                             */
/* ------------------------------------------------------------------ */

/**
 * Trigger installation.
 * @returns {Promise<"accepted"|"dismissed"|"ios"|"unavailable">}
 */
export async function promptInstall() {
  if (deferredPrompt) {
    const prompt = deferredPrompt;
    // A prompt can only be used once — drop it before awaiting so a
    // double-click can't call prompt() twice on the same event.
    deferredPrompt = null;
    emit();
    try {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      return outcome === "accepted" ? "accepted" : "dismissed";
    } catch {
      return "dismissed";
    }
  }
  if (isIos() && !isStandalone()) return "ios";
  return "unavailable";
}

/* ------------------------------------------------------------------ */
/* update bar                                                          */
/* ------------------------------------------------------------------ */

function showUpdateBar() {
  if (document.querySelector(".pwa-update")) return;

  const bar = document.createElement("div");
  bar.className = "pwa-update";
  bar.setAttribute("role", "status");
  bar.innerHTML = `
    <span class="pwa-update-text">A new version of Xacheus is ready.</span>
    <button type="button" class="btn btn-primary btn-sm" data-pwa="reload">Refresh</button>
    <button type="button" class="btn btn-ghost btn-sm" data-pwa="later">Later</button>
  `;
  document.body.appendChild(bar);
  requestAnimationFrame(() => bar.classList.add("is-in"));

  bar.querySelector('[data-pwa="later"]').addEventListener("click", () => {
    bar.classList.remove("is-in");
    setTimeout(() => bar.remove(), 240);
  });

  bar.querySelector('[data-pwa="reload"]').addEventListener("click", () => {
    const waiting = registration?.waiting;
    if (!waiting) {
      window.location.reload();
      return;
    }
    // Reload once the new worker takes over, not before.
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
    waiting.postMessage({ type: "SKIP_WAITING" });
    // Safety net: if controllerchange never fires, reload anyway.
    setTimeout(() => {
      if (!reloaded) {
        reloaded = true;
        window.location.reload();
      }
    }, 3000);
  });
}

function trackInstalling(worker) {
  if (!worker) return;
  worker.addEventListener("statechange", () => {
    // "installed" + an existing controller == an update, not a first install.
    if (worker.state === "installed" && navigator.serviceWorker.controller) {
      updateReady = true;
      emit();
      showUpdateBar();
    }
  });
}

/* ------------------------------------------------------------------ */
/* init                                                                */
/* ------------------------------------------------------------------ */

export function initPwa() {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Keep the event so we can fire it from our own UI later.
    event.preventDefault();
    deferredPrompt = event;
    emit();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    emit();
    toast("Xacheus installed — find it on your home screen.", "success");
  });

  let wasOffline = !navigator.onLine;
  window.addEventListener("offline", () => {
    wasOffline = true;
    document.documentElement.classList.add("is-offline");
    toast("You're offline — Xacheus will keep working with cached content.", "warn", 5000);
  });
  window.addEventListener("online", () => {
    document.documentElement.classList.remove("is-offline");
    if (wasOffline) {
      wasOffline = false;
      toast("Back online.", "success");
    }
  });
  if (!navigator.onLine) document.documentElement.classList.add("is-offline");

  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      registration = await navigator.serviceWorker.register("sw.js");
    } catch {
      return; // SW unavailable (private mode, insecure origin) — app still runs.
    }

    if (registration.waiting && navigator.serviceWorker.controller) {
      updateReady = true;
      emit();
      showUpdateBar();
    }
    trackInstalling(registration.installing);
    registration.addEventListener("updatefound", () => trackInstalling(registration.installing));

    // Check for a new build when the tab regains focus, plus hourly.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registration.update().catch(() => {});
    });
    setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
  });
}
