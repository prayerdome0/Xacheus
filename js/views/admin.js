/** Xacheus — Admin panel (visible only if role == admin) */

import { getDocs, query, collection, orderBy, limit, doc, updateDoc, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "../firebase.js";
import { esc, toast, confirmDialog } from "../ui.js";
import { ROLES } from "../data.js";

export function adminView(ctx) {
  const html = `
    <div class="view-head">
      <h1>Admin panel</h1>
      <p class="view-sub">Manage users, videos, sounds. Only visible if Firestore role equals "admin".</p>
    </div>

    <div class="tabs" role="tablist">
      <button class="tab is-active" data-tab="users">Users</button>
      <button class="tab" data-tab="videos">Videos</button>
      <button class="tab" data-tab="sounds">Sounds</button>
      <button class="tab" data-tab="reports">Reports</button>
    </div>

    <div class="admin-content" id="admin-content">
      <div class="loader-row"><span class="spinner"></span> Loading…</div>
    </div>
  `;

  let currentTab = "users";

  async function loadUsers() {
    const content = document.querySelector("#admin-content");
    content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading users…</div>`;
    try {
      const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(50)));
      const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      content.innerHTML = `
        <div class="panel">
          <h2 class="panel-title">${users.length} recent users</h2>
          <div class="admin-list">
            ${users.map((u) => `
              <div class="admin-row" data-uid="${esc(u.uid)}">
                <div>
                  <strong>${esc(u.displayName)}</strong> <em>@${esc(u.username)}</em>
                  <span class="role-badge role-${esc(u.role || "user")}">${esc(u.role || "user")}</span>
                  ${u.verified ? '<span class="verified">✓</span>' : ""}
                  <br/>
                  <small>${esc(u.email || "")} · ${u.videosCount || 0} videos · ${u.followersCount || 0} followers</small>
                </div>
                <div class="admin-actions">
                  <select data-act="change-role" data-uid="${esc(u.uid)}">
                    ${ROLES.map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}
                  </select>
                  <button class="btn btn-sm ${u.verified ? "btn-outline" : "btn-primary"}" data-act="toggle-verify" data-uid="${esc(u.uid)}">${u.verified ? "Unverify" : "Verify"}</button>
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
          const ok = await confirmDialog({ title: "Change role?", body: `Set user ${uid} to role ${newRole}?`, confirmLabel: "Change" });
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
                <div>
                  <strong>@${esc(v.username)}</strong> — ${esc((v.caption || "").slice(0, 80))}
                  <br/><small>❤️ ${v.likeCount || 0} · 💬 ${v.commentCount || 0} · <a class="link" href="#/video/${esc(v.id)}">View</a></small>
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
          const ok = await confirmDialog({ title: "Delete video?", body: "This will permanently remove the video.", confirmLabel: "Delete", danger: true });
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

  async function loadReports() {
    const content = document.querySelector("#admin-content");
    content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading reports…</div>`;
    try {
      const snap = await getDocs(query(collection(db, "reports"), orderBy("createdAt", "desc"), limit(50)));
      const reports = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      content.innerHTML = `<div class="panel"><h2 class="panel-title">${reports.length} recent reports</h2><div class="admin-list">
        ${reports.length ? reports.map((r) => `<div class="admin-row" data-report-id="${esc(r.id)}">
          <div><strong>${esc(r.targetType)} · ${esc(r.reason)}</strong><br/><small>Target: ${esc(r.targetId)} · Status: ${esc(r.status || "open")}</small></div>
          <button class="btn btn-outline btn-sm" data-act="resolve-report" data-report-id="${esc(r.id)}">Resolve</button>
        </div>`).join("") : `<p class="panel-empty">No reports yet.</p>`}
      </div></div>`;
      content.querySelectorAll("[data-act='resolve-report']").forEach((btn) => btn.addEventListener("click", async () => {
        try {
          await updateDoc(doc(db, "reports", btn.dataset.reportId), { status: "resolved" });
          btn.textContent = "Resolved";
          btn.disabled = true;
          toast("Report resolved", "success");
        } catch (e) { toast(e?.message || "Could not resolve report", "error"); }
      }));
    } catch (e) { content.innerHTML = `<p class="panel-empty">Failed to load reports: ${esc(e?.message || "")}</p>`; }
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
                <div>
                  <strong>${esc(s.title)}</strong> — ${esc(s.artist || "")}
                  <br/><small>${esc(s.genre || "")} · used ${s.useCount || 0} · ${s.isFree ? "free" : "original"}</small>
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

  return {
    html,
    title: "Admin",
    mount(root) {
      const tabs = root.querySelectorAll(".tabs .tab");
      tabs.forEach((t) => {
        t.addEventListener("click", () => {
          tabs.forEach((x) => x.classList.remove("is-active"));
          t.classList.add("is-active");
          currentTab = t.dataset.tab;
          if (currentTab === "users") loadUsers();
          else if (currentTab === "videos") loadVideos();
          else if (currentTab === "sounds") loadSounds();
          else if (currentTab === "reports") loadReports();
        });
      });
      loadUsers();
    },
  };
}
