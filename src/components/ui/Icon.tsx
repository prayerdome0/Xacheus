import type { SVGProps } from 'react';

/**
 * Inline icon set.
 *
 * Hand-rolled rather than pulling an icon package: Seedwel Hub ships to phones
 * on slow connections, so the icon budget is part of the JS bundle and must
 * stay tiny. 24×24 viewBox, 1.8 stroke, currentColor.
 */

export type IconName =
  | 'home' | 'search' | 'cart' | 'receipt' | 'user' | 'store' | 'box' | 'chart'
  | 'wallet' | 'tag' | 'truck' | 'users' | 'file' | 'bell' | 'settings' | 'star'
  | 'heart' | 'plus' | 'minus' | 'close' | 'check' | 'chevronRight' | 'chevronLeft'
  | 'chevronDown' | 'chevronUp' | 'menu' | 'filter' | 'sort' | 'grid' | 'list'
  | 'camera' | 'barcode' | 'qr' | 'scan' | 'share' | 'whatsapp' | 'mail' | 'phone'
  | 'map' | 'clock' | 'calendar' | 'download' | 'upload' | 'print' | 'edit'
  | 'trash' | 'copy' | 'eye' | 'eyeOff' | 'lock' | 'shield' | 'sparkles' | 'send'
  | 'arrowRight' | 'arrowLeft' | 'arrowUp' | 'arrowDown' | 'refresh' | 'external'
  | 'info' | 'warning' | 'alert' | 'success' | 'loading' | 'invoice' | 'quote'
  | 'cash' | 'card' | 'bank' | 'mobile' | 'robot' | 'building' | 'package'
  | 'dashboard' | 'signature' | 'history' | 'logout' | 'more' | 'link' | 'image'
  | 'video' | 'flag' | 'gift' | 'fire' | 'target' | 'megaphone' | 'book'
  | 'briefcase' | 'pin' | 'globe' | 'sun' | 'leaf';

const PATHS: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20a1 1 0 0 0 1 1h4v-6h3v6h4a1 1 0 0 0 1-1V9.5',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35',
  cart: 'M2.5 3h2l2.6 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 7H6M9.5 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  receipt: 'M6 2.5h12v19l-2.5-1.6L13 21.5l-2.5-1.6L8 21.5 6 19.9V2.5ZM9 7.5h6M9 11h6M9 14.5h4',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  store: 'M3.5 9.5V20a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1V9.5M2.5 9.5 4.7 4.2A1 1 0 0 1 5.6 3.5h12.8a1 1 0 0 1 .9.7l2.2 5.3M2.5 9.5h19M9.5 21v-6h5v6',
  box: 'M21 8.5 12 3 3 8.5m18 0v7L12 21 3 15.5v-7m18 0L12 14m0 0L3 8.5M12 14v7',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  wallet: 'M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1M3 7.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3M3 7.5h16.5M22 10.5v4h-5a2 2 0 0 1 0-4h5Z',
  tag: 'M20.6 13.4 12 22l-9-9V3.5h9.5l8.1 8.1a1.4 1.4 0 0 1 0 1.8ZM7.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z',
  truck: 'M2.5 6.5h11v10h-11zM13.5 10h4l3 3v3.5h-7M6 20a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Zm11.5 0a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  file: 'M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5.5ZM14 2.5V8h5M9 13h6M9 17h4',
  bell: 'M18 8.5a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5a8 8 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2-1.2L15 2.5h-4l-.5 2.6a8 8 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a8 8 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2 1.2l.5 2.6h4l.5-2.6a8 8 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  star: 'm12 2.8 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6 6.2 20.7l1.1-6.5L2.6 9.6l6.5-.9L12 2.8Z',
  heart: 'M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 0 0 0-7.1Z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M18 6 6 18M6 6l12 12',
  check: 'm20 6-11 11-5-5',
  chevronRight: 'm9 18 6-6-6-6',
  chevronLeft: 'm15 18-6-6 6-6',
  chevronDown: 'm6 9 6 6 6-6',
  chevronUp: 'm18 15-6-6-6 6',
  menu: 'M3 6h18M3 12h18M3 18h18',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  sort: 'M4 7h10M4 12h7M4 17h4M17 5v14m0 0 3-3m-3 3-3-3',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  camera: 'M4 7.5h3L8.5 5h7L17 7.5h3a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1Zm8 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  barcode: 'M3 5v14M6.5 5v14M10 5v10M13.5 5v14M17 5v10M20.5 5v14',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
  scan: 'M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M3 12h18',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3m0 0L8 7m4-4 4 4',
  whatsapp: 'M3.5 20.5 5 16.4A8 8 0 1 1 8 19.3l-4.5 1.2ZM9 9.2c0 3 2.5 5.3 5 5.8.6.1 1.3-.4 1.5-1l-.1-1.2-2-.6-.8.8a6 6 0 0 1-2.4-2.5l.8-.7-.6-2-1.3-.2c-.6.2-1.1.9-1 1.6Z',
  mail: 'M3.5 5.5h17v13h-17zM3.5 6.5 12 13l8.5-6.5',
  phone: 'M6.5 3h3l1.5 4.5-2 1.5a12 12 0 0 0 6 6l1.5-2L21 14.5v3a2 2 0 0 1-2.2 2A17.5 17.5 0 0 1 3.5 5.2 2 2 0 0 1 5.5 3h1Z',
  map: 'M9 3.5 3 5.5v15l6-2 6 2 6-2v-15l-6 2-6-2Zm0 0v15m6-13v15',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2',
  calendar: 'M4 6.5h16v14H4zM4 10.5h16M8.5 3v4M15.5 3v4',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3',
  upload: 'M12 16V4m0 0L8 8m4-4 4 4M4 17v3h16v-3',
  print: 'M7 9V3.5h10V9M7 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14.5h10V21H7z',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z',
  trash: 'M3.5 6h17M8.5 6V4h7v2M6 6l1 14.5h10L18 6M10 10v7M14 10v7',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff: 'M10.6 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.3 6.5A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.3-1M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M5 11h14v10H5zM8 11V7.5a4 4 0 0 1 8 0V11',
  shield: 'M12 22s8-3.5 8-9.5V5.5L12 2.5 4 5.5v7C4 18.5 12 22 12 22Zm-3-11 2.2 2.2L15.5 9',
  sparkles: 'm12 3 1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Zm6.5 10 .9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3ZM5 15l.7 1.8L7.5 17.5l-1.8.7L5 20l-.7-1.8L2.5 17.5l1.8-.7L5 15Z',
  send: 'M21.5 2.5 11 13M21.5 2.5 15 21.5l-4-8.5-8.5-4 19-6.5Z',
  arrowRight: 'M4 12h16m0 0-6-6m6 6-6 6',
  arrowLeft: 'M20 12H4m0 0 6-6m-6 6 6 6',
  arrowUp: 'M12 20V4m0 0-6 6m6-6 6 6',
  arrowDown: 'M12 4v16m0 0 6-6m-6 6-6-6',
  refresh: 'M20.5 12a8.5 8.5 0 1 1-2.5-6M20.5 3.5V9H15',
  external: 'M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01',
  warning: 'M12 3 1.8 20.5h20.4L12 3Zm0 6v5m0 3h.01',
  alert: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v6m0 3h.01',
  success: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-3.5-9 2.5 2.5 4.5-5',
  loading: 'M12 3v4m0 10v4M3 12h4m10 0h4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8',
  invoice: 'M7 2.5h10v19l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5V2.5ZM9.5 7h5M9.5 10.5h5M9.5 14h3',
  quote: 'M6.5 5.5h11v13h-11zM4 8v11h13M9 9.5h5M9 13h3',
  cash: 'M2.5 6.5h19v11h-19zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 10v4M18 10v4',
  card: 'M2.5 5.5h19v13h-19zM2.5 10h19M6 14.5h3',
  bank: 'M3 10h18L12 3.5 3 10ZM5 10v8m4-8v8m6-8v8m4-8v8M3 21h18',
  mobile: 'M7 2.5h10v19H7zM11 18.5h2',
  robot: 'M5 8h14v11H5zM9 12.5h.01M15 12.5h.01M9.5 16h5M12 4v4M8 19v2m8-2v2M3 12h2m14 0h2',
  building: 'M4 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16M13 10h6a1 1 0 0 1 1 1v10M7 8h3M7 12h3M7 16h3M16 14h1M16 18h1M2 21h20',
  package: 'M12 2.5 3 7v10l9 4.5 9-4.5V7l-9-4.5ZM3 7l9 4.5L21 7M12 11.5V21.5',
  dashboard: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  signature: 'M3 17c3 0 3-8 6-8s2 6 4 6 2-4 4-4 2 3 4 3M3 21h18',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3 4v5h5M12 8v4.5l3 1.8',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  link: 'M10 13.5a4 4 0 0 0 5.7.3l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.4 1.5M14 10.5a4 4 0 0 0-5.7-.3l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.4-1.5',
  image: 'M3.5 4.5h17v15h-17zM3.5 15.5l5-5 4 4 3-3 5 5M9 9.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z',
  video: 'M3 6.5h12v11H3zM15 10.5l6-3.5v10l-6-3.5',
  flag: 'M5 21V4m0 0h11l-1.5 3.5L16 11H5',
  gift: 'M3.5 9.5h17V21h-17zM3.5 14h17M12 9.5V21M12 9.5S10.5 4 8 4a2.5 2.5 0 0 0 0 5.5M12 9.5S13.5 4 16 4a2.5 2.5 0 0 1 0 5.5',
  fire: 'M12 22a6.5 6.5 0 0 0 6.5-6.5c0-4-3-5.5-3-9.5-2 1.5-2.5 3.5-2.5 5 0-2-1.5-3.5-3-4.5.5 2.5-1 4-2.5 5.5A6.5 6.5 0 0 0 12 22Z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  megaphone: 'M3.5 10.5v3a1 1 0 0 0 1 1H8l9 5V5L8 10H4.5a1 1 0 0 0-1 1ZM19.5 9a4 4 0 0 1 0 6M7 15v5h3',
  book: 'M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5v-15ZM4 16.5h15M8 7h7M8 10.5h5',
  briefcase: 'M3 7.5h18v12H3zM8.5 7.5V5a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 5v2.5M3 12.5h18',
  pin: 'M12 21.5s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3.5 9.5h17M3.5 14.5h17M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v3m0 16v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M1 12h3m16 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  leaf: 'M20 4C9 4 4 8.5 4 16v4M4 20c8 0 14-4 16-16M9 15c2-3 5-5 8-6',
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  filled?: boolean;
}

export function Icon({ name, size = 20, filled = false, className = '', ...rest }: IconProps) {
  const d = PATHS[name] ?? PATHS.info;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}

/** Emoji-in-a-box, used for the category grid and dashboard tiles. */
export function EmojiIcon({ emoji, size = 20, className = '' }: { emoji?: string | null; size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center leading-none select-none ${className}`}
      style={{ fontSize: size }}
      aria-hidden="true"
    >
      {emoji || '📦'}
    </span>
  );
}

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      className={`animate-spin ${className}`} aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.6" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
