/**
 * Transitional stub — the old Postgres RPC layer has been removed.
 * Functions that used this should be replaced with Firestore equivalents.
 */

import { supabase } from './supabase';

export async function searchBusinesses(_opts?: Record<string, unknown>): Promise<{ items: unknown[]; total: number; page: number; pages: number }> {
  return { items: [], total: 0, page: 1, pages: 0 };
}

export async function createPaymentLink(_payload: Record<string, unknown>): Promise<Record<string, string | number>> {
  return { code: 'stub', url: '/' };
}

export { supabase, BUCKETS } from './supabase';
