import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, Spinner } from './Icon';
import { Button } from './Primitives';
import { useEscape, useScrollLock } from '@/hooks/useUi';
import { useToast } from '@/context/ToastContext';

/* ── Modal ─────────────────────────────────────────────────────────────────── */

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', closeOnBackdrop = true }: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  closeOnBackdrop?: boolean;
}) {
  useScrollLock(open);
  useEscape(open, onClose);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const focusable = panel.current?.querySelector<HTMLElement>(
      'input, select, textarea, button:not([data-no-autofocus]), [href]',
    );
    focusable?.focus({ preventScroll: true });
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const sizes = {
    sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-6xl',
  } as const;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-ink-950/50 backdrop-blur-[2px] animate-fade"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Dialog'}
        className={`relative w-full ${sizes[size]} max-h-[92dvh] overflow-hidden rounded-t-3xl sm:rounded-2xl bg-white shadow-pop animate-slide-up sm:animate-rise`}
      >
        {(title || subtitle) && (
          <header className="flex items-start justify-between gap-3 border-b border-ink-200 px-4 py-3.5 sm:px-5">
            <div className="min-w-0">
              {title && <h2 className="text-base font-bold truncate">{title}</h2>}
              {subtitle && <p className="text-xs text-ink-500 mt-0.5">{subtitle}</p>}
            </div>
            <button
              type="button" onClick={onClose} data-no-autofocus
              className="-mr-1 rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
              aria-label="Close"
            >
              <Icon name="close" size={18} />
            </button>
          </header>
        )}
        <div className="max-h-[calc(92dvh-8rem)] overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer && (
          <footer className="border-t border-ink-200 bg-ink-50/60 px-4 py-3 pb-safe sm:px-5">
            <div className="flex flex-wrap items-center justify-end gap-2">{footer}</div>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ── Confirm dialog ────────────────────────────────────────────────────────── */

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  requireText?: string;
  busy?: boolean;
}

export function ConfirmDialog({ options, onConfirm, onCancel }: {
  options: ConfirmOptions | null;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => { setTyped(''); setBusy(false); }, [options]);

  const run = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };

  const blocked = Boolean(options?.requireText) && typed.trim() !== options?.requireText;

  return (
    <Modal
      open={Boolean(options)}
      onClose={busy ? () => {} : onCancel}
      title={options?.title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {options?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={options?.tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            onClick={() => void run()}
            disabled={blocked}
            loading={busy}
          >
            {options?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      {options?.message && <div className="text-sm text-ink-600">{options.message}</div>}
      {options?.requireText && (
        <div className="mt-4">
          <label className="sh-field-label">
            Type <span className="font-mono font-bold text-ink-900">{options.requireText}</span> to confirm
          </label>
          <input
            className="sh-input" value={typed} onChange={(e) => setTyped(e.target.value)}
            placeholder={options.requireText} autoComplete="off"
          />
        </div>
      )}
    </Modal>
  );
}

/** Imperative confirm hook: const ok = await confirm({ title, message }) */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = (opts: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolver.current = resolve;
    setOptions(opts);
  });

  const handleConfirm = async () => {
    setOptions(null);
    resolver.current?.(true);
    resolver.current = null;
  };
  const handleCancel = () => {
    setOptions(null);
    resolver.current?.(false);
    resolver.current = null;
  };

  const element = <ConfirmDialog options={options} onConfirm={handleConfirm} onCancel={handleCancel} />;
  return { confirm, element };
}

/* ── Bottom sheet (mobile) / popover ───────────────────────────────────────── */

export function Sheet({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  useScrollLock(open);
  useEscape(open, onClose);
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] lg:hidden">
      <div className="absolute inset-0 bg-ink-950/50 animate-fade" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog" aria-modal="true"
        className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-hidden rounded-t-3xl bg-white shadow-pop animate-slide-up"
      >
        <div className="flex justify-center pt-2.5">
          <span className="h-1.5 w-10 rounded-full bg-ink-300" aria-hidden="true" />
        </div>
        {title && (
          <div className="flex items-center justify-between gap-3 px-4 pt-2 pb-2">
            <h2 className="text-base font-bold truncate">{title}</h2>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100" aria-label="Close">
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        <div className="max-h-[calc(88dvh-7rem)] overflow-y-auto px-4 pb-4">{children}</div>
        {footer && <div className="border-t border-ink-200 px-4 py-3 pb-safe">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface ActionItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  hint?: string;
}

/** Action list rendered inside a Sheet on phones and a Modal on desktop. */
export function ActionSheet({ open, onClose, title, items }: {
  open: boolean; onClose: () => void; title?: string; items: ActionItem[];
}) {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const list = (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.label}>
          <button
            type="button"
            disabled={item.disabled}
            onClick={() => { item.onSelect(); onClose(); }}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] font-medium transition-colors disabled:opacity-40 ${
              item.tone === 'danger' ? 'text-red-700 hover:bg-red-50' : 'text-ink-800 hover:bg-ink-100'
            }`}
          >
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${
              item.tone === 'danger' ? 'bg-red-100' : 'bg-brand-50 text-brand-700'
            }`}>
              {item.icon ?? <Icon name="chevronRight" size={17} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{item.label}</span>
              {item.hint && <span className="block text-xs font-normal text-ink-500 truncate">{item.hint}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  if (desktop) {
    return (
      <Modal open={open} onClose={onClose} title={title} size="sm">
        {list}
      </Modal>
    );
  }
  return <Sheet open={open} onClose={onClose} title={title}>{list}</Sheet>;
}

/* ── Toast viewport ────────────────────────────────────────────────────────── */

export function ToastViewport() {
  const { toasts, dismiss } = useToast();
  if (typeof document === 'undefined' || toasts.length === 0) return null;

  const tones = {
    success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    error: 'border-red-300 bg-red-50 text-red-900',
    info: 'border-sky-300 bg-sky-50 text-sky-900',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
  } as const;
  const icons = { success: 'success', error: 'alert', info: 'info', warning: 'warning' } as const;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[90] flex flex-col items-center gap-2 px-3 pt-3 sm:pt-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto w-full max-w-md animate-slide-up rounded-2xl border p-3 shadow-pop ${tones[t.tone]}`}
        >
          <div className="flex items-start gap-2.5">
            <Icon name={icons[t.tone]} size={18} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-snug">{t.title}</p>
              {t.description && <p className="mt-0.5 text-[13px] opacity-90 break-words">{t.description}</p>}
              {t.action && (
                <button
                  type="button"
                  onClick={() => { t.action!.onClick(); dismiss(t.id); }}
                  className="mt-1.5 text-[13px] font-bold underline underline-offset-2"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss"
              className="-mr-1 -mt-1 rounded-lg p-1 opacity-60 hover:opacity-100"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ── Dropdown menu ─────────────────────────────────────────────────────────── */

export function Dropdown({ trigger, items, align = 'right', width = 'w-56' }: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  items: (ActionItem | 'divider')[];
  align?: 'left' | 'right';
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEscape(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" ref={wrap}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          className={`absolute z-50 mt-2 ${align === 'right' ? 'right-0' : 'left-0'} ${width} overflow-hidden rounded-xl border border-ink-200 bg-white p-1 shadow-pop animate-rise`}
        >
          {items.map((item, i) => item === 'divider' ? (
            <div key={`d-${i}`} className="my-1 h-px bg-ink-200" />
          ) : (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onSelect(); }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors disabled:opacity-40 ${
                item.tone === 'danger' ? 'text-red-700 hover:bg-red-50' : 'text-ink-700 hover:bg-ink-100'
              }`}
            >
              {item.icon && <span className="text-ink-500">{item.icon}</span>}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && <span className="text-[11px] font-normal text-ink-400">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Progress / spinner overlay ────────────────────────────────────────────── */

export function BusyOverlay({ show, label }: { show: boolean; label?: string }) {
  if (!show || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-ink-950/40 backdrop-blur-[1px]">
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-7 py-6 shadow-pop">
        <Spinner size={30} className="text-brand-600" />
        {label && <p className="text-sm font-semibold text-ink-700">{label}</p>}
      </div>
    </div>,
    document.body,
  );
}
