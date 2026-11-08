// showIf: {key, in:[...]} or {key, notIn:[...]} — shows/hides fields based on another field's value.
import {events} from '../core/events.js';
import {schema} from '../core/schema.js';
import {$$} from '../core/utils.js';
export function isVisible(f, values) {
  const c = f.showIf; if (!c) return true;
  const v = values[c.key];
  if (c.in) return c.in.includes(v);
  if (c.notIn) return v != null && v !== '' && !c.notIn.includes(v);
  return true;
}
export function init() {
  events.on('values:changed', ({values}) => $$('#sections .field').forEach(el => {
    const f = schema.get(el.dataset.key);
    if (f?.showIf) el.classList.toggle('open', isVisible(f, values));
  }));
}
