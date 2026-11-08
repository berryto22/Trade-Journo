const COLOR = {Long:'good', Short:'bad'};

export default {

  label: 'Direction',
  color: (f, v) => `var(--${COLOR[v] || 'accent'})`,

  render(f, value) {
    return `
      <div class="direction-picker">

        <button
          type="button"
          class="direction-btn direction-long ${value === 'Long' ? 'selected' : ''}"
          data-direction="Long"
        >
          <span class="direction-arrow">↗</span>
          Long
        </button>

        <button
          type="button"
          class="direction-btn direction-short ${value === 'Short' ? 'selected' : ''}"
          data-direction="Short"
        >
          <span class="direction-arrow">↘</span>
          Short
        </button>

      </div>
    `;
  },

  read(box) {
    return box.querySelector('.direction-btn.selected')?.dataset.direction || '';
  },

  bind(box, f, changed) {

    box.addEventListener('click', e => {

      const btn = e.target.closest('[data-direction]');

      if (!btn) return;

      box.querySelectorAll('.direction-btn')
        .forEach(x => x.classList.remove('selected'));

      btn.classList.add('selected');

      changed();
    });
  },

  view: (f, v) => v,

  isDone: v => !!v
};