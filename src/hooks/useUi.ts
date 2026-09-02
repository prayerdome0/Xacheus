import { useCallback, useEffect, useRef, useState } from 'react';

/** Debounce any fast-changing value (search-as-you-type). */
export function useDebounce<T>(value: T, delay = 320): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Geolocation for "businesses / products / services near me". */
export interface GeoState {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  loading: boolean;
  error: string | null;
  granted: boolean;
  locate: () => Promise<void>;
  clear: () => void;
}

export function useGeolocation(auto = false): GeoState {
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState(false);

  const locate = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Location is not available in this browser.');
      return;
    }
    setLoading(true);
    setError(null);
    await new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLat(pos.coords.latitude);
          setLng(pos.coords.longitude);
          setAccuracy(pos.coords.accuracy);
          setGranted(true);
          setLoading(false);
          resolve();
        },
        (err) => {
          const messages: Record<number, string> = {
            1: 'Location permission was denied. You can still search by city or region.',
            2: 'Your position could not be determined. Try again or search by city.',
            3: 'Finding your position took too long. Try again.',
          };
          setError(messages[err.code] ?? 'Location unavailable.');
          setLoading(false);
          resolve();
        },
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 },
      );
    });
  }, []);

  const clear = useCallback(() => {
    setLat(null); setLng(null); setAccuracy(null); setGranted(false); setError(null);
  }, []);

  useEffect(() => { if (auto) void locate(); }, [auto, locate]);

  return { lat, lng, accuracy, loading, error, granted, locate, clear };
}

/** Infinite scroll for the marketplace grids. */
export function useInfiniteScroll(onLoadMore: () => void, opts: { enabled?: boolean; rootMargin?: string } = {}) {
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || opts.enabled === false) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) onLoadMore(); },
      { rootMargin: opts.rootMargin ?? '400px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onLoadMore, opts.enabled, opts.rootMargin]);

  return sentinel;
}

/** Media query hook (used to switch between mobile and desktop layouts). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');

/** Lock body scroll while a modal or sheet is open. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active]);
}

/** Close on Escape; used by every modal, sheet and dropdown. */
export function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onClose]);
}

/** Swipe left/right detection for the mobile list rows. */
export function useSwipe(onLeft?: () => void, onRight?: () => void, threshold = 60) {
  const startX = useRef<number | null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0]?.clientX ?? null;
  }, []);
  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (startX.current === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - startX.current;
    if (dx <= -threshold) onLeft?.();
    else if (dx >= threshold) onRight?.();
    startX.current = null;
  }, [onLeft, onRight, threshold]);
  return { onTouchStart, onTouchEnd };
}

/** Persist a small piece of UI state (filters, view mode) per user. */
export function useLocalState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch { return initial; }
  });
  const set = useCallback((v: T | ((p: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [key]);
  return [value, set];
}
