import { Link } from 'react-router-dom';
import { BRAND } from '@/lib/constants';

/**
 * Brand lockups.
 *
 * The wordmark (/brand/wordmark.png) is the real Seedwel Hub logo recovered
 * from the project's asset history; /brand/mark-512.png is the standalone
 * mark used in tight spaces (favicon, bottom nav, app icon).
 */

export function Logo({ to = '/', height = 34, dark = false, showLine = false, className = '' }: {
  to?: string | null; height?: number; dark?: boolean; showLine?: boolean; className?: string;
}) {
  const src = dark ? '/brand/wordmark-dark.png' : '/brand/wordmark.png';
  const mark = (
    <span className={`inline-flex flex-col items-start ${className}`}>
      <img
        src={src}
        alt={BRAND.name}
        height={height}
        width={height * 4.35}
        className="block object-contain"
        style={{ height }}
        loading="eager"
        decoding="async"
      />
      {showLine && (
        <span className={`mt-0.5 text-[10px] font-semibold leading-tight ${dark ? 'text-white/70' : 'text-ink-500'}`}>
          {BRAND.companyLine}
        </span>
      )}
    </span>
  );

  if (!to) return mark;
  return <Link to={to} aria-label={`${BRAND.name} home`} className="inline-flex shrink-0">{mark}</Link>;
}

export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/brand/mark-512.png"
      alt=""
      width={size}
      height={size}
      className={`block rounded-xl object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function BrandLockup({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <LogoMark size={64} />
      <div>
        <p className={`font-display text-2xl font-extrabold ${dark ? 'text-white' : 'text-ink-950'}`}>
          {BRAND.name}
        </p>
        <p className={`text-sm ${dark ? 'text-white/70' : 'text-ink-500'}`}>{BRAND.tagline}</p>
        <p className={`mt-1 text-[11px] font-medium ${dark ? 'text-white/50' : 'text-ink-400'}`}>
          {BRAND.companyLine}
        </p>
      </div>
    </div>
  );
}
