import {esc} from '../core/utils.js';
export const simple = (kind, label) => ({
  label, custom: true,
  render: (f, v) => `<input type="${kind}" data-ctl value="${esc(v ?? '')}">`,
  read: box => box.querySelector('[data-ctl]').value,
  view: (f, v) => esc(v),
  isDone: v => v != null && v !== ''
});
