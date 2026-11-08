// Set these values from Supabase → Project Settings → API.
// The publishable key is safe to use in a browser only with the SQL RLS rules
// in supabase/setup.sql applied. Never put a service_role key here.
export const SUPABASE_URL = 'https://dbgfxmeuivxmbcbssrlr.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_udwTdZ58wTsxNPNjl67lNg_gCRUEvdu';
// Set this to the public VAPID key used by the scheduled push Edge Function.
// It is safe to expose the public key in the browser; never put the private key here.
export const SUPABASE_VAPID_PUBLIC_KEY = 'BFWXgWNibRekQkh0iPc1SLKbCS2YuZw9dSkuubLkE7IFLgPM5LDwaF4tfISAZe5aVrDSN2VtJm4vPKItL6_ZF9w';

const REMEMBER_MS = 90 * 24 * 60 * 60 * 1000;
let rememberSession = false;

export function setRememberSession(remember) {
  rememberSession = !!remember;
}

function decodeRecord(raw, legacyScope='session') {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    if (record && typeof record.value === 'string' && record.scope) return record;
    // Migrate the old Supabase raw session record to the new 90-day format.
    if (record?.access_token || record?.refresh_token) {
      return {value:raw, scope:'remember', expiresAt:Date.now() + REMEMBER_MS, legacy:true};
    }
  } catch {}
  return {value:raw, scope:legacyScope, expiresAt:legacyScope === 'remember' ? Date.now() + REMEMBER_MS : null};
}

const sessionStorageAdapter = {
  async getItem(key) {
    const persistent = decodeRecord(localStorage.getItem(key), 'remember');
    if (persistent?.scope === 'remember') {
      if (persistent.expiresAt > Date.now()) {
        rememberSession = true;
        if (persistent.legacy) localStorage.setItem(key, JSON.stringify({value:persistent.value, scope:'remember', expiresAt:persistent.expiresAt}));
        return persistent.value;
      }
      localStorage.removeItem(key);
    }

    const temporary = decodeRecord(sessionStorage.getItem(key));
    if (temporary?.scope === 'session') {
      rememberSession = false;
      return temporary.value;
    }
    if (temporary?.scope === 'remember' && temporary.expiresAt > Date.now()) {
      rememberSession = true;
      return temporary.value;
    }
    if (temporary) sessionStorage.removeItem(key);
    return null;
  },
  async setItem(key, value) {
    const oldRecord = decodeRecord(localStorage.getItem(key), 'remember') || decodeRecord(sessionStorage.getItem(key));
    const keep = rememberSession || oldRecord?.scope === 'remember';
    const record = JSON.stringify({
      value,
      scope:keep ? 'remember' : 'session',
      expiresAt:keep ? oldRecord?.expiresAt || Date.now() + REMEMBER_MS : null
    });
    if (keep) {
      localStorage.setItem(key, record);
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, record);
      localStorage.removeItem(key);
    }
  },
  async removeItem(key) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
};

export const configured = () =>
  window.supabase?.createClient &&
  !SUPABASE_URL.includes('YOUR_PROJECT_ID') &&
  !SUPABASE_PUBLISHABLE_KEY.includes('YOUR_SUPABASE');

export const client = () => configured()
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth:{storage:sessionStorageAdapter, persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}
    })
  : null;
