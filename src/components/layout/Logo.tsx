import { Link } from 'react-router-dom';
import { BRAND } from '@/lib/constants';

/**
 * Brand lockups.
 *
 * The real Seedwel Hub logo assets live at:
 *   /brand/reallogo.png     — the green "C" growth mark (used in the header/nav)
 *   /brand/wordmarklogo.png — the full "SEEDWEL HUB — BUY. SELL. MANAGE. GROW."
 *                             wordmark (used for the loading animation and as a
 *                             document watermark).
 *
 * The header/navigation intentionally uses the standalone mark + wordmark
 * typography rather than the wide wordmark image, exactly as specified. The
 * wordmark image is reserved for the boot animation and document watermarking.
 */

const MARK_SRC = '/brand/reallogo.png';
const WORDMARK_SRC = '/brand/wordmarklogo.png';

export function Logo({ to = '/', height = 34, dark = false, showLine = false, className = '' }: {
  to?: string | null; height?: number; dark?: boolean; showLine?: boolean; className?: string;
}) {
  const textColor = dark ? 'text-white' : 'text-ink-900';
  const mark = (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img
        src={MARK_SRC}
        alt=""
        height={height}
        width={height}
        className="block shrink-0 object-contain"
        style={{ height }}
        loading="eager"
        decoding="async"
      />
      <span className={`flex flex-col leading-none ${textColor}`}>
        <span className="font-display text-[1.02em] font-extrabold tracking-tight" style={{ fontSize: height * 0.42 }}>
          {BRAND.name}
        </span>
        {showLine && (
          <span className={`mt-0.5 text-[10px] font-semibold leading-tight ${dark ? 'text-white/70' : 'text-ink-500'}`}>
            {BRAND.companyLine}
          </span>
        )}
      </span>
    </span>
  );

  if (!to) return mark;
  return <Link to={to} aria-label={`${BRAND.name} home`} className="inline-flex shrink-0">{mark}</Link>;
}

export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src={MARK_SRC}
      alt=""
      width={size}
      height={size}
      className={`block rounded-xl object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function Wordmark({ className = '', height = 40 }: { className?: string; height?: number }) {
  return (
    <img
      src={WORDMARK_SRC}
      alt={BRAND.name}
      width={1080}
      height={217}
      style={{ height }}
      className={`block object-contain ${className}`}
      draggable={false}
    />
  );
}

export function BrandLockup({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <img
        src={MARK_SRC}
        alt=""
        width={64}
        height={64}
        className="block rounded-2xl object-contain"
        style={{ width: 64, height: 64 }}
      />
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
