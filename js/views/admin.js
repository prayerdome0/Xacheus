/** Xacheus — Admin panel (visible only if role == admin).
 *  Tabs: Users · Videos · Comments · Reports · Sounds · Stats.
 *  Every action writes to Firestore and is protected by the rules (only an
 *  admin can change roles, verify, ban, delete content, or resolve reports).
 */

import {
  getDocs,
  query,
  collection,
  collectionGroup,
  orderBy,
  limit,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "../firebase.js";
import { esc, toast, confirmDialog, avatar } from "../ui.js";
import { ROLES } from "../data.js";

const TABS = ["users", "videos", "comments", "reports", "sounds", "stats"];

export function adminView(ctx) {
  const html = `
    <div class="view-head">
      <h1>Admin panel</h1>
      <p class="view-sub">Manage users, content, moderation and platform statistics.</p>
    </div>

    <div class="tabs" role="tablist">
      ${TABS.map((t, i) => `<button class="tab ${i === 0 ? "is-active" : ""}" data-tab="${t}">${tabLabel(t)}</button>`).join("")}
    </div>

    <div class="admin-content" id="admin-content">
      <div class="loader-row"><span class="spinner"></span> Loading…</div>
    </div>
  `;

  function tabLabel(t) {
    return { users: "Users", videos: "Videos", comments: "Comments", reports: "Reports", sounds: "Sounds", stats: "Stats" }[t] || t;
  }

  let currentTab = "users";

  async function loadUsers() {
    const content = document.querySelector("#admin-content");
    content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading users…</div>`;
    try {
      const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(60)));
      const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      content.innerHTML = `
        <div class="panel">
          <h2 class="panel-title">${users.length} recent users</h2>
          <div class="admin-list">
            ${users.map((u) => `
              <div class="admin-row" data-uid="${esc(u.uid)}">
                <div class="admin-row-main">
                  ${avatar(u, "sm")}
                  <div>
                    <strong>${esc(u.displayName)}</strong> <em>@${esc(u.username)}</em>
                    <span class="role-badge role-${esc(u.role || "user")}">${esc(u.role || "user")}</span>
                    ${u.verified ? '<span class="verified">✓</span>' : ""}
                    ${u.banned ? '<span class="badge badge-red">Banned</span>' : ""}
                    <br/>
                    <small>${esc(u.email || "")} · ${u.videosCount || 0} videos · ${u.followersCount || 0} followers</small>
                  </div>
                </div>
                <div class="admin-actions">
                  <select data-act="change-role" data-uid="${esc(u.uid)}">
                    ${ROLES.map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}
                  </select>
                  <button class="btn btn-sm ${u.verified ? "btn-outline" : "btn-primary"}" data-act="toggle-verify" data-uid="${esc(u.uid)}">${u.verified ? "Unverify" : "Verify"}</button>
                  <button class="btn btn-sm ${u.banned ? "btn-outline" : "btn-danger"}" data-act="toggle-ban" data-uid="${esc(u.uid)}">${u.banned ? "Unban" : "Ban"}</button>
                  <a class="btn btn-sm btn-ghost" href="#/u/${esc(u.username)}">Profile</a>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      `;

      content.querySelectorAll("[data-act='change-role']").forEach((sel) => {
        sel.addEventListener("change", async () => {
          const uid = sel.dataset.uid;
          const newRole = sel.value;
          if (!ROLES.includes(newRole)) return;
          const ok = await confirmDialog({ title: "Change role?", body: `Set this account to role ${newRole}?`, confirmLabel: "Change" });
          if (!ok) return;
          try {
            await updateDoc(doc(db, "users", uid), { role: newRole });
            toast(`Role updated to ${newRole}`, "success");
          } catch (e) {
            toast(e?.message || "Failed to update role", "error");
          }
        });
      });

      content.querySelectorAll("[data-act='toggle-verify']").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const uid = btn.dataset.uid;
          try {
            const snap = await getDoc(doc(db, "users", uid));
            const current = snap.data()?.verified || false;
            await updateDoc(doc(db, "users", uid), { verified: !current });
            toast(current ? "Unverified" : "Verified", "success");
            btn.textContent = current ? "Verify" : "Unverify";
            btn.classList.toggle("btn-primary", current);
            btn.classList.toggle("btn-outline", !current);
          } catch (e) {
            toast(e?.message || "Failed", "error");
          }
        });
      });

      content.querySelectorAll("[data-act='toggle-ban']").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const uid = btn.dataset.uid;
          const banned = !btn.textContent.trim().startsWith("Unban");
          const ok = await confirmDialog({
            title: banned ? "Ban this account?" : "Unban this account?",
            body: banned ? "The user will be unable to post, comment or follow until unbanned." : "Restore posting rights for this account?",
            confirmLabel: banned ? "Ban account" : "Unban",
            danger: banned,
          });
          if (!ok) return;
          try {
            const { setUserBan } = await import("../data.js");
            await setUserBan(uid, banned);
            toast(banned ? "Account banned" : "Account unbanned", "success");
            btn.textContent = banned ? "Unban" : "Ban";
            btn.classList.toggle("btn-danger", !banned);
            btn.classList.toggle("btn-outline", banned);
          } catch (e) {
            toast(e?.message || "Failed", "error");
          }
        });
      });
    } catch (e) {
      content.innerHTML = `<p class="panel-empty">Failed to load users: ${esc(e?.message || "")}</p>`;
    }
  }

  async function loadVideos() {
    const content = document.querySelector("#admin-content");
    content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading videos…</div>`;
    try {
      const snap = await getDocs(query(collection(db, "videos"), orderBy("createdAt", "desc"), limit(30)));
      const videos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      content.innerHTML = `
        <div class="panel">
          <h2 class="panel-title">${videos.length} recent videos</h2>
          <div class="admin-list">
            ${videos.map((v) => `
              <div class="admin-row" data-video-id="${esc(v.id)}">
                <div class="admin-row-main">
                  ${avatar({ username: v.username, displayName: v.displayName, photoURL: v.photoURL }, "sm")}
                  <div>
                    <strong>@${esc(v.username)}</strong> — ${esc((v.caption || "").slice(0, 80))}
                    <br/><small>❤️ ${v.likeCount || 0} · 💬 ${v.commentCount || 0} · 👁 ${v.viewCount || 0} · <a class="link" href="#/video/${esc(v.id)}">View</a></small>
                  </div>
                </div>
                <button class="btn btn-danger btn-sm" data-act="delete-video" data-video-id="${esc(v.id)}">Delete</button>
              </div>
            `).join("")}
          </div>
        </div>
      `;
      content.querySelectorAll("[data-act='delete-video']").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.videoId;
          const ok = await confirmDialog({ title: "Delete video?", body: "This will permanently remove the video and its comments.", confirmLabel: "Delete", danger: true });
          if (!ok) return;
          try {
            await deleteDoc(doc(db, "videos", id));
            toast("Video deleted", "success");
            btn.closest(".admin-row").remove();
          } catch (e) {
            toast(e?.message || "Failed", "error");
          }
        });
      });
    } catch (e) {
      content.innerHTML = `<p class="panel-empty">Failed: ${esc(e?.message || "")}</p>`;
    }
  }

  async function loadComments() {
    const content = document.querySelector("#admin-content");
    content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading comments…</div>`;
    try {
      // Collection-group query across every video's comments.
      const snap = await getDocs(query(collectionGroup(db, "comments"), orderBy("createdAt", "desc"), limit(60)));
      const comments = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        videoId: d.ref.parent.parent.id,
      }));
      content.innerHTML = `
        <div class="panel">
          <h2 class="panel-title">${comments.length} recent comments</h2>
          <div class="admin-list">
            ${comments.map((c) => `
              <div class="admin-row" data-comment-id="${esc(c.id)}" data-video-id="${esc(c.videoId)}">
                <div class="admin-row-main">
                  ${avatar({ username: c.username, displayName: c.displayName, photoURL: c.photoURL }, "sm")}
                  <div>
                    <strong>${esc(c.displayName || c.username || "User")}</strong> on <a class="link" href="#/video/${esc(c.videoId)}">#/video/${esc(c.videoId)}</a>
                    <br/><small>${esc(c.text || "")}</small>
                  </div>
                </div>
                <button class="btn btn-danger btn-sm" data-act="delete-comment">Delete</button>
              </div>
            `).join("") || `<p class="panel-empty">No comments yet.</p>`}
          </div>
        </div>
      `;
      content.querySelectorAll("[data-act='delete-comment']").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const row = btn.closest(".admin-row");
          const commentId = row.dataset.commentId;
          const videoId = row.dataset.videoId;
          const ok = await confirmDialog({ title: "Delete comment?", body: "Remove this comment permanently?", confirmLabel: "Delete", danger: true });
          if (!ok) return;
          try {
            await deleteDoc(doc(db, "videos", videoId, "comments", commentId));
            toast("Comment deleted", "success");
            row.remove();
          } catch (e) {
            toast(e?.message || "Failed", "error");
          }
        });
      });
    } catch (e) {
      content.innerHTML = `<p class="panel-empty">Failed to load comments: ${esc(e?.message || "collection-group index may need building.")}</p>`;
    }
  }

  async function loadReports() {
    const content = document.querySelector("#admin-content");
    content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading reports…</div>`;
    try {
      const snap = await getDocs(query(collection(db, "reports"), orderBy("createdAt", "desc"), limit(50)));
      const reports = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const open = reports.filter((r) => r.status === "open").length;
      content.innerHTML = `
        <div class="panel">
          <h2 class="panel-title">${reports.length} reports · ${open} open</h2>
          <div class="admin-list">
            ${reports.map((r) => `
              <div class="admin-row ${r.status === "open" ? "is-unread" : ""}" data-report-id="${esc(r.id)}">
                <div class="admin-row-main">
                  <div>
                    <strong>${esc(r.reason || "Report")}</strong>
                    <span class="badge badge-${esc(r.status)}">${esc(r.status)}</span>
                    <br/>
                    <small>For ${esc(r.targetType)} <code>${esc(r.targetId)}</code> · by @${esc(r.reporterUsername || r.reporterUid || "unknown")}</small>
                    ${r.details ? `<br/><small>“${esc(r.details)}”</small>` : ""}
                    ${r.resolvedBy ? `<br/><small>Resolved by ${esc(r.resolvedBy)}</small>` : ""}
                  </div>
                </div>
                <div class="admin-actions">
                  <a class="btn btn-sm btn-ghost" href="${reportTargetHref(r)}">View</a>
                  <button class="btn btn-sm ${r.status === "open" ? "btn-primary" : "btn-outline"}" data-act="resolve" data-report-id="${esc(r.id)}">${r.status === "open" ? "Resolve" : "Reopen"}</button>
                  <button class="btn btn-sm btn-danger" data-act="delete-report" data-report-id="${esc(r.id)}">Delete</button>
                </div>
              </div>
            `).join("") || `<p class="panel-empty">No reports. Keep the platform clean! ✅</p>`}
          </div>
        </div>
      `;

      content.querySelectorAll("[data-act='resolve']").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.reportId;
          const row = btn.closest(".admin-row");
          const isOpen = row.classList.contains("is-unread");
          const { resolveReport } = await import("../data.js");
          try {
            await resolveReport(id, { status: isOpen ? "resolved" : "open", by: ctx.state.profile?.username || "" });
            toast(isOpen ? "Report resolved" : "Report reopened", "success");
            loadReports();
          } catch (e) {
            toast(e?.message || "Failed", "error");
          }
        });
      });

      content.querySelectorAll("[data-act='delete-report']").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.reportId;
          const ok = await confirmDialog({ title: "Delete report?", body: "Remove this report record?", confirmLabel: "Delete", danger: true });
          if (!ok) return;
          try {
            await deleteDoc(doc(db, "reports", id));
            toast("Report deleted", "success");
            btn.closest(".admin-row").remove();
          } catch (e) {
            toast(e?.message || "Failed", "error");
          }
        });
      });
    } catch (e) {
      content.innerHTML = `<p class="panel-empty">Failed to load reports: ${esc(e?.message || "")}</p>`;
    }
  }

  function reportTargetHref(r) {
    if (r.targetType === "video") return `#/video/${esc(r.targetId)}`;
    if (r.targetType === "live") return `#/live/${esc(r.targetId)}`;
    if (r.targetType === "user") return `#/u/${esc(r.targetId)}`;
    if (r.targetType === "sound") return `#/sound/${esc(r.targetId)}`;
    return "#/admin";
  }

  async function loadSounds() {
    const content = document.querySelector("#admin-content");
    content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading sounds…</div>`;
    try {
      const snap = await getDocs(query(collection(db, "sounds"), orderBy("createdAt", "desc"), limit(30)));
      const sounds = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      content.innerHTML = `
        <div class="panel">
          <h2 class="panel-title">${sounds.length} sounds</h2>
          <div class="admin-list">
            ${sounds.map((s) => `
              <div class="admin-row" data-sound-id="${esc(s.id)}">
                <div class="admin-row-main">
                  <div>
                    <strong>${esc(s.title)}</strong> — ${esc(s.artist || "")}
                    <br/><small>${esc(s.genre || "")} · used ${s.useCount || 0} · ${s.isFree ? "free" : "original"}</small>
                  </div>
                </div>
                <button class="btn btn-danger btn-sm" data-act="delete-sound" data-sound-id="${esc(s.id)}">Delete</button>
              </div>
            `).join("")}
          </div>
        </div>
      `;
      content.querySelectorAll("[data-act='delete-sound']").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.soundId;
          const ok = await confirmDialog({ title: "Delete sound?", body: "Remove this sound?", confirmLabel: "Delete", danger: true });
          if (!ok) return;
          try {
            await deleteDoc(doc(db, "sounds", id));
            toast("Sound deleted", "success");
            btn.closest(".admin-row").remove();
          } catch (e) {
            toast(e?.message || "Failed", "error");
          }
        });
      });
    } catch (e) {
      content.innerHTML = `<p class="panel-empty">Failed: ${esc(e?.message || "")}</p>`;
    }
  }

  async function loadStats() {
    const content = document.querySelector("#admin-content");
    content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Computing stats…</div>`;
    const countOf = async (name, lim = 2000) => {
      try {
        const snap = await getDocs(query(collection(db, name), limit(lim)));
        return snap.size;
      } catch {
        return "—";
      }
    };
    try {
      const [users, videos, sounds, reports, lives, notifications, comments] = await Promise.all([
        countOf("users"),
        countOf("videos"),
        countOf("sounds"),
        countOf("reports"),
        countOf("lives"),
        countOf("notifications"),
        getDocs(query(collectionGroup(db, "comments"), limit(2000))).then((s) => s.size).catch(() => "—"),
      ]);

      let openReports = "—";
      let banned = "—";
      try {
        const repSnap = await getDocs(query(collection(db, "reports"), where("status", "==", "open"), limit(2000)));
        openReports = repSnap.size;
      } catch { /* index may not exist */ }
      try {
        const banSnap = await getDocs(query(collection(db, "users"), where("banned", "==", true), limit(2000)));
        banned = banSnap.size;
      } catch { /* index may not exist */ }

      content.innerHTML = `
        <div class="stats-grid">
          ${statCard("Users", users)}
          ${statCard("Videos", videos)}
          ${statCard("Comments", comments)}
          ${statCard("Sounds", sounds)}
          ${statCard("Live broadcasts", lives)}
          ${statCard("Notifications", notifications)}
          ${statCard("Open reports", openReports, openReports && openReports > 0 ? "warn" : "")}
          ${statCard("Banned accounts", banned, banned && banned > 0 ? "warn" : "")}
        </div>
      `;
    } catch (e) {
      content.innerHTML = `<p class="panel-empty">Failed to compute stats: ${esc(e?.message || "")}</p>`;
    }
  }

  function statCard(label, value, tone = "") {
    return `
      <div class="stat-card ${tone ? `stat-${tone}` : ""}">
        <span class="stat-value">${value === "—" ? "—" : esc(value)}</span>
        <span class="stat-label">${esc(label)}</span>
      </div>`;
  }

  return {
    html,
    title: "Admin",
    mount(root) {
      const tabs = root.querySelectorAll(".tabs .tab");
      const loaders = { users: loadUsers, videos: loadVideos, comments: loadComments, reports: loadReports, sounds: loadSounds, stats: loadStats };
      tabs.forEach((t) => {
        t.addEventListener("click", () => {
          tabs.forEach((x) => x.classList.remove("is-active"));
          t.classList.add("is-active");
          currentTab = t.dataset.tab;
          loaders[currentTab]?.();
        });
      });
      loadUsers();
    },
  };
}
