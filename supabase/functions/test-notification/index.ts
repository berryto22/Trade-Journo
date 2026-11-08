import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const json = (body:Record<string, unknown>, status=200) => new Response(JSON.stringify(body), {
  status, headers:{...corsHeaders, 'Content-Type':'application/json'}
});

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', {headers:corsHeaders});
  if (request.method !== 'POST') return json({error:'Method not allowed.'}, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
  const authorization = request.headers.get('Authorization');
  if (!url || !anonKey || !serviceKey) return json({error:'Notifications are not configured.'}, 500);
  if (!authorization) return json({error:'Sign in to send a test notification.'}, 401);

  const userClient = createClient(url, anonKey, {
    global:{headers:{Authorization:authorization}},
    auth:{persistSession:false, autoRefreshToken:false}
  });
  const {data:{user},error:authError} = await userClient.auth.getUser();
  if (authError || !user) return json({error:'Your session is invalid. Sign in again.'}, 401);

  let session:{id:string;name:string}|null = null;
  try {
    const payload = await request.json();
    const sessionId = payload?.sessionId;
    const availableSessions = [
      {id:'sydney',name:'Sydney'},
      {id:'tokyo',name:'Tokyo'},
      {id:'london',name:'London'},
      {id:'newYork',name:'New York'}
    ];
    session = availableSessions.find(item => item.id === sessionId) || null;
  } catch {}

  const admin = createClient(url, serviceKey, {auth:{persistSession:false, autoRefreshToken:false}});
  const {data:subscriptions,error} = await admin.from('push_subscriptions')
    .select('endpoint,subscription').eq('user_id',user.id);
  if (error) {
    console.error('Could not load account push subscriptions:', error);
    return json({error:'Could not load this account’s enabled devices.'}, 500);
  }
  if (!subscriptions?.length) return json({sent:0,message:'No browser notifications are enabled on this account.'});

  let sent = 0;
  let failed = 0;
  if (subscriptions?.length && publicKey && privateKey) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    for (const row of subscriptions) {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify({
          title:session ? `${session.name} session has begun` : 'Trade Journal test',
          body:session
            ? `The ${session.name} session is open. Review your plan and stay focused.`
            : 'Notifications are working for this account on this device.',
          tag:session ? `manual-session-${session.id}-${Date.now()}` : `trade-journal-test-${Date.now()}`,
          url:'./'
        }), {TTL:120, urgency:'normal'});
        sent++;
      } catch (error) {
        failed++;
        const status = Number((error as {statusCode?:number})?.statusCode);
        if (status === 404 || status === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint',row.endpoint);
        } else console.error('Could not send test push:', error);
      }
    }
  }
  if (subscriptions?.length && (!publicKey || !privateKey)) failed += subscriptions.length;
  return json({sent,failed,message:sent ? `Test notification sent to ${sent} browser${sent === 1 ? '' : 's'}.` : 'Push could not be delivered. Check the VAPID keys and enabled device subscriptions.'});
});
