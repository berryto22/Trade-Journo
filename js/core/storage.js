// The ONLY file that touches localStorage / IndexedDB. Swap internals to add a backend.
// Entry shape: { id, values:{fieldKey:value}, notes:{fieldKey:{tags:[],comment:''}} }
import {scheduleCloudSync, currentUser, uploadUserMedia, downloadUserMedia, deleteUserMedia} from './cloud.js';
const K = 'journal_';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(K + k)) ?? d; } catch { return d; } };
const write = (k, v) => { localStorage.setItem(K + k, JSON.stringify(v)); scheduleCloudSync(); };

// --- migration from the earlier single-file format ---
const CHECKS = ['wait','nature','bias','extreme','notTakingPOC','tpLiquidity','trendEnd','retail','perspective'];
function migrateEntry(e) {
  if (e.values) return e;
  const cl = e.checklist || {};
  const values = {date:e.date, symbol:e.symbol, direction:e.direction, tf:e.tf, notes:e.notes || '', structure:cl.structure || []};
  CHECKS.forEach(k => { if (cl[k] !== undefined && cl[k] !== null) values[k] = cl[k]; });
  Object.assign(values, e.custom || {});
  if (e.videoType === 'local') values.video = {kind:'local', blobKey:e.id};
  else if (e.videoType === 'url' && e.videoUrl) values.video = {kind:'url', url:e.videoUrl};
  return {id:e.id, values, notes:cl.extras || {}};
}
const migrateCustom = list => list.map(f => f.key ? f : {key:f.id, type:f.type, label:f.name, options:f.options || undefined, custom:true, annotate:true});

// --- video blobs (IndexedDB) ---
let dbp;
const db = () => dbp ??= new Promise((res, rej) => { const r = indexedDB.open('journalVideosDB', 1); r.onupgradeneeded = () => r.result.createObjectStore('videos'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const run = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction('videos', mode); const req = fn(tx.objectStore('videos')); tx.oncomplete = () => res(req?.result); tx.onerror = () => rej(tx.error); }); };

export const storage = {
  stickyNotes: {load: () => read('stickyNotes', []), save: v => write('stickyNotes', v)},
  instruments: {load: () => read('instruments', ['XAUUSD','EURUSD','GBPUSD','GBPJPY','USDJPY']), save: v => write('instruments', v)},
  entries: {load: () => read('entries', []).map(migrateEntry), save: v => write('entries', v)},
  custom: {load: () => migrateCustom(read('customfields', [])), save: v => write('customfields', v)},
  layout: {load: () => read('layout', null), save: v => write('layout', v), oldOrder: () => read('fieldorder', null)},
theme: {
  load: () => localStorage.getItem(K + 'theme') || 'clarity',
  save: t => { localStorage.setItem(K + 'theme', t); scheduleCloudSync(); }
},

analysis: {
  load: () => read('analysis', {
    accountSize: null
  }),

  save: v => write('analysis', v)
},
dashboard: {
  // migrates the old raw 'tradeJournalDashboard' key the first time this runs
  load: () => read('dashboard', null) ?? JSON.parse(localStorage.getItem('tradeJournalDashboard') || '{}'),
  save: v => write('dashboard', v)
},
  putVideo: async (key, blob) => {
    // Keep large video files on this device; small image media is account-synced.
    if (blob?.type?.startsWith('image/') && currentUser()) return uploadUserMedia(key, blob);
    return run('readwrite', s => s.put(blob, key));
  },
  getVideo: async (key, localOnly=false) => {
    if (currentUser() && !localOnly) {
      const remote = await downloadUserMedia(key);
      if (remote) return remote;
    }
    return run('readonly', s => s.get(key));
  },
  deleteVideo: async key => {
    if (currentUser()) await deleteUserMedia(key).catch(() => {});
    return run('readwrite', s => s.delete(key)).catch(() => {});
  }
};
