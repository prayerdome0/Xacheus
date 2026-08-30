/**
 * Xacheus — Music layer.
 *
 * The only music Xacheus plays is music it is allowed to play. This module
 * talks to the Internet Archive's advanced search + metadata APIs, which
 * expose thousands of CC-licensed and public-domain releases with the licence
 * recorded per item (`licenseurl`). Nothing here is hard-coded demo audio:
 *
 *   search  https://archive.org/advancedsearch.php  (Solr, JSON + JSONP)
 *   tracks  https://archive.org/metadata/{identifier}
 *   audio   https://archive.org/download/{identifier}/{file}
 *   art     https://archive.org/services/img/{identifier}
 *
 * CORS on archive.org is inconsistent for `fetch`, so every request has a
 * JSONP fallback (`callback=` is supported on both JSON endpoints).
 *
 * This module never writes to Firestore — it's a pure provider so it can be
 * unit-tested without a Firebase app. Persistence lives in js/data.js
 * (`sounds` docs for user uploads) and in js/views/music.js.
 */

const SEARCH_ENDPOINT = "https://archive.org/advancedsearch.php";
const METADATA_ENDPOINT = "https://archive.org/metadata";
const DOWNLOAD_ENDPOINT = "https://archive.org/download";
const DETAILS_ENDPOINT = "https://archive.org/details";
const ARTWORK_ENDPOINT = "https://archive.org/services/img";

/**
 * Collections we search. `netlabels` is a curated home for Creative Commons
 * netlabels (so results are music, not audiobooks); `audio_music` widens the
 * pool while the licence filter below keeps reuse safe.
 */
const COLLECTIONS = "netlabels OR audio_music";

/** Licences that let us stream a track and attach it to a Xacheus post. */
export const REUSABLE_LICENSES = Object.freeze([
  "http://creativecommons.org/publicdomain/zero/1.0/",
  "http://creativecommons.org/publicdomain/mark/1.0/",
  "http://creativecommons.org/licenses/by/3.0/",
  "http://creativecommons.org/licenses/by/4.0/",
  "http://creativecommons.org/licenses/by-sa/3.0/",
  "http://creativecommons.org/licenses/by-sa/4.0/",
]);

export const CATALOGUE_PROVIDER = {
  id: "archive_org",
  name: "Internet Archive — Netlabels",
  homepage: "https://archive.org/details/netlabels",
  terms: "https://archive.org/about/terms.php",
  licenceNote:
    "Every track streamed here is published by the Internet Archive with an open licence (Creative Commons or public domain). Xacheus shows the licence and a link back to the original item on every player and post.",
};

/** Browse chips — matched as text, which archive.org indexes well. */
export const CATALOGUE_MOODS = Object.freeze([
  { id: "ambient", label: "Ambient" },
  { id: "lofi", label: "Lo-fi" },
  { id: "electronic", label: "Electronic" },
  { id: "jazz", label: "Jazz" },
  { id: "classical", label: "Classical" },
  { id: "folk", label: "Folk" },
  { id: "hip hop", label: "Hip hop" },
  { id: "rock", label: "Rock" },
  { id: "instrumental", label: "Instrumental" },
  { id: "worship", label: "Worship" },
]);

/**
 * Verified starting points for the first run of the app: real items, in the
 * collections above, whose `/metadata/` listings contain MP3 files. These are
 * only *entry points* — titles, artists and the actual track list are fetched
 * from the live item at runtime, so nothing here is a fake song name.
 */
export const SEED_ITEMS = Object.freeze([
  { identifier: "NicolasFalcon-NicolasFalconaaahh011", note: "Nicolas Falcon — aaahh (Netlabel Home, CC BY 3.0)" },
  { identifier: "breaknorth", note: "Breaknorth — self-titled (Open Music No.163 partner release)" },
  { identifier: "onmp163", note: "Open Music No.163 — compilation" },
  { identifier: "BLUnderwood_Geo_Sync_Deluxe", note: "B.L. Underwood — Geo Sync Deluxe" },
  { identifier: "gt536Maelstrom-ThePassage", note: "Maelstrom — The Passage (CC0)" },
  { identifier: "gt458SteamFlow-WithTrainsAndBones", note: "SteamFlow — With Trains and Bones (CC0)" },
  { identifier: "gt459AnchoreState-ChangesOfLifeEp", note: "Anchore State — Changes of Life EP (CC0)" },
  { identifier: "elevatormusic", note: "Elevator Music — label catalogue" },
  { identifier: "shoki005g", note: "Shoki — release 005" },
  { identifier: "NS050", note: "Netlabel collective — various artists (listen-only: BY-NC)" },
]);

/** Errors that should be surfaced to the user rather than silently swallowed. */
export class CatalogueError extends Error {
  constructor(message, { status = 0, retriable = false } = {}) {
    super(message);
    this.name = "CatalogueError";
    this.status = status;
    this.retriable = retriable;
  }
}

/* ------------------------------------------------------------------ */
/* transport: fetch first, JSONP when CORS says no                    */
/* ------------------------------------------------------------------ */

const CACHE_TTL_MS = 30 * 60 * 1000;
const inflight = new Map();
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 80) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

function jsonp(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const cb = `xacheusCb_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      reject(new CatalogueError("The music catalogue took too long to answer.", { retriable: true }));
    }, timeout);

    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    }

    window[cb] = (data) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new CatalogueError("Couldn't reach the music catalogue.", { retriable: true }));
    };
    const sep = url.includes("?") ? "&" : "?";
    script.src = `${url}${sep}callback=${cb}`;
    document.head.appendChild(script);
  });
}

async function getJson(url) {
  const key = url;
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    try {
      const res = await fetch(url, { mode: "cors", cache: "no-store", headers: { Accept: "application/json" } });
      if (!res.ok) {
        if (res.status === 429) {
          throw new CatalogueError("The catalogue is rate-limiting us — try again in a minute.", { status: 429, retriable: true });
        }
        throw new CatalogueError(`Catalogue request failed (${res.status}).`, { status: res.status, retriable: res.status >= 500 });
      }
      return await res.json();
    } catch (err) {
      // Network/CORS failure: retry the same endpoint through JSONP.
      try {
        return await jsonp(url);
      } catch {
        throw err instanceof CatalogueError ? err : new CatalogueError("Couldn't reach the music catalogue. Check your connection.", { retriable: true });
      }
    }
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

/* ------------------------------------------------------------------ */
/* search                                                             */
/* ------------------------------------------------------------------ */

/** Keep the query Solr-safe: words, digits and hyphens only. */
function sanitiseTerms(text) {
  return String(text || "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function buildQuery({ text = "", licenceOnly = true } = {}) {
  const parts = ["mediatype:(audio)", `collection:(${COLLECTIONS})`];
  const terms = sanitiseTerms(text);
  if (terms) parts.unshift(`(${terms.split(" ").map((w) => `"${w}"`).join(" AND ")})`);
  if (licenceOnly) {
    parts.push(`licenseurl:(${REUSABLE_LICENSES.map((l) => `"${l}"`).join(" OR ")})`);
  }
  return parts.join(" AND ");
}

const SORTS = {
  popular: ["downloads desc"],
  new: ["created desc"],
  relevant: ["score desc"],
};

/**
 * Search the catalogue. Returns release-level results (`items`), because that
 * is how archive.org organises music; call `loadItemTracks()` to expand one
 * item into playable, individually licensed tracks.
 */
export async function searchCatalogue({ text = "", page = 1, rows = 12, sort = "popular", licenceOnly = true } = {}) {
  const params = new URLSearchParams();
  params.set("q", buildQuery({ text, licenceOnly }));
  for (const field of ["identifier", "title", "creator", "description", "licenseurl", "downloads", "created", "year"]) {
    params.append("fl[]", field);
  }
  for (const s of SORTS[sort] || SORTS.popular) {
    const [field, dir] = s.split(" ");
    params.append("sort[]", `${field} ${dir}`);
  }
  params.set("rows", String(Math.min(30, Math.max(1, rows))));
  params.set("page", String(Math.max(1, page)));
  params.set("output", "json");

  const url = `${SEARCH_ENDPOINT}?${params.toString()}`;
  const cached = cacheGet(url);
  if (cached) return cached;

  const body = await getJson(url);
  const response = body?.response || {};
  const items = (response.docs || []).map((doc) => ({
    identifier: doc.identifier,
    title: cleanTitle(doc.title, doc.identifier),
    creator: normaliseArray(doc.creator).filter(Boolean).join(", ") || "Unknown artist",
    year: doc.year || "",
    description: stripHtml(normaliseArray(doc.description)[0] || ""),
    licenseUrl: normaliseArray(doc.licenseurl)[0] || "",
    downloads: Number(doc.downloads) || 0,
    itemUrl: `${DETAILS_ENDPOINT}/${doc.identifier}`,
    artwork: `${ARTWORK_ENDPOINT}/${doc.identifier}`,
  }));

  const result = { items, total: Number(response.numFound) || 0, page, rows, query: sanitiseTerms(text) };
  cacheSet(url, result);
  return result;
}

function cleanTitle(title, identifier) {
  const first = normaliseArray(title)[0];
  if (first && String(first).trim()) return String(first).trim().slice(0, 160);
  return String(identifier || "Untitled");
}

function normaliseArray(value) {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).filter((v) => v != null && String(v).trim() !== "");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

/* ------------------------------------------------------------------ */
/* item -> tracks                                                     */
/* ------------------------------------------------------------------ */

function parseLength(value) {
  const str = String(value || "").trim();
  if (!str) return 0;
  if (/^\d+(\.\d+)?$/.test(str)) return Math.round(parseFloat(str));
  const parts = str.split(":").map((p) => Number(p) || 0);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length >= 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

/**
 * Metadata for one item: its file list, filtered to what browsers can decode
 * (MP3 / VBR MP3), sorted by the `track` number the uploader supplied.
 */
export async function loadItemTracks(identifier) {
  if (!identifier) return { item: null, tracks: [] };
  const url = `${METADATA_ENDPOINT}/${encodeURIComponent(identifier)}`;
  const cached = cacheGet(url);
  if (cached) return cached;

  const body = await getJson(url);
  const meta = body?.d || {};
  if (!meta.identifier) {
    throw new CatalogueError("That archive.org item no longer exists.", { status: 404 });
  }

  const licenceUrl = normaliseArray(meta.licenseurl)[0] || "";
  const licence = describeLicence(licenceUrl);
  const artists = normaliseArray(meta.creator).filter(Boolean).join(", ") || normaliseArray(meta.artist).join(", ") || "";
  const album = cleanTitle(meta.title, meta.identifier);
  const year = meta.year || (String(meta.date || "").slice(0, 4) || "");

  const files = normaliseArray(meta.files)
    .filter((f) => f && typeof f.name === "string" && f.name.toLowerCase().endsWith(".mp3"))
    .filter((f) => !/(sample|preview|speech|_meta)\b/i.test(f.name))
    .map((f) => {
      const track = Number(f.track) || 0;
      const title = String(f.title || "").trim() || prettyName(f.name);
      const duration = parseLength(f.length);
      const size = Number(f.size) || 0;
      return {
        id: `${meta.identifier}/${f.name}`,
        identifier: meta.identifier,
        file: f.name,
        title: title.slice(0, 160),
        artist: String(f.artist || "").trim() || artists || album,
        album,
        year,
        track,
        duration,
        size,
        genre: normaliseArray(f.genre).join(", ") || normaliseArray(meta.genre).join(", "),
        audioUrl: `${DOWNLOAD_ENDPOINT}/${encodeURIComponent(meta.identifier)}/${encodeURIComponent(f.name)}`,
        itemUrl: `${DETAILS_ENDPOINT}/${meta.identifier}`,
        artwork: `${ARTWORK_ENDPOINT}/${meta.identifier}`,
        licenseUrl: licenceUrl,
        licence,
        source: CATALOGUE_PROVIDER.id,
      };
    });

  const seen = new Set();
  const tracks = files
    .filter((t) => {
      const key = `${t.title}|${t.artist}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.track || 999) - (b.track || 999) || a.file.localeCompare(b.file));

  const result = {
    item: {
      identifier: meta.identifier,
      title: album,
      creator: artists || album,
      licenceUrl,
      licence,
      description: stripHtml(normaliseArray(meta.description)[0] || ""),
      itemUrl: `${DETAILS_ENDPOINT}/${meta.identifier}`,
      artwork: `${ARTWORK_ENDPOINT}/${meta.identifier}`,
      year,
      downloads: Number(meta.downloads) || 0,
      trackCount: tracks.length,
    },
    tracks,
  };
  cacheSet(url, result);
  return result;
}

function prettyName(fileName) {
  return String(fileName)
    .replace(/\.mp3$/i, "")
    .replace(/^\s*\d+[\s._-]+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Expand several items at once (used by the browse grid and the seeds). */
export async function loadManyTracks(identifiers, { perItem = 4 } = {}) {
  const results = await Promise.all(
    identifiers.filter(Boolean).map(async (identifier) => {
      try {
        const { item, tracks } = await loadItemTracks(identifier);
        return { item, tracks: tracks.slice(0, perItem) };
      } catch {
        return null;
      }
    })
  );
  return results.filter((r) => r && r.tracks.length);
}

/** The seeds, expanded into real playable tracks with real credits. */
export async function loadSeedTracks({ perItem = 3 } = {}) {
  return loadManyTracks(
    SEED_ITEMS.map((s) => s.identifier),
    { perItem }
  );
}

/* ------------------------------------------------------------------ */
/* licences                                                           */
/* ------------------------------------------------------------------ */

/**
 * Human-readable licence info. `reusable` decides whether Xacheus may attach
 * the track to a post; `commercial` is shown to the user so credit is honest.
 */
export function describeLicence(licenseurl) {
  const url = String(licenseurl || "").trim();
  if (!url) {
    return {
      id: "unknown",
      label: "All rights reserved (no open licence recorded)",
      url: "",
      reusable: false,
      commercial: false,
      note: "The archive item doesn't declare an open licence, so Xacheus only links to it — it can't be attached to a post.",
    };
  }
  const lower = url.toLowerCase();
  const match = lower.match(/licenses\/([a-z-]+)\/([0-9.]+)/);
  const kind = match ? match[1] : "";
  const version = match ? match[2] : "";

  if (lower.includes("publicdomain/zero") || lower.includes("publicdomain/mark")) {
    return {
      id: lower.includes("mark") ? "PDM" : "CC0",
      label: lower.includes("mark") ? "Public Domain Mark 1.0" : "CC0 1.0 Universal (public domain)",
      url,
      reusable: true,
      commercial: true,
      note: "Public domain — free to play, remix and attach to posts. Credit is still shown.",
    };
  }
  if (!kind) {
    return {
      id: "custom",
      label: "Custom archive.org licence terms",
      url,
      reusable: false,
      commercial: false,
      note: "Read the item page before reusing this recording anywhere beyond Xacheus.",
    };
  }

  const nonCommercial = kind.includes("nc");
  const noDerivs = kind.includes("nd");
  const shareAlike = kind.includes("sa");
  const label = `CC ${kind.toUpperCase()} ${version}`.trim();

  return {
    id: kind.toUpperCase(),
    label,
    url,
    reusable: !nonCommercial && !noDerivs,
    commercial: !nonCommercial,
    note: nonCommercial
      ? "Attribution-required, non-commercial: you can listen here, but Xacheus won't attach this to a post."
      : shareAlike
        ? "Attribution + ShareAlike: reusable with credit, and any remix must carry the same licence."
        : "Attribution: reusable with credit. Xacheus adds the credit automatically.",
  };
}

/**
 * The credit line shown next to the player and baked into a post, so a
 * third-party recording never looks like Xacheus content.
 */
export function attributionLine(track) {
  if (!track) return "";
  const artist = track.artist || "Unknown artist";
  const album = track.album ? ` — ${track.album}` : "";
  const licence = track.licence?.label ? ` · ${track.licence.label}` : "";
  return `"${track.title}" by ${artist}${album}${licence}. Source: Internet Archive.`;
}

/* ------------------------------------------------------------------ */
/* attaching catalogue tracks to posts                                 */
/* ------------------------------------------------------------------ */

/**
 * A catalogue track that gets attached to a post is *also* stored as a real
 * `sounds/{id}` document. That's what makes use counts, favourites and the
 * sound pages work off live data instead of a second, fake catalogue. The
 * document records provenance (`sourceId`, `sourceUrl`, `licenceUrl`) and the
 * importing user's uid as `artistUid` — the original credit is kept in `artist`.
 */
export function trackToSoundDoc(track) {
  const licence = track.licence || describeLicence(track.licenseUrl);
  return {
    title: track.title,
    artist: track.artist,
    album: track.album || "",
    genre: track.genre || "",
    audioUrl: track.audioUrl,
    duration: Number(track.duration) || 0,
    useCount: 0,
    playCount: 0,
    isOriginal: false,
    verified: false,
    archived: false,
    deleted: false,
    source: CATALOGUE_PROVIDER.id,
    sourceId: track.identifier,
    sourceUrl: track.itemUrl,
    licenceUrl: licence.url || track.licenseUrl || "",
    licenceLabel: licence.label,
    licenceReusable: Boolean(licence.reusable),
    external: true,
    createdAt: new Date(),
  };
}

export function soundToTrack(sound) {
  return {
    id: sound.id,
    identifier: sound.sourceId || "",
    file: sound.sourceFile || "",
    title: sound.title || "",
    artist: sound.artist || "",
    album: sound.album || "",
    year: sound.year || "",
    track: 0,
    duration: Number(sound.duration) || 0,
    genre: sound.genre || "",
    audioUrl: sound.audioUrl || "",
    itemUrl: sound.sourceUrl || "",
    artwork: sound.identifier ? `${ARTWORK_ENDPOINT}/${sound.sourceId}` : sound.coverUrl || "",
    licenseUrl: sound.licenceUrl || "",
    licence: describeLicence(sound.licenceUrl),
    source: sound.source || "xacheus",
    useCount: Number(sound.useCount) || 0,
    playCount: Number(sound.playCount) || 0,
    isFavorite: Boolean(sound.isFavorite),
    isOwner: Boolean(sound.isOwner),
    external: Boolean(sound.external),
  };
}

/** id used for `sounds/{id}` docs derived from a catalogue track. */
export function soundIdForTrack(track) {
  return `archive_${track.identifier}_${track.file}`
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}
