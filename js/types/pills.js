import {esc} from '../core/utils.js';
const color = (f, v) => f.colors?.[v] ? `var(--${f.colors[v]})` : 'var(--accent)';
export default {
  label: 'Pills (single choice)', custom: true, needsOptions: true, color,
  render: (f, v) => `<div class="opt-group">${(f.options || []).map(o => `<div class="opt ${o === v ? 'sel' : ''}" data-v="${esc(o)}" style="--c:${color(f, o)}">${esc(o)}</div>`).join('')}</div>`,
  read: box => box.querySelector('.opt.sel')?.dataset.v ?? null,
  bind(box, f, change) {
    box.querySelectorAll('.opt').forEach(o => o.onclick = () => {
      const was = o.classList.contains('sel');
      box.querySelectorAll('.opt').forEach(x => x.classList.remove('sel'));
      if (!was) o.classList.add('sel');
      change();
    });
  },
  view: (f, v) => esc(v),
  isDone: v => !!v
};
