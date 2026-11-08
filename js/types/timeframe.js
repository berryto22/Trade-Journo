const ENTRY_TF = [
  'M1',
  'M5',
  'M15',
  'M30',
  'H1'
];

const HTF = [
  'H1',
  'H4',
  'D1',
  'W1',
  'MN1'
];

export default {

  label: 'Timeframe',

  render(f, value) {

    const options = f.group === 'htf' ? HTF : ENTRY_TF;

    return `
      <div class="timeframe-picker">

        ${options.map(tf => `
          <button
            type="button"
            class="timeframe-btn ${tf === value ? 'selected' : ''}"
            data-timeframe="${tf}"
          >
            ${tf}
          </button>
        `).join('')}

      </div>
    `;
  },

  read(box) {
    return box.querySelector('.timeframe-btn.selected')?.dataset.timeframe || '';
  },

  bind(box, f, changed) {

    box.addEventListener('click', e => {

      const btn = e.target.closest('[data-timeframe]');

      if (!btn) return;

      box.querySelectorAll('.timeframe-btn')
        .forEach(x => x.classList.remove('selected'));

      btn.classList.add('selected');

      changed();
    });
  },

  view: (f, v) => v,

  isDone: v => !!v
};