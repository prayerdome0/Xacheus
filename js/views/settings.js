/**
 * Xacheus — Settings.
 *
 * Account, appearance, notification categories, privacy, playback and the
 * block list. Everything here writes to your own `users/{uid}` document (or a
 * subcollection), so it is still in force the next time you open the app on any
 * device — and the same values are enforced server-side by firestore.rules.
 */

import {
  EmailAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
  sendEmailVerification,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { auth } from "../firebase.js";
import { getProfile, purgeUserData, updateProfile } from "../data.js";
import { NOTIFICATION_CATEGORIES, getBlockList, getUserPrefs, savePrefs, unblockUser } from "../social.js";
import { setPlayerOptions } from "../player.js";
import { avatar, confirmDialog, emptyState, esc, openModal, timeAgo, toast } from "../ui.js";
import { brandSlotHtml } from "../brand.js";

export function settingsView(ctx) {
  const me = ctx.state.profile;
  if (!me) {
    return {
      html: `<div class="locked-view"><div class="locked-card"><h2>Sign in required</h2></div></div>`,
      title: "Settings",
      mount() {},
    };
  }

  const html = `
    <div class="view-head">
      <h1>Settings</h1>
      <p class="view-sub">Manage your account, appearance and privacy.</p>
    </div>

    <section class="panel">
      <h2 class="panel-title">Account</h2>
      <div class="setting-row">
        <div class="setting-main">
          ${avatar(me, "lg")}
          <div>
            <strong>${esc(me.displayName)} ${me.verified ? '<span class="verified">✓</span>' : ""}</strong>
            <em>@${esc(me.username)} · ${esc(me.role || "user")} · ${esc(me.email || "no email")}</em>
            <em>${formatRoleDesc(me.role)}</em>
          </div>
        </div>
        <a class="btn btn-outline btn-sm" href="#/u/${esc(me.username)}">View profile</a>
      </div>
      ${
        auth.currentUser && !auth.currentUser.emailVerified
          ? `<div class="notice">
               <span>Your email isn't verified yet.</span>
               <button class="btn btn-primary btn-sm" type="button" data-act="verify">Resend link</button>
             </div>`
          : ""
      }
    </section>

    <section class="panel">
      <h2 class="panel-title">Appearance</h2>
      <div class="setting-row">
        <div class="setting-main"><div><strong>Theme</strong><em>Pick what's comfortable for your eyes.</em></div></div>
        <div class="segmented" role="group" aria-label="Theme">
          ${["dark", "light", "system"]
            .map(
              (option) =>
                `<button class="seg ${ctx.state.themePref === option ? "is-active" : ""}" type="button" data-theme="${option}">${
                  option[0].toUpperCase() + option.slice(1)
                }</button>`
            )
            .join("")}
        </div>
      </div>
    </section>

    <section class="panel">
      <h2 class="panel-title">Notifications</h2>
      <p class="tab-note">Turn categories off and Xacheus stops creating those notifications for you at all — the check runs on the sender's write, so it also applies to other devices.</p>
      <div data-prefs-notifications></div>
    </section>

    <section class="panel">
      <h2 class="panel-title">Privacy</h2>
      <div data-prefs-privacy></div>
    </section>

    <section class="panel">
      <h2 class="panel-title">Playback &amp; data</h2>
      <div data-prefs-playback></div>
    </section>

    <section class="panel">
      <h2 class="panel-title">Blocked accounts</h2>
      <div data-blocked-list><div class="loader-row"><span class="spinner"></span> Loading…</div></div>
    </section>

    <section class="panel">
      <h2 class="panel-title">Session</h2>
      <div class="setting-row">
        <div class="setting-main"><div><strong>Sign out</strong><em>You can come back any time.</em></div></div>
        <button class="btn btn-outline btn-sm" type="button" data-act="signout">Sign out</button>
      </div>
    </section>

    <section class="panel panel-danger">
      <h2 class="panel-title">Danger zone</h2>
      <div class="setting-row">
        <div class="setting-main">
          <div>
            <strong>Delete account</strong>
            <em>Removes your profile, videos, follows and notifications. This can't be undone.</em>
          </div>
        </div>
        <button class="btn btn-danger btn-sm" type="button" data-act="delete">Delete account</button>
      </div>
    </section>

    <section class="panel">
      <h2 class="panel-title">Not built yet</h2>
      <p class="tab-note">To keep this page honest: language/region settings, export my data, a second-factor sign-in method and email digest frequency aren't implemented — nothing here pretends to save them.</p>
    </section>

    <p class="settings-foot">
      ${brandSlotHtml({ role: "wordmark", size: "sm", linked: false })}
      <span>Built in Zambia 🌍 · <a class="link" href="#/home">Back to feed</a></span>
    </p>`;

  function formatRoleDesc(role) {
    const map = {
      user: "Viewer — watch and interact",
      creator: "Creator — post videos, grow audience",
      business: "Business — promote products/services",
      church: "Church/Community — share sermons & updates",
      admin: "Admin — full platform access",
    };
    return map[role] || map.user;
  }

  let prefs = { ...{ notifications: {}, privacy: {}, playback: {} } };

  function toggleRow(key, label, hint, value, group) {
    return `
      <div class="setting-row">
        <div class="setting-main"><div><strong>${esc(label)}</strong><em>${esc(hint)}</em></div></div>
        <label class="switch">
          <input type="checkbox" data-pref="${group}" data-pref-key="${esc(key)}" ${value ? "checked" : ""} />
          <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>
          <span class="sr-only">${esc(label)}</span>
        </label>
      </div>`;
  }

  function selectRow(key, label, hint, value, options, group) {
    return `
      <div class="setting-row">
        <div class="setting-main"><div><strong>${esc(label)}</strong><em>${esc(hint)}</em></div></div>
        <select class="select-sm" data-pref="${group}" data-pref-key="${esc(key)}" aria-label="${esc(label)}">
          ${options.map((o) => `<option value="${esc(o.value)}" ${o.value === value ? "selected" : ""}>${esc(o.label)}</option>`).join("")}
        </select>
      </div>`;
  }

  function paintPrefs(root) {
    const notif = root.querySelector("[data-prefs-notifications]");
    if (notif) {
      notif.innerHTML = NOTIFICATION_CATEGORIES.map((c) =>
        toggleRow(c.key, c.label, `Includes: ${c.types.join(", ")}`, prefs.notifications[c.key] !== false, "notifications")
      ).join("");
    }
    const privacy = root.querySelector("[data-prefs-privacy]");
    if (privacy) {
      privacy.innerHTML = [
        toggleRow("privateAccount", "Private account", "Only approved followers can see your posts, and requests are needed before anyone can follow you.", prefs.privacy.privateAccount, "privacy"),
        selectRow("whoCanMessage", "Who can message you", "Blocking always overrides this.", prefs.privacy.whoCanMessage || "everyone", [
          { value: "everyone", label: "Everyone" },
          { value: "followers", label: "People I follow back" },
          { value: "nobody", label: "Nobody" },
        ], "privacy"),
        selectRow("whoCanComment", "Who can comment on your posts", "Applied when someone opens the comment composer.", prefs.privacy.whoCanComment || "everyone", [
          { value: "everyone", label: "Everyone" },
          { value: "followers", label: "My followers" },
        ], "privacy"),
        toggleRow("showActivity", "Show my activity on my profile", "The public activity list people can see on your profile page.", prefs.privacy.showActivity !== false, "privacy"),
        toggleRow("showLiked", "Show my liked videos", "Off means the Liked tab is only visible to you.", prefs.privacy.showLiked, "privacy"),
        toggleRow("showSaved", "Show my saved posts", "Off means your Saves tab is only visible to you.", prefs.privacy.showSaved, "privacy"),
      ].join("");
    }
    const playback = root.querySelector("[data-prefs-playback]");
    if (playback) {
      playback.innerHTML = [
        toggleRow("autoplayPreviews", "Auto-play videos in the feed", "Off means you tap a video to start it — useful on mobile data.", prefs.playback.autoplayPreviews !== false, "playback"),
        toggleRow("dataSaver", "Data saver", "Music preloads nothing until you press play, and feed videos only load their first frame.", prefs.playback.dataSaver, "playback"),
        toggleRow("reducedMotion", "Reduce motion", "Turns off transitions and the animated story rings.", prefs.playback.reducedMotion, "playback"),
      ].join("");
    }
  }

  async function paintBlocked(root) {
    const host = root.querySelector("[data-blocked-list]");
    if (!host) return;
    const rows = await getBlockList(ctx.state.profile.uid).catch(() => []);
    if (!rows.length) {
      host.innerHTML = `<p class="panel-empty">You haven't blocked anyone. Blocking is available from any profile's ⋯ menu, and it stops messaging, following and comments both ways.</p>`;
      return;
    }
    const people = await Promise.all(rows.map((r) => getProfile(r.uid || r.id).catch(() => null)));
    host.innerHTML = `<div class="block-list">${people
      .map((p, i) =>
        p
          ? `<div class="block-row">
               ${avatar(p, "md")}
               <span class="block-main"><strong>${esc(p.displayName || p.username)}</strong><em>@${esc(p.username)} · blocked ${timeAgo(rows[i].createdAt)}</em></span>
               <button class="btn btn-outline btn-sm" type="button" data-unblock="${esc(rows[i].id)}">Unblock</button>
             </div>`
          : `<div class="block-row"><span class="block-main"><em>Deleted account · blocked ${timeAgo(rows[i].createdAt)}</em></span><button class="btn btn-outline btn-sm" type="button" data-unblock="${esc(rows[i].id)}">Unblock</button></div>`
      )
      .join("")}</div>`;
    host.querySelectorAll("[data-unblock]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await unblockUser(ctx.state.profile.uid, btn.dataset.unblock);
          toast("Unblocked", "success");
          paintBlocked(root);
        } catch (err) {
          toast(err?.message || "Could not unblock that account", "error");
          btn.disabled = false;
        }
      });
    });
  }

  return {
    html,
    title: "Settings",
    async mount(root) {
      prefs = await getUserPrefs(ctx.state.profile.uid).catch(() => ({ notifications: {}, privacy: {}, playback: {} }));
      setPlayerOptions(prefs.playback || {});
      paintPrefs(root);
      paintBlocked(root);

      root.addEventListener("change", async (event) => {
        const input = event.target.closest("[data-pref-key]");
        if (!input) return;
        const group = input.dataset.pref;
        const key = input.dataset.prefKey;
        const value = input.type === "checkbox" ? input.checked : input.value;
        try {
          prefs = await savePrefs(ctx.state.profile.uid, { [group]: { [key]: value } });
          if (group === "playback") setPlayerOptions(prefs.playback || {});
          if (group === "privacy" && key === "privateAccount") {
            // `users.private` is what rules read; keep the profile object in sync.
            await updateProfile(ctx.state.profile.uid, { private: Boolean(value) }).catch(() => {});
            ctx.refreshProfile?.();
            window.dispatchEvent(new CustomEvent("xacheus:privacy-changed", { detail: { private: Boolean(value) } }));
          }
          const label = input.type === "checkbox" ? (value ? "on" : "off") : value;
          toast(`Saved — ${key.replace(/([A-Z])/g, " $1").toLowerCase()} is ${label}`, "success", 2200);
          paintPrefs(root);
        } catch (err) {
          toast(err?.message || "Could not save that preference", "error");
          paintPrefs(root);
        }
      });

      root.addEventListener("click", async (event) => {
        const themeBtn = event.target.closest("[data-theme]");
        if (themeBtn) {
          ctx.setThemePref(themeBtn.dataset.theme);
          root.querySelectorAll(".seg").forEach((node) =>
            node.classList.toggle("is-active", node.dataset.theme === themeBtn.dataset.theme)
          );
          return;
        }

        const trigger = event.target.closest("[data-act]");
        if (!trigger) return;
        const act = trigger.dataset.act;

        if (act === "verify") {
          sendEmailVerification(auth.currentUser)
            .then(() => toast("Verification email sent", "success"))
            .catch((error) => toast(error?.message || "Could not send the email.", "error"));
          return;
        }

        if (act === "signout") {
          const ok = await confirmDialog({
            title: "Sign out?",
            body: "You'll need your password to come back in.",
            confirmLabel: "Sign out",
          });
          if (ok) signOut(auth).then(() => toast("Signed out", "success"));
          return;
        }

        if (act === "delete") {
          const ok = await confirmDialog({
            title: "Delete your account?",
            body: "Your profile, videos, follows and notifications will be permanently removed.",
            confirmLabel: "Delete everything",
            danger: true,
          });
          if (!ok) return;

          if (auth.currentUser?.providerData?.some((p) => p.providerId === "password")) {
            const password = await askForPassword();
            if (password === null) return;
            try {
              const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
              await reauthenticateWithCredential(auth.currentUser, credential);
            } catch (error) {
              return toast(error?.code === "auth/wrong-password" ? "Wrong password." : "Please sign in again first.", "error", 5000);
            }
          } else {
            try {
              const { GoogleAuthProvider: Provider, reauthenticateWithPopup } = await import(
                "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js"
              );
              await reauthenticateWithPopup(auth.currentUser, new Provider());
            } catch {
              return toast("Please sign in again before deleting your account.", "error", 5000);
            }
          }

          try {
            await purgeUserData(auth.currentUser.uid);
            await deleteUser(auth.currentUser);
            toast("Account deleted. Take care 👋", "success", 6000);
            ctx.navigate("#/home");
          } catch (error) {
            console.warn("[xacheus] account deletion", error);
            toast(error?.message || "Could not delete your account.", "error", 6000);
          }
        }
      });
    },
  };
}

function askForPassword() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openModal({
      title: "Confirm your password",
      size: "sm",
      body: `
        <p class="modal-text">For safety, enter your password to delete the account.</p>
        <form id="pw-form">
          <label class="field">
            <span>Password</span>
            <input type="password" id="pw-input" autocomplete="current-password" required />
          </label>
          <div class="modal-actions">
            <button class="btn btn-ghost" type="button" data-act="cancel">Cancel</button>
            <button class="btn btn-danger" type="submit">Confirm</button>
          </div>
        </form>`,
      onMount(root, close) {
        root.querySelector('[data-act="cancel"]').addEventListener("click", () => {
          finish(null);
          close();
        });
        root.querySelector("#pw-form").addEventListener("submit", (event) => {
          event.preventDefault();
          const value = root.querySelector("#pw-input").value;
          finish(value);
          close();
        });
      },
    });
  });
}
