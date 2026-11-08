import {esc} from '../core/utils.js';
export default {
  label: 'Long text', custom: true, block: true,
  render: (f, v) => `<textarea data-ctl placeholder="${esc(f.placeholder || '')}">${esc(v ?? '')}</textarea>`,
  read: box => box.querySelector('[data-ctl]').value,
  view: (f, v) => `<div class="note pre">${esc(v)}</div>`,
  isDone: v => !!v
};
