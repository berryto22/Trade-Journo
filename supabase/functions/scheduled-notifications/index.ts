import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type PushRow = {
  user_id:string;
  endpoint:string;
  subscription:{endpoint:string;expirationTime:number|null;keys:{p256dh:string;auth:string}};
  timezone:string;
  preferences:Record<string, unknown>;
  last_sent:Record<string, string>;
};
type AccountNotificationSettings = {
  user_id:string;
  ntfy_topic:string|null;
  timezone:string;
  preferences:Record<string, unknown>;
  last_sent:Record<string, string>;
};

const json = (body:Record<string, unknown>, status=200) => new Response(JSON.stringify(body), {
  status, headers:{'Content-Type':'application/json'}
});

function zonedParts(timeZone:string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday:'short', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {...value, date:`${value.year}-${value.month}-${value.day}`, time:`${value.hour}:${value.minute}`};
}

const SESSION_DEFS = [
  {id:'sydney',name:'Sydney',openTime:'08:00'},
  {id:'tokyo',name:'Tokyo',openTime:'09:00'},
  {id:'london',name:'London',openTime:'08:00'},
  {id:'newYork',name:'New York',openTime:'08:00'},
];
const WEEKDAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const BUSINESS_DAYS = ['Mon','Tue','Wed','Thu','Fri'];

function timeBefore(openTime:string, minutes:number) {
  const [hour,minute] = openTime.split(':').map(Number);
  const total = (hour * 60 + minute) - minutes;
  const normalized = (total + 24 * 60) % (24 * 60);
  return {time:`${String(Math.floor(normalized / 60)).padStart(2,'0')}:${String(normalized % 60).padStart(2,'0')}`,dayOffset:total < 0 ? -1 : 0};
}

function withinDueWindow(currentTime:string, targetTime:string, graceMinutes=3) {
  const [currentHour,currentMinute] = currentTime.split(':').map(Number);
  const [targetHour,targetMinute] = targetTime.split(':').map(Number);
  const difference = currentHour * 60 + currentMinute - (targetHour * 60 + targetMinute);
  // Cron starts the job every minute, but the HTTP call is asynchronous and
  // may reach this function after the exact target minute. Keep a short grace
  // window; last_sent prevents duplicates on the following runs.
  return difference >= 0 && difference <= graceMinutes;
}

function previousMarketDay(date:string, weekday:string) {
  const index = WEEKDAY_NAMES.indexOf(weekday);
  const previousDay = WEEKDAY_NAMES[(index + 6) % 7];
  const previousDate = new Date(`${date}T00:00:00Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  return {date:previousDate.toISOString().slice(0,10),weekday:previousDay};
}

function dueReminders(row:Pick<PushRow,'timezone'|'preferences'|'last_sent'>) {
  const due:{key:string;title:string;body:string;tag:string}[] = [];
  const prefs = row.preferences || {};
  const weekly = prefs.weekly || {
    enabled:prefs.mondayReminder !== false,
    days:prefs.mondayReminder === false ? [] : ['Mon'],
    time:prefs.mondayTime || '08:00',
  };
  const local = zonedParts(row.timezone || 'UTC');
  const sessionTimezone = prefs.sessionTimezone === 'custom'
    ? prefs.customTimezone || row.timezone || 'UTC'
    : prefs.sessionTimezone && prefs.sessionTimezone !== 'device'
      ? String(prefs.sessionTimezone)
      : row.timezone || 'UTC';
  const sessionLocal = zonedParts(sessionTimezone);
  const weeklyTime = weekly.time || '08:00';
  if (weekly.enabled !== false && (weekly.days || []).includes(local.weekday) && withinDueWindow(local.time,weeklyTime)) {
    const key = `weekly-${local.date}-${weeklyTime.replace(':','')}`;
    due.push({key,title:'Trading focus reminder',body:`It’s ${local.weekday}. Take a moment to plan your trades and review your chart.`,tag:key});
  }

  for (const definition of SESSION_DEFS) {
    let session = prefs.sessions?.[definition.id];
    if (!session && definition.id === 'london' && (prefs.londonPrep !== undefined || prefs.londonOpen !== undefined)) {
      session = {enabled:true,before:prefs.londonPrep !== false,minutes:prefs.prepMinutes || 30,start:prefs.londonOpen !== false,time:definition.openTime,days:BUSINESS_DAYS};
    }
    if (!session?.enabled) continue;
    const current = sessionLocal;
    const days = (session.days || BUSINESS_DAYS).filter((day:string) => WEEKDAY_NAMES.includes(day));
    if (!days.includes(current.weekday)) continue;
    const openTime = session.time || definition.openTime;
    const minutes = Math.min(60,Math.max(15,Number(session.minutes) || 30));
    const prepTime = timeBefore(openTime,minutes);
    const prepDay = prepTime.dayOffset ? previousMarketDay(current.date,current.weekday) : current;
    if (session.before !== false && withinDueWindow(current.time,prepTime.time) && days.includes(prepDay.weekday)) {
      const key = `session-${definition.id}-before-${prepDay.date}-${prepTime.time.replace(':','')}`;
      due.push({key,title:`${definition.name} session in ${minutes} minutes`,body:`Start your chart analysis and prepare for the ${definition.name} session.`,tag:key});
    }
    if (session.start !== false && withinDueWindow(current.time,openTime)) {
      const key = `session-${definition.id}-start-${current.date}-${openTime.replace(':','')}`;
      due.push({key,title:`${definition.name} session has begun`,body:`The ${definition.name} session is open. Review your plan and stay focused.`,tag:key});
    }
  }
  return due.filter(item => row.last_sent?.[item.key] !== 'sent');
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({error:'Method not allowed.'}, 405);
  const schedulerSecret = Deno.env.get('NOTIFICATION_SCHEDULER_SECRET');
  const providedSchedulerSecret = request.headers.get('x-scheduler-secret');
  if (!schedulerSecret) {
    console.error('Scheduler auth failed: NOTIFICATION_SCHEDULER_SECRET is missing from the function environment.');
    return json({error:'Scheduler secret is missing from Edge Function Secrets.'}, 500);
  }
  if (!providedSchedulerSecret) {
    console.error('Scheduler auth failed: request is missing the x-scheduler-secret header.');
    return json({error:'Scheduler request is missing its secret header.'}, 401);
  }
  if (providedSchedulerSecret !== schedulerSecret) {
    console.error('Scheduler auth failed: Vault secret does not match NOTIFICATION_SCHEDULER_SECRET.');
    return json({error:'Vault and Edge Function scheduler secrets do not match.'}, 401);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
  if (!url || !serviceKey) return json({error:'Notifications are not configured.'}, 500);
  if (publicKey && privateKey) webpush.setVapidDetails(subject, publicKey, privateKey);
  const admin = createClient(url, serviceKey, {auth:{persistSession:false, autoRefreshToken:false}});
  const {data:rows,error} = await admin.from('push_subscriptions').select('user_id,endpoint,subscription,timezone,preferences,last_sent');
  if (error) {
    console.error('Could not load push subscriptions:', error);
    return json({error:'Could not load push subscriptions.'}, 500);
  }

  const {data:settings, error:settingsError} = await admin.from('notification_settings')
    .select('user_id,ntfy_topic,timezone,preferences,last_sent');
  if (settingsError) console.error('Could not load account notification settings; continuing with per-browser preferences:', settingsError);
  const settingsByUser = new Map<string, AccountNotificationSettings>();
  for (const setting of (settings || []) as AccountNotificationSettings[]) {
    settingsByUser.set(setting.user_id, setting);
  }

  let sent = 0;
  let browserDue = 0;
  if (publicKey && privateKey) for (const row of (rows || []) as PushRow[]) {
    // Apply the account's saved schedule to every registered browser. Keep
    // each browser's own timezone so its local alert times stay local.
    const accountSettings = settingsByUser.get(row.user_id);
    const hasAccountSchedule = accountSettings?.preferences
      && Object.keys(accountSettings.preferences).some(key => key !== 'ntfyEnabled');
    const reminderRow = hasAccountSchedule
      ? {...row, preferences:accountSettings.preferences}
      : row;
    let reminders;
    try { reminders = dueReminders(reminderRow); }
    catch (error) { console.error('Invalid timezone on push subscription:', error); continue; }
    browserDue += reminders.length;
    for (const reminder of reminders) {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify({
          title:reminder.title, body:reminder.body, tag:reminder.tag, url:'./'
        }), {TTL:120, urgency:'normal'});
        const lastSent = Object.fromEntries([
          ...Object.entries(row.last_sent || {}),
          [reminder.key, 'sent']
        ].slice(-10));
        const {error:updateError} = await admin.from('push_subscriptions')
          .update({last_sent:lastSent,updated_at:new Date().toISOString()}).eq('endpoint',row.endpoint);
        if (updateError) console.error('Could not record sent reminder:', updateError);
        else row.last_sent = lastSent;
        sent++;
      } catch (error) {
        const status = Number((error as {statusCode?:number})?.statusCode);
        if (status === 404 || status === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint',row.endpoint);
        } else console.error('Could not send browser reminder:', error);
      }
    }
  }

  let ntfySent = 0;
  let ntfyDue = 0;
  for (const row of (settings || []) as AccountNotificationSettings[]) {
    if (row.preferences?.ntfyEnabled === false) continue;
    const topic = row.ntfy_topic || '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) continue;
    let reminders;
    try { reminders = dueReminders(row); }
    catch (error) { console.error('Invalid timezone on account notification settings:', error); continue; }
    ntfyDue += reminders.length;
    for (const reminder of reminders) {
      try {
        const response = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
          method:'POST',
          headers:{'Title':reminder.title,'Tags':'bell'},
          body:reminder.body
        });
        if (!response.ok) throw new Error(`ntfy returned HTTP ${response.status}`);
        const lastSent = Object.fromEntries([
          ...Object.entries(row.last_sent || {}),
          [reminder.key,'sent']
        ].slice(-30));
        const {error:updateError} = await admin.from('notification_settings')
          .update({last_sent:lastSent,updated_at:new Date().toISOString()}).eq('user_id',row.user_id);
        if (updateError) console.error('Could not record sent ntfy reminder:', updateError);
        else row.last_sent = lastSent;
        ntfySent++;
      } catch (error) {
        console.error('Could not send ntfy reminder:', error);
      }
    }
  }
  return json({
    ok:true,
    checkedAt:new Date().toISOString(),
    browserDevices:(rows || []).length,
    browserDue,
    ntfyAccounts:(settings || []).length,
    ntfyDue,
    sent,
    ntfySent
  });
});
