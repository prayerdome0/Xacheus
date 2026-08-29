/** Xacheus — public community and opportunity directories. */
import { collection, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "../firebase.js";
import { esc, timeAgo } from "../ui.js";

export function directoryView(ctx, kind = "opportunities") {
  const isChurch = kind === "churches";
  const title = isChurch ? "Churches & communities" : "Opportunities";
  const description = isChurch ? "Find churches and communities sharing sermons, events and updates." : "Discover jobs, services and opportunities shared on Xacheus.";
  const html = `<div class="view-head"><h1>${title}</h1><p class="view-sub">${description}</p></div><div id="directory-list"><div class="loader-row"><span class="spinner"></span> Loading…</div></div>`;
  return { html, title, mount(root) { load(root); } };

  async function load(root) {
    try {
      const snap = await getDocs(query(collection(db, kind), orderBy("createdAt", "desc"), limit(50)));
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const content = root.querySelector("#directory-list");
      if (!items.length) {
        content.innerHTML = `<section class="panel"><div class="panel-empty"><strong>${isChurch ? "No communities listed yet" : "No opportunities listed yet"}</strong><p>${isChurch ? "Churches and community organisations will appear here as the directory grows." : "New opportunities will appear here as they are published."}</p></div></section>`;
        return;
      }
      content.innerHTML = `<div class="directory-grid">${items.map((item) => `<article class="panel directory-card"><div class="directory-icon">${isChurch ? "⛪" : "✨"}</div><h2>${esc(item.name || item.title || "Untitled")}</h2><p>${esc(item.description || item.bio || item.summary || "Discover more on Xacheus.")}</p><small>${esc(item.location || item.category || "Zambia")} · ${timeAgo(item.createdAt)}</small>${item.website ? `<a class="btn btn-outline btn-sm" href="${esc(item.website)}" target="_blank" rel="noopener">Learn more</a>` : ""}</article>`).join("")}</div>`;
    } catch (error) {
      root.querySelector("#directory-list").innerHTML = `<section class="panel"><p class="panel-empty">This directory is temporarily unavailable. ${esc(error?.message || "")}</p></section>`;
    }
  }
}
