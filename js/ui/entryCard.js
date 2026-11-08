// Generic saved-entry list.
// Uses schema + layout order; never checks a field type by name.

import {schema} from '../core/schema.js';
import {layout} from '../core/layout.js';
import {entries} from '../core/entries.js';
import {types} from '../types/index.js';
import {isVisible} from '../features/conditions.js';
import {$, esc, sleep} from '../core/utils.js';
import {toast} from './dialog.js';
import {showImageLightbox} from './imageLightbox.js';


/* =========================================================
   STATE
   ========================================================= */

const seen = new Set();
const open = new Set();

let onEdit = () => {};


/* =========================================================
   FIELD HELPERS
   ========================================================= */

const flat = () =>
  layout
    .get()
    .flatMap(s => s.fields)
    .map(k => schema.get(k))
    .filter(f => f && types[f.type]);


/* =========================================================
   CHECKLIST SCORE
   ========================================================= */

function score(e) {

  let t = 0;
  let d = 0;

  flat().forEach(f => {

    if (
      f.check &&
      isVisible(f, e.values)
    ) {

      t++;

      if (
        types[f.type].isDone(
          e.values[f.key]
        )
      ) {
        d++;
      }

    }

  });

  return {
    d,
    t
  };

}


/* =========================================================
   NOTES / TAGS
   ========================================================= */

const annView = n => {

  if (!n) {
    return '';
  }

  return `
    ${
      n.tags?.length
        ? `
          <div class="entry-tags">
            ${n.tags
              .map(
                t =>
                  `<span class="tag-chip-view">${esc(t)}</span>`
              )
              .join('')}
          </div>
        `
        : ''
    }

    ${
      n.comment
        ? `
          <div class="note pre">
            ${esc(n.comment)}
          </div>
        `
        : ''
    }

    ${n.images?.length ? `<div class="entry-note-images">${n.images.map(image => `<figure class="entry-note-image"><button type="button" class="entry-note-image-open" data-ann-caption="${esc(image.caption || '')}" aria-label="View trade reference image"><img data-ann-image="${esc(image.key)}" alt="Trade reference image" loading="lazy"></button>${image.caption ? `<figcaption>${esc(image.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}

  `;

};


/* =========================================================
   P/L DISPLAY
   ========================================================= */

function pnlView(e) {

  const pnl = Number(
    e.values?.pnl
  );

  if (!Number.isFinite(pnl)) {
    return '';
  }

  let state = '';

  if (pnl > 0) {
    state = 'positive';
  } else if (pnl < 0) {
    state = 'negative';
  } else {
    state = 'neutral';
  }

  const sign =
    pnl > 0
      ? '+'
      : '';

  return `
    <div class="entry-pnl-wrap">

      <span class="entry-pnl-label">
        P/L
      </span>

      <span
        class="entry-pnl ${state}"
      >
        ${sign}${pnl.toFixed(2)}
      </span>

    </div>
  `;

}


/* =========================================================
   ENTRY ROWS
   ========================================================= */

function rows(e) {

  return flat()
    .map(f => {

      /*
       * Date is already displayed in the
       * entry header.
       */
      if (
        f.key === 'date' ||
        (f.pill && !f.check) ||
        !isVisible(f, e.values)
      ) {
        return '';
      }


      const t =
        types[f.type];

      const v =
        e.values[f.key];

      const done =
        t.isDone(v);

      const ann =
        annView(
          e.notes?.[f.key]
        );


      /* =========================================
         CHECKLIST FIELD
         ========================================= */

      if (f.check) {

        const view =
          done
            ? t.view(
                f,
                v,
                {
                  entryId: e.id
                }
              )
            : '';


        return `
          <div class="mini">

            <span
              class="mk"
              style="
                color:var(
                  --${done ? 'good' : 'bad'}
                )
              "
            >
              ${done ? '✓' : '✕'}
            </span>

            <div>

              ${esc(f.label)}

              ${
                view
                  ? ': ' + view
                  : ''
              }

              ${ann}

            </div>

          </div>
        `;

      }


      /* =========================================
         NORMAL FIELD
         ========================================= */

      if (!done) {
        return '';
      }


      if (t.block) {

        return `
          <div class="mini-block">

            ${t.view(
              f,
              v,
              {
                entryId: e.id
              }
            )}

            ${ann}

          </div>
        `;

      }


      return `
        <div class="mini">

          <span>
            •
          </span>

          <div>

            ${esc(f.label)}:

            ${t.view(
              f,
              v
            )}

            ${ann}

          </div>

        </div>
      `;

    })
    .join('');

}


/* =========================================================
   ENTRY CARD
   ========================================================= */

function card(e, i) {

  const {
    d,
    t
  } = score(e);


  const isNew =
    !seen.has(e.id);

  seen.add(e.id);


  /* =========================================
     RESULT / PILLS
     ========================================= */

  const pills =
    flat()
      .filter(
        f =>
          f.pill &&
          e.values[f.key]
      )
      .map(f => {

        const c =
          types[f.type]
            .color?.(
              f,
              e.values[f.key]
            );


        return `
          <span
            class="pill ${c ? 'c' : ''}"
            ${
              c
                ? `style="--c:${c}"`
                : ''
            }
          >
            ${esc(
              e.values[f.key]
            )}
          </span>
        `;

      })
      .join('');


  /* =========================================
     P/L
     ========================================= */

  const pnl =
    pnlView(e);


  /* =========================================
     CARD
     ========================================= */

  return `
    <div
      class="card ${isNew ? 'enter' : ''}"
      style="--i:${isNew ? i : 0}"
      data-id="${e.id}"
      data-date="${esc(e.values?.date || '')}"
    >

      <!-- =====================================
           ENTRY HEADER
           ===================================== -->

      <div
        class="entry-head"
        data-act="toggle"
      >

        <div>

          ${pills}

          <div class="entry-meta">
            ${esc(
              e.values.date || ''
            )}
          </div>

        </div>


        <div class="entry-head-right">

          ${pnl}

          <span
            class="badge ${
              d === t
                ? 'badge-good'
                : 'badge-bad'
            }"
          >
            ${d}/${t}
          </span>

        </div>

      </div>


      <!-- =====================================
           COLLAPSIBLE CONTENT
           ===================================== -->

      <div
        class="collapse ${
          open.has(e.id)
            ? 'open'
            : ''
        }"
      >

        <div class="inner">

          <div class="entry-content">

            ${rows(e)}


            <!-- =================================
                 FOOTER ACTIONS
                 ================================= -->

            <div class="footerbar">

              <button
                class="btn-ghost btn-sm"
                data-act="edit"
                type="button"
              >
                Edit
              </button>

              <button
                class="btn-danger btn-sm"
                data-act="delete"
                type="button"
              >
                Delete
              </button>

            </div>

          </div>

        </div>

      </div>

    </div>
  `;

}


/* =========================================================
   MOUNT FIELD COMPONENTS
   ========================================================= */

const mount = cardEl => {

  const e =
    entries.get(
      cardEl.dataset.id
    );

  if (!e) {
    return;
  }


  flat().forEach(f => {

    types[f.type]
      .mounted?.(
        cardEl,
        f,
        e.values[f.key]
      );

  });

};


/* =========================================================
   RENDER ENTRY LIST
   ========================================================= */

export function renderList() {

  const all =
    entries.all();


  $('#entries').innerHTML =
    all
      .map(card)
      .join('');

  hydrateAnnotationImages($('#entries'));
  $('#entries').querySelectorAll('.entry-note-image-open').forEach(button => {
    button.addEventListener('click', () => showImageLightbox(button.querySelector('img')?.src, button.dataset.annCaption));
  });

  $('#emptyMsg')
    .classList
    .toggle(
      'hidden',
      all.length > 0
    );


  /*
   * Re-mount components inside
   * entries that were previously open.
   */

  open.forEach(id => {

    const c =
      $(
        `.card[data-id="${id}"]`
      );

    if (c) {
      mount(c);
    }

  });

}

async function hydrateAnnotationImages(root) {
  const {storage} = await import('../core/storage.js?v=account-load-fix-1');
  for (const image of root.querySelectorAll('[data-ann-image]')) {
    const blob = await storage.getVideo(image.dataset.annImage).catch(() => null);
    if (blob && image.isConnected) image.src = URL.createObjectURL(blob);
  }
}

/* =========================================================
   DELETE ENTRY
   ========================================================= */

async function remove(
  id,
  cardEl
) {

  const confirmed =
    await deleteConfirmDialog();

  if (!confirmed) {
    return;
  }

  cardEl.classList.add(
    'removing'
  );

  await sleep(300);

  const e =
    entries.get(id);

  if (e) {

    schema
      .all()
      .forEach(f => {

        types[f.type]
          ?.cleanup?.(
            e.values[f.key]
          );

      });

  }

  entries.remove(id);

  open.delete(id);

  renderList();

  toast(
    'Entry deleted'
  );

}


export function deleteConfirmDialog({title='Delete this entry?', description="This can't be undone, and removes its saved video too.", previewElement=null}={}) {
  return new Promise(resolve => {

    const modal =
      document.createElement('div');

    modal.className = 'modal';

    modal.innerHTML = `
      <div class="modal-box">

        <h3>${esc(title)}</h3>

        <p>
          ${esc(description)} Type
          <b>DELETE</b> to confirm.
        </p>

        <input
          type="text"
          id="deleteConfirmInput"
          name="deleteConfirmInput"
          class="delete-password-input"
          autocomplete="off"
          placeholder="DELETE"
          style="margin-top:14px"
        >

        <div class="footerbar">

          <button
            class="btn-ghost btn-sm"
            type="button"
            data-password-cancel
          >
            Cancel
          </button>

          <button
            class="btn-danger-fill btn-sm"
            type="button"
            data-password-confirm
          >
            Delete
          </button>

        </div>

      </div>
    `;

    if (previewElement) {
      const rect = previewElement.getBoundingClientRect();
      const preview = previewElement.cloneNode(true);
      preview.classList.add('delete-confirm-preview');
      preview.classList.remove('dragging', 'unfolding', 'deleting', 'confirming-delete');
      preview.style.position = 'fixed';
      preview.style.left = `${rect.left}px`;
      preview.style.top = `${rect.top}px`;
      preview.style.width = `${rect.width}px`;
      preview.style.margin = '0';
      preview.style.translate = 'none';
      preview.style.pointerEvents = 'none';
      preview.style.setProperty('--drag-x', '0px');
      preview.style.setProperty('--drag-y', '0px');
      preview.querySelector('[data-note-delete]')?.remove();
      preview.querySelector('[data-note-text]')?.setAttribute('readonly', '');
      modal.classList.add('has-delete-preview');
      modal.append(preview);
    }

    document.body.appendChild(modal);

    const input =
      modal.querySelector(
        '.delete-password-input'
      );

    let finished = false;

    const finish = value => {

      if (finished) {
        return;
      }

      finished = true;

      modal.classList.remove('show');

      setTimeout(() => {
        modal.remove();
      }, 220);

      resolve(value);

    };

    const submit = () => finish(
      input.value.trim().toUpperCase() === 'DELETE'
    );

    modal
      .querySelector(
        '[data-password-cancel]'
      )
      .addEventListener(
        'click',
        () => finish(false)
      );

    modal
      .querySelector(
        '[data-password-confirm]'
      )
      .addEventListener(
        'click',
        submit
      );

    input.addEventListener(
      'keydown',
      e => {

        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }

        if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }

      }
    );

    requestAnimationFrame(() => {

      modal.classList.add('show');

      input.focus();

    });

  });
}


export function initList(h) {

  onEdit =
    h.onEdit;


  $('#entries')
    .addEventListener(
      'click',
      e => {

        const t =
          e.target.closest(
            '[data-act]'
          );


        if (!t) {
          return;
        }


        const cardEl =
          t.closest(
            '.card'
          );


        if (!cardEl) {
          return;
        }


        const id =
          cardEl.dataset.id;


        /* =====================================
           TOGGLE ENTRY
           ===================================== */

        if (
          t.dataset.act ===
          'toggle'
        ) {

          const c =
            cardEl.querySelector(
              '.collapse'
            );


          c.classList.toggle(
            'open'
          );


          if (
            c.classList.contains(
              'open'
            )
          ) {

            open.add(id);

            mount(cardEl);

          } else {

            open.delete(id);

          }

        }


        /* =====================================
           EDIT ENTRY
           ===================================== */

        else if (
          t.dataset.act ===
          'edit'
        ) {

          onEdit(
            entries.get(id)
          );

        }


        /* =====================================
           DELETE ENTRY
           ===================================== */

        else if (
          t.dataset.act ===
          'delete'
        ) {

          remove(
            id,
            cardEl
          );

        }

      }
    );

}
