/** Xacheus — Auth (Phase 1: video platform with roles) */

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile as updateAuthProfile,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { auth, googleProvider } from "./firebase.js";
import {
  ensureProfile,
  isUsernameTaken,
  normaliseUsername,
  setDeferProfileCreation,
  setPendingProfileDefaults,
  suggestUsername,
  updateProfile,
  usernameError,
  ROLES,
} from "./data.js";
import { esc, toast } from "./ui.js";
import { brandSlotHtml } from "./brand.js";

const MESSAGES = {
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/missing-password": "Enter your password.",
  "auth/weak-password": "Use at least 6 characters for your password.",
  "auth/email-already-in-use": "That email already has an account. Try logging in.",
  "auth/invalid-credential": "Wrong email or password.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/user-not-found": "We couldn't find an account with that email.",
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
  "auth/network-request-failed": "Network problem — check your connection.",
  "auth/popup-closed-by-user": "Google sign-in was cancelled.",
  "auth/cancelled-popup-request": "Google sign-in was cancelled.",
  "auth/popup-blocked": "Your browser blocked the popup. Allow popups and try again.",
  "auth/account-exists-with-different-credential": "That email is already registered with a different sign-in method.",
  "auth/operation-not-allowed": "That sign-in method is disabled in the Firebase console.",
  "auth/unauthorized-domain": "This domain isn't allowed in Firebase Auth settings yet.",
  "auth/invalid-verification-code": "Invalid verification code. Please try again.",
  "auth/invalid-verification-id": "Invalid verification ID. Please try again.",
  "auth/app-deleted": "This app has been deleted. Please contact support.",
  "auth/app-not-authorized": "This app is not authorized to use Firebase Authentication.",
  "auth/argument-error": "Invalid authentication argument.",
  "auth/invalid-api-key": "Invalid API key. Check your Firebase configuration.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/user-token-expired": "Your session has expired. Please sign in again.",
  "auth/requires-recent-login": "Please sign in again to complete this action.",
};

export function friendlyAuthError(error) {
  const raw = String(error?.message || "");
  const code = error?.code || "";
  
  // Network and offline errors
  if (code === "unavailable" || raw.includes("client is offline") || raw.includes("offline")) {
    return "Couldn't reach the database. Check your connection (or disable VPN/ad-blocker) and try again.";
  }
  
  // Firestore specific errors
  if (code === "failed-precondition" && raw.includes("Firestore")) {
    return "Cloud Firestore isn't reachable. Make sure the database is created and try again.";
  }
  
  if (code === "permission-denied" || code === "firestore/permission-denied") {
    const message = String(error?.message || "");
    if (message.includes("has not been used in project") || message.includes("disabled")) {
      return "Cloud Firestore is not enabled yet. Enable it in Google Cloud Console → Cloud Firestore API, create the database, then try again.";
    }
    if (message.includes("missing or insufficient permissions")) {
      return "Firestore rejected this write. Deploy firestore.rules (npm run deploy), then try again.";
    }
    return "You don't have permission to perform this action.";
  }
  
  // Authentication errors
  if (code === "auth/invalid-api-key") {
    return "Invalid Firebase configuration. Check your API key.";
  }
  
  if (code === "auth/user-disabled") {
    return "This account has been disabled. Please contact support.";
  }
  
  if (code === "auth/user-token-expired" || code === "auth/requires-recent-login") {
    return "Your session has expired. Please sign in again.";
  }
  
  // Check for specific error messages
  if (raw.includes("FirebaseError")) {
    // Extract more specific error if available
    const match = raw.match(/FirebaseError: \[code\] = (\w+)/);
    if (match) {
      return MESSAGES[match[1]] || error?.message || "Something went wrong. Please try again.";
    }
  }
  
  // Return mapped message or fallback
  return MESSAGES[code] || error?.message || "Something went wrong. Please try again.";
}

const HIGHLIGHTS = [
  ["🎬", "Short vertical videos", "Real videos, no fakes — upload or record in seconds."],
  ["🎵", "Free sounds library", "Use royalty-free beats, gospel, afro vibes — no copyrighted YouTube rips."],
  ["👥", "Follow & interact", "Likes, comments, follows, notifications — all live."],
  ["⛪", "Communities & more", "Discover trending, churches, opportunities — growing step by step."],
];

function shell(innerHtml) {
  return `
    <div class="auth-wrap">
      <section class="auth-hero" aria-label="About Xacheus">
        <div class="auth-hero-inner">
          ${brandSlotHtml({ role: "wordmark", size: "xl", extraClass: "brand-hero" })}
          <h1>Zambia's short video community.</h1>
          <p class="auth-hero-text">
            Share real vertical videos, discover creators, churches and opportunities. Built for creators, businesses and communities — with real auth, real Cloudinary media and strict security.
          </p>
          <ul class="auth-highlights">
            ${HIGHLIGHTS.map(([icon, title, body]) => `
              <li>
                <span class="hl-icon" aria-hidden="true">${icon}</span>
                <span><strong>${esc(title)}</strong><em>${esc(body)}</em></span>
              </li>`).join("")}
          </ul>
          <div class="auth-hero-foot">
            <span>Phase 1: Auth • Profiles • Video Feed • Cloudinary</span>
          </div>
        </div>
      </section>
      <section class="auth-panel">
        <div class="auth-card" id="auth-card">${innerHtml}</div>
      </section>
    </div>`;
}

function loginView(prefillEmail = "") {
  return `
    <header class="auth-card-head">
      <h2>Welcome back</h2>
      <p>Log in to watch, post and interact.</p>
    </header>
    <button class="btn btn-google" type="button" data-act="google">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.2-2.2H12v4.3h6.6c-.1 1.1-.8 2.8-2.4 3.9l3.7 2.9c2.2-2 3.6-5 3.6-8.9z"/>
        <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.9-5.1l-3.9 3C3.9 21.4 7.7 24 12 24z"/>
        <path fill="#FBBC05" d="M5.1 14.3c-.3-.8-.5-1.6-.5-2.3s.2-1.5.4-2.2l-3.9-3C.4 8.1 0 10 0 12s.4 3.9 1.1 5.2l4-3z"/>
        <path fill="#EA4335" d="M12 4.7c2.1 0 3.5.9 4.3 1.7l3.2-3.1C17.8 1.4 15.2 0 12 0 7.7 0 3.9 2.6 1.1 6.8l3.9 3C6.1 6.8 8.8 4.7 12 4.7z"/>
      </svg>
      Continue with Google
    </button>
    <div class="or-divider"><span>or</span></div>
    <form id="login-form" novalidate>
      <label class="field">
        <span>Email</span>
        <input type="email" name="email" value="${esc(prefillEmail)}" autocomplete="email" placeholder="you@example.com" required />
      </label>
      <label class="field">
        <span>Password</span>
        <span class="field-wrap">
          <input type="password" name="password" autocomplete="current-password" placeholder="••••••••" required />
          <button class="field-toggle" type="button" data-act="toggle-password" aria-label="Show password">Show</button>
        </span>
      </label>
      <button class="btn btn-primary btn-block" type="submit">Log in</button>
    </form>
    <div class="auth-links">
      <button class="link-btn" type="button" data-act="goto-reset">Forgot password?</button>
    </div>
    <footer class="auth-card-foot">
      New to Xacheus? <button class="link-btn" type="button" data-act="goto-signup">Create an account</button>
    </footer>`;
}

function signupView() {
  return `
    <header class="auth-card-head">
      <h2>Create your account</h2>
      <p>Real auth, real profiles, role-based access.</p>
    </header>
    <button class="btn btn-google" type="button" data-act="google">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.2-2.2H12v4.3h6.6c-.1 1.1-.8 2.8-2.4 3.9l3.7 2.9c2.2-2 3.6-5 3.6-8.9z"/>
        <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.9-5.1l-3.9 3C3.9 21.4 7.7 24 12 24z"/>
        <path fill="#FBBC05" d="M5.1 14.3c-.3-.8-.5-1.6-.5-2.3s.2-1.5.4-2.2l-3.9-3C.4 8.1 0 10 0 12s.4 3.9 1.1 5.2l4-3z"/>
        <path fill="#EA4335" d="M12 4.7c2.1 0 3.5.9 4.3 1.7l3.2-3.1C17.8 1.4 15.2 0 12 0 7.7 0 3.9 2.6 1.1 6.8l3.9 3C6.1 6.8 8.8 4.7 12 4.7z"/>
      </svg>
      Sign up with Google
    </button>
    <div class="or-divider"><span>or</span></div>
    <form id="signup-form" novalidate>
      <label class="field">
        <span>Display name</span>
        <input type="text" name="displayName" autocomplete="name" placeholder="Zacheus Simbaya" maxlength="40" required />
      </label>
      <label class="field">
        <span>Handle</span>
        <span class="field-prefix-wrap">
          <span class="field-prefix">@</span>
          <input type="text" name="username" autocomplete="username" placeholder="zacheus" maxlength="20" required />
        </span>
        <small class="field-hint" data-role="username-hint">Letters, numbers and underscores.</small>
      </label>
      <label class="field">
        <span>I am a…</span>
        <select name="role">
          <option value="user">Viewer / User</option>
          <option value="creator">Creator</option>
          <option value="business">Business</option>
          <option value="church">Church / Community</option>
        </select>
      </label>
      <label class="field">
        <span>Email</span>
        <input type="email" name="email" autocomplete="email" placeholder="you@example.com" required />
      </label>
      <label class="field">
        <span>Password</span>
        <span class="field-wrap">
          <input type="password" name="password" autocomplete="new-password" placeholder="At least 6 characters" required minlength="6" />
          <button class="field-toggle" type="button" data-act="toggle-password" aria-label="Show password">Show</button>
        </span>
      </label>
      <button class="btn btn-primary btn-block" type="submit">Create account</button>
      <p class="fine-print">By joining you agree to keep it humane — no hate, no spam, no impersonation.</p>
    </form>
    <footer class="auth-card-foot">
      Already have an account? <button class="link-btn" type="button" data-act="goto-login">Log in</button>
    </footer>`;
}

function resetView(prefillEmail = "") {
  return `
    <header class="auth-card-head">
      <h2>Reset your password</h2>
      <p>We'll email you a secure link.</p>
    </header>
    <form id="reset-form" novalidate>
      <label class="field">
        <span>Email</span>
        <input type="email" name="email" value="${esc(prefillEmail)}" autocomplete="email" placeholder="you@example.com" required />
      </label>
      <button class="btn btn-primary btn-block" type="submit">Send reset link</button>
    </form>
    <footer class="auth-card-foot">
      Remembered it? <button class="link-btn" type="button" data-act="goto-login">Back to log in</button>
    </footer>`;
}

function handleView(profile) {
  return `
    <header class="auth-card-head">
      <h2>Pick your handle & role</h2>
      <p>This is how people find and mention you.</p>
    </header>
    <form id="handle-form" novalidate>
      <label class="field">
        <span>Display name</span>
        <input type="text" name="displayName" value="${esc(profile.displayName || "")}" maxlength="40" required />
      </label>
      <label class="field">
        <span>Handle</span>
        <span class="field-prefix-wrap">
          <span class="field-prefix">@</span>
          <input type="text" name="username" value="${esc(profile.username || "")}" maxlength="20" required />
        </span>
        <small class="field-hint" data-role="username-hint">Letters, numbers and underscores.</small>
      </label>
      <label class="field">
        <span>Role</span>
        <select name="role">
          <option value="user" ${profile.role==="user"?"selected":""}>Viewer / User</option>
          <option value="creator" ${profile.role==="creator"?"selected":""}>Creator</option>
          <option value="business" ${profile.role==="business"?"selected":""}>Business</option>
          <option value="church" ${profile.role==="church"?"selected":""}>Church / Community</option>
        </select>
      </label>
      <label class="field">
        <span>Bio <em>(optional)</em></span>
        <textarea name="bio" rows="3" maxlength="160" placeholder="One line about you…">${esc(profile.bio || "")}</textarea>
      </label>
      <button class="btn btn-primary btn-block" type="submit">Start using Xacheus</button>
    </form>`;
}

export function mountAuth(host, { onAuthenticated }) {
  let mode = "login";
  let busy = false;

  function render(html) {
    host.innerHTML = shell(html);
  }

  function show(next, prefill) {
    mode = next;
    if (next === "login") render(loginView(prefill));
    if (next === "signup") render(signupView());
    if (next === "reset") render(resetView(prefill));
    host.scrollTop = 0;
    wireUsernameHint(host);
    if (next === "signup") primeSignup();
  }

  async function primeSignup() {
    const input = host.querySelector('input[name="username"]');
    if (!input || input.value) return;
    try {
      input.value = await suggestUsername("user");
      setHint(host.querySelector('[data-role="username-hint"]'), `@${input.value} is available`, "good");
    } catch {}
  }

  function setBusy(value, label) {
    busy = value;
    host.querySelectorAll("button").forEach((button) => {
      if (value) {
        if (!button.dataset.prev) button.dataset.prev = button.textContent;
        if (button.dataset.primary === "1" || button.type === "submit") button.textContent = label;
        button.disabled = true;
      } else {
        if (button.dataset.prev) button.textContent = button.dataset.prev;
        delete button.dataset.prev;
        button.disabled = false;
      }
    });
    host.classList.toggle("is-busy", value);
  }

  async function afterAuth(user, chosen) {
    const profile = await ensureProfile(user, chosen || {});
    if (!profile) return;
    if (chosen?.username || chosen?.displayName || chosen?.role || chosen?.bio) {
      const patch = {};
      if (chosen.displayName) patch.displayName = chosen.displayName;
      if (chosen.username) patch.username = chosen.username;
      if (chosen.bio !== undefined) patch.bio = chosen.bio;
      if (chosen.displayName) patch.displayNameLower = chosen.displayName.toLowerCase();
      // role only on first creation; don't overwrite existing role via this path
      await updateProfile(user.uid, patch).catch(() => {});
      if (chosen.username) {
        const { changeUsername } = await import("./data.js");
        await changeUsername(user.uid, chosen.username).catch(() => {});
      }
    }
    onAuthenticated(user, profile);
  }

  async function runGoogle() {
    if (busy) return;
    setBusy(true, "Opening Google…");
    // For brand-new Google users we must NOT create the profile yet — the user
    // still has to pick a role on the handle form, and a role can only be set
    // when the doc is first created. Defer creation until onHandleSubmit.
    setDeferProfileCreation(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      // More robust check for new user
      const metadata = result.user.metadata || {};
      const isNew = !metadata.lastSignInTime || 
                   metadata.creationTime === metadata.lastSignInTime ||
                   (metadata.creationTime && new Date(metadata.creationTime) > new Date(Date.now() - 60000));
      
      const profile = await ensureProfile(result.user).catch(() => null);
      
      if (isNew || !profile) {
        const seedUsername = await suggestUsername(
          result.user.displayName || (result.user.email || "").split("@")[0] || "user"
        ).catch(() => "");
        const draft = profile || {
          displayName: result.user.displayName || "",
          username: seedUsername,
          bio: "",
          role: "user",
        };
        host.innerHTML = shell(handleView(draft));
        host.querySelector("#handle-form")?.addEventListener("submit", onHandleSubmit);
        wireUsernameHint(host);
      } else {
        setDeferProfileCreation(false);
        await afterAuth(result.user);
      }
      setBusy(false);
    } catch (error) {
      setDeferProfileCreation(false);
      setBusy(false);
      if (error?.code === "auth/popup-closed-by-user") return;
      if (error?.code === "auth/cancelled-popup-request") return;
      console.warn("[xacheus] google sign-in", error);
      const message = friendlyAuthError(error);
      toast(message, "error", 6000);
      if (error?.code === "auth/unauthorized-domain") {
        toast("Add this preview domain under Firebase Console → Authentication → Settings → Authorized domains.", "error", 9000);
      }
    }
  }

  async function onHandleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const displayName = String(data.get("displayName") || "").trim();
    const username = normaliseUsername(data.get("username"));
    const bio = String(data.get("bio") || "").trim();
    const role = String(data.get("role") || "user");
    const problem = usernameError(username);
    if (problem) return toast(problem, "error");
    if (!displayName) return toast("Add a display name.", "error");
    if (!ROLES.includes(role) || role === "admin") return toast("Invalid role.", "error");

    setBusy(true, "Saving…");
    try {
      const current = auth.currentUser;
      if (!current) {
        setDeferProfileCreation(false);
        toast("Your session expired. Please sign in again.", "error");
        return setBusy(false);
      }

      // Is the handle free (or already ours)?
      const { getProfile } = await import("./data.js");
      const existing = await getProfile(current.uid).catch(() => null);
      if (await isUsernameTaken(username)) {
        if (!existing || existing.username !== username) {
          toast("That handle is taken. Try another.", "error");
          return setBusy(false);
        }
      }

      if (!existing) {
        // First time: create the profile now, WITH the chosen role. A non-admin
        // can only set a role at creation, so this is our one chance.
        setPendingProfileDefaults({ displayName, username, role, bio });
        setDeferProfileCreation(false);
        await ensureProfile(current, { displayName, username, role, bio, __commit: true });
      } else {
        // Profile already existed (e.g. returning user editing handle): update
        // the mutable fields. Role is immutable for non-admins by design.
        const updateData = {
          displayName,
          bio,
          displayNameLower: displayName.toLowerCase(),
        };
        await updateProfile(current.uid, updateData).catch((err) => {
          console.warn("[xacheus] profile update failed", err);
          throw err;
        });
        const { changeUsername } = await import("./data.js");
        await changeUsername(current.uid, username).catch((err) => {
          console.warn("[xacheus] username change failed", err);
          throw err;
        });
      }

      await afterAuth(current, { displayName, username, bio });
      setBusy(false);
    } catch (error) {
      setDeferProfileCreation(false);
      setPendingProfileDefaults(null);
      setBusy(false);
      console.warn("[xacheus] handle save", error);
      toast(friendlyAuthError(error), "error", 5000);
    }
  }

  async function onLogin(event) {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    if (!email || !password) return toast("Enter your email and password.", "error");
    
    // Basic email validation
    if (!email.includes("@") || !email.includes(".")) {
      return toast("Please enter a valid email address.", "error");
    }
    
    setBusy(true, "Logging in…");
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      await afterAuth(result.user);
      setBusy(false);
    } catch (error) {
      setBusy(false);
      console.warn("[xacheus] login failed", error);
      toast(friendlyAuthError(error), "error", 5000);
    }
  }

  async function onSignup(event) {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const displayName = String(data.get("displayName") || "").trim();
    const username = normaliseUsername(data.get("username"));
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const role = String(data.get("role") || "user");

    if (!displayName) return toast("Add your display name.", "error");
    const problem = usernameError(username);
    if (problem) return toast(problem, "error");
    if (!email.includes("@")) return toast("Enter a valid email address.", "error");
    if (password.length < 6) return toast("Use at least 6 characters for your password.", "error");
    if (!ROLES.includes(role) || role === "admin") return toast("Invalid role selected.", "error");

    setBusy(true, "Creating account…");
    try {
      if (await isUsernameTaken(username)) {
        toast("That handle is taken — try another.", "error");
        return setBusy(false);
      }

      // Stash the chosen handle/display name/role BEFORE the auth user exists.
      // The instant createUserWithEmailAndPassword resolves, the global
      // onAuthStateChanged listener fires and may call ensureProfile itself —
      // these defaults make sure the profile is created once, with the values
      // the user actually picked (role can only be set at creation time).
      setPendingProfileDefaults({ displayName, username, role, bio: "" });

      const result = await createUserWithEmailAndPassword(auth, email, password);
      await updateAuthProfile(result.user, { displayName }).catch((err) => {
        console.warn("[xacheus] display name update failed", err);
      });

      await afterAuth(result.user, { displayName, username, role, bio: "" });
      
      // Send verification email
      try {
        await sendEmailVerification(result.user);
        setTimeout(() => {
          if (auth.currentUser && !auth.currentUser.emailVerified) {
            toast("Check your inbox to verify your email.", "info", 6000);
          }
        }, 1200);
      } catch (err) {
        console.warn("[xacheus] email verification failed", err);
        // Don't fail the signup if verification email fails
      }
      
      setBusy(false);
    } catch (error) {
      setPendingProfileDefaults(null);
      setBusy(false);
      console.warn("[xacheus] signup failed", error);
      toast(friendlyAuthError(error), "error", 5000);
    }
  }

  async function onReset(event) {
    event.preventDefault();
    const form = event.target;
    const email = String(new FormData(form).get("email") || "").trim();
    if (!email.includes("@") || !email.includes(".")) {
      return toast("Enter a valid email address.", "error");
    }
    setBusy(true, "Sending…");
    try {
      await sendPasswordResetEmail(auth, email);
      setBusy(false);
      toast(`Reset link sent to ${email}. Check your inbox.`, "success", 6000);
      show("login", email);
    } catch (error) {
      setBusy(false);
      console.warn("[xacheus] password reset failed", error);
      // Don't reveal if email exists or not for security
      if (error?.code === "auth/user-not-found") {
        toast("If this email exists in our system, you'll receive a reset link.", "info", 6000);
      } else {
        toast(friendlyAuthError(error), "error", 5000);
      }
    }
  }

  function wireUsernameHint(scope) {
    const input = scope.querySelector('input[name="username"]');
    const hint = scope.querySelector('[data-role="username-hint"]');
    if (!input || !hint) return;
    let timer;
    input.addEventListener("input", () => {
      const value = normaliseUsername(input.value);
      if (input.value !== value) input.value = value;
      clearTimeout(timer);
      const problem = usernameError(value);
      if (!value) return setHint(hint, "Letters, numbers and underscores.", "");
      if (problem) return setHint(hint, problem, "bad");
      setHint(hint, "Checking…", "");
      timer = setTimeout(async () => {
        const taken = await isUsernameTaken(value).catch(() => false);
        setHint(hint, taken ? `@${value} is taken` : `@${value} is available`, taken ? "bad" : "good");
      }, 420);
    });
  }

  function setHint(node, text, tone) {
    node.textContent = text;
    node.className = `field-hint ${tone ? `hint-${tone}` : ""}`;
  }

  host.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-act]");
    if (!trigger || busy) return;
    const act = trigger.dataset.act;
    if (act === "google") return runGoogle();
    if (act === "goto-login") return show("login");
    if (act === "goto-signup") return show("signup");
    if (act === "goto-reset") return show("reset", host.querySelector('input[name="email"]')?.value || "");
    if (act === "toggle-password") {
      const input = trigger.parentElement.querySelector("input");
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      trigger.textContent = showing ? "Show" : "Hide";
      trigger.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    }
  });

  host.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return;
    if (event.target.id === "login-form") return onLogin(event);
    if (event.target.id === "signup-form") return onSignup(event);
    if (event.target.id === "reset-form") return onReset(event);
    if (event.target.id === "handle-form") return onHandleSubmit(event);
  });

  show("login");
  return { show };
}

export { GoogleAuthProvider };
