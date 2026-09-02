import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  duration?: number;
}

interface ToastApi {
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const handle = timers.current.get(id);
    if (handle) { window.clearTimeout(handle); timers.current.delete(id); }
  }, []);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    const duration = t.duration ?? (t.tone === 'error' ? 7000 : 4200);
    const handle = window.setTimeout(() => dismiss(id), duration);
    timers.current.set(id, handle);
    return id;
  }, [dismiss]);

  const value = useMemo<ToastApi>(() => ({
    toasts,
    toast,
    dismiss,
    success: (title, description) => toast({ tone: 'success', title, description }),
    error: (title, description) => toast({ tone: 'error', title, description }),
    info: (title, description) => toast({ tone: 'info', title, description }),
    warning: (title, description) => toast({ tone: 'warning', title, description }),
  }), [toasts, toast, dismiss]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

/** Turn any thrown value into a message a seller can act on. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!err) return fallback;
  const raw = err instanceof Error ? err.message : String(err);
  const cleaned = raw.replace(/^.*?exception:\s*/i, '').trim();
  const map: Record<string, string> = {
    insufficient_stock: 'There is not enough stock for that quantity.',
    product_not_found: 'That product no longer exists.',
    amount_exceeds_balance: 'That amount is more than the outstanding balance.',
    permission_denied: 'Your role does not allow this. Ask the business owner to grant the permission.',
    business_already_exists: 'You already have a business on this account.',
    customer_name_required: 'A customer name is required.',
    invoice_items_required: 'Add at least one line to the invoice.',
    quotation_items_required: 'Add at least one line to the quotation.',
    order_items_required: 'Add at least one line to the order.',
    invalid_amount: 'Enter an amount greater than zero.',
    not_authenticated: 'Please sign in to continue.',
    quotation_expired: 'This quotation has expired. Ask the seller for a new one.',
    failed_to_fetch: 'Cannot reach Seedwel Hub. Check your connection.',
  };
  for (const [key, message] of Object.entries(map)) {
    if (cleaned.includes(key)) {
      const detail = cleaned.split(':').slice(1).join(':').trim();
      return detail ? `${message} (${detail})` : message;
    }
  }
  return cleaned || fallback;
}
