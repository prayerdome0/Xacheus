/**
 * Xacheus — Saved.
 *
 * `#/saved` is linked from the account menu on every profile, so it has to be
 * a real screen rather than a hash that silently falls through to the feed.
 *
 * Two things live here, both read from Firestore:
 *   - everything you tapped Save on (`users/{uid}/savedVideos/{videoId}`), and
 *   - your named collections (`users/{uid}/savedCollections/{id}`), which you
 *     can create, rename-by-recreating, delete, and move posts into.
 *
 * Collections are cosmetic organisation on top of the flat save flag: removing
 * a post from a collection does not unsave it.
 */

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { db } from "../firebase.js";
import { watchSavedVideos } from "../data.js";
import {
  createSavedCollection,
  deleteSavedCollection,
  listSavedCollections,
  removeFromCollection,
  saveToCollection,
} from "../social.js";
import { confirmDialog, emptyState, esc, closeModal, openModal, timeAgo, toast } from "../ui.js";
import { videoCardHtml, bindVideoActions, hydrateVideoStates } from "./components.js";

export function savedView(ctx) {
  let tab = "all";
  let unsubSaved = null;
  let savedVideos = [];
  let collections = [];
  let activeCollection = null;

  const html = `
    <div class="view-head">
      <div>
        <h1>Saved</h1>
        <p class="view-sub">Posts you kept for later, and the collections you filed them into.</p>
      </div>
      <div class="notif-tools">
        <button class="btn btn-outline btn-sm" type="button" data-act="new-collection">New collection</button>
      </div>
    </div>

    <nav class="tabs" role="tablist">
      <button class="tab is-active" type="button" data-tab="all">All saved</button>
      <button class="tab" type="button" data-tab="collections">Collections</button>
    </nav>

    <div class="saved-content" id="saved-content">
      <div class="loader-row"><span class="spinner"></span> Loading saved posts…</div>
    </div>
  `;

  async function loadCollections() {
    collections = await listSavedCollections(ctx.state.profile.uid).catch(() => []);
  }

  function renderAll(root) {
    const content = root.querySelector("#saved-content");
    if (!content) return;
    if (!savedVideos.length) {
      content.innerHTML = emptyState(
        "🔖",
        "Nothing saved yet",
        "Tap Save on any post and it lands here — even after a refresh or on another device.",
        '<a class="btn btn-primary btn-sm" href="#/discover">Find something to save</a>'
      );
      return;
    }
    content.innerHTML = `<div class="saved-feed">${savedVideos.map((v) => videoCardHtml(v, { myUid: ctx.state.profile?.uid || "" })).join("")}</div>`;
    savedVideos.forEach((v) => ctx.videoCache.set(v.id, v));
    hydrateVideoStates(content, ctx.state.profile?.uid);
  }

  async function renderCollections(root) {
    const content = root.querySelector("#saved-content");
    if (!content) return;
    await loadCollections();
    if (!collections.length) {
      content.innerHTML = emptyState(
        "🗂️",
        "No collections",
        "Collections group your saved posts — one for sermons, one for recipes, one for gigs.",
        '<button class="btn btn-primary btn-sm" type="button" data-act="new-collection">Create a collection</button>'
      );
      return;
    }
    content.innerHTML = `<div class="collection-grid">${collections
      .map(
        (c) => `
        <button class="collection-card" type="button" data-collection="${esc(c.id)}">
          <span class="collection-name">${esc(c.name || "Collection")}</span>
          <em>${c.count || 0} ${c.count === 1 ? "post" : "posts"} · ${esc(timeAgo(c.createdAt))}</em>
        </button>`
      )
      .join("")}</div>`;

    content.querySelectorAll("[data-collection]").forEach((btn) => {
      btn.addEventListener("click", () => openCollection(root, btn.dataset.collection));
    });
  }

  function openCollection(root, id) {
    const collection = collections.find((c) => c.id === id);
    if (!collection) return;
    activeCollection = collection;
    openModal({
      title: collection.name || "Collection",
      size: "md",
      body: `<div class="loader-row"><span class="spinner"></span> Loading…</div>`,
      onMount: async (modal) => {
        const items = await listCollectionItems(id);
        const posts = (items || []).map((i) => savedVideos.find((v) => v.id === i.videoId)).filter(Boolean);
        modal.querySelector(".modal-body").innerHTML = `
          <div class="modal-actions modal-actions--split">
            <button class="btn btn-ghost btn-sm" type="button" data-act="rename">Rename</button>
            <button class="btn btn-ghost btn-sm danger-text" type="button" data-act="del-collection">Delete collection</button>
          </div>
          ${
            posts.length
              ? `<div class="collection-posts">${posts
                  .map(
                    (v) => `
                  <div class="collection-post">
                    <a class="collection-post-link" href="#/video/${esc(v.id)}">${esc((v.caption || "Post").slice(0, 90))}</a>
                    <button class="btn btn-ghost btn-sm" type="button" data-remove="${esc(v.id)}">Remove</button>
                  </div>`
                  )
                  .join("")}</div>`
              : `<p class="panel-empty">Nothing in this collection yet. Save a post, then choose “Add to collection”.</p>`
          }`;

        modal.querySelector('[data-act="del-collection"]')?.addEventListener("click", async () => {
          const ok = await confirmDialog({
            title: "Delete this collection?",
            body: "The collection is removed. The posts inside it stay saved to your account.",
            confirmLabel: "Delete",
            danger: true,
          });
          if (!ok) return;
          try {
            await deleteSavedCollection(ctx.state.profile.uid, id);
            toast("Collection deleted", "success");
            closeModalAndRefresh(root);
          } catch (err) {
            toast(err?.message || "Could not delete that", "error");
          }
        });

        modal.querySelector('[data-act="rename"]')?.addEventListener("click", () => {
          askForName(collection.name || "").then(async (name) => {
            if (!name) return;
            try {
              await deleteSavedCollection(ctx.state.profile.uid, id);
              const created = await createSavedCollection(ctx.state.profile.uid, name);
              for (const v of posts) await saveToCollection(ctx.state.profile.uid, v.id, created.id).catch(() => {});
              toast("Collection renamed", "success");
              closeModalAndRefresh(root);
            } catch (err) {
              toast(err?.message || "Could not rename that", "error");
            }
          });
        });

        modal.querySelectorAll("[data-remove]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            try {
              await removeFromCollection(ctx.state.profile.uid, btn.dataset.remove, id);
              toast("Removed from this collection", "success");
              closeModalAndRefresh(root, true);
            } catch (err) {
              toast(err?.message || "Could not remove that", "error");
              btn.disabled = false;
            }
          });
        });
      },
    });
  }

  function closeModalAndRefresh(root) {
    closeModal(true);
    renderCollections(root);
  }

  async function listCollectionItems(id) {
    const snap = await getDocs(collection(db, "users", ctx.state.profile.uid, "savedCollections", id, "items")).catch(() => null);
    return snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  }

  function askForName(current = "") {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      openModal({
        title: "Name your collection",
        size: "sm",
        body: `
          <form id="col-form">
            <label class="field">
              <span>Name</span>
              <input type="text" id="col-name" maxlength="40" required value="${esc(current)}" placeholder="Sermons, recipes, gigs…" />
            </label>
            <div class="modal-actions">
              <button class="btn btn-ghost" type="button" data-act="cancel">Cancel</button>
              <button class="btn btn-primary" type="submit">Save</button>
            </div>
          </form>`,
        onMount(root, close) {
          root.querySelector("#col-name")?.focus();
          root.querySelector('[data-act="cancel"]').addEventListener("click", () => {
            finish(null);
            close();
          });
          root.querySelector("#col-form").addEventListener("submit", (event) => {
            event.preventDefault();
            const value = root.querySelector("#col-name").value.trim();
            finish(value);
            close();
          });
        },
        onClose() {
          finish(null);
        },
      });
    });
  }

  return {
    html,
    title: "Saved",
    async mount(root) {
      root.querySelectorAll("[data-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
          tab = btn.dataset.tab;
          root.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("is-active", b === btn));
          if (tab === "all") renderAll(root);
          else renderCollections(root);
        });
      });

      root.addEventListener("click", async (event) => {
        const trigger = event.target.closest('[data-act="new-collection"]');
        if (!trigger) return;
        const name = await askForName();
        if (!name) return;
        try {
          await createSavedCollection(ctx.state.profile.uid, name);
          toast(`Collection “${name}” created`, "success");
          tab = "collections";
          root.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === "collections"));
          renderCollections(root);
        } catch (err) {
          toast(err?.message || "Could not create that", "error");
        }
      });

      bindVideoActions(root, ctx);
      unsubSaved = watchSavedVideos(ctx.state.profile.uid, (videos) => {
        savedVideos = videos;
        if (tab === "all") renderAll(root);
      });
    },
    destroy() {
      unsubSaved?.();
      activeCollection = null;
    },
  };
}
