// Generic: loops over schema + layout. Never checks a field's type by name.
import {schema} from '../core/schema.js';
import {layout} from '../core/layout.js';
import {entries} from '../core/entries.js';
import {events} from '../core/events.js';
import {types} from '../types/index.js';
import {isVisible} from '../features/conditions.js';
import {$, $$, esc, uid, sleep} from '../core/utils.js';
import {toast} from './dialog.js';
import {renderList} from './entryCard.js';

const state = {id: null, values: {}, notes: {}};
let draftTimer = 0;
let draftDirty = false;
const draftKey = () => `tradeJournalDraft:${localStorage.getItem('journal_owner_id') || 'guest'}`;
const today = () => new Date().toISOString().slice(0, 10);
const defaultOf = f => f.default === '@today' ? today() : f.default;
const known = () => schema.all().filter(f => types[f.type]);

function fieldHtml(f) {
  const t = types[f.type], v = state.values[f.key], ctl = t.render(f, v);
  const box = t.collapsible ? `<div class="f-control collapse ${t.isDone(v) ? 'open' : ''}"><div class="inner">${ctl}</div></div>` : `<div class="f-control">${ctl}</div>`;
  return `<div class="field collapse ${isVisible(f, state.values) ? 'open' : ''}" data-key="${f.key}"><div class="inner">
    <div class="frow"><div class="f-main">${t.inlineLabel ? '' : `<div class="f-label">${esc(f.label)}</div>`}${box}${f.sub ? `<div class="qsub">${esc(f.sub)}</div>` : ''}</div><div class="f-tools"></div></div>
    <div class="f-panels"></div></div></div>`;
}

const collectRaw = () => {
  const v = {};
  $$('#sections .field').forEach(el => { const f = schema.get(el.dataset.key); v[f.key] = types[f.type].read(el.querySelector('.f-control'), f); });
  return v;
};
const changed = () => events.emit('values:changed', {values: collectRaw()});

function build() {
  const root = $('#sections');
  root.innerHTML = layout.get().map(s => `<section class="section" data-id="${s.id}"><div class="sec-head"><h3>${esc(s.title)}</h3></div><div class="sec-body">${s.fields.map(k => schema.get(k)).filter(f => f && types[f.type]).map(fieldHtml).join('')}</div></section>`).join('');
  $$('.section', root).forEach(el => events.emit('section:built', {el}));
  $$('.field', root).forEach(el => {
    const f = schema.get(el.dataset.key), t = types[f.type];
    t.bind?.(el.querySelector('.f-control'), f, changed);
    events.emit('field:built', {el, field: f, type: t, notes: state.notes});
  });
  events.emit('form:built', {root});
  changed();
}

export function openForm(entry) {
  state.id = entry?.id ?? null;
  state.values = {}; known().forEach(f => { state.values[f.key] = entry?.values?.[f.key] ?? defaultOf(f); });
  state.notes = JSON.parse(JSON.stringify(entry?.notes || {}));
  build();
  const card = $('#formCard'); card.classList.remove('hidden', 'enter', 'leaving'); void card.offsetWidth; card.classList.add('enter');
  card.scrollIntoView({behavior: 'smooth', block: 'start'});
}
async function closeForm() { const c = $('#formCard'); c.classList.add('leaving'); await sleep(250); c.classList.add('hidden'); c.classList.remove('leaving'); state.id = null; }

function clearDraft() {
  clearTimeout(draftTimer); draftTimer = 0; draftDirty = false;
  localStorage.removeItem(draftKey());
}

function persistDraftNow() {
  clearTimeout(draftTimer); draftTimer = 0;
  if (!draftDirty || $('#formCard').classList.contains('hidden')) return;
  const notes = {};
  Object.entries(state.notes).forEach(([key, note]) => {
    notes[key] = {...note, images:(note.images || []).map(({previewBlob, ...image}) => image)};
  });
  localStorage.setItem(draftKey(), JSON.stringify({id:state.id, values:collectRaw(), notes, savedAt:Date.now()}));
}

function scheduleDraft() {
  draftDirty = true;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraftNow, 120);
}

export function restoreDraft() {
  let draft;
  try { draft = JSON.parse(localStorage.getItem(draftKey()) || 'null'); }
  catch { clearDraft(); return; }
  if (!draft || !draft.values) return;
  openForm(draft);
  draftDirty = true;
  toast('Restored your unsaved journal draft');
}

async function save() {
  const raw = collectRaw(), id = state.id || uid(), values = {};
  for (const f of known()) {
    if (!isVisible(f, raw)) continue;
    const t = types[f.type]; let v = raw[f.key];
    if (t.persist) v = await t.persist(v, {entryId: id, field: f});
    if (v !== undefined) values[f.key] = v;
  }
  const notes = {}; Object.entries(state.notes).forEach(([k, n]) => {
    if (n.tags?.length || n.comment || n.images?.length) {
      notes[k] = {...n, images:(n.images || []).map(({previewBlob, ...image}) => image)};
    }
  });
  entries.upsert({id, values, notes});
  clearDraft();
  await closeForm(); renderList(); toast('Entry saved');
}

export function initForm() {
  $('#btnNew').onclick = () => openForm();
  $('#btnCancel').onclick = () => { clearDraft(); closeForm(); };
  $('#btnSave').onclick = save;
  ['input', 'change'].forEach(ev => $('#sections').addEventListener(ev, e => {
    if (e.target.closest('.f-control')) changed();
    if (e.target.closest('.field')) scheduleDraft();
  }));
  window.addEventListener('journal:draft-change', scheduleDraft);
  window.addEventListener('beforeunload', persistDraftNow);
  window.addEventListener('pagehide', persistDraftNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistDraftNow(); });
  events.on('schema:changed', () => { // a field was added/removed: rebuild but keep what the user already typed
    if ($('#formCard').classList.contains('hidden')) return;
    Object.assign(state.values, collectRaw()); build();
  });
}
