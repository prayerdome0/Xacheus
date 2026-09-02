import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthContext';
import { computeTotals, priceForQuantity } from '@/lib/calc';
import { roundMoney, toNum } from '@/lib/currency';
import { lineKey } from '@/lib/slug';
import type { CartLine, Money, Product, UUID } from '@/types';

/**
 * Shopping cart.
 *
 * Local-first (works offline and for guests), synced to public.carts /
 * public.cart_items when the shopper is signed in so the cart follows them
 * between devices. Items are grouped per business because each business
 * fulfils and invoices its own order — one basket can produce several orders.
 */

const STORAGE_KEY = 'seedwel-cart-v1';

interface CartGroup {
  businessId: UUID;
  businessName: string;
  businessSlug: string;
  lines: CartLine[];
  totals: ReturnType<typeof computeTotals>;
}

interface CartState {
  lines: CartLine[];
  count: number;
  groups: CartGroup[];
  subtotal: number;
  total: number;
  currency: string;
  loading: boolean;
  add: (product: Product, opts?: { quantity?: number; variantId?: UUID | null }) => Promise<void>;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  clearBusiness: (businessId: UUID) => void;
  applyCoupon: (code: string) => Promise<{ ok: boolean; discount: number; message: string }>;
  couponCode: string | null;
  couponDiscount: number;
  setDelivery: (businessId: UUID, method: 'pickup' | 'delivery', fee: number) => void;
  delivery: Record<UUID, { method: 'pickup' | 'delivery'; fee: number }>;
  has: (productId: UUID, variantId?: UUID | null) => boolean;
}

const CartContext = createContext<CartState | null>(null);

function readLocal(): CartLine[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CartLine[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(lines: CartLine[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines.slice(0, 300)));
  } catch {
    /* storage full or blocked — the cart still works for this session */
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [lines, setLines] = useState<CartLine[]>(() => readLocal());
  const [loading, setLoading] = useState(false);
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [delivery, setDeliveryState] = useState<Record<UUID, { method: 'pickup' | 'delivery'; fee: number }>>({});

  useEffect(() => { writeLocal(lines); }, [lines]);

  // Server sync: pull the signed-in shopper's saved cart once, then mirror writes.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      const { data: cart } = await supabase
        .from('carts')
        .select('id, cart_items(*, products(*))')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();
      if (!alive) return;
      const items = ((cart as unknown as { cart_items?: unknown[] })?.cart_items ?? []) as {
        product_id: UUID; variant_id: UUID | null; quantity: number; unit_price: number;
        is_wholesale: boolean; products?: Product;
      }[];
      if (items.length === 0) return;
      setLines((prev) => {
        const map = new Map(prev.map((l) => [l.key, l]));
        items.forEach((it) => {
          const p = it.products;
          if (!p) return;
          const key = lineKey(it.product_id, it.variant_id);
          if (!map.has(key)) {
            map.set(key, productToLine(p, it.quantity, it.variant_id));
          }
        });
        return Array.from(map.values());
      });
    })();
    return () => { alive = false; };
  }, [user]);

  const persist = useCallback(async (next: CartLine[]) => {
    if (!user) return;
    try {
      const { data: cart } = await supabase
        .from('carts')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();
      const cartId = (cart as { id?: UUID } | null)?.id;
      const totals = computeTotals({ lines: next });

      if (!cartId) {
        if (next.length === 0) return;
        const { data: created, error } = await supabase
          .from('carts')
          .insert({
            user_id: user.id,
            currency: 'ZMW',
            subtotal: totals.subtotal,
            discount: totals.discount,
            tax_total: totals.tax,
            delivery_fee: totals.delivery,
            total: totals.total,
            item_count: totals.itemCount,
          })
          .select('id')
          .single();
        if (error || !created) return;
        await supabase.from('cart_items').insert(next.map((l) => ({
          cart_id: (created as { id: UUID }).id,
          product_id: l.product_id,
          variant_id: l.variant_id ?? null,
          quantity: l.quantity,
          unit_price: l.unit_price,
          is_wholesale: l.is_wholesale,
        })));
        return;
      }

      const id = cartId as UUID;
      await supabase.from('cart_items').delete().eq('cart_id', id);
      if (next.length > 0) {
        await supabase.from('cart_items').insert(next.map((l) => ({
          cart_id: id,
          product_id: l.product_id,
          variant_id: l.variant_id ?? null,
          quantity: l.quantity,
          unit_price: l.unit_price,
          is_wholesale: l.is_wholesale,
        })));
      }
      await supabase.from('carts').update({
        subtotal: totals.subtotal, discount: totals.discount, tax_total: totals.tax,
        delivery_fee: totals.delivery, total: totals.total, item_count: totals.itemCount,
      }).eq('id', id);
    } catch {
      /* offline — the local cart remains authoritative for this session */
    }
  }, [user]);

  const add = useCallback(async (product: Product, opts: { quantity?: number; variantId?: UUID | null } = {}) => {
    setLoading(true);
    const variant = opts.variantId
      ? (product.variants ?? []).find((v) => v.id === opts.variantId) ?? null
      : null;
    const qty = Math.max(1, opts.quantity ?? product.min_purchase_qty ?? 1);
    const key = lineKey(product.id, variant?.id ?? null);

    setLines((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        const nextQty = existing.quantity + qty;
        const priced = priceForQuantity(
          toNum(variant?.price ?? product.price), nextQty,
          variant?.wholesale_price ?? product.wholesale_price,
          product.wholesale_min_qty, product.is_wholesale,
        );
        return prev.map((l) => (l.key === key
          ? { ...l, quantity: nextQty, unit_price: priced.price, is_wholesale: priced.wholesale }
          : l));
      }
      return [...prev, productToLine(product, qty, variant?.id ?? null, variant?.price ?? null)];
    });

    // Persist the resolved list on the next tick so state has settled.
    setTimeout(() => {
      const next = readLocal();
      void persist(next.length ? next : lines);
    }, 60);
    setLoading(false);
  }, [lines, persist]);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((prev) => prev.flatMap((l) => {
      if (l.key !== key) return [l];
      if (quantity <= 0) return [];
      const p = l.product;
      const priced = p
        ? priceForQuantity(toNum(p.price), quantity, p.wholesale_price, p.wholesale_min_qty, p.is_wholesale)
        : { price: l.unit_price, wholesale: l.is_wholesale };
      return [{ ...l, quantity, unit_price: priced.price, is_wholesale: priced.wholesale }];
    }));
  }, []);

  const remove = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setCouponCode(null);
    setCouponDiscount(0);
    setDeliveryState({});
  }, []);

  const clearBusiness = useCallback((businessId: UUID) => {
    setLines((prev) => prev.filter((l) => l.business_id !== businessId));
  }, []);

  useEffect(() => { void persist(lines); }, [lines, persist]);

  const applyCoupon = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return { ok: false, discount: 0, message: 'Enter a coupon code.' };
    const first = lines[0];
    if (!first) return { ok: false, discount: 0, message: 'Your cart is empty.' };
    const subtotal = roundMoney(lines.reduce((s, l) => s + l.unit_price * l.quantity, 0));
    try {
      const { data, error } = await supabase.rpc('validate_coupon', {
        p_code: trimmed, p_business_id: first.business_id, p_subtotal: subtotal,
      });
      if (error) throw error;
      const res = data as { valid: boolean; discount?: number; reason?: string; required?: number };
      if (!res?.valid) {
        const messages: Record<string, string> = {
          not_found: 'That code is not valid for this store.',
          exhausted: 'This coupon has reached its usage limit.',
          min_subtotal: `Spend at least ${res.required ?? ''} to use this coupon.`,
          per_customer_limit: 'You have already used this coupon.',
        };
        return { ok: false, discount: 0, message: messages[res?.reason ?? ''] ?? 'That code could not be applied.' };
      }
      setCouponCode(trimmed.toUpperCase());
      setCouponDiscount(toNum(res.discount));
      return { ok: true, discount: toNum(res.discount), message: 'Coupon applied.' };
    } catch (e) {
      return { ok: false, discount: 0, message: e instanceof Error ? e.message : 'Could not validate the coupon.' };
    }
  }, [lines]);

  const setDelivery = useCallback((businessId: UUID, method: 'pickup' | 'delivery', fee: number) => {
    setDeliveryState((prev) => ({ ...prev, [businessId]: { method, fee } }));
  }, []);

  const groups = useMemo<CartGroup[]>(() => {
    const map = new Map<UUID, CartLine[]>();
    lines.forEach((l) => {
      const arr = map.get(l.business_id) ?? [];
      arr.push(l);
      map.set(l.business_id, arr);
    });
    return Array.from(map.entries()).map(([businessId, groupLines]) => ({
      businessId,
      businessName: groupLines[0]?.business_name ?? 'Seller',
      businessSlug: groupLines[0]?.business_slug ?? '',
      lines: groupLines,
      totals: computeTotals({
        lines: groupLines,
        deliveryFee: delivery[businessId]?.method === 'delivery' ? delivery[businessId].fee : 0,
      }),
    }));
  }, [lines, delivery]);

  const { subtotal, total, count, currency } = useMemo(() => {
    const sub = roundMoney(lines.reduce((s, l) => s + l.unit_price * l.quantity, 0));
    const deliveryTotal = roundMoney(
      Object.values(delivery).reduce((s, d) => s + (d.method === 'delivery' ? d.fee : 0), 0),
    );
    return {
      subtotal: sub,
      total: roundMoney(Math.max(sub - couponDiscount + deliveryTotal, 0)),
      count: lines.reduce((s, l) => s + l.quantity, 0),
      currency: lines[0]?.product?.currency ?? 'ZMW',
    };
  }, [lines, couponDiscount, delivery]);

  const has = useCallback(
    (productId: UUID, variantId?: UUID | null) => lines.some((l) => l.product_id === productId
      && (variantId ? l.variant_id === variantId : true)),
    [lines],
  );

  const value = useMemo<CartState>(() => ({
    lines, count, groups, subtotal, total, currency, loading,
    add, setQuantity, remove, clear, clearBusiness,
    applyCoupon, couponCode, couponDiscount,
    setDelivery, delivery, has,
  }), [lines, count, groups, subtotal, total, currency, loading, add, setQuantity, remove,
       clear, clearBusiness, applyCoupon, couponCode, couponDiscount, setDelivery, delivery, has]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

function productToLine(product: Product, quantity: number, variantId: UUID | null, variantPrice?: Money | null): CartLine {
  const basePrice = toNum(variantPrice ?? product.price);
  const priced = priceForQuantity(basePrice, quantity, product.wholesale_price,
    product.wholesale_min_qty, product.is_wholesale);
  const variant = variantId ? (product.variants ?? []).find((v) => v.id === variantId) : null;
  return {
    key: lineKey(product.id, variantId),
    product_id: product.id,
    variant_id: variantId,
    business_id: product.business_id,
    business_name: product.business?.name ?? '',
    business_slug: product.business?.slug ?? '',
    name: variant ? `${product.name} — ${variant.name}` : product.name,
    description: product.short_description ?? undefined,
    quantity,
    unit: product.unit,
    unit_price: priced.price,
    is_wholesale: priced.wholesale,
    tax_rate: 0,
    image_url: variant?.image_url ?? product.primary_image_url ?? undefined,
    sku: variant?.sku ?? product.sku ?? undefined,
    product,
  };
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
