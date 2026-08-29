/** Xacheus — Settings (Phase 1 video platform) */

import {
  EmailAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
  sendEmailVerification,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { auth } from "../firebase.js";
import { purgeUserData, updateProfile } from "../data.js";
import { avatar, confirmDialog, esc, openModal, toast } from "../ui.js";

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
      <h2 class="panel-title">Privacy and safety</h2>
      <div class="setting-row">
        <div class="setting-main"><div><strong>Private account</strong><em>Only approved followers can follow you and see your posts.</em></div></div>
        <button class="btn btn-outline btn-sm" type="button" data-act="private-toggle" aria-pressed="${Boolean(me.private)}">${me.private ? "On" : "Off"}</button>
      </div>
      <div class="setting-row">
        <div class="setting-main"><div><strong>Comment safety</strong><em>Manage comments from each post before publishing it.</em></div></div>
        <span class="badge">Available per post</span>
      </div>
    </section>

    <section class="panel">
      <h2 class="panel-title">Video preferences</h2>
      <div class="setting-row">
        <div class="setting-main"><div><strong>Auto-play videos</strong><em>Videos play automatically when in view.</em></div></div>
        <span class="badge">On</span>
      </div>
      <div class="setting-row">
        <div class="setting-main"><div><strong>Data saver</strong><em>Don't preload videos and only play when you tap.</em></div></div>
        <button class="btn btn-outline btn-sm" type="button" data-act="data-saver" aria-pressed="${localStorage.getItem("xacheus_dataSaver") === "1"}">${localStorage.getItem("xacheus_dataSaver") === "1" ? "On" : "Off"}</button>
      </div>
      <div class="setting-row">
        <div class="setting-main"><div><strong>Browser notifications</strong><em>Allow this browser to notify you about messages and activity.</em></div></div>
        <button class="btn btn-outline btn-sm" type="button" data-act="notifications">${typeof Notification !== "undefined" && Notification.permission === "granted" ? "On" : "Enable"}</button>
      </div>
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

    <p class="settings-foot">
      Xacheus · Built in Zambia 🌍 · <a class="link" href="#/home">Back to feed</a>
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

  return {
    html,
    title: "Settings",
    mount(root) {
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

        if (act === "data-saver") {
          const enabled = localStorage.getItem("xacheus_dataSaver") === "1";
          localStorage.setItem("xacheus_dataSaver", enabled ? "0" : "1");
          trigger.textContent = enabled ? "Off" : "On";
          trigger.setAttribute("aria-pressed", String(!enabled));
          toast(enabled ? "Data saver disabled" : "Data saver enabled", "success");
          return;
        }

        if (act === "notifications") {
          if (typeof Notification === "undefined") return toast("Browser notifications are not supported here.", "error");
          try {
            const permission = await Notification.requestPermission();
            trigger.textContent = permission === "granted" ? "On" : "Enable";
            toast(permission === "granted" ? "Browser notifications enabled" : "Notifications were not enabled", permission === "granted" ? "success" : "info");
          } catch { toast("Could not request notification permission.", "error"); }
          return;
        }

        if (act === "private-toggle") {
          const next = !Boolean(ctx.state.profile.private);
          trigger.disabled = true;
          try {
            await updateProfile(ctx.state.profile.uid, { private: next });
            ctx.state.profile.private = next;
            trigger.textContent = next ? "On" : "Off";
            trigger.setAttribute("aria-pressed", String(next));
            toast(next ? "Private account enabled" : "Private account disabled", "success");
          } catch (error) {
            toast(error?.message || "Could not update privacy setting", "error");
          } finally { trigger.disabled = false; }
          return;
        }

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
