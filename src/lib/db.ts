import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  getCountFromServer,
  type CollectionReference,
  type DocumentData,
  type DocumentSnapshot,
  type FirestoreError,
  type OrderByDirection,
  type QueryConstraint,
  type Unsubscribe,
  runTransaction,
  type WhereFilterOp,
} from 'firebase/firestore';
import { getFirebaseDb } from './firebase';

/**
 * Seedwel Hub — Firestore data engine.
 *
 * This is the single central database access layer for the whole application
 * (replaces the legacy Supabase client). Every domain service (`api.ts`,
 * `messaging.ts`, `groups.ts`, the React contexts and hooks, and any screen
 * that needs a direct query) goes through `db` below, which is backed 1:1 by
 * Cloud Firestore.
 *
 * Design rules:
 *
 *  - Collection names are the Firestore structure from docs/FIREBASE_MIGRATION.md
 *    (`businesses`, `products`, `orders`, `messages`, …). Field names stay the
 *    snake_case names the UI already reads, so a Firestore document maps onto
 *    the app's TypeScript interfaces unchanged.
 *  - IDs are client-generated (`crypto.randomUUID()`) so related documents can
 *    be written atomically and referenced before they exist.
 *  - `created_at` / `updated_at` are UTC ISO strings (lexicographic sort ===
 *    chronological sort).
 *  - Joined/embedded display data is denormalised at write time (an order
 *    carries a `business` summary, a message carries its sender snapshot…).
 *  - Access control is enforced by `firebase/firestore.rules`, never by UI.
 *
 * The chain builder keeps the small query vocabulary the screens need:
 * `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `is`, `ilike`, `or`, `order`,
 * `limit`, `maybeSingle`, `single`. Rows are returned as
 * `{ data, error }` like the old layer so call sites behave identically.
 */

export type DbWhere = [string, string, unknown];
export interface DbQuerySpec {
  where?: DbWhere[];
  orderByField?: string;
  orderDir?: OrderByDirection;
  limit?: number;
}

export interface DbError {
  message: string;
  code?: string;
}

export type DbResult<T> = { data: T | null; error: DbError | null };

function errorFrom(err: unknown, fallback: string): DbError {
  if (err instanceof Error) {
    const message = err.message ?? fallback;
    return { message, code: (err as Error & { code?: string }).code };
  }
  return { message: fallback };
}

function friendlyFirestoreError(err: unknown): DbError {
  const e = errorFrom(err, 'Could not reach the database. Check your connection and try again.');
  if (e.code === 'permission-denied') {
    e.message = 'You do not have permission to view that data.';
  } else if (e.code === 'unavailable' || e.code === 'deadline-exceeded') {
    e.message = 'The database is taking too long to respond. Check your connection and try again.';
  } else if (e.code === 'not-found') {
    e.message = 'That record no longer exists.';
  } else if (e.code === 'resource-exhausted') {
    e.message = 'This query needs a Firestore index. Deploy firebase/firestore.indexes.json (see README).';
  } else if (e.code === 'cancelled') {
    e.message = 'The request was cancelled.';
  }
  return e;
}

export const isPermissionError = (e: unknown): boolean =>
  Boolean(e && (e as FirestoreError)?.code === 'permission-denied');

/* ── Helpers shared by every domain service ───────────────────────────────── */

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix?: string): string {
  const id = (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`).replace(/[^\w-]/g, '');
  return prefix ? `${prefix}_${id}` : id;
}

export function col(name: string): CollectionReference {
  return collection(getFirebaseDb(), name);
}

export function docRef(name: string, id: string) {
  return doc(getFirebaseDb(), name, id);
}

/** Normalise a Firestore document into the app's row shape (`{...data, id}`). */
export function rowFromDoc<T>(snap: DocumentSnapshot): T | null {
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as DocumentData) } as unknown as T;
}

export async function fetchRow<T>(name: string, id: string): Promise<T | null> {
  const snap = await getDoc(docRef(name, id));
  return rowFromDoc<T>(snap);
}

/** Create (or overwrite) a document under a fixed id. */
export async function writeRow<T extends { id: string }>(
  name: string,
  id: string,
  data: Omit<T, 'id'>,
): Promise<T> {
  const payload = { ...(data as DocumentData), updated_at: nowIso() };
  await setDoc(docRef(name, id), payload);
  return { ...(payload as unknown as T), id };
}

/** Create a document with an auto/manual id; returns the stored row with id. */
export async function addRow<T extends { id: string }>(
  name: string,
  data: Omit<T, 'id'>,
  id?: string,
): Promise<T> {
  const payload = { ...(data as DocumentData), created_at: nowIso(), updated_at: nowIso() };
  let finalId: string;
  if (id) {
    finalId = id;
  } else {
    const ref = col(name);
    const snapRef = await addDoc(ref, payload);
    finalId = snapRef.id;
  }
  if (id) await setDoc(docRef(name, id), payload);
  return { ...(payload as unknown as T), id: finalId };
}

/** Merge a patch into one document. */
export async function patchRow(name: string, id: string, patch: Record<string, unknown>): Promise<void> {
  await updateDoc(docRef(name, id), { ...patch, updated_at: nowIso() });
}

/** Delete one document by id. */
export async function deleteRow(name: string, id: string): Promise<void> {
  await deleteDoc(docRef(name, id));
}

/** Atomic counter increment on one document field (Firestore transaction). */
export async function bumpCounter(name: string, id: string, field: string, by = 1): Promise<number> {
  const ref = docRef(name, id);
  return runTransaction(getFirebaseDb(), async (tx) => {
    const snap = await tx.get(ref);
    const current = Number(snap.exists() ? snap.data()?.[field] : 0) || 0;
    const next = current + by;
    tx.update(ref, { [field]: next, updated_at: nowIso() });
    return next;
  });
}

/* ── List fetching (Firestore-native) ─────────────────────────────────────── */

export interface ListOptions {
  where?: DbWhere[];
  orderByField?: string;
  orderDir?: OrderByDirection;
  limit?: number;
}

/** Read a list from Firestore. Every equality filter maps 1:1 to a Firestore
 *  constraint; text filters (`ilike`) are applied in memory afterwards because
 *  Firestore has no substring index. */
export async function fetchList<T>(
  name: string,
  opts: ListOptions = {},
  postFilter?: (row: T) => boolean,
): Promise<T[]> {
  const constraints: QueryConstraint[] = [];
  const textFilters: Array<[string[], string]> = [];
  const requestedLimit = Math.min(opts.limit ?? 300, 1000);
  const needsPostFilter = Boolean(postFilter) || (opts.where ?? []).some(([, op]) => op === 'ilike');
  // When text filters run in memory we still cap the Firestore read to a
  // generous pool (never the whole collection).
  const serverLimit = needsPostFilter
    ? Math.min(Math.max(requestedLimit * 3, 100), 1000)
    : requestedLimit;

  (opts.where ?? []).forEach(([field, op, value]) => {
    if (typeof op === 'string' && op.toLowerCase() === 'ilike') {
      textFilters.push([[field], String(value)]);
      return;
    }
    if (typeof op === 'string' && (op === 'or_ilike' || op === 'orilike')) {
      textFilters.push([field.split('|'), String(value)]);
      return;
    }
    const firestoreOp: WhereFilterOp | null =
      op === '==' || op === 'eq' ? '==' :
      op === '!=' || op === 'neq' ? '!=' :
      op === '>' ? '>' : op === '>=' || op === 'gte' ? '>=' :
      op === '<' ? '<' : op === '<=' || op === 'lte' ? '<=' :
      op === 'in' ? 'in' : op === 'not-in' ? 'not-in' : op === 'array-contains' ? 'array-contains' : null;
    if (firestoreOp && !['ilike', 'like'].includes(String(op))) {
      constraints.push(where(field, firestoreOp, value));
    } else if (String(op).toLowerCase() === 'is') {
      constraints.push(where(field, '==', value));
    }
  });

  // A where('deleted_at','==',null) clause is implicit — Firestore documents
  // that were never soft-deleted simply do not carry the field.

  if (opts.orderByField) constraints.push(orderBy(opts.orderByField, opts.orderDir ?? 'asc'));
  if (serverLimit) constraints.push(fsLimit(serverLimit));

  const ref = col(name);
  let rows: T[];
  try {
    const snap = await getDocs(constraints.length ? query(ref, ...constraints) : ref);
    rows = snap.docs.map((d) => rowFromDoc<T>(d)).filter(Boolean) as T[];
  } catch (e) {
    // A missing composite index (deploy firebase/firestore.indexes.json) or a
    // rules error should never blank a screen. When the failure is an index,
    // retry without the server orderBy and sort in memory instead.
    const code = (e as { code?: string })?.code;
    const msg = (e as Error)?.message ?? '';
    const wantsIndex = code === 'failed-precondition' || /requires a(n)? (valid )?index|indexes|9 FAILED_PRECONDITION/i.test(msg);
    if (wantsIndex && opts.orderByField) {
      // Retry without the server orderBy (the missing composite index) and
      // sort in memory — the page keeps working until indexes are deployed.
      const retryConstraints = constraints.filter((c) => !(c as { type?: string }).type?.startsWith('order'));
      const snap = await getDocs(query(ref, ...retryConstraints));
      rows = snap.docs.map((d) => rowFromDoc<T>(d)).filter(Boolean) as T[];
      const field = opts.orderByField;
      rows = rows.sort((a, b) => {
        const va = (a as Record<string, unknown>)[field];
        const vb = (b as Record<string, unknown>)[field];
        if (va === vb) return 0;
        const cmp = va == null ? -1 : vb == null ? 1 : typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb ?? ''));
        return (opts.orderDir ?? 'asc') === 'asc' ? cmp : -cmp;
      });
    } else {
      // Otherwise surface the real error — indexes live in
      // firebase/firestore.indexes.json and only need a one-time deploy.
      throw e;
    }
  }

  if (textFilters.length || postFilter) {
    rows = rows.filter((r) => {
      if (postFilter && !postFilter(r)) return false;
      return textFilters.every(([fields, pattern]) =>
        fields.some((f) => {
          const value = (r as Record<string, unknown>)[f];
          if (value == null) return false;
          return String(value).toLowerCase().includes(pattern.toLowerCase().replace(/^%|%$/g, '').replace(/%/g, ''));
        })
      );
    });
  }
  if (requestedLimit && rows.length > requestedLimit) rows = rows.slice(0, requestedLimit);
  return rows;
}

/** Read a single row by id, `null` when the document does not exist. */
export async function fetchById<T>(name: string, id: string): Promise<T | null> {
  try {
    return await fetchRow<T>(name, id);
  } catch {
    return null;
  }
}

/* ── Realtime subscription helpers (messages, orders, notifications) ──────── */

export interface LiveQueryState<T> {
  items: T[];
  loading: boolean;
  error: string | null;
}

export function subscribeList<T>(
  name: string,
  opts: ListOptions,
  onChange: (items: T[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const constraints: QueryConstraint[] = [];
  const textFilters: Array<[string[], string]> = [];
  (opts.where ?? []).forEach(([field, op, value]) => {
    if (String(op).toLowerCase() === 'ilike') {
      textFilters.push([[field], String(value)]);
      return;
    }
    const firestoreOp: WhereFilterOp =
      op === '==' || op === 'eq' ? '==' :
      op === '!=' || op === 'neq' ? '!=' :
      op === '>' ? '>' : op === '>=' || op === 'gte' ? '>=' :
      op === '<' ? '<' : op === '<=' || op === 'lte' ? '<=' :
      op === 'in' ? 'in' : op === 'not-in' ? 'not-in' : op === 'array-contains' ? 'array-contains' : '==';
    if (op !== 'ilike' && op !== 'like') constraints.push(where(field, firestoreOp, value));
  });
  if (opts.orderByField) constraints.push(orderBy(opts.orderByField, opts.orderDir ?? 'asc'));
  if (opts.limit) constraints.push(fsLimit(opts.limit));

  return onSnapshot(
    query(col(name), ...constraints),
    (snap) => {
      let rows = snap.docs.map((d) => rowFromDoc<T>(d)).filter(Boolean) as T[];
      if (textFilters.length) {
        rows = rows.filter((r) =>
          textFilters.every(([fields, pattern]) =>
            fields.some((f) => {
              const value = (r as Record<string, unknown>)[f];
              if (value == null) return false;
              return String(value).toLowerCase().includes(pattern.toLowerCase().replace(/^%|%$/g, '').replace(/%/g, ''));
            })
          )
        );
      }
      onChange(rows);
    },
    (err) => onError?.(friendlyFirestoreError(err).message),
  );
}

/* ── Chainable builder (PostgREST-shaped, Firestore-backed) ───────────────── */

type Row = Record<string, unknown>;
type RowWithId = Row & { id: string };

interface ChainState {
  table: string;
  where: DbWhere[];
  order?: { field: string; dir: OrderByDirection };
  cap?: number;
  skip?: number;
  mode: 'read' | 'write';
  writeAction?: 'insert' | 'upsert' | 'update' | 'delete';
  payload?: Row[];
  conflictKey?: string;
  textFilters: Array<{ fields: string[]; pattern: string }>;
  inMemory: Array<(r: Row) => boolean>;
}

class DbChain implements PromiseLike<{ data: unknown; error: DbError | null }> {
  private s: ChainState;

  constructor(table: string, state?: Partial<ChainState>) {
    this.s = {
      table,
      where: state?.where ?? [],
      order: state?.order,
      cap: state?.cap,
      skip: state?.skip ?? 0,
      mode: state?.mode ?? 'read',
      writeAction: state?.writeAction,
      payload: state?.payload,
      conflictKey: state?.conflictKey,
      textFilters: state?.textFilters ?? [],
      inMemory: state?.inMemory ?? [],
    };
  }

  private clone(patch: Partial<ChainState>): DbChain {
    return new DbChain(this.s.table, { ...this.s, ...patch });
  }

  /* ── filters ──────────────────────────────────────────────────────────── */

  eq(field: string, value: unknown) {
    return this.clone({ where: [...this.s.where, [field, '==', value] as DbWhere] });
  }
  neq(field: string, value: unknown) {
    return this.clone({ where: [...this.s.where, [field, '!=', value] as DbWhere] });
  }
  gt(field: string, value: unknown) { return this.cmpRange(field, '>', value); }
  gte(field: string, value: unknown) { return this.cmpRange(field, '>=', value); }
  lt(field: string, value: unknown) { return this.cmpRange(field, '<', value); }
  lte(field: string, value: unknown) { return this.cmpRange(field, '<=', value); }
  private cmpRange(field: string, op: '>' | '>=' | '<' | '<=', value: unknown) {
    return this.clone({ where: [...this.s.where, [field, op, value] as DbWhere] });
  }
  in(field: string, values: unknown[]) {
    return this.clone({ where: [...this.s.where, [field, values?.length ? 'in' : '==', values?.length ? values : '__none__'] as DbWhere] });
  }
  /** Supabase `.contains(col, list)` → Firestore array-contains. */
  contains(field: string, value: unknown[]) {
    return this.clone({ where: [...this.s.where, [field, 'array-contains', value] as DbWhere] });
  }
  /** Supabase `.is(field, null)` → `field == null` in Firestore terms. */
  is(field: string, value: unknown) {
    return this.clone({ where: [...this.s.where, [field, value === null ? '==' : '==', value === null ? null : value] as DbWhere] });
  }
  /** Case-insensitive substring filter — applied in memory after the Firestore
   *  read (Firestore has no substring index; see docs/FIREBASE_MIGRATION.md). */
  ilike(field: string, pattern: string) {
    return this.clone({ textFilters: [...this.s.textFilters, { fields: [field], pattern: String(pattern) }] });
  }
  /** Supabase `.or("a.ilike.%x%,b.ilike.%x%,c.eq.3")` — OR over the parts.
   *  Text parts match case-insensitively in memory (Firestore has no substring
   *  index); predicate parts compare the row's field. */
  or(filter: string) {
    const parts = String(filter).split(',');
    const tests: Array<(r: Row) => boolean> = parts.map((p) => {
      const m = p.match(/^([\w.]+)\.(ilike|eq|neq|is|gt|gte|lt|lte)\.(.+)$/);
      if (!m) return () => true;
      const field = m[1].split('.').pop() as string;
      const op = m[2];
      const raw = m[3];
      if (op === 'ilike') {
        const pattern = raw.replace(/^%/, '').replace(/%$/, '');
        return (r: Row) => {
          const value = r[field];
          if (value == null) return false;
          return String(value).toLowerCase().includes(pattern.toLowerCase());
        };
      }
      return (r: Row) => predicateOnRow(r, `${field}.${op}.${raw}`);
    });
    return this.clone({ inMemory: [...this.s.inMemory, (r) => tests.some((t) => t(r))] });
  }
  /** Supabase `.not(field, op, value)` — supports `in`, `is`, `eq`, `neq`. */
  not(field: string, op: string, value?: unknown) {
    const normalizedOp = String(op).toLowerCase();
    if (normalizedOp === 'is' && value === 'null') {
      return this.clone({ where: [...this.s.where, [field, '==', null] as DbWhere] });
    }
    if (normalizedOp === 'is' && value === 'not.null') {
      return this.clone({ where: [...this.s.where, [field, '!=', null] as DbWhere] });
    }
    if (normalizedOp === 'in') {
      const list = Array.isArray(value)
        ? value
        : String(value ?? '')
            .replace(/^\(/, '').replace(/\)$/, '')
            .split(',')
            .filter(Boolean);
      if (list.length === 0) return this;
      return this.clone({ where: [...this.s.where, [field, 'not-in', list] as DbWhere] });
    }
    if (normalizedOp === 'eq') return this.neq(field, value);
    if (normalizedOp === 'neq') return this.eq(field, value);
    return this;
  }

  order(field: string, opts?: { ascending?: boolean; nullsFirst?: boolean; nullsLast?: boolean }) {
    // nulls ordering is not supported by Firestore; rows with missing values
    // sort first on ascending, last on descending, which matches nullsLast.
    return this.clone({ order: { field, dir: opts?.ascending === false ? 'desc' : 'asc' } });
  }
  limit(n: number) {
    return this.clone({ cap: Math.max(1, Math.min(Number(n) || 1, 1000)) });
  }
  /** Supabase `.range(from, to)` pagination (0-based inclusive). Rows are
   *  fetched up to `to + 1` and sliced client-side, so paging is exact up to
   *  the 1000-doc read cap that list queries allow. */
  range(from: number, to: number) {
    return this.clone({ cap: to - from + 1, skip: Math.max(0, from) });
  }

  /* ── selects / single rows (Firestore rows are already full objects) ──── */

  select(_columns?: string, _opts?: unknown) { return this; }
  maybeSingle() {
    if (this.s.mode === 'write') return this.resolveWriteSingle(false);
    return this.limit(1).resolveSingle();
  }
  single() {
    if (this.s.mode === 'write') return this.resolveWriteSingle(true);
    return this.limit(1).resolveSingle(true);
  }

  private async resolveWriteSingle(strict: boolean): Promise<{ data: Row | null; error: DbError | null }> {
    const res = await this.runWrite();
    if (res.error) return { data: null, error: res.error };
    const rows = (res.data ?? []) as Row[];
    if (rows.length === 0) return { data: null, error: null };
    if (strict && rows.length > 1) {
      return { data: null, error: { message: 'Expected one row but found more.' } };
    }
    return { data: rows[0], error: null };
  }

  /* ── writes ───────────────────────────────────────────────────────────── */

  insert(payload: Row | Row[]) {
    const rows = Array.isArray(payload) ? payload : [payload];
    return this.clone({ mode: 'write', writeAction: 'insert', payload: rows });
  }
  upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
    const rows = Array.isArray(payload) ? payload : [payload];
    return this.clone({ mode: 'write', writeAction: 'upsert', payload: rows, conflictKey: opts?.onConflict });
  }
  update(patch: Row) {
    return this.clone({
      mode: 'write',
      writeAction: 'update',
      payload: [patch],
    });
  }
  delete() {
    return this.clone({ mode: 'write', writeAction: 'delete' });
  }

  /* ── resolution ───────────────────────────────────────────────────────── */

  private async runRead(): Promise<{ data: Row[] | Row | null; error: DbError | null; count?: number }> {
    try {
      const skip = this.s.skip ?? 0;
      const fetchCap = skip > 0 ? Math.min(skip + (this.s.cap ?? 300), 1000) : this.s.cap;
      let rows: RowWithId[] = await fetchList<RowWithId>(
        this.s.table,
        {
          where: this.s.where.filter(([, op]) => op !== 'ilike' && op !== 'like'),
          orderByField: this.s.order?.field,
          orderDir: this.s.order?.dir,
          limit: fetchCap,
        },
        (r) => {
          for (const tf of this.s.textFilters) {
            const hit = tf.fields.some((f) => {
              const value = r[f];
              if (value == null) return false;
              const p = tf.pattern.replace(/^%/, '').replace(/%$/, '');
              return String(value).toLowerCase().includes(p.toLowerCase());
            });
            if (!hit) return false;
          }
          for (const fn of this.s.inMemory) {
            if (!fn(r)) return false;
          }
          return true;
        },
      );
      let total = rows.length;
      // Paged reads report the *exact* server-side total so page counts and
      // header badges stay truthful (Firestore count aggregation, no limit).
      if (skip > 0) {
        try {
          const countWhere = (this.s.where ?? []).filter(([, op]) =>
            !['ilike', 'like', 'or_ilike', 'orilike'].includes(String(op)),
          ).map(([f, op, v]) => {
            const mapped: WhereFilterOp =
              op === '==' || op === 'eq' ? '==' :
              op === '!=' || op === 'neq' ? '!=' :
              op === '>' ? '>' : op === '>=' || op === 'gte' ? '>=' :
              op === '<' ? '<' : op === '<=' || op === 'lte' ? '<=' :
              op === 'in' ? 'in' : op === 'not-in' ? 'not-in' : op === 'array-contains' ? 'array-contains' : '==';
            return where(f, mapped, v);
          });
          const countSnap = await getCountFromServer(countWhere.length ? query(col(this.s.table), ...countWhere) : col(this.s.table));
          total = countSnap.data().count;
        } catch { total = rows.length; /* count stays page-consistent if aggregation is unavailable */ }
      }
      if (skip > 0 && rows.length > skip) rows = rows.slice(skip);
      if (!this.s.cap && this.s.where.length === 0) {
        // Reading a whole collection without a cap is a footgun; keep data small.
      }
      return { data: rows, error: null, count: total };
    } catch (e) {
      return { data: null, error: friendlyFirestoreError(e) };
    }
  }

  private async resolveSingle(strict = false): Promise<{ data: Row | null; error: DbError | null }> {
    const res = await this.runRead();
    if (res.error) return { data: null, error: res.error };
    const rows = (res.data ?? []) as Row[];
    if (rows.length === 0) return { data: null, error: null };
    if (strict && rows.length > 1) {
      return { data: null, error: { message: `Expected one ${this.s.table} row but found ${rows.length}.` } };
    }
    return { data: rows[0], error: null };
  }

  private async runWrite(): Promise<{ data: Row[] | Row | null; error: DbError | null }> {
    const action = this.s.writeAction;
    try {
      if (action === 'delete') {
        const id = this.idFromEq();
        if (id) {
          await deleteDoc(docRef(this.s.table, id));
        } else {
          const res = await this.runRead();
          if (res.error) return { data: null, error: res.error };
          const rows = (res.data ?? []) as RowWithId[];
          const batch = writeBatch(getFirebaseDb());
          rows.forEach((r) => batch.delete(docRef(this.s.table, r.id)));
          await batch.commit();
        }
        return { data: null, error: null };
      }

      const rows = this.s.payload ?? [];
      const id = this.idFromEq();
      if (action === 'update') {
        const patch = { ...(rows[0] ?? {}), updated_at: nowIso() };
        if (id) {
          const ref = docRef(this.s.table, id);
          const snap = await getDoc(ref);
          if (!snap.exists()) return { data: null, error: { message: 'That record no longer exists.' } };
          await updateDoc(ref, patch);
          return { data: [{ ...(snap.data() as Row), ...patch, id }], error: null };
        }
        // update with a non-id constraint: match and patch each document.
        const res = await this.runRead();
        if (res.error) return { data: null, error: res.error };
        const matched = (res.data ?? []) as RowWithId[];
        const batch = writeBatch(getFirebaseDb());
        matched.forEach((r) => batch.update(docRef(this.s.table, r.id), patch));
        await batch.commit();
        return { data: matched.map((r) => ({ ...r, ...patch })), error: null };
      }

      // insert / upsert
      if (action === 'upsert' && this.s.conflictKey && rows[0]) {
        const key = this.s.conflictKey.split(',')[0]?.trim();
        const keyValue = rows[0][key];
        const found = await fetchList<RowWithId>(this.s.table, {
          where: keyValue === null || keyValue === undefined ? [] : [[key, '==', keyValue] as DbWhere],
          limit: 1,
        });
        if (found.length > 0) {
          const ref = docRef(this.s.table, found[0].id);
          const patch = { ...rows[0], updated_at: nowIso() };
          await updateDoc(ref, patch);
          return { data: [{ ...(found[0] as Row), ...patch }], error: null };
        }
      }

      const out: RowWithId[] = [];
      for (const row of rows) {
        const id = (row.id as string) || newId();
        const payload = { ...row, created_at: (row.created_at as string) ?? nowIso(), updated_at: nowIso() };
        delete (payload as Row).id;
        await setDoc(docRef(this.s.table, id), payload);
        out.push({ ...payload, id });
      }
      return { data: out, error: null };
    } catch (e) {
      return { data: null, error: friendlyFirestoreError(e) };
    }
  }

  /** When the chain ends with `eq('id', x)` we can target one document. */
  private idFromEq(): string | null {
    const last = this.s.where[this.s.where.length - 1];
    if (last && last[0] === 'id' && last[1] === '==' && typeof last[2] === 'string') return last[2];
    // Also accept an id embedded anywhere in the eq list.
    const hit = this.s.where.find(([f, op, v]) => f === 'id' && op === '==' && typeof v === 'string');
    return hit ? (hit[2] as string) : null;
  }

  then<TResult1 = { data: unknown; error: DbError | null; count?: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: DbError | null; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const run = this.s.mode === 'write' ? this.runWrite() : this.runRead();
    return run.then(onfulfilled as never, onrejected as never);
  }
}

function predicateOnRow(row: Row, predicate: string): boolean {
  // Supports a small subset: field.eq.value, field.not.eq.value
  const m = predicate.match(/^([\w.]+)\.(\w+)\.(.+)$/);
  if (!m) return true;
  const field = m[1].split('.').pop() as string;
  const op = m[2];
  let value: unknown = m[3];
  if (value === 'null') value = null;
  else if (value === 'true') value = true;
  else if (value === 'false') value = false;
  const actual = row[field];
  if (op === 'eq') return actual === value;
  if (op === 'neq') return actual !== value;
  if (op === 'is' && value === null) return actual === null || actual === undefined;
  return true;
}

/* ── The db surface ───────────────────────────────────────────────────────── */

export { getFirebaseDb };

export const db = {
  from(table: string) {
    return new DbChain(table);
  },
  fetchList,
  fetchRow,
  fetchById,
  writeRow,
  addRow,
  patchRow,
  deleteRow,
  subscribeList,
  bumpCounter,
  rowFromDoc,
  nowIso,
  newId,
  col,
  docRef,
  getFirebaseDb,
};

export type QueryBuilderLike = ReturnType<typeof db.from>;

/* Supabase-shape compatibility for call sites that used `.auth` / `.storage`. */
export const authCompat = {
  signOut: async () => { /* handled by AuthContext via Firebase */ },
};
