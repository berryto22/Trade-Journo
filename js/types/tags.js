import {esc} from '../core/utils.js';
// Reusable tag box (also used by the 🏷 annotations feature)
const chip = t => `<span class="tag-chip" data-t="${esc(t)}">${esc(t)}<button type="button" class="chip-x">✕</button></span>`;
export const tagBoxHtml = (tags = [], ph = 'Add a tag, press Enter') => `<div class="tagbox"><span class="chips">${tags.map(chip).join('')}</span><input type="text" class="tag-in" placeholder="${esc(ph)}"></div>`;
export const readTagBox = box => [...box.querySelectorAll('.tag-chip')].map(c => c.dataset.t);
export function bindTagBox(box, onChange) {
  const input = box.querySelector('.tag-in'), chips = box.querySelector('.chips');
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault(); const v = input.value.trim(); if (!v) return;
    chips.insertAdjacentHTML('beforeend', chip(v)); input.value = ''; onChange?.();
  });
  box.addEventListener('click', e => { const x = e.target.closest('.chip-x'); if (x) { x.closest('.tag-chip').remove(); onChange?.(); } });
}
export default {
  label: 'Tags', custom: true, collapsible: true,
  render: (f, v) => tagBoxHtml(v || []),
  read: box => readTagBox(box.querySelector('.tagbox')),
  bind: (box, f, change) => bindTagBox(box.querySelector('.tagbox'), change),
  view: (f, v) => (v || []).map(t => `<span class="tag-chip-view">${esc(t)}</span>`).join(''),
  isDone: v => !!v?.length
};
