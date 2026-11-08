let dialog;

function getDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'ann-lightbox';
  dialog.setAttribute('aria-label', 'Image preview');
  dialog.innerHTML = '<button class="ann-lightbox-close" type="button" aria-label="Close image preview">×</button><img class="ann-lightbox-image" alt="Expanded trade reference"><p class="ann-lightbox-caption"></p>';
  dialog.querySelector('.ann-lightbox-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  document.body.append(dialog);
  return dialog;
}

export function showImageLightbox(src, caption = '') {
  if (!src) return;
  const view = getDialog();
  view.querySelector('.ann-lightbox-image').src = src;
  const text = view.querySelector('.ann-lightbox-caption');
  text.textContent = caption;
  text.hidden = !caption;
  if (!view.open) view.showModal();
}
