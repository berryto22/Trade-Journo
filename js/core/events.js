// Tiny event bus: modules talk through events instead of importing each other.
// Events: section:built, field:built, form:built, values:changed, schema:changed, layout:changed
const map = new Map();
export const events = {
  on(name, fn) { (map.get(name) ?? map.set(name, new Set()).get(name)).add(fn); },
  emit(name, payload) { map.get(name)?.forEach(fn => fn(payload)); }
};
