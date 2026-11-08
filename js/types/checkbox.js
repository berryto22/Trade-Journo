import {esc} from '../core/utils.js';
export default {
  label: 'Checkbox', custom: true, inlineLabel: true,
  render: (f, v) => `<label class="check"><input type="checkbox" data-ctl ${v ? 'checked' : ''}><span>${esc(f.label)}</span></label>`,
  read: box => box.querySelector('[data-ctl]').checked,
  view: () => '',
  isDone: v => !!v
};
