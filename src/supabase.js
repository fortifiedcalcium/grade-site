import { createClient } from "@supabase/supabase-js";

const env = import.meta.env;

export const supabaseConfig = {
  url: env.VITE_SUPABASE_URL,
  anonKey: env.VITE_SUPABASE_ANON_KEY,
};

export const isConfigured = Boolean(supabaseConfig.url && supabaseConfig.anonKey);

// The instructor signs in again on every new visit: the session lives in sessionStorage,
// so closing the tab signs out. (A plain reload keeps you signed in.)
const sessionStore = {
  getItem: (k) => { try { return window.sessionStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { window.sessionStorage.setItem(k, v); } catch { /* storage blocked */ } },
  removeItem: (k) => { try { window.sessionStorage.removeItem(k); } catch { /* storage blocked */ } },
};

let client = null;

/* One shared client: database calls, realtime and auth all go through it. */
export function getDb() {
  if (!client) {
    client = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: sessionStore },
    });
  }
  return client;
}

export const getAuth = () => getDb().auth;
