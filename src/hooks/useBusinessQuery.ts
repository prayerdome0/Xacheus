import { useMemo } from 'react';
import { db, type QueryBuilderLike } from '@/lib/db';
import { useBusiness } from '@/context/BusinessContext';
import { useQuery } from './useQuery';
import type { UUID } from '@/types';

/**
 * Business-scoped queries with the permission gate applied first.
 *
 * If the caller's role lacks the permission, the query is not issued at all and
 * `denied` is set — the screen then shows the "your role does not include…"
 * message instead of an empty table. Firestore rules still enforce the same
 * boundary server-side.
 */

export interface BusinessQueryOptions {
  permission?: string;
  permissions?: string[];
  enabled?: boolean;
  order?: { column: string; ascending?: boolean };
  limit?: number;
  extra?: (q: QueryBuilderLike) => QueryBuilderLike;
}

export function useBusinessQuery<T>(
  table: string,
  _select: string,
  opts: BusinessQueryOptions = {},
) {
  const { activeBusiness, can, canAny } = useBusiness();
  const businessId = activeBusiness?.id ?? null;

  const allowed = useMemo(() => {
    if (!businessId) return false;
    if (opts.permissions?.length) return canAny(opts.permissions);
    if (opts.permission) return can(opts.permission);
    return true;
  }, [businessId, opts.permission, opts.permissions, can, canAny]);

  const denied = Boolean(businessId) && !allowed;

  const query = useQuery<T>(
    () => {
      if (!businessId || !allowed || opts.enabled === false) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = db.from(table).eq('business_id', businessId);
      if (opts.order) q = q.order(opts.order.column, { ascending: opts.order.ascending ?? false });
      if (opts.limit) q = q.limit(opts.limit);
      if (opts.extra) q = opts.extra(q);
      return q as never;
    },
    [businessId, table, allowed, opts.enabled, opts.order?.column, opts.order?.ascending, opts.limit],
    { enabled: Boolean(businessId) && allowed && opts.enabled !== false },
  );

  return { ...query, denied, allowed, businessId: businessId as UUID | null };
}
