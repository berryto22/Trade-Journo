import {initCloud, loadAccountData, stopCloud, getCloud, saveProfile, loadProfile, uploadAvatar, avatarUrl} from './core/cloud.js';
import {configured, setRememberSession} from './core/supabase.js';

const $ = selector => document.querySelector(selector);
const authScreen = $('#authScreen');
const appShell = $('#appShell');
const authMessage = $('#authMessage');
let mode = 'signin';
let appReady = false;
let profile = null;
let avatarPath = null;
let recoveringPassword = false;
let appBootstrap = null;

function message(el, text, kind='') {
  el.textContent = text;
  el.className = `${el.id === 'authMessage' ? 'auth-message' : 'account-message'} ${kind}`.trim();
}

function showAuth() {
  stopCloud();
  appShell.classList.add('hidden');
  $('#appSettingsPage').classList.add('hidden');
  $('#stickyDock').hidden = true;
  $('#stickyNoteLayer').hidden = true;
  $('#sessionLoader').classList.add('hidden');
  document.body.classList.remove('session-pending');
  authScreen.classList.remove('hidden');
}

async function showApp(user) {
  if (appBootstrap?.userId === user.id) return appBootstrap.promise;
  const promise = showAppForUser(user);
  appBootstrap = {userId:user.id, promise};
  return promise;
}

async function showAppForUser(user) {
  await loadAccountData(user);
  $('#sessionLoader').classList.add('hidden');
  document.body.classList.remove('session-pending');
  authScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  const label = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Account';
  $('#accountTriggerName').textContent = label;
  $('#accountAvatar').textContent = label.slice(0,1).toUpperCase();
  if (!appReady) {
    const {events} = await import('./core/events.js');
    const {initThemePicker} = await import('./ui/themePicker.js?v=themes-gallery-6');
    const {initFeatures} = await import('./features/index.js?v=draft-autosave-1');
    const {initForm, openForm, restoreDraft} = await import('./ui/form.js?v=draft-autosave-1');
    const {initList, renderList} = await import('./ui/entryCard.js?v=vertical-calendar-3');
    const {initAnalysis} = await import('./ui/analysis.js?v=account-load-fix-3');
    const {initPhaseLab} = await import('./ui/phaseLab.js?v=phase-lab-1');
    const {initDateHistory} = await import('./ui/dateHistory.js?v=vertical-calendar-11');
    const {initNotifications} = await import('./ui/notifications.js?v=alerts-24');
    initThemePicker(); initFeatures(); initForm(); initList({onEdit:openForm}); initAnalysis(); initPhaseLab(); renderList(); initDateHistory(); restoreDraft();
    initNotifications();
    $('#btnSettings').addEventListener('click', () => {
      $('#appSettingsPage').classList.remove('hidden');
      $('#settingsAlertsTab').focus();
    });
    $('#settingsBack').addEventListener('click', () => $('#appSettingsPage').classList.add('hidden'));
    $('#settingsAlertsTab').addEventListener('click', () => {
      $('#settingsAlertsTab').classList.add('active');
      $('#settingsAlertsTab').setAttribute('aria-selected','true');
      $('#settingsAlertsPanel').hidden = false;
    });
    const {initStickyNotes} = await import('./ui/stickyNotes.js?v=note-front-2');
    initStickyNotes();
    events.on('layout:changed', renderList);
    events.on('schema:changed', renderList);
    window.addEventListener('cloud:sync-error', () => {
      const node = document.createElement('div');
      node.className = 'sync-status'; node.textContent = 'Could not sync your latest changes. Check your connection.';
      document.body.append(node); setTimeout(() => node.remove(), 5000);
    });
    appReady = true;
  }
}

function setMode(next) {
  mode = next;
  const signup = mode === 'signup';
  $('#authKicker').textContent = signup ? 'A BETTER TRADING ROUTINE' : mode === 'recovery' ? 'RESET YOUR PASSWORD' : 'WELCOME BACK';
  $('#authTitle').textContent = signup ? 'Create account' : mode === 'recovery' ? 'Choose a new password' : 'Sign in';
  $('#authSubtitle').textContent = signup ? 'Start building a clearer view of every trade.' : mode === 'recovery' ? 'Use a new password for your account.' : 'Pick up where your trading journey left off.';
  $('#authNameField').classList.toggle('hidden', !signup);
  $('#authForgot').classList.toggle('hidden', signup || mode === 'recovery');
  $('#authPassword').autocomplete = signup || mode === 'recovery' ? 'new-password' : 'current-password';
  $('#authPassword').placeholder = mode === 'recovery' ? 'Choose a new password' : 'At least 8 characters';
  $('#authPassword').minLength = signup || mode === 'recovery' ? 8 : 1;
  $('#authEmail').placeholder = signup ? 'you@example.com' : mode === 'recovery' ? 'you@example.com' : 'Username or email';
  $('#authSubmit').innerHTML = `${signup ? 'Create account' : mode === 'recovery' ? 'Save new password' : 'Sign in'} <span>→</span>`;
  $('#authSwitchText').classList.toggle('hidden', mode === 'recovery');
  $('#authSwitchText').innerHTML = signup ? 'Already have an account? <button type="button" id="authSwitch">Sign in</button>' : 'New to Trade Journal? <button type="button" id="authSwitch">Create account</button>';
  $('#authSwitch').onclick = () => setMode(signup ? 'signin' : 'signup');
  message(authMessage, '');
}

function setPhoto(url, fallback) {
  for (const node of [$('#accountAvatar'), $('#profilePhoto')]) {
    node.textContent = fallback;
    node.style.backgroundImage = url ? `url("${url}")` : '';
    node.classList.toggle('has-photo', !!url);
  }
}

async function openAccount() {
  const user = getCloud().auth.getUser ? (await getCloud().auth.getUser()).data.user : null;
  if (!user) return;
  $('#accountPanel').classList.remove('hidden'); $('#accountBackdrop').classList.remove('hidden');
  $('#profileEmail').value = user.email || '';
  $('#profileUsername').value = user.email?.split('@')[0] || '';
  $('#profileName').value = profile?.full_name || user.user_metadata?.full_name || '';
  $('#profilePhone').value = profile?.phone || '';
  avatarPath = profile?.avatar_path || null;
  const url = avatarPath ? await avatarUrl(avatarPath) : '';
  setPhoto(url, ($('#profileName').value || user.email || 'A').slice(0,1).toUpperCase());
}

function closeAccount() { $('#accountPanel').classList.add('hidden'); $('#accountBackdrop').classList.add('hidden'); }

async function loadProfileView() {
  try {
    profile = await loadProfile();
    if (profile?.full_name) $('#accountTriggerName').textContent = profile.full_name;
    const url = profile?.avatar_path ? await avatarUrl(profile.avatar_path) : '';
    setPhoto(url, (profile?.full_name || 'A').slice(0,1).toUpperCase());
  }
  catch (error) { message($('#profileMessage'), error.message, 'error'); }
}

async function boot() {
  const rememberedReturn = new URLSearchParams(location.search).get('remember');
  if (rememberedReturn !== null) setRememberSession(rememberedReturn === '1');
  if (!configured()) {
    message(authMessage, 'Connect a Supabase project to enable sign in. Add its project URL and publishable key in js/core/supabase.js.', 'error');
    $('#authForm').addEventListener('submit', event => event.preventDefault());
    $('#authForgot').disabled = true;
    $('#sessionLoader').classList.add('hidden');
    document.body.classList.remove('session-pending');
    return;
  }
  const db = initCloud();
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      recoveringPassword = true;
      $('#sessionLoader').classList.add('hidden'); document.body.classList.remove('session-pending');
      appShell.classList.add('hidden'); authScreen.classList.remove('hidden');
      setMode('recovery'); return;
    }
    if (event === 'SIGNED_OUT') { showAuth(); location.reload(); return; }
    if (event === 'SIGNED_IN' && session?.user) {
      setTimeout(async () => {
        try { await showApp(session.user); await loadProfileView(); }
        catch (error) { console.error('Account startup failed after sign-in:', error); message(authMessage, `Could not load your account: ${error.message}`, 'error'); showAuth(); }
      }, 0);
    }
  });
  const {data, error} = await db.auth.getSession();
  if (error) { message(authMessage, error.message, 'error'); showAuth(); return; }
  if (recoveringPassword) return;
  if (data.session?.user) {
    try { await showApp(data.session.user); await loadProfileView(); }
    catch (err) { console.error('Account startup failed while restoring session:', err); message(authMessage, `Could not load your account: ${err.message}`, 'error'); showAuth(); }
  } else showAuth();
}

$('#authSwitch').onclick = () => setMode('signup');
function authReturnUrl() {
  const url = new URL(location.href);
  url.searchParams.set('remember', $('#rememberMe').checked ? '1' : '0');
  return url.toString();
}
$('#authForgot').onclick = async () => {
  if (!configured()) return;
  const email = $('#authEmail').value.trim();
  if (!email) return message(authMessage, 'Enter your email address first.', 'error');
  $('#authEmail').value = email;
  const {error} = await getCloud().auth.resetPasswordForEmail(email, {redirectTo:authReturnUrl()});
  message(authMessage, error?.message || 'If that email is registered, a reset link is on its way.', error ? 'error' : 'success');
};

$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!configured()) return;
  const email = $('#authEmail').value.trim(); const password = $('#authPassword').value;
  $('#authEmail').value = email;
  setRememberSession($('#rememberMe').checked);
  const submit = $('#authSubmit'); submit.disabled = true;
  message(authMessage, mode === 'signup' ? 'Creating your account…' : 'Signing you in…');
  try {
    const db = getCloud(); let result;
    if (mode === 'signup') result = await db.auth.signUp({email, password, options:{data:{full_name:$('#authName').value.trim()}, emailRedirectTo:authReturnUrl()}});
    else if (mode === 'recovery') result = await db.auth.updateUser({password});
    else if (mode === 'signin' && !email.includes('@')) {
      const {data, error} = await db.functions.invoke('sign-in-username', {body:{username:email, password}});
      if (error) {
        // Supabase wraps non-2xx Edge Function responses in FunctionsHttpError;
        // its context is the original Response, which contains our useful error.
        let details;
        try {
          details = await error.context?.json();
        } catch {}
        if (typeof details?.error === 'string' && details.error.trim()) throw new Error(details.error);
        if (/failed to send a request|failed to fetch/i.test(error.message || '')) {
          throw new Error('Username sign-in is not available yet. Use your email, or deploy the sign-in-username Edge Function.');
        }
        throw error;
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.access_token || !data?.refresh_token) throw new Error('Username sign-in failed. Try your email address.');
      result = await db.auth.setSession({access_token:data.access_token, refresh_token:data.refresh_token});
    } else result = await db.auth.signInWithPassword({email, password});
    if (result.error) throw result.error;
    if (mode === 'signup' && Array.isArray(result.data.user?.identities) && result.data.user.identities.length === 0) {
      message(authMessage, 'This email is already in use.', 'error');
    }
    else if (mode === 'signup' && !result.data.session) message(authMessage, 'Check your inbox to confirm your email, then sign in.', 'success');
    else if (mode === 'recovery') { setMode('signin'); message(authMessage, 'Password updated. Sign in with your new password.', 'success'); }
  } catch (error) {
    const duplicateEmail = mode === 'signup' && /already (?:been )?(?:registered|exists|in use)|user already exists|email_exists|user_already_exists/i.test(`${error.code || ''} ${error.message || ''}`);
    message(authMessage, duplicateEmail ? 'This email is already in use.' : error.message, 'error');
  }
  finally { submit.disabled = false; }
});

$('#btnAccount').onclick = openAccount; $('#accountClose').onclick = closeAccount; $('#accountBackdrop').onclick = closeAccount;
$('#profileForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const userResult = await getCloud().auth.getUser();
    if (userResult.error) throw userResult.error;
    const nextEmail = $('#profileEmail').value.trim();
    const emailChanged = nextEmail.toLowerCase() !== (userResult.data.user.email || '').toLowerCase();
    if (emailChanged) {
      const {error} = await getCloud().auth.updateUser({email:nextEmail});
      if (error) throw error;
    }
    profile = await saveProfile({full_name:$('#profileName').value.trim(), phone:$('#profilePhone').value.trim(), avatar_path:avatarPath});
    $('#accountTriggerName').textContent = profile.full_name || 'Account';
    setPhoto(avatarPath ? await avatarUrl(avatarPath) : '', (profile.full_name || 'A').slice(0,1).toUpperCase());
    message($('#profileMessage'), emailChanged ? 'Profile saved. Confirm the email change using the link we sent you.' : 'Profile saved.', 'success');
  } catch (error) { message($('#profileMessage'), error.message, 'error'); }
});
$('#profilePhotoInput').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  if (file.size > 2 * 1024 * 1024) { message($('#profileMessage'), 'Choose a photo smaller than 2 MB.', 'error'); return; }
  try {
    avatarPath = await uploadAvatar(file);
    profile = await saveProfile({full_name:$('#profileName').value.trim(), phone:$('#profilePhone').value.trim(), avatar_path:avatarPath});
    setPhoto(await avatarUrl(avatarPath), ($('#profileName').value || 'A').slice(0,1).toUpperCase());
    message($('#profileMessage'), 'Profile photo saved.', 'success');
  } catch (error) { message($('#profileMessage'), error.message, 'error'); }
  event.target.value = '';
});
$('#passwordForm').addEventListener('submit', async event => {
  event.preventDefault(); const password = $('#profilePassword').value;
  try {
    const {error} = await getCloud().auth.updateUser({password});
    if (error) throw error;
    $('#profilePassword').value = ''; message($('#profileMessage'), 'Password updated.', 'success');
  } catch (error) { message($('#profileMessage'), error.message, 'error'); }
});
$('#btnSignOut').onclick = async () => { closeAccount(); await getCloud().auth.signOut(); };
$('#profileName').addEventListener('input', () => setPhoto('', ($('#profileName').value || 'A').slice(0,1).toUpperCase()));

const eyeOpen = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const eyeClosed = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 5.2A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a15.4 15.4 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10.8 10.8 0 0 0 4.1-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
document.querySelectorAll('[data-password-target]').forEach(button => {
  button.addEventListener('click', event => {
    event.preventDefault();
    const input = document.getElementById(button.dataset.passwordTarget);
    if (!input) return;
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    button.setAttribute('aria-pressed', String(visible));
    button.title = visible ? 'Hide password' : 'Show password';
    button.innerHTML = visible ? eyeOpen : eyeClosed;
  });
});

boot();
