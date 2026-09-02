/**
 * Runtime configuration.
 *
 * Only the PUBLIC Supabase client credentials live here. Row Level Security
 * (supabase/sql/0008_rls_policies.sql) is what actually protects data — the
 * publishable key is safe to ship to the browser.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const env = {
  supabaseUrl: url ?? '',
  supabaseAnonKey: anonKey ?? '',
  defaultCountry: (import.meta.env.VITE_DEFAULT_COUNTRY as string | undefined) ?? 'ZM',
  defaultCurrency: (import.meta.env.VITE_DEFAULT_CURRENCY as string | undefined) ?? 'ZMW',
  isDev: import.meta.env.DEV,
  /** Public site origin, used to build shareable document/payment links. */
  appUrl: typeof window !== 'undefined' ? window.location.origin : '',
};

/** True when Supabase credentials are present and well-formed. */
export const isSupabaseConfigured =
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(env.supabaseUrl) &&
  env.supabaseAnonKey.length > 20;

/**
 * Human-readable guidance shown by <SupabaseGate/> when the backend is not
 * reachable or not yet provisioned. Never guess: the app must not pretend to
 * hold data it does not have.
 */
export const supabaseSetupHint = !env.supabaseUrl
  ? 'VITE_SUPABASE_URL is missing. Copy .env.example to .env and set your project URL.'
  : !env.supabaseAnonKey
    ? 'VITE_SUPABASE_ANON_KEY is missing. Use your project\u2019s publishable (anon) key.'
    : !isSupabaseConfigured
      ? 'The Supabase URL does not look like https://<project-ref>.supabase.co — check .env.'
      : '';
