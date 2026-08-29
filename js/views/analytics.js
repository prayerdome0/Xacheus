/** Xacheus — lightweight creator analytics from first-party Firestore counters. */
import { collection, getDocs, limit, orderBy, query, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "../firebase.js";
import { esc, formatCount, timeAgo } from "../ui.js";

export function analyticsView(ctx) {
  const profile = ctx.state.profile;
  const html = `<div class="view-head"><h1>Creator analytics</h1><p class="view-sub">Understand how your content is performing.</p></div><div id="analytics-root"><div class="loader-row"><span class="spinner"></span> Loading analytics…</div></div>`;
  return { html, title: "Analytics", mount(root) { load(root); } };

  async function load(root) {
    if (!profile) return;
    try {
      const snap = await getDocs(query(collection(db, "videos"), where("uid", "==", profile.uid), orderBy("createdAt", "desc"), limit(100)));
      const videos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const totals = videos.reduce((a, v) => ({ views: a.views + Number(v.viewCount || 0), likes: a.likes + Number(v.likeCount || 0), comments: a.comments + Number(v.commentCount || 0), shares: a.shares + Number(v.shareCount || 0) }), { views: 0, likes: 0, comments: 0, shares: 0 });
      const engagement = totals.views ? ((totals.likes + totals.comments + totals.shares) / totals.views * 100).toFixed(1) : "0.0";
      root.querySelector("#analytics-root").innerHTML = `<div class="analytics-grid">
        ${[["Views", totals.views], ["Likes", totals.likes], ["Comments", totals.comments], ["Shares", totals.shares]].map(([label, value]) => `<section class="panel analytics-stat"><strong>${formatCount(value)}</strong><span>${label}</span></section>`).join("")}
      </div><section class="panel"><h2 class="panel-title">Overview</h2><div class="setting-row"><div class="setting-main"><div><strong>Engagement rate</strong><em>Likes, comments and shares divided by views.</em></div></div><strong>${engagement}%</strong></div><div class="setting-row"><div class="setting-main"><div><strong>Followers</strong><em>Total audience following your account.</em></div></div><strong>${formatCount(profile.followersCount || 0)}</strong></div></section>
      <section class="panel"><h2 class="panel-title">Top posts</h2><div class="admin-list">${videos.slice().sort((a,b) => (b.viewCount||0)-(a.viewCount||0)).slice(0,10).map((v) => `<div class="admin-row"><div><strong>${esc((v.caption || "Untitled post").slice(0, 80))}</strong><br><small>${formatCount(v.viewCount || 0)} views · ${formatCount(v.likeCount || 0)} likes · ${timeAgo(v.createdAt)}</small></div><a class="btn btn-outline btn-sm" href="#/video/${esc(v.id)}">View</a></div>`).join("") || `<p class="panel-empty">Post your first video to see performance here.</p>`}</div></section>`;
    } catch (error) {
      root.querySelector("#analytics-root").innerHTML = `<div class="panel"><p class="panel-empty">Analytics are temporarily unavailable. ${esc(error?.message || "")}</p></div>`;
    }
  }
}
