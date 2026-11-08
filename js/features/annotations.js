// The hover 🏷 tag / 💬 comment icons on fields with annotate:true.
import {events} from '../core/events.js';
import {esc, uid} from '../core/utils.js';
import {tagBoxHtml, bindTagBox, readTagBox} from '../types/tags.js';
import {storage} from '../core/storage.js?v=account-load-fix-1';
import {toast} from '../ui/dialog.js';
import {showImageLightbox} from '../ui/imageLightbox.js';

function renderImages(host, note) {
  host.replaceChildren();
  (note.images || []).forEach((image, index) => {
    const item = document.createElement('figure');
    item.className = 'ann-image-item';
    const previewButton = document.createElement('button');
    previewButton.type = 'button'; previewButton.className = 'ann-image-preview';
    previewButton.setAttribute('aria-label', 'View image larger');
    const preview = document.createElement('img');
    preview.alt = 'Pasted trade reference';
    if (image.previewBlob) preview.src = URL.createObjectURL(image.previewBlob);
    else storage.getVideo(image.key).then(blob => { if (blob && preview.isConnected) preview.src = URL.createObjectURL(blob); }).catch(() => {});
    const caption = document.createElement('input');
    caption.type = 'text'; caption.maxLength = 300;
    caption.placeholder = 'Sentence about this image…';
    caption.value = image.caption || '';
    caption.setAttribute('aria-label', 'Sentence linked to pasted image');
    caption.addEventListener('input', () => { image.caption = caption.value; });
    previewButton.addEventListener('click', () => showImageLightbox(preview.src, caption.value));
    previewButton.append(preview);
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'ann-image-remove';
    remove.textContent = '×'; remove.title = 'Remove image'; remove.setAttribute('aria-label', 'Remove pasted image');
    remove.addEventListener('click', () => { note.images.splice(index, 1); renderImages(host, note); window.dispatchEvent(new Event('journal:draft-change')); });
    item.append(previewButton, caption, remove); host.append(item);
  });
}

export function init() {
  events.on('field:built', ({el, field, type, notes}) => {
    if (!field.annotate) return;
    const n = notes[field.key] ??= {tags: [], comment: ''};
    n.tags ??= []; n.comment ??= ''; n.images ??= [];
    el.querySelector('.f-tools').insertAdjacentHTML('beforeend',
      '<button type="button" class="icon-btn" data-t="tag" title="Tags">🏷</button><button type="button" class="icon-btn" data-t="cmt" title="Comment">💬</button>');
    const panels = el.querySelector('.f-panels');
    let tagTarget;
    if (type.collapsible) tagTarget = el.querySelector('.f-control'); // tags-type field: 🏷 reveals its own input
    else {
      panels.insertAdjacentHTML('beforeend', `<div class="collapse ann-tag ${n.tags.length ? 'open' : ''}"><div class="inner"><div class="qpanel">${tagBoxHtml(n.tags)}</div></div></div>`);
      tagTarget = panels.querySelector('.ann-tag');
      const box = tagTarget.querySelector('.tagbox'); bindTagBox(box, () => { n.tags = readTagBox(box); });
    }
    panels.insertAdjacentHTML('beforeend', `<div class="collapse ann-cmt ${n.comment || n.images.length ? 'open' : ''}"><div class="inner"><div class="qpanel"><textarea placeholder="Add a note… (paste an image with Ctrl+V)">${esc(n.comment)}</textarea><div class="ann-images"></div></div></div></div>`);
    const cmt = panels.querySelector('.ann-cmt');
    const area = cmt.querySelector('textarea'), images = cmt.querySelector('.ann-images');
    renderImages(images, n);
    area.addEventListener('input', e => { n.comment = e.target.value; });
    area.addEventListener('paste', async event => {
      const imageItem = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'));
      const file = imageItem?.getAsFile();
      if (!file) return;
      event.preventDefault();
      try {
        const key = `annotation-${uid()}`;
        await storage.putVideo(key, file);
        n.images.push({key, mime:file.type, caption:'', previewBlob:file});
        renderImages(images, n);
        window.dispatchEvent(new Event('journal:draft-change'));
        images.lastElementChild?.querySelector('input')?.focus();
      } catch (error) {
        toast(error.message || 'Could not save image');
      }
    });
    el.querySelector('[data-t="tag"]').onclick = () => tagTarget.classList.toggle('open');
    el.querySelector('[data-t="cmt"]').onclick = () => cmt.classList.toggle('open');
  });
}
