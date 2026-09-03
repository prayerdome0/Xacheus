import { useEffect, useState } from 'react';
import { fetchList, type DbWhere } from '@/lib/db';
import type { Category } from '@/types';

/**
 * Marketplace category tree (Firestore `categories`).
 *
 * Loaded once per session and cached in memory + localStorage: categories are
 * platform reference data, they change rarely and every screen needs them.
 */

const CACHE_KEY = 'seedwel-categories-v1';
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;

interface Cache { at: number; rows: Category[] }

let memoryCache: Category[] | null = null;
let inflight: Promise<Category[]> | null = null;

function readCache(): Category[] | null {
  if (memoryCache) return memoryCache;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cache;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    memoryCache = parsed.rows;
    return parsed.rows;
  } catch {
    return null;
  }
}

function writeCache(rows: Category[]) {
  memoryCache = rows;
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows })); } catch { /* ignore */ }
}

export async function loadCategories(force = false): Promise<Category[]> {
  if (!force) {
    const cached = readCache();
    if (cached) return cached;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const rows = await fetchList<Category>('categories', {
        where: [['is_active', '==', true] as DbWhere],
        orderByField: 'sort_order', orderDir: 'asc', limit: 300,
      });
      // Stable secondary sort by name (two server orderBys would need a
      // composite index; client-side tiebreak keeps it index-free).
      rows.sort((a, b) =>
        (Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)) || (a.name ?? '').localeCompare(b.name ?? ''),
      );
      writeCache(rows);
      return rows;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Could not load categories.');
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useCategories(kind?: 'product' | 'service' | 'both') {
  const [categories, setCategories] = useState<Category[]>(() => readCache() ?? []);
  const [loading, setLoading] = useState(!readCache());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadCategories()
      .then((rows) => { if (alive) { setCategories(rows); setLoading(false); } })
      .catch((e: Error) => { if (alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  const filtered = kind
    ? categories.filter((c) => c.kind === kind || c.kind === 'both')
    : categories;

  const topLevel = filtered.filter((c) => !c.parent_id);
  const childrenOf = (id: string) => filtered.filter((c) => c.parent_id === id);
  const bySlug = (slug: string) => filtered.find((c) => c.slug === slug) ?? null;
  const byId = (id: string) => filtered.find((c) => c.id === id) ?? null;
  /** A category and every descendant — used by "search within a category". */
  const withDescendants = (id: string): string[] => {
    const out = [id];
    const walk = (parentId: string) => {
      filtered.filter((c) => c.parent_id === parentId).forEach((c) => { out.push(c.id); walk(c.id); });
    };
    walk(id);
    return out;
  };

  return {
    categories: filtered, topLevel, loading, error,
    childrenOf, bySlug, byId, withDescendants,
    refresh: () => loadCategories(true).then(setCategories),
  };
}
