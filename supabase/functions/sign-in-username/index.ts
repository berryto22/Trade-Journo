import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  const { username, password } = await request.json().catch(() => ({}));
  const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (!/^[^@\s]+$/.test(normalizedUsername) || typeof password !== 'string' || !password) {
    return respond({ error: 'Enter a username and password.' }, 400);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return respond({ error: 'Username sign-in is not configured.' }, 500);

  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const matches: string[] = [];
    for (let page = 1; ; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      for (const user of data.users) {
        const email = user.email?.trim();
        if (email && email.split('@')[0].toLowerCase() === normalizedUsername) matches.push(email);
      }
      if (matches.length > 1 || data.users.length < 1000) break;
    }

    if (matches.length !== 1) return respond({ error: 'Invalid username or password. You can also sign in with your email.' }, 401);
    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await auth.auth.signInWithPassword({ email: matches[0], password });
    if (error || !data.session) return respond({ error: 'Invalid username or password. You can also sign in with your email.' }, 401);
    return respond({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  } catch (error) {
    console.error('Username sign-in error:', error);
    return respond({ error: 'Username sign-in is temporarily unavailable.' }, 500);
  }
});
