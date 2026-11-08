import {getCloud} from '../core/cloud.js';
import {SUPABASE_VAPID_PUBLIC_KEY} from '../core/supabase.js';

const $ = selector => document.querySelector(selector);
const status = $('#notificationStatus');
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const WEEKDAYS = [['Mon','Mo'],['Tue','Tu'],['Wed','We'],['Thu','Th'],['Fri','Fr'],['Sat','Sa'],['Sun','Su']];
const SESSION_DEFS = [
  {id:'sydney',name:'Sydney',openTime:'08:00',marketTimezone:'Australia/Sydney'},
  {id:'tokyo',name:'Tokyo',openTime:'09:00',marketTimezone:'Asia/Tokyo'},
  {id:'london',name:'London',openTime:'08:00',marketTimezone:'Europe/London'},
  {id:'newYork',name:'New York',openTime:'08:00',marketTimezone:'America/New_York'}
];
const WEEKDAY_NAMES = WEEKDAYS.map(([name]) => name);
const SESSION_DAYS = ['Mon','Tue','Wed','Thu','Fri'];
const defaults = {
  weekly:{enabled:true,days:['Mon'],time:'08:00'},
  sessions:{
    sydney:{enabled:false,days:SESSION_DAYS,before:true,minutes:30,start:true,time:'08:00'},
    tokyo:{enabled:false,days:SESSION_DAYS,before:true,minutes:30,start:true,time:'09:00'},
    london:{enabled:true,days:SESSION_DAYS,before:true,minutes:30,start:true,time:'08:00'},
    newYork:{enabled:false,days:SESSION_DAYS,before:true,minutes:30,start:true,time:'08:00'}
  }
};
let activeSubscription = null;
let serviceWorkerReady = null;
let ntfyTopicEdited = false;
let ntfyTopicSaved = false;
let ntfyTopicChanging = false;
let settingsSaveTimer = null;
let sessionDaysById = {};
let activeSessionTimezone = timezone;

function report(text, kind='') {
  status.textContent = text;
  status.className = `notification-status ${kind}`.trim();
}

function applicationServerKey(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

function dayPickerMarkup(selectedDays) {
  return WEEKDAYS.map(([day,label]) => `<label class="weekday-chip" title="${day}"><input type="checkbox" data-day="${day}"${selectedDays.includes(day) ? ' checked' : ''}><span>${label}</span></label>`).join('');
}

function normalizedPreferences(value={}) {
  const weekly = value.weekly || {
    enabled:value.mondayReminder !== false,
    days:value.mondayReminder === false ? [] : ['Mon'],
    time:value.mondayTime || '08:00'
  };
  const sessionTimezone = value.sessionTimezone || 'device';
  const customTimezone = value.customTimezone || timezone;
  const displayTimezone = effectiveSessionTimezone(sessionTimezone, customTimezone);
  const migratePresetTimes = sessionTimezone !== 'custom' && value.sessionTimeBasis !== 'market-local-v1';
  const sessions = {};
  for (const definition of SESSION_DEFS) {
    const localDefault = defaults.sessions[definition.id];
    const convertedDefault = convertSessionTime(localDefault.time, definition.marketTimezone, displayTimezone);
    sessions[definition.id] = {
      ...localDefault,
      time:convertedDefault.time,
      days:shiftedWeekdays(localDefault.days, convertedDefault.dayOffset),
      ...(value.sessions?.[definition.id] || {})
    };
    if (migratePresetTimes) {
      sessions[definition.id].time = convertedDefault.time;
      sessions[definition.id].days = shiftedWeekdays(localDefault.days, convertedDefault.dayOffset);
    }
  }
  if (!value.sessions && (value.londonPrep !== undefined || value.londonOpen !== undefined)) {
    sessions.london = {...sessions.london,enabled:true,
      before:value.londonPrep !== false,
      minutes:Number(value.prepMinutes) || 30,
      start:value.londonOpen !== false};
  }
  for (const definition of SESSION_DEFS) {
    sessions[definition.id] = {...defaults.sessions[definition.id],...(sessions[definition.id] || {})};
    sessions[definition.id].days = WEEKDAY_NAMES.filter(day => (sessions[definition.id].days || SESSION_DAYS).includes(day));
  }
  return {
    ntfyEnabled:value.ntfyEnabled !== false,
    sessionTimezone,
    customTimezone,
    sessionTimeBasis:'market-local-v1',
    weekly:{enabled:weekly.enabled !== false,days:WEEKDAY_NAMES.filter(day => (weekly.days || []).includes(day)),time:weekly.time || '08:00'},
    sessions
  };
}

function effectiveSessionTimezone(mode, customZone=timezone) {
  if (!mode || mode === 'device') return timezone;
  if (mode === 'custom') return customZone || timezone;
  return mode;
}

function timezoneParts(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(date).map(part => [part.type, part.value]));
}

function convertSessionTime(time, fromZone, toZone) {
  const source = timezoneParts(new Date(), fromZone);
  const year = Number(source.year), month = Number(source.month), day = Number(source.day);
  const [hour,minute] = time.split(':').map(Number);
  const desiredWallTime = Date.UTC(year, month - 1, day, hour, minute);
  let instant = desiredWallTime;
  for (let attempt=0; attempt<4; attempt++) {
    const actual = timezoneParts(new Date(instant), fromZone);
    const representedWallTime = Date.UTC(Number(actual.year), Number(actual.month) - 1, Number(actual.day), Number(actual.hour), Number(actual.minute));
    instant += desiredWallTime - representedWallTime;
  }
  const converted = timezoneParts(new Date(instant), toZone);
  const convertedDate = Date.UTC(Number(converted.year), Number(converted.month) - 1, Number(converted.day));
  const sourceDate = Date.UTC(year, month - 1, day);
  return {
    time:`${converted.hour}:${converted.minute}`,
    dayOffset:Math.round((convertedDate - sourceDate) / 86400000)
  };
}

function shiftedWeekdays(days, offset) {
  if (!offset) return days;
  return days.map(day => WEEKDAY_NAMES[(WEEKDAY_NAMES.indexOf(day) + offset + WEEKDAY_NAMES.length) % WEEKDAY_NAMES.length]);
}

function populateCustomTimezoneOptions() {
  const picker = $('#sessionTimezoneMode');
  const zones = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['UTC','Australia/Sydney','Asia/Tokyo','Europe/London','America/New_York','Asia/Kolkata'];
  const available = [...new Set(['UTC', timezone, ...zones])].map(zone => {
    const offsetText = new Intl.DateTimeFormat('en-US', {
      timeZone:zone, timeZoneName:'longOffset'
    }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value || 'GMT';
    const match = offsetText.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    const offsetMinutes = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] || 0)) : 0;
    const sign = offsetMinutes < 0 ? '-' : '+';
    const absolute = Math.abs(offsetMinutes);
    const hours = Math.floor(absolute / 60);
    const minutes = absolute % 60;
    const offset = minutes ? `${hours}:${String(minutes).padStart(2,'0')}` : String(hours);
    const city = ({'Asia/Calcutta':'Kolkata','Asia/Katmandu':'Kathmandu','Europe/Kiev':'Kyiv'}[zone]
      || zone.split('/').at(-1).replaceAll('_',' '));
    return {zone, offsetMinutes, city, label:`(UTC${sign}${offset}) ${city}`};
  }).sort((a,b) => a.offsetMinutes - b.offsetMinutes || a.city.localeCompare(b.city));
  const currentValue = picker.value;
  const deviceZone = available.find(item => item.zone === timezone);
  const deviceLabel = deviceZone ? `${deviceZone.label} · Device time zone` : `Device time zone (${timezone})`;
  picker.innerHTML = `<option value="device">${deviceLabel}</option>${available
    .map(({zone,label}) => `<option value="${zone}">${label}</option>`).join('')}<option value="custom">Custom time zone</option>`;
  if ([...picker.options].some(option => option.value === currentValue)) picker.value = currentValue;
}

function setSessionTimesForTimezone(toZone) {
  for (const definition of SESSION_DEFS) {
    const root = $(`[data-session="${definition.id}"]`);
    const timeInput = root.querySelector('[data-field="time"]');
    const converted = convertSessionTime(definition.openTime, definition.marketTimezone, toZone);
    timeInput.value = converted.time;
    sessionDaysById[definition.id] = shiftedWeekdays(SESSION_DAYS, converted.dayOffset);
  }
}

function readPreferences() {
  const sessionValues = {};
  for (const definition of SESSION_DEFS) {
    const root = $(`[data-session="${definition.id}"]`);
    sessionValues[definition.id] = {
      enabled:root.querySelector('[data-field="enabled"]').checked,
      before:root.querySelector('[data-field="before"]').checked,
      minutes:Number(root.querySelector('[data-field="minutes"]').value) || 30,
      start:root.querySelector('[data-field="start"]').checked,
      time:root.querySelector('[data-field="time"]').value || definition.openTime,
      days:sessionDaysById[definition.id] || SESSION_DAYS
    };
  }
  return {
    ntfyEnabled:$('#ntfyEnabled').checked,
    sessionTimezone:$('#sessionTimezoneMode').value,
    customTimezone:activeSessionTimezone || timezone,
    sessionTimeBasis:'market-local-v1',
    weekly:{
      enabled:$('#weeklyReminder').checked,
      time:$('#weeklyReminderTime').value || '08:00',
      days:Array.from(document.querySelectorAll('#weeklyDays [data-day]:checked'),input => input.dataset.day)
    },
    sessions:sessionValues
  };
}

function renderSessionCards() {
  $('#sessionAlertList').innerHTML = SESSION_DEFS.map(definition => `
    <article class="session-alert-card" data-session="${definition.id}">
      <div class="session-alert-head">
        <label class="session-alert-name"><input data-field="enabled" type="checkbox"><span>${definition.name}</span></label>
      </div>
      <div class="session-alert-controls">
        <input data-field="time" type="time" value="${definition.openTime}" aria-label="${definition.name} session alert time">
        <div class="session-alert-options">
          <label class="session-alert-chip"><input data-field="start" type="checkbox"><span>At open</span></label>
          <label class="session-alert-chip"><input data-field="before" type="checkbox"><span>Before</span></label>
          <select data-field="minutes" aria-label="How long before ${definition.name}"><option value="15">15 min</option><option value="30">30 min</option><option value="60">1 hour</option></select>
        </div>
      </div>
    </article>`).join('');
}

function writePreferences(value={}) {
  const prefs = normalizedPreferences(value);
  $('#weeklyReminder').checked = prefs.weekly.enabled;
  $('#weeklyReminderTime').value = prefs.weekly.time;
  $('#weeklyDays').innerHTML = dayPickerMarkup(prefs.weekly.days);
  $('#ntfyEnabled').checked = Boolean($('#ntfyTopic').value.trim()) && prefs.ntfyEnabled;
  $('#ntfyEnabled').disabled = !ntfyTopicSaved;
  const picker = $('#sessionTimezoneMode');
  const isKnownZone = [...picker.options].some(option => option.value === prefs.sessionTimezone);
  picker.value = isKnownZone ? prefs.sessionTimezone : 'custom';
  activeSessionTimezone = picker.value === 'custom'
    ? (isKnownZone ? prefs.customTimezone : prefs.sessionTimezone)
    : effectiveSessionTimezone(picker.value, prefs.customTimezone);
  for (const definition of SESSION_DEFS) {
    const root = $(`[data-session="${definition.id}"]`);
    const session = prefs.sessions[definition.id];
    root.querySelector('[data-field="enabled"]').checked = session.enabled;
    root.querySelector('[data-field="before"]').checked = session.before;
    root.querySelector('[data-field="minutes"]').value = String(session.minutes);
    root.querySelector('[data-field="start"]').checked = session.start;
    root.querySelector('[data-field="time"]').value = session.time || definition.openTime;
    sessionDaysById[definition.id] = session.days || SESSION_DAYS;
  }
}

async function storeSubscription(subscription, preferences=readPreferences()) {
  const db = getCloud();
  const {data:{user},error:userError} = await db.auth.getUser();
  if (userError || !user) throw new Error('Sign in again to enable device reminders.');
  const {error} = await db.from('push_subscriptions').upsert({
    user_id:user.id,
    endpoint:subscription.endpoint,
    subscription:subscription.toJSON(),
    timezone,
    preferences
  }, {onConflict:'endpoint'});
  if (error) throw error;
}

function currentNtfyTopic() {
  const topic = $('#ntfyTopic').value.trim();
  if (topic && !/^[A-Za-z0-9_-]{1,64}$/.test(topic)) {
    throw new Error('Use 1–64 letters, numbers, underscores, or hyphens for the ntfy topic.');
  }
  return topic || null;
}

function activeNtfyTopic() {
  return $('#ntfyEnabled').checked ? currentNtfyTopic() : null;
}

async function storeAccountAlertSettings(preferences=readPreferences()) {
  const db = getCloud();
  const {data:{user},error:userError} = await db.auth.getUser();
  if (userError || !user) throw new Error('Sign in again to save alert settings.');
  const {error} = await db.from('notification_settings').upsert({
    user_id:user.id,
    ntfy_topic:currentNtfyTopic(),
    timezone,
    preferences
  }, {onConflict:'user_id'});
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') {
      throw new Error('Run supabase/ntfy-settings.sql in the Supabase SQL Editor, then reload this page.');
    }
    throw error;
  }
}

async function loadAccountAlertSettings() {
  const db = getCloud();
  const {data:{user}} = await db.auth.getUser();
  if (!user) return;
  const {data,error} = await db.from('notification_settings')
    .select('ntfy_topic,preferences').eq('user_id',user.id).maybeSingle();
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') {
      throw new Error('Run supabase/ntfy-settings.sql in the Supabase SQL Editor to enable ntfy settings.');
    }
    throw error;
  }
  if (data) {
    if (!ntfyTopicEdited) $('#ntfyTopic').value = data.ntfy_topic || '';
    ntfyTopicSaved = Boolean(data.ntfy_topic);
    $('#ntfyTopic').readOnly = ntfyTopicSaved;
    $('#ntfyTopicSave').textContent = ntfyTopicSaved ? 'Change' : 'Save';
    writePreferences(data.preferences || {});
    if (data.preferences?.sessionTimezone !== 'custom'
      && data.preferences?.sessionTimeBasis !== 'market-local-v1') queueSettingsSave();
  }
}

async function loadSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const registration = serviceWorkerReady
    ? await serviceWorkerReady
    : await navigator.serviceWorker.getRegistration(location.href);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const {data,error} = await getCloud().from('push_subscriptions')
    .select('endpoint').eq('endpoint', subscription.endpoint).maybeSingle();
  if (error) {
    activeSubscription = null;
    report('Could not verify this browser’s push registration. Try enabling notifications again.', 'error');
    return;
  }
  if (!data) {
    // A browser can retain a local PushSubscription after its database row was
    // removed or never saved. Treat it as unregistered so Enable can upsert it.
    activeSubscription = null;
    $('#notificationEnable').hidden = false;
    $('#notificationDisable').hidden = true;
    report('This browser is not registered with your account yet. Enable notifications on this device.', 'error');
    return;
  }
  activeSubscription = subscription;
  $('#notificationEnable').hidden = true;
  $('#notificationDisable').hidden = false;
  report('Reminders are enabled on this browser.', 'success');
}

async function enableOnThisDevice() {
  if (!window.isSecureContext) throw new Error('This page is not in a secure context. Open the deployed HTTPS site, or test on localhost.');
  if (!('serviceWorker' in navigator)) throw new Error('This browser or embedded preview blocks service workers. Open the site directly in a full browser.');
  if (!('PushManager' in window) || !('Notification' in window)) throw new Error('This browser does not support web push. Try a current version of Chrome, Edge, Firefox, or Safari.');
  if (!SUPABASE_VAPID_PUBLIC_KEY || SUPABASE_VAPID_PUBLIC_KEY.startsWith('YOUR_')) {
    throw new Error('Add the public VAPID key to js/core/supabase.js, then reload this page.');
  }
  // Request permission directly from the click handler, then wait for the
  // service worker. Keeping these sequential works around browsers that have
  // trouble with a permission prompt and push registration happening together.
  let permission = Notification.permission;
  if (permission === 'denied') {
    throw new Error('Notifications are blocked for this site. Change this site’s notification permission to Allow in browser settings, then try again.');
  }
  if (permission !== 'granted') permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notifications are blocked for this site in browser settings.' : 'Allow notifications to enable reminders.');
  const registration = serviceWorkerReady
    ? await serviceWorkerReady
    : await navigator.serviceWorker.register('./sw.js');
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:applicationServerKey(SUPABASE_VAPID_PUBLIC_KEY)});
    } catch (error) {
      if (error?.name === 'AbortError' && /push service/i.test(error.message || '')) {
        throw new Error('This browser could not reach its push service. Check its internet connection, VPN, firewall, or privacy extensions, then retry. You can also try an up-to-date Chrome, Edge, or Firefox browser.');
      }
      if (error?.name === 'InvalidAccessError') {
        throw new Error('This browser rejected the VAPID public key. Confirm it matches the VAPID pair configured in Supabase, then reload.');
      }
      throw error;
    }
  }
  await storeSubscription(subscription);
  activeSubscription = subscription;
  $('#notificationEnable').hidden = true;
  $('#notificationDisable').hidden = false;
  report('This browser is connected and the selected reminders are on.', 'success');
}

async function saveSettings() {
  const preferences = readPreferences();
  await storeAccountAlertSettings(preferences);
  if (activeSubscription) await storeSubscription(activeSubscription, preferences);
  report('Alert settings saved for your account.', 'success');
}

function queueSettingsSave() {
  clearTimeout(settingsSaveTimer);
  report('Saving alert settings…');
  settingsSaveTimer = setTimeout(async () => {
    try { await saveSettings(); }
    catch (error) { report(error.message || 'Could not save reminder settings.', 'error'); }
  }, 650);
}

function handleSessionTimezoneModeChange() {
  const mode = $('#sessionTimezoneMode').value;
  if (mode === 'custom') {
    queueSettingsSave();
    return;
  }
  const targetZone = mode === 'device' ? timezone : mode;
  setSessionTimesForTimezone(targetZone);
  activeSessionTimezone = targetZone;
  queueSettingsSave();
}

async function saveNtfyTopic() {
  const topic = currentNtfyTopic();
  if (!topic) throw new Error('Enter an ntfy topic before saving.');
  const previousEnabled = $('#ntfyEnabled').checked;
  $('#ntfyEnabled').checked = true;
  try {
    await storeAccountAlertSettings(readPreferences());
  } catch (error) {
    $('#ntfyEnabled').checked = previousEnabled;
    throw error;
  }
  $('#ntfyTopic').value = topic || '';
  ntfyTopicSaved = true;
  ntfyTopicChanging = false;
  $('#ntfyTopic').readOnly = true;
  $('#ntfyEnabled').disabled = false;
  $('#ntfyTopicSave').textContent = 'Change';
  report('ntfy topic saved and enabled.', 'success');
}

async function saveNtfyEnabled() {
  if (!ntfyTopicSaved) {
    $('#ntfyEnabled').checked = false;
    return;
  }
  const enabled = $('#ntfyEnabled').checked;
  try {
    await storeAccountAlertSettings(readPreferences());
    report(enabled ? 'ntfy notifications are on.' : 'ntfy notifications are off. Browser reminders remain enabled on registered devices.', 'success');
  } catch (error) {
    $('#ntfyEnabled').checked = !enabled;
    throw error;
  }
}

async function disableOnThisDevice() {
  if (!activeSubscription) return;
  const endpoint = activeSubscription.endpoint;
  const {error} = await getCloud().from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw error;
  await activeSubscription.unsubscribe();
  activeSubscription = null;
  $('#notificationEnable').hidden = false;
  $('#notificationDisable').hidden = true;
  report('Reminders are off on this browser.');
}

async function sendTestNotification() {
  const topic = activeNtfyTopic();
  if (!activeSubscription && !topic) throw new Error('Enter and save an ntfy topic or enable browser notifications first.');
  const outcomes = [];
  const failures = [];

  // Publish directly from this browser so ntfy rate-limits the actual user,
  // not a shared Supabase Edge Function IP address.
  if (topic) {
    try {
      const response = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method:'POST',
        headers:{'Title':'Trade Journal test','Tags':'white_check_mark'},
        body:'ntfy is connected. Your Trade Journal alerts can arrive here.'
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        if (response.status === 429) {
          throw new Error(`ntfy is rate-limiting this sender (HTTP 429${detail.code ? `, code ${detail.code}` : ''}). Your topic name is valid; wait before retrying.`);
        }
        throw new Error(`ntfy rejected the request (HTTP ${response.status}). ${detail.error || 'Check ntfy availability and try again.'}`);
      }
      outcomes.push('ntfy');
    } catch (error) {
      failures.push(error.message || 'Could not send to ntfy.');
    }
  }

  if (activeSubscription) {
    try {
      const {data,error} = await getCloud().functions.invoke('test-notification');
      if (error) {
        const response = error.context;
        if (response instanceof Response) {
          try {
            const detail = await response.clone().json();
            if (detail?.error) throw new Error(detail.error);
          } catch (detailError) {
            if (detailError instanceof Error && detailError.message !== 'Unexpected end of JSON input') throw detailError;
          }
        }
        throw error;
      }
      if (!data?.sent) throw new Error(data?.message || 'Browser push test was not delivered.');
      outcomes.push('browser push');
    } catch (error) {
      failures.push(error.message || 'Could not send browser push.');
    }
  }

  if (!outcomes.length) throw new Error(failures.join(' '));
  if (failures.length) report(`Sent via ${outcomes.join(' and ')}. ${failures.join(' ')}`, 'error');
  else report(`Test notification sent via ${outcomes.join(' and ')}.`, 'success');
}

async function sendManualSessionAlert() {
  const session = SESSION_DEFS.find(item => item.id === $('#sessionManualSelect').value);
  if (!session) throw new Error('Choose a session first.');
  const topic = activeNtfyTopic();
  if (!activeSubscription && !topic) throw new Error('Save an ntfy topic or enable browser notifications first.');
  const title = `${session.name} session has begun`;
  const body = `The ${session.name} session is open. Review your plan and stay focused.`;
  const outcomes = [];
  const failures = [];

  if (topic) {
    try {
      const response = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method:'POST',
        headers:{'Title':title,'Tags':'bell'},
        body
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(response.status === 429
          ? `ntfy is rate-limiting this sender (HTTP 429${detail.code ? `, code ${detail.code}` : ''}). Wait before retrying.`
          : `ntfy rejected the request (HTTP ${response.status}). ${detail.error || ''}`);
      }
      outcomes.push('ntfy');
    } catch (error) { failures.push(error.message || 'Could not send to ntfy.'); }
  }

  if (activeSubscription) {
    try {
      const {data,error} = await getCloud().functions.invoke('test-notification', {body:{sessionId:session.id}});
      if (error) {
        const response = error.context;
        if (response instanceof Response) {
          try {
            const detail = await response.clone().json();
            if (detail?.error) throw new Error(detail.error);
          } catch (detailError) {
            if (detailError instanceof Error && detailError.message !== 'Unexpected end of JSON input') throw detailError;
          }
        }
        throw error;
      }
      if (!data?.sent) throw new Error(data?.message || 'No browser subscriptions received the alert.');
      outcomes.push('browser push');
    } catch (error) { failures.push(error.message || 'Could not send browser push.'); }
  }

  if (!outcomes.length) throw new Error(failures.join(' '));
  if (failures.length) report(`Sent ${session.name} alert via ${outcomes.join(' and ')}. ${failures.join(' ')}`, 'error');
  else report(`Manual ${session.name} session alert sent via ${outcomes.join(' and ')}.`, 'success');
}

export function initNotifications() {
  renderSessionCards();
  populateCustomTimezoneOptions();
  writePreferences();
  $('#weeklyTimezone').textContent = timezone;
  $('#ntfyTopic').addEventListener('input', () => { ntfyTopicEdited = true; });
  $('#notificationOptions').addEventListener('change', event => {
    if (event.target.matches('[data-field="time"]')) {
      $('#sessionTimezoneMode').value = 'custom';
    }
    if (event.target.matches('input:not(#ntfyTopic):not(#ntfyEnabled), select:not(#sessionTimezoneMode)')) queueSettingsSave();
  });
  $('#sessionTimezoneMode').addEventListener('change', handleSessionTimezoneModeChange);
  if (window.isSecureContext && 'serviceWorker' in navigator) {
    serviceWorkerReady = navigator.serviceWorker.register('./sw.js').then(async registration => {
      await navigator.serviceWorker.ready;
      return registration;
    });
  }
  $('#notificationEnable').addEventListener('click', async () => {
    report('Connecting this browser…');
    try { await enableOnThisDevice(); }
    catch (error) { report(error.message || 'Could not enable notifications.', 'error'); }
  });
  $('#notificationSave').addEventListener('click', async () => {
    try { await saveSettings(); }
    catch (error) { report(error.message || 'Could not save reminder settings.', 'error'); }
  });
  $('#ntfyTopicSave').addEventListener('click', async () => {
    if (ntfyTopicSaved && !ntfyTopicChanging) {
      ntfyTopicChanging = true;
      $('#ntfyTopic').readOnly = false;
      $('#ntfyTopic').focus();
      $('#ntfyTopicSave').textContent = 'Save';
      return;
    }
    try { await saveNtfyTopic(); }
    catch (error) { report(error.message || 'Could not save the ntfy topic.', 'error'); }
  });
  $('#ntfyEnabled').addEventListener('change', async () => {
    try { await saveNtfyEnabled(); }
    catch (error) { report(error.message || 'Could not update ntfy notifications.', 'error'); }
  });
  $('#notificationDisable').addEventListener('click', async () => {
    try { await disableOnThisDevice(); }
    catch (error) { report(error.message || 'Could not disable notifications.', 'error'); }
  });
  $('#notificationTest').addEventListener('click', async () => {
    try { await sendTestNotification(); }
    catch (error) { report(error.message || 'Could not send the test notification.', 'error'); }
  });
  $('#sessionManualSend').addEventListener('click', async () => {
    const button = $('#sessionManualSend');
    button.disabled = true;
    try { await sendManualSessionAlert(); }
    catch (error) { report(error.message || 'Could not send the session alert.', 'error'); }
    finally { button.disabled = false; }
  });
  loadAccountAlertSettings().catch(error => report(error.message || 'Could not load account alert settings.', 'error'));
  loadSubscription().catch(error => report(error.message || 'Could not load notification settings.', 'error'));
}
