import {esc} from '../core/utils.js';
import {storage} from '../core/storage.js?v=account-load-fix-1';

const DEFAULTS = [
  'XAUUSD',
  'EURUSD',
  'GBPUSD',
  'GBPJPY',
  'USDJPY'
];

const COLORS = [
  '#d97706',
  '#2563eb',
  '#7c3aed',
  '#059669',
  '#dc2626',
  '#0891b2',
  '#db2777',
  '#65a30d'
];

function load() { const saved = storage.instruments.load(); return Array.isArray(saved) && saved.length ? saved : DEFAULTS; }
function save(list) { storage.instruments.save(list); }

function colorFor(symbol) {
  let hash = 0;

  for (const c of symbol) {
    hash = ((hash << 5) - hash) + c.charCodeAt(0);
    hash |= 0;
  }

  return COLORS[Math.abs(hash) % COLORS.length];
}

export default {
  label: 'Instrument',
  color: (f, v) => colorFor(v || ''),

  render(f, value) {
    const instruments = load();

    return `
      <div class="instrument-picker">

        <div class="instrument-list">
          ${instruments.map(symbol => `
            <button
              type="button"
              class="instrument-chip ${symbol === value ? 'selected' : ''}"
              data-instrument="${esc(symbol)}"
              style="--instrument-color:${colorFor(symbol)}"
            >
              <span class="instrument-dot"></span>
              ${esc(symbol)}
            </button>
          `).join('')}

          <button
            type="button"
            class="instrument-add"
            data-add-instrument
            title="Add instrument"
          >+</button>
        </div>

        <div class="instrument-add-box hidden">
          <input
            type="text"
            data-new-instrument
            placeholder="Enter instrument e.g. BTCUSDT"
            autocomplete="off"
          >
          <button
            type="button"
            class="instrument-add-confirm"
            data-confirm-instrument
          >Add</button>
        </div>

      </div>
    `;
  },

  read(box) {
    return box.querySelector('.instrument-chip.selected')?.dataset.instrument || '';
  },

  bind(box, f, changed) {

    box.addEventListener('click', e => {

      const chip = e.target.closest('[data-instrument]');

      if (chip) {
        box.querySelectorAll('.instrument-chip')
          .forEach(x => x.classList.remove('selected'));

        chip.classList.add('selected');

        changed();
        return;
      }

      if (e.target.closest('[data-add-instrument]')) {
        const addBox = box.querySelector('.instrument-add-box');
        addBox.classList.toggle('hidden');

        if (!addBox.classList.contains('hidden')) {
          box.querySelector('[data-new-instrument]')?.focus();
        }

        return;
      }

      if (e.target.closest('[data-confirm-instrument]')) {
        const input = box.querySelector('[data-new-instrument]');
        const symbol = input.value.trim().toUpperCase();

        if (!symbol) return;

        const instruments = load();

        if (!instruments.includes(symbol)) {
          instruments.push(symbol);
          save(instruments);
        }

        // re-render only; click/keydown listeners stay on `box` from the one
        // bind() call in fieldHtml(), so we don't rebind (that was doubling
        // up a new listener pair on every instrument you added)
        box.innerHTML = this.render(f, symbol);

        changed();
      }
    });

    box.addEventListener('keydown', e => {
      if (
        e.key === 'Enter' &&
        e.target.matches('[data-new-instrument]')
      ) {
        box.querySelector('[data-confirm-instrument]')?.click();
      }
    });
  },

  view: (f, v) => esc(v),

  isDone: v => !!v
};
