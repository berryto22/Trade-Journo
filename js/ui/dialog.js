import {esc, sleep} from '../core/utils.js';
// Custom dialogs (native confirm() is blocked in many embedded/sandboxed contexts).
export function confirmDialog(title, msg = '', okText = 'Delete') {
  return new Promise(res => {
    const el = document.createElement('div'); el.className = 'modal';
    el.innerHTML = `<div class="modal-box"><h3>${esc(title)}</h3><p>${esc(msg)}</p><div class="footerbar"><button class="btn-ghost" data-v="0">Cancel</button><button class="btn-danger-fill" data-v="1">${esc(okText)}</button></div></div>`;
    document.body.append(el); requestAnimationFrame(() => el.classList.add('show'));
    const close = async v => { el.classList.remove('show'); res(v); await sleep(220); el.remove(); };
    el.addEventListener('click', e => { if (e.target === el) close(false); const b = e.target.closest('[data-v]'); if (b) close(b.dataset.v === '1'); });
  });
}
export async function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t);
  await sleep(1800); t.style.transition = 'opacity .3s'; t.style.opacity = 0; await sleep(300); t.remove();
}
