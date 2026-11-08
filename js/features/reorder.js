// Drag & drop (mouse + touch). Fields move within/between sections; sections move too.
import {events} from '../core/events.js';
import {layout} from '../core/layout.js';
import {$} from '../core/utils.js';

function sortable({root, handle, item, containers, onDrop}) {
  let d = null;
  root.addEventListener('pointerdown', e => {
    const h = e.target.closest(handle); if (!h || e.button > 0) return;
    const el = h.closest(item); e.preventDefault();
    d = {el, off: e.clientY - el.getBoundingClientRect().top, cs: containers()};
    el.classList.add('dragging'); document.body.classList.add('is-dragging');
    root.setPointerCapture?.(e.pointerId);
  });
  root.addEventListener('pointermove', e => {
    if (!d) return;
    const {el, off, cs} = d, y = e.clientY;
    el.style.transform = '';
    const c = cs.find(c => { const r = c.getBoundingClientRect(); return y >= r.top - 14 && y <= r.bottom + 14; }) || el.parentElement;
    const mid = y - off + el.offsetHeight / 2;
    const next = [...c.children].filter(s => s !== el && s.matches(item)).find(s => mid < s.getBoundingClientRect().top + s.offsetHeight / 2) || null;
    if (el.parentElement !== c || el.nextElementSibling !== next) c.insertBefore(el, next);
    el.style.transform = `translateY(${y - off - el.getBoundingClientRect().top}px)`;
  });
  const end = () => {
    if (!d) return; const {el} = d; d = null;
    el.style.transition = 'transform .2s cubic-bezier(.2,.8,.2,1)'; el.style.transform = '';
    document.body.classList.remove('is-dragging');
    setTimeout(() => { el.style.transition = ''; el.classList.remove('dragging'); }, 210);
    onDrop();
  };
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
}

export function init() {
  const root = $('#sections');
  const save = () => {
    const prev = layout.get();
    layout.set([...root.querySelectorAll('.section')].map(s => ({
      id: s.dataset.id, title: prev.find(x => x.id === s.dataset.id)?.title || '',
      fields: [...s.querySelectorAll(':scope > .sec-body > .field')].map(f => f.dataset.key)
    })));
    events.emit('layout:changed');
  };
  sortable({root, handle: '.drag-handle', item: '.field', containers: () => [...root.querySelectorAll('.sec-body')], onDrop: save});
  //sortable({root, handle: '.sec-handle', item: '.section', containers: () => [root], onDrop: save});
  events.on('field:built', ({el}) => el.querySelector('.f-tools').insertAdjacentHTML('afterbegin', '<span class="drag-handle" title="Drag to reorder">⋮⋮</span>'));
  //events.on('section:built', ({el}) => el.querySelector('.sec-head').insertAdjacentHTML('afterbegin', '<span class="sec-handle" title="Drag section">⋮⋮</span>'));
}
