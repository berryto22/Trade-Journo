import {storage} from '../core/storage.js?v=account-load-fix-1';
import {esc, uid} from '../core/utils.js';
import {deleteConfirmDialog} from './entryCard.js?v=sticky-notes-24';
import {returnToOverview} from './analysis.js?v=sticky-notes-26';

const $ = selector => document.querySelector(selector);
const dock = $('#stickyDock');
const clip = $('#stickyClip');
const addButton = $('#stickyAdd');
const layer = $('#stickyNoteLayer');
let notes = storage.stickyNotes.load();
let expanded = false;
let inDetailMode = false;
let sucking = false;
let dragState = null;
let topNoteZ = Math.max(0, ...notes.map((note, index) => Number(note.z) || index + 1));

function persist() { storage.stickyNotes.save(notes); }

function renderNotes() {
  layer.innerHTML = notes.map((note, index) => `<article class="sticky-note" data-note-id="${esc(note.id)}" style="--note-index:${index % 5};--drag-x:${Number(note.x) || 0}px;--drag-y:${Number(note.y) || 0}px;z-index:${Number(note.z) || index + 1}">
    <header class="sticky-note-head" title="Drag to move"><span class="sticky-note-mark"></span><span class="sticky-note-label">QUICK NOTE</span><button class="sticky-note-delete" type="button" data-note-delete="${esc(note.id)}" aria-label="Delete note">×</button></header>
    <textarea data-note-text="${esc(note.id)}" maxlength="1000" placeholder="Write a thought to keep nearby…" aria-label="Sticky note">${esc(note.text || '')}</textarea>
  </article>`).join('');
  layer.querySelectorAll('[data-note-text]').forEach(resizeNote);
}

function resizeNote(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.max(64, textarea.scrollHeight)}px`;
}

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

function bringNoteForward(card) {
  if (!card) return;
  const note = notes.find(item => item.id === card.dataset.noteId);
  if (!note) return;
  note.z = ++topNoteZ;
  card.style.zIndex = String(note.z);
  persist();
}

function popNoteIn(note) {
  note.classList.add('unfolding');
  window.setTimeout(() => note.classList.remove('unfolding'), 520);
}

function syncVisibility() {
  dock.hidden = false;
  clip.setAttribute('aria-expanded', String(expanded));
  clip.setAttribute('aria-label', expanded ? 'Collect sticky notes' : 'Open sticky notes');
  dock.classList.toggle('open', expanded && !inDetailMode);
  layer.hidden = !expanded || inDetailMode || notes.length === 0;
  if (!layer.hidden) renderNotes();
}

function animateToClip(element, clipRect) {
  const rect = element.getBoundingClientRect();
  element.style.setProperty('--suck-x', `${clipRect.left + clipRect.width / 2 - (rect.left + rect.width / 2)}px`);
  element.style.setProperty('--suck-y', `${clipRect.top + clipRect.height / 2 - (rect.top + rect.height / 2)}px`);
  void element.offsetWidth;
  element.classList.add('sucking');
}

function foldIntoClip(includePlus = false) {
  if (sucking) return;
  const clipRect = clip.getBoundingClientRect();
  const moving = [...layer.querySelectorAll('.sticky-note')];
  if (expanded && (includePlus || !inDetailMode)) moving.push(addButton);
  if (!moving.length) {
    expanded = false;
    syncVisibility();
    return;
  }

  sucking = true;
  moving.forEach(element => animateToClip(element, clipRect));
  expanded = false;
  dock.classList.remove('open');
  window.setTimeout(() => {
    moving.forEach(element => element.classList.remove('sucking'));
    layer.hidden = true;
    syncVisibility();
    sucking = false;
  }, 900);
}

function unfoldFromClip() {
  if (inDetailMode || sucking) return;
  expanded = true;
  renderNotes();
  syncVisibility();
  layer.querySelectorAll('.sticky-note').forEach((note, index) => {
    note.style.setProperty('--note-index', index % 5);
    popNoteIn(note);
  });
}

function addNote() {
  if (inDetailMode || sucking) return;
  const note = {id:String(uid()), text:'', z:++topNoteZ};
  notes.push(note);
  persist();
  expanded = true;
  syncVisibility();
  const textarea = layer.querySelector(`[data-note-text="${CSS.escape(note.id)}"]`);
  const card = textarea?.closest('.sticky-note');
  if (card) popNoteIn(card);
  textarea?.focus();
}

export function initStickyNotes() {
  if (!dock || !layer) return;
  dock.hidden = false;
  inDetailMode = document.querySelector('.journal-shell')?.classList.contains('analysis-detail') || false;
  syncVisibility();

  clip.addEventListener('click', () => {
    if (sucking) return;
    if (inDetailMode) {
      inDetailMode = false;
      returnToOverview();
      unfoldFromClip();
      return;
    }
    if (expanded) foldIntoClip();
    else unfoldFromClip();
  });
  addButton.addEventListener('click', addNote);

  layer.addEventListener('input', event => {
    const textarea = event.target.closest('[data-note-text]');
    if (!textarea) return;
    resizeNote(textarea);
    const note = notes.find(item => item.id === textarea.dataset.noteText);
    if (note) { note.text = textarea.value; persist(); }
  });
  layer.addEventListener('pointerdown', event => {
    const card = event.target.closest('.sticky-note');
    if (!card) return;
    bringNoteForward(card);
    if (event.target.closest('textarea,input,button')) return;
    const note = notes.find(item => item.id === card.dataset.noteId);
    if (!note) return;
    const rect = card.getBoundingClientRect();
    dragState = {card, note, pointerId:event.pointerId, startX:event.clientX, startY:event.clientY, rect, x:Number(note.x) || 0, y:Number(note.y) || 0};
    card.classList.add('dragging');
    card.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  layer.addEventListener('pointermove', event => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const {card, note, rect, startX, startY, x, y} = dragState;
    const wantedLeft = rect.left + event.clientX - startX;
    const wantedTop = rect.top + event.clientY - startY;
    note.x = x + clamp(wantedLeft, 0, Math.max(0, innerWidth - rect.width)) - rect.left;
    note.y = y + clamp(wantedTop, 0, Math.max(0, innerHeight - rect.height)) - rect.top;
    card.style.setProperty('--drag-x', `${note.x}px`);
    card.style.setProperty('--drag-y', `${note.y}px`);
  });
  const finishDrag = event => {
    if (!dragState || (event && event.pointerId !== dragState.pointerId)) return;
    const {card, note, pointerId} = dragState;
    card.classList.remove('dragging');
    if (card.hasPointerCapture(pointerId)) card.releasePointerCapture(pointerId);
    dragState = null;
    persist();
  };
  layer.addEventListener('pointerup', finishDrag);
  layer.addEventListener('pointercancel', finishDrag);
  layer.addEventListener('click', async event => {
    const card = event.target.closest('.sticky-note');
    if (card) bringNoteForward(card);
    const remove = event.target.closest('[data-note-delete]');
    if (!remove) return;
    const note = layer.querySelector(`[data-note-id="${CSS.escape(remove.dataset.noteDelete)}"]`);
    if (!note) return;
    note.style.visibility = 'hidden';
    let confirmed;
    try {
      confirmed = await deleteConfirmDialog({title:'Delete this note?', description:"This can't be undone.", previewElement:note});
    } finally {
      note.style.visibility = '';
    }
    if (!confirmed || !note.isConnected) return;
    note.classList.add('deleting');
    note.style.pointerEvents = 'none';
    const id = note.dataset.noteId;
    notes = notes.filter(item => item.id !== id);
    persist();
    window.setTimeout(() => {
      note.remove();
      if (!notes.length) layer.hidden = true;
    }, 500);
  });

  const shell = document.querySelector('.journal-shell');
  if (shell) {
    new MutationObserver(() => {
      const detail = shell.classList.contains('analysis-detail');
      if (detail && !inDetailMode) {
        inDetailMode = true;
        foldIntoClip(true);
        dock.classList.remove('open');
      } else if (!detail && inDetailMode) {
        inDetailMode = false;
        syncVisibility();
      }
    }).observe(shell, {attributes:true, attributeFilter:['class']});
  }
}
