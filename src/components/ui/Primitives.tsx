import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon, Spinner, type IconName } from './Icon';

/** Button */
type Variant = 'primary' | 'accent' | 'outline' | 'ghost' | 'danger' | 'dark';
type Size = 'sm' | 'md' | 'lg' | 'xl' | 'icon';

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'sh-btn-primary',
  accent: 'sh-btn-accent',
  outline: 'sh-btn-outline',
  ghost: 'sh-btn-ghost',
  danger: 'sh-btn-danger',
  dark: 'sh-btn-dark',
};
const SIZE_CLASS: Record<Size, string> = {
  sm: 'sh-btn-sm', md: 'sh-btn-md', lg: 'sh-btn-lg', xl: 'sh-btn-xl', icon: 'sh-btn-icon',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, iconRight, loading, block, className = '', children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 17} /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 18} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={size === 'sm' ? 15 : 18} /> : null}
    </button>
  );
});

/** Text input with label, hint and error. */
interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  /** Rendered inside the field on the left (e.g. a currency symbol).
   *  Named `lead`/`trail` because `prefix`/`suffix` collide with the HTML
   *  string attributes of the same name. */
  lead?: ReactNode;
  trail?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(
  function Input({ label, hint, error, required, className = '', lead, trail, id, ...rest }, ref) {
    const auto = useId();
    const fieldId = id ?? auto;
    return (
      <div className={className}>
        {label && (
          <label htmlFor={fieldId} className="sh-field-label">
            {label}{required && <span className="text-red-500"> *</span>}
          </label>
        )}
        <div className="relative">
          {lead && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm pointer-events-none">
              {lead}
            </span>
          )}
          <input
            ref={ref}
            id={fieldId}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
            className={`sh-input ${lead ? 'pl-9' : ''} ${trail ? 'pr-10' : ''} ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' : ''}`}
            {...rest}
          />
          {trail && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500">{trail}</span>}
        </div>
        {error ? <p id={`${fieldId}-error`} className="sh-error-text">{error}</p> : hint ? <p id={`${fieldId}-hint`} className="sh-hint">{hint}</p> : null}
      </div>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps>(
  function Textarea({ label, hint, error, required, className = '', id, rows = 3, ...rest }, ref) {
    const auto = useId();
    const fieldId = id ?? auto;
    return (
      <div className={className}>
        {label && (
          <label htmlFor={fieldId} className="sh-field-label">
            {label}{required && <span className="text-red-500"> *</span>}
          </label>
        )}
        <textarea
          ref={ref} id={fieldId} rows={rows}
          aria-invalid={Boolean(error)}
          className={`sh-textarea ${error ? 'border-red-400' : ''}`}
          {...rest}
        />
        {error ? <p className="sh-error-text">{error}</p> : hint ? <p className="sh-hint">{hint}</p> : null}
      </div>
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldProps & {
  options?: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}>(function Select({ label, hint, error, required, className = '', id, options, placeholder, children, ...rest }, ref) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={fieldId} className="sh-field-label">
          {label}{required && <span className="text-red-500"> *</span>}
        </label>
      )}
      <select
        ref={ref} id={fieldId}
        className={`sh-select ${error ? 'border-red-400' : ''}`}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
        {children}
      </select>
      {error ? <p className="sh-error-text">{error}</p> : hint ? <p className="sh-hint">{hint}</p> : null}
    </div>
  );
});

/** Switch — used for every toggle in settings, marketing and automation. */
export function Switch({ checked, onChange, label, hint, disabled }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-ink-300'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}
        />
      </button>
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-semibold text-ink-800">{label}</span>}
          {hint && <span className="block text-xs text-ink-500 mt-0.5">{hint}</span>}
        </span>
      )}
    </label>
  );
}

/** Checkbox */
export function Checkbox({ checked, onChange, label, hint, disabled }: {
  checked: boolean; onChange: (next: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-2.5 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        <input
          type="checkbox" checked={checked} disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer h-5 w-5 appearance-none rounded-md border border-ink-300 bg-white transition-colors checked:border-brand-600 checked:bg-brand-600 disabled:opacity-50"
        />
        <Icon name="check" size={13} className="pointer-events-none absolute text-white opacity-0 peer-checked:opacity-100" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-ink-800">{label}</span>
        {hint && <span className="block text-xs text-ink-500 mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}

/** Badge */
export type BadgeTone = 'neutral' | 'brand' | 'accent' | 'green' | 'red' | 'amber' | 'blue';
const BADGE_CLASS: Record<BadgeTone, string> = {
  neutral: 'sh-pill-neutral', brand: 'sh-pill-brand', accent: 'sh-pill-accent',
  green: 'sh-pill-green', red: 'sh-pill-red', amber: 'sh-pill-amber', blue: 'sh-pill-blue',
};

export function Badge({ tone = 'neutral', icon, children, className = '' }: {
  tone?: BadgeTone; icon?: IconName; children: ReactNode; className?: string;
}) {
  return (
    <span className={`${BADGE_CLASS[tone]} ${className}`}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

/** Card */
export function Card({ children, className = '', padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={`sh-card ${padded ? 'p-4 sm:p-5' : ''} ${className}`}>{children}</div>;
}

export function SectionHeader({ title, subtitle, action, icon }: {
  title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: IconName;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h2 className="text-base sm:text-lg font-bold flex items-center gap-2">
          {icon && <Icon name={icon} size={18} className="text-brand-600" />}
          {title}
        </h2>
        {subtitle && <p className="text-xs sm:text-sm text-ink-500 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Skeleton */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`sh-skeleton ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="sh-card-flat overflow-hidden">
      <Skeleton className="aspect-square rounded-none" />
      <div className="p-3 space-y-2">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
        <Skeleton className="h-4 w-2/5" />
      </div>
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="sh-card-flat p-3 flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Empty state */
export function EmptyState({ icon = 'box', title, description, action, emoji }: {
  icon?: IconName; emoji?: string; title: string; description?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="sh-card-flat flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
        {emoji ? <span className="text-3xl">{emoji}</span> : <Icon name={icon} size={30} />}
      </div>
      <h3 className="text-base font-bold">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Error state */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/70 p-5 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-red-100 text-red-600">
        <Icon name="warning" size={22} />
      </div>
      <h3 className="text-sm font-bold text-red-800">Could not load this</h3>
      <p className="mt-1 text-sm text-red-700/90 break-words">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" icon="refresh" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Alert / notice banner */
export function Notice({ tone = 'info', title, children, icon, action }: {
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'brand';
  title?: ReactNode; children?: ReactNode; icon?: IconName; action?: ReactNode;
}) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    danger: 'border-red-200 bg-red-50 text-red-900',
    brand: 'border-brand-200 bg-brand-50 text-brand-900',
  } as const;
  const defaultIcon: Record<string, IconName> = {
    info: 'info', success: 'success', warning: 'warning', danger: 'alert', brand: 'sparkles',
  };
  return (
    <div className={`rounded-xl border p-3.5 text-sm ${tones[tone]}`}>
      <div className="flex items-start gap-2.5">
        <Icon name={icon ?? defaultIcon[tone]} size={18} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          {title && <p className="font-bold">{title}</p>}
          {children && <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>}
          {action && <div className="mt-2.5">{action}</div>}
        </div>
      </div>
    </div>
  );
}

/** Money display */
export function Money({ amount, currency = 'ZMW', size = 'sm', className = '' }: {
  amount: number | string | null | undefined; currency?: string; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; className?: string;
}) {
  const sizes = {
    xs: 'text-xs font-semibold', sm: 'text-sm font-semibold', md: 'text-base font-bold',
    lg: 'text-xl font-extrabold', xl: 'text-2xl sm:text-3xl font-extrabold',
  } as const;
  // Formatting is imported lazily-free: keep this component dependency-light.
  const formatted = formatAmount(amount, currency);
  return <span className={`${sizes[size]} tabular-nums ${className}`}>{formatted}</span>;
}

function formatAmount(amount: number | string | null | undefined, currency: string): string {
  const n = Number(amount ?? 0);
  const symbols: Record<string, string> = { ZMW: 'K', USD: '$', ZAR: 'R', BWP: 'P', MWK: 'MK', TZS: 'TSh', KES: 'KSh', GBP: '£', EUR: '€' };
  const symbol = symbols[currency] ?? `${currency} `;
  const abs = Math.abs(n);
  const body = abs.toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}${symbol}${body}`;
}

export { formatAmount };


/* Overlays live in their own module but are re-exported here so screens can
 * import every primitive from one place. */
export { Modal, ConfirmDialog, useConfirm, Sheet, ActionSheet, ToastViewport, Dropdown, BusyOverlay } from './Overlays';
export type { ActionItem, ConfirmOptions } from './Overlays';
