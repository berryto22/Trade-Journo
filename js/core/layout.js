// Where fields sit: sections -> ordered field keys.
// Drag & drop saves here.

import {schema} from './schema.js';
import {storage} from './storage.js?v=account-load-fix-1';

const DEFAULT = () => [
  {
  id:'trade',
  title:'Trade',
  fields:[
    'date',
    'symbol',
    'direction',
    'entryTf',
    'htf',
    'outcome',
    'pnl'
  ]
},

  {
    id:'checklist',
    title:'Pre-trade checklist',
    fields:[
      'wait',
      'nature',
      'bias',
      'structure',
      'extreme',
      'notTakingPOC',
      'tpLiquidity',
      'trendEnd',
      'retail',
      'perspective'
    ]
  },

  {
    id:'extras',
    title:'Details',
    fields:[
      'notes',
      'video'
    ]
  }
];

let cache = null;

function init() {
  let s = storage.layout.load();

  if (!s) {
    s = DEFAULT();

    const old = storage.layout.oldOrder();

    if (old) {
      const p = k => {
        const i = old.indexOf(k);
        return i < 0 ? 999 : i;
      };

      s[1].fields.sort((a, b) => p(a) - p(b));
    }
  }

  return s;
}

function reconcile(s) {

  const keys = new Set(
    schema.all().map(f => f.key)
  );

  const seen = new Set();

  // Remove invalid/duplicate fields
  s.forEach(sec => {
    sec.fields = sec.fields.filter(k =>
      keys.has(k) &&
      !seen.has(k) &&
      seen.add(k)
    );
  });

  /*
   * Only backfills entryTf/htf into Trade the first time a layout saved
   * before they existed is loaded (they'd otherwise vanish entirely).
   * It no longer yanks date/symbol/direction back to Trade on every load,
   * since that was overriding wherever the user had dragged them to.
   */
  const trade = s.find(x => x.id === 'trade');

  if (trade) {
    ['entryTf', 'htf'].forEach(key => {
      const placed = s.some(sec => sec.fields.includes(key));
      if (!placed && keys.has(key)) trade.fields.push(key);
    });
  }

  // Any genuinely new fields go to Details
  const last =
    s.find(x => x.id === 'extras') ||
    s[s.length - 1];

  schema.all().forEach(f => {

    if (!seen.has(f.key) &&
        !s.some(sec => sec.fields.includes(f.key))) {

      last.fields.push(f.key);
    }

  });

  return s;
}

export const layout = {

  get: () =>
    reconcile(cache ??= init()),

  set(s) {
    cache = s;
    storage.layout.save(s);
  }

};
