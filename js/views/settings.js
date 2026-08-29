/** Xacheus Social — Settings, appearance and account controls. */

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
  const html = `
    <div class="view-head">
      <h1>Settings</h1>
    </div>

    <section class="panel">
      <h2 class="panel-title">Account</h2>
      <div class="setting-row">
        <div class="setting-main">
          ${avatar(me, "lg")}
          <div>
            <strong>${esc(me.displayName)}</strong>
            <em>@${esc(me.username)} · ${esc(me.email || "no email on file")}</em>
          </div>
        </div>
        <button class="btn btn-outline btn-sm" type="button" data-act="edit">Edit profile</button>
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
            <em>Removes your profile, posts, follows and messages. This can't be undone.</em>
          </div>
        </div>
        <button class="btn btn-danger btn-sm" type="button" data-act="delete">Delete account</button>
      </div>
    </section>

    <p class="settings-foot">
      Xacheus Social · Built in Zambia 🌍 ·
      <a class="link" href="#/home">Back to feed</a>
    </p>`;

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

        if (act === "edit") {
          const { openEditProfile } = await import("./profile.js");
          return openEditProfile(ctx);
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
            body: "Your profile, posts, replies, follows and messages will be permanently removed.",
            confirmLabel: "Delete everything",
            danger: true,
          });
          if (!ok) return;

          // Deleting an account needs a recent login; ask for the password when needed.
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

export { updateProfile };
