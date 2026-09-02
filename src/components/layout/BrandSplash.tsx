import { useEffect, useRef, useState } from 'react';
import { BRAND } from '@/lib/constants';

/**
 * Global application boot splash.
 *
 * A premium, GPU-friendly opening: small particles drift in from every edge,
 * converge and "form" the real Seedwel Hub wordmark, which then sharpens with a
 * soft glow before the whole layer fades away to reveal the application.
 *
 * Sequence:  Particles → Logo formation → Seedwel Hub → Application
 *
 * We sample the actual `/brand/wordmarklogo.png` asset on a tiny offscreen
 * canvas so the particles truly trace the letterforms (no CSS, no recreated
 * vector) and then cross-fade in the same image once they have mostly landed.
 *
 * `prefers-reduced-motion` is honoured: the particle pass is skipped and the
 * wordmark simply fades in, so the experience is never more than a gentle
 * cross-fade for users who disable motion.
 */

const SAMPLE_WIDTH = 360; // Offscreen sampling resolution (kept low for speed).
const MIN_PARTICLES = 110;
const MAX_PARTICLES = 240;
const CONVERGE_AFTER = 0.9; // Fraction that must land before the logo reveals.
const MAX_CONVERGE_MS = 3200; // Hard stop — never keep users waiting.
const REVEAL_HOLD_MS = 520; // How long the sharp wordmark glows before exiting.
const EXIT_MS = 460;

type Phase = 'converge' | 'reveal' | 'exit';

interface Particle {
  x: number;
  y: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  delay: number;
  duration: number;
  size: number;
  color: string;
  wobble: number;
  phase: number;
  arrived: boolean;
}

const COLORS = ['#0f766e', '#1fa292', '#40bcac', '#0b3d3a', '#f59e0b'];

/** Read exact pixel geometry from a PNG header without a decoding dependency. */
function pngSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const dv = new DataView(buf);
        if (dv.getUint32(0) !== 0x89504e47) {
          reject(new Error('Not a PNG'));
          return;
        }
        resolve({ w: dv.getUint32(16), h: dv.getUint32(20) });
      })
      .catch(reject);
  });
}

export function BrandSplash({ onDone, label = 'Loading Seedwel Hub…' }: {
  onDone?: () => void;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const [phase, setPhase] = useState<Phase>('converge');
  const [formed, setFormed] = useState(false);
  const phaseRef = useRef<Phase>('converge');
  const formedRef = useRef(false);

  const transition = (p: Phase, f: boolean) => {
    phaseRef.current = p;
    formedRef.current = f;
    setPhase(p);
    setFormed(f);
  };

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const stage = wrapRef.current;
    const canvas = canvasRef.current;
    const img = imgRef.current;

    if (!stage || !canvas || !img) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let raf = 0;
    let visible = true;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = stage.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /** Load the wordmark into its own offscreen image so sampling never races
     *  the displayed element's load event. */
    function loadImageEl(src: string): Promise<HTMLImageElement> {
      return new Promise((resolve, reject) => {
        if (!img) { reject(new Error('no img')); return; }
        const im = new Image();
        im.decoding = 'async';
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error(`could not load ${src}`));
        im.src = src;
      });
    }

    /** Sample the wordmark into target points (normalised 0..1). */
    async function buildTargets(): Promise<{ x: number; y: number }[]> {
      const imgEl = await loadImageEl('/brand/wordmarklogo.png');
      const { w: iw, h: ih } = await pngSize('/brand/wordmarklogo.png');
      const scale = SAMPLE_WIDTH / iw;
      const sw = SAMPLE_WIDTH;
      const sh = Math.max(1, Math.round(ih * scale));

      const off = document.createElement('canvas');
      off.width = sw;
      off.height = sh;
      const octx = off.getContext('2d');
      if (!octx) return [];
      octx.drawImage(imgEl, 0, 0, sw, sh);

      let data: ImageData;
      try {
        data = octx.getImageData(0, 0, sw, sh);
      } catch {
        return [];
      }

      const points: { x: number; y: number }[] = [];
      const step = 2; // Every 2nd pixel → dense but cheap point cloud.
      for (let y = 0; y < sh; y += step) {
        for (let x = 0; x < sw; x += step) {
          const i = (y * sw + x) * 4;
          const r = data.data[i];
          const g = data.data[i + 1];
          const b = data.data[i + 2];
          // Skip the near-white background; keep navy/green letterforms and
          // the grey tagline so particles sketch the whole lockup.
          if (r > 228 && g > 228 && b > 228) continue;
          points.push({ x: x / sw, y: y / sh });
        }
      }
      return points;
    }

    function spawnParticles(points: { x: number; y: number }[]): Particle[] {
      const aspect = 4.98; // 1080 × 217
      const boxW = Math.min(width * 0.86, 760);
      const boxH = boxW / aspect;
      const boxX = (width - boxW) / 2;
      const boxY = (height - boxH) / 2;

      const count = Math.max(
        MIN_PARTICLES,
        Math.min(MAX_PARTICLES, Math.floor(points.length * 0.9)),
      );

      const particles: Particle[] = [];
      for (let i = 0; i < count; i++) {
        const p = points[Math.floor(Math.random() * points.length)] ?? { x: 0.5, y: 0.5 };
        const tx = boxX + p.x * boxW;
        const ty = boxY + p.y * boxH;

        const edge = Math.floor(Math.random() * 4);
        let sx = 0;
        let sy = 0;
        if (edge === 0) { sx = -20; sy = Math.random() * height; }
        else if (edge === 1) { sx = width + 20; sy = Math.random() * height; }
        else if (edge === 2) { sx = Math.random() * width; sy = -20; }
        else { sx = Math.random() * width; sy = height + 20; }

        particles.push({
          x: sx,
          y: sy,
          sx,
          sy,
          tx,
          ty,
          delay: Math.random() * 0.9,
          duration: 1.1 + Math.random() * 1.3,
          size: 1 + Math.random() * 2.4,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          wobble: Math.random() * Math.PI * 2,
          phase: Math.random() * Math.PI * 2,
          arrived: false,
        });
      }
      return particles;
    }

    let particles: Particle[] = [];
    let startTime = 0;
    let revealedAt = 0;
    let finished = false;

    const finishExit = () => {
      if (finished) return;
      finished = true;
      if (doneRef.current) doneRef.current();
      else if (stage) stage.style.display = 'none';
    };

    const tick = (now: number) => {
      const p = phaseRef.current;
      if (p === 'exit' || !visible) return;
      if (!startTime) startTime = now;
      const elapsed = now - startTime;

      ctx.clearRect(0, 0, width, height);

      if (p === 'converge') {
        let arrived = 0;
        const t = elapsed / 1000;
        for (const pt of particles) {
          const local = Math.max(0, Math.min(1, (t - pt.delay) / pt.duration));
          const eased = 1 - Math.pow(1 - local, 3);
          const arc = Math.sin(pt.wobble + local * 3) * 18 * (1 - local);
          pt.x = pt.sx + (pt.tx - pt.sx) * eased + arc;
          pt.y = pt.sy + (pt.ty - pt.sy) * eased + Math.cos(pt.wobble + local * 3) * 14 * (1 - local);
          pt.arrived = local >= 1;
          if (pt.arrived) arrived++;

          const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(t * 3 + pt.phase));
          ctx.globalAlpha = pt.arrived ? 0.9 : twinkle * 0.85;
          ctx.fillStyle = pt.color;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        const progress = particles.length ? arrived / particles.length : 1;
        if (progress >= CONVERGE_AFTER || elapsed > MAX_CONVERGE_MS) {
          transition('reveal', true);
          revealedAt = now;
        }
      } else if (p === 'reveal') {
        const fade = Math.max(0, 1 - (now - revealedAt) / 240);
        for (const pt of particles) {
          ctx.globalAlpha = 0.85 * fade;
          ctx.fillStyle = pt.color;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        if (now - revealedAt > REVEAL_HOLD_MS) {
          transition('exit', true); // keep the sharp wordmark visible while fading.
          setTimeout(finishExit, EXIT_MS);
          return;
        }
      }

      raf = requestAnimationFrame(tick);
    };

    const reducedFade = () => {
      transition('reveal', true);
      setTimeout(() => {
        transition('exit', true);
        setTimeout(finishExit, EXIT_MS);
      }, REVEAL_HOLD_MS);
    };

    resize();
    const onResize = () => resize();
    let cancelled = false;

    (async () => {
      let points: { x: number; y: number }[] = [];
      try {
        points = await buildTargets();
      } catch {
        points = [];
      }
      if (cancelled) return;
      // If the user disables motion, or the wordmark could not be sampled,
      // fall back to a gentle cross-fade so the app is never held hostage.
      if (reduce || points.length === 0) {
        reducedFade();
        return;
      }
      particles = spawnParticles(points);
      raf = requestAnimationFrame(tick);
    })();

    const onVis = () => {
      visible = document.visibilityState === 'visible';
    };

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      finishExit();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={wrapRef}
      role="status"
      aria-label={`${BRAND.name} is loading`}
      data-phase={phase}
      className={`brsplash fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-white via-[#eef7f4] to-[#dff0ec] transition-opacity duration-500 ${
        phase === 'exit' ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[52vmin] w-[52vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-200/50 blur-3xl" />
      </div>

      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full transition-opacity duration-300 ${formed ? 'opacity-0' : 'opacity-100'}`}
      />

      <img
        ref={imgRef}
        src="/brand/wordmarklogo.png"
        alt={BRAND.name}
        width={1080}
        height={217}
        className={`relative z-10 block w-[min(86vw,600px)] object-contain transition-all duration-500 ease-out ${
          formed
            ? 'scale-100 opacity-100 drop-shadow-[0_10px_30px_rgba(15,118,110,0.25)]'
            : 'scale-[0.965] opacity-0 drop-shadow-none'
        }`}
        draggable={false}
      />

      <p
        className={`relative z-10 mt-6 text-center text-sm font-semibold tracking-wide text-brand-800/80 transition-opacity duration-500 ${
          formed ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {label}
      </p>

      <span className="sr-only">{BRAND.name} is loading</span>
    </div>
  );
}

/** Compact branded loader used as the per-route lazy/session fallback. */
export function BrandLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-white px-6">
      <img
        src="/brand/wordmarklogo.png"
        alt={BRAND.name}
        width={1080}
        height={217}
        className="block w-[min(72vw,320px)] object-contain"
        draggable={false}
      />
      <div className="flex items-center justify-center gap-2">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-600" />
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-400 [animation-delay:120ms]" />
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent-400 [animation-delay:240ms]" />
        <span className="ml-2 text-sm font-semibold text-ink-500">{label}</span>
      </div>
    </div>
  );
}
