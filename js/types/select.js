import {esc} from '../core/utils.js';
export default {
  label: 'Select', custom: true, needsOptions: true,
  render(f, v) {
    const opts = f.options || [], other = f.other && v && !opts.includes(v);
    return `<select data-ctl>${f.custom ? '<option value="">—</option>' : ''}${opts.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}${f.other ? `<option value="__other" ${other ? 'selected' : ''}>Other…</option>` : ''}</select>${f.other ? `<input type="text" class="sel-other ${other ? '' : 'hidden'}" placeholder="Custom" value="${other ? esc(v) : ''}">` : ''}`;
  },
  read(box) { const s = box.querySelector('select'); return s.value === '__other' ? (box.querySelector('.sel-other').value.trim() || 'Other') : s.value; },
  bind(box) { const s = box.querySelector('select'), o = box.querySelector('.sel-other'); if (o) s.addEventListener('change', () => o.classList.toggle('hidden', s.value !== '__other')); },
  view: (f, v) => esc(v),
  isDone: v => !!v
};
