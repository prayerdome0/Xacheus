import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase, rpc } from '@/lib/supabase';
import { useAuth } from './AuthContext';
import { effectivePermissions, hasPermission, hasAnyPermission } from '@/lib/permissions';
import type { Business, BusinessMember, Branch, GrowthScore, Plan, Subscription, Warehouse } from '@/types';

/**
 * The "My Business" side of Seedwel Hub.
 *
 * Holds the businesses this account can act for, the active one, the caller's
 * membership/role, the effective permission set, and the primary branch,
 * warehouse, tax and subscription the seller screens all need.
 *
 * Business Owner Mode: switching between 🛍️ Shop and 🏢 My Business is a UI
 * concern, but everything a seller does must resolve against ONE active
 * business, so it lives here rather than being recomputed per screen.
 */

interface BusinessState {
  businesses: Business[];
  memberships: BusinessMember[];
  activeBusiness: Business | null;
  activeMembership: BusinessMember | null;
  setActiveBusinessId: (id: string | null) => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;

  permissions: Set<string>;
  can: (permission: string) => boolean;
  canAny: (permissions: string[]) => boolean;
  isOwner: boolean;
  isOwnerOrAdmin: boolean;

  branches: Branch[];
  warehouses: Warehouse[];
  primaryBranch: Branch | null;
  primaryWarehouse: Warehouse | null;
  defaultTax: { id: string; name: string; rate: number; is_inclusive: boolean } | null;

  subscription: Subscription | null;
  plan: Plan | null;
  growthScore: GrowthScore | null;
  recomputeGrowthScore: () => Promise<void>;

  /** Create the business + automatic store (RPC create_business). */
  createBusiness: (input: Record<string, unknown>) => Promise<{ slug: string; businessId: string } | { error: string }>;
}

const BusinessContext = createContext<BusinessState | null>(null);

const STORAGE_KEY = 'seedwel-active-business';

export function BusinessProvider({ children }: { children: ReactNode }) {
  const { user, profile, isPlatformAdmin } = useAuth();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [memberships, setMemberships] = useState<BusinessMember[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [defaultTax, setDefaultTax] = useState<BusinessState['defaultTax']>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [growthScore, setGrowthScore] = useState<GrowthScore | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setBusinesses([]); setMemberships([]); setActiveId(null);
      setBranches([]); setWarehouses([]); setSubscription(null); setPlan(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Businesses this account owns.
      const { data: owned } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_id', user.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      // Businesses this account is an active member of (employee mode).
      const { data: memberRows } = await supabase
        .from('business_members')
        .select('*, businesses(*)')
        .eq('user_id', user.id)
        .eq('status', 'active');

      const memberBusinesses = (memberRows ?? [])
        .map((r: { businesses?: Business }) => {
          const b = r.businesses;
          return b ? { business: b, membership: r as unknown as BusinessMember } : null;
        })
        .filter(Boolean) as { business: Business; membership: BusinessMember }[];

      const merged = new Map<string, Business>();
      (owned ?? []).forEach((b: Business) => merged.set(b.id, b));
      memberBusinesses.forEach(({ business }: { business: Business }) => {
        if (!merged.has(business.id)) merged.set(business.id, business);
      });
      const list = Array.from(merged.values());

      const allMemberships = memberBusinesses
        .filter((m: { business: Business; membership: BusinessMember }) => !owned?.some((o: Business) => o.id === m.business.id))
        .map((m: { business: Business; membership: BusinessMember }) => m.membership);

      // Owner memberships are synthesised so permissions resolve uniformly.
      (owned ?? []).forEach((b: Business) => {
        if (!allMemberships.some((m: BusinessMember) => m.business_id === b.id)) {
          allMemberships.push({
            id: `owner-${b.id}`, business_id: b.id, user_id: user.id, role: 'owner',
            custom_role_id: null, status: 'active', job_title: 'Owner', phone: null,
            email: profile?.email ?? null, branch_id: null, permissions_override: [],
            denied_permissions: [], can_approve_ai_actions: true,
            invited_at: b.created_at, joined_at: b.created_at, last_active_at: null,
          } as BusinessMember);
        }
      });

      setBusinesses(list);
      setMemberships(allMemberships);

      const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      const preferred = stored ?? profile?.default_business ?? null;
      const next = list.find((b) => b.id === preferred)?.id ?? list[0]?.id ?? null;
      setActiveId(next);
      if (next && typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your businesses.');
    } finally {
      setLoading(false);
    }
  }, [user, profile?.email, profile?.default_business]);

  useEffect(() => { void load(); }, [load]);

  const activeBusiness = useMemo(
    () => businesses.find((b) => b.id === activeId) ?? null,
    [businesses, activeId],
  );
  const activeMembership = useMemo(
    () => memberships.find((m) => m.business_id === activeId) ?? null,
    [memberships, activeId],
  );

  // Per-business working data.
  useEffect(() => {
    let alive = true;
    const loadBusinessData = async () => {
      if (!activeBusiness) {
        setBranches([]); setWarehouses([]); setDefaultTax(null);
        setSubscription(null); setPlan(null); setGrowthScore(null);
        return;
      }
      const id = activeBusiness.id;
      const [{ data: branchRows }, { data: warehouseRows }, { data: taxRows }, { data: subRows }] =
        await Promise.all([
          supabase.from('branches').select('*').eq('business_id', id).eq('is_active', true)
            .order('is_primary', { ascending: false }),
          supabase.from('warehouses').select('*').eq('business_id', id).eq('is_active', true)
            .order('is_primary', { ascending: false }),
          supabase.from('taxes').select('*').eq('business_id', id).eq('is_active', true)
            .order('is_default', { ascending: false }).limit(1),
          supabase.from('subscriptions').select('*, plans(*)').eq('business_id', id)
            .in('status', ['trialing', 'active', 'past_due']).limit(1),
        ]);
      if (!alive) return;
      setBranches((branchRows ?? []) as Branch[]);
      setWarehouses((warehouseRows ?? []) as Warehouse[]);
      const tax = (taxRows ?? [])[0] as
        | { id: string; name: string; rate: number; is_inclusive: boolean }
        | undefined;
      setDefaultTax(tax ? { id: tax.id, name: tax.name, rate: Number(tax.rate), is_inclusive: tax.is_inclusive } : null);
      const sub = (subRows ?? [])[0] as (Subscription & { plans?: Plan }) | undefined;
      setSubscription(sub ?? null);
      setPlan(sub?.plans ?? null);
    };
    void loadBusinessData();
    return () => { alive = false; };
  }, [activeBusiness]);

  const permissions = useMemo(
    () => effectivePermissions({
      userId: user?.id,
      business: activeBusiness,
      membership: activeMembership,
      isPlatformAdmin,
    }),
    [user?.id, activeBusiness, activeMembership, isPlatformAdmin],
  );

  const can = useCallback((p: string) => hasPermission(permissions, p), [permissions]);
  const canAny = useCallback((ps: string[]) => hasAnyPermission(permissions, ps), [permissions]);

  const setActiveBusinessId = useCallback((id: string | null) => {
    setActiveId(id);
    if (typeof window !== 'undefined') {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const recomputeGrowthScore = useCallback(async () => {
    if (!activeBusiness) return;
    try {
      const score = await rpc<GrowthScore>('compute_growth_score', { p_business_id: activeBusiness.id });
      setGrowthScore(score);
    } catch {
      setGrowthScore(null);
    }
  }, [activeBusiness]);

  const createBusiness = useCallback<BusinessState['createBusiness']>(async (input) => {
    try {
      const res = await rpc<{ business_id: string; store_id: string; slug: string }>('create_business', {
        p_input: input,
      });
      await load();
      setActiveBusinessId(res.business_id);
      return { slug: res.slug, businessId: res.business_id };
    } catch (e) {
      return { error: e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Could not create the business.' };
    }
  }, [load, setActiveBusinessId]);

  const value = useMemo<BusinessState>(() => ({
    businesses, memberships, activeBusiness, activeMembership, setActiveBusinessId,
    loading, error, refresh: load,
    permissions, can, canAny,
    isOwner: Boolean(activeBusiness && user && activeBusiness.owner_id === user.id),
    isOwnerOrAdmin: Boolean(activeBusiness && user && (activeBusiness.owner_id === user.id
      || (activeMembership && ['owner', 'administrator'].includes(activeMembership.role)))),
    branches, warehouses,
    primaryBranch: branches.find((b) => b.is_primary) ?? branches[0] ?? null,
    primaryWarehouse: warehouses.find((w) => w.is_primary) ?? warehouses[0] ?? null,
    defaultTax, subscription, plan, growthScore, recomputeGrowthScore, createBusiness,
  }), [businesses, memberships, activeBusiness, activeMembership, setActiveBusinessId, loading, error,
       load, permissions, can, canAny, user, branches, warehouses, defaultTax, subscription, plan,
       growthScore, recomputeGrowthScore, createBusiness]);

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness(): BusinessState {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error('useBusiness must be used inside <BusinessProvider>');
  return ctx;
}

/** Guard helper for seller screens: returns null when the user has no business yet. */
export function useRequireBusiness() {
  const { activeBusiness, loading, error } = useBusiness();
  return { business: activeBusiness, loading, error, ready: Boolean(activeBusiness) };
}
