import {storage} from './storage.js?v=account-load-fix-1';

let list = storage.entries.load();

export const entries = {

  all: () => list,

  get: id => list.find(e => e.id === id),

  upsert(e) {
    const i = list.findIndex(x => x.id === e.id);

    if (i > -1) {
      list[i] = e;
    } else {
      list.unshift(e);
    }

    storage.entries.save(list);

    window.dispatchEvent(
      new CustomEvent('entries:changed')
    );
  },

  remove(id) {
    list = list.filter(e => e.id !== id);

    storage.entries.save(list);

    window.dispatchEvent(
      new CustomEvent('entries:changed')
    );
  }

};
