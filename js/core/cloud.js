import {client as getClient} from './supabase.js';

let api = null;
let activeUser = null;
let syncTimer = null;
let ready = false;

export const initCloud = () => (api ||= getClient());
export const getCloud = () => api;
export const currentUser = () => activeUser;

const snapshot = () => {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('journal_') || key === 'tradeJournalDashboard') {
      data[key] = localStorage.getItem(key);
    }
  }
  return data;
};

const clearLocalAppData = () => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('journal_') || key === 'tradeJournalDashboard') localStorage.removeItem(key);
  }
};

const markLocalVideos = (value, key='') => {
  if (!value || typeof value !== 'object') return;
  if (value.kind === 'local' && value.blobKey && (value.mime?.startsWith('video/') || key === 'video')) {
    value.localOnly = true;
  }
  Object.entries(value).forEach(([childKey, child]) => markLocalVideos(child, childKey));
};

export async function loadAccountData(user) {
  const db = initCloud();
  const {data, error} = await db.from('user_data').select('payload').eq('user_id', user.id).maybeSingle();
  if (error) throw error;

  const owner = localStorage.getItem('journal_owner_id');
  const canMigrate = !owner || owner === user.id;
  if (data?.payload) {
    clearLocalAppData();
    Object.entries(data.payload).forEach(([key, value]) => localStorage.setItem(key, value));
  } else if (canMigrate) {
    const localEntries = JSON.parse(localStorage.getItem('journal_entries') || '[]');
    localEntries.forEach(entry => markLocalVideos(entry.values || entry));
    localStorage.setItem('journal_entries', JSON.stringify(localEntries));
    const payload = snapshot();
    const {error: saveError} = await db.from('user_data').upsert({user_id:user.id, payload}, {onConflict:'user_id'});
    if (saveError) throw saveError;
  } else {
    clearLocalAppData();
  }
  localStorage.setItem('journal_owner_id', user.id);
  activeUser = user;
  ready = true;

  // On first sign-in, move locally saved images into the account's private
  // Storage folder. Videos remain only in this browser's IndexedDB.
  if (!data?.payload && canMigrate) {
    const entries = JSON.parse(localStorage.getItem('journal_entries') || '[]');
    const keys = new Set();
    const scan = value => {
      if (!value || typeof value !== 'object') return;
      if (value.kind === 'local' && value.blobKey && value.mime?.startsWith('image/')) keys.add(value.blobKey);
      if (value.key && value.mime?.startsWith('image/')) keys.add(value.key);
      Object.values(value).forEach(scan);
    };
    scan(entries);
    if (keys.size) {
      try {
        const videos = await new Promise((resolve, reject) => {
          const request = indexedDB.open('journalVideosDB', 1);
          request.onupgradeneeded = () => request.result.createObjectStore('videos');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await Promise.all([...keys].map(key => new Promise(resolve => {
          const transaction = videos.transaction('videos', 'readonly');
          const request = transaction.objectStore('videos').get(key);
          request.onsuccess = async () => {
            if (request.result) {
              try { await uploadUserMedia(key, request.result); } catch (error) {
                window.dispatchEvent(new CustomEvent('cloud:sync-error', {detail:error}));
              }
            }
            resolve();
          };
          request.onerror = () => resolve();
        })));
        videos.close();
      } catch (error) {
        window.dispatchEvent(new CustomEvent('cloud:sync-error', {detail:error}));
      }
    }
  }
}

export function stopCloud() {
  ready = false;
  activeUser = null;
  clearTimeout(syncTimer);
}

export function scheduleCloudSync() {
  if (!ready || !activeUser || !api) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const {error} = await api.from('user_data').upsert({
      user_id:activeUser.id,
      payload:snapshot(),
      updated_at:new Date().toISOString()
    }, {onConflict:'user_id'});
    if (error) window.dispatchEvent(new CustomEvent('cloud:sync-error', {detail:error}));
  }, 600);
}

const mediaPath = key => `${activeUser.id}/${key}`;
export async function uploadUserMedia(key, blob) {
  if (!ready || !activeUser) throw new Error('Sign in to upload media.');
  const {error} = await api.storage.from('trade-media').upload(mediaPath(key), blob, {
    upsert:true, contentType:blob.type || 'application/octet-stream'
  });
  if (error) throw error;
}
export async function downloadUserMedia(key) {
  if (!ready || !activeUser) return null;
  const {data, error} = await api.storage.from('trade-media').download(mediaPath(key));
  if (error) return null;
  return data;
}
export async function deleteUserMedia(key) {
  if (!activeUser || !api) return;
  const {error} = await api.storage.from('trade-media').remove([mediaPath(key)]);
  if (error) throw error;
}

export async function saveProfile(profile) {
  const {data, error} = await api.from('profiles').upsert({
    id:activeUser.id,
    full_name:profile.full_name,
    phone:profile.phone || null,
    avatar_path:profile.avatar_path || null,
    updated_at:new Date().toISOString()
  }).select().single();
  if (error) throw error;
  return data;
}
export async function loadProfile() {
  const {data, error} = await api.from('profiles').select('*').eq('id', activeUser.id).maybeSingle();
  if (error) throw error;
  return data;
}
export async function uploadAvatar(file) {
  if (!activeUser) throw new Error('Sign in to upload a profile photo.');
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${activeUser.id}/avatar-${Date.now()}.${extension}`;
  const {error} = await api.storage.from('trade-media').upload(path, file, {upsert:true, contentType:file.type});
  if (error) throw error;
  return path;
}
export async function avatarUrl(path) {
  if (!path) return '';
  const {data, error} = await api.storage.from('trade-media').createSignedUrl(path, 3600);
  if (error) return '';
  return data.signedUrl;
}
